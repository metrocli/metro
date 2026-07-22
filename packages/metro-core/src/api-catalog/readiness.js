'use strict';

const { apiCatalog } = require('./index');
const { apiApplyGateCoverage, apiSandboxProofCoverage } = require('./apply-gate');
const { apiApplyAuditCoverage } = require('./apply-audit');
const { apiApplyResultCoverage } = require('./apply-result');
const { apiApplyReadbackCoverage } = require('./apply-readback');
const { apiApprovalRecordCoverage } = require('./approval-record');
const { apiPreflightCoverage } = require('./preflight');
const { apiPreviewCoverage } = require('./preview');
const { apiReadPlanCoverage } = require('./read-plan');
const { apiRequestValidationCoverage } = require('./validation');
const {
  isLiveApplySandboxEndpoint,
  isLiveReadEndpoint,
  LIVE_APPLY_SANDBOX_ENDPOINT_IDS,
  LIVE_READ_ENDPOINT_IDS,
} = require('../clients/live-endpoints');

const API_READINESS_SCHEMA_VERSION = 'metro.api.readiness.v1';
const API_READINESS_SUMMARY_SCHEMA_VERSION = 'metro.api.readiness.summary.v1';

const WRITE_PROOF_LADDER = [
  {
    order: 1,
    id: 'request-validation',
    readinessField: 'requestValidator',
    command: 'metro api validate <endpoint-id> --file <request.json|yaml> [--json]',
    proves: 'Request body, path parameters, query placement, tenant-independent endpoint shape, and secret-free input are locally valid for the reviewed endpoint ID.',
    unlocks: 'local-api-preview',
  },
  {
    order: 2,
    id: 'local-api-preview',
    readinessField: 'localPreview',
    command: 'metro api preview <endpoint-id> --file <request.json|yaml> (--sandbox|--prod) [--json]',
    proves: 'The reviewed request can be normalized into a deterministic local preview with request hash, payload hash, permission scope, side-effect profile, and no live execution.',
    unlocks: 'api-preflight',
  },
  {
    order: 3,
    id: 'api-preflight',
    readinessField: 'apiPreflight',
    command: 'metro api preflight template --preview <api-preview.json> [--profile-resolution <profile-resolution.json>] [--approval-id <id>] [--json]',
    validationCommand: 'metro api preflight validate --file <api-preflight.json> [--json]',
    proves: 'The preview has reviewed tenant/profile binding, idempotency, audit destination, read-back plan, rollback or remediation planning, and required approval context.',
    unlocks: 'api-sandbox-proof',
  },
  {
    order: 4,
    id: 'api-sandbox-proof',
    readinessField: 'apiSandboxProof',
    command: 'metro api sandbox-proof template --preview <api-preview.json> --preflight <api-preflight.json> [--reviewed-by <reviewer>] [--owner <owner>] [--json]',
    validationCommand: 'metro api sandbox-proof validate --file <api-sandbox-proof.json> [--json]',
    proves: 'Sandbox canary, read-back, invoice behavior, rollback, and remediation evidence can be bound to the exact preview request hash before any production gate.',
    unlocks: 'api-apply-gate',
  },
  {
    order: 5,
    id: 'api-apply-gate',
    readinessField: 'apiApplyGate',
    command: 'metro api apply-gate template --preview <api-preview.json> --preflight <api-preflight.json> [--sandbox-proof <sandbox-proof.json>] [--profile-resolution <profile-resolution.json>] [--json]',
    validationCommand: 'metro api apply-gate validate --file <api-apply-gate.json> [--json]',
    proves: 'Reviewed preview, preflight, sandbox proof, tenant profile, key fingerprint, audit destination, read-back plan, rollback or remediation plan, and idempotency review are hash-bound.',
    unlocks: 'api-approval-record',
  },
  {
    order: 6,
    id: 'api-approval-record',
    readinessField: 'apiApprovalRecord',
    command: 'metro api approval-record template --apply-gate <api-apply-gate.json> [--approval-id <id>] [--requested-by <id>] [--approved-by <name>] [--owner <owner>] [--business-purpose <text>] [--expires-at <ISO>] [--json]',
    validationCommand: 'metro api approval-record validate --file <api-approval-record.json> [--json]',
    proves: 'A durable approval record can bind owner approval to the validated apply gate while still requiring exact current-turn authorization for any future live execution.',
    unlocks: 'api-apply-audit',
  },
  {
    order: 7,
    id: 'api-apply-audit',
    readinessField: 'apiApplyAudit',
    command: 'metro api apply-audit write --approval-record <api-approval-record.json> --out <api-apply-audit.jsonl> --actor <id> (--dry-run|--write) [--timestamp <ISO>] [--json]',
    validationCommand: 'metro api apply-audit validate --file <api-apply-audit.jsonl> [--json]',
    proves: 'A planned audit row can bind approval, tenant profile, request hash, payload hash, rollback, read-back, and idempotency evidence without capturing reusable live authorization.',
    unlocks: 'api-apply-readback',
  },
  {
    order: 8,
    id: 'api-apply-readback',
    readinessField: 'apiApplyReadback',
    command: 'metro api apply-readback verify --apply-audit <api-apply-audit.jsonl> --read-result <api-read-result.json> [--row <n>] [--json]',
    proves: 'Read-back evidence is compatible with the planned write endpoint, tenant, and audit row before any apply-result record claims semantic success.',
    unlocks: 'api-apply-result',
  },
  {
    order: 9,
    id: 'api-apply-result',
    readinessField: 'apiApplyResult',
    command: 'metro api apply-result template --apply-audit <api-apply-audit.jsonl> --apply-readback <api-apply-readback.json> [--row <n>] [--json]',
    validationCommand: 'metro api apply-result validate --file <api-apply-result.json> --apply-audit <api-apply-audit.jsonl> --apply-readback <api-apply-readback.json> [--row <n>] [--json]',
    proves: 'A future guarded runner result can record current-turn authorization capture, response hash, response object IDs, live audit row hash, semantic read-back success, rollback/remediation, idempotency review, and secret-free evidence.',
    unlocks: 'future-guarded-apply-runner-only',
  },
];

const READ_PLAN_GOLDEN_EXAMPLES = [
  {
    endpointId: 'events.search',
    coverageType: 'post-body',
    result: 'successful',
    tenant: 'sandbox',
    fixturePath: 'metronome-cli/test/fixtures/api-events-search-valid.json',
    goldenPath: 'metronome-cli/test/golden/api/read-plan.events-search.sandbox.json',
    command: 'metro api read-plan events.search --file metronome-cli/test/fixtures/api-events-search-valid.json --sandbox --json',
  },
  {
    endpointId: 'billableMetrics.get',
    coverageType: 'get-path-billable-metric',
    result: 'successful',
    tenant: 'sandbox',
    fixturePath: 'metronome-cli/test/fixtures/api-billable-metrics-get-valid.json',
    goldenPath: 'metronome-cli/test/golden/api/read-plan.billable-metrics-get.sandbox.json',
    command: 'metro api read-plan billableMetrics.get --file metronome-cli/test/fixtures/api-billable-metrics-get-valid.json --sandbox --json',
  },
  {
    endpointId: 'billableMetrics.list',
    coverageType: 'get-query-billable-metrics-list',
    result: 'successful',
    tenant: 'sandbox',
    fixturePath: 'metronome-cli/test/fixtures/api-billable-metrics-list-valid.json',
    goldenPath: 'metronome-cli/test/golden/api/read-plan.billable-metrics-list.sandbox.json',
    command: 'metro api read-plan billableMetrics.list --file metronome-cli/test/fixtures/api-billable-metrics-list-valid.json --sandbox --json',
  },
  {
    endpointId: 'contracts.get.v2',
    coverageType: 'post-body',
    result: 'successful',
    tenant: 'sandbox',
    fixturePath: 'metronome-cli/test/fixtures/api-contracts-get-valid.json',
    goldenPath: 'metronome-cli/test/golden/api/read-plan.contracts-get-v2.sandbox.json',
    command: 'metro api read-plan contracts.get.v2 --file metronome-cli/test/fixtures/api-contracts-get-valid.json --sandbox --json',
  },
  {
    endpointId: 'contracts.list.v2',
    coverageType: 'post-body-list',
    result: 'successful',
    tenant: 'sandbox',
    fixturePath: 'metronome-cli/test/fixtures/api-contracts-list-v2-valid.json',
    goldenPath: 'metronome-cli/test/golden/api/read-plan.contracts-list-v2.sandbox.json',
    command: 'metro api read-plan contracts.list.v2 --file metronome-cli/test/fixtures/api-contracts-list-v2-valid.json --sandbox --json',
  },
  {
    endpointId: 'contracts.getRateSchedule',
    coverageType: 'contract-post-body-rate-schedule-query',
    result: 'successful',
    tenant: 'sandbox',
    fixturePath: 'metronome-cli/test/fixtures/api-contracts-rate-schedule-valid.json',
    goldenPath: 'metronome-cli/test/golden/api/read-plan.contracts-rate-schedule.sandbox.json',
    command: 'metro api read-plan contracts.getRateSchedule --file metronome-cli/test/fixtures/api-contracts-rate-schedule-valid.json --sandbox --json',
  },
  {
    endpointId: 'contracts.getEditHistory',
    coverageType: 'post-body-contract-edit-history',
    result: 'successful',
    tenant: 'sandbox',
    fixturePath: 'metronome-cli/test/fixtures/api-contract-edit-history-valid.json',
    goldenPath: 'metronome-cli/test/golden/api/read-plan.contract-edit-history.sandbox.json',
    command: 'metro api read-plan contracts.getEditHistory --file metronome-cli/test/fixtures/api-contract-edit-history-valid.json --sandbox --json',
  },
  {
    endpointId: 'contracts.getSubscriptionQuantityHistory',
    coverageType: 'post-body-subscription-quantity-history',
    result: 'successful',
    tenant: 'sandbox',
    fixturePath: 'metronome-cli/test/fixtures/api-subscription-quantity-history-valid.json',
    goldenPath: 'metronome-cli/test/golden/api/read-plan.subscription-quantity-history.sandbox.json',
    command: 'metro api read-plan contracts.getSubscriptionQuantityHistory --file metronome-cli/test/fixtures/api-subscription-quantity-history-valid.json --sandbox --json',
  },
  {
    endpointId: 'contracts.getSubscriptionSeatsHistory',
    coverageType: 'post-body-subscription-seats-history',
    result: 'successful',
    tenant: 'sandbox',
    fixturePath: 'metronome-cli/test/fixtures/api-subscription-seats-history-valid.json',
    goldenPath: 'metronome-cli/test/golden/api/read-plan.subscription-seats-history.sandbox.json',
    command: 'metro api read-plan contracts.getSubscriptionSeatsHistory --file metronome-cli/test/fixtures/api-subscription-seats-history-valid.json --sandbox --json',
  },
  {
    endpointId: 'customerBalances.list',
    coverageType: 'post-body-balances',
    result: 'successful',
    tenant: 'sandbox',
    fixturePath: 'metronome-cli/test/fixtures/api-customer-balances-list-valid.json',
    goldenPath: 'metronome-cli/test/golden/api/read-plan.customer-balances-list.sandbox.json',
    command: 'metro api read-plan customerBalances.list --file metronome-cli/test/fixtures/api-customer-balances-list-valid.json --sandbox --json',
  },
  {
    endpointId: 'seatBalances.list',
    coverageType: 'post-body-seat-balances',
    result: 'successful',
    tenant: 'sandbox',
    fixturePath: 'metronome-cli/test/fixtures/api-seat-balances-list-valid.json',
    goldenPath: 'metronome-cli/test/golden/api/read-plan.seat-balances-list.sandbox.json',
    command: 'metro api read-plan seatBalances.list --file metronome-cli/test/fixtures/api-seat-balances-list-valid.json --sandbox --json',
  },
  {
    endpointId: 'commits.list',
    coverageType: 'post-body-commits',
    result: 'successful',
    tenant: 'sandbox',
    fixturePath: 'metronome-cli/test/fixtures/api-commits-list-valid.json',
    goldenPath: 'metronome-cli/test/golden/api/read-plan.commits-list.sandbox.json',
    command: 'metro api read-plan commits.list --file metronome-cli/test/fixtures/api-commits-list-valid.json --sandbox --json',
  },
  {
    endpointId: 'credits.list',
    coverageType: 'post-body-credits',
    result: 'successful',
    tenant: 'sandbox',
    fixturePath: 'metronome-cli/test/fixtures/api-credits-list-valid.json',
    goldenPath: 'metronome-cli/test/golden/api/read-plan.credits-list.sandbox.json',
    command: 'metro api read-plan credits.list --file metronome-cli/test/fixtures/api-credits-list-valid.json --sandbox --json',
  },
  {
    endpointId: 'packages.get',
    coverageType: 'post-body',
    result: 'successful',
    tenant: 'sandbox',
    fixturePath: 'metronome-cli/test/fixtures/api-packages-get-valid.json',
    goldenPath: 'metronome-cli/test/golden/api/read-plan.packages-get.sandbox.json',
    command: 'metro api read-plan packages.get --file metronome-cli/test/fixtures/api-packages-get-valid.json --sandbox --json',
  },
  {
    endpointId: 'packages.list',
    coverageType: 'post-query',
    result: 'successful',
    tenant: 'sandbox',
    fixturePath: 'metronome-cli/test/fixtures/api-packages-list-valid.json',
    goldenPath: 'metronome-cli/test/golden/api/read-plan.packages-list.sandbox.json',
    command: 'metro api read-plan packages.list --file metronome-cli/test/fixtures/api-packages-list-valid.json --sandbox --json',
  },
  {
    endpointId: 'packages.listContractsOnPackage',
    coverageType: 'post-body-package-contracts-query',
    result: 'successful',
    tenant: 'sandbox',
    fixturePath: 'metronome-cli/test/fixtures/api-packages-list-contracts-on-package-valid.json',
    goldenPath: 'metronome-cli/test/golden/api/read-plan.packages-list-contracts-on-package.sandbox.json',
    command: 'metro api read-plan packages.listContractsOnPackage --file metronome-cli/test/fixtures/api-packages-list-contracts-on-package-valid.json --sandbox --json',
  },
  {
    endpointId: 'billingProvider.getCustomerConfigurations',
    coverageType: 'post-body',
    result: 'successful',
    tenant: 'production',
    fixturePath: 'metronome-cli/test/fixtures/api-billing-provider-get-valid.json',
    goldenPath: 'metronome-cli/test/golden/api/read-plan.billing-provider-get.production.json',
    command: 'metro api read-plan billingProvider.getCustomerConfigurations --file metronome-cli/test/fixtures/api-billing-provider-get-valid.json --prod --json',
  },
  {
    endpointId: 'billingProvider.listConfiguredProviders',
    coverageType: 'post-body-cursor-list',
    result: 'successful',
    tenant: 'sandbox',
    fixturePath: 'metronome-cli/test/fixtures/api-billing-provider-list-configured-valid.json',
    goldenPath: 'metronome-cli/test/golden/api/read-plan.billing-provider-list-configured.sandbox.json',
    command: 'metro api read-plan billingProvider.listConfiguredProviders --file metronome-cli/test/fixtures/api-billing-provider-list-configured-valid.json --sandbox --json',
  },
  {
    endpointId: 'customFields.listKeys',
    coverageType: 'custom-fields-list-keys-body-query',
    result: 'successful',
    tenant: 'sandbox',
    fixturePath: 'metronome-cli/test/fixtures/api-custom-fields-list-keys-valid.json',
    goldenPath: 'metronome-cli/test/golden/api/read-plan.custom-fields-list-keys.sandbox.json',
    command: 'metro api read-plan customFields.listKeys --file metronome-cli/test/fixtures/api-custom-fields-list-keys-valid.json --sandbox --json',
  },
  {
    endpointId: 'settings.listPricingUnits',
    coverageType: 'get-query-pricing-units-list',
    result: 'successful',
    tenant: 'sandbox',
    fixturePath: 'metronome-cli/test/fixtures/api-settings-pricing-units-list-valid.json',
    goldenPath: 'metronome-cli/test/golden/api/read-plan.settings-pricing-units-list.sandbox.json',
    command: 'metro api read-plan settings.listPricingUnits --file metronome-cli/test/fixtures/api-settings-pricing-units-list-valid.json --sandbox --json',
  },
  {
    endpointId: 'security.getServices',
    coverageType: 'get-security-services-no-params',
    result: 'successful',
    tenant: 'sandbox',
    fixturePath: 'metronome-cli/test/fixtures/api-security-services-get-valid.json',
    goldenPath: 'metronome-cli/test/golden/api/read-plan.security-services-get.sandbox.json',
    command: 'metro api read-plan security.getServices --file metronome-cli/test/fixtures/api-security-services-get-valid.json --sandbox --json',
  },
  {
    endpointId: 'security.getAuditLogs',
    coverageType: 'get-security-audit-logs-query-filters',
    result: 'successful',
    tenant: 'sandbox',
    fixturePath: 'metronome-cli/test/fixtures/api-security-audit-logs-valid.json',
    goldenPath: 'metronome-cli/test/golden/api/read-plan.security-audit-logs.sandbox.json',
    command: 'metro api read-plan security.getAuditLogs --file metronome-cli/test/fixtures/api-security-audit-logs-valid.json --sandbox --json',
  },
  {
    endpointId: 'products.get',
    coverageType: 'post-body',
    result: 'successful',
    tenant: 'sandbox',
    fixturePath: 'metronome-cli/test/fixtures/api-products-get-valid.json',
    goldenPath: 'metronome-cli/test/golden/api/read-plan.products-get.sandbox.json',
    command: 'metro api read-plan products.get --file metronome-cli/test/fixtures/api-products-get-valid.json --sandbox --json',
  },
  {
    endpointId: 'products.list',
    coverageType: 'product-post-body-list-query',
    result: 'successful',
    tenant: 'sandbox',
    fixturePath: 'metronome-cli/test/fixtures/api-products-list-valid.json',
    goldenPath: 'metronome-cli/test/golden/api/read-plan.products-list.sandbox.json',
    command: 'metro api read-plan products.list --file metronome-cli/test/fixtures/api-products-list-valid.json --sandbox --json',
  },
  {
    endpointId: 'rateCards.get',
    coverageType: 'rate-card-post-body-get-metadata',
    result: 'successful',
    tenant: 'sandbox',
    fixturePath: 'metronome-cli/test/fixtures/api-rate-cards-get-valid.json',
    goldenPath: 'metronome-cli/test/golden/api/read-plan.rate-cards-get.sandbox.json',
    command: 'metro api read-plan rateCards.get --file metronome-cli/test/fixtures/api-rate-cards-get-valid.json --sandbox --json',
  },
  {
    endpointId: 'rateCards.list',
    coverageType: 'rate-card-post-query-list',
    result: 'successful',
    tenant: 'sandbox',
    fixturePath: 'metronome-cli/test/fixtures/api-rate-cards-list-valid.json',
    goldenPath: 'metronome-cli/test/golden/api/read-plan.rate-cards-list.sandbox.json',
    command: 'metro api read-plan rateCards.list --file metronome-cli/test/fixtures/api-rate-cards-list-valid.json --sandbox --json',
  },
  {
    endpointId: 'rateCards.getRates',
    coverageType: 'rate-card-post-body-rates-query',
    result: 'successful',
    tenant: 'sandbox',
    fixturePath: 'metronome-cli/test/fixtures/api-rate-cards-get-rates-valid.json',
    goldenPath: 'metronome-cli/test/golden/api/read-plan.rate-cards-get-rates.sandbox.json',
    command: 'metro api read-plan rateCards.getRates --file metronome-cli/test/fixtures/api-rate-cards-get-rates-valid.json --sandbox --json',
  },
  {
    endpointId: 'rateCards.getRateSchedule',
    coverageType: 'post-body',
    result: 'successful',
    tenant: 'sandbox',
    fixturePath: 'metronome-cli/test/fixtures/api-rate-card-schedule-valid.json',
    goldenPath: 'metronome-cli/test/golden/api/read-plan.rate-card-schedule.sandbox.json',
    command: 'metro api read-plan rateCards.getRateSchedule --file metronome-cli/test/fixtures/api-rate-card-schedule-valid.json --sandbox --json',
  },
  {
    endpointId: 'invoices.get',
    coverageType: 'post-body',
    result: 'successful',
    tenant: 'production',
    fixturePath: 'metronome-cli/test/fixtures/api-invoices-get-valid.json',
    goldenPath: 'metronome-cli/test/golden/api/read-plan.invoices-get.production.json',
    command: 'metro api read-plan invoices.get --file metronome-cli/test/fixtures/api-invoices-get-valid.json --prod --json',
  },
  {
    endpointId: 'payments.listForInvoice',
    coverageType: 'post-body-invoice-payments',
    result: 'successful',
    tenant: 'sandbox',
    fixturePath: 'metronome-cli/test/fixtures/api-payments-list-for-invoice-valid.json',
    goldenPath: 'metronome-cli/test/golden/api/read-plan.payments-list-for-invoice.sandbox.json',
    command: 'metro api read-plan payments.listForInvoice --file metronome-cli/test/fixtures/api-payments-list-for-invoice-valid.json --sandbox --json',
  },
  {
    endpointId: 'invoices.listForCustomer',
    coverageType: 'get-path-query',
    result: 'successful',
    tenant: 'production',
    fixturePath: 'metronome-cli/test/fixtures/api-invoices-list-for-customer-valid.json',
    goldenPath: 'metronome-cli/test/golden/api/read-plan.invoices-list-for-customer.production.json',
    command: 'metro api read-plan invoices.listForCustomer --file metronome-cli/test/fixtures/api-invoices-list-for-customer-valid.json --prod --json',
  },
  {
    endpointId: 'invoices.listBreakdowns',
    coverageType: 'get-path-query-invoice-breakdowns',
    result: 'successful',
    tenant: 'sandbox',
    fixturePath: 'metronome-cli/test/fixtures/api-invoices-list-breakdowns-valid.json',
    goldenPath: 'metronome-cli/test/golden/api/read-plan.invoices-list-breakdowns.sandbox.json',
    command: 'metro api read-plan invoices.listBreakdowns --file metronome-cli/test/fixtures/api-invoices-list-breakdowns-valid.json --sandbox --json',
  },
  {
    endpointId: 'customers.get',
    coverageType: 'get-path',
    result: 'successful',
    tenant: 'sandbox',
    fixturePath: 'metronome-cli/test/fixtures/api-customers-get-valid.json',
    goldenPath: 'metronome-cli/test/golden/api/read-plan.customers-get.sandbox.json',
    command: 'metro api read-plan customers.get --file metronome-cli/test/fixtures/api-customers-get-valid.json --sandbox --json',
  },
  {
    endpointId: 'customers.list',
    coverageType: 'get-query-list',
    result: 'successful',
    tenant: 'sandbox',
    fixturePath: 'metronome-cli/test/fixtures/api-customers-list-valid.json',
    goldenPath: 'metronome-cli/test/golden/api/read-plan.customers-list.sandbox.json',
    command: 'metro api read-plan customers.list --file metronome-cli/test/fixtures/api-customers-list-valid.json --sandbox --json',
  },
  {
    endpointId: 'usage.groups',
    coverageType: 'post-body-query-pagination',
    result: 'successful',
    tenant: 'sandbox',
    fixturePath: 'metronome-cli/test/fixtures/api-usage-groups-valid.json',
    goldenPath: 'metronome-cli/test/golden/api/read-plan.usage-groups.sandbox.json',
    command: 'metro api read-plan usage.groups --file metronome-cli/test/fixtures/api-usage-groups-valid.json --sandbox --json',
  },
  {
    endpointId: 'usage.groups',
    coverageType: 'blocked-invalid-query-placement',
    result: 'blocked',
    tenant: 'sandbox',
    fixturePath: 'metronome-cli/test/fixtures/api-usage-groups-invalid-body.json',
    goldenPath: 'metronome-cli/test/golden/api/read-plan.usage-groups-invalid-body.sandbox.json',
    command: 'metro api read-plan usage.groups --file metronome-cli/test/fixtures/api-usage-groups-invalid-body.json --sandbox --json',
    expectedStatus: 1,
  },
  {
    endpointId: 'usage.batch',
    coverageType: 'post-body-batch-usage-query',
    result: 'successful',
    tenant: 'sandbox',
    fixturePath: 'metronome-cli/test/fixtures/api-usage-batch-valid.json',
    goldenPath: 'metronome-cli/test/golden/api/read-plan.usage-batch.sandbox.json',
    command: 'metro api read-plan usage.batch --file metronome-cli/test/fixtures/api-usage-batch-valid.json --sandbox --json',
  },
  {
    endpointId: 'usage.batch',
    coverageType: 'blocked-invalid-batch-usage-query',
    result: 'blocked',
    tenant: 'sandbox',
    fixturePath: 'metronome-cli/test/fixtures/api-usage-batch-invalid-body.json',
    goldenPath: 'metronome-cli/test/golden/api/read-plan.usage-batch-invalid-body.sandbox.json',
    command: 'metro api read-plan usage.batch --file metronome-cli/test/fixtures/api-usage-batch-invalid-body.json --sandbox --json',
    expectedStatus: 1,
  },
];

const READ_PIPELINE_GOLDEN_EXAMPLES = [
  {
    endpointId: 'contracts.get.v2',
    coverageType: 'post-body-audit-dry-run',
    result: 'successful',
    tenant: 'sandbox',
    fixturePath: 'metronome-cli/test/fixtures/api-contracts-get-valid.json',
    readGatePath: 'metronome-cli/test/fixtures/api-read-gate-contracts-get-valid.json',
    mockResponsePath: 'metronome-cli/test/fixtures/api-contracts-get-mock-response.json',
    goldenPath: 'metronome-cli/test/golden/api/read-pipeline.contracts-get-v2.dry-run.sandbox.json',
    command: 'metro api read-pipeline contracts.get.v2 --file metronome-cli/test/fixtures/api-contracts-get-valid.json --read-gate metronome-cli/test/fixtures/api-read-gate-contracts-get-valid.json --mock-response metronome-cli/test/fixtures/api-contracts-get-mock-response.json --out audit-logs/api-read-pipeline-contracts-get.jsonl --actor agent-local-test --dry-run --json',
  },
  {
    endpointId: 'events.search',
    coverageType: 'post-body-audit-dry-run',
    result: 'successful',
    tenant: 'sandbox',
    fixturePath: 'metronome-cli/test/fixtures/api-events-search-valid.json',
    readGatePath: 'metronome-cli/test/fixtures/api-read-gate-events-search-valid.json',
    mockResponsePath: 'metronome-cli/test/fixtures/api-events-search-mock-response.json',
    goldenPath: 'metronome-cli/test/golden/api/read-pipeline.events-search.dry-run.sandbox.json',
    command: 'metro api read-pipeline events.search --file metronome-cli/test/fixtures/api-events-search-valid.json --read-gate metronome-cli/test/fixtures/api-read-gate-events-search-valid.json --mock-response metronome-cli/test/fixtures/api-events-search-mock-response.json --out audit-logs/api-read-pipeline-events-search.jsonl --actor agent-local-test --dry-run --json',
  },
  {
    endpointId: 'billableMetrics.get',
    coverageType: 'get-path-billable-metric-audit-dry-run',
    result: 'successful',
    tenant: 'sandbox',
    fixturePath: 'metronome-cli/test/fixtures/api-billable-metrics-get-valid.json',
    readGatePath: 'metronome-cli/test/fixtures/api-read-gate-billable-metrics-get-valid.json',
    mockResponsePath: 'metronome-cli/test/fixtures/api-billable-metrics-get-mock-response.json',
    goldenPath: 'metronome-cli/test/golden/api/read-pipeline.billable-metrics-get.dry-run.sandbox.json',
    command: 'metro api read-pipeline billableMetrics.get --file metronome-cli/test/fixtures/api-billable-metrics-get-valid.json --read-gate metronome-cli/test/fixtures/api-read-gate-billable-metrics-get-valid.json --mock-response metronome-cli/test/fixtures/api-billable-metrics-get-mock-response.json --out audit-logs/api-read-pipeline-billable-metrics-get.jsonl --actor agent-local-test --dry-run --json',
  },
  {
    endpointId: 'billableMetrics.list',
    coverageType: 'get-query-billable-metrics-list-audit-dry-run',
    result: 'successful',
    tenant: 'sandbox',
    fixturePath: 'metronome-cli/test/fixtures/api-billable-metrics-list-valid.json',
    readGatePath: 'metronome-cli/test/fixtures/api-read-gate-billable-metrics-list-valid.json',
    mockResponsePath: 'metronome-cli/test/fixtures/api-billable-metrics-list-mock-response.json',
    goldenPath: 'metronome-cli/test/golden/api/read-pipeline.billable-metrics-list.dry-run.sandbox.json',
    command: 'metro api read-pipeline billableMetrics.list --file metronome-cli/test/fixtures/api-billable-metrics-list-valid.json --read-gate metronome-cli/test/fixtures/api-read-gate-billable-metrics-list-valid.json --mock-response metronome-cli/test/fixtures/api-billable-metrics-list-mock-response.json --out audit-logs/api-read-pipeline-billable-metrics-list.jsonl --actor agent-local-test --dry-run --json',
  },
  {
    endpointId: 'packages.list',
    coverageType: 'post-query-audit-dry-run',
    result: 'successful',
    tenant: 'sandbox',
    fixturePath: 'metronome-cli/test/fixtures/api-packages-list-valid.json',
    readGatePath: 'metronome-cli/test/fixtures/api-read-gate-packages-list-valid.json',
    mockResponsePath: 'metronome-cli/test/fixtures/api-packages-list-mock-response.json',
    goldenPath: 'metronome-cli/test/golden/api/read-pipeline.packages-list.dry-run.sandbox.json',
    command: 'metro api read-pipeline packages.list --file metronome-cli/test/fixtures/api-packages-list-valid.json --read-gate metronome-cli/test/fixtures/api-read-gate-packages-list-valid.json --mock-response metronome-cli/test/fixtures/api-packages-list-mock-response.json --out audit-logs/api-read-pipeline-packages-list.jsonl --actor agent-local-test --dry-run --json',
  },
  {
    endpointId: 'packages.listContractsOnPackage',
    coverageType: 'post-body-package-contracts-query-audit-dry-run',
    result: 'successful',
    tenant: 'sandbox',
    fixturePath: 'metronome-cli/test/fixtures/api-packages-list-contracts-on-package-valid.json',
    readGatePath: 'metronome-cli/test/fixtures/api-read-gate-packages-list-contracts-on-package-valid.json',
    mockResponsePath: 'metronome-cli/test/fixtures/api-packages-list-contracts-on-package-mock-response.json',
    goldenPath: 'metronome-cli/test/golden/api/read-pipeline.packages-list-contracts-on-package.dry-run.sandbox.json',
    command: 'metro api read-pipeline packages.listContractsOnPackage --file metronome-cli/test/fixtures/api-packages-list-contracts-on-package-valid.json --read-gate metronome-cli/test/fixtures/api-read-gate-packages-list-contracts-on-package-valid.json --mock-response metronome-cli/test/fixtures/api-packages-list-contracts-on-package-mock-response.json --out audit-logs/api-read-pipeline-packages-list-contracts-on-package.jsonl --actor agent-local-test --dry-run --json',
  },
  {
    endpointId: 'billingProvider.getCustomerConfigurations',
    coverageType: 'production-post-body-audit-dry-run',
    result: 'successful',
    tenant: 'production',
    fixturePath: 'metronome-cli/test/fixtures/api-billing-provider-get-valid.json',
    readGatePath: 'metronome-cli/test/fixtures/api-read-gate-billing-provider-get-valid.json',
    mockResponsePath: 'metronome-cli/test/fixtures/api-billing-provider-get-mock-response.json',
    goldenPath: 'metronome-cli/test/golden/api/read-pipeline.billing-provider-get.dry-run.production.json',
    command: 'metro api read-pipeline billingProvider.getCustomerConfigurations --file metronome-cli/test/fixtures/api-billing-provider-get-valid.json --read-gate metronome-cli/test/fixtures/api-read-gate-billing-provider-get-valid.json --mock-response metronome-cli/test/fixtures/api-billing-provider-get-mock-response.json --out audit-logs/api-read-pipeline-billing-provider-get.jsonl --actor agent-local-test --dry-run --json',
  },
  {
    endpointId: 'billingProvider.listConfiguredProviders',
    coverageType: 'post-body-cursor-list-audit-dry-run',
    result: 'successful',
    tenant: 'sandbox',
    fixturePath: 'metronome-cli/test/fixtures/api-billing-provider-list-configured-valid.json',
    readGatePath: 'metronome-cli/test/fixtures/api-read-gate-billing-provider-list-configured-valid.json',
    mockResponsePath: 'metronome-cli/test/fixtures/api-billing-provider-list-configured-mock-response.json',
    goldenPath: 'metronome-cli/test/golden/api/read-pipeline.billing-provider-list-configured.dry-run.sandbox.json',
    command: 'metro api read-pipeline billingProvider.listConfiguredProviders --file metronome-cli/test/fixtures/api-billing-provider-list-configured-valid.json --read-gate metronome-cli/test/fixtures/api-read-gate-billing-provider-list-configured-valid.json --mock-response metronome-cli/test/fixtures/api-billing-provider-list-configured-mock-response.json --out audit-logs/api-read-pipeline-billing-provider-list-configured.jsonl --actor agent-local-test --dry-run --json',
  },
  {
    endpointId: 'customFields.listKeys',
    coverageType: 'custom-fields-list-keys-body-query-audit-dry-run',
    result: 'successful',
    tenant: 'sandbox',
    fixturePath: 'metronome-cli/test/fixtures/api-custom-fields-list-keys-valid.json',
    readGatePath: 'metronome-cli/test/fixtures/api-read-gate-custom-fields-list-keys-valid.json',
    mockResponsePath: 'metronome-cli/test/fixtures/api-custom-fields-list-keys-mock-response.json',
    goldenPath: 'metronome-cli/test/golden/api/read-pipeline.custom-fields-list-keys.dry-run.sandbox.json',
    command: 'metro api read-pipeline customFields.listKeys --file metronome-cli/test/fixtures/api-custom-fields-list-keys-valid.json --read-gate metronome-cli/test/fixtures/api-read-gate-custom-fields-list-keys-valid.json --mock-response metronome-cli/test/fixtures/api-custom-fields-list-keys-mock-response.json --out audit-logs/api-read-pipeline-custom-fields-list-keys.jsonl --actor agent-local-test --dry-run --json',
  },
  {
    endpointId: 'settings.listPricingUnits',
    coverageType: 'get-query-pricing-units-list-audit-dry-run',
    result: 'successful',
    tenant: 'sandbox',
    fixturePath: 'metronome-cli/test/fixtures/api-settings-pricing-units-list-valid.json',
    readGatePath: 'metronome-cli/test/fixtures/api-read-gate-settings-pricing-units-list-valid.json',
    mockResponsePath: 'metronome-cli/test/fixtures/api-settings-pricing-units-list-mock-response.json',
    goldenPath: 'metronome-cli/test/golden/api/read-pipeline.settings-pricing-units-list.dry-run.sandbox.json',
    command: 'metro api read-pipeline settings.listPricingUnits --file metronome-cli/test/fixtures/api-settings-pricing-units-list-valid.json --read-gate metronome-cli/test/fixtures/api-read-gate-settings-pricing-units-list-valid.json --mock-response metronome-cli/test/fixtures/api-settings-pricing-units-list-mock-response.json --out audit-logs/api-read-pipeline-settings-pricing-units-list.jsonl --actor agent-local-test --dry-run --json',
  },
  {
    endpointId: 'security.getServices',
    coverageType: 'get-security-services-no-params-audit-dry-run',
    result: 'successful',
    tenant: 'sandbox',
    fixturePath: 'metronome-cli/test/fixtures/api-security-services-get-valid.json',
    readGatePath: 'metronome-cli/test/fixtures/api-read-gate-security-services-get-valid.json',
    mockResponsePath: 'metronome-cli/test/fixtures/api-security-services-get-mock-response.json',
    goldenPath: 'metronome-cli/test/golden/api/read-pipeline.security-services-get.dry-run.sandbox.json',
    command: 'metro api read-pipeline security.getServices --file metronome-cli/test/fixtures/api-security-services-get-valid.json --read-gate metronome-cli/test/fixtures/api-read-gate-security-services-get-valid.json --mock-response metronome-cli/test/fixtures/api-security-services-get-mock-response.json --out audit-logs/api-read-pipeline-security-services-get.jsonl --actor agent-local-test --dry-run --json',
  },
  {
    endpointId: 'security.getAuditLogs',
    coverageType: 'get-security-audit-logs-query-filters-audit-dry-run',
    result: 'successful',
    tenant: 'sandbox',
    fixturePath: 'metronome-cli/test/fixtures/api-security-audit-logs-valid.json',
    readGatePath: 'metronome-cli/test/fixtures/api-read-gate-security-audit-logs-valid.json',
    mockResponsePath: 'metronome-cli/test/fixtures/api-security-audit-logs-mock-response.json',
    goldenPath: 'metronome-cli/test/golden/api/read-pipeline.security-audit-logs.dry-run.sandbox.json',
    command: 'metro api read-pipeline security.getAuditLogs --file metronome-cli/test/fixtures/api-security-audit-logs-valid.json --read-gate metronome-cli/test/fixtures/api-read-gate-security-audit-logs-valid.json --mock-response metronome-cli/test/fixtures/api-security-audit-logs-mock-response.json --out audit-logs/api-read-pipeline-security-audit-logs.jsonl --actor agent-local-test --dry-run --json',
  },
  {
    endpointId: 'invoices.listForCustomer',
    coverageType: 'get-path-query-audit-dry-run',
    result: 'successful',
    tenant: 'production',
    fixturePath: 'metronome-cli/test/fixtures/api-invoices-list-for-customer-valid.json',
    readGatePath: 'metronome-cli/test/fixtures/api-read-gate-invoices-list-for-customer-valid.json',
    mockResponsePath: 'metronome-cli/test/fixtures/api-invoices-list-for-customer-mock-response.json',
    goldenPath: 'metronome-cli/test/golden/api/read-pipeline.invoices-list-for-customer.dry-run.production.json',
    command: 'metro api read-pipeline invoices.listForCustomer --file metronome-cli/test/fixtures/api-invoices-list-for-customer-valid.json --read-gate metronome-cli/test/fixtures/api-read-gate-invoices-list-for-customer-valid.json --mock-response metronome-cli/test/fixtures/api-invoices-list-for-customer-mock-response.json --out audit-logs/api-read-pipeline-invoices-list-for-customer.jsonl --actor agent-local-test --dry-run --json',
  },
  {
    endpointId: 'invoices.listBreakdowns',
    coverageType: 'get-path-query-invoice-breakdowns-audit-dry-run',
    result: 'successful',
    tenant: 'sandbox',
    fixturePath: 'metronome-cli/test/fixtures/api-invoices-list-breakdowns-valid.json',
    readGatePath: 'metronome-cli/test/fixtures/api-read-gate-invoices-list-breakdowns-valid.json',
    mockResponsePath: 'metronome-cli/test/fixtures/api-invoices-list-breakdowns-mock-response.json',
    goldenPath: 'metronome-cli/test/golden/api/read-pipeline.invoices-list-breakdowns.dry-run.sandbox.json',
    command: 'metro api read-pipeline invoices.listBreakdowns --file metronome-cli/test/fixtures/api-invoices-list-breakdowns-valid.json --read-gate metronome-cli/test/fixtures/api-read-gate-invoices-list-breakdowns-valid.json --mock-response metronome-cli/test/fixtures/api-invoices-list-breakdowns-mock-response.json --out audit-logs/api-read-pipeline-invoices-list-breakdowns.jsonl --actor agent-local-test --dry-run --json',
  },
  {
    endpointId: 'customers.get',
    coverageType: 'get-path-audit-dry-run',
    result: 'successful',
    tenant: 'sandbox',
    fixturePath: 'metronome-cli/test/fixtures/api-customers-get-valid.json',
    readGatePath: 'metronome-cli/test/fixtures/api-read-gate-customers-get-valid.json',
    mockResponsePath: 'metronome-cli/test/fixtures/api-customers-get-mock-response.json',
    goldenPath: 'metronome-cli/test/golden/api/read-pipeline.customers-get.dry-run.sandbox.json',
    command: 'metro api read-pipeline customers.get --file metronome-cli/test/fixtures/api-customers-get-valid.json --read-gate metronome-cli/test/fixtures/api-read-gate-customers-get-valid.json --mock-response metronome-cli/test/fixtures/api-customers-get-mock-response.json --out audit-logs/api-read-pipeline-customers-get.jsonl --actor agent-local-test --dry-run --json',
  },
  {
    endpointId: 'contracts.list.v2',
    coverageType: 'post-body-list-audit-dry-run',
    result: 'successful',
    tenant: 'sandbox',
    fixturePath: 'metronome-cli/test/fixtures/api-contracts-list-v2-valid.json',
    readGatePath: 'metronome-cli/test/fixtures/api-read-gate-contracts-list-v2-valid.json',
    mockResponsePath: 'metronome-cli/test/fixtures/api-contracts-list-v2-mock-response.json',
    goldenPath: 'metronome-cli/test/golden/api/read-pipeline.contracts-list-v2.dry-run.sandbox.json',
    command: 'metro api read-pipeline contracts.list.v2 --file metronome-cli/test/fixtures/api-contracts-list-v2-valid.json --read-gate metronome-cli/test/fixtures/api-read-gate-contracts-list-v2-valid.json --mock-response metronome-cli/test/fixtures/api-contracts-list-v2-mock-response.json --out audit-logs/api-read-pipeline-contracts-list.jsonl --actor agent-local-test --dry-run --json',
  },
  {
    endpointId: 'contracts.getRateSchedule',
    coverageType: 'contract-post-body-rate-schedule-query-audit-dry-run',
    result: 'successful',
    tenant: 'sandbox',
    fixturePath: 'metronome-cli/test/fixtures/api-contracts-rate-schedule-valid.json',
    readGatePath: 'metronome-cli/test/fixtures/api-read-gate-contracts-rate-schedule-valid.json',
    mockResponsePath: 'metronome-cli/test/fixtures/api-contracts-rate-schedule-mock-response.json',
    goldenPath: 'metronome-cli/test/golden/api/read-pipeline.contracts-rate-schedule.dry-run.sandbox.json',
    command: 'metro api read-pipeline contracts.getRateSchedule --file metronome-cli/test/fixtures/api-contracts-rate-schedule-valid.json --read-gate metronome-cli/test/fixtures/api-read-gate-contracts-rate-schedule-valid.json --mock-response metronome-cli/test/fixtures/api-contracts-rate-schedule-mock-response.json --out audit-logs/api-read-pipeline-contracts-rate-schedule.jsonl --actor agent-local-test --dry-run --json',
  },
  {
    endpointId: 'contracts.getEditHistory',
    coverageType: 'post-body-contract-edit-history-audit-dry-run',
    result: 'successful',
    tenant: 'sandbox',
    fixturePath: 'metronome-cli/test/fixtures/api-contract-edit-history-valid.json',
    readGatePath: 'metronome-cli/test/fixtures/api-read-gate-contract-edit-history-valid.json',
    mockResponsePath: 'metronome-cli/test/fixtures/api-contract-edit-history-mock-response.json',
    goldenPath: 'metronome-cli/test/golden/api/read-pipeline.contract-edit-history.dry-run.sandbox.json',
    command: 'metro api read-pipeline contracts.getEditHistory --file metronome-cli/test/fixtures/api-contract-edit-history-valid.json --read-gate metronome-cli/test/fixtures/api-read-gate-contract-edit-history-valid.json --mock-response metronome-cli/test/fixtures/api-contract-edit-history-mock-response.json --out audit-logs/api-read-pipeline-contract-edit-history.jsonl --actor agent-local-test --dry-run --json',
  },
  {
    endpointId: 'contracts.getSubscriptionQuantityHistory',
    coverageType: 'post-body-subscription-quantity-history-audit-dry-run',
    result: 'successful',
    tenant: 'sandbox',
    fixturePath: 'metronome-cli/test/fixtures/api-subscription-quantity-history-valid.json',
    readGatePath: 'metronome-cli/test/fixtures/api-read-gate-subscription-quantity-history-valid.json',
    mockResponsePath: 'metronome-cli/test/fixtures/api-subscription-quantity-history-mock-response.json',
    goldenPath: 'metronome-cli/test/golden/api/read-pipeline.subscription-quantity-history.dry-run.sandbox.json',
    command: 'metro api read-pipeline contracts.getSubscriptionQuantityHistory --file metronome-cli/test/fixtures/api-subscription-quantity-history-valid.json --read-gate metronome-cli/test/fixtures/api-read-gate-subscription-quantity-history-valid.json --mock-response metronome-cli/test/fixtures/api-subscription-quantity-history-mock-response.json --out audit-logs/api-read-pipeline-subscription-quantity-history.jsonl --actor agent-local-test --dry-run --json',
  },
  {
    endpointId: 'contracts.getSubscriptionSeatsHistory',
    coverageType: 'post-body-subscription-seats-history-audit-dry-run',
    result: 'successful',
    tenant: 'sandbox',
    fixturePath: 'metronome-cli/test/fixtures/api-subscription-seats-history-valid.json',
    readGatePath: 'metronome-cli/test/fixtures/api-read-gate-subscription-seats-history-valid.json',
    mockResponsePath: 'metronome-cli/test/fixtures/api-subscription-seats-history-mock-response.json',
    goldenPath: 'metronome-cli/test/golden/api/read-pipeline.subscription-seats-history.dry-run.sandbox.json',
    command: 'metro api read-pipeline contracts.getSubscriptionSeatsHistory --file metronome-cli/test/fixtures/api-subscription-seats-history-valid.json --read-gate metronome-cli/test/fixtures/api-read-gate-subscription-seats-history-valid.json --mock-response metronome-cli/test/fixtures/api-subscription-seats-history-mock-response.json --out audit-logs/api-read-pipeline-subscription-seats-history.jsonl --actor agent-local-test --dry-run --json',
  },
  {
    endpointId: 'customerBalances.list',
    coverageType: 'post-body-balances-audit-dry-run',
    result: 'successful',
    tenant: 'sandbox',
    fixturePath: 'metronome-cli/test/fixtures/api-customer-balances-list-valid.json',
    readGatePath: 'metronome-cli/test/fixtures/api-read-gate-customer-balances-list-valid.json',
    mockResponsePath: 'metronome-cli/test/fixtures/api-customer-balances-list-mock-response.json',
    goldenPath: 'metronome-cli/test/golden/api/read-pipeline.customer-balances-list.dry-run.sandbox.json',
    command: 'metro api read-pipeline customerBalances.list --file metronome-cli/test/fixtures/api-customer-balances-list-valid.json --read-gate metronome-cli/test/fixtures/api-read-gate-customer-balances-list-valid.json --mock-response metronome-cli/test/fixtures/api-customer-balances-list-mock-response.json --out audit-logs/api-read-pipeline-customer-balances-list.jsonl --actor agent-local-test --dry-run --json',
  },
  {
    endpointId: 'seatBalances.list',
    coverageType: 'post-body-seat-balances-audit-dry-run',
    result: 'successful',
    tenant: 'sandbox',
    fixturePath: 'metronome-cli/test/fixtures/api-seat-balances-list-valid.json',
    readGatePath: 'metronome-cli/test/fixtures/api-read-gate-seat-balances-list-valid.json',
    mockResponsePath: 'metronome-cli/test/fixtures/api-seat-balances-list-mock-response.json',
    goldenPath: 'metronome-cli/test/golden/api/read-pipeline.seat-balances-list.dry-run.sandbox.json',
    command: 'metro api read-pipeline seatBalances.list --file metronome-cli/test/fixtures/api-seat-balances-list-valid.json --read-gate metronome-cli/test/fixtures/api-read-gate-seat-balances-list-valid.json --mock-response metronome-cli/test/fixtures/api-seat-balances-list-mock-response.json --out audit-logs/api-read-pipeline-seat-balances-list.jsonl --actor agent-local-test --dry-run --json',
  },
  {
    endpointId: 'commits.list',
    coverageType: 'post-body-commits-audit-dry-run',
    result: 'successful',
    tenant: 'sandbox',
    fixturePath: 'metronome-cli/test/fixtures/api-commits-list-valid.json',
    readGatePath: 'metronome-cli/test/fixtures/api-read-gate-commits-list-valid.json',
    mockResponsePath: 'metronome-cli/test/fixtures/api-commits-list-mock-response.json',
    goldenPath: 'metronome-cli/test/golden/api/read-pipeline.commits-list.dry-run.sandbox.json',
    command: 'metro api read-pipeline commits.list --file metronome-cli/test/fixtures/api-commits-list-valid.json --read-gate metronome-cli/test/fixtures/api-read-gate-commits-list-valid.json --mock-response metronome-cli/test/fixtures/api-commits-list-mock-response.json --out audit-logs/api-read-pipeline-commits-list.jsonl --actor agent-local-test --dry-run --json',
  },
  {
    endpointId: 'credits.list',
    coverageType: 'post-body-credits-audit-dry-run',
    result: 'successful',
    tenant: 'sandbox',
    fixturePath: 'metronome-cli/test/fixtures/api-credits-list-valid.json',
    readGatePath: 'metronome-cli/test/fixtures/api-read-gate-credits-list-valid.json',
    mockResponsePath: 'metronome-cli/test/fixtures/api-credits-list-mock-response.json',
    goldenPath: 'metronome-cli/test/golden/api/read-pipeline.credits-list.dry-run.sandbox.json',
    command: 'metro api read-pipeline credits.list --file metronome-cli/test/fixtures/api-credits-list-valid.json --read-gate metronome-cli/test/fixtures/api-read-gate-credits-list-valid.json --mock-response metronome-cli/test/fixtures/api-credits-list-mock-response.json --out audit-logs/api-read-pipeline-credits-list.jsonl --actor agent-local-test --dry-run --json',
  },
  {
    endpointId: 'packages.get',
    coverageType: 'package-post-body-audit-dry-run',
    result: 'successful',
    tenant: 'sandbox',
    fixturePath: 'metronome-cli/test/fixtures/api-packages-get-valid.json',
    readGatePath: 'metronome-cli/test/fixtures/api-read-gate-packages-get-valid.json',
    mockResponsePath: 'metronome-cli/test/fixtures/api-packages-get-mock-response.json',
    goldenPath: 'metronome-cli/test/golden/api/read-pipeline.packages-get.dry-run.sandbox.json',
    command: 'metro api read-pipeline packages.get --file metronome-cli/test/fixtures/api-packages-get-valid.json --read-gate metronome-cli/test/fixtures/api-read-gate-packages-get-valid.json --mock-response metronome-cli/test/fixtures/api-packages-get-mock-response.json --out audit-logs/api-read-pipeline-packages-get.jsonl --actor agent-local-test --dry-run --json',
  },
  {
    endpointId: 'products.get',
    coverageType: 'product-post-body-audit-dry-run',
    result: 'successful',
    tenant: 'sandbox',
    fixturePath: 'metronome-cli/test/fixtures/api-products-get-valid.json',
    readGatePath: 'metronome-cli/test/fixtures/api-read-gate-products-get-valid.json',
    mockResponsePath: 'metronome-cli/test/fixtures/api-products-get-mock-response.json',
    goldenPath: 'metronome-cli/test/golden/api/read-pipeline.products-get.dry-run.sandbox.json',
    command: 'metro api read-pipeline products.get --file metronome-cli/test/fixtures/api-products-get-valid.json --read-gate metronome-cli/test/fixtures/api-read-gate-products-get-valid.json --mock-response metronome-cli/test/fixtures/api-products-get-mock-response.json --out audit-logs/api-read-pipeline-products-get.jsonl --actor agent-local-test --dry-run --json',
  },
  {
    endpointId: 'products.list',
    coverageType: 'product-post-body-list-query-audit-dry-run',
    result: 'successful',
    tenant: 'sandbox',
    fixturePath: 'metronome-cli/test/fixtures/api-products-list-valid.json',
    readGatePath: 'metronome-cli/test/fixtures/api-read-gate-products-list-valid.json',
    mockResponsePath: 'metronome-cli/test/fixtures/api-products-list-mock-response.json',
    goldenPath: 'metronome-cli/test/golden/api/read-pipeline.products-list.dry-run.sandbox.json',
    command: 'metro api read-pipeline products.list --file metronome-cli/test/fixtures/api-products-list-valid.json --read-gate metronome-cli/test/fixtures/api-read-gate-products-list-valid.json --mock-response metronome-cli/test/fixtures/api-products-list-mock-response.json --out audit-logs/api-read-pipeline-products-list.jsonl --actor agent-local-test --dry-run --json',
  },
  {
    endpointId: 'rateCards.get',
    coverageType: 'rate-card-post-body-get-metadata-audit-dry-run',
    result: 'successful',
    tenant: 'sandbox',
    fixturePath: 'metronome-cli/test/fixtures/api-rate-cards-get-valid.json',
    readGatePath: 'metronome-cli/test/fixtures/api-read-gate-rate-cards-get-valid.json',
    mockResponsePath: 'metronome-cli/test/fixtures/api-rate-cards-get-mock-response.json',
    goldenPath: 'metronome-cli/test/golden/api/read-pipeline.rate-cards-get.dry-run.sandbox.json',
    command: 'metro api read-pipeline rateCards.get --file metronome-cli/test/fixtures/api-rate-cards-get-valid.json --read-gate metronome-cli/test/fixtures/api-read-gate-rate-cards-get-valid.json --mock-response metronome-cli/test/fixtures/api-rate-cards-get-mock-response.json --out audit-logs/api-read-pipeline-rate-cards-get.jsonl --actor agent-local-test --dry-run --json',
  },
  {
    endpointId: 'rateCards.list',
    coverageType: 'rate-card-post-query-list-audit-dry-run',
    result: 'successful',
    tenant: 'sandbox',
    fixturePath: 'metronome-cli/test/fixtures/api-rate-cards-list-valid.json',
    readGatePath: 'metronome-cli/test/fixtures/api-read-gate-rate-cards-list-valid.json',
    mockResponsePath: 'metronome-cli/test/fixtures/api-rate-cards-list-mock-response.json',
    goldenPath: 'metronome-cli/test/golden/api/read-pipeline.rate-cards-list.dry-run.sandbox.json',
    command: 'metro api read-pipeline rateCards.list --file metronome-cli/test/fixtures/api-rate-cards-list-valid.json --read-gate metronome-cli/test/fixtures/api-read-gate-rate-cards-list-valid.json --mock-response metronome-cli/test/fixtures/api-rate-cards-list-mock-response.json --out audit-logs/api-read-pipeline-rate-cards-list.jsonl --actor agent-local-test --dry-run --json',
  },
  {
    endpointId: 'rateCards.getRates',
    coverageType: 'rate-card-post-body-rates-query-audit-dry-run',
    result: 'successful',
    tenant: 'sandbox',
    fixturePath: 'metronome-cli/test/fixtures/api-rate-cards-get-rates-valid.json',
    readGatePath: 'metronome-cli/test/fixtures/api-read-gate-rate-cards-get-rates-valid.json',
    mockResponsePath: 'metronome-cli/test/fixtures/api-rate-cards-get-rates-mock-response.json',
    goldenPath: 'metronome-cli/test/golden/api/read-pipeline.rate-cards-get-rates.dry-run.sandbox.json',
    command: 'metro api read-pipeline rateCards.getRates --file metronome-cli/test/fixtures/api-rate-cards-get-rates-valid.json --read-gate metronome-cli/test/fixtures/api-read-gate-rate-cards-get-rates-valid.json --mock-response metronome-cli/test/fixtures/api-rate-cards-get-rates-mock-response.json --out audit-logs/api-read-pipeline-rate-cards-get-rates.jsonl --actor agent-local-test --dry-run --json',
  },
  {
    endpointId: 'rateCards.getRateSchedule',
    coverageType: 'rate-card-post-body-audit-dry-run',
    result: 'successful',
    tenant: 'sandbox',
    fixturePath: 'metronome-cli/test/fixtures/api-rate-card-schedule-valid.json',
    readGatePath: 'metronome-cli/test/fixtures/api-read-gate-rate-card-schedule-valid.json',
    mockResponsePath: 'metronome-cli/test/fixtures/api-rate-card-schedule-mock-response.json',
    goldenPath: 'metronome-cli/test/golden/api/read-pipeline.rate-card-schedule.dry-run.sandbox.json',
    command: 'metro api read-pipeline rateCards.getRateSchedule --file metronome-cli/test/fixtures/api-rate-card-schedule-valid.json --read-gate metronome-cli/test/fixtures/api-read-gate-rate-card-schedule-valid.json --mock-response metronome-cli/test/fixtures/api-rate-card-schedule-mock-response.json --out audit-logs/api-read-pipeline-rate-card-schedule.jsonl --actor agent-local-test --dry-run --json',
  },
  {
    endpointId: 'invoices.get',
    coverageType: 'invoice-post-body-audit-dry-run',
    result: 'successful',
    tenant: 'production',
    fixturePath: 'metronome-cli/test/fixtures/api-invoices-get-valid.json',
    readGatePath: 'metronome-cli/test/fixtures/api-read-gate-invoices-get-valid.json',
    mockResponsePath: 'metronome-cli/test/fixtures/api-invoices-get-mock-response.json',
    goldenPath: 'metronome-cli/test/golden/api/read-pipeline.invoices-get.dry-run.production.json',
    command: 'metro api read-pipeline invoices.get --file metronome-cli/test/fixtures/api-invoices-get-valid.json --read-gate metronome-cli/test/fixtures/api-read-gate-invoices-get-valid.json --mock-response metronome-cli/test/fixtures/api-invoices-get-mock-response.json --out audit-logs/api-read-pipeline-invoices-get.jsonl --actor agent-local-test --dry-run --json',
  },
  {
    endpointId: 'payments.listForInvoice',
    coverageType: 'post-body-invoice-payments-audit-dry-run',
    result: 'successful',
    tenant: 'sandbox',
    fixturePath: 'metronome-cli/test/fixtures/api-payments-list-for-invoice-valid.json',
    readGatePath: 'metronome-cli/test/fixtures/api-read-gate-payments-list-for-invoice-valid.json',
    mockResponsePath: 'metronome-cli/test/fixtures/api-payments-list-for-invoice-mock-response.json',
    goldenPath: 'metronome-cli/test/golden/api/read-pipeline.payments-list-for-invoice.dry-run.sandbox.json',
    command: 'metro api read-pipeline payments.listForInvoice --file metronome-cli/test/fixtures/api-payments-list-for-invoice-valid.json --read-gate metronome-cli/test/fixtures/api-read-gate-payments-list-for-invoice-valid.json --mock-response metronome-cli/test/fixtures/api-payments-list-for-invoice-mock-response.json --out audit-logs/api-read-pipeline-payments-list-for-invoice.jsonl --actor agent-local-test --dry-run --json',
  },
  {
    endpointId: 'customers.list',
    coverageType: 'get-query-list-audit-dry-run',
    result: 'successful',
    tenant: 'sandbox',
    fixturePath: 'metronome-cli/test/fixtures/api-customers-list-valid.json',
    readGatePath: 'metronome-cli/test/fixtures/api-read-gate-customers-list-valid.json',
    mockResponsePath: 'metronome-cli/test/fixtures/api-customers-list-mock-response.json',
    goldenPath: 'metronome-cli/test/golden/api/read-pipeline.customers-list.dry-run.sandbox.json',
    command: 'metro api read-pipeline customers.list --file metronome-cli/test/fixtures/api-customers-list-valid.json --read-gate metronome-cli/test/fixtures/api-read-gate-customers-list-valid.json --mock-response metronome-cli/test/fixtures/api-customers-list-mock-response.json --out audit-logs/api-read-pipeline-customers-list.jsonl --actor agent-local-test --dry-run --json',
  },
  {
    endpointId: 'usage.groups',
    coverageType: 'post-body-query-pagination-audit-dry-run',
    result: 'successful',
    tenant: 'sandbox',
    fixturePath: 'metronome-cli/test/fixtures/api-usage-groups-valid.json',
    readGatePath: 'metronome-cli/test/fixtures/api-read-gate-usage-groups-valid.json',
    mockResponsePath: 'metronome-cli/test/fixtures/api-usage-groups-mock-response.json',
    goldenPath: 'metronome-cli/test/golden/api/read-pipeline.usage-groups.dry-run.sandbox.json',
    command: 'metro api read-pipeline usage.groups --file metronome-cli/test/fixtures/api-usage-groups-valid.json --read-gate metronome-cli/test/fixtures/api-read-gate-usage-groups-valid.json --mock-response metronome-cli/test/fixtures/api-usage-groups-mock-response.json --out audit-logs/api-read-pipeline-usage-groups.jsonl --actor agent-local-test --dry-run --json',
  },
  {
    endpointId: 'usage.batch',
    coverageType: 'post-body-batch-usage-query-audit-dry-run',
    result: 'successful',
    tenant: 'sandbox',
    fixturePath: 'metronome-cli/test/fixtures/api-usage-batch-valid.json',
    readGatePath: 'metronome-cli/test/fixtures/api-read-gate-usage-batch-valid.json',
    mockResponsePath: 'metronome-cli/test/fixtures/api-usage-batch-mock-response.json',
    goldenPath: 'metronome-cli/test/golden/api/read-pipeline.usage-batch.dry-run.sandbox.json',
    command: 'metro api read-pipeline usage.batch --file metronome-cli/test/fixtures/api-usage-batch-valid.json --read-gate metronome-cli/test/fixtures/api-read-gate-usage-batch-valid.json --mock-response metronome-cli/test/fixtures/api-usage-batch-mock-response.json --out audit-logs/api-read-pipeline-usage-batch.jsonl --actor agent-local-test --dry-run --json',
  },
];

const READ_MOCK_EXAMPLES = READ_PIPELINE_GOLDEN_EXAMPLES.map(readMockExampleFromPipeline);

const PERSISTED_READ_AUDIT_EXAMPLES = [
  persistedReadAuditExample('billableMetrics.get', 'api-read-audit-billable-metrics-get-valid.jsonl', 'read-audit.billable-metrics-get.validation.sandbox.json', 'sandbox'),
  persistedReadAuditExample('billableMetrics.list', 'api-read-audit-billable-metrics-list-valid.jsonl', 'read-audit.billable-metrics-list.validation.sandbox.json', 'sandbox'),
  persistedReadAuditExample('billingProvider.getCustomerConfigurations', 'api-read-audit-billing-provider-get-valid.jsonl', 'read-audit.billing-provider-get.validation.production.json', 'production'),
  persistedReadAuditExample('billingProvider.listConfiguredProviders', 'api-read-audit-billing-provider-list-configured-valid.jsonl', 'read-audit.billing-provider-list-configured.validation.sandbox.json', 'sandbox'),
  persistedReadAuditExample('customFields.listKeys', 'api-read-audit-custom-fields-list-keys-valid.jsonl', 'read-audit.custom-fields-list-keys.validation.sandbox.json', 'sandbox'),
  persistedReadAuditExample('settings.listPricingUnits', 'api-read-audit-settings-pricing-units-list-valid.jsonl', 'read-audit.settings-pricing-units-list.validation.sandbox.json', 'sandbox'),
  persistedReadAuditExample('security.getServices', 'api-read-audit-security-services-get-valid.jsonl', 'read-audit.security-services-get.validation.sandbox.json', 'sandbox'),
  persistedReadAuditExample('security.getAuditLogs', 'api-read-audit-security-audit-logs-valid.jsonl', 'read-audit.security-audit-logs.validation.sandbox.json', 'sandbox'),
  persistedReadAuditExample('commits.list', 'api-read-audit-commits-list-valid.jsonl', 'read-audit.commits-list.validation.sandbox.json', 'sandbox'),
  persistedReadAuditExample('contracts.getEditHistory', 'api-read-audit-contract-edit-history-valid.jsonl', 'read-audit.contract-edit-history.validation.sandbox.json', 'sandbox'),
  persistedReadAuditExample('contracts.get.v2', 'api-read-audit-contracts-get-valid.jsonl', 'read-audit.contracts-get-v2.validation.sandbox.json', 'sandbox'),
  persistedReadAuditExample('contracts.getRateSchedule', 'api-read-audit-contracts-rate-schedule-valid.jsonl', 'read-audit.contracts-rate-schedule.validation.sandbox.json', 'sandbox'),
  persistedReadAuditExample('contracts.getSubscriptionQuantityHistory', 'api-read-audit-subscription-quantity-history-valid.jsonl', 'read-audit.subscription-quantity-history.validation.sandbox.json', 'sandbox'),
  persistedReadAuditExample('contracts.getSubscriptionSeatsHistory', 'api-read-audit-subscription-seats-history-valid.jsonl', 'read-audit.subscription-seats-history.validation.sandbox.json', 'sandbox'),
  persistedReadAuditExample('contracts.list.v2', 'api-read-audit-contracts-list-v2-valid.jsonl', 'read-audit.contracts-list-v2.validation.sandbox.json', 'sandbox'),
  persistedReadAuditExample('credits.list', 'api-read-audit-credits-list-valid.jsonl', 'read-audit.credits-list.validation.sandbox.json', 'sandbox'),
  persistedReadAuditExample('customerBalances.list', 'api-read-audit-customer-balances-list-valid.jsonl', 'read-audit.customer-balances-list.validation.sandbox.json', 'sandbox'),
  persistedReadAuditExample('seatBalances.list', 'api-read-audit-seat-balances-list-valid.jsonl', 'read-audit.seat-balances-list.validation.sandbox.json', 'sandbox'),
  persistedReadAuditExample('customers.get', 'api-read-audit-customers-get-valid.jsonl', 'read-audit.customers-get.validation.sandbox.json', 'sandbox'),
  persistedReadAuditExample('customers.list', 'api-read-audit-customers-list-valid.jsonl', 'read-audit.customers-list.validation.sandbox.json', 'sandbox'),
  persistedReadAuditExample('events.search', 'api-read-audit-events-search-valid.jsonl', 'read-audit.events-search.validation.sandbox.json', 'sandbox'),
  persistedReadAuditExample('invoices.get', 'api-read-audit-invoices-get-valid.jsonl', 'read-audit.invoices-get.validation.production.json', 'production'),
  persistedReadAuditExample('invoices.listForCustomer', 'api-read-audit-invoices-list-for-customer-valid.jsonl', 'read-audit.invoices-list-for-customer.validation.production.json', 'production'),
  persistedReadAuditExample('invoices.listBreakdowns', 'api-read-audit-invoices-list-breakdowns-valid.jsonl', 'read-audit.invoices-list-breakdowns.validation.sandbox.json', 'sandbox'),
  persistedReadAuditExample('payments.listForInvoice', 'api-read-audit-payments-list-for-invoice-valid.jsonl', 'read-audit.payments-list-for-invoice.validation.sandbox.json', 'sandbox'),
  persistedReadAuditExample('packages.get', 'api-read-audit-packages-get-valid.jsonl', 'read-audit.packages-get.validation.sandbox.json', 'sandbox'),
  persistedReadAuditExample('packages.list', 'api-read-audit-packages-list-valid.jsonl', 'read-audit.packages-list.validation.sandbox.json', 'sandbox'),
  persistedReadAuditExample('packages.listContractsOnPackage', 'api-read-audit-packages-list-contracts-on-package-valid.jsonl', 'read-audit.packages-list-contracts-on-package.validation.sandbox.json', 'sandbox'),
  persistedReadAuditExample('products.get', 'api-read-audit-products-get-valid.jsonl', 'read-audit.products-get.validation.sandbox.json', 'sandbox'),
  persistedReadAuditExample('products.list', 'api-read-audit-products-list-valid.jsonl', 'read-audit.products-list.validation.sandbox.json', 'sandbox'),
  persistedReadAuditExample('rateCards.get', 'api-read-audit-rate-cards-get-valid.jsonl', 'read-audit.rate-cards-get.validation.sandbox.json', 'sandbox'),
  persistedReadAuditExample('rateCards.getRates', 'api-read-audit-rate-cards-get-rates-valid.jsonl', 'read-audit.rate-cards-get-rates.validation.sandbox.json', 'sandbox'),
  persistedReadAuditExample('rateCards.getRateSchedule', 'api-read-audit-rate-card-schedule-valid.jsonl', 'read-audit.rate-card-schedule.validation.sandbox.json', 'sandbox'),
  persistedReadAuditExample('rateCards.list', 'api-read-audit-rate-cards-list-valid.jsonl', 'read-audit.rate-cards-list.validation.sandbox.json', 'sandbox'),
  persistedReadAuditExample('usage.batch', 'api-read-audit-usage-batch-valid.jsonl', 'read-audit.usage-batch.validation.sandbox.json', 'sandbox'),
  persistedReadAuditExample('usage.groups', 'api-read-audit-usage-groups-valid.jsonl', 'read-audit.usage-groups.validation.sandbox.json', 'sandbox'),
];

function readMockExampleFromPipeline(example) {
  const coverageType = example.coverageType.replace(/-audit-dry-run$/, '-mocked-read');
  return {
    endpointId: example.endpointId,
    coverageType,
    result: example.result,
    tenant: example.tenant,
    fixturePath: example.fixturePath,
    readGatePath: example.readGatePath,
    mockResponsePath: example.mockResponsePath,
    pipelineGoldenPath: example.goldenPath,
    command: `metro api read-mock ${example.endpointId} --file ${example.fixturePath} --read-gate ${example.readGatePath} --mock-response ${example.mockResponsePath} --actor agent-local-test --json`,
  };
}

function persistedReadAuditExample(endpointId, fixtureFile, goldenFile, tenant) {
  const fixturePath = `metronome-cli/test/fixtures/${fixtureFile}`;
  return {
    endpointId,
    coverageType: 'persisted-jsonl-validation',
    result: 'successful',
    tenant,
    fixturePath,
    goldenPath: `metronome-cli/test/golden/api/${goldenFile}`,
    command: `metro api read-audit validate --file ${fixturePath} --json`,
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function examplesByEndpoint(examples) {
  return examples.reduce((groups, example) => {
    if (!groups[example.endpointId]) groups[example.endpointId] = [];
    groups[example.endpointId].push(clone(example));
    return groups;
  }, {});
}

function sortedUnique(values) {
  return [...new Set(values)].sort();
}

function writeProofLadder() {
  return WRITE_PROOF_LADDER.map((step) => ({
    ...clone(step),
    apiAccess: 'none',
    liveExecutionEnabledInCurrentCli: false,
    applyEnabledInCurrentCli: false,
  }));
}

function readinessFor({
  endpoint,
  validationCoverage,
  readPlanCoverage,
  goldenExamples,
  readMockExamples,
  readPipelineGoldenExamples,
  persistedReadAuditExamples,
}) {
  const validation = validationCoverage[endpoint.id];
  const readPlan = readPlanCoverage[endpoint.id];
  const hasEndpointSpecificValidator = validation?.supportStatus === 'endpoint-specific';
  const hasLocalReadPlan = readPlan?.supportStatus === 'local-read-plan';
  const hasGoldenOutputCoverage = goldenExamples.length > 0;
  const hasReadMockCoverage = readMockExamples.length > 0;
  const hasReadPipelineGoldenOutputCoverage = readPipelineGoldenExamples.length > 0;
  const hasPersistedReadAuditCoverage = persistedReadAuditExamples.length > 0;
  const missingEvidence = [];

  if (!hasEndpointSpecificValidator) missingEvidence.push('endpoint-specific validator');
  if (!hasLocalReadPlan) missingEvidence.push('local read-plan coverage');
  if (!hasGoldenOutputCoverage) missingEvidence.push('read-plan golden output');
  if (!hasReadMockCoverage) missingEvidence.push('read-mock output evidence');
  if (!hasReadPipelineGoldenOutputCoverage) missingEvidence.push('read-pipeline golden output');
  if (!hasPersistedReadAuditCoverage) missingEvidence.push('persisted read-audit validation');

  return {
    endpointId: endpoint.id,
    family: endpoint.family,
    method: endpoint.method,
    path: endpoint.path,
    permissionScope: endpoint.permissionScope,
    supportStatus: endpoint.supportStatus,
    sourceIds: clone(endpoint.sourceIds),
    requestValidator: {
      status: validation?.supportStatus || 'missing',
      hasEndpointSpecificValidator,
      command: validation?.command || null,
      checked: validation?.checked ? clone(validation.checked) : [],
    },
    localReadPlan: {
      status: readPlan?.supportStatus || 'missing',
      hasLocalReadPlan,
      command: readPlan?.command || null,
      liveReadEnabledInCurrentCli: isLiveReadEndpoint(endpoint.id),
    },
    goldenOutput: {
      covered: hasGoldenOutputCoverage,
      exampleCount: goldenExamples.length,
      coverageTypes: sortedUnique(goldenExamples.map((example) => example.coverageType)),
      examples: clone(goldenExamples),
    },
    readMockOutput: {
      covered: hasReadMockCoverage,
      exampleCount: readMockExamples.length,
      coverageTypes: sortedUnique(readMockExamples.map((example) => example.coverageType)),
      examples: clone(readMockExamples),
    },
    readPipelineGoldenOutput: {
      covered: hasReadPipelineGoldenOutputCoverage,
      exampleCount: readPipelineGoldenExamples.length,
      coverageTypes: sortedUnique(readPipelineGoldenExamples.map((example) => example.coverageType)),
      examples: clone(readPipelineGoldenExamples),
    },
    persistedReadAuditOutput: {
      covered: hasPersistedReadAuditCoverage,
      exampleCount: persistedReadAuditExamples.length,
      coverageTypes: sortedUnique(persistedReadAuditExamples.map((example) => example.coverageType)),
      examples: clone(persistedReadAuditExamples),
    },
    readiness: missingEvidence.length === 0 ? 'full-local-read-evidence' : 'needs-local-read-evidence',
    missingEvidence,
    liveExecution: clone(endpoint.liveExecution),
    liveReadSupported: isLiveReadEndpoint(endpoint.id),
  };
}

function familyCoverageSummary(endpoints) {
  return sortedUnique(endpoints.map((endpoint) => endpoint.family)).map((family) => {
    const familyEndpoints = endpoints.filter((endpoint) => endpoint.family === family);
    const missingFor = (predicate) => familyEndpoints
      .filter((endpoint) => !predicate(endpoint))
      .map((endpoint) => endpoint.endpointId)
      .sort();

    return {
      family,
      readEndpoints: familyEndpoints.length,
      endpointSpecificValidators: familyEndpoints.filter((endpoint) => endpoint.requestValidator.hasEndpointSpecificValidator).length,
      readPlans: familyEndpoints.filter((endpoint) => endpoint.localReadPlan.hasLocalReadPlan).length,
      readMocks: familyEndpoints.filter((endpoint) => endpoint.readMockOutput.covered).length,
      readPipelines: familyEndpoints.filter((endpoint) => endpoint.readPipelineGoldenOutput.covered).length,
      persistedReadAudits: familyEndpoints.filter((endpoint) => endpoint.persistedReadAuditOutput.covered).length,
      missingValidatorEndpoints: missingFor((endpoint) => endpoint.requestValidator.hasEndpointSpecificValidator),
      missingReadPlanEndpoints: missingFor((endpoint) => endpoint.localReadPlan.hasLocalReadPlan),
      missingReadMockEndpoints: missingFor((endpoint) => endpoint.readMockOutput.covered),
      missingReadPipelineEndpoints: missingFor((endpoint) => endpoint.readPipelineGoldenOutput.covered),
      missingPersistedReadAuditEndpoints: missingFor((endpoint) => endpoint.persistedReadAuditOutput.covered),
    };
  });
}

function writeReadinessFor({
  endpoint,
  validationCoverage,
  previewCoverage,
  preflightCoverage,
  sandboxProofCoverage,
  applyGateCoverage,
  approvalRecordCoverage,
  applyAuditCoverage,
  applyResultCoverage,
  applyReadbackCoverage,
}) {
  const validation = validationCoverage[endpoint.id];
  const preview = previewCoverage[endpoint.id];
  const preflight = preflightCoverage[endpoint.id];
  const sandboxProof = sandboxProofCoverage[endpoint.id];
  const applyGate = applyGateCoverage[endpoint.id];
  const approvalRecord = approvalRecordCoverage[endpoint.id];
  const applyAudit = applyAuditCoverage[endpoint.id];
  const applyResult = applyResultCoverage[endpoint.id];
  const applyReadback = applyReadbackCoverage[endpoint.id];
  const hasEndpointSpecificValidator = validation?.supportStatus === 'endpoint-specific';
  const hasLocalPreview = preview?.supportStatus === 'local-preview-contract';
  const hasLocalPreflight = preflight?.supportStatus === 'local-preflight-contract';
  const hasLocalSandboxProof = sandboxProof?.supportStatus === 'local-sandbox-proof-template';
  const hasLocalApplyGate = applyGate?.supportStatus === 'local-apply-gate-manifest';
  const hasLocalApprovalRecord = approvalRecord?.supportStatus === 'local-approval-record';
  const hasLocalApplyAudit = applyAudit?.supportStatus === 'local-planned-apply-audit';
  const hasLocalApplyResult = applyResult?.supportStatus === 'local-apply-result-contract';
  const hasLocalApplyReadback = applyReadback?.supportStatus === 'local-apply-readback-verifier';
  const missingEvidence = [];

  if (!hasEndpointSpecificValidator) missingEvidence.push('endpoint-specific validator');
  if (!hasLocalPreview) missingEvidence.push('local api preview contract');
  if (!hasLocalPreflight) missingEvidence.push('local api preflight contract');
  if (!hasLocalSandboxProof) missingEvidence.push('local api sandbox-proof template');
  if (!hasLocalApplyGate) missingEvidence.push('local api apply-gate manifest');
  if (!hasLocalApprovalRecord) missingEvidence.push('local api approval-record contract');
  if (!hasLocalApplyAudit) missingEvidence.push('local api apply-audit contract');
  if (!hasLocalApplyReadback) missingEvidence.push('local api apply-readback verifier');
  if (!hasLocalApplyResult) missingEvidence.push('local api apply-result contract');

  return {
    endpointId: endpoint.id,
    family: endpoint.family,
    method: endpoint.method,
    path: endpoint.path,
    permissionScope: endpoint.permissionScope,
    supportStatus: endpoint.supportStatus,
    sourceIds: clone(endpoint.sourceIds),
    requestValidator: {
      status: validation?.supportStatus || 'missing',
      hasEndpointSpecificValidator,
      command: validation?.command || null,
      checked: validation?.checked ? clone(validation.checked) : [],
    },
    localPreview: {
      status: preview?.supportStatus || 'missing',
      hasLocalPreview,
      command: preview?.command || null,
      requiresValidation: preview?.requiresValidation || null,
      apiAccess: preview?.apiAccess || 'none',
    },
    apiPreflight: {
      status: preflight?.supportStatus || 'missing',
      hasLocalPreflight,
      command: preflight?.command || null,
      validationCommand: preflight?.validationCommand || null,
      requiredEvidence: preflight?.requiredEvidence ? clone(preflight.requiredEvidence) : [],
      apiAccess: preflight?.apiAccess || 'none',
    },
    apiSandboxProof: {
      status: sandboxProof?.supportStatus || 'missing',
      hasLocalSandboxProof,
      command: sandboxProof?.command || null,
      validationCommand: sandboxProof?.validationCommand || null,
      requiredEvidence: sandboxProof?.requiredEvidence ? clone(sandboxProof.requiredEvidence) : [],
      apiAccess: sandboxProof?.apiAccess || 'none',
    },
    apiApplyGate: {
      status: applyGate?.supportStatus || 'missing',
      hasLocalApplyGate,
      command: applyGate?.command || null,
      validationCommand: applyGate?.validationCommand || null,
      requiredEvidence: applyGate?.requiredEvidence ? clone(applyGate.requiredEvidence) : [],
      apiAccess: applyGate?.apiAccess || 'none',
    },
    apiApprovalRecord: {
      status: approvalRecord?.supportStatus || 'missing',
      hasLocalApprovalRecord,
      command: approvalRecord?.command || null,
      validationCommand: approvalRecord?.validationCommand || null,
      requiredEvidence: approvalRecord?.requiredEvidence ? clone(approvalRecord.requiredEvidence) : [],
      apiAccess: approvalRecord?.apiAccess || 'none',
      applyEnabledInCurrentCli: approvalRecord?.applyEnabledInCurrentCli === true,
    },
    apiApplyAudit: {
      status: applyAudit?.supportStatus || 'missing',
      hasLocalApplyAudit,
      templateCommand: applyAudit?.templateCommand || null,
      writeCommand: applyAudit?.writeCommand || null,
      validationCommand: applyAudit?.validationCommand || null,
      requiredEvidence: applyAudit?.requiredEvidence ? clone(applyAudit.requiredEvidence) : [],
      apiAccess: applyAudit?.apiAccess || 'none',
      applyEnabledInCurrentCli: applyAudit?.applyEnabledInCurrentCli === true,
    },
    apiApplyReadback: {
      status: applyReadback?.supportStatus || 'missing',
      hasLocalApplyReadback,
      verificationCommand: applyReadback?.verificationCommand || null,
      requiredEvidence: applyReadback?.requiredEvidence ? clone(applyReadback.requiredEvidence) : [],
      apiAccess: applyReadback?.apiAccess || 'none',
      applyEnabledInCurrentCli: applyReadback?.applyEnabledInCurrentCli === true,
      readEnabledInCurrentCli: applyReadback?.readEnabledInCurrentCli === true,
    },
    apiApplyResult: {
      status: applyResult?.supportStatus || 'missing',
      hasLocalApplyResult,
      templateCommand: applyResult?.templateCommand || null,
      validationCommand: applyResult?.validationCommand || null,
      requiredEvidence: applyResult?.requiredEvidence ? clone(applyResult.requiredEvidence) : [],
      apiAccess: applyResult?.apiAccess || 'none',
      applyEnabledInCurrentCli: applyResult?.applyEnabledInCurrentCli === true,
      liveApplyAuthorizedByThisRecord: applyResult?.liveApplyAuthorizedByThisRecord === true,
    },
    sideEffectProfile: endpoint.sideEffectProfile ? {
      riskClass: endpoint.sideEffectProfile.riskClass,
      requiredReviews: clone(endpoint.sideEffectProfile.requiredReviews),
    } : null,
    readiness: missingEvidence.length === 0 ? 'local-write-proof-ladder-mapped' : 'needs-local-write-proof-ladder',
    missingEvidence,
    liveExecution: clone(endpoint.liveExecution),
    liveWriteSupported: isLiveApplySandboxEndpoint(endpoint.id),
    applyEnabledInCurrentCli: isLiveApplySandboxEndpoint(endpoint.id),
  };
}

function writeFamilyCoverageSummary(endpoints) {
  return sortedUnique(endpoints.map((endpoint) => endpoint.family)).map((family) => {
    const familyEndpoints = endpoints.filter((endpoint) => endpoint.family === family);
    const missingFor = (predicate) => familyEndpoints
      .filter((endpoint) => !predicate(endpoint))
      .map((endpoint) => endpoint.endpointId)
      .sort();

    return {
      family,
      writeEndpoints: familyEndpoints.length,
      endpointSpecificValidators: familyEndpoints.filter((endpoint) => endpoint.requestValidator.hasEndpointSpecificValidator).length,
      localPreviews: familyEndpoints.filter((endpoint) => endpoint.localPreview.hasLocalPreview).length,
      apiPreflights: familyEndpoints.filter((endpoint) => endpoint.apiPreflight.hasLocalPreflight).length,
      apiSandboxProofs: familyEndpoints.filter((endpoint) => endpoint.apiSandboxProof.hasLocalSandboxProof).length,
      apiApplyGates: familyEndpoints.filter((endpoint) => endpoint.apiApplyGate.hasLocalApplyGate).length,
      apiApprovalRecords: familyEndpoints.filter((endpoint) => endpoint.apiApprovalRecord.hasLocalApprovalRecord).length,
      apiApplyAudits: familyEndpoints.filter((endpoint) => endpoint.apiApplyAudit.hasLocalApplyAudit).length,
      apiApplyReadbacks: familyEndpoints.filter((endpoint) => endpoint.apiApplyReadback.hasLocalApplyReadback).length,
      apiApplyResults: familyEndpoints.filter((endpoint) => endpoint.apiApplyResult.hasLocalApplyResult).length,
      missingValidatorEndpoints: missingFor((endpoint) => endpoint.requestValidator.hasEndpointSpecificValidator),
      missingPreviewEndpoints: missingFor((endpoint) => endpoint.localPreview.hasLocalPreview),
      missingPreflightEndpoints: missingFor((endpoint) => endpoint.apiPreflight.hasLocalPreflight),
      missingSandboxProofEndpoints: missingFor((endpoint) => endpoint.apiSandboxProof.hasLocalSandboxProof),
      missingApplyGateEndpoints: missingFor((endpoint) => endpoint.apiApplyGate.hasLocalApplyGate),
      missingApprovalRecordEndpoints: missingFor((endpoint) => endpoint.apiApprovalRecord.hasLocalApprovalRecord),
      missingApplyAuditEndpoints: missingFor((endpoint) => endpoint.apiApplyAudit.hasLocalApplyAudit),
      missingApplyReadbackEndpoints: missingFor((endpoint) => endpoint.apiApplyReadback.hasLocalApplyReadback),
      missingApplyResultEndpoints: missingFor((endpoint) => endpoint.apiApplyResult.hasLocalApplyResult),
    };
  });
}

function readMissingEvidenceByCategory(endpoints) {
  return {
    missingValidatorEndpoints: endpoints
      .filter((endpoint) => !endpoint.requestValidator.hasEndpointSpecificValidator)
      .map((endpoint) => endpoint.endpointId)
      .sort(),
    missingReadPlanEndpoints: endpoints
      .filter((endpoint) => !endpoint.localReadPlan.hasLocalReadPlan)
      .map((endpoint) => endpoint.endpointId)
      .sort(),
    missingReadPlanGoldenEndpoints: endpoints
      .filter((endpoint) => !endpoint.goldenOutput.covered)
      .map((endpoint) => endpoint.endpointId)
      .sort(),
    missingReadMockEndpoints: endpoints
      .filter((endpoint) => !endpoint.readMockOutput.covered)
      .map((endpoint) => endpoint.endpointId)
      .sort(),
    missingReadPipelineGoldenEndpoints: endpoints
      .filter((endpoint) => !endpoint.readPipelineGoldenOutput.covered)
      .map((endpoint) => endpoint.endpointId)
      .sort(),
    missingPersistedReadAuditEndpoints: endpoints
      .filter((endpoint) => !endpoint.persistedReadAuditOutput.covered)
      .map((endpoint) => endpoint.endpointId)
      .sort(),
  };
}

function writeMissingEvidenceByCategory(endpoints) {
  return {
    missingValidatorEndpoints: endpoints
      .filter((endpoint) => !endpoint.requestValidator.hasEndpointSpecificValidator)
      .map((endpoint) => endpoint.endpointId)
      .sort(),
    missingPreviewEndpoints: endpoints
      .filter((endpoint) => !endpoint.localPreview.hasLocalPreview)
      .map((endpoint) => endpoint.endpointId)
      .sort(),
    missingPreflightEndpoints: endpoints
      .filter((endpoint) => !endpoint.apiPreflight.hasLocalPreflight)
      .map((endpoint) => endpoint.endpointId)
      .sort(),
    missingSandboxProofEndpoints: endpoints
      .filter((endpoint) => !endpoint.apiSandboxProof.hasLocalSandboxProof)
      .map((endpoint) => endpoint.endpointId)
      .sort(),
    missingApplyGateEndpoints: endpoints
      .filter((endpoint) => !endpoint.apiApplyGate.hasLocalApplyGate)
      .map((endpoint) => endpoint.endpointId)
      .sort(),
    missingApprovalRecordEndpoints: endpoints
      .filter((endpoint) => !endpoint.apiApprovalRecord.hasLocalApprovalRecord)
      .map((endpoint) => endpoint.endpointId)
      .sort(),
    missingApplyAuditEndpoints: endpoints
      .filter((endpoint) => !endpoint.apiApplyAudit.hasLocalApplyAudit)
      .map((endpoint) => endpoint.endpointId)
      .sort(),
    missingApplyReadbackEndpoints: endpoints
      .filter((endpoint) => !endpoint.apiApplyReadback.hasLocalApplyReadback)
      .map((endpoint) => endpoint.endpointId)
      .sort(),
    missingApplyResultEndpoints: endpoints
      .filter((endpoint) => !endpoint.apiApplyResult.hasLocalApplyResult)
      .map((endpoint) => endpoint.endpointId)
      .sort(),
  };
}

function readinessReportCommand(filters) {
  const familyFlag = filters?.family ? ` --family ${filters.family}` : '';
  return `metro api readiness${familyFlag} --json`;
}

function apiReadinessSummary(options = {}) {
  const family = options.family || null;
  const catalog = apiCatalog({ family });
  const applyGateCoverage = apiApplyGateCoverage();
  const applyAuditCoverage = apiApplyAuditCoverage();
  const applyResultCoverage = apiApplyResultCoverage();
  const applyReadbackCoverage = apiApplyReadbackCoverage();
  const approvalRecordCoverage = apiApprovalRecordCoverage();
  const sandboxProofCoverage = apiSandboxProofCoverage();
  const preflightCoverage = apiPreflightCoverage();
  const previewCoverage = apiPreviewCoverage();
  const validationCoverage = apiRequestValidationCoverage();
  const readPlanCoverage = apiReadPlanCoverage();
  const goldenByEndpoint = examplesByEndpoint(READ_PLAN_GOLDEN_EXAMPLES);
  const readMockByEndpoint = examplesByEndpoint(READ_MOCK_EXAMPLES);
  const readPipelineGoldenByEndpoint = examplesByEndpoint(READ_PIPELINE_GOLDEN_EXAMPLES);
  const persistedReadAuditByEndpoint = examplesByEndpoint(PERSISTED_READ_AUDIT_EXAMPLES);
  const readEndpoints = catalog.endpoints.filter((endpoint) => endpoint.operationType === 'read');
  const endpoints = readEndpoints.map((endpoint) => readinessFor({
    endpoint,
    validationCoverage,
    readPlanCoverage,
    goldenExamples: goldenByEndpoint[endpoint.id] || [],
    readMockExamples: readMockByEndpoint[endpoint.id] || [],
    readPipelineGoldenExamples: readPipelineGoldenByEndpoint[endpoint.id] || [],
    persistedReadAuditExamples: persistedReadAuditByEndpoint[endpoint.id] || [],
  }));
  const catalogWriteEndpoints = catalog.endpoints.filter((endpoint) => endpoint.operationType === 'write');
  const writeEndpoints = catalogWriteEndpoints.map((endpoint) => writeReadinessFor({
    endpoint,
    validationCoverage,
    previewCoverage,
    preflightCoverage,
    sandboxProofCoverage,
    applyGateCoverage,
    approvalRecordCoverage,
    applyAuditCoverage,
    applyResultCoverage,
    applyReadbackCoverage,
  }));
  const endpointSpecificValidatorCount = endpoints.filter((endpoint) => endpoint.requestValidator.hasEndpointSpecificValidator).length;
  const localReadPlanCount = endpoints.filter((endpoint) => endpoint.localReadPlan.hasLocalReadPlan).length;
  const goldenCoveredEndpointCount = endpoints.filter((endpoint) => endpoint.goldenOutput.covered).length;
  const readMockCoveredEndpointCount = endpoints.filter((endpoint) => endpoint.readMockOutput.covered).length;
  const readPipelineGoldenCoveredEndpointCount = endpoints.filter((endpoint) => endpoint.readPipelineGoldenOutput.covered).length;
  const persistedReadAuditCoveredEndpointCount = endpoints.filter((endpoint) => endpoint.persistedReadAuditOutput.covered).length;
  const writeEndpointSpecificValidatorCount = writeEndpoints.filter((endpoint) => endpoint.requestValidator.hasEndpointSpecificValidator).length;
  const localWritePreviewCount = writeEndpoints.filter((endpoint) => endpoint.localPreview.hasLocalPreview).length;
  const localApiPreflightCount = writeEndpoints.filter((endpoint) => endpoint.apiPreflight.hasLocalPreflight).length;
  const localApiSandboxProofCount = writeEndpoints.filter((endpoint) => endpoint.apiSandboxProof.hasLocalSandboxProof).length;
  const localApiApplyGateCount = writeEndpoints.filter((endpoint) => endpoint.apiApplyGate.hasLocalApplyGate).length;
  const localApiApprovalRecordCount = writeEndpoints.filter((endpoint) => endpoint.apiApprovalRecord.hasLocalApprovalRecord).length;
  const localApiApplyAuditCount = writeEndpoints.filter((endpoint) => endpoint.apiApplyAudit.hasLocalApplyAudit).length;
  const localApiApplyReadbackCount = writeEndpoints.filter((endpoint) => endpoint.apiApplyReadback.hasLocalApplyReadback).length;
  const localApiApplyResultCount = writeEndpoints.filter((endpoint) => endpoint.apiApplyResult.hasLocalApplyResult).length;

  return {
    schemaVersion: API_READINESS_SCHEMA_VERSION,
    generatedFrom: [
      'metronome-cli/src/api-catalog/index.js',
      'metronome-cli/src/api-catalog/apply-gate.js',
      'metronome-cli/src/api-catalog/apply-audit.js',
      'metronome-cli/src/api-catalog/apply-result.js',
      'metronome-cli/src/api-catalog/apply-readback.js',
      'metronome-cli/src/api-catalog/approval-record.js',
      'metronome-cli/src/api-catalog/preflight.js',
      'metronome-cli/src/api-catalog/preview.js',
      'metronome-cli/src/api-catalog/readiness.js',
      'metronome-cli/src/api-catalog/read-plan.js',
      'metronome-cli/src/api-catalog/read-mock.js',
      'metronome-cli/src/api-catalog/read-pipeline.js',
      'metronome-cli/src/api-catalog/read-audit.js',
      'metronome-cli/src/api-catalog/validation.js',
    ],
    apiAccess: 'none',
    liveExecution: clone(catalog.liveExecution),
    filters: { family },
    catalogEndpointCount: catalog.endpointCount,
    readEndpointCount: endpoints.length,
    writeEndpointCount: writeEndpoints.length,
    summary: {
      endpointSpecificValidators: endpointSpecificValidatorCount,
      localReadPlans: localReadPlanCount,
      goldenCoveredEndpoints: goldenCoveredEndpointCount,
      missingGoldenEndpoints: endpoints.length - goldenCoveredEndpointCount,
      readMockExamples: endpoints.reduce((count, endpoint) => count + endpoint.readMockOutput.exampleCount, 0),
      readMockCoveredEndpoints: readMockCoveredEndpointCount,
      missingReadMockEndpoints: endpoints.length - readMockCoveredEndpointCount,
      readPipelineGoldenExamples: endpoints.reduce((count, endpoint) => count + endpoint.readPipelineGoldenOutput.exampleCount, 0),
      readPipelineGoldenCoveredEndpoints: readPipelineGoldenCoveredEndpointCount,
      missingReadPipelineGoldenEndpoints: endpoints.length - readPipelineGoldenCoveredEndpointCount,
      persistedReadAuditExamples: endpoints.reduce((count, endpoint) => count + endpoint.persistedReadAuditOutput.exampleCount, 0),
      persistedReadAuditCoveredEndpoints: persistedReadAuditCoveredEndpointCount,
      missingPersistedReadAuditEndpoints: endpoints.length - persistedReadAuditCoveredEndpointCount,
      liveReadEnabledInCurrentCli: LIVE_READ_ENDPOINT_IDS.size > 0,
    },
    writeSummary: {
      endpointSpecificValidators: writeEndpointSpecificValidatorCount,
      localPreviews: localWritePreviewCount,
      missingLocalPreviews: writeEndpoints.length - localWritePreviewCount,
      apiPreflights: localApiPreflightCount,
      missingApiPreflights: writeEndpoints.length - localApiPreflightCount,
      apiSandboxProofs: localApiSandboxProofCount,
      missingApiSandboxProofs: writeEndpoints.length - localApiSandboxProofCount,
      apiApplyGates: localApiApplyGateCount,
      missingApiApplyGates: writeEndpoints.length - localApiApplyGateCount,
      apiApprovalRecords: localApiApprovalRecordCount,
      missingApiApprovalRecords: writeEndpoints.length - localApiApprovalRecordCount,
      apiApplyAudits: localApiApplyAuditCount,
      missingApiApplyAudits: writeEndpoints.length - localApiApplyAuditCount,
      apiApplyReadbacks: localApiApplyReadbackCount,
      missingApiApplyReadbacks: writeEndpoints.length - localApiApplyReadbackCount,
      apiApplyResults: localApiApplyResultCount,
      missingApiApplyResults: writeEndpoints.length - localApiApplyResultCount,
      applyEnabledInCurrentCli: LIVE_APPLY_SANDBOX_ENDPOINT_IDS.size > 0,
      liveWriteEnabledInCurrentCli: LIVE_APPLY_SANDBOX_ENDPOINT_IDS.size > 0,
    },
    writeProofLadder: writeProofLadder(),
    coverageByFamily: familyCoverageSummary(endpoints),
    writeCoverageByFamily: writeFamilyCoverageSummary(writeEndpoints),
    readinessStatuses: endpoints.reduce((counts, endpoint) => {
      counts[endpoint.readiness] = (counts[endpoint.readiness] || 0) + 1;
      return counts;
    }, {}),
    writeReadinessStatuses: writeEndpoints.reduce((counts, endpoint) => {
      counts[endpoint.readiness] = (counts[endpoint.readiness] || 0) + 1;
      return counts;
    }, {}),
    goldenCoverageTypes: sortedUnique(endpoints.flatMap((endpoint) => endpoint.goldenOutput.coverageTypes)),
    readMockCoverageTypes: sortedUnique(endpoints.flatMap((endpoint) => endpoint.readMockOutput.coverageTypes)),
    readPipelineGoldenCoverageTypes: sortedUnique(endpoints.flatMap((endpoint) => endpoint.readPipelineGoldenOutput.coverageTypes)),
    persistedReadAuditCoverageTypes: sortedUnique(endpoints.flatMap((endpoint) => endpoint.persistedReadAuditOutput.coverageTypes)),
    nextSafeStep: endpoints.every((endpoint) => endpoint.readiness === 'full-local-read-evidence')
      ? (LIVE_READ_ENDPOINT_IDS.size > 0
        ? `Guarded live reads are enabled for ${LIVE_READ_ENDPOINT_IDS.size} reviewed endpoint(s). Use metro api read with read-gate evidence and --confirm-live-read. Remaining read endpoints stay local-only until added to the live allowlist.`
        : 'All reviewed read endpoints have local read-plan goldens, read-mock evidence, read-pipeline audit dry-run goldens, and persisted read-audit validation proof. Live reads remain disabled until tenant profiles, guarded read clients, current-turn authorization, audit-safe request summaries, and stable output verification exist.')
      : 'Add local read-plan, read-mock, read-pipeline, and persisted read-audit evidence for endpoints marked needs-local-read-evidence before treating their output as a stable operator/agent contract. Live reads remain disabled.',
    writeNextSafeStep: writeEndpoints.every((endpoint) => endpoint.readiness === 'local-write-proof-ladder-mapped')
      ? (LIVE_APPLY_SANDBOX_ENDPOINT_IDS.size > 0
        ? `Guarded sandbox writes are enabled for ${LIVE_APPLY_SANDBOX_ENDPOINT_IDS.size} reviewed endpoint(s). Use metro api apply with apply-gate, approval-record, and --confirm-live-apply. Production writes and other endpoints stay blocked.`
        : 'All reviewed write endpoints have local request validators, api preview contracts, api preflight contracts, api sandbox-proof templates, api apply-gate manifests, approval-record contracts, planned apply-audit contracts, apply read-back verifiers, and apply-result contracts mapped. Expert API writes remain disabled until guarded apply runners, filled sandbox proof, live audit writing, semantic read-back execution, rollback evidence, permission enforcement, and explicit current-turn authorization exist.')
      : 'Add local api preview, api preflight, api sandbox-proof, api apply-gate, approval-record, apply-audit, apply-readback, and apply-result coverage for write endpoints marked needs-local-write-proof-ladder. Expert API writes remain disabled.',
    endpoints,
    writeEndpoints,
  };
}

function apiReadinessCompactSummary(options = {}) {
  const full = apiReadinessSummary(options);
  const readEndpointsWithMissingEvidence = full.endpoints
    .filter((endpoint) => endpoint.missingEvidence.length > 0)
    .map((endpoint) => ({
      endpointId: endpoint.endpointId,
      family: endpoint.family,
      missingEvidence: clone(endpoint.missingEvidence),
    }));
  const writeEndpointsWithMissingEvidence = full.writeEndpoints
    .filter((endpoint) => endpoint.missingEvidence.length > 0)
    .map((endpoint) => ({
      endpointId: endpoint.endpointId,
      family: endpoint.family,
      missingEvidence: clone(endpoint.missingEvidence),
    }));

  return {
    schemaVersion: API_READINESS_SUMMARY_SCHEMA_VERSION,
    generatedFrom: clone(full.generatedFrom),
    apiAccess: full.apiAccess,
    liveExecution: clone(full.liveExecution),
    filters: clone(full.filters),
    catalogEndpointCount: full.catalogEndpointCount,
    readEndpointCount: full.readEndpointCount,
    writeEndpointCount: full.writeEndpointCount,
    summary: clone(full.summary),
    writeSummary: clone(full.writeSummary),
    readinessStatuses: clone(full.readinessStatuses),
    writeReadinessStatuses: clone(full.writeReadinessStatuses),
    coverageByFamily: clone(full.coverageByFamily),
    writeCoverageByFamily: clone(full.writeCoverageByFamily),
    missingEvidence: {
      readEndpointCount: readEndpointsWithMissingEvidence.length,
      writeEndpointCount: writeEndpointsWithMissingEvidence.length,
      readByCategory: readMissingEvidenceByCategory(full.endpoints),
      writeByCategory: writeMissingEvidenceByCategory(full.writeEndpoints),
      readEndpoints: readEndpointsWithMissingEvidence,
      writeEndpoints: writeEndpointsWithMissingEvidence,
    },
    writeProofLadderStepCount: full.writeProofLadder.length,
    fullReportCommand: readinessReportCommand(full.filters),
    nextSafeStep: full.nextSafeStep,
    writeNextSafeStep: full.writeNextSafeStep,
  };
}

module.exports = {
  API_READINESS_SCHEMA_VERSION,
  API_READINESS_SUMMARY_SCHEMA_VERSION,
  READ_PLAN_GOLDEN_EXAMPLES,
  READ_MOCK_EXAMPLES,
  READ_PIPELINE_GOLDEN_EXAMPLES,
  PERSISTED_READ_AUDIT_EXAMPLES,
  apiReadinessCompactSummary,
  apiReadinessSummary,
};
