'use strict';

const os = require('os');
const path = require('path');

function defaultMetroConfigDir() {
  return path.join(os.homedir(), '.metro');
}

function snapshotsDir(configDir = defaultMetroConfigDir()) {
  return path.join(path.resolve(String(configDir)), 'snapshots');
}

/**
 * @param {'sandbox'|'production'|string} tenant
 * @param {string} [configDir]
 */
function snapshotPath(tenant, configDir = defaultMetroConfigDir()) {
  const id = tenant === 'production' ? 'production' : 'sandbox';
  return path.join(snapshotsDir(configDir), `${id}.json`);
}

module.exports = {
  defaultMetroConfigDir,
  snapshotsDir,
  snapshotPath,
};
