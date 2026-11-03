'use strict';

const { loadPackOp, refusePackOpUnavailable } = require('../workspace/pack-ops');

function loadBillingProviderCutoverOps() {
  return loadPackOp('billing-provider-cutover');
}

function refuseUnavailable(streams, command, reason) {
  return refusePackOpUnavailable(streams, { command, op: 'billing-provider-cutover', purpose: reason });
}

function runBillingProviderCutoverCommand(positional, flags, streams, argv = []) {
  const ops = loadBillingProviderCutoverOps();
  if (!ops) {
    return refuseUnavailable(streams, positional.join(' '), 'needed for billing-provider cutover preflight/apply');
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
      '  metro billing-provider cutover preflight --collection-method=send_invoice|charge_automatically --reason="<why>" (--customer-id=|--external-id=|--ingest-alias=|--name=) (--sandbox|--prod)',
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
