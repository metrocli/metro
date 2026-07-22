'use strict';

const path = require('path');
const { resolvePackId } = require('../workspace/loader');

function loadLevContractExtendTrialOps() {
  if (resolvePackId() !== 'lev') {
    return null;
  }
  try {
    const packRoot = path.join(__dirname, '..', '..', '..', 'metro-workspace-lev', 'src', 'ops', 'contract-extend-trial.js');
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
      'METRO_WORKSPACE_PACK=lev metro contract extend-trial preflight --help',
      'metro workspace explain --json',
    ],
  };
  streams.stderr.write(`${JSON.stringify(payload, null, 2)}\n`);
  return 2;
}

function runContractExtendTrialCommand(positional, flags, streams, argv = []) {
  const ops = loadLevContractExtendTrialOps();
  if (!ops) {
    return refuseUnavailable(streams, positional.join(' '), 'Workspace pack with live ops required for contract extend-trial preflight/apply.');
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
      '  metro contract extend-trial preflight --extend-to=<ISO>|--extend-by-days=<N> (--customer-id=|--lev-id=|--ingest-alias=|--name=) (--sandbox|--prod)',
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
