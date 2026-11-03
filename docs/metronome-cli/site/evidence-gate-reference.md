# evidence-gate-reference
- schemaVersion: `metro.docs.evidence-gate-reference.v1`
- apiAccess: `none`
## Summary

```json
{
  "shapesWithWorkflowMapping": 14,
  "fullLocalTemplatePath": 14,
  "preflightOnly": 0,
  "notCovered": 0
}
```

## sourceModules

- `packages/metro-core/src/shapes/index.js`
- `packages/metro-core/src/preflight/index.js`
- `packages/metro-core/src/audit/index.js`
- `packages/metro-core/src/proof/sandbox-manifest.js`
- `packages/metro-core/src/apply-gate/index.js`


## gates

| workflow | shape | title | family | maturity | status | fullPathAvailable | localOnly |
| --- | --- | --- | --- | --- | --- | --- | --- |
| customer.setup | customer-setup | Customer Setup Preview | customer | local-validated | full-local-template-path | true | true |
| package.apply | pro-annual | Pro Annual Package | package | local-validated | full-local-template-path | true | true |
| credit.apply | complimentary-credit-grant | Complimentary Credit Grant | credit | local-validated | full-local-template-path | true | true |
| credit.apply | paid-credit-top-up | Paid Credit Top-Up | credit | local-validated | full-local-template-path | true | true |
| package.archive | package-alias-archive-handoff | Package Alias Archive Handoff | package | local-validated | full-local-template-path | true | true |
| billing-provider.attach | stripe-billing-provider-attachment | Stripe Billing Provider Attachment | billing-provider | local-validated | full-local-template-path | true | true |
| contract.move-plan.apply | package-plan-move-no-immediate-invoice | Package Plan Move Without Immediate Invoice | contract | local-validated | full-local-template-path | true | true |
| contract.move-plan.apply | package-plan-move-immediate-invoice | Package Plan Move With Immediate Plan Fee | contract | local-validated | full-local-template-path | true | true |
| product.rate-retirement | product-rate-retirement | Product Rate Retirement | product | local-validated | full-local-template-path | true | true |
| rate-card.dimensional.apply | dimensional-rate-card | Dimensional Rate-Card Preview | rate-card | local-validated | full-local-template-path | true | true |
| invoice.issue-date-update | invoice-issue-date-update | Draft Invoice Issue-Date Update | invoice | local-validated | full-local-template-path | true | true |
| subscription.contract.apply | direct-subscription-contract | Direct Subscription Contract | subscription | local-validated | full-local-template-path | true | true |
| usage.ingest-preview | usage-ingest-preview | Usage Ingest Preview Plan | usage | local-validated | full-local-template-path | true | true |
| custom-contract.create | enterprise-custom-contract | Enterprise Custom Contract | custom-contract | local-validated | full-local-template-path | true | true |


## Agent notes

- Prefer `--json` when scripting parsers; use `--markdown` when loading context into an agent.
- Never treat HTML as the source of truth, regenerate from `metro docs <ref> --markdown`.
- Live reads/writes still require tenant flags + confirmation tokens.

