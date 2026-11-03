'use strict';

const { loadPackOp, refusePackOpUnavailable } = require('../workspace/pack-ops');

function loadDimensionalOps() {
  return loadPackOp('dimensional');
}

function loadNewCodeOps() {
  return loadPackOp('dimensional-new-code');
}

function refuseUnavailable(streams, command, op, reason) {
  return refusePackOpUnavailable(streams, { command, op, purpose: reason });
}

async function runDimensionalCommand(positional, flags, streams, argv = []) {
  const sub = positional[1];
  const cutoverOps = loadDimensionalOps();
  const newCodeOps = loadNewCodeOps();

  if (sub === 'new-code') {
    if (!newCodeOps?.runDimensionalNewCode) {
      return refuseUnavailable(streams, 'dimensional new-code', 'dimensional-new-code', 'needed for production dimensional new-code execution');
    }
    try {
      const { exitCode } = await newCodeOps.runDimensionalNewCode({ ...flags, argv }, streams);
      return exitCode;
    } catch (err) {
      streams.stderr.write(`\nFATAL: ${err.responseData ? JSON.stringify(err.responseData) : err.message}\n`);
      return 1;
    }
  }

  if (sub === 'cutover') {
    const action = positional[2];
    if (!cutoverOps) {
      return refuseUnavailable(streams, 'dimensional cutover', 'dimensional', 'needed for bulk dimensional cutover');
    }
    try {
      if (action === 'plan') {
        const { exitCode } = await cutoverOps.runCutoverPlan(flags, streams);
        return exitCode;
      }
      if (action === 'apply') {
        const { exitCode } = await cutoverOps.runCutoverApply(flags, streams);
        return exitCode;
      }
      streams.stderr.write('Usage: metro dimensional cutover plan|apply --prod ...\n');
      return 1;
    } catch (err) {
      streams.stderr.write(`\nFATAL: ${err.responseData ? JSON.stringify(err.responseData) : err.message}\n`);
      return 1;
    }
  }

  streams.stderr.write([
    'Usage:',
    '  metro dimensional new-code preflight --product-id=<id> --rate-card-ids=<id>[,<id>] (--code=<CODE> [--display-name=<label>]|--group-values=<json>) --price=<n> --starting-at=<UTC hour> (--sandbox|--prod)',
    '  metro dimensional new-code apply --file <plan.json> --confirm-hash <sha256:...> (--sandbox|--prod) [--apply --confirm-live-apply=<token>|--confirm-prod-apply=<token>]',
    '  (the tenant is never inferred: pass --sandbox or --prod)',
    '  metro dimensional cutover plan --prod [--only-keys=payg,core,...] [--cutover=ISO]',
    '  metro dimensional cutover apply --prod --manifest=<path> [--apply] [--confirm-manifest-sha256=<sha256>]',
  ].join('\n'));
  return flags.help ? 0 : 1;
}

module.exports = {
  runDimensionalCommand,
};
