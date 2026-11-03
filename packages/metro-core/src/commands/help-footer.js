'use strict';

/**
 * Flags every command accepts and the exit codes every command uses. Printed
 * at the foot of `metro --help` and checked by test/flags-in-help.test.js.
 */

const GLOBAL_FLAGS = Object.freeze([
  { flag: '--help', usage: '--help', description: 'print this help (any command)' },
  { flag: '--workspace', usage: '--workspace <pack>', description: 'use a workspace pack for this run only' },
  { flag: '--production', usage: '--production', description: 'alias of --prod on live ops' },
]);

const EXIT_CODES = Object.freeze([
  { code: 0, meaning: 'success' },
  { code: 1, meaning: 'usage, validation, blocked plan, or API error' },
  { code: 2, meaning: 'safety refusal (missing tenant, gate, token, or confirmation)' },
  { code: 3, meaning: 'read-back mismatch after a live write (the write happened; check the log)' },
]);

/** Workflows whose apply is refused: they stop at a local preview. */
function previewOnlyWorkflows(unsupportedCommands = []) {
  return unsupportedCommands
    .filter((c) => c.mode === 'apply' && !c.id.startsWith('api.'))
    .map((c) => `${c.command.replace(/^metro /, '').split(' apply')[0]} preview`);
}

function helpFooterLines({ unsupportedCommands = [] } = {}) {
  const previewOnly = previewOnlyWorkflows(unsupportedCommands);
  return [
    ...(previewOnly.length
      ? ['Preview only (their apply refuses; no live write path yet):', `  ${previewOnly.join(', ')}`, '']
      : []),
    'Global flags:',
    ...GLOBAL_FLAGS.map((f) => `  ${f.usage.padEnd(20)} ${f.description}`),
    '',
    'Exit codes:',
    ...EXIT_CODES.map((e) => `  ${e.code}  ${e.meaning}`),
  ];
}

module.exports = { GLOBAL_FLAGS, EXIT_CODES, helpFooterLines, previewOnlyWorkflows };
