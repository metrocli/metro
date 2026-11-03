'use strict';

/**
 * When metro detects a slow / thrashing path and a lasting shortcut exists,
 * attach this payload so agents prompt for a PR instead of heroically grepping forever.
 * Docs: docs/metronome-cli/site/agents.html#promote-codebase
 */

const PROMOTE_SCHEMA = 'metro.promote-codebase.v1';

const DEFAULT_MESSAGE = [
  'This can be faster.',
  'Draft a PR that adds a metro command, shape, validator, cookbook one-liner, or decision topic',
  'so the next person (and every agent) does not repeat this archaeology.',
  'You run/merge; prefer one lasting shortcut rooted in catalog + official sources + an offline test.',
].join(' ');

function buildPromoteCodebaseHint(options = {}) {
  const {
    reason = 'slow-path-detected',
    fasterPath = null,
    suggestedChange = null,
    suggestedPrTitle = null,
  } = options;

  return {
    schemaVersion: PROMOTE_SCHEMA,
    signal: true,
    reason,
    message: DEFAULT_MESSAGE,
    fasterPath: fasterPath || null,
    suggestedChange: suggestedChange || null,
    suggestedPrTitle: suggestedPrTitle || 'metro: shortcut the slow path we just hit',
    docs: [
      'metro docs explain --list --markdown',
      'See docs/metronome-cli/site/agents.md#promote-the-codebase',
      'https://github.com/metrocli/metro (open a PR)',
    ],
  };
}

/**
 * Decide whether route/ops should attach a promote hint.
 * Pure - caller passes already-known signals.
 */
function detectPromoteOpportunity({
  hasSnapshot = false,
  accountPattern = null,
  routed = null,
  goal = null,
} = {}) {
  if (!hasSnapshot) {
    return buildPromoteCodebaseHint({
      reason: 'no-tenant-snapshot',
      fasterPath: 'metro catalog bind --sandbox --write && metro tenant snapshot show --markdown',
      suggestedChange: 'Keep snapshot+classifier in the default agent loop; add pack cookbook lines for this account pattern once known.',
      suggestedPrTitle: 'metro: require tenant snapshot before freestyle API routing',
    });
  }

  if (accountPattern === 'unknown') {
    return buildPromoteCodebaseHint({
      reason: 'unknown-account-pattern',
      fasterPath: 'metro catalog bind --sandbox --write',
      suggestedChange: 'Extend account-classifier signals for this tenant shape so route/ops stop guessing.',
      suggestedPrTitle: 'metro: teach classifier about this account pattern',
    });
  }

  if (accountPattern === 'greenfield-needed' && goal && !/greenfield/i.test(String(goal))) {
    return buildPromoteCodebaseHint({
      reason: 'greenfield-without-greenfield-intent',
      fasterPath: 'metro plan greenfield-credits-product --sandbox --json',
      suggestedChange: 'Route vague credits/product language to greenfield-credits-product when snapshot pattern is greenfield-needed.',
      suggestedPrTitle: 'metro: auto-route greenfield-needed accounts to greenfield plan',
    });
  }

  if (routed?.refused) {
    return buildPromoteCodebaseHint({
      reason: 'refused-slow-api-path',
      fasterPath: routed.nextSafeStep || routed.recommendedIntent
        ? `metro plan ${routed.recommendedIntent} --sandbox --json`
        : 'metro route --goal "<goal>" --sandbox --json',
      suggestedChange: 'Add a cookbook / ops one-liner or decision topic so agents never pick the refused endpoint first.',
      suggestedPrTitle: `metro: cookbook shortcut for refused ${routed.endpointId || 'endpoint'}`,
    });
  }

  if (routed && routed.valid === false) {
    return buildPromoteCodebaseHint({
      reason: 'unmatched-goal',
      fasterPath: 'metro plan list --json && metro docs explain --list --markdown',
      suggestedChange: 'Add a workspace intent + keywords (or an explain topic) for this billing goal.',
      suggestedPrTitle: 'metro: intent for unmatched billing goal',
    });
  }

  return null;
}

module.exports = {
  PROMOTE_SCHEMA,
  buildPromoteCodebaseHint,
  detectPromoteOpportunity,
};
