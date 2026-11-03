'use strict';

/**
 * Read-only ops: customer balances (with the spendable-net vs list
 * divergence check) and package customers. They never write; the read client
 * refuses write-shaped paths.
 */

const fs = require('fs');
const path = require('path');

const rt = require('./lib/runtime');
const mx = require('./lib/metronome');
const net = require('./lib/net-balance');

function defineReadOp(name, fn) {
  return async function run(flags = {}, streams = { stdout: process.stdout, stderr: process.stderr }) {
    const json = rt.wantsJson(flags);
    try {
      const tenant = rt.explicitTenant(flags);
      const keyInfo = rt.resolveTenantKey(tenant);
      const client = rt.createReadClient(keyInfo);
      const ctx = { flags, tenant, keyInfo, client, now: new Date(), json };
      const { result, human } = await fn(ctx);
      const out = rt.readString(flags, 'out');
      if (out) {
        fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
        fs.writeFileSync(path.resolve(out), `${JSON.stringify(result, null, 2)}\n`);
      }
      streams.stdout.write(json ? `${JSON.stringify(result, null, 2)}\n` : `${human}\n`);
      return { exitCode: rt.EXIT.OK, result };
    } catch (err) {
      rt.writeError(streams, json, err);
      return { exitCode: err instanceof rt.OpError ? err.exitCode : 1, error: err };
    }
  };
}

// POST /v1/contracts/customerBalances/list + getNetBalance per credit type.
const runCustomerBalances = defineReadOp('customer-balances', async (ctx) => {
  const f = ctx.flags;
  const { customer } = await mx.resolveOneCustomer(ctx.client, f);
  const [contracts, balances] = await Promise.all([
    mx.listContracts(ctx.client, customer.id),
    mx.listBalances(ctx.client, customer.id),
  ]);
  const activeContractIds = new Set(contracts.filter((c) => mx.isActiveContract(c, ctx.now)).map((c) => c.id));
  const all = balances.map((row) => {
    const s = mx.summarizeBalance(row);
    const contractActive = s.contract_id ? activeContractIds.has(s.contract_id) : null;
    return { ...s, contract_active: contractActive, ledger_adjustable: Boolean(s.id && s.segment_id && (!s.contract_id || contractActive)) };
  });
  const contractId = rt.readString(f, 'contract-id');
  const minBalance = rt.readNumber(f, 'min-balance');
  const rows = all.filter((r) => (!contractId || r.contract_id === contractId)
    && (!rt.readBool(f, 'only-active') || r.contract_active !== false)
    && (!rt.readBool(f, 'only-nonzero') || r.balance !== 0)
    && (minBalance === null || r.balance >= minBalance));
  const reconciliation = await net.reconcileAllCreditTypes(ctx.client, customer.id, balances, {
    activeContractIds,
    extraCreditTypeIds: [rt.readString(f, 'credit-type-id')],
  });
  const divergent = reconciliation.filter((r) => r.divergent);
  const result = {
    schemaVersion: 'metro.customer-balances.v2',
    ok: true,
    tenant: ctx.tenant,
    generatedAt: ctx.now.toISOString(),
    customer: mx.summarizeCustomer(customer),
    totalBalances: all.length,
    matchedBalances: rows.length,
    balances: rows,
    spendableNet: reconciliation,
    warnings: divergent.map((r) => ({
      id: 'MTR-CREDIT-NET-001',
      message: `Credit type ${r.creditTypeId}: spendable net ${r.netBalance} != list sum ${r.bucketSum} (delta ${r.delta}). Trust getNetBalance; do not add credits off the list view.`,
    })),
    reconciliationProof: { listedRows: balances.length, activeContracts: activeContractIds.size, creditTypesChecked: reconciliation.length },
  };
  const human = [
    `Customer: ${customer.name} (${customer.id}) on ${ctx.tenant}`,
    `${all.length} balances (${rows.length} match filters)`,
    ...rows.map((r) => `  ${r.id}  ${r.name || '(no name)'}  balance=${r.balance}  contract=${r.contract_id || '(none)'}${r.ledger_adjustable ? '' : '  [not ledger-adjustable]'}`),
    'Spendable net (getNetBalance) vs list sum:',
    ...reconciliation.map((r) => `  ${r.creditTypeId}: net=${r.netBalance} list=${r.bucketSum}${r.divergent ? `  DIVERGES by ${r.delta}` : '  ok'}`),
    ...result.warnings.map((w) => `WARNING [${w.id}]: ${w.message}`),
  ].join('\n');
  return { result, human };
});

// POST /v1/packages/listContractsOnPackage
// https://docs.metronome.com/api-reference/contracts/list-contracts-associated-with-a-package
const runPackageCustomers = defineReadOp('package-customers', async (ctx) => {
  const packageId = rt.readString(ctx.flags, 'package-id');
  const alias = rt.readString(ctx.flags, 'alias');
  if (!packageId && !alias) throw rt.usageError('Usage: metro package customers --package-id=<id>|--alias=<alias> (--sandbox|--prod) [--json]');
  let pkg;
  if (packageId) pkg = await mx.getPackage(ctx.client, packageId);
  else {
    pkg = mx.resolvePackageAliasAt(await mx.listPackages(ctx.client), alias, ctx.now.toISOString());
    if (!pkg) throw rt.usageError(`No live package has alias ${alias} right now.`);
  }
  const rows = await mx.listPaginated(ctx.client, 'post', '/v1/packages/listContractsOnPackage', { package_id: pkg.id });
  const active = rows.filter((r) => mx.isActiveContract({ ...r, id: r.contract_id }, ctx.now));
  const activeContracts = [];
  for (const r of active) {
    let customer;
    try {
      customer = mx.summarizeCustomer(await mx.getCustomerById(ctx.client, r.customer_id));
    } catch (err) {
      customer = { id: r.customer_id, error: err.message };
    }
    activeContracts.push({ contract_id: r.contract_id, starting_at: r.starting_at, ending_before: r.ending_before || null, customer });
  }
  const result = {
    schemaVersion: 'metro.package-customers.v1',
    ok: true,
    tenant: ctx.tenant,
    generatedAt: ctx.now.toISOString(),
    package: { id: pkg.id, name: pkg.name || null, aliases: mx.packageAliasNames(pkg) },
    totalContracts: rows.length,
    activeContracts,
    historicalContractIds: rows.filter((r) => !active.includes(r)).map((r) => r.contract_id),
  };
  const human = [
    `Package: ${pkg.name || pkg.id} (${mx.packageAliasNames(pkg).join(', ') || 'no alias'})`,
    `${rows.length} total contracts, ${activeContracts.length} active now:`,
    ...activeContracts.map((r) => `  ${r.customer.name || r.customer.id} (customer ${r.customer.id}) - contract ${r.contract_id}`),
  ].join('\n');
  return { result, human };
});

module.exports = { runCustomerBalances, runPackageCustomers, defineReadOp };
