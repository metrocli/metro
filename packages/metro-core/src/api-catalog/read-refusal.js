'use strict';

const { getApiEndpoint } = require('./index');
const { buildApiEndpointReadPlan } = require('./read-plan');
const { validateApiReadGate } = require('./read-gate');
const { LIVE_READ_CONFIRMATION } = require('../clients/metronome-read');
const { isLiveReadEndpoint } = require('../clients/live-endpoints');
const { resolveKeyFromEnv } = require('../clients/tenant-keys');
const { buildApiReadRefusalPayload } = require('../output/refusal');

const API_READ_REFUSAL_SCHEMA_VERSION = 'metro.api.read.refusal.v1';

const LOCAL_ONLY_LIVE_EXECUTION = {
  enabledInCurrentCli: false,
  reason: 'Expert API live reads are refused in the current CLI; this command only evaluates local request, tenant, read-gate, and authorization evidence.',
  nextSafeStep: 'Use the local read-plan, read-gate, read-mock, read-result, and read-audit commands as proof.',
};

const LIVE_EXECUTION_ENABLED = {
  enabledInCurrentCli: true,
  reason: 'Guarded live read is enabled for reviewed endpoints when read-gate evidence, current-turn authorization, and tenant key configuration are satisfied.',
  nextSafeStep: 'Use metro api read with --json and store stdout as evidence. Human progress stays on stderr.',
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function endpointSnapshot(endpoint) {
  if (!endpoint) return null;
  return {
    id: endpoint.id,
    method: endpoint.method,
    path: endpoint.path,
    family: endpoint.family,
    operationType: endpoint.operationType,
    supportStatus: endpoint.supportStatus,
    permissionScope: endpoint.permissionScope,
    sourceIds: clone(endpoint.sourceIds),
  };
}

function addBlocker(blockers, id, message, nextSafeStep) {
  blockers.push({ id, message, nextSafeStep });
}

function summarizeReadPlan(readPlan) {
  if (!readPlan) return null;
  return {
    schemaVersion: readPlan.schemaVersion,
    blocked: readPlan.blocked === true,
    blockReason: readPlan.blockReason || null,
    requestHash: readPlan.requestSummary?.requestHash || null,
    validationValid: readPlan.validation?.valid === true,
    liveReadSupported: readPlan.liveReadSupported === true,
    liveExecutionEnabled: readPlan.liveExecution?.enabledInCurrentCli === true,
    requiredLiveReadGate: readPlan.requiredLiveReadGate
      ? {
          status: readPlan.requiredLiveReadGate.status || null,
          confirmLiveReadRequired: readPlan.requiredLiveReadGate.confirmLiveReadToken?.required === true,
          tokenScope: readPlan.requiredLiveReadGate.confirmLiveReadToken?.tokenScope || null,
        }
      : null,
  };
}

function summarizeReadGateValidation(validation) {
  if (!validation) return null;
  return {
    schemaVersion: validation.schemaVersion,
    valid: validation.valid === true,
    summary: clone(validation.summary || {}),
    findingCount: Array.isArray(validation.findings) ? validation.findings.length : 0,
    findings: clone(validation.findings || []),
  };
}

function evaluateApiReadGates(options = {}) {
  const {
    endpointId,
    tenant = null,
    tenantFlags = {},
    requestInput = null,
    requestLoadError = null,
    requestFileProvided = false,
    readGate = null,
    readGateLoadError = null,
    readGateFileProvided = false,
    readGateRootDir = process.cwd(),
    confirmLiveRead = null,
  } = options;

  const endpoint = getApiEndpoint(endpointId);
  const blockers = [];
  const tenantValid = ['sandbox', 'production'].includes(tenant);
  const confirmationProvided = typeof confirmLiveRead === 'string' && confirmLiveRead.length > 0;
  const confirmationMatchesGuard = confirmLiveRead === LIVE_READ_CONFIRMATION;
  const liveEndpointSupported = isLiveReadEndpoint(endpointId);

  if (!endpointId) {
    addBlocker(blockers, 'endpoint-id-required', 'metro api read requires a reviewed endpoint ID.', 'Run metro api catalog --json.');
  } else if (!endpoint) {
    addBlocker(blockers, 'reviewed-endpoint-required', `Unknown reviewed endpoint ID: ${endpointId}.`, 'Run metro api explain <endpoint-id> --json.');
  } else if (endpoint.operationType !== 'read') {
    addBlocker(blockers, 'read-endpoint-required', `${endpoint.id} is ${endpoint.operationType}; metro api read only accepts read endpoints.`, 'Use metro api preview for write endpoints.');
  } else if (!liveEndpointSupported) {
    addBlocker(
      blockers,
      'live-read-endpoint-not-enabled',
      `${endpoint.id} is not enabled for live read in the current CLI release.`,
      'Use metro api read-mock or metro api read-pipeline for local proof on this endpoint.',
    );
  }

  if (tenantFlags.sandbox && tenantFlags.prod) {
    addBlocker(blockers, 'single-explicit-tenant-required', 'Choose exactly one tenant: --sandbox or --prod.', 'Re-run with one tenant flag.');
  } else if (!tenantValid) {
    addBlocker(blockers, 'explicit-tenant-required', 'metro api read requires --sandbox or --prod.', 'Never infer tenant from available keys.');
  }

  if (!requestFileProvided) {
    addBlocker(blockers, 'request-json-required', 'metro api read requires --file <request.json|yaml>.', 'Run metro api read-plan first.');
  }
  if (requestLoadError) {
    addBlocker(blockers, 'request-json-readable', `Failed to read request file: ${requestLoadError}`, 'Use readable JSON/YAML with no secrets.');
  }

  let readPlan = null;
  if (endpoint && endpoint.operationType === 'read' && tenantValid && requestInput) {
    readPlan = buildApiEndpointReadPlan(endpoint.id, requestInput, { tenant });
    if (!readPlan || readPlan.blocked) {
      addBlocker(
        blockers,
        'valid-read-plan-required',
        readPlan?.blockReason || 'The request does not produce a valid local read plan.',
        'Fix the request and re-run metro api read-plan --json.',
      );
    }
  }

  let readGateValidation = null;
  if (!readGateFileProvided) {
    addBlocker(blockers, 'reviewed-read-gate-required', 'metro api read requires --read-gate <api-read-gate.json>.', 'Run metro api read-gate template --read-plan <plan.json> --json.');
  }
  if (readGateLoadError) {
    addBlocker(blockers, 'read-gate-json-readable', `Failed to read read-gate file: ${readGateLoadError}`, 'Validate the gate with metro api read-gate validate.');
  } else if (readGate) {
    readGateValidation = validateApiReadGate(readGate, { rootDir: readGateRootDir });
    if (!readGateValidation.valid) {
      addBlocker(blockers, 'valid-read-gate-required', 'The read gate did not pass local validation.', 'Run metro api read-gate validate --file <gate.json> --json.');
    }
    if (readPlan?.requestSummary?.requestHash && readGateValidation.summary?.requestHash
      && readPlan.requestSummary.requestHash !== readGateValidation.summary.requestHash) {
      addBlocker(blockers, 'read-gate-request-hash-mismatch', 'Request hash does not match the reviewed read gate.', 'Use the exact request file bound to the gate.');
    }
    if (tenantValid && readGateValidation.summary?.tenant && tenant !== readGateValidation.summary.tenant) {
      addBlocker(blockers, 'read-gate-tenant-mismatch', 'Tenant does not match the reviewed read gate.', 'Regenerate the gate for the same tenant.');
    }
  }

  if (!confirmationProvided) {
    addBlocker(blockers, 'confirm-live-read-required', 'Live read requires --confirm-live-read with the guarded phrase.', `Use --confirm-live-read ${LIVE_READ_CONFIRMATION} only when this turn authorizes the read.`);
  } else if (!confirmationMatchesGuard) {
    addBlocker(blockers, 'confirm-live-read-token-mismatch', 'The confirm-live-read token does not match the required phrase.', `Use exactly: ${LIVE_READ_CONFIRMATION}`);
  }

  let keyResolution = null;
  if (blockers.length === 0 && readGate?.tenantProfile?.keyEnv) {
    keyResolution = resolveKeyFromEnv(readGate.tenantProfile.keyEnv);
    if (!keyResolution.configured) {
      addBlocker(
        blockers,
        'metronome-key-not-configured',
        keyResolution.reason,
        `Export ${readGate.tenantProfile.keyEnv} in your shell, then retry.`,
      );
    }
  }

  const ready = blockers.length === 0;

  return {
    ready,
    endpoint,
    tenant,
    readPlan,
    readGateValidation,
    keyResolution,
    blockers,
    authorization: {
      confirmLiveReadProvided: confirmationProvided,
      confirmLiveReadTokenMatchesGuard: confirmationMatchesGuard,
      currentTurnAuthorizationAcceptedByCurrentCli: ready,
      requiredConfirmationPhrase: LIVE_READ_CONFIRMATION,
    },
  };
}

function buildApiReadRefusal(options = {}) {
  const evaluation = evaluateApiReadGates(options);
  const {
    endpointId,
    tenant = null,
    tenantFlags = {},
    requestInput = null,
    requestLoadError = null,
    requestFileProvided = false,
    readGate = null,
    readGateLoadError = null,
    readGateFileProvided = false,
    command = null,
  } = options;

  const endpoint = evaluation.endpoint || getApiEndpoint(endpointId);
  const allowlistedLiveRead = isLiveReadEndpoint(endpoint?.id);
  const ready = evaluation.ready;

  const payload = {
    schemaVersion: API_READ_REFUSAL_SCHEMA_VERSION,
    generatedFrom: 'metronome-cli/src/api-catalog/read-refusal.js',
    command,
    apiAccess: 'none',
    liveExecution: allowlistedLiveRead ? clone(LIVE_EXECUTION_ENABLED) : clone(LOCAL_ONLY_LIVE_EXECUTION),
    readEnabledInCurrentCli: allowlistedLiveRead,
    blocked: !ready,
    endpoint: endpointSnapshot(endpoint),
    tenantSelection: {
      tenant,
      explicit: ['sandbox', 'production'].includes(tenant),
      sandboxFlag: tenantFlags.sandbox === true,
      prodFlag: tenantFlags.prod === true,
    },
    request: {
      fileProvided: requestFileProvided === true,
      loaded: Boolean(requestInput && !requestLoadError),
      loadError: requestLoadError || null,
    },
    readPlan: summarizeReadPlan(evaluation.readPlan),
    readGate: {
      fileProvided: readGateFileProvided === true,
      loaded: Boolean(readGate && !readGateLoadError),
      loadError: readGateLoadError || null,
      validation: summarizeReadGateValidation(evaluation.readGateValidation),
    },
    authorization: evaluation.authorization,
    blockers: evaluation.blockers,
    blockReason: ready
      ? null
      : (evaluation.blockers[0]?.message || 'Expert API live read is not ready.'),
    sources: endpoint ? clone(endpoint.sources) : [],
  };

  if (!ready) {
    const nextCommands = evaluation.blockers.slice(0, 3).map((blocker) => {
      if (blocker.id === 'metronome-key-not-configured' && readGate?.tenantProfile?.keyEnv) {
        return `export ${readGate.tenantProfile.keyEnv}='<your-key>'`;
      }
      if (blocker.id === 'reviewed-read-gate-required') {
        return 'metro api read-gate template --read-plan <api-read-plan.json> --json';
      }
      if (blocker.id === 'valid-read-plan-required') {
        return `metro api read-plan ${endpointId || '<endpoint-id>'} --file <request.json> --sandbox --json`;
      }
      return blocker.nextSafeStep || 'metro docs explain first-safe-preview --json';
    });

    return buildApiReadRefusalPayload({
      ...payload,
      blockReason: payload.blockReason,
      nextCommands,
    });
  }

  return buildApiReadRefusalPayload({
    ...payload,
    blocked: false,
    blockReason: null,
    nextCommands: [
      `metro api read ${endpointId} --file <request.json> --sandbox --read-gate <gate.json> --confirm-live-read ${LIVE_READ_CONFIRMATION} --json`,
    ],
  });
}

module.exports = {
  API_READ_REFUSAL_SCHEMA_VERSION,
  buildApiReadRefusal,
  evaluateApiReadGates,
};
