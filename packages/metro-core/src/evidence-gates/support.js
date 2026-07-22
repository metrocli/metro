'use strict';

const WORKFLOW_BY_SHAPE_ID = Object.freeze({
  'customer-setup': 'customer.setup',
  'pro-annual': 'package.apply',
  'complimentary-credit-grant': 'credit.apply',
  'paid-credit-top-up': 'credit.apply',
  'package-alias-archive-handoff': 'package.archive',
  'stripe-billing-provider-attachment': 'billing-provider.attach',
  'package-plan-move-no-immediate-invoice': 'contract.move-plan.apply',
  'package-plan-move-immediate-invoice': 'contract.move-plan.apply',
  'product-rate-retirement': 'product.rate-retirement',
  'invoice-issue-date-update': 'invoice.issue-date-update',
  'direct-subscription-contract': 'subscription.contract.apply',
  'enterprise-custom-contract': 'custom-contract.create',
  'usage-ingest-preview': 'usage.ingest-preview',
  'dimensional-rate-card': 'rate-card.dimensional.apply',
});

const PREFLIGHT_ONLY_SHAPE_IDS = Object.freeze([]);

const FULL_TEMPLATE_PATH_SHAPE_IDS = Object.freeze(
  Object.keys(WORKFLOW_BY_SHAPE_ID).filter((shapeId) => !PREFLIGHT_ONLY_SHAPE_IDS.includes(shapeId)),
);

function evidenceKey(workflow, shape) {
  return `${workflow}:${shape}`;
}

function supportSet(shapeIds) {
  return new Set(shapeIds.map((shapeId) => evidenceKey(WORKFLOW_BY_SHAPE_ID[shapeId], shapeId)));
}

const PREFLIGHT_KEYS = supportSet(Object.keys(WORKFLOW_BY_SHAPE_ID));
const FULL_TEMPLATE_PATH_KEYS = supportSet(FULL_TEMPLATE_PATH_SHAPE_IDS);

function workflowForShapeId(shapeId) {
  return WORKFLOW_BY_SHAPE_ID[shapeId] || null;
}

function isPackagePlanMoveShape(shapeId) {
  return shapeId === 'package-plan-move-no-immediate-invoice'
    || shapeId === 'package-plan-move-immediate-invoice';
}

function isPreflightSupported(workflow, shape) {
  return PREFLIGHT_KEYS.has(evidenceKey(workflow, shape));
}

function isFullTemplatePathSupported(workflow, shape) {
  return FULL_TEMPLATE_PATH_KEYS.has(evidenceKey(workflow, shape));
}

module.exports = {
  FULL_TEMPLATE_PATH_SHAPE_IDS,
  PREFLIGHT_ONLY_SHAPE_IDS,
  WORKFLOW_BY_SHAPE_ID,
  evidenceKey,
  isApplyGateSupported: isFullTemplatePathSupported,
  isAuditTemplateSupported: isFullTemplatePathSupported,
  isFullTemplatePathSupported,
  isPreflightSupported,
  isSandboxProofSupported: isFullTemplatePathSupported,
  workflowForShapeId,
  isPackagePlanMoveShape,
};
