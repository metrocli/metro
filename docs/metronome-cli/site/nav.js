'use strict';

/**
 * Single source for the operating-manual sidebar (gogcli-style: label + hint per link).
 * Mounted by site.js on pages with #site-sidebar .side-nav.
 */
(function defineMetroNav() {
  const NAV_SECTIONS = [
    {
      title: 'Start here',
      links: [
        { href: 'index.html#home', label: 'Why metro exists', hint: 'Billing window for engineers - not Metronome UI experts' },
        { href: 'index.html#try-it', label: 'Install & first command', hint: 'Install once → prove it works → no API key yet' },
        { href: 'cookbook.html', label: 'Cookbook', hint: 'Bind catalog, ops who, packages, dimensions - copy-paste for any tenant' },
        { href: 'agents.md', label: 'Agents (Markdown)', hint: 'Agent index: schema, --markdown refs, decision trees, harness' },
        { href: 'install.html', label: 'Install guide', hint: 'GitHub install, profiles, troubleshooting (including ENOTDIR)' },
        { href: 'index.html#try-it', label: 'Look up a customer', hint: 'metro ops who <paste> - plan + next safe step' },
        { href: 'index.html#try-it', label: 'Read-only vs write powers', hint: 'metro mode set read-only | read-write - sticky until you change it' },
        { href: 'index.html#live-today', label: "What's live now", hint: 'Lookups and approved changes - with confirmation brakes' },
        { href: 'install.html#guarded-live', label: 'Guarded live ops', hint: 'When you need keys, gates, and confirmation tokens' },
      ],
    },
    {
      title: 'Use with AI',
      links: [
        { href: 'agents.html', label: 'Agent harnessing guide', hint: 'Teach Claude / Cursor / Codex to use metro safely' },
        { href: 'agents.html#system-prompt', label: 'Copy system prompt', hint: 'English outcome first, then the exact commands' },
        { href: 'agents.html#recipes', label: 'Task recipes', hint: 'What happens · which command · what changes' },
        { href: 'agents.html#promote-codebase', label: 'When work is thrashing', hint: 'Say “this can be faster” and draft a PR to harden metro' },
        { href: 'index.html#agents', label: 'Claude workflow example', hint: 'Goal in English → metro validates → you decide' },
        { href: 'integration.html#contract', label: 'stdout / stderr contract', hint: 'Agents: parse stdout; refusals exit 2 on stderr' },
        { href: 'explain-reference.html', label: 'docs explain topics', hint: 'Stuck? Ask metro to explain the topic' },
      ],
    },
    {
      title: 'Common tasks',
      links: [
        { href: 'agents.html#recipe-first-preview', label: 'First dry-run (no API)', hint: 'Validate a plan shape - nothing live yet' },
        { href: 'agents.html#recipe-read-contract', label: 'Read a contract (live)', hint: 'When ops who is not enough - gated live read' },
        { href: 'agents.html#recipe-create-contract', label: 'Create contract (sandbox)', hint: 'Preview → gates → sandbox apply only' },
        { href: 'agents.html#recipe-dimensional-rates', label: 'Add an action code / rate', hint: 'Dimensional rate cards without Metronome UI' },
        { href: 'agents.html#recipe-customer-setup', label: 'Customer setup preview', hint: 'Aliases and Stripe config - local plan first' },
        { href: 'agents.html#recipe-api-discovery', label: 'Discover an endpoint', hint: 'Find the reviewed ID before guessing' },
      ],
    },
    {
      title: 'Understand metro',
      links: [
        { href: 'index.html#home', label: 'Overview', hint: 'See the change before you touch billing' },
        { href: 'index.html#quick-paths', label: 'I need to…', hint: 'Install, look up, agents, CI, endpoints' },
        { href: 'index.html#safety', label: 'Safety model', hint: 'Explicit tenant, preview before apply, no secret echo' },
        { href: 'index.html#setup', label: 'Setup & profiles', hint: 'Template, doctor, resolve - env var names only' },
        { href: 'index.html#commands', label: 'Command surface (summary)', hint: 'Local vs live-guarded vs blocked' },
      ],
    },
    {
      title: 'Workflows & shapes',
      links: [
        { href: 'index.html#shapes', label: 'Shape catalog (summary)', hint: 'Named plan shapes (pro-annual, credits, etc.)' },
        { href: 'shape-reference.html', label: 'Shape index (generated)', hint: 'Fields and validators per shape' },
        { href: 'index.html#validators', label: 'Validator rules (summary)', hint: 'Checks that catch bad input early' },
        { href: 'index.html#gotchas', label: 'Gotcha summary', hint: 'Billing traps Metronome UI hides' },
        { href: 'index.html#proof', label: 'Proof & verification', hint: 'How we know a change actually landed' },
      ],
    },
    {
      title: 'Automate & integrate',
      links: [
        { href: 'integration.html', label: 'Integration guide', hint: 'JSON contracts and CI without keys' },
        { href: 'integration.html#ci', label: 'CI-safe checks', hint: 'Install smoke, goldens, site verify' },
        { href: 'integration.html#evidence', label: 'Evidence flow', hint: 'Preview → gates → proof before apply' },
        { href: 'command-reference.html', label: 'Command index (generated)', hint: 'Every subcommand and flag' },
        { href: 'index.html#changelog', label: 'Changelog', hint: 'What changed and why it matters' },
      ],
    },
    {
      title: 'Expert API',
      links: [
        { href: 'api-reference.html', label: 'API reference', hint: 'Reviewed Metronome endpoints (advanced)' },
        { href: 'metronome-upstream.html', label: 'Upstream Metronome changelog', hint: 'Official changelog, exact links, metro coverage + batch shortcuts' },
        { href: 'api-reference.html#write-proof-ladder', label: 'Write proof ladder', hint: 'validate → preview → gate → apply' },
        { href: 'evidence-gate-reference.html', label: 'Evidence gates', hint: 'Read gates, apply gates, approvals' },
        { href: 'input-reference.html', label: 'Input reference', hint: 'JSON/YAML inputs metro accepts' },
        { href: 'index.html#commands', label: 'Live-guarded verbs', hint: 'metro api read · metro api apply' },
      ],
    },
    {
      title: 'Generated indexes',
      links: [
        { href: 'validator-reference.html', label: 'Validator index', hint: 'Rule IDs with fix text' },
        { href: 'gotcha-reference.html', label: 'Gotcha index', hint: 'Full trap map' },
        { href: 'explain-reference.html', label: 'Explain topic index', hint: 'All metro docs explain topics' },
        { href: 'sources.json', label: 'sources.json', hint: 'Machine-readable source map' },
      ],
    },
  ];

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderNavSection(section) {
    const links = section.links.map((link) => {
      return `<a class="nav-link nav-link-rich" href="${escapeHtml(link.href)}">
              <span class="nav-link-label">${escapeHtml(link.label)}</span>
              <small class="nav-link-hint">${escapeHtml(link.hint)}</small>
            </a>`;
    }).join('\n            ');
    return `<section>
            <h2>${escapeHtml(section.title)}</h2>
            ${links}
          </section>`;
  }

  function mountSidebarNav() {
    const nav = document.querySelector('#site-sidebar .side-nav');
    if (!nav || nav.dataset.mounted === 'true') return;
    nav.innerHTML = NAV_SECTIONS.map(renderNavSection).join('\n          ');
    nav.dataset.mounted = 'true';

    const currentPath = window.location.pathname.split('/').pop() || 'index.html';
    const currentHash = window.location.hash || '';
    for (const link of nav.querySelectorAll('.nav-link')) {
      const href = link.getAttribute('href') || '';
      const [path, hash] = href.split('#');
      const pathMatch = path === currentPath || (path === 'index.html' && currentPath === '');
      if (pathMatch && (hash || !currentHash)) {
        if (!hash || hash === currentHash.slice(1)) {
          link.setAttribute('aria-current', 'page');
        }
      }
    }
  }

  window.metroDocsNav = {
    NAV_SECTIONS,
    mountSidebarNav,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountSidebarNav);
  } else {
    mountSidebarNav();
  }
}());
