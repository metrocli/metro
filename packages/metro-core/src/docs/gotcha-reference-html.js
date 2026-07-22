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

function renderSummaryCards(cards) {
  return cards
    .map((card) => `<article><span>${escapeHtml(card.label)}</span><strong>${escapeHtml(card.value)}</strong></article>`)
    .join('');
}

function renderReferenceJumps(reference) {
  const sections = reference.sectionNavigation || [];
  if (!sections.length) return '';
  return `<nav class="reference-jumps" aria-label="Gotcha reference sections">
          <strong>Page index</strong>
          ${sections.map((section) => `<a href="${escapeHtml(section.href)}"><span>${escapeHtml(section.label)}</span><small>${escapeHtml(section.description)}</small></a>`).join('\n          ')}
        </nav>`;
}

function renderStatus(value) {
  const className = value === 'open-question' ? 'unsupported' : 'local';
  return `<span class="status-pill ${className}">${escapeHtml(value)}</span>`;
}

function renderCodeList(values) {
  if (!values || values.length === 0) return '<span class="muted">none</span>';
  return `<ul class="compact-list">${values.map((value) => `<li><code>${escapeHtml(value)}</code></li>`).join('')}</ul>`;
}

function renderRuleList(gotcha) {
  if (!gotcha.rules || gotcha.rules.length === 0) return renderCodeList(gotcha.ruleIds);
  return `<ul class="compact-list">${gotcha.rules.map((rule) => (
    `<li><code>${escapeHtml(rule.id)}</code> ${escapeHtml(rule.title)} <span class="muted">(${escapeHtml(rule.severity)})</span></li>`
  )).join('')}</ul>`;
}

function renderGotchaRow(gotcha) {
  const openWork = gotcha.coverageStatus === 'open-question' || gotcha.coverageStatus === 'partial'
    ? renderCodeList(gotcha.plannedRuleIds)
    : '<span class="muted">none</span>';

  return [
    '<tr>',
    `<td><code>${escapeHtml(gotcha.id)}</code></td>`,
    `<td>${escapeHtml(gotcha.category)}</td>`,
    `<td>${renderStatus(gotcha.coverageStatus)}</td>`,
    `<td>${escapeHtml(gotcha.gotcha)}<p class="muted">${escapeHtml(gotcha.notes)}</p></td>`,
    `<td>${renderRuleList(gotcha)}</td>`,
    `<td>${renderCodeList(gotcha.commandIds)}</td>`,
    `<td>${openWork}</td>`,
    '</tr>',
  ].join('');
}

function renderGotchaReferenceHtml(reference, options = {}) {
  const stylesheetHref = options.stylesheetHref || 'styles.css';
  const indexHref = options.indexHref || 'index.html';
  const statusSummary = Object.entries(reference.summary.coverageStatusCounts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([status, count]) => `${status}: ${count}`)
    .join(', ');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Metronome CLI Gotcha Coverage Reference</title>
    <meta name="description" content="Generated gotcha-to-rule coverage reference for the Metronome CLI.">
${renderBrandHeadLinks(options)}
    <link rel="stylesheet" href="${escapeHtml(stylesheetHref)}">
  </head>
  <body class="generated-reference">
    <main class="generated-shell">
      <header class="generated-header">
        ${renderGeneratedBrand({ ...options, indexHref })}
        <a href="${escapeHtml(indexHref)}">Back to operating manual</a>
        <p class="eyebrow">Generated from ${escapeHtml(reference.generatedFrom)}</p>
        <h1>Metronome CLI gotcha coverage reference</h1>
        <p>Each known failure mode is mapped to an executable validator, a local command contract, or an explicit open question.</p>
        ${renderReferenceJumps(reference)}
        <div id="gotcha-summary" class="summary-grid">${renderSummaryCards([
    { label: 'Gotchas', value: reference.summary.gotchaCount },
    { label: 'Coverage', value: statusSummary },
    { label: 'Source register', value: reference.sourceRegister },
    { label: 'Live API access', value: 'none' },
  ])}</div>
      </header>

      <section id="gotcha-coverage" class="generated-section">
        <h2>Gotcha Coverage</h2>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Gotcha</th>
                <th>Category</th>
                <th>Status</th>
                <th>Risk</th>
                <th>Executable rules</th>
                <th>Command contracts</th>
                <th>Open work</th>
              </tr>
            </thead>
            <tbody>
              ${reference.gotchas.map(renderGotchaRow).join('\n              ')}
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
  renderGotchaReferenceHtml,
};
