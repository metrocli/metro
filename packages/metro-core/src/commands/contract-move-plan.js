'use strict';

const path = require('path');
const { resolvePackId } = require('../workspace/loader');
const { allowsLiveReadOps } = require('../ops-live/load');
const { runCustomerResolve } = require('../ops-live/run-customer-resolve');

function loadLevContractMovePlanOps() {
  if (resolvePackId() !== 'lev') {
    return null;
  }
  try {
    const packRoot = path.join(__dirname, '..', '..', '..', 'metro-workspace-lev', 'src', 'ops', 'contract-move-plan.js');
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
      'metro workspace use generic --write',
      'metro ops who <paste> --prod',
      'metro plan package-plan-move --sandbox --json',
    ],
  };
  streams.stderr.write(`${JSON.stringify(payload, null, 2)}\n`);
  return 2;
}

function runContractMovePlanCommand(positional, flags, streams, argv = []) {
  if (positional[0] === 'customer' && positional[1] === 'resolve') {
    if (!allowsLiveReadOps()) {
      return refuseUnavailable(streams, positional.join(' '), 'A workspace pack with live ops is required for customer resolve.');
    }
    const flagObj = { ...flags, argv, 'lev-id': flags['lev-id'] || flags['external-id'] || null };
    return runCustomerResolve(flagObj, streams).then((r) => r.exitCode, (err) => {
      streams.stderr.write(`\nFATAL: ${err.message}\n`);
      return 1;
    });
  }

  const ops = loadLevContractMovePlanOps();
  if (!ops) {
    return refuseUnavailable(streams, positional.join(' '), 'Workspace pack with live ops required for contract move-plan preflight/apply. On generic: metro plan package-plan-move + validate/preview.');
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
