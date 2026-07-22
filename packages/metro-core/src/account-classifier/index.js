'use strict';

const { emptyTenantSnapshot, ACCOUNT_PATTERNS } = require('../tenant-snapshot/schema');

function isPresent(value) {
  if (value == null || value === '') return false;
  return !String(value).startsWith('<');
}

function rateCardIdCount(catalog) {
  if (!catalog?.rateCardIds || typeof catalog.rateCardIds !== 'object') return 0;
  return Object.values(catalog.rateCardIds).filter(isPresent).length;
}

function hasRateCards(catalog, inventory) {
  return rateCardIdCount(catalog) >= 1 || (inventory?.rateCardCount ?? 0) > 0;
}

function isEmptyCatalog(catalog, inventory) {
  return !isPresent(catalog?.creditTypeId)
    && !isPresent(catalog?.sharedDimensionalProductId)
    && !isPresent(catalog?.dimensionalBillableMetricId)
    && rateCardIdCount(catalog) === 0
    && (inventory?.rateCardCount ?? 0) === 0;
}

function isDimensionalComplete(catalog) {
  return isPresent(catalog?.sharedDimensionalProductId)
    && isPresent(catalog?.dimensionalBillableMetricId)
    && rateCardIdCount(catalog) >= 1;
}

function isMissingDimensional(catalog) {
  return !isPresent(catalog?.sharedDimensionalProductId)
    || !isPresent(catalog?.dimensionalBillableMetricId);
}

function inventoryNames(inventory, key) {
  const rows = inventory?.[key];
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => String(row?.name || '').toLowerCase()).filter(Boolean);
}

function aliasNames(catalog) {
  if (!catalog?.rateCardIds || typeof catalog.rateCardIds !== 'object') return [];
  return Object.keys(catalog.rateCardIds).map((k) => String(k).toLowerCase());
}

const PACKAGE_NAME_RE = /\b(free|payg|pro|core|select|enterprise|legacy|annual|monthly|trial|starter|growth)\b/;
const COMMIT_GRANT_RE = /\b(commit|credit|grant|complimentary|top.?up|prepaid|rollover)\b/;
const USAGE_RE = /\b(usage|consum|dimensional|metered|action.?code)\b/;

function countMatches(names, re) {
  return names.filter((n) => re.test(n)).length;
}

function isPackageTemplate(catalog, inventory) {
  if (!isMissingDimensional(catalog)) return false;
  const names = [
    ...aliasNames(catalog),
    ...inventoryNames(inventory, 'rateCards'),
  ];
  const hits = countMatches(names, PACKAGE_NAME_RE);
  const cardCount = Math.max(rateCardIdCount(catalog), inventory?.rateCardCount ?? 0);
  return hits >= 2 && cardCount >= 2;
}

function isCommitGrantHeavy(catalog, inventory) {
  if (!isMissingDimensional(catalog)) return false;
  if (!isPresent(catalog?.creditTypeId) && (inventory?.creditTypeCount ?? 0) === 0) return false;
  const names = [
    ...inventoryNames(inventory, 'products'),
    ...inventoryNames(inventory, 'billableMetrics'),
    ...inventoryNames(inventory, 'creditTypes'),
  ];
  const grantHits = countMatches(names, COMMIT_GRANT_RE);
  const usageHits = countMatches(names, USAGE_RE);
  return grantHits >= 1 && grantHits >= usageHits;
}

function isPackageAndCredits(catalog, inventory) {
  return isPresent(catalog?.creditTypeId)
    && hasRateCards(catalog, inventory)
    && isMissingDimensional(catalog);
}

function isGreenfieldNeeded(catalog, inventory) {
  return isMissingDimensional(catalog)
    && !isPackageAndCredits(catalog, inventory)
    && !isPackageTemplate(catalog, inventory)
    && !isCommitGrantHeavy(catalog, inventory);
}

const NEXT_COMMANDS = {
  'dimensional-shared-usage': [
    'metro plan add-pricing-dimension-value --sandbox --json',
    'metro tenant snapshot show --markdown',
  ],
  'package-template': [
    'metro plan annual-subscription-package --sandbox --json',
    'metro docs explain credits.product.decision --markdown',
    'metro catalog bind --sandbox --write',
  ],
  'commit-grant-heavy': [
    'metro plan complimentary-credits --sandbox --json',
    'metro docs explain credits.product.decision --markdown',
  ],
  'package-and-credits': [
    'metro docs explain credits.product.decision --markdown',
    'metro catalog bind --sandbox --write',
  ],
  'greenfield-needed': [
    'metro plan greenfield-credits-product --sandbox --json',
    'metro docs explain credits.product.decision --markdown',
  ],
  unknown: [
    'metro catalog bind --sandbox --write',
    'metro docs explain credits.product.decision --markdown',
  ],
};

function classifyAccount(snapshot) {
  const catalog = snapshot?.catalog ?? {};
  const inventory = snapshot?.inventory ?? {};

  if (isEmptyCatalog(catalog, inventory)) {
    return {
      pattern: 'unknown',
      confidence: 'low',
      reasons: ['catalog and inventory lack bindable identifiers'],
      nextCommands: [...NEXT_COMMANDS.unknown],
      signals: { packageNameHits: 0, commitGrantHits: 0, usageHits: 0 },
    };
  }

  if (isDimensionalComplete(catalog)) {
    const reasons = [
      'sharedDimensionalProductId is bound',
      'dimensionalBillableMetricId is bound',
      `rateCardIds has ${rateCardIdCount(catalog)} bound entr${rateCardIdCount(catalog) === 1 ? 'y' : 'ies'}`,
    ];
    if (isPresent(catalog.creditTypeId)) {
      reasons.push('creditTypeId is also bound; dimensional routing takes priority');
    }
    return {
      pattern: 'dimensional-shared-usage',
      confidence: 'high',
      reasons,
      nextCommands: [...NEXT_COMMANDS['dimensional-shared-usage']],
      signals: { usageShared: true },
    };
  }

  if (isPackageTemplate(catalog, inventory)) {
    const names = [...aliasNames(catalog), ...inventoryNames(inventory, 'rateCards')];
    return {
      pattern: 'package-template',
      confidence: 'medium',
      reasons: [
        'rate card aliases/names look like package tiers',
        `matched ${countMatches(names, PACKAGE_NAME_RE)} package-like names`,
        'dimensional product or billable metric is not bound',
      ],
      nextCommands: [...NEXT_COMMANDS['package-template']],
      signals: { packageNameHits: countMatches(names, PACKAGE_NAME_RE) },
    };
  }

  if (isCommitGrantHeavy(catalog, inventory)) {
    const names = [
      ...inventoryNames(inventory, 'products'),
      ...inventoryNames(inventory, 'billableMetrics'),
      ...inventoryNames(inventory, 'creditTypes'),
    ];
    return {
      pattern: 'commit-grant-heavy',
      confidence: 'medium',
      reasons: [
        'credit type present',
        `inventory names skew commit/grant (${countMatches(names, COMMIT_GRANT_RE)}) over usage (${countMatches(names, USAGE_RE)})`,
        'dimensional product or billable metric is not bound',
      ],
      nextCommands: [...NEXT_COMMANDS['commit-grant-heavy']],
      signals: {
        commitGrantHits: countMatches(names, COMMIT_GRANT_RE),
        usageHits: countMatches(names, USAGE_RE),
      },
    };
  }

  if (isGreenfieldNeeded(catalog, inventory)) {
    const missing = [];
    if (!isPresent(catalog.sharedDimensionalProductId)) missing.push('sharedDimensionalProductId');
    if (!isPresent(catalog.dimensionalBillableMetricId)) missing.push('dimensionalBillableMetricId');
    const hasInfra = hasRateCards(catalog, inventory) || isPresent(catalog.creditTypeId);
    return {
      pattern: 'greenfield-needed',
      confidence: hasInfra ? 'high' : 'medium',
      reasons: [
        `missing ${missing.join(' and ')}`,
        ...(hasRateCards(catalog, inventory)
          ? [`rate cards present (${inventory.rateCardCount ?? rateCardIdCount(catalog)})`]
          : []),
      ],
      nextCommands: [...NEXT_COMMANDS['greenfield-needed']],
      signals: { missingDimensional: missing },
    };
  }

  if (isPackageAndCredits(catalog, inventory)) {
    return {
      pattern: 'package-and-credits',
      confidence: 'medium',
      reasons: [
        'creditTypeId is bound',
        hasRateCards(catalog, inventory)
          ? `rate cards present (${inventory.rateCardCount ?? rateCardIdCount(catalog)})`
          : 'rate cards present',
        'dimensional product or billable metric is not bound',
      ],
      nextCommands: [...NEXT_COMMANDS['package-and-credits']],
      signals: {},
    };
  }

  return {
    pattern: 'unknown',
    confidence: 'low',
    reasons: ['insufficient catalog signals to classify tenant pattern'],
    nextCommands: [...NEXT_COMMANDS.unknown],
    signals: {},
  };
}

module.exports = {
  classifyAccount,
  isPresent,
  isEmptyCatalog,
  ACCOUNT_PATTERNS,
  emptyTenantSnapshot,
};
