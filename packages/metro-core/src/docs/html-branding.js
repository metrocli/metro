'use strict';

function escapeAttribute(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function assetHref(assetBaseHref, filename) {
  const base = String(assetBaseHref || 'assets').replace(/\/+$/, '');
  return `${base}/${filename}`;
}

function renderBrandHeadLinks(options = {}) {
  const assetBaseHref = options.assetBaseHref || 'assets';
  return [
    `    <link rel="icon" type="image/png" href="${escapeAttribute(assetHref(assetBaseHref, 'favicon-light.png'))}" media="(prefers-color-scheme: light)">`,
    `    <link rel="icon" type="image/png" href="${escapeAttribute(assetHref(assetBaseHref, 'favicon-dark.png'))}" media="(prefers-color-scheme: dark)">`,
  ].join('\n');
}

function renderGeneratedBrand(options = {}) {
  const assetBaseHref = options.assetBaseHref || 'assets';
  return `<div class="generated-brand">
          <a class="brand-logo-link" href="${escapeAttribute(options.indexHref || 'index.html')}" aria-label="metro operating manual">
            <img class="brand-logo brand-logo-light-mode" src="${escapeAttribute(assetHref(assetBaseHref, 'favicon-light.png'))}" alt="metro">
            <img class="brand-logo brand-logo-dark-mode" src="${escapeAttribute(assetHref(assetBaseHref, 'favicon-dark.png'))}" alt="metro">
          </a>
          <span>Metronome in your terminal</span>
        </div>`;
}

function renderSiteScript(options = {}) {
  // layout.js wraps generated-reference pages in the operating-manual sidebar.
  const layoutHref = options.layoutScriptHref || 'layout.js';
  const navHref = options.navScriptHref || 'nav.js';
  const scriptHref = options.scriptHref || 'site.js';
  return [
    `    <script src="${escapeAttribute(layoutHref)}"></script>`,
    `    <script src="${escapeAttribute(navHref)}"></script>`,
    `    <script src="${escapeAttribute(scriptHref)}"></script>`,
  ].join('\n');
}

module.exports = {
  renderBrandHeadLinks,
  renderGeneratedBrand,
  renderSiteScript,
};
