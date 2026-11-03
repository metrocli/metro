# Safety policy

metro can change billing: invoices, credits, contracts and customer access. Treat
every live command as a production operation until you have checked which tenant
it targets.

## Non-negotiables

- Read-only by default. `metro init` leaves metro in `read-only` mode. Live writes
  need `metro mode write` (same as `metro mode set read-write`), set by a human.
- Name the tenant every time with `--sandbox` or `--prod`. metro never infers
  production from `METRONOME_PROD_KEY` being present. With no flag it uses sandbox
  only when `METRONOME_SANDBOX_KEY` is set, and otherwise refuses.
- Never infer permission from a `.env` file or a key being present.
- Sandbox first. A change is proven on sandbox before production is discussed.
- Production writes need the human's explicit, typed yes for that specific change.
  One yes never covers the next change.
- Never print keys. metro shows fingerprints, never values. Inspect `.env` by
  variable names only.
- Keys live in `~/.metro/.env` (mode 600, outside every repo). Never paste a key
  into chat, an issue, or a commit.

## The ladder: preview, confirm, apply, read back

1. **Preview or preflight.** Live reads only, then a local plan file with a
   `payloadHash` (`sha256:` of canonical JSON).
2. **Review.** A human reads the plain-English change and the hash.
3. **Confirm.** `apply --confirm-hash <hash>` without `--apply` is a dry run.
4. **Apply.** `--apply` performs the write. Production also requires the typed
   token `--confirm-prod-apply=I_UNDERSTAND_BILLING_SIDE_EFFECTS`.
5. **Read back.** metro re-reads the object and fails on any expected-vs-actual
   mismatch. Report both values.

The guarded `metro api apply` chain is sandbox-only and additionally needs an
apply gate, an approval record, and
`--confirm-live-apply I_UNDERSTAND_THIS_WILL_WRITE_LIVE_METRONOME_SANDBOX`.
Guarded reads need a read gate and
`--confirm-live-read I_UNDERSTAND_THIS_WILL_READ_LIVE_METRONOME`.

Exit codes: `0` success, `1` validation failure, `2` safety refusal.

## Before any production write, write down

1. Customer identifiers: Metronome customer id, contract id, billing-provider
   (for example Stripe) customer id, and any external id you matched on.
2. Tenant, and which key metro will use.
3. Current state, from read-only evidence.
4. Desired state in business terms.
5. Exact endpoints and payload shapes.
6. Expected invoices, balance changes, billing-provider behavior and access effects.
7. The dry-run result and where its file was written.
8. A canary: one customer or one object first.
9. The read-back you will run.
10. Rollback or remediation.

## Tenant selection

Sandbox and production both use `https://api.metronome.com`. The key selects the
tenant. A production key equal to the sandbox key is refused
(`METRONOME_PROD_KEY_EQUALS_SANDBOX`). `metro init --check` reports the same
condition.

## Metronome side-effect traps

- `POST /v1/contracts/archive` with `void_invoices: true` voids every invoice on
  the contract, including finalized ones. Stripe is not refunded.
- `POST /v1/invoices/void` voids in Metronome only. Billing-provider
  reconciliation is separate.
- Past-dated scheduled charges can finalize immediately and push to the billing
  provider.
- Past-dated usage ingest can change the economics of finalized periods.
- `invoice_schedule.credit_type_id` must be fiat. The access credit type belongs
  on the access schedule.
- Archiving a product does not remove active rate-card entries. Close rates with
  `entitled: false` first.
- Setting ingest aliases replaces the whole list.

More: `docs/metronome-cli/GOTCHAS.md` and `metro docs gotcha-reference --markdown`.

## Reporting a vulnerability

See [SECURITY.md](../SECURITY.md).
