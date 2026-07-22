'use strict';

(function initThemeToggle() {
  const toggle = document.querySelector('.theme-toggle');
  if (!toggle) return;

  function setTheme(theme) {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem('metro-docs-theme', theme);
    } catch (error) {
      // Local storage can be disabled; the in-page theme still updates.
    }
  }

  toggle.addEventListener('click', () => {
    const current = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
    setTheme(current === 'dark' ? 'light' : 'dark');
  });
}());

(function initManualSearch() {
  const input = document.querySelector('#section-search');
  const sections = Array.from(document.querySelectorAll('.manual-section'));
  const navLinks = Array.from(document.querySelectorAll('.nav-link[href^="#"]'));
  const allNavLinks = Array.from(document.querySelectorAll('.side-nav .nav-link'));
  if (!input || !sections.length) return;

  function sectionMatches(section, query) {
    if (!query) return true;
    const haystack = [
      section.id,
      section.textContent,
      section.getAttribute('data-source') || '',
    ].join(' ').toLowerCase();
    return haystack.includes(query);
  }

  function linkMatches(link, query) {
    if (!query) return true;
    return link.textContent.toLowerCase().includes(query);
  }

  function updateNavGroupVisibility() {
    const groups = Array.from(document.querySelectorAll('.side-nav section'));
    for (const group of groups) {
      const links = Array.from(group.querySelectorAll('.nav-link'));
      group.hidden = links.every((link) => link.hidden);
    }
  }

  input.addEventListener('input', () => {
    const query = input.value.trim().toLowerCase();
    const visibilityById = new Map();

    for (const section of sections) {
      const isVisible = sectionMatches(section, query);
      section.classList.toggle('is-hidden', !isVisible);
      visibilityById.set(section.id, isVisible);
    }

    for (const link of navLinks) {
      const id = link.getAttribute('href').slice(1);
      link.hidden = visibilityById.get(id) === false;
    }

    for (const link of allNavLinks) {
      if (link.getAttribute('href').startsWith('#')) continue;
      link.hidden = !linkMatches(link, query);
    }

    if (query) {
      for (const link of navLinks) {
        if (linkMatches(link, query)) link.hidden = false;
      }
    }

    updateNavGroupVisibility();
  });
}());

(function initActiveNav() {
  const navLinks = Array.from(document.querySelectorAll('.nav-link[href^="#"]'));
  const sections = navLinks
    .map((link) => document.querySelector(link.getAttribute('href')))
    .filter(Boolean);
  if (!('IntersectionObserver' in window) || !sections.length) return;

  const observer = new IntersectionObserver((entries) => {
    const visible = entries
      .filter((entry) => entry.isIntersecting)
      .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];

    if (!visible) return;

    for (const link of navLinks) {
      const isCurrent = link.getAttribute('href') === `#${visible.target.id}`;
      if (isCurrent) {
        link.setAttribute('aria-current', 'page');
      } else {
        link.removeAttribute('aria-current');
      }
    }
  }, { rootMargin: '-20% 0px -68% 0px', threshold: [0.01, 0.2, 0.6] });

  for (const section of sections) {
    observer.observe(section);
  }
}());

(function initLocalRepoCommands() {
  const repoCommandNodes = Array.from(document.querySelectorAll('[data-local-repo-command]'));
  const repoBlockNodes = Array.from(document.querySelectorAll('[data-local-repo-command-block]'));
  if (!repoCommandNodes.length && !repoBlockNodes.length) return;

  function shellQuotePath(value) {
    return `'${String(value).replace(/'/g, "'\\''")}'`;
  }

  function localRepoRootFromPage() {
    if (window.location.protocol !== 'file:') return null;
    const marker = '/docs/metronome-cli/site/';
    const pathname = decodeURIComponent(window.location.pathname);
    const markerIndex = pathname.indexOf(marker);
    if (markerIndex === -1) return null;
    return pathname.slice(0, markerIndex);
  }

  const repoRoot = localRepoRootFromPage();
  const cdCommand = repoRoot
    ? `cd ${shellQuotePath(repoRoot)}`
    : 'cd /path/to/metronome-cli';

  for (const node of repoCommandNodes) {
    const command = node.getAttribute('data-local-repo-command');
    if (!command) continue;
    const fullCommand = `${cdCommand} && ${command}`;
    node.textContent = fullCommand;
    const container = node.closest('.install-line') || node.parentElement;
    const copyButton = container?.querySelector('[data-copy-text]');
    if (copyButton) copyButton.setAttribute('data-copy-text', fullCommand);
  }

  for (const node of repoBlockNodes) {
    const lines = node.textContent.trim().split('\n');
    if (!lines.length) continue;
    if (/^cd\s+/.test(lines[0])) {
      lines[0] = cdCommand;
    } else {
      lines.unshift(cdCommand);
    }
    node.textContent = lines.join('\n');
  }
}());

(function initMobileNavigation() {
  const toggle = document.querySelector('.nav-toggle');
  const sidebar = document.querySelector('#site-sidebar');
  const backdrop = document.querySelector('.sidebar-backdrop');
  if (!toggle || !sidebar || !backdrop) return;

  function setOpen(isOpen) {
    sidebar.classList.toggle('open', isOpen);
    toggle.setAttribute('aria-expanded', String(isOpen));
    toggle.setAttribute('aria-label', isOpen ? 'Close navigation' : 'Open navigation');
    backdrop.hidden = !isOpen;
  }

  toggle.addEventListener('click', () => {
    setOpen(!sidebar.classList.contains('open'));
  });

  backdrop.addEventListener('click', () => setOpen(false));

  sidebar.addEventListener('click', (event) => {
    const link = event.target.closest('a[href^="#"]');
    if (link) setOpen(false);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') setOpen(false);
  });
}());

(function initCopyButtons() {
  async function copyText(text, button) {
    try {
      await navigator.clipboard.writeText(text);
      const original = button.textContent;
      button.textContent = 'Copied';
      window.setTimeout(() => {
        button.textContent = original;
      }, 1100);
    } catch (error) {
      button.textContent = 'Copy failed';
      window.setTimeout(() => {
        button.textContent = 'Copy';
      }, 1100);
    }
  }

  for (const button of document.querySelectorAll('[data-copy-text]')) {
    button.addEventListener('click', () => copyText(button.getAttribute('data-copy-text'), button));
  }

  for (const pre of document.querySelectorAll('pre')) {
    const code = pre.querySelector('code');
    if (!code) continue;
    // Agent system-prompt card already has a toolbar Copy.
    if (pre.closest('.agent-prompt-card')) continue;
    if (pre.parentElement?.classList.contains('code-block')) continue;

    const wrap = document.createElement('div');
    wrap.className = 'code-block';
    pre.parentNode.insertBefore(wrap, pre);
    wrap.appendChild(pre);

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'copy-pre';
    button.textContent = 'Copy';
    button.setAttribute('aria-label', 'Copy code');
    button.addEventListener('click', () => copyText(code.textContent, button));
    wrap.appendChild(button);
  }
}());
