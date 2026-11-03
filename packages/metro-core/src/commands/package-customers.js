'use strict';

const { loadPackOp, refusePackOpUnavailable } = require('../workspace/pack-ops');

function loadPackageCustomersOps() {
  return loadPackOp('package-customers');
}

function refuseUnavailable(streams, command, reason) {
  return refusePackOpUnavailable(streams, { command, op: 'package-customers', purpose: reason });
}

function runPackageCustomersCommand(positional, flags, streams, argv = []) {
  const ops = loadPackageCustomersOps();
  if (!ops) {
    return refuseUnavailable(streams, positional.join(' '), 'needed for package customers lookup');
  }

  const flagObj = { ...flags, argv };

  try {
    if (positional[0] !== 'package' || positional[1] !== 'customers') {
      streams.stderr.write('Usage: metro package customers --package-id=<id>|--alias=<alias> (--sandbox|--prod) [--json]\n');
      return 1;
    }

    const out = ops.runLookup(flagObj, streams);
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
  runPackageCustomersCommand,
};
