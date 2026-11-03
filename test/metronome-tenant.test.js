'use strict';

// resolveTenant must never infer production from METRONOME_PROD_KEY being present.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { REPO_ROOT, runNode } = require('./helpers');

const MOD = path.join(REPO_ROOT, 'packages/metro-core/src/clients/metronome-tenant.js');
const { resolveTenant } = require(MOD);

test('explicit flags win', () => {
  assert.equal(resolveTenant(['--sandbox'], {}), 'sandbox');
  assert.equal(resolveTenant(['--prod'], { METRONOME_SANDBOX_KEY: 'x' }), 'production');
  assert.equal(resolveTenant(['--production'], {}), 'production');
  assert.throws(() => resolveTenant(['--sandbox', '--prod'], {}), { code: 'METRONOME_ENV_CONFLICT' });
});

test('no flag + sandbox key -> sandbox, even when a production key is also set', () => {
  assert.equal(resolveTenant([], { METRONOME_SANDBOX_KEY: 'sbx' }), 'sandbox');
  assert.equal(resolveTenant([], { METRONOME_SANDBOX_KEY: 'sbx', METRONOME_PROD_KEY: 'prd' }), 'sandbox');
});

test('no flag + only a production key -> refusal, never production', () => {
  assert.throws(
    () => resolveTenant([], { METRONOME_PROD_KEY: 'prd' }),
    (error) => error.code === 'METRONOME_TENANT_EXPLICIT_REQUIRED' && /--sandbox or --prod/.test(error.message),
  );
});

test('no flag + no keys -> refusal', () => {
  assert.throws(() => resolveTenant([], {}), { code: 'METRONOME_TENANT_EXPLICIT_REQUIRED' });
  assert.throws(() => resolveTenant([], { METRONOME_SANDBOX_KEY: '   ' }), { code: 'METRONOME_TENANT_EXPLICIT_REQUIRED' });
});

test('applyMetronomeApiKeyFromEnv with only a prod key and no flag refuses and leaves METRONOME_API_KEY unset', () => {
  const result = runNode(`
    const m = require(${JSON.stringify(MOD)});
    try {
      m.applyMetronomeApiKeyFromEnv({ argv: [] });
      console.log('RESOLVED ' + (process.env.METRONOME_API_KEY ? 'key-set' : 'no-key'));
    } catch (error) {
      console.log('REFUSED ' + error.code + ' ' + (process.env.METRONOME_API_KEY ? 'key-set' : 'no-key'));
    }
  `, { env: { METRONOME_PROD_KEY: 'prd_only' } });
  assert.equal(result.stdout.trim(), 'REFUSED METRONOME_TENANT_EXPLICIT_REQUIRED no-key');
});

test('applyMetronomeApiKeyFromEnv with both keys and no flag uses the sandbox key', () => {
  const result = runNode(`
    const m = require(${JSON.stringify(MOD)});
    const r = m.applyMetronomeApiKeyFromEnv({ argv: [] });
    console.log(r.tenant, r.source, process.env.METRONOME_API_KEY === 'sbx' ? 'sandbox-key' : 'other-key');
  `, { env: { METRONOME_PROD_KEY: 'prd', METRONOME_SANDBOX_KEY: 'sbx' } });
  assert.equal(result.stdout.trim(), 'sandbox implicit:sandbox-key sandbox-key');
});

test('prod key equal to sandbox key is refused for --prod', () => {
  const result = runNode(`
    const m = require(${JSON.stringify(MOD)});
    try { m.applyMetronomeApiKeyFromEnv({ argv: ['--prod'] }); console.log('RESOLVED'); }
    catch (error) { console.log(error.code); }
  `, { env: { METRONOME_PROD_KEY: 'same', METRONOME_SANDBOX_KEY: 'same' } });
  assert.equal(result.stdout.trim(), 'METRONOME_PROD_KEY_EQUALS_SANDBOX');
});
