'use strict';

// VALIDATION_AND_GUARDRAILS.md must match the live allowlists and the
// dimensional rate-card rule set in code.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { REPO_ROOT } = require('./helpers');

const doc = fs.readFileSync(path.join(REPO_ROOT, 'docs/metronome-cli/VALIDATION_AND_GUARDRAILS.md'), 'utf8');
const { listLiveReadEndpointIds, listLiveApplySandboxEndpointIds, LIVE_READ_ENDPOINT_IDS, LIVE_APPLY_SANDBOX_ENDPOINT_IDS } = require(path.join(REPO_ROOT, 'packages/metro-core/src/clients/live-endpoints'));
const { validatorReference } = require(path.join(REPO_ROOT, 'packages/metro-core/src/docs/shape-validator-reference'));

function listAfter(heading) {
  const start = doc.indexOf(heading);
  assert.ok(start !== -1, `missing "${heading}"`);
  const para = doc.slice(start, doc.indexOf('\n\n', start));
  return [...new Set([...para.matchAll(/`([A-Za-z.0-9]+)`/g)].map((m) => m[1]).filter((id) => id.includes(".")))];
}

test('documented live endpoint lists match live-endpoints.js', () => {
  const reads = [...(LIVE_READ_ENDPOINT_IDS || listLiveReadEndpointIds())].sort();
  const writes = [...(LIVE_APPLY_SANDBOX_ENDPOINT_IDS || listLiveApplySandboxEndpointIds())].sort();
  assert.deepEqual(listAfter('Live read endpoints:').sort(), reads);
  assert.deepEqual(listAfter('Live sandbox write endpoints:').sort(), writes);
  assert.match(doc, new RegExp(`\\| ${reads.length} endpoints \\|`));
  assert.match(doc, new RegExp(`\\| ${writes.length} endpoints \\|`));
});

test('documented dimensional rate-card rules match the validator', () => {
  const { shapeIdsByRuleId } = validatorReference();
  const expected = Object.entries(shapeIdsByRuleId).filter(([, shapes]) => shapes.includes('dimensional-rate-card')).map(([id]) => id).sort();
  const section = doc.slice(doc.indexOf('## Dimensional rate-card rules'), doc.indexOf('## API request rules'));
  const documented = [...section.matchAll(/^\| (MTR-[A-Z]+-\d+) \|/gm)].map((m) => m[1]).sort();
  assert.deepEqual(documented, expected);
});

test('every relative link in the doc resolves', () => {
  for (const [, href] of doc.matchAll(/\]\(([^)]+)\)/g)) {
    if (/^https?:/.test(href)) continue;
    assert.ok(fs.existsSync(path.join(REPO_ROOT, 'docs/metronome-cli', href.split('#')[0])), href);
  }
});
