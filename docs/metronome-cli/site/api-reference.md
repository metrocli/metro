# api-reference
- schemaVersion: `metro.docs.api-reference.v1`
- apiAccess: `none`
## Endpoints

| id | family | method | path | supportStatus | apiAccess |
| --- | --- | --- | --- | --- | --- |
| usage.ingest | usage | POST | /v1/ingest | workflow-preview-supported | none |
| usage.groups | usage | POST | /v1/usage/groups | cataloged-local-only | none |
| usage.batch | usage | POST | /v1/usage | cataloged-local-only | none |
| events.search | usage | POST | /v1/events/search | cataloged-local-only | none |
| billableMetrics.get | billable-metrics | GET | /v1/billable-metrics/{billable_metric_id} | cataloged-local-only | none |
| billableMetrics.list | billable-metrics | GET | /v1/billable-metrics | cataloged-local-only | none |
| billableMetrics.create | billable-metrics | POST | /v1/billable-metrics/create | cataloged-local-only | none |
| billableMetrics.update | billable-metrics | PUT | /v1/billable-metrics/{billable_metric_id} | cataloged-local-only | none |
| billableMetrics.archive | billable-metrics | POST | /v1/billable-metrics/archive | cataloged-local-only | none |
| packages.create | packages | POST | /v1/packages/create | workflow-preview-supported | none |
| packages.get | packages | POST | /v1/packages/get | inspect-plan-supported | none |
| packages.list | packages | POST | /v1/packages/list | inspect-plan-supported | none |
| packages.listContractsOnPackage | packages | POST | /v1/packages/listContractsOnPackage | cataloged-local-only | none |
| packages.archive | packages | POST | /v1/packages/archive | workflow-preview-supported | none |
| contracts.create | contracts | POST | /v1/contracts/create | workflow-preview-supported | none |
| contracts.updateEndDate | contracts | POST | /v1/contracts/updateEndDate | workflow-preview-supported | none |
| contracts.get.v2 | contracts | POST | /v2/contracts/get | inspect-plan-supported | none |
| contracts.list.v2 | contracts | POST | /v2/contracts/list | inspect-plan-supported | none |
| contracts.getRateSchedule | contracts | POST | /v1/contracts/getContractRateSchedule | cataloged-local-only | none |
| contracts.getEditHistory | contracts | POST | /v2/contracts/getEditHistory | cataloged-local-only | none |
| contracts.getSubscriptionQuantityHistory | contracts | POST | /v1/contracts/getSubscriptionQuantityHistory | cataloged-local-only | none |
| contracts.getSubscriptionSeatsHistory | contracts | POST | /v1/contracts/getSubscriptionSeatsHistory | cataloged-local-only | none |
| contracts.edit.v2 | contracts | POST | /v2/contracts/edit | workflow-preview-supported | none |
| contracts.updateInvoiceIssueDate | contracts | POST | /v1/contracts/updateInvoiceIssueDate | workflow-preview-supported | none |
| commits.list | credits | POST | /v1/contracts/customerCommits/list | inspect-plan-supported | none |
| credits.list | credits | POST | /v1/contracts/customerCredits/list | inspect-plan-supported | none |
| customerBalances.list | credits | POST | /v1/contracts/customerBalances/list | inspect-plan-supported | none |
| seatBalances.list | credits | POST | /v1/contracts/seatBalances/list | cataloged-local-only | none |
| invoices.preview | invoices | POST | /v1/customers/{customer_id}/previewEvents | workflow-preview-supported | none |
| customers.get | customers | GET | /v1/customers/{customer_id} | inspect-plan-supported | none |
| customers.list | customers | GET | /v1/customers | local-read-plan-supported | none |
| customers.create | customers | POST | /v1/customers | workflow-preview-supported | none |
| customers.archive | customers | POST | /v1/customers/archive | cataloged-local-only | none |
| customers.updateConfig | customers | POST | /v1/customers/{customer_id}/updateConfig | workflow-preview-supported | none |
| customers.updateName | customers | POST | /v1/customers/{customer_id}/updateName | cataloged-local-only | none |
| customers.setIngestAliases | customers | POST | /v1/customers/{customer_id}/setIngestAliases | cataloged-local-only | none |
| invoices.listForCustomer | invoices | GET | /v1/customers/{customer_id}/invoices | inspect-plan-supported | none |
| invoices.listBreakdowns | invoices | GET | /v1/customers/{customer_id}/invoices/breakdowns | cataloged-local-only | none |
| invoices.get | invoices | POST | /v1/invoices/get | inspect-plan-supported | none |
| invoices.void | invoices | POST | /v1/invoices/void | cataloged-local-only | none |
| invoices.regenerate | invoices | POST | /v1/invoices/regenerate | cataloged-local-only | none |
| payments.listForInvoice | payments | POST | /v1/invoices/payments/list | cataloged-local-only | none |
| payments.attempt | payments | POST | /v1/invoices/payments/attempt | cataloged-local-only | none |
| payments.cancel | payments | POST | /v1/invoices/payments/cancel | cataloged-local-only | none |
| billingProvider.setCustomerConfigurations | billing-provider | POST | /v1/setCustomerBillingProviderConfigurations | workflow-preview-supported | none |
| billingProvider.getCustomerConfigurations | billing-provider | POST | /v1/getCustomerBillingProviderConfigurations | inspect-plan-supported | none |
| billingProvider.listConfiguredProviders | billing-provider | POST | /v1/listConfiguredBillingProviders | cataloged-local-only | none |
| customFields.addKey | custom-fields | POST | /v1/customFields/addKey | cataloged-local-only | none |
| customFields.removeKey | custom-fields | POST | /v1/customFields/removeKey | cataloged-local-only | none |
| customFields.setValues | custom-fields | POST | /v1/customFields/setValues | cataloged-local-only | none |
| customFields.deleteValues | custom-fields | POST | /v1/customFields/deleteValues | cataloged-local-only | none |
| customFields.listKeys | custom-fields | POST | /v1/customFields/listKeys | cataloged-local-only | none |
| settings.listPricingUnits | settings | GET | /v1/credit-types/list | cataloged-local-only | none |
| security.getServices | security | GET | /v1/services | cataloged-local-only | none |
| security.getAuditLogs | security | GET | /v1/auditLogs | cataloged-local-only | none |
| products.get | products | POST | /v1/contract-pricing/products/get | inspect-plan-supported | none |
| products.list | products | POST | /v1/contract-pricing/products/list | cataloged-local-only | none |
| products.create | products | POST | /v1/contract-pricing/products/create | workflow-preview-supported | none |
| products.update | products | POST | /v1/contract-pricing/products/update | workflow-preview-supported | none |
| products.archive | products | POST | /v1/contract-pricing/products/archive | workflow-preview-supported | none |
| rateCards.create | rate-cards | POST | /v1/contract-pricing/rate-cards/create | workflow-preview-supported | none |
| rateCards.update | rate-cards | POST | /v1/contract-pricing/rate-cards/update | workflow-preview-supported | none |
| rateCards.archive | rate-cards | POST | /v1/contract-pricing/rate-cards/archive | workflow-preview-supported | none |
| rateCards.setProductOrder | rate-cards | POST | /v1/contract-pricing/rate-cards/setRateCardProductsOrder | workflow-preview-supported | none |
| rateCards.get | rate-cards | POST | /v1/contract-pricing/rate-cards/get | cataloged-local-only | none |
| rateCards.list | rate-cards | POST | /v1/contract-pricing/rate-cards/list | cataloged-local-only | none |
| rateCards.getRates | rate-cards | POST | /v1/contract-pricing/rate-cards/getRates | cataloged-local-only | none |
| rateCards.addRates | rate-cards | POST | /v1/contract-pricing/rate-cards/addRates | workflow-preview-supported | none |
| rateCards.getRateSchedule | rate-cards | POST | /v1/contract-pricing/rate-cards/getRateSchedule | inspect-plan-supported | none |


## families

| family | endpointCount | operationTypes | supportStatuses |
| --- | --- | --- | --- |
| billable-metrics | 5 | {"read":2,"write":3} | {"cataloged-local-only":5} |
| billing-provider | 3 | {"write":1,"read":2} | {"workflow-preview-supported":1,"inspect-plan-supported":1,"cataloged-local-only":1} |
| contracts | 10 | {"write":4,"read":6} | {"workflow-preview-supported":4,"inspect-plan-supported":2,"cataloged-local-only":4} |
| credits | 4 | {"read":4} | {"inspect-plan-supported":3,"cataloged-local-only":1} |
| custom-fields | 5 | {"write":4,"read":1} | {"cataloged-local-only":5} |
| customers | 7 | {"read":2,"write":5} | {"inspect-plan-supported":1,"local-read-plan-supported":1,"workflow-preview-supported":2,"cataloged-local-only":3} |
| invoices | 6 | {"preview":1,"read":3,"write":2} | {"workflow-preview-supported":1,"inspect-plan-supported":2,"cataloged-local-only":3} |
| packages | 5 | {"write":2,"read":3} | {"workflow-preview-supported":2,"inspect-plan-supported":2,"cataloged-local-only":1} |
| payments | 3 | {"read":1,"write":2} | {"cataloged-local-only":3} |
| products | 5 | {"read":2,"write":3} | {"inspect-plan-supported":1,"cataloged-local-only":1,"workflow-preview-supported":3} |
| rate-cards | 9 | {"write":5,"read":4} | {"workflow-preview-supported":5,"cataloged-local-only":3,"inspect-plan-supported":1} |
| security | 2 | {"read":2} | {"cataloged-local-only":2} |
| settings | 1 | {"read":1} | {"cataloged-local-only":1} |
| usage | 4 | {"write":1,"read":3} | {"workflow-preview-supported":1,"cataloged-local-only":3} |


## writeProofLadder

| order | id | readinessField | command | proves | unlocks | apiAccess | liveExecutionEnabledInCurrentCli |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | request-validation | requestValidator | metro api validate <endpoint-id> --file <request.json\|yaml> [--json] | Request body, path parameters, query placement, tenant-independent endpoint shape, and secret-free input are locally valid for the reviewed endpoint ID. | local-api-preview | none | false |
| 2 | local-api-preview | localPreview | metro api preview <endpoint-id> --file <request.json\|yaml> (--sandbox\|--prod) [--json] | The reviewed request can be normalized into a deterministic local preview with request hash, payload hash, permission scope, side-effect profile, and no live execution. | api-preflight | none | false |
| 3 | api-preflight | apiPreflight | metro api preflight template --preview <api-preview.json> [--profile-resolution <profile-resolution.json>] [--approval-id <id>] [--json] | The preview has reviewed tenant/profile binding, idempotency, audit destination, read-back plan, rollback or remediation planning, and required approval context. | api-sandbox-proof | none | false |
| 4 | api-sandbox-proof | apiSandboxProof | metro api sandbox-proof template --preview <api-preview.json> --preflight <api-preflight.json> [--reviewed-by <reviewer>] [--owner <owner>] [--json] | Sandbox canary, read-back, invoice behavior, rollback, and remediation evidence can be bound to the exact preview request hash before any production gate. | api-apply-gate | none | false |
| 5 | api-apply-gate | apiApplyGate | metro api apply-gate template --preview <api-preview.json> --preflight <api-preflight.json> [--sandbox-proof <sandbox-proof.json>] [--profile-resolution <profile-resolution.json>] [--json] | Reviewed preview, preflight, sandbox proof, tenant profile, key fingerprint, audit destination, read-back plan, rollback or remediation plan, and idempotency review are hash-bound. | api-approval-record | none | false |
| 6 | api-approval-record | apiApprovalRecord | metro api approval-record template --apply-gate <api-apply-gate.json> [--approval-id <id>] [--requested-by <id>] [--approved-by <name>] [--owner <owner>] [--business-purpose <text>] [--expires-at <ISO>] [--json] | A durable approval record can bind owner approval to the validated apply gate while still requiring exact current-turn authorization for any future live execution. | api-apply-audit | none | false |
| 7 | api-apply-audit | apiApplyAudit | metro api apply-audit write --approval-record <api-approval-record.json> --out <api-apply-audit.jsonl> --actor <id> (--dry-run\|--write) [--timestamp <ISO>] [--json] | A planned audit row can bind approval, tenant profile, request hash, payload hash, rollback, read-back, and idempotency evidence without capturing reusable live authorization. | api-apply-readback | none | false |
| 8 | api-apply-readback | apiApplyReadback | metro api apply-readback verify --apply-audit <api-apply-audit.jsonl> --read-result <api-read-result.json> [--row <n>] [--json] | Read-back evidence is compatible with the planned write endpoint, tenant, and audit row before any apply-result record claims semantic success. | api-apply-result | none | false |
| 9 | api-apply-result | apiApplyResult | metro api apply-result template --apply-audit <api-apply-audit.jsonl> --apply-readback <api-apply-readback.json> [--row <n>] [--json] | A future guarded runner result can record current-turn authorization capture, response hash, response object IDs, live audit row hash, semantic read-back success, rollback/remediation, idempotency review, and secret-free evidence. | future-guarded-apply-runner-only | none | false |


## Agent notes

- Prefer `--json` when scripting parsers; use `--markdown` when loading context into an agent.
- Never treat HTML as the source of truth — regenerate from `metro docs <ref> --markdown`.
- Live reads/writes still require tenant flags + confirmation tokens.

