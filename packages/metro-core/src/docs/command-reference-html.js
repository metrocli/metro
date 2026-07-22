'use strict';

const { renderBrandHeadLinks, renderGeneratedBrand, renderSiteScript } = require('./html-branding');

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderFlagList(flags) {
  if (!flags || flags.length === 0) return '<span class="muted">none</span>';
  return `<ul class="compact-list">${flags.map((flag) => `<li><code>${escapeHtml(flag)}</code></li>`).join('')}</ul>`;
}

function renderSources(sources) {
  if (!sources || sources.length === 0) return '<span class="muted">none</span>';
  return `<ul class="compact-list">${sources.map((source) => `<li><code>${escapeHtml(source)}</code></li>`).join('')}</ul>`;
}

function renderExitCodes(exitCodes) {
  if (!exitCodes) return '<span class="muted">none</span>';
  return `<dl class="exit-code-list">${Object.entries(exitCodes)
    .map(([name, code]) => `<div><dt>${escapeHtml(name)}</dt><dd><code>${escapeHtml(code)}</code></dd></div>`)
    .join('')}</dl>`;
}

function renderStatus(value) {
  const className = value === 'unsupported'
    ? 'unsupported'
    : value === 'live-guarded'
      ? 'live-guarded'
      : 'local';
  return `<span class="status-pill ${className}">${escapeHtml(value)}</span>`;
}

function renderCommandRow(command) {
  return [
    '<tr>',
    `<td><code>${escapeHtml(command.command)}</code><div class="command-id">${escapeHtml(command.id)}</div></td>`,
    `<td>${escapeHtml(command.group || 'unsupported')}</td>`,
    `<td>${escapeHtml(command.mode)}</td>`,
    `<td>${renderStatus(command.status)}</td>`,
    `<td>${escapeHtml(command.apiAccess)}</td>`,
    `<td>${escapeHtml(command.schemaVersion || 'n/a')}</td>`,
    `<td>${escapeHtml(command.description || command.refusal || '')}</td>`,
    `<td>${renderFlagList(command.requiredFlags)}</td>`,
    `<td>${renderFlagList(command.optionalFlags)}</td>`,
    `<td>${renderExitCodes(command.exitCodes)}</td>`,
    `<td>${renderSources(command.sources)}</td>`,
    '</tr>',
  ].join('');
}

function renderUnsupportedRow(command) {
  return [
    '<tr>',
    `<td><code>${escapeHtml(command.command)}</code><div class="command-id">${escapeHtml(command.id)}</div></td>`,
    `<td>${escapeHtml(command.mode)}</td>`,
    `<td>${renderStatus(command.status)}</td>`,
    `<td>${escapeHtml(command.apiAccess)}</td>`,
    `<td>${escapeHtml(command.refusal)}</td>`,
    '</tr>',
  ].join('');
}

function countBy(commands, field) {
  return commands.reduce((counts, command) => {
    const key = command[field] || 'unknown';
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function renderSummaryCards(reference) {
  const groups = countBy(reference.commands, 'group');
  const modes = countBy(reference.commands, 'mode');
  const liveGuardedCount = reference.commands.filter((command) => command.status === 'live-guarded').length;
  return [
    `<article><span>Supported commands</span><strong>${reference.commands.length}</strong></article>`,
    `<article><span>Live-guarded commands</span><strong>${liveGuardedCount}</strong></article>`,
    `<article><span>Unsupported guarded commands</span><strong>${reference.unsupportedCommands.length}</strong></article>`,
    `<article><span>Command groups</span><strong>${Object.keys(groups).length}</strong></article>`,
    `<article><span>Modes</span><strong>${Object.keys(modes).sort().map(escapeHtml).join(', ')}</strong></article>`,
  ].join('');
}

function renderReferenceJumps(reference) {
  const sections = reference.sectionNavigation || [];
  if (!sections.length) return '';
  return `<nav class="reference-jumps" aria-label="Command reference sections">
          <strong>Page index</strong>
          ${sections.map((section) => `<a href="${escapeHtml(section.href)}"><span>${escapeHtml(section.label)}</span><small>${escapeHtml(section.description)}</small></a>`).join('\n          ')}
        </nav>`;
}

function renderCommandReferenceHtml(reference, options = {}) {
  const stylesheetHref = options.stylesheetHref || 'styles.css';
  const indexHref = options.indexHref || 'index.html';
  const commands = reference.commands || [];
  const unsupportedCommands = reference.unsupportedCommands || [];

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Metronome CLI Command Reference</title>
    <meta name="description" content="Generated command and output contract reference for the Metronome CLI.">
${renderBrandHeadLinks(options)}
    <link rel="stylesheet" href="${escapeHtml(stylesheetHref)}">
  </head>
  <body class="generated-reference">
    <main class="generated-shell">
      <header class="generated-header">
        ${renderGeneratedBrand({ ...options, indexHref })}
        <a href="${escapeHtml(indexHref)}">Back to operating manual</a>
        <p class="eyebrow">Generated from ${escapeHtml(reference.generatedFrom)}</p>
        <h1>Metronome CLI command reference</h1>
        <p>This page is generated from the same command catalog used by <code>metro docs command-reference --json</code> and <code>metro schema --json</code>.</p>
        ${renderReferenceJumps(reference)}
        <div id="command-summary" class="summary-grid">${renderSummaryCards({ commands, unsupportedCommands })}</div>
      </header>

      <section id="supported-local-commands" class="generated-section">
        <h2>Supported Commands</h2>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Command</th>
                <th>Group</th>
                <th>Mode</th>
                <th>Status</th>
                <th>API access</th>
                <th>Schema</th>
                <th>Description</th>
                <th>Required flags</th>
                <th>Optional flags</th>
                <th>Exit codes</th>
                <th>Sources</th>
              </tr>
            </thead>
            <tbody>
              ${commands.map(renderCommandRow).join('\n              ')}
            </tbody>
          </table>
        </div>
      </section>

      <section id="unsupported-commands" class="generated-section">
        <h2>Unsupported Commands</h2>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Command</th>
                <th>Mode</th>
                <th>Status</th>
                <th>API access</th>
                <th>Refusal</th>
              </tr>
            </thead>
            <tbody>
              ${unsupportedCommands.map(renderUnsupportedRow).join('\n              ')}
            </tbody>
          </table>
        </div>
      </section>
    </main>
${renderSiteScript(options)}
  </body>
</html>
`;
}

module.exports = {
  renderCommandReferenceHtml,
};
