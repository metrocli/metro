'use strict';

const path = require('path');
const { applyMetronomeApiKeyFromEnv } = require('../clients/metronome-tenant');
const { buildMetronomeRetryClient } = require('../clients/metronome-retry-client');
const { assertOperatorModeAllows } = require('../setup/mode');
const { loadCustomerResolve } = require('./load');

function parseArg(prefix, argv = []) {
  const raw = argv.find((a) => a.startsWith(prefix));
  if (!raw) return null;
  return raw.slice(prefix.length);
}

async function runCustomerResolve(flags = {}, streams = { stdout: process.stdout, stderr: process.stderr }) {
  const argv = flags.argv || [];
  const resolveMod = loadCustomerResolve();
  if (!resolveMod) {
    streams.stderr.write('Customer resolve requires a workspace pack with live ops enabled.\n');
    return { exitCode: 2 };
  }

  const args = {
    argv,
    json: argv.includes('--json') || flags.json === true,
    customerId: parseArg('--customer-id=', argv) || flags['customer-id'] || null,
    levId: parseArg('--lev-id=', argv) || parseArg('--external-id=', argv) || flags['lev-id'] || flags['external-id'] || null,
    ingestAlias: parseArg('--ingest-alias=', argv) || flags['ingest-alias'] || null,
    name: parseArg('--name=', argv) || flags.name || null,
    query: parseArg('--query=', argv) || flags.query || null,
  };

  if (!args.customerId && !args.levId && !args.ingestAlias && !args.name && !args.query) {
    streams.stderr.write('Usage: metro customer resolve (--customer-id=|--external-id=|--ingest-alias=|--name=|--query=) (--sandbox|--prod) [--json]\n');
    return { exitCode: 1 };
  }

  const { tenant } = applyMetronomeApiKeyFromEnv({
    argv,
    requireExplicitTenantFlags: true,
  });
  assertOperatorModeAllows('live-read');
  const client = buildMetronomeRetryClient(process.env.METRONOME_API_KEY);
  const resolved = await resolveMod.resolveCustomer(client, {
    customerId: args.customerId,
    levId: args.levId,
    ingestAlias: args.ingestAlias,
    name: args.name,
    query: args.query,
  });

  const payload = {
    schemaVersion: 'metro.customer.resolve.v1',
    ok: Boolean(resolved.customer),
    tenant,
    customer: resolved.customer ? resolveMod.summarizeCustomer(resolved.customer) : null,
    lookup: resolved.lookup || null,
    error: resolved.error || null,
    candidates: resolved.candidates || null,
  };

  if (args.json) streams.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  else if (resolved.customer) {
    streams.stdout.write(`${resolved.customer.name}\n`);
    streams.stdout.write(`  id: ${resolved.customer.id}\n`);
    streams.stdout.write(`  external_id: ${resolved.customer.custom_fields?.lev_id ?? '-'}\n`);
    streams.stdout.write(`  ingest_aliases: ${JSON.stringify(resolved.customer.ingest_aliases || [])}\n`);
  } else {
    streams.stderr.write(`${resolved.error}\n`);
  }

  return { exitCode: payload.ok ? 0 : 1, result: payload };
}

module.exports = {
  runCustomerResolve,
};
