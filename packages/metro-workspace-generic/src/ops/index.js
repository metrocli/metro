'use strict';

/**
 * Generic live ops, keyed by op name (see metro-core/src/workspace/pack-ops.js).
 * Lazy loaders keep `require('@metronome/metro-workspace-generic')` cheap.
 * Every write op: preflight (read-only, sha256 plan) -> apply dry run ->
 * apply --apply with the tenant's typed token -> read-back (exit 3 on mismatch).
 */

const pick = (file, exportName) => () => {
  const op = require(file)[exportName];
  return { runPreflight: op.runPreflight, runApply: op.runApply, op };
};

const ops = Object.freeze({
  // Ported lifecycle ops
  'contract-expire': pick('./contract-end-date', 'contractExpire'),
  'contract-extend-trial': pick('./contract-end-date', 'contractExtendTrial'),
  'contract-move-plan': () => {
    const m = require('./contract-move-plan');
    return {
      runPreflight: m.contractMovePlan.runPreflight,
      runApply: m.contractMovePlan.runApply,
      runBulkPreflight: m.runBulkPreflight,
      runBulkApply: m.runBulkApply,
    };
  },
  'contract-repair-accidental': pick('./contract-repair-accidental', 'contractRepairAccidental'),
  'ledger-adjustment': pick('./ledger-adjustment', 'ledgerAdjustment'),
  'billing-provider-cutover': pick('./billing-provider-cutover', 'billingProviderCutover'),
  'package-clone-version': pick('./package-clone-version', 'packageCloneVersion'),
  'dimensional-new-code': () => require('./dimensional'),
  // Read-only
  'customer-balances': () => ({ runList: require('./read-ops').runCustomerBalances }),
  'package-customers': () => ({ runLookup: require('./read-ops').runPackageCustomers }),
  // Provisioning
  'customer-create': pick('./customer-create', 'customerCreate'),
  'ratecard-create': pick('./ratecard', 'ratecardCreate'),
  'ratecard-add-rates': pick('./ratecard', 'ratecardAddRates'),
  'package-create': pick('./package-create', 'packageCreate'),
  'contract-create': pick('./contract-create', 'contractCreate'),
  'subscription-add': pick('./subscription', 'subscriptionAdd'),
  'subscription-set-quantity': pick('./subscription', 'subscriptionSetQuantity'),
  'subscription-seats': pick('./subscription', 'subscriptionSeats'),
});

module.exports = { ops };
