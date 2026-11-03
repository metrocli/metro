# `/v2/contracts/edit` - Operation Catalog

Catalog of the operation keys accepted by `POST /v2/contracts/edit`, what
they do, representative payload shapes, and the gotchas / silent-failure
modes worth knowing. For path-level facts (method, URL, auth, error shapes),
always defer to `metronome-danger-zone/references/endpoint-matrix.md` §9.

Every request takes the same envelope:

```js
await m.post('/v2/contracts/edit', {
  customer_id: '<CUSTOMER_ID>',
  contract_id: '<CONTRACT_ID>',
  // ...ONE OR MORE of the op keys below...
});
```

You can combine multiple ops in a single call (e.g. `add_commits` +
`add_overrides`). Metronome validates the whole envelope atomically - if any
op fails schema validation, nothing is applied.

Official docs (always re-verify against the live page before writing code;
the op list grows over time):
[edit-a-contract](https://docs.metronome.com/api-reference/contracts/edit-a-contract.md).

---

## Table of ops

Op keys as listed in the edit-a-contract request schema. "Shape lives in"
points at the skill or section that covers field-level semantics.

| Op key | Category | Purpose | Shape lives in |
|---|---|---|---|
| `add_commits` | Commits | Add a one-shot commit (PREPAID/POSTPAID) | SKILL.md "Commits and credits" |
| `update_commits` | Commits | Edit fields on an existing commit | SKILL.md "Commits and credits" |
| `archive_commits` | Commits | Archive commits, `[{ id }]` (void dependent invoices first) | this file |
| `add_credits` | Credits | Add a credit (free grant, no invoice) | SKILL.md "Commits and credits" |
| `update_credits` | Credits | Edit a credit | SKILL.md "Commits and credits" |
| `archive_credits` | Credits | Archive credits, `[{ id }]` | this file |
| `add_recurring_commits` | Recurring commits | Add a recurring commit (monthly/annual plan bundle) | SKILL.md "Commits and credits" |
| `update_recurring_commits` | Recurring commits | Edit a recurring commit - keyed by `recurring_commit_id` (NOT `id`) | this file |
| `add_recurring_credits` | Recurring credits | Add a recurring credit | SKILL.md "Commits and credits" |
| `update_recurring_credits` | Recurring credits | Edit a recurring credit | this file |
| `add_overrides` | Overrides | Add a rate override or entitlement (on products / tags) | `metronome-pricing-catalog` |
| `remove_overrides` | Overrides | Remove overrides by id | `metronome-pricing-catalog` |
| `add_discounts` | Discounts | Add a discount schedule | `metronome-pricing-catalog` |
| `add_scheduled_charges` | Scheduled charges | Add plan fees / one-offs / historical charges | this file + `metronome-invoicing` |
| `update_scheduled_charges` | Scheduled charges | Edit an existing scheduled charge, keyed by `scheduled_charge_id` | this file |
| `archive_scheduled_charges` | Scheduled charges | Archive scheduled charges, `[{ id }]` | this file |
| `add_professional_services` | Pro services | Add a one-off professional-services line | `metronome-pricing-catalog` |
| `add_reseller_royalties` | Reseller | Add reseller royalty config (marketplace deals) | `metronome-pricing-catalog` |
| `add_subscriptions` | Subscriptions / seats | Add a subscription to the contract | `metronome-subscriptions-seats` |
| `update_subscriptions` | Subscriptions / seats | Seat add/remove, quantity updates | `metronome-subscriptions-seats` |
| `add_spend_threshold_configuration` / `update_spend_threshold_configuration` | Threshold | Contract-level spend threshold | this file |
| `add_prepaid_balance_threshold_configuration` / `update_prepaid_balance_threshold_configuration` | Threshold | Auto-recharge when prepaid balance drops | docs |
| `add_billing_provider_configuration_update` | Billing provider | Change the contract's billing provider config | `metronome-stripe-delivery` |
| `add_spend_trackers` / `archive_spend_trackers` | Spend trackers | Track spend without invoicing effects | docs |
| `update_contract_name` | Metadata | Rename a contract (string) | this file |
| `update_net_payment_terms_days` | Metadata | Net payment terms (e.g. 30) | docs |
| `update_contract_end_date` | Lifecycle | New end date as an RFC 3339 string (with `allow_contract_ending_before_finalized_invoice`) | prefer `updateEndDate` |

**Recommended dedicated endpoints** (under `/v1/contracts/...` unless noted):

| Want to... | Endpoint |
|---|---|
| Change contract end date | `updateEndDate` (has `allow_ending_before_finalized_invoice`; simpler than `update_contract_end_date`) |
| Push DRAFT invoice issue date | `updateInvoiceIssueDate` |
| Archive the contract | `archive` (with `void_invoices` flag) |
| Set a usage filter for multi-contract routing | `setUsageFilter` |
| Create past-period USAGE invoices | `createHistoricalInvoices` |
| Read edit history | `/v2/contracts/getEditHistory` |

---

## Envelope notes

- **All timestamps must snap to hour boundaries** (`:00:00Z`). This applies
  to `starting_at`, `ending_before`, `timestamp`, and anywhere a time
  appears inside `schedule_items`, `add_scheduled_charges`, or
  `access_schedule`. See `skills/_metronome-shared/conventions.md`.
- **Atomic**: if any op fails schema validation, the whole request 400s; no
  partial application.
- **Transitioned contracts with finalized invoices cannot be edited.** A
  contract that was superseded/renewed AND has finalized invoices returns
  400. Create a standalone contract instead.
- **Concurrent edits are fine** but response ordering isn't guaranteed -
  don't assume two parallel edits see each other's results. For
  non-idempotent sequences, serialize.
- **Always read back.** After an edit, `POST /v2/contracts/get` (and
  `getEditHistory` if needed) and compare expected vs actual. A 200 does not
  prove the field persisted (see the silent-failure index below).

---

## Op-by-op details

### `add_scheduled_charges`

A scheduled charge is an invoice line (usually a plan fee, a one-off fee, or
a migrated historical charge). Each entry has a product, a schedule of
dated line items, and a credit type.

```js
await m.post('/v2/contracts/edit', {
  customer_id, contract_id,
  add_scheduled_charges: [{
    product_id: '<FIXED_FEE_PRODUCT_ID>',
    name: 'Historical Platform Fee',
    schedule: {
      credit_type_id: '<USD_CENTS_ID>',
      schedule_items: [
        { timestamp: '<ISO_HOUR_Z>', unit_price: 10000, quantity: 1 },
        { timestamp: '<ISO_HOUR_Z>', unit_price: 10000, quantity: 1 },
      ],
    },
  }],
});
```

**Gotchas:**
- **Past-dated timestamps finalize IMMEDIATELY** and bypass the "leave
  invoices as drafts" setting (see `metronome-danger-zone` §1.5). If a
  billing config is active, the customer gets a Stripe invoice within
  seconds. To prevent the push, archive the customer's billing provider
  config first.
- Timestamps must fall within `starting_at <= timestamp < ending_before`.
  A timestamp past `ending_before` returns 400.
- `unit_price` is in `credit_type_id` units - USD cents for
  `2714e483-4ff1-48e4-9e25-ac732e8f24f2` (a $100 fee = `10000`).

### `archive_scheduled_charges`

Archives scheduled charges by id. Works for charges added with
`add_scheduled_charges`. It does not remove invoices generated by a
`recurring_commits` invoice schedule - to stop a future plan-fee invoice from
a recurring commit, edit or end the recurring commit, or shorten the contract
with `updateEndDate`.

```js
await m.post('/v2/contracts/edit', {
  customer_id, contract_id,
  archive_scheduled_charges: [{ id: '<SCHED_CHARGE_ID>' }],
});
```

### `update_scheduled_charges`

Edit an existing scheduled charge's schedule items in place - e.g. change
the unit price of a future-dated charge before it finalizes.

```js
await m.post('/v2/contracts/edit', {
  customer_id, contract_id,
  update_scheduled_charges: [{
    scheduled_charge_id: '<SCHED_CHARGE_ID>',
    invoice_schedule: {
      // see docs for add_schedule_items / update_schedule_items / remove_schedule_items
    },
  }],
});
```

Does NOT work once the underlying invoice has finalized. For a finalized
correction, void + regenerate (`metronome-invoicing`).

### `update_contract_name`

Cosmetic - renames the contract as displayed in the Metronome UI and API
responses. No billing effect.

```js
await m.post('/v2/contracts/edit', {
  customer_id, contract_id,
  update_contract_name: 'Acme Corp - Pro Annual (2026 renewal)',
});
```

### `update_spend_threshold_configuration`

Enable, disable, or tune the contract's spend threshold (the "invoice when
spend exceeds X" guard). Applies to the contract, not per-commit. Use
`add_spend_threshold_configuration` if none exists yet.

```js
await m.post('/v2/contracts/edit', {
  customer_id, contract_id,
  update_spend_threshold_configuration: {
    is_enabled: true,
    threshold_amount: 50000,   // cents
    // see docs for commit / payment_gate_config fields
  },
});
```

### Commits (`add_commits`, `update_commits`, `archive_commits`)

Full commit shape (`type`, `access_schedule`, `invoice_schedule`,
`rollover_fraction`, `priority`, `applicable_product_tags`,
`payment_gate_config`, `custom_fields`, `uniqueness_key`) is in SKILL.md
"Commits and credits". A working PREPAID payload with no expiry, full
rollover, and no invoice lives in `metronome-danger-zone` §6.

**Archive quirk:** archiving a commit that has been invoiced requires voiding
dependent invoices FIRST. If the commit has been invoiced and Stripe-paid,
follow the reconciliation checklist in `metronome-danger-zone` §7 before
archiving.

### Credits (`add_credits`, `update_credits`, `archive_credits`)

Same access-side shape as commits, but no `type`, no `invoice_schedule`, and
no payment gate - credits are granted, not billed.

### Recurring commits / credits

Two quirks worth repeating:

- **`update_recurring_commits` requires `recurring_commit_id`, NOT `id`.**
  Wrong field name returns `"object has missing required properties"`.
- **`update_recurring_commits` + `hierarchy_configuration` silently fails.**
  API returns 200 but `child_access` is never persisted. Only
  `add_recurring_commits` (or regular `add_commits`) reliably sets
  `hierarchy_configuration.child_access`.

### Overrides (`add_overrides`, `remove_overrides`)

Shape lives in `metronome-pricing-catalog` (rate override structure:
`override_specifiers`, `type`, `entitled`, `overwrite_rate` /
`multiplier`, `priority`). Overrides are applied to contracts via
editContract (mechanism here) but the schema details live there.

A common pattern - making a seat product entitled (free) for a hierarchy
child contract:

```js
await m.post('/v2/contracts/edit', {
  customer_id, contract_id,
  add_overrides: [{
    product_id: '<SEAT_PRODUCT_ID>',
    entitled: true,
    starting_at: '<ISO_HOUR_Z>',
  }],
});
```

### `add_discounts`

Discount schedule on upcoming invoices. Shape details in
`metronome-pricing-catalog`.

### Professional services (`add_professional_services`)

One-off pro-services line items (implementation fees, training packages).
Shape in `metronome-pricing-catalog`.

### Reseller royalties (`add_reseller_royalties`)

AWS / Azure / GCP marketplace reseller configs. Shape in
`metronome-pricing-catalog` and the docs.

### Subscriptions / seats (`add_subscriptions`, `update_subscriptions`)

The subscription editor for SEAT_BASED (`seat_updates`) and QUANTITY_ONLY
(`quantity_updates`) subscriptions. Shape in
`metronome-subscriptions-seats`. Seat-add pattern:

```js
await m.post('/v2/contracts/edit', {
  customer_id, contract_id,
  update_subscriptions: [{
    subscription_id: '<SUBSCRIPTION_ID>',
    seat_updates: {
      add: [{ seat_id: '<USER_ID>', starting_at: '<ISO_HOUR_Z>' }],
    },
  }],
});
```

`subscription_id` comes from `POST /v2/contracts/get` at
`data.subscriptions[0].id`. Key gotcha: `quantity_updates` is REJECTED on
SEAT_BASED subscriptions - use `seat_updates` instead.

---

## Silent-failure index (things that return 200 but do nothing)

| Op + field | Symptom | Workaround |
|---|---|---|
| `update_recurring_commits.hierarchy_configuration.child_access` | 200, but `child_access` is never set | Use `add_commits` (regular, not recurring) with `hierarchy_configuration.child_access` on the child contract |
| `scheduled_charges_on_usage_invoices: 'ALL'` added via editContract | 200, but the setting is ignored - still generates separate invoices | Must be set at CONTRACT CREATION. Bake it into the package or create a direct contract with it. Cannot be retro-applied. |
| `quantity_updates` on a SEAT_BASED subscription | 400 `"Explicit quantity updates are only supported for QUANTITY_ONLY subscriptions"` | Use `seat_updates.add` / `seat_updates.remove` |
| `POST /v1/contract-pricing/rate-cards/addRate` (singular, on rate cards - not on editContract, but a common near-miss) | 200, rates do not persist as expected | Use `/v1/contract-pricing/rate-cards/addRates` (plural). See `metronome-pricing-catalog`. |

---

## Off-limits - editContract cannot do this

Repeating the "What editContract CANNOT do" table from SKILL.md so this file
is self-contained:

- Change end date -> prefer `/v1/contracts/updateEndDate` (editContract's
  `update_contract_end_date` exists, but takes a plain string)
- Push DRAFT invoice issue date -> `/v1/contracts/updateInvoiceIssueDate`
- Modify a FINALIZED invoice's rates -> void + regenerate
  (`metronome-invoicing`)
- Edit a rollover commit -> edit the originator on the predecessor contract
- Swap the rate card -> contract is pinned; create a new contract
- Add `scheduled_charges_on_usage_invoices` post-creation -> recreate
- Edit a transitioned contract with finalized invoices -> create a
  standalone contract instead
- Add `hierarchy_configuration` on a package contract -> use a direct
  contract
