'use strict';

const { assertReadOnlyEndpoint } = require('../clients/metronome-read');

const VALID_TENANTS = new Set(['sandbox', 'production']);

const CONTRACTS = {
  'metro.customer.billing-state.v1': {
    workflow: 'customer.billing-state',
    requiredFields: [
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
    warningField: 'verificationWarnings',
  },
  'metro.package.inspect.v1': {
    workflow: 'package.inspect',
    requiredFields: [
      'tenant',
      'packageAlias',
      'requestSummary',
      'packageMatches',
      'selectedPackage',
      'contractsOnPackage',
      'aliasResolutionWarnings',
      'verificationWarnings',
    ],
    warningFields: ['aliasResolutionWarnings', 'verificationWarnings'],
  },
  'metro.billing-provider.inspect.v1': {
    workflow: 'billing-provider.inspect',
    requiredFields: [
      'tenant',
      'customerId',
      'requestSummary',
      'customer',
      'billingProviderConfigurations',
      'deliveryMethodWarnings',
      'verificationWarnings',
    ],
    warningFields: ['deliveryMethodWarnings', 'verificationWarnings'],
  },
  'metro.product.inspect.v1': {
    workflow: 'product.inspect',
    requiredFields: [
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
    warningField: 'verificationWarnings',
  },
  'metro.contract.inspect.v1': {
    workflow: 'contract.inspect',
    requiredFields: [
      'tenant',
      'contractId',
      'at',
      'requestSummary',
      'contract',
      'editHistory',
      'rateSchedule',
      'verificationWarnings',
    ],
    compatibilityAliases: [
      { field: 'coveringDate', canonicalField: 'at' },
    ],
    warningField: 'verificationWarnings',
  },
  'metro.invoice.inspect.v1': {
    workflow: 'invoice.inspect',
    requiredFields: [
      'tenant',
      'invoiceId',
      'requestSummary',
      'invoice',
      'payments',
      'stripeReconciliationWarnings',
    ],
    warningField: 'stripeReconciliationWarnings',
  },
  'metro.subscription-history.inspect.v1': {
    workflow: 'subscription.history.inspect',
    requiredFields: [
      'tenant',
      'customerId',
      'contractId',
      'subscriptionId',
      'requestSummary',
      'quantityHistory',
      'seatHistory',
      'verificationWarnings',
    ],
    warningField: 'verificationWarnings',
  },
};

function finding(id, severity, message, remediation) {
  return {
    id,
    severity,
    message,
    remediation,
  };
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function compatibilityAliasFor(contract, canonicalField) {
  return (contract.compatibilityAliases || []).find((alias) => alias.canonicalField === canonicalField) || null;
}

function hasRequiredFieldOrAlias(output, contract, field) {
  if (hasOwn(output, field)) return true;
  const alias = compatibilityAliasFor(contract, field);
  return alias ? hasOwn(output, alias.field) : false;
}

function objectIdFrom(value, nestedKey) {
  if (!value || typeof value !== 'object') return null;
  if (typeof value.id === 'string') return value.id;
  if (nestedKey && value[nestedKey] && typeof value[nestedKey].id === 'string') return value[nestedKey].id;
  return null;
}

function packageAliasFrom(value) {
  if (!value || typeof value !== 'object') return null;
  if (typeof value.package_alias === 'string') return value.package_alias;
  if (typeof value.packageAlias === 'string') return value.packageAlias;
  if (typeof value.alias === 'string') return value.alias;
  if (value.package && typeof value.package.package_alias === 'string') return value.package.package_alias;
  return null;
}

function normalizePackageUniquenessKey(value) {
  return typeof value === 'string' ? value.replace(/^package:/, '') : value;
}

function packageUniquenessKeyFrom(value) {
  if (!value || typeof value !== 'object') return null;
  if (typeof value.uniqueness_key === 'string') return value.uniqueness_key;
  if (typeof value.uniquenessKey === 'string') return value.uniquenessKey;
  if (value.package && typeof value.package.uniqueness_key === 'string') return value.package.uniqueness_key;
  return null;
}

function validateHourBoundaryTimestamp(fieldName, value) {
  if (typeof value !== 'string' || value.trim() === '') {
    return [finding(
      'MTR-TIME-001',
      'error',
      `${fieldName} is required.`,
      `Include ${fieldName} as an ISO UTC timestamp on an hour boundary.`,
    )];
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    return [finding(
      'MTR-TIME-002',
      'error',
      `${fieldName} must be an ISO UTC timestamp with millisecond precision.`,
      'Use a value like 2026-07-01T00:00:00.000Z.',
    )];
  }

  if (parsed.getUTCMinutes() !== 0 || parsed.getUTCSeconds() !== 0 || parsed.getUTCMilliseconds() !== 0) {
    return [finding(
      'MTR-TIME-003',
      'error',
      `${fieldName} must be on a UTC hour boundary.`,
      'Round the timestamp to HH:00:00.000Z.',
    )];
  }

  return [];
}

function validateWarnings(warnings, fieldName) {
  const findings = [];
  if (!Array.isArray(warnings)) {
    findings.push(finding(
      'MTR-VERIFY-002',
      'error',
      `${fieldName} must be an array.`,
      'Keep warning fields as arrays so machines can distinguish clean outputs from known caveats.',
    ));
    return findings;
  }

  warnings.forEach((warning, index) => {
    if (!warning || typeof warning !== 'object') {
      findings.push(finding(
        'MTR-VERIFY-003',
        'error',
        `${fieldName}[${index}] must be an object.`,
        'Use warning objects with id, severity, message, and remediation fields.',
      ));
      return;
    }
    for (const required of ['id', 'severity', 'message', 'remediation']) {
      if (typeof warning[required] !== 'string' || warning[required].trim() === '') {
        findings.push(finding(
          'MTR-VERIFY-004',
          'error',
          `${fieldName}[${index}].${required} is required.`,
          'Use complete warning objects so operators can act on the finding.',
        ));
      }
    }
  });

  return findings;
}

function validateRequestSummary(requestSummary) {
  const findings = [];
  if (!Array.isArray(requestSummary) || requestSummary.length === 0) {
    findings.push(finding(
      'MTR-VERIFY-005',
      'error',
      'requestSummary must be a non-empty array.',
      'Include the read endpoints used to produce the inspect output.',
    ));
    return findings;
  }

  requestSummary.forEach((endpoint, index) => {
    try {
      assertReadOnlyEndpoint(endpoint);
    } catch (error) {
      findings.push(finding(
        error.code || 'MTR-READ-ENDPOINT-000',
        'error',
        `requestSummary[${index}] is not a permitted read endpoint: ${error.message}`,
        'Inspect outputs may only be verified when their request summaries contain read-only endpoints.',
      ));
    }
  });

  return findings;
}

function warningIds(output, fieldName) {
  const warnings = Array.isArray(output[fieldName]) ? output[fieldName] : [];
  return new Set(warnings.map((warning) => warning.id).filter(Boolean));
}

function allWarningCount(output, contract) {
  const fields = contract?.warningFields || [contract?.warningField].filter(Boolean);
  return fields.reduce((count, fieldName) => (
    count + (Array.isArray(output[fieldName]) ? output[fieldName].length : 0)
  ), 0);
}

function verifyCustomer(output) {
  const findings = [];
  const customerId = objectIdFrom(output.customer, 'customer');
  if (customerId && customerId !== output.customerId) {
    findings.push(finding(
      'MTR-IDENTITY-001',
      'error',
      `Customer object id ${customerId} does not match output customerId ${output.customerId}.`,
      'Discard this output and rerun inspection against the intended customer id.',
    ));
  }
  return findings;
}

function verifyPackage(output) {
  const findings = [];
  if (!Array.isArray(output.packageMatches)) {
    findings.push(finding(
      'MTR-VERIFY-002',
      'error',
      'packageMatches must be an array.',
      'Keep package inspect output arrays intact so alias resolution can be verified.',
    ));
  }
  if (!Array.isArray(output.contractsOnPackage)) {
    findings.push(finding(
      'MTR-VERIFY-002',
      'error',
      'contractsOnPackage must be an array.',
      'Keep package inspect output arrays intact so contracts-on-package evidence can be verified.',
    ));
  }

  if (output.selectedPackage) {
    const alias = packageAliasFrom(output.selectedPackage);
    const uniquenessKey = normalizePackageUniquenessKey(packageUniquenessKeyFrom(output.selectedPackage));
    if (alias !== output.packageAlias && uniquenessKey !== output.packageAlias) {
      findings.push(finding(
        'MTR-IDENTITY-004',
        'error',
        'selectedPackage does not match output packageAlias by alias or normalized uniqueness key.',
        'Discard this output and rerun package inspection against the intended alias.',
      ));
    }
  }

  if (Array.isArray(output.packageMatches) && output.packageMatches.length === 0 && !warningIds(output, 'aliasResolutionWarnings').has('MTR-PKG-001')) {
    findings.push(finding(
      'MTR-PKG-001',
      'error',
      'Package inspect output has no packageMatches and no alias-resolution warning.',
      'Preserve the no-match warning so downstream workflows know not to rely on the output.',
    ));
  }

  return findings;
}

function verifyBillingProvider(output) {
  const findings = [];
  findings.push(...verifyCustomer({
    customerId: output.customerId,
    customer: output.customer,
  }));

  if (!Array.isArray(output.billingProviderConfigurations)) {
    findings.push(finding(
      'MTR-VERIFY-002',
      'error',
      'billingProviderConfigurations must be an array.',
      'Keep billing provider configurations as an array so delivery behavior can be verified.',
    ));
    return findings;
  }

  if (output.billingProviderConfigurations.length === 0 && !warningIds(output, 'deliveryMethodWarnings').has('MTR-BILL-001')) {
    findings.push(finding(
      'MTR-BILL-001',
      'error',
      'Billing-provider inspect output has no configurations and no missing-config warning.',
      'Preserve the missing-config warning so invoice-producing workflows remain blocked.',
    ));
  }

  const missingDeliveryMethod = output.billingProviderConfigurations.some((config) => {
    const hasDeliveryMethod = typeof config?.delivery_method === 'string' && config.delivery_method.trim() !== '';
    const hasDeliveryMethodId = typeof config?.delivery_method_id === 'string' && config.delivery_method_id.trim() !== '';
    return !hasDeliveryMethod && !hasDeliveryMethodId;
  });
  if (missingDeliveryMethod && !warningIds(output, 'deliveryMethodWarnings').has('MTR-BILL-002')) {
    findings.push(finding(
      'MTR-BILL-002',
      'error',
      'Billing-provider inspect output has a config without delivery method evidence and no warning.',
      'Preserve the delivery-method warning before using the output for invoice-producing workflows.',
    ));
  }

  return findings;
}

function verifyProduct(output) {
  const findings = [];
  const productId = objectIdFrom(output.product, 'product');
  if (productId && productId !== output.productId) {
    findings.push(finding(
      'MTR-IDENTITY-006',
      'error',
      `Product object id ${productId} does not match output productId ${output.productId}.`,
      'Discard this output and rerun product inspection against the intended product id.',
    ));
  }
  if (!Array.isArray(output.scheduledUpdates)) {
    findings.push(finding(
      'MTR-VERIFY-002',
      'error',
      'scheduledUpdates must be an array.',
      'Keep scheduled product updates as an array so product-version evidence can be verified.',
    ));
  }
  if (!output.currentVersion && !output.initialVersion && !warningIds(output, 'verificationWarnings').has('MTR-PRODUCT-001')) {
    findings.push(finding(
      'MTR-PRODUCT-001',
      'error',
      'Product inspect output has no currentVersion or initialVersion and no missing-version warning.',
      'Preserve the missing-version warning so downstream workflows know not to rely on product version evidence.',
    ));
  }
  return findings;
}

function verifyContract(output) {
  const findings = [];
  const effectiveAt = output.at || output.coveringDate;
  findings.push(...validateHourBoundaryTimestamp(output.at ? 'at' : 'coveringDate', effectiveAt));
  if (output.at && output.coveringDate && output.at !== output.coveringDate) {
    findings.push(finding(
      'MTR-TIME-005',
      'error',
      'Contract inspect output has conflicting at and coveringDate timestamps.',
      'Use one UTC hour-boundary timestamp value for both fields while coveringDate remains a compatibility alias.',
    ));
  }
  const contractId = objectIdFrom(output.contract, 'contract');
  if (contractId && contractId !== output.contractId) {
    findings.push(finding(
      'MTR-IDENTITY-002',
      'error',
      `Contract object id ${contractId} does not match output contractId ${output.contractId}.`,
      'Discard this output and rerun inspection against the intended contract id.',
    ));
  }
  return findings;
}

function verifyInvoice(output) {
  const findings = [];
  const invoiceId = objectIdFrom(output.invoice, 'invoice');
  if (invoiceId && invoiceId !== output.invoiceId) {
    findings.push(finding(
      'MTR-IDENTITY-003',
      'error',
      `Invoice object id ${invoiceId} does not match output invoiceId ${output.invoiceId}.`,
      'Discard this output and rerun inspection against the intended invoice id.',
    ));
  }

  if (output.status === 'FINALIZED' && !warningIds(output, 'stripeReconciliationWarnings').has('MTR-INV-004')) {
    findings.push(finding(
      'MTR-INV-004',
      'error',
      'Finalized invoice output is missing the required Stripe reconciliation warning.',
      'Preserve a warning that finalized invoice mutations can create Metronome and Stripe reconciliation work.',
    ));
  }

  return findings;
}

function historySubscriptionId(item) {
  if (!item || typeof item !== 'object') return null;
  if (typeof item.subscription_id === 'string') return item.subscription_id;
  if (typeof item.subscriptionId === 'string') return item.subscriptionId;
  return null;
}

function verifySubscriptionHistory(output) {
  const findings = [];
  if (!Array.isArray(output.quantityHistory)) {
    findings.push(finding(
      'MTR-VERIFY-002',
      'error',
      'quantityHistory must be an array.',
      'Keep quantity history as an array so direct subscription read-back can verify quantity evidence.',
    ));
  }
  if (!Array.isArray(output.seatHistory)) {
    findings.push(finding(
      'MTR-VERIFY-002',
      'error',
      'seatHistory must be an array.',
      'Keep seat history as an array so SEAT_BASED subscription read-back can verify named-seat evidence.',
    ));
  }

  if (Array.isArray(output.seatHistory)) {
    const nonApplicability = output.seatHistoryNotApplicable;
    if (output.seatHistory.length === 0) {
      if (!nonApplicability || typeof nonApplicability !== 'object' || Array.isArray(nonApplicability)) {
        findings.push(finding(
          'MTR-SUB-004',
          'error',
          'Empty seatHistory requires seatHistoryNotApplicable evidence.',
          'For QUANTITY_ONLY subscriptions, document seat history non-applicability with status and reason instead of leaving the gap implicit.',
        ));
      } else {
        if (nonApplicability.status !== 'not_applicable') {
          findings.push(finding(
            'MTR-SUB-004',
            'error',
            'seatHistoryNotApplicable.status must be not_applicable.',
            'Use seatHistoryNotApplicable.status = "not_applicable" when seat history is intentionally absent.',
          ));
        }
        if (typeof nonApplicability.reason !== 'string' || nonApplicability.reason.trim() === '') {
          findings.push(finding(
            'MTR-SUB-004',
            'error',
            'seatHistoryNotApplicable.reason is required.',
            'Explain why seat history is not applicable, for example QUANTITY_ONLY.',
          ));
        }
      }
    } else if (nonApplicability) {
      findings.push(finding(
        'MTR-SUB-004',
        'error',
        'seatHistoryNotApplicable conflicts with non-empty seatHistory.',
        'Remove non-applicability evidence when seat history rows are present.',
      ));
    }
  }

  [
    ...(Array.isArray(output.quantityHistory) ? output.quantityHistory : []),
    ...(Array.isArray(output.seatHistory) ? output.seatHistory : []),
  ].forEach((item) => {
    const itemSubscriptionId = historySubscriptionId(item);
    if (itemSubscriptionId && itemSubscriptionId !== output.subscriptionId) {
      findings.push(finding(
        'MTR-IDENTITY-007',
        'error',
        `Subscription history item id ${itemSubscriptionId} does not match output subscriptionId ${output.subscriptionId}.`,
        'Discard this output and rerun subscription history inspection against the intended subscription id.',
      ));
    }
  });

  return findings;
}

function verifyInspectOutput(output) {
  const findings = [];
  if (!output || typeof output !== 'object' || Array.isArray(output)) {
    return {
      schemaVersion: 'metro.verify.inspect-output.v1',
      inspectedSchemaVersion: null,
      workflow: null,
      valid: false,
      findings: [finding(
        'MTR-VERIFY-001',
        'error',
        'Inspect output must be a JSON object.',
        'Pass a JSON file produced by a supported metro inspect runner.',
      )],
      summary: {
        requestCount: 0,
        warningCount: 0,
      },
    };
  }

  const contract = CONTRACTS[output.schemaVersion];
  if (!contract) {
    findings.push(finding(
      'MTR-VERIFY-006',
      'error',
      `Unsupported inspect output schemaVersion: ${output.schemaVersion || '(missing)'}.`,
      `Use one of: ${Object.keys(CONTRACTS).join(', ')}.`,
    ));
  } else {
    for (const field of contract.requiredFields) {
      if (!hasRequiredFieldOrAlias(output, contract, field)) {
        findings.push(finding(
          'MTR-VERIFY-007',
          'error',
          `Inspect output missing required field: ${field}.`,
          'Keep inspect outputs complete so they can be used as verification evidence.',
        ));
      }
    }

    const warningFields = contract.warningFields || [contract.warningField];
    for (const warningField of warningFields) {
      findings.push(...validateWarnings(output[warningField], warningField));
    }
  }

  if (!VALID_TENANTS.has(output.tenant)) {
    findings.push(finding(
      'MTR-TENANT-001',
      'error',
      'Inspect output tenant must be sandbox or production.',
      'Rerun or reconstruct the output with an explicit tenant.',
    ));
  }

  findings.push(...validateRequestSummary(output.requestSummary));

  if (contract?.workflow === 'customer.billing-state') {
    findings.push(...verifyCustomer(output));
  } else if (contract?.workflow === 'package.inspect') {
    findings.push(...verifyPackage(output));
  } else if (contract?.workflow === 'billing-provider.inspect') {
    findings.push(...verifyBillingProvider(output));
  } else if (contract?.workflow === 'product.inspect') {
    findings.push(...verifyProduct(output));
  } else if (contract?.workflow === 'contract.inspect') {
    findings.push(...verifyContract(output));
  } else if (contract?.workflow === 'invoice.inspect') {
    findings.push(...verifyInvoice(output));
  } else if (contract?.workflow === 'subscription.history.inspect') {
    findings.push(...verifySubscriptionHistory(output));
  }

  const warningCount = contract ? allWarningCount(output, contract) : 0;

  return {
    schemaVersion: 'metro.verify.inspect-output.v1',
    inspectedSchemaVersion: output.schemaVersion || null,
    workflow: output.workflow || contract?.workflow || null,
    valid: !findings.some((item) => item.severity === 'error'),
    findings,
    summary: {
      tenant: output.tenant || null,
      requestCount: Array.isArray(output.requestSummary) ? output.requestSummary.length : 0,
      warningCount,
    },
  };
}

module.exports = {
  verifyInspectOutput,
};
