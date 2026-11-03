'use strict';

/**
 * Create a contract for a customer, from a package or directly from a spec.
 *   POST /v1/contracts/create  https://docs.metronome.com/api-reference/contracts/create-a-contract
 *   POST /v2/contracts/get     https://docs.metronome.com/api-reference/contracts/get-a-contract-v2
 *
 * From a package, the docs allow only customer_id, starting_at, package_id,
 * uniqueness_key, transition and custom_fields. metro resolves --package-alias
 * to the package live at starting_at during preflight and pins that
 * package_id, so apply writes exactly what was previewed.
 * Every create carries a uniqueness_key (1-128 chars, 409 on reuse).
 */

const rt = require('./lib/runtime');
const mx = require('./lib/metronome');

const PACKAGE_MODE_FIELDS = ['customer_id', 'starting_at', 'package_id', 'uniqueness_key', 'transition', 'custom_fields'];
const DIRECT_FIELDS = [
  'customer_id', 'starting_at', 'ending_before', 'name', 'uniqueness_key', 'rate_card_id', 'rate_card_alias',
  'net_payment_terms_days', 'commits', 'credits', 'recurring_commits', 'recurring_credits', 'overrides', 'discounts',
  'scheduled_charges', 'scheduled_charges_on_usage_invoices', 'usage_statement_schedule', 'custom_fields',
  'billing_provider_configuration', 'subscriptions', 'transition', 'usage_filter', 'multiplier_override_prioritization',
];

function validateContractSubscription(sub, where) {
  for (const k of ['subscription_rate', 'collection_schedule', 'proration']) {
    if (!sub[k]) throw rt.usageError(`${where}.${k} is required`);
  }
  if (!sub.subscription_rate.product_id || !sub.subscription_rate.billing_frequency) {
    throw rt.usageError(`${where}.subscription_rate needs product_id and billing_frequency`);
  }
  const mode = String(sub.quantity_management_mode || 'QUANTITY_ONLY').toUpperCase();
  if (mode === 'QUANTITY_ONLY' && (typeof sub.initial_quantity !== 'number' || sub.initial_quantity < 0)) {
    throw rt.usageError(`${where}.initial_quantity (>= 0) is required for QUANTITY_ONLY`);
  }
  if (mode === 'SEAT_BASED' && (!sub.seat_config?.seat_group_key || !Array.isArray(sub.seat_config?.initial_seat_ids))) {
    throw rt.usageError(`${where}.seat_config needs seat_group_key and initial_seat_ids for SEAT_BASED`);
  }
  if (sub.proration.invoice_behavior === 'BILL_IMMEDIATELY' && String(sub.collection_schedule).toUpperCase() !== 'ADVANCE') {
    throw rt.usageError(`${where}: BILL_IMMEDIATELY is only valid with collection_schedule ADVANCE`);
  }
  if (sub.starting_at) rt.requireHourBoundary(`${where}.starting_at`, sub.starting_at);
}

function overlaps(contract, start, end) {
  if (contract.archived_at) return false;
  const cs = Date.parse(contract.starting_at);
  const ce = contract.ending_before ? Date.parse(contract.ending_before) : Infinity;
  const s = Date.parse(start);
  const e = end ? Date.parse(end) : Infinity;
  return cs < e && s < ce;
}

async function overlapBlockers(client, customerId, start, end) {
  const contracts = await mx.listContracts(client, customerId);
  return contracts.filter((c) => overlaps(c, start, end)).map((c) => ({
    code: 'overlapping_contract',
    contract_id: c.id,
    starting_at: c.starting_at,
    ending_before: c.ending_before || null,
    remediation: 'A second concurrent contract double-bills. Use metro contract move-plan, end the existing contract first, or pass --allow-concurrent.',
  }));
}

const contractCreate = rt.defineOp({
  name: 'contract-create',
  command: 'metro contract create',
  async preflight(ctx) {
    const f = ctx.flags;
    const packageAlias = rt.readString(f, 'package-alias');
    const packageIdFlag = rt.readString(f, 'package-id');
    const specPath = rt.readString(f, 'file');
    const modes = [packageAlias || packageIdFlag ? 'package' : null, specPath ? 'direct' : null].filter(Boolean);
    if (modes.length !== 1) {
      throw rt.usageError([
        'Usage (pick one):',
        '  metro contract create preflight (--package-alias=<alias>|--package-id=<id>) --starting-at=<UTC hour> <customer> [--custom-fields=<json>] (--sandbox|--prod)',
        '  metro contract create preflight --file=<contract.json|yaml> <customer> (--sandbox|--prod)',
        '  <customer> = --customer-id= | --external-id= | --ingest-alias= | --name=',
      ].join('\n'));
    }
    const mode = modes[0];
    const { customer } = await mx.resolveOneCustomer(ctx.client, f);
    const warnings = [];
    let body;
    let pkg = null;

    if (mode === 'package') {
      const startingAt = rt.requireHourBoundary('--starting-at', rt.readString(f, 'starting-at'));
      if (!startingAt) throw rt.usageError('--starting-at=<UTC hour boundary> is required');
      if (packageIdFlag) pkg = await mx.getPackage(ctx.client, packageIdFlag);
      else {
        pkg = mx.resolvePackageAliasAt(await mx.listPackages(ctx.client), packageAlias, startingAt);
        if (!pkg) throw rt.usageError(`No live package has alias ${packageAlias} at ${startingAt}.`);
      }
      if (pkg.archived_at) throw rt.blocked([{ code: 'package_archived', package_id: pkg.id }]);
      body = { customer_id: customer.id, starting_at: startingAt, package_id: pkg.id };
      const customFields = rt.readJsonFlag(f, 'custom-fields');
      if (customFields) body.custom_fields = customFields;
      body.uniqueness_key = rt.readString(f, 'uniqueness-key')
        || rt.uniquenessKey('contract', [customer.id, pkg.id, startingAt]);
      for (const k of Object.keys(body)) if (!PACKAGE_MODE_FIELDS.includes(k)) throw rt.usageError(`${k} is not allowed with package_id`);
      if (mx.isBillingEmptyPackage(pkg)) warnings.push({ id: 'MTR-MOVE-EMPTY-PACKAGE-001', message: `Package ${pkg.id} has no commits, credits, subscriptions or scheduled charges.` });
    } else {
      const spec = rt.loadSpecFile(specPath);
      for (const k of Object.keys(spec)) {
        if (k === 'package_id' || k === 'package_alias') throw rt.usageError('Use --package-alias/--package-id for package contracts; the direct spec must not set a package.');
        if (!DIRECT_FIELDS.includes(k)) throw rt.usageError(`Spec field ${k} is not supported by metro contract create.`);
      }
      if (spec.customer_id && spec.customer_id !== customer.id) throw rt.usageError(`Spec customer_id ${spec.customer_id} does not match the resolved customer ${customer.id}.`);
      if (!spec.rate_card_id && !spec.rate_card_alias) throw rt.usageError('Direct contract spec needs rate_card_id or rate_card_alias.');
      const startingAt = rt.requireHourBoundary('starting_at', spec.starting_at || rt.readString(f, 'starting-at'));
      if (!startingAt) throw rt.usageError('starting_at is required (spec or --starting-at).');
      body = { ...spec, customer_id: customer.id, starting_at: startingAt };
      if (body.ending_before) body.ending_before = rt.requireHourBoundary('ending_before', body.ending_before);
      (body.subscriptions || []).forEach((s, i) => validateContractSubscription(s, `subscriptions[${i}]`));
      body.uniqueness_key = body.uniqueness_key ? rt.assertUniquenessKey(body.uniqueness_key) : rt.uniquenessKey('contract', body);
      if (body.rate_card_id) await mx.getRateCard(ctx.client, body.rate_card_id);
      if (!body.billing_provider_configuration) warnings.push({ id: 'MTR-BILL-001', message: 'No billing_provider_configuration on the contract.' });
    }

    if (Date.parse(body.starting_at) < ctx.now.getTime()) {
      warnings.push({ id: 'MTR-TIME-002', message: `starting_at ${body.starting_at} is in the past; scheduled charges for elapsed periods may invoice immediately.` });
    }
    const blockers = rt.readBool(f, 'allow-concurrent') ? [] : await overlapBlockers(ctx.client, customer.id, body.starting_at, body.ending_before);
    if (blockers.length) throw rt.blocked(blockers);

    return {
      slug: customer.id.slice(0, 8),
      summary: { customer: mx.summarizeCustomer(customer), mode, package: pkg ? { id: pkg.id, name: pkg.name || null, aliases: mx.packageAliasNames(pkg) } : null },
      diff: [{ field: 'contract', from: null, to: body }],
      warnings,
      steps: [{ id: 'create', method: 'POST', path: '/v1/contracts/create', body }],
      expect: { body, mode, allow_concurrent: rt.readBool(f, 'allow-concurrent') },
    };
  },
  async precheck(ctx, plan) {
    if (plan.expect.allow_concurrent) return [];
    const b = plan.expect.body;
    return overlapBlockers(ctx.client, b.customer_id, b.starting_at, b.ending_before);
  },
  async verify(ctx, plan, results) {
    const b = plan.expect.body;
    const id = results.create?.data?.id;
    const got = id ? await mx.getContract(ctx.client, b.customer_id, id) : null;
    const checks = [
      rt.check('contract.id', 'present', got?.id ? 'present' : null),
      rt.check('contract.customer_id', b.customer_id, got?.customer_id),
      rt.check('contract.starting_at', b.starting_at, got?.starting_at, { compare: 'instant' }),
      rt.check('contract.uniqueness_key', b.uniqueness_key, got?.uniqueness_key),
    ];
    if (b.package_id) checks.push(rt.check('contract.package_id', b.package_id, got?.package_id));
    if (b.rate_card_id) checks.push(rt.check('contract.rate_card_id', b.rate_card_id, got?.rate_card_id));
    if (b.ending_before) checks.push(rt.check('contract.ending_before', b.ending_before, got?.ending_before, { compare: 'instant' }));
    if (b.subscriptions) {
      const subs = got?.subscriptions || [];
      checks.push(rt.check('contract.subscriptions.length', b.subscriptions.length, subs.length));
      b.subscriptions.forEach((s, i) => {
        const match = subs.find((x) => x.subscription_rate?.product?.id === s.subscription_rate.product_id
          && String(x.subscription_rate?.billing_frequency).toUpperCase() === String(s.subscription_rate.billing_frequency).toUpperCase());
        checks.push(rt.check(`subscriptions[${i}] product+frequency`, true, Boolean(match)));
        if (match && s.initial_quantity !== undefined) {
          const first = (match.quantity_schedule || [])[0];
          checks.push(rt.check(`subscriptions[${i}] initial quantity`, s.initial_quantity, first?.quantity, { compare: 'number' }));
        }
      });
    }
    return checks;
  },
});

module.exports = { contractCreate, validateContractSubscription, overlaps };
