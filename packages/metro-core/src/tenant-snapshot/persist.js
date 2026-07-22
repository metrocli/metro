'use strict';

const fs = require('fs');
const path = require('path');

const { snapshotPath, snapshotsDir } = require('./paths');

function previousSnapshotPath(tenant, configDir) {
  const current = snapshotPath(tenant, configDir);
  return path.join(path.dirname(current), `${path.basename(current, '.json')}.prev.json`);
}

function writeSnapshot(snapshot, { configDir } = {}) {
  const dir = snapshotsDir(configDir);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = snapshotPath(snapshot.tenant, configDir);
  const prevPath = previousSnapshotPath(snapshot.tenant, configDir);
  if (fs.existsSync(filePath)) {
    fs.copyFileSync(filePath, prevPath);
  }
  fs.writeFileSync(filePath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  return { path: filePath, previousPath: fs.existsSync(prevPath) ? prevPath : null, tenant: snapshot.tenant };
}

function readSnapshot(tenant, { configDir } = {}) {
  const filePath = snapshotPath(tenant, configDir);
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

function snapshotExists(tenant, { configDir } = {}) {
  return fs.existsSync(snapshotPath(tenant, configDir));
}

function readPreviousSnapshot(tenant, { configDir } = {}) {
  const filePath = previousSnapshotPath(tenant, configDir);
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

module.exports = {
  writeSnapshot,
  readSnapshot,
  readPreviousSnapshot,
  snapshotExists,
  previousSnapshotPath,
};
