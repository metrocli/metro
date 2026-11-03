'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { approvalPolicyReference, getApiEndpoint, listApiEndpoints } = require('./index');
const { API_APPLY_GATE_SCHEMA_VERSION, validateApiApplyGate } = require('./apply-gate');

const API_APPROVAL_RECORD_SCHEMA_VERSION = 'metro.api.approval-record.v1';
const API_APPROVAL_RECORD_VALIDATION_SCHEMA_VERSION = 'metro.api.approval-record.validation.v1';

const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const SECRET_KEY_PATTERN = /(?:api[_-]?key|secret|token|authorization|password|private[_-]?key|bearer)/i;
const SECRET_KEY_ALLOWLIST = new Set([
  'authorization',
  'keyFingerprint',
  'currentTurnAuthorizationRequired',
  'currentTurnAuthorizationCaptured',
  'liveApplyAuthorizedByThisRecord',
]);
const SECRET_VALUE_PATTERN = /(?:bearer\s+[A-Za-z0-9._-]+|sk_live_[A-Za-z0-9]+|sk_test_[A-Za-z0-9]+|rk_live_[A-Za-z0-9]+|prod_[A-Za-z0-9]{12,})/i;

const LOCAL_ONLY_LIVE_EXECUTION = {
  enabledInCurrentCli: false,
  reason: 'Expert API approval records are local evidence only; the current CLI does not load Metronome API clients or run expert API apply commands.',
  nextSafeStep: 'Validate the approval record locally, then keep expert API apply blocked until guarded runners, current-turn authorization, audit writing, read-back verification, and rollback evidence exist.',
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function list(value) {
  return Array.isArray(value) ? value : [];
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

function requireFilled(findings, value, pathName, message, remediation, id = 'MTR-API-APPROVAL-001') {
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

function scanForSecrets(value, findings, pathName = '$') {
  if (typeof value === 'string') {
    if (SECRET_VALUE_PATTERN.test(value)) {
      add(
        findings,
        'MTR-APIREQ-003',
        `API approval record appears to contain a secret-like value at ${pathName}.`,
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
        'MTR-APIREQ-003',
        `API approval record contains forbidden secret-shaped field ${childPath}.`,
        childPath,
        'Never store raw API keys, bearer tokens, passwords, Authorization headers, or secret values in approval records.',
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

function approvalPolicyForEndpoint(endpoint) {
  const scoped = approvalPolicyReference({ family: endpoint.family })
    .policies
    .find((policy) => policy.scope === endpoint.permissionScope);
  if (scoped) return scoped;
  return approvalPolicyReference()
    .policies
    .find((policy) => policy.scope === endpoint.permissionScope) || null;
}

function applyGateBinding(applyGate) {
  return {
    endpointId: applyGate.binding?.endpointId,
    tenant: applyGate.binding?.tenant,
    operationType: applyGate.binding?.operationType,
    permissionScope: applyGate.binding?.permissionScope,
    requestHash: applyGate.binding?.requestHash,
    payloadHash: applyGate.binding?.payloadHash,
  };
}

function apiApprovalRecordCoverage() {
  return listApiEndpoints().reduce((coverage, endpoint) => {
    const isWriteEndpoint = endpoint.operationType === 'write';
    coverage[endpoint.id] = {
      schemaVersion: API_APPROVAL_RECORD_SCHEMA_VERSION,
      supportStatus: isWriteEndpoint ? 'local-approval-record' : 'not-write-endpoint',
      command: isWriteEndpoint
        ? 'metro api approval-record template --apply-gate <api-apply-gate.json> [--approval-id <id>] [--requested-by <id>] [--approved-by <name>] [--owner <owner>] [--business-purpose <text>] [--expires-at <ISO>] [--json]'
        : null,
      validationCommand: 'metro api approval-record validate --file <api-approval-record.json> [--json]',
      apiAccess: 'none',
      applyEnabledInCurrentCli: false,
      requiresApplyGate: isWriteEndpoint ? `metro api apply-gate validate --file <api-apply-gate-for-${endpoint.id}.json> [--json]` : null,
      requiredEvidence: isWriteEndpoint
        ? ['validated-apply-gate-file-hash', 'preview-payload-hash', 'sandbox-proof-file-hash', 'tenant-profile-key-fingerprint', 'audit-destination', 'read-back-plan', 'rollback-remediation', 'idempotency-review', 'owner-approval', 'current-turn-authorization-still-required']
        : [],
    };
    return coverage;
  }, {});
}

function buildApiApprovalRecordTemplate(options = {}) {
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

  if (!isObject(applyGate) || applyGate.schemaVersion !== API_APPLY_GATE_SCHEMA_VERSION) return null;
  const resolvedApplyGatePath = resolveLocalPath(applyGatePath, rootDir);
  const applyGateRootDir = resolvedApplyGatePath ? path.dirname(resolvedApplyGatePath) : rootDir;
  const applyGateValidation = validateApiApplyGate(applyGate, { rootDir: applyGateRootDir });
  if (!applyGateValidation.valid) return null;

  const endpoint = getApiEndpoint(applyGate.binding?.endpointId);
  if (!endpoint || endpoint.operationType !== 'write') return null;
  const policy = approvalPolicyForEndpoint(endpoint);
  if (!policy) return null;

  const binding = applyGateBinding(applyGate);
  const recordApprovalId = approvalId || applyGate.approval?.approvalId || '<approval-id>';
  const recordOwner = owner || applyGate.approval?.owner || '<billing-ops-owner>';

  return {
    schemaVersion: API_APPROVAL_RECORD_SCHEMA_VERSION,
    generatedFrom: 'packages/metro-core/src/api-catalog/approval-record.js',
    apiAccess: 'none',
    liveExecution: clone(LOCAL_ONLY_LIVE_EXECUTION),
    applyEnabledInCurrentCli: false,
    liveApplyAuthorizedByThisRecord: false,
    status: 'template',
    binding,
    endpoint: endpointSnapshot(endpoint),
    applyGate: {
      filePath: applyGatePath || '<path-to-reviewed-api-apply-gate-json>',
      fileHash: hashFileIfReadable(applyGatePath, rootDir),
      schemaVersion: applyGate.schemaVersion,
      validationResult: 'passed',
      payloadHash: binding.payloadHash,
      requestHash: binding.requestHash,
    },
    approval: {
      approvalId: recordApprovalId,
      status: 'pending',
      requestedBy: requestedBy || '<requesting-operator-or-agent>',
      owner: recordOwner,
      approvedBy: approvedBy || '<approver>',
      approvedAt: '<ISO-8601 approval timestamp>',
      expiresAt: expiresAt || '<ISO-8601 approval expiry timestamp>',
      businessPurpose: businessPurpose || '<business purpose for this exact endpoint operation>',
      targetIdentifiers: ['<customer_id|contract_id|package_id|invoice_id|other reviewed target id>'],
      approverRoles: clone(policy.requiredApproverRoles),
    },
    policy: {
      scope: policy.scope,
      accessClass: policy.accessClass,
      approvalTier: policy.approvalTier,
      accountableOwnerRole: policy.accountableOwnerRole,
      requiredApproverRoles: clone(policy.requiredApproverRoles),
      riskClass: policy.riskClass,
      evidenceRequirements: clone(policy.evidenceRequirements),
      confirmationRequirement: policy.confirmationRequirement,
      liveCommandStatus: policy.liveCommandStatus,
      sources: clone(policy.sources),
    },
    evidence: {
      previewPayloadHash: applyGate.preview?.payloadHash,
      previewFileHash: applyGate.preview?.fileHash,
      preflightFileHash: applyGate.preflight?.fileHash,
      applyGateFileHash: hashFileIfReadable(applyGatePath, rootDir),
      sandboxProofFileHash: applyGate.sandboxProof?.fileHash,
      sandboxProofBindingMode: applyGate.sandboxProof?.bindingMode,
      sandboxProofRequestHash: applyGate.sandboxProof?.sandboxRequestHash,
      tenantProfileResolutionFileHash: applyGate.tenantProfile?.profileResolution?.fileHash,
      auditLogDestination: applyGate.auditLog?.destination,
      keyFingerprint: applyGate.keyFingerprint?.applyFingerprint,
      canaryPlan: applyGate.sandboxProof?.required ? 'covered-by-reviewed-sandbox-proof' : 'not_required',
      readBackPlan: clone(applyGate.verification?.checks || []),
      rollbackOrRemediationPlan: applyGate.rollback?.plan,
      idempotencyReview: applyGate.idempotency?.duplicatePrevention,
    },
    confirmation: {
      confirmHash: applyGate.approval?.confirmHash,
      productionConfirmation: applyGate.approval?.productionConfirmation,
      productionConfirmationRequired: binding.tenant === 'production',
    },
    tenantProfile: {
      profileName: applyGate.tenantProfile?.profileName,
      tenant: applyGate.tenantProfile?.tenant,
      keyEnv: applyGate.tenantProfile?.keyEnv,
      keyFingerprint: applyGate.tenantProfile?.keyFingerprint,
      profileResolutionFileHash: applyGate.tenantProfile?.profileResolution?.fileHash,
    },
    authorization: {
      currentTurnAuthorizationRequired: true,
      currentTurnAuthorizationCaptured: false,
      liveApplyAuthorizedByThisRecord: false,
      reason: 'A durable approval record is not current-turn authorization and cannot enable expert API apply by itself.',
    },
    futureApply: {
      enabledInCurrentCli: false,
      command: applyGate.futureApply?.command || `metro api apply ${endpoint.id} --file <request.json|yaml> --confirm-hash ${binding.payloadHash} --approval ${recordApprovalId}`,
      blockedBy: [
        'guarded expert API apply runner',
        'current-turn authorization for the exact live operation',
        'live audit writer',
        'read-back verifier',
        'permission enforcement',
      ],
    },
    validationCommand: 'metro api approval-record validate --file <api-approval-record.json> [--json]',
    nextSafeStep: 'Fill the approval record only after human approval for this exact apply-gate hash. This record still does not authorize or execute live API writes.',
    sources: clone(applyGate.sources || endpoint.sources),
  };
}

function validateApplyGateFile(input, endpoint, rootDir, findings) {
  const section = input.applyGate;
  if (!isObject(section)) {
    add(findings, 'MTR-API-APPROVAL-002', 'applyGate evidence is required.', 'applyGate', 'Start from metro api approval-record template.');
    return null;
  }
  requireFilled(findings, section.filePath, 'applyGate.filePath', 'applyGate.filePath is required.', 'Point to the reviewed local API apply-gate JSON file.', 'MTR-API-APPROVAL-002');
  validateHash(findings, section.fileHash, 'applyGate.fileHash', 'Hash the reviewed API apply-gate file and record the sha256 value.');

  const resolved = resolveLocalPath(section.filePath, rootDir);
  if (!resolved) return null;

  try {
    const actualHash = hashFile(resolved);
    if (isSha256(section.fileHash) && section.fileHash !== actualHash) {
      add(findings, 'MTR-HASH-002', 'applyGate.fileHash does not match the current file contents.', 'applyGate.fileHash', 'Re-review the changed apply-gate file before using this approval record.');
    }
    const parsed = readJsonFile(resolved);
    const validation = validateApiApplyGate(parsed, { rootDir: path.dirname(resolved) });
    if (!validation.valid) {
      add(findings, 'MTR-API-APPROVAL-002', 'referenced API apply gate did not pass validation.', 'applyGate.filePath', 'Run metro api apply-gate validate on the referenced file and fix all findings.');
    }
    if (parsed.binding?.endpointId !== endpoint?.id) {
      add(findings, 'MTR-ENDPOINT-001', 'apply gate endpoint must match the approval record endpoint.', 'applyGate.filePath', 'Use approval evidence for the exact reviewed endpoint.');
    }
    if (parsed.binding?.tenant !== input.binding?.tenant) {
      add(findings, 'MTR-TENANT-001', 'apply gate tenant must match the approval record tenant.', 'applyGate.filePath', 'Use approval evidence generated for the same tenant.');
    }
    if (parsed.binding?.payloadHash !== input.binding?.payloadHash || parsed.binding?.payloadHash !== section.payloadHash) {
      add(findings, 'MTR-TENANT-002', 'apply gate payload hash must match binding.payloadHash and applyGate.payloadHash.', 'applyGate.payloadHash', 'Bind approval to the exact reviewed apply-gate preview hash.');
    }
    if (parsed.binding?.requestHash !== input.binding?.requestHash || parsed.binding?.requestHash !== section.requestHash) {
      add(findings, 'MTR-HASH-002', 'apply gate request hash must match binding.requestHash and applyGate.requestHash.', 'applyGate.requestHash', 'Regenerate approval evidence if request evidence changed.');
    }
    if (section.schemaVersion !== API_APPLY_GATE_SCHEMA_VERSION) {
      add(findings, 'MTR-API-APPROVAL-002', `applyGate.schemaVersion must be ${API_APPLY_GATE_SCHEMA_VERSION}.`, 'applyGate.schemaVersion', 'Use a current API apply-gate manifest.');
    }
    if (section.validationResult !== 'passed') {
      add(findings, 'MTR-API-APPROVAL-002', 'applyGate.validationResult must be passed.', 'applyGate.validationResult', 'Only passing apply-gate evidence can satisfy an approval record.');
    }
    return { fileHash: actualHash, parsed, validation };
  } catch (error) {
    add(findings, 'MTR-API-APPROVAL-002', `Failed to read or parse applyGate evidence: ${error.message}`, 'applyGate.filePath', 'Use a readable local JSON apply-gate evidence file.');
    return null;
  }
}

function validateBinding(input, endpoint, findings) {
  const binding = input.binding;
  if (!isObject(binding)) {
    add(findings, 'MTR-API-APPROVAL-001', 'binding is required.', 'binding', 'Start from metro api approval-record template.');
    return;
  }
  if (binding.endpointId !== endpoint?.id) {
    add(findings, 'MTR-ENDPOINT-001', 'binding.endpointId must match the reviewed endpoint catalog.', 'binding.endpointId', 'Use approval evidence for the exact reviewed endpoint.');
  }
  if (!['sandbox', 'production'].includes(binding.tenant)) {
    add(findings, 'MTR-TENANT-001', 'binding.tenant must be sandbox or production.', 'binding.tenant', 'Bind the approval record to one explicit tenant.');
  }
  if (binding.operationType !== 'write' || endpoint?.operationType !== 'write') {
    add(findings, 'MTR-API-APPROVAL-001', 'approval records are only supported for reviewed write endpoints.', 'binding.operationType', 'Use read-gate current-turn authorization for read endpoints.');
  }
  if (binding.permissionScope !== endpoint?.permissionScope) {
    add(findings, 'MTR-ENDPOINT-001', 'binding.permissionScope must match the endpoint catalog.', 'binding.permissionScope', 'Regenerate the approval record from the current reviewed endpoint catalog.');
  }
  validateHash(findings, binding.requestHash, 'binding.requestHash', 'Use the requestHash emitted by metro api preview and carried through the apply gate.');
  validateHash(findings, binding.payloadHash, 'binding.payloadHash', 'Use the payloadHash emitted by metro api preview and carried through the apply gate.');
}

function validateEndpointSnapshot(input, endpoint, findings) {
  const snapshot = input.endpoint;
  if (!isObject(snapshot)) {
    add(findings, 'MTR-ENDPOINT-001', 'endpoint snapshot is required.', 'endpoint', 'Start from metro api approval-record template.');
    return;
  }
  for (const field of ['id', 'method', 'path', 'operationType', 'permissionScope']) {
    if (snapshot[field] !== endpoint?.[field]) {
      add(findings, 'MTR-ENDPOINT-001', `endpoint.${field} must match the reviewed endpoint catalog.`, `endpoint.${field}`, 'Regenerate the approval record from the current reviewed endpoint catalog.');
    }
  }
  if (!list(snapshot.sourceIds).includes('endpoint-matrix')) {
    add(findings, 'MTR-ENDPOINT-001', 'endpoint.sourceIds must include endpoint-matrix.', 'endpoint.sourceIds', 'Reviewed endpoint IDs must cite the local endpoint matrix.');
  }
}

function validateApproval(input, endpoint, policy, applyGate, findings) {
  const approval = input.approval;
  if (!isObject(approval)) {
    add(findings, 'MTR-API-APPROVAL-001', 'approval is required.', 'approval', 'Record durable approval metadata.');
    return;
  }
  requireFilled(findings, approval.approvalId, 'approval.approvalId', 'approval.approvalId is required.', 'Record the approval ID for this exact reviewed apply-gate hash.');
  requireFilled(findings, approval.requestedBy, 'approval.requestedBy', 'approval.requestedBy is required.', 'Record the operator or agent requesting approval.');
  requireFilled(findings, approval.owner, 'approval.owner', 'approval.owner is required.', 'Record the accountable billing operations owner.');
  requireFilled(findings, approval.approvedBy, 'approval.approvedBy', 'approval.approvedBy is required.', 'Record the approver who approved this exact apply-gate hash.');
  requireFilled(findings, approval.businessPurpose, 'approval.businessPurpose', 'approval.businessPurpose is required.', 'Record why this exact endpoint operation is needed.');
  if (input.status !== 'approved') {
    add(findings, 'MTR-API-APPROVAL-001', 'status must be approved.', 'status', 'Only approved durable approval records can pass validation.');
  }
  if (approval.status !== 'approved') {
    add(findings, 'MTR-API-APPROVAL-001', 'approval.status must be approved.', 'approval.status', 'Mark approval approved only after reviewing the bound apply-gate hash.');
  }
  if (!isIsoTimestamp(approval.approvedAt)) {
    add(findings, 'MTR-API-APPROVAL-001', 'approval.approvedAt must be an ISO timestamp.', 'approval.approvedAt', 'Record the exact approval timestamp with a Z suffix.');
  }
  if (!isIsoTimestamp(approval.expiresAt)) {
    add(findings, 'MTR-API-APPROVAL-001', 'approval.expiresAt must be an ISO timestamp.', 'approval.expiresAt', 'Approval records need a bounded expiry timestamp.');
  }
  if (isIsoTimestamp(approval.approvedAt) && isIsoTimestamp(approval.expiresAt)
    && new Date(approval.expiresAt).getTime() <= new Date(approval.approvedAt).getTime()) {
    add(findings, 'MTR-API-APPROVAL-001', 'approval.expiresAt must be after approval.approvedAt.', 'approval.expiresAt', 'Use an expiry after the approval timestamp.');
  }
  if (approval.owner !== applyGate?.approval?.owner) {
    add(findings, 'MTR-API-APPROVAL-002', 'approval.owner must match the referenced apply gate owner.', 'approval.owner', 'Regenerate or re-review approval evidence if ownership changed.');
  }
  if (approval.approvalId !== applyGate?.approval?.approvalId) {
    add(findings, 'MTR-API-APPROVAL-002', 'approval.approvalId must match the referenced apply gate approvalId.', 'approval.approvalId', 'Use one approval ID consistently across preflight, apply gate, and approval record.');
  }
  if (!list(approval.targetIdentifiers).some(filled)) {
    add(findings, 'MTR-API-APPROVAL-001', 'approval.targetIdentifiers must include at least one reviewed target identifier.', 'approval.targetIdentifiers', 'Record customer, contract, package, invoice, or other reviewed target IDs.');
  }

  const roles = new Set(list(approval.approverRoles).filter(filled));
  for (const role of policy?.requiredApproverRoles || []) {
    if (!roles.has(role)) {
      add(findings, 'MTR-API-APPROVAL-003', `approval.approverRoles must include ${role}.`, 'approval.approverRoles', 'Include every role required by the local approval policy for this permission scope.');
    }
  }
  if (policy?.scope !== endpoint?.permissionScope) {
    add(findings, 'MTR-API-APPROVAL-003', 'approval policy scope must match the endpoint permission scope.', 'policy.scope', 'Regenerate the approval record from the local approval policy reference.');
  }
}

function validateEvidence(input, applyGate, findings) {
  validateHash(findings, input.evidence?.previewPayloadHash, 'evidence.previewPayloadHash', 'Bind the record to the reviewed preview payload hash.');
  if (input.evidence?.previewPayloadHash !== input.binding?.payloadHash) {
    add(findings, 'MTR-TENANT-002', 'evidence.previewPayloadHash must match binding.payloadHash.', 'evidence.previewPayloadHash', 'Approval must bind to the exact reviewed preview payload hash.');
  }
  if (input.evidence?.previewFileHash !== applyGate?.preview?.fileHash) {
    add(findings, 'MTR-HASH-002', 'evidence.previewFileHash must match the referenced apply gate preview file hash.', 'evidence.previewFileHash', 'Regenerate the approval record from the reviewed apply gate.');
  }
  if (input.evidence?.preflightFileHash !== applyGate?.preflight?.fileHash) {
    add(findings, 'MTR-HASH-002', 'evidence.preflightFileHash must match the referenced apply gate preflight file hash.', 'evidence.preflightFileHash', 'Regenerate the approval record from the reviewed apply gate.');
  }
  if (input.evidence?.applyGateFileHash !== input.applyGate?.fileHash) {
    add(findings, 'MTR-HASH-002', 'evidence.applyGateFileHash must match applyGate.fileHash.', 'evidence.applyGateFileHash', 'Bind evidence to the same reviewed apply-gate file.');
  }
  if (input.evidence?.sandboxProofFileHash !== applyGate?.sandboxProof?.fileHash) {
    add(findings, 'MTR-HASH-002', 'evidence.sandboxProofFileHash must match the referenced apply gate sandbox-proof file hash.', 'evidence.sandboxProofFileHash', 'Regenerate after reviewing sandbox proof changes.');
  }
  if (applyGate?.sandboxProof?.validationResult !== 'passed') {
    add(findings, 'MTR-VERIFY-003', 'referenced apply gate must include passing sandbox proof.', 'evidence.sandboxProofFileHash', 'Validate sandbox proof before approving future write evidence.');
  }
  if (!filled(input.evidence?.auditLogDestination) || input.evidence?.auditLogDestination !== applyGate?.auditLog?.destination) {
    add(findings, 'MTR-AUDIT-001', 'evidence.auditLogDestination must match the apply gate audit destination.', 'evidence.auditLogDestination', 'Record the future JSONL audit destination from the reviewed apply gate.');
  }
  if (!filled(input.evidence?.rollbackOrRemediationPlan) || input.evidence?.rollbackOrRemediationPlan !== applyGate?.rollback?.plan) {
    add(findings, 'MTR-VERIFY-002', 'evidence.rollbackOrRemediationPlan must match the apply gate rollback plan.', 'evidence.rollbackOrRemediationPlan', 'Approval must review the same rollback or remediation path.');
  }
  if (!filled(input.evidence?.idempotencyReview) || input.evidence?.idempotencyReview !== applyGate?.idempotency?.duplicatePrevention) {
    add(findings, 'MTR-IDEMP-001', 'evidence.idempotencyReview must match the apply gate duplicate-prevention review.', 'evidence.idempotencyReview', 'Approval must review the same idempotency plan.');
  }
  if (!list(input.evidence?.readBackPlan).some((check) => filled(check?.expectation))) {
    add(findings, 'MTR-VERIFY-001', 'evidence.readBackPlan must include at least one read-back expectation.', 'evidence.readBackPlan', 'Carry forward the apply gate read-back checks.');
  }
}

function validateTenantAndConfirmation(input, applyGate, findings) {
  const profile = input.tenantProfile || {};
  if (profile.tenant !== input.binding?.tenant || profile.tenant !== applyGate?.tenantProfile?.tenant) {
    add(findings, 'MTR-TENANT-001', 'tenantProfile.tenant must match binding.tenant and the apply gate tenant profile.', 'tenantProfile.tenant', 'Use one tenant consistently across approval evidence.');
  }
  for (const field of ['profileName', 'keyEnv', 'keyFingerprint', 'profileResolutionFileHash']) {
    requireFilled(findings, profile[field], `tenantProfile.${field}`, `tenantProfile.${field} is required.`, 'Record secret-free tenant profile binding from the apply gate.', field === 'keyFingerprint' ? 'MTR-TENANT-004' : 'MTR-TENANT-001');
    if (applyGate?.tenantProfile && profile[field] !== (field === 'profileResolutionFileHash'
      ? applyGate.tenantProfile.profileResolution?.fileHash
      : applyGate.tenantProfile[field])) {
      add(findings, 'MTR-TENANT-004', `tenantProfile.${field} must match the referenced apply gate.`, `tenantProfile.${field}`, 'Restart approval if tenant profile evidence changed.');
    }
  }
  if (input.evidence?.keyFingerprint !== applyGate?.keyFingerprint?.applyFingerprint) {
    add(findings, 'MTR-TENANT-004', 'evidence.keyFingerprint must match the apply gate apply fingerprint.', 'evidence.keyFingerprint', 'Restart approval if the tenant key fingerprint changed.');
  }
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
  if (input.liveApplyAuthorizedByThisRecord !== false) {
    add(findings, 'MTR-API-APPROVAL-004', 'liveApplyAuthorizedByThisRecord must be false.', 'liveApplyAuthorizedByThisRecord', 'Durable approval records must not claim current-turn live apply authorization.');
  }
  if (input.authorization?.currentTurnAuthorizationRequired !== true) {
    add(findings, 'MTR-API-APPROVAL-004', 'authorization.currentTurnAuthorizationRequired must be true.', 'authorization.currentTurnAuthorizationRequired', 'Future live apply still needs explicit current-turn authorization.');
  }
  if (input.authorization?.currentTurnAuthorizationCaptured !== false) {
    add(findings, 'MTR-API-APPROVAL-004', 'authorization.currentTurnAuthorizationCaptured must be false.', 'authorization.currentTurnAuthorizationCaptured', 'Do not store current-turn authorization in durable approval records.');
  }
  if (input.authorization?.liveApplyAuthorizedByThisRecord !== false) {
    add(findings, 'MTR-API-APPROVAL-004', 'authorization.liveApplyAuthorizedByThisRecord must be false.', 'authorization.liveApplyAuthorizedByThisRecord', 'This record is approval evidence, not an execution token.');
  }
  if (input.futureApply?.enabledInCurrentCli !== false) {
    add(findings, 'MTR-API-APPROVAL-004', 'futureApply.enabledInCurrentCli must be false.', 'futureApply.enabledInCurrentCli', 'Approval records must not enable expert API apply execution.');
  }
}

function validateApiApprovalRecord(input, options = {}) {
  const rootDir = options.rootDir || process.cwd();
  const findings = [];
  scanForSecrets(input, findings);

  if (!isObject(input)) {
    return {
      schemaVersion: API_APPROVAL_RECORD_VALIDATION_SCHEMA_VERSION,
      valid: false,
      apiAccess: 'none',
      liveExecution: clone(LOCAL_ONLY_LIVE_EXECUTION),
      applyEnabledInCurrentCli: false,
      liveApplyAuthorizedByThisRecord: false,
      findings: [finding('MTR-API-APPROVAL-000', 'error', 'API approval record must be a JSON object.', '$', 'Start from metro api approval-record template.')],
      summary: { endpointId: null, tenant: null },
    };
  }

  if (input.schemaVersion !== API_APPROVAL_RECORD_SCHEMA_VERSION) {
    add(findings, 'MTR-API-APPROVAL-001', `schemaVersion must be ${API_APPROVAL_RECORD_SCHEMA_VERSION}.`, 'schemaVersion', 'Use the API approval-record schema.');
  }
  if (input.apiAccess !== 'none') {
    add(findings, 'MTR-API-APPROVAL-004', 'apiAccess must remain none.', 'apiAccess', 'Approval records must not claim live API access.');
  }
  if (input.applyEnabledInCurrentCli !== false) {
    add(findings, 'MTR-API-APPROVAL-004', 'applyEnabledInCurrentCli must be false.', 'applyEnabledInCurrentCli', 'Do not mark expert API apply enabled until a guarded runner exists.');
  }
  if (input.liveExecution?.enabledInCurrentCli !== false) {
    add(findings, 'MTR-API-APPROVAL-004', 'liveExecution.enabledInCurrentCli must be false.', 'liveExecution.enabledInCurrentCli', 'This CLI release must keep expert API live execution disabled.');
  }

  const endpoint = getApiEndpoint(input.binding?.endpointId || input.endpoint?.id);
  if (!endpoint) {
    add(findings, 'MTR-ENDPOINT-001', 'binding.endpointId must name a reviewed API endpoint.', 'binding.endpointId', 'Use metro api catalog to choose a reviewed endpoint ID.');
  }
  const policy = endpoint ? approvalPolicyForEndpoint(endpoint) : null;
  if (endpoint && endpoint.operationType !== 'write') {
    add(findings, 'MTR-API-APPROVAL-001', 'approval records are currently defined for write endpoints only.', 'binding.endpointId', 'Use read-gate authorization evidence for read endpoints.');
  }
  if (!policy) {
    add(findings, 'MTR-API-APPROVAL-003', 'approval policy for endpoint permission scope is missing.', 'policy.scope', 'Add local approval policy coverage before approval records can pass.');
  }

  validateBinding(input, endpoint, findings);
  validateEndpointSnapshot(input, endpoint, findings);
  const applyGateEvidence = validateApplyGateFile(input, endpoint, rootDir, findings);
  validateApproval(input, endpoint, policy, applyGateEvidence?.parsed, findings);
  validateEvidence(input, applyGateEvidence?.parsed, findings);
  validateTenantAndConfirmation(input, applyGateEvidence?.parsed, findings);
  validateAuthorization(input, findings);

  const valid = !findings.some((item) => item.severity === 'error');
  return {
    schemaVersion: API_APPROVAL_RECORD_VALIDATION_SCHEMA_VERSION,
    generatedFrom: 'packages/metro-core/src/api-catalog/approval-record.js',
    apiAccess: 'none',
    liveExecution: clone(LOCAL_ONLY_LIVE_EXECUTION),
    applyEnabledInCurrentCli: false,
    liveApplyAuthorizedByThisRecord: false,
    summary: {
      endpointId: input.binding?.endpointId || input.endpoint?.id || null,
      tenant: input.binding?.tenant || null,
      operationType: input.binding?.operationType || endpoint?.operationType || null,
      permissionScope: input.binding?.permissionScope || endpoint?.permissionScope || null,
      approvalId: input.approval?.approvalId || null,
      approvalStatus: input.approval?.status || input.status || null,
      payloadHash: input.binding?.payloadHash || null,
      requestHash: input.binding?.requestHash || null,
      applyGateFileHash: applyGateEvidence?.fileHash || input.applyGate?.fileHash || null,
      sandboxProofFileHash: input.evidence?.sandboxProofFileHash || null,
      keyFingerprint: input.tenantProfile?.keyFingerprint || null,
      liveApplyAuthorizedByThisRecord: false,
    },
    valid,
    findings,
    nextSafeStep: valid
      ? 'Keep this as durable local approval evidence. It still does not authorize live expert API apply without a guarded runner and explicit current-turn authorization.'
      : 'Fix the API approval record and re-run metro api approval-record validate before using it as future expert API apply evidence.',
  };
}

module.exports = {
  API_APPROVAL_RECORD_SCHEMA_VERSION,
  API_APPROVAL_RECORD_VALIDATION_SCHEMA_VERSION,
  apiApprovalRecordCoverage,
  buildApiApprovalRecordTemplate,
  validateApiApprovalRecord,
};
