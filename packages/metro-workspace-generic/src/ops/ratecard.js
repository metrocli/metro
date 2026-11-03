'use strict';

/**
 * Rate cards: create (optionally with rates) and add rates to an existing card.
 *   POST /v1/contract-pricing/rate-cards/create    https://docs.metronome.com/api-reference/rate-cards/create-a-rate-card
 *   POST /v1/contract-pricing/rate-cards/addRates  https://docs.metronome.com/api-reference/rate-cards/add-rates
 *   POST /v1/contract-pricing/rate-cards/get       https://docs.metronome.com/api-reference/rate-cards/get-a-rate-card
 *   POST /v1/contract-pricing/rate-cards/getRates  https://docs.metronome.com/api-reference/rate-cards/get-rates
 *   POST /v1/contract-pricing/rate-cards/list      https://docs.metronome.com/api-reference/rate-cards/list-rate-cards
 *   POST /v1/contract-pricing/products/get         https://docs.metronome.com/api-reference/products/get-a-product
 *
 * Limits: addRate (singular) is "heavily rate limited" per the docs, so metro
 * only uses addRates. The docs set no per-request maximum for addRates; metro
 * sends at most RATES_PER_REQUEST rates per call as a conservative choice.
 * Rate-card create documents no uniqueness_key, so the card name is the
 * idempotency anchor: preflight refuses a name that already exists and apply
 * re-checks it right before writing. An alias claimed by a new card silently
 * moves off its old card (per the docs), so a live alias is refused unless
 * --allow-alias-move is passed.
 */

const rt = require('./lib/runtime');
const mx = require('./lib/metronome');

const RATES_PER_REQUEST = 100;
const RATE_TYPES = ['FLAT', 'PERCENTAGE', 'SUBSCRIPTION', 'TIERED', 'TIERED_PERCENTAGE', 'CUSTOM'];
const BILLING_FREQUENCIES = ['MONTHLY', 'QUARTERLY', 'SEMI_ANNUAL', 'ANNUAL', 'WEEKLY'];
const RATE_FIELDS = ['product_id', 'starting_at', 'ending_before', 'entitled', 'rate_type', 'price', 'credit_type_id', 'quantity', 'is_prorated', 'billing_frequency', 'pricing_group_values', 'tiers', 'commit_rate', 'custom_rate'];

function validateRates(rates) {
  if (!Array.isArray(rates)) throw rt.usageError('rates must be an array');
  return rates.map((rate, i) => {
    const where = `rates[${i}]`;
    for (const k of Object.keys(rate)) {
      if (!RATE_FIELDS.includes(k)) throw rt.usageError(`${where}.${k} is not an addRates field`);
    }
    for (const k of ['product_id', 'starting_at', 'entitled', 'rate_type']) {
      if (rate[k] === undefined || rate[k] === null) throw rt.usageError(`${where}.${k} is required`);
    }
    const rateType = String(rate.rate_type).toUpperCase();
    if (!RATE_TYPES.includes(rateType)) throw rt.usageError(`${where}.rate_type must be one of ${RATE_TYPES.join(', ')}`);
    if (typeof rate.entitled !== 'boolean') throw rt.usageError(`${where}.entitled must be boolean`);
    // metro rule (not stated in the docs): rate boundaries on UTC hours.
    const out = { ...rate, rate_type: rateType, starting_at: rt.requireHourBoundary(`${where}.starting_at`, rate.starting_at) };
    if (rate.ending_before) out.ending_before = rt.requireHourBoundary(`${where}.ending_before`, rate.ending_before);
    if (['FLAT', 'SUBSCRIPTION', 'PERCENTAGE'].includes(rateType) && typeof rate.price !== 'number') {
      throw rt.usageError(`${where}.price must be a number for ${rateType}`);
    }
    if (rate.is_prorated !== undefined && (rateType !== 'SUBSCRIPTION' || rate.is_prorated !== true)) {
      throw rt.usageError(`${where}.is_prorated is only valid for SUBSCRIPTION and must be true`);
    }
    if (rate.billing_frequency && !BILLING_FREQUENCIES.includes(String(rate.billing_frequency).toUpperCase())) {
      throw rt.usageError(`${where}.billing_frequency must be one of ${BILLING_FREQUENCIES.join(', ')}`);
    }
    if (rateType === 'SUBSCRIPTION' && !rate.billing_frequency) {
      throw rt.usageError(`${where}: SUBSCRIPTION rates need billing_frequency (it must match the subscription's)`);
    }
    return out;
  });
}

async function productTypes(client, productIds) {
  const out = {};
  for (const id of productIds) {
    try {
      const resp = await client.post('/v1/contract-pricing/products/get', { id });
      const p = (resp && resp.data) || resp;
      out[id] = { type: p?.type || null, archived_at: p?.archived_at || null, name: p?.current?.name || p?.name || null };
    } catch (err) {
      out[id] = { error: err.message };
    }
  }
  return out;
}

function productBlockers(rates, types) {
  const blockers = [];
  for (const [id, t] of Object.entries(types)) {
    if (t.error) blockers.push({ code: 'product_not_found', product_id: id, error: t.error });
    else if (t.archived_at) blockers.push({ code: 'product_archived', product_id: id });
  }
  for (const r of rates) {
    const t = types[r.product_id];
    if (t && !t.error && r.rate_type === 'SUBSCRIPTION' && t.type && t.type !== 'SUBSCRIPTION') {
      blockers.push({ code: 'subscription_rate_on_non_subscription_product', product_id: r.product_id, product_type: t.type });
    }
  }
  return blockers;
}

function rateKey(r) {
  return JSON.stringify([r.product_id, rt.isoHour(r.starting_at), r.pricing_group_values || {}, r.billing_frequency ? String(r.billing_frequency).toUpperCase() : null]);
}

function rowKey(row) {
  return JSON.stringify([row.product_id, rt.isoHour(row.starting_at), row.pricing_group_values || {}, row.billing_frequency ? String(row.billing_frequency).toUpperCase() : null]);
}

function chunkSteps(rates, rateCardRef) {
  const steps = [];
  for (let i = 0; i < rates.length; i += RATES_PER_REQUEST) {
    steps.push({
      id: `addRates:${i / RATES_PER_REQUEST}`,
      method: 'POST',
      path: '/v1/contract-pricing/rate-cards/addRates',
      body: { rate_card_id: rateCardRef, rates: rates.slice(i, i + RATES_PER_REQUEST) },
    });
  }
  return steps;
}

async function verifyRates(client, rateCardId, rates) {
  if (!rates.length) return [];
  const at = rates.map((r) => r.starting_at).sort()[0];
  const rows = await mx.getRates(client, rateCardId, at);
  const byKey = new Map(rows.map((row) => [rowKey(row), row]));
  return rates.map((r) => {
    const row = byKey.get(rateKey(r));
    const actual = row ? { entitled: row.entitled, rate_type: String(row.rate?.rate_type || '').toUpperCase(), price: row.rate?.price ?? null } : null;
    return rt.check(`rate ${r.product_id}@${r.starting_at}${r.pricing_group_values ? ` ${JSON.stringify(r.pricing_group_values)}` : ''}`,
      { entitled: r.entitled, rate_type: r.rate_type, price: r.price ?? null }, actual);
  });
}

function nameBlocker(cards, name) {
  const same = cards.filter((c) => c.name === name);
  return same.length ? [{ code: 'rate_card_name_exists', name, rate_card_ids: same.map((c) => c.id) }] : [];
}

function aliasBlockers(cards, aliases, now) {
  const out = [];
  for (const a of aliases || []) {
    const holder = cards.find((c) => (c.aliases || []).some((e) => mx.aliasLiveAt(e, a.name, Date.parse(a.starting_at || now.toISOString()))));
    if (holder) out.push({ code: 'rate_card_alias_in_use', alias: a.name, rate_card_id: holder.id, remediation: 'The alias would silently move to the new card. Pass --allow-alias-move if that is intended.' });
  }
  return out;
}

const ratecardCreate = rt.defineOp({
  name: 'ratecard-create',
  command: 'metro ratecard create',
  async preflight(ctx) {
    const spec = rt.loadSpecFile(rt.readString(ctx.flags, 'file'));
    if (!spec.name) throw rt.usageError('Spec needs name (plus optional description, aliases, fiat_credit_type_id, credit_type_conversions, custom_fields, rates[]).');
    const allowed = ['name', 'description', 'aliases', 'fiat_credit_type_id', 'credit_type_conversions', 'custom_fields', 'rates'];
    for (const k of Object.keys(spec)) if (!allowed.includes(k)) throw rt.usageError(`Spec field ${k} is not part of rate-card create (allowed: ${allowed.join(', ')})`);
    const rates = validateRates(spec.rates || []);
    const body = Object.fromEntries(Object.entries(spec).filter(([k]) => k !== 'rates'));
    const cards = await mx.listRateCards(ctx.client);
    const blockers = [...nameBlocker(cards, spec.name)];
    if (!rt.readBool(ctx.flags, 'allow-alias-move')) blockers.push(...aliasBlockers(cards, spec.aliases, ctx.now));
    const types = await productTypes(ctx.client, [...new Set(rates.map((r) => r.product_id))]);
    blockers.push(...productBlockers(rates, types));
    if (blockers.length) throw rt.blocked(blockers);
    return {
      slug: spec.name.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 32),
      summary: { name: spec.name, aliases: spec.aliases || [], rateCount: rates.length, addRatesCalls: Math.ceil(rates.length / RATES_PER_REQUEST), products: types },
      diff: [{ field: 'rate card', from: null, to: { ...body, rates: `${rates.length} rates` } }],
      steps: [
        { id: 'create', method: 'POST', path: '/v1/contract-pricing/rate-cards/create', body },
        ...chunkSteps(rates, '$step:create.data.id'),
      ],
      expect: { body, rates },
    };
  },
  async precheck(ctx, plan) {
    return nameBlocker(await mx.listRateCards(ctx.client), plan.expect.body.name);
  },
  async verify(ctx, plan, results) {
    const id = results.create?.data?.id;
    const card = id ? await mx.getRateCard(ctx.client, id) : null;
    const checks = [
      rt.check('rate_card.name', plan.expect.body.name, card?.name),
      rt.check('rate_card.aliases', (plan.expect.body.aliases || []).map((a) => a.name), (card?.aliases || []).map((a) => a.name), { compare: 'set' }),
    ];
    if (plan.expect.body.description) checks.push(rt.check('rate_card.description', plan.expect.body.description, card?.description));
    return [...checks, ...(id ? await verifyRates(ctx.client, id, plan.expect.rates) : [])];
  },
});

async function duplicateRateBlockers(client, rateCardId, rates) {
  if (!rates.length) return [];
  const at = rates.map((r) => r.starting_at).sort()[0];
  const existing = new Set((await mx.getRates(client, rateCardId, at)).map(rowKey));
  return rates.filter((r) => existing.has(rateKey(r))).map((r) => ({ code: 'rate_already_exists', product_id: r.product_id, starting_at: r.starting_at, pricing_group_values: r.pricing_group_values || null }));
}

const ratecardAddRates = rt.defineOp({
  name: 'ratecard-add-rates',
  command: 'metro ratecard add-rates',
  async preflight(ctx) {
    const rateCardId = rt.readString(ctx.flags, 'rate-card-id');
    if (!rateCardId) throw rt.usageError('Usage: metro ratecard add-rates preflight --rate-card-id=<id> --file=<rates.json|yaml with rates[]> (--sandbox|--prod)');
    const spec = rt.loadSpecFile(rt.readString(ctx.flags, 'file'));
    const rates = validateRates(Array.isArray(spec) ? spec : spec.rates);
    if (!rates.length) throw rt.usageError('No rates in spec.');
    const card = await mx.getRateCard(ctx.client, rateCardId);
    const types = await productTypes(ctx.client, [...new Set(rates.map((r) => r.product_id))]);
    const blockers = [...productBlockers(rates, types), ...(await duplicateRateBlockers(ctx.client, rateCardId, rates))];
    if (blockers.length) throw rt.blocked(blockers);
    return {
      slug: rateCardId.slice(0, 8),
      summary: { rate_card: { id: rateCardId, name: card?.name || null }, rateCount: rates.length, addRatesCalls: Math.ceil(rates.length / RATES_PER_REQUEST) },
      diff: rates.map((r) => ({ field: `rate ${r.product_id}@${r.starting_at}`, from: null, to: { rate_type: r.rate_type, price: r.price ?? null, entitled: r.entitled } })),
      steps: chunkSteps(rates, rateCardId),
      expect: { rate_card_id: rateCardId, rates },
    };
  },
  async precheck(ctx, plan) {
    return duplicateRateBlockers(ctx.client, plan.expect.rate_card_id, plan.expect.rates);
  },
  async verify(ctx, plan) {
    return verifyRates(ctx.client, plan.expect.rate_card_id, plan.expect.rates);
  },
});

module.exports = { ratecardCreate, ratecardAddRates, validateRates, verifyRates, duplicateRateBlockers, RATES_PER_REQUEST, rateKey };
