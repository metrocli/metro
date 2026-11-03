'use strict';

const { getShape } = require('../shapes');
const { rule } = require('./rules');

// Metronome's built-in USD (cents) fiat credit type. Same id on every tenant.
const USD_CREDIT_TYPE_ID = '2714e483-4ff1-48e4-9e25-ac732e8f24f2';
const INVOICE_ISSUE_DATE_STRIPE_BEHAVIORS = new Set([
  'defer_until_new_issue_date',
  'remain_draft_for_manual_review',
  'no_stripe_delivery_expected',
]);
const SUBSCRIPTION_BILLING_FREQUENCIES = new Set(['MONTHLY', 'QUARTERLY', 'SEMI_ANNUAL', 'ANNUAL']);
const SUBSCRIPTION_QUANTITY_MODES = new Set(['QUANTITY_ONLY', 'SEAT_BASED']);
const BILLABLE_METRIC_AGGREGATION_TYPES = new Set(['COUNT', 'SUM', 'MAX', 'UNIQUE']);
const MAX_USAGE_INGEST_BATCH_SIZE = 100;
const CUSTOM_CONTRACT_STRIPE_BEHAVIORS = new Set(['push_to_stripe', 'leave_draft']);
const CUSTOM_CONTRACT_CADENCES = new Set(['monthly', 'annual']);
const CUSTOM_CONTRACT_SEAT_LIMIT_MODES = new Set(['none', 'seat_based']);
const CUSTOMER_HIERARCHY_MODES = new Set([
  'standalone',
  'parent_shell',
  'child_contract_deferred',
  'ingest_alias_parent_fallback',
]);
const CUSTOMER_BILLING_PROVIDER_MODES = new Set(['none', 'stripe']);
const CUSTOMER_EXISTING_POLICIES = new Set(['fail_if_exists', 'reuse_if_exact_match']);

function hasValue(value) {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function isNumberInRange(value, min, max) {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

function isSafeIdentifier(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_.:-]+$/.test(value);
}

/**
 * Access (non-fiat) credit type ids this tenant uses, from config, never hardcoded.
 * Sources, all optional: options.accessCreditTypeIds, options.creditTypeId,
 * options.workspaceCatalog.creditTypeId (profile workspaceCatalog binding), and
 * the METRO_ACCESS_CREDIT_TYPE_IDS env var (comma-separated). Placeholders such
 * as "<credit-type-id>" are ignored.
 */
function configuredAccessCreditTypeIds(options = {}) {
  const ids = new Set();
  const push = (value) => {
    if (!hasValue(value)) return;
    const id = String(value).trim();
    if (id.startsWith('<')) return;
    ids.add(id);
  };
  const list = options.accessCreditTypeIds;
  if (Array.isArray(list)) list.forEach(push);
  push(options.creditTypeId);
  push(options.workspaceCatalog?.creditTypeId);
  if (process.env.METRO_ACCESS_CREDIT_TYPE_IDS) {
    process.env.METRO_ACCESS_CREDIT_TYPE_IDS.split(',').forEach(push);
  }
  return ids;
}

function isAccessCreditType(creditTypeId, input, options) {
  if (!hasValue(creditTypeId)) return false;
  if (hasValue(input?.accessCreditTypeId) && creditTypeId === input.accessCreditTypeId) return true;
  return configuredAccessCreditTypeIds(options).has(String(creditTypeId).trim());
}

function resolveCustomerExternalId(input) {
  if (hasValue(input.externalCustomerId)) {
    return { field: 'externalCustomerId', value: String(input.externalCustomerId).trim() };
  }
  return { field: 'externalCustomerId', value: null };
}

function validateCustomerExternalId(input, findings, ruleId = 'MTR-CUST-001') {
  const identity = resolveCustomerExternalId(input);
  if (!identity.value) {
    add(
      findings,
      ruleId,
      'externalCustomerId is required for customer identity and custom-field evidence.',
      'externalCustomerId',
      ruleId === 'MTR-CUSTOM-001' ? ['custom-contract-schema'] : ['shape-catalog', 'customers-hierarchies'],
    );
    return null;
  }
  if (!isSafeIdentifier(identity.value)) {
    add(
      findings,
      ruleId,
      `${identity.field} must be a single safe external customer identifier.`,
      identity.field,
      ['validation'],
    );
    return null;
  }
  return identity;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyStringArray(value) {
  return Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === 'string' && item.trim() !== '');
}

function arrayEquals(value, expected) {
  return Array.isArray(value)
    && value.length === expected.length
    && expected.every((item, index) => value[index] === item);
}

function isIsoTimestampUTC(value) {
  if (!hasValue(value) || typeof value !== 'string') return false;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return false;
  return !Number.isNaN(Date.parse(value));
}

function isHourBoundaryUTC(value) {
  if (!hasValue(value) || typeof value !== 'string') return false;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:00:00(?:\.000)?Z$/.test(value)) return false;
  return !Number.isNaN(Date.parse(value));
}

function makeFinding(id, message, path, sourceIds = []) {
  const definition = rule(id);
  return {
    id,
    severity: definition.severity,
    title: definition.title,
    message,
    remediation: definition.remediation,
    path,
    sourceIds,
  };
}

function add(findingList, id, message, path, sourceIds) {
  findingList.push(makeFinding(id, message, path, sourceIds));
}

function validateStartingAt(input, findings) {
  if (!hasValue(input.startingAt)) {
    add(findings, 'MTR-RATE-004', 'startingAt is required.', 'startingAt', ['validation', 'shape-catalog']);
    return;
  }
  if (!isHourBoundaryUTC(input.startingAt)) {
    add(findings, 'MTR-TIME-001', 'startingAt must be a UTC hour-boundary timestamp.', 'startingAt', ['validation', 'conventions']);
  }
}

function validateOptionalEndingBefore(input, findings) {
  if (hasValue(input.endingBefore) && !isHourBoundaryUTC(input.endingBefore)) {
    add(findings, 'MTR-TIME-001', 'endingBefore must be a UTC hour-boundary timestamp.', 'endingBefore', ['validation', 'conventions']);
  }
}

function validateApprovedCustomFields(input, findings, { targetObjectType, sourceIds }) {
  if (input.customFields === undefined) return;

  if (!isPlainObject(input.customFields)) {
    add(findings, 'MTR-CREDIT-005', 'customFields must be an object keyed by approved Metronome custom-field keys.', 'customFields', sourceIds);
    return;
  }

  const customFieldKeys = Object.keys(input.customFields);
  if (customFieldKeys.length === 0) {
    add(findings, 'MTR-CREDIT-005', 'customFields must include at least one approved custom-field key or be omitted.', 'customFields', sourceIds);
  }

  if (input.customFieldObjectType !== targetObjectType) {
    add(findings, 'MTR-CREDIT-005', `customFieldObjectType must be ${targetObjectType} for this shape.`, 'customFieldObjectType', sourceIds);
  }

  if (input.customFieldKeysApproved !== true) {
    add(findings, 'MTR-CREDIT-005', 'customFieldKeysApproved must be true before customFields can be previewed.', 'customFieldKeysApproved', sourceIds);
  }

  const approvedKeys = Array.isArray(input.approvedCustomFieldKeys)
    ? new Set(input.approvedCustomFieldKeys)
    : null;
  if (!approvedKeys || approvedKeys.size === 0) {
    add(findings, 'MTR-CREDIT-005', 'approvedCustomFieldKeys must list every customFields key approved for the target object type.', 'approvedCustomFieldKeys', sourceIds);
  }

  customFieldKeys.forEach((key) => {
    if (!isSafeIdentifier(key)) {
      add(findings, 'MTR-CREDIT-005', `${key} is not a safe custom-field key.`, `customFields.${key}`, sourceIds);
    }
    if (approvedKeys && !approvedKeys.has(key)) {
      add(findings, 'MTR-CREDIT-005', `${key} must appear in approvedCustomFieldKeys before preview.`, `customFields.${key}`, sourceIds);
    }
  });
}

function validateCustomerCustomFields(input, findings) {
  if (input.customFields === undefined) return;

  if (!isPlainObject(input.customFields)) {
    add(findings, 'MTR-CUST-004', 'customFields must be an object keyed by approved Metronome customer custom-field keys.', 'customFields', ['customers-hierarchies', 'validation']);
    return;
  }

  const customFieldKeys = Object.keys(input.customFields);
  if (customFieldKeys.length === 0) {
    add(findings, 'MTR-CUST-004', 'customFields must include at least one approved customer custom-field key or be omitted.', 'customFields', ['customers-hierarchies']);
  }

  if (input.customFieldObjectType !== 'customer') {
    add(findings, 'MTR-CUST-004', 'customFieldObjectType must be customer for customer setup.', 'customFieldObjectType', ['customers-hierarchies']);
  }

  if (input.customFieldKeysApproved !== true) {
    add(findings, 'MTR-CUST-004', 'customFieldKeysApproved must be true before customer custom fields can be previewed.', 'customFieldKeysApproved', ['customers-hierarchies', 'danger-zone']);
  }

  const approvedKeys = Array.isArray(input.approvedCustomFieldKeys)
    ? new Set(input.approvedCustomFieldKeys)
    : null;
  if (!approvedKeys || approvedKeys.size === 0) {
    add(findings, 'MTR-CUST-004', 'approvedCustomFieldKeys must list every customer customFields key approved for the customer entity.', 'approvedCustomFieldKeys', ['customers-hierarchies']);
  }

  customFieldKeys.forEach((key) => {
    const value = input.customFields[key];
    if (!isSafeIdentifier(key)) {
      add(findings, 'MTR-CUST-004', `${key} is not a safe customer custom-field key.`, `customFields.${key}`, ['customers-hierarchies']);
    }
    if (approvedKeys && !approvedKeys.has(key)) {
      add(findings, 'MTR-CUST-004', `${key} must appear in approvedCustomFieldKeys before preview.`, `customFields.${key}`, ['customers-hierarchies']);
    }
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
      add(findings, 'MTR-CUST-004', `${key} must be a scalar custom-field value.`, `customFields.${key}`, ['customers-hierarchies']);
    } else if (String(value).length > 200) {
      add(findings, 'MTR-CUST-004', `${key} exceeds Metronome's 200-character custom-field value limit.`, `customFields.${key}`, ['customers-hierarchies']);
    }
  });
}

function validateCustomerSetupBillingProvider(input, findings) {
  const billingProvider = isPlainObject(input.billingProvider) ? input.billingProvider : null;
  if (!billingProvider) {
    add(findings, 'MTR-BILL-001', 'billingProvider.mode must be explicit: none or stripe.', 'billingProvider', ['shape-catalog', 'stripe-delivery']);
    return;
  }

  if (!CUSTOMER_BILLING_PROVIDER_MODES.has(billingProvider.mode)) {
    add(findings, 'MTR-BILL-001', 'billingProvider.mode must be none or stripe.', 'billingProvider.mode', ['shape-catalog', 'stripe-delivery']);
    return;
  }

  if (billingProvider.mode === 'none') {
    if (!hasValue(billingProvider.nonBillableReason)) {
      add(findings, 'MTR-BILL-001', 'billingProvider.nonBillableReason is required when no Stripe config is planned.', 'billingProvider.nonBillableReason', ['shape-catalog']);
    }
    for (const field of ['stripeCustomerId', 'stripeCollectionMethod', 'deliveryMethod', 'deliveryMethodId']) {
      if (hasValue(billingProvider[field])) {
        add(findings, 'MTR-BILL-001', `${field} must be omitted when billingProvider.mode is none.`, `billingProvider.${field}`, ['validation']);
      }
    }
    return;
  }

  if (!/^cus_[A-Za-z0-9]+$/.test(billingProvider.stripeCustomerId || '')) {
    add(findings, 'MTR-BILL-001', 'billingProvider.stripeCustomerId must look like a Stripe customer id beginning with cus_.', 'billingProvider.stripeCustomerId', ['stripe-delivery']);
  }

  if (!['send_invoice', 'charge_automatically'].includes(billingProvider.stripeCollectionMethod)) {
    add(findings, 'MTR-BILL-004', 'billingProvider.stripeCollectionMethod must be send_invoice or charge_automatically.', 'billingProvider.stripeCollectionMethod', ['stripe-delivery']);
  }

  const hasDeliveryMethodId = hasValue(billingProvider.deliveryMethodId);
  const hasDeliveryMethod = hasValue(billingProvider.deliveryMethod);
  if (hasDeliveryMethodId && hasDeliveryMethod) {
    add(findings, 'MTR-BILL-002', 'Use billingProvider.deliveryMethodId or billingProvider.deliveryMethod, not both.', 'billingProvider.deliveryMethodId', ['stripe-delivery', 'gotchas']);
  } else if (!hasDeliveryMethodId && !hasDeliveryMethod) {
    add(findings, 'MTR-BILL-002', 'Stripe customer setup requires billingProvider.deliveryMethodId or billingProvider.deliveryMethod.', 'billingProvider.deliveryMethodId', ['stripe-delivery']);
  } else if (hasDeliveryMethod && billingProvider.deliveryMethod !== 'direct_to_billing_provider') {
    add(findings, 'MTR-BILL-002', 'Only direct_to_billing_provider is supported as the deliveryMethod shorthand for customer setup.', 'billingProvider.deliveryMethod', ['endpoint-matrix']);
  } else if (hasDeliveryMethodId && !isSafeIdentifier(billingProvider.deliveryMethodId)) {
    add(findings, 'MTR-BILL-002', 'billingProvider.deliveryMethodId must be a single safe Metronome delivery method identifier.', 'billingProvider.deliveryMethodId', ['validation']);
  }

  if (!['single_entity', 'multi_entity'].includes(billingProvider.deliveryMethodScope)) {
    add(findings, 'MTR-BILL-005', 'billingProvider.deliveryMethodScope must be single_entity or multi_entity.', 'billingProvider.deliveryMethodScope', ['stripe-delivery', 'validation']);
  } else if (billingProvider.deliveryMethodScope === 'multi_entity') {
    if (!hasDeliveryMethodId || hasDeliveryMethod) {
      add(findings, 'MTR-BILL-005', 'multi_entity customer setup must use billingProvider.deliveryMethodId and must not use the deliveryMethod shorthand.', 'billingProvider.deliveryMethodId', ['stripe-delivery', 'gotchas']);
    }
    const evidence = isPlainObject(billingProvider.multiEntityDelivery)
      ? billingProvider.multiEntityDelivery
      : null;
    if (!evidence) {
      add(findings, 'MTR-BILL-005', 'billingProvider.multiEntityDelivery evidence is required when deliveryMethodScope is multi_entity.', 'billingProvider.multiEntityDelivery', ['stripe-delivery']);
    } else {
      if (evidence.deliveryMethodId !== billingProvider.deliveryMethodId) {
        add(findings, 'MTR-BILL-005', 'billingProvider.multiEntityDelivery.deliveryMethodId must match billingProvider.deliveryMethodId.', 'billingProvider.multiEntityDelivery.deliveryMethodId', ['stripe-delivery']);
      }
      if (!/^acct_[A-Za-z0-9]+$/.test(evidence.targetStripeAccountId || '')) {
        add(findings, 'MTR-BILL-005', 'billingProvider.multiEntityDelivery.targetStripeAccountId must identify the target Stripe account with an acct_ id.', 'billingProvider.multiEntityDelivery.targetStripeAccountId', ['stripe-delivery']);
      }
      if (evidence.accountBillingProviderReviewed !== true) {
        add(findings, 'MTR-BILL-005', 'billingProvider.multiEntityDelivery.accountBillingProviderReviewed must be true.', 'billingProvider.multiEntityDelivery.accountBillingProviderReviewed', ['stripe-delivery']);
      }
      if (evidence.endpointFieldsReviewed !== true) {
        add(findings, 'MTR-BILL-005', 'billingProvider.multiEntityDelivery.endpointFieldsReviewed must be true for customer create billing config.', 'billingProvider.multiEntityDelivery.endpointFieldsReviewed', ['stripe-delivery', 'endpoint-matrix']);
      }
    }
  } else if (billingProvider.multiEntityDelivery !== undefined) {
    add(findings, 'MTR-BILL-005', 'billingProvider.multiEntityDelivery must be omitted unless deliveryMethodScope is multi_entity.', 'billingProvider.multiEntityDelivery', ['validation']);
  }

  if (typeof billingProvider.leaveStripeInvoicesInDraft !== 'boolean') {
    add(findings, 'MTR-BILL-004', 'billingProvider.leaveStripeInvoicesInDraft must be an explicit boolean.', 'billingProvider.leaveStripeInvoicesInDraft', ['stripe-delivery']);
  }
}

function validateCustomerSetup(input, findings) {
  if (!hasValue(input.companyName)) {
    add(findings, 'MTR-CUST-001', 'companyName is required for customer setup.', 'companyName', ['shape-catalog', 'customers-hierarchies']);
  }

  validateCustomerExternalId(input, findings, 'MTR-CUST-001');

  if (!hasValue(input.primaryIngestAlias)) {
    add(findings, 'MTR-CUST-001', 'primaryIngestAlias is required for Metronome ingest routing.', 'primaryIngestAlias', ['customers-hierarchies']);
  } else if (!isSafeIdentifier(input.primaryIngestAlias)) {
    add(findings, 'MTR-CUST-001', 'primaryIngestAlias must be a safe ingest alias identifier.', 'primaryIngestAlias', ['validation']);
  }

  if (!isNonEmptyStringArray(input.ingestAliases)) {
    add(findings, 'MTR-CUST-001', 'ingestAliases must include at least the primary ingest alias.', 'ingestAliases', ['shape-catalog', 'customers-hierarchies']);
  } else {
    const seen = new Set();
    input.ingestAliases.forEach((alias, index) => {
      if (!isSafeIdentifier(alias)) {
        add(findings, 'MTR-CUST-001', 'Every ingest alias must be a safe identifier.', `ingestAliases[${index}]`, ['validation']);
      }
      if (seen.has(alias)) {
        add(findings, 'MTR-CUST-002', `${alias} appears more than once in ingestAliases.`, `ingestAliases[${index}]`, ['customers-hierarchies']);
      }
      seen.add(alias);
    });
    if (hasValue(input.primaryIngestAlias) && !seen.has(input.primaryIngestAlias)) {
      add(findings, 'MTR-CUST-001', 'ingestAliases must include primaryIngestAlias.', 'ingestAliases', ['customers-hierarchies']);
    }
  }

  const duplicatePrevention = isPlainObject(input.duplicatePrevention)
    ? input.duplicatePrevention
    : null;
  if (!duplicatePrevention) {
    add(findings, 'MTR-CUST-002', 'duplicatePrevention evidence is required before customer setup preview.', 'duplicatePrevention', ['shape-catalog', 'customers-hierarchies']);
  } else {
    if (duplicatePrevention.ingestAliasSearchPlanned !== true) {
      add(findings, 'MTR-CUST-002', 'duplicatePrevention.ingestAliasSearchPlanned must be true.', 'duplicatePrevention.ingestAliasSearchPlanned', ['customers-hierarchies']);
    }
    if (duplicatePrevention.archivedCustomerCollisionReviewed !== true) {
      add(findings, 'MTR-CUST-002', 'duplicatePrevention.archivedCustomerCollisionReviewed must be true because archived customers can retain ingest aliases.', 'duplicatePrevention.archivedCustomerCollisionReviewed', ['customers-hierarchies']);
    }
    if (!CUSTOMER_EXISTING_POLICIES.has(duplicatePrevention.existingCustomerPolicy)) {
      add(findings, 'MTR-CUST-002', 'duplicatePrevention.existingCustomerPolicy must be fail_if_exists or reuse_if_exact_match.', 'duplicatePrevention.existingCustomerPolicy', ['shape-catalog']);
    }
    if (duplicatePrevention.existingCustomerPolicy === 'reuse_if_exact_match' && !isNonEmptyStringArray(duplicatePrevention.reuseMatchFields)) {
      add(findings, 'MTR-CUST-002', 'duplicatePrevention.reuseMatchFields must list fields that prove an existing customer is the same entity.', 'duplicatePrevention.reuseMatchFields', ['customers-hierarchies']);
    }
  }

  if (!CUSTOMER_HIERARCHY_MODES.has(input.hierarchyMode)) {
    add(findings, 'MTR-CUST-003', 'hierarchyMode must be standalone, parent_shell, child_contract_deferred, or ingest_alias_parent_fallback.', 'hierarchyMode', ['customers-hierarchies']);
  } else if (input.hierarchyMode !== 'standalone') {
    const hierarchyReview = isPlainObject(input.hierarchyReview) ? input.hierarchyReview : null;
    if (!hierarchyReview) {
      add(findings, 'MTR-CUST-003', 'hierarchyReview is required when hierarchyMode is not standalone.', 'hierarchyReview', ['customers-hierarchies']);
    } else {
      if (hierarchyReview.contractLevelHierarchyReviewed !== true) {
        add(findings, 'MTR-CUST-003', 'hierarchyReview.contractLevelHierarchyReviewed must be true because hierarchy lives on contracts, not the customer object.', 'hierarchyReview.contractLevelHierarchyReviewed', ['customers-hierarchies']);
      }
      if (hierarchyReview.tenNodeLimitReviewed !== true) {
        add(findings, 'MTR-CUST-003', 'hierarchyReview.tenNodeLimitReviewed must be true for hierarchy-aware setup.', 'hierarchyReview.tenNodeLimitReviewed', ['customers-hierarchies']);
      }
      if (input.hierarchyMode === 'child_contract_deferred'
        && hierarchyReview.packageContractsRejectedForHierarchyReviewed !== true) {
        add(findings, 'MTR-CUST-003', 'hierarchyReview.packageContractsRejectedForHierarchyReviewed must be true for child hierarchy setup.', 'hierarchyReview.packageContractsRejectedForHierarchyReviewed', ['customers-hierarchies']);
      }
    }
  } else if (input.hierarchyReview !== undefined) {
    add(findings, 'MTR-CUST-003', 'hierarchyReview must be omitted when hierarchyMode is standalone.', 'hierarchyReview', ['validation']);
  }

  validateCustomerSetupBillingProvider(input, findings);
  validateCustomerCustomFields(input, findings);

  const verificationPlan = isPlainObject(input.verificationPlan) ? input.verificationPlan : null;
  if (!verificationPlan) {
    add(findings, 'MTR-VERIFY-001', 'verificationPlan is required for customer setup read-back.', 'verificationPlan', ['shape-catalog']);
  } else {
    if (verificationPlan.customerReadback !== true) {
      add(findings, 'MTR-VERIFY-001', 'verificationPlan.customerReadback must be true.', 'verificationPlan.customerReadback', ['endpoint-matrix', 'customers-hierarchies']);
    }
    if (verificationPlan.ingestAliasSearchReadback !== true) {
      add(findings, 'MTR-VERIFY-001', 'verificationPlan.ingestAliasSearchReadback must be true.', 'verificationPlan.ingestAliasSearchReadback', ['endpoint-matrix', 'customers-hierarchies']);
    }
    if (input.billingProvider?.mode === 'stripe' && verificationPlan.billingProviderReadback !== true) {
      add(findings, 'MTR-BILL-004', 'verificationPlan.billingProviderReadback must be true for Stripe customer setup.', 'verificationPlan.billingProviderReadback', ['stripe-delivery']);
    }
    if (input.billingProvider?.mode === 'stripe' && verificationPlan.noInvoiceSideEffectReadback !== true) {
      add(findings, 'MTR-VERIFY-001', 'verificationPlan.noInvoiceSideEffectReadback must be true to prove setup did not create invoices.', 'verificationPlan.noInvoiceSideEffectReadback', ['danger-zone', 'stripe-delivery']);
    }
    if (input.hierarchyMode && input.hierarchyMode !== 'standalone'
      && verificationPlan.hierarchyContractReadbackDeferred !== true) {
      add(findings, 'MTR-CUST-003', 'verificationPlan.hierarchyContractReadbackDeferred must be true because hierarchy is verified on future contracts.', 'verificationPlan.hierarchyContractReadbackDeferred', ['customers-hierarchies']);
    }
  }

  if (!hasValue(input.rollbackPlan)) {
    add(findings, 'MTR-VERIFY-002', 'rollbackPlan is required for customer setup remediation, including alias release and invoice-side-effect review.', 'rollbackPlan', ['shape-catalog', 'danger-zone']);
  }

  for (const field of ['archiveExistingCustomer', 'archiveOnCollision', 'deleteCustomerOnFailure']) {
    if (input[field] === true) {
      add(findings, 'MTR-CUST-002', `${field} is forbidden in this local setup shape; customer archive can void invoices and does not refund Stripe.`, field, ['danger-zone', 'customers-hierarchies']);
    }
  }
}

function validateProAnnual(input, findings, options) {
  if (!hasValue(input.packageAlias)) {
    add(findings, 'MTR-PKG-001', 'packageAlias is required for pro-annual.', 'packageAlias', ['validation', 'shape-catalog']);
  }

  if (!hasValue(input.uniquenessKey)) {
    add(findings, 'MTR-PKG-002', 'uniquenessKey is required for idempotent package creation.', 'uniquenessKey', ['validation', 'gotchas']);
  } else if (String(input.uniquenessKey).length > 128) {
    add(findings, 'MTR-PKG-002', 'uniquenessKey must be 128 characters or fewer.', 'uniquenessKey', ['validation']);
  }

  if (!hasValue(input.rateCardId)) {
    add(findings, 'MTR-RATE-004', 'rateCardId is required so the package is tied to an explicit rate card.', 'rateCardId', ['shape-catalog']);
  }

  validateStartingAt(input, findings);

  if (!isPositiveInteger(input.annualPriceCents)) {
    add(findings, 'MTR-BILL-001', 'annualPriceCents must be a positive integer for a billable annual package.', 'annualPriceCents', ['shape-catalog']);
  }

  if (input.billingFrequency !== 'ANNUAL') {
    add(findings, 'MTR-RATE-002', 'pro-annual requires billingFrequency to be ANNUAL.', 'billingFrequency', ['validation']);
  }

  if (input.billingProvider?.configured !== true) {
    add(findings, 'MTR-BILL-001', 'pro-annual can create invoices and requires planned or existing billing provider config.', 'billingProvider.configured', ['validation', 'gotchas']);
  }

  if (!['push_to_stripe', 'leave_draft'].includes(input.stripeBehavior)) {
    add(findings, 'MTR-BILL-004', 'stripeBehavior must be push_to_stripe or leave_draft for pro-annual.', 'stripeBehavior', ['validation', 'gotchas']);
  }

  if (isHourBoundaryUTC(input.startingAt) && Date.parse(input.startingAt) <= Date.parse(options.now)) {
    add(findings, 'MTR-INV-001', 'startingAt is not in the future; paid scheduled invoices may finalize immediately.', 'startingAt', ['danger-zone']);
  }
}

function validateProAnnualSelfServeV2(input, findings, options) {
  validateProAnnual({
    ...input,
    annualPriceCents: input.annualPlanFeeCents,
  }, findings, options);

  if (!['monthly-drip', 'lump-sum'].includes(input.creditGrantMode)) {
    add(findings, 'MTR-PKG-010', 'creditGrantMode must be monthly-drip or lump-sum.', 'creditGrantMode', ['shape-catalog']);
  }

  if (!isPositiveInteger(input.annualCreditsTotal)) {
    add(findings, 'MTR-PKG-011', 'annualCreditsTotal must be a positive integer.', 'annualCreditsTotal', ['shape-catalog']);
  } else if (input.creditGrantMode === 'monthly-drip' && input.annualCreditsTotal % 12 !== 0) {
    add(findings, 'MTR-PKG-011', 'annualCreditsTotal should divide evenly by 12 for monthly-drip (1/12 grants).', 'annualCreditsTotal', ['shape-catalog']);
  }

  if (!hasValue(input.fixedProductId)) {
    add(findings, 'MTR-PKG-011', 'fixedProductId is required for recurring_commits credit grants.', 'fixedProductId', ['shape-catalog']);
  }

  if (!hasValue(input.accessCreditTypeId)) {
    add(findings, 'MTR-CREDIT-001', 'accessCreditTypeId is required for recurring_commits access amounts.', 'accessCreditTypeId', ['conventions']);
  }

  if (!hasValue(input.commitName)) {
    add(findings, 'MTR-PKG-011', 'commitName is required for recurring_commits.', 'commitName', ['shape-catalog']);
  }

  if (input.creditSeparateFromPlanFeeReviewed !== true) {
    add(findings, 'MTR-PKG-010', 'creditSeparateFromPlanFeeReviewed must be true - credits are modeled separately from the annual plan fee.', 'creditSeparateFromPlanFeeReviewed', ['danger-zone']);
  }

  if (input.creditGrantMode === 'lump-sum') {
    findings.push({
      id: 'MTR-PKG-010',
      severity: 'warning',
      title: rule('MTR-PKG-010').title,
      message: 'lump-sum creditGrantMode matches legacy production annual commits; confirm with finance before sandbox proof.',
      remediation: rule('MTR-PKG-010').remediation,
      path: 'creditGrantMode',
      sourceIds: ['danger-zone'],
    });
  }
}

function validateFreeCreditTrial(input, findings) {
  if (!hasValue(input.packageAlias)) {
    add(findings, 'MTR-PKG-001', 'packageAlias is required.', 'packageAlias', ['shape-catalog']);
  }

  if (!hasValue(input.uniquenessKey)) {
    add(findings, 'MTR-PKG-001', 'uniquenessKey is required to prevent duplicate package creation.', 'uniquenessKey', ['shape-catalog']);
  }

  if (!hasValue(input.aliasStartingAt)) {
    add(findings, 'MTR-RATE-004', 'aliasStartingAt is required.', 'aliasStartingAt', ['validation', 'shape-catalog']);
  } else if (!isHourBoundaryUTC(input.aliasStartingAt)) {
    add(findings, 'MTR-TIME-001', 'aliasStartingAt must be a UTC hour-boundary timestamp.', 'aliasStartingAt', ['validation', 'conventions']);
  }

  if (!isPositiveInteger(input.creditAmount)) {
    add(findings, 'MTR-PKG-012', 'creditAmount must be a positive integer (credits granted per trial period).', 'creditAmount', ['shape-catalog']);
  }

  if (!hasValue(input.accessCreditTypeId)) {
    add(findings, 'MTR-CREDIT-001', 'accessCreditTypeId is required for the recurring_commits access_amount.', 'accessCreditTypeId', ['conventions']);
  }

  if (!isPositiveInteger(input.trialDurationDays) || input.trialDurationDays > 365) {
    add(findings, 'MTR-PKG-012', 'trialDurationDays must be a positive integer between 1 and 365.', 'trialDurationDays', ['shape-catalog']);
  }

  if (!isNumberInRange(input.rolloverFraction, 0, 1)) {
    add(findings, 'MTR-PKG-012', 'rolloverFraction must be a number between 0 and 1 (1 = 100% rollover).', 'rolloverFraction', ['shape-catalog']);
  }

  if (input.noStripeConfirmed !== true) {
    add(findings, 'MTR-PKG-013', 'noStripeConfirmed must be true - free-credit-trial packages have no billing_provider and no invoice_amount.', 'noStripeConfirmed', ['danger-zone']);
  }

  if (input.aliasHandoffReviewed !== true) {
    add(findings, 'MTR-PKG-004', 'aliasHandoffReviewed must be true - confirm existing live aliases were checked before the new aliasStartingAt was chosen.', 'aliasHandoffReviewed', ['gotchas', 'shape-catalog']);
  }

  if (!hasValue(input.verificationPlan?.packageReadback)) {
    add(findings, 'MTR-VERIFY-001', 'verificationPlan.packageReadback is required to confirm the package is read back after create.', 'verificationPlan.packageReadback', ['shape-catalog']);
  }
}

function validateComplimentaryCreditGrant(input, findings, options = {}) {
  for (const field of ['customerId', 'contractId', 'name']) {
    if (!hasValue(input[field])) {
      add(findings, 'MTR-CREDIT-001', `${field} is required for a contract-scoped grant.`, field, ['shape-catalog']);
    }
  }

  if (!isPositiveInteger(input.amount)) {
    add(findings, 'MTR-CREDIT-001', 'amount must be a positive integer.', 'amount', ['shape-catalog']);
  }

  if (!hasValue(input.accessCreditTypeId)) {
    add(findings, 'MTR-CREDIT-001', 'accessCreditTypeId is required.', 'accessCreditTypeId', ['validation', 'conventions']);
  }

  validateStartingAt(input, findings);
  validateOptionalEndingBefore(input, findings);
  validateApprovedCustomFields(input, findings, {
    targetObjectType: 'commit',
    sourceIds: ['shape-catalog', 'gotchas', 'validation'],
  });

  if (!input.invoiceSchedule) return;

  const schedule = input.invoiceSchedule;
  if (!hasValue(schedule.creditTypeId)) {
    add(findings, 'MTR-CREDIT-002', 'invoiceSchedule.creditTypeId is required when invoiceSchedule is present.', 'invoiceSchedule.creditTypeId', ['validation', 'conventions']);
  } else if (isAccessCreditType(schedule.creditTypeId, input, options)) {
    add(findings, 'MTR-CREDIT-002', 'invoiceSchedule.creditTypeId must be fiat, not the access credit type.', 'invoiceSchedule.creditTypeId', ['danger-zone', 'conventions']);
  }

  if (schedule.creditTypeId && schedule.creditTypeId !== USD_CREDIT_TYPE_ID && schedule.creditTypeId !== input.accessCreditTypeId) {
    add(findings, 'MTR-CREDIT-002', 'Only USD cents is currently allowlisted by this validator for complimentary audit lines.', 'invoiceSchedule.creditTypeId', ['conventions']);
  }

  if (!isNonNegativeInteger(schedule.unitPriceCents)) {
    add(findings, 'MTR-CREDIT-004', 'invoiceSchedule.unitPriceCents must be 0 for a complimentary audit line.', 'invoiceSchedule.unitPriceCents', ['validation']);
  } else if (schedule.unitPriceCents !== 0) {
    add(findings, 'MTR-CREDIT-003', 'Complimentary credit grants cannot include a non-zero invoice schedule.', 'invoiceSchedule.unitPriceCents', ['validation']);
  }

  if (schedule.auditLineIntentConfirmed !== true) {
    add(findings, 'MTR-CREDIT-003', 'invoiceSchedule requires auditLineIntentConfirmed: true for a complimentary grant.', 'invoiceSchedule.auditLineIntentConfirmed', ['validation', 'danger-zone']);
  }
}

function validatePaidCreditTopUp(input, findings, options) {
  for (const field of ['customerId', 'contractId', 'productId', 'name']) {
    if (!hasValue(input[field])) {
      add(findings, 'MTR-CREDIT-001', `${field} is required for a contract-scoped paid top-up.`, field, ['shape-catalog', 'commits-credits']);
    } else if (field !== 'name' && !isSafeIdentifier(input[field])) {
      add(findings, 'MTR-CREDIT-001', `${field} must be a single safe Metronome identifier.`, field, ['validation']);
    }
  }

  if (!isPositiveInteger(input.amount)) {
    add(findings, 'MTR-CREDIT-001', 'amount must be a positive integer credit amount.', 'amount', ['shape-catalog', 'commits-credits']);
  }

  if (!hasValue(input.accessCreditTypeId)) {
    add(findings, 'MTR-CREDIT-001', 'accessCreditTypeId is required for the access_schedule ledger.', 'accessCreditTypeId', ['conventions', 'commits-credits']);
  } else if (!isSafeIdentifier(input.accessCreditTypeId)) {
    add(findings, 'MTR-CREDIT-001', 'accessCreditTypeId must be a safe credit type identifier.', 'accessCreditTypeId', ['validation']);
  }

  validateStartingAt(input, findings);
  validateOptionalEndingBefore(input, findings);

  if (isHourBoundaryUTC(input.startingAt) && Date.parse(input.startingAt) <= Date.parse(options.now)
    && input.immediateInvoiceConfirmed !== true) {
    add(findings, 'MTR-INV-001', 'startingAt is not in the future; paid top-up invoice_schedule may finalize immediately unless immediateInvoiceConfirmed is true.', 'immediateInvoiceConfirmed', ['danger-zone', 'metronome-invoicing']);
  }

  if (!isPositiveInteger(input.priority)) {
    add(findings, 'MTR-CREDIT-001', 'priority must be a positive integer so commit burn order is explicit.', 'priority', ['commits-credits']);
  }

  if (input.rolloverFraction !== undefined && !isNumberInRange(input.rolloverFraction, 0, 1)) {
    add(findings, 'MTR-CREDIT-001', 'rolloverFraction must be between 0 and 1 when provided.', 'rolloverFraction', ['commits-credits']);
  }

  if (!Array.isArray(input.applicableProductTags) || input.applicableProductTags.length === 0) {
    add(findings, 'MTR-CREDIT-001', 'applicableProductTags must list the product tags this paid top-up can burn against.', 'applicableProductTags', ['commits-credits']);
  } else {
    input.applicableProductTags.forEach((tag, index) => {
      if (!hasValue(tag) || typeof tag !== 'string') {
        add(findings, 'MTR-CREDIT-001', 'Every applicable product tag must be a non-empty string.', `applicableProductTags[${index}]`, ['commits-credits']);
      }
    });
  }

  const schedule = isPlainObject(input.invoiceSchedule) ? input.invoiceSchedule : null;
  if (!schedule) {
    add(findings, 'MTR-CREDIT-006', 'Paid top-ups must include invoiceSchedule so the billable amount and invoice behavior are explicit.', 'invoiceSchedule', ['commits-credits', 'shape-catalog']);
  } else {
    if (!hasValue(schedule.creditTypeId)) {
      add(findings, 'MTR-CREDIT-002', 'invoiceSchedule.creditTypeId is required for paid top-ups.', 'invoiceSchedule.creditTypeId', ['conventions', 'commits-credits']);
    } else if (isAccessCreditType(schedule.creditTypeId, input, options)) {
      add(findings, 'MTR-CREDIT-002', 'invoiceSchedule.creditTypeId must be fiat, not the access credit type.', 'invoiceSchedule.creditTypeId', ['danger-zone', 'conventions']);
    } else if (schedule.creditTypeId !== USD_CREDIT_TYPE_ID) {
      add(findings, 'MTR-CREDIT-002', 'Only USD cents is currently allowlisted by this validator for paid top-ups.', 'invoiceSchedule.creditTypeId', ['conventions']);
    }

    if (!isPositiveInteger(schedule.unitPriceCents)) {
      add(findings, 'MTR-CREDIT-004', 'invoiceSchedule.unitPriceCents must be a positive integer for a paid top-up.', 'invoiceSchedule.unitPriceCents', ['shape-catalog', 'commits-credits']);
    }

    if (schedule.quantity !== 1) {
      add(findings, 'MTR-CREDIT-006', 'invoiceSchedule.quantity must be exactly 1 so unitPriceCents is the full top-up invoice amount.', 'invoiceSchedule.quantity', ['commits-credits', 'validation']);
    }
  }

  if (input.paymentGateType !== 'STRIPE') {
    add(findings, 'MTR-CREDIT-006', 'paymentGateType must be STRIPE for the current paid top-up shape.', 'paymentGateType', ['commits-credits', 'metronome-stripe-delivery']);
  }

  if (input.invoiceBehavior !== 'paid_topup_invoice_expected') {
    add(findings, 'MTR-CREDIT-006', 'invoiceBehavior must be paid_topup_invoice_expected.', 'invoiceBehavior', ['shape-catalog', 'metronome-invoicing']);
  }

  if (!['push_to_stripe', 'leave_draft'].includes(input.stripeBehavior)) {
    add(findings, 'MTR-BILL-004', 'stripeBehavior must be push_to_stripe or leave_draft for paid top-ups.', 'stripeBehavior', ['gotchas', 'metronome-stripe-delivery']);
  }

  if (input.billingProvider?.verified !== true) {
    add(findings, 'MTR-BILL-001', 'billingProvider.verified must be true before planning a billable paid top-up.', 'billingProvider.verified', ['gotchas', 'metronome-stripe-delivery']);
  }

  if (input.duplicateCommitNameChecked !== true) {
    add(findings, 'MTR-CREDIT-006', 'duplicateCommitNameChecked must be true because add_commits has no client-side idempotency key.', 'duplicateCommitNameChecked', ['commits-credits', 'danger-zone']);
  }

  const verificationPlan = isPlainObject(input.verificationPlan) ? input.verificationPlan : null;
  if (!verificationPlan) {
    add(findings, 'MTR-VERIFY-001', 'verificationPlan is required for paid top-up read-back.', 'verificationPlan', ['shape-catalog', 'safety']);
  } else {
    if (verificationPlan.balanceReadback !== true) {
      add(findings, 'MTR-VERIFY-001', 'verificationPlan.balanceReadback must be true for the new commit balance.', 'verificationPlan.balanceReadback', ['commits-credits']);
    }
    if (verificationPlan.invoiceReadback !== true) {
      add(findings, 'MTR-VERIFY-001', 'verificationPlan.invoiceReadback must be true for the paid top-up invoice.', 'verificationPlan.invoiceReadback', ['metronome-invoicing']);
    }
    if (verificationPlan.billingProviderReadback !== true) {
      add(findings, 'MTR-BILL-004', 'verificationPlan.billingProviderReadback must be true to support the declared Stripe behavior.', 'verificationPlan.billingProviderReadback', ['metronome-stripe-delivery']);
    }
  }

  if (!hasValue(input.rollbackPlan)) {
    add(findings, 'MTR-VERIFY-002', 'rollbackPlan is required for paid top-up remediation, including invoice/Stripe mismatch handling.', 'rollbackPlan', ['danger-zone', 'metronome-invoicing']);
  }
}

function validateStripeBillingProviderAttachment(input, findings) {
  if (!hasValue(input.customerId)) {
    add(findings, 'MTR-BILL-001', 'customerId is required before attaching Stripe billing provider configuration.', 'customerId', ['shape-catalog', 'validation']);
  } else if (!isSafeIdentifier(input.customerId)) {
    add(findings, 'MTR-BILL-001', 'customerId must be a single safe Metronome customer identifier.', 'customerId', ['validation']);
  }

  if (!hasValue(input.stripeCustomerId)) {
    add(findings, 'MTR-BILL-001', 'stripeCustomerId is required for Stripe billing provider configuration.', 'stripeCustomerId', ['shape-catalog']);
  } else if (!/^cus_[A-Za-z0-9]+$/.test(input.stripeCustomerId)) {
    add(findings, 'MTR-BILL-001', 'stripeCustomerId must look like a Stripe customer id beginning with cus_.', 'stripeCustomerId', ['shape-catalog']);
  }

  if (!['send_invoice', 'charge_automatically'].includes(input.stripeCollectionMethod)) {
    add(findings, 'MTR-BILL-004', 'stripeCollectionMethod must be send_invoice or charge_automatically.', 'stripeCollectionMethod', ['shape-catalog', 'gotchas']);
  }

  const hasDeliveryMethodId = hasValue(input.deliveryMethodId);
  const hasDeliveryMethod = hasValue(input.deliveryMethod);
  if (hasDeliveryMethodId && hasDeliveryMethod) {
    add(findings, 'MTR-BILL-002', 'Use deliveryMethodId or deliveryMethod, not both.', 'deliveryMethodId', ['gotchas', 'endpoint-matrix']);
  } else if (!hasDeliveryMethodId && !hasDeliveryMethod) {
    add(findings, 'MTR-BILL-002', 'Stripe billing provider attachment requires deliveryMethodId or deliveryMethod.', 'deliveryMethodId', ['shape-catalog', 'gotchas']);
  } else if (hasDeliveryMethod && input.deliveryMethod !== 'direct_to_billing_provider') {
    add(findings, 'MTR-BILL-002', 'Only direct_to_billing_provider is supported as the deliveryMethod shorthand for this shape.', 'deliveryMethod', ['endpoint-matrix']);
  } else if (hasDeliveryMethodId && !isSafeIdentifier(input.deliveryMethodId)) {
    add(findings, 'MTR-BILL-002', 'deliveryMethodId must be a single safe Metronome delivery method identifier.', 'deliveryMethodId', ['validation']);
  }

  if (!['single_entity', 'multi_entity'].includes(input.deliveryMethodScope)) {
    add(findings, 'MTR-BILL-005', 'deliveryMethodScope must be single_entity or multi_entity before Stripe attachment preview.', 'deliveryMethodScope', ['gotchas', 'endpoint-matrix', 'validation']);
  } else if (input.deliveryMethodScope === 'multi_entity') {
    if (!hasDeliveryMethodId || hasDeliveryMethod) {
      add(findings, 'MTR-BILL-005', 'multi_entity Stripe delivery must use deliveryMethodId and must not use the deliveryMethod shorthand.', 'deliveryMethodId', ['gotchas', 'endpoint-matrix']);
    }
    if (!isPlainObject(input.multiEntityDelivery)) {
      add(findings, 'MTR-BILL-005', 'multiEntityDelivery evidence is required when deliveryMethodScope is multi_entity.', 'multiEntityDelivery', ['gotchas', 'endpoint-matrix']);
    } else {
      const evidence = input.multiEntityDelivery;
      if (evidence.deliveryMethodId !== input.deliveryMethodId) {
        add(findings, 'MTR-BILL-005', 'multiEntityDelivery.deliveryMethodId must match the top-level deliveryMethodId.', 'multiEntityDelivery.deliveryMethodId', ['gotchas', 'endpoint-matrix']);
      }
      if (!/^acct_[A-Za-z0-9]+$/.test(evidence.targetStripeAccountId || '')) {
        add(findings, 'MTR-BILL-005', 'multiEntityDelivery.targetStripeAccountId must identify the target Stripe account with an acct_ id.', 'multiEntityDelivery.targetStripeAccountId', ['gotchas', 'endpoint-matrix']);
      }
      if (evidence.accountBillingProviderReviewed !== true) {
        add(findings, 'MTR-BILL-005', 'multiEntityDelivery.accountBillingProviderReviewed must be true after account-level billing provider evidence is reviewed.', 'multiEntityDelivery.accountBillingProviderReviewed', ['gotchas', 'endpoint-matrix']);
      }
      if (evidence.endpointFieldsReviewed !== true) {
        add(findings, 'MTR-BILL-005', 'multiEntityDelivery.endpointFieldsReviewed must be true to prove delivery_method_id was reviewed for this endpoint.', 'multiEntityDelivery.endpointFieldsReviewed', ['gotchas', 'endpoint-matrix']);
      }
    }
  } else if (input.multiEntityDelivery !== undefined) {
    add(findings, 'MTR-BILL-005', 'multiEntityDelivery evidence must be omitted unless deliveryMethodScope is multi_entity.', 'multiEntityDelivery', ['validation']);
  }

  if (typeof input.leaveStripeInvoicesInDraft !== 'boolean') {
    add(findings, 'MTR-BILL-004', 'leaveStripeInvoicesInDraft must be an explicit boolean.', 'leaveStripeInvoicesInDraft', ['gotchas', 'validation']);
  }

  if (!['fail_if_exists', 'reuse_if_matching'].includes(input.existingConfigPolicy)) {
    add(findings, 'MTR-BILL-003', 'existingConfigPolicy must be fail_if_exists or reuse_if_matching.', 'existingConfigPolicy', ['shape-catalog', 'gotchas']);
  }

  if (input.archiveExisting === true || input.replaceExisting === true) {
    add(findings, 'MTR-BILL-003', 'Archiving or replacing existing billing configs is not supported by this local attach shape.', 'archiveExisting', ['gotchas', 'danger-zone']);
  }
}

function validateDirectSubscriptionContract(input, findings, options) {
  if (!hasValue(input.customerId)) {
    add(findings, 'MTR-BILL-001', 'customerId is required for direct subscription contracts.', 'customerId', ['shape-catalog']);
  } else if (!isSafeIdentifier(input.customerId)) {
    add(findings, 'MTR-BILL-001', 'customerId must be a single safe Metronome customer identifier.', 'customerId', ['validation']);
  }

  if (!hasValue(input.rateCardId)) {
    add(findings, 'MTR-RATE-004', 'rateCardId is required so the subscription rate is tied to an explicit rate card.', 'rateCardId', ['shape-catalog', 'pricing-catalog']);
  } else if (!isSafeIdentifier(input.rateCardId)) {
    add(findings, 'MTR-RATE-004', 'rateCardId must be a single safe Metronome rate-card identifier.', 'rateCardId', ['validation']);
  }

  if (!hasValue(input.contractUniquenessKey)) {
    add(findings, 'MTR-IDEMP-001', 'contractUniquenessKey is required for idempotent direct contract creation.', 'contractUniquenessKey', ['validation', 'packages-contracts']);
  } else if (!isSafeIdentifier(input.contractUniquenessKey)) {
    add(findings, 'MTR-IDEMP-001', 'contractUniquenessKey must be a single safe deterministic key.', 'contractUniquenessKey', ['validation']);
  } else if (String(input.contractUniquenessKey).length > 128) {
    add(findings, 'MTR-IDEMP-001', 'contractUniquenessKey must be 128 characters or fewer.', 'contractUniquenessKey', ['packages-contracts']);
  }

  validateStartingAt(input, findings);
  validateOptionalEndingBefore(input, findings);

  if (isHourBoundaryUTC(input.startingAt) && Date.parse(input.startingAt) <= Date.parse(options.now)) {
    add(findings, 'MTR-INV-001', 'startingAt is not in the future; subscription invoices may be created or finalized immediately.', 'startingAt', ['danger-zone', 'subscriptions-seats']);
  }

  if (!hasValue(input.name)) {
    add(findings, 'MTR-SUB-001', 'name is required for the subscription line.', 'name', ['shape-catalog']);
  }

  if (!hasValue(input.productId)) {
    add(findings, 'MTR-SUB-003', 'productId is required for subscription_rate.product_id.', 'productId', ['subscriptions-seats', 'pricing-catalog']);
  } else if (!isSafeIdentifier(input.productId)) {
    add(findings, 'MTR-SUB-003', 'productId must be a single safe Metronome product identifier.', 'productId', ['validation']);
  }

  if (input.subscriptionProductType !== 'SUBSCRIPTION') {
    add(findings, 'MTR-SUB-001', 'subscriptionProductType must be SUBSCRIPTION for subscription contracts.', 'subscriptionProductType', ['pricing-catalog', 'subscriptions-seats']);
  }

  if (!hasValue(input.rateCardProductId)) {
    add(findings, 'MTR-SUB-003', 'rateCardProductId is required to prove the rate-card subscription rate identity.', 'rateCardProductId', ['pricing-catalog', 'subscriptions-seats']);
  } else if (!isSafeIdentifier(input.rateCardProductId)) {
    add(findings, 'MTR-SUB-003', 'rateCardProductId must be a single safe product identifier.', 'rateCardProductId', ['validation']);
  } else if (hasValue(input.productId) && input.rateCardProductId !== input.productId) {
    add(findings, 'MTR-SUB-003', 'rateCardProductId must match productId.', 'rateCardProductId', ['gotchas', 'subscriptions-seats']);
  }

  if (!SUBSCRIPTION_BILLING_FREQUENCIES.has(input.rateCardBillingFrequency)) {
    add(findings, 'MTR-SUB-002', 'rateCardBillingFrequency must be MONTHLY, QUARTERLY, SEMI_ANNUAL, or ANNUAL.', 'rateCardBillingFrequency', ['subscriptions-seats']);
  }

  if (!SUBSCRIPTION_BILLING_FREQUENCIES.has(input.subscriptionBillingFrequency)) {
    add(findings, 'MTR-SUB-002', 'subscriptionBillingFrequency must be MONTHLY, QUARTERLY, SEMI_ANNUAL, or ANNUAL.', 'subscriptionBillingFrequency', ['subscriptions-seats']);
  } else if (input.rateCardBillingFrequency && input.subscriptionBillingFrequency !== input.rateCardBillingFrequency) {
    add(findings, 'MTR-SUB-002', 'subscriptionBillingFrequency must match the verified rate-card subscription rate frequency.', 'subscriptionBillingFrequency', ['gotchas', 'subscriptions-seats']);
  }

  if (input.rateCardSubscriptionRateVerified !== true) {
    add(findings, 'MTR-SUB-001', 'rateCardSubscriptionRateVerified must be true before previewing the contract.', 'rateCardSubscriptionRateVerified', ['pricing-catalog', 'subscriptions-seats']);
  }

  if (!SUBSCRIPTION_QUANTITY_MODES.has(input.quantityManagementMode)) {
    add(findings, 'MTR-SUB-004', 'quantityManagementMode must be QUANTITY_ONLY or SEAT_BASED.', 'quantityManagementMode', ['subscriptions-seats']);
  }

  if (!['advance', 'arrears'].includes(input.collectionSchedule)) {
    add(findings, 'MTR-SUB-001', 'collectionSchedule must be advance or arrears.', 'collectionSchedule', ['subscriptions-seats']);
  }

  const proration = isPlainObject(input.proration) ? input.proration : null;
  if (!proration) {
    add(findings, 'MTR-SUB-001', 'proration is required for subscription contracts.', 'proration', ['subscriptions-seats']);
  } else {
    if (typeof proration.isProrated !== 'boolean') {
      add(findings, 'MTR-SUB-001', 'proration.isProrated must be an explicit boolean.', 'proration.isProrated', ['subscriptions-seats']);
    }
    if (!['BILL_IMMEDIATELY', 'BILL_ON_NEXT_COLLECTION_DATE'].includes(proration.invoiceBehavior)) {
      add(findings, 'MTR-SUB-001', 'proration.invoiceBehavior must be BILL_IMMEDIATELY or BILL_ON_NEXT_COLLECTION_DATE.', 'proration.invoiceBehavior', ['subscriptions-seats']);
    }
  }

  if (input.quantityManagementMode === 'QUANTITY_ONLY') {
    if (!isPositiveInteger(input.initialQuantity)) {
      add(findings, 'MTR-SUB-004', 'initialQuantity must be a positive integer for QUANTITY_ONLY subscriptions.', 'initialQuantity', ['subscriptions-seats']);
    }
    if (input.seatConfig) {
      add(findings, 'MTR-SUB-004', 'seatConfig is forbidden for QUANTITY_ONLY subscriptions.', 'seatConfig', ['subscriptions-seats']);
    }
    if (input.seatUpdates || input.initialSeatIds) {
      add(findings, 'MTR-SUB-004', 'seat updates or initialSeatIds are forbidden for QUANTITY_ONLY subscriptions.', 'seatUpdates', ['subscriptions-seats']);
    }
  }

  if (input.quantityManagementMode === 'SEAT_BASED') {
    const seatConfig = isPlainObject(input.seatConfig) ? input.seatConfig : null;
    if (!seatConfig) {
      add(findings, 'MTR-SUB-004', 'seatConfig is required for SEAT_BASED direct subscription contracts.', 'seatConfig', ['subscriptions-seats', 'packages-contracts']);
    } else {
      if (!hasValue(seatConfig.seatGroupKey)) {
        add(findings, 'MTR-SUB-004', 'seatConfig.seatGroupKey is required for SEAT_BASED subscriptions.', 'seatConfig.seatGroupKey', ['subscriptions-seats']);
      } else if (!isSafeIdentifier(seatConfig.seatGroupKey)) {
        add(findings, 'MTR-SUB-004', 'seatConfig.seatGroupKey must be a safe identifier.', 'seatConfig.seatGroupKey', ['validation']);
      }
      if (!Array.isArray(seatConfig.initialSeatIds) || seatConfig.initialSeatIds.length === 0) {
        add(findings, 'MTR-SUB-004', 'seatConfig.initialSeatIds must be a non-empty array for direct SEAT_BASED contracts.', 'seatConfig.initialSeatIds', ['subscriptions-seats', 'packages-contracts']);
      } else {
        seatConfig.initialSeatIds.forEach((seatId, index) => {
          if (!isSafeIdentifier(seatId)) {
            add(findings, 'MTR-SUB-004', 'Every initial seat id must be a safe identifier.', `seatConfig.initialSeatIds[${index}]`, ['validation', 'subscriptions-seats']);
          }
        });
      }
    }
    if (hasValue(input.initialQuantity)) {
      add(findings, 'MTR-SUB-004', 'initialQuantity is forbidden for SEAT_BASED direct subscription contracts.', 'initialQuantity', ['subscriptions-seats']);
    }
    if (input.quantityUpdates) {
      add(findings, 'MTR-SUB-004', 'quantityUpdates are forbidden for SEAT_BASED subscriptions; use seat_updates after contract creation.', 'quantityUpdates', ['subscriptions-seats']);
    }
  }

  if (input.billingProvider?.verified !== true) {
    add(findings, 'MTR-BILL-001', 'billingProvider.verified must be true before planning a billable subscription contract.', 'billingProvider.verified', ['gotchas', 'stripe-delivery']);
  }

  if (input.invoiceBehavior !== 'subscription_invoices_expected') {
    add(findings, 'MTR-SUB-001', 'invoiceBehavior must be subscription_invoices_expected for this shape.', 'invoiceBehavior', ['shape-catalog', 'subscriptions-seats']);
  }

  if (!['push_to_stripe', 'leave_draft'].includes(input.stripeBehavior)) {
    add(findings, 'MTR-BILL-004', 'stripeBehavior must be push_to_stripe or leave_draft for subscription contracts.', 'stripeBehavior', ['gotchas', 'stripe-delivery']);
  }

  const verificationPlan = isPlainObject(input.verificationPlan) ? input.verificationPlan : null;
  if (!verificationPlan) {
    add(findings, 'MTR-VERIFY-001', 'verificationPlan is required for direct subscription contracts.', 'verificationPlan', ['shape-catalog']);
  } else {
    if (verificationPlan.contractReadback !== true) {
      add(findings, 'MTR-VERIFY-001', 'verificationPlan.contractReadback must be true.', 'verificationPlan.contractReadback', ['endpoint-matrix', 'packages-contracts']);
    }
    if (verificationPlan.rateScheduleReadback !== true) {
      add(findings, 'MTR-VERIFY-001', 'verificationPlan.rateScheduleReadback must be true.', 'verificationPlan.rateScheduleReadback', ['endpoint-matrix', 'pricing-catalog']);
    }
    if (verificationPlan.subscriptionHistoryReadback !== true) {
      add(findings, 'MTR-VERIFY-001', 'verificationPlan.subscriptionHistoryReadback must be true.', 'verificationPlan.subscriptionHistoryReadback', ['endpoint-matrix', 'subscriptions-seats']);
    }
    if (verificationPlan.billingProviderReadback !== true) {
      add(findings, 'MTR-BILL-004', 'verificationPlan.billingProviderReadback must be true to support the declared Stripe behavior.', 'verificationPlan.billingProviderReadback', ['stripe-delivery']);
    }
  }

  if (!hasValue(input.rollbackPlan)) {
    add(findings, 'MTR-VERIFY-002', 'rollbackPlan is required for any future direct subscription contract apply.', 'rollbackPlan', ['validation', 'safety']);
  }

  for (const [field, message] of [
    ['packageAlias', 'packageAlias is forbidden for this direct contract shape.'],
    ['packageId', 'packageId is forbidden for this direct contract shape.'],
    ['unsupportedSubscriptionFields', 'Unsupported subscription fields are forbidden in this local preview shape.'],
    ['overrideWithoutBillingFrequency', 'Overrides must include product_id and billing_frequency; unsupported override shortcuts are forbidden.'],
  ]) {
    if (input[field]) {
      add(findings, field === 'overrideWithoutBillingFrequency' ? 'MTR-SUB-003' : 'MTR-SUB-001', message, field, ['subscriptions-seats', 'packages-contracts']);
    }
  }
}

function validateCustomContractCommitSpec(spec, findings, basePath, { requireCadence = false } = {}, options = {}) {
  if (!isPlainObject(spec)) {
    add(findings, 'MTR-CUSTOM-003', `${basePath} must be an object.`, basePath, ['custom-contract-schema']);
    return;
  }

  if (!hasValue(spec.name)) {
    add(findings, 'MTR-CUSTOM-003', `${basePath}.name is required.`, `${basePath}.name`, ['custom-contract-schema']);
  }

  if (!hasValue(spec.productId)) {
    add(findings, 'MTR-CUSTOM-003', `${basePath}.productId is required so the commit product is explicit.`, `${basePath}.productId`, ['custom-contract-payloads']);
  } else if (!isSafeIdentifier(spec.productId)) {
    add(findings, 'MTR-CUSTOM-003', `${basePath}.productId must be a safe Metronome product identifier.`, `${basePath}.productId`, ['validation']);
  }

  if (!hasValue(spec.accessCreditTypeId)) {
    add(findings, 'MTR-CREDIT-001', `${basePath}.accessCreditTypeId is required for access_schedule.`, `${basePath}.accessCreditTypeId`, ['conventions', 'custom-contract-payloads']);
  } else if (!isSafeIdentifier(spec.accessCreditTypeId)) {
    add(findings, 'MTR-CREDIT-001', `${basePath}.accessCreditTypeId must be a safe credit type identifier.`, `${basePath}.accessCreditTypeId`, ['validation']);
  }

  if (!isPositiveInteger(spec.accessAmount)) {
    add(findings, 'MTR-CUSTOM-003', `${basePath}.accessAmount must be a positive integer.`, `${basePath}.accessAmount`, ['custom-contract-schema']);
  }

  if (!isPositiveInteger(spec.invoiceAmountCents)) {
    add(findings, 'MTR-CREDIT-004', `${basePath}.invoiceAmountCents must be a positive integer for a billable custom contract.`, `${basePath}.invoiceAmountCents`, ['custom-contract-schema']);
  }

  if (!hasValue(spec.invoiceCreditTypeId)) {
    add(findings, 'MTR-CREDIT-002', `${basePath}.invoiceCreditTypeId is required for billable custom-contract invoice amounts.`, `${basePath}.invoiceCreditTypeId`, ['conventions', 'custom-contract-payloads']);
  } else if (isAccessCreditType(spec.invoiceCreditTypeId, spec, options)) {
    add(findings, 'MTR-CREDIT-002', `${basePath}.invoiceCreditTypeId must be fiat, not the access credit type.`, `${basePath}.invoiceCreditTypeId`, ['danger-zone', 'conventions']);
  } else if (spec.invoiceCreditTypeId !== USD_CREDIT_TYPE_ID) {
    add(findings, 'MTR-CREDIT-002', 'Only USD cents is currently allowlisted by this validator for custom-contract invoice amounts.', `${basePath}.invoiceCreditTypeId`, ['conventions']);
  }

  if (requireCadence && !CUSTOM_CONTRACT_CADENCES.has(spec.cadence)) {
    add(findings, 'MTR-CUSTOM-003', `${basePath}.cadence must be monthly or annual for the recurring commit.`, `${basePath}.cadence`, ['custom-contract-payloads']);
  }

  if (spec.rolloverFraction !== undefined && !isNumberInRange(spec.rolloverFraction, 0, 1)) {
    add(findings, 'MTR-CUSTOM-003', `${basePath}.rolloverFraction must be between 0 and 1 when provided.`, `${basePath}.rolloverFraction`, ['custom-contract-schema']);
  }

  if (spec.priority !== undefined && !isPositiveInteger(spec.priority)) {
    add(findings, 'MTR-CUSTOM-003', `${basePath}.priority must be a positive integer when provided.`, `${basePath}.priority`, ['custom-contract-schema']);
  }

  if (!isNonEmptyStringArray(spec.applicableProductTags)) {
    add(findings, 'MTR-CUSTOM-003', `${basePath}.applicableProductTags must list at least one product tag.`, `${basePath}.applicableProductTags`, ['custom-contract-schema']);
  }
}

function validateEnterpriseCustomContract(input, findings, options) {
  validateCustomerExternalId(input, findings, 'MTR-CUSTOM-001');

  if (!hasValue(input.companyName)) {
    add(findings, 'MTR-CUSTOM-001', 'companyName is required for customer identity and audit context.', 'companyName', ['custom-contract-schema']);
  }

  const hasExistingCustomer = hasValue(input.metronomeCustomerId);
  if (hasExistingCustomer && !isSafeIdentifier(input.metronomeCustomerId)) {
    add(findings, 'MTR-CUSTOM-001', 'metronomeCustomerId must be a single safe Metronome customer identifier.', 'metronomeCustomerId', ['validation']);
  }
  if (!hasExistingCustomer && input.createMetronomeCustomer !== true) {
    add(findings, 'MTR-CUSTOM-001', 'Provide metronomeCustomerId or set createMetronomeCustomer true before preview.', 'metronomeCustomerId', ['custom-contract-schema', 'safety']);
  }
  if (hasExistingCustomer && input.createMetronomeCustomer === true) {
    add(findings, 'MTR-CUSTOM-001', 'Do not set createMetronomeCustomer true when metronomeCustomerId is already provided.', 'createMetronomeCustomer', ['custom-contract-schema']);
  }

  if (input.contractType !== 'direct') {
    add(findings, 'MTR-CUSTOM-002', 'The local custom-contract preview currently supports contractType direct only.', 'contractType', ['custom-contract-schema', 'shape-catalog']);
  }

  if (input.cutoverChoice && input.cutoverChoice !== 'explicit') {
    add(findings, 'MTR-CUSTOM-002', 'custom-contract preview requires explicitStartingAt; dynamic current_hour and next_hour cutovers are not used for deterministic CLI hashes.', 'cutoverChoice', ['custom-contract-payloads']);
  }

  if (!hasValue(input.explicitStartingAt)) {
    add(findings, 'MTR-RATE-004', 'explicitStartingAt is required for custom-contract preview.', 'explicitStartingAt', ['custom-contract-schema']);
  } else if (!isHourBoundaryUTC(input.explicitStartingAt)) {
    add(findings, 'MTR-TIME-001', 'explicitStartingAt must be a UTC hour-boundary timestamp.', 'explicitStartingAt', ['conventions', 'custom-contract-schema']);
  } else if (Date.parse(input.explicitStartingAt) <= Date.parse(options.now)) {
    add(findings, 'MTR-INV-001', 'explicitStartingAt is not in the future; scheduled custom-contract invoices may finalize immediately.', 'explicitStartingAt', ['danger-zone', 'custom-contract-payloads']);
  }

  if (input.noExpiry === true && hasValue(input.endingBefore)) {
    add(findings, 'MTR-CUSTOM-003', 'Use either noExpiry true or endingBefore, not both.', 'endingBefore', ['custom-contract-schema']);
  }
  if (input.noExpiry !== true) {
    if (!hasValue(input.endingBefore)) {
      add(findings, 'MTR-CUSTOM-003', 'endingBefore is required unless noExpiry is true.', 'endingBefore', ['custom-contract-schema']);
    } else if (!isHourBoundaryUTC(input.endingBefore)) {
      add(findings, 'MTR-TIME-001', 'endingBefore must be a UTC hour-boundary timestamp.', 'endingBefore', ['conventions']);
    } else if (hasValue(input.explicitStartingAt) && isHourBoundaryUTC(input.explicitStartingAt)
      && Date.parse(input.endingBefore) <= Date.parse(input.explicitStartingAt)) {
      add(findings, 'MTR-CUSTOM-003', 'endingBefore must be after explicitStartingAt.', 'endingBefore', ['custom-contract-schema']);
    }
  }

  if (!hasValue(input.rateCardId)) {
    add(findings, 'MTR-CUSTOM-003', 'rateCardId is required for direct custom contracts.', 'rateCardId', ['custom-contract-schema']);
  } else if (!isSafeIdentifier(input.rateCardId)) {
    add(findings, 'MTR-CUSTOM-003', 'rateCardId must be a safe Metronome rate-card identifier.', 'rateCardId', ['validation']);
  }

  if (!hasValue(input.uniquenessKey)) {
    add(findings, 'MTR-IDEMP-001', 'uniquenessKey is required for idempotent custom contract creation.', 'uniquenessKey', ['custom-contract-payloads', 'conventions']);
  } else if (!isSafeIdentifier(input.uniquenessKey)) {
    add(findings, 'MTR-IDEMP-001', 'uniquenessKey must be a single safe deterministic key.', 'uniquenessKey', ['validation']);
  } else if (String(input.uniquenessKey).length > 128) {
    add(findings, 'MTR-IDEMP-001', 'uniquenessKey must be 128 characters or fewer.', 'uniquenessKey', ['custom-contract-schema']);
  }

  for (const field of ['packageAlias', 'packageId', 'packageTerms', 'newPackageRequest']) {
    if (input[field]) {
      add(findings, 'MTR-CUSTOM-002', `${field} is outside the local direct custom-contract preview shape.`, field, ['shape-catalog', 'custom-contract-schema']);
    }
  }

  if (input.billingProvider?.verified !== true) {
    add(findings, 'MTR-BILL-001', 'billingProvider.verified must be true before previewing an invoice-producing custom contract.', 'billingProvider.verified', ['custom-contract-schema', 'metronome-stripe-delivery']);
  }

  if (!hasValue(input.stripeCustomerId)) {
    add(findings, 'MTR-BILL-001', 'stripeCustomerId is required for billable custom contracts.', 'stripeCustomerId', ['custom-contract-schema']);
  } else if (!/^cus_[A-Za-z0-9]+$/.test(input.stripeCustomerId)) {
    add(findings, 'MTR-BILL-001', 'stripeCustomerId must look like a Stripe customer id beginning with cus_.', 'stripeCustomerId', ['custom-contract-schema']);
  }

  if (!hasValue(input.stripeDeliveryMethodId)) {
    add(findings, 'MTR-BILL-002', 'stripeDeliveryMethodId is required; this CLI does not read delivery method IDs from .env.', 'stripeDeliveryMethodId', ['custom-contract-payloads', 'gotchas']);
  } else if (!isSafeIdentifier(input.stripeDeliveryMethodId)) {
    add(findings, 'MTR-BILL-002', 'stripeDeliveryMethodId must be a safe delivery method identifier.', 'stripeDeliveryMethodId', ['validation']);
  }

  if (!['send_invoice', 'charge_automatically'].includes(input.stripeCollectionMethod)) {
    add(findings, 'MTR-BILL-004', 'stripeCollectionMethod must be send_invoice or charge_automatically.', 'stripeCollectionMethod', ['custom-contract-schema', 'metronome-stripe-delivery']);
  }

  if (typeof input.leaveStripeInvoicesInDraft !== 'boolean') {
    add(findings, 'MTR-BILL-004', 'leaveStripeInvoicesInDraft must be an explicit boolean.', 'leaveStripeInvoicesInDraft', ['custom-contract-schema', 'metronome-stripe-delivery']);
  }

  if (!CUSTOM_CONTRACT_STRIPE_BEHAVIORS.has(input.stripeBehavior)) {
    add(findings, 'MTR-BILL-004', 'stripeBehavior must be push_to_stripe or leave_draft for custom contracts.', 'stripeBehavior', ['custom-contract-schema', 'metronome-stripe-delivery']);
  }

  if (input.invoiceBehavior !== 'custom_contract_invoice_expected') {
    add(findings, 'MTR-CUSTOM-003', 'invoiceBehavior must be custom_contract_invoice_expected.', 'invoiceBehavior', ['shape-catalog', 'custom-contract-schema']);
  }

  validateCustomContractCommitSpec(input.baseCommit, findings, 'baseCommit', { requireCadence: true }, options);

  if (input.netPaymentTermsDays !== undefined && !isNonNegativeInteger(input.netPaymentTermsDays)) {
    add(findings, 'MTR-CUSTOM-003', 'netPaymentTermsDays must be a non-negative integer when provided.', 'netPaymentTermsDays', ['custom-contract-schema']);
  }

  if (input.bonusCommits !== undefined) {
    if (!Array.isArray(input.bonusCommits)) {
      add(findings, 'MTR-CUSTOM-003', 'bonusCommits must be an array when provided.', 'bonusCommits', ['custom-contract-schema']);
    } else {
      input.bonusCommits.forEach((commit, index) => {
        validateCustomContractCommitSpec(commit, findings, `bonusCommits[${index}]`, {}, options);
      });
      if (input.bonusCommits.length > 0 && input.duplicateCommitNameChecked !== true) {
        add(findings, 'MTR-IDEMP-003', 'duplicateCommitNameChecked must be true before planning bonus add_commits on a custom contract.', 'duplicateCommitNameChecked', ['danger-zone', 'custom-contract-payloads']);
      }
    }
  }

  const seatLimitMode = input.seatLimitMode || 'none';
  if (!CUSTOM_CONTRACT_SEAT_LIMIT_MODES.has(seatLimitMode)) {
    add(findings, 'MTR-CUSTOM-002', 'seatLimitMode must be none or seat_based in the local custom-contract preview.', 'seatLimitMode', ['custom-contract-schema']);
  } else if (seatLimitMode === 'seat_based') {
    const seatLimits = isPlainObject(input.seatLimits) ? input.seatLimits : null;
    if (!seatLimits) {
      add(findings, 'MTR-SUB-004', 'seatLimits is required when seatLimitMode is seat_based.', 'seatLimits', ['custom-contract-schema']);
    } else {
      if (!hasValue(seatLimits.seatProductId)) {
        add(findings, 'MTR-SUB-003', 'seatLimits.seatProductId is required for the seat subscription line.', 'seatLimits.seatProductId', ['custom-contract-payloads']);
      } else if (!isSafeIdentifier(seatLimits.seatProductId)) {
        add(findings, 'MTR-SUB-003', 'seatLimits.seatProductId must be a safe product identifier.', 'seatLimits.seatProductId', ['validation']);
      }
      if (!hasValue(seatLimits.seatGroupKey)) {
        add(findings, 'MTR-SUB-004', 'seatLimits.seatGroupKey is required for seat-based contracts.', 'seatLimits.seatGroupKey', ['custom-contract-payloads']);
      } else if (!isSafeIdentifier(seatLimits.seatGroupKey)) {
        add(findings, 'MTR-SUB-004', 'seatLimits.seatGroupKey must be a safe identifier.', 'seatLimits.seatGroupKey', ['validation']);
      }
      if (!Array.isArray(seatLimits.initialSeatIds) || seatLimits.initialSeatIds.length === 0) {
        add(findings, 'MTR-SUB-004', 'seatLimits.initialSeatIds must be a non-empty array.', 'seatLimits.initialSeatIds', ['custom-contract-schema']);
      } else {
        seatLimits.initialSeatIds.forEach((seatId, index) => {
          if (!isSafeIdentifier(seatId)) {
            add(findings, 'MTR-SUB-004', 'Every initial seat id must be a safe identifier.', `seatLimits.initialSeatIds[${index}]`, ['validation']);
          }
        });
      }
      if (seatLimits.subscriptionBillingFrequency !== undefined
        && !SUBSCRIPTION_BILLING_FREQUENCIES.has(seatLimits.subscriptionBillingFrequency)) {
        add(findings, 'MTR-SUB-002', 'seatLimits.subscriptionBillingFrequency must be MONTHLY, QUARTERLY, SEMI_ANNUAL, or ANNUAL when provided.', 'seatLimits.subscriptionBillingFrequency', ['custom-contract-payloads']);
      }
    }
  } else if (input.seatLimits !== undefined) {
    add(findings, 'MTR-CUSTOM-002', 'seatLimits must be omitted when seatLimitMode is none.', 'seatLimits', ['custom-contract-schema']);
  }

  const verificationPlan = isPlainObject(input.verificationPlan) ? input.verificationPlan : null;
  if (!verificationPlan) {
    add(findings, 'MTR-VERIFY-001', 'verificationPlan is required for custom-contract read-back.', 'verificationPlan', ['shape-catalog', 'custom-contract-schema']);
  } else {
    if (verificationPlan.customerReadback !== true) {
      add(findings, 'MTR-VERIFY-001', 'verificationPlan.customerReadback must be true.', 'verificationPlan.customerReadback', ['endpoint-matrix']);
    }
    if (verificationPlan.contractReadback !== true) {
      add(findings, 'MTR-VERIFY-001', 'verificationPlan.contractReadback must be true.', 'verificationPlan.contractReadback', ['endpoint-matrix']);
    }
    if (verificationPlan.balanceReadback !== true) {
      add(findings, 'MTR-VERIFY-001', 'verificationPlan.balanceReadback must be true.', 'verificationPlan.balanceReadback', ['endpoint-matrix']);
    }
    if (verificationPlan.invoiceReadback !== true) {
      add(findings, 'MTR-VERIFY-001', 'verificationPlan.invoiceReadback must be true.', 'verificationPlan.invoiceReadback', ['endpoint-matrix', 'metronome-invoicing']);
    }
    if (verificationPlan.billingProviderReadback !== true) {
      add(findings, 'MTR-BILL-004', 'verificationPlan.billingProviderReadback must be true to support Stripe behavior.', 'verificationPlan.billingProviderReadback', ['metronome-stripe-delivery']);
    }
    if (seatLimitMode === 'seat_based' && verificationPlan.subscriptionHistoryReadback !== true) {
      add(findings, 'MTR-SUB-004', 'verificationPlan.subscriptionHistoryReadback must be true for seat-based custom contracts.', 'verificationPlan.subscriptionHistoryReadback', ['endpoint-matrix']);
    }
  }

  if (!hasValue(input.rollbackPlan)) {
    add(findings, 'MTR-VERIFY-002', 'rollbackPlan is required for any future custom-contract apply.', 'rollbackPlan', ['custom-contract-schema', 'safety']);
  }
}

function validateProductRateRetirement(input, findings) {
  if (!hasValue(input.productId)) {
    add(findings, 'MTR-RATE-003', 'productId is required for product/rate retirement.', 'productId', ['shape-catalog', 'danger-zone']);
  } else if (!isSafeIdentifier(input.productId)) {
    add(findings, 'MTR-RATE-003', 'productId must be a single safe Metronome product identifier.', 'productId', ['validation']);
  }

  validateStartingAt(input, findings);

  if (input.retireRatesFirst !== true) {
    add(findings, 'MTR-RATE-003', 'retireRatesFirst must be true before any product archive can be planned.', 'retireRatesFirst', ['danger-zone', 'endpoint-matrix']);
  }

  if (typeof input.archiveProductAfterRatesClose !== 'boolean') {
    add(findings, 'MTR-RATE-003', 'archiveProductAfterRatesClose must be an explicit boolean.', 'archiveProductAfterRatesClose', ['shape-catalog', 'danger-zone']);
  }

  if (input.archiveProductAfterRatesClose === true && input.retireRatesFirst !== true) {
    add(findings, 'MTR-RATE-003', 'Product archive cannot be planned before rate entries are closed.', 'archiveProductAfterRatesClose', ['danger-zone', 'endpoint-matrix']);
  }

  for (const field of ['archiveOnly', 'archiveProductBeforeRatesClose', 'removeRateEndpoint']) {
    if (input[field] === true) {
      add(findings, 'MTR-RATE-003', `${field} is forbidden; product retirement must use addRates close entries before archive.`, field, ['danger-zone', 'endpoint-matrix']);
    }
  }

  if (input.invoiceImpactReviewed !== true) {
    add(findings, 'MTR-RATE-003', 'invoiceImpactReviewed must be true because existing contracts and invoices can still show retired product rates.', 'invoiceImpactReviewed', ['shape-catalog', 'danger-zone']);
  }

  if (!Array.isArray(input.affectedRateCards) || input.affectedRateCards.length === 0) {
    add(findings, 'MTR-RATE-003', 'affectedRateCards must list every rate card where this product has an active rate.', 'affectedRateCards', ['shape-catalog', 'danger-zone']);
  } else {
    input.affectedRateCards.forEach((card, index) => {
      const basePath = `affectedRateCards[${index}]`;
      if (!isPlainObject(card)) {
        add(findings, 'MTR-RATE-003', 'Each affectedRateCards entry must be an object.', basePath, ['shape-catalog']);
        return;
      }

      if (!hasValue(card.rateCardId)) {
        add(findings, 'MTR-RATE-003', 'rateCardId is required for every affected rate card.', `${basePath}.rateCardId`, ['shape-catalog', 'endpoint-matrix']);
      } else if (!isSafeIdentifier(card.rateCardId)) {
        add(findings, 'MTR-RATE-003', 'rateCardId must be a single safe Metronome rate-card identifier.', `${basePath}.rateCardId`, ['validation']);
      }

      if (card.activeRateEntitled !== true) {
        add(findings, 'MTR-RATE-001', 'activeRateEntitled must be true to prove this card has an open entitled rate that needs closure.', `${basePath}.activeRateEntitled`, ['danger-zone']);
      }

      if (card.closeWithEntitled !== false) {
        add(findings, 'MTR-RATE-001', 'closeWithEntitled must be false for retired product rates.', `${basePath}.closeWithEntitled`, ['danger-zone', 'endpoint-matrix']);
      }

      if (card.closeWithPriceCents !== 0) {
        add(findings, 'MTR-RATE-003', 'closeWithPriceCents must be 0 for the canonical retired-rate close entry.', `${basePath}.closeWithPriceCents`, ['danger-zone', 'endpoint-matrix']);
      }

      if (hasValue(card.rateType) && !isSafeIdentifier(card.rateType)) {
        add(findings, 'MTR-RATE-003', 'rateType must be a safe Metronome rate type token.', `${basePath}.rateType`, ['validation']);
      }
    });
  }

  const verificationPlan = isPlainObject(input.verificationPlan) ? input.verificationPlan : null;
  if (!verificationPlan) {
    add(findings, 'MTR-VERIFY-001', 'verificationPlan is required for product/rate retirement.', 'verificationPlan', ['shape-catalog', 'danger-zone']);
  } else {
    if (verificationPlan.rateScheduleReadback !== true) {
      add(findings, 'MTR-VERIFY-001', 'verificationPlan.rateScheduleReadback must be true.', 'verificationPlan.rateScheduleReadback', ['endpoint-matrix', 'danger-zone']);
    }
    if (input.archiveProductAfterRatesClose === true && verificationPlan.productArchiveReadback !== true) {
      add(findings, 'MTR-VERIFY-001', 'verificationPlan.productArchiveReadback must be true when product archive is planned.', 'verificationPlan.productArchiveReadback', ['endpoint-matrix', 'danger-zone']);
    }
    if (verificationPlan.invoicePreviewOrReadback !== true) {
      add(findings, 'MTR-VERIFY-001', 'verificationPlan.invoicePreviewOrReadback must be true because product rates can affect invoices after cutover.', 'verificationPlan.invoicePreviewOrReadback', ['shape-catalog', 'danger-zone']);
    }
  }

  if (!hasValue(input.rollbackPlan)) {
    add(findings, 'MTR-VERIFY-002', 'rollbackPlan is required for any future product/rate retirement apply.', 'rollbackPlan', ['validation', 'safety']);
  }
}

function validatePackageAliasArchiveHandoff(input, findings, options) {
  if (!hasValue(input.oldPackageId)) {
    add(findings, 'MTR-PKG-001', 'oldPackageId is required so archive uses a specific old package version, not an alias.', 'oldPackageId', ['shape-catalog', 'endpoint-matrix']);
  } else if (!isSafeIdentifier(input.oldPackageId)) {
    add(findings, 'MTR-PKG-001', 'oldPackageId must be a single safe Metronome package identifier.', 'oldPackageId', ['validation']);
  }

  if (!hasValue(input.packageAlias)) {
    add(findings, 'MTR-PKG-001', 'packageAlias is required for package archive handoff validation.', 'packageAlias', ['shape-catalog']);
  } else if (!isSafeIdentifier(input.packageAlias)) {
    add(findings, 'MTR-PKG-001', 'packageAlias must be a single safe package alias.', 'packageAlias', ['validation']);
  }

  if (!hasValue(input.replacementPackageId)) {
    add(findings, 'MTR-PKG-004', 'replacementPackageId is required to prove the alias resolves away from the old package.', 'replacementPackageId', ['shape-catalog', 'gotchas']);
  } else if (!isSafeIdentifier(input.replacementPackageId)) {
    add(findings, 'MTR-PKG-004', 'replacementPackageId must be a single safe Metronome package identifier.', 'replacementPackageId', ['validation']);
  }

  if (hasValue(input.oldPackageId) && hasValue(input.replacementPackageId) && input.oldPackageId === input.replacementPackageId) {
    add(findings, 'MTR-PKG-004', 'replacementPackageId must differ from oldPackageId.', 'replacementPackageId', ['gotchas']);
  }

  if (!hasValue(input.replacementPackageAlias)) {
    add(findings, 'MTR-PKG-004', 'replacementPackageAlias is required to prove the replacement owns the same alias.', 'replacementPackageAlias', ['shape-catalog', 'gotchas']);
  } else if (!isSafeIdentifier(input.replacementPackageAlias)) {
    add(findings, 'MTR-PKG-004', 'replacementPackageAlias must be a single safe package alias.', 'replacementPackageAlias', ['validation']);
  } else if (hasValue(input.packageAlias) && input.replacementPackageAlias !== input.packageAlias) {
    add(findings, 'MTR-PKG-004', 'replacementPackageAlias must match packageAlias before the old version can be archived.', 'replacementPackageAlias', ['gotchas']);
  }

  if (!hasValue(input.replacementAliasLiveAt)) {
    add(findings, 'MTR-TIME-004', 'replacementAliasLiveAt is required before archiving the old package version.', 'replacementAliasLiveAt', ['gotchas', 'endpoint-matrix']);
  } else if (!isHourBoundaryUTC(input.replacementAliasLiveAt)) {
    add(findings, 'MTR-TIME-001', 'replacementAliasLiveAt must be a UTC hour-boundary timestamp.', 'replacementAliasLiveAt', ['validation', 'conventions']);
  } else if (Date.parse(input.replacementAliasLiveAt) > Date.parse(options.now)) {
    add(findings, 'MTR-TIME-004', 'replacementAliasLiveAt is still in the future; the alias handoff is not live yet.', 'replacementAliasLiveAt', ['gotchas', 'endpoint-matrix']);
  }

  if (input.aliasLiveVerified !== true) {
    add(findings, 'MTR-TIME-004', 'aliasLiveVerified must be true before package archive can be previewed.', 'aliasLiveVerified', ['gotchas', 'endpoint-matrix']);
  }

  if (input.replacementPackageReadbackVerified !== true) {
    add(findings, 'MTR-VERIFY-001', 'replacementPackageReadbackVerified must be true before package archive can be previewed.', 'replacementPackageReadbackVerified', ['endpoint-matrix']);
  }

  if (input.contractsOnOldPackageReviewed !== true) {
    add(findings, 'MTR-VERIFY-001', 'contractsOnOldPackageReviewed must be true before package archive can be previewed.', 'contractsOnOldPackageReviewed', ['endpoint-matrix', 'gotchas']);
  }

  const verificationPlan = isPlainObject(input.verificationPlan) ? input.verificationPlan : null;
  if (!verificationPlan) {
    add(findings, 'MTR-VERIFY-001', 'verificationPlan is required for package archive handoff.', 'verificationPlan', ['shape-catalog', 'endpoint-matrix']);
  } else {
    if (verificationPlan.oldPackageArchiveReadback !== true) {
      add(findings, 'MTR-VERIFY-001', 'verificationPlan.oldPackageArchiveReadback must be true.', 'verificationPlan.oldPackageArchiveReadback', ['endpoint-matrix']);
    }
    if (verificationPlan.replacementAliasReadback !== true) {
      add(findings, 'MTR-VERIFY-001', 'verificationPlan.replacementAliasReadback must be true.', 'verificationPlan.replacementAliasReadback', ['endpoint-matrix', 'gotchas']);
    }
    if (verificationPlan.contractsOnOldPackageReviewed !== true) {
      add(findings, 'MTR-VERIFY-001', 'verificationPlan.contractsOnOldPackageReviewed must be true.', 'verificationPlan.contractsOnOldPackageReviewed', ['endpoint-matrix', 'gotchas']);
    }
  }

  if (!hasValue(input.rollbackPlan)) {
    add(findings, 'MTR-VERIFY-002', 'rollbackPlan is required for any future package archive apply.', 'rollbackPlan', ['validation', 'safety']);
  }

  const forbidden = [
    ['archiveBeforeAliasLive', 'Archiving before alias live evidence is forbidden.'],
    ['skipAliasVerification', 'Skipping alias verification is forbidden for package archive handoff.'],
    ['archiveByAlias', 'Archive must target oldPackageId; archiving by alias is forbidden.'],
  ];

  for (const [field, message] of forbidden) {
    if (input[field] === true) {
      add(findings, field === 'archiveByAlias' ? 'MTR-PKG-001' : 'MTR-TIME-004', message, field, ['gotchas', 'endpoint-matrix']);
    }
  }
}

function validateInvoiceIssueDateUpdate(input, findings, options) {
  if (!hasValue(input.customerId)) {
    add(findings, 'MTR-BILL-001', 'customerId is required so billing-provider and invoice read-back plans are customer-scoped.', 'customerId', ['shape-catalog']);
  } else if (!isSafeIdentifier(input.customerId)) {
    add(findings, 'MTR-BILL-001', 'customerId must be a single safe Metronome customer identifier.', 'customerId', ['validation']);
  }

  if (!hasValue(input.contractId)) {
    add(findings, 'MTR-VERIFY-001', 'contractId is required so contract end evidence can be tied to this invoice.', 'contractId', ['shape-catalog', 'endpoint-matrix']);
  } else if (!isSafeIdentifier(input.contractId)) {
    add(findings, 'MTR-VERIFY-001', 'contractId must be a single safe Metronome contract identifier.', 'contractId', ['validation']);
  }

  if (!hasValue(input.invoiceId)) {
    add(findings, 'MTR-INV-004', 'invoiceId is required for updateInvoiceIssueDate.', 'invoiceId', ['official-invoice-issue-date', 'shape-catalog']);
  } else if (!isSafeIdentifier(input.invoiceId)) {
    add(findings, 'MTR-INV-004', 'invoiceId must be a single safe Metronome invoice identifier.', 'invoiceId', ['validation']);
  }

  if (input.currentInvoiceStatus !== 'DRAFT') {
    add(findings, 'MTR-INV-004', 'updateInvoiceIssueDate is only supported for invoices with currentInvoiceStatus DRAFT.', 'currentInvoiceStatus', ['official-invoice-issue-date', 'metronome-invoicing']);
  }

  if (!hasValue(input.currentIssueDate)) {
    add(findings, 'MTR-INV-004', 'currentIssueDate is required to prove the edit pushes the draft invoice date forward.', 'currentIssueDate', ['metronome-invoicing']);
  } else if (!isHourBoundaryUTC(input.currentIssueDate)) {
    add(findings, 'MTR-TIME-001', 'currentIssueDate must be a UTC hour-boundary timestamp.', 'currentIssueDate', ['validation', 'conventions']);
  }

  if (!hasValue(input.targetIssueDate)) {
    add(findings, 'MTR-INV-004', 'targetIssueDate is required for updateInvoiceIssueDate.', 'targetIssueDate', ['official-invoice-issue-date']);
  } else if (!isHourBoundaryUTC(input.targetIssueDate)) {
    add(findings, 'MTR-TIME-001', 'targetIssueDate must be a UTC hour-boundary timestamp.', 'targetIssueDate', ['official-invoice-issue-date', 'conventions']);
  }

  if (isHourBoundaryUTC(input.currentIssueDate) && isHourBoundaryUTC(input.targetIssueDate)
    && Date.parse(input.targetIssueDate) <= Date.parse(input.currentIssueDate)) {
    add(findings, 'MTR-INV-004', 'targetIssueDate must move the draft invoice issue date forward.', 'targetIssueDate', ['metronome-invoicing']);
  }

  if (isHourBoundaryUTC(input.targetIssueDate) && Date.parse(input.targetIssueDate) <= Date.parse(options.now)) {
    add(findings, 'MTR-INV-001', 'targetIssueDate is not in the future; invoice finalization or delivery timing may not be deferred.', 'targetIssueDate', ['danger-zone', 'metronome-invoicing']);
  }

  const hasContractEnd = hasValue(input.contractEndingBefore);
  if (hasContractEnd && input.contractHasNoEndDate === true) {
    add(findings, 'MTR-VERIFY-001', 'Use either contractEndingBefore or contractHasNoEndDate, not both.', 'contractEndingBefore', ['shape-catalog']);
  } else if (!hasContractEnd && input.contractHasNoEndDate !== true) {
    add(findings, 'MTR-VERIFY-001', 'Provide contractEndingBefore or contractHasNoEndDate:true after contract read-back.', 'contractEndingBefore', ['official-invoice-issue-date', 'shape-catalog']);
  }

  if (hasContractEnd) {
    if (!isHourBoundaryUTC(input.contractEndingBefore)) {
      add(findings, 'MTR-TIME-001', 'contractEndingBefore must be a UTC hour-boundary timestamp.', 'contractEndingBefore', ['validation', 'conventions']);
    } else if (isHourBoundaryUTC(input.targetIssueDate)
      && Date.parse(input.targetIssueDate) >= Date.parse(input.contractEndingBefore)) {
      add(findings, 'MTR-INV-004', 'targetIssueDate cannot be on or after the contract end.', 'targetIssueDate', ['official-invoice-issue-date']);
    }
  }

  if (input.invoiceReadbackVerified !== true) {
    add(findings, 'MTR-VERIFY-001', 'invoiceReadbackVerified must be true before planning an issue-date edit.', 'invoiceReadbackVerified', ['endpoint-matrix', 'metronome-invoicing']);
  }

  if (input.contractEndVerified !== true) {
    add(findings, 'MTR-VERIFY-001', 'contractEndVerified must be true before planning an issue-date edit.', 'contractEndVerified', ['official-invoice-issue-date', 'endpoint-matrix']);
  }

  if (input.billingProvider?.verified !== true) {
    add(findings, 'MTR-BILL-001', 'billingProvider.verified must be true before planning an invoice issue-date edit.', 'billingProvider.verified', ['metronome-stripe-delivery', 'shape-catalog']);
  }

  if (!INVOICE_ISSUE_DATE_STRIPE_BEHAVIORS.has(input.stripeBehavior)) {
    add(findings, 'MTR-INV-004', 'stripeBehavior must be defer_until_new_issue_date, remain_draft_for_manual_review, or no_stripe_delivery_expected.', 'stripeBehavior', ['gotchas', 'metronome-stripe-delivery']);
  }

  const verificationPlan = isPlainObject(input.verificationPlan) ? input.verificationPlan : null;
  if (!verificationPlan) {
    add(findings, 'MTR-VERIFY-001', 'verificationPlan is required for invoice issue-date updates.', 'verificationPlan', ['shape-catalog']);
  } else {
    if (verificationPlan.invoiceReadback !== true) {
      add(findings, 'MTR-VERIFY-001', 'verificationPlan.invoiceReadback must be true.', 'verificationPlan.invoiceReadback', ['endpoint-matrix', 'metronome-invoicing']);
    }
    if (verificationPlan.billingProviderReadback !== true) {
      add(findings, 'MTR-BILL-004', 'verificationPlan.billingProviderReadback must be true to support the declared Stripe behavior.', 'verificationPlan.billingProviderReadback', ['metronome-stripe-delivery']);
    }
    if (verificationPlan.stripeDeliveryReview !== true) {
      add(findings, 'MTR-INV-004', 'verificationPlan.stripeDeliveryReview must be true.', 'verificationPlan.stripeDeliveryReview', ['gotchas', 'metronome-stripe-delivery']);
    }
  }

  if (!hasValue(input.remediationPlan)) {
    add(findings, 'MTR-VERIFY-002', 'remediationPlan is required for any future invoice issue-date apply.', 'remediationPlan', ['validation', 'safety']);
  }

  const wrongEndpointSelected = input.useInvoiceEndpoint === true
    || input.invoiceEndpoint === true
    || input.endpointPath === '/v1/invoices/updateIssueDate';
  if (wrongEndpointSelected) {
    add(findings, 'MTR-ENDPOINT-002', 'Invoice issue-date updates must use /v1/contracts/updateInvoiceIssueDate, not an invoices/updateIssueDate path.', 'endpointPath', ['endpoint-matrix', 'official-invoice-issue-date']);
  } else if (hasValue(input.endpointPath) && input.endpointPath !== '/v1/contracts/updateInvoiceIssueDate') {
    add(findings, 'MTR-ENDPOINT-002', 'endpointPath must be /v1/contracts/updateInvoiceIssueDate for this shape.', 'endpointPath', ['endpoint-matrix', 'official-invoice-issue-date']);
  }

  for (const [field, message] of [
    ['finalizedInvoice', 'Finalized invoices are forbidden for issue-date updates.'],
    ['paidInvoice', 'Paid invoices are forbidden for issue-date updates.'],
    ['voidedInvoice', 'Voided invoices are forbidden for issue-date updates.'],
    ['manualFinalize', 'Manual invoice finalization is forbidden in this local issue-date preview shape.'],
  ]) {
    if (input[field] === true) {
      add(findings, 'MTR-INV-004', message, field, ['official-invoice-issue-date', 'metronome-invoicing']);
    }
  }
}

function validateUsageIngestPreview(input, findings) {
  if (!hasValue(input.customerId)) {
    add(findings, 'MTR-USAGE-002', 'customerId is required so previewEvents and read-back are customer-scoped.', 'customerId', ['shape-catalog', 'endpoint-matrix']);
  } else if (!isSafeIdentifier(input.customerId)) {
    add(findings, 'MTR-USAGE-002', 'customerId must be a single safe Metronome customer identifier.', 'customerId', ['validation']);
  }

  if (!hasValue(input.expectedEventType)) {
    add(findings, 'MTR-USAGE-002', 'expectedEventType is required before validating event payloads.', 'expectedEventType', ['shape-catalog']);
  } else if (!isSafeIdentifier(input.expectedEventType)) {
    add(findings, 'MTR-USAGE-002', 'expectedEventType must be a safe event type identifier.', 'expectedEventType', ['validation']);
  }

  const events = Array.isArray(input.events) ? input.events : null;
  if (!events || events.length === 0) {
    add(findings, 'MTR-USAGE-002', 'events must be a non-empty array.', 'events', ['official-usage-ingest', 'endpoint-matrix']);
  } else if (events.length > MAX_USAGE_INGEST_BATCH_SIZE) {
    add(findings, 'MTR-USAGE-003', `events must contain ${MAX_USAGE_INGEST_BATCH_SIZE} or fewer events for one ingest batch.`, 'events', ['endpoint-matrix', 'official-usage-ingest']);
  }

  const allowedCustomerIds = new Set([input.customerId, ...((Array.isArray(input.allowedIngestAliases) ? input.allowedIngestAliases : []))].filter(Boolean));
  const transactionIds = new Set();
  if (events) {
    events.forEach((event, index) => {
      const eventPath = `events[${index}]`;
      if (!isPlainObject(event)) {
        add(findings, 'MTR-USAGE-002', 'Each event must be an object.', eventPath, ['official-usage-ingest']);
        return;
      }

      if (!hasValue(event.customer_id)) {
        add(findings, 'MTR-USAGE-002', 'event.customer_id is required.', `${eventPath}.customer_id`, ['official-usage-ingest']);
      } else if (!isSafeIdentifier(event.customer_id)) {
        add(findings, 'MTR-USAGE-002', 'event.customer_id must be a safe Metronome customer id or ingest alias.', `${eventPath}.customer_id`, ['validation']);
      } else if (allowedCustomerIds.size > 0 && !allowedCustomerIds.has(event.customer_id)) {
        add(findings, 'MTR-USAGE-002', 'event.customer_id must match customerId or an allowed ingest alias.', `${eventPath}.customer_id`, ['gotchas', 'shape-catalog']);
      }

      if (!hasValue(event.event_type)) {
        add(findings, 'MTR-USAGE-002', 'event.event_type is required.', `${eventPath}.event_type`, ['official-usage-ingest']);
      } else if (!isSafeIdentifier(event.event_type)) {
        add(findings, 'MTR-USAGE-002', 'event.event_type must be a safe identifier.', `${eventPath}.event_type`, ['validation']);
      } else if (hasValue(input.expectedEventType) && event.event_type !== input.expectedEventType) {
        add(findings, 'MTR-USAGE-002', 'event.event_type must match expectedEventType.', `${eventPath}.event_type`, ['gotchas', 'pro-slider-integration']);
      }

      if (!hasValue(event.transaction_id)) {
        add(findings, 'MTR-IDEMP-002', 'event.transaction_id is required for idempotent ingest retries.', `${eventPath}.transaction_id`, ['conventions', 'endpoint-matrix']);
      } else if (!isSafeIdentifier(event.transaction_id)) {
        add(findings, 'MTR-IDEMP-002', 'event.transaction_id must be a safe stable identifier.', `${eventPath}.transaction_id`, ['validation']);
      } else if (transactionIds.has(event.transaction_id)) {
        add(findings, 'MTR-IDEMP-002', 'event.transaction_id must be unique within the batch.', `${eventPath}.transaction_id`, ['conventions', 'gotchas']);
      } else {
        transactionIds.add(event.transaction_id);
      }

      if (!hasValue(event.timestamp)) {
        add(findings, 'MTR-USAGE-001', 'event.timestamp is required so invoice-period impact can be reviewed.', `${eventPath}.timestamp`, ['danger-zone', 'conventions']);
      } else if (!isIsoTimestampUTC(event.timestamp)) {
        add(findings, 'MTR-USAGE-001', 'event.timestamp must be an ISO UTC timestamp ending in Z.', `${eventPath}.timestamp`, ['conventions']);
      }

      const properties = isPlainObject(event.properties) ? event.properties : null;
      if (!properties) {
        add(findings, 'MTR-USAGE-002', 'event.properties is required for dimensional usage routing.', `${eventPath}.properties`, ['pro-slider-integration']);
      } else {
        const actionCodeField = input.actionCodeProperty || 'action_code';
        if (!hasValue(properties[actionCodeField])) {
          add(findings, 'MTR-USAGE-002', `event.properties.${actionCodeField} is required for dimensional usage routing.`, `${eventPath}.properties.${actionCodeField}`, ['pro-slider-integration']);
        } else if (!isSafeIdentifier(properties[actionCodeField])) {
          add(findings, 'MTR-USAGE-002', `event.properties.${actionCodeField} must be a safe action code.`, `${eventPath}.properties.${actionCodeField}`, ['validation']);
        }
      }
    });
  }

  const invoicePeriodTarget = isPlainObject(input.invoicePeriodTarget) ? input.invoicePeriodTarget : null;
  if (!invoicePeriodTarget) {
    add(findings, 'MTR-USAGE-003', 'invoicePeriodTarget is required before previewing usage ingest.', 'invoicePeriodTarget', ['gotchas', 'danger-zone']);
  } else {
    if (!isHourBoundaryUTC(invoicePeriodTarget.startingAt)) {
      add(findings, 'MTR-TIME-001', 'invoicePeriodTarget.startingAt must be a UTC hour-boundary timestamp.', 'invoicePeriodTarget.startingAt', ['conventions']);
    }
    if (!isHourBoundaryUTC(invoicePeriodTarget.endingBefore)) {
      add(findings, 'MTR-TIME-001', 'invoicePeriodTarget.endingBefore must be a UTC hour-boundary timestamp.', 'invoicePeriodTarget.endingBefore', ['conventions']);
    }
    if (isHourBoundaryUTC(invoicePeriodTarget.startingAt) && isHourBoundaryUTC(invoicePeriodTarget.endingBefore)
      && Date.parse(invoicePeriodTarget.endingBefore) <= Date.parse(invoicePeriodTarget.startingAt)) {
      add(findings, 'MTR-USAGE-003', 'invoicePeriodTarget.endingBefore must be after startingAt.', 'invoicePeriodTarget.endingBefore', ['validation']);
    }
    if (invoicePeriodTarget.finalizedPeriodReviewed !== true) {
      add(findings, 'MTR-USAGE-001', 'invoicePeriodTarget.finalizedPeriodReviewed must be true before historical usage preview.', 'invoicePeriodTarget.finalizedPeriodReviewed', ['danger-zone', 'metronome-invoicing']);
    }

    if (events && isHourBoundaryUTC(invoicePeriodTarget.startingAt) && isHourBoundaryUTC(invoicePeriodTarget.endingBefore)) {
      const periodStart = Date.parse(invoicePeriodTarget.startingAt);
      const periodEnd = Date.parse(invoicePeriodTarget.endingBefore);
      events.forEach((event, index) => {
        if (!isIsoTimestampUTC(event?.timestamp)) return;
        const timestamp = Date.parse(event.timestamp);
        if (timestamp < periodStart || timestamp >= periodEnd) {
          add(findings, 'MTR-USAGE-001', 'event.timestamp must fall inside invoicePeriodTarget.', `events[${index}].timestamp`, ['danger-zone', 'metronome-invoicing']);
        }
      });
    }
  }

  if (input.previewEventsRequired !== true) {
    add(findings, 'MTR-USAGE-001', 'previewEventsRequired must be true before any future ingest execution.', 'previewEventsRequired', ['official-invoice-preview-events', 'metronome-invoicing']);
  }

  const canaryPlan = isPlainObject(input.canaryPlan) ? input.canaryPlan : null;
  if (!canaryPlan) {
    add(findings, 'MTR-VERIFY-003', 'canaryPlan is required for usage ingest preview.', 'canaryPlan', ['danger-zone', 'gotchas']);
  } else {
    if (!isPositiveInteger(canaryPlan.canaryEventCount)) {
      add(findings, 'MTR-USAGE-003', 'canaryPlan.canaryEventCount must be a positive integer.', 'canaryPlan.canaryEventCount', ['gotchas']);
    } else if (events && canaryPlan.canaryEventCount > events.length) {
      add(findings, 'MTR-USAGE-003', 'canaryPlan.canaryEventCount cannot exceed events.length.', 'canaryPlan.canaryEventCount', ['gotchas']);
    }
    if (canaryPlan.readBackBeforeBulk !== true) {
      add(findings, 'MTR-VERIFY-003', 'canaryPlan.readBackBeforeBulk must be true.', 'canaryPlan.readBackBeforeBulk', ['danger-zone']);
    }
    if (!hasValue(canaryPlan.stopCriteria)) {
      add(findings, 'MTR-VERIFY-003', 'canaryPlan.stopCriteria is required.', 'canaryPlan.stopCriteria', ['gotchas']);
    }
  }

  const verificationPlan = isPlainObject(input.verificationPlan) ? input.verificationPlan : null;
  if (!verificationPlan) {
    add(findings, 'MTR-VERIFY-001', 'verificationPlan is required for usage ingest preview.', 'verificationPlan', ['shape-catalog']);
  } else {
    if (verificationPlan.previewEvents !== true) {
      add(findings, 'MTR-VERIFY-001', 'verificationPlan.previewEvents must be true.', 'verificationPlan.previewEvents', ['official-invoice-preview-events']);
    }
    if (verificationPlan.eventSearch !== true) {
      add(findings, 'MTR-VERIFY-001', 'verificationPlan.eventSearch must be true.', 'verificationPlan.eventSearch', ['official-event-search']);
    }
    if (verificationPlan.usageGroups !== true) {
      add(findings, 'MTR-VERIFY-001', 'verificationPlan.usageGroups must be true.', 'verificationPlan.usageGroups', ['official-usage-groups']);
    }
    if (verificationPlan.invoiceReview !== true) {
      add(findings, 'MTR-VERIFY-001', 'verificationPlan.invoiceReview must be true.', 'verificationPlan.invoiceReview', ['metronome-invoicing']);
    }
  }

  if (!hasValue(input.rollbackPlan)) {
    add(findings, 'MTR-VERIFY-002', 'rollbackPlan is required because usage ingest cannot be silently undone.', 'rollbackPlan', ['danger-zone', 'safety']);
  }

  for (const [field, message] of [
    ['skipPreviewEvents', 'Skipping previewEvents is forbidden for usage ingest preview.'],
    ['bulkWithoutCanary', 'Bulk ingest without canary is forbidden.'],
    ['useUnstableTransactionIds', 'Unstable transaction IDs are forbidden.'],
    ['ignoreFinalizedInvoices', 'Ignoring finalized invoice impact is forbidden.'],
  ]) {
    if (input[field] === true) {
      const ruleId = field === 'useUnstableTransactionIds' ? 'MTR-IDEMP-002' : 'MTR-USAGE-001';
      add(findings, ruleId, message, field, ['gotchas', 'danger-zone']);
    }
  }
}

function validateDimensionalRateCard(input, findings) {
  const addRatesOnly = input.catalogMode === 'add-rates-only';
  const payloadMode = input.payloadMode || 'code-only';
  const codeOnly = payloadMode === 'code-only';

  if (addRatesOnly) {
    if (!hasValue(input.usageProduct?.productId)) {
      add(findings, 'MTR-WORKSPACE-003', 'catalogMode add-rates-only requires usageProduct.productId for the existing dimensional USAGE product; do not plan products.create for a new action code.', 'usageProduct.productId', ['workspace', 'pricing-catalog']);
    }
  }

  if (!hasValue(input.rateCardId)) {
    add(findings, 'MTR-RATE-004', 'rateCardId is required for dimensional rate-card preview.', 'rateCardId', ['shape-catalog', 'pricing-catalog']);
  } else if (!isSafeIdentifier(input.rateCardId)) {
    add(findings, 'MTR-RATE-004', 'rateCardId must be a single safe Metronome rate card identifier.', 'rateCardId', ['validation']);
  }

  validateStartingAt(input, findings);

  const usageProduct = isPlainObject(input.usageProduct) ? input.usageProduct : null;
  if (!usageProduct) {
    add(findings, 'MTR-RATE-005', 'usageProduct is required for dimensional rate-card preview.', 'usageProduct', ['shape-catalog', 'pricing-catalog']);
  } else {
    if (!hasValue(usageProduct.name)) {
      add(findings, 'MTR-RATE-005', 'usageProduct.name is required.', 'usageProduct.name', ['pricing-catalog']);
    }
    if (usageProduct.type && usageProduct.type !== 'USAGE') {
      add(findings, 'MTR-RATE-005', 'usageProduct.type must be USAGE for dimensional pricing.', 'usageProduct.type', ['pricing-catalog']);
    }
    if (!hasValue(usageProduct.billableMetricId)) {
      add(findings, 'MTR-RATE-005', 'usageProduct.billableMetricId is required.', 'usageProduct.billableMetricId', ['billable-metrics', 'pricing-catalog']);
    } else if (!isSafeIdentifier(usageProduct.billableMetricId)) {
      add(findings, 'MTR-RATE-005', 'usageProduct.billableMetricId must be a safe billable metric identifier.', 'usageProduct.billableMetricId', ['validation']);
    }
    if (!isNonEmptyStringArray(usageProduct.pricingGroupKey)) {
      add(findings, 'MTR-RATE-005', 'usageProduct.pricingGroupKey must list the pricing dimension keys.', 'usageProduct.pricingGroupKey', ['pricing-catalog']);
    } else if (!arrayEquals(usageProduct.pricingGroupKey, ['action_code'])) {
      add(findings, 'MTR-RATE-005', 'This local dimensional preview currently supports pricing_group_key exactly ["action_code"].', 'usageProduct.pricingGroupKey', ['pricing-catalog']);
    }
    if (!isNonEmptyStringArray(usageProduct.presentationGroupKey)) {
      if (!codeOnly) {
        add(findings, 'MTR-RATE-005', 'usageProduct.presentationGroupKey must list the presentation dimension keys.', 'usageProduct.presentationGroupKey', ['pricing-catalog']);
      }
    } else if (!codeOnly && !arrayEquals(usageProduct.presentationGroupKey, ['action_display_name'])) {
      add(findings, 'MTR-RATE-005', 'code-and-name mode supports presentation_group_key exactly ["action_display_name"].', 'usageProduct.presentationGroupKey', ['pricing-catalog']);
    } else if (codeOnly && isNonEmptyStringArray(usageProduct.presentationGroupKey)) {
      add(findings, 'MTR-RATE-005', 'code-only canonical mode omits presentation_group_key on the product.', 'usageProduct.presentationGroupKey', ['pricing-catalog']);
    }
    if (!isNonEmptyStringArray(usageProduct.tags)) {
      add(findings, 'MTR-RATE-005', 'usageProduct.tags must list the product tags this usage product belongs to.', 'usageProduct.tags', ['pricing-catalog']);
    }
    if (hasValue(usageProduct.productId) && !isSafeIdentifier(usageProduct.productId)) {
      add(findings, 'MTR-RATE-005', 'usageProduct.productId must be a safe product identifier when provided.', 'usageProduct.productId', ['validation']);
    }
    if (usageProduct.existingProductCollisionReviewed !== true) {
      add(findings, 'MTR-IDEMP-003', 'usageProduct.existingProductCollisionReviewed must be true before a future product create can be planned.', 'usageProduct.existingProductCollisionReviewed', ['pricing-catalog', 'repo-safety']);
    }
  }

  const billableMetric = isPlainObject(input.billableMetric) ? input.billableMetric : null;
  if (!billableMetric) {
    add(findings, 'MTR-RATE-005', 'billableMetric evidence is required.', 'billableMetric', ['billable-metrics']);
  } else {
    if (usageProduct?.billableMetricId && billableMetric.id !== usageProduct.billableMetricId) {
      add(findings, 'MTR-RATE-005', 'billableMetric.id must match usageProduct.billableMetricId.', 'billableMetric.id', ['billable-metrics', 'pricing-catalog']);
    }
    if (!BILLABLE_METRIC_AGGREGATION_TYPES.has(billableMetric.aggregationType)) {
      add(findings, 'MTR-RATE-005', 'billableMetric.aggregationType must be COUNT, SUM, MAX, or UNIQUE.', 'billableMetric.aggregationType', ['billable-metrics']);
    } else if (billableMetric.aggregationType !== 'COUNT') {
      if (!codeOnly) {
        if (!hasValue(billableMetric.aggregationKey)) {
          add(findings, 'MTR-RATE-005', 'billableMetric.aggregationKey is required for SUM, MAX, and UNIQUE metrics.', 'billableMetric.aggregationKey', ['billable-metrics']);
        } else if (!isSafeIdentifier(billableMetric.aggregationKey)) {
          add(findings, 'MTR-RATE-005', 'billableMetric.aggregationKey must be a safe event property name.', 'billableMetric.aggregationKey', ['validation', 'billable-metrics']);
        }
      } else {
        add(findings, 'MTR-RATE-005', 'code-only canonical mode requires billableMetric.aggregationType COUNT.', 'billableMetric.aggregationType', ['billable-metrics']);
      }
    } else if (codeOnly && hasValue(billableMetric.aggregationKey)) {
      add(findings, 'MTR-RATE-005', 'code-only canonical mode must not set billableMetric.aggregationKey.', 'billableMetric.aggregationKey', ['billable-metrics']);
    }
    if (billableMetric.eventTypeFilterReviewed !== true) {
      add(findings, 'MTR-RATE-005', 'billableMetric.eventTypeFilterReviewed must be true.', 'billableMetric.eventTypeFilterReviewed', ['billable-metrics']);
    }
    if (billableMetric.nonRetroactiveMetricReviewed !== true) {
      add(findings, 'MTR-RATE-005', 'billableMetric.nonRetroactiveMetricReviewed must be true because new metrics only aggregate future events.', 'billableMetric.nonRetroactiveMetricReviewed', ['billable-metrics']);
    }
    if (!Array.isArray(billableMetric.groupKeys) || billableMetric.groupKeys.length === 0) {
      add(findings, 'MTR-RATE-005', 'billableMetric.groupKeys must include the dimensional group key.', 'billableMetric.groupKeys', ['billable-metrics']);
    }
    if (!isNonEmptyStringArray(billableMetric.requiredEventProperties)) {
      add(findings, 'MTR-RATE-005', 'billableMetric.requiredEventProperties must list the event properties required by pricing and presentation dimensions.', 'billableMetric.requiredEventProperties', ['billable-metrics']);
    }
  }

  const requiredDimensionKeys = codeOnly
    ? ['action_code']
    : [
      ...(isNonEmptyStringArray(usageProduct?.pricingGroupKey) ? usageProduct.pricingGroupKey : []),
      ...(isNonEmptyStringArray(usageProduct?.presentationGroupKey) ? usageProduct.presentationGroupKey : []),
    ];
  const uniqueDimensionKeys = [...new Set(requiredDimensionKeys)];
  if (uniqueDimensionKeys.length > 0 && Array.isArray(billableMetric?.groupKeys)) {
    const hasCompoundGroupKey = billableMetric.groupKeys.some((groupKey) => {
      if (!Array.isArray(groupKey)) return false;
      const normalized = [...new Set(groupKey)].sort();
      return normalized.length === uniqueDimensionKeys.length
        && normalized.every((key, index) => key === [...uniqueDimensionKeys].sort()[index]);
    });
    if (!hasCompoundGroupKey) {
      add(findings, 'MTR-RATE-005', 'billableMetric.groupKeys must include one compound group key containing every pricing and presentation dimension key.', 'billableMetric.groupKeys', ['billable-metrics', 'pricing-catalog']);
    }
  }

  if (isNonEmptyStringArray(billableMetric?.requiredEventProperties)) {
    for (const dimensionKey of uniqueDimensionKeys) {
      if (!billableMetric.requiredEventProperties.includes(dimensionKey)) {
        add(findings, 'MTR-RATE-005', `billableMetric.requiredEventProperties must include ${dimensionKey}.`, 'billableMetric.requiredEventProperties', ['billable-metrics', 'pricing-catalog']);
      }
    }
    if (hasValue(billableMetric?.aggregationKey) && !billableMetric.requiredEventProperties.includes(billableMetric.aggregationKey)) {
      add(findings, 'MTR-RATE-005', 'billableMetric.requiredEventProperties must include billableMetric.aggregationKey.', 'billableMetric.requiredEventProperties', ['billable-metrics']);
    }
  }

  if (input.metricGroupKeyVerified !== true) {
    add(findings, 'MTR-RATE-005', 'metricGroupKeyVerified must be true before previewing dimensional product and rate-card changes.', 'metricGroupKeyVerified', ['billable-metrics', 'pricing-catalog']);
  }

  const rates = Array.isArray(input.rates) ? input.rates : null;
  if (!rates || rates.length === 0) {
    add(findings, 'MTR-RATE-001', 'rates must include at least one dimensional action rate.', 'rates', ['pricing-catalog']);
  } else if (rates.length > 100) {
    add(findings, 'MTR-RATE-001', 'rates must contain 100 or fewer rows for one addRates preview batch.', 'rates', ['endpoint-matrix', 'official-rate-card-add-rates']);
  }

  const actionCodes = new Set();
  if (rates) {
    rates.forEach((rate, index) => {
      const ratePath = `rates[${index}]`;
      if (!isPlainObject(rate)) {
        add(findings, 'MTR-RATE-001', 'Each rate must be an object.', ratePath, ['pricing-catalog']);
        return;
      }
      if (!hasValue(rate.actionCode)) {
        add(findings, 'MTR-RATE-005', 'rate.actionCode is required for pricing_group_values.', `${ratePath}.actionCode`, ['pricing-catalog']);
      } else if (!isSafeIdentifier(rate.actionCode)) {
        add(findings, 'MTR-RATE-005', 'rate.actionCode must be a safe action code.', `${ratePath}.actionCode`, ['validation']);
      } else if (actionCodes.has(rate.actionCode)) {
        add(findings, 'MTR-RATE-005', 'rate.actionCode must be unique within the preview.', `${ratePath}.actionCode`, ['pricing-catalog']);
      } else {
        actionCodes.add(rate.actionCode);
      }
      if (!hasValue(rate.actionDisplayName)) {
        if (!codeOnly) {
          add(findings, 'MTR-RATE-005', 'rate.actionDisplayName is required for invoice presentation evidence.', `${ratePath}.actionDisplayName`, ['pricing-catalog']);
        }
      }
      if (!isNonNegativeInteger(rate.price)) {
        add(findings, 'MTR-RATE-001', 'rate.price must be a non-negative integer in credit_type units.', `${ratePath}.price`, ['pricing-catalog', 'conventions']);
      }
      if (!hasValue(rate.creditTypeId)) {
        add(findings, 'MTR-RATE-001', 'rate.creditTypeId is required.', `${ratePath}.creditTypeId`, ['conventions']);
      } else if (!isSafeIdentifier(rate.creditTypeId)) {
        add(findings, 'MTR-RATE-001', 'rate.creditTypeId must be a safe credit type identifier.', `${ratePath}.creditTypeId`, ['validation']);
      }
      if (rate.entitled !== true) {
        add(findings, 'MTR-RATE-001', 'rate.entitled must be true for active dimensional action rates.', `${ratePath}.entitled`, ['pricing-catalog']);
      }
      if (rate.rateType && rate.rateType !== 'FLAT') {
        add(findings, 'MTR-RATE-005', 'This local dimensional preview currently supports FLAT rates only.', `${ratePath}.rateType`, ['pricing-catalog']);
      }
    });
  }

  if (input.invoiceImpactReviewed !== true) {
    add(findings, 'MTR-VERIFY-001', 'invoiceImpactReviewed must be true before previewing dimensional rate-card changes.', 'invoiceImpactReviewed', ['metronome-invoicing', 'shape-catalog']);
  }

  const canaryPlan = isPlainObject(input.canaryPlan) ? input.canaryPlan : null;
  if (!canaryPlan) {
    add(findings, 'MTR-VERIFY-003', 'canaryPlan is required for future dimensional rate-card apply.', 'canaryPlan', ['danger-zone', 'pricing-catalog']);
  } else {
    if (!hasValue(canaryPlan.firstActionCode) || !actionCodes.has(canaryPlan.firstActionCode)) {
      add(findings, 'MTR-VERIFY-003', 'canaryPlan.firstActionCode must match one planned rate actionCode.', 'canaryPlan.firstActionCode', ['pricing-catalog']);
    }
    if (canaryPlan.readBackBeforeRemaining !== true) {
      add(findings, 'MTR-VERIFY-003', 'canaryPlan.readBackBeforeRemaining must be true.', 'canaryPlan.readBackBeforeRemaining', ['danger-zone']);
    }
    if (!hasValue(canaryPlan.stopCriteria)) {
      add(findings, 'MTR-VERIFY-003', 'canaryPlan.stopCriteria is required.', 'canaryPlan.stopCriteria', ['danger-zone']);
    }
  }

  const verificationPlan = isPlainObject(input.verificationPlan) ? input.verificationPlan : null;
  if (!verificationPlan) {
    add(findings, 'MTR-VERIFY-001', 'verificationPlan is required for dimensional rate-card preview.', 'verificationPlan', ['shape-catalog']);
  } else {
    for (const [field, sourceId] of [
      ['productReadback', 'official-product-get'],
      ['rateScheduleReadback', 'official-rate-card-get-rate-schedule'],
      ['getRatesSelectorReadback', 'official-rate-card-get-rates'],
      ['usageGroupsReadback', 'official-usage-groups'],
      ['invoicePreviewOrReadback', 'metronome-invoicing'],
    ]) {
      if (verificationPlan[field] !== true) {
        add(findings, 'MTR-VERIFY-001', `verificationPlan.${field} must be true.`, `verificationPlan.${field}`, [sourceId]);
      }
    }
  }

  if (!hasValue(input.rollbackPlan)) {
    add(findings, 'MTR-VERIFY-002', 'rollbackPlan is required for any future dimensional rate-card apply.', 'rollbackPlan', ['validation', 'safety']);
  }

  for (const [field, message] of [
    ['oneProductPerAction', 'One product per action is forbidden for this dimensional shape; use one USAGE product with pricing_group_key.'],
    ['separateMetricGroupKeys', 'Separate action_code and action_display_name group keys are forbidden; use one compound group key.'],
    ['missingPresentationGroupKey', 'A missing presentation group key is forbidden when customer-visible names are required.'],
    ['skipRateScheduleReadback', 'Skipping rate schedule read-back is forbidden.'],
    ['bulkWithoutCanary', 'Bulk rate-card apply without canary is forbidden.'],
  ]) {
    if (input[field] === true) {
      const ruleId = field === 'bulkWithoutCanary' ? 'MTR-VERIFY-003' : 'MTR-RATE-005';
      add(findings, ruleId, message, field, ['pricing-catalog', 'billable-metrics', 'danger-zone']);
    }
  }
}

function validatePackagePlanMoveNoImmediateInvoice(input, findings, options) {
  if (!hasValue(input.customerId)) {
    add(findings, 'MTR-BILL-001', 'customerId is required for a package plan move.', 'customerId', ['shape-catalog']);
  } else if (!isSafeIdentifier(input.customerId)) {
    add(findings, 'MTR-BILL-001', 'customerId must be a single safe Metronome customer identifier.', 'customerId', ['validation']);
  }

  if (!hasValue(input.currentContractId)) {
    add(findings, 'MTR-PKG-003', 'currentContractId is required so the predecessor can be ended explicitly.', 'currentContractId', ['shape-catalog', 'endpoint-matrix']);
  } else if (!isSafeIdentifier(input.currentContractId)) {
    add(findings, 'MTR-PKG-003', 'currentContractId must be a single safe Metronome contract identifier.', 'currentContractId', ['validation']);
  }

  if (!hasValue(input.targetPackageAlias)) {
    add(findings, 'MTR-PKG-001', 'targetPackageAlias is required for the successor package contract.', 'targetPackageAlias', ['shape-catalog', 'endpoint-matrix']);
  } else if (!isSafeIdentifier(input.targetPackageAlias)) {
    add(findings, 'MTR-PKG-001', 'targetPackageAlias must be a single safe package alias.', 'targetPackageAlias', ['validation']);
  }

  if (!hasValue(input.contractUniquenessKey)) {
    add(findings, 'MTR-IDEMP-001', 'contractUniquenessKey is required for idempotent successor contract creation.', 'contractUniquenessKey', ['validation', 'packages-contracts']);
  } else if (!isSafeIdentifier(input.contractUniquenessKey)) {
    add(findings, 'MTR-IDEMP-001', 'contractUniquenessKey must be a single safe deterministic key.', 'contractUniquenessKey', ['validation']);
  } else if (String(input.contractUniquenessKey).length > 128) {
    add(findings, 'MTR-IDEMP-001', 'contractUniquenessKey must be 128 characters or fewer.', 'contractUniquenessKey', ['packages-contracts']);
  }

  if (!hasValue(input.cutoverAt)) {
    add(findings, 'MTR-RATE-004', 'cutoverAt is required for the predecessor ending_before and successor starting_at.', 'cutoverAt', ['shape-catalog']);
  } else if (!isHourBoundaryUTC(input.cutoverAt)) {
    add(findings, 'MTR-TIME-001', 'cutoverAt must be a UTC hour-boundary timestamp.', 'cutoverAt', ['validation', 'conventions']);
  } else if (Date.parse(input.cutoverAt) <= Date.parse(options.now)) {
    add(findings, 'MTR-TIME-002', 'cutoverAt must be in the future for the no-immediate-invoice shape.', 'cutoverAt', ['danger-zone', 'packages-contracts']);
  }

  if (input.transitionType !== 'RENEWAL') {
    add(findings, 'MTR-PKG-003', 'package plan moves must use transitionType RENEWAL; SUPERSEDE is not supported for package contracts.', 'transitionType', ['endpoint-matrix', 'packages-contracts']);
  }

  if (input.oldContractEndBehavior !== 'update_end_date') {
    add(findings, 'MTR-INV-003', 'oldContractEndBehavior must be update_end_date for this no-immediate-invoice shape.', 'oldContractEndBehavior', ['danger-zone', 'packages-contracts']);
  }

  if (input.invoiceBehavior !== 'no_immediate_invoice') {
    add(findings, 'MTR-INV-003', 'invoiceBehavior must be no_immediate_invoice for this shape.', 'invoiceBehavior', ['shape-catalog', 'danger-zone']);
  }

  if (input.stripeBehavior !== 'preserve_existing_billing_provider') {
    add(findings, 'MTR-BILL-004', 'stripeBehavior must be preserve_existing_billing_provider.', 'stripeBehavior', ['gotchas', 'shape-catalog']);
  }

  if (input.billingProvider?.verified !== true) {
    add(findings, 'MTR-BILL-001', 'billingProvider.verified must be true before planning a package-contract move.', 'billingProvider.verified', ['gotchas', 'packages-contracts']);
  }

  if (input.packageAliasVerified !== true) {
    add(findings, 'MTR-PKG-004', 'packageAliasVerified must be true so package_alias resolution at cutover is not guessed.', 'packageAliasVerified', ['gotchas', 'packages-contracts']);
  }

  if (input.currentInvoicesChecked !== true) {
    add(findings, 'MTR-INV-003', 'currentInvoicesChecked must be true before planning updateEndDate.', 'currentInvoicesChecked', ['danger-zone', 'packages-contracts']);
  }

  if (!hasValue(input.rollbackPlan)) {
    add(findings, 'MTR-VERIFY-002', 'rollbackPlan is required for any future contract move apply.', 'rollbackPlan', ['validation', 'safety']);
  }

  const forbidden = [
    ['archiveExistingContract', 'Archiving the predecessor is forbidden for this shape; use updateEndDate.'],
    ['voidInvoices', 'Voiding invoices is forbidden for this no-immediate-invoice shape.'],
    ['immediateInvoice', 'Immediate invoice behavior is forbidden for this shape.'],
    ['pastDated', 'Past-dated plan moves are forbidden for this shape.'],
    ['addScheduledCharges', 'Scheduled charge edits are forbidden for this no-immediate-invoice package move.'],
    ['billingProviderChange', 'Billing-provider changes are forbidden for this shape; preserve existing config.'],
  ];

  for (const [field, message] of forbidden) {
    if (input[field] === true) {
      const ruleId = field === 'pastDated' ? 'MTR-TIME-002' : 'MTR-INV-003';
      add(findings, ruleId, message, field, ['danger-zone', 'shape-catalog']);
    }
  }
}

function validatePackagePlanMoveImmediateInvoice(input, findings, options = {}) {
  if (!hasValue(input.customerId)) {
    add(findings, 'MTR-BILL-001', 'customerId is required for a package plan move.', 'customerId', ['shape-catalog']);
  } else if (!isSafeIdentifier(input.customerId)) {
    add(findings, 'MTR-BILL-001', 'customerId must be a single safe Metronome customer identifier.', 'customerId', ['validation']);
  }

  if (!hasValue(input.currentContractId)) {
    add(findings, 'MTR-PKG-003', 'currentContractId is required so the predecessor can be ended explicitly.', 'currentContractId', ['shape-catalog', 'endpoint-matrix']);
  } else if (!isSafeIdentifier(input.currentContractId)) {
    add(findings, 'MTR-PKG-003', 'currentContractId must be a single safe Metronome contract identifier.', 'currentContractId', ['validation']);
  }

  if (!hasValue(input.targetPackageAlias)) {
    add(findings, 'MTR-PKG-001', 'targetPackageAlias is required for the successor package contract.', 'targetPackageAlias', ['shape-catalog', 'endpoint-matrix']);
  } else if (!isSafeIdentifier(input.targetPackageAlias)) {
    add(findings, 'MTR-PKG-001', 'targetPackageAlias must be a single safe package alias.', 'targetPackageAlias', ['validation']);
  }

  if (!hasValue(input.contractUniquenessKey)) {
    add(findings, 'MTR-IDEMP-001', 'contractUniquenessKey is required for idempotent successor contract creation.', 'contractUniquenessKey', ['validation', 'packages-contracts']);
  } else if (!isSafeIdentifier(input.contractUniquenessKey)) {
    add(findings, 'MTR-IDEMP-001', 'contractUniquenessKey must be a single safe deterministic key.', 'contractUniquenessKey', ['validation']);
  } else if (String(input.contractUniquenessKey).length > 128) {
    add(findings, 'MTR-IDEMP-001', 'contractUniquenessKey must be 128 characters or fewer.', 'contractUniquenessKey', ['packages-contracts']);
  }

  if (!hasValue(input.cutoverAt)) {
    add(findings, 'MTR-RATE-004', 'cutoverAt is required for the predecessor ending_before and successor starting_at.', 'cutoverAt', ['shape-catalog']);
  } else if (!isHourBoundaryUTC(input.cutoverAt)) {
    add(findings, 'MTR-TIME-001', 'cutoverAt must be a UTC hour-boundary timestamp.', 'cutoverAt', ['validation', 'conventions']);
  } else if (Date.parse(input.cutoverAt) <= Date.parse(options.now)) {
    findings.push({
      id: 'MTR-INV-001',
      severity: 'warning',
      title: rule('MTR-INV-001').title,
      message: 'cutoverAt is not in the future; SCHEDULED plan fee may finalize immediately at apply time.',
      remediation: rule('MTR-INV-001').remediation,
      path: 'cutoverAt',
      sourceIds: ['danger-zone', 'packages-contracts'],
    });
  }

  if (input.transitionType !== 'RENEWAL') {
    add(findings, 'MTR-PKG-003', 'package plan moves must use transitionType RENEWAL; SUPERSEDE is not supported for package contracts.', 'transitionType', ['endpoint-matrix', 'packages-contracts']);
  }

  if (input.oldContractEndBehavior !== 'update_end_date') {
    add(findings, 'MTR-INV-003', 'oldContractEndBehavior must be update_end_date for package plan moves.', 'oldContractEndBehavior', ['danger-zone', 'packages-contracts']);
  }

  if (input.invoiceBehavior !== 'immediate_plan_fee_expected') {
    add(findings, 'MTR-INV-003', 'invoiceBehavior must be immediate_plan_fee_expected for this shape.', 'invoiceBehavior', ['shape-catalog', 'danger-zone']);
  }

  const overlapPolicies = ['no_refund', 'partial_refund_stripe', 'service_extension'];
  if (!overlapPolicies.includes(input.paidPeriodOverlapPolicy)) {
    add(findings, 'MTR-INV-003', `paidPeriodOverlapPolicy must be one of: ${overlapPolicies.join(', ')}.`, 'paidPeriodOverlapPolicy', ['danger-zone', 'packages-contracts']);
  }

  if (input.paidPeriodOverlapReviewed !== true) {
    add(findings, 'MTR-INV-003', 'paidPeriodOverlapReviewed must be true after reviewing overlap with the last paid plan period.', 'paidPeriodOverlapReviewed', ['danger-zone', 'packages-contracts']);
  }

  if (input.stripeBehavior !== 'preserve_existing_billing_provider') {
    add(findings, 'MTR-BILL-004', 'stripeBehavior must be preserve_existing_billing_provider.', 'stripeBehavior', ['gotchas', 'shape-catalog']);
  }

  if (input.billingProvider?.verified !== true) {
    add(findings, 'MTR-BILL-001', 'billingProvider.verified must be true before planning a package-contract move.', 'billingProvider.verified', ['gotchas', 'packages-contracts']);
  }

  if (input.packageAliasVerified !== true) {
    add(findings, 'MTR-PKG-004', 'packageAliasVerified must be true so package_alias resolution at cutover is not guessed.', 'packageAliasVerified', ['gotchas', 'packages-contracts']);
  }

  if (input.currentInvoicesChecked !== true) {
    add(findings, 'MTR-INV-003', 'currentInvoicesChecked must be true before planning updateEndDate.', 'currentInvoicesChecked', ['danger-zone', 'packages-contracts']);
  }

  if (!hasValue(input.rollbackPlan)) {
    add(findings, 'MTR-VERIFY-002', 'rollbackPlan is required for any future contract move apply.', 'rollbackPlan', ['validation', 'safety']);
  }

  const forbidden = [
    ['archiveExistingContract', 'Archiving the predecessor is forbidden for this shape; use updateEndDate.'],
    ['voidInvoices', 'Voiding invoices is forbidden for this shape.'],
    ['addScheduledCharges', 'Scheduled charge edits are forbidden for this package move.'],
    ['billingProviderChange', 'Billing-provider changes are forbidden for this shape; preserve existing config.'],
  ];

  for (const [field, message] of forbidden) {
    if (input[field] === true) {
      add(findings, 'MTR-INV-003', message, field, ['danger-zone', 'shape-catalog']);
    }
  }
}

function validateShapeInput(shapeId, input, options = {}) {
  const shape = getShape(shapeId);
  if (!shape) {
    return {
      schemaVersion: 'metro.validation.v1',
      shape: shapeId,
      valid: false,
      findings: [{
        id: 'MTR-SHAPE-404',
        severity: 'error',
        title: 'Unknown shape',
        message: `Unknown shape: ${shapeId}`,
        remediation: 'Run metro shape list to see supported shapes.',
        path: 'shape',
        sourceIds: ['shape-catalog'],
      }],
    };
  }

  const findings = [];
  const now = options.now || new Date().toISOString();
  const ctx = { ...options, now };

  if (shapeId === 'customer-setup') {
    validateCustomerSetup(input, findings, ctx);
  } else if (shapeId === 'pro-annual') {
    validateProAnnual(input, findings, ctx);
  } else if (shapeId === 'pro-annual-self-serve-v2') {
    validateProAnnualSelfServeV2(input, findings, ctx);
  } else if (shapeId === 'free-credit-trial') {
    validateFreeCreditTrial(input, findings, ctx);
  } else if (shapeId === 'complimentary-credit-grant') {
    validateComplimentaryCreditGrant(input, findings, ctx);
  } else if (shapeId === 'paid-credit-top-up') {
    validatePaidCreditTopUp(input, findings, ctx);
  } else if (shapeId === 'package-alias-archive-handoff') {
    validatePackageAliasArchiveHandoff(input, findings, ctx);
  } else if (shapeId === 'stripe-billing-provider-attachment') {
    validateStripeBillingProviderAttachment(input, findings, ctx);
  } else if (shapeId === 'package-plan-move-no-immediate-invoice') {
    validatePackagePlanMoveNoImmediateInvoice(input, findings, ctx);
  } else if (shapeId === 'package-plan-move-immediate-invoice') {
    validatePackagePlanMoveImmediateInvoice(input, findings, ctx);
  } else if (shapeId === 'product-rate-retirement') {
    validateProductRateRetirement(input, findings, ctx);
  } else if (shapeId === 'dimensional-rate-card') {
    validateDimensionalRateCard(input, findings, ctx);
  } else if (shapeId === 'invoice-issue-date-update') {
    validateInvoiceIssueDateUpdate(input, findings, ctx);
  } else if (shapeId === 'direct-subscription-contract') {
    validateDirectSubscriptionContract(input, findings, ctx);
  } else if (shapeId === 'enterprise-custom-contract') {
    validateEnterpriseCustomContract(input, findings, ctx);
  } else if (shapeId === 'usage-ingest-preview') {
    validateUsageIngestPreview(input, findings, ctx);
  }

  return {
    schemaVersion: 'metro.validation.v1',
    shape: shapeId,
    valid: !findings.some((finding) => finding.severity === 'error' || finding.severity === 'danger'),
    findings,
    sources: shape.sources,
  };
}

module.exports = {
  configuredAccessCreditTypeIds,
  USD_CREDIT_TYPE_ID,
  isHourBoundaryUTC,
  isIsoTimestampUTC,
  isSafeIdentifier,
  validateShapeInput,
};
