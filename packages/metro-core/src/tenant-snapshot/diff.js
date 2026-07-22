'use strict';

function scalarDiff(before, after, keys) {
  const changed = [];
  for (const key of keys) {
    const a = before?.[key] ?? null;
    const b = after?.[key] ?? null;
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      changed.push({ key, before: a, after: b });
    }
  }
  return changed;
}

function mapKeyDiff(beforeMap = {}, afterMap = {}) {
  const beforeKeys = new Set(Object.keys(beforeMap || {}));
  const afterKeys = new Set(Object.keys(afterMap || {}));
  const added = [...afterKeys].filter((k) => !beforeKeys.has(k));
  const removed = [...beforeKeys].filter((k) => !afterKeys.has(k));
  const changed = [...beforeKeys].filter((k) => afterKeys.has(k)
    && String(beforeMap[k]) !== String(afterMap[k]));
  return { added, removed, changed };
}

function countDelta(before, after, key) {
  return (after?.[key] ?? 0) - (before?.[key] ?? 0);
}

/**
 * Compare two metro.tenant.snapshot.v1 objects (pure).
 */
function diffTenantSnapshots(before, after, options = {}) {
  const left = before || null;
  const right = after || null;
  return {
    schemaVersion: 'metro.tenant.snapshot.diff.v1',
    mode: options.mode || 'compare',
    before: left ? {
      tenant: left.tenant,
      capturedAt: left.capturedAt || null,
      pattern: left.classification?.pattern || null,
    } : null,
    after: right ? {
      tenant: right.tenant,
      capturedAt: right.capturedAt || null,
      pattern: right.classification?.pattern || null,
    } : null,
    catalog: {
      scalars: scalarDiff(left?.catalog, right?.catalog, [
        'creditTypeId',
        'dimensionalBillableMetricId',
        'sharedDimensionalProductId',
        'fixedProductId',
        'seatProductId',
        'payloadMode',
      ]),
      rateCardIds: mapKeyDiff(left?.catalog?.rateCardIds, right?.catalog?.rateCardIds),
      dimensionalProductIds: mapKeyDiff(
        left?.catalog?.dimensionalProductIds,
        right?.catalog?.dimensionalProductIds,
      ),
    },
    inventory: {
      rateCardCountDelta: countDelta(left?.inventory, right?.inventory, 'rateCardCount'),
      productCountDelta: countDelta(left?.inventory, right?.inventory, 'productCount'),
      billableMetricCountDelta: countDelta(left?.inventory, right?.inventory, 'billableMetricCount'),
      creditTypeCountDelta: countDelta(left?.inventory, right?.inventory, 'creditTypeCount'),
    },
    classification: {
      before: left?.classification?.pattern || null,
      after: right?.classification?.pattern || null,
      changed: (left?.classification?.pattern || null) !== (right?.classification?.pattern || null),
    },
  };
}

function renderTenantSnapshotDiffMarkdown(diff) {
  if (!diff) return '# Tenant snapshot diff\n\n_No diff._\n';
  const lines = [
    '# Tenant snapshot diff',
    '',
    `Mode: \`${diff.mode}\``,
    '',
    '## Before / after',
    '',
    `| | tenant | capturedAt | pattern |`,
    `|---|---|---|---|`,
    `| before | ${diff.before?.tenant || '-'} | ${diff.before?.capturedAt || '-'} | ${diff.before?.pattern || '-'} |`,
    `| after | ${diff.after?.tenant || '-'} | ${diff.after?.capturedAt || '-'} | ${diff.after?.pattern || '-'} |`,
    '',
    '## Catalog scalars',
    '',
  ];
  if (!(diff.catalog?.scalars || []).length) {
    lines.push('_No scalar catalog changes._', '');
  } else {
    for (const row of diff.catalog.scalars) {
      lines.push(`- \`${row.key}\`: \`${row.before}\` → \`${row.after}\``);
    }
    lines.push('');
  }
  lines.push('## Rate card aliases', '');
  const rc = diff.catalog?.rateCardIds || {};
  lines.push(`- added: ${(rc.added || []).join(', ') || '(none)'}`);
  lines.push(`- removed: ${(rc.removed || []).join(', ') || '(none)'}`);
  lines.push(`- changed: ${(rc.changed || []).join(', ') || '(none)'}`, '');
  lines.push('## Inventory deltas', '');
  const inv = diff.inventory || {};
  lines.push(`- rateCards: ${inv.rateCardCountDelta ?? 0}`);
  lines.push(`- products: ${inv.productCountDelta ?? 0}`);
  lines.push(`- billableMetrics: ${inv.billableMetricCountDelta ?? 0}`);
  lines.push(`- creditTypes: ${inv.creditTypeCountDelta ?? 0}`, '');
  lines.push('## Classification', '');
  lines.push(diff.classification?.changed
    ? `\`${diff.classification.before}\` → \`${diff.classification.after}\``
    : `_Unchanged (${diff.classification?.after || '-'})._`);
  lines.push('');
  return `${lines.join('\n')}\n`;
}

module.exports = {
  diffTenantSnapshots,
  renderTenantSnapshotDiffMarkdown,
};
