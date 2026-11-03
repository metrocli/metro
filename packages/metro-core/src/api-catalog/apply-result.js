'use strict';

const { getApiEndpoint, listApiEndpoints } = require('./index');
const { validateApiApplyAuditJsonl } = require('./apply-audit');
const { sha256 } = require('../preview');

const API_APPLY_RESULT_SCHEMA_VERSION = 'metro.api.apply-result.v1';
const API_APPLY_RESULT_TEMPLATE_SCHEMA_VERSION = 'metro.api.apply-result.template.v1';
const API_APPLY_RESULT_VALIDATION_SCHEMA_VERSION = 'metro.api.apply-result.validation.v1';

const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const VALID_TENANTS = new Set(['sandbox', 'production']);
const VALID_SUCCESS = new Set(['success', 'passed']);
const SECRET_KEY_PATTERN = /(?:api[_-]?key|secret|token|authorization|password|private[_-]?key|bearer)/i;
const SECRET_KEY_ALLOWLIST = new Set([
  'authorization',
  'currentTurnAuthorizationCaptured',
  'currentTurnAuthorizationRequired',
  'liveApplyAuthorizedByThisRecord',
  'keyFingerprint',
  'rawRequestBodyStored',
]);
const SECRET_VALUE_PATTERN = /(?:bearer\s+[A-Za-z0-9._-]+|sk_live_[A-Za-z0-9]+|sk_test_[A-Za-z0-9]+|rk_live_[A-Za-z0-9]+|prod_[A-Za-z0-9]{12,})/i;

const LOCAL_ONLY_LIVE_EXECUTION = {
  enabledInCurrentCli: false,
  reason: 'Expert API apply-result contracts are local evidence validation only; the current CLI does not run live expert API apply commands.',
  nextSafeStep: 'Use the apply-result template and validator to define the future guarded runner output. Live expert API apply still requires current-turn authorization, guarded execution, live audit rows, and semantic read-back verification.',
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

function uniqueList(values) {
  return [...new Set(values.filter((value) => value !== undefined && value !== null && String(value).trim() !== ''))];
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
  if (!filled(value)) return false;
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

function requireFilled(findings, value, pathName, message, remediation) {
  if (!filled(value)) add(findings, 'MTR-API-APPLY-RESULT-001', message, pathName, remediation);
}

function validateHash(findings, value, pathName, remediation) {
  if (!isSha256(value)) {
    add(
      findings,
      'MTR-HASH-001',
      `${pathName} must be sha256:<64 lowercase hex>.`,
      pathName,
      remediation || 'Use the exact hash emitted by the CLI or computed from reviewed local evidence.',
    );
  }
}

function scanForSecrets(value, findings, pathName = '$') {
  if (typeof value === 'string') {
    if (SECRET_VALUE_PATTERN.test(value)) {
      add(
        findings,
        'MTR-APIREQ-003',
        `API apply-result contains a secret-like value at ${pathName}.`,
        pathName,
        'Store hashes, non-secret key fingerprints, and environment variable names only.',
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
    if (SECRET_KEY_PATTERN.test(key) && !SECRET_KEY_ALLOWLIST.has(key)) {
      add(
        findings,
        'MTR-APIREQ-003',
        `API apply-result contains forbidden secret-shaped field ${childPath}.`,
        childPath,
        'Never store raw API keys, bearer tokens, passwords, Authorization headers, or secret values in apply-result evidence.',
      );
    }
    scanForSecrets(child, findings, childPath);
  }
}

function endpointSnapshot(endpoint) {
  return endpoint
    ? {
      id: endpoint.id,
      method: endpoint.method,
      path: endpoint.path,
      family: endpoint.family,
      operationType: endpoint.operationType,
      permissionScope: endpoint.permissionScope,
      sourceIds: clone(endpoint.sourceIds),
    }
    : null;
}

function parseApplyAuditRows(text) {
  const rows = [];
  String(text || '').split(/\r?\n/).forEach((line, index) => {
    if (line.trim() === '') return;
    try {
      rows.push({ rowNumber: index + 1, row: JSON.parse(line) });
    } catch {
      rows.push({ rowNumber: index + 1, row: null });
    }
  });
  return rows;
}

function normalizeRowNumber(rowNumber, rowCount, findings) {
  if (rowNumber === undefined || rowNumber === null || rowNumber === '') {
    if (rowCount === 1) return 1;
    add(
      findings,
      'MTR-API-APPLY-RESULT-002',
      'apply-audit JSONL contains multiple rows; --row <n> is required.',
      'row',
      'Choose the 1-based apply-audit row number whose apply-result evidence should bind to.',
    );
    return null;
  }

  const numeric = Number(rowNumber);
  if (!Number.isInteger(numeric) || numeric < 1 || numeric > rowCount) {
    add(
      findings,
      'MTR-API-APPLY-RESULT-002',
      `row must be a positive 1-based integer within the apply-audit row count ${rowCount}.`,
      'row',
      'Pass --row <n> using an existing apply-audit JSONL line number.',
    );
    return null;
  }
  return numeric;
}

function selectedApplyAuditEvidence(applyAuditText, rowNumber, findings) {
  const validation = validateApiApplyAuditJsonl(applyAuditText || '');
  const rows = parseApplyAuditRows(applyAuditText || '');
  const selectedRowNumber = normalizeRowNumber(rowNumber, rows.length, findings);
  const selectedRow = selectedRowNumber ? rows.find((item) => item.rowNumber === selectedRowNumber)?.row || null : null;
  if (!validation.valid) findings.push(...validation.findings);
  if (!selectedRow) {
    add(
      findings,
      'MTR-API-APPLY-RESULT-003',
      'A valid apply-audit row is required for apply-result evidence.',
      'applyAudit',
      'Validate the apply-audit JSONL and select an existing row.',
    );
  }
  const endpoint = selectedRow ? getApiEndpoint(selectedRow.endpoint?.id) : null;
  if (selectedRow && (!endpoint || endpoint.operationType !== 'write')) {
    add(
      findings,
      'MTR-ENDPOINT-001',
      'The selected apply-audit row must reference a reviewed write endpoint.',
      'applyAudit.endpoint.id',
      'Use planned apply-audit evidence generated from a reviewed write endpoint.',
    );
  }
  return { validation, rows, selectedRowNumber, selectedRow, endpoint };
}

function validateApplyReadbackReport(report, findings) {
  if (!isObject(report)) {
    add(
      findings,
      'MTR-API-APPLY-RESULT-004',
      'apply-readback report must be a JSON object.',
      'applyReadback',
      'Pass a metro.api.apply-readback.verify.v1 JSON report.',
    );
    return;
  }
  if (report.schemaVersion !== 'metro.api.apply-readback.verify.v1') {
    add(
      findings,
      'MTR-API-APPLY-RESULT-004',
      'apply-readback report schemaVersion must be metro.api.apply-readback.verify.v1.',
      'applyReadback.schemaVersion',
      'Run metro api apply-readback verify and pass its JSON output.',
    );
  }
  if (report.valid !== true || report.blocked !== false) {
    add(
      findings,
      'MTR-API-APPLY-RESULT-004',
      'apply-readback report must be valid and unblocked.',
      'applyReadback.valid',
      'Fix apply-readback evidence before building or validating apply-result evidence.',
    );
  }
  if (report.readBackCompatibility?.compatible !== true) {
    add(
      findings,
      'MTR-API-APPLY-READBACK-004',
      'apply-readback report must prove endpoint compatibility.',
      'applyReadback.readBackCompatibility.compatible',
      'Use read-back evidence from an endpoint approved for the planned write endpoint.',
    );
  }
  if (report.summary?.semanticApplySuccessProven !== false) {
    add(
      findings,
      'MTR-API-APPLY-RESULT-004',
      'apply-readback report should not claim semantic apply success before a guarded apply-result exists.',
      'applyReadback.summary.semanticApplySuccessProven',
      'Use apply-readback evidence as local binding only; semantic apply success belongs in the apply-result contract.',
    );
  }
}

function applyReadbackReportHash(report) {
  return isObject(report) ? sha256(report) : null;
}

function apiApplyResultCoverage() {
  return listApiEndpoints().reduce((coverage, endpoint) => {
    const isWriteEndpoint = endpoint.operationType === 'write';
    coverage[endpoint.id] = {
      schemaVersion: API_APPLY_RESULT_SCHEMA_VERSION,
      supportStatus: isWriteEndpoint ? 'local-apply-result-contract' : 'not-write-endpoint',
      templateCommand: isWriteEndpoint
        ? 'metro api apply-result template --apply-audit <api-apply-audit.jsonl> --apply-readback <api-apply-readback.json> [--row <n>] [--json]'
        : null,
      validationCommand: isWriteEndpoint
        ? 'metro api apply-result validate --file <api-apply-result.json> --apply-audit <api-apply-audit.jsonl> --apply-readback <api-apply-readback.json> [--row <n>] [--json]'
        : null,
      apiAccess: 'none',
      applyEnabledInCurrentCli: false,
      liveApplyAuthorizedByThisRecord: false,
      requiredEvidence: isWriteEndpoint
        ? ['validated-apply-audit-jsonl', 'validated-apply-readback-report', 'guarded-runner-id', 'current-turn-authorization-captured-at-execution', 'live-audit-row-hash', 'response-object-ids', 'response-hash', 'semantic-read-back-success', 'rollback-remediation', 'idempotency-review', 'secret-free-evidence']
        : [],
    };
    return coverage;
  }, {});
}

function buildApiApplyResultTemplate(options = {}) {
  const {
    applyAuditText,
    applyAuditPath = null,
    applyReadbackReport,
    applyReadbackPath = null,
    rowNumber = null,
  } = options;
  const findings = [];
  const audit = selectedApplyAuditEvidence(applyAuditText, rowNumber, findings);
  validateApplyReadbackReport(applyReadbackReport, findings);

  if (
    audit.selectedRow
    && isObject(applyReadbackReport)
    && (
      applyReadbackReport.summary?.applyEndpointId !== audit.selectedRow.endpoint?.id
      || applyReadbackReport.summary?.tenant !== audit.selectedRow.tenant
    )
  ) {
    add(
      findings,
      'MTR-API-APPLY-RESULT-005',
      'apply-readback report must match the selected apply-audit endpoint and tenant.',
      'applyReadback.summary',
      'Regenerate apply-readback evidence from the same apply-audit row and tenant.',
    );
  }

  const blocked = findings.some((item) => item.severity === 'error');
  const readbackHash = applyReadbackReportHash(applyReadbackReport);
  const row = audit.selectedRow;
  const endpoint = audit.endpoint;
  return {
    schemaVersion: API_APPLY_RESULT_TEMPLATE_SCHEMA_VERSION,
    generatedFrom: 'packages/metro-core/src/api-catalog/apply-result.js',
    apiAccess: 'none',
    liveExecution: clone(LOCAL_ONLY_LIVE_EXECUTION),
    applyEnabledInCurrentCli: false,
    liveApplyAuthorizedByThisTemplate: false,
    blocked,
    endpoint: endpointSnapshot(endpoint),
    tenant: row?.tenant || applyReadbackReport?.summary?.tenant || null,
    prerequisiteSummary: {
      applyAuditRows: audit.rows.length,
      selectedApplyAuditRow: audit.selectedRowNumber,
      applyAuditValid: audit.validation.valid,
      applyReadbackValid: applyReadbackReport?.valid === true,
      applyReadbackCompatible: applyReadbackReport?.readBackCompatibility?.compatible === true,
      semanticApplySuccessProvenByPrerequisites: false,
      applyReadbackReportHash: readbackHash,
    },
    futureApplyResult: blocked ? null : {
      schemaVersion: API_APPLY_RESULT_SCHEMA_VERSION,
      generatedFrom: '<future guarded expert API apply runner>',
      apiAccess: 'guarded-write-result',
      liveExecution: clone(LOCAL_ONLY_LIVE_EXECUTION),
      applyEnabledInCurrentCli: false,
      liveApplyAuthorizedByThisRecord: false,
      mode: 'apply',
      tenant: row.tenant,
      endpoint: endpointSnapshot(endpoint),
      requestSummary: {
        method: row.requestSummary.method,
        path: row.requestSummary.path,
        requestHash: row.requestSummary.requestHash,
        payloadHash: row.requestSummary.payloadHash,
        permissionScope: row.requestSummary.permissionScope,
        rawRequestBodyStored: false,
      },
      applyAudit: {
        filePath: applyAuditPath || '<api-apply-audit.jsonl>',
        rowNumber: audit.selectedRowNumber,
        validationResult: 'passed',
        requestHash: row.requestSummary.requestHash,
        payloadHash: row.requestSummary.payloadHash,
      },
      applyReadback: {
        filePath: applyReadbackPath || '<api-apply-readback.json>',
        reportHash: readbackHash,
        validationResult: 'passed',
        compatible: true,
        readEndpointId: applyReadbackReport.summary.readEndpointId,
      },
      execution: {
        status: '<success|failed>',
        guardedRunnerId: '<guarded runner id>',
        startedAt: '<ISO timestamp>',
        completedAt: '<ISO timestamp>',
        currentTurnAuthorizationCaptured: '<true only when the guarded runner captured exact current-turn authorization>',
        liveAuditRowHash: 'sha256:<64 lowercase hex live audit row hash>',
      },
      response: {
        statusCode: '<2xx>',
        responseHash: 'sha256:<64 lowercase hex response hash>',
        responseObjectIds: [
          { system: 'metronome', role: '<created|updated object role>', id: '<metronome object id>' },
        ],
      },
      verification: {
        status: '<passed|failed>',
        semanticApplySuccessProven: '<true after semantic read-back comparison>',
        applyReadbackReportHash: readbackHash,
        checks: [
          {
            id: '<semantic read-back check id>',
            readEndpointId: applyReadbackReport.summary.readEndpointId,
            result: '<passed|failed>',
            evidenceHash: 'sha256:<64 lowercase hex evidence hash>',
          },
        ],
      },
      rollbackOrRemediationPlan: row.rollbackOrRemediationPlan,
      idempotencyReview: row.idempotencyReview,
      warnings: [],
    },
    findings,
    nextSafeStep: blocked
      ? 'Fix apply-audit and apply-readback prerequisites before using this apply-result contract template.'
      : 'Fill this template only from a future guarded expert API apply runner. The current CLI still does not run live expert API apply.',
    sources: uniqueList([
      'docs/metronome-cli/one-goal.md',
      'docs/metronome-cli/CLI_ARCHITECTURE.md',
      'docs/metronome-cli/VALIDATION_AND_GUARDRAILS.md',
      'packages/metro-core/src/api-catalog/apply-audit.js',
      'packages/metro-core/src/api-catalog/apply-readback.js',
      ...list(row?.endpoint?.sourceIds),
      ...list(applyReadbackReport?.sources),
    ]),
  };
}

function validateResponseObjectIds(findings, ids) {
  if (list(ids).length === 0) {
    add(
      findings,
      'MTR-API-APPLY-RESULT-009',
      'response.responseObjectIds must include at least one object identifier.',
      'response.responseObjectIds',
      'Record created or updated Metronome object IDs returned by the guarded apply.',
    );
    return;
  }
  list(ids).forEach((item, index) => {
    for (const field of ['system', 'role', 'id']) {
      if (!filled(item?.[field])) {
        add(
          findings,
          'MTR-API-APPLY-RESULT-009',
          `response.responseObjectIds[${index}].${field} is required.`,
          `response.responseObjectIds[${index}].${field}`,
          'Use structured identifiers with system, role, and id.',
        );
      }
    }
  });
}

function validateApiApplyResult(input, options = {}) {
  const {
    applyAuditText,
    applyReadbackReport,
    rowNumber = null,
  } = options;
  const findings = [];
  const audit = selectedApplyAuditEvidence(applyAuditText, rowNumber, findings);
  validateApplyReadbackReport(applyReadbackReport, findings);
  const readbackHash = applyReadbackReportHash(applyReadbackReport);

  if (!isObject(input)) {
    return {
      schemaVersion: API_APPLY_RESULT_VALIDATION_SCHEMA_VERSION,
      generatedFrom: 'packages/metro-core/src/api-catalog/apply-result.js',
      apiAccess: 'none',
      applyEnabledInCurrentCli: false,
      liveApplyAuthorizedByThisRecord: false,
      valid: false,
      findings: [
        finding(
          'MTR-API-APPLY-RESULT-000',
          'error',
          'API apply-result must be a JSON object.',
          '$',
          'Pass a metro.api.apply-result.v1 JSON file.',
        ),
      ],
      summary: {},
    };
  }

  scanForSecrets(input, findings);

  const row = audit.selectedRow;
  const endpoint = audit.endpoint;
  if (input.schemaVersion !== API_APPLY_RESULT_SCHEMA_VERSION) {
    add(findings, 'MTR-API-APPLY-RESULT-001', `schemaVersion must be ${API_APPLY_RESULT_SCHEMA_VERSION}.`, 'schemaVersion', 'Use a current metro.api.apply-result.v1 evidence file.');
  }
  if (input.apiAccess !== 'guarded-write-result') {
    add(findings, 'MTR-API-APPLY-RESULT-001', 'apiAccess must be guarded-write-result.', 'apiAccess', 'Apply-result evidence must come from a future guarded runner, not a raw endpoint wrapper.');
  }
  if (input.applyEnabledInCurrentCli !== false || input.liveApplyAuthorizedByThisRecord !== false) {
    add(findings, 'MTR-API-APPLY-RESULT-001', 'apply-result evidence must not authorize future live API apply.', 'applyEnabledInCurrentCli', 'Durable evidence can record a past guarded run, but it is not reusable live-operation authorization.');
  }
  if (input.mode !== 'apply') {
    add(findings, 'MTR-API-APPLY-RESULT-001', 'mode must be apply.', 'mode', 'Do not validate preview, preflight, or read-back files as apply results.');
  }
  if (!VALID_TENANTS.has(input.tenant)) {
    add(findings, 'MTR-TENANT-001', 'tenant must be sandbox or production.', 'tenant', 'Bind every apply result to exactly one tenant.');
  }
  if (row && input.tenant !== row.tenant) {
    add(findings, 'MTR-TENANT-001', 'apply-result tenant must match the selected apply-audit row.', 'tenant', 'Use evidence from the same tenant as the planned apply-audit row.');
  }
  if (row && isObject(applyReadbackReport) && input.tenant !== applyReadbackReport.summary?.tenant) {
    add(findings, 'MTR-TENANT-001', 'apply-result tenant must match the apply-readback report.', 'tenant', 'Use one tenant across apply-audit, apply-readback, and apply-result evidence.');
  }

  if (!endpoint || input.endpoint?.id !== endpoint?.id || input.endpoint?.method !== endpoint?.method || input.endpoint?.path !== endpoint?.path || input.endpoint?.permissionScope !== endpoint?.permissionScope) {
    add(findings, 'MTR-ENDPOINT-001', 'endpoint must match the selected reviewed write endpoint.', 'endpoint', 'Regenerate from the reviewed endpoint catalog and selected apply-audit row.');
  }

  if (!isObject(input.requestSummary)) {
    add(findings, 'MTR-API-APPLY-RESULT-006', 'requestSummary is required.', 'requestSummary', 'Record method, path, request hash, payload hash, permission scope, and raw-body policy.');
  } else if (row && endpoint) {
    for (const field of ['method', 'path', 'permissionScope']) {
      if (input.requestSummary[field] !== endpoint[field]) {
        add(findings, 'MTR-ENDPOINT-001', `requestSummary.${field} must match the reviewed endpoint catalog.`, `requestSummary.${field}`, 'Do not use guessed endpoint metadata.');
      }
    }
    if (input.requestSummary.requestHash !== row.requestSummary?.requestHash) {
      add(findings, 'MTR-HASH-002', 'requestSummary.requestHash must match the apply-audit row.', 'requestSummary.requestHash', 'Use the request hash from planned apply-audit evidence.');
    }
    if (input.requestSummary.payloadHash !== row.requestSummary?.payloadHash) {
      add(findings, 'MTR-HASH-002', 'requestSummary.payloadHash must match the apply-audit row.', 'requestSummary.payloadHash', 'Use the payload hash from planned apply-audit evidence.');
    }
    if (input.requestSummary.rawRequestBodyStored !== false) {
      add(findings, 'MTR-API-APPLY-RESULT-006', 'requestSummary.rawRequestBodyStored must be false.', 'requestSummary.rawRequestBodyStored', 'Store request hashes only, never raw request bodies.');
    }
  }
  validateHash(findings, input.requestSummary?.requestHash, 'requestSummary.requestHash');
  validateHash(findings, input.requestSummary?.payloadHash, 'requestSummary.payloadHash');

  if (!isObject(input.applyAudit)) {
    add(findings, 'MTR-API-APPLY-RESULT-007', 'applyAudit binding is required.', 'applyAudit', 'Bind apply-result evidence back to the selected apply-audit JSONL row.');
  } else {
    if (input.applyAudit.rowNumber !== audit.selectedRowNumber) {
      add(findings, 'MTR-API-APPLY-RESULT-007', 'applyAudit.rowNumber must match the selected apply-audit row.', 'applyAudit.rowNumber', 'Use the same --row value across apply-audit, apply-readback, and apply-result evidence.');
    }
    if (input.applyAudit.validationResult !== 'passed') {
      add(findings, 'MTR-API-APPLY-RESULT-007', 'applyAudit.validationResult must be passed.', 'applyAudit.validationResult', 'Validate apply-audit JSONL before accepting apply-result evidence.');
    }
    if (row && input.applyAudit.requestHash !== row.requestSummary?.requestHash) {
      add(findings, 'MTR-HASH-002', 'applyAudit.requestHash must match the selected apply-audit row.', 'applyAudit.requestHash', 'Carry forward the exact planned request hash.');
    }
    if (row && input.applyAudit.payloadHash !== row.requestSummary?.payloadHash) {
      add(findings, 'MTR-HASH-002', 'applyAudit.payloadHash must match the selected apply-audit row.', 'applyAudit.payloadHash', 'Carry forward the exact planned payload hash.');
    }
  }

  if (!isObject(input.applyReadback)) {
    add(findings, 'MTR-API-APPLY-RESULT-008', 'applyReadback binding is required.', 'applyReadback', 'Bind apply-result evidence to a valid apply-readback report.');
  } else {
    if (input.applyReadback.validationResult !== 'passed' || input.applyReadback.compatible !== true) {
      add(findings, 'MTR-API-APPLY-RESULT-008', 'applyReadback must have validationResult=passed and compatible=true.', 'applyReadback', 'Use a valid compatible apply-readback report.');
    }
    if (input.applyReadback.reportHash !== readbackHash) {
      add(findings, 'MTR-HASH-002', 'applyReadback.reportHash must match the supplied apply-readback report.', 'applyReadback.reportHash', 'Hash the exact apply-readback JSON report being validated against.');
    }
    if (isObject(applyReadbackReport) && input.applyReadback.readEndpointId !== applyReadbackReport.summary?.readEndpointId) {
      add(findings, 'MTR-API-APPLY-RESULT-008', 'applyReadback.readEndpointId must match the supplied apply-readback report.', 'applyReadback.readEndpointId', 'Use the same read-back report that was reviewed for endpoint compatibility.');
    }
  }

  if (!isObject(input.execution)) {
    add(findings, 'MTR-API-APPLY-RESULT-010', 'execution evidence is required.', 'execution', 'Record guarded runner execution metadata.');
  } else {
    if (!VALID_SUCCESS.has(input.execution.status)) {
      add(findings, 'MTR-API-APPLY-RESULT-010', 'execution.status must be success or passed.', 'execution.status', 'Only successful guarded write execution can be valid apply-result evidence.');
    }
    requireFilled(findings, input.execution.guardedRunnerId, 'execution.guardedRunnerId', 'execution.guardedRunnerId is required.', 'Record the guarded runner that performed the write.');
    if (!isIsoTimestamp(input.execution.startedAt)) add(findings, 'MTR-API-APPLY-RESULT-010', 'execution.startedAt must be an ISO timestamp.', 'execution.startedAt', 'Record when guarded execution started.');
    if (!isIsoTimestamp(input.execution.completedAt)) add(findings, 'MTR-API-APPLY-RESULT-010', 'execution.completedAt must be an ISO timestamp.', 'execution.completedAt', 'Record when guarded execution completed.');
    if (input.execution.currentTurnAuthorizationCaptured !== true) {
      add(findings, 'MTR-API-APPLY-RESULT-010', 'execution.currentTurnAuthorizationCaptured must be true.', 'execution.currentTurnAuthorizationCaptured', 'A real guarded apply result must record that exact current-turn authorization was captured for that execution.');
    }
    validateHash(findings, input.execution.liveAuditRowHash, 'execution.liveAuditRowHash', 'Hash the live audit row that recorded the guarded write.');
  }

  if (!isObject(input.response)) {
    add(findings, 'MTR-API-APPLY-RESULT-009', 'response evidence is required.', 'response', 'Record status code, response hash, and response object IDs.');
  } else {
    if (!Number.isInteger(input.response.statusCode) || input.response.statusCode < 200 || input.response.statusCode >= 300) {
      add(findings, 'MTR-API-APPLY-RESULT-009', 'response.statusCode must be a 2xx integer.', 'response.statusCode', 'Only successful Metronome write responses can be valid apply-result evidence.');
    }
    validateHash(findings, input.response.responseHash, 'response.responseHash', 'Hash the guarded write response without storing raw response secrets.');
    validateResponseObjectIds(findings, input.response.responseObjectIds);
  }

  if (!isObject(input.verification)) {
    add(findings, 'MTR-VERIFY-001', 'verification evidence is required.', 'verification', 'Record semantic read-back verification after the guarded apply.');
  } else {
    if (input.verification.status !== 'passed') {
      add(findings, 'MTR-VERIFY-001', 'verification.status must be passed.', 'verification.status', 'Apply-result evidence is valid only after semantic read-back passes.');
    }
    if (input.verification.semanticApplySuccessProven !== true) {
      add(findings, 'MTR-VERIFY-001', 'verification.semanticApplySuccessProven must be true.', 'verification.semanticApplySuccessProven', 'Apply-result evidence must prove semantic success, not just local evidence binding.');
    }
    if (input.verification.applyReadbackReportHash !== readbackHash) {
      add(findings, 'MTR-HASH-002', 'verification.applyReadbackReportHash must match the supplied apply-readback report.', 'verification.applyReadbackReportHash', 'Bind semantic verification to the exact apply-readback report.');
    }
    if (list(input.verification.checks).length === 0) {
      add(findings, 'MTR-VERIFY-001', 'verification.checks must include at least one semantic read-back check.', 'verification.checks', 'Record the post-apply check that proves the expected state.');
    }
    list(input.verification.checks).forEach((check, index) => {
      const pathName = `verification.checks[${index}]`;
      requireFilled(findings, check?.id, `${pathName}.id`, 'verification check id is required.', 'Record a stable check id.');
      if (check?.result !== 'passed') {
        add(findings, 'MTR-VERIFY-001', `${pathName}.result must be passed.`, `${pathName}.result`, 'Do not treat incomplete or failed read-back checks as valid apply-result evidence.');
      }
      validateHash(findings, check?.evidenceHash, `${pathName}.evidenceHash`, 'Hash the semantic verification evidence.');
    });
  }

  requireFilled(findings, input.rollbackOrRemediationPlan, 'rollbackOrRemediationPlan', 'rollbackOrRemediationPlan is required.', 'Record rollback or remediation ownership before treating apply-result evidence as reusable.');
  requireFilled(findings, input.idempotencyReview, 'idempotencyReview', 'idempotencyReview is required.', 'Record how retries avoid duplicate Metronome objects.');
  if (!Array.isArray(input.warnings)) {
    add(findings, 'MTR-API-APPLY-RESULT-001', 'warnings must be an array.', 'warnings', 'Use an empty array when there are no warnings.');
  }

  if (Object.prototype.hasOwnProperty.call(input, 'requestBody') || Object.prototype.hasOwnProperty.call(input.requestSummary || {}, 'body')) {
    add(findings, 'MTR-API-APPLY-RESULT-006', 'API apply-result must not include raw request bodies.', 'requestBody', 'Store request hashes and field names only.');
  }
  if (Object.prototype.hasOwnProperty.call(input, 'responseData') || Object.prototype.hasOwnProperty.call(input, 'rawResponse')) {
    add(findings, 'MTR-API-APPLY-RESULT-009', 'API apply-result must not include raw response data.', 'responseData', 'Store response hashes and object IDs only.');
  }

  const valid = !findings.some((item) => item.severity === 'error');
  return {
    schemaVersion: API_APPLY_RESULT_VALIDATION_SCHEMA_VERSION,
    generatedFrom: 'packages/metro-core/src/api-catalog/apply-result.js',
    apiAccess: 'none',
    liveExecution: clone(LOCAL_ONLY_LIVE_EXECUTION),
    applyEnabledInCurrentCli: false,
    liveApplyAuthorizedByThisRecord: false,
    valid,
    blocked: !valid,
    summary: {
      endpointId: input.endpoint?.id || null,
      tenant: input.tenant || null,
      applyAuditRow: audit.selectedRowNumber,
      requestHash: input.requestSummary?.requestHash || null,
      payloadHash: input.requestSummary?.payloadHash || null,
      responseObjectCount: list(input.response?.responseObjectIds).length,
      semanticApplySuccessProven: input.verification?.semanticApplySuccessProven === true,
      currentTurnAuthorizationCaptured: input.execution?.currentTurnAuthorizationCaptured === true,
      applyReadbackReportHash: readbackHash,
    },
    findings,
    nextSafeStep: valid
      ? 'Keep this as guarded expert API apply-result evidence. It validates a past execution record only and does not authorize another live operation.'
      : 'Fix the apply-result evidence and re-run metro api apply-result validate before treating it as guarded write proof.',
    sources: uniqueList([
      'docs/metronome-cli/one-goal.md',
      'docs/metronome-cli/CLI_ARCHITECTURE.md',
      'docs/metronome-cli/VALIDATION_AND_GUARDRAILS.md',
      'packages/metro-core/src/api-catalog/apply-result.js',
      'packages/metro-core/src/api-catalog/apply-audit.js',
      'packages/metro-core/src/api-catalog/apply-readback.js',
      ...list(input.endpoint?.sourceIds),
      ...list(applyReadbackReport?.sources),
    ]),
  };
}

module.exports = {
  API_APPLY_RESULT_SCHEMA_VERSION,
  API_APPLY_RESULT_TEMPLATE_SCHEMA_VERSION,
  API_APPLY_RESULT_VALIDATION_SCHEMA_VERSION,
  apiApplyResultCoverage,
  buildApiApplyResultTemplate,
  validateApiApplyResult,
};
