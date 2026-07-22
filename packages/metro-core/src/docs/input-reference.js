'use strict';

const {
  STRUCTURED_INPUT_FORMAT_LABEL,
  SUPPORTED_STRUCTURED_INPUT_FORMATS,
} = require('../input/files');
const { INPUT_NORMALIZE_SCHEMA_VERSION } = require('../input/normalize');

const INPUT_REFERENCE_SECTION_NAVIGATION = [
  {
    id: 'input-summary',
    href: '#input-summary',
    label: 'Input summary',
    description: 'Generated counts for supported adapters, modes, output contracts, and local API access.',
  },
  {
    id: 'supported-formats',
    href: '#supported-formats',
    label: 'Supported formats',
    description: 'The structured input adapters currently accepted by local workflow and expert API commands.',
  },
  {
    id: 'normalization-contract',
    href: '#normalization-contract',
    label: 'Normalization contract',
    description: 'Stable fields emitted by metro.input.normalize.v1 and how automation should consume them.',
  },
  {
    id: 'secret-scan',
    href: '#secret-scan',
    label: 'Secret scan',
    description: 'Local redaction behavior for secret-shaped keys and values before normalized input is echoed.',
  },
];

const OUTPUT_FIELDS = [
  {
    name: 'schemaVersion',
    type: 'string',
    required: true,
    description: `Always ${INPUT_NORMALIZE_SCHEMA_VERSION}.`,
  },
  {
    name: 'mode',
    type: 'shape|api-request',
    required: true,
    description: 'Selects workflow shape normalization or reviewed expert API request-envelope normalization.',
  },
  {
    name: 'apiAccess',
    type: 'string',
    required: true,
    description: 'Always none for this command family.',
  },
  {
    name: 'liveExecution.enabledInCurrentCli',
    type: 'boolean',
    required: true,
    description: 'Always false; normalization does not load API clients.',
  },
  {
    name: 'input.format',
    type: 'json|yaml|unknown',
    required: true,
    description: 'Derived from the input file extension used by the structured input loader.',
  },
  {
    name: 'input.filePath',
    type: 'string|null',
    required: true,
    description: 'Rendered relative to the command working directory for portable golden fixtures.',
  },
  {
    name: 'target',
    type: 'object',
    required: true,
    description: 'Contains either shape metadata or reviewed API endpoint metadata and source IDs.',
  },
  {
    name: 'normalization.canonicalization',
    type: 'string',
    required: false,
    description: 'States the sorted-key JSON canonicalization rule when the target is known.',
  },
  {
    name: 'normalizedInput',
    type: 'object|null',
    required: true,
    description: 'Canonical object used for stable JSON and hash generation, unless redaction suppresses it.',
  },
  {
    name: 'normalizedJson',
    type: 'string|null',
    required: true,
    description: 'Stable JSON serialization that parses back to normalizedInput when redaction is false.',
  },
  {
    name: 'normalizedHash',
    type: 'sha256 string|null',
    required: true,
    description: 'Deterministic hash of normalizedInput, suppressed when secret-shaped input is detected.',
  },
  {
    name: 'redaction.normalizedInputSuppressed',
    type: 'boolean',
    required: true,
    description: 'True when secret-shaped input prevented canonical input and hash echoing.',
  },
  {
    name: 'validation',
    type: 'object|null',
    required: true,
    description: 'Shape validator or expert endpoint request validator output for the normalized target.',
  },
  {
    name: 'secretScan',
    type: 'object',
    required: true,
    description: 'Local secret-shaped key/value findings that block normalized echo output.',
  },
  {
    name: 'valid',
    type: 'boolean',
    required: true,
    description: 'True only when validation passes and the secret scan is clear.',
  },
  {
    name: 'findings',
    type: 'array',
    required: true,
    description: 'Combined secret-scan and validation findings for CI and agents.',
  },
  {
    name: 'nextSafeStep',
    type: 'string',
    required: true,
    description: 'Human-readable local next step; it is not live-operation authorization.',
  },
];

function inputReference() {
  return {
    schemaVersion: 'metro.docs.input-reference.v1',
    generatedFrom: 'metronome-cli/src/docs/input-reference.js',
    loaderGeneratedFrom: 'metronome-cli/src/input/files.js',
    normalizerGeneratedFrom: 'metronome-cli/src/input/normalize.js',
    shapeValidationGeneratedFrom: 'metronome-cli/src/validators/index.js',
    apiValidationGeneratedFrom: 'metronome-cli/src/api-catalog/validation.js',
    apiAccess: 'none',
    liveExecution: {
      enabledInCurrentCli: false,
      reason: 'Input loading, normalization, validation, and docs reference generation are local-only.',
    },
    sectionNavigation: INPUT_REFERENCE_SECTION_NAVIGATION.map((section) => ({ ...section })),
    summary: {
      structuredInputFormatLabel: STRUCTURED_INPUT_FORMAT_LABEL,
      supportedExtensionCount: SUPPORTED_STRUCTURED_INPUT_FORMATS.length,
      normalizationModes: ['shape', 'api-request'],
      outputSchemaVersion: INPUT_NORMALIZE_SCHEMA_VERSION,
      liveApiAccess: 'none',
    },
    supportedFormats: [
      {
        id: 'json',
        extensions: ['.json'],
        parser: 'JSON.parse',
        status: 'supported',
        roundTripOutput: 'stable-json',
        notes: [
          'JSON is the canonical machine output contract.',
          'Input object keys are sorted during canonicalization before hashing.',
        ],
      },
      {
        id: 'yaml',
        extensions: ['.yaml', '.yml'],
        parser: 'metronome-cli/src/input/files.js parseSimpleYaml',
        status: 'supported-subset',
        roundTripOutput: 'stable-json',
        notes: [
          'The local YAML adapter supports the reviewed fixture subset: mappings, sequences, scalars, and JSON-style inline flow values.',
          'Advanced YAML features such as anchors, tags, and multi-document streams are intentionally unsupported until a reviewed input contract needs them.',
        ],
      },
    ],
    normalizationModes: [
      {
        id: 'shape',
        command: 'metro input normalize --shape <shape> --file <input.json|yaml> [--json]',
        targetType: 'Workflow shape',
        validator: 'validateShapeInput',
        normalizedValue: 'The original structured input canonicalized with sorted object keys.',
        nextLocalEvidence: 'metro validate --shape <shape> --file <input.json|yaml> --json',
        sources: [
          'docs/metronome-cli/one-goal.md',
          'docs/metronome-cli/SHAPE_CATALOG.md',
          'metronome-cli/src/input/normalize.js',
          'metronome-cli/src/validators/index.js',
        ],
      },
      {
        id: 'api-request',
        command: 'metro input normalize --api <endpoint-id> --file <input.json|yaml> [--json]',
        targetType: 'Reviewed expert API endpoint ID',
        validator: 'validateApiEndpointRequest',
        normalizedValue: 'The endpoint request envelope with body, query, path, evidence, and metadata keys canonicalized.',
        nextLocalEvidence: 'metro api validate <endpoint-id> --file <request.json|yaml> --json',
        sources: [
          'docs/metronome-cli/one-goal.md',
          'docs/metronome-cli/CLI_ARCHITECTURE.md',
          'metronome-cli/src/input/normalize.js',
          'metronome-cli/src/api-catalog/validation.js',
        ],
      },
    ],
    outputContract: {
      schemaVersion: INPUT_NORMALIZE_SCHEMA_VERSION,
      roundTripGuarantee: 'When redaction.normalizedInputSuppressed is false, JSON.parse(normalizedJson) deep-equals normalizedInput.',
      hashGuarantee: 'normalizedHash is a sha256 hash of normalizedInput after sorted-key canonicalization.',
      secretBoundary: 'When secret-shaped keys or values are detected, normalizedInput, normalizedJson, and normalizedHash are null.',
      outputFields: OUTPUT_FIELDS.map((field) => ({ ...field })),
    },
    secretScan: {
      status: 'blocking-redaction',
      ruleIds: ['MTR-SECRET-001', 'MTR-SECRET-002'],
      blockedOutputFields: ['normalizedInput', 'normalizedJson', 'normalizedHash'],
      allowedSecretReferences: [
        'Tenant profile names',
        'Environment variable names',
        'Reviewed non-secret key fingerprints',
        'Opaque file hashes',
      ],
      forbiddenExamples: [
        'apiKey',
        'authorization',
        'Bearer <token>',
        'sk_live_...',
        'password',
      ],
    },
    proofCommands: [
      'node metronome-cli/bin/metro.js input normalize --shape pro-annual --file metronome-cli/test/fixtures/pro-annual-valid.yaml --json',
      'node metronome-cli/bin/metro.js input normalize --api contracts.create --file metronome-cli/test/fixtures/api-contracts-create-valid.yaml --json',
      'npm --prefix metronome-cli run test:golden',
      'node docs/metronome-cli/site/verify-site.js',
    ],
    sources: [
      'docs/metronome-cli/one-goal.md',
      'docs/metronome-cli/CLI_ARCHITECTURE.md',
      'docs/metronome-cli/VALIDATION_AND_GUARDRAILS.md',
      'metronome-cli/src/input/files.js',
      'metronome-cli/src/input/normalize.js',
      'metronome-cli/src/api-catalog/validation.js',
      'metronome-cli/test/golden/input/normalize.pro-annual-yaml.json',
      'metronome-cli/test/golden/input/normalize.api-contracts-create-yaml.json',
    ],
  };
}

module.exports = {
  inputReference,
};
