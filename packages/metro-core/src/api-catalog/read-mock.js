'use strict';

const { getApiEndpoint, listApiEndpoints } = require('./index');
const { buildApiReadAuditTemplate } = require('./read-audit');
const { validateApiReadGate } = require('./read-gate');
const { buildMockedApiReadResult, verifyApiReadResult } = require('./read-result');

const API_READ_MOCK_SCHEMA_VERSION = 'metro.api.read-mock.v1';

const LOCAL_ONLY_LIVE_EXECUTION = {
  enabledInCurrentCli: false,
  reason: 'Expert API read-mock execution uses local mocked response data only; the current CLI does not call Metronome for expert API reads.',
  nextSafeStep: 'Use read-mock output as local proof for request binding, output verification, and audit templating. Future live reads remain disabled until a guarded runner is explicitly authorized.',
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function endpointSnapshot(endpoint) {
  return {
    id: endpoint.id,
    method: endpoint.method,
    path: endpoint.path,
    family: endpoint.family,
    operationType: endpoint.operationType,
    supportStatus: endpoint.supportStatus,
    permissionScope: endpoint.permissionScope,
    sourceIds: clone(endpoint.sourceIds),
  };
}

function apiReadMockCoverage() {
  return listApiEndpoints().reduce((coverage, endpoint) => {
    const isReadEndpoint = endpoint.operationType === 'read';
    coverage[endpoint.id] = {
      schemaVersion: API_READ_MOCK_SCHEMA_VERSION,
      supportStatus: isReadEndpoint ? 'local-mocked-read-runner' : 'not-read-endpoint',
      command: 'metro api read-mock <endpoint-id> --file <request.json|yaml> --read-gate <api-read-gate.json> --mock-response <response-data.json> [--actor <id>] [--json]',
      apiAccess: 'none',
      readEnabledInCurrentCli: false,
      requiresReadGate: `metro api read-gate validate --file <api-read-gate-for-${endpoint.id}.json> [--json]`,
      producesReadResult: 'metro.api.read-result.v1',
      producesReadAuditTemplate: 'metro.api.read-audit.template.v1',
    };
    return coverage;
  }, {});
}

function buildApiReadMockBundle(options = {}) {
  const {
    endpointId,
    requestInput,
    readGate,
    mockResponse,
    readGateRootDir = process.cwd(),
    actor = null,
  } = options;

  const endpoint = getApiEndpoint(endpointId || readGate?.binding?.endpointId);
  const readGateValidation = validateApiReadGate(readGate, { rootDir: readGateRootDir });
  const readResult = buildMockedApiReadResult({
    endpointId,
    requestInput,
    readGate,
    responseData: mockResponse,
    rootDir: readGateRootDir,
  });
  const readResultValidation = verifyApiReadResult(readResult);
  const readAuditTemplate = readResultValidation.valid
    ? buildApiReadAuditTemplate({
      readGate,
      readResult,
      readGateRootDir,
      actor,
    })
    : null;

  const valid = readGateValidation.valid
    && readResult.blocked === false
    && readResultValidation.valid
    && Boolean(readAuditTemplate);

  return {
    schemaVersion: API_READ_MOCK_SCHEMA_VERSION,
    generatedFrom: 'packages/metro-core/src/api-catalog/read-mock.js',
    apiAccess: 'none',
    liveExecution: clone(LOCAL_ONLY_LIVE_EXECUTION),
    readEnabledInCurrentCli: false,
    endpoint: endpoint ? endpointSnapshot(endpoint) : null,
    tenant: readGate?.binding?.tenant || readResult.tenant || null,
    readGateValidation,
    readResult,
    readResultValidation,
    readAuditTemplate,
    blocked: !valid,
    nextSafeStep: valid
      ? 'Use readResult as mocked output proof and write readAuditTemplate.row to a JSONL evidence file before running metro api read-audit validate. Live expert API read remains disabled.'
      : 'Fix the read gate, request input, or mocked response data before using this as read-runner proof.',
  };
}

module.exports = {
  API_READ_MOCK_SCHEMA_VERSION,
  apiReadMockCoverage,
  buildApiReadMockBundle,
};
