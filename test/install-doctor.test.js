'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { REPO_ROOT, tempDir } = require('./helpers');

const {
  GLOBAL_PACKAGE_NAME,
  globalPackagePathFor,
  buildInstallDoctor,
} = require(path.join(REPO_ROOT, 'packages/metro-core/src/install/doctor.js'));

const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));

function check(report, prefix) {
  return report.checks.find((c) => c.checkId.startsWith(prefix));
}

test('doctor looks for the global link under the published package name', () => {
  assert.equal(GLOBAL_PACKAGE_NAME, pkg.name);
  assert.equal(
    globalPackagePathFor('/opt/node/lib/node_modules'),
    path.join('/opt/node/lib/node_modules', '@metrocli', 'metro'),
  );
  assert.equal(globalPackagePathFor(null), null);
});

test('doctor passes the link check when npm root has @metrocli/metro/bin/metro.js', () => {
  const npmRoot = tempDir();
  const linked = path.join(npmRoot, '@metrocli', 'metro');
  fs.mkdirSync(path.dirname(linked), { recursive: true });
  fs.symlinkSync(REPO_ROOT, linked, 'dir');
  const report = buildInstallDoctor({ npmRoot, npmPrefix: null, installDir: tempDir() });
  const link = check(report, 'INSTALL-NPM-');
  assert.equal(link.checkId, 'INSTALL-NPM-004');
  assert.equal(link.status, 'pass', link.detail);
});

test('doctor fails the link check when the global package is missing', () => {
  const npmRoot = tempDir();
  const report = buildInstallDoctor({ npmRoot, npmPrefix: null, installDir: tempDir() });
  const link = check(report, 'INSTALL-NPM-');
  assert.equal(link.checkId, 'INSTALL-NPM-002');
  assert.equal(link.status, 'fail');
  assert.match(link.detail, /@metrocli[\\/]metro/);
  assert.equal(report.healthy, false);
});

test('doctor flags a broken npm git+ cache symlink', () => {
  const npmRoot = tempDir();
  const cache = path.join(tempDir(), '_cacache', 'tmp', 'git-clone-x');
  fs.mkdirSync(cache, { recursive: true });
  const linked = path.join(npmRoot, '@metrocli', 'metro');
  fs.mkdirSync(path.dirname(linked), { recursive: true });
  fs.symlinkSync(cache, linked, 'dir');
  const report = buildInstallDoctor({ npmRoot, npmPrefix: null, installDir: tempDir() });
  assert.equal(check(report, 'INSTALL-NPM-').checkId, 'INSTALL-NPM-003');
});
