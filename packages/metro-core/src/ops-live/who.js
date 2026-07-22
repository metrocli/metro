'use strict';

const {
  parseArg,
  ensureTenantKey,
  makeClient,
} = require('./lib/shared');
const {
  resolveCustomer,
  summarizeCustomer,
  guessCustomerLookup,
} = require('./customer-resolve');

const SCHEMA = 'metro.ops.who.v1';

function isActiveNow(contract, now = new Date()) {
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

function summarizeContract(contract) {
  return {
    id: contract.id,
    name: contract.name || null,
    package_id: contract.package_id || null,
    starting_at: contract.starting_at || null,
    ending_before: contract.ending_before || null,
    active: isActiveNow(contract),
  };
}

function summarizeBalance(row) {
  return {
    id: row.id || row.commit_id || row.credit_id || null,
    name: row.name || row.commit_name || row.credit_name || row.type || null,
    type: row.type || null,
    balance: balanceAmount(row),
    contract_id: row.contract?.id || row.contract_id || null,
  };
}

function parseWhoArgs(argv = [], flags = {}, positionalQuery = null) {
  const query = parseArg('--query=', argv)
    || flags.query
    || positionalQuery
    || null;
  return {
    argv,
    json: argv.includes('--json') || flags.json === true,
    query,
    customerId: parseArg('--customer-id=', argv) || flags['customer-id'] || null,
    levId: parseArg('--lev-id=', argv) || flags['lev-id'] || null,
    ingestAlias: parseArg('--ingest-alias=', argv) || flags['ingest-alias'] || null,
    name: parseArg('--name=', argv) || flags.name || null,
  };
}

async function fetchSnapshot(client, customerId) {
  const [contractsResp, balancesResp] = await Promise.all([
    client.post('/v2/contracts/list', { customer_id: customerId, include_archived: false }),
    client.post('/v1/contracts/customerBalances/list', {
      customer_id: customerId,
      include_balance: true,
      include_contract_balances: true,
      include_archived: false,
    }),
  ]);
  const contracts = (contractsResp.data || contractsResp || []).map(summarizeContract);
  const balances = (balancesResp.data || balancesResp || []).map(summarizeBalance);
  const activeContracts = contracts.filter((c) => c.active);
  const activeIds = new Set(activeContracts.map((c) => c.id));
  const activeBalances = balances.filter((b) => b.balance !== 0 && (!b.contract_id || activeIds.has(b.contract_id)));
  return { contracts, balances, activeContracts, activeBalances };
}

function formatHuman(payload) {
  const lines = [];
  const c = payload.customer;
  lines.push(c.name);
  lines.push(`  id: ${c.id}`);
  lines.push(`  lev_id: ${c.lev_id ?? '-'}`);
  lines.push(`  ingest_aliases: ${JSON.stringify(c.ingest_aliases || [])}`);
  if (payload.lookup?.method) lines.push(`  lookup: ${payload.lookup.method}`);
  lines.push('');

  if (payload.activeContracts.length === 0) {
    lines.push('Active contract: none');
  } else {
    lines.push('Active contract(s):');
    for (const contract of payload.activeContracts) {
      const end = contract.ending_before ? ` → ${contract.ending_before}` : '';
      lines.push(`  ${contract.name || '(unnamed)'}  ${contract.id}`);
      lines.push(`    since ${contract.starting_at}${end}  package=${contract.package_id || '-'}`);
    }
  }
  lines.push('');

  if (payload.activeBalances.length === 0) {
    lines.push('Credits (nonzero): none');
  } else {
    lines.push('Credits (nonzero):');
    for (const bal of payload.activeBalances) {
      lines.push(`  ${bal.name || bal.type || bal.id}  balance=${bal.balance}`);
    }
  }
  lines.push('');
  lines.push('What change do you want? Common next steps:');
  lines.push(`  metro contract move-plan preflight --customer-id=${c.id} --to=<package-alias> --prod`);
  lines.push(`  metro ledger-adjustment preflight --amount=<signed-int> --reason="..." --customer-id=${c.id} --prod`);
  lines.push(`  metro contract extend-trial preflight --extend-by-days=<N> --customer-id=${c.id} --prod`);
  return `${lines.join('\n')}\n`;
}

async function runWho(flags = {}, streams = { stdout: process.stdout, stderr: process.stderr }, positionalQuery = null) {
  const args = parseWhoArgs(flags.argv || [], flags, positionalQuery);
  if (!args.query && !args.customerId && !args.levId && !args.ingestAlias && !args.name) {
    streams.stderr.write('Usage: metro ops who <name|uuid|lev-id|url> (--sandbox|--prod) [--json]\n');
    return { exitCode: 1 };
  }

  const { tenant } = ensureTenantKey(args);
  const client = makeClient(process.env.METRONOME_API_KEY, { production: tenant === 'production' });

  const resolved = await resolveCustomer(client, {
    query: args.query,
    customerId: args.customerId,
    levId: args.levId,
    ingestAlias: args.ingestAlias,
    name: args.name,
  });

  if (!resolved.customer) {
    const payload = {
      schemaVersion: SCHEMA,
      ok: false,
      tenant,
      query: args.query,
      guessed: args.query ? guessCustomerLookup(args.query) : null,
      error: resolved.error || 'not found',
      candidates: resolved.candidates || null,
      lookup: resolved.lookup || null,
    };
    if (args.json) streams.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    else {
      streams.stderr.write(`${payload.error}\n`);
      if (payload.candidates?.length) {
        for (const cand of payload.candidates) {
          streams.stderr.write(`  ${cand.name}  id=${cand.id}  lev_id=${cand.lev_id ?? '-'}\n`);
        }
      }
    }
    return { exitCode: 1, result: payload };
  }

  const snap = await fetchSnapshot(client, resolved.customer.id);
  const payload = {
    schemaVersion: SCHEMA,
    ok: true,
    tenant,
    query: args.query,
    customer: summarizeCustomer(resolved.customer),
    lookup: resolved.lookup || null,
    activeContracts: snap.activeContracts,
    activeBalances: snap.activeBalances,
    contracts: snap.contracts,
    balances: snap.balances,
    nextPrompt: 'What change do you want?',
  };

  if (args.json) streams.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  else streams.stdout.write(formatHuman(payload));

  return { exitCode: 0, result: payload };
}

module.exports = {
  SCHEMA,
  runWho,
  guessCustomerLookup,
  parseWhoArgs,
  formatHuman,
  isActiveNow,
};
