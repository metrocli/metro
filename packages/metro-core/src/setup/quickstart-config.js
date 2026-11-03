'use strict';

const { resolvePackId } = require('../workspace/loader');

function loadGenericCatalog() {
  try {
    return require('@metronome/metro-workspace-generic').SANDBOX_REFERENCE_CATALOG;
  } catch (err) {
    if (err.code !== 'MODULE_NOT_FOUND') throw err;
    return require('../../../metro-workspace-generic/src/catalog-bindings').SANDBOX_REFERENCE_CATALOG;
  }
}

const GENERIC_SANDBOX_CATALOG = loadGenericCatalog();

const PACK_PROFILES = Object.freeze({
  generic: Object.freeze({
    schemaVersion: 'metro.profiles.v1',
    defaultProfile: 'metro-sandbox',
    profiles: {
      'metro-sandbox': {
        tenant: 'sandbox',
        metronomeKeyEnv: 'METRONOME_SANDBOX_KEY',
        workspaceCatalog: GENERIC_SANDBOX_CATALOG,
      },
      'metro-production': {
        tenant: 'production',
        metronomeKeyEnv: 'METRONOME_PROD_KEY',
      },
    },
  }),
  stub: Object.freeze({
    schemaVersion: 'metro.profiles.v1',
    defaultProfile: 'metro-sandbox',
    profiles: {
      'metro-sandbox': {
        tenant: 'sandbox',
        metronomeKeyEnv: 'METRONOME_SANDBOX_KEY',
      },
    },
  }),
});

const PACK_ANNUAL_INPUT = Object.freeze({
  generic: Object.freeze({
    filename: 'annual-package.json',
    shape: 'pro-annual-self-serve-v2',
    previewCommand: 'metro package preview --shape pro-annual-self-serve-v2',
    input: {
      packageAlias: 'pro_annual',
      uniquenessKey: 'pkg:pro-annual:2126-07-01',
      rateCardId: '<sandbox-rate-card-id>',
      startingAt: '2126-07-01T00:00:00.000Z',
      annualPlanFeeCents: 120000,
      billingFrequency: 'ANNUAL',
      creditGrantMode: 'monthly-drip',
      annualCreditsTotal: 24000,
      monthlyCreditDripAmount: 2000,
      billingProvider: {
        configured: true,
        deliveryMethod: 'direct_to_billing_provider',
      },
      stripeBehavior: 'leave_draft',
    },
  }),
  stub: Object.freeze({
    filename: 'annual-package.json',
    shape: 'pro-annual',
    previewCommand: 'metro package preview --shape pro-annual',
    input: {
      packageAlias: 'pro_annual',
      uniquenessKey: 'pkg:pro-annual:2126-07-01',
      rateCardId: 'rate-card-test',
      startingAt: '2126-07-01T00:00:00.000Z',
      annualPriceCents: 120000,
      billingFrequency: 'ANNUAL',
      billingProvider: { configured: true, deliveryMethod: 'direct_to_billing_provider' },
      stripeBehavior: 'leave_draft',
    },
  }),
});

function resolveQuickstartPackId(options = {}) {
  const requested = options.workspacePack || options.workspace || null;
  if (requested && PACK_PROFILES[requested]) return requested;
  const envPack = resolvePackId();
  if (PACK_PROFILES[envPack]) return envPack;
  return 'generic';
}

function getQuickstartPackConfig(packId = 'generic') {
  const id = PACK_PROFILES[packId] ? packId : 'generic';
  return {
    packId: id,
    profiles: PACK_PROFILES[id],
    annual: PACK_ANNUAL_INPUT[id] || PACK_ANNUAL_INPUT.generic,
    workspaceOrientationNote: 'Generic workspace intents and user-bound workspaceCatalog placeholders',
    planTemplateIntent: 'annual-subscription-package',
    quickstartDoc: 'docs/metronome-cli/QUICKSTART.md',
    oneGoalDoc: 'docs/metronome-cli/one-goal.md',
  };
}

module.exports = {
  PACK_PROFILES,
  PACK_ANNUAL_INPUT,
  resolveQuickstartPackId,
  getQuickstartPackConfig,
};
