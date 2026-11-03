'use strict';

const { getApiEndpoint, listApiEndpoints } = require('./index');
const { validateApiApplyAuditJsonl } = require('./apply-audit');
const { verifyApiReadResult } = require('./read-result');

const API_APPLY_READBACK_SCHEMA_VERSION = 'metro.api.apply-readback.v1';
const API_APPLY_READBACK_VERIFY_SCHEMA_VERSION = 'metro.api.apply-readback.verify.v1';

const LOCAL_ONLY_LIVE_EXECUTION = {
  enabledInCurrentCli: false,
  reason: 'Expert API apply read-back verification is local evidence comparison only; the current CLI does not run live expert API apply or read commands.',
  nextSafeStep: 'Use apply read-back verification to bind planned apply-audit checks to reviewed read-result evidence. Future live apply success still requires a guarded runner, current-turn authorization, live audit rows, and endpoint-specific read-back execution.',
};

const READBACK_ENDPOINTS_BY_WRITE_ENDPOINT = {
  'billingProvider.setCustomerConfigurations': ['billingProvider.getCustomerConfigurations', 'customers.get'],
  'contracts.create': ['contracts.get.v2', 'contracts.list.v2', 'invoices.listForCustomer', 'customerBalances.list', 'billingProvider.getCustomerConfigurations'],
  'contracts.edit.v2': ['contracts.get.v2', 'contracts.list.v2', 'customerBalances.list', 'commits.list', 'credits.list', 'invoices.listForCustomer', 'billingProvider.getCustomerConfigurations'],
  'contracts.updateEndDate': ['contracts.get.v2', 'contracts.list.v2', 'invoices.listForCustomer'],
  'contracts.updateInvoiceIssueDate': ['invoices.get', 'invoices.listForCustomer', 'contracts.get.v2', 'billingProvider.getCustomerConfigurations'],
  'customFields.addKey': ['customFields.listKeys'],
  'customFields.removeKey': ['customFields.listKeys'],
  'customFields.setValues': ['customFields.listKeys', 'contracts.get.v2', 'customers.get', 'commits.list', 'credits.list', 'invoices.get', 'products.get'],
  'customFields.deleteValues': ['customFields.listKeys', 'contracts.get.v2', 'customers.get', 'commits.list', 'credits.list', 'invoices.get', 'products.get'],
  'billableMetrics.create': ['billableMetrics.get', 'billableMetrics.list'],
  'billableMetrics.update': ['billableMetrics.get', 'billableMetrics.list'],
  'billableMetrics.archive': ['billableMetrics.get', 'billableMetrics.list'],
  'packages.archive': ['packages.get', 'packages.list'],
  'packages.create': ['packages.get', 'packages.list'],
  'products.create': ['products.get', 'products.list', 'billableMetrics.get', 'billableMetrics.list'],
  'products.update': ['products.get', 'products.list', 'billableMetrics.get', 'billableMetrics.list'],
  'products.archive': ['products.get', 'products.list', 'rateCards.getRateSchedule', 'rateCards.getRates'],
  'rateCards.create': ['rateCards.get', 'rateCards.list'],
  'rateCards.update': ['rateCards.get', 'rateCards.list'],
  'rateCards.archive': ['rateCards.get', 'rateCards.list', 'packages.get', 'packages.list', 'contracts.get.v2', 'contracts.list.v2'],
  'rateCards.setProductOrder': ['rateCards.getRateSchedule', 'rateCards.getRates', 'products.get', 'products.list', 'invoices.listForCustomer'],
  'rateCards.addRates': ['rateCards.getRateSchedule', 'rateCards.getRates', 'products.get', 'products.list', 'usage.groups'],
  'usage.ingest': ['events.search', 'usage.groups', 'usage.batch', 'invoices.listForCustomer', 'customerBalances.list'],
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

function allowedReadEndpointIds(endpointId) {
  return clone(READBACK_ENDPOINTS_BY_WRITE_ENDPOINT[endpointId] || []);
}

function parseApplyAuditRows(text) {
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
      'MTR-API-APPLY-READBACK-002',
      'apply-audit JSONL contains multiple rows; --row <n> is required.',
      'row',
      'Choose the 1-based apply-audit row number whose readBackVerification checks should be compared.',
    );
    return null;
  }

  const numeric = Number(rowNumber);
  if (!Number.isInteger(numeric) || numeric < 1) {
    add(
      findings,
      'MTR-API-APPLY-READBACK-002',
      'row must be a positive 1-based integer.',
      'row',
      'Pass --row <n> using the apply-audit JSONL line number.',
    );
    return null;
  }
  if (numeric > rowCount) {
    add(
      findings,
      'MTR-API-APPLY-READBACK-002',
      `row ${numeric} is outside the apply-audit JSONL row count ${rowCount}.`,
      'row',
      'Choose an existing apply-audit JSONL line number.',
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

function readEvidenceSnippets(readResult) {
  const snippets = [];
  const outputSummary = readResult?.verification?.outputContract?.summary;
  if (filled(outputSummary)) {
    snippets.push({
      id: 'output-contract',
      type: 'output-contract',
      summary: outputSummary,
    });
  }
  list(readResult?.verification?.checks).forEach((check, index) => {
    if (!filled(check?.expectation)) return;
    snippets.push({
      id: check.id || `read-result-check-${index + 1}`,
      type: check.mode || 'read-result-check',
      summary: check.expectation,
    });
  });
  return snippets;
}

function compareCheckToReadResult(check, readResult) {
  const checkTokens = tokens(check?.expectation);
  const snippets = readEvidenceSnippets(readResult).map((snippet) => {
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
    id: check?.id || '<read-back-check-id>',
    plannedStatus: check?.status || null,
    mode: check?.mode || null,
    status: matches.length ? 'evidence_bound' : 'evidence_available_manual_review_required',
    expectation: check?.expectation || null,
    matchedReadResultEvidence: matches.length ? matches : snippets.slice(0, 1),
    semanticApplySuccessProven: false,
    note: 'This comparison binds planned read-back expectations to mocked/read-result evidence only; it does not prove that a live apply happened or succeeded.',
  };
}

function endpointSnapshot(endpoint) {
  return endpoint
    ? {
      id: endpoint.id,
      method: endpoint.method,
      path: endpoint.path,
      family: endpoint.family,
      operationType: endpoint.operationType,
      permissionScope: endpoint.permissionScope,
      sourceIds: clone(endpoint.sourceIds),
    }
    : null;
}

function apiApplyReadbackCoverage() {
  return listApiEndpoints().reduce((coverage, endpoint) => {
    const isWriteEndpoint = endpoint.operationType === 'write';
    const allowedReadEndpoints = isWriteEndpoint ? allowedReadEndpointIds(endpoint.id) : [];
    coverage[endpoint.id] = {
      schemaVersion: API_APPLY_READBACK_SCHEMA_VERSION,
      supportStatus: isWriteEndpoint ? 'local-apply-readback-verifier' : 'not-write-endpoint',
      verificationCommand: isWriteEndpoint
        ? 'metro api apply-readback verify --apply-audit <api-apply-audit.jsonl> --read-result <api-read-result.json> [--row <n>] [--json]'
        : null,
      apiAccess: 'none',
      applyEnabledInCurrentCli: false,
      readEnabledInCurrentCli: false,
      liveApplyAuthorizedByThisRecord: false,
      allowedReadEndpointIds: allowedReadEndpoints,
      requiresApplyAudit: isWriteEndpoint ? 'metro api apply-audit validate --file <api-apply-audit.jsonl> [--json]' : null,
      requiresReadResult: isWriteEndpoint ? 'metro api read-result verify --file <api-read-result.json> [--json]' : null,
      requiredEvidence: isWriteEndpoint
        ? ['validated-apply-audit-jsonl', 'validated-read-result', 'matching-tenant', 'compatible-read-back-endpoint', 'read-back-checks', 'read-result-response-hash', 'semantic-apply-success-not-proven']
        : [],
    };
    return coverage;
  }, {});
}

function verifyApiApplyReadback(options = {}) {
  const {
    applyAuditText,
    applyAuditPath = null,
    readResult,
    readResultPath = null,
    rowNumber = null,
  } = options;
  const findings = [];
  const applyAuditValidation = validateApiApplyAuditJsonl(applyAuditText || '');
  const readResultValidation = verifyApiReadResult(readResult);
  const rows = parseApplyAuditRows(applyAuditText || '');
  const selectedRowNumber = normalizeRowNumber(rowNumber, rows.length, findings);
  const selectedRow = selectedRowNumber ? rows.find((item) => item.rowNumber === selectedRowNumber)?.row || null : null;

  if (!applyAuditValidation.valid) {
    findings.push(...applyAuditValidation.findings);
  }
  if (!readResultValidation.valid) {
    findings.push(...readResultValidation.findings);
  }
  if (!selectedRow) {
    add(
      findings,
      'MTR-API-APPLY-READBACK-001',
      'A valid apply-audit row is required for read-back comparison.',
      'applyAudit',
      'Validate the apply-audit JSONL and select an existing row.',
    );
  }

  const applyEndpoint = selectedRow ? getApiEndpoint(selectedRow.endpoint?.id) : null;
  const readEndpoint = readResultValidation.valid ? getApiEndpoint(readResult.endpoint?.id) : null;
  const allowedReadEndpoints = allowedReadEndpointIds(selectedRow?.endpoint?.id);

  if (selectedRow && (!applyEndpoint || applyEndpoint.operationType !== 'write')) {
    add(
      findings,
      'MTR-ENDPOINT-001',
      'The selected apply-audit row must reference a reviewed write endpoint.',
      'applyAudit.endpoint.id',
      'Use planned apply-audit evidence generated from a reviewed write endpoint.',
    );
  }
  if (readResultValidation.valid && (!readEndpoint || readEndpoint.operationType !== 'read')) {
    add(
      findings,
      'MTR-ENDPOINT-001',
      'readResult.endpoint.id must reference a reviewed read endpoint.',
      'readResult.endpoint.id',
      'Use a verified metro.api.read-result.v1 file for a reviewed read endpoint.',
    );
  }
  if (
    selectedRow
    && readResultValidation.valid
    && applyEndpoint
    && applyEndpoint.operationType === 'write'
    && readEndpoint
    && readEndpoint.operationType === 'read'
    && !allowedReadEndpoints.includes(readEndpoint.id)
  ) {
    add(
      findings,
      'MTR-API-APPLY-READBACK-004',
      `readResult.endpoint.id ${readEndpoint.id} is not an approved read-back endpoint for ${applyEndpoint.id}.`,
      'readResult.endpoint.id',
      'Use read-result evidence from one of the write endpoint\'s approved read-back endpoint IDs.',
      'error',
      {
        applyEndpointId: applyEndpoint.id,
        readEndpointId: readEndpoint.id,
        allowedReadEndpointIds: allowedReadEndpoints,
      },
    );
  }
  if (selectedRow && readResultValidation.valid && selectedRow.tenant !== readResult.tenant) {
    add(
      findings,
      'MTR-TENANT-001',
      'apply-audit tenant must match read-result tenant.',
      'tenant',
      'Use read-back evidence from the same tenant as the planned apply-audit row.',
    );
  }
  if (selectedRow && selectedRow.authorization?.currentTurnAuthorizationCaptured !== false) {
    add(
      findings,
      'MTR-API-APPLY-READBACK-003',
      'planned apply-audit rows must not capture current-turn authorization.',
      'applyAudit.authorization.currentTurnAuthorizationCaptured',
      'Keep durable planned evidence separate from current-turn live apply authorization.',
    );
  }
  if (selectedRow && (selectedRow.applyEnabledInCurrentCli !== false || selectedRow.liveApplyAuthorizedByThisRecord !== false)) {
    add(
      findings,
      'MTR-API-APPLY-READBACK-003',
      'planned apply-audit rows must keep live expert API apply disabled.',
      'applyAudit.applyEnabledInCurrentCli',
      'Do not use read-back evidence to enable or imply live apply support.',
    );
  }

  const plannedChecks = list(selectedRow?.readBackVerification?.checks);
  if (selectedRow && plannedChecks.length === 0) {
    add(
      findings,
      'MTR-VERIFY-001',
      'selected apply-audit row must contain readBackVerification.checks.',
      'applyAudit.readBackVerification.checks',
      'Regenerate apply-audit evidence from an approval record with reviewed read-back checks.',
    );
  }
  if (readResultValidation.valid && !filled(readResult.responseSummary?.responseHash)) {
    add(
      findings,
      'MTR-HASH-001',
      'read-result responseSummary.responseHash is required.',
      'readResult.responseSummary.responseHash',
      'Regenerate the read result from reviewed read evidence.',
    );
  }
  if (readResultValidation.valid && readEvidenceSnippets(readResult).length === 0) {
    add(
      findings,
      'MTR-VERIFY-001',
      'read-result evidence must include an output contract or verification checks.',
      'readResult.verification',
      'Use a verified read-result file that carries read-plan verification evidence.',
    );
  }

  const valid = !findings.some((item) => item.severity === 'error');
  const comparedChecks = valid
    ? plannedChecks.map((check) => compareCheckToReadResult(check, readResult))
    : plannedChecks.map((check) => ({
      id: check?.id || '<read-back-check-id>',
      status: 'blocked',
      expectation: check?.expectation || null,
      semanticApplySuccessProven: false,
    }));

  return {
    schemaVersion: API_APPLY_READBACK_VERIFY_SCHEMA_VERSION,
    generatedFrom: 'packages/metro-core/src/api-catalog/apply-readback.js',
    apiAccess: 'none',
    liveExecution: clone(LOCAL_ONLY_LIVE_EXECUTION),
    applyEnabledInCurrentCli: false,
    readEnabledInCurrentCli: false,
    liveApplyAuthorizedByThisRecord: false,
    valid,
    blocked: !valid,
    summary: {
      applyEndpointId: selectedRow?.endpoint?.id || null,
      readEndpointId: readResult?.endpoint?.id || null,
      tenant: selectedRow?.tenant || readResult?.tenant || null,
      applyAuditRows: rows.length,
      selectedApplyAuditRow: selectedRowNumber,
      plannedReadBackChecks: plannedChecks.length,
      evidenceBoundChecks: comparedChecks.filter((check) => check.status === 'evidence_bound').length,
      readResultResponseHash: readResult?.responseSummary?.responseHash || null,
      allowedReadEndpointIds: allowedReadEndpoints,
      semanticApplySuccessProven: false,
      liveApplyEnabledInCurrentCli: false,
      liveReadEnabledInCurrentCli: false,
    },
    applyAudit: {
      filePath: applyAuditPath,
      validation: {
        schemaVersion: applyAuditValidation.schemaVersion,
        valid: applyAuditValidation.valid,
        rowCount: applyAuditValidation.rowCount,
        summary: clone(applyAuditValidation.summary),
      },
      selectedRow: selectedRow
        ? {
          rowNumber: selectedRowNumber,
          endpoint: endpointSnapshot(applyEndpoint || selectedRow.endpoint),
          tenant: selectedRow.tenant,
          outcome: selectedRow.outcome,
          apiAccess: selectedRow.apiAccess,
          requestHash: selectedRow.requestSummary?.requestHash || null,
          payloadHash: selectedRow.requestSummary?.payloadHash || null,
          approvalId: selectedRow.approvalRecord?.approvalId || null,
          applyGateFileHash: selectedRow.applyGate?.fileHash || null,
          readBackStatus: selectedRow.readBackVerification?.status || null,
          currentTurnAuthorizationCaptured: selectedRow.authorization?.currentTurnAuthorizationCaptured ?? null,
        }
        : null,
    },
    readResult: readResultValidation.valid
      ? {
        filePath: readResultPath,
        validation: clone(readResultValidation),
        endpoint: endpointSnapshot(readEndpoint),
        tenant: readResult.tenant,
        transportMode: readResult.transportMode,
        requestHash: readResult.requestSummary?.requestHash || null,
        responseHash: readResult.responseSummary?.responseHash || null,
        responseDataType: readResult.responseSummary?.dataType || null,
        outputContractSummary: readResult.verification?.outputContract?.summary || null,
        verificationCheckCount: list(readResult.verification?.checks).length,
        readPlanFileHash: readResult.readGateValidation?.summary?.readPlanFileHash || null,
      }
      : {
        filePath: readResultPath,
        validation: clone(readResultValidation),
      },
    readBackCompatibility: {
      applyEndpointId: selectedRow?.endpoint?.id || null,
      readEndpointId: readResult?.endpoint?.id || null,
      allowedReadEndpointIds: allowedReadEndpoints,
      compatible: Boolean(readEndpoint && allowedReadEndpoints.includes(readEndpoint.id)),
      note: 'Read-back evidence must use an endpoint approved for the planned write endpoint; this is a local compatibility check only and does not run live reads.',
    },
    readBackComparison: {
      status: valid ? 'evidence_bound' : 'blocked',
      semanticApplySuccessProven: false,
      checks: comparedChecks,
      note: 'This verifies that planned read-back checks have reviewed read-result evidence available. It intentionally does not record apply success or failure because no guarded apply-result runner exists in the current CLI.',
    },
    findings,
    nextSafeStep: valid
      ? 'Keep this local apply-readback report with the planned apply-audit and read-result evidence. Live expert API apply remains disabled and still needs guarded execution plus current-turn authorization.'
      : 'Fix the apply-audit JSONL and read-result evidence, then re-run metro api apply-readback verify before treating read-back evidence as locally bound.',
    sources: [
      'docs/metronome-cli/one-goal.md',
      'docs/metronome-cli/VALIDATION_AND_GUARDRAILS.md',
      'packages/metro-core/src/api-catalog/apply-audit.js',
      'packages/metro-core/src/api-catalog/read-result.js',
      ...list(selectedRow?.endpoint?.sourceIds),
      ...list(readResult?.sources),
    ],
  };
}

module.exports = {
  API_APPLY_READBACK_SCHEMA_VERSION,
  API_APPLY_READBACK_VERIFY_SCHEMA_VERSION,
  READBACK_ENDPOINTS_BY_WRITE_ENDPOINT,
  allowedReadEndpointIds,
  apiApplyReadbackCoverage,
  verifyApiApplyReadback,
};
