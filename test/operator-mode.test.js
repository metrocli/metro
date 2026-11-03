'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { REPO_ROOT, runMetro, tempDir } = require('./helpers');

const { loadOperatorMode } = require(path.join(REPO_ROOT, 'packages/metro-core/src/setup/mode.js'));

test('default operator mode is read-only (writes are opt-in)', () => {
  const prev = process.env.METRO_MODE;
  delete process.env.METRO_MODE;
  try {
    const mode = loadOperatorMode({ dir: tempDir() });
    assert.equal(mode.mode, 'read-only');
    assert.equal(mode.source, 'default');
    assert.equal(mode.allows.liveRead, true);
    assert.equal(mode.allows.liveWrite, false);
  } finally {
    if (prev !== undefined) process.env.METRO_MODE = prev;
  }
});

test('metro status reports read-only on a fresh install', () => {
  const result = runMetro(['status', '--json']);
  assert.equal(result.code, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.operatorMode.mode, 'read-only');
  assert.equal(payload.operatorMode.allows.liveWrite, false);
});

test('metro mode set read-write raises the ceiling', () => {
  const home = tempDir();
  const set = runMetro(['mode', 'set', 'read-write', '--json'], { home });
  assert.equal(set.code, 0, set.stderr);
  const status = runMetro(['status', '--json'], { home });
  assert.equal(JSON.parse(status.stdout).operatorMode.mode, 'read-write');
});
