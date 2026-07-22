'use strict';

const { assertOperatorModeAllows } = require('../setup/mode');

const LIVE_READ_CONFIRMATION = 'I_UNDERSTAND_THIS_WILL_READ_LIVE_METRONOME';
const ALLOWED_TENANTS = new Set(['sandbox', 'production']);
const READ_METHODS = new Set(['GET', 'POST']);

const WRITE_PATH_PATTERNS = [
  /\/create\b/i,
  /\/edit\b/i,
  /\/archive\b/i,
  /\/void\b/i,
  /\/regenerate\b/i,
  /\/update/i,
  /\/set[A-Z]/,
  /\/ingest\b/i,
  /\/add[A-Z]/,
  /\/delete/i,
  /\/remove/i,
  /\/attempt\b/i,
  /\/release\b/i,
  /\/amend\b/i,
  /\/cancel\b/i,
  /\/setup/i,
  /\/upsert/i,
];

function safetyError(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  return error;
}

function assertTenant(tenant) {
  if (!ALLOWED_TENANTS.has(tenant)) {
    throw safetyError('MTR-TENANT-001', 'Read client requires tenant sandbox or production.');
  }
}

function assertLiveReadAuthorization(liveReadConfirmation) {
  if (liveReadConfirmation !== LIVE_READ_CONFIRMATION) {
    throw safetyError(
      'MTR-LIVE-READ-001',
      'Live Metronome reads require current-turn authorization and the exact read confirmation token.',
    );
  }
}

function assertReadOnlyEndpoint(endpoint) {
  const method = String(endpoint?.method || '').toUpperCase();
  const path = endpoint?.path;
  if (!READ_METHODS.has(method)) {
    throw safetyError('MTR-READ-ENDPOINT-001', `Unsupported read method: ${method || '(missing)'}.`);
  }
  if (typeof path !== 'string' || !path.startsWith('/')) {
    throw safetyError('MTR-READ-ENDPOINT-002', 'Read endpoint path must be an absolute API path.');
  }
  for (const pattern of WRITE_PATH_PATTERNS) {
    if (pattern.test(path)) {
      throw safetyError('MTR-WRITE-001', `Refusing write-shaped endpoint in read client: ${method} ${path}.`);
    }
  }
}

function createGuardedMetronomeReadClient(options = {}) {
  const { tenant, liveReadConfirmation, transport, transportMode = 'injected' } = options;
  assertTenant(tenant);
  assertLiveReadAuthorization(liveReadConfirmation);
  if (transportMode === 'live') {
    assertOperatorModeAllows('live-read');
  }
  if (typeof transport !== 'function') {
    throw safetyError('MTR-CLIENT-002', 'Read client requires an injected transport function.');
  }

  return {
    tenant,
    transportMode,
    async request(endpoint) {
      assertReadOnlyEndpoint(endpoint);
      return transport({
        method: endpoint.method.toUpperCase(),
        path: endpoint.path,
        body: endpoint.bodyTemplate || endpoint.body || undefined,
      });
    },
  };
}

module.exports = {
  LIVE_READ_CONFIRMATION,
  assertReadOnlyEndpoint,
  createGuardedMetronomeReadClient,
};
