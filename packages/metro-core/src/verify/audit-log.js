'use strict';

const { validateAuditJsonl } = require('../audit');
const { sha256 } = require('../preview');

const VERIFY_AUDIT_LOG_SCHEMA_VERSION = 'metro.verify.audit-log.v1';
const LOCAL_ONLY_LIVE_EXECUTION = {
  enabledInCurrentCli: false,
  reason: 'Audit-log verification is local JSONL evidence review only; the current CLI does not run live apply or live read-back commands.',
  nextSafeStep: 'Use this result to decide whether the audit log is usable evidence, then pair it with apply-result and read-back verification before any future live workflow is considered complete.',
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function finding(id, severity, message, remediation) {
  return {
    id,
    severity,
    message,
    remediation,
  };
}

function parseAuditRows(text) {
  const rows = [];
  String(text || '').split(/\r?\n/).forEach((line, index) => {
    if (line.trim() === '') return;
    try {
      rows.push({ lineNumber: index + 1, row: JSON.parse(line) });
    } catch (_error) {
      // validateAuditJsonl owns JSON parse findings; keep this parser summary-only.
    }
  });
  return rows;
}

function increment(counts, value) {
  const key = value || 'missing';
  counts[key] = (counts[key] || 0) + 1;
}

function sortedUnique(values) {
  return [...new Set(values.filter((value) => typeof value === 'string' && value.trim() !== ''))].sort();
}

function auditEvidenceStatus(summary, valid) {
  if (!valid) return 'invalid';
  if (summary.rowCount === 0) return 'invalid';
  if (summary.failedRows > 0 || summary.failedVerificationRows > 0 || summary.blockedVerificationRows > 0) {
    return 'needs-remediation';
  }
  if (summary.passedVerificationRows === summary.rowCount && summary.successfulRows + summary.skippedRows === summary.rowCount) {
    return 'read-back-passed';
  }
  if (summary.plannedRows === summary.rowCount || summary.notStartedVerificationRows === summary.rowCount) {
    return 'planned-only';
  }
  return 'mixed-local-evidence';
}

function summarizeRows(parsedRows, valid) {
  const outcomeCounts = {};
  const verificationStatusCounts = {};
  const endpointCounts = {};

  const rows = parsedRows.map((item) => item.row);
  for (const row of rows) {
    increment(outcomeCounts, row?.outcome);
    increment(verificationStatusCounts, row?.verification?.status);
    const endpoint = row?.endpoint;
    if (endpoint?.method && endpoint?.path) {
      increment(endpointCounts, `${endpoint.method} ${endpoint.path}`);
    }
  }

  const summary = {
    rowCount: rows.length,
    tenantCount: sortedUnique(rows.map((row) => row?.tenant)).length,
    workflowCount: sortedUnique(rows.map((row) => row?.workflow)).length,
    shapeCount: sortedUnique(rows.map((row) => row?.shape)).length,
    tenants: sortedUnique(rows.map((row) => row?.tenant)),
    workflows: sortedUnique(rows.map((row) => row?.workflow)),
    shapes: sortedUnique(rows.map((row) => row?.shape)),
    outcomes: outcomeCounts,
    verificationStatuses: verificationStatusCounts,
    endpoints: endpointCounts,
    successfulRows: outcomeCounts.success || 0,
    plannedRows: outcomeCounts.planned || 0,
    failedRows: outcomeCounts.failure || 0,
    skippedRows: outcomeCounts.skipped || 0,
    passedVerificationRows: verificationStatusCounts.passed || 0,
    notStartedVerificationRows: verificationStatusCounts.not_started || 0,
    failedVerificationRows: verificationStatusCounts.failed || 0,
    blockedVerificationRows: verificationStatusCounts.blocked || 0,
  };

  return {
    ...summary,
    readBackEvidenceComplete: summary.rowCount > 0
      && summary.passedVerificationRows === summary.rowCount
      && summary.successfulRows + summary.skippedRows === summary.rowCount
      && summary.failedRows === 0
      && summary.failedVerificationRows === 0
      && summary.blockedVerificationRows === 0,
    evidenceStatus: auditEvidenceStatus(summary, valid),
  };
}

function evidenceFindings(summary, valid) {
  if (!valid) return [];
  if (summary.evidenceStatus === 'planned-only') {
    return [finding(
      'MTR-AUDIT-VERIFY-001',
      'warning',
      'Audit log is schema-valid but contains planned-only evidence.',
      'Use this as pre-apply audit planning evidence only; a future guarded runner must append success or failure rows before it can prove execution.',
    )];
  }
  if (summary.evidenceStatus === 'needs-remediation') {
    return [finding(
      'MTR-AUDIT-VERIFY-002',
      'warning',
      'Audit log records failed or blocked workflow verification evidence.',
      'Review the failure rows, remediation fields, and read-back checks before using the audit log as completion evidence.',
    )];
  }
  if (summary.evidenceStatus === 'mixed-local-evidence') {
    return [finding(
      'MTR-AUDIT-VERIFY-003',
      'warning',
      'Audit log is valid but mixes execution and verification states.',
      'Complete read-back verification or split planned rows from completed execution evidence before claiming workflow completion.',
    )];
  }
  return [];
}

function nextSafeStepFor(summary, valid) {
  if (!valid) {
    return 'Fix the audit JSONL validation findings before using this file as workflow evidence.';
  }
  if (summary.evidenceStatus === 'read-back-passed') {
    return 'Keep this audit log with the matching apply-result and read-back evidence. This verifier still does not prove that any current-turn live operation is authorized.';
  }
  if (summary.evidenceStatus === 'planned-only') {
    return 'Treat this as local audit planning evidence only; complete guarded execution, append outcome rows, and run apply-result/read-back verification before claiming success.';
  }
  if (summary.evidenceStatus === 'needs-remediation') {
    return 'Use the failed or blocked rows to drive remediation, then append new verified audit evidence rather than editing historical rows.';
  }
  return 'Review the mixed evidence states and pair the audit log with apply-result/read-back verification before using it as completion evidence.';
}

function verifyAuditLog(text, options = {}) {
  const sourcePath = options.sourcePath || null;
  const auditValidation = validateAuditJsonl(text);
  const parsedRows = parseAuditRows(text);
  const summary = summarizeRows(parsedRows, auditValidation.valid);
  const findings = [
    ...auditValidation.findings,
    ...evidenceFindings(summary, auditValidation.valid),
  ];

  return {
    schemaVersion: VERIFY_AUDIT_LOG_SCHEMA_VERSION,
    inspectedSchemaVersion: 'metro.audit.v1',
    generatedFrom: 'metronome-cli/src/verify/audit-log.js',
    apiAccess: 'none',
    liveExecution: clone(LOCAL_ONLY_LIVE_EXECUTION),
    valid: !findings.some((item) => item.severity === 'error'),
    source: {
      path: sourcePath,
      rowCount: parsedRows.length,
      rowHashes: parsedRows.map((item) => sha256(item.row)),
    },
    auditValidation,
    findings,
    summary,
    nextSafeStep: nextSafeStepFor(summary, auditValidation.valid),
    sources: [
      'docs/metronome-cli/one-goal.md',
      'docs/metronome-cli/CLI_ARCHITECTURE.md',
      'docs/metronome-cli/VALIDATION_AND_GUARDRAILS.md',
      'docs/SAFETY.md',
      'metronome-cli/src/audit/index.js',
      'metronome-cli/src/verify/audit-log.js',
    ],
  };
}

module.exports = {
  VERIFY_AUDIT_LOG_SCHEMA_VERSION,
  verifyAuditLog,
};
