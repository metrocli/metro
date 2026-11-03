'use strict';

/**
 * Create a package from a JSON/YAML spec the agent writes.
 *   POST /v1/packages/create  https://docs.metronome.com/api-reference/contracts/create-a-package
 *   POST /v1/packages/get     https://docs.metronome.com/api-reference/packages/get-a-package
 *   POST /v1/packages/list    https://docs.metronome.com/api-reference/list-all-packages
 *
 * The spec is the packages/create body. usage_statement_schedule is top level
 * (there is no `contract` wrapper). uniqueness_key (1-128 chars, 409 on reuse)
 * is derived from the spec when omitted.
 */

const rt = require('./lib/runtime');
const mx = require('./lib/metronome');
const { coerceDurationValue, packageSnapshot } = require('./package-clone-version');

const TOP_LEVEL = [
  'name', 'contract_name', 'uniqueness_key', 'net_payment_terms_days', 'rate_card_id', 'rate_card_alias', 'aliases',
  'duration', 'commits', 'credits', 'recurring_commits', 'recurring_credits', 'scheduled_charges',
  'scheduled_charges_on_usage_invoices', 'usage_statement_schedule', 'billing_provider', 'delivery_method',
  'subscriptions', 'overrides', 'multiplier_override_prioritization',
];
const USAGE_DAYS = ['FIRST_OF_MONTH', 'CONTRACT_START'];
const DURATION_UNITS = ['DAYS', 'WEEKS', 'MONTHS', 'YEARS'];

function coerceDeep(value) {
  if (Array.isArray(value)) return value.map(coerceDeep);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = /(_offset|_duration|^duration)$/.test(k) ? coerceDurationValue(coerceDeep(v)) : coerceDeep(v);
    }
    return out;
  }
  return value;
}

function validateSubscription(sub, where) {
  for (const k of ['subscription_rate', 'collection_schedule', 'proration']) {
    if (!sub[k]) throw rt.usageError(`${where}.${k} is required`);
  }
  if (!sub.subscription_rate.product_id || !sub.subscription_rate.billing_frequency) {
    throw rt.usageError(`${where}.subscription_rate needs product_id and billing_frequency`);
  }
  if (!['ADVANCE', 'ARREARS'].includes(String(sub.collection_schedule).toUpperCase())) {
    throw rt.usageError(`${where}.collection_schedule must be ADVANCE or ARREARS`);
  }
  const mode = String(sub.quantity_management_mode || 'QUANTITY_ONLY').toUpperCase();
  if (mode === 'QUANTITY_ONLY' && sub.initial_quantity === undefined) throw rt.usageError(`${where}.initial_quantity is required for QUANTITY_ONLY`);
  if (mode === 'SEAT_BASED' && !sub.seat_config?.seat_group_key) throw rt.usageError(`${where}.seat_config.seat_group_key is required for SEAT_BASED`);
}

function validateSpec(spec) {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) throw rt.usageError('Package spec must be an object (the packages/create body).');
  for (const k of Object.keys(spec)) {
    if (k === 'contract') throw rt.usageError('Spec has a "contract" key; packages/create takes usage_statement_schedule at the top level.');
    if (!TOP_LEVEL.includes(k)) throw rt.usageError(`Spec field ${k} is not a packages/create field.`);
  }
  if (!spec.name) throw rt.usageError('Spec needs name.');
  if (!spec.rate_card_id && !spec.rate_card_alias) throw rt.usageError('Spec needs rate_card_id or rate_card_alias.');
  const uss = spec.usage_statement_schedule;
  if (uss) {
    if (!uss.frequency) throw rt.usageError('usage_statement_schedule.frequency is required');
    if (uss.day !== undefined && !USAGE_DAYS.includes(String(uss.day).toUpperCase())) {
      throw rt.usageError(`usage_statement_schedule.day must be one of ${USAGE_DAYS.join(', ')} (CUSTOM_DATE is not supported by metro yet)`);
    }
  }
  if (spec.duration) {
    if (!Number.isInteger(spec.duration.value) || !DURATION_UNITS.includes(String(spec.duration.unit).toUpperCase())) {
      throw rt.usageError('duration needs an integer value and unit DAYS|WEEKS|MONTHS|YEARS');
    }
  }
  (spec.aliases || []).forEach((a, i) => {
    if (!a.name) throw rt.usageError(`aliases[${i}].name is required`);
    if (a.starting_at) rt.requireHourBoundary(`aliases[${i}].starting_at`, a.starting_at);
    if (a.ending_before) rt.requireHourBoundary(`aliases[${i}].ending_before`, a.ending_before);
  });
  (spec.subscriptions || []).forEach((s, i) => validateSubscription(s, `subscriptions[${i}]`));
  if (spec.uniqueness_key !== undefined) rt.assertUniquenessKey(spec.uniqueness_key, 'uniqueness_key');
}

async function uniquenessBlocker(client, key) {
  const all = await mx.listPaginated(client, 'post', '/v1/packages/list', { archive_filter: 'ALL' });
  const hit = all.find((p) => mx.normalizePackageUniquenessKey(p.uniqueness_key) === key);
  return hit ? [{ code: 'package_uniqueness_key_exists', uniqueness_key: key, package_id: hit.id }] : [];
}

const packageCreate = rt.defineOp({
  name: 'package-create',
  command: 'metro package create',
  async preflight(ctx) {
    const raw = rt.loadSpecFile(rt.readString(ctx.flags, 'file'));
    validateSpec(raw);
    const body = coerceDeep(raw);
    if (body.usage_statement_schedule?.day) body.usage_statement_schedule.day = String(body.usage_statement_schedule.day).toUpperCase();
    if (!body.uniqueness_key) body.uniqueness_key = rt.uniquenessKey('package', body);

    const blockers = [...(await uniquenessBlocker(ctx.client, body.uniqueness_key))];
    if (body.rate_card_id) {
      try {
        await mx.getRateCard(ctx.client, body.rate_card_id);
      } catch (err) {
        blockers.push({ code: 'rate_card_not_found', rate_card_id: body.rate_card_id, error: err.message });
      }
    }
    const live = await mx.listPackages(ctx.client);
    const warnings = [];
    for (const a of body.aliases || []) {
      const at = a.starting_at || ctx.now.toISOString();
      const holder = mx.resolvePackageAliasAt(live, a.name, at);
      if (holder && !rt.readBool(ctx.flags, 'allow-alias-takeover')) {
        blockers.push({ code: 'package_alias_in_use', alias: a.name, package_id: holder.id, remediation: 'Use metro package clone-version for a new version, or pass --allow-alias-takeover with a future aliases[].starting_at.' });
      } else if (holder) {
        warnings.push({ id: 'MTR-PKG-004', message: `Alias ${a.name} moves from package ${holder.id} to the new package at ${at}.` });
      }
    }
    if (!body.billing_provider) warnings.push({ id: 'MTR-BILL-001', message: 'No billing_provider on the package; contracts from it will not invoice through Stripe.' });
    if (blockers.length) throw rt.blocked(blockers);
    return {
      slug: body.name.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 32),
      summary: { name: body.name, uniqueness_key: body.uniqueness_key, aliases: body.aliases || [] },
      diff: [{ field: 'package', from: null, to: body }],
      warnings,
      steps: [{ id: 'create', method: 'POST', path: '/v1/packages/create', body }],
      expect: { body },
    };
  },
  async precheck(ctx, plan) {
    return uniquenessBlocker(ctx.client, plan.expect.body.uniqueness_key);
  },
  async verify(ctx, plan, results) {
    const body = plan.expect.body;
    const id = results.create?.data?.id;
    const got = id ? await mx.getPackage(ctx.client, id) : null;
    const alias = (body.aliases || [])[0]?.name || null;
    const want = packageSnapshot(body, alias);
    const actual = packageSnapshot(got, alias);
    if (!body.rate_card_id) delete want.rate_card_id; // resolved server-side from rate_card_alias
    const checks = Object.keys(want).map((k) => rt.check(`package.${k}`, want[k], actual[k]));
    checks.push(rt.check('package.aliases', (body.aliases || []).map((a) => a.name), mx.packageAliasNames(got), { compare: 'set' }));
    for (const k of ['commits', 'credits', 'scheduled_charges']) {
      checks.push(rt.check(`package.${k}.length`, (body[k] || []).length, (got?.[k] || []).length));
    }
    return checks;
  },
});

module.exports = { packageCreate, validateSpec, coerceDeep };
