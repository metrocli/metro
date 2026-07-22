'use strict';

const { GENERIC_WORKSPACE } = require('./model');

const CATALOG_BINDINGS_SCHEMA_VERSION = 'metro.workspace.catalog-bindings.v1';

const SANDBOX_REFERENCE_CATALOG = Object.freeze({
  creditTypeId: '<sandbox-credit-type-id>',
  dimensionalBillableMetricId: '<sandbox-billable-metric-id>',
  sharedDimensionalProductId: '<sandbox-usage-product-id>',
  payloadMode: 'code-only',
  fixedProductId: '<sandbox-fixed-product-id>',
  seatProductId: '<sandbox-seat-product-id>',
  rateCardIds: {},
  dimensionalProductIds: {},
});

const PRODUCTION_REFERENCE_CATALOG = Object.freeze({
  creditTypeId: '<production-credit-type-id>',
  dimensionalBillableMetricId: '<production-billable-metric-id>',
  sharedDimensionalProductId: '<production-usage-product-id>',
  payloadMode: 'code-only',
  fixedProductId: '<production-fixed-product-id>',
  seatProductId: '<production-seat-product-id>',
  rateCardIds: {},
  dimensionalProductIds: {},
});

function placeholder(value) {
  return typeof value === 'string' && (value.startsWith('<') || value.includes('placeholder'));
}

function resolveWorkspaceCatalog({ tenant, workspaceCatalog } = {}) {
  const isProd = tenant === 'production';
  const reference = isProd ? PRODUCTION_REFERENCE_CATALOG : SANDBOX_REFERENCE_CATALOG;
  const catalog = workspaceCatalog || reference;
  const rateCardIds = catalog.rateCardIds || {};
  const tiers = Object.entries(rateCardIds).map(([tier, rateCardId], index) => ({
    tier,
    alias: tier,
    effectiveRateCardId: rateCardId,
    effectiveProductId: catalog.dimensionalProductIds?.[tier]
      || catalog.sharedDimensionalProductId
      || '<usage-product-id>',
    recommendedForCanary: index === 0,
    source: workspaceCatalog ? 'profile.workspaceCatalog' : 'reference-placeholder',
  }));

  const missingIds = [];
  for (const [key, value] of Object.entries({
    creditTypeId: catalog.creditTypeId || catalog.levCreditTypeId,
    dimensionalBillableMetricId: catalog.dimensionalBillableMetricId,
    sharedDimensionalProductId: catalog.sharedDimensionalProductId,
  })) {
    if (!value || placeholder(value)) missingIds.push(key);
  }

  return {
    schemaVersion: CATALOG_BINDINGS_SCHEMA_VERSION,
    resolved: missingIds.length === 0 && tiers.length > 0,
    source: workspaceCatalog ? 'profile.workspaceCatalog' : 'reference-placeholder',
    tenant: tenant || null,
    catalog: {
      ...reference,
      ...catalog,
      payloadMode: catalog.payloadMode || 'code-only',
    },
    tiers,
    missingIds,
    staleWarnings: [],
    pattern: GENERIC_WORKSPACE.catalogPattern.id,
  };
}

function validateWorkspaceCatalogShape(catalog = {}) {
  const warnings = [];
  if (!catalog.rateCardIds || Object.keys(catalog.rateCardIds).length === 0) {
    warnings.push({
      id: 'MTR-WORKSPACE-GEN-001',
      message: 'workspaceCatalog.rateCardIds is empty - bind card IDs in profiles.json for rollout plans.',
    });
  }
  return { valid: true, warnings };
}

function extractWorkspaceCatalogFromConfig(config = {}, profileName = null) {
  if (!config || typeof config !== 'object') return null;
  if (profileName && config.profiles?.[profileName]?.workspaceCatalog) {
    return config.profiles[profileName].workspaceCatalog;
  }
  if (config.defaultProfile && config.profiles?.[config.defaultProfile]?.workspaceCatalog) {
    return config.profiles[config.defaultProfile].workspaceCatalog;
  }
  return config.workspaceCatalog || config.catalog || null;
}

module.exports = {
  CATALOG_BINDINGS_SCHEMA_VERSION,
  SANDBOX_REFERENCE_CATALOG,
  PRODUCTION_REFERENCE_CATALOG,
  resolveWorkspaceCatalog,
  validateWorkspaceCatalogShape,
  extractWorkspaceCatalogFromConfig,
};
