'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const MODE_SCHEMA_VERSION = 'metro.operator-mode.v1';
// Writes are opt-in: run `metro mode set read-write` to raise the ceiling.
const DEFAULT_MODE = 'read-only';
const MODES = ['local-only', 'read-only', 'read-write'];

const MODE_ALIASES = {
  local: 'local-only',
  local_only: 'local-only',
  readonly: 'read-only',
  read_only: 'read-only',
  read: 'read-only',
  write: 'read-write',
  read_write: 'read-write',
  rw: 'read-write',
};

const MODE_HELP = {
  'local-only': 'No live Metronome calls. Offline validate/preview/schema only.',
  'read-only': 'Live lookups allowed (ops who, guarded reads). Writes refused until you raise the ceiling.',
  'read-write': 'Live reads and allowlisted writes. Confirmation tokens still required for every write.',
};

// Keep this local - do not import ./profiles (avoids cycles through clients).
function defaultMetroConfigDir() {
  return path.join(os.homedir(), '.metro');
}

function modePath(dir = defaultMetroConfigDir()) {
  return path.join(dir, 'mode.json');
}

function normalizeMode(raw) {
  if (raw == null || raw === '') return null;
  const key = String(raw).trim().toLowerCase();
  const mapped = MODE_ALIASES[key] || key;
  return MODES.includes(mapped) ? mapped : null;
}

function modeAllows(mode, action) {
  const resolved = normalizeMode(mode) || DEFAULT_MODE;
  if (action === 'live-read') return resolved === 'read-only' || resolved === 'read-write';
  if (action === 'live-write') return resolved === 'read-write';
  return false;
}

function loadOperatorMode(options = {}) {
  const dir = options.dir ? path.resolve(String(options.dir)) : defaultMetroConfigDir();
  const filePath = modePath(dir);
  const envMode = normalizeMode(process.env.METRO_MODE);

  let fileMode = null;
  let source = 'default';
  let exists = false;
  let updatedAt = null;

  if (fs.existsSync(filePath)) {
    exists = true;
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      fileMode = normalizeMode(parsed.mode);
      updatedAt = parsed.updatedAt || null;
      if (fileMode) source = 'file';
    } catch (error) {
      return {
        schemaVersion: MODE_SCHEMA_VERSION,
        mode: DEFAULT_MODE,
        source: 'default',
        exists: true,
        path: filePath,
        updatedAt: null,
        valid: false,
        error: 'mode-file-unreadable',
        message: error.message,
        allows: {
          liveRead: modeAllows(DEFAULT_MODE, 'live-read'),
          liveWrite: modeAllows(DEFAULT_MODE, 'live-write'),
        },
        modes: MODES.map((id) => ({ id, description: MODE_HELP[id] })),
        nextSafeStep: 'Fix or delete ~/.metro/mode.json, then run metro mode set read-only.',
      };
    }
  }

  // Env override is session-sticky without rewriting the file (for CI / one-off shells).
  const mode = envMode || fileMode || DEFAULT_MODE;
  if (envMode) source = 'env';

  return {
    schemaVersion: MODE_SCHEMA_VERSION,
    mode,
    source,
    exists,
    path: filePath,
    updatedAt,
    valid: true,
    allows: {
      liveRead: modeAllows(mode, 'live-read'),
      liveWrite: modeAllows(mode, 'live-write'),
    },
    modes: MODES.map((id) => ({ id, description: MODE_HELP[id] })),
    nextSafeStep: mode === 'read-only'
      ? 'Look up customers with metro ops who. To apply changes: metro mode set read-write'
      : mode === 'local-only'
        ? 'Run offline previews only. To look up live customers: metro mode set read-only'
        : 'Writes still need confirmation tokens. Drop to read-only anytime: metro mode set read-only',
  };
}

function setOperatorMode(modeInput, options = {}) {
  const mode = normalizeMode(modeInput);
  if (!mode) {
    const error = new Error(
      `Unknown mode "${modeInput}". Use: ${MODES.join(' | ')}`,
    );
    error.code = 'MTR-MODE-INVALID';
    throw error;
  }

  const dir = options.dir ? path.resolve(String(options.dir)) : defaultMetroConfigDir();
  fs.mkdirSync(dir, { recursive: true });
  const filePath = modePath(dir);
  const updatedAt = new Date().toISOString();
  const payload = {
    schemaVersion: MODE_SCHEMA_VERSION,
    mode,
    updatedAt,
  };
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

  return {
    ...loadOperatorMode({ dir }),
    written: true,
    path: filePath,
    mode,
    source: 'file',
    updatedAt,
    nextSafeStep: MODE_HELP[mode],
  };
}

function resetOperatorMode(options = {}) {
  const dir = options.dir ? path.resolve(String(options.dir)) : defaultMetroConfigDir();
  const filePath = modePath(dir);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  return {
    ...loadOperatorMode({ dir }),
    written: false,
    reset: true,
    nextSafeStep: `Mode reset to default (${DEFAULT_MODE}). Writes need metro mode set read-write.`,
  };
}

function assertOperatorModeAllows(action, options = {}) {
  const state = loadOperatorMode(options);
  if (modeAllows(state.mode, action)) return state;

  const wantsWrite = action === 'live-write';
  const message = wantsWrite
    ? `Operator mode is "${state.mode}" - live writes are blocked. Run: metro mode set read-write`
    : `Operator mode is "${state.mode}" - live reads are blocked. Run: metro mode set read-only`;

  const error = new Error(message);
  error.code = wantsWrite ? 'MTR-MODE-WRITE-BLOCKED' : 'MTR-MODE-READ-BLOCKED';
  error.operatorMode = state;
  error.nextCommands = [
    wantsWrite ? 'metro mode set read-write' : 'metro mode set read-only',
    'metro mode show --json',
  ];
  throw error;
}

module.exports = {
  MODE_SCHEMA_VERSION,
  DEFAULT_MODE,
  MODES,
  MODE_HELP,
  defaultMetroConfigDir,
  modePath,
  normalizeMode,
  modeAllows,
  loadOperatorMode,
  setOperatorMode,
  resetOperatorMode,
  assertOperatorModeAllows,
};
