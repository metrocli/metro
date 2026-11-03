'use strict';

// SPDX-License-Identifier: Apache-2.0
//
// TTY prompts for `metro init`. The hidden prompt never echoes what you type:
// it prints a mask character per key press and returns the value to the caller,
// which writes it to ~/.metro/.env and nowhere else.

const MASK = '•';
const MAX_MASK = 24;

function readHidden({ input = process.stdin, output = process.stdout, prompt = '› ' } = {}) {
  return new Promise((resolve, reject) => {
    let value = '';
    let shown = 0;
    const wasRaw = Boolean(input.isRaw);
    output.write(prompt);
    if (typeof input.setRawMode === 'function') input.setRawMode(true);
    input.setEncoding('utf8');
    input.resume();

    function cleanup() {
      input.removeListener('data', onData);
      if (typeof input.setRawMode === 'function') input.setRawMode(wasRaw);
      input.pause();
    }

    function onData(chunk) {
      for (const ch of String(chunk)) {
        if (ch === '\r' || ch === '\n') {
          cleanup();
          output.write('\n');
          resolve(value.trim());
          return;
        }
        if (ch === '\u0003') {
          cleanup();
          output.write('\n');
          const error = new Error('Cancelled.');
          error.code = 'METRO_INIT_CANCELLED';
          reject(error);
          return;
        }
        if (ch === '\u007f' || ch === '\b') {
          if (value.length) {
            value = value.slice(0, -1);
            if (shown > value.length) {
              output.write('\b \b');
              shown -= 1;
            }
          }
          continue;
        }
        if (ch < ' ') continue;
        value += ch;
        if (shown < MAX_MASK) {
          output.write(MASK);
          shown += 1;
        }
      }
    }

    input.on('data', onData);
  });
}

// Visible single-line prompt (the y/N question). On a TTY it reads in raw mode
// and echoes plain characters itself: readline's terminal mode re-renders the
// line with cursor-control codes (ESC[nG and friends) that show up as stray
// bytes in some terminals and miscount the width of a coloured prompt.
function readLine({ input = process.stdin, output = process.stdout, prompt = '› ' } = {}) {
  if (!input.isTTY || typeof input.setRawMode !== 'function') {
    return new Promise((resolve) => {
      const readline = require('readline');
      const rl = readline.createInterface({ input, terminal: false });
      output.write(prompt);
      let done = false;
      const finish = (answer) => {
        if (done) return;
        done = true;
        rl.close();
        resolve(String(answer || '').trim());
      };
      rl.once('line', finish);
      rl.once('close', () => finish(''));
    });
  }

  return new Promise((resolve, reject) => {
    let value = '';
    const wasRaw = Boolean(input.isRaw);
    output.write(prompt);
    input.setRawMode(true);
    input.setEncoding('utf8');
    input.resume();

    function cleanup() {
      input.removeListener('data', onData);
      input.setRawMode(wasRaw);
      input.pause();
    }

    function onData(chunk) {
      // Drop arrow keys and other escape sequences instead of echoing their tail.
      for (const ch of String(chunk).replace(/\u001b(\[[0-9;?]*[ -/]*[@-~]|O.|.)?/g, '')) {
        if (ch === '\r' || ch === '\n') {
          cleanup();
          output.write('\n');
          resolve(value.trim());
          return;
        }
        if (ch === '\u0003') {
          cleanup();
          output.write('\n');
          const error = new Error('Cancelled.');
          error.code = 'METRO_INIT_CANCELLED';
          reject(error);
          return;
        }
        if (ch === '\u007f' || ch === '\b') {
          if (value.length) {
            value = value.slice(0, -1);
            output.write('\b \b');
          }
          continue;
        }
        if (ch < ' ') continue;
        value += ch;
        output.write(ch);
      }
    }

    input.on('data', onData);
  });
}

module.exports = {
  readHidden,
  readLine,
};
