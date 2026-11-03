'use strict';

// metro init: file creation, permissions, idempotency, hidden input, --agent, --check.
// No live network: every Metronome call goes to a mock fetch.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { spawnSync } = require('child_process');
const { REPO_ROOT, tempDir, runMetro, cleanEnv } = require('./helpers');

const INIT = path.join(REPO_ROOT, 'packages/metro-core/src/init');
const { runInit, isFreshMachine, COPY } = require(INIT);
const { ENV_TEMPLATE, setKeyIfEmpty, ensureEnvFile } = require(path.join(INIT, 'env-file.js'));
const { readHidden, readLine } = require(path.join(INIT, 'prompt.js'));
const { createStyle } = require(path.join(INIT, 'style.js'));

const SANDBOX_KEY = 'sbx_test_7f3a9c1e5b2d4f6a8c0e';
const PROD_KEY = 'prd_test_1a2b3c4d5e6f7a8b9c0d';

function sink({ isTTY = false } = {}) {
  let text = '';
  return { isTTY, write(chunk) { text += chunk; return true; }, get text() { return text; } };
}

/** Mock fetch: maps key -> status. Records every call. */
function mockFetch(byKey = {}) {
  const calls = [];
  const impl = async (url, init) => {
    const key = String(init.headers.Authorization).replace(/^Bearer /, '');
    calls.push({ url, method: init.method, key });
    const behavior = byKey[key] || { status: 401 };
    if (behavior.throw) throw new TypeError('fetch failed');
    const isRateCards = url.includes('/rate-cards/list');
    const body = isRateCards
      ? { data: Array.from({ length: behavior.rateCards ?? 3 }, (_, i) => ({ id: `rc${i}` })), next_page: null }
      : { data: Array.from({ length: behavior.customers ?? 12 }, (_, i) => ({ id: `c${i}` })), next_page: behavior.more ? 'cursor' : null };
    return {
      ok: behavior.status >= 200 && behavior.status < 300,
      status: behavior.status,
      json: async () => (behavior.status === 200 ? body : { message: 'Unauthorized' }),
    };
  };
  impl.calls = calls;
  return impl;
}

function deps(home, extra = {}) {
  return {
    stdout: sink(),
    stderr: sink(),
    stdin: { isTTY: false },
    env: {},
    homeDir: home,
    cwd: home,
    fetchImpl: mockFetch(),
    ...extra,
  };
}

const envPath = (home) => path.join(home, '.metro', '.env');
const modeOf = (file) => (fs.statSync(file).mode & 0o777).toString(8);

test('--agent creates ~/.metro/.env from the template with mode 600', async () => {
  const home = tempDir();
  const d = deps(home);
  const code = await runInit(['--agent'], d);
  assert.equal(code, 0);
  assert.equal(fs.readFileSync(envPath(home), 'utf8'), ENV_TEMPLATE);
  assert.equal(modeOf(envPath(home)), '600');
  assert.match(ENV_TEMPLATE, /https:\/\/app\.metronome\.com\/sandbox\/developer\/api-tokens/);
  assert.match(ENV_TEMPLATE, /https:\/\/app\.metronome\.com\/developer\/api-tokens/);
  assert.ok(fs.existsSync(path.join(home, '.metro', 'AGENTS.md')), 'AGENTS.md copied');
  const mode = JSON.parse(fs.readFileSync(path.join(home, '.metro', 'mode.json'), 'utf8'));
  assert.equal(mode.mode, 'read-only');
});

test('--agent prints the plain-English human handoff and never prompts', async () => {
  const home = tempDir();
  const d = deps(home, {
    askHidden: async () => { throw new Error('must not prompt'); },
    askLine: async () => { throw new Error('must not prompt'); },
  });
  await runInit(['--agent'], d);
  const out = d.stdout.text;
  assert.match(out, /^metro init \(agent mode: no prompts\)/);
  assert.match(out, /✓ Created ~\/\.metro\/\.env \(mode 600\) with empty placeholders\./);
  assert.match(out, /ASK THE HUMAN TO DO THIS \(do not ask them to paste keys into chat\):/);
  assert.match(out, /1\. Open https:\/\/app\.metronome\.com\/sandbox\/developer\/api-tokens and create a token\./);
  assert.match(out, /2\. Open ~\/\.metro\/\.env in an editor and paste it after METRONOME_SANDBOX_KEY=/);
  assert.match(out, /3\. Save the file and tell you "done"\./);
  assert.match(out, /Then run: metro init --check/);
  assert.doesNotMatch(out, /\{/, 'handoff is JSON-free');
});

test('a non-TTY run behaves like --agent', async () => {
  const home = tempDir();
  const result = runMetro(['init'], { home });
  assert.equal(result.code, 0);
  assert.match(result.stdout, /agent mode: no prompts/);
  assert.equal(modeOf(envPath(home)), '600');
});

test('--agent --prod hands off only the production key', async () => {
  const home = tempDir();
  const d = deps(home);
  await runInit(['--agent', '--prod'], d);
  assert.match(d.stdout.text, /https:\/\/app\.metronome\.com\/developer\/api-tokens/);
  assert.match(d.stdout.text, /after METRONOME_PROD_KEY=/);
  assert.doesNotMatch(d.stdout.text, /after METRONOME_SANDBOX_KEY=/);
});

test('re-running init never overwrites existing values and re-asserts mode 600', async () => {
  const home = tempDir();
  fs.mkdirSync(path.join(home, '.metro'));
  const custom = `# mine\nMETRONOME_SANDBOX_KEY=${SANDBOX_KEY}\nOTHER=keep\n`;
  fs.writeFileSync(envPath(home), custom, { mode: 0o644 });
  const d = deps(home);
  await runInit(['--agent'], d);
  assert.equal(fs.readFileSync(envPath(home), 'utf8'), custom);
  assert.equal(modeOf(envPath(home)), '600');
  assert.match(d.stdout.text, /already exists \(mode 600\)\. metro kept every value in it\./);
  assert.match(d.stdout.text, /sandbox key is already set/);
  assert.ok(!d.stdout.text.includes(SANDBOX_KEY));

  const again = setKeyIfEmpty(envPath(home), 'METRONOME_SANDBOX_KEY', 'something-else');
  assert.deepEqual(again, { written: false, reason: 'already-set' });
  assert.equal(fs.readFileSync(envPath(home), 'utf8'), custom);
});

test('init keeps an operator mode the user already chose', async () => {
  const home = tempDir();
  fs.mkdirSync(path.join(home, '.metro'));
  fs.writeFileSync(path.join(home, '.metro', 'mode.json'), JSON.stringify({ mode: 'read-write' }));
  await runInit(['--agent'], deps(home));
  assert.equal(JSON.parse(fs.readFileSync(path.join(home, '.metro', 'mode.json'), 'utf8')).mode, 'read-write');
});

test('interactive: hidden key is saved to the file, validated, and never printed', async () => {
  const home = tempDir();
  const fetchImpl = mockFetch({ [SANDBOX_KEY]: { status: 200, customers: 12 } });
  const d = deps(home, {
    isTTY: true,
    fetchImpl,
    askHidden: async () => SANDBOX_KEY,
    askLine: async () => 'n',
  });
  const code = await runInit([], d);
  assert.equal(code, 0);
  const out = d.stdout.text + d.stderr.text;
  assert.ok(!out.includes(SANDBOX_KEY), 'key must never be printed');
  assert.ok(!out.includes(SANDBOX_KEY.slice(0, 8)), 'not even a prefix');
  assert.match(out, /Step 1 of 4  Create your key file/);
  assert.match(out, /✓ Sandbox key saved to ~\/\.metro\/\.env as METRONOME_SANDBOX_KEY/);
  assert.match(out, /✓ Connected to your Metronome sandbox · 12 customers · 3 rate cards/);
  assert.match(out, /Skipped\. Add it any time: metro init --prod/);
  assert.match(out, /metro is in read-only mode/);
  assert.match(out, /metro catalog bind --sandbox/);
  assert.match(fs.readFileSync(envPath(home), 'utf8'), new RegExp(`^METRONOME_SANDBOX_KEY=${SANDBOX_KEY}$`, 'm'));
  assert.equal(modeOf(envPath(home)), '600');
  assert.equal(fetchImpl.calls[0].method, 'GET');
  assert.equal(fetchImpl.calls[0].url, 'https://api.metronome.com/v1/customers?limit=100');
});

test('interactive: Enter skips to "paste it into the file yourself"', async () => {
  const home = tempDir();
  const fetchImpl = mockFetch();
  const d = deps(home, { isTTY: true, fetchImpl, askHidden: async () => '', askLine: async () => '' });
  await runInit([], d);
  assert.match(d.stdout.text, /No key entered\. Open ~\/\.metro\/\.env in an editor and paste it after METRONOME_SANDBOX_KEY=/);
  assert.equal(fetchImpl.calls.length, 0);
  assert.equal(fs.readFileSync(envPath(home), 'utf8'), ENV_TEMPLATE);
});

test('interactive: a production key equal to the sandbox key is refused', async () => {
  const home = tempDir();
  const answers = [SANDBOX_KEY, SANDBOX_KEY];
  const d = deps(home, {
    isTTY: true,
    fetchImpl: mockFetch({ [SANDBOX_KEY]: { status: 200 } }),
    askHidden: async () => answers.shift(),
    askLine: async () => 'y',
  });
  await runInit([], d);
  assert.ok(d.stdout.text.includes(COPY.sameKey));
  assert.match(fs.readFileSync(envPath(home), 'utf8'), /^METRONOME_PROD_KEY=$/m);
});

test('hidden prompt masks input and never echoes the characters', async () => {
  const input = new EventEmitter();
  let raw = false;
  Object.assign(input, {
    isTTY: true,
    isRaw: false,
    setRawMode(v) { raw = v; },
    setEncoding() {},
    resume() {},
    pause() {},
  });
  const output = sink({ isTTY: true });
  const pending = readHidden({ input, output, prompt: '› ' });
  assert.equal(raw, true);
  input.emit('data', `${SANDBOX_KEY}x`);
  input.emit('data', '\u007f');
  input.emit('data', '\r');
  const value = await pending;
  assert.equal(value, SANDBOX_KEY);
  assert.equal(raw, false);
  assert.ok(!output.text.includes(SANDBOX_KEY.slice(0, 4)));
  assert.match(output.text, /^› •+/);
});

test('--check: missing sandbox exits 1 and names the single next action', async () => {
  const home = tempDir();
  await runInit(['--agent'], deps(home));
  const d = deps(home);
  const code = await runInit(['--check', '--json'], d);
  assert.equal(code, 1);
  const payload = JSON.parse(d.stdout.text);
  assert.equal(payload.schemaVersion, 'metro.init.check.v1');
  assert.equal(payload.ok, false);
  assert.equal(payload.envFile.mode, '600');
  assert.equal(payload.keys.sandbox.status, 'missing');
  assert.equal(payload.keys.production.status, 'missing');
  assert.match(payload.next, /METRONOME_SANDBOX_KEY=/);
});

test('--check: 401 is reported as rejected with the plain-English copy', async () => {
  const home = tempDir();
  ensureEnvFile({ homeDir: home });
  setKeyIfEmpty(envPath(home), 'METRONOME_SANDBOX_KEY', SANDBOX_KEY);
  const d = deps(home, { fetchImpl: mockFetch({ [SANDBOX_KEY]: { status: 401 } }) });
  const code = await runInit(['--check'], d);
  assert.equal(code, 1);
  assert.match(d.stdout.text, /set but rejected \(401\)/);
  assert.match(d.stdout.text, /Metronome rejected the sandbox key\. It may be revoked or copied with a missing character\. Create a new one at https:\/\/app\.metronome\.com\/sandbox\/developer\/api-tokens and replace the line in ~\/\.metro\/\.env\./);
  assert.ok(!d.stdout.text.includes(SANDBOX_KEY));
});

test('--check: working sandbox and production keys exit 0 with a tenant summary', async () => {
  const home = tempDir();
  ensureEnvFile({ homeDir: home });
  setKeyIfEmpty(envPath(home), 'METRONOME_SANDBOX_KEY', SANDBOX_KEY);
  setKeyIfEmpty(envPath(home), 'METRONOME_PROD_KEY', PROD_KEY);
  const fetchImpl = mockFetch({
    [SANDBOX_KEY]: { status: 200, customers: 12, rateCards: 3 },
    [PROD_KEY]: { status: 200, customers: 100, more: true, rateCards: 1 },
  });
  const d = deps(home, { fetchImpl });
  const code = await runInit(['--check', '--json'], d);
  assert.equal(code, 0);
  const payload = JSON.parse(d.stdout.text);
  assert.equal(payload.keys.sandbox.status, 'working');
  assert.equal(payload.keys.sandbox.summary, '12 customers · 3 rate cards');
  assert.equal(payload.keys.production.summary, '100+ customers · 1 rate card');
  assert.equal(payload.next, 'metro status');
  assert.ok(!d.stdout.text.includes(SANDBOX_KEY) && !d.stdout.text.includes(PROD_KEY));
  assert.ok(fetchImpl.calls.every((c) => c.method === 'GET' || c.url.endsWith('/rate-cards/list?limit=100')));
});

test('--check: same key in both slots is refused without calling production', async () => {
  const home = tempDir();
  ensureEnvFile({ homeDir: home });
  setKeyIfEmpty(envPath(home), 'METRONOME_SANDBOX_KEY', SANDBOX_KEY);
  setKeyIfEmpty(envPath(home), 'METRONOME_PROD_KEY', SANDBOX_KEY);
  const fetchImpl = mockFetch({ [SANDBOX_KEY]: { status: 200 } });
  const d = deps(home, { fetchImpl });
  const code = await runInit(['--check', '--json'], d);
  assert.equal(code, 1);
  const payload = JSON.parse(d.stdout.text);
  assert.equal(payload.keys.production.status, 'same-as-sandbox');
  assert.equal(payload.keys.production.message, 'Your sandbox and production keys are the same. Sandbox and production need separate tokens.');
  assert.equal(fetchImpl.calls.filter((c) => !c.url.includes('rate-cards')).length, 1);
});

test('--check: network failure prints the connection copy', async () => {
  const home = tempDir();
  ensureEnvFile({ homeDir: home });
  setKeyIfEmpty(envPath(home), 'METRONOME_SANDBOX_KEY', SANDBOX_KEY);
  const d = deps(home, { fetchImpl: mockFetch({ [SANDBOX_KEY]: { throw: true } }) });
  const code = await runInit(['--check'], d);
  assert.equal(code, 1);
  assert.ok(d.stdout.text.includes("Couldn't reach api.metronome.com. Check your connection or proxy, then run metro init --check."));
});

test('--check via the real binary with a mocked fetch preload', () => {
  const home = tempDir();
  const preload = path.join(tempDir(), 'mock-fetch.js');
  fs.writeFileSync(preload, `globalThis.fetch = async (url, init) => ({ ok: false, status: 401, json: async () => ({}) });\n`);
  fs.mkdirSync(path.join(home, '.metro'));
  fs.writeFileSync(envPath(home), `METRONOME_SANDBOX_KEY=${SANDBOX_KEY}\n`, { mode: 0o600 });
  const result = runMetro(['init', '--check'], { home, env: { NODE_OPTIONS: `--require ${preload}` } });
  assert.equal(result.code, 1);
  assert.match(result.stdout, /rejected \(401\)/);
  assert.ok(!result.stdout.includes(SANDBOX_KEY) && !result.stderr.includes(SANDBOX_KEY));
});

test('metro with no args on a fresh machine prints the Start here banner above help', () => {
  const home = tempDir();
  const fresh = runMetro([], { home });
  assert.equal(fresh.code, 0);
  const lines = fresh.stdout.split('\n');
  assert.equal(lines[0], 'Start here: metro init');
  assert.match(fresh.stdout, /metro - Metronome in your terminal/);

  fs.mkdirSync(path.join(home, '.metro'));
  fs.writeFileSync(envPath(home), `METRONOME_SANDBOX_KEY=${SANDBOX_KEY}\n`);
  assert.equal(isFreshMachine({ homeDir: home, env: {} }), false);
  const configured = runMetro([], { home });
  assert.doesNotMatch(configured.stdout, /Start here/);
});

test('style honors NO_COLOR, non-TTY output, and --plain', () => {
  const tty = { isTTY: true };
  assert.equal(createStyle({ stream: tty, env: { TERM: 'xterm-256color' } }).depth, 2);
  assert.equal(createStyle({ stream: tty, env: { COLORTERM: 'truecolor' } }).depth, 3);
  assert.equal(createStyle({ stream: tty, env: { NO_COLOR: '1' } }).depth, 0);
  assert.equal(createStyle({ stream: { isTTY: false }, env: {} }).depth, 0);
  const plain = createStyle({ stream: tty, env: {}, plain: true });
  assert.equal(plain.ok('done'), 'ok done');
  const tc = createStyle({ stream: tty, env: { COLORTERM: 'truecolor' } });
  assert.equal(tc.proof('✓'), '\x1b[38;2;68;216;159m✓\x1b[0m'); // emerald #44D89F (= Signal)
  assert.equal(tc.signal('x'), tc.proof('x'));
  assert.equal(tc.confirm('x'), '\x1b[1m\x1b[38;2;251;108;43mx\x1b[0m'); // confirm stays ember #FB6C2B
  assert.equal(createStyle({ stream: tty, env: { TERM: 'xterm-256color' } }).proof('✓'), '\x1b[38;5;79m✓\x1b[0m');
});

// Cursor-control CSI sequences (anything but SGR colour, which ends in "m").
const CURSOR_CONTROL = /\x1b\[[0-9;?]*[ -/]*[@-ln-~]/;

test('y/N prompt echoes plain characters with no cursor-control codes', async () => {
  const input = new EventEmitter();
  let raw = false;
  Object.assign(input, {
    isTTY: true,
    isRaw: false,
    setRawMode(v) { raw = v; },
    setEncoding() {},
    resume() {},
    pause() {},
  });
  const output = sink({ isTTY: true });
  const pending = readLine({ input, output, prompt: '(y/N) \x1b[90m›\x1b[0m ' });
  assert.equal(raw, true);
  input.emit('data', '\x1b[A');
  input.emit('data', 'nx');
  input.emit('data', '\u007f');
  input.emit('data', '\r');
  assert.equal(await pending, 'n');
  assert.equal(raw, false);
  assert.equal(output.text, '(y/N) \x1b[90m›\x1b[0m nx\b \b\n');
  assert.doesNotMatch(output.text, CURSOR_CONTROL);
});

const PTY_DRIVER = String.raw`
import os, pty, sys, time, select
repo, preload, home = sys.argv[1:4]
env = {k: v for k, v in os.environ.items() if not k.startswith(('METRO_', 'METRONOME_'))}
env.update(HOME=home, NODE_OPTIONS='--require ' + preload, TERM='xterm-256color', COLORTERM='truecolor')
pid, fd = pty.fork()
if pid == 0:
    os.chdir(home)
    os.execvpe(sys.argv[4], [sys.argv[4], os.path.join(repo, 'bin/metro.js'), 'init'], env)
out = b''
def pump(seconds):
    global out
    end = time.time() + seconds
    while time.time() < end:
        r, _, _ = select.select([fd], [], [], 0.05)
        if r:
            try:
                data = os.read(fd, 65536)
            except OSError:
                return
            if not data:
                return
            out += data
def wait_for(text):
    end = time.time() + 15
    while text not in out and time.time() < end:
        pump(0.1)
wait_for(b'Paste it here'); pump(0.2)
os.write(fd, b'sbx_test_7f3a9c1e5b2d4f6a8c0e\r')
wait_for(b'(y/N)'); pump(0.2)
os.write(fd, b'n\r')
wait_for(b'Using an agent?'); pump(0.2)
os.waitpid(pid, 0)
sys.stdout.buffer.write(out)
`;

test('metro init on a real pty: y/N prompt prints no stray cursor codes', { skip: spawnSync('python3', ['-c', 'import pty'], { encoding: 'utf8' }).status !== 0 || process.platform === 'win32' }, () => {
  const home = tempDir();
  const preload = path.join(tempDir(), 'mock-fetch.js');
  fs.writeFileSync(preload, `globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ data: [] }) });\n`);
  const result = spawnSync('python3', ['-c', PTY_DRIVER, REPO_ROOT, preload, home, process.execPath], {
    env: cleanEnv(home),
    encoding: 'latin1',
    timeout: 30000,
  });
  assert.equal(result.status, 0, result.stderr);
  const text = result.stdout;
  const prompt = text.indexOf('Add a production key now? (y/N)');
  assert.ok(prompt !== -1, text);
  const answered = text.slice(prompt, text.indexOf('Skipped.', prompt));
  assert.ok(answered.includes(' n\r\n'), JSON.stringify(answered));
  assert.doesNotMatch(text, CURSOR_CONTROL, JSON.stringify(text.match(CURSOR_CONTROL)));
});
