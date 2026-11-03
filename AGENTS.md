# metro: operating manual for agents

You are an agent using `metro`, an open-source CLI for Metronome billing. This file
is your manual. `metro init` copies it to `~/.metro/AGENTS.md`. Read all of it
before you run a command that talks to Metronome.

## 1. What metro is

metro is Metronome in your terminal, for any Metronome tenant. It reads your
billing setup, previews changes as local files, validates them against known
Metronome gotchas, and applies them only through gates: a typed confirmation, a
payload hash, then a read-back that compares expected and actual.

- License: Apache-2.0. Node 18 or newer.
- Package: `@metrocli/metro`. Source: https://github.com/metrocli/metro
- Exit codes: `0` success, `1` usage, validation, missing setup, blocked plan or API
  error, `2` safety refusal, `3` read-back mismatch after a live write (the write
  happened; read the apply log before retrying, never re-run blindly).
- Prefer `--json`. Success payloads go to stdout. Refusals and progress go to stderr.

## 2. Metronome in two minutes

Data flows in this order: usage events, then billable metrics, then products and
rate cards, then contracts, then invoices.

| Object | What it is |
|---|---|
| Customer | The account you bill. Usage events reach a customer through its `ingest_aliases`. Setting ingest aliases replaces the whole list. |
| Usage event | A raw record of what a customer did, in a schema you design. |
| Billable metric | Turns usage events into billable quantities: filters plus an aggregation (`COUNT`, `SUM`, `MAX`, `LATEST` for streaming metrics; SQL metrics for distinct counts). Group keys split usage for invoice breakouts or dimensional pricing. |
| Product | A line item on an invoice. Types include usage, fixed and subscription. A product has no price of its own. |
| Rate card | Default prices for products, effective from a start date. Contracts point at a rate card and can override it. |
| Package | A reusable, customer-agnostic contract template: rate card, duration, billing settings, and optionally commits, credits and subscriptions. Packages cannot be edited, so you publish a new one behind the same alias. |
| Contract | Connects one customer to pricing: a rate card or package, overrides, commits, credits, subscriptions and billing schedule. |
| Commit | A customer's agreement to spend an amount over time. Prepaid commits are invoiced up front (invoice schedule) and drawn down by usage (access schedule). Postpaid commits are settled after usage. |
| Credit | A free allowance of spend or quantity. No invoice schedule. |
| Subscription and seats | A recurring charge on a subscription product. Quantity is the number of subscriptions, usually seats. Seat management tracks seat count changes over time. Changes go through a contract edit. |
| Invoice | Built from usage, rates and contract terms at the end of each billing period, then finalized and sent to the billing provider (for example Stripe). Voiding in Metronome does not refund Stripe. |

Source of truth: https://docs.metronome.com/ . When a doc and this table disagree, the doc wins.

## 3. Set up (agent steps)

1. Install from source: `git clone --depth 1 https://github.com/metrocli/metro.git ~/.metro/src && bash ~/.metro/src/scripts/install-global.sh`.
   Once `@metrocli/metro` is published to npm, `npm install -g @metrocli/metro` also works.
2. Run `metro init --agent`. It creates `~/.metro/.env` (mode 600) with empty
   placeholders, puts metro in read-only mode, and prints steps for the human.
3. Ask the human to open https://app.metronome.com/sandbox/developer/api-tokens ,
   create a token, and paste it into `~/.metro/.env` after `METRONOME_SANDBOX_KEY=`
   in their editor. **Never ask them to paste a key into chat.** If they paste one
   anyway, do not repeat it, and tell them to revoke it and create a new one.
4. When they say "done", run `metro init --check --json`. Continue only when
   `keys.sandbox.status` is `working`. Otherwise relay the `next` field verbatim.
5. A production key is optional and comes last. Only the human adds it, with
   `metro init --prod` or by editing the file.

## 4. The safety contract

These rules are not optional, and metro enforces most of them in code.

1. **Read-only by default.** After init, metro can look, preview and validate.
   Writes need `metro mode write`, and only the human decides to raise it.
2. **Sandbox first.** Every change is proven on sandbox before production is discussed.
3. **Always name the tenant.** Pass `--sandbox` or `--prod`. metro never picks
   production on its own. Without a flag it uses sandbox only when a sandbox key is set.
4. **Preview, confirm, apply, read back.** Every write follows the same ladder:
   - preview or preflight writes a local file and prints `payloadHash` (`sha256:...`)
   - you show the human the plain-English change and the hash
   - apply runs with `--confirm-hash <hash>`; without `--apply` it is a dry run
   - after a live apply metro re-reads the object and fails on any mismatch
   - you report expected vs actual
5. **Production needs the human's explicit typed yes in chat for that specific
   change.** A yes for one change never covers the next one. A green preview is
   not authorization, and neither is a key being present.
6. **Never print keys.** Do not `cat` or echo `~/.metro/.env`. metro shows
   fingerprints, never key values. Inspect variable names only.

## 5. Learn the tenant before you act

Build on what you know about the company instead of guessing IDs.

```bash
metro status --json                          # mode, keys, allowlists
metro catalog bind --sandbox --write         # discovers products, rate cards, credit types into ~/.metro/profiles.json
metro tenant snapshot show --sandbox --markdown   # account pattern, catalog summary
metro ops who "Acme" --sandbox               # one customer: contract, credits, balances
```

Read the snapshot's `accountPattern` before proposing a pricing change. Reuse
the bound catalog IDs. If something is missing, say so; do not invent IDs.

## 6. Provisioning workflow

Run each on sandbox first, through the safety ladder in section 4.

| Goal | Command |
|---|---|
| Create a customer with ingest aliases | `metro customer create` |
| Create a rate card | `metro ratecard create` |
| Create a package (contract template) | `metro package create` |
| Create a contract (from a package or direct) | `metro contract create` |
| Add a subscription to a contract | `metro subscription add` |
| Change subscription quantity or seats | `metro subscription set-quantity` |
| Move a customer to another package | `metro contract move-plan preflight` then `apply` |
| Extend a trial | `metro contract extend-trial preflight` then `apply` |
| End a contract | `metro contract expire preflight` then `apply` |
| Adjust a credit or commit balance | `metro ledger-adjustment preflight` then `apply` |
| Archive a contract created by mistake | `metro contract repair-accidental preflight` then `apply` |
| Replace a Stripe billing-provider config | `metro billing-provider cutover preflight` then `apply` |
| Offline plan for a common intent | `metro plan list`, then `metro plan <intent> --sandbox --json` |
| Validate an input file | `metro validate --shape <shape> --file <file> --json` |

If a command reports `Unknown command`, the installed metro predates it. Update
metro, or fall back to `metro plan` and `metro api preview` for that step.

## 7. Which docs and skills to load

- `skills/metro/SKILL.md`: command discovery, output format, the guarded read and apply chain. Load it for any metro task.
- `docs/metronome-cli/COOKBOOK.md`: copy-paste workflows.
- `docs/metronome-cli/GOTCHAS.md` and `metro docs gotcha-reference --markdown`: known Metronome traps. Load before any write.
- `metro docs explain <topic> --markdown`: focused explanations, for example `credits.product.decision`.
- `docs/SAFETY.md`: the full safety policy.
- `metro schema --json`: every command and exit code.

## 8. Report a doorway

After setup, or after any task, end with three concrete next actions the human
can say yes to. Base them on what you learned about this tenant. Example:

1. "Bind your sandbox catalog so I can name your real products: `metro catalog bind --sandbox --write`."
2. "Look up your largest customer and show its contract and balances: `metro ops who "<name>" --sandbox`."
3. "Preview one pricing change you've been meaning to make, on sandbox, with nothing applied."
