'use strict';

const { loadPackOp, refusePackOpUnavailable } = require('../workspace/pack-ops');
const { allowsLiveReadOps } = require('../ops-live/load');
const { runCustomerResolve } = require('../ops-live/run-customer-resolve');

function loadContractMovePlanOps() {
  return loadPackOp('contract-move-plan');
}

function refuseUnavailable(streams, command, reason) {
  return refusePackOpUnavailable(streams, { command, op: 'contract-move-plan', purpose: reason });
}

function runContractMovePlanCommand(positional, flags, streams, argv = []) {
  if (positional[0] === 'customer' && positional[1] === 'resolve') {
    if (!allowsLiveReadOps()) {
      return refuseUnavailable(streams, positional.join(' '), 'customer resolve needs live reads; the stub pack is offline-only');
    }
    const flagObj = { ...flags, argv };
    return runCustomerResolve(flagObj, streams).then((r) => r.exitCode, (err) => {
      streams.stderr.write(`\nFATAL: ${err.message}\n`);
      return 1;
    });
  }

  const ops = loadContractMovePlanOps();
  if (!ops) {
    return refuseUnavailable(streams, positional.join(' '), 'needed for contract move-plan preflight/apply; on generic use metro plan package-plan-move plus validate/preview');
  }

  const flagObj = { ...flags, argv };

  try {
    if (positional[0] !== 'contract' || positional[1] !== 'move-plan') {
      streams.stderr.write('Usage: metro contract move-plan preflight|apply ...\n');
      return 1;
    }

    if (positional[2] === 'preflight') {
      return ops.runPreflight(flagObj, streams).then((r) => r.exitCode);
    }

    if (positional[2] === 'apply') {
      const out = ops.runApply(flagObj, streams);
      if (out && typeof out.then === 'function') {
        return out.then((r) => r.exitCode);
      }
      return out.exitCode;
    }

    if (positional[2] === 'bulk-preflight') {
      return ops.runBulkPreflight(flagObj, streams).then((r) => r.exitCode);
    }

    if (positional[2] === 'bulk-apply') {
      return ops.runBulkApply(flagObj, streams).then((r) => r.exitCode);
    }

    streams.stderr.write([
      'Usage:',
      '  metro contract move-plan preflight --to=<alias> (--customer-id=| --external-id=| --ingest-alias=| --name=) [--from=<alias>] (--sandbox|--prod)',
      '  metro contract move-plan apply --file <move.json> --confirm-hash <sha256:…> (--sandbox|--prod) [--apply]',
      '  metro customer resolve (--customer-id=| --external-id=| --ingest-alias=| --name=) (--sandbox|--prod)',
      '  metro ops who <paste> (--sandbox|--prod)',
    ].join('\n'));
    return flags.help ? 0 : 1;
  } catch (err) {
    streams.stderr.write(`\nFATAL: ${err.message}\n`);
    if (err.responseData) streams.stderr.write(`${JSON.stringify(err.responseData).slice(0, 900)}\n`);
    return 1;
  }
}

module.exports = {
  runContractMovePlanCommand,
};
