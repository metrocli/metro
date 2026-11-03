'use strict';

/**
 * Customer lookup for ops.
 *
 * Fast paths (1 API call): --customer-id, --ingest-alias, email-shaped --name.
 * Name / external-id fallbacks page /v1/customers but **stop at the first
 * exact hit** - full-tenant scans were taking ~60-100s in sandbox/prod.
 *
 * External ids are Metronome-native: an ingest alias, the customer
 * `external_id`, or a custom field. The custom field keys default to
 * `external_id` and can be overridden with METRO_EXTERNAL_ID_FIELDS
 * (comma-separated) or options.externalIdFields.
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

const DEFAULT_EXTERNAL_ID_FIELDS = Object.freeze(['external_id']);

function externalIdFields(options = {}) {
  const raw = options.externalIdFields
    || process.env.METRO_EXTERNAL_ID_FIELDS
    || null;
  if (!raw) return [...DEFAULT_EXTERNAL_ID_FIELDS];
  const list = Array.isArray(raw) ? raw : String(raw).split(',');
  const cleaned = list.map((f) => String(f).trim()).filter(Boolean);
  return cleaned.length ? cleaned : [...DEFAULT_EXTERNAL_ID_FIELDS];
}

/** First external id found on a customer: custom field keys, then customer.external_id. */
function customerExternalId(customer, options = {}) {
  if (!customer) return null;
  for (const field of externalIdFields(options)) {
    const value = customer.custom_fields?.[field];
    if (value !== undefined && value !== null && String(value) !== '') return String(value);
  }
  if (customer.external_id !== undefined && customer.external_id !== null && customer.external_id !== '') {
    return String(customer.external_id);
  }
  return null;
}

function matchesExternalId(customer, needle, fields) {
  if (String(customer.external_id ?? '') === needle) return true;
  return fields.some((field) => String(customer.custom_fields?.[field] ?? '') === needle);
}

async function findByExternalId(client, externalId, options = {}) {
  const byIngest = await findByIngestAlias(client, externalId);
  if (byIngest?.customer) return { customer: byIngest.customer, method: 'ingest_alias_as_external_id' };
  if (byIngest?.candidates) return byIngest;

  const needle = String(externalId);
  const fields = externalIdFields(options);
  const hit = await forEachCustomerPage(client, (rows) => {
    const matches = rows.filter((c) => matchesExternalId(c, needle, fields));
    if (matches.length === 1) return { customer: matches[0], method: 'external_id' };
    if (matches.length > 1) return { candidates: matches, method: 'external_id_ambiguous' };
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
 * Turn whatever an operator pasted (name, UUID, external id, email) into resolve options.
 * UUID -> try customer_id then ingest_alias. Digits -> external id. Else name.
 */
function guessCustomerLookup(query) {
  const q = String(query || '').trim();
  if (!q) return {};

  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(q)) {
    return { customerId: q, ingestAlias: q, query: q, guessedAs: 'uuid' };
  }

  if (/^\d+$/.test(q)) {
    return { externalId: q, ingestAlias: q, query: q, guessedAs: 'numeric_id' };
  }

  if (looksLikeEmail(q)) {
    return { ingestAlias: q, name: q, query: q, guessedAs: 'email' };
  }

  return { name: q, query: q, guessedAs: 'name' };
}

/** Expand --query= / mispasted --name=<uuid|external-id|email> into fast lookup fields. */
function expandLookupOptions(options = {}) {
  const hasStructured = Boolean(options.customerId || options.externalId || options.ingestAlias);
  if (options.query && !hasStructured && !options.name) {
    return { ...options, ...guessCustomerLookup(options.query) };
  }
  // Cookbook still uses --name= for everything operators paste - route UUID/digits/email to fast paths.
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

  if (opts.externalId) {
    const hit = await findByExternalId(client, opts.externalId, opts);
    if (hit?.customer) {
      return {
        customer: hit.customer,
        lookup: { method: hit.method, external_id: opts.externalId, guessedAs: opts.guessedAs || null },
      };
    }
    if (hit?.candidates) {
      return {
        error: `external id ${opts.externalId} matched ${hit.candidates.length} customers`,
        candidates: hit.candidates.map((c) => summarizeCustomer(c, opts)),
        lookup: { method: hit.method, guessedAs: opts.guessedAs || null },
      };
    }
    attempts.push({ method: 'external_id', hits: 0 });
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
    error: 'Customer not found. Pass a name, UUID, external id, or --customer-id/--external-id/--ingest-alias/--name. Prefer: metro ops who "<paste>" --prod',
    attempts,
  };
}

function summarizeCustomer(customer, options = {}) {
  return {
    id: customer.id,
    name: customer.name,
    external_id: customerExternalId(customer, options),
    ingest_aliases: customer.ingest_aliases || [],
    archived_at: customer.archived_at || null,
  };
}

module.exports = {
  resolveCustomer,
  summarizeCustomer,
  getCustomerById,
  findByName,
  findByExternalId,
  customerExternalId,
  externalIdFields,
  findByIngestAlias,
  looksLikeEmail,
  guessCustomerLookup,
  expandLookupOptions,
};
