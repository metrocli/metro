'use strict';

// Every skills/<name> citation in shipped files must point at a skill that
// ships (skills/<name>/ exists, and a cited file inside it exists).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { REPO_ROOT } = require('./helpers');

const TEXT_EXTENSIONS = new Set(['.js', '.json', '.md', '.html', '.txt', '.yml', '.yaml', '.sh', '']);
// skills/<name> optionally followed by /<file>; stops at quotes, spaces, #, ), <, backticks.
const CITATION = /(?<![\w./-])skills\/([A-Za-z0-9_-]+)(\/[^\s'"`#)<>,]+)?/g;

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

test('every skills/<name> citation in shipped files exists', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  const files = [];
  for (const entry of pkg.files || []) {
    if (!entry.startsWith('!')) walk(path.join(REPO_ROOT, entry), files);
  }
  const missing = [];
  let checked = 0;
  for (const file of files) {
    const rel = path.relative(REPO_ROOT, file);
    fs.readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
      for (const match of line.matchAll(CITATION)) {
        const [, name, rest] = match;
        if (name.startsWith('<')) continue;
        checked += 1;
        const target = path.join(REPO_ROOT, 'skills', name, (rest || '').replace(/[.:;]+$/, ''));
        if (!fs.existsSync(target)) missing.push(`${rel}:${index + 1}: ${match[0]}`);
      }
    });
  }
  assert.ok(checked > 50, `expected many skill citations, found ${checked}`);
  assert.deepEqual(missing, [], `Missing skills:\n${missing.join('\n')}`);
});
