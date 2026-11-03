'use strict';

const { loadPackOp, refusePackOpUnavailable } = require('../workspace/pack-ops');

function loadContractExpireOps() {
  return loadPackOp('contract-expire');
}

function refuseUnavailable(streams, command, reason) {
  return refusePackOpUnavailable(streams, { command, op: 'contract-expire', purpose: reason });
}

function runContractExpireCommand(positional, flags, streams, argv = []) {
  const ops = loadContractExpireOps();
  if (!ops) {
    return refuseUnavailable(streams, positional.join(' '), 'needed for contract expire preflight/apply');
  }

  const flagObj = { ...flags, argv };

  try {
    if (positional[0] !== 'contract' || positional[1] !== 'expire') {
      streams.stderr.write('Usage: metro contract expire preflight|apply ...\n');
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
      '  metro contract expire preflight (--customer-id=|--external-id=|--ingest-alias=|--name=|--query=) [--contract-id=] [--cutover-mode=current-hour|next-hour|--ending-before=<ISO>] [--allow-ending-before-finalized-invoice] (--sandbox|--prod) [--out=expire.json] [--json]',
      '  metro contract expire apply --file <expire.json> --confirm-hash <sha256:…> (--sandbox|--prod) [--apply --confirm-live-apply=<token>|--confirm-prod-apply=<token>] [--json]',
    ].join('\n'));
    return flags.help ? 0 : 1;
  } catch (err) {
    streams.stderr.write(`\nFATAL: ${err.message}\n`);
    if (err.responseData) streams.stderr.write(`${JSON.stringify(err.responseData).slice(0, 900)}\n`);
    return 1;
  }
}

module.exports = {
  runContractExpireCommand,
};
