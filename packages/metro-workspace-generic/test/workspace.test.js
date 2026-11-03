'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const prevPack = process.env.METRO_WORKSPACE_PACK;
process.env.METRO_WORKSPACE_PACK = 'generic';
for (const key of Object.keys(require.cache)) {
  if (key.includes(`${path.sep}src${path.sep}`) || key.includes('metro-workspace')) {
    delete require.cache[key];
  }
}

const { run } = require('../../metro-core/src/cli');
const { listIntents, getWorkspaceModel } = require('../src');

const packFixtureDir = path.join(__dirname, '..', 'fixtures');

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (error) {
    console.error(`  ✗ ${name}`);
    throw error;
  }
}

function invoke(argv) {
  let stdout = '';
  let stderr = '';
  const code = run(argv, {
    stdout: { write: (value) => { stdout += value; } },
    stderr: { write: (value) => { stderr += value; } },
  });
  return { code, stdout, stderr };
}

test('generic pack exports 14 intents', () => {
  assert.strictEqual(listIntents().length, 14);
  assert.strictEqual(getWorkspaceModel().organization, 'generic');
});

test('plan list includes generic intents', () => {
  const result = invoke(['plan', 'list', '--json']);
  assert.strictEqual(result.code, 0);
  const payload = JSON.parse(result.stdout);
  assert.ok(payload.intents.some((intent) => intent.id === 'add-pricing-dimension-value'));
  assert.ok(payload.intents.some((intent) => intent.id === 'credits-product-decision'));
  assert.ok(payload.intents.some((intent) => intent.id === 'onboard-customer'));
  assert.ok(!payload.intents.some((intent) => intent.id === 'dimensional-new-code'));
});

test('route credits product asks to decision intent', () => {
  const result = invoke(['route', '--goal', 'add a credits product', '--sandbox', '--json']);
  assert.strictEqual(result.code, 0);
  const payload = JSON.parse(result.stdout);
  assert.strictEqual(payload.routed, true);
  assert.strictEqual(payload.intentId, 'credits-product-decision');
});

test('route refuses products.create for new dimension goals', () => {
  const result = invoke([
    'route',
    '--goal', 'add new pricing dimension FEATURE_X',
    '--api', 'products.create',
    '--sandbox',
    '--json',
  ]);
  assert.strictEqual(result.code, 2);
  const payload = JSON.parse(result.stdout);
  assert.strictEqual(payload.refused, true);
  assert.strictEqual(payload.recommendedIntent, 'add-pricing-dimension-value');
});

test('add-pricing-dimension-value plan recommends dimensional shape', () => {
  const result = invoke([
    'plan', 'add-pricing-dimension-value',
    '--action-code', 'FEATURE_X',
    '--display-name', 'Feature X',
    '--price', '50',
    '--sandbox',
    '--json',
  ]);
  assert.strictEqual(result.code, 0);
  const payload = JSON.parse(result.stdout);
  assert.strictEqual(payload.intent.id, 'add-pricing-dimension-value');
  assert.strictEqual(payload.recommendation.recommendedShape, 'dimensional-rate-card');
  assert.strictEqual(payload.recommendation.catalogMode, 'add-rates-only');
});

test('greenfield-credits-product plan emits BM+product preview templates', () => {
  const result = invoke([
    'plan', 'greenfield-credits-product',
    '--name', 'Usage Credits',
    '--aggregation', 'COUNT',
    '--sandbox',
    '--json',
  ]);
  assert.strictEqual(result.code, 0);
  const payload = JSON.parse(result.stdout);
  assert.strictEqual(payload.intent.id, 'greenfield-credits-product');
  assert.strictEqual(payload.liveApplyAuthorized, false);
  assert.ok(payload.inputTemplate?.billableMetricRequest?.body?.aggregation_type === 'COUNT');
  assert.strictEqual(payload.inputTemplate?.usageProductRequest?.body?.type, 'USAGE');
  assert.ok(payload.nextCommands.some((c) => c.includes('api validate billableMetrics.create')));
});

test('annual-subscription-package validates pack fixture', () => {
  const fixture = path.join(packFixtureDir, 'annual-package.json');
  const validateResult = invoke([
    'validate',
    '--shape', 'pro-annual-self-serve-v2',
    '--file', fixture,
    '--json',
  ]);
  assert.strictEqual(validateResult.code, 0);
});

test('workspace explain avoids tenant-specific profile names', () => {
  const result = invoke(['workspace', 'explain', '--json']);
  assert.strictEqual(result.code, 0);
  const payload = JSON.parse(result.stdout);
  assert.ok(!JSON.stringify(payload).includes('acme-sandbox'));
  assert.ok(payload.nextCommands.some((command) => command.includes('metro-sandbox')));
});

test('harness onboard passes with generic pack', () => {
  const result = invoke(['harness', 'run', '--suite', 'onboard', '--execute', '--json']);
  assert.strictEqual(result.code, 0);
  const payload = JSON.parse(result.stdout);
  assert.strictEqual(payload.execution.allRequiredPassed, true);
});

test('customer-setup accepts externalCustomerId fixture', () => {
  const fixture = path.join(__dirname, '..', '..', '..', 'test', 'fixtures', 'customer-setup-external-id-valid.json');
  const result = invoke([
    'validate',
    '--shape', 'customer-setup',
    '--file', fixture,
    '--json',
  ]);
  assert.strictEqual(result.code, 0);
  const payload = JSON.parse(result.stdout);
  assert.strictEqual(payload.valid, true);
});

test('onboard-customer input template uses externalCustomerId', () => {
  const result = invoke([
    'plan', 'onboard-customer',
    '--sandbox',
    '--json',
  ]);
  assert.strictEqual(result.code, 0);
  const payload = JSON.parse(result.stdout);
  const setup = payload.inputTemplate.customerSetup;
  assert.ok('externalCustomerId' in setup);
});

if (prevPack === undefined) {
  delete process.env.METRO_WORKSPACE_PACK;
} else {
  process.env.METRO_WORKSPACE_PACK = prevPack;
}

console.log('metro-workspace-generic tests passed');
