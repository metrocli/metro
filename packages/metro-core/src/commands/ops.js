'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { resolvePackId } = require('../workspace/loader');
const { loadWhoOps } = require('../ops-live/load');
const { readSnapshot, defaultMetroConfigDir } = require('../tenant-snapshot');
const { classifyAccount } = require('../account-classifier');
const { detectPromoteOpportunity } = require('../promote-codebase');

const COOKBOOK_CORE = [
  {
    id: 'install',
    say: 'Install metro / CLI not found / ENOTDIR after install',
    command: 'git clone --depth 1 https://github.com/metrocli/metro.git ~/.metro/src 2>/dev/null || true; bash ~/.metro/src/scripts/install-global.sh',
    notes: 'Run from ~ (not inside ~/.metro/src). Then metro --help. Diagnose: metro doctor. Update: bash ~/.metro/src/scripts/install-global.sh only.',
  },
  {
    id: 'who',
    say: 'Who is <customer>? / what are they on right now?',
    command: 'metro ops who <name|uuid|email|url> --prod',
    notes: 'ONE shot: resolve + active contract + credits. Accepts anything pastes. Then ask what to change.',
  },
  {
    id: 'balances',
    say: 'What credits/balances does <customer> have?',
    command: 'metro customer balances --query="<paste>" --prod',
    notes: 'Also included in ops who. Use for ledger IDs before credit edits.',
  },
  {
    id: 'package-list',
    say: 'What packages exist in this tenant?',
    command: 'metro package list --prod',
    notes: 'Full inventory (paginated past the API page size). Filter with --alias / --search.',
  },
  {
    id: 'catalog-bind',
    say: 'Bind my rate cards / products into profiles',
    command: 'metro catalog bind --sandbox --write',
    notes: 'Discovers catalog IDs and writes workspaceCatalog. Required before dimensional rollout plans.',
  },
];

const COOKBOOK_GENERIC = [
  {
    id: 'tenant-snapshot',
    say: 'Learn / refresh this Metronome account model locally',
    command: 'metro catalog bind --sandbox --write && metro tenant snapshot show --markdown',
    notes: 'Writes ~/.metro/snapshots/sandbox.json + profiles workspaceCatalog. Agents: load snapshot MD before freestyle API.',
  },
  {
    id: 'credits-product-decision',
    say: 'Add a credits product / new billable metric / SUM vs COUNT',
    command: 'metro docs explain credits.product.decision --markdown',
    notes: 'Interview fork before products.create. Route: metro route --goal "add a credits product" --sandbox --json',
  },
  {
    id: 'greenfield-credits-product',
    say: 'Greenfield: create BM + USAGE product (preview templates)',
    command: 'metro plan greenfield-credits-product --name="Usage Credits" --aggregation=COUNT --sandbox --json',
    notes: 'Emits api validate/preview files only. Sandbox apply needs greenfield confirm token.',
  },
  {
    id: 'snapshot-diff',
    say: 'What changed since last catalog bind?',
    command: 'metro tenant snapshot diff --sandbox --markdown',
    notes: 'Compares sandbox.prev.json → sandbox.json. Use --against=production for cross-tenant drift.',
  },
  {
    id: 'add-dimension',
    say: 'Add pricing dimension / action code <KEY> at <price>',
    command: 'metro plan add-pricing-dimension-value --dimension-key=<KEY> --price=<n> --sandbox --json',
    notes: 'Then: validate --shape dimensional-rate-card → rate-card dimensional preview → apply-gate (sandbox).',
  },
  {
    id: 'rollout-dimension',
    say: 'Roll a dimension across my rate cards',
    command: 'metro plan rollout-dimension-across-cards --dimension-key=<KEY> --sandbox --json',
    notes: 'Needs workspaceCatalog.rateCardIds from metro catalog bind.',
  },
  {
    id: 'onboard',
    say: 'Onboard a customer from a package',
    command: 'metro plan template onboard-customer --sandbox --out customer.json --json',
    notes: 'Validate + preview the customer-setup shape before any apply.',
  },
  {
    id: 'annual-package',
    say: 'Create an annual subscription package',
    command: 'metro plan template annual-subscription-package --sandbox --out annual.json --json',
    notes: 'Local validate/preview first; prod apply uses the evidence ladder.',
  },
  {
    id: 'credits',
    say: 'Grant complimentary credits',
    command: 'metro plan complimentary-credits --sandbox --json',
    notes: 'Preview-first credit grant on an existing contract.',
  },
  {
    id: 'billing-provider',
    say: 'Set up billing provider for a customer',
    command: 'metro plan billing-provider-setup --sandbox --json',
    notes: 'Shape preview for billing provider configuration.',
  },
  {
    id: 'package-plan-move',
    say: 'Move a customer between plans (preview)',
    command: 'metro plan package-plan-move --sandbox --json',
    notes: 'Generic pack: validate/preview only. Live move-plan apply requires a workspace pack with live ops.',
  },
];

const COOKBOOK_LEV = [
  {
    id: 'move-plan',
    say: 'Put <customer> on <plan> / move to free / legacy / PAYG (incl. active trials)',
    command: 'metro contract move-plan preflight --query="<paste>" --to=<package-alias> --cutover-mode=current-hour --prod',
    notes: 'Works on open-ended paid AND active trials (free trials, etc.). Optional --target-credits=<n> tops up on apply. Printed Apply includes prod confirm.',
  },
  {
    id: 'move-plan-with-credits',
    say: 'Put <customer> on PAYG/plan with N free credits',
    command: 'metro contract move-plan preflight --query="<paste>" --to=<package-alias> --cutover-mode=current-hour --target-credits=<n> --prod',
    notes: 'One preflight + one apply: truncates trial if needed, creates successor, tops up credits to <n>.',
  },
  {
    id: 'enterprise-rebadge',
    say: 'Rebadge <customer> onto Enterprise now without charging / keep credits / schedule next annual',
    command: 'metro contract move-plan preflight --customer-id=<id> --to=<package-alias> --cutover-mode=current-hour --prod',
    notes: 'Billing-empty package: no plan fee on create. Prove balances after apply; if ROLLOVER-002, restore remaining via ledger-adjustment.',
  },
  {
    id: 'top-up',
    say: 'Add/remove credits for <customer> (top-up, comp, correction)',
    command: 'metro ledger-adjustment preflight --amount=<signed-int> --reason="<business reason>" --query="<paste>" --prod',
    notes: 'Signed amount: positive grants, negative claws back. Printed Apply includes prod confirm.',
  },
  {
    id: 'extend-trial',
    say: 'Extend <customer> trial by N days / until date',
    command: 'metro contract extend-trial preflight --extend-by-days=<N> --query="<paste>" --prod',
    notes: 'Or --extend-to=<ISO>. Printed Apply includes prod confirm.',
  },
  {
    id: 'expire',
    say: 'Expire <customer> now / end trial or plan immediately',
    command: 'metro contract expire preflight --query="<paste>" --cutover-mode=current-hour --prod',
    notes: 'Prefer --customer-id= from metro ops who. Printed Apply includes prod confirm.',
  },
  {
    id: 'package-customers',
    say: 'Which customers are on <package>?',
    command: 'metro package customers --alias=<package-alias> --prod',
    notes: 'Package aliases: metro package list --prod.',
  },
  {
    id: 'repair-accidental',
    say: 'Undo/fix an accidental contract',
    command: 'metro contract repair-accidental preflight --archive-contract-id=<id> --keep-contract-id=<id> --reason="<why>" --query="<paste>" --prod',
    notes: 'Requires both contract IDs (from ops who). Printed Apply includes prod confirm.',
  },
  {
    id: 'dimensional-rate',
    say: 'Add action code <CODE> at <N> credits on all dimensional rate cards (sandbox + prod)',
    command: 'metro dimensional new-code --all --code=<CODE> --credits=<N> --now',
    notes: 'Live ops pack only. Append --apply --confirm-prod-apply=I_UNDERSTAND_BILLING_SIDE_EFFECTS for live write.',
  },
  {
    id: 'provider-cutover',
    say: 'Fix/attach Stripe billing provider for <customer>',
    command: 'metro billing-provider cutover preflight --collection-method=send_invoice|charge_automatically --reason="<why>" --query="<paste>" --prod',
    notes: 'Printed Apply includes prod confirm.',
  },
];

/** @deprecated Prefer cookbookForPack - retained for tests that import COOKBOOK. */
const COOKBOOK = [...COOKBOOK_CORE, ...COOKBOOK_LEV];

const LOG_HEADER = [
  '# Ops log - sales one-offs and recurring asks',
  '',
  'Logged per AGENTS.md Proof of Accuracy Rule #4.',
  'Run `metro ops top` to rank automation targets: 3+ occurrences of the same ask shape means it gets a one-liner or a workflow.',
  '',
  '| date | ask | source | minutes |',
  '|---|---|---|---|',
  '',
].join('\n');

function cookbookForPack(packId = resolvePackId()) {
  if (packId === 'lev') return [...COOKBOOK_CORE, ...COOKBOOK_LEV];
  if (packId === 'generic') return [...COOKBOOK_CORE, ...COOKBOOK_GENERIC];
  return [...COOKBOOK_CORE];
}

/** Prefer pattern-relevant one-liners first; keep the rest after. */
const PATTERN_COOKBOOK_ORDER = {
  'dimensional-shared-usage': ['who', 'add-dimension', 'rollout-dimension', 'tenant-snapshot', 'snapshot-diff', 'balances'],
  'package-template': ['catalog-bind', 'annual-package', 'onboard', 'credits-product-decision', 'tenant-snapshot', 'snapshot-diff'],
  'commit-grant-heavy': ['credits', 'credits-product-decision', 'balances', 'who', 'tenant-snapshot'],
  'package-and-credits': ['credits-product-decision', 'credits', 'annual-package', 'catalog-bind', 'tenant-snapshot'],
  'greenfield-needed': ['greenfield-credits-product', 'credits-product-decision', 'catalog-bind', 'tenant-snapshot', 'snapshot-diff'],
  unknown: ['catalog-bind', 'tenant-snapshot', 'credits-product-decision', 'who'],
};

function cookbookForPackAndPattern(packId, pattern) {
  const base = cookbookForPack(packId);
  if (!pattern) return base;
  const prefer = PATTERN_COOKBOOK_ORDER[pattern] || PATTERN_COOKBOOK_ORDER.unknown;
  const preferSet = new Set(prefer);
  const ranked = [];
  for (const id of prefer) {
    const hit = base.find((entry) => entry.id === id);
    if (hit) ranked.push(hit);
  }
  for (const entry of base) {
    if (!preferSet.has(entry.id)) ranked.push(entry);
  }
  return ranked;
}

function resolveOpsAccountPattern(flags) {
  const tenant = flags.prod || flags.production ? 'production' : 'sandbox';
  const configDir = flags.dir && flags.dir !== true
    ? path.resolve(String(flags.dir))
    : defaultMetroConfigDir();
  const snap = readSnapshot(tenant, { configDir });
  if (!snap) return { pattern: null, tenant };
  const classification = snap.classification || classifyAccount(snap);
  return { pattern: classification.pattern || null, tenant, confidence: classification.confidence };
}

function defaultLogPath(flags) {
  if (flags.file && flags.file !== true) return String(flags.file);
  if (process.env.METRO_OPS_LOG) return process.env.METRO_OPS_LOG;
  const homeDefault = path.join(os.homedir(), '.metro', 'ops-log.md');
  const repoDefault = path.join('docs', 'ops-log.md');
  if (fs.existsSync(repoDefault)) return repoDefault;
  return homeDefault;
}

function normalizeAsk(ask) {
  return String(ask)
    .toLowerCase()
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<id>')
    .replace(/https?:\/\/\S+/g, '<url>')
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '<email>')
    .replace(/\b\d[\d,.]*\b/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseLogRows(content) {
  const rows = [];
  for (const line of String(content).split('\n')) {
    const match = line.match(/^\|\s*(\d{4}-\d{2}-\d{2})\s*\|(.*)\|\s*([^|]*)\|\s*([^|]*)\|\s*$/);
    if (!match) continue;
    if (match[2].trim() === 'ask') continue;
    rows.push({
      date: match[1],
      ask: match[2].trim(),
      source: match[3].trim(),
      minutes: match[4].trim(),
    });
  }
  return rows;
}

function runOpsList(flags, streams) {
  const packId = resolvePackId();
  const account = resolveOpsAccountPattern(flags);
  const oneLiners = cookbookForPackAndPattern(packId, account.pattern);
  const promoteCodebase = detectPromoteOpportunity({
    hasSnapshot: Boolean(account.pattern),
    accountPattern: account.pattern,
  });
  const payload = {
    schemaVersion: 'metro.ops.list.v1',
    workspacePack: packId,
    accountPattern: account.pattern,
    accountTenant: account.tenant,
    promoteCodebase,
    oneLiners: oneLiners.map((entry) => ({ ...entry })),
  };
  if (flags.json) {
    streams.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return 0;
  }
  const patternLabel = account.pattern
    ? ` · accountPattern=${account.pattern}`
    : ' · no snapshot (run metro catalog bind --write)';
  streams.stdout.write(`Ops one-liners (${packId} pack${patternLabel})\n\n`);
  for (const entry of oneLiners) {
    streams.stdout.write(`  "${entry.say}"\n`);
    streams.stdout.write(`    ${entry.command}\n`);
    streams.stdout.write(`    ${entry.notes}\n\n`);
  }
  if (promoteCodebase?.signal) {
    streams.stdout.write(`This can be faster. ${promoteCodebase.suggestedPrTitle}\n`);
    streams.stdout.write(`  Faster path: ${promoteCodebase.fasterPath}\n`);
    streams.stdout.write('  Draft a PR so every agent gets the shortcut. See agents.md#promote-the-codebase\n\n');
  }
  streams.stdout.write('Log every ask:   metro ops log --ask="<what was asked>" [--source=slack] [--minutes=5]\n');
  streams.stdout.write('Rank the queue:  metro ops top\n');
  streams.stdout.write(`Switch pack:     metro workspace use ${packId === 'generic' ? 'lev' : 'generic'} --write\n`);
  return 0;
}

function runOpsLog(flags, streams) {
  if (!flags.ask || flags.ask === true) {
    streams.stderr.write('Usage: metro ops log --ask="<what was asked>" [--source=slack|linear|verbal] [--minutes=<n>] [--file=<path>]\n');
    return 1;
  }
  const logPath = defaultLogPath(flags);
  const date = new Date().toISOString().slice(0, 10);
  const source = flags.source && flags.source !== true ? String(flags.source) : 'unspecified';
  const minutes = flags.minutes && flags.minutes !== true ? String(flags.minutes) : '';
  const ask = String(flags.ask).replace(/\|/g, '/').replace(/\s+/g, ' ').trim();

  fs.mkdirSync(path.dirname(path.resolve(logPath)), { recursive: true });
  if (!fs.existsSync(logPath)) {
    fs.writeFileSync(logPath, LOG_HEADER);
  }
  fs.appendFileSync(logPath, `| ${date} | ${ask} | ${source} | ${minutes} |\n`);

  const rows = parseLogRows(fs.readFileSync(logPath, 'utf8'));
  const shape = normalizeAsk(ask);
  const count = rows.filter((row) => normalizeAsk(row.ask) === shape).length;

  const payload = {
    schemaVersion: 'metro.ops.log.v1',
    logged: { date, ask, source, minutes: minutes || null, file: logPath },
    shapeCount: count,
    automateSignal: count >= 3,
  };
  if (flags.json) {
    streams.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else {
    streams.stdout.write(`Logged to ${logPath} (${count}× this ask shape).\n`);
    if (count >= 3) {
      streams.stdout.write('AUTOMATE: this ask shape has now appeared 3+ times. Give it a one-liner or a workflow - see metro ops.\n');
    }
  }
  return 0;
}

function runOpsTop(flags, streams) {
  const logPath = defaultLogPath(flags);
  if (!fs.existsSync(logPath)) {
    streams.stderr.write(`No ops log at ${logPath}. Start one with: metro ops log --ask="..."\n`);
    return 1;
  }
  const rows = parseLogRows(fs.readFileSync(logPath, 'utf8'));
  const shapes = new Map();
  for (const row of rows) {
    const shape = normalizeAsk(row.ask);
    if (!shapes.has(shape)) {
      shapes.set(shape, { shape, count: 0, example: row.ask, lastDate: row.date, minutes: 0 });
    }
    const entry = shapes.get(shape);
    entry.count += 1;
    entry.lastDate = row.date;
    entry.minutes += Number(row.minutes) || 0;
  }
  const ranked = [...shapes.values()].sort((a, b) => b.count - a.count || b.minutes - a.minutes);

  const payload = {
    schemaVersion: 'metro.ops.top.v1',
    file: logPath,
    totalRows: rows.length,
    shapes: ranked.map((entry) => ({ ...entry, automate: entry.count >= 3 })),
  };
  if (flags.json) {
    streams.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return 0;
  }
  streams.stdout.write(`Ops log: ${rows.length} asks, ${ranked.length} distinct shapes (${logPath})\n\n`);
  for (const entry of ranked) {
    const flag = entry.count >= 3 ? '  ← AUTOMATE' : '';
    const minutes = entry.minutes ? `, ~${entry.minutes} min total` : '';
    streams.stdout.write(`  ${String(entry.count).padStart(3)}× ${entry.example} (last ${entry.lastDate}${minutes})${flag}\n`);
  }
  return 0;
}

function runOpsWho(positional, flags, streams, argv = []) {
  const who = loadWhoOps();
  if (!who) {
    streams.stderr.write('metro ops who requires a workspace pack with live ops (not stub).\n');
    streams.stderr.write('Try: metro workspace use generic --write\n');
    return 2;
  }
  const query = flags.query && flags.query !== true
    ? String(flags.query)
    : positional.slice(2).join(' ').trim() || null;
  if (!query && !flags['customer-id'] && !flags['lev-id'] && !flags['external-id'] && !flags['ingest-alias'] && !flags.name) {
    streams.stderr.write('Usage: metro ops who <name|uuid|email|external-id|url> (--sandbox|--prod) [--json]\n');
    return 1;
  }
  const flagObj = {
    ...flags,
    argv,
    'lev-id': flags['lev-id'] || flags['external-id'] || null,
  };
  return who.runWho(flagObj, streams, query).then((r) => r.exitCode);
}

function runOpsCommand(positional, flags, streams, argv = []) {
  const action = positional[1];
  if (!action || action === 'list') {
    return runOpsList(flags, streams);
  }
  if (action === 'log') {
    return runOpsLog(flags, streams);
  }
  if (action === 'top') {
    return runOpsTop(flags, streams);
  }
  if (action === 'who') {
    return runOpsWho(positional, flags, streams, argv);
  }
  streams.stderr.write('Unknown ops command. Try: metro ops | metro ops who <query> --prod | metro ops log --ask="..." | metro ops top\n');
  return 1;
}

module.exports = {
  runOpsCommand,
  normalizeAsk,
  parseLogRows,
  cookbookForPack,
  COOKBOOK,
  COOKBOOK_CORE,
  COOKBOOK_GENERIC,
  COOKBOOK_LEV,
};
