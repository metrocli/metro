'use strict';

const { loadPackOp, refusePackOpUnavailable } = require('../workspace/pack-ops');

function loadContractExtendTrialOps() {
  return loadPackOp('contract-extend-trial');
}

function refuseUnavailable(streams, command, reason) {
  return refusePackOpUnavailable(streams, { command, op: 'contract-extend-trial', purpose: reason });
}

function runContractExtendTrialCommand(positional, flags, streams, argv = []) {
  const ops = loadContractExtendTrialOps();
  if (!ops) {
    return refuseUnavailable(streams, positional.join(' '), 'needed for contract extend-trial preflight/apply');
  }

  const flagObj = { ...flags, argv };

  try {
    if (positional[0] !== 'contract' || positional[1] !== 'extend-trial') {
      streams.stderr.write('Usage: metro contract extend-trial preflight|apply ...\n');
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

    streams.stderr.write([
      'Usage:',
      '  metro contract extend-trial preflight --extend-to=<ISO>|--extend-by-days=<N> (--customer-id=|--external-id=|--ingest-alias=|--name=) (--sandbox|--prod)',
      '  metro contract extend-trial apply --file <extend.json> --confirm-hash <sha256:…> (--sandbox|--prod) [--apply]',
    ].join('\n'));
    return flags.help ? 0 : 1;
  } catch (err) {
    streams.stderr.write(`\nFATAL: ${err.message}\n`);
    if (err.responseData) streams.stderr.write(`${JSON.stringify(err.responseData).slice(0, 900)}\n`);
    return 1;
  }
}

module.exports = {
  runContractExtendTrialCommand,
};
