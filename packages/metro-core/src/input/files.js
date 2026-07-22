'use strict';

const fs = require('fs');
const path = require('path');

const SUPPORTED_STRUCTURED_INPUT_FORMATS = ['json', 'yaml', 'yml'];
const STRUCTURED_INPUT_FORMAT_LABEL = 'JSON/YAML';

function isYamlFile(file) {
  const ext = path.extname(String(file || '')).toLowerCase();
  return ext === '.yaml' || ext === '.yml';
}

function loadStructuredFile(file) {
  const resolved = path.resolve(file);
  return parseStructuredText(fs.readFileSync(resolved, 'utf8'), { filePath: resolved });
}

function parseStructuredText(text, options = {}) {
  const filePath = options.filePath || '';
  if (isYamlFile(filePath)) {
    return parseSimpleYaml(text);
  }
  return JSON.parse(text);
}

function parseSimpleYaml(text) {
  const normalized = String(text || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const lines = normalizeYamlLines(normalized);
  if (lines.length === 0) return null;

  const parsed = parseBlock(lines, 0, lines[0].indent);
  if (parsed.index < lines.length) {
    throw yamlError(lines[parsed.index], 'Unexpected YAML content after document end');
  }
  return parsed.value;
}

function normalizeYamlLines(text) {
  const result = [];
  const rawLines = text.split('\n');
  for (let index = 0; index < rawLines.length; index += 1) {
    const raw = rawLines[index];
    if (raw.includes('\t')) {
      throw yamlError({ lineNumber: index + 1 }, 'Tabs are not supported in YAML input indentation');
    }
    const withoutComment = stripYamlComment(raw).replace(/[ \t]+$/g, '');
    if (!withoutComment.trim()) continue;
    const indent = withoutComment.match(/^ */)[0].length;
    if (indent % 2 !== 0) {
      throw yamlError({ lineNumber: index + 1 }, 'YAML indentation must use two-space levels');
    }
    result.push({
      indent,
      text: withoutComment.trim(),
      lineNumber: index + 1,
    });
  }
  return result;
}

function stripYamlComment(line) {
  let quote = null;
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quote) {
      if (quote === '"' && char === '\\' && !escaped) {
        escaped = true;
        continue;
      }
      if (char === quote && !escaped) quote = null;
      escaped = false;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '#' && (index === 0 || /\s/.test(line[index - 1]))) {
      return line.slice(0, index);
    }
  }
  return line;
}

function parseBlock(lines, index, indent) {
  const line = lines[index];
  if (!line) return { value: null, index };
  if (line.indent < indent) return { value: null, index };
  if (line.indent > indent) {
    throw yamlError(line, `Unexpected indentation; expected ${indent} spaces`);
  }
  if (line.text === '-' || line.text.startsWith('- ')) {
    return parseSequence(lines, index, indent);
  }
  return parseMapping(lines, index, indent);
}

function parseMapping(lines, index, indent) {
  const value = {};
  let cursor = index;
  while (cursor < lines.length) {
    const line = lines[cursor];
    if (line.indent < indent) break;
    if (line.indent > indent) {
      throw yamlError(line, `Unexpected indentation; expected ${indent} spaces`);
    }
    if (line.text === '-' || line.text.startsWith('- ')) break;

    const pair = parseKeyValue(line.text, line);
    cursor += 1;
    if (pair.rawValue === '') {
      if (cursor < lines.length && lines[cursor].indent > indent) {
        const parsed = parseBlock(lines, cursor, lines[cursor].indent);
        value[pair.key] = parsed.value;
        cursor = parsed.index;
      } else {
        value[pair.key] = null;
      }
    } else {
      value[pair.key] = parseYamlScalar(pair.rawValue, line);
    }
  }
  return { value, index: cursor };
}

function parseSequence(lines, index, indent) {
  const value = [];
  let cursor = index;
  while (cursor < lines.length) {
    const line = lines[cursor];
    if (line.indent < indent) break;
    if (line.indent > indent) {
      throw yamlError(line, `Unexpected indentation; expected ${indent} spaces`);
    }
    if (!(line.text === '-' || line.text.startsWith('- '))) break;

    const itemText = line.text === '-' ? '' : line.text.slice(2).trim();
    cursor += 1;
    if (itemText === '') {
      if (cursor < lines.length && lines[cursor].indent > indent) {
        const parsed = parseBlock(lines, cursor, lines[cursor].indent);
        value.push(parsed.value);
        cursor = parsed.index;
      } else {
        value.push(null);
      }
      continue;
    }

    if (hasKeyValueSyntax(itemText)) {
      const pair = parseKeyValue(itemText, line);
      const item = {};
      if (pair.rawValue === '') {
        if (cursor < lines.length && lines[cursor].indent > indent + 2) {
          const parsed = parseBlock(lines, cursor, lines[cursor].indent);
          item[pair.key] = parsed.value;
          cursor = parsed.index;
        } else {
          item[pair.key] = null;
        }
      } else {
        item[pair.key] = parseYamlScalar(pair.rawValue, line);
      }
      if (cursor < lines.length && lines[cursor].indent > indent) {
        const parsed = parseMapping(lines, cursor, lines[cursor].indent);
        Object.assign(item, parsed.value);
        cursor = parsed.index;
      }
      value.push(item);
      continue;
    }

    value.push(parseYamlScalar(itemText, line));
    if (cursor < lines.length && lines[cursor].indent > indent) {
      throw yamlError(lines[cursor], 'Nested YAML content after a scalar list item is not supported');
    }
  }
  return { value, index: cursor };
}

function parseKeyValue(text, line) {
  const colonIndex = findUnquotedColon(text);
  if (colonIndex === -1) {
    throw yamlError(line, `Expected "key: value" mapping entry`);
  }
  const rawKey = text.slice(0, colonIndex).trim();
  if (!rawKey) throw yamlError(line, 'YAML mapping key cannot be empty');
  return {
    key: parseYamlKey(rawKey, line),
    rawValue: text.slice(colonIndex + 1).trim(),
  };
}

function hasKeyValueSyntax(text) {
  const colonIndex = findUnquotedColon(text);
  if (colonIndex <= 0) return false;
  const key = text.slice(0, colonIndex).trim();
  return /^["'].*["']$/.test(key) || /^[A-Za-z0-9_.-]+$/.test(key);
}

function findUnquotedColon(text) {
  let quote = null;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (quote === '"' && char === '\\' && !escaped) {
        escaped = true;
        continue;
      }
      if (char === quote && !escaped) quote = null;
      escaped = false;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === ':') return index;
  }
  return -1;
}

function parseYamlKey(rawKey, line) {
  const key = parseYamlScalar(rawKey, line);
  if (typeof key !== 'string') {
    throw yamlError(line, 'YAML mapping keys must be strings');
  }
  return key;
}

function parseYamlScalar(rawValue, line) {
  if (rawValue === '') return null;
  if (rawValue === 'null' || rawValue === '~') return null;
  if (rawValue === 'true') return true;
  if (rawValue === 'false') return false;
  if (/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(rawValue)) return Number(rawValue);
  if (rawValue.startsWith('"')) {
    try {
      return JSON.parse(rawValue);
    } catch (error) {
      throw yamlError(line, `Invalid double-quoted YAML string: ${error.message}`);
    }
  }
  if (rawValue.startsWith("'")) {
    if (!rawValue.endsWith("'") || rawValue.length < 2) {
      throw yamlError(line, 'Invalid single-quoted YAML string');
    }
    return rawValue.slice(1, -1).replace(/''/g, "'");
  }
  if (rawValue.startsWith('{') || rawValue.startsWith('[')) {
    try {
      return JSON.parse(rawValue);
    } catch (error) {
      throw yamlError(line, `Inline YAML flow values must be valid JSON in this CLI subset: ${error.message}`);
    }
  }
  return rawValue;
}

function yamlError(line, message) {
  const suffix = line && line.lineNumber ? ` at line ${line.lineNumber}` : '';
  return new Error(`${message}${suffix}`);
}

module.exports = {
  STRUCTURED_INPUT_FORMAT_LABEL,
  SUPPORTED_STRUCTURED_INPUT_FORMATS,
  isYamlFile,
  loadStructuredFile,
  parseSimpleYaml,
  parseStructuredText,
};
