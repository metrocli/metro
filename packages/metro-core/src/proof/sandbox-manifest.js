'use strict';

const { isSandboxProofSupported, isPackagePlanMoveShape } = require('../evidence-gates/support');

const REVIEWED_ENDPOINT_SOURCE_IDS = new Set([
  'api-operations',
  'conventions',
  'danger-zone',
  'metronome-invoicing',
  'metronome-stripe-delivery',
  'packages-contracts',
  'shape-catalog',
]);

const VALID_RESULT = new Set(['passed']);
const SECRET_KEY_PATTERN = /(secret|token|api[_-]?key|authorization|bearer|password|private[_-]?key)/i;
const SECRET_VALUE_PATTERN = /(sk_live_|sk_test_|pk_live_|prod_[A-Za-z0-9]{12,}|Bearer\s+[A-Za-z0-9._-]+)/;
const PRODUCTION_COMMAND_PATTERN = /(^|\s)--prod(uction)?(\s|$)|METRONOME_PROD_KEY|ALLOW_DANGEROUS_SCRIPT/;

function nonEmpty(value) {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function isObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function isSha256(value) {
  return typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
}

function finding(id, severity, message, path, remediation) {
  return { id, severity, message, path, remediation };
}

function endpointPlan(workflow, shape) {
  if (workflow === 'customer.setup' && shape === 'customer-setup') {
    return [
      {
        method: 'GET',
        path: '/v1/customers?ingest_alias={alias}&only_archived=false',
        sourceIds: ['endpoint-matrix', 'official-customer-list', 'shape-catalog'],
        purpose: 'Search sandbox customer aliases before create so active or archived alias collisions are reviewed.',
      },
      {
        method: 'POST',
        path: '/v1/customers',
        sourceIds: ['endpoint-matrix', 'official-customer-create', 'shape-catalog'],
        purpose: 'Create exactly one sandbox customer with reviewed identity, aliases, custom fields, and optional inline Stripe billing-provider config.',
      },
      {
        method: 'POST',
        path: '/v1/customers/{customer_id}/updateConfig',
        sourceIds: ['endpoint-matrix', 'official-customer-update-config', 'metronome-stripe-delivery'],
        purpose: 'Set reviewed customer configuration fields such as salesforce_account_id and leave_stripe_invoices_in_draft when present in the preview.',
      },
    ];
  }
  if (workflow === 'package.apply' && shape === 'pro-annual') {
    return [
      {
        method: 'POST',
        path: '/v1/packages/create',
        sourceIds: ['endpoint-matrix', 'official-package-create'],
        purpose: 'Create or version the Pro Annual package after sandbox proof and approval.',
      },
    ];
  }
  if (workflow === 'contract.move-plan.apply' && isPackagePlanMoveShape(shape)) {
    return [
      {
        method: 'POST',
        path: '/v1/contracts/updateEndDate',
        sourceIds: ['endpoint-matrix', 'official-contract-update-end-date', 'danger-zone'],
        purpose: 'End the predecessor contract at the reviewed future cutover while protecting finalized invoices.',
      },
      {
        method: 'POST',
        path: '/v1/contracts/create',
        sourceIds: ['endpoint-matrix', 'official-contract-create', 'packages-contracts'],
        purpose: 'Create the successor package contract with transition.type RENEWAL from the predecessor.',
      },
    ];
  }
  if (workflow === 'credit.apply' && shape === 'paid-credit-top-up') {
    return [
      {
        method: 'POST',
        path: '/v2/contracts/edit',
        sourceIds: ['endpoint-matrix', 'official-contract-edit', 'danger-zone', 'commits-credits', 'metronome-invoicing', 'metronome-stripe-delivery'],
        purpose: 'Add the sandbox paid top-up commit with fiat invoice schedule and STRIPE payment gate from the reviewed preview.',
      },
    ];
  }
  if (workflow === 'credit.apply' && shape === 'complimentary-credit-grant') {
    return [
      {
        method: 'POST',
        path: '/v2/contracts/edit',
        sourceIds: ['endpoint-matrix', 'official-contract-edit', 'danger-zone', 'commits-credits'],
        purpose: 'Add the sandbox complimentary PREPAID commit from the reviewed preview, omitting invoice_schedule for pure access grants unless the reviewed input intentionally uses a USD zero-dollar audit line.',
      },
    ];
  }
  if (workflow === 'subscription.contract.apply' && shape === 'direct-subscription-contract') {
    return [
      {
        method: 'POST',
        path: '/v1/contracts/create',
        sourceIds: ['endpoint-matrix', 'official-contract-create', 'subscriptions-seats', 'packages-contracts', 'metronome-stripe-delivery'],
        purpose: 'Create the sandbox direct subscription contract with reviewed product, billing frequency, quantity or seat source, and Stripe behavior.',
      },
    ];
  }
  if (workflow === 'custom-contract.create' && shape === 'enterprise-custom-contract') {
    return [
      {
        method: 'POST',
        path: '/v1/customers',
        sourceIds: ['endpoint-matrix', 'official-customer-create', 'custom-contract-payloads'],
        purpose: 'Conditionally create the sandbox Metronome customer only when the reviewed preview uses createMetronomeCustomer.',
      },
      {
        method: 'POST',
        path: '/v1/setCustomerBillingProviderConfigurations',
        sourceIds: ['endpoint-matrix', 'official-billing-provider', 'custom-contract-payloads', 'metronome-stripe-delivery'],
        purpose: 'Attach or reuse the sandbox Stripe billing-provider configuration before invoice-producing custom contract creation.',
      },
      {
        method: 'POST',
        path: '/v1/contracts/create',
        sourceIds: ['endpoint-matrix', 'official-contract-create', 'custom-contract-payloads'],
        purpose: 'Create the sandbox direct enterprise custom contract with reviewed rate card, uniqueness key, recurring commit, invoice behavior, and optional seat subscription wiring.',
      },
      {
        method: 'POST',
        path: '/v2/contracts/edit',
        sourceIds: ['endpoint-matrix', 'official-contract-edit', 'custom-contract-payloads', 'danger-zone'],
        purpose: 'Conditionally add sandbox bonus commits only after contract create read-back and duplicate commit-name review pass.',
      },
      {
        method: 'POST',
        path: '/v2/contracts/edit',
        sourceIds: ['endpoint-matrix', 'official-contract-edit', 'custom-contract-payloads', 'subscriptions-seats'],
        purpose: 'Conditionally add sandbox initial seat assignments only after the created seat subscription id is read back.',
      },
    ];
  }
  if (workflow === 'billing-provider.attach' && shape === 'stripe-billing-provider-attachment') {
    return [
      {
        method: 'POST',
        path: '/v1/setCustomerBillingProviderConfigurations',
        sourceIds: ['endpoint-matrix', 'official-billing-provider', 'metronome-stripe-delivery'],
        purpose: 'Attach or reuse the sandbox Stripe billing-provider configuration with reviewed delivery routing.',
      },
      {
        method: 'POST',
        path: '/v1/customers/{customer_id}/updateConfig',
        sourceIds: ['endpoint-matrix', 'official-customer-update-config', 'metronome-stripe-delivery'],
        purpose: 'Set the sandbox customer leave_stripe_invoices_in_draft behavior from the reviewed preview.',
      },
    ];
  }
  if (workflow === 'invoice.issue-date-update' && shape === 'invoice-issue-date-update') {
    return [
      {
        method: 'POST',
        path: '/v1/contracts/updateInvoiceIssueDate',
        sourceIds: ['endpoint-matrix', 'official-invoice-issue-date', 'metronome-invoicing', 'metronome-stripe-delivery'],
        purpose: 'Move the sandbox DRAFT invoice issue date forward through the contract-scoped endpoint from the reviewed preview.',
      },
    ];
  }
  if (workflow === 'product.rate-retirement' && shape === 'product-rate-retirement') {
    return [
      {
        method: 'POST',
        path: '/v1/contract-pricing/rate-cards/addRates',
        sourceIds: ['endpoint-matrix', 'official-rate-card-add-rates', 'danger-zone'],
        purpose: 'Close sandbox active product rates with entitled:false, price:0 entries from the reviewed preview.',
      },
      {
        method: 'POST',
        path: '/v1/contract-pricing/products/archive',
        sourceIds: ['endpoint-matrix', 'official-product-archive', 'danger-zone'],
        purpose: 'Optionally archive the sandbox product only after rate close read-back proves the rates were closed.',
      },
    ];
  }
  if (workflow === 'rate-card.dimensional.apply' && shape === 'dimensional-rate-card') {
    return [
      {
        method: 'POST',
        path: '/v1/contract-pricing/products/create',
        sourceIds: ['endpoint-matrix', 'official-product-create', 'pricing-catalog', 'billable-metrics'],
        purpose: 'Create or reuse the sandbox dimensional USAGE product with reviewed metric and group-key evidence.',
      },
      {
        method: 'POST',
        path: '/v1/contract-pricing/rate-cards/addRates',
        sourceIds: ['endpoint-matrix', 'official-rate-card-add-rates', 'pricing-catalog', 'danger-zone'],
        purpose: 'Append sandbox dimensional action-code rates from the reviewed preview after canary read-back.',
      },
    ];
  }
  if (workflow === 'package.archive' && shape === 'package-alias-archive-handoff') {
    return [
      {
        method: 'POST',
        path: '/v1/packages/archive',
        sourceIds: ['endpoint-matrix', 'official-package-archive', 'packages-contracts'],
        purpose: 'Archive the sandbox old package version only after replacement alias handoff is proven live.',
      },
    ];
  }
  if (workflow === 'usage.ingest-preview' && shape === 'usage-ingest-preview') {
    return [
      {
        method: 'POST',
        path: '/v1/customers/{customer_id}/previewEvents',
        sourceIds: ['endpoint-matrix', 'official-invoice-preview-events', 'metronome-invoicing'],
        purpose: 'Preview sandbox invoice impact for the full reviewed usage event batch before any ingest write.',
      },
      {
        method: 'POST',
        path: '/v1/ingest',
        sourceIds: ['endpoint-matrix', 'official-usage-ingest', 'metronome-ingestion-events', 'danger-zone'],
        purpose: 'Ingest the sandbox canary usage event set with stable transaction_id values.',
      },
      {
        method: 'POST',
        path: '/v1/ingest',
        sourceIds: ['endpoint-matrix', 'official-usage-ingest', 'metronome-ingestion-events', 'danger-zone'],
        purpose: 'Ingest any remaining sandbox usage events only after canary read-back proves the batch is safe to continue.',
      },
    ];
  }
  return [];
}

function buildDimensionalSandboxProofTemplate({ workflow, shape }) {
  return {
    schemaVersion: 'metro.sandbox-proof.v1',
    workflow,
    shape,
    tenant: 'sandbox',
    localOnly: true,
    status: 'template',
    proofPurpose: 'Record sandbox evidence that a dimensional rate-card change was previewed, preflighted, canary-applied, audited, product/rate/usage/invoice-verified, and still blocked from production apply.',
    maturityGate: {
      from: 'local-validated',
      to: 'sandbox-proven',
      productionApplyAllowed: false,
    },
    preview: {
      command: 'metro rate-card dimensional preview --file <input.json|yaml> --sandbox --json',
      outputPath: '<path-to-reviewed-sandbox-preview-json>',
      payloadHash: 'sha256:<64 lowercase hex preview hash>',
    },
    preflight: {
      command: 'metro preflight validate --file <preflight.json> --json',
      filePath: '<path-to-sandbox-preflight-json>',
      fileHash: 'sha256:<64 lowercase hex preflight file hash>',
      validationResult: 'passed',
    },
    audit: {
      command: 'metro audit validate --file <audit.jsonl> --json',
      filePath: '<path-to-sandbox-audit-jsonl>',
      fileHash: 'sha256:<64 lowercase hex audit file hash>',
      rowCount: 2,
      validationResult: 'passed',
    },
    sandboxExecution: {
      applyCommand: 'metro rate-card dimensional apply --file <input.json|yaml> --sandbox --confirm-hash <hash>',
      enabledInCurrentCli: false,
      endpoints: endpointPlan(workflow, shape),
      targetIds: [
        { system: 'metronome', role: 'rate_card_id', id: '<sandbox-rate-card-id>' },
        { system: 'metronome', role: 'usage_product_name', id: '<sandbox-usage-product-name>' },
        { system: 'metronome', role: 'billable_metric_id', id: '<sandbox-billable-metric-id>' },
        { system: 'metronome', role: 'starting_at', id: '<sandbox-dimensional-starting-at>' },
        { system: 'metronome', role: 'action_code_set_hash', id: '<sha256-of-reviewed-action-codes>' },
      ],
      canary: {
        required: true,
        objectCount: 1,
        result: 'passed',
        evidence: [
          {
            type: '<ui-screenshot|inspect-output|operator-note>',
            path: '<sandbox-dimensional-canary-evidence-path>',
            hash: 'sha256:<64 lowercase hex evidence hash>',
          },
        ],
      },
      productionWritten: false,
    },
    verification: {
      readBack: [
        {
          method: 'POST',
          path: '/v1/contract-pricing/products/get',
          expectation: 'Sandbox product read-back shows one USAGE product with reviewed billable_metric_id, pricing_group_key, presentation_group_key, and tags.',
          evidencePath: '<path-to-product-readback-evidence-json>',
          evidenceHash: 'sha256:<64 lowercase hex readback evidence hash>',
          result: 'passed',
        },
        {
          method: 'POST',
          path: '/v1/contract-pricing/rate-cards/getRateSchedule',
          expectation: 'Sandbox rate schedule shows each reviewed action_code row at starting_at with entitled:true, FLAT rate type, price, and credit type from the preview.',
          evidencePath: '<path-to-rate-schedule-readback-evidence-json>',
          evidenceHash: 'sha256:<64 lowercase hex readback evidence hash>',
          result: 'passed',
        },
        {
          method: 'POST',
          path: '/v1/contract-pricing/rate-cards/getRates',
          expectation: 'Sandbox getRates selector read-back returns the intended dimensional rates without duplicate entitled rows.',
          evidencePath: '<path-to-get-rates-selector-evidence-json>',
          evidenceHash: 'sha256:<64 lowercase hex readback evidence hash>',
          result: 'passed',
        },
        {
          method: 'POST',
          path: '/v1/usage/groups',
          expectation: 'Sandbox usage groups prove canary events include action_code and action_display_name under the compound metric group key.',
          evidencePath: '<path-to-usage-groups-readback-evidence-json>',
          evidenceHash: 'sha256:<64 lowercase hex readback evidence hash>',
          result: 'passed',
        },
        {
          method: 'GET',
          path: '/v1/customers/{customer_id}/invoices',
          expectation: 'Sandbox invoice preview or inventory read-back shows no surprise invoice, duplicate billable line, or Stripe delivery side effect before remaining rates are applied.',
          evidencePath: '<path-to-invoice-impact-readback-evidence-json>',
          evidenceHash: 'sha256:<64 lowercase hex readback evidence hash>',
          result: 'passed',
        },
      ],
      inspectEvidence: [
        {
          command: 'metro verify inspect-output --file <inspect-output.json> --json',
          filePath: '<path-to-local-inspect-output-json>',
          fileHash: 'sha256:<64 lowercase hex inspect output hash>',
          validationResult: 'passed',
        },
      ],
    },
    rollback: {
      plan: '<sandbox-tested plan to stop retries, inspect product/rate schedule/getRates/usage/invoice impact, close mistaken dimensional rates with owner-approved corrective addRates entries, and archive accidental test products only after rate state is proven>',
      testedInSandbox: true,
      owner: '<billing-ops-owner>',
    },
    idempotency: {
      strategy: '<compare sandbox products by reviewed usage product name, billable metric id, pricing_group_key, presentation_group_key, and current rate schedule before products/create or addRates>',
      duplicatePrevention: '<retry only after product, getRates selector, and rate-schedule read-back prove the product or action_code rate row was not already created>',
    },
    blockedProduction: {
      productionApplySupported: false,
      reason: 'Sandbox proof is evidence for maturity only; production apply still requires prod-approved shape status, owner approval, exact preview hash confirmation, audit logging, read-back verification, and rollback review.',
      requiredBeforeProduction: [
        'prod-approved dimensional rate-card shape maturity',
        'production preflight approval',
        'production confirmation tied to exact preview hash',
        'production product/rate schedule/usage/invoice read-back verification plan',
      ],
    },
    sources: [
      'docs/metronome-cli/one-goal.md',
      'docs/metronome-cli/SHAPE_CATALOG.md',
      'docs/metronome-cli/CLI_ARCHITECTURE.md',
      'docs/metronome-cli/VALIDATION_AND_GUARDRAILS.md',
      '.cursor/skills/metronome-danger-zone/SKILL.md',
      '.cursor/skills/metronome-danger-zone/references/endpoint-matrix.md',
      '.cursor/skills/metronome-pricing-catalog/SKILL.md',
      '.cursor/skills/metronome-billable-metrics/SKILL.md',
    ],
  };
}

function buildSandboxProofTemplate({ workflow, shape }) {
  if (!isSandboxProofSupported(workflow, shape)) return null;
  if (workflow === 'rate-card.dimensional.apply' && shape === 'dimensional-rate-card') {
    return buildDimensionalSandboxProofTemplate({ workflow, shape });
  }
  const isCustomerSetup = workflow === 'customer.setup' && shape === 'customer-setup';
  const isContractMove = workflow === 'contract.move-plan.apply';
  const isComplimentaryCredit = workflow === 'credit.apply' && shape === 'complimentary-credit-grant';
  const isPaidTopUp = workflow === 'credit.apply' && shape === 'paid-credit-top-up';
  const isDirectSubscription = workflow === 'subscription.contract.apply' && shape === 'direct-subscription-contract';
  const isCustomContract = workflow === 'custom-contract.create' && shape === 'enterprise-custom-contract';
  const isBillingProvider = workflow === 'billing-provider.attach' && shape === 'stripe-billing-provider-attachment';
  const isInvoiceIssueDate = workflow === 'invoice.issue-date-update' && shape === 'invoice-issue-date-update';
  const isProductRetirement = workflow === 'product.rate-retirement' && shape === 'product-rate-retirement';
  const isPackageArchive = workflow === 'package.archive' && shape === 'package-alias-archive-handoff';
  const isUsageIngest = workflow === 'usage.ingest-preview' && shape === 'usage-ingest-preview';

  return {
    schemaVersion: 'metro.sandbox-proof.v1',
    workflow,
    shape,
    tenant: 'sandbox',
    localOnly: true,
    status: 'template',
    proofPurpose: isCustomerSetup
      ? 'Record sandbox evidence that customer setup was previewed, preflighted, alias-checked, canary-applied, audited, customer/alias/billing-provider/invoice-verified, and still blocked from production apply.'
      : isContractMove
      ? 'Record sandbox evidence that a package plan move was previewed, preflighted, canary-applied, audited, verified, and still blocked from production apply.'
      : isComplimentaryCredit
        ? 'Record sandbox evidence that a complimentary credit grant was previewed, preflighted, canary-applied, audited, balance/invoice-verified, and still blocked from production apply.'
      : isPaidTopUp
        ? 'Record sandbox evidence that a paid credit top-up was previewed, preflighted, canary-applied, audited, balance/invoice/Stripe-verified, and still blocked from production apply.'
        : isDirectSubscription
          ? 'Record sandbox evidence that a direct subscription contract was previewed, preflighted, canary-applied, audited, subscription-history/invoice/Stripe-verified, and still blocked from production apply.'
          : isCustomContract
            ? 'Record sandbox evidence that an enterprise custom contract was previewed, preflighted, canary-applied, audited, customer/billing-provider/contract/balance/invoice/seat-verified, and still blocked from production apply.'
            : isBillingProvider
              ? 'Record sandbox evidence that a Stripe billing-provider attachment was previewed, preflighted, canary-applied, audited, customer/config/delivery-verified, and still blocked from production apply.'
            : isInvoiceIssueDate
              ? 'Record sandbox evidence that an invoice issue-date update was previewed, preflighted, canary-applied, audited, DRAFT-invoice/contract/Stripe-verified, and still blocked from production apply.'
              : isProductRetirement
                ? 'Record sandbox evidence that a product/rate retirement was previewed, preflighted, canary-applied, audited, rate-schedule/product/invoice-verified, and still blocked from production apply.'
                : isPackageArchive
                  ? 'Record sandbox evidence that a package alias archive handoff was previewed, preflighted, canary-applied, audited, alias/package/contracts-on-package-verified, and still blocked from production apply.'
                  : isUsageIngest
                    ? 'Record sandbox evidence that usage ingest was previewEvents-checked, canary-ingested, audited, event-search/usage-groups/invoice-verified, and still blocked from production apply.'
            : 'Record sandbox evidence that a future write shape was previewed, preflighted, applied as a canary, audited, verified, and still blocked from production apply.',
    maturityGate: {
      from: 'local-validated',
      to: 'sandbox-proven',
      productionApplyAllowed: false,
    },
    preview: {
      command: isCustomerSetup
        ? 'metro customer setup preview --file <input.json|yaml> --sandbox --json'
        : isContractMove
        ? 'metro contract move-plan preview --file <input.json|yaml> --sandbox --json'
        : isComplimentaryCredit
          ? 'metro credit preview --shape complimentary-credit-grant --file <input.json|yaml> --sandbox --json'
        : isPaidTopUp
          ? 'metro credit preview --shape paid-credit-top-up --file <input.json|yaml> --sandbox --json'
          : isDirectSubscription
            ? 'metro subscription contract preview --shape direct-subscription-contract --file <input.json|yaml> --sandbox --json'
            : isCustomContract
              ? 'metro custom-contract preview --file <input.json|yaml> --sandbox --json'
              : isBillingProvider
                ? 'metro billing-provider preview --shape stripe-billing-provider-attachment --file <input.json|yaml> --sandbox --json'
              : isInvoiceIssueDate
                ? 'metro invoice issue-date preview --file <input.json|yaml> --sandbox --json'
                : isProductRetirement
                ? 'metro product retire preview --file <input.json|yaml> --sandbox --json'
                : isPackageArchive
                  ? 'metro package archive preview --file <input.json|yaml> --sandbox --json'
                  : isUsageIngest
                    ? 'metro usage ingest preview --file <input.json|yaml> --sandbox --json'
              : 'metro package preview --shape pro-annual --file <input.json|yaml> --sandbox --json',
      outputPath: '<path-to-reviewed-sandbox-preview-json>',
      payloadHash: 'sha256:<64 lowercase hex preview hash>',
    },
    preflight: {
      command: 'metro preflight validate --file <preflight.json> --json',
      filePath: '<path-to-sandbox-preflight-json>',
      fileHash: 'sha256:<64 lowercase hex preflight file hash>',
      validationResult: 'passed',
    },
    audit: {
      command: 'metro audit validate --file <audit.jsonl> --json',
      filePath: '<path-to-sandbox-audit-jsonl>',
      fileHash: 'sha256:<64 lowercase hex audit file hash>',
      rowCount: isCustomContract ? 5 : isCustomerSetup ? 3 : isBillingProvider ? 2 : isUsageIngest ? 3 : 1,
      validationResult: 'passed',
    },
    sandboxExecution: {
      applyCommand: isCustomerSetup
        ? 'metro customer setup apply --file <input.json|yaml> --sandbox --confirm-hash <hash>'
        : isContractMove
        ? 'metro contract move-plan apply --file <input.json|yaml> --sandbox --confirm-hash <hash>'
        : isComplimentaryCredit
          ? 'metro credit apply --shape complimentary-credit-grant --file <input.json|yaml> --sandbox --confirm-hash <hash>'
        : isPaidTopUp
          ? 'metro credit apply --shape paid-credit-top-up --file <input.json|yaml> --sandbox --confirm-hash <hash>'
          : isDirectSubscription
            ? 'metro subscription contract apply --file <input.json|yaml> --sandbox --confirm-hash <hash>'
            : isCustomContract
              ? 'metro custom-contract apply --file <input.json|yaml> --sandbox --confirm-hash <hash>'
              : isBillingProvider
                ? 'metro billing-provider apply --shape stripe-billing-provider-attachment --file <input.json|yaml> --sandbox --confirm-hash <hash>'
              : isInvoiceIssueDate
                ? 'metro invoice issue-date apply --file <input.json|yaml> --sandbox --confirm-hash <hash>'
                : isProductRetirement
                ? 'metro product retire apply --file <input.json|yaml> --sandbox --confirm-hash <hash>'
                : isPackageArchive
                  ? 'metro package archive apply --file <input.json|yaml> --sandbox --confirm-hash <hash>'
                  : isUsageIngest
                    ? 'metro usage ingest apply --file <input.json|yaml> --sandbox --confirm-hash <hash>'
              : 'metro package apply --shape pro-annual --file <input.json|yaml> --sandbox --confirm-hash <hash>',
      enabledInCurrentCli: false,
      endpoints: endpointPlan(workflow, shape),
      targetIds: isCustomerSetup
        ? [
          { system: 'lev', role: 'account_id', id: '<sandbox-lev-account-id>' },
          { system: 'metronome', role: 'primary_ingest_alias', id: '<sandbox-primary-ingest-alias>' },
          { system: 'metronome', role: 'ingest_alias_set_hash', id: '<sha256-of-reviewed-ingest-aliases>' },
          { system: 'metronome', role: 'customer_id_after_readback', id: '<sandbox-created-or-reused-customer-id>' },
          { system: 'stripe', role: 'customer_id', id: '<sandbox-stripe-customer-id-or-verified-none>' },
          { system: 'metronome', role: 'delivery_method_id_or_direct', id: '<sandbox-delivery-method-id-or-direct-or-none>' },
        ]
        : isContractMove
        ? [
          { system: 'metronome', role: 'customer_id', id: '<sandbox-customer-id>' },
          { system: 'metronome', role: 'current_contract_id', id: '<sandbox-predecessor-contract-id>' },
          { system: 'metronome', role: 'target_package_alias', id: '<sandbox-target-package-alias>' },
        ]
        : isComplimentaryCredit
          ? [
            { system: 'metronome', role: 'customer_id', id: '<sandbox-customer-id>' },
            { system: 'metronome', role: 'contract_id', id: '<sandbox-contract-id>' },
            { system: 'metronome', role: 'product_id', id: '<sandbox-product-id-or-verified-none>' },
            { system: 'metronome', role: 'commit_name', id: '<sandbox-complimentary-commit-name>' },
            { system: 'metronome', role: 'access_credit_type_id', id: '<sandbox-access-credit-type-id>' },
          ]
        : isPaidTopUp
          ? [
            { system: 'metronome', role: 'customer_id', id: '<sandbox-customer-id>' },
            { system: 'metronome', role: 'contract_id', id: '<sandbox-contract-id>' },
            { system: 'metronome', role: 'product_id', id: '<sandbox-product-id>' },
            { system: 'stripe', role: 'customer_id', id: '<sandbox-stripe-customer-id-or-verified-none>' },
          ]
          : isDirectSubscription
            ? [
              { system: 'metronome', role: 'customer_id', id: '<sandbox-customer-id>' },
              { system: 'metronome', role: 'rate_card_id', id: '<sandbox-rate-card-id>' },
              { system: 'metronome', role: 'subscription_product_id', id: '<sandbox-subscription-product-id>' },
              { system: 'metronome', role: 'contract_uniqueness_key', id: '<sandbox-contract-uniqueness-key>' },
              { system: 'stripe', role: 'customer_id', id: '<sandbox-stripe-customer-id-or-verified-none>' },
            ]
            : isCustomContract
              ? [
                { system: 'lev', role: 'account_id', id: '<sandbox-lev-account-id>' },
                { system: 'metronome', role: 'customer_id', id: '<sandbox-existing-or-created-customer-id>' },
                { system: 'metronome', role: 'rate_card_id', id: '<sandbox-rate-card-id>' },
                { system: 'metronome', role: 'contract_uniqueness_key', id: '<sandbox-custom-contract-uniqueness-key>' },
                { system: 'metronome', role: 'base_commit_name', id: '<sandbox-reviewed-base-commit-name>' },
                { system: 'stripe', role: 'customer_id', id: '<sandbox-stripe-customer-id>' },
                { system: 'metronome', role: 'stripe_delivery_method_id', id: '<sandbox-billing-provider-delivery-method-id>' },
              ]
              : isBillingProvider
                ? [
                  { system: 'metronome', role: 'customer_id', id: '<sandbox-customer-id>' },
                  { system: 'stripe', role: 'customer_id', id: '<sandbox-stripe-customer-id>' },
                  { system: 'metronome', role: 'delivery_method_id_or_direct', id: '<sandbox-delivery-method-id-or-direct>' },
                  { system: 'metronome', role: 'billing_provider_configuration_id_after_readback', id: '<sandbox-config-id>' },
                ]
              : isInvoiceIssueDate
                ? [
                  { system: 'metronome', role: 'customer_id', id: '<sandbox-customer-id>' },
                  { system: 'metronome', role: 'contract_id', id: '<sandbox-contract-id>' },
                  { system: 'metronome', role: 'invoice_id', id: '<sandbox-draft-invoice-id>' },
                  { system: 'metronome', role: 'target_issue_date', id: '<sandbox-target-issue-date>' },
                  { system: 'stripe', role: 'customer_id', id: '<sandbox-stripe-customer-id-or-verified-none>' },
                ]
                : isProductRetirement
                  ? [
                    { system: 'metronome', role: 'product_id', id: '<sandbox-product-id>' },
                    { system: 'metronome', role: 'starting_at', id: '<sandbox-retirement-starting-at>' },
                    { system: 'metronome', role: 'affected_rate_card_ids', id: '<sandbox-rate-card-ids>' },
                    { system: 'metronome', role: 'archive_product_after_rates_close', id: '<true-or-false>' },
                  ]
                  : isPackageArchive
                    ? [
                      { system: 'metronome', role: 'old_package_id', id: '<sandbox-old-package-id>' },
                      { system: 'metronome', role: 'package_alias', id: '<sandbox-package-alias>' },
                      { system: 'metronome', role: 'replacement_package_id', id: '<sandbox-replacement-package-id>' },
                      { system: 'metronome', role: 'replacement_alias_live_at', id: '<sandbox-replacement-alias-live-at>' },
                    ]
                    : isUsageIngest
                      ? [
                        { system: 'metronome', role: 'customer_id', id: '<sandbox-customer-id>' },
                        { system: 'metronome', role: 'expected_event_type', id: '<sandbox-expected-event-type>' },
                        { system: 'metronome', role: 'invoice_period', id: '<sandbox-starting-at-to-ending-before>' },
                        { system: 'metronome', role: 'canary_event_count', id: '<sandbox-canary-event-count>' },
                        { system: 'metronome', role: 'transaction_id_set_hash', id: '<sha256-of-reviewed-transaction-ids>' },
                      ]
              : [
                {
                  system: 'metronome',
                  role: 'package_alias',
                  id: '<sandbox-package-alias>',
                },
              ],
      canary: {
        required: true,
        objectCount: 1,
        result: 'passed',
        evidence: [
          {
            type: '<ui-screenshot|inspect-output|operator-note>',
            path: '<sandbox-canary-evidence-path>',
            hash: 'sha256:<64 lowercase hex evidence hash>',
          },
        ],
      },
      productionWritten: false,
    },
    verification: {
      readBack: isCustomerSetup
        ? [
          {
            method: 'GET',
            path: '/v1/customers/{customer_id}',
            expectation: 'Sandbox customer read-back shows reviewed name, custom fields, archived state, ingest aliases, Salesforce account id when present, and leave_stripe_invoices_in_draft when present.',
            evidencePath: '<path-to-customer-readback-evidence-json>',
            evidenceHash: 'sha256:<64 lowercase hex readback evidence hash>',
            result: 'passed',
          },
          {
            method: 'GET',
            path: '/v1/customers?ingest_alias={alias}',
            expectation: 'Every reviewed sandbox ingest alias resolves to the intended customer and no active or archived collision remains unresolved.',
            evidencePath: '<path-to-alias-search-readback-evidence-json>',
            evidenceHash: 'sha256:<64 lowercase hex readback evidence hash>',
            result: 'passed',
          },
          {
            method: 'POST',
            path: '/v1/getCustomerBillingProviderConfigurations',
            expectation: 'When Stripe setup is planned, sandbox billing-provider read-back shows expected Stripe customer id, collection method, and delivery method; otherwise non-applicability is documented.',
            evidencePath: '<path-to-billing-provider-or-not-applicable-evidence-json>',
            evidenceHash: 'sha256:<64 lowercase hex readback evidence hash>',
            result: 'passed',
          },
          {
            method: 'GET',
            path: '/v1/customers/{customer_id}/invoices?limit=50',
            expectation: 'Sandbox customer setup alone created no invoice and pushed no Stripe artifact; later contract workflows own invoice and Stripe side effects.',
            evidencePath: '<path-to-no-invoice-side-effect-evidence-json>',
            evidenceHash: 'sha256:<64 lowercase hex readback evidence hash>',
            result: 'passed',
          },
        ]
        : isContractMove
        ? [
          {
            method: 'POST',
            path: '/v2/contracts/get',
            expectation: 'Sandbox predecessor ending_before equals the reviewed cutover.',
            evidencePath: '<path-to-predecessor-readback-evidence-json>',
            evidenceHash: 'sha256:<64 lowercase hex readback evidence hash>',
            result: 'passed',
          },
          {
            method: 'POST',
            path: '/v2/contracts/list',
            expectation: 'Sandbox successor starts at cutover, uses the target package alias, and transitions from the predecessor.',
            evidencePath: '<path-to-successor-readback-evidence-json>',
            evidenceHash: 'sha256:<64 lowercase hex readback evidence hash>',
            result: 'passed',
          },
          {
            method: 'GET',
            path: '/v1/customers/{customer_id}/invoices',
            expectation: 'No immediate invoice or Stripe artifact appeared before the reviewed cutover.',
            evidencePath: '<path-to-invoice-readback-evidence-json>',
            evidenceHash: 'sha256:<64 lowercase hex readback evidence hash>',
            result: 'passed',
          },
        ]
        : isComplimentaryCredit
          ? [
            {
              method: 'POST',
              path: '/v1/contracts/customerBalances/list',
              expectation: 'Sandbox complimentary commit appears exactly once by reviewed name on the reviewed contract with expected amount, access credit type, priority, rollover, and applicable product tags.',
              evidencePath: '<path-to-balance-readback-evidence-json>',
              evidenceHash: 'sha256:<64 lowercase hex readback evidence hash>',
              result: 'passed',
            },
            {
              method: 'GET',
              path: '/v1/customers/{customer_id}/invoices',
              expectation: 'Sandbox invoice inventory confirms no new invoice artifact for pure access grant, or exactly the reviewed zero-dollar audit line for the audit-line variant.',
              evidencePath: '<path-to-invoice-inventory-evidence-json>',
              evidenceHash: 'sha256:<64 lowercase hex readback evidence hash>',
              result: 'passed',
            },
            {
              method: 'POST',
              path: '/v2/contracts/get',
              expectation: 'Sandbox contract read-back shows the complimentary commit is attached to the intended contract and no unrelated contract terms changed.',
              evidencePath: '<path-to-contract-readback-evidence-json>',
              evidenceHash: 'sha256:<64 lowercase hex readback evidence hash>',
              result: 'passed',
            },
          ]
        : isPaidTopUp
          ? [
            {
              method: 'POST',
              path: '/v1/contracts/customerBalances/list',
              expectation: 'Sandbox paid top-up commit appears exactly once by reviewed name with expected amount, access credit type, priority, and payment gate state.',
              evidencePath: '<path-to-balance-readback-evidence-json>',
              evidenceHash: 'sha256:<64 lowercase hex readback evidence hash>',
              result: 'passed',
            },
            {
              method: 'GET',
              path: '/v1/customers/{customer_id}/invoices',
              expectation: 'Sandbox invoice inventory shows the expected paid top-up amount, status, and external_invoice state.',
              evidencePath: '<path-to-invoice-readback-evidence-json>',
              evidenceHash: 'sha256:<64 lowercase hex readback evidence hash>',
              result: 'passed',
            },
            {
              method: 'POST',
              path: '/v1/getCustomerBillingProviderConfigurations',
              expectation: 'Sandbox billing-provider read-back proves the reviewed Stripe behavior before and after the paid top-up canary.',
              evidencePath: '<path-to-billing-provider-readback-evidence-json>',
              evidenceHash: 'sha256:<64 lowercase hex readback evidence hash>',
              result: 'passed',
            },
          ]
            : isDirectSubscription
              ? [
                {
                  method: 'POST',
                  path: '/v2/contracts/get',
                expectation: 'Sandbox contract read-back shows one subscription with reviewed product id, billing frequency, quantity management mode, and starting timestamp.',
                evidencePath: '<path-to-contract-readback-evidence-json>',
                evidenceHash: 'sha256:<64 lowercase hex readback evidence hash>',
                result: 'passed',
              },
              {
                method: 'POST',
                path: '/v1/contract-pricing/rate-cards/getRateSchedule',
                expectation: 'Sandbox rate schedule contains the matching SubscriptionProductListItem rate for the reviewed product id and billing frequency.',
                evidencePath: '<path-to-rate-schedule-readback-evidence-json>',
                evidenceHash: 'sha256:<64 lowercase hex readback evidence hash>',
                result: 'passed',
              },
              {
                method: 'POST',
                path: '/v1/contracts/getSubscriptionQuantityHistory',
                expectation: 'Sandbox subscription quantity history shows the reviewed initial quantity or named-seat-derived quantity.',
                evidencePath: '<path-to-quantity-history-evidence-json>',
                evidenceHash: 'sha256:<64 lowercase hex readback evidence hash>',
                result: 'passed',
              },
              {
                method: 'POST',
                path: '/v1/contracts/getSubscriptionSeatsHistory',
                expectation: 'For SEAT_BASED subscriptions, sandbox seat history shows the reviewed initial named seats; for QUANTITY_ONLY, non-applicability is documented.',
                evidencePath: '<path-to-seat-history-or-not-applicable-evidence-json>',
                evidenceHash: 'sha256:<64 lowercase hex readback evidence hash>',
                result: 'passed',
              },
              {
                method: 'POST',
                path: '/v1/getCustomerBillingProviderConfigurations',
                expectation: 'Sandbox billing-provider read-back proves the reviewed Stripe behavior for subscription invoices.',
                evidencePath: '<path-to-billing-provider-readback-evidence-json>',
                evidenceHash: 'sha256:<64 lowercase hex readback evidence hash>',
                result: 'passed',
              },
              {
                method: 'GET',
                path: '/v1/customers/{customer_id}/invoices',
                expectation: 'Sandbox invoice inventory matches reviewed subscription invoice timing and external_invoice behavior.',
                evidencePath: '<path-to-invoice-readback-evidence-json>',
                evidenceHash: 'sha256:<64 lowercase hex readback evidence hash>',
                  result: 'passed',
                },
              ]
            : isCustomContract
              ? [
                {
                  method: 'GET',
                  path: '/v1/customers/{customer_id}',
                  expectation: 'Sandbox customer read-back matches the reviewed external account id, company name, ingest alias, and custom fields before or after customer creation.',
                  evidencePath: '<path-to-customer-identity-readback-evidence-json>',
                  evidenceHash: 'sha256:<64 lowercase hex readback evidence hash>',
                  result: 'passed',
                },
                {
                  method: 'POST',
                  path: '/v1/getCustomerBillingProviderConfigurations',
                  expectation: 'Sandbox billing-provider read-back shows the reviewed Stripe customer, delivery method, collection method, and leave_stripe_invoices_in_draft behavior before contract creation.',
                  evidencePath: '<path-to-billing-provider-readback-evidence-json>',
                  evidenceHash: 'sha256:<64 lowercase hex readback evidence hash>',
                  result: 'passed',
                },
                {
                  method: 'POST',
                  path: '/v2/contracts/get',
                  expectation: 'Sandbox contract read-back shows the reviewed rate card, uniqueness key, start/end timestamps, recurring commit, invoice amount, and optional seat subscription.',
                  evidencePath: '<path-to-contract-readback-evidence-json>',
                  evidenceHash: 'sha256:<64 lowercase hex readback evidence hash>',
                  result: 'passed',
                },
                {
                  method: 'POST',
                  path: '/v1/contracts/customerBalances/list',
                  expectation: 'Sandbox balances show recurring and bonus commit access amounts exactly once with expected product and credit type ids.',
                  evidencePath: '<path-to-balance-readback-evidence-json>',
                  evidenceHash: 'sha256:<64 lowercase hex readback evidence hash>',
                  result: 'passed',
                },
                {
                  method: 'GET',
                  path: '/v1/customers/{customer_id}/invoices',
                  expectation: 'Sandbox invoice inventory matches the reviewed custom-contract invoice timing, amount, draft/finalization state, and external Stripe behavior.',
                  evidencePath: '<path-to-invoice-readback-evidence-json>',
                  evidenceHash: 'sha256:<64 lowercase hex readback evidence hash>',
                  result: 'passed',
                },
                {
                  method: 'POST',
                  path: '/v1/contracts/getSubscriptionQuantityHistory',
                  expectation: 'For seat-based sandbox custom contracts, subscription quantity history reflects the reviewed initial seat assignments; otherwise non-applicability is documented.',
                  evidencePath: '<path-to-quantity-history-or-not-applicable-evidence-json>',
                  evidenceHash: 'sha256:<64 lowercase hex readback evidence hash>',
                  result: 'passed',
                },
                {
                  method: 'POST',
                  path: '/v1/contracts/getSubscriptionSeatsHistory',
                  expectation: 'For seat-based sandbox custom contracts, seat history shows each reviewed initial seat id assigned once to the created subscription.',
                  evidencePath: '<path-to-seat-history-or-not-applicable-evidence-json>',
                  evidenceHash: 'sha256:<64 lowercase hex readback evidence hash>',
                  result: 'passed',
                },
              ]
              : isBillingProvider
                ? [
                  {
                    method: 'GET',
                    path: '/v1/customers/{customer_id}',
                    expectation: 'Sandbox customer read-back shows leave_stripe_invoices_in_draft matches the reviewed preview.',
                    evidencePath: '<path-to-customer-readback-evidence-json>',
                    evidenceHash: 'sha256:<64 lowercase hex readback evidence hash>',
                    result: 'passed',
                  },
                  {
                    method: 'POST',
                    path: '/v1/getCustomerBillingProviderConfigurations',
                    expectation: 'Sandbox billing-provider read-back shows one reviewed active Stripe configuration with expected customer id, Stripe customer id, and delivery routing.',
                    evidencePath: '<path-to-billing-provider-readback-evidence-json>',
                    evidenceHash: 'sha256:<64 lowercase hex readback evidence hash>',
                    result: 'passed',
                  },
                  {
                    method: 'POST',
                    path: '/v1/listConfiguredBillingProviders',
                    expectation: 'Sandbox account-level delivery provider evidence shows the reviewed delivery_method_id targets the expected Stripe account when deliveryMethodId is used.',
                    evidencePath: '<path-to-delivery-method-readback-evidence-json>',
                    evidenceHash: 'sha256:<64 lowercase hex readback evidence hash>',
                    result: 'passed',
                  },
                  {
                    method: 'GET',
                    path: '/v1/customers/{customer_id}/invoices',
                    expectation: 'Sandbox invoice inventory proves the attachment workflow itself did not create, finalize, void, archive, or push an invoice to Stripe.',
                    evidencePath: '<path-to-no-invoice-side-effect-evidence-json>',
                    evidenceHash: 'sha256:<64 lowercase hex readback evidence hash>',
                    result: 'passed',
                  },
                ]
              : isInvoiceIssueDate
                ? [
                  {
                    method: 'POST',
                    path: '/v1/invoices/get',
                    expectation: 'Sandbox invoice read-back shows status remains DRAFT and issue_date equals the reviewed targetIssueDate.',
                    evidencePath: '<path-to-invoice-readback-evidence-json>',
                    evidenceHash: 'sha256:<64 lowercase hex readback evidence hash>',
                    result: 'passed',
                  },
                  {
                    method: 'GET',
                    path: '/v1/customers/{customer_id}/invoices?limit=N&status=DRAFT',
                    expectation: 'Sandbox customer draft invoice inventory contains the target invoice and shows no unexpected finalized or duplicate invoice side effect.',
                    evidencePath: '<path-to-draft-invoice-inventory-evidence-json>',
                    evidenceHash: 'sha256:<64 lowercase hex readback evidence hash>',
                    result: 'passed',
                  },
                  {
                    method: 'POST',
                    path: '/v2/contracts/get',
                    expectation: 'Sandbox contract read-back proves target issue date is before ending_before, or that the contract has no end date.',
                    evidencePath: '<path-to-contract-boundary-evidence-json>',
                    evidenceHash: 'sha256:<64 lowercase hex readback evidence hash>',
                    result: 'passed',
                  },
                  {
                    method: 'POST',
                    path: '/v1/getCustomerBillingProviderConfigurations',
                    expectation: 'Sandbox billing-provider read-back proves the reviewed Stripe behavior for the deferred draft invoice.',
                    evidencePath: '<path-to-billing-provider-readback-evidence-json>',
                    evidenceHash: 'sha256:<64 lowercase hex readback evidence hash>',
                    result: 'passed',
                  },
                ]
                : isProductRetirement
                  ? [
                    {
                      method: 'POST',
                      path: '/v1/contract-pricing/rate-cards/getRateSchedule',
                      expectation: 'Sandbox rate schedules show entitled:false, price:0 entries for the product on every reviewed affected rate card at the cutover.',
                      evidencePath: '<path-to-rate-schedule-readback-evidence-json>',
                      evidenceHash: 'sha256:<64 lowercase hex readback evidence hash>',
                      result: 'passed',
                    },
                    {
                      method: 'POST',
                      path: '/v1/contract-pricing/products/get',
                      expectation: 'Sandbox product read-back matches the reviewed archive decision after rate close evidence exists.',
                      evidencePath: '<path-to-product-readback-evidence-json>',
                      evidenceHash: 'sha256:<64 lowercase hex readback evidence hash>',
                      result: 'passed',
                    },
                    {
                      method: 'GET',
                      path: '/v1/customers/{customer_id}/invoices',
                      expectation: 'Sandbox invoice preview or read-back confirms the retired product no longer produces billable or ghost lines after cutover.',
                      evidencePath: '<path-to-invoice-impact-evidence-json>',
                      evidenceHash: 'sha256:<64 lowercase hex readback evidence hash>',
                      result: 'passed',
                    },
                  ]
                  : isPackageArchive
                    ? [
                      {
                        method: 'POST',
                        path: '/v1/packages/get',
                        expectation: 'Sandbox old package read-back shows the reviewed old package id is archived after archive apply.',
                        evidencePath: '<path-to-old-package-readback-evidence-json>',
                        evidenceHash: 'sha256:<64 lowercase hex readback evidence hash>',
                        result: 'passed',
                      },
                      {
                        method: 'POST',
                        path: '/v1/packages/list?limit=100',
                        expectation: 'Sandbox package list read-back proves the alias resolves to the reviewed replacement package id and the replacement alias live timestamp is not in the future.',
                        evidencePath: '<path-to-replacement-alias-readback-evidence-json>',
                        evidenceHash: 'sha256:<64 lowercase hex readback evidence hash>',
                        result: 'passed',
                      },
                      {
                        method: 'POST',
                        path: '/v1/packages/listContractsOnPackage',
                        expectation: 'Sandbox contracts-on-package inventory for the old package was reviewed before archive and remains understood after archive.',
                        evidencePath: '<path-to-contracts-on-package-evidence-json>',
                        evidenceHash: 'sha256:<64 lowercase hex readback evidence hash>',
                        result: 'passed',
                      },
                    ]
                    : isUsageIngest
                      ? [
                        {
                          method: 'POST',
                          path: '/v1/customers/{customer_id}/previewEvents',
                          expectation: 'Sandbox previewEvents output matches the reviewed invoice period, line items, credit burn-down, and Stripe side-effect review before ingest.',
                          evidencePath: '<path-to-preview-events-evidence-json>',
                          evidenceHash: 'sha256:<64 lowercase hex readback evidence hash>',
                          result: 'passed',
                        },
                        {
                          method: 'POST',
                          path: '/v1/events/search',
                          expectation: 'Sandbox event search finds every submitted transaction_id exactly once for the intended customer and billable metric.',
                          evidencePath: '<path-to-event-search-readback-evidence-json>',
                          evidenceHash: 'sha256:<64 lowercase hex readback evidence hash>',
                          result: 'passed',
                        },
                        {
                          method: 'POST',
                          path: '/v1/usage/groups',
                          expectation: 'Sandbox usage group totals for the invoice period reflect the reviewed action codes before any bulk continuation and after remaining events.',
                          evidencePath: '<path-to-usage-groups-readback-evidence-json>',
                          evidenceHash: 'sha256:<64 lowercase hex readback evidence hash>',
                          result: 'passed',
                        },
                        {
                          method: 'GET',
                          path: '/v1/customers/{customer_id}/invoices',
                          expectation: 'Sandbox invoice inventory shows no unexpected finalized invoice, duplicate bill, or Stripe delivery side effect.',
                          evidencePath: '<path-to-invoice-impact-readback-evidence-json>',
                          evidenceHash: 'sha256:<64 lowercase hex readback evidence hash>',
                          result: 'passed',
                        },
                      ]
              : [
                {
                  method: 'POST',
                  path: '/v1/packages/get',
                  expectation: 'Sandbox package alias, uniqueness key, rate card, terms, and starting timestamp match the preview hash.',
                  evidencePath: '<path-to-readback-evidence-json>',
                  evidenceHash: 'sha256:<64 lowercase hex readback evidence hash>',
                  result: 'passed',
                },
              ],
      inspectEvidence: [
        {
          command: 'metro verify inspect-output --file <inspect-output.json> --json',
          filePath: '<path-to-local-inspect-output-json>',
          fileHash: 'sha256:<64 lowercase hex inspect output hash>',
          validationResult: 'passed',
        },
      ],
    },
    rollback: {
      plan: isCustomerSetup
        ? '<sandbox-tested plan to stop retries, search active and archived aliases, inspect customer/billing-provider/invoice state, avoid archive/delete remediation by default, and release or correct aliases only through owner-approved follow-up after no invoice or Stripe side effect is proven>'
        : isContractMove
        ? '<sandbox-tested plan to restore predecessor end date and pause or archive successor before cutover if verification fails>'
        : isComplimentaryCredit
          ? '<sandbox-tested plan to stop retries, inspect balance and invoice inventory, avoid duplicate grant replays, and remediate or shorten/archive the mistaken commit only with owner approval and invoice/Stripe side-effect review>'
        : isPaidTopUp
          ? '<sandbox-tested plan to stop retries, inspect invoice/payment gate/Stripe state, reconcile or void/remediate with owner approval, and verify balance>'
          : isDirectSubscription
            ? '<sandbox-tested plan to stop retries, inspect contract/subscription/invoice/Stripe state, remediate with owner approval, and verify quantity or seat history>'
            : isCustomContract
              ? '<sandbox-tested plan to stop retries, inspect customer, billing-provider, contract, commit, seat, invoice, and Stripe state; keep Stripe invoices in draft when reviewed; remediate or end/archive only with owner approval and read-back evidence>'
              : isBillingProvider
                ? '<sandbox-tested plan to stop retries, inspect customer billing-provider configuration and Stripe delivery routing, restore only by owner-approved set/archive/recreate steps, and verify no invoice or Stripe artifact was created by the attachment>'
              : isInvoiceIssueDate
                ? '<sandbox-tested plan to stop retries, inspect invoice DRAFT status, issue_date, contract boundary, and Stripe delivery state, then remediate only with owner approval>'
                : isProductRetirement
                  ? '<sandbox-tested plan to stop retries, inspect all affected rate schedules and invoice impact, restore with owner-approved corrective addRates entries only if needed, and archive follow-up only after rate state is proven>'
                  : isPackageArchive
                    ? '<sandbox-tested plan to stop retries, inspect old package archive state, replacement alias resolution, and contracts-on-package inventory, then remediate only with owner-approved package or alias correction steps>'
                    : isUsageIngest
                      ? '<sandbox-tested plan to stop retries, search submitted transaction IDs, reconcile usage groups and invoice impact, avoid replaying transaction IDs unless read-back proves they are missing, and remediate invoices or credits only with owner approval>'
              : '<sandbox rollback or remediation steps if verification fails>',
      testedInSandbox: true,
      owner: '<billing-ops-owner>',
    },
    idempotency: {
      strategy: isCustomerSetup
        ? '<search active and archived sandbox customers by every reviewed ingest alias plus external account id before create; reuse only when exact identity fields match>'
        : isContractMove
        ? '<stable successor contract uniqueness_key plus predecessor/current-state checks>'
        : isComplimentaryCredit
          ? '<review existing sandbox contract commits by name, amount, access credit type, and start timestamp before add_commits because no client-side idempotency key is available>'
        : isPaidTopUp
          ? '<review existing sandbox contract commits by name before add_commits because no client-side idempotency key is available>'
          : isDirectSubscription
            ? '<stable contractUniquenessKey plus customer/rate-card/product/current-contract state checks>'
            : isCustomContract
              ? '<stable uniquenessKey for contracts/create, customer identity read-back, Stripe billing-provider compare-before-set, and duplicate commit-name checks before any add_commits edit>'
              : isBillingProvider
                ? '<compare active sandbox billing-provider configs before attach; use fail_if_exists or reuse_if_matching according to reviewed existingConfigPolicy>'
              : isInvoiceIssueDate
                ? '<compare sandbox invoice status and issue_date before update; only move the same DRAFT invoice from the reviewed currentIssueDate to targetIssueDate>'
                : isProductRetirement
                  ? '<compare sandbox rate schedules before addRates; only close reviewed active product rates at the exact startingAt cutover>'
                  : isPackageArchive
                    ? '<compare sandbox old package archive state and replacement alias ownership before archive; only archive the reviewed oldPackageId after alias live evidence passes>'
                    : isUsageIngest
                      ? '<stable transaction_id per sandbox event plus event-search compare-before-retry checks>'
              : '<stable uniqueness key or compare-before-create strategy>',
      duplicatePrevention: isCustomerSetup
        ? '<retry customer create only after customer, alias, billing-provider, and invoice read-back proves no matching customer or partial create already exists>'
        : isContractMove
        ? '<validate successor create payload before updateEndDate; retry successor creation only with the same uniqueness_key>'
        : isComplimentaryCredit
          ? '<retry only after balance and invoice read-back proves no matching complimentary grant commit or audit-line invoice artifact was created>'
        : isPaidTopUp
          ? '<retry only after balance and invoice read-back proves no matching paid top-up commit or invoice was created>'
          : isDirectSubscription
            ? '<retry create only with the same uniqueness key after contract and invoice read-back proves no matching subscription contract was created>'
            : isCustomContract
              ? '<retry contract create only with the same uniquenessKey after customer, contract, balance, invoice, and seat read-back proves the target object or edit was not already created>'
              : isBillingProvider
                ? '<retry only after customer and billing-provider read-back proves no duplicate active Stripe billing-provider config was created>'
              : isInvoiceIssueDate
                ? '<retry only after invoice read-back proves issue_date is not already targetIssueDate and the invoice is still DRAFT>'
                : isProductRetirement
                  ? '<retry only after rate-schedule read-back proves the entitled:false, price:0 close entry is not already present for the product and rate card>'
                  : isPackageArchive
                    ? '<retry only after package get/list read-back proves the old package is not already archived and replacement alias remains live>'
                    : isUsageIngest
                      ? '<retry only the transaction_id values that event search proves missing; never regenerate transaction IDs for the same usage event>'
              : '<how a retry avoids duplicate packages or billing artifacts>',
    },
    blockedProduction: {
      productionApplySupported: false,
      reason: 'Sandbox proof is evidence for maturity only; production apply still requires prod-approved shape status, owner approval, exact preview hash confirmation, audit logging, read-back verification, and rollback review.',
      requiredBeforeProduction: [
        'prod-approved shape maturity',
        'production preflight approval',
        'production confirmation tied to exact preview hash',
        'production read-back verification plan',
      ],
    },
    sources: [
      'docs/metronome-cli/one-goal.md',
      'docs/metronome-cli/SHAPE_CATALOG.md',
      'docs/metronome-cli/CLI_ARCHITECTURE.md',
      'docs/metronome-cli/VALIDATION_AND_GUARDRAILS.md',
      '.cursor/skills/metronome-danger-zone/SKILL.md',
      '.cursor/skills/metronome-danger-zone/references/endpoint-matrix.md',
      ...(isCustomerSetup ? [
        '.cursor/skills/metronome-customers-hierarchies/SKILL.md',
        '.cursor/skills/metronome-stripe-delivery/SKILL.md',
      ] : []),
      ...(isContractMove ? ['.cursor/skills/metronome-packages-contracts/SKILL.md'] : []),
      ...(isComplimentaryCredit ? [
        '.cursor/skills/metronome-commits-credits/SKILL.md',
      ] : []),
      ...(isPaidTopUp ? [
        '.cursor/skills/metronome-commits-credits/SKILL.md',
        '.cursor/skills/metronome-invoicing/SKILL.md',
        '.cursor/skills/metronome-stripe-delivery/SKILL.md',
      ] : []),
      ...(isDirectSubscription ? [
        '.cursor/skills/metronome-subscriptions-seats/SKILL.md',
        '.cursor/skills/metronome-pricing-catalog/SKILL.md',
        '.cursor/skills/metronome-packages-contracts/SKILL.md',
        '.cursor/skills/metronome-stripe-delivery/SKILL.md',
      ] : []),
      ...(isCustomContract ? [
        '.cursor/skills/metronome-subscriptions-seats/SKILL.md',
        '.cursor/skills/metronome-stripe-delivery/SKILL.md',
        'metronome/custom-contract-creator/payload-builders.js',
        'metronome/custom-contract-creator/schema.js',
      ] : []),
      ...(isBillingProvider ? [
        '.cursor/skills/metronome-stripe-delivery/SKILL.md',
      ] : []),
      ...(isInvoiceIssueDate ? [
        '.cursor/skills/metronome-invoicing/SKILL.md',
        '.cursor/skills/metronome-stripe-delivery/SKILL.md',
      ] : []),
      ...(isProductRetirement ? [
        '.cursor/skills/metronome-danger-zone/SKILL.md',
      ] : []),
      ...(isPackageArchive ? [
        '.cursor/skills/metronome-packages-contracts/SKILL.md',
      ] : []),
      ...(isUsageIngest ? [
        '.cursor/skills/metronome-ingestion-events/SKILL.md',
        '.cursor/skills/metronome-invoicing/SKILL.md',
      ] : []),
    ],
  };
}

function collectSecretFindings(value, path = '$') {
  const findings = [];

  if (typeof value === 'string') {
    if (SECRET_VALUE_PATTERN.test(value)) {
      findings.push(finding(
        'MTR-SECRET-002',
        'error',
        `Sandbox proof appears to contain a secret-like value at ${path}.`,
        path,
        'Remove secret values; proof manifests may include hashes, file paths, and non-secret fingerprints only.',
      ));
    }
    return findings;
  }

  if (!isObject(value)) return findings;

  for (const [key, nested] of Object.entries(value)) {
    const nestedPath = `${path}.${key}`;
    if (SECRET_KEY_PATTERN.test(key) && key !== 'keyFingerprint') {
      findings.push(finding(
        'MTR-SECRET-001',
        'error',
        `Sandbox proof contains forbidden secret-shaped field ${nestedPath}.`,
        nestedPath,
        'Store hashes or fingerprints only; never store raw keys, tokens, passwords, or Authorization headers.',
      ));
    }
    findings.push(...collectSecretFindings(nested, nestedPath));
  }

  return findings;
}

function validateHashField(value, path, findings) {
  if (!isSha256(value)) {
    findings.push(finding(
      'MTR-HASH-001',
      'error',
      `${path} must be sha256:<64 lowercase hex>.`,
      path,
      'Record a canonical SHA-256 hash for each reviewed proof artifact.',
    ));
  }
}

function validatePassed(value, path, findings) {
  if (!VALID_RESULT.has(value)) {
    findings.push(finding(
      'MTR-PROOF-006',
      'error',
      `${path} must be passed before the manifest can prove sandbox maturity.`,
      path,
      'Only complete, passing validation evidence can be used as sandbox proof.',
    ));
  }
}

function validateSandboxCommand(value, path, findings) {
  if (!nonEmpty(value)) {
    findings.push(finding(
      'MTR-PROOF-007',
      'error',
      `${path} is required.`,
      path,
      'Record the exact local command used to create or validate this evidence.',
    ));
    return;
  }

  if (!String(value).includes('--sandbox')) {
    findings.push(finding(
      'MTR-TENANT-001',
      'error',
      `${path} must include --sandbox.`,
      path,
      'Sandbox proof must be tied to sandbox commands only.',
    ));
  }

  if (PRODUCTION_COMMAND_PATTERN.test(String(value))) {
    findings.push(finding(
      'MTR-TENANT-005',
      'error',
      `${path} must not contain production flags, production env vars, or dangerous-script bypasses.`,
      path,
      'Regenerate the proof from sandbox-only commands and keep production apply blocked.',
    ));
  }
}

function validateEndpoints(endpoints, path, findings) {
  if (list(endpoints).length === 0) {
    findings.push(finding(
      'MTR-PROOF-008',
      'error',
      `${path} must include at least one endpoint.`,
      path,
      'Record the exact sandbox write or read-back endpoints proven by this manifest.',
    ));
    return;
  }

  list(endpoints).forEach((endpoint, index) => {
    if (!['GET', 'POST'].includes(endpoint?.method) || !String(endpoint?.path || '').startsWith('/')) {
      findings.push(finding(
        'MTR-PROOF-009',
        'error',
        `${path}[${index}] must include a supported method and absolute path.`,
        `${path}[${index}]`,
        'Use endpoint paths from the Metronome endpoint matrix.',
      ));
    }
    const sourceIds = list(endpoint?.sourceIds).filter(nonEmpty);
    if (sourceIds.length === 0 || !sourceIds.includes('endpoint-matrix')) {
      findings.push(finding(
        'MTR-ENDPOINT-001',
        'error',
        `${path}[${index}].sourceIds must include endpoint-matrix.`,
        `${path}[${index}].sourceIds`,
        'Cite the local endpoint matrix before a sandbox proof can rely on this endpoint.',
      ));
    }
    if (!sourceIds.some((sourceId) => /^official-[a-z0-9-]+$/.test(String(sourceId)) || REVIEWED_ENDPOINT_SOURCE_IDS.has(String(sourceId)))) {
      findings.push(finding(
        'MTR-ENDPOINT-002',
        'error',
        `${path}[${index}].sourceIds must include an official doc or reviewed local endpoint source.`,
        `${path}[${index}].sourceIds`,
        'Add an official-* source id or a reviewed local source id such as danger-zone or packages-contracts.',
      ));
    }
  });
}

function validateEvidenceItems(items, path, findings) {
  if (list(items).length === 0) {
    findings.push(finding(
      'MTR-PROOF-010',
      'error',
      `${path} must include at least one evidence item.`,
      path,
      'Attach local file paths and hashes for the evidence proving this step.',
    ));
    return;
  }

  list(items).forEach((item, index) => {
    if (!nonEmpty(item?.path) && !nonEmpty(item?.filePath) && !nonEmpty(item?.evidencePath)) {
      findings.push(finding(
        'MTR-PROOF-011',
        'error',
        `${path}[${index}] must include a path, filePath, or evidencePath.`,
        `${path}[${index}]`,
        'Record where the local proof evidence is stored.',
      ));
    }
    const hash = item?.hash || item?.fileHash || item?.evidenceHash;
    validateHashField(hash, `${path}[${index}].hash`, findings);
  });
}

function validateSandboxProof(input) {
  const findings = [];

  if (!isObject(input)) {
    return {
      schemaVersion: 'metro.sandbox-proof.validation.v1',
      valid: false,
      findings: [finding(
        'MTR-PROOF-000',
        'error',
        'Sandbox proof must be a JSON object.',
        '$',
        'Start from metro proof sandbox-template and fill in the evidence fields.',
      )],
    };
  }

  if (input.schemaVersion !== 'metro.sandbox-proof.v1') {
    findings.push(finding(
      'MTR-PROOF-001',
      'error',
      'schemaVersion must be metro.sandbox-proof.v1.',
      'schemaVersion',
      'Start from metro proof sandbox-template and keep schemaVersion unchanged.',
    ));
  }

  if (!isSandboxProofSupported(input.workflow, input.shape)) {
    findings.push(finding(
      'MTR-PROOF-002',
      'error',
      'workflow and shape are not a supported sandbox proof pair.',
      'workflow',
      'Use metro proof sandbox-template with a supported workflow and shape pair.',
    ));
  }

  if (input.tenant !== 'sandbox') {
    findings.push(finding(
      'MTR-TENANT-004',
      'error',
      'Sandbox proof tenant must be sandbox.',
      'tenant',
      'Production evidence belongs in a later production approval manifest, not a sandbox proof file.',
    ));
  }

  if (input.localOnly !== true) {
    findings.push(finding(
      'MTR-PROOF-003',
      'error',
      'localOnly must be true.',
      'localOnly',
      'This CLI slice validates proof manifests only and does not call live APIs.',
    ));
  }

  if (input.maturityGate?.productionApplyAllowed !== false) {
    findings.push(finding(
      'MTR-PROOF-004',
      'error',
      'maturityGate.productionApplyAllowed must be false for sandbox proof.',
      'maturityGate.productionApplyAllowed',
      'Sandbox proof can advance maturity evidence but must not authorize production apply.',
    ));
  }

  validateSandboxCommand(input.preview?.command, 'preview.command', findings);
  if (!nonEmpty(input.preview?.outputPath)) {
    findings.push(finding(
      'MTR-PROOF-005',
      'error',
      'preview.outputPath is required.',
      'preview.outputPath',
      'Record the reviewed sandbox preview JSON path.',
    ));
  }
  validateHashField(input.preview?.payloadHash, 'preview.payloadHash', findings);

  if (!nonEmpty(input.preflight?.filePath)) {
    findings.push(finding(
      'MTR-PREFLIGHT-005',
      'error',
      'preflight.filePath is required.',
      'preflight.filePath',
      'Record the local preflight JSON path used for this sandbox proof.',
    ));
  }
  validateHashField(input.preflight?.fileHash, 'preflight.fileHash', findings);
  validatePassed(input.preflight?.validationResult, 'preflight.validationResult', findings);

  if (!nonEmpty(input.audit?.filePath)) {
    findings.push(finding(
      'MTR-AUDIT-001',
      'error',
      'audit.filePath is required.',
      'audit.filePath',
      'Record the local audit JSONL path used for this sandbox proof.',
    ));
  }
  validateHashField(input.audit?.fileHash, 'audit.fileHash', findings);
  validatePassed(input.audit?.validationResult, 'audit.validationResult', findings);
  if (!Number.isInteger(input.audit?.rowCount) || input.audit.rowCount < 1) {
    findings.push(finding(
      'MTR-AUDIT-015',
      'error',
      'audit.rowCount must be a positive integer.',
      'audit.rowCount',
      'Validate a non-empty audit JSONL file and record its row count.',
    ));
  }

  validateSandboxCommand(input.sandboxExecution?.applyCommand, 'sandboxExecution.applyCommand', findings);
  validateEndpoints(input.sandboxExecution?.endpoints, 'sandboxExecution.endpoints', findings);

  if (!list(input.sandboxExecution?.targetIds).some((item) => nonEmpty(item?.system) && nonEmpty(item?.role) && nonEmpty(item?.id))) {
    findings.push(finding(
      'MTR-PROOF-012',
      'error',
      'sandboxExecution.targetIds must include at least one concrete target id.',
      'sandboxExecution.targetIds',
      'Record the sandbox object identifiers proven by this manifest.',
    ));
  }

  if (input.sandboxExecution?.productionWritten !== false) {
    findings.push(finding(
      'MTR-TENANT-006',
      'error',
      'sandboxExecution.productionWritten must be false.',
      'sandboxExecution.productionWritten',
      'Sandbox proof must explicitly state that production was not written.',
    ));
  }

  const canary = input.sandboxExecution?.canary;
  if (canary?.required !== true || canary?.result !== 'passed' || !Number.isInteger(canary?.objectCount) || canary.objectCount < 1) {
    findings.push(finding(
      'MTR-VERIFY-003',
      'error',
      'sandboxExecution.canary must record a passed canary with at least one object.',
      'sandboxExecution.canary',
      'Run and record a sandbox canary before treating this as sandbox proof.',
    ));
  }
  validateEvidenceItems(canary?.evidence, 'sandboxExecution.canary.evidence', findings);

  validateEvidenceItems(input.verification?.readBack, 'verification.readBack', findings);
  list(input.verification?.readBack).forEach((item, index) => {
    if (!nonEmpty(item?.method) || !nonEmpty(item?.path) || !nonEmpty(item?.expectation) || item?.result !== 'passed') {
      findings.push(finding(
        'MTR-VERIFY-001',
        'error',
        `verification.readBack[${index}] must include method, path, expectation, and result passed.`,
        `verification.readBack[${index}]`,
        'Record read-back checks that prove the sandbox state matches the reviewed preview.',
      ));
    }
  });

  validateEvidenceItems(input.verification?.inspectEvidence, 'verification.inspectEvidence', findings);
  list(input.verification?.inspectEvidence).forEach((item, index) => {
    validatePassed(item?.validationResult, `verification.inspectEvidence[${index}].validationResult`, findings);
  });

  if (!nonEmpty(input.rollback?.plan) || input.rollback?.testedInSandbox !== true || !nonEmpty(input.rollback?.owner)) {
    findings.push(finding(
      'MTR-VERIFY-002',
      'error',
      'rollback plan, testedInSandbox=true, and owner are required.',
      'rollback',
      'Record the sandbox-tested remediation path and owner before promoting maturity.',
    ));
  }

  if (!nonEmpty(input.idempotency?.strategy) || !nonEmpty(input.idempotency?.duplicatePrevention)) {
    findings.push(finding(
      'MTR-IDEMP-001',
      'error',
      'idempotency strategy and duplicate prevention are required.',
      'idempotency',
      'Record stable uniqueness keys or compare-before-create checks that prevent duplicates.',
    ));
  }

  if (input.blockedProduction?.productionApplySupported !== false || list(input.blockedProduction?.requiredBeforeProduction).length === 0) {
    findings.push(finding(
      'MTR-TENANT-002',
      'error',
      'blockedProduction must keep production apply unsupported and list remaining production gates.',
      'blockedProduction',
      'Sandbox proof is not production approval; preserve the explicit production block.',
    ));
  }

  findings.push(...collectSecretFindings(input));

  return {
    schemaVersion: 'metro.sandbox-proof.validation.v1',
    valid: !findings.some((item) => item.severity === 'error'),
    findings,
  };
}

module.exports = {
  buildSandboxProofTemplate,
  validateSandboxProof,
};
