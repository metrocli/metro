'use strict';

const fs = require('fs');
const { spawnSync } = require('child_process');
const path = require('path');

function resolveMetroBin(options = {}) {
  if (options.metroBin) return options.metroBin;
  if (process.argv[1] && /metro\.js$/.test(process.argv[1])) return process.argv[1];
  const candidates = [
    path.join(__dirname, '..', '..', '..', '..', 'bin', 'metro.js'),
    path.join(__dirname, '..', '..', 'bin', 'metro.js'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return candidates[0];
}

function parseCommandLine(command) {
  const tokens = [];
  let current = '';
  let quote = null;

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];
    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }
    if (char === '"' || char === '\'') {
      quote = char;
      continue;
    }
    if (char === ' ') {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }
    current += char;
  }
  if (current) tokens.push(current);
  return tokens;
}

function splitEnvFromArgv(tokens) {
  const envOverrides = {};
  let index = 0;
  while (index < tokens.length && /^[A-Z][A-Z0-9_]*=/.test(tokens[index])) {
    const eq = tokens[index].indexOf('=');
    envOverrides[tokens[index].slice(0, eq)] = tokens[index].slice(eq + 1);
    index += 1;
  }
  return { envOverrides, argv: tokens.slice(index) };
}

function executeHarnessSteps(steps, options = {}) {
  const metroBin = resolveMetroBin(options);
  const cwd = options.cwd || process.cwd();
  const env = options.env || process.env;
  const results = [];
  let passed = 0;
  let failed = 0;
  let skipped = 0;

  for (const step of steps) {
    if (step.status === 'skipped-fixture-missing' || step.skipExecution === true) {
      skipped += 1;
      results.push({
        id: step.id,
        order: step.order,
        command: step.command,
        skipped: true,
        skipReason: step.skipReason || 'fixture-missing',
        passed: true,
        exitCode: null,
        durationMs: 0,
      });
      continue;
    }

    const started = Date.now();
    const parsed = splitEnvFromArgv(parseCommandLine(step.command));
    const argv = parsed.argv;
    if (argv[0] === 'metro') {
      argv[0] = metroBin;
    }

    const result = spawnSync(process.execPath, argv, {
      cwd,
      env: { ...env, ...parsed.envOverrides },
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 20,
    });
    const durationMs = Date.now() - started;
    const expectedExit = step.expectedExitCode ?? 0;
    const stepPassed = result.status === expectedExit;

    if (stepPassed) passed += 1;
    else failed += 1;

    results.push({
      id: step.id,
      order: step.order,
      command: step.command,
      skipped: false,
      passed: stepPassed,
      exitCode: result.status,
      expectedExitCode: expectedExit,
      durationMs,
      stdoutBytes: (result.stdout || '').length,
      stderrBytes: (result.stderr || '').length,
      stderrPreview: stepPassed ? null : String(result.stderr || result.stdout || '').slice(0, 500),
    });

    if (!stepPassed && step.required !== false && options.stopOnFailure !== false) {
      break;
    }
  }

  return {
    executed: true,
    passed,
    failed,
    skipped,
    total: steps.length,
    allRequiredPassed: failed === 0,
    results,
  };
}

module.exports = {
  executeHarnessSteps,
  parseCommandLine,
  splitEnvFromArgv,
};
