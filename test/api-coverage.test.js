'use strict';

// Offline checks for scripts/metronome-api-coverage.js. The fixture holds only the
// endpoint list extracted from docs.metronome.com/llms-full.txt (method, path,
// title, page URL); each test rebuilds a minimal llms-full.txt from it, so no
// Metronome prose is stored in this repo.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { REPO_ROOT, tempDir } = require('./helpers');

const SCRIPT = path.join(REPO_ROOT, 'scripts/metronome-api-coverage.js');
const cov = require(SCRIPT);
const fixture = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'test/fixtures/metronome-api-endpoints.json'), 'utf8'));
const committed = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'docs/metronome-cli/API_COVERAGE.json'), 'utf8'));

function llmsFullFrom(endpoints, { duplicateAsTranslation = false } = {}) {
  const page = (e) => `# ${e.title}\nSource: ${e.docUrl}\n\n/openapi.json ${e.method.toLowerCase()} ${e.path}\n(page prose omitted)\n\n`;
  let text = '# Guides\nSource: https://docs.metronome.com/guides/example\n\nNo endpoint here.\n\n';
  text += endpoints.map(page).join('');
  if (duplicateAsTranslation) text += endpoints.slice(0, 5).map((e) => page({ ...e, title: `FR ${e.title}` })).join('');
  return text;
}

function run(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { cwd: REPO_ROOT, encoding: 'utf8' });
}

test('parser extracts every endpoint from llms-full.txt and dedupes repeated pages', () => {
  const parsed = cov.parseLlmsFull(llmsFullFrom(fixture.endpoints, { duplicateAsTranslation: true }));
  assert.equal(parsed.length, fixture.endpoints.length);
  const keys = new Set(parsed.map((e) => cov.key(e.method, e.path)));
  for (const e of fixture.endpoints) assert.ok(keys.has(cov.key(e.method, e.path)), `${e.method} ${e.path}`);
  const ingest = parsed.find((e) => e.path === '/v1/ingest');
  assert.equal(ingest.method, 'POST');
  assert.match(ingest.docUrl, /^https:\/\/docs\.metronome\.com\/api-reference\//);
  assert.equal(ingest.docMarkdown, `${ingest.docUrl}.md`);
  assert.ok(!parsed.some((e) => e.title.startsWith('FR ')), 'first page per endpoint wins');
});

test('ops scan finds the endpoints the generic pack ops call, with the right method', () => {
  const uses = cov.scanOps();
  const has = (method, p, command) => uses.some((u) => u.method === method && cov.normPath(u.path) === cov.normPath(p) && (!command || u.command === command));
  assert.ok(has('POST', '/v1/contracts/addManualBalanceLedgerEntry', 'metro ledger-adjustment'));
  assert.ok(has('POST', '/v1/contracts/customerBalances/getNetBalance', 'metro customer balances'));
  assert.ok(has('GET', '/v1/customers/{customer_id}/invoices', 'metro contract repair-accidental'));
  assert.ok(has('GET', '/v1/customers', 'metro customer create'));
  assert.ok(has('POST', '/v1/customers', 'metro customer create'));
  assert.ok(has('POST', '/v1/contracts/archive', 'metro contract repair-accidental'));
});

test('committed API_COVERAGE.json matches the fixture endpoint set and is internally consistent', () => {
  assert.equal(committed.schemaVersion, 'metro.api-coverage.v1');
  assert.match(committed.checkedAt, /^\d{4}-\d{2}-\d{2}$/);
  const diff = cov.upstreamDiff(committed.endpoints, fixture.endpoints);
  assert.equal(diff.changed, false, 'fixture and committed upstream lists diverged; regenerate both');
  const s = committed.summary;
  assert.equal(s.total, committed.endpoints.length);
  const sum = Object.values(s.byStatus).reduce((a, b) => a + b, 0);
  assert.equal(sum, s.total);
  assert.equal(s.covered, s.total - s.byStatus['not-yet']);
  for (const e of committed.endpoints) {
    assert.match(e.docUrl, /^https:\/\/docs\.metronome\.com\/api-reference\/[\w/-]+$/);
    assert.ok(['op', 'catalog-read', 'catalog-write', 'not-yet'].includes(e.status), e.status);
    if (e.status === 'op') assert.ok(e.ops.length > 0);
    if (e.status.startsWith('catalog')) assert.ok(e.catalogId);
  }
});

test('every catalog read entry that names a docs page points at a documented endpoint', () => {
  const byKey = new Map(committed.endpoints.map((e) => [cov.key(e.method, e.path), e]));
  for (const e of committed.endpoints.filter((x) => x.catalogId)) {
    assert.ok(byKey.has(cov.key(e.method, e.path)));
  }
});

test('committed coverage files are current with the catalog and ops (offline rebuild)', () => {
  const r = run(['--offline', '--verify']);
  assert.equal(r.status, 0, r.stderr || r.stdout);
});

test('--check passes on the same endpoint set and fails with a diff when upstream changes', () => {
  const dir = tempDir('metro-coverage-');
  const same = path.join(dir, 'same.txt');
  fs.writeFileSync(same, llmsFullFrom(fixture.endpoints));
  const ok = run(['--check', '--llms-full', same]);
  assert.equal(ok.status, 0, ok.stderr || ok.stdout);

  const changed = [...fixture.endpoints.slice(1), { method: 'POST', path: '/v1/example/new', title: 'A new endpoint', docUrl: 'https://docs.metronome.com/api-reference/example/a-new-endpoint' }];
  const changedFile = path.join(dir, 'changed.txt');
  const report = path.join(dir, 'report.md');
  fs.writeFileSync(changedFile, llmsFullFrom(changed));
  const bad = run(['--check', '--llms-full', changedFile, '--report', report]);
  assert.equal(bad.status, 1, bad.stderr || bad.stdout);
  const md = fs.readFileSync(report, 'utf8');
  assert.match(md, /### Added \(1\)/);
  assert.match(md, /POST \/v1\/example\/new/);
  assert.match(md, /### Removed \(1\)/);
  assert.ok(md.includes(`${fixture.endpoints[0].method} ${fixture.endpoints[0].path}`));
});
