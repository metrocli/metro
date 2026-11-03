# DRAFT → FINALIZED → VOID Watcher Pattern

The canonical pattern for killing a Metronome DRAFT invoice you don't want to
bill **when you can't archive the parent contract and can't
`remove_scheduled_charges`**. The DRAFT can't be voided directly (400). So we
poll until Metronome auto-finalizes it, then void within the finalize →
Stripe-push window.

Field-tested during an incident remediation: it killed an unwanted plan-fee
SCHEDULED DRAFT on a replacement contract and a small USAGE DRAFT on the
old contract. Both ended VOID within seconds of finalizing, neither pushed
to Stripe, and the old contract (which held a paid invoice) never had to be
archived.

## When to use this vs alternatives

See the main SKILL.md "I have a DRAFT I don't want to bill" decision tree.
This pattern is the fallback. First try:

1. `POST /v1/contracts/archive { void_invoices: true }` - if the contract is
   disposable. (Warning: also voids FINALIZED invoices - see
   `metronome-danger-zone` §1.1.)
2. `POST /v2/contracts/edit { remove_scheduled_charges: [{ id }] }` - if the
   DRAFT came from an `add_scheduled_charges` op and you have the
   scheduled_charge_id.

If neither applies, you're here.

## Poll-interval sizing

- **20s is the sweet spot.** Finer risks 429s; coarser risks missing the
  finalize → Stripe-push window, which can be **seconds** for SCHEDULED
  invoices with billing configs attached.
- **Deadline: `period_end + 26h`** for USAGE invoices (24h grace + 2h
  cushion). SCHEDULED invoices finalize at their scheduled timestamp, so set
  deadline = `scheduled_timestamp + 1h`.
- Run it as a **detached node process**, log to a file such as
  `/tmp/<name>-watcher.log`.
  Don't run inline in a session - you'll close the terminal before it
  finalizes.

## Canonical code

```js
#!/usr/bin/env node
'use strict';
/**
 * Watcher - polls targeted invoices every 20s; voids as soon as each
 * transitions DRAFT → FINALIZED. Exits when all are VOID/gone or after the
 * deadline.
 */
// Minimal fetch client. The key comes from the environment (for example
// ~/.metro/.env loaded by your shell); never hardcode or print it.
const BASE = 'https://api.metronome.com';
const KEY = process.env.METRONOME_SANDBOX_KEY; // or METRONOME_PROD_KEY, on purpose
async function call(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${res.status} ${data.message || ''}`);
  return { data };
}
const metronomeClient = () => ({
  raw: { get: (path) => call('GET', path) },
  post: (path, body) => call('POST', path, body),
});

const CUSTOMER_ID = '<customer-uuid>';
const TARGETS = {
  '<invoice_id_1>': { label: '<human label 1>', state: 'pending', total: 10000 },
  '<invoice_id_2>': { label: '<human label 2>', state: 'pending', total:  3456 },
};
const DEADLINE = Date.now() + 26 * 3600 * 1000; // 26h

function ts() { return new Date().toISOString(); }

async function main() {
  const m = metronomeClient();
  console.log(`[${ts()}] watcher started - polling every 20s, deadline +26h`);

  while (Date.now() < DEADLINE) {
    const pending = Object.entries(TARGETS)
      .filter(([, t]) => t.state === 'pending' || t.state === 'finalized');
    if (pending.length === 0) {
      console.log(`[${ts()}] all invoices handled, exiting`);
      return;
    }

    const r = await m.raw
      .get(`/v1/customers/${CUSTOMER_ID}/invoices?limit=50`)
      .catch(e => ({ data: { data: [] }, err: e.message }));
    const invs = r.data?.data || [];

    for (const [id, t] of Object.entries(TARGETS)) {
      if (t.state === 'voided' || t.state === 'gone') continue;

      const live = invs.find(i => i.id === id);

      if (!live) {
        // Contract was archived out from under us, or invoice was regenerated
        // into a new id. Either way, nothing to void on this id anymore.
        console.log(`[${ts()}] ${t.label}: not found in list (maybe already voided via another path)`);
        t.state = 'gone';
        continue;
      }

      if (live.status === 'VOID') {
        console.log(`[${ts()}] ${t.label}: VOID (no action needed)`);
        t.state = 'voided';
        continue;
      }

      if (live.status === 'FINALIZED' && t.state !== 'voided') {
        console.log(`[${ts()}] ${t.label}: FINALIZED detected, voiding NOW`);
        try {
          await m.post('/v1/invoices/void', { id });
          console.log(`[${ts()}]   → voided`);
          t.state = 'voided';
        } catch (e) {
          // Likely already-voided race, or transient - retry next tick
          console.log(`[${ts()}]   → void failed: ${e.message}`);
          t.state = 'finalized';
        }
        continue;
      }

      // DRAFT - quiet, expected while waiting.
    }

    const summary = Object.values(TARGETS).map(t => t.state).join(',');
    process.stdout.write(`[${ts()}] states: ${summary}\n`);

    if (Object.values(TARGETS).every(t => t.state === 'voided' || t.state === 'gone')) {
      console.log(`[${ts()}] done`);
      return;
    }
    await new Promise(r => setTimeout(r, 20_000));
  }
  console.log(`[${ts()}] deadline reached`);
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
```

## Running it

```bash
# Detach so it survives your session closing.
nohup node watch-<name>-invoices.js > /tmp/<name>-watcher.log 2>&1 &
echo $! > /tmp/<name>-watcher.pid

# Tail from elsewhere
tail -f /tmp/<name>-watcher.log

# Later: check it still running
ps -p $(cat /tmp/<name>-watcher.pid)

# Cancel early
kill $(cat /tmp/<name>-watcher.pid)
```

## States in the state machine

- `pending` - DRAFT, waiting for auto-finalize.
- `finalized` - saw FINALIZED, void attempt failed transiently, will retry.
- `voided` - successfully voided (or observed as VOID on arrival).
- `gone` - invoice id no longer in the list (contract archived out from under
  us, or invoice regenerated into a new id via `/v1/invoices/regenerate`).

## Race conditions & pitfalls

- **Stripe push can happen seconds after FINALIZED.** If the contract has a
  billing config attached and it's a past-dated SCHEDULED invoice, the
  finalize → push window is tight. A 20s poll usually catches it; a 60s poll
  sometimes doesn't. If the invoice pushed before your void landed, you're in
  `metronome-danger-zone` §1.2 territory - Stripe has it, Metronome voids it,
  reconciliation hole opens. Pre-flight: confirm `leave_stripe_invoices_in_
  draft` status and the contract's billing config before starting the
  watcher.
- **`/v1/invoices/void` body key is `id`, not `invoice_id`.** Getting this
  wrong returns a schema error that's easy to misdiagnose as "the invoice
  can't be voided yet".
- **"Not found in list" ≠ "doesn't exist".** It can mean the contract got
  archived (which voided the invoice indirectly) or that a `regenerate`
  replaced the id. Treat `gone` as a terminal success.
- **VOID is not always stable.** In extremely rare cases a parent contract
  archival can leave a descendant invoice in an unexpected state; always
  re-list after watcher exit to confirm final statuses.
- **Don't tighten the poll below 10s.** Metronome rate limits start biting
  around 5 rps per tenant; 20s keeps the watcher safely under.
- **Don't extend the deadline much past 26h for USAGE.** If it hasn't
  finalized within `period_end + 24h grace + 2h cushion`, something's wrong.
  Check the contract for a non-standard finalization hook or a paused
  tenant.

## After the watcher exits - verify

Run a one-shot listing to confirm final statuses:

```js
const r = await m.raw.get(`/v1/customers/${CUSTOMER_ID}/invoices?limit=50`);
for (const id of Object.keys(TARGETS)) {
  const inv = r.data.data.find(i => i.id === id);
  console.log(id, inv ? inv.status : 'NOT_IN_LIST');
}
```

If any came back with `external_invoice.id` pointing at Stripe, run the §7
reconciliation checklist in `metronome-danger-zone` to confirm Stripe did NOT
collect.
