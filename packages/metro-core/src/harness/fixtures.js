'use strict';

const fs = require('fs');
const path = require('path');

const { READ_PLAN_GOLDEN_EXAMPLES } = require('../api-catalog/readiness');

function resolveHarnessFixtureRoot(options = {}) {
  if (options.fixtureRoot) {
    return path.resolve(String(options.fixtureRoot));
  }
  if (process.env.METRO_HARNESS_FIXTURE_ROOT) {
    return path.resolve(process.env.METRO_HARNESS_FIXTURE_ROOT);
  }

  const packageRoot = path.join(__dirname, '..', '..');
  const candidates = [
    path.join(__dirname, '..', '..', '..', '..', 'test', 'fixtures', 'pro-annual-valid.json'),
    path.join(packageRoot, 'test', 'fixtures', 'pro-annual-valid.json'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return path.dirname(candidate);
    }
  }
  return null;
}

function fixturePathForEndpoint(endpointId, fixtureRoot) {
  const example = READ_PLAN_GOLDEN_EXAMPLES.find((entry) => entry.endpointId === endpointId);
  if (!example) return null;
  const basename = path.basename(example.fixturePath);
  const resolved = path.join(fixtureRoot, basename);
  return fs.existsSync(resolved) ? resolved : null;
}

function standardShapeFixtures(fixtureRoot) {
  return {
    proAnnual: path.join(fixtureRoot, 'pro-annual-valid.json'),
    proAnnualSelfServeV2: path.join(fixtureRoot, 'pro-annual-self-serve-v2-valid.json'),
    dimensionalRateCard: path.join(fixtureRoot, 'dimensional-rate-card-valid.json'),
  };
}

module.exports = {
  resolveHarnessFixtureRoot,
  fixturePathForEndpoint,
  standardShapeFixtures,
};
