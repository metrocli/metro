#!/usr/bin/env node
'use strict';

/**
 * Metronome API coverage: what docs.metronome.com documents vs what metro wraps.
 *
 *   node scripts/metronome-api-coverage.js            fetch upstream, write API_COVERAGE.json + .md
 *   node scripts/metronome-api-coverage.js --check    fetch upstream, exit 1 if the endpoint set
 *                                                     (method + path + doc page) changed vs the
 *                                                     committed JSON; never writes coverage files
 *   node scripts/metronome-api-coverage.js --offline  rebuild from the committed upstream list
 *                                                     (no network) against the current catalog/ops
 *   ... --offline --verify                            exit 1 if the committed files are stale
 *   ... --llms-full <file> [--llms <file>]            read local copies instead of fetching
 *   ... --report <file>                               with --check: write the diff as markdown
 *
 * Upstream source: https://docs.metronome.com/llms.txt (index) and llms-full.txt (every page).
 * Each API reference page carries "# <title>", "Source: <url>" and "/openapi.json <method> <path>".
 * Only that endpoint list is extracted and stored; Metronome's prose is never copied.
 *
 * metro side: `metro api catalog --json` (reviewed endpoint contracts) and a static scan of the
 * endpoints the generic pack ops call (packages/metro-workspace-generic/src/ops).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const JSON_PATH = path.join(ROOT, 'docs/metronome-cli/API_COVERAGE.json');
const MD_PATH = path.join(ROOT, 'docs/metronome-cli/API_COVERAGE.md');
const OPS_DIR = path.join(ROOT, 'packages/metro-workspace-generic/src/ops');
const BIN = path.join(ROOT, 'bin/metro.js');

const LLMS_TXT = 'https://docs.metronome.com/llms.txt';
const LLMS_FULL = 'https://docs.metronome.com/llms-full.txt';
const SCHEMA_VERSION = 'metro.api-coverage.v1';

const STATUS = {
  op: 'op',
  catalogRead: 'catalog-read',
  catalogWrite: 'catalog-write',
  notYet: 'not-yet',
};

const STATUS_TEXT = {
  op: 'Called live by a metro op (reads directly; writes only through preflight, confirm hash, sandbox-first apply and read-back).',
  'catalog-read': 'Reviewed read contract in `metro api catalog` (request shape, scope, docs link); no dedicated live command yet unless one is listed.',
  'catalog-write': 'Reviewed write contract in `metro api catalog`; local preview and validation only, live apply blocked unless an op covers it.',
  'not-yet': 'Documented by Metronome; metro has no catalog entry or op for it yet. Read the Metronome page directly.',
};

// ---------------------------------------------------------------- upstream

function fetchText(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'User-Agent': 'metro-cli-api-coverage/1.0' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects < 5) {
          res.resume();
          fetchText(new URL(res.headers.location, url).toString(), redirects + 1).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
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

function normPath(p) {
  return String(p).split('?')[0].replace(/\{[^}]*\}/g, '{}');
}

function key(method, p) {
  return `${String(method).toUpperCase()} ${normPath(p)}`;
}

function familyFromUrl(url) {
  const m = String(url).match(/\/api-reference\/([^/]+)\//);
  return m ? m[1] : 'other';
}

/**
 * Extract every documented endpoint from llms-full.txt. A page is
 * "# Title" / "Source: <url>" / blank / "/openapi*.json <method> <path>".
 * Pages appear more than once (translations share the English Source URL);
 * the first English page per method+path wins.
 */
function parseLlmsFull(text) {
  const lines = String(text).split(/\r?\n/);
  const byKey = new Map();
  let title = null;
  let source = null;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const h = line.match(/^# (.+)$/);
    if (h) {
      title = h[1].trim();
      source = null;
      continue;
    }
    const s = line.match(/^Source: (https:\/\/docs\.metronome\.com\/\S+)\s*$/);
    if (s) {
      source = s[1];
      continue;
    }
    const o = line.match(/^\/openapi[\w.-]*\.json (get|post|put|patch|delete) (\/\S+)\s*$/i);
    if (o && source) {
      const method = o[1].toUpperCase();
      const apiPath = o[2];
      const k = key(method, apiPath);
      const existing = byKey.get(k);
      const english = !/\/(fr|de|es|ja)\//.test(source);
      if (!existing || (!existing.english && english)) {
        byKey.set(k, { method, path: apiPath, title, docUrl: source, english });
      }
    }
  }
  return [...byKey.values()]
    .map(({ english, ...e }) => ({ ...e, family: familyFromUrl(e.docUrl), docMarkdown: `${e.docUrl}.md` }))
    .sort((a, b) => a.family.localeCompare(b.family) || a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
}

/** Facts from llms.txt we record (not endpoints): legacy Plans pages it lists, and its index links. */
function parseLlmsTxt(text) {
  const lines = String(text || '').split(/\r?\n/);
  const legacyPlans = lines.filter((l) => /^- \[.+\]\(https:\/\/docs\.metronome\.com\/api-reference\/.+\.md\).*Plans \(deprecated\)/.test(l)).length;
  const indexes = lines
    .map((l) => l.match(/^- \[(.+?)\]\((https:\/\/docs\.metronome\.com\/_llms\/[^)]+)\)/))
    .filter(Boolean)
    .map((m) => ({ title: m[1], url: m[2] }));
  return { legacyPlansEndpointPages: legacyPlans, indexes };
}

// ---------------------------------------------------------------- metro side

function loadCatalog() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'metro-coverage-'));
  try {
    const env = { PATH: process.env.PATH, HOME: home, USERPROFILE: home };
    const r = spawnSync(process.execPath, [BIN, 'api', 'catalog', '--json'], { cwd: ROOT, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (r.status !== 0) throw new Error(`metro api catalog --json failed: ${r.stderr}`);
    return JSON.parse(r.stdout).endpoints;
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

function listJs(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listJs(p));
    else if (entry.name.endsWith('.js')) out.push(p);
  }
  return out.sort();
}

/** Split a file into top-level blocks (column-0 const/let/function/module statements). */
function topLevelBlocks(src) {
  const lines = src.split('\n');
  const blocks = [];
  let cur = null;
  const startRe = /^(?:async\s+)?function\s+(\w+)|^(?:const|let|var)\s+(\w+)|^(module\.exports)/;
  for (const line of lines) {
    const m = line.match(startRe);
    if (m) {
      cur = { name: m[1] || m[2] || m[3], text: '' };
      blocks.push(cur);
    }
    if (cur) cur.text += `${line}\n`;
  }
  return blocks;
}

const ENDPOINT_LITERAL = /(['`])(\/v[12]\/[^'`]*)\1/g;

function methodBefore(text, index) {
  const before = text.slice(Math.max(0, index - 160), index);
  const hits = [];
  const patterns = [
    [/\.get\(\s*$/g, 'GET'],
    [/\.post\(\s*$/g, 'POST'],
    [/['"]get['"]\s*,\s*$/gi, 'GET'],
    [/['"]post['"]\s*,\s*$/gi, 'POST'],
    [/method:\s*['"](GET|POST|PUT|PATCH|DELETE)['"]/gi, null],
  ];
  for (const [re, fixed] of patterns) {
    let m;
    while ((m = re.exec(before))) hits.push({ at: m.index, method: fixed || m[1].toUpperCase() });
  }
  hits.sort((a, b) => a.at - b.at);
  return hits.length ? hits[hits.length - 1].method : 'POST';
}

function literalsIn(text) {
  const found = [];
  let m;
  ENDPOINT_LITERAL.lastIndex = 0;
  while ((m = ENDPOINT_LITERAL.exec(text))) {
    let raw = m[2];
    raw = raw.replace(/\$\{[^}]*\}/g, '{}').split('?')[0].replace(/\$.*$/, '');
    found.push({ method: methodBefore(text, m.index), path: raw });
  }
  return found;
}

const LIB_ALIASES = { mx: 'lib/metronome.js', net: 'lib/net-balance.js', core: 'lib/core.js' };

/**
 * Static scan of the generic pack ops: which endpoints each op command reaches,
 * following same-file helpers and the shared lib helpers (mx.*, net.*).
 */
function scanOps(opsDir = OPS_DIR) {
  const files = listJs(opsDir);
  const blocksByFile = new Map();
  for (const f of files) {
    const rel = path.relative(opsDir, f).split(path.sep).join('/');
    blocksByFile.set(rel, topLevelBlocks(fs.readFileSync(f, 'utf8')));
  }
  const memo = new Map();
  function reach(rel, name, seen = new Set()) {
    const id = `${rel}:${name}`;
    if (memo.has(id)) return memo.get(id);
    if (seen.has(id)) return [];
    seen.add(id);
    const blocks = blocksByFile.get(rel) || [];
    const block = blocks.find((b) => b.name === name);
    if (!block) return [];
    const out = [...literalsIn(block.text)];
    const names = new Set(blocks.map((b) => b.name));
    const tokens = new Set(block.text.match(/\b\w+\b/g) || []);
    for (const t of tokens) if (t !== name && names.has(t)) out.push(...reach(rel, t, seen));
    let m;
    const qual = /\b(mx|net)\.(\w+)/g;
    while ((m = qual.exec(block.text))) out.push(...reach(LIB_ALIASES[m[1]], m[2], seen));
    memo.set(id, out);
    return out;
  }
  const uses = [];
  for (const [rel, blocks] of blocksByFile) {
    if (rel.startsWith('lib/') || rel === 'index.js') continue;
    for (const b of blocks) {
      const cmd = b.text.match(/command:\s*'(metro [^']+)'/);
      const readOp = b.text.match(/defineReadOp\('([\w-]+)'/);
      if (!cmd && !(readOp && b.name !== 'defineReadOp')) continue;
      const command = cmd ? cmd[1] : `metro ${readOp[1].replace('-', ' ')}`;
      for (const lit of reach(rel, b.name)) uses.push({ command, file: `packages/metro-workspace-generic/src/ops/${rel}`, ...lit });
    }
  }
  return uses;
}

// The ops runtime's write-shaped path test (ops/lib/runtime.js isWritePath).
const WRITE_PATHS = [
  /\/create\b/i, /\/edit\b/i, /\/archive/i, /\/void\b/i, /\/regenerate\b/i, /\/update/i,
  /\/set[A-Z]/, /\/ingest\b/i, /\/add[A-Z]/, /\/delete/i, /\/remove/i, /\/amend\b/i,
  /\/cancel\b/i, /\/upsert/i,
];
function isWritePath(method, p) {
  const bare = String(p).split('?')[0];
  if (String(method).toUpperCase() === 'POST' && bare === '/v1/customers') return true;
  return WRITE_PATHS.some((re) => re.test(bare));
}

// ---------------------------------------------------------------- coverage

function buildCoverage({ upstream, catalog, opUses, checkedAt, llms }) {
  const catalogByKey = new Map();
  for (const e of catalog) {
    const k = key(e.method, e.path);
    if (!catalogByKey.has(k)) catalogByKey.set(k, []);
    catalogByKey.get(k).push(e);
  }
  const opsByKey = new Map();
  for (const u of opUses) {
    const k = key(u.method, u.path);
    if (!opsByKey.has(k)) opsByKey.set(k, new Map());
    opsByKey.get(k).set(u.command, { command: u.command, kind: isWritePath(u.method, u.path) ? 'write' : 'read' });
  }
  const upstreamKeys = new Set(upstream.map((e) => key(e.method, e.path)));

  const endpoints = upstream.map((u) => {
    const k = key(u.method, u.path);
    const cat = (catalogByKey.get(k) || [])[0] || null;
    const ops = [...((opsByKey.get(k) || new Map()).values())].sort((a, b) => a.command.localeCompare(b.command));
    let status = STATUS.notYet;
    if (ops.length) status = STATUS.op;
    else if (cat) status = cat.operationType === 'read' ? STATUS.catalogRead : STATUS.catalogWrite;
    const commands = [
      ...ops.map((o) => o.command),
      ...(cat ? (cat.currentCommands || []).map((c) => c.split(' (')[0].split(' --')[0]) : []),
    ];
    if (cat && !commands.length) commands.push(`metro api explain ${cat.id}`);
    return {
      method: u.method,
      path: u.path,
      title: u.title,
      family: u.family,
      docUrl: u.docUrl,
      docMarkdown: u.docMarkdown,
      status,
      catalogId: cat ? cat.id : null,
      catalogOperation: cat ? cat.operationType : null,
      catalogSupportStatus: cat ? cat.supportStatus : null,
      ops,
      metroCommands: [...new Set(commands)],
    };
  });

  const metroOnly = [];
  for (const e of catalog) {
    if (!upstreamKeys.has(key(e.method, e.path))) {
      metroOnly.push({ source: 'catalog', id: e.id, method: e.method, path: e.path, note: 'In metro catalog but not documented in llms-full.txt; re-check the Metronome page before use.' });
    }
  }
  const seenOp = new Set();
  for (const u of opUses) {
    const k = key(u.method, u.path);
    if (upstreamKeys.has(k) || seenOp.has(`${k} ${u.command}`)) continue;
    seenOp.add(`${k} ${u.command}`);
    metroOnly.push({ source: 'op', id: u.command, method: u.method, path: u.path, note: 'Called by an op but not documented in llms-full.txt.' });
  }

  const count = (s) => endpoints.filter((e) => e.status === s).length;
  const inCatalog = endpoints.filter((e) => e.catalogId).length;
  const usedByOps = endpoints.filter((e) => e.ops.length).length;
  return {
    schemaVersion: SCHEMA_VERSION,
    checkedAt,
    sources: {
      llmsTxt: LLMS_TXT,
      llmsFullTxt: LLMS_FULL,
      perPageMarkdown: 'Append .md to any docUrl for the page as markdown.',
      extraction: '"/openapi.json <method> <path>" lines under each "Source:" page in llms-full.txt; endpoint list only, no prose copied.',
    },
    upstream: {
      endpointCount: upstream.length,
      legacyPlansEndpointPagesExcluded: llms ? llms.legacyPlansEndpointPages : null,
      note: 'Contracts API endpoints from llms-full.txt. Legacy Plans (deprecated) endpoints listed in llms.txt are out of scope.',
    },
    summary: {
      total: endpoints.length,
      covered: endpoints.length - count(STATUS.notYet),
      inCatalog,
      usedByOps,
      byStatus: {
        op: count(STATUS.op),
        'catalog-read': count(STATUS.catalogRead),
        'catalog-write': count(STATUS.catalogWrite),
        'not-yet': count(STATUS.notYet),
      },
      metroOnly: metroOnly.length,
    },
    statusMeaning: STATUS_TEXT,
    endpoints,
    metroOnly,
  };
}

function mdEscape(s) {
  return String(s).replace(/\|/g, '\\|');
}

function renderMarkdown(cov) {
  const s = cov.summary;
  const lines = [
    '# Metronome API coverage',
    '',
    `- schemaVersion: \`${cov.schemaVersion}\``,
    `- checked: ${cov.checkedAt} against ${cov.sources.llmsFullTxt}`,
    `- documented endpoints: ${s.total}; covered by metro: ${s.covered} (op ${s.byStatus.op}, catalog read ${s.byStatus['catalog-read']}, catalog write ${s.byStatus['catalog-write']}); not yet: ${s.byStatus['not-yet']}`,
    `- in \`metro api catalog\`: ${s.inCatalog}; called by ops: ${s.usedByOps}`,
    '',
    'Metronome\'s docs are the source of truth for every request and response field. Read the',
    'linked page (append `.md` for markdown) before building a request. metro\'s docs are the safety',
    'and workflow layer on top: tenant selection, preview, confirm hash, sandbox-first apply, read-back.',
    '',
    'Generated by `npm run docs:api:coverage` (`scripts/metronome-api-coverage.js`). Do not edit by hand.',
    '',
    '## Status',
    '',
    ...Object.entries(cov.statusMeaning).map(([k, v]) => `- \`${k}\`: ${v}`),
    '',
    '## Endpoints',
    '',
  ];
  const families = [...new Set(cov.endpoints.map((e) => e.family))];
  for (const fam of families) {
    lines.push(`### ${fam}`, '', '| Endpoint | Metronome docs | metro status | metro command |', '| --- | --- | --- | --- |');
    for (const e of cov.endpoints.filter((x) => x.family === fam)) {
      const cmd = e.metroCommands.length ? e.metroCommands.map((c) => `\`${c}\``).join('<br>') : '-';
      const status = e.catalogId ? `${e.status} (\`${e.catalogId}\`)` : e.status;
      lines.push(`| \`${e.method} ${mdEscape(e.path)}\` | [${mdEscape(e.title)}](${e.docUrl}) | ${status} | ${cmd} |`);
    }
    lines.push('');
  }
  if (cov.metroOnly.length) {
    lines.push('## In metro but not in the current Metronome docs', '', '| Source | Id | Endpoint | Note |', '| --- | --- | --- | --- |');
    for (const m of cov.metroOnly) lines.push(`| ${m.source} | \`${m.id}\` | \`${m.method} ${mdEscape(m.path)}\` | ${m.note} |`);
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

// ---------------------------------------------------------------- diff / check

function upstreamDiff(committed, current) {
  const sig = (e) => `${key(e.method, e.path)}`;
  const a = new Map(committed.map((e) => [sig(e), e]));
  const b = new Map(current.map((e) => [sig(e), e]));
  const added = current.filter((e) => !a.has(sig(e)));
  const removed = committed.filter((e) => !b.has(sig(e)));
  const moved = current.filter((e) => a.has(sig(e)) && a.get(sig(e)).docUrl !== e.docUrl).map((e) => ({ ...e, previousDocUrl: a.get(sig(e)).docUrl }));
  const retitled = current.filter((e) => a.has(sig(e)) && a.get(sig(e)).title !== e.title).map((e) => ({ ...e, previousTitle: a.get(sig(e)).title }));
  return { added, removed, moved, retitled, changed: added.length + removed.length + moved.length > 0 };
}

function renderDiff(diff, checkedAt) {
  const lines = [`Metronome API endpoint set changed upstream (checked ${checkedAt} against ${LLMS_FULL}).`, ''];
  const section = (title, rows, fmt) => {
    if (!rows.length) return;
    lines.push(`### ${title} (${rows.length})`, '', ...rows.map(fmt), '');
  };
  section('Added', diff.added, (e) => `- \`${e.method} ${e.path}\` [${e.title}](${e.docUrl})`);
  section('Removed', diff.removed, (e) => `- \`${e.method} ${e.path}\` (was [${e.title}](${e.docUrl}))`);
  section('Doc page moved', diff.moved, (e) => `- \`${e.method} ${e.path}\`: ${e.previousDocUrl} -> ${e.docUrl}`);
  section('Retitled (informational)', diff.retitled, (e) => `- \`${e.method} ${e.path}\`: "${e.previousTitle}" -> "${e.title}"`);
  lines.push('Next: run `npm run docs:api:coverage`, review new endpoints on docs.metronome.com, add catalog entries for reads, then `npm run docs:site:refresh` and commit.');
  return `${lines.join('\n')}\n`;
}

// ---------------------------------------------------------------- main

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}

function readCommitted() {
  if (!fs.existsSync(JSON_PATH)) return null;
  return JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
}

function upstreamFromCommitted(committed) {
  return committed.endpoints.map((e) => ({ method: e.method, path: e.path, title: e.title, family: e.family, docUrl: e.docUrl, docMarkdown: e.docMarkdown }));
}

async function loadUpstream() {
  const fullFile = arg('--llms-full');
  const llmsFile = arg('--llms');
  const full = fullFile ? fs.readFileSync(fullFile, 'utf8') : await fetchText(LLMS_FULL);
  const llmsText = llmsFile ? fs.readFileSync(llmsFile, 'utf8') : fullFile ? null : await fetchText(LLMS_TXT);
  const upstream = parseLlmsFull(full);
  if (!upstream.length) throw new Error('no endpoints parsed from llms-full.txt; the page format may have changed');
  return { upstream, llms: llmsText ? parseLlmsTxt(llmsText) : null };
}

async function main() {
  const check = process.argv.includes('--check');
  const offline = process.argv.includes('--offline');
  const verify = process.argv.includes('--verify');
  const committed = readCommitted();
  const today = new Date().toISOString().slice(0, 10);

  if (check) {
    if (!committed) throw new Error(`missing ${path.relative(ROOT, JSON_PATH)}; run npm run docs:api:coverage first`);
    const { upstream } = await loadUpstream();
    const diff = upstreamDiff(upstreamFromCommitted(committed), upstream);
    const report = arg('--report');
    if (diff.changed) {
      const md = renderDiff(diff, today);
      if (report) fs.writeFileSync(report, md);
      process.stdout.write(md);
      console.error(`docs:api:coverage --check: upstream changed (+${diff.added.length} -${diff.removed.length} moved ${diff.moved.length})`);
      process.exit(1);
    }
    if (report && fs.existsSync(report)) fs.rmSync(report);
    console.log(`docs:api:coverage --check OK: ${upstream.length} endpoints, same set as committed (${committed.checkedAt})${diff.retitled.length ? `; ${diff.retitled.length} retitled` : ''}`);
    return;
  }

  let upstream;
  let llms;
  let checkedAt;
  if (offline) {
    if (!committed) throw new Error('--offline needs a committed API_COVERAGE.json');
    upstream = upstreamFromCommitted(committed);
    llms = { legacyPlansEndpointPages: committed.upstream.legacyPlansEndpointPagesExcluded };
    checkedAt = committed.checkedAt;
  } else {
    ({ upstream, llms } = await loadUpstream());
    checkedAt = today;
  }
  const cov = buildCoverage({ upstream, catalog: loadCatalog(), opUses: scanOps(), checkedAt, llms });
  const json = `${JSON.stringify(cov, null, 2)}\n`;
  const md = renderMarkdown(cov);
  if (verify) {
    const stale = [];
    if (!fs.existsSync(JSON_PATH) || fs.readFileSync(JSON_PATH, 'utf8') !== json) stale.push(path.relative(ROOT, JSON_PATH));
    if (!fs.existsSync(MD_PATH) || fs.readFileSync(MD_PATH, 'utf8') !== md) stale.push(path.relative(ROOT, MD_PATH));
    if (stale.length) {
      console.error(`Stale API coverage (run npm run docs:api:coverage -- --offline):\n${stale.map((f) => `- ${f}`).join('\n')}`);
      process.exit(1);
    }
    console.log('API coverage files are current.');
    return;
  }
  fs.writeFileSync(JSON_PATH, json);
  fs.writeFileSync(MD_PATH, md);
  const s = cov.summary;
  console.log(`docs:api:coverage: ${s.total} documented, ${s.covered} covered (op ${s.byStatus.op}, catalog-read ${s.byStatus['catalog-read']}, catalog-write ${s.byStatus['catalog-write']}), not-yet ${s.byStatus['not-yet']}, metro-only ${s.metroOnly}`);
}

module.exports = { parseLlmsFull, parseLlmsTxt, scanOps, buildCoverage, renderMarkdown, upstreamDiff, renderDiff, key, normPath };

if (require.main === module) {
  main().catch((err) => {
    console.error(`docs:api:coverage FAILED: ${err.message || err}`);
    process.exit(2);
  });
}
