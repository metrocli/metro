'use strict';

const { getApiEndpoint, listApiEndpoints } = require('./index');
const { buildApiEndpointReadPlan } = require('./read-plan');
const { validateApiReadGate } = require('./read-gate');
const { normalizeRequestInput } = require('./validation');
const { assertReadOnlyEndpoint, createGuardedMetronomeReadClient, LIVE_READ_CONFIRMATION } = require('../clients/metronome-read');
const { buildMetronomeHttpTransport } = require('../clients/metronome-http');
const { isLiveReadEndpoint } = require('../clients/live-endpoints');
const { evaluateApiReadGates } = require('./read-refusal');
const { sha256 } = require('../preview');

const API_READ_RESULT_SCHEMA_VERSION = 'metro.api.read-result.v1';
const API_READ_RESULT_VALIDATION_SCHEMA_VERSION = 'metro.api.read-result.validation.v1';

const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const SECRET_KEY_PATTERN = /(?:api[_-]?key|secret|token|authorization|password|private[_-]?key|bearer)/i;
const SECRET_VALUE_PATTERN = /(?:bearer\s+[A-Za-z0-9._-]+|sk_live_[A-Za-z0-9]+|sk_test_[A-Za-z0-9]+|rk_live_[A-Za-z0-9]+|prod_[A-Za-z0-9]{12,})/i;

const LOCAL_ONLY_LIVE_EXECUTION = {
  enabledInCurrentCli: false,
  reason: 'Expert API read-result verification is local or mocked only; the current CLI does not run live expert API read commands.',
  nextSafeStep: 'Use mocked read-result verification as implementation proof. Future live reads remain disabled until a guarded runner is explicitly authorized.',
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function sortedKeys(value) {
  return Object.keys(value || {}).sort();
}

function isSha256(value) {
  return typeof value === 'string' && SHA256_PATTERN.test(value);
}

function finding(id, severity, message, pathName, remediation) {
  return { id, severity, message, path: pathName, remediation };
}

function add(findings, id, message, pathName, remediation, severity = 'error') {
  findings.push(finding(id, severity, message, pathName, remediation));
}

function scanForSecrets(value, findings, pathName = '$') {
  if (typeof value === 'string') {
    if (SECRET_VALUE_PATTERN.test(value)) {
      add(
        findings,
        'MTR-APIREQ-003',
        `API read result contains a secret-like value at ${pathName}.`,
        pathName,
        'Do not include API keys, bearer tokens, passwords, or raw environment values in read-result fixtures.',
      );
    }
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => scanForSecrets(item, findings, `${pathName}[${index}]`));
    return;
  }

  if (!isObject(value)) return;

  for (const [key, child] of Object.entries(value)) {
    const childPath = pathName === '$' ? key : `${pathName}.${key}`;
    if (SECRET_KEY_PATTERN.test(key)) {
      add(
        findings,
        'MTR-APIREQ-003',
        `API read result contains forbidden secret-shaped field ${childPath}.`,
        childPath,
        'Use non-secret fingerprints and hashes only.',
      );
    }
    scanForSecrets(child, findings, childPath);
  }
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

function encodeQueryValue(value) {
  if (value === true) return 'true';
  if (value === false) return 'false';
  return String(value);
}

function queryString(query) {
  const parts = [];
  for (const key of sortedKeys(query)) {
    const value = query[key];
    const values = Array.isArray(value) ? value : [value];
    for (const item of values) {
      if (item === undefined || item === null || String(item).trim() === '') continue;
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(encodeQueryValue(item))}`);
    }
  }
  return parts.join('&');
}

function applyPathParams(pathTemplate, pathValues) {
  let path = pathTemplate;
  for (const key of sortedKeys(pathValues)) {
    path = path.replaceAll(`{${key}}`, encodeURIComponent(String(pathValues[key])));
  }
  return path;
}

function buildTransportRequest(endpoint, requestInput) {
  const request = normalizeRequestInput(requestInput, endpoint);
  const basePath = applyPathParams(endpoint.path, request.path);
  const query = queryString(request.query);
  const path = query ? `${basePath}${basePath.includes('?') ? '&' : '?'}${query}` : basePath;
  const body = sortedKeys(request.body).length > 0 ? clone(request.body) : undefined;
  return {
    method: endpoint.method,
    path,
    body,
    requestParts: {
      envelopeMode: request.envelopeMode,
      bodyKeys: sortedKeys(request.body),
      queryKeys: sortedKeys(request.query),
      pathKeys: sortedKeys(request.path),
    },
  };
}

function dataType(value) {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'null';
  return typeof value;
}

function summarizeResponseData(data) {
  const type = dataType(data);
  return {
    dataType: type,
    topLevelKeys: isObject(data) ? sortedKeys(data) : [],
    itemCount: Array.isArray(data) ? data.length : null,
    responseHash: sha256(data),
  };
}

function buildMockedApiReadResult(options = {}) {
  const {
    endpointId,
    requestInput,
    readGate,
    responseData,
    rootDir = process.cwd(),
  } = options;

  const endpoint = getApiEndpoint(endpointId || readGate?.binding?.endpointId);
  const gateValidation = validateApiReadGate(readGate, { rootDir });
  if (!endpoint || endpoint.operationType !== 'read' || !gateValidation.valid) {
    return {
      schemaVersion: API_READ_RESULT_SCHEMA_VERSION,
      generatedFrom: 'packages/metro-core/src/api-catalog/read-result.js',
      apiAccess: 'none',
      liveExecution: clone(LOCAL_ONLY_LIVE_EXECUTION),
      readEnabledInCurrentCli: false,
      transportMode: 'mocked',
      endpoint: endpoint ? endpointSnapshot(endpoint) : null,
      readGateValidation: gateValidation,
      requestSummary: null,
      responseSummary: null,
      responseData: null,
      blocked: true,
      blockReason: endpoint ? 'API read gate validation failed.' : 'Unknown or non-read endpoint.',
      nextSafeStep: 'Fix the API read gate before running the mocked read-result contract.',
    };
  }

  const readPlan = buildApiEndpointReadPlan(endpoint.id, requestInput, { tenant: readGate.binding.tenant });
  if (!readPlan || readPlan.blocked || readPlan.requestSummary?.requestHash !== readGate.binding.requestHash) {
    return {
      schemaVersion: API_READ_RESULT_SCHEMA_VERSION,
      generatedFrom: 'packages/metro-core/src/api-catalog/read-result.js',
      apiAccess: 'none',
      liveExecution: clone(LOCAL_ONLY_LIVE_EXECUTION),
      readEnabledInCurrentCli: false,
      transportMode: 'mocked',
      endpoint: endpointSnapshot(endpoint),
      readGateValidation: gateValidation,
      requestSummary: readPlan?.requestSummary || null,
      responseSummary: null,
      responseData: null,
      blocked: true,
      blockReason: 'Request input does not reproduce the reviewed read-gate request hash.',
      nextSafeStep: 'Use the exact request file that produced the reviewed API read-plan hash.',
    };
  }

  const transportRequest = buildTransportRequest(endpoint, requestInput);
  assertReadOnlyEndpoint(transportRequest);
  const responseSummary = summarizeResponseData(responseData);

  const result = {
    schemaVersion: API_READ_RESULT_SCHEMA_VERSION,
    generatedFrom: 'packages/metro-core/src/api-catalog/read-result.js',
    apiAccess: 'mocked-read',
    liveExecution: clone(LOCAL_ONLY_LIVE_EXECUTION),
    readEnabledInCurrentCli: false,
    transportMode: 'mocked',
    tenant: readGate.binding.tenant,
    endpoint: endpointSnapshot(endpoint),
    readGateValidation: {
      schemaVersion: gateValidation.schemaVersion,
      valid: gateValidation.valid,
      summary: clone(gateValidation.summary),
    },
    requestSummary: {
      method: transportRequest.method,
      path: transportRequest.path,
      requestHash: readPlan.requestSummary.requestHash,
      permissionScope: endpoint.permissionScope,
      envelopeMode: readPlan.requestSummary.envelopeMode,
      bodyKeys: clone(transportRequest.requestParts.bodyKeys),
      queryKeys: clone(transportRequest.requestParts.queryKeys),
      pathKeys: clone(transportRequest.requestParts.pathKeys),
    },
    responseSummary,
    responseData: clone(responseData),
    verification: {
      outputContract: clone(readPlan.outputContract),
      checks: clone(readPlan.verificationPlan),
    },
    blocked: false,
    nextSafeStep: 'Use this mocked read result as output-contract proof. Live expert API read remains disabled in the current CLI.',
    sources: clone(readPlan.sources),
  };
  result.verificationResult = verifyApiReadResult(result);
  return result;
}

function apiReadResultCoverage() {
  return listApiEndpoints().reduce((coverage, endpoint) => {
    const isReadEndpoint = endpoint.operationType === 'read';
    coverage[endpoint.id] = {
      schemaVersion: API_READ_RESULT_SCHEMA_VERSION,
      supportStatus: isReadEndpoint ? 'mocked-read-result-contract' : 'not-read-endpoint',
      validationCommand: 'metro api read-result verify --file <api-read-result.json> [--json]',
      apiAccess: 'none',
      readEnabledInCurrentCli: false,
      requiresReadGate: `metro api read-gate validate --file <api-read-gate-for-${endpoint.id}.json> [--json]`,
    };
    return coverage;
  }, {});
}

function buildLiveApiReadResult(options = {}) {
  const {
    endpointId,
    requestInput,
    readGate,
    responseData,
    httpStatus = 200,
    rootDir = process.cwd(),
  } = options;

  const endpoint = getApiEndpoint(endpointId || readGate?.binding?.endpointId);
  const gateValidation = validateApiReadGate(readGate, { rootDir });
  const readPlan = buildApiEndpointReadPlan(endpoint.id, requestInput, { tenant: readGate.binding.tenant });
  const transportRequest = buildTransportRequest(endpoint, requestInput);
  const responseSummary = summarizeResponseData(responseData);

  const result = {
    schemaVersion: API_READ_RESULT_SCHEMA_VERSION,
    generatedFrom: 'packages/metro-core/src/api-catalog/read-result.js',
    apiAccess: 'live-read',
    liveExecution: {
      enabledInCurrentCli: true,
      reason: 'This output came from a guarded live Metronome read authorized in the current CLI turn.',
      nextSafeStep: 'Store stdout JSON as evidence and optionally append metro api read-audit rows.',
    },
    readEnabledInCurrentCli: true,
    transportMode: 'live',
    httpStatus,
    tenant: readGate.binding.tenant,
    endpoint: endpointSnapshot(endpoint),
    readGateValidation: {
      schemaVersion: gateValidation.schemaVersion,
      valid: gateValidation.valid,
      summary: clone(gateValidation.summary),
    },
    requestSummary: {
      method: transportRequest.method,
      path: transportRequest.path,
      requestHash: readPlan.requestSummary.requestHash,
      permissionScope: endpoint.permissionScope,
      envelopeMode: readPlan.requestSummary.envelopeMode,
      bodyKeys: clone(transportRequest.requestParts.bodyKeys),
      queryKeys: clone(transportRequest.requestParts.queryKeys),
      pathKeys: clone(transportRequest.requestParts.pathKeys),
    },
    responseSummary,
    responseData: clone(responseData),
    verification: {
      outputContract: clone(readPlan.outputContract),
      checks: clone(readPlan.verificationPlan),
    },
    blocked: false,
    nextSafeStep: 'Use metro api read-audit write to persist this read as append-only evidence.',
    sources: clone(readPlan.sources),
  };
  result.verificationResult = verifyApiReadResult(result);
  return result;
}

async function runLiveApiRead(options = {}) {
  const {
    endpointId,
    requestInput,
    readGate,
    confirmLiveRead,
    tenantFlags = {},
    rootDir = process.cwd(),
    transportFactory = buildMetronomeHttpTransport,
  } = options;

  const evaluation = evaluateApiReadGates({
    endpointId,
    tenant: readGate?.binding?.tenant || null,
    tenantFlags,
    requestInput,
    requestFileProvided: true,
    readGate,
    readGateFileProvided: true,
    readGateRootDir: rootDir,
    confirmLiveRead,
  });

  if (!evaluation.ready) {
    return {
      blocked: true,
      blockers: evaluation.blockers,
      blockReason: evaluation.blockers[0]?.message || 'Live read gates not satisfied.',
    };
  }

  const endpoint = evaluation.endpoint;
  if (!isLiveReadEndpoint(endpoint.id)) {
    return {
      blocked: true,
      blockReason: `${endpoint.id} is not enabled for live read.`,
    };
  }

  const transport = transportFactory(evaluation.keyResolution.value);
  const readClient = createGuardedMetronomeReadClient({
    tenant: readGate.binding.tenant,
    liveReadConfirmation: confirmLiveRead,
    transport,
    transportMode: 'live',
  });

  const transportRequest = buildTransportRequest(endpoint, requestInput);
  assertReadOnlyEndpoint(transportRequest);
  const response = await readClient.request(transportRequest);
  const responseData = Object.prototype.hasOwnProperty.call(response || {}, 'data') ? response.data : response;

  return buildLiveApiReadResult({
    endpointId: endpoint.id,
    requestInput,
    readGate,
    responseData,
    httpStatus: response?.status || 200,
    rootDir,
  });
}

async function runMockedApiRead(options = {}) {
  const {
    endpointId,
    requestInput,
    readGate,
    readClient,
    rootDir = process.cwd(),
  } = options;

  const endpoint = getApiEndpoint(endpointId || readGate?.binding?.endpointId);
  const gateValidation = validateApiReadGate(readGate, { rootDir });
  if (!endpoint || endpoint.operationType !== 'read' || !gateValidation.valid) {
    return {
      schemaVersion: API_READ_RESULT_SCHEMA_VERSION,
      generatedFrom: 'packages/metro-core/src/api-catalog/read-result.js',
      apiAccess: 'none',
      liveExecution: clone(LOCAL_ONLY_LIVE_EXECUTION),
      readEnabledInCurrentCli: false,
      transportMode: readClient?.transportMode || null,
      endpoint: endpoint ? endpointSnapshot(endpoint) : null,
      readGateValidation: gateValidation,
      requestSummary: null,
      responseSummary: null,
      responseData: null,
      blocked: true,
      blockReason: endpoint ? 'API read gate validation failed.' : 'Unknown or non-read endpoint.',
      nextSafeStep: 'Fix the API read gate and use an injected mocked read client before running the mocked read-result contract.',
    };
  }

  if (!readClient || readClient.transportMode !== 'mocked' || typeof readClient.request !== 'function') {
    return {
      schemaVersion: API_READ_RESULT_SCHEMA_VERSION,
      generatedFrom: 'packages/metro-core/src/api-catalog/read-result.js',
      apiAccess: 'none',
      liveExecution: clone(LOCAL_ONLY_LIVE_EXECUTION),
      readEnabledInCurrentCli: false,
      transportMode: readClient?.transportMode || null,
      endpoint: endpointSnapshot(endpoint),
      readGateValidation: gateValidation,
      requestSummary: null,
      responseSummary: null,
      responseData: null,
      blocked: true,
      blockReason: 'Mocked expert API read runner requires an injected guarded read client with transportMode mocked.',
      nextSafeStep: 'Use createGuardedMetronomeReadClient with transportMode mocked in offline tests only.',
    };
  }

  const readPlan = buildApiEndpointReadPlan(endpoint.id, requestInput, { tenant: readGate.binding.tenant });
  if (!readPlan || readPlan.blocked || readPlan.requestSummary?.requestHash !== readGate.binding.requestHash) {
    return {
      schemaVersion: API_READ_RESULT_SCHEMA_VERSION,
      generatedFrom: 'packages/metro-core/src/api-catalog/read-result.js',
      apiAccess: 'none',
      liveExecution: clone(LOCAL_ONLY_LIVE_EXECUTION),
      readEnabledInCurrentCli: false,
      transportMode: readClient.transportMode,
      endpoint: endpointSnapshot(endpoint),
      readGateValidation: gateValidation,
      requestSummary: readPlan?.requestSummary || null,
      responseSummary: null,
      responseData: null,
      blocked: true,
      blockReason: 'Request input does not reproduce the reviewed read-gate request hash.',
      nextSafeStep: 'Use the exact request file that produced the reviewed API read-plan hash.',
    };
  }

  const transportRequest = buildTransportRequest(endpoint, requestInput);
  assertReadOnlyEndpoint(transportRequest);
  const response = await readClient.request(transportRequest);
  const responseData = Object.prototype.hasOwnProperty.call(response || {}, 'data') ? response.data : response;
  return buildMockedApiReadResult({
    endpointId: endpoint.id,
    requestInput,
    readGate,
    responseData,
    rootDir,
  });
}

function verifyApiReadResult(input) {
  const findings = [];
  scanForSecrets(input, findings);

  if (!isObject(input)) {
    return {
      schemaVersion: API_READ_RESULT_VALIDATION_SCHEMA_VERSION,
      valid: false,
      findings: [finding('MTR-API-READ-RESULT-000', 'error', 'API read result must be a JSON object.', '$', 'Verify a metro.api.read-result.v1 JSON object.')],
      summary: { endpointId: null, tenant: null, responseHash: null },
    };
  }

  if (input.schemaVersion !== API_READ_RESULT_SCHEMA_VERSION) {
    add(findings, 'MTR-API-READ-RESULT-001', `schemaVersion must be ${API_READ_RESULT_SCHEMA_VERSION}.`, 'schemaVersion', 'Use a current metro.api.read-result.v1 output.');
  }
  const isLiveRead = input.apiAccess === 'live-read' && input.transportMode === 'live';
  const isMockedRead = input.apiAccess === 'mocked-read' && input.transportMode === 'mocked';
  if (!isLiveRead && !isMockedRead) {
    add(findings, 'MTR-API-READ-RESULT-001', 'apiAccess must be mocked-read or live-read.', 'apiAccess', 'Use a read-result produced by metro api read or metro api read-mock.');
  }
  if (isMockedRead && (input.liveExecution?.enabledInCurrentCli !== false || input.readEnabledInCurrentCli !== false)) {
    add(findings, 'MTR-API-READ-RESULT-001', 'mocked read result must keep live reads disabled.', 'liveExecution.enabledInCurrentCli', 'Do not use mocked read-result output to claim live reads are enabled.');
  }
  if (isLiveRead && input.liveExecution?.enabledInCurrentCli !== true) {
    add(findings, 'MTR-API-READ-RESULT-001', 'live read result must declare liveExecution.enabledInCurrentCli=true.', 'liveExecution.enabledInCurrentCli', 'Regenerate from metro api read.');
  }
  if (isMockedRead && input.transportMode !== 'mocked') {
    add(findings, 'MTR-CLIENT-001', 'transportMode must be mocked for mocked-read results.', 'transportMode', 'Only mocked transport output is valid for mocked reads.');
  }
  if (isLiveRead && input.transportMode !== 'live') {
    add(findings, 'MTR-CLIENT-001', 'transportMode must be live for live-read results.', 'transportMode', 'Regenerate from metro api read.');
  }
  if (input.blocked !== false) {
    add(findings, 'MTR-API-READ-RESULT-001', 'blocked must be false for a verified read result.', 'blocked', 'Resolve the blocked read result before treating it as output proof.');
  }

  const endpoint = getApiEndpoint(input.endpoint?.id);
  if (!endpoint || endpoint.operationType !== 'read') {
    add(findings, 'MTR-ENDPOINT-001', 'endpoint.id must name a reviewed read endpoint.', 'endpoint.id', 'Use a reviewed read endpoint ID from metro api catalog.');
  } else {
    for (const field of ['method', 'path', 'operationType', 'permissionScope']) {
      if (input.endpoint?.[field] !== endpoint[field]) {
        add(findings, 'MTR-ENDPOINT-001', `endpoint.${field} must match the reviewed endpoint catalog.`, `endpoint.${field}`, 'Regenerate the read result from the current endpoint catalog.');
      }
    }
  }

  if (!['sandbox', 'production'].includes(input.tenant)) {
    add(findings, 'MTR-TENANT-001', 'tenant must be sandbox or production.', 'tenant', 'Use a read gate generated with exactly one tenant.');
  }
  if (input.tenant !== input.readGateValidation?.summary?.tenant) {
    add(findings, 'MTR-TENANT-001', 'tenant must match readGateValidation.summary.tenant.', 'tenant', 'Keep result tenant bound to the validated read gate.');
  }
  if (input.readGateValidation?.valid !== true) {
    add(findings, 'MTR-LIVE-READ-001', 'readGateValidation.valid must be true.', 'readGateValidation.valid', 'Validate the read gate before producing a read result.');
  }

  if (!isObject(input.requestSummary)) {
    add(findings, 'MTR-API-READ-RESULT-001', 'requestSummary is required.', 'requestSummary', 'Read result must include a secret-free request summary.');
  } else {
    try {
      assertReadOnlyEndpoint(input.requestSummary);
    } catch (error) {
      add(findings, error.code || 'MTR-READ-ENDPOINT-000', `requestSummary is not read-only: ${error.message}`, 'requestSummary', 'Read-result request summaries must contain only read endpoints.');
    }
    if (input.requestSummary.permissionScope !== input.endpoint?.permissionScope) {
      add(findings, 'MTR-ENDPOINT-001', 'requestSummary.permissionScope must match endpoint.permissionScope.', 'requestSummary.permissionScope', 'Bind request summary to the reviewed permission scope.');
    }
    if (input.requestSummary.requestHash !== input.readGateValidation?.summary?.requestHash) {
      add(findings, 'MTR-HASH-002', 'requestSummary.requestHash must match the validated read gate request hash.', 'requestSummary.requestHash', 'Regenerate the read result from the reviewed request input.');
    }
    if (!isSha256(input.requestSummary.requestHash)) {
      add(findings, 'MTR-HASH-001', 'requestSummary.requestHash must be sha256:<64 lowercase hex>.', 'requestSummary.requestHash', 'Use the request hash emitted by metro api read-plan.');
    }
  }

  if (!isObject(input.responseSummary)) {
    add(findings, 'MTR-API-READ-RESULT-001', 'responseSummary is required.', 'responseSummary', 'Read result must include response summary metadata.');
  } else {
    if (!isSha256(input.responseSummary.responseHash)) {
      add(findings, 'MTR-HASH-001', 'responseSummary.responseHash must be sha256:<64 lowercase hex>.', 'responseSummary.responseHash', 'Hash the response data with the CLI canonical hash helper.');
    } else if (input.responseSummary.responseHash !== sha256(input.responseData)) {
      add(findings, 'MTR-HASH-002', 'responseSummary.responseHash does not match responseData.', 'responseSummary.responseHash', 'Regenerate the read result after reviewing changed response data.');
    }
    if (!['array', 'object', 'string', 'number', 'boolean', 'null', 'undefined'].includes(input.responseSummary.dataType)) {
      add(findings, 'MTR-API-READ-RESULT-001', 'responseSummary.dataType is not recognized.', 'responseSummary.dataType', 'Use the generated response summary from the read-result runner.');
    }
  }

  if (!isObject(input.verification) || !isObject(input.verification.outputContract)) {
    add(findings, 'MTR-VERIFY-001', 'verification.outputContract is required.', 'verification.outputContract', 'Carry forward the endpoint response contract into read-result output.');
  } else if (typeof input.verification.outputContract.summary !== 'string' || input.verification.outputContract.summary.trim() === '') {
    add(findings, 'MTR-VERIFY-001', 'verification.outputContract.summary is required.', 'verification.outputContract.summary', 'Use the catalog response contract summary.');
  }
  if (!list(input.verification?.checks).some((check) => typeof check.expectation === 'string' && check.expectation.trim() !== '')) {
    add(findings, 'MTR-VERIFY-001', 'verification.checks must include at least one expectation.', 'verification.checks', 'Carry forward read-plan verification checks.');
  }

  const valid = !findings.some((item) => item.severity === 'error');
  return {
    schemaVersion: API_READ_RESULT_VALIDATION_SCHEMA_VERSION,
    generatedFrom: 'packages/metro-core/src/api-catalog/read-result.js',
    apiAccess: 'none',
    liveExecution: clone(LOCAL_ONLY_LIVE_EXECUTION),
    readEnabledInCurrentCli: false,
    summary: {
      endpointId: input.endpoint?.id || null,
      tenant: input.tenant || null,
      permissionScope: input.endpoint?.permissionScope || null,
      requestHash: input.requestSummary?.requestHash || null,
      responseHash: input.responseSummary?.responseHash || null,
      transportMode: input.transportMode || null,
      responseDataType: input.responseSummary?.dataType || null,
    },
    valid,
    findings,
    nextSafeStep: valid
      ? (isLiveRead
        ? 'Keep this as live read evidence. Pair with metro api read-audit write when audit rows are required.'
        : 'Keep this as mocked expert API read output proof.')
      : 'Fix the API read result and re-run metro api read-result verify before using it as output-contract proof.',
  };
}

module.exports = {
  API_READ_RESULT_SCHEMA_VERSION,
  API_READ_RESULT_VALIDATION_SCHEMA_VERSION,
  apiReadResultCoverage,
  buildLiveApiReadResult,
  buildMockedApiReadResult,
  buildTransportRequest,
  runLiveApiRead,
  runMockedApiRead,
  summarizeResponseData,
  verifyApiReadResult,
};
