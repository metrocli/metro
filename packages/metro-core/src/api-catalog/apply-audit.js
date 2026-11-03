'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { getApiEndpoint, listApiEndpoints } = require('./index');
const { validateApiApprovalRecord } = require('./approval-record');
const { sha256 } = require('../preview');

const API_APPLY_AUDIT_SCHEMA_VERSION = 'metro.api.apply-audit.v1';
const API_APPLY_AUDIT_TEMPLATE_SCHEMA_VERSION = 'metro.api.apply-audit.template.v1';
const API_APPLY_AUDIT_VALIDATION_SCHEMA_VERSION = 'metro.api.apply-audit.validation.v1';
const API_APPLY_AUDIT_WRITE_SCHEMA_VERSION = 'metro.api.apply-audit.write.v1';

const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const VALID_TENANTS = new Set(['sandbox', 'production']);
const VALID_OUTCOMES = new Set(['planned', 'blocked']);
const VALID_VERIFICATION_STATUSES = new Set(['not_started', 'blocked']);
const VALID_CHECK_STATUSES = new Set(['pending', 'not_started', 'blocked']);
const VALID_ACTOR_SOURCES = new Set(['user', 'agent', 'ci']);
const SECRET_KEY_PATTERN = /(?:api[_-]?key|secret|token|authorization|password|private[_-]?key|bearer)/i;
const SECRET_KEY_ALLOWLIST = new Set([
  'authorization',
  'currentTurnAuthorizationRequired',
  'currentTurnAuthorizationCaptured',
  'liveApplyAuthorizedByThisRecord',
  'keyFingerprint',
  'rawRequestBodyStored',
]);
const SECRET_VALUE_PATTERN = /(?:bearer\s+[A-Za-z0-9._-]+|sk_live_[A-Za-z0-9]+|sk_test_[A-Za-z0-9]+|rk_live_[A-Za-z0-9]+|prod_[A-Za-z0-9]{12,})/i;

const LOCAL_ONLY_LIVE_EXECUTION = {
  enabledInCurrentCli: false,
  reason: 'Expert API apply-audit evidence is local planned-write evidence only; the current CLI does not load Metronome API clients or run expert API apply commands.',
  nextSafeStep: 'Append planned apply-audit rows locally, then keep expert API apply blocked until guarded runners, current-turn authorization, live audit writing, read-back verification, rollback evidence, and permission enforcement exist.',
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

function filled(value) {
  return value !== undefined
    && value !== null
    && String(value).trim() !== ''
    && !/^<[^>]+>$/.test(String(value).trim());
}

function isSha256(value) {
  return typeof value === 'string' && SHA256_PATTERN.test(value);
}

function isIsoTimestamp(value) {
  if (typeof value !== 'string' || value.trim() === '' || /^<[^>]+>$/.test(value.trim())) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
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

function requireFilled(findings, value, pathName, message, remediation, context = null, id = 'MTR-API-APPLY-AUDIT-001') {
  if (!filled(value)) add(findings, id, message, pathName, remediation, 'error', context);
}

function validateHash(findings, value, pathName, remediation, context = null) {
  if (!isSha256(value)) {
    add(
      findings,
      'MTR-HASH-001',
      `${pathName} must be sha256:<64 lowercase hex>.`,
      pathName,
      remediation || 'Use the exact hash emitted by the CLI or computed from reviewed local evidence.',
      'error',
      context,
    );
  }
}

function resolveLocalPath(filePath, rootDir) {
  if (!filled(filePath)) return null;
  if (path.isAbsolute(filePath)) return filePath;
  return path.resolve(rootDir || process.cwd(), filePath);
}

function hashFile(filePath) {
  return `sha256:${crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')}`;
}

function hashFileIfReadable(filePath, rootDir) {
  const resolved = resolveLocalPath(filePath, rootDir);
  if (!resolved) return 'sha256:<64 lowercase hex approval-record file hash>';
  try {
    return hashFile(resolved);
  } catch {
    return 'sha256:<64 lowercase hex approval-record file hash>';
  }
}

function scanForSecrets(value, findings, pathName = '$', context = null) {
  if (typeof value === 'string') {
    if (SECRET_VALUE_PATTERN.test(value)) {
      add(
        findings,
        'MTR-APIREQ-003',
        `API apply-audit row contains a secret-like value at ${pathName}.`,
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
        `API apply-audit row contains forbidden secret-shaped field ${childPath}.`,
        childPath,
        'Never store raw API keys, bearer tokens, passwords, Authorization headers, or secret values in apply-audit evidence.',
        'error',
        context,
      );
    }
    scanForSecrets(child, findings, childPath, context);
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

function readBackChecks(approvalRecord) {
  return list(approvalRecord.evidence?.readBackPlan).map((check, index) => ({
    id: check?.id || `read-back-${index + 1}`,
    mode: check?.mode || 'future-read',
    status: check?.status || 'pending',
    expectation: check?.expectation,
  }));
}

function apiApplyAuditCoverage() {
  return listApiEndpoints().reduce((coverage, endpoint) => {
    const isWriteEndpoint = endpoint.operationType === 'write';
    coverage[endpoint.id] = {
      schemaVersion: API_APPLY_AUDIT_SCHEMA_VERSION,
      supportStatus: isWriteEndpoint ? 'local-planned-apply-audit' : 'not-write-endpoint',
      templateCommand: isWriteEndpoint
        ? 'metro api apply-audit template --approval-record <api-approval-record.json> [--actor <id>] [--json]'
        : null,
      writeCommand: isWriteEndpoint
        ? 'metro api apply-audit write --approval-record <api-approval-record.json> --out <api-apply-audit.jsonl> --actor <id> (--dry-run|--write) [--timestamp <ISO>] [--json]'
        : null,
      validationCommand: 'metro api apply-audit validate --file <api-apply-audit.jsonl> [--json]',
      apiAccess: 'none',
      applyEnabledInCurrentCli: false,
      requiresApprovalRecord: isWriteEndpoint ? `metro api approval-record validate --file <api-approval-record-for-${endpoint.id}.json> [--json]` : null,
      requiredEvidence: isWriteEndpoint
        ? ['validated-approval-record-file-hash', 'validated-apply-gate-file-hash', 'approval-id', 'tenant-profile-key-fingerprint', 'audit-destination', 'read-back-plan', 'rollback-remediation', 'idempotency-review', 'current-turn-authorization-still-required']
        : [],
    };
    return coverage;
  }, {});
}

function buildApplyAuditRow({ approvalRecord, approvalRecordPath = null, approvalRecordFileHash, endpoint, actor = null, timestamp = '<ISO timestamp>' }) {
  const checks = readBackChecks(approvalRecord);
  return {
    schemaVersion: API_APPLY_AUDIT_SCHEMA_VERSION,
    timestamp,
    cliVersion: '0.0.0',
    actor: {
      source: actor ? 'agent' : '<user|agent|ci>',
      id: actor || '<operator id>',
    },
    mode: 'apply',
    apiAccess: 'planned-write',
    liveExecution: clone(LOCAL_ONLY_LIVE_EXECUTION),
    applyEnabledInCurrentCli: false,
    liveApplyAuthorizedByThisRecord: false,
    tenant: approvalRecord.binding.tenant,
    endpoint: endpointSnapshot(endpoint),
    approvalRecord: {
      filePath: approvalRecordPath || '<path-to-reviewed-api-approval-record-json>',
      fileHash: approvalRecordFileHash,
      validationResult: 'passed',
      approvalId: approvalRecord.approval.approvalId,
      status: approvalRecord.approval.status,
      approvedBy: approvalRecord.approval.approvedBy,
      approvedAt: approvalRecord.approval.approvedAt,
      expiresAt: approvalRecord.approval.expiresAt,
      payloadHash: approvalRecord.binding.payloadHash,
      requestHash: approvalRecord.binding.requestHash,
    },
    applyGate: {
      fileHash: approvalRecord.applyGate.fileHash,
      validationResult: approvalRecord.applyGate.validationResult,
      payloadHash: approvalRecord.applyGate.payloadHash,
      requestHash: approvalRecord.applyGate.requestHash,
    },
    authorization: {
      currentTurnAuthorizationRequired: true,
      currentTurnAuthorizationCaptured: false,
      liveApplyAuthorizedByThisRecord: false,
      reason: 'Planned apply-audit evidence does not authorize live expert API apply.',
    },
    keyFingerprint: {
      envVar: approvalRecord.tenantProfile.keyEnv,
      fingerprint: approvalRecord.tenantProfile.keyFingerprint,
    },
    requestSummary: {
      method: endpoint.method,
      path: endpoint.path,
      requestHash: approvalRecord.binding.requestHash,
      payloadHash: approvalRecord.binding.payloadHash,
      permissionScope: endpoint.permissionScope,
      requestSummaryStrategy: 'hash-and-field-names-only',
      rawRequestBodyStored: false,
    },
    auditDestination: approvalRecord.evidence.auditLogDestination,
    targetIdentifiers: clone(approvalRecord.approval.targetIdentifiers),
    responseObjectIds: [],
    idempotencyReview: approvalRecord.evidence.idempotencyReview,
    rollbackOrRemediationPlan: approvalRecord.evidence.rollbackOrRemediationPlan,
    readBackVerification: {
      status: 'not_started',
      checks,
    },
    outcome: 'planned',
  };
}

function loadApprovalRecordEvidence(approvalRecord, approvalRecordPath, rootDir) {
  if (!isObject(approvalRecord)) return null;
  const resolved = resolveLocalPath(approvalRecordPath, rootDir);
  const validationRootDir = resolved ? path.dirname(resolved) : rootDir;
  const validation = validateApiApprovalRecord(approvalRecord, { rootDir: validationRootDir });
  if (!validation.valid) return null;
  const endpoint = getApiEndpoint(approvalRecord.binding?.endpointId);
  if (!endpoint || endpoint.operationType !== 'write') return null;
  return {
    endpoint,
    validation,
    approvalRecordFileHash: hashFileIfReadable(approvalRecordPath, rootDir),
  };
}

function buildApiApplyAuditTemplate(options = {}) {
  const {
    approvalRecord,
    approvalRecordPath = null,
    rootDir = process.cwd(),
    actor = null,
  } = options;

  const evidence = loadApprovalRecordEvidence(approvalRecord, approvalRecordPath, rootDir);
  if (!evidence) return null;
  const row = buildApplyAuditRow({
    approvalRecord,
    approvalRecordPath: approvalRecordPath || null,
    approvalRecordFileHash: evidence.approvalRecordFileHash,
    endpoint: evidence.endpoint,
    actor,
  });

  return {
    schemaVersion: API_APPLY_AUDIT_TEMPLATE_SCHEMA_VERSION,
    generatedFrom: 'packages/metro-core/src/api-catalog/apply-audit.js',
    apiAccess: 'none',
    liveExecution: clone(LOCAL_ONLY_LIVE_EXECUTION),
    applyEnabledInCurrentCli: false,
    liveApplyAuthorizedByThisRecord: false,
    endpoint: endpointSnapshot(evidence.endpoint),
    tenant: approvalRecord.binding.tenant,
    row,
    validationCommand: 'metro api apply-audit validate --file <api-apply-audit.jsonl> [--json]',
    writeCommand: 'metro api apply-audit write --approval-record <api-approval-record.json> --out <api-apply-audit.jsonl> --actor <id> (--dry-run|--write) [--timestamp <ISO>] [--json]',
    notes: [
      'Write one JSON object per line.',
      'This row is planned local audit evidence only; it does not prove that an API apply happened.',
      'Do not store raw request bodies, response payloads, API keys, bearer tokens, Authorization headers, or .env values.',
      'Future live apply still requires a guarded runner and explicit current-turn authorization for the exact operation.',
    ],
    sources: clone(approvalRecord.sources || evidence.endpoint.sources),
  };
}

function applyAuditWriteBase(mode, outPath, findings = []) {
  return {
    schemaVersion: API_APPLY_AUDIT_WRITE_SCHEMA_VERSION,
    generatedFrom: 'packages/metro-core/src/api-catalog/apply-audit.js',
    apiAccess: 'none',
    liveExecution: clone(LOCAL_ONLY_LIVE_EXECUTION),
    applyEnabledInCurrentCli: false,
    liveApplyAuthorizedByThisRecord: false,
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
    nextSafeStep: 'Fix the apply-audit write inputs and re-run with --dry-run before writing JSONL evidence.',
  };
}

function buildApiApplyAuditWritePlan(options = {}) {
  const {
    approvalRecord,
    approvalRecordPath = null,
    approvalRecordRootDir = process.cwd(),
    actor = null,
    outPath = null,
    mode = null,
    timestamp = null,
  } = options;
  const findings = [];

  if (mode !== 'dry-run' && mode !== 'write') {
    add(findings, 'MTR-API-APPLY-AUDIT-WRITE-001', 'mode must be dry-run or write.', 'mode', 'Choose exactly one of --dry-run or --write.');
  }
  if (!filled(outPath)) {
    add(findings, 'MTR-API-APPLY-AUDIT-WRITE-002', 'outPath is required.', 'target.path', 'Pass --out <api-apply-audit.jsonl> so local apply-audit evidence has an explicit destination.');
  }
  if (!filled(actor)) {
    add(findings, 'MTR-API-APPLY-AUDIT-WRITE-003', 'actor is required.', 'actor', 'Pass --actor <id> so durable audit evidence records a non-secret operator or agent id.');
  }

  const effectiveTimestamp = timestamp || new Date().toISOString();
  if (!isIsoTimestamp(effectiveTimestamp)) {
    add(findings, 'MTR-API-APPLY-AUDIT-WRITE-004', 'timestamp must be an ISO UTC timestamp.', 'timestamp', 'Use new Date().toISOString() format, for example 2026-06-27T09:00:00.000Z.');
  }

  const template = buildApiApplyAuditTemplate({
    approvalRecord,
    approvalRecordPath,
    rootDir: approvalRecordRootDir,
    actor,
  });
  if (!template) {
    add(
      findings,
      'MTR-API-APPLY-AUDIT-WRITE-005',
      'approval-record evidence must be valid and bound to a reviewed write endpoint.',
      'approvalRecord',
      'Run metro api approval-record validate, then retry with the matching approval record file.',
    );
  }

  const blockedBase = applyAuditWriteBase(mode, outPath, findings);
  if (!template || findings.some((item) => item.severity === 'error')) return blockedBase;

  const row = clone(template.row);
  row.timestamp = effectiveTimestamp;
  const rowLine = `${JSON.stringify(row)}\n`;
  const rowValidation = validateApiApplyAuditJsonl(rowLine);
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
      ? 'Review this planned apply-audit row, then re-run with --write to append one JSONL row locally. Live expert API apply remains disabled.'
      : 'Append this row locally, then validate the JSONL file. Live expert API apply remains disabled.',
  };
}

function writeApiApplyAuditJsonl(plan, options = {}) {
  const fsImpl = options.fs || fs;
  const rootDir = options.rootDir || process.cwd();
  if (!plan || plan.schemaVersion !== API_APPLY_AUDIT_WRITE_SCHEMA_VERSION) {
    throw new Error('writeApiApplyAuditJsonl requires a metro.api.apply-audit.write.v1 plan.');
  }
  if (plan.mode !== 'write' || plan.blocked) return clone(plan);

  const targetPath = path.resolve(rootDir, plan.target.path);
  const rowLine = `${JSON.stringify(plan.row)}\n`;
  const existedBefore = fsImpl.existsSync(targetPath);
  const existingText = existedBefore ? fsImpl.readFileSync(targetPath, 'utf8') : '';
  if (existedBefore && existingText.trim() !== '') {
    const existingValidation = validateApiApplyAuditJsonl(existingText);
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
        nextSafeStep: 'Fix the existing apply-audit JSONL before appending new evidence.',
      };
    }
  }

  fsImpl.mkdirSync(path.dirname(targetPath), { recursive: true });
  fsImpl.appendFileSync(targetPath, rowLine, 'utf8');
  const afterText = fsImpl.readFileSync(targetPath, 'utf8');
  const fileValidation = validateApiApplyAuditJsonl(afterText);

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
      ? 'Keep this apply-audit JSONL as local planned write evidence. Live expert API apply remains disabled until the guarded runner is explicitly authorized.'
      : 'Fix the apply-audit JSONL and re-run metro api apply-audit validate before using it as audit evidence.',
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
        'MTR-API-APPLY-AUDIT-014',
        `Apply-audit JSONL line ${index + 1} is not valid JSON: ${error.message}`,
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
  if (!endpoint || endpoint.operationType !== 'write') {
    add(findings, 'MTR-ENDPOINT-001', 'endpoint.id must name a reviewed write endpoint.', 'endpoint.id', 'Use a reviewed write endpoint ID from metro api catalog.', 'error', context);
    return null;
  }
  for (const field of ['method', 'path', 'permissionScope']) {
    if (row.endpoint?.[field] !== endpoint[field]) {
      add(findings, 'MTR-ENDPOINT-001', `endpoint.${field} must match the reviewed endpoint catalog.`, `endpoint.${field}`, 'Regenerate the apply-audit row from the current endpoint catalog.', 'error', context);
    }
  }
  return endpoint;
}

function validateApiApplyAuditRow(row, index = 0) {
  const findings = [];
  const context = { row: index + 1 };

  if (!isObject(row)) {
    return [
      finding(
        'MTR-API-APPLY-AUDIT-000',
        'error',
        'Apply-audit row must be a JSON object.',
        '$',
        'Write one JSON object per JSONL row.',
        context,
      ),
    ];
  }

  scanForSecrets(row, findings, '$', context);

  if (row.schemaVersion !== API_APPLY_AUDIT_SCHEMA_VERSION) {
    add(findings, 'MTR-API-APPLY-AUDIT-001', `schemaVersion must be ${API_APPLY_AUDIT_SCHEMA_VERSION}.`, 'schemaVersion', 'Use a current metro.api.apply-audit.v1 row.', 'error', context);
  }
  if (!isIsoTimestamp(row.timestamp)) {
    add(findings, 'MTR-API-APPLY-AUDIT-002', 'timestamp must be an ISO UTC timestamp.', 'timestamp', 'Use new Date().toISOString() format.', 'error', context);
  }
  requireFilled(findings, row.cliVersion, 'cliVersion', 'cliVersion is required.', 'Record the CLI version that produced the audit row.', context);
  if (!isObject(row.actor)) {
    add(findings, 'MTR-API-APPLY-AUDIT-003', 'actor is required.', 'actor', 'Record non-secret operator or agent identity metadata.', 'error', context);
  } else {
    if (!VALID_ACTOR_SOURCES.has(row.actor.source)) {
      add(findings, 'MTR-API-APPLY-AUDIT-003', 'actor.source must be user, agent, or ci.', 'actor.source', 'Use a stable non-secret actor source.', 'error', context);
    }
    requireFilled(findings, row.actor.id, 'actor.id', 'actor.id is required.', 'Record a non-secret operator, agent, or CI id.', context);
  }
  if (row.mode !== 'apply') {
    add(findings, 'MTR-API-APPLY-AUDIT-001', 'mode must be apply.', 'mode', 'Use apply-audit rows only for expert API write planning evidence.', 'error', context);
  }
  if (row.apiAccess !== 'planned-write') {
    add(findings, 'MTR-API-APPLY-AUDIT-001', 'apiAccess must be planned-write in the current CLI slice.', 'apiAccess', 'Do not use planned apply-audit evidence to claim live writes are enabled.', 'error', context);
  }
  if (row.liveExecution?.enabledInCurrentCli !== false || row.applyEnabledInCurrentCli !== false || row.liveApplyAuthorizedByThisRecord !== false) {
    add(findings, 'MTR-API-APPLY-AUDIT-001', 'apply-audit rows must keep live expert API apply disabled.', 'liveExecution.enabledInCurrentCli', 'Keep live apply execution disabled until the guarded runner is explicitly authorized.', 'error', context);
  }
  if (!VALID_TENANTS.has(row.tenant)) {
    add(findings, 'MTR-TENANT-001', 'tenant must be sandbox or production.', 'tenant', 'Bind every apply-audit row to exactly one tenant.', 'error', context);
  }

  const endpoint = validateEndpoint(row, findings, context);
  if (endpoint && row.tenant && row.requestSummary?.permissionScope !== endpoint.permissionScope) {
    add(findings, 'MTR-ENDPOINT-001', 'requestSummary.permissionScope must match endpoint.permissionScope.', 'requestSummary.permissionScope', 'Bind the request summary to the reviewed permission scope.', 'error', context);
  }

  if (!isObject(row.approvalRecord)) {
    add(findings, 'MTR-API-APPLY-AUDIT-004', 'approvalRecord evidence is required.', 'approvalRecord', 'Build apply-audit rows from metro api approval-record template/validate evidence.', 'error', context);
  } else {
    validateHash(findings, row.approvalRecord.fileHash, 'approvalRecord.fileHash', 'Hash the reviewed approval-record file.', context);
    validateHash(findings, row.approvalRecord.payloadHash, 'approvalRecord.payloadHash', 'Carry forward the reviewed preview payload hash.', context);
    validateHash(findings, row.approvalRecord.requestHash, 'approvalRecord.requestHash', 'Carry forward the reviewed request hash.', context);
    requireFilled(findings, row.approvalRecord.approvalId, 'approvalRecord.approvalId', 'approvalRecord.approvalId is required.', 'Record the reviewed approval id.', context);
    if (row.approvalRecord.status !== 'approved') {
      add(findings, 'MTR-API-APPLY-AUDIT-004', 'approvalRecord.status must be approved.', 'approvalRecord.status', 'Only approved approval-record evidence can support planned apply-audit rows.', 'error', context);
    }
    if (row.approvalRecord.validationResult !== 'passed') {
      add(findings, 'MTR-API-APPLY-AUDIT-004', 'approvalRecord.validationResult must be passed.', 'approvalRecord.validationResult', 'Validate approval-record evidence before writing audit rows.', 'error', context);
    }
    requireFilled(findings, row.approvalRecord.approvedBy, 'approvalRecord.approvedBy', 'approvalRecord.approvedBy is required.', 'Record the approver for the reviewed approval record.', context);
    if (!isIsoTimestamp(row.approvalRecord.approvedAt)) {
      add(findings, 'MTR-API-APPLY-AUDIT-004', 'approvalRecord.approvedAt must be an ISO timestamp.', 'approvalRecord.approvedAt', 'Carry forward the approval timestamp.', 'error', context);
    }
    if (!isIsoTimestamp(row.approvalRecord.expiresAt)) {
      add(findings, 'MTR-API-APPLY-AUDIT-004', 'approvalRecord.expiresAt must be an ISO timestamp.', 'approvalRecord.expiresAt', 'Carry forward the approval expiry.', 'error', context);
    }
  }

  if (!isObject(row.applyGate)) {
    add(findings, 'MTR-API-APPLY-AUDIT-005', 'applyGate evidence is required.', 'applyGate', 'Carry forward the apply-gate file hash from the approval record.', 'error', context);
  } else {
    validateHash(findings, row.applyGate.fileHash, 'applyGate.fileHash', 'Carry forward the reviewed apply-gate file hash.', context);
    validateHash(findings, row.applyGate.payloadHash, 'applyGate.payloadHash', 'Carry forward the apply-gate payload hash.', context);
    validateHash(findings, row.applyGate.requestHash, 'applyGate.requestHash', 'Carry forward the apply-gate request hash.', context);
    if (row.applyGate.validationResult !== 'passed') {
      add(findings, 'MTR-API-APPLY-AUDIT-005', 'applyGate.validationResult must be passed.', 'applyGate.validationResult', 'Apply-audit rows require validated apply-gate evidence.', 'error', context);
    }
  }

  if (isObject(row.approvalRecord) && isObject(row.applyGate)) {
    if (row.approvalRecord.payloadHash !== row.applyGate.payloadHash) {
      add(findings, 'MTR-HASH-002', 'approvalRecord.payloadHash must match applyGate.payloadHash.', 'approvalRecord.payloadHash', 'Regenerate from one reviewed approval record.', 'error', context);
    }
    if (row.approvalRecord.requestHash !== row.applyGate.requestHash) {
      add(findings, 'MTR-HASH-002', 'approvalRecord.requestHash must match applyGate.requestHash.', 'approvalRecord.requestHash', 'Regenerate from one reviewed approval record.', 'error', context);
    }
  }

  if (!isObject(row.authorization)) {
    add(findings, 'MTR-API-APPLY-AUDIT-006', 'authorization evidence is required.', 'authorization', 'Record current-turn authorization state explicitly.', 'error', context);
  } else {
    if (row.authorization.currentTurnAuthorizationRequired !== true) {
      add(findings, 'MTR-API-APPLY-AUDIT-006', 'authorization.currentTurnAuthorizationRequired must be true.', 'authorization.currentTurnAuthorizationRequired', 'Future live apply still needs explicit current-turn authorization.', 'error', context);
    }
    if (row.authorization.currentTurnAuthorizationCaptured !== false) {
      add(findings, 'MTR-API-APPLY-AUDIT-006', 'authorization.currentTurnAuthorizationCaptured must be false.', 'authorization.currentTurnAuthorizationCaptured', 'Do not store or imply current-turn authorization in planned audit rows.', 'error', context);
    }
    if (row.authorization.liveApplyAuthorizedByThisRecord !== false) {
      add(findings, 'MTR-API-APPLY-AUDIT-006', 'authorization.liveApplyAuthorizedByThisRecord must be false.', 'authorization.liveApplyAuthorizedByThisRecord', 'Planned audit rows are not execution tokens.', 'error', context);
    }
  }

  if (!isObject(row.keyFingerprint)) {
    add(findings, 'MTR-API-APPLY-AUDIT-007', 'keyFingerprint is required.', 'keyFingerprint', 'Record key env var name and non-secret fingerprint.', 'error', context);
  } else {
    requireFilled(findings, row.keyFingerprint.envVar, 'keyFingerprint.envVar', 'keyFingerprint.envVar is required.', 'Record the environment variable name only, not its value.', context);
    requireFilled(findings, row.keyFingerprint.fingerprint, 'keyFingerprint.fingerprint', 'keyFingerprint.fingerprint is required.', 'Record a non-secret key fingerprint.', context);
  }

  if (!isObject(row.requestSummary)) {
    add(findings, 'MTR-API-APPLY-AUDIT-008', 'requestSummary is required.', 'requestSummary', 'Record method, path, hashes, and permission scope only.', 'error', context);
  } else {
    for (const field of ['requestHash', 'payloadHash']) {
      validateHash(findings, row.requestSummary[field], `requestSummary.${field}`, 'Use the hashes emitted by preview/apply-gate evidence.', context);
    }
    if (endpoint) {
      for (const field of ['method', 'path', 'permissionScope']) {
        if (row.requestSummary[field] !== endpoint[field]) {
          add(findings, 'MTR-ENDPOINT-001', `requestSummary.${field} must match the reviewed endpoint catalog.`, `requestSummary.${field}`, 'Regenerate from the current endpoint catalog.', 'error', context);
        }
      }
    }
    if (isObject(row.approvalRecord)) {
      if (row.requestSummary.requestHash !== row.approvalRecord.requestHash) {
        add(findings, 'MTR-HASH-002', 'requestSummary.requestHash must match approvalRecord.requestHash.', 'requestSummary.requestHash', 'Regenerate from the reviewed approval record.', 'error', context);
      }
      if (row.requestSummary.payloadHash !== row.approvalRecord.payloadHash) {
        add(findings, 'MTR-HASH-002', 'requestSummary.payloadHash must match approvalRecord.payloadHash.', 'requestSummary.payloadHash', 'Regenerate from the reviewed approval record.', 'error', context);
      }
    }
    if (row.requestSummary.rawRequestBodyStored !== false) {
      add(findings, 'MTR-API-APPLY-AUDIT-008', 'requestSummary.rawRequestBodyStored must be false.', 'requestSummary.rawRequestBodyStored', 'Store request hashes only, never raw bodies.', 'error', context);
    }
  }
  if (Object.prototype.hasOwnProperty.call(row, 'requestBody') || Object.prototype.hasOwnProperty.call(row.requestSummary || {}, 'body')) {
    add(findings, 'MTR-API-APPLY-AUDIT-008', 'Apply-audit rows must not include raw request bodies.', 'requestBody', 'Remove raw request body data and keep hashes plus field names only.', 'error', context);
  }
  if (Object.prototype.hasOwnProperty.call(row, 'responseData') || Object.prototype.hasOwnProperty.call(row, 'rawResponse')) {
    add(findings, 'MTR-API-APPLY-AUDIT-009', 'Apply-audit rows must not include raw response data.', 'responseData', 'Record response object IDs after a future guarded runner exists, not raw payloads.', 'error', context);
  }

  requireFilled(findings, row.auditDestination, 'auditDestination', 'auditDestination is required.', 'Carry forward the reviewed audit destination.', context);
  if (!list(row.targetIdentifiers).some(filled)) {
    add(findings, 'MTR-API-APPLY-AUDIT-010', 'targetIdentifiers must include at least one reviewed target identifier.', 'targetIdentifiers', 'Carry forward target identifiers from the approval record.', 'error', context);
  }
  if (!Array.isArray(row.responseObjectIds)) {
    add(findings, 'MTR-API-APPLY-AUDIT-011', 'responseObjectIds must be an array.', 'responseObjectIds', 'Use an empty array for planned rows before any apply result exists.', 'error', context);
  }
  requireFilled(findings, row.idempotencyReview, 'idempotencyReview', 'idempotencyReview is required.', 'Carry forward the approval-record idempotency review.', context);
  requireFilled(findings, row.rollbackOrRemediationPlan, 'rollbackOrRemediationPlan', 'rollbackOrRemediationPlan is required.', 'Carry forward the approval-record rollback or remediation plan.', context);

  if (!isObject(row.readBackVerification)) {
    add(findings, 'MTR-VERIFY-001', 'readBackVerification is required.', 'readBackVerification', 'Carry forward the approval-record read-back plan.', 'error', context);
  } else {
    if (!VALID_VERIFICATION_STATUSES.has(row.readBackVerification.status)) {
      add(findings, 'MTR-VERIFY-001', 'readBackVerification.status is invalid for planned apply-audit evidence.', 'readBackVerification.status', `Use one of: ${[...VALID_VERIFICATION_STATUSES].join(', ')}.`, 'error', context);
    }
    const checks = list(row.readBackVerification.checks);
    if (!checks.length) {
      add(findings, 'MTR-VERIFY-001', 'readBackVerification.checks must include at least one check.', 'readBackVerification.checks', 'Carry forward approval-record read-back expectations.', 'error', context);
    }
    checks.forEach((check, checkIndex) => {
      const checkPath = `readBackVerification.checks[${checkIndex}]`;
      requireFilled(findings, check?.id, `${checkPath}.id`, 'read-back check id is required.', 'Carry forward check IDs from the approval record.', context);
      requireFilled(findings, check?.expectation, `${checkPath}.expectation`, 'read-back check expectation is required.', 'Carry forward read-back expectations from the approval record.', context);
      if (!VALID_CHECK_STATUSES.has(check?.status)) {
        add(findings, 'MTR-VERIFY-001', 'read-back check status is invalid for planned apply-audit evidence.', `${checkPath}.status`, `Use one of: ${[...VALID_CHECK_STATUSES].join(', ')}.`, 'error', context);
      }
    });
  }

  if (!VALID_OUTCOMES.has(row.outcome)) {
    add(findings, 'MTR-API-APPLY-AUDIT-012', 'outcome is invalid for current local apply-audit evidence.', 'outcome', `Use one of: ${[...VALID_OUTCOMES].join(', ')}.`, 'error', context);
  }
  if (row.outcome === 'planned' && row.readBackVerification?.status !== 'not_started') {
    add(findings, 'MTR-VERIFY-001', 'Planned apply-audit rows must have readBackVerification.status not_started.', 'readBackVerification.status', 'Do not mark read-back verification as passed before a guarded apply result exists.', 'error', context);
  }

  return findings;
}

function validateApiApplyAuditJsonl(text) {
  const parsed = parseJsonl(text);
  const findings = [...parsed.findings];
  const rows = [];
  for (const item of parsed.rows) {
    rows.push(item.row);
    findings.push(...validateApiApplyAuditRow(item.row, item.index));
  }
  if (parsed.rows.length === 0 && findings.length === 0) {
    add(findings, 'MTR-API-APPLY-AUDIT-015', 'Apply-audit JSONL file has no rows.', '$', 'Write at least one apply-audit row before validating evidence.');
  }

  const valid = !findings.some((item) => item.severity === 'error');
  const endpointIds = [...new Set(rows.map((row) => row.endpoint?.id).filter(Boolean))].sort();
  const tenants = [...new Set(rows.map((row) => row.tenant).filter(Boolean))].sort();
  return {
    schemaVersion: API_APPLY_AUDIT_VALIDATION_SCHEMA_VERSION,
    generatedFrom: 'packages/metro-core/src/api-catalog/apply-audit.js',
    apiAccess: 'none',
    liveExecution: clone(LOCAL_ONLY_LIVE_EXECUTION),
    applyEnabledInCurrentCli: false,
    liveApplyAuthorizedByThisRecord: false,
    valid,
    rowCount: parsed.rows.length,
    summary: {
      endpointIds,
      tenants,
      plannedRows: rows.filter((row) => row.outcome === 'planned').length,
      plannedWriteRows: rows.filter((row) => row.apiAccess === 'planned-write').length,
      currentTurnAuthorizationCapturedRows: rows.filter((row) => row.authorization?.currentTurnAuthorizationCaptured === true).length,
    },
    findings,
    nextSafeStep: valid
      ? 'Keep this apply-audit JSONL as local planned write evidence. Live expert API apply remains disabled until guarded runners and current-turn authorization are explicitly authorized.'
      : 'Fix the apply-audit JSONL and re-run metro api apply-audit validate before using it as audit evidence.',
  };
}

module.exports = {
  API_APPLY_AUDIT_SCHEMA_VERSION,
  API_APPLY_AUDIT_TEMPLATE_SCHEMA_VERSION,
  API_APPLY_AUDIT_VALIDATION_SCHEMA_VERSION,
  API_APPLY_AUDIT_WRITE_SCHEMA_VERSION,
  apiApplyAuditCoverage,
  buildApiApplyAuditTemplate,
  buildApiApplyAuditWritePlan,
  validateApiApplyAuditJsonl,
  validateApiApplyAuditRow,
  writeApiApplyAuditJsonl,
};
