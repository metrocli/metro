'use strict';

const fs = require('fs');
const path = require('path');
const { isAuditTemplateSupported, isPackagePlanMoveShape } = require('../evidence-gates/support');
const { sha256 } = require('../preview');

const VALID_TENANTS = new Set(['sandbox', 'production']);
const VALID_OUTCOMES = new Set(['planned', 'success', 'failure', 'skipped']);
const VALID_VERIFICATION_STATUS = new Set(['not_started', 'passed', 'failed', 'blocked']);
const VALID_ACTOR_SOURCES = new Set(['user', 'agent', 'ci']);
const AUDIT_WRITE_SCHEMA_VERSION = 'metro.audit.write.v1';
const SECRET_KEY_PATTERN = /(secret|token|api[_-]?key|authorization|bearer|password|private[_-]?key)/i;
const SECRET_VALUE_PATTERN = /(sk_live_|sk_test_|pk_live_|prod_[A-Za-z0-9]{12,}|Bearer\s+[A-Za-z0-9._-]+)/;
const LOCAL_ONLY_LIVE_EXECUTION = {
  enabledInCurrentCli: false,
  reason: 'Workflow audit write is local JSONL evidence handling only; the current CLI does not run workflow apply commands.',
  nextSafeStep: 'Review the local audit rows, then keep workflow apply blocked until guarded runners, current-turn authorization, live audit writing, read-back verification, rollback evidence, and idempotency evidence exist.',
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function finding(id, severity, message, remediation, context) {
  return {
    id,
    severity,
    message,
    remediation,
    ...(context ? { context } : {}),
  };
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function isSha256(value) {
  return typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
}

function isIsoTimestamp(value) {
  if (typeof value !== 'string' || value.trim() === '') return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

function collectSecretFindings(value, path = '$') {
  const findings = [];
  if (typeof value === 'string') {
    if (SECRET_VALUE_PATTERN.test(value)) {
      findings.push(finding(
        'MTR-SECRET-002',
        'error',
        `Audit log appears to contain a secret-like value at ${path}.`,
        'Remove secret values; audit rows may include fingerprints or hashes only.',
      ));
    }
    return findings;
  }

  if (!value || typeof value !== 'object') return findings;

  for (const [key, nested] of Object.entries(value)) {
    const nestedPath = `${path}.${key}`;
    if (SECRET_KEY_PATTERN.test(key) && key !== 'keyFingerprint') {
      findings.push(finding(
        'MTR-SECRET-001',
        'error',
        `Audit log contains forbidden secret-shaped field ${nestedPath}.`,
        'Store hashes or fingerprints only; never store raw keys, tokens, passwords, or Authorization headers.',
      ));
    }
    findings.push(...collectSecretFindings(nested, nestedPath));
  }

  return findings;
}

function validateStringField(row, field, findings) {
  if (typeof row[field] !== 'string' || row[field].trim() === '') {
    findings.push(finding(
      'MTR-AUDIT-001',
      'error',
      `Audit row missing required string field: ${field}.`,
      `Include ${field} in every audit row.`,
    ));
  }
}

function validateArrayField(row, field, findings) {
  if (!Array.isArray(row[field])) {
    findings.push(finding(
      'MTR-AUDIT-002',
      'error',
      `Audit row field ${field} must be an array.`,
      `Use an array for ${field}, even when it has a single item or is empty.`,
    ));
  }
}

function validateEndpoint(endpoint, findings) {
  if (!endpoint || typeof endpoint !== 'object') {
    findings.push(finding(
      'MTR-AUDIT-003',
      'error',
      'Audit row endpoint must be an object.',
      'Record endpoint.method and endpoint.path for every operation row.',
    ));
    return;
  }
  if (!['GET', 'POST', 'PATCH', 'PUT', 'DELETE'].includes(endpoint.method)) {
    findings.push(finding(
      'MTR-AUDIT-004',
      'error',
      'Audit row endpoint.method is missing or unsupported.',
      'Record the exact uppercase HTTP method used by the workflow.',
    ));
  }
  if (typeof endpoint.path !== 'string' || !endpoint.path.startsWith('/')) {
    findings.push(finding(
      'MTR-AUDIT-005',
      'error',
      'Audit row endpoint.path must be an absolute API path.',
      'Record the exact endpoint path without base URL or secrets.',
    ));
  }
}

function validateVerification(verification, findings) {
  if (!verification || typeof verification !== 'object') {
    findings.push(finding(
      'MTR-AUDIT-006',
      'error',
      'Audit row verification must be an object.',
      'Record verification.status and verification.checks for every audit row.',
    ));
    return;
  }
  if (!VALID_VERIFICATION_STATUS.has(verification.status)) {
    findings.push(finding(
      'MTR-AUDIT-007',
      'error',
      'Audit row verification.status is invalid.',
      `Use one of: ${[...VALID_VERIFICATION_STATUS].join(', ')}.`,
    ));
  }
  if (!Array.isArray(verification.checks)) {
    findings.push(finding(
      'MTR-AUDIT-008',
      'error',
      'Audit row verification.checks must be an array.',
      'Record verification checks as structured array items.',
    ));
  }
}

function validateActor(actor, findings) {
  if (!actor || typeof actor !== 'object' || Array.isArray(actor)) {
    findings.push(finding(
      'MTR-AUDIT-016',
      'error',
      'Audit row actor must be an object.',
      'Record actor.source and actor.id as non-secret operator, agent, or CI metadata.',
    ));
    return;
  }
  if (!VALID_ACTOR_SOURCES.has(actor.source)) {
    findings.push(finding(
      'MTR-AUDIT-017',
      'error',
      'Audit row actor.source is invalid.',
      `Use one of: ${[...VALID_ACTOR_SOURCES].join(', ')}.`,
    ));
  }
  validateStringField(actor, 'id', findings);
}

function validateAuditRow(row, index = 0) {
  const findings = [];

  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    return [finding(
      'MTR-AUDIT-000',
      'error',
      'Audit row must be a JSON object.',
      'Write one JSON object per JSONL row.',
      { row: index + 1 },
    )];
  }

  for (const field of ['schemaVersion', 'timestamp', 'cliVersion', 'workflow', 'shape', 'tenant', 'mode', 'previewHash', 'requestBodyHash', 'outcome']) {
    validateStringField(row, field, findings);
  }

  if (row.schemaVersion !== 'metro.audit.v1') {
    findings.push(finding(
      'MTR-AUDIT-009',
      'error',
      'Audit row schemaVersion must be metro.audit.v1.',
      'Use the current audit schema before a row can be treated as evidence.',
    ));
  }
  if (!isIsoTimestamp(row.timestamp)) {
    findings.push(finding(
      'MTR-AUDIT-010',
      'error',
      'Audit row timestamp must be an ISO UTC timestamp.',
      'Use new Date().toISOString() format.',
    ));
  }
  if (!VALID_TENANTS.has(row.tenant)) {
    findings.push(finding(
      'MTR-TENANT-001',
      'error',
      'Audit row tenant must be sandbox or production.',
      'Audit evidence must identify the exact Metronome tenant.',
    ));
  }
  if (!isSha256(row.previewHash)) {
    findings.push(finding(
      'MTR-HASH-001',
      'error',
      'Audit row previewHash must be sha256:<64 lowercase hex>.',
      'Bind write evidence to the exact preview hash used for approval.',
    ));
  }
  if (!isSha256(row.requestBodyHash)) {
    findings.push(finding(
      'MTR-HASH-002',
      'error',
      'Audit row requestBodyHash must be sha256:<64 lowercase hex>.',
      'Store a hash of the request body instead of raw secret-bearing payloads.',
    ));
  }
  if (!VALID_OUTCOMES.has(row.outcome)) {
    findings.push(finding(
      'MTR-AUDIT-011',
      'error',
      'Audit row outcome is invalid.',
      `Use one of: ${[...VALID_OUTCOMES].join(', ')}.`,
    ));
  }

  validateArrayField(row, 'targetIds', findings);
  validateArrayField(row, 'responseObjectIds', findings);
  validateActor(row.actor, findings);
  validateEndpoint(row.endpoint, findings);
  validateVerification(row.verification, findings);

  if (!row.keyFingerprint || typeof row.keyFingerprint !== 'object') {
    findings.push(finding(
      'MTR-AUDIT-012',
      'error',
      'Audit row keyFingerprint must be an object.',
      'Record key fingerprint metadata, never the raw key.',
    ));
  } else {
    validateStringField(row.keyFingerprint, 'envVar', findings);
    validateStringField(row.keyFingerprint, 'fingerprint', findings);
  }

  if (row.outcome === 'failure') {
    if (!row.error || typeof row.error !== 'object') {
      findings.push(finding(
        'MTR-AUDIT-013',
        'error',
        'Failure audit rows must include an error object.',
        'Record error.code, error.message, and error.remediation for failed operations.',
      ));
    } else {
      for (const field of ['code', 'message', 'remediation']) {
        validateStringField(row.error, field, findings);
      }
    }
  }

  const secretFindings = collectSecretFindings(row).map((item) => ({
    ...item,
    context: { row: index + 1 },
  }));
  findings.push(...secretFindings);

  return findings.map((item) => ({
    ...item,
    context: item.context || { row: index + 1 },
  }));
}

function parseAuditJsonl(text) {
  const rows = [];
  const findings = [];
  const lines = String(text || '').split(/\r?\n/);
  lines.forEach((line, index) => {
    if (line.trim() === '') return;
    try {
      rows.push({ index, row: JSON.parse(line) });
    } catch (error) {
      findings.push(finding(
        'MTR-AUDIT-014',
        'error',
        `Audit JSONL line ${index + 1} is not valid JSON: ${error.message}`,
        'Write exactly one JSON object per line.',
        { row: index + 1 },
      ));
    }
  });
  return { rows, findings };
}

function validateAuditJsonl(text) {
  const parsed = parseAuditJsonl(text);
  const findings = [...parsed.findings];
  for (const item of parsed.rows) {
    findings.push(...validateAuditRow(item.row, item.index));
  }
  if (parsed.rows.length === 0 && findings.length === 0) {
    findings.push(finding(
      'MTR-AUDIT-015',
      'error',
      'Audit JSONL file has no rows.',
      'Write at least one audit row before validating evidence.',
    ));
  }

  return {
    schemaVersion: 'metro.audit.validation.v1',
    valid: !findings.some((item) => item.severity === 'error'),
    rowCount: parsed.rows.length,
    findings,
  };
}

function filled(value) {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

function auditWriteBase({ mode, auditPath, outPath, findings = [] }) {
  return {
    schemaVersion: AUDIT_WRITE_SCHEMA_VERSION,
    generatedFrom: 'packages/metro-core/src/audit/index.js',
    apiAccess: 'none',
    liveExecution: clone(LOCAL_ONLY_LIVE_EXECUTION),
    applyEnabledInCurrentCli: false,
    liveApplyAuthorizedByThisRecord: false,
    mode,
    source: {
      path: auditPath || null,
      rowCount: 0,
      rowHashes: [],
      validationResult: null,
    },
    target: {
      path: outPath || null,
      appendOnly: true,
      overwrite: false,
      requiresExplicitWriteFlag: true,
    },
    rowBytes: 0,
    inputValidation: null,
    fileValidation: null,
    write: {
      wrote: false,
      rowsWritten: 0,
      bytesWritten: 0,
    },
    blocked: findings.some((item) => item.severity === 'error'),
    findings,
    nextSafeStep: 'Fix the audit write inputs and re-run with --dry-run before writing local workflow audit evidence.',
  };
}

function buildAuditWritePlan(options = {}) {
  const {
    auditText = '',
    auditPath = null,
    outPath = null,
    mode = null,
  } = options;
  const findings = [];

  if (mode !== 'dry-run' && mode !== 'write') {
    findings.push(finding(
      'MTR-AUDIT-WRITE-001',
      'error',
      'mode must be dry-run or write.',
      'Choose exactly one of --dry-run or --write.',
    ));
  }
  if (!filled(outPath)) {
    findings.push(finding(
      'MTR-AUDIT-WRITE-002',
      'error',
      'outPath is required.',
      'Pass --out <audit.jsonl> so local workflow audit evidence has an explicit destination.',
    ));
  }

  const inputValidation = validateAuditJsonl(auditText);
  const parsed = parseAuditJsonl(auditText);
  const base = auditWriteBase({ mode, auditPath, outPath, findings });
  const rows = parsed.rows.map((item) => item.row);
  const rowText = rows.length > 0 ? `${rows.map((row) => JSON.stringify(row)).join('\n')}\n` : '';
  const validationFindings = inputValidation.valid ? [] : inputValidation.findings;
  const allFindings = [...findings, ...validationFindings];

  return {
    ...base,
    source: {
      path: auditPath || null,
      rowCount: rows.length,
      rowHashes: rows.map((row) => sha256(row)),
      validationResult: inputValidation.valid ? 'passed' : 'failed',
    },
    rows,
    rowBytes: Buffer.byteLength(rowText, 'utf8'),
    inputValidation,
    blocked: allFindings.some((item) => item.severity === 'error'),
    findings: allFindings,
    nextSafeStep: allFindings.some((item) => item.severity === 'error')
      ? 'Fix the workflow audit JSONL input before appending local evidence.'
      : 'Review this local workflow audit write plan, then re-run with --write to append JSONL evidence. Live workflow apply remains disabled.',
  };
}

function writeAuditJsonl(plan, options = {}) {
  const fsImpl = options.fs || fs;
  const rootDir = options.rootDir || process.cwd();
  if (!plan || plan.schemaVersion !== AUDIT_WRITE_SCHEMA_VERSION) {
    throw new Error('writeAuditJsonl requires a metro.audit.write.v1 plan.');
  }
  if (plan.mode !== 'write' || plan.blocked) return clone(plan);

  const targetPath = path.resolve(rootDir, plan.target.path);
  const rowText = plan.rows.length > 0 ? `${plan.rows.map((row) => JSON.stringify(row)).join('\n')}\n` : '';
  const existedBefore = fsImpl.existsSync(targetPath);
  const existingText = existedBefore ? fsImpl.readFileSync(targetPath, 'utf8') : '';
  if (existedBefore && existingText.trim() !== '') {
    const existingValidation = validateAuditJsonl(existingText);
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
        nextSafeStep: 'Fix the existing workflow audit JSONL before appending new evidence.',
      };
    }
  }

  fsImpl.mkdirSync(path.dirname(targetPath), { recursive: true });
  fsImpl.appendFileSync(targetPath, rowText, 'utf8');
  const afterText = fsImpl.readFileSync(targetPath, 'utf8');
  const fileValidation = validateAuditJsonl(afterText);

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
      rowsWritten: plan.rows.length,
      bytesWritten: Buffer.byteLength(rowText, 'utf8'),
    },
    nextSafeStep: fileValidation.valid
      ? 'Keep this workflow audit JSONL as local evidence. Live workflow apply remains disabled until a guarded runner is explicitly authorized.'
      : 'Fix the workflow audit JSONL and re-run metro audit validate before using it as audit evidence.',
  };
}

function templateRow({
  workflow,
  shape,
  tenant,
  endpoint,
  targetIds,
  responseObjectIds,
  verificationChecks,
}) {
  return {
    schemaVersion: 'metro.audit.v1',
    timestamp: '<ISO timestamp>',
    cliVersion: '0.0.0',
    actor: {
      source: '<user|agent|ci>',
      id: '<operator id>',
    },
    workflow,
    shape,
    tenant,
    mode: 'apply',
    keyFingerprint: {
      envVar: '<METRONOME_SANDBOX_KEY|METRONOME_PROD_KEY>',
      fingerprint: '<non-secret key fingerprint>',
    },
    previewHash: 'sha256:<64 lowercase hex preview hash>',
    targetIds,
    endpoint,
    requestBodyHash: 'sha256:<64 lowercase hex request body hash>',
    responseObjectIds,
    verification: {
      status: 'not_started',
      checks: verificationChecks,
    },
    outcome: 'planned',
  };
}

function buildAuditTemplate(options = {}) {
  const {
    workflow = 'package.apply',
    shape = 'pro-annual',
    tenant = '<sandbox|production>',
  } = options;

  if (!isAuditTemplateSupported(workflow, shape)) return null;

  if (workflow === 'customer.setup' && shape === 'customer-setup') {
    const row = templateRow({
      workflow,
      shape,
      tenant,
      targetIds: [
        { system: 'external', role: 'account_id', id: '<external account id>' },
        { system: 'metronome', role: 'primary_ingest_alias', id: '<primary ingest alias>' },
        { system: 'metronome', role: 'ingest_alias_set_hash', id: '<sha256 of reviewed ingest aliases>' },
      ],
      endpoint: {
        method: 'GET',
        path: '/v1/customers?ingest_alias={alias}&only_archived=false',
      },
      responseObjectIds: [
        { system: 'metronome', role: 'alias_collision_status', id: '<none_or_reviewed_existing_customer_id>' },
      ],
      verificationChecks: [
        {
          id: 'customer_setup.alias_collision_review',
          status: 'pending',
          expectation: 'Every reviewed ingest alias was searched before create, including archived-customer collision review.',
        },
        {
          id: 'customer_setup.existing_customer_policy',
          status: 'pending',
          expectation: 'Existing customer policy is fail_if_exists or reuse_if_exact_match, and any reuse was proven by exact reviewed identity fields.',
        },
      ],
    });
    const additionalRows = [
      templateRow({
        workflow,
        shape,
        tenant,
        targetIds: [
          { system: 'external', role: 'account_id', id: '<external account id>' },
          { system: 'metronome', role: 'primary_ingest_alias', id: '<primary ingest alias>' },
          { system: 'metronome', role: 'ingest_alias_set_hash', id: '<sha256 of reviewed ingest aliases>' },
          { system: 'stripe', role: 'customer_id', id: '<stripe customer id or verified none>' },
        ],
        endpoint: {
          method: 'POST',
          path: '/v1/customers',
        },
        responseObjectIds: [
          { system: 'metronome', role: 'customer_id', id: '<created customer id or skipped_reused_customer>' },
        ],
        verificationChecks: [
          {
            id: 'customer_setup.customer_identity',
            status: 'pending',
            expectation: 'Customer read-back matches reviewed name, external account id custom field when present, ingest aliases, custom fields, and archived state.',
          },
          {
            id: 'customer_setup.billing_provider_inline',
            status: 'pending',
            expectation: 'When Stripe setup is planned, billing-provider read-back matches the reviewed Stripe customer id, collection method, and delivery method; otherwise non-applicability is documented.',
          },
        ],
      }),
      templateRow({
        workflow,
        shape,
        tenant,
        targetIds: [
          { system: 'metronome', role: 'customer_id', id: '<created or reused customer id>' },
          { system: 'salesforce', role: 'account_id', id: '<salesforce account id or not_applicable>' },
        ],
        endpoint: {
          method: 'POST',
          path: '/v1/customers/{customer_id}/updateConfig',
        },
        responseObjectIds: [
          { system: 'metronome', role: 'customer_config_update_status', id: '<updated or skipped_not_applicable>' },
        ],
        verificationChecks: [
          {
            id: 'customer_setup.customer_config',
            status: 'pending',
            expectation: 'Customer read-back shows salesforce_account_id and leave_stripe_invoices_in_draft match the reviewed preview when present.',
          },
          {
            id: 'customer_setup.no_invoice_side_effect',
            status: 'pending',
            expectation: 'Customer setup created no contract, package, commit, credit, subscription, invoice, hierarchy contract, or Stripe artifact.',
          },
        ],
      }),
    ];

    return {
      schemaVersion: 'metro.audit.template.v1',
      workflow,
      shape,
      tenant,
      row,
      additionalRows,
      notes: [
        'Write one JSON object per line for customer setup evidence: alias collision review, customer create or reviewed reuse, and optional updateConfig.',
        'Rows for optional create or updateConfig steps may use outcome skipped only when reviewed preview and read-back evidence prove the step is not applicable.',
        'Never store raw API keys, bearer tokens, Authorization headers, request bodies with secrets, Stripe secret values, or full customer payloads.',
        'Store request-body hashes, reviewed object identifiers, alias set hashes, and non-secret key fingerprints instead of secret values.',
        'Record customer, alias, billing-provider, and no-invoice-side-effect verification in structured checks before treating customer setup as complete.',
      ],
    };
  }

  if (workflow === 'contract.move-plan.apply' && isPackagePlanMoveShape(shape)) {
    const row = templateRow({
      workflow,
      shape,
      tenant,
      targetIds: [
        { system: 'metronome', role: 'customer_id', id: '<metronome customer id>' },
        { system: 'metronome', role: 'current_contract_id', id: '<predecessor contract id>' },
      ],
      endpoint: {
        method: 'POST',
        path: '/v1/contracts/updateEndDate',
      },
      responseObjectIds: [
        { system: 'metronome', role: 'updated_contract_id', id: '<predecessor contract id>' },
      ],
      verificationChecks: [
        {
          id: 'predecessor.ending_before',
          status: 'pending',
          expectation: 'Predecessor ending_before equals the reviewed cutover.',
        },
      ],
    });
    const additionalRows = [
      templateRow({
        workflow,
        shape,
        tenant,
        targetIds: [
          { system: 'metronome', role: 'customer_id', id: '<metronome customer id>' },
          { system: 'metronome', role: 'current_contract_id', id: '<predecessor contract id>' },
          { system: 'metronome', role: 'target_package_alias', id: '<target package alias>' },
        ],
        endpoint: {
          method: 'POST',
          path: '/v1/contracts/create',
        },
        responseObjectIds: [
          { system: 'metronome', role: 'successor_contract_id', id: '<created successor contract id>' },
        ],
        verificationChecks: [
          {
            id: 'successor.transition',
            status: 'pending',
            expectation: 'Successor starts at cutover, uses target package alias, and transitions from predecessor.',
          },
          {
            id: 'invoice.no_immediate_charge',
            status: 'pending',
            expectation: 'No immediate invoice or Stripe artifact was created before the reviewed cutover.',
          },
        ],
      }),
    ];

    return {
      schemaVersion: 'metro.audit.template.v1',
      workflow,
      shape,
      tenant,
      row,
      additionalRows,
      notes: [
        'Write one JSON object per line; this workflow expects one row for updateEndDate and one row for successor contract create.',
        'Never store raw API keys, bearer tokens, Authorization headers, or request bodies with secrets.',
        'Store hashes and non-secret key fingerprints instead of secret values.',
      ],
    };
  }

  if (workflow === 'credit.apply' && shape === 'complimentary-credit-grant') {
    const row = templateRow({
      workflow,
      shape,
      tenant,
      targetIds: [
        { system: 'metronome', role: 'customer_id', id: '<metronome customer id>' },
        { system: 'metronome', role: 'contract_id', id: '<metronome contract id>' },
        { system: 'metronome', role: 'product_id', id: '<metronome product id or verified none>' },
        { system: 'metronome', role: 'commit_name', id: '<reviewed complimentary commit name>' },
      ],
      endpoint: {
        method: 'POST',
        path: '/v2/contracts/edit',
      },
      responseObjectIds: [
        { system: 'metronome', role: 'commit_id_or_name', id: '<complimentary commit id or reviewed name>' },
        { system: 'metronome', role: 'invoice_artifact_status', id: '<none or reviewed zero-dollar audit line>' },
      ],
      verificationChecks: [
        {
          id: 'complimentary_commit.commit_once',
          status: 'pending',
          expectation: 'Complimentary commit appears exactly once by reviewed name on the reviewed contract with expected amount and access credit type.',
        },
        {
          id: 'complimentary_commit.invoice_schedule_policy',
          status: 'pending',
          expectation: 'Pure access grant omits invoice_schedule; audit-line variant uses USD cents, unit_price 0, quantity 1, and explicit audit-line intent.',
        },
        {
          id: 'complimentary_commit.invoice_inventory',
          status: 'pending',
          expectation: 'Invoice inventory shows no invoice artifact for pure access grant or exactly the reviewed zero-dollar audit line for audit-line variant.',
        },
        {
          id: 'complimentary_commit.no_stripe_side_effect',
          status: 'pending',
          expectation: 'No paid invoice, payment gate, Stripe charge, contract transition, package change, or billing-provider change was created by the grant.',
        },
      ],
    });

    return {
      schemaVersion: 'metro.audit.template.v1',
      workflow,
      shape,
      tenant,
      row,
      notes: [
        'Write one JSON object per line for the contract edit that adds the complimentary PREPAID commit.',
        'Never store raw API keys, bearer tokens, Authorization headers, request bodies with secrets, Stripe secret values, or full customer payloads.',
        'Store hashes, reviewed commit names, and non-secret key fingerprints instead of secret values.',
        'Record balance, invoice-inventory, and no-Stripe-side-effect verification in structured checks; do not treat a pure access grant as a paid top-up.',
      ],
    };
  }

  if (workflow === 'credit.apply' && shape === 'paid-credit-top-up') {
    const row = templateRow({
      workflow,
      shape,
      tenant,
      targetIds: [
        { system: 'metronome', role: 'customer_id', id: '<metronome customer id>' },
        { system: 'metronome', role: 'contract_id', id: '<metronome contract id>' },
        { system: 'metronome', role: 'product_id', id: '<metronome product id>' },
      ],
      endpoint: {
        method: 'POST',
        path: '/v2/contracts/edit',
      },
      responseObjectIds: [
        { system: 'metronome', role: 'commit_id_or_name', id: '<paid top-up commit id or reviewed name>' },
        { system: 'metronome', role: 'invoice_id_or_status', id: '<paid top-up invoice id or reviewed invoice status>' },
      ],
      verificationChecks: [
        {
          id: 'paid_topup.commit_once',
          status: 'pending',
          expectation: 'Paid top-up commit appears exactly once by reviewed name with expected amount and payment gate state.',
        },
        {
          id: 'paid_topup.invoice_behavior',
          status: 'pending',
          expectation: 'Invoice inventory and external_invoice state match the reviewed paid top-up Stripe behavior.',
        },
        {
          id: 'paid_topup.billing_provider',
          status: 'pending',
          expectation: 'Billing-provider read-back still supports the reviewed Stripe delivery behavior.',
        },
      ],
    });

    return {
      schemaVersion: 'metro.audit.template.v1',
      workflow,
      shape,
      tenant,
      row,
      notes: [
        'Write one JSON object per line for the contract edit that adds the paid top-up commit.',
        'Never store raw API keys, bearer tokens, Authorization headers, request bodies with secrets, or Stripe secret values.',
        'Store hashes and non-secret key fingerprints instead of secret values.',
        'Record invoice and Stripe reconciliation status in verification checks, not as raw payment-provider payloads.',
      ],
    };
  }

  if (workflow === 'subscription.contract.apply' && shape === 'direct-subscription-contract') {
    const row = templateRow({
      workflow,
      shape,
      tenant,
      targetIds: [
        { system: 'metronome', role: 'customer_id', id: '<metronome customer id>' },
        { system: 'metronome', role: 'rate_card_id', id: '<metronome rate card id>' },
        { system: 'metronome', role: 'subscription_product_id', id: '<subscription product id>' },
        { system: 'metronome', role: 'contract_uniqueness_key', id: '<contract uniqueness key>' },
      ],
      endpoint: {
        method: 'POST',
        path: '/v1/contracts/create',
      },
      responseObjectIds: [
        { system: 'metronome', role: 'contract_id', id: '<created contract id>' },
        { system: 'metronome', role: 'subscription_id_or_name', id: '<created subscription id or reviewed name>' },
      ],
      verificationChecks: [
        {
          id: 'subscription.contract_readback',
          status: 'pending',
          expectation: 'Contract read-back shows the reviewed subscription product id, billing frequency, quantity mode, and starting timestamp.',
        },
        {
          id: 'subscription.rate_schedule',
          status: 'pending',
          expectation: 'Rate-card schedule still contains the reviewed subscription product and billing frequency.',
        },
        {
          id: 'subscription.quantity_or_seat_history',
          status: 'pending',
          expectation: 'Quantity history and, when SEAT_BASED, seat history match the reviewed initial quantity or named seats.',
        },
        {
          id: 'subscription.invoice_stripe_behavior',
          status: 'pending',
          expectation: 'Invoice inventory and billing-provider read-back match the reviewed subscription invoice and Stripe behavior.',
        },
      ],
    });

    return {
      schemaVersion: 'metro.audit.template.v1',
      workflow,
      shape,
      tenant,
      row,
      notes: [
        'Write one JSON object per line for the contract create that adds the direct subscription contract.',
        'Never store raw API keys, bearer tokens, Authorization headers, request bodies with secrets, or Stripe secret values.',
        'Store hashes and non-secret key fingerprints instead of secret values.',
        'Record subscription id, invoice, Stripe, quantity, and seat verification status in structured verification checks.',
      ],
    };
  }

  if (workflow === 'custom-contract.create' && shape === 'enterprise-custom-contract') {
    const row = templateRow({
      workflow,
      shape,
      tenant,
      targetIds: [
        { system: 'external', role: 'account_id', id: '<external account id>' },
        { system: 'metronome', role: 'customer_id_or_alias', id: '<existing or planned metronome customer id>' },
        { system: 'metronome', role: 'customer_create_policy', id: '<create or verified_existing>' },
      ],
      endpoint: {
        method: 'POST',
        path: '/v1/customers',
      },
      responseObjectIds: [
        { system: 'metronome', role: 'customer_id', id: '<created customer id or skipped_existing_customer>' },
      ],
      verificationChecks: [
        {
          id: 'custom_contract.customer_identity',
          status: 'pending',
          expectation: 'Customer read-back matches the reviewed external account id, company name, ingest alias, and custom fields, or the row is skipped because the reviewed customer already exists.',
        },
        {
          id: 'custom_contract.customer_duplicate_prevention',
          status: 'pending',
          expectation: 'Customer create happened at most once; retries reused the same reviewed customer identity after read-back.',
        },
      ],
    });
    const additionalRows = [
      templateRow({
        workflow,
        shape,
        tenant,
        targetIds: [
          { system: 'metronome', role: 'customer_id', id: '<metronome customer id>' },
          { system: 'stripe', role: 'customer_id', id: '<stripe customer id>' },
          { system: 'metronome', role: 'stripe_delivery_method_id', id: '<billing provider delivery method id>' },
        ],
        endpoint: {
          method: 'POST',
          path: '/v1/setCustomerBillingProviderConfigurations',
        },
        responseObjectIds: [
          { system: 'metronome', role: 'billing_provider_configuration_id', id: '<created or reused billing provider configuration id>' },
        ],
        verificationChecks: [
          {
            id: 'custom_contract.billing_provider_config',
            status: 'pending',
            expectation: 'Billing-provider read-back shows the reviewed Stripe customer, delivery method, collection method, and leave_stripe_invoices_in_draft behavior before contract creation.',
          },
          {
            id: 'custom_contract.billing_provider_no_duplicate',
            status: 'pending',
            expectation: 'Existing active Stripe configs were compared before set; the workflow did not leave duplicate active delivery configs.',
          },
        ],
      }),
      templateRow({
        workflow,
        shape,
        tenant,
        targetIds: [
          { system: 'metronome', role: 'customer_id', id: '<metronome customer id>' },
          { system: 'metronome', role: 'rate_card_id', id: '<metronome rate card id>' },
          { system: 'metronome', role: 'contract_uniqueness_key', id: '<custom contract uniqueness key>' },
          { system: 'metronome', role: 'base_commit_name', id: '<reviewed base commit name>' },
        ],
        endpoint: {
          method: 'POST',
          path: '/v1/contracts/create',
        },
        responseObjectIds: [
          { system: 'metronome', role: 'contract_id', id: '<created custom contract id>' },
          { system: 'metronome', role: 'subscription_id_or_none', id: '<created seat subscription id or not_applicable>' },
        ],
        verificationChecks: [
          {
            id: 'custom_contract.contract_readback',
            status: 'pending',
            expectation: 'Contract read-back shows the reviewed rate card, uniqueness key, start/end timestamps, recurring commit, invoice amount, and optional seat subscription.',
          },
          {
            id: 'custom_contract.invoice_stripe_behavior',
            status: 'pending',
            expectation: 'Invoice inventory and external_invoice state match the reviewed custom-contract invoice timing and Stripe draft/finalization behavior.',
          },
        ],
      }),
      templateRow({
        workflow,
        shape,
        tenant,
        targetIds: [
          { system: 'metronome', role: 'customer_id', id: '<metronome customer id>' },
          { system: 'metronome', role: 'contract_id', id: '<created custom contract id>' },
          { system: 'metronome', role: 'bonus_commit_name_set_hash', id: '<sha256 of reviewed bonus commit names or not_applicable>' },
        ],
        endpoint: {
          method: 'POST',
          path: '/v2/contracts/edit',
        },
        responseObjectIds: [
          { system: 'metronome', role: 'bonus_commit_ids_or_status', id: '<bonus commit ids or skipped_no_bonus_commits>' },
        ],
        verificationChecks: [
          {
            id: 'custom_contract.bonus_commits_once',
            status: 'pending',
            expectation: 'When bonus commits are reviewed, customer balances show each bonus commit exactly once with expected product, access credit type, amount, and name; otherwise the row is skipped.',
          },
          {
            id: 'custom_contract.bonus_commit_duplicate_prevention',
            status: 'pending',
            expectation: 'Duplicate commit-name checks passed before add_commits and no matching bonus commit was replayed on retry.',
          },
        ],
      }),
      templateRow({
        workflow,
        shape,
        tenant,
        targetIds: [
          { system: 'metronome', role: 'customer_id', id: '<metronome customer id>' },
          { system: 'metronome', role: 'contract_id', id: '<created custom contract id>' },
          { system: 'metronome', role: 'subscription_id', id: '<created seat subscription id or not_applicable>' },
          { system: 'metronome', role: 'seat_id_set_hash', id: '<sha256 of reviewed initial seat ids or not_applicable>' },
        ],
        endpoint: {
          method: 'POST',
          path: '/v2/contracts/edit',
        },
        responseObjectIds: [
          { system: 'metronome', role: 'seat_assignment_status', id: '<seat assignment status or skipped_no_initial_seats>' },
        ],
        verificationChecks: [
          {
            id: 'custom_contract.seat_quantity_history',
            status: 'pending',
            expectation: 'For seat-based contracts, subscription quantity history reflects the reviewed initial seats; otherwise non-applicability is documented.',
          },
          {
            id: 'custom_contract.seat_history',
            status: 'pending',
            expectation: 'For seat-based contracts, seat history shows each reviewed initial seat id assigned once to the created subscription.',
          },
        ],
      }),
    ];

    return {
      schemaVersion: 'metro.audit.template.v1',
      workflow,
      shape,
      tenant,
      row,
      additionalRows,
      notes: [
        'Write one JSON object per line for each custom-contract write step: optional customer create, Stripe billing-provider setup, direct contract create, optional bonus commit edit, and optional seat edit.',
        'Rows for optional steps may use outcome skipped only when reviewed preview evidence proves the step is not applicable.',
        'Never store raw API keys, bearer tokens, Authorization headers, request bodies with secrets, Stripe secret values, full customer payloads, or full payment-provider payloads.',
        'Store request-body hashes, reviewed object identifiers, set hashes, and non-secret key fingerprints instead of secret values.',
        'Record customer, billing-provider, contract, balance, invoice, quantity-history, and seat-history verification in structured checks before treating the operation as complete.',
      ],
    };
  }

  if (workflow === 'billing-provider.attach' && shape === 'stripe-billing-provider-attachment') {
    const row = templateRow({
      workflow,
      shape,
      tenant,
      targetIds: [
        { system: 'metronome', role: 'customer_id', id: '<metronome customer id>' },
        { system: 'stripe', role: 'customer_id', id: '<stripe customer id>' },
        { system: 'metronome', role: 'delivery_method_id_or_direct', id: '<delivery method id or direct_to_billing_provider>' },
      ],
      endpoint: {
        method: 'POST',
        path: '/v1/setCustomerBillingProviderConfigurations',
      },
      responseObjectIds: [
        { system: 'metronome', role: 'billing_provider_configuration_id', id: '<created or reused billing provider configuration id>' },
      ],
      verificationChecks: [
        {
          id: 'billing_provider.active_config',
          status: 'pending',
          expectation: 'Billing-provider read-back shows one reviewed active Stripe configuration for the customer.',
        },
        {
          id: 'billing_provider.delivery_method',
          status: 'pending',
          expectation: 'Delivery method id or direct_to_billing_provider routing matches the reviewed Stripe account evidence.',
        },
      ],
    });
    const additionalRows = [
      templateRow({
        workflow,
        shape,
        tenant,
        targetIds: [
          { system: 'metronome', role: 'customer_id', id: '<metronome customer id>' },
        ],
        endpoint: {
          method: 'POST',
          path: '/v1/customers/{customer_id}/updateConfig',
        },
        responseObjectIds: [
          { system: 'metronome', role: 'customer_config_update_status', id: '<updated customer config status>' },
        ],
        verificationChecks: [
          {
            id: 'billing_provider.draft_behavior',
            status: 'pending',
            expectation: 'Customer read-back shows leave_stripe_invoices_in_draft matches the reviewed preview.',
          },
          {
            id: 'billing_provider.no_invoice_side_effect',
            status: 'pending',
            expectation: 'No invoice was created, finalized, voided, archived, or pushed to Stripe by the attachment workflow.',
          },
        ],
      }),
    ];

    return {
      schemaVersion: 'metro.audit.template.v1',
      workflow,
      shape,
      tenant,
      row,
      additionalRows,
      notes: [
        'Write one JSON object per line; this workflow expects one row for setCustomerBillingProviderConfigurations and one row for customer updateConfig.',
        'Never store raw API keys, bearer tokens, Authorization headers, request bodies with secrets, Stripe secret values, or full payment-provider payloads.',
        'Store hashes and non-secret key fingerprints instead of secret values.',
        'Record billing-provider config id, delivery method routing, customer draft behavior, and no-invoice-side-effect verification in structured checks.',
      ],
    };
  }

  if (workflow === 'invoice.issue-date-update' && shape === 'invoice-issue-date-update') {
    const row = templateRow({
      workflow,
      shape,
      tenant,
      targetIds: [
        { system: 'metronome', role: 'customer_id', id: '<metronome customer id>' },
        { system: 'metronome', role: 'contract_id', id: '<metronome contract id>' },
        { system: 'metronome', role: 'invoice_id', id: '<draft invoice id>' },
        { system: 'metronome', role: 'target_issue_date', id: '<target issue date iso>' },
      ],
      endpoint: {
        method: 'POST',
        path: '/v1/contracts/updateInvoiceIssueDate',
      },
      responseObjectIds: [
        { system: 'metronome', role: 'invoice_id', id: '<updated draft invoice id>' },
        { system: 'metronome', role: 'invoice_status', id: '<post-update invoice status>' },
      ],
      verificationChecks: [
        {
          id: 'invoice_issue_date.draft_readback',
          status: 'pending',
          expectation: 'Invoice read-back shows status remains DRAFT and issue_date equals the reviewed targetIssueDate.',
        },
        {
          id: 'invoice_issue_date.draft_inventory',
          status: 'pending',
          expectation: 'Customer draft invoice inventory shows no unexpected finalized or duplicate invoice side effect.',
        },
        {
          id: 'invoice_issue_date.contract_boundary',
          status: 'pending',
          expectation: 'Contract read-back proves the target issue date is before ending_before, or that the contract has no end date.',
        },
        {
          id: 'invoice_issue_date.stripe_behavior',
          status: 'pending',
          expectation: 'Billing-provider read-back supports the reviewed Stripe behavior and remediation plan.',
        },
      ],
    });

    return {
      schemaVersion: 'metro.audit.template.v1',
      workflow,
      shape,
      tenant,
      row,
      notes: [
        'Write one JSON object per line for the contract-scoped updateInvoiceIssueDate operation.',
        'Never store raw API keys, bearer tokens, Authorization headers, request bodies with secrets, or Stripe secret values.',
        'Store hashes and non-secret key fingerprints instead of secret values.',
        'Record DRAFT invoice state, issue_date read-back, contract boundary, draft inventory, and Stripe behavior verification in structured checks.',
      ],
    };
  }

  if (workflow === 'product.rate-retirement' && shape === 'product-rate-retirement') {
    const row = templateRow({
      workflow,
      shape,
      tenant,
      targetIds: [
        { system: 'metronome', role: 'product_id', id: '<metronome product id>' },
        { system: 'metronome', role: 'rate_card_id', id: '<affected rate card id>' },
        { system: 'metronome', role: 'starting_at', id: '<retirement starting_at iso>' },
      ],
      endpoint: {
        method: 'POST',
        path: '/v1/contract-pricing/rate-cards/addRates',
      },
      responseObjectIds: [
        { system: 'metronome', role: 'rate_card_id', id: '<updated rate card id>' },
        { system: 'metronome', role: 'product_id', id: '<retired product id>' },
      ],
      verificationChecks: [
        {
          id: 'product_retirement.rate_schedule_closed',
          status: 'pending',
          expectation: 'Rate schedule read-back shows entitled:false, price:0 for the product on the affected rate card at the reviewed cutover.',
        },
        {
          id: 'product_retirement.no_later_entitled_rate',
          status: 'pending',
          expectation: 'Rate schedule read-back shows no later unintended entitled:true entry for the retired product.',
        },
        {
          id: 'product_retirement.invoice_impact',
          status: 'pending',
          expectation: 'Invoice preview or read-back confirms no unexpected billable or ghost line remains after the cutover.',
        },
      ],
    });
    const additionalRows = [
      templateRow({
        workflow,
        shape,
        tenant,
        targetIds: [
          { system: 'metronome', role: 'product_id', id: '<metronome product id>' },
        ],
        endpoint: {
          method: 'POST',
          path: '/v1/contract-pricing/products/archive',
        },
        responseObjectIds: [
          { system: 'metronome', role: 'product_id', id: '<archived product id>' },
          { system: 'metronome', role: 'product_archive_status', id: '<archived or skipped>' },
        ],
        verificationChecks: [
          {
            id: 'product_retirement.product_archive_state',
            status: 'pending',
            expectation: 'Product read-back matches the reviewed archive decision after all rate-close rows are verified.',
          },
          {
            id: 'product_retirement.archive_after_rate_close',
            status: 'pending',
            expectation: 'Archive row is written only after the affected rate-card close evidence has passed.',
          },
        ],
      }),
    ];

    return {
      schemaVersion: 'metro.audit.template.v1',
      workflow,
      shape,
      tenant,
      row,
      additionalRows,
      notes: [
        'Write one JSON object per addRates call, plus a products/archive row only when the reviewed preview requested archiveProductAfterRatesClose.',
        'Never store raw API keys, bearer tokens, Authorization headers, request bodies with secrets, or customer secrets.',
        'Store hashes and non-secret key fingerprints instead of secret values.',
        'Record rate-schedule close evidence before any optional product archive row; archive alone does not retire existing rate-card entries.',
      ],
    };
  }

  if (workflow === 'rate-card.dimensional.apply' && shape === 'dimensional-rate-card') {
    const row = templateRow({
      workflow,
      shape,
      tenant,
      targetIds: [
        { system: 'metronome', role: 'usage_product_name', id: '<reviewed usage product name>' },
        { system: 'metronome', role: 'billable_metric_id', id: '<reviewed billable metric id>' },
        { system: 'metronome', role: 'pricing_group_key', id: 'action_code' },
        { system: 'metronome', role: 'presentation_group_key', id: 'action_display_name' },
      ],
      endpoint: {
        method: 'POST',
        path: '/v1/contract-pricing/products/create',
      },
      responseObjectIds: [
        { system: 'metronome', role: 'product_id', id: '<created or reused dimensional usage product id>' },
      ],
      verificationChecks: [
        {
          id: 'dimensional.product_shape',
          status: 'pending',
          expectation: 'Product read-back shows one USAGE product with reviewed billable_metric_id, pricing_group_key, presentation_group_key, and tags.',
        },
        {
          id: 'dimensional.metric_group_key',
          status: 'pending',
          expectation: 'Billable metric evidence proves one compound group key containing action_code and action_display_name.',
        },
        {
          id: 'dimensional.product_duplicate_prevention',
          status: 'pending',
          expectation: 'Existing product collision review proves the workflow did not create a duplicate dimensional usage product.',
        },
      ],
    });
    const additionalRows = [
      templateRow({
        workflow,
        shape,
        tenant,
        targetIds: [
          { system: 'metronome', role: 'rate_card_id', id: '<reviewed rate card id>' },
          { system: 'metronome', role: 'product_id', id: '<created or reused dimensional usage product id>' },
          { system: 'metronome', role: 'starting_at', id: '<dimensional rates starting_at iso>' },
          { system: 'metronome', role: 'action_code_set_hash', id: '<sha256 of reviewed action codes>' },
        ],
        endpoint: {
          method: 'POST',
          path: '/v1/contract-pricing/rate-cards/addRates',
        },
        responseObjectIds: [
          { system: 'metronome', role: 'rate_card_id', id: '<updated rate card id>' },
          { system: 'metronome', role: 'canary_action_code', id: '<first canary action code>' },
        ],
        verificationChecks: [
          {
            id: 'dimensional.rate_schedule_rows',
            status: 'pending',
            expectation: 'Rate schedule read-back shows each reviewed action_code row at the reviewed starting_at with expected price, credit type, and entitlement.',
          },
          {
            id: 'dimensional.get_rates_selector',
            status: 'pending',
            expectation: 'getRates selector read-back returns exactly the intended dimensional row for each reviewed action_code.',
          },
          {
            id: 'dimensional.usage_groups',
            status: 'pending',
            expectation: 'Usage groups prove canary events include action_code and action_display_name under the compound metric group key.',
          },
          {
            id: 'dimensional.invoice_impact',
            status: 'pending',
            expectation: 'Invoice preview or read-back shows no surprise invoice, duplicate billable line, or Stripe delivery side effect before remaining rates are applied.',
          },
        ],
      }),
    ];

    return {
      schemaVersion: 'metro.audit.template.v1',
      workflow,
      shape,
      tenant,
      row,
      additionalRows,
      notes: [
        'Write one JSON object per line; this workflow expects one row for product create/reuse evidence and one row for rate-cards/addRates.',
        'Never store raw API keys, bearer tokens, Authorization headers, request bodies with secrets, customer event payloads, or Stripe secret values.',
        'Store hashes, action_code set hashes, and non-secret key fingerprints instead of secret values.',
        'Record product duplicate-prevention, compound metric group-key, canary action, rate schedule, getRates selector, usage groups, and invoice-impact verification in structured checks.',
      ],
    };
  }

  if (workflow === 'package.archive' && shape === 'package-alias-archive-handoff') {
    const row = templateRow({
      workflow,
      shape,
      tenant,
      targetIds: [
        { system: 'metronome', role: 'old_package_id', id: '<old package id>' },
        { system: 'metronome', role: 'package_alias', id: '<package alias>' },
        { system: 'metronome', role: 'replacement_package_id', id: '<replacement package id>' },
        { system: 'metronome', role: 'replacement_alias_live_at', id: '<replacement alias live timestamp>' },
      ],
      endpoint: {
        method: 'POST',
        path: '/v1/packages/archive',
      },
      responseObjectIds: [
        { system: 'metronome', role: 'old_package_id', id: '<archived old package id>' },
        { system: 'metronome', role: 'package_archive_status', id: '<post-archive status>' },
      ],
      verificationChecks: [
        {
          id: 'package_archive.old_package_archived',
          status: 'pending',
          expectation: 'Old package read-back shows the reviewed old package id is archived after apply.',
        },
        {
          id: 'package_archive.replacement_alias_live',
          status: 'pending',
          expectation: 'Package list/get evidence proves the replacement package owns the alias and replacementAliasLiveAt is not in the future.',
        },
        {
          id: 'package_archive.contracts_on_old_package',
          status: 'pending',
          expectation: 'Contracts attached to the old package were inventoried before archive and remain understood after archive.',
        },
        {
          id: 'package_archive.no_contract_or_invoice_mutation',
          status: 'pending',
          expectation: 'Archive did not create, edit, archive, or void contracts, invoices, billing-provider configs, credits, or commits.',
        },
      ],
    });

    return {
      schemaVersion: 'metro.audit.template.v1',
      workflow,
      shape,
      tenant,
      row,
      notes: [
        'Write one JSON object per package archive operation.',
        'Never store raw API keys, bearer tokens, Authorization headers, request bodies with secrets, or customer secrets.',
        'Store hashes and non-secret key fingerprints instead of secret values.',
        'Record alias-live evidence before archive and contracts-on-package inventory before and after archive.',
      ],
    };
  }

  if (workflow === 'usage.ingest-preview' && shape === 'usage-ingest-preview') {
    const row = templateRow({
      workflow,
      shape,
      tenant,
      targetIds: [
        { system: 'metronome', role: 'customer_id', id: '<metronome customer id>' },
        { system: 'metronome', role: 'invoice_period', id: '<starting at to ending before>' },
        { system: 'metronome', role: 'event_count', id: '<reviewed event count>' },
        { system: 'metronome', role: 'transaction_id_set_hash', id: '<sha256 of reviewed transaction ids>' },
      ],
      endpoint: {
        method: 'POST',
        path: '/v1/customers/{customer_id}/previewEvents',
      },
      responseObjectIds: [
        { system: 'metronome', role: 'preview_events_result', id: '<preview events evidence id or status>' },
      ],
      verificationChecks: [
        {
          id: 'usage.preview_events_passed',
          status: 'pending',
          expectation: 'PreviewEvents output matches the reviewed invoice period, line items, credit burn-down, and Stripe side-effect review before ingest.',
        },
        {
          id: 'usage.finalized_period_reviewed',
          status: 'pending',
          expectation: 'Finalized-period and historical usage invoice impact review passed before any canary ingest.',
        },
      ],
    });
    const additionalRows = [
      templateRow({
        workflow,
        shape,
        tenant,
        targetIds: [
          { system: 'metronome', role: 'customer_id', id: '<metronome customer id>' },
          { system: 'metronome', role: 'canary_event_count', id: '<canary event count>' },
          { system: 'metronome', role: 'canary_transaction_id_set_hash', id: '<sha256 of canary transaction ids>' },
        ],
        endpoint: {
          method: 'POST',
          path: '/v1/ingest',
        },
        responseObjectIds: [
          { system: 'metronome', role: 'ingest_canary_status', id: '<canary ingest accepted/rejected status>' },
        ],
        verificationChecks: [
          {
            id: 'usage.canary_event_search',
            status: 'pending',
            expectation: 'Event search finds every canary transaction_id exactly once for the intended customer and billable metric.',
          },
          {
            id: 'usage.canary_usage_groups',
            status: 'pending',
            expectation: 'Usage groups reflect the canary action codes for the reviewed invoice period before any bulk ingest.',
          },
          {
            id: 'usage.canary_invoice_inventory',
            status: 'pending',
            expectation: 'Invoice inventory shows no unexpected finalized invoice, duplicate bill, or Stripe delivery side effect after canary ingest.',
          },
        ],
      }),
      templateRow({
        workflow,
        shape,
        tenant,
        targetIds: [
          { system: 'metronome', role: 'customer_id', id: '<metronome customer id>' },
          { system: 'metronome', role: 'remaining_event_count', id: '<remaining event count or zero>' },
          { system: 'metronome', role: 'remaining_transaction_id_set_hash', id: '<sha256 of remaining transaction ids or not_applicable>' },
        ],
        endpoint: {
          method: 'POST',
          path: '/v1/ingest',
        },
        responseObjectIds: [
          { system: 'metronome', role: 'ingest_remaining_status', id: '<remaining ingest accepted/rejected/skipped status>' },
        ],
        verificationChecks: [
          {
            id: 'usage.bulk_stop_criteria_clear',
            status: 'pending',
            expectation: 'Bulk continuation happened only after canary read-back passed and stop criteria remained clear.',
          },
          {
            id: 'usage.bulk_event_search',
            status: 'pending',
            expectation: 'Event search finds every submitted remaining transaction_id exactly once, or this row is marked skipped when no remaining batch exists.',
          },
          {
            id: 'usage.bulk_invoice_impact',
            status: 'pending',
            expectation: 'Usage groups and invoice inventory match the reviewed full-batch preview after remaining events, with no unexpected billing or Stripe side effect.',
          },
        ],
      }),
    ];

    return {
      schemaVersion: 'metro.audit.template.v1',
      workflow,
      shape,
      tenant,
      row,
      additionalRows,
      notes: [
        'Write one JSON object per line: previewEvents evidence, canary /v1/ingest, and remaining-batch /v1/ingest when a remaining batch exists.',
        'Never store raw API keys, bearer tokens, Authorization headers, request bodies with secrets, or full customer event payloads in audit rows.',
        'Store request-body hashes, transaction_id set hashes, and non-secret key fingerprints instead of raw sensitive values.',
        'Record previewEvents, event search, usage groups, invoice inventory, and stop-criteria verification in structured checks.',
      ],
    };
  }

  if (workflow !== 'package.apply' || shape !== 'pro-annual') {
    return null;
  }

  const row = templateRow({
    workflow,
    shape,
    tenant,
    targetIds: [
      {
        system: 'metronome',
        role: 'package_alias',
        id: '<package alias>',
      },
    ],
    endpoint: {
      method: 'POST',
      path: '/v1/packages/create',
    },
    responseObjectIds: [
      {
        system: 'metronome',
        role: 'package_id',
        id: '<created package id>',
      },
    ],
    verificationChecks: [
      {
        id: 'package.get',
        status: 'pending',
        expectation: 'Package exists and matches preview hash inputs.',
      },
    ],
  });

  return {
    schemaVersion: 'metro.audit.template.v1',
    workflow,
    shape,
    tenant,
    row,
    notes: [
      'Write one JSON object per line.',
      'Never store raw API keys, bearer tokens, Authorization headers, or request bodies with secrets.',
      'Store hashes and non-secret key fingerprints instead of secret values.',
    ],
  };
}

module.exports = {
  buildAuditTemplate,
  buildAuditWritePlan,
  validateAuditJsonl,
  validateAuditRow,
  writeAuditJsonl,
};
