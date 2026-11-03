# Stripe ↔ Metronome Reconciliation Snippet

Copy-pasteable pre-flight check to run **before** voiding, archiving, or
shortening anything that might touch a paid Stripe invoice. Mirrors
`metronome-danger-zone/SKILL.md §7` - when those two disagree, danger-zone
wins.

## The rule

Before calling any of the following, run the snippet and print the findings:

- `POST /v1/invoices/void`
- `POST /v1/contracts/archive` with `void_invoices: true`
- `POST /v1/contracts/updateEndDate` to shorten a contract
- `POST /v2/contracts/edit` with past-dated `add_scheduled_charges`
- `POST /v1/archiveCustomerBillingProviderConfigurations` when there are
  pending FINALIZED invoices (they'll try to push after archive and fail as
  `INVALID_REQUEST_ERROR`)

If any FINALIZED invoice has `external_invoice.id` with Stripe `paid: true`,
**stop and surface the finding to the user** (use the flag template from
`metronome-danger-zone/SKILL.md §1.1`) before firing.

## The snippet

```js
// Pre-flight Stripe ↔ Metronome reconciliation check.
// Usage:
//   node -e "$(cat this-file | sed -n '/^\/\/ ---$/,/^\/\/ ---$/p')" cid=<customer_id>
// Or paste inline into a probe script.
//
// ---
const Stripe = require('stripe');

// Minimal Metronome client. Keys come from the environment (for example
// ~/.metro/.env); never hardcode or print them.
const BASE = 'https://api.metronome.com';
const KEY = process.env.METRONOME_PROD_KEY; // read-only use here
const metronomeClient = () => ({
  raw: {
    get: async (path) => {
      const res = await fetch(BASE + path, { headers: { Authorization: `Bearer ${KEY}` } });
      if (!res.ok) throw new Error(`${res.status} on GET ${path}`);
      return { data: await res.json() };
    },
  },
});

const cid = process.env.CUSTOMER_ID || process.argv.find(a => a.startsWith('cid='))?.slice(4);
if (!cid) throw new Error('set CUSTOMER_ID env or pass cid=<uuid>');

const m = metronomeClient();
const s = new Stripe(process.env.STRIPE_LIVE_READ_KEY, { apiVersion: '2024-06-20' });

async function main() {
  // 1. Pull recent invoices for the customer (path-style GET; POST 404s here).
  const resp = await m.raw.get(`/v1/customers/${cid}/invoices?limit=50`);
  const invs = resp.data?.data || [];

  // 2. For each invoice, cross-reference the Stripe side.
  const rows = [];
  for (const i of invs) {
    const extId = i.external_invoice?.id || i.external_invoice?.invoice_id || null;
    const extStatus = i.external_invoice?.status || i.external_invoice?.external_status || null;
    let stripePaid = false;
    let stripeStatus = null;
    let stripeAmountPaid = null;
    if (extId) {
      try {
        const si = await s.invoices.retrieve(extId);
        stripePaid = !!si.paid;
        stripeStatus = si.status;
        stripeAmountPaid = si.amount_paid;
      } catch (e) {
        stripeStatus = `RETRIEVE_ERROR:${e.code || e.message}`;
      }
    }
    rows.push({
      metronome_invoice_id: i.id,
      metronome_status: i.status,
      metronome_total_usd: (i.total || 0) / 100,
      type: i.type,
      issued_at: i.issued_at || null,
      stripe_invoice_id: extId,
      metronome_external_status: extStatus,
      stripe_status: stripeStatus,
      stripe_paid: stripePaid,
      stripe_amount_paid_usd: stripeAmountPaid != null ? stripeAmountPaid / 100 : null,
      RECONCILIATION_RISK: i.status === 'FINALIZED' && stripePaid
        ? 'PAID_IN_STRIPE - voiding this invoice creates a Stripe↔Metronome delta'
        : null,
    });
  }

  console.log(JSON.stringify(rows, null, 2));
  const atRisk = rows.filter(r => r.RECONCILIATION_RISK);
  if (atRisk.length) {
    console.error(`\nWARNING: ${atRisk.length} invoice(s) at reconciliation risk:`);
    for (const r of atRisk) {
      console.error(`  - MC ${r.metronome_invoice_id} ($${r.metronome_total_usd}) ↔ Stripe ${r.stripe_invoice_id} (paid $${r.stripe_amount_paid_usd})`);
    }
    process.exit(2);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
// ---
```

## Output shape

Each row looks like:

```json
{
  "metronome_invoice_id": "00000000-0000-4000-8000-000000000001",
  "metronome_status": "FINALIZED",
  "metronome_total_usd": 4800,
  "type": "SCHEDULED",
  "issued_at": "2026-01-15T21:00:00Z",
  "stripe_invoice_id": "in_XXXXXXXXXXXX",
  "metronome_external_status": "PAID",
  "stripe_status": "paid",
  "stripe_paid": true,
  "stripe_amount_paid_usd": 4800,
  "RECONCILIATION_RISK": "PAID_IN_STRIPE - voiding this invoice creates a Stripe↔Metronome delta"
}
```

If `RECONCILIATION_RISK` is non-null on any row you were about to void -
**stop**, surface the finding, get explicit confirmation from the user
before proceeding. The flag template:

> Archiving/voiding this will also void the already-paid $X invoice
> `<metronome_invoice_id>` (Stripe `<stripe_invoice_id>`). Stripe won't
> refund automatically, so there will be a $X Stripe-collected /
> Metronome-not-billed gap. Proceed, or should I target just the draft
> invoice instead?

## Failure modes this catches

1. **The archive-with-void trap** - a contract was archived with
   `void_invoices: true` to remove a small DRAFT overage, while the
   customer's already-paid FINALIZED plan-fee invoice was still attached.
   Metronome voided the paid invoice too; Stripe kept the money. The
   snippet would have flagged it.
2. **Past-dated SCHEDULED double-billing** - customer already has a
   FINALIZED+paid USAGE invoice for a period, and someone runs
   `add_scheduled_charges` past-dated into the same period. The snippet
   won't prevent the edit, but running it before AND after the edit makes
   the duplicate visible instantly.
3. **Archive-then-push** - you archive billing configs to "stop billing",
   but there's a FINALIZED invoice still in Metronome's push queue. It
   surfaces as `external_invoice.status = INVALID_REQUEST_ERROR`. The
   snippet shows the queue state before you archive.

## Cross-references

- `metronome-danger-zone/SKILL.md §1.1`, `§1.2`, `§7` - authoritative rules
  and the flag template.
- `metronome-invoicing` - void/regenerate/preview state machine.
- `metronome-stripe-delivery/SKILL.md` - this snippet's home skill.
