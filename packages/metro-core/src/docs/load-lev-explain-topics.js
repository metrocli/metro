'use strict';

/**
 * Optional workspace pack docs for explain/gotcha topics.
 * Public @metro-dev/cli trees do not ship metro-workspace-lev — never hard-crash on boot.
 */
function stubLevExplainTopics() {
  const genericDoc = 'docs/metronome-cli/COOKBOOK.md';
  return {
    LEV_DOC_PATHS: Object.freeze({
      dimensionalRunbook: genericDoc,
      contractTransitionsRebuy: genericDoc,
      parentRepoInterview: genericDoc,
      oneGoal: 'docs/metronome-cli/one-goal.md',
      shapeCatalog: 'docs/metronome-cli/SHAPE_CATALOG.md',
      validationGuardrails: 'docs/metronome-cli/VALIDATION_AND_GUARDRAILS.md',
      gotchas: 'docs/metronome-cli/GOTCHAS.md',
    }),
    levWorkspaceRoutingSources() {
      return [genericDoc, 'docs/metronome-cli/QUICKSTART.md'];
    },
    buildDimensionalRateCardTopic() {
      return null;
    },
    buildSendInvoiceStripeTopic() {
      return null;
    },
    buildContractTransitionsRebuyTopic() {
      return null;
    },
  };
}

function loadLevExplainTopics() {
  try {
    // eslint-disable-next-line import/no-unresolved -- optional private pack
    return require('@metro-dev/metro-workspace/explain-topics');
  } catch (err) {
    if (err.code !== 'MODULE_NOT_FOUND') throw err;
  }
  try {
    return require('../../../metro-workspace-lev/src/explain-topics');
  } catch (err) {
    if (err.code !== 'MODULE_NOT_FOUND') throw err;
    return stubLevExplainTopics();
  }
}

module.exports = {
  loadLevExplainTopics,
  stubLevExplainTopics,
};
