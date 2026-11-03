'use strict';

/**
 * Read helpers shared by generic ops. Endpoints are cited against
 * https://docs.metronome.com (API reference), verified 2026-11-03.
 */

const core = require('./core');
const { usageError, readString } = require('./runtime');

const { resolveCustomer, summarizeCustomer, getCustomerById } = core.customerResolve;

async function listPaginated(client, method, urlBase, body = undefined, { pageLimit = 100 } = {}) {
  const out = [];
  let next = null;
  const seen = new Set();
  for (let i = 0; i < 200; i += 1) {
    const sep = urlBase.includes('?') ? '&' : '?';
    const url = `${urlBase}${sep}limit=${pageLimit}${next ? `&next_page=${encodeURIComponent(next)}` : ''}`;
    const resp = method === 'get' ? await client.get(url) : await client.post(url, body || {});
    out.push(...((resp && resp.data) || []));
    const np = resp && resp.next_page;
    if (!np || np === next || seen.has(np)) break;
    seen.add(np);
    next = np;
  }
  return out;
}

function lookupFromFlags(flags) {
  return {
    customerId: readString(flags, 'customer-id'),
    externalId: readString(flags, 'external-id'),
    ingestAlias: readString(flags, 'ingest-alias'),
    name: readString(flags, 'name'),
    query: readString(flags, 'query'),
  };
}

/** Resolve exactly one customer or throw a usage error that lists candidates. */
async function resolveOneCustomer(client, flags) {
  const lookup = lookupFromFlags(flags);
  if (!lookup.customerId && !lookup.externalId && !lookup.ingestAlias && !lookup.name && !lookup.query) {
    throw usageError('Pass one of --customer-id=, --external-id=, --ingest-alias=, --name=.');
  }
  const resolved = await resolveCustomer(client, lookup);
  if (!resolved.customer) {
    const err = usageError(resolved.error || 'Customer not found.');
    err.code = 'MTR-CUSTOMER-NOT-FOUND';
    err.details = { candidates: resolved.candidates || null, attempts: resolved.attempts || null };
    throw err;
  }
  return { customer: resolved.customer, lookup: resolved.lookup };
}

// https://docs.metronome.com/api-reference/contracts/list-customer-contracts-v2
// Cursor-paginated (limit 1-20, `cursor` in body and response).
async function listContracts(client, customerId, { includeArchived = false } = {}) {
  const out = [];
  let cursor = null;
  for (let i = 0; i < 100; i += 1) {
    const body = { customer_id: customerId, include_archived: includeArchived };
    if (cursor) body.cursor = cursor;
    const resp = await client.post('/v2/contracts/list', body);
    out.push(...((resp && resp.data) || []));
    const next = resp && resp.cursor;
    if (!next || next === cursor) break;
    cursor = next;
  }
  return out;
}

// https://docs.metronome.com/api-reference/contracts/get-a-contract-v2
async function getContract(client, customerId, contractId) {
  const resp = await client.post('/v2/contracts/get', { customer_id: customerId, contract_id: contractId });
  return (resp && resp.data) || resp;
}

function isActiveContract(contract, now = new Date()) {
  if (!contract || contract.archived_at) return false;
  if (contract.starting_at && new Date(contract.starting_at) > now) return false;
  return !contract.ending_before || new Date(contract.ending_before) > now;
}

/** One active contract, optionally narrowed with --contract-id. */
function selectSingleActiveContract(contracts, { contractId = null, now = new Date(), customerId = '' } = {}) {
  let active = contracts.filter((c) => isActiveContract(c, now));
  if (contractId) active = active.filter((c) => c.id === contractId);
  if (active.length === 0) {
    throw usageError(`No active contract for customer ${customerId}${contractId ? ` matching --contract-id=${contractId}` : ''}.`);
  }
  if (active.length > 1) {
    throw usageError(`Found ${active.length} active contracts for customer ${customerId}; pass --contract-id= (${active.map((c) => c.id).join(', ')}).`);
  }
  return active[0];
}

/** Pick the single contract to truncate for a package plan move. */
function selectMovePredecessor(contracts, now = new Date()) {
  const active = (contracts || []).filter((c) => isActiveContract(c, now));
  const openEnded = active.filter((c) => !c.ending_before);
  if (openEnded.length === 1) return { predecessor: openEnded[0], kind: 'open-ended' };
  if (active.length === 1) {
    return { predecessor: active[0], kind: active[0].ending_before ? 'active-trial' : 'open-ended' };
  }
  if (active.length === 0) {
    throw usageError('No active contract found for plan move (customer may be expired; create a fresh contract instead).');
  }
  if (openEnded.length > 1) throw usageError(`Expected exactly 1 open-ended contract, found ${openEnded.length}`);
  throw usageError(`Expected exactly 1 active contract for plan move, found ${active.length}`);
}

// https://docs.metronome.com/api-reference/list-all-packages
async function listPackages(client) {
  return listPaginated(client, 'post', '/v1/packages/list', {});
}

// https://docs.metronome.com/api-reference/packages/get-a-package
async function getPackage(client, packageId) {
  const resp = await client.post('/v1/packages/get', { package_id: packageId });
  return (resp && resp.data) || resp;
}

/** Aliases may omit starting_at (live since epoch) and may carry ending_before. */
function aliasLiveAt(entry, alias, atMs) {
  if (!entry || entry.name !== alias) return false;
  const start = entry.starting_at ? new Date(entry.starting_at).getTime() : 0;
  if (!Number.isFinite(start) || start > atMs) return false;
  if (entry.ending_before) {
    const end = new Date(entry.ending_before).getTime();
    if (Number.isFinite(end) && end <= atMs) return false;
  }
  return true;
}

/** The package an alias resolves to at a given instant (latest starting_at wins). */
function resolvePackageAliasAt(packages, alias, atIso) {
  const at = new Date(atIso).getTime();
  const startOf = (pkg) => Math.max(0, ...(pkg.aliases || [])
    .filter((x) => x.name === alias)
    .map((x) => (x.starting_at ? new Date(x.starting_at).getTime() : 0)));
  const matches = (packages || [])
    .filter((pkg) => !pkg.archived_at && (pkg.aliases || []).some((e) => aliasLiveAt(e, alias, at)))
    .sort((a, b) => startOf(b) - startOf(a));
  return matches[0] || null;
}

function packageAliasNames(pkg) {
  return (pkg?.aliases || []).map((a) => a.name).filter(Boolean);
}

function normalizePackageUniquenessKey(raw) {
  return String(raw || '').replace(/^package:/, '');
}

function isBillingEmptyPackage(pkg) {
  if (!pkg) return false;
  const empty = (arr) => !arr || arr.length === 0;
  return empty(pkg.recurring_commits) && empty(pkg.commits) && empty(pkg.credits)
    && empty(pkg.recurring_credits) && empty(pkg.subscriptions) && empty(pkg.scheduled_charges);
}

// https://docs.metronome.com/api-reference/credits-and-commits/list-balances
// No contract_id filter exists on this endpoint; filter rows client-side.
// Paginated with `next_page` in the body (limit 1-25).
async function listBalances(client, customerId, { contractId = null } = {}) {
  const out = [];
  let next = null;
  for (let i = 0; i < 200; i += 1) {
    const body = {
      customer_id: customerId,
      include_balance: true,
      include_contract_balances: true,
      include_archived: false,
    };
    if (next) body.next_page = next;
    const resp = await client.post('/v1/contracts/customerBalances/list', body);
    out.push(...((resp && resp.data) || []));
    const np = resp && resp.next_page;
    if (!np || np === next) break;
    next = np;
  }
  return contractId ? out.filter((row) => balanceContractId(row) === contractId) : out;
}

function balanceAmount(row) {
  const raw = row.balance?.including_pending
    ?? row.balance?.excluding_pending
    ?? row.balance
    ?? row.remaining_amount
    ?? row.amount
    ?? 0;
  return Number(raw) || 0;
}

function balanceRowId(row) {
  return row.id || row.commit_id || row.credit_id || null;
}

function balanceSegmentId(row) {
  return row.access_schedule?.schedule_items?.[0]?.id || row.segments?.[0]?.id || row.segment_id || null;
}

function balanceContractId(row) {
  return row.contract?.id || row.contract_id || null;
}

function balanceCreditTypeId(row) {
  return row.access_schedule?.credit_type?.id || row.access_schedule?.credit_type_id || row.credit_type_id || null;
}

function summarizeBalance(row) {
  return {
    id: balanceRowId(row),
    name: row.name || row.commit_name || row.credit_name || row.type || null,
    type: row.type || null,
    balance: balanceAmount(row),
    contract_id: balanceContractId(row),
    segment_id: balanceSegmentId(row),
    credit_type_id: balanceCreditTypeId(row),
  };
}

// https://docs.metronome.com/api-reference/customers/fetch-billing-provider-configurations-for-a-customer
async function getBillingProviderConfigs(client, customerId) {
  const resp = await client.post('/v1/getCustomerBillingProviderConfigurations', { customer_id: customerId });
  return (resp && resp.data) || [];
}

// https://docs.metronome.com/api-reference/rate-cards/get-rates
async function getRates(client, rateCardId, at, selectors = undefined) {
  const body = { rate_card_id: rateCardId, at };
  if (selectors && selectors.length) body.selectors = selectors;
  return listPaginated(client, 'post', '/v1/contract-pricing/rate-cards/getRates', body);
}

// https://docs.metronome.com/api-reference/rate-cards/get-a-rate-card
async function getRateCard(client, rateCardId) {
  const resp = await client.post('/v1/contract-pricing/rate-cards/get', { id: rateCardId });
  return (resp && resp.data) || resp;
}

// https://docs.metronome.com/api-reference/rate-cards/list-rate-cards
async function listRateCards(client) {
  return listPaginated(client, 'post', '/v1/contract-pricing/rate-cards/list', {});
}

module.exports = {
  listPaginated,
  lookupFromFlags,
  resolveOneCustomer,
  summarizeCustomer,
  getCustomerById,
  listContracts,
  getContract,
  isActiveContract,
  selectSingleActiveContract,
  selectMovePredecessor,
  listPackages,
  getPackage,
  aliasLiveAt,
  resolvePackageAliasAt,
  packageAliasNames,
  normalizePackageUniquenessKey,
  isBillingEmptyPackage,
  listBalances,
  balanceAmount,
  summarizeBalance,
  getBillingProviderConfigs,
  getRates,
  getRateCard,
  listRateCards,
};
