'use strict';

const { getShape } = require('../shapes');
const { USD_CREDIT_TYPE_ID, validateShapeInput } = require('../validators');
const { canonicalize, canonicalJson, sha256 } = require('../util/canonical-hash');
const { defaultValidationOptions } = require('../workspace/loader');

function resolveCustomerExternalId(input) {
  if (input.externalCustomerId !== undefined && input.externalCustomerId !== null && String(input.externalCustomerId).trim() !== '') {
    return String(input.externalCustomerId).trim();
  }
  return null;
}

function expectedStripeBehavior(stripeBehavior) {
  if (stripeBehavior === 'leave_draft') return 'Stripe invoice should remain draft when the billing provider configuration supports draft behavior.';
  if (stripeBehavior === 'push_to_stripe') return 'Metronome may deliver the invoice to Stripe according to the active billing provider configuration.';
  return 'Stripe behavior is unknown.';
}

function buildCustomerBillingProviderConfiguration(input) {
  if (input.billingProvider.mode !== 'stripe') return null;

  const config = {
    billing_provider: 'stripe',
    configuration: {
      stripe_customer_id: input.billingProvider.stripeCustomerId,
      stripe_collection_method: input.billingProvider.stripeCollectionMethod,
    },
  };

  if (input.billingProvider.deliveryMethodId) {
    config.delivery_method_id = input.billingProvider.deliveryMethodId;
  } else {
    config.delivery_method = input.billingProvider.deliveryMethod;
  }

  return config;
}

function buildCustomerCreatePayload(input) {
  const payload = {
    name: input.companyName,
    ingest_aliases: [...input.ingestAliases],
  };

  if (input.customFields) {
    payload.custom_fields = { ...input.customFields };
  }

  const billingProviderConfig = buildCustomerBillingProviderConfiguration(input);
  if (billingProviderConfig) {
    payload.customer_billing_provider_configurations = [billingProviderConfig];
  }

  return payload;
}

function buildCustomerSetupPreview(input, tenant, validation) {
  const actions = [
    {
      id: 'search-existing-customers-by-ingest-alias',
      type: 'future-read',
      method: 'GET',
      path: '/v1/customers?ingest_alias={alias}&only_archived=false',
      sourceIds: ['endpoint-matrix', 'official-customer-list', 'customers-hierarchies'],
      payloadDraft: {
        ingest_aliases: [...input.ingestAliases],
        existingCustomerPolicy: input.duplicatePrevention.existingCustomerPolicy,
        archivedCustomerCollisionReviewed: input.duplicatePrevention.archivedCustomerCollisionReviewed,
      },
      readiness: 'required-before-apply',
      note: 'Customer list/search is GET with query parameters. Future apply must prove no active or archived alias collision before create.',
    },
    {
      id: 'create-metronome-customer',
      type: 'planned-write',
      method: 'POST',
      path: '/v1/customers',
      sourceIds: ['endpoint-matrix', 'official-customer-create', 'customers-hierarchies'],
      payloadDraft: buildCustomerCreatePayload(input),
      readiness: 'draft-payload-plan',
      note: 'Future apply would create the customer with ingest aliases in one request; ingest aliases are globally unique per tenant.',
    },
  ];

  if (input.salesforceAccountId || input.billingProvider.mode === 'stripe') {
    const updateConfig = {
      customer_id: '<created customer id from create-metronome-customer>',
    };
    if (input.salesforceAccountId) updateConfig.salesforce_account_id = input.salesforceAccountId;
    if (input.billingProvider.mode === 'stripe') {
      updateConfig.leave_stripe_invoices_in_draft = input.billingProvider.leaveStripeInvoicesInDraft;
    }
    actions.push({
      id: 'set-customer-configuration',
      type: 'planned-write',
      method: 'POST',
      path: '/v1/customers/{customer_id}/updateConfig',
      sourceIds: ['endpoint-matrix', 'official-customer-update-config', 'customers-hierarchies', 'metronome-stripe-delivery'],
      payloadDraft: updateConfig,
      readiness: 'draft-payload-plan',
      note: 'Future apply uses updateConfig for first-class customer configuration fields such as salesforce_account_id and leave_stripe_invoices_in_draft.',
    });
  }

  const hashInput = {
    workflow: 'customer.setup',
    shape: 'customer-setup',
    tenant,
    actions,
  };

  const expectedSideEffects = [
    'No API calls are made by this preview.',
    `Future apply would create or reuse-review a Metronome customer for ${input.companyName} with ${input.ingestAliases.length} ingest alias(es).`,
    'Future apply must search customer aliases first because ingest_aliases are globally unique and archived customers can retain aliases.',
    'This preview does not create a contract, package, commit, credit, subscription, invoice, or hierarchy contract.',
  ];

  if (input.billingProvider.mode === 'stripe') {
    expectedSideEffects.push(
      'Future apply would attach inline Stripe billing-provider configuration on customer create.',
      input.billingProvider.leaveStripeInvoicesInDraft
        ? 'Customer configuration should keep Stripe invoices in draft when later invoices are eligible for Stripe delivery.'
        : 'Customer configuration may allow later Metronome invoices to deliver to Stripe according to the selected billing-provider configuration.',
    );
  } else {
    expectedSideEffects.push(`No billing-provider configuration is planned: ${input.billingProvider.nonBillableReason}.`);
  }

  if (input.hierarchyMode !== 'standalone') {
    expectedSideEffects.push('Hierarchy is not written on the customer object; future contract creation must carry hierarchy_configuration and read-back proof.');
  }

  const verificationPlan = [
    {
      id: 'verify-customer-created',
      mode: 'future-read',
      method: 'GET',
      path: '/v1/customers/{customer_id}',
      sourceIds: ['endpoint-matrix', 'official-customer-get', 'customers-hierarchies'],
      expectation: 'Customer read-back shows the expected name, custom fields, archived state, and ingest aliases.',
    },
    {
      id: 'verify-ingest-alias-search',
      mode: 'future-read',
      method: 'GET',
      path: '/v1/customers?ingest_alias={alias}',
      sourceIds: ['endpoint-matrix', 'official-customer-list', 'customers-hierarchies'],
      expectation: 'Every requested ingest alias resolves to the intended customer and no archived alias squatter remains.',
    },
  ];

  if (input.billingProvider.mode === 'stripe') {
    verificationPlan.push(
      {
        id: 'verify-billing-provider-config',
        mode: 'future-read',
        method: 'POST',
        path: '/v1/getCustomerBillingProviderConfigurations',
        sourceIds: ['endpoint-matrix', 'official-billing-provider', 'metronome-stripe-delivery'],
        expectation: 'An active Stripe billing-provider configuration exists with the expected Stripe customer id, collection method, and delivery method.',
      },
      {
        id: 'verify-no-invoice-side-effect',
        mode: 'future-read',
        method: 'GET',
        path: '/v1/customers/{customer_id}/invoices?limit=50',
        sourceIds: ['endpoint-matrix', 'official-invoice-list', 'danger-zone'],
        expectation: 'Customer setup alone created no invoice; later contract workflows must own invoice and Stripe behavior.',
      },
    );
  }

  if (input.hierarchyMode !== 'standalone') {
    verificationPlan.push({
      id: 'verify-hierarchy-deferred-to-contract',
      mode: 'future-read',
      method: 'POST',
      path: '/v2/contracts/get',
      sourceIds: ['endpoint-matrix', 'customers-hierarchies'],
      expectation: 'Future hierarchy contract read-back must verify hierarchy_configuration because the customer object has no parent_customer_id field.',
    });
  }

  return {
    schemaVersion: 'metro.preview.v1',
    workflow: 'customer.setup',
    shape: 'customer-setup',
    tenant,
    payloadHash: sha256(hashInput),
    actions,
    expectedSideEffects,
    verificationPlan,
    warnings: validation.findings.filter((finding) => finding.severity === 'warning'),
    blocked: false,
    applySupported: false,
    applyBlocker: 'Customer setup apply is blocked until duplicate customer state, archived alias collision checks, sandbox proof, audit logs, read-back verification, invoice-side-effect proof, and owner approval exist.',
    sources: getShape('customer-setup').sources,
  };
}

function buildFreeCreditTrialRecurringCommit(input) {
  return {
    access_amount: {
      unit_price: input.creditAmount,
      quantity: 1,
      credit_type_id: input.accessCreditTypeId,
    },
    // commit_duration uses PERIODS (1 period = one recurrence cycle of the package).
    // DAYS is not a valid unit here and triggers a 400 "matched only 1 out of 2" schema error.
    commit_duration: {
      value: 1,
      unit: 'PERIODS',
    },
    rollover_fraction: input.rolloverFraction,
    // starting_at_offset and proration are required for package recurring_commits.
    // Omitting either gives a 400 with no field name in the error message.
    starting_at_offset: {
      value: 0,
      unit: 'DAYS',
    },
    proration: 'NONE',
  };
}

function buildFreeCreditTrialActions(input) {
  return [
    {
      id: 'create-free-credit-trial-package',
      type: 'planned-write',
      method: 'POST',
      path: '/v1/packages/create',
      sourceIds: ['endpoint-matrix', 'official-package-create'],
      payloadDraft: {
        uniqueness_key: input.uniquenessKey,
        // duration.value MUST be a string. Sending an integer triggers a 400
        // "format attribute int32 not supported" from Metronome's schema validator.
        duration: {
          value: String(input.trialDurationDays),
          unit: 'DAYS',
        },
        aliases: [
          {
            name: input.packageAlias,
            starting_at: input.aliasStartingAt,
          },
        ],
        recurring_commits: [buildFreeCreditTrialRecurringCommit(input)],
      },
      readiness: 'draft-payload-plan',
      note: `Creates a ${input.trialDurationDays}-day free trial package with ${input.creditAmount} credits per period, ${input.rolloverFraction * 100}% rollover, no Stripe. Existing alias "${input.packageAlias}" will be auto-ended by Metronome when this alias becomes live at ${input.aliasStartingAt}.`,
    },
    {
      id: 'verify-package-read-back',
      type: 'future-read',
      method: 'POST',
      path: '/v1/packages/get',
      sourceIds: ['endpoint-matrix'],
      payloadDraft: { id: '<new-package-id>' },
      expectation: `duration.value is "${String(input.trialDurationDays)}" (string), aliases[0].name is "${input.packageAlias}", recurring_commits[0].commit_duration.unit is "PERIODS", rollover_fraction is ${input.rolloverFraction}, no billing_provider, no invoice_amount.`,
    },
    {
      id: 'verify-single-live-alias',
      type: 'future-read',
      method: 'POST',
      path: '/v1/packages/list',
      sourceIds: ['endpoint-matrix'],
      expectation: `Exactly one live alias named "${input.packageAlias}" pointing to the new package. All previous aliases for this name should have ending_before set.`,
    },
  ];
}

function buildFreeCreditTrialPreview(input, tenant, validation) {
  const actions = buildFreeCreditTrialActions(input);
  const hashInput = {
    workflow: 'package.create',
    shape: 'free-credit-trial',
    tenant,
    actions,
  };
  return {
    schemaVersion: 'metro.preview.v1',
    workflow: 'package.create',
    shape: 'free-credit-trial',
    tenant,
    payloadHash: sha256(hashInput),
    actions,
    expectedSideEffects: [
      'No API calls are made by this preview.',
      `Apply would create a package with alias "${input.packageAlias}", ${input.trialDurationDays}-day auto-expiry, ${input.creditAmount} credits per period, and ${input.rolloverFraction * 100}% rollover.`,
      'No billing_provider is set and no invoice_amount is present on the commit - no Stripe invoice will be generated.',
      `Metronome will automatically set ending_before on any existing live alias named "${input.packageAlias}" when the new alias becomes live at ${input.aliasStartingAt}.`,
    ],
    warnings: validation.findings.filter((finding) => finding.severity === 'warning'),
    blocked: false,
    applySupported: false,
    applyBlocker: 'Package apply is blocked until sandbox proof, audit logs, alias-handoff review, and production approval exist.',
    sources: getShape('free-credit-trial').sources,
  };
}

function buildProAnnualSelfServeV2RecurringCommit(input) {
  const monthlyDrip = Math.floor(Number(input.annualCreditsTotal) / 12);
  const isMonthlyDrip = input.creditGrantMode === 'monthly-drip';

  return {
    product_id: input.fixedProductId,
    name: input.commitName,
    access_amount: {
      unit_price: isMonthlyDrip ? monthlyDrip : Number(input.annualCreditsTotal),
      quantity: 1,
      credit_type_id: input.accessCreditTypeId,
    },
    invoice_amount: {
      unit_price: 0,
      quantity: 1,
      credit_type_id: USD_CREDIT_TYPE_ID,
    },
    commit_duration: {
      value: isMonthlyDrip ? 12 : 1,
      unit: 'PERIODS',
    },
    rollover_fraction: 1,
    recurrence_frequency: isMonthlyDrip ? 'MONTHLY' : 'ANNUAL',
    applicable_product_tags: ['Origination', 'Deal Prep', 'Finance'],
    priority: 1,
    proration: 'NONE',
  };
}

function buildProAnnualSelfServeV2Actions(input) {
  return [
    {
      id: 'create-annual-self-serve-package-v2',
      type: 'planned-write',
      method: 'POST',
      path: '/v1/packages/create',
      sourceIds: ['endpoint-matrix', 'official-package-create', 'metronome-flows'],
      payloadDraft: {
        package_alias: input.packageAlias,
        uniqueness_key: input.uniquenessKey,
        rate_card_id: input.rateCardId,
        starting_at: input.startingAt,
        terms: {
          billing_frequency: input.billingFrequency,
          annual_price_cents: input.annualPlanFeeCents,
        },
        recurring_commits: [buildProAnnualSelfServeV2RecurringCommit(input)],
      },
      readiness: 'draft-payload-plan',
      note: input.creditGrantMode === 'monthly-drip'
        ? 'Annual plan fee is in terms; credits drip monthly at 1/12 via recurring_commits with zero invoice_amount on the commit.'
        : 'Lump-sum mode grants full annualCreditsTotal once per year - legacy production shape; confirm with finance.',
    },
  ];
}

function buildProAnnualSelfServeV2Preview(input, tenant, validation) {
  const actions = buildProAnnualSelfServeV2Actions(input);
  const hashInput = {
    workflow: 'package.create',
    shape: 'pro-annual-self-serve-v2',
    tenant,
    creditGrantMode: input.creditGrantMode,
    actions,
  };
  return {
    schemaVersion: 'metro.preview.v1',
    workflow: 'package.create',
    shape: 'pro-annual-self-serve-v2',
    tenant,
    creditGrantMode: input.creditGrantMode,
    payloadHash: sha256(hashInput),
    actions,
    expectedSideEffects: [
      'No API calls are made by this preview.',
      'Apply would create a package with annual plan fee terms plus recurring_commits for credits separate from the fee.',
      input.creditGrantMode === 'monthly-drip'
        ? `Monthly drip grants ${Math.floor(Number(input.annualCreditsTotal) / 12)} credits per month for 12 periods.`
        : `Lump-sum grants ${input.annualCreditsTotal} credits once per annual period.`,
    ],
    verificationPlan: [
      {
        id: 'verify-package-v2',
        mode: 'future-read',
        method: 'POST',
        path: '/v1/packages/get',
        sourceIds: ['endpoint-matrix'],
        expectation: 'Package alias, recurring_commits recurrence, and annual terms match preview.',
      },
    ],
    warnings: validation.findings.filter((finding) => finding.severity === 'warning'),
    blocked: false,
    applySupported: false,
    applyBlocker: 'Package apply is blocked until sandbox proof, audit logs, and read-back verification exist.',
    sources: getShape('pro-annual-self-serve-v2').sources,
  };
}

function buildProAnnualActions(input) {
  return [
    {
      id: 'create-package',
      type: 'planned-write',
      method: 'POST',
      path: '/v1/packages/create',
      sourceIds: ['endpoint-matrix', 'official-package-create'],
      payloadDraft: {
        package_alias: input.packageAlias,
        uniqueness_key: input.uniquenessKey,
        rate_card_id: input.rateCardId,
        starting_at: input.startingAt,
        terms: {
          billing_frequency: input.billingFrequency,
          annual_price_cents: input.annualPriceCents,
        },
      },
      readiness: 'draft-payload-plan',
      note: 'The package payload builder is local-only and not apply-ready until sandbox proof exists.',
    },
  ];
}

function buildProAnnualPreview(input, tenant, validation) {
  const actions = buildProAnnualActions(input);
  const hashInput = {
    workflow: 'package.create',
    shape: 'pro-annual',
    tenant,
    actions,
  };
  return {
    schemaVersion: 'metro.preview.v1',
    workflow: 'package.create',
    shape: 'pro-annual',
    tenant,
    payloadHash: sha256(hashInput),
    actions,
    expectedSideEffects: [
      'No API calls are made by this preview.',
      'Apply would create or version a package template, not directly charge a customer by itself.',
      expectedStripeBehavior(input.stripeBehavior),
    ],
    verificationPlan: [
      {
        id: 'verify-package',
        mode: 'future-read',
        method: 'POST',
        path: '/v1/packages/get',
        sourceIds: ['endpoint-matrix'],
        expectation: 'Package alias, uniqueness key, rate card, terms, and starting timestamp match the preview hash.',
      },
      {
        id: 'verify-billing-provider-before-contract',
        mode: 'future-read',
        method: 'POST',
        path: '/v1/getCustomerBillingProviderConfigurations',
        sourceIds: ['endpoint-matrix', 'official-billing-provider'],
        expectation: 'Before any customer contract uses this package, billing provider behavior is explicit.',
      },
    ],
    warnings: validation.findings.filter((finding) => finding.severity === 'warning'),
    blocked: false,
    applySupported: false,
    applyBlocker: 'Package apply is blocked until exact payload builders, sandbox proof, audit logs, and read-back verification exist.',
    sources: getShape('pro-annual').sources,
  };
}

function buildGrantCommit(input) {
  const commit = {
    type: 'PREPAID',
    name: input.name,
    access_schedule: {
      credit_type_id: input.accessCreditTypeId,
      schedule_items: [{
        amount: input.amount,
        starting_at: input.startingAt,
      }],
    },
  };

  if (input.endingBefore) {
    commit.access_schedule.schedule_items[0].ending_before = input.endingBefore;
  }

  if (input.invoiceSchedule) {
    commit.invoice_schedule = {
      credit_type_id: input.invoiceSchedule.creditTypeId || USD_CREDIT_TYPE_ID,
      schedule_items: [{
        timestamp: input.startingAt,
        unit_price: input.invoiceSchedule.unitPriceCents,
        quantity: input.invoiceSchedule.quantity || 1,
      }],
    };
  }

  if (input.customFields) {
    commit.custom_fields = { ...input.customFields };
  }

  return commit;
}

function buildPaidTopUpCommit(input) {
  const commit = {
    product_id: input.productId,
    name: input.name,
    type: 'PREPAID',
    priority: input.priority,
    access_schedule: {
      credit_type_id: input.accessCreditTypeId,
      schedule_items: [{
        amount: input.amount,
        starting_at: input.startingAt,
      }],
    },
    invoice_schedule: {
      credit_type_id: input.invoiceSchedule.creditTypeId || USD_CREDIT_TYPE_ID,
      schedule_items: [{
        timestamp: input.startingAt,
        unit_price: input.invoiceSchedule.unitPriceCents,
        quantity: input.invoiceSchedule.quantity,
      }],
    },
    applicable_product_tags: [...input.applicableProductTags],
    payment_gate_config: {
      payment_gate_type: input.paymentGateType,
    },
  };

  if (input.endingBefore) {
    commit.access_schedule.schedule_items[0].ending_before = input.endingBefore;
  }

  if (input.rolloverFraction !== undefined) {
    commit.rollover_fraction = input.rolloverFraction;
  }

  return commit;
}

function buildComplimentaryCreditPreview(input, tenant, validation) {
  const actions = [
    {
      id: 'edit-contract-add-commit',
      type: 'planned-write',
      method: 'POST',
      path: '/v2/contracts/edit',
      sourceIds: ['endpoint-matrix', 'official-contract-edit', 'danger-zone'],
      payloadDraft: {
        customer_id: input.customerId,
        contract_id: input.contractId,
        add_commits: [buildGrantCommit(input)],
      },
      readiness: 'draft-payload-plan',
      note: input.invoiceSchedule
        ? 'Audit-line variant: invoice_schedule is present and must use fiat.'
        : 'Pure access grant variant: invoice_schedule is omitted to avoid invoice and Stripe artifacts.',
    },
  ];
  const hashInput = {
    workflow: 'credit.grant',
    shape: 'complimentary-credit-grant',
    tenant,
    actions,
  };
  return {
    schemaVersion: 'metro.preview.v1',
    workflow: 'credit.grant',
    shape: 'complimentary-credit-grant',
    tenant,
    payloadHash: sha256(hashInput),
    actions,
    expectedSideEffects: [
      'No API calls are made by this preview.',
      input.invoiceSchedule
        ? 'Apply would add a zero-dollar audit line if Metronome accepts the fiat invoice_schedule.'
        : 'Apply would add access credits without an invoice_schedule and should not create a Stripe artifact.',
    ],
    verificationPlan: [
      {
        id: 'verify-balance',
        mode: 'future-read',
        method: 'POST',
        path: '/v1/contracts/customerBalances/list',
        sourceIds: ['endpoint-matrix'],
        expectation: 'The new commit appears on the target contract balance with the expected amount and access credit type.',
      },
      {
        id: 'verify-invoices',
        mode: 'future-read',
        method: 'GET',
        path: '/v1/customers/{customer_id}/invoices',
        sourceIds: ['endpoint-matrix'],
        expectation: input.invoiceSchedule
          ? 'Confirm the expected zero-dollar invoice artifact and Stripe handling.'
          : 'Confirm no new invoice artifact was created for the pure access grant.',
      },
    ],
    warnings: validation.findings.filter((finding) => finding.severity === 'warning'),
    blocked: false,
    applySupported: false,
    applyBlocker: 'Credit grant apply is blocked until canary support, sandbox proof, audit logs, and read-back verification exist.',
    sources: getShape('complimentary-credit-grant').sources,
  };
}

function buildPaidCreditTopUpPreview(input, tenant, validation) {
  const actions = [
    {
      id: 'edit-contract-add-paid-top-up-commit',
      type: 'planned-write',
      method: 'POST',
      path: '/v2/contracts/edit',
      sourceIds: ['endpoint-matrix', 'official-contract-edit', 'commits-credits', 'metronome-invoicing', 'metronome-stripe-delivery'],
      payloadDraft: {
        customer_id: input.customerId,
        contract_id: input.contractId,
        add_commits: [buildPaidTopUpCommit(input)],
      },
      readiness: 'draft-payload-plan',
      note: 'Paid top-up variant: invoice_schedule is present with USD cents and payment_gate_config keeps the commit gated on Stripe payment.',
    },
  ];
  const hashInput = {
    workflow: 'credit.paid-top-up',
    shape: 'paid-credit-top-up',
    tenant,
    actions,
  };
  return {
    schemaVersion: 'metro.preview.v1',
    workflow: 'credit.paid-top-up',
    shape: 'paid-credit-top-up',
    tenant,
    payloadHash: sha256(hashInput),
    actions,
    expectedSideEffects: [
      'No API calls are made by this preview.',
      `Future apply would add ${input.amount} paid credits to contract ${input.contractId}.`,
      `Future apply would create a paid invoice_schedule line for ${input.invoiceSchedule.unitPriceCents} cents with quantity 1.`,
      'payment_gate_config.payment_gate_type=STRIPE means the top-up commit should remain payment-gated until Stripe collection succeeds.',
      expectedStripeBehavior(input.stripeBehavior),
      input.immediateInvoiceConfirmed === true
        ? 'Immediate invoice behavior is explicitly confirmed for this preview input.'
        : 'Invoice timing is expected to follow the future invoice_schedule timestamp in startingAt.',
    ],
    verificationPlan: [
      {
        id: 'verify-paid-top-up-balance',
        mode: 'future-read',
        method: 'POST',
        path: '/v1/contracts/customerBalances/list',
        sourceIds: ['endpoint-matrix', 'official-customer-balances-list', 'commits-credits'],
        expectation: 'The new paid top-up commit appears once by name on the target contract with expected amount, access credit type, priority, and payment gate state.',
      },
      {
        id: 'verify-paid-top-up-invoice',
        mode: 'future-read',
        method: 'GET',
        path: '/v1/customers/{customer_id}/invoices?limit=N',
        sourceIds: ['endpoint-matrix', 'official-invoice-list', 'metronome-invoicing'],
        expectation: 'Customer invoice inventory shows the expected paid top-up invoice behavior, total cents, status, and external_invoice state.',
      },
      {
        id: 'verify-billing-provider',
        mode: 'future-read',
        method: 'POST',
        path: '/v1/getCustomerBillingProviderConfigurations',
        sourceIds: ['endpoint-matrix', 'official-billing-provider', 'metronome-stripe-delivery'],
        expectation: `Billing-provider read-back supports stripeBehavior=${input.stripeBehavior} before any paid top-up apply.`,
      },
    ],
    warnings: validation.findings.filter((finding) => finding.severity === 'warning'),
    blocked: false,
    applySupported: false,
    applyBlocker: 'Paid top-up apply is blocked until duplicate-name evidence, sandbox proof, audit logs, read-back verification, Stripe reconciliation handling, and owner approval exist.',
    sources: getShape('paid-credit-top-up').sources,
  };
}

function buildPackageAliasArchiveHandoffPreview(input, tenant, validation) {
  const actions = [
    {
      id: 'archive-old-package-version-after-alias-live',
      type: 'planned-write',
      method: 'POST',
      path: '/v1/packages/archive',
      sourceIds: ['endpoint-matrix', 'official-package-archive'],
      payloadDraft: {
        package_id: input.oldPackageId,
      },
      readiness: 'draft-payload-plan',
      note: 'Future apply must only run after package list/get evidence proves the replacement package owns the alias and replacementAliasLiveAt is in the past.',
    },
  ];
  const hashInput = {
    workflow: 'package.archive',
    shape: 'package-alias-archive-handoff',
    tenant,
    actions,
  };
  return {
    schemaVersion: 'metro.preview.v1',
    workflow: 'package.archive',
    shape: 'package-alias-archive-handoff',
    tenant,
    payloadHash: sha256(hashInput),
    actions,
    expectedSideEffects: [
      'No API calls are made by this preview.',
      `Future apply would archive old package ${input.oldPackageId} only after alias ${input.packageAlias} is live on replacement package ${input.replacementPackageId}.`,
      'Existing contracts on the old package are expected to remain attached, but their inventory must be reviewed before archive.',
      'Future package_alias contract creates should resolve to the replacement package, not the archived old package.',
    ],
    verificationPlan: [
      {
        id: 'verify-old-package-archived',
        mode: 'future-read',
        method: 'POST',
        path: '/v1/packages/get',
        sourceIds: ['endpoint-matrix', 'official-package-get'],
        expectation: 'The old package id reports archived state after archive apply.',
      },
      {
        id: 'verify-replacement-alias-live',
        mode: 'future-read',
        method: 'POST',
        path: '/v1/packages/list?limit=100',
        sourceIds: ['endpoint-matrix', 'official-package-list'],
        expectation: 'The requested package alias resolves to the replacement package id, and replacementAliasLiveAt is not in the future.',
      },
      {
        id: 'verify-contracts-on-old-package-inventory',
        mode: 'future-read',
        method: 'POST',
        path: '/v1/packages/listContractsOnPackage',
        sourceIds: ['endpoint-matrix', 'official-contracts-on-package'],
        expectation: 'Contracts attached to the old package were inventoried before archive and remain understood after archive.',
      },
    ],
    warnings: validation.findings.filter((finding) => finding.severity === 'warning'),
    blocked: false,
    applySupported: false,
    applyBlocker: 'Package archive apply is blocked until alias handoff evidence, sandbox proof, audit logs, read-back verification, rollback evidence, and owner approval exist.',
    sources: getShape('package-alias-archive-handoff').sources,
  };
}

function buildStripeBillingProviderPayload(input) {
  const payload = {
    customer_id: input.customerId,
    billing_provider: 'stripe',
    configuration: {
      stripe_customer_id: input.stripeCustomerId,
      stripe_collection_method: input.stripeCollectionMethod,
    },
  };

  if (input.deliveryMethodId) {
    payload.delivery_method_id = input.deliveryMethodId;
  } else {
    payload.delivery_method = input.deliveryMethod;
  }

  return payload;
}

function buildStripeDeliveryEvidence(input) {
  if (input.deliveryMethodScope !== 'multi_entity') {
    if (input.deliveryMethodId) {
      return {
        deliveryMethodScope: input.deliveryMethodScope,
        deliveryMethodId: input.deliveryMethodId,
        endpointFieldsReviewed: true,
        note: 'Single-entity delivery uses the endpoint-specific delivery_method_id field without claiming multi-entity account routing.',
      };
    }
    return {
      deliveryMethodScope: input.deliveryMethodScope,
      endpointFieldsReviewed: input.deliveryMethod === 'direct_to_billing_provider',
      note: 'Single-entity delivery uses the endpoint-specific delivery_method shorthand.',
    };
  }

  return {
    deliveryMethodScope: input.deliveryMethodScope,
    deliveryMethodId: input.multiEntityDelivery.deliveryMethodId,
    targetStripeAccountId: input.multiEntityDelivery.targetStripeAccountId,
    accountBillingProviderReviewed: input.multiEntityDelivery.accountBillingProviderReviewed,
    endpointFieldsReviewed: input.multiEntityDelivery.endpointFieldsReviewed,
    note: 'Multi-entity delivery uses the endpoint-specific delivery_method_id field and reviewed account-level billing-provider evidence.',
  };
}

function buildStripeBillingProviderPreview(input, tenant, validation) {
  const actions = [
    {
      id: 'set-stripe-billing-provider-configuration',
      type: 'planned-write',
      method: 'POST',
      path: '/v1/setCustomerBillingProviderConfigurations',
      sourceIds: ['endpoint-matrix', 'official-billing-provider'],
      payloadDraft: {
        data: [buildStripeBillingProviderPayload(input)],
      },
      readiness: 'draft-payload-plan',
      note: 'The payload is local-only and must be preceded by billing-provider inspect output before apply exists.',
      deliveryEvidence: buildStripeDeliveryEvidence(input),
    },
    {
      id: 'set-stripe-draft-behavior',
      type: 'planned-write',
      method: 'POST',
      path: '/v1/customers/{customer_id}/updateConfig',
      sourceIds: ['endpoint-matrix', 'official-customer-update-config'],
      payloadDraft: {
        customer_id: input.customerId,
        leave_stripe_invoices_in_draft: input.leaveStripeInvoicesInDraft,
      },
      readiness: 'draft-payload-plan',
      note: input.leaveStripeInvoicesInDraft
        ? 'Draft behavior is explicit: Stripe invoices should remain draft when supported by customer configuration.'
        : 'Draft behavior is explicit: invoice delivery may push to Stripe according to the active billing provider configuration.',
    },
  ];
  const hashInput = {
    workflow: 'billing-provider.attach',
    shape: 'stripe-billing-provider-attachment',
    tenant,
    actions,
  };
  return {
    schemaVersion: 'metro.preview.v1',
    workflow: 'billing-provider.attach',
    shape: 'stripe-billing-provider-attachment',
    tenant,
    payloadHash: sha256(hashInput),
    actions,
    expectedSideEffects: [
      'No API calls are made by this preview.',
      'Apply would attach or reuse Stripe billing provider configuration for the target Metronome customer.',
      input.leaveStripeInvoicesInDraft
        ? 'Customer configuration should keep Stripe invoices in draft when Metronome delivery supports it.'
        : 'Customer configuration may allow Metronome invoices to deliver to Stripe according to the selected billing provider configuration.',
      input.deliveryMethodScope === 'multi_entity'
        ? `Multi-entity Stripe delivery is pinned to delivery method ${input.deliveryMethodId} for Stripe account ${input.multiEntityDelivery.targetStripeAccountId}.`
        : 'Single-entity Stripe delivery uses the direct_to_billing_provider endpoint shorthand.',
      `Existing config policy: ${input.existingConfigPolicy}.`,
    ],
    verificationPlan: [
      {
        id: 'verify-customer',
        mode: 'future-read',
        method: 'GET',
        path: '/v1/customers/{customer_id}',
        sourceIds: ['endpoint-matrix'],
        expectation: 'The customer id matches the requested Metronome customer and leave_stripe_invoices_in_draft matches the preview.',
      },
      {
        id: 'verify-billing-provider-config',
        mode: 'future-read',
        method: 'POST',
        path: '/v1/getCustomerBillingProviderConfigurations',
        sourceIds: ['endpoint-matrix', 'official-billing-provider'],
        expectation: input.deliveryMethodScope === 'multi_entity'
          ? 'An active Stripe billing provider configuration exists with the expected Stripe customer id, delivery_method_id, and target Stripe account evidence.'
          : 'An active Stripe billing provider configuration exists with the expected Stripe customer id and direct_to_billing_provider delivery method.',
      },
    ],
    warnings: validation.findings.filter((finding) => finding.severity === 'warning'),
    blocked: false,
    applySupported: false,
    applyBlocker: 'Billing-provider apply is blocked until inspected current state, sandbox proof, audit logs, and read-back verification exist.',
    sources: getShape('stripe-billing-provider-attachment').sources,
  };
}

function buildPackagePlanMovePreview(input, tenant, validation, shapeId = 'package-plan-move-no-immediate-invoice') {
  const immediate = shapeId === 'package-plan-move-immediate-invoice';
  const actions = [
    {
      id: 'update-predecessor-end-date',
      type: 'planned-write',
      method: 'POST',
      path: '/v1/contracts/updateEndDate',
      sourceIds: ['endpoint-matrix', 'packages-contracts', 'official-contract-update-end-date', 'danger-zone'],
      payloadDraft: {
        customer_id: input.customerId,
        contract_id: input.currentContractId,
        ending_before: input.cutoverAt,
        allow_ending_before_finalized_invoice: false,
      },
      readiness: 'draft-payload-plan',
      note: 'Future apply must validate the successor payload and current invoice inventory before this predecessor mutation runs.',
    },
    {
      id: 'create-successor-package-contract',
      type: 'planned-write',
      method: 'POST',
      path: '/v1/contracts/create',
      sourceIds: ['endpoint-matrix', 'packages-contracts', 'official-contract-create'],
      payloadDraft: {
        customer_id: input.customerId,
        starting_at: input.cutoverAt,
        package_alias: input.targetPackageAlias,
        uniqueness_key: input.contractUniquenessKey,
        transition: {
          type: input.transitionType,
          from_contract_id: input.currentContractId,
        },
      },
      readiness: 'draft-payload-plan',
      note: 'Package alias resolves at successor starting_at. Package-contract payload remains restricted to package contract fields.',
    },
  ];
  const hashInput = {
    workflow: 'contract.move-plan',
    shape: shapeId,
    tenant,
    actions,
  };
  const expectedSideEffects = immediate
    ? [
      'No API calls are made by this preview.',
      'Future apply would end the predecessor at cutover with allow_ending_before_finalized_invoice=false.',
      'Future apply would create a successor package contract with transition.type=RENEWAL from the predecessor.',
      `Immediate SCHEDULED plan fee is expected because cutoverAt is current or past hour and invoiceBehavior is immediate_plan_fee_expected.`,
      `Paid-period overlap policy: ${input.paidPeriodOverlapPolicy}.`,
      'Stripe billing-provider configuration is preserved; this preview does not attach, archive, or replace billing-provider configuration.',
    ]
    : [
      'No API calls are made by this preview.',
      'Future apply would end the predecessor at the future cutover with allow_ending_before_finalized_invoice=false.',
      'Future apply would create a successor package contract with transition.type=RENEWAL from the predecessor.',
      'No immediate invoice is expected only because cutoverAt is future-dated, no scheduled charges are added, and current invoice inventory has been checked.',
      'Stripe billing-provider configuration is preserved; this preview does not attach, archive, or replace billing-provider configuration.',
    ];
  return {
    schemaVersion: 'metro.preview.v1',
    workflow: 'contract.move-plan',
    shape: shapeId,
    tenant,
    payloadHash: sha256(hashInput),
    actions,
    expectedSideEffects,
    verificationPlan: [
      {
        id: 'verify-predecessor-end-date',
        mode: 'future-read',
        method: 'POST',
        path: '/v2/contracts/get',
        sourceIds: ['endpoint-matrix'],
        expectation: 'The predecessor contract ending_before equals cutoverAt and finalized invoice checks did not require allow_ending_before_finalized_invoice=true.',
      },
      {
        id: 'verify-successor-transition',
        mode: 'future-read',
        method: 'POST',
        path: '/v2/contracts/list',
        sourceIds: ['endpoint-matrix', 'packages-contracts'],
        expectation: immediate
          ? 'Successor contract starts at cutover, uses the target package alias, has a transition from the predecessor, and issues the expected immediate plan fee.'
          : 'A successor contract starts at cutoverAt, uses the target package alias, and has a transition from the predecessor contract.',
      },
      {
        id: 'verify-invoice-inventory',
        mode: 'future-read',
        method: 'GET',
        path: '/v1/customers/{customer_id}/invoices',
        sourceIds: ['endpoint-matrix', 'danger-zone'],
        expectation: 'No surprise draft or finalized invoice appears before cutover, and old-plan future invoices are understood.',
      },
      {
        id: 'verify-billing-provider-continuity',
        mode: 'future-read',
        method: 'POST',
        path: '/v1/getCustomerBillingProviderConfigurations',
        sourceIds: ['endpoint-matrix', 'official-billing-provider'],
        expectation: 'The active Stripe billing-provider configuration remains present and unchanged for the customer.',
      },
    ],
    warnings: validation.findings.filter((finding) => finding.severity === 'warning'),
    blocked: false,
    applySupported: true,
    applyBlocker: null,
    applyCommand: 'metro contract move-plan apply --file <move.json> (--sandbox|--prod) --confirm-hash <hash>',
    sources: getShape(shapeId).sources,
  };
}

function expectedInvoiceIssueDateStripeBehavior(stripeBehavior) {
  if (stripeBehavior === 'defer_until_new_issue_date') {
    return 'Stripe delivery is expected to be deferred until the draft invoice reaches the new issue date and Metronome finalization/delivery rules run.';
  }
  if (stripeBehavior === 'remain_draft_for_manual_review') {
    return 'Stripe invoice handling is expected to remain in draft or manual-review posture according to the active customer billing-provider configuration.';
  }
  if (stripeBehavior === 'no_stripe_delivery_expected') {
    return 'No Stripe delivery is expected, and billing-provider read-back must prove why this invoice should not reach Stripe.';
  }
  return 'Stripe behavior is unknown.';
}

function buildInvoiceIssueDateUpdatePreview(input, tenant, validation) {
  const actions = [
    {
      id: 'update-draft-invoice-issue-date',
      type: 'planned-write',
      method: 'POST',
      path: '/v1/contracts/updateInvoiceIssueDate',
      sourceIds: ['endpoint-matrix', 'official-invoice-issue-date', 'metronome-invoicing'],
      payloadDraft: {
        invoice_id: input.invoiceId,
        issue_date: input.targetIssueDate,
      },
      readiness: 'draft-payload-plan',
      note: 'The endpoint is contract-scoped even though the payload targets an invoice id. Future apply must prove the invoice is DRAFT and the target date is before the contract end.',
    },
  ];
  const hashInput = {
    workflow: 'invoice.issue-date-update',
    shape: 'invoice-issue-date-update',
    tenant,
    actions,
  };
  return {
    schemaVersion: 'metro.preview.v1',
    workflow: 'invoice.issue-date-update',
    shape: 'invoice-issue-date-update',
    tenant,
    payloadHash: sha256(hashInput),
    actions,
    expectedSideEffects: [
      'No API calls are made by this preview.',
      `Future apply would move draft invoice ${input.invoiceId} from ${input.currentIssueDate} to ${input.targetIssueDate}.`,
      'Future apply does not manually finalize the invoice and does not use an invoices/updateIssueDate endpoint.',
      expectedInvoiceIssueDateStripeBehavior(input.stripeBehavior),
    ],
    verificationPlan: [
      {
        id: 'verify-invoice-issue-date',
        mode: 'future-read',
        method: 'POST',
        path: '/v1/invoices/get',
        sourceIds: ['endpoint-matrix', 'official-invoice-get', 'metronome-invoicing'],
        expectation: 'The invoice remains DRAFT and issue_date equals targetIssueDate after the update.',
      },
      {
        id: 'verify-customer-draft-invoices',
        mode: 'future-read',
        method: 'GET',
        path: '/v1/customers/{customer_id}/invoices?limit=N&status=DRAFT',
        sourceIds: ['endpoint-matrix', 'official-invoice-list', 'metronome-invoicing'],
        expectation: 'The target invoice appears in the customer draft invoice inventory with no unexpected finalized or duplicate invoice side effects.',
      },
      {
        id: 'verify-contract-end-boundary',
        mode: 'future-read',
        method: 'POST',
        path: '/v2/contracts/get',
        sourceIds: ['endpoint-matrix', 'official-contract-get', 'official-invoice-issue-date'],
        expectation: input.contractHasNoEndDate === true
          ? 'Contract read-back confirms there is no end date that the issue date could exceed.'
          : 'Contract read-back confirms the target issue date is before the contract ending_before timestamp.',
      },
      {
        id: 'verify-stripe-behavior',
        mode: 'future-read',
        method: 'POST',
        path: '/v1/getCustomerBillingProviderConfigurations',
        sourceIds: ['endpoint-matrix', 'official-billing-provider', 'metronome-stripe-delivery'],
        expectation: `Billing-provider read-back supports declared stripeBehavior=${input.stripeBehavior}.`,
      },
    ],
    warnings: validation.findings.filter((finding) => finding.severity === 'warning'),
    blocked: false,
    applySupported: false,
    applyBlocker: 'Invoice issue-date apply is blocked until draft invoice state, contract end evidence, Stripe behavior, sandbox proof, audit logs, read-back verification, remediation evidence, and owner approval exist.',
    sources: getShape('invoice-issue-date-update').sources,
  };
}

function buildDirectSubscription(input) {
  const subscription = {
    subscription_rate: {
      billing_frequency: input.subscriptionBillingFrequency,
      product_id: input.productId,
    },
    collection_schedule: input.collectionSchedule,
    proration: {
      invoice_behavior: input.proration.invoiceBehavior,
      is_prorated: input.proration.isProrated,
    },
    name: input.name,
    quantity_management_mode: input.quantityManagementMode,
    starting_at: input.startingAt,
  };

  if (input.quantityManagementMode === 'QUANTITY_ONLY') {
    subscription.initial_quantity = input.initialQuantity;
  }

  if (input.quantityManagementMode === 'SEAT_BASED') {
    subscription.seat_config = {
      seat_group_key: input.seatConfig.seatGroupKey,
      initial_seat_ids: [...input.seatConfig.initialSeatIds],
    };
  }

  return subscription;
}

function buildDirectSubscriptionContractPreview(input, tenant, validation) {
  const payloadDraft = {
    customer_id: input.customerId,
    rate_card_id: input.rateCardId,
    starting_at: input.startingAt,
    uniqueness_key: input.contractUniquenessKey,
    usage_statement_schedule: {
      frequency: input.usageStatementFrequency || 'MONTHLY',
    },
    scheduled_charges_on_usage_invoices: input.scheduledChargesOnUsageInvoices || 'ALL',
    subscriptions: [buildDirectSubscription(input)],
  };

  if (input.endingBefore) {
    payloadDraft.ending_before = input.endingBefore;
  }

  const actions = [
    {
      id: 'create-direct-subscription-contract',
      type: 'planned-write',
      method: 'POST',
      path: '/v1/contracts/create',
      sourceIds: ['endpoint-matrix', 'official-contract-create', 'subscriptions-seats', 'packages-contracts'],
      payloadDraft,
      readiness: 'draft-payload-plan',
      note: 'Future apply must prove the rate-card has a matching SubscriptionProductListItem rate for product_id and billing_frequency before creating the contract.',
    },
  ];
  const hashInput = {
    workflow: 'subscription.contract.create',
    shape: 'direct-subscription-contract',
    tenant,
    actions,
  };
  return {
    schemaVersion: 'metro.preview.v1',
    workflow: 'subscription.contract.create',
    shape: 'direct-subscription-contract',
    tenant,
    payloadHash: sha256(hashInput),
    actions,
    expectedSideEffects: [
      'No API calls are made by this preview.',
      `Future apply would create a direct contract for customer ${input.customerId} with one ${input.quantityManagementMode} subscription line.`,
      `Subscription rate identity is product_id=${input.productId} and billing_frequency=${input.subscriptionBillingFrequency}.`,
      input.quantityManagementMode === 'SEAT_BASED'
        ? `Initial named seats would be assigned from seat_config.initial_seat_ids (${input.seatConfig.initialSeatIds.length} seat(s)).`
        : `Initial quantity would be ${input.initialQuantity}.`,
      expectedStripeBehavior(input.stripeBehavior),
    ],
    verificationPlan: [
      {
        id: 'verify-contract-subscription',
        mode: 'future-read',
        method: 'POST',
        path: '/v2/contracts/get',
        sourceIds: ['endpoint-matrix', 'official-contract-get-v2', 'subscriptions-seats'],
        expectation: 'Contract read-back shows the subscription id, subscription_rate product id, billing frequency, quantity management mode, and starting timestamp from the preview.',
      },
      {
        id: 'verify-rate-schedule-subscription-rate',
        mode: 'future-read',
        method: 'POST',
        path: '/v1/contract-pricing/rate-cards/getRateSchedule',
        sourceIds: ['endpoint-matrix', 'official-rate-card-get-rate-schedule', 'pricing-catalog'],
        expectation: 'The rate schedule contains a SubscriptionProductListItem rate for the same product id and billing frequency.',
      },
      {
        id: 'verify-subscription-quantity-history',
        mode: 'future-read',
        method: 'POST',
        path: '/v1/contracts/getSubscriptionQuantityHistory',
        sourceIds: ['endpoint-matrix', 'official-subscription-quantity-history', 'subscriptions-seats'],
        expectation: 'Quantity history shows the initial quantity or named-seat-derived quantity for the created subscription.',
      },
      {
        id: 'verify-subscription-seat-history',
        mode: input.quantityManagementMode === 'SEAT_BASED' ? 'future-read' : 'not-applicable',
        method: 'POST',
        path: '/v1/contracts/getSubscriptionSeatsHistory',
        sourceIds: ['endpoint-matrix', 'official-subscription-seats-history', 'subscriptions-seats'],
        expectation: input.quantityManagementMode === 'SEAT_BASED'
          ? 'Seat history shows the initial named seats assigned inside seat_config.'
          : 'Seat history is not required for QUANTITY_ONLY subscriptions.',
      },
      {
        id: 'verify-billing-provider',
        mode: 'future-read',
        method: 'POST',
        path: '/v1/getCustomerBillingProviderConfigurations',
        sourceIds: ['endpoint-matrix', 'official-billing-provider', 'metronome-stripe-delivery'],
        expectation: `Billing-provider read-back supports stripeBehavior=${input.stripeBehavior}.`,
      },
    ],
    warnings: validation.findings.filter((finding) => finding.severity === 'warning'),
    blocked: false,
    applySupported: false,
    applyBlocker: 'Direct subscription contract apply is blocked until rate-card subscription-rate evidence, sandbox proof, audit logs, read-back verification, rollback evidence, and owner approval exist.',
    sources: getShape('direct-subscription-contract').sources,
  };
}

const NO_EXPIRY_ENDING_BEFORE = '2126-04-22T21:00:00.000Z';

function customContractCustomerId(input) {
  return input.metronomeCustomerId || '__METRONOME_CUSTOMER_ID__';
}

function customContractContractId() {
  return '__METRONOME_CONTRACT_ID__';
}

function customContractSubscriptionId() {
  return '__METRONOME_SUBSCRIPTION_ID__';
}

function buildCustomContractCustomerPayload(input) {
  const externalId = resolveCustomerExternalId(input);
  const customFields = {
    customer_type: 'enterprise',
  };
  if (input.externalCustomerId) {
    customFields.external_customer_id = input.externalCustomerId;
  }

  return {
    name: input.companyName,
    ingest_aliases: externalId ? [externalId] : [],
    custom_fields: customFields,
  };
}

function buildCustomContractStripePayload(input) {
  return {
    data: [{
      customer_id: customContractCustomerId(input),
      billing_provider: 'stripe',
      delivery_method_id: input.stripeDeliveryMethodId,
      configuration: {
        stripe_customer_id: input.stripeCustomerId,
        stripe_collection_method: input.stripeCollectionMethod,
        leave_stripe_invoices_in_draft: input.leaveStripeInvoicesInDraft,
      },
    }],
  };
}

function customContractCommitDuration(cadence) {
  if (cadence === 'annual') return { value: 100, unit: 'PERIODS' };
  return { value: 1200, unit: 'PERIODS' };
}

function buildCustomContractRecurringCommit(commit, startingAt, endingBefore) {
  return {
    product_id: commit.productId,
    name: commit.name,
    access_amount: {
      unit_price: commit.accessAmount,
      quantity: 1,
      credit_type_id: commit.accessCreditTypeId,
    },
    invoice_amount: {
      unit_price: commit.invoiceAmountCents,
      quantity: 1,
      credit_type_id: commit.invoiceCreditTypeId || USD_CREDIT_TYPE_ID,
    },
    commit_duration: customContractCommitDuration(commit.cadence),
    rollover_fraction: commit.rolloverFraction ?? 1,
    recurrence_frequency: commit.cadence === 'annual' ? 'ANNUAL' : 'MONTHLY',
    applicable_product_tags: [...commit.applicableProductTags],
    priority: commit.priority ?? 1,
    starting_at: startingAt,
    ending_before: endingBefore,
    proration: 'NONE',
    starting_at_offset: { value: 0, unit: 'DAYS' },
  };
}

function buildCustomContractBonusCommit(commit, startingAt, endingBefore) {
  return {
    product_id: commit.productId,
    type: 'PREPAID',
    name: commit.name,
    priority: commit.priority ?? 1,
    rollover_fraction: commit.rolloverFraction ?? 1,
    applicable_product_tags: [...commit.applicableProductTags],
    access_schedule: {
      credit_type_id: commit.accessCreditTypeId,
      schedule_items: [{
        amount: commit.accessAmount,
        starting_at: startingAt,
        ending_before: endingBefore,
      }],
    },
    invoice_schedule: {
      credit_type_id: commit.invoiceCreditTypeId || USD_CREDIT_TYPE_ID,
      schedule_items: [{
        timestamp: startingAt,
        unit_price: commit.invoiceAmountCents,
        quantity: 1,
      }],
    },
  };
}

function buildCustomContractSeatSubscription(input, startingAt) {
  const seatLimits = input.seatLimits;
  const billingFrequency = seatLimits.subscriptionBillingFrequency || 'MONTHLY';
  return {
    subscription_rate: {
      billing_frequency: billingFrequency,
      product_id: seatLimits.seatProductId,
    },
    collection_schedule: 'ADVANCE',
    proration: { invoice_behavior: 'BILL_IMMEDIATELY', is_prorated: true },
    name: seatLimits.subscriptionName || 'Platform Seats',
    quantity_management_mode: 'SEAT_BASED',
    seat_config: {
      seat_group_key: seatLimits.seatGroupKey,
    },
    starting_at: startingAt,
  };
}

function buildCustomContractSeatOverride(input, startingAt) {
  const seatLimits = input.seatLimits;
  return {
    starting_at: startingAt,
    override_specifiers: [{
      product_id: seatLimits.seatProductId,
      billing_frequency: seatLimits.subscriptionBillingFrequency || 'MONTHLY',
    }],
    entitled: true,
  };
}

function buildCustomContractSeatUpdates(input, startingAt) {
  return {
    customer_id: customContractCustomerId(input),
    contract_id: customContractContractId(),
    update_subscriptions: [{
      subscription_id: customContractSubscriptionId(),
      seat_updates: {
        add: input.seatLimits.initialSeatIds.map((seat_id) => ({
          seat_id,
          starting_at: startingAt,
        })),
      },
    }],
  };
}

function buildCustomContractCreatePayload(input, startingAt, endingBefore) {
  const payload = {
    customer_id: customContractCustomerId(input),
    starting_at: startingAt,
    ending_before: endingBefore,
    rate_card_id: input.rateCardId,
    uniqueness_key: input.uniquenessKey,
    usage_statement_schedule: { frequency: input.usageStatementFrequency || 'MONTHLY' },
    scheduled_charges_on_usage_invoices: input.scheduledChargesOnUsageInvoices || 'ALL',
    recurring_commits: [buildCustomContractRecurringCommit(input.baseCommit, startingAt, endingBefore)],
  };

  if (input.netPaymentTermsDays !== undefined) {
    payload.net_payment_terms_days = input.netPaymentTermsDays;
  }

  if (input.seatLimitMode === 'seat_based') {
    payload.subscriptions = [buildCustomContractSeatSubscription(input, startingAt)];
    payload.overrides = [buildCustomContractSeatOverride(input, startingAt)];
  }

  return payload;
}

function buildEnterpriseCustomContractPreview(input, tenant, validation) {
  const startingAt = input.explicitStartingAt;
  const endingBefore = input.noExpiry === true ? NO_EXPIRY_ENDING_BEFORE : input.endingBefore;
  const actions = [];

  if (input.createMetronomeCustomer === true || !input.metronomeCustomerId) {
    actions.push({
      id: 'create-metronome-customer',
      type: 'planned-write',
      method: 'POST',
      path: '/v1/customers',
      sourceIds: ['endpoint-matrix', 'official-customer-create', 'custom-contract-payloads'],
      payloadDraft: buildCustomContractCustomerPayload(input),
      readiness: 'draft-payload-plan',
      note: 'Future apply must read back or create exactly one customer for the external account id before contract creation.',
    });
  }

  actions.push({
    id: 'set-stripe-billing-provider-configuration',
    type: 'planned-write',
    method: 'POST',
    path: '/v1/setCustomerBillingProviderConfigurations',
    sourceIds: ['endpoint-matrix', 'official-billing-provider', 'custom-contract-payloads', 'metronome-stripe-delivery'],
    payloadDraft: buildCustomContractStripePayload(input),
    readiness: 'draft-payload-plan',
    note: 'The local CLI requires stripeDeliveryMethodId in the input and does not load delivery method IDs from .env.',
  });

  actions.push({
    id: 'create-direct-enterprise-custom-contract',
    type: 'planned-write',
    method: 'POST',
    path: '/v1/contracts/create',
    sourceIds: ['endpoint-matrix', 'official-contract-create', 'custom-contract-payloads'],
    payloadDraft: buildCustomContractCreatePayload(input, startingAt, endingBefore),
    readiness: 'draft-payload-plan',
    note: 'Direct custom-contract create uses recurring_commits and optional seat subscription wiring. Package aliases are intentionally outside this local shape.',
  });

  if (Array.isArray(input.bonusCommits) && input.bonusCommits.length > 0) {
    actions.push({
      id: 'edit-contract-add-bonus-commits',
      type: 'planned-write',
      method: 'POST',
      path: '/v2/contracts/edit',
      sourceIds: ['endpoint-matrix', 'official-contract-edit', 'custom-contract-payloads', 'danger-zone'],
      payloadDraft: {
        customer_id: customContractCustomerId(input),
        contract_id: customContractContractId(),
        add_commits: input.bonusCommits.map((commit) => buildCustomContractBonusCommit(commit, startingAt, endingBefore)),
      },
      readiness: 'blocked-pending-contract-create-readback',
      note: 'Future apply must prove duplicate commit names were checked because add_commits has no client-side idempotency key.',
    });
  }

  if (input.seatLimitMode === 'seat_based') {
    actions.push({
      id: 'edit-contract-add-initial-seat-assignments',
      type: 'planned-write',
      method: 'POST',
      path: '/v2/contracts/edit',
      sourceIds: ['endpoint-matrix', 'official-contract-edit', 'custom-contract-payloads', 'metronome-subscriptions-seats'],
      payloadDraft: buildCustomContractSeatUpdates(input, startingAt),
      readiness: 'blocked-pending-seat-subscription-readback',
      note: 'Future apply must hydrate the created contract and subscription ids before adding initial seat assignments.',
    });
  }

  const hashInput = {
    workflow: 'custom-contract.create',
    shape: 'enterprise-custom-contract',
    tenant,
    actions,
  };

  const verificationPlan = [
    {
      id: 'verify-customer-identity',
      mode: 'future-read',
      method: 'GET',
      path: '/v1/customers/{customer_id}',
      sourceIds: ['endpoint-matrix', 'official-customer-get'],
      expectation: 'Customer read-back matches externalCustomerId, companyName, ingest aliases, and billing context before or after future apply.',
    },
    {
      id: 'verify-billing-provider-config',
      mode: 'future-read',
      method: 'POST',
      path: '/v1/getCustomerBillingProviderConfigurations',
      sourceIds: ['endpoint-matrix', 'official-billing-provider', 'metronome-stripe-delivery'],
      expectation: `Stripe billing-provider read-back shows delivery method ${input.stripeDeliveryMethodId}, Stripe customer ${input.stripeCustomerId}, and leave_stripe_invoices_in_draft=${input.leaveStripeInvoicesInDraft}.`,
    },
    {
      id: 'verify-custom-contract',
      mode: 'future-read',
      method: 'POST',
      path: '/v2/contracts/get',
      sourceIds: ['endpoint-matrix', 'official-contract-get-v2', 'custom-contract-payloads'],
      expectation: 'Contract read-back shows the direct rate card, uniqueness key, recurring commit, start/end timestamps, and optional seat subscription from the preview.',
    },
    {
      id: 'verify-custom-contract-balances',
      mode: 'future-read',
      method: 'POST',
      path: '/v1/contracts/customerBalances/list',
      sourceIds: ['endpoint-matrix', 'official-customer-balances-list'],
      expectation: 'Customer balances show recurring and bonus commit access amounts exactly once with expected product and credit type IDs.',
    },
    {
      id: 'verify-custom-contract-invoices',
      mode: 'future-read',
      method: 'GET',
      path: '/v1/customers/{customer_id}/invoices?limit=N',
      sourceIds: ['endpoint-matrix', 'official-invoice-list', 'metronome-invoicing'],
      expectation: 'Invoice inventory shows expected scheduled or usage invoice behavior and no unreviewed Stripe delivery side effects.',
    },
  ];

  if (input.seatLimitMode === 'seat_based') {
    verificationPlan.push(
      {
        id: 'verify-custom-contract-seat-quantity-history',
        mode: 'future-read',
        method: 'POST',
        path: '/v1/contracts/getSubscriptionQuantityHistory',
        sourceIds: ['endpoint-matrix', 'official-subscription-quantity-history', 'metronome-subscriptions-seats'],
        expectation: 'Subscription quantity history reflects the initial seat assignments planned in the preview.',
      },
      {
        id: 'verify-custom-contract-seat-history',
        mode: 'future-read',
        method: 'POST',
        path: '/v1/contracts/getSubscriptionSeatsHistory',
        sourceIds: ['endpoint-matrix', 'official-subscription-seats-history', 'metronome-subscriptions-seats'],
        expectation: 'Seat history shows each initial seat id added to the created seat subscription.',
      },
    );
  }

  return {
    schemaVersion: 'metro.preview.v1',
    workflow: 'custom-contract.create',
    shape: 'enterprise-custom-contract',
    tenant,
    payloadHash: sha256(hashInput),
    actions,
    expectedSideEffects: [
      'No API calls are made by this preview.',
      input.createMetronomeCustomer === true || !input.metronomeCustomerId
        ? `Future apply would create a Metronome customer for external id ${resolveCustomerExternalId(input)} before contract creation.`
        : `Future apply would use existing Metronome customer ${input.metronomeCustomerId}.`,
      `Future apply would attach Stripe customer ${input.stripeCustomerId} with delivery method ${input.stripeDeliveryMethodId}.`,
      `Future apply would create a direct enterprise contract on rate card ${input.rateCardId} with one ${input.baseCommit.cadence} recurring commit.`,
      Array.isArray(input.bonusCommits) && input.bonusCommits.length > 0
        ? `Future apply would add ${input.bonusCommits.length} bonus commit(s) after contract creation.`
        : 'No bonus commit edit is planned.',
      input.seatLimitMode === 'seat_based'
        ? `Future apply would create a seat-based subscription and add ${input.seatLimits.initialSeatIds.length} initial seat assignment(s).`
        : 'No seat subscription or seat assignment edit is planned.',
      expectedStripeBehavior(input.stripeBehavior),
    ],
    verificationPlan,
    warnings: validation.findings.filter((finding) => finding.severity === 'warning'),
    blocked: false,
    applySupported: false,
    applyBlocker: 'Custom-contract apply is blocked until inspected current state, sandbox proof, audit logs, production hash confirmation, read-back verification, rollback evidence, and owner approval exist.',
    sources: getShape('enterprise-custom-contract').sources,
  };
}

function buildUsageIngestPreview(input, tenant, validation) {
  const canaryCount = input.canaryPlan.canaryEventCount;
  const canaryEvents = input.events.slice(0, canaryCount);
  const remainingEvents = input.events.slice(canaryCount);
  const actions = [
    {
      id: 'preview-usage-events-before-ingest',
      type: 'planned-live-preview',
      method: 'POST',
      path: '/v1/customers/{customer_id}/previewEvents',
      sourceIds: ['endpoint-matrix', 'official-invoice-preview-events', 'metronome-invoicing'],
      payloadDraft: {
        customer_id: input.customerId,
        events: input.events,
        mode: input.previewMode || 'merge',
        skip_zero_qty_line_items: input.skipZeroQtyLineItems !== false,
      },
      readiness: 'blocked-until-live-preview-authorized',
      note: 'This CLI command does not call previewEvents. Future execution must preview invoice impact before any ingest write.',
    },
    {
      id: 'ingest-canary-usage-events',
      type: 'planned-write',
      method: 'POST',
      path: '/v1/ingest',
      sourceIds: ['endpoint-matrix', 'official-usage-ingest', 'metronome-ingestion-events', 'danger-zone'],
      payloadDraft: canaryEvents,
      readiness: 'blocked-pending-preview-events-proof',
      note: 'Future apply must ingest only the canary batch first, then verify event search, usage groups, and invoice preview before any remaining events.',
    },
  ];

  if (remainingEvents.length > 0) {
    actions.push({
      id: 'ingest-remaining-usage-events-after-canary',
      type: 'planned-write',
      method: 'POST',
      path: '/v1/ingest',
      sourceIds: ['endpoint-matrix', 'official-usage-ingest', 'metronome-ingestion-events', 'danger-zone'],
      payloadDraft: remainingEvents,
      readiness: 'blocked-pending-canary-readback',
      note: 'Future bulk ingest must run only after canary read-back matches the preview and stop criteria remain clear.',
    });
  }

  const hashInput = {
    workflow: 'usage.ingest-preview',
    shape: 'usage-ingest-preview',
    tenant,
    actions,
  };

  return {
    schemaVersion: 'metro.preview.v1',
    workflow: 'usage.ingest-preview',
    shape: 'usage-ingest-preview',
    tenant,
    payloadHash: sha256(hashInput),
    actions,
    expectedSideEffects: [
      'No API calls are made by this preview.',
      'Future live preview would simulate invoice impact for the full event batch before ingest.',
      `Future canary ingest would submit ${canaryEvents.length} event(s) to /v1/ingest with stable transaction_id values.`,
      remainingEvents.length > 0
        ? `Future bulk ingest would submit the remaining ${remainingEvents.length} event(s) only after canary read-back succeeds.`
        : 'No remaining bulk batch exists after the canary event set.',
      'Past-dated usage can alter invoice economics, commit burn-down, or follow-up billing; finalized-period review is required before execution.',
    ],
    verificationPlan: [
      {
        id: 'verify-preview-events-impact',
        mode: 'future-live-preview',
        method: 'POST',
        path: '/v1/customers/{customer_id}/previewEvents',
        sourceIds: ['endpoint-matrix', 'official-invoice-preview-events', 'metronome-invoicing'],
        expectation: 'Invoice preview output matches the expected period, line items, credit burn-down, and Stripe side-effect review before any ingest write.',
      },
      {
        id: 'verify-event-search-by-transaction-id',
        mode: 'future-read',
        method: 'POST',
        path: '/v1/events/search',
        sourceIds: ['endpoint-matrix', 'official-event-search', 'metronome-ingestion-events'],
        expectation: 'Each canary transaction_id is accepted once, not duplicated, and matched to the intended customer and billable metric.',
      },
      {
        id: 'verify-usage-groups',
        mode: 'future-read',
        method: 'POST',
        path: '/v1/usage/groups',
        sourceIds: ['endpoint-matrix', 'official-usage-groups', 'metronome-ingestion-events'],
        expectation: 'Usage group totals for the invoice period reflect the canary event action codes before bulk ingest proceeds.',
      },
      {
        id: 'verify-invoice-impact-after-canary',
        mode: 'future-read',
        method: 'GET',
        path: '/v1/customers/{customer_id}/invoices',
        sourceIds: ['endpoint-matrix', 'metronome-invoicing', 'danger-zone'],
        expectation: 'Customer invoice inventory shows no unexpected finalized invoice, duplicate bill, or Stripe delivery side effect before bulk ingest.',
      },
    ],
    warnings: validation.findings.filter((finding) => finding.severity === 'warning'),
    blocked: false,
    applySupported: false,
    applyBlocker: 'Usage ingest execution is blocked until preview-events proof, canary support, audit logs, read-back verification, rollback evidence, and owner approval exist.',
    sources: getShape('usage-ingest-preview').sources,
  };
}

function buildDimensionalUsageProductPayload(input) {
  const usageProduct = input.usageProduct;
  const payload = {
    name: usageProduct.name,
    type: 'USAGE',
    billable_metric_id: usageProduct.billableMetricId,
    tags: [...usageProduct.tags],
    pricing_group_key: [...usageProduct.pricingGroupKey],
  };
  if (Array.isArray(usageProduct.presentationGroupKey) && usageProduct.presentationGroupKey.length > 0) {
    payload.presentation_group_key = [...usageProduct.presentationGroupKey];
  }
  return payload;
}

function buildDimensionalRatePayload(input, rate) {
  const productId = input.usageProduct.productId || '<created product id from create-dimensional-usage-product>';
  return {
    product_id: productId,
    starting_at: input.startingAt,
    entitled: true,
    rate_type: rate.rateType || 'FLAT',
    price: rate.price,
    credit_type_id: rate.creditTypeId,
    pricing_group_values: {
      action_code: rate.actionCode,
    },
  };
}

function buildDimensionalRateCardPreview(input, tenant, validation) {
  const addRatesOnly = input.catalogMode === 'add-rates-only';
  const productPayload = buildDimensionalUsageProductPayload(input);
  const ratePayload = {
    rate_card_id: input.rateCardId,
    rates: input.rates.map((rate) => buildDimensionalRatePayload(input, rate)),
  };
  const actions = [];

  if (!addRatesOnly) {
    actions.push({
      id: 'create-dimensional-usage-product',
      type: 'planned-write',
      method: 'POST',
      path: '/v1/contract-pricing/products/create',
      sourceIds: ['endpoint-matrix', 'official-product-create', 'pricing-catalog', 'billable-metrics'],
      payloadDraft: productPayload,
      readiness: 'draft-payload-plan',
      note: input.usageProduct.productId
        ? 'Existing product id is provided; future apply must prove it matches this product payload before reusing it instead of creating a duplicate.'
        : 'Future apply must first review existing products by stable business key so this create does not duplicate an existing dimensional usage product.',
      billableMetricEvidence: {
        id: input.billableMetric.id,
        aggregationType: input.billableMetric.aggregationType,
        aggregationKey: input.billableMetric.aggregationKey || null,
        groupKeys: input.billableMetric.groupKeys,
        requiredEventProperties: input.billableMetric.requiredEventProperties,
      },
    });
  }

  actions.push({
      id: 'add-dimensional-action-rates',
      type: 'planned-write',
      method: 'POST',
      path: '/v1/contract-pricing/rate-cards/addRates',
      sourceIds: ['endpoint-matrix', 'official-rate-card-add-rates', 'pricing-catalog'],
      payloadDraft: ratePayload,
      readiness: 'draft-payload-plan',
      note: 'Future apply must run the first actionCode as a canary, read back product and rate schedule evidence, then add any remaining rates only if stop criteria remain clear.',
      canary: {
        firstActionCode: input.canaryPlan.firstActionCode,
        readBackBeforeRemaining: input.canaryPlan.readBackBeforeRemaining,
      },
    });

  const hashInput = {
    workflow: 'rate-card.dimensional',
    shape: 'dimensional-rate-card',
    tenant,
    ...(addRatesOnly ? { catalogMode: 'add-rates-only' } : {}),
    actions,
  };

  return {
    schemaVersion: 'metro.preview.v1',
    workflow: 'rate-card.dimensional',
    shape: 'dimensional-rate-card',
    tenant,
    ...(addRatesOnly ? { catalogMode: 'add-rates-only' } : {}),
    payloadHash: sha256(hashInput),
    actions,
    expectedSideEffects: [
      'No API calls are made by this preview.',
      addRatesOnly
        ? 'Workspace add-rates-only mode: future apply must not create a billable metric or product; only addRates on the existing dimensional product.'
        : 'Future apply would create or reuse one USAGE product backed by a billable metric whose compound group key contains action_code and action_display_name.',
      `Future apply would append ${input.rates.length} dimensional action rate(s) at ${input.startingAt} on rate card ${input.rateCardId}.`,
      'Future apply must not create one product per action; invoice presentation labels come from action_display_name on usage events.',
      'Product and rate-card changes can affect future invoices for contracts using this rate card, so invoice-impact review, canary, and read-back verification are required.',
    ],
    verificationPlan: [
      {
        id: 'verify-dimensional-product',
        mode: 'future-read',
        method: 'POST',
        path: '/v1/contract-pricing/products/get',
        sourceIds: ['endpoint-matrix', 'official-product-get', 'pricing-catalog'],
        expectation: 'Product read-back shows one USAGE product with billable_metric_id, pricing_group_key, presentation_group_key, and tags matching the preview.',
      },
      {
        id: 'verify-dimensional-rate-schedule',
        mode: 'future-read',
        method: 'POST',
        path: '/v1/contract-pricing/rate-cards/getRateSchedule',
        sourceIds: ['endpoint-matrix', 'official-rate-card-get-rate-schedule'],
        expectation: 'Rate schedule shows each planned action_code row at startingAt with entitled:true, FLAT rate type, price, and credit type from the preview.',
      },
      {
        id: 'verify-dimensional-rates-by-selector',
        mode: 'future-read',
        method: 'POST',
        path: '/v1/contract-pricing/rate-cards/getRates',
        sourceIds: ['endpoint-matrix', 'official-rate-card-get-rates', 'pricing-catalog'],
        expectation: 'Selector read-back by product and pricing_group_values.action_code returns the intended dimensional rates without duplicate entitled rows.',
      },
      {
        id: 'verify-dimensional-usage-groups',
        mode: 'future-read',
        method: 'POST',
        path: '/v1/usage/groups',
        sourceIds: ['endpoint-matrix', 'official-usage-groups', 'billable-metrics'],
        expectation: 'Usage group read-back proves canary events include action_code and action_display_name under the compound metric group key.',
      },
      {
        id: 'verify-dimensional-invoice-impact',
        mode: 'future-read',
        method: 'GET',
        path: '/v1/customers/{customer_id}/invoices',
        sourceIds: ['endpoint-matrix', 'metronome-invoicing'],
        expectation: 'Invoice preview or inventory read-back shows no surprise invoice, duplicate billable line, or Stripe delivery side effect before remaining rates are applied.',
      },
    ],
    warnings: validation.findings.filter((finding) => finding.severity === 'warning'),
    blocked: false,
    applySupported: false,
    applyBlocker: 'Dimensional rate-card apply is blocked until product and metric evidence, sandbox canary proof, audit logs, read-back verification, rollback evidence, and owner approval exist.',
    sources: getShape('dimensional-rate-card').sources,
  };
}

function buildRetiredRatePayload(input, card) {
  const rate = {
    product_id: input.productId,
    starting_at: input.startingAt,
    entitled: false,
    rate_type: card.rateType || 'FLAT',
    price: 0,
    credit_type_id: card.creditTypeId,
    pricing_group_values: card.pricingGroupValues,
  };

  return {
    rate_card_id: card.rateCardId,
    rates: [rate],
  };
}

function buildProductRateRetirementPreview(input, tenant, validation) {
  const rateCloseActions = input.affectedRateCards.map((card, index) => ({
    id: `close-product-rate-${index + 1}`,
    type: 'planned-write',
    method: 'POST',
    path: '/v1/contract-pricing/rate-cards/addRates',
    sourceIds: ['endpoint-matrix', 'official-rate-card-add-rates', 'danger-zone'],
    payloadDraft: buildRetiredRatePayload(input, card),
    readiness: 'draft-payload-plan',
    note: 'Future apply must prove the current rate schedule first; addRates with entitled:false closes the prior open rate for this product on this rate card.',
  }));

  const actions = [...rateCloseActions];
  if (input.archiveProductAfterRatesClose === true) {
    actions.push({
      id: 'archive-product-after-rate-close',
      type: 'planned-write',
      method: 'POST',
      path: '/v1/contract-pricing/products/archive',
      sourceIds: ['endpoint-matrix', 'official-product-archive', 'danger-zone'],
      payloadDraft: {
        product_id: input.productId,
      },
      readiness: 'draft-payload-plan',
      note: 'Archive is catalog hygiene only; it does not close existing rate-card entries.',
    });
  }

  const hashInput = {
    workflow: 'product.rate-retirement',
    shape: 'product-rate-retirement',
    tenant,
    actions,
  };
  return {
    schemaVersion: 'metro.preview.v1',
    workflow: 'product.rate-retirement',
    shape: 'product-rate-retirement',
    tenant,
    payloadHash: sha256(hashInput),
    actions,
    expectedSideEffects: [
      'No API calls are made by this preview.',
      'Future apply would append entitled:false, price:0 rate entries at startingAt on every affected rate card.',
      input.archiveProductAfterRatesClose === true
        ? 'Future apply would archive the product only after the rate close entries are planned.'
        : 'Future apply would not archive the product in this preview; it only plans rate closure.',
      'Existing contracts and invoices require targeted read-back because product archive alone does not stop active rate-card entries.',
    ],
    verificationPlan: [
      {
        id: 'verify-rate-schedules',
        mode: 'future-read',
        method: 'POST',
        path: '/v1/contract-pricing/rate-cards/getRateSchedule',
        sourceIds: ['endpoint-matrix', 'official-rate-card-get-rate-schedule', 'danger-zone'],
        expectation: 'Every affected rate card shows an entitled:false, price:0 entry for the product at startingAt and no later entitled:true entry is unintentionally live.',
      },
      {
        id: 'verify-product-archive-state',
        mode: 'future-read',
        method: 'POST',
        path: '/v1/contract-pricing/products/get',
        sourceIds: ['endpoint-matrix', 'official-product-get'],
        expectation: input.archiveProductAfterRatesClose === true
          ? 'Product archive state is visible after rate close evidence exists.'
          : 'Product remains unarchived because this preview did not request product archive.',
      },
      {
        id: 'verify-invoice-impact',
        mode: 'future-read',
        method: 'GET',
        path: '/v1/customers/{customer_id}/invoices',
        sourceIds: ['endpoint-matrix', 'danger-zone'],
        expectation: 'Targeted customer invoice preview or read-back confirms the retired product no longer produces billable lines after cutover.',
      },
    ],
    warnings: validation.findings.filter((finding) => finding.severity === 'warning'),
    blocked: false,
    applySupported: false,
    applyBlocker: 'Product retirement apply is blocked until inspected rate schedules, sandbox proof, audit logs, read-back verification, rollback evidence, and owner approval exist.',
    sources: getShape('product-rate-retirement').sources,
  };
}

function buildPreview(shapeId, input, { tenant, validationOptions } = {}) {
  const validation = validateShapeInput(
    shapeId,
    input,
    validationOptions || defaultValidationOptions({ tenant }),
  );
  if (!validation.valid) {
    return {
      schemaVersion: 'metro.preview.v1',
      workflow: shapeId,
      shape: shapeId,
      tenant,
      payloadHash: null,
      actions: [],
      expectedSideEffects: ['No API calls are made by this preview.'],
      verificationPlan: [],
      warnings: validation.findings.filter((finding) => finding.severity === 'warning'),
      blocked: true,
      blockReason: 'Input validation failed.',
      validation,
    };
  }

  if (shapeId === 'customer-setup') return buildCustomerSetupPreview(input, tenant, validation);
  if (shapeId === 'pro-annual') return buildProAnnualPreview(input, tenant, validation);
  if (shapeId === 'pro-annual-self-serve-v2') return buildProAnnualSelfServeV2Preview(input, tenant, validation);
  if (shapeId === 'free-credit-trial') return buildFreeCreditTrialPreview(input, tenant, validation);
  if (shapeId === 'complimentary-credit-grant') return buildComplimentaryCreditPreview(input, tenant, validation);
  if (shapeId === 'paid-credit-top-up') return buildPaidCreditTopUpPreview(input, tenant, validation);
  if (shapeId === 'package-alias-archive-handoff') return buildPackageAliasArchiveHandoffPreview(input, tenant, validation);
  if (shapeId === 'stripe-billing-provider-attachment') return buildStripeBillingProviderPreview(input, tenant, validation);
  if (shapeId === 'package-plan-move-no-immediate-invoice') {
    return buildPackagePlanMovePreview(input, tenant, validation, shapeId);
  }
  if (shapeId === 'package-plan-move-immediate-invoice') {
    return buildPackagePlanMovePreview(input, tenant, validation, shapeId);
  }
  if (shapeId === 'product-rate-retirement') return buildProductRateRetirementPreview(input, tenant, validation);
  if (shapeId === 'dimensional-rate-card') return buildDimensionalRateCardPreview(input, tenant, validation);
  if (shapeId === 'invoice-issue-date-update') return buildInvoiceIssueDateUpdatePreview(input, tenant, validation);
  if (shapeId === 'direct-subscription-contract') return buildDirectSubscriptionContractPreview(input, tenant, validation);
  if (shapeId === 'enterprise-custom-contract') return buildEnterpriseCustomContractPreview(input, tenant, validation);
  if (shapeId === 'usage-ingest-preview') return buildUsageIngestPreview(input, tenant, validation);

  return {
    schemaVersion: 'metro.preview.v1',
    workflow: shapeId,
    shape: shapeId,
    tenant,
    payloadHash: null,
    actions: [],
    expectedSideEffects: ['No API calls are made by this preview.'],
    verificationPlan: [],
    warnings: [],
    blocked: true,
    blockReason: `Preview is not implemented for shape: ${shapeId}`,
  };
}

module.exports = {
  buildPreview,
  canonicalJson,
  canonicalize,
  sha256,
};
