'use strict';

const DEFAULT_AGENT_HINTS = [
  'Load metro tenant snapshot show --markdown before freestyle API writes',
];

function buildAgentHints(classification, promote) {
  const hints = [];
  if (classification?.nextCommands?.length) {
    hints.push(...classification.nextCommands);
  }
  hints.push(...DEFAULT_AGENT_HINTS);
  if (promote?.signal) {
    hints.push(`PROMOTE: ${promote.message}`);
    if (promote.fasterPath) hints.push(`Faster path: ${promote.fasterPath}`);
    if (promote.suggestedPrTitle) hints.push(`Suggested PR: ${promote.suggestedPrTitle}`);
  }
  return hints;
}

function enrichRouteResult(routePayload, { classification, snapshotMeta, promoteCodebase } = {}) {
  if (routePayload == null) {
    return null;
  }

  return {
    ...routePayload,
    accountPattern: classification?.pattern || null,
    classificationConfidence: classification?.confidence || null,
    classificationReasons: classification?.reasons || [],
    snapshotPath: snapshotMeta?.path || null,
    snapshotCapturedAt: snapshotMeta?.capturedAt || null,
    promoteCodebase: promoteCodebase || null,
    agentHints: buildAgentHints(classification, promoteCodebase),
  };
}

module.exports = {
  enrichRouteResult,
};
