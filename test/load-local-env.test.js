'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { REPO_ROOT, tempDir } = require('./helpers');

const { candidateEnvPaths, loadLocalEnv } = require(path.join(REPO_ROOT, 'packages/metro-core/src/clients/load-local-env.js'));

test('env candidates are METRO_ENV_FILE, ./.env, then ~/.metro/.env', () => {
  const cwd = '/work/acme';
  const homeDir = '/home/acme';
  assert.deepEqual(
    candidateEnvPaths({ cwd, homeDir, env: { METRO_ENV_FILE: '/secrets/metro.env' } }),
    [path.resolve('/secrets/metro.env'), path.join(cwd, '.env'), path.join(homeDir, '.metro', '.env')],
  );
  const noOverride = candidateEnvPaths({ cwd, homeDir, env: {} });
  assert.ok(!noOverride.some((p) => p.includes(`${path.sep}metronome${path.sep}`)));
});

test('loads ~/.metro/.env without overriding set variables', () => {
  const homeDir = tempDir();
  const cwd = tempDir();
  fs.mkdirSync(path.join(homeDir, '.metro'));
  fs.writeFileSync(path.join(homeDir, '.metro', '.env'), 'METRONOME_SANDBOX_KEY=from-file\nKEEP=from-file\n');
  const env = { KEEP: 'already-set' };
  const result = loadLocalEnv({ cwd, homeDir, env });
  assert.equal(result.loaded, true);
  assert.equal(result.path, path.join(homeDir, '.metro', '.env'));
  assert.equal(env.METRONOME_SANDBOX_KEY, 'from-file');
  assert.equal(env.KEEP, 'already-set');
});

test('./.env wins over ~/.metro/.env', () => {
  const homeDir = tempDir();
  const cwd = tempDir();
  fs.mkdirSync(path.join(homeDir, '.metro'));
  fs.writeFileSync(path.join(homeDir, '.metro', '.env'), 'A=home\n');
  fs.writeFileSync(path.join(cwd, '.env'), 'A=cwd\n');
  const env = {};
  loadLocalEnv({ cwd, homeDir, env });
  assert.equal(env.A, 'cwd');
});
