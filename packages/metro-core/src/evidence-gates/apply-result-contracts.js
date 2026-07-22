'use strict';

const { validateWorkflowEvidenceBundles } = require('./workflow-evidence-validation');

const APPLY_RESULT_SCHEMA_VERSION = 'metro.apply.v1';

const APPLY_CONTRACTS = {
  'customer.setup:customer-setup': {
    writeEndpoints: [
      { method: 'POST', path: '/v1/customers' },
      { method: 'POST', path: '/v1/customers/{customer_id}/updateConfig' },
    ],
    requiredWriteEndpoints: [],
    skippableWriteIds: new Set([
      'customer_setup.customer_create',
      'customer_setup.update_config',
    ]),
    requiredVerificationChecks: [
      {
        id: 'customer_setup.customer_identity',
        method: 'GET',
        path: '/v1/customers/{customer_id}',
        expectation: 'Customer read-back shows the reviewed name, custom fields, archived state, ingest aliases, Salesforce account id when present, and leave_stripe_invoices_in_draft when present.',
      },
      {
        id: 'customer_setup.ingest_alias_search',
        method: 'GET',
        path: '/v1/customers?ingest_alias={alias}',
        expectation: 'Every reviewed ingest alias resolves to the intended customer and no active or archived collision remains unresolved.',
      },
      {
        id: 'customer_setup.billing_provider_config',
        method: 'POST',
        path: '/v1/getCustomerBillingProviderConfigurations',
        expectation: 'When Stripe setup is planned, billing-provider read-back shows the expected Stripe customer id, collection method, and delivery method; otherwise non-applicability is documented.',
      },
      {
        id: 'customer_setup.invoice_inventory',
        method: 'GET',
        path: '/v1/customers/{customer_id}/invoices?limit=50',
        expectation: 'Customer setup alone created no invoice and pushed no Stripe artifact; later contract workflows own invoice and Stripe side effects.',
      },
    ],
    approvalEvidence: [
      'alias-collision-review',
      'customer-create-or-reuse-decision',
    ],
    applyReadbackEvidence: [
      'customer-identity-readback',
      'ingest-alias-search-readback',
      'billing-provider-readback-or-reviewed-non-applicability',
      'invoice-inventory-no-side-effect-readback',
    ],
  },
  'package.apply:pro-annual': {
    writeEndpoints: [{ method: 'POST', path: '/v1/packages/create' }],
    requiredVerificationChecks: [
      {
        id: 'package.get',
        method: 'POST',
        path: '/v1/packages/get',
        expectation: 'Package alias, uniqueness key, rate card, terms, and starting timestamp match the reviewed preview.',
      },
    ],
  },
  'credit.apply:complimentary-credit-grant': {
    writeEndpoints: [{ method: 'POST', path: '/v2/contracts/edit' }],
    requiredVerificationChecks: [
      {
        id: 'complimentary_credit.balance_readback',
        method: 'POST',
        path: '/v1/contracts/customerBalances/list',
        expectation: 'The complimentary commit appears once by reviewed name on the reviewed contract with expected amount, access credit type, priority, rollover, and applicable product tags.',
      },
      {
        id: 'complimentary_credit.invoice_inventory',
        method: 'GET',
        path: '/v1/customers/{customer_id}/invoices',
        expectation: 'Customer invoice inventory confirms no new invoice artifact for pure access grants, or exactly the reviewed zero-dollar audit line for the audit-line variant.',
      },
      {
        id: 'complimentary_credit.contract_readback',
        method: 'POST',
        path: '/v2/contracts/get',
        expectation: 'Contract read-back shows the complimentary commit is attached to the intended contract and no unrelated contract terms changed.',
      },
    ],
  },
  'credit.apply:paid-credit-top-up': {
    writeEndpoints: [{ method: 'POST', path: '/v2/contracts/edit' }],
    requiredVerificationChecks: [
      {
        id: 'paid_topup.balance_readback',
        method: 'POST',
        path: '/v1/contracts/customerBalances/list',
        expectation: 'The paid top-up commit appears once by reviewed name with expected amount, access credit type, priority, and payment gate state.',
      },
      {
        id: 'paid_topup.invoice_inventory',
        method: 'GET',
        path: '/v1/customers/{customer_id}/invoices',
        expectation: 'Customer invoice inventory shows the expected paid top-up invoice amount, status, and external_invoice state.',
      },
      {
        id: 'paid_topup.billing_provider_config',
        method: 'POST',
        path: '/v1/getCustomerBillingProviderConfigurations',
        expectation: 'Billing-provider read-back still supports the reviewed Stripe behavior before and after the paid top-up apply.',
      },
    ],
  },
  'contract.move-plan.apply:package-plan-move-no-immediate-invoice': {
    writeEndpoints: [
      { method: 'POST', path: '/v1/contracts/updateEndDate' },
      { method: 'POST', path: '/v1/contracts/create' },
    ],
    requiredVerificationChecks: [
      {
        id: 'contract_move.predecessor_end_date',
        method: 'POST',
        path: '/v2/contracts/get',
        expectation: 'Predecessor ending_before equals the reviewed cutover and finalized-invoice protection did not require allow_ending_before_finalized_invoice=true.',
      },
      {
        id: 'contract_move.successor_transition',
        method: 'POST',
        path: '/v2/contracts/list',
        expectation: 'Successor contract starts at cutover, uses the target package alias, and has a transition from the predecessor contract.',
      },
      {
        id: 'contract_move.invoice_inventory',
        method: 'GET',
        path: '/v1/customers/{customer_id}/invoices',
        expectation: 'No surprise invoice appears before cutover and old-plan future invoices are understood.',
      },
      {
        id: 'contract_move.billing_provider_config',
        method: 'POST',
        path: '/v1/getCustomerBillingProviderConfigurations',
        expectation: 'Active Stripe billing-provider configuration remains present and unchanged.',
      },
    ],
  },
  'contract.move-plan.apply:package-plan-move-immediate-invoice': {
    writeEndpoints: [
      { method: 'POST', path: '/v1/contracts/updateEndDate' },
      { method: 'POST', path: '/v1/contracts/create' },
    ],
    requiredVerificationChecks: [
      {
        id: 'contract_move.predecessor_end_date',
        method: 'POST',
        path: '/v2/contracts/get',
        expectation: 'Predecessor ending_before equals the reviewed cutover and finalized-invoice protection did not require allow_ending_before_finalized_invoice=true.',
      },
      {
        id: 'contract_move.successor_transition',
        method: 'POST',
        path: '/v2/contracts/list',
        expectation: 'Successor contract starts at cutover, uses the target package alias, has a transition from the predecessor, and issues the expected immediate plan fee.',
      },
      {
        id: 'contract_move.invoice_inventory',
        method: 'GET',
        path: '/v1/customers/{customer_id}/invoices',
        expectation: 'Immediate SCHEDULED plan fee and paid-period overlap policy are understood; no surprise invoices beyond the reviewed overlap decision.',
      },
      {
        id: 'contract_move.billing_provider_config',
        method: 'POST',
        path: '/v1/getCustomerBillingProviderConfigurations',
        expectation: 'Active Stripe billing-provider configuration remains present and unchanged.',
      },
    ],
  },
  'billing-provider.attach:stripe-billing-provider-attachment': {
    writeEndpoints: [
      { method: 'POST', path: '/v1/setCustomerBillingProviderConfigurations' },
      { method: 'POST', path: '/v1/customers/{customer_id}/updateConfig' },
    ],
    requiredWriteEndpoints: [
      { method: 'POST', path: '/v1/setCustomerBillingProviderConfigurations' },
      { method: 'POST', path: '/v1/customers/{customer_id}/updateConfig' },
    ],
    requiredVerificationChecks: [
      {
        id: 'billing_provider.customer_config',
        method: 'GET',
        path: '/v1/customers/{customer_id}',
        expectation: 'Customer read-back shows the reviewed Metronome customer id and leave_stripe_invoices_in_draft value.',
      },
      {
        id: 'billing_provider.active_config',
        method: 'POST',
        path: '/v1/getCustomerBillingProviderConfigurations',
        expectation: 'Billing-provider read-back shows exactly one reviewed active Stripe configuration or a reviewed existing matching configuration reused according to policy.',
      },
      {
        id: 'billing_provider.delivery_method',
        method: 'POST',
        path: '/v1/listConfiguredBillingProviders',
        expectation: 'Delivery method id or direct_to_billing_provider routing resolves to the reviewed Stripe account and delivery strategy when delivery routing evidence is required.',
      },
      {
        id: 'billing_provider.invoice_inventory',
        method: 'GET',
        path: '/v1/customers/{customer_id}/invoices',
        expectation: 'Customer invoice inventory proves the attachment workflow itself did not create, finalize, void, archive, or push an invoice to Stripe.',
      },
    ],
    approvalEvidence: [
      'inspected-active-config-state',
      'delivery-method-routing-proof',
      'stripe-draft-behavior-review',
      'duplicate-active-config-prevention',
    ],
    applyReadbackEvidence: [
      'customer-config-readback',
      'billing-provider-config-readback',
      'delivery-method-routing-readback',
      'invoice-inventory-no-side-effect-readback',
    ],
  },
  'custom-contract.create:enterprise-custom-contract': {
    writeEndpoints: [
      { method: 'POST', path: '/v1/customers' },
      { method: 'POST', path: '/v1/setCustomerBillingProviderConfigurations' },
      { method: 'POST', path: '/v1/contracts/create' },
      { method: 'POST', path: '/v2/contracts/edit' },
    ],
    requiredWriteEndpoints: [
      { method: 'POST', path: '/v1/setCustomerBillingProviderConfigurations' },
      { method: 'POST', path: '/v1/contracts/create' },
    ],
    skippableWriteIds: new Set([
      'custom_contract.customer_create',
      'custom_contract.bonus_commits',
      'custom_contract.seat_assignments',
    ]),
    requiredVerificationChecks: [
      { id: 'custom_contract.customer_identity', method: 'GET', path: '/v1/customers/{customer_id}' },
      { id: 'custom_contract.billing_provider_config', method: 'POST', path: '/v1/getCustomerBillingProviderConfigurations' },
      { id: 'custom_contract.contract_readback', method: 'POST', path: '/v2/contracts/get' },
      { id: 'custom_contract.balance_access', method: 'POST', path: '/v1/contracts/customerBalances/list' },
      { id: 'custom_contract.invoice_stripe_behavior', method: 'GET', path: '/v1/customers/{customer_id}/invoices' },
      { id: 'custom_contract.seat_quantity_history', method: 'POST', path: '/v1/contracts/getSubscriptionQuantityHistory' },
      { id: 'custom_contract.seat_history', method: 'POST', path: '/v1/contracts/getSubscriptionSeatsHistory' },
    ],
  },
};

function clone(value) {
  if (value instanceof Set) return [...value];
  if (Array.isArray(value)) return value.map((item) => clone(item));
  if (!isObject(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, clone(child)]));
}

function isObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function workflowApplyResultKey(workflow, shape) {
  return `${workflow}:${shape}`;
}

function getWorkflowApplyResultContract(workflow, shape) {
  return APPLY_CONTRACTS[workflowApplyResultKey(workflow, shape)] || null;
}

function templateResponseObjectIds(endpoint, index) {
  if (endpoint.path === '/v1/customers') {
    return [{ system: 'metronome', role: 'customer_id_or_status', id: '<created customer id or skipped_existing_customer>' }];
  }
  if (endpoint.path === '/v1/setCustomerBillingProviderConfigurations') {
    return [{ system: 'metronome', role: 'billing_provider_configuration_id', id: '<created or reused billing provider configuration id>' }];
  }
  if (endpoint.path === '/v1/customers/{customer_id}/updateConfig') {
    return [{ system: 'metronome', role: 'customer_config_update_status', id: '<updated customer config status>' }];
  }
  if (endpoint.path === '/v1/contracts/create') {
    return [
      { system: 'metronome', role: 'contract_id', id: '<created contract id>' },
      { system: 'metronome', role: 'subscription_id_or_none', id: '<created seat subscription id or not_applicable>' },
    ];
  }
  if (endpoint.path === '/v2/contracts/edit') {
    return [{ system: 'metronome', role: `edit_${index}_result_id_or_status`, id: '<created edit object ids or skipped status>' }];
  }
  if (endpoint.path === '/v1/packages/create') {
    return [{ system: 'metronome', role: 'package_id', id: '<created package id>' }];
  }
  return [{ system: 'metronome', role: '<created or updated object role>', id: '<metronome object id or reviewed skipped status>' }];
}

function buildTemplateWriteRows(key, contract) {
  if (key === 'customer.setup:customer-setup') {
    return [
      {
        id: 'customer_setup.customer_create',
        method: 'POST',
        path: '/v1/customers',
        status: '<success|skipped>',
        requestBodyHash: 'sha256:<64 lowercase hex request body hash when customer was created>',
        skipReason: '<required only when reviewed exact customer reuse made create not applicable>',
        skipEvidenceHash: 'sha256:<64 lowercase hex reviewed existing-customer evidence hash when skipped>',
        responseObjectIds: [
          { system: 'metronome', role: 'customer_id_or_status', id: '<created customer id or reviewed_existing_customer_id>' },
        ],
      },
      {
        id: 'customer_setup.update_config',
        method: 'POST',
        path: '/v1/customers/{customer_id}/updateConfig',
        status: '<success|skipped>',
        requestBodyHash: 'sha256:<64 lowercase hex updateConfig request body hash when configuration was changed>',
        skipReason: '<required only when no first-class customer configuration changes were reviewed>',
        skipEvidenceHash: 'sha256:<64 lowercase hex reviewed no-updateConfig evidence hash when skipped>',
        responseObjectIds: [
          { system: 'metronome', role: 'customer_config_status', id: '<updated customer id or skipped_no_config_changes>' },
        ],
      },
    ];
  }

  if (key === 'custom-contract.create:enterprise-custom-contract') {
    return [
      {
        id: 'custom_contract.customer_create',
        method: 'POST',
        path: '/v1/customers',
        status: '<success|skipped>',
        requestBodyHash: 'sha256:<64 lowercase hex request body hash when created>',
        skipReason: '<required only when skipped_existing_customer>',
        skipEvidenceHash: 'sha256:<64 lowercase hex reviewed existing-customer evidence hash when skipped>',
        responseObjectIds: templateResponseObjectIds({ path: '/v1/customers' }, 0),
      },
      {
        method: 'POST',
        path: '/v1/setCustomerBillingProviderConfigurations',
        status: '<success|passed>',
        requestBodyHash: 'sha256:<64 lowercase hex request body hash>',
        responseObjectIds: templateResponseObjectIds({ path: '/v1/setCustomerBillingProviderConfigurations' }, 1),
      },
      {
        method: 'POST',
        path: '/v1/contracts/create',
        status: '<success|passed>',
        requestBodyHash: 'sha256:<64 lowercase hex request body hash>',
        responseObjectIds: templateResponseObjectIds({ path: '/v1/contracts/create' }, 2),
      },
      {
        id: 'custom_contract.bonus_commits',
        method: 'POST',
        path: '/v2/contracts/edit',
        status: '<success|skipped>',
        requestBodyHash: 'sha256:<64 lowercase hex request body hash when bonus commits were added>',
        skipReason: '<required only when no bonusCommits were reviewed>',
        skipEvidenceHash: 'sha256:<64 lowercase hex reviewed no-bonus evidence hash when skipped>',
        responseObjectIds: [{ system: 'metronome', role: 'bonus_commit_ids_or_status', id: '<bonus commit ids or skipped_no_bonus_commits>' }],
      },
      {
        id: 'custom_contract.seat_assignments',
        method: 'POST',
        path: '/v2/contracts/edit',
        status: '<success|skipped>',
        requestBodyHash: 'sha256:<64 lowercase hex request body hash when seat assignments were added>',
        skipReason: '<required only when no seat edit was applicable>',
        skipEvidenceHash: 'sha256:<64 lowercase hex reviewed no-seat evidence hash when skipped>',
        responseObjectIds: [{ system: 'metronome', role: 'seat_assignment_status', id: '<seat assignment status or skipped_no_initial_seats>' }],
      },
    ];
  }

  return list(contract.writeEndpoints).map((endpoint, index) => ({
    method: endpoint.method,
    path: endpoint.path,
    status: '<success|passed>',
    requestBodyHash: 'sha256:<64 lowercase hex request body hash>',
    responseObjectIds: templateResponseObjectIds(endpoint, index),
  }));
}

function buildTemplateVerificationChecks(contract) {
  const requiredChecks = list(contract.requiredVerificationChecks);
  if (requiredChecks.length === 0) {
    return [
      {
        id: '<read-back check id>',
        method: '<GET|POST>',
        path: '<read-only Metronome endpoint path>',
        expectation: '<semantic post-apply expectation>',
        result: '<passed|failed>',
        evidencePath: '<path-to-readback-evidence-json>',
        evidenceHash: 'sha256:<64 lowercase hex readback evidence hash>',
      },
    ];
  }

  return requiredChecks.map((check) => ({
    id: check.id,
    method: check.method,
    path: check.path,
    expectation: check.expectation || '<semantic post-apply expectation for this workflow check>',
    result: '<passed|failed>',
    evidencePath: '<path-to-readback-evidence-json>',
    evidenceHash: 'sha256:<64 lowercase hex readback evidence hash>',
  }));
}

function tenantFlag(tenant) {
  if (tenant === 'production') return '--prod';
  if (tenant === 'sandbox') return '--sandbox';
  return '(--sandbox|--prod)';
}

function uniqueList(values) {
  return [...new Set(values.filter((value) => value !== undefined && value !== null && String(value).trim() !== ''))];
}

function plannedAuditRows(key, contract) {
  return buildTemplateWriteRows(key, contract).map((row, index) => ({
    id: row.id || `workflow_write_${index + 1}`,
    method: row.method,
    path: row.path,
    status: row.status,
  }));
}

function buildWorkflowEvidenceBundles(key, workflow, shape, tenant, contract) {
  const flag = tenantFlag(tenant);

  return {
    approvalRecord: {
      schemaVersion: 'metro.workflow.approval-record.v1',
      status: 'template',
      apiAccess: 'none',
      applyEnabledInCurrentCli: false,
      liveApplyAuthorizedByThisRecord: false,
      durableApprovalIsCurrentTurnAuthorization: false,
      sourceCommand: `metro apply-gate template --workflow ${workflow} --shape ${shape} ${flag} --json`,
      requiredEvidence: uniqueList([
        'reviewed-preview-payload-hash',
        'validated-preflight-file-hash',
        'validated-sandbox-proof-file-hash-before-production',
        'tenant-profile-key-fingerprint',
        'owner-approval-for-exact-workflow-hash',
        ...list(contract.approvalEvidence),
        'rollback-remediation-owner',
        'idempotency-review',
        'current-turn-authorization-still-required',
      ]),
    },
    applyAudit: {
      schemaVersion: 'metro.workflow.apply-audit.v1',
      status: 'template',
      apiAccess: 'none',
      applyEnabledInCurrentCli: false,
      liveApplyAuthorizedByThisRecord: false,
      sourceCommand: `metro audit template --workflow ${workflow} --shape ${shape} ${flag} --json`,
      plannedRows: plannedAuditRows(key, contract),
      requiredEvidence: [
        'validated-approval-record',
        'apply-gate-hash',
        'preview-hash',
        'request-body-hash-per-write',
        'response-object-ids-or-reviewed-skip-status',
        'tenant-key-fingerprint',
        'append-only-jsonl-audit-destination',
      ],
    },
    applyReadback: {
      schemaVersion: 'metro.workflow.apply-readback.v1',
      status: 'template',
      apiAccess: 'none',
      readEnabledInCurrentCli: false,
      applyEnabledInCurrentCli: false,
      liveApplyAuthorizedByThisRecord: false,
      verificationCommand: 'metro verify apply-result --file <apply-result.json> --json',
      requiredChecks: clone(contract.requiredVerificationChecks),
      semanticApplySuccessProvenByPrerequisites: false,
      requiredEvidence: uniqueList([
        'validated-apply-audit-bundle',
        ...list(contract.applyReadbackEvidence),
        'read-only-endpoints-only',
        'read-back-evidence-hash-per-check',
        'semantic-expected-state-comparison',
        'semantic-apply-success-not-proven-by-prerequisites',
      ]),
    },
    guardedApplyResult: {
      schemaVersion: APPLY_RESULT_SCHEMA_VERSION,
      status: 'future-guarded-runner-contract',
      apiAccess: 'none',
      applyEnabledInCurrentCli: false,
      liveApplyAuthorizedByThisRecord: false,
      templateCommand: `metro verify apply-result-template --workflow ${workflow} --shape ${shape} ${flag} --json`,
      validationCommand: 'metro verify apply-result --file <apply-result.json> --json',
      currentTurnAuthorizationRequiredAtExecution: true,
      requiredEvidence: [
        'validated-approval-record-bundle',
        'validated-apply-audit-bundle',
        'validated-apply-readback-bundle',
        'guarded-runner-id',
        'current-turn-authorization-captured-at-execution',
        'live-audit-row-hash',
        'response-object-ids',
        'semantic-read-back-success',
        'rollback-remediation-owner',
        'idempotency-review',
        'secret-free-evidence',
      ],
    },
  };
}

function buildFutureWorkflowEvidence(key, workflow, shape, tenant, contract) {
  const bundles = buildWorkflowEvidenceBundles(key, workflow, shape, tenant, contract);

  return {
    approvalRecord: {
      schemaVersion: bundles.approvalRecord.schemaVersion,
      validationResult: 'passed',
      payloadHash: 'sha256:<64 lowercase hex reviewed preview hash>',
      applyGateHash: 'sha256:<64 lowercase hex validated apply-gate hash>',
      liveApplyAuthorizedByThisRecord: false,
      durableApprovalIsCurrentTurnAuthorization: false,
      providedEvidence: bundles.approvalRecord.requiredEvidence,
    },
    applyAudit: {
      schemaVersion: bundles.applyAudit.schemaVersion,
      validationResult: 'passed',
      previewHash: 'sha256:<64 lowercase hex reviewed preview hash>',
      auditLogPath: '<path-to-apply-audit-jsonl>',
      rowCount: '<number of successful and skipped apply-audit rows>',
      liveApplyAuthorizedByThisRecord: false,
      providedEvidence: bundles.applyAudit.requiredEvidence,
    },
    applyReadback: {
      schemaVersion: bundles.applyReadback.schemaVersion,
      validationResult: 'passed',
      readEnabledInCurrentCli: false,
      checkCount: '<number of passed read-back checks>',
      semanticApplySuccessProvenByPrerequisites: false,
      providedEvidence: bundles.applyReadback.requiredEvidence,
    },
    guardedApplyResult: {
      schemaVersion: APPLY_RESULT_SCHEMA_VERSION,
      validationResult: 'passed',
      currentTurnAuthorizationCapturedAtExecution: true,
      liveApplyAuthorizedByThisRecord: false,
      providedEvidence: bundles.guardedApplyResult.requiredEvidence,
    },
  };
}

function validateWorkflowEvidence(output, contract, findings = []) {
  const key = workflowApplyResultKey(output.workflow, output.shape);
  const expected = buildWorkflowEvidenceBundles(key, output.workflow, output.shape, output.tenant, contract);
  return validateWorkflowEvidenceBundles({
    evidence: output.workflowEvidence,
    expected,
    output,
    applyResultSchemaVersion: APPLY_RESULT_SCHEMA_VERSION,
    findings,
  });
}

module.exports = {
  APPLY_RESULT_SCHEMA_VERSION,
  buildFutureWorkflowEvidence,
  buildTemplateVerificationChecks,
  buildTemplateWriteRows,
  buildWorkflowEvidenceBundles,
  getWorkflowApplyResultContract,
  validateWorkflowEvidence,
  workflowApplyResultKey,
};
