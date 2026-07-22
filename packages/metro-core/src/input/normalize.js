'use strict';

const path = require('path');
const { getApiEndpoint } = require('../api-catalog');
const { normalizeRequestInput, validateApiEndpointRequest } = require('../api-catalog/validation');
const { canonicalJson, canonicalize, sha256 } = require('../preview');
const { getShape } = require('../shapes');
const { validateShapeInput } = require('../validators');

const INPUT_NORMALIZE_SCHEMA_VERSION = 'metro.input.normalize.v1';
const LOCAL_ONLY_LIVE_EXECUTION = {
  enabledInCurrentCli: false,
  reason: 'Input normalization is local-only and does not load API clients.',
};
const SECRET_KEY_PATTERN = /(secret|token|api[_-]?key|authorization|bearer|password|private[_-]?key)/i;
const SECRET_VALUE_PATTERN = /(sk_live_|sk_test_|pk_live_|prod_[A-Za-z0-9]{12,}|Bearer\s+[A-Za-z0-9._-]+)/;

function inputFormat(file) {
  const ext = path.extname(String(file || '')).toLowerCase();
  if (ext === '.yaml' || ext === '.yml') return 'yaml';
  if (ext === '.json') return 'json';
  return 'unknown';
}

function displayFilePath(filePath, rootDir = process.cwd()) {
  if (!filePath) return null;
  return path.relative(rootDir, path.resolve(filePath)) || path.basename(filePath);
}

function finding(id, severity, message, remediation, pathValue) {
  return {
    id,
    severity,
    message,
    remediation,
    ...(pathValue ? { path: pathValue } : {}),
  };
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function collectSecretFindings(value, pathValue = '$') {
  const findings = [];

  if (typeof value === 'string') {
    if (SECRET_VALUE_PATTERN.test(value)) {
      findings.push(finding(
        'MTR-SECRET-002',
        'error',
        `Input contains a secret-like value at ${pathValue}.`,
        'Remove raw keys, bearer tokens, passwords, and provider secrets before normalizing input.',
        pathValue,
      ));
    }
    return findings;
  }

  if (!isObject(value)) return findings;

  for (const [key, nested] of Object.entries(value)) {
    const nestedPath = `${pathValue}.${key}`;
    if (SECRET_KEY_PATTERN.test(key) && key !== 'keyFingerprint') {
      findings.push(finding(
        'MTR-SECRET-001',
        'error',
        `Input contains forbidden secret-shaped field ${nestedPath}.`,
        'Reference tenant profiles, environment variable names, hashes, or non-secret fingerprints instead of raw secret fields.',
        nestedPath,
      ));
    }
    findings.push(...collectSecretFindings(nested, nestedPath));
  }

  return findings;
}

function stableObject(value, secretFindings) {
  if (secretFindings.length > 0) {
    return {
      normalizedInput: null,
      normalizedJson: null,
      normalizedHash: null,
      redaction: {
        normalizedInputSuppressed: true,
        reason: 'Secret-shaped keys or values were detected; canonical input is not echoed.',
      },
    };
  }

  const normalizedInput = canonicalize(value);
  return {
    normalizedInput,
    normalizedJson: canonicalJson(normalizedInput),
    normalizedHash: sha256(normalizedInput),
    redaction: {
      normalizedInputSuppressed: false,
    },
  };
}

function buildShapeInputNormalization(shapeId, input, options = {}) {
  const shape = getShape(shapeId);
  const validation = validateShapeInput(shapeId, input, options);
  const secretFindings = collectSecretFindings(input);
  const stable = stableObject(input, secretFindings);
  const valid = validation.valid && secretFindings.length === 0;

  return {
    schemaVersion: INPUT_NORMALIZE_SCHEMA_VERSION,
    generatedFrom: 'metronome-cli/src/input/normalize.js',
    mode: 'shape',
    apiAccess: 'none',
    liveExecution: { ...LOCAL_ONLY_LIVE_EXECUTION },
    input: {
      format: inputFormat(options.filePath),
      filePath: displayFilePath(options.filePath, options.rootDir),
    },
    target: {
      type: 'shape',
      id: shapeId,
      known: Boolean(shape),
      sources: shape ? [...shape.sources] : [],
    },
    normalization: {
      canonicalization: 'sorted-json-object-keys',
      roundTripContract: 'normalizedJson parses back to normalizedInput when redaction.normalizedInputSuppressed is false',
    },
    ...stable,
    validation,
    secretScan: {
      blocked: secretFindings.length > 0,
      findings: secretFindings,
    },
    valid,
    findings: [...secretFindings, ...(validation.findings || [])],
    nextSafeStep: valid
      ? `Use metro ${shapeId === 'pro-annual' ? 'package preview --shape pro-annual' : 'validate --shape ' + shapeId} --file <input.json|yaml> with explicit local-only or tenant flags as the next reviewed step.`
      : 'Fix validation and secret-scan findings before using this input for preview, evidence, or any future apply path.',
  };
}

function summarizeApiRequest(request) {
  return {
    envelopeMode: request.envelopeMode,
    bodyKeys: Object.keys(request.body).sort(),
    queryKeys: Object.keys(request.query).sort(),
    pathKeys: Object.keys(request.path).sort(),
    evidenceKeys: Object.keys(request.evidence).sort(),
    metadataKeys: Object.keys(request.metadata).sort(),
  };
}

function buildApiInputNormalization(endpointId, input, options = {}) {
  const endpoint = getApiEndpoint(endpointId);
  if (!endpoint) {
    return {
      schemaVersion: INPUT_NORMALIZE_SCHEMA_VERSION,
      generatedFrom: 'metronome-cli/src/input/normalize.js',
      mode: 'api-request',
      apiAccess: 'none',
      liveExecution: { ...LOCAL_ONLY_LIVE_EXECUTION },
      input: {
        format: inputFormat(options.filePath),
        filePath: displayFilePath(options.filePath, options.rootDir),
      },
      target: {
        type: 'api-endpoint',
        id: endpointId,
        known: false,
      },
      normalizedInput: null,
      normalizedJson: null,
      normalizedHash: null,
      redaction: {
        normalizedInputSuppressed: false,
      },
      validation: null,
      secretScan: {
        blocked: false,
        findings: [],
      },
      valid: false,
      findings: [finding(
        'MTR-APIREQ-004',
        'error',
        `Unknown API endpoint: ${endpointId}`,
        'Run metro api catalog --json or metro api search <query> --json to select a reviewed endpoint id.',
        'endpoint.id',
      )],
      nextSafeStep: 'Choose a reviewed endpoint ID from metro api catalog before normalizing expert API input.',
    };
  }

  const request = normalizeRequestInput(input, endpoint);
  const validation = validateApiEndpointRequest(endpointId, input);
  const secretFindings = collectSecretFindings(input);
  const stable = stableObject(request, secretFindings);
  const valid = Boolean(validation?.valid) && secretFindings.length === 0;

  return {
    schemaVersion: INPUT_NORMALIZE_SCHEMA_VERSION,
    generatedFrom: 'metronome-cli/src/input/normalize.js',
    mode: 'api-request',
    apiAccess: 'none',
    liveExecution: { ...LOCAL_ONLY_LIVE_EXECUTION },
    input: {
      format: inputFormat(options.filePath),
      filePath: displayFilePath(options.filePath, options.rootDir),
    },
    target: {
      type: 'api-endpoint',
      id: endpoint.id,
      known: true,
      method: endpoint.method,
      path: endpoint.path,
      family: endpoint.family,
      operationType: endpoint.operationType,
      supportStatus: endpoint.supportStatus,
      permissionScope: endpoint.permissionScope,
      sourceIds: [...endpoint.sourceIds],
    },
    normalization: {
      canonicalization: 'sorted-json-object-keys',
      roundTripContract: 'normalizedJson parses back to normalizedInput when redaction.normalizedInputSuppressed is false',
      requestSummary: summarizeApiRequest(request),
    },
    ...stable,
    validation,
    secretScan: {
      blocked: secretFindings.length > 0,
      findings: secretFindings,
    },
    valid,
    findings: [...secretFindings, ...(validation?.findings || [])],
    nextSafeStep: valid
      ? `Use metro api validate ${endpoint.id} --file <request.json|yaml> --json or metro api preview ${endpoint.id} --file <request.json|yaml> (--sandbox|--prod) --json as the next local evidence step.`
      : 'Fix validation and secret-scan findings before using this endpoint request for preview, read-plan, evidence, or any future apply path.',
  };
}

function buildInputNormalization(options) {
  if (options.shape) {
    return buildShapeInputNormalization(options.shape, options.input, options);
  }
  return buildApiInputNormalization(options.endpointId, options.input, options);
}

module.exports = {
  INPUT_NORMALIZE_SCHEMA_VERSION,
  buildApiInputNormalization,
  buildInputNormalization,
  buildShapeInputNormalization,
  collectSecretFindings,
  displayFilePath,
  inputFormat,
};
