'use strict';

/**
 * Customer lookup for ops.
 *
 * Fast paths (1 API call): --customer-id, --ingest-alias, email-shaped --name.
 * Name / lev_id custom_fields fallbacks page /v1/customers but **stop at the
 * first exact hit** - full-tenant scans were taking ~60-100s in sandbox/prod.
 * ponytail: duplicate display names later in the list won't be detected; pass
 * --customer-id when uniqueness matters.
 */

function rowsFromLookup(resp) {
  return resp?.data || [];
}

function looksLikeEmail(value) {
  const s = String(value || '').trim();
  return s.includes('@') && !s.includes(' ');
}

async function getCustomerById(client, customerId) {
  const resp = await client.get(`/v1/customers/${customerId}`);
  return resp.data || resp;
}

async function findByIngestAlias(client, ingestAlias) {
  const resp = await client.get(`/v1/customers?ingest_alias=${encodeURIComponent(ingestAlias)}&only_archived=false&limit=5`);
  const rows = rowsFromLookup(resp);
  if (rows.length === 1) return { customer: rows[0], method: 'ingest_alias' };
  if (rows.length > 1) {
    return { candidates: rows, method: 'ingest_alias_ambiguous' };
  }
  return null;
}

/**
 * Page /v1/customers, invoking onPage(rows) each time.
 * Return whatever onPage returns (truthy) to stop early.
 */
async function forEachCustomerPage(client, onPage) {
  let next = null;
  const seen = new Set();
  for (let i = 0; i < 200; i += 1) {
    const url = `/v1/customers?limit=100${next ? `&next_page=${encodeURIComponent(next)}` : ''}`;
    const resp = await client.get(url);
    const rows = resp.data || [];
    const stop = await onPage(rows);
    if (stop) return stop;
    if (!resp.next_page || resp.next_page === next || seen.has(resp.next_page)) break;
    seen.add(resp.next_page);
    next = resp.next_page;
  }
  return null;
}

async function findByLevId(client, levId) {
  const byIngest = await findByIngestAlias(client, levId);
  if (byIngest?.customer) return { customer: byIngest.customer, method: 'ingest_alias_as_lev_id' };
  if (byIngest?.candidates) return byIngest;

  const needle = String(levId);
  const hit = await forEachCustomerPage(client, (rows) => {
    const matches = rows.filter((c) => String(c.custom_fields?.lev_id ?? '') === needle);
    if (matches.length === 1) return { customer: matches[0], method: 'custom_fields.lev_id' };
    if (matches.length > 1) return { candidates: matches, method: 'lev_id_ambiguous' };
    return null;
  });
  return hit;
}

async function findByName(client, name) {
  const raw = String(name || '').trim();
  const needle = raw.toLowerCase();
  if (!needle) return null;

  // Emails are ingest aliases - never full-scan for those.
  if (looksLikeEmail(raw)) {
    const byAlias = await findByIngestAlias(client, raw);
    if (byAlias?.customer) return { customer: byAlias.customer, method: 'name_as_ingest_alias' };
    if (byAlias?.candidates) return byAlias;
  }

  let partialHits = [];
  let pagesScanned = 0;
  // ponytail: partial-name full-tenant scans were 60-100s; cap pages then ask for --customer-id
  const MAX_PARTIAL_PAGES = 3;

  const hit = await forEachCustomerPage(client, (rows) => {
    pagesScanned += 1;
    const exact = rows.filter((c) => String(c.name || '').trim().toLowerCase() === needle);
    if (exact.length === 1) return { customer: exact[0], method: 'name_exact' };
    if (exact.length > 1) return { candidates: exact, method: 'name_ambiguous' };
    for (const c of rows) {
      if (String(c.name || '').toLowerCase().includes(needle)) partialHits.push(c);
    }
    if (partialHits.length > 25) partialHits = partialHits.slice(0, 25);
    if (pagesScanned >= MAX_PARTIAL_PAGES) {
      return { _partialCap: true };
    }
    return null;
  });
  if (hit && !hit._partialCap) return hit;

  if (partialHits.length === 1) return { customer: partialHits[0], method: 'name_partial' };
  if (partialHits.length > 1) return { candidates: partialHits, method: 'name_partial_ambiguous' };
  if (hit?._partialCap) {
    return {
      error: `No exact name match for "${raw}" in first ${MAX_PARTIAL_PAGES} customer pages. Pass --customer-id= from metro ops who, or the exact display name.`,
      method: 'name_partial_capped',
    };
  }
  return null;
}

/**
 * Turn whatever sales pasted (name, UUID, lev id, levos URL) into resolve options.
 * UUID → try customer_id then ingest_alias. Digits /accounts/N → lev_id. Else name.
 */
function guessCustomerLookup(query) {
  const q = String(query || '').trim();
  if (!q) return {};

  const fromUrl = q.match(/\/accounts\/(\d+)\b/i);
  if (fromUrl) {
    return { levId: fromUrl[1], ingestAlias: fromUrl[1], query: q, guessedAs: 'levos_account_url' };
  }

  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(q)) {
    return { customerId: q, ingestAlias: q, query: q, guessedAs: 'uuid' };
  }

  if (/^\d+$/.test(q)) {
    return { levId: q, ingestAlias: q, query: q, guessedAs: 'numeric_id' };
  }

  if (looksLikeEmail(q)) {
    return { ingestAlias: q, name: q, query: q, guessedAs: 'email' };
  }

  return { name: q, query: q, guessedAs: 'name' };
}

/** Expand --query= / mispasted --name=<uuid|lev-id|url> into fast lookup fields. */
function expandLookupOptions(options = {}) {
  const hasStructured = Boolean(options.customerId || options.levId || options.ingestAlias);
  if (options.query && !hasStructured && !options.name) {
    return { ...options, ...guessCustomerLookup(options.query) };
  }
  // Cookbook still uses --name= for everything sales pastes - route UUID/digits/URL/email to fast paths.
  if (options.name && !hasStructured && !options.query) {
    const guessed = guessCustomerLookup(options.name);
    if (guessed.guessedAs && guessed.guessedAs !== 'name') {
      const next = { ...options, ...guessed };
      if (guessed.guessedAs !== 'email') delete next.name;
      return next;
    }
  }
  return options;
}

async function resolveCustomer(client, options = {}) {
  const attempts = [];
  const opts = expandLookupOptions(options);

  if (opts.customerId) {
    try {
      const customer = await getCustomerById(client, opts.customerId);
      if (customer?.id) {
        return {
          customer,
          lookup: { method: 'customer_id', customer_id: opts.customerId, guessedAs: opts.guessedAs || null },
        };
      }
    } catch (err) {
      attempts.push({ method: 'customer_id', error: err.message });
    }
  }

  if (opts.ingestAlias) {
    const hit = await findByIngestAlias(client, opts.ingestAlias);
    if (hit?.customer) {
      return {
        customer: hit.customer,
        lookup: { method: 'ingest_alias', ingest_alias: opts.ingestAlias, guessedAs: opts.guessedAs || null },
      };
    }
    if (hit?.candidates) {
      return {
        error: `ingest_alias ${opts.ingestAlias} matched ${hit.candidates.length} customers`,
        candidates: hit.candidates.map(summarizeCustomer),
        lookup: { method: hit.method, guessedAs: opts.guessedAs || null },
      };
    }
    attempts.push({ method: 'ingest_alias', hits: 0 });
  }

  if (opts.levId) {
    const hit = await findByLevId(client, opts.levId);
    if (hit?.customer) {
      return {
        customer: hit.customer,
        lookup: { method: hit.method, lev_id: opts.levId, guessedAs: opts.guessedAs || null },
      };
    }
    if (hit?.candidates) {
      return {
        error: `lev_id ${opts.levId} matched ${hit.candidates.length} customers`,
        candidates: hit.candidates.map(summarizeCustomer),
        lookup: { method: hit.method, guessedAs: opts.guessedAs || null },
      };
    }
    attempts.push({ method: 'lev_id', hits: 0 });
  }

  if (opts.name) {
    const hit = await findByName(client, opts.name);
    if (hit?.error && !hit.customer && !hit.candidates) {
      return {
        error: hit.error,
        lookup: { method: hit.method, name: opts.name, guessedAs: opts.guessedAs || null },
      };
    }
    if (hit?.customer) {
      return {
        customer: hit.customer,
        lookup: { method: hit.method, name: opts.name, guessedAs: opts.guessedAs || null },
      };
    }
    if (hit?.candidates) {
      return {
        error: `name ${opts.name} matched ${hit.candidates.length} customers`,
        candidates: hit.candidates.map(summarizeCustomer),
        lookup: { method: hit.method, guessedAs: opts.guessedAs || null },
      };
    }
    attempts.push({ method: 'name', hits: 0 });
  }

  return {
    error: 'Customer not found. Pass a name, UUID, lev id, levos URL, or --customer-id/--lev-id/--ingest-alias/--name. Prefer: metro ops who "<paste>" --prod',
    attempts,
  };
}

function summarizeCustomer(customer) {
  return {
    id: customer.id,
    name: customer.name,
    lev_id: customer.custom_fields?.lev_id ?? null,
    ingest_aliases: customer.ingest_aliases || [],
    archived_at: customer.archived_at || null,
  };
}

module.exports = {
  resolveCustomer,
  summarizeCustomer,
  getCustomerById,
  findByName,
  findByLevId,
  findByIngestAlias,
  looksLikeEmail,
  guessCustomerLookup,
  expandLookupOptions,
};
