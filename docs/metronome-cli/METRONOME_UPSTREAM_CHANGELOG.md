# Metronome upstream changelog - metro coverage

Source of truth (official): [https://docs.metronome.com/changelog](https://docs.metronome.com/changelog)
Machine-readable markdown: [https://docs.metronome.com/changelog.md](https://docs.metronome.com/changelog.md)
Docs index: [https://docs.metronome.com/llms.txt](https://docs.metronome.com/llms.txt)

Last synced into metro: **2026-11-03** (`docs/metronome-cli/site/metronome-upstream.json`).

Metro does **not** auto-ingest OpenAPI. This page is the checklist that keeps
shapes, the endpoint matrix, and `api-catalog` honest when Metronome ships changes.

## How to refresh

```bash
npm run docs:upstream:check
npm run docs:upstream:check -- --fetch
node scripts/generate-metronome-upstream.js --fetch
```

When `--fetch` reports new entries: curl every linked official `.md` page,
update `skills/metronome-danger-zone/references/endpoint-matrix.md` and/or
`packages/metro-core/src/api-catalog/index.js` + shapes/validators, classify the
new title in `scripts/generate-metronome-upstream.js` (COVERAGE map), re-run
this generator, and regenerate goldens/site if catalog output changed.

## Coverage legend

| Status | Meaning |
|---|---|
| `accounted` | Metro catalog/skills/docs already cover the behavior |
| `partial` | Related coverage exists; missing gotcha, shortcut, or validator prose |
| `gap` | API-relevant and not yet represented - fix before relying on the feature |
| `n/a` | Not an applicable metro operating surface |
| `n/a-sdk` / `n/a-ui` | SDK or UI-only; no metro shape work unless API fields change |

## Gaps that need follow-up

- **GAP** May 29, 2026 - Configurable rounding for prorated subscriptions and recurring commits: No shape/validator/docs yet for proration rounding fields. Curl subscription + recurring commit API docs before first use.
- **GAP** February 5, 2026 - Get net balance API: Verified in endpoint-matrix (`POST /v1/contracts/customerBalances/getNetBalance`) but **not** yet a reviewed api-catalog ID / `metro api read` shape. Prefer over paginating balances when consolidating.

## Batch / large requests (smart paths)

Official guides: [high-volume ingestion](https://docs.metronome.com/guides/events/high-volume-ingestion),
[send usage events](https://docs.metronome.com/guides/events/send-usage-events),
[API quickstart](https://docs.metronome.com/guides/get-started/api-quickstart).

| Need | Smart path in metro | Do not |
|---|---|---|
| Full package inventory | `metro package list --sandbox` or `--prod` (follows `next_page`) | Single-page `api read` and assume page = tenant |
| Who is on a package | `metro package customers --package <id or alias>` | Manual contracts-on-package loops without page follow |
| Many plan moves | `metro contract move-plan bulk-preflight` then `bulk-apply` with `--delay-ms` / `--limit` canary | Parallel writers across the fleet |
| New action code on all cards | `metro dimensional new-code --all ...` | Hand-rolled per-card scripts |
| Usage aggregates (multi-customer) | Reviewed `usage.batch` + query `next_page` | Stuffing pagination into POST body |
| Usage by dimensions | `usage.groups` (compound keys only if BM defines them; max page 100) | Grouping by multiple simple keys |
| Combined credit+commit balance | Prefer **getNetBalance** once catalogued; until then balances list + pagination | N+1 per commit without a reason |
| Ingest | Batches ≤100 events; stable transaction IDs; retry client on 429 | Firehose without backoff |
| Rate append | `addRates` ≤100 rows per call | Mega payloads |
| Audit log export | `metro audit export plan` documents pagination; live pull is gated | Unbounded concurrent page fetches |

Pagination rule (current API): for nearly all modern list endpoints,
`limit` and `next_page` belong in the **URL query string**, not the POST body.
(Older local notes that said “send next_page in the body” are wrong for packages,
getRates, usage.groups/batch, contracts-on-package, etc. - validators enforce query.)

Retry: metro uses `metronome-retry-client` (429/5xx backoff).
Still prefer serial pagination + bulk `--delay-ms` over high concurrency.

## Full inventory (every official entry)

### October 13, 2026 - Get notified when subscriptions are created, start, or end

**Metro coverage:** `unknown` - Not yet classified - curl linked docs and update COVERAGE in this script.

Official links:

- [system notifications](https://docs.metronome.com/guides/customers-billing/set-up-notifications/system-notifications.md)
- [offset notifications](https://docs.metronome.com/guides/customers-billing/set-up-notifications/offset-notifications.md)

### October 8, 2026 - Create more contracts per customer

**Metro coverage:** `unknown` - Not yet classified - curl linked docs and update COVERAGE in this script.

Official links:

- [list customer contracts](https://docs.metronome.com/api-reference/contracts/list-customer-contracts-v2.md)
- [platform limits](https://docs.metronome.com/api-reference/rate-limits.md#platform-limits)

### September 29, 2026 - Alert on the combined remaining percentage of commits and credits

**Metro coverage:** `unknown` - Not yet classified - curl linked docs and update COVERAGE in this script.

Official links:

- [threshold notifications](https://docs.metronome.com/guides/customers-billing/set-up-notifications/threshold-notifications.md)

### September 28, 2026 - Sell commits and credits denominated in quantity

**Metro coverage:** `unknown` - Not yet classified - curl linked docs and update COVERAGE in this script.

Official links:

- [create credits and commits](https://docs.metronome.com/guides/pricing-packaging/apply-credits-and-commits/create-a-pre-paid-commit.md)

### September 24, 2026 - Filter events by event type in the dashboard

**Metro coverage:** `unknown` - Not yet classified - curl linked docs and update COVERAGE in this script.

Official links:

- [send usage events](https://docs.metronome.com/guides/events/send-usage-events.md)

### September 23, 2026 - Get notified when rate cards change

**Metro coverage:** `unknown` - Not yet classified - curl linked docs and update COVERAGE in this script.

Official links:

- [system notifications](https://docs.metronome.com/guides/customers-billing/set-up-notifications/system-notifications.md)

### September 22, 2026 - Bill for provisioned throughput

**Metro coverage:** `unknown` - Not yet classified - curl linked docs and update COVERAGE in this script.

Official links:

- [provisioned throughput](https://docs.metronome.com/guides/pricing-packaging/billing-model-guides/provisioned-throughput.md)

### September 14, 2026 - Set your account's support contact

**Metro coverage:** `unknown` - Not yet classified - curl linked docs and update COVERAGE in this script.

Official links:

- [manage your support contact](https://docs.metronome.com/guides/platform-configuration/manage-support-contact.md)

### September 3, 2026 - Billing for LLM Tokens is available in public preview.

**Metro coverage:** `unknown` - Not yet classified - curl linked docs and update COVERAGE in this script.

Official links:

- [billing for LLM tokens](https://docs.metronome.com/guides/pricing-packaging/billing-model-guides/token-billing.md)

### September 3, 2026 - Create and archive pricing units through the API

**Metro coverage:** `unknown` - Not yet classified - curl linked docs and update COVERAGE in this script.

Official links:

- [Create a pricing unit](https://docs.metronome.com/api-reference/settings/create-a-pricing-unit.md)
- [Archive a pricing unit](https://docs.metronome.com/api-reference/settings/archive-a-pricing-unit.md)

### September 2, 2026 - Mark contract invoices as unbillable

**Metro coverage:** `unknown` - Not yet classified - curl linked docs and update COVERAGE in this script.

Official links:

- [how invoicing works](https://docs.metronome.com/guides/implement-metronome/core-concepts/how-invoicing-works.md)

### August 26, 2026 - Danish krone and Chinese yuan currency support

**Metro coverage:** `unknown` - Not yet classified - curl linked docs and update COVERAGE in this script.

_No deep links in the changelog body - start from [https://docs.metronome.com/changelog](https://docs.metronome.com/changelog) and curl the matching API/guide page via [llms.txt](https://docs.metronome.com/llms.txt)._

### August 24, 2026 - Redesigned dashboard navigation with global search

**Metro coverage:** `unknown` - Not yet classified - curl linked docs and update COVERAGE in this script.

_No deep links in the changelog body - start from [https://docs.metronome.com/changelog](https://docs.metronome.com/changelog) and curl the matching API/guide page via [llms.txt](https://docs.metronome.com/llms.txt)._

### August 20, 2026 - Billing for LLM tokens is available in private preview

**Metro coverage:** `unknown` - Not yet classified - curl linked docs and update COVERAGE in this script.

Official links:

- [billing for LLM tokens](https://docs.metronome.com/guides/pricing-packaging/billing-model-guides/token-billing.md)

### August 18, 2026 - Idempotency on manual balance entries and product custom fields on contract subscriptions

**Metro coverage:** `unknown` - Not yet classified - curl linked docs and update COVERAGE in this script.

Official links:

- [add a manual balance entry](https://docs.metronome.com/api-reference/credits-and-commits/add-a-manual-balance-entry.md#body-uniqueness-key)
- [list customer contracts](https://docs.metronome.com/api-reference/contracts/list-customer-contracts-v2.md#response-data-items-subscriptions-items-product-custom-fields)

### August 14, 2026 - Redesigned Stripe integration settings page

**Metro coverage:** `unknown` - Not yet classified - curl linked docs and update COVERAGE in this script.

Official links:

- [Stripe integration guide](https://docs.metronome.com/integrations/invoice-integrations/stripe.md)

### August 10, 2026 - Interactive customer billing experience demo in the docs

**Metro coverage:** `unknown` - Not yet classified - curl linked docs and update COVERAGE in this script.

Official links:

- [docs.metronome.com/guides/customers-billing/demo-dashboard/app](https://docs.metronome.com/guides/customers-billing/demo-dashboard/app)

### August 10, 2026 - Configure duration, rollover, and rate type on prepaid balance threshold commits

**Metro coverage:** `unknown` - Not yet classified - curl linked docs and update COVERAGE in this script.

Official links:

- [prepaid balance thresholds](https://docs.metronome.com/guides/customers-billing/optimize-customer-experience/prepaid-balance-thresholds.md)

### August 10, 2026 - Faster Commits & Credits pages for customers with many commits

**Metro coverage:** `unknown` - Not yet classified - curl linked docs and update COVERAGE in this script.

_No deep links in the changelog body - start from [https://docs.metronome.com/changelog](https://docs.metronome.com/changelog) and curl the matching API/guide page via [llms.txt](https://docs.metronome.com/llms.txt)._

### August 6, 2026 - Salesforce integration reauth and skipped records download

**Metro coverage:** `unknown` - Not yet classified - curl linked docs and update COVERAGE in this script.

Official links:

- [Sync into Salesforce](https://docs.metronome.com/integrations/platform-integrations/sfdc-integration.md)

### July 31, 2026 - More accurate rated events for backdated usage and mid-period pricing changes

**Metro coverage:** `unknown` - Not yet classified - curl linked docs and update COVERAGE in this script.

_No deep links in the changelog body - start from [https://docs.metronome.com/changelog](https://docs.metronome.com/changelog) and curl the matching API/guide page via [llms.txt](https://docs.metronome.com/llms.txt)._

### July 14, 2026 - Add credit type conversions to existing rate cards

**Metro coverage:** `unknown` - Not yet classified - curl linked docs and update COVERAGE in this script.

_No deep links in the changelog body - start from [https://docs.metronome.com/changelog](https://docs.metronome.com/changelog) and curl the matching API/guide page via [llms.txt](https://docs.metronome.com/llms.txt)._

### July 10, 2026 - Metronome is live in Stripe Onboarding

**Metro coverage:** `unknown` - Not yet classified - curl linked docs and update COVERAGE in this script.

Official links:

- [self-checkout launch](https://docs.metronome.com/changelog#metronome-self-checkout)

### July 7, 2026 - Daily recurring credits and commits are supported

**Metro coverage:** `partial` - Catalog/shapes cover recurring commits generally; daily cadence (`commit_duration` / recurrence unit daily) not yet called out in QUICKSTART or shape prose. Re-curl create/edit docs before using daily.

Catalog IDs: `contracts.create`, `contracts.edit`

_No deep links in the changelog body - start from [https://docs.metronome.com/changelog](https://docs.metronome.com/changelog) and curl the matching API/guide page via [llms.txt](https://docs.metronome.com/llms.txt)._

### July 2, 2026 - Billing provider configuration scheduling

**Metro coverage:** `unknown` - Not yet classified - curl linked docs and update COVERAGE in this script.

_No deep links in the changelog body - start from [https://docs.metronome.com/changelog](https://docs.metronome.com/changelog) and curl the matching API/guide page via [llms.txt](https://docs.metronome.com/llms.txt)._

### July 2, 2026 - Q2 usability updates: design-led improvements

**Metro coverage:** `unknown` - Not yet classified - curl linked docs and update COVERAGE in this script.

_No deep links in the changelog body - start from [https://docs.metronome.com/changelog](https://docs.metronome.com/changelog) and curl the matching API/guide page via [llms.txt](https://docs.metronome.com/llms.txt)._

### June 30, 2026 - Native decimal quantities on Stripe invoices

**Metro coverage:** `unknown` - Not yet classified - curl linked docs and update COVERAGE in this script.

_No deep links in the changelog body - start from [https://docs.metronome.com/changelog](https://docs.metronome.com/changelog) and curl the matching API/guide page via [llms.txt](https://docs.metronome.com/llms.txt)._

### June 29, 2026 - RBI e-mandate support for Indian credit cards

**Metro coverage:** `unknown` - Not yet classified - curl linked docs and update COVERAGE in this script.

_No deep links in the changelog body - start from [https://docs.metronome.com/changelog](https://docs.metronome.com/changelog) and curl the matching API/guide page via [llms.txt](https://docs.metronome.com/llms.txt)._

### June 23, 2026 - Enhanced balance alert and threshold billing controls

**Metro coverage:** `unknown` - Not yet classified - curl linked docs and update COVERAGE in this script.

Official links:

- [how alert specifiers work](https://docs.metronome.com/guides/customers-billing/set-up-notifications/create-alert-specifiers.md#how-alert-specifiers-work)

### June 15, 2026 - Metronome self-checkout

**Metro coverage:** `unknown` - Not yet classified - curl linked docs and update COVERAGE in this script.

_No deep links in the changelog body - start from [https://docs.metronome.com/changelog](https://docs.metronome.com/changelog) and curl the matching API/guide page via [llms.txt](https://docs.metronome.com/llms.txt)._

### June 15, 2026 - Commit-specific overrides support all balance types

**Metro coverage:** `unknown` - Not yet classified - curl linked docs and update COVERAGE in this script.

_No deep links in the changelog body - start from [https://docs.metronome.com/changelog](https://docs.metronome.com/changelog) and curl the matching API/guide page via [llms.txt](https://docs.metronome.com/llms.txt)._

### June 10, 2026 - Stripe Projects CLI integration

**Metro coverage:** `unknown` - Not yet classified - curl linked docs and update COVERAGE in this script.

_No deep links in the changelog body - start from [https://docs.metronome.com/changelog](https://docs.metronome.com/changelog) and curl the matching API/guide page via [llms.txt](https://docs.metronome.com/llms.txt)._

### June 3, 2026 - Subscription billing cycle configuration

**Metro coverage:** `unknown` - Not yet classified - curl linked docs and update COVERAGE in this script.

_No deep links in the changelog body - start from [https://docs.metronome.com/changelog](https://docs.metronome.com/changelog) and curl the matching API/guide page via [llms.txt](https://docs.metronome.com/llms.txt)._

### May 29, 2026 - Configurable rounding for prorated subscriptions and recurring commits

**Metro coverage:** `gap` - No shape/validator/docs yet for proration rounding fields. Curl subscription + recurring commit API docs before first use.

_No deep links in the changelog body - start from [https://docs.metronome.com/changelog](https://docs.metronome.com/changelog) and curl the matching API/guide page via [llms.txt](https://docs.metronome.com/llms.txt)._

### May 29, 2026 - Richer responses from `createContract` and `editContract`

**Metro coverage:** `accounted` - Catalog sources point at create/edit docs. Metro still requires expected-vs-actual re-read after apply (richer response does not replace proof).

Catalog IDs: `contracts.create`, `contracts.edit`

Official links:

- [Create contract API docs](https://docs.metronome.com/api-reference/contracts/create-a-contract.md#response-data)
- [Edit contract API docs](https://docs.metronome.com/api-reference/contracts/edit-a-contract.md#response-data)

### May 15, 2026 - Metronome Java SDK is now available

**Metro coverage:** `n/a-sdk` - Metro is Node CLI; Java SDK not used.

Official links:

- [javadoc.io](https://javadoc.io/doc/com.metronome.api/metronome-java/latest/index.html)
- [README](https://github.com/Metronome-Industries/metronome-java)

### April 17, 2026 - Q1 usability updates: quality of life improvements

**Metro coverage:** `n/a-ui` - UI-only QoL; no API shape impact.

Official links:

- [Onboarding and setup flow improvements](https://mintcdn.com/metronome-b35a6a36/NC2X19GLS2AcinHt/images/changelog/onboarding-and-setup-flow-improvements.png?fit=max\&auto=format\&n=NC2X19GLS2AcinHt\&q=85\&s=b4c2a016592ffa752e92636afe1d2bac)
- [Contracts, commits, credits, and subscription workflow improvements](https://mintcdn.com/metronome-b35a6a36/NC2X19GLS2AcinHt/images/changelog/contracts-commits-credits-and-subscription-workflow-improvements.png?fit=max\&auto=format\&n=NC2X19GLS2AcinHt\&q=85\&s=7c49af34c397d951255cffe36176a1b2)
- [Pricing, rate cards, billable metrics, and product configuration improvements](https://mintcdn.com/metronome-b35a6a36/NC2X19GLS2AcinHt/images/changelog/pricing-rate-cards-billable-metrics-and-product-configuration-improvements.png?fit=max\&auto=format\&n=NC2X19GLS2AcinHt\&q=85\&s=1891d10a4c37a185cf406bd090502eeb)
- [Invoices, tables, filters, and reporting improvements](https://mintcdn.com/metronome-b35a6a36/NC2X19GLS2AcinHt/images/changelog/invoices-tables-filters-and-reporting-improvements.png?fit=max\&auto=format\&n=NC2X19GLS2AcinHt\&q=85\&s=0b6190ed4c3b7b8949871e7be4fee793)
- [Connections, integrations, exports, and system settings improvements](https://mintcdn.com/metronome-b35a6a36/NC2X19GLS2AcinHt/images/changelog/connections-integrations-exports-and-system-settings-improvements.png?fit=max\&auto=format\&n=NC2X19GLS2AcinHt\&q=85\&s=7cb27b2409986008f3c1769c6d70bb97)
- [Design system, DSv3 migration, dark mode, and visual consistency improvements](https://mintcdn.com/metronome-b35a6a36/NC2X19GLS2AcinHt/images/changelog/design-system-dsv3-migration-dark-mode-and-visual-consistency-improvements.png?fit=max\&auto=format\&n=NC2X19GLS2AcinHt\&q=85\&s=9856e9e9b78e073cdee0cc72665ab9f5)

### April 11, 2026 - Assign RBAC roles to API tokens

**Metro coverage:** `accounted` - Token scope matters for operator mode + keys. Documented under platform RBAC link; prefer reader tokens with `metro mode set read-only`.

Official links:

- [here](https://docs.metronome.com/guides/platform-configuration/role-based-access-rbac.md#assign-a-role-to-an-api-token)

### April 11, 2026 - Package contract transitions and credit rollover improvements

**Metro coverage:** `accounted` - Package transitions and `rollover_fraction` used in preview/contract-move shapes and skills.

Catalog IDs: `packages.create`, `contracts.create`, `contracts.edit`

Official links:

- [provisioning customers with a package](https://docs.metronome.com/guides/get-started/core-concepts/packages-overview.md#provision-customers-with-a-package)
- [contract lifecycle transitions](https://docs.metronome.com/guides/customers-billing/manage-customers/manage-customer-lifecycle.md)
- [credits and rollovers](https://docs.metronome.com/guides/pricing-packaging/apply-credits-and-commits/create-a-pre-paid-commit.md)

### April 11, 2026 - NetSuite integration (Public Beta)

**Metro coverage:** `n/a` - Invoices via Stripe, not NetSuite.

Official links:

- [here](https://docs.metronome.com/integrations/invoice-integrations/netsuite.md)

### March 9, 2026 - Dark mode

**Metro coverage:** `n/a-ui` - UI only.

Official links:

- [Darkmode](https://mintcdn.com/metronome-b35a6a36/NC2X19GLS2AcinHt/images/darkmode.png?fit=max\&auto=format\&n=NC2X19GLS2AcinHt\&q=85\&s=b5b55a549b25585c209daca748e74f46)

### March 2, 2026 - SDK releases

**Metro coverage:** `n/a-sdk` - Track only when release notes imply API schema breakers (e.g. removed `priority`). Metro catalog is hand-curated.

Official links:

- [Go v3.2.0](https://github.com/Metronome-Industries/metronome-go/compare/v3.1.0...v3.2.0)
- [Python v4.2.0](https://github.com/Metronome-Industries/metronome-python/compare/v4.1.0...v4.2.0)
- [Ruby v3.2.0](https://github.com/Metronome-Industries/metronome-ruby/compare/v3.1.0...v3.2.0)
- [Node v3.2.0](https://github.com/Metronome-Industries/metronome-node/compare/v3.1.0...v3.2.0)

### February 27, 2026 - Compound group keys in usage breakdowns

**Metro coverage:** `partial` - `usage.groups` is in api-catalog; compound group key constraint and page-size 100 not yet in validator prose/QUICKSTART.

Catalog IDs: `usage.groups`

Official links:

- [Get usage data with paginated groupings](https://docs.metronome.com/api-reference/usage/get-usage-data-with-paginated-groupings.md)
- [here](https://docs.metronome.com/api-reference/usage/get-usage-data-with-paginated-groupings.md)

### February 23, 2026 - Archive packages

**Metro coverage:** `accounted` - `packages.archive` in api-catalog + validators.

Catalog IDs: `packages.archive`

Official links:

- [API](https://docs.metronome.com/api-reference/packages/archive-a-package.md)

### February 19, 2026 - New Metronome UI

**Metro coverage:** `n/a-ui` - UI only.

_No deep links in the changelog body - start from [https://docs.metronome.com/changelog](https://docs.metronome.com/changelog) and curl the matching API/guide page via [llms.txt](https://docs.metronome.com/llms.txt)._

### February 17, 2026 - Change end date on advance, prorated subscriptions

**Metro coverage:** `partial` - Subscription end-date edits exist via contract/subscription edit paths; advance-prorated edge case not a dedicated gotcha yet.

Catalog IDs: `contracts.edit`

_No deep links in the changelog body - start from [https://docs.metronome.com/changelog](https://docs.metronome.com/changelog) and curl the matching API/guide page via [llms.txt](https://docs.metronome.com/llms.txt)._

### February 12, 2026 - Stripe invoice PDFs available in UI and API

**Metro coverage:** `partial` - Matrix notes invoice PDF GET path in conventions; not a first-class `metro` shortcut. Prefer Stripe dashboard or guarded invoice get when needed.

Catalog IDs: `invoices.get`

Official links:

- [Downloadpdf](https://mintcdn.com/metronome-b35a6a36/NC2X19GLS2AcinHt/images/downloadpdf.png?fit=max\&auto=format\&n=NC2X19GLS2AcinHt\&q=85\&s=04526b77fc2533179a7ed92f8acf16b9)

### February 10, 2026 - Subscription and invoice line item linking improvements

**Metro coverage:** `partial` - `subscription_id` on line items / Stripe metadata — useful for reconcile; not yet a metro proof field.

Catalog IDs: `invoices.get`, `invoices.listForCustomer`

_No deep links in the changelog body - start from [https://docs.metronome.com/changelog](https://docs.metronome.com/changelog) and curl the matching API/guide page via [llms.txt](https://docs.metronome.com/llms.txt)._

### February 9, 2026 - Create contracts from packages in the UI

**Metro coverage:** `n/a-ui` - API path already covered (`packages` + `contracts.create`). UI convenience only.

Catalog IDs: `contracts.create`

_No deep links in the changelog body - start from [https://docs.metronome.com/changelog](https://docs.metronome.com/changelog) and curl the matching API/guide page via [llms.txt](https://docs.metronome.com/llms.txt)._

### February 6, 2026 - In-app embedded dashboards

**Metro coverage:** `n/a-ui` - UI reporting; use metro + exports.

_No deep links in the changelog body - start from [https://docs.metronome.com/changelog](https://docs.metronome.com/changelog) and curl the matching API/guide page via [llms.txt](https://docs.metronome.com/llms.txt)._

### February 5, 2026 - SDK releases

**Metro coverage:** `n/a-sdk` - Track only when release notes imply API schema breakers (e.g. removed `priority`). Metro catalog is hand-curated.

Official links:

- [Go v3.1.0](https://github.com/Metronome-Industries/metronome-node/compare/v3.0.0...v3.1.0)
- [Python v4.1.0](https://github.com/Metronome-Industries/metronome-python/compare/v4.0.0...v4.1.0)
- [Ruby v3.1.0](https://github.com/Metronome-Industries/metronome-ruby/compare/v3.0.0...v3.1.0)
- [Node v3.1.0](https://github.com/Metronome-Industries/metronome-node/compare/v3.0.0...v3.1.0)

### February 5, 2026 - Get net balance API

**Metro coverage:** `gap` - Verified in endpoint-matrix (`POST /v1/contracts/customerBalances/getNetBalance`) but **not** yet a reviewed api-catalog ID / `metro api read` shape. Prefer over paginating balances when consolidating.

Official links:

- [Get net balance](https://docs.metronome.com/api-reference/credits-and-commits/get-the-net-balance-of-a-customer.md)
- [here](https://docs.metronome.com/api-reference/credits-and-commits/get-the-net-balance-of-a-customer.md)

### January 29, 2026 - Edit net payment terms on contracts

**Metro coverage:** `accounted` - Preview supports `net_payment_terms_days`; edit history still required for audit.

Catalog IDs: `contracts.edit`

Official links:

- [Net payment terms](https://mintcdn.com/metronome-b35a6a36/NC2X19GLS2AcinHt/images/changelog/netpaymentterms.png?fit=max\&auto=format\&n=NC2X19GLS2AcinHt\&q=85\&s=2a90b6571eb8eba0f6b0bb1bf437f71c)

### January 16, 2026 - Major version SDK release

**Metro coverage:** `partial` - Breaking: removed `use_list_prices` from Rate objects — ensure rate-card payloads/validators do not emit it.

Catalog IDs: `rateCards.addRates`, `rateCards.getRates`

Official links:

- [Node v3.0.0](https://github.com/Metronome-Industries/metronome-node/releases)
- [Go v3.0.0](https://github.com/Metronome-Industries/metronome-go/releases)
- [Python v4.0.0](https://github.com/Metronome-Industries/metronome-python/releases)
- [Ruby v3.0.0](https://github.com/Metronome-Industries/metronome-ruby/releases)

### January 12, 2026 - Self-serve access to Metronome

**Metro coverage:** `n/a-ui` - Onboarding UI.

Official links:

- [Metronome website](https://metronome.com)

### January 12, 2026 - Billing configuration API endpoints now return response bodies

**Metro coverage:** `accounted` - Billing-provider set/archive in catalog; responses expected in sandbox-proof paths.

Catalog IDs: `customers.setBillingProviderConfigurations`, `customers.archiveBillingProviderConfigurations`

Official links:

- [set billing provider configuration](https://docs.metronome.com/api-reference/customers/set-billing-provider-configurations-for-a-customer.md)
- [archive billing provider configuration](https://docs.metronome.com/api-reference/customers/archive-billing-provider-configurations-for-a-customer.md)

### December 22, 2025 - High cardinality group key spend alerts

**Metro coverage:** `n/a` - Alerts not in metro core day-to-day.

_No deep links in the changelog body - start from [https://docs.metronome.com/changelog](https://docs.metronome.com/changelog) and curl the matching API/guide page via [llms.txt](https://docs.metronome.com/llms.txt)._

### December 19, 2025 - SDK releases

**Metro coverage:** `n/a-sdk` - Track only when release notes imply API schema breakers (e.g. removed `priority`). Metro catalog is hand-curated.

Official links:

- [Node v2.2.0](https://github.com/Metronome-Industries/metronome-node/releases)
- [Go v2.2.0](https://github.com/Metronome-Industries/metronome-go/releases)
- [Python v3.2.0](https://github.com/Metronome-Industries/metronome-python/releases)
- [Ruby v2.2.0](https://github.com/Metronome-Industries/metronome-ruby/releases)

### November 14, 2025 - Launch week recap: Monetization Infrastructure for AI

**Metro coverage:** `n/a-ui` - Marketing recap; follow linked product guides when relevant.

Official links:

- [Launch Week Recap: Monetization Infrastructure for AI](https://mintcdn.com/metronome-b35a6a36/NC2X19GLS2AcinHt/images/changelog/recap.jpg?fit=max\&auto=format\&n=NC2X19GLS2AcinHt\&q=85\&s=2f39ef7067f9938e3e702b8433acb1cd)
- [here](https://docs.metronome.com/guides/pricing-packaging/billing-model-guides/hybrid-business-models.md#use-case)
- [here](https://docs.metronome.com/guides/pricing-packaging/subscription/subscription-overview.md)
- [here](https://docs.metronome.com/guides/get-started/core-concepts/packages-overview.md)
- [here](https://metronome.com/blog/monetize-ai-with-full-pricing-flexibility)
- [here](https://docs.metronome.com/integrations/marketplace-integrations/gcp.md)
- [here](https://metronome.com/blog/unify-invoicing-across-every-revenue-motion)
- [here](https://docs.metronome.com/guides/customers-billing/optimize-customer-experience/preview-event-cost.md)
- [here](https://docs.metronome.com/guides/customers-billing/set-up-notifications/create-and-manage-notifications.md#manage-your-customer-lifecycle-with-metronome-notifications)
- [here](https://metronome.com/blog/make-billing-part-of-the-product-experience)
- [metronome.com/launch-week](http://metronome.com/launch-week)

### November 3, 2025 - Invoicing with Google Cloud Marketplace

**Metro coverage:** `n/a` - Uses Stripe billing.

Official links:

- [here](https://docs.metronome.com/integrations/marketplace-integrations/gcp.md#invoice-with-gcp)

### October 31, 2025 - New SDK releases

**Metro coverage:** `n/a-sdk` - Track only when release notes imply API schema breakers (e.g. removed `priority`). Metro catalog is hand-curated.

Official links:

- [v2.1.0](https://github.com/Metronome-Industries/metronome-node/releases)
- [v2.1.0](https://github.com/Metronome-Industries/metronome-go/releases)
- [v3.1.0](https://github.com/Metronome-Industries/metronome-python/releases)
- [v2.1.0](https://github.com/Metronome-Industries/metronome-ruby/releases)

### October 14, 2025 - September fixes and improvements

**Metro coverage:** `partial` - Spot-check API subsection against edit/billing-provider sources when touching those shapes.

Catalog IDs: `contracts.edit`

Official links:

- [Audit Log](https://mintcdn.com/metronome-b35a6a36/NC2X19GLS2AcinHt/images/changelog/audit-log.png?fit=max\&auto=format\&n=NC2X19GLS2AcinHt\&q=85\&s=3066c8fd61e55bc258453f79b61d8b5e)
- [Rate Card Table Disabled Entitlements](https://mintcdn.com/metronome-b35a6a36/NC2X19GLS2AcinHt/images/changelog/rate-card-table-disabled-entitlements.png?fit=max\&auto=format\&n=NC2X19GLS2AcinHt\&q=85\&s=244c1e839e30c4d76a6126a40ccc6959)
- [Billable Metric on Hover](https://mintcdn.com/metronome-b35a6a36/NC2X19GLS2AcinHt/images/changelog/bm-on-hover.png?fit=max\&auto=format\&n=NC2X19GLS2AcinHt\&q=85\&s=7d4a75c1118ed9bca623d1f914d06ae4)
- [`spend_threshold_reached`](https://docs.metronome.com/guides/customers-billing/optimize-customer-experience/customer-controls#enable-custom-spend-limits-for-a-specific-dimension%E2%80%8B)
- [Add a billing configuration](https://docs.metronome.com/api-reference/contracts/edit-a-contract.md#body-add-billing-provider-configuration-update)
- [Archive a billing provider](https://docs.metronome.com/api-reference/customers/archive-billing-provider-configurations-for-a-customer.md)
- [Edit the rate type of a recurring commit](https://docs.metronome.com/api-reference/credits-and-commits/edit-a-commit.md#body-rate-type)
- [Node](https://github.com/Metronome-Industries/metronome-node/releases/tag/v1.0.0)
- [Go](https://github.com/Metronome-Industries/metronome-go/releases/tag/v1.0.0)
- [Python](https://github.com/Metronome-Industries/metronome-python/releases/tag/v1.0.0)
- [Ruby](https://github.com/Metronome-Industries/metronome-ruby/releases/tag/v1.0.0)

### September 24, 2025 - Make advanced contract overrides in the Metronome app

**Metro coverage:** `n/a-ui` - UI for overrides; API overrides remain via `contracts.edit`.

Catalog IDs: `contracts.edit`

Official links:

- [Advanced Contract Overrides](https://mintcdn.com/metronome-b35a6a36/NC2X19GLS2AcinHt/images/changelog/advanced-contract-overrides.gif?s=df389710871700978b4d10b9b0df96e5)
- [here](https://docs.metronome.com/guides/pricing-packaging/make-pricing-changes/edit-or-override-a-contract.md#contract-edits-and-overrides)

### September 24, 2025 - Custom Reports

**Metro coverage:** `n/a-ui` - In-app reports.

Official links:

- [here](https://docs.metronome.com/guides/reporting-insights/in-app-reporting.md#custom-reports)

### September 18, 2025 - Customer Lifecycle Notifications

**Metro coverage:** `n/a` - Notifications not operated via metro today.

Official links:

- [here](https://docs.metronome.com/guides/customers-billing/set-up-notifications/create-and-manage-notifications.md)

### September 11, 2025 - New documentation experience

**Metro coverage:** `accounted` - Sources use docs.metronome.com `.md` URLs + llms.txt. This tracker is the metro-side sync surface.

_No deep links in the changelog body - start from [https://docs.metronome.com/changelog](https://docs.metronome.com/changelog) and curl the matching API/guide page via [llms.txt](https://docs.metronome.com/llms.txt)._

### September 10, 2025 - August fixes and improvements

**Metro coverage:** `partial` - Historical API fixes (billing config updates via edit, etc.) — reflected in danger-zone / stripe-delivery skills.

Catalog IDs: `contracts.edit`

Official links:

- [data exports](https://docs.metronome.com/developer-resources/data-export)
- [Contract Data](https://mintcdn.com/metronome-b35a6a36/NC2X19GLS2AcinHt/images/changelog/contract-data.png?fit=max\&auto=format\&n=NC2X19GLS2AcinHt\&q=85\&s=24b43278a5419378ddcc69fbe09cf9fe)
- [Create Contract](https://mintcdn.com/metronome-b35a6a36/NC2X19GLS2AcinHt/images/changelog/create-contract.png?fit=max\&auto=format\&n=NC2X19GLS2AcinHt\&q=85\&s=a00d1cc938140d8bc6d8c1ca1cc1d9c3)
- [Quick Actions Customer Page](https://mintcdn.com/metronome-b35a6a36/NC2X19GLS2AcinHt/images/changelog/quick-actions-customer-page.png?fit=max\&auto=format\&n=NC2X19GLS2AcinHt\&q=85\&s=018161c2aad966fb9c002f410d383f20)
- [Billable Metric Descriptions](https://mintcdn.com/metronome-b35a6a36/NC2X19GLS2AcinHt/images/changelog/bm-description.png?fit=max\&auto=format\&n=NC2X19GLS2AcinHt\&q=85\&s=6a6688b05b11f0be035a247857bac33f)
- [edit a commit](https://docs.metronome.com/api/#operation/editCommit-v2)
- [products](https://docs.metronome.com/api/#operation/createProduct-v1)
- [create contract](https://docs.metronome.com/api/#operation/createContract-v1)
- [get an invoice](https://docs.metronome.com/api/#operation/getInvoice-v1)
- [list invoice breakdowns](https://docs.metronome.com/api/#operation/listBreakdownInvoices-v1)
- [list invoices](https://docs.metronome.com/api/#operation/listInvoices-v1)
- [Node](https://github.com/Metronome-Industries/metronome-node/releases/tag/v0.1.0)
- [Go](https://github.com/Metronome-Industries/metronome-go/releases)
- [Python](https://github.com/Metronome-Industries/metronome-python/releases)
- [Ruby](https://github.com/Metronome-Industries/metronome-ruby/releases)
- [edit contract](https://docs.metronome.com/api/#operation/editContract-v2)

### August 15, 2025 - Invoice breakdowns in Data Export

**Metro coverage:** `partial` - `invoices.listBreakdowns` in catalog; data-export tables are separate.

Catalog IDs: `invoices.listBreakdowns`

Official links:

- [here](https://docs.metronome.com/guides/reporting-insights/data-export.md#invoice-breakdowns-tables)

### August 5, 2025 - July fixes and improvements

**Metro coverage:** `partial` - API notes (searchEvents, commits) — events.search / commits paths in catalog.

Catalog IDs: `events.search`, `commits.list`

Official links:

- [prepaid](https://docs.metronome.com/pricing-packaging/apply-credits-commits.md#prepaid-commits)
- [postpaid](https://docs.metronome.com/pricing-packaging/apply-credits-commits.md#postpaid-commits)
- [Prepaid Postpaid Commit](https://mintcdn.com/metronome-b35a6a36/NC2X19GLS2AcinHt/images/changelog/prepaid-postpaid-commit.png?fit=max\&auto=format\&n=NC2X19GLS2AcinHt\&q=85\&s=b9fb084777b29094c4412c03cea1c8e5)
- [Filter Preferences Contracts Plans Table](https://mintcdn.com/metronome-b35a6a36/NC2X19GLS2AcinHt/images/changelog/filter-preferences-contracts-plans-table.png?fit=max\&auto=format\&n=NC2X19GLS2AcinHt\&q=85\&s=94747310733be21b2a9fc1c055640af1)
- [Billable Metric History](https://mintcdn.com/metronome-b35a6a36/NC2X19GLS2AcinHt/images/changelog/bm-history.png?fit=max\&auto=format\&n=NC2X19GLS2AcinHt\&q=85\&s=a26e5415c8646634e3681c9a82712673)
- [Billable Metric Product Creation](https://mintcdn.com/metronome-b35a6a36/NC2X19GLS2AcinHt/images/changelog/bm-product-creation.png?fit=max\&auto=format\&n=NC2X19GLS2AcinHt\&q=85\&s=5b9b8af12b133eb1a517d7fce2579ed1)
- [Commit Metadata](https://mintcdn.com/metronome-b35a6a36/NC2X19GLS2AcinHt/images/changelog/commit-metadata.png?fit=max\&auto=format\&n=NC2X19GLS2AcinHt\&q=85\&s=890b6725cc79e4a60bc3c5a67766dd4a)
- [Search events](https://docs.metronome.com/api/#operation/searchEvents-v1)
- [`/v1/contracts/customerCommits/create`](https://docs.metronome.com/api/#operation/createCustomerCommit-v1)
- [`/v2/contracts/edit`](https://docs.metronome.com/api/#operation/editContract-v2)
- [`/v1/contracts/create`](https://docs.metronome.com/api/#operation/createContract-v1)
- [`v2/contracts/edit`](https://docs.metronome.com/api/#operation/editContract-v2)
- [`v2/contracts/get`](https://docs.metronome.com/api/#operation/getContract-v2)
- [`v1/contracts/customerCommits/list`](https://docs.metronome.com/api/#operation/listCustomerCommits-v1)
- [`v2/contracts/list`](https://docs.metronome.com/api/#operation/listContracts-v2)
- [Node](https://github.com/Metronome-Industries/metronome-node/releases/tag/v0.1.0)
- [Go](https://github.com/Metronome-Industries/metronome-go/releases)
- [Python](https://github.com/Metronome-Industries/metronome-python/releases)
- [Ruby](https://github.com/Metronome-Industries/metronome-ruby/releases)
- [Send Metronome events to Slack](https://docs.metronome.com/guides/platform-configuration/webhooks/best-practices.md#send-webhooks-to-slack)

### August 4, 2025 - Use group keys to set budgets across users, teams, and projects

**Metro coverage:** `n/a` - Spend controls/alerts — not metro day-to-day.

Official links:

- [group key values](https://docs.metronome.com/connect-metronome/create-billable-metrics/#group-keys)
- [here](https://docs.metronome.com/launch-guides/hybrid-business.md)
- [here](https://docs.metronome.com/enhance-customer-experience/customer-controls.md#enable-custom-spend-limits-for-a-specific-dimension)

### August 4, 2025 - Seat-based credit pools

**Metro coverage:** `partial` - Seat / credit pool shapes in skills; not a QUICKSTART one-liner.

Catalog IDs: `contracts.edit`

Official links:

- [Seat-based Credit Pools Demo](https://mintcdn.com/metronome-b35a6a36/NC2X19GLS2AcinHt/images/changelog/seats-credit-demo.gif?s=1b3e1a3dbf252ada82c99a365b914ae8)
- [here](https://docs.metronome.com/enhance-customer-experience/customer-controls.md#enable-custom-spend-limits-for-a-specific-dimension)
- [See docs here.](https://docs.metronome.com/launch-guides/hybrid-business.md)

### August 1, 2025 - Embeddable dashboard for credit and commit balances

**Metro coverage:** `n/a-ui` - Embeddable UI; metro uses balances list / (future) getNetBalance.

Catalog IDs: `customerBalances.list`

Official links:

- [Embeddable Dashboard Credits Commits](https://mintcdn.com/metronome-b35a6a36/NC2X19GLS2AcinHt/images/changelog/embeddable-dashboard-credits-commits.png?fit=max\&auto=format\&n=NC2X19GLS2AcinHt\&q=85\&s=beb74d24490619f444031264447805af)
- [here](https://docs.metronome.com/enhance-customer-experience/customer-dashboards.md#commits-and-credits-dashboard)

### July 23, 2025 - Threshold billing and auto-recharge

**Metro coverage:** `partial` - Spend/prepaid thresholds via contract edit — danger-zone aware; not a dedicated metro shortcut.

Catalog IDs: `contracts.edit`

Official links:

- [here](https://docs.metronome.com/pricing-packaging/apply-credits-commits/manual-payment-gated-commits.md)
- [here](https://docs.metronome.com/manage-product-access/spend-thresholds.md#create-a-contract-with-spend-thresholds)
- [here](https://docs.metronome.com/manage-product-access/prepaid-balance-thresholds.md)
- [here](https://docs.metronome.com/launch-guides/prepaid-credits.md)
- [here](https://metronome.com/blog/choosing-the-right-plg-billing-models-for-your-business)

### July 15, 2025 - Set up multi-entity billing

**Metro coverage:** `partial` - Account hierarchy / billing config — skills note hierarchy; careful with Stripe entity.

Catalog IDs: `customers.setBillingProviderConfigurations`

Official links:

- [here](https://docs.metronome.com/invoice-customers/solutions/invoice-with-stripe.md#set-the-customer-billing-configuration)

### June 26, 2025 - Scope credits and commits to specific pricing or presentation group values

**Metro coverage:** `partial` - Specifier / dimensional scoping; keep sources current.

Catalog IDs: `contracts.edit`, `rateCards.addRates`

Official links:

- [Scope Credits Commits](https://mintcdn.com/metronome-b35a6a36/NC2X19GLS2AcinHt/images/changelog/scope-credits-commits.gif?s=a4d141162cb56c45d554950f249d20c3)
- [here](https://docs.metronome.com/pricing-packaging/apply-credits-commits/target-credits-commits.md)

### June 13, 2025 - Edit recurring commits and credits

**Metro coverage:** `accounted` - Recurring edit via contracts.edit / commit edit docs in skills.

Catalog IDs: `contracts.edit`

Official links:

- [Edit recurring commits and credits](https://mintcdn.com/metronome-b35a6a36/NC2X19GLS2AcinHt/images/changelog/edit-recurring-commits-credits.png?fit=max\&auto=format\&n=NC2X19GLS2AcinHt\&q=85\&s=ad4ca6446a0557fe076c003db1164332)
- [here](https://docs.metronome.com/api/#operation/editContract-v2)

### June 13, 2025 - Support for seat-based subscription billing

**Metro coverage:** `partial` - Seat subscriptions in skills; most packages are credit+plan fee shaped.

Catalog IDs: `contracts.create`, `contracts.edit`

Official links:

- [Seat-based Subscription Billing Models](https://mintcdn.com/metronome-b35a6a36/NC2X19GLS2AcinHt/images/changelog/seat-based-subscription-billing-models.gif?s=75cdc35f3b1b8970565e1463af3874b6)
- [here](https://docs.metronome.com/manage-product-access/create-subscription/#update-pricing)
- [here](https://docs.metronome.com/manage-product-access/create-subscription/)

### May 20, 2025 - April fixes and improvements

**Metro coverage:** `partial` - Historical; verify touched endpoints against current `.md` sources.

Official links:

- [Create Dropdown](https://mintcdn.com/metronome-b35a6a36/NC2X19GLS2AcinHt/images/changelog/create-dropdown.png?fit=max\&auto=format\&n=NC2X19GLS2AcinHt\&q=85\&s=19880a6d254dd97d59e6e7f09f84e621)
- [`getCustomer`](https://docs.metronome.com/api/#operation/getCustomer-v1)
- [`listCustomers`](https://docs.metronome.com/api/#operation/listCustomers-v1)
- [`getInvoice`](https://docs.metronome.com/api/#operation/getInvoice-v1)
- [`listInvoices`](https://docs.metronome.com/api/#operation/listInvoices-v1)
- [`listBreakdownInvoices`](https://docs.metronome.com/api/#operation/listBreakdownInvoices-v1)
- [here](https://docs.metronome.com/api/#operation/archiveRateCard-v1)

### May 8, 2025 - Remove overrides and archive commits and scheduled charges

**Metro coverage:** `accounted` - editContract archive/remove paths documented in danger-zone.

Catalog IDs: `contracts.edit`

Official links:

- [Archive Commit](https://mintcdn.com/metronome-b35a6a36/NC2X19GLS2AcinHt/images/changelog/archive-commit.png?fit=max\&auto=format\&n=NC2X19GLS2AcinHt\&q=85\&s=4c339b6da1ff288d5f41b54c9d59e45e)
- [here](https://docs.metronome.com/api/#operation/editContract-v2)

### May 5, 2025 - Support for NZD and SGD currencies

**Metro coverage:** `n/a` - Standard currency amounts.

Official links:

- [NZD and SGD Dollars](https://mintcdn.com/metronome-b35a6a36/NC2X19GLS2AcinHt/images/changelog/nz-sgd-dollars.png?fit=max\&auto=format\&n=NC2X19GLS2AcinHt\&q=85\&s=1bab506e2474138e36c505761036ef67)
- [here](https://docs.metronome.com/pricing-packaging/use-currency-custompricingunits.md)

### May 1, 2025 - Ruby SDK

**Metro coverage:** `n/a-sdk` - SDK only.

Official links:

- [here](https://github.com/Metronome-Industries/metronome-ruby)
- [here](https://docs.metronome.com/developer-resources/sdks.md)

### April 29, 2025 - Updated UI for creating and editing contracts, customer-level commits, and customer-level credits

**Metro coverage:** `n/a-ui` - UI only.

Official links:

- [Add a Commit](https://mintcdn.com/metronome-b35a6a36/NC2X19GLS2AcinHt/images/changelog/add-a-commit.gif?s=38625763b01e504ea01cd13dffc6722c)
- [available through the API](https://docs.metronome.com/api/#operation/editContract-v2)

### April 9, 2025 - Edit rates in the Rate Card UI

**Metro coverage:** `n/a-ui` - API: addRates/getRates in catalog.

Catalog IDs: `rateCards.addRates`

_No deep links in the changelog body - start from [https://docs.metronome.com/changelog](https://docs.metronome.com/changelog) and curl the matching API/guide page via [llms.txt](https://docs.metronome.com/llms.txt)._

### April 2, 2025 - Usage threshold alerts supported on Contracts

**Metro coverage:** `n/a` - Alerts out of metro day-to-day.

Official links:

- [here](https://docs.metronome.com/manage-product-access/create-manage-alerts.md#usage-alerts)

### April 2, 2025 - Contract editing

**Metro coverage:** `accounted` - `contracts.edit` + danger-zone editContract support matrix.

Catalog IDs: `contracts.edit`

Official links:

- [Read more in our docs.](https://docs.metronome.com/manage-product-access/edit-contract.md)

### April 1, 2025 - Support for weekly frequencies for billing, recurring commits, and credits

**Metro coverage:** `partial` - Cadence fields exist; weekly not a common shape.

Catalog IDs: `contracts.create`, `contracts.edit`

Official links:

- [docs](https://docs.metronome.com/api/#operation/createContract-v1)

### March 26, 2025 - In Tempo: Spring 2025 changelog

**Metro coverage:** `partial` - Large release note — recurring commits, uniqueness keys, invoice breakdowns, updateEndDate guard already reflected across matrix/catalog/skills.

Catalog IDs: `contracts.create`, `contracts.edit`, `contracts.updateEndDate`, `invoices.listBreakdowns`, `customerBalances.list`

Official links:

- [In Tempo: Spring 2025 changelog](https://mintcdn.com/metronome-b35a6a36/NC2X19GLS2AcinHt/images/changelog/in-tempo.png?fit=max\&auto=format\&n=NC2X19GLS2AcinHt\&q=85\&s=b07c0a7cddeae56e3ff518988d24bf80)
- [here](https://docs.metronome.com/manage-product-access/create-manage-alerts.md#webhook-notifications)
- [here](https://docs.metronome.com/manage-product-access/create-manage-alerts.md#create-an-alert)
- [here](https://docs.metronome.com/api/#operation/listBreakdownInvoices)
- [here](https://docs.metronome.com/enhance-customer-experience/customer-dashboards.md#display-up-to-date-spend)
- [here](https://docs.metronome.com/api/#operation/listCustomerBalances)
- [here](https://docs.metronome.com/api/#operation/createCustomerCommit)
- [here](https://docs.metronome.com/api/#operation/listRateCards)
- [here](https://docs.metronome.com/api/#operation/updateContractEndDate)
- [request body](https://docs.metronome.com/api/#operation/updateContractEndDate)
- [API](https://docs.metronome.com/api/#operation/createContract)
- [here](https://docs.metronome.com/pricing-packaging/apply-credits-commits.md#provision-recurring-usage-credits)
- [here](https://docs.metronome.com/pricing-packaging/apply-credits-commits/discounts.md)
- [here](https://metronome.com/blog/say-goodbye-to-overages-hello-to-commit-rates)
- [here](https://docs.metronome.com/launch-guides/quickstart.md#create-composite-products)
- [Total Lifetime Billing Customer](https://mintcdn.com/metronome-b35a6a36/NC2X19GLS2AcinHt/images/changelog/total-lifetime-billing-customer.png?fit=max\&auto=format\&n=NC2X19GLS2AcinHt\&q=85\&s=83203517224e728cf4c058af93b914b0)
- [Badges Commits](https://mintcdn.com/metronome-b35a6a36/NC2X19GLS2AcinHt/images/changelog/badges-commits.png?fit=max\&auto=format\&n=NC2X19GLS2AcinHt\&q=85\&s=6b8453ee8f24cfdc218253286516f4bc)
- [Metronome Trust Center](https://trust.metronome.com/)
- [here](https://docs.metronome.com/invoice-customers/solutions/invoice-with-stripe.md#configure-optional-global-integration-settings-available)
- [here](https://docs.metronome.com/developer-resources/data-export/#contracts_commits)
- [we launched Metronome 2.0](https://metronome.com/blog/introducing-metronome-2-0)
- [here](https://docs.metronome.com/invoice-customers/solutions/marketplaces.md)
- [here](https://docs.metronome.com/pricing-packaging/use-currency-custompricingunits.md#supported-currencies)
- [here](https://docs.metronome.com/api/#operation/embeddableDashboard)
- [here](https://metronome.com/talk-to-an-expert?utm_medium=web\&utm_source=blog\&utm_campaign=intempo_spring_2024)

### October 17, 2024 - Metronome 2.0

**Metro coverage:** `accounted` - Metro is built on Metronome 2.0 contracts/rate-cards/packages model.

Official links:

- [managing rate cards](https://docs.metronome.com/pricing-packaging/create-manage-rate-cards/)
- [customizing pricing](https://docs.metronome.com/manage-product-access/provision-customer.md#add-contract-discounts-and-overrides)
- [enterprise commit launch guide](https://docs.metronome.com/launch-guides/enterprise-commit.md)
- [dimensional pricing](https://docs.metronome.com/pricing-packaging/create-manage-rate-cards/#dimensional-pricing)
- [billable metrics](https://docs.metronome.com/connect-metronome/create-billable-metrics/)
- [customer and contract provisioning](https://docs.metronome.com/manage-product-access/provision-customer.md)
- [building customer dashboards](https://docs.metronome.com/enhance-customer-experience/customer-dashboards.md)
- [API documentation](https://docs.metronome.com/api)
- [customer spend controls](https://docs.metronome.com/enhance-customer-experience/customer-controls.md)
- [creating and managing alerts](https://docs.metronome.com/manage-product-access/create-manage-alerts.md)
- [syncing billing data into Salesforce](https://docs.metronome.com/reports-insights/sync-into-salesforce.md)

### September 25, 2024 - In Tempo: Fall 2024

**Metro coverage:** `partial` - voidInvoice etc. in catalog; plan-era APIs are historical.

Catalog IDs: `invoices.void`

Official links:

- [here](https://docs.metronome.com/api/#operation/voidInvoice)
- [Go](https://pkg.go.dev/github.com/Metronome-Industries/metronome-go#section-readme)
- [Python](https://pypi.org/project/metronome-sdk/)
- [TypeScript](https://www.npmjs.com/package/@metronome/sdk)
- [here](https://docs.metronome.com/connecting-metronome/alerts.md#usage-threshold-reached)
- [here](https://docs.metronome.com/connecting-metronome/alerts.md#invoice-total-reached)
- [here](https://docs.metronome.com/invoicing/how-billing-works/set-up-seat-based-billing.md#how-seat-based-billing-works)
- [here](https://docs.metronome.com/pricing-and-packaging/create-plans.md#fixed-fee-and-tiered-usage)
- [Cross-invoice Tiering Step 1](https://mintcdn.com/metronome-b35a6a36/NC2X19GLS2AcinHt/images/changelog/cross-invoice-tiering-1.png?fit=max\&auto=format\&n=NC2X19GLS2AcinHt\&q=85\&s=e61362c23f4ea6ced6451ca738943d92)
- [Cross-invoice Tiering Step 2](https://mintcdn.com/metronome-b35a6a36/NC2X19GLS2AcinHt/images/changelog/cross-invoice-tiering-2.png?fit=max\&auto=format\&n=NC2X19GLS2AcinHt\&q=85\&s=1d3d0aced052d3a204323e7e2e07125f)
- [here](https://docs.metronome.com/api/#operation/createGrant)
- [Alert Status UI](https://mintcdn.com/metronome-b35a6a36/NC2X19GLS2AcinHt/images/changelog/alert-status-ui.png?fit=max\&auto=format\&n=NC2X19GLS2AcinHt\&q=85\&s=a8803c61c0791bcbfd6e93148d31cd8a)
- [here](https://docs.metronome.com/developer-resources/export-metronome-data.md#customer_plan)
- [here](https://metronome.com/talk-to-an-expert?utm_medium=web\&utm_source=blog\&utm_campaign=intempo_fall_2024)

### June 10, 2024 - In Tempo: Spring 2024

**Metro coverage:** `n/a-ui` - Mostly pre-2.0/plan-era; do not copy paths into new workflows without matrix check.

Official links:

- [here](https://docs.metronome.com/api/#billable-metrics)
- [here](https://docs.metronome.com/api/#operation/createAlert)
- [Alert Policy](https://mintcdn.com/metronome-b35a6a36/NC2X19GLS2AcinHt/images/changelog/alert-policy.png?fit=max\&auto=format\&n=NC2X19GLS2AcinHt\&q=85\&s=483aec38508717a8dd8d7873c6fad650)
- [here](https://docs.metronome.com/connecting-metronome/alerts.md#forcing-alert-re-evaluation)
- [here](https://docs.metronome.com/api/#operation/resetCustomerAlerts)
- [here](https://docs.metronome.com/api/#operation/addPlanToCustomer)
- [here](https://docs.metronome.com/api/#operation/createGrant)
- [AWS Marketplace integration](https://docs.metronome.com/invoicing/how-invoicing-works/invoicing-with-aws-marketplace.md)
- [here](https://docs.metronome.com/api/#operation/getAuditLogs)
- [here](https://docs.metronome.com/integrations/workato-connector.md)
- [Data Export UI](https://mintcdn.com/metronome-b35a6a36/NC2X19GLS2AcinHt/images/changelog/data-export-ui.png?fit=max\&auto=format\&n=NC2X19GLS2AcinHt\&q=85\&s=d183709b77e9876ae173a1b93a13f2a1)
- [Audit Logs UI](https://mintcdn.com/metronome-b35a6a36/NC2X19GLS2AcinHt/images/changelog/audit-logs-ui.png?fit=max\&auto=format\&n=NC2X19GLS2AcinHt\&q=85\&s=2b80ebcea304db9e6a7cab8ef9e1d330)

