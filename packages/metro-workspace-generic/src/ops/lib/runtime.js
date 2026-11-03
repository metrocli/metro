'use strict';

/**
 * Shared runtime for generic-pack write ops.
 *
 * Every op follows one contract:
 *
 *   preflight  live READS only (a guarded client refuses write-shaped paths),
 *              builds the exact request steps, a human diff and the expected
 *              read-back, then writes a plan file whose payloadHash is
 *              sha256(canonical { op, tenant, steps, expect }).
 *   apply      loads the plan, recomputes the hash (tamper check), requires
 *              --confirm-hash to match, requires the --sandbox/--prod flag to
 *              equal the tenant the plan was built for, and without --apply
 *              prints a dry run. With --apply it also requires operator mode
 *              read-write plus the tenant's typed confirmation token:
 *                sandbox     --confirm-live-apply=I_UNDERSTAND_THIS_WILL_WRITE_LIVE_METRONOME_SANDBOX
 *                production  --confirm-prod-apply=I_UNDERSTAND_BILLING_SIDE_EFFECTS
 *   readback   after the writes, GETs the objects and compares expected vs
 *              actual. Any mismatch exits 3.
 *
 * Exit codes: 0 ok, 1 usage/validation/blocked plan/API error, 2 safety
 * refusal, 3 read-back mismatch.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const core = require('./core');

const PLAN_SCHEMA = 'metro.op-plan.v1';
const APPLY_SCHEMA = 'metro.op-apply.v1';
const EXIT = Object.freeze({ OK: 0, ERROR: 1, REFUSED: 2, READBACK_MISMATCH: 3 });
const SANDBOX_APPLY_TOKEN = core.write.LIVE_APPLY_CONFIRMATION;
const PROD_APPLY_TOKEN = core.prodApply.LIVE_PROD_APPLY_CONFIRMATION;
const UNIQUENESS_KEY_MAX = 128;

// ---------------------------------------------------------------- errors

class OpError extends Error {
  constructor(code, message, { exitCode = EXIT.ERROR, details = null, nextCommands = null } = {}) {
    super(message);
    this.code = code;
    this.exitCode = exitCode;
    this.details = details;
    this.nextCommands = nextCommands;
  }
}

function refuse(code, message, extra = {}) {
  return new OpError(code, message, { exitCode: EXIT.REFUSED, ...extra });
}

function usageError(message) {
  return new OpError('MTR-USAGE', message, { exitCode: EXIT.ERROR });
}

function blocked(blockers, message = null) {
  return new OpError(
    'MTR-PLAN-BLOCKED',
    message || `Refusing to plan: ${blockers.map((b) => b.code).join(', ')}`,
    { exitCode: EXIT.ERROR, details: { blockers } },
  );
}

// ------------------------------------------------------------------ args

/** Merge cli flags ({ name: value }) with raw argv so ops work with either. */
function readFlag(flags, name) {
  const argv = flags.argv || [];
  const prefix = `--${name}=`;
  const raw = argv.find((a) => typeof a === 'string' && a.startsWith(prefix));
  if (raw) return raw.slice(prefix.length);
  const v = flags[name];
  if (v === undefined || v === null) return null;
  return v;
}

function readString(flags, name) {
  const v = readFlag(flags, name);
  if (v === null || v === true || v === false) return null;
  return String(v);
}

function readBool(flags, name) {
  const argv = flags.argv || [];
  if (argv.includes(`--${name}`)) return true;
  const v = flags[name];
  return v === true || v === 'true';
}

function readList(flags, name) {
  const v = readString(flags, name);
  if (!v) return [];
  return v.split(',').map((s) => s.trim()).filter(Boolean);
}

function readInt(flags, name, { min = null, allowNegative = false } = {}) {
  const v = readString(flags, name);
  if (v === null) return null;
  const re = allowNegative ? /^-?\d+$/ : /^\d+$/;
  if (!re.test(v)) throw usageError(`--${name} must be ${allowNegative ? 'a signed' : 'a non-negative'} integer, got ${v}`);
  const n = Number(v);
  if (min !== null && n < min) throw usageError(`--${name} must be >= ${min}, got ${v}`);
  return n;
}

function readNumber(flags, name) {
  const v = readString(flags, name);
  if (v === null) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) throw usageError(`--${name} must be a number, got ${v}`);
  return n;
}

function readJsonFlag(flags, name) {
  const v = readString(flags, name);
  if (v === null) return null;
  try {
    return JSON.parse(v);
  } catch (err) {
    throw usageError(`--${name} must be JSON: ${err.message}`);
  }
}

function wantsJson(flags) {
  return readBool(flags, 'json');
}

function loadSpecFile(filePath) {
  if (!filePath) throw usageError('--file=<spec.json|yaml> is required');
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) throw usageError(`Spec file not found: ${resolved}`);
  return core.files.loadStructuredFile(resolved);
}

// --------------------------------------------------------- tenant + keys

/**
 * Tenant must be explicit on every live op. Never inferred from which keys
 * happen to be in the environment.
 */
function explicitTenant(flags) {
  const argv = flags.argv || [];
  const sandbox = argv.includes('--sandbox') || flags.sandbox === true;
  const prod = argv.includes('--prod') || argv.includes('--production')
    || flags.prod === true || flags.production === true;
  if (sandbox && prod) {
    throw refuse('MTR-TENANT-003', 'Pass exactly one of --sandbox or --prod, not both.');
  }
  if (sandbox) return 'sandbox';
  if (prod) return 'production';
  throw refuse(
    'MTR-TENANT-001',
    'Pass --sandbox or --prod explicitly. metro never infers the tenant for a live op (start with --sandbox).',
  );
}

function tenantFlag(tenant) {
  return tenant === 'production' ? '--prod' : '--sandbox';
}

function fingerprint(key) {
  return `sha256:${crypto.createHash('sha256').update(String(key)).digest('hex').slice(0, 12)}`;
}

/**
 * Resolve the API key for an explicit tenant without mutating process.env.
 * Sandbox refuses a key that equals METRONOME_PROD_KEY, so a production key
 * left in METRONOME_API_KEY can never be used under --sandbox.
 */
function resolveTenantKey(tenant, env = process.env) {
  try {
    core.tenant.ensureLocalEnvLoaded();
  } catch {
    // .env loading is a convenience; missing keys are reported below.
  }
  const prodKey = env.METRONOME_PROD_KEY ? String(env.METRONOME_PROD_KEY).trim() : '';
  const sandboxKey = env.METRONOME_SANDBOX_KEY ? String(env.METRONOME_SANDBOX_KEY).trim() : '';
  const genericKey = env.METRONOME_API_KEY ? String(env.METRONOME_API_KEY).trim() : '';

  if (tenant === 'production') {
    if (!prodKey) throw refuse('MTR-TENANT-KEY-001', '--prod requires METRONOME_PROD_KEY.');
    if (sandboxKey && prodKey === sandboxKey) {
      throw refuse('MTR-TENANT-KEY-002', 'METRONOME_PROD_KEY equals METRONOME_SANDBOX_KEY; refusing production.');
    }
    return { tenant, key: prodKey, keyEnv: 'METRONOME_PROD_KEY', keyFingerprint: fingerprint(prodKey) };
  }

  const key = sandboxKey || genericKey;
  const keyEnv = sandboxKey ? 'METRONOME_SANDBOX_KEY' : 'METRONOME_API_KEY';
  if (!key) throw refuse('MTR-TENANT-KEY-001', '--sandbox requires METRONOME_SANDBOX_KEY (or METRONOME_API_KEY).');
  if (prodKey && key === prodKey) {
    throw refuse(
      'MTR-TENANT-KEY-003',
      `${keyEnv} equals METRONOME_PROD_KEY; refusing to treat a production key as sandbox.`,
    );
  }
  return { tenant, key, keyEnv, keyFingerprint: fingerprint(key) };
}

// ---------------------------------------------------------------- client

const WRITE_PATHS = [
  /\/create\b/i, /\/edit\b/i, /\/archive/i, /\/void\b/i, /\/regenerate\b/i, /\/update/i,
  /\/set[A-Z]/, /\/ingest\b/i, /\/add[A-Z]/, /\/delete/i, /\/remove/i, /\/amend\b/i,
  /\/cancel\b/i, /\/upsert/i,
];

function isWritePath(method, urlPath) {
  const bare = String(urlPath).split('?')[0];
  if (String(method).toUpperCase() === 'POST' && bare === '/v1/customers') return true;
  return WRITE_PATHS.some((re) => re.test(bare));
}

/**
 * Read client: GET/POST through the retrying transport, refusing anything
 * write-shaped so a preflight can never mutate the tenant.
 */
function createReadClient(keyInfo) {
  core.mode.assertOperatorModeAllows('live-read');
  const inner = core.retry.buildMetronomeRetryClient(keyInfo.key);
  const guard = (method, url) => {
    if (isWritePath(method, url)) {
      throw refuse('MTR-WRITE-001', `Refusing write-shaped endpoint during a read-only phase: ${method} ${url}`);
    }
  };
  return {
    tenant: keyInfo.tenant,
    get: (url) => { guard('GET', url); return inner.get(url); },
    post: (url, body) => { guard('POST', url); return inner.post(url, body); },
  };
}

/**
 * Write transport: no automatic retry except 429 (request not processed), so
 * a timeout on a create can never be silently replayed into a duplicate.
 */
function createWriteTransport(keyInfo) {
  core.mode.assertOperatorModeAllows('live-write');
  const transport = core.http.buildMetronomeHttpTransport(keyInfo.key);
  return async function send(method, urlPath, body) {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        const { data } = await transport({ method, path: urlPath, body });
        return data;
      } catch (err) {
        if (err.status === 429 && attempt < 3) {
          await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
          continue;
        }
        throw err;
      }
    }
    throw new Error('write transport exhausted 429 retries');
  };
}

// ------------------------------------------------------------ time helpers

function isoHour(iso) {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, '.000Z');
}

function isHourBoundaryUtc(iso) {
  const d = new Date(iso);
  return Number.isFinite(d.getTime())
    && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0;
}

function requireHourBoundary(name, iso) {
  if (!iso) return null;
  if (!isHourBoundaryUtc(iso)) {
    throw usageError(`${name} must be a UTC hour boundary (e.g. 2026-12-01T00:00:00.000Z), got ${iso}`);
  }
  return isoHour(iso);
}

function currentHourUtc(now = new Date()) {
  const d = new Date(now);
  d.setUTCMinutes(0, 0, 0);
  return d.toISOString();
}

function nextHourUtc(now = new Date()) {
  const d = new Date(now);
  d.setUTCMinutes(0, 0, 0);
  d.setUTCHours(d.getUTCHours() + 1);
  return d.toISOString();
}

function sameInstant(a, b) {
  if (a == null && b == null) return true;
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  return Number.isFinite(ta) && Number.isFinite(tb) && ta === tb;
}

// -------------------------------------------------------- uniqueness keys

/** Deterministic, ≤128 chars, safe characters only. */
function uniquenessKey(prefix, parts) {
  const digest = crypto.createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 24);
  const key = `metro-${prefix}-${digest}`.replace(/[^A-Za-z0-9_.:-]/g, '-');
  if (key.length > UNIQUENESS_KEY_MAX) {
    throw usageError(`uniqueness_key too long (${key.length}/${UNIQUENESS_KEY_MAX})`);
  }
  return key;
}

function assertUniquenessKey(key, where = 'uniqueness_key') {
  if (typeof key !== 'string' || key.length < 1 || key.length > UNIQUENESS_KEY_MAX) {
    throw usageError(`${where} must be a string of 1-${UNIQUENESS_KEY_MAX} characters`);
  }
  return key;
}

// ------------------------------------------------------------- plan file

function planHashInput(plan) {
  return { schemaVersion: PLAN_SCHEMA, op: plan.op, tenant: plan.tenant, steps: plan.steps, expect: plan.expect };
}

function computePlanHash(plan) {
  return core.canonicalHash.sha256(planHashInput(plan));
}

function normalizeHash(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  return raw.startsWith('sha256:') ? raw : `sha256:${raw}`;
}

function defaultPlanPath(op, slug) {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  return path.join(process.cwd(), 'metro-plans', `${op}-${slug || 'plan'}-${ts}.json`);
}

function logDir(op) {
  const base = process.env.METRO_LOG_DIR
    ? path.resolve(process.env.METRO_LOG_DIR)
    : path.join(os.homedir(), '.metro', 'logs');
  return path.join(base, op);
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
  return filePath;
}

// --------------------------------------------------------- step execution

/** "$step:<id>.<path>" placeholders resolve against earlier step responses. */
function resolveRefs(value, results) {
  if (typeof value === 'string' && value.startsWith('$step:')) {
    const [id, ...rest] = value.slice('$step:'.length).split('.');
    let cur = results[id];
    if (cur === undefined) throw new Error(`Unresolved step reference ${value}`);
    for (const key of rest) cur = cur == null ? undefined : cur[key];
    if (cur === undefined || cur === null) throw new Error(`Step reference ${value} resolved to nothing`);
    return cur;
  }
  if (Array.isArray(value)) return value.map((v) => resolveRefs(v, results));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveRefs(v, results)]));
  }
  return value;
}

// ------------------------------------------------------- read-back checks

function stable(value) {
  return core.canonicalHash.canonicalJson(value === undefined ? null : value);
}

function check(name, expected, actual, { compare = 'equal' } = {}) {
  let ok;
  if (compare === 'instant') ok = sameInstant(expected, actual);
  else if (compare === 'set') {
    const a = [...(expected || [])].map(String).sort();
    const b = [...(actual || [])].map(String).sort();
    ok = stable(a) === stable(b);
  } else if (compare === 'includes') ok = Array.isArray(actual) && actual.map(String).includes(String(expected));
  else if (compare === 'subset') ok = isSubset(expected, actual);
  else if (compare === 'number') ok = Number(expected) === Number(actual);
  else ok = stable(expected) === stable(actual);
  return { check: name, expected: expected === undefined ? null : expected, actual: actual === undefined ? null : actual, ok };
}

function isSubset(expected, actual) {
  if (expected === null || typeof expected !== 'object') {
    if (typeof expected === 'string' && typeof actual === 'string' && Number.isFinite(Date.parse(expected))
      && /\d{4}-\d{2}-\d{2}T/.test(expected)) {
      return sameInstant(expected, actual);
    }
    return stable(expected) === stable(actual);
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) return false;
    return expected.every((e, i) => isSubset(e, actual[i]));
  }
  if (!actual || typeof actual !== 'object') return false;
  return Object.keys(expected).every((k) => isSubset(expected[k], actual[k]));
}

// ------------------------------------------------------------- rendering

function renderChecks(checks) {
  const lines = ['Read-back (expected vs actual):'];
  for (const c of checks) {
    lines.push(`  ${c.ok ? 'ok  ' : 'FAIL'} ${c.check}: expected ${JSON.stringify(c.expected)} actual ${JSON.stringify(c.actual)}`);
  }
  return lines.join('\n');
}

function writeError(streams, json, err) {
  const payload = {
    schemaVersion: err.exitCode === EXIT.REFUSED ? 'metro.refusal.v1' : 'metro.op-error.v1',
    ok: false,
    refused: err.exitCode === EXIT.REFUSED,
    code: err.code || 'MTR-OP-ERROR',
    reason: err.message,
    ...(err.details ? { details: err.details } : {}),
    ...(err.nextCommands ? { nextCommands: err.nextCommands } : {}),
    ...(err.responseData ? { responseData: err.responseData } : {}),
    ...(err.status ? { status: err.status } : {}),
  };
  if (json) streams.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  else streams.stderr.write(`${err.exitCode === EXIT.REFUSED ? 'REFUSED' : 'ERROR'} [${payload.code}]: ${err.message}\n`);
}

function exitCodeFor(err) {
  if (err instanceof OpError) return err.exitCode;
  if (err && (err.code === 'MTR-MODE-WRITE-BLOCKED' || err.code === 'MTR-MODE-READ-BLOCKED'
    || err.code === 'MTR-PROD-APPLY-BLOCKED' || /^MTR-TENANT/.test(err.code || ''))) {
    return EXIT.REFUSED;
  }
  return EXIT.ERROR;
}

// ------------------------------------------------------------------ gates

function assertApplyAuthorized(tenant, flags) {
  try {
    core.mode.assertOperatorModeAllows('live-write');
  } catch (err) {
    throw refuse(err.code || 'MTR-MODE-WRITE-BLOCKED', err.message, { nextCommands: err.nextCommands });
  }
  if (tenant === 'sandbox') {
    if (readString(flags, 'confirm-live-apply') !== SANDBOX_APPLY_TOKEN) {
      throw refuse(
        'MTR-LIVE-APPLY-001',
        `Sandbox apply requires --confirm-live-apply=${SANDBOX_APPLY_TOKEN}.`,
      );
    }
    return;
  }
  if (tenant === 'production') {
    const token = readString(flags, 'confirm-prod-apply')
      || core.prodApply.readProductionApplyConfirmation({});
    if (token !== PROD_APPLY_TOKEN) {
      throw refuse(
        'MTR-PROD-APPLY-BLOCKED',
        `Production apply requires --prod and --confirm-prod-apply=${PROD_APPLY_TOKEN}.`,
      );
    }
    return;
  }
  throw refuse('MTR-TENANT-001', `Unknown tenant ${tenant}`);
}

function confirmFlagsFor(tenant) {
  return tenant === 'production'
    ? `--confirm-prod-apply=${PROD_APPLY_TOKEN}`
    : `--confirm-live-apply=${SANDBOX_APPLY_TOKEN}`;
}

// -------------------------------------------------------------- defineOp

/**
 * @param {object} def
 * @param {string} def.name          op name (plan.op), e.g. 'customer-create'
 * @param {string} def.command       CLI prefix, e.g. 'metro customer create'
 * @param {function} def.preflight   async (ctx) => { slug, summary, diff, steps, expect, warnings }
 * @param {function} [def.precheck]  async (ctx, plan) => blockers[] (live reads just before writing)
 * @param {function} def.verify      async (ctx, plan, results) => checks[]
 * @param {function} [def.render]    (summary) => string, human preflight summary
 */
function defineOp(def) {
  async function runPreflight(flags = {}, streams = { stdout: process.stdout, stderr: process.stderr }) {
    const json = wantsJson(flags);
    try {
      const tenant = explicitTenant(flags);
      const keyInfo = resolveTenantKey(tenant);
      const client = createReadClient(keyInfo);
      const ctx = { flags, tenant, keyInfo, client, now: new Date(), json };
      const built = await def.preflight(ctx);
      const plan = {
        schemaVersion: PLAN_SCHEMA,
        op: def.name,
        tenant,
        keyFingerprint: keyInfo.keyFingerprint,
        generatedAt: ctx.now.toISOString(),
        summary: built.summary || {},
        diff: built.diff || [],
        warnings: built.warnings || [],
        steps: built.steps,
        expect: built.expect || {},
      };
      plan.payloadHash = computePlanHash(plan);
      const outPath = path.resolve(readString(flags, 'out') || defaultPlanPath(def.name, built.slug));
      writeJson(outPath, plan);
      const applyBase = `${def.command} apply --file ${outPath} ${tenantFlag(tenant)} --confirm-hash ${plan.payloadHash}`;
      const result = {
        ...plan,
        planPath: outPath,
        nextCommands: [
          `${applyBase} --json`,
          `${applyBase} --apply ${confirmFlagsFor(tenant)} --json`,
        ],
      };
      if (json) {
        streams.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      } else {
        const lines = [`${def.command} preflight (${tenant}, key ${keyInfo.keyFingerprint}) - read-only, nothing written to Metronome.`];
        if (def.render) lines.push(def.render(plan.summary));
        for (const d of plan.diff) lines.push(`  ${d.field}: ${JSON.stringify(d.from)} -> ${JSON.stringify(d.to)}`);
        lines.push(`Steps: ${plan.steps.map((s) => `${s.method} ${s.path}`).join(' ; ')}`);
        for (const w of plan.warnings) lines.push(`WARNING [${w.id}]: ${w.message}`);
        lines.push(`Payload hash: ${plan.payloadHash}`);
        lines.push(`Wrote plan: ${outPath}`);
        lines.push(`Dry run:  ${applyBase}`);
        lines.push(`Apply:    ${applyBase} --apply ${confirmFlagsFor(tenant)}`);
        streams.stdout.write(`${lines.join('\n')}\n`);
      }
      return { exitCode: EXIT.OK, result };
    } catch (err) {
      writeError(streams, json, err);
      return { exitCode: exitCodeFor(err), error: err };
    }
  }

  async function runApply(flags = {}, streams = { stdout: process.stdout, stderr: process.stderr }) {
    const json = wantsJson(flags);
    const record = { schemaVersion: APPLY_SCHEMA, op: def.name, mode: null, steps: [], checks: [] };
    try {
      const file = readString(flags, 'file');
      if (!file) throw usageError(`Usage: ${def.command} apply --file <plan.json> --confirm-hash <sha256:...> (--sandbox|--prod) [--apply ${confirmFlagsFor('sandbox')}]`);
      const plan = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
      if (plan.schemaVersion !== PLAN_SCHEMA || plan.op !== def.name) {
        throw refuse('MTR-PLAN-001', `Plan file is not a ${def.name} plan (op=${plan.op || 'missing'}). Run ${def.command} preflight first.`);
      }
      const recomputed = computePlanHash(plan);
      if (recomputed !== plan.payloadHash) {
        throw refuse('MTR-PLAN-002', `Plan file was edited after preflight (recomputed ${recomputed}, file says ${plan.payloadHash}). Re-run preflight.`);
      }
      const confirm = normalizeHash(readString(flags, 'confirm-hash'));
      if (!confirm) throw refuse('MTR-HASH-001', `--confirm-hash is required (preflight hash: ${plan.payloadHash}).`);
      if (confirm !== recomputed) throw refuse('MTR-HASH-002', `--confirm-hash ${confirm} does not match plan hash ${recomputed}.`);

      const tenant = explicitTenant(flags);
      if (tenant !== plan.tenant) {
        throw refuse('MTR-TENANT-003', `Plan was built for ${plan.tenant} but apply was called with ${tenantFlag(tenant)}.`);
      }
      Object.assign(record, { tenant, payloadHash: recomputed, planPath: path.resolve(file) });

      if (!readBool(flags, 'apply')) {
        record.mode = 'dry_run';
        record.steps = plan.steps.map((s) => ({ id: s.id, method: s.method, path: s.path, body: s.body, dry_run: true }));
        record.expect = plan.expect;
        if (json) streams.stdout.write(`${JSON.stringify({ ok: true, ...record }, null, 2)}\n`);
        else {
          streams.stdout.write(`Dry run OK (${tenant}) - no Metronome writes.\n`);
          for (const s of plan.steps) streams.stdout.write(`  ${s.method} ${s.path} ${JSON.stringify(s.body)}\n`);
          streams.stdout.write(`Re-run with --apply ${confirmFlagsFor(tenant)} to execute.\n`);
        }
        return { exitCode: EXIT.OK, result: record };
      }

      assertApplyAuthorized(tenant, flags);
      const keyInfo = resolveTenantKey(tenant);
      if (plan.keyFingerprint && keyInfo.keyFingerprint !== plan.keyFingerprint) {
        throw refuse('MTR-TENANT-004', `API key changed since preflight (${plan.keyFingerprint} -> ${keyInfo.keyFingerprint}). Re-run preflight.`);
      }
      const client = createReadClient(keyInfo);
      const send = createWriteTransport(keyInfo);
      const ctx = { flags, tenant, keyInfo, client, now: new Date(), json };
      record.mode = 'apply';

      if (def.precheck) {
        const blockers = await def.precheck(ctx, plan);
        if (blockers && blockers.length) {
          throw new OpError('MTR-PRECHECK', `Live state changed since preflight: ${blockers.map((b) => b.code).join(', ')}. Re-run preflight.`, { details: { blockers } });
        }
      }

      const results = {};
      for (const step of plan.steps) {
        const body = resolveRefs(step.body, results);
        try {
          const resp = await send(step.method, step.path, body);
          results[step.id] = resp || {};
          record.steps.push({ id: step.id, method: step.method, path: step.path, ok: true, response: resp || null });
        } catch (err) {
          record.steps.push({ id: step.id, method: step.method, path: step.path, ok: false, error: err.message, responseData: err.responseData || null });
          const done = record.steps.filter((s) => s.ok).map((s) => s.id);
          const e = new OpError('MTR-APPLY-STEP-FAILED', `Step ${step.id} (${step.method} ${step.path}) failed: ${err.message}. Completed before failure: ${done.join(', ') || 'none'}.`, { details: { completedSteps: done } });
          e.responseData = err.responseData;
          throw e;
        }
      }

      try {
        record.checks = await def.verify(ctx, plan, results);
      } catch (err) {
        // A read-back that cannot read the object back is a failed read-back.
        record.checks = [check('read-back', 'objects readable after apply', `read failed: ${err.message}`)];
      }
      record.ok = record.checks.every((c) => c.ok);
      const logPath = writeJson(path.join(logDir(def.name), `apply-${new Date().toISOString().replace(/[:.]/g, '-')}.json`), record);
      record.logPath = logPath;
      if (json) streams.stdout.write(`${JSON.stringify(record, null, 2)}\n`);
      else {
        streams.stdout.write(`${record.ok ? 'Applied' : 'Applied, but read-back FAILED'} (${tenant}).\n`);
        streams.stdout.write(`${renderChecks(record.checks)}\n`);
        streams.stdout.write(`Log: ${logPath}\n`);
      }
      return { exitCode: record.ok ? EXIT.OK : EXIT.READBACK_MISMATCH, result: record };
    } catch (err) {
      if (record.mode === 'apply') {
        record.ok = false;
        record.error = err.message;
        try {
          record.logPath = writeJson(path.join(logDir(def.name), `apply-failed-${new Date().toISOString().replace(/[:.]/g, '-')}.json`), record);
        } catch {
          // logging must never mask the real error
        }
        err.details = { ...(err.details || {}), steps: record.steps, logPath: record.logPath };
      }
      writeError(streams, json, err);
      return { exitCode: exitCodeFor(err), error: err };
    }
  }

  return { name: def.name, command: def.command, runPreflight, runApply };
}

module.exports = {
  PLAN_SCHEMA,
  APPLY_SCHEMA,
  EXIT,
  SANDBOX_APPLY_TOKEN,
  PROD_APPLY_TOKEN,
  UNIQUENESS_KEY_MAX,
  OpError,
  refuse,
  usageError,
  blocked,
  readFlag,
  readString,
  readBool,
  readList,
  readInt,
  readNumber,
  readJsonFlag,
  wantsJson,
  loadSpecFile,
  explicitTenant,
  tenantFlag,
  resolveTenantKey,
  fingerprint,
  isWritePath,
  createReadClient,
  createWriteTransport,
  isoHour,
  isHourBoundaryUtc,
  requireHourBoundary,
  currentHourUtc,
  nextHourUtc,
  sameInstant,
  uniquenessKey,
  assertUniquenessKey,
  computePlanHash,
  normalizeHash,
  resolveRefs,
  check,
  isSubset,
  renderChecks,
  writeError,
  assertApplyAuthorized,
  confirmFlagsFor,
  defineOp,
};
