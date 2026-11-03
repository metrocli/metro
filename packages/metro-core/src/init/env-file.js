'use strict';

// SPDX-License-Identifier: Apache-2.0
//
// ~/.metro/.env: created with mode 0600, never overwritten. Values are never
// returned to callers that print, only "set" / "empty" and the variable name.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseEnvFile } = require('../clients/load-local-env');

const SANDBOX_TOKEN_URL = 'https://app.metronome.com/sandbox/developer/api-tokens';
const PROD_TOKEN_URL = 'https://app.metronome.com/developer/api-tokens';
const SANDBOX_VAR = 'METRONOME_SANDBOX_KEY';
const PROD_VAR = 'METRONOME_PROD_KEY';

const ENV_TEMPLATE = [
  '# metro keys: this file is private to your user (chmod 600). Never commit or share it.',
  '#',
  "# 1) Sandbox key: start here, it can't affect real billing.",
  `#    Create one: ${SANDBOX_TOKEN_URL}`,
  `${SANDBOX_VAR}=`,
  '#',
  '# 2) Production key: optional. metro is read-only until you run `metro mode write`,',
  '#    and every production write still needs a typed confirmation.',
  `#    Create one: ${PROD_TOKEN_URL}`,
  `${PROD_VAR}=`,
  '',
].join('\n');

function metroDir(homeDir = os.homedir()) {
  return path.join(homeDir, '.metro');
}

function envFilePath(homeDir = os.homedir()) {
  return path.join(metroDir(homeDir), '.env');
}

/** Show paths under the home directory as ~/... */
function displayPath(filePath, homeDir = os.homedir()) {
  if (homeDir && (filePath === homeDir || filePath.startsWith(homeDir + path.sep))) {
    return `~${filePath.slice(homeDir.length)}`;
  }
  return filePath;
}

function fileMode(filePath) {
  return fs.statSync(filePath).mode & 0o777;
}

function enforcePrivate(filePath) {
  fs.chmodSync(filePath, 0o600);
  const mode = fileMode(filePath);
  if (process.platform !== 'win32' && mode !== 0o600) {
    const error = new Error(
      `Could not make ${filePath} private (mode is ${mode.toString(8)}, expected 600). Run: chmod 600 ${filePath}`,
    );
    error.code = 'METRO_INIT_CHMOD_FAILED';
    throw error;
  }
  return mode;
}

/**
 * Create ~/.metro/.env from the template if it does not exist. Never overwrites.
 * Always re-asserts mode 0600 and verifies it.
 */
function ensureEnvFile({ homeDir = os.homedir() } = {}) {
  const dir = metroDir(homeDir);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const filePath = envFilePath(homeDir);
  let created = false;
  try {
    fs.writeFileSync(filePath, ENV_TEMPLATE, { flag: 'wx', mode: 0o600 });
    created = true;
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  const mode = enforcePrivate(filePath);
  return { path: filePath, created, mode };
}

function readEnvValues(filePath) {
  if (!fs.existsSync(filePath)) return {};
  return parseEnvFile(fs.readFileSync(filePath, 'utf8'));
}

function keyState(filePath) {
  const values = readEnvValues(filePath);
  const has = (name) => Boolean(values[name] && String(values[name]).trim());
  return { sandbox: has(SANDBOX_VAR), production: has(PROD_VAR) };
}

/**
 * Write NAME=value into the file only when NAME is missing or empty.
 * Returns { written: true } or { written: false, reason: 'already-set' }.
 */
function setKeyIfEmpty(filePath, name, value) {
  const clean = String(value || '').trim();
  if (!clean) return { written: false, reason: 'empty-value' };
  if (/[\r\n]/.test(clean)) return { written: false, reason: 'invalid-value' };
  const contents = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
  const current = parseEnvFile(contents)[name];
  if (current && String(current).trim()) return { written: false, reason: 'already-set' };

  const lines = contents.split('\n');
  const pattern = new RegExp(`^\\s*${name}\\s*=`);
  const index = lines.findIndex((line) => pattern.test(line));
  if (index === -1) {
    if (lines.length && lines[lines.length - 1] === '') lines.pop();
    lines.push(`${name}=${clean}`, '');
  } else {
    lines[index] = `${name}=${clean}`;
  }
  const tmp = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, lines.join('\n'), { mode: 0o600 });
  fs.renameSync(tmp, filePath);
  enforcePrivate(filePath);
  return { written: true };
}

module.exports = {
  SANDBOX_TOKEN_URL,
  PROD_TOKEN_URL,
  SANDBOX_VAR,
  PROD_VAR,
  ENV_TEMPLATE,
  metroDir,
  envFilePath,
  displayPath,
  fileMode,
  enforcePrivate,
  ensureEnvFile,
  readEnvValues,
  keyState,
  setKeyIfEmpty,
};
