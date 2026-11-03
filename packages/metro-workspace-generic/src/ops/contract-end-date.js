'use strict';

/**
 * contract-expire and contract-extend-trial: both move a contract's
 * ending_before with POST /v1/contracts/updateEndDate.
 * https://docs.metronome.com/api-reference/contracts/update-the-contract-end-date
 */

const rt = require('./lib/runtime');
const mx = require('./lib/metronome');

const UPDATE_END_DATE = '/v1/contracts/updateEndDate';

function endDateStep(customerId, contractId, endingBefore, allowFinalized) {
  return {
    id: 'updateEndDate',
    method: 'POST',
    path: UPDATE_END_DATE,
    body: {
      customer_id: customerId,
      contract_id: contractId,
      ending_before: endingBefore,
      // Explicit and hashed: never silently retried with true on a 400.
      allow_ending_before_finalized_invoice: allowFinalized,
    },
  };
}

async function verifyEndDate(ctx, plan) {
  const { customer_id: customerId, contract_id: contractId, ending_before: want } = plan.steps[0].body;
  const contract = await mx.getContract(ctx.client, customerId, contractId);
  return [
    rt.check('contract.id', contractId, contract?.id),
    rt.check('contract.ending_before', want, contract?.ending_before, { compare: 'instant' }),
  ];
}

async function resolveTarget(ctx) {
  const { customer, lookup } = await mx.resolveOneCustomer(ctx.client, ctx.flags);
  const contracts = await mx.listContracts(ctx.client, customer.id);
  const contract = mx.selectSingleActiveContract(contracts, {
    contractId: rt.readString(ctx.flags, 'contract-id'),
    now: ctx.now,
    customerId: customer.id,
  });
  return { customer, lookup, contract };
}

function computeExpireEndingBefore({ endingBefore, cutoverMode, startingAt, now }) {
  let chosen;
  if (endingBefore) chosen = rt.requireHourBoundary('--ending-before', endingBefore);
  else if (cutoverMode === 'current-hour') chosen = rt.currentHourUtc(now);
  else if (cutoverMode === 'next-hour') chosen = rt.nextHourUtc(now);
  else throw rt.usageError(`Unknown --cutover-mode=${cutoverMode}. Use current-hour, next-hour, or --ending-before=<ISO>.`);
  // Zero-length (ending_before == starting_at) is allowed; ending before start is not.
  if (startingAt && Date.parse(chosen) < Date.parse(startingAt)) chosen = rt.isoHour(startingAt);
  return chosen;
}

const contractExpire = rt.defineOp({
  name: 'contract-expire',
  command: 'metro contract expire',
  async preflight(ctx) {
    const { customer, lookup, contract } = await resolveTarget(ctx);
    const endingBefore = computeExpireEndingBefore({
      endingBefore: rt.readString(ctx.flags, 'ending-before'),
      cutoverMode: rt.readString(ctx.flags, 'cutover-mode') || 'current-hour',
      startingAt: contract.starting_at,
      now: ctx.now,
    });
    if (contract.ending_before && Date.parse(endingBefore) >= Date.parse(contract.ending_before)) {
      throw rt.usageError(`Contract ${contract.id} already ends at ${contract.ending_before} (requested ${endingBefore}). Nothing to expire.`);
    }
    const allowFinalized = rt.readBool(ctx.flags, 'allow-ending-before-finalized-invoice');
    return {
      slug: customer.id.slice(0, 8),
      summary: { customer: mx.summarizeCustomer(customer), lookup, contract: { id: contract.id, name: contract.name || null, package_id: contract.package_id || null, starting_at: contract.starting_at } },
      diff: [{ field: 'contract.ending_before', from: contract.ending_before || null, to: endingBefore }],
      warnings: allowFinalized ? [{ id: 'MTR-INV-001', message: 'allow_ending_before_finalized_invoice=true: finalized invoices after the new end stay as issued.' }] : [],
      steps: [endDateStep(customer.id, contract.id, endingBefore, allowFinalized)],
      expect: { contract_id: contract.id, ending_before: endingBefore },
    };
  },
  verify: verifyEndDate,
  render: (s) => `Customer: ${s.customer?.name} (${s.customer?.id})\nContract: ${s.contract?.id}`,
});

function computeExtendedEndingBefore({ extendTo, extendByDays, currentEndingBefore }) {
  if (extendTo) return rt.requireHourBoundary('--extend-to', extendTo);
  if (extendByDays !== null) {
    if (!currentEndingBefore) throw rt.usageError('Contract has no current ending_before to extend from; pass --extend-to=<ISO>.');
    const d = new Date(currentEndingBefore);
    d.setUTCDate(d.getUTCDate() + extendByDays);
    return rt.requireHourBoundary('computed extension', d.toISOString());
  }
  throw rt.usageError('Pass --extend-to=<ISO> or --extend-by-days=<N>.');
}

const contractExtendTrial = rt.defineOp({
  name: 'contract-extend-trial',
  command: 'metro contract extend-trial',
  async preflight(ctx) {
    const { customer, lookup, contract } = await resolveTarget(ctx);
    if (!contract.ending_before) {
      throw rt.usageError(`Contract ${contract.id} is open-ended; nothing to extend. Use metro contract move-plan for package changes.`);
    }
    const endingBefore = computeExtendedEndingBefore({
      extendTo: rt.readString(ctx.flags, 'extend-to'),
      extendByDays: rt.readInt(ctx.flags, 'extend-by-days', { min: 1 }),
      currentEndingBefore: contract.ending_before,
    });
    if (Date.parse(endingBefore) <= Date.parse(contract.ending_before)) {
      throw rt.usageError(`New ending_before (${endingBefore}) must be later than the current one (${contract.ending_before}); this is an extension.`);
    }
    if (Date.parse(endingBefore) <= ctx.now.getTime()) throw rt.usageError(`New ending_before (${endingBefore}) must be in the future.`);
    return {
      slug: customer.id.slice(0, 8),
      summary: { customer: mx.summarizeCustomer(customer), lookup, contract: { id: contract.id, package_id: contract.package_id || null } },
      diff: [{ field: 'contract.ending_before', from: contract.ending_before, to: endingBefore }],
      steps: [endDateStep(customer.id, contract.id, endingBefore, false)],
      expect: { contract_id: contract.id, ending_before: endingBefore },
    };
  },
  verify: verifyEndDate,
  render: (s) => `Customer: ${s.customer?.name} (${s.customer?.id})\nContract: ${s.contract?.id}`,
});

module.exports = {
  contractExpire,
  contractExtendTrial,
  computeExpireEndingBefore,
  computeExtendedEndingBefore,
  endDateStep,
};
