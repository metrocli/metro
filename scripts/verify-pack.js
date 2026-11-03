#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';

// Checks what `npm pack` would ship: the right name, the runtime files, and none
// of the files that must stay out (live apply logs, tests, CI, local env files).

const { execFileSync } = require('child_process');

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const raw = execFileSync(npm, ['pack', '--dry-run', '--json', '--ignore-scripts'], { encoding: 'utf8' });
const pack = JSON.parse(raw)[0];
const paths = new Set(pack.files.map((f) => f.path));

const errors = [];
if (pack.name !== '@metrocli/metro') errors.push(`unexpected package name: ${pack.name}`);

const required = [
  'bin/metro.js',
  'packages/metro-core/src/cli.js',
  'packages/metro-core/src/init/index.js',
  'packages/metro-core/src/install/doctor.js',
  'packages/metro-workspace-generic/src/plan.js',
  'AGENTS.md',
  'llms.txt',
  'README.md',
  'LICENSE',
];
for (const p of required) if (!paths.has(p)) errors.push(`pack missing ${p}`);

const banned = [...paths].filter((p) => (
  /(^|\/)logs\//.test(p)
  || /^test\//.test(p)
  || /(^|\/)\.github\//.test(p)
  || /(^|\/)\.env($|\.)/.test(p)
  || /metro-workspace-(?!generic|stub)/.test(p)
));
if (banned.length) errors.push(`pack contains paths that must not ship:\n  ${banned.join('\n  ')}`);

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`pack ok: ${pack.filename} (${pack.files.length} files)`);
