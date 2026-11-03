#!/usr/bin/env node
'use strict';

/**
 * Rewrite metro's Metronome-upstream inventory from docs.metronome.com/changelog.md
 * (requires network with --fetch) or from an existing local copy.
 *
 * Coverage notes are keyed by changelog title and preserved across refreshes
 * when the title still exists. New titles land as coverageStatus=unknown until
 * edited in COVERAGE below (or patched in the JSON).
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.resolve(__dirname, '..');
const JSON_PATH = path.join(ROOT, 'docs/metronome-cli/site/metronome-upstream.json');
const MD_PATH = path.join(ROOT, 'docs/metronome-cli/METRONOME_UPSTREAM_CHANGELOG.md');
const HTML_PATH = path.join(ROOT, 'docs/metronome-cli/site/metronome-upstream.html');
const SOURCE = 'https://docs.metronome.com/changelog';
const SOURCE_MD = 'https://docs.metronome.com/changelog.md';

/** @type {Record<string, { status: string, metro: string, catalog?: string[] }>} */
const COVERAGE = {
  "Daily recurring credits and commits are supported": {
    status: "partial",
    metro: "Catalog/shapes cover recurring commits generally; daily cadence (`commit_duration` / recurrence unit daily) not yet called out in QUICKSTART or shape prose. Re-curl create/edit docs before using daily.",
    catalog: [
      "contracts.create",
      "contracts.edit"
    ]
  },
  "Configurable rounding for prorated subscriptions and recurring commits": {
    status: "gap",
    metro: "No shape/validator/docs yet for proration rounding fields. Curl subscription + recurring commit API docs before first use.",
    catalog: []
  },
  "Richer responses from `createContract` and `editContract`": {
    status: "accounted",
    metro: "Catalog sources point at create/edit docs. Metro still requires expected-vs-actual re-read after apply (richer response does not replace proof).",
    catalog: [
      "contracts.create",
      "contracts.edit"
    ]
  },
  "Metronome Java SDK is now available": {
    status: "n/a-sdk",
    metro: "Metro is Node CLI; Java SDK not used.",
    catalog: []
  },
  "Q1 usability updates: quality of life improvements": {
    status: "n/a-ui",
    metro: "UI-only QoL; no API shape impact.",
    catalog: []
  },
  "Assign RBAC roles to API tokens": {
    status: "accounted",
    metro: "Token scope matters for operator mode + keys. Documented under platform RBAC link; prefer reader tokens with `metro mode set read-only`.",
    catalog: []
  },
  "Package contract transitions and credit rollover improvements": {
    status: "accounted",
    metro: "Package transitions and `rollover_fraction` used in preview/contract-move shapes and skills.",
    catalog: [
      "packages.create",
      "contracts.create",
      "contracts.edit"
    ]
  },
  "NetSuite integration (Public Beta)": {
    status: "n/a",
    metro: "Invoices via Stripe, not NetSuite.",
    catalog: []
  },
  "Dark mode": {
    status: "n/a-ui",
    metro: "UI only.",
    catalog: []
  },
  "SDK releases": {
    status: "n/a-sdk",
    metro: "Track only when release notes imply API schema breakers (e.g. removed `priority`). Metro catalog is hand-curated.",
    catalog: []
  },
  "New SDK releases": {
    status: "n/a-sdk",
    metro: "Track only when release notes imply API schema breakers (e.g. removed `priority`). Metro catalog is hand-curated.",
    catalog: []
  },
  "Compound group keys in usage breakdowns": {
    status: "partial",
    metro: "`usage.groups` is in api-catalog; compound group key constraint and page-size 100 not yet in validator prose/QUICKSTART.",
    catalog: [
      "usage.groups"
    ]
  },
  "Archive packages": {
    status: "accounted",
    metro: "`packages.archive` in api-catalog + validators.",
    catalog: [
      "packages.archive"
    ]
  },
  "New Metronome UI": {
    status: "n/a-ui",
    metro: "UI only.",
    catalog: []
  },
  "Change end date on advance, prorated subscriptions": {
    status: "partial",
    metro: "Subscription end-date edits exist via contract/subscription edit paths; advance-prorated edge case not a dedicated gotcha yet.",
    catalog: [
      "contracts.edit"
    ]
  },
  "Stripe invoice PDFs available in UI and API": {
    status: "partial",
    metro: "Matrix notes invoice PDF GET path in conventions; not a first-class `metro` shortcut. Prefer Stripe dashboard or guarded invoice get when needed.",
    catalog: [
      "invoices.get"
    ]
  },
  "Subscription and invoice line item linking improvements": {
    status: "partial",
    metro: "`subscription_id` on line items / Stripe metadata — useful for reconcile; not yet a metro proof field.",
    catalog: [
      "invoices.get",
      "invoices.listForCustomer"
    ]
  },
  "Create contracts from packages in the UI": {
    status: "n/a-ui",
    metro: "API path already covered (`packages` + `contracts.create`). UI convenience only.",
    catalog: [
      "contracts.create"
    ]
  },
  "In-app embedded dashboards": {
    status: "n/a-ui",
    metro: "UI reporting; use metro + exports.",
    catalog: []
  },
  "Get net balance API": {
    status: "gap",
    metro: "Verified in endpoint-matrix (`POST /v1/contracts/customerBalances/getNetBalance`) but **not** yet a reviewed api-catalog ID / `metro api read` shape. Prefer over paginating balances when consolidating.",
    catalog: []
  },
  "Edit net payment terms on contracts": {
    status: "accounted",
    metro: "Preview supports `net_payment_terms_days`; edit history still required for audit.",
    catalog: [
      "contracts.edit"
    ]
  },
  "Major version SDK release": {
    status: "partial",
    metro: "Breaking: removed `use_list_prices` from Rate objects — ensure rate-card payloads/validators do not emit it.",
    catalog: [
      "rateCards.addRates",
      "rateCards.getRates"
    ]
  },
  "Self-serve access to Metronome": {
    status: "n/a-ui",
    metro: "Onboarding UI.",
    catalog: []
  },
  "Billing configuration API endpoints now return response bodies": {
    status: "accounted",
    metro: "Billing-provider set/archive in catalog; responses expected in sandbox-proof paths.",
    catalog: [
      "customers.setBillingProviderConfigurations",
      "customers.archiveBillingProviderConfigurations"
    ]
  },
  "High cardinality group key spend alerts": {
    status: "n/a",
    metro: "Alerts not in metro core day-to-day.",
    catalog: []
  },
  "Launch week recap: Monetization Infrastructure for AI": {
    status: "n/a-ui",
    metro: "Marketing recap; follow linked product guides when relevant.",
    catalog: []
  },
  "Invoicing with Google Cloud Marketplace": {
    status: "n/a",
    metro: "Uses Stripe billing.",
    catalog: []
  },
  "September fixes and improvements": {
    status: "partial",
    metro: "Spot-check API subsection against edit/billing-provider sources when touching those shapes.",
    catalog: [
      "contracts.edit"
    ]
  },
  "Make advanced contract overrides in the Metronome app": {
    status: "n/a-ui",
    metro: "UI for overrides; API overrides remain via `contracts.edit`.",
    catalog: [
      "contracts.edit"
    ]
  },
  "Custom Reports": {
    status: "n/a-ui",
    metro: "In-app reports.",
    catalog: []
  },
  "Customer Lifecycle Notifications": {
    status: "n/a",
    metro: "Notifications not operated via metro today.",
    catalog: []
  },
  "New documentation experience": {
    status: "accounted",
    metro: "Sources use docs.metronome.com `.md` URLs + llms.txt. This tracker is the metro-side sync surface.",
    catalog: []
  },
  "August fixes and improvements": {
    status: "partial",
    metro: "Historical API fixes (billing config updates via edit, etc.) — reflected in danger-zone / stripe-delivery skills.",
    catalog: [
      "contracts.edit"
    ]
  },
  "Invoice breakdowns in Data Export": {
    status: "partial",
    metro: "`invoices.listBreakdowns` in catalog; data-export tables are separate.",
    catalog: [
      "invoices.listBreakdowns"
    ]
  },
  "July fixes and improvements": {
    status: "partial",
    metro: "API notes (searchEvents, commits) — events.search / commits paths in catalog.",
    catalog: [
      "events.search",
      "commits.list"
    ]
  },
  "Use group keys to set budgets across users, teams, and projects": {
    status: "n/a",
    metro: "Spend controls/alerts — not metro day-to-day.",
    catalog: []
  },
  "Seat-based credit pools": {
    status: "partial",
    metro: "Seat / credit pool shapes in skills; not a QUICKSTART one-liner.",
    catalog: [
      "contracts.edit"
    ]
  },
  "Embeddable dashboard for credit and commit balances": {
    status: "n/a-ui",
    metro: "Embeddable UI; metro uses balances list / (future) getNetBalance.",
    catalog: [
      "customerBalances.list"
    ]
  },
  "Threshold billing and auto-recharge": {
    status: "partial",
    metro: "Spend/prepaid thresholds via contract edit — danger-zone aware; not a dedicated metro shortcut.",
    catalog: [
      "contracts.edit"
    ]
  },
  "Set up multi-entity billing": {
    status: "partial",
    metro: "Account hierarchy / billing config — skills note hierarchy; careful with Stripe entity.",
    catalog: [
      "customers.setBillingProviderConfigurations"
    ]
  },
  "Scope credits and commits to specific pricing or presentation group values": {
    status: "partial",
    metro: "Specifier / dimensional scoping; keep sources current.",
    catalog: [
      "contracts.edit",
      "rateCards.addRates"
    ]
  },
  "Edit recurring commits and credits": {
    status: "accounted",
    metro: "Recurring edit via contracts.edit / commit edit docs in skills.",
    catalog: [
      "contracts.edit"
    ]
  },
  "Support for seat-based subscription billing": {
    status: "partial",
    metro: "Seat subscriptions in skills; most packages are credit+plan fee shaped.",
    catalog: [
      "contracts.create",
      "contracts.edit"
    ]
  },
  "April fixes and improvements": {
    status: "partial",
    metro: "Historical; verify touched endpoints against current `.md` sources.",
    catalog: []
  },
  "Remove overrides and archive commits and scheduled charges": {
    status: "accounted",
    metro: "editContract archive/remove paths documented in danger-zone.",
    catalog: [
      "contracts.edit"
    ]
  },
  "Support for NZD and SGD currencies": {
    status: "n/a",
    metro: "Standard currency amounts.",
    catalog: []
  },
  "Ruby SDK": {
    status: "n/a-sdk",
    metro: "SDK only.",
    catalog: []
  },
  "Updated UI for creating and editing contracts, customer-level commits, and customer-level credits": {
    status: "n/a-ui",
    metro: "UI only.",
    catalog: []
  },
  "Edit rates in the Rate Card UI": {
    status: "n/a-ui",
    metro: "API: addRates/getRates in catalog.",
    catalog: [
      "rateCards.addRates"
    ]
  },
  "Usage threshold alerts supported on Contracts": {
    status: "n/a",
    metro: "Alerts out of metro day-to-day.",
    catalog: []
  },
  "Contract editing": {
    status: "accounted",
    metro: "`contracts.edit` + danger-zone editContract support matrix.",
    catalog: [
      "contracts.edit"
    ]
  },
  "Support for weekly frequencies for billing, recurring commits, and credits": {
    status: "partial",
    metro: "Cadence fields exist; weekly not a common shape.",
    catalog: [
      "contracts.create",
      "contracts.edit"
    ]
  },
  "In Tempo: Spring 2025 changelog": {
    status: "partial",
    metro: "Large release note — recurring commits, uniqueness keys, invoice breakdowns, updateEndDate guard already reflected across matrix/catalog/skills.",
    catalog: [
      "contracts.create",
      "contracts.edit",
      "contracts.updateEndDate",
      "invoices.listBreakdowns",
      "customerBalances.list"
    ]
  },
  "Metronome 2.0": {
    status: "accounted",
    metro: "Metro is built on Metronome 2.0 contracts/rate-cards/packages model.",
    catalog: []
  },
  "In Tempo: Fall 2024": {
    status: "partial",
    metro: "voidInvoice etc. in catalog; plan-era APIs are historical.",
    catalog: [
      "invoices.void"
    ]
  },
  "In Tempo: Spring 2024": {
    status: "n/a-ui",
    metro: "Mostly pre-2.0/plan-era; do not copy paths into new workflows without matrix check.",
    catalog: []
  }
};

function absUrl(u) {
  const trimmed = String(u || '').trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith('/')) return `https://docs.metronome.com${trimmed}`;
  return `https://docs.metronome.com/${trimmed.replace(/^\//, '')}`;
}

function fetchText(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'User-Agent': 'metro-cli-docs-upstream-generate/1.0' } }, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          fetchText(res.headers.location).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} for ${url}`));
          return;
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      })
      .on('error', reject);
  });
}

function parseChangelog(markdown) {
  const parts = markdown.split(/(?=<Update\s+label=)/);
  const entries = [];
  for (const part of parts.slice(1)) {
    const m = part.match(/^<Update\s+label="([^"]+)"(?:\s+tags=\{\[([^\]]*)\]\})?>/);
    if (!m) continue;
    const date = m[1];
    const tags = [...(m[2] || '').matchAll(/"([^"]+)"/g)].map((x) => x[1]);
    const titleM = part.match(/##\s+(.+)/);
    const title = titleM ? titleM[1].trim() : '?';
    let body = part;
    const end = body.indexOf('</Update>');
    if (end !== -1) body = body.slice(0, end);
    const links = [];
    const seen = new Set();
    for (const lm of body.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)) {
      const label = lm[1].trim();
      const url = absUrl(lm[2]);
      const key = `${label}::${url}`;
      if (seen.has(key)) continue;
      seen.add(key);
      links.push({ label, url });
    }
    const prior = COVERAGE[title] || {
      status: 'unknown',
      metro: 'Not yet classified - curl linked docs and update COVERAGE in this script.',
      catalog: [],
    };
    entries.push({
      date,
      tags,
      title,
      links,
      coverageStatus: prior.status,
      metroNotes: prior.metro,
      catalogIds: prior.catalog || [],
      changelogAnchor: SOURCE,
    });
  }
  return entries;
}

function renderMarkdown(inventory) {
  const lines = [];
  lines.push('# Metronome upstream changelog - metro coverage');
  lines.push('');
  lines.push(`Source of truth (official): [${inventory.source}](${inventory.source})`);
  lines.push(`Machine-readable markdown: [${inventory.sourceMarkdown}](${inventory.sourceMarkdown})`);
  lines.push(
    'Docs index: [https://docs.metronome.com/llms.txt](https://docs.metronome.com/llms.txt)',
  );
  lines.push('');
  lines.push(
    `Last synced into metro: **${inventory.syncedAt}** (\`docs/metronome-cli/site/metronome-upstream.json\`).`,
  );
  lines.push('');
  lines.push('Metro does **not** auto-ingest OpenAPI. This page is the checklist that keeps');
  lines.push('shapes, the endpoint matrix, and `api-catalog` honest when Metronome ships changes.');
  lines.push('');
  lines.push('## How to refresh');
  lines.push('');
  lines.push('```bash');
  lines.push('npm run docs:upstream:check');
  lines.push('npm run docs:upstream:check -- --fetch');
  lines.push('node scripts/generate-metronome-upstream.js --fetch');
  lines.push('```');
  lines.push('');
  lines.push('When `--fetch` reports new entries: curl every linked official `.md` page,');
  lines.push('update `skills/metronome-danger-zone/references/endpoint-matrix.md` and/or');
  lines.push('`packages/metro-core/src/api-catalog/index.js` + shapes/validators, classify the');
  lines.push('new title in `scripts/generate-metronome-upstream.js` (COVERAGE map), re-run');
  lines.push('this generator, and regenerate goldens/site if catalog output changed.');
  lines.push('');
  lines.push('## Coverage legend');
  lines.push('');
  lines.push('| Status | Meaning |');
  lines.push('|---|---|');
  lines.push('| `accounted` | Metro catalog/skills/docs already cover the behavior |');
  lines.push('| `partial` | Related coverage exists; missing gotcha, shortcut, or validator prose |');
  lines.push('| `gap` | API-relevant and not yet represented - fix before relying on the feature |');
  lines.push('| `n/a` | Not an applicable metro operating surface |');
  lines.push('| `n/a-sdk` / `n/a-ui` | SDK or UI-only; no metro shape work unless API fields change |');
  lines.push('');
  lines.push('## Gaps that need follow-up');
  lines.push('');
  for (const e of inventory.entries) {
    if (e.coverageStatus === 'gap') {
      lines.push(`- **GAP** ${e.date} - ${e.title}: ${e.metroNotes}`);
    }
  }
  for (const e of inventory.entries) {
    if (e.coverageStatus === 'partial' && e.tags.includes('API')) {
      lines.push(`- **Partial** ${e.date} - ${e.title}: ${e.metroNotes}`);
    }
  }
  lines.push('');
  lines.push('## Batch / large requests (smart paths)');
  lines.push('');
  lines.push(
    'Official guides: [high-volume ingestion](https://docs.metronome.com/guides/events/high-volume-ingestion),',
  );
  lines.push(
    '[send usage events](https://docs.metronome.com/guides/events/send-usage-events),',
  );
  lines.push(
    '[API quickstart](https://docs.metronome.com/guides/get-started/api-quickstart).',
  );
  lines.push('');
  lines.push('| Need | Smart path in metro | Do not |');
  lines.push('|---|---|---|');
  lines.push(
    '| Full package inventory | `metro package list --sandbox` or `--prod` (follows `next_page`) | Single-page `api read` and assume page = tenant |',
  );
  lines.push(
    '| Who is on a package | `metro package customers --package <id or alias>` | Manual contracts-on-package loops without page follow |',
  );
  lines.push(
    '| Many plan moves | `metro contract move-plan bulk-preflight` then `bulk-apply` with `--delay-ms` / `--limit` canary | Parallel writers across the fleet |',
  );
  lines.push(
    '| New action code on all cards | `metro dimensional new-code --all ...` | Hand-rolled per-card scripts |',
  );
  lines.push(
    '| Usage aggregates (multi-customer) | Reviewed `usage.batch` + query `next_page` | Stuffing pagination into POST body |',
  );
  lines.push(
    '| Usage by dimensions | `usage.groups` (compound keys only if BM defines them; max page 100) | Grouping by multiple simple keys |',
  );
  lines.push(
    '| Combined credit+commit balance | Prefer **getNetBalance** once catalogued; until then balances list + pagination | N+1 per commit without a reason |',
  );
  lines.push(
    '| Ingest | Batches ≤100 events; stable transaction IDs; retry client on 429 | Firehose without backoff |',
  );
  lines.push('| Rate append | `addRates` ≤100 rows per call | Mega payloads |');
  lines.push(
    '| Audit log export | `metro audit export plan` documents pagination; live pull is gated | Unbounded concurrent page fetches |',
  );
  lines.push('');
  lines.push('Pagination rule (current API): for nearly all modern list endpoints,');
  lines.push('`limit` and `next_page` belong in the **URL query string**, not the POST body.');
  lines.push(
    '(Older local notes that said “send next_page in the body” are wrong for packages,',
  );
  lines.push(
    'getRates, usage.groups/batch, contracts-on-package, etc. - validators enforce query.)',
  );
  lines.push('');
  lines.push('Retry: metro uses `metronome-retry-client` (429/5xx backoff).');
  lines.push('Still prefer serial pagination + bulk `--delay-ms` over high concurrency.');
  lines.push('');
  lines.push('## Full inventory (every official entry)');
  lines.push('');

  for (const e of inventory.entries) {
    lines.push(`### ${e.date} - ${e.title}`);
    lines.push('');
    if (e.tags.length) {
      lines.push(`Tags: ${e.tags.join(', ')}`);
      lines.push('');
    }
    lines.push(`**Metro coverage:** \`${e.coverageStatus}\` - ${e.metroNotes}`);
    lines.push('');
    if (e.catalogIds.length) {
      lines.push(`Catalog IDs: ${e.catalogIds.map((c) => `\`${c}\``).join(', ')}`);
      lines.push('');
    }
    if (e.links.length) {
      lines.push('Official links:');
      lines.push('');
      for (const link of e.links) {
        lines.push(`- [${link.label}](${link.url})`);
      }
      lines.push('');
    } else {
      lines.push(
        `_No deep links in the changelog body - start from [${SOURCE}](${SOURCE}) and curl the matching API/guide page via [llms.txt](https://docs.metronome.com/llms.txt)._`,
      );
      lines.push('');
    }
  }
  return `${lines.join('\n')}\n`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderHtml(inventory) {
  const gaps = inventory.entries.filter((e) => e.coverageStatus === 'gap');
  const gapLis = gaps
    .map(
      (e) =>
        `<li><strong>GAP</strong> ${escapeHtml(e.date)} - ${escapeHtml(e.title)}: ${escapeHtml(e.metroNotes)}</li>`,
    )
    .join('\n          ');
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Metronome upstream changelog - metro</title>
    <meta name="description" content="Every Metronome changelog entry with exact official links and metro coverage status, plus batch/large-request shortcuts.">
    <link rel="icon" type="image/png" href="assets/favicon-light.png" media="(prefers-color-scheme: light)">
    <link rel="icon" type="image/png" href="assets/favicon-dark.png" media="(prefers-color-scheme: dark)">
    <link rel="stylesheet" href="styles.css">
  </head>
  <body class="generated-reference">
    <main class="generated-shell">
      <header class="generated-header">
        <div class="generated-brand">
          <a class="brand-logo-link" href="index.html" aria-label="metro home">
            <img class="brand-logo brand-logo-light-mode" src="assets/favicon-light.png" alt="">
            <img class="brand-logo brand-logo-dark-mode" src="assets/favicon-dark.png" alt="">
          </a>
          <span>metro</span>
        </div>
        <a href="index.html">Back to operating manual</a>
        <p class="eyebrow">Upstream product</p>
        <h1>Metronome changelog → metro coverage</h1>
        <p>
          Official source:
          <a href="${escapeHtml(inventory.source)}">${escapeHtml(inventory.source)}</a>.
          Synced <strong>${escapeHtml(inventory.syncedAt)}</strong>
          (${inventory.entries.length} entries). Full list:
          <a href="../METRONOME_UPSTREAM_CHANGELOG.md">METRONOME_UPSTREAM_CHANGELOG.md</a>
          · <a href="metronome-upstream.json">metronome-upstream.json</a>.
        </p>
      </header>
      <section id="gaps" class="generated-section">
        <h2>Open gaps</h2>
        <ul>
          ${gapLis || '<li>None classified as gap.</li>'}
        </ul>
        <pre><code>npm run docs:upstream:check
npm run docs:upstream:check -- --fetch
node scripts/generate-metronome-upstream.js --fetch</code></pre>
      </section>
      <section id="batch" class="generated-section">
        <h2>Batch / large requests</h2>
        <p>Use metro shortcuts that already paginate or batch-bound - do not invent fleet loops.</p>
        <ul>
          <li><code>metro package list</code> - full tenant package inventory (<code>next_page</code>)</li>
          <li><code>metro package customers</code> - contracts on a package</li>
          <li><code>metro contract move-plan bulk-preflight|bulk-apply</code> - roster + <code>--delay-ms</code></li>
          <li><code>metro dimensional new-code --all</code> - fleet rate-card append</li>
          <li>Reviewed <code>usage.batch</code> / <code>usage.groups</code> - pagination in <strong>query</strong>, not body</li>
          <li>Ingest ≤100 events/batch; <code>addRates</code> ≤100 rows; retry on 429</li>
        </ul>
      </section>
    </main>
    <script src="layout.js"></script>
    <script src="nav.js"></script>
    <script src="site.js"></script>
  </body>
</html>
`;
}

async function main() {
  const doFetch = process.argv.includes('--fetch');
  let markdown;
  if (doFetch) {
    markdown = await fetchText(SOURCE_MD);
  } else if (fs.existsSync('/tmp/metronome-changelog.md')) {
    markdown = fs.readFileSync('/tmp/metronome-changelog.md', 'utf8');
  } else {
    console.error('Pass --fetch to download changelog.md (network), or place it at /tmp/metronome-changelog.md');
    process.exit(1);
  }

  const syncedAt = new Date().toISOString().slice(0, 10);
  const entries = parseChangelog(markdown);
  const inventory = {
    schemaVersion: 'metro.metronome-upstream.v1',
    source: SOURCE,
    sourceMarkdown: SOURCE_MD,
    syncedAt,
    entryCount: entries.length,
    entries,
  };

  fs.writeFileSync(JSON_PATH, `${JSON.stringify(inventory, null, 2)}\n`);
  fs.writeFileSync(MD_PATH, renderMarkdown(inventory));
  fs.writeFileSync(HTML_PATH, renderHtml(inventory));
  console.log(`Wrote ${entries.length} entries →`);
  console.log(`  ${JSON_PATH}`);
  console.log(`  ${MD_PATH}`);
  console.log(`  ${HTML_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
