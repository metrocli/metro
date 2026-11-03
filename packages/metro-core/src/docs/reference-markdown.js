'use strict';

/**
 * Generic Markdown renderer for metro docs * payload objects.
 * Agents prefer this over HTML. Keep one walker, do not twin the HTML shells.
 */

function exclusiveFormatError(flags = {}) {
  const chosen = ['json', 'html', 'markdown'].filter((key) => flags[key] === true);
  if (chosen.length > 1) {
    return 'Choose one output format: --json, --html, or --markdown.';
  }
  return null;
}

function mdEscapeCell(value) {
  return String(value == null ? '' : value)
    .replace(/\|/g, '\\|')
    .replace(/\n+/g, ' ')
    .trim();
}

function mdTable(headers, rows) {
  if (!rows.length) return '_none_\n';
  const head = `| ${headers.join(' | ')} |`;
  const sep = `| ${headers.map(() => '---').join(' | ')} |`;
  const body = rows.map((row) => `| ${row.map(mdEscapeCell).join(' | ')} |`).join('\n');
  return `${head}\n${sep}\n${body}\n`;
}

function section(title, body) {
  if (!body || !String(body).trim()) return '';
  return `## ${title}\n\n${body}\n`;
}

function renderList(items, mapper) {
  if (!items || !items.length) return '';
  return `${items.map((item) => `- ${mapper(item)}`).join('\n')}\n`;
}

function pickTitle(payload, fallback) {
  return payload.title
    || payload.label
    || (payload.schemaVersion ? String(payload.schemaVersion).replace(/^metro\.docs\./, '').replace(/\.v\d+$/, '') : null)
    || fallback
    || 'metro docs reference';
}

function renderCommands(commands) {
  if (!commands || !commands.length) return '';
  return mdTable(
    ['id', 'command', 'group', 'mode', 'status', 'apiAccess', 'schemaVersion', 'description'],
    commands.map((c) => [
      c.id,
      c.command,
      c.group,
      c.mode,
      c.status,
      c.apiAccess,
      c.schemaVersion,
      c.description || c.refusal || '',
    ]),
  );
}

function renderOperatingTopics(topics) {
  if (!topics || !topics.length) return '';
  return mdTable(
    ['id', 'status', 'apiAccess', 'summary', 'explain'],
    topics.map((t) => [
      t.id,
      t.status,
      t.apiAccess,
      t.summary,
      t.explainCommand || `metro docs explain ${t.id} --json`,
    ]),
  );
}

function renderEndpoints(endpoints) {
  if (!endpoints || !endpoints.length) return '';
  return mdTable(
    ['id', 'family', 'method', 'path', 'supportStatus', 'apiAccess'],
    endpoints.slice(0, 400).map((e) => [
      e.id,
      e.family,
      e.method,
      e.path,
      e.supportStatus || e.status,
      e.apiAccessInCurrentCli || e.apiAccess,
    ]),
  );
}

function renderShapes(shapes) {
  if (!shapes || !shapes.length) return '';
  return mdTable(
    ['id', 'family', 'maturity', 'purpose'],
    shapes.map((s) => [s.id, s.family, s.maturity, s.purpose || s.summary || '']),
  );
}

function renderRules(rules) {
  if (!rules || !rules.length) return '';
  return mdTable(
    ['id', 'severity', 'message'],
    rules.map((r) => [r.id, r.severity, r.message || r.remediation || '']),
  );
}

function renderGotchas(gotchas) {
  if (!gotchas || !gotchas.length) return '';
  return mdTable(
    ['id', 'category', 'coverageStatus', 'gotcha'],
    gotchas.map((g) => [g.id, g.category, g.coverageStatus, g.gotcha]),
  );
}

function renderGenericArrays(payload) {
  const chunks = [];
  const skip = new Set([
    'schemaVersion', 'generatedFrom', 'sectionNavigation', 'summary',
    'apiAccess', 'liveExecution', 'nextSafeStep', 'filters', 'match',
    'title', 'label', 'notes',
  ]);
  for (const [key, value] of Object.entries(payload || {})) {
    if (skip.has(key)) continue;
    if (!Array.isArray(value) || !value.length) continue;
    if (typeof value[0] !== 'object' || value[0] == null) {
      chunks.push(section(key, renderList(value, (v) => `\`${v}\``)));
      continue;
    }
    // Already handled named arrays below
    if (['commands', 'unsupportedCommands', 'operatingTopics', 'endpoints', 'shapes', 'rules', 'gotchas', 'lookupKinds'].includes(key)) {
      continue;
    }
    const keys = Object.keys(value[0]).slice(0, 8);
    chunks.push(section(key, mdTable(keys, value.slice(0, 200).map((row) => keys.map((k) => {
      const cell = row[k];
      if (Array.isArray(cell)) return cell.join(', ');
      if (cell && typeof cell === 'object') return JSON.stringify(cell);
      return cell;
    })))));
  }
  return chunks.join('\n');
}

function renderExplainTopicMarkdown(payload) {
  const match = payload.match || {};
  const lines = [
    `# ${match.title || match.id || 'docs explain'}`,
    '',
    `- schemaVersion: \`${payload.schemaVersion}\``,
    `- id: \`${match.id || ''}\``,
    `- type: \`${match.type || ''}\``,
    `- status: \`${match.status || ''}\``,
    `- apiAccess: \`${match.apiAccess || ''}\``,
    '',
    section('Summary', match.summary || ''),
  ];
  if (match.keyFields && typeof match.keyFields === 'object') {
    lines.push(section('Key fields', `\`\`\`json\n${JSON.stringify(match.keyFields, null, 2)}\n\`\`\``));
  }
  if (match.related?.commands?.length) {
    lines.push(section('Related commands', renderList(match.related.commands, (c) => `\`${c}\``)));
  }
  if (match.sources?.length) {
    lines.push(section('Sources', renderList(match.sources, (s) => `\`${s}\``)));
  }
  if (payload.nextSafeStep) {
    lines.push(section('Next safe step', payload.nextSafeStep));
  }
  return `${lines.filter(Boolean).join('\n')}\n`;
}

function renderReferenceMarkdown(payload, options = {}) {
  if (payload && payload.match && payload.schemaVersion === 'metro.docs.explain.v1') {
    return renderExplainTopicMarkdown(payload);
  }

  const title = pickTitle(payload, options.title);
  const parts = [
    `# ${title}`,
    '',
    `- schemaVersion: \`${payload.schemaVersion || 'n/a'}\``,
    payload.apiAccess != null ? `- apiAccess: \`${payload.apiAccess}\`` : null,
    payload.nextSafeStep ? `- nextSafeStep: ${payload.nextSafeStep}` : null,
    '',
  ].filter((line) => line != null);

  if (payload.summary && typeof payload.summary === 'object') {
    parts.push(section('Summary', `\`\`\`json\n${JSON.stringify(payload.summary, null, 2)}\n\`\`\``));
  }

  if (payload.operatingTopics) {
    parts.push(section('Operating topics (agent decision trees)', renderOperatingTopics(payload.operatingTopics)));
  }
  if (payload.lookupKinds) {
    parts.push(section('Lookup kinds', mdTable(
      ['kind', 'count', 'description', 'examples'],
      payload.lookupKinds.map((k) => [
        k.kind,
        k.count,
        k.description,
        (k.exampleTopics || []).slice(0, 4).join(', '),
      ]),
    )));
  }
  if (payload.commands) {
    parts.push(section('Commands', renderCommands(payload.commands)));
  }
  if (payload.unsupportedCommands) {
    parts.push(section('Unsupported commands', renderCommands(payload.unsupportedCommands)));
  }
  if (payload.endpoints) {
    parts.push(section('Endpoints', renderEndpoints(payload.endpoints)));
  }
  if (payload.shapes) {
    parts.push(section('Shapes', renderShapes(payload.shapes)));
  }
  if (payload.rules) {
    parts.push(section('Validator rules', renderRules(payload.rules)));
  }
  if (payload.gotchas) {
    parts.push(section('Gotchas', renderGotchas(payload.gotchas)));
  }

  parts.push(renderGenericArrays(payload));

  parts.push(section(
    'Agent notes',
    [
      'Prefer `--json` when scripting parsers; use `--markdown` when loading context into an agent.',
      'Never treat HTML as the source of truth, regenerate from `metro docs <ref> --markdown`.',
      'Live reads/writes still require tenant flags + confirmation tokens.',
    ].map((line) => `- ${line}`).join('\n'),
  ));

  return `${parts.filter(Boolean).join('\n')}\n`;
}

module.exports = {
  exclusiveFormatError,
  renderReferenceMarkdown,
};
