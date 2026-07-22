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
  if (!values || values.length === 0) return '<span class="muted">none</span>';
  return `<ul class="compact-list">${values.map((value) => `<li>${escapeHtml(value)}</li>`).join('')}</ul>`;
}

function renderCodeList(values) {
  if (!values || values.length === 0) return '<span class="muted">none</span>';
  return `<ul class="compact-list">${values.map((value) => `<li><code>${escapeHtml(value)}</code></li>`).join('')}</ul>`;
}

function renderStatus(value) {
  const className = value === 'none' ? 'unsupported' : 'local';
  return `<span class="status-pill ${className}">${escapeHtml(value)}</span>`;
}

function renderSummaryCards(reference) {
  return [
    `<article><span>Operating topics</span><strong>${escapeHtml(reference.summary.operatingTopicCount)}</strong></article>`,
    `<article><span>Lookup kinds</span><strong>${escapeHtml(reference.summary.lookupKindCount)}</strong></article>`,
    `<article><span>Generic topics</span><strong>${escapeHtml(reference.summary.genericExplainableCount)}</strong></article>`,
    `<article><span>Live API access</span><strong>${escapeHtml(reference.summary.liveApiAccess)}</strong></article>`,
  ].join('');
}

function renderReferenceJumps(reference) {
  const sections = reference.sectionNavigation || [];
  if (!sections.length) return '';
  return `<nav class="reference-jumps" aria-label="Docs explain reference sections">
          <strong>Page index</strong>
          ${sections.map((section) => `<a href="${escapeHtml(section.href)}"><span>${escapeHtml(section.label)}</span><small>${escapeHtml(section.description)}</small></a>`).join('\n          ')}
        </nav>`;
}

function renderOperatingTopic(topic) {
  return `<article class="reference-card">
          <h2>${escapeHtml(topic.title)}</h2>
          <p><code>${escapeHtml(topic.id)}</code> ${renderStatus(topic.status)}</p>
          <p>${escapeHtml(topic.summary)}</p>
          <div class="reference-columns">
            <section>
              <h3>Explain command</h3>
              <p><code>${escapeHtml(topic.explainCommand)}</code></p>
            </section>
            <section>
              <h3>API access</h3>
              <p>${escapeHtml(topic.apiAccess)}</p>
            </section>
            <section>
              <h3>Related commands</h3>
              <p>${escapeHtml(topic.relatedCommandCount)}</p>
            </section>
          </div>
          <h3>Source IDs</h3>
          ${renderCodeList(topic.sourceIds)}
          <h3>Sources</h3>
          ${renderCodeList(topic.sources)}
        </article>`;
}

function renderLookupKindRow(kind) {
  return [
    '<tr>',
    `<td><code>${escapeHtml(kind.kind)}</code></td>`,
    `<td>${renderCodeList(kind.prefixes)}</td>`,
    `<td>${kind.unprefixedExactMatch ? 'yes' : 'no'}</td>`,
    `<td>${escapeHtml(kind.count)}</td>`,
    `<td>${renderCodeList(kind.exampleTopics)}</td>`,
    `<td>${escapeHtml(kind.description)}</td>`,
    '</tr>',
  ].join('');
}

function renderExplainReferenceHtml(reference, options = {}) {
  const stylesheetHref = options.stylesheetHref || 'styles.css';
  const indexHref = options.indexHref || 'index.html';

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Metronome CLI Docs Explain Reference</title>
    <meta name="description" content="Generated source-linked docs explain topic index for the Metronome CLI.">
${renderBrandHeadLinks(options)}
    <link rel="stylesheet" href="${escapeHtml(stylesheetHref)}">
  </head>
  <body class="generated-reference">
    <main class="generated-shell">
      <header class="generated-header">
        ${renderGeneratedBrand({ ...options, indexHref })}
        <a href="${escapeHtml(indexHref)}">Back to operating manual</a>
        <p class="eyebrow">Generated from ${escapeHtml(reference.generatedFrom.join(', '))}</p>
        <h1>Metronome CLI docs explain reference</h1>
        <p>This page is generated from <code>${escapeHtml(reference.schemaVersion)}</code>, the same local topic index used by <code>metro docs explain --list --json</code>. It keeps live execution disabled and points users to source-linked single-topic explanations.</p>
        ${renderReferenceJumps(reference)}
        <div id="explain-summary" class="summary-grid">${renderSummaryCards(reference)}</div>
      </header>

      <section id="operating-topics" class="generated-section reference-stack">
        <h2>Operating Topics</h2>
        ${reference.operatingTopics.map(renderOperatingTopic).join('\n        ')}
      </section>

      <section id="lookup-kinds" class="generated-section">
        <h2>Lookup Kinds</h2>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Kind</th>
                <th>Prefixes</th>
                <th>Unprefixed exact match</th>
                <th>Count</th>
                <th>Example topics</th>
                <th>Description</th>
              </tr>
            </thead>
            <tbody>
              ${reference.lookupKinds.map(renderLookupKindRow).join('\n              ')}
            </tbody>
          </table>
        </div>
      </section>

      <section id="source-boundary" class="generated-section">
        <h2>Source Boundary</h2>
        <div class="reference-columns">
          <section>
            <h3>API access</h3>
            <p>${escapeHtml(reference.apiAccess)}</p>
            <p>Live execution enabled: ${reference.liveExecution.enabledInCurrentCli ? 'yes' : 'no'}</p>
          </section>
          <section>
            <h3>Next safe step</h3>
            <p>${escapeHtml(reference.nextSafeStep)}</p>
          </section>
          <section>
            <h3>Source IDs</h3>
            ${renderCodeList(reference.sourceIds)}
          </section>
          <section>
            <h3>Sources</h3>
            ${renderList(reference.sources)}
          </section>
        </div>
      </section>
    </main>
${renderSiteScript(options)}
  </body>
</html>
`;
}

module.exports = {
  renderExplainReferenceHtml,
};
