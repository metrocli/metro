'use strict';

const { classifyAuditExportSummary } = require('./plan');
const { getWorkspaceModel, intentForAuditAction } = require('./model');

const AUDIT_EXPORT_SCHEMA_VERSION = 'metro.workspace.audit-export.v1';

const ACTION_NORMALIZATION = Object.freeze([
  [/create[_-]?contract/i, 'create_contract'],
  [/update[_-]?contract[_-]?end[_-]?date/i, 'update_contract_end_date'],
  [/edit[_-]?contract/i, 'edit_contract'],
  [/create[_-]?package/i, 'create_package'],
  [/archive[_-]?package/i, 'archive_package'],
  [/archive[_-]?contract/i, 'archive_contract'],
  [/create[_-]?billable[_-]?metric/i, 'create_billable_metric'],
  [/create[_-]?product/i, 'create_product_list_item'],
  [/manual[_-]?commit[_-]?ledger/i, 'add_manual_commit_ledger_entry'],
  [/billing[_-]?provider/i, 'insert_customer_billing_provider_configurations'],
  [/^update$/i, 'update'],
  [/^archive$/i, 'archive'],
]);

function normalizeAuditAction(action) {
  const raw = String(action || '').trim();
  if (!raw) return 'unknown';
  for (const [pattern, normalized] of ACTION_NORMALIZATION) {
    if (pattern.test(raw)) return normalized;
  }
  return raw.toLowerCase().replace(/[./-]+/g, '_');
}

function extractAuditRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.rows)) return payload.rows;
  return [];
}

function actorMatchesToken(row, token) {
  if (!token) return true;
  const needle = String(token).trim().toLowerCase();
  const haystacks = [
    row?.actor?.name,
    row?.actor?.email,
    row?.actor?.id,
    row?.request?.user_agent,
    row?.token,
    row?.api_token,
  ].filter(Boolean).map((value) => String(value).toLowerCase());

  return haystacks.some((value) => value.includes(needle));
}

function buildActionHistogram(rows) {
  const counts = {};
  for (const row of rows) {
    const action = normalizeAuditAction(row.action || row.event || row.type);
    counts[action] = (counts[action] || 0) + 1;
  }
  return counts;
}

function buildAuditExportClassify(input, options = {}) {
  const rows = extractAuditRows(input);
  const token = options.token || null;
  const filtered = token ? rows.filter((row) => actorMatchesToken(row, token)) : rows;
  const actionCounts = buildActionHistogram(filtered);
  const classifications = classifyAuditExportSummary(actionCounts);
  const workspace = getWorkspaceModel();

  const warnings = [];
  if (token && options.tenant === 'production' && String(token).toLowerCase() === 'sh-test') {
    warnings.push({
      id: 'MTR-WORKSPACE-001',
      message: 'sh-test is a sandbox token; classify under --sandbox not --prod.',
    });
  }
  if (token && options.tenant === 'sandbox' && String(token).toLowerCase() === 'sam-run') {
    warnings.push({
      id: 'MTR-WORKSPACE-002',
      message: 'sam-run is a production token; classify under --prod not --sandbox.',
    });
  }

  const topIntents = [];
  const seen = new Set();
  for (const entry of classifications) {
    if (!entry.recommendedIntent || seen.has(entry.recommendedIntent)) continue;
    seen.add(entry.recommendedIntent);
    topIntents.push(entry.recommendedIntent);
  }

  return {
    schemaVersion: AUDIT_EXPORT_SCHEMA_VERSION,
    apiAccess: 'none',
    mode: 'classify',
    tenant: options.tenant || null,
    token,
    rowCount: rows.length,
    filteredRowCount: filtered.length,
    actionCounts,
    classifications,
    topIntents,
    warnings,
    tokenConventions: workspace.apiTokenConventions,
    nextCommands: topIntents.slice(0, 3).map((intentId) => (
      `metro plan ${intentId}${options.tenant === 'sandbox' ? ' --sandbox' : options.tenant === 'production' ? ' --prod' : ''} --json`
    )),
    nextSafeStep: topIntents[0]
      ? `metro plan ${topIntents[0]}${options.tenant === 'sandbox' ? ' --sandbox' : options.tenant === 'production' ? ' --prod' : ''} --json`
      : 'metro plan list --json',
    sources: [
      'metronome-cli/src/workspace/audit-export.js',
      'metronome-cli/src/workspace/model.js',
    ],
  };
}

function buildAuditExportPlan(options = {}) {
  const token = options.token || null;
  const tenant = options.tenant || null;
  const workspace = getWorkspaceModel();

  const queryTemplate = {
    endpointId: 'security.getAuditLogs',
    query: {
      limit: options.limit || 200,
      sort: options.sort || 'date_desc',
      ...(options.startingOn ? { starting_on: options.startingOn } : {}),
      ...(options.endingBefore ? { ending_before: options.endingBefore } : {}),
    },
  };

  return {
    schemaVersion: AUDIT_EXPORT_SCHEMA_VERSION,
    apiAccess: 'read-planned',
    mode: 'plan',
    liveReadEnabledInCurrentCli: false,
    tenant,
    token,
    tokenConvention: tenant === 'production'
      ? workspace.apiTokenConventions.production
      : tenant === 'sandbox'
        ? workspace.apiTokenConventions.sandbox
        : null,
    pagination: {
      strategy: 'next_page cursor until empty; re-run with query.starting_on/ending_before windows for long histories',
      actorFilter: 'API has no actor/token filter - export pages then metro audit export classify --file <export.json> --token <name>',
    },
    readPlanTemplate: queryTemplate,
    workflow: [
      'metro api validate security.getAuditLogs --file <audit-query.json> --json',
      'metro api read-plan security.getAuditLogs --file <audit-query.json> (--sandbox|--prod) --json',
      'metro api read-gate template --read-plan <read-plan.json> --json',
      'Paginate live read when authorized; save JSON pages locally.',
      'metro audit export classify --file <merged-export.json> --token <name> (--sandbox|--prod) --json',
    ],
    classifyCommand: token
      ? `metro audit export classify --file <export.json> --token ${token}${tenant === 'sandbox' ? ' --sandbox' : tenant === 'production' ? ' --prod' : ''} --json`
      : 'metro audit export classify --file <export.json> --token <name> (--sandbox|--prod) --json',
    nextSafeStep: 'metro audit export classify --file <local-export.json> --json (no live API required)',
    sources: [
      'metronome-cli/src/workspace/audit-export.js',
      'metronome-cli/src/api-catalog/index.js',
    ],
  };
}

function summarizeAuditRowIntent(action) {
  const normalized = normalizeAuditAction(action);
  const intent = intentForAuditAction(normalized);
  return {
    action: normalized,
    recommendedIntent: intent?.id || null,
    note: intent ? intent.summary : 'No workspace intent mapped - review manually.',
  };
}

module.exports = {
  AUDIT_EXPORT_SCHEMA_VERSION,
  normalizeAuditAction,
  extractAuditRows,
  buildAuditExportClassify,
  buildAuditExportPlan,
  summarizeAuditRowIntent,
};
