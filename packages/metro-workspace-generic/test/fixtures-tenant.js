'use strict';

// Scrubbed sample tenant for op tests: Acme Corp, placeholder UUIDs.

const { id } = require('./helpers/fake-metronome');

const IDS = {
  acme: id(1),
  globex: id(2),
  subProduct: id(10),
  usageProduct: id(11),
  creditProduct: id(12),
  rateCard: id(20),
  starter: id(30),
  growth: id(31),
  contract: id(40),
  qtySub: id(41),
  seatSub: id(42),
  trialContract: id(43),
  balance: id(50),
  segment: id(51),
  creditType: id(60),
  billingConfig: id(70),
  deliveryMethod: id(71),
};

function seed() {
  return {
    customers: [
      { id: IDS.acme, name: 'Acme Corp', ingest_aliases: ['acme-corp'], external_id: 'acme-corp', custom_fields: { external_id: 'acme-ext-1' }, archived_at: null },
      { id: IDS.globex, name: 'Globex', ingest_aliases: ['globex'], external_id: 'globex', custom_fields: {}, archived_at: null },
    ],
    customFieldKeys: [{ entity: 'customer', key: 'external_id', enforce_uniqueness: false }],
    products: [
      { id: IDS.subProduct, type: 'SUBSCRIPTION', current: { name: 'Seats' } },
      { id: IDS.usageProduct, type: 'USAGE', current: { name: 'Actions', pricing_group_key: ['action_code', 'action_display_name'] } },
      { id: IDS.creditProduct, type: 'FIXED', current: { name: 'Credits' } },
    ],
    rateCards: [{ id: IDS.rateCard, name: 'Acme Standard', aliases: [{ name: 'acme_standard' }] }],
    rates: [
      { rate_card_id: IDS.rateCard, product_id: IDS.subProduct, starting_at: '2026-01-01T00:00:00.000Z', entitled: true, billing_frequency: 'MONTHLY', rate: { rate_type: 'SUBSCRIPTION', price: 5000 } },
      { rate_card_id: IDS.rateCard, product_id: IDS.usageProduct, starting_at: '2026-01-01T00:00:00.000Z', entitled: true, pricing_group_values: { action_code: 'EXPORT', action_display_name: 'Export' }, rate: { rate_type: 'FLAT', price: 2 } },
    ],
    packages: [
      {
        id: IDS.starter,
        name: 'Starter',
        uniqueness_key: 'package:starter-v1',
        rate_card_id: IDS.rateCard,
        aliases: [{ name: 'starter', starting_at: '2026-01-01T00:00:00.000Z' }],
        billing_provider: 'stripe',
        delivery_method: 'direct_to_billing_provider',
        scheduled_charges_on_usage_invoices: 'ALL',
        usage_statement_schedule: { frequency: 'MONTHLY' },
        commits: [],
        overrides: [],
        scheduled_charges: [],
        subscriptions: [{
          id: id(90),
          name: 'Seats',
          subscription_rate: { billing_frequency: 'MONTHLY', product: { id: IDS.subProduct, name: 'Seats' } },
          collection_schedule: 'ADVANCE',
          proration: { is_prorated: true, invoice_behavior: 'BILL_ON_NEXT_COLLECTION_DATE' },
          initial_quantity: 1,
          starting_at_offset: { value: '0', unit: 'DAYS' },
          custom_fields: {},
        }],
        recurring_credits: [{
          id: id(91),
          name: 'Monthly credits',
          product: { id: IDS.creditProduct, name: 'Credits' },
          access_amount: { credit_type_id: IDS.creditType, unit_price: 1, quantity: 100 },
          priority: 1,
          commit_duration: { value: '1', unit: 'MONTHS' },
          starting_at_offset: { value: '0', unit: 'DAYS' },
          recurrence_frequency: 'MONTHLY',
        }],
      },
      {
        id: IDS.growth,
        name: 'Growth',
        uniqueness_key: 'package:growth-v1',
        rate_card_id: IDS.rateCard,
        aliases: [{ name: 'growth' }],
        usage_statement_schedule: { frequency: 'MONTHLY' },
        commits: [{ id: id(92), type: 'PREPAID', product: { id: IDS.creditProduct } }],
        overrides: [],
        scheduled_charges: [],
      },
    ],
    contracts: [
      {
        id: IDS.contract,
        customer_id: IDS.acme,
        starting_at: '2026-01-01T00:00:00.000Z',
        ending_before: null,
        package_id: IDS.starter,
        rate_card_id: IDS.rateCard,
        uniqueness_key: 'acme-starter',
        commits: [{ id: IDS.balance, name: 'Prepaid', rollover_fraction: 1 }],
        credits: [],
        subscriptions: [
          {
            id: IDS.qtySub,
            created_at: '2026-01-01T00:00:00.000Z',
            subscription_rate: { billing_frequency: 'MONTHLY', product: { id: IDS.subProduct, name: 'Seats' } },
            collection_schedule: 'ADVANCE',
            quantity_management_mode: 'QUANTITY_ONLY',
            starting_at: '2026-01-01T00:00:00.000Z',
            quantity_schedule: [{ starting_at: '2026-01-01T00:00:00.000Z', quantity: 5 }],
          },
          {
            id: IDS.seatSub,
            created_at: '2026-01-01T00:00:00.000Z',
            subscription_rate: { billing_frequency: 'ANNUAL', product: { id: IDS.subProduct, name: 'Seats' } },
            collection_schedule: 'ADVANCE',
            quantity_management_mode: 'SEAT_BASED',
            seat_config: { seat_group_key: 'user_id' },
            starting_at: '2026-01-01T00:00:00.000Z',
            quantity_schedule: [{ starting_at: '2026-01-01T00:00:00.000Z', quantity: 3 }],
          },
        ],
      },
      {
        id: IDS.trialContract,
        customer_id: IDS.globex,
        starting_at: '2026-10-01T00:00:00.000Z',
        ending_before: '2030-01-01T00:00:00.000Z',
        package_id: IDS.starter,
        rate_card_id: IDS.rateCard,
        commits: [],
        credits: [],
        subscriptions: [],
      },
    ],
    balances: [{
      id: IDS.balance,
      customer_id: IDS.acme,
      type: 'PREPAID',
      name: 'Prepaid',
      balance: 1000,
      contract: { id: IDS.contract },
      access_schedule: { credit_type: { id: IDS.creditType }, schedule_items: [{ id: IDS.segment, amount: 1000 }] },
    }],
    billingConfigs: [{
      id: IDS.billingConfig,
      customer_id: IDS.acme,
      billing_provider: 'stripe',
      delivery_method_id: IDS.deliveryMethod,
      configuration: { stripe_customer_id: 'cus_wrong', stripe_collection_method: 'charge_automatically' },
      archived_at: null,
    }],
    invoices: [],
    seats: { [IDS.seatSub]: { total_quantity: 3, assigned_seat_ids: ['u1', 'u2'] } },
  };
}

module.exports = { IDS, seed };
