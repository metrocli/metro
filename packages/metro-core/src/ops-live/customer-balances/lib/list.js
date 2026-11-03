'use strict';

const path = require('path');
const fs = require('fs');

const {
  parseArg,
  ensureTenantKey,
  makeClient,
  resolveLookupFromArgs,
  mkdirp,
} = require('../../lib/shared');
const { resolveCustomer, summarizeCustomer } = require('../../customer-resolve');

const SCHEMA = 'metro.customer-balances.v1';

function parseArgs(argv = [], flags = {}) {
  return {
    argv,
    json: argv.includes('--json') || flags.json === true,
    customerId: parseArg('--customer-id=', argv) || flags['customer-id'] || null,
    externalId: parseArg('--external-id=', argv) || flags['external-id'] || null,
    ingestAlias: parseArg('--ingest-alias=', argv) || flags['ingest-alias'] || null,
    name: parseArg('--name=', argv) || flags.name || null,
    query: parseArg('--query=', argv) || flags.query || null,
    contractId: parseArg('--contract-id=', argv) || flags['contract-id'] || null,
    minBalance: parseArg('--min-balance=', argv) ?? flags['min-balance'] ?? null,
    onlyActive: argv.includes('--only-active') || flags['only-active'] === true,
    onlyNonzero: argv.includes('--only-nonzero') || flags['only-nonzero'] === true,
    out: parseArg('--out=', argv) || flags.out || null,
  };
}

/** Mirrors ledger-adjustment/lib/preflight.js's eligibility notion of "active right now" so this view and that plan never disagree. */
function isActiveNow(contract, now) {
  if (contract.archived_at) return false;
  if (contract.starting_at && new Date(contract.starting_at) > now) return false;
  return !contract.ending_before || new Date(contract.ending_before) > now;
}

function balanceAmount(row) {
  const raw = row.balance?.including_pending
    ?? row.balance?.excluding_pending
    ?? row.balance
    ?? row.remaining_amount
    ?? row.amount
    ?? 0;
  return Number(raw) || 0;
}

function balanceRowId(row) {
  return row.id || row.commit_id || row.credit_id || null;
}

function balanceSegmentId(row) {
  return row.access_schedule?.schedule_items?.[0]?.id
    || row.segments?.[0]?.id
    || row.segment_id
    || null;
}

function balanceContractId(row) {
  return row.contract?.id || row.contract_id || null;
}

function summarizeBalance(row, activeContractIds) {
  const id = balanceRowId(row);
  const segmentId = balanceSegmentId(row);
  const contractId = balanceContractId(row);
  const contractActive = contractId ? activeContractIds.has(contractId) : null;
  return {
    id,
    name: row.name || row.commit_name || row.credit_name || row.type || null,
    type: row.type || null,
    balance: balanceAmount(row),
    contract_id: contractId,
    segment_id: segmentId,
    contract_active: contractActive,
    // Same shape ledger-adjustment preflight requires of a target row (id + segment_id + active/no contract).
    ledger_adjustable: Boolean(id && segmentId && (!contractId || contractActive)),
  };
}

function matchesFilters(row, args) {
  if (args.contractId && row.contract_id !== args.contractId) return false;
  if (args.onlyActive && row.contract_active === false) return false;
  if (args.onlyNonzero && row.balance === 0) return false;
  if (args.minBalance !== null && args.minBalance !== undefined) {
    const min = Number(args.minBalance);
    if (Number.isFinite(min) && row.balance < min) return false;
  }
  return true;
}

async function runList(flags = {}, streams = { stdout: process.stdout, stderr: process.stderr }) {
  const args = parseArgs(flags.argv || [], flags);
  const { tenant } = ensureTenantKey(args);
  const client = makeClient(process.env.METRONOME_API_KEY, { production: tenant === 'production' });
  const now = new Date();

  const resolved = await resolveCustomer(client, resolveLookupFromArgs(args));
  if (!resolved.customer) {
    const payload = {
      schemaVersion: SCHEMA,
      ok: false,
      tenant,
      error: resolved.error,
      candidates: resolved.candidates || null,
    };
    if (args.json) streams.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    else streams.stderr.write(`${resolved.error}\n`);
    return { exitCode: 1, result: payload };
  }
  const customer = resolved.customer;

  const [contractsResp, balancesResp] = await Promise.all([
    client.post('/v2/contracts/list', { customer_id: customer.id, include_archived: false }),
    client.post('/v1/contracts/customerBalances/list', {
      customer_id: customer.id,
      include_balance: true,
      include_contract_balances: true,
      include_archived: false,
    }),
  ]);
  const contracts = contractsResp.data || [];
  const activeContractIds = new Set(contracts.filter((c) => isActiveNow(c, now)).map((c) => c.id));
  const allBalances = (balancesResp.data || []).map((row) => summarizeBalance(row, activeContractIds));
  const rows = allBalances.filter((row) => matchesFilters(row, args));

  const result = {
    schemaVersion: SCHEMA,
    ok: true,
    tenant,
    generatedAt: now.toISOString(),
    customer: summarizeCustomer(customer),
    totalBalances: allBalances.length,
    matchedBalances: rows.length,
    totalOutstanding: allBalances.reduce((sum, row) => sum + Math.max(row.balance, 0), 0),
    filters: {
      contractId: args.contractId,
      minBalance: args.minBalance,
      onlyActive: args.onlyActive,
      onlyNonzero: args.onlyNonzero,
    },
    balances: rows,
    note: 'contract_active reflects the balance\'s contract right now (not archived, started, not ended). '
      + 'ledger_adjustable mirrors what `metro ledger-adjustment preflight` will accept as a target balance '
      + '(has id + segment_id, and contract is active or balance is contract-less) - check this before running a preflight.',
  };

  if (args.out) {
    const resolvedOut = path.resolve(args.out);
    mkdirp(path.dirname(resolvedOut));
    fs.writeFileSync(resolvedOut, `${JSON.stringify(result, null, 2)}\n`);
  }

  if (args.json) {
    streams.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    streams.stdout.write(`Customer: ${customer.name} (${customer.id})\n`);
    streams.stdout.write(
      `${tenant}: ${result.totalBalances} balances (${result.matchedBalances} match filters), `
      + `total outstanding ${result.totalOutstanding}\n`,
    );
    for (const row of rows) {
      const flags2 = [
        row.contract_active === false ? 'contract inactive' : null,
        row.ledger_adjustable ? null : 'not ledger-adjustable',
      ].filter(Boolean);
      streams.stdout.write(
        `  ${row.id}  ${row.name || '(no name)'}  balance=${row.balance}  contract=${row.contract_id || '(none)'}`
        + `${flags2.length ? `  [${flags2.join(', ')}]` : ''}\n`,
      );
    }
    if (args.out) streams.stdout.write(`Wrote full JSON dump to ${args.out}\n`);
  }

  return { exitCode: 0, result };
}

module.exports = {
  SCHEMA,
  parseArgs,
  isActiveNow,
  balanceAmount,
  balanceRowId,
  balanceSegmentId,
  balanceContractId,
  summarizeBalance,
  matchesFilters,
  runList,
};
