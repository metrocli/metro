'use strict';

const fs = require('fs');
const path = require('path');
const { getApiEndpoint, listApiEndpoints } = require('./index');
const { validateApiReadGate } = require('./read-gate');
const { verifyApiReadResult } = require('./read-result');
const { assertReadOnlyEndpoint } = require('../clients/metronome-read');
const { sha256 } = require('../preview');

const API_READ_AUDIT_SCHEMA_VERSION = 'metro.api.read-audit.v1';
const API_READ_AUDIT_TEMPLATE_SCHEMA_VERSION = 'metro.api.read-audit.template.v1';
const API_READ_AUDIT_VALIDATION_SCHEMA_VERSION = 'metro.api.read-audit.validation.v1';
const API_READ_AUDIT_WRITE_SCHEMA_VERSION = 'metro.api.read-audit.write.v1';

const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const VALID_TENANTS = new Set(['sandbox', 'production']);
const VALID_OUTCOMES = new Set(['planned', 'success', 'failure', 'blocked']);
const VALID_VERIFICATION_STATUSES = new Set(['not_started', 'passed', 'failed', 'blocked']);
const SECRET_KEY_PATTERN = /(?:api[_-]?key|secret|token|authorization|password|private[_-]?key|bearer)/i;
const SECRET_KEY_ALLOWLIST = new Set(['authorizationId', 'keyFingerprint', 'secretScanRequired']);
const SECRET_VALUE_PATTERN = /(?:bearer\s+[A-Za-z0-9._-]+|sk_live_[A-Za-z0-9]+|sk_test_[A-Za-z0-9]+|rk_live_[A-Za-z0-9]+|prod_[A-Za-z0-9]{12,})/i;

const LOCAL_ONLY_LIVE_EXECUTION = {
  enabledInCurrentCli: false,
  reason: 'Expert API read-audit evidence is local or mocked only; the current CLI does not run live expert API read commands.',
  nextSafeStep: 'Validate read-audit JSONL locally. Future live reads remain disabled until a guarded runner and audit writer are explicitly authorized.',
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

function isSha256(value) {
  return typeof value === 'string' && SHA256_PATTERN.test(value);
}

function isIsoTimestamp(value) {
  if (typeof value !== 'string' || value.trim() === '') return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

function filled(value) {
  return value !== undefined && value !== null && String(value).trim() !== '' && !/^<[^>]+>$/.test(String(value).trim());
}

function finding(id, severity, message, pathName, remediation, context) {
  return {
    id,
    severity,
    message,
    path: pathName,
    remediation,
    ...(context ? { context } : {}),
  };
}

function add(findings, id, message, pathName, remediation, severity = 'error', context = null) {
  findings.push(finding(id, severity, message, pathName, remediation, context));
}

function scanForSecrets(value, findings, pathName = '$', context = null) {
  if (typeof value === 'string') {
    if (SECRET_VALUE_PATTERN.test(value)) {
      add(
        findings,
        'MTR-APIREQ-003',
        `API read-audit row contains a secret-like value at ${pathName}.`,
        pathName,
        'Store hashes, non-secret key fingerprints, and environment variable names only.',
        'error',
        context,
      );
    }
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => scanForSecrets(item, findings, `${pathName}[${index}]`, context));
    return;
  }

  if (!isObject(value)) return;

  for (const [key, child] of Object.entries(value)) {
    const childPath = pathName === '$' ? key : `${pathName}.${key}`;
    if (SECRET_KEY_PATTERN.test(key) && !SECRET_KEY_ALLOWLIST.has(key)) {
      add(
        findings,
        'MTR-APIREQ-003',
        `API read-audit row contains forbidden secret-shaped field ${childPath}.`,
        childPath,
        'Never store raw API keys, bearer tokens, passwords, Authorization headers, or secret values in read-audit evidence.',
        'error',
        context,
      );
    }
    scanForSecrets(child, findings, childPath, context);
  }
}

function requireFilled(findings, value, pathName, message, remediation, context) {
  if (!filled(value)) {
    add(findings, 'MTR-API-READ-AUDIT-001', message, pathName, remediation, 'error', context);
  }
}

function endpointSnapshot(endpoint) {
  return {
    id: endpoint.id,
    method: endpoint.method,
    path: endpoint.path,
    family: endpoint.family,
    operationType: endpoint.operationType,
    permissionScope: endpoint.permissionScope,
    sourceIds: clone(endpoint.sourceIds),
  };
}

function apiReadAuditCoverage() {
  return listApiEndpoints().reduce((coverage, endpoint) => {
    const isReadEndpoint = endpoint.operationType === 'read';
    coverage[endpoint.id] = {
      schemaVersion: API_READ_AUDIT_SCHEMA_VERSION,
      supportStatus: isReadEndpoint ? 'mocked-read-audit-contract' : 'not-read-endpoint',
      templateCommand: 'metro api read-audit template --read-gate <api-read-gate.json> --read-result <api-read-result.json> [--actor <id>] [--json]',
      writeCommand: 'metro api read-audit write --read-gate <api-read-gate.json> --read-result <api-read-result.json> --out <api-read-audit.jsonl> --actor <id> (--dry-run|--write) [--timestamp <ISO>] [--json]',
      validationCommand: 'metro api read-audit validate --file <api-read-audit.jsonl> [--json]',
      apiAccess: 'none',
      readEnabledInCurrentCli: false,
      requiresReadGate: `metro api read-gate validate --file <api-read-gate-for-${endpoint.id}.json> [--json]`,
      requiresReadResult: `metro api read-result verify --file <api-read-result-for-${endpoint.id}.json> [--json]`,
    };
    return coverage;
  }, {});
}

function buildApiReadAuditTemplate(options = {}) {
  const {
    readGate,
    readResult,
    readGateRootDir = process.cwd(),
    actor = null,
  } = options;

  const gateValidation = validateApiReadGate(readGate, { rootDir: readGateRootDir });
  const resultValidation = verifyApiReadResult(readResult);
  if (!gateValidation.valid || !resultValidation.valid) return null;

  const endpoint = getApiEndpoint(readResult.endpoint?.id);
  if (!endpoint || endpoint.operationType !== 'read') return null;
  if (readGate.binding?.endpointId !== readResult.endpoint?.id) return null;
  if (readGate.binding?.tenant !== readResult.tenant) return null;
  if (readGate.binding?.requestHash !== readResult.requestSummary?.requestHash) return null;

  const row = {
    schemaVersion: API_READ_AUDIT_SCHEMA_VERSION,
    timestamp: '<ISO timestamp>',
    cliVersion: '0.0.0',
    actor: {
      source: actor ? 'agent' : '<user|agent|ci>',
      id: actor || '<operator id>',
    },
    mode: 'read',
    apiAccess: 'mocked-read',
    liveExecution: clone(LOCAL_ONLY_LIVE_EXECUTION),
    readEnabledInCurrentCli: false,
    tenant: readResult.tenant,
    endpoint: endpointSnapshot(endpoint),
    readGate: {
      status: readGate.status,
      authorizationId: readGate.liveReadApproval?.approvalId || '<current-turn-authorization-id>',
      approvedBy: readGate.liveReadApproval?.approvedBy || '<current-turn-requester-or-reviewer>',
      currentTurnConfirmed: readGate.liveReadApproval?.currentTurnConfirmed === true,
      permissionScope: endpoint.permissionScope,
      requestHash: readGate.binding.requestHash,
      readPlanFileHash: readGate.readPlan?.fileHash,
    },
    keyFingerprint: {
      envVar: readGate.tenantProfile?.keyEnv || '<METRONOME_SANDBOX_KEY|METRONOME_PROD_KEY>',
      fingerprint: readGate.tenantProfile?.keyFingerprint || '<non-secret key fingerprint>',
    },
    requestSummary: {
      method: readResult.requestSummary.method,
      path: readResult.requestSummary.path,
      requestHash: readResult.requestSummary.requestHash,
      permissionScope: readResult.requestSummary.permissionScope,
      envelopeMode: readResult.requestSummary.envelopeMode,
      bodyKeys: clone(readResult.requestSummary.bodyKeys),
      queryKeys: clone(readResult.requestSummary.queryKeys),
      pathKeys: clone(readResult.requestSummary.pathKeys),
      requestSummaryStrategy: 'hash-and-field-names-only',
      rawRequestBodyStored: false,
    },
    responseSummary: clone(readResult.responseSummary),
    verification: {
      status: 'passed',
      outputContractSummary: readResult.verification?.outputContract?.summary,
      checks: clone(readResult.verification?.checks || []),
    },
    outcome: 'success',
  };

  return {
    schemaVersion: API_READ_AUDIT_TEMPLATE_SCHEMA_VERSION,
    generatedFrom: 'metronome-cli/src/api-catalog/read-audit.js',
    apiAccess: 'none',
    liveExecution: clone(LOCAL_ONLY_LIVE_EXECUTION),
    readEnabledInCurrentCli: false,
    endpoint: endpointSnapshot(endpoint),
    tenant: readResult.tenant,
    row,
    validationCommand: 'metro api read-audit validate --file <api-read-audit.jsonl> [--json]',
    notes: [
      'Write one JSON object per line.',
      'Replace the timestamp placeholder with the operation timestamp before validating.',
      'Do not store raw request bodies, raw response data, API keys, bearer tokens, Authorization headers, or .env values.',
      'This template proves mocked read-audit shape only; live expert API read remains disabled in the current CLI.',
    ],
    sources: clone(readResult.sources || endpoint.sources),
  };
}

function readAuditWriteBase(mode, outPath, findings = []) {
  return {
    schemaVersion: API_READ_AUDIT_WRITE_SCHEMA_VERSION,
    generatedFrom: 'metronome-cli/src/api-catalog/read-audit.js',
    apiAccess: 'none',
    liveExecution: clone(LOCAL_ONLY_LIVE_EXECUTION),
    readEnabledInCurrentCli: false,
    mode,
    endpoint: null,
    tenant: null,
    target: {
      path: outPath || null,
      appendOnly: true,
      overwrite: false,
      requiresExplicitWriteFlag: true,
    },
    rowHash: null,
    rowBytes: 0,
    row: null,
    rowValidation: null,
    fileValidation: null,
    write: {
      wrote: false,
      rowsWritten: 0,
      bytesWritten: 0,
    },
    blocked: findings.some((item) => item.severity === 'error'),
    findings,
    nextSafeStep: 'Fix the read-audit write inputs and re-run with --dry-run before writing JSONL evidence.',
  };
}

function buildApiReadAuditWritePlan(options = {}) {
  const {
    readGate,
    readResult,
    readGateRootDir = process.cwd(),
    actor = null,
    outPath = null,
    mode = null,
    timestamp = null,
  } = options;
  const findings = [];

  if (mode !== 'dry-run' && mode !== 'write') {
    add(findings, 'MTR-API-READ-AUDIT-WRITE-001', 'mode must be dry-run or write.', 'mode', 'Choose exactly one of --dry-run or --write.');
  }
  if (!filled(outPath)) {
    add(findings, 'MTR-API-READ-AUDIT-WRITE-002', 'outPath is required.', 'target.path', 'Pass --out <api-read-audit.jsonl> so local audit evidence has an explicit destination.');
  }
  if (!filled(actor)) {
    add(findings, 'MTR-API-READ-AUDIT-WRITE-003', 'actor is required.', 'actor', 'Pass --actor <id> so durable audit evidence records a non-secret operator or agent id.');
  }

  const effectiveTimestamp = timestamp || new Date().toISOString();
  if (!isIsoTimestamp(effectiveTimestamp)) {
    add(findings, 'MTR-API-READ-AUDIT-WRITE-004', 'timestamp must be an ISO UTC timestamp.', 'timestamp', 'Use new Date().toISOString() format, for example 2026-06-26T20:30:00.000Z.');
  }

  const template = buildApiReadAuditTemplate({
    readGate,
    readResult,
    readGateRootDir,
    actor,
  });
  if (!template) {
    add(
      findings,
      'MTR-API-READ-AUDIT-WRITE-005',
      'read-gate and read-result evidence must be valid and bound to the same reviewed read endpoint, tenant, and request hash.',
      'readGate',
      'Run metro api read-gate validate and metro api read-result verify, then retry with matching files.',
    );
  }

  const blockedBase = readAuditWriteBase(mode, outPath, findings);
  if (!template || findings.some((item) => item.severity === 'error')) return blockedBase;

  const row = clone(template.row);
  row.timestamp = effectiveTimestamp;
  const rowLine = `${JSON.stringify(row)}\n`;
  const rowValidation = validateApiReadAuditJsonl(rowLine);
  const rowFindings = rowValidation.valid ? [] : rowValidation.findings;

  return {
    ...blockedBase,
    endpoint: clone(template.endpoint),
    tenant: template.tenant,
    row,
    rowHash: sha256(row),
    rowBytes: Buffer.byteLength(rowLine, 'utf8'),
    rowValidation,
    blocked: rowFindings.some((item) => item.severity === 'error'),
    findings: rowFindings,
    nextSafeStep: mode === 'dry-run'
      ? 'Review this row, then re-run with --write to append one JSONL row locally. Live expert API read remains disabled.'
      : 'Append this row locally, then validate the JSONL file. Live expert API read remains disabled.',
  };
}

function writeApiReadAuditJsonl(plan, options = {}) {
  const fsImpl = options.fs || fs;
  const rootDir = options.rootDir || process.cwd();
  if (!plan || plan.schemaVersion !== API_READ_AUDIT_WRITE_SCHEMA_VERSION) {
    throw new Error('writeApiReadAuditJsonl requires a metro.api.read-audit.write.v1 plan.');
  }
  if (plan.mode !== 'write' || plan.blocked) return clone(plan);

  const targetPath = path.resolve(rootDir, plan.target.path);
  const rowLine = `${JSON.stringify(plan.row)}\n`;
  const existedBefore = fsImpl.existsSync(targetPath);
  const existingText = existedBefore ? fsImpl.readFileSync(targetPath, 'utf8') : '';
  if (existedBefore && existingText.trim() !== '') {
    const existingValidation = validateApiReadAuditJsonl(existingText);
    if (!existingValidation.valid) {
      return {
        ...clone(plan),
        target: {
          ...clone(plan.target),
          existedBefore,
        },
        fileValidation: existingValidation,
        blocked: true,
        findings: existingValidation.findings,
        write: {
          wrote: false,
          rowsWritten: 0,
          bytesWritten: 0,
        },
        nextSafeStep: 'Fix the existing read-audit JSONL before appending new evidence.',
      };
    }
  }

  fsImpl.mkdirSync(path.dirname(targetPath), { recursive: true });
  fsImpl.appendFileSync(targetPath, rowLine, 'utf8');
  const afterText = fsImpl.readFileSync(targetPath, 'utf8');
  const fileValidation = validateApiReadAuditJsonl(afterText);

  return {
    ...clone(plan),
    target: {
      ...clone(plan.target),
      existedBefore,
    },
    fileValidation,
    blocked: !fileValidation.valid,
    findings: fileValidation.valid ? [] : fileValidation.findings,
    write: {
      wrote: true,
      rowsWritten: 1,
      bytesWritten: Buffer.byteLength(rowLine, 'utf8'),
    },
    nextSafeStep: fileValidation.valid
      ? 'Keep this read-audit JSONL as local mocked read evidence. Live expert API read remains disabled until the guarded runner is explicitly authorized.'
      : 'Fix the read-audit JSONL and re-run metro api read-audit validate before using it as audit evidence.',
  };
}

function parseJsonl(text) {
  const rows = [];
  const findings = [];
  const lines = String(text || '').split(/\r?\n/);
  lines.forEach((line, index) => {
    if (line.trim() === '') return;
    try {
      rows.push({ index, row: JSON.parse(line) });
    } catch (error) {
      add(
        findings,
        'MTR-API-READ-AUDIT-014',
        `Read-audit JSONL line ${index + 1} is not valid JSON: ${error.message}`,
        '$',
        'Write exactly one JSON object per line.',
        'error',
        { row: index + 1 },
      );
    }
  });
  return { rows, findings };
}

function validateEndpoint(row, findings, context) {
  const endpoint = getApiEndpoint(row.endpoint?.id);
  if (!endpoint || endpoint.operationType !== 'read') {
    add(findings, 'MTR-ENDPOINT-001', 'endpoint.id must name a reviewed read endpoint.', 'endpoint.id', 'Use a reviewed read endpoint ID from metro api catalog.', 'error', context);
    return null;
  }

  for (const field of ['method', 'path', 'permissionScope']) {
    if (row.endpoint?.[field] !== endpoint[field]) {
      add(findings, 'MTR-ENDPOINT-001', `endpoint.${field} must match the reviewed endpoint catalog.`, `endpoint.${field}`, 'Regenerate the read-audit row from the current endpoint catalog.', 'error', context);
    }
  }
  return endpoint;
}

function validateApiReadAuditRow(row, index = 0) {
  const findings = [];
  const context = { row: index + 1 };

  if (!isObject(row)) {
    return [
      finding(
        'MTR-API-READ-AUDIT-000',
        'error',
        'Read-audit row must be a JSON object.',
        '$',
        'Write one JSON object per JSONL row.',
        context,
      ),
    ];
  }

  scanForSecrets(row, findings, '$', context);

  if (row.schemaVersion !== API_READ_AUDIT_SCHEMA_VERSION) {
    add(findings, 'MTR-API-READ-AUDIT-001', `schemaVersion must be ${API_READ_AUDIT_SCHEMA_VERSION}.`, 'schemaVersion', 'Use a current metro.api.read-audit.v1 row.', 'error', context);
  }
  if (!isIsoTimestamp(row.timestamp)) {
    add(findings, 'MTR-API-READ-AUDIT-002', 'timestamp must be an ISO UTC timestamp.', 'timestamp', 'Use new Date().toISOString() format.', 'error', context);
  }
  requireFilled(findings, row.cliVersion, 'cliVersion', 'cliVersion is required.', 'Record the CLI version that produced the read output.', context);
  if (!isObject(row.actor)) {
    add(findings, 'MTR-API-READ-AUDIT-003', 'actor is required.', 'actor', 'Record non-secret operator or agent identity metadata.', 'error', context);
  } else {
    requireFilled(findings, row.actor.source, 'actor.source', 'actor.source is required.', 'Use user, agent, or ci.', context);
    requireFilled(findings, row.actor.id, 'actor.id', 'actor.id is required.', 'Record a non-secret operator, agent, or CI id.', context);
  }
  if (row.mode !== 'read') {
    add(findings, 'MTR-API-READ-AUDIT-001', 'mode must be read.', 'mode', 'Use read-audit rows only for expert API read evidence.', 'error', context);
  }
  if (row.apiAccess !== 'mocked-read') {
    add(findings, 'MTR-API-READ-AUDIT-001', 'apiAccess must be mocked-read in the current CLI slice.', 'apiAccess', 'Do not use local read-audit evidence to claim live reads are enabled.', 'error', context);
  }
  if (row.liveExecution?.enabledInCurrentCli !== false || row.readEnabledInCurrentCli !== false) {
    add(findings, 'MTR-API-READ-AUDIT-001', 'read-audit rows must keep live expert API reads disabled.', 'liveExecution.enabledInCurrentCli', 'Keep live read execution disabled until the guarded runner is explicitly authorized.', 'error', context);
  }
  if (!VALID_TENANTS.has(row.tenant)) {
    add(findings, 'MTR-TENANT-001', 'tenant must be sandbox or production.', 'tenant', 'Bind every read-audit row to exactly one tenant.', 'error', context);
  }

  const endpoint = validateEndpoint(row, findings, context);
  if (endpoint && row.tenant && row.requestSummary?.permissionScope !== endpoint.permissionScope) {
    add(findings, 'MTR-ENDPOINT-001', 'requestSummary.permissionScope must match endpoint.permissionScope.', 'requestSummary.permissionScope', 'Bind the request summary to the reviewed permission scope.', 'error', context);
  }

  if (!isObject(row.readGate)) {
    add(findings, 'MTR-API-READ-AUDIT-004', 'readGate evidence is required.', 'readGate', 'Record read-gate authorization, request hash, and read-plan file hash.', 'error', context);
  } else {
    requireFilled(findings, row.readGate.status, 'readGate.status', 'readGate.status is required.', 'Record the reviewed read-gate status.', context);
    requireFilled(findings, row.readGate.authorizationId, 'readGate.authorizationId', 'readGate.authorizationId is required.', 'Record the current-turn authorization id.', context);
    if (row.readGate.currentTurnConfirmed !== true) {
      add(findings, 'MTR-LIVE-READ-001', 'readGate.currentTurnConfirmed must be true.', 'readGate.currentTurnConfirmed', 'Future live reads require current-turn confirmation for the exact request hash; mocked audit fixtures must preserve that binding.', 'error', context);
    }
    if (!isSha256(row.readGate.requestHash)) {
      add(findings, 'MTR-HASH-001', 'readGate.requestHash must be sha256:<64 lowercase hex>.', 'readGate.requestHash', 'Use the request hash emitted by metro api read-plan.', 'error', context);
    }
    if (!isSha256(row.readGate.readPlanFileHash)) {
      add(findings, 'MTR-HASH-001', 'readGate.readPlanFileHash must be sha256:<64 lowercase hex>.', 'readGate.readPlanFileHash', 'Use the reviewed read-plan file hash.', 'error', context);
    }
  }

  if (!isObject(row.keyFingerprint)) {
    add(findings, 'MTR-API-READ-AUDIT-005', 'keyFingerprint is required.', 'keyFingerprint', 'Record key env var name and non-secret fingerprint.', 'error', context);
  } else {
    requireFilled(findings, row.keyFingerprint.envVar, 'keyFingerprint.envVar', 'keyFingerprint.envVar is required.', 'Record the environment variable name only, not its value.', context);
    requireFilled(findings, row.keyFingerprint.fingerprint, 'keyFingerprint.fingerprint', 'keyFingerprint.fingerprint is required.', 'Record a non-secret key fingerprint.', context);
  }

  if (!isObject(row.requestSummary)) {
    add(findings, 'MTR-API-READ-AUDIT-006', 'requestSummary is required.', 'requestSummary', 'Record method, path, request hash, and field names only.', 'error', context);
  } else {
    try {
      assertReadOnlyEndpoint(row.requestSummary);
    } catch (error) {
      add(findings, error.code || 'MTR-READ-ENDPOINT-000', `requestSummary is not read-only: ${error.message}`, 'requestSummary', 'Read-audit rows must contain only read endpoint summaries.', 'error', context);
    }
    if (!isSha256(row.requestSummary.requestHash)) {
      add(findings, 'MTR-HASH-001', 'requestSummary.requestHash must be sha256:<64 lowercase hex>.', 'requestSummary.requestHash', 'Use the request hash emitted by metro api read-plan.', 'error', context);
    }
    if (isObject(row.readGate) && isSha256(row.readGate.requestHash) && row.requestSummary.requestHash !== row.readGate.requestHash) {
      add(findings, 'MTR-HASH-002', 'requestSummary.requestHash must match readGate.requestHash.', 'requestSummary.requestHash', 'Regenerate read-audit evidence from the reviewed request input.', 'error', context);
    }
    for (const field of ['bodyKeys', 'queryKeys', 'pathKeys']) {
      if (!Array.isArray(row.requestSummary[field])) {
        add(findings, 'MTR-API-READ-AUDIT-006', `requestSummary.${field} must be an array.`, `requestSummary.${field}`, 'Store field-name arrays only.', 'error', context);
      }
    }
    if (row.requestSummary.rawRequestBodyStored !== false) {
      add(findings, 'MTR-API-READ-AUDIT-007', 'requestSummary.rawRequestBodyStored must be false.', 'requestSummary.rawRequestBodyStored', 'Store request hashes and field names only, never raw bodies.', 'error', context);
    }
    if (Object.prototype.hasOwnProperty.call(row.requestSummary, 'body') || Object.prototype.hasOwnProperty.call(row, 'requestBody')) {
      add(findings, 'MTR-API-READ-AUDIT-007', 'Read-audit rows must not include raw request bodies.', 'requestSummary.body', 'Remove raw request body data and keep hashes plus field names only.', 'error', context);
    }
  }

  if (!isObject(row.responseSummary)) {
    add(findings, 'MTR-API-READ-AUDIT-008', 'responseSummary is required.', 'responseSummary', 'Record response hash and shape summary only.', 'error', context);
  } else if (!isSha256(row.responseSummary.responseHash)) {
    add(findings, 'MTR-HASH-001', 'responseSummary.responseHash must be sha256:<64 lowercase hex>.', 'responseSummary.responseHash', 'Use the response hash emitted by metro api read-result.', 'error', context);
  }
  if (Object.prototype.hasOwnProperty.call(row, 'responseData')) {
    add(findings, 'MTR-API-READ-AUDIT-008', 'Read-audit rows must not include raw responseData.', 'responseData', 'Store response hashes and shape summaries only.', 'error', context);
  }

  if (!isObject(row.verification)) {
    add(findings, 'MTR-VERIFY-001', 'verification is required.', 'verification', 'Record output-contract verification status and checks.', 'error', context);
  } else {
    if (!VALID_VERIFICATION_STATUSES.has(row.verification.status)) {
      add(findings, 'MTR-VERIFY-001', 'verification.status is invalid.', 'verification.status', `Use one of: ${[...VALID_VERIFICATION_STATUSES].join(', ')}.`, 'error', context);
    }
    if (!Array.isArray(row.verification.checks) || row.verification.checks.length === 0) {
      add(findings, 'MTR-VERIFY-001', 'verification.checks must include at least one check.', 'verification.checks', 'Carry forward read-plan verification checks.', 'error', context);
    }
  }
  if (!VALID_OUTCOMES.has(row.outcome)) {
    add(findings, 'MTR-API-READ-AUDIT-009', 'outcome is invalid.', 'outcome', `Use one of: ${[...VALID_OUTCOMES].join(', ')}.`, 'error', context);
  }
  if (row.outcome === 'success' && row.verification?.status !== 'passed') {
    add(findings, 'MTR-VERIFY-001', 'Successful read-audit rows must have verification.status passed.', 'verification.status', 'Do not mark a read successful until output verification passed.', 'error', context);
  }

  return findings;
}

function validateApiReadAuditJsonl(text) {
  const parsed = parseJsonl(text);
  const findings = [...parsed.findings];
  const rows = [];
  for (const item of parsed.rows) {
    rows.push(item.row);
    findings.push(...validateApiReadAuditRow(item.row, item.index));
  }
  if (parsed.rows.length === 0 && findings.length === 0) {
    add(findings, 'MTR-API-READ-AUDIT-015', 'Read-audit JSONL file has no rows.', '$', 'Write at least one read-audit row before validating evidence.');
  }

  const valid = !findings.some((item) => item.severity === 'error');
  const endpointIds = [...new Set(rows.map((row) => row.endpoint?.id).filter(Boolean))].sort();
  const tenants = [...new Set(rows.map((row) => row.tenant).filter(Boolean))].sort();
  return {
    schemaVersion: API_READ_AUDIT_VALIDATION_SCHEMA_VERSION,
    generatedFrom: 'metronome-cli/src/api-catalog/read-audit.js',
    apiAccess: 'none',
    liveExecution: clone(LOCAL_ONLY_LIVE_EXECUTION),
    readEnabledInCurrentCli: false,
    valid,
    rowCount: parsed.rows.length,
    summary: {
      endpointIds,
      tenants,
      successRows: rows.filter((row) => row.outcome === 'success').length,
      mockedRows: rows.filter((row) => row.apiAccess === 'mocked-read').length,
    },
    findings,
    nextSafeStep: valid
      ? 'Keep this read-audit JSONL as local mocked read evidence. Live expert API read remains disabled until the guarded runner and audit writer are explicitly authorized.'
      : 'Fix the read-audit JSONL and re-run metro api read-audit validate before using it as audit evidence.',
  };
}

module.exports = {
  API_READ_AUDIT_SCHEMA_VERSION,
  API_READ_AUDIT_TEMPLATE_SCHEMA_VERSION,
  API_READ_AUDIT_VALIDATION_SCHEMA_VERSION,
  API_READ_AUDIT_WRITE_SCHEMA_VERSION,
  apiReadAuditCoverage,
  buildApiReadAuditTemplate,
  buildApiReadAuditWritePlan,
  validateApiReadAuditJsonl,
  validateApiReadAuditRow,
  writeApiReadAuditJsonl,
};
