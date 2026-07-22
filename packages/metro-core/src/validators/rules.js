'use strict';

const RULES = {
  'MTR-TENANT-001': {
    severity: 'error',
    title: 'Write command missing explicit tenant',
    remediation: 'Choose exactly one tenant with --sandbox, --prod, or a profile that resolves to one tenant.',
  },
  'MTR-TENANT-002': {
    severity: 'error',
    title: 'Production write missing reviewed preview confirmation',
    remediation: 'Bind production approval to the exact reviewed preview hash before apply can proceed.',
  },
  'MTR-TENANT-003': {
    severity: 'error',
    title: 'Profile does not resolve to exactly one tenant',
    remediation: 'Configure the profile with one explicit tenant and a matching tenant-scoped Metronome key environment variable name.',
  },
  'MTR-TENANT-004': {
    severity: 'error',
    title: 'Tenant key fingerprint changed between preview and apply',
    remediation: 'Re-run preview and preflight with the current tenant key or restart approval after confirming the key change.',
  },
  'MTR-ENDPOINT-001': {
    severity: 'error',
    title: 'Endpoint source evidence missing',
    remediation: 'Cite endpoint-matrix and a reviewed endpoint source such as an official Metronome doc or local skill before treating the endpoint as apply evidence.',
  },
  'MTR-ENDPOINT-002': {
    severity: 'error',
    title: 'Endpoint path appears guessed',
    remediation: 'Use the exact method and path from the local endpoint matrix and cite the reviewed source ID that supports it.',
  },
  'MTR-APIREQ-001': {
    severity: 'error',
    title: 'Expert API request missing required field',
    remediation: 'Add the required endpoint request field or policy evidence before any preview or future live runner can use this endpoint.',
  },
  'MTR-APIREQ-002': {
    severity: 'error',
    title: 'Expert API request includes forbidden field',
    remediation: 'Remove fields forbidden by the reviewed endpoint contract and use the endpoint-specific workflow shape when the operation needs richer policy evidence.',
  },
  'MTR-APIREQ-003': {
    severity: 'error',
    title: 'Expert API request contains secret-like material',
    remediation: 'Remove API keys, bearer tokens, passwords, and secret-shaped fields. The CLI should reference tenant profiles and env var names, never inline secrets.',
  },
  'MTR-APIREQ-004': {
    severity: 'error',
    title: 'Expert API request violates endpoint-specific policy',
    remediation: 'Adjust the request to match the reviewed endpoint contract and required local policy gates before any preview or future apply is considered.',
  },
  'MTR-PKG-001': {
    severity: 'error',
    title: 'Package alias missing',
    remediation: 'Provide packageAlias for package-based workflows.',
  },
  'MTR-PKG-002': {
    severity: 'error',
    title: 'Package uniqueness key missing or unstable',
    remediation: 'Provide a stable uniquenessKey of 128 characters or fewer.',
  },
  'MTR-PKG-003': {
    severity: 'error',
    title: 'Package contract payload contains unsupported fields',
    remediation: 'Use the restricted package contract-create shape: customer_id, starting_at, package_alias or package_id, uniqueness_key, and transition only.',
  },
  'MTR-PKG-004': {
    severity: 'error',
    title: 'Package alias verification missing',
    remediation: 'Verify the package alias resolves to the intended package at the workflow timestamp before previewing package moves or old-version archive.',
  },
  'MTR-PKG-010': {
    severity: 'error',
    title: 'Annual self-serve v2 credit grant mode invalid',
    remediation: 'Set creditGrantMode to monthly-drip for 1/12 credit grants or lump-sum only when finance explicitly requires legacy behavior.',
  },
  'MTR-PKG-011': {
    severity: 'error',
    title: 'Annual self-serve v2 credit grant fields invalid',
    remediation: 'Provide annualCreditsTotal, fixedProductId, accessCreditTypeId, and commitName for recurring_commits credit modeling.',
  },
  'MTR-PKG-012': {
    severity: 'error',
    title: 'Free-credit-trial credit grant fields missing or invalid',
    remediation: 'Provide creditAmount (positive integer), trialDurationDays (1-365 integer), rolloverFraction (0 to 1), and accessCreditTypeId. The shape generates commit_duration.unit PERIODS, duration.value as a string, starting_at_offset, and proration automatically.',
  },
  'MTR-PKG-013': {
    severity: 'error',
    title: 'Free-credit-trial Stripe-free requirement not confirmed',
    remediation: 'Set noStripeConfirmed: true to confirm this package has no billing_provider and no invoice_amount on the commit - no Stripe invoice will be generated.',
  },
  'MTR-RATE-001': {
    severity: 'error',
    title: 'Product rate missing entitlement decision',
    remediation: 'State the current entitlement evidence and close retired product rates with entitled:false.',
  },
  'MTR-RATE-002': {
    severity: 'error',
    title: 'Subscription-like rate missing matching billing frequency',
    remediation: 'Set billingFrequency to the frequency required by the shape.',
  },
  'MTR-RATE-003': {
    severity: 'error',
    title: 'Product retirement skips rate closure',
    remediation: 'Close every affected rate-card entry with entitled:false and price:0 before archiving the product.',
  },
  'MTR-RATE-004': {
    severity: 'error',
    title: 'Rate-card change missing starting_at',
    remediation: 'Provide startingAt as a UTC hour-boundary timestamp.',
  },
  'MTR-RATE-005': {
    severity: 'error',
    title: 'Dimensional rate-card evidence incomplete',
    remediation: 'Prove the USAGE product pricing and presentation group keys are backed by one compound billable-metric group key, and provide reviewed per-dimension rate rows.',
  },
  'MTR-TIME-001': {
    severity: 'error',
    title: 'Timestamp is not on a UTC hour boundary',
    remediation: 'Use an ISO timestamp ending in :00:00Z or :00:00.000Z.',
  },
  'MTR-TIME-002': {
    severity: 'error',
    title: 'Past-dated billing operation may finalize immediately',
    remediation: 'Use a future UTC hour-boundary timestamp for no-immediate-invoice workflows.',
  },
  'MTR-TIME-004': {
    severity: 'error',
    title: 'Package alias handoff is not live',
    remediation: 'Archive an old package version only after the replacement package alias is live and verified by package read-back evidence.',
  },
  'MTR-BILL-001': {
    severity: 'error',
    title: 'Billable workflow missing billing provider',
    remediation: 'Attach or plan a Stripe billing provider config before an invoice-producing workflow.',
  },
  'MTR-BILL-002': {
    severity: 'error',
    title: 'Billing provider delivery method missing or unsupported',
    remediation: 'Provide exactly one of deliveryMethodId or deliveryMethod. Use deliveryMethodId for multi-entity Stripe billing, or direct_to_billing_provider for the single-entity shorthand.',
  },
  'MTR-BILL-003': {
    severity: 'error',
    title: 'Existing billing provider config decision missing',
    remediation: 'Choose an existingConfigPolicy such as fail_if_exists or reuse_if_matching before planning attachment.',
  },
  'MTR-BILL-004': {
    severity: 'error',
    title: 'Stripe draft behavior unspecified',
    remediation: 'Set the shape-specific Stripe draft behavior field explicitly before preview.',
  },
  'MTR-BILL-005': {
    severity: 'error',
    title: 'Stripe delivery entity scope unresolved',
    remediation: 'Set deliveryMethodScope explicitly. For multi_entity delivery, provide matching deliveryMethodId evidence, targetStripeAccountId, accountBillingProviderReviewed: true, and endpointFieldsReviewed: true.',
  },
  'MTR-SUB-001': {
    severity: 'error',
    title: 'Subscription config missing for subscription product',
    remediation: 'Provide an explicit subscriptions[] plan with subscription_rate, collection schedule, proration, and quantity management mode before preview.',
  },
  'MTR-SUB-002': {
    severity: 'error',
    title: 'Subscription billing frequency mismatch',
    remediation: 'Make subscription_rate.billing_frequency match the verified rate-card subscription rate frequency.',
  },
  'MTR-SUB-003': {
    severity: 'error',
    title: 'Subscription product identity mismatch',
    remediation: 'Use the same SubscriptionProductListItem product_id in the rate-card evidence, subscription_rate, and override specifiers.',
  },
  'MTR-SUB-004': {
    severity: 'error',
    title: 'Subscription quantity or seat source missing',
    remediation: 'For QUANTITY_ONLY provide initialQuantity. For SEAT_BASED direct contracts provide seatConfig.seatGroupKey and seatConfig.initialSeatIds.',
  },
  'MTR-CUSTOM-001': {
    severity: 'error',
    title: 'Custom contract customer identity incomplete',
    remediation: 'Provide an existing metronomeCustomerId or explicitly request createMetronomeCustomer with externalCustomerId before preview.',
  },
  'MTR-CUSTOM-002': {
    severity: 'error',
    title: 'Custom contract shape is unsupported or ambiguous',
    remediation: 'Use the local direct enterprise custom-contract shape with contractType direct, explicitStartingAt, and no package fields.',
  },
  'MTR-CUSTOM-003': {
    severity: 'error',
    title: 'Custom contract commercial terms incomplete',
    remediation: 'Provide explicit rate card, recurring commit, invoice, seat-limit, verification, and remediation terms before preview.',
  },
  'MTR-CUST-001': {
    severity: 'error',
    title: 'Customer identity incomplete',
    remediation: 'Provide companyName, externalCustomerId, primaryIngestAlias, and the full ingestAliases list before planning customer setup.',
  },
  'MTR-CUST-002': {
    severity: 'error',
    title: 'Customer ingest alias collision review missing',
    remediation: 'Plan customer lookup by ingest alias, review archived-customer collisions, and choose fail_if_exists or reuse_if_exact_match before customer create.',
  },
  'MTR-CUST-003': {
    severity: 'error',
    title: 'Customer hierarchy setup is ambiguous',
    remediation: 'Declare the hierarchy mode and provide contract-level hierarchy review evidence before previewing non-standalone customer setup.',
  },
  'MTR-CUST-004': {
    severity: 'error',
    title: 'Customer custom-field approval missing',
    remediation: 'Approve every custom field key for the Metronome customer entity and keep each value within Metronome custom-field limits.',
  },
  'MTR-INV-001': {
    severity: 'warning',
    title: 'Workflow can finalize an invoice immediately',
    remediation: 'Use a future UTC hour boundary or explicitly confirm immediate invoice behavior in a later preview/apply workflow.',
  },
  'MTR-INV-002': {
    severity: 'error',
    title: 'Invoice void lacks Stripe reconciliation review',
    remediation: 'Only void a reviewed invoice after proving invoice status, Stripe payment/refund handling, reconciliation plan, read-back checks, and remediation ownership.',
  },
  'MTR-INV-003': {
    severity: 'error',
    title: 'Contract archive or invoice-impacting move lacks inventory',
    remediation: 'Use updateEndDate rather than archive for this shape and inspect current invoices before planning the move.',
  },
  'MTR-INV-004': {
    severity: 'error',
    title: 'Invoice issue-date edit lacks expected Stripe behavior',
    remediation: 'Only update DRAFT invoice issue dates after invoice read-back, contract-end evidence, billing-provider review, explicit Stripe behavior, and remediation planning exist.',
  },
  'MTR-INV-005': {
    severity: 'error',
    title: 'Invoice regenerate lacks voided-invoice and distribution review',
    remediation: 'Regenerate only a reviewed VOID invoice after proving correction inputs, billing-provider distribution behavior, replacement invoice read-back, and reconciliation/remediation plans.',
  },
  'MTR-PAY-001': {
    severity: 'error',
    title: 'Payment attempt invoice preconditions missing',
    remediation: 'Review that the invoice is FINALIZED, PLG invoicing is enabled, a billing provider is attached, and the customer payment method path is ready before attempting payment.',
  },
  'MTR-PAY-002': {
    severity: 'error',
    title: 'Payment duplicate or terminal-state review missing',
    remediation: 'List payment attempts first and prove there is no successful payment, no conflicting in-flight attempt, and a read-back plan before retrying or canceling payment.',
  },
  'MTR-PAY-003': {
    severity: 'error',
    title: 'Payment cancellation state review missing',
    remediation: 'Cancel only a reviewed pending payment attempt and document customer communication, retry/remediation, and payment read-back evidence before future live execution.',
  },
  'MTR-IDEMP-001': {
    severity: 'error',
    title: 'Create workflow missing stable uniqueness key',
    remediation: 'Provide a deterministic contractUniquenessKey of 128 characters or fewer for successor contract creation.',
  },
  'MTR-IDEMP-002': {
    severity: 'error',
    title: 'Usage ingest missing stable transaction id',
    remediation: 'Provide one stable transaction_id per event and reuse the same transaction_id for retries.',
  },
  'MTR-IDEMP-003': {
    severity: 'error',
    title: 'Create workflow duplicate-prevention evidence missing',
    remediation: 'Review existing objects by stable business key before future create workflows so retries or re-runs do not create duplicate catalog objects.',
  },
  'MTR-VERIFY-001': {
    severity: 'error',
    title: 'Read-back verification missing',
    remediation: 'Provide read-back verification for each endpoint or business effect that a future apply would change.',
  },
  'MTR-VERIFY-002': {
    severity: 'error',
    title: 'Rollback or remediation plan missing',
    remediation: 'Provide a specific rollbackPlan describing how to recover if the move preview or future apply is wrong.',
  },
  'MTR-VERIFY-003': {
    severity: 'error',
    title: 'Bulk workflow lacks canary plan',
    remediation: 'Provide a one-customer or one-event canary plan, read-back checks, and resume criteria before bulk execution.',
  },
  'MTR-USAGE-001': {
    severity: 'error',
    title: 'Historical usage invoice-period risk not reviewed',
    remediation: 'State the invoice period target, finalized-period status, preview-events requirement, and remediation path before any ingest workflow.',
  },
  'MTR-USAGE-002': {
    severity: 'error',
    title: 'Usage event shape incomplete',
    remediation: 'Provide customer_id, event_type, timestamp, transaction_id, and required dimensional properties for each usage event.',
  },
  'MTR-USAGE-003': {
    severity: 'error',
    title: 'Usage ingest batch lacks canary or period target',
    remediation: 'Provide explicit invoicePeriodTarget, canaryEventCount, and post-ingest read-back plan before bulk ingest.',
  },
  'MTR-CREDIT-001': {
    severity: 'error',
    title: 'Access schedule credit type missing',
    remediation: 'Provide accessCreditTypeId for the product or access credit type.',
  },
  'MTR-CREDIT-002': {
    severity: 'error',
    title: 'Invoice schedule credit type must be fiat',
    remediation: 'Omit invoiceSchedule for a pure access grant, or use a fiat credit type such as USD cents for a zero-dollar audit line.',
  },
  'MTR-CREDIT-003': {
    severity: 'error',
    title: 'Complimentary grant includes invoice schedule without explicit audit intent',
    remediation: 'Omit invoiceSchedule, or set invoiceSchedule.auditLineIntentConfirmed to true and keep unitPriceCents at 0.',
  },
  'MTR-CREDIT-004': {
    severity: 'error',
    title: 'Paid top-up lacks amount in cents',
    remediation: 'For paid credit workflows, provide a positive fiat amount in cents. Complimentary grants must use 0 when an audit line is intended.',
  },
  'MTR-CREDIT-005': {
    severity: 'error',
    title: 'Custom-field key approval missing',
    remediation: 'Approve every custom field key for the target Metronome object type before including custom_fields in a preview payload.',
  },
  'MTR-CREDIT-006': {
    severity: 'error',
    title: 'Paid top-up invoice and Stripe behavior missing',
    remediation: 'State paid_topup_invoice_expected, paymentGateType STRIPE, explicit stripeBehavior, duplicate-name review, read-back checks, and rollback/remediation before preview.',
  },
  'MTR-REPO-001': {
    severity: 'error',
    title: 'One-off script promoted into CLI workflow',
    remediation: 'Extract reusable logic into tested metronome-cli modules and leave old one-off or quarantined scripts as evidence only.',
  },
  'MTR-REPO-002': {
    severity: 'error',
    title: 'Generated artifact used as canonical source',
    remediation: 'Use generated artifacts only as evidence with a boundary document; cite current source files for workflow behavior.',
  },
  'MTR-REPO-003': {
    severity: 'error',
    title: 'Hyperline evidence used as current integration',
    remediation: 'Keep Hyperline evidence historical unless the user explicitly asks for legacy migration work.',
  },
};

function rule(id) {
  const found = RULES[id];
  if (!found) throw new Error(`Unknown validator rule: ${id}`);
  return found;
}

module.exports = {
  RULES,
  rule,
};
