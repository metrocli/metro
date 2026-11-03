'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { validateApplyGate } = require('../apply-gate');
const {
  buildWorkflowEvidenceBundles,
  getWorkflowApplyResultContract,
  workflowApplyResultKey,
} = require('../evidence-gates/apply-result-contracts');
const {
  FULL_TEMPLATE_PATH_SHAPE_IDS,
  isApplyGateSupported,
  workflowForShapeId,
} = require('../evidence-gates/support');

const WORKFLOW_APPROVAL_RECORD_SCHEMA_VERSION = 'metro.workflow.approval-record.v1';
const WORKFLOW_APPROVAL_RECORD_VALIDATION_SCHEMA_VERSION = 'metro.workflow.approval-record.validation.v1';

const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const SECRET_KEY_PATTERN = /(?:api[_-]?key|secret|token|authorization|password|private[_-]?key|bearer)/i;
const SECRET_KEY_ALLOWLIST = new Set([
  'authorization',
  'keyFingerprint',
  'currentTurnAuthorizationRequired',
  'currentTurnAuthorizationCaptured',
  'liveApplyAuthorizedByThisRecord',
  'durableApprovalIsCurrentTurnAuthorization',
]);
const SECRET_VALUE_PATTERN = /(?:bearer\s+[A-Za-z0-9._-]+|sk_live_[A-Za-z0-9]+|sk_test_[A-Za-z0-9]+|rk_live_[A-Za-z0-9]+|prod_[A-Za-z0-9]{12,})/i;

const LOCAL_ONLY_LIVE_EXECUTION = {
  enabledInCurrentCli: false,
  reason: 'Workflow approval records are local evidence only; the current CLI does not load Metronome API clients or run workflow apply commands.',
  nextSafeStep: 'Validate the approval record locally, then keep workflow apply blocked until guarded runners, explicit current-turn authorization, live audit writing, read-back verification, and rollback evidence exist.',
};

function clone(value) {
  if (Array.isArray(value)) return value.map((item) => clone(item));
  if (!isObject(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, clone(child)]));
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function unique(values) {
  return [...new Set(list(values).filter((value) => value !== undefined && value !== null && String(value).trim() !== ''))];
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonEmpty(value) {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

function filled(value) {
  return nonEmpty(value) && !/^<[^>]+>$/.test(String(value).trim());
}

function isSha256(value) {
  return typeof value === 'string' && SHA256_PATTERN.test(value);
}

function isIsoTimestamp(value) {
  if (typeof value !== 'string' || !value.trim() || /^<[^>]+>$/.test(value.trim())) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

function finding(id, severity, message, pathName, remediation) {
  return { id, severity, message, path: pathName, remediation };
}

function add(findings, id, message, pathName, remediation, severity = 'error') {
  findings.push(finding(id, severity, message, pathName, remediation));
}

function requireFilled(findings, value, pathName, message, remediation, id = 'MTR-APPROVAL-001') {
  if (!filled(value)) {
    add(findings, id, message, pathName, remediation);
  }
}

function validateHash(findings, value, pathName, remediation) {
  if (!isSha256(value)) {
    add(
      findings,
      'MTR-HASH-001',
      `${pathName} must be sha256:<64 lowercase hex>.`,
      pathName,
      remediation || 'Use the exact hash emitted by the CLI or computed from the reviewed local evidence file.',
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
  if (!resolved) return 'sha256:<64 lowercase hex apply-gate file hash>';
  try {
    return hashFile(resolved);
  } catch {
    return 'sha256:<64 lowercase hex apply-gate file hash>';
  }
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function tenantFlag(tenant) {
  if (tenant === 'production') return '--prod';
  if (tenant === 'sandbox') return '--sandbox';
  return '(--sandbox|--prod)';
}

function approvalRecordBundle(workflow, shape, tenant) {
  const contract = getWorkflowApplyResultContract(workflow, shape);
  if (!contract) return null;
  const key = workflowApplyResultKey(workflow, shape);
  return buildWorkflowEvidenceBundles(key, workflow, shape, tenant, contract).approvalRecord;
}

function workflowApprovalRecordCoverage() {
  return FULL_TEMPLATE_PATH_SHAPE_IDS.reduce((coverage, shape) => {
    const workflow = workflowForShapeId(shape);
    const contract = getWorkflowApplyResultContract(workflow, shape);
    coverage[shape] = {
      schemaVersion: WORKFLOW_APPROVAL_RECORD_SCHEMA_VERSION,
      workflow,
      shape,
      supportStatus: contract ? 'local-approval-record' : 'missing-apply-result-contract',
      command: contract
        ? 'metro approval-record template --apply-gate <apply-gate.json> [--approval-id <id>] [--requested-by <id>] [--approved-by <name>] [--owner <owner>] [--business-purpose <text>] [--expires-at <ISO>] [--json]'
        : null,
      validationCommand: 'metro approval-record validate --file <workflow-approval-record.json> [--json]',
      apiAccess: 'none',
      applyEnabledInCurrentCli: false,
      liveApplyAuthorizedByThisRecord: false,
      durableApprovalIsCurrentTurnAuthorization: false,
      requiresApplyGate: contract ? `metro apply-gate validate --file <apply-gate-for-${shape}.json> [--json]` : null,
      requiredEvidence: contract ? clone(approvalRecordBundle(workflow, shape, 'production').requiredEvidence) : [],
    };
    return coverage;
  }, {});
}

function scanForSecrets(value, findings, pathName = '$') {
  if (typeof value === 'string') {
    if (SECRET_VALUE_PATTERN.test(value)) {
      add(
        findings,
        'MTR-SECRET-002',
        `Workflow approval record appears to contain a secret-like value at ${pathName}.`,
        pathName,
        'Store environment variable names, hashes, approval IDs, and non-secret key fingerprints only.',
      );
    }
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((child, index) => scanForSecrets(child, findings, `${pathName}[${index}]`));
    return;
  }

  if (!isObject(value)) return;

  for (const [key, child] of Object.entries(value)) {
    const childPath = pathName === '$' ? key : `${pathName}.${key}`;
    if (SECRET_KEY_PATTERN.test(key) && !SECRET_KEY_ALLOWLIST.has(key)) {
      add(
        findings,
        'MTR-SECRET-001',
        `Workflow approval record contains forbidden secret-shaped field ${childPath}.`,
        childPath,
        'Never store raw API keys, bearer tokens, passwords, Authorization headers, or secret values in approval records.',
      );
    }
    scanForSecrets(child, findings, childPath);
  }
}

function workflowBinding(applyGate) {
  return {
    workflow: applyGate.workflow,
    shape: applyGate.shape,
    tenant: applyGate.tenant,
    operationType: 'workflow-apply',
    payloadHash: applyGate.preview?.payloadHash,
  };
}

function buildWorkflowApprovalRecordTemplate(options = {}) {
  const {
    applyGate,
    applyGatePath = null,
    approvalId = null,
    requestedBy = null,
    approvedBy = null,
    owner = null,
    businessPurpose = null,
    expiresAt = null,
    rootDir = process.cwd(),
  } = options;

  if (!isObject(applyGate) || applyGate.schemaVersion !== 'metro.apply-gate.v1') return null;
  const resolvedApplyGatePath = resolveLocalPath(applyGatePath, rootDir);
  const applyGateRootDir = resolvedApplyGatePath ? path.dirname(resolvedApplyGatePath) : rootDir;
  const applyGateValidation = validateApplyGate(applyGate, { rootDir: applyGateRootDir });
  if (!applyGateValidation.valid) return null;

  if (!isApplyGateSupported(applyGate.workflow, applyGate.shape)) return null;
  const bundle = approvalRecordBundle(applyGate.workflow, applyGate.shape, applyGate.tenant);
  if (!bundle) return null;

  const binding = workflowBinding(applyGate);
  const recordApprovalId = approvalId || '<approval-id>';
  const recordOwner = owner || applyGate.approval?.owner || '<billing-ops-owner>';
  const applyGateFileHash = hashFileIfReadable(applyGatePath, rootDir);

  return {
    schemaVersion: WORKFLOW_APPROVAL_RECORD_SCHEMA_VERSION,
    generatedFrom: 'packages/metro-core/src/approval-record/index.js',
    apiAccess: 'none',
    liveExecution: clone(LOCAL_ONLY_LIVE_EXECUTION),
    applyEnabledInCurrentCli: false,
    liveApplyAuthorizedByThisRecord: false,
    durableApprovalIsCurrentTurnAuthorization: false,
    status: 'template',
    binding,
    applyGate: {
      filePath: applyGatePath || '<path-to-reviewed-apply-gate-json>',
      fileHash: applyGateFileHash,
      schemaVersion: applyGate.schemaVersion,
      validationResult: 'passed',
      payloadHash: binding.payloadHash,
      preflightFileHash: applyGate.preflight?.fileHash,
      sandboxProofFileHash: applyGate.sandboxProof?.fileHash || 'not_required_for_sandbox',
    },
    approval: {
      approvalId: recordApprovalId,
      status: 'pending',
      requestedBy: requestedBy || '<requesting-operator-or-agent>',
      owner: recordOwner,
      approvedBy: approvedBy || '<approver>',
      approvedAt: '<ISO-8601 approval timestamp>',
      expiresAt: expiresAt || '<ISO-8601 approval expiry timestamp>',
      businessPurpose: businessPurpose || '<business purpose for this exact workflow apply gate>',
      targetIdentifiers: ['<customer_id|contract_id|package_alias|invoice_id|other reviewed target id>'],
      approverRoles: ['billing-ops-owner'],
    },
    evidence: {
      previewPayloadHash: applyGate.preview?.payloadHash,
      preflightFileHash: applyGate.preflight?.fileHash,
      applyGateFileHash,
      sandboxProofRequired: applyGate.sandboxProof?.required === true,
      sandboxProofFileHash: applyGate.sandboxProof?.fileHash || 'not_required_for_sandbox',
      keyFingerprint: applyGate.keyFingerprint?.applyFingerprint,
      auditLogDestination: applyGate.auditLog?.destination,
      readBackRequired: applyGate.verification?.readBackRequired === true,
      rollbackOwner: applyGate.rollback?.owner,
      rollbackReviewed: applyGate.rollback?.reviewed === true,
      idempotencyReviewed: applyGate.idempotency?.reviewed === true,
      providedEvidence: clone(bundle.requiredEvidence),
    },
    expectedEvidence: clone(bundle),
    confirmation: {
      confirmHash: applyGate.approval?.confirmHash,
      productionConfirmation: applyGate.approval?.productionConfirmation,
      productionConfirmationRequired: binding.tenant === 'production',
    },
    authorization: {
      currentTurnAuthorizationRequired: true,
      currentTurnAuthorizationCaptured: false,
      liveApplyAuthorizedByThisRecord: false,
      durableApprovalIsCurrentTurnAuthorization: false,
      reason: 'A durable workflow approval record is not current-turn authorization and cannot enable workflow apply by itself.',
    },
    futureApply: {
      enabledInCurrentCli: false,
      command: applyGate.approval?.command || `metro apply --workflow ${binding.workflow} --shape ${binding.shape} ${tenantFlag(binding.tenant)} --confirm-hash ${binding.payloadHash} --approval ${recordApprovalId}`,
      blockedBy: [
        'guarded workflow apply runner',
        'current-turn authorization for the exact live operation',
        'live audit writer',
        'workflow apply-readback verifier',
        'rollback or remediation evidence',
      ],
    },
    validationCommand: 'metro approval-record validate --file <workflow-approval-record.json> [--json]',
    nextSafeStep: 'Fill the approval record only after human approval for this exact apply-gate file hash. This record still does not authorize or execute live workflow writes.',
    sources: unique([
      ...(applyGate.sources || []),
      'docs/metronome-cli/one-goal.md',
      'docs/metronome-cli/CLI_ARCHITECTURE.md',
      'docs/metronome-cli/VALIDATION_AND_GUARDRAILS.md',
      'packages/metro-core/src/apply-gate/index.js',
      'packages/metro-core/src/approval-record/index.js',
    ]),
  };
}

function validateBinding(input, findings) {
  const binding = input.binding;
  if (!isObject(binding)) {
    add(findings, 'MTR-APPROVAL-001', 'binding is required.', 'binding', 'Start from metro approval-record template.');
    return;
  }
  if (!isApplyGateSupported(binding.workflow, binding.shape)) {
    add(findings, 'MTR-APPROVAL-001', 'binding workflow and shape are not a supported apply gate pair.', 'binding.workflow', 'Use approval evidence for a supported future apply workflow.');
  }
  if (!getWorkflowApplyResultContract(binding.workflow, binding.shape)) {
    add(findings, 'MTR-APPROVAL-001', 'binding workflow and shape are missing a workflow apply-result contract.', 'binding.workflow', 'Add local apply-result contract coverage before approval records can pass.');
  }
  if (!['sandbox', 'production'].includes(binding.tenant)) {
    add(findings, 'MTR-TENANT-001', 'binding.tenant must be sandbox or production.', 'binding.tenant', 'Bind the approval record to one explicit tenant.');
  }
  if (binding.operationType !== 'workflow-apply') {
    add(findings, 'MTR-APPROVAL-001', 'binding.operationType must be workflow-apply.', 'binding.operationType', 'Use workflow approval records only for reviewed workflow apply gates.');
  }
  validateHash(findings, binding.payloadHash, 'binding.payloadHash', 'Use the preview payload hash carried through the apply gate.');
}

function validateApplyGateFile(input, rootDir, findings) {
  const section = input.applyGate;
  if (!isObject(section)) {
    add(findings, 'MTR-APPROVAL-002', 'applyGate evidence is required.', 'applyGate', 'Start from metro approval-record template.');
    return null;
  }
  requireFilled(findings, section.filePath, 'applyGate.filePath', 'applyGate.filePath is required.', 'Point to the reviewed local workflow apply-gate JSON file.', 'MTR-APPROVAL-002');
  validateHash(findings, section.fileHash, 'applyGate.fileHash', 'Hash the reviewed workflow apply-gate file and record the sha256 value.');

  const resolved = resolveLocalPath(section.filePath, rootDir);
  if (!resolved) return null;

  try {
    const actualHash = hashFile(resolved);
    if (isSha256(section.fileHash) && section.fileHash !== actualHash) {
      add(findings, 'MTR-HASH-002', 'applyGate.fileHash does not match the current file contents.', 'applyGate.fileHash', 'Re-review the changed apply-gate file before using this approval record.');
    }
    const parsed = readJsonFile(resolved);
    const validation = validateApplyGate(parsed, { rootDir: path.dirname(resolved) });
    if (!validation.valid) {
      add(findings, 'MTR-APPROVAL-002', 'referenced workflow apply gate did not pass validation.', 'applyGate.filePath', 'Run metro apply-gate validate on the referenced file and fix all findings.');
    }
    if (section.schemaVersion !== 'metro.apply-gate.v1') {
      add(findings, 'MTR-APPROVAL-002', 'applyGate.schemaVersion must be metro.apply-gate.v1.', 'applyGate.schemaVersion', 'Use a current workflow apply-gate manifest.');
    }
    if (section.validationResult !== 'passed') {
      add(findings, 'MTR-APPROVAL-002', 'applyGate.validationResult must be passed.', 'applyGate.validationResult', 'Only passing apply-gate evidence can satisfy an approval record.');
    }
    if (parsed.workflow !== input.binding?.workflow || parsed.shape !== input.binding?.shape) {
      add(findings, 'MTR-APPROVAL-002', 'apply gate workflow and shape must match the approval record binding.', 'applyGate.filePath', 'Use approval evidence for the exact reviewed workflow and shape.');
    }
    if (parsed.tenant !== input.binding?.tenant) {
      add(findings, 'MTR-TENANT-001', 'apply gate tenant must match the approval record tenant.', 'applyGate.filePath', 'Use approval evidence generated for the same tenant.');
    }
    if (parsed.preview?.payloadHash !== input.binding?.payloadHash || parsed.preview?.payloadHash !== section.payloadHash) {
      add(findings, 'MTR-TENANT-002', 'apply gate payload hash must match binding.payloadHash and applyGate.payloadHash.', 'applyGate.payloadHash', 'Bind approval to the exact reviewed apply-gate preview hash.');
    }
    if (parsed.preflight?.fileHash !== section.preflightFileHash) {
      add(findings, 'MTR-HASH-002', 'applyGate.preflightFileHash must match the referenced apply gate preflight hash.', 'applyGate.preflightFileHash', 'Regenerate approval evidence if preflight evidence changed.');
    }
    if ((parsed.sandboxProof?.fileHash || 'not_required_for_sandbox') !== section.sandboxProofFileHash) {
      add(findings, 'MTR-HASH-002', 'applyGate.sandboxProofFileHash must match the referenced apply gate sandbox proof hash.', 'applyGate.sandboxProofFileHash', 'Regenerate approval evidence if sandbox proof evidence changed.');
    }
    return { fileHash: actualHash, parsed, validation };
  } catch (error) {
    add(findings, 'MTR-APPROVAL-002', `Failed to read or parse applyGate evidence: ${error.message}`, 'applyGate.filePath', 'Use a readable local JSON apply-gate evidence file.');
    return null;
  }
}

function validateApproval(input, applyGate, findings) {
  const approval = input.approval;
  if (!isObject(approval)) {
    add(findings, 'MTR-APPROVAL-001', 'approval is required.', 'approval', 'Record durable approval metadata.');
    return;
  }
  requireFilled(findings, approval.approvalId, 'approval.approvalId', 'approval.approvalId is required.', 'Record the approval ID for this exact reviewed apply-gate hash.');
  requireFilled(findings, approval.requestedBy, 'approval.requestedBy', 'approval.requestedBy is required.', 'Record the operator or agent requesting approval.');
  requireFilled(findings, approval.owner, 'approval.owner', 'approval.owner is required.', 'Record the accountable billing operations owner.');
  requireFilled(findings, approval.approvedBy, 'approval.approvedBy', 'approval.approvedBy is required.', 'Record the approver who approved this exact apply-gate hash.');
  requireFilled(findings, approval.businessPurpose, 'approval.businessPurpose', 'approval.businessPurpose is required.', 'Record why this exact workflow operation is needed.');
  if (input.status !== 'approved') {
    add(findings, 'MTR-APPROVAL-001', 'status must be approved.', 'status', 'Only approved durable approval records can pass validation.');
  }
  if (approval.status !== 'approved') {
    add(findings, 'MTR-APPROVAL-001', 'approval.status must be approved.', 'approval.status', 'Mark approval approved only after reviewing the bound apply-gate hash.');
  }
  if (!isIsoTimestamp(approval.approvedAt)) {
    add(findings, 'MTR-APPROVAL-001', 'approval.approvedAt must be an ISO timestamp.', 'approval.approvedAt', 'Record the exact approval timestamp with a Z suffix.');
  }
  if (!isIsoTimestamp(approval.expiresAt)) {
    add(findings, 'MTR-APPROVAL-001', 'approval.expiresAt must be an ISO timestamp.', 'approval.expiresAt', 'Approval records need a bounded expiry timestamp.');
  }
  if (isIsoTimestamp(approval.approvedAt) && isIsoTimestamp(approval.expiresAt)
    && new Date(approval.expiresAt).getTime() <= new Date(approval.approvedAt).getTime()) {
    add(findings, 'MTR-APPROVAL-001', 'approval.expiresAt must be after approval.approvedAt.', 'approval.expiresAt', 'Use an expiry after the approval timestamp.');
  }
  if (approval.owner !== applyGate?.approval?.owner) {
    add(findings, 'MTR-APPROVAL-002', 'approval.owner must match the referenced apply gate owner.', 'approval.owner', 'Regenerate or re-review approval evidence if ownership changed.');
  }
  if (!list(approval.targetIdentifiers).some(filled)) {
    add(findings, 'MTR-APPROVAL-001', 'approval.targetIdentifiers must include at least one reviewed target identifier.', 'approval.targetIdentifiers', 'Record customer, contract, package, invoice, or other reviewed target IDs.');
  }
  if (!list(approval.approverRoles).includes('billing-ops-owner')) {
    add(findings, 'MTR-APPROVAL-003', 'approval.approverRoles must include billing-ops-owner.', 'approval.approverRoles', 'Workflow approval records require billing operations owner approval evidence.');
  }
}

function validateEvidence(input, applyGate, findings) {
  const evidence = input.evidence;
  if (!isObject(evidence)) {
    add(findings, 'MTR-APPROVAL-001', 'evidence is required.', 'evidence', 'Carry forward the reviewed apply-gate evidence bundle.');
    return;
  }
  validateHash(findings, evidence.previewPayloadHash, 'evidence.previewPayloadHash', 'Bind the record to the reviewed preview payload hash.');
  if (evidence.previewPayloadHash !== input.binding?.payloadHash || evidence.previewPayloadHash !== applyGate?.preview?.payloadHash) {
    add(findings, 'MTR-TENANT-002', 'evidence.previewPayloadHash must match binding.payloadHash and the referenced apply gate preview hash.', 'evidence.previewPayloadHash', 'Approval must bind to the exact reviewed preview payload hash.');
  }
  if (evidence.preflightFileHash !== applyGate?.preflight?.fileHash) {
    add(findings, 'MTR-HASH-002', 'evidence.preflightFileHash must match the referenced apply gate preflight file hash.', 'evidence.preflightFileHash', 'Regenerate the approval record from the reviewed apply gate.');
  }
  if (evidence.applyGateFileHash !== input.applyGate?.fileHash) {
    add(findings, 'MTR-HASH-002', 'evidence.applyGateFileHash must match applyGate.fileHash.', 'evidence.applyGateFileHash', 'Bind evidence to the same reviewed apply-gate file.');
  }
  const proofRequired = applyGate?.tenant === 'production' || applyGate?.sandboxProof?.required === true;
  if (evidence.sandboxProofRequired !== (applyGate?.sandboxProof?.required === true)) {
    add(findings, 'MTR-VERIFY-003', 'evidence.sandboxProofRequired must match the referenced apply gate.', 'evidence.sandboxProofRequired', 'Regenerate approval evidence if sandbox proof policy changed.');
  }
  if (proofRequired) {
    validateHash(findings, evidence.sandboxProofFileHash, 'evidence.sandboxProofFileHash', 'Production workflow approval records must bind passing sandbox proof.');
    if (evidence.sandboxProofFileHash !== applyGate?.sandboxProof?.fileHash) {
      add(findings, 'MTR-HASH-002', 'evidence.sandboxProofFileHash must match the referenced apply gate sandbox-proof file hash.', 'evidence.sandboxProofFileHash', 'Regenerate after reviewing sandbox proof changes.');
    }
    if (applyGate?.sandboxProof?.validationResult !== 'passed') {
      add(findings, 'MTR-VERIFY-003', 'referenced apply gate must include passing sandbox proof.', 'evidence.sandboxProofFileHash', 'Validate sandbox proof before approving future production write evidence.');
    }
  } else if (evidence.sandboxProofFileHash !== (applyGate?.sandboxProof?.fileHash || 'not_required_for_sandbox')) {
    add(findings, 'MTR-HASH-002', 'sandbox proof evidence must match the referenced sandbox apply gate.', 'evidence.sandboxProofFileHash', 'Regenerate approval evidence if sandbox proof evidence changed.');
  }
  if (!filled(evidence.keyFingerprint) || evidence.keyFingerprint !== applyGate?.keyFingerprint?.applyFingerprint) {
    add(findings, 'MTR-TENANT-004', 'evidence.keyFingerprint must match the apply gate apply fingerprint.', 'evidence.keyFingerprint', 'Restart approval if the tenant key fingerprint changed.');
  }
  if (!filled(evidence.auditLogDestination) || evidence.auditLogDestination !== applyGate?.auditLog?.destination) {
    add(findings, 'MTR-AUDIT-001', 'evidence.auditLogDestination must match the apply gate audit destination.', 'evidence.auditLogDestination', 'Record the future JSONL audit destination from the reviewed apply gate.');
  }
  if (evidence.readBackRequired !== true || applyGate?.verification?.readBackRequired !== true) {
    add(findings, 'MTR-VERIFY-001', 'evidence.readBackRequired must be true and match the apply gate.', 'evidence.readBackRequired', 'Every approved workflow apply must require read-back verification.');
  }
  if (evidence.rollbackReviewed !== true || evidence.rollbackOwner !== applyGate?.rollback?.owner) {
    add(findings, 'MTR-VERIFY-002', 'evidence rollback owner/review must match the apply gate.', 'evidence.rollbackOwner', 'Approval must review the same rollback owner from the apply gate.');
  }
  if (evidence.idempotencyReviewed !== true || applyGate?.idempotency?.reviewed !== true) {
    add(findings, 'MTR-IDEMP-001', 'evidence.idempotencyReviewed must be true and match the apply gate.', 'evidence.idempotencyReviewed', 'Approval must carry an idempotency review forward.');
  }

  const bundle = approvalRecordBundle(input.binding?.workflow, input.binding?.shape, input.binding?.tenant);
  const provided = new Set(list(evidence.providedEvidence).filter(filled));
  for (const required of bundle?.requiredEvidence || []) {
    if (!provided.has(required)) {
      add(findings, 'MTR-APPROVAL-003', `evidence.providedEvidence must include ${required}.`, 'evidence.providedEvidence', 'Carry every required approval evidence item from the workflow evidence bundle.');
    }
  }
  if (input.expectedEvidence?.schemaVersion !== WORKFLOW_APPROVAL_RECORD_SCHEMA_VERSION) {
    add(findings, 'MTR-APPROVAL-003', `expectedEvidence.schemaVersion must be ${WORKFLOW_APPROVAL_RECORD_SCHEMA_VERSION}.`, 'expectedEvidence.schemaVersion', 'Regenerate the approval record from the current workflow evidence bundle.');
  }
  if (input.expectedEvidence?.liveApplyAuthorizedByThisRecord !== false || input.expectedEvidence?.durableApprovalIsCurrentTurnAuthorization !== false) {
    add(findings, 'MTR-APPROVAL-004', 'expectedEvidence must preserve disabled live apply and current-turn authorization state.', 'expectedEvidence', 'Approval evidence must not claim live authorization.');
  }
}

function validateConfirmation(input, applyGate, findings) {
  if (input.confirmation?.confirmHash !== input.binding?.payloadHash || input.confirmation?.confirmHash !== applyGate?.approval?.confirmHash) {
    add(findings, 'MTR-TENANT-002', 'confirmation.confirmHash must match the reviewed payload hash.', 'confirmation.confirmHash', 'Bind approval confirmation to the exact reviewed preview hash.');
  }
  if (input.binding?.tenant === 'production') {
    if (input.confirmation?.productionConfirmation !== input.binding?.payloadHash) {
      add(findings, 'MTR-TENANT-002', 'production approval records require confirmation.productionConfirmation to equal the reviewed payload hash.', 'confirmation.productionConfirmation', 'Production confirmation must paste the exact preview payload hash.');
    }
    if (input.confirmation?.productionConfirmationRequired !== true) {
      add(findings, 'MTR-TENANT-002', 'production approval records require confirmation.productionConfirmationRequired=true.', 'confirmation.productionConfirmationRequired', 'Production writes always require preview-hash confirmation.');
    }
  } else if (input.confirmation?.productionConfirmation !== 'not_required_for_sandbox' || input.confirmation?.productionConfirmationRequired !== false) {
    add(findings, 'MTR-TENANT-002', 'sandbox approval records must mark production confirmation not required.', 'confirmation.productionConfirmation', 'Use not_required_for_sandbox and productionConfirmationRequired=false for sandbox evidence.');
  }
}

function validateAuthorization(input, findings) {
  if (input.apiAccess !== 'none') {
    add(findings, 'MTR-APPROVAL-004', 'apiAccess must remain none.', 'apiAccess', 'Approval records must not claim live API access.');
  }
  if (input.applyEnabledInCurrentCli !== false) {
    add(findings, 'MTR-APPROVAL-004', 'applyEnabledInCurrentCli must be false.', 'applyEnabledInCurrentCli', 'Do not mark workflow apply enabled until a guarded runner exists.');
  }
  if (input.liveExecution?.enabledInCurrentCli !== false) {
    add(findings, 'MTR-APPROVAL-004', 'liveExecution.enabledInCurrentCli must be false.', 'liveExecution.enabledInCurrentCli', 'This CLI release must keep workflow live execution disabled.');
  }
  if (input.liveApplyAuthorizedByThisRecord !== false) {
    add(findings, 'MTR-APPROVAL-004', 'liveApplyAuthorizedByThisRecord must be false.', 'liveApplyAuthorizedByThisRecord', 'Durable approval records must not claim current-turn live apply authorization.');
  }
  if (input.durableApprovalIsCurrentTurnAuthorization !== false) {
    add(findings, 'MTR-APPROVAL-004', 'durableApprovalIsCurrentTurnAuthorization must be false.', 'durableApprovalIsCurrentTurnAuthorization', 'A durable approval record is not current-turn authorization.');
  }
  if (input.authorization?.currentTurnAuthorizationRequired !== true) {
    add(findings, 'MTR-APPROVAL-004', 'authorization.currentTurnAuthorizationRequired must be true.', 'authorization.currentTurnAuthorizationRequired', 'Future live apply still needs explicit current-turn authorization.');
  }
  if (input.authorization?.currentTurnAuthorizationCaptured !== false) {
    add(findings, 'MTR-APPROVAL-004', 'authorization.currentTurnAuthorizationCaptured must be false.', 'authorization.currentTurnAuthorizationCaptured', 'Do not store current-turn authorization in durable approval records.');
  }
  if (input.authorization?.liveApplyAuthorizedByThisRecord !== false) {
    add(findings, 'MTR-APPROVAL-004', 'authorization.liveApplyAuthorizedByThisRecord must be false.', 'authorization.liveApplyAuthorizedByThisRecord', 'This record is approval evidence, not an execution token.');
  }
  if (input.authorization?.durableApprovalIsCurrentTurnAuthorization !== false) {
    add(findings, 'MTR-APPROVAL-004', 'authorization.durableApprovalIsCurrentTurnAuthorization must be false.', 'authorization.durableApprovalIsCurrentTurnAuthorization', 'This durable record cannot capture current-turn authorization.');
  }
  if (input.futureApply?.enabledInCurrentCli !== false) {
    add(findings, 'MTR-APPROVAL-004', 'futureApply.enabledInCurrentCli must be false.', 'futureApply.enabledInCurrentCli', 'Approval records must not enable workflow apply execution.');
  }
}

function validateWorkflowApprovalRecord(input, options = {}) {
  const rootDir = options.rootDir || process.cwd();
  const findings = [];
  scanForSecrets(input, findings);

  if (!isObject(input)) {
    return {
      schemaVersion: WORKFLOW_APPROVAL_RECORD_VALIDATION_SCHEMA_VERSION,
      valid: false,
      apiAccess: 'none',
      liveExecution: clone(LOCAL_ONLY_LIVE_EXECUTION),
      applyEnabledInCurrentCli: false,
      liveApplyAuthorizedByThisRecord: false,
      durableApprovalIsCurrentTurnAuthorization: false,
      findings: [finding('MTR-APPROVAL-000', 'error', 'Workflow approval record must be a JSON object.', '$', 'Start from metro approval-record template.')],
      summary: { workflow: null, shape: null, tenant: null },
    };
  }

  if (input.schemaVersion !== WORKFLOW_APPROVAL_RECORD_SCHEMA_VERSION) {
    add(findings, 'MTR-APPROVAL-001', `schemaVersion must be ${WORKFLOW_APPROVAL_RECORD_SCHEMA_VERSION}.`, 'schemaVersion', 'Use the workflow approval-record schema.');
  }

  validateBinding(input, findings);
  const applyGateEvidence = validateApplyGateFile(input, rootDir, findings);
  validateApproval(input, applyGateEvidence?.parsed, findings);
  validateEvidence(input, applyGateEvidence?.parsed, findings);
  validateConfirmation(input, applyGateEvidence?.parsed, findings);
  validateAuthorization(input, findings);

  const valid = !findings.some((item) => item.severity === 'error');
  return {
    schemaVersion: WORKFLOW_APPROVAL_RECORD_VALIDATION_SCHEMA_VERSION,
    generatedFrom: 'packages/metro-core/src/approval-record/index.js',
    apiAccess: 'none',
    liveExecution: clone(LOCAL_ONLY_LIVE_EXECUTION),
    applyEnabledInCurrentCli: false,
    liveApplyAuthorizedByThisRecord: false,
    durableApprovalIsCurrentTurnAuthorization: false,
    summary: {
      workflow: input.binding?.workflow || null,
      shape: input.binding?.shape || null,
      tenant: input.binding?.tenant || null,
      operationType: input.binding?.operationType || null,
      approvalId: input.approval?.approvalId || null,
      approvalStatus: input.approval?.status || input.status || null,
      payloadHash: input.binding?.payloadHash || null,
      applyGateFileHash: applyGateEvidence?.fileHash || input.applyGate?.fileHash || null,
      sandboxProofFileHash: input.evidence?.sandboxProofFileHash || null,
      keyFingerprint: input.evidence?.keyFingerprint || null,
      liveApplyAuthorizedByThisRecord: false,
      durableApprovalIsCurrentTurnAuthorization: false,
    },
    valid,
    findings,
    nextSafeStep: valid
      ? 'Keep this as durable local workflow approval evidence. It still does not authorize live workflow apply without a guarded runner and explicit current-turn authorization.'
      : 'Fix the workflow approval record and re-run metro approval-record validate before using it as future workflow apply evidence.',
  };
}

module.exports = {
  WORKFLOW_APPROVAL_RECORD_SCHEMA_VERSION,
  WORKFLOW_APPROVAL_RECORD_VALIDATION_SCHEMA_VERSION,
  buildWorkflowApprovalRecordTemplate,
  validateWorkflowApprovalRecord,
  workflowApprovalRecordCoverage,
};
