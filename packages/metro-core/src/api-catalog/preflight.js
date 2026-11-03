'use strict';

const { getApiEndpoint, listApiEndpoints } = require('./index');
const {
  buildProfileResolutionSection,
  keyEnvForTenant,
  profileResolutionIsUsable,
  validateProfileResolutionEvidence,
} = require('./profile-resolution');
const { API_PREVIEW_SCHEMA_VERSION } = require('./preview');

const API_PREFLIGHT_SCHEMA_VERSION = 'metro.api.preflight.v1';
const API_PREFLIGHT_VALIDATION_SCHEMA_VERSION = 'metro.api.preflight.validation.v1';

const SECRET_KEY_PATTERN = /(?:api[_-]?key|secret|token|authorization|password|private[_-]?key|bearer)/i;
const SECRET_VALUE_PATTERN = /(?:bearer\s+[A-Za-z0-9._-]+|sk_live_[A-Za-z0-9]+|sk_test_[A-Za-z0-9]+|rk_live_[A-Za-z0-9]+|prod_[A-Za-z0-9]{12,})/i;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;

const LOCAL_ONLY_LIVE_EXECUTION = {
  enabledInCurrentCli: false,
  reason: 'Expert API preflight is local evidence only; the current CLI does not load Metronome API clients or run expert API apply commands.',
  nextSafeStep: 'Validate the preflight evidence locally. Future expert API apply remains disabled until guarded runners, approval, audit, sandbox proof, and read-back verification exist.',
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

function tenantFlag(tenant) {
  if (tenant === 'production') return '--prod';
  if (tenant === 'sandbox') return '--sandbox';
  return '(--sandbox|--prod)';
}

function finding(id, severity, message, path, remediation) {
  return { id, severity, message, path, remediation };
}

function add(findings, id, message, path, remediation, severity = 'error') {
  findings.push(finding(id, severity, message, path, remediation));
}

function scanForSecrets(value, findings, pathName = '$') {
  if (typeof value === 'string') {
    if (SECRET_VALUE_PATTERN.test(value)) {
      add(
        findings,
        'MTR-APIREQ-003',
        `Expert API preflight appears to contain a secret-like value at ${pathName}.`,
        pathName,
        'Store environment variable names, hashes, approval IDs, or non-secret fingerprints only.',
      );
    }
    return;
  }

  if (!isObject(value)) return;

  for (const [key, child] of Object.entries(value)) {
    const childPath = pathName === '$' ? key : `${pathName}.${key}`;
    if (SECRET_KEY_PATTERN.test(key)) {
      add(
        findings,
        'MTR-APIREQ-003',
        `Expert API preflight contains forbidden secret-shaped field ${childPath}.`,
        childPath,
        'Never store raw API keys, tokens, passwords, or Authorization headers in preflight evidence.',
      );
    }
    scanForSecrets(child, findings, childPath);
  }
}

function requireFilled(findings, value, pathName, message, remediation) {
  if (!filled(value)) {
    add(findings, 'MTR-PREFLIGHT-001', message, pathName, remediation);
  }
}

function requireStatus(findings, section, pathName, allowed) {
  if (!allowed.includes(section?.status)) {
    add(
      findings,
      'MTR-PREFLIGHT-001',
      `${pathName}.status must be one of ${allowed.join(', ')}.`,
      `${pathName}.status`,
      'Fill the evidence section with a reviewed status before validating the API preflight.',
    );
  }
}

function hasReviewedSource(sourceIds) {
  return list(sourceIds).some((sourceId) => (
    /^official-[a-z0-9-]+$/.test(String(sourceId))
    || ['danger-zone', 'packages-contracts', 'metronome-invoicing', 'metronome-stripe-delivery', 'metronome-ingestion-events'].includes(String(sourceId))
  ));
}

function requiredEvidenceFor(endpoint) {
  const base = [
    {
      id: 'preview-reviewed',
      required: true,
      evidencePath: 'evidence.preview',
      description: 'Reviewer has checked the local api preview output and confirmed the payload hash.',
    },
    {
      id: 'audit-plan',
      required: true,
      evidencePath: 'evidence.audit',
      description: 'Future live operation has a secret-free JSONL audit destination and row schema.',
    },
    {
      id: 'tenant-profile-resolution',
      required: true,
      evidencePath: 'tenantProfile.profileResolution',
      description: 'Secret-free metro setup resolve output binds the selected tenant to the reviewed key env and non-secret key fingerprint.',
    },
  ];

  if (endpoint.operationType !== 'write') {
    return [
      ...base,
      {
        id: 'read-back-plan',
        required: true,
        evidencePath: 'evidence.readBack',
        description: 'Future live read or preview has an output verification plan.',
      },
    ];
  }

  return [
    ...base,
    {
      id: 'approval',
      required: true,
      evidencePath: 'evidence.approval',
      description: 'Owner approval is recorded by ID and bound to the reviewed preview hash.',
    },
    {
      id: 'idempotency',
      required: true,
      evidencePath: 'evidence.idempotency',
      description: 'Create/retry behavior is reviewed so a future apply cannot duplicate contracts, invoices, usage, credits, packages, or customer access.',
    },
    {
      id: 'sandbox-proof',
      required: true,
      evidencePath: 'evidence.sandboxProof',
      description: 'The endpoint has sandbox proof or an explicit sandbox-proof requirement before production apply.',
    },
    {
      id: 'canary-plan',
      required: true,
      evidencePath: 'evidence.canary',
      description: 'Bulk or write-shaped operations have a one-object canary or a documented non-bulk justification.',
    },
    {
      id: 'read-back-plan',
      required: true,
      evidencePath: 'evidence.readBack',
      description: 'Read-back checks prove the Metronome state after a future apply.',
    },
    {
      id: 'rollback-remediation',
      required: true,
      evidencePath: 'evidence.rollback',
      description: 'Rollback or remediation is documented before any future apply runner can use the preview.',
    },
  ];
}

function previewBindingFor(preview) {
  return {
    schemaVersion: preview.schemaVersion,
    endpointId: preview.endpoint?.id,
    tenant: preview.tenant,
    operationType: preview.endpoint?.operationType,
    permissionScope: preview.endpoint?.permissionScope,
    validationSchemaVersion: preview.validation?.schemaVersion,
    validationValid: preview.validation?.valid === true,
    requestHash: preview.requestSummary?.requestHash,
    payloadHash: preview.payloadHash,
    sourceIds: clone(preview.endpoint?.sourceIds || []),
  };
}

function buildApiPreflightTemplate(preview, options = {}) {
  if (!isObject(preview) || preview.schemaVersion !== API_PREVIEW_SCHEMA_VERSION) return null;
  const endpoint = getApiEndpoint(preview.endpoint?.id);
  if (!endpoint) return null;
  if (preview.blocked || preview.validation?.valid !== true || !isSha256(preview.payloadHash) || !isSha256(preview.requestSummary?.requestHash)) return null;
  if (options.profileResolution && !profileResolutionIsUsable(options.profileResolution, preview.tenant)) return null;

  const tenant = preview.tenant;
  const flag = tenantFlag(tenant);
  const requiredEvidence = requiredEvidenceFor(endpoint);
  const resolvedProfile = options.profileResolution?.tenantProfile || {};

  return {
    schemaVersion: API_PREFLIGHT_SCHEMA_VERSION,
    generatedFrom: 'packages/metro-core/src/api-catalog/preflight.js',
    apiAccess: 'none',
    liveExecution: clone(preview.liveExecution || LOCAL_ONLY_LIVE_EXECUTION),
    applyEnabledInCurrentCli: false,
    status: 'template',
    previewBinding: previewBindingFor(preview),
    endpoint: {
      id: endpoint.id,
      method: endpoint.method,
      path: endpoint.path,
      family: endpoint.family,
      operationType: endpoint.operationType,
      supportStatus: endpoint.supportStatus,
      permissionScope: endpoint.permissionScope,
      sourceIds: clone(endpoint.sourceIds),
    },
    tenantProfile: {
      profileName: resolvedProfile.profileName || options.profile || '<profile-name>',
      tenant,
      keyEnv: resolvedProfile.keyEnv || options.keyEnv || keyEnvForTenant(tenant),
      keyFingerprint: resolvedProfile.keyFingerprint || options.keyFingerprint || '<non-secret tenant key fingerprint>',
      profileBindingConfirmed: Boolean(options.profileResolution),
      profileResolution: buildProfileResolutionSection({
        profileResolutionPath: options.profileResolutionPath,
        rootDir: options.rootDir,
        valid: Boolean(options.profileResolution),
      }),
    },
    requiredEvidence,
    evidence: {
      preview: {
        status: 'pending',
        previewOutputPath: options.previewPath || '<path-to-api-preview-json>',
        payloadHash: preview.payloadHash,
        payloadHashConfirmed: false,
        reviewedBy: '<reviewer>',
      },
      approval: {
        status: endpoint.operationType === 'write' ? 'pending' : 'not_required',
        approvalId: options.approvalId || '<approval-id>',
        owner: '<billing-ops-owner>',
        productionConfirmation: tenant === 'production' ? '<sha256-preview-hash-or-typed-confirmation>' : 'not_required_for_sandbox',
      },
      idempotency: {
        status: endpoint.operationType === 'write' ? 'pending' : 'not_required',
        keys: [],
        duplicatePrevention: '<how retries avoid duplicate objects or charges>',
      },
      audit: {
        status: 'pending',
        auditLogPath: '<jsonl-audit-log-path>',
        rowSchema: 'metro.audit.template.v1',
      },
      sandboxProof: {
        status: endpoint.operationType === 'write' ? 'pending' : 'not_required',
        required: endpoint.operationType === 'write',
        proofPath: '<sandbox-proof-json>',
        proofHash: 'sha256:<64 lowercase hex sandbox proof hash>',
      },
      canary: {
        status: endpoint.operationType === 'write' ? 'pending' : 'not_required',
        required: endpoint.operationType === 'write',
        plan: '<single-object canary or not-bulk justification>',
      },
      readBack: {
        status: 'pending',
        checks: clone(preview.verificationPlan || []),
      },
      rollback: {
        status: endpoint.operationType === 'write' ? 'pending' : 'not_required',
        plan: '<rollback or remediation path>',
      },
    },
    policyGates: clone(preview.policyGates || endpoint.policyGates),
    expectedSideEffects: clone(preview.expectedSideEffects || []),
    futureApply: {
      enabledInCurrentCli: false,
      command: `metro api apply ${endpoint.id} --file <request.json|yaml> ${flag} --confirm-hash ${preview.payloadHash} --approval <approval_id>`,
      blockedBy: [
        'guarded expert API apply runner',
        'tenant profile/key fingerprint binding',
        'durable permission approval model',
        'live audit writer',
        'read-back verifier',
        'explicit current-turn authorization',
      ],
    },
    validationCommand: 'metro api preflight validate --file <api-preflight.json> [--json]',
    nextSafeStep: 'Fill every required evidence section, then run metro api preflight validate --file <api-preflight.json> --json. Expert API apply remains disabled in the current CLI.',
    sources: clone(preview.sources || endpoint.sources),
  };
}

function apiPreflightCoverage() {
  return listApiEndpoints().reduce((coverage, endpoint) => {
    coverage[endpoint.id] = {
      schemaVersion: API_PREFLIGHT_SCHEMA_VERSION,
      supportStatus: 'local-preflight-contract',
      command: 'metro api preflight template --preview <api-preview.json> [--profile-resolution <profile-resolution.json>] [--approval-id <id>] [--json]',
      validationCommand: 'metro api preflight validate --file <api-preflight.json> [--json]',
      apiAccess: 'none',
      requiresPreview: `metro api preview ${endpoint.id} --file <request.json|yaml> (--sandbox|--prod) [--json]`,
      requiredEvidence: requiredEvidenceFor(endpoint).map((item) => item.id),
    };
    return coverage;
  }, {});
}

function validatePreviewBinding(input, endpoint, findings) {
  const binding = input?.previewBinding;
  if (!isObject(binding)) {
    add(findings, 'MTR-PREFLIGHT-001', 'previewBinding is required.', 'previewBinding', 'Start from metro api preflight template using a reviewed api preview JSON file.');
    return;
  }
  if (binding.schemaVersion !== API_PREVIEW_SCHEMA_VERSION) {
    add(findings, 'MTR-PREFLIGHT-001', `previewBinding.schemaVersion must be ${API_PREVIEW_SCHEMA_VERSION}.`, 'previewBinding.schemaVersion', 'Use output from metro api preview.');
  }
  if (binding.endpointId !== endpoint?.id) {
    add(findings, 'MTR-ENDPOINT-001', 'previewBinding.endpointId must match the endpoint record.', 'previewBinding.endpointId', 'Use preflight evidence generated from the same reviewed endpoint preview.');
  }
  if (!['sandbox', 'production'].includes(binding.tenant)) {
    add(findings, 'MTR-TENANT-001', 'previewBinding.tenant must be sandbox or production.', 'previewBinding.tenant', 'Regenerate the API preview with exactly one tenant flag.');
  }
  if (binding.operationType !== endpoint?.operationType) {
    add(findings, 'MTR-ENDPOINT-001', 'previewBinding.operationType must match the catalog endpoint.', 'previewBinding.operationType', 'Regenerate the preflight from the current endpoint catalog and preview output.');
  }
  if (binding.permissionScope !== endpoint?.permissionScope) {
    add(findings, 'MTR-ENDPOINT-001', 'previewBinding.permissionScope must match the catalog endpoint permission scope.', 'previewBinding.permissionScope', 'Regenerate the preflight from the current endpoint catalog and preview output.');
  }
  if (binding.validationSchemaVersion !== 'metro.api.validation.v1' || binding.validationValid !== true) {
    add(findings, 'MTR-APIREQ-001', 'previewBinding must prove a passing metro.api.validation.v1 result.', 'previewBinding.validationValid', 'Re-run metro api validate and metro api preview with valid local request input.');
  }
  if (!isSha256(binding.requestHash)) {
    add(findings, 'MTR-HASH-001', 'previewBinding.requestHash must be sha256:<64 lowercase hex>.', 'previewBinding.requestHash', 'Use the requestHash emitted by metro api preview.');
  }
  if (!isSha256(binding.payloadHash)) {
    add(findings, 'MTR-TENANT-002', 'previewBinding.payloadHash must be sha256:<64 lowercase hex>.', 'previewBinding.payloadHash', 'Use the payloadHash emitted by metro api preview.');
  }
  const sourceIds = list(binding.sourceIds);
  if (!sourceIds.includes('endpoint-matrix')) {
    add(findings, 'MTR-ENDPOINT-001', 'previewBinding.sourceIds must include endpoint-matrix.', 'previewBinding.sourceIds', 'Use reviewed endpoint IDs from the local endpoint matrix.');
  }
  if (!hasReviewedSource(sourceIds)) {
    add(findings, 'MTR-ENDPOINT-002', 'previewBinding.sourceIds must include an official or reviewed local endpoint source.', 'previewBinding.sourceIds', 'Add official-* or reviewed local source evidence before future apply evidence can pass.');
  }
}

function validateEndpointSnapshot(input, endpoint, findings) {
  const snapshot = input?.endpoint;
  if (!isObject(snapshot)) {
    add(findings, 'MTR-ENDPOINT-001', 'endpoint snapshot is required.', 'endpoint', 'Start from metro api preflight template.');
    return;
  }
  for (const field of ['id', 'method', 'path', 'operationType', 'permissionScope']) {
    if (snapshot[field] !== endpoint?.[field]) {
      add(findings, 'MTR-ENDPOINT-001', `endpoint.${field} must match the reviewed endpoint catalog.`, `endpoint.${field}`, 'Regenerate the preflight from the current endpoint catalog.');
    }
  }
  const sourceIds = list(snapshot.sourceIds);
  if (!sourceIds.includes('endpoint-matrix')) {
    add(findings, 'MTR-ENDPOINT-001', 'endpoint.sourceIds must include endpoint-matrix.', 'endpoint.sourceIds', 'Cite the local endpoint matrix before future apply evidence can rely on this endpoint.');
  }
  if (!hasReviewedSource(sourceIds)) {
    add(findings, 'MTR-ENDPOINT-002', 'endpoint.sourceIds must include an official doc or reviewed local source ID.', 'endpoint.sourceIds', 'Add official-* or reviewed local endpoint source evidence.');
  }
}

function validatePolicyGates(input, endpoint, findings) {
  const policyGates = list(input?.policyGates);
  for (const gate of endpoint?.policyGates || []) {
    if (!policyGates.includes(gate)) {
      add(findings, 'MTR-PREFLIGHT-001', `policyGates must include ${gate}.`, 'policyGates', 'Regenerate the preflight from the current API preview output.');
    }
  }
}

function validateTenantProfile(input, findings) {
  const profile = input?.tenantProfile;
  if (!isObject(profile)) {
    add(findings, 'MTR-TENANT-001', 'tenantProfile is required.', 'tenantProfile', 'Bind the preflight to one reviewed tenant profile resolution artifact.');
    return;
  }
  requireFilled(findings, profile.profileName, 'tenantProfile.profileName', 'tenantProfile.profileName is required.', 'Record the named tenant profile that a future runner would use.');
  if (profile.tenant !== input?.previewBinding?.tenant) {
    add(findings, 'MTR-TENANT-001', 'tenantProfile.tenant must match previewBinding.tenant.', 'tenantProfile.tenant', 'Use one tenant consistently across the preview and preflight.');
  }
  requireFilled(findings, profile.keyEnv, 'tenantProfile.keyEnv', 'tenantProfile.keyEnv is required.', 'Record the environment variable name only, never its value.');
  requireFilled(findings, profile.keyFingerprint, 'tenantProfile.keyFingerprint', 'tenantProfile.keyFingerprint is required.', 'Record a non-secret key fingerprint, never the raw key.');
  if (profile.profileBindingConfirmed !== true) {
    add(findings, 'MTR-TENANT-001', 'tenantProfile.profileBindingConfirmed must be true.', 'tenantProfile.profileBindingConfirmed', 'Review the profile/tenant binding before future expert apply evidence can pass.');
  }
  if (input?.previewBinding?.tenant === 'production' && !/PROD|PRODUCTION/.test(String(profile.keyEnv || ''))) {
    add(findings, 'MTR-TENANT-001', 'production API preflight must name a production Metronome key environment variable.', 'tenantProfile.keyEnv', 'Use a production-scoped key env var name such as METRONOME_PROD_KEY.');
  }
  if (input?.previewBinding?.tenant === 'sandbox' && !/SANDBOX|TEST/.test(String(profile.keyEnv || ''))) {
    add(findings, 'MTR-TENANT-001', 'sandbox API preflight must name a sandbox Metronome key environment variable.', 'tenantProfile.keyEnv', 'Use a sandbox-scoped key env var name such as METRONOME_SANDBOX_KEY.');
  }
}

function validateCommonEvidence(input, endpoint, findings) {
  const preview = input?.evidence?.preview;
  requireStatus(findings, preview, 'evidence.preview', ['reviewed']);
  requireFilled(findings, preview?.previewOutputPath, 'evidence.preview.previewOutputPath', 'evidence.preview.previewOutputPath is required.', 'Record the reviewed local metro api preview output path.');
  if (preview?.payloadHash !== input?.previewBinding?.payloadHash) {
    add(findings, 'MTR-TENANT-002', 'evidence.preview.payloadHash must match previewBinding.payloadHash.', 'evidence.preview.payloadHash', 'Bind approval to the exact reviewed API preview hash.');
  }
  if (preview?.payloadHashConfirmed !== true) {
    add(findings, 'MTR-TENANT-002', 'evidence.preview.payloadHashConfirmed must be true.', 'evidence.preview.payloadHashConfirmed', 'Review and confirm the exact payload hash before future apply evidence can pass.');
  }
  requireFilled(findings, preview?.reviewedBy, 'evidence.preview.reviewedBy', 'evidence.preview.reviewedBy is required.', 'Record the reviewer or review process for the API preview.');

  const audit = input?.evidence?.audit;
  requireStatus(findings, audit, 'evidence.audit', ['ready']);
  requireFilled(findings, audit?.auditLogPath, 'evidence.audit.auditLogPath', 'evidence.audit.auditLogPath is required.', 'Record the future JSONL audit log destination.');
  if (audit?.rowSchema !== 'metro.audit.template.v1') {
    add(findings, 'MTR-PREFLIGHT-008', 'evidence.audit.rowSchema must be metro.audit.template.v1.', 'evidence.audit.rowSchema', 'Use the CLI audit template schema for future apply audit rows.');
  }

  const readBack = input?.evidence?.readBack;
  requireStatus(findings, readBack, 'evidence.readBack', ['ready']);
  if (!list(readBack?.checks).some((check) => filled(check?.expectation))) {
    add(findings, 'MTR-VERIFY-001', 'evidence.readBack.checks must include at least one expectation.', 'evidence.readBack.checks', 'Record read-back checks before future live execution can be approved.');
  }

  if (endpoint?.operationType !== 'write') return;

  const approval = input?.evidence?.approval;
  requireStatus(findings, approval, 'evidence.approval', ['approved']);
  requireFilled(findings, approval?.approvalId, 'evidence.approval.approvalId', 'evidence.approval.approvalId is required.', 'Record the approval ID that authorizes this exact future operation.');
  requireFilled(findings, approval?.owner, 'evidence.approval.owner', 'evidence.approval.owner is required.', 'Record the accountable billing operations owner.');
  if (input?.previewBinding?.tenant === 'production') {
    requireFilled(findings, approval?.productionConfirmation, 'evidence.approval.productionConfirmation', 'production API preflight requires evidence.approval.productionConfirmation.', 'Bind production approval to the exact reviewed preview hash or typed confirmation.');
  }

  const idempotency = input?.evidence?.idempotency;
  requireStatus(findings, idempotency, 'evidence.idempotency', ['reviewed']);
  requireFilled(findings, idempotency?.duplicatePrevention, 'evidence.idempotency.duplicatePrevention', 'evidence.idempotency.duplicatePrevention is required.', 'Describe how retries avoid duplicate objects, charges, invoices, or usage events.');

  const sandboxProof = input?.evidence?.sandboxProof;
  requireStatus(findings, sandboxProof, 'evidence.sandboxProof', ['ready']);
  if (sandboxProof?.required !== true) {
    add(findings, 'MTR-VERIFY-003', 'evidence.sandboxProof.required must be true for write endpoints.', 'evidence.sandboxProof.required', 'Future expert writes require sandbox proof before production apply can be considered.');
  }
  requireFilled(findings, sandboxProof?.proofPath, 'evidence.sandboxProof.proofPath', 'evidence.sandboxProof.proofPath is required.', 'Record the sandbox proof manifest path or evidence location.');
  if (!isSha256(sandboxProof?.proofHash)) {
    add(findings, 'MTR-HASH-001', 'evidence.sandboxProof.proofHash must be sha256:<64 lowercase hex>.', 'evidence.sandboxProof.proofHash', 'Record a stable hash for the reviewed sandbox proof file.');
  }

  const canary = input?.evidence?.canary;
  requireStatus(findings, canary, 'evidence.canary', ['ready']);
  if (canary?.required !== true) {
    add(findings, 'MTR-VERIFY-003', 'evidence.canary.required must be true for write endpoints.', 'evidence.canary.required', 'Use a one-object canary or explicit non-bulk plan for write-shaped operations.');
  }
  requireFilled(findings, canary?.plan, 'evidence.canary.plan', 'evidence.canary.plan is required.', 'Define the canary or non-bulk stop criteria before future apply.');

  const rollback = input?.evidence?.rollback;
  requireStatus(findings, rollback, 'evidence.rollback', ['reviewed']);
  requireFilled(findings, rollback?.plan, 'evidence.rollback.plan', 'evidence.rollback.plan is required.', 'Document rollback or remediation before future apply can be approved.');
}

function validateApiPreflight(input, options = {}) {
  const rootDir = options.rootDir || process.cwd();
  const findings = [];
  scanForSecrets(input, findings);

  if (input?.schemaVersion !== API_PREFLIGHT_SCHEMA_VERSION) {
    add(findings, 'MTR-PREFLIGHT-001', `schemaVersion must be ${API_PREFLIGHT_SCHEMA_VERSION}.`, 'schemaVersion', 'Start from metro api preflight template and keep schemaVersion unchanged.');
  }
  if (input?.apiAccess !== 'none') {
    add(findings, 'MTR-PREFLIGHT-001', 'apiAccess must remain none.', 'apiAccess', 'Expert API preflight evidence must not claim live API access.');
  }
  if (input?.applyEnabledInCurrentCli !== false) {
    add(findings, 'MTR-PREFLIGHT-001', 'applyEnabledInCurrentCli must be false.', 'applyEnabledInCurrentCli', 'Do not mark expert API apply enabled until a guarded runner exists.');
  }
  if (input?.liveExecution?.enabledInCurrentCli !== false) {
    add(findings, 'MTR-PREFLIGHT-001', 'liveExecution.enabledInCurrentCli must be false.', 'liveExecution.enabledInCurrentCli', 'This CLI release must keep expert API live execution disabled.');
  }

  const endpoint = getApiEndpoint(input?.previewBinding?.endpointId);
  if (!endpoint) {
    add(findings, 'MTR-ENDPOINT-001', 'previewBinding.endpointId must name a reviewed API endpoint.', 'previewBinding.endpointId', 'Use metro api catalog to choose a reviewed endpoint ID.');
  }

  validatePreviewBinding(input, endpoint, findings);
  validateEndpointSnapshot(input, endpoint, findings);
  validateTenantProfile(input, findings);
  const profileResolutionValidated = validateProfileResolutionEvidence({
    input,
    rootDir,
    findings,
    addFinding: (id, message, pathName, remediation) => add(findings, id, message, pathName, remediation),
    scanForSecrets,
    required: true,
    localOnlyFindingId: 'MTR-PREFLIGHT-001',
    targetLabel: 'preflight',
    expectedTenant: input?.previewBinding?.tenant,
    expectedTenantPath: 'previewBinding.tenant',
    consistencyContext: 'profile resolution, preview, and preflight',
  });
  if (endpoint) {
    validatePolicyGates(input, endpoint, findings);
    validateCommonEvidence(input, endpoint, findings);
  }

  const valid = !findings.some((item) => item.severity === 'error');
  return {
    schemaVersion: API_PREFLIGHT_VALIDATION_SCHEMA_VERSION,
    generatedFrom: 'packages/metro-core/src/api-catalog/preflight.js',
    apiAccess: 'none',
    liveExecution: clone(LOCAL_ONLY_LIVE_EXECUTION),
    applyEnabledInCurrentCli: false,
    summary: {
      endpointId: input?.previewBinding?.endpointId || null,
      tenant: input?.previewBinding?.tenant || null,
      operationType: input?.previewBinding?.operationType || null,
      permissionScope: input?.previewBinding?.permissionScope || null,
      payloadHash: input?.previewBinding?.payloadHash || null,
      requiredEvidence: endpoint ? requiredEvidenceFor(endpoint).map((item) => item.id) : [],
      tenantProfileBound: input?.tenantProfile?.profileBindingConfirmed === true,
      tenantProfileResolutionValidated: profileResolutionValidated,
    },
    valid,
    findings,
    nextSafeStep: valid
      ? 'Keep this as local preflight evidence. Expert API apply remains disabled until guarded runners, durable permission approvals, audit writing, read-back verification, sandbox proof, and explicit current-turn authorization exist.'
      : 'Fix the API preflight evidence and re-run metro api preflight validate before using it for any future expert API apply approval.',
  };
}

module.exports = {
  API_PREFLIGHT_SCHEMA_VERSION,
  API_PREFLIGHT_VALIDATION_SCHEMA_VERSION,
  apiPreflightCoverage,
  buildApiPreflightTemplate,
  validateApiPreflight,
};
