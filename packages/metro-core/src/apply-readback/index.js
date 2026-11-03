'use strict';

const { validateAuditJsonl } = require('../audit');
const {
  buildWorkflowEvidenceBundles,
  getWorkflowApplyResultContract,
  workflowApplyResultKey,
} = require('../evidence-gates/apply-result-contracts');
const {
  FULL_TEMPLATE_PATH_SHAPE_IDS,
  isFullTemplatePathSupported,
  workflowForShapeId,
} = require('../evidence-gates/support');
const { verifyInspectOutput } = require('../verify/inspect-output');

const WORKFLOW_APPLY_READBACK_SCHEMA_VERSION = 'metro.workflow.apply-readback.v1';
const WORKFLOW_APPLY_READBACK_VERIFY_SCHEMA_VERSION = 'metro.workflow.apply-readback.verify.v1';

const SECRET_KEY_PATTERN = /(?:api[_-]?key|secret|token|authorization|password|private[_-]?key|bearer)/i;
const SECRET_KEY_ALLOWLIST = new Set(['keyFingerprint']);
const SECRET_VALUE_PATTERN = /(?:bearer\s+[A-Za-z0-9._-]+|sk_live_[A-Za-z0-9]+|sk_test_[A-Za-z0-9]+|rk_live_[A-Za-z0-9]+|prod_[A-Za-z0-9]{12,})/i;

const LOCAL_ONLY_LIVE_EXECUTION = {
  enabledInCurrentCli: false,
  reason: 'Workflow apply read-back verification is local evidence comparison only; the current CLI does not run live workflow apply or read commands.',
  nextSafeStep: 'Use workflow apply-readback verification to bind planned audit checks to verified inspect-output evidence. Future live apply success still requires a guarded runner, current-turn authorization, live audit rows, and semantic read-back execution.',
};

const INSPECT_WORKFLOWS_BY_APPLY_WORKFLOW = {
  'customer.setup:customer-setup': ['customer.billing-state', 'billing-provider.inspect'],
  'package.apply:pro-annual': ['package.inspect'],
  'credit.apply:complimentary-credit-grant': ['customer.billing-state', 'contract.inspect', 'invoice.inspect'],
  'credit.apply:paid-credit-top-up': ['customer.billing-state', 'contract.inspect', 'invoice.inspect', 'billing-provider.inspect'],
  'contract.move-plan.apply:package-plan-move-no-immediate-invoice': ['contract.inspect', 'customer.billing-state', 'package.inspect', 'invoice.inspect', 'billing-provider.inspect'],
  'contract.move-plan.apply:package-plan-move-immediate-invoice': ['contract.inspect', 'customer.billing-state', 'package.inspect', 'invoice.inspect', 'billing-provider.inspect'],
  'billing-provider.attach:stripe-billing-provider-attachment': ['billing-provider.inspect', 'customer.billing-state', 'invoice.inspect'],
  'custom-contract.create:enterprise-custom-contract': ['customer.billing-state', 'contract.inspect', 'billing-provider.inspect', 'invoice.inspect'],
  'invoice.issue-date-update:invoice-issue-date-update': ['invoice.inspect', 'contract.inspect', 'billing-provider.inspect'],
  'product.rate-retirement:product-rate-retirement': ['product.inspect', 'customer.billing-state', 'invoice.inspect'],
  'rate-card.dimensional.apply:dimensional-rate-card': ['product.inspect', 'customer.billing-state', 'invoice.inspect'],
  'package.archive:package-alias-archive-handoff': ['package.inspect', 'contract.inspect'],
  'usage.ingest-preview:usage-ingest-preview': ['customer.billing-state', 'invoice.inspect'],
  'subscription.contract.apply:direct-subscription-contract': ['contract.inspect', 'customer.billing-state', 'billing-provider.inspect', 'invoice.inspect', 'subscription.history.inspect'],
};

const EXPECTED_STATE_ASSERTION_PATHS_BY_INSPECT_WORKFLOW = {
  'billing-provider.inspect': [
    'billingProviderConfigurations[0].archived',
    'billingProviderConfigurations[0].billing_provider',
    'billingProviderConfigurations[0].delivery_method',
    'billingProviderConfigurations[0].id',
    'customer.id',
    'customer.name',
    'customerId',
  ],
  'contract.inspect': [
    'at',
    'contract.id',
    'contract.customer_id',
    'contract.rate_card.id',
    'contract.ending_before',
    'contract.starting_at',
    'contract.subscriptions[0].collection_schedule',
    'contract.subscriptions[0].name',
    'contract.subscriptions[0].proration.invoice_behavior',
    'contract.subscriptions[0].quantity_management_mode',
    'contract.subscriptions[0].seat_config.initial_seat_ids[0]',
    'contract.subscriptions[0].seat_config.initial_seat_ids[1]',
    'contract.subscriptions[0].seat_config.seat_group_key',
    'contract.subscriptions[0].starting_at',
    'contract.subscriptions[0].subscription_rate.billing_frequency',
    'contract.subscriptions[0].subscription_rate.product_id',
    'contractId',
    'customerId',
    'rateCard.id',
    'rateSchedule.rates[0].billing_frequency',
    'rateSchedule.rates[0].entitled',
    'rateSchedule.rates[0].product_id',
  ],
  'customer.billing-state': [
    'balances[0].balance',
    'balances[0].id',
    'billingProviderConfigurations[0].billing_provider',
    'billingProviderConfigurations[0].delivery_method',
    'billingProviderConfigurations[0].id',
    'contracts[0].customer_id',
    'contracts[0].id',
    'customer.id',
    'customer.name',
    'customerId',
    'draftInvoices[0].id',
    'draftInvoices[0].status',
    'finalizedInvoices[0].id',
    'finalizedInvoices[0].status',
  ],
  'invoice.inspect': [
    'contractId',
    'customerId',
    'invoice.contract_id',
    'invoice.customer_id',
    'invoice.id',
    'invoice.issue_date',
    'invoice.status',
    'invoice.total',
    'invoice.type',
    'invoiceId',
    'lineItems[0].id',
    'payments[0].id',
    'payments[0].status',
    'status',
    'totals.total',
    'type',
  ],
  'package.inspect': [
    'contractsOnPackage[0].customer_id',
    'contractsOnPackage[0].id',
    'contractsOnPackage[0].starting_at',
    'packageAlias',
    'packageMatches[0].id',
    'packageMatches[0].package_alias',
    'packageMatches[0].uniqueness_key',
    'selectedPackage.id',
    'selectedPackage.package_alias',
    'selectedPackage.rate_card_id',
    'selectedPackage.terms.billing_frequency',
    'selectedPackage.uniqueness_key',
  ],
  'product.inspect': [
    'archivedAt',
    'currentVersion.billable_metric_id',
    'currentVersion.name',
    'currentVersion.type',
    'initialVersion.name',
    'initialVersion.type',
    'product.current.billable_metric_id',
    'product.current.name',
    'product.current.type',
    'product.id',
    'productId',
    'scheduledUpdates[0].name',
    'scheduledUpdates[0].scheduled_at',
  ],
  'subscription.history.inspect': [
    'contractId',
    'customerId',
    'quantityHistory[0].quantity',
    'quantityHistory[0].starting_at',
    'quantityHistory[0].subscription_id',
    'seatHistory[0].seat_id',
    'seatHistory[0].starting_at',
    'seatHistory[0].subscription_id',
    'seatHistory[1].seat_id',
    'seatHistory[1].starting_at',
    'seatHistory[1].subscription_id',
    'subscriptionId',
  ],
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(object, key) {
  return object !== null && object !== undefined && Object.prototype.hasOwnProperty.call(object, key);
}

function filled(value) {
  return value !== undefined
    && value !== null
    && String(value).trim() !== ''
    && !/^<[^>]+>$/.test(String(value).trim());
}

function finding(id, severity, message, pathName, remediation, context) {
  return {
    id,
    severity,
    message,
    path: pathName,
    remediation,
    ...(context ? { context } : {}),
  };
}

function add(findings, id, message, pathName, remediation, severity = 'error', context = null) {
  findings.push(finding(id, severity, message, pathName, remediation, context));
}

function evidenceKey(workflow, shape) {
  return `${workflow}:${shape}`;
}

function allowedInspectWorkflows(workflow, shape) {
  return clone(INSPECT_WORKFLOWS_BY_APPLY_WORKFLOW[evidenceKey(workflow, shape)] || []);
}

function workflowApplyReadbackCoverage() {
  return FULL_TEMPLATE_PATH_SHAPE_IDS.reduce((coverage, shape) => {
    const workflow = workflowForShapeId(shape);
    const contract = getWorkflowApplyResultContract(workflow, shape);
    const bundle = contract
      ? buildWorkflowEvidenceBundles(
        workflowApplyResultKey(workflow, shape),
        workflow,
        shape,
        'production',
        contract,
      ).applyReadback
      : null;
    coverage[shape] = {
      schemaVersion: WORKFLOW_APPLY_READBACK_SCHEMA_VERSION,
      workflow,
      shape,
      supportStatus: contract ? 'local-apply-readback-verifier' : 'missing-apply-result-contract',
      command: contract
        ? 'metro apply-readback verify --audit <audit.jsonl> --inspect-output <inspect-output.json> [--inspect-outputs <inspect-output-a.json,inspect-output-b.json>] [--row <n>] [--json]'
        : null,
      apiAccess: 'none',
      applyEnabledInCurrentCli: false,
      readEnabledInCurrentCli: false,
      liveApplyAuthorizedByThisRecord: false,
      allowedInspectWorkflows: allowedInspectWorkflows(workflow, shape),
      requiresAudit: contract ? 'metro audit validate --file <audit.jsonl> [--json]' : null,
      requiresInspectOutput: contract ? 'metro verify inspect-output --file <inspect-output.json> [--json] for each read-back evidence file' : null,
      requiredEvidence: bundle ? clone(bundle.requiredEvidence) : [],
    };
    return coverage;
  }, {});
}

function parseAuditRows(text) {
  const rows = [];
  String(text || '').split(/\r?\n/).forEach((line, index) => {
    if (line.trim() === '') return;
    try {
      rows.push({ rowNumber: index + 1, row: JSON.parse(line) });
    } catch {
      rows.push({ rowNumber: index + 1, row: null });
    }
  });
  return rows;
}

function normalizeRowNumber(rowNumber, rowCount, findings) {
  if (rowNumber === undefined || rowNumber === null || rowNumber === '') {
    if (rowCount === 1) return 1;
    add(
      findings,
      'MTR-WORKFLOW-READBACK-002',
      'audit JSONL contains multiple rows; --row <n> is required.',
      'row',
      'Choose the 1-based workflow audit row number whose verification checks should be compared.',
    );
    return null;
  }

  const numeric = Number(rowNumber);
  if (!Number.isInteger(numeric) || numeric < 1) {
    add(
      findings,
      'MTR-WORKFLOW-READBACK-002',
      'row must be a positive 1-based integer.',
      'row',
      'Pass --row <n> using the audit JSONL line number.',
    );
    return null;
  }
  if (numeric > rowCount) {
    add(
      findings,
      'MTR-WORKFLOW-READBACK-002',
      `row ${numeric} is outside the audit JSONL row count ${rowCount}.`,
      'row',
      'Choose an existing audit JSONL line number.',
    );
    return null;
  }
  return numeric;
}

function tokens(value) {
  return new Set(
    String(value || '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 4),
  );
}

function intersect(left, right) {
  return [...left].filter((token) => right.has(token)).sort();
}

function collectSecretFindings(value, findings, pathName = '$') {
  if (typeof value === 'string') {
    if (SECRET_VALUE_PATTERN.test(value)) {
      add(
        findings,
        'MTR-SECRET-002',
        `Workflow apply-readback evidence appears to contain a secret-like value at ${pathName}.`,
        pathName,
        'Store environment variable names, hashes, object identifiers, and non-secret fingerprints only.',
      );
    }
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((child, index) => collectSecretFindings(child, findings, `${pathName}[${index}]`));
    return;
  }

  if (!isObject(value)) return;

  for (const [key, child] of Object.entries(value)) {
    const childPath = pathName === '$' ? key : `${pathName}.${key}`;
    if (SECRET_KEY_PATTERN.test(key) && !SECRET_KEY_ALLOWLIST.has(key)) {
      add(
        findings,
        'MTR-SECRET-001',
        `Workflow apply-readback evidence contains forbidden secret-shaped field ${childPath}.`,
        childPath,
        'Never store raw API keys, bearer tokens, passwords, Authorization headers, or secret values in read-back evidence.',
      );
    }
    collectSecretFindings(child, findings, childPath);
  }
}

function summarizeEndpoint(endpoint, index) {
  if (!endpoint) return null;
  return {
    id: `request-summary-${index + 1}`,
    type: 'request-summary',
    summary: `${endpoint.method || '<method>'} ${endpoint.path || '<path>'}`,
  };
}

function inspectEvidenceSnippets(inspectOutput) {
  const snippets = list(inspectOutput?.requestSummary)
    .map((endpoint, index) => summarizeEndpoint(endpoint, index))
    .filter(Boolean);

  if (inspectOutput?.workflow === 'package.inspect') {
    if (isObject(inspectOutput.selectedPackage)) {
      snippets.push({
        id: 'selected-package',
        type: 'package.inspect',
        summary: [
          `Package alias ${inspectOutput.selectedPackage.package_alias || inspectOutput.packageAlias || ''}`,
          `uniqueness key ${inspectOutput.selectedPackage.uniqueness_key || ''}`,
          `rate card ${inspectOutput.selectedPackage.rate_card_id || ''}`,
          `terms ${JSON.stringify(inspectOutput.selectedPackage.terms || {})}`,
        ].join(' ').trim(),
      });
    }
    snippets.push({
      id: 'package-match-count',
      type: 'package.inspect',
      summary: `Package inspect returned ${list(inspectOutput.packageMatches).length} package matches and ${list(inspectOutput.contractsOnPackage).length} contracts on package.`,
    });
  } else if (inspectOutput?.workflow === 'customer.billing-state') {
    snippets.push({
      id: 'customer-billing-state',
      type: 'customer.billing-state',
      summary: `Customer ${inspectOutput.customerId || ''} has ${list(inspectOutput.contracts).length} contracts, ${list(inspectOutput.balances).length} balances, ${list(inspectOutput.draftInvoices).length} draft invoices, ${list(inspectOutput.finalizedInvoices).length} finalized invoices, and ${list(inspectOutput.billingProviderConfigurations).length} billing provider configurations.`,
    });
  } else if (inspectOutput?.workflow === 'contract.inspect') {
    snippets.push({
      id: 'contract-inspect',
      type: 'contract.inspect',
      summary: `Contract ${inspectOutput.contractId || ''} at ${inspectOutput.at || inspectOutput.coveringDate || ''} includes contract payload, edit history, and rate schedule evidence.`,
    });
  } else if (inspectOutput?.workflow === 'billing-provider.inspect') {
    snippets.push({
      id: 'billing-provider-inspect',
      type: 'billing-provider.inspect',
      summary: `Billing-provider inspect for customer ${inspectOutput.customerId || ''} returned ${list(inspectOutput.billingProviderConfigurations).length} billing provider configurations and customer identity evidence.`,
    });
  } else if (inspectOutput?.workflow === 'product.inspect') {
    snippets.push({
      id: 'product-inspect',
      type: 'product.inspect',
      summary: `Product ${inspectOutput.productId || ''} includes current version, initial version, scheduled updates, and archived state evidence.`,
    });
  } else if (inspectOutput?.workflow === 'invoice.inspect') {
    snippets.push({
      id: 'invoice-inspect',
      type: 'invoice.inspect',
      summary: `Invoice ${inspectOutput.invoiceId || ''} includes invoice payload, payment evidence, and Stripe reconciliation warnings.`,
    });
  } else if (inspectOutput?.workflow === 'subscription.history.inspect') {
    snippets.push({
      id: 'subscription-history-inspect',
      type: 'subscription.history.inspect',
      summary: `Subscription ${inspectOutput.subscriptionId || ''} includes ${list(inspectOutput.quantityHistory).length} quantity history rows and ${list(inspectOutput.seatHistory).length} seat history rows for contract ${inspectOutput.contractId || ''}.`,
    });
  }

  return snippets.filter((snippet) => filled(snippet.summary));
}

function normalizeInspectOutputEntries(options) {
  const entries = [];
  const addEntry = (entry, fallbackPath) => {
    if (entry === undefined || entry === null) return;
    if (isObject(entry) && Object.prototype.hasOwnProperty.call(entry, 'output')) {
      entries.push({
        output: entry.output,
        filePath: entry.filePath || entry.path || fallbackPath || null,
      });
      return;
    }
    entries.push({ output: entry, filePath: fallbackPath || null });
  };

  addEntry(options.inspectOutput, options.inspectOutputPath);
  list(options.inspectOutputs).forEach((entry) => addEntry(entry));

  if (entries.length === 0) {
    entries.push({ output: undefined, filePath: options.inspectOutputPath || null });
  }

  return entries.map((entry, index) => ({
    ...entry,
    index: index + 1,
    validation: verifyInspectOutput(entry.output),
  }));
}

function snippetsForInspectEntry(entry, includeInspectOutputMetadata) {
  return inspectEvidenceSnippets(entry.output).map((snippet) => {
    if (!includeInspectOutputMetadata) return snippet;
    return {
      ...snippet,
      inspectOutputIndex: entry.index,
      inspectOutputPath: entry.filePath,
      inspectWorkflow: entry.validation.workflow || entry.output?.workflow || null,
    };
  });
}

function summarizeInspectEntry(entry) {
  if (entry.validation.valid) {
    return {
      index: entry.index,
      filePath: entry.filePath,
      validation: clone(entry.validation),
      schemaVersion: entry.output.schemaVersion || null,
      workflow: entry.validation.workflow,
      tenant: entry.output.tenant,
      requestCount: entry.validation.summary?.requestCount || 0,
      warningCount: entry.validation.summary?.warningCount || 0,
    };
  }
  return {
    index: entry.index,
    filePath: entry.filePath,
    validation: clone(entry.validation),
  };
}

function addObservedObjectId(observed, entry, role, id, pathName) {
  if (!filled(role) || !filled(id)) return;
  observed.push({
    role,
    id: String(id),
    inspectOutputIndex: entry.index,
    inspectOutputPath: entry.filePath,
    inspectWorkflow: entry.validation.workflow || entry.output?.workflow || null,
    path: pathName,
  });
}

function addObservedObjectIdsFromArray(observed, entry, role, values, pathName) {
  list(values).forEach((value, index) => {
    addObservedObjectId(observed, entry, role, value?.id, `${pathName}[${index}].id`);
  });
}

function observedObjectIdsForInspectEntry(entry) {
  if (!entry.validation.valid) return [];
  const output = entry.output || {};
  const observed = [];
  const workflow = entry.validation.workflow || output.workflow;

  if (workflow === 'customer.billing-state') {
    addObservedObjectId(observed, entry, 'customer_id', output.customerId, 'customerId');
    addObservedObjectId(observed, entry, 'customer_id', output.customer?.id, 'customer.id');
    addObservedObjectIdsFromArray(observed, entry, 'billing_provider_config_id', output.billingProviderConfigurations, 'billingProviderConfigurations');
    addObservedObjectIdsFromArray(observed, entry, 'contract_id', output.contracts, 'contracts');
    addObservedObjectIdsFromArray(observed, entry, 'commit_id', output.balances, 'balances');
    addObservedObjectIdsFromArray(observed, entry, 'invoice_id', output.draftInvoices, 'draftInvoices');
    addObservedObjectIdsFromArray(observed, entry, 'invoice_id', output.finalizedInvoices, 'finalizedInvoices');
  } else if (workflow === 'package.inspect') {
    addObservedObjectId(observed, entry, 'package_alias', output.packageAlias, 'packageAlias');
    addObservedObjectId(observed, entry, 'package_id', output.selectedPackage?.id, 'selectedPackage.id');
    addObservedObjectId(observed, entry, 'package_alias', output.selectedPackage?.package_alias, 'selectedPackage.package_alias');
    addObservedObjectId(observed, entry, 'rate_card_id', output.selectedPackage?.rate_card_id, 'selectedPackage.rate_card_id');
    addObservedObjectIdsFromArray(observed, entry, 'package_id', output.packageMatches, 'packageMatches');
    list(output.packageMatches).forEach((value, index) => {
      addObservedObjectId(observed, entry, 'package_alias', value?.package_alias, `packageMatches[${index}].package_alias`);
    });
    addObservedObjectIdsFromArray(observed, entry, 'contract_id', output.contractsOnPackage, 'contractsOnPackage');
    list(output.contractsOnPackage).forEach((value, index) => {
      addObservedObjectId(observed, entry, 'customer_id', value?.customer_id, `contractsOnPackage[${index}].customer_id`);
    });
  } else if (workflow === 'contract.inspect') {
    addObservedObjectId(observed, entry, 'contract_id', output.contractId, 'contractId');
    addObservedObjectId(observed, entry, 'contract_id', output.contract?.id, 'contract.id');
    addObservedObjectId(observed, entry, 'customer_id', output.customerId, 'customerId');
    addObservedObjectId(observed, entry, 'customer_id', output.contract?.customer_id, 'contract.customer_id');
  } else if (workflow === 'billing-provider.inspect') {
    addObservedObjectId(observed, entry, 'customer_id', output.customerId, 'customerId');
    addObservedObjectId(observed, entry, 'customer_id', output.customer?.id, 'customer.id');
    addObservedObjectIdsFromArray(observed, entry, 'billing_provider_config_id', output.billingProviderConfigurations, 'billingProviderConfigurations');
  } else if (workflow === 'product.inspect') {
    addObservedObjectId(observed, entry, 'product_id', output.productId, 'productId');
    addObservedObjectId(observed, entry, 'product_id', output.product?.id, 'product.id');
    addObservedObjectId(observed, entry, 'billable_metric_id', output.currentVersion?.billable_metric_id, 'currentVersion.billable_metric_id');
    addObservedObjectId(observed, entry, 'billable_metric_id', output.product?.current?.billable_metric_id, 'product.current.billable_metric_id');
  } else if (workflow === 'invoice.inspect') {
    addObservedObjectId(observed, entry, 'invoice_id', output.invoiceId, 'invoiceId');
    addObservedObjectId(observed, entry, 'invoice_id', output.invoice?.id, 'invoice.id');
    addObservedObjectId(observed, entry, 'customer_id', output.customerId, 'customerId');
    addObservedObjectId(observed, entry, 'customer_id', output.invoice?.customer_id, 'invoice.customer_id');
    addObservedObjectId(observed, entry, 'contract_id', output.contractId, 'contractId');
    addObservedObjectId(observed, entry, 'contract_id', output.invoice?.contract_id, 'invoice.contract_id');
  } else if (workflow === 'subscription.history.inspect') {
    addObservedObjectId(observed, entry, 'customer_id', output.customerId, 'customerId');
    addObservedObjectId(observed, entry, 'contract_id', output.contractId, 'contractId');
    addObservedObjectId(observed, entry, 'subscription_id', output.subscriptionId, 'subscriptionId');
  }

  return observed;
}

function dedupeObjectIds(values) {
  const seen = new Set();
  return values.filter((value) => {
    const key = `${value.source || ''}:${value.role}:${value.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function expectedObjectIdsFromAuditRow(selectedRow) {
  if (!selectedRow) return [];
  return dedupeObjectIds([
    ...list(selectedRow.targetIds).map((item) => ({
      source: 'targetIds',
      system: item?.system || null,
      role: item?.role || null,
      id: item?.id || null,
    })),
    ...list(selectedRow.responseObjectIds).map((item) => ({
      source: 'responseObjectIds',
      system: item?.system || null,
      role: item?.role || null,
      id: item?.id || null,
    })),
  ].filter((item) => item.system === 'metronome' && filled(item.role) && filled(item.id)));
}

function compareExpectedObjectIds(selectedRow, inspectEntries) {
  const expected = expectedObjectIdsFromAuditRow(selectedRow);
  const observed = inspectEntries.flatMap((entry) => observedObjectIdsForInspectEntry(entry));
  const observedRoles = new Set(observed.map((item) => item.role));
  const matches = [];
  const missing = [];
  const notObservable = [];

  expected.forEach((item) => {
    const matchingEvidence = observed.filter((observedItem) => (
      observedItem.role === item.role && observedItem.id === item.id
    ));
    if (matchingEvidence.length > 0) {
      matches.push({
        ...item,
        evidence: matchingEvidence,
      });
    } else if (observedRoles.has(item.role)) {
      missing.push({
        ...item,
        reason: 'role_observed_but_expected_id_missing',
      });
    } else {
      notObservable.push({
        ...item,
        reason: 'role_not_observable_from_provided_inspect_outputs',
      });
    }
  });

  return {
    schemaVersion: 'metro.workflow.expected-state-comparison.v1',
    status: missing.length > 0 ? 'blocked' : 'matched_or_not_observable',
    semanticApplySuccessProven: false,
    expectedObjectIds: expected,
    observedObjectIds: dedupeObjectIds(observed),
    matches,
    missing,
    notObservable,
    summary: {
      expectedCount: expected.length,
      observedCount: dedupeObjectIds(observed).length,
      matchedCount: matches.length,
      missingCount: missing.length,
      notObservableCount: notObservable.length,
    },
    note: 'This compares non-secret object identifiers from the selected audit row to verified inspect-output evidence. It can bind expected IDs to read-back evidence, but it still does not prove that a live apply happened or succeeded.',
  };
}

function pathSegments(pathName) {
  if (!filled(pathName)) return [];
  return String(pathName).split('.').flatMap((part) => {
    const segments = [];
    const pattern = /([^[\]]+)|\[(\d+)\]/g;
    let match;
    while ((match = pattern.exec(part)) !== null) {
      segments.push(match[1] !== undefined ? match[1] : Number(match[2]));
    }
    return segments;
  });
}

function readPath(value, pathName) {
  const segments = pathSegments(pathName);
  if (segments.length === 0) return { found: false, value: undefined };
  let current = value;
  for (const segment of segments) {
    if (typeof segment === 'number') {
      if (!Array.isArray(current) || segment >= current.length) {
        return { found: false, value: undefined };
      }
      current = current[segment];
      continue;
    }
    if (!isObject(current) || !hasOwn(current, segment)) {
      return { found: false, value: undefined };
    }
    current = current[segment];
  }
  return { found: true, value: current };
}

function stateValuesEqual(left, right) {
  if (left === right) return true;
  if (isObject(left) || isObject(right) || Array.isArray(left) || Array.isArray(right)) {
    return JSON.stringify(left) === JSON.stringify(right);
  }
  return false;
}

function expectedStateAssertionPathPolicy(record) {
  const allowedPaths = EXPECTED_STATE_ASSERTION_PATHS_BY_INSPECT_WORKFLOW[record.inspectWorkflow];
  if (!allowedPaths) {
    return {
      blocked: true,
      reason: 'inspect_workflow_not_allowlisted_for_expected_state_assertions',
      allowedPaths: [],
    };
  }
  if (!allowedPaths.includes(record.path)) {
    return {
      blocked: true,
      reason: 'path_not_allowlisted_for_inspect_workflow',
      allowedPaths,
    };
  }
  return {
    blocked: false,
    allowedPaths,
  };
}

function expectedStateAssertionRecordsFromAuditRow(selectedRow) {
  const assertions = [];
  const invalidAssertions = [];
  const pathPolicyViolations = [];
  if (!selectedRow) return { assertions, invalidAssertions, pathPolicyViolations };

  list(selectedRow.expectedStateAssertions).forEach((assertion, index) => {
    const source = 'expectedStateAssertions';
    if (!isObject(assertion)) {
      invalidAssertions.push({
        index,
        source,
        reasons: ['entry_must_be_object'],
      });
      return;
    }

    const operator = assertion.operator || 'equals';
    const record = {
      id: assertion.id || null,
      inspectWorkflow: assertion.inspectWorkflow || null,
      path: assertion.path || null,
      operator,
      expected: hasOwn(assertion, 'expected') ? assertion.expected : null,
      source,
    };
    const reasons = [];
    if (!filled(record.id)) reasons.push('id_required');
    if (!filled(record.inspectWorkflow)) reasons.push('inspectWorkflow_required');
    if (!filled(record.path)) reasons.push('path_required');
    if (!hasOwn(assertion, 'expected')) reasons.push('expected_required');
    if (operator !== 'equals') reasons.push('unsupported_operator');

    if (reasons.length > 0) {
      invalidAssertions.push({
        index,
        source,
        ...(filled(record.id) ? { id: record.id } : {}),
        ...(filled(record.inspectWorkflow) ? { inspectWorkflow: record.inspectWorkflow } : {}),
        ...(filled(record.path) ? { path: record.path } : {}),
        ...(filled(record.operator) ? { operator: record.operator } : {}),
        reasons,
      });
      return;
    }

    const pathPolicy = expectedStateAssertionPathPolicy(record);
    if (pathPolicy.blocked) {
      pathPolicyViolations.push({
        index,
        source,
        id: record.id,
        inspectWorkflow: record.inspectWorkflow,
        path: record.path,
        operator: record.operator,
        reason: pathPolicy.reason,
        allowedPaths: pathPolicy.allowedPaths,
      });
      return;
    }

    assertions.push(record);
  });

  return { assertions, invalidAssertions, pathPolicyViolations };
}

function compareExpectedStateAssertions(selectedRow, inspectEntries) {
  const { assertions, invalidAssertions, pathPolicyViolations } = expectedStateAssertionRecordsFromAuditRow(selectedRow);
  const matches = [];
  const failed = [];
  const notObservable = [];

  assertions.forEach((assertion) => {
    const workflowEntries = inspectEntries.filter((entry) => (
      entry.validation.valid
      && (entry.validation.workflow || entry.output?.workflow) === assertion.inspectWorkflow
    ));
    if (workflowEntries.length === 0) {
      notObservable.push({
        ...assertion,
        reason: 'inspect_workflow_not_provided',
      });
      return;
    }

    const observed = workflowEntries
      .map((entry) => {
        const read = readPath(entry.output, assertion.path);
        return {
          found: read.found,
          value: read.value,
          inspectOutputIndex: entry.index,
          inspectOutputPath: entry.filePath,
          inspectWorkflow: entry.validation.workflow || entry.output?.workflow || null,
          path: assertion.path,
        };
      })
      .filter((item) => item.found);

    if (observed.length === 0) {
      notObservable.push({
        ...assertion,
        reason: 'path_not_observed_in_provided_inspect_outputs',
      });
      return;
    }

    const matchingEvidence = observed.filter((item) => stateValuesEqual(item.value, assertion.expected));
    if (matchingEvidence.length > 0) {
      matches.push({
        ...assertion,
        evidence: matchingEvidence,
      });
    } else {
      failed.push({
        ...assertion,
        observed,
        reason: 'observed_value_does_not_equal_expected',
      });
    }
  });

  return {
    schemaVersion: 'metro.workflow.expected-state-assertions.v1',
    status: invalidAssertions.length > 0 || pathPolicyViolations.length > 0 || failed.length > 0
      ? 'blocked'
      : (assertions.length > 0 ? 'matched_or_not_observable' : 'no_assertions_provided'),
    semanticApplySuccessProven: false,
    assertions,
    invalidAssertions,
    pathPolicyViolations,
    matches,
    failed,
    notObservable,
    summary: {
      assertionCount: assertions.length,
      invalidCount: invalidAssertions.length,
      pathPolicyViolationCount: pathPolicyViolations.length,
      matchedCount: matches.length,
      failedCount: failed.length,
      notObservableCount: notObservable.length,
    },
    note: 'This compares explicit expected state assertions from the selected audit row to verified inspect-output fields. Invalid assertion metadata, unreviewed assertion paths, and mismatched observed values block local verification. Matched assertions can bind reviewed state facts to read-back evidence, but still do not prove that a live apply happened or succeeded.',
  };
}

function compareCheckToInspectOutputs(check, inspectEntries) {
  const checkTokens = tokens(check?.expectation);
  const includeInspectOutputMetadata = inspectEntries.length > 1;
  const snippets = inspectEntries.flatMap((entry) => snippetsForInspectEntry(entry, includeInspectOutputMetadata)).map((snippet) => {
    const matchingTerms = intersect(checkTokens, tokens(snippet.summary));
    return {
      ...snippet,
      matchingTerms,
      matchCount: matchingTerms.length,
    };
  });
  const matches = snippets
    .filter((snippet) => snippet.matchCount > 0)
    .sort((a, b) => b.matchCount - a.matchCount || a.id.localeCompare(b.id))
    .slice(0, 3);

  return {
    id: check?.id || '<verification-check-id>',
    plannedStatus: check?.status || null,
    status: matches.length ? 'evidence_bound' : 'evidence_available_manual_review_required',
    expectation: check?.expectation || null,
    matchedInspectEvidence: matches.length ? matches : snippets.slice(0, 1),
    semanticApplySuccessProven: false,
    note: 'This comparison binds planned workflow verification expectations to verified inspect-output evidence only; it does not prove that a live apply happened or succeeded.',
  };
}

function workflowEvidenceBundle(selectedRow, valid) {
  const contract = getWorkflowApplyResultContract(selectedRow?.workflow, selectedRow?.shape);
  if (!contract) return null;
  const bundle = buildWorkflowEvidenceBundles(
    workflowApplyResultKey(selectedRow.workflow, selectedRow.shape),
    selectedRow.workflow,
    selectedRow.shape,
    selectedRow.tenant,
    contract,
  ).applyReadback;
  return {
    schemaVersion: bundle.schemaVersion,
    validationResult: valid ? 'passed' : 'blocked',
    readEnabledInCurrentCli: false,
    checkCount: list(selectedRow?.verification?.checks).length,
    semanticApplySuccessProvenByPrerequisites: false,
    providedEvidence: clone(bundle.requiredEvidence),
  };
}

function verifyWorkflowApplyReadback(options = {}) {
  const {
    auditText = '',
    auditPath = null,
    rowNumber = null,
  } = options;
  const findings = [];
  const auditValidation = validateAuditJsonl(auditText || '');
  const inspectEntries = normalizeInspectOutputEntries(options);
  const primaryInspectEntry = inspectEntries[0];
  const inspectValidation = primaryInspectEntry.validation;
  const inspectOutput = primaryInspectEntry.output;
  const rows = parseAuditRows(auditText || '');
  const selectedRowNumber = normalizeRowNumber(rowNumber, rows.length, findings);
  const selectedRow = selectedRowNumber ? rows.find((item) => item.rowNumber === selectedRowNumber)?.row || null : null;

  if (!auditValidation.valid) {
    findings.push(...auditValidation.findings.map((item) => ({ ...item, path: item.path || 'audit' })));
  }
  inspectEntries.forEach((entry) => {
    const pathPrefix = inspectEntries.length === 1 ? 'inspectOutput' : `inspectOutputs[${entry.index}]`;
    if (!entry.validation.valid) {
      findings.push(...entry.validation.findings.map((item) => ({ ...item, path: item.path || pathPrefix })));
    }
  });
  if (!selectedRow) {
    add(
      findings,
      'MTR-WORKFLOW-READBACK-001',
      'A valid workflow audit row is required for read-back comparison.',
      'audit',
      'Validate the audit JSONL and select an existing row.',
    );
  }

  collectSecretFindings(selectedRow, findings, 'audit.selectedRow');
  inspectEntries.forEach((entry) => {
    const pathPrefix = inspectEntries.length === 1 ? 'inspectOutput' : `inspectOutputs[${entry.index}]`;
    collectSecretFindings(entry.output, findings, pathPrefix);
  });

  if (selectedRow && !isFullTemplatePathSupported(selectedRow.workflow, selectedRow.shape)) {
    add(
      findings,
      'MTR-WORKFLOW-READBACK-003',
      'audit row workflow and shape are not a supported workflow apply pair.',
      'audit.workflow',
      'Use audit evidence generated for a supported future apply workflow.',
    );
  }
  if (selectedRow && selectedRow.mode !== 'apply') {
    add(
      findings,
      'MTR-WORKFLOW-READBACK-003',
      'audit row mode must be apply.',
      'audit.mode',
      'Use workflow apply audit rows for apply-readback evidence.',
    );
  }

  const allowedWorkflows = selectedRow ? allowedInspectWorkflows(selectedRow.workflow, selectedRow.shape) : [];
  inspectEntries.forEach((entry) => {
    const pathPrefix = inspectEntries.length === 1 ? 'inspectOutput' : `inspectOutputs[${entry.index}]`;
    if (selectedRow && entry.validation.valid && selectedRow.tenant !== entry.output.tenant) {
      add(
        findings,
        'MTR-TENANT-001',
        'audit tenant must match inspect-output tenant.',
        inspectEntries.length === 1 ? 'tenant' : `${pathPrefix}.tenant`,
        'Use read-back evidence from the same tenant as the planned workflow audit row.',
      );
    }
    if (
      selectedRow
      && entry.validation.valid
      && allowedWorkflows.length > 0
      && !allowedWorkflows.includes(entry.validation.workflow)
    ) {
      add(
        findings,
        'MTR-WORKFLOW-READBACK-004',
        `inspect output workflow ${entry.validation.workflow} is not approved read-back evidence for ${selectedRow.workflow} ${selectedRow.shape}.`,
        `${pathPrefix}.workflow`,
        'Use inspect-output evidence from one of the workflow shape approved inspect workflows.',
        'error',
        {
          workflow: selectedRow.workflow,
          shape: selectedRow.shape,
          inspectWorkflow: entry.validation.workflow,
          allowedInspectWorkflows: allowedWorkflows,
        },
      );
    }
  });

  const plannedChecks = list(selectedRow?.verification?.checks);
  if (selectedRow && plannedChecks.length === 0) {
    add(
      findings,
      'MTR-VERIFY-001',
      'selected audit row must contain verification.checks.',
      'audit.verification.checks',
      'Regenerate audit evidence from a workflow template with reviewed read-back checks.',
    );
  }
  inspectEntries.forEach((entry) => {
    const pathPrefix = inspectEntries.length === 1 ? 'inspectOutput' : `inspectOutputs[${entry.index}]`;
    if (entry.validation.valid && inspectEvidenceSnippets(entry.output).length === 0) {
      add(
        findings,
        'MTR-VERIFY-001',
        'inspect output evidence must include request summary or workflow evidence snippets.',
        pathPrefix,
        'Use a verified inspect-output file that carries read-only evidence.',
      );
    }
  });

  const expectedStateComparison = compareExpectedObjectIds(selectedRow, inspectEntries);
  if (selectedRow && expectedStateComparison.missing.length > 0) {
    add(
      findings,
      'MTR-WORKFLOW-READBACK-005',
      'read-back inspect evidence observes an expected object role but does not include the expected object id.',
      'expectedStateComparison.missing',
      'Use inspect-output evidence that includes the expected Metronome object IDs from the selected audit row, or mark roles as not observable only when the provided inspect workflows cannot observe them.',
      'error',
      {
        missing: expectedStateComparison.missing,
      },
    );
  }
  const expectedStateAssertionComparison = compareExpectedStateAssertions(selectedRow, inspectEntries);
  if (selectedRow && expectedStateAssertionComparison.invalidAssertions.length > 0) {
    add(
      findings,
      'MTR-WORKFLOW-READBACK-007',
      'selected audit row contains invalid expected state assertion metadata.',
      'expectedStateAssertionComparison.invalidAssertions',
      'Use expectedStateAssertions[] entries with id, inspectWorkflow, path, operator "equals", and an explicit expected value.',
      'error',
      {
        invalidAssertions: expectedStateAssertionComparison.invalidAssertions,
      },
    );
  }
  if (selectedRow && expectedStateAssertionComparison.pathPolicyViolations.length > 0) {
    add(
      findings,
      'MTR-WORKFLOW-READBACK-008',
      'selected audit row contains expected state assertion paths that are not approved for their inspect workflow.',
      'expectedStateAssertionComparison.pathPolicyViolations',
      'Use expectedStateAssertions[] paths from the reviewed allowlist for each inspect workflow, or extend the allowlist with source-linked inspect-output evidence and tests.',
      'error',
      {
        pathPolicyViolations: expectedStateAssertionComparison.pathPolicyViolations,
      },
    );
  }
  if (selectedRow && expectedStateAssertionComparison.failed.length > 0) {
    add(
      findings,
      'MTR-WORKFLOW-READBACK-006',
      'read-back inspect evidence contains an observed state value that does not match an expected state assertion.',
      'expectedStateAssertionComparison.failed',
      'Use inspect-output evidence that matches the expected state assertions from the selected audit row, or adjust the reviewed assertion when the expected state changed.',
      'error',
      {
        failed: expectedStateAssertionComparison.failed,
      },
    );
  }

  const valid = !findings.some((item) => item.severity === 'error');
  const comparedChecks = valid
    ? plannedChecks.map((check) => compareCheckToInspectOutputs(check, inspectEntries))
    : plannedChecks.map((check) => ({
      id: check?.id || '<verification-check-id>',
      status: 'blocked',
      expectation: check?.expectation || null,
      semanticApplySuccessProven: false,
    }));
  const evidenceBundle = workflowEvidenceBundle(selectedRow, valid);
  const inspectSummaries = inspectEntries.map((entry) => summarizeInspectEntry(entry));
  const compatibilityEntries = inspectEntries.map((entry) => {
    const inspectWorkflow = entry.validation.workflow || entry.output?.workflow || null;
    const tenant = entry.output?.tenant || null;
    const tenantMatches = Boolean(selectedRow && entry.validation.valid && selectedRow.tenant === tenant);
    const workflowAllowed = Boolean(entry.validation.valid && allowedWorkflows.includes(inspectWorkflow));
    return {
      index: entry.index,
      filePath: entry.filePath,
      inspectWorkflow,
      tenant,
      valid: entry.validation.valid,
      tenantMatches,
      workflowAllowed,
      compatible: tenantMatches && workflowAllowed,
    };
  });
  const compatibleInspectOutputs = compatibilityEntries.filter((entry) => entry.compatible).length;
  const readBackCompatible = compatibilityEntries.length > 0
    && compatibleInspectOutputs === compatibilityEntries.length;
  const inspectWorkflows = inspectEntries
    .map((entry) => entry.validation.workflow || entry.output?.workflow || null)
    .filter(Boolean);
  const inspectWarningCount = inspectEntries.reduce(
    (sum, entry) => sum + (entry.validation.summary?.warningCount || 0),
    0,
  );
  const multiInspectFields = inspectEntries.length > 1
    ? {
      inspectOutputCount: inspectEntries.length,
      inspectWorkflows,
      compatibleInspectOutputs,
    }
    : {};

  return {
    schemaVersion: WORKFLOW_APPLY_READBACK_VERIFY_SCHEMA_VERSION,
    generatedFrom: 'packages/metro-core/src/apply-readback/index.js',
    apiAccess: 'none',
    liveExecution: clone(LOCAL_ONLY_LIVE_EXECUTION),
    applyEnabledInCurrentCli: false,
    readEnabledInCurrentCli: false,
    liveApplyAuthorizedByThisRecord: false,
    valid,
    blocked: !valid,
    summary: {
      workflow: selectedRow?.workflow || null,
      shape: selectedRow?.shape || null,
      tenant: selectedRow?.tenant || inspectOutput?.tenant || null,
      inspectWorkflow: inspectValidation.workflow || inspectOutput?.workflow || null,
      ...multiInspectFields,
      auditRows: rows.length,
      selectedAuditRow: selectedRowNumber,
      plannedReadBackChecks: plannedChecks.length,
      evidenceBoundChecks: comparedChecks.filter((check) => check.status === 'evidence_bound').length,
      expectedObjectIdMatches: expectedStateComparison.summary.matchedCount,
      expectedObjectIdMissing: expectedStateComparison.summary.missingCount,
      expectedObjectIdsNotObservable: expectedStateComparison.summary.notObservableCount,
      expectedStateAssertionMatches: expectedStateAssertionComparison.summary.matchedCount,
      expectedStateAssertionFailures: expectedStateAssertionComparison.summary.failedCount,
      expectedStateAssertionInvalid: expectedStateAssertionComparison.summary.invalidCount,
      expectedStateAssertionPathPolicyViolations: expectedStateAssertionComparison.summary.pathPolicyViolationCount,
      expectedStateAssertionsNotObservable: expectedStateAssertionComparison.summary.notObservableCount,
      inspectWarningCount,
      semanticApplySuccessProven: false,
      liveApplyEnabledInCurrentCli: false,
      liveReadEnabledInCurrentCli: false,
    },
    audit: {
      filePath: auditPath,
      validation: {
        schemaVersion: auditValidation.schemaVersion,
        valid: auditValidation.valid,
        rowCount: auditValidation.rowCount,
      },
      selectedRow: selectedRow
        ? {
          rowNumber: selectedRowNumber,
          workflow: selectedRow.workflow,
          shape: selectedRow.shape,
          tenant: selectedRow.tenant,
          outcome: selectedRow.outcome,
          endpoint: clone(selectedRow.endpoint),
          previewHash: selectedRow.previewHash || null,
          requestBodyHash: selectedRow.requestBodyHash || null,
          responseObjectIds: clone(selectedRow.responseObjectIds || []),
          expectedStateAssertions: clone(selectedRow.expectedStateAssertions || []),
          verificationStatus: selectedRow.verification?.status || null,
        }
        : null,
    },
    inspectOutput: inspectValidation.valid
      ? {
        filePath: primaryInspectEntry.filePath,
        validation: clone(inspectValidation),
        schemaVersion: inspectOutput.schemaVersion || null,
        workflow: inspectValidation.workflow,
        tenant: inspectOutput.tenant,
        requestCount: inspectValidation.summary?.requestCount || 0,
        warningCount: inspectValidation.summary?.warningCount || 0,
      }
      : {
        filePath: primaryInspectEntry.filePath,
        validation: clone(inspectValidation),
      },
    ...(inspectEntries.length > 1 ? { inspectOutputs: inspectSummaries } : {}),
    readBackCompatibility: {
      workflow: selectedRow?.workflow || null,
      shape: selectedRow?.shape || null,
      inspectWorkflow: inspectValidation.workflow || inspectOutput?.workflow || null,
      ...(inspectEntries.length > 1 ? {
        inspectWorkflows,
        inspectOutputs: compatibilityEntries,
        compatibleInspectOutputs,
      } : {}),
      allowedInspectWorkflows: allowedWorkflows,
      compatible: readBackCompatible,
      note: 'Workflow read-back evidence must use an approved inspect-output workflow for the planned workflow shape; this is a local compatibility check only and does not run live reads.',
    },
    workflowEvidence: evidenceBundle,
    expectedStateComparison,
    expectedStateAssertionComparison,
    readBackComparison: {
      status: valid ? 'evidence_bound' : 'blocked',
      semanticApplySuccessProven: false,
      checks: comparedChecks,
      note: 'This token-overlap comparison verifies that planned workflow verification checks have reviewed inspect-output evidence available. expectedStateComparison and expectedStateAssertionComparison separately bind non-secret expected object IDs and reviewed state assertions to verified inspect-output evidence. None of these comparisons records apply success or failure because no guarded workflow apply runner exists in the current CLI.',
    },
    findings,
    nextSafeStep: valid
      ? 'Keep this local workflow apply-readback report with the audit and inspect-output evidence. Live workflow apply remains disabled and still needs guarded execution plus current-turn authorization.'
      : 'Fix the workflow audit JSONL and inspect-output evidence, then re-run metro apply-readback verify before treating read-back evidence as locally bound.',
    sources: [
      'docs/metronome-cli/one-goal.md',
      'docs/metronome-cli/VALIDATION_AND_GUARDRAILS.md',
      'packages/metro-core/src/audit/index.js',
      'packages/metro-core/src/verify/inspect-output.js',
      'packages/metro-core/src/apply-readback/index.js',
    ],
  };
}

module.exports = {
  INSPECT_WORKFLOWS_BY_APPLY_WORKFLOW,
  WORKFLOW_APPLY_READBACK_SCHEMA_VERSION,
  WORKFLOW_APPLY_READBACK_VERIFY_SCHEMA_VERSION,
  allowedInspectWorkflows,
  verifyWorkflowApplyReadback,
  workflowApplyReadbackCoverage,
};
