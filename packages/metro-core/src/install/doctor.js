'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const INSTALL_DOCTOR_SCHEMA_VERSION = 'metro.install.doctor.v1';
const DEFAULT_REPO_URL = 'https://github.com/metrocli/metro.git';
const DEFAULT_INSTALL_DIR = path.join(os.homedir(), '.metro', 'src');
const BROKEN_GIT_INSTALL_CMD = 'npm install -g git+https://github.com/metrocli/metro.git';
// Must match "name" in the root package.json; npm links the global install here.
const GLOBAL_PACKAGE_NAME = '@metrocli/metro';

/** <npm root -g>/@metrocli/metro, or null when the npm root is unknown. */
function globalPackagePathFor(npmRoot, packageName = GLOBAL_PACKAGE_NAME) {
  if (!npmRoot) return null;
  return path.join(npmRoot, ...packageName.split('/'));
}

function installOneLiner(installDir = DEFAULT_INSTALL_DIR) {
  return `git clone --depth 1 ${DEFAULT_REPO_URL} ${installDir} 2>/dev/null || true; bash ${installDir}/scripts/install-global.sh`;
}

function installSteps(installDir = DEFAULT_INSTALL_DIR) {
  return [
    `git clone --depth 1 ${DEFAULT_REPO_URL} ${installDir} 2>/dev/null || true`,
    `bash ${installDir}/scripts/install-global.sh`,
  ];
}

function npmGlobalPath(flag) {
  try {
    return execFileSync('npm', [flag, '-g'], { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

function commandOnPath(name) {
  const pathEnv = process.env.PATH || '';
  for (const dir of pathEnv.split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, name);
    if (process.platform === 'win32') {
      if (fs.existsSync(`${candidate}.cmd`) || fs.existsSync(`${candidate}.exe`)) {
        return `${candidate}.cmd`;
      }
    }
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function readSymlinkTarget(linkPath) {
  try {
    return fs.readlinkSync(linkPath);
  } catch {
    return null;
  }
}

function isBrokenCacheSymlink(target) {
  return typeof target === 'string' && target.includes('_cacache/tmp/git-clone');
}

function isValidCheckout(installDir) {
  return fs.existsSync(path.join(installDir, 'bin', 'metro.js'))
    && fs.existsSync(path.join(installDir, '.git'));
}

function ghAuthLooksConfigured() {
  const result = spawnSync('gh', ['auth', 'status'], { encoding: 'utf8' });
  return result.status === 0;
}

function buildInstallDoctor(options = {}) {
  const installDir = options.installDir || process.env.METRO_INSTALL_DIR || DEFAULT_INSTALL_DIR;
  const checks = [];
  let healthy = true;

  const nodeMajor = Number.parseInt(String(process.versions.node).split('.')[0], 10);
  const nodeOk = Number.isFinite(nodeMajor) && nodeMajor >= 18;
  checks.push({
    checkId: 'INSTALL-NODE-001',
    status: nodeOk ? 'pass' : 'fail',
    title: 'Node.js 18+',
    detail: nodeOk
      ? `Node ${process.versions.node}`
      : `Node ${process.versions.node} is below the required major version 18.`,
  });
  if (!nodeOk) healthy = false;

  const metroBin = commandOnPath('metro');
  checks.push({
    checkId: 'INSTALL-PATH-001',
    status: metroBin ? 'pass' : 'fail',
    title: 'metro on PATH',
    detail: metroBin ? metroBin : 'metro is not on PATH.',
  });
  if (!metroBin) healthy = false;

  const npmRoot = options.npmRoot !== undefined ? options.npmRoot : npmGlobalPath('root');
  const npmPrefix = options.npmPrefix !== undefined ? options.npmPrefix : npmGlobalPath('prefix');
  const globalPackagePath = globalPackagePathFor(npmRoot);
  let globalTarget = globalPackagePath ? readSymlinkTarget(globalPackagePath) : null;
  if (!globalTarget && globalPackagePath && fs.existsSync(globalPackagePath)) {
    globalTarget = globalPackagePath;
  }

  if (!npmRoot || !globalPackagePath) {
    checks.push({
      checkId: 'INSTALL-NPM-001',
      status: 'warn',
      title: 'npm global paths',
      detail: 'Could not resolve npm global root; skipped global package symlink check.',
    });
  } else if (!fs.existsSync(globalPackagePath)) {
    checks.push({
      checkId: 'INSTALL-NPM-002',
      status: 'fail',
      title: `Global ${GLOBAL_PACKAGE_NAME} link`,
      detail: `Missing ${globalPackagePath}.`,
    });
    healthy = false;
  } else if (isBrokenCacheSymlink(globalTarget)) {
    checks.push({
      checkId: 'INSTALL-NPM-003',
      status: 'fail',
      title: 'Broken npm git+ symlink',
      detail: `${globalPackagePath} -> ${globalTarget}`,
      remediation: `Do not use ${BROKEN_GIT_INSTALL_CMD}. Run: ${installOneLiner(installDir)}`,
    });
    healthy = false;
  } else {
    const metroJs = path.join(globalPackagePath, 'bin', 'metro.js');
    const metroJsOk = fs.existsSync(metroJs);
    checks.push({
      checkId: 'INSTALL-NPM-004',
      status: metroJsOk ? 'pass' : 'fail',
      title: 'Global package exposes bin/metro.js',
      detail: metroJsOk ? metroJs : `Missing ${metroJs}`,
      remediation: metroJsOk ? undefined : installOneLiner(installDir),
    });
    if (!metroJsOk) healthy = false;
  }

  if (fs.existsSync(installDir)) {
    if (isValidCheckout(installDir)) {
      checks.push({
        checkId: 'INSTALL-CHECKOUT-001',
        status: 'pass',
        title: 'Source checkout',
        detail: `${installDir} looks valid.`,
        remediation: `Update: bash ${installDir}/scripts/install-global.sh`,
      });
    } else {
      checks.push({
        checkId: 'INSTALL-CHECKOUT-002',
        status: 'warn',
        title: 'Source checkout',
        detail: `${installDir} exists but is not a valid metro checkout (expected bin/metro.js and .git/).`,
        remediation: `Remove the directory manually if you want a fresh clone, then: ${installOneLiner(installDir)}`,
      });
    }
  } else {
    checks.push({
      checkId: 'INSTALL-CHECKOUT-003',
      status: 'info',
      title: 'Source checkout',
      detail: `${installDir} not found yet (fine before first clone).`,
      remediation: installOneLiner(installDir),
    });
  }

  const ghResult = spawnSync('gh', ['--version'], { encoding: 'utf8' });
  if (ghResult.status !== 0) {
    checks.push({
      checkId: 'INSTALL-GH-001',
      status: 'info',
      title: 'GitHub CLI',
      detail: 'gh not installed; skipped private-repo auth check.',
      remediation: 'If clone fails on a private repo: gh auth login && gh auth setup-git',
    });
  } else if (!ghAuthLooksConfigured()) {
    checks.push({
      checkId: 'INSTALL-GH-002',
      status: 'warn',
      title: 'GitHub CLI auth',
      detail: 'gh is installed but not authenticated.',
      remediation: 'gh auth login && gh auth setup-git',
    });
  } else {
    checks.push({
      checkId: 'INSTALL-GH-003',
      status: 'pass',
      title: 'GitHub CLI auth',
      detail: 'gh auth status OK.',
    });
  }

  if (npmPrefix) {
    const globalBin = path.join(npmPrefix, 'bin');
    const pathHasGlobalBin = (process.env.PATH || '').split(path.delimiter).includes(globalBin);
    if (!pathHasGlobalBin && !metroBin) {
      checks.push({
        checkId: 'INSTALL-PATH-002',
        status: 'warn',
        title: 'npm global bin on PATH',
        detail: `${globalBin} is not on PATH.`,
        remediation: `export PATH="${globalBin}:$PATH"`,
      });
    }
  }

  const nextSafeStep = healthy
    ? 'Install looks healthy. Next: metro setup quickstart --shell | zsh'
    : `Fix failing checks, then run: ${installOneLiner(installDir)}`;

  return {
    schemaVersion: INSTALL_DOCTOR_SCHEMA_VERSION,
    apiAccess: 'none',
    localOnly: true,
    healthy,
    installDir,
    recommendedInstall: {
      oneLiner: installOneLiner(installDir),
      steps: installSteps(installDir),
      updateCommand: `bash ${installDir}/scripts/install-global.sh`,
      doNotUse: BROKEN_GIT_INSTALL_CMD,
    },
    checks,
    nextSafeStep,
  };
}

module.exports = {
  INSTALL_DOCTOR_SCHEMA_VERSION,
  DEFAULT_INSTALL_DIR,
  DEFAULT_REPO_URL,
  GLOBAL_PACKAGE_NAME,
  globalPackagePathFor,
  installOneLiner,
  installSteps,
  buildInstallDoctor,
};
