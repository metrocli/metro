'use strict';

const { buildApiReadRefusal } = require('./read-refusal');

const API_READ_PREFLIGHT_SCHEMA_VERSION = 'metro.api.read-preflight.v1';

const RUNTIME_BLOCKER_IDS = new Set([
  'metronome-key-not-configured',
  'live-read-endpoint-not-enabled',
]);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function hasBlocker(refusal, id) {
  return (refusal.blockers || []).some((blocker) => blocker.id === id);
}

function check(id, label, passed, blockerIds, nextSafeStep) {
  return {
    id,
    label,
    status: passed ? 'passed' : 'blocked',
    blockerIds: clone(blockerIds || []),
    nextSafeStep,
  };
}

function buildChecks(refusal) {
  const reviewedEndpointBlocked = hasBlocker(refusal, 'endpoint-id-required')
    || hasBlocker(refusal, 'reviewed-endpoint-required')
    || hasBlocker(refusal, 'read-endpoint-required');
  const tenantBlocked = hasBlocker(refusal, 'single-explicit-tenant-required')
    || hasBlocker(refusal, 'explicit-tenant-required');
  const requestBlocked = hasBlocker(refusal, 'request-json-required')
    || hasBlocker(refusal, 'request-json-readable')
    || hasBlocker(refusal, 'valid-read-plan-required');
  const requestPlanValid = refusal.readPlan?.validationValid === true && refusal.readPlan?.blocked === false;
  const readGateBlocked = hasBlocker(refusal, 'reviewed-read-gate-required')
    || hasBlocker(refusal, 'read-gate-json-readable')
    || hasBlocker(refusal, 'valid-read-gate-required')
    || hasBlocker(refusal, 'read-gate-request-hash-mismatch')
    || hasBlocker(refusal, 'read-gate-tenant-mismatch');
  const authorizationBlocked = hasBlocker(refusal, 'confirm-live-read-required')
    || hasBlocker(refusal, 'confirm-live-read-token-mismatch');

  return [
    check(
      'reviewed-read-endpoint',
      'Reviewed read endpoint',
      !reviewedEndpointBlocked,
      ['endpoint-id-required', 'reviewed-endpoint-required', 'read-endpoint-required'].filter((id) => hasBlocker(refusal, id)),
      'Choose a read endpoint from metro api catalog --json.',
    ),
    check(
      'explicit-tenant',
      'Explicit tenant selection',
      !tenantBlocked,
      ['single-explicit-tenant-required', 'explicit-tenant-required'].filter((id) => hasBlocker(refusal, id)),
      'Use exactly one of --sandbox or --prod.',
    ),
    check(
      'validated-request-plan',
      'Validated local read plan',
      !requestBlocked && requestPlanValid,
      ['request-json-required', 'request-json-readable', 'valid-read-plan-required'].filter((id) => hasBlocker(refusal, id)),
      'Run metro api read-plan <endpoint-id> --file <request.json|yaml> (--sandbox|--prod) --json and fix any validation findings.',
    ),
    check(
      'reviewed-read-gate',
      'Reviewed read gate evidence',
      !readGateBlocked,
      ['reviewed-read-gate-required', 'read-gate-json-readable', 'valid-read-gate-required', 'read-gate-request-hash-mismatch', 'read-gate-tenant-mismatch'].filter((id) => hasBlocker(refusal, id)),
      'Generate, review, and validate a metro.api.read-gate.v1 manifest for the exact request hash and tenant.',
    ),
    check(
      'current-turn-live-read-authorization',
      'Current-turn live-read authorization token',
      !authorizationBlocked,
      ['confirm-live-read-required', 'confirm-live-read-token-mismatch'].filter((id) => hasBlocker(refusal, id)),
      'Only provide --confirm-live-read when the current user turn explicitly authorizes the exact live read.',
    ),
    check(
      'tenant-metronome-key',
      'Tenant Metronome key configured',
      !hasBlocker(refusal, 'metronome-key-not-configured'),
      ['metronome-key-not-configured'].filter((id) => hasBlocker(refusal, id)),
      'Export the tenant key environment variable named in the read gate before running metro api read.',
    ),
    check(
      'live-read-endpoint-enabled',
      'Live read endpoint enabled in CLI',
      !hasBlocker(refusal, 'live-read-endpoint-not-enabled'),
      ['live-read-endpoint-not-enabled'].filter((id) => hasBlocker(refusal, id)),
      'Use metro api read-mock or metro api read-pipeline for endpoints not yet enabled for live read.',
    ),
  ];
}

function buildApiReadPreflight(options = {}) {
  const refusal = buildApiReadRefusal(options);
  const blockerIds = (refusal.blockers || []).map((blocker) => blocker.id);
  const missingLocalEvidence = blockerIds.filter((id) => !RUNTIME_BLOCKER_IDS.has(id));
  const runtimeBlockers = blockerIds.filter((id) => RUNTIME_BLOCKER_IDS.has(id));
  const localEvidenceReady = missingLocalEvidence.length === 0;

  return {
    schemaVersion: API_READ_PREFLIGHT_SCHEMA_VERSION,
    generatedFrom: 'metronome-cli/src/api-catalog/read-preflight.js',
    apiAccess: 'none',
    liveExecution: clone(refusal.liveExecution),
    readEnabledInCurrentCli: refusal.readEnabledInCurrentCli === true,
    command: refusal.command || null,
    blocked: refusal.blocked === true,
    blockReason: refusal.blockReason || null,
    summary: {
      endpointId: refusal.endpoint?.id || null,
      tenant: refusal.tenantSelection?.tenant || null,
      requestHash: refusal.readPlan?.requestHash || null,
      readPlanValid: refusal.readPlan?.validationValid === true && refusal.readPlan?.blocked === false,
      readGateValid: refusal.readGate?.validation?.valid === true,
      confirmLiveReadTokenMatchesGuard: refusal.authorization?.confirmLiveReadTokenMatchesGuard === true,
      localEvidenceReady,
      missingLocalEvidence,
      runtimeBlockers,
      futureLiveReadEnabledInCurrentCli: refusal.readEnabledInCurrentCli === true,
    },
    endpoint: clone(refusal.endpoint),
    tenantSelection: clone(refusal.tenantSelection),
    request: clone(refusal.request),
    readPlan: clone(refusal.readPlan),
    readGate: clone(refusal.readGate),
    authorization: clone(refusal.authorization),
    checks: buildChecks(refusal),
    blockers: clone(refusal.blockers),
    nextSafeStep: localEvidenceReady
      ? (refusal.readEnabledInCurrentCli
        ? 'Local read evidence is ready. Run metro api read with the reviewed read gate and confirm-live-read token.'
        : 'Local read evidence is ready except for runtime prerequisites such as the tenant Metronome key. Export the key env var, then run metro api read.')
      : 'Resolve missing local evidence with read-plan and read-gate commands before running metro api read.',
    sources: clone(refusal.sources || []),
  };
}

module.exports = {
  API_READ_PREFLIGHT_SCHEMA_VERSION,
  buildApiReadPreflight,
};
