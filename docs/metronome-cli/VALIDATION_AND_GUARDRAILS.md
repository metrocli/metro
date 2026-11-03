# Validation and guardrails

Validator rules: `metro docs validator-reference --json` (generated page:
[validator-reference.md](site/validator-reference.md)). This page summarises
the rules for the dimensional rate-card shape and the live-execution
boundaries; the generated reference is authoritative.

## Dimensional rate-card rules (`--shape dimensional-rate-card`)

| Rule ID | What it enforces |
|---------|------------------|
| MTR-RATE-001 | 1 to 100 rate rows per preview batch; each row is an object with a non-negative integer `price`, a safe `creditTypeId`, and `entitled: true` |
| MTR-RATE-004 | `rateCardId` is present and a single safe rate-card identifier |
| MTR-RATE-005 | `usageProduct` is type USAGE with a safe `billableMetricId`, `pricingGroupKey` exactly `["action_code"]` and the matching presentation key; `billableMetric` evidence matches it (aggregation type, reviewed event-type filter, non-retroactive review, one compound group key covering every pricing and presentation dimension) |
| MTR-TIME-001 | `startingAt` / `endingBefore` are UTC hour-boundary timestamps |
| MTR-IDEMP-003 | Duplicate-prevention evidence for creates: `usageProduct.existingProductCollisionReviewed: true` before a product create can be planned |
| MTR-VERIFY-001 | `verificationPlan` is present and `invoiceImpactReviewed: true` |
| MTR-VERIFY-002 | `rollbackPlan` is present |
| MTR-VERIFY-003 | `canaryPlan` for bulk work: `firstActionCode` matches a planned rate, `readBackBeforeRemaining: true`, and `stopCriteria` is set |

`catalogMode: add-rates-only` also requires `usageProduct.productId` for the
existing USAGE product (MTR-WORKSPACE-003), so no new product is planned.

## API request rules (`rateCards.addRates`)

`metro api validate rateCards.addRates --file <request.json|yaml>` checks:

- a secret scan of the whole request
- `body.rate_card_id`: present and a safe identifier
- `body.starting_at`: present and on a UTC hour boundary
- `body.rates`: an array

Shape-level checks (entitlement, price units, canary) come from the
`dimensional-rate-card` validator above, not from `api validate`.

## Live execution boundaries (current release)

The lists below come from `packages/metro-core/src/clients/live-endpoints.js`.

| Operation | Sandbox | Production |
|-----------|---------|------------|
| Guarded reads (`metro api read`, needs a read gate and `--confirm-live-read`) | 20 endpoints | Same 20 endpoints with `--prod` |
| Guarded expert-API writes (`metro api apply`, needs an apply gate, approval record and `--confirm-live-apply`) | 8 endpoints | **Blocked** (sandbox only) |
| Pack operations (`metro customer`, `ratecard`, `package`, `contract`, `subscription` ... `apply`) | Dry run by default; `--apply` with the tenant's typed token, then read-back (exit 3 on mismatch) | Same, with `--confirm-prod-apply` |
| Workflow apply (`metro rate-card dimensional apply` and other `*.apply` workflow commands marked unsupported) | **Blocked** | **Blocked** |

Live read endpoints: `contracts.get.v2`, `contracts.list.v2`, `customers.get`,
`customers.list`, `invoices.listForCustomer`, `invoices.get`, `packages.get`,
`packages.list`, `packages.listContractsOnPackage`, `rateCards.get`,
`rateCards.list`, `rateCards.getRates`, `products.get`, `products.list`,
`customerBalances.list`, `credits.list`, `commits.list`,
`customFields.listKeys`, `billingProvider.getCustomerConfigurations`,
`security.getAuditLogs`.

Live sandbox write endpoints: `contracts.create`, `contracts.edit.v2`,
`packages.create`, `customers.create`, `customFields.setValues`,
`rateCards.addRates`, `products.create`, `billableMetrics.create`. The two
catalog creates (`products.create`, `billableMetrics.create`) also need
`--confirm-greenfield-create`.

Check the current state with `metro status --json`, `metro api readiness --summary --json`
and `metro release readiness --json`.
