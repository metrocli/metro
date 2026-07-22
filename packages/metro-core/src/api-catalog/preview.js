'use strict';

const { getApiEndpoint, listApiEndpoints } = require('./index');
const { normalizeRequestInput, validateApiEndpointRequest } = require('./validation');
const { sha256 } = require('../preview');

const API_PREVIEW_SCHEMA_VERSION = 'metro.api.preview.v1';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function sortedKeys(value) {
  return Object.keys(value || {}).sort();
}

function actionTypeFor(endpoint) {
  if (endpoint.operationType === 'write') return 'planned-write';
  if (endpoint.operationType === 'preview') return 'planned-live-preview';
  return 'planned-read';
}

function sideEffectsFor(endpoint) {
  const base = ['No API calls are made by this preview.'];
  if (endpoint.sideEffectProfile) {
    const profile = endpoint.sideEffectProfile;
    return [
      ...base,
      profile.summary,
      ...profile.futureLiveSideEffects,
      `Future execution remains blocked until these reviews exist: ${profile.requiredReviews.join(', ')}.`,
      `Rollback/remediation expectation: ${profile.rollbackOrRemediation.join(' ')}`,
    ];
  }
  if (endpoint.operationType === 'write') {
    return [
      ...base,
      `Future apply would call ${endpoint.method} ${endpoint.path} and may mutate Metronome billing state.`,
      'Future apply remains blocked until preflight evidence, sandbox proof, audit output, idempotency review, read-back verification, rollback or remediation planning, and owner approval exist.',
    ];
  }
  if (endpoint.operationType === 'preview') {
    return [
      ...base,
      `Future live preview would call ${endpoint.method} ${endpoint.path} for Metronome-calculated preview evidence without applying writes.`,
      'Future live preview remains blocked until guarded tenant profiles and stable output contracts exist.',
    ];
  }
  return [
    ...base,
    `Future live read would call ${endpoint.method} ${endpoint.path} through a guarded tenant-explicit read client.`,
    'Future live read remains blocked until live-read authorization and stable output verification exist.',
  ];
}

function verificationPlanFor(endpoint) {
  if (endpoint.operationType === 'write') {
    return [
      {
        id: 'validate-request-before-preview',
        mode: 'local-validation',
        expectation: 'The request remains valid under metro.api.validation.v1 before any future live runner uses it.',
      },
      {
        id: 'preflight-before-apply',
        mode: 'local-preflight',
        expectation: 'Future apply must bind this preview hash to preflight, approval, idempotency, rollback or remediation, audit, and sandbox proof evidence.',
      },
      {
        id: 'read-back-after-apply',
        mode: 'future-read',
        expectation: endpoint.responseContract.summary,
      },
    ];
  }

  return [
    {
      id: 'validate-request-before-live-read',
      mode: 'local-validation',
      expectation: 'The request remains valid and secret-free before any future live read or preview runner uses it.',
    },
    {
      id: 'verify-stable-output-contract',
      mode: 'future-read',
      expectation: endpoint.responseContract.summary,
    },
  ];
}

function summarizeRequest(input, endpoint) {
  const request = normalizeRequestInput(input, endpoint);
  return {
    envelopeMode: request.envelopeMode,
    bodyKeys: sortedKeys(request.body),
    queryKeys: sortedKeys(request.query),
    pathKeys: sortedKeys(request.path),
    evidenceKeys: sortedKeys(request.evidence),
    metadataKeys: sortedKeys(request.metadata),
    requestHash: sha256({
      endpointId: endpoint.id,
      method: endpoint.method,
      path: endpoint.path,
      request,
    }),
  };
}

function apiPreviewCoverage() {
  return listApiEndpoints().reduce((coverage, endpoint) => {
    coverage[endpoint.id] = {
      schemaVersion: API_PREVIEW_SCHEMA_VERSION,
      supportStatus: 'local-preview-contract',
      command: `metro api preview ${endpoint.id} --file <request.json|yaml> (--sandbox|--prod) [--json]`,
      apiAccess: 'none',
      requiresValidation: `metro api validate ${endpoint.id} --file <request.json|yaml> [--json]`,
    };
    return coverage;
  }, {});
}

function buildApiEndpointPreview(endpointId, input, options = {}) {
  const endpoint = getApiEndpoint(endpointId);
  if (!endpoint) return null;

  const tenant = options.tenant;
  const validation = validateApiEndpointRequest(endpointId, input);
  if (!validation.valid) {
    return {
      schemaVersion: API_PREVIEW_SCHEMA_VERSION,
      generatedFrom: 'metronome-cli/src/api-catalog/preview.js',
      apiAccess: 'none',
      liveExecution: clone(endpoint.liveExecution),
      tenant,
      endpoint: validation.endpoint,
      validation,
      requestSummary: null,
      payloadHash: null,
      actions: [],
      sideEffectProfile: endpoint.sideEffectProfile ? clone(endpoint.sideEffectProfile) : null,
      expectedSideEffects: ['No API calls are made by this preview.'],
      verificationPlan: [],
      policyGates: clone(endpoint.policyGates),
      blocked: true,
      blockReason: 'API request validation failed.',
      applySupported: false,
      applyBlocker: 'Expert API apply remains blocked.',
      sources: clone(endpoint.sources),
    };
  }

  const requestSummary = summarizeRequest(input, endpoint);
  const action = {
    id: `expert-api-${endpoint.id}`,
    type: actionTypeFor(endpoint),
    method: endpoint.method,
    path: endpoint.path,
    sourceIds: clone(endpoint.sourceIds),
    permissionScope: endpoint.permissionScope,
    requestHash: requestSummary.requestHash,
    readiness: 'local-preview-contract',
    note: 'This is a local preview contract only; it does not load a Metronome API client.',
  };
  const hashInput = {
    schemaVersion: API_PREVIEW_SCHEMA_VERSION,
    tenant,
    endpoint: {
      id: endpoint.id,
      method: endpoint.method,
      path: endpoint.path,
      operationType: endpoint.operationType,
      permissionScope: endpoint.permissionScope,
    },
    requestHash: requestSummary.requestHash,
    action,
  };

  return {
    schemaVersion: API_PREVIEW_SCHEMA_VERSION,
    generatedFrom: 'metronome-cli/src/api-catalog/preview.js',
    apiAccess: 'none',
    liveExecution: clone(endpoint.liveExecution),
    tenant,
    endpoint: {
      id: endpoint.id,
      method: endpoint.method,
      path: endpoint.path,
      family: endpoint.family,
      operationType: endpoint.operationType,
      supportStatus: endpoint.supportStatus,
      permissionScope: endpoint.permissionScope,
      sourceIds: clone(endpoint.sourceIds),
    },
    validation,
    requestSummary,
    payloadHash: sha256(hashInput),
    actions: [action],
    sideEffectProfile: endpoint.sideEffectProfile ? clone(endpoint.sideEffectProfile) : null,
    expectedSideEffects: sideEffectsFor(endpoint),
    verificationPlan: verificationPlanFor(endpoint),
    policyGates: clone(endpoint.policyGates),
    blocked: false,
    applySupported: false,
    applyBlocker: 'Expert API apply remains blocked until preflight evidence, sandbox proof, audit output, idempotency review, read-back verification, rollback or remediation planning, owner approval, and explicit current-turn authorization exist.',
    sources: clone(endpoint.sources),
  };
}

module.exports = {
  API_PREVIEW_SCHEMA_VERSION,
  apiPreviewCoverage,
  buildApiEndpointPreview,
};
