# Metronome Learnings - Indexed by Symptom

When you run into something weird, check here first. Indexed by the symptom
you'd notice, not the mechanism. If a learning belongs elsewhere, go look
there - but the index below should land you on the right page.

---

## Endpoint-matrix corrections worth remembering

A verification pass against the public API reference surfaced these latent
bugs in older notes. All are fixed in `endpoint-matrix.md`:

1. **Notifications moved to `/v2/`** - §14. `POST /v1/notifications/lifecycleEvents/*` and `/v1/notifications/systemEvents/list` are deprecated. Real paths: `POST /v2/notifications/{create,edit,archive,get}`, `POST /v2/notifications/offset/list`, `POST /v2/notifications/system/list`.
2. **Seat balances path is `seatBalances/list`** - §10. Real path is `POST /v1/contracts/seatBalances/list` (sibling of `customerBalances/list`). The camelCase `listSeatBalances` 404s.
3. **Tax settings paths are flat, no `/settings/` prefix** - §15. `POST /v1/upsertAnrokApiToken` and `POST /v1/upsertAvalaraCredentials`. Both take `delivery_method_ids` (plural **array**), not singular `delivery_method_id`.
4. **`delivery_method` enum has `tackle` and `aws_sns`** - §7. `BillingProviderDeliveryMethodType` is `{direct_to_billing_provider, aws_sqs, tackle, aws_sns}`. Older `email` and `cash_app` are legacy/endpoint-specific. Always check the exact endpoint schema.
5. **`threshold-billing/release` is the real path, not `commits/release`** - §10. `POST /v1/contracts/commits/threshold-billing/release` with `{ workflow_id, outcome }`, used for EXTERNAL payment gates (non-Stripe gateways). Stripe-gated commits don't use this endpoint.
6. **`addManualBalanceLedgerEntry` requires `segment_id`** - §10. Required body is `{ customer_id, id, segment_id, amount, reason }`. The path lives under `/v1/contracts/`, not `/v1/contracts/commits/`. `segment_id` is the current segment UUID on the commit - look it up, don't omit.
7. **`allow_ending_before_finalized_invoice` defaults to `true`** - §9. Per the [docs](https://docs.metronome.com/api-reference/contracts/update-the-contract-end-date.md), `POST /v1/contracts/updateEndDate` will shorten contracts past finalized invoices unless you explicitly pass `false`. Recommended practice: always set it explicitly on production edits.

---

- [Symptom → Likely cause map](#symptom--likely-cause-map)
- [Verified working patterns](#verified-working-patterns)
- [Non-obvious API behaviors](#non-obvious-api-behaviors)
- [Tenant facts to discover once](#tenant-facts-to-discover-once)
- [Past-self warnings](#past-self-warnings)

---

## Symptom → Likely cause map

| Symptom | First thing to check | Detail |
|---|---|---|
| `404 Resource not found` on what looks like a documented endpoint | Am I using the exact path from the API reference? | Endpoints live under surprising domains (e.g. `updateInvoiceIssueDate` is under `/v1/contracts/`, not `/v1/invoices/`). See endpoint-matrix.md §16. |
| `400 Can't void invoice because its status is not finalized: DRAFT` | Invoice is still DRAFT | Void only works on FINALIZED. Wait for auto-finalize (USAGE: period end + grace window, SCHEDULED past-dated: immediate) or archive the contract with `void_invoices:true` (danger-zone §1.1 first). See danger-zone §3. |
| `400 Invalid custom field keys: <key>` | Key not whitelisted for that entity type | Call `POST /v1/customFields/addKey` first, or embed data in an allowlisted key (e.g. `grant_reason`). See endpoint-matrix §8. |
| `400 instance failed to match exactly one schema` on `/v2/contracts/edit` | You're trying to do something editContract can't do, OR a dedicated endpoint exists | Check for a dedicated endpoint first: `updateEndDate`, `updateInvoiceIssueDate`, `commits/updateEndDate`. See §9/§10. |
| Stripe shows $X collected but Metronome shows $0 invoiced | You voided a FINALIZED invoice without refunding Stripe | Voiding in Metronome doesn't touch Stripe. Either `POST /v1/invoices/regenerate` (to re-bill in Metronome) or refund in Stripe manually. See danger-zone §1.1. |
| RENEWAL dropped prepaid balance to 0 mid-term | Predecessor commit had `rollover_fraction: 0` | RENEWAL only carries `balance * rollover_fraction`. Treat rollover 0 as hard credit loss on a package move; restore via a ledger adjustment onto the zeroed successor commit before declaring done. |
| "User's credits disappeared" | Contract transitioned (RENEWAL to a lower tier, or archive) with `rollover_fraction: 0` | Check `transitions[]` in `/v2/contracts/list` for the pattern `paid_tier → PAYG/trial`. See danger-zone §9 (stale webhook handler incident). |
| Usage event doesn't show up on invoice | Billable metric didn't exist at ingestion time, or event timestamp too old | Metrics aren't retroactive. Ingest back-date window is 34 days. See `metronome-ingestion-events`. |
| `contract-pricing/products/get` missing fields | You're reading the wrong level | Access `data.current.name` / `data.current.type`, NOT top-level `data.name`. |
| Stripe invoice finalized immediately despite "Leave as drafts" setting | It was a past-dated SCHEDULED charge | Past-dated scheduled invoices bypass the drafts setting. See danger-zone §1.5. |
| Customer got charged on the old plan after a scheduled downgrade | The downgrade was scheduled off the customer's actual billing cadence | Check the last paid plan invoice, recurring commit/access window, and future drafts. Recommended practice: cut over at the next natural boundary on the existing cadence (e.g. June 14 → July 14), not a calendar-month date, unless an off-cycle correction is explicitly approved. See `metronome-packages-contracts`. |
| Expired trial or lapsed customer cannot upgrade | Backend passes `transition: RENEWAL` + `from_contract_id` on `contracts/create` when the predecessor's `ending_before` is already in the past | Create a fresh contract **without** `transition`. A plan-move (truncate + RENEWAL) only applies to an open-ended or still-active predecessor. |
| `metro contract move-plan` fails "Expected exactly 1 open-ended contract" | Customer is on a trial (`ending_before` set) or has only expired contracts | For lapsed customers, create a fresh contract; for an active trial → paid, truncate the trial then create the paid contract. |
| Commit shows balance but "expires" unexpectedly | `access_schedule.schedule_items[].ending_before` was hit | Use `rollover_fraction: 1` to carry unused forward, or set `ending_before` far in the future (~100-year convention). |
| `POST /v1/contracts/archive` voids more than expected | You set `void_invoices: true` | That flag voids ALL invoices including FINALIZED+paid ones. See danger-zone §1.1. To target one invoice only, don't archive - void that one invoice after it finalizes. |
| `POST /v1/contracts/create` rejects `commits`/`overrides` | You're using `package_alias` | Package contracts accept only a small set of fields (`customer_id`, `starting_at`, `package_alias`/`package_id`, `transition`, `uniqueness_key`, `custom_fields`, ...). Add the rest via `/v2/contracts/edit` immediately after. |
| Auto-generated USAGE invoice shows quantity 0 but still has a total | "Applied credit" lines are negative | Line `type: "applied_commit_or_credit"` with `total: -N` reduces net. Sum `type=usage` minus `type=applied_commit_or_credit` to get cash-billable. |
| Parent customer balance wrong (hierarchy) | Shared commit not visible to children | Check `customerBalances/list` on the CHILD with `include_contract_balances: true`. See `metronome-customers-hierarchies`. |
| `409 One or more ingest aliases conflict with existing customers` on `POST /v1/customers` | Some (likely archived) customer is already holding that alias | Run `GET /v1/customers?ingest_alias=<value>` (returns archived rows too), then `POST /v1/customers/{id}/setIngestAliases { ingest_aliases: [] }` on each holder. **Works on archived customers** (verified in sandbox). No Metronome support ticket needed. See `metronome-customers-hierarchies`. |
| Lookup by an internal-ID custom field returns several archived customers | Custom fields have no uniqueness constraint | Decide: (a) clean up the duplicates by archiving + clearing aliases, or (b) prefer the most-recently-archived row when no active row exists. A 409 that follows is a separate symptom (row above). |
| App / `getNetBalance` shows MORE credits than `customerBalances/list` (e.g. `metro ops who`) | A `PREPAID_COMMIT_ROLLOVER` carried balance out to a **now-archived/expired** successor contract. `customerBalances/list` still subtracts that rollover-out from the source segment; `getNetBalance` treats it as void (destination is gone). The two disagree by exactly the rolled-out amount. | `getNetBalance` (per `credit_type_id`) is the **spendable truth**. Reconcile against it, not the per-segment `list` balance. See "Undo-a-move double credit" below. |
| After undoing a plan move (archived the successor contract), credits look like they "disappeared", then later "doubled" | Archiving/expiring the successor **auto-returns** the rolled-out balance to the predecessor, but only after the ledger settles (minutes), not in the immediate read-back | Do NOT manually restore credits off the immediate post-archive read. Wait for settle and check `getNetBalance`. A manual restore layered on top of the auto-return double-credits. |

---

## Verified working patterns

### Provision a customer from scratch (package-based)
1. `POST /v1/customers` - create the Metronome customer (optionally with `customer_billing_provider_configurations`)
2. Attach Stripe if not done in step 1: `POST /v1/setCustomerBillingProviderConfigurations`
3. `POST /v1/contracts/create` with `package_alias` (or `package_id`) - minimal payload, no extras
4. (Optional) `POST /v2/contracts/edit` to add overrides, custom commits, scheduled charges
5. `POST /v1/customFields/setValues` for any internal IDs you track (keys must be whitelisted)
6. Start `POST /v1/ingest` - events flow immediately

`metro customer setup preview` builds steps 1, 2 and 5 with collision checks.

### Mid-term rebadge onto a billing-empty package (no charge today)

1. Confirm the target package is billing-empty (`packages/get`: no recurring
   commits / subscriptions / scheduled charges).
2. `updateEndDate` on the predecessor + `contracts/create` with
   `package_alias` / `package_id` + `transition: RENEWAL`
   (`metro contract move-plan preview` builds this).
3. Prove: package id, **no money invoice**, balances.
4. If any predecessor commit had `rollover_fraction: 0`, restore the
   **remaining** balance onto the zeroed successor commit via
   `addManualBalanceLedgerEntry` (do not refill what was already burned).
5. Re-add the next commercial renewal on the successor with
   `/v2/contracts/edit` `add_commits[]` + a future `invoice_schedule`
   (predecessor DRAFTs are gone).

### Grant complimentary credits to an existing customer

For a pure access grant with no invoice artifact, omit `invoice_schedule`.
Use a USD-denominated `$0` `invoice_schedule` only when an audit line is
intentional. The abbreviated `$0 audit-line` variant:

```js
await m.post('/v2/contracts/edit', {
  customer_id, contract_id,
  add_commits: [{
    type: 'PREPAID',
    product_id: PLAN_PRODUCT_ID,
    name: '500 Complimentary Credits - goodwill',
    priority: 2,
    rollover_fraction: 1,
    applicable_product_tags: ['<PRODUCT_TAG>'],
    access_schedule: {
      credit_type_id: CUSTOM_CREDIT_TYPE_ID,      // your custom credit unit
      schedule_items: [{
        amount: 500,
        starting_at: '2026-01-01T00:00:00.000Z',
        ending_before: '2126-01-01T00:00:00.000Z'  // no-expiry convention
      }]
    },
    invoice_schedule: {                              // optional; only for $0 audit line
      credit_type_id: USD_CENTS_CREDIT_TYPE_ID,      // must be fiat
      schedule_items: [{ timestamp: '2026-01-01T00:00:00.000Z', unit_price: 0, quantity: 1 }]
    },
    custom_fields: {                                 // keys must be whitelisted
      grant_reason: '...',
      granted_by: '...',
      granted_by_email: '...',
      granted_at: new Date().toISOString()
    }
  }]
});
```

`metro credit preview --shape complimentary-credit-grant` builds and checks
this shape. Commit shapes in depth: `metronome-packages-contracts`.

### Plan change via package_alias + transition

#### What is verified

1. `transition.type: SUPERSEDE` on a `package_alias` contract creation
   returns
   `400 {"message":"Supersede transitions are not supported for package contracts"}`.
   SUPERSEDE is for direct contracts only.

2. The 2-step pattern below works for package transitions in production:

```js
// Step 1: truncate predecessor explicitly.
await m.post('/v1/contracts/updateEndDate', {
  customer_id:                            CUSTOMER_ID,
  contract_id:                            OLD_CONTRACT_ID,
  ending_before:                          cutoverAt,
  allow_ending_before_finalized_invoice:  false,
});

// Step 2: create successor on new package with RENEWAL transition.
await m.post('/v1/contracts/create', {
  customer_id:    CUSTOMER_ID,
  starting_at:    cutoverAt,                 // == predecessor's new ending_before
  package_alias:  TARGET_ALIAS,              // e.g. 'payg'
  uniqueness_key: `plan-change:${CUSTOMER_ID}:${OLD_CONTRACT_ID}:${TARGET_ALIAS}:${cutoverAt.slice(0, 10)}`, // max 128; date-only
  transition: {
    type:             'RENEWAL',
    from_contract_id: OLD_CONTRACT_ID,
  },
});

// Step 3 (if granting credits on the successor):
//   POST /v2/contracts/edit { customer_id, contract_id: <new>, add_commits: [...] }
```

Two UUIDs plus an alias already use ~90 characters of the 128-character
`uniqueness_key` limit, which is why the date suffix is date-only.

#### What the docs claim that is NOT verified here

Per [apply-credits-commits](https://docs.metronome.com/pricing-packaging/apply-credits-commits)
and [lifecycle-transitions](https://docs.metronome.com/manage-product-access/lifecycle-transitions),
a contract renewal ends the current contract and its future recurring
charges, and a mid-period upgrade can be done by creating a new contract
starting today with a Renewal transition from the previous contract.

The docs imply that a **single-call RENEWAL** alone (no prior
`updateEndDate`) ends the predecessor, even mid-term. That is not verified
here. Two cases worth canarying separately before adopting single-call
RENEWAL:

- Predecessor with an explicit `ending_before` (the doc-shown case).
- Predecessor that is **open-ended** (the docs don't address whether
  RENEWAL ends an open-ended predecessor).

Recommended practice until you canary: **prefer the 2-step** - it's
verified, and the cost is one extra API call.

#### Direct (non-package) contracts

For DIRECT contracts (explicit `rate_card_id` + `commits[]`), single-call
SUPERSEDE MAY work - the 400 error is explicitly scoped to "package
contracts", and SUPERSEDE may be gated per client. Unverified; canary
before relying.

Full payload, decision tree, and verification snippet:
`metronome-packages-contracts § Transitions`.

### Watch a DRAFT invoice until finalize, then void
Use the watcher pattern (danger-zone §4, `metronome-invoicing`
`references/watcher-pattern.md`). Poll every 20s, cap at a ~26h deadline.
Key insight: checking `status: VOID` first and treating "not found in list"
as "gone" handles all three possible transitions (self-voids via archive,
voids via another process, or finalize → void).

### Audit all customers for a specific contract transition pattern
Use this after any bug that touched one customer, to answer "did anyone
else hit this?":
1. Seed a customer list (export, or page through `GET /v1/customers`)
2. For each customer: `POST /v2/contracts/list` with `include_archived: true`
3. Walk `contracts[].transitions[]` looking for a `from_contract` matching
   the source pattern (e.g. a paid tier) and a `to_contract` in the "bad"
   state (e.g. PAYG or trial)
4. Dedupe by `(customer_id, to_contract_id)`
5. Keep entries where the source contract had a finalized paid
   `invoice_schedule.schedule_items[]` (confirms real money was involved)

A sweep over ~140 customers at a 5 requests/second throttle takes roughly
75 seconds. Run long sweeps as a background job writing to a file.

### Release an ingest alias held by an archived customer

When `POST /v1/customers` 409s with `One or more ingest aliases conflict
with existing customers`, an archived customer is almost certainly
holding the alias. Recovery (verified in sandbox):

```js
// Find holders - the alias filter returns archived rows too
const res = await m.get(
  `/v1/customers?ingest_alias=${encodeURIComponent(alias)}`
);
const holders = res.data ?? [];

// Release on each (works regardless of archived state)
for (const c of holders) {
  await m.post(`/v1/customers/${c.id}/setIngestAliases`, {
    ingest_aliases: [],
  });
}
// Now POST /v1/customers with ingest_aliases: [alias] succeeds.
```

Both archived holders returned 200 OK and the alias became immediately
reassignable. Recommended practice is still to call
`setIngestAliases([])` BEFORE archiving so this recovery isn't needed, but
if someone archived from the dashboard without clearing aliases, you don't
need a Metronome support ticket. An alternative is renaming the alias
(e.g. `archived:<alias>`) if you want a forensic trail.

### Bridge contract to avoid service gaps during remediation
When you need to archive contract A and create contract B with a non-zero
gap between, create a tiny direct contract for the gap:

```js
await m.post('/v1/contracts/create', {
  customer_id,
  starting_at: gapStart,   // hour boundary
  ending_before: gapEnd,   // hour boundary
  rate_card_id: RATE_CARD_ID,  // direct contract (not package)
  // commits for temporary credits, etc.
});
```
Minimum useful duration: 1 hour.

---

## Non-obvious API behaviors

### Method matters: customer endpoints are GET, most others POST
Most "list" / "get" endpoints are POST. EXCEPTIONS:
- Customer listing / fetch: `GET /v1/customers`, `GET /v1/customers/{id}`
- Invoice listing: `GET /v1/customers/{id}/invoices`
- Credit types (pricing units): `GET /v1/credit-types/list`
- Audit logs: `GET /v1/auditLogs`
- Service IPs: `GET /v1/services`

Older notes may show `/v1/pricingUnits`, `/v1/security/auditLogs`, or
`/v1/security/services`; check `endpoint-matrix.md` and the current API
reference. If you get a 404 on a POST, try GET + query string.

### Past-dated SCHEDULED charges bypass "Leave as drafts"
If you `/v2/contracts/edit` with `add_scheduled_charges` whose `issued_at` is
in the past, that invoice **finalizes immediately and pushes to Stripe
within seconds**. The account-level/customer-level "Leave as drafts" setting
does NOT apply. Metronome documents this explicitly - use the dedicated
endpoints instead if you want to avoid immediate billing.

### Invoices don't auto-delete - only transition
Once created, an invoice only transitions DRAFT → FINALIZED → VOID. You
can't delete a DRAFT via a dedicated endpoint. Workarounds:
- Archive the parent contract with `void_invoices: true` (also voids
  finalized ones - dangerous)
- `POST /v2/contracts/edit` `remove_scheduled_charges` (only for scheduled
  charges YOU added via `add_scheduled_charges`; doesn't work for
  auto-generated USAGE invoices)
- Wait for auto-finalize, then `void`

### Contract transitions form a DAG
A contract has `transitions[]`, each entry pointing to `from_contract_id`
and `to_contract_id`. `RENEWAL` is normal (contract ends, successor
starts). `SUPERSEDE` is an archive-and-replace. Walking transitions lets
you reconstruct the full billing history for a customer even across
archived records.

### `customerBalances/list` vs `getNetBalance` vs `listBalances`
- `customerBalances/list` - full detail per commit/credit (schedules, contract scope, custom fields). Use when auditing.
- `customerBalances/getNetBalance` - single aggregated number per credit type across a filter. Use for dashboards and as spendable truth (see the symptom map).
- `contracts/listBalances` - newer endpoint with slightly different filtering semantics.

For hierarchy accounts: run both parent and child balance queries - shared
commits show up under both but with different filtering.

### Stripe integration semantics
- Metronome → Stripe push happens on FINALIZED.
- Voiding in Metronome marks Metronome's record VOID but does NOT refund or
  void in Stripe. Reconciliation is the integrator's responsibility.
- `external_invoice.id` on a Metronome invoice is the Stripe invoice ID.
- Failures to push to Stripe surface as `external_invoice.status ∈ {PAYMENT_FAILED, INVALID_REQUEST_ERROR}` on the Metronome invoice.

---

## Tenant facts to discover once

Look these up once per tenant and keep them in your workspace notes (never
in a public repo if they identify customers):

| What | How |
|---|---|
| Built-in USD (cents) credit type | `2714e483-4ff1-48e4-9e25-ac732e8f24f2` (same for every tenant; appears throughout the public docs) |
| Your custom credit type(s) | `GET /v1/credit-types/list` |
| Rate cards per tier | `POST /v1/contract-pricing/rate-cards/list` (or `metro catalog bind --sandbox --write`) |
| Package aliases | `POST /v1/packages/list` |
| Whitelisted custom field keys per entity | `POST /v1/customFields/listKeys` |

### Invoice line types you will see
- Plan fees: `SCHEDULED` invoices, line type `fixed`
- Usage: `USAGE` invoices, line types `usage`, `cpu_conversion`, `applied_commit_or_credit`
- `cpu_conversion` lines convert a custom credit type to fiat at the
  rate card's `credit_type_conversions` rate

---

## Past-self warnings

Specific mistakes, with the lesson attached.

### From a paid-to-trial downgrade remediation (danger-zone §9)

1. **Assumed `POST /v1/invoices/updateIssueDate` was the path.** Wrong - it's
   `POST /v1/contracts/updateInvoiceIssueDate`. A `404` means "not deployed"
   OR "wrong path"; always check the API reference before marking an
   endpoint as missing.

2. **Assumed archiving any contract with `void_invoices: true` is safe.**
   Wrong - it voids EVERY invoice on the contract, including FINALIZED and
   already paid in Stripe. That created a Stripe-collected /
   Metronome-$0-billed delta. Better path: void only the specific invoice
   after it finalizes with `POST /v1/invoices/void`, and leave paid
   invoices intact.

3. **Tried `/v2/contracts/edit` `update_contract_end_date` to end a
   contract.** Got a 400 schema error. Real answer: the dedicated
   `/v1/contracts/updateEndDate` with `ending_before` +
   `allow_ending_before_finalized_invoice`. Always check for a dedicated
   endpoint before forcing it through editContract.

4. **Added an `incident_ref` custom field key on a commit without
   whitelisting it first.** 400 rejected. Fix: `POST
   /v1/customFields/addKey` first, or reuse an existing key such as
   `grant_reason`.

5. **Initially didn't bridge the time gap** between archiving the bad
   contract and the replacement's activation, which would have left the user
   with no active plan for a while. A 1-hour bridge contract fixed it.
   Always trace the timeline of contract activations around a remediation
   and look for gaps.

### General - things done more than once and regretted

- **Writing a new API call without checking for prior working usage.**
  Check `endpoint-matrix.md`, `metro api explain <endpoint-id>`, and your
  own codebase first. The right payload often already exists.
- **Not running a tiny read-only verify step between destructive calls.**
  A read-back after each step saves hours of debugging when something went
  sideways two steps ago. Bake it in.
- **Ignoring `uniqueness_key` on contract create.** Retrying a failed
  contract create without a key produced a duplicate contract. Use a stable
  `uniqueness_key` (1-128 characters; reuse returns 409) on every create.

---

## EXTERNAL payment gate - sandbox findings

Full live test on a sandbox customer and contract.

### `payment_gate_config: { payment_gate_type: "EXTERNAL" }` on a PREPAID commit

**Setup:**
- Add via `POST /v2/contracts/edit` → HTTP 200, no `tax_type`, no `stripe_config` needed
- `invoice_schedule.timestamp` must be in the past (≥5 min ago is safe)
- `access_schedule.starting_at` must be on a UTC hour boundary

**Hold state:**
- Commit is NOT visible in `contracts/get` commits array until released
- A DRAFT Metronome SCHEDULED invoice is created immediately
- `external_invoice: null` - no Stripe invoice, no billing-provider interaction
- Balance unchanged - credits are withheld

**`payment_gate.external_initiate` webhook (observed shape):**
```json
{
  "id": "<webhook-event-uuid>",
  "type": "payment_gate.external_initiate",
  "properties": {
    "workflow_type": "manual_commit",
    "customer_id": "00000000-0000-4000-8000-000000000001",
    "contract_id": "00000000-0000-4000-8000-000000000002",
    "invoice_id": "00000000-0000-4000-8000-000000000005",
    "workflow_id": "00000000-0000-4000-8000-000000000006",
    "invoice_total": 250,
    "invoice_currency": "usd"
  }
}
```
Notes: no `commit_id` in the payload; `invoice_currency` is lowercase;
`workflow_id` is a fresh UUID generated by Metronome - it is NOT the invoice
ID and NOT the commit ID.

**Release (`POST /v1/contracts/commits/threshold-billing/release`):**
- Body: `{ workflow_id: "<from webhook>", outcome: "paid" }` (or `"failed"`)
- Returns `""` (empty string) on HTTP 200 - not `{}`
- After a paid release: the commit materializes in `contracts/get`, and the invoice becomes FINALIZED
- `payment_gate.payment_status` fires: `{ type: "payment_gate.payment_status", properties: { workflow_type: "manual_commit", customer_id, contract_id, invoice_id, payment_status: "paid", timestamp } }` - no `billing_provider` field for EXTERNAL gates
- Credits become accessible only after `access_schedule.starting_at` (release does not override the access window)

**NOT idempotent:** a second release returns HTTP 400 `"Workflow ... is not in COMMITTING state - is actually in state COMMITTED"`. Your webhook handler must guard against calling release twice.

**`workflow_id` is webhook-only:** no Metronome API endpoint returns it. It
cannot be derived from invoice_id, commit_id, or any query. Store it when
you receive the `external_initiate` webhook.

**Contrast with `payment_gate_type: "STRIPE"`:**
- STRIPE always auto-charges via Stripe (ignores a `send_invoice` billing-provider config, ignores "leave invoices in draft")
- STRIPE fails silently if there is no default payment method or the charge fails → invoice voided → commit never created
- STRIPE-gated commits appear in `contracts/get` immediately after payment succeeds
- EXTERNAL is Stripe-free and gives your app full control; a good fit for invoice/wire-pay enterprise flows

---

## Undo-a-move double credit + list-vs-net divergence (anonymized)

**What happened (chain of events):**
1. An accidental plan move (RENEWAL) from a paid tier to a free tier. At
   cutover, the customer's three paid credit buckets rolled OUT of the paid
   contract onto the new free contract (`PREPAID_COMMIT_ROLLOVER`), and a
   trial grant was stripped.
2. Undo: archived the free contract (`void_invoices: true`) and restored the
   paid contract's `ending_before`. Archiving expired the free contract's
   rolled-in buckets (`PREPAID_COMMIT_EXPIRATION`).
3. **The mistake:** the immediate post-archive read still showed the three
   paid buckets at 0 (the auto-return of the rolled-out balance had not
   settled), so the operator manually restored each bucket's full amount with
   `addManualBalanceLedgerEntry`. Once settle completed, each segment counted
   `SEGMENT_START (+N)` **plus** the `MANUAL (+N)`, so the customer's
   spendable balance jumped well above the true total.

**Two API surfaces disagreed and hid it:**
- `customerBalances/list` per-segment `balance` subtracts the now-void
  rollover-out, so it reported each bucket at N and the total looked correct
  (masking the bug).
- `getNetBalance {credit_type_id: <custom credit type>}` ignores the void
  rollover-out, so it showed 2N per bucket. This is the number the customer's
  app shows and spends against. `getNetBalance` is the source of truth.

**Diagnosis method:** fetching the archived free contract's buckets with
`include_archived: true` showed all 0 with `PREPAID_COMMIT_EXPIRATION`. That
ruled out "stuck credits on the archived contract" and proved the duplicate
lived on the active paid segments as the extra `MANUAL` entries.

**Fix:** reversed exactly the three manual entries (`amount: -N` on each
balance id). Canaried one first and checked `getNetBalance`, then reversed
the other two, landing back on the original total.

**Residual artifact (tell the next operator):** the rollover-out entries
still point at the archived contract and can't be deleted, so `list` now
subtracts them AND the correcting `-N`. `customerBalances/list` (and tools
built on it) show those buckets at **0**, while the real spendable balance is
the `getNetBalance` number. Do NOT "top up" off the `list` number - you'll
re-create the over-credit.

**Lessons:**
1. Reconcile credits against `getNetBalance` per `credit_type_id`, not the
   per-segment `list` balance, whenever a rollover to an archived/expired
   contract is in the history.
2. Undoing a move by archiving the successor auto-returns the rolled-out
   balance to the predecessor - after settle. Never manually restore off the
   immediate post-archive read; wait and confirm with `getNetBalance`.
3. Any credit read-back that "matches" on the first pull after a move/undo is
   suspect until it still matches minutes later (rollover materialization lag).
