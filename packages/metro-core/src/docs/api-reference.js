'use strict';

const { apiCatalog, approvalPolicyReference, permissionScopeReference } = require('../api-catalog');
const { apiApplyGateCoverage, apiSandboxProofCoverage } = require('../api-catalog/apply-gate');
const { apiApplyAuditCoverage } = require('../api-catalog/apply-audit');
const { apiApplyResultCoverage } = require('../api-catalog/apply-result');
const { apiApplyReadbackCoverage } = require('../api-catalog/apply-readback');
const { apiApprovalRecordCoverage } = require('../api-catalog/approval-record');
const { apiPreflightCoverage } = require('../api-catalog/preflight');
const { apiPreviewCoverage } = require('../api-catalog/preview');
const { apiReadAuditCoverage } = require('../api-catalog/read-audit');
const { apiReadGateCoverage } = require('../api-catalog/read-gate');
const { apiReadMockCoverage } = require('../api-catalog/read-mock');
const { apiReadPlanCoverage } = require('../api-catalog/read-plan');
const { apiReadPipelineCoverage } = require('../api-catalog/read-pipeline');
const { apiReadResultCoverage } = require('../api-catalog/read-result');
const { apiReadinessSummary } = require('../api-catalog/readiness');
const { apiRequestValidationCoverage } = require('../api-catalog/validation');

const API_REFERENCE_SECTION_NAVIGATION = [
  {
    id: 'families',
    href: '#families',
    label: 'Families',
    description: 'Reviewed endpoint families, operation types, and support statuses.',
  },
  {
    id: 'permission-scopes',
    href: '#permission-scopes',
    label: 'Permission scopes',
    description: 'Catalog-derived scopes and approval models before any future live runner.',
  },
  {
    id: 'approval-policies',
    href: '#approval-policies',
    label: 'Approval policies',
    description: 'Local owner and role evidence required before future expert API execution.',
  },
  {
    id: 'read-endpoint-readiness',
    href: '#read-endpoint-readiness',
    label: 'Read readiness',
    description: 'Local read validators, plans, mocks, pipelines, and persisted audit proof.',
  },
  {
    id: 'write-endpoint-gate-readiness',
    href: '#write-endpoint-gate-readiness',
    label: 'Write gate readiness',
    description: 'Local write proof coverage while live writes and apply remain disabled.',
  },
  {
    id: 'write-proof-ladder',
    href: '#write-proof-ladder',
    label: 'Write proof ladder',
    description: 'Ordered request-validation through apply-result evidence before any future apply runner.',
  },
  {
    id: 'write-endpoint-coverage',
    href: '#write-endpoint-coverage',
    label: 'Write endpoint coverage',
    description: 'Per-endpoint write proof coverage, side-effect risk, and readiness status.',
  },
  {
    id: 'endpoint-contracts',
    href: '#endpoint-contracts',
    label: 'Endpoint contracts',
    description: 'Reviewed endpoint contracts, gates, sources, and side-effect profiles.',
  },
];

function countBy(endpoints, field) {
  return endpoints.reduce((counts, endpoint) => {
    const key = endpoint[field] || 'unknown';
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function familySummaries(endpoints) {
  const byFamily = endpoints.reduce((groups, endpoint) => {
    if (!groups[endpoint.family]) groups[endpoint.family] = [];
    groups[endpoint.family].push(endpoint);
    return groups;
  }, {});

  return Object.entries(byFamily)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([family, familyEndpoints]) => {
      const operationTypes = countBy(familyEndpoints, 'operationType');
      const supportStatuses = countBy(familyEndpoints, 'supportStatus');
      return {
        family,
        endpointCount: familyEndpoints.length,
        operationTypes,
        supportStatuses,
      };
    });
}

function apiReference(options = {}) {
  const catalog = apiCatalog({ family: options.family || null });
  const applyGateCoverage = apiApplyGateCoverage();
  const applyAuditCoverage = apiApplyAuditCoverage();
  const applyResultCoverage = apiApplyResultCoverage();
  const applyReadbackCoverage = apiApplyReadbackCoverage();
  const approvalRecordCoverage = apiApprovalRecordCoverage();
  const sandboxProofCoverage = apiSandboxProofCoverage();
  const preflightCoverage = apiPreflightCoverage();
  const previewCoverage = apiPreviewCoverage();
  const readAuditCoverage = apiReadAuditCoverage();
  const readGateCoverage = apiReadGateCoverage();
  const readMockCoverage = apiReadMockCoverage();
  const readPlanCoverage = apiReadPlanCoverage();
  const readPipelineCoverage = apiReadPipelineCoverage();
  const readResultCoverage = apiReadResultCoverage();
  const readReadiness = apiReadinessSummary({ family: options.family || null });
  const validationCoverage = apiRequestValidationCoverage();
  const approvalPolicies = approvalPolicyReference({ family: options.family || null });
  const permissionScopes = permissionScopeReference({ family: options.family || null });
  const endpoints = catalog.endpoints.map((endpoint) => ({
    ...endpoint,
    apiApplyGate: applyGateCoverage[endpoint.id],
    apiApplyAudit: applyAuditCoverage[endpoint.id],
    apiApplyResult: applyResultCoverage[endpoint.id],
    apiApplyReadback: applyReadbackCoverage[endpoint.id],
    apiApprovalRecord: approvalRecordCoverage[endpoint.id],
    apiPreflight: preflightCoverage[endpoint.id],
    apiSandboxProof: sandboxProofCoverage[endpoint.id],
    apiReadAudit: readAuditCoverage[endpoint.id],
    apiReadGate: readGateCoverage[endpoint.id],
    apiReadMock: readMockCoverage[endpoint.id],
    apiReadPlan: readPlanCoverage[endpoint.id],
    apiReadPipeline: readPipelineCoverage[endpoint.id],
    apiReadResult: readResultCoverage[endpoint.id],
    localPreview: previewCoverage[endpoint.id],
    requestValidation: validationCoverage[endpoint.id],
  }));
  return {
    schemaVersion: 'metro.docs.api-reference.v1',
    generatedFrom: [
      'packages/metro-core/src/api-catalog/index.js',
      'packages/metro-core/src/api-catalog/apply-gate.js',
      'packages/metro-core/src/api-catalog/apply-audit.js',
      'packages/metro-core/src/api-catalog/apply-result.js',
      'packages/metro-core/src/api-catalog/apply-readback.js',
      'packages/metro-core/src/api-catalog/approval-record.js',
      'packages/metro-core/src/api-catalog/preflight.js',
      'packages/metro-core/src/api-catalog/preview.js',
      'packages/metro-core/src/api-catalog/read-audit.js',
      'packages/metro-core/src/api-catalog/read-gate.js',
      'packages/metro-core/src/api-catalog/read-mock.js',
      'packages/metro-core/src/api-catalog/read-plan.js',
      'packages/metro-core/src/api-catalog/read-pipeline.js',
      'packages/metro-core/src/api-catalog/read-result.js',
      'packages/metro-core/src/api-catalog/readiness.js',
      'packages/metro-core/src/api-catalog/validation.js',
    ],
    apiAccess: 'none',
    liveExecution: catalog.liveExecution,
    filters: catalog.filters,
    sectionNavigation: API_REFERENCE_SECTION_NAVIGATION.map((section) => ({ ...section })),
    approvalPolicies,
    endpointCount: catalog.endpointCount,
    families: familySummaries(endpoints),
    operationTypes: countBy(endpoints, 'operationType'),
    apiApplyGateStatuses: countBy(Object.values(applyGateCoverage), 'supportStatus'),
    apiApplyAuditStatuses: countBy(Object.values(applyAuditCoverage), 'supportStatus'),
    apiApplyResultStatuses: countBy(Object.values(applyResultCoverage), 'supportStatus'),
    apiApplyReadbackStatuses: countBy(Object.values(applyReadbackCoverage), 'supportStatus'),
    apiApprovalRecordStatuses: countBy(Object.values(approvalRecordCoverage), 'supportStatus'),
    apiPreflightStatuses: countBy(Object.values(preflightCoverage), 'supportStatus'),
    apiSandboxProofStatuses: countBy(Object.values(sandboxProofCoverage), 'supportStatus'),
    apiReadAuditStatuses: countBy(Object.values(readAuditCoverage), 'supportStatus'),
    apiReadGateStatuses: countBy(Object.values(readGateCoverage), 'supportStatus'),
    apiReadMockStatuses: countBy(Object.values(readMockCoverage), 'supportStatus'),
    apiReadPlanStatuses: countBy(Object.values(readPlanCoverage), 'supportStatus'),
    apiReadPipelineStatuses: countBy(Object.values(readPipelineCoverage), 'supportStatus'),
    apiReadResultStatuses: countBy(Object.values(readResultCoverage), 'supportStatus'),
    apiReadinessStatuses: readReadiness.readinessStatuses,
    apiWriteReadinessStatuses: readReadiness.writeReadinessStatuses,
    writeProofLadder: readReadiness.writeProofLadder,
    readReadiness,
    localPreviewStatuses: countBy(Object.values(previewCoverage), 'supportStatus'),
    permissionScopes,
    supportStatuses: countBy(endpoints, 'supportStatus'),
    requestValidationStatuses: countBy(Object.values(validationCoverage), 'supportStatus'),
    endpoints,
  };
}

module.exports = {
  apiReference,
};
