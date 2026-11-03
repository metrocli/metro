'use strict';

const path = require('path');
const { resolvePackId } = require('../workspace/loader');

const LOCAL_ROOT = path.join(__dirname);

/** Every real pack may run guarded live reads; the stub pack is offline-only. */
function allowsLiveReadOps(packId = resolvePackId()) {
  return Boolean(packId) && packId !== 'stub';
}

function tryRequire(candidates) {
  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch (err) {
      if (err.code !== 'MODULE_NOT_FOUND') throw err;
    }
  }
  return null;
}

function loadWhoOps() {
  if (!allowsLiveReadOps()) return null;
  return tryRequire([path.join(LOCAL_ROOT, 'who.js')]);
}

function loadCustomerResolve() {
  if (!allowsLiveReadOps()) return null;
  return tryRequire([path.join(LOCAL_ROOT, 'customer-resolve.js')]);
}

function loadPackageListOps() {
  if (!allowsLiveReadOps()) return null;
  return tryRequire([path.join(LOCAL_ROOT, 'package-list.js')]);
}

function loadCustomerBalancesOps() {
  if (!allowsLiveReadOps()) return null;
  return tryRequire([path.join(LOCAL_ROOT, 'customer-balances.js')]);
}

module.exports = {
  allowsLiveReadOps,
  loadWhoOps,
  loadCustomerResolve,
  loadPackageListOps,
  loadCustomerBalancesOps,
};
