'use strict';

const { resolvePackId } = require('../workspace/loader');
const { SANDBOX_REFERENCE_CATALOG: LEV_SANDBOX_CATALOG } = require('../workspace/catalog-bindings');

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
  lev: Object.freeze({
    schemaVersion: 'metro.profiles.v1',
    defaultProfile: 'lev-sandbox',
    profiles: {
      'lev-sandbox': {
        tenant: 'sandbox',
        metronomeKeyEnv: 'METRONOME_SANDBOX_KEY',
        workspaceCatalog: LEV_SANDBOX_CATALOG,
      },
      'lev-production': {
        tenant: 'production',
        metronomeKeyEnv: 'METRONOME_PROD_KEY',
      },
    },
  }),
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
  lev: Object.freeze({
    filename: 'pro-annual.json',
    shape: 'pro-annual',
    previewCommand: 'metro package preview --shape pro-annual',
    input: {
      packageAlias: 'pro_annual',
      uniquenessKey: 'pkg:lev-pro-annual:2126-07-01',
      rateCardId: 'rate-card-test',
      startingAt: '2126-07-01T00:00:00.000Z',
      annualPriceCents: 120000,
      billingFrequency: 'ANNUAL',
      billingProvider: {
        configured: true,
        deliveryMethod: 'direct_to_billing_provider',
      },
      stripeBehavior: 'leave_draft',
    },
  }),
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
  return 'lev';
}

function getQuickstartPackConfig(packId = 'lev') {
  const id = PACK_PROFILES[packId] ? packId : 'lev';
  return {
    packId: id,
    profiles: PACK_PROFILES[id],
    annual: PACK_ANNUAL_INPUT[id] || PACK_ANNUAL_INPUT.lev,
    workspaceOrientationNote: id === 'lev'
      ? 'Catalog pattern, tier cards, and workspace intents'
      : 'Generic workspace intents and user-bound workspaceCatalog placeholders',
    planTemplateIntent: id === 'lev' ? 'annual-self-serve-package' : 'annual-subscription-package',
    quickstartDoc: id === 'lev'
      ? 'packages/metro-workspace-lev/docs/TEAM-QUICKSTART-LEV.md'
      : 'docs/metronome-cli/QUICKSTART.md',
    oneGoalDoc: id === 'lev'
      ? 'packages/metro-workspace-lev/docs/one-goal-lev.md'
      : 'docs/metronome-cli/one-goal.md',
  };
}

module.exports = {
  PACK_PROFILES,
  PACK_ANNUAL_INPUT,
  resolveQuickstartPackId,
  getQuickstartPackConfig,
};
