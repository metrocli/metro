---
name: metronome-stripe-delivery
description: >-
  How Metronome invoices reach Stripe (and other billing providers) and how to
  reconcile Stripe ↔ Metronome deltas. Use when the user says "attach stripe",
  "billing provider config", "setCustomerBillingProviderConfigurations",
  "delivery method", "delivery_method_id", "charge_automatically",
  "send_invoice", "leave stripe invoices in draft", "invoices not pushing to
  stripe", "stripe reconciliation", "external_invoice", "PAYMENT_FAILED",
  "INVALID_REQUEST_ERROR", "multi-entity stripe", "multiple stripe accounts",
  "archive billing config", "flip collection method", or asks how Metronome
  decides where to send an invoice, why a Metronome void didn't refund Stripe,
  or how to verify a customer is wired to the right Stripe account. Also use
  for AWS Marketplace / Azure / GCP / NetSuite delivery configs. Do NOT use
  for the invoice state machine (DRAFT/FINALIZED/VOID) - that's
  metronome-invoicing. Do NOT use for creating the customer object itself -
  that's metronome-customers-hierarchies.
---

# Metronome Stripe Delivery

> Before calling any Metronome endpoint, verify paths against
> `metronome-danger-zone/references/endpoint-matrix.md`. If this skill and
> the endpoint-matrix disagree, the endpoint-matrix wins.

## Purpose

This skill fires when you need to route Metronome invoices into a billing
provider (almost always Stripe), flip collection mode, handle multi-entity
tenants with more than one Stripe account, or reconcile the known gap where
voiding a Metronome invoice does not refund the corresponding Stripe charge.

## Prerequisites

See `skills/_metronome-shared/conventions.md` for base URL, auth,
credit type IDs, timestamp rules, and error-shape quick reference.
For **which bearer token** (prod vs sandbox), see the `metro` skill: pass
`--sandbox` or `--prod` explicitly.

## Mental model

```
                  ┌────────────────── account-level ──────────────────┐
                  │ POST /v1/setupAccountBillingProvider              │
                  │ POST /v1/listConfiguredBillingProviders           │
                  │   → returns { delivery_method_id, billing_provider,│
                  │               delivery_method_configuration }     │
                  └─────────────────────┬─────────────────────────────┘
                                        │ delivery_method_id
                                        ▼
Customer ──► POST /v1/setCustomerBillingProviderConfigurations ──► billing_config
  │         { billing_provider, configuration, delivery_method_id }      │ id
  │                                                                     │
  │ POST /v1/customers/{id}/updateConfig                                  │
  │   { leave_stripe_invoices_in_draft? }                                 │
  │                                                                     │
  ▼                                                                     ▼
Contract ──► FINALIZED invoice ──────────► Stripe invoice
                  (Metronome)              external_invoice.id / invoice_id
                  │                        external_invoice.status
                  │                              │
                  └── POST /v1/invoices/void ────┼──► Stripe UNCHANGED
                                                 │   (reconciliation hole)
                                                 ▼
                                     Stripe charge (paid or open)
```

Billing provider config lives **on the customer**. Contracts inherit it
implicitly (via customer-level config) or explicitly (via
`billing_provider_configuration: { billing_provider_configuration_id }` on the
contract). Once an invoice FINALIZES, Metronome pushes it to the configured
provider in the background - there is no "push now" endpoint.

## Endpoint inventory

### Customer-level billing configs

| Method + Path | Purpose | Official docs |
|---|---|---|
| `POST /v1/setCustomerBillingProviderConfigurations` | Create / replace a customer's provider config. Accepts `{ data: [config, …] }` or the flat single-config shape. | [set-billing-provider-configurations-for-a-customer](https://docs.metronome.com/api-reference/customers/set-billing-provider-configurations-for-a-customer.md) |
| `POST /v1/getCustomerBillingProviderConfigurations` | List a customer's configs. Returns `data[]` with `id`, `billing_provider`, `configuration`, `delivery_method_id`, `archived_at`. | [fetch-billing-provider-configurations-for-a-customer](https://docs.metronome.com/api-reference/customers/fetch-billing-provider-configurations-for-a-customer.md) |
| `POST /v1/archiveCustomerBillingProviderConfigurations` | Archive configs by id. **Permanent** - archived configs cannot be unarchived. To "restore" you `set…` and get a new `id`. | [archive-billing-provider-configurations-for-a-customer](https://docs.metronome.com/api-reference/customers/archive-billing-provider-configurations-for-a-customer.md) |
| `POST /v1/customers/{customer_id}/updateConfig` | Per-customer overrides: `salesforce_account_id`, `leave_stripe_invoices_in_draft`. | [update-a-customer-configuration](https://docs.metronome.com/api-reference/customers/update-a-customer-configuration.md) |

### Account-level billing providers

| Method + Path | Purpose | Official docs |
|---|---|---|
| `POST /v1/listConfiguredBillingProviders` | List account-level providers, incl. every `delivery_method_id` available to your tenant and the Stripe account it points at. | [list-account-level-billing-providers](https://docs.metronome.com/api-reference/settings/list-account-level-billing-providers.md) |
| `POST /v1/setupAccountBillingProvider` | One-time setup of an account-level provider (OAuth + account-id wiring). You'll almost always do this via the Metronome UI, not the API. | [set-up-account-level-billing-provider](https://docs.metronome.com/api-reference/settings/set-up-account-level-billing-provider.md) |

## Working payloads

### 1. Attach Stripe to a customer (first-time)

The canonical attach payload, using the batched `data: [ ... ]` shape:

```js
await m.post('/v1/setCustomerBillingProviderConfigurations', {
  data: [{
    customer_id: '<METRONOME_CUSTOMER_ID>',
    billing_provider: 'stripe',
    configuration: {
      stripe_customer_id: 'cus_XXXXXXXXXXXX',
      stripe_collection_method: 'charge_automatically', // or 'send_invoice'
    },
    delivery_method_id: '<DELIVERY_METHOD_ID>', // from listConfiguredBillingProviders
  }],
});
```


**Notes:**
- `delivery_method_id` is required for any tenant with >1 configured Stripe
  account. Pull it from `listConfiguredBillingProviders`, never hardcode a
  random uuid.
- Do **NOT** pass both `delivery_method` and `delivery_method_id` - Metronome
  silently prefers one (observed: `delivery_method_id` wins when both are
  present, but don't rely on it; pick one).
- Response is an empty `{}` on success. To confirm the new `id`, call
  `getCustomerBillingProviderConfigurations` immediately after.

### 2. Inline on customer create (free → paid setup)

When you `POST /v1/customers` you can set the config in the same call:

```js
await m.post('/v1/customers', {
  name: '<COMPANY_NAME>',
  ingest_aliases: ['acme_corp'],
  customer_billing_provider_configurations: [{
    billing_provider: 'stripe',
    configuration: {
      stripe_customer_id: 'cus_XXXXXXXXXXXX',
      stripe_collection_method: 'charge_automatically',
    },
    delivery_method_id: '<DELIVERY_METHOD_ID>',
  }],
});
```

### 3. Fetch existing configs

```js
const r = await m.post('/v1/getCustomerBillingProviderConfigurations', {
  customer_id: '<METRONOME_CUSTOMER_ID>',
});
const configs = r.data?.data || r.data || [];
const activeStripe = configs.find(c =>
  c.billing_provider === 'stripe' && !c.archived_at
);
```


Each entry has `id`, `billing_provider`, `configuration`, `delivery_method_id`,
`archived_at`.

### 4. Flip collection method (`charge_automatically` → `send_invoice`)

There is no "update" endpoint. The supported pattern is archive + recreate:

```js
await m.post('/v1/archiveCustomerBillingProviderConfigurations', {
  customer_id: '<METRONOME_CUSTOMER_ID>',
  customer_billing_provider_configuration_ids: [stripeCfg.id],
});

await m.post('/v1/setCustomerBillingProviderConfigurations', {
  data: [{
    customer_id: '<METRONOME_CUSTOMER_ID>',
    billing_provider: 'stripe',
    configuration: {
      stripe_customer_id: stripeCfg.configuration.stripe_customer_id,
      stripe_collection_method: 'send_invoice',
    },
    delivery_method_id: stripeCfg.delivery_method_id,
  }],
});
```

Typical use: moving a customer from auto-charge to hosted-invoice email.

### 5. Archive (disconnect) all Stripe for a customer

Used before bulk historical invoice imports to prevent past-dated Stripe
pushes:

```js
const { data: configs } = await m.post(
  '/v1/getCustomerBillingProviderConfigurations',
  { customer_id }
);
const ids = (configs.data || configs || [])
  .filter(c => !c.archived_at)
  .map(c => c.id);
if (ids.length) {
  await m.post('/v1/archiveCustomerBillingProviderConfigurations', {
    customer_id,
    customer_billing_provider_configuration_ids: ids,
  });
}
```


**Archive is permanent.** There is no "toggle back on". To reconnect you call
`set…` again and accept a new `id`. Always back up the config JSON before
archiving so you can recreate.

### 6. Toggle `leave_stripe_invoices_in_draft` per-customer

```js
await m.post(`/v1/customers/${customer_id}/updateConfig`, {
  leave_stripe_invoices_in_draft: true,
});
```

See [Gotcha: the past-dated SCHEDULED bypass](#past-dated-scheduled-bypasses-leave-in-draft) below.

### 7. Resolve the live delivery method (account-level)

```js
const r = await m.post('/v1/listConfiguredBillingProviders', {});
const providers = r.data || [];
// Each provider: { delivery_method_id, billing_provider, delivery_method,
//                  delivery_method_configuration: { stripe_account_id, ... },
//                  archived_at }
const live = providers.find(p =>
  p.billing_provider === 'stripe' &&
  p.delivery_method === 'direct_to_billing_provider' &&
  p.delivery_method_configuration?.stripe_account_id === '<LIVE_ACCT_ID>' &&
  !p.archived_at
);
```

Recommended practice: wrap this in a guard (for example
`assertLiveDeliveryMethod()`) that every write script calls first, and refuse
to run if the configured delivery method id points at the wrong Stripe
account.

## Decision trees

### Single Stripe account vs multi-entity

```
Does your Metronome tenant have >1 Stripe account attached?
│
├── No (single Stripe)
│   Either `delivery_method: "direct_to_billing_provider"` OR
│   `delivery_method_id: "<the_one_id>"` works. Prefer
│   delivery_method_id so scripts are portable once you DO go multi-entity.
│
└── Yes (multi-entity - e.g. US-LLC + UK-Ltd)
    │
    └── MUST pass `delivery_method_id` for the correct entity.
        Never pass `delivery_method` alone - Metronome will pick the
        account-default which is rarely what you want.
        Never pass BOTH fields; pick one. Silent wrong-routing has been
        observed where both were set and the wrong Stripe account received
        the push.
```

**Recommended practice:** tenants often accumulate a stale test delivery
method next to the live one. Keep the expected live Stripe account id
(`acct_XXXXXXXXXXXX`) and delivery method id in config, keep a denylist of
known-stale ids, and validate both before every write. Never hardcode
delivery method uuids in scripts.

### `charge_automatically` vs `send_invoice`

| Value | Behavior | Use for |
|---|---|---|
| `charge_automatically` | Stripe attempts to charge the customer's default payment method as soon as the invoice finalizes. Failure → `external_invoice.status: PAYMENT_FAILED`. | Card-on-file, self-serve, most B2B SaaS. |
| `send_invoice` | Stripe emails a hosted invoice link; customer pays manually by clicking it. Net terms set on the Stripe invoice. | Enterprise, net-30/60/90 deals, any time the customer has asked to "get an invoice" rather than be charged. |
| `auto_charge_payment_intent` | **Beta.** PaymentIntent-based auto-charge. Enables `tax_provider` field. | Check with Metronome support before wiring in. |
| `manually_charge_payment_intent` | **Beta.** PaymentIntent manual capture. | Same. |

Recommended practice: pick the collection method per customer segment
(self-serve → `charge_automatically`, invoiced enterprise → `send_invoice`)
and record the rule in one place.

### `delivery_method` values

Per the official Metronome OpenAPI spec (`BillingProviderDeliveryMethodType`
enum on `setCustomerBillingProviderConfigurations`), the **complete** set is:

- `direct_to_billing_provider` - the default for Stripe / NetSuite / Workday
  / QuickBooks. Metronome pushes the invoice directly via the provider API.
- `aws_sqs` - Metronome writes the invoice payload into your SQS queue;
  your consumer pushes to the final system. Typical for enterprises that want
  to post-process invoices before billing.
- `tackle` - AWS Marketplace transactions that go through Tackle's co-selling
  platform for partner attribution / commission tracking.
- `aws_sns` - Invoice notifications published to an AWS SNS topic for
  event-driven billing workflows.

Values such as `email` or `cash_app` that appear in some older notes are
NOT in the `BillingProviderDeliveryMethodType` enum; don't rely on them.


## `leave_stripe_invoices_in_draft` - scope and caveats

Scope:
- Set **per customer** via
  `POST /v1/customers/{id}/updateConfig { leave_stripe_invoices_in_draft: true }`.
- Account-level default lives in the Metronome UI under
  Integrations → Stripe → "Leave invoices as drafts". The per-customer
  override takes precedence.
- When `true`: Metronome still finalizes the Metronome-side invoice, but the
  Stripe invoice stays in `DRAFT` so a human can review before Stripe
  finalizes. This blocks auto-charge.

### Past-dated SCHEDULED bypasses leave-in-draft

**A gotcha that burns people.** When `/v2/contracts/edit` creates a
SCHEDULED invoice with a **past-dated** `timestamp` (via
`add_scheduled_charges`), Metronome finalizes it **immediately** AND pushes
it to Stripe in finalized form **regardless of `leave_stripe_invoices_in_draft`**.

Same bypass applies when past-dated ingest inflates a window that's already
past period-end and needs a backfill invoice.

The ONLY way to guarantee a past-dated charge never reaches Stripe is to
**archive the customer's billing configs first**, do the edit, then set them
back afterward.

Reference: `metronome-danger-zone/SKILL.md §1.5`, and the danger-zone symptom
index entry on `external_invoice.status`.

## `external_invoice` - the Stripe handle on a Metronome invoice

Every Metronome invoice pushed to Stripe carries an `external_invoice`
object. Fields seen in live responses:

| Field | Meaning |
|---|---|
| `external_invoice.id` | Stripe invoice id (`in_xxx`). Use this with `stripe.invoices.retrieve()`. |
| `external_invoice.invoice_id` | Same as `id` in older payload shapes - both turn up in practice. |
| `external_invoice.external_id` | Stripe's own external id (usually matches `id`). |
| `external_invoice.status` | Stripe-side lifecycle. |
| `external_invoice.external_status` | Synonym of `status` in older shapes. |
| `external_invoice.billing_provider_type` | `stripe` / `aws_marketplace` / `netsuite` / … |

`external_invoice.status` values seen in practice (check the docs for the
full enum):

- `DRAFT` - Stripe invoice created, not finalized (respects
  `leave_stripe_invoices_in_draft`).
- `FINALIZED` - Stripe invoice finalized, awaiting collection.
- `SENT` / `QUEUED` - hosted invoice delivered or queued for delivery
  (`send_invoice` mode).
- `PAID` / `PARTIALLY_PAID` - collection done.
- `UNCOLLECTIBLE` - Stripe gave up.
- `VOID` / `DELETED` - Stripe-side void (NOT triggered by Metronome void).
- `PAYMENT_FAILED` - most common error state; Stripe auto-charge failed. Cause
  is usually "no default payment method" or "card declined". Retry with
  `POST /v1/payments/attempt` (path is `/v1/payments/*`, not
  `/v1/invoices/payments/*`, an easy prefix mistake) after fixing the PM - see `metronome-invoicing` for
  that endpoint.
- `INVALID_REQUEST_ERROR` - Stripe rejected the push (e.g. customer missing
  address, line-item count > 250, decimal quantity, currency mismatch). Fix
  the Stripe-side issue; Metronome will not auto-retry.
- `SKIPPED` - Metronome chose not to push (e.g. zero-total with "Skip zero
  invoices" on; under-$0.50 minimum).

If `external_invoice` is **absent** on a FINALIZED Metronome invoice, the push
hasn't happened yet - or the customer has no Stripe billing config. Poll; if
it stays absent for >60 seconds, check `getCustomerBillingProviderConfigurations`.

### Sandbox Stripe totals can look stale/zero in Metronome's embedded summary

Observed in sandbox: a paid Pro package contract created at the current UTC
hour produced a Metronome FINALIZED SCHEDULED invoice for
`$2,000.00`, pushed to sandbox Stripe as `external_invoice.invoice_id`, and
reported `external_status: FINALIZED` - but Metronome's embedded
`external_invoice.invoiced_sub_total` / `invoiced_total` fields were both `0`.

Do not use those embedded totals as the source of truth when reconciling a
sandbox Stripe push. Use the Metronome invoice `total` for Metronome-side
amount and retrieve the Stripe invoice by `external_invoice.id` /
`external_invoice.invoice_id` when the Stripe-side amount matters.

## Reconciliation: voiding Metronome never refunds Stripe

**This is the core safety issue of this skill.** When you call
`POST /v1/invoices/void` on a FINALIZED Metronome invoice that has an
`external_invoice.id` with `stripe.invoices.retrieve(id).paid === true`:

- Metronome: invoice flips to `VOID`, revenue drops to $0.
- Stripe: invoice stays `paid`, charge unchanged, customer's money stays
  with you.
- Reconciliation: Stripe collections ≠ Metronome revenue for that customer's
  period. The delta is exactly the void'd amount.

The same gap applies to `POST /v1/contracts/archive { void_invoices: true }`
- it voids **every** invoice on the contract including paid ones.

**Before voiding or archiving anything with money on it, run the §7
pre-flight reconciliation check** - see
[`references/reconciliation-snippet.md`](references/reconciliation-snippet.md)
for the copy-pasteable verification chain.

If you discover a delta after the fact, the remediations are:
1. Manually refund via Stripe (`stripe.refunds.create({ charge })`), OR
2. Apply a credit in Metronome (see `metronome-packages-contracts`) sized to
   the delta so the ledger balances going forward, OR
3. Regenerate the corrected invoice via `POST /v1/invoices/regenerate` and
   let the old Stripe charge stand as "applied to" the corrected invoice
   via accounting journal entries.

None of these are automatic. The correct default is to **never void a paid
FINALIZED Metronome invoice** unless finance has signed off on the
reconciliation plan.

## Multi-provider configurations

Metronome's openapi `BillingProviderType` enum has **9 values**:
`aws_marketplace, stripe, netsuite, custom, azure_marketplace,
quickbooks_online, workday, gcp_marketplace, metronome` (per the OpenAPI
spec).

| `billing_provider` | Notes |
|---|---|
| `stripe` | Most common; multi-entity via `delivery_method_id`. |
| `aws_marketplace` | Configured via `customer_billing_provider_configurations` plus AWS-specific customer custom fields (`aws_customer_account_id`, `aws_customer_id`, `aws_product_code`, `aws_is_subscription_product`, `aws_region`). Requires IAM perms `BatchMeterUsage`, `GetEntitlements`, `ListEntities`, `DescribeEntity`. Rate card needs a dimension at `$0.01/unit` with API identifier `usage_fee`. |
| `gcp_marketplace` | Workload Identity Federation. Disabled accounts emit the `marketplaces.gcp_metering_disabled` webhook. |
| `azure_marketplace` | Similar shape; see official docs. |
| `netsuite` | Can act as invoice destination OR as a revenue system via `customer_revenue_system_configurations[]`. |
| `quickbooks_online` | Finance/AR destination; similar shape to NetSuite. |
| `workday` | Enterprise AR destination; less common. |
| `custom` | Webhook-based bespoke delivery - Metronome posts invoice events to your endpoint, you push wherever. |
| `metronome` | Self-bill: Metronome acts as its own billing provider (rare; mainly dev/test). |

### `TaxProviderType` - when relevant

`TaxProviderType` enum is `anrok | avalara | stripe`. Only applies when
you set `configuration.tax_provider` on a Stripe billing config with
`auto_charge_payment_intent` or `manual_charge_payment_intent`
collection methods. `stripe` as a tax provider uses Stripe Tax; `anrok`
and `avalara` require the tenant-level credentials wired via
`POST /v1/upsertAnrokApiToken` / `POST /v1/upsertAvalaraCredentials`
(see https://docs.metronome.com).

For any non-Stripe provider, the config shape is still
`{ billing_provider, configuration: { … }, delivery_method_id, delivery_method }`
- only the inner `configuration` keys differ per provider. Always consult
the matching docs page under
`https://docs.metronome.com/api-reference/customers/set-billing-provider-configurations-for-a-customer.md`.

## Edge cases & gotchas

1. **`archive…` is permanent.** No toggle, no restore. To "reconnect" call
   `set…` again; the new config has a new `id` and any contracts that
   referenced the old `id` explicitly via
   `billing_provider_configuration.billing_provider_configuration_id` must
   be rewired. Back up config JSON before archiving.
2. **Customer-level config is inherited by contracts, but some contracts set
   their own.** Inspect `contract.billing_provider_configuration` on each
   contract; a contract with an explicit id ignores a later customer-level
   change until archived.
3. **Creating a package contract with `billing_provider: 'stripe'` without an
   active customer-level Stripe config fails** with
   `404 Billing provider configuration not found for STRIPE`. Attach first,
   create contract second.
4. **`/v1/listConfiguredBillingProviders` has a known 500 on pagination.**
   Call it with empty body `{}` and use the UI for tenants with many
   providers.
5. **Stripe's 250-line-item limit** - Metronome collapses anything over 250
   into a single line. If transparency matters to the customer (usage
   breakdown by product/tag), pre-emptively split the period or consolidate
   in Metronome via `pricing_group_key` before finalization.
6. **Stripe rejects decimal quantities** - Metronome sets `qty=1` and moves
   the real quantity to the line-item description. Confusing on hosted
   invoices; worth warning customers.
7. **Stripe max charge is $999,999.99 USD** and minimum chargeable is $0.50.
   Metronome "Skip zero-total" also skips sub-$0.50 as unchargeable.
8. **`invoice.billing_provider_error` webhook** fires on missing customer /
   no PM / etc. - wire it up if you care about proactive failure handling
   (see `metronome-danger-zone`).
9. **Do NOT pass both `delivery_method` and `delivery_method_id`.** One
   wins silently; mis-routing has been observed. Pick the `_id` in all cases where
   you can.
10. **Safety pattern (recommended practice):** every production write
    script should call a guard like `assertLiveDeliveryMethod()` before any
    write. It validates (a) the configured delivery method id is set, (b) it
    is not a known-stale test id, (c) the Stripe account id matches the
    expected live account (`acct_XXXXXXXXXXXX`), and (d) `delivery_method ===
    'direct_to_billing_provider'`.
11. **`setCustomerBillingProviderConfigurations` accepts both shapes** -
    `{ data: [config, ...] }` (batched) and the flat single-config shape.
    Both work. Prefer the batched form; the flat form appears in older
    scripts.

## Cross-references

- `metronome-danger-zone` - §1.1, §1.2, §1.5 (the reconciliation holes), §7
  (pre-flight reconciliation checklist). Endpoint-matrix §7 is the path
  source of truth.
- `metronome-invoicing` - void / regenerate / preview state machine; the
  `external_invoice` object is documented here but the invoice lifecycle is
  over there.
- `metronome-customers-hierarchies` - the customer object carries the
  billing config; customer create-with-config is covered there; inherited
  config on child contracts in hierarchies is covered there.
- `metronome-packages-contracts` - the `billing_provider_configuration` on a
  contract, and the "package contract requires customer config first" error
  chain.
- `metronome-danger-zone` - `invoice.billing_provider_error` and other
  Stripe-push failure webhooks.

## When NOT to use this skill

- "Void this invoice", "the invoice is stuck in DRAFT", "regenerate the
  invoice" → `metronome-invoicing` (it owns the DRAFT → FINALIZED → VOID
  machine).
- "Create a new customer and attach Stripe" - only the Stripe part is here.
  Customer creation, ingest aliases, parent-child hierarchies, and custom
  fields all live in `metronome-customers-hierarchies`.
- "Add a commit / credit / complimentary grant" → `metronome-packages-contracts`.
- "Stripe Checkout flow / Stripe PaymentIntent / Stripe webhook handlers"
  on your side of the integration → that's application code, not Metronome
  API shape. This skill only covers the Metronome → Stripe seam.
