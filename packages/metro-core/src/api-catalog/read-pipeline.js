'use strict';

const { getApiEndpoint, listApiEndpoints } = require('./index');
const {
  buildApiReadAuditWritePlan,
  writeApiReadAuditJsonl,
} = require('./read-audit');
const { buildApiReadMockBundle } = require('./read-mock');

const API_READ_PIPELINE_SCHEMA_VERSION = 'metro.api.read-pipeline.v1';

const LOCAL_ONLY_LIVE_EXECUTION = {
  enabledInCurrentCli: false,
  reason: 'Expert API read-pipeline runs mocked read-result and local read-audit evidence only; the current CLI does not call Metronome for expert API reads.',
  nextSafeStep: 'Use read-pipeline output as local mocked proof for request binding, output verification, and append-only audit writing. Future live reads remain disabled until a guarded runner is explicitly authorized.',
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

function apiReadPipelineCoverage() {
  return listApiEndpoints().reduce((coverage, endpoint) => {
    const isReadEndpoint = endpoint.operationType === 'read';
    coverage[endpoint.id] = {
      schemaVersion: API_READ_PIPELINE_SCHEMA_VERSION,
      supportStatus: isReadEndpoint ? 'local-mocked-read-audit-pipeline' : 'not-read-endpoint',
      command: 'metro api read-pipeline <endpoint-id> --file <request.json|yaml> --read-gate <api-read-gate.json> --mock-response <response-data.json> --out <api-read-audit.jsonl> --actor <id> (--dry-run|--write) [--timestamp <ISO>] [--json]',
      apiAccess: 'none',
      readEnabledInCurrentCli: false,
      requiresReadGate: `metro api read-gate validate --file <api-read-gate-for-${endpoint.id}.json> [--json]`,
      producesReadResult: 'metro.api.read-result.v1',
      producesReadAuditWrite: 'metro.api.read-audit.write.v1',
    };
    return coverage;
  }, {});
}

function baseResult(options = {}) {
  const { mode, endpoint, tenant, readMock, readAuditWrite, blocked } = options;
  return {
    schemaVersion: API_READ_PIPELINE_SCHEMA_VERSION,
    generatedFrom: 'metronome-cli/src/api-catalog/read-pipeline.js',
    apiAccess: 'none',
    liveExecution: clone(LOCAL_ONLY_LIVE_EXECUTION),
    readEnabledInCurrentCli: false,
    transportMode: 'mocked',
    mode,
    endpoint,
    tenant,
    summary: {
      endpointId: endpoint?.id || null,
      tenant: tenant || null,
      requestHash: readMock?.readResult?.requestSummary?.requestHash || null,
      responseHash: readMock?.readResult?.responseSummary?.responseHash || null,
      auditRowHash: readAuditWrite?.rowHash || null,
      auditRowsWritten: readAuditWrite?.write?.rowsWritten || 0,
      readResultValid: readMock?.readResultValidation?.valid === true,
      auditRowValid: readAuditWrite?.rowValidation?.valid === true,
      liveReadEnabledInCurrentCli: false,
    },
    readMock,
    readAuditWrite,
    blocked,
    nextSafeStep: blocked
      ? 'Fix the read gate, request input, mocked response data, actor, timestamp, or audit output path before using this as read-pipeline proof.'
      : 'Keep this read-pipeline output as local mocked read evidence. Live expert API read remains disabled until the guarded runner is explicitly authorized.',
  };
}

function buildApiReadPipelinePlan(options = {}) {
  const {
    endpointId,
    requestInput,
    readGate,
    mockResponse,
    readGateRootDir = process.cwd(),
    actor = null,
    outPath = null,
    mode = null,
    timestamp = null,
  } = options;

  const endpoint = getApiEndpoint(endpointId || readGate?.binding?.endpointId);
  const readMock = buildApiReadMockBundle({
    endpointId,
    requestInput,
    readGate,
    mockResponse,
    readGateRootDir,
    actor,
  });

  let readAuditWrite = null;
  if (!readMock.blocked && readMock.readResult) {
    readAuditWrite = buildApiReadAuditWritePlan({
      readGate,
      readResult: readMock.readResult,
      readGateRootDir,
      actor,
      outPath,
      mode,
      timestamp,
    });
  }

  const blocked = readMock.blocked || !readAuditWrite || readAuditWrite.blocked;
  return baseResult({
    mode,
    endpoint: endpoint ? endpointSnapshot(endpoint) : readMock.endpoint,
    tenant: readMock.tenant || readGate?.binding?.tenant || null,
    readMock,
    readAuditWrite,
    blocked,
  });
}

function writeApiReadPipeline(plan, options = {}) {
  if (!plan || plan.schemaVersion !== API_READ_PIPELINE_SCHEMA_VERSION) {
    throw new Error('writeApiReadPipeline requires a metro.api.read-pipeline.v1 plan.');
  }
  if (plan.mode !== 'write' || plan.blocked || !plan.readAuditWrite) return clone(plan);
  const writtenAudit = writeApiReadAuditJsonl(plan.readAuditWrite, options);
  return {
    ...clone(plan),
    summary: {
      ...clone(plan.summary),
      auditRowHash: writtenAudit.rowHash,
      auditRowsWritten: writtenAudit.write?.rowsWritten || 0,
      auditRowValid: writtenAudit.rowValidation?.valid === true,
    },
    readAuditWrite: writtenAudit,
    blocked: writtenAudit.blocked,
    nextSafeStep: writtenAudit.blocked
      ? 'Fix the local read-audit JSONL file before using this read-pipeline output as evidence.'
      : 'Keep this read-pipeline output and JSONL row as local mocked read evidence. Live expert API read remains disabled until the guarded runner is explicitly authorized.',
  };
}

module.exports = {
  API_READ_PIPELINE_SCHEMA_VERSION,
  apiReadPipelineCoverage,
  buildApiReadPipelinePlan,
  writeApiReadPipeline,
};
