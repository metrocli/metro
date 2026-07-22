'use strict';

const path = require('path');
const { resolvePackId } = require('../workspace/loader');

function loadLevPackageListOps() {
  if (resolvePackId() !== 'lev') {
    return null;
  }
  try {
    const packRoot = path.join(__dirname, '..', '..', '..', 'metro-workspace-lev', 'src', 'ops', 'package-list.js');
    return require(packRoot);
  } catch (err) {
    if (err.code !== 'MODULE_NOT_FOUND') throw err;
    return null;
  }
}

function refuseUnavailable(streams, command, reason) {
  const payload = {
    schemaVersion: 'metro.refusal.v1',
    refused: true,
    command,
    reason,
    nextCommands: [
      'METRO_WORKSPACE_PACK=lev metro package list --help',
      'metro workspace explain --json',
    ],
  };
  streams.stderr.write(`${JSON.stringify(payload, null, 2)}\n`);
  return 2;
}

function runPackageListCommand(positional, flags, streams, argv = []) {
  const ops = loadLevPackageListOps();
  if (!ops) {
    return refuseUnavailable(streams, positional.join(' '), 'Workspace pack with live ops required for package inventory listing.');
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
