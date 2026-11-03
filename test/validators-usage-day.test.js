'use strict';

// packages.create validation accepts usage_statement_schedule.day
// CONTRACT_START / FIRST_OF_MONTH and rejects anything else. No alias-name
// heuristics: day is never required because of what an alias is called.

const test = require('node:test');
const assert = require('node:assert/strict');
const { validateApiEndpointRequest } = require('../packages/metro-core/src/api-catalog/validation');

const evidence = Object.fromEntries([
  'aliasHandoffReviewed', 'aliasUniquenessReviewed', 'rateCardReadBackReviewed', 'packageTermsReviewed',
  'billingProviderBehaviorReviewed', 'stripeDeliveryReviewed', 'invoiceBehaviorReviewed',
  'contractCreateCompatibilityReviewed', 'idempotencyKeyReviewed',
].map((k) => [k, true]));

function request(day) {
  const schedule = { frequency: 'MONTHLY' };
  if (day !== undefined) schedule.day = day;
  return {
    body: {
      name: 'Acme Annual',
      rate_card_id: '00000000-0000-4000-8000-000000000001',
      aliases: [{ name: 'acme_annual', starting_at: '2026-12-01T00:00:00.000Z' }],
      duration: { value: 12, unit: 'MONTHS' },
      contract: { usage_statement_schedule: schedule, scheduled_charges_on_usage_invoices: 'ALL' },
      uniqueness_key: 'acme-annual-v1',
      billing_provider: 'stripe',
      delivery_method: 'direct_to_billing_provider',
    },
    evidence,
  };
}

function dayFindings(result) {
  return result.findings.filter((f) => String(f.path || '').endsWith('usage_statement_schedule.day'));
}

test('CONTRACT_START and FIRST_OF_MONTH are accepted', () => {
  for (const day of ['CONTRACT_START', 'FIRST_OF_MONTH']) {
    const result = validateApiEndpointRequest('packages.create', request(day));
    assert.deepEqual(dayFindings(result), [], `${day}: ${JSON.stringify(dayFindings(result))}`);
  }
});

test('omitting day is fine even for an annual-looking alias (no name heuristic)', () => {
  assert.deepEqual(dayFindings(validateApiEndpointRequest('packages.create', request(undefined))), []);
});

test('unknown day values are rejected', () => {
  const findings = dayFindings(validateApiEndpointRequest('packages.create', request('MID_MONTH')));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].id, 'MTR-APIREQ-004');
});
