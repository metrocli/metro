'use strict';

const path = require('path');
const { resolvePackId } = require('../workspace/loader');

const LEV_OPS_ROOT = path.join(__dirname, '..', '..', '..', 'metro-workspace-lev', 'src', 'ops');
const LOCAL_ROOT = path.join(__dirname);

function allowsLiveReadOps(packId = resolvePackId()) {
  return packId === 'lev' || packId === 'generic';
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
  return tryRequire([
    path.join(LOCAL_ROOT, 'who.js'),
    path.join(LEV_OPS_ROOT, 'customer-snapshot', 'lib', 'who.js'),
  ]);
}

function loadCustomerResolve() {
  if (!allowsLiveReadOps()) return null;
  return tryRequire([
    path.join(LOCAL_ROOT, 'customer-resolve.js'),
    path.join(LEV_OPS_ROOT, 'contract-move-plan', 'lib', 'customer-resolve.js'),
  ]);
}

function loadPackageListOps() {
  if (!allowsLiveReadOps()) return null;
  return tryRequire([
    path.join(LOCAL_ROOT, 'package-list.js'),
    path.join(LEV_OPS_ROOT, 'package-list.js'),
  ]);
}

function loadCustomerBalancesOps() {
  if (!allowsLiveReadOps()) return null;
  return tryRequire([
    path.join(LOCAL_ROOT, 'customer-balances.js'),
    path.join(LEV_OPS_ROOT, 'customer-balances.js'),
  ]);
}

module.exports = {
  allowsLiveReadOps,
  loadWhoOps,
  loadCustomerResolve,
  loadPackageListOps,
  loadCustomerBalancesOps,
};
