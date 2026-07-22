'use strict';

const path = require('path');
const { resolvePackId } = require('../workspace/loader');

function loadLevLedgerAdjustmentOps() {
  if (resolvePackId() !== 'lev') {
    return null;
  }
  try {
    const packRoot = path.join(__dirname, '..', '..', '..', 'metro-workspace-lev', 'src', 'ops', 'ledger-adjustment.js');
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
      'METRO_WORKSPACE_PACK=lev metro ledger-adjustment preflight --help',
      'metro workspace explain --json',
    ],
  };
  streams.stderr.write(`${JSON.stringify(payload, null, 2)}\n`);
  return 2;
}

function runLedgerAdjustmentCommand(positional, flags, streams, argv = []) {
  const ops = loadLevLedgerAdjustmentOps();
  if (!ops) {
    return refuseUnavailable(streams, positional.join(' '), 'Workspace pack with live ops required for ledger-adjustment preflight/apply.');
  }

  const flagObj = { ...flags, argv };

  try {
    if (positional[0] !== 'ledger-adjustment') {
      streams.stderr.write('Usage: metro ledger-adjustment preflight|apply ...\n');
      return 1;
    }

    if (positional[1] === 'preflight') {
      return ops.runPreflight(flagObj, streams).then((r) => r.exitCode);
    }

    if (positional[1] === 'apply') {
      const out = ops.runApply(flagObj, streams);
      if (out && typeof out.then === 'function') {
        return out.then((r) => r.exitCode);
      }
      return out.exitCode;
    }

    streams.stderr.write([
      'Usage:',
      '  metro ledger-adjustment preflight --amount=<signed-int> --reason="<reason>" (--customer-id=|--lev-id=|--ingest-alias=|--name=) [--contract-id=] [--balance-id=] (--sandbox|--prod)',
      '  metro ledger-adjustment apply --file <ledger.json> --confirm-hash <sha256:…> (--sandbox|--prod) [--apply]',
    ].join('\n'));
    return flags.help ? 0 : 1;
  } catch (err) {
    streams.stderr.write(`\nFATAL: ${err.message}\n`);
    if (err.responseData) streams.stderr.write(`${JSON.stringify(err.responseData).slice(0, 900)}\n`);
    return 1;
  }
}

module.exports = {
  runLedgerAdjustmentCommand,
};
