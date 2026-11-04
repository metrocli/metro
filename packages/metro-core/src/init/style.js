'use strict';

// SPDX-License-Identifier: Apache-2.0
//
// Terminal styling for metro's own output. Values mirror the site's brand/ansi.json
// so a real session and a screenshot on metrocli.com look the same.
// Rules: colour only the label or glyph, never the value. Honor NO_COLOR, non-TTY
// output and TERM=dumb. --plain also switches glyphs to ASCII.

// signal is the brand accent (emerald) and equals proof. confirm stays ember orange as a
// state colour only: it marks the typed confirmation, never the brand.
const ROLES = {
  signal: { hex: '#44D89F', x256: 79, sgr: '32' },
  read: { hex: '#67AAED', x256: 75, sgr: '34' },
  sandbox: { hex: '#5CD0EA', x256: 80, sgr: '36' },
  preview: { hex: '#F4CD4B', x256: 221, sgr: '33' },
  confirm: { hex: '#FB6C2B', x256: 202, sgr: '1;33' },
  apply: { hex: '#F84B4B', x256: 203, sgr: '31' },
  proof: { hex: '#44D89F', x256: 79, sgr: '32' },
  muted: { hex: '#707176', x256: 242, sgr: '90' },
  fg: { hex: '#F7F7F4', x256: 255, sgr: '39' },
};

const GLYPHS = { beat: '·', proof: '✓', fail: '✗', step: '›', dots: '…' };
const ASCII_GLYPHS = { beat: '.', proof: 'ok', fail: 'x', step: '>', dots: '...' };

function colorDepth({ stream, env = process.env, plain = false } = {}) {
  if (plain) return 0;
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== '') return 0;
  if (!stream || !stream.isTTY) return 0;
  if (env.TERM === 'dumb') return 0;
  const colorterm = String(env.COLORTERM || '').toLowerCase();
  if (colorterm === 'truecolor' || colorterm === '24bit') return 3;
  if (/256/.test(String(env.TERM || ''))) return 2;
  return 1;
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function createStyle({ stream = process.stdout, env = process.env, plain = false } = {}) {
  const depth = colorDepth({ stream, env, plain });
  const glyphs = plain ? ASCII_GLYPHS : GLYPHS;

  function paint(role, text) {
    const spec = ROLES[role];
    if (!spec || depth === 0) return String(text);
    let open;
    if (depth === 3) open = `\x1b[38;2;${hexToRgb(spec.hex).join(';')}m`;
    else if (depth === 2) open = `\x1b[38;5;${spec.x256}m`;
    else open = `\x1b[${spec.sgr}m`;
    if (role === 'confirm' && depth > 1) open = `\x1b[1m${open}`;
    return `${open}${text}\x1b[0m`;
  }

  const style = { depth, glyphs, paint };
  for (const role of Object.keys(ROLES)) style[role] = (text) => paint(role, text);
  style.ok = (text) => `${paint('proof', glyphs.proof)} ${text}`;
  style.fail = (text) => `${paint('apply', glyphs.fail)} ${text}`;
  style.beat = (text) => `${paint('muted', glyphs.beat)} ${text}`;
  style.pending = (text) => `${paint('muted', glyphs.dots)} ${text}`;
  return style;
}

module.exports = {
  ROLES,
  GLYPHS,
  ASCII_GLYPHS,
  colorDepth,
  createStyle,
};
