#!/usr/bin/env node
'use strict';

// Regenerates the generated reference pages in docs/metronome-cli/site from
// the CLI's own catalogs (HTML + Markdown), then runs verify-site.js.
//   node scripts/docs-site-refresh.js          write pages, then verify
//   node scripts/docs-site-refresh.js --check  fail if any page is stale (no writes)

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const siteDir = path.join(root, 'docs/metronome-cli/site');
const bin = path.join(root, 'bin/metro.js');
const check = process.argv.includes('--check');

const PAGES = [
  ['command-reference', ['docs', 'command-reference']],
  ['explain-reference', ['docs', 'explain', '--list']],
  ['api-reference', ['docs', 'api-reference']],
  ['evidence-gate-reference', ['docs', 'evidence-gate-reference']],
  ['input-reference', ['docs', 'input-reference']],
  ['shape-reference', ['docs', 'shape-reference']],
  ['validator-reference', ['docs', 'validator-reference']],
  ['gotcha-reference', ['docs', 'gotcha-reference']],
];

function render(args) {
  const result = spawnSync(process.execPath, [bin, ...args], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) {
    throw new Error(`metro ${args.join(' ')} failed: ${result.stderr}`);
  }
  return result.stdout;
}

const stale = [];
for (const [name, args] of PAGES) {
  for (const ext of ['html', 'md']) {
    const file = path.join(siteDir, `${name}.${ext}`);
    const next = render([...args, ext === 'html' ? '--html' : '--markdown']);
    const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
    if (current === next) continue;
    stale.push(path.relative(root, file));
    if (!check) fs.writeFileSync(file, next);
  }
}

if (check && stale.length) {
  console.error(`Stale generated docs (run npm run docs:site:refresh):\n${stale.map((f) => `- ${f}`).join('\n')}`);
  process.exit(1);
}
console.log(check ? 'Generated docs are current.' : `Regenerated ${stale.length} file(s)${stale.length ? `: ${stale.join(', ')}` : ''}.`);

const verify = spawnSync(process.execPath, [path.join(siteDir, 'verify-site.js')], { cwd: root, stdio: 'inherit' });
process.exit(verify.status === null ? 1 : verify.status);
