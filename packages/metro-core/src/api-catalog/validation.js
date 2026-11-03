'use strict';

const { getApiEndpoint, listApiEndpoints } = require('./index');
const { rule } = require('../validators/rules');

const API_VALIDATION_SCHEMA_VERSION = 'metro.api.validation.v1';

const SECRET_KEY_PATTERN = /(?:api[_-]?key|secret|token|authorization|password)/i;
const SECRET_VALUE_PATTERN = /(?:bearer\s+[A-Za-z0-9._-]+|sk_live_[A-Za-z0-9]+|rk_live_[A-Za-z0-9]+)/i;
const SAFE_IDENTIFIER_PATTERN = /^[A-Za-z0-9_.:-]+$/;
const MANAGED_ENTITY_TYPES = [
  'alert',
  'billable_metric',
  'charge',
  'commit',
  'contract_credit',
  'contract_product',
  'contract',
  'customer',
  'discount',
  'invoice',
  'professional_service',
  'product',
  'rate_card',
  'scheduled_charge',
  'subscription',
  'package_commit',
  'package_credit',
  'package_subscription',
  'package_scheduled_charge',
];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasValue(value) {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

function isHourBoundaryUTC(value) {
  if (!hasValue(value) || typeof value !== 'string') return false;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:00:00(?:\.\d{3})?Z$/.test(value)) return false;
  return !Number.isNaN(Date.parse(value));
}

function makeFinding(id, message, path, sourceIds = []) {
  const definition = rule(id);
  return {
    id,
    severity: definition.severity,
    title: definition.title,
    message,
    remediation: definition.remediation,
    path,
    sourceIds,
  };
}

function add(findings, id, message, path, sourceIds) {
  findings.push(makeFinding(id, message, path, sourceIds));
}

function getPath(root, dottedPath) {
  return dottedPath.split('.').reduce((current, part) => {
    if (current === undefined || current === null) return undefined;
    return current[part];
  }, root);
}

function pathExists(root, dottedPath) {
  return hasValue(getPath(root, dottedPath));
}

function normalizeRequestInput(input, endpoint) {
  if (!isPlainObject(input)) {
    return {
      envelopeMode: 'invalid',
      body: {},
      query: {},
      path: {},
      evidence: {},
      metadata: {},
    };
  }

  const envelopeKeys = ['body', 'query', 'path', 'evidence', 'metadata'];
  const isEnvelope = envelopeKeys.some((key) => Object.prototype.hasOwnProperty.call(input, key));
  if (isEnvelope) {
    return {
      envelopeMode: 'explicit',
      body: isPlainObject(input.body) ? input.body : {},
      query: isPlainObject(input.query) ? input.query : {},
      path: isPlainObject(input.path) ? input.path : {},
      evidence: isPlainObject(input.evidence) ? input.evidence : {},
      metadata: isPlainObject(input.metadata) ? input.metadata : {},
    };
  }

  if (endpoint.method === 'GET') {
    return {
      envelopeMode: 'implicit-query',
      body: {},
      query: input,
      path: {},
      evidence: {},
      metadata: {},
    };
  }

  return {
    envelopeMode: 'implicit-body',
    body: input,
    query: {},
    path: {},
    evidence: {},
    metadata: {},
  };
}

function scanForSecrets(value, findings, basePath = '$') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanForSecrets(item, findings, `${basePath}[${index}]`));
    return;
  }

  if (!isPlainObject(value)) {
    if (typeof value === 'string' && SECRET_VALUE_PATTERN.test(value)) {
      add(findings, 'MTR-APIREQ-003', 'Request contains a secret-shaped string value.', basePath, ['safety', 'api-validation']);
    }
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    const childPath = basePath === '$' ? key : `${basePath}.${key}`;
    if (SECRET_KEY_PATTERN.test(key)) {
      add(findings, 'MTR-APIREQ-003', `Field ${childPath} looks like secret material.`, childPath, ['safety', 'api-validation']);
    }
    scanForSecrets(child, findings, childPath);
  }
}

function requirePath(request, findings, path, message) {
  if (!pathExists(request, path)) {
    add(findings, 'MTR-APIREQ-001', message || `${path} is required by the reviewed endpoint request contract.`, path, ['api-validation']);
  }
}

function requireEvidenceTrue(request, findings, path, message, id = 'MTR-APIREQ-001', sourceIds = ['api-validation']) {
  if (getPath(request, path) !== true) {
    add(findings, id, message || `${path} must be true before this endpoint request can pass local validation.`, path, sourceIds);
  }
}

function forbidPath(request, findings, path, message) {
  const value = getPath(request, path);
  if (value !== undefined && value !== null) {
    add(findings, 'MTR-APIREQ-002', message || `${path} is forbidden by the reviewed endpoint request contract.`, path, ['api-validation']);
  }
}

function requireAny(request, findings, paths, message) {
  if (!paths.some((path) => pathExists(request, path))) {
    add(findings, 'MTR-APIREQ-001', message || `One of ${paths.join(', ')} is required.`, paths.join('|'), ['api-validation']);
  }
}

function requireArray(request, findings, path, options = {}) {
  const value = getPath(request, path);
  if (!Array.isArray(value) || value.length === 0) {
    add(findings, 'MTR-APIREQ-001', `${path} must be a non-empty array.`, path, ['api-validation']);
    return [];
  }
  if (options.max && value.length > options.max) {
    add(findings, 'MTR-APIREQ-004', `${path} has ${value.length} item(s); the current validator allows at most ${options.max}.`, path, ['api-validation']);
  }
  return value;
}

function requireEnum(request, findings, path, allowedValues) {
  const value = getPath(request, path);
  if (hasValue(value) && !allowedValues.includes(value)) {
    add(findings, 'MTR-APIREQ-004', `${path} must be one of ${allowedValues.join(', ')}.`, path, ['api-validation']);
  }
}

function requireSafeIdentifier(request, findings, path) {
  const value = getPath(request, path);
  if (hasValue(value) && (typeof value !== 'string' || !SAFE_IDENTIFIER_PATTERN.test(value))) {
    add(findings, 'MTR-APIREQ-004', `${path} must be a single safe identifier.`, path, ['api-validation']);
  }
}

function requireNonEmptyString(request, findings, path) {
  const value = getPath(request, path);
  if (hasValue(value) && (typeof value !== 'string' || value.trim() === '')) {
    add(findings, 'MTR-APIREQ-004', `${path} must be a non-empty string.`, path, ['api-validation']);
  }
}

function requireHourBoundary(request, findings, path) {
  const value = getPath(request, path);
  if (hasValue(value) && !isHourBoundaryUTC(value)) {
    add(findings, 'MTR-TIME-001', `${path} must be a UTC hour-boundary timestamp.`, path, ['api-validation', 'conventions']);
  }
}

function requireDateTime(request, findings, path) {
  const value = getPath(request, path);
  if (hasValue(value) && (typeof value !== 'string' || Number.isNaN(Date.parse(value)))) {
    add(findings, 'MTR-APIREQ-004', `${path} must be a parseable ISO date-time string.`, path, ['api-validation']);
  }
}

function requireBoolean(request, findings, path) {
  const value = getPath(request, path);
  if (hasValue(value) && typeof value !== 'boolean') {
    add(findings, 'MTR-APIREQ-004', `${path} must be an explicit boolean.`, path, ['api-validation']);
  }
}

function requireIntegerRange(request, findings, path, min, max) {
  const value = getPath(request, path);
  if (!hasValue(value)) return;
  if (!Number.isInteger(value) || value < min || value > max) {
    add(findings, 'MTR-APIREQ-004', `${path} must be an integer from ${min} through ${max}.`, path, ['api-validation']);
  }
}

function requireMaxLength(request, findings, path, max) {
  const value = getPath(request, path);
  if (hasValue(value) && typeof value === 'string' && value.length > max) {
    add(findings, 'MTR-APIREQ-004', `${path} must be ${max} characters or fewer.`, path, ['api-validation']);
  }
}

function requireStringArrayEnum(request, findings, path, allowedValues) {
  const value = getPath(request, path);
  if (!hasValue(value)) return;
  if (!Array.isArray(value) || value.length === 0) {
    add(findings, 'MTR-APIREQ-004', `${path} must be a non-empty array when provided.`, path, ['api-validation']);
    return;
  }
  value.forEach((item, index) => {
    if (!allowedValues.includes(item)) {
      add(findings, 'MTR-APIREQ-004', `${path}[${index}] must be one of ${allowedValues.join(', ')}.`, `${path}[${index}]`, ['api-validation']);
    }
  });
}

function requireCustomFieldsObject(request, findings, path, options = {}) {
  const value = getPath(request, path);
  if (!hasValue(value)) return;
  if (!isPlainObject(value) || Object.keys(value).length === 0) {
    add(findings, 'MTR-APIREQ-004', `${path} must be a non-empty object of custom field string values.`, path, ['api-validation']);
    return;
  }

  const maxValueLength = options.maxValueLength || 200;
  for (const [key, fieldValue] of Object.entries(value)) {
    const fieldPath = `${path}.${key}`;
    if (!SAFE_IDENTIFIER_PATTERN.test(key)) {
      add(findings, 'MTR-APIREQ-004', `${fieldPath} must use a single safe custom field key.`, fieldPath, ['api-validation', 'danger-zone']);
    }
    if (typeof fieldValue !== 'string') {
      add(findings, 'MTR-APIREQ-004', `${fieldPath} must be a string value.`, fieldPath, ['api-validation', 'official-custom-fields-set-values']);
      continue;
    }
    if (fieldValue.length > maxValueLength) {
      add(findings, 'MTR-APIREQ-004', `${fieldPath} must be ${maxValueLength} characters or fewer.`, fieldPath, ['api-validation', 'official-custom-fields-set-values']);
    }
  }
}

function requireSafeIdentifierArray(request, findings, path) {
  const values = requireArray(request, findings, path);
  values.forEach((value, index) => {
    const itemPath = `${path}[${index}]`;
    if (!hasValue(value) || typeof value !== 'string' || !SAFE_IDENTIFIER_PATTERN.test(value)) {
      add(findings, 'MTR-APIREQ-004', `${itemPath} must be a single safe identifier.`, itemPath, ['api-validation']);
    }
  });
  return values;
}

function validateSafeStringArrayValue(value, findings, path) {
  if (!hasValue(value)) return [];
  if (!Array.isArray(value) || value.length === 0) {
    add(findings, 'MTR-APIREQ-004', `${path} must be a non-empty array when provided.`, path, ['api-validation']);
    return [];
  }
  value.forEach((item, index) => {
    const itemPath = `${path}[${index}]`;
    if (!hasValue(item) || typeof item !== 'string' || !SAFE_IDENTIFIER_PATTERN.test(item)) {
      add(findings, 'MTR-APIREQ-004', `${itemPath} must be a safe non-empty string.`, itemPath, ['api-validation']);
    }
  });
  return value;
}

function validateOptionalSafeStringArray(request, findings, path) {
  return validateSafeStringArrayValue(getPath(request, path), findings, path);
}

function validateNonEmptyStringArrayValue(value, findings, path) {
  if (!hasValue(value)) return [];
  if (!Array.isArray(value) || value.length === 0) {
    add(findings, 'MTR-APIREQ-004', `${path} must be a non-empty array when provided.`, path, ['api-validation']);
    return [];
  }
  value.forEach((item, index) => {
    const itemPath = `${path}[${index}]`;
    if (!hasValue(item) || typeof item !== 'string') {
      add(findings, 'MTR-APIREQ-004', `${itemPath} must be a non-empty string.`, itemPath, ['api-validation']);
    }
  });
  return value;
}

function validateOptionalNonEmptyStringArray(request, findings, path) {
  return validateNonEmptyStringArrayValue(getPath(request, path), findings, path);
}

function validateQuantityConversion(request, findings, path) {
  const value = getPath(request, path);
  if (!hasValue(value)) return;
  if (!isPlainObject(value)) {
    add(findings, 'MTR-APIREQ-004', `${path} must be an object with name, conversion_factor, and operation.`, path, ['api-validation', 'official-product-create']);
    return;
  }

  requirePath(request, findings, `${path}.name`);
  requireNonEmptyString(request, findings, `${path}.name`);
  requirePath(request, findings, `${path}.conversion_factor`);
  requirePath(request, findings, `${path}.operation`);
  const conversionFactor = getPath(request, `${path}.conversion_factor`);
  if (hasValue(conversionFactor) && (!Number.isFinite(conversionFactor) || conversionFactor <= 0)) {
    add(findings, 'MTR-APIREQ-004', `${path}.conversion_factor must be a positive number.`, `${path}.conversion_factor`, ['api-validation', 'official-product-create']);
  }
  requireEnum(request, findings, `${path}.operation`, ['multiply', 'divide', 'MULTIPLY', 'DIVIDE']);

  for (const key of Object.keys(value)) {
    if (!['name', 'conversion_factor', 'operation'].includes(key)) {
      add(findings, 'MTR-APIREQ-002', `${path}.${key} is not part of the reviewed quantity_conversion contract.`, `${path}.${key}`, ['api-validation', 'official-product-create']);
    }
  }
}

function validateQuantityRounding(request, findings, path) {
  const value = getPath(request, path);
  if (!hasValue(value)) return;
  if (!isPlainObject(value)) {
    add(findings, 'MTR-APIREQ-004', `${path} must be an object with rounding_method and decimal_places.`, path, ['api-validation', 'official-product-create']);
    return;
  }

  requirePath(request, findings, `${path}.rounding_method`);
  requirePath(request, findings, `${path}.decimal_places`);
  requireEnum(request, findings, `${path}.rounding_method`, ['round_up', 'round_down', 'round_half_up', 'ROUND_UP', 'ROUND_DOWN', 'ROUND_HALF_UP']);
  const decimalPlaces = getPath(request, `${path}.decimal_places`);
  if (hasValue(decimalPlaces) && (!Number.isInteger(decimalPlaces) || decimalPlaces < 0)) {
    add(findings, 'MTR-APIREQ-004', `${path}.decimal_places must be a non-negative integer.`, `${path}.decimal_places`, ['api-validation', 'official-product-create']);
  }

  for (const key of Object.keys(value)) {
    if (!['rounding_method', 'decimal_places'].includes(key)) {
      add(findings, 'MTR-APIREQ-002', `${path}.${key} is not part of the reviewed quantity_rounding contract.`, `${path}.${key}`, ['api-validation', 'official-product-create']);
    }
  }
}

function validateEventTypeFilter(request, findings, path) {
  const filter = getPath(request, path);
  if (!hasValue(filter)) return;
  if (!isPlainObject(filter)) {
    add(findings, 'MTR-APIREQ-004', `${path} must be an object with in_values or not_in_values arrays.`, path, ['api-validation', 'official-billable-metric-create']);
    return;
  }
  forbidPath(request, findings, `${path}.value`, 'event_type_filter uses in_values/not_in_values arrays, not value.');
  forbidPath(request, findings, `${path}.values`, 'event_type_filter uses in_values/not_in_values arrays, not values.');
  validateOptionalSafeStringArray(request, findings, `${path}.in_values`);
  validateOptionalSafeStringArray(request, findings, `${path}.not_in_values`);
  for (const key of Object.keys(filter)) {
    if (!['in_values', 'not_in_values'].includes(key)) {
      add(findings, 'MTR-APIREQ-002', `${path}.${key} is not part of the reviewed event_type_filter contract.`, `${path}.${key}`, ['api-validation', 'official-billable-metric-create']);
    }
  }
  if (!pathExists(request, `${path}.in_values`) && !pathExists(request, `${path}.not_in_values`)) {
    add(findings, 'MTR-APIREQ-001', `${path} must include at least one non-empty in_values or not_in_values array in the reviewed local contract.`, path, ['api-validation', 'metronome-billable-metrics']);
  }
}

function validatePropertyFilters(request, findings, path) {
  const filters = requireArray(request, findings, path);
  const names = [];
  filters.forEach((filter, index) => {
    const filterPath = `${path}[${index}]`;
    if (!isPlainObject(filter)) {
      add(findings, 'MTR-APIREQ-004', `${filterPath} must be an object.`, filterPath, ['api-validation', 'official-billable-metric-create']);
      return;
    }
    if (!hasValue(filter.name)) {
      add(findings, 'MTR-APIREQ-001', `${filterPath}.name is required.`, `${filterPath}.name`, ['api-validation', 'official-billable-metric-create']);
    } else if (typeof filter.name !== 'string' || !SAFE_IDENTIFIER_PATTERN.test(filter.name)) {
      add(findings, 'MTR-APIREQ-004', `${filterPath}.name must be a safe event property identifier.`, `${filterPath}.name`, ['api-validation', 'metronome-billable-metrics']);
    } else {
      names.push(filter.name);
    }
    if (hasValue(filter.exists) && typeof filter.exists !== 'boolean') {
      add(findings, 'MTR-APIREQ-004', `${filterPath}.exists must be an explicit boolean when provided.`, `${filterPath}.exists`, ['api-validation', 'official-billable-metric-create']);
    }
    validateSafeStringArrayValue(filter.in_values, findings, `${filterPath}.in_values`);
    validateSafeStringArrayValue(filter.not_in_values, findings, `${filterPath}.not_in_values`);
    for (const key of Object.keys(filter)) {
      if (!['name', 'exists', 'in_values', 'not_in_values'].includes(key)) {
        add(findings, 'MTR-APIREQ-002', `${filterPath}.${key} is not part of the reviewed property_filters contract.`, `${filterPath}.${key}`, ['api-validation', 'official-billable-metric-create']);
      }
    }
  });
  return names;
}

function validateBillableMetricGroupKeys(request, findings, path, propertyFilterNames) {
  const groups = getPath(request, path);
  if (!hasValue(groups)) return;
  if (!Array.isArray(groups) || groups.length === 0) {
    add(findings, 'MTR-APIREQ-004', `${path} must be a non-empty array of non-empty string arrays when provided.`, path, ['api-validation', 'official-billable-metric-create']);
    return;
  }
  const propertyNameSet = new Set(propertyFilterNames);
  groups.forEach((group, groupIndex) => {
    const groupPath = `${path}[${groupIndex}]`;
    if (!Array.isArray(group) || group.length === 0) {
      add(findings, 'MTR-APIREQ-004', `${groupPath} must be a non-empty array of event property names.`, groupPath, ['api-validation', 'metronome-billable-metrics']);
      return;
    }
    group.forEach((key, keyIndex) => {
      const keyPath = `${groupPath}[${keyIndex}]`;
      if (!hasValue(key) || typeof key !== 'string' || !SAFE_IDENTIFIER_PATTERN.test(key)) {
        add(findings, 'MTR-APIREQ-004', `${keyPath} must be a safe event property identifier.`, keyPath, ['api-validation', 'metronome-billable-metrics']);
        return;
      }
      if (!propertyNameSet.has(key)) {
        add(findings, 'MTR-APIREQ-004', `${keyPath} must also appear in body.property_filters[].name for the reviewed local billable metric contract.`, keyPath, ['api-validation', 'metronome-billable-metrics']);
      }
    });
  });
}

function validateRateCardAliases(request, findings, path) {
  const aliases = getPath(request, path);
  if (aliases === undefined || aliases === null) return [];
  if (!Array.isArray(aliases) || aliases.length === 0) {
    add(findings, 'MTR-APIREQ-004', `${path} must be a non-empty array when provided.`, path, ['api-validation', 'official-rate-card-create']);
    return [];
  }

  aliases.forEach((alias, index) => {
    const aliasPath = `${path}[${index}]`;
    if (!isPlainObject(alias)) {
      add(findings, 'MTR-APIREQ-004', `${aliasPath} must be an object with name and optional schedule timestamps.`, aliasPath, ['api-validation', 'official-rate-card-create']);
      return;
    }
    if (!hasValue(alias.name)) {
      add(findings, 'MTR-APIREQ-001', `${aliasPath}.name is required.`, `${aliasPath}.name`, ['api-validation', 'official-rate-card-create']);
    } else if (typeof alias.name !== 'string' || !SAFE_IDENTIFIER_PATTERN.test(alias.name)) {
      add(findings, 'MTR-APIREQ-004', `${aliasPath}.name must be a single safe alias identifier.`, `${aliasPath}.name`, ['api-validation', 'official-rate-card-create']);
    }
    for (const scheduleKey of ['starting_at', 'ending_before']) {
      const schedulePath = `${aliasPath}.${scheduleKey}`;
      const value = alias[scheduleKey];
      if (hasValue(value) && !isHourBoundaryUTC(value)) {
        add(findings, 'MTR-TIME-001', `${schedulePath} must be a UTC hour-boundary timestamp in the reviewed local contract.`, schedulePath, ['api-validation', 'official-rate-card-create', 'conventions']);
      }
    }
    const startingAt = alias.starting_at;
    const endingBefore = alias.ending_before;
    if (hasValue(startingAt) && hasValue(endingBefore) && Date.parse(endingBefore) <= Date.parse(startingAt)) {
      add(findings, 'MTR-APIREQ-004', `${aliasPath}.ending_before must be after ${aliasPath}.starting_at.`, `${aliasPath}.ending_before`, ['api-validation', 'official-rate-card-create']);
    }
    for (const key of Object.keys(alias)) {
      if (!['name', 'starting_at', 'ending_before'].includes(key)) {
        add(findings, 'MTR-APIREQ-002', `${aliasPath}.${key} is not part of the reviewed rate-card alias contract.`, `${aliasPath}.${key}`, ['api-validation', 'official-rate-card-create']);
      }
    }
  });

  return aliases;
}

function validatePackageAliases(request, findings, path) {
  const aliases = requireArray(request, findings, path);
  aliases.forEach((alias, index) => {
    const aliasPath = `${path}[${index}]`;
    if (!isPlainObject(alias)) {
      add(findings, 'MTR-APIREQ-004', `${aliasPath} must be an object with name and explicit starting_at.`, aliasPath, ['api-validation', 'official-package-create']);
      return;
    }
    if (!hasValue(alias.name)) {
      add(findings, 'MTR-PKG-001', `${aliasPath}.name is required for package alias handoff validation.`, `${aliasPath}.name`, ['api-validation', 'official-package-create']);
    } else if (typeof alias.name !== 'string' || !SAFE_IDENTIFIER_PATTERN.test(alias.name)) {
      add(findings, 'MTR-APIREQ-004', `${aliasPath}.name must be a single safe package alias identifier.`, `${aliasPath}.name`, ['api-validation', 'official-package-create']);
    }
    if (!hasValue(alias.starting_at)) {
      add(findings, 'MTR-APIREQ-001', `${aliasPath}.starting_at is required by the reviewed local package alias handoff contract.`, `${aliasPath}.starting_at`, ['api-validation', 'official-package-create', 'endpoint-matrix']);
    } else if (!isHourBoundaryUTC(alias.starting_at)) {
      add(findings, 'MTR-TIME-001', `${aliasPath}.starting_at must be a UTC hour-boundary timestamp.`, `${aliasPath}.starting_at`, ['api-validation', 'official-package-create', 'conventions']);
    }
    if (hasValue(alias.ending_before) && !isHourBoundaryUTC(alias.ending_before)) {
      add(findings, 'MTR-TIME-001', `${aliasPath}.ending_before must be a UTC hour-boundary timestamp.`, `${aliasPath}.ending_before`, ['api-validation', 'official-package-create', 'conventions']);
    }
    if (hasValue(alias.starting_at) && hasValue(alias.ending_before) && Date.parse(alias.ending_before) <= Date.parse(alias.starting_at)) {
      add(findings, 'MTR-APIREQ-004', `${aliasPath}.ending_before must be after ${aliasPath}.starting_at.`, `${aliasPath}.ending_before`, ['api-validation', 'official-package-create']);
    }
    for (const key of Object.keys(alias)) {
      if (!['name', 'starting_at', 'ending_before'].includes(key)) {
        add(findings, 'MTR-APIREQ-002', `${aliasPath}.${key} is not part of the reviewed package alias contract.`, `${aliasPath}.${key}`, ['api-validation', 'official-package-create']);
      }
    }
  });
  return aliases;
}

function validatePackageDuration(request, findings, path) {
  const duration = getPath(request, path);
  if (!hasValue(duration)) {
    add(findings, 'MTR-APIREQ-001', `${path} is required by the reviewed local package terms contract.`, path, ['api-validation', 'official-package-create']);
    return;
  }
  if (!isPlainObject(duration)) {
    add(findings, 'MTR-APIREQ-004', `${path} must be an object with value and unit.`, path, ['api-validation', 'official-package-create']);
    return;
  }
  requirePath(request, findings, `${path}.value`);
  requirePath(request, findings, `${path}.unit`);
  requireIntegerRange(request, findings, `${path}.value`, 1, 1200);
  requireEnum(request, findings, `${path}.unit`, ['DAYS', 'WEEKS', 'MONTHS', 'YEARS', 'days', 'weeks', 'months', 'years']);
  for (const key of Object.keys(duration)) {
    if (!['value', 'unit'].includes(key)) {
      add(findings, 'MTR-APIREQ-002', `${path}.${key} is not part of the reviewed package duration contract.`, `${path}.${key}`, ['api-validation', 'official-package-create']);
    }
  }
}

function validatePackageContractTemplate(request, findings, path, { topLevel = false } = {}) {
  const contract = getPath(request, path);
  if (!hasValue(contract)) {
    add(findings, 'MTR-APIREQ-001', `${path} is required as local reviewed contract-template evidence for package creation.`, path, ['api-validation', 'official-package-create']);
    return;
  }
  if (!isPlainObject(contract)) {
    add(findings, 'MTR-APIREQ-004', `${path} must be an object with reviewed package contract-template evidence.`, path, ['api-validation', 'official-package-create']);
    return;
  }
  requirePath(request, findings, `${path}.usage_statement_schedule.frequency`, 'Package create validation requires reviewed usage statement frequency evidence.');
  requireEnum(request, findings, `${path}.usage_statement_schedule.frequency`, ['MONTHLY', 'monthly', 'QUARTERLY', 'quarterly', 'ANNUAL', 'annual', 'WEEKLY', 'weekly']);
  requirePath(request, findings, `${path}.scheduled_charges_on_usage_invoices`, 'Package create validation requires invoice consolidation behavior evidence.');
  requireEnum(request, findings, `${path}.scheduled_charges_on_usage_invoices`, ['ALL']);
  if (hasValue(getPath(request, `${path}.usage_statement_schedule`)) && !isPlainObject(getPath(request, `${path}.usage_statement_schedule`))) {
    add(findings, 'MTR-APIREQ-004', `${path}.usage_statement_schedule must be an object.`, `${path}.usage_statement_schedule`, ['api-validation', 'official-package-create']);
  } else if (isPlainObject(getPath(request, `${path}.usage_statement_schedule`))) {
    // day: CONTRACT_START gives anniversary usage windows; omitting it means
    // Metronome's FIRST_OF_MONTH default.
    // https://docs.metronome.com/api-reference/contracts/create-a-package
    if (hasValue(getPath(request, `${path}.usage_statement_schedule.day`))) {
      requireEnum(request, findings, `${path}.usage_statement_schedule.day`, ['CONTRACT_START', 'FIRST_OF_MONTH']);
    }
    for (const key of Object.keys(getPath(request, `${path}.usage_statement_schedule`))) {
      if (!['frequency', 'day'].includes(key)) {
        add(findings, 'MTR-APIREQ-002', `${path}.usage_statement_schedule.${key} is not part of the reviewed local package contract-template evidence.`, `${path}.usage_statement_schedule.${key}`, ['api-validation', 'official-package-create']);
      }
    }
  }
  if (topLevel) return;
  for (const key of Object.keys(contract)) {
    if (!['usage_statement_schedule', 'scheduled_charges_on_usage_invoices'].includes(key)) {
      add(findings, 'MTR-APIREQ-002', `${path}.${key} is not part of the reviewed local package contract-template evidence.`, `${path}.${key}`, ['api-validation', 'official-package-create']);
    }
  }
}

function validateCreditTypeConversions(request, findings, path) {
  const conversions = getPath(request, path);
  if (conversions === undefined || conversions === null) return [];
  if (!Array.isArray(conversions) || conversions.length === 0) {
    add(findings, 'MTR-APIREQ-004', `${path} must be a non-empty array when provided.`, path, ['api-validation', 'official-rate-card-create']);
    return [];
  }

  conversions.forEach((conversion, index) => {
    const conversionPath = `${path}[${index}]`;
    if (!isPlainObject(conversion)) {
      add(findings, 'MTR-APIREQ-004', `${conversionPath} must be an object with custom_credit_type_id and fiat_per_custom_credit.`, conversionPath, ['api-validation', 'official-rate-card-create']);
      return;
    }
    if (!hasValue(conversion.custom_credit_type_id)) {
      add(findings, 'MTR-APIREQ-001', `${conversionPath}.custom_credit_type_id is required.`, `${conversionPath}.custom_credit_type_id`, ['api-validation', 'official-rate-card-create']);
    } else if (typeof conversion.custom_credit_type_id !== 'string' || !SAFE_IDENTIFIER_PATTERN.test(conversion.custom_credit_type_id)) {
      add(findings, 'MTR-APIREQ-004', `${conversionPath}.custom_credit_type_id must be a single safe identifier.`, `${conversionPath}.custom_credit_type_id`, ['api-validation', 'official-rate-card-create']);
    }
    if (!hasValue(conversion.fiat_per_custom_credit)) {
      add(findings, 'MTR-APIREQ-001', `${conversionPath}.fiat_per_custom_credit is required.`, `${conversionPath}.fiat_per_custom_credit`, ['api-validation', 'official-rate-card-create']);
    } else if (!Number.isFinite(conversion.fiat_per_custom_credit) || conversion.fiat_per_custom_credit <= 0) {
      add(findings, 'MTR-APIREQ-004', `${conversionPath}.fiat_per_custom_credit must be a positive number.`, `${conversionPath}.fiat_per_custom_credit`, ['api-validation', 'official-rate-card-create', 'metronome-pricing-catalog']);
    }
    for (const key of Object.keys(conversion)) {
      if (!['custom_credit_type_id', 'fiat_per_custom_credit'].includes(key)) {
        add(findings, 'MTR-APIREQ-002', `${conversionPath}.${key} is not part of the reviewed credit_type_conversions contract.`, `${conversionPath}.${key}`, ['api-validation', 'official-rate-card-create']);
      }
    }
  });

  return conversions;
}

function forbidBodyKeysExcept(request, findings, allowedKeys, message) {
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(request.body || {})) {
    if (!allowed.has(key)) {
      add(
        findings,
        'MTR-APIREQ-002',
        message || `body.${key} is not part of the reviewed endpoint request contract.`,
        `body.${key}`,
        ['api-validation'],
      );
    }
  }
}

function forbidQueryKeysExcept(request, findings, allowedKeys, message) {
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(request.query || {})) {
    if (!allowed.has(key)) {
      add(
        findings,
        'MTR-APIREQ-002',
        message || `query.${key} is not part of the reviewed endpoint request contract.`,
        `query.${key}`,
        ['api-validation'],
      );
    }
  }
}

function forbidPathKeysExcept(request, findings, allowedKeys, message) {
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(request.path || {})) {
    if (!allowed.has(key)) {
      add(
        findings,
        'MTR-APIREQ-002',
        message || `path.${key} is not part of the reviewed endpoint request contract.`,
        `path.${key}`,
        ['api-validation'],
      );
    }
  }
}

function validateRateSelectors(request, findings, path) {
  const selectors = getPath(request, path);
  if (!hasValue(selectors)) return;
  if (!Array.isArray(selectors)) {
    add(findings, 'MTR-APIREQ-004', `${path} must be an array when provided.`, path, ['api-validation']);
    return;
  }
  const allowedKeys = new Set([
    'billing_frequency',
    'product_id',
    'product_tags',
    'pricing_group_values',
    'partial_pricing_group_values',
  ]);
  selectors.forEach((selector, index) => {
    const selectorPath = `${path}[${index}]`;
    if (!isPlainObject(selector)) {
      add(findings, 'MTR-APIREQ-004', `${selectorPath} must be an object.`, selectorPath, ['api-validation']);
      return;
    }
    for (const key of Object.keys(selector)) {
      if (!allowedKeys.has(key)) {
        add(findings, 'MTR-APIREQ-002', `${selectorPath}.${key} is not part of the reviewed rate selector contract.`, `${selectorPath}.${key}`, ['api-validation']);
      }
    }
    if (hasValue(selector.product_id) && (typeof selector.product_id !== 'string' || !SAFE_IDENTIFIER_PATTERN.test(selector.product_id))) {
      add(findings, 'MTR-APIREQ-004', `${selectorPath}.product_id must be a single safe identifier.`, `${selectorPath}.product_id`, ['api-validation']);
    }
    if (hasValue(selector.billing_frequency) && !['MONTHLY', 'Monthly', 'monthly', 'QUARTERLY', 'Quarterly', 'quarterly', 'ANNUAL', 'Annual', 'annual', 'WEEKLY', 'Weekly', 'weekly'].includes(selector.billing_frequency)) {
      add(findings, 'MTR-APIREQ-004', `${selectorPath}.billing_frequency is not an official getRates billing frequency.`, `${selectorPath}.billing_frequency`, ['api-validation']);
    }
    if (hasValue(selector.product_tags) && (!Array.isArray(selector.product_tags) || selector.product_tags.some((tag) => typeof tag !== 'string' || tag.trim() === ''))) {
      add(findings, 'MTR-APIREQ-004', `${selectorPath}.product_tags must be an array of non-empty strings.`, `${selectorPath}.product_tags`, ['api-validation']);
    }
    for (const objectKey of ['pricing_group_values', 'partial_pricing_group_values']) {
      if (hasValue(selector[objectKey])) {
        if (!isPlainObject(selector[objectKey])) {
          add(findings, 'MTR-APIREQ-004', `${selectorPath}.${objectKey} must be an object of string values.`, `${selectorPath}.${objectKey}`, ['api-validation']);
        } else {
          for (const [key, value] of Object.entries(selector[objectKey])) {
            if (typeof value !== 'string' || value.trim() === '') {
              add(findings, 'MTR-APIREQ-004', `${selectorPath}.${objectKey}.${key} must be a non-empty string.`, `${selectorPath}.${objectKey}.${key}`, ['api-validation']);
            }
          }
        }
      }
    }
  });
}

function requireEventBatch(request, findings, path, options = {}) {
  const events = requireArray(request, findings, path, { max: options.max || 100 });
  events.forEach((event, index) => {
    for (const field of ['customer_id', 'event_type', 'timestamp', 'transaction_id']) {
      if (!isPlainObject(event) || !hasValue(event[field])) {
        add(findings, 'MTR-APIREQ-001', `${path}[${index}].${field} is required.`, `${path}[${index}].${field}`, ['api-validation', 'official-usage-ingest']);
      }
    }
    if (isPlainObject(event) && hasValue(event.timestamp) && Number.isNaN(Date.parse(event.timestamp))) {
      add(findings, 'MTR-APIREQ-004', `${path}[${index}].timestamp must be parseable as an ISO timestamp.`, `${path}[${index}].timestamp`, ['api-validation']);
    }
    if (isPlainObject(event) && hasValue(event.transaction_id) && !SAFE_IDENTIFIER_PATTERN.test(event.transaction_id)) {
      add(findings, 'MTR-IDEMP-002', `${path}[${index}].transaction_id must be a stable safe identifier.`, `${path}[${index}].transaction_id`, ['api-validation']);
    }
  });
}

function requireRateCardCloseEvidence(request, findings) {
  const verified = getPath(request, 'evidence.rateCardCloseVerified');
  if (verified !== true) {
    add(findings, 'MTR-RATE-003', 'evidence.rateCardCloseVerified must be true before product archive validation can pass.', 'evidence.rateCardCloseVerified', ['api-validation', 'danger-zone']);
  }
}

function validateCustomerIngestAliases(request, findings, path) {
  const aliases = requireArray(request, findings, path);
  const seen = new Set();
  aliases.forEach((alias, index) => {
    const aliasPath = `${path}[${index}]`;
    if (!hasValue(alias) || typeof alias !== 'string' || !SAFE_IDENTIFIER_PATTERN.test(alias)) {
      add(findings, 'MTR-CUST-001', `${aliasPath} must be a single safe ingest alias identifier.`, aliasPath, ['api-validation', 'customers-hierarchies']);
      return;
    }
    if (seen.has(alias)) {
      add(findings, 'MTR-CUST-002', `${aliasPath} duplicates another ingest alias in the same request.`, aliasPath, ['api-validation', 'customers-hierarchies']);
      return;
    }
    seen.add(alias);
  });
  return aliases;
}

function validateCustomerBillingProviderConfigurations(request, findings, path) {
  const configs = getPath(request, path);
  if (!hasValue(configs)) return [];
  if (!Array.isArray(configs) || configs.length === 0) {
    add(findings, 'MTR-BILL-002', `${path} must be a non-empty array when provided.`, path, ['api-validation', 'metronome-stripe-delivery']);
    return [];
  }

  configs.forEach((config, index) => {
    const configPath = `${path}[${index}]`;
    if (!isPlainObject(config)) {
      add(findings, 'MTR-BILL-002', `${configPath} must be an object with billing_provider, configuration, and delivery method fields.`, configPath, ['api-validation', 'metronome-stripe-delivery']);
      return;
    }
    if (!hasValue(config.billing_provider)) {
      add(findings, 'MTR-APIREQ-001', `${configPath}.billing_provider is required for inline customer billing-provider configuration.`, `${configPath}.billing_provider`, ['api-validation', 'metronome-stripe-delivery']);
    } else if (config.billing_provider !== 'stripe') {
      add(findings, 'MTR-APIREQ-004', `${configPath}.billing_provider must be stripe.`, `${configPath}.billing_provider`, ['api-validation', 'metronome-stripe-delivery']);
    }
    if (!hasValue(config.delivery_method) && !hasValue(config.delivery_method_id)) {
      add(findings, 'MTR-APIREQ-001', `${configPath} requires delivery_method or delivery_method_id.`, configPath, ['api-validation', 'metronome-stripe-delivery']);
    }
    if (hasValue(config.delivery_method) && hasValue(config.delivery_method_id)) {
      add(findings, 'MTR-BILL-002', `${configPath} must use delivery_method or delivery_method_id, not both.`, configPath, ['api-validation', 'metronome-stripe-delivery']);
    }
    if (!isPlainObject(config.configuration)) {
      add(findings, 'MTR-BILL-002', `${configPath}.configuration must be an object.`, `${configPath}.configuration`, ['api-validation', 'metronome-stripe-delivery']);
    } else {
      if (!hasValue(config.configuration.stripe_customer_id)) {
        add(findings, 'MTR-APIREQ-001', `${configPath}.configuration.stripe_customer_id is required for Stripe configuration.`, `${configPath}.configuration.stripe_customer_id`, ['api-validation', 'metronome-stripe-delivery']);
      } else if (typeof config.configuration.stripe_customer_id !== 'string' || !SAFE_IDENTIFIER_PATTERN.test(config.configuration.stripe_customer_id)) {
        add(findings, 'MTR-APIREQ-004', `${configPath}.configuration.stripe_customer_id must be a single safe identifier.`, `${configPath}.configuration.stripe_customer_id`, ['api-validation', 'metronome-stripe-delivery']);
      }
      if (hasValue(config.configuration.stripe_collection_method) && !['charge_automatically', 'send_invoice'].includes(config.configuration.stripe_collection_method)) {
        add(findings, 'MTR-APIREQ-004', `${configPath}.configuration.stripe_collection_method must be one of charge_automatically, send_invoice.`, `${configPath}.configuration.stripe_collection_method`, ['api-validation', 'metronome-stripe-delivery']);
      }
      for (const key of Object.keys(config.configuration)) {
        if (!['stripe_customer_id', 'stripe_collection_method'].includes(key)) {
          add(findings, 'MTR-APIREQ-002', `${configPath}.configuration.${key} is not part of the reviewed inline customer billing-provider contract.`, `${configPath}.configuration.${key}`, ['api-validation', 'metronome-stripe-delivery']);
        }
      }
    }
    if (hasValue(config.delivery_method_id) && (typeof config.delivery_method_id !== 'string' || !SAFE_IDENTIFIER_PATTERN.test(config.delivery_method_id))) {
      add(findings, 'MTR-APIREQ-004', `${configPath}.delivery_method_id must be a single safe identifier.`, `${configPath}.delivery_method_id`, ['api-validation', 'metronome-stripe-delivery']);
    }
    if (hasValue(config.delivery_method) && config.delivery_method !== 'direct_to_billing_provider') {
      add(findings, 'MTR-APIREQ-004', `${configPath}.delivery_method must be direct_to_billing_provider.`, `${configPath}.delivery_method`, ['api-validation', 'metronome-stripe-delivery']);
    }
    for (const key of Object.keys(config)) {
      if (!['billing_provider', 'configuration', 'delivery_method', 'delivery_method_id'].includes(key)) {
        add(findings, 'MTR-APIREQ-002', `${configPath}.${key} is not part of the reviewed inline customer billing-provider contract.`, `${configPath}.${key}`, ['api-validation', 'metronome-stripe-delivery']);
      }
    }
  });

  return configs;
}

function forbidRawEndpointPathFields(request, findings, endpointId, reviewedPath) {
  for (const path of ['body.path', 'query.path', 'path.path', 'body.url', 'query.url', 'path.url', 'body.method', 'query.method', 'path.method']) {
    forbidPath(request, findings, path, `Use endpoint id ${endpointId} and the reviewed ${reviewedPath} path/method; do not include raw endpoint path, URL, or method fields in request files.`);
  }
}

const VALIDATION_DEFINITIONS = {
  'usage.ingest': {
    checked: ['secret scan', 'events batch', 'required event fields', 'transaction_id idempotency'],
    apply(request, findings) {
      requireEventBatch(request, findings, 'body.events', { max: 100 });
    },
  },
  'usage.groups': {
    checked: ['secret scan', 'POST body customer/metric/window', 'query pagination', 'deprecated group_by refusal'],
    apply(request, findings) {
      requirePath(request, findings, 'body.customer_id');
      requirePath(request, findings, 'body.billable_metric_id');
      requirePath(request, findings, 'body.window_size');
      requirePath(request, findings, 'body.starting_on');
      requirePath(request, findings, 'body.ending_before');
      requireHourBoundary(request, findings, 'body.starting_on');
      requireHourBoundary(request, findings, 'body.ending_before');
      if (pathExists(request, 'body.group_key')) {
        requireArray(request, findings, 'body.group_key');
      }
      forbidPath(request, findings, 'query.customer_id', 'usage.groups is a POST read; customer_id belongs in the JSON body.');
      forbidPath(request, findings, 'query.starting_on', 'usage.groups is a POST read; starting_on belongs in the JSON body.');
      forbidPath(request, findings, 'query.ending_before', 'usage.groups is a POST read; ending_before belongs in the JSON body.');
      forbidPath(request, findings, 'query.group_by', 'usage.groups should use body.group_key; query.group_by is not part of the reviewed request contract.');
      forbidPath(request, findings, 'body.limit', 'usage.groups pagination limit belongs in query.limit, not the POST body.');
      forbidPath(request, findings, 'body.next_page', 'usage.groups pagination next_page belongs in query.next_page, not the POST body.');
      forbidPath(request, findings, 'body.group_by', 'usage.groups group_by is deprecated; use body.group_key and body.group_filters.');
      forbidPath(request, findings, 'body.current_period', 'usage.groups current_period is not in the reviewed local contract; use explicit starting_on and ending_before.');
    },
  },
  'usage.batch': {
    checked: ['secret scan', 'POST body usage window', 'optional customer and metric filters', 'query pagination', 'query/body placement refusal'],
    apply(request, findings) {
      requirePath(request, findings, 'body.window_size');
      requirePath(request, findings, 'body.starting_on');
      requirePath(request, findings, 'body.ending_before');
      requireEnum(request, findings, 'body.window_size', ['hour', 'day', 'none', 'HOUR', 'DAY', 'NONE', 'Hour', 'Day', 'None']);
      requireHourBoundary(request, findings, 'body.starting_on');
      requireHourBoundary(request, findings, 'body.ending_before');
      if (pathExists(request, 'body.customer_ids')) {
        const customerIds = requireArray(request, findings, 'body.customer_ids');
        customerIds.forEach((customerId, index) => {
          const path = `body.customer_ids[${index}]`;
          if (!hasValue(customerId)) {
            add(findings, 'MTR-APIREQ-001', `${path} must be a non-empty customer identifier.`, path, ['api-validation', 'official-usage-batch']);
          } else if (typeof customerId !== 'string' || !SAFE_IDENTIFIER_PATTERN.test(customerId)) {
            add(findings, 'MTR-APIREQ-004', `${path} must be a single safe identifier.`, path, ['api-validation', 'official-usage-batch']);
          }
        });
      }
      if (pathExists(request, 'body.billable_metrics')) {
        const metrics = requireArray(request, findings, 'body.billable_metrics');
        metrics.forEach((metric, index) => {
          const metricPath = `body.billable_metrics[${index}]`;
          if (!isPlainObject(metric)) {
            add(findings, 'MTR-APIREQ-004', `${metricPath} must be an object with an id.`, metricPath, ['api-validation', 'official-usage-batch']);
            return;
          }
          if (!hasValue(metric.id)) {
            add(findings, 'MTR-APIREQ-001', `${metricPath}.id is required.`, `${metricPath}.id`, ['api-validation', 'official-usage-batch']);
          } else if (typeof metric.id !== 'string' || !SAFE_IDENTIFIER_PATTERN.test(metric.id)) {
            add(findings, 'MTR-APIREQ-004', `${metricPath}.id must be a single safe identifier.`, `${metricPath}.id`, ['api-validation', 'official-usage-batch']);
          }
          if (metric.group_by !== undefined) {
            if (!isPlainObject(metric.group_by)) {
              add(findings, 'MTR-APIREQ-004', `${metricPath}.group_by must be an object with key and optional values.`, `${metricPath}.group_by`, ['api-validation', 'official-usage-batch']);
            } else {
              if (!hasValue(metric.group_by.key)) {
                add(findings, 'MTR-APIREQ-001', `${metricPath}.group_by.key is required when group_by is provided.`, `${metricPath}.group_by.key`, ['api-validation', 'official-usage-batch']);
              }
              if (metric.group_by.values !== undefined) {
                if (!Array.isArray(metric.group_by.values) || metric.group_by.values.length === 0) {
                  add(findings, 'MTR-APIREQ-001', `${metricPath}.group_by.values must be a non-empty array when provided.`, `${metricPath}.group_by.values`, ['api-validation', 'official-usage-batch']);
                } else if (metric.group_by.values.length > 200) {
                  add(findings, 'MTR-APIREQ-004', `${metricPath}.group_by.values has ${metric.group_by.values.length} item(s); the official contract allows at most 200.`, `${metricPath}.group_by.values`, ['api-validation', 'official-usage-batch']);
                } else {
                  metric.group_by.values.forEach((value, valueIndex) => {
                    if (!hasValue(value) || typeof value !== 'string') {
                      add(findings, 'MTR-APIREQ-004', `${metricPath}.group_by.values[${valueIndex}] must be a non-empty string.`, `${metricPath}.group_by.values[${valueIndex}]`, ['api-validation', 'official-usage-batch']);
                    }
                  });
                }
              }
            }
          }
        });
      }
      forbidPath(request, findings, 'query.customer_ids', 'usage.batch is a POST read; customer_ids belongs in the JSON body.');
      forbidPath(request, findings, 'query.billable_metrics', 'usage.batch is a POST read; billable_metrics belongs in the JSON body.');
      forbidPath(request, findings, 'query.window_size', 'usage.batch is a POST read; window_size belongs in the JSON body.');
      forbidPath(request, findings, 'query.starting_on', 'usage.batch is a POST read; starting_on belongs in the JSON body.');
      forbidPath(request, findings, 'query.ending_before', 'usage.batch is a POST read; ending_before belongs in the JSON body.');
      forbidPath(request, findings, 'body.next_page', 'usage.batch pagination next_page belongs in query.next_page, not the POST body.');
    },
  },
  'events.search': {
    checked: ['secret scan', 'transactionIds array', 'stale singular transaction_id refusal'],
    apply(request, findings) {
      const transactionIds = requireArray(request, findings, 'body.transactionIds');
      transactionIds.forEach((transactionId, index) => {
        const path = `body.transactionIds[${index}]`;
        if (!hasValue(transactionId)) {
          add(findings, 'MTR-APIREQ-001', `${path} must be a non-empty transaction ID string.`, path, ['api-validation', 'official-event-search']);
        } else if (typeof transactionId !== 'string' || !SAFE_IDENTIFIER_PATTERN.test(transactionId)) {
          add(findings, 'MTR-APIREQ-004', `${path} must be a single safe identifier.`, path, ['api-validation', 'official-event-search']);
        }
      });
      forbidPath(request, findings, 'body.transaction_id', 'events.search request uses body.transactionIds array; body.transaction_id is a stale singular request shape.');
      forbidPath(request, findings, 'body.filter.transaction_id', 'events.search request uses body.transactionIds array; body.filter.transaction_id is not in the reviewed contract.');
      forbidPath(request, findings, 'query.transaction_id', 'events.search is a POST read; transaction IDs belong in body.transactionIds.');
      forbidPath(request, findings, 'query.transactionIds', 'events.search is a POST read; transactionIds belongs in the JSON body.');
    },
  },
  'billableMetrics.get': {
    checked: ['secret scan', 'path billable metric id', 'body/query metric id forbidden'],
    apply(request, findings) {
      requirePath(request, findings, 'path.billable_metric_id');
      requireSafeIdentifier(request, findings, 'path.billable_metric_id');
      forbidPath(request, findings, 'body.billable_metric_id', 'Billable metric id belongs in the reviewed path parameter for billableMetrics.get.');
      forbidPath(request, findings, 'query.billable_metric_id', 'Use path.billable_metric_id for billableMetrics.get, not query.billable_metric_id.');
    },
  },
  'billableMetrics.list': {
    checked: ['secret scan', 'query pagination', 'include_archived query flag', 'body pagination forbidden'],
    apply(request, findings) {
      requirePath(request, findings, 'query.limit');
      requireBoolean(request, findings, 'query.include_archived');
      forbidPath(request, findings, 'body.limit', 'billableMetrics.list is a GET read; pagination limit belongs in query.limit, not the body.');
      forbidPath(request, findings, 'body.next_page', 'billableMetrics.list pagination next_page belongs in query.next_page, not the body.');
      forbidPath(request, findings, 'body.include_archived', 'billableMetrics.list include_archived belongs in query parameters, not the body.');
    },
  },
  'billableMetrics.create': {
    checked: ['secret scan', 'standard streaming metric contract', 'SQL metric refusal', 'aggregation key and property filter alignment', 'raw path/id refusal'],
    apply(request, findings) {
      requirePath(request, findings, 'body.name');
      requireNonEmptyString(request, findings, 'body.name');
      requirePath(request, findings, 'body.aggregation_type');
      requireEnum(request, findings, 'body.aggregation_type', ['COUNT', 'SUM', 'MAX', 'UNIQUE']);
      requirePath(request, findings, 'body.event_type_filter', 'body.event_type_filter is required by the reviewed local standard billable metric contract.');
      validateEventTypeFilter(request, findings, 'body.event_type_filter');
      const propertyFilterNames = validatePropertyFilters(request, findings, 'body.property_filters');
      const aggregationType = getPath(request, 'body.aggregation_type');
      if (aggregationType === 'COUNT') {
        forbidPath(request, findings, 'body.aggregation_key', 'COUNT billable metrics must omit aggregation_key in the reviewed local contract.');
      } else if (['SUM', 'MAX', 'UNIQUE'].includes(aggregationType)) {
        requirePath(request, findings, 'body.aggregation_key', `${aggregationType} billable metrics require body.aggregation_key.`);
        requireSafeIdentifier(request, findings, 'body.aggregation_key');
        const aggregationKey = getPath(request, 'body.aggregation_key');
        if (hasValue(aggregationKey) && !propertyFilterNames.includes(aggregationKey)) {
          add(findings, 'MTR-APIREQ-004', 'body.aggregation_key must also appear in body.property_filters[].name.', 'body.aggregation_key', ['api-validation', 'official-billable-metric-create', 'metronome-billable-metrics']);
        }
      }
      validateBillableMetricGroupKeys(request, findings, 'body.group_keys', propertyFilterNames);
      requireCustomFieldsObject(request, findings, 'body.custom_fields');
      forbidPath(request, findings, 'body.sql', 'SQL billable metric creation is intentionally unsupported by the reviewed local contract; model a separate SQL metric shape before allowing sql.');
      forbidPath(request, findings, 'body.id', 'billableMetrics.create creates a new metric and must not include a preexisting body.id.');
      forbidPath(request, findings, 'body.billable_metric_id', 'billableMetrics.create creates a new metric and must not include body.billable_metric_id.');
      forbidPath(request, findings, 'path.billable_metric_id', 'billableMetrics.create does not use path parameters.');
      forbidPath(request, findings, 'path.id', 'billableMetrics.create does not use path parameters.');
      forbidPath(request, findings, 'query.billable_metric_id', 'billableMetrics.create does not use query billable_metric_id.');
      forbidPath(request, findings, 'query.id', 'billableMetrics.create does not use query id.');
      forbidPath(request, findings, 'body.next_page', 'billableMetrics.create is a write and does not accept pagination cursors.');
      forbidPath(request, findings, 'query.next_page', 'billableMetrics.create is a write and does not accept query pagination.');
      forbidPath(request, findings, 'body.path', 'Use endpoint id billableMetrics.create and the reviewed /v1/billable-metrics/create path; do not include raw endpoint paths in request files.');
      forbidPath(request, findings, 'query.path', 'Use endpoint id billableMetrics.create and the reviewed /v1/billable-metrics/create path; do not include raw endpoint paths in request files.');
      forbidPath(request, findings, 'path.path', 'Use endpoint id billableMetrics.create and the reviewed /v1/billable-metrics/create path; do not include raw endpoint paths in request files.');
      forbidBodyKeysExcept(
        request,
        findings,
        ['name', 'event_type_filter', 'property_filters', 'aggregation_type', 'aggregation_key', 'group_keys', 'custom_fields', 'sql', 'id', 'billable_metric_id', 'next_page', 'path'],
        'billableMetrics.create body supports only the reviewed standard streaming metric fields in the local contract.',
      );
      forbidQueryKeysExcept(request, findings, ['billable_metric_id', 'id', 'next_page', 'path'], 'billableMetrics.create does not use query parameters in the reviewed local contract.');
      forbidPathKeysExcept(request, findings, ['billable_metric_id', 'id', 'path'], 'billableMetrics.create does not use path parameters in the reviewed local contract.');
    },
  },
  'billableMetrics.update': {
    checked: ['secret scan', 'path billable metric id', 'body name only', 'configuration mutation refusal', 'stale path refusal'],
    apply(request, findings) {
      requirePath(request, findings, 'path.billable_metric_id');
      requireSafeIdentifier(request, findings, 'path.billable_metric_id');
      requirePath(request, findings, 'body.name');
      requireNonEmptyString(request, findings, 'body.name');
      forbidPath(request, findings, 'body.id', 'billableMetrics.update uses the reviewed path billable_metric_id; do not include body.id.');
      forbidPath(request, findings, 'body.billable_metric_id', 'Billable metric id belongs in path.billable_metric_id for billableMetrics.update, not the body.');
      forbidPath(request, findings, 'query.billable_metric_id', 'billableMetrics.update uses a reviewed path parameter, not query.billable_metric_id.');
      forbidPath(request, findings, 'query.id', 'billableMetrics.update uses path.billable_metric_id, not query.id.');
      for (const path of ['body.aggregation_type', 'body.aggregation_key', 'body.event_type_filter', 'body.property_filters', 'body.group_keys', 'body.custom_fields', 'body.sql']) {
        forbidPath(request, findings, path, 'billableMetrics.update can only change the display name; metric configuration cannot be changed after creation through this endpoint.');
      }
      forbidPath(request, findings, 'body.path', 'Use endpoint id billableMetrics.update and the reviewed PUT /v1/billable-metrics/{billable_metric_id} path; do not include raw endpoint paths in request files.');
      forbidPath(request, findings, 'query.path', 'Use endpoint id billableMetrics.update and the reviewed PUT /v1/billable-metrics/{billable_metric_id} path; do not include raw endpoint paths in request files.');
      forbidPath(request, findings, 'path.path', 'Use endpoint id billableMetrics.update and the reviewed PUT /v1/billable-metrics/{billable_metric_id} path; do not include raw endpoint paths in request files.');
      forbidBodyKeysExcept(
        request,
        findings,
        ['name', 'id', 'billable_metric_id', 'aggregation_type', 'aggregation_key', 'event_type_filter', 'property_filters', 'group_keys', 'custom_fields', 'sql', 'path'],
        'billableMetrics.update body supports only name in the reviewed local contract.',
      );
      forbidQueryKeysExcept(request, findings, ['billable_metric_id', 'id', 'path'], 'billableMetrics.update does not use query parameters in the reviewed local contract.');
      forbidPathKeysExcept(request, findings, ['billable_metric_id', 'id', 'path'], 'billableMetrics.update path supports only billable_metric_id in the reviewed local contract.');
    },
  },
  'billableMetrics.archive': {
    checked: ['secret scan', 'body id', 'stale path id refusal', 'configuration payload refusal', 'raw path refusal'],
    apply(request, findings) {
      requirePath(request, findings, 'body.id');
      requireSafeIdentifier(request, findings, 'body.id');
      forbidPath(request, findings, 'path.billable_metric_id', 'billableMetrics.archive uses body.id in the current official docs, not a stale path billable_metric_id.');
      forbidPath(request, findings, 'path.id', 'billableMetrics.archive uses body.id and the reviewed /v1/billable-metrics/archive path, not a path id.');
      forbidPath(request, findings, 'body.billable_metric_id', 'billableMetrics.archive uses body.id, not body.billable_metric_id.');
      forbidPath(request, findings, 'query.billable_metric_id', 'billableMetrics.archive does not use query billable_metric_id.');
      forbidPath(request, findings, 'query.id', 'billableMetrics.archive does not use query id.');
      for (const path of ['body.name', 'body.aggregation_type', 'body.aggregation_key', 'body.event_type_filter', 'body.property_filters', 'body.group_keys', 'body.custom_fields', 'body.sql']) {
        forbidPath(request, findings, path, 'billableMetrics.archive only accepts body.id for the reviewed metric archive request.');
      }
      forbidPath(request, findings, 'body.next_page', 'billableMetrics.archive is a write and does not accept pagination cursors.');
      forbidPath(request, findings, 'query.next_page', 'billableMetrics.archive is a write and does not accept query pagination.');
      forbidPath(request, findings, 'body.path', 'Use endpoint id billableMetrics.archive and the reviewed /v1/billable-metrics/archive path; do not include raw endpoint paths in request files.');
      forbidPath(request, findings, 'query.path', 'Use endpoint id billableMetrics.archive and the reviewed /v1/billable-metrics/archive path; do not include raw endpoint paths in request files.');
      forbidPath(request, findings, 'path.path', 'Use endpoint id billableMetrics.archive and the reviewed /v1/billable-metrics/archive path; do not include raw endpoint paths in request files.');
      forbidBodyKeysExcept(
        request,
        findings,
        ['id', 'billable_metric_id', 'name', 'aggregation_type', 'aggregation_key', 'event_type_filter', 'property_filters', 'group_keys', 'custom_fields', 'sql', 'next_page', 'path'],
        'billableMetrics.archive body supports only id in the reviewed local contract.',
      );
      forbidQueryKeysExcept(request, findings, ['billable_metric_id', 'id', 'next_page', 'path'], 'billableMetrics.archive does not use query parameters in the reviewed local contract.');
      forbidPathKeysExcept(request, findings, ['billable_metric_id', 'id', 'path'], 'billableMetrics.archive does not use path parameters in the reviewed local contract.');
    },
  },
  'packages.create': {
    checked: [
      'secret scan',
      'package create required fields',
      'package alias schedule',
      'rate-card identity evidence',
      'package terms and frequency evidence',
      'billing provider and Stripe delivery evidence',
      'contract-create compatibility evidence',
      'idempotency key and duplicate package review',
      'raw path/id refusal',
    ],
    apply(request, findings) {
      requirePath(request, findings, 'body.name');
      requireNonEmptyString(request, findings, 'body.name');
      requirePath(request, findings, 'body.rate_card_id');
      requireSafeIdentifier(request, findings, 'body.rate_card_id');
      validatePackageAliases(request, findings, 'body.aliases');
      validatePackageDuration(request, findings, 'body.duration');
      // usage_statement_schedule and scheduled_charges_on_usage_invoices are top-level
      // package fields; there is no `contract` wrapper.
      // https://docs.metronome.com/api-reference/contracts/create-a-package
      if (hasValue(getPath(request, 'body.contract'))) {
        add(findings, 'MTR-APIREQ-002', 'body.contract is not a Metronome package field. Move usage_statement_schedule and scheduled_charges_on_usage_invoices to the top level of the body.', 'body.contract', ['api-validation', 'official-package-create']);
      }
      validatePackageContractTemplate(request, findings, 'body', { topLevel: true });
      requirePath(request, findings, 'body.uniqueness_key');
      requireSafeIdentifier(request, findings, 'body.uniqueness_key');
      requireMaxLength(request, findings, 'body.uniqueness_key', 128);
      requirePath(request, findings, 'body.billing_provider', 'Package creation requires explicit billing provider behavior in the reviewed local contract.');
      requireEnum(request, findings, 'body.billing_provider', ['stripe']);
      requirePath(request, findings, 'body.delivery_method', 'Package creation requires explicit Stripe delivery method behavior in the reviewed local contract.');
      requireEnum(request, findings, 'body.delivery_method', ['direct_to_billing_provider']);
      requireEvidenceTrue(request, findings, 'evidence.aliasHandoffReviewed', 'evidence.aliasHandoffReviewed must be true before package create validation can pass.', 'MTR-PKG-004', ['api-validation', 'endpoint-matrix']);
      requireEvidenceTrue(request, findings, 'evidence.aliasUniquenessReviewed', 'evidence.aliasUniquenessReviewed must be true before package create validation can pass.', 'MTR-IDEMP-003', ['api-validation', 'endpoint-matrix']);
      requireEvidenceTrue(request, findings, 'evidence.rateCardReadBackReviewed', 'evidence.rateCardReadBackReviewed must be true before package create validation can pass.', 'MTR-VERIFY-001', ['api-validation', 'official-package-create']);
      requireEvidenceTrue(request, findings, 'evidence.packageTermsReviewed', 'evidence.packageTermsReviewed must be true before package create validation can pass.', 'MTR-APIREQ-001', ['api-validation', 'official-package-create']);
      requireEvidenceTrue(request, findings, 'evidence.billingProviderBehaviorReviewed', 'evidence.billingProviderBehaviorReviewed must be true before package create validation can pass.', 'MTR-BILL-001', ['api-validation', 'official-package-create']);
      requireEvidenceTrue(request, findings, 'evidence.stripeDeliveryReviewed', 'evidence.stripeDeliveryReviewed must be true before package create validation can pass.', 'MTR-BILL-002', ['api-validation', 'official-package-create']);
      requireEvidenceTrue(request, findings, 'evidence.invoiceBehaviorReviewed', 'evidence.invoiceBehaviorReviewed must be true before package create validation can pass.', 'MTR-INV-004', ['api-validation', 'official-package-create']);
      requireEvidenceTrue(request, findings, 'evidence.contractCreateCompatibilityReviewed', 'evidence.contractCreateCompatibilityReviewed must be true before package create validation can pass.', 'MTR-PKG-003', ['api-validation', 'endpoint-matrix']);
      requireEvidenceTrue(request, findings, 'evidence.idempotencyKeyReviewed', 'evidence.idempotencyKeyReviewed must be true before package create validation can pass.', 'MTR-IDEMP-003', ['api-validation', 'official-package-create']);
      for (const path of ['body.id', 'body.package_id', 'body.package_alias', 'body.rate_card_alias', 'body.commits', 'body.credits', 'body.recurring_commits', 'body.recurring_credits', 'body.overrides', 'body.scheduled_charges', 'body.subscriptions', 'body.api_key', 'body.secret', 'body.next_page', 'body.path']) {
        forbidPath(request, findings, path, 'packages.create supports only the reviewed local package create evidence fields; use a dedicated package shape before adding richer package terms.');
      }
      for (const path of ['query.id', 'query.package_id', 'query.package_alias', 'query.next_page', 'query.path']) {
        forbidPath(request, findings, path, 'packages.create does not use query parameters in the reviewed local contract.');
      }
      for (const path of ['path.id', 'path.package_id', 'path.package_alias', 'path.path']) {
        forbidPath(request, findings, path, 'packages.create does not use path parameters in the reviewed local contract.');
      }
      forbidBodyKeysExcept(
        request,
        findings,
        ['name', 'rate_card_id', 'aliases', 'duration', 'contract', 'uniqueness_key', 'billing_provider', 'delivery_method', 'id', 'package_id', 'package_alias', 'rate_card_alias', 'commits', 'credits', 'recurring_commits', 'recurring_credits', 'overrides', 'scheduled_charges', 'subscriptions', 'api_key', 'secret', 'next_page', 'path'],
        'packages.create body supports only the reviewed local package create evidence fields.',
      );
      forbidQueryKeysExcept(request, findings, ['id', 'package_id', 'package_alias', 'next_page', 'path'], 'packages.create does not use query parameters in the reviewed local contract.');
      forbidPathKeysExcept(request, findings, ['id', 'package_id', 'package_alias', 'path'], 'packages.create does not use path parameters in the reviewed local contract.');
    },
  },
  'packages.get': {
    checked: ['secret scan', 'package id'],
    apply(request, findings) {
      requirePath(request, findings, 'body.package_id');
      requireSafeIdentifier(request, findings, 'body.package_id');
    },
  },
  'packages.list': {
    checked: ['secret scan', 'query pagination', 'body pagination forbidden'],
    apply(request, findings) {
      requirePath(request, findings, 'query.limit');
      forbidPath(request, findings, 'body.limit', 'packages.list pagination limit belongs in query.limit, not the POST body.');
      forbidPath(request, findings, 'body.next_page', 'packages.list next_page belongs in query.next_page, not the POST body.');
    },
  },
  'packages.listContractsOnPackage': {
    checked: ['secret scan', 'package id', 'query pagination', 'date filter exclusivity', 'body pagination forbidden'],
    apply(request, findings) {
      requirePath(request, findings, 'body.package_id');
      requirePath(request, findings, 'query.limit');
      requireSafeIdentifier(request, findings, 'body.package_id');
      requireIntegerRange(request, findings, 'query.limit', 1, 100);
      requireNonEmptyString(request, findings, 'query.next_page');
      requireDateTime(request, findings, 'body.starting_at');
      requireDateTime(request, findings, 'body.covering_date');
      requireBoolean(request, findings, 'body.include_archived');
      const hasStartingAt = pathExists(request, 'body.starting_at');
      const hasCoveringDate = pathExists(request, 'body.covering_date');
      if (hasStartingAt && hasCoveringDate) {
        add(findings, 'MTR-APIREQ-004', 'packages.listContractsOnPackage accepts body.starting_at OR body.covering_date, not both.', 'body.covering_date', ['api-validation', 'official-package-contracts-list']);
      }
      forbidPath(request, findings, 'query.package_id', 'packages.listContractsOnPackage is a POST read; package_id belongs in the JSON body.');
      forbidPath(request, findings, 'query.starting_at', 'packages.listContractsOnPackage filter starting_at belongs in the JSON body.');
      forbidPath(request, findings, 'query.covering_date', 'packages.listContractsOnPackage filter covering_date belongs in the JSON body.');
      forbidPath(request, findings, 'query.include_archived', 'packages.listContractsOnPackage include_archived belongs in the JSON body.');
      forbidPath(request, findings, 'body.limit', 'packages.listContractsOnPackage pagination limit belongs in query.limit, not the POST body.');
      forbidPath(request, findings, 'body.next_page', 'packages.listContractsOnPackage pagination next_page belongs in query.next_page, not the POST body.');
      forbidPath(request, findings, 'body.cursor', 'packages.listContractsOnPackage uses query.next_page for pagination, not body.cursor.');
      forbidPath(request, findings, 'body.packageId', 'Use body.package_id for packages.listContractsOnPackage.');
      forbidPath(request, findings, 'body.startingAt', 'Use body.starting_at for packages.listContractsOnPackage.');
      forbidPath(request, findings, 'body.coveringDate', 'Use body.covering_date for packages.listContractsOnPackage.');
      forbidPath(request, findings, 'body.includeArchived', 'Use body.include_archived for packages.listContractsOnPackage.');
      forbidBodyKeysExcept(request, findings, [
        'package_id',
        'starting_at',
        'covering_date',
        'include_archived',
        'limit',
        'next_page',
        'cursor',
        'packageId',
        'startingAt',
        'coveringDate',
        'includeArchived',
      ], 'packages.listContractsOnPackage body contains a field outside the reviewed local contract.');
      forbidQueryKeysExcept(request, findings, ['limit', 'next_page', 'package_id', 'starting_at', 'covering_date', 'include_archived'], 'packages.listContractsOnPackage query supports only pagination in the reviewed local contract.');
      forbidPathKeysExcept(request, findings, [], 'packages.listContractsOnPackage does not use path parameters in the reviewed local contract.');
    },
  },
  'packages.archive': {
    checked: [
      'secret scan',
      'package id',
      'alias-only archive forbidden',
      'replacement alias read-back evidence',
      'contracts-on-package inventory evidence',
      'archive irreversibility evidence',
      'package get/list read-back evidence',
      'raw path/id refusal',
    ],
    apply(request, findings) {
      requirePath(request, findings, 'body.package_id');
      requireSafeIdentifier(request, findings, 'body.package_id');
      forbidPath(request, findings, 'body.package_alias', 'Archive requires a read-back package_id, not an alias-only request.');
      requireEvidenceTrue(request, findings, 'evidence.packageIdentityReviewed', 'evidence.packageIdentityReviewed must be true before package archive validation can pass.', 'MTR-APIREQ-001', ['api-validation', 'official-package-archive']);
      requireEvidenceTrue(request, findings, 'evidence.replacementAliasReadBackReviewed', 'evidence.replacementAliasReadBackReviewed must be true before package archive validation can pass.', 'MTR-PKG-004', ['api-validation', 'endpoint-matrix']);
      requireEvidenceTrue(request, findings, 'evidence.contractsOnPackageInventoryReviewed', 'evidence.contractsOnPackageInventoryReviewed must be true before package archive validation can pass.', 'MTR-INV-003', ['api-validation', 'endpoint-matrix']);
      requireEvidenceTrue(request, findings, 'evidence.archiveIrreversibleReviewed', 'evidence.archiveIrreversibleReviewed must be true before package archive validation can pass.', 'MTR-VERIFY-002', ['api-validation', 'official-package-archive']);
      requireEvidenceTrue(request, findings, 'evidence.packageGetListReadBackReviewed', 'evidence.packageGetListReadBackReviewed must be true before package archive validation can pass.', 'MTR-VERIFY-001', ['api-validation', 'official-package-archive']);
      for (const path of ['body.id', 'body.name', 'body.rate_card_id', 'body.aliases', 'body.contract', 'body.duration', 'body.uniqueness_key', 'body.billing_provider', 'body.delivery_method', 'body.commits', 'body.credits', 'body.overrides', 'body.scheduled_charges', 'body.subscriptions', 'body.next_page', 'body.path']) {
        forbidPath(request, findings, path, 'packages.archive supports only body.package_id in the reviewed local contract.');
      }
      for (const path of ['query.id', 'query.package_id', 'query.package_alias', 'query.next_page', 'query.path']) {
        forbidPath(request, findings, path, 'packages.archive does not use query parameters in the reviewed local contract.');
      }
      for (const path of ['path.id', 'path.package_id', 'path.package_alias', 'path.path']) {
        forbidPath(request, findings, path, 'packages.archive does not use path parameters in the reviewed local contract.');
      }
      forbidBodyKeysExcept(
        request,
        findings,
        ['package_id', 'package_alias', 'id', 'name', 'rate_card_id', 'aliases', 'contract', 'duration', 'uniqueness_key', 'billing_provider', 'delivery_method', 'commits', 'credits', 'overrides', 'scheduled_charges', 'subscriptions', 'next_page', 'path'],
        'packages.archive body supports only package_id in the reviewed local contract.',
      );
      forbidQueryKeysExcept(request, findings, ['id', 'package_id', 'package_alias', 'next_page', 'path'], 'packages.archive does not use query parameters in the reviewed local contract.');
      forbidPathKeysExcept(request, findings, ['id', 'package_id', 'package_alias', 'path'], 'packages.archive does not use path parameters in the reviewed local contract.');
    },
  },
  'contracts.create': {
    checked: ['secret scan', 'customer id', 'starting_at hour boundary', 'idempotency key', 'package/direct contract separation'],
    apply(request, findings) {
      requirePath(request, findings, 'body.customer_id');
      requirePath(request, findings, 'body.starting_at');
      requirePath(request, findings, 'body.uniqueness_key');
      requireSafeIdentifier(request, findings, 'body.customer_id');
      requireHourBoundary(request, findings, 'body.starting_at');
      requireAny(
        request,
        findings,
        ['body.package_alias', 'body.package_id', 'body.commits', 'body.credits', 'body.subscriptions', 'body.overrides', 'body.scheduled_charges'],
        'contracts.create requires either a package alias/id or reviewed direct contract terms.',
      );
      if (pathExists(request, 'body.package_alias')) {
        for (const path of ['body.commits', 'body.credits', 'body.subscriptions', 'body.overrides', 'body.scheduled_charges']) {
          forbidPath(request, findings, path, 'Do not mix package_alias with direct contract terms in the same create request.');
        }
      }
    },
  },
  'contracts.updateEndDate': {
    checked: ['secret scan', 'contract id', 'ending_before hour boundary', 'finalized invoice decision'],
    apply(request, findings) {
      requirePath(request, findings, 'body.contract_id');
      requirePath(request, findings, 'body.ending_before');
      requirePath(request, findings, 'body.allow_ending_before_finalized_invoice');
      requireSafeIdentifier(request, findings, 'body.contract_id');
      requireHourBoundary(request, findings, 'body.ending_before');
      requireBoolean(request, findings, 'body.allow_ending_before_finalized_invoice');
    },
  },
  'contracts.get.v2': {
    checked: ['secret scan', 'contract id'],
    apply(request, findings) {
      requirePath(request, findings, 'body.contract_id');
      requireSafeIdentifier(request, findings, 'body.contract_id');
    },
  },
  'contracts.list.v2': {
    checked: ['secret scan', 'customer id', 'include archived decision'],
    apply(request, findings) {
      requirePath(request, findings, 'body.customer_id');
      requireSafeIdentifier(request, findings, 'body.customer_id');
      requireBoolean(request, findings, 'body.include_archived');
      forbidPath(request, findings, 'query.customer_id', 'contracts.list.v2 is a POST read; customer_id belongs in the request body.');
    },
  },
  'contracts.getRateSchedule': {
    checked: ['secret scan', 'customer id', 'contract id', 'optional effective timestamp', 'query pagination', 'selector body filters', 'body pagination forbidden'],
    apply(request, findings) {
      requirePath(request, findings, 'body.customer_id');
      requirePath(request, findings, 'body.contract_id');
      requirePath(request, findings, 'query.limit');
      requireSafeIdentifier(request, findings, 'body.customer_id');
      requireSafeIdentifier(request, findings, 'body.contract_id');
      requireDateTime(request, findings, 'body.at');
      validateRateSelectors(request, findings, 'body.selectors');
      forbidPath(request, findings, 'query.customer_id', 'contracts.getRateSchedule is a POST read; customer_id belongs in the JSON body.');
      forbidPath(request, findings, 'query.contract_id', 'contracts.getRateSchedule is a POST read; contract_id belongs in the JSON body.');
      forbidPath(request, findings, 'query.at', 'contracts.getRateSchedule is a POST read; at belongs in the JSON body.');
      forbidPath(request, findings, 'query.product_id', 'contracts.getRateSchedule selector filters belong in body.selectors[].product_id, not query.product_id.');
      forbidPath(request, findings, 'body.limit', 'contracts.getRateSchedule pagination limit belongs in query.limit, not the POST body.');
      forbidPath(request, findings, 'body.next_page', 'contracts.getRateSchedule pagination next_page belongs in query.next_page, not the POST body.');
      forbidBodyKeysExcept(request, findings, ['customer_id', 'contract_id', 'at', 'selectors', 'limit', 'next_page'], 'contracts.getRateSchedule body supports only customer_id, contract_id, at, and selectors in the reviewed local contract.');
      forbidQueryKeysExcept(request, findings, ['limit', 'next_page', 'customer_id', 'contract_id', 'at', 'product_id'], 'contracts.getRateSchedule query supports only pagination in the reviewed local contract.');
    },
  },
  'contracts.getEditHistory': {
    checked: ['secret scan', 'customer id', 'contract id', 'no pagination or query placement'],
    apply(request, findings) {
      requirePath(request, findings, 'body.customer_id');
      requirePath(request, findings, 'body.contract_id');
      requireSafeIdentifier(request, findings, 'body.customer_id');
      requireSafeIdentifier(request, findings, 'body.contract_id');
      forbidPath(request, findings, 'query.customer_id', 'contracts.getEditHistory is a POST read; customer_id belongs in the request body.');
      forbidPath(request, findings, 'query.contract_id', 'contracts.getEditHistory is a POST read; contract_id belongs in the request body.');
      forbidPath(request, findings, 'query.limit', 'contracts.getEditHistory does not document query pagination in the reviewed local contract.');
      forbidPath(request, findings, 'query.next_page', 'contracts.getEditHistory does not document query pagination in the reviewed local contract.');
      forbidPath(request, findings, 'body.limit', 'contracts.getEditHistory does not document body pagination in the reviewed local contract.');
      forbidPath(request, findings, 'body.next_page', 'contracts.getEditHistory does not document body pagination in the reviewed local contract.');
      forbidPath(request, findings, 'body.cursor', 'contracts.getEditHistory does not document cursor pagination in the reviewed local contract.');
      forbidPath(request, findings, 'body.customerId', 'Use body.customer_id for contracts.getEditHistory.');
      forbidPath(request, findings, 'body.contractId', 'Use body.contract_id for contracts.getEditHistory.');
      forbidBodyKeysExcept(request, findings, [
        'customer_id',
        'contract_id',
        'limit',
        'next_page',
        'cursor',
        'customerId',
        'contractId',
      ], 'contracts.getEditHistory body supports only customer_id and contract_id in the reviewed local contract.');
      forbidQueryKeysExcept(request, findings, ['customer_id', 'contract_id', 'limit', 'next_page'], 'contracts.getEditHistory does not use query parameters in the reviewed local contract.');
      forbidPathKeysExcept(request, findings, [], 'contracts.getEditHistory does not use path parameters in the reviewed local contract.');
    },
  },
  'contracts.getSubscriptionQuantityHistory': {
    checked: ['secret scan', 'customer id', 'contract id', 'subscription id', 'no pagination or query placement'],
    apply(request, findings) {
      requirePath(request, findings, 'body.customer_id');
      requirePath(request, findings, 'body.contract_id');
      requirePath(request, findings, 'body.subscription_id');
      requireSafeIdentifier(request, findings, 'body.customer_id');
      requireSafeIdentifier(request, findings, 'body.contract_id');
      requireSafeIdentifier(request, findings, 'body.subscription_id');
      forbidPath(request, findings, 'query.customer_id', 'contracts.getSubscriptionQuantityHistory is a POST read; customer_id belongs in the request body.');
      forbidPath(request, findings, 'query.contract_id', 'contracts.getSubscriptionQuantityHistory is a POST read; contract_id belongs in the request body.');
      forbidPath(request, findings, 'query.subscription_id', 'contracts.getSubscriptionQuantityHistory is a POST read; subscription_id belongs in the request body.');
      forbidPath(request, findings, 'query.limit', 'contracts.getSubscriptionQuantityHistory does not support pagination in the reviewed official request contract.');
      forbidPath(request, findings, 'query.cursor', 'contracts.getSubscriptionQuantityHistory does not support pagination in the reviewed official request contract.');
      forbidPath(request, findings, 'body.limit', 'contracts.getSubscriptionQuantityHistory does not support pagination in the reviewed official request contract.');
      forbidPath(request, findings, 'body.cursor', 'contracts.getSubscriptionQuantityHistory does not support pagination in the reviewed official request contract.');
      forbidPath(request, findings, 'body.next_page', 'contracts.getSubscriptionQuantityHistory does not support next_page pagination.');
      forbidPath(request, findings, 'body.customerId', 'Use body.customer_id for contracts.getSubscriptionQuantityHistory.');
      forbidPath(request, findings, 'body.contractId', 'Use body.contract_id for contracts.getSubscriptionQuantityHistory.');
      forbidPath(request, findings, 'body.subscriptionId', 'Use body.subscription_id for contracts.getSubscriptionQuantityHistory.');
      forbidBodyKeysExcept(request, findings, [
        'customer_id',
        'contract_id',
        'subscription_id',
        'limit',
        'cursor',
        'next_page',
        'customerId',
        'contractId',
        'subscriptionId',
      ], 'contracts.getSubscriptionQuantityHistory body contains a field outside the reviewed local contract.');
      forbidQueryKeysExcept(request, findings, ['customer_id', 'contract_id', 'subscription_id', 'limit', 'cursor'], 'contracts.getSubscriptionQuantityHistory does not use query parameters in the reviewed local contract.');
      forbidPathKeysExcept(request, findings, [], 'contracts.getSubscriptionQuantityHistory does not use path parameters in the reviewed local contract.');
    },
  },
  'contracts.getSubscriptionSeatsHistory': {
    checked: ['secret scan', 'customer id', 'contract id', 'subscription id', 'date filter exclusivity', 'body pagination placement'],
    apply(request, findings) {
      requirePath(request, findings, 'body.customer_id');
      requirePath(request, findings, 'body.contract_id');
      requirePath(request, findings, 'body.subscription_id');
      requireSafeIdentifier(request, findings, 'body.customer_id');
      requireSafeIdentifier(request, findings, 'body.contract_id');
      requireSafeIdentifier(request, findings, 'body.subscription_id');
      requireIntegerRange(request, findings, 'body.limit', 1, 10);
      requireNonEmptyString(request, findings, 'body.cursor');
      requireDateTime(request, findings, 'body.covering_date');
      requireDateTime(request, findings, 'body.starting_at');
      requireDateTime(request, findings, 'body.ending_before');
      const hasCoveringDate = pathExists(request, 'body.covering_date');
      const hasStartingAt = pathExists(request, 'body.starting_at');
      const hasEndingBefore = pathExists(request, 'body.ending_before');
      if (hasCoveringDate && (hasStartingAt || hasEndingBefore)) {
        add(findings, 'MTR-APIREQ-004', 'contracts.getSubscriptionSeatsHistory accepts body.covering_date OR body.starting_at/body.ending_before, not both.', 'body.covering_date', ['api-validation', 'official-contract-subscription-seats-history']);
      }
      forbidPath(request, findings, 'query.customer_id', 'contracts.getSubscriptionSeatsHistory is a POST read; customer_id belongs in the request body.');
      forbidPath(request, findings, 'query.contract_id', 'contracts.getSubscriptionSeatsHistory is a POST read; contract_id belongs in the request body.');
      forbidPath(request, findings, 'query.subscription_id', 'contracts.getSubscriptionSeatsHistory is a POST read; subscription_id belongs in the request body.');
      forbidPath(request, findings, 'query.limit', 'contracts.getSubscriptionSeatsHistory pagination limit belongs in the JSON body.');
      forbidPath(request, findings, 'query.cursor', 'contracts.getSubscriptionSeatsHistory pagination cursor belongs in the JSON body.');
      forbidPath(request, findings, 'query.next_page', 'contracts.getSubscriptionSeatsHistory does not use query.next_page; use body.cursor from the previous response next_page.');
      forbidPath(request, findings, 'body.next_page', 'Use body.cursor for contracts.getSubscriptionSeatsHistory pagination, not next_page.');
      forbidPath(request, findings, 'body.customerId', 'Use body.customer_id for contracts.getSubscriptionSeatsHistory.');
      forbidPath(request, findings, 'body.contractId', 'Use body.contract_id for contracts.getSubscriptionSeatsHistory.');
      forbidPath(request, findings, 'body.subscriptionId', 'Use body.subscription_id for contracts.getSubscriptionSeatsHistory.');
      forbidPath(request, findings, 'body.effective_before', 'Use body.ending_before for contracts.getSubscriptionSeatsHistory.');
      forbidBodyKeysExcept(request, findings, [
        'customer_id',
        'contract_id',
        'subscription_id',
        'limit',
        'cursor',
        'covering_date',
        'starting_at',
        'ending_before',
        'next_page',
        'customerId',
        'contractId',
        'subscriptionId',
        'effective_before',
      ], 'contracts.getSubscriptionSeatsHistory body contains a field outside the reviewed local contract.');
      forbidQueryKeysExcept(request, findings, ['customer_id', 'contract_id', 'subscription_id', 'limit', 'cursor', 'next_page'], 'contracts.getSubscriptionSeatsHistory does not use query parameters in the reviewed local contract.');
      forbidPathKeysExcept(request, findings, [], 'contracts.getSubscriptionSeatsHistory does not use path parameters in the reviewed local contract.');
    },
  },
  'contracts.edit.v2': {
    checked: ['secret scan', 'customer id', 'contract id', 'edits array'],
    apply(request, findings) {
      requirePath(request, findings, 'body.customer_id');
      requirePath(request, findings, 'body.contract_id');
      requireArray(request, findings, 'body.edits');
      requireSafeIdentifier(request, findings, 'body.customer_id');
      requireSafeIdentifier(request, findings, 'body.contract_id');
    },
  },
  'contracts.updateInvoiceIssueDate': {
    checked: ['secret scan', 'invoice id', 'issue date', 'contract evidence'],
    apply(request, findings) {
      requirePath(request, findings, 'body.invoice_id');
      requirePath(request, findings, 'body.issue_date');
      requireAny(request, findings, ['body.contract_id', 'evidence.contract_id'], 'Invoice issue-date validation requires contract_id evidence.');
      forbidPath(request, findings, 'body.path', 'Use endpoint id contracts.updateInvoiceIssueDate; do not include raw endpoint paths in request files.');
    },
  },
  'commits.list': {
    checked: ['secret scan', 'customer id', 'optional commit read flags'],
    apply(request, findings) {
      requirePath(request, findings, 'body.customer_id');
      requireSafeIdentifier(request, findings, 'body.customer_id');
      requireSafeIdentifier(request, findings, 'body.commit_id');
      for (const path of ['body.include_archived', 'body.include_balance', 'body.include_contract_commits', 'body.include_ledgers']) {
        requireBoolean(request, findings, path);
      }
      forbidPath(request, findings, 'query.customer_id', 'commits.list is a POST read; customer_id belongs in the request body.');
    },
  },
  'credits.list': {
    checked: ['secret scan', 'customer id', 'optional credit read flags'],
    apply(request, findings) {
      requirePath(request, findings, 'body.customer_id');
      requireSafeIdentifier(request, findings, 'body.customer_id');
      requireSafeIdentifier(request, findings, 'body.credit_id');
      for (const path of ['body.include_archived', 'body.include_balance', 'body.include_contract_credits', 'body.include_ledgers']) {
        requireBoolean(request, findings, path);
      }
      forbidPath(request, findings, 'query.customer_id', 'credits.list is a POST read; customer_id belongs in the request body.');
    },
  },
  'customerBalances.list': {
    checked: ['secret scan', 'customer id', 'balance inclusion flags'],
    apply(request, findings) {
      requirePath(request, findings, 'body.customer_id');
      requireSafeIdentifier(request, findings, 'body.customer_id');
      requireBoolean(request, findings, 'body.include_balance');
      requireBoolean(request, findings, 'body.include_contract_balances');
      requireBoolean(request, findings, 'body.include_ledgers');
      forbidPath(request, findings, 'query.customer_id', 'customerBalances.list is a POST read; customer_id belongs in the request body.');
    },
  },
  'seatBalances.list': {
    checked: ['secret scan', 'customer id', 'contract id', 'seat/subscription filters', 'detail flags', 'covering date xor date window', 'pagination body placement'],
    apply(request, findings) {
      requirePath(request, findings, 'body.customer_id');
      requirePath(request, findings, 'body.contract_id');
      requireSafeIdentifier(request, findings, 'body.customer_id');
      requireSafeIdentifier(request, findings, 'body.contract_id');
      validateOptionalSafeStringArray(request, findings, 'body.subscription_ids');
      validateOptionalNonEmptyStringArray(request, findings, 'body.seat_ids');
      for (const path of ['body.skip_missing_seat_ids', 'body.include_credits_and_commits', 'body.include_ledgers']) {
        requireBoolean(request, findings, path);
      }
      requireDateTime(request, findings, 'body.covering_date');
      requireDateTime(request, findings, 'body.starting_at');
      requireDateTime(request, findings, 'body.effective_before');
      requireIntegerRange(request, findings, 'body.limit', 1, 100);
      requireNonEmptyString(request, findings, 'body.cursor');
      const hasCoveringDate = pathExists(request, 'body.covering_date');
      const hasWindowStart = pathExists(request, 'body.starting_at');
      const hasWindowEnd = pathExists(request, 'body.effective_before');
      if (hasCoveringDate && (hasWindowStart || hasWindowEnd)) {
        add(findings, 'MTR-APIREQ-004', 'seatBalances.list accepts body.covering_date OR body.starting_at/body.effective_before, not both.', 'body.covering_date', ['api-validation', 'official-seat-balances-list']);
      }
      if ((hasWindowStart && !hasWindowEnd) || (!hasWindowStart && hasWindowEnd)) {
        add(findings, 'MTR-APIREQ-001', 'seatBalances.list date-window filters must include both body.starting_at and body.effective_before.', 'body.starting_at|body.effective_before', ['api-validation', 'official-seat-balances-list']);
      }
      if (pathExists(request, 'body.include_ledgers') && getPath(request, 'body.include_ledgers') === true && getPath(request, 'body.include_credits_and_commits') !== true) {
        add(findings, 'MTR-APIREQ-004', 'body.include_ledgers requires body.include_credits_and_commits=true for seatBalances.list.', 'body.include_ledgers', ['api-validation', 'official-seat-balances-list']);
      }
      forbidPath(request, findings, 'query.customer_id', 'seatBalances.list is a POST read; customer_id belongs in the request body.');
      forbidPath(request, findings, 'query.contract_id', 'seatBalances.list is a POST read; contract_id belongs in the request body.');
      forbidPath(request, findings, 'query.limit', 'seatBalances.list pagination limit belongs in the JSON body for the reviewed local contract.');
      forbidPath(request, findings, 'query.cursor', 'seatBalances.list pagination cursor belongs in the JSON body for the reviewed local contract.');
      forbidPath(request, findings, 'body.next_page', 'Use body.cursor for seatBalances.list pagination, not next_page.');
      forbidPath(request, findings, 'body.customerId', 'Use body.customer_id for seatBalances.list.');
      forbidPath(request, findings, 'body.contractId', 'Use body.contract_id for seatBalances.list.');
      forbidPath(request, findings, 'body.subscription_id', 'Use body.subscription_ids[] for seatBalances.list.');
      forbidPath(request, findings, 'body.seat_id', 'Use body.seat_ids[] for seatBalances.list.');
      forbidPath(request, findings, 'body.ending_before', 'Use body.effective_before for seatBalances.list.');
      forbidBodyKeysExcept(request, findings, [
        'customer_id',
        'contract_id',
        'subscription_ids',
        'seat_ids',
        'skip_missing_seat_ids',
        'include_credits_and_commits',
        'include_ledgers',
        'covering_date',
        'starting_at',
        'effective_before',
        'limit',
        'cursor',
      ], 'seatBalances.list body contains a field outside the reviewed local contract.');
      forbidQueryKeysExcept(request, findings, [], 'seatBalances.list does not use query parameters in the reviewed local contract.');
      forbidPathKeysExcept(request, findings, [], 'seatBalances.list does not use path parameters in the reviewed local contract.');
    },
  },
  'invoices.preview': {
    checked: ['secret scan', 'customer id', 'events array', 'invoice period evidence'],
    apply(request, findings) {
      requirePath(request, findings, 'body.customer_id');
      requireEventBatch(request, findings, 'body.events', { max: 100 });
      requireAny(request, findings, ['body.invoice_period', 'evidence.invoicePeriodTarget'], 'Invoice preview requires target invoice period evidence.');
    },
  },
  'customers.get': {
    checked: ['secret scan', 'path customer id', 'body customer id forbidden'],
    apply(request, findings) {
      requirePath(request, findings, 'path.customer_id');
      requireSafeIdentifier(request, findings, 'path.customer_id');
      forbidPath(request, findings, 'body.customer_id', 'Customer id belongs in the reviewed path parameter for customers.get.');
      forbidPath(request, findings, 'query.customer_id', 'Use path.customer_id for customers.get, not query.customer_id.');
    },
  },
  'customers.list': {
    checked: ['secret scan', 'query lookup filters', 'query pagination', 'body lookup forbidden'],
    apply(request, findings) {
      requirePath(request, findings, 'query.limit');
      requireAny(
        request,
        findings,
        ['query.customer_ids', 'query.ingest_alias'],
        'customers.list requires a reviewed targeted lookup filter in query.customer_ids or query.ingest_alias.',
      );
      forbidPath(request, findings, 'body.customer_ids', 'customers.list is a GET read; customer_ids belongs in query parameters.');
      forbidPath(request, findings, 'body.ingest_alias', 'customers.list is a GET read; ingest_alias belongs in query parameters.');
      forbidPath(request, findings, 'body.limit', 'customers.list pagination limit belongs in query.limit, not the body.');
      forbidPath(request, findings, 'body.next_page', 'customers.list pagination next_page belongs in query.next_page, not the body.');
    },
  },
  'customers.create': {
    checked: [
      'secret scan',
      'customer name',
      'ingest aliases array',
      'duplicate alias evidence',
      'archived-customer collision evidence',
      'custom-field allowlist evidence',
      'inline billing-provider evidence',
      'raw path/id refusal',
    ],
    apply(request, findings) {
      requirePath(request, findings, 'body.name');
      requireNonEmptyString(request, findings, 'body.name');
      validateCustomerIngestAliases(request, findings, 'body.ingest_aliases');
      requireCustomFieldsObject(request, findings, 'body.custom_fields');
      const billingProviderConfigs = validateCustomerBillingProviderConfigurations(request, findings, 'body.customer_billing_provider_configurations');
      requireEvidenceTrue(request, findings, 'evidence.customerIdentityReviewed', 'evidence.customerIdentityReviewed must be true before customer create validation can pass.', 'MTR-CUST-001', ['api-validation', 'customers-hierarchies']);
      requireEvidenceTrue(request, findings, 'evidence.ingestAliasSearchPlanned', 'evidence.ingestAliasSearchPlanned must be true before customer create validation can pass.', 'MTR-CUST-002', ['api-validation', 'customers-hierarchies']);
      requireEvidenceTrue(request, findings, 'evidence.archivedCustomerCollisionReviewed', 'evidence.archivedCustomerCollisionReviewed must be true because archived customers can retain aliases.', 'MTR-CUST-002', ['api-validation', 'customers-hierarchies']);
      requireEvidenceTrue(request, findings, 'evidence.customerReadBackPlanned', 'evidence.customerReadBackPlanned must be true before customer create validation can pass.', 'MTR-VERIFY-001', ['api-validation', 'customers-hierarchies']);
      requireEvidenceTrue(request, findings, 'evidence.noInvoiceSideEffectReviewed', 'evidence.noInvoiceSideEffectReviewed must be true because customer setup should not create invoices by itself.', 'MTR-INV-003', ['api-validation', 'danger-zone']);
      if (pathExists(request, 'body.custom_fields')) {
        requireEvidenceTrue(request, findings, 'evidence.customFieldKeysApproved', 'evidence.customFieldKeysApproved must be true when customer create sets custom_fields.', 'MTR-CUST-004', ['api-validation', 'customers-hierarchies']);
      }
      if (billingProviderConfigs.length > 0) {
        requireEvidenceTrue(request, findings, 'evidence.billingProviderReviewed', 'evidence.billingProviderReviewed must be true when customer create includes inline billing-provider configuration.', 'MTR-BILL-002', ['api-validation', 'metronome-stripe-delivery']);
        requireEvidenceTrue(request, findings, 'evidence.stripeBehaviorReviewed', 'evidence.stripeBehaviorReviewed must be true when customer create includes inline Stripe configuration.', 'MTR-BILL-004', ['api-validation', 'metronome-stripe-delivery']);
      }
      for (const path of [
        'body.customer_id',
        'body.id',
        'body.parent_customer_id',
        'body.archive',
        'body.archived',
        'body.ingest_alias',
        'body.primary_ingest_alias',
        'body.salesforce_account_id',
        'body.leave_stripe_invoices_in_draft',
      ]) {
        forbidPath(request, findings, path, 'customers.create local validation supports customer identity, ingest aliases, optional custom fields, and optional inline billing-provider configuration only; use a separate endpoint for updates or archive.');
      }
      forbidRawEndpointPathFields(request, findings, 'customers.create', 'POST /v1/customers');
      forbidBodyKeysExcept(
        request,
        findings,
        [
          'name',
          'ingest_aliases',
          'custom_fields',
          'customer_billing_provider_configurations',
          'customer_id',
          'id',
          'parent_customer_id',
          'archive',
          'archived',
          'ingest_alias',
          'primary_ingest_alias',
          'salesforce_account_id',
          'leave_stripe_invoices_in_draft',
          'path',
          'url',
          'method',
        ],
        'customers.create body contains a field outside the reviewed local customer create contract.',
      );
      forbidQueryKeysExcept(request, findings, ['path', 'url', 'method'], 'customers.create does not use query parameters in the reviewed local contract.');
      forbidPathKeysExcept(request, findings, ['path', 'url', 'method'], 'customers.create does not use path parameters in the reviewed local contract.');
    },
  },
  'customers.archive': {
    checked: ['secret scan', 'customer id', 'contract inventory evidence', 'invoice void evidence', 'Stripe non-refund evidence', 'remediation evidence', 'raw path/id refusal'],
    apply(request, findings) {
      requirePath(request, findings, 'body.customer_id');
      requireSafeIdentifier(request, findings, 'body.customer_id');
      requireEvidenceTrue(request, findings, 'evidence.customerIdentityReviewed', 'evidence.customerIdentityReviewed must be true before customer archive validation can pass.', 'MTR-CUST-001', ['api-validation', 'customers-hierarchies']);
      requireEvidenceTrue(request, findings, 'evidence.activeContractsReviewed', 'evidence.activeContractsReviewed must be true because customer archive can archive contracts.', 'MTR-CUST-003', ['api-validation', 'danger-zone']);
      requireEvidenceTrue(request, findings, 'evidence.invoiceVoidSideEffectsReviewed', 'evidence.invoiceVoidSideEffectsReviewed must be true because customer archive can void invoices.', 'MTR-INV-003', ['api-validation', 'danger-zone']);
      requireEvidenceTrue(request, findings, 'evidence.stripeNoRefundReviewed', 'evidence.stripeNoRefundReviewed must be true because Metronome void/archive does not refund Stripe.', 'MTR-BILL-004', ['api-validation', 'danger-zone']);
      requireEvidenceTrue(request, findings, 'evidence.aliasReplacementReviewed', 'evidence.aliasReplacementReviewed must be true before customer archive validation can pass.', 'MTR-CUST-002', ['api-validation', 'customers-hierarchies']);
      requireEvidenceTrue(request, findings, 'evidence.rollbackOrRemediationReviewed', 'evidence.rollbackOrRemediationReviewed must be true before customer archive validation can pass.', 'MTR-VERIFY-002', ['api-validation', 'danger-zone']);
      for (const path of ['body.id', 'body.customer_ids', 'body.name', 'body.ingest_aliases', 'body.custom_fields', 'body.customer_billing_provider_configurations']) {
        forbidPath(request, findings, path, 'customers.archive local validation supports only body.customer_id plus explicit side-effect evidence.');
      }
      forbidRawEndpointPathFields(request, findings, 'customers.archive', 'POST /v1/customers/archive');
      forbidBodyKeysExcept(
        request,
        findings,
        ['customer_id', 'id', 'customer_ids', 'name', 'ingest_aliases', 'custom_fields', 'customer_billing_provider_configurations', 'path', 'url', 'method'],
        'customers.archive body supports only customer_id in the reviewed local contract.',
      );
      forbidQueryKeysExcept(request, findings, ['path', 'url', 'method'], 'customers.archive does not use query parameters in the reviewed local contract.');
      forbidPathKeysExcept(request, findings, ['path', 'url', 'method'], 'customers.archive does not use path parameters in the reviewed local contract.');
    },
  },
  'customers.updateConfig': {
    checked: ['secret scan', 'path customer id', 'config field allowlist', 'Stripe draft behavior evidence', 'body customer id forbidden', 'raw path refusal'],
    apply(request, findings) {
      requirePath(request, findings, 'path.customer_id');
      requireSafeIdentifier(request, findings, 'path.customer_id');
      requireAny(
        request,
        findings,
        ['body.salesforce_account_id', 'body.leave_stripe_invoices_in_draft'],
        'customers.updateConfig requires at least one reviewed config field.',
      );
      requireSafeIdentifier(request, findings, 'body.salesforce_account_id');
      requireBoolean(request, findings, 'body.leave_stripe_invoices_in_draft');
      requireEvidenceTrue(request, findings, 'evidence.customerIdentityReviewed', 'evidence.customerIdentityReviewed must be true before customer config update validation can pass.', 'MTR-CUST-001', ['api-validation', 'customers-hierarchies']);
      requireEvidenceTrue(request, findings, 'evidence.customerReadBackPlanned', 'evidence.customerReadBackPlanned must be true before customer config update validation can pass.', 'MTR-VERIFY-001', ['api-validation', 'customers-hierarchies']);
      if (pathExists(request, 'body.salesforce_account_id')) {
        requireEvidenceTrue(request, findings, 'evidence.crmMappingReviewed', 'evidence.crmMappingReviewed must be true when salesforce_account_id changes.', 'MTR-CUST-004', ['api-validation', 'customers-hierarchies']);
      }
      if (pathExists(request, 'body.leave_stripe_invoices_in_draft')) {
        requireEvidenceTrue(request, findings, 'evidence.stripeDraftBehaviorReviewed', 'evidence.stripeDraftBehaviorReviewed must be true when leave_stripe_invoices_in_draft changes.', 'MTR-BILL-004', ['api-validation', 'metronome-stripe-delivery']);
      }
      for (const path of ['body.customer_id', 'body.name', 'body.ingest_aliases', 'body.customer_billing_provider_configurations', 'query.customer_id']) {
        forbidPath(request, findings, path, 'customers.updateConfig uses path.customer_id and only supports reviewed config fields in the body.');
      }
      forbidRawEndpointPathFields(request, findings, 'customers.updateConfig', 'POST /v1/customers/{customer_id}/updateConfig');
      forbidBodyKeysExcept(
        request,
        findings,
        ['salesforce_account_id', 'leave_stripe_invoices_in_draft', 'customer_id', 'name', 'ingest_aliases', 'customer_billing_provider_configurations', 'path', 'url', 'method'],
        'customers.updateConfig body supports only salesforce_account_id and leave_stripe_invoices_in_draft in the reviewed local contract.',
      );
      forbidQueryKeysExcept(request, findings, ['customer_id', 'path', 'url', 'method'], 'customers.updateConfig does not use query parameters in the reviewed local contract.');
      forbidPathKeysExcept(request, findings, ['customer_id', 'path', 'url', 'method'], 'customers.updateConfig path supports only customer_id in the reviewed local contract.');
    },
  },
  'customers.updateName': {
    checked: ['secret scan', 'path customer id', 'new name', 'customer-facing name evidence', 'body customer id forbidden', 'raw path refusal'],
    apply(request, findings) {
      requirePath(request, findings, 'path.customer_id');
      requireSafeIdentifier(request, findings, 'path.customer_id');
      requirePath(request, findings, 'body.name');
      requireNonEmptyString(request, findings, 'body.name');
      requireEvidenceTrue(request, findings, 'evidence.customerIdentityReviewed', 'evidence.customerIdentityReviewed must be true before customer name update validation can pass.', 'MTR-CUST-001', ['api-validation', 'customers-hierarchies']);
      requireEvidenceTrue(request, findings, 'evidence.customerFacingNameReviewed', 'evidence.customerFacingNameReviewed must be true before customer name update validation can pass.', 'MTR-CUST-004', ['api-validation', 'customers-hierarchies']);
      requireEvidenceTrue(request, findings, 'evidence.customerReadBackPlanned', 'evidence.customerReadBackPlanned must be true before customer name update validation can pass.', 'MTR-VERIFY-001', ['api-validation', 'customers-hierarchies']);
      for (const path of ['body.customer_id', 'body.ingest_aliases', 'body.salesforce_account_id', 'body.leave_stripe_invoices_in_draft', 'query.customer_id']) {
        forbidPath(request, findings, path, 'customers.updateName uses path.customer_id and only supports body.name in the reviewed local contract.');
      }
      forbidRawEndpointPathFields(request, findings, 'customers.updateName', 'POST /v1/customers/{customer_id}/updateName');
      forbidBodyKeysExcept(
        request,
        findings,
        ['name', 'customer_id', 'ingest_aliases', 'salesforce_account_id', 'leave_stripe_invoices_in_draft', 'path', 'url', 'method'],
        'customers.updateName body supports only name in the reviewed local contract.',
      );
      forbidQueryKeysExcept(request, findings, ['customer_id', 'path', 'url', 'method'], 'customers.updateName does not use query parameters in the reviewed local contract.');
      forbidPathKeysExcept(request, findings, ['customer_id', 'path', 'url', 'method'], 'customers.updateName path supports only customer_id in the reviewed local contract.');
    },
  },
  'customers.setIngestAliases': {
    checked: ['secret scan', 'path customer id', 'ingest aliases array', 'duplicate alias evidence', 'usage routing evidence', 'body customer id forbidden', 'raw path refusal'],
    apply(request, findings) {
      requirePath(request, findings, 'path.customer_id');
      requireSafeIdentifier(request, findings, 'path.customer_id');
      validateCustomerIngestAliases(request, findings, 'body.ingest_aliases');
      requireEvidenceTrue(request, findings, 'evidence.customerIdentityReviewed', 'evidence.customerIdentityReviewed must be true before ingest alias update validation can pass.', 'MTR-CUST-001', ['api-validation', 'customers-hierarchies']);
      requireEvidenceTrue(request, findings, 'evidence.ingestAliasSearchPlanned', 'evidence.ingestAliasSearchPlanned must be true before ingest alias update validation can pass.', 'MTR-CUST-002', ['api-validation', 'customers-hierarchies']);
      requireEvidenceTrue(request, findings, 'evidence.archivedCustomerCollisionReviewed', 'evidence.archivedCustomerCollisionReviewed must be true because archived customers can retain aliases.', 'MTR-CUST-002', ['api-validation', 'customers-hierarchies']);
      requireEvidenceTrue(request, findings, 'evidence.usageRoutingReviewed', 'evidence.usageRoutingReviewed must be true because alias changes route future usage events.', 'MTR-CUST-002', ['api-validation', 'metronome-ingestion-events']);
      requireEvidenceTrue(request, findings, 'evidence.aliasReadBackPlanned', 'evidence.aliasReadBackPlanned must be true before ingest alias update validation can pass.', 'MTR-VERIFY-001', ['api-validation', 'customers-hierarchies']);
      for (const path of ['body.customer_id', 'body.name', 'body.ingest_alias', 'body.primary_ingest_alias', 'query.customer_id']) {
        forbidPath(request, findings, path, 'customers.setIngestAliases uses path.customer_id and body.ingest_aliases[] in the reviewed local contract.');
      }
      forbidRawEndpointPathFields(request, findings, 'customers.setIngestAliases', 'POST /v1/customers/{customer_id}/setIngestAliases');
      forbidBodyKeysExcept(
        request,
        findings,
        ['ingest_aliases', 'customer_id', 'name', 'ingest_alias', 'primary_ingest_alias', 'path', 'url', 'method'],
        'customers.setIngestAliases body supports only ingest_aliases[] in the reviewed local contract.',
      );
      forbidQueryKeysExcept(request, findings, ['customer_id', 'path', 'url', 'method'], 'customers.setIngestAliases does not use query parameters in the reviewed local contract.');
      forbidPathKeysExcept(request, findings, ['customer_id', 'path', 'url', 'method'], 'customers.setIngestAliases path supports only customer_id in the reviewed local contract.');
    },
  },
  'invoices.listForCustomer': {
    checked: ['secret scan', 'path customer id', 'query pagination', 'body customer id forbidden'],
    apply(request, findings) {
      requirePath(request, findings, 'path.customer_id');
      requirePath(request, findings, 'query.limit');
      requireSafeIdentifier(request, findings, 'path.customer_id');
      forbidPath(request, findings, 'body.customer_id', 'Customer id belongs in the reviewed path parameter for invoices.listForCustomer.');
    },
  },
  'invoices.listBreakdowns': {
    checked: ['secret scan', 'path customer id', 'required date window', 'query pagination', 'window/status/sort filters', 'body fields forbidden'],
    apply(request, findings) {
      requirePath(request, findings, 'path.customer_id');
      requirePath(request, findings, 'query.starting_on');
      requirePath(request, findings, 'query.ending_before');
      requirePath(request, findings, 'query.limit');
      requireSafeIdentifier(request, findings, 'path.customer_id');
      requireDateTime(request, findings, 'query.starting_on');
      requireDateTime(request, findings, 'query.ending_before');
      requireIntegerRange(request, findings, 'query.limit', 1, 100);
      requireNonEmptyString(request, findings, 'query.next_page');
      requireEnum(request, findings, 'query.status', ['DRAFT', 'FINALIZED']);
      requireEnum(request, findings, 'query.window_size', ['hour', 'day', 'HOUR', 'DAY', 'Hour', 'Day']);
      requireEnum(request, findings, 'query.sort', ['date_asc', 'date_desc']);
      requireBoolean(request, findings, 'query.skip_zero_qty_line_items');
      requireSafeIdentifier(request, findings, 'query.credit_type_id');
      forbidPath(request, findings, 'body.customer_id', 'Customer id belongs in path.customer_id for invoices.listBreakdowns.');
      forbidPath(request, findings, 'body.invoice_id', 'Invoice breakdowns are customer/window-scoped; do not send body.invoice_id.');
      forbidPath(request, findings, 'body.limit', 'invoices.listBreakdowns is a GET read; pagination limit belongs in query.limit.');
      forbidPath(request, findings, 'body.next_page', 'invoices.listBreakdowns pagination cursor belongs in query.next_page.');
      forbidPath(request, findings, 'body.starting_on', 'invoices.listBreakdowns starting_on belongs in query.starting_on.');
      forbidPath(request, findings, 'body.ending_before', 'invoices.listBreakdowns ending_before belongs in query.ending_before.');
      forbidPath(request, findings, 'body.window_size', 'invoices.listBreakdowns window_size belongs in query.window_size.');
      forbidPath(request, findings, 'body.status', 'invoices.listBreakdowns status belongs in query.status.');
      forbidPath(request, findings, 'body.sort', 'invoices.listBreakdowns sort belongs in query.sort.');
      forbidPath(request, findings, 'body.skip_zero_qty_line_items', 'invoices.listBreakdowns skip_zero_qty_line_items belongs in query.skip_zero_qty_line_items.');
      forbidPath(request, findings, 'body.credit_type_id', 'invoices.listBreakdowns credit_type_id belongs in query.credit_type_id.');
      forbidPath(request, findings, 'query.customer_id', 'Customer id belongs in path.customer_id for invoices.listBreakdowns, not query.customer_id.');
      forbidPath(request, findings, 'query.invoice_id', 'Invoice breakdowns are customer/window-scoped; do not send query.invoice_id.');
      forbidPath(request, findings, 'path.invoice_id', 'Invoice breakdowns use only path.customer_id; invoice_id does not belong in the path.');
      forbidBodyKeysExcept(
        request,
        findings,
        ['customer_id', 'invoice_id', 'limit', 'next_page', 'starting_on', 'ending_before', 'window_size', 'status', 'sort', 'skip_zero_qty_line_items', 'credit_type_id'],
        'invoices.listBreakdowns is a GET read; request filters belong in query parameters and customer_id belongs in the path.',
      );
      forbidQueryKeysExcept(
        request,
        findings,
        ['limit', 'next_page', 'starting_on', 'ending_before', 'window_size', 'status', 'sort', 'skip_zero_qty_line_items', 'credit_type_id', 'customer_id', 'invoice_id'],
        'invoices.listBreakdowns query supports only the reviewed window, pagination, status, sort, zero-quantity, and credit-type filters.',
      );
      forbidPathKeysExcept(request, findings, ['customer_id', 'invoice_id'], 'invoices.listBreakdowns path supports only customer_id.');
    },
  },
  'invoices.get': {
    checked: ['secret scan', 'invoice id'],
    apply(request, findings) {
      requirePath(request, findings, 'body.invoice_id');
      requireSafeIdentifier(request, findings, 'body.invoice_id');
    },
  },
  'invoices.void': {
    checked: ['secret scan', 'invoice id body field', 'FINALIZED invoice evidence', 'Stripe non-refund evidence', 'reconciliation evidence', 'raw path refusal'],
    apply(request, findings) {
      requirePath(request, findings, 'body.id');
      requireSafeIdentifier(request, findings, 'body.id');
      requireEvidenceTrue(request, findings, 'evidence.invoiceFinalizedReviewed', 'evidence.invoiceFinalizedReviewed must be true because invoices.void only applies to FINALIZED invoices.', 'MTR-INV-002', ['api-validation', 'danger-zone']);
      requireEvidenceTrue(request, findings, 'evidence.stripePaymentStatusReviewed', 'evidence.stripePaymentStatusReviewed must be true before voiding a possibly Stripe-synced invoice.', 'MTR-INV-002', ['api-validation', 'danger-zone']);
      requireEvidenceTrue(request, findings, 'evidence.stripeNoRefundReviewed', 'evidence.stripeNoRefundReviewed must be true because Metronome invoice void does not refund Stripe.', 'MTR-INV-002', ['api-validation', 'danger-zone']);
      requireEvidenceTrue(request, findings, 'evidence.reconciliationPlanReviewed', 'evidence.reconciliationPlanReviewed must be true before invoice void validation can pass.', 'MTR-INV-002', ['api-validation', 'danger-zone']);
      requireEvidenceTrue(request, findings, 'evidence.customerInvoiceInventoryReviewed', 'evidence.customerInvoiceInventoryReviewed must be true before invoice void validation can pass.', 'MTR-INV-003', ['api-validation', 'danger-zone']);
      requireEvidenceTrue(request, findings, 'evidence.invoiceReadBackPlanned', 'evidence.invoiceReadBackPlanned must be true before invoice void validation can pass.', 'MTR-VERIFY-001', ['api-validation', 'metronome-invoicing']);
      requireEvidenceTrue(request, findings, 'evidence.rollbackOrRemediationReviewed', 'evidence.rollbackOrRemediationReviewed must be true before invoice void validation can pass.', 'MTR-VERIFY-002', ['api-validation', 'danger-zone']);
      for (const path of ['body.invoice_id', 'body.customer_id', 'body.contract_id', 'query.id', 'query.invoice_id', 'path.invoice_id']) {
        forbidPath(request, findings, path, 'invoices.void uses body.id plus explicit side-effect evidence in the reviewed local contract.');
      }
      forbidRawEndpointPathFields(request, findings, 'invoices.void', 'POST /v1/invoices/void');
      forbidBodyKeysExcept(
        request,
        findings,
        ['id', 'invoice_id', 'customer_id', 'contract_id', 'path', 'url', 'method'],
        'invoices.void body supports only id in the reviewed local contract.',
      );
      forbidQueryKeysExcept(request, findings, ['id', 'invoice_id', 'path', 'url', 'method'], 'invoices.void does not use query parameters in the reviewed local contract.');
      forbidPathKeysExcept(request, findings, ['invoice_id', 'path', 'url', 'method'], 'invoices.void does not use path parameters in the reviewed local contract.');
    },
  },
  'invoices.regenerate': {
    checked: ['secret scan', 'invoice id body field', 'VOIDED invoice evidence', 'correction evidence', 'Stripe delivery evidence', 'read-back evidence', 'raw path refusal'],
    apply(request, findings) {
      requirePath(request, findings, 'body.id');
      requireSafeIdentifier(request, findings, 'body.id');
      requireEvidenceTrue(request, findings, 'evidence.invoiceVoidedReviewed', 'evidence.invoiceVoidedReviewed must be true because invoices.regenerate is for VOIDED invoices.', 'MTR-INV-005', ['api-validation', 'danger-zone']);
      requireEvidenceTrue(request, findings, 'evidence.correctionInputsReviewed', 'evidence.correctionInputsReviewed must be true before invoice regeneration validation can pass.', 'MTR-INV-005', ['api-validation', 'metronome-invoicing']);
      requireEvidenceTrue(request, findings, 'evidence.billingProviderBehaviorReviewed', 'evidence.billingProviderBehaviorReviewed must be true before invoice regeneration validation can pass.', 'MTR-BILL-004', ['api-validation', 'metronome-stripe-delivery']);
      requireEvidenceTrue(request, findings, 'evidence.regeneratedInvoiceReadBackPlanned', 'evidence.regeneratedInvoiceReadBackPlanned must be true before invoice regeneration validation can pass.', 'MTR-VERIFY-001', ['api-validation', 'metronome-invoicing']);
      requireEvidenceTrue(request, findings, 'evidence.reconciliationPlanReviewed', 'evidence.reconciliationPlanReviewed must be true before invoice regeneration validation can pass.', 'MTR-INV-005', ['api-validation', 'danger-zone']);
      requireEvidenceTrue(request, findings, 'evidence.rollbackOrRemediationReviewed', 'evidence.rollbackOrRemediationReviewed must be true before invoice regeneration validation can pass.', 'MTR-VERIFY-002', ['api-validation', 'danger-zone']);
      for (const path of ['body.invoice_id', 'body.customer_id', 'body.contract_id', 'query.id', 'query.invoice_id', 'path.invoice_id']) {
        forbidPath(request, findings, path, 'invoices.regenerate uses body.id plus explicit correction and distribution evidence in the reviewed local contract.');
      }
      forbidRawEndpointPathFields(request, findings, 'invoices.regenerate', 'POST /v1/invoices/regenerate');
      forbidBodyKeysExcept(
        request,
        findings,
        ['id', 'invoice_id', 'customer_id', 'contract_id', 'path', 'url', 'method'],
        'invoices.regenerate body supports only id in the reviewed local contract.',
      );
      forbidQueryKeysExcept(request, findings, ['id', 'invoice_id', 'path', 'url', 'method'], 'invoices.regenerate does not use query parameters in the reviewed local contract.');
      forbidPathKeysExcept(request, findings, ['invoice_id', 'path', 'url', 'method'], 'invoices.regenerate does not use path parameters in the reviewed local contract.');
    },
  },
  'payments.listForInvoice': {
    checked: ['secret scan', 'invoice id', 'body pagination', 'query fields forbidden'],
    apply(request, findings) {
      requirePath(request, findings, 'body.invoice_id');
      requireSafeIdentifier(request, findings, 'body.invoice_id');
      requireIntegerRange(request, findings, 'body.limit', 1, 100);
      requireNonEmptyString(request, findings, 'body.next_page');
      forbidPath(request, findings, 'query.invoice_id', 'payments.listForInvoice is a POST read; invoice_id belongs in the JSON body.');
      forbidPath(request, findings, 'query.limit', 'payments.listForInvoice pagination belongs in the JSON body for the reviewed local contract.');
      forbidPath(request, findings, 'query.next_page', 'payments.listForInvoice pagination belongs in the JSON body for the reviewed local contract.');
      forbidPath(request, findings, 'body.customer_id', 'payments.listForInvoice is invoice-scoped; use body.invoice_id, not body.customer_id.');
      forbidPath(request, findings, 'body.invoiceId', 'Use body.invoice_id for payments.listForInvoice.');
      forbidBodyKeysExcept(request, findings, ['invoice_id', 'limit', 'next_page'], 'payments.listForInvoice body supports only invoice_id, limit, and next_page in the reviewed local contract.');
      forbidQueryKeysExcept(request, findings, [], 'payments.listForInvoice does not use query parameters in the reviewed local contract.');
    },
  },
  'payments.attempt': {
    checked: ['secret scan', 'invoice id', 'FINALIZED invoice evidence', 'PLG and billing-provider evidence', 'payment duplicate review', 'raw path refusal'],
    apply(request, findings) {
      requirePath(request, findings, 'body.invoice_id');
      requireSafeIdentifier(request, findings, 'body.invoice_id');
      requireEvidenceTrue(request, findings, 'evidence.invoiceFinalizedReviewed', 'evidence.invoiceFinalizedReviewed must be true before payment attempt validation can pass.', 'MTR-PAY-001', ['api-validation', 'danger-zone']);
      requireEvidenceTrue(request, findings, 'evidence.plgInvoicingEnabledReviewed', 'evidence.plgInvoicingEnabledReviewed must be true before payment attempt validation can pass.', 'MTR-PAY-001', ['api-validation', 'danger-zone']);
      requireEvidenceTrue(request, findings, 'evidence.billingProviderAttachedReviewed', 'evidence.billingProviderAttachedReviewed must be true before payment attempt validation can pass.', 'MTR-PAY-001', ['api-validation', 'metronome-stripe-delivery']);
      requireEvidenceTrue(request, findings, 'evidence.noSuccessfulPaymentReviewed', 'evidence.noSuccessfulPaymentReviewed must be true before payment attempt validation can pass.', 'MTR-PAY-002', ['api-validation', 'danger-zone']);
      requireEvidenceTrue(request, findings, 'evidence.paymentMethodReviewed', 'evidence.paymentMethodReviewed must be true before payment attempt validation can pass.', 'MTR-PAY-001', ['api-validation', 'metronome-stripe-delivery']);
      requireEvidenceTrue(request, findings, 'evidence.paymentReadBackPlanned', 'evidence.paymentReadBackPlanned must be true before payment attempt validation can pass.', 'MTR-VERIFY-001', ['api-validation', 'danger-zone']);
      requireEvidenceTrue(request, findings, 'evidence.retryOrCustomerActionPlanReviewed', 'evidence.retryOrCustomerActionPlanReviewed must be true before payment attempt validation can pass.', 'MTR-VERIFY-002', ['api-validation', 'danger-zone']);
      for (const path of ['body.id', 'body.customer_id', 'body.payment_id', 'query.invoice_id', 'query.id', 'path.invoice_id']) {
        forbidPath(request, findings, path, 'payments.attempt uses body.invoice_id plus explicit payment precondition evidence in the reviewed local contract.');
      }
      forbidRawEndpointPathFields(request, findings, 'payments.attempt', 'POST /v1/invoices/payments/attempt');
      forbidBodyKeysExcept(
        request,
        findings,
        ['invoice_id', 'id', 'customer_id', 'payment_id', 'path', 'url', 'method'],
        'payments.attempt body supports only invoice_id in the reviewed local contract.',
      );
      forbidQueryKeysExcept(request, findings, ['invoice_id', 'id', 'path', 'url', 'method'], 'payments.attempt does not use query parameters in the reviewed local contract.');
      forbidPathKeysExcept(request, findings, ['invoice_id', 'path', 'url', 'method'], 'payments.attempt does not use path parameters in the reviewed local contract.');
    },
  },
  'payments.cancel': {
    checked: ['secret scan', 'invoice id', 'pending payment evidence', 'customer communication review', 'retry/remediation evidence', 'raw path refusal'],
    apply(request, findings) {
      requirePath(request, findings, 'body.invoice_id');
      requireSafeIdentifier(request, findings, 'body.invoice_id');
      requireEvidenceTrue(request, findings, 'evidence.pendingPaymentReviewed', 'evidence.pendingPaymentReviewed must be true before payment cancel validation can pass.', 'MTR-PAY-003', ['api-validation', 'danger-zone']);
      requireEvidenceTrue(request, findings, 'evidence.invoiceIdentityReviewed', 'evidence.invoiceIdentityReviewed must be true before payment cancel validation can pass.', 'MTR-PAY-003', ['api-validation', 'danger-zone']);
      requireEvidenceTrue(request, findings, 'evidence.customerCommunicationReviewed', 'evidence.customerCommunicationReviewed must be true before payment cancel validation can pass.', 'MTR-PAY-003', ['api-validation', 'danger-zone']);
      requireEvidenceTrue(request, findings, 'evidence.paymentReadBackPlanned', 'evidence.paymentReadBackPlanned must be true before payment cancel validation can pass.', 'MTR-VERIFY-001', ['api-validation', 'danger-zone']);
      requireEvidenceTrue(request, findings, 'evidence.retryOrRemediationReviewed', 'evidence.retryOrRemediationReviewed must be true before payment cancel validation can pass.', 'MTR-VERIFY-002', ['api-validation', 'danger-zone']);
      for (const path of ['body.id', 'body.customer_id', 'body.payment_id', 'query.invoice_id', 'query.id', 'path.invoice_id']) {
        forbidPath(request, findings, path, 'payments.cancel uses body.invoice_id plus pending payment and remediation evidence in the reviewed local contract.');
      }
      forbidRawEndpointPathFields(request, findings, 'payments.cancel', 'POST /v1/invoices/payments/cancel');
      forbidBodyKeysExcept(
        request,
        findings,
        ['invoice_id', 'id', 'customer_id', 'payment_id', 'path', 'url', 'method'],
        'payments.cancel body supports only invoice_id in the reviewed local contract.',
      );
      forbidQueryKeysExcept(request, findings, ['invoice_id', 'id', 'path', 'url', 'method'], 'payments.cancel does not use query parameters in the reviewed local contract.');
      forbidPathKeysExcept(request, findings, ['invoice_id', 'path', 'url', 'method'], 'payments.cancel does not use path parameters in the reviewed local contract.');
    },
  },
  'billingProvider.setCustomerConfigurations': {
    checked: ['secret scan', 'customer id', 'billing provider type', 'delivery method decision'],
    apply(request, findings) {
      requirePath(request, findings, 'body.customer_id');
      requirePath(request, findings, 'body.configuration.billing_provider_type');
      requireAny(
        request,
        findings,
        ['body.configuration.delivery_method', 'body.configuration.delivery_method_id'],
        'Billing-provider configuration requires delivery_method or delivery_method_id.',
      );
      if (pathExists(request, 'body.configuration.delivery_method') && pathExists(request, 'body.configuration.delivery_method_id')) {
        add(findings, 'MTR-BILL-002', 'Use delivery_method or delivery_method_id, not both.', 'body.configuration', ['api-validation', 'metronome-stripe-delivery']);
      }
      requireSafeIdentifier(request, findings, 'body.customer_id');
    },
  },
  'billingProvider.getCustomerConfigurations': {
    checked: ['secret scan', 'customer id'],
    apply(request, findings) {
      requirePath(request, findings, 'body.customer_id');
      requireSafeIdentifier(request, findings, 'body.customer_id');
    },
  },
  'billingProvider.listConfiguredProviders': {
    checked: ['secret scan', 'account-level billing provider list', 'body cursor pagination', 'query pagination forbidden'],
    apply(request, findings) {
      requireSafeIdentifier(request, findings, 'body.next_page');
      forbidPath(request, findings, 'query.next_page', 'billingProvider.listConfiguredProviders pagination cursor belongs in body.next_page, not query.next_page.');
      forbidPath(request, findings, 'query.limit', 'billingProvider.listConfiguredProviders does not use query.limit in the reviewed local contract.');
      forbidBodyKeysExcept(request, findings, ['next_page'], 'billingProvider.listConfiguredProviders body supports only next_page in the reviewed local contract.');
      forbidQueryKeysExcept(request, findings, ['next_page', 'limit'], 'billingProvider.listConfiguredProviders does not use query parameters in the reviewed local contract.');
    },
  },
  'customFields.listKeys': {
    checked: ['secret scan', 'body entity filters', 'query cursor pagination', 'entity enum', 'body cursor forbidden'],
    apply(request, findings) {
      requireStringArrayEnum(request, findings, 'body.entities', MANAGED_ENTITY_TYPES);
      requireSafeIdentifier(request, findings, 'query.next_page');
      forbidPath(request, findings, 'query.entities', 'customFields.listKeys entity filters belong in body.entities, not query.entities.');
      forbidPath(request, findings, 'body.next_page', 'customFields.listKeys pagination cursor belongs in query.next_page, not the request body.');
      forbidPath(request, findings, 'body.path', 'Use endpoint id customFields.listKeys and the reviewed /v1/customFields/listKeys path; do not include raw endpoint paths in request files.');
      forbidPath(request, findings, 'query.path', 'Use endpoint id customFields.listKeys and the reviewed /v1/customFields/listKeys path; do not include raw endpoint paths in request files.');
      forbidPath(request, findings, 'path.path', 'Use endpoint id customFields.listKeys and the reviewed /v1/customFields/listKeys path; do not include raw endpoint paths in request files.');
      forbidBodyKeysExcept(request, findings, ['entities', 'next_page', 'path'], 'customFields.listKeys body supports only entities[] in the reviewed local contract.');
      forbidQueryKeysExcept(request, findings, ['next_page', 'entities', 'path'], 'customFields.listKeys query supports only next_page in the reviewed local contract.');
      forbidPathKeysExcept(request, findings, ['path'], 'customFields.listKeys does not use path parameters in the reviewed local contract.');
    },
  },
  'customFields.addKey': {
    checked: ['secret scan', 'body entity', 'body key', 'enforce_uniqueness decision', 'value-setting payload refusal', 'raw path refusal'],
    apply(request, findings) {
      requirePath(request, findings, 'body.entity');
      requirePath(request, findings, 'body.key');
      requirePath(request, findings, 'body.enforce_uniqueness');
      requireEnum(request, findings, 'body.entity', MANAGED_ENTITY_TYPES);
      requireSafeIdentifier(request, findings, 'body.key');
      requireBoolean(request, findings, 'body.enforce_uniqueness');
      forbidPath(request, findings, 'body.entity_type', 'customFields.addKey uses body.entity from the reviewed ManagedEntity enum, not body.entity_type.');
      forbidPath(request, findings, 'body.entities', 'customFields.addKey creates one key for one body.entity; body.entities belongs to customFields.listKeys.');
      forbidPath(request, findings, 'body.values', 'customFields.addKey only allowlists a key; value setting belongs to customFields.setValues after the key is approved.');
      forbidPath(request, findings, 'body.custom_fields', 'customFields.addKey only creates an allowlist key; do not include custom field values in this request.');
      forbidPath(request, findings, 'body.next_page', 'customFields.addKey is a write and does not accept pagination cursors.');
      forbidPath(request, findings, 'query.next_page', 'customFields.addKey is a write and does not accept query pagination.');
      forbidPath(request, findings, 'body.path', 'Use endpoint id customFields.addKey and the reviewed /v1/customFields/addKey path; do not include raw endpoint paths in request files.');
      forbidPath(request, findings, 'query.path', 'Use endpoint id customFields.addKey and the reviewed /v1/customFields/addKey path; do not include raw endpoint paths in request files.');
      forbidPath(request, findings, 'path.path', 'Use endpoint id customFields.addKey and the reviewed /v1/customFields/addKey path; do not include raw endpoint paths in request files.');
      forbidBodyKeysExcept(
        request,
        findings,
        ['entity', 'key', 'enforce_uniqueness', 'entity_type', 'entities', 'values', 'custom_fields', 'next_page', 'path'],
        'customFields.addKey body supports only entity, key, and enforce_uniqueness in the reviewed local contract.',
      );
      forbidQueryKeysExcept(request, findings, ['next_page', 'path'], 'customFields.addKey does not use query parameters in the reviewed local contract.');
      forbidPathKeysExcept(request, findings, ['path'], 'customFields.addKey does not use path parameters in the reviewed local contract.');
    },
  },
  'customFields.removeKey': {
    checked: ['secret scan', 'body entity', 'body key', 'allowlist removal review', 'value payload refusal', 'raw path refusal'],
    apply(request, findings) {
      requirePath(request, findings, 'body.entity');
      requirePath(request, findings, 'body.key');
      requireEnum(request, findings, 'body.entity', MANAGED_ENTITY_TYPES);
      requireSafeIdentifier(request, findings, 'body.key');
      forbidPath(request, findings, 'body.entity_type', 'customFields.removeKey uses body.entity from the reviewed ManagedEntity enum, not body.entity_type.');
      forbidPath(request, findings, 'body.entities', 'customFields.removeKey removes one key for one body.entity; body.entities belongs to customFields.listKeys.');
      forbidPath(request, findings, 'body.entity_id', 'customFields.removeKey removes a key from the entity-type allowlist; entity instance writes use setValues/deleteValues.');
      forbidPath(request, findings, 'body.keys', 'customFields.removeKey removes one allowlist key with body.key; body.keys belongs to customFields.deleteValues.');
      forbidPath(request, findings, 'body.enforce_uniqueness', 'customFields.removeKey does not mutate uniqueness policy; enforce_uniqueness belongs to customFields.addKey.');
      forbidPath(request, findings, 'body.values', 'customFields.removeKey does not delete instance values directly; value deletion belongs to customFields.deleteValues.');
      forbidPath(request, findings, 'body.custom_fields', 'customFields.removeKey does not set instance values; value setting belongs to customFields.setValues.');
      forbidPath(request, findings, 'body.next_page', 'customFields.removeKey is a write and does not accept pagination cursors.');
      forbidPath(request, findings, 'query.next_page', 'customFields.removeKey is a write and does not accept query pagination.');
      forbidPath(request, findings, 'body.path', 'Use endpoint id customFields.removeKey and the reviewed /v1/customFields/removeKey path; do not include raw endpoint paths in request files.');
      forbidPath(request, findings, 'query.path', 'Use endpoint id customFields.removeKey and the reviewed /v1/customFields/removeKey path; do not include raw endpoint paths in request files.');
      forbidPath(request, findings, 'path.path', 'Use endpoint id customFields.removeKey and the reviewed /v1/customFields/removeKey path; do not include raw endpoint paths in request files.');
      forbidBodyKeysExcept(
        request,
        findings,
        ['entity', 'key', 'entity_type', 'entities', 'entity_id', 'keys', 'enforce_uniqueness', 'values', 'custom_fields', 'next_page', 'path'],
        'customFields.removeKey body supports only entity and key in the reviewed local contract.',
      );
      forbidQueryKeysExcept(request, findings, ['next_page', 'path'], 'customFields.removeKey does not use query parameters in the reviewed local contract.');
      forbidPathKeysExcept(request, findings, ['path'], 'customFields.removeKey does not use path parameters in the reviewed local contract.');
    },
  },
  'customFields.setValues': {
    checked: ['secret scan', 'body entity', 'body entity_id', 'custom_fields object', '200 character value limit', 'allowlist mutation refusal', 'raw path refusal'],
    apply(request, findings) {
      requirePath(request, findings, 'body.entity');
      requirePath(request, findings, 'body.entity_id');
      requirePath(request, findings, 'body.custom_fields');
      requireEnum(request, findings, 'body.entity', MANAGED_ENTITY_TYPES);
      requireSafeIdentifier(request, findings, 'body.entity_id');
      requireCustomFieldsObject(request, findings, 'body.custom_fields', { maxValueLength: 200 });
      forbidPath(request, findings, 'body.entity_type', 'customFields.setValues uses body.entity from the reviewed ManagedEntity enum, not body.entity_type.');
      forbidPath(request, findings, 'body.entities', 'customFields.setValues targets one entity instance; body.entities belongs to customFields.listKeys.');
      forbidPath(request, findings, 'body.key', 'customFields.setValues writes values in body.custom_fields; body.key belongs to customFields.addKey or removeKey.');
      forbidPath(request, findings, 'body.keys', 'customFields.setValues writes values in body.custom_fields; key deletion belongs to customFields.deleteValues.');
      forbidPath(request, findings, 'body.enforce_uniqueness', 'customFields.setValues does not mutate the allowlist or uniqueness policy; enforce_uniqueness belongs to customFields.addKey.');
      forbidPath(request, findings, 'body.values', 'customFields.setValues uses body.custom_fields, not a body.values wrapper.');
      forbidPath(request, findings, 'body.next_page', 'customFields.setValues is a write and does not accept pagination cursors.');
      forbidPath(request, findings, 'query.next_page', 'customFields.setValues is a write and does not accept query pagination.');
      forbidPath(request, findings, 'body.path', 'Use endpoint id customFields.setValues and the reviewed /v1/customFields/setValues path; do not include raw endpoint paths in request files.');
      forbidPath(request, findings, 'query.path', 'Use endpoint id customFields.setValues and the reviewed /v1/customFields/setValues path; do not include raw endpoint paths in request files.');
      forbidPath(request, findings, 'path.path', 'Use endpoint id customFields.setValues and the reviewed /v1/customFields/setValues path; do not include raw endpoint paths in request files.');
      forbidBodyKeysExcept(
        request,
        findings,
        ['entity', 'entity_id', 'custom_fields', 'entity_type', 'entities', 'key', 'keys', 'enforce_uniqueness', 'values', 'next_page', 'path'],
        'customFields.setValues body supports only entity, entity_id, and custom_fields in the reviewed local contract.',
      );
      forbidQueryKeysExcept(request, findings, ['next_page', 'path'], 'customFields.setValues does not use query parameters in the reviewed local contract.');
      forbidPathKeysExcept(request, findings, ['path'], 'customFields.setValues does not use path parameters in the reviewed local contract.');
    },
  },
  'customFields.deleteValues': {
    checked: ['secret scan', 'body entity', 'body entity_id', 'keys array', 'value-setting payload refusal', 'allowlist mutation refusal', 'raw path refusal'],
    apply(request, findings) {
      requirePath(request, findings, 'body.entity');
      requirePath(request, findings, 'body.entity_id');
      requirePath(request, findings, 'body.keys');
      requireEnum(request, findings, 'body.entity', MANAGED_ENTITY_TYPES);
      requireSafeIdentifier(request, findings, 'body.entity_id');
      requireSafeIdentifierArray(request, findings, 'body.keys');
      forbidPath(request, findings, 'body.entity_type', 'customFields.deleteValues uses body.entity from the reviewed ManagedEntity enum, not body.entity_type.');
      forbidPath(request, findings, 'body.entities', 'customFields.deleteValues targets one entity instance; body.entities belongs to customFields.listKeys.');
      forbidPath(request, findings, 'body.key', 'customFields.deleteValues deletes instance values with body.keys[]; body.key belongs to addKey/removeKey.');
      forbidPath(request, findings, 'body.enforce_uniqueness', 'customFields.deleteValues does not mutate the allowlist or uniqueness policy; enforce_uniqueness belongs to customFields.addKey.');
      forbidPath(request, findings, 'body.values', 'customFields.deleteValues deletes by keys[] and does not accept a body.values wrapper.');
      forbidPath(request, findings, 'body.custom_fields', 'customFields.deleteValues deletes by keys[]; value setting belongs to customFields.setValues.');
      forbidPath(request, findings, 'body.next_page', 'customFields.deleteValues is a write and does not accept pagination cursors.');
      forbidPath(request, findings, 'query.next_page', 'customFields.deleteValues is a write and does not accept query pagination.');
      forbidPath(request, findings, 'body.path', 'Use endpoint id customFields.deleteValues and the reviewed /v1/customFields/deleteValues path; do not include raw endpoint paths in request files.');
      forbidPath(request, findings, 'query.path', 'Use endpoint id customFields.deleteValues and the reviewed /v1/customFields/deleteValues path; do not include raw endpoint paths in request files.');
      forbidPath(request, findings, 'path.path', 'Use endpoint id customFields.deleteValues and the reviewed /v1/customFields/deleteValues path; do not include raw endpoint paths in request files.');
      forbidBodyKeysExcept(
        request,
        findings,
        ['entity', 'entity_id', 'keys', 'entity_type', 'entities', 'key', 'enforce_uniqueness', 'values', 'custom_fields', 'next_page', 'path'],
        'customFields.deleteValues body supports only entity, entity_id, and keys[] in the reviewed local contract.',
      );
      forbidQueryKeysExcept(request, findings, ['next_page', 'path'], 'customFields.deleteValues does not use query parameters in the reviewed local contract.');
      forbidPathKeysExcept(request, findings, ['path'], 'customFields.deleteValues does not use path parameters in the reviewed local contract.');
    },
  },
  'settings.listPricingUnits': {
    checked: ['secret scan', 'current official pricing units path', 'GET query pagination', 'body forbidden'],
    apply(request, findings) {
      requirePath(request, findings, 'query.limit');
      requireSafeIdentifier(request, findings, 'query.next_page');
      forbidPath(request, findings, 'body.limit', 'settings.listPricingUnits is a GET read; pagination limit belongs in query.limit, not the body.');
      forbidPath(request, findings, 'body.next_page', 'settings.listPricingUnits is a GET read; pagination next_page belongs in query.next_page, not the body.');
      forbidPath(request, findings, 'body.path', 'Use endpoint id settings.listPricingUnits and the reviewed /v1/credit-types/list path; do not include raw endpoint paths in request files.');
      forbidPath(request, findings, 'query.path', 'Use endpoint id settings.listPricingUnits and the reviewed /v1/credit-types/list path; do not include raw endpoint paths in request files.');
      for (const path of ['body.path', 'query.path']) {
        if (getPath(request, path) === '/v1/pricingUnits') {
          add(findings, 'MTR-ENDPOINT-002', 'The stale /v1/pricingUnits path is not the reviewed current pricing-units endpoint; use GET /v1/credit-types/list through settings.listPricingUnits.', path, ['endpoint-matrix', 'official-pricing-units-list']);
        }
      }
      forbidBodyKeysExcept(request, findings, ['limit', 'next_page', 'path'], 'settings.listPricingUnits does not use a request body in the reviewed local contract.');
      forbidQueryKeysExcept(request, findings, ['limit', 'next_page', 'path'], 'settings.listPricingUnits query supports only limit and next_page in the reviewed local contract.');
    },
  },
  'security.getServices': {
    checked: ['secret scan', 'current official services path', 'body/query/path forbidden'],
    apply(request, findings) {
      for (const path of ['body.path', 'query.path', 'path.path']) {
        if (getPath(request, path) === '/v1/security/services') {
          add(findings, 'MTR-ENDPOINT-002', 'The stale /v1/security/services path is not the reviewed current service-registry endpoint; use GET /v1/services through security.getServices.', path, ['endpoint-matrix', 'official-security-services']);
        }
      }
      forbidPath(request, findings, 'body.path', 'Use endpoint id security.getServices and the reviewed /v1/services path; do not include raw endpoint paths in request files.');
      forbidPath(request, findings, 'query.path', 'Use endpoint id security.getServices and the reviewed /v1/services path; do not include raw endpoint paths in request files.');
      forbidPath(request, findings, 'path.path', 'Use endpoint id security.getServices and the reviewed /v1/services path; do not include raw endpoint paths in request files.');
      forbidBodyKeysExcept(request, findings, ['path'], 'security.getServices does not use a request body in the reviewed local contract.');
      forbidQueryKeysExcept(request, findings, ['path'], 'security.getServices does not use query parameters in the reviewed local contract.');
      forbidPathKeysExcept(request, findings, ['path'], 'security.getServices does not use path parameters in the reviewed local contract.');
    },
  },
  'security.getAuditLogs': {
    checked: ['secret scan', 'current official audit-log path', 'GET query filters', 'next_page/date-filter exclusivity', 'paired resource filters', 'body/path forbidden'],
    apply(request, findings) {
      for (const path of ['body.path', 'query.path', 'path.path']) {
        if (getPath(request, path) === '/v1/security/auditLogs') {
          add(findings, 'MTR-ENDPOINT-002', 'The stale /v1/security/auditLogs path is not the reviewed current audit-log endpoint; use GET /v1/auditLogs through security.getAuditLogs.', path, ['endpoint-matrix', 'official-security-audit-logs']);
        }
      }
      requireIntegerRange(request, findings, 'query.limit', 1, 100);
      requireSafeIdentifier(request, findings, 'query.next_page');
      requireDateTime(request, findings, 'query.starting_on');
      requireDateTime(request, findings, 'query.ending_before');
      requireEnum(request, findings, 'query.sort', ['date_asc', 'date_desc']);
      requireSafeIdentifier(request, findings, 'query.resource_id');
      requireSafeIdentifier(request, findings, 'query.resource_type');
      if (pathExists(request, 'query.next_page') && (pathExists(request, 'query.starting_on') || pathExists(request, 'query.ending_before'))) {
        add(findings, 'MTR-APIREQ-004', 'security.getAuditLogs query.next_page cannot be used with query.starting_on or query.ending_before.', 'query.next_page', ['api-validation', 'official-security-audit-logs']);
      }
      if (pathExists(request, 'query.resource_id') !== pathExists(request, 'query.resource_type')) {
        add(findings, 'MTR-APIREQ-001', 'security.getAuditLogs resource filters must include both query.resource_id and query.resource_type.', 'query.resource_id|query.resource_type', ['api-validation', 'official-security-audit-logs']);
      }
      forbidPath(request, findings, 'body.path', 'Use endpoint id security.getAuditLogs and the reviewed /v1/auditLogs path; do not include raw endpoint paths in request files.');
      forbidPath(request, findings, 'query.path', 'Use endpoint id security.getAuditLogs and the reviewed /v1/auditLogs path; do not include raw endpoint paths in request files.');
      forbidPath(request, findings, 'path.path', 'Use endpoint id security.getAuditLogs and the reviewed /v1/auditLogs path; do not include raw endpoint paths in request files.');
      forbidBodyKeysExcept(request, findings, ['path'], 'security.getAuditLogs does not use a request body in the reviewed local contract.');
      forbidQueryKeysExcept(request, findings, ['limit', 'next_page', 'starting_on', 'ending_before', 'sort', 'resource_id', 'resource_type', 'path'], 'security.getAuditLogs query supports only reviewed audit-log filters and pagination fields.');
      forbidPathKeysExcept(request, findings, ['path'], 'security.getAuditLogs does not use path parameters in the reviewed local contract.');
    },
  },
  'products.get': {
    checked: ['secret scan', 'official body id', 'stale product_id refusal'],
    apply(request, findings) {
      requirePath(request, findings, 'body.id');
      requireSafeIdentifier(request, findings, 'body.id');
      forbidPath(request, findings, 'body.product_id', 'products.get uses the official body.id field; body.product_id is a stale local request shape.');
      forbidPath(request, findings, 'query.id', 'products.get is a POST read; id belongs in the JSON body.');
      forbidPath(request, findings, 'query.product_id', 'products.get is a POST read; product identifiers belong in the JSON body.');
    },
  },
  'products.list': {
    checked: ['secret scan', 'query pagination', 'archive_filter body decision', 'body pagination forbidden'],
    apply(request, findings) {
      requirePath(request, findings, 'query.limit');
      requirePath(request, findings, 'body.archive_filter');
      requireEnum(request, findings, 'body.archive_filter', ['ARCHIVED', 'NOT_ARCHIVED', 'ALL']);
      forbidPath(request, findings, 'query.archive_filter', 'products.list archive_filter belongs in the POST body, not query parameters.');
      forbidPath(request, findings, 'body.limit', 'products.list pagination limit belongs in query.limit, not the POST body.');
      forbidPath(request, findings, 'body.next_page', 'products.list pagination next_page belongs in query.next_page, not the POST body.');
      forbidBodyKeysExcept(request, findings, ['archive_filter', 'limit', 'next_page'], 'products.list request body only supports archive_filter in the reviewed local contract.');
    },
  },
  'products.create': {
    checked: ['secret scan', 'USAGE product body', 'customer-facing name evidence', 'billable metric proof', 'duplicate product review', 'dimensional key evidence', 'non-usage product refusal', 'raw path/id refusal'],
    apply(request, findings) {
      requirePath(request, findings, 'body.name');
      requireNonEmptyString(request, findings, 'body.name');
      requirePath(request, findings, 'body.type');
      requireEnum(request, findings, 'body.type', ['USAGE']);
      requirePath(request, findings, 'body.billable_metric_id');
      requireSafeIdentifier(request, findings, 'body.billable_metric_id');
      requireEvidenceTrue(
        request,
        findings,
        'evidence.customerFacingNameReviewed',
        'evidence.customerFacingNameReviewed must be true because product names can appear on customer invoices.',
        'MTR-APIREQ-001',
        ['api-validation', 'official-product-create', 'metronome-pricing-catalog'],
      );
      requireEvidenceTrue(
        request,
        findings,
        'evidence.billableMetricReadBackReviewed',
        'evidence.billableMetricReadBackReviewed must be true before creating a USAGE product tied to a billable metric.',
        'MTR-APIREQ-001',
        ['api-validation', 'metronome-pricing-catalog'],
      );
      requireEvidenceTrue(
        request,
        findings,
        'evidence.duplicateProductReviewed',
        'evidence.duplicateProductReviewed must be true because duplicate products on the same billable metric can later double-price events.',
        'MTR-IDEMP-003',
        ['api-validation', 'metronome-pricing-catalog'],
      );
      validateOptionalNonEmptyStringArray(request, findings, 'body.tags');
      const pricingGroupKey = validateOptionalSafeStringArray(request, findings, 'body.pricing_group_key');
      const presentationGroupKey = validateOptionalSafeStringArray(request, findings, 'body.presentation_group_key');
      if (pricingGroupKey.length || presentationGroupKey.length) {
        requireEvidenceTrue(
          request,
          findings,
          'evidence.billableMetricCompoundGroupKeyReviewed',
          'evidence.billableMetricCompoundGroupKeyReviewed must be true when product pricing or presentation group keys are set.',
          'MTR-RATE-005',
          ['api-validation', 'metronome-pricing-catalog'],
        );
        requireEvidenceTrue(
          request,
          findings,
          'evidence.ingestPropertiesReviewed',
          'evidence.ingestPropertiesReviewed must be true when dimensional product keys depend on ingested event properties.',
          'MTR-RATE-005',
          ['api-validation', 'metronome-pricing-catalog'],
        );
      }
      validateQuantityConversion(request, findings, 'body.quantity_conversion');
      validateQuantityRounding(request, findings, 'body.quantity_rounding');
      requireCustomFieldsObject(request, findings, 'body.custom_fields');
      for (const path of [
        'body.composite_product_ids',
        'body.composite_tags',
        'body.composite_scope',
        'body.include_composite_spend',
        'body.exclude_free_usage',
        'body.netsuite_internal_item_id',
        'body.netsuite_overage_item_id',
        'body.is_refundable',
        'body.sql_breakdown_granularity',
        'body.rate_card_id',
        'body.price',
        'body.rate',
        'body.rate_type',
        'body.credit_type_id',
        'body.entitled',
        'body.starting_at',
        'body.product_id',
        'body.id',
      ]) {
        forbidPath(request, findings, path, 'products.create local validation currently supports only reviewed USAGE product catalog fields; pricing, rate-card, SQL, NetSuite, composite, and existing-id fields need separate contracts.');
      }
      forbidPath(request, findings, 'body.path', 'Use endpoint id products.create and the reviewed /v1/contract-pricing/products/create path; do not include raw endpoint paths in request files.');
      forbidPath(request, findings, 'query.path', 'Use endpoint id products.create and the reviewed /v1/contract-pricing/products/create path; do not include raw endpoint paths in request files.');
      forbidPath(request, findings, 'path.path', 'Use endpoint id products.create and the reviewed /v1/contract-pricing/products/create path; do not include raw endpoint paths in request files.');
      forbidBodyKeysExcept(
        request,
        findings,
        [
          'name',
          'type',
          'billable_metric_id',
          'tags',
          'pricing_group_key',
          'presentation_group_key',
          'quantity_conversion',
          'quantity_rounding',
          'custom_fields',
          'composite_product_ids',
          'composite_tags',
          'composite_scope',
          'include_composite_spend',
          'exclude_free_usage',
          'netsuite_internal_item_id',
          'netsuite_overage_item_id',
          'is_refundable',
          'sql_breakdown_granularity',
          'rate_card_id',
          'price',
          'rate',
          'rate_type',
          'credit_type_id',
          'entitled',
          'starting_at',
          'product_id',
          'id',
          'path',
        ],
        'products.create body supports only reviewed USAGE product catalog fields in the local contract.',
      );
      forbidQueryKeysExcept(request, findings, ['path'], 'products.create does not use query parameters in the reviewed local contract.');
      forbidPathKeysExcept(request, findings, ['path'], 'products.create does not use path parameters in the reviewed local contract.');
    },
  },
  'products.update': {
    checked: ['secret scan', 'scheduled product update body', 'hour-boundary starting_at', 'at least one mutable field', 'customer-facing name evidence', 'billable metric proof', 'dimensional key evidence', 'type-change refusal', 'raw path/id refusal'],
    apply(request, findings) {
      requirePath(request, findings, 'body.product_id');
      requireSafeIdentifier(request, findings, 'body.product_id');
      requirePath(request, findings, 'body.starting_at');
      requireHourBoundary(request, findings, 'body.starting_at');
      requireAny(
        request,
        findings,
        [
          'body.name',
          'body.tags',
          'body.billable_metric_id',
          'body.pricing_group_key',
          'body.presentation_group_key',
          'body.quantity_conversion',
          'body.quantity_rounding',
        ],
        'products.update requires at least one reviewed mutable product field.',
      );
      requireEvidenceTrue(
        request,
        findings,
        'evidence.productGetReadBackReviewed',
        'evidence.productGetReadBackReviewed must be true because scheduled product updates must be verified through products.get update history.',
        'MTR-VERIFY-001',
        ['api-validation', 'metronome-pricing-catalog'],
      );
      requireEvidenceTrue(
        request,
        findings,
        'evidence.scheduledUpdateReviewed',
        'evidence.scheduledUpdateReviewed must be true before scheduling a product update at body.starting_at.',
        'MTR-APIREQ-001',
        ['api-validation', 'official-product-update'],
      );
      requireEvidenceTrue(
        request,
        findings,
        'evidence.billingContinuityReviewed',
        'evidence.billingContinuityReviewed must be true before scheduling customer-visible or metering product changes.',
        'MTR-APIREQ-001',
        ['api-validation', 'metronome-pricing-catalog'],
      );
      requireNonEmptyString(request, findings, 'body.name');
      if (pathExists(request, 'body.name')) {
        requireEvidenceTrue(
          request,
          findings,
          'evidence.customerFacingNameReviewed',
          'evidence.customerFacingNameReviewed must be true because product names can appear on customer invoices.',
          'MTR-APIREQ-001',
          ['api-validation', 'official-product-update', 'metronome-pricing-catalog'],
        );
      }
      if (pathExists(request, 'body.billable_metric_id')) {
        requireSafeIdentifier(request, findings, 'body.billable_metric_id');
        requireEvidenceTrue(
          request,
          findings,
          'evidence.billableMetricReadBackReviewed',
          'evidence.billableMetricReadBackReviewed must be true before changing the billable metric on a USAGE product.',
          'MTR-APIREQ-001',
          ['api-validation', 'metronome-pricing-catalog'],
        );
      }
      validateOptionalNonEmptyStringArray(request, findings, 'body.tags');
      const pricingGroupKey = validateOptionalSafeStringArray(request, findings, 'body.pricing_group_key');
      const presentationGroupKey = validateOptionalSafeStringArray(request, findings, 'body.presentation_group_key');
      if (pricingGroupKey.length || presentationGroupKey.length) {
        requireEvidenceTrue(
          request,
          findings,
          'evidence.billableMetricCompoundGroupKeyReviewed',
          'evidence.billableMetricCompoundGroupKeyReviewed must be true when product pricing or presentation group keys are updated.',
          'MTR-RATE-005',
          ['api-validation', 'metronome-pricing-catalog'],
        );
        requireEvidenceTrue(
          request,
          findings,
          'evidence.ingestPropertiesReviewed',
          'evidence.ingestPropertiesReviewed must be true when updated dimensional product keys depend on ingested event properties.',
          'MTR-RATE-005',
          ['api-validation', 'metronome-pricing-catalog'],
        );
      }
      validateQuantityConversion(request, findings, 'body.quantity_conversion');
      validateQuantityRounding(request, findings, 'body.quantity_rounding');
      for (const path of [
        'body.type',
        'body.id',
        'body.composite_product_ids',
        'body.composite_tags',
        'body.composite_scope',
        'body.include_composite_spend',
        'body.exclude_free_usage',
        'body.netsuite_internal_item_id',
        'body.netsuite_overage_item_id',
        'body.is_refundable',
        'body.sql_breakdown_granularity',
        'body.custom_fields',
        'body.rate_card_id',
        'body.price',
        'body.rate',
        'body.rate_type',
        'body.credit_type_id',
        'body.entitled',
      ]) {
        forbidPath(request, findings, path, 'products.update local validation currently supports only reviewed scheduled USAGE product metadata, metric, dimensional, and quantity fields; type changes, pricing, composite, NetSuite, custom-field, and client-gated fields need separate contracts.');
      }
      forbidPath(request, findings, 'body.path', 'Use endpoint id products.update and the reviewed /v1/contract-pricing/products/update path; do not include raw endpoint paths in request files.');
      forbidPath(request, findings, 'query.path', 'Use endpoint id products.update and the reviewed /v1/contract-pricing/products/update path; do not include raw endpoint paths in request files.');
      forbidPath(request, findings, 'path.path', 'Use endpoint id products.update and the reviewed /v1/contract-pricing/products/update path; do not include raw endpoint paths in request files.');
      forbidBodyKeysExcept(
        request,
        findings,
        [
          'product_id',
          'starting_at',
          'name',
          'tags',
          'billable_metric_id',
          'pricing_group_key',
          'presentation_group_key',
          'quantity_conversion',
          'quantity_rounding',
          'type',
          'id',
          'composite_product_ids',
          'composite_tags',
          'composite_scope',
          'include_composite_spend',
          'exclude_free_usage',
          'netsuite_internal_item_id',
          'netsuite_overage_item_id',
          'is_refundable',
          'sql_breakdown_granularity',
          'custom_fields',
          'rate_card_id',
          'price',
          'rate',
          'rate_type',
          'credit_type_id',
          'entitled',
          'path',
        ],
        'products.update body supports only reviewed scheduled USAGE product update fields in the local contract.',
      );
      forbidQueryKeysExcept(request, findings, ['path'], 'products.update does not use query parameters in the reviewed local contract.');
      forbidPathKeysExcept(request, findings, ['path'], 'products.update does not use path parameters in the reviewed local contract.');
    },
  },
  'products.archive': {
    checked: ['secret scan', 'product id', 'product identity evidence', 'rate-card inventory and close evidence', 'invoice-line and irreversibility evidence', 'product/rate-card read-back evidence', 'raw path/id refusal'],
    apply(request, findings) {
      requirePath(request, findings, 'body.product_id');
      requireSafeIdentifier(request, findings, 'body.product_id');
      requireEvidenceTrue(
        request,
        findings,
        'evidence.productIdentityReviewed',
        'evidence.productIdentityReviewed must be true before archiving a product.',
      );
      requireEvidenceTrue(
        request,
        findings,
        'evidence.activeRateCardInventoryReviewed',
        'evidence.activeRateCardInventoryReviewed must be true because archived products do not remove active rate-card entries.',
        'MTR-RATE-003',
        ['api-validation', 'danger-zone', 'official-product-archive'],
      );
      requireRateCardCloseEvidence(request, findings);
      requireEvidenceTrue(
        request,
        findings,
        'evidence.rateCardScheduleReadBackReviewed',
        'evidence.rateCardScheduleReadBackReviewed must be true before product archive validation can pass.',
        'MTR-VERIFY-001',
        ['api-validation', 'danger-zone'],
      );
      requireEvidenceTrue(
        request,
        findings,
        'evidence.invoiceLineBehaviorReviewed',
        'evidence.invoiceLineBehaviorReviewed must be true because active rate-card entries can keep customer-visible invoice lines alive.',
        'MTR-INV-004',
        ['api-validation', 'danger-zone'],
      );
      requireEvidenceTrue(
        request,
        findings,
        'evidence.archiveIrreversibleReviewed',
        'evidence.archiveIrreversibleReviewed must be true because official docs state archived products cannot be unarchived.',
        'MTR-VERIFY-002',
        ['api-validation', 'official-product-archive'],
      );
      requireEvidenceTrue(
        request,
        findings,
        'evidence.productGetListReadBackReviewed',
        'evidence.productGetListReadBackReviewed must be true before product archive validation can pass.',
        'MTR-VERIFY-001',
        ['api-validation', 'official-product-archive'],
      );
      for (const path of [
        'body.id',
        'body.name',
        'body.type',
        'body.billable_metric_id',
        'body.custom_fields',
        'body.rate_card_id',
        'body.starting_at',
        'body.pricing_group_key',
        'body.presentation_group_key',
        'body.quantity_conversion',
        'body.quantity_rounding',
        'body.price',
        'body.rate_type',
        'body.credit_type_id',
        'body.entitled',
        'body.rates',
        'body.products',
        'body.product_order',
        'body.package_id',
        'body.package_alias',
        'body.contract_id',
        'body.customer_id',
      ]) {
        forbidPath(request, findings, path, 'products.archive local validation supports only body.product_id; product updates, rate-card close entries, product ordering, packages, contracts, and customers need separate reviewed workflows.');
      }
      forbidPath(request, findings, 'body.path', 'Use endpoint id products.archive and the reviewed /v1/contract-pricing/products/archive path; do not include raw endpoint paths in request files.');
      forbidPath(request, findings, 'query.product_id', 'products.archive is a POST write; product_id belongs in the JSON body.');
      forbidPath(request, findings, 'query.id', 'products.archive uses official body.product_id, not query.id.');
      forbidPath(request, findings, 'query.path', 'Use endpoint id products.archive and the reviewed /v1/contract-pricing/products/archive path; do not include raw endpoint paths in request files.');
      forbidPath(request, findings, 'path.product_id', 'products.archive uses body.product_id and the reviewed /v1/contract-pricing/products/archive path, not a path product_id.');
      forbidPath(request, findings, 'path.id', 'products.archive uses body.product_id and the reviewed /v1/contract-pricing/products/archive path, not a path id.');
      forbidPath(request, findings, 'path.path', 'Use endpoint id products.archive and the reviewed /v1/contract-pricing/products/archive path; do not include raw endpoint paths in request files.');
      forbidBodyKeysExcept(
        request,
        findings,
        ['product_id'],
        'products.archive body supports only body.product_id in the local contract.',
      );
      forbidQueryKeysExcept(request, findings, ['product_id', 'id', 'path'], 'products.archive does not use query parameters in the reviewed local contract.');
      forbidPathKeysExcept(request, findings, ['product_id', 'id', 'path'], 'products.archive does not use path parameters in the reviewed local contract.');
    },
  },
  'rateCards.create': {
    checked: ['secret scan', 'rate-card metadata body', 'credit type conversion evidence', 'alias uniqueness and schedule evidence', 'duplicate rate-card review', 'rates/package/contract refusal', 'raw path/id refusal'],
    apply(request, findings) {
      requirePath(request, findings, 'body.name');
      requireNonEmptyString(request, findings, 'body.name');
      requireNonEmptyString(request, findings, 'body.description');
      requireSafeIdentifier(request, findings, 'body.fiat_credit_type_id');
      requireEvidenceTrue(
        request,
        findings,
        'evidence.creditTypeConfigurationReviewed',
        'evidence.creditTypeConfigurationReviewed must be true before creating a rate card because fiat/custom pricing-unit setup affects later rates and invoices.',
        'MTR-APIREQ-001',
        ['api-validation', 'official-rate-card-create', 'metronome-pricing-catalog'],
      );
      requireEvidenceTrue(
        request,
        findings,
        'evidence.duplicateRateCardReviewed',
        'evidence.duplicateRateCardReviewed must be true before creating a new rate card.',
        'MTR-IDEMP-003',
        ['api-validation', 'metronome-pricing-catalog'],
      );
      requireEvidenceTrue(
        request,
        findings,
        'evidence.rateCardGetListReadBackReviewed',
        'evidence.rateCardGetListReadBackReviewed must be true because rate-card create verification depends on rateCards.get/list metadata read-back.',
        'MTR-VERIFY-001',
        ['api-validation', 'metronome-pricing-catalog'],
      );
      const conversions = validateCreditTypeConversions(request, findings, 'body.credit_type_conversions');
      if (conversions.length) {
        requirePath(
          request,
          findings,
          'body.fiat_credit_type_id',
          'body.fiat_credit_type_id is required by the local contract when body.credit_type_conversions defines custom pricing-unit conversion.',
        );
      }
      const aliases = validateRateCardAliases(request, findings, 'body.aliases');
      if (aliases.length) {
        requireEvidenceTrue(
          request,
          findings,
          'evidence.aliasUniquenessReviewed',
          'evidence.aliasUniquenessReviewed must be true because a rate-card alias can only point at one latest-assigned rate card.',
          'MTR-IDEMP-003',
          ['api-validation', 'official-rate-card-create', 'metronome-pricing-catalog'],
        );
      }
      requireCustomFieldsObject(request, findings, 'body.custom_fields');
      for (const path of [
        'body.rates',
        'body.rate',
        'body.add_rates',
        'body.addRates',
        'body.products',
        'body.product_id',
        'body.rate_card_id',
        'body.id',
        'body.package_id',
        'body.package_alias',
        'body.contract_id',
        'body.customer_id',
        'body.starting_at',
        'body.price',
        'body.rate_type',
        'body.credit_type_id',
        'body.entitled',
        'body.billing_frequency',
      ]) {
        forbidPath(request, findings, path, 'rateCards.create local validation supports only rate-card metadata, aliases, and credit-type conversion; rates, products, packages, contracts, and existing IDs need separate reviewed workflows.');
      }
      forbidPath(request, findings, 'body.path', 'Use endpoint id rateCards.create and the reviewed /v1/contract-pricing/rate-cards/create path; do not include raw endpoint paths in request files.');
      forbidPath(request, findings, 'query.path', 'Use endpoint id rateCards.create and the reviewed /v1/contract-pricing/rate-cards/create path; do not include raw endpoint paths in request files.');
      forbidPath(request, findings, 'path.path', 'Use endpoint id rateCards.create and the reviewed /v1/contract-pricing/rate-cards/create path; do not include raw endpoint paths in request files.');
      forbidBodyKeysExcept(
        request,
        findings,
        [
          'name',
          'description',
          'fiat_credit_type_id',
          'credit_type_conversions',
          'aliases',
          'custom_fields',
          'rates',
          'rate',
          'add_rates',
          'addRates',
          'products',
          'product_id',
          'rate_card_id',
          'id',
          'package_id',
          'package_alias',
          'contract_id',
          'customer_id',
          'starting_at',
          'price',
          'rate_type',
          'credit_type_id',
          'entitled',
          'billing_frequency',
          'path',
        ],
        'rateCards.create body supports only reviewed rate-card metadata, aliases, credit-type conversion, and custom fields in the local contract.',
      );
      forbidQueryKeysExcept(request, findings, ['path'], 'rateCards.create does not use query parameters in the reviewed local contract.');
      forbidPathKeysExcept(request, findings, ['path'], 'rateCards.create does not use path parameters in the reviewed local contract.');
    },
  },
  'rateCards.update': {
    checked: ['secret scan', 'rate-card metadata update body', 'existing rate-card evidence', 'alias uniqueness and transition evidence', 'pricing/order refusal', 'raw path/id refusal'],
    apply(request, findings) {
      requirePath(request, findings, 'body.rate_card_id');
      requireSafeIdentifier(request, findings, 'body.rate_card_id');
      requireAny(
        request,
        findings,
        ['body.name', 'body.description'],
        'rateCards.update requires at least one of body.name or body.description in the reviewed local contract; alias-only updates need separate sandbox proof.',
      );
      requireNonEmptyString(request, findings, 'body.name');
      requireNonEmptyString(request, findings, 'body.description');
      requireEvidenceTrue(
        request,
        findings,
        'evidence.rateCardIdentityReviewed',
        'evidence.rateCardIdentityReviewed must be true before updating existing rate-card metadata or aliases.',
        'MTR-APIREQ-001',
        ['api-validation', 'official-rate-card-update', 'metronome-pricing-catalog'],
      );
      requireEvidenceTrue(
        request,
        findings,
        'evidence.metadataChangeReviewed',
        'evidence.metadataChangeReviewed must be true before changing rate-card UI/API identity fields.',
        'MTR-APIREQ-001',
        ['api-validation', 'official-rate-card-update'],
      );
      requireEvidenceTrue(
        request,
        findings,
        'evidence.rateCardGetListReadBackReviewed',
        'evidence.rateCardGetListReadBackReviewed must be true because rate-card update verification depends on rateCards.get/list metadata read-back.',
        'MTR-VERIFY-001',
        ['api-validation', 'metronome-pricing-catalog'],
      );
      const aliases = validateRateCardAliases(request, findings, 'body.aliases');
      if (aliases.length) {
        requireEvidenceTrue(
          request,
          findings,
          'evidence.aliasUniquenessReviewed',
          'evidence.aliasUniquenessReviewed must be true because a rate-card alias can only point at one latest-assigned rate card.',
          'MTR-IDEMP-003',
          ['api-validation', 'official-rate-card-update', 'metronome-pricing-catalog'],
        );
        requireEvidenceTrue(
          request,
          findings,
          'evidence.aliasTransitionReviewed',
          'evidence.aliasTransitionReviewed must be true because alias updates affect future contract creation by rate_card_alias.',
          'MTR-VERIFY-002',
          ['api-validation', 'official-rate-card-update', 'metronome-pricing-catalog'],
        );
      }
      for (const path of [
        'body.id',
        'body.fiat_credit_type_id',
        'body.credit_type_conversions',
        'body.custom_fields',
        'body.rates',
        'body.rate',
        'body.add_rates',
        'body.addRates',
        'body.products',
        'body.product_id',
        'body.product_order',
        'body.setProductOrder',
        'body.package_id',
        'body.package_alias',
        'body.contract_id',
        'body.customer_id',
        'body.starting_at',
        'body.price',
        'body.rate_type',
        'body.credit_type_id',
        'body.entitled',
        'body.billing_frequency',
      ]) {
        forbidPath(request, findings, path, 'rateCards.update local validation supports only existing rate-card metadata and aliases; pricing, product ordering, credit conversions, packages, and contracts need separate reviewed workflows.');
      }
      forbidPath(request, findings, 'body.path', 'Use endpoint id rateCards.update and the reviewed /v1/contract-pricing/rate-cards/update path; do not include raw endpoint paths in request files.');
      forbidPath(request, findings, 'query.path', 'Use endpoint id rateCards.update and the reviewed /v1/contract-pricing/rate-cards/update path; do not include raw endpoint paths in request files.');
      forbidPath(request, findings, 'path.path', 'Use endpoint id rateCards.update and the reviewed /v1/contract-pricing/rate-cards/update path; do not include raw endpoint paths in request files.');
      forbidBodyKeysExcept(
        request,
        findings,
        [
          'rate_card_id',
          'name',
          'description',
          'aliases',
          'id',
          'fiat_credit_type_id',
          'credit_type_conversions',
          'custom_fields',
          'rates',
          'rate',
          'add_rates',
          'addRates',
          'products',
          'product_id',
          'product_order',
          'setProductOrder',
          'package_id',
          'package_alias',
          'contract_id',
          'customer_id',
          'starting_at',
          'price',
          'rate_type',
          'credit_type_id',
          'entitled',
          'billing_frequency',
          'path',
        ],
        'rateCards.update body supports only reviewed rate-card metadata and aliases in the local contract.',
      );
      forbidQueryKeysExcept(request, findings, ['path'], 'rateCards.update does not use query parameters in the reviewed local contract.');
      forbidPathKeysExcept(request, findings, ['path'], 'rateCards.update does not use path parameters in the reviewed local contract.');
    },
  },
  'rateCards.archive': {
    checked: ['secret scan', 'body id', 'existing rate-card evidence', 'package/contract dependency evidence', 'pricing/order refusal', 'raw path/id refusal'],
    apply(request, findings) {
      requirePath(request, findings, 'body.id');
      requireSafeIdentifier(request, findings, 'body.id');
      requireEvidenceTrue(
        request,
        findings,
        'evidence.rateCardIdentityReviewed',
        'evidence.rateCardIdentityReviewed must be true before archiving an existing rate card.',
        'MTR-APIREQ-001',
        ['api-validation', 'official-rate-card-archive', 'metronome-pricing-catalog'],
      );
      requireEvidenceTrue(
        request,
        findings,
        'evidence.archiveBusinessPurposeReviewed',
        'evidence.archiveBusinessPurposeReviewed must be true before permanently disabling a rate card for new contract creation.',
        'MTR-APIREQ-001',
        ['api-validation', 'official-rate-card-archive'],
      );
      requireEvidenceTrue(
        request,
        findings,
        'evidence.packageContractDependencyReviewed',
        'evidence.packageContractDependencyReviewed must be true because package and contract workflows can still depend on the rate card being archived.',
        'MTR-VERIFY-001',
        ['api-validation', 'metronome-pricing-catalog'],
      );
      requireEvidenceTrue(
        request,
        findings,
        'evidence.replacementOrRetirementPlanReviewed',
        'evidence.replacementOrRetirementPlanReviewed must be true because archived rate cards are removed from new contract creation workflows.',
        'MTR-VERIFY-002',
        ['api-validation', 'official-rate-card-archive', 'metronome-pricing-catalog'],
      );
      requireEvidenceTrue(
        request,
        findings,
        'evidence.existingContractPricingReviewed',
        'evidence.existingContractPricingReviewed must be true because official docs state existing contract pricing is preserved after archive.',
        'MTR-VERIFY-001',
        ['api-validation', 'official-rate-card-archive'],
      );
      requireEvidenceTrue(
        request,
        findings,
        'evidence.rateCardGetListReadBackReviewed',
        'evidence.rateCardGetListReadBackReviewed must be true because rate-card archive verification depends on rateCards.get/list read-back.',
        'MTR-VERIFY-001',
        ['api-validation', 'metronome-pricing-catalog'],
      );
      for (const path of [
        'body.rate_card_id',
        'body.name',
        'body.description',
        'body.aliases',
        'body.fiat_credit_type_id',
        'body.credit_type_conversions',
        'body.custom_fields',
        'body.rates',
        'body.rate',
        'body.add_rates',
        'body.addRates',
        'body.products',
        'body.product_id',
        'body.product_order',
        'body.setProductOrder',
        'body.package_id',
        'body.package_alias',
        'body.contract_id',
        'body.customer_id',
        'body.starting_at',
        'body.price',
        'body.rate_type',
        'body.credit_type_id',
        'body.entitled',
        'body.billing_frequency',
      ]) {
        forbidPath(request, findings, path, 'rateCards.archive local validation supports only body.id; pricing, product ordering, metadata, packages, contracts, and customers need separate reviewed workflows.');
      }
      forbidPath(request, findings, 'body.path', 'Use endpoint id rateCards.archive and the reviewed /v1/contract-pricing/rate-cards/archive path; do not include raw endpoint paths in request files.');
      forbidPath(request, findings, 'query.id', 'rateCards.archive is a POST write; id belongs in the JSON body.');
      forbidPath(request, findings, 'query.rate_card_id', 'rateCards.archive is a POST write; rate-card identifiers belong in body.id.');
      forbidPath(request, findings, 'query.path', 'Use endpoint id rateCards.archive and the reviewed /v1/contract-pricing/rate-cards/archive path; do not include raw endpoint paths in request files.');
      forbidPath(request, findings, 'path.id', 'rateCards.archive uses body.id and the reviewed /v1/contract-pricing/rate-cards/archive path, not a path id.');
      forbidPath(request, findings, 'path.rate_card_id', 'rateCards.archive uses body.id and the reviewed /v1/contract-pricing/rate-cards/archive path, not a path rate_card_id.');
      forbidPath(request, findings, 'path.path', 'Use endpoint id rateCards.archive and the reviewed /v1/contract-pricing/rate-cards/archive path; do not include raw endpoint paths in request files.');
      forbidBodyKeysExcept(
        request,
        findings,
        [
          'id',
          'rate_card_id',
          'name',
          'description',
          'aliases',
          'fiat_credit_type_id',
          'credit_type_conversions',
          'custom_fields',
          'rates',
          'rate',
          'add_rates',
          'addRates',
          'products',
          'product_id',
          'product_order',
          'setProductOrder',
          'package_id',
          'package_alias',
          'contract_id',
          'customer_id',
          'starting_at',
          'price',
          'rate_type',
          'credit_type_id',
          'entitled',
          'billing_frequency',
          'path',
        ],
        'rateCards.archive body supports only body.id in the local contract.',
      );
      forbidQueryKeysExcept(request, findings, ['id', 'rate_card_id', 'path'], 'rateCards.archive does not use query parameters in the reviewed local contract.');
      forbidPathKeysExcept(request, findings, ['id', 'rate_card_id', 'path'], 'rateCards.archive does not use path parameters in the reviewed local contract.');
    },
  },
  'rateCards.setProductOrder': {
    checked: ['secret scan', 'rate-card id', 'product order identifiers', 'duplicate product refusal', 'product and invoice-presentation evidence', 'pricing/package/contract refusal', 'raw path refusal'],
    apply(request, findings) {
      requirePath(request, findings, 'body.rate_card_id');
      requirePath(request, findings, 'body.product_order');
      requireSafeIdentifier(request, findings, 'body.rate_card_id');
      const productOrder = requireSafeIdentifierArray(request, findings, 'body.product_order');
      const seenProductIds = new Set();
      productOrder.forEach((productId, index) => {
        if (!hasValue(productId) || typeof productId !== 'string') return;
        if (seenProductIds.has(productId)) {
          add(
            findings,
            'MTR-APIREQ-004',
            `body.product_order[${index}] duplicates product id ${productId}; product order must list each product at most once.`,
            `body.product_order[${index}]`,
            ['api-validation', 'official-rate-card-products-order'],
          );
          return;
        }
        seenProductIds.add(productId);
      });
      requireEvidenceTrue(
        request,
        findings,
        'evidence.rateCardIdentityReviewed',
        'evidence.rateCardIdentityReviewed must be true before changing product order on an existing rate card.',
        'MTR-APIREQ-001',
        ['api-validation', 'official-rate-card-products-order', 'metronome-pricing-catalog'],
      );
      requireEvidenceTrue(
        request,
        findings,
        'evidence.productOrderReviewed',
        'evidence.productOrderReviewed must be true before changing the invoice order of rate-card products.',
        'MTR-APIREQ-001',
        ['api-validation', 'official-rate-card-products-order'],
      );
      requireEvidenceTrue(
        request,
        findings,
        'evidence.productReadBackReviewed',
        'evidence.productReadBackReviewed must be true because product-order verification depends on reviewed product ids.',
        'MTR-VERIFY-001',
        ['api-validation', 'official-rate-card-products-order', 'metronome-pricing-catalog'],
      );
      requireEvidenceTrue(
        request,
        findings,
        'evidence.invoicePresentationReviewed',
        'evidence.invoicePresentationReviewed must be true because product order determines how products appear on customer invoices.',
        'MTR-VERIFY-002',
        ['api-validation', 'official-rate-card-products-order'],
      );
      requireEvidenceTrue(
        request,
        findings,
        'evidence.rateCardRateReadBackReviewed',
        'evidence.rateCardRateReadBackReviewed must be true because rate-card product-order verification needs rateCards.getRates/getRateSchedule read-back planning.',
        'MTR-VERIFY-001',
        ['api-validation', 'metronome-pricing-catalog'],
      );
      for (const path of [
        'body.id',
        'body.name',
        'body.description',
        'body.aliases',
        'body.fiat_credit_type_id',
        'body.credit_type_conversions',
        'body.custom_fields',
        'body.rates',
        'body.rate',
        'body.add_rates',
        'body.addRates',
        'body.products',
        'body.product_id',
        'body.setProductOrder',
        'body.package_id',
        'body.package_alias',
        'body.contract_id',
        'body.customer_id',
        'body.starting_at',
        'body.price',
        'body.rate_type',
        'body.credit_type_id',
        'body.entitled',
        'body.billing_frequency',
      ]) {
        forbidPath(request, findings, path, 'rateCards.setProductOrder local validation supports only product-order placement; pricing, products, metadata, packages, and contracts need separate reviewed workflows.');
      }
      forbidPath(request, findings, 'body.path', 'Use endpoint id rateCards.setProductOrder and the reviewed /v1/contract-pricing/rate-cards/setRateCardProductsOrder path; do not include raw endpoint paths in request files.');
      forbidPath(request, findings, 'query.rate_card_id', 'rateCards.setProductOrder is a POST write; rate_card_id belongs in the JSON body.');
      forbidPath(request, findings, 'query.product_order', 'rateCards.setProductOrder is a POST write; product_order belongs in the JSON body.');
      forbidPath(request, findings, 'query.path', 'Use endpoint id rateCards.setProductOrder and the reviewed /v1/contract-pricing/rate-cards/setRateCardProductsOrder path; do not include raw endpoint paths in request files.');
      forbidPath(request, findings, 'path.rate_card_id', 'rateCards.setProductOrder is a POST write; rate_card_id belongs in the JSON body.');
      forbidPath(request, findings, 'path.product_order', 'rateCards.setProductOrder is a POST write; product_order belongs in the JSON body.');
      forbidPath(request, findings, 'path.path', 'Use endpoint id rateCards.setProductOrder and the reviewed /v1/contract-pricing/rate-cards/setRateCardProductsOrder path; do not include raw endpoint paths in request files.');
      forbidBodyKeysExcept(
        request,
        findings,
        [
          'rate_card_id',
          'product_order',
          'id',
          'name',
          'description',
          'aliases',
          'fiat_credit_type_id',
          'credit_type_conversions',
          'custom_fields',
          'rates',
          'rate',
          'add_rates',
          'addRates',
          'products',
          'product_id',
          'setProductOrder',
          'package_id',
          'package_alias',
          'contract_id',
          'customer_id',
          'starting_at',
          'price',
          'rate_type',
          'credit_type_id',
          'entitled',
          'billing_frequency',
          'path',
        ],
        'rateCards.setProductOrder body supports only body.rate_card_id and body.product_order[] in the local contract.',
      );
      forbidQueryKeysExcept(request, findings, ['rate_card_id', 'product_order', 'path'], 'rateCards.setProductOrder does not use query parameters in the reviewed local contract.');
      forbidPathKeysExcept(request, findings, ['rate_card_id', 'product_order', 'path'], 'rateCards.setProductOrder does not use path parameters in the reviewed local contract.');
    },
  },
  'rateCards.get': {
    checked: ['secret scan', 'official body id', 'stale rate_card_id refusal'],
    apply(request, findings) {
      requirePath(request, findings, 'body.id');
      requireSafeIdentifier(request, findings, 'body.id');
      forbidPath(request, findings, 'body.rate_card_id', 'rateCards.get uses the official body.id field; body.rate_card_id belongs to schedule reads, not metadata get.');
      forbidPath(request, findings, 'query.id', 'rateCards.get is a POST read; id belongs in the JSON body.');
      forbidPath(request, findings, 'query.rate_card_id', 'rateCards.get is a POST read; rate card identifiers belong in the JSON body.');
    },
  },
  'rateCards.list': {
    checked: ['secret scan', 'query pagination', 'empty body contract', 'body pagination forbidden'],
    apply(request, findings) {
      requirePath(request, findings, 'query.limit');
      forbidPath(request, findings, 'body.limit', 'rateCards.list pagination limit belongs in query.limit, not the POST body.');
      forbidPath(request, findings, 'body.next_page', 'rateCards.list pagination next_page belongs in query.next_page, not the POST body.');
      forbidPath(request, findings, 'body.id', 'rateCards.list uses an empty POST body; use rateCards.get for a single rate card.');
      forbidPath(request, findings, 'body.rate_card_id', 'rateCards.list uses an empty POST body; use rateCards.get or rateCards.getRateSchedule for rate-card-specific reads.');
      forbidBodyKeysExcept(request, findings, ['limit', 'next_page', 'id', 'rate_card_id'], 'rateCards.list uses an empty POST body; filters and pagination belong in reviewed query parameters or a different endpoint.');
    },
  },
  'rateCards.getRates': {
    checked: ['secret scan', 'rate card id', 'effective timestamp', 'query pagination', 'selector body filters', 'body pagination forbidden'],
    apply(request, findings) {
      requirePath(request, findings, 'body.rate_card_id');
      requirePath(request, findings, 'body.at');
      requirePath(request, findings, 'query.limit');
      requireSafeIdentifier(request, findings, 'body.rate_card_id');
      requireDateTime(request, findings, 'body.at');
      validateRateSelectors(request, findings, 'body.selectors');
      forbidPath(request, findings, 'query.rate_card_id', 'rateCards.getRates is a POST read; rate_card_id belongs in the JSON body.');
      forbidPath(request, findings, 'query.at', 'rateCards.getRates is a POST read; at belongs in the JSON body.');
      forbidPath(request, findings, 'query.product_id', 'rateCards.getRates selector filters belong in body.selectors[].product_id, not query.product_id.');
      forbidPath(request, findings, 'body.limit', 'rateCards.getRates pagination limit belongs in query.limit, not the POST body.');
      forbidPath(request, findings, 'body.next_page', 'rateCards.getRates pagination next_page belongs in query.next_page, not the POST body.');
      forbidBodyKeysExcept(request, findings, ['rate_card_id', 'at', 'selectors', 'limit', 'next_page'], 'rateCards.getRates body supports only rate_card_id, at, and selectors in the reviewed local contract.');
      forbidQueryKeysExcept(request, findings, ['limit', 'next_page', 'rate_card_id', 'at', 'product_id'], 'rateCards.getRates query supports only pagination in the reviewed local contract.');
    },
  },
  'rateCards.addRates': {
    checked: ['secret scan', 'rate card id', 'starting_at hour boundary', 'rates array'],
    apply(request, findings) {
      requirePath(request, findings, 'body.rate_card_id');
      requirePath(request, findings, 'body.starting_at');
      requireArray(request, findings, 'body.rates');
      requireSafeIdentifier(request, findings, 'body.rate_card_id');
      requireHourBoundary(request, findings, 'body.starting_at');
    },
  },
  'rateCards.getRateSchedule': {
    checked: ['secret scan', 'rate card id'],
    apply(request, findings) {
      requirePath(request, findings, 'body.rate_card_id');
      requireSafeIdentifier(request, findings, 'body.rate_card_id');
    },
  },
};

function apiRequestValidationCoverage() {
  return listApiEndpoints().reduce((coverage, endpoint) => {
    const definition = VALIDATION_DEFINITIONS[endpoint.id];
    coverage[endpoint.id] = {
      schemaVersion: API_VALIDATION_SCHEMA_VERSION,
      supportStatus: definition ? 'endpoint-specific' : 'not-implemented',
      command: `metro api validate ${endpoint.id} --file <request.json|yaml> [--json]`,
      apiAccess: 'none',
      checked: definition ? [...definition.checked] : [],
    };
    return coverage;
  }, {});
}

function validateApiEndpointRequest(endpointId, input) {
  const endpoint = getApiEndpoint(endpointId);
  if (!endpoint) return null;

  const definition = VALIDATION_DEFINITIONS[endpoint.id];
  const request = normalizeRequestInput(input, endpoint);
  const findings = [];

  if (request.envelopeMode === 'invalid') {
    add(findings, 'MTR-APIREQ-001', 'API request validation input must be a JSON object.', '$', ['api-validation']);
  }

  scanForSecrets(input, findings);

  if (!endpoint.sourceIds || !endpoint.sourceIds.includes('endpoint-matrix')) {
    add(findings, 'MTR-ENDPOINT-001', 'Endpoint record must cite endpoint-matrix before request validation can pass.', 'endpoint.sourceIds', ['api-validation']);
  }
  if (!endpoint.permissionScope) {
    add(findings, 'MTR-ENDPOINT-001', 'Endpoint record must declare a permission scope before request validation can pass.', 'endpoint.permissionScope', ['api-validation']);
  }

  if (!definition) {
    add(findings, 'MTR-APIREQ-004', `No endpoint-specific request validator is implemented for ${endpoint.id}.`, 'endpoint.id', ['api-validation']);
  } else {
    definition.apply(request, findings, endpoint);
  }

  const valid = !findings.some((finding) => finding.severity === 'error');
  return {
    schemaVersion: API_VALIDATION_SCHEMA_VERSION,
    generatedFrom: 'packages/metro-core/src/api-catalog/validation.js',
    apiAccess: 'none',
    liveExecution: clone(endpoint.liveExecution),
    endpoint: {
      id: endpoint.id,
      method: endpoint.method,
      path: endpoint.path,
      family: endpoint.family,
      operationType: endpoint.operationType,
      supportStatus: endpoint.supportStatus,
      permissionScope: endpoint.permissionScope,
      sourceIds: clone(endpoint.sourceIds),
    },
    requestContract: clone(endpoint.requestContract),
    validation: {
      supportStatus: definition ? 'endpoint-specific' : 'not-implemented',
      envelopeMode: request.envelopeMode,
      checked: definition ? [...definition.checked] : ['secret scan', 'endpoint source evidence', 'permission scope'],
    },
    valid,
    findings,
    nextSafeStep: valid
      ? 'Use this validation result as local preflight evidence; run metro api preview <endpoint-id> --file <request.json|yaml> (--sandbox|--prod) to build a local preview hash. Live expert API read/apply execution remains disabled in the current CLI.'
      : 'Fix the request file and re-run metro api validate before using this endpoint in any future expert API preview.',
  };
}

module.exports = {
  API_VALIDATION_SCHEMA_VERSION,
  apiRequestValidationCoverage,
  normalizeRequestInput,
  validateApiEndpointRequest,
};
