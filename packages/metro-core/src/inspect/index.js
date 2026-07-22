'use strict';

const COMMON_SAFETY_GATES = [
  {
    id: 'MTR-TENANT-001',
    requirement: 'The command must select exactly one tenant with --sandbox or --prod.',
    planStatus: 'required-before-plan',
  },
  {
    id: 'MTR-LIVE-READ-001',
    requirement: 'A current user turn must explicitly authorize the exact live read before a read client executes.',
    planStatus: 'blocked-for-live-execution',
  },
  {
    id: 'MTR-CLIENT-001',
    requirement: 'Future execution must use a tenant-explicit guarded read client, not an ad hoc endpoint call.',
    planStatus: 'blocked-for-live-execution',
  },
  {
    id: 'MTR-SECRET-001',
    requirement: 'Output must never include API keys, bearer tokens, or raw environment values.',
    planStatus: 'always-enforced',
  },
  {
    id: 'MTR-WRITE-001',
    requirement: 'The inspect plan may include read endpoints only and must not mutate Metronome state.',
    planStatus: 'always-enforced',
  },
];

const INSPECT_PLANS = {
  'customer.billing-state': {
    workflow: 'customer.billing-state',
    command: 'metro customer billing-state --customer-id <id> (--sandbox|--prod) --plan',
    title: 'Customer billing-state inspect plan',
    targetType: 'customer',
    identifierFlag: 'customer-id',
    identifierName: 'customer_id',
    outputSchemaVersion: 'metro.customer.billing-state.v1',
    endpointPlan: [
      {
        method: 'GET',
        path: '/v1/customers/{customer_id}',
        purpose: 'Confirm the Metronome customer identity and configuration baseline.',
        responseEvidence: ['customer id', 'customer name', 'ingest aliases', 'customer configuration'],
      },
      {
        method: 'POST',
        path: '/v1/getCustomerBillingProviderConfigurations',
        purpose: 'Inspect Stripe or other billing provider configuration attached to the customer.',
        bodyTemplate: { customer_id: '{customer_id}' },
        responseEvidence: ['billing provider type', 'delivery method', 'draft invoice behavior'],
      },
      {
        method: 'POST',
        path: '/v2/contracts/list',
        purpose: 'List active and archived customer contracts for billing-state context.',
        bodyTemplate: { customer_id: '{customer_id}', include_archived: true },
        responseEvidence: ['active contracts', 'archived contracts', 'transitions'],
      },
      {
        method: 'POST',
        path: '/v1/contracts/customerBalances/list',
        purpose: 'Inspect current credit and commit balances for the customer.',
        bodyTemplate: { customer_id: '{customer_id}' },
        responseEvidence: ['commit balances', 'credit balances', 'contract associations'],
      },
      {
        method: 'GET',
        path: '/v1/customers/{customer_id}/invoices?limit=20&status=DRAFT',
        purpose: 'List draft invoices that could be affected by contract, billing-provider, or Stripe-delivery changes.',
        responseEvidence: ['draft invoice ids', 'invoice types', 'invoice totals'],
      },
      {
        method: 'GET',
        path: '/v1/customers/{customer_id}/invoices?limit=20&status=FINALIZED',
        purpose: 'List recent finalized invoices to identify already-synced billing artifacts.',
        responseEvidence: ['finalized invoice ids', 'invoice dates', 'Metronome status'],
      },
    ],
    outputContract: {
      schemaVersion: 'metro.customer.billing-state.v1',
      fields: [
        'tenant',
        'customerId',
        'requestSummary',
        'customer',
        'billingProviderConfigurations',
        'contracts',
        'balances',
        'draftInvoices',
        'finalizedInvoices',
        'verificationWarnings',
      ],
    },
    sources: [
      '.cursor/skills/metronome-danger-zone/references/endpoint-matrix.md#6-customers',
      '.cursor/skills/metronome-danger-zone/references/endpoint-matrix.md#7-billing-provider-configs-stripe',
      '.cursor/skills/metronome-danger-zone/references/endpoint-matrix.md#9-contracts',
      '.cursor/skills/metronome-danger-zone/references/endpoint-matrix.md#10-credits--commits',
      '.cursor/skills/metronome-danger-zone/references/endpoint-matrix.md#11-invoices',
      'docs/API_OPERATIONS.md#metronome',
    ],
  },
  'package.inspect': {
    workflow: 'package.inspect',
    command: 'metro package inspect --alias <package_alias> (--sandbox|--prod) --plan',
    title: 'Package inspect plan',
    targetType: 'package',
    identifierFlag: 'alias',
    identifierName: 'package_alias',
    outputSchemaVersion: 'metro.package.inspect.v1',
    endpointPlan: [
      {
        method: 'POST',
        path: '/v1/packages/list?limit=100',
        purpose: 'List package versions so the runner can locate the requested alias and normalize package: uniqueness-key prefixes.',
        bodyTemplate: {},
        responseEvidence: ['package ids', 'package aliases', 'uniqueness keys', 'alias effective timestamps'],
      },
      {
        method: 'POST',
        path: '/v1/packages/get',
        purpose: 'Inspect the selected package version after resolving the alias from the list response.',
        bodyTemplate: { package_id: '<package_id from list response>' },
        responseEvidence: ['package id', 'package alias', 'rate card', 'terms', 'commits', 'credits'],
      },
      {
        method: 'POST',
        path: '/v1/packages/listContractsOnPackage',
        purpose: 'List contracts attached to the selected package before any alias handoff, archive, or package-version change is planned.',
        bodyTemplate: { package_id: '<package_id from list response>' },
        responseEvidence: ['contract ids', 'customer ids', 'contract starting_at timestamps'],
      },
    ],
    outputContract: {
      schemaVersion: 'metro.package.inspect.v1',
      fields: [
        'tenant',
        'packageAlias',
        'requestSummary',
        'packageMatches',
        'selectedPackage',
        'contractsOnPackage',
        'aliasResolutionWarnings',
        'verificationWarnings',
      ],
    },
    sources: [
      '.cursor/skills/metronome-danger-zone/references/endpoint-matrix.md#5-packages',
      'docs/metronome-cli/GOTCHAS.md#packages',
      'docs/API_OPERATIONS.md#metronome',
    ],
  },
  'product.inspect': {
    workflow: 'product.inspect',
    command: 'metro product inspect --product-id <id> (--sandbox|--prod) --plan',
    title: 'Product inspect plan',
    targetType: 'product',
    identifierFlag: 'product-id',
    identifierName: 'product_id',
    outputSchemaVersion: 'metro.product.inspect.v1',
    endpointPlan: [
      {
        method: 'POST',
        path: '/v1/contract-pricing/products/get',
        purpose: 'Inspect product current, initial, archived, and scheduled update state for product-version read-back.',
        bodyTemplate: { id: '{product_id}' },
        responseEvidence: ['product id', 'current version', 'initial version', 'scheduled updates', 'archived state'],
      },
    ],
    outputContract: {
      schemaVersion: 'metro.product.inspect.v1',
      fields: [
        'tenant',
        'productId',
        'requestSummary',
        'product',
        'currentVersion',
        'initialVersion',
        'scheduledUpdates',
        'archivedAt',
        'verificationWarnings',
      ],
    },
    sources: [
      '.cursor/skills/metronome-danger-zone/references/endpoint-matrix.md#3-products',
      'docs/metronome-cli/GOTCHAS.md#rate-cards-and-products',
      'docs/API_OPERATIONS.md#metronome',
    ],
  },
  'billing-provider.inspect': {
    workflow: 'billing-provider.inspect',
    command: 'metro billing-provider inspect --customer-id <id> (--sandbox|--prod) --plan',
    title: 'Billing provider inspect plan',
    targetType: 'billing-provider',
    identifierFlag: 'customer-id',
    identifierName: 'customer_id',
    outputSchemaVersion: 'metro.billing-provider.inspect.v1',
    endpointPlan: [
      {
        method: 'GET',
        path: '/v1/customers/{customer_id}',
        purpose: 'Confirm the customer identity before evaluating Stripe or other billing provider configuration.',
        responseEvidence: ['customer id', 'customer name', 'customer configuration'],
      },
      {
        method: 'POST',
        path: '/v1/getCustomerBillingProviderConfigurations',
        purpose: 'Inspect billing provider configurations attached to the customer.',
        bodyTemplate: { customer_id: '{customer_id}' },
        responseEvidence: ['billing provider type', 'delivery method', 'delivery method id', 'archived status'],
      },
    ],
    outputContract: {
      schemaVersion: 'metro.billing-provider.inspect.v1',
      fields: [
        'tenant',
        'customerId',
        'requestSummary',
        'customer',
        'billingProviderConfigurations',
        'deliveryMethodWarnings',
        'verificationWarnings',
      ],
    },
    sources: [
      '.cursor/skills/metronome-danger-zone/references/endpoint-matrix.md#6-customers',
      '.cursor/skills/metronome-danger-zone/references/endpoint-matrix.md#7-billing-provider-configs-stripe',
      'docs/metronome-cli/GOTCHAS.md#billing-provider-and-stripe',
      'docs/API_OPERATIONS.md#metronome',
    ],
  },
  'contract.inspect': {
    workflow: 'contract.inspect',
    command: 'metro contract inspect --contract-id <id> (--sandbox|--prod) --plan [--at <timestamp>]',
    title: 'Contract inspect plan',
    targetType: 'contract',
    identifierFlag: 'contract-id',
    identifierName: 'contract_id',
    outputSchemaVersion: 'metro.contract.inspect.v1',
    endpointPlan: [
      {
        method: 'POST',
        path: '/v2/contracts/get',
        purpose: 'Inspect the current contract payload using the current v2 contract endpoint.',
        bodyTemplate: { contract_id: '{contract_id}' },
        responseEvidence: ['contract id', 'customer id', 'rate card', 'commits', 'credits', 'scheduled charges'],
      },
      {
        method: 'POST',
        path: '/v2/contracts/getEditHistory',
        purpose: 'Inspect prior contract edits when the workflow needs change history before remediation.',
        bodyTemplate: {
          customer_id: '<customer_id from contract get response>',
          contract_id: '{contract_id}',
        },
        responseEvidence: ['edit timestamps', 'edit operations', 'actor metadata when available'],
      },
      {
        method: 'POST',
        path: '/v1/contracts/getContractRateSchedule?limit=100',
        purpose: 'Inspect effective rates and overrides for the contract at the relevant timestamp.',
        bodyTemplate: {
          customer_id: '<customer_id from contract get response>',
          contract_id: '{contract_id}',
          at: '<hour-boundary timestamp>',
        },
        responseEvidence: ['rate card entries', 'contract overrides', 'entitlement state'],
      },
    ],
    outputContract: {
      schemaVersion: 'metro.contract.inspect.v1',
      canonicalTimestampField: 'at',
      compatibilityAliases: [
        {
          field: 'coveringDate',
          canonicalField: 'at',
          status: 'retained-for-metro.contract.inspect.v1',
          removal: 'schema-version-bump-required',
        },
      ],
      fields: [
        'tenant',
        'contractId',
        'at',
        'coveringDate',
        'requestSummary',
        'contract',
        'customerId',
        'rateCard',
        'commits',
        'credits',
        'scheduledCharges',
        'transitions',
        'editHistory',
        'rateSchedule',
        'verificationWarnings',
      ],
    },
    sources: [
      '.cursor/skills/metronome-danger-zone/references/endpoint-matrix.md#9-contracts',
      'docs/API_OPERATIONS.md#metronome',
    ],
  },
  'subscription.history.inspect': {
    workflow: 'subscription.history.inspect',
    command: 'metro subscription history inspect --customer-id <id> --contract-id <id> --subscription-id <id> (--sandbox|--prod) --plan',
    title: 'Subscription history inspect plan',
    targetType: 'subscription-history',
    identifierFlag: 'subscription-id',
    identifierName: 'subscription_id',
    additionalIdentifiers: [
      { flag: 'customer-id', name: 'customer_id' },
      { flag: 'contract-id', name: 'contract_id' },
    ],
    outputSchemaVersion: 'metro.subscription-history.inspect.v1',
    endpointPlan: [
      {
        method: 'POST',
        path: '/v1/contracts/getSubscriptionQuantityHistory',
        purpose: 'Inspect subscription quantity history for direct subscription read-back.',
        bodyTemplate: {
          customer_id: '{customer_id}',
          contract_id: '{contract_id}',
          subscription_id: '{subscription_id}',
        },
        responseEvidence: ['subscription id', 'quantity changes', 'quantity effective timestamps'],
      },
      {
        method: 'POST',
        path: '/v1/contracts/getSubscriptionSeatsHistory',
        purpose: 'Inspect subscription seat history for SEAT_BASED direct subscription read-back.',
        bodyTemplate: {
          customer_id: '{customer_id}',
          contract_id: '{contract_id}',
          subscription_id: '{subscription_id}',
        },
        responseEvidence: ['subscription id', 'seat ids', 'seat effective timestamps'],
      },
    ],
    outputContract: {
      schemaVersion: 'metro.subscription-history.inspect.v1',
      fields: [
        'tenant',
        'customerId',
        'contractId',
        'subscriptionId',
        'requestSummary',
        'quantityHistory',
        'seatHistory',
        'verificationWarnings',
      ],
      optionalFields: [
        {
          field: 'seatHistoryNotApplicable',
          condition: 'Required when seatHistory is empty because the subscription is QUANTITY_ONLY.',
          evidenceRequired: ['status: not_applicable', 'reason'],
        },
      ],
    },
    sources: [
      '.cursor/skills/metronome-danger-zone/references/endpoint-matrix.md#9-contracts',
      'docs/metronome-cli/SHAPE_CATALOG.md#subscription-product-contract',
      'docs/metronome-cli/VALIDATION_AND_GUARDRAILS.md#subscription-rules',
      'docs/API_OPERATIONS.md#metronome',
    ],
  },
  'invoice.inspect': {
    workflow: 'invoice.inspect',
    command: 'metro invoice inspect --invoice-id <id> (--sandbox|--prod) --plan',
    title: 'Invoice inspect plan',
    targetType: 'invoice',
    identifierFlag: 'invoice-id',
    identifierName: 'invoice_id',
    outputSchemaVersion: 'metro.invoice.inspect.v1',
    endpointPlan: [
      {
        method: 'POST',
        path: '/v1/invoices/get',
        purpose: 'Inspect one invoice, including status, totals, and line items.',
        bodyTemplate: { invoice_id: '{invoice_id}' },
        responseEvidence: ['invoice id', 'status', 'type', 'line items', 'total'],
      },
      {
        method: 'POST',
        path: '/v1/invoices/payments/list',
        purpose: 'Inspect payment attempts only when payment reconciliation is part of the authorized read.',
        bodyTemplate: { invoice_id: '{invoice_id}' },
        responseEvidence: ['payment attempt ids', 'payment status', 'provider metadata when available'],
      },
    ],
    outputContract: {
      schemaVersion: 'metro.invoice.inspect.v1',
      fields: [
        'tenant',
        'invoiceId',
        'requestSummary',
        'invoice',
        'customerId',
        'contractId',
        'status',
        'type',
        'totals',
        'lineItems',
        'payments',
        'stripeReconciliationWarnings',
      ],
    },
    sources: [
      '.cursor/skills/metronome-danger-zone/references/endpoint-matrix.md#11-invoices',
      '.cursor/skills/metronome-danger-zone/references/endpoint-matrix.md#12-payments',
      'docs/API_OPERATIONS.md#metronome',
    ],
  },
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function replaceTemplateValues(value, replacements) {
  if (typeof value === 'string') {
    let replaced = value;
    for (const [name, replacement] of Object.entries(replacements)) {
      replaced = replaced.replaceAll(`{${name}}`, replacement);
      replaced = replaced.replaceAll(`<${name}>`, replacement);
    }
    return replaced;
  }
  if (Array.isArray(value)) {
    return value.map((item) => replaceTemplateValues(item, replacements));
  }
  if (value && typeof value === 'object') {
    const replaced = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      replaced[key] = replaceTemplateValues(nestedValue, replacements);
    }
    return replaced;
  }
  return value;
}

function validateIdentifier(identifierName, identifierValue) {
  const findings = [];
  if (typeof identifierValue !== 'string' || identifierValue.trim() === '') {
    findings.push({
      id: 'MTR-ID-001',
      severity: 'error',
      message: `${identifierName} is required.`,
      remediation: `Pass --${identifierName.replace('_', '-')} <id>.`,
    });
    return findings;
  }

  if (identifierValue.length > 256) {
    findings.push({
      id: 'MTR-ID-002',
      severity: 'error',
      message: `${identifierName} is too long for a CLI inspect identifier.`,
      remediation: 'Use a single Metronome object identifier, not a serialized payload.',
    });
  }

  if (!/^[A-Za-z0-9._:-]+$/.test(identifierValue)) {
    findings.push({
      id: 'MTR-ID-003',
      severity: 'error',
      message: `${identifierName} contains characters unsafe for path or query planning.`,
      remediation: 'Use the exact Metronome ID without spaces, slashes, query strings, or shell syntax.',
    });
  }

  return findings;
}

function validateHourBoundaryTimestamp(fieldName, value) {
  if (typeof value !== 'string' || value.trim() === '') {
    return [{
      id: 'MTR-TIME-001',
      severity: 'error',
      message: `${fieldName} is required.`,
      remediation: `Pass ${fieldName} as an ISO UTC timestamp on an hour boundary.`,
    }];
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    return [{
      id: 'MTR-TIME-002',
      severity: 'error',
      message: `${fieldName} must be an ISO UTC timestamp with millisecond precision.`,
      remediation: 'Use a value like 2026-07-01T00:00:00.000Z.',
    }];
  }

  if (parsed.getUTCMinutes() !== 0 || parsed.getUTCSeconds() !== 0 || parsed.getUTCMilliseconds() !== 0) {
    return [{
      id: 'MTR-TIME-003',
      severity: 'error',
      message: `${fieldName} must be on a UTC hour boundary.`,
      remediation: 'Round the timestamp to HH:00:00.000Z before inspecting rate schedules.',
    }];
  }

  return [];
}

function getInspectPlanDefinition(workflow) {
  const definition = INSPECT_PLANS[workflow];
  return definition ? clone(definition) : null;
}

function inspectIdentifierDefinitions(definition) {
  return [
    {
      flag: definition.identifierFlag,
      name: definition.identifierName,
    },
    ...(definition.additionalIdentifiers || []),
  ];
}

function listInspectPlans() {
  return Object.values(INSPECT_PLANS).map((definition) => ({
    workflow: definition.workflow,
    command: definition.command,
    title: definition.title,
    targetType: definition.targetType,
    outputSchemaVersion: definition.outputSchemaVersion,
  }));
}

function buildInspectPlan(workflow, identifiers, options = {}) {
  const definition = INSPECT_PLANS[workflow];
  if (!definition) return null;

  const tenant = options.tenant;
  const identifierDefinitions = inspectIdentifierDefinitions(definition);
  const identifierValues = {};
  const findings = identifierDefinitions.flatMap((identifier) => {
    const value = identifiers[identifier.name];
    identifierValues[identifier.name] = value;
    return validateIdentifier(identifier.name, value);
  });
  if (findings.length > 0) {
    return {
      schemaVersion: 'metro.inspect.plan.validation.v1',
      workflow,
      valid: false,
      findings,
    };
  }

  let endpointPlan = definition.endpointPlan.map((endpoint) => replaceTemplateValues(endpoint, identifierValues));
  if (options.templateValues) {
    endpointPlan = endpointPlan.map((endpoint) => replaceTemplateValues(endpoint, options.templateValues));
  }

  return {
    schemaVersion: 'metro.inspect.plan.v1',
    workflow: definition.workflow,
    title: definition.title,
    tenant,
    mode: 'inspect-plan',
    apiAccess: 'none',
    plannedApiAccess: 'read',
    target: {
      type: definition.targetType,
      identifiers: identifierValues,
    },
    liveExecution: {
      enabledInCurrentCli: false,
      reason: 'This command only plans the read. Live Metronome reads require current-turn authorization and a guarded read client.',
      nextSafeStep: 'Review the endpoint plan and output contract; add a guarded read runner only after the safety gates are implemented.',
    },
    endpointPlan,
    safetyGates: clone(COMMON_SAFETY_GATES),
    outputContract: clone(definition.outputContract),
    sources: [...definition.sources],
  };
}

function dataOf(response) {
  if (response && Object.prototype.hasOwnProperty.call(response, 'data')) {
    return response.data;
  }
  return response;
}

function customerIdFrom(payload) {
  if (!payload || typeof payload !== 'object') return null;
  if (typeof payload.id === 'string') return payload.id;
  if (typeof payload.customer_id === 'string') return payload.customer_id;
  if (payload.customer && typeof payload.customer.id === 'string') return payload.customer.id;
  return null;
}

function objectIdFrom(payload) {
  if (!payload || typeof payload !== 'object') return null;
  if (typeof payload.id === 'string') return payload.id;
  if (typeof payload.package_id === 'string') return payload.package_id;
  if (typeof payload.contract_id === 'string') return payload.contract_id;
  if (typeof payload.invoice_id === 'string') return payload.invoice_id;
  if (payload.package && typeof payload.package.id === 'string') return payload.package.id;
  if (payload.contract && typeof payload.contract.id === 'string') return payload.contract.id;
  if (payload.invoice && typeof payload.invoice.id === 'string') return payload.invoice.id;
  return null;
}

function normalizeList(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.packages)) return payload.packages;
  if (Array.isArray(payload?.contracts)) return payload.contracts;
  if (Array.isArray(payload?.invoices)) return payload.invoices;
  return payload == null ? [] : [payload];
}

function packageAliasFrom(payload) {
  if (!payload || typeof payload !== 'object') return null;
  if (typeof payload.package_alias === 'string') return payload.package_alias;
  if (typeof payload.packageAlias === 'string') return payload.packageAlias;
  if (typeof payload.alias === 'string') return payload.alias;
  if (payload.package && typeof payload.package.package_alias === 'string') return payload.package.package_alias;
  return null;
}

function normalizePackageUniquenessKey(value) {
  return typeof value === 'string' ? value.replace(/^package:/, '') : value;
}

function packageUniquenessKeyFrom(payload) {
  if (!payload || typeof payload !== 'object') return null;
  if (typeof payload.uniqueness_key === 'string') return payload.uniqueness_key;
  if (typeof payload.uniquenessKey === 'string') return payload.uniquenessKey;
  if (payload.package && typeof payload.package.uniqueness_key === 'string') return payload.package.uniqueness_key;
  return null;
}

function packageMatchesAlias(payload, packageAlias) {
  const alias = packageAliasFrom(payload);
  if (alias === packageAlias) return true;
  const uniquenessKey = normalizePackageUniquenessKey(packageUniquenessKeyFrom(payload));
  return uniquenessKey === packageAlias;
}

function buildCustomerBillingStateWarnings(customerId, parts) {
  const warnings = [];
  const returnedCustomerId = customerIdFrom(parts.customer);
  if (returnedCustomerId && returnedCustomerId !== customerId) {
    warnings.push({
      id: 'MTR-IDENTITY-001',
      severity: 'error',
      message: `Customer response id ${returnedCustomerId} does not match requested id ${customerId}.`,
      remediation: 'Stop and verify the Metronome customer identifier before using this output.',
    });
  }
  if (normalizeList(parts.billingProviderConfigurations).length === 0) {
    warnings.push({
      id: 'MTR-BILL-001',
      severity: 'warning',
      message: 'No billing provider configuration was present in the inspected response.',
      remediation: 'Treat invoice-producing workflows as blocked until billing provider state is verified.',
    });
  }
  return warnings;
}

function buildPackageInspectWarnings(packageAlias, parts) {
  const aliasResolutionWarnings = [];
  const verificationWarnings = [];

  if (parts.packageMatches.length === 0) {
    aliasResolutionWarnings.push({
      id: 'MTR-PKG-001',
      severity: 'error',
      message: `No package matched alias or normalized uniqueness key ${packageAlias}.`,
      remediation: 'Stop and verify the package alias before planning contract creation, alias handoff, or archive work.',
    });
  }

  if (parts.packageMatches.length > 1) {
    aliasResolutionWarnings.push({
      id: 'MTR-PKG-006',
      severity: 'warning',
      message: `Multiple package versions matched ${packageAlias}; selected the first response item for follow-up reads.`,
      remediation: 'Compare alias starting_at values and contract cutover timestamps before relying on this package version.',
    });
  }

  if (parts.packageMatches.some((item) => /^package:/.test(packageUniquenessKeyFrom(item) || ''))) {
    aliasResolutionWarnings.push({
      id: 'MTR-PKG-004',
      severity: 'info',
      message: 'At least one matched package returned a package: uniqueness-key prefix.',
      remediation: 'Normalize package: prefixes before comparing package uniqueness keys.',
    });
  }

  if (parts.selectedPackage && !packageMatchesAlias(parts.selectedPackage, packageAlias)) {
    verificationWarnings.push({
      id: 'MTR-IDENTITY-004',
      severity: 'error',
      message: 'Selected package response did not match the requested alias or normalized uniqueness key.',
      remediation: 'Discard this output and rerun package inspection with the intended alias.',
    });
  }

  return { aliasResolutionWarnings, verificationWarnings };
}

function buildProductInspectWarnings(productId, parts) {
  const warnings = [];
  const returnedProductId = objectIdFrom(parts.product);
  if (returnedProductId && returnedProductId !== productId) {
    warnings.push({
      id: 'MTR-IDENTITY-006',
      severity: 'error',
      message: `Product response id ${returnedProductId} does not match requested id ${productId}.`,
      remediation: 'Stop and verify the Metronome product identifier before using this output.',
    });
  }
  if (!parts.currentVersion && !parts.initialVersion) {
    warnings.push({
      id: 'MTR-PRODUCT-001',
      severity: 'warning',
      message: 'Product response did not include current or initial version evidence.',
      remediation: 'Do not use this output to prove product version or scheduled update state until version evidence is present.',
    });
  }
  return warnings;
}

function buildContractInspectWarnings(contractId, contract, rateSchedule, options = {}) {
  const warnings = [];
  const returnedContractId = objectIdFrom(contract);
  const customerId = options.customerId || null;
  const rateScheduleSkipped = options.rateScheduleSkipped === true;
  if (returnedContractId && returnedContractId !== contractId) {
    warnings.push({
      id: 'MTR-IDENTITY-002',
      severity: 'error',
      message: `Contract response id ${returnedContractId} does not match requested id ${contractId}.`,
      remediation: 'Stop and verify the Metronome contract identifier before using this output.',
    });
  }
  if (!customerId) {
    warnings.push({
      id: 'MTR-IDENTITY-005',
      severity: 'error',
      message: 'Contract response did not include customer_id; skipped contract edit-history and rate-schedule reads.',
      remediation: 'Fetch or provide the Metronome customer id before using this output to prove edit history, rate schedule, or override state.',
    });
  }
  if (rateScheduleSkipped) {
    return warnings;
  }
  if (!rateSchedule || normalizeList(rateSchedule).length === 0) {
    warnings.push({
      id: 'MTR-RATE-001',
      severity: 'warning',
      message: 'No rate schedule data was present in the inspected response.',
      remediation: 'Do not use this output to prove rate-card or override state until rate schedule data is present.',
    });
  }
  return warnings;
}

function buildBillingProviderInspectWarnings(customerId, parts) {
  const deliveryMethodWarnings = [];
  const verificationWarnings = [];
  const returnedCustomerId = customerIdFrom(parts.customer);
  if (returnedCustomerId && returnedCustomerId !== customerId) {
    verificationWarnings.push({
      id: 'MTR-IDENTITY-001',
      severity: 'error',
      message: `Customer response id ${returnedCustomerId} does not match requested id ${customerId}.`,
      remediation: 'Stop and verify the Metronome customer identifier before using this output.',
    });
  }

  const configs = normalizeList(parts.billingProviderConfigurations);
  if (configs.length === 0) {
    deliveryMethodWarnings.push({
      id: 'MTR-BILL-001',
      severity: 'warning',
      message: 'No billing provider configuration was present in the inspected response.',
      remediation: 'Treat invoice-producing workflows as blocked until billing provider state is verified.',
    });
    return { deliveryMethodWarnings, verificationWarnings };
  }

  const activeConfigs = configs.filter((config) => config?.archived !== true);
  if (activeConfigs.length > 1) {
    deliveryMethodWarnings.push({
      id: 'MTR-BILL-003',
      severity: 'warning',
      message: 'More than one active billing provider configuration was present.',
      remediation: 'Choose an explicit existingConfigPolicy before planning billing-provider attachment or invoice-producing workflows.',
    });
  }

  configs.forEach((config, index) => {
    const hasDeliveryMethod = typeof config?.delivery_method === 'string' && config.delivery_method.trim() !== '';
    const hasDeliveryMethodId = typeof config?.delivery_method_id === 'string' && config.delivery_method_id.trim() !== '';
    if (!hasDeliveryMethod && !hasDeliveryMethodId) {
      deliveryMethodWarnings.push({
        id: 'MTR-BILL-002',
        severity: 'warning',
        message: `Billing provider configuration at index ${index} has no delivery_method or delivery_method_id.`,
        remediation: 'Verify delivery behavior before planning invoice-producing workflows.',
      });
    }
    if (hasDeliveryMethod && hasDeliveryMethodId) {
      deliveryMethodWarnings.push({
        id: 'MTR-BILL-002',
        severity: 'warning',
        message: `Billing provider configuration at index ${index} has both delivery_method and delivery_method_id.`,
        remediation: 'Inspect the active Metronome configuration before relying on delivery method behavior.',
      });
    }
  });

  return { deliveryMethodWarnings, verificationWarnings };
}

function buildInvoiceInspectWarnings(invoiceId, invoice) {
  const warnings = [];
  const returnedInvoiceId = objectIdFrom(invoice);
  if (returnedInvoiceId && returnedInvoiceId !== invoiceId) {
    warnings.push({
      id: 'MTR-IDENTITY-003',
      severity: 'error',
      message: `Invoice response id ${returnedInvoiceId} does not match requested id ${invoiceId}.`,
      remediation: 'Stop and verify the Metronome invoice identifier before using this output.',
    });
  }
  const status = invoice?.status || invoice?.invoice?.status;
  if (status === 'FINALIZED') {
    warnings.push({
      id: 'MTR-INV-004',
      severity: 'warning',
      message: 'Invoice is finalized; voiding or regenerating can create Metronome and Stripe reconciliation work.',
      remediation: 'Review Stripe delivery/payment state before planning any invoice mutation.',
    });
  }
  return warnings;
}

function buildSubscriptionHistoryInspectWarnings(subscriptionId, parts) {
  const warnings = [];
  const historyItems = [
    ...normalizeList(parts.quantityHistory),
    ...normalizeList(parts.seatHistory),
  ];
  const mismatchedItem = historyItems.find((item) => {
    const itemSubscriptionId = item?.subscription_id || item?.subscriptionId;
    return itemSubscriptionId && itemSubscriptionId !== subscriptionId;
  });
  if (mismatchedItem) {
    warnings.push({
      id: 'MTR-IDENTITY-007',
      severity: 'error',
      message: 'Subscription history response included an item for a different subscription id.',
      remediation: 'Discard this output and rerun subscription history inspection against the intended subscription id.',
    });
  }
  return warnings;
}

async function executeEndpointPlan(endpointPlan, readClient) {
  if (!readClient || typeof readClient.request !== 'function') {
    throw new Error('MTR-CLIENT-002: Inspect execution requires a guarded read client.');
  }

  const responses = [];
  for (const endpoint of endpointPlan) {
    const response = await readClient.request(endpoint);
    responses.push({
      endpoint: {
        method: endpoint.method,
        path: endpoint.path,
      },
      response,
    });
  }
  return responses;
}

function validationResult(schemaVersion, tenant, idField, idValue, findings) {
  return {
    schemaVersion,
    tenant,
    [idField]: idValue,
    valid: false,
    findings,
  };
}

async function runCustomerBillingStateInspect(options = {}) {
  const { tenant, customerId, readClient } = options;
  const plan = buildInspectPlan('customer.billing-state', { customer_id: customerId }, { tenant });
  if (!plan || plan.valid === false) {
    return {
      schemaVersion: 'metro.customer.billing-state.validation.v1',
      tenant,
      customerId,
      valid: false,
      findings: plan?.findings || [],
    };
  }

  const responses = await executeEndpointPlan(plan.endpointPlan, readClient);
  const parts = {
    customer: dataOf(responses[0].response),
    billingProviderConfigurations: normalizeList(dataOf(responses[1].response)),
    contracts: normalizeList(dataOf(responses[2].response)),
    balances: normalizeList(dataOf(responses[3].response)),
    draftInvoices: normalizeList(dataOf(responses[4].response)),
    finalizedInvoices: normalizeList(dataOf(responses[5].response)),
  };

  return {
    schemaVersion: 'metro.customer.billing-state.v1',
    workflow: 'customer.billing-state',
    tenant,
    customerId,
    generatedFrom: 'metronome-cli/src/inspect/index.js',
    requestSummary: responses.map((item) => item.endpoint),
    ...parts,
    verificationWarnings: buildCustomerBillingStateWarnings(customerId, parts),
  };
}

async function runPackageInspect(options = {}) {
  const { tenant, packageAlias, readClient } = options;
  const plan = buildInspectPlan('package.inspect', { package_alias: packageAlias }, { tenant });
  if (!plan || plan.valid === false) {
    return validationResult(
      'metro.package.inspect.validation.v1',
      tenant,
      'packageAlias',
      packageAlias,
      plan?.findings || [],
    );
  }

  const listResponse = await readClient.request(plan.endpointPlan[0]);
  const allPackages = normalizeList(dataOf(listResponse));
  const packageMatches = allPackages.filter((item) => packageMatchesAlias(item, packageAlias));
  const selectedListItem = packageMatches[0] || null;
  const selectedPackageId = objectIdFrom(selectedListItem);
  const responses = [{
    endpoint: {
      method: plan.endpointPlan[0].method,
      path: plan.endpointPlan[0].path,
    },
    response: listResponse,
  }];

  let selectedPackage = selectedListItem;
  let contractsOnPackage = [];
  if (selectedPackageId) {
    const followUpEndpoints = plan.endpointPlan.slice(1).map((endpoint) => replaceTemplateValues(endpoint, {
      'package_id from list response': selectedPackageId,
    }));
    const followUpResponses = await executeEndpointPlan(followUpEndpoints, readClient);
    responses.push(...followUpResponses);
    selectedPackage = dataOf(followUpResponses[0].response);
    contractsOnPackage = normalizeList(dataOf(followUpResponses[1].response));
  }

  const parts = {
    packageMatches,
    selectedPackage,
    contractsOnPackage,
  };
  const warnings = buildPackageInspectWarnings(packageAlias, parts);

  return {
    schemaVersion: 'metro.package.inspect.v1',
    workflow: 'package.inspect',
    tenant,
    packageAlias,
    generatedFrom: 'metronome-cli/src/inspect/index.js',
    requestSummary: responses.map((item) => item.endpoint),
    ...parts,
    aliasResolutionWarnings: warnings.aliasResolutionWarnings,
    verificationWarnings: warnings.verificationWarnings,
  };
}

async function runProductInspect(options = {}) {
  const { tenant, productId, readClient } = options;
  const plan = buildInspectPlan('product.inspect', { product_id: productId }, { tenant });
  if (!plan || plan.valid === false) {
    return validationResult(
      'metro.product.inspect.validation.v1',
      tenant,
      'productId',
      productId,
      plan?.findings || [],
    );
  }

  const responses = await executeEndpointPlan(plan.endpointPlan, readClient);
  const product = dataOf(responses[0].response);
  const parts = {
    product,
    currentVersion: product?.current || product?.current_version || product?.currentVersion || null,
    initialVersion: product?.initial || product?.initial_version || product?.initialVersion || null,
    scheduledUpdates: normalizeList(product?.updates || product?.scheduled_updates || product?.scheduledUpdates),
    archivedAt: product?.archived_at || product?.archivedAt || null,
  };

  return {
    schemaVersion: 'metro.product.inspect.v1',
    workflow: 'product.inspect',
    tenant,
    productId,
    generatedFrom: 'metronome-cli/src/inspect/index.js',
    requestSummary: responses.map((item) => item.endpoint),
    ...parts,
    verificationWarnings: buildProductInspectWarnings(productId, parts),
  };
}

async function runContractInspect(options = {}) {
  const {
    tenant,
    contractId,
    at,
    coveringDate,
    readClient,
  } = options;
  const effectiveAt = at || coveringDate;
  const timeFindings = validateHourBoundaryTimestamp('at', effectiveAt);
  const plan = buildInspectPlan(
    'contract.inspect',
    { contract_id: contractId },
    {
      tenant,
      templateValues: {
        'hour-boundary timestamp': effectiveAt || '<hour-boundary timestamp>',
      },
    },
  );

  const findings = [
    ...(plan?.findings || []),
    ...timeFindings,
  ];
  if (!plan || findings.length > 0) {
    return validationResult('metro.contract.inspect.validation.v1', tenant, 'contractId', contractId, findings);
  }

  const responses = await executeEndpointPlan(plan.endpointPlan.slice(0, 1), readClient);
  const contract = dataOf(responses[0].response);
  const customerId = contract?.customer_id || contract?.customer?.id || null;

  let editHistory = [];
  let rateSchedule = null;
  if (customerId) {
    const followUpEndpoints = plan.endpointPlan.slice(1).map((endpoint) => replaceTemplateValues(endpoint, {
      'customer_id from contract get response': customerId,
    }));
    const followUpResponses = await executeEndpointPlan(followUpEndpoints, readClient);
    responses.push(...followUpResponses);
    editHistory = normalizeList(dataOf(followUpResponses[0].response));
    rateSchedule = dataOf(followUpResponses[1].response);
  } else {
    const [editHistoryEndpoint] = plan.endpointPlan.slice(1, 2);
    responses.push({
      endpoint: {
        method: editHistoryEndpoint.method,
        path: editHistoryEndpoint.path,
      },
      response: {
        skipped: true,
        reason: 'customer_id missing from contract get response',
      },
    });
  }

  if (customerId && !rateSchedule) {
    const [rateScheduleEndpoint] = plan.endpointPlan.slice(2);
    const [rateScheduleResponse] = await executeEndpointPlan([
      replaceTemplateValues(rateScheduleEndpoint, {
        'customer_id from contract get response': customerId,
      }),
    ], readClient);
    responses.push(rateScheduleResponse);
    rateSchedule = dataOf(rateScheduleResponse.response);
  }

  return {
    schemaVersion: 'metro.contract.inspect.v1',
    workflow: 'contract.inspect',
    tenant,
    contractId,
    at: effectiveAt,
    coveringDate: effectiveAt,
    generatedFrom: 'metronome-cli/src/inspect/index.js',
    requestSummary: responses.map((item) => item.endpoint),
    contract,
    customerId,
    rateCard: contract?.rate_card || contract?.rateCard || null,
    commits: normalizeList(contract?.commits),
    credits: normalizeList(contract?.credits),
    scheduledCharges: normalizeList(contract?.scheduled_charges || contract?.scheduledCharges),
    transitions: normalizeList(contract?.transitions),
    editHistory,
    rateSchedule,
    verificationWarnings: buildContractInspectWarnings(contractId, contract, rateSchedule, {
      customerId,
      rateScheduleSkipped: !customerId,
    }),
  };
}

async function runBillingProviderInspect(options = {}) {
  const { tenant, customerId, readClient } = options;
  const plan = buildInspectPlan('billing-provider.inspect', { customer_id: customerId }, { tenant });
  if (!plan || plan.valid === false) {
    return validationResult(
      'metro.billing-provider.inspect.validation.v1',
      tenant,
      'customerId',
      customerId,
      plan?.findings || [],
    );
  }

  const responses = await executeEndpointPlan(plan.endpointPlan, readClient);
  const parts = {
    customer: dataOf(responses[0].response),
    billingProviderConfigurations: normalizeList(dataOf(responses[1].response)),
  };
  const warnings = buildBillingProviderInspectWarnings(customerId, parts);

  return {
    schemaVersion: 'metro.billing-provider.inspect.v1',
    workflow: 'billing-provider.inspect',
    tenant,
    customerId,
    generatedFrom: 'metronome-cli/src/inspect/index.js',
    requestSummary: responses.map((item) => item.endpoint),
    ...parts,
    deliveryMethodWarnings: warnings.deliveryMethodWarnings,
    verificationWarnings: warnings.verificationWarnings,
  };
}

async function runInvoiceInspect(options = {}) {
  const { tenant, invoiceId, readClient } = options;
  const plan = buildInspectPlan('invoice.inspect', { invoice_id: invoiceId }, { tenant });
  if (!plan || plan.valid === false) {
    return validationResult(
      'metro.invoice.inspect.validation.v1',
      tenant,
      'invoiceId',
      invoiceId,
      plan?.findings || [],
    );
  }

  const responses = await executeEndpointPlan(plan.endpointPlan, readClient);
  const invoice = dataOf(responses[0].response);
  const payments = normalizeList(dataOf(responses[1].response));

  return {
    schemaVersion: 'metro.invoice.inspect.v1',
    workflow: 'invoice.inspect',
    tenant,
    invoiceId,
    generatedFrom: 'metronome-cli/src/inspect/index.js',
    requestSummary: responses.map((item) => item.endpoint),
    invoice,
    customerId: invoice?.customer_id || invoice?.customer?.id || null,
    contractId: invoice?.contract_id || invoice?.contract?.id || null,
    status: invoice?.status || null,
    type: invoice?.type || null,
    totals: invoice?.totals || {
      subtotal: invoice?.subtotal,
      total: invoice?.total,
    },
    lineItems: normalizeList(invoice?.line_items || invoice?.lineItems),
    payments,
    stripeReconciliationWarnings: buildInvoiceInspectWarnings(invoiceId, invoice),
  };
}

async function runSubscriptionHistoryInspect(options = {}) {
  const {
    tenant,
    customerId,
    contractId,
    subscriptionId,
    readClient,
  } = options;
  const plan = buildInspectPlan('subscription.history.inspect', {
    customer_id: customerId,
    contract_id: contractId,
    subscription_id: subscriptionId,
  }, { tenant });
  if (!plan || plan.valid === false) {
    return {
      schemaVersion: 'metro.subscription-history.inspect.validation.v1',
      tenant,
      customerId,
      contractId,
      subscriptionId,
      valid: false,
      findings: plan?.findings || [],
    };
  }

  const responses = await executeEndpointPlan(plan.endpointPlan, readClient);
  const parts = {
    quantityHistory: normalizeList(dataOf(responses[0].response)),
    seatHistory: normalizeList(dataOf(responses[1].response)),
  };

  return {
    schemaVersion: 'metro.subscription-history.inspect.v1',
    workflow: 'subscription.history.inspect',
    tenant,
    customerId,
    contractId,
    subscriptionId,
    generatedFrom: 'metronome-cli/src/inspect/index.js',
    requestSummary: responses.map((item) => item.endpoint),
    ...parts,
    verificationWarnings: buildSubscriptionHistoryInspectWarnings(subscriptionId, parts),
  };
}

module.exports = {
  buildInspectPlan,
  executeEndpointPlan,
  getInspectPlanDefinition,
  listInspectPlans,
  runBillingProviderInspect,
  runContractInspect,
  runCustomerBillingStateInspect,
  runInvoiceInspect,
  runPackageInspect,
  runProductInspect,
  runSubscriptionHistoryInspect,
  validateHourBoundaryTimestamp,
  validateIdentifier,
};
