'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const METRO_BIN = path.join(REPO_ROOT, 'bin', 'metro.js');

function tempDir(prefix = 'metro-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** Environment with every METRO_* override removed and HOME pointed at a scratch dir. */
function cleanEnv(home, extra = {}) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith('METRO_') || key.startsWith('METRONOME_')) delete env[key];
  }
  return { ...env, HOME: home, USERPROFILE: home, ...extra };
}

function runMetro(args, { home = tempDir(), env = {} } = {}) {
  const result = spawnSync(process.execPath, [METRO_BIN, ...args], {
    cwd: home,
    env: cleanEnv(home, env),
    encoding: 'utf8',
  });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr, home };
}

function runNode(code, { home = tempDir(), env = {} } = {}) {
  const result = spawnSync(process.execPath, ['-e', code], {
    cwd: REPO_ROOT,
    env: cleanEnv(home, env),
    encoding: 'utf8',
  });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr, home };
}

module.exports = {
  REPO_ROOT,
  METRO_BIN,
  tempDir,
  cleanEnv,
  runMetro,
  runNode,
};
