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
  return `<ul class="compact-list">${values.map((value) => `<li><code>${escapeHtml(value)}</code></li>`).join('')}</ul>`;
}

function renderSources(sources) {
  return renderList(sources);
}

function renderStatus(value) {
  const className = value === 'unsupported' ? 'unsupported' : 'local';
  return `<span class="status-pill ${className}">${escapeHtml(value)}</span>`;
}

function renderSummaryCards(cards) {
  return cards
    .map((card) => `<article><span>${escapeHtml(card.label)}</span><strong>${escapeHtml(card.value)}</strong></article>`)
    .join('');
}

function renderReferenceJumps(reference, label) {
  const sections = reference.sectionNavigation || [];
  if (!sections.length) return '';
  return `<nav class="reference-jumps" aria-label="${escapeHtml(label)}">
          <strong>Page index</strong>
          ${sections.map((section) => `<a href="${escapeHtml(section.href)}"><span>${escapeHtml(section.label)}</span><small>${escapeHtml(section.description)}</small></a>`).join('\n          ')}
        </nav>`;
}

function ruleSummary(ruleIds, rulesById) {
  return (ruleIds || []).map((id) => {
    const rule = rulesById[id];
    if (!rule) return `<li><code>${escapeHtml(id)}</code></li>`;
    return `<li><code>${escapeHtml(id)}</code> ${escapeHtml(rule.title)} <span class="muted">(${escapeHtml(rule.severity)})</span></li>`;
  }).join('');
}

function renderBlockedModes(blockedModes) {
  const entries = Object.entries(blockedModes || {});
  if (!entries.length) return '<span class="muted">none</span>';
  return `<dl class="exit-code-list">${entries
    .map(([mode, reason]) => `<div><dt>${escapeHtml(mode)}</dt><dd>${escapeHtml(reason)}</dd></div>`)
    .join('')}</dl>`;
}

function renderShapeCard(shape, rulesById) {
  return `<article class="reference-card">
          <h2>${escapeHtml(shape.title)}</h2>
          <p><code>${escapeHtml(shape.id)}</code> ${renderStatus(shape.maturity)}</p>
          <p>${escapeHtml(shape.purpose)}</p>
          <div class="reference-columns">
            <section>
              <h3>Required input</h3>
              ${renderList(shape.requiredInput)}
            </section>
            <section>
              <h3>Supported modes</h3>
              ${renderList(shape.supportedModes)}
            </section>
            <section>
              <h3>Blocked modes</h3>
              ${renderBlockedModes(shape.blockedModes)}
            </section>
            <section>
              <h3>Validator rules</h3>
              <ul class="compact-list">${ruleSummary(shape.validatorRuleIds, rulesById)}</ul>
            </section>
          </div>
          <h3>Sources</h3>
          ${renderSources(shape.sources)}
        </article>`;
}

function renderShapeReferenceHtml(reference, options = {}) {
  const stylesheetHref = options.stylesheetHref || 'styles.css';
  const indexHref = options.indexHref || 'index.html';
  const families = [...new Set(reference.shapes.map((shape) => shape.family))].sort();
  const maturities = [...new Set(reference.shapes.map((shape) => shape.maturity))].sort();

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Metronome CLI Shape Reference</title>
    <meta name="description" content="Generated shape catalog reference for the Metronome CLI.">
${renderBrandHeadLinks(options)}
    <link rel="stylesheet" href="${escapeHtml(stylesheetHref)}">
  </head>
  <body class="generated-reference">
    <main class="generated-shell">
      <header class="generated-header">
        ${renderGeneratedBrand({ ...options, indexHref })}
        <a href="${escapeHtml(indexHref)}">Back to operating manual</a>
        <p class="eyebrow">Generated from ${escapeHtml(reference.generatedFrom)}</p>
        <h1>Metronome CLI shape reference</h1>
        <p>Each shape is a workflow surface with local maturity, required input, blocked modes, validator rules, and source links.</p>
        ${renderReferenceJumps(reference, 'Shape reference sections')}
        <div id="shape-summary" class="summary-grid">${renderSummaryCards([
    { label: 'Shapes', value: reference.shapes.length },
    { label: 'Families', value: families.length },
    { label: 'Maturity levels', value: maturities.join(', ') },
    { label: 'Live API access', value: 'none' },
  ])}</div>
      </header>

      <section id="shape-catalog" class="generated-section reference-stack">
        ${reference.shapes.map((shape) => renderShapeCard(shape, reference.rulesById)).join('\n        ')}
      </section>
    </main>
${renderSiteScript(options)}
  </body>
</html>
`;
}

function renderRuleRow(rule, shapeIds) {
  return [
    '<tr>',
    `<td><code>${escapeHtml(rule.id)}</code></td>`,
    `<td>${escapeHtml(rule.severity)}</td>`,
    `<td>${escapeHtml(rule.title)}</td>`,
    `<td>${escapeHtml(rule.remediation)}</td>`,
    `<td>${renderList(shapeIds)}</td>`,
    '</tr>',
  ].join('');
}

function renderValidatorReferenceHtml(reference, options = {}) {
  const stylesheetHref = options.stylesheetHref || 'styles.css';
  const indexHref = options.indexHref || 'index.html';
  const severityCounts = reference.rules.reduce((counts, rule) => {
    counts[rule.severity] = (counts[rule.severity] || 0) + 1;
    return counts;
  }, {});
  const severitySummary = Object.entries(severityCounts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([severity, count]) => `${severity}: ${count}`)
    .join(', ');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Metronome CLI Validator Reference</title>
    <meta name="description" content="Generated validator rule reference for the Metronome CLI.">
${renderBrandHeadLinks(options)}
    <link rel="stylesheet" href="${escapeHtml(stylesheetHref)}">
  </head>
  <body class="generated-reference">
    <main class="generated-shell">
      <header class="generated-header">
        ${renderGeneratedBrand({ ...options, indexHref })}
        <a href="${escapeHtml(indexHref)}">Back to operating manual</a>
        <p class="eyebrow">Generated from ${escapeHtml(reference.generatedFrom)}</p>
        <h1>Metronome CLI validator reference</h1>
        <p>These rules are the executable guardrails used by local shape validation before any API client can load.</p>
        ${renderReferenceJumps(reference, 'Validator reference sections')}
        <div id="validator-summary" class="summary-grid">${renderSummaryCards([
    { label: 'Rules', value: reference.rules.length },
    { label: 'Severities', value: severitySummary },
    { label: 'Mapped shapes', value: Object.keys(reference.shapeIdsByRuleId).length },
    { label: 'Live API access', value: 'none' },
  ])}</div>
      </header>

      <section id="validator-rules" class="generated-section">
        <h2>Validator Rules</h2>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Rule</th>
                <th>Severity</th>
                <th>Title</th>
                <th>Remediation</th>
                <th>Referenced by shapes</th>
              </tr>
            </thead>
            <tbody>
              ${reference.rules.map((rule) => renderRuleRow(rule, reference.shapeIdsByRuleId[rule.id] || [])).join('\n              ')}
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
  renderShapeReferenceHtml,
  renderValidatorReferenceHtml,
};
