'use strict';

const { getApiEndpoint, listApiEndpoints } = require('./index');
const { normalizeRequestInput, validateApiEndpointRequest } = require('./validation');
const { isLiveReadEndpoint } = require('../clients/live-endpoints');
const { sha256 } = require('../preview');

const API_READ_PLAN_SCHEMA_VERSION = 'metro.api.read-plan.v1';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function sortedKeys(value) {
  return Object.keys(value || {}).sort();
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

function apiReadPlanCoverage() {
  return listApiEndpoints().reduce((coverage, endpoint) => {
    const isReadEndpoint = endpoint.operationType === 'read';
    coverage[endpoint.id] = {
      schemaVersion: API_READ_PLAN_SCHEMA_VERSION,
      supportStatus: isReadEndpoint ? 'local-read-plan' : 'not-read-endpoint',
      command: `metro api read-plan ${endpoint.id} --file <request.json|yaml> (--sandbox|--prod) [--json]`,
      apiAccess: 'none',
      requiresValidation: `metro api validate ${endpoint.id} --file <request.json|yaml> [--json]`,
      liveReadEnabledInCurrentCli: isLiveReadEndpoint(endpoint.id),
    };
    return coverage;
  }, {});
}

function buildApiEndpointReadPlan(endpointId, input, options = {}) {
  const endpoint = getApiEndpoint(endpointId);
  if (!endpoint) return null;

  if (endpoint.operationType !== 'read') {
    return {
      schemaVersion: API_READ_PLAN_SCHEMA_VERSION,
      generatedFrom: 'packages/metro-core/src/api-catalog/read-plan.js',
      apiAccess: 'none',
      liveExecution: clone(endpoint.liveExecution),
      tenant: options.tenant || null,
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
      validation: null,
      requestSummary: null,
      plannedRead: null,
      requiredLiveReadGate: null,
      verificationPlan: [],
      blocked: true,
      blockReason: `API read-plan supports reviewed operationType "read" endpoints only; ${endpoint.id} is ${endpoint.operationType}.`,
      liveReadSupported: false,
      nextSafeStep: 'Use metro api preview for preview-shaped endpoints or workflow preview/preflight commands for write-shaped endpoints.',
      sources: clone(endpoint.sources),
    };
  }

  const validation = validateApiEndpointRequest(endpointId, input);
  if (!validation.valid) {
    return {
      schemaVersion: API_READ_PLAN_SCHEMA_VERSION,
      generatedFrom: 'packages/metro-core/src/api-catalog/read-plan.js',
      apiAccess: 'none',
      liveExecution: clone(endpoint.liveExecution),
      tenant: options.tenant || null,
      endpoint: validation.endpoint,
      validation,
      requestSummary: null,
      plannedRead: null,
      requiredLiveReadGate: {
        status: 'blocked-until-valid-request',
        requiredBeforeLive: clone(endpoint.policyGates),
      },
      verificationPlan: [],
      blocked: true,
      blockReason: 'API read-plan request validation failed.',
      liveReadSupported: false,
      nextSafeStep: 'Fix the request file and re-run metro api read-plan before considering any future live read.',
      sources: clone(endpoint.sources),
    };
  }

  const requestSummary = summarizeRequest(input, endpoint);
  const liveReadSupported = isLiveReadEndpoint(endpoint.id);
  const plannedRead = {
    id: `expert-api-read-${endpoint.id}`,
    type: 'planned-read',
    method: endpoint.method,
    path: endpoint.path,
    sourceIds: clone(endpoint.sourceIds),
    permissionScope: endpoint.permissionScope,
    requestHash: requestSummary.requestHash,
    readiness: 'local-read-plan',
    note: 'This is a local read plan only; it does not load a Metronome API client.',
  };

  return {
    schemaVersion: API_READ_PLAN_SCHEMA_VERSION,
    generatedFrom: 'packages/metro-core/src/api-catalog/read-plan.js',
    apiAccess: 'none',
    liveExecution: clone(endpoint.liveExecution),
    tenant: options.tenant || null,
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
    plannedRead,
    outputContract: clone(endpoint.responseContract),
    requiredLiveReadGate: {
      status: 'blocked-until-guarded-read-runner',
      requiredBeforeLive: clone(endpoint.policyGates),
      confirmLiveReadToken: {
        required: true,
        futureFlag: '--confirm-live-read <token>',
        tokenScope: 'exact tenant, endpoint id, permission scope, target identifiers, and request hash',
      },
      auditSafeRequestSummary: {
        required: true,
        strategy: 'Store request hashes and non-secret identifier field names; never store API keys, bearer tokens, or raw environment values.',
      },
    },
    verificationPlan: [
      {
        id: 'validate-request-before-live-read',
        mode: 'local-validation',
        expectation: 'The request remains valid and secret-free under metro.api.validation.v1 before any future live read runner uses it.',
      },
      {
        id: 'bind-current-turn-authorization',
        mode: 'future-live-read',
        expectation: 'Future live execution must include a current-turn confirm-live-read token for the exact tenant, endpoint, target identifiers, permission scope, and request hash.',
      },
      {
        id: 'verify-stable-output-contract',
        mode: 'future-verification',
        expectation: endpoint.responseContract.summary,
      },
    ],
    blocked: false,
    liveReadSupported,
    liveReadBlocker: liveReadSupported
      ? null
      : 'Endpoint is not on the current live read allowlist; use local read-mock and read-pipeline evidence only.',
    nextSafeStep: liveReadSupported
      ? 'Build read-gate evidence, then use metro api read with --confirm-live-read and current-turn authorization.'
      : 'Use this local read plan as design evidence until the endpoint is added to the live read allowlist.',
    liveExecution: {
      ...clone(endpoint.liveExecution),
      enabledInCurrentCli: liveReadSupported,
      reason: liveReadSupported
        ? 'Guarded live read is enabled for this endpoint when read-gate evidence and current-turn confirmation are satisfied.'
        : endpoint.liveExecution?.reason || 'Live read is not enabled for this endpoint in the current CLI release.',
    },
    sources: clone(endpoint.sources),
  };
}

module.exports = {
  API_READ_PLAN_SCHEMA_VERSION,
  apiReadPlanCoverage,
  buildApiEndpointReadPlan,
};
