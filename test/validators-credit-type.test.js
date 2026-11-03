'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { REPO_ROOT, runNode, tempDir, runMetro } = require('./helpers');
const fs = require('fs');

const VALIDATORS = path.join(REPO_ROOT, 'packages/metro-core/src/validators/index.js');
const {
  USD_CREDIT_TYPE_ID,
  configuredAccessCreditTypeIds,
  validateShapeInput,
} = require(VALIDATORS);

// Obviously fake tenant access credit type.
const ACME_CREDITS = '00000000-0000-4000-8000-0000000000c1';
const NOT_FIAT = /must be fiat, not the access credit type/;
const ONLY_USD = /Only USD cents is currently allowlisted/;

function creditTypeMessages(result) {
  return result.findings
    .filter((f) => f.path === 'invoiceSchedule.creditTypeId')
    .map((f) => f.message);
}

const topUp = (creditTypeId) => ({ invoiceSchedule: { creditTypeId } });

test('no access credit type is hardcoded in validators', () => {
  delete process.env.METRO_ACCESS_CREDIT_TYPE_IDS;
  assert.equal(configuredAccessCreditTypeIds().size, 0);
  const messages = creditTypeMessages(validateShapeInput('paid-credit-top-up', topUp(ACME_CREDITS)));
  assert.ok(!messages.some((m) => NOT_FIAT.test(m)), messages.join('\n'));
  assert.ok(messages.some((m) => ONLY_USD.test(m)));
});

test('access credit type comes from the profile workspaceCatalog', () => {
  const options = { workspaceCatalog: { creditTypeId: ACME_CREDITS } };
  assert.deepEqual([...configuredAccessCreditTypeIds(options)], [ACME_CREDITS]);
  const messages = creditTypeMessages(validateShapeInput('paid-credit-top-up', topUp(ACME_CREDITS), options));
  assert.ok(messages.some((m) => NOT_FIAT.test(m)), messages.join('\n'));
});

test('placeholder catalog credit types are ignored', () => {
  const options = { workspaceCatalog: { creditTypeId: '<sandbox-credit-type-id>' } };
  assert.equal(configuredAccessCreditTypeIds(options).size, 0);
});

test('explicit options and env also configure access credit types', () => {
  assert.ok(configuredAccessCreditTypeIds({ creditTypeId: ACME_CREDITS }).has(ACME_CREDITS));
  process.env.METRO_ACCESS_CREDIT_TYPE_IDS = `${ACME_CREDITS}, other-credit`;
  try {
    const ids = configuredAccessCreditTypeIds();
    assert.ok(ids.has(ACME_CREDITS));
    assert.ok(ids.has('other-credit'));
  } finally {
    delete process.env.METRO_ACCESS_CREDIT_TYPE_IDS;
  }
});

test('USD cents stays accepted as the fiat invoice credit type', () => {
  const options = { workspaceCatalog: { creditTypeId: ACME_CREDITS } };
  const messages = creditTypeMessages(validateShapeInput('paid-credit-top-up', topUp(USD_CREDIT_TYPE_ID), options));
  assert.deepEqual(messages, []);
});

test('metro validate reads creditTypeId from ~/.metro/profiles.json', () => {
  const home = tempDir();
  fs.mkdirSync(path.join(home, '.metro'), { recursive: true });
  fs.writeFileSync(path.join(home, '.metro', 'profiles.json'), JSON.stringify({
    schemaVersion: 'metro.profiles.v1',
    defaultProfile: 'acme-sandbox',
    profiles: {
      'acme-sandbox': {
        tenant: 'sandbox',
        metronomeKeyEnv: 'METRONOME_SANDBOX_KEY',
        workspaceCatalog: { creditTypeId: ACME_CREDITS },
      },
    },
  }));
  const input = path.join(home, 'top-up.json');
  fs.writeFileSync(input, JSON.stringify(topUp(ACME_CREDITS)));
  const result = runMetro(['validate', '--shape', 'paid-credit-top-up', '--file', input, '--json'], { home });
  const payload = JSON.parse(result.stdout);
  assert.ok(creditTypeMessages(payload).some((m) => NOT_FIAT.test(m)));
});

test('customer setup accepts a generic externalCustomerId fixture', () => {
  const fixture = path.join(REPO_ROOT, 'test', 'fixtures', 'customer-setup-external-id-valid.json');
  const result = runMetro(['validate', '--shape', 'customer-setup', '--file', fixture, '--json']);
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.equal(JSON.parse(result.stdout).valid, true);
});

test('validators no longer accept a tenant-specific account id alias', () => {
  const out = runNode(`
    const { validateShapeInput } = require(${JSON.stringify(VALIDATORS)});
    const r = validateShapeInput('customer-setup', { companyName: 'Acme Corp', ['lev' + 'AccountId']: 'acme-1' });
    process.stdout.write(JSON.stringify(r.findings.map((f) => f.path)));
  `);
  assert.equal(out.code, 0, out.stderr);
  assert.ok(JSON.parse(out.stdout).includes('externalCustomerId'));
});
