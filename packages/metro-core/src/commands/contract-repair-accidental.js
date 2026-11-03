'use strict';

const { loadPackOp, refusePackOpUnavailable } = require('../workspace/pack-ops');

function loadContractRepairAccidentalOps() {
  return loadPackOp('contract-repair-accidental');
}

function refuseUnavailable(streams, command, reason) {
  return refusePackOpUnavailable(streams, { command, op: 'contract-repair-accidental', purpose: reason });
}

function runContractRepairAccidentalCommand(positional, flags, streams, argv = []) {
  const ops = loadContractRepairAccidentalOps();
  if (!ops) {
    return refuseUnavailable(streams, positional.join(' '), 'needed for contract repair-accidental preflight/apply');
  }

  const flagObj = { ...flags, argv };

  try {
    if (positional[0] !== 'contract' || positional[1] !== 'repair-accidental') {
      streams.stderr.write('Usage: metro contract repair-accidental preflight|apply ...\n');
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
      '  metro contract repair-accidental preflight --archive-contract-id=<id> --keep-contract-id=<id> --reason="<why accidental>" (--customer-id=|--external-id=|--ingest-alias=|--name=) [--restore-ending-before=<ISO>] (--sandbox|--prod)',
      '  metro contract repair-accidental apply --file <repair.json> --confirm-hash <sha256:…> (--sandbox|--prod) [--apply]',
    ].join('\n'));
    return flags.help ? 0 : 1;
  } catch (err) {
    streams.stderr.write(`\nFATAL: ${err.message}\n`);
    if (err.responseData) streams.stderr.write(`${JSON.stringify(err.responseData).slice(0, 900)}\n`);
    return 1;
  }
}

module.exports = {
  runContractRepairAccidentalCommand,
};
