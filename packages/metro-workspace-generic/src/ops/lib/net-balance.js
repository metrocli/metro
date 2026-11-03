'use strict';

/**
 * Spendable net vs per-segment list divergence guard.
 *
 * getNetBalance is what a customer can actually spend for one credit type.
 * customerBalances/list shows per-segment balances. When a rollover carried a
 * balance into a contract that was later archived or expired, the two views
 * can disagree by the rolled-out amount. Adding credits off the skewed list
 * view double-grants. So: additions are refused while the views diverge,
 * unless explicitly acknowledged; removals (the remediation path) never are.
 *
 *   POST /v1/contracts/customerBalances/getNetBalance
 *     https://docs.metronome.com/api-reference/credits-and-commits/get-the-net-balance-of-a-customer
 */

const { balanceAmount, summarizeBalance } = require('./metronome');

const NET_DIVERGENCE_ACKNOWLEDGEMENT = 'I_UNDERSTAND_GET_NET_BALANCE_IS_AUTHORITATIVE';

/** Sum nonzero list rows of one credit type, on active contracts only. */
function sumBuckets(balances = [], { creditTypeId, activeContractIds = null } = {}) {
  let sum = 0;
  for (const row of balances) {
    const s = summarizeBalance(row);
    if (s.balance === 0) continue;
    if (s.contract_id && activeContractIds && !activeContractIds.has(s.contract_id)) continue;
    if (creditTypeId && s.credit_type_id && s.credit_type_id !== creditTypeId) continue;
    sum += balanceAmount(row);
  }
  return sum;
}

async function fetchNetBalance(client, customerId, creditTypeId) {
  const body = { customer_id: customerId };
  if (creditTypeId) body.credit_type_id = creditTypeId;
  const resp = await client.post('/v1/contracts/customerBalances/getNetBalance', body);
  const data = (resp && resp.data) || resp || {};
  return Number(data.balance) || 0;
}

function reconcileNetVsBuckets({ netBalance, bucketSum, creditTypeId = null }) {
  const net = Number(netBalance) || 0;
  const sum = Number(bucketSum) || 0;
  const delta = net - sum;
  return { creditTypeId, netBalance: net, bucketSum: sum, delta, divergent: delta !== 0 };
}

function additionDivergenceBlocker({ amount, reconciliation, acknowledged = false }) {
  if (!(Number(amount) > 0)) return null;
  if (!reconciliation || !reconciliation.divergent || acknowledged) return null;
  return {
    code: 'net_balance_diverges_from_bucket_sum',
    net_balance: reconciliation.netBalance,
    bucket_sum: reconciliation.bucketSum,
    delta: reconciliation.delta,
    credit_type_id: reconciliation.creditTypeId,
    guidance: 'Spendable getNetBalance disagrees with the per-segment balance list (often a rollover into an '
      + 'archived or expired contract). Do not add credits off the list view; reconcile against getNetBalance first. '
      + `If the addition is intentional, pass --acknowledge-net-divergence=${NET_DIVERGENCE_ACKNOWLEDGEMENT}.`,
  };
}

/** Reconcile every credit type present in the list (plus an explicit one). */
async function reconcileAllCreditTypes(client, customerId, balances, { activeContractIds = null, extraCreditTypeIds = [] } = {}) {
  const types = new Set(extraCreditTypeIds.filter(Boolean));
  for (const row of balances) {
    const t = summarizeBalance(row).credit_type_id;
    if (t) types.add(t);
  }
  const out = [];
  for (const creditTypeId of [...types].sort()) {
    const netBalance = await fetchNetBalance(client, customerId, creditTypeId);
    out.push(reconcileNetVsBuckets({
      netBalance,
      bucketSum: sumBuckets(balances, { creditTypeId, activeContractIds }),
      creditTypeId,
    }));
  }
  return out;
}

module.exports = {
  NET_DIVERGENCE_ACKNOWLEDGEMENT,
  sumBuckets,
  fetchNetBalance,
  reconcileNetVsBuckets,
  additionDivergenceBlocker,
  reconcileAllCreditTypes,
};
