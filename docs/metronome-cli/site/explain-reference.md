# explain.index
- schemaVersion: `metro.docs.explain.index.v1`
- apiAccess: `none`
- nextSafeStep: Run metro docs explain <topic> --json for a single topic, or use explicit prefixes such as command:, shape:, gotcha:, rule:, scope:, policy:, and example: to avoid ambiguous IDs. This index does not authorize live reads or writes.
## Summary

```json
{
  "operatingTopicCount": 14,
  "lookupKindCount": 8,
  "genericExplainableCount": 425,
  "liveApiAccess": "none"
}
```

## Operating topics (agent decision trees)

| id | status | apiAccess | summary | explain |
| --- | --- | --- | --- | --- |
| first-safe-preview | local-install-backed | none | Give a new authorized teammate or internal agent one terminal-native path to prove installability, command discovery, profile shape, local validation, and sandbox-labeled preview without live API access. | metro docs explain first-safe-preview --json |
| install.troubleshooting | local-install-backed | none | Use this topic when npm packaging, global installation, or the installed metro binary fails: prove the package manifest, runtime file allowlist, executable bin, temporary-prefix install, and local-only smoke command before moving to setup profiles or safe preview work. | metro docs explain install.troubleshooting --json |
| package.publish-readiness | blocked-open-questions | none | Use this topic before treating the local tarball install path as an internal npm release: current proof covers npm pack contents and a temporary-prefix metro install, while registry publishing, release provenance, approval ownership, and signing or equivalent integrity evidence remain explicit blockers. | metro docs explain package.publish-readiness --json |
| ci.local-checks | local-proof-backed | none | Use this topic when wiring metro into CI or agent automation: run package, install, unit, golden, site, syntax, and secret-scan checks that need no API keys, then parse metro JSON contracts instead of scraping prose. | metro docs explain ci.local-checks --json |
| setup.troubleshooting | local-proof-backed | none | Use this topic when the first safe preview path, local profile doctor, or profile resolution fails: keep setup local-only, inspect schemaVersion and findings, fix the profile file or non-secret fingerprint, then rerun setup doctor and setup resolve before using profile evidence in read-gate or preflight manifests. | metro docs explain setup.troubleshooting --json |
| input.normalize | local-proof-backed | none | Use metro input normalize to turn local JSON/YAML workflow shape inputs and reviewed expert API request envelopes into stable canonical JSON, validation findings, and deterministic hashes before preview, proof, or future apply work. | metro docs explain input.normalize --json |
| output.anatomy | local-proof-backed | none | Use this topic to read metro JSON output consistently: identify the schema version first, check live-execution flags and API access, inspect status/refusal fields, then follow generatedFrom, sourceIds, sources, payload hashes, and nextSafeStep before using the output as local evidence. | metro docs explain output.anatomy --json |
| refusal.troubleshooting | local-proof-backed | none | Use this topic when metro refuses a live read, live apply, unsupported workflow apply, or unsafe input: keep the refusal as a safety signal, identify the schema and blocked command, then gather the local preview, preflight, gate, audit, read-back, and approval evidence named by nextSafeStep before retrying any narrower local command. | metro docs explain refusal.troubleshooting --json |
| billing-provider.attachment | local-preview-backed | none | Use the local Stripe billing-provider attachment shape to validate delivery method scope, existing configuration policy, Stripe draft behavior, and read-back evidence before any future customer billing-provider write is considered. | metro docs explain billing-provider.attachment --json |
| customer.setup | local-preview-backed | none | Use the local customer-setup shape to validate customer identity, ingest alias collision review, optional Stripe billing-provider configuration, customer configuration, read-back checks, and rollback planning before any customer create workflow is considered. | metro docs explain customer.setup --json |
| credits.product.decision | local-preview-backed | none | When someone says "add a credits product", stop and classify before creating Metronome objects. Most asks are (A) a new pricing dimension on an existing USAGE product, (B) a credit grant on an existing contract, (C) credits inside a package commit schedule, or rarely (D) a greenfield USAGE product + billable metric. Do not create products or billable metrics for new action codes. | metro docs explain credits.product.decision --json |
| workspace.routing | local-preview-backed | none | Use metro workspace explain, metro plan <intent>, and metro route --goal to pick optimal shapes, refuse suboptimal API paths (e.g. products.create for a new action code), and bind sandbox/production via tenant profiles. For ambiguous "credits product" asks start with metro docs explain credits.product.decision --markdown. | metro docs explain workspace.routing --json |
| contract-overrides.inspection | local-proof-backed | none | Use contracts.getRateSchedule for customer-specific contract prices that must include contract-level overrides; use rateCards.getRates for rate-card source prices before customer contract overrides. | metro docs explain contract-overrides.inspection --json |
| product-rate-retirement.readback | local-proof-backed | none | Use rateCards.addRates only as a reviewed future write for closing rates; verify product retirement with rateCards.getRates, rateCards.getRateSchedule, products.get, and invoice-impact evidence before any product archive is considered. | metro docs explain product-rate-retirement.readback --json |


## Lookup kinds

| kind | count | description | examples |
| --- | --- | --- | --- |
| api-endpoint | 69 | Reviewed Metronome endpoint IDs from the local expert API catalog. | usage.ingest, usage.groups, usage.batch, events.search |
| api-family | 14 | Endpoint-family summaries derived from the reviewed API catalog. | billable-metrics, billing-provider, contracts, credits |
| command | 166 | Supported local command metadata from the command catalog. | command:input.normalize, command:docs.explain, command:api.read-plan |
| shape | 16 | Workflow shape summaries and validator links from the shape catalog. | shape:customer-setup, shape:pro-annual, shape:pro-annual-self-serve-v2, shape:free-credit-trial |
| validator-rule | 68 | Validator rules, severities, and remediation guidance. | MTR-TENANT-001, MTR-TENANT-002, MTR-TENANT-003, MTR-TENANT-004 |
| gotcha | 59 | Known failure modes from the gotcha register. | gotcha:tenant-selected-by-key, gotcha:env-file-not-authorization, gotcha:never-infer-production-from-key-presence, gotcha:fingerprints-not-key-values |
| permission-scope | 25 | Permission scopes and owner/approval policy requirements. | metronome:billable-metrics:read, metronome:billable-metrics:write, metronome:billing-provider:read, metronome:billing-provider:write |
| example-fixture | 8 | Checked command/output fixtures used as local proof examples. | example:api.catalog.contracts, example:api.explain.contracts-create, example:api.search.contract-create, example:api.diff.contracts-create-vs-update-end-date |


## sourceIds

- `credits-product-decision`
- `danger-zone`
- `endpoint-matrix`
- `example:api.catalog.contracts`
- `example:api.explain.contracts-create`
- `example:api.preflight.contracts-create`
- `example:api.preview.contracts-create`
- `example:api.readiness`
- `local-probe-prod-all-rates`
- `metro-api-preview-golden`
- `metro-api-read-audit-products-get-fixture`
- `metro-api-read-audit-products-get-golden`
- `metro-api-read-audit-rate-cards-get-rates-fixture`
- `metro-api-read-audit-rate-cards-get-rates-golden`
- `metro-api-read-mock-contracts-rate-schedule-golden`
- `metro-api-read-mock-rate-cards-get-rates-golden`
- `metro-api-read-pipeline-contracts-rate-schedule-golden`
- `metro-api-read-pipeline-golden`
- `metro-api-read-pipeline-products-get-golden`
- `metro-api-read-pipeline-rate-card-schedule-golden`
- `metro-api-read-pipeline-rate-cards-get-rates-golden`
- `metro-api-read-plan-golden-contracts-rate-schedule`
- `metro-api-read-plan-golden-products-get`
- `metro-api-read-plan-golden-rate-card-schedule`
- `metro-api-read-plan-golden-rate-cards-get-rates`
- `metro-api-read-refusal-golden`
- `metro-api-readiness-golden`
- `metro-api-readiness-summary-golden`
- `metro-billing-provider-attach-fixture`
- `metro-billing-provider-inspect-plan-golden`
- `metro-billing-provider-preview-golden`
- `metro-command-catalog`
- `metro-command-reference-golden`
- `metro-customer-setup-fixtures`
- `metro-customer-setup-preview-golden`
- `metro-docs-explain-billing-provider-attachment-golden`
- `metro-docs-explain-ci-local-checks-golden`
- `metro-docs-explain-customer-setup-golden`
- `metro-docs-explain-first-safe-preview-golden`
- `metro-docs-explain-input-normalize-golden`
- `metro-docs-explain-install-troubleshooting-golden`
- `metro-docs-explain-output-anatomy-golden`
- `metro-docs-explain-package-publish-readiness-golden`
- `metro-docs-explain-product-rate-retirement-readback-golden`
- `metro-docs-explain-refusal-troubleshooting-golden`
- `metro-docs-explain-setup-troubleshooting-golden`
- `metro-docs-explain-topic-index-golden`
- `metro-input-files`
- `metro-input-normalize`
- `metro-input-normalize-api-golden`
- `metro-input-normalize-shape-golden`
- `metro-input-reference`
- `metro-input-reference-golden`
- `metro-install-test`
- `metro-package-test`
- `metro-product-retirement-preview-golden`
- `metro-release-artifact-manifest-golden`
- `metro-release-evidence-check-golden`
- `metro-release-evidence-plan-golden`
- `metro-release-readiness-golden`
- `metro-release-retention-policy-golden`
- `metro-safe-preview-quickstart`
- `metro-setup-fixtures`
- `metro-setup-profiles`
- `metro-setup-quickstart`
- `metro-setup-resolve-golden`
- `metro-workspace-routing`
- `metronome-customers-hierarchies`
- `metronome-stripe-delivery`
- `official-billing-provider`
- `official-billing-provider-get`
- `official-contract-get-rate-schedule`
- `official-customer-create`
- `official-customer-get`
- `official-customer-list`
- `official-customer-update-config`
- `official-invoice-list`
- `official-list-configured-billing-providers`
- `official-product-archive`
- `official-product-get`
- `official-rate-card-add-rates`
- `official-rate-card-get-rate-schedule`
- `official-rate-card-get-rates`
- `packages-contracts`
- `rate-cards-dimensional`
- `shape-complimentary-credit-grant`
- `shape-dimensional-rate-card`


## sources

- `.cursor/skills/metronome-customers-hierarchies/SKILL.md`
- `.cursor/skills/metronome-danger-zone/SKILL.md`
- `.cursor/skills/metronome-danger-zone/references/endpoint-matrix.md`
- `.cursor/skills/metronome-danger-zone/references/endpoint-matrix.md#11-invoices`
- `.cursor/skills/metronome-danger-zone/references/endpoint-matrix.md#15-settings--security`
- `.cursor/skills/metronome-danger-zone/references/endpoint-matrix.md#3-products`
- `.cursor/skills/metronome-danger-zone/references/endpoint-matrix.md#4-rate-cards`
- `.cursor/skills/metronome-danger-zone/references/endpoint-matrix.md#6-customers`
- `.cursor/skills/metronome-danger-zone/references/endpoint-matrix.md#7-billing-provider-configs-stripe`
- `.cursor/skills/metronome-danger-zone/references/endpoint-matrix.md#9-contracts`
- `.cursor/skills/metronome-packages-contracts/SKILL.md`
- `.cursor/skills/metronome-stripe-delivery/SKILL.md`
- `docs/API_OPERATIONS.md`
- `docs/SAFETY.md`
- `docs/SOURCE_BASELINE.md`
- `docs/metronome-cli/CLI_ARCHITECTURE.md`
- `docs/metronome-cli/COOKBOOK.md`
- `docs/metronome-cli/GOTCHAS.md`
- `docs/metronome-cli/QUICKSTART.md`
- `docs/metronome-cli/README.md`
- `docs/metronome-cli/SHAPE_CATALOG.md`
- `docs/metronome-cli/SHAPE_CATALOG.md#product-or-rate-retirement`
- `docs/metronome-cli/VALIDATION_AND_GUARDRAILS.md`
- `docs/metronome-cli/VALIDATION_AND_GUARDRAILS.md#rate-card-rules`
- `docs/metronome-cli/one-goal.md`
- `docs/metronome-cli/site/agents.md`
- `docs/metronome-cli/site/install.html`
- `docs/metronome-cli/site/install.html#first-safe-preview`
- `docs/metronome-cli/site/integration.html`
- `docs/metronome-cli/site/verify-site.js`
- `https://docs.metronome.com/api-reference/billable-metrics/create-a-billable-metric.md`
- `https://docs.metronome.com/api-reference/contracts/get-the-rate-schedule-for-a-contract.md`
- `https://docs.metronome.com/api-reference/customers/create-a-customer.md`
- `https://docs.metronome.com/api-reference/customers/fetch-billing-provider-configurations-for-a-customer.md`
- `https://docs.metronome.com/api-reference/customers/get-a-customer.md`
- `https://docs.metronome.com/api-reference/customers/list-customers.md`
- `https://docs.metronome.com/api-reference/customers/set-billing-provider-configurations-for-a-customer.md`
- `https://docs.metronome.com/api-reference/customers/update-a-customer-configuration.md`
- `https://docs.metronome.com/api-reference/invoices/list-invoices.md`
- `https://docs.metronome.com/api-reference/products/archive-a-product.md`
- `https://docs.metronome.com/api-reference/products/create-a-product.md`
- `https://docs.metronome.com/api-reference/products/get-a-product.md`
- `https://docs.metronome.com/api-reference/rate-cards/add-rates.md`
- `https://docs.metronome.com/api-reference/rate-cards/get-a-rate-schedule.md`
- `https://docs.metronome.com/api-reference/rate-cards/get-rates.md`
- `https://docs.metronome.com/api-reference/settings/list-account-level-billing-providers.md`
- `metronome-cli/package.json`
- `metronome-cli/src/api-catalog/preview.js`
- `metronome-cli/src/api-catalog/read-pipeline.js`
- `metronome-cli/src/api-catalog/read-refusal.js`
- `metronome-cli/src/api-catalog/readiness.js`
- `metronome-cli/src/api-catalog/validation.js`
- `metronome-cli/src/apply-gate/index.js`
- `metronome-cli/src/audit/index.js`
- `metronome-cli/src/commands/catalog.js`
- `metronome-cli/src/docs/explain.js`
- `metronome-cli/src/docs/input-reference.js`
- `metronome-cli/src/input/files.js`
- `metronome-cli/src/input/normalize.js`
- `metronome-cli/src/inspect/index.js`
- `metronome-cli/src/preflight/index.js`
- `metronome-cli/src/preview/index.js`
- `metronome-cli/src/proof/sandbox-manifest.js`
- `metronome-cli/src/release/readiness.js`
- `metronome-cli/src/setup/profiles.js`
- `metronome-cli/src/shapes/index.js`
- `metronome-cli/src/validators/index.js`
- `metronome-cli/test/fixtures/api-contracts-rate-schedule-mock-response.json`
- `metronome-cli/test/fixtures/api-contracts-rate-schedule-valid.json`
- `metronome-cli/test/fixtures/api-read-audit-products-get-valid.jsonl`
- `metronome-cli/test/fixtures/customer-setup-valid.json`
- `metronome-cli/test/fixtures/product-rate-retirement-valid.json`
- `metronome-cli/test/fixtures/setup/profiles-invalid-secret.json`
- `metronome-cli/test/fixtures/setup/profiles-valid.json`
- `metronome-cli/test/fixtures/stripe-billing-provider-valid.json`
- `metronome-cli/test/golden.test.js`
- `metronome-cli/test/golden/api/catalog.contracts.json`
- `metronome-cli/test/golden/api/explain.contracts-create.json`
- `metronome-cli/test/golden/api/preflight.contracts-create.template.json`
- `metronome-cli/test/golden/api/preview.contracts-create.sandbox.json`
- `metronome-cli/test/golden/api/read-pipeline.contracts-get.dry-run.sandbox.json`
- `metronome-cli/test/golden/api/read-pipeline.contracts-rate-schedule.dry-run.sandbox.json`
- `metronome-cli/test/golden/api/read-pipeline.rate-cards-get-rates.dry-run.sandbox.json`
- `metronome-cli/test/golden/api/read.refusal.contracts-get-v2.sandbox.json`
- `metronome-cli/test/golden/api/readiness-summary.json`
- `metronome-cli/test/golden/api/readiness.json`
- `metronome-cli/test/golden/customer-setup-preview.sandbox.json`
- `metronome-cli/test/golden/docs/command-reference.json`
- `metronome-cli/test/golden/docs/explain.billing-provider-attachment.json`
- `metronome-cli/test/golden/docs/explain.customer-setup.json`
- `metronome-cli/test/golden/docs/explain.first-safe-preview.json`
- `metronome-cli/test/golden/docs/explain.output-anatomy.json`
- `metronome-cli/test/golden/docs/input-reference.json`
- `metronome-cli/test/golden/input/normalize.api-contracts-create-yaml.json`
- `metronome-cli/test/golden/input/normalize.pro-annual-yaml.json`
- `metronome-cli/test/golden/inspect/billing-provider.plan.production.json`
- `metronome-cli/test/golden/product-rate-retirement-preview.sandbox.json`
- `metronome-cli/test/golden/proof/package-archive.package-alias-archive-handoff.sandbox-template.json`
- `metronome-cli/test/golden/release/evidence-check.valid.json`
- `metronome-cli/test/golden/release/retention-policy.template.json`
- `metronome-cli/test/golden/release/retention-policy.validation.valid.json`
- `metronome-cli/test/golden/setup/quickstart.json`
- `metronome-cli/test/golden/setup/resolve.metro-sandbox.json`
- `metronome-cli/test/golden/setup/template.json`
- `metronome-cli/test/golden/stripe-billing-provider-attachment-preview.sandbox.json`
- `metronome-cli/test/install.test.js`
- `metronome-cli/test/package.test.js`
- `metronome/probe-prod-all-rates.js`


## Agent notes

- Prefer `--json` when scripting parsers; use `--markdown` when loading context into an agent.
- Never treat HTML as the source of truth, regenerate from `metro docs <ref> --markdown`.
- Live reads/writes still require tenant flags + confirmation tokens.

