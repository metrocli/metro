# Metronome Endpoint Matrix - Verified

The single source of truth for the Metronome API endpoints these skills
cover, with **official doc links** and **verified paths** (checked against
the public API reference indexed at `https://docs.metronome.com/llms.txt`).

**Rule**: before writing a new Metronome API call, grep this file for the
capability you need. Do NOT guess paths - in one real remediation, every
guessed path was wrong (see §16). If the capability isn't here, fetch the
relevant doc page (pattern:
`https://docs.metronome.com/api-reference/<domain>/<kebab-slug>.md`), or run
`metro api search <query>` / `metro api explain <endpoint-id>`.

Status legend:
- `✓` - verified working against a live tenant
- `?` - documented, not yet exercised live by these skills
- `⚠` - works but has a gotcha; see the Notes column
- `✗` - genuinely does not exist; do not try again

Table of contents:
1. [Usage / Ingest](#1-usage--ingest)
2. [Billable Metrics](#2-billable-metrics)
3. [Products](#3-products)
4. [Rate Cards](#4-rate-cards)
5. [Packages](#5-packages)
6. [Customers](#6-customers)
7. [Billing Provider Configs (Stripe)](#7-billing-provider-configs-stripe)
8. [Custom Fields](#8-custom-fields)
9. [Contracts](#9-contracts)
10. [Credits & Commits](#10-credits--commits)
11. [Invoices](#11-invoices)
12. [Payments](#12-payments)
13. [Alerts / Threshold Notifications](#13-alerts--threshold-notifications)
14. [Offset / Lifecycle Notifications](#14-offset--lifecycle-notifications)
15. [Settings & Security](#15-settings--security)
16. [Paths guessed wrong](#16-paths-guessed-wrong)

---

## 1. Usage / Ingest

| Stat | Method+Path | Purpose | Official docs |
|---|---|---|---|
| ✓ | `POST /v1/ingest` | Send usage events (batched, ≤100 per request) | [ingest-events](https://docs.metronome.com/api-reference/usage/ingest-events.md) |
| ? | `POST /v1/usage/groups` | Paginated usage data with dimensions; body carries customer, billable metric, time window, window size, and group keys while pagination stays in query params. | [get-usage-data-with-paginated-groupings](https://docs.metronome.com/api-reference/usage/get-usage-data-with-paginated-groupings.md) |
| ? | `POST /v1/usage` | Batched usage across customers and billable metrics; body carries `window_size`, `starting_on`, `ending_before`, optional customer/metric filters, while `next_page` stays in query params. | [get-batched-usage-data](https://docs.metronome.com/api-reference/usage/get-batched-usage-data.md) |
| ? | `POST /v1/events/search` | Search events by `transactionIds[]` JSON body (34d window, sampling QA; response rows include `transaction_id`) | [search-events](https://docs.metronome.com/api-reference/usage/search-events.md) |

**⚠ Ingest gotchas:**
- Supports back-dating up to **34 days** from now. Older timestamps are
  silently dropped or rejected (check response).
- Past-dated events can **retroactively inflate FINALIZED invoices** if they
  fall in a still-editable window, or trigger follow-up backfills. Never
  ingest historical without confirming which invoice they'll land on.
- Batch: wrap as a JSON array, not an object: `[{event1}, {event2}, ...]`.
- `transaction_id` must be unique; Metronome dedupes on it.

---

## 2. Billable Metrics

| Stat | Method+Path | Purpose | Official docs |
|---|---|---|---|
| ✓ | `POST /v1/billable-metrics/create` | Create metric that converts events → quantities | [create-a-billable-metric](https://docs.metronome.com/api-reference/billable-metrics/create-a-billable-metric.md) |
| ? | `GET /v1/billable-metrics/{id}` | Get one metric | [get-a-billable-metric](https://docs.metronome.com/api-reference/billable-metrics/get-a-billable-metric.md) |
| ? | `GET /v1/billable-metrics` | List all (paginated) | [list-all-billable-metrics](https://docs.metronome.com/api-reference/billable-metrics/list-all-billable-metrics.md) |
| ? | `POST /v1/billable-metrics/archive` | Archive by body `id`; existing Products continue to meter with the archived metric definition. | [archive-a-billable-metric](https://docs.metronome.com/api-reference/billable-metrics/archive-a-billable-metric.md) |
| ? | `PUT /v1/billable-metrics/{billable_metric_id}` | Rename only; configuration cannot be changed after creation. | [update-a-billable-metric](https://docs.metronome.com/api-reference/billable-metrics/update-a-billable-metric.md) |

**⚠ Gotcha:** metrics are NOT retroactive - only apply to events ingested
after creation. Backfill via new metric + re-ingestion window if needed.

---

## 3. Products

| Stat | Method+Path | Purpose | Official docs |
|---|---|---|---|
| ✓ | `POST /v1/contract-pricing/products/create` | Create product (line-item on invoice) | [create-a-product](https://docs.metronome.com/api-reference/products/create-a-product.md) |
| ✓ | `POST /v1/contract-pricing/products/get` | Get one product (with version history) | [get-a-product](https://docs.metronome.com/api-reference/products/get-a-product.md) |
| ✓ | `POST /v1/contract-pricing/products/list` | Paginated list | [list-products](https://docs.metronome.com/api-reference/products/list-products.md) |
| ✓ | `POST /v1/contract-pricing/products/update` | Schedule product change (requires `starting_at`, must be hour boundary) | [update-a-product](https://docs.metronome.com/api-reference/products/update-a-product.md) |
| ⚠ | `POST /v1/contract-pricing/products/archive` | Archive product | [archive-a-product](https://docs.metronome.com/api-reference/products/archive-a-product.md) |

**⚠ Gotcha 1:** `get` response nests data under `data.current` / `data.initial`.
Access `data.current.name`, NOT top-level `data.name`.

**⚠ Gotcha 2 - archive ≠ remove from rate card.** `products/archive`
only prevents future `addRates` calls. Existing `entitled=true` rate
entries keep aggregating events and producing invoice lines (ghost
`qty=N × 0` lines at price 0; actual charges at non-zero price). There
is no `removeRate` endpoint. Correct retirement sequence:
1. `POST /v1/contract-pricing/rate-cards/addRates` with
   `entitled: false, price: 0` on **every** rate card the product is on
2. THEN `POST /v1/contract-pricing/products/archive`

See `metronome-danger-zone` §1.9 and `metronome-pricing-catalog`
§"Retiring a product". `metro product retire preview` builds the sequence.

**⚠ Gotcha 3 - scheduled rename and `getRates` display-name caching.**
`products/update` with a future `starting_at` correctly renames the
product at that timestamp on customer invoices. BUT: `rate-cards/getRates`
reports the product's CURRENT display name in its `product_name`
response, not the name-at-timestamp. Verify scheduled renames via
`products/get` + `data.updates[]`, not via `getRates`.

---

## 4. Rate Cards

| Stat | Method+Path | Purpose | Official docs |
|---|---|---|---|
| ✓ | `POST /v1/contract-pricing/rate-cards/create` | Create rate card | [create-a-rate-card](https://docs.metronome.com/api-reference/rate-cards/create-a-rate-card.md) |
| ? | `POST /v1/contract-pricing/rate-cards/get` | Get one rate card (metadata only, no rates) | [get-a-rate-card](https://docs.metronome.com/api-reference/rate-cards/get-a-rate-card.md) |
| ? | `POST /v1/contract-pricing/rate-cards/list` | List all rate cards | [list-rate-cards](https://docs.metronome.com/api-reference/rate-cards/list-rate-cards.md) |
| ✓ | `POST /v1/contract-pricing/rate-cards/getRates` | Get rates at a timestamp (filter by product/pricing group) | [get-rates](https://docs.metronome.com/api-reference/rate-cards/get-rates.md) |
| ? | `POST /v1/contract-pricing/rate-cards/getRateSchedule` | Get full rate schedule (all scheduled changes) | [get-a-rate-schedule](https://docs.metronome.com/api-reference/rate-cards/get-a-rate-schedule.md) |
| ✓ | `POST /v1/contract-pricing/rate-cards/addRates` | Add scheduled rate changes | [add-rates](https://docs.metronome.com/api-reference/rate-cards/add-rates.md) |
| ? | `POST /v1/contract-pricing/rate-cards/update` | Update rate card metadata only (name/desc/aliases) | [update-a-rate-card](https://docs.metronome.com/api-reference/rate-cards/update-a-rate-card.md) |
| ? | `POST /v1/contract-pricing/rate-cards/archive` | Archive | [archive-a-rate-card](https://docs.metronome.com/api-reference/rate-cards/archive-a-rate-card.md) |
| ? | `POST /v1/contract-pricing/rate-cards/setRateCardProductsOrder` | Set product ordering on invoices. | [set-the-rate-card-products-order](https://docs.metronome.com/api-reference/rate-cards/set-the-rate-card-products-order.md) |

---

## 5. Packages

| Stat | Method+Path | Purpose | Official docs |
|---|---|---|---|
| ✓ | `POST /v1/packages/create` | Create package (reusable contract template) | [create-a-package](https://docs.metronome.com/api-reference/contracts/create-a-package.md) |
| ✓ | `POST /v1/packages/get` | Get one package | [get-a-package](https://docs.metronome.com/api-reference/packages/get-a-package.md) |
| ✓ | `POST /v1/packages/list` | List all packages | [list-all-packages](https://docs.metronome.com/api-reference/list-all-packages.md) |
| ✓ | `POST /v1/packages/archive` | Archive package (existing contracts unaffected) | [archive-a-package](https://docs.metronome.com/api-reference/packages/archive-a-package.md) |
| ? | `POST /v1/packages/listContractsOnPackage` | List contracts associated with a package. | [list-contracts-associated-with-a-package](https://docs.metronome.com/api-reference/contracts/list-contracts-associated-with-a-package.md) |

**⚠ Packages: restricted contract-create payload.** When creating a contract
with `package_alias` or `package_id`, only a small set of fields is accepted
(`customer_id`, `starting_at`, `package_alias`/`package_id`, `transition`,
`uniqueness_key`, `custom_fields`, per the create-a-contract spec). Adding other
fields (`commits`, `overrides`, etc.) → 400. To customize at contract level,
create with package then immediately `/v2/contracts/edit`.

**⚠ `/v1/packages/list` pagination uses URL query params, not body.**
`limit` and `next_page` on THIS endpoint are query-only per Metronome's
Go SDK (`query:"limit"` / `query:"next_page"` + `json:"-"`). Sending
them in the POST body gets silently ignored - you'll see page 1 forever.
```js
// right
await m.post(`/v1/packages/list?limit=100&next_page=${encodeURIComponent(token)}`, {});
// wrong - token is ignored
await m.post('/v1/packages/list', { limit: 100, next_page: token });
```
Ref: [Metronome pagination](https://docs.metronome.com/api-reference/pagination).

**⚠ Package `uniqueness_key` returned with `package:` prefix.** Create
accepts the bare key; `list` and `get` responses wrap it as
`"package:<your_key>"`. Normalize on compare:
`(k) => (k || '').replace(/^package:/, '')`. Undocumented - only visible
from real response inspection.

**⚠ `package_alias` resolves at contract `starting_at`, not create-time.**
On `/v1/contracts/create` with `package_alias`, Metronome resolves the
alias to the package version whose alias `starting_at` is current at
the CONTRACT's `starting_at`. This enables zero-downtime version bumps:
add the new version with alias `starting_at: T+1h`, leave the old one
alone - new contracts flip to vN+1 at T+1h automatically. Backend
contract creation should ALWAYS use `package_alias` (not a hardcoded
`package_id`) so version bumps don't require a coordinated backend deploy.

**⚠ Archive old package versions AFTER the new alias is live.** If you
archive vN before the scheduled alias hand-off fires, any
`package_alias` contract-create between "archive-time" and "alias-
fires-time" still resolves to vN and gets a 400. Safe pattern: pre-
flight check that v-next alias `starting_at` is in the past before
archiving v-prev. `metro package archive preview` enforces this.

---

## 6. Customers

| Stat | Method+Path | Purpose | Official docs |
|---|---|---|---|
| ✓ | `POST /v1/customers` | Create customer (optionally with billing config) | [create-a-customer](https://docs.metronome.com/api-reference/customers/create-a-customer.md) |
| ✓ | `GET /v1/customers/{customer_id}` | Get one customer | [get-a-customer](https://docs.metronome.com/api-reference/customers/get-a-customer.md) |
| ✓ | `GET /v1/customers?limit=100&next_page=X&ingest_alias=Y&customer_ids[]=...&only_archived=false` | Paginated list/search (GET, not POST) | [list-customers](https://docs.metronome.com/api-reference/customers/list-customers.md) |
| ✓ | `POST /v1/customers/archive` | Archive customer (also archives contracts + voids invoices) | [archive-a-customer](https://docs.metronome.com/api-reference/customers/archive-a-customer.md) |
| ? | `POST /v1/customers/{customer_id}/updateConfig` | Update `salesforce_account_id`, `leave_stripe_invoices_in_draft` | [update-a-customer-configuration](https://docs.metronome.com/api-reference/customers/update-a-customer-configuration.md) |
| ? | `POST /v1/customers/{customer_id}/updateName` | Rename customer | [update-a-customer-name](https://docs.metronome.com/api-reference/customers/update-a-customer-name.md) |
| ✓ | `POST /v1/customers/{customer_id}/setIngestAliases` | Set/update ingest aliases | [create-or-update-customer-ingest-aliases](https://docs.metronome.com/api-reference/customers/create-or-update-customer-ingest-aliases.md) |
| ? | `POST /v1/customers/dashboards/getEmbeddable` | Generate signed dashboard iframe URL | [get-an-embeddable-customer-dashboard](https://docs.metronome.com/api-reference/customers/get-an-embeddable-customer-dashboard.md) |

**⚠ Customer listing:**
- Single-fetch: `GET /v1/customers/{id}` (path-style, GET).
- Multi-fetch: `GET /v1/customers?customer_ids=id1&customer_ids=id2&limit=100` (query string, GET).
- Search by ingest alias: `GET /v1/customers?ingest_alias=<alias>`.
- `POST /v1/customers/list`: **NOT a valid endpoint for lookup by customer_ids** (404). Some older integrations use it with `{ingest_alias: ...}` - undocumented legacy path; use the GET form for new code.

---

## 7. Billing Provider Configs (Stripe)

| Stat | Method+Path | Purpose | Official docs |
|---|---|---|---|
| ✓ | `POST /v1/setCustomerBillingProviderConfigurations` | Set/create Stripe (or other) billing config for a customer | [set-billing-provider-configurations-for-a-customer](https://docs.metronome.com/api-reference/customers/set-billing-provider-configurations-for-a-customer.md) |
| ✓ | `POST /v1/getCustomerBillingProviderConfigurations` | List a customer's billing configs | [fetch-billing-provider-configurations-for-a-customer](https://docs.metronome.com/api-reference/customers/fetch-billing-provider-configurations-for-a-customer.md) |
| ✓ | `POST /v1/archiveCustomerBillingProviderConfigurations` | Archive billing configs (used by 1 config per customer migration) | [archive-billing-provider-configurations-for-a-customer](https://docs.metronome.com/api-reference/customers/archive-billing-provider-configurations-for-a-customer.md) |

**⚠ Stripe config gotchas:**
- `delivery_method` enum values vary by endpoint. The full live openapi
  `BillingProviderDeliveryMethodType` on
  `setCustomerBillingProviderConfigurations` is
  `{direct_to_billing_provider, aws_sqs, tackle, aws_sns}`.
  Older docs/clients and the customer-create inline config have accepted
  `email` and `cash_app` - treat those as legacy and always check the
  exact endpoint's schema before using. Use `direct_to_billing_provider`
  for push to Stripe.
- Multi-entity billing (multiple Stripe accounts): set
  `delivery_method_id` pointing at a pre-configured
  `/v1/setupAccountBillingProvider` entry. Do NOT pass both
  `delivery_method` and `delivery_method_id` - it silently prefers one.
- `leave_stripe_invoices_in_draft: true` keeps Stripe invoices in draft
  (lets you review before finalization). Set via
  `/v1/customers/{id}/updateConfig`. Does NOT apply to past-dated
  SCHEDULED invoices - those bypass it (see danger-zone §1.5).

---

## 8. Custom Fields

| Stat | Method+Path | Purpose | Official docs |
|---|---|---|---|
| ✓ | `POST /v1/customFields/addKey` | Allowlist a new custom field key for an entity type | [create-a-custom-field-key](https://docs.metronome.com/api-reference/custom-fields/create-a-custom-field-key.md) |
| ? | `POST /v1/customFields/removeKey` | Remove a key from the allowlist | [delete-a-custom-field-key](https://docs.metronome.com/api-reference/custom-fields/delete-a-custom-field-key.md) |
| ? | `POST /v1/customFields/listKeys` | List allowlisted keys per entity type | [list-custom-field-keys](https://docs.metronome.com/api-reference/custom-fields/list-custom-field-keys.md) |
| ✓ | `POST /v1/customFields/setValues` | Set custom field values on an entity instance | [set-custom-field-values](https://docs.metronome.com/api-reference/custom-fields/set-custom-field-values.md) |
| ? | `POST /v1/customFields/deleteValues` | Remove specific values (preserves other fields) | [delete-custom-fields](https://docs.metronome.com/api-reference/custom-fields/delete-custom-fields.md) |

**⚠ Custom fields: whitelist is strict.**
- Values limited to **200 chars each**.
- Unknown keys → `400 Invalid custom field keys: <key>`.
- A typical audit set for PREPAID commits (only after you add them):
  `grant_reason`, `granted_by`, `granted_by_email`, `granted_at`. Entity
  types are distinct - a key valid for `commit` is not
  auto-valid for `customer` or `contract`.
- Adding a new key: call `addKey` FIRST with
  `{ entity: "commit", key: "my_key", enforce_uniqueness?: bool }`, then
  `setValues`.

---

## 9. Contracts

| Stat | Method+Path | Purpose | Official docs |
|---|---|---|---|
| ✓ | `POST /v1/contracts/create` | Create contract (package or direct) | [create-a-contract](https://docs.metronome.com/api-reference/contracts/create-a-contract.md) |
| ⚠ | `POST /v1/contracts/list` (**v1, deprecated**) | List contracts (v1 - use v2) | [list-customer-contracts-v1](https://docs.metronome.com/api-reference/contracts/list-customer-contracts-v1.md) |
| ✓ | `POST /v2/contracts/list` | List contracts (chronological, supports `include_archived`) | [list-customer-contracts-v2](https://docs.metronome.com/api-reference/contracts/list-customer-contracts-v2.md) |
| ⚠ | `POST /v1/contracts/get` (**v1, deprecated**) | Get one contract (v1) | [get-a-contract-v1](https://docs.metronome.com/api-reference/contracts/get-a-contract-v1.md) |
| ✓ | `POST /v2/contracts/get` | Get one contract (current, v2) | [get-a-contract-v2](https://docs.metronome.com/api-reference/contracts/get-a-contract-v2.md) |
| ✓ | `POST /v2/contracts/edit` | Mid-term edit (commits, overrides, seats, scheduled charges, end date, etc.) | [edit-a-contract](https://docs.metronome.com/api-reference/contracts/edit-a-contract.md) |
| ? | `POST /v2/contracts/getEditHistory` | Full history of edits on a contract. | [get-contract-edit-history](https://docs.metronome.com/api-reference/contracts/get-contract-edit-history.md) |
| ✓ | `POST /v1/contracts/archive` | Archive contract (see §1.1 danger-zone for `void_invoices` side-effect) | [archive-a-contract](https://docs.metronome.com/api-reference/contracts/archive-a-contract.md) |
| ✓ | `POST /v1/contracts/updateEndDate` | Dedicated end-date change (cleaner than editContract for this case). `allow_ending_before_finalized_invoice` **defaults to `true`** - will silently shorten contracts past finalized invoices unless you pass `false`. Always set it explicitly on any prod-data edit. | [update-the-contract-end-date](https://docs.metronome.com/api-reference/contracts/update-the-contract-end-date.md) |
| ✓ | `POST /v1/contracts/updateInvoiceIssueDate` | Push a DRAFT invoice's issue date (only works on DRAFT, can't exceed contract end) | [update-invoice-issue-date](https://docs.metronome.com/api-reference/contracts/update-invoice-issue-date.md) |
| ? | `POST /v1/contracts/amend` | **Deprecated - use `/v2/contracts/edit`.** | [amend-a-contract](https://docs.metronome.com/api-reference/contracts/amend-a-contract.md) |
| ✓ | `POST /v1/contracts/getSubscriptionQuantityHistory` | History of seat quantity changes | [get-subscription-quantity-history](https://docs.metronome.com/api-reference/contracts/get-subscription-quantity-history.md) |
| ? | `POST /v1/contracts/getSubscriptionSeatsHistory` | History of seat schedule changes | [get-subscription-seats-history](https://docs.metronome.com/api-reference/contracts/get-subscription-seats-history.md) |
| ? | `POST /v1/contracts/getContractRateSchedule` | Effective rates (incl. overrides) for a contract at timestamp | [get-the-rate-schedule-for-a-contract](https://docs.metronome.com/api-reference/contracts/get-the-rate-schedule-for-a-contract.md) |
| ? | `POST /v1/contracts/setUsageFilter` | Route usage between multiple overlapping contracts | [set-a-contract-usage-filter](https://docs.metronome.com/api-reference/contracts/set-a-contract-usage-filter.md) |
| ? | `POST /v1/contracts/createHistoricalInvoices` | Generate retroactive USAGE invoices for past periods | [create-historical-invoices](https://docs.metronome.com/api-reference/contracts/create-historical-invoices.md) |

**⚠ editContract supports:**
- Add/update/archive commits, credits, recurring commits, recurring credits
- Add/remove overrides (discounts, custom pricing)
- Add/update/archive scheduled charges
- Update contract end date, contract name
- Spend threshold config

**editContract does NOT support:**
- Modifying rates on a FINALIZED invoice (must void + regenerate)
- Editing rollover commits (edit the originating commit)
- Changing the rate card (contract is pinned to its RC; create a new contract to change)

**⚠ Contract timestamp rule:** `starting_at`, `ending_before`, and scheduled
timestamps MUST snap to hour boundaries (`:00:00Z`). Non-zero mins/seconds
→ 400.

**⚠ Contract transitions:** `transition` on create creates a successor
contract that inherits context. Two types per openapi schema
(case-insensitive accepted, use UPPERCASE):

- `RENEWAL` - successor handoff. Per [Metronome docs](https://docs.metronome.com/pricing-packaging/apply-credits-commits)
  this single call should "end the current contract and all future
  recurring charges" - even mid-term ("Upgrade in the middle of the
  period: Create a new contract and set the start date to today's date.
  Specify the contract transition as a Renewal and pass the previous
  contract's ID"). **Only the defensive 2-step is verified here**
  (`updateEndDate` predecessor → `create` successor with `package_alias`
  + RENEWAL); single-call RENEWAL is doc-claimed but unverified for both
  end-dated and open-ended predecessors. Canary before relying on the
  single-call shape.
- `SUPERSEDE` - mid-term replacement that auto-truncates the predecessor.
  **DOES NOT WORK on package contracts.** Verified in production:
  `POST /v1/contracts/create` with `package_alias` +
  `transition.type: SUPERSEDE` returns
  `400 {"message":"Supersede transitions are not supported for package
  contracts"}`. SUPERSEDE also appears to be gated per tenant in the
  API spec, so it may not be available to you at all. Whether
  single-call SUPERSEDE works on direct contracts is **unverified**.

Optional `transition.future_invoice_behavior.trueup` =
`'remove' | 'as_is'` (default `as_is`) controls whether predecessor's
future trueup invoices are skipped. Only meaningful for POSTPAID
predecessors. See `metronome-packages-contracts § Transitions` for the
canonical payload and decision tree. In `/v2/contracts/list` response,
inspect `transitions[]` to detect downgrades/upgrades (the audit-sweep
pattern in `learnings.md` walks `transitions[].from_contract_id` +
`to_contract_id`).

---

## 10. Credits & Commits

| Stat | Method+Path | Purpose | Official docs |
|---|---|---|---|
| ? | `POST /v1/contracts/commits/create` | Customer-level commit (not contract-scoped) | [create-a-commit](https://docs.metronome.com/api-reference/credits-and-commits/create-a-commit.md) |
| ? | `POST /v1/contracts/credits/create` | Customer-level credit | [create-a-credit](https://docs.metronome.com/api-reference/credits-and-commits/create-a-credit.md) |
| ? | `POST /v1/contracts/commits/edit` | Edit a specific commit | [edit-a-commit](https://docs.metronome.com/api-reference/credits-and-commits/edit-a-commit.md) |
| ? | `POST /v1/contracts/credits/edit` | Edit a specific credit | [edit-a-credit](https://docs.metronome.com/api-reference/credits-and-commits/edit-a-credit.md) |
| ? | `POST /v1/contracts/commits/archive` | Archive a commit (requires voiding dependent invoices first) | [archive-a-commit](https://docs.metronome.com/api-reference/credits-and-commits/archive-a-commit.md) |
| ? | `POST /v1/contracts/credits/archive` | Archive a credit | [archive-a-credit](https://docs.metronome.com/api-reference/credits-and-commits/archive-a-credit.md) |
| ? | `POST /v1/contracts/customerCommits/list` | List commits for a customer. | [list-commits](https://docs.metronome.com/api-reference/credits-and-commits/list-commits) |
| ? | `POST /v1/contracts/customerCredits/list` | List credits for a customer. | [list-credits](https://docs.metronome.com/api-reference/credits-and-commits/list-credits) |
| ✓ | `POST /v1/contracts/customerBalances/list` | List balances (real-time) | [list-balances](https://docs.metronome.com/api-reference/credits-and-commits/list-balances.md) |
| ✓ | `POST /v1/contracts/customerBalances/getNetBalance` | Aggregated balance across any filter | [get-the-net-balance-of-a-customer](https://docs.metronome.com/api-reference/credits-and-commits/get-the-net-balance-of-a-customer.md) |
| ? | `POST /v1/contracts/seatBalances/list` | Per-seat balance breakdown. Body: `{ customer_id, contract_id, subscription_ids?, seat_ids?, include_credits_and_commits?, include_ledgers?, covering_date? XOR (starting_at+effective_before), limit?, cursor? }`. **NOT `listSeatBalances`** (old camelCase form 404s). | [list-seat-balances](https://docs.metronome.com/api-reference/credits-and-commits/list-seat-balances.md) |
| ? | `POST /v1/contracts/commits/updateEndDate` | Shorten a prepaid commit's end date | [update-the-commit-end-date](https://docs.metronome.com/api-reference/credits-and-commits/update-the-commit-end-date.md) |
| ? | `POST /v1/contracts/credits/updateEndDate` | Shorten a credit's end date | [update-the-credit-end-date](https://docs.metronome.com/api-reference/credits-and-commits/update-the-credit-end-date.md) |
| ? | `POST /v1/contracts/addManualBalanceLedgerEntry` | Manual ledger adjustment on a commit/credit. Required body: `{ customer_id, id (commit/credit UUID), segment_id (current segment UUID), amount, reason }`. `contract_id` optional; `per_group_amounts` optional for seat-managed commits. **`segment_id` is required** - look it up from the commit's current segment, you cannot omit. Path is under `/contracts/`, NOT `/contracts/commits/`. | [add-a-manual-balance-entry](https://docs.metronome.com/api-reference/credits-and-commits/add-a-manual-balance-entry.md) |
| ? | `POST /v1/contracts/commits/disableTrueup` | Skip postpaid trueup invoice | [disable-trueup-for-commit](https://docs.metronome.com/api-reference/credits-and-commits/disable-trueup-for-commit.md) |
| ✓ | `POST /v1/contracts/commits/threshold-billing/release` | Release/cancel an **external-payment-gate threshold commit**. Body: `{ workflow_id, outcome: "paid" \| "failed" }`. Returns `""` (empty string) on 200. **`workflow_id` only comes from `payment_gate.external_initiate` webhook - no API query can retrieve it.** NOT idempotent: 2nd call → HTTP 400 `"Workflow ... is not in COMMITTING state - is actually in state COMMITTED"`. After paid release: commit appears in `contracts/get`, invoice DRAFT→FINALIZED, `payment_gate.payment_status` fires `{ payment_status: "paid", invoice_id, timestamp }` - no `billing_provider` field for EXTERNAL. Credits accessible only after `access_schedule.starting_at`. | [release-external-payment-gate-threshold-commit](https://docs.metronome.com/api-reference/credits-and-commits/release-external-payment-gate-threshold-commit.md) |

**⚠ Recommended practice - contract-scoped commits via editContract:**
Use `POST /v2/contracts/edit` with `add_commits[]` rather than the
customer-level `commits/create`. Advantages: attached to the specific
contract, appears in `customerBalances/list` with `contract.id` field, clean
rollover semantics. See danger-zone §6 for the VERIFIED complimentary
commit payload. Two canonical shapes exist - pick per danger-zone §1.7:
- **No `invoice_schedule`** (pure access grant; the usual shape for
  complimentary credits and free-package grants)
- **`invoice_schedule` with USD `credit_type_id`** (audit $0 line or paid
  top-up)

**⚠ `invoice_schedule.credit_type_id` MUST be a fiat currency (FOOTGUN).**
On `add_commits[]`:
- `access_schedule.credit_type_id` → PRODUCT credit type; custom credit
  types are VALID
- `invoice_schedule.credit_type_id` → PAYMENT credit type; **fiat-only**
  (USD cents `2714e483-4ff1-48e4-9e25-ac732e8f24f2`). Custom credit type → `400 Credit type
  must be a fiat currency: <UUID>`

This is a dry-run blind spot - no Metronome read probe catches it. Run a
canary write before any bulk backfill. See `metronome-danger-zone` §1.7,
§1.8, §9 (bulk backfill incident).

**⚠ `add_commits[]` has no client-side idempotency key - dedupe by `name`.**
Retrying a script that already wrote a commit will create a duplicate
unless you pre-check `customerBalances/list` for a matching `name` on
the target contract, or set the commit's own `uniqueness_key` (1-128
characters; reuse returns 409). See `metronome-packages-contracts` for the
canary + idempotent bulk pattern.

**⚠ `rollover_fraction`:**
- `0` = use-it-or-lose-it
- `1` = carry over 100% of unused at contract boundary
- Fractional (e.g. `0.5`) = carry over 50%

**⚠ `priority`:** lower number = higher priority = applies FIRST. So a
commit with `priority: 1` burns before `priority: 2`. Tune to control which
commit burns first. Recommended practice for paid + complimentary: paid at
priority 1 (burns first, customer gets max value from what they paid for),
complimentary at priority 2 (burns second as a safety buffer).

**⚠ `applicable_product_tags`:** scopes which products a commit can be
spent against. If you list `["analytics", "exports"]`, the commit only
applies to usage tagged with at least one of those. Omit to
allow against all products on the contract.

---

## 11. Invoices

| Stat | Method+Path | Purpose | Official docs |
|---|---|---|---|
| ✓ | `GET /v1/customers/{customer_id}/invoices?limit=N&status=...` | List invoices (path-style, GET) | [list-invoices](https://docs.metronome.com/api-reference/invoices/list-invoices.md) |
| ✓ | `POST /v1/invoices/get` | Get one invoice (full line items) | [get-an-invoice](https://docs.metronome.com/api-reference/invoices/get-an-invoice.md) |
| ? | `GET /v1/customers/{customer_id}/invoices/{invoice_id}/pdf` | Get PDF | [get-an-invoice-pdf](https://docs.metronome.com/api-reference/invoices/get-an-invoice-pdf.md) |
| ? | `GET /v1/customers/{customer_id}/invoices/breakdowns` | Hourly/daily time-series breakdown. | [list-invoice-breakdowns](https://docs.metronome.com/api-reference/invoices/list-invoice-breakdowns.md) |
| ? | `POST /v1/invoices/preview` | Preview how events would affect invoices | [preview-events](https://docs.metronome.com/api-reference/invoices/preview-events.md) |
| ✓ | `POST /v1/invoices/void` | Void a **FINALIZED** invoice (does not refund Stripe) | [void-an-invoice](https://docs.metronome.com/api-reference/invoices/void-an-invoice.md) |
| ✓ | `POST /v1/invoices/regenerate` | Regenerate a VOIDED invoice with up-to-date rates/balances | [regenerate-an-invoice](https://docs.metronome.com/api-reference/invoices/regenerate-an-invoice.md) |

**⚠ Invoice state machine:** `DRAFT` → `FINALIZED` → `VOID` (see danger-zone §3).
- **No manual finalize endpoint exists.** Auto-finalize timing:
  - `USAGE`: period_end + grace period (about 24h by default)
  - `SCHEDULED` future-dated: subject to "Leave as drafts" setting
  - `SCHEDULED` past-dated (created via edit): **immediate, bypasses drafts setting**
- `void` fails on DRAFT with `400 Can't void invoice because its status is not finalized: DRAFT`.
- Voiding a Stripe-synced FINALIZED invoice does NOT refund Stripe. Creates Stripe↔Metronome reconciliation hole.

**⚠ Invoice list filters:** `status=DRAFT | FINALIZED | VOID` (uppercase),
`credit_type_id`, `starting_on`, `ending_before`, `sort=date_asc|date_desc`.

**⚠ Types of invoices you'll see in `list`:**
- `USAGE` - period-based consumption, auto-generated by Metronome
- `SCHEDULED` - plan fees, commit invoices, one-offs via `add_scheduled_charges`
- `AD_HOC` - manually created
- `PARENT_INVOICE` / `CHILD_INVOICE` - hierarchy aggregations

---

## 12. Payments

| Stat | Method+Path | Purpose | Official docs |
|---|---|---|---|
| ? | `POST /v1/invoices/payments/list` | List payment attempts for an invoice | [list-payments-for-an-invoice](https://docs.metronome.com/api-reference/payments/list-payments-for-an-invoice.md) |
| ? | `POST /v1/invoices/payments/attempt` | Force a new Stripe payment attempt | [attempt-payment-for-an-invoice](https://docs.metronome.com/api-reference/payments/attempt-payment-for-an-invoice.md) |
| ? | `POST /v1/invoices/payments/cancel` | Cancel a pending payment attempt | [cancel-a-payment-for-an-invoice](https://docs.metronome.com/api-reference/payments/cancel-a-payment-for-an-invoice.md) |

**⚠ Payment attempt preconditions** (all must be true):
1. Metronome invoice is FINALIZED
2. PLG invoicing enabled on the tenant
3. Stripe billing provider attached to the contract
4. No successful payment already on the invoice

---

## 13. Alerts / Threshold Notifications

| Stat | Method+Path | Purpose | Official docs |
|---|---|---|---|
| ✓ | `POST /v1/alerts/create` | Create threshold alert (low balance, spend, etc.) | [create-a-threshold-notification](https://docs.metronome.com/api-reference/alerts/create-a-threshold-notification.md) |
| ? | `POST /v1/alerts/get` | Get alert for a customer | [get-a-threshold-notification](https://docs.metronome.com/api-reference/alerts/get-a-threshold-notification.md) |
| ? | `POST /v1/alerts/list` | List all alerts for a customer | [get-all-threshold-notifications](https://docs.metronome.com/api-reference/alerts/get-all-threshold-notifications.md) |
| ? | `POST /v1/alerts/archive` | Archive (optionally release uniqueness key) | [archive-a-threshold-notification](https://docs.metronome.com/api-reference/alerts/archive-a-threshold-notification.md) |
| ? | `POST /v1/alerts/reset` | Force re-evaluation | [reset-a-threshold-notification](https://docs.metronome.com/api-reference/alerts/reset-a-threshold-notification.md) |

**⚠ CRITICAL incident source:** a "credits depleted" style notification
fired a webhook that a stale handler acted on: it set the contract to a
pending state, routed the user to a free-trial screen, and a paid customer
was downgraded (see danger-zone §9). When designing alert webhooks, make
handlers idempotent and contract-state-aware, and never initiate
downgrades without validating that the source contract isn't already
paid and active.

---

## 14. Offset / Lifecycle Notifications

| Stat | Method+Path | Purpose | Official docs |
|---|---|---|---|
| ? | `POST /v2/notifications/create` | Create offset-from-lifecycle notification (e.g. "7 days before contract end") | [create-an-offset-lifecycle-event-notification-configuration](https://docs.metronome.com/api-reference/notifications/create-an-offset-lifecycle-event-notification-configuration.md) |
| ? | `POST /v2/notifications/edit` | Edit | [edit-an-offset-lifecycle-event-notification-configuration](https://docs.metronome.com/api-reference/notifications/edit-an-offset-lifecycle-event-notification-configuration.md) |
| ? | `POST /v2/notifications/archive` | Archive | [archive-an-offset-lifecycle-event-notification-configuration](https://docs.metronome.com/api-reference/notifications/archive-an-offset-lifecycle-event-notification-configuration.md) |
| ? | `POST /v2/notifications/get` | Get one config | [get-an-offset-lifecycle-event-notification-configuration](https://docs.metronome.com/api-reference/notifications/get-an-offset-lifecycle-event-notification-configuration.md) |
| ? | `POST /v2/notifications/offset/list` | List offset notification configs (max 400/request) | [list-offset-lifecycle-event-notification-configurations](https://docs.metronome.com/api-reference/notifications/list-offset-lifecycle-event-notification-configurations.md) |
| ? | `POST /v2/notifications/system/list` | List available system event types | [list-system-notification-event-types](https://docs.metronome.com/api-reference/notifications/list-system-notification-event-types.md) |

**Deprecated:** `POST /v1/notifications/lifecycleEvents/*` and
`POST /v1/notifications/systemEvents/list` - do NOT use for new code. The
live openapi spec has moved all notification endpoints to `/v2/` and
renamed the list sub-paths to `/offset/list` and `/system/list`. Retained
here only for historical context; the old paths will 404.

---

## 15. Settings & Security

| Stat | Method+Path | Purpose | Official docs |
|---|---|---|---|
| ? | `POST /v1/listConfiguredBillingProviders` | Account-level billing providers + delivery method IDs | [list-account-level-billing-providers](https://docs.metronome.com/api-reference/settings/list-account-level-billing-providers.md) |
| ? | `POST /v1/setupAccountBillingProvider` | Configure account-level billing provider | [set-up-account-level-billing-provider](https://docs.metronome.com/api-reference/settings/set-up-account-level-billing-provider.md) |
| ? | `GET /v1/credit-types/list` | List pricing units (USD, GBP, custom credits). Current official docs use `/v1/credit-types/list`; older local notes called this `/v1/pricingUnits`. | [list-pricing-units](https://docs.metronome.com/api-reference/settings/list-pricing-units.md) |
| ? | `POST /v1/upsertAnrokApiToken` | Set Anrok tax API token. Body: `{ anrok_api_token: string, delivery_method_ids: string[] }` (**plural array**, not singular). Flat path - NO `/settings/` prefix. | [upsert-anrok-api-token](https://docs.metronome.com/api-reference/settings/upsert-anrok-api-token.md) |
| ? | `POST /v1/upsertAvalaraCredentials` | Set Avalara tax creds. Body: `{ avalara_environment: "PRODUCTION"\|"SANDBOX", avalara_username, avalara_password, commit_transactions?: bool, delivery_method_ids: string[] }` (**plural array**). Flat path - NO `/settings/` prefix. | [upsert-avalara-credentials](https://docs.metronome.com/api-reference/settings/upsert-avalara-credentials.md) |
| ? | `GET /v1/auditLogs?starting_on=...&ending_before=...&limit=...` | Full audit trail (UI + API + automation). Current official docs use `/v1/auditLogs`; older local notes called this `/v1/security/auditLogs`. | [get-audit-logs](https://docs.metronome.com/api-reference/security/get-audit-logs.md) |
| ? | `GET /v1/services` | Metronome service IP ranges (for firewall allowlisting). Current official docs use `/v1/services`; older local notes called this `/v1/security/services`. | [get-services](https://docs.metronome.com/api-reference/security/get-services.md) |

---

## 16. Paths guessed wrong

Keep this list so nobody retries. Each entry: the guess → what actually works.

| Wrong guess | Real endpoint |
|---|---|
| `POST /v1/invoices/updateIssueDate` | `POST /v1/contracts/updateInvoiceIssueDate` (path is under `/contracts/`, not `/invoices/`) |
| `POST /v1/invoices/finalize` | Doesn't exist; invoices auto-finalize (§11 timing rules). |
| `POST /v1/customers/invoices/list` | `GET /v1/customers/{customer_id}/invoices?limit=N` (path-style, GET) |
| `POST /v2/customers/get` | `GET /v1/customers/{customer_id}` (GET, no v2) |
| `POST /v1/customers/list` `{ customer_ids: [...] }` | `GET /v1/customers?customer_ids=id1&customer_ids=id2` (GET + query string) |
| `POST /v2/contracts/edit` with `update_contract_end_date` operation | `POST /v1/contracts/updateEndDate` (dedicated endpoint, cleaner schema) |
| `POST /v1/seats/list`, `/v2/seats/list`, `/v1/contracts/listSeats`, `/v1/contracts/listSeatBalances` | `POST /v1/contracts/seatBalances/list` |
| Custom field key `incident_ref` on a commit | Not whitelisted. Use `grant_reason` or call `POST /v1/customFields/addKey` first. |

---

## Appendix: Live verification

Smoke-check any endpoint above with `metro` instead of an ad-hoc script:

```bash
metro api explain contracts.list.v2 --json      # path, method, request contract
metro api validate contracts.list.v2 --file req.json --json
metro api read-plan contracts.list.v2 --file req.json --sandbox --json
```

Live reads still require the read gate and typed confirm token (see the
`metro` skill). Note the method split: customers and invoice listing are
GET with query strings; most other reads are POST with a JSON body.
