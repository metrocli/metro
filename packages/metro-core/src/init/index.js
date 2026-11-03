'use strict';

// SPDX-License-Identifier: Apache-2.0
//
// `metro init`: the first-run contract (metrocli.dev docs, init-flow).
//  - Keys never pass through chat or terminal history. metro creates ~/.metro/.env
//    (mode 600) and the human pastes keys into it, or into a hidden TTY prompt.
//  - Sandbox first. Production is optional, asked last, and skippable.
//  - Every step ends with the exact next command.
//  - After init, metro is read-only. Writes need `metro mode write`.
//  - Idempotent: re-running never overwrites a key.
//  - `--agent` or a non-TTY run never prompts.

const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  SANDBOX_TOKEN_URL,
  PROD_TOKEN_URL,
  SANDBOX_VAR,
  PROD_VAR,
  metroDir,
  envFilePath,
  displayPath,
  fileMode,
  ensureEnvFile,
  readEnvValues,
  setKeyIfEmpty,
} = require('./env-file');
const { validateKey, tenantSummary, VALIDATION_ENDPOINT } = require('./validate-key');
const { createStyle } = require('./style');
const { loadLocalEnv } = require('../clients/load-local-env');
const { loadOperatorMode, setOperatorMode } = require('../setup/mode');

const CHECK_SCHEMA = 'metro.init.check.v1';
const AGENTS_SOURCE = path.resolve(__dirname, '..', '..', '..', '..', 'AGENTS.md');

const COPY = {
  sameKey: 'Your sandbox and production keys are the same. Sandbox and production need separate tokens.',
  network: "Couldn't reach api.metronome.com. Check your connection or proxy, then run metro init --check.",
  rejected: (label, url, file) => `Metronome rejected the ${label} key. It may be revoked or copied with a missing character. Create a new one at ${url} and replace the line in ${file}.`,
  httpError: (label, status) => `Metronome answered HTTP ${status} to the ${label} key check. Try again in a minute: metro init --check`,
};

function parseInitArgs(argv = []) {
  const flags = { agent: false, prod: false, check: false, json: false, plain: false, help: false };
  const unknown = [];
  for (const arg of argv) {
    if (arg === '--agent') flags.agent = true;
    else if (arg === '--prod' || arg === '--production') flags.prod = true;
    else if (arg === '--check') flags.check = true;
    else if (arg === '--json') flags.json = true;
    else if (arg === '--plain') flags.plain = true;
    else if (arg === '--help' || arg === '-h' || arg === 'help') flags.help = true;
    else unknown.push(arg);
  }
  return { flags, unknown };
}

function helpText() {
  return [
    'Usage: metro init [--agent] [--prod] [--plain]',
    '       metro init --check [--json]',
    '',
    'Creates ~/.metro/.env (private, mode 600), adds your sandbox key, checks it with',
    'one read-only Metronome call, and leaves metro in read-only mode.',
    '',
    '  --agent   No prompts. Prints the steps to hand to a human. Used automatically without a TTY.',
    '  --prod    Add only the production key.',
    '  --check   Report each key: missing, rejected, or working. Exits 1 while the sandbox key is not working.',
    '  --json    With --check, print machine-readable status.',
    '  --plain   No colour, ASCII glyphs.',
  ].join('\n');
}

function copyAgentsManual(homeDir, source = AGENTS_SOURCE) {
  if (!source || !fs.existsSync(source)) return { copied: false };
  const target = path.join(metroDir(homeDir), 'AGENTS.md');
  const body = fs.readFileSync(source, 'utf8');
  const header = '<!-- Managed by metro init. Re-running metro init replaces this file. -->\n';
  fs.writeFileSync(target, header + body, { mode: 0o644 });
  return { copied: true, path: target };
}

function ensureReadOnlyMode(homeDir) {
  const dir = metroDir(homeDir);
  const state = loadOperatorMode({ dir });
  if (state.source === 'file' || state.exists) return { changed: false, mode: state.mode };
  setOperatorMode('read-only', { dir });
  return { changed: true, mode: 'read-only' };
}

function effectiveKeys({ homeDir, env, cwd }) {
  const copy = { ...env };
  const load = loadLocalEnv({ cwd, env: copy, homeDir });
  const fromFile = load.loaded ? displayPath(load.path, homeDir) : null;
  const pick = (name) => {
    const value = copy[name] && String(copy[name]).trim() ? String(copy[name]).trim() : '';
    if (!value) return { value: '', source: null };
    const fromEnv = Boolean(env[name] && String(env[name]).trim());
    return { value, source: fromEnv ? 'environment' : fromFile };
  };
  return { sandbox: pick(SANDBOX_VAR), production: pick(PROD_VAR) };
}

async function checkOne(label, key, { fetchImpl, file }) {
  const url = label === 'sandbox' ? SANDBOX_TOKEN_URL : PROD_TOKEN_URL;
  const result = await validateKey(key, { fetchImpl });
  if (result.status === 'working') {
    return { status: 'working', httpStatus: result.httpStatus, customers: result.customers, rateCards: result.rateCards, summary: tenantSummary(result) };
  }
  if (result.status === 'rejected') {
    return { status: 'rejected', httpStatus: result.httpStatus, message: COPY.rejected(label, url, file) };
  }
  if (result.status === 'unreachable') return { status: 'unreachable', message: COPY.network };
  return { status: 'error', httpStatus: result.httpStatus, message: COPY.httpError(label, result.httpStatus) };
}

// ---------------------------------------------------------------------------
// --check

async function runCheck(flags, deps) {
  const { stdout, homeDir, env, cwd, fetchImpl } = deps;
  const style = createStyle({ stream: stdout, env, plain: flags.plain || flags.json });
  const filePath = envFilePath(homeDir);
  const fileShown = displayPath(filePath, homeDir);
  const exists = fs.existsSync(filePath);
  const mode = exists ? fileMode(filePath).toString(8) : null;
  const keys = effectiveKeys({ homeDir, env, cwd });

  const sandbox = { variable: SANDBOX_VAR, source: keys.sandbox.source };
  const production = { variable: PROD_VAR, source: keys.production.source, optional: true };

  if (!keys.sandbox.value) {
    Object.assign(sandbox, { status: 'missing' });
  } else {
    Object.assign(sandbox, await checkOne('sandbox', keys.sandbox.value, { fetchImpl, file: fileShown }));
  }

  if (!keys.production.value) {
    Object.assign(production, { status: 'missing' });
  } else if (keys.sandbox.value && keys.production.value === keys.sandbox.value) {
    Object.assign(production, { status: 'same-as-sandbox', message: COPY.sameKey });
  } else {
    Object.assign(production, await checkOne('production', keys.production.value, { fetchImpl, file: fileShown }));
  }

  let next;
  if (!exists && !keys.sandbox.value) next = 'metro init';
  else if (sandbox.status === 'missing') next = `Paste your sandbox key into ${fileShown} after ${SANDBOX_VAR}=, then run: metro init --check`;
  else if (sandbox.status !== 'working') next = sandbox.message;
  else if (production.status === 'same-as-sandbox') next = `${COPY.sameKey} Create a sandbox token at ${SANDBOX_TOKEN_URL}, put it on the ${SANDBOX_VAR}= line, then run: metro init --check`;
  else if (production.status === 'rejected' || production.status === 'error' || production.status === 'unreachable') next = production.message;
  else next = 'metro status';

  const ok = sandbox.status === 'working' && production.status !== 'same-as-sandbox';
  const payload = {
    schemaVersion: CHECK_SCHEMA,
    ok,
    envFile: { path: fileShown, exists, mode },
    keys: { sandbox, production },
    validation: { method: VALIDATION_ENDPOINT.method, path: VALIDATION_ENDPOINT.path, docs: VALIDATION_ENDPOINT.docs, readOnly: true },
    next,
  };

  if (flags.json) {
    stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return ok ? 0 : 1;
  }

  const out = (line = '') => stdout.write(`${line}\n`);
  out('metro init --check');
  out('');
  out(`  ${style.muted('key file')}     ${exists ? `${fileShown}  (mode ${mode})` : `${fileShown}  (not created yet)`}`);
  const row = (label, item) => {
    const name = label.padEnd(12);
    const src = item.source ? `  ${style.muted(`from ${item.source}`)}` : '';
    if (item.status === 'working') return `  ${style.ok(`${name}working · ${item.summary}`)}${src}`;
    if (item.status === 'missing') {
      return item.optional
        ? `  ${style.beat(`${name}not set (optional). Add it any time: metro init --prod`)}`
        : `  ${style.fail(`${name}missing`)}`;
    }
    if (item.status === 'rejected') return `  ${style.fail(`${name}set but rejected (${item.httpStatus})`)}${src}`;
    if (item.status === 'same-as-sandbox') return `  ${style.fail(`${name}same value as the sandbox key`)}${src}`;
    if (item.status === 'unreachable') return `  ${style.fail(`${name}not checked: no connection`)}${src}`;
    return `  ${style.fail(`${name}check failed (HTTP ${item.httpStatus})`)}${src}`;
  };
  out(row('sandbox', sandbox));
  out(row('production', production));
  out('');
  const messages = [sandbox.message, production.message].filter(Boolean);
  for (const message of [...new Set(messages)]) out(`  ${message}`);
  if (messages.length) out('');
  out(`  Next: ${next}`);
  return ok ? 0 : 1;
}

// ---------------------------------------------------------------------------
// --agent (and every non-TTY run)

function runAgent(flags, deps) {
  const { stdout, homeDir } = deps;
  const out = (line = '') => stdout.write(`${line}\n`);
  const file = ensureEnvFile({ homeDir });
  const shown = displayPath(file.path, homeDir);
  const state = readEnvValues(file.path);
  const has = (name) => Boolean(state[name] && String(state[name]).trim());
  copyAgentsManual(homeDir, deps.agentsSource);
  ensureReadOnlyMode(homeDir);

  out('metro init (agent mode: no prompts)');
  out('');
  if (file.created) out(`✓ Created ${shown} (mode 600) with empty placeholders.`);
  else out(`✓ ${shown} already exists (mode 600). metro kept every value in it.`);
  out('');

  const target = flags.prod
    ? { name: PROD_VAR, url: PROD_TOKEN_URL, label: 'production' }
    : { name: SANDBOX_VAR, url: SANDBOX_TOKEN_URL, label: 'sandbox' };

  if (has(target.name)) {
    out(`The ${target.label} key is already set in ${shown}. metro never overwrites it.`);
    out('');
  } else {
    out('ASK THE HUMAN TO DO THIS (do not ask them to paste keys into chat):');
    out(`  1. Open ${target.url} and create a token.`);
    out(`  2. Open ${shown} in an editor and paste it after ${target.name}=`);
    out('  3. Save the file and tell you "done".');
    out('');
  }
  out('Then run: metro init --check');
  out('');
  out(`metro is in ${loadOperatorMode({ dir: metroDir(homeDir) }).mode} mode. Operating manual: ~/.metro/AGENTS.md`);
  return 0;
}

// ---------------------------------------------------------------------------
// Interactive TTY

async function runInteractive(flags, deps) {
  const { stdout, homeDir, env, fetchImpl, askHidden, askLine } = deps;
  const style = createStyle({ stream: stdout, env, plain: flags.plain });
  const out = (line = '') => stdout.write(`${line}\n`);
  const total = flags.prod ? 2 : 4;
  let stepNo = 0;
  const step = (title, note) => {
    stepNo += 1;
    out('');
    out(`  ${style.muted(`Step ${stepNo} of ${total}`)}  ${title}${note ? `  ${style.muted(`(${note})`)}` : ''}`);
  };

  out('');
  out(`  metro ${style.muted('·')} Metronome in your terminal`);

  step('Create your key file');
  const file = ensureEnvFile({ homeDir });
  const shown = displayPath(file.path, homeDir);
  if (file.created) out(`  ${style.ok(`Created ${shown}  (private: only your user can read it)`)}`);
  else out(`  ${style.ok(`${shown} is already here  (private, mode 600). metro keeps every value in it.`)}`);
  copyAgentsManual(homeDir, deps.agentsSource);

  const values = () => readEnvValues(file.path);
  const has = (name) => Boolean(values()[name] && String(values()[name]).trim());

  async function verify(label) {
    out(`  ${style.pending('Checking it with a read-only call')}`);
    const key = values()[label === 'sandbox' ? SANDBOX_VAR : PROD_VAR];
    const result = await checkOne(label, key, { fetchImpl, file: shown });
    if (result.status === 'working') {
      const badge = label === 'sandbox' ? style.sandbox('sandbox') : style.apply('production');
      out(`  ${style.ok(`Connected to your Metronome ${badge} · ${result.summary}`)}`);
    } else {
      out(`  ${style.fail(result.message)}`);
    }
    return result.status === 'working';
  }

  let sandboxWorking = false;
  if (!flags.prod) {
    step('Add your sandbox key', "start here, it can't touch real billing");
    if (has(SANDBOX_VAR)) {
      out(`  ${style.ok(`Sandbox key already set in ${shown}. metro never overwrites it.`)}`);
      sandboxWorking = await verify('sandbox');
    } else {
      out(`    1. Open ${SANDBOX_TOKEN_URL}`);
      out('    2. Click "Create token", name it "metro", copy it.');
      out('    3. Paste it here (input is hidden), or press Enter to paste it into the file yourself:');
      out('');
      const key = await askHidden(`  ${style.muted('›')} `);
      if (!key) {
        out(`  ${style.beat(`No key entered. Open ${shown} in an editor and paste it after ${SANDBOX_VAR}=`)}`);
        out('    Then run: metro init --check');
      } else {
        const saved = setKeyIfEmpty(file.path, SANDBOX_VAR, key);
        if (saved.written) {
          out(`  ${style.ok(`Sandbox key saved to ${shown} as ${SANDBOX_VAR}`)}`);
          sandboxWorking = await verify('sandbox');
        } else {
          out(`  ${style.fail(`Not saved (${saved.reason}). Paste it into ${shown} after ${SANDBOX_VAR}= instead.`)}`);
        }
      }
    }
  }

  step('Production key', flags.prod ? null : 'optional, you can add it later');
  if (has(PROD_VAR)) {
    out(`  ${style.ok(`Production key already set in ${shown}. metro never overwrites it.`)}`);
    if (has(SANDBOX_VAR) && values()[PROD_VAR].trim() === values()[SANDBOX_VAR].trim()) {
      out(`  ${style.fail(COPY.sameKey)}`);
    } else {
      await verify('production');
    }
  } else {
    out("    Only add this when you're ready for metro to read real billing.");
    out('    Writes to production still need write mode plus a typed confirmation for every change.');
    out(`    Create one at ${PROD_TOKEN_URL}`);
    const answer = flags.prod ? 'y' : await askLine(`  Add a production key now? (y/N) ${style.muted('›')} `);
    if (!/^y(es)?$/i.test(answer)) {
      out(`  ${style.beat('Skipped. Add it any time: metro init --prod')}`);
    } else {
      out('    Paste it here (input is hidden), or press Enter to paste it into the file yourself:');
      out('');
      const key = await askHidden(`  ${style.muted('›')} `);
      if (!key) {
        out(`  ${style.beat(`No key entered. Paste it into ${shown} after ${PROD_VAR}= when you're ready.`)}`);
        out('    Then run: metro init --check');
      } else if (has(SANDBOX_VAR) && key.trim() === String(values()[SANDBOX_VAR]).trim()) {
        out(`  ${style.fail(`${COPY.sameKey} Not saved.`)}`);
      } else {
        const saved = setKeyIfEmpty(file.path, PROD_VAR, key);
        if (saved.written) {
          out(`  ${style.ok(`Production key saved to ${shown} as ${PROD_VAR}`)}`);
          await verify('production');
        } else {
          out(`  ${style.fail(`Not saved (${saved.reason}). Paste it into ${shown} after ${PROD_VAR}= instead.`)}`);
        }
      }
    }
  }

  if (!flags.prod) {
    step('Safety mode');
    const mode = ensureReadOnlyMode(homeDir);
    if (mode.mode === 'read-only') {
      out(`  ${style.ok('metro is in read-only mode. It can look, preview and validate, but not change anything.')}`);
      out('    When you want changes applied: metro mode write');
    } else {
      out(`  ${style.beat(`metro is in ${mode.mode} mode (you set this earlier). Drop back any time: metro mode set read-only`)}`);
    }
  }

  out('');
  if (flags.prod) {
    out('  Next: metro init --check');
  } else if (sandboxWorking) {
    out("  You're set. Try:");
    out(`    metro status                        ${style.muted('what metro can see')}`);
    out(`    metro catalog bind --sandbox        ${style.muted('learn your products and rate cards')}`);
    out(`    metro ops who "Acme" --sandbox      ${style.muted('find a customer')}`);
  } else {
    out('  Next: add or fix the sandbox key, then run: metro init --check');
  }
  out('');
  out('  Using an agent? Tell it: "read ~/.metro/AGENTS.md and run metro status"');
  return 0;
}

// ---------------------------------------------------------------------------

async function runInit(argv = [], overrides = {}) {
  const deps = {
    stdout: process.stdout,
    stderr: process.stderr,
    stdin: process.stdin,
    env: process.env,
    homeDir: os.homedir(),
    cwd: process.cwd(),
    fetchImpl: globalThis.fetch,
    agentsSource: AGENTS_SOURCE,
    ...overrides,
  };
  if (deps.isTTY === undefined) deps.isTTY = Boolean(deps.stdin.isTTY && deps.stdout.isTTY);
  if (!deps.askHidden) {
    const { readHidden } = require('./prompt');
    deps.askHidden = (prompt) => readHidden({ input: deps.stdin, output: deps.stdout, prompt });
  }
  if (!deps.askLine) {
    const { readLine } = require('./prompt');
    deps.askLine = (prompt) => readLine({ input: deps.stdin, output: deps.stdout, prompt });
  }

  const { flags, unknown } = parseInitArgs(argv);
  if (flags.help) {
    deps.stdout.write(`${helpText()}\n`);
    return 0;
  }
  if (unknown.length) {
    deps.stderr.write(`Unknown option for metro init: ${unknown.join(' ')}\n${helpText()}\n`);
    return 1;
  }

  try {
    if (flags.check) return await runCheck(flags, deps);
    if (flags.agent || !deps.isTTY) return runAgent(flags, deps);
    return await runInteractive(flags, deps);
  } catch (error) {
    if (error.code === 'METRO_INIT_CANCELLED') {
      deps.stderr.write('Stopped. Nothing else changed. Run metro init again any time.\n');
      return 130;
    }
    deps.stderr.write(`${error.message}\n`);
    return 1;
  }
}

/** True when no Metronome key is configured anywhere metro would look by default. */
function isFreshMachine({ homeDir = os.homedir(), env = process.env } = {}) {
  for (const name of [SANDBOX_VAR, PROD_VAR, 'METRONOME_API_KEY']) {
    if (env[name] && String(env[name]).trim()) return false;
  }
  const values = readEnvValues(envFilePath(homeDir));
  return !(values[SANDBOX_VAR] && values[SANDBOX_VAR].trim()) && !(values[PROD_VAR] && values[PROD_VAR].trim());
}

function startHereBanner({ stream = process.stdout, env = process.env } = {}) {
  const style = createStyle({ stream, env });
  return [
    `${style.paint('confirm', 'Start here:')} metro init`,
    `  ${style.muted('Creates ~/.metro/.env, adds a sandbox key, and keeps metro read-only.')}`,
    `  ${style.muted('Setting up an agent? It runs: metro init --agent')}`,
    '',
  ].join('\n');
}

module.exports = {
  CHECK_SCHEMA,
  AGENTS_SOURCE,
  COPY,
  parseInitArgs,
  runInit,
  runCheck,
  isFreshMachine,
  startHereBanner,
  copyAgentsManual,
};
