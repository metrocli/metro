'use strict';

const { METRONOME_API_BASE_URL } = require('./live-endpoints');

function buildMetronomeHttpTransport(apiKey) {
  if (!apiKey || typeof apiKey !== 'string' || apiKey.trim() === '') {
    throw new Error('MTR-CLIENT-003: Metronome HTTP transport requires a non-empty API key.');
  }

  const token = apiKey.trim();

  return async function metronomeHttpTransport({ method, path, body }) {
    const url = `${METRONOME_API_BASE_URL}${path}`;
    const headers = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };

    const init = {
      method: method.toUpperCase(),
      headers,
    };

    if (body !== undefined && init.method !== 'GET' && init.method !== 'HEAD') {
      init.body = JSON.stringify(body);
    }

    const response = await fetch(url, init);
    const text = await response.text();
    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text };
    }

    if (!response.ok) {
      const message = data?.message || data?.error || response.statusText || 'Metronome API request failed';
      const error = new Error(`Metronome ${response.status}: ${message}`);
      error.status = response.status;
      error.responseData = data;
      throw error;
    }

    return { data, status: response.status };
  };
}

module.exports = {
  buildMetronomeHttpTransport,
};
