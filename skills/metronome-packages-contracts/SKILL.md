---
name: metronome-packages-contracts
description: >-
  Create and manage Metronome packages (reusable contract templates) and
  contracts (customer instances), plus every contract-lifecycle operation -
  editContract, updateEndDate, updateInvoiceIssueDate, archive, transitions,
  bridge contracts, commits and credits, and historical invoices. Use when the
  user says "create a contract", "new contract", "package", "package_alias",
  "recurring_commits", "editContract", "edit a contract", "end the contract",
  "updateEndDate", "updateInvoiceIssueDate", "archive contract",
  "listContractsOnPackage", "transition", "RENEWAL", "SUPERSEDE", "plan
  change", "tier change", "downgrade", "upgrade", "switch package", "bridge
  contract", "add credits", "add a commit", "complimentary credits",
  "historical invoices", "createHistoricalInvoices", "setUsageFilter",
  "getRateSchedule", "editHistory", or asks how to shorten/renew/supersede a
  contract, add commits mid-term, apply overrides, swap plans, move a
  customer between packages, or stitch overlapping contracts together. Do
  NOT use for invoice state transitions (DRAFT/FINALIZED/VOID, void,
  regenerate) - that is metronome-invoicing. Do NOT use for
  rate-card/product/override schemas - that is metronome-pricing-catalog. Do
  NOT use for Stripe delivery config - that is metronome-stripe-delivery.
---

# Metronome Packages & Contracts

> Before calling any Metronome endpoint, verify paths against
> `metronome-danger-zone/references/endpoint-matrix.md` §5 (Packages) and §9
> (Contracts). If this skill and the endpoint-matrix disagree, the
> endpoint-matrix wins.

## Purpose

Every customer-specific billing configuration in Metronome is a **contract**,
either instantiated from a reusable **package** (template) or built directly
with an explicit `rate_card_id`. This skill fires whenever you are creating,
editing, renewing, shortening, archiving, or bridging contracts, granting
commits or credits on them, or building / maintaining the packages that stamp
them out.

## Prerequisites

See `skills/_metronome-shared/conventions.md` for base URL, auth, credit type
IDs, timestamp rules (hour-boundary snap, far-future "no expiry" convention),
and error-shape quick reference. For **which key** (sandbox vs production) and
the CLI safety model (read-only default, sandbox first, typed confirm tokens,
preview, apply, GET readback), see the `metro` skill.

## Mental model

```
  Rate Card --+
              +-->  Package  --(template)-->  Contract  -->  Invoice(s)
  Products ---+                     |
                                    +--> (direct)  Contract  -->  Invoice(s)
                                                     |
                                            transitions[]
                                                     |
                                                     v
                                          Contract' (RENEWAL / SUPERSEDE)
```

A **package** is a reusable bundle of `rate_card_id` + `recurring_commits` +
optional subscription/seat config + optional `billing_provider`. A **contract**
is the customer-attached instance. You can make a contract two ways:

1. **Package-based** - pass `package_alias` or `package_id` to
   `/v1/contracts/create`. Payload is heavily restricted (see "Restricted
   package payload" below).
2. **Direct** - omit the package and pass a full `rate_card_id` + `commits` +
   `billing_provider_configuration` body. Used for bespoke deals, bridge
   contracts, and hierarchy children (packages reject
   `hierarchy_configuration`).

Every lifecycle operation after creation goes through one of four paths:

- **`/v2/contracts/edit`** - the mid-term Swiss-army knife (commits,
  credits, overrides, scheduled charges, seats, name, spend threshold, usage
  filter).
- **Dedicated endpoints** - `updateEndDate`, `updateInvoiceIssueDate`,
  `archive`, `setUsageFilter`, `createHistoricalInvoices`. Each exists because
  editContract either can't do that operation or has a worse schema for it.
- **Transitions** - a successor contract that inherits context from a
  predecessor. Set via the `transition` field on `/v1/contracts/create`.
- **Package version bump** - create a new package with the same alias; active
  contracts keep old pricing, new contracts pick up the new version.

## Endpoint inventory

Only the capabilities owned by this skill. Everything here is verified against
`metronome-danger-zone/references/endpoint-matrix.md` §5 and §9. The `metro`
column names the reviewed endpoint id in the CLI catalog where one exists
(`metro api explain <id>`).

### Packages

| Method + Path | Purpose | Official docs | metro |
|---|---|---|---|
| `POST /v1/packages/create` | Create package (reusable contract template) | [create-a-package](https://docs.metronome.com/api-reference/contracts/create-a-package.md) | `packages.create` (sandbox apply) |
| `POST /v1/packages/get` | Get one package (needs `{ package_id }`) | [get-a-package](https://docs.metronome.com/api-reference/packages/get-a-package.md) | `packages.get` |
| `POST /v1/packages/list` | List all packages | [list-all-packages](https://docs.metronome.com/api-reference/list-all-packages.md) | `packages.list` |
| `POST /v1/packages/archive` | Archive package (existing contracts unaffected) - `{ package_id }`, NOT `{ id }` | [archive-a-package](https://docs.metronome.com/api-reference/packages/archive-a-package.md) | `metro package archive preview` |
| `POST /v1/packages/listContractsOnPackage` | List contracts associated with a package. (Older notes say `/v1/contracts/listContractsOnPackage`; current docs use the `/v1/packages/...` path.) | [list-contracts-associated-with-a-package](https://docs.metronome.com/api-reference/contracts/list-contracts-associated-with-a-package.md) | `packages.listContractsOnPackage` |

### Contracts - create / list / get

| Method + Path | Purpose | Official docs | metro |
|---|---|---|---|
| `POST /v1/contracts/create` | Create contract (package or direct). Accepts `uniqueness_key` for idempotent retries | [create-a-contract](https://docs.metronome.com/api-reference/contracts/create-a-contract.md) | `contracts.create` (sandbox apply) |
| `POST /v2/contracts/list` | List contracts for a customer (v2 is current; supports `include_archived`, chronological ordering, embedded customer metadata) | [list-customer-contracts-v2](https://docs.metronome.com/api-reference/contracts/list-customer-contracts-v2.md) | `contracts.list.v2` |
| `POST /v1/contracts/list` | **DEPRECATED / disabled.** Returns a message directing you to v2. Do not call. | [list-customer-contracts-v1](https://docs.metronome.com/api-reference/contracts/list-customer-contracts-v1.md) | - |
| `POST /v2/contracts/get` | Get one contract (current, v2). `data.subscriptions[0].id` is where the seat subscription id lives. | [get-a-contract-v2](https://docs.metronome.com/api-reference/contracts/get-a-contract-v2.md) | `contracts.get.v2` |
| `POST /v1/contracts/get` | **DISABLED.** Returns 403 `"This endpoint has been disabled. Please use the v2 endpoint"`. Use v2. | [get-a-contract-v1](https://docs.metronome.com/api-reference/contracts/get-a-contract-v1.md) | - |

### Contract lifecycle ops

| Method + Path | Purpose | Official docs | metro |
|---|---|---|---|
| `POST /v2/contracts/edit` | Mid-term editor - full op catalog lives in `references/editcontract-ops.md` | [edit-a-contract](https://docs.metronome.com/api-reference/contracts/edit-a-contract.md) | `contracts.edit.v2` (sandbox apply) |
| `POST /v2/contracts/getEditHistory` | Full history of edits applied to a contract. (Older notes say `/v2/contracts/editHistory`; current docs use `getEditHistory`.) | [get-contract-edit-history](https://docs.metronome.com/api-reference/contracts/get-contract-edit-history.md) | `contracts.getEditHistory` |
| `POST /v1/contracts/updateEndDate` | Dedicated end-date change with `allow_ending_before_finalized_invoice` flag (cleaner than editContract for this case) | [update-the-contract-end-date](https://docs.metronome.com/api-reference/contracts/update-the-contract-end-date.md) | `metro contract move-plan preview` |
| `POST /v1/contracts/updateInvoiceIssueDate` | Push a DRAFT invoice's issue date forward (only DRAFT; new date must be before contract end) | [update-invoice-issue-date](https://docs.metronome.com/api-reference/contracts/update-invoice-issue-date.md) | `metro invoice issue-date preview` |
| `POST /v1/contracts/archive` | Archive contract. `void_invoices` is **required** and has a Stripe-reconciliation side effect (see `metronome-danger-zone` §1.1) | [archive-a-contract](https://docs.metronome.com/api-reference/contracts/archive-a-contract.md) | - |
| `POST /v1/contracts/getContractRateSchedule` | Effective rates (incl. contract-level overrides) for a contract at a timestamp | [get-the-rate-schedule-for-a-contract](https://docs.metronome.com/api-reference/contracts/get-the-rate-schedule-for-a-contract.md) | `contracts.getRateSchedule` |
| `POST /v1/contracts/setUsageFilter` | Route usage between multiple overlapping contracts (a property-level filter on events) | [set-a-contract-usage-filter](https://docs.metronome.com/api-reference/contracts/set-a-contract-usage-filter.md) | - |
| `POST /v1/contracts/createHistoricalInvoices` | Generate retroactive USAGE invoices for past periods (preferred alternative to past-dated ingest) | [create-historical-invoices](https://docs.metronome.com/api-reference/contracts/create-historical-invoices.md) | - |
| `POST /v1/contracts/amend` | **Deprecated.** Use `/v2/contracts/edit`. | [amend-a-contract](https://docs.metronome.com/api-reference/contracts/amend-a-contract.md) | - |

## Working payloads

### Create a package (with `recurring_commits` + monthly fee)

The non-obvious part: package `recurring_commits` require **two extra fields
that direct contract creation does not**: `starting_at_offset` and
`proration`. Omit either and you get a useless error:
`400 instance failed to match all required schemas (matched only 1 out of 2)`.

```js
await m.post('/v1/packages/create', {
  name: '<TIER_NAME>',                          // human label, e.g. "Pro Monthly"
  rate_card_id: '<RATE_CARD_ID>',
  uniqueness_key: '<STABLE_KEY>',               // for idempotent retries, max 128 chars
  aliases: [{ name: '<PACKAGE_ALIAS>' }],       // NB: objects, not strings
  usage_statement_schedule: { frequency: 'MONTHLY' },
  scheduled_charges_on_usage_invoices: 'ALL',   // collapse plan fees into usage invoices
  billing_provider: 'stripe',                   // paid tiers only
  delivery_method: 'direct_to_billing_provider',
  recurring_commits: [{
    product_id: '<FIXED_PRODUCT_ID>',
    name: '<SHORT_COMMIT_NAME>',                // shows on the Stripe invoice - keep it short
    access_amount: {
      unit_price: 2500,                         // TOTAL credits, quantity 1
      quantity: 1,
      credit_type_id: '<CUSTOM_CREDIT_TYPE_ID>',
    },
    invoice_amount: {
      unit_price: 10000,                        // plan fee in cents
      quantity: 1,
      credit_type_id: '<USD_CENTS_ID>',
    },
    commit_duration: { value: 12, unit: 'PERIODS' },
    rollover_fraction: 1.0,
    recurrence_frequency: 'MONTHLY',
    applicable_product_tags: ['<PRODUCT_TAG>'],
    priority: 1,
    starting_at_offset: { value: 0, unit: 'DAYS' },   // REQUIRED for packages
    proration: 'NONE',                                 // REQUIRED for packages
  }],
});
```

**Notes:**
- **Annual packages should set `usage_statement_schedule.day: CONTRACT_START`.**
  `day` is an enum (`FIRST_OF_MONTH` | `CONTRACT_START` | `CUSTOM_DATE`) and,
  per the create-a-contract schema, defaults to `FIRST_OF_MONTH` when omitted.
  On an annual package that stubs the first statement to the next 1st of the
  month instead of the contract anniversary. Recommended practice: set
  `day: CONTRACT_START` on every annual package and omit `day` on monthly
  packages that are meant to bill on the 1st. When cloning annual packages,
  copy `day` explicitly.
- **Packages are immutable.** To change pricing, create a NEW package with
  the same alias and a future `starting_at` on the alias. Active contracts
  keep old pricing; new contracts pick up the new version. Creating a new
  package with an existing alias silently orphans the old one.
- `aliases: [{ name: '...' }]` - array of objects. Stringly-typed
  `alias: '...'` is silently ignored. Alias objects also support an
  optional `starting_at` for **scheduled alias hand-off** - see below.
- For free tiers: omit `billing_provider` and `delivery_method`, set
  `invoice_amount.unit_price: 0`, `commit_duration.value: 1`,
  `rollover_fraction: 0`.

### `package_alias` resolution - what timestamp controls which version resolves

Per [create-a-contract docs](https://docs.metronome.com/api-reference/contracts/create-a-contract.md),
when a contract is created with `package_alias`, Metronome resolves the
alias **as of the contract's `starting_at`** - NOT at the moment you make
the create API call. This is the clean pattern for rolling out a new
package version without downtime:

1. Create new package version `vN+1`.
2. Give it an alias entry with `starting_at: T` - this schedules the alias
   hand-off (the old `vN` alias entry auto-closes at T).
3. Between now and T, every new `package_alias: '<PACKAGE_ALIAS>'` contract
   resolves to `vN`. From T onwards, every new contract resolves to `vN+1`.
   Existing contracts on `vN` keep their pricing (packages are templates;
   contracts snapshot their template at create time).

**Recommended practice: application code that creates contracts should use
`package_alias`, not a hardcoded `package_id`.** If the backend sends
`package_id` and you bump versions, it keeps pinning new contracts to the OLD
version until someone updates the hardcoded UUID. `package_alias` resolution
gives you zero-coordination package version bumps.

**Exception for one-off sandbox moves:** if you need to move a sandbox
customer onto a package "now" and the v-next alias hand-off is still in the
future, `package_alias` will resolve to the old package at the requested
`starting_at`. In that case target the sandbox `package_id` directly, after
fetching it with `/v1/packages/get` and confirming the package name, aliases,
recurring commits, billing provider, and invoice amount. Keep production and
backend flows on aliases unless the owner explicitly approves pinning.

### Package `uniqueness_key` returned with a `package:` prefix

On `POST /v1/packages/list`, the returned `uniqueness_key` has been observed
to come back as `"package:<your_key>"` - Metronome prefixes it on read. On
`POST /v1/packages/create`, you submit the bare key (e.g.
`"pkg-v4-free-2000"`). Any idempotency comparison has to normalize:

```js
const normalizeUniq = (k) => (k || '').replace(/^package:/, '');
const isMatch = normalizeUniq(pkg.uniqueness_key) === myKey;
```

Without the normalizer, a "does this package already exist?" check fails
silently and you create duplicates. No docs page mentions this prefix; the
only way to know is to inspect a `packages/list` response.

### `uniqueness_key` max length is 128 chars

The `UniquenessKey` schema (contracts, packages, commits and credits) is
`minLength: 1`, `maxLength: 128`. Reusing a key returns **409** and creates
nothing. Over-long keys are rejected:

```text
400 [string "<key>" is too long (length: 143, maximum allowed: 128)]
```

A common way to hit this: embedding a full ISO timestamp
(`2026-05-06T15:00:00.000Z`) plus two UUIDs and an alias in the key. It hurts
most in a two-step plan move, where `updateEndDate` has already ended the
predecessor and only the successor create fails.

`metro contract move-plan` builds keys as
`plan-change:${customerId}:${contractId}:${targetAlias}:${cutoverAt.slice(0, 10)}`
(date-only `YYYY-MM-DD`, not the hour-boundary ISO used as `starting_at`).
Build the key, assert `length <= 128`, and only then run `updateEndDate`.

### `/v1/packages/list` pagination uses URL QUERY PARAMS, not body

The Metronome SDKs define `limit` and `next_page` as **query-only** on
this endpoint. Sending them in the POST body is silently ignored or returns
a schema error. Always pass them as query params:

```js
// right
await m.raw.post(`/v1/packages/list?limit=100&next_page=${encodeURIComponent(token)}`, {});

// wrong - token is ignored, you'll see page 1 every time
await m.post('/v1/packages/list', { limit: 100, next_page: token });
```

Reference: [Metronome pagination docs](https://docs.metronome.com/api-reference/pagination).
Typical symptom: "where did my package go?" - the newer versions exist but
live on page 2 or 3, and a script loops on page 1 forever.

### Archiving old package versions - wait until the new alias is live

When bumping package versions (`vN` to `vN+1`), a common mistake is
archiving `vN` before its alias hand-off has taken effect. If the hand-off
is scheduled for T+1h and you archive `vN` at T-5min, any contract-create
request between T-5min and T+1h fails: Metronome still resolves
`package_alias` to `vN` during that window, but `vN` is archived, so
contract-create returns 400.

Safe archival pattern (what `metro package archive preview` enforces):

1. **Pre-flight check:** fetch the v-next package by its `uniqueness_key`;
   read its `aliases[]`; confirm the alias pointing at v-next has a
   `starting_at` in the past (i.e. currently live).
2. If the v-next alias `starting_at` is still in the future, **abort** with a
   clear message like "v-next alias not live yet; scheduled for T+1h - re-run
   after cutover".
3. Only after the alias is confirmed live, call `/v1/packages/archive` on the
   old versions.

### Package cap + partial package generation recovery

Metronome can enforce a per-tenant package cap across **active packages plus
archived packages that have associated contracts**. It shows up as:

```text
Cannot create more than 75 active packages or archived packages with associated contracts for a client
```

What to know:

- Creating many packages in a script is not an all-or-nothing batch. A script
  that creates 20 packages can create the first 10, then fail on package 11
  with the cap. Always inspect by `uniqueness_key` after a failure before
  retrying.
- If the partially-created generation uses the same aliases at a future
  `starting_at`, Metronome may already have auto-closed the previous
  generation's alias entries at that future boundary.
- To recover in sandbox, archive the superseded generation that is no longer
  needed, then rerun the idempotent package builder. Normalize returned
  `uniqueness_key` values by stripping the `package:` prefix.
- Do **not** blindly archive production package generations to make room. In
  production, first run `listContractsOnPackage` for every candidate package,
  confirm no active or new-customer flow depends on it, and get explicit owner
  approval.

```js
const targets = packages.filter((p) =>
  !p.archived_at &&
  normalizeUniq(p.uniqueness_key).startsWith('<OLD_GENERATION_PREFIX>')
);
for (const pkg of targets) {
  await m.post('/v1/packages/archive', { package_id: pkg.id });
}
// rerun package create; existing partial v-next packages are reused by uniqueness_key
```

### Restricted package contract-create payload (common footgun)

When `package_alias` or `package_id` is present, the create-a-contract docs
allow only `customer_id`, `starting_at`, `package_id`/`package_alias`,
`uniqueness_key`, `transition`, and `custom_fields`. **Everything else
returns 400.** No `rate_card_id`, no `recurring_commits`, no `commits`, no
`billing_provider_configuration`, no `hierarchy_configuration`.

```js
await m.post('/v1/contracts/create', {
  customer_id: '<METRONOME_CUSTOMER_ID>',
  starting_at: '<ISO_HOUR_BOUNDARY_Z>',
  package_alias: '<PACKAGE_ALIAS>',             // e.g. 'pro_monthly'
  uniqueness_key: '<CUSTOMER_REF>-pro-<START_DATE>',  // idempotent retries
  // transition: { from_contract_id: '<PREV>', type: 'RENEWAL' },  // optional
});
```

To customize a package-based contract (commits, overrides, seats), create
first and then immediately `POST /v2/contracts/edit`.

### Create a direct contract (bespoke / bridge / hierarchy child)

Use direct contracts when you need `commits`, `hierarchy_configuration`,
a custom `rate_card_id`, or contract-level settings that packages can't
template. Example: a 1-hour bridge contract covering a gap between two
contracts.

```js
await m.post('/v1/contracts/create', {
  customer_id: '<CUSTOMER_ID>',
  name: 'Bridge contract (20:00Z to 21:00Z)',
  rate_card_id: '<RATE_CARD_ID>',
  starting_at: '2026-04-22T20:00:00.000Z',    // MUST be hour-boundary
  ending_before: '2026-04-22T21:00:00.000Z',  // minimum useful duration: 1 hour
  uniqueness_key: 'bridge-<CUSTOMER_REF>-2026-04-22-v1',
  usage_statement_schedule: { frequency: 'MONTHLY' },
  scheduled_charges_on_usage_invoices: 'ALL',
  commits: [{
    type: 'PREPAID',
    product_id: '<PLAN_PRODUCT_ID>',
    name: 'Bridge Credits',
    priority: 1,
    applicable_product_tags: ['<PRODUCT_TAG>'],
    access_schedule: {
      credit_type_id: '<CUSTOM_CREDIT_TYPE_ID>',
      schedule_items: [{ amount: 500, starting_at: '...20:00Z', ending_before: '...21:00Z' }],
    },
    invoice_schedule: {
      credit_type_id: '<USD_CENTS_ID>',
      schedule_items: [{ timestamp: '...20:00Z', unit_price: 0, quantity: 1 }],
    },
  }],
});
```

**Notes:**
- **No-expiry convention:** Metronome has no "never expires" flag. A common
  convention is `ending_before` about 100 years out (e.g.
  `'2126-04-22T21:00:00Z'`) - Metronome accepts it and the UI renders it as
  long-dated.
- Direct contracts with SEAT_BASED subscriptions MUST include
  `initial_seat_ids` inside `seat_config` (package contracts inherit this -
  don't try to duplicate it there). See `metronome-subscriptions-seats`.
- For commit payload shape (priority, rollover_fraction, access vs invoice
  schedule, applicable_product_tags), see "Commits and credits" below.

### Commits and credits

Both are balances drawn down by usage. The difference is who pays:

| | Commit | Credit |
|---|---|---|
| What it is | A customer obligation to spend (prepaid or postpaid) | A free grant (promotional, complimentary, make-good) |
| `type` | `PREPAID` or `POSTPAID` | none (lives in `add_credits` / `credits[]`) |
| Invoice artifact | `invoice_schedule` bills the commit (prepaid: up front; postpaid: trueup at end) | none |
| Edit op | `add_commits`, `update_commits`, `archive_commits` | `add_credits`, `update_credits`, `archive_credits` |

Key fields:

- `access_schedule` - when, and how much, balance is available. Its
  `credit_type_id` can be fiat or a **custom credit type** you defined.
- `invoice_schedule` - what the customer is billed. Its `credit_type_id`
  **must be a fiat currency** (USD cents is
  `2714e483-4ff1-48e4-9e25-ac732e8f24f2`). A custom credit type here returns
  `400 Credit type must be a fiat currency: <UUID>`, and only on live POST.
  `invoice_schedule` is optional on PREPAID `add_commits[]`; omitting it gives
  a pure access grant with no invoice.
- `priority` - lower number draws down first.
- `applicable_product_ids` / `applicable_product_tags` - which products the
  balance can pay for. Omitting both means "applies to everything".
- `rollover_fraction` - share of unused balance carried to a renewal
  contract (0 to 1). Only meaningful on transitions.
- `uniqueness_key` - same 128-char limit; reuse returns 409. Use it on every
  grant so a retried grant does not double-credit the customer.
- `custom_fields` - only keys registered for the entity type are accepted
  (`400 Invalid custom field keys` otherwise). Register keys with
  `POST /v1/customFields/addKey` first; see `metronome-customers-hierarchies`.

Recommended practice for complimentary grants: prefer `add_credits` (or a
PREPAID commit with no `invoice_schedule`) and record who granted it and why
in registered custom fields. Run `metro credit preview --shape
complimentary-credit-grant` before applying; for paid top-ups use
`--shape paid-credit-top-up`.

### editContract - mechanism (catalog lives in `references/`)

```js
// add a mid-term complimentary commit
await m.post('/v2/contracts/edit', {
  customer_id: '<CUSTOMER_ID>',
  contract_id: '<CONTRACT_ID>',
  add_commits: [{ /* commit payload - see "Commits and credits" */ }],
});
```

The full operation catalog - every `add_*` / `update_*` / `remove_*` /
`archive_*` op, what it does, and its quirks - lives in
`references/editcontract-ops.md`. That file is the canonical reference;
SKILL.md just names the mechanism.

### What editContract CANNOT do

These will either 400 with "schema mismatch" or silently no-op. Reach for
the dedicated endpoint (or accept you can't do it):

| You want to... | `/v2/contracts/edit` verdict | Do this instead |
|---|---|---|
| Change the contract end date | Current docs list `update_contract_end_date` as a plain RFC 3339 string (plus `allow_contract_ending_before_finalized_invoice`). Sending it as an object returns `400 instance failed to match exactly one schema` | Recommended: `POST /v1/contracts/updateEndDate` (see below) - dedicated, simpler to read back |
| Push a DRAFT invoice's issue date | No op | `POST /v1/contracts/updateInvoiceIssueDate` |
| Modify rates on a FINALIZED invoice | Invoice immutable | Void + `POST /v1/invoices/regenerate` (see `metronome-invoicing`) |
| Edit a rollover commit | Not supported | Edit the originating commit on the PREVIOUS contract |
| Swap the rate card | Contract pinned to its rate card | Archive + create a new contract on the new rate card |
| Add `scheduled_charges_on_usage_invoices` after creation | Silently ignored | Recreate the contract (or set it at creation via package template) |
| Edit a transitioned (superseded/renewed) contract with finalized invoices | 400 | Create a standalone contract instead |
| Add `hierarchy_configuration` on a package contract | 400 | Use a direct contract for hierarchy children |
| `update_recurring_commits` + `hierarchy_configuration` | Silently no-ops on `child_access` | Only `add_commits` reliably persists `hierarchy_configuration.child_access` |

### updateEndDate - shorten (or extend) a contract cleanly

Recommended over `/v2/contracts/edit update_contract_end_date` because it is a
single-purpose call with an explicit `allow_ending_before_finalized_invoice`
flag. Before firing, read
`metronome-danger-zone` §1.3 - shortening truncates draft statements, removes
upcoming SCHEDULED invoices (plan fees the customer expects), and may create
past-dated SCHEDULED invoices that finalize immediately.

```js
await m.post('/v1/contracts/updateEndDate', {
  customer_id: '<CUSTOMER_ID>',
  contract_id: '<CONTRACT_ID>',
  ending_before: '<NEW_END_ISO_HOUR_BOUNDARY>',
  allow_ending_before_finalized_invoice: false,  // docs default: TRUE. Pass false to protect finalized invoices.
});
```

`allow_ending_before_finalized_invoice` **defaults to `true`** per docs -
meaning by default Metronome will set an end date earlier than finalized
invoices' `end_timestamp`. The finalized invoices themselves remain
unchanged; to apply the new end date to them you must void + regenerate.
Pass `false` explicitly if you want Metronome to refuse the shortening when
it would invalidate a finalized invoice.

### updateInvoiceIssueDate - push a DRAFT invoice forward

Only works on DRAFT invoices; the new issue date must be before the
contract's `ending_before`. Useful when collapsing a DRAFT into a future
SCHEDULED so a customer isn't billed mid-period.

```js
// Docs require ONLY { invoice_id, issue_date }; customer/contract IDs are
// not part of the request body per the OpenAPI spec.
await m.post('/v1/contracts/updateInvoiceIssueDate', {
  invoice_id: '<DRAFT_INVOICE_ID>',
  issue_date: '<NEW_ISO_HOUR_BOUNDARY>',
});
```

The path lives under `/v1/contracts/...`, not `/v1/invoices/...` - an easy
mistake (see endpoint-matrix §16). `metro invoice issue-date preview` builds
this payload with contract-end evidence.

### Archive a contract - with the `void_invoices` warning

```js
await m.post('/v1/contracts/archive', {
  customer_id: '<CUSTOMER_ID>',
  contract_id: '<CONTRACT_ID>',
  void_invoices: true,  // REQUIRED field; omitting it returns 400 "missing required properties"
});
```

**DANGER:** `void_invoices: true` voids **every** invoice on that contract -
including FINALIZED, Stripe-paid ones. Stripe is NOT refunded. In one
remediation, an operator archived an old contract only to remove a small
DRAFT overage, and the archive also voided the paid plan-fee invoice - Stripe
showed the money collected while Metronome showed nothing billed. Read
`metronome-danger-zone` §1.1 and the §7 reconciliation checklist before
archiving a contract with paid invoices. If any invoice is FINALIZED with an
`external_invoice` that is paid, surface the reconciliation delta to the user
before calling, and prefer voiding only the target invoice once it finalizes
(watcher pattern in `metronome-invoicing`).

**Hierarchy archive order:** children MUST be archived before the parent,
else `"Child contract <ID> is not archived. Parent contract cannot be
archived unless all child contracts are archived."`.

### Other dedicated ops

```js
// Full history of edits applied to a contract
await m.post('/v2/contracts/getEditHistory', { customer_id, contract_id });

// Effective rates at a timestamp (incl. overrides)
await m.post('/v1/contracts/getContractRateSchedule', {
  customer_id, contract_id, at: '<ISO>',
});

// Route usage between overlapping contracts based on an event property
await m.post('/v1/contracts/setUsageFilter', {
  customer_id, contract_id,
  usage_filter: { /* group_key + values */ },
});

// Generate retroactive USAGE invoices for past periods (instead of past-dated ingest)
await m.post('/v1/contracts/createHistoricalInvoices', {
  customer_id, contract_id,
  invoices: [{ /* period + line items */ }],
});
```

Prefer `createHistoricalInvoices` over past-dated `/v1/ingest` when you
need to backfill old billable periods - ingest has a 34-day back-date
window and can retroactively inflate FINALIZED invoices (see
`metronome-danger-zone` §1.4).

### Transitions (RENEWAL, SUPERSEDE) - package-based plan changes

> **State of verified knowledge:**
>
> - **Observed in production:** `transition.type: SUPERSEDE` is
>   **incompatible with package contracts**. `POST /v1/contracts/create`
>   with `package_alias` + `SUPERSEDE` returns
>   `400 {"message":"Supersede transitions are not supported for package
>   contracts"}`. SUPERSEDE only works on **direct** contracts (explicit
>   `rate_card_id` + `commits`). The OpenAPI schema accepts the
>   combination, but the runtime validator rejects it. The error string is
>   the source of truth.
>
> - **Observed in production:** the **2-step pattern works** for
>   package-based plan changes: `updateEndDate` predecessor, then `create`
>   successor with `package_alias` + `transition.type: RENEWAL` +
>   `from_contract_id`. The predecessor `ending_before` is set explicitly;
>   the successor inherits the chain via `transitions[]`.
>
> - **Docs claim (canary before relying on it):** per
>   [apply-credits-commits](https://docs.metronome.com/pricing-packaging/apply-credits-commits)
>   and [lifecycle-transitions](https://docs.metronome.com/manage-product-access/lifecycle-transitions),
>   a single-call `RENEWAL` on `/v1/contracts/create` is documented as
>   sufficient - Metronome says it ends the current contract and all
>   future recurring charges, and explicitly describes mid-term upgrades as
>   "create a new contract starting today with a Renewal transition from the
>   previous contract". No prior `updateEndDate` call appears in any doc
>   example. The 2-step may be unnecessary, but until you canary a
>   single-call RENEWAL in sandbox, prefer the 2-step for package
>   transitions. Two sub-cases are worth canarying separately: (a) a
>   predecessor with an explicit `ending_before`, (b) an open-ended
>   predecessor - docs are silent on whether RENEWAL can end one.
>
> - **Direct contracts (not package):** the SUPERSEDE single-call pattern
>   may work (the 400 is explicitly scoped to "package contracts"). Canary
>   before relying on it.

A transition links a successor contract to its predecessor. Two types -
values are case-insensitive (Metronome accepts both upper and lower); use
UPPERCASE in code:

| Type | Meaning | Predecessor end behavior | Works on package contracts? |
|---|---|---|---|
| `RENEWAL` | Successor handoff at predecessor's `ending_before` | Predecessor must already be ending at successor's `starting_at` (truncate it FIRST via `updateEndDate` if mid-term) | **Yes - the canonical path** |
| `SUPERSEDE` | Mid-term replacement, auto-truncates predecessor | Predecessor's `ending_before` snaps to successor's `starting_at` automatically | **No - `400 "Supersede transitions are not supported for package contracts"`. Direct contracts only (canary first).** |

#### Canonical payload - package-based plan change (2-step)

`metro contract move-plan preview` builds and validates this whole sequence
locally before anything is applied.

```js
// Date-only suffix. A full ISO cutoverAt in the key is a common way to exceed 128 chars.
const uniquenessKey = `plan-change:${CUSTOMER_ID}:${OLD_CONTRACT_ID}:${TARGET_ALIAS}:${cutoverAt.slice(0, 10)}`;
if (uniquenessKey.length > 128) {
  throw new Error(`Metronome contract uniqueness_key too long (${uniquenessKey.length}/128)`);
}

// 1. Truncate the predecessor to the cutover instant.
await m.post('/v1/contracts/updateEndDate', {
  customer_id:                            CUSTOMER_ID,
  contract_id:                            OLD_CONTRACT_ID,
  ending_before:                          cutoverAt,
  allow_ending_before_finalized_invoice:  false, // protect finalized invoices
});

// 2. Create the successor on the new package, with RENEWAL transition.
const created = await m.post('/v1/contracts/create', {
  customer_id:    CUSTOMER_ID,
  starting_at:    cutoverAt,                 // must equal predecessor's new ending_before
  package_alias:  TARGET_ALIAS,              // resolves at starting_at, not now
  uniqueness_key: uniquenessKey,             // idempotent retries; max 128
  transition: {
    type:             'RENEWAL',
    from_contract_id: OLD_CONTRACT_ID,
    // future_invoice_behavior.trueup: 'remove' is accepted but only meaningful
    // for POSTPAID predecessors (skips trueup invoices). PREPAID: omit.
  },
});
```

Knobs to know:

- **`starting_at`** - the cutover instant. MUST equal the predecessor's
  new `ending_before`. Must be hour-boundary (`:00:00Z`); non-zero
  minutes/seconds return 400.
- **`package_alias`** - resolves to the package version live at
  `starting_at` (NOT at API-call time). Lets you schedule cutovers ahead of
  new package versions cleanly.
- **`package_id`** - pins an exact package version. Use sparingly, e.g. for
  manual sandbox moves when the alias hand-off is future-dated but the move
  must be effective now.
- **`transition.future_invoice_behavior.trueup`** - `'remove'` skips any
  future trueup invoices on the predecessor; `'as_is'` (default) keeps them.
  Only meaningful for POSTPAID predecessors. For PREPAID contracts, omit.

#### Cadence pre-flight before choosing `cutoverAt`

Recommended practice for any customer-specific downgrade, upgrade, tier swap,
or paid-plan package transition: derive the proposed cutover from the
predecessor's actual paid cadence before touching `updateEndDate` or creating
the successor.

1. Fetch the active predecessor via `/v2/contracts/get` and list contracts
   via `/v2/contracts/list`.
2. List recent invoices with `GET /v1/customers/{id}/invoices` and identify
   the most recent paid/FINALIZED plan-fee invoice plus any future DRAFT
   plan invoice.
3. List balances with `/v1/contracts/customerBalances/list` and inspect the
   active commit / credit access windows and invoice schedules for the
   current paid plan.
4. Determine the natural boundary: same cadence, same cycle day, same UTC
   hour as the paid plan's current period end / next recurring invoice.
5. Propose that boundary to the user as the default `cutoverAt`. A calendar
   first-of-month date is only appropriate if the predecessor already bills
   on the 1st, or the user explicitly approves an off-cycle move.

Example: if a customer paid for Pro on June 14 and the recurring
commit/access window runs June 14 to July 14, a downgrade to Starter should
default to July 14 at that same hour, not July 1. If the business wants to
refund the difference mid-cycle, keep the successor on the same paid-period
boundary and handle the current-period economics with a Stripe refund
decision plus a Metronome manual balance adjustment for the excess credits.

#### Mid-term move onto a billing-empty package (no charge)

When the target package has **no** commits, subscriptions, or scheduled
charges (e.g. an "enterprise shell" package whose terms are added per
customer), a mid-term `RENEWAL` does not invent a plan fee. Still prove
balances after apply: commits with `rollover_fraction: 0` drop unused
balance, leaving a zeroed successor. Restore the **remaining** balance with a
ledger adjustment or `add_commits`, then add the next paid renewal on the
successor (the predecessor's future DRAFTs are removed by `updateEndDate`).

#### Direct-contract case (SUPERSEDE, unverified)

If neither side of the transition is a package - e.g. a bridge contract
moving to a bespoke enterprise contract - the SUPERSEDE single call MAY work:

```js
// UNVERIFIED for direct contracts. Canary on one sandbox customer first.
await m.post('/v1/contracts/create', {
  customer_id:    CUSTOMER_ID,
  starting_at:    cutoverAt,
  rate_card_id:   '<RATE_CARD_ID>',          // direct, not package
  // ... commits[], overrides[], etc.
  transition: {
    type:             'SUPERSEDE',
    from_contract_id: OLD_CONTRACT_ID,
  },
});
```

If this 400s with the same `Supersede transitions are not supported`
message, fall back to the 2-step pattern.

#### Adding credits / commits to the new contract

Package-based contract creation can't include `commits` (restricted
package payload). To grant credits on the successor, follow up
immediately with `/v2/contracts/edit add_commits[]` (or `add_credits[]`).

```js
const created = await m.post('/v1/contracts/create', { /* transition payload above */ });
const newContractId = created.data?.id || created.id;

await m.post('/v2/contracts/edit', {
  customer_id: CUSTOMER_ID,
  contract_id: newContractId,
  add_commits: [{
    type: 'PREPAID',
    product_id: '<PLAN_PRODUCT_ID>',
    name: '2000 Credits - moved from Legacy',
    priority: 2,
    rollover_fraction: 1,
    applicable_product_tags: ['<PRODUCT_TAG>'],
    uniqueness_key: `grant:${CUSTOMER_ID}:${newContractId}:moved-2000`,
    access_schedule: {
      credit_type_id: '00000000-0000-4000-8000-000000000001',  // your custom credit type
      schedule_items: [{
        amount: 2000,
        starting_at:  cutoverAt,
        ending_before: '2126-04-30T00:00:00.000Z',
      }],
    },
    // Pure access grant - omit invoice_schedule for free credits.
    // Include it only for paid top-ups (fiat credit type, e.g. USD cents).
    custom_fields: {                         // keys must be registered first (customFields/addKey)
      grant_reason: 'Plan transition Legacy to PAYG; 2000 credit grant',
      granted_by:   'Jane Operator',
      granted_by_email: 'ops@example.com',
      granted_at:   new Date().toISOString(),
    },
  }],
});
```

#### Decision tree - which transition path?

```
Are you changing a customer's plan / tier?
+- Predecessor EXPIRED (ending_before in the past - trial lapsed or churned paid)
|   -> Fresh /v1/contracts/create with package_alias ONLY - NO transition block
|   -> Do NOT use metro contract move-plan (requires an active open-ended contract)
|   -> Metronome restart guidance:
|      https://docs.metronome.com/guides/pricing-packaging/subscription/manage-subscription-lifecycle
|
+- Natural-boundary renewal (predecessor still active, already ending at boundary)
|   -> /v1/contracts/create with package_alias + transition.type: RENEWAL
|      (single call per docs; canary it, or use the 2-step to be safe)
|
+- Mid-term plan change on an ACTIVE open-ended paid contract (tier swap)
|   -> 2-step: updateEndDate, then create with RENEWAL
|   -> SUPERSEDE on package contracts returns 400
|
+- Just need to end a contract (no successor)
    -> /v1/contracts/updateEndDate alone
```

**Expired vs active - do not conflate.** Backend logic that always passes
`transition` breaks an expired-trial-to-paid re-purchase: a RENEWAL from an
expired contract can block the upgrade. Classify the predecessor as active
now (`starting_at <= now < ending_before`, not archived) before any
`contracts/create`.

#### Verification (always - even after a single canary)

```js
// 1. Both contracts visible, transition chain linked
const after = await m.post('/v2/contracts/list', { customer_id, include_archived: false });
// Predecessor: ending_before == cutoverAt  AND  transitions[].to_contract_id == newContractId
// Successor:   starting_at == cutoverAt    AND  transitions[].from_contract_id == OLD_ID

// 2. New contract has expected commits / package terms
const bal = await m.post('/v1/contracts/customerBalances/list', {
  customer_id, include_balance: true, include_contract_balances: true,
});
// e.g. bal.data.data[].contract.id == newContractId with the right access_schedule

// 3. No surprise invoices on the predecessor (especially if you set trueup: 'remove')
const invs = await m.raw.get(`/v1/customers/${customer_id}/invoices?limit=20`);
// Confirm: no future old-plan draft after cutover, no new-plan draft before
// cutover, and the first successor plan invoice is on the cadence boundary.
```

When walking `/v2/contracts/list` output, inspect each contract's
`transitions[]` array with `from_contract_id` / `to_contract_id` edges to
reconstruct the chain. This is also how you audit a whole tenant for a bad
transition pattern ("did any other customer get silently downgraded from a
paid tier?"): list contracts per customer and flag successors whose
`from_contract` was a paid tier with finalized plan invoices but whose
rollover dropped the paid balance.

**Transitioned contracts that already have FINALIZED invoices CANNOT be
edited via `/v2/contracts/edit`** - 400. Work around by creating a new
standalone contract instead.

## Decision trees

### Package vs direct contract

```
Is this a repeatable customer shape (e.g. a tier you sell to N customers)?
+- YES -> PACKAGE
|   +- Future pricing change = new package version, same alias
+- NO  -> DIRECT CONTRACT
    +- Bridge contract (gap-filler, 1h-1d duration)
    +- Enterprise / bespoke deal (custom commits, rates, tags)
    +- Hierarchy CHILD (packages reject hierarchy_configuration)
    +- Historical backfill contract
```

Corollary: if you reach for a package but find yourself needing
`hierarchy_configuration`, `rate_card_id` overrides, or bespoke commits,
you want a direct contract. `metro custom-contract preview` covers the
enterprise direct-contract shape.

### editContract vs a dedicated endpoint

```
Operation                        | Use
---------------------------------+------------------------------------------
Add/update/archive commits       | /v2/contracts/edit   (add_commits, etc.)
Add/update/archive credits       | /v2/contracts/edit   (add_credits, etc.)
Add/remove overrides             | /v2/contracts/edit   (add_overrides, ...)
Add/remove scheduled charges     | /v2/contracts/edit   (add_scheduled_charges)
Rename contract                  | /v2/contracts/edit   (update_contract_name)
Update spend threshold           | /v2/contracts/edit   (update_spend_threshold_configuration)
Seat add/remove                  | /v2/contracts/edit   (update_subscriptions.seat_updates)
---------------------------------+------------------------------------------
Change end date                  | /v1/contracts/updateEndDate
Push DRAFT invoice issue date    | /v1/contracts/updateInvoiceIssueDate
Archive / void-all               | /v1/contracts/archive
Set per-contract usage filter    | /v1/contracts/setUsageFilter
Create historical USAGE invoices | /v1/contracts/createHistoricalInvoices
```

If unsure whether editContract supports an op, check
`references/editcontract-ops.md` first - the list there is exhaustive.

### Bridge contract pattern

When an old contract must end but the new one can't start immediately (e.g.
waiting for Stripe config, the next hour boundary, or a cutover window):

1. Archive (or end) the old contract at time T.
2. Create a **direct** bridge contract spanning T to T+delta (min 1h), with a
   zero-cost `commits[]` entry so the customer keeps credits and isn't
   dropped into a trial or "no plan" state in your app.
3. Create the new target contract starting at T+delta (from package or
   direct).

Example: a 60-minute bridge between an archived PAYG contract and a new paid
contract, with 500 bridge credits and `unit_price: 0` so no invoice reaches
Stripe. See the direct-contract payload above.

## Edge cases & gotchas

- **Hour-boundary snap.** `starting_at`, `ending_before`, and any schedule
  item timestamp MUST be `:00:00Z`. Non-zero minutes/seconds return 400. Use
  a helper:

  ```js
  function nextHourISO() {
    const d = new Date();
    d.setUTCMinutes(0, 0, 0);
    d.setUTCHours(d.getUTCHours() + 1);
    return d.toISOString();
  }
  ```

- **`uniqueness_key` on create.** Always pass a deterministic key (e.g.
  `<customer-ref>-<tier>-<start-date>`, max 128 chars). A retry without one
  can create a duplicate contract. A 409 on retry with a matching key means
  the record already exists - look it up and reuse it:

  ```js
  try {
    const r = await m.post('/v1/contracts/create', payload);
  } catch (err) {
    if (err.response?.status === 409) {
      const existing = await m.post('/v2/contracts/list', { customer_id });
      const match = (existing.data || []).find(c => c.uniqueness_key === payload.uniqueness_key);
      // reuse match.id
    } else throw err;
  }
  ```

- **Validate all successor-create fields before `updateEndDate`.** In a
  two-step package transition, `updateEndDate` mutates the predecessor before
  the successor exists. Pre-fetch the target package, choose `package_alias`
  vs `package_id`, build the create payload, validate hour-boundary
  timestamps, and assert `uniqueness_key.length <= 128` before ending the
  current contract. For plan-change keys, use `cutoverAt.slice(0, 10)` (not
  the full ISO). If the successor create still fails, retry only the create
  with the same `starting_at` and a corrected key; do not move the
  predecessor end date again.

- **Package contracts with Stripe require billing config FIRST.** Creating a
  package contract with `billing_provider: 'stripe'` on a customer with no
  Stripe billing provider config returns `404 Billing provider configuration
  not found for STRIPE`. Call `/v1/setCustomerBillingProviderConfigurations`
  first (details in `metronome-stripe-delivery`).

- **Schedule item timestamps must be inside the contract range.**
  `add_scheduled_charges` with a timestamp after `ending_before` returns 400.
  A common off-by-one from source-system date boundaries.

- **Past-dated `add_scheduled_charges` finalize IMMEDIATELY** - they
  bypass "leave invoices as drafts" and push to Stripe within seconds if
  the customer has an active billing config (see `metronome-danger-zone`
  §1.5). Archive billing configs first if you need to prevent the push.

- **Transitioned contracts can't be edited.** If a contract has
  `transitions[]` pointing at a successor AND has finalized invoices,
  `/v2/contracts/edit` returns 400. Create a new standalone contract
  instead.

- **Downgrade flows can silently drop paid balance.** If your app moves a
  paid customer onto a free or lower tier (for example from a "credits
  depleted" webhook handler that is not idempotent or not tier-aware), a
  successor with `rollover_fraction < 1` loses the paid credits. Recommended
  practice: block transitions to a lower tier when the source contract has a
  FINALIZED, paid invoice in the current period, and require explicit
  confirmation in the UI.

- **No-expiry convention.** `ending_before` about 100 years out (e.g.
  `'2126-04-22T21:00:00Z'`) is a common convention for "never ends".
  Metronome accepts it; the UI shows a long-dated contract.

- **`scheduled_charges_on_usage_invoices: 'ALL'`** is a **contract-level**
  setting that collapses SCHEDULED (plan fees, commit invoices, one-offs)
  into the USAGE invoice for the period. It **cannot be added after contract
  creation** via editContract - silently ignored. Set it at creation, or
  bake it into the package.

- **Package archive vs rate-card archive field names.**
  `/v1/packages/archive` takes `{ package_id }`; rate-card archive takes
  `{ id }`. Inconsistent, but that is how they are.

- **`/v1/packages/list` returns ALL packages** (including archived). Filter
  on `archived_at` client-side if you only want active.

- **Contract `commits` on create = direct only.** If you pass `commits` on a
  payload that also has `package_alias`, the whole request 400s (restricted
  package payload). Create the package contract first, then add commits via
  `/v2/contracts/edit`.

## Cross-references

- `metronome-danger-zone` - **source of truth for paths**; §1.1 (archive
  void_invoices), §1.3 (shortening side effects), §1.5 (past-dated
  scheduled charges), §5 (timestamp rules), §6 (complimentary commit
  payload), §7 (reconciliation checklist)
- `metronome-invoicing` - DRAFT to FINALIZED to VOID state machine, void,
  regenerate, auto-finalize timing, payment preconditions, watcher pattern.
  "How an invoice lifecycle unfolds" is there; "how a contract op triggers
  invoice changes" is here.
- `metronome-pricing-catalog` - rate cards, products, rate types, overrides
  schema. Overrides are applied to contracts via editContract (mechanism
  here) but the override object's shape lives there.
- `metronome-stripe-delivery` - billing provider configs, delivery_method
  vs delivery_method_id. A contract can reference a config but the config
  lifecycle lives there.
- `metronome-customers-hierarchies` - `hierarchy_configuration` on direct
  contracts, parent/child archive order, shared commits, custom-field keys.
- `metronome-subscriptions-seats` - subscriptions, SEAT_BASED pricing, seat
  updates via editContract.
- `metro` - CLI safety model and the preview commands referenced above.

## When NOT to use this skill

- "Why is this invoice stuck in DRAFT" / "void this invoice" / "regenerate
  this invoice" -> `metronome-invoicing`
- "How do I push a contract invoice to a different Stripe account" ->
  `metronome-stripe-delivery`
- "How do rate overrides work" / "what's a PERCENTAGE rate" ->
  `metronome-pricing-catalog`
- "Set up a parent/child account" / "shared commits across children" ->
  `metronome-customers-hierarchies`
- "Add seats" / "seat proration" -> `metronome-subscriptions-seats`
