# Metronome Skills - Index

Start with the `metro` skill (`skills/metro/SKILL.md`): it explains the
CLI safety model and key setup. Then route here.

## Quick routing: "I want to do X, go to skill Y"

| If your task involves... | Go to |
|---|---|
| **Before writing ANY Metronome API call** | `metronome-danger-zone` (`references/endpoint-matrix.md` is the path source of truth) |
| Keys, sandbox vs production, `--sandbox` / `--prod`, confirm tokens, readback proof | `metro` + `_metronome-shared/conventions.md` |
| Base facts (base URL, auth header, USD credit type, timestamps, pagination, errors) | `_metronome-shared/conventions.md` |
| Sending usage events (`/v1/ingest`), batching, `transaction_id` dedupe | `metronome-ingestion-events` |
| Past-dated ingest / 34-day back-date window, searching events by `transactionIds` | `metronome-ingestion-events` |
| Billable metrics: aggregation types, `group_keys`, `property_filters`, non-retroactivity | `metronome-ingestion-events` |
| Products (USAGE / FIXED / SUBSCRIPTION / COMPOSITE / PRO_SERVICE) | `metronome-pricing-catalog` |
| Rate cards, rate types (FLAT / PERCENTAGE / TIERED / SUBSCRIPTION / CUSTOM / TIERED_PERCENTAGE) | `metronome-pricing-catalog` |
| `addRates` vs `addRate`, `getRates` pagination, per-customer overrides | `metronome-pricing-catalog` |
| Packages (reusable contract templates), package aliases and version windows | `metronome-packages-contracts` |
| Creating a contract (package-based or direct), `uniqueness_key` | `metronome-packages-contracts` |
| `usage_statement_schedule.day` (`FIRST_OF_MONTH` vs `CONTRACT_START`) | `metronome-packages-contracts` |
| `POST /v2/contracts/edit` operations | `metronome-packages-contracts` (`references/editcontract-ops.md`) |
| `updateEndDate`, archive, transitions (RENEWAL / SUPERSEDE), bridge contracts | `metronome-packages-contracts` |
| Commits vs credits, complimentary grants, PREPAID / POSTPAID, rollover, priority | `metronome-packages-contracts` |
| Balances (`customerBalances/list`, `getNetBalance`), payment-gated top-ups | `metronome-packages-contracts` |
| Voiding, regenerating, invoice state machine (DRAFT, FINALIZED, VOID) | `metronome-invoicing` |
| Auto-finalize timing (USAGE vs SCHEDULED), PDFs, breakdowns, watcher pattern | `metronome-invoicing` |
| `updateInvoiceIssueDate` on a DRAFT | `metronome-invoicing` |
| Attaching Stripe to a customer, billing-provider configurations | `metronome-stripe-delivery` |
| `delivery_method` vs `delivery_method_id`, `leave_stripe_invoices_in_draft` | `metronome-stripe-delivery` |
| `external_invoice.status`, Stripe vs Metronome reconciliation | `metronome-stripe-delivery` |
| Creating / archiving / renaming a customer, lookup by ingest alias | `metronome-customers-hierarchies` |
| `setIngestAliases`, alias reuse after archive | `metronome-customers-hierarchies` |
| Custom fields (`addKey`, `setValues`, 200-char values) | `metronome-customers-hierarchies` |
| Parent-child hierarchies, shared commits | `metronome-customers-hierarchies` |
| Subscriptions, SEAT_BASED vs QUANTITY_ONLY, seat balances, quantity updates | `metronome-subscriptions-seats` |
| Webhook handler safety, destructive side effects, past incident patterns | `metronome-danger-zone` (`references/learnings.md`) |

## Skill inventory

| Skill | Purpose | `references/` |
|---|---|---|
| `metro` | Entry skill: CLI safety model, key setup, command discovery. | - |
| `metronome-danger-zone` | Pre-flight guardrails for every call; verified paths, side effects, anonymized incident lessons. | `endpoint-matrix.md`, `learnings.md` |
| `metronome-ingestion-events` | `/v1/ingest`, `transaction_id` dedupe, back-date window, event search, billable metrics. | - |
| `metronome-pricing-catalog` | Products, rate cards, rate types, overrides, `addRates` / `getRates`. | `rate-types.md` |
| `metronome-packages-contracts` | Packages, contracts, editContract, end dates, transitions, commits and credits. | `editcontract-ops.md` |
| `metronome-invoicing` | Invoice state machine, void / regenerate, issue dates, breakdowns, watcher pattern. | `watcher-pattern.md` |
| `metronome-stripe-delivery` | Billing-provider configs, delivery methods, Stripe reconciliation. | `reconciliation-snippet.md` |
| `metronome-customers-hierarchies` | Customers, ingest aliases, custom fields, hierarchies. | `custom-fields-workflow.md`, `hierarchies-cookbook.md` |
| `metronome-subscriptions-seats` | Subscriptions, seats, quantity schedules and updates. | - |

## When skills disagree

Source-of-truth order (highest wins):

1. Official docs at https://docs.metronome.com (and `metro api explain <endpoint-id>`, which is source-linked)
2. `metronome-danger-zone/references/endpoint-matrix.md` - verified paths and methods
3. `metronome-danger-zone/SKILL.md` - verified payloads and side effects
4. Specialist skill bodies

If a claim is not backed by 1-3, treat it as an educated guess and verify
in sandbox before acting on it. If you find a skill that is wrong, fix it
in a PR so the next agent does not repeat the mistake.

Statements marked "Recommended practice" are operating advice, not API
behavior. Adapt them to your tenant.
