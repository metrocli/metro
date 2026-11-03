'use strict';

/**
 * Move a customer from their current contract to a package (by alias) at a
 * cutover instant: end the predecessor, then create a RENEWAL successor.
 *   POST /v1/contracts/updateEndDate  https://docs.metronome.com/api-reference/contracts/update-the-contract-end-date
 *   POST /v1/contracts/create         https://docs.metronome.com/api-reference/contracts/create-a-contract
 * With package_id set, contracts/create only allows customer_id, starting_at,
 * package_id, uniqueness_key, transition and custom_fields. metro resolves the
 * alias to a package id at preflight and pins that id, so apply writes exactly
 * the package that was previewed.
 */

const fs = require('fs');
const path = require('path');

const rt = require('./lib/runtime');
const mx = require('./lib/metronome');
const core = require('./lib/core');

function addMonthsUtc(date, months) {
  const day = date.getUTCDate();
  const out = new Date(date.getTime());
  out.setUTCDate(1);
  out.setUTCMonth(out.getUTCMonth() + months);
  const last = new Date(Date.UTC(out.getUTCFullYear(), out.getUTCMonth() + 1, 0)).getUTCDate();
  out.setUTCDate(Math.min(day, last));
  return out;
}

function nextMonthlyBoundary(anchorIso, now) {
  let candidate = new Date(rt.isoHour(anchorIso));
  for (let guard = 0; candidate <= now; guard += 1) {
    if (guard > 600) throw rt.usageError('Could not find the next monthly renewal boundary.');
    candidate = addMonthsUtc(candidate, 1);
  }
  return candidate.toISOString();
}

function resolveCutoverAt({ explicitCutover, cutoverMode, anchor, now }) {
  if (explicitCutover) return { cutoverAt: rt.requireHourBoundary('--cutover', explicitCutover), source: 'explicit' };
  if (cutoverMode === 'current-hour') return { cutoverAt: rt.currentHourUtc(now), source: 'current-hour' };
  if (cutoverMode === 'next-hour') return { cutoverAt: rt.nextHourUtc(now), source: 'next-hour' };
  if (cutoverMode !== 'renewal-boundary') throw rt.usageError(`Unknown --cutover-mode=${cutoverMode}`);
  if (!anchor) throw rt.usageError('Could not infer the renewal boundary (no paid plan invoice or contract start). Pass --cutover=<ISO>.');
  return { cutoverAt: nextMonthlyBoundary(anchor, now), source: 'renewal-boundary', anchor: rt.isoHour(anchor) };
}

function balanceAmount(row) {
  return mx.balanceAmount(row);
}

/** RENEWAL carries balance * rollover_fraction per commit; fraction 0 loses it. */
function analyzeRolloverRisk({ balances = [], commits = [] } = {}) {
  const positiveBalance = balances.reduce((sum, row) => sum + Math.max(0, balanceAmount(row)), 0);
  const warnings = [];
  const zero = (commits || []).filter((c) => c.rollover_fraction != null && Number(c.rollover_fraction) === 0);
  let atRisk = 0;
  for (const commit of zero) {
    const match = balances.find((row) => row.id === commit.id);
    atRisk += match ? Math.max(0, balanceAmount(match)) : 0;
  }
  if (atRisk > 0) {
    warnings.push({ id: 'MTR-MOVE-ROLLOVER-002', message: `${atRisk} unused balance sits on commit(s) with rollover_fraction=0 and will not carry into the successor. Restore it afterwards with metro ledger-adjustment if intended.` });
  }
  if (positiveBalance > 0) {
    warnings.push({ id: 'MTR-MOVE-ROLLOVER-001', message: `Predecessor has ${positiveBalance} unused balance. RENEWAL carries balance x rollover_fraction; the target package may also grant fresh commits. Compare metro customer balances before and after.` });
  }
  return { positiveBalance, atRiskZeroRollover: atRisk, warnings };
}

async function listInvoices(client, customerId) {
  // https://docs.metronome.com/api-reference/invoices/list-invoices
  return mx.listPaginated(client, 'get', `/v1/customers/${customerId}/invoices`);
}

const contractMovePlan = rt.defineOp({
  name: 'contract-move-plan',
  command: 'metro contract move-plan',
  async preflight(ctx) {
    const f = ctx.flags;
    const toAlias = rt.readString(f, 'to');
    if (!toAlias) {
      throw rt.usageError('Usage: metro contract move-plan preflight --to=<package-alias> (--customer-id=|--external-id=|--ingest-alias=|--name=) [--from=<alias>] [--cutover=<ISO>|--cutover-mode=renewal-boundary|current-hour|next-hour] (--sandbox|--prod)');
    }
    const { customer, lookup } = await mx.resolveOneCustomer(ctx.client, f);
    const contracts = await mx.listContracts(ctx.client, customer.id);
    const { predecessor, kind } = mx.selectMovePredecessor(contracts, ctx.now);
    const [contract, invoices, packages, balances] = await Promise.all([
      mx.getContract(ctx.client, customer.id, predecessor.id),
      listInvoices(ctx.client, customer.id),
      mx.listPackages(ctx.client),
      mx.listBalances(ctx.client, customer.id, { contractId: predecessor.id }),
    ]);

    const sourcePkg = predecessor.package_id ? packages.find((p) => p.id === predecessor.package_id) : null;
    const fromAlias = rt.readString(f, 'from');
    if (fromAlias && !mx.packageAliasNames(sourcePkg).includes(fromAlias)) {
      throw rt.usageError(`Predecessor package aliases are ${JSON.stringify(mx.packageAliasNames(sourcePkg))}, not ${fromAlias}.`);
    }

    const lastPaid = invoices
      .filter((i) => i.type === 'SCHEDULED' && Number(i.total) > 0 && i.status === 'FINALIZED' && (i.contract_id || i.contract?.id) === predecessor.id)
      .sort((a, b) => new Date(b.issued_at) - new Date(a.issued_at))[0];
    const { cutoverAt, source, anchor } = resolveCutoverAt({
      explicitCutover: rt.readString(f, 'cutover'),
      cutoverMode: rt.readString(f, 'cutover-mode') || 'renewal-boundary',
      anchor: lastPaid?.issued_at || contract.starting_at,
      now: ctx.now,
    });
    if (Date.parse(cutoverAt) < Date.parse(contract.starting_at)) {
      throw rt.usageError(`Cutover ${cutoverAt} is before the predecessor starts (${contract.starting_at}).`);
    }

    const target = mx.resolvePackageAliasAt(packages, toAlias, cutoverAt);
    if (!target) throw rt.usageError(`No live package has alias ${toAlias} at ${cutoverAt}.`);
    let targetFull = target;
    try {
      targetFull = await mx.getPackage(ctx.client, target.id);
    } catch {
      // keep the list row
    }

    const rollover = analyzeRolloverRisk({ balances, commits: contract.commits });
    const warnings = [...rollover.warnings];
    if (kind === 'active-trial') warnings.push({ id: 'MTR-MOVE-TRIAL-001', message: 'Predecessor is a bounded (trial) contract; apply truncates it at cutover.' });
    if (mx.isBillingEmptyPackage(targetFull)) {
      warnings.push({ id: 'MTR-MOVE-EMPTY-PACKAGE-001', message: `Target package ${target.id} has no commits, credits, subscriptions or scheduled charges; the successor will bill nothing until you add terms.` });
    }
    if (Date.parse(cutoverAt) <= ctx.now.getTime()) {
      warnings.push({ id: 'MTR-TIME-002', message: `Cutover ${cutoverAt} is not in the future; the successor's first scheduled charges may invoice immediately.` });
    }

    const uniqueness = rt.uniquenessKey('move', [customer.id, predecessor.id, target.id, cutoverAt]);
    return {
      slug: customer.id.slice(0, 8),
      summary: {
        customer: mx.summarizeCustomer(customer),
        lookup,
        predecessor: { id: predecessor.id, package_id: predecessor.package_id || null, aliases: mx.packageAliasNames(sourcePkg), starting_at: contract.starting_at, ending_before: contract.ending_before || null, kind },
        target_package: { id: target.id, name: target.name || null, alias: toAlias },
        cadence: { cutover_at: cutoverAt, source, anchor: anchor || null, last_paid_plan_invoice: lastPaid ? { id: lastPaid.id, issued_at: lastPaid.issued_at, total: lastPaid.total } : null },
        predecessorBalance: { positive_total: rollover.positiveBalance, at_risk_zero_rollover: rollover.atRiskZeroRollover },
      },
      diff: [
        { field: `contract ${predecessor.id}.ending_before`, from: contract.ending_before || null, to: cutoverAt },
        { field: 'successor contract', from: null, to: { package_id: target.id, alias: toAlias, starting_at: cutoverAt, transition: 'RENEWAL' } },
      ],
      warnings,
      steps: [
        {
          id: 'updateEndDate',
          method: 'POST',
          path: '/v1/contracts/updateEndDate',
          body: { customer_id: customer.id, contract_id: predecessor.id, ending_before: cutoverAt, allow_ending_before_finalized_invoice: false },
        },
        {
          id: 'createSuccessor',
          method: 'POST',
          path: '/v1/contracts/create',
          body: {
            customer_id: customer.id,
            starting_at: cutoverAt,
            package_id: target.id,
            uniqueness_key: uniqueness,
            transition: { type: 'RENEWAL', from_contract_id: predecessor.id },
          },
        },
      ],
      expect: { customer_id: customer.id, predecessor_id: predecessor.id, cutover_at: cutoverAt, package_id: target.id, alias: toAlias },
    };
  },
  async verify(ctx, plan, results) {
    const e = plan.expect;
    const pred = await mx.getContract(ctx.client, e.customer_id, e.predecessor_id);
    const successorId = results.createSuccessor?.data?.id || results.createSuccessor?.id || null;
    const succ = successorId ? await mx.getContract(ctx.client, e.customer_id, successorId) : null;
    let aliasAtCutover = null;
    if (succ?.package_id) {
      const packages = await mx.listPackages(ctx.client);
      aliasAtCutover = mx.resolvePackageAliasAt(packages, e.alias, e.cutover_at)?.id || null;
    }
    return [
      rt.check('predecessor.ending_before', e.cutover_at, pred?.ending_before, { compare: 'instant' }),
      rt.check('successor exists', true, Boolean(succ?.id)),
      rt.check('successor.starting_at', e.cutover_at, succ?.starting_at, { compare: 'instant' }),
      rt.check('successor.package_id', e.package_id, succ?.package_id),
      rt.check(`alias ${e.alias} resolves to successor package at cutover`, e.package_id, aliasAtCutover),
    ];
  },
});

// ------------------------------------------------------------------ bulk

const BULK_SCHEMA = 'metro.contract-move-plan.bulk-manifest.v1';

function loadRoster(filePath) {
  return fs.readFileSync(path.resolve(filePath), 'utf8')
    .split('\n')
    .map((line) => line.split(',')[0].trim())
    .filter((line) => line && !line.startsWith('#') && line !== 'customer_id');
}

function manifestHash(manifest) {
  return core.canonicalHash.sha256({ schemaVersion: BULK_SCHEMA, tenant: manifest.tenant, entries: manifest.entries });
}

const silent = { stdout: { write() {} }, stderr: { write() {} } };

async function runBulkPreflight(flags = {}, streams = { stdout: process.stdout, stderr: process.stderr }) {
  const json = rt.wantsJson(flags);
  try {
    const tenant = rt.explicitTenant(flags);
    const to = rt.readString(flags, 'to');
    const roster = rt.readString(flags, 'roster-file');
    if (!to || !roster) throw rt.usageError('Usage: metro contract move-plan bulk-preflight --to=<alias> --roster-file=<customer ids, one per line> (--sandbox|--prod) [--cutover=<ISO>|--cutover-mode=...] [--out-dir=<dir>]');
    const ids = loadRoster(roster);
    if (!ids.length) throw rt.usageError(`Roster ${roster} has no customer ids.`);
    const outDir = path.resolve(rt.readString(flags, 'out-dir') || path.join(process.cwd(), 'metro-plans', `bulk-move-${new Date().toISOString().replace(/[:.]/g, '-')}`));
    const entries = [];
    const failures = [];
    for (let i = 0; i < ids.length; i += 1) {
      const out = path.join(outDir, `move-${String(i).padStart(4, '0')}-${ids[i].slice(0, 8)}.json`);
      const argv = [`--to=${to}`, `--customer-id=${ids[i]}`, rt.tenantFlag(tenant), `--out=${out}`];
      for (const k of ['cutover', 'cutover-mode', 'from']) {
        const v = rt.readString(flags, k);
        if (v) argv.push(`--${k}=${v}`);
      }
      const r = await contractMovePlan.runPreflight({ argv }, silent);
      if (r.exitCode === 0) entries.push({ customer_id: ids[i], plan: out, payloadHash: r.result.payloadHash });
      else failures.push({ customer_id: ids[i], error: r.error?.message || 'preflight failed' });
    }
    const manifest = { schemaVersion: BULK_SCHEMA, tenant, to, entries, failures };
    manifest.manifestHash = manifestHash(manifest);
    const manifestPath = path.join(outDir, 'manifest.json');
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const result = { ...manifest, manifestPath, nextCommands: [`metro contract move-plan bulk-apply --file ${manifestPath} ${rt.tenantFlag(tenant)} --confirm-hash ${manifest.manifestHash} --limit=1 --apply ${rt.confirmFlagsFor(tenant)}`] };
    streams.stdout.write(json ? `${JSON.stringify(result, null, 2)}\n` : `Planned ${entries.length}/${ids.length} moves (${failures.length} failed). Manifest: ${manifestPath}\nManifest hash: ${manifest.manifestHash}\nCanary: ${result.nextCommands[0]}\n`);
    return { exitCode: failures.length ? 1 : 0, result };
  } catch (err) {
    rt.writeError(streams, json, err);
    return { exitCode: err instanceof rt.OpError ? err.exitCode : 1, error: err };
  }
}

async function runBulkApply(flags = {}, streams = { stdout: process.stdout, stderr: process.stderr }) {
  const json = rt.wantsJson(flags);
  try {
    const file = rt.readString(flags, 'file');
    if (!file) throw rt.usageError('Usage: metro contract move-plan bulk-apply --file <manifest.json> --confirm-hash <sha256:...> (--sandbox|--prod) [--limit=N] [--apply ...]');
    const manifest = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
    if (manifest.schemaVersion !== BULK_SCHEMA) throw rt.refuse('MTR-PLAN-001', 'Not a bulk move-plan manifest.');
    const h = manifestHash(manifest);
    if (h !== manifest.manifestHash) throw rt.refuse('MTR-PLAN-002', 'Manifest was edited after bulk-preflight.');
    if (rt.normalizeHash(rt.readString(flags, 'confirm-hash')) !== h) throw rt.refuse('MTR-HASH-002', `--confirm-hash must equal manifest hash ${h}.`);
    const tenant = rt.explicitTenant(flags);
    if (tenant !== manifest.tenant) throw rt.refuse('MTR-TENANT-003', `Manifest is for ${manifest.tenant}.`);
    const limit = rt.readInt(flags, 'limit', { min: 1 });
    const delayMs = rt.readInt(flags, 'delay-ms') ?? 300;
    const todo = limit ? manifest.entries.slice(0, limit) : manifest.entries;
    const outcomes = [];
    for (const entry of todo) {
      const argv = [...(flags.argv || []).filter((a) => !/^--(file|confirm-hash|limit|delay-ms)=/.test(a)), `--file=${entry.plan}`, `--confirm-hash=${entry.payloadHash}`];
      const passthrough = { ...flags, argv, file: entry.plan, 'confirm-hash': entry.payloadHash };
      const r = await contractMovePlan.runApply(passthrough, silent);
      outcomes.push({ customer_id: entry.customer_id, exitCode: r.exitCode, error: r.error?.message || null, checks: r.result?.checks || null });
      if (r.exitCode !== 0) break;
      if (delayMs) await new Promise((res) => setTimeout(res, delayMs));
    }
    const ok = outcomes.length === todo.length && outcomes.every((o) => o.exitCode === 0);
    const result = { schemaVersion: 'metro.contract-move-plan.bulk-apply.v1', ok, tenant, attempted: outcomes.length, planned: manifest.entries.length, outcomes };
    streams.stdout.write(json ? `${JSON.stringify(result, null, 2)}\n` : `${ok ? 'OK' : 'STOPPED'}: ${outcomes.filter((o) => o.exitCode === 0).length}/${todo.length} moves applied.\n`);
    const last = outcomes[outcomes.length - 1];
    return { exitCode: ok ? 0 : (last?.exitCode || 1), result };
  } catch (err) {
    rt.writeError(streams, json, err);
    return { exitCode: err instanceof rt.OpError ? err.exitCode : 1, error: err };
  }
}

module.exports = {
  contractMovePlan,
  runBulkPreflight,
  runBulkApply,
  resolveCutoverAt,
  nextMonthlyBoundary,
  analyzeRolloverRisk,
};
