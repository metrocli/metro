'use strict';

// Fails if anything shipped in the npm package (package.json "files") names
// the tenant this CLI was extracted from, or carries its real ids.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { REPO_ROOT } = require('./helpers');

const LEAK_PATTERN = /\blev\b|\blevos\b|hubspot|hyperline|6b0b44be|13117714|\bstrato\b|lev_id|levAccountId|metro-workspace-lev|levco|samhadar/i;
const TEXT_EXTENSIONS = new Set(['.js', '.json', '.md', '.html', '.css', '.sh', '.txt', '.yml', '.yaml', '']);
// Paths (relative to the repo root) allowed to match. Keep empty unless truly needed.
const ALLOWLIST = new Set([]);
// Single lines allowed to match: "<path>" -> substring the line must contain.
// source-boundary keeps the pre-0.2 input field names as deprecated aliases for
// one release so existing manifests keep validating (with a warning). Remove
// this entry together with the alias.
const LINE_ALLOWLIST = new Map([
  ['packages/metro-core/src/source-boundary/index.js', 'const DEPRECATED_KEYS = {'],
]);

function walk(target, out) {
  if (!fs.existsSync(target)) return;
  const stat = fs.statSync(target);
  if (stat.isDirectory()) {
    for (const entry of fs.readdirSync(target)) {
      if (entry === 'node_modules' || entry === '.git') continue;
      walk(path.join(target, entry), out);
    }
  } else if (TEXT_EXTENSIONS.has(path.extname(target))) {
    out.push(target);
  }
}

function shippedFiles() {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  const files = [path.join(REPO_ROOT, 'package.json')];
  for (const entry of pkg.files || []) {
    if (entry.startsWith('!')) continue;
    walk(path.join(REPO_ROOT, entry), files);
  }
  return files;
}

test('package.json files list is non-empty', () => {
  assert.ok(shippedFiles().length > 50);
});

test('no tenant-specific strings in shipped files', () => {
  const hits = [];
  for (const file of shippedFiles()) {
    const rel = path.relative(REPO_ROOT, file);
    if (ALLOWLIST.has(rel)) continue;
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, index) => {
      if (LINE_ALLOWLIST.has(rel) && line.includes(LINE_ALLOWLIST.get(rel))) return;
      if (LEAK_PATTERN.test(line)) hits.push(`${rel}:${index + 1}: ${line.trim().slice(0, 160)}`);
    });
  }
  assert.deepEqual(hits, [], `Tenant-specific strings found:\n${hits.join('\n')}`);
});
