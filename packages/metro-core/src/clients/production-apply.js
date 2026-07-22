'use strict';

const { assertOperatorModeAllows } = require('../setup/mode');

const LIVE_PROD_APPLY_CONFIRMATION = 'I_UNDERSTAND_BILLING_SIDE_EFFECTS';

function readConfirmFromArgv(argv = process.argv) {
  const raw = argv.find((a) => typeof a === 'string' && a.startsWith('--confirm-prod-apply='));
  return raw ? raw.slice('--confirm-prod-apply='.length) : null;
}

function readProductionApplyConfirmation(flags = {}) {
  return process.env.ALLOW_DANGEROUS_SCRIPT
    || process.env.METRO_CONFIRM_PROD_APPLY
    || flags['confirm-prod-apply']
    || flags.confirmProdApply
    // makeClient historically passed flags:{} - still honor the CLI flag from argv
    || readConfirmFromArgv();
}

function assertProductionApplyAuthorized(options = {}) {
  const { apply = false, prod = false, flags = {} } = options;
  if (!apply) return;

  assertOperatorModeAllows('live-write');

  if (!prod) return;

  const confirmed = readProductionApplyConfirmation(flags);
  if (confirmed !== LIVE_PROD_APPLY_CONFIRMATION) {
    const error = new Error(
      `Production apply requires ALLOW_DANGEROUS_SCRIPT=${LIVE_PROD_APPLY_CONFIRMATION}, `
      + `METRO_CONFIRM_PROD_APPLY=${LIVE_PROD_APPLY_CONFIRMATION}, or `
      + `--confirm-prod-apply=${LIVE_PROD_APPLY_CONFIRMATION}`,
    );
    error.code = 'MTR-PROD-APPLY-BLOCKED';
    throw error;
  }
}

module.exports = {
  LIVE_PROD_APPLY_CONFIRMATION,
  assertProductionApplyAuthorized,
  readProductionApplyConfirmation,
  readConfirmFromArgv,
};
