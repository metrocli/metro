'use strict';

const path = require('path');
const {
  readSnapshot,
  readPreviousSnapshot,
  writeSnapshot,
  snapshotPath,
  renderTenantSnapshotMarkdown,
  diffTenantSnapshots,
  renderTenantSnapshotDiffMarkdown,
  defaultMetroConfigDir,
} = require('../tenant-snapshot');
const { classifyAccount } = require('../account-classifier');

function resolveTenant(flags) {
  if (flags.prod || flags.production) return 'production';
  if (flags.sandbox) return 'sandbox';
  return 'sandbox';
}

function resolveConfigDir(flags) {
  if (flags.dir && flags.dir !== true) return path.resolve(String(flags.dir));
  return defaultMetroConfigDir();
}

function runTenantSnapshotShow(flags, streams) {
  const tenant = resolveTenant(flags);
  const configDir = resolveConfigDir(flags);
  const filePath = snapshotPath(tenant, configDir);
  const snapshot = readSnapshot(tenant, { configDir });

  if (!snapshot) {
    const payload = {
      schemaVersion: 'metro.tenant.snapshot.show.v1',
      found: false,
      tenant,
      path: filePath,
      nextSafeStep: `metro catalog bind --${tenant === 'production' ? 'prod' : 'sandbox'} --write`,
    };
    if (flags.json) {
      streams.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    } else if (flags.markdown) {
      streams.stdout.write(renderTenantSnapshotMarkdown(null));
    } else {
      streams.stderr.write(`No snapshot at ${filePath}. Run: ${payload.nextSafeStep}\n`);
    }
    return 1;
  }

  const classification = classifyAccount(snapshot);
  const view = { ...snapshot, classification };

  if (flags.json) {
    streams.stdout.write(`${JSON.stringify({
      schemaVersion: 'metro.tenant.snapshot.show.v1',
      found: true,
      path: filePath,
      snapshot: view,
    }, null, 2)}\n`);
  } else if (flags.markdown) {
    streams.stdout.write(renderTenantSnapshotMarkdown(view));
  } else {
    streams.stdout.write(`Tenant snapshot (${tenant}) → ${filePath}\n`);
    streams.stdout.write(`  pattern: ${classification.pattern} (${classification.confidence})\n`);
    streams.stdout.write(`  capturedAt: ${snapshot.capturedAt || '(none)'}\n`);
    streams.stdout.write(`  rateCardIds: ${Object.keys(snapshot.catalog?.rateCardIds || {}).length}\n`);
    for (const cmd of (classification.nextCommands || []).slice(0, 4)) {
      streams.stdout.write(`  → ${cmd}\n`);
    }
  }
  return 0;
}

function runTenantSnapshotRefreshLocal(flags, streams) {
  const tenant = resolveTenant(flags);
  const configDir = resolveConfigDir(flags);
  const snapshot = readSnapshot(tenant, { configDir });
  if (!snapshot) {
    streams.stderr.write(`No snapshot to refresh. Run metro catalog bind --${tenant === 'production' ? 'prod' : 'sandbox'} --write\n`);
    return 1;
  }
  const classification = classifyAccount(snapshot);
  const next = {
    ...snapshot,
    classification,
    sourceCommand: snapshot.sourceCommand || 'metro tenant snapshot refresh',
  };
  const written = writeSnapshot(next, { configDir });
  const payload = {
    schemaVersion: 'metro.tenant.snapshot.refresh.v1',
    path: written.path || written,
    pattern: classification.pattern,
    confidence: classification.confidence,
    nextSafeStep: 'metro tenant snapshot show --markdown',
  };
  if (flags.json) {
    streams.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else if (flags.markdown) {
    streams.stdout.write(renderTenantSnapshotMarkdown(next));
  } else {
    streams.stdout.write(`Reclassified ${payload.path} → ${classification.pattern}\n`);
  }
  return 0;
}

/**
 * Diff previous vs current for one tenant, or sandbox vs production bindings.
 * --against=prod|production|sandbox|<path-to-json>
 */
function runTenantSnapshotDiff(flags, streams) {
  const tenant = resolveTenant(flags);
  const configDir = resolveConfigDir(flags);
  const against = flags.against && flags.against !== true ? String(flags.against) : 'prev';

  const current = readSnapshot(tenant, { configDir });
  if (!current) {
    streams.stderr.write(`No current snapshot for ${tenant}. Run metro catalog bind --${tenant === 'production' ? 'prod' : 'sandbox'} --write\n`);
    return 1;
  }

  let before = null;
  let mode = 'previous';
  if (against === 'prev' || against === 'previous') {
    before = readPreviousSnapshot(tenant, { configDir });
    mode = 'previous';
    if (!before) {
      streams.stderr.write(`No previous snapshot for ${tenant}. Re-run catalog bind --write once to create ${tenant}.prev.json.\n`);
      return 1;
    }
  } else if (against === 'prod' || against === 'production' || against === 'sandbox') {
    const otherTenant = against === 'sandbox' ? 'sandbox' : 'production';
    before = readSnapshot(otherTenant, { configDir });
    mode = `cross-tenant:${otherTenant}->${tenant}`;
    // When comparing sandbox vs prod, treat "against" as before and current tenant as after.
    // If user said --against=prod while on sandbox default, before=prod after=sandbox.
    if (!before) {
      streams.stderr.write(`No snapshot for ${otherTenant}. Bind that tenant first.\n`);
      return 1;
    }
  } else {
    const fs = require('fs');
    const filePath = path.resolve(against);
    try {
      before = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      mode = `file:${filePath}`;
    } catch (err) {
      streams.stderr.write(`Failed to read --against file: ${err.message}\n`);
      return 1;
    }
  }

  const after = {
    ...current,
    classification: current.classification || classifyAccount(current),
  };
  const beforeView = {
    ...before,
    classification: before.classification || classifyAccount(before),
  };
  const diff = diffTenantSnapshots(beforeView, after, { mode });

  if (flags.json) {
    streams.stdout.write(`${JSON.stringify(diff, null, 2)}\n`);
  } else if (flags.markdown) {
    streams.stdout.write(renderTenantSnapshotDiffMarkdown(diff));
  } else {
    streams.stdout.write(`Snapshot diff (${mode})\n`);
    streams.stdout.write(`  pattern: ${diff.classification.before} → ${diff.classification.after}\n`);
    streams.stdout.write(`  catalog scalar changes: ${diff.catalog.scalars.length}\n`);
    streams.stdout.write(`  rateCard aliases +${diff.catalog.rateCardIds.added.length}/-${diff.catalog.rateCardIds.removed.length}\n`);
    streams.stdout.write(`  inventory Δ products=${diff.inventory.productCountDelta} bms=${diff.inventory.billableMetricCountDelta}\n`);
  }
  return 0;
}

function runTenantSnapshotCommand(positional, flags, streams) {
  const action = positional[1] === 'snapshot' ? (positional[2] || 'show') : (positional[1] || 'show');

  if (flags.help === true || action === 'help') {
    streams.stderr.write('Usage: metro tenant snapshot show [--sandbox|--prod] [--json|--markdown] [--dir <path>]\n');
    streams.stderr.write('       metro tenant snapshot refresh [--sandbox|--prod] [--json|--markdown]\n');
    streams.stderr.write('       metro tenant snapshot diff [--sandbox|--prod] [--against=prev|production|sandbox|<file>] [--json|--markdown]\n');
    streams.stderr.write('Live inventory refresh: metro catalog bind (--sandbox|--prod) --write\n');
    return 1;
  }

  if (flags.json && flags.markdown) {
    streams.stderr.write('Choose one output format: --json or --markdown.\n');
    return 1;
  }

  if (action === 'refresh') {
    return runTenantSnapshotRefreshLocal(flags, streams);
  }
  if (action === 'diff') {
    return runTenantSnapshotDiff(flags, streams);
  }
  if (action === 'show' || action === 'snapshot') {
    return runTenantSnapshotShow(flags, streams);
  }

  streams.stderr.write(`Unknown tenant snapshot action: ${action}\n`);
  return 1;
}

module.exports = {
  runTenantSnapshotCommand,
  runTenantSnapshotShow,
  runTenantSnapshotRefreshLocal,
  runTenantSnapshotDiff,
};
