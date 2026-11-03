'use strict';

const path = require('path');
const fs = require('fs');

const { buildMetronomeRetryClient } = require('../../clients/metronome-retry-client');
const { applyMetronomeApiKeyFromEnv, parseTenantFlags } = require('../../clients/metronome-tenant');
const {
  assertProductionApplyAuthorized,
  LIVE_PROD_APPLY_CONFIRMATION,
} = require('../../clients/production-apply');
const { assertOperatorModeAllows } = require('../../setup/mode');

const PRODUCTION_CATALOG_PATH = null;

function parseArg(prefix, argv = []) {
  const raw = argv.find((a) => a.startsWith(prefix));
  if (!raw) return null;
  return raw.slice(prefix.length);
}

function resolveLookupFromArgs(args = {}) {
  return {
    customerId: args.customerId || null,
    externalId: args.externalId || null,
    ingestAlias: args.ingestAlias || null,
    name: args.name || null,
    query: args.query || null,
  };
}

/** Append to printed Apply lines so agents can copy-paste without grepping. */
function prodApplyFlag(tenant) {
  if (tenant !== 'production') return '';
  return ` --confirm-prod-apply=${LIVE_PROD_APPLY_CONFIRMATION}`;
}

function tenantLabelFromArgs(args) {
  const tenant = parseTenantFlags(args.argv || []);
  if (!tenant) {
    throw new Error('Pass --sandbox or --prod/--production (refusing implicit tenant selection).');
  }
  return tenant;
}

function ensureTenantKey(args) {
  const { tenant, source } = applyMetronomeApiKeyFromEnv({
    argv: args.argv,
    requireExplicitTenantFlags: true,
  });
  return { tenant, source };
}

function makeClient(apiKey, { production = false, apply = false } = {}) {
  assertOperatorModeAllows(apply ? 'live-write' : 'live-read');
  assertProductionApplyAuthorized({ apply, prod: production, flags: {} });
  return buildMetronomeRetryClient(apiKey);
}

function snapHourUtc(iso) {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  d.setUTCMinutes(0, 0, 0);
  return d.toISOString().replace(/\.\d{3}Z$/, '.000Z');
}

function sameUtcInstant(a, b) {
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  return Number.isFinite(ta) && Number.isFinite(tb) && ta === tb;
}

function isHourBoundaryUtc(iso) {
  const d = new Date(iso);
  return Number.isFinite(d.getTime())
    && d.getUTCMinutes() === 0
    && d.getUTCSeconds() === 0
    && d.getUTCMilliseconds() === 0;
}

function addMonthsUtc(date, months) {
  const originalDay = date.getUTCDate();
  const out = new Date(date.getTime());
  out.setUTCDate(1);
  out.setUTCMonth(out.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(out.getUTCFullYear(), out.getUTCMonth() + 1, 0)).getUTCDate();
  out.setUTCDate(Math.min(originalDay, lastDay));
  return out;
}

function currentHourUtc() {
  return snapHourUtc(new Date().toISOString());
}

function nextHourUtc() {
  const d = new Date();
  d.setUTCMinutes(0, 0, 0);
  d.setUTCHours(d.getUTCHours() + 1);
  return d.toISOString().replace(/\.\d{3}Z$/, '.000Z');
}

async function listPaginated(client, method, urlBase, body = undefined) {
  const out = [];
  let next = null;
  const seen = new Set();
  for (let i = 0; i < 200; i += 1) {
    const sep = urlBase.includes('?') ? '&' : '?';
    const url = `${urlBase}${sep}limit=100${next ? `&next_page=${encodeURIComponent(next)}` : ''}`;
    const resp = method === 'get' ? await client.get(url) : await client.post(url, body || {});
    const rows = resp.data || [];
    out.push(...rows);
    if (!resp.next_page || resp.next_page === next || seen.has(resp.next_page)) break;
    seen.add(resp.next_page);
    next = resp.next_page;
  }
  return out;
}

function loadProductionCatalog() {
  if (!PRODUCTION_CATALOG_PATH) throw new Error('production catalog fixture is not available in this workspace');
  return JSON.parse(fs.readFileSync(PRODUCTION_CATALOG_PATH, 'utf8'));
}

function packageAliasById(catalog, packageId) {
  if (!packageId) return null;
  for (const g of [catalog.packages, catalog.newPackages, catalog.annualPackages, catalog.proSliderPackages]) {
    if (!g) continue;
    for (const [, p] of Object.entries(g)) {
      if (p?.id === packageId) return p.alias;
    }
  }
  return null;
}

function normalizeConfirmHash(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  return raw.startsWith('sha256:') ? raw : `sha256:${raw}`;
}

function confirmHashMatches(expected, provided) {
  return normalizeConfirmHash(expected) === normalizeConfirmHash(provided);
}

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function timestampSlug() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  PRODUCTION_CATALOG_PATH,
  parseArg,
  resolveLookupFromArgs,
  prodApplyFlag,
  LIVE_PROD_APPLY_CONFIRMATION,
  tenantLabelFromArgs,
  ensureTenantKey,
  makeClient,
  snapHourUtc,
  sameUtcInstant,
  isHourBoundaryUtc,
  addMonthsUtc,
  currentHourUtc,
  nextHourUtc,
  listPaginated,
  loadProductionCatalog,
  packageAliasById,
  normalizeConfirmHash,
  confirmHashMatches,
  mkdirp,
  timestampSlug,
  sleep,
};
