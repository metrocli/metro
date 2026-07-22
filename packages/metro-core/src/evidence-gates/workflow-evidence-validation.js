'use strict';

function finding(id, severity, message, remediation) {
  return {
    id,
    severity,
    message,
    remediation,
  };
}

function isObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function isSha256(value) {
  return typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
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

function evidenceListContainsAll(actual, required, field, findings) {
  if (!Array.isArray(actual)) {
    findings.push(finding(
      'MTR-WORKFLOW-EVIDENCE-010',
      'error',
      `${field} must be an array.`,
      'List the required evidence identifiers satisfied by the workflow bundle.',
    ));
    return;
  }

  for (const item of required) {
    if (!actual.includes(item)) {
      findings.push(finding(
        'MTR-WORKFLOW-EVIDENCE-011',
        'error',
        `${field} is missing required evidence "${item}".`,
        'Use the workflowEvidenceBundles template and record every required evidence identifier before treating apply evidence as complete.',
      ));
    }
  }
}

function validateWorkflowApprovalRecordEvidence({
  approvalRecord,
  expected,
  output,
  findings = [],
}) {
  if (!isObject(approvalRecord)) {
    findings.push(finding(
      'MTR-WORKFLOW-EVIDENCE-002',
      'error',
      'workflowEvidence.approvalRecord is required.',
      'Record validated approval evidence before treating apply evidence as complete.',
    ));
    return findings;
  }

  if (approvalRecord.schemaVersion !== expected.schemaVersion) {
    findings.push(finding(
      'MTR-WORKFLOW-EVIDENCE-003',
      'error',
      `workflowEvidence.approvalRecord.schemaVersion must be ${expected.schemaVersion}.`,
      'Use the approval-record bundle schema emitted by the workflow apply-result template.',
    ));
  }
  if (approvalRecord.validationResult !== 'passed') {
    findings.push(finding(
      'MTR-WORKFLOW-EVIDENCE-004',
      'error',
      'workflowEvidence.approvalRecord.validationResult must be passed.',
      'Validate the approval record locally before treating it as workflow evidence.',
    ));
  }
  validateHash(approvalRecord.payloadHash, 'workflowEvidence.approvalRecord.payloadHash', findings);
  validateHash(approvalRecord.applyGateHash, 'workflowEvidence.approvalRecord.applyGateHash', findings);
  if (isSha256(approvalRecord.payloadHash) && isSha256(output.payloadHash) && approvalRecord.payloadHash !== output.payloadHash) {
    findings.push(finding(
      'MTR-TENANT-002',
      'error',
      'workflowEvidence.approvalRecord.payloadHash must match payloadHash.',
      'Approval evidence must bind to the exact reviewed preview hash.',
    ));
  }
  if (approvalRecord.liveApplyAuthorizedByThisRecord !== false || approvalRecord.durableApprovalIsCurrentTurnAuthorization !== false) {
    findings.push(finding(
      'MTR-WORKFLOW-EVIDENCE-005',
      'error',
      'workflowEvidence.approvalRecord must not claim live apply authorization or durable current-turn authorization.',
      'Approval records are durable evidence only; future live execution still requires current-turn authorization.',
    ));
  }
  evidenceListContainsAll(
    approvalRecord.providedEvidence,
    expected.requiredEvidence,
    'workflowEvidence.approvalRecord.providedEvidence',
    findings,
  );

  return findings;
}

function validateWorkflowApplyAuditEvidence({
  applyAudit,
  expected,
  output,
  findings = [],
}) {
  if (!isObject(applyAudit)) {
    findings.push(finding(
      'MTR-WORKFLOW-EVIDENCE-006',
      'error',
      'workflowEvidence.applyAudit is required.',
      'Record validated apply-audit bundle evidence before treating apply evidence as complete.',
    ));
    return findings;
  }

  if (applyAudit.schemaVersion !== expected.schemaVersion) {
    findings.push(finding(
      'MTR-WORKFLOW-EVIDENCE-003',
      'error',
      `workflowEvidence.applyAudit.schemaVersion must be ${expected.schemaVersion}.`,
      'Use the apply-audit bundle schema emitted by the workflow apply-result template.',
    ));
  }
  if (applyAudit.validationResult !== 'passed') {
    findings.push(finding(
      'MTR-WORKFLOW-EVIDENCE-004',
      'error',
      'workflowEvidence.applyAudit.validationResult must be passed.',
      'Validate the workflow apply-audit bundle locally before treating it as evidence.',
    ));
  }
  validateHash(applyAudit.previewHash, 'workflowEvidence.applyAudit.previewHash', findings);
  if (isSha256(applyAudit.previewHash) && isSha256(output.payloadHash) && applyAudit.previewHash !== output.payloadHash) {
    findings.push(finding(
      'MTR-TENANT-002',
      'error',
      'workflowEvidence.applyAudit.previewHash must match payloadHash.',
      'Apply-audit evidence must bind to the exact reviewed preview hash.',
    ));
  }
  if (applyAudit.auditLogPath !== output.auditLog?.path) {
    findings.push(finding(
      'MTR-AUDIT-001',
      'error',
      'workflowEvidence.applyAudit.auditLogPath must match auditLog.path.',
      'Bind workflow apply-audit evidence to the exact validated audit log path.',
    ));
  }
  if (applyAudit.rowCount !== output.auditLog?.rowCount) {
    findings.push(finding(
      'MTR-AUDIT-001',
      'error',
      'workflowEvidence.applyAudit.rowCount must match auditLog.rowCount.',
      'Bind workflow apply-audit evidence to the exact validated audit log row count.',
    ));
  }
  if (applyAudit.liveApplyAuthorizedByThisRecord !== false) {
    findings.push(finding(
      'MTR-WORKFLOW-EVIDENCE-005',
      'error',
      'workflowEvidence.applyAudit.liveApplyAuthorizedByThisRecord must be false.',
      'Audit evidence records writes; it does not authorize future live execution.',
    ));
  }
  evidenceListContainsAll(
    applyAudit.providedEvidence,
    expected.requiredEvidence,
    'workflowEvidence.applyAudit.providedEvidence',
    findings,
  );

  return findings;
}

function validateWorkflowApplyReadbackEvidence({
  applyReadback,
  expected,
  output,
  findings = [],
}) {
  if (!isObject(applyReadback)) {
    findings.push(finding(
      'MTR-WORKFLOW-EVIDENCE-007',
      'error',
      'workflowEvidence.applyReadback is required.',
      'Record validated apply-readback evidence before treating apply evidence as complete.',
    ));
    return findings;
  }

  if (applyReadback.schemaVersion !== expected.schemaVersion) {
    findings.push(finding(
      'MTR-WORKFLOW-EVIDENCE-003',
      'error',
      `workflowEvidence.applyReadback.schemaVersion must be ${expected.schemaVersion}.`,
      'Use the apply-readback bundle schema emitted by the workflow apply-result template.',
    ));
  }
  if (applyReadback.validationResult !== 'passed') {
    findings.push(finding(
      'MTR-WORKFLOW-EVIDENCE-004',
      'error',
      'workflowEvidence.applyReadback.validationResult must be passed.',
      'Validate workflow read-back comparison evidence before treating apply evidence as complete.',
    ));
  }
  if (applyReadback.readEnabledInCurrentCli !== false) {
    findings.push(finding(
      'MTR-WORKFLOW-EVIDENCE-008',
      'error',
      'workflowEvidence.applyReadback.readEnabledInCurrentCli must be false.',
      'This verifier accepts local read-back evidence only; it must not imply live read execution.',
    ));
  }
  if (applyReadback.checkCount !== list(output.verification?.checks).length) {
    findings.push(finding(
      'MTR-VERIFY-001',
      'error',
      'workflowEvidence.applyReadback.checkCount must match verification.checks length.',
      'Bind read-back bundle evidence to the exact set of passed verification checks.',
    ));
  }
  if (applyReadback.semanticApplySuccessProvenByPrerequisites !== false) {
    findings.push(finding(
      'MTR-WORKFLOW-EVIDENCE-009',
      'error',
      'workflowEvidence.applyReadback.semanticApplySuccessProvenByPrerequisites must be false.',
      'Preflight and audit prerequisites do not prove semantic apply success; passed read-back checks must carry that evidence.',
    ));
  }
  evidenceListContainsAll(
    applyReadback.providedEvidence,
    expected.requiredEvidence,
    'workflowEvidence.applyReadback.providedEvidence',
    findings,
  );

  return findings;
}

function validateWorkflowGuardedApplyResultEvidence({
  guardedApplyResult,
  expected,
  outputSchemaVersion,
  findings = [],
}) {
  if (!isObject(guardedApplyResult)) {
    findings.push(finding(
      'MTR-WORKFLOW-EVIDENCE-012',
      'error',
      'workflowEvidence.guardedApplyResult is required.',
      'Record guarded apply-result evidence before treating apply evidence as complete.',
    ));
    return findings;
  }

  if (guardedApplyResult.schemaVersion !== outputSchemaVersion) {
    findings.push(finding(
      'MTR-WORKFLOW-EVIDENCE-003',
      'error',
      `workflowEvidence.guardedApplyResult.schemaVersion must be ${outputSchemaVersion}.`,
      'Use the guarded apply-result schema emitted by the workflow apply-result template.',
    ));
  }
  if (guardedApplyResult.validationResult !== 'passed') {
    findings.push(finding(
      'MTR-WORKFLOW-EVIDENCE-004',
      'error',
      'workflowEvidence.guardedApplyResult.validationResult must be passed.',
      'Run metro verify apply-result and record the passed validation result.',
    ));
  }
  if (guardedApplyResult.currentTurnAuthorizationCapturedAtExecution !== true) {
    findings.push(finding(
      'MTR-WORKFLOW-EVIDENCE-013',
      'error',
      'workflowEvidence.guardedApplyResult.currentTurnAuthorizationCapturedAtExecution must be true.',
      'Future guarded runners must capture current-turn authorization at execution time before an apply result can be treated as complete.',
    ));
  }
  if (guardedApplyResult.liveApplyAuthorizedByThisRecord !== false) {
    findings.push(finding(
      'MTR-WORKFLOW-EVIDENCE-005',
      'error',
      'workflowEvidence.guardedApplyResult.liveApplyAuthorizedByThisRecord must be false.',
      'The apply-result record verifies evidence; it must not be reusable live authorization.',
    ));
  }
  evidenceListContainsAll(
    guardedApplyResult.providedEvidence,
    expected.requiredEvidence,
    'workflowEvidence.guardedApplyResult.providedEvidence',
    findings,
  );

  return findings;
}

function validateWorkflowEvidenceBundles({
  evidence,
  expected,
  output,
  applyResultSchemaVersion,
  findings = [],
}) {
  if (!isObject(evidence)) {
    findings.push(finding(
      'MTR-WORKFLOW-EVIDENCE-001',
      'error',
      'workflowEvidence is required for workflow apply-result evidence.',
      'Embed approvalRecord, applyAudit, applyReadback, and guardedApplyResult bundle summaries from the workflow apply-result template.',
    ));
    return findings;
  }

  validateWorkflowApprovalRecordEvidence({
    approvalRecord: evidence.approvalRecord,
    expected: expected.approvalRecord,
    output,
    findings,
  });
  validateWorkflowApplyAuditEvidence({
    applyAudit: evidence.applyAudit,
    expected: expected.applyAudit,
    output,
    findings,
  });
  validateWorkflowApplyReadbackEvidence({
    applyReadback: evidence.applyReadback,
    expected: expected.applyReadback,
    output,
    findings,
  });
  validateWorkflowGuardedApplyResultEvidence({
    guardedApplyResult: evidence.guardedApplyResult,
    expected: expected.guardedApplyResult,
    outputSchemaVersion: applyResultSchemaVersion,
    findings,
  });

  return findings;
}

module.exports = {
  validateWorkflowApprovalRecordEvidence,
  validateWorkflowApplyAuditEvidence,
  validateWorkflowApplyReadbackEvidence,
  validateWorkflowEvidenceBundles,
  validateWorkflowGuardedApplyResultEvidence,
};
