'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { REPO_ROOT, runNode, runMetro, tempDir } = require('./helpers');

const LOADER = path.join(REPO_ROOT, 'packages/metro-core/src/workspace/loader.js');

test('built-in default workspace pack is generic', () => {
  const out = runNode(`
    const loader = require(${JSON.stringify(LOADER)});
    process.stdout.write(JSON.stringify({
      packIds: loader.PACK_IDS,
      defaultPack: loader.DEFAULT_PACK_ID,
      resolved: loader.resolvePackId(),
    }));
  `);
  assert.equal(out.code, 0, out.stderr);
  const payload = JSON.parse(out.stdout);
  assert.equal(payload.defaultPack, 'generic');
  assert.equal(payload.resolved, 'generic');
  assert.deepEqual(payload.packIds, ['generic', 'stub']);
});

test('unknown pack ids fall back to generic instead of loading a private pack', () => {
  const out = runNode(`
    const loader = require(${JSON.stringify(LOADER)});
    process.stdout.write(loader.resolvePackId({ workspace: 'acme-private' }));
  `);
  assert.equal(out.code, 0, out.stderr);
  assert.equal(out.stdout, 'generic');
});

test('requiring metro-core without bin/metro.js env does not crash', () => {
  const out = runNode(`
    const core = require(${JSON.stringify(path.join(REPO_ROOT, 'packages/metro-core/src/cli.js'))});
    process.stdout.write(typeof core.run);
  `);
  assert.equal(out.code, 0, out.stderr);
  assert.equal(out.stdout, 'function');
});

test('every shipped pack exports an ops map', () => {
  for (const id of ['generic', 'stub']) {
    const out = runNode(`
      const loader = require(${JSON.stringify(LOADER)});
      const pack = loader.loadWorkspacePack(${JSON.stringify(id)});
      process.stdout.write(JSON.stringify({ hasOps: pack.ops !== null && typeof pack.ops === 'object' }));
    `);
    assert.equal(out.code, 0, out.stderr);
    assert.equal(JSON.parse(out.stdout).hasOps, true, id);
  }
});

test('write ops refuse with a clear message when the pack lacks them', () => {
  const result = runMetro(['contract', 'expire', 'preflight', '--customer-id=00000000-0000-4000-8000-000000000001', '--sandbox']);
  assert.equal(result.code, 2);
  const payload = JSON.parse(result.stderr);
  assert.equal(payload.refused, true);
  assert.equal(payload.op, 'contract-expire');
  assert.equal(payload.workspacePack, 'generic');
  assert.match(payload.reason, /does not provide the "contract-expire" operation/);
});

test('loadPackOp resolves module and lazy-loader entries from pack.ops', () => {
  const out = runNode(`
    const { loadPackOp, listPackOps } = require(${JSON.stringify(path.join(REPO_ROOT, 'packages/metro-core/src/workspace/pack-ops.js'))});
    const mod = { runPreflight() {} };
    const pack = { ops: { 'contract-expire': mod, 'ledger-adjustment': () => mod } };
    process.stdout.write(JSON.stringify({
      direct: loadPackOp('contract-expire', { pack }) === mod,
      lazy: loadPackOp('ledger-adjustment', { pack }) === mod,
      missing: loadPackOp('package-list', { pack }),
      names: listPackOps({ pack }),
    }));
  `);
  assert.equal(out.code, 0, out.stderr);
  assert.deepEqual(JSON.parse(out.stdout), {
    direct: true,
    lazy: true,
    missing: null,
    names: ['contract-expire', 'ledger-adjustment'],
  });
});

test('workspace list shows only shipped packs', () => {
  const result = runMetro(['workspace', 'list', '--json']);
  assert.equal(result.code, 0, result.stderr);
  const text = result.stdout;
  assert.ok(!/"lev"/.test(text));
  assert.match(text, /"generic"/);
});

test('a sticky config pack still wins over the built-in default', () => {
  const home = tempDir();
  fs.mkdirSync(path.join(home, '.metro'), { recursive: true });
  fs.writeFileSync(path.join(home, '.metro', 'config.json'), JSON.stringify({ defaultWorkspacePack: 'stub' }));
  const out = runNode(`
    process.stdout.write(require(${JSON.stringify(LOADER)}).resolvePackId());
  `, { home });
  assert.equal(out.code, 0, out.stderr);
  assert.equal(out.stdout, 'stub');
});
