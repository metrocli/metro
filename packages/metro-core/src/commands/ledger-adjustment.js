'use strict';

const { loadPackOp, refusePackOpUnavailable } = require('../workspace/pack-ops');

function loadLedgerAdjustmentOps() {
  return loadPackOp('ledger-adjustment');
}

function refuseUnavailable(streams, command, reason) {
  return refusePackOpUnavailable(streams, { command, op: 'ledger-adjustment', purpose: reason });
}

function runLedgerAdjustmentCommand(positional, flags, streams, argv = []) {
  const ops = loadLedgerAdjustmentOps();
  if (!ops) {
    return refuseUnavailable(streams, positional.join(' '), 'needed for ledger-adjustment preflight/apply');
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
      '  metro ledger-adjustment preflight --amount=<signed-int> [--balance-id=] --reason="<reason>" <customer> [--contract-id=] (--sandbox|--prod) [--out=ledger.json] [--json]',
      '  metro ledger-adjustment preflight --archive-balance-id=<balance-id> --reason="<reason>" <customer> (--sandbox|--prod) [--out=ledger.json] [--json]',
      '  metro ledger-adjustment preflight --grant=credit|commit --amount=<n> --product-id=<id> --starting-at=<UTC hour> --ending-before=<UTC hour> [--credit-type-id=<id>] [--grant-name=<name>] [--priority=<n>] [--contract-id=] --reason="<reason>" <customer> (--sandbox|--prod) [--out=ledger.json] [--json]',
      '    <customer> = --customer-id= | --external-id= | --ingest-alias= | --name= | --query=',
      '    additions that exceed a net-vs-bucket divergence also need --acknowledge-net-divergence=<token>',
      '  metro ledger-adjustment apply --file <ledger.json> --confirm-hash <sha256:…> (--sandbox|--prod) [--apply --confirm-live-apply=<token>|--confirm-prod-apply=<token>] [--json]',
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
