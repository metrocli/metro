'use strict';

const { buildApplyGateTemplate } = require('../apply-gate');
const { buildAuditTemplate } = require('../audit');
const { buildPreflightTemplate } = require('../preflight');
const { buildSandboxProofTemplate } = require('../proof/sandbox-manifest');
const { SHAPES } = require('../shapes');
const { WORKFLOW_BY_SHAPE_ID, workflowForShapeId } = require('../evidence-gates/support');

const EVIDENCE_GATE_REFERENCE_SECTION_NAVIGATION = [
  {
    id: 'evidence-gate-summary',
    href: '#evidence-gate-summary',
    label: 'Evidence gate summary',
    description: 'Generated counts for mapped shapes, local template paths, preflight-only gaps, and disabled apply.',
  },
  {
    id: 'evidence-gates',
    href: '#evidence-gates',
    label: 'Evidence gates',
    description: 'Per-shape local preflight, audit, sandbox-proof, and apply-gate template coverage while live execution remains disabled.',
  },
];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function compact(value) {
  return value === undefined ? null : value;
}

function evidenceStatus(coverage) {
  if (coverage.preflightTemplate
    && coverage.auditTemplate
    && coverage.sandboxProofTemplate
    && coverage.applyGateTemplate) {
    return 'full-local-template-path';
  }
  if (coverage.preflightTemplate) return 'preflight-only';
  return 'not-covered';
}

function templateCommands(workflow, shape, coverage) {
  return {
    preflightTemplate: coverage.preflightTemplate
      ? `metro preflight template --workflow ${workflow} --shape ${shape} --prod --json`
      : null,
    preflightValidate: coverage.preflightTemplate
      ? 'metro preflight validate --file <preflight.json> --json'
      : null,
    auditTemplate: coverage.auditTemplate
      ? `metro audit template --workflow ${workflow} --shape ${shape} --prod --json`
      : null,
    auditValidate: coverage.auditTemplate
      ? 'metro audit validate --file <audit.jsonl> --json'
      : null,
    sandboxProofTemplate: coverage.sandboxProofTemplate
      ? `metro proof sandbox-template --workflow ${workflow} --shape ${shape} --json`
      : null,
    sandboxProofValidate: coverage.sandboxProofTemplate
      ? 'metro proof validate --file <sandbox-proof.json> --json'
      : null,
    applyGateTemplate: coverage.applyGateTemplate
      ? `metro apply-gate template --workflow ${workflow} --shape ${shape} --prod --json`
      : null,
    applyGateValidate: coverage.applyGateTemplate
      ? 'metro apply-gate validate --file <apply-gate.json> --json'
      : null,
  };
}

function templateSchemaVersions({ preflight, audit, proof, applyGate }) {
  return {
    preflight: compact(preflight?.schemaVersion),
    audit: compact(audit?.schemaVersion),
    sandboxProof: compact(proof?.schemaVersion),
    applyGate: compact(applyGate?.schemaVersion),
  };
}

function buildGateForShape(shape) {
  const workflow = workflowForShapeId(shape.id);
  if (!workflow) return null;

  const tenant = 'production';
  const preflight = buildPreflightTemplate({ workflow, shape: shape.id, tenant });
  const audit = buildAuditTemplate({ workflow, shape: shape.id, tenant });
  const proof = buildSandboxProofTemplate({ workflow, shape: shape.id });
  const applyGate = buildApplyGateTemplate({ workflow, shape: shape.id, tenant });
  const coverage = {
    preview: Boolean(preflight?.preview?.command),
    preflightTemplate: Boolean(preflight),
    auditTemplate: Boolean(audit),
    sandboxProofTemplate: Boolean(proof),
    applyGateTemplate: Boolean(applyGate),
    applyGateValidation: Boolean(applyGate),
  };
  const status = evidenceStatus(coverage);
  const fullPathAvailable = status === 'full-local-template-path';
  const auditRowCount = audit ? 1 + (Array.isArray(audit.additionalRows) ? audit.additionalRows.length : 0) : 0;

  return {
    workflow,
    shape: shape.id,
    title: shape.title,
    family: shape.family,
    maturity: shape.maturity,
    status,
    fullPathAvailable,
    localOnly: true,
    apiAccess: 'none',
    liveExecutionEnabledInCurrentCli: false,
    applyEnabledInCurrentCli: applyGate?.applyEnabledInCurrentCli === true,
    productionApplyAllowedBySandboxProof: proof?.maturityGate?.productionApplyAllowed === true,
    coverage,
    commands: {
      preview: compact(preflight?.preview?.command),
      blockedApply: compact(preflight?.execution?.command || applyGate?.approval?.command),
      ...templateCommands(workflow, shape.id, coverage),
    },
    templateSchemaVersions: templateSchemaVersions({ preflight, audit, proof, applyGate }),
    endpoints: (preflight?.execution?.endpoints || []).map((endpoint) => ({
      method: endpoint.method,
      path: endpoint.path,
      sourceIds: [...(endpoint.sourceIds || [])],
      purpose: endpoint.purpose,
    })),
    auditRowCount,
    requiredEvidence: {
      previewHash: Boolean(preflight?.preview?.payloadHash),
      endpointSourceProof: Boolean(preflight?.execution?.endpoints?.length),
      canaryPlan: Boolean(preflight?.canaryPlan?.required),
      auditLog: Boolean(preflight?.auditLog?.required),
      sandboxProof: Boolean(applyGate?.sandboxProof?.required),
      readBackVerification: applyGate?.verification?.readBackRequired === true,
      rollback: applyGate?.rollback?.reviewed === true,
      idempotency: applyGate?.idempotency?.reviewed === true,
      ownerApproval: Boolean(applyGate?.approval?.owner),
    },
    unsupportedUntil: preflight?.unsupportedUntil ? [...preflight.unsupportedUntil] : [
      'preflight template exists for this shape, but full audit, sandbox proof, and apply-gate template coverage is not yet present',
    ],
    sources: [
      'docs/metronome-cli/one-goal.md',
      'docs/metronome-cli/CLI_ARCHITECTURE.md',
      'docs/metronome-cli/VALIDATION_AND_GUARDRAILS.md',
      'docs/metronome-cli/SHAPE_CATALOG.md',
      'packages/metro-core/src/preflight/index.js',
      'packages/metro-core/src/audit/index.js',
      'packages/metro-core/src/proof/sandbox-manifest.js',
      'packages/metro-core/src/apply-gate/index.js',
      ...shape.sources,
    ],
  };
}

function evidenceGateReference() {
  const gates = SHAPES.map(buildGateForShape).filter(Boolean);
  const byStatus = gates.reduce((counts, gate) => {
    counts[gate.status] = (counts[gate.status] || 0) + 1;
    return counts;
  }, {});

  return {
    schemaVersion: 'metro.docs.evidence-gate-reference.v1',
    generatedFrom: 'packages/metro-core/src/docs/evidence-gate-reference.js',
    sourceModules: [
      'packages/metro-core/src/shapes/index.js',
      'packages/metro-core/src/preflight/index.js',
      'packages/metro-core/src/audit/index.js',
      'packages/metro-core/src/proof/sandbox-manifest.js',
      'packages/metro-core/src/apply-gate/index.js',
    ],
    localOnly: true,
    apiAccess: 'none',
    liveExecutionEnabledInCurrentCli: false,
    applyEnabledInCurrentCli: false,
    sectionNavigation: EVIDENCE_GATE_REFERENCE_SECTION_NAVIGATION.map((section) => ({ ...section })),
    summary: {
      shapesWithWorkflowMapping: gates.length,
      fullLocalTemplatePath: byStatus['full-local-template-path'] || 0,
      preflightOnly: byStatus['preflight-only'] || 0,
      notCovered: byStatus['not-covered'] || 0,
    },
    gates: clone(gates),
  };
}

module.exports = {
  WORKFLOW_BY_SHAPE_ID,
  evidenceGateReference,
};
