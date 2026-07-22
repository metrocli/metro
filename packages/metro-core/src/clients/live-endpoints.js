'use strict';

/** Endpoints enabled for guarded live read in the current CLI release. */
const LIVE_READ_ENDPOINT_IDS = new Set([
  'contracts.get.v2',
  'contracts.list.v2',
  'customers.get',
  'customers.list',
  'invoices.listForCustomer',
  'invoices.get',
  'packages.get',
  'packages.list',
  'packages.listContractsOnPackage',
  'rateCards.get',
  'rateCards.list',
  'rateCards.getRates',
  'products.get',
  'products.list',
  'customerBalances.list',
  'credits.list',
  'commits.list',
  'customFields.listKeys',
  'billingProvider.getCustomerConfigurations',
  'security.getAuditLogs',
]);

/** Write endpoints enabled for guarded live sandbox apply in the current CLI release. */
const LIVE_APPLY_SANDBOX_ENDPOINT_IDS = new Set([
  'contracts.create',
  'contracts.edit.v2',
  'packages.create',
  'customers.create',
  'customFields.setValues',
  'rateCards.addRates',
  // Catalog creates: also require --confirm-greenfield-create (see apply-live.js).
  'products.create',
  'billableMetrics.create',
]);

/** Catalog-create endpoints that need the extra greenfield typed confirm. */
const GREENFIELD_CREATE_ENDPOINT_IDS = new Set([
  'products.create',
  'billableMetrics.create',
]);

const METRONOME_API_BASE_URL = 'https://api.metronome.com';

function isLiveReadEndpoint(endpointId) {
  return LIVE_READ_ENDPOINT_IDS.has(endpointId);
}

function isLiveApplySandboxEndpoint(endpointId) {
  return LIVE_APPLY_SANDBOX_ENDPOINT_IDS.has(endpointId);
}

function isGreenfieldCreateEndpoint(endpointId) {
  return GREENFIELD_CREATE_ENDPOINT_IDS.has(endpointId);
}

function listLiveReadEndpointIds() {
  return [...LIVE_READ_ENDPOINT_IDS].sort();
}

function listLiveApplySandboxEndpointIds() {
  return [...LIVE_APPLY_SANDBOX_ENDPOINT_IDS].sort();
}

module.exports = {
  LIVE_READ_ENDPOINT_IDS,
  LIVE_APPLY_SANDBOX_ENDPOINT_IDS,
  GREENFIELD_CREATE_ENDPOINT_IDS,
  METRONOME_API_BASE_URL,
  isLiveReadEndpoint,
  isLiveApplySandboxEndpoint,
  isGreenfieldCreateEndpoint,
  listLiveReadEndpointIds,
  listLiveApplySandboxEndpointIds,
};
