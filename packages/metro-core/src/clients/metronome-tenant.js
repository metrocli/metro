'use strict';

const { loadLocalEnv } = require('./load-local-env');
const path = require('path');

// clients/ → src/ → metro-core/ → packages/ → metronome-cli/
const METRO_REPO_ROOT = path.resolve(__dirname, '../../../..');

function ensureLocalEnvLoaded() {
  // Idempotent: loadLocalEnv never overrides set vars.
  return loadLocalEnv({ cwd: process.cwd(), repoRoot: METRO_REPO_ROOT });
}

function parseTenantFlags(argv = []) {
  const sandbox = argv.includes('--sandbox');
  const prod = argv.includes('--prod') || argv.includes('--production');
  if (sandbox && prod) {
    const error = new Error('Pass at most one of --sandbox or --prod');
    error.code = 'METRONOME_ENV_CONFLICT';
    throw error;
  }
  if (sandbox) return 'sandbox';
  if (prod) return 'production';
  return null;
}

function resolveTenant(argv = []) {
  const explicit = parseTenantFlags(argv);
  if (explicit) return explicit;
  return process.env.METRONOME_PROD_KEY ? 'production' : 'sandbox';
}

function envLoadHint(label, envLoad) {
  if (envLoad && !envLoad.loaded) {
    return ' No .env found (tried METRO_ENV_FILE, .env, metronome/.env, ../metronome/.env).';
  }
  if (envLoad && envLoad.loaded) {
    return ` Loaded ${envLoad.path} but ${label} still missing/wrong.`;
  }
  return '';
}

/**
 * Production keys are opaque Metronome tokens - not Stripe-style sk_live_ prefixes.
 * Do not fingerprint a specific token prefix; any rotated/new prod token is valid.
 * Real rails: METRONOME_PROD_KEY must be set, and must not equal METRONOME_SANDBOX_KEY.
 */
function assertProdKeyShape(key, label = 'METRONOME_PROD_KEY', envLoad = null) {
  if (!key || !String(key).trim()) {
    const error = new Error(`${label} not set.${envLoadHint(label, envLoad)}`);
    error.code = 'METRONOME_PROD_KEY_INVALID';
    throw error;
  }

  const sandboxKey = process.env.METRONOME_SANDBOX_KEY;
  if (sandboxKey && String(key) === String(sandboxKey)) {
    const error = new Error(
      `${label} equals METRONOME_SANDBOX_KEY - refusing production tenant.`,
    );
    error.code = 'METRONOME_PROD_KEY_EQUALS_SANDBOX';
    throw error;
  }
}

function applyMetronomeApiKeyFromEnv({
  argv = [],
  requireExplicitTenantFlags = false,
} = {}) {
  const envLoad = ensureLocalEnvLoaded();
  const explicit = parseTenantFlags(argv);
  if (requireExplicitTenantFlags && !explicit) {
    const error = new Error('Pass --sandbox or --prod/--production (refusing implicit tenant selection).');
    error.code = 'METRONOME_TENANT_EXPLICIT_REQUIRED';
    throw error;
  }

  const tenant = explicit || resolveTenant(argv);

  if (tenant === 'production') {
    const key = process.env.METRONOME_PROD_KEY;
    assertProdKeyShape(key, 'METRONOME_PROD_KEY', envLoad);
    process.env.METRONOME_API_KEY = key;
    return { tenant, source: explicit ? 'flag:--prod' : 'implicit:METRONOME_PROD_KEY', envLoad };
  }

  const key = process.env.METRONOME_API_KEY || process.env.METRONOME_SANDBOX_KEY;
  if (!key) {
    const hint = envLoad && !envLoad.loaded
      ? ' No .env found (tried METRO_ENV_FILE, .env, metronome/.env, ../metronome/.env).'
      : '';
    const error = new Error(`Sandbox requires METRONOME_API_KEY or METRONOME_SANDBOX_KEY.${hint}`);
    error.code = 'METRONOME_SANDBOX_KEY_MISSING';
    throw error;
  }
  process.env.METRONOME_API_KEY = key;
  return { tenant, source: explicit ? 'flag:--sandbox' : 'implicit:sandbox-key', envLoad };
}

module.exports = {
  parseTenantFlags,
  resolveTenant,
  assertProdKeyShape,
  applyMetronomeApiKeyFromEnv,
  ensureLocalEnvLoaded,
};
