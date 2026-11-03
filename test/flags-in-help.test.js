'use strict';

// Every flag the code reads must appear in the help line of the command that
// reads it. Help lines are the `command` strings in commands/catalog.js: they
// are what `metro --help` prints and what `metro docs command-reference
// --markdown` renders, so one check covers both.
//
// How it works (static, no live calls):
//   1. Split each source file under SCAN_ROOTS into top-level blocks
//      (functions and const statements at column 0).
//   2. Collect the flags each block reads directly (readString(f, 'x'),
//      flags.x, flags['x'], argv.includes('--x'), parseArg('--x=', ...),
//      arg === '--x'), and the blocks it calls (same file, or resolved
//      through require()).
//   3. Entries:
//        - every generic-pack op built with defineOp({ command }) maps to its
//          `<command> preflight` and `<command> apply` help lines, plus the
//          flags the shared runtime reads for every preflight/apply;
//        - every other command handler is listed in ENTRIES with the help
//          lines (by prefix) that document it.
//      Each entry's transitive flag set must appear in its help lines.
//   4. Every block that reads a flag must be reachable from some entry, so a
//      new command module cannot dodge the check by not being listed.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { REPO_ROOT } = require('./helpers');
const { COMMANDS } = require('../packages/metro-core/src/commands/catalog');
const { GLOBAL_FLAGS, EXIT_CODES } = require('../packages/metro-core/src/commands/help-footer');

const SCAN_ROOTS = ['packages/metro-core/src', 'packages/metro-workspace-generic/src'];

// Internal keys on the flags object that are not CLI flags.
const NOT_FLAGS = new Set(['argv', 'length']);

// Flags the shared op runtime (metro-workspace-generic/src/ops/lib/runtime.js)
// reads for every defineOp preflight / apply.
const RUNTIME_PREFLIGHT_FLAGS = ['sandbox', 'prod', 'out', 'json'];
const RUNTIME_APPLY_FLAGS = ['sandbox', 'prod', 'file', 'confirm-hash', 'apply', 'confirm-live-apply', 'confirm-prod-apply', 'json'];

const startsWith = (...prefixes) => (line) => prefixes.some((p) => line === p || line.startsWith(`${p} `));
const contains = (...parts) => (line) => parts.some((p) => line.includes(p));

// Non-defineOp command handlers -> the help lines that document them.
const ENTRIES = [
  // metro-core/src/cli.js
  // The dispatcher itself: only its own reads (global flags, and the
  // `metro catalog --show` route); each handler below is checked on its own.
  { file: 'packages/metro-core/src/cli.js', fn: 'run', direct: true, help: startsWith('metro catalog bind') },
  { file: 'packages/metro-core/src/cli.js', fn: 'runShapeCommand', help: startsWith('metro shape') },
  { file: 'packages/metro-core/src/cli.js', fn: 'runValidateCommand', help: startsWith('metro validate') },
  { file: 'packages/metro-core/src/cli.js', fn: 'runInputCommand', help: startsWith('metro input') },
  { file: 'packages/metro-core/src/cli.js', fn: 'runPreviewCommand', help: contains(' preview ') },
  { file: 'packages/metro-core/src/cli.js', fn: 'runDocsCommand', help: startsWith('metro docs') },
  { file: 'packages/metro-core/src/cli.js', fn: 'runSchemaCommand', help: startsWith('metro schema') },
  { file: 'packages/metro-core/src/cli.js', fn: 'runSetupCommand', help: startsWith('metro setup') },
  { file: 'packages/metro-core/src/cli.js', fn: 'runWorkspaceCommand', help: startsWith('metro workspace') },
  { file: 'packages/metro-core/src/cli.js', fn: 'runModeCommand', help: startsWith('metro mode') },
  { file: 'packages/metro-core/src/cli.js', fn: 'runStatusCommand', help: startsWith('metro status') },
  { file: 'packages/metro-core/src/cli.js', fn: 'runInstallDoctorCommand', help: startsWith('metro doctor') },
  { file: 'packages/metro-core/src/cli.js', fn: 'runHarnessCommand', help: startsWith('metro harness') },
  { file: 'packages/metro-core/src/cli.js', fn: 'runPlanCommand', help: startsWith('metro plan') },
  { file: 'packages/metro-core/src/cli.js', fn: 'runRouteCommand', help: startsWith('metro route') },
  { file: 'packages/metro-core/src/cli.js', fn: 'runSourceBoundaryCommand', help: startsWith('metro source-boundary') },
  { file: 'packages/metro-core/src/cli.js', fn: 'runReleaseCommand', help: startsWith('metro release') },
  { file: 'packages/metro-core/src/cli.js', fn: 'runApiCommand', help: startsWith('metro api') },
  { file: 'packages/metro-core/src/cli.js', fn: 'runAuditCommand', help: startsWith('metro audit') },
  { file: 'packages/metro-core/src/cli.js', fn: 'runApplyGateCommand', help: startsWith('metro apply-gate') },
  { file: 'packages/metro-core/src/cli.js', fn: 'runApprovalRecordCommand', help: startsWith('metro approval-record') },
  { file: 'packages/metro-core/src/cli.js', fn: 'runApplyReadbackCommand', help: startsWith('metro apply-readback') },
  { file: 'packages/metro-core/src/cli.js', fn: 'runInspectPlanCommand', help: (line) => / inspect /.test(line) && line.includes('--plan') },
  { file: 'packages/metro-core/src/cli.js', fn: 'runPreflightCommand', help: startsWith('metro preflight') },
  { file: 'packages/metro-core/src/cli.js', fn: 'runProofCommand', help: startsWith('metro proof') },
  { file: 'packages/metro-core/src/cli.js', fn: 'runVerifyCommand', help: startsWith('metro verify') },
  // metro-core/src/init (bin/metro.js routes `metro init` here)
  { file: 'packages/metro-core/src/init/index.js', fn: 'runInit', help: startsWith('metro init') },
  // metro-core/src/commands
  { file: 'packages/metro-core/src/commands/ops.js', fn: 'runOpsCommand', help: startsWith('metro ops') },
  { file: 'packages/metro-core/src/commands/catalog-bind.js', fn: 'runCatalogBindCommand', help: startsWith('metro catalog bind') },
  { file: 'packages/metro-core/src/commands/tenant-snapshot.js', fn: 'runTenantSnapshotCommand', help: startsWith('metro tenant snapshot') },
  { file: 'packages/metro-core/src/commands/provision.js', fn: 'runProvisionCommand', help: () => false },
  { file: 'packages/metro-core/src/commands/contract-move-plan.js', fn: 'runContractMovePlanCommand', help: startsWith('metro contract move-plan', 'metro customer resolve') },
  { file: 'packages/metro-core/src/commands/contract-expire.js', fn: 'runContractExpireCommand', help: () => false },
  { file: 'packages/metro-core/src/commands/contract-extend-trial.js', fn: 'runContractExtendTrialCommand', help: () => false },
  { file: 'packages/metro-core/src/commands/contract-repair-accidental.js', fn: 'runContractRepairAccidentalCommand', help: () => false },
  { file: 'packages/metro-core/src/commands/ledger-adjustment.js', fn: 'runLedgerAdjustmentCommand', help: () => false },
  { file: 'packages/metro-core/src/commands/billing-provider-cutover.js', fn: 'runBillingProviderCutoverCommand', help: () => false },
  { file: 'packages/metro-core/src/commands/dimensional.js', fn: 'runDimensionalCommand', help: () => false },
  { file: 'packages/metro-core/src/commands/customer-balances.js', fn: 'runCustomerBalancesCommand', help: startsWith('metro customer balances') },
  { file: 'packages/metro-core/src/commands/package-list.js', fn: 'runPackageListCommand', help: startsWith('metro package list') },
  { file: 'packages/metro-core/src/commands/package-customers.js', fn: 'runPackageCustomersCommand', help: startsWith('metro package customers') },
  // metro-core/src/ops-live (core read-only implementations behind those commands)
  { file: 'packages/metro-core/src/ops-live/run-customer-resolve.js', fn: 'runCustomerResolve', help: startsWith('metro customer resolve') },
  { file: 'packages/metro-core/src/ops-live/customer-balances/lib/list.js', fn: 'parseArgs', help: startsWith('metro customer balances') },
  { file: 'packages/metro-core/src/ops-live/package-list/lib/list.js', fn: 'parseArgs', help: startsWith('metro package list') },
  { file: 'packages/metro-core/src/ops-live/who.js', fn: 'runWho', help: startsWith('metro ops who') },
  // metro-workspace-generic ops that are not built with defineOp
  { file: 'packages/metro-workspace-generic/src/ops/contract-move-plan.js', fn: 'runBulkPreflight', help: startsWith('metro contract move-plan bulk-preflight') },
  // bulk-apply hands each plan to the move-plan runApply, so it accepts the runtime apply flags too.
  { file: 'packages/metro-workspace-generic/src/ops/contract-move-plan.js', fn: 'runBulkApply', implies: RUNTIME_APPLY_FLAGS, help: startsWith('metro contract move-plan bulk-apply') },
  { file: 'packages/metro-workspace-generic/src/ops/dimensional.js', fn: 'runDimensionalNewCode', help: () => false },
  { file: 'packages/metro-workspace-generic/src/ops/read-ops.js', fn: 'runCustomerBalances', help: startsWith('metro customer balances') },
  { file: 'packages/metro-workspace-generic/src/ops/read-ops.js', fn: 'runPackageCustomers', help: startsWith('metro package customers') },
];

// ------------------------------------------------------------------ scan

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'test' || entry.name === 'logs') continue;
      walk(full, out);
    } else if (entry.name.endsWith('.js') && !entry.name.endsWith('.test.js')) {
      out.push(full);
    }
  }
}

function stripComments(text) {
  return text
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n');
}

const FLAG_PATTERNS = [
  /\bread(?:Flag|String|Bool|List|Int|Number|JsonFlag)\(\s*[\w.]+\s*,\s*['"]([a-z][a-z0-9-]*)['"]/g,
  /\bflags\.([a-z][a-z0-9]*)\b(?!\s*\()/g,
  /\bflags\[\s*['"]([a-z][a-z0-9-]*)['"]\s*\]/g,
  /\bargv\.includes\(\s*['"]--([a-z][a-z0-9-]*)['"]\s*\)/g,
  /\bparseArg\(\s*['"]--([a-z][a-z0-9-]*)=/g,
  /===\s*['"]--([a-z][a-z0-9-]*)['"]/g,
];

function flagsIn(text) {
  const found = new Set();
  for (const pattern of FLAG_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      if (!NOT_FLAGS.has(match[1])) found.add(match[1]);
    }
  }
  return found;
}

function resolveRequire(fromFile, spec) {
  if (!spec.startsWith('.')) return null;
  const base = path.resolve(path.dirname(fromFile), spec);
  for (const candidate of [base, `${base}.js`, path.join(base, 'index.js')]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function parseFile(file) {
  const text = stripComments(fs.readFileSync(file, 'utf8'));
  const lines = text.split('\n');
  const blocks = [];
  let current = null;
  for (const line of lines) {
    if (/^[A-Za-z]/.test(line)) {
      current = { lines: [line] };
      blocks.push(current);
    } else if (current) {
      current.lines.push(line);
    }
  }
  const byName = new Map();
  const imports = new Map(); // local name -> { file, member|null }
  for (const block of blocks) {
    block.text = block.lines.join('\n');
    block.flags = new Set();
    block.name = null;
    const req = block.text.match(/^const\s+(\{[\s\S]*?\}|[\w$]+)\s*=\s*require\(\s*['"]([^'"]+)['"]\s*\)/);
    if (req) {
      const target = resolveRequire(file, req[2]);
      if (target) {
        if (req[1].startsWith('{')) {
          for (const part of req[1].slice(1, -1).split(',')) {
            const [member, local] = part.split(':').map((s) => s.trim());
            if (member) imports.set(local || member, { file: target, member });
          }
        } else {
          imports.set(req[1], { file: target, member: null });
        }
      }
      continue;
    }
    const named = block.text.match(/^(?:async\s+)?function\s*\*?\s*([\w$]+)/) || block.text.match(/^(?:const|let|var)\s+([\w$]+)\s*=/);
    block.name = named ? named[1] : null;
    block.flags = flagsIn(block.text);
    const op = block.text.match(/\bdefineOp\(\{[\s\S]*?\bcommand:\s*'([^']+)'/);
    block.opCommand = op ? op[1] : null;
    if (block.name) byName.set(block.name, block);
  }
  return { file, blocks, byName, imports };
}

const files = [];
for (const root of SCAN_ROOTS) walk(path.join(REPO_ROOT, root), files);
const parsed = new Map(files.map((file) => [file, parseFile(file)]));

// The op runtime's own flag reads are modelled by RUNTIME_*_FLAGS above.
// assertProductionApplyAuthorized only reads --confirm-prod-apply when called
// with apply: true, which the read-only core commands never do.
const STOP_AT = new Set(['defineOp', 'assertProductionApplyAuthorized']);

function calleesOf(unit, block) {
  const out = [];
  for (const match of block.text.matchAll(/\b([\w$]+)(?:\.([\w$]+))?\s*\(/g)) {
    const [, head, member] = match;
    if (STOP_AT.has(member || head)) continue;
    if (member) {
      const imp = unit.imports.get(head);
      if (imp && !imp.member) {
        const target = parsed.get(imp.file);
        if (target && target.byName.has(member)) out.push([target, target.byName.get(member)]);
      }
      continue;
    }
    if (unit.byName.has(head) && unit.byName.get(head) !== block) {
      out.push([unit, unit.byName.get(head)]);
      continue;
    }
    const imp = unit.imports.get(head);
    if (imp && imp.member) {
      const target = parsed.get(imp.file);
      if (target && target.byName.has(imp.member)) out.push([target, target.byName.get(imp.member)]);
    }
  }
  return out;
}

function closure(unit, block, { direct = false } = {}) {
  const seen = new Set();
  const flags = new Set();
  const stack = [[unit, block]];
  while (stack.length) {
    const [u, b] = stack.pop();
    if (seen.has(b)) continue;
    seen.add(b);
    for (const flag of b.flags) flags.add(flag);
    if (!direct) stack.push(...calleesOf(u, b));
  }
  return { flags, blocks: seen };
}

// ------------------------------------------------------------------ help

const HELP_LINES = COMMANDS.map((c) => c.command);
const GLOBAL = new Set(GLOBAL_FLAGS.map((f) => f.flag.replace(/^--/, '')));

function documented(flag, lines) {
  if (GLOBAL.has(flag)) return true;
  const re = new RegExp(`--${flag.replace(/[-]/g, '\\-')}(?![a-z0-9-])`);
  return lines.some((line) => re.test(line));
}

function rel(file) {
  return path.relative(REPO_ROOT, file);
}

function checkEntry(label, flags, lines, gaps) {
  if (!lines.length && [...flags].some((f) => !GLOBAL.has(f))) {
    gaps.push(`${label}: no help line matched (reads ${[...flags].join(', ')})`);
    return;
  }
  for (const flag of flags) {
    if (!documented(flag, lines)) gaps.push(`${label}: --${flag} is read but not in help line(s): ${lines.join(' || ')}`);
  }
}

test('every flag a command reads is listed in its --help line', () => {
  const gaps = [];
  const reached = new Set();
  let entryCount = 0;

  for (const entry of ENTRIES) {
    const unit = parsed.get(path.join(REPO_ROOT, entry.file));
    assert.ok(unit, `ENTRIES names a missing file: ${entry.file}`);
    const block = unit.byName.get(entry.fn);
    assert.ok(block, `ENTRIES names a missing function: ${entry.file} ${entry.fn}`);
    const { flags, blocks } = closure(unit, block, { direct: Boolean(entry.direct) });
    for (const flag of entry.implies || []) flags.add(flag);
    for (const b of blocks) reached.add(b);
    checkEntry(`${entry.file} ${entry.fn}`, flags, HELP_LINES.filter(entry.help), gaps);
    entryCount += 1;
  }

  for (const unit of parsed.values()) {
    for (const block of unit.blocks) {
      if (!block.opCommand) continue;
      const { flags, blocks } = closure(unit, block);
      for (const b of blocks) reached.add(b);
      const preflight = HELP_LINES.filter(startsWith(`${block.opCommand} preflight`));
      const apply = HELP_LINES.filter(startsWith(`${block.opCommand} apply`));
      checkEntry(`${rel(unit.file)} ${block.opCommand} preflight`, new Set([...flags, ...RUNTIME_PREFLIGHT_FLAGS]), preflight, gaps);
      checkEntry(`${rel(unit.file)} ${block.opCommand} apply`, new Set(RUNTIME_APPLY_FLAGS), apply, gaps);
      entryCount += 2;
    }
  }

  // The shared op runtime is modelled by RUNTIME_*_FLAGS; keep that model honest.
  // (STOP_AT functions are covered by that model too.)
  const modelled = new Set([...RUNTIME_PREFLIGHT_FLAGS, ...RUNTIME_APPLY_FLAGS, ...GLOBAL]);
  for (const unit of parsed.values()) {
    for (const name of STOP_AT) {
      const block = unit.byName.get(name);
      if (!block) continue;
      const stopped = closure(unit, block);
      for (const b of stopped.blocks) reached.add(b);
      const unmodelled = [...stopped.flags].filter((f) => !modelled.has(f));
      assert.deepEqual(unmodelled, [], `${rel(unit.file)} ${name} reads flags missing from RUNTIME_*_FLAGS`);
    }
  }

  const unreached = [];
  for (const unit of parsed.values()) {
    for (const block of unit.blocks) {
      if (block.flags.size && !reached.has(block)) {
        unreached.push(`${rel(unit.file)} ${block.name || '(anonymous)'} reads ${[...block.flags].map((f) => `--${f}`).join(', ')}`);
      }
    }
  }

  assert.ok(entryCount > 60, `expected to check many commands, checked ${entryCount}`);
  assert.deepEqual(unreached, [], `Blocks that read flags but are not reachable from any command entry (add them to ENTRIES):\n${unreached.join('\n')}`);
  assert.deepEqual(gaps, [], `Flags read by code but missing from --help:\n${gaps.join('\n')}`);
});

test('the help footer lists the global flags and exit codes', () => {
  const { run } = require('../packages/metro-core/src/cli');
  let out = '';
  run(['--help'], { stdout: { write: (s) => { out += s; } }, stderr: { write: () => {} } });
  for (const { usage } of GLOBAL_FLAGS) assert.ok(out.includes(`  ${usage} `), `help is missing global flag ${usage}`);
  for (const { code, meaning } of EXIT_CODES) assert.ok(out.includes(`  ${code}  ${meaning}`), `help is missing exit code ${code}`);
  assert.deepEqual(EXIT_CODES.map((e) => e.code), [0, 1, 2, 3]);
});

test('catalog flag lists and exit codes agree with the help lines', () => {
  const { commandReference } = require('../packages/metro-core/src/commands/catalog');
  for (const command of commandReference().commands) {
    const listed = new Set([...(command.requiredFlags || []), ...(command.optionalFlags || [])]
      .flatMap((f) => f.match(/--[a-z][a-z0-9-]*/g) || []));
    for (const flag of command.command.match(/--[a-z][a-z0-9-]*/g) || []) {
      assert.ok(listed.has(flag), `${command.id}: ${flag} is in the help line but not in requiredFlags/optionalFlags`);
    }
    // Pack-op applies read back after writing and exit 3 on a mismatch.
    if (command.status === 'pack-op' && command.mode === 'apply') {
      assert.equal(command.exitCodes.readbackMismatch, 3, `${command.id} must declare exit 3`);
    }
  }
});

test('the markdown command reference carries every help line', () => {
  const { renderReferenceMarkdown } = require('../packages/metro-core/src/docs/reference-markdown');
  const { commandReference } = require('../packages/metro-core/src/commands/catalog');
  const md = renderReferenceMarkdown(commandReference());
  for (const line of HELP_LINES) {
    assert.ok(md.includes(line.replace(/\|/g, '\\|')), `markdown reference is missing: ${line}`);
  }
});
