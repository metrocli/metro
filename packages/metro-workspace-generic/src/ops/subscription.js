'use strict';

/**
 * Subscriptions on an existing contract, via POST /v2/contracts/edit
 * (https://docs.metronome.com/api-reference/contracts/edit-a-contract):
 *   subscription add           add_subscriptions[]  (SubscriptionInputV2)
 *   subscription set-quantity  update_subscriptions[].quantity_updates[]
 *   subscription seats         update_subscriptions[].seat_updates
 * Every edit carries a uniqueness_key (1-128 chars, 409 on reuse).
 * Read-back: POST /v2/contracts/get (quantity_schedule) and
 * POST /v1/contracts/getSubscriptionSeatsHistory
 * (https://docs.metronome.com/api-reference/contracts/get-subscription-seats-history).
 * Contract editing must be enabled on the Metronome account.
 */

const rt = require('./lib/runtime');
const mx = require('./lib/metronome');

const FREQUENCIES = ['MONTHLY', 'QUARTERLY', 'SEMI_ANNUAL', 'ANNUAL', 'WEEKLY'];
const upper = (v) => (v == null ? v : String(v).toUpperCase());

async function resolveContract(ctx) {
  const { customer } = await mx.resolveOneCustomer(ctx.client, ctx.flags);
  const contracts = await mx.listContracts(ctx.client, customer.id);
  const picked = mx.selectSingleActiveContract(contracts, { contractId: rt.readString(ctx.flags, 'contract-id'), now: ctx.now, customerId: customer.id });
  const contract = await mx.getContract(ctx.client, customer.id, picked.id);
  return { customer, contract };
}

function quantityAt(sub, at) {
  const t = Date.parse(at);
  const rows = (sub?.quantity_schedule || []).filter((q) => Date.parse(q.starting_at) <= t && (!q.ending_before || Date.parse(q.ending_before) > t));
  rows.sort((a, b) => Date.parse(b.starting_at) - Date.parse(a.starting_at));
  return rows.length ? Number(rows[0].quantity) : null;
}

function findSubscription(contract, subscriptionId) {
  const sub = (contract.subscriptions || []).find((s) => s.id === subscriptionId);
  if (!sub) throw rt.usageError(`Subscription ${subscriptionId} not found on contract ${contract.id} (have: ${(contract.subscriptions || []).map((s) => s.id).join(', ') || 'none'}).`);
  return sub;
}

function editStep(customerId, contractId, edit, keyParts) {
  return {
    id: 'edit',
    method: 'POST',
    path: '/v2/contracts/edit',
    body: { customer_id: customerId, contract_id: contractId, ...edit, uniqueness_key: rt.uniquenessKey('edit', keyParts) },
  };
}

function subscriptionFromFlags(flags) {
  const spec = rt.readString(flags, 'file') ? rt.loadSpecFile(rt.readString(flags, 'file')) : null;
  if (spec) return spec;
  const productId = rt.readString(flags, 'product-id');
  const frequency = upper(rt.readString(flags, 'billing-frequency'));
  if (!productId || !frequency) {
    throw rt.usageError('Usage: metro subscription add preflight (--file=<subscription.json|yaml> | --product-id=<id> --billing-frequency=MONTHLY|... --quantity=<n>) [--collection-schedule=ADVANCE|ARREARS] [--starting-at=<UTC hour>] [--no-proration] [--invoice-behavior=BILL_ON_NEXT_COLLECTION_DATE|BILL_IMMEDIATELY] [--contract-id=] <customer> (--sandbox|--prod)');
  }
  const sub = {
    subscription_rate: { product_id: productId, billing_frequency: frequency },
    collection_schedule: upper(rt.readString(flags, 'collection-schedule')) || 'ADVANCE',
    proration: {
      is_prorated: !rt.readBool(flags, 'no-proration'),
      invoice_behavior: upper(rt.readString(flags, 'invoice-behavior')) || 'BILL_ON_NEXT_COLLECTION_DATE',
    },
    quantity_management_mode: 'QUANTITY_ONLY',
    initial_quantity: rt.readInt(flags, 'quantity'),
  };
  const startingAt = rt.readString(flags, 'starting-at');
  if (startingAt) sub.starting_at = startingAt;
  return sub;
}

function validateSubscriptionInput(sub) {
  for (const k of ['subscription_rate', 'collection_schedule', 'proration']) if (!sub[k]) throw rt.usageError(`subscription.${k} is required`);
  if (!sub.subscription_rate.product_id) throw rt.usageError('subscription_rate.product_id is required');
  if (!FREQUENCIES.includes(upper(sub.subscription_rate.billing_frequency))) throw rt.usageError(`subscription_rate.billing_frequency must be one of ${FREQUENCIES.join(', ')}`);
  if (!['ADVANCE', 'ARREARS'].includes(upper(sub.collection_schedule))) throw rt.usageError('collection_schedule must be ADVANCE or ARREARS');
  if (upper(sub.proration.invoice_behavior) === 'BILL_IMMEDIATELY' && upper(sub.collection_schedule) !== 'ADVANCE') {
    throw rt.usageError('BILL_IMMEDIATELY is only valid with collection_schedule ADVANCE');
  }
  const mode = upper(sub.quantity_management_mode || 'QUANTITY_ONLY');
  if (mode === 'QUANTITY_ONLY' && !(typeof sub.initial_quantity === 'number' && sub.initial_quantity >= 0)) {
    throw rt.usageError('initial_quantity (>= 0) is required for QUANTITY_ONLY (--quantity=<n>)');
  }
  if (mode === 'SEAT_BASED' && (!sub.seat_config?.seat_group_key || !Array.isArray(sub.seat_config?.initial_seat_ids))) {
    throw rt.usageError('seat_config.seat_group_key and seat_config.initial_seat_ids are required for SEAT_BASED');
  }
  const out = { ...sub, subscription_rate: { ...sub.subscription_rate, billing_frequency: upper(sub.subscription_rate.billing_frequency) }, collection_schedule: upper(sub.collection_schedule) };
  if (out.starting_at) out.starting_at = rt.requireHourBoundary('starting_at', out.starting_at);
  if (out.ending_before) out.ending_before = rt.requireHourBoundary('ending_before', out.ending_before);
  return out;
}

const subscriptionAdd = rt.defineOp({
  name: 'subscription-add',
  command: 'metro subscription add',
  async preflight(ctx) {
    const sub = validateSubscriptionInput(subscriptionFromFlags(ctx.flags));
    const { customer, contract } = await resolveContract(ctx);
    const productId = sub.subscription_rate.product_id;
    const frequency = sub.subscription_rate.billing_frequency;
    const at = sub.starting_at || (Date.parse(contract.starting_at) > ctx.now.getTime() ? contract.starting_at : rt.currentHourUtc(ctx.now));
    const blockers = [];

    const productResp = await ctx.client.post('/v1/contract-pricing/products/get', { id: productId });
    const product = (productResp && productResp.data) || productResp;
    if (product?.type && product.type !== 'SUBSCRIPTION') blockers.push({ code: 'product_not_subscription_type', product_id: productId, type: product.type });

    if (!contract.rate_card_id) blockers.push({ code: 'contract_has_no_rate_card' });
    else {
      const rates = await mx.getRates(ctx.client, contract.rate_card_id, at, [{ product_id: productId, billing_frequency: frequency }]);
      if (!rates.some((r) => r.entitled !== false && upper(r.rate?.rate_type) === 'SUBSCRIPTION')) {
        blockers.push({ code: 'no_subscription_rate_on_rate_card', rate_card_id: contract.rate_card_id, product_id: productId, billing_frequency: frequency, remediation: 'Add a SUBSCRIPTION rate with this billing_frequency (metro ratecard add-rates) first.' });
      }
    }
    const same = (contract.subscriptions || []).filter((s) => s.subscription_rate?.product?.id === productId
      && upper(s.subscription_rate?.billing_frequency) === frequency && (!s.ending_before || Date.parse(s.ending_before) > Date.parse(at)));
    if (same.length && !rt.readBool(ctx.flags, 'allow-duplicate')) {
      blockers.push({ code: 'subscription_already_on_contract', subscription_ids: same.map((s) => s.id), remediation: 'Use metro subscription set-quantity, or pass --allow-duplicate.' });
    }
    if (blockers.length) throw rt.blocked(blockers);

    const warnings = [];
    if (upper(sub.proration.invoice_behavior) === 'BILL_IMMEDIATELY') warnings.push({ id: 'MTR-INV-001', message: 'BILL_IMMEDIATELY issues an invoice right away.' });
    return {
      slug: customer.id.slice(0, 8),
      summary: { customer: mx.summarizeCustomer(customer), contract_id: contract.id, rate_card_id: contract.rate_card_id, effective_at: at },
      diff: [{ field: `contract ${contract.id}.subscriptions`, from: (contract.subscriptions || []).length, to: (contract.subscriptions || []).length + 1 }],
      warnings,
      steps: [editStep(customer.id, contract.id, { add_subscriptions: [sub] }, [customer.id, contract.id, 'add', sub])],
      expect: {
        customer_id: customer.id,
        contract_id: contract.id,
        product_id: productId,
        billing_frequency: frequency,
        count_before: same.length,
        quantity: sub.initial_quantity ?? null,
        at,
      },
    };
  },
  async verify(ctx, plan) {
    const e = plan.expect;
    const contract = await mx.getContract(ctx.client, e.customer_id, e.contract_id);
    const matches = (contract?.subscriptions || []).filter((s) => s.subscription_rate?.product?.id === e.product_id
      && upper(s.subscription_rate?.billing_frequency) === e.billing_frequency);
    const checks = [rt.check(`subscriptions for ${e.product_id} ${e.billing_frequency}`, e.count_before + 1, matches.length)];
    if (e.quantity !== null) {
      const newest = matches.sort((a, b) => Date.parse(b.created_at || 0) - Date.parse(a.created_at || 0))[0];
      checks.push(rt.check(`quantity at ${e.at}`, e.quantity, quantityAt(newest, e.at), { compare: 'number' }));
    }
    return checks;
  },
});

const subscriptionSetQuantity = rt.defineOp({
  name: 'subscription-set-quantity',
  command: 'metro subscription set-quantity',
  async preflight(ctx) {
    const subscriptionId = rt.readString(ctx.flags, 'subscription-id');
    const quantity = rt.readInt(ctx.flags, 'quantity');
    const delta = rt.readInt(ctx.flags, 'delta', { allowNegative: true });
    const startingAt = rt.requireHourBoundary('--starting-at', rt.readString(ctx.flags, 'starting-at'));
    if (!subscriptionId || !startingAt || (quantity === null) === (delta === null)) {
      throw rt.usageError('Usage: metro subscription set-quantity preflight --subscription-id=<id> (--quantity=<n>|--delta=<+/-n>) --starting-at=<UTC hour> [--contract-id=] <customer> (--sandbox|--prod)');
    }
    const { customer, contract } = await resolveContract(ctx);
    const sub = findSubscription(contract, subscriptionId);
    if (upper(sub.quantity_management_mode) === 'SEAT_BASED') {
      throw rt.blocked([{ code: 'subscription_is_seat_based', remediation: 'Use metro subscription seats.' }]);
    }
    const current = quantityAt(sub, startingAt);
    if (current === null && delta !== null) throw rt.usageError(`No quantity is scheduled at ${startingAt}; pass --quantity instead of --delta.`);
    // Always send an absolute quantity so the write is exactly what was previewed.
    const target = quantity !== null ? quantity : current + delta;
    if (target < 0) throw rt.usageError(`Resulting quantity would be negative (${current} + ${delta}).`);
    if (target === current) throw rt.usageError(`Quantity at ${startingAt} is already ${current}. Nothing to change.`);
    return {
      slug: customer.id.slice(0, 8),
      summary: { customer: mx.summarizeCustomer(customer), contract_id: contract.id, subscription_id: subscriptionId, product_id: sub.subscription_rate?.product?.id || null },
      diff: [{ field: `subscription ${subscriptionId} quantity @ ${startingAt}`, from: current, to: target }],
      steps: [editStep(customer.id, contract.id, {
        update_subscriptions: [{ subscription_id: subscriptionId, quantity_updates: [{ starting_at: startingAt, quantity: target }] }],
      }, [customer.id, contract.id, subscriptionId, startingAt, target])],
      expect: { customer_id: customer.id, contract_id: contract.id, subscription_id: subscriptionId, starting_at: startingAt, quantity: target },
    };
  },
  async verify(ctx, plan) {
    const e = plan.expect;
    const contract = await mx.getContract(ctx.client, e.customer_id, e.contract_id);
    const sub = (contract?.subscriptions || []).find((s) => s.id === e.subscription_id);
    return [rt.check(`quantity at ${e.starting_at}`, e.quantity, quantityAt(sub, e.starting_at), { compare: 'number' })];
  },
});

async function seatsAt(client, customerId, contractId, subscriptionId, at) {
  const resp = await client.post('/v1/contracts/getSubscriptionSeatsHistory', {
    customer_id: customerId, contract_id: contractId, subscription_id: subscriptionId, covering_date: at, limit: 10,
  });
  const rows = (resp && resp.data) || [];
  return rows.find((r) => Date.parse(r.starting_at) <= Date.parse(at) && (!r.ending_before || Date.parse(r.ending_before) > Date.parse(at))) || rows[0] || null;
}

const subscriptionSeats = rt.defineOp({
  name: 'subscription-seats',
  command: 'metro subscription seats',
  async preflight(ctx) {
    const f = ctx.flags;
    const subscriptionId = rt.readString(f, 'subscription-id');
    const startingAt = rt.requireHourBoundary('--starting-at', rt.readString(f, 'starting-at'));
    const addIds = rt.readList(f, 'add-seat-ids');
    const removeIds = rt.readList(f, 'remove-seat-ids');
    const addUnassigned = rt.readInt(f, 'add-unassigned', { min: 1 });
    const removeUnassigned = rt.readInt(f, 'remove-unassigned', { min: 1 });
    if (!subscriptionId || !startingAt || !(addIds.length || removeIds.length || addUnassigned || removeUnassigned)) {
      throw rt.usageError('Usage: metro subscription seats preflight --subscription-id=<id> --starting-at=<UTC hour> [--add-seat-ids=a,b] [--remove-seat-ids=c] [--add-unassigned=<n>] [--remove-unassigned=<n>] [--contract-id=] <customer> (--sandbox|--prod)');
    }
    const overlap = addIds.filter((id) => removeIds.includes(id));
    if (overlap.length) throw rt.usageError(`Seat ids both added and removed: ${overlap.join(', ')}`);
    const { customer, contract } = await resolveContract(ctx);
    const sub = findSubscription(contract, subscriptionId);
    if (upper(sub.quantity_management_mode) !== 'SEAT_BASED') {
      throw rt.blocked([{ code: 'subscription_not_seat_based', remediation: 'Use metro subscription set-quantity.' }]);
    }
    const now = await seatsAt(ctx.client, customer.id, contract.id, subscriptionId, startingAt);
    const assigned = new Set(now?.assigned_seat_ids || []);
    const total = Number(now?.total_quantity ?? assigned.size);
    const unassigned = Math.max(0, total - assigned.size);
    const blockers = [];
    const alreadyAssigned = addIds.filter((id) => assigned.has(id));
    if (alreadyAssigned.length) blockers.push({ code: 'seat_ids_already_assigned', seat_ids: alreadyAssigned });
    const notAssigned = removeIds.filter((id) => !assigned.has(id));
    if (notAssigned.length) blockers.push({ code: 'seat_ids_not_assigned', seat_ids: notAssigned, note: 'Metronome treats these as a no-op; metro refuses so the plan matches reality.' });
    if (removeUnassigned && removeUnassigned > unassigned) blockers.push({ code: 'not_enough_unassigned_seats', requested: removeUnassigned, unassigned });
    if (blockers.length) throw rt.blocked(blockers);

    const seatUpdates = {};
    if (addIds.length) seatUpdates.add_seat_ids = [{ seat_ids: addIds, starting_at: startingAt }];
    if (removeIds.length) seatUpdates.remove_seat_ids = [{ seat_ids: removeIds, starting_at: startingAt }];
    if (addUnassigned) seatUpdates.add_unassigned_seats = [{ quantity: addUnassigned, starting_at: startingAt }];
    if (removeUnassigned) seatUpdates.remove_unassigned_seats = [{ quantity: removeUnassigned, starting_at: startingAt }];
    const expectedAssigned = [...[...assigned].filter((id) => !removeIds.includes(id)), ...addIds].sort();
    // Total is asserted only for unassigned-only changes; seat-id adds fill unassigned seats first.
    const expectedTotal = (addIds.length || removeIds.length) ? null : total + (addUnassigned || 0) - (removeUnassigned || 0);
    return {
      slug: customer.id.slice(0, 8),
      summary: { customer: mx.summarizeCustomer(customer), contract_id: contract.id, subscription_id: subscriptionId, seat_group_key: sub.seat_config?.seat_group_key || null },
      diff: [
        { field: `assigned seats @ ${startingAt}`, from: [...assigned].sort(), to: expectedAssigned },
        { field: `total seats @ ${startingAt}`, from: total, to: expectedTotal ?? '(computed by Metronome)' },
      ],
      steps: [editStep(customer.id, contract.id, { update_subscriptions: [{ subscription_id: subscriptionId, seat_updates: seatUpdates }] }, [customer.id, contract.id, subscriptionId, startingAt, seatUpdates])],
      expect: { customer_id: customer.id, contract_id: contract.id, subscription_id: subscriptionId, starting_at: startingAt, assigned: expectedAssigned, total: expectedTotal },
    };
  },
  async verify(ctx, plan) {
    const e = plan.expect;
    const row = await seatsAt(ctx.client, e.customer_id, e.contract_id, e.subscription_id, e.starting_at);
    const checks = [rt.check(`assigned seats at ${e.starting_at}`, e.assigned, row?.assigned_seat_ids || [], { compare: 'set' })];
    if (e.total !== null) checks.push(rt.check(`total seats at ${e.starting_at}`, e.total, row?.total_quantity, { compare: 'number' }));
    return checks;
  },
});

module.exports = { subscriptionAdd, subscriptionSetQuantity, subscriptionSeats, quantityAt, validateSubscriptionInput };
