'use strict';

const REFUSAL_SCHEMA_VERSION = 'metro.refusal.v1';
const API_READ_REFUSAL_SCHEMA_VERSION = 'metro.api.read.refusal.v1';

function truncateSummary(text, maxLen = 160) {
  if (!text || typeof text !== 'string') return '';
  const trimmed = text.trim();
  if (trimmed.length <= maxLen) return trimmed;
  return `${trimmed.slice(0, maxLen - 1)}…`;
}

function buildNextCommands(commands) {
  return (Array.isArray(commands) ? commands : [])
    .filter((item) => typeof item === 'string' && item.trim() !== '')
    .slice(0, 3)
    .map((command) => command.trim());
}

function buildRefusal(options = {}) {
  const {
    schemaVersion = REFUSAL_SCHEMA_VERSION,
    command = null,
    reason,
    nextCommands = [],
    nextSafeStep = null,
    extra = {},
  } = options;

  const commands = buildNextCommands(nextCommands);
  const summary = truncateSummary(reason);
  const derivedNextSafeStep = nextSafeStep
    || (commands.length > 0
      ? `Try: ${commands[0]}`
      : 'Run metro schema --json to discover supported local commands.');

  return {
    schemaVersion,
    command,
    reason: summary,
    summary,
    nextCommands: commands,
    nextSafeStep: derivedNextSafeStep,
    ...extra,
  };
}

function buildApiReadRefusalPayload(baseRefusal) {
  const commands = buildNextCommands(baseRefusal.nextCommands || []);
  return {
    ...baseRefusal,
    schemaVersion: API_READ_REFUSAL_SCHEMA_VERSION,
    summary: truncateSummary(baseRefusal.blockReason || baseRefusal.reason || ''),
    nextCommands: commands.length > 0
      ? commands
      : buildNextCommands([
        'metro api read-plan <endpoint-id> --file <request.json> --sandbox --json',
        'metro api read-gate validate --file <api-read-gate.json> --json',
        'metro docs explain first-safe-preview --json',
      ]),
    nextSafeStep: baseRefusal.nextSafeStep
      || (commands[0] ? `Try: ${commands[0]}` : 'Review blockers and fix evidence before retrying.'),
  };
}

module.exports = {
  REFUSAL_SCHEMA_VERSION,
  API_READ_REFUSAL_SCHEMA_VERSION,
  buildNextCommands,
  buildRefusal,
  buildApiReadRefusalPayload,
  truncateSummary,
};
