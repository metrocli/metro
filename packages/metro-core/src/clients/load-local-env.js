'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * Load KEY=VALUE pairs from a .env file into process.env without overriding
 * already-set variables. Never prints values.
 *
 * Candidate paths (first existing wins):
 *   1. METRO_ENV_FILE
 *   2. <cwd>/.env
 *   3. ~/.metro/.env
 */
function candidateEnvPaths({ cwd = process.cwd(), env = process.env, homeDir = os.homedir() } = {}) {
  const paths = [];
  if (env.METRO_ENV_FILE) paths.push(path.resolve(String(env.METRO_ENV_FILE)));
  paths.push(path.resolve(cwd, '.env'));
  if (homeDir) paths.push(path.resolve(homeDir, '.metro', '.env'));
  return paths;
}

const ENV_SEARCH_HINT = 'METRO_ENV_FILE, ./.env, ~/.metro/.env';

function parseEnvFile(contents) {
  const out = {};
  for (const line of String(contents).split(/\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function loadLocalEnv({
  cwd = process.cwd(),
  env = process.env,
  homeDir = os.homedir(),
  readFileSync = fs.readFileSync,
  existsSync = fs.existsSync,
} = {}) {
  const tried = candidateEnvPaths({ cwd, env, homeDir });
  for (const filePath of tried) {
    if (!existsSync(filePath)) continue;
    const parsed = parseEnvFile(readFileSync(filePath, 'utf8'));
    let loaded = 0;
    for (const [key, value] of Object.entries(parsed)) {
      if (env[key] === undefined || env[key] === '') {
        env[key] = value;
        loaded += 1;
      }
    }
    return { loaded: true, path: filePath, keysSet: loaded, tried };
  }
  return { loaded: false, path: null, keysSet: 0, tried };
}

module.exports = {
  ENV_SEARCH_HINT,
  candidateEnvPaths,
  parseEnvFile,
  loadLocalEnv,
};
