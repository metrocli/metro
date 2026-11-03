'use strict';

const { loadPackOp, refusePackOpUnavailable } = require('../workspace/pack-ops');
const { loadPackageListOps: loadCorePackageListOps } = require('../ops-live/load');

function loadPackageListOps() {
  // Pack-provided op first, then the generic read-only implementation in core.
  return loadPackOp('package-list') || loadCorePackageListOps();
}

function refuseUnavailable(streams, command, reason) {
  return refusePackOpUnavailable(streams, { command, op: 'package-list', purpose: reason });
}

function runPackageListCommand(positional, flags, streams, argv = []) {
  const ops = loadPackageListOps();
  if (!ops) {
    return refuseUnavailable(streams, positional.join(' '), 'needed for package inventory listing');
  }

  const flagObj = { ...flags, argv };

  try {
    if (positional[0] !== 'package' || positional[1] !== 'list') {
      streams.stderr.write('Usage: metro package list [--package-id=<id>|--alias=<alias>|--search=<text>] [--only-archived|--only-active] [--out=<file.json>] (--sandbox|--prod) [--json]\n');
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
  runPackageListCommand,
};
