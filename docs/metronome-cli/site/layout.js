'use strict';

(function applySavedTheme() {
  try {
    const saved = localStorage.getItem('metro-docs-theme');
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.dataset.theme = saved || (prefersDark ? 'dark' : 'light');
  } catch (error) {
    document.documentElement.dataset.theme = 'light';
  }
}());

/**
 * Wrap generated-reference pages in the same sidebar shell as index.html.
 * ponytail: DOM injection avoids duplicating sidebar markup across 10 HTML files.
 */
(function initGeneratedReferenceLayout() {
  if (!document.body.classList.contains('generated-reference')) return;
  if (document.querySelector('#site-sidebar')) return;

  const main = document.querySelector('main.generated-shell');
  if (!main) return;

  const toggle = document.createElement('button');
  toggle.className = 'nav-toggle';
  toggle.type = 'button';
  toggle.setAttribute('aria-label', 'Open navigation');
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-controls', 'site-sidebar');
  toggle.innerHTML = '<span></span><span></span><span></span>';

  const backdrop = document.createElement('div');
  backdrop.className = 'sidebar-backdrop';
  backdrop.hidden = true;

  const shell = document.createElement('div');
  shell.className = 'shell';

  const sidebar = document.createElement('aside');
  sidebar.className = 'sidebar';
  sidebar.id = 'site-sidebar';
  sidebar.innerHTML = `
        <div class="sidebar-head">
          <a class="brand" href="index.html" aria-label="metro home">
            <span class="brand-lockup" aria-hidden="true">
              <img class="brand-logo brand-logo-light-mode" src="assets/favicon-light.png" alt="">
              <img class="brand-logo brand-logo-dark-mode" src="assets/favicon-dark.png" alt="">
            </span>
            <span class="brand-title">
              <strong>metro</strong>
              <small>Metronome in your terminal</small>
            </span>
          </a>
          <button class="theme-toggle" type="button" aria-label="Toggle color theme" title="Toggle theme">
            <svg class="theme-icon-moon" aria-hidden="true" viewBox="0 0 24 24">
              <path d="M20.2 15.7A8.3 8.3 0 0 1 8.3 3.8 8.9 8.9 0 1 0 20.2 15.7Z"></path>
            </svg>
            <svg class="theme-icon-sun" aria-hidden="true" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="4"></circle>
              <path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"></path>
            </svg>
          </button>
        </div>
        <label class="search" for="section-search">
          <span>Filter manual</span>
          <input id="section-search" type="search" placeholder="install, live read, schema, gates…">
        </label>
        <nav class="side-nav" aria-label="Manual navigation"></nav>`;

  document.body.insertBefore(toggle, document.body.firstChild);
  document.body.insertBefore(backdrop, toggle.nextSibling);
  document.body.insertBefore(shell, backdrop.nextSibling);
  shell.appendChild(sidebar);
  shell.appendChild(main);
}());
