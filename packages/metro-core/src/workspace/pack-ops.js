'use strict';

/**
 * Workspace pack ops seam.
 *
 * A workspace pack may export an `ops` map of live operations:
 *
 *   module.exports = {
 *     ...,
 *     ops: {
 *       'contract-expire': () => require('./ops/contract-expire'),
 *       'package-list': require('./ops/package-list'),
 *     },
 *   };
 *
 * Each entry is either the op module itself or a zero-argument loader that
 * returns it (preferred, so packs stay cheap to require). Commands look ops up
 * by name with loadPackOp(name) and refuse with refusePackOpUnavailable(...)
 * when the active pack does not provide one. Core never reaches into another
 * package's source tree for an op.
 */

const { resolvePackId, loadWorkspacePack } = require('./loader');

const PACK_OP_NAMES = Object.freeze([
  'billing-provider-cutover',
  'contract-expire',
  'contract-extend-trial',
  'contract-move-plan',
  'contract-repair-accidental',
  'customer-balances',
  'dimensional',
  'dimensional-new-code',
  'ledger-adjustment',
  'package-customers',
  'package-list',
]);

function safeLoadActivePack(packId) {
  try {
    return loadWorkspacePack(packId);
  } catch (err) {
    if (err.code === 'MODULE_NOT_FOUND') return null;
    throw err;
  }
}

function packOpsMap(pack) {
  if (!pack || typeof pack !== 'object') return {};
  const ops = pack.ops;
  return ops && typeof ops === 'object' ? ops : {};
}

function loadPackOp(name, options = {}) {
  const packId = options.packId || resolvePackId(options);
  const pack = options.pack || safeLoadActivePack(packId);
  const entry = packOpsMap(pack)[name];
  if (!entry) return null;
  if (typeof entry === 'function') {
    const mod = entry();
    return mod || null;
  }
  return entry;
}

function listPackOps(options = {}) {
  const packId = options.packId || resolvePackId(options);
  const pack = options.pack || safeLoadActivePack(packId);
  return Object.keys(packOpsMap(pack)).sort();
}

function refusePackOpUnavailable(streams, { command, op, purpose, nextCommands } = {}) {
  const packId = resolvePackId();
  const payload = {
    schemaVersion: 'metro.refusal.v1',
    refused: true,
    command: command || op,
    op,
    workspacePack: packId,
    reason: `Workspace pack "${packId}" does not provide the "${op}" operation${purpose ? ` (${purpose})` : ''}.`,
    nextSafeStep: 'Use a workspace pack that exports ops["' + op + '"], or stay on validate/preview for this change.',
    nextCommands: nextCommands || [
      'metro workspace list --json',
      'metro workspace explain --json',
    ],
  };
  streams.stderr.write(`${JSON.stringify(payload, null, 2)}\n`);
  return 2;
}

module.exports = {
  PACK_OP_NAMES,
  loadPackOp,
  listPackOps,
  refusePackOpUnavailable,
};
