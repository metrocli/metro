'use strict';

const path = require('path');
const { resolvePackId } = require('../workspace/loader');

function loadLevDimensionalOps() {
  if (resolvePackId() !== 'lev') {
    return null;
  }
  try {
    // ponytail: commands/ → src/ → metro-core/ → packages/ (three ups, not two)
    const packRoot = path.join(__dirname, '..', '..', '..', 'metro-workspace-lev', 'src', 'ops', 'dimensional.js');
    return require(packRoot);
  } catch (err) {
    if (err.code !== 'MODULE_NOT_FOUND') throw err;
    return null;
  }
}

function loadNewCodeOps() {
  try {
    // ponytail: same three-up path as loadLevDimensionalOps
    const packRoot = path.join(__dirname, '..', '..', '..', 'metro-workspace-lev', 'src', 'ops', 'dimensional-new-code.js');
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
      'METRO_WORKSPACE_PACK=lev metro dimensional new-code --help',
      'metro workspace explain --json',
    ],
  };
  streams.stderr.write(`${JSON.stringify(payload, null, 2)}\n`);
  return 2;
}

async function runDimensionalCommand(positional, flags, streams, argv = []) {
  const sub = positional[1];
  const levOps = loadLevDimensionalOps();
  const newCodeOps = loadNewCodeOps();

  if (sub === 'new-code') {
    if (!newCodeOps?.runDimensionalNewCode) {
      return refuseUnavailable(streams, 'dimensional new-code', 'Workspace pack with live ops required for production dimensional new-code execution.');
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
    if (!levOps) {
      return refuseUnavailable(streams, 'dimensional cutover', 'Workspace pack with live ops required for bulk dimensional cutover.');
    }
    try {
      if (action === 'plan') {
        const { exitCode } = await levOps.runCutoverPlan(flags, streams);
        return exitCode;
      }
      if (action === 'apply') {
        const { exitCode } = await levOps.runCutoverApply(flags, streams);
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
    '  metro dimensional new-code --all --code=<CODE> --credits=<N> [--display-name=<label>] [--now|--starting-at=<ISO>]',
    '  metro dimensional new-code --sandbox|--prod|--all ...   (default: --all when tenant omitted)',
    '  metro dimensional new-code --apply --confirm-prod-apply=I_UNDERSTAND_BILLING_SIDE_EFFECTS ...',
    '  metro dimensional cutover plan --prod [--only-keys=payg,core,...] [--cutover=ISO]',
    '  metro dimensional cutover apply --prod --manifest=<path> [--apply] [--confirm-manifest-sha256=<sha256>]',
  ].join('\n'));
  return flags.help ? 0 : 1;
}

module.exports = {
  runDimensionalCommand,
};
