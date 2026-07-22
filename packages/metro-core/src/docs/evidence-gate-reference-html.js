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

function renderList(values) {
  const items = (values || []).filter(Boolean);
  if (items.length === 0) return '<span class="muted">none</span>';
  return `<ul class="compact-list">${items.map((value) => `<li><code>${escapeHtml(value)}</code></li>`).join('')}</ul>`;
}

function renderCoverage(coverage) {
  return `<dl class="exit-code-list">${Object.entries(coverage)
    .map(([key, value]) => `<div><dt>${escapeHtml(key)}</dt><dd>${value ? 'yes' : 'no'}</dd></div>`)
    .join('')}</dl>`;
}

function renderEndpointList(endpoints) {
  if (!endpoints || endpoints.length === 0) return '<span class="muted">none</span>';
  return `<ul class="compact-list">${endpoints
    .map((endpoint) => `<li><code>${escapeHtml(endpoint.method)} ${escapeHtml(endpoint.path)}</code></li>`)
    .join('')}</ul>`;
}

function renderStatus(value) {
  const className = value === 'full-local-template-path' ? 'local' : 'unsupported';
  return `<span class="status-pill ${className}">${escapeHtml(value)}</span>`;
}

function renderSummaryCards(reference) {
  return [
    `<article><span>Mapped shapes</span><strong>${escapeHtml(reference.summary.shapesWithWorkflowMapping)}</strong></article>`,
    `<article><span>Full local paths</span><strong>${escapeHtml(reference.summary.fullLocalTemplatePath)}</strong></article>`,
    `<article><span>Preflight-only</span><strong>${escapeHtml(reference.summary.preflightOnly)}</strong></article>`,
    `<article><span>Live apply enabled</span><strong>${reference.applyEnabledInCurrentCli ? 'yes' : 'no'}</strong></article>`,
  ].join('');
}

function renderReferenceJumps(reference) {
  const sections = reference.sectionNavigation || [];
  if (!sections.length) return '';
  return `<nav class="reference-jumps" aria-label="Evidence gate reference sections">
          <strong>Page index</strong>
          ${sections.map((section) => `<a href="${escapeHtml(section.href)}"><span>${escapeHtml(section.label)}</span><small>${escapeHtml(section.description)}</small></a>`).join('\n          ')}
        </nav>`;
}

function renderGateCard(gate) {
  return `<article class="reference-card">
          <h2>${escapeHtml(gate.title)}</h2>
          <p><code>${escapeHtml(gate.workflow)}:${escapeHtml(gate.shape)}</code> ${renderStatus(gate.status)}</p>
          <p>Local-only: ${gate.localOnly ? 'yes' : 'no'}; API access: <code>${escapeHtml(gate.apiAccess)}</code>; live execution enabled: ${gate.liveExecutionEnabledInCurrentCli ? 'yes' : 'no'}; apply enabled: ${gate.applyEnabledInCurrentCli ? 'yes' : 'no'}.</p>
          <div class="reference-columns">
            <section>
              <h3>Template Coverage</h3>
              ${renderCoverage(gate.coverage)}
            </section>
            <section>
              <h3>Commands</h3>
              ${renderList(Object.values(gate.commands))}
            </section>
            <section>
              <h3>Endpoints</h3>
              ${renderEndpointList(gate.endpoints)}
            </section>
            <section>
              <h3>Unsupported Until</h3>
              ${renderList(gate.unsupportedUntil)}
            </section>
          </div>
          <h3>Sources</h3>
          ${renderList(gate.sources)}
        </article>`;
}

function renderEvidenceGateReferenceHtml(reference, options = {}) {
  const stylesheetHref = options.stylesheetHref || 'styles.css';
  const indexHref = options.indexHref || 'index.html';

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Metronome CLI Evidence Gate Reference</title>
    <meta name="description" content="Generated evidence gate reference for preview-only Metronome CLI write shapes.">
${renderBrandHeadLinks(options)}
    <link rel="stylesheet" href="${escapeHtml(stylesheetHref)}">
  </head>
  <body class="generated-reference">
    <main class="generated-shell">
      <header class="generated-header">
        ${renderGeneratedBrand({ ...options, indexHref })}
        <a href="${escapeHtml(indexHref)}">Back to operating manual</a>
        <p class="eyebrow">Generated from ${escapeHtml(reference.generatedFrom)}</p>
        <h1>Metronome CLI evidence gate reference</h1>
        <p>This page is generated from the shape registry and local preflight, audit, sandbox-proof, and apply-gate template builders. It documents evidence gates only; live reads and writes remain disabled.</p>
        ${renderReferenceJumps(reference)}
        <div id="evidence-gate-summary" class="summary-grid">${renderSummaryCards(reference)}</div>
      </header>

      <section id="evidence-gates" class="generated-section reference-stack">
        ${reference.gates.map(renderGateCard).join('\n        ')}
      </section>
    </main>
${renderSiteScript(options)}
  </body>
</html>
`;
}

module.exports = {
  renderEvidenceGateReferenceHtml,
};
