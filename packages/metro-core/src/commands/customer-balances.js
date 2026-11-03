'use strict';

const { loadPackOp, refusePackOpUnavailable } = require('../workspace/pack-ops');
const { loadCustomerBalancesOps: loadCoreCustomerBalancesOps } = require('../ops-live/load');

function loadCustomerBalancesOps() {
  // Pack-provided op first, then the generic read-only implementation in core.
  return loadPackOp('customer-balances') || loadCoreCustomerBalancesOps();
}

function refuseUnavailable(streams, command, reason) {
  return refusePackOpUnavailable(streams, { command, op: 'customer-balances', purpose: reason });
}

function runCustomerBalancesCommand(positional, flags, streams, argv = []) {
  const ops = loadCustomerBalancesOps();
  if (!ops) {
    return refuseUnavailable(streams, positional.join(' '), 'needed for customer balance listing');
  }

  const flagObj = { ...flags, argv };

  try {
    if (positional[0] !== 'customer' || positional[1] !== 'balances') {
      streams.stderr.write(
        'Usage: metro customer balances (--customer-id=|--external-id=|--ingest-alias=|--name=) (--sandbox|--prod) '
        + '[--contract-id=] [--min-balance=<n>] [--only-active] [--only-nonzero] [--out=<file.json>] [--json]\n',
      );
      return 1;
    }

    const out = ops.runList(flagObj, streams);
    if (out && typeof out.then === 'function') {
      return out.then((r) => r.exitCode, (err) => {
        streams.stderr.write(`\nFATAL: ${err.message}\n`);
        if (err.responseData) streams.stderr.write(`${JSON.stringify(err.responseData).slice(0, 900)}\n`);
        return 1;
      });
    }
    return out.exitCode;
  } catch (err) {
    streams.stderr.write(`\nFATAL: ${err.message}\n`);
    if (err.responseData) streams.stderr.write(`${JSON.stringify(err.responseData).slice(0, 900)}\n`);
    return 1;
  }
}

module.exports = {
  runCustomerBalancesCommand,
};
