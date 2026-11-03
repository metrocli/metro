#!/usr/bin/env node
'use strict';

/**
 * Offline default: validate frozen Metronome changelog inventory.
 * Explicit --fetch: pull https://docs.metronome.com/changelog.md and report drift.
 *
 * Does not mutate the repo. Run scripts/generate-metronome-upstream.js --fetch
 * when you intend to rewrite the inventory.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.resolve(__dirname, '..');
const JSON_PATH = path.join(ROOT, 'docs/metronome-cli/site/metronome-upstream.json');
const MD_PATH = path.join(ROOT, 'docs/metronome-cli/METRONOME_UPSTREAM_CHANGELOG.md');
const SOURCE_MD = 'https://docs.metronome.com/changelog.md';

function fail(message) {
  console.error(`docs:upstream:check FAILED: ${message}`);
  process.exit(1);
}

function loadInventory() {
  if (!fs.existsSync(JSON_PATH)) fail(`missing ${JSON_PATH}`);
  if (!fs.existsSync(MD_PATH)) fail(`missing ${MD_PATH}`);
  const inventory = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
  if (inventory.schemaVersion !== 'metro.metronome-upstream.v1') {
    fail(`unexpected schemaVersion ${inventory.schemaVersion}`);
  }
  if (!Array.isArray(inventory.entries) || inventory.entries.length === 0) {
    fail('inventory.entries empty');
  }
  return inventory;
}

// docs.metronome.com/changelog.md used to wrap entries in <Update label="..."> blocks;
// it now renders "**Month D, YYYY**" date lines before each "## Title". Map the new
// shape onto the old marker so one parser handles both.
function normalizeChangelog(markdown) {
  if (/<Update\s+label=/.test(markdown)) return markdown;
  return markdown.replace(/^\*\*([A-Z][a-z]+ \d{1,2}, \d{4})\*\*\s*$/gm, '<Update label="$1">');
}

function parseRemoteUpdates(markdown) {
  const parts = normalizeChangelog(markdown).split(/(?=<Update\s+label=)/);
  const titles = [];
  for (const part of parts.slice(1)) {
    const m = part.match(/^<Update\s+label="([^"]+)"/);
    const titleM = part.match(/##\s+(.+)/);
    if (!m || !titleM) continue;
    titles.push({ date: m[1], title: titleM[1].trim() });
  }
  return titles;
}

function fetchText(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'User-Agent': 'metro-cli-docs-upstream-check/1.0' } }, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          fetchText(res.headers.location).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} for ${url}`));
          return;
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      })
      .on('error', reject);
  });
}

function checkOffline(inventory) {
  const md = fs.readFileSync(MD_PATH, 'utf8');
  if (!md.includes(inventory.source)) fail('markdown missing official changelog source URL');
  if (!md.includes('Batch / large requests')) fail('markdown missing batch/large-request section');
  if (!md.includes(inventory.syncedAt)) fail(`markdown missing syncedAt ${inventory.syncedAt}`);

  const mdTitles = [...md.matchAll(/^### [^\n]+ - (.+)$/gm)].map((m) => m[1].trim());
  if (mdTitles.length !== inventory.entries.length) {
    fail(`markdown titles ${mdTitles.length} != inventory entries ${inventory.entries.length}`);
  }

  const gaps = inventory.entries.filter((e) => e.coverageStatus === 'gap');
  const partialApi = inventory.entries.filter(
    (e) => e.coverageStatus === 'partial' && Array.isArray(e.tags) && e.tags.includes('API'),
  );

  console.log('docs:upstream:check OK (offline)');
  console.log(`  syncedAt: ${inventory.syncedAt}`);
  console.log(`  entries: ${inventory.entries.length}`);
  console.log(`  gaps: ${gaps.length}`);
  console.log(`  partial+API: ${partialApi.length}`);
  for (const g of gaps) {
    console.log(`  GAP: ${g.date} - ${g.title}`);
  }
}

async function checkFetch(inventory) {
  const remote = await fetchText(SOURCE_MD);
  const remoteTitles = parseRemoteUpdates(remote);
  const localKeys = new Set(inventory.entries.map((e) => `${e.date}::${e.title}`));
  const remoteKeys = new Set(remoteTitles.map((e) => `${e.date}::${e.title}`));

  const added = remoteTitles.filter((e) => !localKeys.has(`${e.date}::${e.title}`));
  const removed = inventory.entries.filter((e) => !remoteKeys.has(`${e.date}::${e.title}`));

  console.log('docs:upstream:check fetch complete');
  console.log(`  local: ${inventory.entries.length}  remote: ${remoteTitles.length}`);
  if (added.length === 0 && removed.length === 0) {
    console.log('  no drift vs frozen inventory');
    return;
  }
  for (const e of added) console.log(`  NEW upstream: ${e.date} - ${e.title}`);
  for (const e of removed) console.log(`  ONLY local: ${e.date} - ${e.title}`);
  console.error(
    '\nDrift detected. Refresh with:\n  node scripts/generate-metronome-upstream.js --fetch\nthen curl linked official docs and update catalog/matrix/shapes as needed.',
  );
  process.exit(2);
}

async function main() {
  const fetch = process.argv.includes('--fetch');
  const inventory = loadInventory();
  checkOffline(inventory);
  if (fetch) await checkFetch(inventory);
}

main().catch((err) => {
  fail(err.message || String(err));
});
