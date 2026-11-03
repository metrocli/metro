'use strict';

/**
 * In-memory Metronome tenant behind a mocked global fetch. No network, ever:
 * any request this fake does not model fails the test.
 *
 * Writes mutate state so read-back passes naturally. Set fake.dropWrites = true
 * to accept writes (200) without applying them, which must make every op's
 * read-back fail with exit 3.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const API = 'https://api.metronome.com';

class FakeMetronome {
  constructor(seed = {}) {
    this.nextId = 100;
    this.calls = [];
    this.dropWrites = false;
    this.customers = seed.customers || [];
    this.contracts = seed.contracts || [];
    this.packages = seed.packages || [];
    this.rateCards = seed.rateCards || [];
    this.rates = seed.rates || []; // { rate_card_id, product_id, starting_at, entitled, rate: {...}, pricing_group_values, billing_frequency }
    this.products = seed.products || [];
    this.balances = seed.balances || [];
    this.netBalances = seed.netBalances || {}; // `${customerId}:${creditTypeId}` -> number
    this.billingConfigs = seed.billingConfigs || [];
    this.invoices = seed.invoices || [];
    this.customFieldKeys = seed.customFieldKeys || [];
    this.seats = seed.seats || {}; // subscriptionId -> { total_quantity, assigned_seat_ids }
  }

  newId() {
    this.nextId += 1;
    return id(this.nextId);
  }

  get writes() {
    return this.calls.filter((c) => c.write);
  }

  install() {
    this.prevFetch = global.fetch;
    global.fetch = async (url, init = {}) => {
      const u = new URL(url);
      if (u.origin !== API) throw new Error(`fake-metronome: unexpected host ${u.origin}`);
      const method = (init.method || 'GET').toUpperCase();
      const body = init.body ? JSON.parse(init.body) : undefined;
      const out = this.handle(method, u.pathname, u.searchParams, body);
      return {
        ok: out.status < 400,
        status: out.status,
        statusText: String(out.status),
        text: async () => JSON.stringify(out.json),
      };
    };
    return this;
  }

  uninstall() {
    global.fetch = this.prevFetch;
  }

  record(method, p, body, write) {
    this.calls.push({ method, path: p, body, write });
  }

  handle(method, p, q, body) {
    const ok = (json) => ({ status: 200, json });
    const notFound = (message = 'not found') => ({ status: 404, json: { message } });
    const write = (fn) => {
      this.record(method, p, body, true);
      if (this.dropWrites) return ok({ data: { id: this.newId() } });
      return fn();
    };
    let m;

    // ---------------- customers
    if (method === 'GET' && p === '/v1/customers') {
      this.record(method, p, null, false);
      const alias = q.get('ingest_alias');
      const archived = q.get('only_archived') === 'true';
      let rows = this.customers.filter((c) => Boolean(c.archived_at) === archived);
      if (alias) rows = rows.filter((c) => (c.ingest_aliases || []).includes(alias));
      return ok({ data: rows, next_page: null });
    }
    if (method === 'POST' && p === '/v1/customers') {
      return write(() => {
        const c = { id: this.newId(), external_id: body.ingest_aliases?.[0] || null, archived_at: null, ...body };
        delete c.customer_billing_provider_configurations;
        this.customers.push(c);
        for (const cfg of body.customer_billing_provider_configurations || []) {
          this.billingConfigs.push({ id: this.newId(), customer_id: c.id, archived_at: null, delivery_method_id: null, ...cfg });
        }
        return ok({ data: c });
      });
    }
    if (method === 'GET' && (m = p.match(/^\/v1\/customers\/([^/]+)\/invoices$/))) {
      this.record(method, p, null, false);
      return ok({ data: this.invoices.filter((i) => i.customer_id === m[1]), next_page: null });
    }
    if (method === 'GET' && (m = p.match(/^\/v1\/customers\/([^/]+)$/))) {
      this.record(method, p, null, false);
      const c = this.customers.find((x) => x.id === m[1]);
      return c ? ok({ data: c }) : notFound();
    }
    if (method === 'POST' && p === '/v1/customFields/listKeys') {
      this.record(method, p, body, false);
      return ok({ data: this.customFieldKeys, next_page: null });
    }

    // ---------------- contracts
    if (method === 'POST' && p === '/v2/contracts/list') {
      this.record(method, p, body, false);
      return ok({ data: this.contracts.filter((c) => c.customer_id === body.customer_id && (body.include_archived || !c.archived_at)), cursor: null });
    }
    if (method === 'POST' && p === '/v2/contracts/get') {
      this.record(method, p, body, false);
      const c = this.contracts.find((x) => x.id === body.contract_id && x.customer_id === body.customer_id);
      return c ? ok({ data: c }) : notFound();
    }
    if (method === 'POST' && p === '/v1/contracts/updateEndDate') {
      return write(() => {
        const c = this.contracts.find((x) => x.id === body.contract_id);
        if (!c) return notFound();
        c.ending_before = body.ending_before;
        return ok({ data: { id: c.id } });
      });
    }
    if (method === 'POST' && p === '/v1/contracts/archive') {
      return write(() => {
        const c = this.contracts.find((x) => x.id === body.contract_id);
        c.archived_at = '2026-11-03T00:00:00.000Z';
        return ok({ data: { id: c.id } });
      });
    }
    if (method === 'POST' && p === '/v1/contracts/create') {
      return write(() => {
        if (this.contracts.some((c) => c.uniqueness_key && c.uniqueness_key === body.uniqueness_key)) {
          return { status: 409, json: { message: 'uniqueness_key already used' } };
        }
        const pkg = body.package_id ? this.packages.find((x) => x.id === body.package_id) : null;
        const c = {
          id: this.newId(),
          customer_id: body.customer_id,
          starting_at: body.starting_at,
          ending_before: body.ending_before || null,
          package_id: body.package_id || null,
          rate_card_id: body.rate_card_id || pkg?.rate_card_id || null,
          uniqueness_key: body.uniqueness_key,
          commits: [],
          credits: [],
          subscriptions: (body.subscriptions || []).map((s) => this.toSubscription(s, body.starting_at)),
        };
        this.contracts.push(c);
        return ok({ data: { id: c.id } });
      });
    }
    if (method === 'POST' && p === '/v2/contracts/edit') {
      return write(() => this.applyEdit(body));
    }
    if (method === 'POST' && p === '/v1/contracts/getSubscriptionSeatsHistory') {
      this.record(method, p, body, false);
      const s = this.seats[body.subscription_id] || { total_quantity: 0, assigned_seat_ids: [] };
      return ok({ data: [{ starting_at: '2026-01-01T00:00:00.000Z', ending_before: null, ...s }], next_page: null });
    }

    // ---------------- balances
    if (method === 'POST' && p === '/v1/contracts/customerBalances/list') {
      this.record(method, p, body, false);
      return ok({ data: this.balances.filter((b) => b.customer_id === body.customer_id), next_page: null });
    }
    if (method === 'POST' && p === '/v1/contracts/customerBalances/getNetBalance') {
      this.record(method, p, body, false);
      const key = `${body.customer_id}:${body.credit_type_id}`;
      const fallback = this.balances.filter((b) => b.customer_id === body.customer_id
        && (b.access_schedule?.credit_type?.id || null) === (body.credit_type_id || null)).reduce((s, b) => s + b.balance, 0);
      return ok({ data: { balance: key in this.netBalances ? this.netBalances[key] : fallback, credit_type_id: body.credit_type_id } });
    }
    if (method === 'POST' && p === '/v1/contracts/addManualBalanceLedgerEntry') {
      return write(() => {
        const b = this.balances.find((x) => x.id === body.id);
        b.balance += body.amount;
        return ok({});
      });
    }

    // ---------------- billing provider
    if (method === 'POST' && p === '/v1/getCustomerBillingProviderConfigurations') {
      this.record(method, p, body, false);
      return ok({ data: this.billingConfigs.filter((c) => c.customer_id === body.customer_id && (body.include_archived || !c.archived_at)) });
    }
    if (method === 'POST' && p === '/v1/archiveCustomerBillingProviderConfigurations') {
      return write(() => {
        for (const c of this.billingConfigs) if (body.customer_billing_provider_configuration_ids.includes(c.id)) c.archived_at = '2026-11-03T00:00:00.000Z';
        return ok({ data: body });
      });
    }
    if (method === 'POST' && p === '/v1/setCustomerBillingProviderConfigurations') {
      return write(() => {
        const rows = body.data.map((d) => ({ id: this.newId(), archived_at: null, ...d }));
        this.billingConfigs.push(...rows);
        return ok({ data: rows });
      });
    }

    // ---------------- packages
    if (method === 'POST' && p === '/v1/packages/list') {
      this.record(method, p, body, false);
      const filter = body?.archive_filter || 'NOT_ARCHIVED';
      const rows = this.packages.filter((x) => (filter === 'ALL' ? true : filter === 'ARCHIVED' ? x.archived_at : !x.archived_at));
      return ok({ data: rows, next_page: null });
    }
    if (method === 'POST' && p === '/v1/packages/get') {
      this.record(method, p, body, false);
      const pkg = this.packages.find((x) => x.id === body.package_id);
      return pkg ? ok({ data: pkg }) : notFound();
    }
    if (method === 'POST' && p === '/v1/packages/create') {
      return write(() => {
        if (this.packages.some((x) => String(x.uniqueness_key).replace(/^package:/, '') === body.uniqueness_key)) {
          return { status: 409, json: { message: 'uniqueness_key already used' } };
        }
        // Metronome echoes offsets as strings and prefixes uniqueness keys.
        const pkg = JSON.parse(JSON.stringify(body));
        pkg.id = this.newId();
        pkg.uniqueness_key = `package:${body.uniqueness_key}`;
        this.packages.push(pkg);
        return ok({ data: { id: pkg.id } });
      });
    }
    if (method === 'POST' && p === '/v1/packages/listContractsOnPackage') {
      this.record(method, p, body, false);
      const rows = this.contracts.filter((c) => c.package_id === body.package_id)
        .map((c) => ({ contract_id: c.id, customer_id: c.customer_id, starting_at: c.starting_at, ending_before: c.ending_before || null, archived_at: c.archived_at || null }));
      return ok({ data: rows, next_page: null });
    }

    // ---------------- rate cards / products
    if (method === 'POST' && p === '/v1/contract-pricing/rate-cards/list') {
      this.record(method, p, body, false);
      return ok({ data: this.rateCards, next_page: null });
    }
    if (method === 'POST' && p === '/v1/contract-pricing/rate-cards/get') {
      this.record(method, p, body, false);
      const rc = this.rateCards.find((x) => x.id === body.id);
      return rc ? ok({ data: rc }) : notFound();
    }
    if (method === 'POST' && p === '/v1/contract-pricing/rate-cards/create') {
      return write(() => {
        const rc = { id: this.newId(), ...body };
        this.rateCards.push(rc);
        return ok({ data: { id: rc.id } });
      });
    }
    if (method === 'POST' && p === '/v1/contract-pricing/rate-cards/addRates') {
      return write(() => {
        for (const r of body.rates) {
          const { product_id, starting_at, ending_before, entitled, pricing_group_values, billing_frequency, ...rate } = r;
          this.rates.push({ rate_card_id: body.rate_card_id, product_id, starting_at, ending_before, entitled, pricing_group_values, billing_frequency, rate });
        }
        return ok({ data: { id: body.rate_card_id } });
      });
    }
    if (method === 'POST' && p === '/v1/contract-pricing/rate-cards/getRates') {
      this.record(method, p, body, false);
      let rows = this.rates.filter((r) => r.rate_card_id === body.rate_card_id);
      if (body.selectors) {
        rows = rows.filter((r) => body.selectors.some((s) => (!s.product_id || s.product_id === r.product_id)
          && (!s.billing_frequency || s.billing_frequency === r.billing_frequency)));
      }
      return ok({ data: rows.map(({ rate_card_id, ...row }) => row), next_page: null });
    }
    if (method === 'POST' && p === '/v1/contract-pricing/products/get') {
      this.record(method, p, body, false);
      const prod = this.products.find((x) => x.id === body.id);
      return prod ? ok({ data: prod }) : notFound();
    }

    return { status: 418, json: { message: `fake-metronome does not model ${method} ${p}` } };
  }

  toSubscription(s, contractStart) {
    const startingAt = s.starting_at || contractStart;
    return {
      id: this.newId(),
      created_at: new Date(Date.UTC(2026, 0, 1) + this.nextId * 1000).toISOString(),
      subscription_rate: { billing_frequency: s.subscription_rate.billing_frequency, product: { id: s.subscription_rate.product_id, name: 'Seats' } },
      collection_schedule: s.collection_schedule,
      proration: s.proration,
      quantity_management_mode: s.quantity_management_mode || 'QUANTITY_ONLY',
      seat_config: s.seat_config || null,
      starting_at: startingAt,
      quantity_schedule: [{ starting_at: startingAt, quantity: s.initial_quantity ?? (s.seat_config?.initial_seat_ids || []).length }],
    };
  }

  applyEdit(body) {
    const c = this.contracts.find((x) => x.id === body.contract_id);
    if (!c) return { status: 400, json: { code: 'ContractNotFound', message: 'contract not found' } };
    for (const s of body.add_subscriptions || []) c.subscriptions = [...(c.subscriptions || []), this.toSubscription(s, c.starting_at)];
    for (const u of body.update_subscriptions || []) {
      const sub = c.subscriptions.find((s) => s.id === u.subscription_id);
      for (const qu of u.quantity_updates || []) {
        for (const row of sub.quantity_schedule) if (!row.ending_before || Date.parse(row.ending_before) > Date.parse(qu.starting_at)) row.ending_before = qu.starting_at;
        sub.quantity_schedule.push({ starting_at: qu.starting_at, quantity: qu.quantity });
      }
      if (u.seat_updates) {
        const st = this.seats[sub.id] || { total_quantity: 0, assigned_seat_ids: [] };
        for (const a of u.seat_updates.add_seat_ids || []) {
          st.assigned_seat_ids.push(...a.seat_ids);
          st.total_quantity = Math.max(st.total_quantity, st.assigned_seat_ids.length);
        }
        for (const r of u.seat_updates.remove_seat_ids || []) st.assigned_seat_ids = st.assigned_seat_ids.filter((x) => !r.seat_ids.includes(x));
        for (const a of u.seat_updates.add_unassigned_seats || []) st.total_quantity += a.quantity;
        for (const r of u.seat_updates.remove_unassigned_seats || []) st.total_quantity -= r.quantity;
        this.seats[sub.id] = st;
      }
    }
    for (const k of ['add_credits', 'add_commits']) {
      const list = k === 'add_credits' ? (c.credits = c.credits || []) : (c.commits = c.commits || []);
      for (const item of body[k] || []) {
        const { product_id, ...rest } = item;
        list.push({ id: this.newId(), product: { id: product_id }, ...rest });
      }
    }
    for (const k of ['archive_credits', 'archive_commits']) {
      for (const { id: bid } of body[k] || []) {
        this.balances = this.balances.filter((b) => b.id !== bid);
        const list = k === 'archive_credits' ? c.credits || [] : c.commits || [];
        const row = list.find((x) => x.id === bid);
        if (row) row.archived_at = '2026-11-03T00:00:00.000Z';
      }
    }
    return { status: 200, json: { data: { id: c.id } } };
  }
}

/** Isolated env: temp HOME, read-write mode, fake keys, no prod tokens. */
function testEnv() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'metro-ops-test-'));
  const saved = {};
  const set = {
    HOME: home,
    USERPROFILE: home,
    METRO_MODE: 'read-write',
    METRO_LOG_DIR: path.join(home, 'logs'),
    METRO_ENV_FILE: path.join(home, 'no-such.env'),
    METRONOME_SANDBOX_KEY: 'test-sandbox-key',
    METRONOME_PROD_KEY: 'test-prod-key',
    METRONOME_API_KEY: undefined,
    ALLOW_DANGEROUS_SCRIPT: undefined,
    METRO_CONFIRM_PROD_APPLY: undefined,
    METRO_EXTERNAL_ID_FIELDS: undefined,
    METRO_WORKSPACE_PACK: 'generic',
  };
  for (const [k, v] of Object.entries(set)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return {
    home,
    restore() {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    },
  };
}

function captureStreams() {
  const out = { stdout: '', stderr: '' };
  return {
    out,
    streams: {
      stdout: { write: (s) => { out.stdout += s; } },
      stderr: { write: (s) => { out.stderr += s; } },
    },
  };
}

/** Run an op runner with argv; returns { exitCode, json, stdout, stderr, result }. */
async function runOp(fn, argv) {
  const { out, streams } = captureStreams();
  const r = await fn({ argv }, streams);
  let json = null;
  try {
    json = JSON.parse(out.stdout);
  } catch {
    // human output
  }
  return { exitCode: r.exitCode, json, stdout: out.stdout, stderr: out.stderr, result: r.result, error: r.error };
}

module.exports = { FakeMetronome, testEnv, runOp, id };
