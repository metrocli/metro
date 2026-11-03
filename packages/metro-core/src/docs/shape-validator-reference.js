'use strict';

const { SHAPES } = require('../shapes');
const { RULES } = require('../validators/rules');

const SHAPE_REFERENCE_SECTION_NAVIGATION = [
  {
    id: 'shape-summary',
    href: '#shape-summary',
    label: 'Shape summary',
    description: 'Generated counts for workflow shapes, families, maturity levels, and local API access.',
  },
  {
    id: 'shape-catalog',
    href: '#shape-catalog',
    label: 'Shape catalog',
    description: 'Workflow shapes with required input, supported modes, blocked modes, validators, and sources.',
  },
];

const VALIDATOR_REFERENCE_SECTION_NAVIGATION = [
  {
    id: 'validator-summary',
    href: '#validator-summary',
    label: 'Validator summary',
    description: 'Generated counts for executable rules, severities, shape mappings, and local API access.',
  },
  {
    id: 'validator-rules',
    href: '#validator-rules',
    label: 'Validator rules',
    description: 'Executable guardrail rules with severity, remediation, and the shapes that reference each rule.',
  },
];

function cloneShape(shape) {
  return {
    ...shape,
    supportedModes: [...shape.supportedModes],
    requiredInput: [...shape.requiredInput],
    validatorRuleIds: [...shape.validatorRuleIds],
    sources: [...shape.sources],
    blockedModes: { ...(shape.blockedModes || {}) },
  };
}

function rulesById() {
  return Object.fromEntries(Object.entries(RULES).map(([id, rule]) => [id, { id, ...rule }]));
}

function shapeIdsByRuleId(shapes = SHAPES) {
  const index = {};
  for (const shape of shapes) {
    for (const ruleId of shape.validatorRuleIds) {
      if (!index[ruleId]) index[ruleId] = [];
      index[ruleId].push(shape.id);
    }
  }
  return Object.fromEntries(Object.entries(index).map(([ruleId, ids]) => [ruleId, ids.sort()]));
}

function shapeReference() {
  const shapes = SHAPES.map(cloneShape);
  return {
    schemaVersion: 'metro.docs.shape-reference.v1',
    generatedFrom: 'packages/metro-core/src/shapes/index.js',
    rulesGeneratedFrom: 'packages/metro-core/src/validators/rules.js',
    sectionNavigation: SHAPE_REFERENCE_SECTION_NAVIGATION.map((section) => ({ ...section })),
    shapes,
    rulesById: rulesById(),
  };
}

function validatorReference() {
  const shapes = SHAPES.map(cloneShape);
  const byRule = shapeIdsByRuleId(shapes);
  return {
    schemaVersion: 'metro.docs.validator-reference.v1',
    generatedFrom: 'packages/metro-core/src/validators/rules.js',
    shapesGeneratedFrom: 'packages/metro-core/src/shapes/index.js',
    sectionNavigation: VALIDATOR_REFERENCE_SECTION_NAVIGATION.map((section) => ({ ...section })),
    rules: Object.entries(RULES).map(([id, rule]) => ({ id, ...rule })),
    shapeIdsByRuleId: byRule,
  };
}

module.exports = {
  shapeReference,
  validatorReference,
};
