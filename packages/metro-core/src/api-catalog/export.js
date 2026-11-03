'use strict';

const { commandReference } = require('../commands/catalog');
const { apiReference } = require('../docs/api-reference');
const { gotchaReference } = require('../docs/gotcha-reference');
const { shapeReference, validatorReference } = require('../docs/shape-validator-reference');

const API_EXPORT_SCHEMA_VERSION = 'metro.api.export.v1';

const API_EXAMPLE_FIXTURES = [
  {
    id: 'api.catalog.contracts',
    command: 'metro api catalog --family contracts --json',
    covers: ['reviewed endpoint IDs', 'method/path metadata', 'source IDs', 'disabled live execution'],
  },
  {
    id: 'api.explain.contracts-create',
    command: 'metro api explain contracts.create --json',
    covers: ['endpoint contract explanation', 'request and response contracts', 'policy gates'],
  },
  {
    id: 'api.search.contract-create',
    command: 'metro api search contract create --json',
    covers: ['local endpoint search', 'matched fields', 'source-linked results'],
  },
  {
    id: 'api.diff.contracts-create-vs-update-end-date',
    command: 'metro api diff contracts.create contracts.updateEndDate --json',
    covers: ['endpoint contract comparison', 'shared policy gates', 'source ID differences'],
  },
  {
    id: 'api.approvals',
    command: 'metro api approvals --json',
    covers: ['permission-scope approval policies', 'evidence requirements', 'disabled live execution'],
  },
  {
    id: 'api.readiness',
    command: 'metro api readiness --summary --json',
    covers: ['read endpoint readiness', 'validator coverage', 'read-plan golden coverage', 'read-pipeline golden coverage'],
  },
  {
    id: 'api.preview.contracts-create',
    command: 'metro api preview contracts.create --file <api-contracts-create-valid.json> --sandbox --json',
    covers: ['local expert API preview', 'payload hash', 'apply disabled state'],
  },
  {
    id: 'api.preflight.contracts-create',
    command: 'metro api preflight template --preview <preview.json> --json',
    covers: ['local expert API preflight evidence template', 'preview binding', 'apply disabled state'],
  },
];

function selectApiExampleFixtures(family) {
  if (!family) return API_EXAMPLE_FIXTURES;
  return API_EXAMPLE_FIXTURES.filter((fixture) => (
    fixture.id.includes(family)
    || fixture.command.includes(`--family ${family}`)
    || fixture.command.includes(`${family}.`)
  ));
}

function buildApiExportBundle(options = {}) {
  const family = options.family || null;
  const apiDocs = apiReference({ family });
  if (family && apiDocs.endpointCount === 0) return null;

  const commandDocs = commandReference();
  const shapeDocs = shapeReference();
  const validatorDocs = validatorReference();
  const gotchaDocs = gotchaReference();
  const examples = selectApiExampleFixtures(family);

  return {
    schemaVersion: API_EXPORT_SCHEMA_VERSION,
    generatedFrom: [
      'packages/metro-core/src/api-catalog/export.js',
      'packages/metro-core/src/docs/api-reference.js',
      'packages/metro-core/src/api-catalog/apply-result.js',
      'packages/metro-core/src/commands/catalog.js',
      'packages/metro-core/src/docs/shape-validator-reference.js',
      'packages/metro-core/src/docs/gotcha-reference.js',
    ],
    apiAccess: 'none',
    liveExecution: apiDocs.liveExecution,
    filters: {
      family,
    },
    summary: {
      endpointCount: apiDocs.endpointCount,
      familyCount: apiDocs.families.length,
      commandCount: commandDocs.commands.length,
      unsupportedCommandCount: commandDocs.unsupportedCommands.length,
      shapeCount: shapeDocs.shapes.length,
      validatorRuleCount: validatorDocs.rules.length,
      gotchaCount: gotchaDocs.gotchas.length,
      approvalPolicyCount: apiDocs.approvalPolicies.policyCount,
      exampleCount: examples.length,
    },
    sections: {
      apiReference: apiDocs,
      commandReference: commandDocs,
      shapeReference: shapeDocs,
      validatorReference: validatorDocs,
      gotchaReference: gotchaDocs,
      examples: {
        schemaVersion: 'metro.api.export.examples.v1',
        generatedFrom: 'packages/metro-core/src/api-catalog/export.js',
        fixtures: examples,
      },
    },
    nextSafeStep: 'Use this local export bundle as source-linked documentation input for agents, CI, or review. It does not authorize live reads or writes.',
  };
}

module.exports = {
  API_EXPORT_SCHEMA_VERSION,
  buildApiExportBundle,
};
