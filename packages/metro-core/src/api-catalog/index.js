'use strict';

const CATALOG_SCHEMA_VERSION = 'metro.api.catalog.v1';
const ENDPOINT_SCHEMA_VERSION = 'metro.api.endpoint.v1';
const API_SEARCH_SCHEMA_VERSION = 'metro.api.search.v1';
const API_DIFF_SCHEMA_VERSION = 'metro.api.diff.v1';
const PERMISSION_SCOPE_SCHEMA_VERSION = 'metro.api.permission-scopes.v1';
const APPROVAL_POLICY_SCHEMA_VERSION = 'metro.api.approval-policies.v1';

const LOCAL_ONLY_LIVE_EXECUTION = {
  enabledInCurrentCli: false,
  reason: 'The current CLI exposes reviewed endpoint contracts only; it does not load API clients or run live expert API commands.',
  nextSafeStep: 'Use metro api explain <endpoint-id> plus the supported workflow preview or inspect-plan command before any future live runner is added.',
};

const TENANT_REQUIRED = {
  required: true,
  selection: '--sandbox|--prod or a single-tenant profile',
  baseUrlShared: true,
};

const READ_GATES = [
  'explicit tenant',
  'reviewed endpoint id',
  'tenant-scoped profile',
  'guarded read client',
  'stable output contract',
  'secret-free logging',
];

const WRITE_GATES = [
  'explicit tenant',
  'reviewed endpoint id',
  'local validation',
  'preview payload hash',
  'preflight evidence',
  'sandbox proof',
  'canary plan',
  'audit row',
  'read-back verification',
  'rollback or remediation plan',
  'owner approval',
];

const SIDE_EFFECT_PROFILE_SCHEMA_VERSION = 'metro.api.side-effect-profile.v1';

const SIDE_EFFECT_PROFILES = {
  'usage.ingest': {
    schemaVersion: SIDE_EFFECT_PROFILE_SCHEMA_VERSION,
    riskClass: 'usage-invoice-period-risk',
    summary: 'Future ingest writes usage events that can affect usage quantities, commit burn-down, threshold behavior, invoice lines, and customer-visible Stripe amounts for the target invoice period.',
    futureLiveSideEffects: [
      'Accepted events can change billable usage quantities for the matching customer, metric, and period.',
      'Past-dated events inside the ingest window can alter finalized-period economics or trigger follow-up billing effects.',
      'Retries are safe only when every event keeps a stable transaction_id.',
    ],
    requiredReviews: [
      'invoice-period target review',
      'transaction_id idempotency proof',
      'one-event canary and stop criteria',
      'events.search and usage.groups read-back plan',
      'invoice preview or invoice read-back plan',
    ],
    rollbackOrRemediation: [
      'Bad ingest has no simple delete path; remediation must explain reversal, credit, invoice correction, or support escalation before apply.',
    ],
    sources: [
      'skills/metronome-ingestion-events/SKILL.md#past-dated-ingest--retroactive-invoice-inflation',
      'skills/metronome-danger-zone/SKILL.md#14-past-dated-usage-ingest-can-change-finalized-period-economics',
    ],
  },
  'packages.create': {
    schemaVersion: SIDE_EFFECT_PROFILE_SCHEMA_VERSION,
    riskClass: 'package-catalog-risk',
    summary: 'Future package creation adds reusable package catalog state that later contract creates can resolve by alias at the contract starting_at timestamp.',
    futureLiveSideEffects: [
      'A package alias can change which package version future contracts attach to after the alias becomes live.',
      'Wrong terms, billing frequency, credits, or uniqueness key can create a reusable bad contract template.',
      'Package creation itself does not bill a customer, but contracts created from the package can produce invoices and Stripe delivery.',
    ],
    requiredReviews: [
      'package alias and starting_at handoff review',
      'rate card, package terms, billing frequency, and entitlement review',
      'contract-create compatibility review',
      'stable uniqueness key review',
    ],
    rollbackOrRemediation: [
      'Remediation usually requires a corrected package version and alias handoff; do not archive the old package until replacement alias read-back is verified.',
    ],
    sources: [
      'skills/metronome-packages-contracts/SKILL.md#packages--contracts-mental-model',
      'skills/metronome-danger-zone/references/endpoint-matrix.md#5-packages',
    ],
  },
  'packages.archive': {
    schemaVersion: SIDE_EFFECT_PROFILE_SCHEMA_VERSION,
    riskClass: 'package-alias-handoff-risk',
    summary: 'Future package archive hides a package version from new use; existing contracts remain attached, but alias handoff timing can break new contract creation if archived too early.',
    futureLiveSideEffects: [
      'Existing contracts on the archived package are not changed by package archive.',
      'New package_alias contract creation can fail if the old package is archived before the replacement alias is live for the contract starting_at.',
      'Archive must target package_id from read-back evidence, not an alias-only guess.',
    ],
    requiredReviews: [
      'replacement package owns the same alias',
      'alias live timestamp is in the past for intended contract starting_at values',
      'contracts-on-package inventory',
      'post-archive package get/list read-back plan',
    ],
    rollbackOrRemediation: [
      'Rollback may require creating or activating a replacement package version; archive is not treated as a reversible normal workflow.',
    ],
    sources: [
      'skills/metronome-packages-contracts/SKILL.md#package-archive-vs-rate-card-archive-field-names',
      'skills/metronome-danger-zone/references/endpoint-matrix.md#5-packages',
    ],
  },
  'contracts.create': {
    schemaVersion: SIDE_EFFECT_PROFILE_SCHEMA_VERSION,
    riskClass: 'contract-invoice-access-risk',
    summary: 'Future contract creation can grant or remove access, attach packages or direct pricing, start invoice schedules, and route billable output to Stripe when billing provider configuration is active.',
    futureLiveSideEffects: [
      'Package contract create accepts a restricted payload; direct terms, commits, overrides, subscriptions, or scheduled charges must not be mixed with package_alias.',
      'Package_alias resolves at the contract starting_at timestamp, not at command runtime.',
      'A package contract with Stripe billing requires billing-provider configuration first or it can fail; invoice-producing terms can create DRAFT or immediate invoices depending on timing.',
      'Transition payloads can alter predecessor/successor contract chains and future invoice behavior.',
    ],
    requiredReviews: [
      'customer identity proof',
      'billing-provider and Stripe behavior review',
      'package/direct contract separation',
      'hour-boundary starting_at',
      'stable uniqueness key',
      'contract and invoice read-back plan',
    ],
    rollbackOrRemediation: [
      'Rollback may require end-dating, successor contract creation, credit adjustments, invoice void/regenerate review, or Stripe reconciliation; archive/void is not a default rollback.',
    ],
    sources: [
      'skills/metronome-packages-contracts/SKILL.md#transitions-renewal-supersede--package-based-plan-changes',
      'skills/metronome-packages-contracts/SKILL.md#validate-all-successor-create-fields-before-updateenddate',
      'skills/metronome-stripe-delivery/SKILL.md#working-payloads',
    ],
  },
  'contracts.updateEndDate': {
    schemaVersion: SIDE_EFFECT_PROFILE_SCHEMA_VERSION,
    riskClass: 'contract-end-date-invoice-risk',
    summary: 'Future end-date updates mutate an existing contract boundary and can affect draft statements, upcoming scheduled invoices, and predecessor/successor transition safety.',
    futureLiveSideEffects: [
      'Shortening can truncate draft statements and remove upcoming scheduled invoices.',
      'allow_ending_before_finalized_invoice defaults to permissive behavior unless explicitly set; future runners must bind the reviewed boolean.',
      'In two-step plan moves, this call mutates the predecessor before the successor contract exists.',
    ],
    requiredReviews: [
      'successor-create payload validation before end-date mutation',
      'finalized invoice protection decision',
      'draft and upcoming invoice inventory',
      'rollback or remediation plan for successor create failure',
    ],
    rollbackOrRemediation: [
      'If successor creation fails after end-date mutation, retry only the successor with a corrected stable idempotency key or execute the preplanned remediation; do not move the predecessor repeatedly.',
    ],
    sources: [
      'skills/metronome-packages-contracts/SKILL.md#updateenddate--shorten-or-extend-a-contract-cleanly',
      'skills/metronome-packages-contracts/SKILL.md#validate-all-successor-create-fields-before-updateenddate',
    ],
  },
  'contracts.edit.v2': {
    schemaVersion: SIDE_EFFECT_PROFILE_SCHEMA_VERSION,
    riskClass: 'contract-edit-invoice-access-risk',
    summary: 'Future contract edits can add commits, credits, overrides, subscriptions, scheduled charges, or other changes that affect access, balances, invoices, and Stripe delivery.',
    futureLiveSideEffects: [
      'Past-dated scheduled charges can finalize immediately and push to Stripe when billing configuration is active.',
      'Commit and credit edits can change customer access balances and invoice artifacts.',
      'Transitioned contracts with finalized invoices may reject edits, requiring a different remediation path.',
    ],
    requiredReviews: [
      'edit operation allowlist review',
      'invoice and Stripe behavior review',
      'commit/credit type placement review when balances are touched',
      'contract edit-history and balance read-back plan',
    ],
    rollbackOrRemediation: [
      'Remediation depends on the edit type and can require follow-up contract edits, balance corrections, invoice void/regenerate review, or Stripe reconciliation.',
    ],
    sources: [
      'skills/metronome-packages-contracts/SKILL.md#editcontract-vs-a-dedicated-endpoint',
      'skills/metronome-packages-contracts/SKILL.md#past-dated-add_scheduled_charges-finalize-immediately',
      'skills/metronome-invoicing/SKILL.md#mental-model',
    ],
  },
  'contracts.updateInvoiceIssueDate': {
    schemaVersion: SIDE_EFFECT_PROFILE_SCHEMA_VERSION,
    riskClass: 'invoice-schedule-risk',
    summary: 'Future invoice issue-date updates move a DRAFT invoice issue date and can change when a customer is billed or when Stripe receives the invoice.',
    futureLiveSideEffects: [
      'Only DRAFT invoices are eligible; finalized invoices require separate void/regenerate and Stripe reconciliation review.',
      'The new issue date must remain inside contract-end evidence.',
      'Moving the issue date can defer or alter customer-visible billing timing.',
    ],
    requiredReviews: [
      'DRAFT invoice state proof',
      'contract end evidence',
      'billing-provider and Stripe draft behavior review',
      'invoice read-back plan',
    ],
    rollbackOrRemediation: [
      'Remediation must explain how to move the DRAFT invoice again or handle invoice/Stripe mismatch if the invoice state changes before apply.',
    ],
    sources: [
      'skills/metronome-packages-contracts/SKILL.md#updateinvoiceissuedate--push-a-draft-invoice-forward',
      'skills/metronome-invoicing/SKILL.md#mental-model',
    ],
  },
  'invoices.preview': {
    schemaVersion: SIDE_EFFECT_PROFILE_SCHEMA_VERSION,
    riskClass: 'live-preview-billing-estimate-risk',
    summary: 'Future invoice preview is read-shaped but asks Metronome to calculate invoice impact for proposed usage events; it must be tenant-explicit and tied to an invoice-period target.',
    futureLiveSideEffects: [
      'Preview does not apply writes, but it may expose billing amounts, line items, and customer invoice context.',
      'A misleading preview period can hide finalized-period or follow-up invoice risk before ingest.',
    ],
    requiredReviews: [
      'invoice-period target evidence',
      'event batch validation',
      'secret-free output destination',
      'comparison plan before ingest apply',
    ],
    rollbackOrRemediation: [
      'No write rollback is expected for preview, but bad preview evidence must block downstream ingest apply.',
    ],
    sources: [
      'skills/metronome-ingestion-events/SKILL.md#did-the-event-land',
      'skills/metronome-invoicing/SKILL.md#mental-model',
    ],
  },
  'invoices.void': {
    schemaVersion: SIDE_EFFECT_PROFILE_SCHEMA_VERSION,
    riskClass: 'invoice-void-stripe-reconciliation-risk',
    summary: 'Future invoice void writes can mark a finalized Metronome invoice VOID without refunding Stripe, creating a reconciliation gap if money was already collected.',
    futureLiveSideEffects: [
      'The endpoint only applies to FINALIZED invoices; DRAFT invoices must be handled through issue-date, contract, scheduled-charge, or watcher workflows.',
      'Voiding in Metronome does not refund Stripe or cancel external customer communication automatically.',
      'A voided paid invoice can leave Stripe-collected cash with no corresponding Metronome billed revenue unless reconciliation is planned.',
    ],
    requiredReviews: [
      'invoice FINALIZED state proof',
      'Stripe external_invoice and payment status review',
      'Stripe no-refund and finance reconciliation plan',
      'customer invoice inventory before void',
      'invoice and payment read-back plan after void',
      'owner-approved remediation path',
    ],
    rollbackOrRemediation: [
      'Void is not treated as a reversible normal workflow; remediation can require invoice regeneration, replacement invoice delivery, Stripe refund or collection adjustment, or finance reconciliation.',
    ],
    sources: [
      'skills/metronome-danger-zone/SKILL.md#12-v1invoicesvoid-on-a-finalized-paid-invoice',
      'skills/metronome-danger-zone/references/endpoint-matrix.md#11-invoices',
      'https://docs.metronome.com/api-reference/invoices/void-an-invoice.md',
    ],
  },
  'invoices.regenerate': {
    schemaVersion: SIDE_EFFECT_PROFILE_SCHEMA_VERSION,
    riskClass: 'invoice-regenerate-reissue-risk',
    summary: 'Future invoice regeneration can replace a VOIDED invoice with updated rates or balances and may reintroduce customer-visible billing and Stripe delivery effects.',
    futureLiveSideEffects: [
      'Regenerate is intended for VOIDED invoices after a correction review, not for DRAFT or still-finalized invoices.',
      'Updated rates, balances, credits, or contract edits can change the regenerated invoice amount from the original invoice.',
      'If billing-provider configuration is active, regenerated invoice delivery and Stripe state require explicit review.',
    ],
    requiredReviews: [
      'VOIDED invoice state proof',
      'rate, balance, contract edit, or credit correction evidence',
      'billing-provider and Stripe delivery behavior review',
      'replacement invoice read-back plan',
      'payment and reconciliation review',
      'owner-approved remediation path',
    ],
    rollbackOrRemediation: [
      'If regeneration produces the wrong amount or delivery state, stop further billing actions and use a separately reviewed void/regenerate, Stripe reconciliation, or customer communication plan.',
    ],
    sources: [
      'skills/metronome-danger-zone/SKILL.md#2c-side-discovered-useful-endpoints',
      'skills/metronome-danger-zone/references/endpoint-matrix.md#11-invoices',
      'https://docs.metronome.com/api-reference/invoices/regenerate-an-invoice.md',
    ],
  },
  'payments.attempt': {
    schemaVersion: SIDE_EFFECT_PROFILE_SCHEMA_VERSION,
    riskClass: 'stripe-payment-attempt-risk',
    summary: 'Future payment-attempt writes can trigger a new Stripe collection attempt for a finalized Metronome invoice through the configured billing provider path.',
    futureLiveSideEffects: [
      'Payment attempt requires a FINALIZED invoice, tenant PLG invoicing support, Stripe billing provider attachment, and no prior successful payment.',
      'A successful attempt can collect customer funds through Stripe.',
      'A duplicate or poorly timed attempt can confuse support, customer communication, or finance reconciliation even when Stripe blocks duplicate collection.',
    ],
    requiredReviews: [
      'FINALIZED invoice state proof',
      'PLG invoicing enablement proof',
      'Stripe billing-provider attachment proof',
      'no successful payment attempt proof',
      'customer/payment method readiness review',
      'payment read-back and customer communication plan',
    ],
    rollbackOrRemediation: [
      'Payment collection cannot be undone by Metronome alone; remediation may require Stripe refund, invoice void/regenerate, customer communication, or finance reconciliation.',
    ],
    sources: [
      'skills/metronome-danger-zone/references/endpoint-matrix.md#12-payments',
      'https://docs.metronome.com/api-reference/payments/attempt-payment-for-an-invoice.md',
    ],
  },
  'payments.cancel': {
    schemaVersion: SIDE_EFFECT_PROFILE_SCHEMA_VERSION,
    riskClass: 'stripe-payment-cancel-risk',
    summary: 'Future payment cancellation can cancel a pending invoice payment attempt and leave the invoice unpaid until a retry or separate remediation path is approved.',
    futureLiveSideEffects: [
      'Cancel applies only to pending payment attempts; successful, failed, or absent attempts need different remediation.',
      'Canceling payment can stop expected collection and may require customer communication or a later retry.',
      'Invoice state, payment state, and Stripe state must be reconciled after cancellation.',
    ],
    requiredReviews: [
      'pending payment attempt proof from payments.listForInvoice',
      'invoice and customer identity proof',
      'customer communication and collection impact review',
      'retry or remediation plan',
      'payment read-back plan',
    ],
    rollbackOrRemediation: [
      'Remediation is a separately reviewed payment retry, invoice correction, or customer/finance follow-up after payment-state read-back.',
    ],
    sources: [
      'skills/metronome-danger-zone/references/endpoint-matrix.md#12-payments',
      'https://docs.metronome.com/api-reference/payments/cancel-a-payment-for-an-invoice.md',
    ],
  },
  'customers.create': {
    schemaVersion: SIDE_EFFECT_PROFILE_SCHEMA_VERSION,
    riskClass: 'customer-identity-routing-risk',
    summary: 'Future customer creation adds tenant-global customer identity and ingest aliases that later usage, contracts, invoices, and Stripe delivery can depend on.',
    futureLiveSideEffects: [
      'Ingest aliases are tenant-global routing keys; the wrong alias can route usage to the wrong customer.',
      'Archived customers can retain alias collisions, so duplicate checks must include active and archived customer search evidence.',
      'Inline billing-provider configuration can affect where future invoices are delivered once contracts exist.',
      'Customer create does not by itself create contracts, commits, credits, subscriptions, or invoices.',
    ],
    requiredReviews: [
      'customer identity proof',
      'active and archived ingest-alias collision review',
      'custom-field allowlist review when custom fields are present',
      'billing-provider and Stripe behavior review when inline configuration is present',
      'customer get/list read-back plan',
      'no-invoice-side-effect verification plan',
    ],
    rollbackOrRemediation: [
      'If a customer is created incorrectly, stop before contracts exist; remediation must separately review alias release, rename/config updates, or archive side effects.',
    ],
    sources: [
      'skills/metronome-customers-hierarchies/SKILL.md',
      'skills/metronome-stripe-delivery/SKILL.md',
      'skills/metronome-danger-zone/references/endpoint-matrix.md#6-customers',
    ],
  },
  'customers.archive': {
    schemaVersion: SIDE_EFFECT_PROFILE_SCHEMA_VERSION,
    riskClass: 'customer-archive-invoice-risk',
    summary: 'Future customer archive can archive contracts and void invoices for the customer; it must never be used as a routine cleanup or rollback shortcut.',
    futureLiveSideEffects: [
      'Archiving a customer also archives contracts associated with the customer.',
      'Customer archive can void invoices and does not refund or reconcile Stripe automatically.',
      'Archived customer aliases can still create future duplicate or routing confusion if replacement aliases are not reviewed.',
    ],
    requiredReviews: [
      'customer identity proof',
      'active contract inventory',
      'draft and finalized invoice inventory',
      'Stripe refund/reconciliation non-coverage review',
      'alias replacement or release plan',
      'explicit rollback or remediation plan',
    ],
    rollbackOrRemediation: [
      'Rollback is not treated as normal operation; remediation requires a separately approved replacement customer, contract, invoice, alias, and Stripe reconciliation plan.',
    ],
    sources: [
      'skills/metronome-customers-hierarchies/SKILL.md',
      'skills/metronome-danger-zone/SKILL.md',
      'skills/metronome-danger-zone/references/endpoint-matrix.md#6-customers',
    ],
  },
  'customers.updateConfig': {
    schemaVersion: SIDE_EFFECT_PROFILE_SCHEMA_VERSION,
    riskClass: 'customer-config-stripe-draft-risk',
    summary: 'Future customer config updates can change first-class customer metadata and whether later Stripe invoices are left in draft.',
    futureLiveSideEffects: [
      'Changing salesforce_account_id can affect CRM/reporting joins and downstream reconciliation.',
      'Changing leave_stripe_invoices_in_draft can alter review behavior for future Stripe invoice delivery.',
    ],
    requiredReviews: [
      'customer identity proof',
      'CRM field mapping review when salesforce_account_id changes',
      'Stripe draft behavior review when leave_stripe_invoices_in_draft changes',
      'customer get read-back plan',
    ],
    rollbackOrRemediation: [
      'Rollback must be another reviewed config update plus read-back verification; invoice delivery that already happened may require separate Stripe remediation.',
    ],
    sources: [
      'skills/metronome-customers-hierarchies/SKILL.md',
      'skills/metronome-stripe-delivery/SKILL.md',
      'skills/metronome-danger-zone/references/endpoint-matrix.md#6-customers',
    ],
  },
  'customers.updateName': {
    schemaVersion: SIDE_EFFECT_PROFILE_SCHEMA_VERSION,
    riskClass: 'customer-display-name-risk',
    summary: 'Future customer rename changes a customer-visible and operator-visible display name that can affect invoice review, search, and support workflows.',
    futureLiveSideEffects: [
      'The new name can appear in Metronome UI, customer lookup, invoice review, and operational support contexts.',
      'Wrong names can cause customer identity confusion even when ids are unchanged.',
    ],
    requiredReviews: [
      'customer identity proof',
      'customer-facing name review',
      'CRM/source-name evidence',
      'customer get read-back plan',
    ],
    rollbackOrRemediation: [
      'Rollback is a reviewed rename back to the prior value plus customer get read-back verification.',
    ],
    sources: [
      'skills/metronome-customers-hierarchies/SKILL.md',
      'skills/metronome-danger-zone/references/endpoint-matrix.md#6-customers',
    ],
  },
  'customers.setIngestAliases': {
    schemaVersion: SIDE_EFFECT_PROFILE_SCHEMA_VERSION,
    riskClass: 'customer-ingest-alias-routing-risk',
    summary: 'Future ingest-alias updates change how incoming usage events resolve to a customer and can affect all later usage billing for those aliases.',
    futureLiveSideEffects: [
      'Moving or adding aliases can route future usage events to a different customer.',
      'Alias collisions with active or archived customers can block setup or create ambiguous remediation.',
      'Usage already ingested before the alias change is not automatically moved.',
    ],
    requiredReviews: [
      'customer identity proof',
      'active and archived alias collision review',
      'usage routing cutover plan',
      'events.search or usage read-back plan after alias change',
    ],
    rollbackOrRemediation: [
      'Rollback requires another reviewed alias update and explicit usage remediation for any events routed during the bad window.',
    ],
    sources: [
      'skills/metronome-customers-hierarchies/SKILL.md',
      'skills/metronome-ingestion-events/SKILL.md',
      'skills/metronome-danger-zone/references/endpoint-matrix.md#6-customers',
    ],
  },
  'billingProvider.setCustomerConfigurations': {
    schemaVersion: SIDE_EFFECT_PROFILE_SCHEMA_VERSION,
    riskClass: 'stripe-delivery-risk',
    summary: 'Future billing-provider configuration writes can change whether and where Metronome invoices are delivered to Stripe for a customer.',
    futureLiveSideEffects: [
      'Setting the wrong Stripe customer or delivery method can route future invoices to the wrong Stripe destination.',
      'Archiving or replacing configs is permanent in normal operations; archived configs are restored by creating a new config id.',
      'Draft behavior and delivery method choices affect whether invoices remain reviewable before Stripe delivery.',
    ],
    requiredReviews: [
      'Stripe customer identity proof',
      'delivery_method versus delivery_method_id decision',
      'existing config reuse/fail policy',
      'billing-provider read-back plan',
      'Stripe draft behavior review',
    ],
    rollbackOrRemediation: [
      'Rollback requires setting a corrected billing-provider configuration and reconciling any invoices delivered while the wrong config was active.',
    ],
    sources: [
      'skills/metronome-stripe-delivery/SKILL.md#working-payloads',
      'skills/metronome-danger-zone/references/endpoint-matrix.md#7-billing-provider-configs-stripe',
    ],
  },
  'customFields.addKey': {
    schemaVersion: SIDE_EFFECT_PROFILE_SCHEMA_VERSION,
    riskClass: 'custom-field-allowlist-risk',
    summary: 'Future custom-field key creation mutates the per-entity custom-field allowlist that downstream setValues calls, contracts, commits, products, invoices, and alerts can rely on.',
    futureLiveSideEffects: [
      'Adding a key makes that custom field available for the selected managed entity type.',
      'The enforce_uniqueness choice can cause future value-setting calls to reject duplicate values for that key.',
      'Keys on products, customers, contracts, invoices, commits, scheduled charges, and subscriptions can flow into invoice metadata or downstream business processes.',
    ],
    requiredReviews: [
      'target managed entity review',
      'custom-field key naming and ownership review',
      'enforce_uniqueness decision',
      'pre-create listKeys collision check',
      'post-create listKeys read-back plan',
    ],
    rollbackOrRemediation: [
      'Remediation may require removeKey only after reviewing downstream setValues usage; do not assume allowlist removal is a harmless rollback.',
    ],
    sources: [
      'skills/metronome-danger-zone/SKILL.md#16-custom-field-writes-on-contractscommits',
      'skills/metronome-danger-zone/references/endpoint-matrix.md#8-custom-fields',
      'https://docs.metronome.com/api-reference/custom-fields/create-a-custom-field-key.md',
    ],
  },
  'customFields.removeKey': {
    schemaVersion: SIDE_EFFECT_PROFILE_SCHEMA_VERSION,
    riskClass: 'custom-field-allowlist-removal-risk',
    summary: 'Future custom-field key removal mutates the per-entity allowlist and makes existing values for that key inaccessible through Metronome.',
    futureLiveSideEffects: [
      'Removing a key prevents future use of that custom field across all instances of the selected managed entity type.',
      'Existing values for the removed key on entity instances are no longer accessible after removal.',
      'Allowlist removal can break downstream setValues workflows, invoice metadata assumptions, reporting joins, and internal automations that expect the key to exist.',
    ],
    requiredReviews: [
      'target managed entity review',
      'custom-field key ownership review',
      'pre-remove listKeys proof that the key exists',
      'downstream usage and reporting impact review',
      'post-remove listKeys read-back plan',
    ],
    rollbackOrRemediation: [
      'Remediation may require addKey plus a separate value restoration plan; do not assume removed existing values become accessible again automatically.',
    ],
    sources: [
      'skills/metronome-danger-zone/SKILL.md#16-custom-field-writes-on-contractscommits',
      'skills/metronome-danger-zone/references/endpoint-matrix.md#8-custom-fields',
      'https://docs.metronome.com/api-reference/custom-fields/delete-a-custom-field-key.md',
    ],
  },
  'customFields.setValues': {
    schemaVersion: SIDE_EFFECT_PROFILE_SCHEMA_VERSION,
    riskClass: 'custom-field-value-write-risk',
    summary: 'Future custom-field value writes mutate metadata on one managed entity instance and can change downstream billing, invoice, reporting, or workflow interpretation.',
    futureLiveSideEffects: [
      'Setting values changes metadata on the selected entity instance in one transactional write.',
      'Unknown keys are rejected unless the key is already allowlisted for the selected managed entity type.',
      'Values on customers, contracts, commits, invoices, subscriptions, products, and scheduled charges can feed invoice metadata, reporting joins, or downstream business processes.',
    ],
    requiredReviews: [
      'target managed entity and entity_id identity proof',
      'pre-write listKeys allowlist proof',
      'custom field key ownership review',
      'value length and sensitivity review',
      'post-write entity read-back plan',
    ],
    rollbackOrRemediation: [
      'Rollback requires a follow-up setValues or deleteValues write after reviewing whether downstream systems already consumed the previous metadata.',
    ],
    sources: [
      'skills/metronome-danger-zone/SKILL.md#16-custom-field-writes-on-contractscommits',
      'skills/metronome-danger-zone/references/endpoint-matrix.md#8-custom-fields',
      'https://docs.metronome.com/api-reference/custom-fields/set-custom-field-values.md',
    ],
  },
  'customFields.deleteValues': {
    schemaVersion: SIDE_EFFECT_PROFILE_SCHEMA_VERSION,
    riskClass: 'custom-field-value-deletion-risk',
    summary: 'Future custom-field value deletion removes selected metadata keys from one managed entity instance while preserving other fields.',
    futureLiveSideEffects: [
      'Deleting values removes selected custom field data from the target entity instance.',
      'The write preserves other custom fields on the same entity but can still change billing operations metadata, reporting joins, or downstream workflow behavior.',
      'Deleting values does not remove the allowlisted key itself; future setValues calls can re-add values unless the key is also removed from the allowlist.',
    ],
    requiredReviews: [
      'target managed entity and entity_id identity proof',
      'pre-delete entity read-back evidence for existing values',
      'custom field key ownership review',
      'downstream metadata consumer impact review',
      'post-delete entity read-back plan',
    ],
    rollbackOrRemediation: [
      'Rollback requires a follow-up setValues write with reviewed source values; deleted metadata should be treated as lost unless preserved in pre-delete evidence.',
    ],
    sources: [
      'skills/metronome-danger-zone/SKILL.md#16-custom-field-writes-on-contractscommits',
      'skills/metronome-danger-zone/references/endpoint-matrix.md#8-custom-fields',
      'https://docs.metronome.com/api-reference/custom-fields/delete-custom-fields.md',
    ],
  },
  'billableMetrics.create': {
    schemaVersion: SIDE_EFFECT_PROFILE_SCHEMA_VERSION,
    riskClass: 'billable-metric-configuration-risk',
    summary: 'Future billable-metric creation defines a new metering reducer for incoming events; the reviewed local contract supports standard streaming metrics only and keeps SQL metrics unsupported.',
    futureLiveSideEffects: [
      'A created metric becomes available for Products, usage endpoints, and alerts, but only processes matching events ingested after creation.',
      'Wrong event filters, property filters, aggregation type, aggregation key, or group keys can create bad usage quantities that require a replacement metric and product schedule remediation.',
      'Overlapping metrics can count the same event stream more than once if Products or rate cards later wire them into billable catalog state.',
    ],
    requiredReviews: [
      'event type filter and property filter proof',
      'aggregation type and aggregation key review',
      'group key and dimensional product compatibility review',
      'duplicate or overlapping metric review',
      'non-retroactivity and backfill window review',
      'post-create get/list read-back plan',
    ],
    rollbackOrRemediation: [
      'Remediation usually requires creating a replacement metric, scheduling affected Products to use it at a reviewed hour-boundary timestamp, closing or replacing impacted rate entries when needed, and archiving the bad metric only after dependency review.',
    ],
    sources: [
      'skills/metronome-ingestion-events/SKILL.md#billable-metrics-the-consumer-of-events',
      'skills/metronome-danger-zone/references/endpoint-matrix.md#2-billable-metrics',
      'https://docs.metronome.com/api-reference/billable-metrics/create-a-billable-metric.md',
    ],
  },
  'billableMetrics.update': {
    schemaVersion: SIDE_EFFECT_PROFILE_SCHEMA_VERSION,
    riskClass: 'billable-metric-display-name-risk',
    summary: 'Future billable-metric update can rename a metric but cannot change aggregation, filters, grouping, SQL, or other metering configuration after creation.',
    futureLiveSideEffects: [
      'The metric display name changes for operators and API consumers that rely on billable metric names.',
      'The existing metric configuration stays immutable through this endpoint; configuration changes require a replacement metric and product schedule review.',
      'Wrong-name updates can create catalog/reporting ambiguity even when usage rating behavior is unchanged.',
    ],
    requiredReviews: [
      'billable metric identity proof',
      'display-name ownership and naming standard review',
      'configuration-change refusal review',
      'post-update get/list read-back plan',
    ],
    rollbackOrRemediation: [
      'Remediation is a follow-up rename to the reviewed prior or corrected name; configuration mistakes require replacement metric and product schedule remediation, not this endpoint.',
    ],
    sources: [
      'skills/metronome-danger-zone/references/endpoint-matrix.md#2-billable-metrics',
      'https://docs.metronome.com/api-reference/billable-metrics/update-a-billable-metric.md',
    ],
  },
  'billableMetrics.archive': {
    schemaVersion: SIDE_EFFECT_PROFILE_SCHEMA_VERSION,
    riskClass: 'billable-metric-archive-risk',
    summary: 'Future billable-metric archive retires a metric from new Product metering setup while existing Products associated with that metric continue to function as usual.',
    futureLiveSideEffects: [
      'Archived metrics can no longer be used in new Products to define metering.',
      'Existing Products associated with the archived metric continue metering based on the archived metric definition.',
      'Archived metrics still appear in get/list read-backs with archived_at populated, so verification must include archived metric visibility.',
    ],
    requiredReviews: [
      'billable metric identity proof',
      'new Product dependency and rollout impact review',
      'existing Product association inventory',
      'post-archive get/list include_archived read-back plan',
    ],
    rollbackOrRemediation: [
      'Remediation usually requires creating or selecting a replacement billable metric and scheduling affected Products to use it; archive is not treated as a harmless toggle.',
    ],
    sources: [
      'skills/metronome-danger-zone/references/endpoint-matrix.md#2-billable-metrics',
      'https://docs.metronome.com/api-reference/billable-metrics/archive-a-billable-metric.md',
    ],
  },
  'products.create': {
    schemaVersion: SIDE_EFFECT_PROFILE_SCHEMA_VERSION,
    riskClass: 'product-catalog-create-risk',
    summary: 'Future product creation adds a customer-invoice-visible catalog item; the reviewed local expert contract supports USAGE products only and keeps fixed, subscription, composite, and professional-service product creation unsupported.',
    futureLiveSideEffects: [
      'The product name can appear on customer invoices, so internal action codes or owner breadcrumbs must stay out of body.name.',
      'A USAGE product points at a billable metric and can later be priced on rate cards; duplicate products on the same metric can double-price matching events when entitled rates are added.',
      'Dimensional pricing keys must be backed by one compatible compound billable-metric group key before the product is created.',
    ],
    requiredReviews: [
      'customer-facing product name review',
      'billable metric identity and group-key proof',
      'duplicate product and shadower review',
      'tag and internal breadcrumb placement review',
      'post-create products.get/list read-back plan before addRates',
    ],
    rollbackOrRemediation: [
      'If no rates reference the bad product, remediation can archive it after product get/list proof. If rates were added, first close affected rate-card entries with addRates entitled:false and price:0, then archive or replace the product and review invoice impact.',
    ],
    sources: [
      'skills/metronome-pricing-catalog/SKILL.md#create-a-usage-product',
      'skills/metronome-pricing-catalog/SKILL.md#one-product-per-billable-metric-per-rate-card--a-you-invariant-not-metronomes',
      'skills/metronome-danger-zone/references/endpoint-matrix.md#3-products',
      'https://docs.metronome.com/api-reference/products/create-a-product.md',
    ],
  },
  'products.update': {
    schemaVersion: SIDE_EFFECT_PROFILE_SCHEMA_VERSION,
    riskClass: 'product-scheduled-update-risk',
    summary: 'Future product updates schedule customer-visible or metering configuration changes at starting_at; the reviewed local expert contract supports USAGE product updates only and requires products.get update-history read-back rather than getRates display-name evidence.',
    futureLiveSideEffects: [
      'A scheduled name change can affect customer-visible invoice line names from the update timestamp.',
      'Changing billable_metric_id or dimensional keys changes which events the product meters and prices after the scheduled update.',
      'rateCards.getRates can show the current product_name instead of name-at-timestamp, so scheduled rename verification must use products.get update history.',
    ],
    requiredReviews: [
      'existing product identity and current version proof',
      'starting_at timing and invoice-impact review',
      'customer-facing product name review when name changes',
      'billable metric and dimensional key proof when metering changes',
      'post-update products.get update-history read-back plan',
    ],
    rollbackOrRemediation: [
      'Remediation is a follow-up scheduled product update with the corrected fields when type remains valid. Product type mistakes require replacement product creation, rate-card remediation, and invoice-impact review; do not treat products.update as an in-place type conversion.',
    ],
    sources: [
      'skills/metronome-pricing-catalog/SKILL.md#update-a-product-scheduled-change',
      'skills/metronome-pricing-catalog/SKILL.md#scheduled-renames--getrates-display-name-caching',
      'skills/metronome-danger-zone/references/endpoint-matrix.md#3-products',
      'https://docs.metronome.com/api-reference/products/update-a-product.md',
    ],
  },
  'products.archive': {
    schemaVersion: SIDE_EFFECT_PROFILE_SCHEMA_VERSION,
    riskClass: 'product-rate-card-retirement-risk',
    summary: 'Future product archive prevents future product use but does not remove active rate-card entries or stop existing invoice-line behavior by itself.',
    futureLiveSideEffects: [
      'Active rate-card entries can continue rating usage until closed with entitled:false and price:0.',
      'Customer-visible invoice lines can persist if rate schedules are not closed before archive.',
      'Product archive should follow rate-card schedule read-back, not replace it.',
      'Archived products remain retrievable but cannot be unarchived.',
    ],
    requiredReviews: [
      'existing product identity proof',
      'affected rate-card inventory',
      'entitled:false and price:0 close entries',
      'rate schedule read-back plan',
      'invoice line behavior review',
      'irreversible archive review',
      'post-archive products.get/list read-back plan',
    ],
    rollbackOrRemediation: [
      'Do not assume archive can be reversed. Remediation usually requires a replacement product/rate schedule and invoice-impact review; product archive is not treated as the only retirement step.',
    ],
    sources: [
      'skills/metronome-pricing-catalog/SKILL.md#retiring-a-product--archive--remove-from-rate-card',
      'skills/metronome-danger-zone/SKILL.md#19-product-archive-does-not-remove-rate-entries-from-rate-cards',
      'https://docs.metronome.com/api-reference/products/archive-a-product.md',
    ],
  },
  'rateCards.create': {
    schemaVersion: SIDE_EFFECT_PROFILE_SCHEMA_VERSION,
    riskClass: 'rate-card-catalog-create-risk',
    summary: 'Future rate-card creation adds pricing-catalog container state, aliases, and credit-type conversion rules; product prices still require a separate addRates workflow.',
    futureLiveSideEffects: [
      'A rate-card alias can change which rate card future contract creation resolves when operators use that alias.',
      'Wrong fiat or custom pricing-unit conversion can make later rates invoice in the wrong monetary equivalent.',
      'Creating a duplicate or empty rate card can confuse package and contract provisioning even before rates are added.',
    ],
    requiredReviews: [
      'rate-card name, description, and business purpose review',
      'fiat credit type and custom pricing-unit conversion review',
      'alias uniqueness and schedule review',
      'duplicate rate-card review',
      'post-create rateCards.get/list read-back plan before packages, contracts, or addRates attach',
    ],
    rollbackOrRemediation: [
      'If no packages, contracts, aliases, or rates depend on the bad rate card, remediation can archive it after get/list proof. Otherwise create a corrected rate card, move or close dependent aliases/rates through reviewed workflows, and document package/contract impact.',
    ],
    sources: [
      'skills/metronome-pricing-catalog/SKILL.md#create-a-rate-card-with-custom-credit-conversion',
      'skills/metronome-danger-zone/references/endpoint-matrix.md#4-rate-cards',
      'https://docs.metronome.com/api-reference/rate-cards/create-a-rate-card.md',
    ],
  },
  'rateCards.update': {
    schemaVersion: SIDE_EFFECT_PROFILE_SCHEMA_VERSION,
    riskClass: 'rate-card-metadata-alias-risk',
    summary: 'Future rate-card updates mutate existing rate-card metadata and alias assignments without changing pricing rates or schedules.',
    futureLiveSideEffects: [
      'Rate-card name and description changes affect Metronome UI/API identity, not existing customer pricing.',
      'Alias updates can change which rate card future contract creation resolves when workflows use rate_card_alias.',
      'Already-created contracts continue using their originally assigned rate cards, so alias changes are not a migration of existing contracts.',
    ],
    requiredReviews: [
      'existing rate-card identity proof',
      'metadata naming and description ownership review',
      'alias uniqueness and scheduled transition review when aliases change',
      'post-update rateCards.get/list read-back plan',
    ],
    rollbackOrRemediation: [
      'Remediation is a follow-up metadata or alias update after reviewing future contract creation impact; existing contracts need separate contract/package workflows if they were attached to the wrong rate card.',
    ],
    sources: [
      'skills/metronome-pricing-catalog/SKILL.md#rate-cards',
      'skills/metronome-danger-zone/references/endpoint-matrix.md#4-rate-cards',
      'https://docs.metronome.com/api-reference/rate-cards/update-a-rate-card.md',
    ],
  },
  'rateCards.archive': {
    schemaVersion: SIDE_EFFECT_PROFILE_SCHEMA_VERSION,
    riskClass: 'rate-card-archive-risk',
    summary: 'Future rate-card archive permanently disables a rate card for new contract creation while preserving existing contract pricing.',
    futureLiveSideEffects: [
      'The archived rate card stops appearing in contract creation workflows and should not be used for new contracts.',
      'Existing contracts keep their existing pricing, so archive is not a migration or a price change for already-created contracts.',
      'Packages, aliases, or contract workflows that still depend on the archived rate card can fail or route future customers incorrectly if no replacement is reviewed.',
    ],
    requiredReviews: [
      'existing rate-card identity proof',
      'archive business-purpose review',
      'package and contract dependency inventory',
      'replacement or retirement plan for future contract creation',
      'existing contract pricing preservation review',
      'post-archive rateCards.get/list read-back plan',
    ],
    rollbackOrRemediation: [
      'Do not assume archive is a reversible toggle. Remediation usually requires a reviewed replacement rate card, package or alias update, contract workflow correction, and get/list plus package/contract dependency read-back.',
    ],
    sources: [
      'skills/metronome-pricing-catalog/SKILL.md#rate-cards',
      'skills/metronome-danger-zone/references/endpoint-matrix.md#4-rate-cards',
      'https://docs.metronome.com/api-reference/rate-cards/archive-a-rate-card.md',
    ],
  },
  'rateCards.setProductOrder': {
    schemaVersion: SIDE_EFFECT_PROFILE_SCHEMA_VERSION,
    riskClass: 'rate-card-product-order-risk',
    summary: 'Future rate-card product-order updates change invoice presentation order for products on a rate card without changing prices, entitlements, or schedules.',
    futureLiveSideEffects: [
      'Product order changes affect how products on the rate card appear on customer invoices.',
      'Missing, duplicate, or wrong product ids can make invoice presentation incomplete or misleading even when pricing remains unchanged.',
      'Product-order changes do not move contracts, add rates, or change product entitlement; those require separate reviewed workflows.',
    ],
    requiredReviews: [
      'existing rate-card identity proof',
      'complete product inventory and desired order review',
      'product id read-back review before ordering',
      'invoice presentation impact review',
      'post-update rateCards.getRates/getRateSchedule read-back plan',
    ],
    rollbackOrRemediation: [
      'Remediation is a follow-up setProductOrder request with the corrected product order after rate-card and product read-back; pricing mistakes require separate rate-card or contract workflows.',
    ],
    sources: [
      'skills/metronome-pricing-catalog/SKILL.md#rate-cards',
      'skills/metronome-danger-zone/references/endpoint-matrix.md#4-rate-cards',
      'https://docs.metronome.com/api-reference/rate-cards/set-the-rate-card-products-order.md',
    ],
  },
  'rateCards.addRates': {
    schemaVersion: SIDE_EFFECT_PROFILE_SCHEMA_VERSION,
    riskClass: 'pricing-schedule-risk',
    summary: 'Future addRates writes append or replace scheduled pricing entries and can change entitlement, price, and invoice-line behavior from the starting_at timestamp.',
    futureLiveSideEffects: [
      'Rates are append-only by schedule; the same product_id and starting_at can replace an existing rate at that timestamp.',
      'Wrong entitled, price, credit type, or timestamp can double-bill, stop billing, or change customer access.',
      'starting_at must be an hour-boundary timestamp.',
    ],
    requiredReviews: [
      'rate-card and product identity proof',
      'starting_at hour-boundary proof',
      'entitlement and price review',
      'rate schedule read-back plan',
    ],
    rollbackOrRemediation: [
      'Rollback usually requires another scheduled addRates correction and invoice-impact review for any period already affected.',
    ],
    sources: [
      'skills/metronome-pricing-catalog/SKILL.md#add-rates-always-plural',
      'skills/metronome-pricing-catalog/SKILL.md#one-product-per-billable-metric-per-rate-card--a-you-invariant-not-metronomes',
    ],
  },
};

const ENDPOINTS = [
  {
    id: 'usage.ingest',
    family: 'usage',
    title: 'Ingest usage events',
    method: 'POST',
    path: '/v1/ingest',
    operationType: 'write',
    supportStatus: 'workflow-preview-supported',
    tenant: TENANT_REQUIRED,
    permissionScope: 'metronome:usage:write',
    apiAccessInCurrentCli: 'none',
    liveExecution: LOCAL_ONLY_LIVE_EXECUTION,
    currentCommands: ['metro usage ingest preview --file <input.json|yaml> (--sandbox|--prod) [--json]'],
    futureCommands: ['metro api preview usage.ingest --file <events.json> --sandbox', 'metro api apply usage.ingest --file <events.json> --prod --confirm-hash <hash>'],
    requestContract: {
      summary: 'Batch of up to 100 event objects with customer_id, event_type, timestamp, transaction_id, and metric properties.',
      requiredFields: ['event[].customer_id', 'event[].event_type', 'event[].timestamp', 'event[].transaction_id'],
      forbiddenFields: ['event[].api_key', 'event[].secret'],
    },
    responseContract: {
      summary: 'Future live runner must record the accepted/rejected ingest response and every transaction_id submitted.',
      stableOutputRequired: true,
    },
    policyGates: WRITE_GATES,
    sourceIds: ['endpoint-matrix', 'official-usage-ingest', 'metronome-ingestion-events'],
    sources: [
      'skills/metronome-danger-zone/references/endpoint-matrix.md#1-usage--ingest',
      'skills/metronome-ingestion-events/SKILL.md',
      'https://docs.metronome.com/api-reference/usage/ingest-events.md',
    ],
  },
  {
    id: 'usage.groups',
    family: 'usage',
    title: 'Read grouped usage data',
    method: 'POST',
    path: '/v1/usage/groups',
    operationType: 'read',
    supportStatus: 'cataloged-local-only',
    tenant: TENANT_REQUIRED,
    permissionScope: 'metronome:usage:read',
    apiAccessInCurrentCli: 'none',
    liveExecution: LOCAL_ONLY_LIVE_EXECUTION,
    currentCommands: [],
    futureCommands: ['metro api read usage.groups --file <request.json|yaml> --sandbox'],
    requestContract: {
      summary: 'Future read runner must POST a reviewed usage query body, with pagination fields kept in query parameters.',
      requiredFields: ['body.customer_id', 'body.billable_metric_id', 'body.window_size', 'body.starting_on', 'body.ending_before'],
      optionalFields: ['body.group_key', 'body.group_filters', 'query.limit', 'query.next_page'],
      forbiddenFields: ['query.customer_id', 'query.starting_on', 'query.ending_before', 'query.group_by', 'body.limit', 'body.next_page', 'body.group_by', 'body.current_period'],
    },
    responseContract: {
      summary: 'Future output must include group rows, pagination state, tenant, and request summary.',
      stableOutputRequired: true,
    },
    policyGates: READ_GATES,
    sourceIds: ['endpoint-matrix', 'official-usage-groups'],
    sources: [
      'skills/metronome-danger-zone/references/endpoint-matrix.md#1-usage--ingest',
      'https://docs.metronome.com/api-reference/usage/get-usage-data-with-paginated-groupings.md',
    ],
  },
  {
    id: 'usage.batch',
    family: 'usage',
    title: 'Read batched usage data',
    method: 'POST',
    path: '/v1/usage',
    operationType: 'read',
    supportStatus: 'cataloged-local-only',
    tenant: TENANT_REQUIRED,
    permissionScope: 'metronome:usage:read',
    apiAccessInCurrentCli: 'none',
    liveExecution: LOCAL_ONLY_LIVE_EXECUTION,
    currentCommands: [],
    futureCommands: ['metro api read usage.batch --file <request.json|yaml> --sandbox --confirm-live-read <token>'],
    requestContract: {
      summary: 'Future read runner must POST a reviewed batch usage query body, with next_page pagination kept in query parameters.',
      requiredFields: ['body.window_size', 'body.starting_on', 'body.ending_before'],
      optionalFields: ['body.customer_ids[]', 'body.billable_metrics[].id', 'body.billable_metrics[].group_by', 'query.next_page'],
      forbiddenFields: ['query.customer_ids', 'query.billable_metrics', 'query.window_size', 'query.starting_on', 'query.ending_before', 'body.next_page'],
    },
    responseContract: {
      summary: 'Future output must include usage aggregate rows, pagination state, tenant, and request summary.',
      stableOutputRequired: true,
    },
    policyGates: READ_GATES,
    sourceIds: ['endpoint-matrix', 'official-usage-batch'],
    sources: [
      'skills/metronome-danger-zone/references/endpoint-matrix.md#1-usage--ingest',
      'https://docs.metronome.com/api-reference/usage/get-batched-usage-data.md',
    ],
  },
  {
    id: 'events.search',
    family: 'usage',
    title: 'Search usage events',
    method: 'POST',
    path: '/v1/events/search',
    operationType: 'read',
    supportStatus: 'cataloged-local-only',
    tenant: TENANT_REQUIRED,
    permissionScope: 'metronome:usage:read',
    apiAccessInCurrentCli: 'none',
    liveExecution: LOCAL_ONLY_LIVE_EXECUTION,
    currentCommands: [],
    futureCommands: ['metro api read events.search --file <request.json|yaml> --sandbox --confirm-live-read <token>'],
    requestContract: {
      summary: 'Future read runner must POST a reviewed JSON body with body.transactionIds as a non-empty array for sampling-only event search.',
      requiredFields: ['body.transactionIds[]'],
      forbiddenFields: ['body.transaction_id', 'body.filter.transaction_id', 'query.transaction_id', 'query.transactionIds'],
    },
    responseContract: {
      summary: 'Future output must include matching event IDs, transaction IDs, timestamps, tenant, and request summary.',
      stableOutputRequired: true,
    },
    policyGates: READ_GATES,
    sourceIds: ['endpoint-matrix', 'official-event-search'],
    sources: [
      'skills/metronome-danger-zone/references/endpoint-matrix.md#1-usage--ingest',
      'https://docs.metronome.com/api-reference/usage/search-events.md',
    ],
  },
  {
    id: 'billableMetrics.get',
    family: 'billable-metrics',
    title: 'Get billable metric',
    method: 'GET',
    path: '/v1/billable-metrics/{billable_metric_id}',
    operationType: 'read',
    supportStatus: 'cataloged-local-only',
    tenant: TENANT_REQUIRED,
    permissionScope: 'metronome:billable-metrics:read',
    apiAccessInCurrentCli: 'none',
    liveExecution: LOCAL_ONLY_LIVE_EXECUTION,
    currentCommands: [],
    futureCommands: ['metro api read billableMetrics.get --file <request.json|yaml> --sandbox --confirm-live-read <token>'],
    requestContract: {
      summary: 'Future read runner must GET a reviewed billable_metric_id path parameter with no request body.',
      requiredFields: ['path.billable_metric_id'],
      forbiddenFields: ['body.billable_metric_id', 'query.billable_metric_id'],
    },
    responseContract: {
      summary: 'Future output must include the billable metric configuration, archive state when present, tenant, and request summary.',
      stableOutputRequired: true,
    },
    policyGates: READ_GATES,
    sourceIds: ['endpoint-matrix', 'official-billable-metric-get'],
    sources: [
      'skills/metronome-danger-zone/references/endpoint-matrix.md#2-billable-metrics',
      'https://docs.metronome.com/api-reference/billable-metrics/get-a-billable-metric.md',
    ],
  },
  {
    id: 'billableMetrics.list',
    family: 'billable-metrics',
    title: 'List billable metrics',
    method: 'GET',
    path: '/v1/billable-metrics',
    operationType: 'read',
    supportStatus: 'cataloged-local-only',
    tenant: TENANT_REQUIRED,
    permissionScope: 'metronome:billable-metrics:read',
    apiAccessInCurrentCli: 'none',
    liveExecution: LOCAL_ONLY_LIVE_EXECUTION,
    currentCommands: [],
    futureCommands: ['metro api read billableMetrics.list --file <request.json|yaml> --sandbox --confirm-live-read <token>'],
    requestContract: {
      summary: 'Future read runner must GET reviewed query pagination and optional include_archived; no request body is allowed.',
      requiredFields: ['query.limit'],
      optionalFields: ['query.next_page', 'query.include_archived'],
      forbiddenFields: ['body.limit', 'body.next_page', 'body.include_archived'],
    },
    responseContract: {
      summary: 'Future output must include billable metric rows, pagination state, tenant, and request summary.',
      stableOutputRequired: true,
    },
    policyGates: READ_GATES,
    sourceIds: ['endpoint-matrix', 'official-billable-metric-list'],
    sources: [
      'skills/metronome-danger-zone/references/endpoint-matrix.md#2-billable-metrics',
      'https://docs.metronome.com/api-reference/billable-metrics/list-all-billable-metrics.md',
    ],
  },
  {
    id: 'billableMetrics.create',
    family: 'billable-metrics',
    title: 'Create billable metric',
    method: 'POST',
    path: '/v1/billable-metrics/create',
    operationType: 'write',
    supportStatus: 'cataloged-local-only',
    tenant: TENANT_REQUIRED,
    permissionScope: 'metronome:billable-metrics:write',
    apiAccessInCurrentCli: 'none',
    liveExecution: LOCAL_ONLY_LIVE_EXECUTION,
    currentCommands: [],
    futureCommands: [
      'metro api preview billableMetrics.create --file <billable-metric-create.json> --sandbox',
      'metro api apply billableMetrics.create --file <billable-metric-create.json> --prod --confirm-hash <hash>',
    ],
    requestContract: {
      summary: 'Future write runner must POST a reviewed standard streaming metric configuration. The current local contract intentionally rejects SQL billable metrics until a separate SQL-specific shape models query semantics, source proof, and rollback.',
      requiredFields: ['body.name', 'body.aggregation_type', 'body.event_type_filter', 'body.property_filters'],
      optionalFields: ['body.aggregation_key', 'body.group_keys', 'body.custom_fields'],
      forbiddenFields: ['body.sql', 'body.id', 'body.billable_metric_id', 'query.*', 'path.*'],
    },
    responseContract: {
      summary: 'Future live output must include the created billable metric id, response hash, and get/list read-back plan before any Product association.',
      stableOutputRequired: true,
    },
    policyGates: WRITE_GATES,
    sourceIds: ['endpoint-matrix', 'official-billable-metric-create', 'metronome-billable-metrics'],
    sources: [
      'skills/metronome-ingestion-events/SKILL.md#billable-metrics-the-consumer-of-events',
      'skills/metronome-danger-zone/references/endpoint-matrix.md#2-billable-metrics',
      'https://docs.metronome.com/api-reference/billable-metrics/create-a-billable-metric.md',
    ],
  },
  {
    id: 'billableMetrics.update',
    family: 'billable-metrics',
    title: 'Update billable metric display name',
    method: 'PUT',
    path: '/v1/billable-metrics/{billable_metric_id}',
    operationType: 'write',
    supportStatus: 'cataloged-local-only',
    tenant: TENANT_REQUIRED,
    permissionScope: 'metronome:billable-metrics:write',
    apiAccessInCurrentCli: 'none',
    liveExecution: LOCAL_ONLY_LIVE_EXECUTION,
    currentCommands: [],
    futureCommands: [
      'metro api preview billableMetrics.update --file <billable-metric-update.json> --sandbox',
      'metro api apply billableMetrics.update --file <billable-metric-update.json> --prod --confirm-hash <hash>',
    ],
    requestContract: {
      summary: 'Future write runner must PUT a reviewed billable_metric_id path parameter and body.name only; billable metric configuration cannot be changed after creation.',
      requiredFields: ['path.billable_metric_id', 'body.name'],
      forbiddenFields: ['body.id', 'body.billable_metric_id', 'body.aggregation_type', 'body.aggregation_key', 'body.event_type_filter', 'body.property_filters', 'body.group_keys', 'body.custom_fields', 'query.billable_metric_id'],
    },
    responseContract: {
      summary: 'Future live output must include the returned billable metric id, response hash, and get/list read-back plan.',
      stableOutputRequired: true,
    },
    policyGates: WRITE_GATES,
    sourceIds: ['endpoint-matrix', 'official-billable-metric-update'],
    sources: [
      'skills/metronome-danger-zone/references/endpoint-matrix.md#2-billable-metrics',
      'https://docs.metronome.com/api-reference/billable-metrics/update-a-billable-metric.md',
    ],
  },
  {
    id: 'billableMetrics.archive',
    family: 'billable-metrics',
    title: 'Archive billable metric',
    method: 'POST',
    path: '/v1/billable-metrics/archive',
    operationType: 'write',
    supportStatus: 'cataloged-local-only',
    tenant: TENANT_REQUIRED,
    permissionScope: 'metronome:billable-metrics:write',
    apiAccessInCurrentCli: 'none',
    liveExecution: LOCAL_ONLY_LIVE_EXECUTION,
    currentCommands: [],
    futureCommands: [
      'metro api preview billableMetrics.archive --file <billable-metric-archive.json> --sandbox',
      'metro api apply billableMetrics.archive --file <billable-metric-archive.json> --prod --confirm-hash <hash>',
    ],
    requestContract: {
      summary: 'Future write runner must POST body.id for the reviewed metric to archive; the current official endpoint is body-id based, not the stale path-style archive shape.',
      requiredFields: ['body.id'],
      forbiddenFields: ['path.billable_metric_id', 'body.billable_metric_id', 'body.name', 'body.aggregation_type', 'body.aggregation_key', 'body.event_type_filter', 'body.property_filters', 'body.group_keys', 'body.custom_fields', 'query.billable_metric_id'],
    },
    responseContract: {
      summary: 'Future live output must include the returned billable metric id, response hash, and get/list include_archived read-back plan showing archived_at.',
      stableOutputRequired: true,
    },
    policyGates: WRITE_GATES,
    sourceIds: ['endpoint-matrix', 'official-billable-metric-archive'],
    sources: [
      'skills/metronome-danger-zone/references/endpoint-matrix.md#2-billable-metrics',
      'https://docs.metronome.com/api-reference/billable-metrics/archive-a-billable-metric.md',
    ],
  },
  {
    id: 'packages.create',
    family: 'packages',
    title: 'Create a reusable package',
    method: 'POST',
    path: '/v1/packages/create',
    operationType: 'write',
    supportStatus: 'workflow-preview-supported',
    tenant: TENANT_REQUIRED,
    permissionScope: 'metronome:packages:write',
    apiAccessInCurrentCli: 'none',
    liveExecution: LOCAL_ONLY_LIVE_EXECUTION,
    currentCommands: ['metro package preview --shape pro-annual --file <input.json|yaml> (--sandbox|--prod) [--json]'],
    futureCommands: ['metro api preview packages.create --file <package.json> --sandbox', 'metro api apply packages.create --file <package.json> --prod --confirm-hash <hash>'],
    requestContract: {
      summary: 'Package create payload with alias, rate card, terms, contract template, uniqueness key, and billing behavior.',
      requiredFields: ['name', 'rate_card_id', 'aliases', 'contract', 'uniqueness_key'],
      forbiddenFields: ['api_key', 'secret'],
    },
    responseContract: {
      summary: 'Future live output must include created package id, alias evidence, response hash, and read-back plan.',
      stableOutputRequired: true,
    },
    policyGates: WRITE_GATES,
    sourceIds: ['endpoint-matrix', 'official-package-create'],
    sources: [
      'skills/metronome-danger-zone/references/endpoint-matrix.md#5-packages',
      'https://docs.metronome.com/api-reference/contracts/create-a-package.md',
    ],
  },
  {
    id: 'packages.get',
    family: 'packages',
    title: 'Get package state',
    method: 'POST',
    path: '/v1/packages/get',
    operationType: 'read',
    supportStatus: 'inspect-plan-supported',
    tenant: TENANT_REQUIRED,
    permissionScope: 'metronome:packages:read',
    apiAccessInCurrentCli: 'none',
    liveExecution: LOCAL_ONLY_LIVE_EXECUTION,
    currentCommands: ['metro package inspect --alias <package_alias> (--sandbox|--prod) --plan [--json]'],
    futureCommands: ['metro api read packages.get --package-id <id> --sandbox'],
    requestContract: {
      summary: 'Package get request with package id or reviewed alias-derived package id.',
      requiredFields: ['package_id'],
      forbiddenFields: [],
    },
    responseContract: {
      summary: 'Future output must include package id, alias records, uniqueness key normalization, and tenant.',
      stableOutputRequired: true,
    },
    policyGates: READ_GATES,
    sourceIds: ['endpoint-matrix', 'official-package-get'],
    sources: [
      'skills/metronome-danger-zone/references/endpoint-matrix.md#5-packages',
      'https://docs.metronome.com/api-reference/packages/get-a-package.md',
    ],
  },
  {
    id: 'packages.list',
    family: 'packages',
    title: 'List packages',
    method: 'POST',
    path: '/v1/packages/list',
    operationType: 'read',
    supportStatus: 'inspect-plan-supported',
    tenant: TENANT_REQUIRED,
    permissionScope: 'metronome:packages:read',
    apiAccessInCurrentCli: 'none',
    liveExecution: LOCAL_ONLY_LIVE_EXECUTION,
    currentCommands: ['metro package inspect --alias <package_alias> (--sandbox|--prod) --plan [--json]'],
    futureCommands: ['metro api read packages.list --alias <package_alias> --sandbox'],
    requestContract: {
      summary: 'Package list request. Pagination limit and next_page belong in URL query parameters, not the POST body.',
      requiredFields: ['query.limit'],
      forbiddenFields: ['body.limit', 'body.next_page'],
    },
    responseContract: {
      summary: 'Future output must include package rows, pagination state, normalized uniqueness keys, and tenant.',
      stableOutputRequired: true,
    },
    policyGates: READ_GATES,
    sourceIds: ['endpoint-matrix', 'official-package-list'],
    sources: [
      'skills/metronome-danger-zone/references/endpoint-matrix.md#5-packages',
      'https://docs.metronome.com/api-reference/list-all-packages.md',
    ],
  },
  {
    id: 'packages.listContractsOnPackage',
    family: 'packages',
    title: 'List contracts on package',
    method: 'POST',
    path: '/v1/packages/listContractsOnPackage',
    operationType: 'read',
    supportStatus: 'cataloged-local-only',
    tenant: TENANT_REQUIRED,
    permissionScope: 'metronome:packages:read',
    apiAccessInCurrentCli: 'none',
    liveExecution: LOCAL_ONLY_LIVE_EXECUTION,
    currentCommands: ['metro api read-plan packages.listContractsOnPackage --file <request.json|yaml> (--sandbox|--prod) [--json]'],
    futureCommands: ['metro api read packages.listContractsOnPackage --file <request.json|yaml> --sandbox'],
    requestContract: {
      summary: 'Package contract inventory request. Required package_id belongs in the POST body; limit and next_page pagination belong in URL query parameters.',
      requiredFields: ['body.package_id', 'query.limit'],
      optionalFields: ['query.next_page', 'body.starting_at', 'body.covering_date', 'body.include_archived'],
      forbiddenFields: [
        'query.package_id',
        'query.starting_at',
        'query.covering_date',
        'query.include_archived',
        'body.limit',
        'body.next_page',
        'body.cursor',
        'body.packageId',
        'body.startingAt',
        'body.coveringDate',
        'body.includeArchived',
      ],
    },
    responseContract: {
      summary: 'Future output must include package-associated contract rows with customer_id, contract_id, starting_at, optional ending_before/archived_at, next_page, and tenant.',
      stableOutputRequired: true,
      expectedTopLevelFields: ['data', 'next_page'],
    },
    policyGates: READ_GATES,
    sourceIds: ['endpoint-matrix', 'official-package-contracts-list', 'packages-contracts'],
    sources: [
      'skills/metronome-danger-zone/references/endpoint-matrix.md#5-packages',
      'skills/metronome-packages-contracts/SKILL.md#endpoint-inventory',
      'https://docs.metronome.com/api-reference/contracts/list-contracts-associated-with-a-package.md',
    ],
  },
  {
    id: 'packages.archive',
    family: 'packages',
    title: 'Archive package',
    method: 'POST',
    path: '/v1/packages/archive',
    operationType: 'write',
    supportStatus: 'workflow-preview-supported',
    tenant: TENANT_REQUIRED,
    permissionScope: 'metronome:packages:write',
    apiAccessInCurrentCli: 'none',
    liveExecution: LOCAL_ONLY_LIVE_EXECUTION,
    currentCommands: ['metro package archive preview --file <input.json|yaml> (--sandbox|--prod) [--json]'],
    futureCommands: ['metro api preview packages.archive --file <archive.json> --sandbox', 'metro api apply packages.archive --file <archive.json> --prod --confirm-hash <hash>'],
    requestContract: {
      summary: 'Package archive request with old package id after replacement alias is already live and verified.',
      requiredFields: ['package_id'],
      forbiddenFields: ['package_alias without read-back package_id'],
    },
    responseContract: {
      summary: 'Future output must include archived package id, alias handoff evidence, and read-back checks.',
      stableOutputRequired: true,
    },
    policyGates: WRITE_GATES,
    sourceIds: ['endpoint-matrix', 'official-package-archive'],
    sources: [
      'skills/metronome-danger-zone/references/endpoint-matrix.md#5-packages',
      'https://docs.metronome.com/api-reference/packages/archive-a-package.md',
    ],
  },
  {
    id: 'contracts.create',
    family: 'contracts',
    title: 'Create contract',
    method: 'POST',
    path: '/v1/contracts/create',
    operationType: 'write',
    supportStatus: 'workflow-preview-supported',
    tenant: TENANT_REQUIRED,
    permissionScope: 'metronome:contracts:write',
    apiAccessInCurrentCli: 'none',
    liveExecution: LOCAL_ONLY_LIVE_EXECUTION,
    currentCommands: [
      'metro contract move-plan preview --file <input.json|yaml> (--sandbox|--prod) [--json]',
      'metro subscription contract preview --file <input.json|yaml> (--sandbox|--prod) [--json]',
    ],
    futureCommands: ['metro api preview contracts.create --file <contract.json> --sandbox', 'metro api apply contracts.create --file <contract.json> --prod --confirm-hash <hash>'],
    requestContract: {
      summary: 'Contract create request for package or direct contracts. Package contract create has a restricted payload.',
      requiredFields: ['customer_id', 'starting_at', 'package_alias or direct contract terms'],
      forbiddenFields: ['package_alias with commits or overrides in the same create request', 'api_key', 'secret'],
    },
    responseContract: {
      summary: 'Future output must include contract id, transition evidence when present, payload hash, and read-back plan.',
      stableOutputRequired: true,
    },
    policyGates: WRITE_GATES,
    sourceIds: ['endpoint-matrix', 'official-contract-create', 'packages-contracts'],
    sources: [
      'skills/metronome-danger-zone/references/endpoint-matrix.md#9-contracts',
      'skills/metronome-packages-contracts/SKILL.md',
      'https://docs.metronome.com/api-reference/contracts/create-a-contract.md',
    ],
  },
  {
    id: 'contracts.updateEndDate',
    family: 'contracts',
    title: 'Update contract end date',
    method: 'POST',
    path: '/v1/contracts/updateEndDate',
    operationType: 'write',
    supportStatus: 'workflow-preview-supported',
    tenant: TENANT_REQUIRED,
    permissionScope: 'metronome:contracts:write',
    apiAccessInCurrentCli: 'none',
    liveExecution: LOCAL_ONLY_LIVE_EXECUTION,
    currentCommands: ['metro contract move-plan preview --file <input.json|yaml> (--sandbox|--prod) [--json]'],
    futureCommands: ['metro api preview contracts.updateEndDate --file <end-date.json> --sandbox', 'metro api apply contracts.updateEndDate --file <end-date.json> --prod --confirm-hash <hash>'],
    requestContract: {
      summary: 'Contract end-date request with explicit allow_ending_before_finalized_invoice decision and hour-boundary timestamp.',
      requiredFields: ['contract_id', 'ending_before', 'allow_ending_before_finalized_invoice'],
      forbiddenFields: ['implicit allow_ending_before_finalized_invoice default'],
    },
    responseContract: {
      summary: 'Future output must include predecessor contract id, requested end date, finalized-invoice decision, and read-back checks.',
      stableOutputRequired: true,
    },
    policyGates: WRITE_GATES,
    sourceIds: ['endpoint-matrix', 'official-contract-update-end-date', 'danger-zone'],
    sources: [
      'skills/metronome-danger-zone/SKILL.md',
      'skills/metronome-danger-zone/references/endpoint-matrix.md#9-contracts',
      'https://docs.metronome.com/api-reference/contracts/update-the-contract-end-date.md',
    ],
  },
  {
    id: 'contracts.get.v2',
    family: 'contracts',
    title: 'Get contract v2',
    method: 'POST',
    path: '/v2/contracts/get',
    operationType: 'read',
    supportStatus: 'inspect-plan-supported',
    tenant: TENANT_REQUIRED,
    permissionScope: 'metronome:contracts:read',
    apiAccessInCurrentCli: 'none',
    liveExecution: LOCAL_ONLY_LIVE_EXECUTION,
    currentCommands: ['metro contract inspect --contract-id <id> (--sandbox|--prod) --plan [--at <timestamp>] [--json]'],
    futureCommands: ['metro api read contracts.get.v2 --contract-id <id> --sandbox'],
    requestContract: {
      summary: 'Contract get request with contract_id and customer_id when the future runner has both identifiers.',
      requiredFields: ['contract_id'],
      forbiddenFields: [],
    },
    responseContract: {
      summary: 'Future output must include contract terms, transitions, commits, subscriptions, invoice schedule, tenant, and request summary.',
      stableOutputRequired: true,
    },
    policyGates: READ_GATES,
    sourceIds: ['endpoint-matrix', 'official-contract-get-v2'],
    sources: [
      'skills/metronome-danger-zone/references/endpoint-matrix.md#9-contracts',
      'https://docs.metronome.com/api-reference/contracts/get-a-contract-v2.md',
    ],
  },
  {
    id: 'contracts.list.v2',
    family: 'contracts',
    title: 'List customer contracts v2',
    method: 'POST',
    path: '/v2/contracts/list',
    operationType: 'read',
    supportStatus: 'inspect-plan-supported',
    tenant: TENANT_REQUIRED,
    permissionScope: 'metronome:contracts:read',
    apiAccessInCurrentCli: 'none',
    liveExecution: LOCAL_ONLY_LIVE_EXECUTION,
    currentCommands: ['metro customer billing-state --customer-id <id> (--sandbox|--prod) --plan [--json]'],
    futureCommands: ['metro api read contracts.list.v2 --customer-id <id> --sandbox'],
    requestContract: {
      summary: 'Contract list request by customer_id with optional include_archived flag for customer billing-state review.',
      requiredFields: ['customer_id'],
      forbiddenFields: [],
    },
    responseContract: {
      summary: 'Future output must include customer contracts, chronological contract state, transitions, archived inclusion decision, pagination state, tenant, and request summary.',
      stableOutputRequired: true,
    },
    policyGates: READ_GATES,
    sourceIds: ['endpoint-matrix', 'official-contract-list-v2'],
    sources: [
      'skills/metronome-danger-zone/references/endpoint-matrix.md#9-contracts',
      'https://docs.metronome.com/api-reference/contracts/list-customer-contracts-v2.md',
    ],
  },
  {
    id: 'contracts.getRateSchedule',
    family: 'contracts',
    title: 'Get contract rate schedule',
    method: 'POST',
    path: '/v1/contracts/getContractRateSchedule',
    operationType: 'read',
    supportStatus: 'cataloged-local-only',
    tenant: TENANT_REQUIRED,
    permissionScope: 'metronome:contracts:read',
    apiAccessInCurrentCli: 'none',
    liveExecution: LOCAL_ONLY_LIVE_EXECUTION,
    currentCommands: [],
    futureCommands: ['metro api read contracts.getRateSchedule --file <request.json|yaml> --sandbox --confirm-live-read <token>'],
    requestContract: {
      summary: 'Contract rate schedule request with body.customer_id, body.contract_id, optional body.at and body.selectors[], plus reviewed query pagination. This endpoint accounts for contract-level overrides and returns entitled rates only.',
      requiredFields: ['body.customer_id', 'body.contract_id', 'query.limit'],
      optionalFields: ['body.at', 'body.selectors[]', 'query.next_page'],
      forbiddenFields: ['query.customer_id', 'query.contract_id', 'query.at', 'query.product_id', 'body.limit', 'body.next_page'],
    },
    responseContract: {
      summary: 'Future output must include rate card id, product ids, product names, product tags/custom fields, pricing groups, list_rate, override_rate when present, commit_rate when present, pagination state, tenant, and request summary.',
      stableOutputRequired: true,
    },
    policyGates: READ_GATES,
    sourceIds: ['endpoint-matrix', 'official-contract-get-rate-schedule', 'packages-contracts'],
    sources: [
      'skills/metronome-danger-zone/references/endpoint-matrix.md#9-contracts',
      'skills/metronome-packages-contracts/SKILL.md',
      'https://docs.metronome.com/api-reference/contracts/get-the-rate-schedule-for-a-contract.md',
    ],
  },
  {
    id: 'contracts.getEditHistory',
    family: 'contracts',
    title: 'Get contract edit history',
    method: 'POST',
    path: '/v2/contracts/getEditHistory',
    operationType: 'read',
    supportStatus: 'cataloged-local-only',
    tenant: TENANT_REQUIRED,
    permissionScope: 'metronome:contracts:read',
    apiAccessInCurrentCli: 'none',
    liveExecution: LOCAL_ONLY_LIVE_EXECUTION,
    currentCommands: ['metro api read-plan contracts.getEditHistory --file <request.json|yaml> (--sandbox|--prod) [--json]'],
    futureCommands: ['metro api read contracts.getEditHistory --file <request.json|yaml> --sandbox'],
    requestContract: {
      summary: 'Contract edit-history request. The current official v2 endpoint requires customer_id and contract_id in the POST body and does not document pagination.',
      requiredFields: ['body.customer_id', 'body.contract_id'],
      optionalFields: [],
      forbiddenFields: [
        'query.*',
        'body.limit',
        'body.next_page',
        'body.cursor',
        'body.customerId',
        'body.contractId',
      ],
    },
    responseContract: {
      summary: 'Future output must include contract edit rows, edit ids, operation payloads, actor metadata when available, tenant, and request summary.',
      stableOutputRequired: true,
      expectedTopLevelFields: ['data'],
    },
    policyGates: READ_GATES,
    sourceIds: ['endpoint-matrix', 'official-contract-edit-history', 'packages-contracts'],
    sources: [
      'skills/metronome-danger-zone/references/endpoint-matrix.md#9-contracts',
      'skills/metronome-packages-contracts/SKILL.md#endpoint-inventory',
      'https://docs.metronome.com/api-reference/contracts/get-contract-edit-history.md',
    ],
  },
  {
    id: 'contracts.getSubscriptionQuantityHistory',
    family: 'contracts',
    title: 'Get subscription quantity history',
    method: 'POST',
    path: '/v1/contracts/getSubscriptionQuantityHistory',
    operationType: 'read',
    supportStatus: 'cataloged-local-only',
    tenant: TENANT_REQUIRED,
    permissionScope: 'metronome:contracts:read',
    apiAccessInCurrentCli: 'none',
    liveExecution: LOCAL_ONLY_LIVE_EXECUTION,
    currentCommands: ['metro api read-plan contracts.getSubscriptionQuantityHistory --file <request.json|yaml> (--sandbox|--prod) [--json]'],
    futureCommands: ['metro api read contracts.getSubscriptionQuantityHistory --file <request.json|yaml> --sandbox'],
    requestContract: {
      summary: 'Subscription quantity history request by customer_id, contract_id, and subscription_id. The official read body has no query or pagination fields.',
      requiredFields: ['body.customer_id', 'body.contract_id', 'body.subscription_id'],
      optionalFields: [],
      forbiddenFields: [
        'query.*',
        'path.*',
        'body.customerId',
        'body.contractId',
        'body.subscriptionId',
        'body.limit',
        'body.cursor',
        'body.next_page',
      ],
    },
    responseContract: {
      summary: 'Future output must include subscription id, fiat credit type, historical starting_at entries, quantity, unit_price, total, tenant, and request summary.',
      stableOutputRequired: true,
    },
    policyGates: READ_GATES,
    sourceIds: ['endpoint-matrix', 'official-contract-subscription-quantity-history', 'metronome-subscriptions-seats'],
    sources: [
      'skills/metronome-subscriptions-seats/SKILL.md#read-quantity-history-any-mode',
      'skills/metronome-danger-zone/references/endpoint-matrix.md#9-contracts',
      'https://docs.metronome.com/api-reference/contracts/get-subscription-quantity-history.md',
    ],
  },
  {
    id: 'contracts.getSubscriptionSeatsHistory',
    family: 'contracts',
    title: 'Get subscription seats history',
    method: 'POST',
    path: '/v1/contracts/getSubscriptionSeatsHistory',
    operationType: 'read',
    supportStatus: 'cataloged-local-only',
    tenant: TENANT_REQUIRED,
    permissionScope: 'metronome:contracts:read',
    apiAccessInCurrentCli: 'none',
    liveExecution: LOCAL_ONLY_LIVE_EXECUTION,
    currentCommands: ['metro api read-plan contracts.getSubscriptionSeatsHistory --file <request.json|yaml> (--sandbox|--prod) [--json]'],
    futureCommands: ['metro api read contracts.getSubscriptionSeatsHistory --file <request.json|yaml> --sandbox'],
    requestContract: {
      summary: 'Subscription seats history request by customer_id, contract_id, and subscription_id, with optional body pagination and either covering_date or starting_at/ending_before filters.',
      requiredFields: ['body.customer_id', 'body.contract_id', 'body.subscription_id'],
      optionalFields: [
        'body.limit',
        'body.cursor',
        'body.covering_date',
        'body.starting_at',
        'body.ending_before',
      ],
      forbiddenFields: [
        'query.*',
        'path.*',
        'body.next_page',
        'body.customerId',
        'body.contractId',
        'body.subscriptionId',
        'body.effective_before',
        'body.covering_date with body.starting_at/body.ending_before',
      ],
    },
    responseContract: {
      summary: 'Future output must include seat schedule entries with starting_at, ending_before, total_quantity, assigned_seat_ids, next_page pagination, tenant, and request summary.',
      stableOutputRequired: true,
    },
    policyGates: READ_GATES,
    sourceIds: ['endpoint-matrix', 'official-contract-subscription-seats-history', 'metronome-subscriptions-seats'],
    sources: [
      'skills/metronome-subscriptions-seats/SKILL.md#read-seat-assignment-history-seat_based-only',
      'skills/metronome-danger-zone/references/endpoint-matrix.md#9-contracts',
      'https://docs.metronome.com/api-reference/contracts/get-subscription-seats-history.md',
    ],
  },
  {
    id: 'contracts.edit.v2',
    family: 'contracts',
    title: 'Edit contract v2',
    method: 'POST',
    path: '/v2/contracts/edit',
    operationType: 'write',
    supportStatus: 'workflow-preview-supported',
    tenant: TENANT_REQUIRED,
    permissionScope: 'metronome:contracts:write',
    apiAccessInCurrentCli: 'none',
    liveExecution: LOCAL_ONLY_LIVE_EXECUTION,
    currentCommands: ['metro credit preview --shape complimentary-credit-grant --file <input.json|yaml> (--sandbox|--prod) [--json]'],
    futureCommands: ['metro api preview contracts.edit.v2 --file <edit.json> --sandbox', 'metro api apply contracts.edit.v2 --file <edit.json> --prod --confirm-hash <hash>'],
    requestContract: {
      summary: 'Contract edit request for reviewed operations such as commits, credits, overrides, scheduled charges, and subscription updates.',
      requiredFields: ['customer_id', 'contract_id', 'edits[]'],
      forbiddenFields: ['finalized invoice mutation', 'api_key', 'secret'],
    },
    responseContract: {
      summary: 'Future output must include edit operation ids or affected ids, response hash, and read-back checks.',
      stableOutputRequired: true,
    },
    policyGates: WRITE_GATES,
    sourceIds: ['endpoint-matrix', 'official-contract-edit', 'danger-zone'],
    sources: [
      'skills/metronome-danger-zone/SKILL.md',
      'skills/metronome-danger-zone/references/endpoint-matrix.md#9-contracts',
      'https://docs.metronome.com/api-reference/contracts/edit-a-contract.md',
    ],
  },
  {
    id: 'contracts.updateInvoiceIssueDate',
    family: 'contracts',
    title: 'Update invoice issue date',
    method: 'POST',
    path: '/v1/contracts/updateInvoiceIssueDate',
    operationType: 'write',
    supportStatus: 'workflow-preview-supported',
    tenant: TENANT_REQUIRED,
    permissionScope: 'metronome:contracts:write',
    apiAccessInCurrentCli: 'none',
    liveExecution: LOCAL_ONLY_LIVE_EXECUTION,
    currentCommands: ['metro invoice issue-date preview --file <input.json|yaml> (--sandbox|--prod) [--json]'],
    futureCommands: ['metro api preview contracts.updateInvoiceIssueDate --file <issue-date.json> --sandbox', 'metro api apply contracts.updateInvoiceIssueDate --file <issue-date.json> --prod --confirm-hash <hash>'],
    requestContract: {
      summary: 'DRAFT invoice issue-date request using invoice_id and issue_date, with contract-end evidence.',
      requiredFields: ['invoice_id', 'issue_date', 'contract_id evidence'],
      forbiddenFields: ['/v1/invoices/updateIssueDate path'],
    },
    responseContract: {
      summary: 'Future output must include invoice id, issue date, Stripe behavior decision, and invoice read-back checks.',
      stableOutputRequired: true,
    },
    policyGates: WRITE_GATES,
    sourceIds: ['endpoint-matrix', 'official-invoice-issue-date', 'metronome-invoicing'],
    sources: [
      'skills/metronome-danger-zone/references/endpoint-matrix.md#9-contracts',
      'skills/metronome-invoicing/SKILL.md',
      'https://docs.metronome.com/api-reference/contracts/update-invoice-issue-date',
    ],
  },
  {
    id: 'commits.list',
    family: 'credits',
    title: 'List customer commits',
    method: 'POST',
    path: '/v1/contracts/customerCommits/list',
    operationType: 'read',
    supportStatus: 'inspect-plan-supported',
    tenant: TENANT_REQUIRED,
    permissionScope: 'metronome:credits:read',
    apiAccessInCurrentCli: 'none',
    liveExecution: LOCAL_ONLY_LIVE_EXECUTION,
    currentCommands: ['metro customer billing-state --customer-id <id> (--sandbox|--prod) --plan [--json]'],
    futureCommands: ['metro api read commits.list --customer-id <id> --sandbox'],
    requestContract: {
      summary: 'Customer commits read request by customer_id with optional balance, archive, ledger, and contract-commit inclusion flags.',
      requiredFields: ['customer_id'],
      forbiddenFields: [],
    },
    responseContract: {
      summary: 'Future output must include customer commit rows, contract linkage when returned, optional balances or ledgers when requested, pagination state, tenant, and request summary.',
      stableOutputRequired: true,
    },
    policyGates: READ_GATES,
    sourceIds: ['endpoint-matrix', 'official-commits-list', 'danger-zone'],
    sources: [
      'skills/metronome-danger-zone/SKILL.md#7-pre-flight-reconciliation-checklist',
      'skills/metronome-danger-zone/references/endpoint-matrix.md#10-credits--commits',
      'https://docs.metronome.com/api-reference/credits-and-commits/list-commits',
    ],
  },
  {
    id: 'credits.list',
    family: 'credits',
    title: 'List customer credits',
    method: 'POST',
    path: '/v1/contracts/customerCredits/list',
    operationType: 'read',
    supportStatus: 'inspect-plan-supported',
    tenant: TENANT_REQUIRED,
    permissionScope: 'metronome:credits:read',
    apiAccessInCurrentCli: 'none',
    liveExecution: LOCAL_ONLY_LIVE_EXECUTION,
    currentCommands: ['metro customer billing-state --customer-id <id> (--sandbox|--prod) --plan [--json]'],
    futureCommands: ['metro api read credits.list --customer-id <id> --sandbox'],
    requestContract: {
      summary: 'Customer credits read request by customer_id with optional balance, archive, ledger, and contract-credit inclusion flags.',
      requiredFields: ['customer_id'],
      forbiddenFields: [],
    },
    responseContract: {
      summary: 'Future output must include customer credit rows, contract linkage when returned, optional balances or ledgers when requested, pagination state, tenant, and request summary.',
      stableOutputRequired: true,
    },
    policyGates: READ_GATES,
    sourceIds: ['endpoint-matrix', 'official-credits-list', 'danger-zone'],
    sources: [
      'skills/metronome-danger-zone/SKILL.md#7-pre-flight-reconciliation-checklist',
      'skills/metronome-danger-zone/references/endpoint-matrix.md#10-credits--commits',
      'https://docs.metronome.com/api-reference/credits-and-commits/list-credits',
    ],
  },
  {
    id: 'customerBalances.list',
    family: 'credits',
    title: 'List customer balances',
    method: 'POST',
    path: '/v1/contracts/customerBalances/list',
    operationType: 'read',
    supportStatus: 'inspect-plan-supported',
    tenant: TENANT_REQUIRED,
    permissionScope: 'metronome:credits:read',
    apiAccessInCurrentCli: 'none',
    liveExecution: LOCAL_ONLY_LIVE_EXECUTION,
    currentCommands: ['metro customer billing-state --customer-id <id> (--sandbox|--prod) --plan [--json]'],
    futureCommands: ['metro api read customerBalances.list --customer-id <id> --sandbox'],
    requestContract: {
      summary: 'Customer balances read request by customer_id with explicit balance/contract-balance inclusion flags when used for billing-state proof.',
      requiredFields: ['customer_id'],
      forbiddenFields: [],
    },
    responseContract: {
      summary: 'Future output must include available balance rows for commits and credits, credit type, contract linkage when returned, pagination state, tenant, and request summary.',
      stableOutputRequired: true,
    },
    policyGates: READ_GATES,
    sourceIds: ['endpoint-matrix', 'official-customer-balances-list', 'danger-zone'],
    sources: [
      'skills/metronome-danger-zone/SKILL.md#8-customer-lookup--what-actually-works',
      'skills/metronome-danger-zone/references/endpoint-matrix.md#10-credits--commits',
      'https://docs.metronome.com/api-reference/credits-and-commits/list-balances.md',
    ],
  },
  {
    id: 'seatBalances.list',
    family: 'credits',
    title: 'List seat balances',
    method: 'POST',
    path: '/v1/contracts/seatBalances/list',
    operationType: 'read',
    supportStatus: 'cataloged-local-only',
    tenant: TENANT_REQUIRED,
    permissionScope: 'metronome:credits:read',
    apiAccessInCurrentCli: 'none',
    liveExecution: LOCAL_ONLY_LIVE_EXECUTION,
    currentCommands: ['metro api read-plan seatBalances.list --file <request.json|yaml> (--sandbox|--prod) [--json]'],
    futureCommands: ['metro api read seatBalances.list --file <request.json|yaml> --sandbox'],
    requestContract: {
      summary: 'Seat-level balances read request by customer_id and contract_id, with optional subscription or seat filters, detail flags, and either covering_date or a starting_at/effective_before window.',
      requiredFields: ['body.customer_id', 'body.contract_id'],
      optionalFields: [
        'body.subscription_ids[]',
        'body.seat_ids[]',
        'body.skip_missing_seat_ids',
        'body.include_credits_and_commits',
        'body.include_ledgers',
        'body.covering_date',
        'body.starting_at',
        'body.effective_before',
        'body.limit',
        'body.cursor',
      ],
      forbiddenFields: [
        'query.*',
        'path.*',
        'body.next_page',
        'body.customerId',
        'body.contractId',
        'body.subscription_id',
        'body.seat_id',
        'body.ending_before',
        'body.covering_date with body.starting_at/body.effective_before',
      ],
    },
    responseContract: {
      summary: 'Future output must include seat balance rows, balances by credit type, optional commits/credits and ledgers when requested, pagination state, tenant, and request summary.',
      stableOutputRequired: true,
    },
    policyGates: READ_GATES,
    sourceIds: ['endpoint-matrix', 'official-seat-balances-list', 'metronome-subscriptions-seats'],
    sources: [
      'skills/metronome-subscriptions-seats/SKILL.md#list-seat-balances',
      'skills/metronome-danger-zone/references/endpoint-matrix.md#10-credits--commits',
      'https://docs.metronome.com/api-reference/credits-and-commits/list-seat-balances.md',
    ],
  },
  {
    id: 'invoices.preview',
    family: 'invoices',
    title: 'Preview event invoice impact',
    method: 'POST',
    path: '/v1/customers/{customer_id}/previewEvents',
    operationType: 'preview',
    supportStatus: 'workflow-preview-supported',
    tenant: TENANT_REQUIRED,
    permissionScope: 'metronome:invoices:read',
    apiAccessInCurrentCli: 'none',
    liveExecution: LOCAL_ONLY_LIVE_EXECUTION,
    currentCommands: ['metro usage ingest preview --file <input.json|yaml> (--sandbox|--prod) [--json]'],
    futureCommands: ['metro api preview invoices.preview --file <events.json> --sandbox'],
    requestContract: {
      summary: 'Preview-events request for reviewed usage events before ingest, constrained to a customer and invoice period.',
      requiredFields: ['customer_id', 'events[]', 'invoice period evidence'],
      forbiddenFields: ['bulk ingest without canary preview'],
    },
    responseContract: {
      summary: 'Future output must record estimated invoice impact, target invoice period, tenant, and request summary.',
      stableOutputRequired: true,
    },
    policyGates: READ_GATES,
    sourceIds: ['endpoint-matrix', 'official-invoice-preview-events', 'metronome-invoicing'],
    sources: [
      'skills/metronome-danger-zone/references/endpoint-matrix.md#11-invoices',
      'skills/metronome-invoicing/SKILL.md',
      'https://docs.metronome.com/api-reference/invoices/preview-events.md',
    ],
  },
  {
    id: 'customers.get',
    family: 'customers',
    title: 'Get customer',
    method: 'GET',
    path: '/v1/customers/{customer_id}',
    operationType: 'read',
    supportStatus: 'inspect-plan-supported',
    tenant: TENANT_REQUIRED,
    permissionScope: 'metronome:customers:read',
    apiAccessInCurrentCli: 'none',
    liveExecution: LOCAL_ONLY_LIVE_EXECUTION,
    currentCommands: ['metro customer billing-state --customer-id <id> (--sandbox|--prod) --plan [--json]'],
    futureCommands: ['metro api read customers.get --customer-id <id> --sandbox'],
    requestContract: {
      summary: 'Customer get request with customer_id as the reviewed path parameter.',
      requiredFields: ['customer_id path parameter'],
      forbiddenFields: ['body.customer_id'],
    },
    responseContract: {
      summary: 'Future output must include customer id, name, aliases, archived state, billing configuration hints, tenant, and request summary.',
      stableOutputRequired: true,
    },
    policyGates: READ_GATES,
    sourceIds: ['endpoint-matrix', 'official-customer-get'],
    sources: [
      'skills/metronome-danger-zone/references/endpoint-matrix.md#6-customers',
      'https://docs.metronome.com/api-reference/customers/get-a-customer.md',
    ],
  },
  {
    id: 'customers.list',
    family: 'customers',
    title: 'List or search customers',
    method: 'GET',
    path: '/v1/customers',
    operationType: 'read',
    supportStatus: 'local-read-plan-supported',
    tenant: TENANT_REQUIRED,
    permissionScope: 'metronome:customers:read',
    apiAccessInCurrentCli: 'none',
    liveExecution: LOCAL_ONLY_LIVE_EXECUTION,
    currentCommands: ['metro api read-plan customers.list --file <request.json|yaml> (--sandbox|--prod) [--json]'],
    futureCommands: ['metro api read customers.list --file <request.json|yaml> --sandbox'],
    requestContract: {
      summary: 'Customer list/search request with reviewed GET query parameters such as customer_ids[], ingest_alias, limit, next_page, and only_archived.',
      requiredFields: ['query.limit', 'one of query.customer_ids or query.ingest_alias when using this as targeted lookup proof'],
      forbiddenFields: ['body.customer_ids', 'body.ingest_alias', 'POST /v1/customers/list'],
    },
    responseContract: {
      summary: 'Future output must include customer results, pagination state, query filters, tenant, and request summary.',
      stableOutputRequired: true,
    },
    policyGates: READ_GATES,
    sourceIds: ['endpoint-matrix', 'official-customer-list'],
    sources: [
      'skills/metronome-danger-zone/references/endpoint-matrix.md#6-customers',
      'https://docs.metronome.com/api-reference/customers/list-customers.md',
    ],
  },
  {
    id: 'customers.create',
    family: 'customers',
    title: 'Create customer',
    method: 'POST',
    path: '/v1/customers',
    operationType: 'write',
    supportStatus: 'workflow-preview-supported',
    tenant: TENANT_REQUIRED,
    permissionScope: 'metronome:customers:write',
    apiAccessInCurrentCli: 'none',
    liveExecution: LOCAL_ONLY_LIVE_EXECUTION,
    currentCommands: ['metro customer setup preview --file <input.json|yaml> (--sandbox|--prod) [--json]'],
    futureCommands: ['metro api preview customers.create --file <customer.json|yaml> --sandbox', 'metro api apply customers.create --file <customer.json|yaml> --prod --confirm-hash <hash>'],
    requestContract: {
      summary: 'Customer create request with reviewed customer name, ingest aliases, optional custom fields, and optional inline billing-provider configuration.',
      requiredFields: ['body.name', 'body.ingest_aliases[]', 'evidence.customerIdentityReviewed', 'evidence.ingestAliasSearchPlanned', 'evidence.archivedCustomerCollisionReviewed', 'evidence.customerReadBackPlanned'],
      optionalFields: ['body.custom_fields', 'body.customer_billing_provider_configurations[]'],
      forbiddenFields: ['body.customer_id', 'body.id', 'body.parent_customer_id', 'body.archive', 'path.*', 'query.*', 'raw endpoint path fields'],
    },
    responseContract: {
      summary: 'Future output must include created customer id, name, ingest aliases, archived state, billing-provider config hints, tenant, request hash, and read-back plan.',
      stableOutputRequired: true,
    },
    policyGates: WRITE_GATES,
    sourceIds: ['endpoint-matrix', 'official-customer-create', 'customers-hierarchies', 'metronome-stripe-delivery'],
    sources: [
      'skills/metronome-danger-zone/references/endpoint-matrix.md#6-customers',
      'skills/metronome-customers-hierarchies/SKILL.md',
      'skills/metronome-stripe-delivery/SKILL.md',
      'https://docs.metronome.com/api-reference/customers/create-a-customer.md',
    ],
  },
  {
    id: 'customers.archive',
    family: 'customers',
    title: 'Archive customer',
    method: 'POST',
    path: '/v1/customers/archive',
    operationType: 'write',
    supportStatus: 'cataloged-local-only',
    tenant: TENANT_REQUIRED,
    permissionScope: 'metronome:customers:write',
    apiAccessInCurrentCli: 'none',
    liveExecution: LOCAL_ONLY_LIVE_EXECUTION,
    currentCommands: [],
    futureCommands: ['metro api preview customers.archive --file <archive.json|yaml> --sandbox', 'metro api apply customers.archive --file <archive.json|yaml> --prod --confirm-hash <hash>'],
    requestContract: {
      summary: 'Customer archive request by reviewed customer_id plus explicit side-effect evidence for contracts, invoices, Stripe reconciliation, aliases, and remediation.',
      requiredFields: ['body.customer_id', 'evidence.customerIdentityReviewed', 'evidence.activeContractsReviewed', 'evidence.invoiceVoidSideEffectsReviewed', 'evidence.stripeNoRefundReviewed', 'evidence.rollbackOrRemediationReviewed'],
      forbiddenFields: ['body.id', 'body.customer_ids[]', 'body.name', 'body.ingest_aliases', 'query.*', 'path.*', 'raw endpoint path fields'],
    },
    responseContract: {
      summary: 'Future output must include archived customer id, affected contract and invoice side-effect summary, tenant, audit row, and read-back/remediation plan.',
      stableOutputRequired: true,
    },
    policyGates: WRITE_GATES,
    sourceIds: ['endpoint-matrix', 'official-customer-archive', 'customers-hierarchies', 'danger-zone'],
    sources: [
      'skills/metronome-danger-zone/references/endpoint-matrix.md#6-customers',
      'skills/metronome-danger-zone/SKILL.md',
      'skills/metronome-customers-hierarchies/SKILL.md',
      'https://docs.metronome.com/api-reference/customers/archive-a-customer.md',
    ],
  },
  {
    id: 'customers.updateConfig',
    family: 'customers',
    title: 'Update customer configuration',
    method: 'POST',
    path: '/v1/customers/{customer_id}/updateConfig',
    operationType: 'write',
    supportStatus: 'workflow-preview-supported',
    tenant: TENANT_REQUIRED,
    permissionScope: 'metronome:customers:write',
    apiAccessInCurrentCli: 'none',
    liveExecution: LOCAL_ONLY_LIVE_EXECUTION,
    currentCommands: ['metro customer setup preview --file <input.json|yaml> (--sandbox|--prod) [--json]'],
    futureCommands: ['metro api preview customers.updateConfig --file <config.json|yaml> --sandbox', 'metro api apply customers.updateConfig --file <config.json|yaml> --prod --confirm-hash <hash>'],
    requestContract: {
      summary: 'Customer updateConfig request with customer_id as the path parameter and reviewed first-class config fields only.',
      requiredFields: ['path.customer_id', 'one of body.salesforce_account_id or body.leave_stripe_invoices_in_draft', 'evidence.customerIdentityReviewed', 'evidence.customerReadBackPlanned'],
      optionalFields: ['body.salesforce_account_id', 'body.leave_stripe_invoices_in_draft'],
      forbiddenFields: ['body.customer_id', 'body.name', 'body.ingest_aliases', 'body.customer_billing_provider_configurations', 'query.*', 'raw endpoint path fields'],
    },
    responseContract: {
      summary: 'Future output must include updated config fields, customer id, tenant, request hash, and customer get read-back plan.',
      stableOutputRequired: true,
    },
    policyGates: WRITE_GATES,
    sourceIds: ['endpoint-matrix', 'official-customer-update-config', 'customers-hierarchies', 'metronome-stripe-delivery'],
    sources: [
      'skills/metronome-danger-zone/references/endpoint-matrix.md#6-customers',
      'skills/metronome-customers-hierarchies/SKILL.md',
      'skills/metronome-stripe-delivery/SKILL.md',
      'https://docs.metronome.com/api-reference/customers/update-a-customer-configuration.md',
    ],
  },
  {
    id: 'customers.updateName',
    family: 'customers',
    title: 'Update customer name',
    method: 'POST',
    path: '/v1/customers/{customer_id}/updateName',
    operationType: 'write',
    supportStatus: 'cataloged-local-only',
    tenant: TENANT_REQUIRED,
    permissionScope: 'metronome:customers:write',
    apiAccessInCurrentCli: 'none',
    liveExecution: LOCAL_ONLY_LIVE_EXECUTION,
    currentCommands: [],
    futureCommands: ['metro api preview customers.updateName --file <rename.json|yaml> --sandbox', 'metro api apply customers.updateName --file <rename.json|yaml> --prod --confirm-hash <hash>'],
    requestContract: {
      summary: 'Customer rename request with customer_id as the path parameter and a reviewed new display name.',
      requiredFields: ['path.customer_id', 'body.name', 'evidence.customerIdentityReviewed', 'evidence.customerFacingNameReviewed', 'evidence.customerReadBackPlanned'],
      forbiddenFields: ['body.customer_id', 'body.ingest_aliases', 'body.salesforce_account_id', 'query.*', 'raw endpoint path fields'],
    },
    responseContract: {
      summary: 'Future output must include customer id, old/new-name evidence, tenant, audit row, and customer get read-back plan.',
      stableOutputRequired: true,
    },
    policyGates: WRITE_GATES,
    sourceIds: ['endpoint-matrix', 'official-customer-update-name', 'customers-hierarchies'],
    sources: [
      'skills/metronome-danger-zone/references/endpoint-matrix.md#6-customers',
      'skills/metronome-customers-hierarchies/SKILL.md',
      'https://docs.metronome.com/api-reference/customers/update-a-customer-name.md',
    ],
  },
  {
    id: 'customers.setIngestAliases',
    family: 'customers',
    title: 'Create or update customer ingest aliases',
    method: 'POST',
    path: '/v1/customers/{customer_id}/setIngestAliases',
    operationType: 'write',
    supportStatus: 'cataloged-local-only',
    tenant: TENANT_REQUIRED,
    permissionScope: 'metronome:customers:write',
    apiAccessInCurrentCli: 'none',
    liveExecution: LOCAL_ONLY_LIVE_EXECUTION,
    currentCommands: [],
    futureCommands: ['metro api preview customers.setIngestAliases --file <aliases.json|yaml> --sandbox', 'metro api apply customers.setIngestAliases --file <aliases.json|yaml> --prod --confirm-hash <hash>'],
    requestContract: {
      summary: 'Customer ingest-alias update request with customer_id as the path parameter and reviewed alias routing/collision evidence.',
      requiredFields: ['path.customer_id', 'body.ingest_aliases[]', 'evidence.customerIdentityReviewed', 'evidence.ingestAliasSearchPlanned', 'evidence.archivedCustomerCollisionReviewed', 'evidence.usageRoutingReviewed', 'evidence.aliasReadBackPlanned'],
      forbiddenFields: ['body.customer_id', 'body.name', 'body.primary_ingest_alias', 'query.*', 'raw endpoint path fields'],
    },
    responseContract: {
      summary: 'Future output must include customer id, alias set, tenant, usage-routing warning, audit row, and alias/customer read-back plan.',
      stableOutputRequired: true,
    },
    policyGates: WRITE_GATES,
    sourceIds: ['endpoint-matrix', 'official-customer-set-ingest-aliases', 'customers-hierarchies', 'metronome-ingestion-events'],
    sources: [
      'skills/metronome-danger-zone/references/endpoint-matrix.md#6-customers',
      'skills/metronome-customers-hierarchies/SKILL.md',
      'skills/metronome-ingestion-events/SKILL.md',
      'https://docs.metronome.com/api-reference/customers/create-or-update-customer-ingest-aliases.md',
    ],
  },
  {
    id: 'invoices.listForCustomer',
    family: 'invoices',
    title: 'List invoices for customer',
    method: 'GET',
    path: '/v1/customers/{customer_id}/invoices',
    operationType: 'read',
    supportStatus: 'inspect-plan-supported',
    tenant: TENANT_REQUIRED,
    permissionScope: 'metronome:invoices:read',
    apiAccessInCurrentCli: 'none',
    liveExecution: LOCAL_ONLY_LIVE_EXECUTION,
    currentCommands: ['metro customer billing-state --customer-id <id> (--sandbox|--prod) --plan [--json]', 'metro invoice inspect --invoice-id <id> (--sandbox|--prod) --plan [--json]'],
    futureCommands: ['metro api read invoices.listForCustomer --customer-id <id> --sandbox'],
    requestContract: {
      summary: 'Customer invoice list request with customer_id path parameter and explicit status/time filters.',
      requiredFields: ['customer_id', 'query.limit'],
      forbiddenFields: ['body.customer_id'],
    },
    responseContract: {
      summary: 'Future output must include invoices, statuses, Stripe reconciliation warnings, pagination state, and tenant.',
      stableOutputRequired: true,
    },
    policyGates: READ_GATES,
    sourceIds: ['endpoint-matrix', 'official-invoice-list'],
    sources: [
      'skills/metronome-danger-zone/references/endpoint-matrix.md#11-invoices',
      'https://docs.metronome.com/api-reference/invoices/list-invoices.md',
    ],
  },
  {
    id: 'invoices.listBreakdowns',
    family: 'invoices',
    title: 'List invoice breakdowns',
    method: 'GET',
    path: '/v1/customers/{customer_id}/invoices/breakdowns',
    operationType: 'read',
    supportStatus: 'cataloged-local-only',
    tenant: TENANT_REQUIRED,
    permissionScope: 'metronome:invoices:read',
    apiAccessInCurrentCli: 'none',
    liveExecution: LOCAL_ONLY_LIVE_EXECUTION,
    currentCommands: ['metro api read-plan invoices.listBreakdowns --file <request.json|yaml> (--sandbox|--prod) [--json]'],
    futureCommands: ['metro api read invoices.listBreakdowns --file <request.json|yaml> --sandbox'],
    requestContract: {
      summary: 'Customer invoice breakdown GET request with customer_id in the path, a required starting_on/ending_before window, bounded query pagination, and optional status, sort, window_size, zero-quantity, and credit-type filters.',
      requiredFields: ['path.customer_id', 'query.starting_on', 'query.ending_before', 'query.limit'],
      optionalFields: ['query.next_page', 'query.status', 'query.skip_zero_qty_line_items', 'query.window_size', 'query.sort', 'query.credit_type_id'],
      forbiddenFields: ['body.*', 'query.customer_id', 'query.invoice_id', 'path.invoice_id', 'POST /v1/invoices/breakdowns/list'],
    },
    responseContract: {
      summary: 'Future output must include invoice breakdown rows, breakdown_start_timestamp, breakdown_end_timestamp, line items, pagination state, tenant, and request summary.',
      stableOutputRequired: true,
      expectedTopLevelFields: ['data', 'next_page'],
    },
    policyGates: READ_GATES,
    sourceIds: ['endpoint-matrix', 'official-invoice-breakdowns', 'metronome-invoicing'],
    sources: [
      'skills/metronome-danger-zone/references/endpoint-matrix.md#11-invoices',
      'skills/metronome-invoicing/SKILL.md#endpoint-inventory',
      'https://docs.metronome.com/api-reference/invoices/list-invoice-breakdowns.md',
    ],
  },
  {
    id: 'invoices.get',
    family: 'invoices',
    title: 'Get invoice',
    method: 'POST',
    path: '/v1/invoices/get',
    operationType: 'read',
    supportStatus: 'inspect-plan-supported',
    tenant: TENANT_REQUIRED,
    permissionScope: 'metronome:invoices:read',
    apiAccessInCurrentCli: 'none',
    liveExecution: LOCAL_ONLY_LIVE_EXECUTION,
    currentCommands: ['metro invoice inspect --invoice-id <id> (--sandbox|--prod) --plan [--json]'],
    futureCommands: ['metro api read invoices.get --invoice-id <id> --sandbox'],
    requestContract: {
      summary: 'Invoice get request by invoice_id.',
      requiredFields: ['invoice_id'],
      forbiddenFields: [],
    },
    responseContract: {
      summary: 'Future output must include invoice status, type, line items, billing provider hints, tenant, and request summary.',
      stableOutputRequired: true,
    },
    policyGates: READ_GATES,
    sourceIds: ['endpoint-matrix', 'official-invoice-get'],
    sources: [
      'skills/metronome-danger-zone/references/endpoint-matrix.md#11-invoices',
      'https://docs.metronome.com/api-reference/invoices/get-an-invoice.md',
    ],
  },
  {
    id: 'invoices.void',
    family: 'invoices',
    title: 'Void invoice',
    method: 'POST',
    path: '/v1/invoices/void',
    operationType: 'write',
    supportStatus: 'cataloged-local-only',
    tenant: TENANT_REQUIRED,
    permissionScope: 'metronome:invoices:write',
    apiAccessInCurrentCli: 'none',
    liveExecution: LOCAL_ONLY_LIVE_EXECUTION,
    currentCommands: [],
    futureCommands: ['metro api preview invoices.void --file <void-invoice.json|yaml> --sandbox', 'metro api apply invoices.void --file <void-invoice.json|yaml> --prod --confirm-hash <hash>'],
    requestContract: {
      summary: 'Invoice void request by reviewed body.id plus explicit FINALIZED invoice, Stripe non-refund, reconciliation, read-back, and remediation evidence.',
      requiredFields: ['body.id', 'evidence.invoiceFinalizedReviewed', 'evidence.stripePaymentStatusReviewed', 'evidence.stripeNoRefundReviewed', 'evidence.reconciliationPlanReviewed', 'evidence.invoiceReadBackPlanned'],
      forbiddenFields: ['body.invoice_id', 'body.customer_id', 'query.*', 'path.*', 'raw endpoint path fields'],
    },
    responseContract: {
      summary: 'Future live output must include the voided invoice id, prior status/payment evidence, tenant, audit row, and invoice/payment read-back plan.',
      stableOutputRequired: true,
    },
    policyGates: WRITE_GATES,
    sourceIds: ['endpoint-matrix', 'official-invoice-void', 'danger-zone', 'metronome-invoicing'],
    sources: [
      'skills/metronome-danger-zone/SKILL.md#12-v1invoicesvoid-on-a-finalized-paid-invoice',
      'skills/metronome-danger-zone/references/endpoint-matrix.md#11-invoices',
      'skills/metronome-invoicing/SKILL.md',
      'https://docs.metronome.com/api-reference/invoices/void-an-invoice.md',
    ],
  },
  {
    id: 'invoices.regenerate',
    family: 'invoices',
    title: 'Regenerate invoice',
    method: 'POST',
    path: '/v1/invoices/regenerate',
    operationType: 'write',
    supportStatus: 'cataloged-local-only',
    tenant: TENANT_REQUIRED,
    permissionScope: 'metronome:invoices:write',
    apiAccessInCurrentCli: 'none',
    liveExecution: LOCAL_ONLY_LIVE_EXECUTION,
    currentCommands: [],
    futureCommands: ['metro api preview invoices.regenerate --file <regenerate-invoice.json|yaml> --sandbox', 'metro api apply invoices.regenerate --file <regenerate-invoice.json|yaml> --prod --confirm-hash <hash>'],
    requestContract: {
      summary: 'Invoice regenerate request by reviewed body.id after VOIDED invoice proof, correction evidence, billing-provider/Stripe review, replacement invoice read-back, and reconciliation planning.',
      requiredFields: ['body.id', 'evidence.invoiceVoidedReviewed', 'evidence.correctionInputsReviewed', 'evidence.billingProviderBehaviorReviewed', 'evidence.regeneratedInvoiceReadBackPlanned', 'evidence.reconciliationPlanReviewed'],
      forbiddenFields: ['body.invoice_id', 'body.customer_id', 'query.*', 'path.*', 'raw endpoint path fields'],
    },
    responseContract: {
      summary: 'Future live output must include the regenerated invoice id or response reference, original voided invoice id, tenant, audit row, replacement invoice read-back plan, and reconciliation status.',
      stableOutputRequired: true,
    },
    policyGates: WRITE_GATES,
    sourceIds: ['endpoint-matrix', 'official-invoice-regenerate', 'danger-zone', 'metronome-invoicing'],
    sources: [
      'skills/metronome-danger-zone/SKILL.md#2c-side-discovered-useful-endpoints',
      'skills/metronome-danger-zone/references/endpoint-matrix.md#11-invoices',
      'skills/metronome-invoicing/SKILL.md',
      'https://docs.metronome.com/api-reference/invoices/regenerate-an-invoice.md',
    ],
  },
  {
    id: 'payments.listForInvoice',
    family: 'payments',
    title: 'List payments for invoice',
    method: 'POST',
    path: '/v1/invoices/payments/list',
    operationType: 'read',
    supportStatus: 'cataloged-local-only',
    tenant: TENANT_REQUIRED,
    permissionScope: 'metronome:payments:read',
    apiAccessInCurrentCli: 'none',
    liveExecution: LOCAL_ONLY_LIVE_EXECUTION,
    currentCommands: ['metro api read-plan payments.listForInvoice --file <request.json|yaml> (--sandbox|--prod) [--json]'],
    futureCommands: ['metro api read payments.listForInvoice --invoice-id <id> --sandbox'],
    requestContract: {
      summary: 'Invoice payment-attempt list request by invoice_id with optional body pagination fields.',
      requiredFields: ['invoice_id'],
      forbiddenFields: ['query.invoice_id', 'body.customer_id'],
    },
    responseContract: {
      summary: 'Future output must include payment attempts, payment statuses, invoice id, pagination state, tenant, and request summary.',
      stableOutputRequired: true,
    },
    policyGates: READ_GATES,
    sourceIds: ['endpoint-matrix'],
    sources: [
      'skills/metronome-danger-zone/references/endpoint-matrix.md#12-payments',
    ],
  },
  {
    id: 'payments.attempt',
    family: 'payments',
    title: 'Attempt payment for invoice',
    method: 'POST',
    path: '/v1/invoices/payments/attempt',
    operationType: 'write',
    supportStatus: 'cataloged-local-only',
    tenant: TENANT_REQUIRED,
    permissionScope: 'metronome:payments:write',
    apiAccessInCurrentCli: 'none',
    liveExecution: LOCAL_ONLY_LIVE_EXECUTION,
    currentCommands: [],
    futureCommands: ['metro api preview payments.attempt --file <payment-attempt.json|yaml> --sandbox', 'metro api apply payments.attempt --file <payment-attempt.json|yaml> --prod --confirm-hash <hash>'],
    requestContract: {
      summary: 'Payment-attempt request by reviewed body.invoice_id plus FINALIZED invoice, PLG invoicing, Stripe billing-provider, no-successful-payment, and read-back evidence.',
      requiredFields: ['body.invoice_id', 'evidence.invoiceFinalizedReviewed', 'evidence.plgInvoicingEnabledReviewed', 'evidence.billingProviderAttachedReviewed', 'evidence.noSuccessfulPaymentReviewed', 'evidence.paymentReadBackPlanned'],
      forbiddenFields: ['body.id', 'body.customer_id', 'query.*', 'path.*', 'raw endpoint path fields'],
    },
    responseContract: {
      summary: 'Future live output must include payment-attempt status, invoice id, tenant, audit row, and payment/invoice read-back plan.',
      stableOutputRequired: true,
    },
    policyGates: WRITE_GATES,
    sourceIds: ['endpoint-matrix', 'official-payment-attempt', 'danger-zone'],
    sources: [
      'skills/metronome-danger-zone/references/endpoint-matrix.md#12-payments',
      'https://docs.metronome.com/api-reference/payments/attempt-payment-for-an-invoice.md',
    ],
  },
  {
    id: 'payments.cancel',
    family: 'payments',
    title: 'Cancel invoice payment',
    method: 'POST',
    path: '/v1/invoices/payments/cancel',
    operationType: 'write',
    supportStatus: 'cataloged-local-only',
    tenant: TENANT_REQUIRED,
    permissionScope: 'metronome:payments:write',
    apiAccessInCurrentCli: 'none',
    liveExecution: LOCAL_ONLY_LIVE_EXECUTION,
    currentCommands: [],
    futureCommands: ['metro api preview payments.cancel --file <payment-cancel.json|yaml> --sandbox', 'metro api apply payments.cancel --file <payment-cancel.json|yaml> --prod --confirm-hash <hash>'],
    requestContract: {
      summary: 'Payment-cancel request by reviewed body.invoice_id plus pending payment proof, invoice/customer identity evidence, read-back, and retry/remediation planning.',
      requiredFields: ['body.invoice_id', 'evidence.pendingPaymentReviewed', 'evidence.invoiceIdentityReviewed', 'evidence.paymentReadBackPlanned', 'evidence.retryOrRemediationReviewed'],
      forbiddenFields: ['body.id', 'body.customer_id', 'query.*', 'path.*', 'raw endpoint path fields'],
    },
    responseContract: {
      summary: 'Future live output must include canceled payment-attempt status, invoice id, tenant, audit row, and payment/invoice read-back plan.',
      stableOutputRequired: true,
    },
    policyGates: WRITE_GATES,
    sourceIds: ['endpoint-matrix', 'official-payment-cancel', 'danger-zone'],
    sources: [
      'skills/metronome-danger-zone/references/endpoint-matrix.md#12-payments',
      'https://docs.metronome.com/api-reference/payments/cancel-a-payment-for-an-invoice.md',
    ],
  },
  {
    id: 'billingProvider.setCustomerConfigurations',
    family: 'billing-provider',
    title: 'Set customer billing provider configuration',
    method: 'POST',
    path: '/v1/setCustomerBillingProviderConfigurations',
    operationType: 'write',
    supportStatus: 'workflow-preview-supported',
    tenant: TENANT_REQUIRED,
    permissionScope: 'metronome:billing-provider:write',
    apiAccessInCurrentCli: 'none',
    liveExecution: LOCAL_ONLY_LIVE_EXECUTION,
    currentCommands: ['metro billing-provider preview --shape stripe-billing-provider-attachment --file <input.json|yaml> (--sandbox|--prod) [--json]'],
    futureCommands: ['metro api preview billingProvider.setCustomerConfigurations --file <billing.json> --sandbox', 'metro api apply billingProvider.setCustomerConfigurations --file <billing.json> --prod --confirm-hash <hash>'],
    requestContract: {
      summary: 'Customer billing-provider set request with explicit delivery method or configured delivery_method_id and draft behavior review.',
      requiredFields: ['customer_id', 'configuration.billing_provider_type', 'configuration.delivery_method or delivery_method_id'],
      forbiddenFields: ['simultaneous delivery_method and delivery_method_id without an explicit decision', 'archive existing config by default'],
    },
    responseContract: {
      summary: 'Future output must include billing-provider configuration id, delivery path, draft behavior, and read-back plan.',
      stableOutputRequired: true,
    },
    policyGates: WRITE_GATES,
    sourceIds: ['endpoint-matrix', 'official-billing-provider', 'metronome-stripe-delivery'],
    sources: [
      'skills/metronome-danger-zone/references/endpoint-matrix.md#7-billing-provider-configs-stripe',
      'skills/metronome-stripe-delivery/SKILL.md',
      'https://docs.metronome.com/api-reference/customers/set-billing-provider-configurations-for-a-customer.md',
    ],
  },
  {
    id: 'billingProvider.getCustomerConfigurations',
    family: 'billing-provider',
    title: 'Get customer billing provider configurations',
    method: 'POST',
    path: '/v1/getCustomerBillingProviderConfigurations',
    operationType: 'read',
    supportStatus: 'inspect-plan-supported',
    tenant: TENANT_REQUIRED,
    permissionScope: 'metronome:billing-provider:read',
    apiAccessInCurrentCli: 'none',
    liveExecution: LOCAL_ONLY_LIVE_EXECUTION,
    currentCommands: ['metro billing-provider inspect --customer-id <id> (--sandbox|--prod) --plan [--json]'],
    futureCommands: ['metro api read billingProvider.getCustomerConfigurations --customer-id <id> --sandbox'],
    requestContract: {
      summary: 'Customer billing-provider configuration read request by customer_id.',
      requiredFields: ['customer_id'],
      forbiddenFields: [],
    },
    responseContract: {
      summary: 'Future output must include active configurations, delivery methods, draft behavior evidence, tenant, and request summary.',
      stableOutputRequired: true,
    },
    policyGates: READ_GATES,
    sourceIds: ['endpoint-matrix', 'official-billing-provider-get', 'metronome-stripe-delivery'],
    sources: [
      'skills/metronome-danger-zone/references/endpoint-matrix.md#7-billing-provider-configs-stripe',
      'skills/metronome-stripe-delivery/SKILL.md',
      'https://docs.metronome.com/api-reference/customers/fetch-billing-provider-configurations-for-a-customer.md',
    ],
  },
  {
    id: 'billingProvider.listConfiguredProviders',
    family: 'billing-provider',
    title: 'List account-level billing providers',
    method: 'POST',
    path: '/v1/listConfiguredBillingProviders',
    operationType: 'read',
    supportStatus: 'cataloged-local-only',
    tenant: TENANT_REQUIRED,
    permissionScope: 'metronome:billing-provider:read',
    apiAccessInCurrentCli: 'none',
    liveExecution: LOCAL_ONLY_LIVE_EXECUTION,
    currentCommands: [],
    futureCommands: ['metro api read billingProvider.listConfiguredProviders --file <request.json|yaml> --sandbox --confirm-live-read <token>'],
    requestContract: {
      summary: 'Account-level billing-provider list request with optional body.next_page pagination; no customer id, query pagination, or raw Stripe credentials are allowed.',
      optionalFields: ['body.next_page'],
      forbiddenFields: ['query.next_page', 'query.limit', 'body.limit', 'Stripe credentials or raw tokens'],
    },
    responseContract: {
      summary: 'Future output must include configured billing-provider rows, delivery method ids, provider type, pagination state, tenant, and request summary without exposing credentials.',
      stableOutputRequired: true,
    },
    policyGates: READ_GATES,
    sourceIds: ['endpoint-matrix', 'official-list-configured-billing-providers', 'metronome-stripe-delivery'],
    sources: [
      'skills/metronome-danger-zone/references/endpoint-matrix.md#15-settings--security',
      'skills/metronome-stripe-delivery/SKILL.md',
      'https://docs.metronome.com/api-reference/settings/list-account-level-billing-providers.md',
    ],
  },
  {
    id: 'customFields.addKey',
    family: 'custom-fields',
    title: 'Create custom field key',
    method: 'POST',
    path: '/v1/customFields/addKey',
    operationType: 'write',
    supportStatus: 'cataloged-local-only',
    tenant: TENANT_REQUIRED,
    permissionScope: 'metronome:custom-fields:write',
    apiAccessInCurrentCli: 'none',
    liveExecution: LOCAL_ONLY_LIVE_EXECUTION,
    currentCommands: [],
    futureCommands: [
      'metro api preview customFields.addKey --file <custom-field-key.json> --sandbox',
      'metro api apply customFields.addKey --file <custom-field-key.json> --prod --confirm-hash <hash>',
    ],
    requestContract: {
      summary: 'Custom-field key allowlist write for exactly one managed entity using body.entity, body.key, and required body.enforce_uniqueness; no value-setting payload, query cursor, or raw path hints are allowed.',
      requiredFields: ['body.entity', 'body.key', 'body.enforce_uniqueness'],
      forbiddenFields: ['body.values', 'body.custom_fields', 'body.entity_type', 'query.*', 'path.*', 'body.path'],
    },
    responseContract: {
      summary: 'Future output must include the requested entity, key, enforce_uniqueness decision, response status, tenant, and listKeys read-back evidence.',
      stableOutputRequired: true,
    },
    policyGates: WRITE_GATES,
    sourceIds: ['endpoint-matrix', 'official-custom-fields-add-key', 'danger-zone'],
    sources: [
      'skills/metronome-danger-zone/references/endpoint-matrix.md#8-custom-fields',
      'skills/metronome-danger-zone/SKILL.md#16-custom-field-writes-on-contractscommits',
      'https://docs.metronome.com/api-reference/custom-fields/create-a-custom-field-key.md',
    ],
  },
  {
    id: 'customFields.removeKey',
    family: 'custom-fields',
    title: 'Delete custom field key',
    method: 'POST',
    path: '/v1/customFields/removeKey',
    operationType: 'write',
    supportStatus: 'cataloged-local-only',
    tenant: TENANT_REQUIRED,
    permissionScope: 'metronome:custom-fields:write',
    apiAccessInCurrentCli: 'none',
    liveExecution: LOCAL_ONLY_LIVE_EXECUTION,
    currentCommands: [],
    futureCommands: [
      'metro api preview customFields.removeKey --file <custom-field-key-removal.json> --sandbox',
      'metro api apply customFields.removeKey --file <custom-field-key-removal.json> --prod --confirm-hash <hash>',
    ],
    requestContract: {
      summary: 'Custom-field key allowlist removal for exactly one managed entity using body.entity and body.key; no value mutation, uniqueness policy, query cursor, or raw path hints are allowed.',
      requiredFields: ['body.entity', 'body.key'],
      forbiddenFields: ['body.entity_id', 'body.keys', 'body.custom_fields', 'body.values', 'body.enforce_uniqueness', 'body.entity_type', 'query.*', 'path.*', 'body.path'],
    },
    responseContract: {
      summary: 'Future output must include the requested entity, key, response status, tenant, and listKeys read-back evidence proving the key is no longer allowlisted.',
      stableOutputRequired: true,
    },
    policyGates: WRITE_GATES,
    sourceIds: ['endpoint-matrix', 'official-custom-fields-remove-key', 'danger-zone'],
    sources: [
      'skills/metronome-danger-zone/references/endpoint-matrix.md#8-custom-fields',
      'skills/metronome-danger-zone/SKILL.md#16-custom-field-writes-on-contractscommits',
      'https://docs.metronome.com/api-reference/custom-fields/delete-a-custom-field-key.md',
    ],
  },
  {
    id: 'customFields.setValues',
    family: 'custom-fields',
    title: 'Set custom field values',
    method: 'POST',
    path: '/v1/customFields/setValues',
    operationType: 'write',
    supportStatus: 'cataloged-local-only',
    tenant: TENANT_REQUIRED,
    permissionScope: 'metronome:custom-fields:write',
    apiAccessInCurrentCli: 'none',
    liveExecution: LOCAL_ONLY_LIVE_EXECUTION,
    currentCommands: [],
    futureCommands: [
      'metro api preview customFields.setValues --file <custom-field-values.json> --sandbox',
      'metro api apply customFields.setValues --file <custom-field-values.json> --prod --confirm-hash <hash>',
    ],
    requestContract: {
      summary: 'Custom-field value write for exactly one managed entity instance using body.entity, body.entity_id, and body.custom_fields; values must be strings of 200 characters or fewer and no allowlist mutation fields are accepted.',
      requiredFields: ['body.entity', 'body.entity_id', 'body.custom_fields'],
      forbiddenFields: ['body.key', 'body.keys', 'body.enforce_uniqueness', 'body.entity_type', 'body.values', 'query.*', 'path.*', 'body.path'],
    },
    responseContract: {
      summary: 'Future output must include the requested entity, entity_id, custom field keys, response status, tenant, listKeys allowlist evidence, and entity read-back evidence when an endpoint exists.',
      stableOutputRequired: true,
    },
    policyGates: WRITE_GATES,
    sourceIds: ['endpoint-matrix', 'official-custom-fields-set-values', 'danger-zone'],
    sources: [
      'skills/metronome-danger-zone/references/endpoint-matrix.md#8-custom-fields',
      'skills/metronome-danger-zone/SKILL.md#16-custom-field-writes-on-contractscommits',
      'https://docs.metronome.com/api-reference/custom-fields/set-custom-field-values.md',
    ],
  },
  {
    id: 'customFields.deleteValues',
    family: 'custom-fields',
    title: 'Delete custom field values',
    method: 'POST',
    path: '/v1/customFields/deleteValues',
    operationType: 'write',
    supportStatus: 'cataloged-local-only',
    tenant: TENANT_REQUIRED,
    permissionScope: 'metronome:custom-fields:write',
    apiAccessInCurrentCli: 'none',
    liveExecution: LOCAL_ONLY_LIVE_EXECUTION,
    currentCommands: [],
    futureCommands: [
      'metro api preview customFields.deleteValues --file <custom-field-value-deletion.json> --sandbox',
      'metro api apply customFields.deleteValues --file <custom-field-value-deletion.json> --prod --confirm-hash <hash>',
    ],
    requestContract: {
      summary: 'Custom-field value deletion for exactly one managed entity instance using body.entity, body.entity_id, and body.keys[]; no allowlist mutation, value-setting body, query cursor, or raw path hints are allowed.',
      requiredFields: ['body.entity', 'body.entity_id', 'body.keys[]'],
      forbiddenFields: ['body.key', 'body.custom_fields', 'body.values', 'body.enforce_uniqueness', 'body.entity_type', 'query.*', 'path.*', 'body.path'],
    },
    responseContract: {
      summary: 'Future output must include the requested entity, entity_id, deleted custom field keys, response status, tenant, and entity read-back evidence when an endpoint exists.',
      stableOutputRequired: true,
    },
    policyGates: WRITE_GATES,
    sourceIds: ['endpoint-matrix', 'official-custom-fields-delete-values', 'danger-zone'],
    sources: [
      'skills/metronome-danger-zone/references/endpoint-matrix.md#8-custom-fields',
      'skills/metronome-danger-zone/SKILL.md#16-custom-field-writes-on-contractscommits',
      'https://docs.metronome.com/api-reference/custom-fields/delete-custom-fields.md',
    ],
  },
  {
    id: 'customFields.listKeys',
    family: 'custom-fields',
    title: 'List custom field keys',
    method: 'POST',
    path: '/v1/customFields/listKeys',
    operationType: 'read',
    supportStatus: 'cataloged-local-only',
    tenant: TENANT_REQUIRED,
    permissionScope: 'metronome:custom-fields:read',
    apiAccessInCurrentCli: 'none',
    liveExecution: LOCAL_ONLY_LIVE_EXECUTION,
    currentCommands: [],
    futureCommands: ['metro api read customFields.listKeys --file <request.json|yaml> --sandbox --confirm-live-read <token>'],
    requestContract: {
      summary: 'Custom-field key allowlist read with optional body.entities[] entity-type filters and query.next_page pagination; no query entity filters, body pagination cursor, or raw path hints are allowed.',
      optionalFields: ['body.entities[]', 'query.next_page'],
      forbiddenFields: ['query.entities', 'body.next_page', 'body.path', 'query.path', 'path.path'],
    },
    responseContract: {
      summary: 'Future output must include entity, key, enforce_uniqueness, next_page pagination state, tenant, and request summary without exposing credentials.',
      stableOutputRequired: true,
    },
    policyGates: READ_GATES,
    sourceIds: ['endpoint-matrix', 'official-custom-fields-list-keys', 'danger-zone'],
    sources: [
      'skills/metronome-danger-zone/references/endpoint-matrix.md#8-custom-fields',
      'skills/metronome-danger-zone/SKILL.md#16-custom-field-writes-on-contractscommits',
      'https://docs.metronome.com/api-reference/custom-fields/list-custom-field-keys.md',
    ],
  },
  {
    id: 'settings.listPricingUnits',
    family: 'settings',
    title: 'List pricing units',
    method: 'GET',
    path: '/v1/credit-types/list',
    operationType: 'read',
    supportStatus: 'cataloged-local-only',
    tenant: TENANT_REQUIRED,
    permissionScope: 'metronome:settings:read',
    apiAccessInCurrentCli: 'none',
    liveExecution: LOCAL_ONLY_LIVE_EXECUTION,
    currentCommands: [],
    futureCommands: ['metro api read settings.listPricingUnits --file <request.json|yaml> --sandbox --confirm-live-read <token>'],
    requestContract: {
      summary: 'Pricing-unit list request using GET query pagination on the current official /v1/credit-types/list path; no request body or stale /v1/pricingUnits path is allowed.',
      requiredFields: ['query.limit'],
      optionalFields: ['query.next_page'],
      forbiddenFields: ['body.limit', 'body.next_page', 'body.path', 'query.path', '/v1/pricingUnits'],
    },
    responseContract: {
      summary: 'Future output must include pricing-unit rows, fiat/custom credit type details, pagination state, tenant, and request summary without exposing credentials.',
      stableOutputRequired: true,
    },
    policyGates: READ_GATES,
    sourceIds: ['endpoint-matrix', 'official-pricing-units-list', 'conventions'],
    sources: [
      'skills/metronome-danger-zone/references/endpoint-matrix.md#15-settings--security',
      'skills/_metronome-shared/conventions.md#method-gotcha',
      'https://docs.metronome.com/api-reference/settings/list-pricing-units.md',
    ],
  },
  {
    id: 'security.getServices',
    family: 'security',
    title: 'Get service registry',
    method: 'GET',
    path: '/v1/services',
    operationType: 'read',
    supportStatus: 'cataloged-local-only',
    tenant: TENANT_REQUIRED,
    permissionScope: 'metronome:security:read',
    apiAccessInCurrentCli: 'none',
    liveExecution: LOCAL_ONLY_LIVE_EXECUTION,
    currentCommands: [],
    futureCommands: ['metro api read security.getServices --file <request.json|yaml> --sandbox --confirm-live-read <token>'],
    requestContract: {
      summary: 'Security service registry read using the current official GET /v1/services path; no body, query, path parameters, or stale /v1/security/services path are allowed.',
      forbiddenFields: ['body.*', 'query.*', 'path.*', '/v1/security/services'],
    },
    responseContract: {
      summary: 'Future output must include service names, usage direction, IP ranges, tenant, and request summary without exposing credentials.',
      stableOutputRequired: true,
    },
    policyGates: READ_GATES,
    sourceIds: ['endpoint-matrix', 'official-security-services', 'conventions'],
    sources: [
      'skills/metronome-danger-zone/references/endpoint-matrix.md#15-settings--security',
      'skills/_metronome-shared/conventions.md#method-gotcha',
      'https://docs.metronome.com/api-reference/security/get-services.md',
    ],
  },
  {
    id: 'security.getAuditLogs',
    family: 'security',
    title: 'Get audit logs',
    method: 'GET',
    path: '/v1/auditLogs',
    operationType: 'read',
    supportStatus: 'cataloged-local-only',
    tenant: TENANT_REQUIRED,
    permissionScope: 'metronome:security:read',
    apiAccessInCurrentCli: 'none',
    liveExecution: LOCAL_ONLY_LIVE_EXECUTION,
    currentCommands: [],
    futureCommands: ['metro api read security.getAuditLogs --file <request.json|yaml> --sandbox --confirm-live-read <token>'],
    requestContract: {
      summary: 'Security audit-log read using the current official GET /v1/auditLogs path with query-only limit, next_page, date filters, sort, and paired resource filters; no body, path parameters, stale /v1/security/auditLogs path, date filters with next_page, or unpaired resource filters are allowed.',
      optionalFields: ['query.limit', 'query.next_page', 'query.starting_on', 'query.ending_before', 'query.sort', 'query.resource_id', 'query.resource_type'],
      forbiddenFields: ['body.*', 'path.*', 'body.path', 'query.path', 'path.path', '/v1/security/auditLogs', 'query.next_page with query.starting_on or query.ending_before', 'unpaired query.resource_id or query.resource_type'],
    },
    responseContract: {
      summary: 'Future output must include audit log rows, actor/request metadata, resource/action/status fields, next_page pagination state, tenant, and request summary without exposing credentials.',
      stableOutputRequired: true,
    },
    policyGates: READ_GATES,
    sourceIds: ['endpoint-matrix', 'official-security-audit-logs', 'conventions'],
    sources: [
      'skills/metronome-danger-zone/references/endpoint-matrix.md#15-settings--security',
      'skills/_metronome-shared/conventions.md#method-gotcha',
      'https://docs.metronome.com/api-reference/security/get-audit-logs.md',
    ],
  },
  {
    id: 'products.get',
    family: 'products',
    title: 'Get product state',
    method: 'POST',
    path: '/v1/contract-pricing/products/get',
    operationType: 'read',
    supportStatus: 'inspect-plan-supported',
    tenant: TENANT_REQUIRED,
    permissionScope: 'metronome:products:read',
    apiAccessInCurrentCli: 'none',
    liveExecution: LOCAL_ONLY_LIVE_EXECUTION,
    currentCommands: ['metro product inspect --product-id <id> (--sandbox|--prod) --plan [--json]'],
    futureCommands: ['metro api read products.get --file <request.json|yaml> --sandbox --confirm-live-read <token>'],
    requestContract: {
      summary: 'Product get request by official body.id.',
      requiredFields: ['body.id'],
      forbiddenFields: ['body.product_id', 'query.id', 'query.product_id'],
    },
    responseContract: {
      summary: 'Future output must include current, initial, archived, and scheduled update state with tenant and request summary.',
      stableOutputRequired: true,
    },
    policyGates: READ_GATES,
    sourceIds: ['endpoint-matrix', 'official-product-get'],
    sources: [
      'skills/metronome-danger-zone/references/endpoint-matrix.md#3-products',
      'https://docs.metronome.com/api-reference/products/get-a-product.md',
    ],
  },
  {
    id: 'products.list',
    family: 'products',
    title: 'List products',
    method: 'POST',
    path: '/v1/contract-pricing/products/list',
    operationType: 'read',
    supportStatus: 'cataloged-local-only',
    tenant: TENANT_REQUIRED,
    permissionScope: 'metronome:products:read',
    apiAccessInCurrentCli: 'none',
    liveExecution: LOCAL_ONLY_LIVE_EXECUTION,
    currentCommands: [],
    futureCommands: ['metro api read products.list --file <request.json|yaml> --sandbox --confirm-live-read <token>'],
    requestContract: {
      summary: 'Product list request with reviewed query pagination and an explicit archive_filter body decision.',
      requiredFields: ['query.limit', 'body.archive_filter'],
      optionalFields: ['query.next_page'],
      forbiddenFields: ['body.limit', 'body.next_page', 'query.archive_filter'],
    },
    responseContract: {
      summary: 'Future output must include product rows, archive state, version history, pagination state, tenant, and request summary.',
      stableOutputRequired: true,
    },
    policyGates: READ_GATES,
    sourceIds: ['endpoint-matrix', 'official-product-list'],
    sources: [
      'skills/metronome-danger-zone/references/endpoint-matrix.md#3-products',
      'https://docs.metronome.com/api-reference/products/list-products.md',
    ],
  },
  {
    id: 'products.create',
    family: 'products',
    title: 'Create usage product',
    method: 'POST',
    path: '/v1/contract-pricing/products/create',
    operationType: 'write',
    supportStatus: 'workflow-preview-supported',
    tenant: TENANT_REQUIRED,
    permissionScope: 'metronome:products:write',
    apiAccessInCurrentCli: 'none',
    liveExecution: LOCAL_ONLY_LIVE_EXECUTION,
    currentCommands: ['metro rate-card dimensional preview --file <input.json|yaml> (--sandbox|--prod) [--json]'],
    futureCommands: [
      'metro api preview products.create --file <usage-product-create.json> --sandbox',
      'metro api apply products.create --file <usage-product-create.json> --prod --confirm-hash <hash>',
    ],
    requestContract: {
      summary: 'Future write runner must POST a reviewed USAGE product body with customer-facing name, billable_metric_id, optional tags, and optional dimensional group keys. Other product types are intentionally unsupported by this local expert contract until their pricing and invoice behavior are modeled separately.',
      requiredFields: ['body.name', 'body.type=USAGE', 'body.billable_metric_id', 'evidence.customerFacingNameReviewed', 'evidence.billableMetricReadBackReviewed', 'evidence.duplicateProductReviewed'],
      optionalFields: ['body.tags[]', 'body.pricing_group_key[]', 'body.presentation_group_key[]', 'body.quantity_conversion', 'body.quantity_rounding', 'body.custom_fields'],
      forbiddenFields: ['body.type FIXED|SUBSCRIPTION|COMPOSITE|PROFESSIONAL_SERVICE|PRO_SERVICE', 'body.composite_product_ids', 'body.composite_tags', 'body.rate_card_id', 'body.price', 'query.*', 'path.*'],
    },
    responseContract: {
      summary: 'Future live output must include the created product id, response hash, products.get/list read-back plan, billable metric evidence, and a rate-card addRates handoff decision.',
      stableOutputRequired: true,
    },
    policyGates: WRITE_GATES,
    sourceIds: ['endpoint-matrix', 'official-product-create', 'metronome-pricing-catalog'],
    sources: [
      'skills/metronome-pricing-catalog/SKILL.md#create-a-usage-product',
      'skills/metronome-danger-zone/references/endpoint-matrix.md#3-products',
      'https://docs.metronome.com/api-reference/products/create-a-product.md',
    ],
  },
  {
    id: 'products.update',
    family: 'products',
    title: 'Schedule usage product update',
    method: 'POST',
    path: '/v1/contract-pricing/products/update',
    operationType: 'write',
    supportStatus: 'workflow-preview-supported',
    tenant: TENANT_REQUIRED,
    permissionScope: 'metronome:products:write',
    apiAccessInCurrentCli: 'none',
    liveExecution: LOCAL_ONLY_LIVE_EXECUTION,
    currentCommands: [],
    futureCommands: [
      'metro api preview products.update --file <usage-product-update.json> --sandbox',
      'metro api apply products.update --file <usage-product-update.json> --prod --confirm-hash <hash>',
    ],
    requestContract: {
      summary: 'Future write runner must POST a reviewed scheduled USAGE product update with body.product_id, hour-boundary body.starting_at, at least one supported mutable field, and read-back evidence. Type changes, composite fields, and client-gated product fields are intentionally unsupported by this local expert contract.',
      requiredFields: ['body.product_id', 'body.starting_at', 'one of body.name|body.tags|body.billable_metric_id|body.pricing_group_key|body.presentation_group_key|body.quantity_conversion|body.quantity_rounding', 'evidence.productGetReadBackReviewed', 'evidence.scheduledUpdateReviewed', 'evidence.billingContinuityReviewed'],
      optionalFields: ['body.name', 'body.tags[]', 'body.billable_metric_id', 'body.pricing_group_key[]', 'body.presentation_group_key[]', 'body.quantity_conversion', 'body.quantity_rounding'],
      forbiddenFields: ['body.type', 'body.id', 'body.composite_product_ids', 'body.composite_tags', 'body.custom_fields', 'query.*', 'path.*'],
    },
    responseContract: {
      summary: 'Future live output must include the product id, response hash, products.get update-history read-back plan, and billable metric evidence when metering fields changed.',
      stableOutputRequired: true,
    },
    policyGates: WRITE_GATES,
    sourceIds: ['endpoint-matrix', 'official-product-update', 'metronome-pricing-catalog'],
    sources: [
      'skills/metronome-pricing-catalog/SKILL.md#update-a-product-scheduled-change',
      'skills/metronome-pricing-catalog/SKILL.md#scheduled-renames--getrates-display-name-caching',
      'skills/metronome-danger-zone/references/endpoint-matrix.md#3-products',
      'https://docs.metronome.com/api-reference/products/update-a-product.md',
    ],
  },
  {
    id: 'products.archive',
    family: 'products',
    title: 'Archive product',
    method: 'POST',
    path: '/v1/contract-pricing/products/archive',
    operationType: 'write',
    supportStatus: 'workflow-preview-supported',
    tenant: TENANT_REQUIRED,
    permissionScope: 'metronome:products:write',
    apiAccessInCurrentCli: 'none',
    liveExecution: LOCAL_ONLY_LIVE_EXECUTION,
    currentCommands: [
      'metro product retire preview --file <input.json|yaml> (--sandbox|--prod) [--json]',
      'metro rate-card dimensional preview --file <input.json|yaml> (--sandbox|--prod) [--json]',
    ],
    futureCommands: ['metro api preview products.archive --file <archive.json> --sandbox', 'metro api apply products.archive --file <archive.json> --prod --confirm-hash <hash>'],
    requestContract: {
      summary: 'Future write runner must POST body.product_id for the reviewed product to archive, after product identity, active rate-card inventory, close-entry, invoice-line, irreversible archive, and read-back evidence.',
      requiredFields: ['body.product_id', 'evidence.productIdentityReviewed', 'evidence.activeRateCardInventoryReviewed', 'evidence.rateCardCloseVerified', 'evidence.rateCardScheduleReadBackReviewed', 'evidence.invoiceLineBehaviorReviewed', 'evidence.archiveIrreversibleReviewed', 'evidence.productGetListReadBackReviewed'],
      optionalFields: [],
      forbiddenFields: ['body.id', 'body.name', 'body.type', 'body.billable_metric_id', 'body.rate_card_id', 'body.price', 'body.rates', 'body.products', 'body.product_order', 'body.package_id', 'body.contract_id', 'body.customer_id', 'query.*', 'path.*'],
    },
    responseContract: {
      summary: 'Future output must include archived product id, response hash, archive irreversibility summary, rate-card close evidence, products.get/list read-back, and rateCards.getRates/getRateSchedule read-back checks.',
      stableOutputRequired: true,
    },
    policyGates: WRITE_GATES,
    sourceIds: ['endpoint-matrix', 'official-product-archive', 'danger-zone'],
    sources: [
      'skills/metronome-danger-zone/SKILL.md',
      'skills/metronome-danger-zone/references/endpoint-matrix.md#3-products',
      'https://docs.metronome.com/api-reference/products/archive-a-product.md',
    ],
  },
  {
    id: 'rateCards.create',
    family: 'rate-cards',
    title: 'Create rate card',
    method: 'POST',
    path: '/v1/contract-pricing/rate-cards/create',
    operationType: 'write',
    supportStatus: 'workflow-preview-supported',
    tenant: TENANT_REQUIRED,
    permissionScope: 'metronome:rate-cards:write',
    apiAccessInCurrentCli: 'none',
    liveExecution: LOCAL_ONLY_LIVE_EXECUTION,
    currentCommands: [],
    futureCommands: [
      'metro api preview rateCards.create --file <rate-card-create.json> --sandbox',
      'metro api apply rateCards.create --file <rate-card-create.json> --prod --confirm-hash <hash>',
    ],
    requestContract: {
      summary: 'Future write runner must POST a reviewed rate-card metadata body with body.name, optional description, fiat credit type, custom credit conversions, aliases, and custom fields. Product rates and package/contract attachment stay in separate reviewed workflows.',
      requiredFields: ['body.name', 'evidence.creditTypeConfigurationReviewed', 'evidence.duplicateRateCardReviewed', 'evidence.rateCardGetListReadBackReviewed'],
      optionalFields: ['body.description', 'body.fiat_credit_type_id', 'body.credit_type_conversions[]', 'body.aliases[]', 'body.custom_fields'],
      forbiddenFields: ['body.rates', 'body.products', 'body.rate_card_id', 'body.id', 'body.product_id', 'body.price', 'query.*', 'path.*'],
    },
    responseContract: {
      summary: 'Future live output must include the created rate card id, response hash, aliases and credit-type conversion summary, and rateCards.get/list read-back plan before addRates or package/contract attachment.',
      stableOutputRequired: true,
    },
    policyGates: WRITE_GATES,
    sourceIds: ['endpoint-matrix', 'official-rate-card-create', 'metronome-pricing-catalog'],
    sources: [
      'skills/metronome-pricing-catalog/SKILL.md#create-a-rate-card-with-custom-credit-conversion',
      'skills/metronome-danger-zone/references/endpoint-matrix.md#4-rate-cards',
      'https://docs.metronome.com/api-reference/rate-cards/create-a-rate-card.md',
    ],
  },
  {
    id: 'rateCards.update',
    family: 'rate-cards',
    title: 'Update rate card metadata',
    method: 'POST',
    path: '/v1/contract-pricing/rate-cards/update',
    operationType: 'write',
    supportStatus: 'workflow-preview-supported',
    tenant: TENANT_REQUIRED,
    permissionScope: 'metronome:rate-cards:write',
    apiAccessInCurrentCli: 'none',
    liveExecution: LOCAL_ONLY_LIVE_EXECUTION,
    currentCommands: [],
    futureCommands: [
      'metro api preview rateCards.update --file <rate-card-update.json> --sandbox',
      'metro api apply rateCards.update --file <rate-card-update.json> --prod --confirm-hash <hash>',
    ],
    requestContract: {
      summary: 'Future write runner must POST a reviewed rate-card metadata update with body.rate_card_id, at least one of body.name or body.description, optional aliases, and alias-transition evidence when aliases are present. Pricing rates and product ordering stay in separate reviewed workflows.',
      requiredFields: ['body.rate_card_id', 'one of body.name|body.description', 'evidence.rateCardIdentityReviewed', 'evidence.metadataChangeReviewed', 'evidence.rateCardGetListReadBackReviewed'],
      optionalFields: ['body.name', 'body.description', 'body.aliases[]'],
      forbiddenFields: ['body.rates', 'body.products', 'body.fiat_credit_type_id', 'body.credit_type_conversions', 'body.custom_fields', 'body.product_order', 'query.*', 'path.*'],
    },
    responseContract: {
      summary: 'Future live output must include the updated rate card id, response hash, metadata and alias summary, and rateCards.get/list read-back plan before future contracts rely on aliases.',
      stableOutputRequired: true,
    },
    policyGates: WRITE_GATES,
    sourceIds: ['endpoint-matrix', 'official-rate-card-update', 'metronome-pricing-catalog'],
    sources: [
      'skills/metronome-pricing-catalog/SKILL.md#rate-cards',
      'skills/metronome-danger-zone/references/endpoint-matrix.md#4-rate-cards',
      'https://docs.metronome.com/api-reference/rate-cards/update-a-rate-card.md',
    ],
  },
  {
    id: 'rateCards.archive',
    family: 'rate-cards',
    title: 'Archive rate card',
    method: 'POST',
    path: '/v1/contract-pricing/rate-cards/archive',
    operationType: 'write',
    supportStatus: 'workflow-preview-supported',
    tenant: TENANT_REQUIRED,
    permissionScope: 'metronome:rate-cards:write',
    apiAccessInCurrentCli: 'none',
    liveExecution: LOCAL_ONLY_LIVE_EXECUTION,
    currentCommands: [],
    futureCommands: [
      'metro api preview rateCards.archive --file <rate-card-archive.json> --sandbox',
      'metro api apply rateCards.archive --file <rate-card-archive.json> --prod --confirm-hash <hash>',
    ],
    requestContract: {
      summary: 'Future write runner must POST body.id for the reviewed rate card to archive, after package and contract dependency review. This preserves existing contract pricing but prevents new contract use.',
      requiredFields: ['body.id', 'evidence.rateCardIdentityReviewed', 'evidence.archiveBusinessPurposeReviewed', 'evidence.packageContractDependencyReviewed', 'evidence.replacementOrRetirementPlanReviewed', 'evidence.existingContractPricingReviewed', 'evidence.rateCardGetListReadBackReviewed'],
      optionalFields: [],
      forbiddenFields: ['body.rate_card_id', 'body.name', 'body.description', 'body.aliases', 'body.rates', 'body.products', 'body.product_order', 'body.package_id', 'body.package_alias', 'body.contract_id', 'body.customer_id', 'query.*', 'path.*'],
    },
    responseContract: {
      summary: 'Future live output must include the archived rate card id, response hash, archive/dependency summary, and rateCards.get/list plus package/contract dependency read-back plan.',
      stableOutputRequired: true,
    },
    policyGates: WRITE_GATES,
    sourceIds: ['endpoint-matrix', 'official-rate-card-archive', 'metronome-pricing-catalog'],
    sources: [
      'skills/metronome-pricing-catalog/SKILL.md#rate-cards',
      'skills/metronome-danger-zone/references/endpoint-matrix.md#4-rate-cards',
      'https://docs.metronome.com/api-reference/rate-cards/archive-a-rate-card.md',
    ],
  },
  {
    id: 'rateCards.setProductOrder',
    family: 'rate-cards',
    title: 'Set rate-card product invoice order',
    method: 'POST',
    path: '/v1/contract-pricing/rate-cards/setRateCardProductsOrder',
    operationType: 'write',
    supportStatus: 'workflow-preview-supported',
    tenant: TENANT_REQUIRED,
    permissionScope: 'metronome:rate-cards:write',
    apiAccessInCurrentCli: 'none',
    liveExecution: LOCAL_ONLY_LIVE_EXECUTION,
    currentCommands: [],
    futureCommands: [
      'metro api preview rateCards.setProductOrder --file <rate-card-product-order.json> --sandbox',
      'metro api apply rateCards.setProductOrder --file <rate-card-product-order.json> --prod --confirm-hash <hash>',
    ],
    requestContract: {
      summary: 'Future write runner must POST a reviewed product-order body with body.rate_card_id and body.product_order[] product ids. Pricing rates, product creation, packages, contracts, and metadata updates stay in separate reviewed workflows.',
      requiredFields: ['body.rate_card_id', 'body.product_order[]', 'evidence.rateCardIdentityReviewed', 'evidence.productOrderReviewed', 'evidence.productReadBackReviewed', 'evidence.invoicePresentationReviewed', 'evidence.rateCardRateReadBackReviewed'],
      optionalFields: [],
      forbiddenFields: ['body.id', 'body.name', 'body.description', 'body.aliases', 'body.rates', 'body.products', 'body.product_id', 'body.price', 'body.rate_type', 'body.credit_type_id', 'body.entitled', 'body.package_id', 'body.package_alias', 'body.contract_id', 'body.customer_id', 'query.*', 'path.*'],
    },
    responseContract: {
      summary: 'Future live output must include the updated rate card id, response hash, ordered product-id summary, and rateCards.getRates/getRateSchedule plus product read-back plan before invoice presentation is considered verified.',
      stableOutputRequired: true,
    },
    policyGates: WRITE_GATES,
    sourceIds: ['endpoint-matrix', 'official-rate-card-products-order', 'metronome-pricing-catalog'],
    sources: [
      'skills/metronome-pricing-catalog/SKILL.md#rate-cards',
      'skills/metronome-danger-zone/references/endpoint-matrix.md#4-rate-cards',
      'https://docs.metronome.com/api-reference/rate-cards/set-the-rate-card-products-order.md',
    ],
  },
  {
    id: 'rateCards.get',
    family: 'rate-cards',
    title: 'Get rate card metadata',
    method: 'POST',
    path: '/v1/contract-pricing/rate-cards/get',
    operationType: 'read',
    supportStatus: 'cataloged-local-only',
    tenant: TENANT_REQUIRED,
    permissionScope: 'metronome:rate-cards:read',
    apiAccessInCurrentCli: 'none',
    liveExecution: LOCAL_ONLY_LIVE_EXECUTION,
    currentCommands: [],
    futureCommands: ['metro api read rateCards.get --file <request.json|yaml> --sandbox --confirm-live-read <token>'],
    requestContract: {
      summary: 'Rate-card metadata get request by official body.id; this endpoint does not return rates.',
      requiredFields: ['body.id'],
      forbiddenFields: ['body.rate_card_id', 'query.id', 'query.rate_card_id'],
    },
    responseContract: {
      summary: 'Future output must include rate-card metadata, aliases, credit type configuration, tenant, and request summary; rates require getRates or getRateSchedule.',
      stableOutputRequired: true,
    },
    policyGates: READ_GATES,
    sourceIds: ['endpoint-matrix', 'official-rate-card-get'],
    sources: [
      'skills/metronome-danger-zone/references/endpoint-matrix.md#4-rate-cards',
      'https://docs.metronome.com/api-reference/rate-cards/get-a-rate-card.md',
    ],
  },
  {
    id: 'rateCards.list',
    family: 'rate-cards',
    title: 'List rate cards',
    method: 'POST',
    path: '/v1/contract-pricing/rate-cards/list',
    operationType: 'read',
    supportStatus: 'cataloged-local-only',
    tenant: TENANT_REQUIRED,
    permissionScope: 'metronome:rate-cards:read',
    apiAccessInCurrentCli: 'none',
    liveExecution: LOCAL_ONLY_LIVE_EXECUTION,
    currentCommands: [],
    futureCommands: ['metro api read rateCards.list --file <request.json|yaml> --sandbox --confirm-live-read <token>'],
    requestContract: {
      summary: 'Rate-card list request with reviewed query pagination and an empty POST body.',
      requiredFields: ['query.limit'],
      optionalFields: ['query.next_page'],
      forbiddenFields: ['body.limit', 'body.next_page', 'body.id', 'body.rate_card_id'],
    },
    responseContract: {
      summary: 'Future output must include rate-card metadata rows, aliases, credit type configuration, pagination state, tenant, and request summary; rates require getRates or getRateSchedule.',
      stableOutputRequired: true,
    },
    policyGates: READ_GATES,
    sourceIds: ['endpoint-matrix', 'official-rate-card-list'],
    sources: [
      'skills/metronome-danger-zone/references/endpoint-matrix.md#4-rate-cards',
      'https://docs.metronome.com/api-reference/rate-cards/list-rate-cards.md',
    ],
  },
  {
    id: 'rateCards.getRates',
    family: 'rate-cards',
    title: 'Get rate-card rates at timestamp',
    method: 'POST',
    path: '/v1/contract-pricing/rate-cards/getRates',
    operationType: 'read',
    supportStatus: 'cataloged-local-only',
    tenant: TENANT_REQUIRED,
    permissionScope: 'metronome:rate-cards:read',
    apiAccessInCurrentCli: 'none',
    liveExecution: LOCAL_ONLY_LIVE_EXECUTION,
    currentCommands: [],
    futureCommands: ['metro api read rateCards.getRates --file <request.json|yaml> --sandbox --confirm-live-read <token>'],
    requestContract: {
      summary: 'Rate-card getRates request with body.rate_card_id and body.at, optional body.selectors[], and reviewed query pagination. This endpoint returns rates effective at the timestamp, not rate-card metadata.',
      requiredFields: ['body.rate_card_id', 'body.at', 'query.limit'],
      optionalFields: ['query.next_page', 'body.selectors[]'],
      forbiddenFields: ['query.rate_card_id', 'query.at', 'query.product_id', 'body.limit', 'body.next_page'],
    },
    responseContract: {
      summary: 'Future output must include effective rate rows, product ids, product names as returned by getRates, entitlement, pricing group values, rate data, pagination state, tenant, and request summary. Scheduled product renames still require products.get updates evidence.',
      stableOutputRequired: true,
    },
    policyGates: READ_GATES,
    sourceIds: ['endpoint-matrix', 'official-rate-card-get-rates', 'local-probe-prod-all-rates'],
    sources: [
      'skills/metronome-danger-zone/references/endpoint-matrix.md#4-rate-cards',
      'https://docs.metronome.com/api-reference/rate-cards/get-rates.md',
    ],
  },
  {
    id: 'rateCards.addRates',
    family: 'rate-cards',
    title: 'Add scheduled rate-card changes',
    method: 'POST',
    path: '/v1/contract-pricing/rate-cards/addRates',
    operationType: 'write',
    supportStatus: 'workflow-preview-supported',
    tenant: TENANT_REQUIRED,
    permissionScope: 'metronome:rate-cards:write',
    apiAccessInCurrentCli: 'none',
    liveExecution: LOCAL_ONLY_LIVE_EXECUTION,
    currentCommands: ['metro product retire preview --file <input.json|yaml> (--sandbox|--prod) [--json]'],
    futureCommands: ['metro api preview rateCards.addRates --file <rates.json> --sandbox', 'metro api apply rateCards.addRates --file <rates.json> --prod --confirm-hash <hash>'],
    requestContract: {
      summary: 'Rate-card addRates request for reviewed scheduled entries such as product retirement close entries.',
      requiredFields: ['rate_card_id', 'starting_at', 'rates[]'],
      forbiddenFields: ['non-hour-boundary starting_at', 'product archive without rate closure'],
    },
    responseContract: {
      summary: 'Future output must include affected rate card id, rate ids or schedule evidence, and read-back checks.',
      stableOutputRequired: true,
    },
    policyGates: WRITE_GATES,
    sourceIds: ['endpoint-matrix', 'official-rate-card-add-rates', 'danger-zone'],
    sources: [
      'skills/metronome-danger-zone/SKILL.md',
      'skills/metronome-danger-zone/references/endpoint-matrix.md#4-rate-cards',
      'https://docs.metronome.com/api-reference/rate-cards/add-rates.md',
    ],
  },
  {
    id: 'rateCards.getRateSchedule',
    family: 'rate-cards',
    title: 'Get rate-card schedule',
    method: 'POST',
    path: '/v1/contract-pricing/rate-cards/getRateSchedule',
    operationType: 'read',
    supportStatus: 'inspect-plan-supported',
    tenant: TENANT_REQUIRED,
    permissionScope: 'metronome:rate-cards:read',
    apiAccessInCurrentCli: 'none',
    liveExecution: LOCAL_ONLY_LIVE_EXECUTION,
    currentCommands: ['metro product inspect --product-id <id> (--sandbox|--prod) --plan [--json]'],
    futureCommands: ['metro api read rateCards.getRateSchedule --rate-card-id <id> --sandbox'],
    requestContract: {
      summary: 'Rate-card schedule read request by rate_card_id with optional time filter.',
      requiredFields: ['rate_card_id'],
      forbiddenFields: [],
    },
    responseContract: {
      summary: 'Future output must include scheduled changes, product filters, tenant, and request summary.',
      stableOutputRequired: true,
    },
    policyGates: READ_GATES,
    sourceIds: ['endpoint-matrix', 'official-rate-card-get-rate-schedule'],
    sources: [
      'skills/metronome-danger-zone/references/endpoint-matrix.md#4-rate-cards',
      'https://docs.metronome.com/api-reference/rate-cards/get-a-rate-schedule.md',
    ],
  },
];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function endpointWithDerivedFields(endpoint) {
  const copy = clone(endpoint);
  if (SIDE_EFFECT_PROFILES[copy.id]) {
    copy.sideEffectProfile = clone(SIDE_EFFECT_PROFILES[copy.id]);
  }
  return copy;
}

function apiFamilies() {
  return [...new Set(ENDPOINTS.map((endpoint) => endpoint.family))].sort();
}

function accessClassForScope(scope) {
  const parts = String(scope || '').split(':');
  return parts[2] || 'unknown';
}

function familyForScope(scope) {
  const parts = String(scope || '').split(':');
  return parts[1] || 'unknown';
}

function permissionPolicy(accessClass) {
  if (accessClass === 'write') {
    return {
      approvalModel: 'owner approval bound to reviewed preview and preflight hashes',
      requiredBeforeLive: WRITE_GATES,
      liveCommandStatus: 'blocked-until-apply-runner',
    };
  }
  if (accessClass === 'read') {
    return {
      approvalModel: 'current-turn live-read authorization with tenant-scoped profile',
      requiredBeforeLive: READ_GATES,
      liveCommandStatus: 'blocked-until-guarded-read-runner',
    };
  }
  return {
    approvalModel: 'unclassified scope; do not expose live execution',
    requiredBeforeLive: ['scope classification', 'owner approval'],
    liveCommandStatus: 'blocked-until-classified',
  };
}

const APPROVAL_POLICY_SOURCES = [
  'docs/SAFETY.md',
  'docs/metronome-cli/one-goal.md',
  'docs/metronome-cli/CLI_ARCHITECTURE.md',
  'docs/metronome-cli/VALIDATION_AND_GUARDRAILS.md',
  'skills/metronome-danger-zone/SKILL.md',
];

const READ_APPROVAL_FIELDS = [
  'approvalId',
  'requestedBy',
  'tenant',
  'permissionScope',
  'endpointId',
  'businessPurpose',
  'targetIdentifiers',
  'confirmLiveReadToken',
  'profileName',
  'keyFingerprint',
  'outputDestination',
];

const WRITE_APPROVAL_FIELDS = [
  'approvalId',
  'requestedBy',
  'tenant',
  'permissionScope',
  'endpointId',
  'businessPurpose',
  'targetIdentifiers',
  'owner',
  'approverRoles',
  'previewPayloadHash',
  'preflightFileHash',
  'applyGateFileHash',
  'sandboxProofFileHash',
  'auditLogDestination',
  'keyFingerprint',
  'canaryPlan',
  'readBackPlan',
  'rollbackOrRemediationPlan',
  'idempotencyReview',
  'productionConfirmation',
];

function writePolicyByFamily(family) {
  const policies = {
    'billing-provider': {
      approvalTier: 'stripe-delivery-write',
      accountableOwnerRole: 'billing-ops-owner',
      requiredApproverRoles: ['billing-ops-owner', 'stripe-delivery-reviewer'],
      riskClass: 'invoice-delivery-risk',
      extraEvidence: ['billing provider config read-back plan', 'Stripe draft behavior review'],
    },
    contracts: {
      approvalTier: 'contract-write',
      accountableOwnerRole: 'billing-ops-owner',
      requiredApproverRoles: ['billing-ops-owner', 'engineering-reviewer'],
      riskClass: 'contract-invoice-access-risk',
      extraEvidence: ['customer identity proof', 'invoice behavior review', 'contract read-back plan'],
    },
    customers: {
      approvalTier: 'customer-lifecycle-write',
      accountableOwnerRole: 'billing-ops-owner',
      requiredApproverRoles: ['billing-ops-owner', 'customer-operations-reviewer'],
      riskClass: 'customer-identity-routing-risk',
      extraEvidence: ['customer identity proof', 'alias collision review', 'customer get/list read-back plan', 'invoice and Stripe side-effect review when applicable'],
    },
    invoices: {
      approvalTier: 'invoice-lifecycle-write',
      accountableOwnerRole: 'billing-ops-owner',
      requiredApproverRoles: ['billing-ops-owner', 'finance-operations-reviewer'],
      riskClass: 'invoice-stripe-reconciliation-risk',
      extraEvidence: ['invoice state proof', 'Stripe payment/refund review', 'customer invoice inventory', 'finance reconciliation plan'],
    },
    packages: {
      approvalTier: 'package-write',
      accountableOwnerRole: 'billing-ops-owner',
      requiredApproverRoles: ['billing-ops-owner', 'pricing-catalog-owner'],
      riskClass: 'package-catalog-risk',
      extraEvidence: ['alias handoff review', 'contracts-on-package inventory when archiving'],
    },
    payments: {
      approvalTier: 'payment-attempt-write',
      accountableOwnerRole: 'billing-ops-owner',
      requiredApproverRoles: ['billing-ops-owner', 'finance-operations-reviewer'],
      riskClass: 'stripe-payment-attempt-risk',
      extraEvidence: ['FINALIZED invoice proof', 'PLG and billing-provider proof', 'payment attempt inventory', 'customer communication or remediation plan'],
    },
    products: {
      approvalTier: 'product-write',
      accountableOwnerRole: 'pricing-catalog-owner',
      requiredApproverRoles: ['pricing-catalog-owner', 'billing-ops-owner'],
      riskClass: 'rate-card-product-risk',
      extraEvidence: ['rate-card close proof before archive', 'invoice line behavior review'],
    },
    'rate-cards': {
      approvalTier: 'rate-card-write',
      accountableOwnerRole: 'pricing-catalog-owner',
      requiredApproverRoles: ['pricing-catalog-owner', 'billing-ops-owner'],
      riskClass: 'pricing-schedule-risk',
      extraEvidence: ['starting_at hour-boundary proof', 'rate schedule read-back plan'],
    },
    usage: {
      approvalTier: 'usage-write',
      accountableOwnerRole: 'billing-ops-owner',
      requiredApproverRoles: ['billing-ops-owner', 'data-engineering-reviewer'],
      riskClass: 'usage-invoice-period-risk',
      extraEvidence: ['invoice-period review', 'transaction-id idempotency proof', 'one-event canary plan'],
    },
  };
  return policies[family] || {
    approvalTier: 'generic-write',
    accountableOwnerRole: 'billing-ops-owner',
    requiredApproverRoles: ['billing-ops-owner'],
    riskClass: 'unclassified-write-risk',
    extraEvidence: ['scope classification review'],
  };
}

function approvalPolicyForScope(scope) {
  const accessClass = accessClassForScope(scope);
  const family = familyForScope(scope);
  if (accessClass === 'read') {
    return {
      approvalTier: 'current-turn-live-read',
      accountableOwnerRole: 'requesting-operator',
      requiredApproverRoles: ['current-turn-user-authorization'],
      riskClass: 'live-read-risk',
      approvalRecordFields: READ_APPROVAL_FIELDS,
      evidenceRequirements: [
        'reviewed endpoint id',
        'explicit tenant',
        'tenant-scoped profile',
        'business purpose',
        'target identifiers',
        'confirm-live-read token',
        'secret-free output destination',
      ],
      confirmationRequirement: 'current-turn confirm-live-read token for the exact tenant, endpoint, and target identifiers',
      liveCommandStatus: 'blocked-until-guarded-read-runner',
    };
  }
  if (accessClass === 'write') {
    const familyPolicy = writePolicyByFamily(family);
    return {
      ...familyPolicy,
      approvalRecordFields: WRITE_APPROVAL_FIELDS,
      evidenceRequirements: [
        'reviewed endpoint id',
        'explicit tenant',
        'local request validation',
        'preview payload hash',
        'validated API preflight',
        'validated API apply gate',
        'sandbox proof',
        'audit destination',
        'key fingerprint',
        'canary plan',
        'read-back plan',
        'rollback or remediation plan',
        'idempotency review',
        ...familyPolicy.extraEvidence,
      ],
      confirmationRequirement: 'production writes require approval.productionConfirmation equal to the reviewed preview hash; sandbox writes still require owner approval and sandbox-proof evidence',
      liveCommandStatus: 'blocked-until-apply-runner',
    };
  }
  return {
    approvalTier: 'unclassified',
    accountableOwnerRole: 'billing-ops-owner',
    requiredApproverRoles: ['billing-ops-owner'],
    riskClass: 'unclassified-scope-risk',
    approvalRecordFields: ['approvalId', 'scope', 'classificationDecision'],
    evidenceRequirements: ['scope classification', 'owner approval'],
    confirmationRequirement: 'do not expose live execution for unclassified scopes',
    liveCommandStatus: 'blocked-until-classified',
  };
}

function permissionScopeReference(options = {}) {
  const family = options.family || null;
  const endpoints = family
    ? ENDPOINTS.filter((endpoint) => endpoint.family === family)
    : ENDPOINTS;
  const byScope = endpoints.reduce((groups, endpoint) => {
    if (!groups[endpoint.permissionScope]) groups[endpoint.permissionScope] = [];
    groups[endpoint.permissionScope].push(endpoint);
    return groups;
  }, {});

  const scopes = Object.entries(byScope)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([scope, endpoints]) => {
      const accessClass = accessClassForScope(scope);
      const policy = permissionPolicy(accessClass);
      const operationTypes = [...new Set(endpoints.map((endpoint) => endpoint.operationType))].sort();
      return {
        scope,
        family: familyForScope(scope),
        accessClass,
        endpointCount: endpoints.length,
        endpointIds: endpoints.map((endpoint) => endpoint.id).sort(),
        operationTypes,
        currentCliApiAccess: 'none',
        liveExecution: clone(LOCAL_ONLY_LIVE_EXECUTION),
        approvalModel: policy.approvalModel,
        liveCommandStatus: policy.liveCommandStatus,
        requiredBeforeLive: clone(policy.requiredBeforeLive),
      };
    });

  return {
    schemaVersion: PERMISSION_SCOPE_SCHEMA_VERSION,
    generatedFrom: 'packages/metro-core/src/api-catalog/index.js',
    apiAccess: 'none',
    liveExecution: clone(LOCAL_ONLY_LIVE_EXECUTION),
    filters: { family },
    scopeCount: scopes.length,
    accessClasses: scopes.reduce((counts, scope) => {
      counts[scope.accessClass] = (counts[scope.accessClass] || 0) + 1;
      return counts;
    }, {}),
    scopes,
  };
}

function approvalPolicyReference(options = {}) {
  const scopeReference = permissionScopeReference({ family: options.family || null });
  const policies = scopeReference.scopes.map((scope) => {
    const policy = approvalPolicyForScope(scope.scope);
    return {
      scope: scope.scope,
      family: scope.family,
      accessClass: scope.accessClass,
      endpointCount: scope.endpointCount,
      endpointIds: clone(scope.endpointIds),
      operationTypes: clone(scope.operationTypes),
      currentCliApiAccess: 'none',
      liveExecution: clone(LOCAL_ONLY_LIVE_EXECUTION),
      approvalTier: policy.approvalTier,
      accountableOwnerRole: policy.accountableOwnerRole,
      requiredApproverRoles: clone(policy.requiredApproverRoles),
      riskClass: policy.riskClass,
      approvalRecordFields: clone(policy.approvalRecordFields),
      evidenceRequirements: clone(policy.evidenceRequirements),
      confirmationRequirement: policy.confirmationRequirement,
      liveCommandStatus: policy.liveCommandStatus,
      sources: clone(APPROVAL_POLICY_SOURCES),
    };
  });

  return {
    schemaVersion: APPROVAL_POLICY_SCHEMA_VERSION,
    generatedFrom: 'packages/metro-core/src/api-catalog/index.js',
    apiAccess: 'none',
    liveExecution: clone(LOCAL_ONLY_LIVE_EXECUTION),
    filters: { family: options.family || null },
    policyCount: policies.length,
    accessClasses: policies.reduce((counts, policy) => {
      counts[policy.accessClass] = (counts[policy.accessClass] || 0) + 1;
      return counts;
    }, {}),
    policyStatus: 'local-reference-only',
    nextSafeStep: 'Use this map to design approval records. It is not IAM, does not authorize live reads or writes, and does not enable expert API execution.',
    policies,
  };
}

function listApiEndpoints(options = {}) {
  const family = options.family || null;
  const endpoints = family
    ? ENDPOINTS.filter((endpoint) => endpoint.family === family)
    : ENDPOINTS;
  return endpoints.map(endpointWithDerivedFields);
}

function getApiEndpoint(id) {
  const endpoint = ENDPOINTS.find((item) => item.id === id);
  return endpoint ? endpointWithDerivedFields(endpoint) : null;
}

function apiCatalog(options = {}) {
  const family = options.family || null;
  const endpoints = listApiEndpoints({ family });
  return {
    schemaVersion: CATALOG_SCHEMA_VERSION,
    generatedFrom: 'packages/metro-core/src/api-catalog/index.js',
    apiAccess: 'none',
    liveExecution: clone(LOCAL_ONLY_LIVE_EXECUTION),
    filters: { family },
    families: apiFamilies(),
    endpointCount: endpoints.length,
    endpoints,
  };
}

function apiEndpointDetail(id) {
  const endpoint = getApiEndpoint(id);
  if (!endpoint) return null;
  return {
    schemaVersion: ENDPOINT_SCHEMA_VERSION,
    generatedFrom: 'packages/metro-core/src/api-catalog/index.js',
    apiAccess: 'none',
    liveExecution: clone(LOCAL_ONLY_LIVE_EXECUTION),
    endpoint,
  };
}

function searchableText(value) {
  if (value === undefined || value === null) return '';
  if (Array.isArray(value)) return value.map(searchableText).join(' ');
  if (typeof value === 'object') {
    return Object.entries(value)
      .map(([key, child]) => `${key} ${searchableText(child)}`)
      .join(' ');
  }
  return String(value);
}

function normalizeSearchTerms(query) {
  return String(query || '')
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

function searchFieldsForEndpoint(endpoint) {
  return [
    ['id', endpoint.id, 10],
    ['title', endpoint.title, 8],
    ['family', endpoint.family, 6],
    ['method', endpoint.method, 5],
    ['path', endpoint.path, 8],
    ['operationType', endpoint.operationType, 5],
    ['supportStatus', endpoint.supportStatus, 5],
    ['permissionScope', endpoint.permissionScope, 5],
    ['requestContract', endpoint.requestContract, 4],
    ['responseContract', endpoint.responseContract, 4],
    ['policyGates', endpoint.policyGates, 3],
    ['currentCommands', endpoint.currentCommands, 3],
    ['futureCommands', endpoint.futureCommands, 3],
    ['sourceIds', endpoint.sourceIds, 4],
    ['sources', endpoint.sources, 2],
    ['sideEffectProfile', endpoint.sideEffectProfile, 3],
  ];
}

function searchEndpoint(endpoint, terms) {
  const matchedTerms = new Set();
  const matchedFields = [];
  let score = 0;

  for (const [name, value, weight] of searchFieldsForEndpoint(endpoint)) {
    const text = searchableText(value).toLowerCase();
    const fieldTerms = terms.filter((term) => text.includes(term));
    if (fieldTerms.length === 0) continue;
    matchedFields.push(name);
    for (const term of fieldTerms) matchedTerms.add(term);
    score += fieldTerms.length * weight;
  }

  if (!terms.every((term) => matchedTerms.has(term))) return null;

  return {
    endpointId: endpoint.id,
    title: endpoint.title,
    family: endpoint.family,
    method: endpoint.method,
    path: endpoint.path,
    operationType: endpoint.operationType,
    supportStatus: endpoint.supportStatus,
    permissionScope: endpoint.permissionScope,
    apiAccessInCurrentCli: endpoint.apiAccessInCurrentCli,
    liveExecution: clone(endpoint.liveExecution),
    score,
    matchedTerms: [...matchedTerms].sort(),
    matchedFields,
    requestSummary: endpoint.requestContract?.summary || null,
    responseSummary: endpoint.responseContract?.summary || null,
    sideEffectRiskClass: endpoint.sideEffectProfile?.riskClass || null,
    currentCommands: clone(endpoint.currentCommands || []),
    futureCommands: clone(endpoint.futureCommands || []),
    sourceIds: clone(endpoint.sourceIds || []),
    sources: clone(endpoint.sources || []),
  };
}

function apiEndpointSearch(options = {}) {
  const query = String(options.query || '').trim();
  const family = options.family || null;
  const terms = normalizeSearchTerms(query);
  const families = apiFamilies();
  const familyKnown = !family || families.includes(family);
  const endpoints = familyKnown ? listApiEndpoints({ family }) : [];
  const results = terms.length === 0
    ? []
    : endpoints
      .map((endpoint) => searchEndpoint(endpoint, terms))
      .filter(Boolean)
      .sort((left, right) => right.score - left.score || left.endpointId.localeCompare(right.endpointId));

  return {
    schemaVersion: API_SEARCH_SCHEMA_VERSION,
    generatedFrom: 'packages/metro-core/src/api-catalog/index.js',
    apiAccess: 'none',
    liveExecution: clone(LOCAL_ONLY_LIVE_EXECUTION),
    filters: {
      query,
      family,
      familyKnown,
    },
    terms,
    searchedEndpointCount: endpoints.length,
    resultCount: results.length,
    results,
    nextSafeStep: 'Use metro api explain <endpoint-id> for the full reviewed endpoint contract. Search is local documentation only and does not authorize live API access.',
  };
}

function uniqueSorted(values) {
  return [...new Set((values || []).filter((value) => value !== undefined && value !== null).map(String))].sort();
}

function setComparison(leftValues, rightValues) {
  const left = uniqueSorted(leftValues);
  const right = uniqueSorted(rightValues);
  const rightSet = new Set(right);
  const leftSet = new Set(left);
  return {
    shared: left.filter((value) => rightSet.has(value)),
    onlyLeft: left.filter((value) => !rightSet.has(value)),
    onlyRight: right.filter((value) => !leftSet.has(value)),
  };
}

function valuesEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function endpointDiffSummary(endpoint) {
  return {
    id: endpoint.id,
    title: endpoint.title,
    family: endpoint.family,
    method: endpoint.method,
    path: endpoint.path,
    operationType: endpoint.operationType,
    supportStatus: endpoint.supportStatus,
    permissionScope: endpoint.permissionScope,
    apiAccessInCurrentCli: endpoint.apiAccessInCurrentCli,
    sideEffectRiskClass: endpoint.sideEffectProfile?.riskClass || null,
    sourceIds: clone(endpoint.sourceIds || []),
    currentCommands: clone(endpoint.currentCommands || []),
    futureCommands: clone(endpoint.futureCommands || []),
  };
}

const API_DIFF_FIELDS = [
  ['family', (endpoint) => endpoint.family],
  ['method', (endpoint) => endpoint.method],
  ['path', (endpoint) => endpoint.path],
  ['operationType', (endpoint) => endpoint.operationType],
  ['supportStatus', (endpoint) => endpoint.supportStatus],
  ['permissionScope', (endpoint) => endpoint.permissionScope],
  ['apiAccessInCurrentCli', (endpoint) => endpoint.apiAccessInCurrentCli],
  ['requestContract.summary', (endpoint) => endpoint.requestContract?.summary || null],
  ['requestContract.requiredFields', (endpoint) => endpoint.requestContract?.requiredFields || []],
  ['requestContract.forbiddenFields', (endpoint) => endpoint.requestContract?.forbiddenFields || []],
  ['responseContract.summary', (endpoint) => endpoint.responseContract?.summary || null],
  ['responseContract.stableOutputRequired', (endpoint) => Boolean(endpoint.responseContract?.stableOutputRequired)],
  ['sideEffectProfile.riskClass', (endpoint) => endpoint.sideEffectProfile?.riskClass || null],
];

function apiEndpointDiff(leftId, rightId) {
  const left = getApiEndpoint(leftId);
  const right = getApiEndpoint(rightId);
  if (!left || !right) return null;

  const differences = API_DIFF_FIELDS.map(([field, pick]) => {
    const leftValue = clone(pick(left));
    const rightValue = clone(pick(right));
    return {
      field,
      same: valuesEqual(leftValue, rightValue),
      left: leftValue,
      right: rightValue,
    };
  });

  const policyGates = setComparison(left.policyGates, right.policyGates);
  const sourceIds = setComparison(left.sourceIds, right.sourceIds);
  const currentCommands = setComparison(left.currentCommands, right.currentCommands);
  const futureCommands = setComparison(left.futureCommands, right.futureCommands);

  return {
    schemaVersion: API_DIFF_SCHEMA_VERSION,
    generatedFrom: 'packages/metro-core/src/api-catalog/index.js',
    apiAccess: 'none',
    liveExecution: clone(LOCAL_ONLY_LIVE_EXECUTION),
    endpoints: {
      left: endpointDiffSummary(left),
      right: endpointDiffSummary(right),
    },
    summary: {
      sameFamily: left.family === right.family,
      sameMethod: left.method === right.method,
      sameOperationType: left.operationType === right.operationType,
      samePermissionScope: left.permissionScope === right.permissionScope,
      sameSupportStatus: left.supportStatus === right.supportStatus,
      sameCurrentCliApiAccess: left.apiAccessInCurrentCli === right.apiAccessInCurrentCli,
      differenceCount: differences.filter((difference) => !difference.same).length,
      sharedPolicyGateCount: policyGates.shared.length,
      sharedSourceIdCount: sourceIds.shared.length,
      sharedCurrentCommandCount: currentCommands.shared.length,
      sharedFutureCommandCount: futureCommands.shared.length,
    },
    differences,
    shared: {
      policyGates: policyGates.shared,
      sourceIds: sourceIds.shared,
      currentCommands: currentCommands.shared,
      futureCommands: futureCommands.shared,
    },
    onlyLeft: {
      policyGates: policyGates.onlyLeft,
      sourceIds: sourceIds.onlyLeft,
      currentCommands: currentCommands.onlyLeft,
      futureCommands: futureCommands.onlyLeft,
    },
    onlyRight: {
      policyGates: policyGates.onlyRight,
      sourceIds: sourceIds.onlyRight,
      currentCommands: currentCommands.onlyRight,
      futureCommands: futureCommands.onlyRight,
    },
    nextSafeStep: 'Use metro api explain <endpoint-id> for each endpoint before designing validators, previews, live reads, or live writes. Diff is local documentation only and does not authorize API access.',
  };
}

module.exports = {
  API_DIFF_SCHEMA_VERSION,
  API_SEARCH_SCHEMA_VERSION,
  APPROVAL_POLICY_SCHEMA_VERSION,
  CATALOG_SCHEMA_VERSION,
  ENDPOINT_SCHEMA_VERSION,
  PERMISSION_SCOPE_SCHEMA_VERSION,
  SIDE_EFFECT_PROFILE_SCHEMA_VERSION,
  approvalPolicyReference,
  apiCatalog,
  apiEndpointDiff,
  apiEndpointDetail,
  apiEndpointSearch,
  apiFamilies,
  getApiEndpoint,
  listApiEndpoints,
  permissionScopeReference,
};
