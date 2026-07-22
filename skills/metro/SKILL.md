# metro CLI agent skill

Generated from `metro schema --json` and the live endpoint allowlist. Re-run `node scripts/generate-agent-skill.js` after CLI changes.

## When to use

Use `metro` for Metronome billing operations: validate inputs, preview changes, guarded sandbox reads/writes, API catalog literacy, and evidence-gate workflows. Official API docs: https://docs.metronome.com/

**Public / generic installs:** default pack is `generic` (`metro workspace use generic --write`). Start with `metro catalog bind --sandbox --write`, then `metro ops` / `metro ops who`.

## Install

```bash
npm install -g @metrocli/metro
metro workspace use generic --write
metro setup init --workspace generic --write
```

## Agent rules

**Response format (required every turn):**

1. **Plain English first** - billing goal, what will/will not change in Metronome, approval needed before live commands.
2. **Technical second** - exact `metro … --json` commands, `schemaVersion`, stdout vs stderr, hashes, evidence files.

**Execution rules:**

1. Run `metro schema --json` first for command discovery and exit codes.
2. Prefer `--json` on every command; parse **stdout** for success payloads only.
3. Treat **stderr** as human progress and refusals (`metro.refusal.v1`, `metro.api.read.refusal.v1`).
4. Exit codes: `0` success · `1` validation · `2` safety refusal.
5. Never infer tenant from env keys - pass `--sandbox` or `--prod` explicitly.
6. Live reads require `--read-gate` + `--confirm-live-read I_UNDERSTAND_THIS_WILL_READ_LIVE_METRONOME`.
7. Live sandbox apply requires `--apply-gate`, `--approval-record`, and `--confirm-live-apply I_UNDERSTAND_THIS_WILL_WRITE_LIVE_METRONOME_SANDBOX`.
8. Read `metro docs explain output.anatomy --json` before interpreting output.
9. Run `metro harness run --suite agent-literacy --execute --json` then `metro harness run --suite api-literacy --fixture-root test/fixtures --execute --json` from a checkout to prove agent Markdown + API catalog literacy.
10. Prefer Markdown for context: `metro docs <ref> --markdown`, index at `docs/metronome-cli/site/agents.md`. HTML is for humans.
11. Vague “credits product” / new metric / aggregation asks: `metro docs explain credits.product.decision --markdown` before any `products.create`.
12. After sandbox keys: `metro catalog bind --sandbox --write` then `metro tenant snapshot show --markdown`. Prefer snapshot `accountPattern` over guessing catalog shape.
13. If pattern is `greenfield-needed`: `metro plan greenfield-credits-product --sandbox --json` → api validate/preview. Sandbox create apply needs `--confirm-greenfield-create=I_UNDERSTAND_SANDBOX_CATALOG_CREATE` in addition to the live-apply token.
14. Keep shapes honest vs Metronome: `docs/metronome-cli/METRONOME_UPSTREAM_CHANGELOG.md` and `npm run docs:upstream:check`.

**Promote the codebase (when work is thrashing):**

If a request takes many tool runs, greps, doc hops, or long discovery chains - do not hide it. Say: "This can be faster. I can draft a PR that adds a metro command / shape / validator / cookbook line so the next person does not repeat this." Offer to draft the PR; the human runs and merges. Prefer one lasting shortcut rooted in truth (catalog + official sources + offline test) over another heroic archaeology session. See `docs/metronome-cli/site/agents.html#promote-codebase`.

## Live read endpoints (current release)

- `contracts.get.v2`
- `contracts.list.v2`
- `customers.get`
- `customers.list`
- `invoices.listForCustomer`
- `invoices.get`
- `packages.get`
- `packages.list`
- `packages.listContractsOnPackage`
- `rateCards.get`
- `rateCards.list`
- `rateCards.getRates`
- `products.get`
- `products.list`
- `customerBalances.list`
- `credits.list`
- `commits.list`
- `customFields.listKeys`
- `billingProvider.getCustomerConfigurations`
- `security.getAuditLogs`

## Live sandbox apply endpoints

- `contracts.create` (sandbox only)
- `contracts.edit.v2` (sandbox only)
- `packages.create` (sandbox only)
- `customers.create` (sandbox only)
- `customFields.setValues` (sandbox only)
- `rateCards.addRates` (sandbox only)

## High-value commands

- `metro shape list [--json]` - List supported workflow shapes and maturity levels.
- `metro shape explain <shape> [--json]` - Explain a shape, including required input, maturity, blocked modes, rule IDs, and sources.
- `metro validate --shape <shape> --file <input.json|yaml> [--json]` - Validate local JSON or YAML input against a supported shape before any API client loads.
- `metro input normalize (--shape <shape>|--api <endpoint-id>) --file <input.json|yaml> [--json]` - Normalize local JSON or YAML workflow shape input or expert API request input into stable canonical JSON with validation status, secret-scan refusal, and deterministic hash output.
- `metro workspace explain [--sandbox|--prod] [--json]` - Explain the workspace catalog model, tier rate cards, API token conventions, and plan intents for optimal shape routing.
- `metro workspace status --file <profiles.json> --profile <name> [--check-env] [--json]` - Bind a tenant profile to the workspace model and report whether the Metronome key env var is configured (name only, never the secret).
- `metro plan template <intent> (--sandbox|--prod) [--out <out.json>] [--token <name>] [--action-code <code>] [--display-name <text>] [--price <n>] [--file <profiles.json>] [--profile <name>] [--json]` - Emit a focused inputTemplate JSON payload for a workspace intent, optionally writing it to a file for validate/preview follow-on.
- `metro plan list [--json]` - List workspace-aware plan intents that map billing goals to optimal shapes and rejected API paths.
- `metro plan <intent> (--sandbox|--prod) [--token <name>] [--action-code <code>] [--display-name <text>] [--price <n>] [--file <profiles.json>] [--profile <name>] [--json]` - Build a workspace-aware plan for a billing intent: optimal shape, catalog mode, rejected paths, commands, verification reads, and input templates.
- `metro route --goal "<billing goal>" [--api <endpoint-id>] (--sandbox|--prod) [--json]` - Match a billing goal or API endpoint to the optimal workspace plan intent and refuse suboptimal catalog paths.
- `metro audit export classify --file <audit-export.json> [--token <name>] (--sandbox|--prod) [--json]` - Classify exported Metronome audit log rows by action histogram and map to workspace plan intents (local file only).
- `metro audit export plan --token <name> (--sandbox|--prod) [--json]` - Build the local audit export workflow (security.getAuditLogs read plan steps + classify); does not perform live reads.
- `metro package preview --shape pro-annual-self-serve-v2 --file <input.json|yaml> (--sandbox|--prod) [--json]` - Preview annual self-serve package v2 with separable plan fee and monthly-drip or lump-sum recurring_commits.
- `metro package preview --shape free-credit-trial --file <input.json|yaml> (--sandbox|--prod) [--json]` - Validate and preview a free-trial package with recurring credit grants, auto-expiry (duration in days), and no Stripe. Enforces commit_duration.unit PERIODS, duration.value as a string, starting_at_offset, and proration - do not hand-craft this payload.
- `metro package preview --shape pro-annual --file <input.json|yaml> (--sandbox|--prod) [--json]` - Build a local package preview payload plan, side-effect summary, verification plan, and canonical hash.
- `metro package archive preview --file <input.json|yaml> (--sandbox|--prod) [--shape package-alias-archive-handoff] [--json]` - Build a local package archive plan that refuses old-version archive until the replacement alias is live and verified, without calling Metronome.
- `metro credit preview --shape complimentary-credit-grant --file <input.json|yaml> (--sandbox|--prod) [--json]` - Build a local complimentary-credit preview payload plan, side-effect summary, verification plan, and canonical hash.
- `metro credit preview --shape paid-credit-top-up --file <input.json|yaml> (--sandbox|--prod) [--json]` - Build a local paid credit top-up preview payload plan with fiat invoice schedule, Stripe payment gate, side-effect summary, and read-back plan.
- `metro billing-provider preview --shape stripe-billing-provider-attachment --file <input.json|yaml> (--sandbox|--prod) [--json]` - Build a local Stripe billing-provider attachment payload plan, Stripe draft-behavior plan, verification plan, and canonical hash.
- `metro customer setup preview --file <input.json|yaml> (--sandbox|--prod) [--shape customer-setup] [--json]` - Build a local customer setup plan with identity, ingest alias collision checks, optional Stripe billing-provider config, hierarchy posture, custom-field approval evidence, read-back checks, and a canonical hash.
- `metro contract move-plan preview --file <input.json|yaml> (--sandbox|--prod) [--shape package-plan-move-no-immediate-invoice] [--json]` - Build a local package plan-move preview using updateEndDate plus a RENEWAL successor contract, without calling Metronome.
- `metro product retire preview --file <input.json|yaml> (--sandbox|--prod) [--shape product-rate-retirement] [--json]` - Build a local product/rate retirement plan that closes affected rate-card entries before optional product archive, without calling Metronome.
- `metro rate-card dimensional preview --file <input.json|yaml> (--sandbox|--prod) [--shape dimensional-rate-card] [--json]` - Build a local dimensional rate-card plan for one action-code USAGE product plus per-action addRates entries, without calling Metronome.
- `metro invoice issue-date preview --file <input.json|yaml> (--sandbox|--prod) [--shape invoice-issue-date-update] [--json]` - Build a local DRAFT invoice issue-date update plan with explicit Stripe behavior, contract-end evidence, and read-back checks, without calling Metronome.
- `metro subscription contract preview --file <input.json|yaml> (--sandbox|--prod) [--shape direct-subscription-contract] [--json]` - Build a local direct subscription contract plan with rate-card identity, frequency, quantity/seat source, billing-provider, and read-back checks, without calling Metronome.
- `metro custom-contract preview --file <input.json|yaml> (--sandbox|--prod) [--shape enterprise-custom-contract] [--json]` - Build a local direct enterprise custom-contract plan with explicit customer identity, Stripe billing-provider config, recurring commit, optional bonus commits, optional seat updates, side-effect summary, read-back plan, and canonical hash.
- `metro usage ingest preview --file <input.json|yaml> (--sandbox|--prod) [--shape usage-ingest-preview] [--json]` - Build a local usage ingest preview plan with event-shape validation, transaction-id idempotency, invoice-period risk review, canary gating, and read-back checks, without calling Metronome.
- `metro api catalog [--family <family>] [--json]` - List reviewed Metronome endpoint IDs, methods, paths, support status, source IDs, and local-only live-execution state.
- `metro api explain <endpoint-id> [--json]` - Explain one reviewed endpoint contract, including operation type, permission scope, request/response contract, gates, current workflow commands, and sources.
- `metro api search <query> [--query <text>] [--family <family>] [--json]` - Search reviewed endpoint IDs, titles, methods, paths, summaries, source IDs, policy gates, and command text without loading API clients.
- `metro api diff <left-endpoint-id> <right-endpoint-id> [--json]` - Compare two reviewed endpoint contracts by endpoint ID, including local method/path metadata, request and response contracts, policy gates, command coverage, source IDs, and disabled live-execution state.
- `metro api export [--family <family>] [--json]` - Export a source-linked local documentation bundle for reviewed API endpoint docs, command docs, workflow shape docs, validator rules, gotchas, approval policies, and checked-in example fixtures without loading API clients.
- `metro api scopes [--family <family>] [--json]` - List expert API permission scopes derived from the reviewed endpoint catalog, including access class, endpoint coverage, approval model, live-execution status, and required gates.
- `metro api approvals [--family <family>] [--json]` - List local expert API approval policies by permission scope, including accountable owner role, required approver roles, approval record fields, evidence requirements, confirmation requirement, and disabled live-execution status.
- `metro api readiness [--family <family>] [--summary] [--json]` - Summarize reviewed read and write endpoint readiness, including compact gap counts with --summary, endpoint-specific validator coverage, local read-plan coverage, write proof-ladder coverage, and disabled live-read/write status.
- `metro api validate <endpoint-id> --file <request.json|yaml> [--json]` - Validate a local expert API request file against a reviewed endpoint id, source-linked contract, permission scope, and endpoint-specific safety rules without loading API clients.
- `metro api read-plan <endpoint-id> --file <request.json|yaml> (--sandbox|--prod) [--json]` - Build a local expert API read plan for a reviewed read endpoint, including explicit tenant, endpoint-specific request validation, request hash, future confirm-live-read gate, and stable output contract without loading API clients.
- `metro api read-preflight <endpoint-id> --file <request.json|yaml> (--sandbox|--prod) [--read-gate <api-read-gate.json>] [--confirm-live-read <token>] [--json]` - Build a local expert API read preflight summary that combines endpoint selection, explicit tenant, request validation, local read-plan evidence, optional read-gate validation, live-read authorization evidence, and remaining runtime blockers without loading API clients.
- `metro api read-gate template --read-plan <api-read-plan.json> [--profile-resolution <profile-resolution.json>] [--profile <profile>] [--key-env <env>] [--key-fingerprint <fingerprint>] [--authorization-id <id>] [--approved-by <name>] [--audit-log <path>] [--json]` - Build a local expert API read-gate manifest that binds a reviewed read-plan file hash to tenant profile-resolution evidence, current-turn authorization, audit-safe request summary rules, and stable output verification without enabling live reads.
- `metro api read-gate validate --file <api-read-gate.json> [--json]` - Validate local expert API read-gate evidence for read-plan hash binding, tenant profile, current-turn authorization, audit-safe summaries, read-only runner requirements, and output verification while live reads remain disabled.

## First safe path (no API key)

```bash
metro setup quickstart --shell | zsh
metro validate --shape pro-annual --file "${TMPDIR:-/tmp}/metro-quickstart/pro-annual.json" --json
metro package preview --shape pro-annual --file "${TMPDIR:-/tmp}/metro-quickstart/pro-annual.json" --sandbox --json
```

## Refusal shape

Refusals include:

- `summary` - one-line English reason
- `nextCommands` - up to 3 commands to run next
- `nextSafeStep` - derived from the first next command

## Catalog stats

- Supported local commands: 140
- Catalog endpoints: 69
- Schema version: metro.docs.command-reference.v1

## Sources

- Agent harnessing (site): docs/metronome-cli/site/agents.html
- Promote-the-codebase rule: docs/metronome-cli/site/agents.html#promote-codebase
- Upstream Metronome changelog coverage: docs/metronome-cli/METRONOME_UPSTREAM_CHANGELOG.md
- Team quickstart: `TEAM-QUICKSTART.md`
- Command reference: `metro docs command-reference --json`
- API reference: `metro docs api-reference --json`
- Metronome official docs: https://docs.metronome.com/
- Official changelog: https://docs.metronome.com/changelog
