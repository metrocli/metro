'use strict';

const WORKSPACE_SCHEMA_VERSION = 'metro.workspace.v1';
const ROUTE_SCHEMA_VERSION = 'metro.workspace.route.v1';
const PLAN_SCHEMA_VERSION = 'metro.workspace.plan.v1';
const INPUT_TEMPLATE_SCHEMA_VERSION = 'metro.workspace.input-template.v1';
const AUDIT_EXPORT_SCHEMA_VERSION = 'metro.workspace.audit-export.v1';

const STUB_WORKSPACE = Object.freeze({
  schemaVersion: WORKSPACE_SCHEMA_VERSION,
  organization: 'stub',
  catalogPattern: null,
  intentCount: 0,
  intents: [],
});

function getWorkspaceModel() {
  return { ...STUB_WORKSPACE };
}

function getIntent() {
  return null;
}

function listIntents() {
  return [];
}

function intentForAuditAction() {
  return null;
}

function tierRateCardsForTenant() {
  return [];
}

function resolveWorkspaceCatalog({ tenant } = {}) {
  return {
    resolved: false,
    source: 'stub',
    tenant: tenant || null,
    catalog: null,
    tiers: [],
    missingIds: [],
    staleWarnings: [],
  };
}

function validateWorkspaceCatalogShape() {
  return { valid: true, warnings: [] };
}

const SANDBOX_REFERENCE_CATALOG = Object.freeze({});
const PRODUCTION_REFERENCE_CATALOG = Object.freeze({});

function buildWorkspacePlan(intentId) {
  return {
    schemaVersion: PLAN_SCHEMA_VERSION,
    valid: false,
    error: 'workspace-pack-stub',
    message: `Workspace pack is stubbed (0 intents). Set METRO_WORKSPACE_PACK=generic for plan intents. Requested: "${intentId}".`,
    availableIntents: [],
    nextCommands: ['metro workspace explain --json', 'metro plan list --json'],
  };
}

function buildPlanInputTemplate(intentId) {
  return {
    schemaVersion: INPUT_TEMPLATE_SCHEMA_VERSION,
    valid: false,
    error: 'workspace-pack-stub',
    message: `Workspace pack is stubbed (0 intents). Requested: "${intentId}".`,
    intentId,
    availableIntents: [],
    nextCommands: ['metro plan list --json'],
  };
}

function routeWorkspaceRequest(options = {}) {
  return {
    schemaVersion: ROUTE_SCHEMA_VERSION,
    valid: true,
    routed: false,
    refused: true,
    tenant: options.tenant || null,
    endpointId: options.endpointId || null,
    goal: options.goal || null,
    reason: 'No workspace intents in stub pack. Use METRO_WORKSPACE_PACK=generic.',
    recommendedIntent: null,
    nextCommands: ['metro workspace explain --json', 'metro docs explain workspace.routing --json'],
  };
}

function buildAuditExportClassify() {
  return {
    schemaVersion: AUDIT_EXPORT_SCHEMA_VERSION,
    valid: false,
    error: 'workspace-pack-stub',
    message: 'Audit export classify requires a workspace pack with intents.',
  };
}

function buildAuditExportPlan() {
  return buildAuditExportClassify();
}

function classifyAuditExportSummary() {
  return { intents: [], topIntents: [] };
}

function extractWorkspaceCatalogFromConfig() {
  return null;
}

module.exports = {
  WORKSPACE_SCHEMA_VERSION,
  STUB_WORKSPACE,
  getWorkspaceModel,
  getIntent,
  listIntents,
  intentForAuditAction,
  tierRateCardsForTenant,
  resolveWorkspaceCatalog,
  validateWorkspaceCatalogShape,
  SANDBOX_REFERENCE_CATALOG,
  PRODUCTION_REFERENCE_CATALOG,
  buildWorkspacePlan,
  buildPlanInputTemplate,
  routeWorkspaceRequest,
  buildAuditExportClassify,
  buildAuditExportPlan,
  classifyAuditExportSummary,
  extractWorkspaceCatalogFromConfig,
};
