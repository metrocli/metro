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

function renderSummaryCards(reference) {
  return [
    `<article><span>Formats</span><strong>${escapeHtml(reference.summary.structuredInputFormatLabel)}</strong></article>`,
    `<article><span>Extensions</span><strong>${escapeHtml(reference.summary.supportedExtensionCount)}</strong></article>`,
    `<article><span>Modes</span><strong>${reference.summary.normalizationModes.map(escapeHtml).join(', ')}</strong></article>`,
    `<article><span>Live API access</span><strong>${escapeHtml(reference.summary.liveApiAccess)}</strong></article>`,
  ].join('');
}

function renderReferenceJumps(reference) {
  const sections = reference.sectionNavigation || [];
  if (!sections.length) return '';
  return `<nav class="reference-jumps" aria-label="Input reference sections">
          <strong>Page index</strong>
          ${sections.map((section) => `<a href="${escapeHtml(section.href)}"><span>${escapeHtml(section.label)}</span><small>${escapeHtml(section.description)}</small></a>`).join('\n          ')}
        </nav>`;
}

function renderFormatCard(format) {
  return `<article class="reference-card">
          <h2>${escapeHtml(format.id)}</h2>
          <p><span class="status-pill local">${escapeHtml(format.status)}</span></p>
          <div class="reference-columns">
            <section>
              <h3>Extensions</h3>
              ${renderCodeList(format.extensions)}
            </section>
            <section>
              <h3>Parser</h3>
              <p><code>${escapeHtml(format.parser)}</code></p>
            </section>
            <section>
              <h3>Round-trip output</h3>
              <p><code>${escapeHtml(format.roundTripOutput)}</code></p>
            </section>
          </div>
          <h3>Notes</h3>
          ${renderList(format.notes)}
        </article>`;
}

function renderModeCard(mode) {
  return `<article class="reference-card">
          <h2>${escapeHtml(mode.id)}</h2>
          <p><code>${escapeHtml(mode.command)}</code></p>
          <div class="reference-columns">
            <section>
              <h3>Target</h3>
              <p>${escapeHtml(mode.targetType)}</p>
            </section>
            <section>
              <h3>Validator</h3>
              <p><code>${escapeHtml(mode.validator)}</code></p>
            </section>
            <section>
              <h3>Next evidence</h3>
              <p><code>${escapeHtml(mode.nextLocalEvidence)}</code></p>
            </section>
          </div>
          <h3>Normalized value</h3>
          <p>${escapeHtml(mode.normalizedValue)}</p>
          <h3>Sources</h3>
          ${renderCodeList(mode.sources)}
        </article>`;
}

function renderFieldRow(field) {
  return [
    '<tr>',
    `<td><code>${escapeHtml(field.name)}</code></td>`,
    `<td><code>${escapeHtml(field.type)}</code></td>`,
    `<td>${field.required ? 'yes' : 'no'}</td>`,
    `<td>${escapeHtml(field.description)}</td>`,
    '</tr>',
  ].join('');
}

function renderInputReferenceHtml(reference, options = {}) {
  const stylesheetHref = options.stylesheetHref || 'styles.css';
  const indexHref = options.indexHref || 'index.html';

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Metronome CLI Input Reference</title>
    <meta name="description" content="Generated structured input and normalization reference for the Metronome CLI.">
${renderBrandHeadLinks(options)}
    <link rel="stylesheet" href="${escapeHtml(stylesheetHref)}">
  </head>
  <body class="generated-reference">
    <main class="generated-shell">
      <header class="generated-header">
        ${renderGeneratedBrand({ ...options, indexHref })}
        <a href="${escapeHtml(indexHref)}">Back to operating manual</a>
        <p class="eyebrow">Generated from ${escapeHtml(reference.generatedFrom)}</p>
        <h1>Metronome CLI input reference</h1>
        <p>This page is generated from the local structured input and normalization modules. It documents the JSON/YAML adapters, <code>${escapeHtml(reference.outputContract.schemaVersion)}</code> output fields, round-trip guarantees, and secret-scan boundary without loading API clients.</p>
        ${renderReferenceJumps(reference)}
        <div id="input-summary" class="summary-grid">${renderSummaryCards(reference)}</div>
      </header>

      <section id="supported-formats" class="generated-section reference-stack">
        <h2>Supported Formats</h2>
        ${reference.supportedFormats.map(renderFormatCard).join('\n        ')}
      </section>

      <section id="normalization-contract" class="generated-section">
        <h2>Normalization Contract</h2>
        <div class="reference-stack">
          ${reference.normalizationModes.map(renderModeCard).join('\n          ')}
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Field</th>
                <th>Type</th>
                <th>Required</th>
                <th>Description</th>
              </tr>
            </thead>
            <tbody>
              ${reference.outputContract.outputFields.map(renderFieldRow).join('\n              ')}
            </tbody>
          </table>
        </div>
        <div class="reference-card">
          <h2>Round-trip guarantees</h2>
          <p>${escapeHtml(reference.outputContract.roundTripGuarantee)}</p>
          <p>${escapeHtml(reference.outputContract.hashGuarantee)}</p>
          <p>${escapeHtml(reference.outputContract.secretBoundary)}</p>
        </div>
      </section>

      <section id="secret-scan" class="generated-section">
        <h2>Secret Scan</h2>
        <div class="reference-columns">
          <section>
            <h3>Rule IDs</h3>
            ${renderCodeList(reference.secretScan.ruleIds)}
          </section>
          <section>
            <h3>Suppressed fields</h3>
            ${renderCodeList(reference.secretScan.blockedOutputFields)}
          </section>
          <section>
            <h3>Allowed references</h3>
            ${renderList(reference.secretScan.allowedSecretReferences)}
          </section>
          <section>
            <h3>Forbidden examples</h3>
            ${renderCodeList(reference.secretScan.forbiddenExamples)}
          </section>
        </div>
        <h3>Proof commands</h3>
        ${renderCodeList(reference.proofCommands)}
      </section>
    </main>
${renderSiteScript(options)}
  </body>
</html>
`;
}

module.exports = {
  renderInputReferenceHtml,
};
