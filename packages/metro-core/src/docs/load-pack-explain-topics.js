'use strict';

/**
 * Optional workspace pack docs for explain/gotcha topics.
 *
 * A workspace pack may export `explainTopics` with the same keys as the stub
 * below to contribute tenant-specific runbooks. Packs without it (generic,
 * stub) get the stub, which points at the public docs. Never hard-crash on boot.
 */
function stubPackExplainTopics() {
  const genericDoc = 'docs/metronome-cli/COOKBOOK.md';
  return {
    PACK_DOC_PATHS: Object.freeze({
      dimensionalRunbook: genericDoc,
      contractTransitionsRebuy: genericDoc,
      parentRepoInterview: genericDoc,
      oneGoal: 'docs/metronome-cli/one-goal.md',
      shapeCatalog: 'docs/metronome-cli/SHAPE_CATALOG.md',
      validationGuardrails: 'docs/metronome-cli/VALIDATION_AND_GUARDRAILS.md',
      gotchas: 'docs/metronome-cli/GOTCHAS.md',
    }),
    workspaceRoutingSources() {
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

function loadPackExplainTopics() {
  const stub = stubPackExplainTopics();
  let fromPack = null;
  try {
    const { resolvePackId, loadWorkspacePack } = require('../workspace/loader');
    const pack = loadWorkspacePack(resolvePackId());
    fromPack = pack && typeof pack.explainTopics === 'object' ? pack.explainTopics : null;
  } catch (err) {
    if (err.code !== 'MODULE_NOT_FOUND') throw err;
  }
  if (!fromPack) return stub;
  return {
    ...stub,
    ...fromPack,
    PACK_DOC_PATHS: Object.freeze({ ...stub.PACK_DOC_PATHS, ...(fromPack.PACK_DOC_PATHS || {}) }),
  };
}

module.exports = {
  loadPackExplainTopics,
  stubPackExplainTopics,
};
