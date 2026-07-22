'use strict';

const { assertOperatorModeAllows } = require('../setup/mode');

const LIVE_APPLY_CONFIRMATION = 'I_UNDERSTAND_THIS_WILL_WRITE_LIVE_METRONOME_SANDBOX';
const ALLOWED_APPLY_TENANTS = new Set(['sandbox']);

function safetyError(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  return error;
}

function assertSandboxApplyTenant(tenant) {
  if (!ALLOWED_APPLY_TENANTS.has(tenant)) {
    throw safetyError(
      'MTR-TENANT-002',
      'Live expert API apply is sandbox-only in the current CLI. Production writes remain blocked.',
    );
  }
}

function assertLiveApplyAuthorization(liveApplyConfirmation) {
  if (liveApplyConfirmation !== LIVE_APPLY_CONFIRMATION) {
    throw safetyError(
      'MTR-LIVE-APPLY-001',
      'Live sandbox apply requires --confirm-live-apply with the exact guarded apply phrase.',
    );
  }
}

function createGuardedMetronomeWriteClient(options = {}) {
  const { tenant, liveApplyConfirmation, endpointId, transport, transportMode = 'live' } = options;
  assertSandboxApplyTenant(tenant);
  assertLiveApplyAuthorization(liveApplyConfirmation);
  if (transportMode === 'live') {
    assertOperatorModeAllows('live-write');
  }
  if (typeof transport !== 'function') {
    throw safetyError('MTR-CLIENT-004', 'Write client requires an injected transport function.');
  }

  return {
    tenant,
    endpointId,
    transportMode,
    async request({ method, path, body }) {
      return transport({ method, path, body });
    },
  };
}

module.exports = {
  LIVE_APPLY_CONFIRMATION,
  assertSandboxApplyTenant,
  assertLiveApplyAuthorization,
  createGuardedMetronomeWriteClient,
};
