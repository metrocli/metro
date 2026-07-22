'use strict';

const NULL_SNAPSHOT_MARKDOWN = '# Tenant snapshot\n\n_No snapshot loaded. Run metro catalog bind --sandbox --write._\n';

const CATALOG_SCALAR_KEYS = [
  'creditTypeId',
  'dimensionalBillableMetricId',
  'sharedDimensionalProductId',
  'payloadMode',
  'fixedProductId',
  'seatProductId',
];

const INVENTORY_LISTS = [
  ['rateCards', 'rateCardCount'],
  ['products', 'productCount'],
  ['billableMetrics', 'billableMetricCount'],
  ['creditTypes', 'creditTypeCount'],
];

function mdEscapeCell(value) {
  return String(value == null ? '' : value)
    .replace(/\|/g, '\\|')
    .replace(/\n+/g, ' ')
    .trim();
}

function mdTable(headers, rows) {
  if (!rows.length) return '_none_\n';
  const head = `| ${headers.join(' | ')} |`;
  const sep = `| ${headers.map(() => '---').join(' | ')} |`;
  const body = rows.map((row) => `| ${row.map(mdEscapeCell).join(' | ')} |`).join('\n');
  return `${head}\n${sep}\n${body}\n`;
}

function renderScalar(value) {
  if (value == null || value === '') return '_unset_';
  return String(value);
}

function renderObjectMap(map) {
  if (!map || typeof map !== 'object' || !Object.keys(map).length) return '_none_\n';
  const rows = Object.entries(map).sort(([a], [b]) => a.localeCompare(b));
  return mdTable(['alias', 'id'], rows);
}

function itemLabel(row) {
  if (!row || typeof row !== 'object') return String(row);
  if (row.name != null && row.name !== '') return String(row.name);
  if (row.id != null && row.id !== '') return String(row.id);
  return '_unnamed_';
}

function renderInventoryList(rows, limit = 10) {
  if (!Array.isArray(rows) || !rows.length) return '_none_';
  const names = rows.slice(0, limit).map((row) => itemLabel(row));
  const suffix = rows.length > limit ? ` _(+${rows.length - limit} more)_` : '';
  return `${names.map((name) => `- ${name}`).join('\n')}${suffix}`;
}

function renderCatalog(catalog = {}) {
  const lines = CATALOG_SCALAR_KEYS.map(
    (key) => `- **${key}:** ${renderScalar(catalog[key])}`,
  );
  lines.push('');
  lines.push('**rateCardIds**');
  lines.push('');
  lines.push(renderObjectMap(catalog.rateCardIds).trimEnd());
  lines.push('');
  lines.push('**dimensionalProductIds**');
  lines.push('');
  lines.push(renderObjectMap(catalog.dimensionalProductIds).trimEnd());
  return `${lines.join('\n')}\n`;
}

function renderInventory(inventory = {}) {
  const lines = INVENTORY_LISTS.map(([listKey, countKey]) => {
    const count = inventory[countKey] ?? (Array.isArray(inventory[listKey]) ? inventory[listKey].length : 0);
    return `- **${countKey}:** ${count}`;
  });
  for (const [listKey] of INVENTORY_LISTS) {
    lines.push('');
    lines.push(`**${listKey}** (up to 10 names)`);
    lines.push('');
    lines.push(renderInventoryList(inventory[listKey]));
  }
  return `${lines.join('\n')}\n`;
}

function renderClassification(classification) {
  if (!classification || typeof classification !== 'object') {
    return '_Not classified yet._\n';
  }

  const lines = [
    `- **pattern:** ${renderScalar(classification.pattern)}`,
    `- **confidence:** ${renderScalar(classification.confidence)}`,
    '',
    '**reasons**',
    '',
  ];

  const reasons = Array.isArray(classification.reasons) ? classification.reasons : [];
  lines.push(reasons.length
    ? reasons.map((reason) => `- ${reason}`).join('\n')
    : '_none_');
  lines.push('');
  lines.push('**nextCommands**');
  lines.push('');

  const nextCommands = Array.isArray(classification.nextCommands) ? classification.nextCommands : [];
  lines.push(nextCommands.length
    ? nextCommands.map((command) => `- \`${command}\``).join('\n')
    : '_none_');

  return `${lines.join('\n')}\n`;
}

function renderAgentNotes(tenant = 'sandbox') {
  const tenantFlag = tenant === 'production' ? '--production' : '--sandbox';
  return [
    `- Prefer \`metro route --goal "<describe your billing goal>" ${tenantFlag} --json\` and \`metro docs explain credits.product.decision --markdown\` before ambiguous catalog writes.`,
    '- Snapshot presence does not authorize live apply; billable-metric and product **create** endpoints stay blocked in public v1.',
    '- Follow classification `nextCommands` when present; never treat them as apply approval.',
  ].join('\n');
}

function renderTenantSnapshotMarkdown(snapshot) {
  if (snapshot == null) return NULL_SNAPSHOT_MARKDOWN;

  const tenant = snapshot.tenant === 'production' ? 'production' : 'sandbox';
  const parts = [
    `# Tenant snapshot (${tenant})`,
    '',
    `- **schemaVersion:** ${renderScalar(snapshot.schemaVersion)}`,
    `- **capturedAt:** ${renderScalar(snapshot.capturedAt)}`,
    `- **sourceCommand:** ${renderScalar(snapshot.sourceCommand)}`,
    '',
    '## Catalog',
    '',
    renderCatalog(snapshot.catalog).trimEnd(),
    '',
    '## Inventory',
    '',
    renderInventory(snapshot.inventory).trimEnd(),
    '',
    '## Classification',
    '',
    renderClassification(snapshot.classification).trimEnd(),
    '',
    '## Agent notes',
    '',
    renderAgentNotes(tenant),
    '',
  ];

  return `${parts.join('\n')}\n`;
}

module.exports = {
  NULL_SNAPSHOT_MARKDOWN,
  renderTenantSnapshotMarkdown,
};
