'use strict';

// Every generic write op, fully mocked (fake-metronome; no network):
// preflight golden, hash stability, hash/tenant/token refusals, successful
// apply with read-back, and read-back mismatch exiting 3.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { FakeMetronome, testEnv, runOp } = require('./helpers/fake-metronome');
const { IDS, seed } = require('./fixtures-tenant');
const { ops } = require('../src/ops');
const rt = require('../src/ops/lib/runtime');

const SANDBOX_TOKEN = `--confirm-live-apply=${rt.SANDBOX_APPLY_TOKEN}`;
const PROD_TOKEN = `--confirm-prod-apply=${rt.PROD_APPLY_TOKEN}`;

function strip(value) {
  if (Array.isArray(value)) return value.map(strip);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => {
      if (k === 'uniqueness_key') {
        assert.ok(typeof v === 'string' && v.length >= 1 && v.length <= 128, `uniqueness_key length ${v && v.length}`);
        return [k, '<uniqueness_key>'];
      }
      return [k, strip(v)];
    }));
  }
  return value;
}

function writeSpec(env, name, body) {
  const p = path.join(env.home, name);
  fs.writeFileSync(p, typeof body === "string" ? body : JSON.stringify(body, null, 2));
  return p;
}

// ------------------------------------------------------------ scenarios

const SCENARIOS = [
  {
    name: 'customer-create',
    op: 'customer-create',
    args: () => ['--name=Initech', '--ingest-alias=initech,initech-eu', '--external-id=initech-ext-9', '--stripe-customer-id=cus_initech', '--stripe-collection-method=charge_automatically'],
    mutate: () => ['--name=Initech LLC', '--ingest-alias=initech,initech-eu', '--external-id=initech-ext-9', '--stripe-customer-id=cus_initech', '--stripe-collection-method=charge_automatically'],
    golden: [{
      id: 'create',
      method: 'POST',
      path: '/v1/customers',
      body: {
        name: 'Initech',
        ingest_aliases: ['initech', 'initech-eu'],
        custom_fields: { external_id: 'initech-ext-9' },
        customer_billing_provider_configurations: [{
          billing_provider: 'stripe',
          delivery_method: 'direct_to_billing_provider',
          configuration: { stripe_customer_id: 'cus_initech', stripe_collection_method: 'charge_automatically' },
        }],
      },
    }],
  },
  {
    name: 'ratecard-create',
    op: 'ratecard-create',
    args: (env) => [`--file=${writeSpec(env, 'rc.json', {
      name: 'Acme Enterprise',
      aliases: [{ name: 'acme_enterprise' }],
      rates: [{ product_id: IDS.subProduct, starting_at: '2030-01-01T00:00:00.000Z', entitled: true, rate_type: 'SUBSCRIPTION', price: 9000, billing_frequency: 'MONTHLY' }],
    })}`],
    mutate: (env) => [`--file=${writeSpec(env, 'rc2.json', {
      name: 'Acme Enterprise',
      aliases: [{ name: 'acme_enterprise' }],
      rates: [{ product_id: IDS.subProduct, starting_at: '2030-01-01T00:00:00.000Z', entitled: true, rate_type: 'SUBSCRIPTION', price: 9500, billing_frequency: 'MONTHLY' }],
    })}`],
    golden: [
      { id: 'create', method: 'POST', path: '/v1/contract-pricing/rate-cards/create', body: { name: 'Acme Enterprise', aliases: [{ name: 'acme_enterprise' }] } },
      {
        id: 'addRates:0',
        method: 'POST',
        path: '/v1/contract-pricing/rate-cards/addRates',
        body: { rate_card_id: '$step:create.data.id', rates: [{ product_id: IDS.subProduct, starting_at: '2030-01-01T00:00:00.000Z', entitled: true, rate_type: 'SUBSCRIPTION', price: 9000, billing_frequency: 'MONTHLY' }] },
      },
    ],
  },
  {
    name: 'ratecard-add-rates',
    op: 'ratecard-add-rates',
    args: (env) => [`--rate-card-id=${IDS.rateCard}`, `--file=${writeSpec(env, 'rates.json', { rates: [{ product_id: IDS.subProduct, starting_at: '2030-01-01T00:00:00.000Z', entitled: true, rate_type: 'SUBSCRIPTION', price: 6000, billing_frequency: 'MONTHLY' }] })}`],
    mutate: (env) => [`--rate-card-id=${IDS.rateCard}`, `--file=${writeSpec(env, 'rates2.json', { rates: [{ product_id: IDS.subProduct, starting_at: '2030-02-01T00:00:00.000Z', entitled: true, rate_type: 'SUBSCRIPTION', price: 6000, billing_frequency: 'MONTHLY' }] })}`],
    golden: [{
      id: 'addRates:0',
      method: 'POST',
      path: '/v1/contract-pricing/rate-cards/addRates',
      body: { rate_card_id: IDS.rateCard, rates: [{ product_id: IDS.subProduct, starting_at: '2030-01-01T00:00:00.000Z', entitled: true, rate_type: 'SUBSCRIPTION', price: 6000, billing_frequency: 'MONTHLY' }] },
    }],
  },
  {
    name: 'package-create',
    op: 'package-create',
    args: (env) => [`--file=${writeSpec(env, 'pkg.yaml', 'name: Scale\nrate_card_id: ' + IDS.rateCard + '\naliases:\n  - name: scale\n    starting_at: 2030-01-01T00:00:00.000Z\nbilling_provider: stripe\ndelivery_method: direct_to_billing_provider\nusage_statement_schedule:\n  frequency: MONTHLY\n  day: CONTRACT_START\nduration:\n  value: 12\n  unit: MONTHS\n')}`],
    mutate: (env) => [`--file=${writeSpec(env, 'pkg2.yaml', 'name: Scale\nrate_card_id: ' + IDS.rateCard + '\naliases:\n  - name: scale\n    starting_at: 2030-01-01T00:00:00.000Z\nbilling_provider: stripe\ndelivery_method: direct_to_billing_provider\nusage_statement_schedule:\n  frequency: MONTHLY\n  day: FIRST_OF_MONTH\nduration:\n  value: 12\n  unit: MONTHS\n')}`],
    golden: [{
      id: 'create',
      method: 'POST',
      path: '/v1/packages/create',
      body: {
        name: 'Scale',
        rate_card_id: IDS.rateCard,
        aliases: [{ name: 'scale', starting_at: '2030-01-01T00:00:00.000Z' }],
        billing_provider: 'stripe',
        delivery_method: 'direct_to_billing_provider',
        usage_statement_schedule: { frequency: 'MONTHLY', day: 'CONTRACT_START' },
        duration: { value: 12, unit: 'MONTHS' },
        uniqueness_key: '<uniqueness_key>',
      },
    }],
  },
  {
    name: 'contract-create (package)',
    op: 'contract-create',
    args: () => [`--customer-id=${IDS.globex}`, '--package-alias=growth', '--starting-at=2030-01-01T00:00:00.000Z'],
    mutate: () => [`--customer-id=${IDS.globex}`, '--package-alias=growth', '--starting-at=2030-02-01T00:00:00.000Z'],
    golden: [{
      id: 'create',
      method: 'POST',
      path: '/v1/contracts/create',
      body: { customer_id: IDS.globex, starting_at: '2030-01-01T00:00:00.000Z', package_id: IDS.growth, uniqueness_key: '<uniqueness_key>' },
    }],
  },
  {
    name: 'contract-create (direct)',
    op: 'contract-create',
    args: (env) => [`--customer-id=${IDS.globex}`, `--file=${writeSpec(env, 'direct.json', {
      starting_at: '2030-01-01T00:00:00.000Z',
      rate_card_id: IDS.rateCard,
      subscriptions: [{
        subscription_rate: { product_id: IDS.subProduct, billing_frequency: 'MONTHLY' },
        collection_schedule: 'ADVANCE',
        proration: { is_prorated: true, invoice_behavior: 'BILL_ON_NEXT_COLLECTION_DATE' },
        initial_quantity: 4,
      }],
    })}`],
    mutate: (env) => [`--customer-id=${IDS.globex}`, `--file=${writeSpec(env, 'direct2.json', {
      starting_at: '2030-01-01T00:00:00.000Z',
      rate_card_id: IDS.rateCard,
      subscriptions: [{
        subscription_rate: { product_id: IDS.subProduct, billing_frequency: 'MONTHLY' },
        collection_schedule: 'ADVANCE',
        proration: { is_prorated: true, invoice_behavior: 'BILL_ON_NEXT_COLLECTION_DATE' },
        initial_quantity: 5,
      }],
    })}`],
    golden: [{
      id: 'create',
      method: 'POST',
      path: '/v1/contracts/create',
      body: {
        starting_at: '2030-01-01T00:00:00.000Z',
        rate_card_id: IDS.rateCard,
        subscriptions: [{
          subscription_rate: { product_id: IDS.subProduct, billing_frequency: 'MONTHLY' },
          collection_schedule: 'ADVANCE',
          proration: { is_prorated: true, invoice_behavior: 'BILL_ON_NEXT_COLLECTION_DATE' },
          initial_quantity: 4,
        }],
        customer_id: IDS.globex,
        uniqueness_key: '<uniqueness_key>',
      },
    }],
  },
  {
    name: 'subscription-add',
    op: 'subscription-add',
    args: () => [`--customer-id=${IDS.globex}`, `--product-id=${IDS.subProduct}`, '--billing-frequency=MONTHLY', '--quantity=3', '--starting-at=2029-01-01T00:00:00.000Z'],
    mutate: () => [`--customer-id=${IDS.globex}`, `--product-id=${IDS.subProduct}`, '--billing-frequency=MONTHLY', '--quantity=4', '--starting-at=2029-01-01T00:00:00.000Z'],
    golden: [{
      id: 'edit',
      method: 'POST',
      path: '/v2/contracts/edit',
      body: {
        customer_id: IDS.globex,
        contract_id: IDS.trialContract,
        add_subscriptions: [{
          subscription_rate: { product_id: IDS.subProduct, billing_frequency: 'MONTHLY' },
          collection_schedule: 'ADVANCE',
          proration: { is_prorated: true, invoice_behavior: 'BILL_ON_NEXT_COLLECTION_DATE' },
          quantity_management_mode: 'QUANTITY_ONLY',
          initial_quantity: 3,
          starting_at: '2029-01-01T00:00:00.000Z',
        }],
        uniqueness_key: '<uniqueness_key>',
      },
    }],
  },
  {
    name: 'subscription-set-quantity',
    op: 'subscription-set-quantity',
    args: () => [`--customer-id=${IDS.acme}`, `--subscription-id=${IDS.qtySub}`, '--delta=+2'.replace('+', ''), '--starting-at=2030-01-01T00:00:00.000Z'],
    mutate: () => [`--customer-id=${IDS.acme}`, `--subscription-id=${IDS.qtySub}`, '--quantity=9', '--starting-at=2030-01-01T00:00:00.000Z'],
    golden: [{
      id: 'edit',
      method: 'POST',
      path: '/v2/contracts/edit',
      body: {
        customer_id: IDS.acme,
        contract_id: IDS.contract,
        update_subscriptions: [{ subscription_id: IDS.qtySub, quantity_updates: [{ starting_at: '2030-01-01T00:00:00.000Z', quantity: 7 }] }],
        uniqueness_key: '<uniqueness_key>',
      },
    }],
  },
  {
    name: 'subscription-seats',
    op: 'subscription-seats',
    args: () => [`--customer-id=${IDS.acme}`, `--subscription-id=${IDS.seatSub}`, '--add-seat-ids=u3', '--remove-seat-ids=u1', '--starting-at=2030-01-01T00:00:00.000Z'],
    mutate: () => [`--customer-id=${IDS.acme}`, `--subscription-id=${IDS.seatSub}`, '--add-seat-ids=u4', '--remove-seat-ids=u1', '--starting-at=2030-01-01T00:00:00.000Z'],
    golden: [{
      id: 'edit',
      method: 'POST',
      path: '/v2/contracts/edit',
      body: {
        customer_id: IDS.acme,
        contract_id: IDS.contract,
        update_subscriptions: [{
          subscription_id: IDS.seatSub,
          seat_updates: {
            add_seat_ids: [{ seat_ids: ['u3'], starting_at: '2030-01-01T00:00:00.000Z' }],
            remove_seat_ids: [{ seat_ids: ['u1'], starting_at: '2030-01-01T00:00:00.000Z' }],
          },
        }],
        uniqueness_key: '<uniqueness_key>',
      },
    }],
  },
  {
    name: 'contract-expire',
    op: 'contract-expire',
    args: () => [`--customer-id=${IDS.acme}`, '--ending-before=2030-01-01T00:00:00.000Z'],
    mutate: () => [`--customer-id=${IDS.acme}`, '--ending-before=2030-01-01T01:00:00.000Z'],
    golden: [{
      id: 'updateEndDate',
      method: 'POST',
      path: '/v1/contracts/updateEndDate',
      body: { customer_id: IDS.acme, contract_id: IDS.contract, ending_before: '2030-01-01T00:00:00.000Z', allow_ending_before_finalized_invoice: false },
    }],
  },
  {
    name: 'contract-extend-trial',
    op: 'contract-extend-trial',
    args: () => [`--customer-id=${IDS.globex}`, '--extend-by-days=14'],
    mutate: () => [`--customer-id=${IDS.globex}`, '--extend-by-days=15'],
    golden: [{
      id: 'updateEndDate',
      method: 'POST',
      path: '/v1/contracts/updateEndDate',
      body: { customer_id: IDS.globex, contract_id: IDS.trialContract, ending_before: '2030-01-15T00:00:00.000Z', allow_ending_before_finalized_invoice: false },
    }],
  },
  {
    name: 'contract-move-plan',
    op: 'contract-move-plan',
    args: () => [`--customer-id=${IDS.acme}`, '--to=growth', '--from=starter', '--cutover=2030-02-01T00:00:00.000Z'],
    mutate: () => [`--customer-id=${IDS.acme}`, '--to=growth', '--cutover=2030-03-01T00:00:00.000Z'],
    golden: [
      {
        id: 'updateEndDate',
        method: 'POST',
        path: '/v1/contracts/updateEndDate',
        body: { customer_id: IDS.acme, contract_id: IDS.contract, ending_before: '2030-02-01T00:00:00.000Z', allow_ending_before_finalized_invoice: false },
      },
      {
        id: 'createSuccessor',
        method: 'POST',
        path: '/v1/contracts/create',
        body: { customer_id: IDS.acme, starting_at: '2030-02-01T00:00:00.000Z', package_id: IDS.growth, uniqueness_key: '<uniqueness_key>', transition: { type: 'RENEWAL', from_contract_id: IDS.contract } },
      },
    ],
  },
  {
    name: 'contract-repair-accidental',
    op: 'contract-repair-accidental',
    prepare: (fake) => {
      fake.contracts.push({ id: '00000000-0000-4000-8000-000000000044', customer_id: IDS.acme, starting_at: '2026-06-01T00:00:00.000Z', ending_before: null, commits: [], credits: [], subscriptions: [] });
    },
    args: () => [`--customer-id=${IDS.acme}`, '--archive-contract-id=00000000-0000-4000-8000-000000000044', `--keep-contract-id=${IDS.contract}`, '--reason=Created twice by a retry', '--restore-ending-before=2031-01-01T00:00:00.000Z'],
    mutate: () => [`--customer-id=${IDS.acme}`, '--archive-contract-id=00000000-0000-4000-8000-000000000044', `--keep-contract-id=${IDS.contract}`, '--reason=Created twice by a retry'],
    golden: [
      { id: 'archive', method: 'POST', path: '/v1/contracts/archive', body: { customer_id: IDS.acme, contract_id: '00000000-0000-4000-8000-000000000044', void_invoices: true } },
      { id: 'restoreEndDate', method: 'POST', path: '/v1/contracts/updateEndDate', body: { customer_id: IDS.acme, contract_id: IDS.contract, ending_before: '2031-01-01T00:00:00.000Z', allow_ending_before_finalized_invoice: false } },
    ],
  },
  {
    name: 'ledger-adjustment (partial)',
    op: 'ledger-adjustment',
    args: () => [`--customer-id=${IDS.acme}`, '--amount=-200', '--reason=Usage credit correction', `--balance-id=${IDS.balance}`],
    mutate: () => [`--customer-id=${IDS.acme}`, '--amount=-250', '--reason=Usage credit correction', `--balance-id=${IDS.balance}`],
    golden: [{
      id: 'ledgerEntry',
      method: 'POST',
      path: '/v1/contracts/addManualBalanceLedgerEntry',
      body: { customer_id: IDS.acme, contract_id: IDS.contract, id: IDS.balance, segment_id: IDS.segment, amount: -200, reason: 'Usage credit correction', uniqueness_key: '<uniqueness_key>' },
    }],
  },
  {
    name: 'ledger-adjustment (grant)',
    op: 'ledger-adjustment',
    args: () => [`--customer-id=${IDS.acme}`, '--grant=credit', '--amount=500', `--product-id=${IDS.creditProduct}`, `--credit-type-id=${IDS.creditType}`, '--starting-at=2030-01-01T00:00:00.000Z', '--ending-before=2031-01-01T00:00:00.000Z', '--reason=Goodwill'],
    mutate: () => [`--customer-id=${IDS.acme}`, '--grant=credit', '--amount=600', `--product-id=${IDS.creditProduct}`, `--credit-type-id=${IDS.creditType}`, '--starting-at=2030-01-01T00:00:00.000Z', '--ending-before=2031-01-01T00:00:00.000Z', '--reason=Goodwill'],
    golden: [{
      id: 'grant',
      method: 'POST',
      path: '/v2/contracts/edit',
      body: {
        customer_id: IDS.acme,
        contract_id: IDS.contract,
        add_credits: [{ product_id: IDS.creditProduct, name: 'metro credit grant', access_schedule: { credit_type_id: IDS.creditType, schedule_items: [{ amount: 500, starting_at: '2030-01-01T00:00:00.000Z', ending_before: '2031-01-01T00:00:00.000Z' }] } }],
        uniqueness_key: '<uniqueness_key>',
      },
    }],
  },
  {
    name: 'billing-provider-cutover (Stripe remap)',
    op: 'billing-provider-cutover',
    args: () => [`--customer-id=${IDS.acme}`, '--collection-method=charge_automatically', '--stripe-customer-id=cus_right', '--reason=Card is on the other Stripe customer'],
    mutate: () => [`--customer-id=${IDS.acme}`, '--collection-method=send_invoice', '--stripe-customer-id=cus_right', '--reason=Card is on the other Stripe customer'],
    golden: [
      { id: 'archive', method: 'POST', path: '/v1/archiveCustomerBillingProviderConfigurations', body: { customer_id: IDS.acme, customer_billing_provider_configuration_ids: [IDS.billingConfig] } },
      {
        id: 'set',
        method: 'POST',
        path: '/v1/setCustomerBillingProviderConfigurations',
        body: { data: [{ customer_id: IDS.acme, billing_provider: 'stripe', configuration: { stripe_customer_id: 'cus_right', stripe_collection_method: 'charge_automatically' }, delivery_method_id: IDS.deliveryMethod }] },
      },
    ],
  },
  {
    name: 'package-clone-version',
    op: 'package-clone-version',
    args: () => ['--aliases=starter', '--handoff-at=2030-01-01T00:00:00.000Z', '--usage-day=CONTRACT_START'],
    mutate: () => ['--aliases=starter', '--handoff-at=2030-02-01T00:00:00.000Z', '--usage-day=CONTRACT_START'],
    golden: [{
      id: 'create:starter',
      method: 'POST',
      path: '/v1/packages/create',
      body: {
        name: 'Starter',
        uniqueness_key: '<uniqueness_key>',
        aliases: [{ name: 'starter', starting_at: '2030-01-01T00:00:00.000Z' }],
        rate_card_id: IDS.rateCard,
        billing_provider: 'stripe',
        delivery_method: 'direct_to_billing_provider',
        scheduled_charges_on_usage_invoices: 'ALL',
        usage_statement_schedule: { frequency: 'MONTHLY', day: 'CONTRACT_START' },
        subscriptions: [{
          name: 'Seats',
          subscription_rate: { billing_frequency: 'MONTHLY', product_id: IDS.subProduct },
          collection_schedule: 'ADVANCE',
          proration: { is_prorated: true, invoice_behavior: 'BILL_ON_NEXT_COLLECTION_DATE' },
          initial_quantity: 1,
          starting_at_offset: { value: 0, unit: 'DAYS' },
        }],
        recurring_credits: [{
          name: 'Monthly credits',
          access_amount: { credit_type_id: IDS.creditType, unit_price: 1, quantity: 100 },
          priority: 1,
          commit_duration: { value: 1, unit: 'MONTHS' },
          starting_at_offset: { value: 0, unit: 'DAYS' },
          recurrence_frequency: 'MONTHLY',
          product_id: IDS.creditProduct,
        }],
      },
    }],
  },
  {
    name: 'dimensional-new-code',
    op: 'dimensional-new-code',
    args: () => [`--product-id=${IDS.usageProduct}`, `--rate-card-ids=${IDS.rateCard}`, '--code=IMPORT', '--display-name=Import', '--price=3', '--starting-at=2030-01-01T00:00:00.000Z'],
    mutate: () => [`--product-id=${IDS.usageProduct}`, `--rate-card-ids=${IDS.rateCard}`, '--code=IMPORT', '--display-name=Import', '--price=4', '--starting-at=2030-01-01T00:00:00.000Z'],
    golden: [{
      id: 'addRates:0',
      method: 'POST',
      path: '/v1/contract-pricing/rate-cards/addRates',
      body: { rate_card_id: IDS.rateCard, rates: [{ product_id: IDS.usageProduct, starting_at: '2030-01-01T00:00:00.000Z', entitled: true, rate_type: 'FLAT', price: 3, pricing_group_values: { action_code: 'IMPORT', action_display_name: 'Import' } }] },
    }],
  },
];

function opRunner(name) {
  const m = ops[name]();
  if (name === 'dimensional-new-code') return m.dimensionalNewCode;
  return m;
}

function setup(s) {
  const env = testEnv();
  const fake = new FakeMetronome(seed()).install();
  if (s.prepare) s.prepare(fake);
  return { env, fake, done: () => { fake.uninstall(); env.restore(); } };
}

async function preflight(s, env, tenantFlag = '--sandbox', argsFn = s.args, outName = 'plan.json') {
  const out = path.join(env.home, outName);
  const r = await runOp(opRunner(s.op).runPreflight, [...argsFn(env), tenantFlag, `--out=${out}`, '--json']);
  return { ...r, planPath: out };
}

function apply(s, planPath, extra) {
  return runOp(opRunner(s.op).runApply, [`--file=${planPath}`, '--json', ...extra]);
}

for (const s of SCENARIOS) {
  test(`${s.name}: preflight golden is read-only`, async () => {
    const { env, fake, done } = setup(s);
    try {
      const r = await preflight(s, env);
      assert.equal(r.exitCode, 0, r.stdout + r.stderr);
      assert.deepEqual(strip(r.json.steps), s.golden);
      assert.equal(r.json.tenant, 'sandbox');
      assert.match(r.json.payloadHash, /^sha256:[0-9a-f]{64}$/);
      assert.equal(fake.writes.length, 0, 'preflight must not write');
      assert.deepEqual(JSON.parse(fs.readFileSync(r.planPath, 'utf8')).steps, r.json.steps);
    } finally { done(); }
  });

  test(`${s.name}: hash is stable and changes with one field`, async () => {
    const { env, done } = setup(s);
    try {
      const a = await preflight(s, env, '--sandbox', s.args, 'a.json');
      const b = await preflight(s, env, '--sandbox', s.args, 'b.json');
      const c = await preflight(s, env, '--sandbox', s.mutate, 'c.json');
      assert.equal(c.exitCode, 0, c.stdout + c.stderr);
      assert.equal(a.json.payloadHash, b.json.payloadHash);
      assert.notEqual(a.json.payloadHash, c.json.payloadHash);
      const p = await preflight(s, env, '--prod', s.args, 'p.json');
      assert.notEqual(a.json.payloadHash, p.json.payloadHash, 'tenant is part of the hash');
    } finally { done(); }
  });

  test(`${s.name}: apply refuses without, or with a wrong, confirm hash`, async () => {
    const { env, fake, done } = setup(s);
    try {
      const { planPath } = await preflight(s, env);
      const none = await apply(s, planPath, ['--sandbox', '--apply', SANDBOX_TOKEN]);
      assert.equal(none.exitCode, 2);
      assert.equal(none.json.code, 'MTR-HASH-001');
      const wrong = await apply(s, planPath, ['--sandbox', '--apply', SANDBOX_TOKEN, `--confirm-hash=sha256:${'0'.repeat(64)}`]);
      assert.equal(wrong.exitCode, 2);
      assert.equal(wrong.json.code, 'MTR-HASH-002');
      assert.equal(fake.writes.length, 0);
    } finally { done(); }
  });

  test(`${s.name}: dry run writes nothing; --apply needs the sandbox token`, async () => {
    const { env, fake, done } = setup(s);
    try {
      const pf = await preflight(s, env);
      const hash = `--confirm-hash=${pf.json.payloadHash}`;
      const dry = await apply(s, pf.planPath, ['--sandbox', hash]);
      assert.equal(dry.exitCode, 0, dry.stdout);
      assert.equal(dry.json.mode, 'dry_run');
      const noToken = await apply(s, pf.planPath, ['--sandbox', hash, '--apply']);
      assert.equal(noToken.exitCode, 2);
      assert.equal(noToken.json.code, 'MTR-LIVE-APPLY-001');
      assert.equal(fake.writes.length, 0);
    } finally { done(); }
  });

  test(`${s.name}: apply writes exactly the plan and read-back passes`, async () => {
    const { env, fake, done } = setup(s);
    try {
      const pf = await preflight(s, env);
      const r = await apply(s, pf.planPath, ['--sandbox', `--confirm-hash=${pf.json.payloadHash}`, '--apply', SANDBOX_TOKEN]);
      assert.equal(r.exitCode, 0, JSON.stringify(r.json, null, 2));
      assert.ok(r.json.checks.length > 0);
      assert.ok(r.json.checks.every((c) => c.ok), JSON.stringify(r.json.checks, null, 2));
      assert.deepEqual(fake.writes.map((w) => `${w.method} ${w.path}`), pf.json.steps.map((st) => `${st.method} ${st.path}`));
      assert.ok(fs.existsSync(r.json.logPath));
    } finally { done(); }
  });

  test(`${s.name}: read-back mismatch exits 3`, async () => {
    const { env, fake, done } = setup(s);
    try {
      const pf = await preflight(s, env);
      fake.dropWrites = true;
      const r = await apply(s, pf.planPath, ['--sandbox', `--confirm-hash=${pf.json.payloadHash}`, '--apply', SANDBOX_TOKEN]);
      assert.equal(r.exitCode, 3, JSON.stringify(r.json, null, 2));
      assert.equal(r.json.ok, false);
      assert.ok(r.json.checks.some((c) => !c.ok));
    } finally { done(); }
  });

  test(`${s.name}: production needs --prod plus its own token`, async () => {
    const { env, fake, done } = setup(s);
    try {
      const noTenant = await runOp(opRunner(s.op).runPreflight, [...s.args(env), '--json']);
      assert.equal(noTenant.exitCode, 2);
      assert.equal(noTenant.json.code, 'MTR-TENANT-001');
      const pf = await preflight(s, env, '--prod');
      assert.equal(pf.exitCode, 0, pf.stdout);
      const hash = `--confirm-hash=${pf.json.payloadHash}`;
      const asSandbox = await apply(s, pf.planPath, ['--sandbox', hash, '--apply', SANDBOX_TOKEN]);
      assert.equal(asSandbox.json.code, 'MTR-TENANT-003');
      const noFlag = await apply(s, pf.planPath, [hash, '--apply', PROD_TOKEN]);
      assert.equal(noFlag.json.code, 'MTR-TENANT-001');
      const sandboxToken = await apply(s, pf.planPath, ['--prod', hash, '--apply', SANDBOX_TOKEN]);
      assert.equal(sandboxToken.exitCode, 2);
      assert.equal(sandboxToken.json.code, 'MTR-PROD-APPLY-BLOCKED');
      assert.equal(fake.writes.length, 0);
      const ok = await apply(s, pf.planPath, ['--prod', hash, '--apply', PROD_TOKEN]);
      assert.equal(ok.exitCode, 0, JSON.stringify(ok.json, null, 2));
    } finally { done(); }
  });
}

// ---------------------------------------------------------- op-specific

test('plan file edited after preflight is refused', async () => {
  const s = SCENARIOS.find((x) => x.op === 'contract-expire');
  const { env, fake, done } = setup(s);
  try {
    const pf = await preflight(s, env);
    const plan = JSON.parse(fs.readFileSync(pf.planPath, 'utf8'));
    plan.steps[0].body.ending_before = '2029-01-01T00:00:00.000Z';
    fs.writeFileSync(pf.planPath, JSON.stringify(plan));
    const r = await apply(s, pf.planPath, ['--sandbox', `--confirm-hash=${pf.json.payloadHash}`, '--apply', SANDBOX_TOKEN]);
    assert.equal(r.json.code, 'MTR-PLAN-002');
    assert.equal(fake.writes.length, 0);
  } finally { done(); }
});

test('sandbox refuses a key that equals METRONOME_PROD_KEY', async () => {
  const s = SCENARIOS[0];
  const { env, fake, done } = setup(s);
  try {
    process.env.METRONOME_SANDBOX_KEY = process.env.METRONOME_PROD_KEY;
    const r = await preflight(s, env);
    assert.equal(r.exitCode, 2);
    assert.equal(r.json.code, 'MTR-TENANT-KEY-003');
    assert.equal(fake.calls.length, 0);
  } finally { done(); }
});

test('key change between preflight and apply is refused', async () => {
  const s = SCENARIOS.find((x) => x.op === 'contract-expire');
  const { env, fake, done } = setup(s);
  try {
    const pf = await preflight(s, env);
    process.env.METRONOME_SANDBOX_KEY = 'rotated-sandbox-key';
    const r = await apply(s, pf.planPath, ['--sandbox', `--confirm-hash=${pf.json.payloadHash}`, '--apply', SANDBOX_TOKEN]);
    assert.equal(r.json.code, 'MTR-TENANT-004');
    assert.equal(fake.writes.length, 0);
  } finally { done(); }
});

test('operator mode read-only blocks --apply', async () => {
  const s = SCENARIOS.find((x) => x.op === 'contract-expire');
  const { env, fake, done } = setup(s);
  try {
    const pf = await preflight(s, env);
    process.env.METRO_MODE = 'read-only';
    const r = await apply(s, pf.planPath, ['--sandbox', `--confirm-hash=${pf.json.payloadHash}`, '--apply', SANDBOX_TOKEN]);
    assert.equal(r.exitCode, 2);
    assert.equal(r.json.code, 'MTR-MODE-WRITE-BLOCKED');
    assert.equal(fake.writes.length, 0);
  } finally { done(); }
});

test('customer create refuses an ingest alias already in use, and re-checks at apply', async () => {
  const s = SCENARIOS.find((x) => x.op === 'customer-create');
  const { env, fake, done } = setup(s);
  try {
    const taken = await runOp(opRunner('customer-create').runPreflight, ['--name=Dup', '--ingest-alias=acme-corp', '--sandbox', '--json', `--out=${path.join(env.home, 'dup.json')}`]);
    assert.equal(taken.exitCode, 1);
    assert.equal(taken.json.details.blockers[0].code, 'ingest_alias_in_use');
    const pf = await preflight(s, env);
    fake.customers.push({ id: 'x', name: 'Racer', ingest_aliases: ['initech'], archived_at: null });
    const r = await apply(s, pf.planPath, ['--sandbox', `--confirm-hash=${pf.json.payloadHash}`, '--apply', SANDBOX_TOKEN]);
    assert.equal(r.json.code, 'MTR-PRECHECK');
    assert.equal(fake.writes.length, 0);
  } finally { done(); }
});

test('customer create refuses a custom field key the tenant does not have', async () => {
  const s = SCENARIOS[0];
  const { env, done } = setup(s);
  try {
    const r = await runOp(opRunner('customer-create').runPreflight, ['--name=Initech', '--ingest-alias=initech', '--external-id=x', '--external-id-field=crm_id', '--sandbox', '--json', `--out=${path.join(env.home, 'k.json')}`]);
    assert.equal(r.exitCode, 1);
    assert.equal(r.json.details.blockers[0].code, 'custom_field_key_missing');
  } finally { done(); }
});

test('contract create refuses an overlapping contract unless --allow-concurrent', async () => {
  const s = SCENARIOS.find((x) => x.name === 'contract-create (package)');
  const { env, done } = setup(s);
  try {
    const args = [`--customer-id=${IDS.acme}`, '--package-alias=growth', '--starting-at=2030-01-01T00:00:00.000Z', '--sandbox', '--json'];
    const r = await runOp(opRunner('contract-create').runPreflight, [...args, `--out=${path.join(env.home, 'o.json')}`]);
    assert.equal(r.exitCode, 1);
    assert.equal(r.json.details.blockers[0].code, 'overlapping_contract');
    const ok = await runOp(opRunner('contract-create').runPreflight, [...args, '--allow-concurrent', `--out=${path.join(env.home, 'o2.json')}`]);
    assert.equal(ok.exitCode, 0);
  } finally { done(); }
});

test('package-based contract body only carries the fields the docs allow', async () => {
  const s = SCENARIOS.find((x) => x.name === 'contract-create (package)');
  const { env, done } = setup(s);
  try {
    const r = await preflight(s, env);
    const allowed = ['customer_id', 'starting_at', 'package_id', 'uniqueness_key', 'transition', 'custom_fields'];
    for (const k of Object.keys(r.json.steps[0].body)) assert.ok(allowed.includes(k), k);
  } finally { done(); }
});

test('subscription add refuses when the rate card has no SUBSCRIPTION rate at that frequency', async () => {
  const s = SCENARIOS.find((x) => x.op === 'subscription-add');
  const { env, done } = setup(s);
  try {
    const r = await runOp(opRunner('subscription-add').runPreflight, [`--customer-id=${IDS.globex}`, `--product-id=${IDS.subProduct}`, '--billing-frequency=QUARTERLY', '--quantity=1', '--sandbox', '--json', `--out=${path.join(env.home, 'q.json')}`]);
    assert.equal(r.exitCode, 1);
    assert.equal(r.json.details.blockers[0].code, 'no_subscription_rate_on_rate_card');
  } finally { done(); }
});

test('set-quantity refuses a seat-based subscription', async () => {
  const s = SCENARIOS.find((x) => x.op === 'subscription-set-quantity');
  const { env, done } = setup(s);
  try {
    const r = await runOp(opRunner('subscription-set-quantity').runPreflight, [`--customer-id=${IDS.acme}`, `--subscription-id=${IDS.seatSub}`, '--quantity=4', '--starting-at=2030-01-01T00:00:00.000Z', '--sandbox', '--json', `--out=${path.join(env.home, 's.json')}`]);
    assert.equal(r.json.details.blockers[0].code, 'subscription_is_seat_based');
  } finally { done(); }
});

test('rate card create splits rates into addRates calls of at most 100', async () => {
  const s = SCENARIOS.find((x) => x.op === 'ratecard-create');
  const { env, done } = setup(s);
  try {
    const rates = Array.from({ length: 205 }, (_, i) => ({ product_id: IDS.usageProduct, starting_at: '2030-01-01T00:00:00.000Z', entitled: true, rate_type: 'FLAT', price: 1, pricing_group_values: { action_code: `A${i}`, action_display_name: `A${i}` } }));
    const file = writeSpec(env, 'big.json', { name: 'Big', rates });
    const r = await runOp(opRunner('ratecard-create').runPreflight, [`--file=${file}`, '--sandbox', '--json', `--out=${path.join(env.home, 'big-plan.json')}`]);
    assert.equal(r.exitCode, 0, r.stdout);
    assert.deepEqual(r.json.steps.slice(1).map((st) => st.body.rates.length), [100, 100, 5]);
  } finally { done(); }
});

test('rate card create refuses to steal a live alias unless --allow-alias-move', async () => {
  const s = SCENARIOS.find((x) => x.op === 'ratecard-create');
  const { env, done } = setup(s);
  try {
    const file = writeSpec(env, 'steal.json', { name: 'New', aliases: [{ name: 'acme_standard' }] });
    const r = await runOp(opRunner('ratecard-create').runPreflight, [`--file=${file}`, '--sandbox', '--json', `--out=${path.join(env.home, 'st.json')}`]);
    assert.equal(r.json.details.blockers[0].code, 'rate_card_alias_in_use');
  } finally { done(); }
});

test('package create rejects a nested contract wrapper and unknown usage days', async () => {
  const s = SCENARIOS.find((x) => x.op === 'package-create');
  const { env, done } = setup(s);
  try {
    const a = writeSpec(env, 'bad1.json', { name: 'X', rate_card_id: IDS.rateCard, contract: { usage_statement_schedule: { frequency: 'MONTHLY' } } });
    const b = writeSpec(env, 'bad2.json', { name: 'X', rate_card_id: IDS.rateCard, usage_statement_schedule: { frequency: 'MONTHLY', day: 'MID_MONTH' } });
    for (const f of [a, b]) {
      const r = await runOp(opRunner('package-create').runPreflight, [`--file=${f}`, '--sandbox', '--json', `--out=${path.join(env.home, 'x.json')}`]);
      assert.equal(r.exitCode, 1);
    }
  } finally { done(); }
});

test('clone-version read-back proves the predecessor alias window closes at handoff', async () => {
  const s = SCENARIOS.find((x) => x.op === 'package-clone-version');
  const { env, done } = setup(s);
  try {
    const pf = await preflight(s, env);
    const r = await apply(s, pf.planPath, ['--sandbox', `--confirm-hash=${pf.json.payloadHash}`, '--apply', SANDBOX_TOKEN]);
    const names = r.json.checks.map((c) => c.check);
    assert.ok(names.includes('starter resolves to predecessor before handoff'));
    assert.ok(names.includes('starter resolves to new version at handoff'));
    assert.ok(r.json.checks.every((c) => c.ok));
  } finally { done(); }
});

test('clone-version refuses an alias that already has a future version', async () => {
  const s = SCENARIOS.find((x) => x.op === 'package-clone-version');
  const { env, done } = setup(s);
  try {
    const pf = await preflight(s, env);
    await apply(s, pf.planPath, ['--sandbox', `--confirm-hash=${pf.json.payloadHash}`, '--apply', SANDBOX_TOKEN]);
    const again = await preflight(s, env, '--sandbox', s.args, 'again.json');
    assert.equal(again.exitCode, 1);
    assert.equal(again.json.details.blockers[0].code, 'alias_already_has_a_future_version');
  } finally { done(); }
});

test('ledger additions are refused while spendable net diverges from the list, unless acknowledged', async () => {
  const s = SCENARIOS.find((x) => x.name === 'ledger-adjustment (partial)');
  const { env, fake, done } = setup(s);
  try {
    fake.netBalances[`${IDS.acme}:${IDS.creditType}`] = 400; // list says 1000
    const args = [`--customer-id=${IDS.acme}`, '--amount=300', '--reason=Top up', `--balance-id=${IDS.balance}`, '--sandbox', '--json'];
    const blockedRun = await runOp(opRunner('ledger-adjustment').runPreflight, [...args, `--out=${path.join(env.home, 'n1.json')}`]);
    assert.equal(blockedRun.exitCode, 1);
    assert.equal(blockedRun.json.details.blockers[0].code, 'net_balance_diverges_from_bucket_sum');
    const removal = await runOp(opRunner('ledger-adjustment').runPreflight, [`--customer-id=${IDS.acme}`, '--amount=-100', '--reason=Claw back', `--balance-id=${IDS.balance}`, '--sandbox', '--json', `--out=${path.join(env.home, 'n2.json')}`]);
    assert.equal(removal.exitCode, 0, 'removals are never blocked');
    const acked = await runOp(opRunner('ledger-adjustment').runPreflight, [...args, '--acknowledge-net-divergence=I_UNDERSTAND_GET_NET_BALANCE_IS_AUTHORITATIVE', `--out=${path.join(env.home, 'n3.json')}`]);
    assert.equal(acked.exitCode, 0);
    assert.equal(acked.json.warnings[0].id, 'MTR-CREDIT-NET-001');
  } finally { done(); }
});

test('billing cutover refuses only when nothing would change', async () => {
  const s = SCENARIOS.find((x) => x.op === 'billing-provider-cutover');
  const { env, done } = setup(s);
  try {
    const noop = await runOp(opRunner('billing-provider-cutover').runPreflight, [`--customer-id=${IDS.acme}`, '--collection-method=charge_automatically', '--reason=x', '--sandbox', '--json', `--out=${path.join(env.home, 'b.json')}`]);
    assert.equal(noop.exitCode, 1);
    assert.equal(noop.json.details.blockers[0].code, 'already_on_requested_configuration');
    const remap = await preflight(s, env);
    assert.equal(remap.exitCode, 0);
    assert.equal(remap.json.summary.remapsStripeCustomer, true);
    assert.equal(remap.json.warnings[0].id, 'MTR-BILL-005');
  } finally { done(); }
});

test('preflight never sends a write-shaped request', async () => {
  for (const s of SCENARIOS) {
    const { env, fake, done } = setup(s);
    try {
      await preflight(s, env);
      const bad = fake.calls.filter((c) => rt.isWritePath(c.method, c.path));
      assert.deepEqual(bad, [], s.name);
    } finally { done(); }
  }
});
