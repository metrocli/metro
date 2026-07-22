'use strict';

const path = require('path');
const { resolvePackId } = require('../workspace/loader');

function loadLevBillingProviderCutoverOps() {
  if (resolvePackId() !== 'lev') {
    return null;
  }
  try {
    const packRoot = path.join(__dirname, '..', '..', '..', 'metro-workspace-lev', 'src', 'ops', 'billing-provider-cutover.js');
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
      'METRO_WORKSPACE_PACK=lev metro billing-provider cutover preflight --help',
      'metro workspace explain --json',
    ],
  };
  streams.stderr.write(`${JSON.stringify(payload, null, 2)}\n`);
  return 2;
}

function runBillingProviderCutoverCommand(positional, flags, streams, argv = []) {
  const ops = loadLevBillingProviderCutoverOps();
  if (!ops) {
    return refuseUnavailable(streams, positional.join(' '), 'Workspace pack with live ops required for billing-provider cutover preflight/apply.');
  }

  const flagObj = { ...flags, argv };

  try {
    if (positional[0] !== 'billing-provider' || positional[1] !== 'cutover') {
      streams.stderr.write('Usage: metro billing-provider cutover preflight|apply ...\n');
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
      '  metro billing-provider cutover preflight --collection-method=send_invoice|charge_automatically --reason="<why>" (--customer-id=|--lev-id=|--ingest-alias=|--name=) (--sandbox|--prod)',
      '  metro billing-provider cutover apply --file <cutover.json> --confirm-hash <sha256:…> (--sandbox|--prod) [--apply]',
    ].join('\n'));
    return flags.help ? 0 : 1;
  } catch (err) {
    streams.stderr.write(`\nFATAL: ${err.message}\n`);
    if (err.responseData) streams.stderr.write(`${JSON.stringify(err.responseData).slice(0, 900)}\n`);
    return 1;
  }
}

module.exports = {
  runBillingProviderCutoverCommand,
};
