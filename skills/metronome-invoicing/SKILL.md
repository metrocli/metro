---
name: metronome-invoicing
description: >-
  The Metronome invoice object, its DRAFT → FINALIZED → VOID state machine, and
  every operation you can perform on an invoice: list/get, void, regenerate,
  preview, breakdowns, PDFs, retroactive historical invoices, and watching a
  DRAFT across its auto-finalize transition. Use when the user says "void this
  invoice", "regenerate the invoice", "kill this draft", "invoice state", "when
  does this invoice finalize", "invoice status", "DRAFT", "FINALIZED",
  "auto-finalize", "invoice preview", "invoice breakdown", "invoice PDF",
  "payment attempt", "createHistoricalInvoices", "updateInvoiceIssueDate",
  "retroactive invoice", "past-dated invoice", "credits conversion line",
  "watcher pattern", "invoice watcher", or asks about invoice types
  (USAGE, SCHEDULED, AD_HOC, PARENT_INVOICE, CHILD_INVOICE), invoice line types
  (usage, fixed, applied_commit_or_credit, cpu_conversion, subscription), or
  how to cancel a DRAFT that can't be voided. Do NOT use for Stripe-side
  questions ("why didn't it push to Stripe", external_invoice reconciliation,
  delivery_method) - that's metronome-stripe-delivery. Do NOT use for
  editContract mechanics - that's metronome-packages-contracts. Do NOT use for
  the SHAPE of commits/credits (access_schedule, invoice_schedule, rollover) -
  that's metronome-packages-contracts.
---

# Metronome Invoicing

> Before calling any Metronome endpoint, verify paths against
> `metronome-danger-zone/references/endpoint-matrix.md` §11 (Invoices) and §12
> (Payments). If this skill and the endpoint-matrix disagree, the
> endpoint-matrix wins.

## Purpose

Everything about the invoice object once it exists: what type it is, what state
it's in, what you can do to it, and what happens to Stripe when you do. Fires
for any task that reads, alters, or waits on a Metronome invoice - including
the "I don't want this DRAFT to bill" problem, the "void and reissue" workflow,
and retroactive invoice generation.

## Prerequisites

See `skills/_metronome-shared/conventions.md` for base URL, auth,
credit type IDs, timestamp rules, and the error-shape quick reference.
For **which bearer token** (prod vs sandbox), see the `metro` skill: pass
`--sandbox` or `--prod` explicitly.
Key reminders that matter here:
- `GET /v1/customers/{id}/invoices` is a **GET with query string**, not POST.
- `POST /v1/invoices/void` uses `{ id }`, **not** `{ invoice_id }`.
- Invoice-related "update issue date" lives under **`/v1/contracts/`**, not
  `/v1/invoices/` - easy 404 trap.

## Mental model

An invoice is a materialized billing statement attached to a contract on a
customer. It's created by Metronome (USAGE at period start, SCHEDULED per
`add_scheduled_charges` / commit `invoice_schedule`, CHILD_INVOICE by hierarchy
aggregation) or by us (AD_HOC via `addCharge`, HISTORICAL via
`createHistoricalInvoices`). Once created it walks the state machine below.
**Metronome never gives you a manual "finalize" button** - auto-finalize
timing is the only lever, and it varies by type. Voiding is the only way to
cancel a FINALIZED invoice, and voiding in Metronome does **not** refund
Stripe.

```
                auto-finalize (per type, §Auto-finalize timing)
  DRAFT ───────────────────────────────────────────────────────────► FINALIZED
    │                                                                    │
    │ (parent contract archived with void_invoices: true)                 │ /v1/invoices/void
    │                                                                    ▼
    └─────────────────────────────────────────────────────────────────► VOID
                                                                         │
                                                                         │ /v1/invoices/regenerate
                                                                         ▼
                                                                     NEW DRAFT
                                                                     (new id)
```

## Invoice types

| Type | Who creates it | When | Pushes to Stripe? |
|---|---|---|
| `USAGE` | Metronome | Period start (DRAFT), finalizes 24h after period end | Yes if total > $0 and billing config active |
| `SCHEDULED` (future-dated) | `add_scheduled_charges` / commit `invoice_schedule` | At the scheduled timestamp | Yes, subject to `leave_stripe_invoices_in_draft` |
| `SCHEDULED` (past-dated via edit) | `/v2/contracts/edit add_scheduled_charges` with past `timestamp` | **Immediately on edit; bypasses drafts setting** | Yes - **immediately** to Stripe |
| `AD_HOC` | `POST /v1/customers/{id}/addCharge` | On call | Yes |
| `PARENT_INVOICE` / `CHILD_INVOICE` | Hierarchy aggregation (a.k.a. `USAGE_CONSOLIDATED`) | Per the owning USAGE cycle | Parent pushes; children reference parent |
| `HISTORICAL` | `POST /v1/contracts/createHistoricalInvoices` | Immediately FINALIZED | **Never** (by design) |

Filter-visible `status` on all of the above: `DRAFT` | `FINALIZED` | `VOID`.

## Auto-finalize timing

**There is no `POST /v1/invoices/finalize`.** It doesn't exist - past guesses
404'd. To move a DRAFT to FINALIZED you wait, and the wait rules are:

| Invoice type | `issued_at` | Auto-finalizes at |
|---|---|---|
| `USAGE` | Period end | `period_end + 24h` grace window |
| `SCHEDULED` (future-dated) | Scheduled timestamp | That timestamp, subject to `leave_stripe_invoices_in_draft` - setting keeps Stripe-side in DRAFT but Metronome-side still finalizes per schedule |
| `SCHEDULED` (past-dated, created via edit) | "Now" | **IMMEDIATELY; bypasses drafts setting** - see `metronome-danger-zone` §1.5 |
| Commit `invoice_schedule` lines | Per schedule | Same as SCHEDULED |
| `HISTORICAL` | Immediate | Immediate |

### Choosing a SCHEDULED issue time (recommended practice)

Do not pick a production `starting_at` / SCHEDULED issue time on your own;
ask the human who owns billing. The tradeoff is real: a **future** issue time
(for example the next hour) can leave invoices in `DRAFT` for up to ~2h30
after contract creation, while the **current UTC hour floor** is usually
already past at create time and finalizes faster. See [How invoicing works -
SCHEDULED finalization](https://docs.metronome.com/guides/implement-metronome/core-concepts/how-invoicing-works).

For plan changes, do the cadence pre-flight in `metronome-packages-contracts`
first: identify the customer's last paid plan invoice, current paid access
window, and next natural renewal boundary. Default to the predecessor's
cadence; a first-of-month cutover is only safe if the current plan already
bills on the first or the owner explicitly approves an off-cycle change. If
`leave_stripe_invoices_in_draft` is in play, review `metronome-danger-zone`
§1.5 before applying.

## Endpoint inventory

| Method + Path | Purpose | Official docs |
|---|---|---|
| `GET /v1/customers/{id}/invoices?limit=N&status=...&next_page=...` | List invoices for a customer | [list-invoices](https://docs.metronome.com/api-reference/invoices/list-invoices.md) |
| `GET /v1/customers/{customer_id}/invoices/{invoice_id}` | **Documented path** for fetching one invoice with full `line_items[]`. GET + path params | [get-an-invoice](https://docs.metronome.com/api-reference/invoices/get-an-invoice.md) |
| `POST /v1/invoices/get` `{ id }` | Undocumented POST alias - has worked in practice, but docs only list the GET above. Prefer the GET | - (not in docs) |
| `GET /v1/customers/{id}/invoices/{invoice_id}/pdf` | Fetch rendered PDF | [get-an-invoice-pdf](https://docs.metronome.com/api-reference/invoices/get-an-invoice-pdf.md) |
| `GET /v1/customers/{customer_id}/invoices/breakdowns` | Hourly/daily time-series breakdown of an invoice's usage lines. **GET with path-style customer_id**, not POST. Query params: `limit`, `window_size`, `starting_on`, `ending_before`, etc. | [list-invoice-breakdowns](https://docs.metronome.com/api-reference/invoices/list-invoice-breakdowns.md) |
| `POST /v1/invoices/preview` | Preview how a batch of events would affect invoices | [preview-events](https://docs.metronome.com/api-reference/invoices/preview-events.md) |
| `POST /v1/invoices/void` | Void a **FINALIZED** invoice - body `{ id }`. DRAFT fails with 400. Does NOT refund Stripe. | [void-an-invoice](https://docs.metronome.com/api-reference/invoices/void-an-invoice.md) |
| `POST /v1/invoices/regenerate` | Regenerate a **VOIDED** invoice with current rates/balances → produces a NEW invoice id | [regenerate-an-invoice](https://docs.metronome.com/api-reference/invoices/regenerate-an-invoice.md) |
| `POST /v1/payments/list` | List payment attempts for one invoice. **Path is `/v1/payments/*`, NOT `/v1/invoices/payments/*`** (an easy prefix mistake). Body requires `{ customer_id, invoice_id }`, `limit` max 25 | [list-payments-for-an-invoice](https://docs.metronome.com/api-reference/payments/list-payments-for-an-invoice.md) |
| `POST /v1/payments/attempt` | Force a new Stripe payment attempt. Body requires `{ customer_id, invoice_id }` | [attempt-payment-for-an-invoice](https://docs.metronome.com/api-reference/payments/attempt-payment-for-an-invoice.md) |
| `POST /v1/payments/cancel` | Cancel a pending payment attempt | [cancel-a-payment-for-an-invoice](https://docs.metronome.com/api-reference/payments/cancel-a-payment-for-an-invoice.md) |
| `POST /v1/contracts/createHistoricalInvoices` | Create retroactive USAGE invoices for past periods | [create-historical-invoices](https://docs.metronome.com/api-reference/contracts/create-historical-invoices.md) |
| `POST /v1/contracts/updateInvoiceIssueDate` | Push a DRAFT invoice's issue date forward (DRAFT ONLY; ≤ contract end). Path is under `/contracts/`, not `/invoices/`. | [update-invoice-issue-date](https://docs.metronome.com/api-reference/contracts/update-invoice-issue-date.md) |

**List filter enums** (for `GET /v1/customers/{id}/invoices`): `status` ∈
`{ DRAFT, FINALIZED, VOID }` (uppercase); also `credit_type_id`,
`starting_on`, `ending_before`, `sort ∈ { date_asc, date_desc }`,
`skip_zero_qty_line_items`.

## Line item types

Seen on `invoice.line_items[]`. Exact shape varies per type, but all share
`product_id`, `quantity`, `unit_price`, `total`, `list_price`.

| `type` | Meaning |
|---|---|
| `usage` | A per-product usage aggregation - metered consumption × rate |
| `fixed` | A fixed-price line (plan fee, one-time charge) |
| `subscription` | Per-seat subscription charge (from `SubscriptionProductListItem`) |
| `scheduled` | From `add_scheduled_charges` |
| `commit_purchase` | The line that sells a commit (POSTPAID trueup, PREPAID invoice at schedule time) |
| `applied_commit_or_credit` | A NEGATIVE line that burns a commit/credit against other lines - carries `commit_id` |
| `cpu_conversion` | **Credits → USD collapse line on Stripe-delivered invoices.** See "Credits-conversion transparency" below. |

## Working payloads

### List invoices for a customer (canonical)

Path-style GET - the POST variant 404s.

```js
const r = await m.raw.get(
  `/v1/customers/${customerId}/invoices?limit=50&status=DRAFT&sort=date_desc`
);
const invoices = r.data?.data || [];
```

Pagination: append `&next_page=<token>` from the previous response.

### Get one invoice with full line items

```js
// Documented path - GET with customer_id + invoice_id in the path:
const r = await m.raw.get(`/v1/customers/${customerId}/invoices/${invoiceId}`);
const inv = r.data?.data;
console.log(inv?.status, inv?.total, inv?.line_items?.length);

// Undocumented POST alias (has worked, but not in public docs).
// Prefer the GET above for new code.
// await m.post('/v1/invoices/get', { id: invoiceId });
```

Use this (not the list endpoint) when you need `line_items[]` - list responses
often omit per-item detail.

### Void a FINALIZED invoice

```js
await m.post('/v1/invoices/void', { id: invoiceId });
```

- Body key is `id`, not `invoice_id`.
- Fails on DRAFT: `400 Can't void invoice because its status is not finalized:
  DRAFT` - see the decision tree below.
- **Does NOT refund Stripe.** Before voiding a paid, Stripe-pushed invoice,
  run the §7 reconciliation checklist in `metronome-danger-zone` and surface
  the dollar delta to the user first.

### Regenerate a voided invoice

```js
const r = await m.post('/v1/invoices/regenerate', { id: voidedInvoiceId });
const newInvoice = r.data;          // different id than the voided one
```

Use when you voided an invoice to correct rates/balances and want Metronome to
re-compute and reissue. Result is a **new invoice id**; update any ledger that
references the old id.

### Preview how events would land

Dry-run usage before ingesting - answers "what would this month's invoice look
like if I ingest these events?".

```js
await m.post('/v1/invoices/preview', {
  customer_id: '<uuid>',
  events: [ /* same shape as /v1/ingest, up to 100 */ ],
  mode: 'replace',             // or 'merge'
  skip_zero_qty_line_items: true,
});
```

### Hourly/daily breakdown on one invoice

```js
// GET with query string - NOT a POST
const r = await m.raw.get(
  `/v1/customers/${customerId}/invoices/breakdowns`
    + `?window_size=day&limit=35`
    + `&starting_on=${periodStartIso}&ending_before=${periodEndIso}`,
);
const breakdowns = r.data?.data || [];
```

Good for the "why is this invoice $X" drilldown - returns per-window line
subtotals. Response caps: **35 days** for daily, **24 hours** for hourly
per request (per docs).

### Fetch the rendered PDF

```js
const pdf = await m.raw.get(
  `/v1/customers/${customerId}/invoices/${invoiceId}/pdf`,
  { responseType: 'arraybuffer' }
);
require('fs').writeFileSync('invoice.pdf', pdf.data);
```

### Create retroactive USAGE invoices (historical)

When you need to import past periods without re-ingesting events - e.g., a
migration from another billing system.

```js
await m.post('/v1/contracts/createHistoricalInvoices', {
  invoices: [{
    customer_id: '<uuid>',
    contract_id: '<uuid>',
    credit_type_id: '2714e483-4ff1-48e4-9e25-ac732e8f24f2', // USD cents
    inclusive_start_date: '2026-01-01T00:00:00Z',
    exclusive_end_date:   '2026-02-01T00:00:00Z',
    issue_date:           '2026-02-01T00:00:00Z',
    usage_line_items: [{
      product_id: '<uuid>',
      inclusive_start_date: '2026-01-01T00:00:00Z',
      exclusive_end_date:   '2026-02-01T00:00:00Z',
      quantity: 1000,
    }],
  }],
  preview: true,   // flip to false to commit
});
```

- Product must be on the contract's rate card.
- FIXED products can't be used here.
- **Historical invoices never push to Stripe** - by design, this is a ledger
  import, not a billing action. If you need to also bill retroactively via
  Stripe, that's a past-dated `add_scheduled_charges` (different code path,
  see `metronome-danger-zone` §1.5 for the "immediate Stripe push" warning).
- Pair with `usage_statement_schedule.invoice_generation_starting_at` on the
  contract so Metronome doesn't auto-generate overlapping USAGE invoices.

### Push a DRAFT's issue date

Only works on DRAFT; the new date must be ≤ contract end. Path lives under
**`/v1/contracts/`** - not `/v1/invoices/`.

```js
// Docs require ONLY { invoice_id, issue_date } - customer_id / contract_id
// are NOT in the schema for this endpoint.
await m.post('/v1/contracts/updateInvoiceIssueDate', {
  invoice_id:  '<uuid>',         // must currently be DRAFT
  issue_date:  '2026-05-01T00:00:00Z',
});
```

Cross-ref: `metronome-packages-contracts` owns the contract-level reasoning
around when to push an issue date; this skill owns the "it's a DRAFT, new date
is bounded by contract end" mechanics.

### Payments: list / attempt / cancel

Preconditions for `attempt` (all must hold):

1. Metronome invoice is **FINALIZED**.
2. PLG invoicing enabled on the tenant.
3. Stripe billing provider attached to the contract.
4. No successful payment already on the invoice.

```js
// Path is /v1/payments/* - NOT /v1/invoices/payments/*.
// All three require BOTH customer_id AND invoice_id in the body.
await m.post('/v1/payments/list',    { customer_id: '<uuid>', invoice_id: '<uuid>' });
await m.post('/v1/payments/attempt', { customer_id: '<uuid>', invoice_id: '<uuid>' });
await m.post('/v1/payments/cancel',  { customer_id: '<uuid>', invoice_id: '<uuid>', payment_id: '<uuid>' });
```

Stripe-side reconciliation (`external_invoice.id`, `external_invoice.status`,
comparing against `stripe.invoices.retrieve(...).paid`) is owned by
`metronome-stripe-delivery`; don't duplicate it here.

## Decision trees

### "I have a DRAFT I don't want to bill"

`/v1/invoices/void` on a DRAFT → `400 Can't void … status is not finalized:
DRAFT`. Pick exactly one of the three options:

```
Is the owning contract disposable
(no paid FINALIZED invoices on it)?
   │
   ├── YES ──► POST /v1/contracts/archive { void_invoices: true }
   │           (also voids any FINALIZED invoices - see danger-zone §1.1)
   │
   └── NO ──► Was this DRAFT created by add_scheduled_charges?
                │
                ├── YES ──► POST /v2/contracts/edit
                │           { remove_scheduled_charges: [{id: <scheduled_charge_id>}] }
                │           (cleanest; no collateral)
                │
                └── NO ──► Watcher pattern:
                           poll /v1/customers/{id}/invoices every 20s
                           DRAFT → FINALIZED → POST /v1/invoices/void { id }
                           (see references/watcher-pattern.md)
```

### "I need to correct a FINALIZED invoice"

```
Is it pushed and paid on Stripe?                 ┐
  YES → STOP. Voiding does NOT refund Stripe.    ├── reconciliation
         Use addCharge-adjustment or off-ledger  │   (metronome-stripe-delivery
         credit instead. See danger-zone §1.2.   │    owns Stripe side)
  NO  → POST /v1/invoices/void  { id }           ┘
        POST /v1/invoices/regenerate { id }  → new invoice id
        Update any downstream ledger referencing the old id
```

### "USAGE vs SCHEDULED - which invoice is this?"

| Symptom | Probable type |
|---|---|
| One per billing period, finalizes 24h after period end, contains `usage` + `applied_commit_or_credit` lines | `USAGE` |
| Finalizes exactly on a timestamp, contains `fixed` or `commit_purchase` lines | `SCHEDULED` |
| Parent has `constituent_invoices[]`; child carries child's usage | `PARENT_INVOICE` / `CHILD_INVOICE` |
| Marked HISTORICAL, never pushed to Stripe, has `correction_record`-adjacent shape | `HISTORICAL` |

### "Why does my Stripe invoice show one line called `Credits conversion`?"

Your rate card prices products in a **custom credit type** (e.g. a custom "credits" unit).
When Metronome pushes to Stripe, it converts all per-product credit usage into
a single USD line called `Credits conversion` (in Metronome line-type terms,
this shows up as `cpu_conversion`). The detail is preserved on the Metronome
USAGE invoice but collapsed on the Stripe side - this is architectural, not a
settings bug. "Display sub-line items" and "Always display quantities" don't
fix it. If the customer needs transparency, either (a) point them at the
Metronome USAGE invoice, (b) re-price in USD on the rate card, or (c) accept
the collapse.

## Edge cases & gotchas

- **No manual finalize endpoint** - `POST /v1/invoices/finalize` and any
  variant 404. Invoices move to FINALIZED only via the timing rules above.
  Don't bake a "finalize now" step into any workflow.
- **`/v1/invoices/void` body is `{ id }`** - not `{ invoice_id }`. Getting
  this wrong returns a cryptic schema error.
- **Voiding never refunds Stripe.** Always run the `metronome-danger-zone` §7
  reconciliation checklist (`external_invoice.id` → `stripe.invoices.retrieve
  (...).paid`) before voiding anything that might be paid.
- **Regenerate produces a NEW invoice id.** Any ledger, CRM custom field,
  or downstream link that referenced the voided id must be updated.
- **`updateInvoiceIssueDate` is `/v1/contracts/...`, not `/v1/invoices/...`.**
  404s blamed on "endpoint doesn't exist" are usually this path
  confusion - see `metronome-danger-zone` §2.
- **Past-dated SCHEDULED invoices bypass `leave_stripe_invoices_in_draft`.**
  Adding an `add_scheduled_charges` with a past `timestamp` finalizes AND
  pushes to Stripe **immediately** - customer gets a Stripe invoice within
  seconds. This is the landmine in `metronome-danger-zone` §1.5; always
  confirm with the user before firing a past-dated edit.
- **DRAFT USAGE invoices can be retroactively inflated by past-dated
  ingest.** If you ingest an event with a timestamp inside an already-open
  USAGE period, the DRAFT total grows. If the period has already
  auto-finalized (past `period_end + 24h`), behavior depends on the tenant's
  backfill window - safest assumption is that FINALIZED invoices are
  immutable and a backfill triggers a follow-up invoice. See
  `metronome-danger-zone` §1.4.
- **HISTORICAL invoices never push to Stripe.** If you need to also charge
  the customer retroactively via Stripe, use past-dated
  `add_scheduled_charges` - a different code path with different side effects
  (see above landmine).
- **`POST /v1/customers/invoices/list` looks plausible - it 404s.** Use the
  path-style GET (`GET /v1/customers/{id}/invoices?...`). Some older
  scripts use a POST form; it is undocumented, so new code should use the
  GET.
- **Watcher rate-limit sweet spot is 20s.** Faster → risk of 429; slower →
  risk of missing the finalize → Stripe-push window (which can be seconds for
  SCHEDULED invoices). See `references/watcher-pattern.md`.
- **Invoice line items cap at 250 on Stripe.** Over 250 and Stripe collapses
  the entire invoice into one line. This hits customers with very granular
  usage on USD rate cards - unrelated to the credits-conversion collapse
  above.

## Cross-references

- `metronome-danger-zone` - §1.1/§1.2 (void/archive reconciliation),
  §1.5 (past-dated SCHEDULED immediate push), §3 (state machine), §4
  (watcher), §7 (pre-void reconciliation checklist); endpoint-matrix §11 §12
  are the source of truth for paths.
- `metronome-packages-contracts` - `updateInvoiceIssueDate`,
  `updateEndDate`, `createHistoricalInvoices` all live under `/v1/contracts/`;
  the contract-level reasoning is there, this skill owns the invoice-shape
  reasoning.
- `metronome-packages-contracts` - `invoice_schedule` on a commit is what
  creates most SCHEDULED invoice lines in practice; that payload shape lives
  there. `applied_commit_or_credit` line items reference `commit_id` from
  commits created there.
- `metronome-stripe-delivery` - `external_invoice.{id,status}`,
  `billable_status`, `leave_stripe_invoices_in_draft`, Stripe-side
  reconciliation and refund behavior, multi-entity `delivery_method_id`.
- `references/watcher-pattern.md` - canonical DRAFT → FINALIZED → VOID
  polling loop.

## When NOT to use this skill

- Anything about how a Stripe invoice got created / paid / failed, or how
  Metronome invoices map to Stripe invoices → `metronome-stripe-delivery`.
- `/v2/contracts/edit` mechanics, `remove_scheduled_charges` payload shape,
  `updateEndDate`, contract archival → `metronome-packages-contracts`.
- The shape of a commit's `access_schedule` / `invoice_schedule`,
  `rollover_fraction`, or "what does a POSTPAID trueup invoice look like" at
  the commit level → `metronome-packages-contracts`.
- Ingesting events, `transaction_id` dedup, 34-day back-date window →
  `metronome-ingestion-events`.
- "Why does the rate card price this as credits not USD" →
  `metronome-pricing-catalog`.
