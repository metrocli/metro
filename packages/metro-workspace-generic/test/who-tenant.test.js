'use strict';

// `metro ops who` suggests next commands; they must carry the tenant flag the
// user ran with, never a hard-coded --prod.

const test = require('node:test');
const assert = require('node:assert/strict');

const { FakeMetronome, testEnv } = require('./helpers/fake-metronome');
const { IDS, seed } = require('./fixtures-tenant');
const { run } = require('../../metro-core/src/cli');

async function who(tenantFlag, extra = []) {
  const env = testEnv();
  const fake = new FakeMetronome(seed()).install();
  let stdout = '';
  let stderr = '';
  const streams = { stdout: { write: (s) => { stdout += s; } }, stderr: { write: (s) => { stderr += s; } } };
  try {
    const argv = ['ops', 'who', `--customer-id=${IDS.acme}`, tenantFlag, ...extra];
    const code = await run(argv, streams);
    return { code, stdout, stderr, writes: fake.writes.length };
  } finally {
    fake.uninstall();
    env.restore();
  }
}

for (const [flag, other] of [['--sandbox', '--prod'], ['--prod', '--sandbox']]) {
  test(`ops who ${flag}: human next steps carry ${flag}`, async () => {
    const r = await who(flag);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.writes, 0);
    const steps = r.stdout.split('\n').filter((l) => l.trim().startsWith('metro '));
    assert.equal(steps.length, 3, r.stdout);
    for (const line of steps) {
      assert.ok(line.endsWith(` ${flag}`), `expected ${flag}: ${line}`);
      assert.ok(!line.includes(other), `must not suggest ${other}: ${line}`);
    }
  });

  test(`ops who ${flag} --json: nextCommands carry ${flag}`, async () => {
    const r = await who(flag, ['--json']);
    assert.equal(r.code, 0, r.stderr);
    const payload = JSON.parse(r.stdout);
    assert.equal(payload.nextCommands.length, 3);
    for (const line of payload.nextCommands) {
      assert.ok(line.endsWith(` ${flag}`), line);
      assert.ok(!line.includes(other), line);
    }
  });
}
