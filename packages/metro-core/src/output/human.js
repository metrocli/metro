'use strict';

function writeLines(stream, lines) {
  for (const line of lines) {
    if (line === null || line === undefined || line === '') continue;
    stream.write(`${line}\n`);
  }
}

function renderValidationHuman(stream, result, shape) {
  if (result.valid) {
    writeLines(stream, [
      `✓ Validation passed for ${shape}.`,
      'Why: The input matches the reviewed shape rules and guardrails.',
      'Next: Run metro package preview or metro api preview with the same file and --sandbox --json.',
    ]);
    return;
  }

  writeLines(stream, [
    `✗ Validation failed for ${shape}.`,
    'Why: One or more required fields or guardrails did not pass.',
    '',
  ]);

  for (const finding of result.findings || []) {
    const remediation = finding.remediation ? ` Fix: ${finding.remediation}` : '';
    stream.write(`  • ${finding.id} [${finding.severity}] ${finding.message}${remediation}\n`);
  }

  writeLines(stream, [
    '',
    'Next: Fix the fields above, then re-run with --json for machine-readable output.',
  ]);
}

function renderSuccessHuman(stream, options = {}) {
  const { title, why, nextCommands = [] } = options;
  writeLines(stream, [
    title || 'Success.',
    why ? `Why: ${why}` : null,
    nextCommands.length > 0 ? `Next: ${nextCommands[0]}` : null,
  ]);
  if (nextCommands.length > 1) {
    for (let i = 1; i < nextCommands.length; i += 1) {
      stream.write(`      ${nextCommands[i]}\n`);
    }
  }
}

function renderRefusalHuman(stream, refusal) {
  const summary = refusal.summary || refusal.blockReason || refusal.reason || 'Command refused.';
  writeLines(stream, [
    `✗ ${summary}`,
    refusal.command ? `Command: ${refusal.command}` : null,
  ]);

  if (Array.isArray(refusal.blockers) && refusal.blockers.length > 0) {
    stream.write('\nBlockers:\n');
    for (const blocker of refusal.blockers.slice(0, 5)) {
      stream.write(`  • ${blocker.id}: ${blocker.message}\n`);
    }
  }

  const commands = refusal.nextCommands || [];
  if (commands.length > 0) {
    stream.write('\nTry next:\n');
    for (const command of commands) {
      stream.write(`  ${command}\n`);
    }
  } else if (refusal.nextSafeStep) {
    stream.write(`\nNext: ${refusal.nextSafeStep}\n`);
  }
}

function renderLiveReadSuccessHuman(stream, result) {
  const endpointId = result.endpoint?.id || 'endpoint';
  const tenant = result.tenant || 'tenant';
  writeLines(stream, [
    `✓ Live read succeeded for ${endpointId} (${tenant}).`,
    `Why: Request matched the reviewed read gate and Metronome returned HTTP ${result.httpStatus || 200}.`,
    'Next: Save stdout JSON as evidence, or run metro api read-audit write to append an audit row.',
  ]);
}

function renderLiveApplySuccessHuman(stream, result) {
  const endpointId = result.endpoint?.id || 'endpoint';
  writeLines(stream, [
    `✓ Live sandbox apply succeeded for ${endpointId}.`,
    `Why: Apply gate, approval record, and sandbox proof matched before the write.`,
    'Next: Run metro api apply-readback verify with a fresh read-result from the created object.',
  ]);
}

module.exports = {
  renderValidationHuman,
  renderSuccessHuman,
  renderRefusalHuman,
  renderLiveReadSuccessHuman,
  renderLiveApplySuccessHuman,
  writeLines,
};
