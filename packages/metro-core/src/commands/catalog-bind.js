'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  applyMetronomeApiKeyFromEnv,
} = require('../clients/metronome-tenant');
const { buildMetronomeRetryClient } = require('../clients/metronome-retry-client');
const { assertOperatorModeAllows } = require('../setup/mode');
const { defaultMetroConfigDir } = require('../workspace/loader');
const { buildTenantSnapshot, writeSnapshot } = require('../tenant-snapshot');
const { classifyAccount } = require('../account-classifier');

const SCHEMA = 'metro.catalog.bind.v1';

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

function makeClient(apiKey) {
  assertOperatorModeAllows('live-read');
  return buildMetronomeRetryClient(apiKey);
}

function slugAlias(name, fallback) {
  const base = String(name || fallback || 'item')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
  return base || fallback || 'item';
}

function uniqueAliases(rows, pickName) {
  const used = new Map();
  const out = {};
  for (const row of rows) {
    let alias = slugAlias(pickName(row), row.id?.slice(0, 8));
    if (used.has(alias)) {
      const n = used.get(alias) + 1;
      used.set(alias, n);
      alias = `${alias}_${n}`;
    } else {
      used.set(alias, 1);
    }
    out[alias] = row.id;
  }
  return out;
}

function scoreUsageProduct(product) {
  const name = String(product.name || '').toLowerCase();
  let score = 0;
  if (/credit|usage|consum|dimensional|action/.test(name)) score += 5;
  if (product.type === 'USAGE' || product.product_type === 'USAGE') score += 3;
  return score;
}

function pickBest(rows, scorer) {
  if (!rows.length) return null;
  return [...rows].sort((a, b) => scorer(b) - scorer(a))[0];
}

function loadProfiles(profilePath) {
  if (!fs.existsSync(profilePath)) {
    return {
      schemaVersion: 'metro.profiles.v1',
      defaultProfile: null,
      profiles: {},
    };
  }
  return JSON.parse(fs.readFileSync(profilePath, 'utf8'));
}

function profileNameForTenant(config, tenant) {
  if (config.defaultProfile && config.profiles?.[config.defaultProfile]?.tenant === tenant) {
    return config.defaultProfile;
  }
  const match = Object.entries(config.profiles || {}).find(([, profile]) => profile.tenant === tenant);
  if (match) return match[0];
  return tenant === 'production' ? 'metro-production' : 'metro-sandbox';
}

function buildWorkspaceCatalog(discovery) {
  return {
    creditTypeId: discovery.creditTypeId || '<credit-type-id>',
    dimensionalBillableMetricId: discovery.dimensionalBillableMetricId || '<billable-metric-id>',
    sharedDimensionalProductId: discovery.sharedDimensionalProductId || '<usage-product-id>',
    payloadMode: 'code-only',
    fixedProductId: discovery.fixedProductId || '<fixed-product-id>',
    seatProductId: discovery.seatProductId || '<seat-product-id>',
    rateCardIds: discovery.rateCardIds || {},
    dimensionalProductIds: discovery.dimensionalProductIds || {},
  };
}

function missingFields(catalog) {
  const missing = [];
  for (const key of [
    'creditTypeId',
    'dimensionalBillableMetricId',
    'sharedDimensionalProductId',
  ]) {
    const value = catalog[key];
    if (!value || String(value).startsWith('<')) missing.push(key);
  }
  if (!catalog.rateCardIds || Object.keys(catalog.rateCardIds).length === 0) {
    missing.push('rateCardIds');
  }
  return missing;
}

async function discoverCatalog(client) {
  const [rateCards, products, billableMetrics] = await Promise.all([
    listPaginated(client, 'post', '/v1/contract-pricing/rate-cards/list', {}),
    listPaginated(client, 'post', '/v1/contract-pricing/products/list', { archive_filter: 'NOT_ARCHIVED' }),
    listPaginated(client, 'get', '/v1/billable-metrics'),
  ]);

  let creditTypes = [];
  try {
    creditTypes = await listPaginated(client, 'get', '/v1/credits/listTypes');
  } catch {
    try {
      const resp = await client.get('/v1/credits/listTypes');
      creditTypes = resp.data || resp || [];
      if (!Array.isArray(creditTypes)) creditTypes = [];
    } catch {
      creditTypes = [];
    }
  }

  const rateCardIds = uniqueAliases(rateCards.filter((row) => !row.archived_at), (row) => row.name);
  const usageProducts = products.filter((p) => !p.archived_at);
  const bestUsage = pickBest(usageProducts, scoreUsageProduct);
  const fixed = usageProducts.find((p) => /fixed|plan fee|subscription/i.test(String(p.name || ''))) || null;
  const seat = usageProducts.find((p) => /seat/i.test(String(p.name || ''))) || null;
  const bestMetric = pickBest(billableMetrics, (m) => {
    const name = String(m.name || '').toLowerCase();
    return /credit|usage|consum|count|dimensional/.test(name) ? 5 : 1;
  });
  const bestCreditType = creditTypes[0] || null;

  return {
    counts: {
      rateCards: rateCards.length,
      products: products.length,
      billableMetrics: billableMetrics.length,
      creditTypes: creditTypes.length,
    },
    candidates: {
      rateCards: rateCards.slice(0, 25).map((row) => ({ id: row.id, name: row.name || null, archived: Boolean(row.archived_at) })),
      products: usageProducts.slice(0, 25).map((row) => ({ id: row.id, name: row.name || null })),
      billableMetrics: billableMetrics.slice(0, 25).map((row) => ({ id: row.id, name: row.name || null })),
      creditTypes: creditTypes.slice(0, 25).map((row) => ({ id: row.id || row.credit_type_id, name: row.name || null })),
    },
    creditTypeId: bestCreditType?.id || bestCreditType?.credit_type_id || null,
    dimensionalBillableMetricId: bestMetric?.id || null,
    sharedDimensionalProductId: bestUsage?.id || null,
    fixedProductId: fixed?.id || null,
    seatProductId: seat?.id || null,
    rateCardIds,
    dimensionalProductIds: {},
  };
}

function showCurrent(flags, streams) {
  const dir = flags.dir ? path.resolve(String(flags.dir)) : defaultMetroConfigDir();
  const profilePath = flags.file && flags.file !== true
    ? path.resolve(String(flags.file))
    : path.join(dir, 'profiles.json');
  const config = loadProfiles(profilePath);
  const tenant = flags.prod || flags.production ? 'production' : 'sandbox';
  const profileName = flags.profile && flags.profile !== true
    ? String(flags.profile)
    : profileNameForTenant(config, tenant);
  const catalog = config.profiles?.[profileName]?.workspaceCatalog || null;
  const missing = catalog ? missingFields(catalog) : ['(no workspaceCatalog)'];
  const payload = {
    schemaVersion: SCHEMA,
    mode: 'show',
    profilePath,
    profileName,
    tenant,
    workspaceCatalog: catalog,
    missing,
    nextSafeStep: missing.length
      ? `metro catalog bind --${tenant === 'production' ? 'prod' : 'sandbox'} --write`
      : 'Catalog looks bound. Try metro plan rollout-dimension-across-cards --sandbox --json',
  };
  if (flags.json) {
    streams.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else {
    streams.stdout.write(`Profile ${profileName} (${tenant}) in ${profilePath}\n`);
    streams.stdout.write(catalog
      ? `workspaceCatalog keys: ${Object.keys(catalog).join(', ')}\n`
      : 'No workspaceCatalog bound.\n');
    streams.stdout.write(`Missing: ${missing.join(', ')}\n`);
    streams.stdout.write(`${payload.nextSafeStep}\n`);
  }
  return 0;
}

async function runBind(flags, streams, argv) {
  const { tenant } = applyMetronomeApiKeyFromEnv({
    argv,
    requireExplicitTenantFlags: true,
  });
  const client = makeClient(process.env.METRONOME_API_KEY);
  const discovery = await discoverCatalog(client);
  const catalog = buildWorkspaceCatalog(discovery);
  const missing = missingFields(catalog);

  const dir = flags.dir ? path.resolve(String(flags.dir)) : defaultMetroConfigDir();
  const profilePath = flags.file && flags.file !== true
    ? path.resolve(String(flags.file))
    : path.join(dir, 'profiles.json');
  const config = loadProfiles(profilePath);
  const profileName = flags.profile && flags.profile !== true
    ? String(flags.profile)
    : profileNameForTenant(config, tenant);
  const keyEnv = tenant === 'production' ? 'METRONOME_PROD_KEY' : 'METRONOME_SANDBOX_KEY';

  if (!config.profiles) config.profiles = {};
  if (!config.profiles[profileName]) {
    config.profiles[profileName] = {
      tenant,
      metronomeKeyEnv: keyEnv,
      workspacePack: 'generic',
    };
  }
  if (!config.defaultProfile) config.defaultProfile = profileName;
  config.schemaVersion = config.schemaVersion || 'metro.profiles.v1';

  const payload = {
    schemaVersion: SCHEMA,
    mode: flags.write === true ? 'write' : 'dry-run',
    tenant,
    profilePath,
    profileName,
    discovery: {
      counts: discovery.counts,
      candidates: discovery.candidates,
    },
    workspaceCatalog: catalog,
    missing,
    written: false,
    nextSafeStep: flags.write === true
      ? `Review ${profilePath}. Then: metro plan add-pricing-dimension-value --dimension-key=FEATURE_X --price=100 --sandbox --json`
      : 'Re-run with --write to persist workspaceCatalog into profiles.json',
  };

  if (flags.write === true) {
    config.profiles[profileName] = {
      ...config.profiles[profileName],
      tenant,
      metronomeKeyEnv: config.profiles[profileName].metronomeKeyEnv || keyEnv,
      workspacePack: config.profiles[profileName].workspacePack || 'generic',
      workspaceCatalog: catalog,
    };
    fs.mkdirSync(path.dirname(profilePath), { recursive: true });
    fs.writeFileSync(profilePath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
    payload.written = true;

    // Persist versioned tenant snapshot for agents/router (discover.candidates → inventories).
    const discoveryForSnapshot = {
      ...discovery,
      inventories: discovery.candidates || {},
    };
    const draft = buildTenantSnapshot({
      tenant,
      discovery: discoveryForSnapshot,
      workspaceCatalog: catalog,
      sourceCommand: `metro catalog bind --${tenant === 'production' ? 'prod' : 'sandbox'} --write`,
    });
    draft.classification = classifyAccount(draft);
    const snap = writeSnapshot(draft, { configDir: dir });
    payload.snapshotPath = snap.path;
    payload.accountPattern = draft.classification.pattern;
    payload.nextSafeStep = `Review ${profilePath} and ${snap.path}. Then: metro tenant snapshot show --markdown`;
  }

  if (flags.json) {
    streams.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else {
    streams.stdout.write(`Catalog bind (${tenant}) → profile ${profileName}\n`);
    streams.stdout.write(`  rate cards: ${discovery.counts.rateCards}\n`);
    streams.stdout.write(`  products: ${discovery.counts.products}\n`);
    streams.stdout.write(`  billable metrics: ${discovery.counts.billableMetrics}\n`);
    streams.stdout.write(`  credit types: ${discovery.counts.creditTypes}\n`);
    streams.stdout.write(`  creditTypeId: ${catalog.creditTypeId}\n`);
    streams.stdout.write(`  sharedDimensionalProductId: ${catalog.sharedDimensionalProductId}\n`);
    streams.stdout.write(`  dimensionalBillableMetricId: ${catalog.dimensionalBillableMetricId}\n`);
    streams.stdout.write(`  rateCardIds: ${Object.keys(catalog.rateCardIds).length} aliases\n`);
    if (missing.length) streams.stdout.write(`  still missing: ${missing.join(', ')}\n`);
    streams.stdout.write(payload.written
      ? `Wrote ${profilePath}${payload.snapshotPath ? `\nWrote snapshot ${payload.snapshotPath} (${payload.accountPattern})` : ''}\n`
      : 'Dry-run only. Pass --write to save.\n');
    streams.stdout.write(`${payload.nextSafeStep}\n`);
  }
  return missing.length && flags.write === true ? 0 : 0;
}

function runCatalogBindCommand(positional, flags, streams, argv = []) {
  if (flags.show === true || positional[2] === 'show' || flags.help === true) {
    if (flags.help === true) {
      streams.stderr.write('Usage: metro catalog bind (--sandbox|--prod) [--write] [--file profiles.json] [--profile name] [--json]\n');
      streams.stderr.write('       metro catalog bind --show [--file profiles.json] [--profile name] [--json]\n');
      return 1;
    }
    return showCurrent(flags, streams);
  }

  if (!flags.sandbox && !flags.prod && !flags.production) {
    streams.stderr.write('Usage: metro catalog bind (--sandbox|--prod) [--write] [--json]\n');
    return 1;
  }

  return runBind(flags, streams, argv).then(
    (code) => code,
    (err) => {
      streams.stderr.write(`\nFATAL: ${err.message}\n`);
      if (err.responseData) streams.stderr.write(`${JSON.stringify(err.responseData).slice(0, 900)}\n`);
      return 1;
    },
  );
}

module.exports = {
  runCatalogBindCommand,
  buildWorkspaceCatalog,
  missingFields,
  SCHEMA,
};
