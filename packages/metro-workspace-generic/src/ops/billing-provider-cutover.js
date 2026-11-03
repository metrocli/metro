'use strict';

/**
 * Replace a customer's active Stripe billing-provider configuration: change the
 * collection method and/or remap a wrong Stripe customer id.
 *   POST /v1/getCustomerBillingProviderConfigurations
 *     https://docs.metronome.com/api-reference/customers/fetch-billing-provider-configurations-for-a-customer
 *   POST /v1/archiveCustomerBillingProviderConfigurations
 *     https://docs.metronome.com/api-reference/customers/archive-billing-provider-configurations-for-a-customer
 *   POST /v1/setCustomerBillingProviderConfigurations
 *     https://docs.metronome.com/api-reference/customers/set-billing-provider-configurations-for-a-customer
 *
 * leave_stripe_invoices_in_draft lives inside the Stripe `configuration`
 * object of setCustomerBillingProviderConfigurations (per the docs example);
 * /v1/customers/{id}/updateConfig only takes salesforce_account_id.
 */

const rt = require('./lib/runtime');
const mx = require('./lib/metronome');

const VALID_METHODS = ['send_invoice', 'charge_automatically'];

function activeStripeConfigs(configs) {
  return configs.filter((c) => c.billing_provider === 'stripe' && !c.archived_at);
}

/**
 * True only when the cutover would change nothing. Collection method alone is
 * not the test: signup can map a customer to a duplicate Stripe customer with
 * no payment method, and the fix keeps the same collection method while
 * repointing stripe_customer_id.
 */
function isNoOpCutover(current, { collectionMethod, stripeCustomerId, deliveryMethodId, leaveInDraft = null } = {}) {
  if (!current) return false;
  const cfg = current.configuration || {};
  if (cfg.stripe_collection_method !== collectionMethod) return false;
  if (stripeCustomerId && stripeCustomerId !== cfg.stripe_customer_id) return false;
  if (deliveryMethodId && deliveryMethodId !== current.delivery_method_id) return false;
  if (leaveInDraft !== null && Boolean(cfg.leave_stripe_invoices_in_draft) !== leaveInDraft) return false;
  return true;
}

function readLeaveInDraft(flags) {
  if (rt.readBool(flags, 'leave-stripe-invoices-in-draft')) return true;
  if (rt.readBool(flags, 'no-leave-stripe-invoices-in-draft')) return false;
  return null;
}

const billingProviderCutover = rt.defineOp({
  name: 'billing-provider-cutover',
  command: 'metro billing-provider cutover',
  async preflight(ctx) {
    const collectionMethod = rt.readString(ctx.flags, 'collection-method');
    const reason = rt.readString(ctx.flags, 'reason');
    if (!collectionMethod || !reason) {
      throw rt.usageError('Usage: metro billing-provider cutover preflight --collection-method=send_invoice|charge_automatically --reason="<why>" (--customer-id=|--external-id=|--ingest-alias=|--name=) [--old-config-id=] [--stripe-customer-id=cus_...] [--delivery-method-id=] [--leave-stripe-invoices-in-draft] (--sandbox|--prod)');
    }
    if (!VALID_METHODS.includes(collectionMethod)) {
      throw rt.usageError(`--collection-method must be one of ${VALID_METHODS.join(', ')}, got ${collectionMethod}`);
    }
    const { customer } = await mx.resolveOneCustomer(ctx.client, ctx.flags);
    const configs = await mx.getBillingProviderConfigs(ctx.client, customer.id);
    let active = activeStripeConfigs(configs);
    const oldConfigId = rt.readString(ctx.flags, 'old-config-id');
    if (oldConfigId) active = active.filter((c) => c.id === oldConfigId);

    const blockers = [];
    if (active.length === 0) blockers.push({ code: 'no_active_stripe_billing_config' });
    if (active.length > 1) blockers.push({ code: 'ambiguous_active_stripe_config', candidates: active.map((c) => c.id), remediation: 'Pass --old-config-id.' });
    const current = active.length === 1 ? active[0] : null;
    const currentCfg = current?.configuration || {};
    const stripeCustomerId = rt.readString(ctx.flags, 'stripe-customer-id') || currentCfg.stripe_customer_id || null;
    const deliveryMethodId = rt.readString(ctx.flags, 'delivery-method-id') || current?.delivery_method_id || null;
    const leaveInDraft = readLeaveInDraft(ctx.flags);
    if (!stripeCustomerId) blockers.push({ code: 'stripe_customer_id_unresolved', remediation: 'Pass --stripe-customer-id.' });
    if (!deliveryMethodId) blockers.push({ code: 'delivery_method_id_unresolved', remediation: 'Pass --delivery-method-id.' });
    if (current && isNoOpCutover(current, { collectionMethod, stripeCustomerId, deliveryMethodId, leaveInDraft })) {
      blockers.push({
        code: 'already_on_requested_configuration',
        current_method: currentCfg.stripe_collection_method,
        current_stripe_customer_id: currentCfg.stripe_customer_id || null,
        remediation: 'Nothing would change. To remap a wrong Stripe customer, pass --stripe-customer-id=<correct cus_...>.',
      });
    }
    if (blockers.length) throw rt.blocked(blockers);

    const configuration = { stripe_customer_id: stripeCustomerId, stripe_collection_method: collectionMethod };
    const draft = leaveInDraft !== null ? leaveInDraft : currentCfg.leave_stripe_invoices_in_draft;
    if (draft !== undefined && draft !== null) configuration.leave_stripe_invoices_in_draft = Boolean(draft);
    const remaps = stripeCustomerId !== (currentCfg.stripe_customer_id || null);
    const warnings = remaps ? [{ id: 'MTR-BILL-005', message: `Remapping Stripe customer ${currentCfg.stripe_customer_id || '(none)'} -> ${stripeCustomerId}. Confirm in Stripe that ${stripeCustomerId} has the payment method.` }] : [];
    return {
      slug: customer.id.slice(0, 8),
      summary: { customer: mx.summarizeCustomer(customer), reason, from_config_id: current.id, remapsStripeCustomer: remaps },
      diff: [
        { field: 'stripe_collection_method', from: currentCfg.stripe_collection_method || null, to: collectionMethod },
        { field: 'stripe_customer_id', from: currentCfg.stripe_customer_id || null, to: stripeCustomerId },
        { field: 'delivery_method_id', from: current.delivery_method_id || null, to: deliveryMethodId },
      ],
      warnings,
      steps: [
        {
          id: 'archive',
          method: 'POST',
          path: '/v1/archiveCustomerBillingProviderConfigurations',
          body: { customer_id: customer.id, customer_billing_provider_configuration_ids: [current.id] },
        },
        {
          id: 'set',
          method: 'POST',
          path: '/v1/setCustomerBillingProviderConfigurations',
          body: { data: [{ customer_id: customer.id, billing_provider: 'stripe', configuration, delivery_method_id: deliveryMethodId }] },
        },
      ],
      expect: { customer_id: customer.id, old_config_id: current.id, configuration, delivery_method_id: deliveryMethodId },
    };
  },
  async verify(ctx, plan) {
    const e = plan.expect;
    const resp = await ctx.client.post('/v1/getCustomerBillingProviderConfigurations', { customer_id: e.customer_id, include_archived: true });
    const rows = (resp && resp.data) || [];
    const old = rows.find((c) => c.id === e.old_config_id);
    const active = activeStripeConfigs(rows);
    const now = active[0];
    return [
      rt.check('old config archived', true, Boolean(old?.archived_at)),
      rt.check('active stripe configs', 1, active.length),
      rt.check('configuration', e.configuration, now?.configuration, { compare: 'subset' }),
      rt.check('delivery_method_id', e.delivery_method_id, now?.delivery_method_id),
    ];
  },
});

module.exports = { billingProviderCutover, isNoOpCutover, activeStripeConfigs, VALID_METHODS };
