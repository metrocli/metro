---
name: metronome-pricing-catalog
description: >-
  Design, create, update, and troubleshoot the Metronome pricing catalog -
  products (USAGE / FIXED / SUBSCRIPTION / COMPOSITE / PROFESSIONAL_SERVICE),
  rate cards, rates (FLAT / PERCENTAGE / TIERED / SUBSCRIPTION / CUSTOM), and
  contract-level rate overrides. Use when the user says "product", "rate card",
  "addRates", "getRates", "override", "custom pricing", "FLAT", "TIERED",
  "PERCENTAGE", "SUBSCRIPTION rate", "pricing group", "presentation group",
  "rate type", "credit type conversion", "discount a customer", "entitled",
  "list rate vs commit rate", "product update", "archive a product", "Credits
  conversion line item", or asks how Metronome prices things, how to bump a
  rate, how to add a new product to a rate card, how to apply a custom
  discount to one customer, why Stripe shows a single "Credits conversion"
  line, or why `getRates` only returns 10 products. Do NOT use for packages or
  contract creation, or commits/credits schemas - that's
  metronome-packages-contracts.
---

# Metronome Pricing Catalog

> Before calling any Metronome endpoint, verify paths against
> `metronome-danger-zone/references/endpoint-matrix.md` §3 (Products) and §4
> (Rate Cards). If this skill and the endpoint-matrix disagree, the
> endpoint-matrix wins.

## Purpose

Fires whenever you need to model **what a customer pays for** in Metronome:
defining billable things (products), pricing them (rate cards + rates), and
selectively overriding prices for one contract (overrides). Does NOT cover
how those prices get attached to a customer - that's a package or contract
concern, and lives in `metronome-packages-contracts`.

## Prerequisites

See `skills/_metronome-shared/conventions.md` for base URL, auth,
credit type IDs, timestamp rules, pagination, and error-shape quick reference.
For **which bearer token** (sandbox vs production) and the preview-then-apply
flow, see the `metro` skill (`metro rate-card dimensional preview`,
`metro product retire preview`).

## Mental model

```
                   Billable Metric  (see metronome-ingestion-events)
                         │
                         ▼
 Product ─────────────────────────────► Rate Card ─────► Rate(s)
 (what appears on                       (catalog of      (FLAT / TIERED /
  the invoice line)                      prices)          PERCENTAGE /
                                                          SUBSCRIPTION /
                                                          CUSTOM)
                                             │
                                             ▼
                                        Contract  ─► add_overrides[]
                                        (contract-specific price changes:
                                         OVERWRITE / MULTIPLIER / TIERED)
```

- **Product** = the invoice line-item definition. Global in the tenant catalog.
- **Rate card** = a collection of priced products at a specific
  `starting_at`. A single rate card can serve many packages and many
  contracts.
- **Rate** = one `(product, starting_at)` pair on a rate card; rates are
  **append-only and time-sliced** - `addRates` schedules a change, never
  mutates in place.
- **Override** = a contract-scoped deviation from the rate card (e.g. "this
  one customer gets 50% off Analytics"). Lives on the contract, not the
  rate card.

## Endpoint inventory

### Products - `POST /v1/contract-pricing/products/*`

| Method + Path | Purpose | Official docs |
|---|---|---|
| `POST /v1/contract-pricing/products/create` | Create product | [create-a-product](https://docs.metronome.com/api-reference/products/create-a-product.md) |
| `POST /v1/contract-pricing/products/get` | Get one product (nested under `data.current` / `data.initial`) | [get-a-product](https://docs.metronome.com/api-reference/products/get-a-product.md) |
| `POST /v1/contract-pricing/products/list` | List (paginated) | [list-products](https://docs.metronome.com/api-reference/products/list-products.md) |
| `POST /v1/contract-pricing/products/update` | Schedule a product change (`starting_at` must snap to hour boundary) | [update-a-product](https://docs.metronome.com/api-reference/products/update-a-product.md) |
| `POST /v1/contract-pricing/products/archive` | Archive | [archive-a-product](https://docs.metronome.com/api-reference/products/archive-a-product.md) |

### Rate cards - `POST /v1/contract-pricing/rate-cards/*`

| Method + Path | Purpose | Official docs |
|---|---|---|
| `POST /v1/contract-pricing/rate-cards/create` | Create rate card | [create-a-rate-card](https://docs.metronome.com/api-reference/rate-cards/create-a-rate-card.md) |
| `POST /v1/contract-pricing/rate-cards/get` | Get rate card metadata (no rates) | [get-a-rate-card](https://docs.metronome.com/api-reference/rate-cards/get-a-rate-card.md) |
| `POST /v1/contract-pricing/rate-cards/list` | List all rate cards | [list-rate-cards](https://docs.metronome.com/api-reference/rate-cards/list-rate-cards.md) |
| `POST /v1/contract-pricing/rate-cards/getRates` | Rates at a timestamp, filter by `selectors[]` | [get-rates](https://docs.metronome.com/api-reference/rate-cards/get-rates.md) |
| `POST /v1/contract-pricing/rate-cards/getRateSchedule` | Full future/past rate schedule for all products | [get-a-rate-schedule](https://docs.metronome.com/api-reference/rate-cards/get-a-rate-schedule.md) |
| `POST /v1/contract-pricing/rate-cards/addRates` | Add scheduled rate changes (prefer plural; singular `addRate` exists but is heavily rate limited) | [add-rates](https://docs.metronome.com/api-reference/rate-cards/add-rates.md) |
| `POST /v1/contract-pricing/rate-cards/update` | Metadata-only update (name/description/aliases) | [update-a-rate-card](https://docs.metronome.com/api-reference/rate-cards/update-a-rate-card.md) |
| `POST /v1/contract-pricing/rate-cards/archive` | Archive | [archive-a-rate-card](https://docs.metronome.com/api-reference/rate-cards/archive-a-rate-card.md) |
| `POST /v1/contract-pricing/rate-cards/setRateCardProductsOrder` | Invoice product ordering (not `setProductOrder`) | [set-the-rate-card-products-order](https://docs.metronome.com/api-reference/rate-cards/set-the-rate-card-products-order.md) |

### Overrides (applied to a contract, not to the rate card itself)

| Method + Path | Purpose | Official docs |
|---|---|---|
| `POST /v2/contracts/edit` with `add_overrides[]` | Attach custom pricing to one contract | [edit-a-contract](https://docs.metronome.com/api-reference/contracts/edit-a-contract.md) |

> This skill owns the **shape** of `OverrideInputV2`. How to apply it - how
> to call `/v2/contracts/edit` in a loop, how to sequence it with commits,
> how to debug 400s from editContract - lives in `metronome-packages-contracts`.

## Products - the 5 types

Metronome's product model has one endpoint (`.../products/create`) that
creates any of **5 product types**. The stored type shows up in API responses
with the `*ListItem` discriminator (`UsageProductListItem`,
`FixedProductListItem`, …). On **create**, you pass the short-form enum:
`USAGE`, `FIXED`, `SUBSCRIPTION`, `COMPOSITE`, or `PROFESSIONAL_SERVICE`.

| Create enum | Response type | Purpose | Required (beyond `name` + `type`) |
|---|---|---|---|
| `USAGE` | `UsageProductListItem` | Metered consumption line | `billable_metric_id` |
| `FIXED` | `FixedProductListItem` | Flat-fee line (plan fee, one-off) | - (price lives on commit/scheduled charge) |
| `SUBSCRIPTION` | `SubscriptionProductListItem` | Seat / per-unit subscription | (none at product level - priced via rate card with `rate_type: SUBSCRIPTION` + `billing_frequency`) |
| `COMPOSITE` | `CompositeProductListItem` | Line derived from other products (e.g., 3% fee on all usage) | `composite_product_ids` OR `composite_tags` |
| `PROFESSIONAL_SERVICE` | `ProServiceProductListItem` | One-off services (implementation, training). **Client-gated** - not on by default. | - |

### Optional fields (any type unless noted)

| Field | Applies to | Purpose |
|---|---|---|
| `tags` | all | String tags consumed by `applicable_product_tags` on commits and overrides. E.g., `["Analytics"]`. |
| `pricing_group_key` | USAGE only | Property names that split pricing into dimensions. `["region"]` → one rate per region value. |
| `presentation_group_key` | USAGE only | Property names that split **display** (invoice line grouping) without splitting pricing. |
| `quantity_conversion` | USAGE only | `{ conversion_factor, operation: "multiply" \| "divide", name? }` - convert event quantity before pricing. |
| `quantity_rounding` | USAGE only | `{ rounding_method: "round_up" \| "round_down" \| "round_half_up", decimal_places: ≥0 }`. |
| `composite_scope` | COMPOSITE | `CUSTOMER` or `CONTRACT` (default `CONTRACT`). |
| `exclude_free_usage` | COMPOSITE | Drop $0 members (beta). |
| `is_refundable` | all | Default `true`; client-gated. |

### Create a USAGE product

```js
await m.post('/v1/contract-pricing/products/create', {
  name: '<PRODUCT_NAME>',
  type: 'USAGE',
  billable_metric_id: '<METRIC_ID>',
  tags: ['<TAG>'],
});
// Response: { data: { id: '<PRODUCT_ID>' } }
```

### Dimensional action pricing pattern

When many product actions share one credit or price model, a clean
customer-facing pattern is one dimensional usage product:

```js
await m.post('/v1/contract-pricing/products/create', {
  name: 'Credits Consumed',
  type: 'USAGE',
  billable_metric_id: '<BM_WITH_ACTION_CODE_AND_DISPLAY_NAME_GROUP_KEY>',
  tags: ['Analytics', 'Reports'],
  pricing_group_key: ['action_code'],
  presentation_group_key: ['action_display_name'],
});
```

This creates **one** usage product instead of one product per action:

- `pricing_group_key: ['action_code']` keeps pricing stable and backend-safe
  (`ACT-001`, `REPORT-EXPORT`, etc.).
- `presentation_group_key: ['action_display_name']` lets invoices show a
  human label such as `Export a report`.
- The billable metric must have the compound
  `group_keys: [['action_code', 'action_display_name']]`; separate
  `[['action_code'], ['action_display_name']]` group keys do not satisfy the
  product validator (sandbox-verified). See `metronome-ingestion-events`.
- The ingestion/backend must emit **both** properties on every billable event.
  If `action_display_name` is missing, the event is filtered out of this metric
  if the metric uses `{ name: 'action_display_name', exists: true }`.
- `getRates` rows will still look like repeated `Credits Consumed` rows
  with different `pricing_group_values.action_code`; that is expected. The
  friendly name is event-driven presentation data, not the rate row name.

Do not use `action_code` as the only `presentation_group_key` if you want
customer-visible names. It will show codes, not names. In `metro`, preview
this shape with `metro rate-card dimensional preview --file <input.json> --sandbox --json`.

### Create a FIXED product

```js
await m.post('/v1/contract-pricing/products/create', {
  name: '<PLAN_FEE_NAME>',
  type: 'FIXED',
});
```

FIXED products don't get priced via `addRates` - their price is set on the
commit, recurring commit, or scheduled charge that references them. **FIXED
products cannot be priced via `createHistoricalInvoices`** (see
`metronome-invoicing` for migration patterns).

### Create a SUBSCRIPTION product

```js
await m.post('/v1/contract-pricing/products/create', {
  name: 'Platform Seat',
  type: 'SUBSCRIPTION',
});
```

The product itself is trivial. All the pricing and billing-frequency config
lives on the **rate** (`rate_type: SUBSCRIPTION`, `billing_frequency`,
`is_prorated`) - see `references/rate-types.md`.

### Create a COMPOSITE product

```js
await m.post('/v1/contract-pricing/products/create', {
  name: 'Platform fee (3% of usage)',
  type: 'COMPOSITE',
  composite_tags: ['Analytics', 'Reports'],
  composite_scope: 'CONTRACT',
});
```

Pair this product with a `PERCENTAGE` rate to charge `price × subtotal` of
all usage on the referenced tags. Alternative: `composite_product_ids` for
exact product targeting.

### Create a PROFESSIONAL_SERVICE product

```js
await m.post('/v1/contract-pricing/products/create', {
  name: 'Onboarding implementation',
  type: 'PROFESSIONAL_SERVICE',
});
```

Client-gated - if the tenant isn't flagged, create returns a 400. Priced via
`professional_services[]` on contract create or
`POST /v1/contracts/scheduleProServicesInvoice`.

### `get` response - `data.current` vs `data.initial`

Product GET responses nest data under two keys:

```js
const r = await m.post('/v1/contract-pricing/products/get', { id: '<PRODUCT_ID>' });
const current = r.data.current;   // current active version
const initial = r.data.initial;   // state at creation time
console.log(current.name, current.tags);  // ✓
console.log(r.data.name);                 // ✗ undefined - top-level has no name
```

Scheduled future
updates live on `data` as well - fetch `getRateSchedule` (rate-card-scoped)
or `editHistory` (contract-scoped) for audit history of changes.

### Update a product (scheduled change)

```js
await m.post('/v1/contract-pricing/products/update', {
  product_id: '<PRODUCT_ID>',
  starting_at: '2026-05-01T00:00:00.000Z',  // MUST be hour boundary
  name: '<NEW_NAME>',                        // optional - any updatable field
  tags: ['<NEW_TAG>'],                       // replaces (not merges) tags
  billable_metric_id: '<NEW_METRIC_ID>',   // USAGE only
});
```

Mutable: `name`, `billable_metric_id` (USAGE), `composite_product_ids`,
`composite_tags`, `tags`, group keys, `quantity_conversion`,
`quantity_rounding`, `is_refundable`, NetSuite IDs.
**Immutable: `type`.** (If you picked USAGE and want FIXED, archive + recreate.)

> **Scheduled renames & `getRates` display name caching.** `products/update`
> with a future `starting_at` DOES take effect (sandbox-verified: invoices
> from the scheduled hour onward showed the new name). BUT: `rate-cards/getRates` surfaces the
> **current** display name in its `product_name` response field, not the
> name-at-timestamp. To verify a scheduled rename is in place, call
> `products/get` on the product id and inspect `data.updates[]` - don't
> rely on `getRates` output for name verification. Customer-visible
> rename timing is correct; ops verification is fragile.

### One product per billable metric per rate card - a YOU invariant, not Metronome's

Metronome has **no invariant** preventing two different products, both
`entitled: true`, both referencing the same `billable_metric_id`, from
coexisting on the same rate card. If that happens, every matching event
gets priced TWICE - once per product (see Shape A drift below). The
invariant is yours to enforce in scripts and pre-flight audits.

## Rate cards

### Create a rate card with custom credit conversion

```js
await m.post('/v1/contract-pricing/rate-cards/create', {
  name: '<RATE_CARD_NAME>',
  description: '<DESCRIPTION>',
  fiat_credit_type_id: '2714e483-4ff1-48e4-9e25-ac732e8f24f2',  // USD cents (see conventions.md)
  credit_type_conversions: [{
    custom_credit_type_id: '<CUSTOM_CREDIT_TYPE_ID>',
    fiat_per_custom_credit: 1,  // 1 credit = 1 cent = $0.01
  }],
  aliases: [{ name: '<RATE_CARD_ALIAS>' }],
});
```

For a **USD-only** rate card, omit `credit_type_conversions` entirely and
price every rate in USD cents via
`credit_type_id: '2714e483-4ff1-48e4-9e25-ac732e8f24f2'`.

### Add rates (ALWAYS plural)

```js
await m.post('/v1/contract-pricing/rate-cards/addRates', {
  rate_card_id: '<RATE_CARD_ID>',
  rates: [
    {
      product_id: '<USAGE_PRODUCT_ID>',
      starting_at: '2020-01-01T00:00:00.000Z',
      entitled: true,
      rate_type: 'FLAT',
      price: 250,                                     // integer in credit_type units
      credit_type_id: '<CUSTOM_CREDIT_TYPE_ID>',
    },
    // ...up to hundreds per call
  ],
});
```

Full schema for each `rate_type` lives in `references/rate-types.md`.

> **Prefer `addRates` (plural) even for one rate.** The singular
> `POST /v1/contract-pricing/rate-cards/addRate` exists, but the docs mark it
> heavily rate limited and strongly encourage `addRates`. Whichever you use,
> read back with `getRates` before declaring success; a 200 alone is not proof.

Rates are append-only: a second `addRates` call with the same
`(product_id, starting_at)` **replaces** the previous rate at that time.
Earlier `starting_at` values stay as history - use `getRateSchedule` to see
the full timeline.

### `getRates` - filter by timestamp + selectors

```js
const r = await m.post('/v1/contract-pricing/rate-cards/getRates', {
  rate_card_id: '<RATE_CARD_ID>',
  at: new Date().toISOString(),
  selectors: [{ product_id: '<PRODUCT_ID>' }],
});
const rate = r.data[0].rate;
//   { price, rate_type, credit_type, credit_type_id }
```

### `getRates` pagination (observed behavior)

Docs ([get-rates](https://docs.metronome.com/api-reference/rate-cards/get-rates.md))
take `limit` and `next_page` as **query-string** params. In practice, pages
have been observed to come back much smaller than the requested `limit`
(around 10 products), and the `next_page` token has been observed to loop
back to the same data after one or two iterations. If you naively loop
`while (next_page)` you can burn API calls or wrongly conclude the rate card
has only ~10 products. Code defensively:

```js
// Defensive pagination: query-string paging, hard cap, loop detection
let nextPage = undefined;
const seen = new Set();
for (let i = 0; i < 200; i++) {   // hard cap
  const qs = new URLSearchParams({ limit: '100', ...(nextPage && { next_page: nextPage }) });
  const r = await m.post(`/v1/contract-pricing/rate-cards/getRates?${qs}`, {
    rate_card_id, at,
  });
  for (const row of r.data) {
    if (seen.has(row.product_id)) break;   // break on repeat → token looped
    seen.add(row.product_id);
  }
  const tok = r.next_page;
  if (!tok || tok === nextPage) break;
  nextPage = tok;
}
```

**Safer paths** for listing everything on a rate card:
- `getRateSchedule` - returns the full schedule without the 10-per-page cap
- Target specific products with `selectors: [{ product_id }]` (one call per
  product) when you know the product IDs already
- **The Metronome UI correctly shows all products** - trust it for manual
  verification during ops work

### Rate overrides - `add_overrides` on a contract

Overrides attach custom pricing (discount, multiplier, tiered rate) to one
contract without touching the rate card. Shape of each entry in
`add_overrides[]` on `/v2/contracts/edit`:

```js
{
  starting_at: '2026-04-01T00:00:00.000Z',   // hour boundary
  ending_before: '2027-04-01T00:00:00.000Z', // optional; exclusive
  entitled: true,                             // optional - toggle entitlement
  type: 'OVERWRITE' | 'MULTIPLIER' | 'TIERED',

  // targeting - EXACTLY ONE of these three groups:
  product_id: '<PRODUCT_ID>',                                        // (a)
  // OR
  applicable_product_tags: ['<TAG>'],                                  // (b) - not for OVERWRITE
  // OR
  override_specifiers: [{ product_id, billing_frequency, pricing_group_values }],  // (c) complex targeting

  // type-specific payload:
  multiplier: 0.5,                         // required for MULTIPLIER (0.5 = 50% off)
  overwrite_rate: { rate_type: 'FLAT', price: 0, credit_type_id: '<USD_CENTS_ID>' },  // required for OVERWRITE
  tiers: [{ size: 1000, multiplier: 1.0 }, { multiplier: 0.8 }],       // required for TIERED

  priority: 1,                             // required under EXPLICIT prioritization and for ALL TIERED overrides
  is_commit_specific: false,               // applies only while burning a commit
  target: 'LIST_RATE',                     // LIST_RATE (default) | COMMIT_RATE - only with is_commit_specific: true
}
```

Key rules:
- **Targeting is mutually exclusive**: `product_id` XOR `applicable_product_tags` XOR `override_specifiers`. Passing more than one returns 400.
- `OVERWRITE` cannot target via `applicable_product_tags` - must use `product_id` or `override_specifiers`.
- **TIERED overrides force `EXPLICIT` prioritization** at the contract level.
  `multiplier_override_prioritization` is **create-only on the contract** -
  if the contract was created with the default `LOWEST_MULTIPLIER`, a TIERED
  override will fail. Must be set when you create the contract (or the
  package that spawned it).
- **Overrides have no update op.** To change one: remove + re-add in the
  same `/v2/contracts/edit` call.
- **Subscription-rate overrides** must use `override_specifiers` and pass
  BOTH `product_id` AND `billing_frequency`:
  ```js
  override_specifiers: [{
    product_id: '<SEAT_PRODUCT_ID>',
    billing_frequency: 'MONTHLY',
  }],
  entitled: true,
  ```
  A common pattern: the rate card sets `entitled: false` on the rate, then
  each package or contract adds an override flipping `entitled: true`.

> **How to actually call `/v2/contracts/edit`** - error handling,
> transitioned-contract failures, retry with archive contracts - lives in
> `metronome-packages-contracts`. This skill owns the override **shape**
> only.

## Custom credit types vs USD pricing - the Stripe line-item collapse

Two catalog architectures; the choice is **architectural, not a setting**.

### Architecture A: custom credit type (e.g., "Credits")

- Rate card prices each product in credits (`credit_type_id: <CUSTOM_CREDIT_TYPE_ID>`)
- `credit_type_conversions[]` on the rate card converts credits → USD
- Invoices generated by Metronome:
  - **Metronome USAGE invoice** shows per-product detail with credit prices ✓
  - **Stripe invoice** collapses ALL per-product usage into a single
    `"Credits conversion"` line item with a total USD amount ✗

> **Transparency issue (observed)**: customers on Stripe cannot
> see which actions drove their overage. Metronome's "Display sub-line
> items" and "Always display quantities" settings do NOT fix this - the
> collapse happens in the conversion step, not the display layer. If
> per-product detail on Stripe matters, use Architecture B.

### Architecture B: USD-only rate card

- No `credit_type_conversions` on the rate card
- Every rate uses `credit_type_id: <USD_CENTS_ID>` and `price` in cents
- Invoices:
  - Metronome USAGE invoice ✓
  - Stripe invoice preserves per-product line items ✓

### Decision tree

- Multiple tiers with different overage USD rates, same underlying
  credit model? → Architecture A, one rate card per tier with different
  `fiat_per_custom_credit` (e.g. one rate card per tier, one
  `fiat_per_custom_credit` per tier, same credit prices per product).
- Single pricing regime, customers need Stripe line-item detail? →
  Architecture B.
- Migrating an existing tenant? → Keep Architecture A unless you have a
  strong reason to migrate - moving from credit → USD rates is a full
  catalog rebuild.

## Decision trees

### "Which rate_type do I need?"

- Customer pays `$X` per event / per unit (simple metered) → `FLAT`
- Price scales with aggregate value (e.g., 3% of transaction amount) →
  `PERCENTAGE` on a COMPOSITE product
- Price drops as customer grows (volume discount: first 1K at $Y, next 10K
  at $Y*0.8) → `TIERED`
- Customer pays per seat / per user / per license per month/year →
  `SUBSCRIPTION` on a SUBSCRIPTION product + `billing_frequency`
- You need Metronome to emit a raw rate blob for a downstream processor
  (tax engine, custom billing adapter) to interpret → `CUSTOM` (client-gated)

See `references/rate-types.md` for exact schemas.

### "Discount one customer for 3 months - override or new rate card?"

- Single customer, bounded in time → **override** via `add_overrides` on that
  contract
- Every customer in a tier → **new rate card** OR change the rate on the
  existing rate card (new `starting_at`) via `addRates`
- Single customer, permanent → still prefer **override** (cleaner audit
  trail); a per-customer rate card fragments the catalog

### "Free product for one customer"

Two patterns, both valid:

```js
// A: OVERWRITE with price: 0
{ type: 'OVERWRITE', product_id: '<P>', overwrite_rate: { rate_type: 'FLAT', price: 0, credit_type_id: '<USD>' }, starting_at: '...' }

// B: MULTIPLIER with 0
{ type: 'MULTIPLIER', product_id: '<P>', multiplier: 0, starting_at: '...' }
```

`MULTIPLIER 0` preserves the underlying rate for audit (`list_rate` shows
the real price, `unit_price` shows `0`). `OVERWRITE` replaces entirely.
Prefer `MULTIPLIER` for temporary promos; prefer `OVERWRITE` when you want
downstream systems to see `0` as the list price.

## Retiring a product - archive ≠ remove from rate card

Per the [archive-a-product docs](https://docs.metronome.com/api-reference/products/archive-a-product.md):

> "Any current rate cards associated with this product will continue to
>  function as normal. However, it will no longer be available as an
>  option for newly created rates."

Archive is a guard against **future** `addRates` calls. It does **not**
retire the product's existing `entitled=true` rate entries - those keep
aggregating events and producing invoice lines:

- At `price: 0` → visible `qty=N × 0` **ghost line** on USAGE invoices
- At non-zero price → customer still gets charged

**There is no `removeRate` endpoint.** Correct retirement sequence:

1. For **every** rate card the product appears on, call `addRates` with
   `entitled: false, price: 0` at the cutover `starting_at`. Metronome
   auto-closes the prior open rate for that product.
2. `POST /v1/contract-pricing/products/archive` - prevents future
   rate-card re-additions (catalog hygiene).
3. Optional: `POST /v1/billable-metrics/archive` on the BM if no other
   product references it.

**Skipping step 1** is the common mistake. In one sandbox run, a retired
product was archived but every rate card kept its `entitled=true` entries,
and one still carried an out-of-date non-zero price that would have billed
any customer still emitting the dead action. It was caught only when an
end-to-end sandbox invoice showed the ghost line. In `metro`, use
`metro product retire preview --file <input.json> --sandbox --json`, which
closes rate-card entries before the archive.

## Rate card drift - two shapes to catch in pre-flight

The catalog can drift into states Metronome will happily bill from but
that produce confusing invoices, double-billing, or silent misrouting.

### Shape A - product shadowers on the same billable metric

Two different products reference the **same** `billable_metric_id`,
both `entitled=true`, both open-ended on the same rate card. Every
matching event prices against BOTH products.

- Detection: group rate card entries by `(billable_metric_id,
  pricing_group_values)` and flag any group with >1 entitled entry
- Remediation: pick the survivor; run `addRates` with `entitled: false,
  price: 0` on the shadower at the cutover `starting_at`; archive the
  shadower product

### Shape B - action code served by multiple billable metrics

A single `action_code` value is filtered on by TWO or more billable
metrics (e.g. a legacy `SUM(credit_amount)` metric and a modern `COUNT`
metric, both filtering `action_code IN ['ACT-001']`). The legacy metric
may be dormant only because the backend's event contract no longer emits
the property it filters on - one schema change away from re-activating
and producing duplicate invoice lines.

- Detection: iterate every active billable metric; bucket by
  `property_filters[name=action_code].in_values`; flag any code with >1
  BM
- Remediation: archive the dormant BM AND close its zero-priced rate
  entries on every rate card (Shape A sub-remediation applies)

### The "update in place" rule that prevents both shapes

When changing an action's name, rate, tags, or aggregation for an
existing action code, call `products/update` on the **existing**
product and `addRates` on each rate card. Don't create a new product
unless you are changing `type` (the only immutable field). The same
rule applies to billable metrics: only `name` is mutable, so a genuine
aggregation change needs a new BM - in that case, perform the full
shadower-cleanup as part of the same change. Recommended practice, not an
API rule.

## Edge cases & gotchas

1. **Prefer `addRates` over `addRate`.** The singular endpoint is heavily
   rate limited per docs. Always read back with `getRates`.
2. **`getRates` pagination loops (observed).** Pages have come back with
   ~10 products regardless of `limit`, and `next_page` can return the same
   token after 1-2 iterations. Detect loops on the token, cap iterations, or use
   `getRateSchedule` instead.
3. **Product update `starting_at` must snap to hour boundary** (`:00:00Z`).
   Non-zero minutes/seconds → 400. Same rule as contracts (see
   `conventions.md`).
4. **`data.current` vs top-level on product GET.** `r.data.name` is
   `undefined`; use `r.data.current.name` (or `r.data.initial.name` for
   creation-time state).
5. **Product `type` is immutable.** To change from USAGE to FIXED (etc.),
   archive the old product and create a new one. Any rates/overrides
   referencing the old product must be re-pointed.
6. **Rates table is append-only.** `addRates` with the same
   `(product_id, starting_at)` replaces the rate at that timestamp; earlier
   rows remain as history. To "undo" a rate bump, `addRates` with the same
   `starting_at` and the old price.
7. **Subscription products are trivial; subscription rates are not.** The
   product itself needs no special fields; all the `billing_frequency`,
   `is_prorated`, `quantity` live on the **rate**. See
   `references/rate-types.md` §SUBSCRIPTION. Attaching a SUBSCRIPTION
   product to a contract additionally requires setting `entitled: true` via
   an override (packages commonly ship the rate with `entitled: false`, then
   each contract flips it).
8. **TIERED overrides require `EXPLICIT` prioritization** on the contract,
   which is **create-only** - can't be set via editContract. If you need
   TIERED overrides, bake the prioritization into the package or direct
   contract at create time.
9. **Overrides have no update op** - remove + re-add in one edit call to
   avoid a pricing gap.
10. **Override targeting is mutually exclusive.** `product_id`,
    `applicable_product_tags`, `override_specifiers` - pass exactly one
    group. `OVERWRITE` cannot use `applicable_product_tags`.
11. **Subscription rate overrides need BOTH `product_id` and
    `billing_frequency`** inside `override_specifiers`. A product can map to
    multiple subscription rates (MONTHLY + ANNUAL on the same rate card) -
    `billing_frequency` disambiguates.
12. **Custom credit → USD collapses to a single Stripe line item.** This is
    not a settings issue; it's architectural. Use a USD-cents rate card if
    you need per-product transparency on Stripe invoices.
13. **PROFESSIONAL_SERVICE and some `rate_type`s are client-gated or
    feature-flagged.** If `create` returns 400 for `type:
    PROFESSIONAL_SERVICE`, or `addRates` returns 400 for `rate_type:
    CUSTOM` / `SUBSCRIPTION` / `TIERED_PERCENTAGE`, confirm the tenant has
    the flag enabled before debugging payload shape.
14. **Archiving a rate card** leaves existing contracts pinned to the old
    rate card untouched - safe to archive retired pricing models once no new
    packages/contracts reference them. `POST /v1/contract-pricing/rate-cards/archive` takes `{ id }`.
15. **Rate card is immutable on a contract.** You cannot swap rate cards
    via editContract - creating a new contract is the only way. Plan rate
    card migrations accordingly (see `metronome-packages-contracts` for the
    transition pattern).
16. **Product `name` appears on customer invoices.** Billable metric
    `name` and product `tags` do NOT. If you need internal tracing
    breadcrumbs (backend action codes, team ownership, source system
    IDs), put them on the BM name or product tags, **never** on the
    product name. Shipping "Export a report - ACT-001" on a
    customer invoice is a leak; "Export a report" with BM
    name "REPORT_EXPORT - ACT-001" is the recommended pattern.
17. **Scheduled rename display-name caching in `getRates`.**
    `products/update` with a future `starting_at` correctly applies
    at the scheduled timestamp (customer invoices show the new name
    from then on). But `rate-cards/getRates` surfaces the **current**
    display name in its `product_name` response field - so a rename
    scheduled at T+1h will not appear in `getRates` output until
    T+1h, even if you pass `at: T+2h`. To verify a scheduled rename
    is in place, use `products/get` and inspect `data.updates[]`.

## Cross-references

- `metronome-danger-zone` - endpoint-matrix is the source of truth for all
  paths referenced above; check §3 (Products) and §4 (Rate Cards).
- `metronome-ingestion-events` - every USAGE product needs a
  `billable_metric_id`; events and billable metric basics live there.
- `metronome-packages-contracts` - how rate cards attach to packages and
  contracts, and the **mechanics** of `/v2/contracts/edit` for applying
  overrides (this skill owns the override **shape**; that skill owns the
  editContract call site).
- `metronome-packages-contracts` also covers commits and credits, whose
  definitions reference `product_id` + `applicable_product_tags` from this
  catalog. A complimentary grant is a credit (or a commit with no
  `invoice_schedule`), not an override.
- `metronome-invoicing` - how product line items surface on
  USAGE/SCHEDULED invoices; how the "Credits conversion" collapse appears
  on Stripe-delivered invoices.
- `metronome-subscriptions-seats` - SubscriptionProduct type, seat
  quantity updates, seat history queries.

## When NOT to use this skill

- Creating a **package** or **contract** that consumes a rate card → use
  `metronome-packages-contracts`
- Defining the **billable metric** that a USAGE product references → use
  `metronome-ingestion-events`
- Attaching a **commit or credit** that spends against tagged products →
  use `metronome-packages-contracts`
- Calling `/v2/contracts/edit` for anything other than `add_overrides`
  shape questions (e.g., `add_commits`, `update_contract_end_date`) → use
  `metronome-packages-contracts`
- Troubleshooting why a rate appears correctly in Metronome but the Stripe
  invoice total is wrong → use `metronome-stripe-delivery` (+ this skill
  for the rate definition itself)
