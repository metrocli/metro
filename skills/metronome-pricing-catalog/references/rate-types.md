# Rate Types - Full Schemas

Every `addRates` and `overwrite_rate` payload must pick exactly one
`rate_type`. Schemas differ meaningfully; this file is the per-type cheat
sheet.

Shared rules (apply to every rate regardless of type):

| Field | Notes |
|---|---|
| `product_id` | UUID of an existing product. USAGE/FIXED/SUBSCRIPTION/COMPOSITE/PROFESSIONAL_SERVICE all allowed - but see per-type compatibility below. |
| `starting_at` | RFC 3339 UTC; must snap to hour boundary (`:00:00Z`). |
| `ending_before` | Optional; exclusive. Omit for open-ended. |
| `entitled` | `true` enables billing on this rate card; `false` is a common pattern for SUBSCRIPTION rates that get flipped `true` per contract via an override. |
| `credit_type_id` | Required for **non-`PERCENTAGE`** types. USD cents = `2714e483-4ff1-48e4-9e25-ac732e8f24f2`. |
| `commit_rate` | Optional - an alternate rate used when consuming a commit/credit. Same schema as `Rate` minus `billing_frequency`. `SUBSCRIPTION` and `PERCENTAGE` on `commit_rate` are client-gated. |
| `pricing_group_values` | Optional `{ property_name: value }` map; defines this specific rate for a dimension combo (e.g., `{ region: "us-east-1" }`). Only for USAGE products with `pricing_group_key` set. |

All 5 types are documented in the official [add-rates docs](https://docs.metronome.com/api-reference/rate-cards/add-rates.md).
A 6th type - `TIERED_PERCENTAGE` - exists but is feature-flagged; mention
at the bottom.

---

## 1. `FLAT`

Fixed price per unit of quantity. The workhorse type for most usage
pricing.

| Field | Type | Req | Notes |
|---|---|---|---|
| `rate_type` | `"FLAT"` | ✅ | |
| `price` | integer ≥ 0 | ✅ | In `credit_type_id` units (cents for USD, raw credits for custom). |
| `credit_type_id` | UUID | ✅ | |

Compatible products: USAGE, FIXED, COMPOSITE. (FIXED products don't
typically need a rate - their price is set on the commit/scheduled charge -
but a rate is not rejected.)

```js
{
  product_id: '<USAGE_PRODUCT_ID>',
  starting_at: '2026-01-01T00:00:00.000Z',
  entitled: true,
  rate_type: 'FLAT',
  price: 250,                                   // 250 credits per billable unit
  credit_type_id: '<CUSTOM_CREDIT_TYPE_ID>',
}
```

---

## 2. `PERCENTAGE`

Price = `price × subtotal`. Used with a COMPOSITE product to charge a % of
usage (e.g., "3% platform fee on all Analytics usage"). Also valid on
USAGE products when the aggregated value is itself money-like.

| Field | Type | Req | Notes |
|---|---|---|---|
| `rate_type` | `"PERCENTAGE"` | ✅ | |
| `price` | number 0-1 | ✅ | Decimal fraction. `0.03` = 3%. NOT basis points. |
| `credit_type_id` | UUID | ✗ | **N/A** - per docs "PERCENTAGE rates use the credit type of associated rates." Metronome ignores any `credit_type_id` you pass; don't rely on it. |
| `minimum_config` | `{ minimum: number }` | no | Flag-gated (`ff:support-charge-ga`); floor on the charged amount. |

```js
{
  product_id: '<COMPOSITE_PRODUCT_ID>',
  starting_at: '2026-01-01T00:00:00.000Z',
  entitled: true,
  rate_type: 'PERCENTAGE',
  price: 0.03,                                  // 3%
}
```

Best paired with a COMPOSITE product whose `composite_tags` or
`composite_product_ids` define the base subtotal.

---

## 3. `TIERED`

Volume pricing: price varies by quantity bucket. Each tier has a `size`
(exclusive upper bound) and a `price`. The last tier typically omits `size`
(unbounded).

| Field | Type | Req | Notes |
|---|---|---|---|
| `rate_type` | `"TIERED"` | ✅ | |
| `tiers` | `Tier[]` | ✅ | Each: `{ size?: number, price: number }`. Ascending `size`. |
| `credit_type_id` | UUID | ✅ | |

```js
{
  product_id: '<USAGE_PRODUCT_ID>',
  starting_at: '2026-01-01T00:00:00.000Z',
  entitled: true,
  rate_type: 'TIERED',
  credit_type_id: '<USD_CENTS_ID>',
  tiers: [
    { size: 1000,  price: 10 },   // first 1,000 units @ $0.10
    { size: 10000, price: 8  },   // next 9,000 units @ $0.08
    {              price: 5  },   // everything beyond @ $0.05
  ],
}
```

- Tiers are **bucketed**, not marginal by default. Metronome sums usage in
  each tier and multiplies by that tier's price.
- `TIERED` **rate overrides** use `{ size?, multiplier }` - not
  `{ size?, price }`. Overrides apply a per-tier multiplier to the
  underlying rate-card tiers.
- TIERED overrides require the contract to have
  `multiplier_override_prioritization: "EXPLICIT"`, which is create-only on
  the contract. Plan for this upfront.

---

## 4. `SUBSCRIPTION`

Per-seat / per-unit recurring charge with billing frequency. Used with
SUBSCRIPTION products (Platform Seat, License, etc.).

| Field | Type | Req | Notes |
|---|---|---|---|
| `rate_type` | `"SUBSCRIPTION"` | ✅ | |
| `price` | integer ≥ 0 | ✅ | Per-unit per-period price, in `credit_type_id` units. |
| `billing_frequency` | enum | ✅ | `MONTHLY`, `QUARTERLY`, `ANNUAL`, `WEEKLY`. |
| `quantity` | number | conditional | Only if priced per-quantity instead of per-seat; typically omit and let the subscription's `initial_quantity` / `seat_updates` drive it. |
| `is_prorated` | boolean | conditional | If set, must be `true`. |
| `credit_type_id` | UUID | ✅ | |

```js
// Common pattern: seat rate added with entitled: false, then each
// contract flips entitled: true via override.
{
  product_id: '<SEAT_PRODUCT_ID>',
  starting_at: '2020-01-01T00:00:00.000Z',
  entitled: false,
  rate_type: 'FLAT',                            // a $0 attribution-only seat can use FLAT, not SUBSCRIPTION.
  price: 0,
  credit_type_id: '<USD_CENTS_ID>',
  billing_frequency: 'MONTHLY',                 // still required to attach product as a subscription
}
```

> **Note**: a free, attribution-only seat can use `rate_type: FLAT`
> with `price: 0` + `billing_frequency: MONTHLY`, not `rate_type:
> SUBSCRIPTION`. Both shapes make the product work as a subscription; the
> canonical Metronome shape for a paid seat is `rate_type: SUBSCRIPTION`. If
> you're adding a paid seat tier from scratch, use the canonical shape.

Override targeting for subscription rates **must use `override_specifiers`**
with BOTH `product_id` AND `billing_frequency` (one product may have
multiple subscription rates - MONTHLY + ANNUAL).

---

## 5. `CUSTOM`

Free-form rate blob, interpreted by a downstream client processor (e.g., a
custom billing adapter or tax engine). **Client-gated** - tenant must have
the capability turned on.

| Field | Type | Req | Notes |
|---|---|---|---|
| `rate_type` | `"CUSTOM"` | ✅ | |
| `custom_rate` | object (free-form) | ✅ | Opaque to Metronome; Metronome records the blob and emits it with invoice line items. |
| `credit_type_id` | UUID | ✅ | |

```js
{
  product_id: '<PRODUCT_ID>',
  starting_at: '2026-01-01T00:00:00.000Z',
  entitled: true,
  rate_type: 'CUSTOM',
  credit_type_id: '<USD_CENTS_ID>',
  custom_rate: {
    formula: 'graduated_surcharge',
    bands: [{ min: 0, max: 10000, surcharge_pct: 0.01 }],
    // ...whatever your downstream expects
  },
}
```

---

## 6. `TIERED_PERCENTAGE` (feature-flagged)

Tiered percentage charge: each tier has a `size` and a `price` that's a
percentage of subtotal. Requires `ff:support-charge-ga` on the tenant.

```js
{
  product_id: '<COMPOSITE_PRODUCT_ID>',
  starting_at: '2026-01-01T00:00:00.000Z',
  entitled: true,
  rate_type: 'TIERED_PERCENTAGE',
  tiers: [
    { size: 100000, price: 0.03 },   // first $100K of subtotal @ 3%
    {               price: 0.02 },   // beyond @ 2%
  ],
  minimum_config: { minimum: 5000 }, // optional - $50 minimum charge
}
```

If `addRates` returns 400 on this type, the flag isn't enabled - do not
attempt a workaround; open a ticket with Metronome to enable.

---

## Override `overwrite_rate` - same schema, one quirk

When `type: 'OVERWRITE'` on `add_overrides`, the `overwrite_rate` object
follows the exact same schema as a rate (see §1-§6 above). Quirks:

- `SUBSCRIPTION` and `TIERED_PERCENTAGE` inside `overwrite_rate` are
  feature-flagged (`ff:…`).
- `CUSTOM` inside `overwrite_rate` is client-gated.
- `commit_rate` is not valid inside `overwrite_rate` - set it on the
  rate-card rate instead, or use `is_commit_specific: true` +
  `target: 'COMMIT_RATE'` on the override itself.

---

## Quick comparison table

| Rate type | `price` shape | Needs `credit_type_id` | Needs `billing_frequency` | Needs `tiers` | Typical product type |
|---|---|---|---|---|---|
| `FLAT` | integer ≥0 | ✅ | - | - | USAGE, FIXED, COMPOSITE |
| `PERCENTAGE` | decimal 0-1 | ✗ (not allowed) | - | - | COMPOSITE, USAGE |
| `TIERED` | - (use `tiers`) | ✅ | - | ✅ | USAGE |
| `SUBSCRIPTION` | integer ≥0 | ✅ | ✅ | - | SUBSCRIPTION |
| `CUSTOM` | - (use `custom_rate`) | ✅ | - | - | any |
| `TIERED_PERCENTAGE` (ff) | - (use `tiers` with % prices) | ✗ | - | ✅ | COMPOSITE |

---

## Cross-references

- `SKILL.md` §Rate cards - how `addRates` wraps these payloads.
- `SKILL.md` §"Rate overrides" - how `overwrite_rate` reuses these schemas.
- `metronome-danger-zone/references/endpoint-matrix.md` §4 - verified
  paths for rate card endpoints.
- Official add-rates doc: <https://docs.metronome.com/api-reference/rate-cards/add-rates.md>
