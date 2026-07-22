'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { getApiEndpoint, listApiEndpoints } = require('./index');
const {
  buildProfileResolutionSection,
  keyEnvForTenant,
  profileResolutionIsUsable,
  validateProfileResolutionEvidence,
} = require('./profile-resolution');
const { API_READ_PLAN_SCHEMA_VERSION } = require('./read-plan');
const { LIVE_READ_CONFIRMATION } = require('../clients/metronome-read');
const { isLiveReadEndpoint } = require('../clients/live-endpoints');

const API_READ_GATE_SCHEMA_VERSION = 'metro.api.read-gate.v1';
const API_READ_GATE_VALIDATION_SCHEMA_VERSION = 'metro.api.read-gate.validation.v1';

const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const SECRET_KEY_PATTERN = /(?:api[_-]?key|secret|token|authorization|password|private[_-]?key|bearer)/i;
const SECRET_VALUE_PATTERN = /(?:bearer\s+[A-Za-z0-9._-]+|sk_live_[A-Za-z0-9]+|sk_test_[A-Za-z0-9]+|rk_live_[A-Za-z0-9]+|prod_[A-Za-z0-9]{12,})/i;

const LOCAL_ONLY_LIVE_EXECUTION = {
  enabledInCurrentCli: false,
  reason: 'Expert API read-gate evidence is local only; the current CLI does not load Metronome API clients or run expert API read commands.',
  nextSafeStep: 'Validate the read-gate evidence locally. Future expert API read remains disabled until guarded runners, current-turn authorization, audit-safe summaries, and stable output verification exist.',
};

function liveExecutionForReadGate(endpointId) {
  if (isLiveReadEndpoint(endpointId)) {
    return {
      enabledInCurrentCli: true,
      reason: 'Guarded live read is enabled for this allowlisted endpoint when read-gate evidence, tenant key configuration, and current-turn confirmation are satisfied.',
      nextSafeStep: 'Complete read-gate validation, then run metro api read with --confirm-live-read and current-turn authorization.',
    };
  }
  return clone(LOCAL_ONLY_LIVE_EXECUTION);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function list(value) {
  return Array.isArray(value) ? value : [];
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

function tenantFlag(tenant) {
  if (tenant === 'production') return '--prod';
  if (tenant === 'sandbox') return '--sandbox';
  return '(--sandbox|--prod)';
}

function finding(id, severity, message, pathName, remediation) {
  return { id, severity, message, path: pathName, remediation };
}

function add(findings, id, message, pathName, remediation, severity = 'error') {
  findings.push(finding(id, severity, message, pathName, remediation));
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
  if (!resolved) return 'sha256:<64 lowercase hex read-plan file hash>';
  try {
    return hashFile(resolved);
  } catch {
    return 'sha256:<64 lowercase hex read-plan file hash>';
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
        `API read-gate evidence appears to contain a secret-like value at ${pathName}.`,
        pathName,
        'Store environment variable names, hashes, approval IDs, or non-secret fingerprints only.',
      );
    }
    return;
  }

  if (!isObject(value)) return;

  for (const [key, child] of Object.entries(value)) {
    const childPath = pathName === '$' ? key : `${pathName}.${key}`;
    if (SECRET_KEY_PATTERN.test(key) && !['keyFingerprint', 'secretScanRequired'].includes(key)) {
      add(
        findings,
        'MTR-APIREQ-003',
        `API read-gate evidence contains forbidden secret-shaped field ${childPath}.`,
        childPath,
        'Never store raw API keys, bearer tokens, passwords, or Authorization headers in read-gate manifests.',
      );
    }
    scanForSecrets(child, findings, childPath);
  }
}

function requireFilled(findings, value, pathName, message, remediation, id = 'MTR-API-READ-GATE-001') {
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

function validateFileEvidence(section, pathName, rootDir, findings) {
  if (!isObject(section)) {
    add(findings, 'MTR-API-READ-GATE-001', `${pathName} evidence is required.`, pathName, 'Start from metro api read-gate template and keep the evidence section.');
    return null;
  }
  requireFilled(findings, section.filePath, `${pathName}.filePath`, `${pathName}.filePath is required.`, 'Point to the reviewed local read-plan JSON file.');
  validateHash(findings, section.fileHash, `${pathName}.fileHash`, 'Hash the reviewed local read-plan file and record the sha256 value.');

  const resolved = resolveLocalPath(section.filePath, rootDir);
  if (!resolved) return null;

  try {
    const actualHash = hashFile(resolved);
    if (isSha256(section.fileHash) && section.fileHash !== actualHash) {
      add(
        findings,
        'MTR-HASH-002',
        `${pathName}.fileHash does not match the current file contents.`,
        `${pathName}.fileHash`,
        'Re-review the changed file and update the hash only after confirming the read-plan evidence is intended.',
      );
    }
    return {
      fileHash: actualHash,
      parsed: readJsonFile(resolved),
    };
  } catch (error) {
    add(
      findings,
      'MTR-API-READ-GATE-006',
      `Failed to read or parse ${pathName} evidence: ${error.message}`,
      `${pathName}.filePath`,
      'Use a readable local JSON read-plan evidence file.',
    );
    return null;
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

function bindingFromReadPlan(readPlan) {
  return {
    endpointId: readPlan.endpoint?.id,
    tenant: readPlan.tenant,
    operationType: readPlan.endpoint?.operationType,
    permissionScope: readPlan.endpoint?.permissionScope,
    requestHash: readPlan.requestSummary?.requestHash,
    readPlanSchemaVersion: readPlan.schemaVersion,
    validationSchemaVersion: readPlan.validation?.schemaVersion,
    validationValid: readPlan.validation?.valid === true,
    sourceIds: clone(readPlan.endpoint?.sourceIds || []),
  };
}

function readPlanIsUsable(readPlan) {
  const endpointId = readPlan?.endpoint?.id;
  const liveEnabled = isLiveReadEndpoint(endpointId);
  return isObject(readPlan)
    && readPlan.schemaVersion === API_READ_PLAN_SCHEMA_VERSION
    && readPlan.blocked !== true
    && readPlan.validation?.valid === true
    && readPlan.endpoint?.operationType === 'read'
    && ['sandbox', 'production'].includes(readPlan.tenant)
    && isSha256(readPlan.requestSummary?.requestHash)
    && readPlan.liveReadSupported === liveEnabled
    && readPlan.liveExecution?.enabledInCurrentCli === liveEnabled;
}

function apiReadGateCoverage() {
  return listApiEndpoints().reduce((coverage, endpoint) => {
    const isReadEndpoint = endpoint.operationType === 'read';
    coverage[endpoint.id] = {
      schemaVersion: API_READ_GATE_SCHEMA_VERSION,
      supportStatus: isReadEndpoint ? 'local-read-gate-manifest' : 'not-read-endpoint',
      command: 'metro api read-gate template --read-plan <api-read-plan.json> [--profile-resolution <profile-resolution.json>] [--profile <profile>] [--key-env <env>] [--key-fingerprint <fingerprint>] [--authorization-id <id>] [--approved-by <name>] [--audit-log <path>] [--json]',
      validationCommand: 'metro api read-gate validate --file <api-read-gate.json> [--json]',
      apiAccess: 'none',
      requiresReadPlan: `metro api read-plan ${endpoint.id} --file <request.json|yaml> (--sandbox|--prod) [--json]`,
      readEnabledInCurrentCli: isLiveReadEndpoint(endpoint.id),
      requiredEvidence: isReadEndpoint
        ? ['reviewed-read-plan-file-hash', 'tenant-profile-binding', 'tenant-profile-resolution-file-hash', 'current-turn-authorization', 'audit-safe-request-summary', 'stable-output-verification']
        : [],
    };
    return coverage;
  }, {});
}

function buildApiReadGateTemplate(options = {}) {
  const {
    readPlan,
    readPlanPath,
    profileResolution = null,
    profileResolutionPath = null,
    profile = null,
    keyEnv = null,
    keyFingerprint = null,
    authorizationId = null,
    approvedBy = null,
    auditLog = null,
    rootDir = process.cwd(),
  } = options;

  if (!readPlanIsUsable(readPlan)) return null;
  const endpoint = getApiEndpoint(readPlan.endpoint?.id);
  if (!endpoint || endpoint.operationType !== 'read') return null;
  if (profileResolution && !profileResolutionIsUsable(profileResolution, readPlan.tenant)) return null;
  const flag = tenantFlag(readPlan.tenant);
  const resolvedProfile = profileResolution?.tenantProfile || {};

  const liveEnabled = isLiveReadEndpoint(endpoint.id);

  return {
    schemaVersion: API_READ_GATE_SCHEMA_VERSION,
    generatedFrom: 'metronome-cli/src/api-catalog/read-gate.js',
    apiAccess: 'none',
    liveExecution: liveExecutionForReadGate(endpoint.id),
    readEnabledInCurrentCli: liveEnabled,
    status: 'template',
    binding: bindingFromReadPlan(readPlan),
    endpoint: endpointSnapshot(endpoint),
    readPlan: {
      filePath: readPlanPath || '<path-to-reviewed-api-read-plan-json>',
      fileHash: hashFileIfReadable(readPlanPath, rootDir),
      requestHash: readPlan.requestSummary.requestHash,
      validationResult: 'passed',
    },
    tenantProfile: {
      profileName: resolvedProfile.profileName || profile || '<profile-name>',
      tenant: readPlan.tenant,
      keyEnv: resolvedProfile.keyEnv || keyEnv || keyEnvForTenant(readPlan.tenant),
      keyFingerprint: resolvedProfile.keyFingerprint || keyFingerprint || '<non-secret tenant key fingerprint>',
      profileBindingConfirmed: Boolean(profileResolution),
      profileResolution: buildProfileResolutionSection({
        profileResolutionPath,
        rootDir,
        valid: Boolean(profileResolution),
      }),
    },
    liveReadApproval: {
      status: 'pending',
      approvalId: authorizationId || '<current-turn-authorization-id>',
      approvedBy: approvedBy || '<current-turn-requester-or-reviewer>',
      currentTurnConfirmed: false,
      confirmationPhrase: '<confirm-live-read phrase>',
      requestHash: readPlan.requestSummary.requestHash,
      permissionScope: endpoint.permissionScope,
    },
    audit: {
      status: 'pending',
      auditLogPath: auditLog || '<jsonl-read-audit-log-path>',
      requestSummaryStrategy: 'hash-and-field-names-only',
      rawRequestBodyStored: false,
      secretScanRequired: true,
    },
    outputVerification: {
      status: 'pending',
      outputContractSummary: readPlan.outputContract?.summary || endpoint.responseContract.summary,
      checks: clone(readPlan.verificationPlan || []),
      verifierImplementedInCurrentCli: liveEnabled,
    },
    guardedRunner: {
      implementedInCurrentCli: liveEnabled,
      requiresGuardedClient: true,
      requiresReadOnlyEndpointAssertion: true,
      requiresInjectedOrTenantProfileTransport: true,
    },
    futureRead: {
      enabledInCurrentCli: liveEnabled,
      command: `metro api read ${endpoint.id} --file <request.json|yaml> ${flag} --read-gate <api-read-gate.json> --confirm-live-read <token>`,
      blockedBy: liveEnabled
        ? [
          'validated read-gate evidence',
          'tenant key configuration',
          'current-turn authorization for the exact request hash',
        ]
        : [
          'guarded expert API read runner',
          'validated tenant profile/key fingerprint binding',
          'current-turn authorization for the exact request hash',
          'audit-safe request summaries',
          'stable output verification',
        ],
    },
    validationCommand: 'metro api read-gate validate --file <api-read-gate.json> [--json]',
    nextSafeStep: liveEnabled
      ? 'Fill every required evidence section, then run metro api read-gate validate --file <api-read-gate.json> --json before metro api read with current-turn confirmation.'
      : 'Fill every required evidence section, then run metro api read-gate validate --file <api-read-gate.json> --json. Expert API read remains disabled for this endpoint in the current CLI.',
    sources: clone(readPlan.sources || endpoint.sources),
  };
}

function validateBinding(input, endpoint, findings) {
  const binding = input.binding;
  if (!isObject(binding)) {
    add(findings, 'MTR-API-READ-GATE-001', 'binding is required.', 'binding', 'Start from metro api read-gate template.');
    return;
  }
  if (binding.endpointId !== endpoint?.id) {
    add(findings, 'MTR-ENDPOINT-001', 'binding.endpointId must match the reviewed endpoint catalog.', 'binding.endpointId', 'Use evidence for the exact reviewed endpoint.');
  }
  if (!['sandbox', 'production'].includes(binding.tenant)) {
    add(findings, 'MTR-TENANT-001', 'binding.tenant must be sandbox or production.', 'binding.tenant', 'Use a read plan generated with exactly one tenant flag.');
  }
  if (binding.operationType !== 'read') {
    add(findings, 'MTR-ENDPOINT-001', 'binding.operationType must be read.', 'binding.operationType', 'Generate read gates only from reviewed read endpoint plans.');
  }
  if (binding.permissionScope !== endpoint?.permissionScope) {
    add(findings, 'MTR-ENDPOINT-001', 'binding.permissionScope must match the endpoint catalog.', 'binding.permissionScope', 'Regenerate the read gate from the current endpoint catalog.');
  }
  if (binding.readPlanSchemaVersion !== API_READ_PLAN_SCHEMA_VERSION) {
    add(findings, 'MTR-API-READ-GATE-001', `binding.readPlanSchemaVersion must be ${API_READ_PLAN_SCHEMA_VERSION}.`, 'binding.readPlanSchemaVersion', 'Use metro api read-plan output.');
  }
  if (binding.validationSchemaVersion !== 'metro.api.validation.v1' || binding.validationValid !== true) {
    add(findings, 'MTR-APIREQ-001', 'binding must prove a passing metro.api.validation.v1 result.', 'binding.validationValid', 'Re-run metro api read-plan with valid local request input.');
  }
  validateHash(findings, binding.requestHash, 'binding.requestHash', 'Use the requestHash emitted by metro api read-plan.');
  const sourceIds = list(binding.sourceIds);
  if (!sourceIds.includes('endpoint-matrix')) {
    add(findings, 'MTR-ENDPOINT-001', 'binding.sourceIds must include endpoint-matrix.', 'binding.sourceIds', 'Use reviewed endpoint IDs from the local endpoint matrix.');
  }
}

function validateEndpointSnapshot(input, endpoint, findings) {
  if (!isObject(input.endpoint)) {
    add(findings, 'MTR-ENDPOINT-001', 'endpoint snapshot is required.', 'endpoint', 'Start from metro api read-gate template.');
    return;
  }

  for (const field of ['id', 'method', 'path', 'operationType', 'permissionScope']) {
    if (input.endpoint[field] !== endpoint?.[field]) {
      add(findings, 'MTR-ENDPOINT-001', `endpoint.${field} must match the reviewed endpoint catalog.`, `endpoint.${field}`, 'Regenerate the read gate from the current reviewed endpoint catalog.');
    }
  }
  if (input.endpoint.operationType !== 'read') {
    add(findings, 'MTR-ENDPOINT-001', 'endpoint.operationType must be read.', 'endpoint.operationType', 'Read gates can only bind reviewed read endpoints.');
  }
  if (!list(input.endpoint.sourceIds).includes('endpoint-matrix')) {
    add(findings, 'MTR-ENDPOINT-001', 'endpoint.sourceIds must include endpoint-matrix.', 'endpoint.sourceIds', 'Reviewed endpoint IDs must cite the local endpoint matrix.');
  }
}

function validateReadPlanFile(input, endpoint, rootDir, findings) {
  const evidence = validateFileEvidence(input.readPlan, 'readPlan', rootDir, findings);
  const readPlan = evidence?.parsed;
  if (!readPlan) return null;

  if (readPlan.schemaVersion !== API_READ_PLAN_SCHEMA_VERSION) {
    add(findings, 'MTR-API-READ-GATE-001', `readPlan file schemaVersion must be ${API_READ_PLAN_SCHEMA_VERSION}.`, 'readPlan.filePath', 'Use output from metro api read-plan.');
  }
  if (readPlan.blocked === true || readPlan.validation?.valid !== true) {
    add(findings, 'MTR-APIREQ-001', 'readPlan file must be an unblocked API read plan with passing request validation.', 'readPlan.filePath', 'Re-run metro api read-plan with valid local request input.');
  }
  if (readPlan.endpoint?.id !== endpoint?.id) {
    add(findings, 'MTR-ENDPOINT-001', 'readPlan endpoint id must match the read gate endpoint.', 'readPlan.filePath', 'Use read-plan evidence for the exact endpoint.');
  }
  if (readPlan.tenant !== input.binding?.tenant) {
    add(findings, 'MTR-TENANT-001', 'readPlan tenant must match binding.tenant.', 'readPlan.filePath', 'Use read-plan evidence generated for the same tenant.');
  }
  if (readPlan.endpoint?.permissionScope !== endpoint?.permissionScope) {
    add(findings, 'MTR-ENDPOINT-001', 'readPlan permission scope must match the endpoint catalog.', 'readPlan.filePath', 'Regenerate read-plan from the current endpoint catalog.');
  }
  if (readPlan.requestSummary?.requestHash !== input.binding?.requestHash || readPlan.requestSummary?.requestHash !== input.readPlan?.requestHash) {
    add(findings, 'MTR-HASH-002', 'readPlan request hash must match binding.requestHash and readPlan.requestHash.', 'readPlan.requestHash', 'Regenerate the gate if request evidence changed.');
  }
  const liveEnabled = isLiveReadEndpoint(endpoint?.id);
  if (readPlan.liveReadSupported !== liveEnabled || readPlan.liveExecution?.enabledInCurrentCli !== liveEnabled) {
    add(findings, 'MTR-API-READ-GATE-003', 'readPlan live-read flags must match the current CLI allowlist for this endpoint.', 'readPlan.filePath', 'Regenerate read-plan from the current CLI allowlist.');
  }
  if (input.readPlan?.validationResult !== 'passed') {
    add(findings, 'MTR-APIREQ-001', 'readPlan.validationResult must be passed.', 'readPlan.validationResult', 'Only passing local API read-plan evidence can satisfy a read gate.');
  }

  return { ...evidence, valid: readPlan.schemaVersion === API_READ_PLAN_SCHEMA_VERSION && readPlan.validation?.valid === true };
}

function validateTenantProfile(input, findings) {
  const profile = input.tenantProfile;
  if (!isObject(profile)) {
    add(findings, 'MTR-TENANT-001', 'tenantProfile is required.', 'tenantProfile', 'Bind the read gate to one reviewed tenant profile.');
    return;
  }
  requireFilled(findings, profile.profileName, 'tenantProfile.profileName', 'tenantProfile.profileName is required.', 'Record the named tenant profile that a future runner would use.', 'MTR-TENANT-001');
  if (profile.tenant !== input.binding?.tenant) {
    add(findings, 'MTR-TENANT-001', 'tenantProfile.tenant must match binding.tenant.', 'tenantProfile.tenant', 'Use one tenant consistently across the read plan and read gate.');
  }
  requireFilled(findings, profile.keyEnv, 'tenantProfile.keyEnv', 'tenantProfile.keyEnv is required.', 'Record the environment variable name only, never its value.', 'MTR-TENANT-001');
  requireFilled(findings, profile.keyFingerprint, 'tenantProfile.keyFingerprint', 'tenantProfile.keyFingerprint is required.', 'Record a non-secret key fingerprint, never the raw key.', 'MTR-TENANT-004');
  if (profile.profileBindingConfirmed !== true) {
    add(findings, 'MTR-TENANT-001', 'tenantProfile.profileBindingConfirmed must be true.', 'tenantProfile.profileBindingConfirmed', 'Review the profile/tenant binding before future live read evidence can pass.');
  }
  if (input.binding?.tenant === 'production' && !/PROD|PRODUCTION/.test(String(profile.keyEnv || ''))) {
    add(findings, 'MTR-TENANT-001', 'production read gate must name a production Metronome key environment variable.', 'tenantProfile.keyEnv', 'Use a production-scoped key env var name such as METRONOME_PROD_KEY.');
  }
  if (input.binding?.tenant === 'sandbox' && !/SANDBOX|TEST/.test(String(profile.keyEnv || ''))) {
    add(findings, 'MTR-TENANT-001', 'sandbox read gate must name a sandbox Metronome key environment variable.', 'tenantProfile.keyEnv', 'Use a sandbox-scoped key env var name such as METRONOME_SANDBOX_KEY.');
  }
}

function validateLiveReadApproval(input, findings) {
  const approval = input.liveReadApproval;
  if (!isObject(approval)) {
    add(findings, 'MTR-LIVE-READ-001', 'liveReadApproval is required.', 'liveReadApproval', 'Record current-turn authorization for the exact read hash.');
    return;
  }
  if (approval.status !== 'authorized') {
    add(findings, 'MTR-LIVE-READ-001', 'liveReadApproval.status must be authorized.', 'liveReadApproval.status', 'Do not mark the read gate valid without explicit current-turn authorization.');
  }
  requireFilled(findings, approval.approvalId, 'liveReadApproval.approvalId', 'liveReadApproval.approvalId is required.', 'Record the current-turn authorization or approval ID.', 'MTR-LIVE-READ-001');
  requireFilled(findings, approval.approvedBy, 'liveReadApproval.approvedBy', 'liveReadApproval.approvedBy is required.', 'Record who authorized the exact live read.', 'MTR-LIVE-READ-001');
  if (approval.currentTurnConfirmed !== true) {
    add(findings, 'MTR-LIVE-READ-001', 'liveReadApproval.currentTurnConfirmed must be true.', 'liveReadApproval.currentTurnConfirmed', 'Authorization must be explicit in the current user turn.');
  }
  if (approval.confirmationPhrase !== LIVE_READ_CONFIRMATION) {
    add(findings, 'MTR-LIVE-READ-001', 'liveReadApproval.confirmationPhrase must equal the guarded read-client confirmation phrase.', 'liveReadApproval.confirmationPhrase', 'Use the exact confirmation phrase required by the guarded read client.');
  }
  if (approval.requestHash !== input.binding?.requestHash) {
    add(findings, 'MTR-HASH-002', 'liveReadApproval.requestHash must match binding.requestHash.', 'liveReadApproval.requestHash', 'Bind authorization to the exact reviewed read-plan request hash.');
  }
  if (approval.permissionScope !== input.binding?.permissionScope) {
    add(findings, 'MTR-ENDPOINT-001', 'liveReadApproval.permissionScope must match binding.permissionScope.', 'liveReadApproval.permissionScope', 'Bind authorization to the exact permission scope.');
  }
}

function validateAudit(input, findings) {
  const audit = input.audit;
  if (!isObject(audit)) {
    add(findings, 'MTR-AUDIT-001', 'audit is required.', 'audit', 'Record audit-safe summary behavior before future live reads.');
    return;
  }
  if (audit.status !== 'ready') {
    add(findings, 'MTR-AUDIT-001', 'audit.status must be ready.', 'audit.status', 'Review audit destination and secret-free summary strategy.');
  }
  requireFilled(findings, audit.auditLogPath, 'audit.auditLogPath', 'audit.auditLogPath is required.', 'Record the JSONL read audit log path a future runner must write.', 'MTR-AUDIT-001');
  if (audit.requestSummaryStrategy !== 'hash-and-field-names-only') {
    add(findings, 'MTR-AUDIT-001', 'audit.requestSummaryStrategy must be hash-and-field-names-only.', 'audit.requestSummaryStrategy', 'Store request hashes and field names only; do not persist raw request bodies by default.');
  }
  if (audit.rawRequestBodyStored !== false) {
    add(findings, 'MTR-AUDIT-001', 'audit.rawRequestBodyStored must be false.', 'audit.rawRequestBodyStored', 'Do not store raw request bodies in read audit evidence.');
  }
  if (audit.secretScanRequired !== true) {
    add(findings, 'MTR-AUDIT-001', 'audit.secretScanRequired must be true.', 'audit.secretScanRequired', 'Keep secret scanning required before future live read execution.');
  }
}

function validateOutputVerification(input, endpoint, findings) {
  const verification = input.outputVerification;
  const liveEnabled = isLiveReadEndpoint(endpoint?.id);
  if (!isObject(verification)) {
    add(findings, 'MTR-VERIFY-001', 'outputVerification is required.', 'outputVerification', 'Carry forward stable output verification checks from the read plan.');
    return;
  }
  if (verification.status !== 'ready') {
    add(findings, 'MTR-VERIFY-001', 'outputVerification.status must be ready.', 'outputVerification.status', 'Review output expectations before future live reads.');
  }
  requireFilled(findings, verification.outputContractSummary, 'outputVerification.outputContractSummary', 'outputVerification.outputContractSummary is required.', 'Record the stable output contract summary.', 'MTR-VERIFY-001');
  if (!list(verification.checks).some((check) => filled(check?.expectation))) {
    add(findings, 'MTR-VERIFY-001', 'outputVerification.checks must include at least one expectation.', 'outputVerification.checks', 'Record verification checks before future live execution can be approved.');
  }
  if (verification.verifierImplementedInCurrentCli !== liveEnabled) {
    add(findings, 'MTR-VERIFY-001', 'outputVerification.verifierImplementedInCurrentCli must match the current CLI allowlist for this endpoint.', 'outputVerification.verifierImplementedInCurrentCli', 'Regenerate the read gate from the current CLI allowlist.');
  }
}

function validateGuardedRunner(input, endpoint, findings) {
  const runner = input.guardedRunner;
  const liveEnabled = isLiveReadEndpoint(endpoint?.id);
  if (!isObject(runner)) {
    add(findings, 'MTR-CLIENT-001', 'guardedRunner is required.', 'guardedRunner', 'Record guarded runner requirements before future live reads.');
    return;
  }
  if (runner.implementedInCurrentCli !== liveEnabled) {
    add(findings, 'MTR-CLIENT-001', 'guardedRunner.implementedInCurrentCli must match the current CLI allowlist for this endpoint.', 'guardedRunner.implementedInCurrentCli', 'Regenerate the read gate from the current CLI allowlist.');
  }
  for (const field of ['requiresGuardedClient', 'requiresReadOnlyEndpointAssertion', 'requiresInjectedOrTenantProfileTransport']) {
    if (runner[field] !== true) {
      add(findings, 'MTR-CLIENT-001', `guardedRunner.${field} must be true.`, `guardedRunner.${field}`, 'Future live reads must use guarded clients and read-only endpoint assertions.');
    }
  }
  if (input.futureRead?.enabledInCurrentCli !== liveEnabled) {
    add(findings, 'MTR-API-READ-GATE-003', 'futureRead.enabledInCurrentCli must match the current CLI allowlist for this endpoint.', 'futureRead.enabledInCurrentCli', 'Regenerate the read gate from the current CLI allowlist.');
  }
}

function validateApiReadGate(input, options = {}) {
  const rootDir = options.rootDir || process.cwd();
  const findings = [];
  scanForSecrets(input, findings);

  if (!isObject(input)) {
    return {
      schemaVersion: API_READ_GATE_VALIDATION_SCHEMA_VERSION,
      valid: false,
      apiAccess: 'none',
      liveExecution: clone(LOCAL_ONLY_LIVE_EXECUTION),
      readEnabledInCurrentCli: false,
      findings: [finding('MTR-API-READ-GATE-000', 'error', 'API read-gate manifest must be a JSON object.', '$', 'Start from metro api read-gate template.')],
      summary: { readPlanValidated: false },
    };
  }

  if (input.schemaVersion !== API_READ_GATE_SCHEMA_VERSION) {
    add(findings, 'MTR-API-READ-GATE-001', `schemaVersion must be ${API_READ_GATE_SCHEMA_VERSION}.`, 'schemaVersion', 'Start from the current metro api read-gate template.');
  }
  if (input.apiAccess !== 'none') {
    add(findings, 'MTR-API-READ-GATE-003', 'apiAccess must remain none.', 'apiAccess', 'Expert API read-gate evidence must not claim live API access.');
  }
  if (input.status !== 'reviewed') {
    add(findings, 'MTR-API-READ-GATE-001', 'status must be reviewed.', 'status', 'Only reviewed read-gate manifests can pass validation.');
  }

  const endpoint = getApiEndpoint(input.binding?.endpointId || input.endpoint?.id);
  const liveEnabled = isLiveReadEndpoint(endpoint?.id);
  if (input.readEnabledInCurrentCli !== liveEnabled) {
    add(findings, 'MTR-API-READ-GATE-003', 'readEnabledInCurrentCli must match the current CLI allowlist for this endpoint.', 'readEnabledInCurrentCli', 'Regenerate the read gate from the current CLI allowlist.');
  }
  if (input.liveExecution?.enabledInCurrentCli !== liveEnabled) {
    add(findings, 'MTR-API-READ-GATE-003', 'liveExecution.enabledInCurrentCli must match the current CLI allowlist for this endpoint.', 'liveExecution.enabledInCurrentCli', 'Regenerate the read gate from the current CLI allowlist.');
  }
  if (!endpoint) {
    add(findings, 'MTR-ENDPOINT-001', 'binding.endpointId must name a reviewed API endpoint.', 'binding.endpointId', 'Use metro api catalog to choose a reviewed endpoint ID.');
  } else if (endpoint.operationType !== 'read') {
    add(findings, 'MTR-ENDPOINT-001', 'read gate endpoint must be operationType read.', 'binding.endpointId', 'Use metro api read-plan for a reviewed read endpoint.');
  }

  validateBinding(input, endpoint, findings);
  validateEndpointSnapshot(input, endpoint, findings);
  const readPlanEvidence = validateReadPlanFile(input, endpoint, rootDir, findings);
  validateTenantProfile(input, findings);
  const profileResolutionValidated = validateProfileResolutionEvidence({
    input,
    rootDir,
    findings,
    addFinding: (id, message, pathName, remediation) => add(findings, id, message, pathName, remediation),
    scanForSecrets,
    required: false,
    localOnlyFindingId: 'MTR-API-READ-GATE-003',
    targetLabel: 'read gate',
    expectedTenant: input.binding?.tenant,
    expectedTenantPath: 'binding.tenant',
    consistencyContext: 'profile resolution, read plan, and read gate',
    objectRequiredMessage: 'tenantProfile.profileResolution must be an object when provided.',
  });
  const profileResolutionProvided = input.tenantProfile?.profileResolution !== undefined;
  validateLiveReadApproval(input, findings);
  validateAudit(input, findings);
  validateOutputVerification(input, endpoint, findings);
  validateGuardedRunner(input, endpoint, findings);

  const valid = !findings.some((item) => item.severity === 'error');
  return {
    schemaVersion: API_READ_GATE_VALIDATION_SCHEMA_VERSION,
    generatedFrom: 'metronome-cli/src/api-catalog/read-gate.js',
    apiAccess: 'none',
    liveExecution: liveExecutionForReadGate(endpoint?.id),
    readEnabledInCurrentCli: liveEnabled,
    summary: {
      endpointId: input.binding?.endpointId || input.endpoint?.id || null,
      tenant: input.binding?.tenant || null,
      operationType: input.binding?.operationType || endpoint?.operationType || null,
      permissionScope: input.binding?.permissionScope || endpoint?.permissionScope || null,
      requestHash: input.binding?.requestHash || null,
      readPlanFileHash: readPlanEvidence?.fileHash || input.readPlan?.fileHash || null,
      readPlanValidated: Boolean(readPlanEvidence?.valid),
      tenantProfileBound: input.tenantProfile?.profileBindingConfirmed === true,
      ...(profileResolutionProvided ? { tenantProfileResolutionValidated: profileResolutionValidated } : {}),
      currentTurnAuthorized: input.liveReadApproval?.currentTurnConfirmed === true,
      auditReady: input.audit?.status === 'ready',
      outputVerificationReady: input.outputVerification?.status === 'ready',
    },
    valid,
    findings,
    nextSafeStep: valid
      ? 'Keep this as local read-gate evidence. Expert API read remains disabled until a guarded runner, audit writer, and stable output verifier are implemented and explicitly authorized.'
      : 'Fix the API read-gate manifest and re-run metro api read-gate validate before considering any future expert API live read approval.',
  };
}

module.exports = {
  API_READ_GATE_SCHEMA_VERSION,
  API_READ_GATE_VALIDATION_SCHEMA_VERSION,
  apiReadGateCoverage,
  buildApiReadGateTemplate,
  validateApiReadGate,
};
