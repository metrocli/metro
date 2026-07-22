# Metronome upstream changelog - metro coverage

Source of truth (official): [https://docs.metronome.com/changelog](https://docs.metronome.com/changelog)
Machine-readable markdown: [https://docs.metronome.com/changelog.md](https://docs.metronome.com/changelog.md)
Docs index: [https://docs.metronome.com/llms.txt](https://docs.metronome.com/llms.txt)

Last synced into metro: **2026-07-15** (`docs/metronome-cli/site/metronome-upstream.json`).

Metro does **not** auto-ingest OpenAPI. This page is the checklist that keeps
shapes, the endpoint matrix, and `api-catalog` honest when Metronome ships changes.

## How to refresh

```bash
# Offline: does the frozen inventory still match expected key count?
npm run docs:upstream:check

# Explicit network: fetch changelog.md and report new/missing titles
npm run docs:upstream:check -- --fetch
```

When `--fetch` reports new entries: curl every linked official `.md` page,
update `skills/metronome-danger-zone/references/endpoint-matrix.md` and/or
`packages/metro-core/src/api-catalog/index.js` + shapes/validators, bump
`syncedAt`, regenerate goldens/site if catalog output changed, and rewrite
coverage notes in `scripts/generate-metronome-upstream.js` (or re-run it).

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
- **Partial** July 7, 2026 - Daily recurring credits and commits are supported: Catalog/shapes cover recurring commits generally; daily cadence (`commit_duration` / recurrence unit daily) not yet called out in TEAM-QUICKSTART or shape prose. Re-curl create/edit docs before using daily.
- **Partial** February 27, 2026 - Compound group keys in usage breakdowns: `usage.groups` is in api-catalog; compound group key constraint and page-size 100 not yet in validator prose/TEAM-QUICKSTART.
- **Partial** February 17, 2026 - Change end date on advance, prorated subscriptions: Subscription end-date edits exist via contract/subscription edit paths; advance-prorated edge case not a dedicated gotcha yet.
- **Partial** February 12, 2026 - Stripe invoice PDFs available in UI and API: Matrix notes invoice PDF GET path in conventions; not a first-class `metro` shortcut. Prefer Stripe dashboard or guarded invoice get when needed.
- **Partial** February 10, 2026 - Subscription and invoice line item linking improvements: `subscription_id` on line items / Stripe metadata - useful for reconcile; not yet a metro proof field.
- **Partial** January 16, 2026 - Major version SDK release: Breaking: removed `use_list_prices` from Rate objects - ensure rate-card payloads/validators do not emit it.
- **Partial** October 14, 2025 - September fixes and improvements: Spot-check API subsection against edit/billing-provider sources when touching those shapes.
- **Partial** September 10, 2025 - August fixes and improvements: Historical API fixes (billing config updates via edit, etc.) - reflected in danger-zone / stripe-delivery skills.
- **Partial** August 5, 2025 - July fixes and improvements: API notes (searchEvents, commits) - events.search / commits paths in catalog.
- **Partial** August 4, 2025 - Seat-based credit pools: Seat / credit pool shapes in skills; not a TEAM-QUICKSTART one-liner.
- **Partial** July 23, 2025 - Threshold billing and auto-recharge: Spend/prepaid thresholds via contract edit - danger-zone aware; not a dedicated metro shortcut.
- **Partial** June 26, 2025 - Scope credits and commits to specific pricing or presentation group values: Specifier / dimensional scoping; keep sources current.
- **Partial** June 13, 2025 - Support for seat-based subscription billing: Seat subscriptions in skills; most packages are credit+plan fee shaped.
- **Partial** May 20, 2025 - April fixes and improvements: Historical; verify touched endpoints against current `.md` sources.
- **Partial** April 1, 2025 - Support for weekly frequencies for billing, recurring commits, and credits: Cadence fields exist; weekly not a common shape.
- **Partial** March 26, 2025 - In Tempo: Spring 2025 changelog: Large release note - recurring commits, uniqueness keys, invoice breakdowns, updateEndDate guard already reflected across matrix/catalog/skills.
- **Partial** September 25, 2024 - In Tempo: Fall 2024: voidInvoice etc. in catalog; plan-era APIs are historical.

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

### July 7, 2026 - Daily recurring credits and commits are supported

Tags: Billing, API, UI

**Metro coverage:** `partial` - Catalog/shapes cover recurring commits generally; daily cadence (`commit_duration` / recurrence unit daily) not yet called out in TEAM-QUICKSTART or shape prose. Re-curl create/edit docs before using daily.

Catalog IDs: `contracts.create`, `contracts.edit`

_No deep links in the changelog body - start from [https://docs.metronome.com/changelog](https://docs.metronome.com/changelog) and curl the matching API/guide page via [llms.txt](https://docs.metronome.com/llms.txt)._

### May 29, 2026 - Configurable rounding for prorated subscriptions and recurring commits

Tags: Billing, API, UI

**Metro coverage:** `gap` - No shape/validator/docs yet for proration rounding fields. Curl subscription + recurring commit API docs before first use.

_No deep links in the changelog body - start from [https://docs.metronome.com/changelog](https://docs.metronome.com/changelog) and curl the matching API/guide page via [llms.txt](https://docs.metronome.com/llms.txt)._

### May 29, 2026 - Richer responses from `createContract` and `editContract`

Tags: API

**Metro coverage:** `accounted` - Catalog sources point at create/edit docs. Metro still requires expected-vs-actual re-read after apply (richer response does not replace proof).

Catalog IDs: `contracts.create`, `contracts.edit`

Official links:

- [Create contract API docs](https://docs.metronome.com/api-reference/contracts/create-a-contract#response-data)
- [Edit contract API docs](https://docs.metronome.com/api-reference/contracts/edit-a-contract#response-data)

### May 15, 2026 - Metronome Java SDK is now available

Tags: SDK

**Metro coverage:** `n/a-sdk` - Metro is Node CLI; Java SDK not used.

Official links:

- [javadoc.io](https://javadoc.io/doc/com.metronome.api/metronome-java/latest/index.html)
- [README](https://github.com/Metronome-Industries/metronome-java)

### April 17, 2026 - Q1 usability updates: quality of life improvements

Tags: Improvements, UI

**Metro coverage:** `n/a-ui` - UI-only QoL; no API shape impact.

_No deep links in the changelog body - start from [https://docs.metronome.com/changelog](https://docs.metronome.com/changelog) and curl the matching API/guide page via [llms.txt](https://docs.metronome.com/llms.txt)._

### April 11, 2026 - Assign RBAC roles to API tokens

Tags: New releases, UI

**Metro coverage:** `accounted` - Token scope matters for operator mode + keys. Documented under platform RBAC link; prefer reader tokens with `metro mode set read-only`.

Official links:

- [here](https://docs.metronome.com/guides/platform-configuration/role-based-access-rbac#assign-a-role-to-an-api-token)

### April 11, 2026 - Package contract transitions and credit rollover improvements

Tags: New releases, API, UI, Pricing and Packaging

**Metro coverage:** `accounted` - Package transitions and `rollover_fraction` used in preview/contract-move shapes and skills.

Catalog IDs: `packages.create`, `contracts.create`, `contracts.edit`

Official links:

- [provisioning customers with a package](https://docs.metronome.com/guides/get-started/core-concepts/packages-overview#provision-customers-with-a-package)
- [contract lifecycle transitions](https://docs.metronome.com/guides/customers-billing/manage-customers/manage-customer-lifecycle)
- [credits and rollovers](https://docs.metronome.com/guides/pricing-packaging/apply-credits-and-commits/create-a-pre-paid-commit)

### April 11, 2026 - NetSuite integration (Public Beta)

Tags: New releases, Integrations

**Metro coverage:** `n/a` - Invoices via Stripe, not NetSuite.

Official links:

- [here](https://docs.metronome.com/integrations/invoice-integrations/netsuite)

### March 9, 2026 - Dark mode

Tags: New releases, UI

**Metro coverage:** `n/a-ui` - UI only.

_No deep links in the changelog body - start from [https://docs.metronome.com/changelog](https://docs.metronome.com/changelog) and curl the matching API/guide page via [llms.txt](https://docs.metronome.com/llms.txt)._

### March 2, 2026 - SDK releases

Tags: New releases, API

**Metro coverage:** `n/a-sdk` - Track only when release notes imply API schema breakers (e.g. removed `priority`). Metro catalog is hand-curated.

Official links:

- [Go v3.2.0](https://github.com/Metronome-Industries/metronome-go/compare/v3.1.0...v3.2.0)
- [Python v4.2.0](https://github.com/Metronome-Industries/metronome-python/compare/v4.1.0...v4.2.0)
- [Ruby v3.2.0](https://github.com/Metronome-Industries/metronome-ruby/compare/v3.1.0...v3.2.0)
- [Node v3.2.0](https://github.com/Metronome-Industries/metronome-node/compare/v3.1.0...v3.2.0)

### February 27, 2026 - Compound group keys in usage breakdowns

Tags: New releases, API

**Metro coverage:** `partial` - `usage.groups` is in api-catalog; compound group key constraint and page-size 100 not yet in validator prose/TEAM-QUICKSTART.

Catalog IDs: `usage.groups`

Official links:

- [Get usage data with paginated groupings](https://docs.metronome.com/api-reference/usage/get-usage-data-with-paginated-groupings)
- [here](https://docs.metronome.com/api-reference/usage/get-usage-data-with-paginated-groupings)

### February 23, 2026 - Archive packages

Tags: New releases, API, UI

**Metro coverage:** `accounted` - `packages.archive` in api-catalog + validators.

Catalog IDs: `packages.archive`

Official links:

- [API](https://docs.metronome.com/api-reference/packages/archive-a-package)

### February 19, 2026 - New Metronome UI

Tags: New releases, UI

**Metro coverage:** `n/a-ui` - UI only.

_No deep links in the changelog body - start from [https://docs.metronome.com/changelog](https://docs.metronome.com/changelog) and curl the matching API/guide page via [llms.txt](https://docs.metronome.com/llms.txt)._

### February 17, 2026 - Change end date on advance, prorated subscriptions

Tags: New releases, API

**Metro coverage:** `partial` - Subscription end-date edits exist via contract/subscription edit paths; advance-prorated edge case not a dedicated gotcha yet.

Catalog IDs: `contracts.edit`

_No deep links in the changelog body - start from [https://docs.metronome.com/changelog](https://docs.metronome.com/changelog) and curl the matching API/guide page via [llms.txt](https://docs.metronome.com/llms.txt)._

### February 12, 2026 - Stripe invoice PDFs available in UI and API

Tags: New releases, API, UI

**Metro coverage:** `partial` - Matrix notes invoice PDF GET path in conventions; not a first-class `metro` shortcut. Prefer Stripe dashboard or guarded invoice get when needed.

Catalog IDs: `invoices.get`

_No deep links in the changelog body - start from [https://docs.metronome.com/changelog](https://docs.metronome.com/changelog) and curl the matching API/guide page via [llms.txt](https://docs.metronome.com/llms.txt)._

### February 10, 2026 - Subscription and invoice line item linking improvements

Tags: Improvements, API, Integrations

**Metro coverage:** `partial` - `subscription_id` on line items / Stripe metadata - useful for reconcile; not yet a metro proof field.

Catalog IDs: `invoices.get`, `invoices.listForCustomer`

_No deep links in the changelog body - start from [https://docs.metronome.com/changelog](https://docs.metronome.com/changelog) and curl the matching API/guide page via [llms.txt](https://docs.metronome.com/llms.txt)._

### February 9, 2026 - Create contracts from packages in the UI

Tags: New releases, UI

**Metro coverage:** `n/a-ui` - API path already covered (`packages` + `contracts.create`). UI convenience only.

Catalog IDs: `contracts.create`

_No deep links in the changelog body - start from [https://docs.metronome.com/changelog](https://docs.metronome.com/changelog) and curl the matching API/guide page via [llms.txt](https://docs.metronome.com/llms.txt)._

### February 6, 2026 - In-app embedded dashboards

Tags: New releases, UI

**Metro coverage:** `n/a-ui` - UI reporting; use metro + exports.

_No deep links in the changelog body - start from [https://docs.metronome.com/changelog](https://docs.metronome.com/changelog) and curl the matching API/guide page via [llms.txt](https://docs.metronome.com/llms.txt)._

### February 5, 2026 - SDK releases

Tags: New releases, API

**Metro coverage:** `n/a-sdk` - Track only when release notes imply API schema breakers (e.g. removed `priority`). Metro catalog is hand-curated.

Official links:

- [Go v3.1.0](https://github.com/Metronome-Industries/metronome-node/compare/v3.0.0...v3.1.0)
- [Python v4.1.0](https://github.com/Metronome-Industries/metronome-python/compare/v4.0.0...v4.1.0)
- [Ruby v3.1.0](https://github.com/Metronome-Industries/metronome-ruby/compare/v3.0.0...v3.1.0)
- [Node v3.1.0](https://github.com/Metronome-Industries/metronome-node/compare/v3.0.0...v3.1.0)

### February 5, 2026 - Get net balance API

Tags: New releases, API

**Metro coverage:** `gap` - Verified in endpoint-matrix (`POST /v1/contracts/customerBalances/getNetBalance`) but **not** yet a reviewed api-catalog ID / `metro api read` shape. Prefer over paginating balances when consolidating.

Official links:

- [Get net balance](https://docs.metronome.com/api-reference/credits-and-commits/get-the-net-balance-of-a-customer)
- [here](https://docs.metronome.com/api-reference/credits-and-commits/get-the-net-balance-of-a-customer)

### January 29, 2026 - Edit net payment terms on contracts

Tags: New releases, API, UI

**Metro coverage:** `accounted` - Preview supports `net_payment_terms_days`; edit history still required for audit.

Catalog IDs: `contracts.edit`

_No deep links in the changelog body - start from [https://docs.metronome.com/changelog](https://docs.metronome.com/changelog) and curl the matching API/guide page via [llms.txt](https://docs.metronome.com/llms.txt)._

### January 16, 2026 - Major version SDK release

Tags: New releases, API

**Metro coverage:** `partial` - Breaking: removed `use_list_prices` from Rate objects - ensure rate-card payloads/validators do not emit it.

Catalog IDs: `rateCards.addRates`, `rateCards.getRates`

Official links:

- [Node v3.0.0](https://github.com/Metronome-Industries/metronome-node/releases)
- [Go v3.0.0](https://github.com/Metronome-Industries/metronome-go/releases)
- [Python v4.0.0](https://github.com/Metronome-Industries/metronome-python/releases)
- [Ruby v3.0.0](https://github.com/Metronome-Industries/metronome-ruby/releases)

### January 12, 2026 - Self-serve access to Metronome

Tags: New releases, UI

**Metro coverage:** `n/a-ui` - Onboarding UI.

Official links:

- [Metronome website](https://metronome.com)

### January 12, 2026 - Billing configuration API endpoints now return response bodies

Tags: Improvements, API

**Metro coverage:** `accounted` - Billing-provider set/archive in catalog; responses expected in sandbox-proof paths.

Catalog IDs: `customers.setBillingProviderConfigurations`, `customers.archiveBillingProviderConfigurations`

Official links:

- [set billing provider configuration](https://docs.metronome.com/api-reference/customers/set-billing-provider-configurations-for-a-customer)
- [archive billing provider configuration](https://docs.metronome.com/api-reference/customers/archive-billing-provider-configurations-for-a-customer)

### December 22, 2025 - High cardinality group key spend alerts

Tags: New releases, Notifications

**Metro coverage:** `n/a` - Alerts not in metro core day-to-day.

_No deep links in the changelog body - start from [https://docs.metronome.com/changelog](https://docs.metronome.com/changelog) and curl the matching API/guide page via [llms.txt](https://docs.metronome.com/llms.txt)._

### December 19, 2025 - SDK releases

Tags: New releases, API

**Metro coverage:** `n/a-sdk` - Track only when release notes imply API schema breakers (e.g. removed `priority`). Metro catalog is hand-curated.

Official links:

- [Node v2.2.0](https://github.com/Metronome-Industries/metronome-node/releases)
- [Go v2.2.0](https://github.com/Metronome-Industries/metronome-go/releases)
- [Python v3.2.0](https://github.com/Metronome-Industries/metronome-python/releases)
- [Ruby v2.2.0](https://github.com/Metronome-Industries/metronome-ruby/releases)

### November 14, 2025 - Launch week recap: Monetization Infrastructure for AI

Tags: New releases, API, Notifications, Integrations, UI, Pricing and Packaging

**Metro coverage:** `n/a-ui` - Marketing recap; follow linked product guides when relevant.

Official links:

- [here](https://docs.metronome.com/guides/pricing-packaging/billing-model-guides/hybrid-business-models#use-case)
- [here](https://docs.metronome.com/guides/pricing-packaging/subscription/subscription-overview)
- [here](https://docs.metronome.com/guides/get-started/core-concepts/packages-overview)
- [here](https://metronome.com/blog/monetize-ai-with-full-pricing-flexibility)
- [here](https://docs.metronome.com/guides/invoices/invoice-with-metronome#invoice-with-metronome)
- [here](https://docs.metronome.com/integrations/marketplace-integrations/gcp)
- [here](https://metronome.com/blog/unify-invoicing-across-every-revenue-motion)
- [here](https://docs.metronome.com/guides/customers-billing/optimize-customer-experience/preview-event-cost)
- [here](https://docs.metronome.com/guides/invoices/invoice-with-metronome#metronome-billing-console)
- [here](https://docs.metronome.com/guides/customers-billing/set-up-notifications/create-and-manage-notifications#manage-your-customer-lifecycle-with-metronome-notifications)
- [here](https://metronome.com/blog/make-billing-part-of-the-product-experience)
- [metronome.com/launch-week](http://metronome.com/launch-week)

### November 3, 2025 - Invoicing with Google Cloud Marketplace

Tags: New releases, Integrations

**Metro coverage:** `n/a` - Uses Stripe billing.

Official links:

- [here](https://docs.metronome.com/integrations/marketplace-integrations/gcp#invoice-with-gcp)

### October 31, 2025 - New SDK releases

Tags: New releases, API

**Metro coverage:** `n/a-sdk` - Track only when release notes imply API schema breakers (e.g. removed `priority`). Metro catalog is hand-curated.

Official links:

- [v2.1.0](https://github.com/Metronome-Industries/metronome-node/releases)
- [v2.1.0](https://github.com/Metronome-Industries/metronome-go/releases)
- [v3.1.0](https://github.com/Metronome-Industries/metronome-python/releases)
- [v2.1.0](https://github.com/Metronome-Industries/metronome-ruby/releases)

### October 14, 2025 - September fixes and improvements

Tags: Improvements, API, Notifications, UI, Pricing and Packaging

**Metro coverage:** `partial` - Spot-check API subsection against edit/billing-provider sources when touching those shapes.

Catalog IDs: `contracts.edit`

Official links:

- [`spend_threshold_reached`](https://docs.metronome.com/guides/customers-billing/optimize-customer-experience/customer-controls#enable-custom-spend-limits-for-a-specific-dimension%E2%80%8B)
- [Add a billing configuration](https://docs.metronome.com/api-reference/contracts/edit-a-contract#body-add-billing-provider-configuration-update)
- [Archive a billing provider](https://docs.metronome.com/api-reference/customers/archive-billing-provider-configurations-for-a-customer)
- [Edit the rate type of a recurring commit](https://docs.metronome.com/api-reference/credits-and-commits/edit-a-commit#body-rate-type)
- [Node](https://github.com/Metronome-Industries/metronome-node/releases/tag/v1.0.0)
- [Go](https://github.com/Metronome-Industries/metronome-go/releases/tag/v1.0.0)
- [Python](https://github.com/Metronome-Industries/metronome-python/releases/tag/v1.0.0)
- [Ruby](https://github.com/Metronome-Industries/metronome-ruby/releases/tag/v1.0.0)

### September 24, 2025 - Make advanced contract overrides in the Metronome app

Tags: New releases, UI, Pricing and Packaging

**Metro coverage:** `n/a-ui` - UI for overrides; API overrides remain via `contracts.edit`.

Catalog IDs: `contracts.edit`

Official links:

- [here](https://docs.metronome.com/guides/pricing-packaging/make-pricing-changes/edit-or-override-a-contract#contract-edits-and-overrides)

### September 24, 2025 - Custom Reports

Tags: New releases, UI

**Metro coverage:** `n/a-ui` - In-app reports.

Official links:

- [here](https://docs.metronome.com/guides/reporting-insights/in-app-reporting#custom-reports)

### September 18, 2025 - Customer Lifecycle Notifications

Tags: New releases, API, Notifications, UI

**Metro coverage:** `n/a` - Notifications not operated via metro today.

Official links:

- [here](https://docs.metronome.com/guides/customers-billing/set-up-notifications/create-and-manage-notifications)

### September 11, 2025 - New documentation experience

Tags: New releases, API, Notifications, Integrations, UI, Pricing and Packaging

**Metro coverage:** `accounted` - Sources use docs.metronome.com `.md` URLs + llms.txt. This tracker is the metro-side sync surface.

_No deep links in the changelog body - start from [https://docs.metronome.com/changelog](https://docs.metronome.com/changelog) and curl the matching API/guide page via [llms.txt](https://docs.metronome.com/llms.txt)._

### September 10, 2025 - August fixes and improvements

Tags: Improvements, API, UI, Pricing and Packaging

**Metro coverage:** `partial` - Historical API fixes (billing config updates via edit, etc.) - reflected in danger-zone / stripe-delivery skills.

Catalog IDs: `contracts.edit`

Official links:

- [data exports](https://docs.metronome.com/developer-resources/data-export)
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

Tags: New releases, UI

**Metro coverage:** `partial` - `invoices.listBreakdowns` in catalog; data-export tables are separate.

Catalog IDs: `invoices.listBreakdowns`

Official links:

- [here](https://docs.metronome.com/guides/reporting-insights/data-export#invoice-breakdowns-tables)

### August 5, 2025 - July fixes and improvements

Tags: Improvements, API, Notifications, Integrations, UI, Pricing and Packaging

**Metro coverage:** `partial` - API notes (searchEvents, commits) - events.search / commits paths in catalog.

Catalog IDs: `events.search`, `commits.list`

Official links:

- [prepaid](https://docs.metronome.com/pricing-packaging/apply-credits-commits/#prepaid-commits)
- [postpaid](https://docs.metronome.com/pricing-packaging/apply-credits-commits/#postpaid-commits)
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
- [Send Metronome events to Slack](https://docs.metronome.com/developer-resources/use-api/webhooks/#send-webhooks-to-slack)

### August 4, 2025 - Use group keys to set budgets across users, teams, and projects

Tags: New releases, API, Notifications, UI

**Metro coverage:** `n/a` - Spend controls/alerts - not metro day-to-day.

Official links:

- [group key values](https://docs.metronome.com/connect-metronome/create-billable-metrics/#group-keys)
- [here](https://docs.metronome.com/launch-guides/hybrid-business/)
- [here](https://docs.metronome.com/enhance-customer-experience/customer-controls/#enable-custom-spend-limits-for-a-specific-dimension)

### August 4, 2025 - Seat-based credit pools

Tags: New releases, API, UI, Pricing and Packaging

**Metro coverage:** `partial` - Seat / credit pool shapes in skills; not a TEAM-QUICKSTART one-liner.

Catalog IDs: `contracts.edit`

Official links:

- [here](https://docs.metronome.com/enhance-customer-experience/customer-controls/#enable-custom-spend-limits-for-a-specific-dimension)
- [See docs here.](https://docs.metronome.com/launch-guides/hybrid-business/)

### August 1, 2025 - Embeddable dashboard for credit and commit balances

Tags: New releases, API

**Metro coverage:** `n/a-ui` - Embeddable UI; metro uses balances list / (future) getNetBalance.

Catalog IDs: `customerBalances.list`

Official links:

- [here](https://docs.metronome.com/enhance-customer-experience/customer-dashboards/#commits-and-credits-dashboard)

### July 23, 2025 - Threshold billing and auto-recharge

Tags: New releases, API, UI, Pricing and Packaging

**Metro coverage:** `partial` - Spend/prepaid thresholds via contract edit - danger-zone aware; not a dedicated metro shortcut.

Catalog IDs: `contracts.edit`

Official links:

- [here](https://docs.metronome.com/pricing-packaging/apply-credits-commits/manual-payment-gated-commits/)
- [here](https://docs.metronome.com/manage-product-access/spend-thresholds#create-a-contract-with-spend-thresholds)
- [here](https://docs.metronome.com/manage-product-access/prepaid-balance-thresholds/)
- [here](https://docs.metronome.com/launch-guides/prepaid-credits/)
- [here](https://metronome.com/blog/choosing-the-right-plg-billing-models-for-your-business)

### July 15, 2025 - Set up multi-entity billing

Tags: New releases, Integrations

**Metro coverage:** `partial` - Account hierarchy / billing config - skills note hierarchy; careful with Stripe entity.

Catalog IDs: `customers.setBillingProviderConfigurations`

Official links:

- [here](https://docs.metronome.com/invoice-customers/solutions/invoice-with-stripe/#set-the-customer-billing-configuration)

### June 26, 2025 - Scope credits and commits to specific pricing or presentation group values

Tags: New releases, API, UI, Pricing and Packaging

**Metro coverage:** `partial` - Specifier / dimensional scoping; keep sources current.

Catalog IDs: `contracts.edit`, `rateCards.addRates`

Official links:

- [here](https://docs.metronome.com/pricing-packaging/apply-credits-commits/target-credits-commits/)

### June 13, 2025 - Edit recurring commits and credits

Tags: New releases, API, UI, Pricing and Packaging

**Metro coverage:** `accounted` - Recurring edit via contracts.edit / commit edit docs in skills.

Catalog IDs: `contracts.edit`

Official links:

- [here](https://docs.metronome.com/api/#operation/editContract-v2)

### June 13, 2025 - Support for seat-based subscription billing

Tags: New releases, API, UI, Pricing and Packaging

**Metro coverage:** `partial` - Seat subscriptions in skills; most packages are credit+plan fee shaped.

Catalog IDs: `contracts.create`, `contracts.edit`

Official links:

- [here](https://docs.metronome.com/manage-product-access/create-subscription/#update-pricing)
- [here](https://docs.metronome.com/manage-product-access/create-subscription/)

### May 20, 2025 - April fixes and improvements

Tags: Improvements, API, Integrations, UI

**Metro coverage:** `partial` - Historical; verify touched endpoints against current `.md` sources.

Official links:

- [`getCustomer`](https://docs.metronome.com/api/#operation/getCustomer-v1)
- [`listCustomers`](https://docs.metronome.com/api/#operation/listCustomers-v1)
- [`getInvoice`](https://docs.metronome.com/api/#operation/getInvoice-v1)
- [`listInvoices`](https://docs.metronome.com/api/#operation/listInvoices-v1)
- [`listBreakdownInvoices`](https://docs.metronome.com/api/#operation/listBreakdownInvoices-v1)
- [here](https://docs.metronome.com/api/#operation/archiveRateCard-v1)

### May 8, 2025 - Remove overrides and archive commits and scheduled charges

Tags: New releases, API, UI, Pricing and Packaging

**Metro coverage:** `accounted` - editContract archive/remove paths documented in danger-zone.

Catalog IDs: `contracts.edit`

Official links:

- [here](https://docs.metronome.com/api/#operation/editContract-v2)

### May 5, 2025 - Support for NZD and SGD currencies

Tags: New releases, Pricing and Packaging

**Metro coverage:** `n/a` - Standard currency amounts.

Official links:

- [here](https://docs.metronome.com/pricing-packaging/use-currency-custompricingunits/)

### May 1, 2025 - Ruby SDK

Tags: New releases, API

**Metro coverage:** `n/a-sdk` - SDK only.

Official links:

- [here](https://github.com/Metronome-Industries/metronome-ruby)
- [here](https://docs.metronome.com/developer-resources/sdks/)

### April 29, 2025 - Updated UI for creating and editing contracts, customer-level commits, and customer-level credits

Tags: New releases, UI

**Metro coverage:** `n/a-ui` - UI only.

Official links:

- [available through the API](https://docs.metronome.com/api/#operation/editContract-v2)

### April 9, 2025 - Edit rates in the Rate Card UI

Tags: Improvements, UI

**Metro coverage:** `n/a-ui` - API: addRates/getRates in catalog.

Catalog IDs: `rateCards.addRates`

_No deep links in the changelog body - start from [https://docs.metronome.com/changelog](https://docs.metronome.com/changelog) and curl the matching API/guide page via [llms.txt](https://docs.metronome.com/llms.txt)._

### April 2, 2025 - Usage threshold alerts supported on Contracts

Tags: New releases, API, Notifications

**Metro coverage:** `n/a` - Alerts out of metro day-to-day.

Official links:

- [here](https://docs.metronome.com/manage-product-access/create-manage-alerts/#usage-alerts)

### April 2, 2025 - Contract editing

Tags: New releases, API, UI, Pricing and Packaging

**Metro coverage:** `accounted` - `contracts.edit` + danger-zone editContract support matrix.

Catalog IDs: `contracts.edit`

Official links:

- [Read more in our docs.](https://docs.metronome.com/manage-product-access/edit-contract/)

### April 1, 2025 - Support for weekly frequencies for billing, recurring commits, and credits

Tags: New releases, API, UI, Pricing and Packaging

**Metro coverage:** `partial` - Cadence fields exist; weekly not a common shape.

Catalog IDs: `contracts.create`, `contracts.edit`

Official links:

- [docs](https://docs.metronome.com/api/#operation/createContract-v1)

### March 26, 2025 - In Tempo: Spring 2025 changelog

Tags: New releases, API, Notifications, Integrations, UI, Pricing and Packaging

**Metro coverage:** `partial` - Large release note - recurring commits, uniqueness keys, invoice breakdowns, updateEndDate guard already reflected across matrix/catalog/skills.

Catalog IDs: `contracts.create`, `contracts.edit`, `contracts.updateEndDate`, `invoices.listBreakdowns`, `customerBalances.list`

Official links:

- [here](https://docs.metronome.com/manage-product-access/create-manage-alerts/#webhook-notifications)
- [here](https://docs.metronome.com/manage-product-access/create-manage-alerts/#create-an-alert)
- [here](https://docs.metronome.com/api/#operation/listBreakdownInvoices)
- [here](https://docs.metronome.com/enhance-customer-experience/customer-dashboards/#display-up-to-date-spend)
- [here](https://docs.metronome.com/api/#operation/listCustomerBalances)
- [here](https://docs.metronome.com/api/#operation/createCustomerCommit)
- [here](https://docs.metronome.com/api/#operation/listRateCards)
- [here](https://docs.metronome.com/api/#operation/updateContractEndDate)
- [request body](https://docs.metronome.com/api/#operation/updateContractEndDate)
- [API](https://docs.metronome.com/api/#operation/createContract)
- [here](https://docs.metronome.com/pricing-packaging/apply-credits-commits/#provision-recurring-usage-credits)
- [here](https://docs.metronome.com/pricing-packaging/apply-credits-commits/discounts/)
- [here](https://metronome.com/blog/say-goodbye-to-overages-hello-to-commit-rates)
- [here](https://docs.metronome.com/launch-guides/quickstart#create-composite-products)
- [Metronome Trust Center](https://trust.metronome.com/)
- [here](https://docs.metronome.com/invoice-customers/solutions/invoice-with-stripe/#configure-optional-global-integration-settings-available)
- [here](https://docs.metronome.com/developer-resources/data-export/#contracts_commits)
- [we launched Metronome 2.0](https://metronome.com/blog/introducing-metronome-2-0)
- [here](https://docs.metronome.com/invoice-customers/solutions/marketplaces/)
- [here](https://docs.metronome.com/pricing-packaging/use-currency-custompricingunits#supported-currencies)
- [here](https://docs.metronome.com/api/#operation/embeddableDashboard)
- [here](https://metronome.com/talk-to-an-expert?utm_medium=web\&utm_source=blog\&utm_campaign=intempo_spring_2024)

### October 17, 2024 - Metronome 2.0

Tags: New releases, API, Notifications, Integrations, UI, Pricing and Packaging

**Metro coverage:** `accounted` - Metro is built on Metronome 2.0 contracts/rate-cards/packages model.

Official links:

- [managing rate cards](https://docs.metronome.com/pricing-packaging/create-manage-rate-cards/)
- [customizing pricing](https://docs.metronome.com/manage-product-access/provision-customer/#add-contract-discounts-and-overrides)
- [enterprise commit launch guide](https://docs.metronome.com/launch-guides/enterprise-commit/)
- [dimensional pricing](https://docs.metronome.com/pricing-packaging/create-manage-rate-cards/#dimensional-pricing)
- [billable metrics](https://docs.metronome.com/connect-metronome/create-billable-metrics/)
- [customer and contract provisioning](https://docs.metronome.com/manage-product-access/provision-customer/)
- [building customer dashboards](https://docs.metronome.com/enhance-customer-experience/customer-dashboards/)
- [API documentation](https://docs.metronome.com/api)
- [customer spend controls](https://docs.metronome.com/enhance-customer-experience/customer-controls/)
- [creating and managing alerts](https://docs.metronome.com/manage-product-access/create-manage-alerts/)
- [syncing billing data into Salesforce](https://docs.metronome.com/reports-insights/sync-into-salesforce/)

### September 25, 2024 - In Tempo: Fall 2024

Tags: New releases, API, Notifications, UI, Pricing and Packaging

**Metro coverage:** `partial` - voidInvoice etc. in catalog; plan-era APIs are historical.

Catalog IDs: `invoices.void`

Official links:

- [here](https://docs.metronome.com/api/#operation/voidInvoice)
- [Go](https://pkg.go.dev/github.com/Metronome-Industries/metronome-go#section-readme)
- [Python](https://pypi.org/project/metronome-sdk/)
- [TypeScript](https://www.npmjs.com/package/@metronome/sdk)
- [here](https://docs.metronome.com/connecting-metronome/alerts/#usage-threshold-reached)
- [here](https://docs.metronome.com/connecting-metronome/alerts#invoice-total-reached)
- [here](https://docs.metronome.com/invoicing/how-billing-works/set-up-seat-based-billing/#how-seat-based-billing-works)
- [here](https://docs.metronome.com/pricing-and-packaging/create-plans/#fixed-fee-and-tiered-usage)
- [here](https://docs.metronome.com/api/#operation/createGrant)
- [here](https://docs.metronome.com/developer-resources/export-metronome-data/#customer_plan)
- [here](https://metronome.com/talk-to-an-expert?utm_medium=web\&utm_source=blog\&utm_campaign=intempo_fall_2024)

### June 10, 2024 - In Tempo: Spring 2024

Tags: New releases, API, Notifications, Integrations, UI, Pricing and Packaging

**Metro coverage:** `n/a-ui` - Mostly pre-2.0/plan-era; do not copy paths into new workflows without matrix check.

Official links:

- [here](https://docs.metronome.com/api/#billable-metrics)
- [here](https://docs.metronome.com/api/#operation/createAlert)
- [here](https://docs.metronome.com/connecting-metronome/alerts/#forcing-alert-re-evaluation)
- [here](https://docs.metronome.com/api/#operation/resetCustomerAlerts)
- [here](https://docs.metronome.com/api/#operation/addPlanToCustomer)
- [here](https://docs.metronome.com/api/#operation/createGrant)
- [AWS Marketplace integration](https://docs.metronome.com/invoicing/how-invoicing-works/invoicing-with-aws-marketplace/)
- [here](https://docs.metronome.com/api/#operation/getAuditLogs)
- [here](https://docs.metronome.com/integrations/workato-connector/)

