'use strict';

const { emptyTenantSnapshot } = require('./schema');

const CATALOG_PLACEHOLDERS = {
  creditTypeId: '<credit-type-id>',
  dimensionalBillableMetricId: '<billable-metric-id>',
  sharedDimensionalProductId: '<usage-product-id>',
  fixedProductId: '<fixed-product-id>',
  seatProductId: '<seat-product-id>',
};

const INVENTORY_KEYS = [
  ['rateCards', 'rateCardCount'],
  ['products', 'productCount'],
  ['billableMetrics', 'billableMetricCount'],
  ['creditTypes', 'creditTypeCount'],
];

function pickScalar(workspaceCatalog, discovery, key) {
  const fromCatalog = workspaceCatalog?.[key];
  if (fromCatalog != null && fromCatalog !== '') return fromCatalog;
  const fromDiscovery = discovery?.[key];
  if (fromDiscovery != null && fromDiscovery !== '') return fromDiscovery;
  return CATALOG_PLACEHOLDERS[key] || null;
}

function pickObject(workspaceCatalog, discovery, key) {
  const fromCatalog = workspaceCatalog?.[key];
  if (fromCatalog && typeof fromCatalog === 'object' && Object.keys(fromCatalog).length > 0) {
    return fromCatalog;
  }
  const fromDiscovery = discovery?.[key];
  if (fromDiscovery && typeof fromDiscovery === 'object') return fromDiscovery;
  return {};
}

function buildCatalog(workspaceCatalog, discovery) {
  const w = workspaceCatalog || {};
  const d = discovery || {};
  return {
    creditTypeId: pickScalar(w, d, 'creditTypeId'),
    dimensionalBillableMetricId: pickScalar(w, d, 'dimensionalBillableMetricId'),
    sharedDimensionalProductId: pickScalar(w, d, 'sharedDimensionalProductId'),
    payloadMode: w.payloadMode || d.payloadMode || 'code-only',
    fixedProductId: pickScalar(w, d, 'fixedProductId'),
    seatProductId: pickScalar(w, d, 'seatProductId'),
    rateCardIds: pickObject(w, d, 'rateCardIds'),
    dimensionalProductIds: pickObject(w, d, 'dimensionalProductIds'),
  };
}

function fillInventory(snapshot, discovery) {
  const inventories = discovery?.inventories;
  if (!inventories || typeof inventories !== 'object') return;

  for (const [listKey, countKey] of INVENTORY_KEYS) {
    const rows = inventories[listKey];
    if (!Array.isArray(rows)) continue;
    snapshot.inventory[countKey] = rows.length;
    snapshot.inventory[listKey] = rows.slice(0, 50).map((row) => ({
      id: row.id,
      name: row.name ?? null,
    }));
  }
}

function buildTenantSnapshot({
  tenant,
  discovery = null,
  workspaceCatalog = null,
  sourceCommand = 'metro catalog bind',
  classification = null,
} = {}) {
  const snapshot = emptyTenantSnapshot(tenant);
  snapshot.capturedAt = new Date().toISOString();
  snapshot.sourceCommand = sourceCommand;
  snapshot.catalog = buildCatalog(workspaceCatalog, discovery);
  fillInventory(snapshot, discovery);
  snapshot.classification = classification;
  return snapshot;
}

module.exports = {
  buildTenantSnapshot,
};
