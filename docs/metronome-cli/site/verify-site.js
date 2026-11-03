#!/usr/bin/env node
'use strict';

// Verifies the docs site in this repo:
// - generated reference pages (HTML + Markdown) match what the CLI renders now
// - every local href/src/url() and #anchor resolves
// - every data-source id exists in sources.json, and every local source href exists
// - no internal monorepo paths (metronome-cli/src, test/golden, ...) leak into pages
// - required sections, shared scripts and static assets are present
// Collects every failure and prints them all, exit 1 on any.
//
// Regenerate stale pages with: npm run docs:site:refresh

const fs = require('fs');
const path = require('path');

const siteDir = __dirname;
const packageRoot = path.resolve(siteDir, '../../..');
const coreSrc = (...segments) => path.join(packageRoot, 'packages/metro-core/src', ...segments);

const { apiReference } = require(coreSrc('docs/api-reference'));
const { renderApiReferenceHtml } = require(coreSrc('docs/api-reference-html'));
const { commandReference } = require(coreSrc('commands/catalog'));
const { renderCommandReferenceHtml } = require(coreSrc('docs/command-reference-html'));
const { docsExplainTopicIndex } = require(coreSrc('docs/explain'));
const { renderExplainReferenceHtml } = require(coreSrc('docs/explain-reference-html'));
const { evidenceGateReference } = require(coreSrc('docs/evidence-gate-reference'));
const { renderEvidenceGateReferenceHtml } = require(coreSrc('docs/evidence-gate-reference-html'));
const { gotchaReference } = require(coreSrc('docs/gotcha-reference'));
const { renderGotchaReferenceHtml } = require(coreSrc('docs/gotcha-reference-html'));
const { inputReference } = require(coreSrc('docs/input-reference'));
const { renderInputReferenceHtml } = require(coreSrc('docs/input-reference-html'));
const { shapeReference, validatorReference } = require(coreSrc('docs/shape-validator-reference'));
const { renderShapeReferenceHtml, renderValidatorReferenceHtml } = require(coreSrc('docs/shape-validator-reference-html'));
const { renderReferenceMarkdown } = require(coreSrc('docs/reference-markdown'));

// [page, payload builder, HTML renderer, markdown title (as the CLI passes it)]
const GENERATED_PAGES = [
  ['command-reference', commandReference, renderCommandReferenceHtml, 'command reference'],
  ['explain-reference', docsExplainTopicIndex, renderExplainReferenceHtml, 'Docs explain topic index'],
  ['api-reference', () => apiReference({ family: null }), renderApiReferenceHtml, 'api reference'],
  ['evidence-gate-reference', evidenceGateReference, renderEvidenceGateReferenceHtml, 'evidence gate reference'],
  ['input-reference', inputReference, renderInputReferenceHtml, 'input reference'],
  ['shape-reference', shapeReference, renderShapeReferenceHtml, 'shape reference'],
  ['validator-reference', validatorReference, renderValidatorReferenceHtml, 'validator reference'],
  ['gotcha-reference', gotchaReference, renderGotchaReferenceHtml, 'gotcha reference'],
];

const HAND_WRITTEN_PAGES = ['index.html', 'install.html', 'integration.html', 'agents.html', 'cookbook.html', 'metronome-upstream.html'];

const REQUIRED_INDEX_SECTIONS = [
  'home', 'setup', 'safety', 'commands', 'shapes', 'validators', 'gotchas',
  'proof', 'try-it', 'live-today', 'quick-paths', 'agents', 'changelog', 'sources',
];

const STATIC_ASSETS = ['styles.css', 'layout.js', 'site.js', 'nav.js', 'assets/favicon-dark.png', 'assets/favicon-light.png'];

// Commands that must appear in the generated command reference.
const REQUIRED_COMMAND_IDS = [
  'init', 'init.check',
  'customer.create.preflight', 'customer.create.apply',
  'ratecard.create.preflight', 'ratecard.create.apply',
  'package.create.preflight', 'package.create.apply',
  'contract.create.preflight', 'contract.create.apply',
  'subscription.add.preflight', 'subscription.add.apply',
];

// Paths that only exist in the internal monorepo this CLI was extracted from.
const INTERNAL_PATH = /(?<![\w./-])metronome-cli\/(src|test|bin|packages|scripts)\/|(?<![\w./-])test\/golden\b/;

const failures = [];
function check(condition, message) {
  if (!condition) failures.push(message);
}

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function sitePath(name) {
  return path.join(siteDir, name);
}

function parseSourceIds(html) {
  const ids = new Set();
  const sourceAttr = /data-source="([^"]+)"/g;
  let match;
  while ((match = sourceAttr.exec(html)) !== null) {
    for (const token of match[1].trim().split(/\s+/)) {
      if (token) ids.add(token);
    }
  }
  return [...ids].sort();
}

function htmlIds(html) {
  const ids = new Set();
  const idAttr = /\bid="([^"]+)"/g;
  let match;
  while ((match = idAttr.exec(html)) !== null) ids.add(match[1]);
  return ids;
}

function isSkippedReference(reference) {
  return !reference || /^(https?:|data:|mailto:|tel:|javascript:)/.test(reference) || reference.includes('${');
}

const idCache = new Map();
function verifyLocalReference(fromFile, reference, label) {
  if (isSkippedReference(reference)) return 0;
  const hashIndex = reference.indexOf('#');
  const beforeHash = hashIndex === -1 ? reference : reference.slice(0, hashIndex);
  const fragment = hashIndex === -1 ? '' : reference.slice(hashIndex + 1);
  const filePart = beforeHash.split('?')[0];
  const target = filePart ? path.resolve(path.dirname(fromFile), decodeURI(filePart)) : fromFile;
  if (!fs.existsSync(target)) {
    failures.push(`${label} points at missing local file: ${reference}`);
    return 1;
  }
  if (fragment && path.extname(target) === '.html') {
    if (!idCache.has(target)) idCache.set(target, htmlIds(read(target)));
    check(idCache.get(target).has(fragment), `${label} points at missing local anchor: ${reference}`);
  }
  return 1;
}

function verifyHtmlReferences(file, html) {
  let count = 0;
  const attr = /\b(?:href|src)="([^"]+)"/g;
  let match;
  while ((match = attr.exec(html)) !== null) count += verifyLocalReference(file, match[1], path.basename(file));
  return count;
}

function verifyCssReferences(file, css) {
  let count = 0;
  const url = /url\(([^)]+)\)/g;
  let match;
  while ((match = url.exec(css)) !== null) {
    count += verifyLocalReference(file, match[1].trim().replace(/^['"]|['"]$/g, ''), path.basename(file));
  }
  return count;
}

function main() {
  // Generated pages are current.
  for (const [name, build, renderHtml, mdTitle] of GENERATED_PAGES) {
    const payload = build();
    for (const [ext, expected] of [['html', renderHtml(payload)], ['md', renderReferenceMarkdown(payload, { title: mdTitle })]]) {
      const file = sitePath(`${name}.${ext}`);
      check(fs.existsSync(file) && read(file) === expected, `${name}.${ext} is stale; run npm run docs:site:refresh`);
    }
  }

  const commandIds = new Set(commandReference().commands.map((command) => command.id));
  for (const id of REQUIRED_COMMAND_IDS) {
    check(commandIds.has(id), `command catalog missing ${id}`);
  }
  const commandReferenceMd = read(sitePath('command-reference.md'));
  for (const id of REQUIRED_COMMAND_IDS) {
    check(commandReferenceMd.includes(`| ${id} |`), `command-reference.md missing ${id}`);
  }

  const htmlPages = [...HAND_WRITTEN_PAGES, ...GENERATED_PAGES.map(([name]) => `${name}.html`)];
  const pageHtml = {};
  for (const name of htmlPages) {
    const file = sitePath(name);
    if (!fs.existsSync(file)) {
      failures.push(`missing page: ${name}`);
      continue;
    }
    pageHtml[name] = read(file);
  }

  // Index structure.
  const indexHtml = pageHtml['index.html'] || '';
  for (const section of REQUIRED_INDEX_SECTIONS) {
    check(indexHtml.includes(`id="${section}"`), `index.html missing required section: ${section}`);
  }

  // Per-page hygiene.
  let referenceCount = 0;
  for (const [name, html] of Object.entries(pageHtml)) {
    const tab = html.indexOf('\t');
    check(tab === -1, `${name} contains a tab character near offset ${tab}`);
    for (const marker of ['TODO', 'TBD']) {
      check(!html.includes(marker), `${name} contains unresolved marker: ${marker}`);
    }
    html.split('\n').forEach((line, index) => {
      check(!INTERNAL_PATH.test(line), `${name}:${index + 1} cites an internal monorepo path: ${line.trim().slice(0, 140)}`);
    });
    if (GENERATED_PAGES.some(([page]) => name === `${page}.html`) || name === 'install.html' || name === 'integration.html') {
      for (const script of ['layout.js', 'nav.js', 'site.js']) {
        check(html.includes(`<script src="${script}"></script>`), `${name} missing shared ${script} script`);
      }
    }
    referenceCount += verifyHtmlReferences(sitePath(name), html);
  }
  for (const name of GENERATED_PAGES.map(([page]) => `${page}.md`).concat(['agents.md'])) {
    const file = sitePath(name);
    if (!fs.existsSync(file)) continue;
    read(file).split('\n').forEach((line, index) => {
      check(!INTERNAL_PATH.test(line), `${name}:${index + 1} cites an internal monorepo path: ${line.trim().slice(0, 140)}`);
    });
  }

  for (const asset of STATIC_ASSETS) {
    check(fs.existsSync(sitePath(asset)), `missing static asset: ${asset}`);
  }
  referenceCount += verifyCssReferences(sitePath('styles.css'), read(sitePath('styles.css')));

  // Sources.
  const sourceMap = JSON.parse(read(sitePath('sources.json')));
  const sources = sourceMap.sources || {};
  check(sourceMap.schemaVersion === 'metro.docs.sources.v1', 'sources.json schemaVersion mismatch');
  for (const [sourceId, source] of Object.entries(sources)) {
    check(source.title, `source "${sourceId}" missing title`);
    check(source.href, `source "${sourceId}" missing href`);
    check(Array.isArray(source.supports) && source.supports.length > 0, `source "${sourceId}" missing supports list`);
    if (source.href && !/^https?:\/\//.test(source.href)) {
      check(fs.existsSync(path.resolve(siteDir, source.href.split('#')[0])), `source "${sourceId}" points at missing local file: ${source.href}`);
    }
    check(!INTERNAL_PATH.test(JSON.stringify(source)), `source "${sourceId}" cites an internal monorepo path`);
  }
  const usedSourceIds = parseSourceIds(Object.values(pageHtml).join('\n'));
  for (const sourceId of usedSourceIds) {
    check(sources[sourceId], `HTML references missing source id: ${sourceId}`);
  }

  if (failures.length) {
    console.error(`Docs site verification failed (${failures.length}):`);
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }
  console.log(`Docs site verified: ${htmlPages.length} pages, ${GENERATED_PAGES.length * 2} generated files current, ${usedSourceIds.length} used source ids, ${Object.keys(sources).length} source records, ${referenceCount} local references.`);
}

if (require.main === module) {
  main();
}

module.exports = { parseSourceIds };
