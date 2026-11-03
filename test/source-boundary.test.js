'use strict';

// source-boundary: previous-billing-system evidence stays historical, and the
// deprecated pre-0.2 field names still validate with a warning.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { REPO_ROOT } = require('./helpers');

const { buildSourceBoundaryTemplate, validateSourceBoundary } = require(path.join(REPO_ROOT, 'packages/metro-core/src/source-boundary'));

function validTemplate() {
  const t = buildSourceBoundaryTemplate({ workflow: 'package.create', shape: 'pro-annual' });
  t.generatedArtifacts = [];
  t.entryPoints = [t.entryPoints[0]];
  return t;
}

test('template validates and uses the vendor-neutral field names', () => {
  const t = validTemplate();
  assert.ok(t.externalBillingEvidence);
  assert.equal(t.assertions.noExternalBillingCurrentIntegration, true);
  const r = validateSourceBoundary(t);
  assert.equal(r.valid, true, JSON.stringify(r.findings));
  assert.deepEqual(r.warnings, []);
  assert.equal(r.summary.externalBillingUsed, false);
});

test('external billing evidence used as a current integration is MTR-REPO-003', () => {
  const t = validTemplate();
  t.externalBillingEvidence.usedAsCurrentIntegration = true;
  const r = validateSourceBoundary(t);
  assert.equal(r.valid, false);
  assert.ok(r.findings.some((f) => f.id === 'MTR-REPO-003' && f.path === 'externalBillingEvidence.usedAsCurrentIntegration'));
});

test('a legacy-billing current source used as integration is rejected', () => {
  const t = validTemplate();
  t.currentSources.push({ path: 'legacy-billing/plans.json', sourceType: 'current-source', reviewed: true, usedAsCurrentIntegration: true });
  const r = validateSourceBoundary(t);
  assert.ok(r.findings.some((f) => f.id === 'MTR-REPO-003' && f.path === 'currentSources[2]'));
});

test('deprecated field names are accepted with warnings', () => {
  const t = validTemplate();
  const [oldEvidence, oldAssertion] = ['hyper' + 'lineEvidence', 'noHyper' + 'lineCurrentIntegration'];
  t[oldEvidence] = t.externalBillingEvidence;
  delete t.externalBillingEvidence;
  t.assertions[oldAssertion] = true;
  delete t.assertions.noExternalBillingCurrentIntegration;
  let r = validateSourceBoundary(t);
  assert.equal(r.valid, true, JSON.stringify(r.findings));
  assert.equal(r.warnings.length, 2);
  assert.ok(r.warnings.every((w) => w.severity === 'warning' && /deprecated/.test(w.message)));

  t[oldEvidence].usedAsCurrentIntegration = true;
  r = validateSourceBoundary(t);
  assert.ok(r.findings.some((f) => f.path === `${oldEvidence}.usedAsCurrentIntegration`));
});
