# Gotchas

Full list: `metro docs gotcha-reference --json`

Workspace-pack-specific gotchas (dimensional scope, tier cards, provider routing) are documented in your pack's `docs/` directory. Internal workspace packs are not included in this public build.

### metro-loads-sibling-metronome-env

`metro` auto-loads the first existing `.env` from `METRO_ENV_FILE`, `./.env`,
`./metronome/.env`, or `../metronome/.env` (sibling of this repo). It never
overrides already-exported vars and never treats a loaded key as write
authorization. If `METRONOME_PROD_KEY` is still missing after that, the error
names the paths tried - do not scavenger-hunt the filesystem.

### customer-resolve-name-must-not-full-scan

**Cause (2026-07-10):** Customer name/external-id lookup functions called `listPaginated` over
**every** `/v1/customers` page (~60-100s in sandbox). Metronome has no
server-side name filter.

**Fix:** stop at the first exact name / external_id hit; route email-shaped `--name=`
through `ingest_alias` (1 call). Prefer `--customer-id=` when you already have
it. Duplicate display names later in the list are not detected - pass an id
when uniqueness matters.

### confirm-prod-apply-must-reach-client-gate

`--confirm-prod-apply=I_UNDERSTAND_BILLING_SIDE_EFFECTS` is honored from argv
even when an internal `makeClient` call passes empty flags. Prefer the CLI flag
on the Apply line; `ALLOW_DANGEROUS_SCRIPT` / `METRO_CONFIRM_PROD_APPLY` still
work as env fallbacks.

### package-plan-move-billing-day-realignment

Billing-day realignment with **charge today** uses
`package-plan-move-immediate-invoice`, not the future-dated no-immediate shape.
Review paid-period overlap (`paidPeriodOverlapPolicy`) before a current-hour
cutover - Metronome may finalize the SCHEDULED plan fee immediately.

## Dimensional pricing

### dimensional-metric-compound-group-key

The dimensional rate-card validator rejects separate `action_code` and
`action_display_name` group keys. The billable metric must use one compound
group key containing **both** fields. Usage events must expose both properties.

### dimensional-one-product-not-per-action

Use **one USAGE product per tier rate card**. New action codes are `addRates`
rows with `pricing_group_values` for the dimension - not new products.
`products.create` is refused for this pattern.

### rate-cards-add-rates-hour-boundary

`starting_at` on `rateCards.addRates` must be a UTC hour boundary. Past-hour
schedules may finalize invoice lines immediately depending on contract state.

### contract-overrides-vs-rate-card-source

`rateCards.getRates` returns rate-card source prices. Customer contracts with
overrides require `contracts.getRateSchedule`. See
`metro docs explain contract-overrides.inspection --json`.

## Contract transitions and rebuy

Full reference: `metro docs explain contract-transitions.rebuy --json`

> Internal workspace pack docs are not included in this public build.

### expired-contract-rebuy-no-transition

**Expired** contracts (`ending_before` in the past) → paid upgrade must be a **fresh**
`contracts/create` **without** `transition`. Do not pass `RENEWAL` +
`from_contract_id` when the predecessor is already ended - suspected cause of
2026-07-09 trial-upgrade failures. Source: Metronome [subscription lifecycle](https://docs.metronome.com/guides/pricing-packaging/subscription/manage-subscription-lifecycle);
See `metro docs explain contract-transitions.rebuy --json` for full reference.

### move-plan-requires-open-ended-predecessor

`metro contract move-plan` preflight requires exactly **one** contract with **no**
`ending_before` (open-ended paid). Active or expired **trials** do not qualify.
Source: workspace pack preflight logic (internal workspace packs are not included in this public build).

### renewal-transition-active-handoff-only

`transition.type: RENEWAL` is for handoffs where successor `starting_at` aligns with
predecessor end (after `updateEndDate` or at natural renewal). Verified via two-step pattern. Source:
`skills/metronome-packages-contracts/SKILL.md` § Transitions.

### free-trial-package-duration-expiry

Package `duration` (DAYS) generates contract `ending_before` at provision - not a
separate “expiry job.” Confirm live trial-package days via `packages/get`. Source:
[create-a-package](https://docs.metronome.com/api-reference/contracts/create-a-package.md);
CLI shape `free-credit-trial`.
