'use strict';

// Adapted from the internal customer-resolve fast-path tests, with generic
// external ids (ingest alias, customer.external_id, configurable custom field).

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { REPO_ROOT } = require('./helpers');

const {
  findByName,
  findByExternalId,
  guessCustomerLookup,
  expandLookupOptions,
  resolveCustomer,
  summarizeCustomer,
  externalIdFields,
} = require(path.join(REPO_ROOT, 'packages/metro-core/src/ops-live/customer-resolve.js'));

function mockClient(pages) {
  let calls = 0;
  return {
    calls: () => calls,
    get: async (url) => {
      calls += 1;
      if (url.includes('ingest_alias=')) {
        const alias = decodeURIComponent(url.split('ingest_alias=')[1].split('&')[0]);
        return { data: pages.flat().filter((c) => (c.ingest_aliases || []).includes(alias)) };
      }
      const pageIdx = url.includes('next_page=') ? Number(decodeURIComponent(url.split('next_page=')[1])) : 0;
      const data = pages[pageIdx] || [];
      return { data, next_page: pageIdx + 1 < pages.length ? String(pageIdx + 1) : null };
    },
  };
}

test('email-shaped names resolve through ingest_alias without paging', async () => {
  const client = {
    n: 0,
    get: async (url) => {
      client.n += 1;
      if (url.includes('ingest_alias=')) return { data: [{ id: 'email-hit', name: 'Acme Corp', ingest_aliases: ['ap@acme.example'] }] };
      throw new Error('should not page customers for an email');
    },
  };
  const hit = await findByName(client, 'ap@acme.example');
  assert.equal(hit.method, 'name_as_ingest_alias');
  assert.equal(client.n, 1);
});

test('exact name match stops at the first page hit', async () => {
  const client = mockClient([
    [{ id: 'a', name: 'Acme Corp' }],
    [{ id: 'a2', name: 'Acme Corp' }],
  ]);
  const hit = await findByName(client, 'Acme Corp');
  assert.equal(hit.customer.id, 'a');
  assert.equal(client.calls(), 1);
});

test('external id resolves via ingest alias first', async () => {
  const client = mockClient([[{ id: 'c1', name: 'Acme Corp', ingest_aliases: ['acme-42'] }]]);
  const hit = await findByExternalId(client, 'acme-42');
  assert.equal(hit.method, 'ingest_alias_as_external_id');
  assert.equal(hit.customer.id, 'c1');
});

test('external id falls back to customer.external_id and custom_fields.external_id', async () => {
  const client = mockClient([[
    { id: 'c1', name: 'Globex', custom_fields: { external_id: '1001' } },
    { id: 'c2', name: 'Initech', external_id: '2002' },
  ]]);
  assert.equal((await findByExternalId(client, '1001')).customer.id, 'c1');
  assert.equal((await findByExternalId(client, '2002')).customer.id, 'c2');
});

test('custom field keys for external ids are configurable', async () => {
  const client = mockClient([[{ id: 'c3', name: 'Umbrella', custom_fields: { crm_id: 'u-9' } }]]);
  assert.equal(await findByExternalId(client, 'u-9'), null);
  const hit = await findByExternalId(client, 'u-9', { externalIdFields: ['crm_id'] });
  assert.equal(hit.customer.id, 'c3');
  process.env.METRO_EXTERNAL_ID_FIELDS = 'crm_id, account_ref';
  try {
    assert.deepEqual(externalIdFields(), ['crm_id', 'account_ref']);
  } finally {
    delete process.env.METRO_EXTERNAL_ID_FIELDS;
  }
});

test('pasted values are guessed into generic lookup fields', () => {
  assert.equal(guessCustomerLookup('00000000-0000-4000-8000-000000000001').guessedAs, 'uuid');
  const numeric = guessCustomerLookup('12345');
  assert.equal(numeric.guessedAs, 'numeric_id');
  assert.equal(numeric.externalId, '12345');
  assert.equal(guessCustomerLookup('ap@acme.example').guessedAs, 'email');
  assert.equal(guessCustomerLookup('Acme Corp').guessedAs, 'name');
  const expanded = expandLookupOptions({ name: '12345' });
  assert.equal(expanded.externalId, '12345');
  assert.equal(expanded.name, undefined);
});

test('resolveCustomer reports external_id in summaries', async () => {
  const client = mockClient([[{ id: 'c1', name: 'Acme Corp', ingest_aliases: [], custom_fields: { external_id: 'x-1' } }]]);
  const resolved = await resolveCustomer(client, { externalId: 'x-1' });
  assert.equal(resolved.customer.id, 'c1');
  assert.equal(resolved.lookup.external_id, 'x-1');
  const summary = summarizeCustomer(resolved.customer);
  assert.equal(summary.external_id, 'x-1');
  assert.deepEqual(Object.keys(summary).sort(), ['archived_at', 'external_id', 'id', 'ingest_aliases', 'name']);
});
