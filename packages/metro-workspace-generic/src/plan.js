'use strict';

const {
  getIntent,
  getWorkspaceModel,
  listIntents,
  intentForAuditAction,
  tierRateCardsForTenant,
  WORKSPACE_SCHEMA_VERSION,
} = require('./model');
const { resolveWorkspaceCatalog } = require('./catalog-bindings');
const PLAN_SCHEMA_VERSION = 'metro.workspace.plan.v1';
const INPUT_TEMPLATE_SCHEMA_VERSION = 'metro.workspace.input-template.v1';
const ROUTE_SCHEMA_VERSION = 'metro.workspace.route.v1';

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function scoreIntent(intent, query, context = {}) {
  const text = normalizeText(query);
  if (!text) return 0;
  let score = 0;
  if (normalizeText(intent.id).includes(text) || text.includes(normalizeText(intent.id))) {
    score += 100;
  }
  if (intent.id === 'credits-product-decision') {
    if (/\bcredits?\s+product\b/.test(text) || /\bbillable\s+metric\b/.test(text) || /\b(usage product|new product|aggregation)\b/.test(text)) {
      score += 30;
    }
  }
  if (intent.id === 'greenfield-credits-product') {
    if (/\bgreenfield\b/.test(text) || /\bcreate\s+(billable\s+metric|usage\s+product)\b/.test(text)) {
      score += 35;
    }
  }
  if (context.accountPattern === 'dimensional-shared-usage' && intent.id === 'add-pricing-dimension-value') {
    if (/\b(dimension|action.?code|addrates|pricing)\b/.test(text)) score += 8;
  }
  if (context.accountPattern === 'greenfield-needed' && intent.id === 'greenfield-credits-product') {
    score += 20;
  }
  if (context.accountPattern === 'greenfield-needed' && intent.id === 'credits-product-decision') {
    score += 8;
  }
  if (context.accountPattern === 'package-template' && intent.id === 'annual-subscription-package') {
    score += 10;
  }
  if (context.accountPattern === 'commit-grant-heavy' && intent.id === 'complimentary-credits') {
    score += 10;
  }
  if (intent.id === 'add-pricing-dimension-value') {
    if (/\bnew\b/.test(text) && /(dimension|pricing|charge|feature)\b/.test(text)) score += 25;
  }
  if (intent.id === 'rollout-dimension-across-cards') {
    if (/\b(rollout|multi card|across cards|tiers)\b/.test(text)) score += 25;
  }
  for (const keyword of intent.keywords || []) {
    const normalized = normalizeText(keyword);
    if (text.includes(normalized)) score += normalized.length > 6 ? 12 : 8;
  }
  for (const action of intent.auditActions || []) {
    if (text.includes(normalizeText(action))) score += 15;
  }
  return score;
}

function matchGoalToIntent(query, options = {}) {
  const text = normalizeText(query);
  if (!text) return null;

  let best = null;
  let bestScore = 0;
  for (const intent of listIntents().map((entry) => getIntent(entry.id))) {
    const score = scoreIntent(intent, text, options);
    if (score > bestScore) {
      bestScore = score;
      best = intent;
    }
  }

  if (!best || bestScore < 8) return null;

  return {
    intentId: best.id,
    confidence: bestScore >= 40 ? 'high' : bestScore >= 20 ? 'medium' : 'low',
    score: bestScore,
    matchedBy: 'keyword',
  };
}

function buildAddActionRateInputTemplate(options = {}) {
  const actionCode = options.actionCode || '<ACTION_CODE>';
  const displayName = options.displayName || '<Display Name>';
  const price = options.price != null ? Number(options.price) : 20;
  const catalog = options.catalogResolution || null;
  const tier = options.tier || null;
  const tenant = options.tenant || null;
  const payloadMode = options.payloadMode || catalog?.catalog?.payloadMode || (tenant === 'production' ? 'code-only' : 'code-only');

  const rateCardId = tier?.effectiveRateCardId
    || catalog?.tiers?.find((entry) => entry.recommendedForCanary || entry.canary)?.effectiveRateCardId
    || catalog?.tiers?.[0]?.effectiveRateCardId
    || '<tier-rate-card-id>';
  const productId = catalog?.catalog?.sharedDimensionalProductId
    || tier?.effectiveProductId
    || '<existing-dimensional-product-id>';
  const bmId = catalog?.catalog?.dimensionalBillableMetricId || '<existing-dimensional-bm-id>';
  const creditTypeId = catalog?.catalog?.creditTypeId || '<credit-type-id>';
  const codeOnly = payloadMode === 'code-only';

  return {
    payloadMode,
    catalogMode: 'add-rates-only',
    rateCardId,
    startingAt: '<UTC-hour-boundary>',
    usageProduct: {
      name: 'Usage Product',
      type: 'USAGE',
      productId,
      billableMetricId: bmId,
      pricingGroupKey: ['action_code'],
      ...(codeOnly ? {} : { presentationGroupKey: ['action_display_name'] }),
      tags: ['Origination', 'Deal Prep', 'Finance'],
      existingProductCollisionReviewed: true,
    },
    billableMetric: {
      id: bmId,
      aggregationType: 'COUNT',
      eventTypeFilterReviewed: true,
      groupKeys: codeOnly ? [['action_code']] : [['action_code', 'action_display_name']],
      requiredEventProperties: codeOnly
        ? ['action_code']
        : ['action_code', 'action_display_name', 'credit_amount'],
      nonRetroactiveMetricReviewed: true,
    },
    metricGroupKeyVerified: true,
    invoiceImpactReviewed: true,
    rates: [
      {
        actionCode,
        actionDisplayName: displayName,
        price,
        creditTypeId,
        entitled: true,
        rateType: 'FLAT',
      },
    ],
    canaryPlan: {
      firstActionCode: actionCode,
      readBackBeforeRemaining: true,
      stopCriteria: 'Stop if product read-back, rate schedule, getRates selector, usage groups, or invoice preview differs from preview.',
    },
    verificationPlan: {
      productReadback: true,
      rateScheduleReadback: true,
      getRatesSelectorReadback: true,
      usageGroupsReadback: true,
      invoicePreviewOrReadback: true,
    },
    rollbackPlan: 'Close mistaken dimensional rates with entitled:false at the next safe hour; do not create duplicate products.',
  };
}

function buildInputTemplate(intent, options = {}) {
  if (intent.id === 'add-pricing-dimension-value') {
    return buildAddActionRateInputTemplate(options);
  }
  if (intent.id === 'rollout-dimension-across-cards') {
    return null;
  }
  if (intent.id === 'annual-subscription-package') {
    const catalog = options.catalogResolution || null;
    const creditGrantMode = options.creditGrantMode || 'monthly-drip';
    const annualCreditsTotal = options.annualCreditsTotal != null ? Number(options.annualCreditsTotal) : 24000;
    const monthlyDrip = Math.floor(annualCreditsTotal / 12);
    return {
      packageAlias: options.packageAlias || 'pro_annual',
      uniquenessKey: options.uniquenessKey || 'pkg:pro-annual-v2:<UTC-date>',
      rateCardId: catalog?.tiers?.find((entry) => entry.tier === 'pro')?.effectiveRateCardId || '<pro-dimensional-rate-card-id>',
      startingAt: '<UTC-hour-boundary>',
      annualPlanFeeCents: options.annualPlanFeeCents != null ? Number(options.annualPlanFeeCents) : 120000,
      billingFrequency: 'ANNUAL',
      creditGrantMode,
      annualCreditsTotal,
      monthlyCreditDripAmount: monthlyDrip,
      fixedProductId: catalog?.catalog?.fixedProductId || '<fixed-product-id>',
      accessCreditTypeId: catalog?.catalog?.creditTypeId || '<credit-type-id>',
      commitName: options.commitName || 'Annual Credits',
      billingProvider: {
        configured: true,
        deliveryMethod: 'direct_to_billing_provider',
      },
      stripeBehavior: 'leave_draft',
      creditSeparateFromPlanFeeReviewed: true,
      packageAliasCollisionReviewed: true,
    };
  }
  if (intent.id === 'package-plan-move') {
    return {
      customerId: options.customerId || '<customer-id>',
      currentContractId: options.currentContractId || '<active-contract-id>',
      targetPackageAlias: options.targetPackageAlias || 'pro_annual',
      contractUniquenessKey: options.contractUniquenessKey || 'plan-change:<customer-id>:<contract-id>:<package-alias>:<UTC-date>',
      cutoverAt: options.cutoverAt || '<UTC-hour-boundary>',
      transitionType: 'RENEWAL',
      oldContractEndBehavior: 'update_end_date',
      invoiceBehavior: 'no_immediate_invoice',
      stripeBehavior: 'preserve_existing_billing_provider',
      billingProvider: { verified: true },
      packageAliasVerified: true,
      currentInvoicesChecked: true,
      cutoverReviewRequired: options.tenant === 'production',
      rollbackPlan: 'Restore predecessor end date and pause successor before cutover if preview evidence is wrong.',
    };
  }
  if (intent.id === 'package-version-handoff') {
    return {
      packageAlias: options.packageAlias || 'pro_annual',
      uniquenessKey: options.uniquenessKey || 'pkg:lev-pro-annual-v2:<UTC-date>',
      rateCardId: options.catalogResolution?.tiers?.find((entry) => entry.tier === 'pro')?.effectiveRateCardId || '<pro-dimensional-rate-card-id>',
      startingAt: '<UTC-hour-boundary>',
      annualPriceCents: options.annualPriceCents != null ? Number(options.annualPriceCents) : 120000,
      billingFrequency: 'ANNUAL',
      billingProvider: { configured: true, deliveryMethod: 'direct_to_billing_provider' },
      stripeBehavior: 'leave_draft',
      oldPackageId: options.oldPackageId || '<old-package-id>',
      replacementPackageId: options.replacementPackageId || '<new-package-id>',
      replacementAliasLiveAt: options.replacementAliasLiveAt || '<UTC-hour-boundary-in-past>',
      aliasLiveVerified: false,
      replacementPackageReadbackVerified: false,
      contractsOnOldPackageReviewed: false,
      rollbackPlan: 'Do not archive old package until replacement alias is live and read-back verified.',
    };
  }
  if (intent.id === 'complimentary-credits') {
    return {
      customerId: options.customerId || '<customer-id>',
      contractId: options.contractId || '<active-contract-id>',
      name: options.commitName || 'Complimentary credits',
      amount: options.amount != null ? Number(options.amount) : 500,
      accessCreditTypeId: options.catalogResolution?.catalog?.creditTypeId || '<credit-type-id>',
      startingAt: options.startingAt || '<UTC-hour-boundary>',
      endingBefore: options.endingBefore || '<UTC-hour-boundary-plus-duration>',
      customFieldObjectType: 'commit',
      customFieldKeysApproved: true,
      approvedCustomFieldKeys: ['grant_reason', 'granted_by'],
      customFields: {
        grant_reason: options.grantReason || '<business-reason>',
        granted_by: options.grantedBy || '<owner>',
      },
      duplicateCommitNameReviewed: true,
      invoiceSideEffectReviewed: true,
      rollbackPlan: 'Review commits.list read-back before apply; ledger adjustments may require manual remediation.',
    };
  }
  if (intent.id === 'billing-provider-setup') {
    return {
      customerId: options.customerId || '<customer-id>',
      stripeCustomerId: options.stripeCustomerId || 'cus_<stripe-customer-id>',
      stripeCollectionMethod: 'send_invoice',
      deliveryMethodId: options.deliveryMethodId || '<delivery-method-id>',
      deliveryMethodScope: 'multi_entity',
      multiEntityDelivery: {
        deliveryMethodId: options.deliveryMethodId || '<delivery-method-id>',
        targetStripeAccountId: options.stripeAccountId || 'acct_<stripe-account-id>',
        accountBillingProviderReviewed: true,
        endpointFieldsReviewed: true,
      },
      leaveStripeInvoicesInDraft: true,
      existingConfigPolicy: 'fail_if_exists',
      archiveIncorrectConfigReviewed: true,
      readBackBeforeApply: true,
      rollbackPlan: 'Stop after one customer; read billingProvider.get before and after any archive+insert sequence.',
    };
  }
  if (intent.id === 'onboard-customer') {
    return {
      customerSetup: {
        companyName: options.companyName || '<Company Name LLC>',
        externalCustomerId: options.externalCustomerId || '<external-customer-id>',
        primaryIngestAlias: options.externalCustomerId || '<external-customer-id>',
        ingestAliases: [options.externalCustomerId || '<external-customer-id>'],
        duplicatePrevention: {
          ingestAliasSearchPlanned: true,
          archivedCustomerCollisionReviewed: true,
          existingCustomerPolicy: 'fail_if_exists',
        },
        hierarchyMode: 'standalone',
        billingProvider: {
          mode: 'stripe',
          stripeCustomerId: options.stripeCustomerId || 'cus_<stripe-customer-id>',
          stripeCollectionMethod: 'send_invoice',
          deliveryMethodId: options.deliveryMethodId || '<delivery-method-id>',
          leaveStripeInvoicesInDraft: true,
        },
        customFieldKeysApproved: true,
        approvedCustomFieldKeys: ['external_customer_id', 'customer_type', 'billing_email'],
      },
      contractCreate: {
        customerId: '<customer-id-from-setup>',
        packageAlias: options.packageAlias || 'payg',
        uniquenessKey: options.contractUniquenessKey || 'onboard:<external-customer-id>:<package-alias>:<UTC-date>',
        startingAt: options.startingAt || '<UTC-hour-boundary>',
      },
      verificationPlan: {
        customerReadback: true,
        billingProviderReadback: true,
        contractReadback: true,
      },
      rollbackPlan: 'Stop before contracts.create if customer setup or billing-provider preview fails validation.',
    };
  }
  if (intent.id === 'fixed-annual-package') {
    return {
      packageAlias: options.packageAlias || 'pro_annual',
      uniquenessKey: options.uniquenessKey || 'pkg:pro-annual:<UTC-date>',
      annualPriceCents: options.annualPriceCents != null ? Number(options.annualPriceCents) : 120000,
      billingFrequency: 'ANNUAL',
    };
  }
  if (intent.id === 'free-trial-package') {
    return {
      packageAlias: options.packageAlias || 'free_trial',
      trialCredits: options.trialCredits != null ? Number(options.trialCredits) : 500,
      trialDurationDays: options.trialDurationDays != null ? Number(options.trialDurationDays) : 14,
    };
  }
  if (intent.id === 'paid-credit-top-up') {
    return {
      customerId: options.customerId || '<customer-id>',
      contractId: options.contractId || '<active-contract-id>',
      amount: options.amount != null ? Number(options.amount) : 1000,
      creditTypeId: options.catalogResolution?.catalog?.creditTypeId || '<credit-type-id>',
    };
  }
  if (intent.id === 'subscription-contract') {
    return {
      customerId: options.customerId || '<customer-id>',
      startingAt: options.startingAt || '<UTC-hour-boundary>',
      billingFrequency: options.billingFrequency || 'MONTHLY',
    };
  }
  if (intent.id === 'greenfield-credits-product') {
    return buildGreenfieldCreditsProductTemplates(options);
  }
  return null;
}

function buildGreenfieldCreditsProductTemplates(options = {}) {
  const productName = options.name || options.displayName || 'Usage Credits';
  const aggregation = String(options.aggregation || options.aggregationType || 'COUNT').toUpperCase();
  const eventType = options.eventType || 'usage';
  const dimensionKey = options.dimensionKey || options['dimension-key'] || 'dimension_key';
  const aggregationKey = options.aggregationKey || 'credits_used';

  const propertyFilters = aggregation === 'COUNT'
    ? [
      { name: dimensionKey, exists: true },
      { name: 'source', exists: true },
    ]
    : [
      { name: aggregationKey, exists: true },
      { name: dimensionKey, exists: true },
      { name: 'source', exists: true },
    ];

  const billableMetricRequest = {
    body: {
      name: `${productName} metric`,
      event_type_filter: { in_values: [eventType] },
      property_filters: propertyFilters,
      aggregation_type: ['COUNT', 'SUM', 'MAX', 'UNIQUE'].includes(aggregation) ? aggregation : 'COUNT',
      ...(aggregation !== 'COUNT' ? { aggregation_key: aggregationKey } : {}),
      group_keys: [[dimensionKey]],
      custom_fields: {},
    },
  };

  const usageProductRequest = {
    body: {
      name: productName,
      type: 'USAGE',
      billable_metric_id: '<billable-metric-id-from-create>',
      tags: [],
      pricing_group_key: [dimensionKey],
      presentation_group_key: [],
      custom_fields: {},
    },
    evidence: {
      customerFacingNameReviewed: false,
      billableMetricReadBackReviewed: false,
      duplicateProductReviewed: false,
      billableMetricCompoundGroupKeyReviewed: false,
      ingestPropertiesReviewed: false,
    },
  };

  return {
    schemaVersion: 'metro.workspace.greenfield.v1',
    liveApplyAuthorized: false,
    order: ['billableMetrics.create', 'products.create', 'rateCards.addRates'],
    billableMetricRequest,
    usageProductRequest,
    notes: [
      'Fill evidence.* to true only after human review of name, BM read-back, and duplicate product check.',
      'Sandbox apply (if allowlisted) still requires apply-gate + approval-record + --confirm-live-apply + --confirm-greenfield-create.',
      'After creates succeed, re-run metro catalog bind --write and prefer dimensional addRates for new codes.',
    ],
  };
}

function buildMultiTierRolloutPlan(intent, options = {}) {
  const catalog = options.catalogResolution || resolveWorkspaceCatalog({ tenant: options.tenant, workspaceCatalog: options.workspaceCatalog });
  const actionCode = options.actionCode || '<ACTION_CODE>';
  const steps = (catalog.tiers || []).map((tier, index) => ({
    order: index + 1,
    tier: tier.tier,
    alias: tier.alias,
    rateCardId: tier.effectiveRateCardId,
    dimensionalProductId: tier.effectiveProductId,
    canary: index === 0,
    inputFile: `<rollout-${tier.tier}-${actionCode}.json>`,
    commands: [
      `metro validate --shape dimensional-rate-card --file <rollout-${tier.tier}-${actionCode}.json> --json`,
      `metro rate-card dimensional preview --file <rollout-${tier.tier}-${actionCode}.json> --${options.tenant === 'production' ? 'prod' : 'sandbox'} --json`,
    ],
    readBackBeforeNextTier: true,
    inputTemplate: buildAddActionRateInputTemplate({
      ...options,
      catalogResolution: catalog,
      tier,
    }),
  }));

  return {
    schemaVersion: 'metro.workspace.rollout.v1',
    actionCode,
    catalogResolved: catalog.resolved,
    catalogSource: catalog.source,
    missingCatalogIds: catalog.missingIds,
    tierOrder: steps.map((step) => step.tier),
    steps,
    stopCriteria: 'Stop rollout if any tier read-back differs from preview or if the canary first-card step fails.',
  };
}

function buildWorkspacePlan(intentId, options = {}) {
  const tenant = options.tenant;
  if (!tenant) {
    return {
      schemaVersion: PLAN_SCHEMA_VERSION,
      valid: false,
      error: 'tenant-required',
      message: 'Workspace plans require explicit tenant selection: --sandbox or --prod.',
      nextCommands: ['metro plan list --json', 'metro workspace explain --json'],
    };
  }

  const intent = getIntent(intentId);
  if (!intent) {
    return {
      schemaVersion: PLAN_SCHEMA_VERSION,
      valid: false,
      error: 'unknown-intent',
      message: `Unknown plan intent "${intentId}".`,
      availableIntents: listIntents().map((entry) => entry.id),
      nextCommands: ['metro plan list --json'],
    };
  }

  const workspace = getWorkspaceModel();
  const profileBinding = options.profileResolution || null;
  const catalogResolution = resolveWorkspaceCatalog({
    tenant,
    workspaceCatalog: options.workspaceCatalog || null,
  });

  const plan = {
    schemaVersion: PLAN_SCHEMA_VERSION,
    valid: true,
    apiAccess: 'none',
    liveApplyAuthorized: false,
    tenant,
    workspace: {
      schemaVersion: workspace.schemaVersion,
      catalogPattern: workspace.catalogPattern.id,
    },
    catalogBindings: catalogResolution,
    intent: {
      id: intent.id,
      title: intent.title,
      summary: intent.summary,
      workflow: intent.workflow,
    },
    recommendation: {
      recommendedShape: intent.recommendedShape,
      catalogMode: intent.catalogMode || null,
      secondaryShapes: intent.secondaryShapes || [],
      optimalPathSummary: intent.summary,
    },
    rejectedPaths: intent.rejectedPaths || [],
    tierRateCards: ['add-pricing-dimension-value', 'rollout-dimension-across-cards'].includes(intent.id)
      ? catalogResolution.tiers
      : [],
    commands: [...intent.commands],
    verificationReads: [...intent.verificationReads],
    tenantNote: intent.tenantNotes?.[tenant === 'production' ? 'production' : 'sandbox'] || null,
    expectedSideEffects: [],
    willNotDo: [],
    nextCommands: intent.commands.slice(0, 3),
  };

  if (profileBinding) {
    plan.profile = {
      name: profileBinding.profile || null,
      tenant: profileBinding.tenant || null,
      metronomeKeyEnv: profileBinding.metronomeKeyEnv || null,
      keyConfigured: profileBinding.keyConfigured ?? null,
    };
  }


  if (intent.id === 'credits-product-decision') {
    plan.willNotDo = [
      'Will not call products.create or billableMetrics.create from this decision intent.',
      'Will not invent a shape inputTemplate; fork first.',
    ];
    plan.decisionFork = {
      dimensional: 'metro plan add-pricing-dimension-value --dimension-key=<KEY> --price=<n> --sandbox --json',
      grant: 'metro plan complimentary-credits --sandbox --json',
      greenfield: 'metro plan greenfield-credits-product --sandbox --json',
    };
    if (options.accountPattern === 'greenfield-needed') {
      plan.nextSafeStep = plan.decisionFork.greenfield;
    } else if (options.accountPattern === 'dimensional-shared-usage') {
      plan.nextSafeStep = plan.decisionFork.dimensional;
    } else if (options.accountPattern === 'commit-grant-heavy') {
      plan.nextSafeStep = plan.decisionFork.grant;
    } else {
      plan.nextSafeStep = 'metro docs explain credits.product.decision --markdown';
    }
  }

  if (intent.id === 'greenfield-credits-product') {
    plan.willNotDo = [
      'Will not live-apply BM/product create from this plan command alone.',
      'Will not skip evidence flags on products.create.',
      'Will not addRates until a shared USAGE product exists and catalog bind is refreshed.',
    ];
    plan.expectedSideEffects = [
      'Local templates only until metro api validate/preview (and optional gated sandbox apply).',
      'After create + bind, new pricing codes should use add-pricing-dimension-value.',
    ];
    plan.inputTemplate = buildGreenfieldCreditsProductTemplates(options);
    plan.apiAccess = 'none';
    plan.liveApplyAuthorized = false;
    plan.nextSafeStep = 'Write plan.inputTemplate.billableMetricRequest to a file, then: metro api validate billableMetrics.create --file <bm.json> --json';
    plan.nextCommands = [
      'metro api validate billableMetrics.create --file <bm-create.json> --json',
      'metro api preview billableMetrics.create --file <bm-create.json> --sandbox --json',
      'metro api validate products.create --file <usage-product-create.json> --json',
      'metro api preview products.create --file <usage-product-create.json> --sandbox --json',
    ];
  }

  if (intent.id === 'add-pricing-dimension-value') {
    plan.willNotDo = [
      'Will not create a new billable metric for a new action code.',
      'Will not create a new USAGE product per action code.',
      'Will not mutate contracts, packages, or Stripe billing configs in this workflow.',
    ];
    plan.expectedSideEffects = [
      'Future apply would append addRates rows on the existing dimensional product at the reviewed starting_at.',
      'Canonical ingest requires dimension properties on usage events for code-only mode.',
    ];
    plan.inputTemplate = buildInputTemplate(intent, { ...options, catalogResolution });
    if (options.actionCode) {
      plan.commands.unshift(
        `metro validate --shape dimensional-rate-card --file <input-with-${options.actionCode}.json> --json`,
      );
    }
  }

  if (intent.id === 'rollout-dimension-across-cards') {
    plan.willNotDo = [
      'Will not use rateCards.update to replace entire cards.',
      'Will not create products or billable metrics during rollout.',
    ];
    plan.expectedSideEffects = [
      'Future apply would append addRates on each bound rate card in user-supplied order.',
      'Canary on first card; read-back before remaining cards.',
    ];
    plan.rollout = buildMultiTierRolloutPlan(intent, { ...options, tenant, catalogResolution });
    if (!catalogResolution.resolved) {
      plan.warnings = [{
        id: 'MTR-WORKSPACE-020',
        message: `Catalog ids incomplete (${catalogResolution.missingIds.join(', ')}); bind workspaceCatalog on profile or use reference sandbox defaults.`,
      }];
    }
    if (options.actionCode) {
      plan.inputTemplate = plan.rollout.steps[0]?.inputTemplate || null;
    }
  }

  if (intent.id === 'annual-subscription-package') {
    plan.willNotDo = [
      'Will not use legacy terms-only pro-annual when monthly drip is required.',
      'Will not create customer contracts in this package publish workflow.',
    ];
    plan.expectedSideEffects = [
      'Future apply would create a package with annual plan fee and recurring_commits shaped by creditGrantMode.',
      'monthly-drip grants 1/12 credits per month; lump-sum matches legacy annual commit access.',
    ];
    plan.inputTemplate = buildInputTemplate(intent, { ...options, catalogResolution });
    plan.commands.unshift(
      'metro docs explain workspace.routing --json',
      `metro validate --shape pro-annual-self-serve-v2 --file <pkg-v2.json> --json`,
    );
  }


  if (intent.id === 'package-plan-move') {
    plan.willNotDo = ['Will not create a new package.', 'Will not silently pick cutover time - explicit cutover review required for production.'];
    plan.expectedSideEffects = [
      'Predecessor contract ends at reviewed ending_before.',
      'Successor contract created from package_alias with new uniqueness_key.',
    ];
    plan.inputTemplate = buildInputTemplate(intent, { ...options, tenant, catalogResolution });
    plan.commands.unshift(
      'metro contract move-plan preview --file <move.json> --sandbox --json',
    );
    if (tenant === 'production') {
      plan.warnings = [{
        id: 'MTR-WORKSPACE-010',
        message: 'Production plan moves require explicit cutover review (current hour / next hour / explicit ISO) before apply.',
      }];
    }
  }

  if (intent.id === 'package-version-handoff') {
    plan.willNotDo = ['Will not archive old package before replacement alias is live.', 'Will not create customer contracts in this workflow.'];
    plan.expectedSideEffects = [
      'Future apply would create replacement package then archive old version after alias handoff read-back.',
    ];
    plan.inputTemplate = buildInputTemplate(intent, { ...options, tenant, catalogResolution });
    plan.commands.unshift(
      'metro package preview --shape pro-annual --file <pkg.json> --sandbox --json',
      'metro package archive preview --file <handoff.json> --sandbox --json',
    );
  }

  if (intent.id === 'complimentary-credits') {
    plan.willNotDo = ['Will not create a new contract.', 'Will not use packages.create for credit grants.'];
    plan.expectedSideEffects = [
      'Future apply would add_commits on the live contract via contracts.edit.v2.',
    ];
    plan.inputTemplate = buildInputTemplate(intent, { ...options, tenant, catalogResolution });
    plan.commands.unshift(
      'metro credit preview --shape complimentary-credit-grant --file <grant.json> --sandbox --json',
    );
  }

  if (intent.id === 'billing-provider-setup') {
    plan.willNotDo = ['Will not bulk-repair customers in one apply.', 'Will not change invoice delivery without read-back.'];
    plan.expectedSideEffects = [
      'Future apply would archive incorrect billing-provider row and insert corrected configuration for one customer.',
    ];
    plan.inputTemplate = buildInputTemplate(intent, { ...options, tenant, catalogResolution });
  }

  if (intent.id === 'onboard-customer') {
    plan.willNotDo = ['Will not skip billing-provider setup before paid package contracts.', 'Will not reuse uniqueness_key across customers.'];
    plan.expectedSideEffects = [
      'Future apply would create customer, attach Stripe billing config, then contracts.create from package_alias.',
    ];
    plan.inputTemplate = buildInputTemplate(intent, { ...options, tenant, catalogResolution });
    plan.commands.unshift(
      'metro customer setup preview --file <customer-setup.json> --sandbox --json',
    );
  }


  plan.sources = [
    'metronome-cli/src/workspace/model.js',
    'metronome-cli/src/workspace/plan.js',
    '.cursor/skills/metronome-pricing-catalog/SKILL.md',
    'docs/metronome-cli/one-goal.md',
  ];

  plan.nextSafeStep = plan.commands[0] || 'metro workspace explain --json';

  return plan;
}

function buildPlanInputTemplate(intentId, options = {}) {
  const plan = buildWorkspacePlan(intentId, options);
  if (!plan.valid) {
    return {
      schemaVersion: INPUT_TEMPLATE_SCHEMA_VERSION,
      valid: false,
      apiAccess: 'none',
      error: plan.error || 'plan-invalid',
      message: plan.message || 'Could not build workspace plan for input template.',
      intentId,
      availableIntents: plan.availableIntents || listIntents().map((entry) => entry.id),
      nextCommands: plan.nextCommands || ['metro plan list --json'],
    };
  }

  let inputTemplate = plan.inputTemplate || null;
  if (!inputTemplate && plan.rollout?.steps?.length) {
    inputTemplate = plan.rollout.steps[0].inputTemplate || null;
  }

  if (!inputTemplate) {
    return {
      schemaVersion: INPUT_TEMPLATE_SCHEMA_VERSION,
      valid: false,
      apiAccess: 'none',
      error: 'no-input-template',
      message: `Intent "${intentId}" has no top-level inputTemplate. Inspect metro plan ${intentId} --json for rollout steps or required flags.`,
      intentId: plan.intent.id,
      tenant: plan.tenant,
      recommendedShape: plan.recommendation.recommendedShape,
      rolloutStepCount: plan.rollout?.steps?.length || 0,
      nextCommands: plan.commands.slice(0, 3),
      nextSafeStep: plan.nextSafeStep,
    };
  }

  const shape = plan.recommendation.recommendedShape;
  return {
    schemaVersion: INPUT_TEMPLATE_SCHEMA_VERSION,
    valid: true,
    apiAccess: 'none',
    intentId: plan.intent.id,
    tenant: plan.tenant,
    workflow: plan.intent.workflow,
    recommendedShape: shape,
    catalogMode: plan.recommendation.catalogMode || null,
    inputTemplate,
    suggestedFilename: `<${plan.intent.id.replace(/[^a-z0-9]+/g, '-')}-input.json>`,
    validateCommand: shape
      ? `metro validate --shape ${shape} --file <input.json> --json`
      : null,
    previewCommand: plan.commands.find((cmd) => cmd.includes(' preview ')) || null,
    nextCommands: plan.commands.slice(0, 4),
    nextSafeStep: shape
      ? `Fill placeholders in inputTemplate, write to a file, then run metro validate --shape ${shape}.`
      : plan.nextSafeStep,
  };
}

function buildRouteRefusal(intent, rejected, endpointId, tenant) {
  return {
    schemaVersion: ROUTE_SCHEMA_VERSION,
    valid: true,
    routed: false,
    refused: true,
    tenant: tenant || null,
    endpointId,
    reason: rejected.reason,
    recommendedIntent: intent.id,
    recommendedShape: intent.recommendedShape,
    nextCommands: [
      `metro plan ${intent.id} ${tenant === 'sandbox' ? '--sandbox' : tenant === 'production' ? '--prod' : ''} --json`.trim(),
      'metro workspace explain --json',
    ],
    sources: ['metronome-cli/src/workspace/plan.js'],
  };
}

function findEndpointRefusal(endpointId, options = {}) {
  const preferredIntentId = options.preferredIntentId || null;
  if (preferredIntentId) {
    const intent = getIntent(preferredIntentId);
    const rejected = (intent?.rejectedPaths || []).find((path) => path.endpointId === endpointId);
    return rejected ? { intent, rejected } : null;
  }

  for (const entry of listIntents()) {
    const intent = getIntent(entry.id);
    const rejected = (intent.rejectedPaths || []).find((path) => path.endpointId === endpointId);
    if (rejected) return { intent, rejected };
  }
  return null;
}

function routeWorkspaceRequest(options = {}) {
  const tenant = options.tenant;
  const goal = options.goal || '';
  const endpointId = options.endpointId || null;
  const intentId = options.intentId || null;

  let resolvedIntent = intentId ? getIntent(intentId) : null;
  let match = null;

  if (!resolvedIntent && goal) {
    match = matchGoalToIntent(goal, {
      accountPattern: options.accountPattern || null,
    });
    if (match) resolvedIntent = getIntent(match.intentId);
  }

  if (endpointId) {
    const refusal = findEndpointRefusal(endpointId, {
      preferredIntentId: resolvedIntent?.id || null,
    });
    if (refusal) {
      return buildRouteRefusal(refusal.intent, refusal.rejected, endpointId, tenant);
    }
  }

  if (!resolvedIntent) {
    return {
      schemaVersion: ROUTE_SCHEMA_VERSION,
      valid: false,
      routed: false,
      message: 'Could not match goal or endpoint to a workspace intent.',
      nextCommands: ['metro plan list --json', 'metro route --goal "<describe your billing goal>" --sandbox --json'],
    };
  }

  const plan = tenant
    ? buildWorkspacePlan(resolvedIntent.id, { tenant, ...options, intentId: resolvedIntent.id })
    : null;

  return {
    schemaVersion: ROUTE_SCHEMA_VERSION,
    valid: true,
    routed: true,
    refused: false,
    match,
    intentId: resolvedIntent.id,
    recommendedShape: resolvedIntent.recommendedShape,
    catalogMode: resolvedIntent.catalogMode || null,
    rejectedPaths: resolvedIntent.rejectedPaths || [],
    plan: plan?.valid ? plan : null,
    nextCommands: plan?.nextCommands || resolvedIntent.commands.slice(0, 3),
    nextSafeStep: plan?.nextSafeStep || `metro plan ${resolvedIntent.id} --sandbox --json`,
  };
}

function classifyAuditExportSummary(actionCounts = {}) {
  const classifications = [];
  for (const [action, count] of Object.entries(actionCounts)) {
    const intent = intentForAuditAction(action);
    classifications.push({
      action,
      count,
      recommendedIntent: intent?.id || null,
      note: intent ? intent.summary : 'No workspace intent mapped - review manually.',
    });
  }
  classifications.sort((a, b) => b.count - a.count);
  return classifications;
}

module.exports = {
  PLAN_SCHEMA_VERSION,
  INPUT_TEMPLATE_SCHEMA_VERSION,
  ROUTE_SCHEMA_VERSION,
  WORKSPACE_SCHEMA_VERSION,
  listIntents,
  matchGoalToIntent,
  buildWorkspacePlan,
  buildPlanInputTemplate,
  buildMultiTierRolloutPlan,
  buildAddActionRateInputTemplate,
  routeWorkspaceRequest,
  classifyAuditExportSummary,
  getWorkspaceModel,
  tierRateCardsForTenant,
};
