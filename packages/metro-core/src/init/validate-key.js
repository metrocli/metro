'use strict';

// SPDX-License-Identifier: Apache-2.0
//
// Key validation for `metro init`: one read-only Metronome call per key.
//   GET https://api.metronome.com/v1/customers?limit=100
//   https://docs.metronome.com/api-reference/customers/list-customers
// When the key works, a second read-only call fills in the tenant summary:
//   POST https://api.metronome.com/v1/contract-pricing/rate-cards/list?limit=100  body {}
//   https://docs.metronome.com/api-reference/rate-cards/list-rate-cards
// A failure of the summary call never changes the key's status.
// The key is only ever placed in the Authorization header. It is never logged.

const { METRONOME_API_BASE_URL } = require('../clients/live-endpoints');

const VALIDATION_ENDPOINT = {
  method: 'GET',
  path: '/v1/customers?limit=100',
  docs: 'https://docs.metronome.com/api-reference/customers/list-customers',
};
const SUMMARY_ENDPOINT = {
  method: 'POST',
  path: '/v1/contract-pricing/rate-cards/list?limit=100',
  docs: 'https://docs.metronome.com/api-reference/rate-cards/list-rate-cards',
};
const TIMEOUT_MS = 15000;

async function call(fetchImpl, key, endpoint) {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), TIMEOUT_MS) : null;
  try {
    const init = {
      method: endpoint.method,
      headers: {
        Authorization: `Bearer ${String(key).trim()}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
    };
    if (endpoint.method !== 'GET') init.body = '{}';
    if (controller) init.signal = controller.signal;
    const response = await fetchImpl(`${METRONOME_API_BASE_URL}${endpoint.path}`, init);
    let data = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }
    return { ok: response.ok, status: response.status, data };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function countPage(data) {
  if (!data || !Array.isArray(data.data)) return null;
  return { count: data.data.length, more: Boolean(data.next_page) };
}

/**
 * @returns {Promise<{status: 'working'|'rejected'|'unreachable'|'error', httpStatus?: number,
 *   customers?: {count:number, more:boolean}, rateCards?: {count:number, more:boolean}|null}>}
 */
async function validateKey(key, { fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== 'function') return { status: 'unreachable', reason: 'fetch-unavailable' };
  let result;
  try {
    result = await call(fetchImpl, key, VALIDATION_ENDPOINT);
  } catch {
    return { status: 'unreachable' };
  }
  if (result.status === 401 || result.status === 403) {
    return { status: 'rejected', httpStatus: result.status };
  }
  if (!result.ok) return { status: 'error', httpStatus: result.status };

  const customers = countPage(result.data) || { count: 0, more: false };
  let rateCards = null;
  try {
    const summary = await call(fetchImpl, key, SUMMARY_ENDPOINT);
    if (summary.ok) rateCards = countPage(summary.data);
  } catch {
    rateCards = null;
  }
  return { status: 'working', httpStatus: result.status, customers, rateCards };
}

function plural(n, more, word) {
  const label = more ? `${n}+` : String(n);
  return `${label} ${word}${n === 1 && !more ? '' : 's'}`;
}

function tenantSummary(result) {
  const parts = [plural(result.customers.count, result.customers.more, 'customer')];
  if (result.rateCards) parts.push(plural(result.rateCards.count, result.rateCards.more, 'rate card'));
  return parts.join(' · ');
}

module.exports = {
  VALIDATION_ENDPOINT,
  SUMMARY_ENDPOINT,
  validateKey,
  tenantSummary,
};
