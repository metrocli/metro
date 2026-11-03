'use strict';

/**
 * Publish a new version of one or more packages behind the same alias names,
 * taking over at a future handoff hour. Packages cannot be edited, so a new
 * version is a fresh POST /v1/packages/create whose alias entry starts at the
 * handoff. From that instant alias resolution (latest starting_at wins) moves
 * to the new version, which closes the predecessor's alias window; read-back
 * proves both sides of the handoff.
 *   POST /v1/packages/list    https://docs.metronome.com/api-reference/list-all-packages
 *   POST /v1/packages/get     https://docs.metronome.com/api-reference/packages/get-a-package
 *   POST /v1/packages/create  https://docs.metronome.com/api-reference/contracts/create-a-package
 * Existing contracts keep their old package snapshot. Nothing is archived.
 */

const rt = require('./lib/runtime');
const mx = require('./lib/metronome');

const USAGE_DAYS = ['CONTRACT_START', 'FIRST_OF_MONTH'];

/** packages/get returns RelativeDate.value as a string; packages/create needs an integer. */
function coerceDurationValue(obj) {
  if (!obj || typeof obj !== 'object' || obj.value == null) return obj;
  if (typeof obj.value === 'string' && /^-?\d+$/.test(obj.value)) return { ...obj, value: Number(obj.value) };
  return obj;
}

const clonePlain = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));

function stripEmptyCustomFields(obj) {
  if (obj && obj.custom_fields && Object.keys(obj.custom_fields).length === 0) delete obj.custom_fields;
  return obj;
}

function coerceOffsets(out) {
  for (const k of ['starting_at_offset', 'ending_before_offset', 'commit_duration', 'duration']) {
    if (out[k]) out[k] = coerceDurationValue(out[k]);
  }
  return out;
}

function productToId(out) {
  if (out.product && typeof out.product === 'object') {
    out.product_id = out.product.id;
    delete out.product;
  }
  return out;
}

function cloneSubscription(sub) {
  const out = clonePlain(sub) || {};
  delete out.id;
  if (out.subscription_rate) {
    const rate = { ...out.subscription_rate };
    if (rate.product && typeof rate.product === 'object') {
      rate.product_id = rate.product.id;
      delete rate.product;
    }
    out.subscription_rate = rate;
  }
  return stripEmptyCustomFields(coerceOffsets(out));
}

function cloneTerm(item) {
  const out = clonePlain(item) || {};
  delete out.id;
  return stripEmptyCustomFields(coerceOffsets(productToId(out)));
}

function normalizeUniquenessKey(raw) {
  return mx.normalizePackageUniquenessKey(raw);
}

/** foo-v3 -> foo-v4; anything else -> <key>-v2. Always <=128 chars. */
function bumpUniquenessKey(raw, fallbackBase) {
  const bare = normalizeUniquenessKey(raw) || fallbackBase;
  const m = bare.match(/^(.*)-v(\d+)$/i);
  const base = m ? m[1] : bare;
  const next = m ? Number(m[2]) + 1 : 2;
  const suffix = `-v${next}`;
  return `${base.slice(0, rt.UNIQUENESS_KEY_MAX - suffix.length)}${suffix}`;
}

function cloneCreateBody(pkg, { alias, handoffAt, uniquenessKey, usageDay }) {
  const aliases = (pkg.aliases || []).map((entry) => {
    if (entry.name === alias) return { name: entry.name, starting_at: handoffAt };
    const kept = { name: entry.name };
    if (entry.starting_at) kept.starting_at = entry.starting_at;
    if (entry.ending_before) kept.ending_before = entry.ending_before;
    return kept;
  });
  if (!aliases.some((e) => e.name === alias)) aliases.push({ name: alias, starting_at: handoffAt });
  const body = {
    name: pkg.name,
    uniqueness_key: uniquenessKey,
    aliases,
  };
  for (const k of ['rate_card_id', 'billing_provider', 'delivery_method', 'scheduled_charges_on_usage_invoices', 'contract_name', 'net_payment_terms_days', 'multiplier_override_prioritization']) {
    if (pkg[k] != null) body[k] = pkg[k];
  }
  body.usage_statement_schedule = { frequency: pkg.usage_statement_schedule?.frequency || 'MONTHLY', day: usageDay };
  if (pkg.duration != null) body.duration = coerceDurationValue(clonePlain(pkg.duration));
  if (pkg.subscriptions?.length) body.subscriptions = pkg.subscriptions.map(cloneSubscription);
  for (const k of ['commits', 'credits', 'recurring_commits', 'recurring_credits', 'overrides', 'scheduled_charges']) {
    if (pkg[k]?.length) body[k] = pkg[k].map(cloneTerm);
  }
  return body;
}

function isoHourOrNull(v) {
  return v ? rt.isoHour(v) : null;
}

/** The fields read-back compares between the create body and packages/get. */
function packageSnapshot(pkg, alias) {
  const aliasEntry = (pkg?.aliases || []).find((e) => e.name === alias) || null;
  return {
    name: pkg?.name || null,
    uniqueness_key: normalizeUniquenessKey(pkg?.uniqueness_key),
    rate_card_id: pkg?.rate_card_id || null,
    duration: pkg?.duration ? coerceDurationValue(pkg.duration) : null,
    usage_day: pkg?.usage_statement_schedule?.day || 'FIRST_OF_MONTH',
    usage_frequency: pkg?.usage_statement_schedule?.frequency || 'MONTHLY',
    alias_starting_at: isoHourOrNull(aliasEntry?.starting_at),
    billing_provider: pkg?.billing_provider || null,
    delivery_method: pkg?.delivery_method || null,
    subscription_count: (pkg?.subscriptions || []).length,
    subscription_frequencies: (pkg?.subscriptions || []).map((s) => s?.subscription_rate?.billing_frequency || null),
    recurring_credit_count: (pkg?.recurring_credits || []).length,
    recurring_commit_count: (pkg?.recurring_commits || []).length,
    recurring_credit_offsets: (pkg?.recurring_credits || []).map((c) => coerceDurationValue(c?.starting_at_offset) || null),
  };
}

function diffSnapshots(expected, actual) {
  return Object.keys(expected).map((field) => rt.check(field, expected[field], actual?.[field]));
}

const packageCloneVersion = rt.defineOp({
  name: 'package-clone-version',
  command: 'metro package clone-version',
  async preflight(ctx) {
    const f = ctx.flags;
    const aliases = rt.readList(f, 'aliases');
    const handoffAt = rt.requireHourBoundary('--handoff-at', rt.readString(f, 'handoff-at'));
    const usageDayFlag = rt.readString(f, 'usage-day');
    if (!aliases.length || !handoffAt) {
      throw rt.usageError('Usage: metro package clone-version preflight --aliases=<alias>[,<alias>...] --handoff-at=<future UTC hour> [--usage-day=CONTRACT_START|FIRST_OF_MONTH] (--sandbox|--prod)');
    }
    if (Date.parse(handoffAt) <= ctx.now.getTime()) throw rt.usageError(`--handoff-at must be in the future, got ${handoffAt}`);
    if (usageDayFlag && !USAGE_DAYS.includes(usageDayFlag)) throw rt.usageError(`--usage-day must be one of ${USAGE_DAYS.join(', ')}`);

    const live = await mx.listPackages(ctx.client);
    const everything = await mx.listPaginated(ctx.client, 'post', '/v1/packages/list', { archive_filter: 'ALL' });
    const byKey = new Map(everything.map((p) => [normalizeUniquenessKey(p.uniqueness_key), p]).filter(([k]) => k));

    const steps = [];
    const rows = [];
    const blockers = [];
    const expectRows = [];
    for (const alias of aliases) {
      const current = mx.resolvePackageAliasAt(live, alias, ctx.now.toISOString());
      if (!current) {
        blockers.push({ code: 'alias_not_live', alias });
        continue;
      }
      const scheduled = mx.resolvePackageAliasAt(live, alias, handoffAt);
      if (scheduled && scheduled.id !== current.id) {
        blockers.push({ code: 'alias_already_has_a_future_version', alias, current: current.id, at_handoff: scheduled.id });
        continue;
      }
      const pkg = await mx.getPackage(ctx.client, current.id);
      const fromDay = pkg.usage_statement_schedule?.day || 'FIRST_OF_MONTH';
      const usageDay = usageDayFlag || fromDay;
      const key = bumpUniquenessKey(pkg.uniqueness_key, `pkg-${alias}`);
      const body = cloneCreateBody(pkg, { alias, handoffAt, uniquenessKey: key, usageDay });
      const existing = byKey.get(key) || null;
      const row = {
        alias,
        current_id: pkg.id,
        change: {
          usage_statement_schedule_day: { from: fromDay, to: usageDay },
          uniqueness_key: { from: normalizeUniquenessKey(pkg.uniqueness_key) || null, to: key },
          predecessor_alias_window: { from: 'open', to: `closes at ${handoffAt}` },
        },
        existing_package_id: existing?.id || null,
      };
      rows.push(row);
      if (existing) {
        row.action = 'skip_uniqueness_key_exists';
      } else {
        row.action = 'create';
        steps.push({ id: `create:${alias}`, method: 'POST', path: '/v1/packages/create', body });
      }
      expectRows.push({ alias, predecessor_id: pkg.id, existing_package_id: existing?.id || null, snapshot: packageSnapshot(body, alias) });
    }
    if (blockers.length) throw rt.blocked(blockers);
    if (!steps.length) throw rt.usageError('Every alias already has the new version (uniqueness key exists). Nothing to create.');
    return {
      slug: aliases.join('+').slice(0, 40),
      summary: { handoff_at: handoffAt, packages: rows, will_not: ['archive any package', 'touch existing contracts'] },
      diff: rows.flatMap((r) => [
        { field: `${r.alias}.usage_statement_schedule.day`, from: r.change.usage_statement_schedule_day.from, to: r.change.usage_statement_schedule_day.to },
        { field: `${r.alias}.resolves_to`, from: r.current_id, to: `(new version) from ${handoffAt}` },
      ]),
      steps,
      expect: { handoff_at: handoffAt, rows: expectRows },
    };
  },
  async verify(ctx, plan, results) {
    const checks = [];
    const live = await mx.listPackages(ctx.client);
    const before = new Date(Date.parse(plan.expect.handoff_at) - 3600 * 1000).toISOString();
    for (const row of plan.expect.rows) {
      const created = results[`create:${row.alias}`];
      const newId = created?.data?.id || created?.id || row.existing_package_id;
      if (!newId) {
        checks.push(rt.check(`${row.alias} new package id`, 'an id', null));
        continue;
      }
      const got = await mx.getPackage(ctx.client, newId);
      for (const c of diffSnapshots(row.snapshot, packageSnapshot(got, row.alias))) {
        checks.push({ ...c, check: `${row.alias}.${c.check}` });
      }
      checks.push(rt.check(`${row.alias} resolves to predecessor before handoff`, row.predecessor_id, mx.resolvePackageAliasAt(live, row.alias, before)?.id || null));
      checks.push(rt.check(`${row.alias} resolves to new version at handoff`, newId, mx.resolvePackageAliasAt(live, row.alias, plan.expect.handoff_at)?.id || null));
    }
    return checks;
  },
});

module.exports = {
  packageCloneVersion,
  bumpUniquenessKey,
  cloneCreateBody,
  coerceDurationValue,
  packageSnapshot,
};
