'use strict';

const path = require('path');
const fs = require('fs');

const {
  parseArg,
  ensureTenantKey,
  makeClient,
  listPaginated,
  mkdirp,
} = require('../../lib/shared');

const SCHEMA = 'metro.package-list.v1';

function parseArgs(argv = [], flags = {}) {
  return {
    argv,
    json: argv.includes('--json') || flags.json === true,
    onlyArchived: argv.includes('--only-archived') || flags['only-archived'] === true,
    onlyActive: argv.includes('--only-active') || flags['only-active'] === true,
    packageId: parseArg('--package-id=', argv) || flags['package-id'] || null,
    alias: parseArg('--alias=', argv) || flags.alias || null,
    search: parseArg('--search=', argv) || flags.search || null,
    out: parseArg('--out=', argv) || flags.out || null,
  };
}

/** Real Metronome package rows carry aliases[].name, not aliases[].alias - see api.md/packages.ts SDK types. */
function aliasNames(pkg) {
  return (pkg.aliases || []).map((entry) => entry.name).filter(Boolean);
}

function matchesFilters(pkg, args) {
  if (args.packageId && pkg.id !== args.packageId) return false;
  if (args.alias && !aliasNames(pkg).includes(args.alias)) return false;
  if (args.onlyArchived && !pkg.archived_at) return false;
  if (args.onlyActive && pkg.archived_at) return false;
  if (args.search) {
    const needle = args.search.toLowerCase();
    const haystack = [pkg.name, pkg.id, ...aliasNames(pkg)].filter(Boolean).join(' ').toLowerCase();
    if (!haystack.includes(needle)) return false;
  }
  return true;
}

function summarizePackage(pkg) {
  return {
    id: pkg.id,
    name: pkg.name || null,
    aliases: aliasNames(pkg),
    rate_card_id: pkg.rate_card_id || null,
    archived_at: pkg.archived_at || null,
    created_at: pkg.created_at || null,
    uniqueness_key: pkg.uniqueness_key || null,
  };
}

async function fetchAllPackages(client) {
  return listPaginated(client, 'post', '/v1/packages/list', {});
}

async function runList(flags = {}, streams = { stdout: process.stdout, stderr: process.stderr }) {
  const args = parseArgs(flags.argv || [], flags);
  if (args.onlyArchived && args.onlyActive) {
    throw new Error('Pass only one of --only-archived or --only-active, not both.');
  }

  const { tenant } = ensureTenantKey(args);
  const client = makeClient(process.env.METRONOME_API_KEY, { production: tenant === 'production' });

  const all = await fetchAllPackages(client);
  const rows = all
    .filter((pkg) => matchesFilters(pkg, args))
    .map(summarizePackage)
    .sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));

  const result = {
    schemaVersion: SCHEMA,
    ok: true,
    tenant,
    generatedAt: new Date().toISOString(),
    totalPackages: all.length,
    activePackages: all.filter((pkg) => !pkg.archived_at).length,
    archivedPackages: all.filter((pkg) => pkg.archived_at).length,
    matchedPackages: rows.length,
    filters: {
      packageId: args.packageId,
      alias: args.alias,
      search: args.search,
      onlyArchived: args.onlyArchived,
      onlyActive: args.onlyActive,
    },
    packages: rows,
    note: 'Fully paginated via next_page - the 100-row limit is Metronome\'s page size, not a total cap.',
  };

  if (args.out) {
    const resolvedOut = path.resolve(args.out);
    mkdirp(path.dirname(resolvedOut));
    fs.writeFileSync(resolvedOut, `${JSON.stringify(result, null, 2)}\n`);
  }

  if (args.json) {
    streams.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    streams.stdout.write(
      `${tenant}: ${result.totalPackages} total packages (${result.activePackages} active, ${result.archivedPackages} archived)`
      + `${result.matchedPackages !== result.totalPackages ? `, ${result.matchedPackages} match filters` : ''}\n`,
    );
    for (const pkg of rows) {
      const state = pkg.archived_at ? `archived_at=${pkg.archived_at}` : 'active';
      streams.stdout.write(`  ${pkg.id}  ${pkg.name || '(no name)'}  aliases=[${pkg.aliases.join(', ')}]  ${state}\n`);
    }
    if (args.out) streams.stdout.write(`Wrote full JSON dump to ${args.out}\n`);
  }

  return { exitCode: 0, result };
}

module.exports = {
  SCHEMA,
  parseArgs,
  aliasNames,
  matchesFilters,
  summarizePackage,
  runList,
};
