'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const PACK_IDS = Object.freeze(['generic', 'stub']);
const DEFAULT_PACK_ID = 'generic';

const LOCAL_PACK_ROOTS = Object.freeze({
  generic: path.join(__dirname, '..', '..', '..', 'metro-workspace-generic', 'src'),
  stub: path.join(__dirname, '..', '..', '..', 'metro-workspace-stub', 'src'),
});

const NPM_PACK_NAMES = Object.freeze({
  generic: '@metronome/metro-workspace-generic',
});

const CONFIG_SCHEMA_VERSION = 'metro.config.v1';

let sessionPackId = null;
const packCache = Object.create(null);

const PACK_FUNCTION_KEYS = Object.freeze([
  'getWorkspaceModel',
  'getIntent',
  'listIntents',
  'intentForAuditAction',
  'tierRateCardsForTenant',
  'buildWorkspacePlan',
  'buildPlanInputTemplate',
  'matchGoalToIntent',
  'routeWorkspaceRequest',
  'classifyAuditExportSummary',
  'findEndpointRefusal',
  'resolveWorkspaceCatalog',
  'validateWorkspaceCatalogShape',
  'extractWorkspaceCatalogFromConfig',
  'buildAuditExportClassify',
  'buildAuditExportPlan',
  'summarizeAuditRowIntent',
]);

const PACK_VALUE_KEYS = Object.freeze([
  'WORKSPACE_SCHEMA_VERSION',
  'SANDBOX_REFERENCE_CATALOG',
  'PRODUCTION_REFERENCE_CATALOG',
  'INTENTS',
  'GENERIC_WORKSPACE',
  'STUB_WORKSPACE',
]);

function defaultMetroConfigDir() {
  return path.join(os.homedir(), '.metro');
}

function configPath(dir = defaultMetroConfigDir()) {
  return path.join(dir, 'config.json');
}

function profilesPath(dir = defaultMetroConfigDir()) {
  return path.join(dir, 'profiles.json');
}

function normalizePackId(raw, fallback = null) {
  const id = String(raw == null ? '' : raw).trim().toLowerCase();
  if (PACK_IDS.includes(id)) return id;
  return fallback;
}

function builtInDefaultPackId() {
  return normalizePackId(process.env.METRO_DEFAULT_WORKSPACE_PACK, DEFAULT_PACK_ID);
}

function readConfigDefaultPack(options = {}) {
  const dir = options.configDir ? path.resolve(String(options.configDir)) : defaultMetroConfigDir();
  const filePath = configPath(dir);
  try {
    if (!fs.existsSync(filePath)) return null;
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return normalizePackId(parsed.defaultWorkspacePack, null);
  } catch {
    return null;
  }
}

function readProfileWorkspacePack(options = {}) {
  if (options.profileWorkspacePack) {
    return normalizePackId(options.profileWorkspacePack, null);
  }
  const dir = options.configDir ? path.resolve(String(options.configDir)) : defaultMetroConfigDir();
  const filePath = options.profilePath
    ? path.resolve(String(options.profilePath))
    : profilesPath(dir);
  try {
    if (!fs.existsSync(filePath)) return null;
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const profiles = parsed.profiles && typeof parsed.profiles === 'object' ? parsed.profiles : {};
    const preferred = options.profileName
      || parsed.defaultProfile
      || Object.keys(profiles)[0]
      || null;
    if (!preferred || !profiles[preferred]) return null;
    return normalizePackId(profiles[preferred].workspacePack, null);
  } catch {
    return null;
  }
}

/**
 * Resolution order:
 * 1. options.workspace / --workspace
 * 2. METRO_WORKSPACE_PACK or METRO_WORKSPACE
 * 3. session override (metro workspace use)
 * 4. profiles.<name>.workspacePack
 * 5. ~/.metro/config.json defaultWorkspacePack
 * 6. METRO_DEFAULT_WORKSPACE_PACK or 'generic'
 */
function resolvePackId(options = {}) {
  if (options.workspace) {
    return normalizePackId(options.workspace, builtInDefaultPackId());
  }
  const envRaw = process.env.METRO_WORKSPACE_PACK || process.env.METRO_WORKSPACE;
  if (envRaw) {
    return normalizePackId(envRaw, builtInDefaultPackId());
  }
  if (sessionPackId) {
    return sessionPackId;
  }
  const fromProfile = readProfileWorkspacePack(options);
  if (fromProfile) return fromProfile;
  const fromConfig = readConfigDefaultPack(options);
  if (fromConfig) return fromConfig;
  return builtInDefaultPackId();
}

function loadWorkspacePack(packId = resolvePackId()) {
  const id = normalizePackId(packId, builtInDefaultPackId());
  if (packCache[id]) return packCache[id];

  const npmName = NPM_PACK_NAMES[id];
  if (npmName) {
    try {
      packCache[id] = require(npmName);
      return packCache[id];
    } catch (err) {
      if (err.code !== 'MODULE_NOT_FOUND') throw err;
    }
  }
  packCache[id] = require(LOCAL_PACK_ROOTS[id]);
  return packCache[id];
}

function packNameFor(packId) {
  return NPM_PACK_NAMES[packId] || `@metro/workspace-${packId}`;
}

function getActiveWorkspace(options = {}) {
  const packId = resolvePackId(options);
  return {
    packId,
    pack: loadWorkspacePack(packId),
    packName: packNameFor(packId),
  };
}

function setSessionWorkspacePack(packId) {
  const id = normalizePackId(packId, null);
  if (!id) {
    throw new Error(`Unknown workspace pack: ${packId}. Valid: ${PACK_IDS.join(', ')}`);
  }
  sessionPackId = id;
  return id;
}

function clearSessionWorkspacePack() {
  sessionPackId = null;
}

function writeStickyWorkspacePack(packId, options = {}) {
  const id = normalizePackId(packId, null);
  if (!id) {
    throw new Error(`Unknown workspace pack: ${packId}. Valid: ${PACK_IDS.join(', ')}`);
  }
  const dir = options.configDir ? path.resolve(String(options.configDir)) : defaultMetroConfigDir();
  fs.mkdirSync(dir, { recursive: true });
  const filePath = configPath(dir);
  let existing = {};
  if (fs.existsSync(filePath)) {
    try {
      existing = JSON.parse(fs.readFileSync(filePath, 'utf8')) || {};
    } catch {
      existing = {};
    }
  }
  const next = {
    ...existing,
    schemaVersion: CONFIG_SCHEMA_VERSION,
    defaultWorkspacePack: id,
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(filePath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  sessionPackId = id;
  return { path: filePath, defaultWorkspacePack: id };
}

function packAvailable(id) {
  try {
    if (NPM_PACK_NAMES[id]) {
      require.resolve(NPM_PACK_NAMES[id]);
      return true;
    }
  } catch {
    // fall through to local path
  }
  return Boolean(LOCAL_PACK_ROOTS[id] && fs.existsSync(LOCAL_PACK_ROOTS[id]));
}

function listWorkspacePacks(options = {}) {
  const active = resolvePackId(options);
  return PACK_IDS.map((id) => ({
    id,
    active: id === active,
    available: packAvailable(id),
    npmName: NPM_PACK_NAMES[id] || null,
  }));
}

function describeWorkspaceResolution(options = {}) {
  const packId = resolvePackId(options);
  const envRaw = process.env.METRO_WORKSPACE_PACK || process.env.METRO_WORKSPACE || null;
  return {
    schemaVersion: 'metro.workspace.current.v1',
    packId,
    packName: packNameFor(packId),
    sources: {
      cliWorkspace: options.workspace || null,
      env: envRaw,
      session: sessionPackId,
      profile: readProfileWorkspacePack(options),
      config: readConfigDefaultPack(options),
      builtInDefault: builtInDefaultPackId(),
    },
    packs: listWorkspacePacks(options),
  };
}

const api = {
  PACK_IDS,
  resolvePackId,
  loadWorkspacePack,
  getActiveWorkspace,
  setSessionWorkspacePack,
  clearSessionWorkspacePack,
  writeStickyWorkspacePack,
  listWorkspacePacks,
  describeWorkspaceResolution,
  defaultMetroConfigDir,
  configPath,
};

Object.defineProperty(api, 'packId', {
  enumerable: true,
  get() { return resolvePackId(); },
});
Object.defineProperty(api, 'pack', {
  enumerable: true,
  get() { return loadWorkspacePack(resolvePackId()); },
});
Object.defineProperty(api, 'packName', {
  enumerable: true,
  get() { return packNameFor(resolvePackId()); },
});

for (const key of PACK_FUNCTION_KEYS) {
  api[key] = (...args) => {
    const pack = loadWorkspacePack(resolvePackId());
    const fn = pack[key];
    if (typeof fn !== 'function') {
      throw new Error(`Workspace pack ${resolvePackId()} does not export ${key}`);
  DEFAULT_PACK_ID,
    }
    return fn(...args);
  };
}

for (const key of PACK_VALUE_KEYS) {
  Object.defineProperty(api, key, {
    enumerable: true,
    get() {
      return loadWorkspacePack(resolvePackId())[key];
    },
  });
}

module.exports = api;
