'use strict';

const { assertReadOnlyEndpoint } = require('../clients/metronome-read');
const {
  APPLY_RESULT_SCHEMA_VERSION,
  buildFutureWorkflowEvidence,
  buildTemplateVerificationChecks,
  buildTemplateWriteRows,
  buildWorkflowEvidenceBundles,
  getWorkflowApplyResultContract,
  validateWorkflowEvidence,
  workflowApplyResultKey,
} = require('../evidence-gates/apply-result-contracts');

const VERIFY_APPLY_RESULT_SCHEMA_VERSION = 'metro.verify.apply-result.v1';
const APPLY_RESULT_TEMPLATE_SCHEMA_VERSION = 'metro.verify.apply-result.template.v1';
const VALID_TENANTS = new Set(['sandbox', 'production']);
const VALID_VERIFICATION_STATUS = new Set(['passed']);
const VALID_RESULTS = new Set(['success', 'passed']);
const VALID_SKIPPED_RESULTS = new Set(['skipped']);
const SECRET_KEY_PATTERN = /(secret|token|api[_-]?key|authorization|bearer|password|private[_-]?key)/i;
const SECRET_KEY_ALLOWLIST = new Set([
  'authorization',
  'currentTurnAuthorizationCapturedAtExecution',
  'currentTurnAuthorizationRequiredAtExecution',
  'durableApprovalIsCurrentTurnAuthorization',
  'liveApplyAuthorizedByThisRecord',
  'keyFingerprint',
]);
const SECRET_VALUE_PATTERN = /(sk_live_|sk_test_|pk_live_|prod_[A-Za-z0-9]{12,}|Bearer\s+[A-Za-z0-9._-]+)/;
const LOCAL_ONLY_LIVE_EXECUTION = {
  enabledInCurrentCli: false,
  reason: 'Workflow apply-result templates are local evidence contracts only; the current CLI does not run workflow apply commands.',
  nextSafeStep: 'Fill the template only from a future guarded workflow apply runner after reviewed preflight, audit, sandbox proof, rollback, idempotency, and read-back evidence exist.',
};

function finding(id, severity, message, remediation) {
  return {
    id,
    severity,
    message,
    remediation,
  };
}

function clone(value) {
  if (value instanceof Set) return [...value];
  if (Array.isArray(value)) return value.map((item) => clone(item));
  if (!isObject(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, clone(child)]));
}

function isObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function nonEmpty(value) {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function isSha256(value) {
  return typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
}

function buildApplyResultTemplate(options = {}) {
  const { workflow, shape, tenant = '<sandbox|production>' } = options;
  const key = workflowApplyResultKey(workflow, shape);
  const contract = getWorkflowApplyResultContract(workflow, shape);
  if (!contract) return null;

  return {
    schemaVersion: APPLY_RESULT_TEMPLATE_SCHEMA_VERSION,
    generatedFrom: 'metronome-cli/src/verify/apply-result.js',
    apiAccess: 'none',
    liveExecution: clone(LOCAL_ONLY_LIVE_EXECUTION),
    applyEnabledInCurrentCli: false,
    liveApplyAuthorizedByThisTemplate: false,
    workflow,
    shape,
    tenant,
    applyResultSchemaVersion: APPLY_RESULT_SCHEMA_VERSION,
    verifyCommand: 'metro verify apply-result --file <apply-result.json> --json',
    requiredWriteEndpoints: clone(contract.requiredWriteEndpoints || contract.writeEndpoints),
    skippableWriteIds: clone(contract.skippableWriteIds || new Set()),
    requiredVerificationChecks: clone(contract.requiredVerificationChecks || []),
    workflowEvidenceBundles: buildWorkflowEvidenceBundles(key, workflow, shape, tenant, contract),
    futureApplyResult: {
      schemaVersion: APPLY_RESULT_SCHEMA_VERSION,
      workflow,
      shape,
      tenant,
      mode: 'apply',
      payloadHash: 'sha256:<64 lowercase hex reviewed preview hash>',
      confirmedHash: 'sha256:<64 lowercase hex reviewed preview hash>',
      preflight: {
        filePath: '<path-to-preflight-json>',
        validationResult: 'passed',
      },
      auditLog: {
        path: '<path-to-apply-audit-jsonl>',
        rowCount: '<number of successful and skipped apply-audit rows>',
        validationResult: 'passed',
      },
      keyFingerprint: {
        envVar: '<METRONOME_SANDBOX_KEY|METRONOME_PROD_KEY>',
        fingerprint: '<non-secret key fingerprint>',
      },
      workflowEvidence: buildFutureWorkflowEvidence(key, workflow, shape, tenant, contract),
      requestSummary: buildTemplateWriteRows(key, contract),
      created: [
        { system: 'metronome', role: '<created object role>', id: '<created metronome object id>' },
      ],
      updated: [
        { system: 'metronome', role: '<updated object role or skipped status role>', id: '<updated metronome object id or reviewed skipped status>' },
      ],
      verification: {
        status: 'passed',
        checks: buildTemplateVerificationChecks(contract),
      },
      warnings: [],
      rollback: {
        plan: '<reviewed rollback or remediation plan>',
        owner: '<billing-ops owner>',
      },
      idempotency: {
        strategy: '<stable idempotency strategy>',
        duplicatePrevention: '<retry and duplicate-prevention evidence>',
      },
    },
    notes: [
      'This template is not apply authorization and does not prove a live operation happened.',
      'Required write endpoints must have success or passed status; skipped status is accepted only for listed optional write IDs.',
      'Every read-back check must use a read-only endpoint and include passed semantic evidence before this apply-result can validate.',
      'Never store raw request bodies, API keys, bearer tokens, Stripe secrets, payment details, or Authorization headers in apply-result evidence.',
    ],
    sources: [
      'docs/metronome-cli/one-goal.md',
      'docs/metronome-cli/CLI_ARCHITECTURE.md',
      'docs/metronome-cli/VALIDATION_AND_GUARDRAILS.md',
      'docs/SAFETY.md',
      'metronome-cli/src/evidence-gates/apply-result-contracts.js',
      'metronome-cli/src/verify/apply-result.js',
    ],
  };
}

function collectSecretFindings(value, path = '$') {
  const findings = [];

  if (typeof value === 'string') {
    if (SECRET_VALUE_PATTERN.test(value)) {
      findings.push(finding(
        'MTR-SECRET-002',
        'error',
        `Apply result appears to contain a secret-like value at ${path}.`,
        'Remove secret values; apply results may include hashes and non-secret fingerprints only.',
      ));
    }
    return findings;
  }

  if (!isObject(value)) return findings;

  for (const [key, nested] of Object.entries(value)) {
    const nestedPath = `${path}.${key}`;
    if (SECRET_KEY_PATTERN.test(key) && !SECRET_KEY_ALLOWLIST.has(key)) {
      findings.push(finding(
        'MTR-SECRET-001',
        'error',
        `Apply result contains forbidden secret-shaped field ${nestedPath}.`,
        'Store hashes or fingerprints only; never store raw keys, tokens, passwords, or Authorization headers.',
      ));
    }
    findings.push(...collectSecretFindings(nested, nestedPath));
  }

  return findings;
}

function validateStringField(object, field, findings, label = field) {
  if (!nonEmpty(object?.[field])) {
    findings.push(finding(
      'MTR-APPLY-001',
      'error',
      `Apply result missing required field: ${label}.`,
      `Include ${label} in every apply result evidence file.`,
    ));
  }
}

function validateHash(value, field, findings) {
  if (!isSha256(value)) {
    findings.push(finding(
      'MTR-HASH-001',
      'error',
      `${field} must be sha256:<64 lowercase hex>.`,
      'Use the canonical hash emitted by metro preview, audit, or artifact hashing.',
    ));
  }
}

function validateTargetIds(items, field, findings) {
  if (list(items).length === 0) {
    findings.push(finding(
      'MTR-APPLY-002',
      'error',
      `${field} must include at least one object identifier.`,
      'Record created or updated Metronome object identifiers so verification has concrete targets.',
    ));
    return;
  }

  list(items).forEach((item, index) => {
    for (const key of ['system', 'role', 'id']) {
      if (!nonEmpty(item?.[key])) {
        findings.push(finding(
          'MTR-APPLY-003',
          'error',
          `${field}[${index}].${key} is required.`,
          'Use structured identifiers with system, role, and id.',
        ));
      }
    }
  });
}

function endpointMatches(endpoint, allowed) {
  return allowed.some((item) => item.method === endpoint?.method && item.path === endpoint?.path);
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function endpointPathMatches(actualPath, expectedPath) {
  if (actualPath === expectedPath) return true;
  if (typeof actualPath !== 'string' || typeof expectedPath !== 'string') return false;

  const pattern = expectedPath
    .split(/(\{[^}]+\})/)
    .map((part) => (part.startsWith('{') && part.endsWith('}') ? '[^/?]+' : escapeRegex(part)))
    .join('');
  const suffix = expectedPath.includes('?') ? '$' : '(?:\\?.*)?$';
  return new RegExp(`^${pattern}${suffix}`).test(actualPath);
}

function verificationCheckMatches(check, expected) {
  return check?.id === expected.id
    && String(check?.method || '').toUpperCase() === expected.method
    && endpointPathMatches(check?.path, expected.path);
}

function validateWriteSummary(requestSummary, contract, findings) {
  if (list(requestSummary).length === 0) {
    findings.push(finding(
      'MTR-APPLY-004',
      'error',
      'requestSummary must include at least one write endpoint summary.',
      'Record method, path, requestBodyHash, status, and response object ids for each apply write.',
    ));
    return;
  }

  requestSummary.forEach((item, index) => {
    if (!endpointMatches(item, contract.writeEndpoints)) {
      findings.push(finding(
        'MTR-APPLY-005',
        'error',
        `requestSummary[${index}] is not an approved write endpoint for this workflow and shape.`,
        'Use the endpoint plan from the approved preview/preflight, not a raw or guessed endpoint.',
      ));
    }

    if (VALID_SKIPPED_RESULTS.has(item?.status)) {
      validateSkippedWriteSummary(item, index, contract, findings);
      return;
    }

    validateHash(item?.requestBodyHash, `requestSummary[${index}].requestBodyHash`, findings);
    if (!VALID_RESULTS.has(item?.status)) {
      findings.push(finding(
        'MTR-APPLY-006',
        'error',
        `requestSummary[${index}].status must be success, passed, or an explicitly supported skipped optional write.`,
        'Only successful required writes or explicitly skipped optional writes can be treated as valid apply evidence.',
      ));
    }
    validateTargetIds(item?.responseObjectIds, `requestSummary[${index}].responseObjectIds`, findings);
  });
}

function validateSkippedWriteSummary(item, index, contract, findings) {
  const skippableWriteIds = contract.skippableWriteIds || new Set();

  if (!nonEmpty(item?.id) || !skippableWriteIds.has(item.id)) {
    findings.push(finding(
      'MTR-APPLY-012',
      'error',
      `requestSummary[${index}] skipped rows must use a supported optional write id.`,
      'Use a reviewed optional write id so skipped evidence cannot hide a required write.',
    ));
  }

  if (!nonEmpty(item?.skipReason)) {
    findings.push(finding(
      'MTR-APPLY-013',
      'error',
      `requestSummary[${index}].skipReason is required for skipped optional writes.`,
      'Explain why the reviewed preview made this optional write not applicable.',
    ));
  }

  validateHash(item?.skipEvidenceHash, `requestSummary[${index}].skipEvidenceHash`, findings);
  validateTargetIds(item?.responseObjectIds, `requestSummary[${index}].responseObjectIds`, findings);
}

function validateRequiredWriteEndpoints(requestSummary, contract, findings) {
  if (list(contract.requiredWriteEndpoints).length === 0) return;

  for (const required of contract.requiredWriteEndpoints) {
    if (!list(requestSummary).some((item) => endpointMatches(item, [required]) && VALID_RESULTS.has(item?.status))) {
      findings.push(finding(
        'MTR-APPLY-011',
        'error',
        `Apply result missing required write endpoint ${required.method} ${required.path}.`,
        'Record every required write endpoint from the reviewed workflow apply plan before treating apply evidence as complete.',
      ));
    }
  }
}

function validateReadBackChecks(checks, findings) {
  if (list(checks).length === 0) {
    findings.push(finding(
      'MTR-VERIFY-001',
      'error',
      'verification.checks must include at least one read-back check.',
      'Record read-back verification checks that prove the expected post-apply state.',
    ));
    return;
  }

  list(checks).forEach((check, index) => {
    for (const field of ['id', 'expectation', 'result', 'method', 'path']) {
      if (!nonEmpty(check?.[field])) {
        findings.push(finding(
          'MTR-VERIFY-005',
          'error',
          `verification.checks[${index}].${field} is required.`,
          'Use complete verification checks with id, endpoint, expectation, result, and evidence hash.',
        ));
      }
    }

    if (check?.result !== 'passed') {
      findings.push(finding(
        'MTR-VERIFY-006',
        'error',
        `verification.checks[${index}].result must be passed.`,
        'Do not treat incomplete or failed read-back checks as a valid apply result.',
      ));
    }

    try {
      assertReadOnlyEndpoint({ method: check?.method, path: check?.path });
    } catch (error) {
      findings.push(finding(
        error.code || 'MTR-READ-ENDPOINT-000',
        'error',
        `verification.checks[${index}] is not a permitted read endpoint: ${error.message}`,
        'Read-back verification must use read-only endpoints.',
      ));
    }

    validateHash(check?.evidenceHash, `verification.checks[${index}].evidenceHash`, findings);
  });
}

function validateRequiredReadBackChecks(checks, contract, findings) {
  if (list(contract.requiredVerificationChecks).length === 0) return;

  for (const required of contract.requiredVerificationChecks) {
    if (!list(checks).some((check) => verificationCheckMatches(check, required) && check?.result === 'passed')) {
      findings.push(finding(
        'MTR-VERIFY-010',
        'error',
        `verification.checks missing required read-back ${required.id} at ${required.method} ${required.path}.`,
        'Record each workflow-specific read-back check with the reviewed endpoint, passed result, evidence path, and evidence hash.',
      ));
    }
  }
}

function validateWarnings(warnings, findings) {
  if (!Array.isArray(warnings)) {
    findings.push(finding(
      'MTR-VERIFY-007',
      'error',
      'warnings must be an array.',
      'Keep warnings as arrays so machines can distinguish clean outputs from known caveats.',
    ));
    return;
  }

  warnings.forEach((warning, index) => {
    if (!isObject(warning)) {
      findings.push(finding(
        'MTR-VERIFY-008',
        'error',
        `warnings[${index}] must be an object.`,
        'Use warning objects with id, severity, message, and remediation fields.',
      ));
      return;
    }
    for (const field of ['id', 'severity', 'message', 'remediation']) {
      if (!nonEmpty(warning[field])) {
        findings.push(finding(
          'MTR-VERIFY-009',
          'error',
          `warnings[${index}].${field} is required.`,
          'Use complete warning objects so operators can act on the caveat.',
        ));
      }
    }
  });
}

function verifyApplyResult(output) {
  const findings = [];

  if (!isObject(output)) {
    return {
      schemaVersion: VERIFY_APPLY_RESULT_SCHEMA_VERSION,
      inspectedSchemaVersion: null,
      workflow: null,
      valid: false,
      findings: [finding(
        'MTR-APPLY-000',
        'error',
        'Apply result must be a JSON object.',
        'Pass a JSON file produced by a supported metro apply runner.',
      )],
      summary: {
        writeCount: 0,
        verificationCount: 0,
      },
    };
  }

  if (output.schemaVersion !== APPLY_RESULT_SCHEMA_VERSION) {
    findings.push(finding(
      'MTR-APPLY-007',
      'error',
      `Apply result schemaVersion must be ${APPLY_RESULT_SCHEMA_VERSION}.`,
      'Use the current apply output contract before treating this file as apply evidence.',
    ));
  }

  for (const field of ['workflow', 'shape', 'tenant', 'payloadHash', 'confirmedHash', 'mode']) {
    validateStringField(output, field, findings);
  }

  const contract = getWorkflowApplyResultContract(output.workflow, output.shape);
  if (!contract) {
    findings.push(finding(
      'MTR-APPLY-008',
      'error',
      'workflow and shape are not a supported apply-result pair.',
      'Use apply-result evidence from an approved workflow and shape.',
    ));
  }

  if (!VALID_TENANTS.has(output.tenant)) {
    findings.push(finding(
      'MTR-TENANT-001',
      'error',
      'Apply result tenant must be sandbox or production.',
      'Apply evidence must identify exactly one Metronome tenant.',
    ));
  }

  if (output.mode !== 'apply') {
    findings.push(finding(
      'MTR-APPLY-009',
      'error',
      'Apply result mode must be apply.',
      'Do not pass preview, preflight, or inspect output to verify apply-result.',
    ));
  }

  validateHash(output.payloadHash, 'payloadHash', findings);
  validateHash(output.confirmedHash, 'confirmedHash', findings);
  if (isSha256(output.payloadHash) && isSha256(output.confirmedHash) && output.payloadHash !== output.confirmedHash) {
    findings.push(finding(
      'MTR-TENANT-002',
      'error',
      'confirmedHash must match payloadHash.',
      'Production and sandbox apply evidence must be tied to the exact reviewed preview hash.',
    ));
  }

  if (!isObject(output.preflight) || !nonEmpty(output.preflight.filePath) || output.preflight.validationResult !== 'passed') {
    findings.push(finding(
      'MTR-PREFLIGHT-001',
      'error',
      'preflight.filePath and preflight.validationResult=passed are required.',
      'Validate and record the preflight file used to approve the apply run.',
    ));
  }

  if (!isObject(output.auditLog) || !nonEmpty(output.auditLog.path) || output.auditLog.validationResult !== 'passed' || !Number.isInteger(output.auditLog.rowCount) || output.auditLog.rowCount < 1) {
    findings.push(finding(
      'MTR-AUDIT-001',
      'error',
      'auditLog must include path, rowCount > 0, and validationResult=passed.',
      'Validate and record the JSONL audit log generated by the apply run.',
    ));
  }

  if (!isObject(output.keyFingerprint) || !nonEmpty(output.keyFingerprint.envVar) || !nonEmpty(output.keyFingerprint.fingerprint)) {
    findings.push(finding(
      'MTR-AUDIT-012',
      'error',
      'keyFingerprint.envVar and keyFingerprint.fingerprint are required.',
      'Record key fingerprint metadata, never raw API keys.',
    ));
  }

  if (contract) {
    validateWorkflowEvidence(output, contract, findings);
    validateWriteSummary(output.requestSummary, contract, findings);
    validateRequiredWriteEndpoints(output.requestSummary, contract, findings);
  }

  if (list(output.created).length + list(output.updated).length === 0) {
    findings.push(finding(
      'MTR-APPLY-010',
      'error',
      'Apply result must include at least one created or updated object.',
      'Record concrete object ids returned or affected by the apply run.',
    ));
  } else {
    if (list(output.created).length > 0) validateTargetIds(output.created, 'created', findings);
    if (list(output.updated).length > 0) validateTargetIds(output.updated, 'updated', findings);
  }

  if (!isObject(output.verification)) {
    findings.push(finding(
      'MTR-VERIFY-001',
      'error',
      'verification is required.',
      'Record read-back verification status and checks.',
    ));
  } else {
    if (!VALID_VERIFICATION_STATUS.has(output.verification.status)) {
      findings.push(finding(
        'MTR-VERIFY-001',
        'error',
        'verification.status must be passed.',
        'Apply evidence is reusable only after read-back verification passes.',
      ));
    }
    validateReadBackChecks(output.verification.checks, findings);
    if (contract) validateRequiredReadBackChecks(output.verification.checks, contract, findings);
  }

  validateWarnings(output.warnings, findings);

  if (!isObject(output.rollback) || !nonEmpty(output.rollback.plan) || !nonEmpty(output.rollback.owner)) {
    findings.push(finding(
      'MTR-VERIFY-002',
      'error',
      'rollback.plan and rollback.owner are required.',
      'Record remediation ownership before treating the apply result as complete.',
    ));
  }

  if (!isObject(output.idempotency) || !nonEmpty(output.idempotency.strategy) || !nonEmpty(output.idempotency.duplicatePrevention)) {
    findings.push(finding(
      'MTR-IDEMP-001',
      'error',
      'idempotency.strategy and idempotency.duplicatePrevention are required.',
      'Record how retries avoid duplicate customers, packages, contracts, invoices, or credits.',
    ));
  }

  findings.push(...collectSecretFindings(output));

  return {
    schemaVersion: VERIFY_APPLY_RESULT_SCHEMA_VERSION,
    inspectedSchemaVersion: output.schemaVersion || null,
    workflow: output.workflow || null,
    shape: output.shape || null,
    valid: !findings.some((item) => item.severity === 'error'),
    findings,
    summary: {
      tenant: output.tenant || null,
      writeCount: Array.isArray(output.requestSummary) ? output.requestSummary.length : 0,
      skippedWriteCount: Array.isArray(output.requestSummary)
        ? output.requestSummary.filter((item) => VALID_SKIPPED_RESULTS.has(item?.status)).length
        : 0,
      workflowEvidenceBundles: isObject(output.workflowEvidence)
        ? Object.keys(output.workflowEvidence).length
        : 0,
      createdCount: Array.isArray(output.created) ? output.created.length : 0,
      updatedCount: Array.isArray(output.updated) ? output.updated.length : 0,
      verificationCount: Array.isArray(output.verification?.checks) ? output.verification.checks.length : 0,
    },
  };
}

module.exports = {
  buildApplyResultTemplate,
  verifyApplyResult,
};
