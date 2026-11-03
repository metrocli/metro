---
name: metronome-customers-hierarchies
description: >-
  Everything about the Metronome customer object - create/archive/rename,
  ingest aliases, the `updateConfig` knobs (`salesforce_account_id`,
  `leave_stripe_invoices_in_draft`), the signed embeddable dashboard URL,
  custom-field whitelisting per entity type, and parent-child account
  hierarchies with shared commits. Use when the user says "create customer",
  "archive customer", "rename customer", "ingest alias", "setIngestAliases",
  "custom field", "customFields", "addKey", "setValues", "whitelist",
  "parent child", "hierarchy", "shared commit", "child_access",
  "hierarchy_configuration", "embeddable dashboard", "customer dashboard",
  "getEmbeddable", "salesforce_account_id", "leave in draft", or asks about
  `GET /v1/customers/{id}`, `GET /v1/customers?...`, looking up customers by
  ingest alias, why a child customer doesn't show the parent's commit in
  `customerBalances/list`, or the 200-char custom-field value limit. Also
  fires on "balance query parent vs child" and "10-node hierarchy limit".
  Do NOT use for the shape of the commit itself - that's
  `metronome-packages-contracts`. Do NOT use for Stripe billing-config payload
  details - that's `metronome-stripe-delivery`.
---

# Metronome Customers & Hierarchies

> Before calling any Metronome endpoint, verify paths against
> `skills/metronome-danger-zone/references/endpoint-matrix.md` §6
> (Customers) and §8 (Custom Fields). If this skill and the endpoint-matrix
> disagree, the endpoint-matrix wins (it's verified against the live
> `openapi.json`).

## Purpose

Fires whenever we need to create, look up, rename, archive, or reshape a
Metronome customer - including managing its ingest aliases, custom-field
values, and parent/child hierarchy position. Also fires for the custom-field
**whitelist** workflow (you must `addKey` before you can `setValues` for a
new key) and for the signed embeddable dashboard iframe URL.

It does NOT cover the shape of a commit (see `metronome-packages-contracts`) or
the shape of a Stripe/other billing-provider configuration block (see
`metronome-stripe-delivery` - the block is attached to the customer, but its
internals belong there).

## Prerequisites

See `skills/_metronome-shared/conventions.md` for base URL, auth,
credit type IDs, timestamp rules, error-shape quick reference, and - most
importantly for this skill - the **method gotcha**: customer GET/list
endpoints are `GET`, not `POST`.
For **which bearer token** (prod vs sandbox), see the `metro` skill: pass
`--sandbox` or `--prod` explicitly, never infer the tenant from env vars.

## Mental model

```
                   ┌──────────────── Metronome Customer ────────────────┐
                   │  id (UUID)       ← Metronome-owned, stable         │
                   │  name                                              │
                   │  ingest_aliases[]← external IDs (globally unique)  │
                   │  custom_fields{} ← per-entity whitelisted keys     │
                   │  config          ← salesforce_account_id,          │
                   │                    leave_stripe_invoices_in_draft  │
                   │  billing_provider_configurations[]  (→ M7)         │
                   │  hierarchy_position:                                │
                   │    parent_of[]  /  child_of (inferred via          │
                   │      each contract's hierarchy_configuration)      │
                   └────────────────────────────────────────────────────┘
                       ▲                       ▲
                       │ customer_id           │ entity_id (for
                       │                       │  customFields/setValues)
                 /v1/ingest event        contract (child)
                 (customer_id = ingest   hierarchy_configuration.parent
                  alias, not UUID)        = {customer_id, contract_id}
```

Two important non-obvious points:

1. **Hierarchies live on contracts, not on customers.** The parent/child
   link is declared on each child contract via `hierarchy_configuration.parent`.
   The customer object itself has no `parent_customer_id` field.
2. **Shared commits don't auto-surface in child balance queries.** A
   commit added to the parent contract with `child_access: {type: 'all'}`
   is *spendable* by child usage, but `/v1/contracts/customerBalances/list`
   on the child returns `[]` - you must query the parent. Verified with a
   sandbox probe (see `references/hierarchies-cookbook.md`).

## Endpoint inventory

### Customer CRUD

| Method + Path | Purpose | Official docs |
|---|---|---|
| `POST /v1/customers` | Create customer (optionally with `ingest_aliases`, `custom_fields`, `customer_billing_provider_configurations`) | [create-a-customer](https://docs.metronome.com/api-reference/customers/create-a-customer.md) |
| `GET /v1/customers/{customer_id}` | Get one customer (**GET, not POST**) | [get-a-customer](https://docs.metronome.com/api-reference/customers/get-a-customer.md) |
| `GET /v1/customers?customer_ids=...&ingest_alias=...&limit=100&next_page=...&only_archived=false` | Paginated list/search (**GET, not POST**) | [list-customers](https://docs.metronome.com/api-reference/customers/list-customers.md) |
| `POST /v1/customers/archive` | Archive customer (also archives contracts + voids FINALIZED invoices) | [archive-a-customer](https://docs.metronome.com/api-reference/customers/archive-a-customer.md) |
| `POST /v1/customers/{customer_id}/updateConfig` | Update `salesforce_account_id`, `leave_stripe_invoices_in_draft` | [update-a-customer-configuration](https://docs.metronome.com/api-reference/customers/update-a-customer-configuration.md) |
| `POST /v1/customers/{customer_id}/updateName` | Rename customer | [update-a-customer-name](https://docs.metronome.com/api-reference/customers/update-a-customer-name.md) |
| `POST /v1/customers/{customer_id}/setIngestAliases` | Set/replace the customer's ingest aliases (full overwrite, not additive) | [create-or-update-customer-ingest-aliases](https://docs.metronome.com/api-reference/customers/create-or-update-customer-ingest-aliases.md) |
| `POST /v1/customers/dashboards/getEmbeddable` | Generate a signed iframe URL for the customer dashboard | [get-an-embeddable-customer-dashboard](https://docs.metronome.com/api-reference/customers/get-an-embeddable-customer-dashboard.md) |

### Custom fields

| Method + Path | Purpose | Official docs |
|---|---|---|
| `POST /v1/customFields/addKey` | Whitelist a key for one `entity` type (customer, contract, commit, credit, invoice) | [create-a-custom-field-key](https://docs.metronome.com/api-reference/custom-fields/create-a-custom-field-key.md) |
| `POST /v1/customFields/removeKey` | Un-whitelist a key (cannot be used by new writes after) | [delete-a-custom-field-key](https://docs.metronome.com/api-reference/custom-fields/delete-a-custom-field-key.md) |
| `POST /v1/customFields/listKeys` | List allowlisted keys, filterable by `entity` | [list-custom-field-keys](https://docs.metronome.com/api-reference/custom-fields/list-custom-field-keys.md) |
| `POST /v1/customFields/setValues` | Write values on a specific `entity` instance (`entity_id`) | [set-custom-field-values](https://docs.metronome.com/api-reference/custom-fields/set-custom-field-values.md) |
| `POST /v1/customFields/deleteValues` | Delete specific keys from an entity (preserves others) | [delete-custom-fields](https://docs.metronome.com/api-reference/custom-fields/delete-custom-fields.md) |

> **Method gotcha recap.** `GET /v1/customers/{id}` and `GET /v1/customers?...`
> are **GET** (everything else customer-ish is POST). `POST /v1/customers/list`
> with `{customer_ids: [...]}` is **not documented** and returns 404. Some
> older scripts use `POST /v1/customers/list` with `{ingest_alias: ...}` -
> avoid for new code; use the GET form.

## Working payloads

### Create a standalone customer with Stripe + custom fields

Direct (no hierarchy) customer, with a Stripe billing config and a few
whitelisted custom fields (`customer_type`, `external_id`, `crm_id`).

```js
const result = await metronome.post('/v1/customers', {
  name: 'Acme Corp',
  ingest_aliases: ['acme_corp'],           // globally unique; 409 on collision
  custom_fields: {                          // ALL keys must already be whitelisted
    customer_type: 'standalone',
    external_id: 'acme_corp',
    crm_id: '<CRM_ID>',
    billing_email: 'ap@acme.example',
  },
  customer_billing_provider_configurations: [{
    billing_provider: 'stripe',
    configuration: {
      stripe_customer_id: 'cus_XXXXXXXXXXXX',
      stripe_collection_method: 'send_invoice',  // or 'charge_automatically'
    },
    delivery_method_id: '<DELIVERY_METHOD_ID>',  // multi-entity; see metronome-stripe-delivery
  }],
});
const customerId = result.data.id;
```

**Notes:**
- `ingest_aliases` is globally unique per tenant. Collision returns `409`
  with `conflicting_id`. Either reuse the existing customer or pick a new
  alias.
- `custom_fields` on create will `400 Invalid custom field keys: <key>` if
  any key isn't whitelisted for the `customer` entity first. See
  `references/custom-fields-workflow.md`.
- Billing-config internals (`billing_provider`, `delivery_method` vs
  `delivery_method_id`, `stripe_collection_method`) belong to
  `metronome-stripe-delivery` - we just show where the block lives on the
  customer payload.

### Get a single customer (GET, not POST)

```js
const res = await metronome.get(`/v1/customers/${customerId}`);
// res.data.data = { id, name, ingest_aliases, custom_fields, ... }
```

Returns archived customers if they exist - inspect `archived_at` on the
response.

### List / search customers (GET, not POST)

```js
// Paginate all customers
let next = null;
const all = [];
do {
  const url = next
    ? `/v1/customers?limit=100&next_page=${encodeURIComponent(next)}`
    : '/v1/customers?limit=100';
  const { data } = await metronome.get(url);
  all.push(...(data.data || []));
  next = data.next_page || null;
} while (next);

// Search by ingest alias
const { data } = await metronome.get(
  `/v1/customers?ingest_alias=${encodeURIComponent('acme_corp')}`
);

// Multi-fetch by UUID
const qs = ids.map(id => `customer_ids=${id}`).join('&');
const { data } = await metronome.get(`/v1/customers?${qs}&limit=100`);
```

Filters accepted: `customer_ids` (repeat for multi), `ingest_alias`,
`only_archived=false|true`, `limit`, `next_page`.

### Archive

```js
await metronome.post('/v1/customers/archive', { id: customerId });
```

**Side effects (loud):** archives every contract on the customer and voids
associated invoices. If you just want to stop billing a customer, this is
usually not what you want - see `metronome-danger-zone §1.1`. Non-idempotent
on Stripe: the Stripe invoice is never refunded. `metronome-stripe-delivery`
covers the reconciliation hole.

**Per-contract archive order - transition chains.** If a customer has a
transition chain (`POST /v1/contracts/archive` per contract instead of
the one-shot customer archive), Metronome enforces archival in the
**reverse direction of the transition chain**: descendants first, then
their ancestors. Trying to archive an ancestor while a descendant is
still alive returns:

```
400 BadRequest: Transition contract <descendant_id> must be archived
before contract <ancestor_id> may be archived
```

Two ways to handle this:

1. **Easiest (recommended for full-customer cleanup):** skip per-contract
   archive entirely. `POST /v1/customers/archive` cascades and voids
   invoices in dependency order. Observed in sandbox: 11 contracts across 5
   test customers fully archived via customer archive even though the
   per-contract calls had returned 400.
2. **Per-contract control needed:** archive in REVERSE chronological order
   of `starting_at` so each call's target has no live transition
   descendant. For a common pattern (initial package contract that gets
   transitioned into a long-lived direct contract), that means archive
   the open-ended successor first, then the zero-length predecessors.

**Ingest aliases stay pinned across archive - but are recoverable via API.**
Archiving does NOT free up the ingest aliases; they remain pinned to the
archived customer and a fresh `POST /v1/customers` with the same
`ingest_aliases` will 409 with `One or more ingest aliases conflict with
existing customers`. The conflicting customer can be the archived one.

**Recovery (verified empirically in sandbox):**
`POST /v1/customers/{id}/setIngestAliases` **works on archived
customers** - returns `200 OK` and the new value sticks. Earlier versions
of this skill claimed the alias was "effectively burned until Metronome
support manually releases it." That was wrong; no support ticket needed.

```js
// Find the squatter (alias filter returns archived rows too)
const { data } = await m.raw.get(
  `/v1/customers?ingest_alias=${encodeURIComponent(alias)}`
);
const archivedSquatters = (data.data ?? []).filter((c) => c.archived_at);

// Release the alias
for (const c of archivedSquatters) {
  await m.post(`/v1/customers/${c.id}/setIngestAliases`, {
    ingest_aliases: [],
  });
}
```

Best practice is still to call `setIngestAliases([])` BEFORE archiving so
this recovery isn't needed - but if you (or someone clicking around in
the dashboard) skipped that, the recovery path is API-clean.

Verified on two archived sandbox customers: the aliases were released and
immediately reassignable to fresh customers.

### Rename

```js
await metronome.post(`/v1/customers/${customerId}/updateName`, {
  name: 'Acme Corp (DBA Widget Co)',
});
```

### updateConfig - Salesforce ID & Stripe draft behavior

```js
await metronome.post(`/v1/customers/${customerId}/updateConfig`, {
  salesforce_account_id: '001xx0000000001',
  leave_stripe_invoices_in_draft: true,
});
```

**Notes:**
- `leave_stripe_invoices_in_draft: true` keeps Stripe invoices in DRAFT on
  the Stripe side (lets you review before finalization). Does **not** apply
  to past-dated SCHEDULED invoices - they bypass this setting (danger-zone
  §1.5).
- `salesforce_account_id` is a first-class field, not a custom field.

### setIngestAliases (REPLACES, not adds)

```js
await metronome.post(`/v1/customers/${customerId}/setIngestAliases`, {
  ingest_aliases: ['acme_corp', 'acme_corp_eu', 'acme_corp_apac'],
});
```

**Notes:**
- This is a full **replace** - omitting an existing alias removes it.
- 409 with `conflicting_id` on alias collision with another customer. If
  you're migrating, first query the conflicting customer
  (`GET /v1/customers?ingest_alias=<alias>`) and decide whether to archive
  or remap.

### Embeddable customer dashboard (signed iframe URL)

```js
const { data } = await metronome.post('/v1/customers/dashboards/getEmbeddable', {
  customer_id: customerId,
  dashboard: 'invoices',       // or 'usage', 'credits', 'commits_and_credits'
  color_overrides: [            // optional
    { name: 'Primary', value: '#6366F1' },
  ],
});
// data.data.url → signed URL, short-lived; embed in a sandboxed iframe
```

**Notes:**
- URLs are signed and time-limited - generate per page-load, don't cache.
- Sign this server-side only; leaking an API key to the browser so the
  browser can call this endpoint is the usual foot-gun.

### Custom fields - the full lifecycle

See `references/custom-fields-workflow.md` for the step-by-step whitelist
flow. Quick reference:

```js
// 1. Whitelist the key for an entity type (one-time, idempotent)
await metronome.post('/v1/customFields/addKey', {
  entity: 'commit',                // 'customer'|'contract'|'commit'|'credit'|'invoice'
  key: 'grant_reason',
  enforce_uniqueness: false,
});

// 2. Write a value onto one entity instance
await metronome.post('/v1/customFields/setValues', {
  entity: 'customer',
  entity_id: customerId,
  custom_fields: {
    customer_type: 'standalone',
    external_id: 'acme_corp',
  },
});

// 3. Remove a subset of keys (preserves the rest)
await metronome.post('/v1/customFields/deleteValues', {
  entity: 'customer',
  entity_id: customerId,
  keys: ['legacy_source'],
});

// 4. Inspect the allowlist
await metronome.post('/v1/customFields/listKeys', { entity: 'commit' });
```

**Notes:**
- **200-char limit** per value. Anything longer → `400`.
- **Whitelist is per entity type.** A key on `customer` is *not* auto-valid
  on `contract` or `commit`. Add it separately for each entity you need.
- Recommended practice: keep a small, documented set of commit keys (for
  example `grant_reason`, `granted_by`, `granted_by_email`, `granted_at`)
  and check `listKeys` before writing. Don't invent new ones mid-write -
  add first, then write.
- Unknown keys fail the **whole** write, not just the offending key.

## Hierarchies - top-level guidance

For the full cookbook (parent shell creation, shared-commit shape, child
contract creation, balance-query matrix, 10-node limit, ingest-alias
fallback), see `references/hierarchies-cookbook.md`. The critical facts
every caller needs:

1. Hierarchy is declared on the **child contract**, not on the customer:

   ```js
   await metronome.post('/v1/contracts/create', {
     customer_id: childCustomerId,
     rate_card_id: '<RC_ID>',
     starting_at: CUTOVER_DATE,
     hierarchy_configuration: {
       parent: {
         customer_id: parentCustomerId,   // BOTH fields required
         contract_id: parentContractId,
       },
       payer: 'PARENT',                    // or 'SELF'
       usage_statement_behavior: 'SEPARATE', // or 'CONSOLIDATE'
       child_access: 'INDEPENDENT',
     },
     uniqueness_key: `child-${orgId}-${accountId}-v1`,
   });
   ```

2. **Package contracts reject `hierarchy_configuration`.** Children that
   need to link to a parent must be direct contracts (`rate_card_id` +
   fields). Package + hierarchy → 400.

3. **Shared commits go on the parent contract** via
   `/v2/contracts/edit` with `add_commits[].hierarchy_configuration =
   { child_access: { type: 'all' } }`. See
   `metronome-packages-contracts` for the commit shape.

4. **`include_contract_balances` does NOT traverse hierarchy.** Passing it
   on `/v1/contracts/customerBalances/list` for a **child** still returns
   `[]` - the shared commit only appears when you query the **parent**.
   In a sandbox probe the parent returned the shared commit while every
   flag combination on the child returned 0 rows.

5. **10-node limit** per hierarchy tree (1 parent + 9 children). Orgs
   bigger than that either need multiple hierarchies or the
   ingest-alias-on-parent fallback (all children's external IDs attached as
   aliases to the parent via `setIngestAliases`).

## Decision trees

### Where should I put this metadata on a customer?

| Data | Put it in | Why |
|---|---|---|
| External CRM ID | `custom_fields.crm_id` (whitelisted) | Queryable via `listKeys`/`setValues`; explicit schema |
| Salesforce account id | `config.salesforce_account_id` via `updateConfig` | First-class field; appears in reports |
| External event customer ref | `ingest_aliases[]` | Drives `/v1/ingest` routing |
| Billing email | `custom_fields.billing_email` | Whitelisted; surfaces to ops via custom-field listing |
| Long-form note (>200 chars) | - | Custom field **200-char limit** - store externally and reference an ID |

### Customer lookup - which endpoint?

| Question | Endpoint |
|---|---|
| "I have the UUID, give me the record" | `GET /v1/customers/{id}` |
| "I have the UUID and want to know `archived_at`" | `GET /v1/customers/{id}` (same - inspect the field) |
| "I have an external ID / ingest alias" | `GET /v1/customers?ingest_alias=<id>` |
| "I have a list of UUIDs" | `GET /v1/customers?customer_ids=A&customer_ids=B&limit=100` |
| "Give me everything" | `GET /v1/customers?limit=100` + loop `next_page` |
| **NEVER** | `POST /v1/customers/list` - returns 404 for `customer_ids` lookups |

### Hierarchy vs ingest-alias fallback - which?

| Situation | Choice |
|---|---|
| ≤9 children; want per-child usage + shared credits | Hierarchy (`hierarchy_configuration`) |
| >9 children OR all usage simply bills to parent | Ingest aliases on the parent (`setIngestAliases`) |
| Child needs own Stripe invoice | Hierarchy with `payer: 'SELF'` + `usage_statement_behavior: 'SEPARATE'` |
| All invoices consolidate on parent | Hierarchy with `payer: 'PARENT'` + `usage_statement_behavior: 'CONSOLIDATE'` (or ingest aliases) |

## Edge cases & gotchas

- **GET vs POST, again.** Intuition says "Metronome list endpoints are POST
  with a JSON body." For customers, they're GET with query strings. A 404
  on a customer endpoint is almost always a method/path mistake - reach
  for danger-zone §2 before assuming the endpoint doesn't exist.
- **Archiving a customer voids invoices.** Archive fans out to every
  contract (archives them) and every FINALIZED invoice (voids them). It
  does not refund Stripe - see `metronome-stripe-delivery`
  reconciliation-snippet for the cleanup flow.
- **`setIngestAliases` is a replace.** Callers commonly break this
  assuming it's additive. Fetch the current list first, compute the union,
  then POST.
- **Custom-field whitelist is strict and silent.** Writing an unknown key
  fails the **whole batch** with `400 Invalid custom field keys: <key>` -
  split the write if you need partial success. Whitelist first via
  `addKey` (see `references/custom-fields-workflow.md`).
- **200-char custom-field value limit.** Truncation is on you; Metronome
  rejects rather than silently truncating.
- **Child balance query returns empty even with `include_contract_balances`.**
  Hierarchies don't cascade balance visibility. Query the parent for the
  shared commit; the child's own contract-scoped balances show up on the
  child query. See `references/hierarchies-cookbook.md`.
- **Package contracts reject `hierarchy_configuration`.** Only
  `customer_id`, `starting_at`, `package_alias`/`package_id`,
  `uniqueness_key`, and `transition` are accepted on a package-based
  create. Use direct contracts for child-of relationships.
- **`hierarchy_configuration.parent` needs both IDs.** Passing only
  `customer_id` → 400 schema. You must pass `customer_id` AND
  `contract_id`.
- **`update_recurring_commits` with `hierarchy_configuration` silently
  fails.** Edits to existing recurring commits that add/change
  `child_access` return 200 but the field isn't persisted. Workaround: add
  a fresh prepaid commit with `child_access` via `add_commits`, or
  recreate the contract with hierarchy included.

## Cross-references

- `metronome-danger-zone` - source of truth for paths; §1.6 for custom-field
  whitelist rule, §8 for endpoint matrix, §2 for GET-vs-POST method mistakes.
- `metronome-packages-contracts` - the *shape* of a commit (access_schedule,
  invoice_schedule, rollover, priority, `child_access` on the commit block).
  This skill just says "where the commit sits in the hierarchy".
- `metronome-stripe-delivery` - internals of
  `customer_billing_provider_configurations`, `delivery_method` vs
  `delivery_method_id`, and the Stripe reconciliation hole on archive.
- `metronome-ingestion-events` - `customer_id` on an event is the ingest
  alias managed here, not the Metronome UUID.
- `metronome-invoicing` - `GET /v1/customers/{id}/invoices` lives in the
  invoicing skill; customer LOOKUP lives here.

## When NOT to use this skill

- "What does a commit with `child_access: all` look like?" → use
  `metronome-packages-contracts`.
- "Fix a Stripe invoice missing on a customer" → use
  `metronome-stripe-delivery`.
- "How do I send events for a child account?" → use
  `metronome-ingestion-events` (just use the child's ingest alias as the
  event `customer_id`).
- "List this customer's invoices" → use `metronome-invoicing`
  (`GET /v1/customers/{id}/invoices`).
- "Contract-level edits on a customer's hierarchy" → use
  `metronome-packages-contracts` (editContract ops); this skill just
  covers the *position* of the customer in the hierarchy graph.
