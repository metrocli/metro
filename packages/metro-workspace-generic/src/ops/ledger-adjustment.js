'use strict';

/**
 * Balance changes on an existing contract, three modes:
 *
 *   partial  signed ledger entry on one commit/credit segment
 *            POST /v1/contracts/addManualBalanceLedgerEntry
 *            https://docs.metronome.com/api-reference/credits-and-commits/add-a-manual-balance-entry
 *   archive  archive a whole grant (archive_credits / archive_commits)
 *   grant    add a new credit or complimentary prepaid commit (add_credits / add_commits)
 *            POST /v2/contracts/edit
 *            https://docs.metronome.com/api-reference/contracts/edit-a-contract
 *
 * Every write carries a uniqueness_key (both endpoints accept one, 409 on reuse).
 * Additions (positive partial, grant) are refused while spendable net and the
 * per-segment list diverge for that credit type (see lib/net-balance.js).
 */

const rt = require('./lib/runtime');
const mx = require('./lib/metronome');
const net = require('./lib/net-balance');
const core = require('./lib/core');

function configuredCreditTypeId(tenant) {
  try {
    const catalog = core.loader().readProfileWorkspaceCatalog
      ? core.loader().readProfileWorkspaceCatalog({ tenant })
      : null;
    return catalog?.creditTypeId || null;
  } catch {
    return null;
  }
}

function buildPartialPlan({ customerId, amount, reason, contractId, balanceId, activeContractIds, balances }) {
  const blockers = [];
  const summarized = balances.map(mx.summarizeBalance);
  const isRemoval = amount < 0;
  const magnitude = Math.abs(amount);
  const eligible = summarized.filter((row) => row.id && row.segment_id
    && (!row.contract_id || activeContractIds.has(row.contract_id))
    && (!isRemoval || row.balance >= magnitude));
  let candidates = eligible;
  if (balanceId) candidates = candidates.filter((row) => row.id === balanceId);
  if (contractId) candidates = candidates.filter((row) => row.contract_id === contractId);
  if (isRemoval && eligible.length === 0) blockers.push({ code: 'no_balance_covers_removal_amount', amount });
  if (!isRemoval && !balanceId && !contractId) blockers.push({ code: 'target_balance_or_contract_required_for_addition' });
  if (!balanceId && !contractId && candidates.length > 1) blockers.push({ code: 'ambiguous_balance_target', candidates });
  if ((balanceId || contractId) && candidates.length !== 1) {
    blockers.push({ code: 'target_filter_did_not_resolve_one_balance', balance_id: balanceId, contract_id: contractId, candidates });
  }
  const target = candidates.length === 1 ? candidates[0] : null;
  return { blockers, target, summarized };
}

function selectContractForGrant(contracts, contractId, now) {
  const active = contracts.filter((c) => mx.isActiveContract(c, now));
  const pick = contractId ? active.filter((c) => c.id === contractId) : active;
  if (pick.length !== 1) {
    throw rt.usageError(`Grant needs exactly one active contract${contractId ? ` matching ${contractId}` : '; pass --contract-id='} (found ${pick.length}).`);
  }
  return pick[0];
}

const ledgerAdjustment = rt.defineOp({
  name: 'ledger-adjustment',
  command: 'metro ledger-adjustment',
  async preflight(ctx) {
    const f = ctx.flags;
    const reason = rt.readString(f, 'reason');
    const archiveBalanceId = rt.readString(f, 'archive-balance-id');
    const grant = rt.readString(f, 'grant');
    const amountRaw = rt.readString(f, 'amount');
    const modes = [archiveBalanceId ? 'archive' : null, grant ? 'grant' : null, (!grant && amountRaw !== null) ? 'partial' : null].filter(Boolean);
    if (modes.length !== 1 || !reason) {
      throw rt.usageError([
        'Usage (pick one mode; --reason is always required):',
        '  metro ledger-adjustment preflight --amount=<signed-int> --reason="..." (--balance-id=|--contract-id=) <customer> (--sandbox|--prod)',
        '  metro ledger-adjustment preflight --archive-balance-id=<id> --reason="..." <customer> (--sandbox|--prod)',
        '  metro ledger-adjustment preflight --grant=credit|commit --amount=<n> --product-id=<id> --starting-at=<ISO> --ending-before=<ISO> [--credit-type-id=] [--contract-id=] [--grant-name=] [--priority=] --reason="..." <customer> (--sandbox|--prod)',
        '  <customer> = --customer-id= | --external-id= | --ingest-alias= | --name= | --query=',
      ].join('\n'));
    }
    const mode = modes[0];
    const { customer } = await mx.resolveOneCustomer(ctx.client, f);
    const [contracts, balances] = await Promise.all([
      mx.listContracts(ctx.client, customer.id),
      mx.listBalances(ctx.client, customer.id),
    ]);
    const activeContractIds = new Set(contracts.filter((c) => mx.isActiveContract(c, ctx.now)).map((c) => c.id));
    const acknowledged = rt.readString(f, 'acknowledge-net-divergence') === net.NET_DIVERGENCE_ACKNOWLEDGEMENT;
    const summary = { customer: mx.summarizeCustomer(customer), mode, reason };
    const warnings = [];

    async function guardAddition(amount, creditTypeId) {
      const netBalance = await net.fetchNetBalance(ctx.client, customer.id, creditTypeId);
      const reconciliation = net.reconcileNetVsBuckets({
        netBalance,
        bucketSum: net.sumBuckets(balances, { creditTypeId, activeContractIds }),
        creditTypeId,
      });
      summary.creditReconciliation = reconciliation;
      const blocker = net.additionDivergenceBlocker({ amount, reconciliation, acknowledged });
      if (blocker) throw rt.blocked([blocker]);
      if (reconciliation.divergent && amount > 0) {
        warnings.push({ id: 'MTR-CREDIT-NET-001', message: `Net divergence acknowledged: net=${reconciliation.netBalance} list=${reconciliation.bucketSum} delta=${reconciliation.delta}.` });
      }
    }

    if (mode === 'partial') {
      if (!/^-?\d+(\.\d+)?$/.test(amountRaw)) throw rt.usageError(`--amount must be a signed number, got ${amountRaw}`);
      const amount = Number(amountRaw);
      if (amount === 0) throw rt.usageError('--amount must not be zero.');
      const plan = buildPartialPlan({
        customerId: customer.id,
        amount,
        reason,
        contractId: rt.readString(f, 'contract-id'),
        balanceId: rt.readString(f, 'balance-id'),
        activeContractIds,
        balances,
      });
      if (plan.blockers.length) throw rt.blocked(plan.blockers);
      if (amount > 0) await guardAddition(amount, plan.target.credit_type_id);
      const t = plan.target;
      const body = {
        customer_id: customer.id,
        ...(t.contract_id ? { contract_id: t.contract_id } : {}),
        id: t.id,
        segment_id: t.segment_id,
        amount,
        reason,
        uniqueness_key: rt.uniquenessKey('ledger', [customer.id, t.id, t.segment_id, amount, reason, t.balance]),
      };
      summary.target_balance = t;
      return {
        slug: customer.id.slice(0, 8),
        summary,
        warnings,
        diff: [{ field: `balance ${t.id}`, from: t.balance, to: t.balance + amount }],
        steps: [{ id: 'ledgerEntry', method: 'POST', path: '/v1/contracts/addManualBalanceLedgerEntry', body }],
        expect: { customer_id: customer.id, balance_id: t.id, balance_after: t.balance + amount },
      };
    }

    if (mode === 'archive') {
      const target = balances.map(mx.summarizeBalance).find((row) => row.id === archiveBalanceId);
      if (!target) throw rt.blocked([{ code: 'archive_balance_not_found', archive_balance_id: archiveBalanceId }]);
      if (target.contract_id && !activeContractIds.has(target.contract_id)) {
        throw rt.blocked([{ code: 'archive_balance_contract_not_active', target }]);
      }
      const key = target.type === 'CREDIT' ? 'archive_credits' : 'archive_commits';
      summary.target_balance = target;
      return {
        slug: customer.id.slice(0, 8),
        summary,
        diff: [{ field: `balance ${target.id}`, from: target.balance, to: '(archived)' }],
        steps: [{
          id: 'archive',
          method: 'POST',
          path: '/v2/contracts/edit',
          body: {
            customer_id: customer.id,
            contract_id: target.contract_id,
            [key]: [{ id: target.id }],
            uniqueness_key: rt.uniquenessKey('archive-balance', [customer.id, target.id]),
          },
        }],
        expect: { customer_id: customer.id, contract_id: target.contract_id, archived_balance_id: target.id, kind: key },
      };
    }

    // grant
    if (!['credit', 'commit'].includes(grant)) throw rt.usageError('--grant must be credit or commit');
    const amount = rt.readNumber(f, 'amount');
    if (!(amount > 0)) throw rt.usageError('--grant needs a positive --amount');
    const productId = rt.readString(f, 'product-id');
    const startingAt = rt.requireHourBoundary('--starting-at', rt.readString(f, 'starting-at'));
    const endingBefore = rt.requireHourBoundary('--ending-before', rt.readString(f, 'ending-before'));
    if (!productId || !startingAt || !endingBefore) throw rt.usageError('--grant needs --product-id, --starting-at and --ending-before');
    if (Date.parse(endingBefore) <= Date.parse(startingAt)) throw rt.usageError('--ending-before must be after --starting-at');
    const creditTypeId = rt.readString(f, 'credit-type-id') || configuredCreditTypeId(ctx.tenant);
    if (!creditTypeId) {
      throw rt.usageError('Pass --credit-type-id= (or bind workspaceCatalog.creditTypeId with metro catalog bind --write). metro will not guess the access credit type.');
    }
    const contract = selectContractForGrant(contracts, rt.readString(f, 'contract-id'), ctx.now);
    await guardAddition(amount, creditTypeId);
    const name = rt.readString(f, 'grant-name') || `metro ${grant} grant`;
    const item = {
      product_id: productId,
      name,
      access_schedule: { credit_type_id: creditTypeId, schedule_items: [{ amount, starting_at: startingAt, ending_before: endingBefore }] },
      ...(rt.readInt(f, 'priority') !== null ? { priority: rt.readInt(f, 'priority') } : {}),
      // PREPAID with no invoice_schedule = complimentary commit (no invoice).
      ...(grant === 'commit' ? { type: 'PREPAID' } : {}),
    };
    const key = grant === 'credit' ? 'add_credits' : 'add_commits';
    summary.contract_id = contract.id;
    return {
      slug: customer.id.slice(0, 8),
      summary,
      warnings,
      diff: [{ field: `${key} on ${contract.id}`, from: null, to: { amount, starting_at: startingAt, ending_before: endingBefore, credit_type_id: creditTypeId } }],
      steps: [{
        id: 'grant',
        method: 'POST',
        path: '/v2/contracts/edit',
        body: {
          customer_id: customer.id,
          contract_id: contract.id,
          [key]: [item],
          uniqueness_key: rt.uniquenessKey('grant', [customer.id, contract.id, item]),
        },
      }],
      expect: { customer_id: customer.id, contract_id: contract.id, kind: key, item },
    };
  },
  async verify(ctx, plan) {
    const e = plan.expect;
    if (e.balance_id) {
      const rows = (await mx.listBalances(ctx.client, e.customer_id)).map(mx.summarizeBalance);
      const row = rows.find((r) => r.id === e.balance_id);
      return [rt.check(`balance ${e.balance_id}`, e.balance_after, row?.balance, { compare: 'number' })];
    }
    const contract = await mx.getContract(ctx.client, e.customer_id, e.contract_id);
    const list = e.kind.endsWith('credits') ? (contract?.credits || []) : (contract?.commits || []);
    if (e.archived_balance_id) {
      const row = list.find((x) => x.id === e.archived_balance_id);
      return [rt.check(`${e.archived_balance_id} archived`, true, !row || Boolean(row.archived_at))];
    }
    const want = e.item.access_schedule.schedule_items[0];
    const match = list.find((x) => (x.product?.id || x.product_id) === e.item.product_id
      && x.name === e.item.name
      && (x.access_schedule?.schedule_items || []).some((si) => Number(si.amount) === Number(want.amount)
        && rt.sameInstant(si.starting_at, want.starting_at) && rt.sameInstant(si.ending_before, want.ending_before)));
    return [rt.check(`${e.kind} present with amount ${want.amount}`, true, Boolean(match))];
  },
});

module.exports = { ledgerAdjustment, buildPartialPlan };
