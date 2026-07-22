'use strict';

const WORKSPACE_SCHEMA_VERSION = 'metro.workspace.v1';

const GENERIC_WORKSPACE = Object.freeze({
  schemaVersion: WORKSPACE_SCHEMA_VERSION,
  organization: 'generic',
  catalogPattern: {
    id: 'user-bound-catalog',
    summary: 'Bind rate card and product IDs in profiles.json workspaceCatalog - no fixed tenant UUIDs.',
    usageProductName: 'Usage Product',
    pricingGroupKey: ['dimension_key'],
    presentationGroupKey: null,
    payloadModeCanonical: 'code-only',
    billableMetricRole: 'COUNT with user-defined group_keys on a shared billable metric',
    newDimensionPath: 'rateCards.addRates on an existing usage product',
    forbiddenForNewDimension: ['billableMetrics.create', 'products.create', 'rateCards.update'],
  },
  tierRateCards: Object.freeze([]),
  apiTokenConventions: Object.freeze({
    sandbox: Object.freeze({ typicalTokens: [], note: 'Use your sandbox API token naming convention.' }),
    production: Object.freeze({ typicalTokens: [], note: 'Use your production API token naming convention.' }),
  }),
  auditActionHints: Object.freeze({
    update: 'add-pricing-dimension-value',
    create_contract: 'onboard-customer-or-package-plan-move',
    update_contract_end_date: 'package-plan-move',
    edit_contract: 'complimentary-credits',
    insert_customer_billing_provider_configurations: 'billing-provider-setup',
    archive: 'billing-provider-setup',
    create_package: 'package-version-handoff',
    archive_package: 'package-version-handoff',
  }),
});

const INTENTS = Object.freeze([
  {
    id: 'credits-product-decision',
    title: 'Decide how to add credits or a usage product',
    summary: 'Classify vague "credits product" asks before writes: dimensional value vs grant vs package commits vs rare greenfield BM+product. Full fork: metro docs explain credits.product.decision --markdown.',
    recommendedShape: null,
    catalogMode: 'decision-only',
    workflow: 'catalog.decision',
    keywords: [
      'credits product',
      'credit product',
      'usage product',
      'new product',
      'billable metric',
      'aggregation',
      'SUM',
      'COUNT',
      'create product',
      'new metric',
    ],
    auditActions: [],
    rejectedPaths: [
      { endpointId: 'products.create', reason: 'Refuse until credits.product.decision fork selects greenfield; most asks are addRates or grants.' },
      { endpointId: 'billableMetrics.create', reason: 'Reuse shared metric for dimensional codes; greenfield only after aggregation interview.' },
    ],
    commands: [
      'metro docs explain credits.product.decision --markdown',
      'metro docs explain credits.product.decision --json',
      'metro plan greenfield-credits-product --sandbox --json',
      'metro plan add-pricing-dimension-value --dimension-key <KEY> --price <amount> --sandbox --json',
      'metro plan complimentary-credits --sandbox --json',
    ],
    verificationReads: [],
  },
  {
    id: 'greenfield-credits-product',
    title: 'Greenfield billable metric + USAGE product (preview only)',
    summary: 'Emit local API request templates for billableMetrics.create then products.create when the tenant lacks a shared usage spine. Validate/preview only until sandbox create allowlist + typed confirm.',
    recommendedShape: null,
    catalogMode: 'greenfield-preview',
    workflow: 'catalog.greenfield',
    keywords: [
      'greenfield',
      'create billable metric',
      'create usage product',
      'new credits product',
      'empty catalog',
      'missing usage product',
    ],
    auditActions: [],
    rejectedPaths: [
      { endpointId: 'rateCards.addRates', reason: 'No shared USAGE product yet; create BM+product first, then dimensional addRates.' },
    ],
    commands: [
      'metro plan greenfield-credits-product --name="Usage Credits" --aggregation=COUNT --sandbox --json',
      'metro api validate billableMetrics.create --file <bm-create.json> --json',
      'metro api preview billableMetrics.create --file <bm-create.json> --sandbox --json',
      'metro api validate products.create --file <usage-product-create.json> --json',
      'metro api preview products.create --file <usage-product-create.json> --sandbox --json',
    ],
    verificationReads: ['billableMetrics.list', 'products.list'],
  },
  {
    id: 'add-pricing-dimension-value',
    title: 'Add a pricing dimension value via addRates',
    summary: 'Validate dimensional-rate-card shape locally, preview addRates on an existing usage product, sandbox-canary one card before broader rollout.',
    recommendedShape: 'dimensional-rate-card',
    catalogMode: 'add-rates-only',
    workflow: 'rate-card.dimensional',
    keywords: ['dimension', 'pricing group', 'action code', 'feature flag', 'addrates', 'new rate', 'charge code'],
    auditActions: ['update'],
    rejectedPaths: [
      { endpointId: 'billableMetrics.create', reason: 'Reuse your shared billable metric; new dimensions are addRates rows.' },
      { endpointId: 'products.create', reason: 'Reuse existing usage product; new values are pricing_group_values rows.' },
      { endpointId: 'rateCards.update', reason: 'Append scheduled rates via addRates instead of replacing the card.' },
    ],
    commands: [
      'metro plan add-pricing-dimension-value --dimension-key <KEY> --price <amount> --sandbox --json',
      'metro validate --shape dimensional-rate-card --file <input.json> --json',
      'metro rate-card dimensional preview --file <input.json> --sandbox --json',
    ],
    verificationReads: ['rateCards.getRates', 'rateCards.getRateSchedule', 'products.get'],
  },
  {
    id: 'rollout-dimension-across-cards',
    title: 'Roll a dimension value across multiple rate cards',
    summary: 'User supplies rateCardIds[] order; validate and preview each tier with read-back between steps.',
    recommendedShape: 'dimensional-rate-card',
    catalogMode: 'add-rates-only',
    workflow: 'rate-card.dimensional',
    keywords: ['rollout', 'multi card', 'tier rollout', 'rate cards', 'dimension rollout'],
    auditActions: ['update'],
    rejectedPaths: [
      { endpointId: 'rateCards.update', reason: 'Use addRates per card instead of card replacement.' },
    ],
    commands: [
      'metro plan rollout-dimension-across-cards --dimension-key <KEY> --sandbox --json',
    ],
    verificationReads: ['rateCards.getRates', 'products.get'],
  },
  {
    id: 'annual-subscription-package',
    title: 'Annual subscription package with separable plan fee and credits',
    summary: 'Package v2 with annual plan fee plus monthly credit drip or lump-sum recurring_commits.',
    recommendedShape: 'pro-annual-self-serve-v2',
    secondaryShapes: ['pro-annual'],
    workflow: 'package.create',
    keywords: ['annual', 'subscription', 'monthly drip', 'recurring commits', 'self serve package'],
    auditActions: ['create_package'],
    rejectedPaths: [
      { endpointId: 'contracts.create', reason: 'Publish package catalog first; contracts come from onboarding.' },
    ],
    commands: [
      'metro plan annual-subscription-package --sandbox --json',
      'metro validate --shape pro-annual-self-serve-v2 --file <pkg.json> --json',
    ],
    verificationReads: ['packages.get', 'packages.list'],
  },
  {
    id: 'fixed-annual-package',
    title: 'Fixed annual package (legacy terms shape)',
    summary: 'pro-annual shape when plan fee and credits are bundled in legacy terms.',
    recommendedShape: 'pro-annual',
    workflow: 'package.create',
    keywords: ['fixed annual', 'legacy annual', 'pro annual terms'],
    auditActions: ['create_package'],
    rejectedPaths: [],
    commands: ['metro plan fixed-annual-package --sandbox --json'],
    verificationReads: ['packages.get'],
  },
  {
    id: 'free-trial-package',
    title: 'Free trial package with time-bounded access',
    summary: 'Package with trial credits and explicit end behavior.',
    recommendedShape: 'free-trial',
    workflow: 'package.create',
    keywords: ['free trial', 'trial package', 'trial credits'],
    auditActions: ['create_package'],
    rejectedPaths: [],
    commands: ['metro plan free-trial-package --sandbox --json'],
    verificationReads: ['packages.get'],
  },
  {
    id: 'package-plan-move',
    title: 'Move customer to another package',
    summary: 'Validate and preview updateEndDate + contracts.create onto a target package alias. Public v1 stops at preview; do not advertise pack-specific apply shortcuts.',
    recommendedShape: 'package-plan-move-no-immediate-invoice',
    workflow: 'contract.move-plan',
    keywords: ['plan move', 'change package', 'cutover', 'transition'],
    auditActions: ['update_contract_end_date', 'create_contract'],
    rejectedPaths: [
      { endpointId: 'packages.create', reason: 'Plan moves target an existing package alias.' },
    ],
    commands: [
      'metro plan package-plan-move --sandbox --json',
      'metro validate --shape package-plan-move-no-immediate-invoice --file <move.json> --json',
      'metro contract move-plan preview --file <move.json> --sandbox --json',
    ],
    verificationReads: ['contracts.get.v2', 'packages.get'],
  },
  {
    id: 'package-version-handoff',
    title: 'Publish new package version (alias handoff)',
    summary: 'Create replacement package, verify alias live, then archive old version.',
    recommendedShape: 'package-alias-archive-handoff',
    workflow: 'package.archive',
    keywords: ['package version', 'alias handoff', 'archive package'],
    auditActions: ['create_package', 'archive_package'],
    rejectedPaths: [
      { endpointId: 'packages.archive', reason: 'Do not archive before replacement alias is live.' },
    ],
    commands: ['metro package archive preview --file <handoff.json> --sandbox --json'],
    verificationReads: ['packages.get', 'packages.list'],
  },
  {
    id: 'onboard-customer',
    title: 'Onboard customer from package alias',
    summary: 'Customer setup, billing provider config, contracts.create with package_alias and uniqueness_key.',
    recommendedShape: 'customer-setup',
    workflow: 'customer.setup',
    keywords: ['onboard', 'new customer', 'create contract', 'package alias'],
    auditActions: ['create_contract'],
    rejectedPaths: [],
    commands: ['metro customer setup preview --file <customer.json> --sandbox --json'],
    verificationReads: ['customers.get', 'contracts.get.v2'],
  },
  {
    id: 'complimentary-credits',
    title: 'Grant complimentary credits on existing contract',
    summary: 'contracts.edit add_commits on live contract.',
    recommendedShape: 'complimentary-credit-grant',
    workflow: 'credit.grant',
    keywords: ['complimentary', 'bonus credits', 'grant credits'],
    auditActions: ['edit_contract'],
    rejectedPaths: [
      { endpointId: 'contracts.create', reason: 'Grants belong on existing contract via edit.' },
    ],
    commands: ['metro credit preview --shape complimentary-credit-grant --file <grant.json> --sandbox --json'],
    verificationReads: ['commits.list', 'contracts.get.v2'],
  },
  {
    id: 'paid-credit-top-up',
    title: 'Paid credit top-up on existing contract',
    summary: 'One-time or prepaid credit purchase via paid-credit-top-up shape.',
    recommendedShape: 'paid-credit-top-up',
    workflow: 'credit.top-up',
    keywords: ['top up', 'paid credits', 'prepaid', 'credit purchase'],
    auditActions: ['edit_contract'],
    rejectedPaths: [],
    commands: ['metro credit preview --shape paid-credit-top-up --file <topup.json> --sandbox --json'],
    verificationReads: ['commits.list', 'invoices.listForCustomer'],
  },
  {
    id: 'billing-provider-setup',
    title: 'Attach or repair billing provider per customer',
    summary: 'Stripe or other provider configuration with read-back.',
    recommendedShape: 'stripe-billing-provider-attachment',
    workflow: 'billing-provider.attach',
    keywords: ['billing provider', 'stripe', 'payment method'],
    auditActions: ['insert_customer_billing_provider_configurations'],
    rejectedPaths: [],
    commands: ['metro billing-provider preview --shape stripe-billing-provider-attachment --file <bp.json> --sandbox --json'],
    verificationReads: ['billingProvider.get', 'customers.get'],
  },
  {
    id: 'subscription-contract',
    title: 'Direct subscription contract (non-package)',
    summary: 'direct-subscription-contract shape for custom subscription terms.',
    recommendedShape: 'direct-subscription-contract',
    workflow: 'contract.create',
    keywords: ['subscription', 'direct contract', 'custom subscription'],
    auditActions: ['create_contract'],
    rejectedPaths: [],
    commands: ['metro contract preview --shape direct-subscription-contract --file <contract.json> --sandbox --json'],
    verificationReads: ['contracts.get.v2', 'contracts.list.v2'],
  },
]);

function getWorkspaceModel() {
  return {
    ...GENERIC_WORKSPACE,
    intentCount: INTENTS.length,
    intents: INTENTS.map((intent) => intent.id),
  };
}

function getIntent(intentId) {
  return INTENTS.find((intent) => intent.id === intentId) || null;
}

function listIntents() {
  return INTENTS.map((intent) => ({
    id: intent.id,
    title: intent.title,
    summary: intent.summary,
    recommendedShape: intent.recommendedShape,
    workflow: intent.workflow,
  }));
}

function intentForAuditAction(action) {
  const normalized = String(action || '').trim().toLowerCase();
  const hint = GENERIC_WORKSPACE.auditActionHints[normalized];
  if (!hint) return null;
  if (hint === 'onboard-customer-or-package-plan-move') {
    return getIntent('onboard-customer');
  }
  return getIntent(hint);
}

function tierRateCardsForTenant(tenant, options = {}) {
  const ids = options.rateCardIds || options.workspaceCatalog?.rateCardIds || [];
  return ids.map((rateCardId, index) => ({
    tier: `card-${index + 1}`,
    alias: rateCardId,
    effectiveRateCardId: rateCardId,
    recommendedForCanary: index === 0,
  }));
}

module.exports = {
  WORKSPACE_SCHEMA_VERSION,
  GENERIC_WORKSPACE,
  INTENTS,
  getWorkspaceModel,
  getIntent,
  listIntents,
  intentForAuditAction,
  tierRateCardsForTenant,
};
