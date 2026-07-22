'use strict';

const { buildMetronomeHttpTransport } = require('./metronome-http');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildMetronomeRetryClient(apiKey) {
  const transport = buildMetronomeHttpTransport(apiKey);

  async function request(method, url, body) {
    for (let attempt = 0; attempt < 7; attempt += 1) {
      try {
        const { data } = await transport({ method, path: url, body });
        return data;
      } catch (err) {
        const status = err.status;
        const message = err.responseData?.message || err.message || '';
        const retryable = status === 429 || status >= 500 || /timeout|rate limit/i.test(message);
        if (retryable && attempt < 6) {
          await sleep(500 * 1.8 ** attempt);
          continue;
        }
        throw err;
      }
    }
    throw new Error('Metronome retry client exhausted attempts.');
  }

  return {
    get: (url) => request('GET', url),
    post: (url, body) => request('POST', url, body),
  };
}

module.exports = {
  buildMetronomeRetryClient,
  sleep,
};
