'use strict';

const { isPreflightSupported, isPackagePlanMoveShape } = require('../evidence-gates/support');

function nonEmpty(value) {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

const REVIEWED_ENDPOINT_SOURCE_IDS = new Set([
  'api-operations',
  'conventions',
  'danger-zone',
  'metronome-invoicing',
  'metronome-stripe-delivery',
  'packages-contracts',
  'shape-catalog',
]);

function endpointPlan(workflow, shape) {
  if (workflow === 'customer.setup' && shape === 'customer-setup') {
    return [
      {
        method: 'GET',
        path: '/v1/customers?ingest_alias={alias}&only_archived=false',
        sourceIds: ['endpoint-matrix', 'official-customer-list', 'shape-catalog'],
        purpose: 'Search active and archived customer aliases before create so globally unique ingest aliases are not stolen by an existing customer.',
      },
      {
        method: 'POST',
        path: '/v1/customers',
        sourceIds: ['endpoint-matrix', 'official-customer-create', 'shape-catalog'],
        purpose: 'Create exactly one reviewed customer with approved identity, ingest aliases, optional custom fields, and optional inline Stripe billing-provider configuration.',
      },
      {
        method: 'POST',
        path: '/v1/customers/{customer_id}/updateConfig',
        sourceIds: ['endpoint-matrix', 'official-customer-update-config', 'metronome-stripe-delivery'],
        purpose: 'Set reviewed first-class customer configuration fields such as salesforce_account_id and leave_stripe_invoices_in_draft when present in the preview.',
      },
    ];
  }

  if (workflow === 'package.apply' && shape === 'pro-annual') {
    return [
      {
        method: 'POST',
        path: '/v1/packages/create',
        sourceIds: ['endpoint-matrix', 'official-package-create'],
        purpose: 'Create or version the Pro Annual package payload from an approved preview.',
      },
    ];
  }

  if (workflow === 'credit.apply' && shape === 'complimentary-credit-grant') {
    return [
      {
        method: 'POST',
        path: '/v2/contracts/edit',
        sourceIds: ['endpoint-matrix', 'official-contract-edit', 'danger-zone', 'commits-credits'],
        purpose: 'Add a contract-scoped complimentary PREPAID commit from an approved preview, with no invoice_schedule for pure access grants unless the reviewed input intentionally uses a USD zero-dollar audit line.',
      },
    ];
  }

  if (workflow === 'credit.apply' && shape === 'paid-credit-top-up') {
    return [
      {
        method: 'POST',
        path: '/v2/contracts/edit',
        sourceIds: ['endpoint-matrix', 'official-contract-edit', 'danger-zone', 'commits-credits', 'metronome-invoicing', 'metronome-stripe-delivery'],
        purpose: 'Add a contract-scoped paid PREPAID top-up commit with fiat invoice schedule and STRIPE payment gate from an approved preview.',
      },
    ];
  }

  if (workflow === 'contract.move-plan.apply' && isPackagePlanMoveShape(shape)) {
    return [
      {
        method: 'POST',
        path: '/v1/contracts/updateEndDate',
        sourceIds: ['endpoint-matrix', 'official-contract-update-end-date', 'danger-zone'],
        purpose: shape === 'package-plan-move-immediate-invoice'
          ? 'End the predecessor contract at the reviewed cutover (current or past hour) while protecting finalized invoices.'
          : 'End the predecessor contract at the reviewed future cutover while protecting finalized invoices.',
      },
      {
        method: 'POST',
        path: '/v1/contracts/create',
        sourceIds: ['endpoint-matrix', 'official-contract-create', 'packages-contracts'],
        purpose: 'Create the successor package contract with transition.type RENEWAL from the predecessor.',
      },
    ];
  }

  if (workflow === 'subscription.contract.apply' && shape === 'direct-subscription-contract') {
    return [
      {
        method: 'POST',
        path: '/v1/contracts/create',
        sourceIds: ['endpoint-matrix', 'official-contract-create', 'subscriptions-seats', 'packages-contracts', 'metronome-stripe-delivery'],
        purpose: 'Create the direct contract with one reviewed subscription line, matching rate-card subscription rate, quantity or seat source, and explicit Stripe behavior.',
      },
    ];
  }

  if (workflow === 'custom-contract.create' && shape === 'enterprise-custom-contract') {
    return [
      {
        method: 'POST',
        path: '/v1/customers',
        sourceIds: ['endpoint-matrix', 'official-customer-create', 'custom-contract-payloads'],
        purpose: 'Conditionally create the reviewed Metronome customer only when the preview explicitly uses createMetronomeCustomer and identity read-back is planned.',
      },
      {
        method: 'POST',
        path: '/v1/setCustomerBillingProviderConfigurations',
        sourceIds: ['endpoint-matrix', 'official-billing-provider', 'custom-contract-payloads', 'metronome-stripe-delivery'],
        purpose: 'Attach the reviewed Stripe billing-provider configuration before invoice-producing custom contract creation.',
      },
      {
        method: 'POST',
        path: '/v1/contracts/create',
        sourceIds: ['endpoint-matrix', 'official-contract-create', 'custom-contract-payloads'],
        purpose: 'Create the direct enterprise custom contract with reviewed rate card, uniqueness key, recurring commit, invoice behavior, and optional seat subscription wiring.',
      },
      {
        method: 'POST',
        path: '/v2/contracts/edit',
        sourceIds: ['endpoint-matrix', 'official-contract-edit', 'custom-contract-payloads', 'danger-zone'],
        purpose: 'Conditionally add reviewed bonus commits only after contract create read-back and duplicate commit-name review pass.',
      },
      {
        method: 'POST',
        path: '/v2/contracts/edit',
        sourceIds: ['endpoint-matrix', 'official-contract-edit', 'custom-contract-payloads', 'subscriptions-seats'],
        purpose: 'Conditionally add initial seat assignments only after the created seat subscription id is read back.',
      },
    ];
  }

  if (workflow === 'billing-provider.attach' && shape === 'stripe-billing-provider-attachment') {
    return [
      {
        method: 'POST',
        path: '/v1/setCustomerBillingProviderConfigurations',
        sourceIds: ['endpoint-matrix', 'official-billing-provider', 'metronome-stripe-delivery'],
        purpose: 'Attach or reuse the reviewed Stripe billing-provider configuration with one explicit delivery method strategy.',
      },
      {
        method: 'POST',
        path: '/v1/customers/{customer_id}/updateConfig',
        sourceIds: ['endpoint-matrix', 'official-customer-update-config', 'metronome-stripe-delivery'],
        purpose: 'Set the reviewed customer-level leave_stripe_invoices_in_draft behavior.',
      },
    ];
  }

  if (workflow === 'invoice.issue-date-update' && shape === 'invoice-issue-date-update') {
    return [
      {
        method: 'POST',
        path: '/v1/contracts/updateInvoiceIssueDate',
        sourceIds: ['endpoint-matrix', 'official-invoice-issue-date', 'metronome-invoicing', 'metronome-stripe-delivery'],
        purpose: 'Move one reviewed DRAFT invoice issue date forward through the contract-scoped endpoint while preserving explicit Stripe behavior.',
      },
    ];
  }

  if (workflow === 'product.rate-retirement' && shape === 'product-rate-retirement') {
    return [
      {
        method: 'POST',
        path: '/v1/contract-pricing/rate-cards/addRates',
        sourceIds: ['endpoint-matrix', 'official-rate-card-add-rates', 'danger-zone'],
        purpose: 'Close every reviewed active product rate by adding entitled:false, price:0 rate entries at the reviewed cutover.',
      },
      {
        method: 'POST',
        path: '/v1/contract-pricing/products/archive',
        sourceIds: ['endpoint-matrix', 'official-product-archive', 'danger-zone'],
        purpose: 'Optionally archive the product only after reviewed rate-schedule evidence proves the product rates were closed.',
      },
    ];
  }

  if (workflow === 'rate-card.dimensional.apply' && shape === 'dimensional-rate-card') {
    return [
      {
        method: 'POST',
        path: '/v1/contract-pricing/products/create',
        sourceIds: ['endpoint-matrix', 'official-product-create', 'pricing-catalog', 'billable-metrics'],
        purpose: 'Create or reuse the reviewed dimensional USAGE product backed by the reviewed billable metric and group-key evidence.',
      },
      {
        method: 'POST',
        path: '/v1/contract-pricing/rate-cards/addRates',
        sourceIds: ['endpoint-matrix', 'official-rate-card-add-rates', 'pricing-catalog', 'danger-zone'],
        purpose: 'Append the reviewed per-action dimensional rate rows at the reviewed UTC hour-boundary starting_at after canary read-back.',
      },
    ];
  }

  if (workflow === 'package.archive' && shape === 'package-alias-archive-handoff') {
    return [
      {
        method: 'POST',
        path: '/v1/packages/archive',
        sourceIds: ['endpoint-matrix', 'official-package-archive', 'packages-contracts'],
        purpose: 'Archive the reviewed old package version only after replacement alias handoff is proven live.',
      },
    ];
  }

  if (workflow === 'usage.ingest-preview' && shape === 'usage-ingest-preview') {
    return [
      {
        method: 'POST',
        path: '/v1/customers/{customer_id}/previewEvents',
        sourceIds: ['endpoint-matrix', 'official-invoice-preview-events', 'metronome-invoicing'],
        purpose: 'Preview the full usage event batch against the reviewed customer and invoice period before any ingest write.',
      },
      {
        method: 'POST',
        path: '/v1/ingest',
        sourceIds: ['endpoint-matrix', 'official-usage-ingest', 'metronome-ingestion-events', 'danger-zone'],
        purpose: 'Ingest only the reviewed canary events with stable transaction_id values before any bulk remainder.',
      },
      {
        method: 'POST',
        path: '/v1/ingest',
        sourceIds: ['endpoint-matrix', 'official-usage-ingest', 'metronome-ingestion-events', 'danger-zone'],
        purpose: 'Ingest the remaining reviewed events only after canary event search, usage groups, and invoice-impact read-back pass.',
      },
    ];
  }

  return [];
}

function identifiersFor(workflow, shape) {
  if (workflow === 'customer.setup') {
    return [
      { system: 'lev', role: 'account_id', id: '<lev_account_id>' },
      { system: 'metronome', role: 'primary_ingest_alias', id: '<primary_ingest_alias>' },
      { system: 'metronome', role: 'ingest_alias_set_hash', id: '<sha256_of_reviewed_ingest_aliases>' },
      { system: 'metronome', role: 'customer_id_after_readback', id: '<created_or_reused_customer_id>' },
      { system: 'stripe', role: 'customer_id', id: '<stripe_customer_id_or_verified_none>' },
      { system: 'metronome', role: 'delivery_method_id_or_direct', id: '<delivery_method_id_or_direct_to_billing_provider_or_none>' },
    ];
  }

  if (workflow === 'package.apply') {
    return [
      { system: 'metronome', role: 'package_alias', id: '<package_alias>' },
      { system: 'metronome', role: 'rate_card_id', id: '<rate_card_id>' },
    ];
  }

  if (workflow === 'contract.move-plan.apply') {
    return [
      { system: 'metronome', role: 'customer_id', id: '<metronome_customer_id>' },
      { system: 'metronome', role: 'current_contract_id', id: '<predecessor_contract_id>' },
      { system: 'metronome', role: 'target_package_alias', id: '<target_package_alias>' },
      { system: 'stripe', role: 'customer_id', id: '<stripe_customer_id_or_verified_none>' },
    ];
  }

  if (workflow === 'credit.apply' && shape === 'complimentary-credit-grant') {
    return [
      { system: 'metronome', role: 'customer_id', id: '<metronome_customer_id>' },
      { system: 'metronome', role: 'contract_id', id: '<metronome_contract_id>' },
      { system: 'metronome', role: 'product_id', id: '<metronome_product_id_or_verified_none>' },
      { system: 'metronome', role: 'commit_name', id: '<reviewed_complimentary_commit_name>' },
      { system: 'metronome', role: 'access_credit_type_id', id: '<access_credit_type_id>' },
    ];
  }

  if (workflow === 'credit.apply') {
    return [
      { system: 'metronome', role: 'customer_id', id: '<metronome_customer_id>' },
      { system: 'metronome', role: 'contract_id', id: '<metronome_contract_id>' },
      { system: 'metronome', role: 'product_id', id: '<metronome_product_id_or_verified_none>' },
      { system: 'stripe', role: 'customer_id', id: '<stripe_customer_id_or_verified_none>' },
    ];
  }

  if (workflow === 'subscription.contract.apply') {
    return [
      { system: 'metronome', role: 'customer_id', id: '<metronome_customer_id>' },
      { system: 'metronome', role: 'rate_card_id', id: '<metronome_rate_card_id>' },
      { system: 'metronome', role: 'subscription_product_id', id: '<subscription_product_id>' },
      { system: 'metronome', role: 'contract_uniqueness_key', id: '<contract_uniqueness_key>' },
      { system: 'stripe', role: 'customer_id', id: '<stripe_customer_id_or_verified_none>' },
    ];
  }

  if (workflow === 'custom-contract.create') {
    return [
      { system: 'lev', role: 'account_id', id: '<lev_account_id>' },
      { system: 'metronome', role: 'customer_id', id: '<existing_or_to_be_created_metronome_customer_id>' },
      { system: 'metronome', role: 'rate_card_id', id: '<metronome_rate_card_id>' },
      { system: 'metronome', role: 'contract_uniqueness_key', id: '<custom_contract_uniqueness_key>' },
      { system: 'metronome', role: 'base_commit_name', id: '<reviewed_base_commit_name>' },
      { system: 'stripe', role: 'customer_id', id: '<stripe_customer_id>' },
      { system: 'metronome', role: 'stripe_delivery_method_id', id: '<billing_provider_delivery_method_id>' },
    ];
  }

  if (workflow === 'billing-provider.attach') {
    return [
      { system: 'metronome', role: 'customer_id', id: '<metronome_customer_id>' },
      { system: 'stripe', role: 'customer_id', id: '<stripe_customer_id>' },
      { system: 'metronome', role: 'delivery_method_id_or_direct', id: '<delivery_method_id_or_direct_to_billing_provider>' },
      { system: 'metronome', role: 'billing_provider_configuration_id_after_readback', id: '<created_or_reused_config_id>' },
    ];
  }

  if (workflow === 'invoice.issue-date-update') {
    return [
      { system: 'metronome', role: 'customer_id', id: '<metronome_customer_id>' },
      { system: 'metronome', role: 'contract_id', id: '<metronome_contract_id>' },
      { system: 'metronome', role: 'invoice_id', id: '<draft_invoice_id>' },
      { system: 'metronome', role: 'target_issue_date', id: '<target_issue_date_iso>' },
      { system: 'stripe', role: 'customer_id', id: '<stripe_customer_id_or_verified_none>' },
    ];
  }

  if (workflow === 'product.rate-retirement') {
    return [
      { system: 'metronome', role: 'product_id', id: '<metronome_product_id>' },
      { system: 'metronome', role: 'starting_at', id: '<retirement_starting_at_iso>' },
      { system: 'metronome', role: 'affected_rate_card_ids', id: '<reviewed_rate_card_ids>' },
      { system: 'metronome', role: 'archive_product_after_rates_close', id: '<true_or_false>' },
    ];
  }

  if (workflow === 'rate-card.dimensional.apply') {
    return [
      { system: 'metronome', role: 'rate_card_id', id: '<metronome_rate_card_id>' },
      { system: 'metronome', role: 'usage_product_name', id: '<reviewed_usage_product_name>' },
      { system: 'metronome', role: 'billable_metric_id', id: '<reviewed_billable_metric_id>' },
      { system: 'metronome', role: 'starting_at', id: '<dimensional_rates_starting_at_iso>' },
      { system: 'metronome', role: 'action_code_set_hash', id: '<sha256_of_reviewed_action_codes>' },
    ];
  }

  if (workflow === 'package.archive') {
    return [
      { system: 'metronome', role: 'old_package_id', id: '<old_package_id>' },
      { system: 'metronome', role: 'package_alias', id: '<package_alias>' },
      { system: 'metronome', role: 'replacement_package_id', id: '<replacement_package_id>' },
      { system: 'metronome', role: 'replacement_alias_live_at', id: '<replacement_alias_live_at_iso>' },
    ];
  }

  if (workflow === 'usage.ingest-preview') {
    return [
      { system: 'metronome', role: 'customer_id', id: '<metronome_customer_id>' },
      { system: 'metronome', role: 'expected_event_type', id: '<expected_event_type>' },
      { system: 'metronome', role: 'invoice_period', id: '<starting_at_to_ending_before>' },
      { system: 'metronome', role: 'canary_event_count', id: '<canary_event_count>' },
      { system: 'metronome', role: 'transaction_id_set_hash', id: '<sha256_of_reviewed_transaction_ids>' },
    ];
  }

  return [
    { system: 'metronome', role: 'customer_id', id: '<metronome_customer_id>' },
    { system: 'metronome', role: 'contract_id', id: '<metronome_contract_id>' },
  ];
}

function tenantFlag(tenant) {
  if (tenant === 'production') return '--prod';
  if (tenant === 'sandbox') return '--sandbox';
  return '(--sandbox|--prod)';
}

function previewCommandFor(workflow, shape, tenant = '<sandbox|production>') {
  const flag = tenantFlag(tenant);
  if (workflow === 'customer.setup') {
    return `metro customer setup preview --file <input.json|yaml> ${flag} --json`;
  }
  if (workflow === 'package.apply') {
    return `metro package preview --shape pro-annual --file <input.json|yaml> ${flag} --json`;
  }
  if (workflow === 'contract.move-plan.apply') {
    return `metro contract move-plan preview --file <input.json|yaml> ${flag} --json`;
  }
  if (workflow === 'credit.apply' && shape === 'complimentary-credit-grant') {
    return `metro credit preview --shape complimentary-credit-grant --file <input.json|yaml> ${flag} --json`;
  }
  if (workflow === 'credit.apply' && shape === 'paid-credit-top-up') {
    return `metro credit preview --shape paid-credit-top-up --file <input.json|yaml> ${flag} --json`;
  }
  if (workflow === 'subscription.contract.apply' && shape === 'direct-subscription-contract') {
    return `metro subscription contract preview --shape direct-subscription-contract --file <input.json|yaml> ${flag} --json`;
  }
  if (workflow === 'custom-contract.create' && shape === 'enterprise-custom-contract') {
    return `metro custom-contract preview --file <input.json|yaml> ${flag} --json`;
  }
  if (workflow === 'billing-provider.attach' && shape === 'stripe-billing-provider-attachment') {
    return `metro billing-provider preview --shape stripe-billing-provider-attachment --file <input.json|yaml> ${flag} --json`;
  }
  if (workflow === 'invoice.issue-date-update' && shape === 'invoice-issue-date-update') {
    return `metro invoice issue-date preview --file <input.json|yaml> ${flag} --json`;
  }
  if (workflow === 'product.rate-retirement' && shape === 'product-rate-retirement') {
    return `metro product retire preview --file <input.json|yaml> ${flag} --json`;
  }
  if (workflow === 'rate-card.dimensional.apply' && shape === 'dimensional-rate-card') {
    return `metro rate-card dimensional preview --file <input.json|yaml> ${flag} --json`;
  }
  if (workflow === 'package.archive' && shape === 'package-alias-archive-handoff') {
    return `metro package archive preview --file <input.json|yaml> ${flag} --json`;
  }
  if (workflow === 'usage.ingest-preview' && shape === 'usage-ingest-preview') {
    return `metro usage ingest preview --file <input.json|yaml> ${flag} --json`;
  }
  return `metro preview --file <input.json|yaml> ${flag} --json`;
}

function executionCommandFor(workflow, shape, tenant = 'production') {
  const flag = tenantFlag(tenant);
  if (workflow === 'customer.setup') {
    return `metro customer setup apply --file <input.json|yaml> ${flag} --confirm-hash <hash>`;
  }
  if (workflow === 'package.apply') {
    return `metro package apply --shape pro-annual --file <input.json|yaml> ${flag} --confirm-hash <hash>`;
  }
  if (workflow === 'contract.move-plan.apply') {
    return `metro contract move-plan apply --file <input.json|yaml> ${flag} --confirm-hash <hash>`;
  }
  if (workflow === 'credit.apply' && shape === 'paid-credit-top-up') {
    return `metro credit apply --shape paid-credit-top-up --file <input.json|yaml> ${flag} --confirm-hash <hash>`;
  }
  if (workflow === 'subscription.contract.apply' && shape === 'direct-subscription-contract') {
    return `metro subscription contract apply --file <input.json|yaml> ${flag} --confirm-hash <hash>`;
  }
  if (workflow === 'custom-contract.create' && shape === 'enterprise-custom-contract') {
    return `metro custom-contract apply --file <input.json|yaml> ${flag} --confirm-hash <hash>`;
  }
  if (workflow === 'billing-provider.attach' && shape === 'stripe-billing-provider-attachment') {
    return `metro billing-provider apply --shape stripe-billing-provider-attachment --file <input.json|yaml> ${flag} --confirm-hash <hash>`;
  }
  if (workflow === 'invoice.issue-date-update' && shape === 'invoice-issue-date-update') {
    return `metro invoice issue-date apply --file <input.json|yaml> ${flag} --confirm-hash <hash>`;
  }
  if (workflow === 'product.rate-retirement' && shape === 'product-rate-retirement') {
    return `metro product retire apply --file <input.json|yaml> ${flag} --confirm-hash <hash>`;
  }
  if (workflow === 'rate-card.dimensional.apply' && shape === 'dimensional-rate-card') {
    return `metro rate-card dimensional apply --file <input.json|yaml> ${flag} --confirm-hash <hash>`;
  }
  if (workflow === 'package.archive' && shape === 'package-alias-archive-handoff') {
    return `metro package archive apply --file <input.json|yaml> ${flag} --confirm-hash <hash>`;
  }
  if (workflow === 'usage.ingest-preview' && shape === 'usage-ingest-preview') {
    return `metro usage ingest apply --file <input.json|yaml> ${flag} --confirm-hash <hash>`;
  }
  return `metro credit apply --shape complimentary-credit-grant --file <input.json|yaml> ${flag} --confirm-hash <hash>`;
}

function sideEffectsFor(workflow, shape) {
  if (workflow === 'customer.setup' && shape === 'customer-setup') {
    return [
      'Search customer ingest aliases before any create because ingest_aliases are globally unique and archived customers can retain aliases.',
      'Create exactly one Metronome customer or stop for reviewed reuse if the active customer is the same external account.',
      'Optionally attach inline Stripe billing-provider configuration and update leave_stripe_invoices_in_draft according to the reviewed preview.',
      'The workflow must not create contracts, packages, commits, credits, subscriptions, hierarchy contracts, invoices, or Stripe artifacts.',
      'Customer hierarchy must remain deferred to future contract hierarchy_configuration read-back; it is not written on the customer object.',
    ];
  }

  if (workflow === 'credit.apply' && shape === 'complimentary-credit-grant') {
    return [
      'Add exactly one complimentary PREPAID commit to the reviewed contract.',
      'Pure access grants must omit invoice_schedule so no Metronome invoice artifact or Stripe push is expected.',
      'If the reviewed input intentionally uses the audit-line variant, invoice_schedule must use USD cents, unit_price 0, quantity 1, and explicit audit-line intent.',
      'The workflow must not create paid invoices, payment gates, Stripe charges, contract transitions, package changes, or billing-provider changes.',
    ];
  }

  if (workflow === 'contract.move-plan.apply') {
    return [
      'End predecessor contract at the reviewed future cutover with allow_ending_before_finalized_invoice=false.',
      'Create a successor package contract with transition.type=RENEWAL from the predecessor.',
      'No immediate invoice is expected only if current invoice inventory, future cutover, and package alias evidence match the reviewed preview.',
      'Stripe billing-provider configuration should be preserved, not attached, archived, or replaced by this workflow.',
    ];
  }

  if (workflow === 'credit.apply' && shape === 'paid-credit-top-up') {
    return [
      'Add exactly one paid PREPAID top-up commit to the reviewed contract.',
      'Create a fiat invoice_schedule item for the reviewed unit price in cents and quantity 1.',
      'Gate the paid commit with payment_gate_config.payment_gate_type=STRIPE until Stripe collection succeeds.',
      'Stripe behavior must match the reviewed billing-provider configuration and declared stripeBehavior.',
    ];
  }

  if (workflow === 'subscription.contract.apply' && shape === 'direct-subscription-contract') {
    return [
      'Create one direct Metronome contract with one reviewed subscriptions[] line.',
      'Subscription rate identity, product_id, and billing_frequency must match the reviewed rate-card schedule.',
      'Quantity source must be explicit: QUANTITY_ONLY initial_quantity or SEAT_BASED seat_config.initial_seat_ids.',
      'Subscription invoices are expected and Stripe behavior must match the reviewed billing-provider configuration.',
    ];
  }

  if (workflow === 'custom-contract.create' && shape === 'enterprise-custom-contract') {
    return [
      'Use an existing reviewed Metronome customer or create exactly one customer for the reviewed external account id before contract creation.',
      'Attach the reviewed Stripe billing-provider configuration and delivery method before creating any invoice-producing custom contract.',
      'Create one direct enterprise custom contract with reviewed rate card, uniqueness key, recurring commit, invoice amount, access credit type, and fiat invoice credit type.',
      'Bonus commits and initial seat assignments are conditional follow-up edits that must wait for contract and subscription read-back.',
      'Custom-contract invoices and Stripe behavior must match the reviewed leave_stripe_invoices_in_draft and stripeBehavior fields.',
    ];
  }

  if (workflow === 'billing-provider.attach' && shape === 'stripe-billing-provider-attachment') {
    return [
      'Attach or reuse one active Stripe billing-provider configuration for the reviewed customer.',
      'Set leave_stripe_invoices_in_draft to the reviewed explicit boolean on the customer configuration.',
      'No invoice should be created, finalized, voided, archived, or pushed to Stripe by this attachment itself.',
      'Delivery routing must match the reviewed deliveryMethodId or direct_to_billing_provider strategy, with multi-entity evidence when required.',
    ];
  }

  if (workflow === 'invoice.issue-date-update' && shape === 'invoice-issue-date-update') {
    return [
      'Move exactly one reviewed DRAFT invoice issue_date forward through /v1/contracts/updateInvoiceIssueDate.',
      'The target issue date must remain before the reviewed contract ending_before timestamp unless no end date was proven.',
      'The workflow must not finalize, void, regenerate, archive, or otherwise collect the invoice.',
      'Stripe behavior must match the reviewed billing-provider configuration and declared stripeBehavior.',
    ];
  }

  if (workflow === 'product.rate-retirement' && shape === 'product-rate-retirement') {
    return [
      'Append entitled:false, price:0 rate entries at the reviewed cutover on every affected rate card.',
      'Optionally archive the product only after rate close entries are proven; archive alone does not retire existing rate-card entries.',
      'Existing contracts and invoices are not voided, regenerated, finalized, or otherwise changed by the rate close plan itself.',
      'Invoice preview or read-back must prove the retired product no longer creates billable or ghost invoice lines after cutover.',
    ];
  }

  if (workflow === 'rate-card.dimensional.apply' && shape === 'dimensional-rate-card') {
    return [
      'Create or reuse exactly one dimensional USAGE product with pricing_group_key action_code and presentation_group_key action_display_name.',
      'Append the reviewed per-action FLAT rate rows to the reviewed rate card at the reviewed UTC hour-boundary starting_at.',
      'Apply the first action_code as a sandbox canary and read back product, rate schedule, getRates selector, usage groups, and invoice impact before any remaining rows.',
      'The workflow must not create one product per action and must not mutate contracts, invoices, billing-provider configurations, credits, commits, or Stripe state directly.',
    ];
  }

  if (workflow === 'package.archive' && shape === 'package-alias-archive-handoff') {
    return [
      'Archive exactly one reviewed old package version by package_id after replacement alias handoff is already live.',
      'Existing contracts on the old package are expected to remain attached, but their inventory must be reviewed before archive.',
      'Future package_alias contract creates should resolve to the replacement package, not the archived old package.',
      'The workflow must not create, edit, archive, or void contracts, invoices, billing-provider configurations, credits, or commits.',
    ];
  }

  if (workflow === 'usage.ingest-preview' && shape === 'usage-ingest-preview') {
    return [
      'Preview the full reviewed usage batch with previewEvents before any ingest write.',
      'Ingest only the canary event set first with stable transaction_id values.',
      'Proceed to any remaining events only after event search, usage groups, and invoice-impact read-back pass.',
      'Past-dated usage can change invoice economics, commit burn-down, follow-up billing, or Stripe-facing invoice impact; finalized-period review must be complete before execution.',
    ];
  }

  return [
    '<business-side-effect>',
    '<invoice-behavior>',
    '<stripe-behavior>',
  ];
}

function verificationQueriesFor(workflow, shape) {
  if (workflow === 'customer.setup' && shape === 'customer-setup') {
    return [
      {
        method: 'GET',
        path: '/v1/customers/{customer_id}',
        expectation: 'Customer read-back shows the reviewed name, custom fields, archived state, ingest aliases, Salesforce account id when present, and leave_stripe_invoices_in_draft when present.',
      },
      {
        method: 'GET',
        path: '/v1/customers?ingest_alias={alias}',
        expectation: 'Every reviewed ingest alias resolves to the intended customer and no active or archived collision remains unresolved.',
      },
      {
        method: 'POST',
        path: '/v1/getCustomerBillingProviderConfigurations',
        expectation: 'When Stripe setup is planned, billing-provider read-back shows the expected Stripe customer id, collection method, and delivery method; otherwise non-applicability is documented.',
      },
      {
        method: 'GET',
        path: '/v1/customers/{customer_id}/invoices?limit=50',
        expectation: 'Customer setup alone created no invoice and pushed no Stripe artifact; later contract workflows own invoice and Stripe side effects.',
      },
      {
        method: 'POST',
        path: '/v2/contracts/get',
        expectation: 'When hierarchyMode is not standalone, future contract read-back must verify hierarchy_configuration because customer setup does not write hierarchy.',
      },
    ];
  }

  if (workflow === 'credit.apply' && shape === 'complimentary-credit-grant') {
    return [
      {
        method: 'POST',
        path: '/v1/contracts/customerBalances/list',
        expectation: 'The complimentary commit appears once by reviewed name on the reviewed contract with expected amount, access credit type, priority, rollover, and applicable product tags.',
      },
      {
        method: 'GET',
        path: '/v1/customers/{customer_id}/invoices',
        expectation: 'Customer invoice inventory confirms no new invoice artifact for pure access grants, or exactly the reviewed zero-dollar audit line for the audit-line variant.',
      },
      {
        method: 'POST',
        path: '/v2/contracts/get',
        expectation: 'Contract read-back shows the complimentary commit is attached to the intended contract and no unrelated contract terms changed.',
      },
    ];
  }

  if (workflow === 'contract.move-plan.apply') {
    return [
      {
        method: 'POST',
        path: '/v2/contracts/get',
        expectation: 'Predecessor ending_before equals the reviewed cutover and finalized-invoice protection did not require allow_ending_before_finalized_invoice=true.',
      },
      {
        method: 'POST',
        path: '/v2/contracts/list',
        expectation: 'Successor contract starts at cutover, uses the target package alias, and has a transition from the predecessor contract.',
      },
      {
        method: 'GET',
        path: '/v1/customers/{customer_id}/invoices',
        expectation: 'No surprise invoice appears before cutover and old-plan future invoices are understood.',
      },
      {
        method: 'POST',
        path: '/v1/getCustomerBillingProviderConfigurations',
        expectation: 'Active Stripe billing-provider configuration remains present and unchanged.',
      },
    ];
  }

  if (workflow === 'credit.apply' && shape === 'paid-credit-top-up') {
    return [
      {
        method: 'POST',
        path: '/v1/contracts/customerBalances/list',
        expectation: 'The paid top-up commit appears once by reviewed name with expected amount, access credit type, priority, and payment gate state.',
      },
      {
        method: 'GET',
        path: '/v1/customers/{customer_id}/invoices',
        expectation: 'Customer invoice inventory shows the expected paid top-up invoice amount, status, and external_invoice state.',
      },
      {
        method: 'POST',
        path: '/v1/getCustomerBillingProviderConfigurations',
        expectation: 'Billing-provider read-back still supports the reviewed Stripe behavior before and after the paid top-up apply.',
      },
    ];
  }

  if (workflow === 'subscription.contract.apply' && shape === 'direct-subscription-contract') {
    return [
      {
        method: 'POST',
        path: '/v2/contracts/get',
        expectation: 'Contract read-back shows one subscription with the reviewed product id, billing frequency, quantity management mode, and starting timestamp.',
      },
      {
        method: 'POST',
        path: '/v1/contract-pricing/rate-cards/getRateSchedule',
        expectation: 'Rate schedule still contains the matching SubscriptionProductListItem rate for the reviewed product id and billing frequency.',
      },
      {
        method: 'POST',
        path: '/v1/contracts/getSubscriptionQuantityHistory',
        expectation: 'Subscription quantity history shows the reviewed initial quantity or named-seat-derived quantity.',
      },
      {
        method: 'POST',
        path: '/v1/contracts/getSubscriptionSeatsHistory',
        expectation: 'For SEAT_BASED subscriptions, seat history shows the reviewed initial named seats; for QUANTITY_ONLY, the non-applicability is documented.',
      },
      {
        method: 'POST',
        path: '/v1/getCustomerBillingProviderConfigurations',
        expectation: 'Billing-provider read-back supports the reviewed Stripe behavior.',
      },
      {
        method: 'GET',
        path: '/v1/customers/{customer_id}/invoices',
        expectation: 'Customer invoice inventory matches the expected subscription invoice timing and external_invoice behavior.',
      },
    ];
  }

  if (workflow === 'custom-contract.create' && shape === 'enterprise-custom-contract') {
    return [
      {
        method: 'GET',
        path: '/v1/customers/{customer_id}',
        expectation: 'Customer read-back matches the reviewed external account id, company name, ingest alias, and custom fields before or after customer creation.',
      },
      {
        method: 'POST',
        path: '/v1/getCustomerBillingProviderConfigurations',
        expectation: 'Billing-provider read-back shows the reviewed Stripe customer, delivery method, collection method, and leave_stripe_invoices_in_draft behavior.',
      },
      {
        method: 'POST',
        path: '/v2/contracts/get',
        expectation: 'Contract read-back shows the reviewed rate card, uniqueness key, start/end timestamps, recurring commit, invoice amount, and optional seat subscription.',
      },
      {
        method: 'POST',
        path: '/v1/contracts/customerBalances/list',
        expectation: 'Customer balances show recurring and bonus commit access amounts exactly once with expected product and credit type ids.',
      },
      {
        method: 'GET',
        path: '/v1/customers/{customer_id}/invoices',
        expectation: 'Customer invoice inventory matches the reviewed custom-contract invoice timing, amount, draft/finalization state, and external Stripe behavior.',
      },
      {
        method: 'POST',
        path: '/v1/contracts/getSubscriptionQuantityHistory',
        expectation: 'For seat-based custom contracts, subscription quantity history reflects the reviewed initial seat assignments; otherwise non-applicability is documented.',
      },
      {
        method: 'POST',
        path: '/v1/contracts/getSubscriptionSeatsHistory',
        expectation: 'For seat-based custom contracts, seat history shows each reviewed initial seat id assigned to the created subscription.',
      },
    ];
  }

  if (workflow === 'billing-provider.attach' && shape === 'stripe-billing-provider-attachment') {
    return [
      {
        method: 'GET',
        path: '/v1/customers/{customer_id}',
        expectation: 'Customer read-back matches the reviewed Metronome customer id and leave_stripe_invoices_in_draft value.',
      },
      {
        method: 'POST',
        path: '/v1/getCustomerBillingProviderConfigurations',
        expectation: 'Exactly one reviewed active Stripe billing-provider configuration exists or the existing matching configuration was reused according to policy.',
      },
      {
        method: 'POST',
        path: '/v1/listConfiguredBillingProviders',
        expectation: 'For deliveryMethodId or multi-entity routing, the delivery method resolves to the reviewed active Stripe account and direct_to_billing_provider method.',
      },
    ];
  }

  if (workflow === 'invoice.issue-date-update' && shape === 'invoice-issue-date-update') {
    return [
      {
        method: 'POST',
        path: '/v1/invoices/get',
        expectation: 'Invoice read-back shows status remains DRAFT and issue_date equals the reviewed targetIssueDate.',
      },
      {
        method: 'GET',
        path: '/v1/customers/{customer_id}/invoices?limit=N&status=DRAFT',
        expectation: 'Customer draft invoice inventory contains the target invoice and shows no unexpected finalized or duplicate invoice side effects.',
      },
      {
        method: 'POST',
        path: '/v2/contracts/get',
        expectation: 'Contract read-back proves the target issue date is before ending_before, or that the contract has no end date.',
      },
      {
        method: 'POST',
        path: '/v1/getCustomerBillingProviderConfigurations',
        expectation: 'Billing-provider read-back supports the reviewed invoice Stripe behavior.',
      },
    ];
  }

  if (workflow === 'product.rate-retirement' && shape === 'product-rate-retirement') {
    return [
      {
        method: 'POST',
        path: '/v1/contract-pricing/rate-cards/getRateSchedule',
        expectation: 'Every affected rate card shows an entitled:false, price:0 entry for the product at the reviewed cutover and no later unintended entitled:true entry.',
      },
      {
        method: 'POST',
        path: '/v1/contract-pricing/products/get',
        expectation: 'Product read-back matches the reviewed archive decision after rate close evidence exists.',
      },
      {
        method: 'GET',
        path: '/v1/customers/{customer_id}/invoices',
        expectation: 'Targeted invoice preview or read-back confirms the retired product no longer produces billable or ghost lines after cutover.',
      },
    ];
  }

  if (workflow === 'rate-card.dimensional.apply' && shape === 'dimensional-rate-card') {
    return [
      {
        method: 'POST',
        path: '/v1/contract-pricing/products/get',
        expectation: 'Product read-back shows one USAGE product with the reviewed billable_metric_id, pricing_group_key, presentation_group_key, and tags.',
      },
      {
        method: 'POST',
        path: '/v1/contract-pricing/rate-cards/getRateSchedule',
        expectation: 'Rate schedule read-back shows each reviewed action_code row at starting_at with entitled:true, FLAT rate type, price, and credit type from the preview.',
      },
      {
        method: 'POST',
        path: '/v1/contract-pricing/rate-cards/getRates',
        expectation: 'Selector read-back by product and pricing_group_values.action_code returns the intended dimensional rates without duplicate entitled rows.',
      },
      {
        method: 'POST',
        path: '/v1/usage/groups',
        expectation: 'Usage group read-back proves canary events include action_code and action_display_name under the compound metric group key.',
      },
      {
        method: 'GET',
        path: '/v1/customers/{customer_id}/invoices',
        expectation: 'Invoice preview or inventory read-back shows no surprise invoice, duplicate billable line, or Stripe delivery side effect before remaining rates are applied.',
      },
    ];
  }

  if (workflow === 'package.archive' && shape === 'package-alias-archive-handoff') {
    return [
      {
        method: 'POST',
        path: '/v1/packages/get',
        expectation: 'Old package read-back shows the reviewed old package id is archived after apply.',
      },
      {
        method: 'POST',
        path: '/v1/packages/list?limit=100',
        expectation: 'Package list read-back proves the package alias resolves to the reviewed replacement package id and the replacement alias live timestamp is not in the future.',
      },
      {
        method: 'POST',
        path: '/v1/packages/listContractsOnPackage',
        expectation: 'Contracts on the old package were inventoried before archive and remain understood after archive.',
      },
    ];
  }

  if (workflow === 'usage.ingest-preview' && shape === 'usage-ingest-preview') {
    return [
      {
        method: 'POST',
        path: '/v1/customers/{customer_id}/previewEvents',
        expectation: 'PreviewEvents output matches the reviewed invoice period, line items, credit burn-down, and Stripe side-effect review before any ingest write.',
      },
      {
        method: 'POST',
        path: '/v1/events/search',
        expectation: 'Each canary and bulk transaction_id is accepted once, not duplicated, and belongs to the intended customer and billable metric.',
      },
      {
        method: 'POST',
        path: '/v1/usage/groups',
        expectation: 'Usage group totals for the invoice period reflect the reviewed event action codes before bulk ingest and after any remaining batch.',
      },
      {
        method: 'GET',
        path: '/v1/customers/{customer_id}/invoices',
        expectation: 'Customer invoice inventory shows no unexpected finalized invoice, duplicate bill, or Stripe delivery side effect.',
      },
    ];
  }

  return [
    {
      method: '<GET|POST>',
      path: '<metronome-read-endpoint>',
      expectation: '<state that must be true after apply>',
    },
  ];
}

function rollbackPlanFor(workflow, shape) {
  if (workflow === 'customer.setup' && shape === 'customer-setup') {
    return '<stop retries, search active and archived ingest aliases, inspect customer/billing-provider/invoice state, avoid archive/delete remediation by default, and release or correct aliases only through owner-approved follow-up after no invoice or Stripe side effect is proven>';
  }
  if (workflow === 'contract.move-plan.apply') {
    return '<restore predecessor end date, pause or archive successor before cutover, and confirm no invoice or Stripe artifact was created>';
  }
  if (workflow === 'credit.apply' && shape === 'complimentary-credit-grant') {
    return '<stop retries, inspect contract balance and invoice inventory, avoid duplicate grant replays, and remediate or shorten/archive the mistaken commit only with owner approval and invoice/Stripe side-effect review>';
  }
  if (workflow === 'credit.apply' && shape === 'paid-credit-top-up') {
    return '<stop retries, inspect invoice/payment gate/Stripe state, reconcile or void/remediate only with owner approval, and verify customer balance>';
  }
  if (workflow === 'subscription.contract.apply' && shape === 'direct-subscription-contract') {
    return '<stop retries, inspect contract/subscription/invoice/Stripe state, remediate only with owner approval, and verify quantity or seat history>';
  }
  if (workflow === 'custom-contract.create' && shape === 'enterprise-custom-contract') {
    return '<stop retries, inspect customer, billing-provider, contract, commit, seat, invoice, and Stripe state; keep Stripe invoices in draft when reviewed; remediate or end/archive only with owner approval and read-back evidence>';
  }
  if (workflow === 'billing-provider.attach' && shape === 'stripe-billing-provider-attachment') {
    return '<stop retries, inspect customer billing-provider configuration and Stripe delivery routing, restore only by owner-approved set/archive/recreate steps, and verify no invoice or Stripe artifact was created by the attachment>';
  }
  if (workflow === 'invoice.issue-date-update' && shape === 'invoice-issue-date-update') {
    return '<stop retries, inspect invoice status/issue_date/Stripe delivery state, remediate only with owner approval, and verify the invoice remains DRAFT or follow the documented Stripe reconciliation path>';
  }
  if (workflow === 'product.rate-retirement' && shape === 'product-rate-retirement') {
    return '<stop retries, inspect all affected rate schedules and invoice impact, restore with owner-approved corrective addRates entries only if needed, and archive or unarchive follow-up only after rate state is proven>';
  }
  if (workflow === 'rate-card.dimensional.apply' && shape === 'dimensional-rate-card') {
    return '<stop retries, inspect product, rate schedule, selector, usage group, and invoice impact evidence; close mistaken dimensional rates with owner-approved corrective addRates entries, and archive accidental test products only after rate state is proven>';
  }
  if (workflow === 'package.archive' && shape === 'package-alias-archive-handoff') {
    return '<stop retries, inspect old package archive state, replacement alias resolution, and contracts-on-package inventory; remediate only with owner-approved replacement package or alias correction steps>';
  }
  if (workflow === 'usage.ingest-preview' && shape === 'usage-ingest-preview') {
    return '<stop retries, search submitted transaction IDs, reconcile usage groups and invoice impact, do not replay transaction IDs unless read-back proves they are missing, and remediate invoices or credits only with owner approval>';
  }
  return '<rollback or remediation path if verification fails>';
}

function idempotencyFor(workflow, shape) {
  if (workflow === 'customer.setup' && shape === 'customer-setup') {
    return {
      strategy: '<search active and archived customers by every reviewed ingest alias plus external account id before create; reuse only when exact identity fields match>',
      duplicatePrevention: '<retry create only after customer, alias, billing-provider, and invoice read-back proves no matching customer or partial create already exists>',
    };
  }
  if (workflow === 'contract.move-plan.apply') {
    return {
      strategy: '<stable successor contract uniqueness_key plus predecessor/current-state checks>',
      duplicatePrevention: '<validate successor create payload before updateEndDate, then retry successor creation only with the same uniqueness_key if needed>',
    };
  }
  if (workflow === 'credit.apply' && shape === 'complimentary-credit-grant') {
    return {
      strategy: '<review existing contract commits by name, amount, access credit type, and start timestamp before add_commits because no client-side idempotency key is available>',
      duplicatePrevention: '<retry only after balance and invoice read-back proves no matching complimentary grant commit or audit-line invoice artifact was created>',
    };
  }

  if (workflow === 'credit.apply' && shape === 'paid-credit-top-up') {
    return {
      strategy: '<review existing contract commits by name before add_commits because no client-side idempotency key is available>',
      duplicatePrevention: '<retry only after balance and invoice read-back proves no matching paid top-up commit or invoice was created>',
    };
  }
  if (workflow === 'subscription.contract.apply' && shape === 'direct-subscription-contract') {
    return {
      strategy: '<stable contractUniquenessKey plus customer/rate-card/product/current-contract state checks>',
      duplicatePrevention: '<retry create only with the same uniqueness key after contract and invoice read-back proves no matching contract was created>',
    };
  }
  if (workflow === 'custom-contract.create' && shape === 'enterprise-custom-contract') {
    return {
      strategy: '<stable uniquenessKey for contracts/create, customer identity read-back, Stripe billing-provider compare-before-set, and duplicate commit-name checks before any add_commits edit>',
      duplicatePrevention: '<retry contract create only with the same uniquenessKey after customer, contract, balance, invoice, and seat read-back proves the target object or edit was not already created>',
    };
  }
  if (workflow === 'billing-provider.attach' && shape === 'stripe-billing-provider-attachment') {
    return {
      strategy: '<compare active billing-provider configs before attach; use existingConfigPolicy fail_if_exists or reuse_if_matching>',
      duplicatePrevention: '<retry only after customer and billing-provider read-back proves no duplicate active Stripe config was created>',
    };
  }
  if (workflow === 'invoice.issue-date-update' && shape === 'invoice-issue-date-update') {
    return {
      strategy: '<compare invoice status and issue_date before update; only move the same DRAFT invoice from the reviewed currentIssueDate to targetIssueDate>',
      duplicatePrevention: '<retry only after invoice read-back proves the issue_date is not already targetIssueDate and the invoice is still DRAFT>',
    };
  }
  if (workflow === 'product.rate-retirement' && shape === 'product-rate-retirement') {
    return {
      strategy: '<compare current rate schedule before addRates; only close reviewed active product rates at the exact startingAt cutover>',
      duplicatePrevention: '<retry only after rate-schedule read-back proves the entitled:false, price:0 close entry is not already present for the product and rate card>',
    };
  }
  if (workflow === 'rate-card.dimensional.apply' && shape === 'dimensional-rate-card') {
    return {
      strategy: '<compare products by reviewed usage product name, billable metric id, pricing_group_key, presentation_group_key, and rate schedule state before products/create or addRates>',
      duplicatePrevention: '<retry only after product, getRates selector, and rate-schedule read-back prove the product or action_code rate row was not already created>',
    };
  }
  if (workflow === 'package.archive' && shape === 'package-alias-archive-handoff') {
    return {
      strategy: '<compare old package archive state and replacement alias ownership before archive; only archive the reviewed oldPackageId after alias live evidence passes>',
      duplicatePrevention: '<retry only after package get/list read-back proves the old package is not already archived and the replacement alias remains live>',
    };
  }
  if (workflow === 'usage.ingest-preview' && shape === 'usage-ingest-preview') {
    return {
      strategy: '<stable transaction_id per event plus event-search compare-before-retry checks>',
      duplicatePrevention: '<retry only the transaction_id values that event search proves missing; never regenerate transaction IDs for the same usage event>',
    };
  }
  return {
    strategy: '<stable uniqueness key, name dedupe, or transaction id>',
    duplicatePrevention: '<how retry avoids duplicate objects or charges>',
  };
}

function buildPreflightTemplate({ workflow, shape, tenant = '<sandbox|production>' }) {
  if (!isPreflightSupported(workflow, shape)) return null;
  const production = tenant === 'production' || tenant === '<sandbox|production>';
  return {
    schemaVersion: 'metro.preflight.v1',
    workflow,
    shape,
    tenant,
    localOnly: true,
    status: 'template',
    targetSystem: 'metronome',
    identifiers: identifiersFor(workflow, shape),
    preview: {
      command: previewCommandFor(workflow, shape, tenant),
      outputPath: '<path-to-reviewed-preview-json>',
      payloadHash: 'sha256:<reviewed-preview-hash>',
    },
    execution: {
      command: executionCommandFor(workflow, shape, tenant),
      endpoints: endpointPlan(workflow, shape),
      confirmHashRequired: true,
      enabledInCurrentCli: false,
    },
    expectedSideEffects: sideEffectsFor(workflow, shape),
    canaryPlan: {
      required: true,
      plan: '<single-object sandbox or approved canary plan before bulk execution>',
    },
    verificationQueries: verificationQueriesFor(workflow, shape),
    rollbackPlan: rollbackPlanFor(workflow, shape),
    idempotency: idempotencyFor(workflow, shape),
    auditLog: {
      required: true,
      destination: '<jsonl-audit-log-path>',
    },
    approvals: {
      owner: '<billing-ops-owner>',
      productionConfirmation: production ? '<typed-confirmation-or-hash>' : 'not_required_for_sandbox',
    },
    unsupportedUntil: [
      'apply-grade payload builder exists',
      'sandbox proof exists for this exact shape',
      'audit log writer exists',
      'read-back verifier exists',
    ],
  };
}

function finding(id, severity, message, path, remediation) {
  return { id, severity, message, path, remediation };
}

function validateTenantCommand(command, tenant, path, findings) {
  if (!nonEmpty(command) || !['sandbox', 'production'].includes(tenant)) return;
  const text = String(command);
  if (tenant === 'production' && (!/(^|\s)--prod(\s|$)/.test(text) || /(^|\s)--sandbox(\s|$)/.test(text))) {
    findings.push(finding(
      'MTR-TENANT-001',
      'error',
      `${path} must use --prod and must not use --sandbox for production preflight.`,
      path,
      'Regenerate the preflight from a tenant-explicit production preview/apply command.',
    ));
  }
  if (tenant === 'sandbox' && (!/(^|\s)--sandbox(\s|$)/.test(text) || /(^|\s)--prod(\s|$)/.test(text))) {
    findings.push(finding(
      'MTR-TENANT-001',
      'error',
      `${path} must use --sandbox and must not use --prod for sandbox preflight.`,
      path,
      'Regenerate the preflight from sandbox-only preview/apply commands.',
    ));
  }
}

function hasReviewedEndpointSource(sourceIds) {
  return list(sourceIds).some((sourceId) => (
    /^official-[a-z0-9-]+$/.test(String(sourceId))
    || REVIEWED_ENDPOINT_SOURCE_IDS.has(String(sourceId))
  ));
}

function validateEndpointSources(endpoints, path, findings) {
  const items = list(endpoints);
  if (items.length === 0) return;

  items.forEach((endpoint, index) => {
    const sourceIds = list(endpoint?.sourceIds).filter(nonEmpty);
    const endpointPath = `${path}[${index}]`;
    if (sourceIds.length === 0 || !sourceIds.includes('endpoint-matrix')) {
      findings.push(finding(
        'MTR-ENDPOINT-001',
        'error',
        `${endpointPath}.sourceIds must include endpoint-matrix.`,
        `${endpointPath}.sourceIds`,
        'Cite the local endpoint matrix before a future apply preflight can rely on this endpoint.',
      ));
    }
    if (!hasReviewedEndpointSource(sourceIds)) {
      findings.push(finding(
        'MTR-ENDPOINT-002',
        'error',
        `${endpointPath}.sourceIds must include an official doc or reviewed local endpoint source.`,
        `${endpointPath}.sourceIds`,
        'Add an official-* source id or a reviewed local source id such as danger-zone or packages-contracts.',
      ));
    }
  });
}

function validatePreflight(input) {
  const findings = [];

  if (input?.schemaVersion !== 'metro.preflight.v1') {
    findings.push(finding(
      'MTR-PREFLIGHT-001',
      'error',
      'schemaVersion must be metro.preflight.v1.',
      'schemaVersion',
      'Start from metro preflight template and keep schemaVersion unchanged.',
    ));
  }

  if (!isPreflightSupported(input?.workflow, input?.shape)) {
    findings.push(finding(
      'MTR-PREFLIGHT-002',
      'error',
      'workflow and shape are not a supported preflight pair.',
      'workflow',
      'Use metro preflight template with a supported workflow and shape pair.',
    ));
  }

  if (!['sandbox', 'production'].includes(input?.tenant)) {
    findings.push(finding(
      'MTR-TENANT-001',
      'error',
      'tenant must be sandbox or production.',
      'tenant',
      'Set tenant to exactly one target environment.',
    ));
  }

  if (input?.targetSystem !== 'metronome') {
    findings.push(finding(
      'MTR-PREFLIGHT-003',
      'error',
      'targetSystem must be metronome for this CLI preflight.',
      'targetSystem',
      'Set targetSystem to metronome.',
    ));
  }

  if (!list(input?.identifiers).some((item) => nonEmpty(item?.system) && nonEmpty(item?.role) && nonEmpty(item?.id))) {
    findings.push(finding(
      'MTR-PREFLIGHT-004',
      'error',
      'at least one concrete identifier is required.',
      'identifiers',
      'Record relevant customer, contract, package, rate-card, Stripe, HubSpot, or Lev identifiers.',
    ));
  }

  if (!nonEmpty(input?.preview?.outputPath)) {
    findings.push(finding(
      'MTR-PREFLIGHT-005',
      'error',
      'preview.outputPath is required.',
      'preview.outputPath',
      'Point to the reviewed preview JSON used for approval.',
    ));
  }
  validateTenantCommand(input?.preview?.command, input?.tenant, 'preview.command', findings);

  if (!/^sha256:[a-f0-9]{64}$/.test(input?.preview?.payloadHash || '')) {
    findings.push(finding(
      'MTR-TENANT-002',
      'error',
      'preview.payloadHash must be a full sha256:<64 hex> hash.',
      'preview.payloadHash',
      'Use the payloadHash emitted by metro preview.',
    ));
  }

  if (!nonEmpty(input?.execution?.command)) {
    findings.push(finding(
      'MTR-PREFLIGHT-006',
      'error',
      'execution.command is required.',
      'execution.command',
      'Record the exact future apply command or wrapper before approval.',
    ));
  }
  validateTenantCommand(input?.execution?.command, input?.tenant, 'execution.command', findings);

  if (!list(input?.execution?.endpoints).some((endpoint) => nonEmpty(endpoint?.method) && nonEmpty(endpoint?.path))) {
    findings.push(finding(
      'MTR-PREFLIGHT-007',
      'error',
      'execution.endpoints must include at least one method/path.',
      'execution.endpoints',
      'Record exact Metronome endpoint paths from the endpoint matrix.',
    ));
  }
  validateEndpointSources(input?.execution?.endpoints, 'execution.endpoints', findings);

  if (list(input?.expectedSideEffects).length === 0) {
    findings.push(finding(
      'MTR-INV-001',
      'error',
      'expectedSideEffects must describe invoice, Stripe, and customer-impact behavior.',
      'expectedSideEffects',
      'Record expected billing, invoice, Stripe, access, and customer-visible side effects.',
    ));
  }

  if (input?.canaryPlan?.required !== true || !nonEmpty(input?.canaryPlan?.plan)) {
    findings.push(finding(
      'MTR-VERIFY-003',
      'error',
      'canaryPlan.required must be true and canaryPlan.plan must be filled.',
      'canaryPlan',
      'Define a single-object canary or explain why this exact operation is not bulk.',
    ));
  }

  if (!list(input?.verificationQueries).some((query) => nonEmpty(query?.method) && nonEmpty(query?.path) && nonEmpty(query?.expectation))) {
    findings.push(finding(
      'MTR-VERIFY-001',
      'error',
      'verificationQueries must include at least one method/path/expectation.',
      'verificationQueries',
      'Define read-back checks that prove the expected state after apply.',
    ));
  }

  if (!nonEmpty(input?.rollbackPlan)) {
    findings.push(finding(
      'MTR-VERIFY-002',
      'error',
      'rollbackPlan is required.',
      'rollbackPlan',
      'Record rollback or remediation steps before apply is approved.',
    ));
  }

  if (!nonEmpty(input?.idempotency?.strategy) || !nonEmpty(input?.idempotency?.duplicatePrevention)) {
    findings.push(finding(
      'MTR-IDEMP-001',
      'error',
      'idempotency strategy and duplicate prevention are required.',
      'idempotency',
      'Record stable uniqueness keys, names, transaction IDs, or state checks that prevent duplicates.',
    ));
  }

  if (input?.auditLog?.required !== true || !nonEmpty(input?.auditLog?.destination)) {
    findings.push(finding(
      'MTR-PREFLIGHT-008',
      'error',
      'auditLog.required must be true and auditLog.destination must be filled.',
      'auditLog',
      'Record the JSONL audit log destination for the future apply run.',
    ));
  }

  if (input?.tenant === 'production' && !nonEmpty(input?.approvals?.productionConfirmation)) {
    findings.push(finding(
      'MTR-TENANT-002',
      'error',
      'production preflight requires approvals.productionConfirmation.',
      'approvals.productionConfirmation',
      'Record the exact preview hash or typed production confirmation required for apply.',
    ));
  }

  return {
    schemaVersion: 'metro.preflight.validation.v1',
    valid: findings.length === 0,
    findings,
  };
}

module.exports = {
  buildPreflightTemplate,
  validatePreflight,
};
