'use strict';

const { apiCatalog } = require('./index');
const { apiApplyGateCoverage, apiSandboxProofCoverage } = require('./apply-gate');
const { apiApplyAuditCoverage } = require('./apply-audit');
const { apiApplyResultCoverage } = require('./apply-result');
const { apiApplyReadbackCoverage } = require('./apply-readback');
const { apiApprovalRecordCoverage } = require('./approval-record');
const { apiPreflightCoverage } = require('./preflight');
const { apiPreviewCoverage } = require('./preview');
const { apiReadPlanCoverage } = require('./read-plan');
const { apiRequestValidationCoverage } = require('./validation');
const {
  isLiveApplySandboxEndpoint,
  isLiveReadEndpoint,
  LIVE_APPLY_SANDBOX_ENDPOINT_IDS,
  LIVE_READ_ENDPOINT_IDS,
} = require('../clients/live-endpoints');

const API_READINESS_SCHEMA_VERSION = 'metro.api.readiness.v1';
const API_READINESS_SUMMARY_SCHEMA_VERSION = 'metro.api.readiness.summary.v1';

const WRITE_PROOF_LADDER = [
  {
    order: 1,
    id: 'request-validation',
    readinessField: 'requestValidator',
    command: 'metro api validate <endpoint-id> --file <request.json|yaml> [--json]',
    proves: 'Request body, path parameters, query placement, tenant-independent endpoint shape, and secret-free input are locally valid for the reviewed endpoint ID.',
    unlocks: 'local-api-preview',
  },
  {
    order: 2,
    id: 'local-api-preview',
    readinessField: 'localPreview',
    command: 'metro api preview <endpoint-id> --file <request.json|yaml> (--sandbox|--prod) [--json]',
    proves: 'The reviewed request can be normalized into a deterministic local preview with request hash, payload hash, permission scope, side-effect profile, and no live execution.',
    unlocks: 'api-preflight',
  },
  {
    order: 3,
    id: 'api-preflight',
    readinessField: 'apiPreflight',
    command: 'metro api preflight template --preview <api-preview.json> [--profile-resolution <profile-resolution.json>] [--approval-id <id>] [--json]',
    validationCommand: 'metro api preflight validate --file <api-preflight.json> [--json]',
    proves: 'The preview has reviewed tenant/profile binding, idempotency, audit destination, read-back plan, rollback or remediation planning, and required approval context.',
    unlocks: 'api-sandbox-proof',
  },
  {
    order: 4,
    id: 'api-sandbox-proof',
    readinessField: 'apiSandboxProof',
    command: 'metro api sandbox-proof template --preview <api-preview.json> --preflight <api-preflight.json> [--reviewed-by <reviewer>] [--owner <owner>] [--json]',
    validationCommand: 'metro api sandbox-proof validate --file <api-sandbox-proof.json> [--json]',
    proves: 'Sandbox canary, read-back, invoice behavior, rollback, and remediation evidence can be bound to the exact preview request hash before any production gate.',
    unlocks: 'api-apply-gate',
  },
  {
    order: 5,
    id: 'api-apply-gate',
    readinessField: 'apiApplyGate',
    command: 'metro api apply-gate template --preview <api-preview.json> --preflight <api-preflight.json> [--sandbox-proof <sandbox-proof.json>] [--profile-resolution <profile-resolution.json>] [--json]',
    validationCommand: 'metro api apply-gate validate --file <api-apply-gate.json> [--json]',
    proves: 'Reviewed preview, preflight, sandbox proof, tenant profile, key fingerprint, audit destination, read-back plan, rollback or remediation plan, and idempotency review are hash-bound.',
    unlocks: 'api-approval-record',
  },
  {
    order: 6,
    id: 'api-approval-record',
    readinessField: 'apiApprovalRecord',
    command: 'metro api approval-record template --apply-gate <api-apply-gate.json> [--approval-id <id>] [--requested-by <id>] [--approved-by <name>] [--owner <owner>] [--business-purpose <text>] [--expires-at <ISO>] [--json]',
    validationCommand: 'metro api approval-record validate --file <api-approval-record.json> [--json]',
    proves: 'A durable approval record can bind owner approval to the validated apply gate while still requiring exact current-turn authorization for any future live execution.',
    unlocks: 'api-apply-audit',
  },
  {
    order: 7,
    id: 'api-apply-audit',
    readinessField: 'apiApplyAudit',
    command: 'metro api apply-audit write --approval-record <api-approval-record.json> --out <api-apply-audit.jsonl> --actor <id> (--dry-run|--write) [--timestamp <ISO>] [--json]',
    validationCommand: 'metro api apply-audit validate --file <api-apply-audit.jsonl> [--json]',
    proves: 'A planned audit row can bind approval, tenant profile, request hash, payload hash, rollback, read-back, and idempotency evidence without capturing reusable live authorization.',
    unlocks: 'api-apply-readback',
  },
  {
    order: 8,
    id: 'api-apply-readback',
    readinessField: 'apiApplyReadback',
    command: 'metro api apply-readback verify --apply-audit <api-apply-audit.jsonl> --read-result <api-read-result.json> [--row <n>] [--json]',
    proves: 'Read-back evidence is compatible with the planned write endpoint, tenant, and audit row before any apply-result record claims semantic success.',
    unlocks: 'api-apply-result',
  },
  {
    order: 9,
    id: 'api-apply-result',
    readinessField: 'apiApplyResult',
    command: 'metro api apply-result template --apply-audit <api-apply-audit.jsonl> --apply-readback <api-apply-readback.json> [--row <n>] [--json]',
    validationCommand: 'metro api apply-result validate --file <api-apply-result.json> --apply-audit <api-apply-audit.jsonl> --apply-readback <api-apply-readback.json> [--row <n>] [--json]',
    proves: 'A future guarded runner result can record current-turn authorization capture, response hash, response object IDs, live audit row hash, semantic read-back success, rollback/remediation, idempotency review, and secret-free evidence.',
    unlocks: 'future-guarded-apply-runner-only',
  },
];

// Local read-evidence examples (request, read gate, mock response, audit
// fixtures) are not shipped in this repository, so no endpoint claims
// checked-in example coverage. Add entries here only together with the
// example files they cite.
const READ_PLAN_GOLDEN_EXAMPLES = [];
const READ_PIPELINE_GOLDEN_EXAMPLES = [];

const READ_MOCK_EXAMPLES = READ_PIPELINE_GOLDEN_EXAMPLES.map(readMockExampleFromPipeline);

const PERSISTED_READ_AUDIT_EXAMPLES = [];

function readMockExampleFromPipeline(example) {
  const coverageType = example.coverageType.replace(/-audit-dry-run$/, '-mocked-read');
  return {
    endpointId: example.endpointId,
    coverageType,
    result: example.result,
    tenant: example.tenant,
    fixturePath: example.fixturePath,
    readGatePath: example.readGatePath,
    mockResponsePath: example.mockResponsePath,
    command: `metro api read-mock ${example.endpointId} --file ${example.fixturePath} --read-gate ${example.readGatePath} --mock-response ${example.mockResponsePath} --actor agent-local-test --json`,
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function examplesByEndpoint(examples) {
  return examples.reduce((groups, example) => {
    if (!groups[example.endpointId]) groups[example.endpointId] = [];
    groups[example.endpointId].push(clone(example));
    return groups;
  }, {});
}

function sortedUnique(values) {
  return [...new Set(values)].sort();
}

function writeProofLadder() {
  return WRITE_PROOF_LADDER.map((step) => ({
    ...clone(step),
    apiAccess: 'none',
    liveExecutionEnabledInCurrentCli: false,
    applyEnabledInCurrentCli: false,
  }));
}

function readinessFor({
  endpoint,
  validationCoverage,
  readPlanCoverage,
  goldenExamples,
  readMockExamples,
  readPipelineGoldenExamples,
  persistedReadAuditExamples,
}) {
  const validation = validationCoverage[endpoint.id];
  const readPlan = readPlanCoverage[endpoint.id];
  const hasEndpointSpecificValidator = validation?.supportStatus === 'endpoint-specific';
  const hasLocalReadPlan = readPlan?.supportStatus === 'local-read-plan';
  const hasGoldenOutputCoverage = goldenExamples.length > 0;
  const hasReadMockCoverage = readMockExamples.length > 0;
  const hasReadPipelineGoldenOutputCoverage = readPipelineGoldenExamples.length > 0;
  const hasPersistedReadAuditCoverage = persistedReadAuditExamples.length > 0;
  const missingEvidence = [];

  if (!hasEndpointSpecificValidator) missingEvidence.push('endpoint-specific validator');
  if (!hasLocalReadPlan) missingEvidence.push('local read-plan coverage');
  if (!hasGoldenOutputCoverage) missingEvidence.push('read-plan golden output');
  if (!hasReadMockCoverage) missingEvidence.push('read-mock output evidence');
  if (!hasReadPipelineGoldenOutputCoverage) missingEvidence.push('read-pipeline golden output');
  if (!hasPersistedReadAuditCoverage) missingEvidence.push('persisted read-audit validation');

  return {
    endpointId: endpoint.id,
    family: endpoint.family,
    method: endpoint.method,
    path: endpoint.path,
    permissionScope: endpoint.permissionScope,
    supportStatus: endpoint.supportStatus,
    sourceIds: clone(endpoint.sourceIds),
    requestValidator: {
      status: validation?.supportStatus || 'missing',
      hasEndpointSpecificValidator,
      command: validation?.command || null,
      checked: validation?.checked ? clone(validation.checked) : [],
    },
    localReadPlan: {
      status: readPlan?.supportStatus || 'missing',
      hasLocalReadPlan,
      command: readPlan?.command || null,
      liveReadEnabledInCurrentCli: isLiveReadEndpoint(endpoint.id),
    },
    goldenOutput: {
      covered: hasGoldenOutputCoverage,
      exampleCount: goldenExamples.length,
      coverageTypes: sortedUnique(goldenExamples.map((example) => example.coverageType)),
      examples: clone(goldenExamples),
    },
    readMockOutput: {
      covered: hasReadMockCoverage,
      exampleCount: readMockExamples.length,
      coverageTypes: sortedUnique(readMockExamples.map((example) => example.coverageType)),
      examples: clone(readMockExamples),
    },
    readPipelineGoldenOutput: {
      covered: hasReadPipelineGoldenOutputCoverage,
      exampleCount: readPipelineGoldenExamples.length,
      coverageTypes: sortedUnique(readPipelineGoldenExamples.map((example) => example.coverageType)),
      examples: clone(readPipelineGoldenExamples),
    },
    persistedReadAuditOutput: {
      covered: hasPersistedReadAuditCoverage,
      exampleCount: persistedReadAuditExamples.length,
      coverageTypes: sortedUnique(persistedReadAuditExamples.map((example) => example.coverageType)),
      examples: clone(persistedReadAuditExamples),
    },
    readiness: missingEvidence.length === 0 ? 'full-local-read-evidence' : 'needs-local-read-evidence',
    missingEvidence,
    liveExecution: clone(endpoint.liveExecution),
    liveReadSupported: isLiveReadEndpoint(endpoint.id),
  };
}

function familyCoverageSummary(endpoints) {
  return sortedUnique(endpoints.map((endpoint) => endpoint.family)).map((family) => {
    const familyEndpoints = endpoints.filter((endpoint) => endpoint.family === family);
    const missingFor = (predicate) => familyEndpoints
      .filter((endpoint) => !predicate(endpoint))
      .map((endpoint) => endpoint.endpointId)
      .sort();

    return {
      family,
      readEndpoints: familyEndpoints.length,
      endpointSpecificValidators: familyEndpoints.filter((endpoint) => endpoint.requestValidator.hasEndpointSpecificValidator).length,
      readPlans: familyEndpoints.filter((endpoint) => endpoint.localReadPlan.hasLocalReadPlan).length,
      readMocks: familyEndpoints.filter((endpoint) => endpoint.readMockOutput.covered).length,
      readPipelines: familyEndpoints.filter((endpoint) => endpoint.readPipelineGoldenOutput.covered).length,
      persistedReadAudits: familyEndpoints.filter((endpoint) => endpoint.persistedReadAuditOutput.covered).length,
      missingValidatorEndpoints: missingFor((endpoint) => endpoint.requestValidator.hasEndpointSpecificValidator),
      missingReadPlanEndpoints: missingFor((endpoint) => endpoint.localReadPlan.hasLocalReadPlan),
      missingReadMockEndpoints: missingFor((endpoint) => endpoint.readMockOutput.covered),
      missingReadPipelineEndpoints: missingFor((endpoint) => endpoint.readPipelineGoldenOutput.covered),
      missingPersistedReadAuditEndpoints: missingFor((endpoint) => endpoint.persistedReadAuditOutput.covered),
    };
  });
}

function writeReadinessFor({
  endpoint,
  validationCoverage,
  previewCoverage,
  preflightCoverage,
  sandboxProofCoverage,
  applyGateCoverage,
  approvalRecordCoverage,
  applyAuditCoverage,
  applyResultCoverage,
  applyReadbackCoverage,
}) {
  const validation = validationCoverage[endpoint.id];
  const preview = previewCoverage[endpoint.id];
  const preflight = preflightCoverage[endpoint.id];
  const sandboxProof = sandboxProofCoverage[endpoint.id];
  const applyGate = applyGateCoverage[endpoint.id];
  const approvalRecord = approvalRecordCoverage[endpoint.id];
  const applyAudit = applyAuditCoverage[endpoint.id];
  const applyResult = applyResultCoverage[endpoint.id];
  const applyReadback = applyReadbackCoverage[endpoint.id];
  const hasEndpointSpecificValidator = validation?.supportStatus === 'endpoint-specific';
  const hasLocalPreview = preview?.supportStatus === 'local-preview-contract';
  const hasLocalPreflight = preflight?.supportStatus === 'local-preflight-contract';
  const hasLocalSandboxProof = sandboxProof?.supportStatus === 'local-sandbox-proof-template';
  const hasLocalApplyGate = applyGate?.supportStatus === 'local-apply-gate-manifest';
  const hasLocalApprovalRecord = approvalRecord?.supportStatus === 'local-approval-record';
  const hasLocalApplyAudit = applyAudit?.supportStatus === 'local-planned-apply-audit';
  const hasLocalApplyResult = applyResult?.supportStatus === 'local-apply-result-contract';
  const hasLocalApplyReadback = applyReadback?.supportStatus === 'local-apply-readback-verifier';
  const missingEvidence = [];

  if (!hasEndpointSpecificValidator) missingEvidence.push('endpoint-specific validator');
  if (!hasLocalPreview) missingEvidence.push('local api preview contract');
  if (!hasLocalPreflight) missingEvidence.push('local api preflight contract');
  if (!hasLocalSandboxProof) missingEvidence.push('local api sandbox-proof template');
  if (!hasLocalApplyGate) missingEvidence.push('local api apply-gate manifest');
  if (!hasLocalApprovalRecord) missingEvidence.push('local api approval-record contract');
  if (!hasLocalApplyAudit) missingEvidence.push('local api apply-audit contract');
  if (!hasLocalApplyReadback) missingEvidence.push('local api apply-readback verifier');
  if (!hasLocalApplyResult) missingEvidence.push('local api apply-result contract');

  return {
    endpointId: endpoint.id,
    family: endpoint.family,
    method: endpoint.method,
    path: endpoint.path,
    permissionScope: endpoint.permissionScope,
    supportStatus: endpoint.supportStatus,
    sourceIds: clone(endpoint.sourceIds),
    requestValidator: {
      status: validation?.supportStatus || 'missing',
      hasEndpointSpecificValidator,
      command: validation?.command || null,
      checked: validation?.checked ? clone(validation.checked) : [],
    },
    localPreview: {
      status: preview?.supportStatus || 'missing',
      hasLocalPreview,
      command: preview?.command || null,
      requiresValidation: preview?.requiresValidation || null,
      apiAccess: preview?.apiAccess || 'none',
    },
    apiPreflight: {
      status: preflight?.supportStatus || 'missing',
      hasLocalPreflight,
      command: preflight?.command || null,
      validationCommand: preflight?.validationCommand || null,
      requiredEvidence: preflight?.requiredEvidence ? clone(preflight.requiredEvidence) : [],
      apiAccess: preflight?.apiAccess || 'none',
    },
    apiSandboxProof: {
      status: sandboxProof?.supportStatus || 'missing',
      hasLocalSandboxProof,
      command: sandboxProof?.command || null,
      validationCommand: sandboxProof?.validationCommand || null,
      requiredEvidence: sandboxProof?.requiredEvidence ? clone(sandboxProof.requiredEvidence) : [],
      apiAccess: sandboxProof?.apiAccess || 'none',
    },
    apiApplyGate: {
      status: applyGate?.supportStatus || 'missing',
      hasLocalApplyGate,
      command: applyGate?.command || null,
      validationCommand: applyGate?.validationCommand || null,
      requiredEvidence: applyGate?.requiredEvidence ? clone(applyGate.requiredEvidence) : [],
      apiAccess: applyGate?.apiAccess || 'none',
    },
    apiApprovalRecord: {
      status: approvalRecord?.supportStatus || 'missing',
      hasLocalApprovalRecord,
      command: approvalRecord?.command || null,
      validationCommand: approvalRecord?.validationCommand || null,
      requiredEvidence: approvalRecord?.requiredEvidence ? clone(approvalRecord.requiredEvidence) : [],
      apiAccess: approvalRecord?.apiAccess || 'none',
      applyEnabledInCurrentCli: approvalRecord?.applyEnabledInCurrentCli === true,
    },
    apiApplyAudit: {
      status: applyAudit?.supportStatus || 'missing',
      hasLocalApplyAudit,
      templateCommand: applyAudit?.templateCommand || null,
      writeCommand: applyAudit?.writeCommand || null,
      validationCommand: applyAudit?.validationCommand || null,
      requiredEvidence: applyAudit?.requiredEvidence ? clone(applyAudit.requiredEvidence) : [],
      apiAccess: applyAudit?.apiAccess || 'none',
      applyEnabledInCurrentCli: applyAudit?.applyEnabledInCurrentCli === true,
    },
    apiApplyReadback: {
      status: applyReadback?.supportStatus || 'missing',
      hasLocalApplyReadback,
      verificationCommand: applyReadback?.verificationCommand || null,
      requiredEvidence: applyReadback?.requiredEvidence ? clone(applyReadback.requiredEvidence) : [],
      apiAccess: applyReadback?.apiAccess || 'none',
      applyEnabledInCurrentCli: applyReadback?.applyEnabledInCurrentCli === true,
      readEnabledInCurrentCli: applyReadback?.readEnabledInCurrentCli === true,
    },
    apiApplyResult: {
      status: applyResult?.supportStatus || 'missing',
      hasLocalApplyResult,
      templateCommand: applyResult?.templateCommand || null,
      validationCommand: applyResult?.validationCommand || null,
      requiredEvidence: applyResult?.requiredEvidence ? clone(applyResult.requiredEvidence) : [],
      apiAccess: applyResult?.apiAccess || 'none',
      applyEnabledInCurrentCli: applyResult?.applyEnabledInCurrentCli === true,
      liveApplyAuthorizedByThisRecord: applyResult?.liveApplyAuthorizedByThisRecord === true,
    },
    sideEffectProfile: endpoint.sideEffectProfile ? {
      riskClass: endpoint.sideEffectProfile.riskClass,
      requiredReviews: clone(endpoint.sideEffectProfile.requiredReviews),
    } : null,
    readiness: missingEvidence.length === 0 ? 'local-write-proof-ladder-mapped' : 'needs-local-write-proof-ladder',
    missingEvidence,
    liveExecution: clone(endpoint.liveExecution),
    liveWriteSupported: isLiveApplySandboxEndpoint(endpoint.id),
    applyEnabledInCurrentCli: isLiveApplySandboxEndpoint(endpoint.id),
  };
}

function writeFamilyCoverageSummary(endpoints) {
  return sortedUnique(endpoints.map((endpoint) => endpoint.family)).map((family) => {
    const familyEndpoints = endpoints.filter((endpoint) => endpoint.family === family);
    const missingFor = (predicate) => familyEndpoints
      .filter((endpoint) => !predicate(endpoint))
      .map((endpoint) => endpoint.endpointId)
      .sort();

    return {
      family,
      writeEndpoints: familyEndpoints.length,
      endpointSpecificValidators: familyEndpoints.filter((endpoint) => endpoint.requestValidator.hasEndpointSpecificValidator).length,
      localPreviews: familyEndpoints.filter((endpoint) => endpoint.localPreview.hasLocalPreview).length,
      apiPreflights: familyEndpoints.filter((endpoint) => endpoint.apiPreflight.hasLocalPreflight).length,
      apiSandboxProofs: familyEndpoints.filter((endpoint) => endpoint.apiSandboxProof.hasLocalSandboxProof).length,
      apiApplyGates: familyEndpoints.filter((endpoint) => endpoint.apiApplyGate.hasLocalApplyGate).length,
      apiApprovalRecords: familyEndpoints.filter((endpoint) => endpoint.apiApprovalRecord.hasLocalApprovalRecord).length,
      apiApplyAudits: familyEndpoints.filter((endpoint) => endpoint.apiApplyAudit.hasLocalApplyAudit).length,
      apiApplyReadbacks: familyEndpoints.filter((endpoint) => endpoint.apiApplyReadback.hasLocalApplyReadback).length,
      apiApplyResults: familyEndpoints.filter((endpoint) => endpoint.apiApplyResult.hasLocalApplyResult).length,
      missingValidatorEndpoints: missingFor((endpoint) => endpoint.requestValidator.hasEndpointSpecificValidator),
      missingPreviewEndpoints: missingFor((endpoint) => endpoint.localPreview.hasLocalPreview),
      missingPreflightEndpoints: missingFor((endpoint) => endpoint.apiPreflight.hasLocalPreflight),
      missingSandboxProofEndpoints: missingFor((endpoint) => endpoint.apiSandboxProof.hasLocalSandboxProof),
      missingApplyGateEndpoints: missingFor((endpoint) => endpoint.apiApplyGate.hasLocalApplyGate),
      missingApprovalRecordEndpoints: missingFor((endpoint) => endpoint.apiApprovalRecord.hasLocalApprovalRecord),
      missingApplyAuditEndpoints: missingFor((endpoint) => endpoint.apiApplyAudit.hasLocalApplyAudit),
      missingApplyReadbackEndpoints: missingFor((endpoint) => endpoint.apiApplyReadback.hasLocalApplyReadback),
      missingApplyResultEndpoints: missingFor((endpoint) => endpoint.apiApplyResult.hasLocalApplyResult),
    };
  });
}

function readMissingEvidenceByCategory(endpoints) {
  return {
    missingValidatorEndpoints: endpoints
      .filter((endpoint) => !endpoint.requestValidator.hasEndpointSpecificValidator)
      .map((endpoint) => endpoint.endpointId)
      .sort(),
    missingReadPlanEndpoints: endpoints
      .filter((endpoint) => !endpoint.localReadPlan.hasLocalReadPlan)
      .map((endpoint) => endpoint.endpointId)
      .sort(),
    missingReadPlanGoldenEndpoints: endpoints
      .filter((endpoint) => !endpoint.goldenOutput.covered)
      .map((endpoint) => endpoint.endpointId)
      .sort(),
    missingReadMockEndpoints: endpoints
      .filter((endpoint) => !endpoint.readMockOutput.covered)
      .map((endpoint) => endpoint.endpointId)
      .sort(),
    missingReadPipelineGoldenEndpoints: endpoints
      .filter((endpoint) => !endpoint.readPipelineGoldenOutput.covered)
      .map((endpoint) => endpoint.endpointId)
      .sort(),
    missingPersistedReadAuditEndpoints: endpoints
      .filter((endpoint) => !endpoint.persistedReadAuditOutput.covered)
      .map((endpoint) => endpoint.endpointId)
      .sort(),
  };
}

function writeMissingEvidenceByCategory(endpoints) {
  return {
    missingValidatorEndpoints: endpoints
      .filter((endpoint) => !endpoint.requestValidator.hasEndpointSpecificValidator)
      .map((endpoint) => endpoint.endpointId)
      .sort(),
    missingPreviewEndpoints: endpoints
      .filter((endpoint) => !endpoint.localPreview.hasLocalPreview)
      .map((endpoint) => endpoint.endpointId)
      .sort(),
    missingPreflightEndpoints: endpoints
      .filter((endpoint) => !endpoint.apiPreflight.hasLocalPreflight)
      .map((endpoint) => endpoint.endpointId)
      .sort(),
    missingSandboxProofEndpoints: endpoints
      .filter((endpoint) => !endpoint.apiSandboxProof.hasLocalSandboxProof)
      .map((endpoint) => endpoint.endpointId)
      .sort(),
    missingApplyGateEndpoints: endpoints
      .filter((endpoint) => !endpoint.apiApplyGate.hasLocalApplyGate)
      .map((endpoint) => endpoint.endpointId)
      .sort(),
    missingApprovalRecordEndpoints: endpoints
      .filter((endpoint) => !endpoint.apiApprovalRecord.hasLocalApprovalRecord)
      .map((endpoint) => endpoint.endpointId)
      .sort(),
    missingApplyAuditEndpoints: endpoints
      .filter((endpoint) => !endpoint.apiApplyAudit.hasLocalApplyAudit)
      .map((endpoint) => endpoint.endpointId)
      .sort(),
    missingApplyReadbackEndpoints: endpoints
      .filter((endpoint) => !endpoint.apiApplyReadback.hasLocalApplyReadback)
      .map((endpoint) => endpoint.endpointId)
      .sort(),
    missingApplyResultEndpoints: endpoints
      .filter((endpoint) => !endpoint.apiApplyResult.hasLocalApplyResult)
      .map((endpoint) => endpoint.endpointId)
      .sort(),
  };
}

function readinessReportCommand(filters) {
  const familyFlag = filters?.family ? ` --family ${filters.family}` : '';
  return `metro api readiness${familyFlag} --json`;
}

function apiReadinessSummary(options = {}) {
  const family = options.family || null;
  const catalog = apiCatalog({ family });
  const applyGateCoverage = apiApplyGateCoverage();
  const applyAuditCoverage = apiApplyAuditCoverage();
  const applyResultCoverage = apiApplyResultCoverage();
  const applyReadbackCoverage = apiApplyReadbackCoverage();
  const approvalRecordCoverage = apiApprovalRecordCoverage();
  const sandboxProofCoverage = apiSandboxProofCoverage();
  const preflightCoverage = apiPreflightCoverage();
  const previewCoverage = apiPreviewCoverage();
  const validationCoverage = apiRequestValidationCoverage();
  const readPlanCoverage = apiReadPlanCoverage();
  const goldenByEndpoint = examplesByEndpoint(READ_PLAN_GOLDEN_EXAMPLES);
  const readMockByEndpoint = examplesByEndpoint(READ_MOCK_EXAMPLES);
  const readPipelineGoldenByEndpoint = examplesByEndpoint(READ_PIPELINE_GOLDEN_EXAMPLES);
  const persistedReadAuditByEndpoint = examplesByEndpoint(PERSISTED_READ_AUDIT_EXAMPLES);
  const readEndpoints = catalog.endpoints.filter((endpoint) => endpoint.operationType === 'read');
  const endpoints = readEndpoints.map((endpoint) => readinessFor({
    endpoint,
    validationCoverage,
    readPlanCoverage,
    goldenExamples: goldenByEndpoint[endpoint.id] || [],
    readMockExamples: readMockByEndpoint[endpoint.id] || [],
    readPipelineGoldenExamples: readPipelineGoldenByEndpoint[endpoint.id] || [],
    persistedReadAuditExamples: persistedReadAuditByEndpoint[endpoint.id] || [],
  }));
  const catalogWriteEndpoints = catalog.endpoints.filter((endpoint) => endpoint.operationType === 'write');
  const writeEndpoints = catalogWriteEndpoints.map((endpoint) => writeReadinessFor({
    endpoint,
    validationCoverage,
    previewCoverage,
    preflightCoverage,
    sandboxProofCoverage,
    applyGateCoverage,
    approvalRecordCoverage,
    applyAuditCoverage,
    applyResultCoverage,
    applyReadbackCoverage,
  }));
  const endpointSpecificValidatorCount = endpoints.filter((endpoint) => endpoint.requestValidator.hasEndpointSpecificValidator).length;
  const localReadPlanCount = endpoints.filter((endpoint) => endpoint.localReadPlan.hasLocalReadPlan).length;
  const goldenCoveredEndpointCount = endpoints.filter((endpoint) => endpoint.goldenOutput.covered).length;
  const readMockCoveredEndpointCount = endpoints.filter((endpoint) => endpoint.readMockOutput.covered).length;
  const readPipelineGoldenCoveredEndpointCount = endpoints.filter((endpoint) => endpoint.readPipelineGoldenOutput.covered).length;
  const persistedReadAuditCoveredEndpointCount = endpoints.filter((endpoint) => endpoint.persistedReadAuditOutput.covered).length;
  const writeEndpointSpecificValidatorCount = writeEndpoints.filter((endpoint) => endpoint.requestValidator.hasEndpointSpecificValidator).length;
  const localWritePreviewCount = writeEndpoints.filter((endpoint) => endpoint.localPreview.hasLocalPreview).length;
  const localApiPreflightCount = writeEndpoints.filter((endpoint) => endpoint.apiPreflight.hasLocalPreflight).length;
  const localApiSandboxProofCount = writeEndpoints.filter((endpoint) => endpoint.apiSandboxProof.hasLocalSandboxProof).length;
  const localApiApplyGateCount = writeEndpoints.filter((endpoint) => endpoint.apiApplyGate.hasLocalApplyGate).length;
  const localApiApprovalRecordCount = writeEndpoints.filter((endpoint) => endpoint.apiApprovalRecord.hasLocalApprovalRecord).length;
  const localApiApplyAuditCount = writeEndpoints.filter((endpoint) => endpoint.apiApplyAudit.hasLocalApplyAudit).length;
  const localApiApplyReadbackCount = writeEndpoints.filter((endpoint) => endpoint.apiApplyReadback.hasLocalApplyReadback).length;
  const localApiApplyResultCount = writeEndpoints.filter((endpoint) => endpoint.apiApplyResult.hasLocalApplyResult).length;

  return {
    schemaVersion: API_READINESS_SCHEMA_VERSION,
    generatedFrom: [
      'packages/metro-core/src/api-catalog/index.js',
      'packages/metro-core/src/api-catalog/apply-gate.js',
      'packages/metro-core/src/api-catalog/apply-audit.js',
      'packages/metro-core/src/api-catalog/apply-result.js',
      'packages/metro-core/src/api-catalog/apply-readback.js',
      'packages/metro-core/src/api-catalog/approval-record.js',
      'packages/metro-core/src/api-catalog/preflight.js',
      'packages/metro-core/src/api-catalog/preview.js',
      'packages/metro-core/src/api-catalog/readiness.js',
      'packages/metro-core/src/api-catalog/read-plan.js',
      'packages/metro-core/src/api-catalog/read-mock.js',
      'packages/metro-core/src/api-catalog/read-pipeline.js',
      'packages/metro-core/src/api-catalog/read-audit.js',
      'packages/metro-core/src/api-catalog/validation.js',
    ],
    apiAccess: 'none',
    liveExecution: clone(catalog.liveExecution),
    filters: { family },
    catalogEndpointCount: catalog.endpointCount,
    readEndpointCount: endpoints.length,
    writeEndpointCount: writeEndpoints.length,
    summary: {
      endpointSpecificValidators: endpointSpecificValidatorCount,
      localReadPlans: localReadPlanCount,
      goldenCoveredEndpoints: goldenCoveredEndpointCount,
      missingGoldenEndpoints: endpoints.length - goldenCoveredEndpointCount,
      readMockExamples: endpoints.reduce((count, endpoint) => count + endpoint.readMockOutput.exampleCount, 0),
      readMockCoveredEndpoints: readMockCoveredEndpointCount,
      missingReadMockEndpoints: endpoints.length - readMockCoveredEndpointCount,
      readPipelineGoldenExamples: endpoints.reduce((count, endpoint) => count + endpoint.readPipelineGoldenOutput.exampleCount, 0),
      readPipelineGoldenCoveredEndpoints: readPipelineGoldenCoveredEndpointCount,
      missingReadPipelineGoldenEndpoints: endpoints.length - readPipelineGoldenCoveredEndpointCount,
      persistedReadAuditExamples: endpoints.reduce((count, endpoint) => count + endpoint.persistedReadAuditOutput.exampleCount, 0),
      persistedReadAuditCoveredEndpoints: persistedReadAuditCoveredEndpointCount,
      missingPersistedReadAuditEndpoints: endpoints.length - persistedReadAuditCoveredEndpointCount,
      liveReadEnabledInCurrentCli: LIVE_READ_ENDPOINT_IDS.size > 0,
    },
    writeSummary: {
      endpointSpecificValidators: writeEndpointSpecificValidatorCount,
      localPreviews: localWritePreviewCount,
      missingLocalPreviews: writeEndpoints.length - localWritePreviewCount,
      apiPreflights: localApiPreflightCount,
      missingApiPreflights: writeEndpoints.length - localApiPreflightCount,
      apiSandboxProofs: localApiSandboxProofCount,
      missingApiSandboxProofs: writeEndpoints.length - localApiSandboxProofCount,
      apiApplyGates: localApiApplyGateCount,
      missingApiApplyGates: writeEndpoints.length - localApiApplyGateCount,
      apiApprovalRecords: localApiApprovalRecordCount,
      missingApiApprovalRecords: writeEndpoints.length - localApiApprovalRecordCount,
      apiApplyAudits: localApiApplyAuditCount,
      missingApiApplyAudits: writeEndpoints.length - localApiApplyAuditCount,
      apiApplyReadbacks: localApiApplyReadbackCount,
      missingApiApplyReadbacks: writeEndpoints.length - localApiApplyReadbackCount,
      apiApplyResults: localApiApplyResultCount,
      missingApiApplyResults: writeEndpoints.length - localApiApplyResultCount,
      applyEnabledInCurrentCli: LIVE_APPLY_SANDBOX_ENDPOINT_IDS.size > 0,
      liveWriteEnabledInCurrentCli: LIVE_APPLY_SANDBOX_ENDPOINT_IDS.size > 0,
    },
    writeProofLadder: writeProofLadder(),
    coverageByFamily: familyCoverageSummary(endpoints),
    writeCoverageByFamily: writeFamilyCoverageSummary(writeEndpoints),
    readinessStatuses: endpoints.reduce((counts, endpoint) => {
      counts[endpoint.readiness] = (counts[endpoint.readiness] || 0) + 1;
      return counts;
    }, {}),
    writeReadinessStatuses: writeEndpoints.reduce((counts, endpoint) => {
      counts[endpoint.readiness] = (counts[endpoint.readiness] || 0) + 1;
      return counts;
    }, {}),
    goldenCoverageTypes: sortedUnique(endpoints.flatMap((endpoint) => endpoint.goldenOutput.coverageTypes)),
    readMockCoverageTypes: sortedUnique(endpoints.flatMap((endpoint) => endpoint.readMockOutput.coverageTypes)),
    readPipelineGoldenCoverageTypes: sortedUnique(endpoints.flatMap((endpoint) => endpoint.readPipelineGoldenOutput.coverageTypes)),
    persistedReadAuditCoverageTypes: sortedUnique(endpoints.flatMap((endpoint) => endpoint.persistedReadAuditOutput.coverageTypes)),
    nextSafeStep: endpoints.every((endpoint) => endpoint.readiness === 'full-local-read-evidence')
      ? (LIVE_READ_ENDPOINT_IDS.size > 0
        ? `Guarded live reads are enabled for ${LIVE_READ_ENDPOINT_IDS.size} reviewed endpoint(s). Use metro api read with read-gate evidence and --confirm-live-read. Remaining read endpoints stay local-only until added to the live allowlist.`
        : 'All reviewed read endpoints have local read-plan goldens, read-mock evidence, read-pipeline audit dry-run goldens, and persisted read-audit validation proof. Live reads remain disabled until tenant profiles, guarded read clients, current-turn authorization, audit-safe request summaries, and stable output verification exist.')
      : 'Add local read-plan, read-mock, read-pipeline, and persisted read-audit evidence for endpoints marked needs-local-read-evidence before treating their output as a stable operator/agent contract. Live reads remain disabled.',
    writeNextSafeStep: writeEndpoints.every((endpoint) => endpoint.readiness === 'local-write-proof-ladder-mapped')
      ? (LIVE_APPLY_SANDBOX_ENDPOINT_IDS.size > 0
        ? `Guarded sandbox writes are enabled for ${LIVE_APPLY_SANDBOX_ENDPOINT_IDS.size} reviewed endpoint(s). Use metro api apply with apply-gate, approval-record, and --confirm-live-apply. Production writes and other endpoints stay blocked.`
        : 'All reviewed write endpoints have local request validators, api preview contracts, api preflight contracts, api sandbox-proof templates, api apply-gate manifests, approval-record contracts, planned apply-audit contracts, apply read-back verifiers, and apply-result contracts mapped. Expert API writes remain disabled until guarded apply runners, filled sandbox proof, live audit writing, semantic read-back execution, rollback evidence, permission enforcement, and explicit current-turn authorization exist.')
      : 'Add local api preview, api preflight, api sandbox-proof, api apply-gate, approval-record, apply-audit, apply-readback, and apply-result coverage for write endpoints marked needs-local-write-proof-ladder. Expert API writes remain disabled.',
    endpoints,
    writeEndpoints,
  };
}

function apiReadinessCompactSummary(options = {}) {
  const full = apiReadinessSummary(options);
  const readEndpointsWithMissingEvidence = full.endpoints
    .filter((endpoint) => endpoint.missingEvidence.length > 0)
    .map((endpoint) => ({
      endpointId: endpoint.endpointId,
      family: endpoint.family,
      missingEvidence: clone(endpoint.missingEvidence),
    }));
  const writeEndpointsWithMissingEvidence = full.writeEndpoints
    .filter((endpoint) => endpoint.missingEvidence.length > 0)
    .map((endpoint) => ({
      endpointId: endpoint.endpointId,
      family: endpoint.family,
      missingEvidence: clone(endpoint.missingEvidence),
    }));

  return {
    schemaVersion: API_READINESS_SUMMARY_SCHEMA_VERSION,
    generatedFrom: clone(full.generatedFrom),
    apiAccess: full.apiAccess,
    liveExecution: clone(full.liveExecution),
    filters: clone(full.filters),
    catalogEndpointCount: full.catalogEndpointCount,
    readEndpointCount: full.readEndpointCount,
    writeEndpointCount: full.writeEndpointCount,
    summary: clone(full.summary),
    writeSummary: clone(full.writeSummary),
    readinessStatuses: clone(full.readinessStatuses),
    writeReadinessStatuses: clone(full.writeReadinessStatuses),
    coverageByFamily: clone(full.coverageByFamily),
    writeCoverageByFamily: clone(full.writeCoverageByFamily),
    missingEvidence: {
      readEndpointCount: readEndpointsWithMissingEvidence.length,
      writeEndpointCount: writeEndpointsWithMissingEvidence.length,
      readByCategory: readMissingEvidenceByCategory(full.endpoints),
      writeByCategory: writeMissingEvidenceByCategory(full.writeEndpoints),
      readEndpoints: readEndpointsWithMissingEvidence,
      writeEndpoints: writeEndpointsWithMissingEvidence,
    },
    writeProofLadderStepCount: full.writeProofLadder.length,
    fullReportCommand: readinessReportCommand(full.filters),
    nextSafeStep: full.nextSafeStep,
    writeNextSafeStep: full.writeNextSafeStep,
  };
}

module.exports = {
  API_READINESS_SCHEMA_VERSION,
  API_READINESS_SUMMARY_SCHEMA_VERSION,
  READ_PLAN_GOLDEN_EXAMPLES,
  READ_MOCK_EXAMPLES,
  READ_PIPELINE_GOLDEN_EXAMPLES,
  PERSISTED_READ_AUDIT_EXAMPLES,
  apiReadinessCompactSummary,
  apiReadinessSummary,
};
