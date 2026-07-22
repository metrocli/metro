'use strict';

const { getApiEndpoint } = require('./index');
const { validateApiApplyGate } = require('./apply-gate');
const { validateApiApprovalRecord } = require('./approval-record');
const { buildTransportRequest } = require('./read-result');
const { validateApiEndpointRequest, normalizeRequestInput } = require('./validation');
const { buildApiEndpointPreview } = require('./preview');
const { buildMetronomeHttpTransport } = require('../clients/metronome-http');
const {
  LIVE_APPLY_CONFIRMATION,
  createGuardedMetronomeWriteClient,
} = require('../clients/metronome-write');
const {
  isLiveApplySandboxEndpoint,
  isGreenfieldCreateEndpoint,
} = require('../clients/live-endpoints');
const { resolveKeyFromEnv } = require('../clients/tenant-keys');
const { sha256 } = require('../preview');

const API_APPLY_RESULT_SCHEMA_VERSION = 'metro.api.apply-live-result.v1';
const GREENFIELD_CREATE_CONFIRMATION = 'I_UNDERSTAND_SANDBOX_CATALOG_CREATE';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function endpointSnapshot(endpoint) {
  return {
    id: endpoint.id,
    method: endpoint.method,
    path: endpoint.path,
    family: endpoint.family,
    operationType: endpoint.operationType,
    permissionScope: endpoint.permissionScope,
  };
}

function evaluateApiApplyGates(options = {}) {
  const {
    endpointId,
    tenant = null,
    tenantFlags = {},
    requestInput = null,
    requestLoadError = null,
    requestFileProvided = false,
    applyGate = null,
    applyGateLoadError = null,
    applyGateFileProvided = false,
    applyGateRootDir = process.cwd(),
    approvalRecord = null,
    approvalRecordLoadError = null,
    approvalRecordFileProvided = false,
    confirmLiveApply = null,
    confirmGreenfieldCreate = null,
  } = options;

  const blockers = [];
  const endpoint = getApiEndpoint(endpointId);
  const tenantValid = tenant === 'sandbox';
  const confirmationMatches = confirmLiveApply === LIVE_APPLY_CONFIRMATION;
  const greenfieldConfirmMatches = confirmGreenfieldCreate === GREENFIELD_CREATE_CONFIRMATION;

  if (!endpointId) {
    blockers.push({ id: 'endpoint-id-required', message: 'metro api apply requires an endpoint ID.' });
  } else if (!endpoint) {
    blockers.push({ id: 'reviewed-endpoint-required', message: `Unknown endpoint: ${endpointId}.` });
  } else if (endpoint.operationType !== 'write') {
    blockers.push({ id: 'write-endpoint-required', message: `${endpoint.id} is not a write endpoint.` });
  } else if (!isLiveApplySandboxEndpoint(endpointId)) {
    blockers.push({
      id: 'live-apply-endpoint-not-enabled',
      message: `${endpoint.id} is not enabled for live sandbox apply in the current CLI.`,
    });
  }

  if (tenantFlags.prod) {
    blockers.push({ id: 'sandbox-only-apply', message: 'Live apply is sandbox-only. Production writes remain blocked.' });
  }
  if (!tenantValid) {
    blockers.push({ id: 'sandbox-tenant-required', message: 'Live apply requires --sandbox.' });
  }

  if (!requestFileProvided) {
    blockers.push({ id: 'request-file-required', message: 'metro api apply requires --file <request.json|yaml>.' });
  }
  if (requestLoadError) {
    blockers.push({ id: 'request-readable', message: `Failed to read request: ${requestLoadError}` });
  }

  let validation = null;
  let preview = null;
  if (endpoint && requestInput) {
    validation = validateApiEndpointRequest(endpoint.id, requestInput);
    preview = buildApiEndpointPreview(endpoint.id, requestInput, { tenant: 'sandbox' });
    if (!validation.valid) {
      blockers.push({ id: 'request-validation-failed', message: 'Request failed local endpoint validation.' });
    }
  }

  let applyGateValidation = null;
  if (!applyGateFileProvided) {
    blockers.push({ id: 'apply-gate-required', message: 'Live apply requires --apply-gate <api-apply-gate.json>.' });
  }
  if (applyGateLoadError) {
    blockers.push({ id: 'apply-gate-readable', message: `Failed to read apply gate: ${applyGateLoadError}` });
  } else if (applyGate) {
    applyGateValidation = validateApiApplyGate(applyGate, { rootDir: applyGateRootDir });
    if (!applyGateValidation.valid) {
      blockers.push({ id: 'apply-gate-invalid', message: 'Apply gate failed local validation.' });
    }
    if (preview?.requestSummary?.requestHash && applyGateValidation.summary?.requestHash
      && preview.requestSummary.requestHash !== applyGateValidation.summary.requestHash) {
      blockers.push({ id: 'apply-gate-request-hash-mismatch', message: 'Request hash does not match apply gate.' });
    }
  }

  let approvalValidation = null;
  if (!approvalRecordFileProvided) {
    blockers.push({ id: 'approval-record-required', message: 'Live apply requires --approval-record <api-approval-record.json>.' });
  }
  if (approvalRecordLoadError) {
    blockers.push({ id: 'approval-record-readable', message: `Failed to read approval record: ${approvalRecordLoadError}` });
  } else if (approvalRecord) {
    approvalValidation = validateApiApprovalRecord(approvalRecord, { rootDir: applyGateRootDir });
    if (!approvalValidation.valid) {
      blockers.push({ id: 'approval-record-invalid', message: 'Approval record failed validation.' });
    }
  }

  if (!confirmLiveApply) {
    blockers.push({ id: 'confirm-live-apply-required', message: 'Live apply requires --confirm-live-apply with the guarded phrase.' });
  } else if (!confirmationMatches) {
    blockers.push({ id: 'confirm-live-apply-mismatch', message: 'confirm-live-apply token does not match.' });
  }

  if (endpointId && isGreenfieldCreateEndpoint(endpointId)) {
    if (!confirmGreenfieldCreate) {
      blockers.push({
        id: 'confirm-greenfield-create-required',
        message: `${endpointId} requires --confirm-greenfield-create=${GREENFIELD_CREATE_CONFIRMATION}`,
      });
    } else if (!greenfieldConfirmMatches) {
      blockers.push({
        id: 'confirm-greenfield-create-mismatch',
        message: 'confirm-greenfield-create token does not match.',
      });
    }
  }

  let keyResolution = null;
  if (blockers.length === 0 && applyGate?.tenantProfile?.keyEnv) {
    keyResolution = resolveKeyFromEnv(applyGate.tenantProfile.keyEnv);
    if (!keyResolution.configured) {
      blockers.push({ id: 'metronome-key-not-configured', message: keyResolution.reason });
    }
  }

  return {
    ready: blockers.length === 0,
    endpoint,
    validation,
    preview,
    applyGateValidation,
    approvalValidation,
    keyResolution,
    blockers,
  };
}

async function runLiveApiApply(options = {}) {
  const evaluation = evaluateApiApplyGates(options);
  if (!evaluation.ready) {
    return {
      blocked: true,
      blockers: evaluation.blockers,
      blockReason: evaluation.blockers[0]?.message || 'Apply gates not satisfied.',
    };
  }

  const { endpoint, applyGate, requestInput } = options;
  const transportFactory = options.transportFactory || buildMetronomeHttpTransport;
  const transport = transportFactory(evaluation.keyResolution.value);
  const writeClient = createGuardedMetronomeWriteClient({
    tenant: 'sandbox',
    liveApplyConfirmation: options.confirmLiveApply,
    endpointId: endpoint.id,
    transport,
    transportMode: 'live',
  });

  const transportRequest = buildTransportRequest(endpoint, requestInput);
  const response = await writeClient.request({
    method: transportRequest.method,
    path: transportRequest.path.split('?')[0],
    body: transportRequest.body,
  });
  const responseData = Object.prototype.hasOwnProperty.call(response || {}, 'data') ? response.data : response;

  return {
    schemaVersion: API_APPLY_RESULT_SCHEMA_VERSION,
    generatedFrom: 'metronome-cli/src/api-catalog/apply-live.js',
    apiAccess: 'live-write',
    liveExecution: {
      enabledInCurrentCli: true,
      tenant: 'sandbox',
      reason: 'Guarded sandbox apply executed against Metronome with reviewed apply-gate and approval evidence.',
    },
    applyEnabledInCurrentCli: true,
    blocked: false,
    tenant: 'sandbox',
    endpoint: endpointSnapshot(endpoint),
    applyGateValidation: {
      valid: evaluation.applyGateValidation.valid,
      summary: clone(evaluation.applyGateValidation.summary),
    },
    approvalRecordValidation: {
      valid: evaluation.approvalValidation.valid,
      summary: clone(evaluation.approvalValidation.summary),
    },
    requestHash: evaluation.preview?.requestSummary?.requestHash || null,
    responseHash: sha256(responseData),
    httpStatus: response?.status || 200,
    responseData: clone(responseData),
    nextSafeStep: 'Run metro api apply-readback verify with a read-result from the created object.',
    nextCommands: [
      'metro api read contracts.get.v2 --file <get-request.json> --sandbox --read-gate <gate.json> --confirm-live-read I_UNDERSTAND_THIS_WILL_READ_LIVE_METRONOME --json',
      'metro api apply-readback verify --apply-audit <audit.jsonl> --read-result <read-result.json> --json',
    ],
  };
}

module.exports = {
  API_APPLY_RESULT_SCHEMA_VERSION,
  evaluateApiApplyGates,
  runLiveApiApply,
  LIVE_APPLY_CONFIRMATION,
  GREENFIELD_CREATE_CONFIRMATION,
};
