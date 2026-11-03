---
name: metronome-danger-zone
description: >-
  CRITICAL pre-flight guardrail and verified endpoint matrix for EVERY
  Metronome API call. Covers known-wrong paths (with corrections), side
  effects, auto-finalization timing, custom-field whitelisting,
  Stripe/Metronome reconciliation, and the full endpoint-by-endpoint matrix
  with official doc links (references/endpoint-matrix.md) plus a symptom
  index (references/learnings.md). MUST be triggered BEFORE writing any
  Metronome API call - the endpoint-matrix is the source of truth for paths,
  methods, and schemas; never guess. Also triggers on: "metronome api",
  "void this invoice", "remove this charge", "cancel the invoice", "archive
  the contract", "delete this", "reverse the charge", "refund", "edit the
  contract", "end it early", "updateIssueDate", "updateEndDate",
  "regenerate invoice", "past-dated ingest", "add credits", "add commit",
  "custom field", "billing config", "stripe integration", "check this
  endpoint", "what's the path for", "does this endpoint exist", "fix this
  customer", or any ask where the wrong Metronome call could cause refund
  gaps, double-bills, accounting holes, or a 404 because of a wrong path.
  Also triggers on: wrong Metronome tenant, sandbox vs production key
  confusion, `METRONOME_PROD_KEY` loaded while intending sandbox. Takes
  precedence over speed.
---

# Metronome Danger Zone - Flag Before You Fire

## The Rule

Before calling any Metronome endpoint, do these four checks in order. Don't
skip them - every item below comes from a real failure.

0. **Confirm tenant + bearer token** - Production and sandbox share the same
   base URL (`https://api.metronome.com`) but use **different** API keys.
   If both `METRONOME_PROD_KEY` and `METRONOME_SANDBOX_KEY` are loaded (for
   example from `~/.metro/.env`), "unset in my shell" does not switch
   tenants. Always pass the tenant explicitly (`metro ... --sandbox` or
   `--prod`). Full wiring: the `metro` skill and
   `skills/_metronome-shared/conventions.md`.
1. **Grep the endpoint matrix** - `references/endpoint-matrix.md` - for the
   capability you need. That file is the source of truth for every path,
   method, and official doc link. If your path doesn't appear there, you
   almost certainly have it wrong (§2 lists real examples of wrong guesses
   and the correct paths).
2. **Check the symptom index** - `references/learnings.md` - if you're
   touching something you haven't used before, or reacting to an error.
3. **If the call is in §1 of THIS doc** (operations with surprising side
   effects) - stop and surface the side effect to the user in one short
   sentence, then wait for confirmation.

Files in this skill:
- `SKILL.md` (this file) - behavioral guardrails + known-wrong paths
- `references/endpoint-matrix.md` - endpoints by domain, verified paths,
  official doc links
- `references/learnings.md` - non-obvious behaviors indexed by symptom

## §1 Operations that require pre-flight confirmation

### 1.1 `/v1/contracts/archive` with `void_invoices: true`

**Voids EVERY invoice on that contract - including FINALIZED invoices that
Stripe has already collected.** It does NOT trigger a Stripe refund.

- Net effect on a paid-and-voided invoice:
  - Stripe: $X still collected (untouched)
  - Metronome: ledger shows $0 billed
  - Reconciliation: $X delta between Stripe collections and Metronome revenue
    for that customer/period
- Safe to use when: contract is a trial, unpaid-only, or you're fully replacing
  the month's billing with a correction line elsewhere.
- Unsafe when: any invoice on the contract is FINALIZED with a paid
  `external_invoice.id`.

**Real example (anonymized):** during a remediation, an operator archived a
customer's old paid contract with `void_invoices: true` only to remove a
small DRAFT usage invoice. The same call also voided the already-paid plan
fee invoice for that month. Stripe kept the money, Metronome showed $0
billed, and finance had to reconcile the gap by hand. The same archive had
been harmless minutes earlier on a contract with no finalized invoices,
which is why it felt safe. The cleaner path would have been to leave the old
contract alone and void only the unwanted invoice after it finalized (§4
watcher pattern).

**Flag template (say this to the user):**

> Archiving this contract with `void_invoices: true` will also void the
> already-paid $X invoice `<id>` on it. Stripe won't refund, so we'll have a
> $X Stripe-collected / Metronome-not-billed gap. Proceed, or should I target
> just the draft invoice instead?

### 1.2 `/v1/invoices/void` on a FINALIZED paid invoice

Same reconciliation hole as 1.1. Voiding in Metronome never refunds Stripe.

### 1.3 `/v2/contracts/edit` - shortening a contract

Per Metronome docs, shortening:
- Truncates draft statements
- **Removes upcoming scheduled invoices** (including plan fees the customer
  expects to owe)
- Triggers immediate finalization of any past-dated SCHEDULED invoices the
  edit creates ("bypasses drafts setting")

If the user thinks they're "just ending it early, customer keeps their stuff",
they're probably wrong.

### 1.4 `/v1/ingest` with past-dated `timestamp`

Past-dated events can:
- Retroactively push a FINALIZED invoice line amount UP (if re-finalization
  happens)
- Trigger a follow-up backfill invoice
- Change commit burn-down history

Never ingest historical events without confirming what window they'll land in
and whether the owning invoice is already finalized.

### 1.5 `/v2/contracts/edit` with past-dated `add_scheduled_charges`

Past-dated SCHEDULED charges **finalize IMMEDIATELY** on edit regardless of
the "Leave as drafts" setting. Customer sees a Stripe invoice within seconds.

### 1.6 Custom field writes on contracts/commits

Metronome has a **whitelist** of custom-field keys per entity type. Unknown
keys return `400 BadRequest: Invalid custom field keys: <key>`.

List the keys your tenant already allows with `POST /v1/customFields/listKeys`
(`metro` read endpoint `customFields.listKeys`). A typical set for audit
metadata on PREPAID commits looks like:

- `grant_reason` (string)
- `granted_by` (string)
- `granted_by_email` (string)
- `granted_at` (ISO timestamp string)

These are examples, not built-ins: each key exists only after someone adds
it. To add a new key, call `POST /v1/customFields/addKey` for the right
entity type (or use Metronome UI → Settings → Custom Fields). Do NOT retry
with the key until it's whitelisted. If you only need to record a reference
(ticket, incident), embed it in an existing free-text key such as
`grant_reason` instead of inventing a new key.

### 1.7 `invoice_schedule.credit_type_id` MUST be a fiat currency

On `/v2/contracts/edit add_commits[]`:

- `access_schedule.credit_type_id` - PRODUCT denomination. A custom credit
  type (for example your tenant's "credits" unit) is valid here.
- `invoice_schedule.credit_type_id` - PAYMENT denomination. **Fiat only.**
  Must be USD cents (`2714e483-4ff1-48e4-9e25-ac732e8f24f2`, Metronome's
  built-in USD cents type) or another fiat credit type. Using a custom
  credit type here returns `400 Credit type must be a fiat currency: <UUID>`.

**Two safe shapes:**

| You want… | `invoice_schedule` |
|---|---|
| Pure access grant / no invoice artifact | **Omit the block entirely.** Recommended practice for complimentary credits. |
| $0 audit line OR a paid top-up | Include with `credit_type_id = <USD cents>`, `unit_price: <cents or 0>` |

The fiat constraint is a classic §1.8 dry-run blind spot - no read probe in
Metronome catches it, only a real POST does.

**Source of authority:**
[edit-a-contract](https://docs.metronome.com/api-reference/contracts/edit-a-contract.md)
(`invoice_schedule` optional on PREPAID; `credit_type_id` must be a fiat
currency ID when provided). See §9 for the bulk-backfill failure that taught
this.

Commit and credit shapes in depth: `metronome-packages-contracts`. §6 of this
file shows the "$0 audit line" variant for reference.

### 1.8 Dry-run blind spots - canary before blasting

Metronome's read surface does not exercise the write validator. A clean
dry-run still leaves a full class of failures that only surface on POST:

| Failure class | Example | Caught by dry-run? |
|---|---|---|
| Credit-type fiat requirement | `invoice_schedule.credit_type_id = <custom credit type>` | No |
| Custom-field whitelist | Unknown key in `custom_fields` | No |
| Contract-state schema | editContract on a transitioned contract | No |
| `uniqueness_key` 409 | Reused key on create | No |
| `uniqueness_key` length | Key longer than 128 characters (the spec allows 1-128). Build keys from date-only values (`2026-01-01`), not full ISO timestamps, so composite keys stay short. | Yes, if you check locally |
| Package `uniqueness_key` prefix (`package:<key>` vs `<key>`) | Comparison logic drift | No |
| Hour-boundary snap | Non-`:00:00Z` timestamp | Yes (client-side by shape) |

**Recommended practice for bulk writes** (backfills, bulk grants, bulk
renames): after the dry-run completes, apply a single canary write to ONE
entity; verify it with a targeted read-back (or in the Metronome UI); THEN
run the full loop. In the §9 example this turned what would have been dozens
of broken commits into one.

### 1.9 Product archive does NOT remove rate entries from rate cards

Per the [archive-a-product docs](https://docs.metronome.com/api-reference/products/archive-a-product.md),
existing rate cards associated with an archived product keep working; the
product just can't be used for new rates.

Archiving guards against **future** `addRates` calls. It does NOT retire
the product's existing `entitled=true` rate entries - those keep firing
and producing invoice lines. At `price: 0` you get a visible `qty=N × 0`
ghost line on USAGE invoices; at a non-zero price the customer still gets
charged.

**There is no `removeRate` endpoint.** To retire a product:

1. `POST /v1/contract-pricing/rate-cards/addRates` with
   `entitled: false, price: 0` at the cutover `starting_at` on **every**
   rate card that product appears on. Metronome auto-closes the prior
   open rate for that product.
2. `POST /v1/contract-pricing/products/archive` to block future
   re-additions (catalog hygiene).

Real example (anonymized): in sandbox, a product was archived without
writing `entitled=false` on its rate cards, so every rate card kept the entry
live. An end-to-end test surfaced a `qty=1 × 0` ghost line and a credit
drift on one tier's rate card. `metro product retire preview` builds the
correct order of operations. See also `metronome-pricing-catalog`
§ Retiring a product.

### 1.10 Sandbox/prod catalog rebuilds - prove tenant and non-actions

When asked for sandbox-only catalog work (packages, rate cards, products,
tiers):

1. Use tooling that **cannot** write production (`metro` sandbox apply is
   sandbox-only; a custom script should throw on `--prod`).
2. Name the environment in every dry-run/apply summary.
3. Read production only as a price source if needed; write sandbox only.
4. After apply, verify the new object IDs from sandbox reads and explicitly
   state "Production was not written to."

This matters because production and sandbox share `https://api.metronome.com`
and both keys are often loaded at once. A safe rollout pattern:

- read production rate cards for source prices,
- create sandbox-only metric/product/rate cards/packages,
- save a sandbox manifest of created IDs,
- verify package aliases and recurring commit amounts by `POST /v1/packages/get`.

If a production scan finds unexpected objects, do not assume your prior run
created them. Pause writes, compare timestamps/names/tooling, then propose a
specific cleanup plan before touching production.

## §2 Paths commonly guessed wrong - use the REAL path

Some "doesn't exist" errors are really wrong-path errors. Always check
`references/endpoint-matrix.md` BEFORE writing a new call. Paths that were
guessed wrong during a real remediation:

| Wrong path tried | Result | REAL path | Verified via |
|---|---|---|---|
| `POST /v1/invoices/updateIssueDate` | 404 | **`POST /v1/contracts/updateInvoiceIssueDate`** | [docs.metronome.com](https://docs.metronome.com/api-reference/contracts/update-invoice-issue-date.md) |
| `POST /v2/contracts/edit` with `update_contract_end_date` | 400 schema | **`POST /v1/contracts/updateEndDate`** (dedicated endpoint, has `allow_ending_before_finalized_invoice` flag) | [docs](https://docs.metronome.com/api-reference/contracts/update-the-contract-end-date.md) |
| `POST /v1/customers/invoices/list` | 404 | **`GET /v1/customers/{customer_id}/invoices?limit=N&status=...`** | [docs](https://docs.metronome.com/api-reference/invoices/list-invoices.md) |
| `POST /v2/customers/get` | 404 | **`GET /v1/customers/{customer_id}`** | [docs](https://docs.metronome.com/api-reference/customers/get-a-customer.md) |
| `POST /v1/customers/list` with `{customer_ids: [...]}` | 404 | **`GET /v1/customers?customer_ids=...&limit=100`** | [docs](https://docs.metronome.com/api-reference/customers/list-customers.md) |
| `POST /v1/invoices/void` on a DRAFT | 400 | No path - only FINALIZED invoices can be voided (§3) | [docs](https://docs.metronome.com/api-reference/invoices/void-an-invoice.md) |

## §2b Endpoints that genuinely don't exist

| Endpoint | Why it seemed to exist | Reality |
|---|---|---|
| `POST /v1/invoices/finalize` | Intuition - seemed the inverse of void | **Not in public docs, not deployed.** Metronome has no manual finalize; invoices auto-finalize per §3 timing rules. To "cancel a draft" you must archive the contract (with side effects - see §1.1) or wait for auto-finalize and then void. |
| `POST /v1/seats/list` / `/v2/seats/list` / `/v1/contracts/listSeats` | Probed for subscription seat listing | None of these respond. Use `POST /v1/contracts/getSubscriptionQuantityHistory` + `POST /v1/contracts/seatBalances/list` ([docs](https://docs.metronome.com/api-reference/credits-and-commits/list-seat-balances.md)) instead. |

## §2c Side-discovered useful endpoints

These are documented but easy to miss:

| Endpoint | Use case |
|---|---|
| `POST /v1/invoices/regenerate` ([docs](https://docs.metronome.com/api-reference/invoices/regenerate-an-invoice.md)) | Regenerate a VOIDED invoice with updated rates/balances. Useful when you void for a correction and need to re-issue the corrected version. |
| `POST /v1/contracts/updateInvoiceIssueDate` ([docs](https://docs.metronome.com/api-reference/contracts/update-invoice-issue-date.md)) | Push a DRAFT invoice's issue date into the future. Only for DRAFT, and new date must be before contract end. |
| `POST /v1/contracts/updateEndDate` with `allow_ending_before_finalized_invoice: true` | Shorten a contract cleanly without the schema hoops of editContract. |
| `POST /v1/contracts/createHistoricalInvoices` ([docs](https://docs.metronome.com/api-reference/contracts/create-historical-invoices.md)) | Create retroactive invoices for past periods. Alternative to past-dated ingest (§1.4). |

## §3 Invoice status state machine

```
DRAFT ──(auto-finalize, per type)──► FINALIZED ──(/v1/invoices/void)──► VOID
  │
  └──(contract archived with void_invoices: true)──► VOID (collapses both arrows)
```

- `/v1/invoices/void` on a DRAFT returns `400 Can't void invoice ... because its
  status is not finalized: DRAFT`. There is no way around this.
- To kill a DRAFT you don't want to bill, use ONE of:
  1. Archive the parent contract with `void_invoices: true` (only if the
     contract is disposable and has no paid invoices - §1.1)
  2. Wait for auto-finalization then void (watcher pattern, §4)
  3. `/v2/contracts/edit` → `remove_scheduled_charges` (only works for
     SCHEDULED charges you created via `add_scheduled_charges`, not for
     auto-generated USAGE invoices)

### Auto-finalization timing

| Invoice type | `issued_at` | Auto-finalizes |
|---|---|---|
| `USAGE` | period end | period_end + grace window (about 24h by default) |
| `SCHEDULED` (future-dated) | future date | Subject to "Leave as drafts" setting |
| `SCHEDULED` (past-dated, created via edit) | immediately | **Immediately - bypasses drafts setting** |
| Commit invoices (`invoice_schedule` on create) | as scheduled | Subject to drafts setting |

**Observed in sandbox:** creating a paid package contract at the current
UTC hour boundary (`starting_at` equal to the already-started hour)
immediately created and finalized the package's SCHEDULED invoice, which
pushed to sandbox Stripe within seconds. Treat "make it happen now" on paid
packages as immediate-finalization behavior, even in sandbox.

## §4 Watcher pattern - DRAFT → FINALIZED → VOID

When you can't delete a DRAFT but need to prevent it from actually billing
(and the contract carries other paid invoices you must not touch):

```js
// `m` is any thin Metronome HTTP client with get/post helpers.
const TARGETS = { '<INVOICE_ID>': { state: 'pending', label: '...' } };
const DEADLINE = Date.now() + 26 * 3600 * 1000;

while (Date.now() < DEADLINE) {
  const r = await m.get(`/v1/customers/${CUSTOMER_ID}/invoices?limit=50`);
  const invs = r.data || [];
  for (const [id, t] of Object.entries(TARGETS)) {
    if (t.state === 'voided' || t.state === 'gone') continue;
    const live = invs.find(i => i.id === id);
    if (!live) { t.state = 'gone'; continue; }          // contract archived → removed
    if (live.status === 'VOID') { t.state = 'voided'; continue; }
    if (live.status === 'FINALIZED') {
      await m.post('/v1/invoices/void', { id });
      t.state = 'voided';
    }
    // DRAFT → keep polling
  }
  if (Object.values(TARGETS).every(t => t.state === 'voided' || t.state === 'gone')) return;
  await new Promise(r => setTimeout(r, 20_000));
}
```

Run as a detached background process writing to a log file. Poll every
~20s - finer polling risks rate limits, coarser risks missing the
finalize → Stripe-push window. In practice this voided a finalized
scheduled invoice within about half a minute of finalization. Full
pattern: `metronome-invoicing` (`references/watcher-pattern.md`).

## §5 Contract timestamp rules

- `starting_at` and `ending_before` MUST snap to **hour boundaries**
  (`:00:00Z`). Non-zero minutes/seconds return `400`.
- "No expiry" convention (recommended practice, there is no "never expire"
  flag): set `ending_before` about 100 years out, e.g.
  `"2126-01-01T00:00:00Z"`. Metronome accepts it; the UI shows it as very
  long-dated.
- Bridge contracts (tiny direct contracts that cover a gap while you swap a
  customer's contract) use the same hourly snapping. Minimum useful duration
  is 1 hour. A short bridge contract with a small credit grant can cover the
  window between archiving a bad contract and the replacement starting, so
  the customer sees no outage.

## §6 Validated complimentary credit payload (with $0 audit line)

One of two valid shapes for free credits. This one produces a $0 commit
invoice line for audit, which then pushes a $0 Stripe invoice to any
customer with a billing-provider config. Example: 500 credits, no expiry,
full rollover, zero cost.

**The other shape - pure access grant with no invoice artifact at all -
OMITS `invoice_schedule` entirely.** Pick based on the §1.7 "You want…"
table.

```json
{
  "customer_id": "00000000-0000-4000-8000-000000000001",
  "contract_id": "00000000-0000-4000-8000-000000000002",
  "add_commits": [{
    "type": "PREPAID",
    "product_id": "00000000-0000-4000-8000-000000000003",
    "name": "500 Complimentary Credits - goodwill for <REASON>",
    "priority": 2,
    "rollover_fraction": 1,
    "applicable_product_tags": ["<PRODUCT_TAG>"],
    "access_schedule": {
      "credit_type_id": "00000000-0000-4000-8000-000000000004",
      "schedule_items": [{
        "amount": 500,
        "starting_at": "2026-01-01T00:00:00.000Z",
        "ending_before": "2126-01-01T00:00:00.000Z"
      }]
    },
    "invoice_schedule": {
      "credit_type_id": "2714e483-4ff1-48e4-9e25-ac732e8f24f2",
      "schedule_items": [{
        "timestamp": "2026-01-01T00:00:00.000Z",
        "unit_price": 0,
        "quantity": 1
      }]
    },
    "custom_fields": {
      "grant_reason": "<why - free-form, can include a ticket ref>",
      "granted_by": "<person name>",
      "granted_by_email": "<email>",
      "granted_at": "<ISO timestamp>"
    }
  }]
}
```

`00000000-...-000000000004` stands in for your custom credit type ID
(discover it with `GET /v1/credit-types/list`). The `custom_fields` keys
must already be whitelisted (§1.6).

Notes:
- `invoice_schedule` with `unit_price: 0, quantity: 1` is the **audit
  line** variant. It works, but it is one of two valid shapes; omitting
  `invoice_schedule` entirely gives a pure access grant. `invoice_schedule`
  is optional on PREPAID commits.
- When `invoice_schedule` IS present, its `credit_type_id` **must be
  fiat** (usually USD cents). Custom credit type here returns 400. §1.7.
- `rollover_fraction: 1` = carry over 100% of unused at contract boundary.
  `0` = use-it-or-lose-it. Fractional values allowed.
- `priority`: lower number = higher priority = burns first. If a paid
  commit is at priority 1 and this complimentary grant at priority 2, the
  paid credits burn first, then the complimentary. Pick the order on
  purpose; recommended practice is usually to burn paid credits first so
  the customer gets full value from what they bought (or the reverse, if
  paid credits expire sooner).
- `applicable_product_tags` scopes which products the commit can be spent
  against. Omit to allow against all products, or list tags to restrict.
- `access_schedule.credit_type_id` is the PRODUCT credit type (your custom
  credit unit, or USD). `invoice_schedule.credit_type_id` is the PAYMENT
  credit type (fiat). These are different.

## §7 Pre-flight reconciliation checklist

Before voiding or archiving anything with money on it, verify:

1. Is there a FINALIZED invoice attached? (`status: FINALIZED`)
2. Is it pushed to Stripe? (`external_invoice.id` present, `billable_status`
   set)
3. Has Stripe collected it? (`stripe.invoices.retrieve(external_invoice.id).paid`)
4. If YES to all three → **this is the 1.1 / 1.2 warning. Say it before you
   fire.**

Verification snippet:

```js
// `m` = Metronome client for the tenant you are about to write;
// `stripe` = a read-only Stripe client.
const invs = (await m.get(`/v1/customers/${cid}/invoices?limit=50`)).data;
const targets = invs.filter(i => /* your filter */);
for (const i of targets) {
  const ext = i.external_invoice?.id;
  const paid = ext ? (await stripe.invoices.retrieve(ext)).paid : false;
  console.log(`${i.id} ${i.status} $${i.total/100} stripe=${ext||'-'} paid=${paid}`);
}
```

## §8 Customer lookup - what actually works

`POST /v1/customers/list` and `POST /v2/customers/get` both 404. The
reliable chain:

1. Get `customer_id` from an external source (your CRM or app database,
   Stripe `customer.metadata`, or the Metronome UI URL), or look it up by
   ingest alias: `GET /v1/customers?ingest_alias=<ALIAS>`.
2. `POST /v2/contracts/list { customer_id, include_archived: true }` returns
   the customer's contracts.
3. For invoices: `GET /v1/customers/{id}/invoices?limit=50` (note: **path
   style, GET** - the POST variant 404s).
4. For balances: `POST /v1/contracts/customerBalances/list { customer_id,
   include_balance: true, include_contract_balances: true }`.

## §9 Real incidents (anonymized)

### Paid customer silently downgraded to a free trial by a stale webhook handler

**What happened:** a customer bought a paid monthly plan through Stripe and
had a paid credit grant plus a complimentary grant. The next day a "credits
depleted" style notification fired, and a stale handler in the app set the
contract into a pending state. That routed the user to a free-trial screen;
accepting it ended the paid contract early and created a pay-as-you-go
contract. The transition used rollover `0`, so both the paid and the
complimentary credits disappeared.

**Remediation that worked:**
1. A 1-hour **bridge contract** with a small credit grant covered the gap so
   the user had no outage.
2. The bad PAYG contract (no finalized invoices) was archived with
   `void_invoices: true`.
3. A new paid contract started at the next hour boundary, with a
   complimentary commit (`rollover_fraction: 1`, `ending_before` ~100 years
   out) to restore the lost credits.
4. The **watcher** (§4) voided the new contract's duplicate plan-fee
   invoice seconds after it auto-finalized.

**What went wrong during remediation:** archiving the OLD paid contract
with `void_invoices: true` (to drop a small DRAFT usage invoice) also voided
the paid plan-fee invoice. That is §1.1.

**Lessons:**
- Webhook handlers must be idempotent and must never downgrade a contract
  that has FINALIZED, Stripe-paid invoices in the current period. Recommended
  guardrails: block any paid → trial transition when the source has paid
  invoices; block any lower-tier transition with `rollover_fraction < 1`
  when unused paid credits remain; require explicit "I will lose my paid
  credits" confirmation in UI.
- Before any archive, list the contract's invoices and their Stripe payment
  status (§7).
- After fixing one customer, run an **audit sweep**: scan all contracts of
  the affected type (here, every PAYG contract) for `transitions[]` whose
  `from_contract` was a paid tier with a finalized plan-fee invoice, to
  answer "did anyone else hit this bug?". Make such scripts take inputs; never
  re-run a one-customer remediation script blindly on another customer.

### Bulk free-credit backfill failed on `invoice_schedule.credit_type_id`

**Context:** a free package's monthly grant was raised, and existing
customers on the old package version needed a top-up grant so they matched
the new amount. Dozens of contracts were in scope.

**Failure:** the dry-run was clean - every contract resolved, all targeted
the correct package, and each `ending_before` was capped at the contract's
own end. On live apply, EVERY row failed:

```
400 BadRequest: Credit type must be a fiat currency: <CUSTOM_CREDIT_TYPE_UUID>
```

**Root cause:** the payload copied the §6 `$0 audit line` shape but set the
custom credit type ID on both `access_schedule` AND `invoice_schedule`.
The custom type is valid for access; `invoice_schedule` is fiat-only
(§1.7).

**Why the dry-run didn't catch it:** every read probe passed. §1.8 class:
no dry-run surface exercises the `/v2/contracts/edit` write validator.

**Fix:** the package's own recurring free-credit commit has no
`invoice_schedule`, so the backfill matched that shape and removed the
block entirely: a pure access grant with no invoice and no Stripe push.

**Validation before re-running:** the fix was applied to ONE previously
failed contract as a canary (§1.8), verified by read-back, and only then
was the loop re-run. All remaining rows succeeded; the canary was skipped by
an idempotency check on commit name.

**Lessons:**
1. `invoice_schedule.credit_type_id` is fiat-only (§1.7).
2. Dry-runs have blind spots; canary one write first (§1.8).
3. The $0-audit-line variant is ONE shape; omitting `invoice_schedule` is
   the other (§6).
4. Make bulk commit writes idempotent (skip rows that already have a commit
   with the same name or `uniqueness_key`).

## §10 When to escalate vs fix

Fix directly without asking (sandbox, or with an approved plan):
- Voiding unpaid DRAFT-turned-FINALIZED invoices on archived/disposable contracts
- Adding complimentary credits via the §6 payload
- Creating bridge contracts to cover planned transition gaps

**Stop and ask first:**
- Any operation in §1
- Any change that touches a FINALIZED + Stripe-paid invoice
- Any past-dated edit or ingest
- Any custom field key that isn't already whitelisted (§1.6)
- Anything that ends/shortens a contract the customer is actively on
- **Any bulk write (>5 rows) - run a canary first (§1.8)**
- **Any rate-card mutation that retires a product - confirm `entitled=false` was written on every rate card before archiving the product (§1.9)**

The cost of asking is 30 seconds. The cost of a silent Stripe/Metronome delta
is a finance incident.
