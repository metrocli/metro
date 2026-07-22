'use strict';

/**
 * metro.tenant.snapshot.v1 - local account model for agents/routers.
 * Extends catalog-bind workspaceCatalog fields with discovery inventories.
 */

const SNAPSHOT_SCHEMA_VERSION = 'metro.tenant.snapshot.v1';

const ACCOUNT_PATTERNS = Object.freeze([
  'dimensional-shared-usage',
  'package-template',
  'commit-grant-heavy',
  'package-and-credits',
  'greenfield-needed',
  'unknown',
]);

/**
 * Empty snapshot template. Bind/discovery fill catalog + inventories;
 * classifier fills classification (null until classified).
 */
function emptyTenantSnapshot(tenant = 'sandbox') {
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    tenant: tenant === 'production' ? 'production' : 'sandbox',
    capturedAt: null,
    sourceCommand: null,
    catalog: {
      creditTypeId: null,
      dimensionalBillableMetricId: null,
      sharedDimensionalProductId: null,
      payloadMode: 'code-only',
      fixedProductId: null,
      seatProductId: null,
      rateCardIds: {},
      dimensionalProductIds: {},
    },
    inventory: {
      rateCardCount: 0,
      productCount: 0,
      billableMetricCount: 0,
      creditTypeCount: 0,
      rateCards: [],
      products: [],
      billableMetrics: [],
      creditTypes: [],
    },
    classification: null,
  };
}

module.exports = {
  SNAPSHOT_SCHEMA_VERSION,
  ACCOUNT_PATTERNS,
  emptyTenantSnapshot,
};
