'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { getApiEndpoint, listApiEndpoints } = require('./index');
const {
  PROFILE_RESOLUTION_SCHEMA_VERSION,
  buildProfileResolutionSection,
  keyEnvForTenant,
  profileResolutionIsUsable,
  profileResolutionMatchesTenantProfile,
  validateProfileResolutionEvidence,
} = require('./profile-resolution');
const { API_PREFLIGHT_SCHEMA_VERSION, validateApiPreflight } = require('./preflight');
const { API_PREVIEW_SCHEMA_VERSION } = require('./preview');

const API_APPLY_GATE_SCHEMA_VERSION = 'metro.api.apply-gate.v1';
const API_APPLY_GATE_VALIDATION_SCHEMA_VERSION = 'metro.api.apply-gate.validation.v1';
const API_SANDBOX_PROOF_SCHEMA_VERSION = 'metro.api.sandbox-proof.v1';
const API_SANDBOX_PROOF_VALIDATION_SCHEMA_VERSION = 'metro.api.sandbox-proof.validation.v1';

const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const SECRET_KEY_PATTERN = /(?:api[_-]?key|secret|token|authorization|password|private[_-]?key|bearer)/i;
const SECRET_VALUE_PATTERN = /(?:bearer\s+[A-Za-z0-9._-]+|sk_live_[A-Za-z0-9]+|sk_test_[A-Za-z0-9]+|rk_live_[A-Za-z0-9]+|prod_[A-Za-z0-9]{12,})/i;

const LOCAL_ONLY_LIVE_EXECUTION = {
  enabledInCurrentCli: false,
  reason: 'Expert API apply-gate evidence is local only; the current CLI does not load Metronome API clients or run expert API apply commands.',
  nextSafeStep: 'Validate the apply-gate manifest locally. Expert API apply remains disabled until guarded runners, durable approvals, audit writing, read-back verification, and explicit current-turn authorization exist.',
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
  if (!resolved) return 'sha256:<64 lowercase hex file hash>';
  try {
    return hashFile(resolved);
  } catch {
    return 'sha256:<64 lowercase hex file hash>';
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
        `API apply-gate evidence appears to contain a secret-like value at ${pathName}.`,
        pathName,
        'Store environment variable names, hashes, approval IDs, or non-secret fingerprints only.',
      );
    }
    return;
  }

  if (!isObject(value)) return;

  for (const [key, child] of Object.entries(value)) {
    const childPath = pathName === '$' ? key : `${pathName}.${key}`;
    if (SECRET_KEY_PATTERN.test(key) && key !== 'keyFingerprint') {
      add(
        findings,
        'MTR-APIREQ-003',
        `API apply-gate evidence contains forbidden secret-shaped field ${childPath}.`,
        childPath,
        'Never store raw API keys, tokens, passwords, or Authorization headers in apply-gate manifests.',
      );
    }
    scanForSecrets(child, findings, childPath);
  }
}

function requireFilled(findings, value, pathName, message, remediation, id = 'MTR-API-APPLY-GATE-001') {
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
    add(findings, 'MTR-API-APPLY-GATE-001', `${pathName} evidence is required.`, pathName, 'Start from metro api apply-gate template and keep the evidence section.');
    return null;
  }
  requireFilled(findings, section.filePath, `${pathName}.filePath`, `${pathName}.filePath is required.`, 'Point to the reviewed local evidence JSON file.');
  validateHash(findings, section.fileHash, `${pathName}.fileHash`, 'Hash the reviewed local evidence file and record the sha256 value.');

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
        'Re-review the changed file and update the hash only after confirming the evidence is intended.',
      );
    }
    return {
      resolvedPath: resolved,
      fileHash: actualHash,
      parsed: readJsonFile(resolved),
    };
  } catch (error) {
    add(
      findings,
      'MTR-API-APPLY-GATE-006',
      `Failed to read or parse ${pathName} evidence: ${error.message}`,
      `${pathName}.filePath`,
      'Use a readable local JSON evidence file.',
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

function bindingFromPreview(preview) {
  return {
    endpointId: preview.endpoint?.id,
    tenant: preview.tenant,
    operationType: preview.endpoint?.operationType,
    permissionScope: preview.endpoint?.permissionScope,
    requestHash: preview.requestSummary?.requestHash,
    payloadHash: preview.payloadHash,
  };
}

function sandboxProofPayloadHash(proof) {
  return proof?.previewBinding?.payloadHash || proof?.payloadHash || null;
}

function sandboxProofPreflightPayloadHash(proof) {
  return proof?.preflight?.payloadHash || proof?.preflightPayloadHash || null;
}

function sandboxProofRequestHash(proof) {
  return proof?.previewBinding?.requestHash || proof?.requestHash || proof?.preview?.requestHash || null;
}

function sandboxProofBindingMode(tenant) {
  return tenant === 'production' ? 'sandbox-proof-request-hash' : 'same-tenant-preview-hash';
}

function sandboxProofExpectationForApply(preview, preflight) {
  const expected = {
    endpointId: preview.endpoint?.id,
    tenant: 'sandbox',
    requestHash: preview.requestSummary?.requestHash,
  };

  if (preview.tenant === 'sandbox') {
    expected.payloadHash = preview.payloadHash;
    expected.preflightPayloadHash = preflight.previewBinding?.payloadHash;
  }

  return expected;
}

function tenantFlag(tenant) {
  if (tenant === 'production') return '--prod';
  if (tenant === 'sandbox') return '--sandbox';
  return '(--sandbox|--prod)';
}

function futureApplyCommand(endpointId, tenant, payloadHash, approvalId) {
  return `metro api apply ${endpointId} --file <request.json|yaml> ${tenantFlag(tenant)} --confirm-hash ${payloadHash || '<preview-hash>'} --approval ${approvalId || '<approval_id>'}`;
}

function apiApplyGateCoverage() {
  return listApiEndpoints().reduce((coverage, endpoint) => {
    coverage[endpoint.id] = {
      schemaVersion: API_APPLY_GATE_SCHEMA_VERSION,
      supportStatus: 'local-apply-gate-manifest',
      command: 'metro api apply-gate template --preview <api-preview.json> --preflight <api-preflight.json> [--sandbox-proof <sandbox-proof.json>] [--profile-resolution <profile-resolution.json>] [--json]',
      validationCommand: 'metro api apply-gate validate --file <api-apply-gate.json> [--json]',
      apiAccess: 'none',
      requiresPreflight: `metro api preflight validate --file <api-preflight-for-${endpoint.id}.json> [--json]`,
      requiredEvidence: endpoint.operationType === 'write'
        ? ['reviewed-preview-file-hash', 'reviewed-preflight-file-hash', 'sandbox-proof-file-hash', 'sandbox-proof-request-hash-binding', 'tenant-profile-resolution-file-hash', 'approval-id', 'key-fingerprint', 'audit-destination', 'read-back-plan', 'rollback-remediation', 'idempotency-review']
        : ['reviewed-preview-file-hash', 'reviewed-preflight-file-hash', 'tenant-profile-resolution-file-hash', 'key-fingerprint', 'audit-destination', 'read-back-plan'],
    };
    return coverage;
  }, {});
}

function apiSandboxProofCoverage() {
  return listApiEndpoints().reduce((coverage, endpoint) => {
    const required = endpoint.operationType === 'write';
    coverage[endpoint.id] = {
      schemaVersion: API_SANDBOX_PROOF_SCHEMA_VERSION,
      supportStatus: required ? 'local-sandbox-proof-template' : 'not-required',
      command: required
        ? 'metro api sandbox-proof template --preview <api-preview.json> --preflight <api-preflight.json> [--reviewed-by <reviewer>] [--owner <owner>] [--json]'
        : null,
      validationCommand: 'metro api sandbox-proof validate --file <api-sandbox-proof.json> [--json]',
      apiAccess: 'none',
      requiredEvidence: required
        ? ['sandbox-canary-result', 'read-back-evidence', 'invoice-behavior-review', 'rollback-remediation-review']
        : [],
    };
    return coverage;
  }, {});
}

function previewIsUsable(preview) {
  return isObject(preview)
    && preview.schemaVersion === API_PREVIEW_SCHEMA_VERSION
    && preview.blocked !== true
    && preview.validation?.valid === true
    && isSha256(preview.payloadHash)
    && isSha256(preview.requestSummary?.requestHash);
}

function preflightMatchesPreview(preflight, preview) {
  return isObject(preflight)
    && preflight.schemaVersion === API_PREFLIGHT_SCHEMA_VERSION
    && preflight.previewBinding?.endpointId === preview.endpoint?.id
    && preflight.previewBinding?.tenant === preview.tenant
    && preflight.previewBinding?.payloadHash === preview.payloadHash
    && preflight.previewBinding?.requestHash === preview.requestSummary?.requestHash
    && preflight.previewBinding?.permissionScope === preview.endpoint?.permissionScope;
}

function buildApiSandboxProofTemplate(options = {}) {
  const {
    preview,
    preflight,
    previewPath = null,
    preflightPath = null,
    reviewedBy = null,
    owner = null,
    rootDir = process.cwd(),
  } = options;

  if (!previewIsUsable(preview)) return null;
  const endpoint = getApiEndpoint(preview.endpoint?.id);
  if (!endpoint || endpoint.operationType !== 'write') return null;
  if (preview.tenant !== 'sandbox') return null;

  const resolvedPreflightPath = resolveLocalPath(preflightPath, rootDir);
  const preflightRootDir = resolvedPreflightPath ? path.dirname(resolvedPreflightPath) : rootDir;
  const preflightValidation = validateApiPreflight(preflight, { rootDir: preflightRootDir });
  if (!preflightValidation.valid || !preflightMatchesPreview(preflight, preview)) return null;

  const requiredEvidence = [
    {
      id: 'sandbox-canary-result',
      required: true,
      evidencePath: 'evidence.canaryResult',
      description: 'Reviewed sandbox execution evidence for one canary object or a documented non-bulk sandbox write.',
    },
    {
      id: 'read-back-evidence',
      required: true,
      evidencePath: 'evidence.readBack',
      description: 'Reviewed sandbox read-back evidence proving the expected object state after the canary.',
    },
    {
      id: 'invoice-behavior-review',
      required: true,
      evidencePath: 'evidence.invoiceBehavior',
      description: 'Reviewed invoice and Stripe behavior evidence for the sandbox canary.',
    },
    {
      id: 'rollback-remediation-review',
      required: true,
      evidencePath: 'evidence.rollback',
      description: 'Reviewed rollback or remediation path if the same operation partially fails in a future live runner.',
    },
  ];

  return {
    schemaVersion: API_SANDBOX_PROOF_SCHEMA_VERSION,
    generatedFrom: 'metronome-cli/src/api-catalog/apply-gate.js',
    apiAccess: 'none',
    liveExecution: clone(LOCAL_ONLY_LIVE_EXECUTION),
    applyEnabledInCurrentCli: false,
    status: 'template',
    endpointId: endpoint.id,
    tenant: 'sandbox',
    endpoint: endpointSnapshot(endpoint),
    previewBinding: bindingFromPreview(preview),
    requestHash: preview.requestSummary.requestHash,
    payloadHash: preview.payloadHash,
    preflightPayloadHash: preflight.previewBinding.payloadHash,
    preview: {
      filePath: previewPath || '<path-to-reviewed-api-preview-json>',
      fileHash: hashFileIfReadable(previewPath, rootDir),
      requestHash: preview.requestSummary.requestHash,
      validationResult: 'passed',
    },
    preflight: {
      filePath: preflightPath || '<path-to-reviewed-api-preflight-json>',
      fileHash: hashFileIfReadable(preflightPath, rootDir),
      validationResult: 'passed',
      payloadHash: preflight.previewBinding.payloadHash,
    },
    requiredEvidence,
    evidence: {
      canaryResult: 'pending',
      readBack: 'pending',
      invoiceBehavior: 'pending',
      rollback: 'pending',
    },
    evidenceArtifacts: {
      canaryResult: {
        filePath: '<path-to-sandbox-canary-result-json>',
        fileHash: 'sha256:<64 lowercase hex canary evidence hash>',
      },
      readBack: {
        filePath: '<path-to-sandbox-read-back-json>',
        fileHash: 'sha256:<64 lowercase hex read-back evidence hash>',
      },
      invoiceBehavior: {
        filePath: '<path-to-sandbox-invoice-behavior-json>',
        fileHash: 'sha256:<64 lowercase hex invoice evidence hash>',
      },
      rollback: {
        filePath: '<path-to-reviewed-rollback-remediation.md>',
        fileHash: 'sha256:<64 lowercase hex rollback evidence hash>',
      },
    },
    reviewer: {
      reviewedBy: reviewedBy || '<reviewer>',
      owner: owner || '<billing-ops-owner>',
      reviewedAt: '<ISO-8601 timestamp after sandbox canary review>',
    },
    validationCommand: 'metro api sandbox-proof validate --file <api-sandbox-proof.json> [--json]',
    applyGateCommand: `metro api apply-gate template --preview ${previewPath || '<api-preview.json>'} --preflight ${preflightPath || '<api-preflight.json>'} --sandbox-proof <api-sandbox-proof.json> [--json]`,
    nextSafeStep: 'Fill the evidence fields only after an explicitly authorized sandbox canary, read-back, invoice/Stripe review, and rollback/remediation review. The current CLI still cannot run expert API applies.',
    sources: clone(preview.sources || endpoint.sources),
  };
}

function buildApiApplyGateTemplate(options = {}) {
  const {
    preview,
    preflight,
    sandboxProof = null,
    previewPath,
    preflightPath,
    sandboxProofPath,
    profileResolution = null,
    profileResolutionPath = null,
    approvalId = null,
    owner = null,
    keyEnv = null,
    keyFingerprint = null,
    auditLog = null,
    rootDir = process.cwd(),
  } = options;

  if (!previewIsUsable(preview)) return null;
  const endpoint = getApiEndpoint(preview.endpoint?.id);
  if (!endpoint) return null;
  const resolvedPreflightPath = resolveLocalPath(preflightPath, rootDir);
  const preflightRootDir = resolvedPreflightPath ? path.dirname(resolvedPreflightPath) : rootDir;
  const preflightValidation = validateApiPreflight(preflight, { rootDir: preflightRootDir });
  if (!preflightValidation.valid || !preflightMatchesPreview(preflight, preview)) return null;
  if (profileResolution && !profileResolutionIsUsable(profileResolution, preview.tenant)) return null;
  if (profileResolution && !profileResolutionMatchesTenantProfile(profileResolution, preflight.tenantProfile)) return null;

  const sandboxProofValidation = sandboxProof
    ? validateApiSandboxProof(sandboxProof, sandboxProofExpectationForApply(preview, preflight))
    : null;

  const proofRequired = endpoint.operationType === 'write';
  const proofStatus = proofRequired ? 'pending' : 'not_required';
  const proofBindingMode = sandboxProofBindingMode(preview.tenant);
  const proofRequestHash = sandboxProofRequestHash(sandboxProof);
  const proofPayloadHash = sandboxProofPayloadHash(sandboxProof);
  const proofPreflightPayloadHash = sandboxProofPreflightPayloadHash(sandboxProof);
  const resolvedProfile = profileResolution?.tenantProfile || preflight.tenantProfile || {};
  const fingerprint = keyFingerprint || resolvedProfile.keyFingerprint || '<non-secret tenant key fingerprint>';
  const envVar = keyEnv || resolvedProfile.keyEnv || keyEnvForTenant(preview.tenant);
  const profileResolutionEvidence = profileResolution
    ? buildProfileResolutionSection({
      profileResolutionPath,
      rootDir,
      valid: true,
    })
    : clone(preflight.tenantProfile?.profileResolution || {
      filePath: '<path-to-metro-profile-resolve-json>',
      fileHash: 'sha256:<64 lowercase hex profile resolution file hash>',
      schemaVersion: PROFILE_RESOLUTION_SCHEMA_VERSION,
      valid: false,
    });

  return {
    schemaVersion: API_APPLY_GATE_SCHEMA_VERSION,
    generatedFrom: 'metronome-cli/src/api-catalog/apply-gate.js',
    apiAccess: 'none',
    liveExecution: clone(LOCAL_ONLY_LIVE_EXECUTION),
    applyEnabledInCurrentCli: false,
    status: 'template',
    binding: bindingFromPreview(preview),
    endpoint: endpointSnapshot(endpoint),
    preview: {
      filePath: previewPath || '<path-to-reviewed-api-preview-json>',
      fileHash: hashFileIfReadable(previewPath, rootDir),
      payloadHash: preview.payloadHash,
      requestHash: preview.requestSummary.requestHash,
      validationResult: 'passed',
    },
    preflight: {
      filePath: preflightPath || '<path-to-reviewed-api-preflight-json>',
      fileHash: hashFileIfReadable(preflightPath, rootDir),
      validationResult: 'passed',
      payloadHash: preflight.previewBinding.payloadHash,
    },
    sandboxProof: {
      required: proofRequired,
      bindingMode: proofRequired ? proofBindingMode : 'not_required',
      expectedTenant: proofRequired ? 'sandbox' : null,
      filePath: sandboxProofPath || (proofRequired ? '<path-to-reviewed-api-sandbox-proof-json>' : '<optional-sandbox-proof-json>'),
      fileHash: sandboxProofPath ? hashFileIfReadable(sandboxProofPath, rootDir) : 'sha256:<64 lowercase hex sandbox proof file hash>',
      validationResult: sandboxProofValidation?.valid ? 'passed' : proofStatus,
      sandboxPayloadHash: proofPayloadHash || (proofRequired ? 'sha256:<64 lowercase hex sandbox preview payload hash>' : null),
      sandboxPreflightPayloadHash: proofPreflightPayloadHash || (proofRequired ? 'sha256:<64 lowercase hex sandbox preflight payload hash>' : null),
      sandboxRequestHash: proofRequestHash || (proofRequired ? 'sha256:<64 lowercase hex sandbox request hash>' : null),
      productionPreviewPayloadHash: preview.tenant === 'production' ? preview.payloadHash : null,
      requestHashBinding: proofRequired
        ? {
          expectedRequestHash: preview.requestSummary.requestHash,
          matchRequired: true,
          matchResult: proofRequestHash ? proofRequestHash === preview.requestSummary.requestHash : false,
          reason: preview.tenant === 'production'
            ? 'Production apply gates bind sandbox proof by reviewed endpoint id and canonical request hash because the production preview payload hash includes the production tenant and may differ from the sandbox proof payload hash.'
            : 'Sandbox apply gates bind sandbox proof to the same reviewed preview request hash and payload hash.',
        }
        : null,
    },
    tenantProfile: {
      profileName: resolvedProfile.profileName || '<profile-name>',
      tenant: preview.tenant,
      keyEnv: envVar,
      keyFingerprint: fingerprint,
      profileBindingConfirmed: Boolean(profileResolution) || preflight.tenantProfile?.profileBindingConfirmed === true,
      profileResolution: profileResolutionEvidence,
    },
    approval: {
      approvalId: approvalId || '<approval-id>',
      owner: owner || '<billing-ops-owner>',
      confirmHash: preview.payloadHash,
      productionConfirmation: preview.tenant === 'production' ? preview.payloadHash : 'not_required_for_sandbox',
    },
    keyFingerprint: {
      envVar,
      previewFingerprint: fingerprint,
      applyFingerprint: fingerprint,
    },
    auditLog: {
      destination: auditLog || '<jsonl-audit-log-path>',
      writerImplementedInCurrentCli: false,
    },
    verification: {
      readBackRequired: true,
      runnerImplementedInCurrentCli: false,
      checks: clone(preview.verificationPlan || []),
    },
    rollback: {
      reviewed: true,
      owner: owner || '<billing-ops-owner>',
      plan: preflight.evidence?.rollback?.plan || '<rollback or remediation path>',
    },
    idempotency: {
      reviewed: true,
      keys: clone(preflight.evidence?.idempotency?.keys || []),
      duplicatePrevention: preflight.evidence?.idempotency?.duplicatePrevention || '<duplicate-prevention strategy>',
    },
    futureApply: {
      enabledInCurrentCli: false,
      command: futureApplyCommand(endpoint.id, preview.tenant, preview.payloadHash, approvalId),
      blockedBy: [
        'guarded expert API apply runner',
        'tenant profile/key fingerprint binding',
        'durable permission approval model',
        'live audit writer',
        'read-back verifier',
        'explicit current-turn authorization',
      ],
    },
    validationCommand: 'metro api apply-gate validate --file <api-apply-gate.json> [--json]',
    nextSafeStep: 'Review every referenced file hash and run metro api apply-gate validate --file <api-apply-gate.json> --json. Expert API apply remains disabled in the current CLI.',
    sources: clone(preview.sources || endpoint.sources),
  };
}

function validateApiSandboxProof(input, expected = {}) {
  const findings = [];
  scanForSecrets(input, findings);

  if (!isObject(input)) {
    return {
      schemaVersion: API_SANDBOX_PROOF_VALIDATION_SCHEMA_VERSION,
      valid: false,
      findings: [finding('MTR-PROOF-001', 'error', 'API sandbox proof must be a JSON object.', '$', 'Start from a reviewed sandbox proof manifest.')],
      summary: { endpointId: null, tenant: null, payloadHash: null },
    };
  }

  if (input.schemaVersion !== API_SANDBOX_PROOF_SCHEMA_VERSION) {
    add(findings, 'MTR-PROOF-001', `schemaVersion must be ${API_SANDBOX_PROOF_SCHEMA_VERSION}.`, 'schemaVersion', 'Use the API sandbox proof manifest schema.');
  }

  const endpoint = getApiEndpoint(input.endpointId);
  if (!endpoint) {
    add(findings, 'MTR-ENDPOINT-001', 'endpointId must name a reviewed API endpoint.', 'endpointId', 'Use metro api catalog to choose a reviewed endpoint ID.');
  }

  if (!['sandbox', 'production'].includes(input.tenant)) {
    add(findings, 'MTR-TENANT-001', 'tenant must be sandbox or production.', 'tenant', 'Sandbox proof must target exactly one tenant.');
  }
  if (input.tenant !== 'sandbox') {
    add(findings, 'MTR-VERIFY-003', 'API sandbox proof must be produced for the sandbox tenant.', 'tenant', 'Use sandbox evidence before considering any future production apply.');
  }
  if (!isSha256(input.payloadHash)) {
    add(findings, 'MTR-HASH-001', 'payloadHash must be sha256:<64 lowercase hex>.', 'payloadHash', 'Bind sandbox proof to the reviewed API preview payload hash.');
  }
  if (!isSha256(input.preflightPayloadHash)) {
    add(findings, 'MTR-HASH-001', 'preflightPayloadHash must be sha256:<64 lowercase hex>.', 'preflightPayloadHash', 'Bind sandbox proof to the reviewed API preflight payload hash.');
  }
  if (isObject(input.previewBinding)) {
    if (input.previewBinding.endpointId !== input.endpointId) {
      add(findings, 'MTR-ENDPOINT-001', 'previewBinding.endpointId must match endpointId.', 'previewBinding.endpointId', 'Bind sandbox proof to the exact reviewed endpoint.');
    }
    if (input.previewBinding.tenant !== 'sandbox' || input.previewBinding.tenant !== input.tenant) {
      add(findings, 'MTR-TENANT-001', 'previewBinding.tenant must be sandbox and match tenant.', 'previewBinding.tenant', 'Sandbox proof must come from a sandbox API preview.');
    }
    if (input.previewBinding.permissionScope !== endpoint?.permissionScope) {
      add(findings, 'MTR-ENDPOINT-001', 'previewBinding.permissionScope must match the reviewed endpoint permission scope.', 'previewBinding.permissionScope', 'Regenerate sandbox proof from the current endpoint catalog.');
    }
    if (input.previewBinding.payloadHash !== input.payloadHash) {
      add(findings, 'MTR-TENANT-002', 'previewBinding.payloadHash must match payloadHash.', 'previewBinding.payloadHash', 'Regenerate sandbox proof from the reviewed sandbox preview evidence.');
    }
    validateHash(findings, input.previewBinding.requestHash, 'previewBinding.requestHash', 'Use the requestHash emitted by the sandbox metro api preview output.');
  }
  if (input.status !== 'ready') {
    add(findings, 'MTR-PROOF-001', 'status must be ready.', 'status', 'Mark sandbox proof ready only after reviewed canary/read-back evidence exists.');
  }
  if (input.applyEnabledInCurrentCli !== false) {
    add(findings, 'MTR-API-APPLY-GATE-003', 'applyEnabledInCurrentCli must be false.', 'applyEnabledInCurrentCli', 'Sandbox proof must not claim expert API apply is enabled.');
  }
  if (input.liveExecution?.enabledInCurrentCli !== false) {
    add(findings, 'MTR-API-APPLY-GATE-003', 'liveExecution.enabledInCurrentCli must be false.', 'liveExecution.enabledInCurrentCli', 'Sandbox proof must be local evidence only in this CLI slice.');
  }

  for (const field of ['canaryResult', 'readBack', 'invoiceBehavior', 'rollback']) {
    if (input.evidence?.[field] !== 'reviewed') {
      add(findings, 'MTR-PROOF-001', `evidence.${field} must be reviewed.`, `evidence.${field}`, 'Record reviewed sandbox proof evidence before the apply gate can pass.');
    }
  }

  if (filled(expected.endpointId) && input.endpointId !== expected.endpointId) {
    add(findings, 'MTR-ENDPOINT-001', 'sandbox proof endpointId must match the apply gate endpoint.', 'endpointId', 'Use proof for the exact reviewed endpoint.');
  }
  if (filled(expected.tenant) && input.tenant !== expected.tenant) {
    add(findings, 'MTR-TENANT-001', 'sandbox proof tenant must match the apply gate tenant.', 'tenant', 'Use evidence for the same tenant as the apply gate.');
  }
  if (isSha256(expected.payloadHash) && input.payloadHash !== expected.payloadHash) {
    add(findings, 'MTR-TENANT-002', 'sandbox proof payloadHash must match the reviewed preview payload hash.', 'payloadHash', 'Regenerate proof or the apply gate from matching preview evidence.');
  }
  if (isSha256(expected.preflightPayloadHash) && input.preflightPayloadHash !== expected.preflightPayloadHash) {
    add(findings, 'MTR-TENANT-002', 'sandbox proof preflightPayloadHash must match the reviewed preflight payload hash.', 'preflightPayloadHash', 'Regenerate proof or the apply gate from matching preflight evidence.');
  }
  if (isSha256(expected.requestHash)) {
    const proofRequestHash = sandboxProofRequestHash(input);
    if (!isSha256(proofRequestHash)) {
      add(findings, 'MTR-HASH-001', 'sandbox proof must include the sandbox preview request hash.', 'previewBinding.requestHash', 'Regenerate sandbox proof from a metro api sandbox-proof template that includes previewBinding.requestHash.');
    } else if (proofRequestHash !== expected.requestHash) {
      add(findings, 'MTR-HASH-002', 'sandbox proof request hash must match the reviewed apply-gate request hash.', 'previewBinding.requestHash', 'Use sandbox proof for the same canonical request body, path, query, and endpoint.');
    }
  }

  return {
    schemaVersion: API_SANDBOX_PROOF_VALIDATION_SCHEMA_VERSION,
    generatedFrom: 'metronome-cli/src/api-catalog/apply-gate.js',
    apiAccess: 'none',
    liveExecution: clone(LOCAL_ONLY_LIVE_EXECUTION),
    applyEnabledInCurrentCli: false,
    summary: {
      endpointId: input.endpointId || null,
      tenant: input.tenant || null,
      operationType: endpoint?.operationType || null,
      requestHash: sandboxProofRequestHash(input),
      payloadHash: input.payloadHash || null,
      preflightPayloadHash: input.preflightPayloadHash || null,
    },
    valid: !findings.some((item) => item.severity === 'error'),
    findings,
  };
}

function validateEndpointSnapshot(input, endpoint, findings) {
  if (!isObject(input.endpoint)) {
    add(findings, 'MTR-ENDPOINT-001', 'endpoint snapshot is required.', 'endpoint', 'Start from metro api apply-gate template.');
    return;
  }

  for (const field of ['id', 'method', 'path', 'operationType', 'permissionScope']) {
    if (input.endpoint[field] !== endpoint?.[field]) {
      add(findings, 'MTR-ENDPOINT-001', `endpoint.${field} must match the reviewed endpoint catalog.`, `endpoint.${field}`, 'Regenerate the apply gate from the current reviewed endpoint catalog.');
    }
  }
  if (!list(input.endpoint.sourceIds).includes('endpoint-matrix')) {
    add(findings, 'MTR-ENDPOINT-001', 'endpoint.sourceIds must include endpoint-matrix.', 'endpoint.sourceIds', 'Reviewed endpoint IDs must cite the local endpoint matrix.');
  }
}

function validateBinding(input, endpoint, findings) {
  const binding = input.binding;
  if (!isObject(binding)) {
    add(findings, 'MTR-API-APPLY-GATE-001', 'binding is required.', 'binding', 'Start from metro api apply-gate template.');
    return;
  }
  if (binding.endpointId !== endpoint?.id) {
    add(findings, 'MTR-ENDPOINT-001', 'binding.endpointId must match the reviewed endpoint catalog.', 'binding.endpointId', 'Use evidence for the exact reviewed endpoint.');
  }
  if (!['sandbox', 'production'].includes(binding.tenant)) {
    add(findings, 'MTR-TENANT-001', 'binding.tenant must be sandbox or production.', 'binding.tenant', 'Use an API preview generated with exactly one tenant flag.');
  }
  if (binding.operationType !== endpoint?.operationType) {
    add(findings, 'MTR-ENDPOINT-001', 'binding.operationType must match the endpoint catalog.', 'binding.operationType', 'Regenerate the gate from the current endpoint catalog.');
  }
  if (binding.permissionScope !== endpoint?.permissionScope) {
    add(findings, 'MTR-ENDPOINT-001', 'binding.permissionScope must match the endpoint catalog.', 'binding.permissionScope', 'Regenerate the gate from the current endpoint catalog.');
  }
  validateHash(findings, binding.requestHash, 'binding.requestHash', 'Use the requestHash emitted by metro api preview.');
  validateHash(findings, binding.payloadHash, 'binding.payloadHash', 'Use the payloadHash emitted by metro api preview.');
}

function validatePreviewFile(input, endpoint, rootDir, findings) {
  const evidence = validateFileEvidence(input.preview, 'preview', rootDir, findings);
  const preview = evidence?.parsed;
  if (!preview) return null;

  if (preview.schemaVersion !== API_PREVIEW_SCHEMA_VERSION) {
    add(findings, 'MTR-PREFLIGHT-005', `preview file schemaVersion must be ${API_PREVIEW_SCHEMA_VERSION}.`, 'preview.filePath', 'Use output from metro api preview.');
  }
  if (preview.blocked === true || preview.validation?.valid !== true) {
    add(findings, 'MTR-APIREQ-001', 'preview file must be an unblocked API preview with passing request validation.', 'preview.filePath', 'Re-run metro api preview with valid local request input.');
  }
  if (preview.endpoint?.id !== endpoint?.id) {
    add(findings, 'MTR-ENDPOINT-001', 'preview endpoint id must match the apply gate endpoint.', 'preview.filePath', 'Use preview evidence for the exact endpoint.');
  }
  if (preview.tenant !== input.binding?.tenant) {
    add(findings, 'MTR-TENANT-001', 'preview tenant must match binding.tenant.', 'preview.filePath', 'Use preview evidence generated for the same tenant.');
  }
  if (preview.endpoint?.permissionScope !== endpoint?.permissionScope) {
    add(findings, 'MTR-ENDPOINT-001', 'preview permission scope must match the endpoint catalog.', 'preview.filePath', 'Regenerate preview from the current endpoint catalog.');
  }
  if (preview.payloadHash !== input.binding?.payloadHash || preview.payloadHash !== input.preview?.payloadHash) {
    add(findings, 'MTR-TENANT-002', 'preview payload hash must match binding.payloadHash and preview.payloadHash.', 'preview.payloadHash', 'Bind every gate section to the exact reviewed preview hash.');
  }
  if (preview.requestSummary?.requestHash !== input.binding?.requestHash || preview.requestSummary?.requestHash !== input.preview?.requestHash) {
    add(findings, 'MTR-HASH-002', 'preview request hash must match binding.requestHash and preview.requestHash.', 'preview.requestHash', 'Regenerate the gate if request evidence changed.');
  }
  if (input.preview?.validationResult !== 'passed') {
    add(findings, 'MTR-APIREQ-001', 'preview.validationResult must be passed.', 'preview.validationResult', 'Only passing local API preview evidence can satisfy an apply gate.');
  }

  return { ...evidence, valid: preview.schemaVersion === API_PREVIEW_SCHEMA_VERSION && preview.validation?.valid === true };
}

function validatePreflightFile(input, preview, rootDir, findings) {
  const evidence = validateFileEvidence(input.preflight, 'preflight', rootDir, findings);
  const preflight = evidence?.parsed;
  if (!preflight) return null;

  const preflightRootDir = evidence.resolvedPath ? path.dirname(evidence.resolvedPath) : rootDir;
  const result = validateApiPreflight(preflight, { rootDir: preflightRootDir });
  if (!result.valid) {
    add(findings, 'MTR-PREFLIGHT-001', 'referenced API preflight did not pass validation.', 'preflight.filePath', 'Run metro api preflight validate on the referenced file and fix all findings.');
  }
  if (input.preflight?.validationResult !== 'passed') {
    add(findings, 'MTR-PREFLIGHT-001', 'preflight.validationResult must be passed.', 'preflight.validationResult', 'Only passing local API preflight evidence can satisfy an apply gate.');
  }
  if (preflight.previewBinding?.endpointId !== input.binding?.endpointId) {
    add(findings, 'MTR-ENDPOINT-001', 'preflight endpoint must match the apply gate endpoint.', 'preflight.filePath', 'Use preflight evidence for the same endpoint.');
  }
  if (preflight.previewBinding?.tenant !== input.binding?.tenant) {
    add(findings, 'MTR-TENANT-001', 'preflight tenant must match binding.tenant.', 'preflight.filePath', 'Use preflight evidence generated for the same tenant.');
  }
  if (preflight.previewBinding?.payloadHash !== input.binding?.payloadHash || preflight.previewBinding?.payloadHash !== input.preflight?.payloadHash) {
    add(findings, 'MTR-TENANT-002', 'preflight payload hash must match binding.payloadHash and preflight.payloadHash.', 'preflight.payloadHash', 'Regenerate the gate if preflight evidence changed.');
  }
  if (preflight.previewBinding?.requestHash !== input.binding?.requestHash) {
    add(findings, 'MTR-HASH-002', 'preflight request hash must match binding.requestHash.', 'preflight.filePath', 'Regenerate the gate if request evidence changed.');
  }
  if (preview?.parsed && !preflightMatchesPreview(preflight, preview.parsed)) {
    add(findings, 'MTR-PREFLIGHT-001', 'preflight must bind to the exact reviewed preview file.', 'preflight.filePath', 'Use preflight evidence generated from the referenced preview.');
  }

  return { ...evidence, result };
}

function validateTenantProfile(input, findings) {
  const profile = input.tenantProfile;
  if (!isObject(profile)) {
    add(findings, 'MTR-TENANT-001', 'tenantProfile is required.', 'tenantProfile', 'Bind the apply gate to one reviewed tenant profile resolution artifact.');
    return;
  }
  requireFilled(findings, profile.profileName, 'tenantProfile.profileName', 'tenantProfile.profileName is required.', 'Record the named tenant profile that a future runner would use.', 'MTR-TENANT-001');
  if (profile.tenant !== input.binding?.tenant) {
    add(findings, 'MTR-TENANT-001', 'tenantProfile.tenant must match binding.tenant.', 'tenantProfile.tenant', 'Use one tenant consistently across preview, preflight, and apply-gate evidence.');
  }
  requireFilled(findings, profile.keyEnv, 'tenantProfile.keyEnv', 'tenantProfile.keyEnv is required.', 'Record the environment variable name only, never its value.', 'MTR-TENANT-001');
  requireFilled(findings, profile.keyFingerprint, 'tenantProfile.keyFingerprint', 'tenantProfile.keyFingerprint is required.', 'Record a non-secret key fingerprint, never the raw key.', 'MTR-TENANT-004');
  if (profile.profileBindingConfirmed !== true) {
    add(findings, 'MTR-TENANT-001', 'tenantProfile.profileBindingConfirmed must be true.', 'tenantProfile.profileBindingConfirmed', 'Review the profile/tenant binding before future expert apply evidence can pass.');
  }
  if (input.binding?.tenant === 'production' && !/PROD|PRODUCTION/.test(String(profile.keyEnv || ''))) {
    add(findings, 'MTR-TENANT-001', 'production API apply gate must name a production Metronome key environment variable.', 'tenantProfile.keyEnv', 'Use a production-scoped key env var name such as METRONOME_PROD_KEY.');
  }
  if (input.binding?.tenant === 'sandbox' && !/SANDBOX|TEST/.test(String(profile.keyEnv || ''))) {
    add(findings, 'MTR-TENANT-001', 'sandbox API apply gate must name a sandbox Metronome key environment variable.', 'tenantProfile.keyEnv', 'Use a sandbox-scoped key env var name such as METRONOME_SANDBOX_KEY.');
  }
  if (isObject(input.keyFingerprint)) {
    if (profile.keyEnv !== input.keyFingerprint.envVar) {
      add(findings, 'MTR-TENANT-004', 'tenantProfile.keyEnv must match keyFingerprint.envVar.', 'tenantProfile.keyEnv', 'Regenerate the apply gate from the reviewed tenant profile resolution evidence.');
    }
    if (profile.keyFingerprint !== input.keyFingerprint.previewFingerprint) {
      add(findings, 'MTR-TENANT-004', 'tenantProfile.keyFingerprint must match keyFingerprint.previewFingerprint.', 'tenantProfile.keyFingerprint', 'Regenerate the apply gate from the reviewed tenant profile resolution evidence.');
    }
    if (profile.keyFingerprint !== input.keyFingerprint.applyFingerprint) {
      add(findings, 'MTR-TENANT-004', 'tenantProfile.keyFingerprint must match keyFingerprint.applyFingerprint.', 'tenantProfile.keyFingerprint', 'Restart approval if the tenant key fingerprint changed before apply.');
    }
  }
}

function validateSandboxProofFile(input, endpoint, rootDir, findings) {
  const proofRequired = endpoint?.operationType === 'write';
  if (input.sandboxProof?.required !== proofRequired) {
    add(findings, 'MTR-VERIFY-003', `sandboxProof.required must be ${proofRequired}.`, 'sandboxProof.required', 'Write endpoints require sandbox proof before future apply can be gated.');
  }
  if (!proofRequired) return { required: false, result: null };

  const evidence = validateFileEvidence(input.sandboxProof, 'sandboxProof', rootDir, findings);
  const proof = evidence?.parsed;
  if (!proof) return { required: true, result: null };

  const expectedBindingMode = sandboxProofBindingMode(input.binding?.tenant);
  const proofRequestHash = sandboxProofRequestHash(proof);
  const proofPayloadHash = sandboxProofPayloadHash(proof);
  const proofPreflightPayloadHash = sandboxProofPreflightPayloadHash(proof);
  const result = validateApiSandboxProof(proof, {
    endpointId: input.binding?.endpointId,
    tenant: 'sandbox',
    requestHash: input.binding?.requestHash,
    ...(input.binding?.tenant === 'sandbox'
      ? {
        payloadHash: input.binding?.payloadHash,
        preflightPayloadHash: input.preflight?.payloadHash,
      }
      : {}),
  });
  if (input.sandboxProof?.bindingMode !== expectedBindingMode) {
    add(
      findings,
      'MTR-PROOF-002',
      `sandboxProof.bindingMode must be ${expectedBindingMode}.`,
      'sandboxProof.bindingMode',
      'Regenerate the apply gate so sandbox and production gates use the correct sandbox-proof binding mode.',
    );
  }
  if (input.sandboxProof?.expectedTenant !== 'sandbox') {
    add(findings, 'MTR-TENANT-001', 'sandboxProof.expectedTenant must be sandbox.', 'sandboxProof.expectedTenant', 'Sandbox proof must always come from the sandbox tenant before future apply eligibility.');
  }
  if (isSha256(input.sandboxProof?.sandboxRequestHash) && proofRequestHash !== input.sandboxProof.sandboxRequestHash) {
    add(findings, 'MTR-HASH-002', 'sandboxProof.sandboxRequestHash must match the referenced sandbox proof file.', 'sandboxProof.sandboxRequestHash', 'Regenerate the apply gate from the reviewed sandbox proof file.');
  }
  if (isSha256(input.sandboxProof?.sandboxPayloadHash) && proofPayloadHash !== input.sandboxProof.sandboxPayloadHash) {
    add(findings, 'MTR-HASH-002', 'sandboxProof.sandboxPayloadHash must match the referenced sandbox proof file.', 'sandboxProof.sandboxPayloadHash', 'Regenerate the apply gate from the reviewed sandbox proof file.');
  }
  if (isSha256(input.sandboxProof?.sandboxPreflightPayloadHash) && proofPreflightPayloadHash !== input.sandboxProof.sandboxPreflightPayloadHash) {
    add(findings, 'MTR-HASH-002', 'sandboxProof.sandboxPreflightPayloadHash must match the referenced sandbox proof file.', 'sandboxProof.sandboxPreflightPayloadHash', 'Regenerate the apply gate from the reviewed sandbox proof file.');
  }
  if (input.binding?.tenant === 'production' && input.sandboxProof?.productionPreviewPayloadHash !== input.binding?.payloadHash) {
    add(
      findings,
      'MTR-TENANT-002',
      'sandboxProof.productionPreviewPayloadHash must match the production apply-gate payload hash.',
      'sandboxProof.productionPreviewPayloadHash',
      'Bind production approval to the production preview hash while binding sandbox proof by request hash.',
    );
  }
  if (input.binding?.tenant === 'sandbox' && input.sandboxProof?.productionPreviewPayloadHash !== null) {
    add(findings, 'MTR-TENANT-002', 'sandboxProof.productionPreviewPayloadHash must be null for sandbox apply gates.', 'sandboxProof.productionPreviewPayloadHash', 'Only production gates need to record a distinct production preview payload hash.');
  }
  if (input.sandboxProof?.requestHashBinding?.matchRequired !== true) {
    add(findings, 'MTR-HASH-001', 'sandboxProof.requestHashBinding.matchRequired must be true.', 'sandboxProof.requestHashBinding.matchRequired', 'Every write apply gate must bind sandbox proof to the reviewed request hash.');
  }
  if (input.sandboxProof?.requestHashBinding?.expectedRequestHash !== input.binding?.requestHash) {
    add(findings, 'MTR-HASH-002', 'sandboxProof.requestHashBinding.expectedRequestHash must match binding.requestHash.', 'sandboxProof.requestHashBinding.expectedRequestHash', 'Regenerate the apply gate from the reviewed preview and sandbox proof files.');
  }
  if (input.sandboxProof?.requestHashBinding?.matchResult !== true) {
    add(findings, 'MTR-HASH-002', 'sandboxProof.requestHashBinding.matchResult must be true.', 'sandboxProof.requestHashBinding.matchResult', 'Use sandbox proof generated from the same canonical endpoint request.');
  }
  if (!result.valid) {
    add(findings, 'MTR-PROOF-001', 'referenced API sandbox proof did not pass validation.', 'sandboxProof.filePath', 'Fix the sandbox proof manifest before this apply gate can pass.');
  }
  if (input.sandboxProof?.validationResult !== 'passed') {
    add(findings, 'MTR-PROOF-001', 'sandboxProof.validationResult must be passed.', 'sandboxProof.validationResult', 'Only passing sandbox proof can satisfy a write apply gate.');
  }
  return { ...evidence, required: true, result };
}

function validateApproval(input, findings) {
  const approval = input.approval;
  if (!isObject(approval)) {
    add(findings, 'MTR-API-APPLY-GATE-001', 'approval is required.', 'approval', 'Record explicit approval evidence.');
    return;
  }
  requireFilled(findings, approval.approvalId, 'approval.approvalId', 'approval.approvalId is required.', 'Record the approval ID for this exact reviewed preview hash.');
  requireFilled(findings, approval.owner, 'approval.owner', 'approval.owner is required.', 'Record the accountable billing operations owner.');
  if (approval.confirmHash !== input.binding?.payloadHash) {
    add(findings, 'MTR-TENANT-002', 'approval.confirmHash must match binding.payloadHash.', 'approval.confirmHash', 'Bind approval to the exact reviewed API preview hash.');
  }
  if (input.binding?.tenant === 'production' && approval.productionConfirmation !== input.binding?.payloadHash) {
    add(findings, 'MTR-TENANT-002', 'production apply gate requires approval.productionConfirmation to equal the reviewed preview hash.', 'approval.productionConfirmation', 'Paste the exact preview hash into productionConfirmation after approval.');
  }
  if (input.binding?.tenant === 'sandbox' && !filled(approval.productionConfirmation)) {
    add(findings, 'MTR-TENANT-002', 'sandbox apply gate must explicitly mark productionConfirmation not required.', 'approval.productionConfirmation', 'Use not_required_for_sandbox for sandbox-only apply-gate evidence.');
  }
}

function validateFingerprint(input, findings) {
  const fingerprint = input.keyFingerprint;
  if (!isObject(fingerprint)) {
    add(findings, 'MTR-TENANT-004', 'keyFingerprint is required.', 'keyFingerprint', 'Record non-secret key fingerprint metadata.');
    return;
  }
  for (const field of ['envVar', 'previewFingerprint', 'applyFingerprint']) {
    requireFilled(findings, fingerprint[field], `keyFingerprint.${field}`, `keyFingerprint.${field} is required.`, 'Record non-secret fingerprint fields; never record raw keys.', 'MTR-TENANT-004');
  }
  if (input.binding?.tenant === 'production' && !/PROD|PRODUCTION/.test(String(fingerprint.envVar || ''))) {
    add(findings, 'MTR-TENANT-001', 'production API apply gate must name a production Metronome key environment variable.', 'keyFingerprint.envVar', 'Use a production-scoped key env var name such as METRONOME_PROD_KEY.');
  }
  if (input.binding?.tenant === 'sandbox' && !/SANDBOX|TEST/.test(String(fingerprint.envVar || ''))) {
    add(findings, 'MTR-TENANT-001', 'sandbox API apply gate must name a sandbox Metronome key environment variable.', 'keyFingerprint.envVar', 'Use a sandbox-scoped key env var name such as METRONOME_SANDBOX_KEY.');
  }
  if (filled(fingerprint.previewFingerprint) && filled(fingerprint.applyFingerprint)
    && fingerprint.previewFingerprint !== fingerprint.applyFingerprint) {
    add(findings, 'MTR-TENANT-004', 'keyFingerprint.applyFingerprint must match keyFingerprint.previewFingerprint.', 'keyFingerprint.applyFingerprint', 'Restart approval if the tenant key fingerprint changed between preview and apply.');
  }
}

function validateOperationalEvidence(input, findings) {
  requireFilled(findings, input.auditLog?.destination, 'auditLog.destination', 'auditLog.destination is required.', 'Record the JSONL audit log path the future apply runner must write.', 'MTR-AUDIT-001');
  if (input.auditLog?.writerImplementedInCurrentCli !== false) {
    add(findings, 'MTR-AUDIT-001', 'auditLog.writerImplementedInCurrentCli must be false.', 'auditLog.writerImplementedInCurrentCli', 'Do not claim audit writing exists for expert API apply in this CLI slice.');
  }
  if (input.verification?.readBackRequired !== true) {
    add(findings, 'MTR-VERIFY-001', 'verification.readBackRequired must be true.', 'verification.readBackRequired', 'Every future expert apply requires read-back verification.');
  }
  if (input.verification?.runnerImplementedInCurrentCli !== false) {
    add(findings, 'MTR-VERIFY-001', 'verification.runnerImplementedInCurrentCli must be false.', 'verification.runnerImplementedInCurrentCli', 'Do not claim expert API read-back automation exists in this CLI slice.');
  }
  if (!list(input.verification?.checks).some((check) => filled(check?.expectation))) {
    add(findings, 'MTR-VERIFY-001', 'verification.checks must include at least one read-back expectation.', 'verification.checks', 'Carry forward the read-back plan from the API preview or preflight.');
  }
  if (input.rollback?.reviewed !== true || !filled(input.rollback?.owner) || !filled(input.rollback?.plan)) {
    add(findings, 'MTR-VERIFY-002', 'rollback.reviewed=true, rollback.owner, and rollback.plan are required.', 'rollback', 'Record rollback or remediation ownership before future apply can be gated.');
  }
  if (input.idempotency?.reviewed !== true || !filled(input.idempotency?.duplicatePrevention)) {
    add(findings, 'MTR-IDEMP-001', 'idempotency.reviewed=true and idempotency.duplicatePrevention are required.', 'idempotency', 'Review uniqueness keys or duplicate-prevention strategy before future apply.');
  }
  if (input.futureApply?.enabledInCurrentCli !== false) {
    add(findings, 'MTR-API-APPLY-GATE-003', 'futureApply.enabledInCurrentCli must be false.', 'futureApply.enabledInCurrentCli', 'Do not use the manifest to enable expert API apply execution.');
  }
}

function validateApiApplyGate(input, options = {}) {
  const rootDir = options.rootDir || process.cwd();
  const findings = [];
  scanForSecrets(input, findings);

  if (!isObject(input)) {
    return {
      schemaVersion: API_APPLY_GATE_VALIDATION_SCHEMA_VERSION,
      valid: false,
      apiAccess: 'none',
      liveExecution: clone(LOCAL_ONLY_LIVE_EXECUTION),
      applyEnabledInCurrentCli: false,
      findings: [finding('MTR-API-APPLY-GATE-000', 'error', 'API apply-gate manifest must be a JSON object.', '$', 'Start from metro api apply-gate template.')],
      summary: {
        previewValidated: false,
        preflightValidated: false,
        sandboxProofValidated: false,
      },
    };
  }

  if (input.schemaVersion !== API_APPLY_GATE_SCHEMA_VERSION) {
    add(findings, 'MTR-API-APPLY-GATE-001', `schemaVersion must be ${API_APPLY_GATE_SCHEMA_VERSION}.`, 'schemaVersion', 'Start from the current metro api apply-gate template.');
  }
  if (input.apiAccess !== 'none') {
    add(findings, 'MTR-API-APPLY-GATE-003', 'apiAccess must remain none.', 'apiAccess', 'Expert API apply-gate evidence must not claim live API access.');
  }
  if (input.applyEnabledInCurrentCli !== false) {
    add(findings, 'MTR-API-APPLY-GATE-003', 'applyEnabledInCurrentCli must be false.', 'applyEnabledInCurrentCli', 'Do not mark expert API apply enabled until a guarded runner exists.');
  }
  if (input.liveExecution?.enabledInCurrentCli !== false) {
    add(findings, 'MTR-API-APPLY-GATE-003', 'liveExecution.enabledInCurrentCli must be false.', 'liveExecution.enabledInCurrentCli', 'This CLI release must keep expert API live execution disabled.');
  }
  if (input.status !== 'reviewed') {
    add(findings, 'MTR-API-APPLY-GATE-001', 'status must be reviewed.', 'status', 'Only reviewed apply-gate manifests can pass validation.');
  }

  const endpoint = getApiEndpoint(input.binding?.endpointId || input.endpoint?.id);
  if (!endpoint) {
    add(findings, 'MTR-ENDPOINT-001', 'binding.endpointId must name a reviewed API endpoint.', 'binding.endpointId', 'Use metro api catalog to choose a reviewed endpoint ID.');
  }

  validateBinding(input, endpoint, findings);
  validateEndpointSnapshot(input, endpoint, findings);
  const previewEvidence = validatePreviewFile(input, endpoint, rootDir, findings);
  const preflightEvidence = validatePreflightFile(input, previewEvidence, rootDir, findings);
  const sandboxProofEvidence = validateSandboxProofFile(input, endpoint, rootDir, findings);
  validateTenantProfile(input, findings);
  const profileResolutionValidated = validateProfileResolutionEvidence({
    input,
    rootDir,
    findings,
    addFinding: (id, message, pathName, remediation) => add(findings, id, message, pathName, remediation),
    scanForSecrets,
    required: true,
    localOnlyFindingId: 'MTR-API-APPLY-GATE-003',
    targetLabel: 'apply gate',
    expectedTenant: input.binding?.tenant,
    expectedTenantPath: 'binding.tenant',
    consistencyContext: 'profile resolution, preview, preflight, and apply gate',
  });
  validateApproval(input, findings);
  validateFingerprint(input, findings);
  validateOperationalEvidence(input, findings);

  const valid = !findings.some((item) => item.severity === 'error');
  return {
    schemaVersion: API_APPLY_GATE_VALIDATION_SCHEMA_VERSION,
    generatedFrom: 'metronome-cli/src/api-catalog/apply-gate.js',
    apiAccess: 'none',
    liveExecution: clone(LOCAL_ONLY_LIVE_EXECUTION),
    applyEnabledInCurrentCli: false,
    summary: {
      endpointId: input.binding?.endpointId || input.endpoint?.id || null,
      tenant: input.binding?.tenant || null,
      operationType: input.binding?.operationType || endpoint?.operationType || null,
      permissionScope: input.binding?.permissionScope || endpoint?.permissionScope || null,
      payloadHash: input.binding?.payloadHash || null,
      requestHash: input.binding?.requestHash || null,
      previewFileHash: previewEvidence?.fileHash || input.preview?.fileHash || null,
      preflightFileHash: preflightEvidence?.fileHash || input.preflight?.fileHash || null,
      sandboxProofRequired: endpoint?.operationType === 'write',
      sandboxProofFileHash: sandboxProofEvidence?.fileHash || input.sandboxProof?.fileHash || null,
      sandboxProofBindingMode: input.sandboxProof?.bindingMode || null,
      sandboxProofRequestHash: sandboxProofRequestHash(sandboxProofEvidence?.parsed) || input.sandboxProof?.sandboxRequestHash || null,
      sandboxProofPayloadHash: sandboxProofPayloadHash(sandboxProofEvidence?.parsed) || input.sandboxProof?.sandboxPayloadHash || null,
      previewValidated: Boolean(previewEvidence?.valid),
      preflightValidated: Boolean(preflightEvidence?.result?.valid),
      sandboxProofValidated: Boolean(sandboxProofEvidence?.result?.valid),
      tenantProfileBound: input.tenantProfile?.profileBindingConfirmed === true,
      tenantProfileResolutionValidated: profileResolutionValidated,
      auditDestination: input.auditLog?.destination || null,
    },
    valid,
    findings,
    nextSafeStep: valid
      ? 'Keep this as local apply-gate evidence. Expert API apply remains disabled until guarded runners, durable approvals, audit writing, read-back verification, and explicit current-turn authorization exist.'
      : 'Fix the API apply-gate manifest and re-run metro api apply-gate validate before considering any future expert API apply approval.',
  };
}

module.exports = {
  API_APPLY_GATE_SCHEMA_VERSION,
  API_APPLY_GATE_VALIDATION_SCHEMA_VERSION,
  API_SANDBOX_PROOF_SCHEMA_VERSION,
  API_SANDBOX_PROOF_VALIDATION_SCHEMA_VERSION,
  apiApplyGateCoverage,
  apiSandboxProofCoverage,
  buildApiApplyGateTemplate,
  buildApiSandboxProofTemplate,
  validateApiApplyGate,
  validateApiSandboxProof,
};
