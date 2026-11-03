---
name: metronome-subscriptions-seats
description: >-
  Per-seat and per-quantity subscription pricing on Metronome contracts -
  SubscriptionProductListItem, QUANTITY_ONLY vs SEAT_BASED modes, seat
  assignments, quantity/seats history, and per-seat balances. Use when the
  user says "seats", "seat", "per-seat", "platform seats", "seat count",
  "add a seat", "remove a seat", "assign user as seat", "quantity updates",
  "quantity_delta", "seat_updates", "listSeatBalances",
  "getSubscriptionQuantityHistory", "getSubscriptionSeatsHistory",
  "SubscriptionProductListItem", or asks about SEAT_BASED subscriptions,
  platform fee subscriptions, per-user billing, seat proration, or how
  named seats map to credit pools. Do NOT use for creating the Subscription
  product type itself → metronome-pricing-catalog. Do NOT use for the
  editContract mechanism or recurring commit shape → metronome-packages-contracts.
---

# Metronome Subscriptions & Seats

> Before calling any Metronome endpoint, verify paths against
> `metronome-danger-zone/references/endpoint-matrix.md` §9 (Contracts) and
> §10 (Credits & Commits). If this skill and the endpoint-matrix disagree,
> the endpoint-matrix wins.

## ⚠ Paths that do NOT exist

Do **not** probe these - they all 404 (verified by probing a live tenant):

| Tried | Reality |
|---|---|
| `POST /v1/seats/list` | 404 - no such endpoint |
| `POST /v2/seats/list` | 404 - no such endpoint |
| `POST /v1/contracts/listSeats` | 404 - no such endpoint |
| `POST /v1/contracts/commits/listSeatBalances` | 404 - wrong prefix |
| `POST /v1/contracts/listSeatBalances` | 404 - docs/openapi show the path is `POST /v1/contracts/seatBalances/list` (sibling pattern to `customerBalances/list`). |

The **only** three real endpoints for reading seat/quantity state are:

- `POST /v1/contracts/getSubscriptionQuantityHistory`
- `POST /v1/contracts/getSubscriptionSeatsHistory`
- `POST /v1/contracts/seatBalances/list`

See `metronome-danger-zone/SKILL.md` §2b.

## Purpose

This skill fires whenever work involves **per-seat or per-quantity subscription
pricing** on a Metronome contract - assigning users as seats, reading seat
history, computing per-seat balances, or updating quantities mid-contract. It is
the sibling to `metronome-pricing-catalog` (which owns the
`SubscriptionProductListItem` *catalog entry*) and `metronome-packages-contracts`
(which owns the contract-lifecycle mechanism).

## Prerequisites

See `skills/_metronome-shared/conventions.md` for base URL, auth,
credit type IDs, timestamp rules (hour-boundary `:00:00Z`), and error-shape
quick reference.
For **which bearer token** (sandbox vs production), see the `metro` skill.
Seat edits go through `/v2/contracts/edit`; in `metro`, preview them with
`metro subscription contract preview` or `metro custom-contract preview`
before any sandbox apply.

## Mental model

```
Contract
  └── subscriptions[]                       (a contract can have ≥ 0 subs)
        ├── subscription_rate
        │     ├── product_id               → SubscriptionProductListItem in catalog
        │     └── billing_frequency         (MONTHLY | QUARTERLY | SEMI_ANNUAL | ANNUAL)
        ├── collection_schedule             (ADVANCE = prebill, ARREARS = postbill)
        ├── proration
        │     ├── is_prorated
        │     └── invoice_behavior          (BILL_IMMEDIATELY | BILL_ON_NEXT_COLLECTION_DATE)
        ├── quantity_management_mode        (QUANTITY_ONLY | SEAT_BASED)
        ├── seat_config                     (SEAT_BASED only: seat_group_key + initial_seat_ids)
        └── quantity_schedule               ⚠ returned by /v2/contracts/get but
                                              only reflects INITIAL state for
                                              SEAT_BASED - use history endpoints
                                              for live state
```

A **subscription** is a product line on a contract priced with a
`SubscriptionProductListItem` (that lives in the rate card). The
subscription carries its own collection schedule, proration, and quantity
management mode. Seat management rides on top of the subscription object via
`seat_updates` inside `update_subscriptions` on `editContract`.

Seats are **NOT** a separate Metronome object. There is no seats table, no
`/v1/seats` domain. Seats are a view of a subscription whose
`quantity_management_mode = SEAT_BASED`.

## Endpoint inventory

| Method + Path | Purpose | Official docs |
|---|---|---|
| `POST /v1/contracts/getSubscriptionQuantityHistory` | Full history of quantity changes on a subscription (QUANTITY_ONLY or SEAT_BASED) | [get-subscription-quantity-history](https://docs.metronome.com/api-reference/contracts/get-subscription-quantity-history.md) |
| `POST /v1/contracts/getSubscriptionSeatsHistory` | Named-seat assignment history (SEAT_BASED only) | [get-subscription-seats-history](https://docs.metronome.com/api-reference/contracts/get-subscription-seats-history.md) |
| `POST /v1/contracts/seatBalances/list` | Per-seat credit balances (SEAT_BASED subs with per-seat recurring credits). Body requires `{ customer_id, contract_id }`; optional filters `subscription_ids`, `seat_ids`, `include_credits_and_commits`, `include_ledgers`, `covering_date` OR `starting_at`+`effective_before`, `limit` (1-100, default 25), `cursor`. **Path is `seatBalances/list`, NOT `listSeatBalances`** | [list-seat-balances](https://docs.metronome.com/api-reference/credits-and-commits/list-seat-balances.md) |
| `POST /v2/contracts/edit` + `update_subscriptions[]` | Add/remove seats, change quantity, end a subscription | [edit-a-contract](https://docs.metronome.com/api-reference/contracts/edit-a-contract.md) |
| `POST /v2/contracts/get` | Read `subscriptions[]`, discover `subscription_id`, inspect `quantity_management_mode` | [get-a-contract-v2](https://docs.metronome.com/api-reference/contracts/get-a-contract-v2.md) |

Rates for a `SubscriptionProductListItem` live on a rate card; how to add
them belongs in `metronome-pricing-catalog`. How to create/edit a contract
belongs in `metronome-packages-contracts`.

## Subscription rates vs usage rates

| Aspect | Subscription rate | Usage rate |
|---|---|---|
| Product type | `SubscriptionProductListItem` (`type: 'SUBSCRIPTION'`) | `UsageProductListItem` |
| Tied to a billable metric | No | Yes (via `billable_metric_id`) |
| Quantity source | `quantity_schedule` / seats on the subscription | Ingested events aggregated per metric |
| Must specify on rate | `billing_frequency` inside `subscription_rate` | aggregation/metric |
| Prorates by time | Yes (per `proration`) | No - per-event |
| Invoice line `type` | `subscription` | `usage` |

A common pattern: a `Platform Seat` product with `type: 'SUBSCRIPTION'`,
`rate_type: 'FLAT'`, and `billing_frequency: 'MONTHLY'` on the rate. If seats
are not billed per seat (a recurring commit is the revenue line and seats
exist only for named-user attribution), the rate can be `price: 0`.

**Package creation gotcha (sandbox-verified):** if a package
includes a `subscriptions[]` entry for a seat product, the package's
`rate_card_id` must already have matching rates for that subscription product
and billing frequency. Package creation fails until the rate card has
the seat rates, for example placeholder rates for both frequencies:

```js
[
  {
    product_id: '<PLATFORM_SEAT_PRODUCT_ID>',
    starting_at: '2020-01-01T00:00:00.000Z',
    entitled: false,
    rate_type: 'FLAT',
    price: 0,
    credit_type_id: '<USD_CENTS_ID>',
    billing_frequency: 'MONTHLY',
  },
  {
    product_id: '<PLATFORM_SEAT_PRODUCT_ID>',
    starting_at: '2020-01-01T00:00:00.000Z',
    entitled: false,
    rate_type: 'FLAT',
    price: 0,
    credit_type_id: '<USD_CENTS_ID>',
    billing_frequency: 'ANNUAL',
  },
]
```

Then the package can add an override for the actual subscription frequency
(`override_specifiers: [{ product_id, billing_frequency: 'MONTHLY' }]`,
`entitled: true`). Do this rate-card prep before `/v1/packages/create`.

## Working payloads

### Read quantity history (any mode)

Use when you need the full timeline of `quantity` on a subscription -
upgrades, downgrades, add/remove seats, everything that changes the
count.

```js
const sr = await met.post('/v1/contracts/getSubscriptionQuantityHistory', {
  customer_id: '<CUSTOMER_ID>',
  contract_id:  '<CONTRACT_ID>',
  subscription_id: '<SUBSCRIPTION_ID>',
});
// sr.data.data → [{ starting_at, ending_before?, quantity }, ...]
```

**Notes:**
- Works for both `QUANTITY_ONLY` and `SEAT_BASED` subscriptions.
- For `SEAT_BASED`, each add/remove seat maps 1:1 to a quantity entry.
- `subscription_id` MUST come from `/v2/contracts/get` → `subscriptions[]`.
- `quantity_schedule` returned by `/v2/contracts/get` on a `SEAT_BASED`
  subscription only shows the *initial* state - use this endpoint for the
  live history.

### Read seat assignment history (SEAT_BASED only)

```js
await met.post('/v1/contracts/getSubscriptionSeatsHistory', {
  customer_id:     '<CUSTOMER_ID>',
  contract_id:     '<CONTRACT_ID>',
  subscription_id: '<SUBSCRIPTION_ID>',
});
// response includes per-seat_id assignment windows
```

**Notes:**
- Returns named-seat granularity (`seat_id` is whatever you assigned, often your user ID).
- 404 / empty on `QUANTITY_ONLY` subscriptions.

### List seat balances

Per-seat balance breakdown - only meaningful when the contract has a
**per-seat recurring credit** (i.e., the recurring commit uses `INDIVIDUAL`
allocation; see `metronome-packages-contracts`). If your credits are a
company-level pool, this endpoint returns nothing useful; use
`customerBalances/list` instead.

```js
await met.post('/v1/contracts/seatBalances/list', {
  customer_id: '<CUSTOMER_ID>',
  contract_id: '<CONTRACT_ID>',
  // optional: subscription_ids, seat_ids, include_credits_and_commits,
  //           include_ledgers, covering_date OR starting_at/effective_before,
  //           limit (1-100, default 25), cursor
});
// Returns { data: [ { seat_id, balances, commits?, credits? } ], pagination }
```

**Notes:**
- Docs live under `credits-and-commits/list-seat-balances.md` but the path
  is `/v1/contracts/seatBalances/list` (sibling pattern to
  `customerBalances/list`, NOT a `listSeatBalances` camelCase form).
  The `/v1/contracts/commits/listSeatBalances` variant does **not** respond.
- Returns empty if the recurring credit is company-level.
- `include_credits_and_commits` + `include_ledgers` flags expand the
  response to per-seat ledger entries; `limit` is 1-100 (default 25).

### Add a seat (SEAT_BASED)

Named-seat assignment uses `seat_updates` inside
`update_subscriptions` on `/v2/contracts/edit`. The *mechanism* is in
`metronome-packages-contracts`; the **payload shape** lives here because it's
seat-specific:

```js
await axios.post(api('/v2/contracts/edit'), {
  customer_id:  metronomeCustomerId,
  contract_id:  metronomeContractId,
  update_subscriptions: [{
    subscription_id: metronomeSubscriptionId,
    seat_updates: {
      add: [{ seat_id: '<USER_ID>', starting_at: '<ISO_HOUR_BOUNDARY>' }],
    },
  }],
}, { headers: headers() });
```

### Remove a seat (SEAT_BASED)

```js
await axios.post(api('/v2/contracts/edit'), {
  customer_id: metronomeCustomerId,
  contract_id: metronomeContractId,
  update_subscriptions: [{
    subscription_id: metronomeSubscriptionId,
    seat_updates: {
      remove: [{ seat_id: '<USER_ID>', ending_before: '<ISO_HOUR_BOUNDARY>' }],
    },
  }],
}, { headers: headers() });
```

**Notes:**
- `starting_at` / `ending_before` must snap to hour boundaries (`:00:00Z`).
- `add` fills unassigned slots first, then expands total quantity.
- `remove` is a no-op if `seat_id` isn't currently assigned (does not 400).
- The shorthand `seat_updates.add / .remove` works; Metronome also accepts
  the fuller `add_seat_ids: [{ seat_ids: ["alice"], starting_at: "..." }]` /
  `remove_seat_ids` shape for batch assignments and
  `add_unassigned_seats / remove_unassigned_seats` for headcount-only bumps.

### Update quantity (QUANTITY_ONLY)

```js
await axios.post(api('/v2/contracts/edit'), {
  customer_id: metronomeCustomerId,
  contract_id: metronomeContractId,
  update_subscriptions: [{
    subscription_id: metronomeSubscriptionId,
    quantity_updates: [{
      starting_at:   '<ISO_HOUR_BOUNDARY>',
      quantity_delta: 1,                       // or: quantity: 5  (absolute)
    }],
  }],
}, { headers: headers() });
```

**Notes:**
- `quantity_updates` on a `SEAT_BASED` subscription → **400**
  `"Explicit quantity updates are only supported for QUANTITY_ONLY subscriptions"`.
- `quantity_delta` must be non-zero and cannot drive the total below 0.
- Use either `quantity_delta` **or** `quantity` (absolute), not both.

### End a subscription mid-contract

```js
await axios.post(api('/v2/contracts/edit'), {
  customer_id: metronomeCustomerId,
  contract_id: metronomeContractId,
  update_subscriptions: [{
    subscription_id: metronomeSubscriptionId,
    ending_before:   '<ISO_HOUR_BOUNDARY>',
  }],
}, { headers: headers() });
```

Setting `ending_before` stops billing the subscription after that timestamp
but leaves the contract alive. To end the whole contract, use
`POST /v1/contracts/updateEndDate` (owned by `metronome-packages-contracts`).

## QUANTITY_ONLY vs SEAT_BASED - pick one at creation

| | QUANTITY_ONLY (default) | SEAT_BASED |
|---|---|---|
| Create-time field | `initial_quantity: N` | `seat_config: { seat_group_key, initial_seat_ids: [...] }` (direct) OR just `seat_config.seat_group_key` (package) |
| Increment | `quantity_updates: [{ quantity_delta: 1 }]` | `seat_updates: { add: [{ seat_id: "alice" }] }` |
| Decrement | `quantity_updates: [{ quantity_delta: -1 }]` | `seat_updates: { remove: [{ seat_id: "alice" }] }` |
| Metronome tracks who | No | Yes - named seats |
| `quantity_updates` allowed | ✅ | ❌ 400 |
| `seat_updates` allowed | ❌ | ✅ only way |
| Package requires `initial_quantity` | ✅ | ❌ rejected as 400 |
| Direct contract seat requirement | n/a | `initial_seat_ids` must be inside `seat_config` (not at sub root) |
| Mode switch | `QUANTITY_ONLY → SEAT_BASED` via `quantity_management_mode_update` (one-way) | Cannot revert |

Rule of thumb: if Metronome needs to know **who** (for user-level
dashboards, per-user usage attribution, seat commitments), use `SEAT_BASED`.
If Metronome only needs the count (plain "3 seats"), use `QUANTITY_ONLY`.

## Proration on quantity changes

Subscription lines prorate **on increases**. On decreases, Metronome defers
the change to the next billing boundary regardless of `is_prorated`.

| `proration` config | Increase behavior | Decrease behavior |
|---|---|---|
| `is_prorated: true, invoice_behavior: BILL_IMMEDIATELY` (requires `collection_schedule: ADVANCE`) | Immediate prorated charge | Credit applied at next billing boundary |
| `is_prorated: true, invoice_behavior: BILL_ON_NEXT_COLLECTION_DATE` | Prorated amount rolled onto next invoice | Credit at next boundary |
| `is_prorated: false` | No proration - full period charged at next boundary | No proration |

**Seat commitments:** seats added via `seat_updates.add` inherit the
subscription's proration. There's no per-seat proration knob - it's
subscription-level. If you need a seat to be free for a window, use an
override on the subscription rate (`metronome-pricing-catalog`), not a
proration hack.

## `transition` semantics when quantities change mid-contract

Mid-contract quantity or seat edits **stay on the same contract**. They do
NOT create a transition. The `transitions[]` array on `/v2/contracts/list`
only fills when you archive/end the contract and create a successor (see
`metronome-packages-contracts` for the full transition DAG).

This matters for tier upgrades: changing plan (e.g., Starter to Pro) is NOT a
quantity change. It is an end-old-contract + create-new-contract flow
with an optional `transition: { type: "RENEWAL" | "SUPERSEDED" }` on the
new contract. For the transition type semantics, defer to
`metronome-packages-contracts`.

Because seat changes don't trigger transitions, an audit that walks
`transitions[].from_contract` to `to_contract` does **not** surface seat churn. To audit seat history, use
`getSubscriptionQuantityHistory` or `getSubscriptionSeatsHistory`
per contract.

## Edge cases & gotchas

- **`quantity_schedule` in `/v2/contracts/get` is NOT live state on
  `SEAT_BASED`** - it shows the initial quantity at contract creation. For
  current seat count, use `getSubscriptionQuantityHistory` and take the
  entry whose `[starting_at, ending_before)` contains `now`.
- **`subscription_id` changes between contracts.** A contract upgrade
  creates a brand-new contract, with a brand-new subscription UUID. Do NOT
  cache `subscription_id` across a plan change - re-resolve it via
  `/v2/contracts/get` after every create/upgrade.
- **`initial_seat_ids` lives inside `seat_config`, not at the subscription
  root.** Putting it at the subscription root is silently ignored or 400s.
- **SEAT_BASED packages MUST NOT include `initial_quantity`** - 400
  `"SEAT_BASED subscription cannot have initial quantity"`.
- **Direct contracts with SEAT_BASED MUST include `initial_seat_ids`** -
  400 `"missing required properties ([\"initial_seat_ids\"])"`. Assign
  seats at contract creation; no separate editContract call needed.
- **Per-user usage attribution is orthogonal to mode.** In both modes, you
  still ingest with `properties.user_id` - the mode only changes how the
  count is managed. Credits remain company-level unless you explicitly
  configure per-seat allocation on a recurring credit (see
  `metronome-packages-contracts`).
- **Seats are billed on the subscription's `billing_frequency`, not the
  commit's.** A monthly Platform Seat sub on a contract with an annual
  recurring commit still invoices seats monthly. Use
  `scheduled_charges_on_usage_invoices: "ALL"` at contract creation to
  merge subscription lines onto the usage invoice.
- **One product can carry multiple subscription rates.** A single
  `Platform Seat` product can have both a MONTHLY and an ANNUAL rate on
  the same rate card; overrides targeting a subscription rate MUST include
  both `product_id` AND `billing_frequency` in `override_specifiers` or
  the override is silently ignored.
- **Quantity updates are not retroactive across finalized invoices.** A
  past-dated `quantity_updates.starting_at` that crosses a FINALIZED
  subscription invoice does not retroactively restate that invoice - it
  only takes effect going forward on the current billing period.

## Decision tree

```
Need to …
├── see the current seat count / quantity on a live subscription
│     → POST /v1/contracts/getSubscriptionQuantityHistory
│        (pick the entry whose window contains now)
├── see who currently holds which seat (SEAT_BASED)
│     → POST /v1/contracts/getSubscriptionSeatsHistory
├── see each seat's credit balance (per-seat recurring credit only)
│     → POST /v1/contracts/seatBalances/list
├── add / remove a named user as a seat (SEAT_BASED)
│     → POST /v2/contracts/edit with update_subscriptions[].seat_updates
├── bump or drop headcount on a QUANTITY_ONLY sub
│     → POST /v2/contracts/edit with update_subscriptions[].quantity_updates
├── end the subscription (but keep the contract)
│     → POST /v2/contracts/edit with update_subscriptions[].ending_before
└── change plan (tier upgrade/downgrade)
      → archive old contract + create new contract with transition
        (see metronome-packages-contracts)
```

## Cross-references

- `metronome-danger-zone` - endpoint-matrix §9 & §10 are the source of truth
  for paths; §2b lists the seat endpoints that don't exist.
- `metronome-pricing-catalog` - owns `SubscriptionProductListItem` creation
  (`type: 'SUBSCRIPTION'`), subscription rate shape, and override specifiers
  that must include `billing_frequency`.
- `metronome-packages-contracts` - owns the `/v2/contracts/edit` mechanism,
  the `transition` DAG, and the hour-boundary rule. This skill carries the
  seat-specific payload shapes that ride on top of editContract.
- `metronome-packages-contracts` also owns per-seat recurring credits (commit
  shape with `INDIVIDUAL` allocation), which is what makes
  `seatBalances/list` return non-empty data.

## When NOT to use this skill

- Defining the `SubscriptionProductListItem` product or adding a
  subscription rate to a rate card → `metronome-pricing-catalog`.
- General `editContract` mechanics (add commits, add overrides, update end
  date) → `metronome-packages-contracts`.
- Recurring commit/credit shape (`access_schedule`, `invoice_schedule`,
  `rollover_fraction`, `INDIVIDUAL` allocation) → `metronome-packages-contracts`.
- Tier upgrade/downgrade flow (archive old contract + create new with
  `transition`) → `metronome-packages-contracts`.
- Stripe delivery behavior for subscription invoices →
  `metronome-stripe-delivery`.
