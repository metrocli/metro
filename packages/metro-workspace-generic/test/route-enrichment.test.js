'use strict';

const assert = require('assert');
const { enrichRouteResult } = require('../src/route-enrichment');

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (error) {
    console.error(`  ✗ ${name}`);
    throw error;
  }
}

const sampleRoute = {
  schemaVersion: 'metro.route.v1',
  valid: true,
  routed: true,
  refused: false,
  intentId: 'credits-product-decision',
  match: { intentId: 'credits-product-decision', score: 0.9 },
  plan: { valid: true },
  nextCommands: ['metro plan credits-product-decision --sandbox --json'],
  nextSafeStep: 'metro plan credits-product-decision --sandbox --json',
};

const sampleClassification = {
  pattern: 'dimensional-shared-usage',
  confidence: 'high',
  reasons: ['sharedDimensionalProductId is bound', 'dimensionalBillableMetricId is bound'],
  nextCommands: [
    'metro plan add-pricing-dimension-value --sandbox --json',
    'metro dimensional new-code --sandbox --json',
  ],
};

const sampleSnapshotMeta = {
  path: '/Users/test/.metro/snapshots/sandbox.json',
  capturedAt: '2026-07-15T12:00:00.000Z',
};

test('returns null for null or undefined routePayload', () => {
  assert.strictEqual(enrichRouteResult(null), null);
  assert.strictEqual(enrichRouteResult(undefined), null);
});

test('does not mutate the input routePayload', () => {
  const route = { ...sampleRoute };
  const frozen = JSON.stringify(route);
  enrichRouteResult(route, {
    classification: sampleClassification,
    snapshotMeta: sampleSnapshotMeta,
  });
  assert.strictEqual(JSON.stringify(route), frozen);
  assert.ok(!('accountPattern' in route));
  assert.ok(!('agentHints' in route));
});

test('preserves existing route fields', () => {
  const enriched = enrichRouteResult(sampleRoute, {
    classification: sampleClassification,
    snapshotMeta: sampleSnapshotMeta,
  });

  assert.strictEqual(enriched.schemaVersion, sampleRoute.schemaVersion);
  assert.strictEqual(enriched.valid, sampleRoute.valid);
  assert.strictEqual(enriched.routed, sampleRoute.routed);
  assert.strictEqual(enriched.refused, sampleRoute.refused);
  assert.strictEqual(enriched.intentId, sampleRoute.intentId);
  assert.deepStrictEqual(enriched.match, sampleRoute.match);
  assert.deepStrictEqual(enriched.plan, sampleRoute.plan);
  assert.deepStrictEqual(enriched.nextCommands, sampleRoute.nextCommands);
  assert.strictEqual(enriched.nextSafeStep, sampleRoute.nextSafeStep);
});

test('maps classification and snapshot metadata', () => {
  const enriched = enrichRouteResult(sampleRoute, {
    classification: sampleClassification,
    snapshotMeta: sampleSnapshotMeta,
  });

  assert.strictEqual(enriched.accountPattern, 'dimensional-shared-usage');
  assert.strictEqual(enriched.classificationConfidence, 'high');
  assert.deepStrictEqual(enriched.classificationReasons, sampleClassification.reasons);
  assert.strictEqual(enriched.snapshotPath, sampleSnapshotMeta.path);
  assert.strictEqual(enriched.snapshotCapturedAt, sampleSnapshotMeta.capturedAt);
});

test('defaults enrichment fields when context is omitted', () => {
  const enriched = enrichRouteResult(sampleRoute);

  assert.strictEqual(enriched.accountPattern, null);
  assert.strictEqual(enriched.classificationConfidence, null);
  assert.deepStrictEqual(enriched.classificationReasons, []);
  assert.strictEqual(enriched.snapshotPath, null);
  assert.strictEqual(enriched.snapshotCapturedAt, null);
  assert.ok(Array.isArray(enriched.agentHints));
  assert.ok(enriched.agentHints.length >= 1);
});

test('merges classification nextCommands with default agent hints', () => {
  const enriched = enrichRouteResult(sampleRoute, {
    classification: sampleClassification,
  });

  assert.deepStrictEqual(
    enriched.agentHints.slice(0, sampleClassification.nextCommands.length),
    sampleClassification.nextCommands,
  );
  assert.ok(
    enriched.agentHints.some((hint) => hint.includes('metro tenant snapshot show --markdown')),
  );
  assert.strictEqual(
    enriched.agentHints[enriched.agentHints.length - 1],
    'Load metro tenant snapshot show --markdown before freestyle API writes',
  );
});

test('includes default agent hints when classification has no nextCommands', () => {
  const enriched = enrichRouteResult(sampleRoute, {
    classification: {
      pattern: 'unknown',
      confidence: 'low',
      reasons: ['insufficient catalog signals'],
    },
  });

  assert.deepStrictEqual(enriched.agentHints, [
    'Load metro tenant snapshot show --markdown before freestyle API writes',
  ]);
});

test('surfaces promoteCodebase in agentHints when provided', () => {
  const promote = {
    signal: true,
    message: 'This can be faster. Draft a PR.',
    fasterPath: 'metro catalog bind --sandbox --write',
    suggestedPrTitle: 'metro: require tenant snapshot',
  };
  const enriched = enrichRouteResult(sampleRoute, {
    classification: sampleClassification,
    snapshotMeta: sampleSnapshotMeta,
    promoteCodebase: promote,
  });
  assert.deepStrictEqual(enriched.promoteCodebase, promote);
  assert.ok(enriched.agentHints.some((h) => h.startsWith('PROMOTE:')));
  assert.ok(enriched.agentHints.some((h) => h.includes('Faster path:')));
  assert.ok(enriched.agentHints.some((h) => h.includes('Suggested PR:')));
});

console.log('route-enrichment tests passed');
