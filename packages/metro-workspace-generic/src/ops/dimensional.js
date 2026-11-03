'use strict';

/**
 * Dimensional pricing: add one new pricing-dimension value (for example a new
 * action code) to a USAGE product with pricing_group_key across one or more
 * rate cards, as one addRates call per card.
 *   POST /v1/contract-pricing/products/get         https://docs.metronome.com/api-reference/products/get-a-product
 *   POST /v1/contract-pricing/rate-cards/addRates  https://docs.metronome.com/api-reference/rate-cards/add-rates
 *   POST /v1/contract-pricing/rate-cards/getRates  https://docs.metronome.com/api-reference/rate-cards/get-rates
 *
 *   metro dimensional new-code preflight --product-id=<id> --rate-card-ids=a,b
 *     (--group-values='{"action_code":"X"}' | --code=X [--display-name="X label"])
 *     --price=<n> [--credit-type-id=<id>] --starting-at=<UTC hour> (--sandbox|--prod)
 *   metro dimensional new-code apply --file <plan.json> --confirm-hash <sha256:...> (--sandbox|--prod) [--apply ...]
 */

const rt = require('./lib/runtime');
const mx = require('./lib/metronome');
const { validateRates, verifyRates, duplicateRateBlockers } = require('./ratecard');

function groupValuesFor(product, flags) {
  const keys = product?.current?.pricing_group_key || product?.pricing_group_key || [];
  if (!keys.length) throw rt.blocked([{ code: 'product_has_no_pricing_group_key', product_id: product?.id }]);
  let values = rt.readJsonFlag(flags, 'group-values');
  if (!values) {
    const code = rt.readString(flags, 'code');
    if (!code) throw rt.usageError('Pass --group-values=<json> or --code=<value> [--display-name=<label>].');
    values = { [keys[0]]: code };
    if (keys[1]) {
      const display = rt.readString(flags, 'display-name');
      if (!display) throw rt.usageError(`Product groups on ${JSON.stringify(keys)}; pass --display-name for ${keys[1]}.`);
      values[keys[1]] = display;
    }
  }
  const given = Object.keys(values).sort();
  if (JSON.stringify(given) !== JSON.stringify([...keys].sort())) {
    throw rt.usageError(`pricing_group_values keys ${JSON.stringify(given)} must equal the product pricing_group_key ${JSON.stringify(keys)}.`);
  }
  for (const v of Object.values(values)) if (typeof v !== 'string' || !v) throw rt.usageError('pricing group values must be non-empty strings');
  return values;
}

const dimensionalNewCode = rt.defineOp({
  name: 'dimensional-new-code',
  command: 'metro dimensional new-code',
  async preflight(ctx) {
    const f = ctx.flags;
    const productId = rt.readString(f, 'product-id');
    const cards = rt.readList(f, 'rate-card-ids');
    const price = rt.readNumber(f, 'price');
    const startingAt = rt.requireHourBoundary('--starting-at', rt.readString(f, 'starting-at'));
    if (!productId || !cards.length || price === null || !startingAt) {
      throw rt.usageError('Usage: metro dimensional new-code preflight --product-id=<id> --rate-card-ids=<id>[,<id>] (--group-values=<json>|--code=<v> [--display-name=<label>]) --price=<n> [--credit-type-id=<id>] --starting-at=<UTC hour> (--sandbox|--prod)');
    }
    const resp = await ctx.client.post('/v1/contract-pricing/products/get', { id: productId });
    const product = (resp && resp.data) || resp;
    if (product?.type && product.type !== 'USAGE') throw rt.blocked([{ code: 'product_not_usage_type', type: product.type }]);
    const values = groupValuesFor(product, f);
    const creditTypeId = rt.readString(f, 'credit-type-id');
    const rate = { product_id: productId, starting_at: startingAt, entitled: true, rate_type: 'FLAT', price, pricing_group_values: values };
    if (creditTypeId) rate.credit_type_id = creditTypeId;
    const [validated] = validateRates([rate]);
    const blockers = [];
    for (const id of cards) {
      await mx.getRateCard(ctx.client, id);
      for (const b of await duplicateRateBlockers(ctx.client, id, [validated])) blockers.push({ ...b, rate_card_id: id });
    }
    if (blockers.length) throw rt.blocked(blockers);
    return {
      slug: Object.values(values)[0].replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 24),
      summary: { product_id: productId, pricing_group_values: values, rate_cards: cards, price, starting_at: startingAt },
      diff: cards.map((id) => ({ field: `rate card ${id}`, from: null, to: { pricing_group_values: values, price } })),
      steps: cards.map((id, i) => ({ id: `addRates:${i}`, method: 'POST', path: '/v1/contract-pricing/rate-cards/addRates', body: { rate_card_id: id, rates: [validated] } })),
      expect: { cards, rate: validated },
    };
  },
  async precheck(ctx, plan) {
    const out = [];
    for (const id of plan.expect.cards) out.push(...(await duplicateRateBlockers(ctx.client, id, [plan.expect.rate])));
    return out;
  },
  async verify(ctx, plan) {
    const checks = [];
    for (const id of plan.expect.cards) {
      for (const c of await verifyRates(ctx.client, id, [plan.expect.rate])) checks.push({ ...c, check: `${id}: ${c.check}` });
    }
    return checks;
  },
});

/** Entry point used by `metro dimensional new-code preflight|apply`. */
async function runDimensionalNewCode(flags = {}, streams) {
  const argv = flags.argv || [];
  const action = argv[2];
  if (action === 'apply') return dimensionalNewCode.runApply(flags, streams);
  if (action === 'preflight') return dimensionalNewCode.runPreflight(flags, streams);
  streams.stderr.write('Usage: metro dimensional new-code preflight|apply ... (see --help)\n');
  return { exitCode: 1 };
}

module.exports = { dimensionalNewCode, runDimensionalNewCode, groupValuesFor };
