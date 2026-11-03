# gotcha-reference
- schemaVersion: `metro.docs.gotcha-reference.v1`
## Summary

```json
{
  "gotchaCount": 59,
  "coveredCount": 58,
  "partialCount": 0,
  "openQuestionCount": 0,
  "coverageStatusCounts": {
    "covered": 58,
    "open": 1
  },
  "categoryCounts": {
    "Tenant And Authentication": 4,
    "Endpoint And Method Shape": 4,
    "Packages": 7,
    "Contracts": 4,
    "Billing Provider And Stripe": 4,
    "Customers": 6,
    "Subscriptions": 4,
    "Rate Cards And Products": 8,
    "Credits And Commits": 5,
    "Invoices": 4,
    "Usage Ingest": 3,
    "Bulk Workflows": 3,
    "Repo Hygiene": 3
  }
}
```

## Gotchas

| id | category | coverageStatus | gotcha |
| --- | --- | --- | --- |
| tenant-selected-by-key | Tenant And Authentication | covered | Production and sandbox share the same Metronome base URL; the API key selects the tenant. |
| env-file-not-authorization | Tenant And Authentication | covered | A local .env file or existing key is not authorization. |
| never-infer-production-from-key-presence | Tenant And Authentication | covered | Loading both production and sandbox keys is common; the CLI must never infer production from key presence. |
| fingerprints-not-key-values | Tenant And Authentication | covered | Print key fingerprints, never key values. |
| read-endpoints-can-be-post | Endpoint And Method Shape | covered | Many Metronome read endpoints are POST. |
| get-endpoints-can-use-query-parameters | Endpoint And Method Shape | covered | Some list/get endpoints are GET with query parameters. |
| verify-endpoint-before-implementation | Endpoint And Method Shape | covered | Before implementing any endpoint, verify it against the local endpoint matrix and current official docs. |
| do-not-guess-endpoint-paths | Endpoint And Method Shape | covered | Do not guess endpoint paths from names. |
| package-contract-restricted-payload | Packages | covered | Package-based contract create accepts a restricted payload; extras such as commits or overrides belong in separate edit workflows. |
| normalize-package-uniqueness-prefix | Packages | covered | Package uniqueness_key may be returned with a package: prefix; normalize before comparing. |
| package-alias-resolution-at-starting-at | Packages | covered | Package alias resolution depends on the contract starting_at, not when the command runs. |
| do-not-archive-old-package-before-alias-live | Packages | covered | Do not archive the old package version until the new alias is live and verified. |
| package-plan-move-renewal-two-step | Packages | covered | Package plan moves should use updateEndDate, then create a successor with transition.type RENEWAL; package contracts do not support SUPERSEDE. |
| move-plan-requires-open-ended-predecessor | Contracts | covered | metro contract move-plan preflight requires exactly one open-ended contract (no ending_before); active trials and expired customers do not qualify. |
| expired-contract-rebuy-no-transition | Contracts | open | Expired contracts (ending_before in the past) must rebuy via fresh contracts/create without a transition block; do not pass RENEWAL from_contract_id on lapsed predecessors. |
| renewal-transition-active-handoff-only | Contracts | covered | RENEWAL transitions are for active predecessor handoffs where successor starting_at aligns with predecessor ending_before; not for rebuy after lapse. |
| free-trial-package-duration-expiry | Packages | covered | Package duration (DAYS) generates contract ending_before at provision; trial expiry is not a separate job. |
| free-zero-rollover-on-rebuy | Contracts | covered | Free trials use rollover_fraction 0; RENEWAL on rebuy carries no useful credits - prefer fresh create when predecessor is expired. |
| package-plan-move-billing-day-realignment | Packages | covered | Billing-day realignment with charge today uses package-plan-move-immediate-invoice: review paid-period overlap (refund vs no refund) before current-hour cutover. |
| billable-workflow-requires-billing-provider | Billing Provider And Stripe | covered | Billable customer or contract workflows must prove billing provider config. |
| stripe-delivery-behavior-explicit | Billing Provider And Stripe | covered | Stripe delivery behavior must be explicit: push to Stripe, keep draft, or no Stripe side effect expected. |
| billing-provider-archive-replace-risk | Billing Provider And Stripe | covered | Archiving or replacing billing provider configs can affect invoice delivery. |
| multi-entity-stripe-fields-not-guessed | Billing Provider And Stripe | covered | Multi-entity Stripe delivery needs endpoint-specific fields and should not be guessed. |
| customer-lookup-is-get | Customers | covered | Customer lookup and search use GET paths with query parameters, not POST customer list payloads. |
| customer-resolve-name-must-not-full-scan | Customers | covered | Name/external-id customer resolve must not paginate the entire /v1/customers list; stop at first exact hit and route email-shaped names through ingest_alias. |
| customer-ingest-alias-collisions | Customers | covered | ingest_aliases are globally unique per tenant, and archived customers can keep aliases pinned. |
| customer-set-ingest-aliases-replaces | Customers | covered | setIngestAliases replaces the full alias list; it is not additive. |
| customer-hierarchy-lives-on-contracts | Customers | covered | Hierarchy is not a customer field; parent/child links live on contracts via hierarchy_configuration. |
| customer-custom-field-whitelist | Customers | covered | Customer custom-field keys are allowlisted per entity type and values are limited to 200 characters. |
| subscription-config-compatibility | Subscriptions | covered | Subscription invoicing requires compatible subscription configuration, not just a product and rate. |
| subscription-billing-frequency-alignment | Subscriptions | covered | Billing frequency must align across rate-card setup and contract/subscription setup. |
| subscription-rate-identity | Subscriptions | covered | Product ID and billing frequency together may identify the intended subscription rate. |
| subscription-quantity-seat-source | Subscriptions | covered | Quantity or seat source must be explicit. |
| product-archive-does-not-remove-rate-card-entry | Rate Cards And Products | covered | Product archive does not remove active rate-card entries. |
| retirement-requires-entitled-false | Rate Cards And Products | covered | Retiring a product requires closing rate entries with entitled:false before archive. |
| scheduled-product-update-readback | Rate Cards And Products | covered | Scheduled product updates may need the endpoint that exposes version history or schedule for verification. |
| dimensional-metric-compound-group-key | Rate Cards And Products | covered | Dimensional action pricing must use one compound billable-metric group key for action_code and action_display_name. |
| dimensional-one-product-not-per-action | Rate Cards And Products | covered | Dimensional action pricing should use one USAGE product with pricing_group_key, not one product per action. |
| dimensional-scope-four-tier-cards | Rate Cards And Products | covered | Multi-tier dimensional rollout means four tier cards (payg, core, select, pro) - not every rate card in the tenant. |
| dimensional-metro-route-first | Rate Cards And Products | covered | For new action codes, run metro route and metro docs explain rate-cards.dimensional, then metro dimensional new-code for production apply. |
| starting-at-hour-boundary | Rate Cards And Products | covered | starting_at values must be hour-boundary timestamps. |
| access-schedule-credit-type-is-access-credit | Credits And Commits | covered | access_schedule.credit_type_id is the product/access credit type for usage. |
| invoice-schedule-fiat-credit-type | Credits And Commits | covered | invoice_schedule.credit_type_id must be a fiat currency when present. |
| complimentary-grant-omit-invoice-schedule | Credits And Commits | covered | Complimentary grants should omit invoice_schedule unless a deliberate zero-dollar audit line is required. |
| paid-topup-invoice-stripe-behavior | Credits And Commits | covered | Paid top-ups must state invoice and Stripe behavior before preview or apply. |
| custom-field-keys-approved | Credits And Commits | covered | Custom-field keys must be approved for the target object type. |
| past-dated-scheduled-charges-finalize | Invoices | covered | Past-dated scheduled charges can finalize immediately. |
| metronome-void-does-not-refund-stripe | Invoices | covered | Voiding in Metronome does not refund Stripe. |
| archive-with-voiding-reconciliation-gap | Invoices | covered | Archiving contracts or customers with invoice voiding can create reconciliation gaps. |
| invoice-issue-date-stripe-behavior | Invoices | covered | Invoice issue-date changes must include expected Stripe behavior. |
| historical-usage-finalized-period-risk | Usage Ingest | covered | Historical usage can alter finalized-period economics or create follow-up billing effects. |
| usage-transaction-id-idempotency | Usage Ingest | covered | Transaction IDs must be stable for idempotency. |
| bulk-ingest-canary-period-target | Usage Ingest | covered | Bulk ingest needs a canary and a clear invoice-period target. |
| dry-run-not-metronome-write-proof | Bulk Workflows | covered | Dry-run does not prove every Metronome write validator will accept a payload. |
| bulk-writes-need-manifest-canary-readback | Bulk Workflows | covered | Bulk writes need preview, manifest, canary, read-back verification, and resumable audit log. |
| partial-failure-resume-evidence | Bulk Workflows | covered | A partial failure must not leave the next run guessing what already happened. |
| do-not-promote-one-off-scripts | Repo Hygiene | covered | Do not promote old one-off scripts into CLI commands. |
| do-not-depend-on-generated-artifacts | Repo Hygiene | covered | Do not depend on ignored generated artifacts as current source. |
| hyperline-evidence-historical | Repo Hygiene | covered | Hyperline evidence is historical unless a task explicitly asks for legacy migration context. |


## Agent notes

- Prefer `--json` when scripting parsers; use `--markdown` when loading context into an agent.
- Never treat HTML as the source of truth, regenerate from `metro docs <ref> --markdown`.
- Live reads/writes still require tenant flags + confirmation tokens.

