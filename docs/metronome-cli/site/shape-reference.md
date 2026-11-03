# shape-reference
- schemaVersion: `metro.docs.shape-reference.v1`
## Shapes

| id | family | maturity | purpose |
| --- | --- | --- | --- |
| customer-setup | customer | local-validated | Validate and locally preview Metronome customer creation with ingest aliases, optional Stripe billing-provider setup, customer custom fields, hierarchy posture, and read-back checks before any API client loads. |
| pro-annual | package | local-validated | Validate and locally preview the input needed to create a paid annual Pro package shape before any API client loads. |
| pro-annual-self-serve-v2 | package | local-validated | Validate and preview annual self-serve packages with explicit annual plan fee and creditGrantMode monthly-drip (1/12) or lump-sum recurring_commits. |
| free-credit-trial | package | local-validated | Validate and locally preview the input needed to create a free-trial package with recurring credit grants, auto-expiry, and no Stripe billing before any API client loads. The shape enforces commit_duration.unit PERIODS, duration.value as a string, starting_at_offset, and proration so agents never hand-craft this payload. |
| complimentary-credit-grant | credit | local-validated | Validate and locally preview a pure access grant or zero-dollar audit-line grant without loading Metronome clients. |
| paid-credit-top-up | credit | local-validated | Validate and locally preview a payment-gated paid credit top-up on an existing contract without loading Metronome or Stripe clients. |
| package-alias-archive-handoff | package | local-validated | Validate and locally preview archiving an old package version only after the replacement alias is already live and verified. |
| stripe-billing-provider-attachment | billing-provider | local-validated | Validate and locally preview the input needed to attach Stripe billing provider configuration to an existing Metronome customer. |
| package-plan-move-no-immediate-invoice | contract | local-validated | Validate and locally preview a package-based contract transition that moves a customer at a future cutover without intentionally creating an immediate invoice. |
| package-plan-move-immediate-invoice | contract | local-validated | Validate and locally preview a package-based RENEWAL transition at current or past UTC hour that intentionally issues an immediate SCHEDULED plan fee (billing-day realignment, package version handoff). |
| product-rate-retirement | product | local-validated | Validate and locally preview closing product rate-card entries with entitled:false and price:0 before any product archive is planned. |
| dimensional-rate-card | rate-card | local-validated | Validate and locally preview one dimensional USAGE product plus per-action rate-card entries before any Metronome client loads. |
| invoice-issue-date-update | invoice | local-validated | Validate and locally preview moving a DRAFT invoice issue date through the contract-scoped updateInvoiceIssueDate endpoint before any API client loads. |
| direct-subscription-contract | subscription | local-validated | Validate and locally preview a direct contract with one subscription line before any API client loads. |
| usage-ingest-preview | usage | local-validated | Validate and locally preview a Metronome usage event batch before any invoice preview or ingest API call can run. |
| enterprise-custom-contract | custom-contract | local-validated | Validate and locally preview a direct enterprise custom contract with explicit rate card, recurring commit, Stripe billing-provider config, optional bonus commits, and optional seat assignments without loading API clients. |


## Agent notes

- Prefer `--json` when scripting parsers; use `--markdown` when loading context into an agent.
- Never treat HTML as the source of truth, regenerate from `metro docs <ref> --markdown`.
- Live reads/writes still require tenant flags + confirmation tokens.

