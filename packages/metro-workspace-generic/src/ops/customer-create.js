'use strict';

/**
 * Create a customer with ingest aliases, an external-id custom field and an
 * optional Stripe billing-provider configuration.
 *   POST /v1/customers        https://docs.metronome.com/api-reference/customers/create-a-customer
 *   GET  /v1/customers        https://docs.metronome.com/api-reference/customers/list-customers  (ingest_alias filter)
 *   GET  /v1/customers/{id}   https://docs.metronome.com/api-reference/customers/get-a-customer
 *   POST /v1/customFields/listKeys  https://docs.metronome.com/api-reference/custom-fields/list-custom-field-keys
 *
 * POST /v1/customers documents no uniqueness_key. Idempotency instead comes
 * from the ingest aliases: at least one is required, preflight proves every
 * alias is unused (active and archived customers), and apply re-checks right
 * before the write, so a re-run after success is refused instead of
 * duplicating the customer.
 */

const rt = require('./lib/runtime');
const mx = require('./lib/metronome');
const core = require('./lib/core');

function defaultExternalIdField() {
  return core.customerResolve.externalIdFields()[0];
}

async function aliasOwners(client, alias) {
  const enc = encodeURIComponent(alias);
  const [active, archived] = await Promise.all([
    client.get(`/v1/customers?ingest_alias=${enc}&limit=5`),
    client.get(`/v1/customers?ingest_alias=${enc}&only_archived=true&limit=5`),
  ]);
  return [...((active && active.data) || []), ...((archived && archived.data) || [])];
}

async function aliasBlockers(client, aliases) {
  const blockers = [];
  for (const alias of aliases) {
    const owners = await aliasOwners(client, alias);
    if (owners.length) {
      blockers.push({ code: 'ingest_alias_in_use', alias, customers: owners.map((c) => ({ id: c.id, name: c.name, archived_at: c.archived_at || null })) });
    }
  }
  return blockers;
}

async function customerFieldKeys(client) {
  const rows = [];
  let next = null;
  for (let i = 0; i < 50; i += 1) {
    const url = `/v1/customFields/listKeys${next ? `?next_page=${encodeURIComponent(next)}` : ''}`;
    const resp = await client.post(url, { entities: ['customer'] });
    rows.push(...((resp && resp.data) || []));
    if (!resp?.next_page || resp.next_page === next) break;
    next = resp.next_page;
  }
  return rows.filter((r) => r.entity === 'customer').map((r) => r.key);
}

function buildBody(ctx) {
  const f = ctx.flags;
  const spec = rt.readString(f, 'file') ? rt.loadSpecFile(rt.readString(f, 'file')) : {};
  const name = rt.readString(f, 'name') || spec.name;
  const aliases = [...new Set([...(spec.ingest_aliases || []), ...rt.readList(f, 'ingest-alias')])];
  const customFields = { ...(spec.custom_fields || {}), ...(rt.readJsonFlag(f, 'custom-fields') || {}) };
  const externalId = rt.readString(f, 'external-id');
  const externalIdField = rt.readString(f, 'external-id-field') || defaultExternalIdField();
  if (externalId) customFields[externalIdField] = externalId;

  if (!name) throw rt.usageError('Usage: metro customer create preflight --name="Acme Corp" --ingest-alias=<alias>[,<alias>] [--external-id=<id> [--external-id-field=<custom field key>]] [--custom-fields=<json>] [--stripe-customer-id=cus_... --stripe-collection-method=charge_automatically|send_invoice] [--file=<spec.json|yaml>] (--sandbox|--prod)');
  if (!aliases.length) throw rt.usageError('At least one --ingest-alias is required: it is the idempotency anchor for customer create.');
  for (const a of aliases) {
    if (a.length < 1 || a.length > 128) throw rt.usageError(`ingest alias must be 1-128 characters: ${a}`);
  }
  for (const [k, v] of Object.entries(customFields)) {
    if (typeof v !== 'string') throw rt.usageError(`custom field ${k} must be a string`);
    if (v.length > 200) throw rt.usageError(`custom field ${k} exceeds 200 characters`);
  }
  const body = { name, ingest_aliases: aliases };
  if (Object.keys(customFields).length) body.custom_fields = customFields;
  const stripeCustomerId = rt.readString(f, 'stripe-customer-id');
  const collection = rt.readString(f, 'stripe-collection-method');
  if (spec.customer_billing_provider_configurations) body.customer_billing_provider_configurations = spec.customer_billing_provider_configurations;
  else if (stripeCustomerId) {
    if (!['charge_automatically', 'send_invoice'].includes(collection)) {
      throw rt.usageError('--stripe-customer-id needs --stripe-collection-method=charge_automatically|send_invoice');
    }
    body.customer_billing_provider_configurations = [{
      billing_provider: 'stripe',
      delivery_method: 'direct_to_billing_provider',
      configuration: { stripe_customer_id: stripeCustomerId, stripe_collection_method: collection },
    }];
  }
  return body;
}

const customerCreate = rt.defineOp({
  name: 'customer-create',
  command: 'metro customer create',
  async preflight(ctx) {
    const body = buildBody(ctx);
    const blockers = await aliasBlockers(ctx.client, body.ingest_aliases);
    const warnings = [];
    if (body.custom_fields) {
      const keys = await customerFieldKeys(ctx.client);
      for (const k of Object.keys(body.custom_fields)) {
        if (!keys.includes(k)) blockers.push({ code: 'custom_field_key_missing', key: k, remediation: `Create the customer custom field key "${k}" in Metronome first (or pass --external-id-field=<existing key>).` });
      }
      const externalId = rt.readString(ctx.flags, 'external-id');
      if (externalId) {
        const hit = await core.customerResolve.findByExternalId(ctx.client, externalId);
        if (hit?.customer || hit?.candidates) blockers.push({ code: 'external_id_in_use', external_id: externalId, customer: hit.customer ? mx.summarizeCustomer(hit.customer) : null });
      }
    }
    if (blockers.length) throw rt.blocked(blockers);
    if (!body.customer_billing_provider_configurations) {
      warnings.push({ id: 'MTR-BILL-001', message: 'No billing provider configuration: invoices for this customer will not reach Stripe until one is set.' });
    }
    return {
      slug: body.ingest_aliases[0].replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 32),
      summary: { name: body.name, ingest_aliases: body.ingest_aliases, idempotency: 'ingest aliases proven unused; re-checked at apply' },
      diff: [{ field: 'customer', from: null, to: body }],
      warnings,
      steps: [{ id: 'create', method: 'POST', path: '/v1/customers', body }],
      expect: { body },
    };
  },
  async precheck(ctx, plan) {
    return aliasBlockers(ctx.client, plan.expect.body.ingest_aliases);
  },
  async verify(ctx, plan, results) {
    const want = plan.expect.body;
    const id = results.create?.data?.id || results.create?.id;
    const got = id ? await mx.getCustomerById(ctx.client, id) : null;
    const checks = [
      rt.check('customer.id', 'present', id ? 'present' : null),
      rt.check('customer.name', want.name, got?.name),
      rt.check('customer.ingest_aliases', want.ingest_aliases, got?.ingest_aliases, { compare: 'set' }),
    ];
    if (want.custom_fields) checks.push(rt.check('customer.custom_fields', want.custom_fields, got?.custom_fields, { compare: 'subset' }));
    if (want.customer_billing_provider_configurations && id) {
      const cfgs = await mx.getBillingProviderConfigs(ctx.client, id);
      for (const w of want.customer_billing_provider_configurations) {
        const match = cfgs.find((c) => c.billing_provider === w.billing_provider && !c.archived_at);
        checks.push(rt.check(`billing provider ${w.billing_provider}`, w.configuration || {}, match?.configuration, { compare: 'subset' }));
      }
    }
    return checks;
  },
});

module.exports = { customerCreate, buildBody, aliasBlockers };
