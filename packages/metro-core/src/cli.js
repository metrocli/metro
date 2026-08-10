'use strict';

const fs = require('fs');
const path = require('path');
const {
  apiCatalog,
  apiEndpointDiff,
  apiEndpointDetail,
  apiEndpointSearch,
  approvalPolicyReference,
  permissionScopeReference,
} = require('./api-catalog');
const { buildApiExportBundle } = require('./api-catalog/export');
const {
  buildApiApplyGateTemplate,
  buildApiSandboxProofTemplate,
  validateApiApplyGate,
  validateApiSandboxProof,
} = require('./api-catalog/apply-gate');
const {
  buildApiApprovalRecordTemplate,
  validateApiApprovalRecord,
} = require('./api-catalog/approval-record');
const {
  buildApiApplyAuditTemplate,
  buildApiApplyAuditWritePlan,
  validateApiApplyAuditJsonl,
  writeApiApplyAuditJsonl,
} = require('./api-catalog/apply-audit');
const {
  buildApiApplyResultTemplate,
  validateApiApplyResult,
} = require('./api-catalog/apply-result');
const { verifyApiApplyReadback } = require('./api-catalog/apply-readback');
const { buildApiPreflightTemplate, validateApiPreflight } = require('./api-catalog/preflight');
const { buildApiEndpointPreview } = require('./api-catalog/preview');
const {
  buildApiReadAuditTemplate,
  buildApiReadAuditWritePlan,
  validateApiReadAuditJsonl,
  writeApiReadAuditJsonl,
} = require('./api-catalog/read-audit');
const { buildApiReadGateTemplate, validateApiReadGate } = require('./api-catalog/read-gate');
const { buildApiReadMockBundle } = require('./api-catalog/read-mock');
const { buildApiEndpointReadPlan } = require('./api-catalog/read-plan');
const { buildApiReadPipelinePlan, writeApiReadPipeline } = require('./api-catalog/read-pipeline');
const { buildApiReadPreflight } = require('./api-catalog/read-preflight');
const { buildApiReadRefusal } = require('./api-catalog/read-refusal');
const { runLiveApiRead, verifyApiReadResult } = require('./api-catalog/read-result');
const { runLiveApiApply, LIVE_APPLY_CONFIRMATION } = require('./api-catalog/apply-live');
const { helpHeaderLines } = require('./branding');
const { runDimensionalCommand } = require('./commands/dimensional');
const { runContractMovePlanCommand } = require('./commands/contract-move-plan');
const { runContractExtendTrialCommand } = require('./commands/contract-extend-trial');
const { runContractExpireCommand } = require('./commands/contract-expire');
const { runLedgerAdjustmentCommand } = require('./commands/ledger-adjustment');
const { runPackageCustomersCommand } = require('./commands/package-customers');
const { runContractRepairAccidentalCommand } = require('./commands/contract-repair-accidental');
const { runBillingProviderCutoverCommand } = require('./commands/billing-provider-cutover');
const { runPackageListCommand } = require('./commands/package-list');
const { runCustomerBalancesCommand } = require('./commands/customer-balances');
const { runCatalogBindCommand } = require('./commands/catalog-bind');
const { runTenantSnapshotCommand } = require('./commands/tenant-snapshot');
const { runOpsCommand } = require('./commands/ops');
const { classifyAccount } = require('./account-classifier');
const { readSnapshot, snapshotPath, defaultMetroConfigDir: snapshotConfigDir } = require('./tenant-snapshot');
const { detectPromoteOpportunity } = require('./promote-codebase');
let enrichRouteResult;
try {
  // ponytail: generic pack path in monorepo / public export; optional if pack missing
  enrichRouteResult = require('../../metro-workspace-generic/src/route-enrichment').enrichRouteResult;
} catch {
  enrichRouteResult = null;
}
const { buildRefusal } = require('./output/refusal');
const {
  renderValidationHuman,
  renderRefusalHuman,
  renderLiveReadSuccessHuman,
  renderLiveApplySuccessHuman,
} = require('./output/human');
const { apiReadinessCompactSummary, apiReadinessSummary } = require('./api-catalog/readiness');
const { validateApiEndpointRequest } = require('./api-catalog/validation');
const {
  buildAuditTemplate,
  buildAuditWritePlan,
  validateAuditJsonl,
  writeAuditJsonl,
} = require('./audit');
const { buildApplyGateTemplate, validateApplyGate } = require('./apply-gate');
const { verifyWorkflowApplyReadback } = require('./apply-readback');
const {
  buildWorkflowApprovalRecordTemplate,
  validateWorkflowApprovalRecord,
} = require('./approval-record');
const { commandReference, offlineHelpLines } = require('./commands/catalog');
const { apiReference } = require('./docs/api-reference');
const { renderApiReferenceHtml } = require('./docs/api-reference-html');
const { docsExplainTopicIndex, explainDocsTopic } = require('./docs/explain');
const { renderCommandReferenceHtml } = require('./docs/command-reference-html');
const { exclusiveFormatError, renderReferenceMarkdown } = require('./docs/reference-markdown');
const { evidenceGateReference } = require('./docs/evidence-gate-reference');
const { renderEvidenceGateReferenceHtml } = require('./docs/evidence-gate-reference-html');
const { gotchaReference } = require('./docs/gotcha-reference');
const { renderGotchaReferenceHtml } = require('./docs/gotcha-reference-html');
const { inputReference } = require('./docs/input-reference');
const { renderInputReferenceHtml } = require('./docs/input-reference-html');
const { renderExplainReferenceHtml } = require('./docs/explain-reference-html');
const { shapeReference, validatorReference } = require('./docs/shape-validator-reference');
const { renderShapeReferenceHtml, renderValidatorReferenceHtml } = require('./docs/shape-validator-reference-html');
const { buildInspectPlan, getInspectPlanDefinition, validateHourBoundaryTimestamp } = require('./inspect');
const { loadStructuredFile } = require('./input/files');
const { buildInputNormalization } = require('./input/normalize');
const { buildPreflightTemplate, validatePreflight } = require('./preflight');
const { buildSandboxProofTemplate, validateSandboxProof } = require('./proof/sandbox-manifest');
const {
  buildReleaseArtifactManifest,
  buildReleaseEvidencePlan,
  buildReleaseRetentionPolicyTemplate,
  buildReleaseReadiness,
  checkReleaseEvidenceDirectory,
  validateReleaseRetentionPolicy,
} = require('./release/readiness');
const { buildInstallDoctor } = require('./install/doctor');
const {
  buildSetupAuthCheck,
  buildSetupInit,
  buildSetupQuickstart,
  buildSetupTemplate,
  defaultMetroConfigDir,
  resolveTenantProfile,
  validateProfileConfig,
  writeSetupInit,
} = require('./setup/profiles');
const {
  loadOperatorMode,
  setOperatorMode,
  resetOperatorMode,
  MODES: OPERATOR_MODES,
  MODE_HELP,
} = require('./setup/mode');
const { getQuickstartPackConfig, resolveQuickstartPackId } = require('./setup/quickstart-config');
const {
  listLiveApplySandboxEndpointIds,
  listLiveReadEndpointIds,
} = require('./clients/live-endpoints');
const { executeHarnessSteps } = require('./harness/execute');
const {
  buildApplyHarnessPlan,
  buildHarnessPlan,
  buildIntentHarnessPlan,
  buildReadHarnessPlan,
  listHarnessSuites,
} = require('./harness');
const { buildSourceBoundaryTemplate, validateSourceBoundary } = require('./source-boundary');
const { explainShape, listShapes } = require('./shapes');
const { buildPreview } = require('./preview');
const { validateShapeInput } = require('./validators');
const { buildApplyResultTemplate, verifyApplyResult } = require('./verify/apply-result');
const { verifyAuditLog } = require('./verify/audit-log');
const { verifyInspectOutput } = require('./verify/inspect-output');
const {
  buildPlanInputTemplate,
  buildWorkspacePlan,
  buildAuditExportClassify,
  buildAuditExportPlan,
  extractWorkspaceCatalogFromConfig,
  getWorkspaceModel,
  listIntents,
  resolveWorkspaceCatalog,
  routeWorkspaceRequest,
  resolvePackId,
  setSessionWorkspacePack,
  writeStickyWorkspacePack,
  listWorkspacePacks,
  describeWorkspaceResolution,
} = require('./workspace');

function write(stream, value) {
  stream.write(`${value}\n`);
}

function parseArgs(argv) {
  const flags = {};
  const positional = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }

    const eq = arg.indexOf('=');
    if (eq !== -1) {
      flags[arg.slice(2, eq)] = arg.slice(eq + 1);
      continue;
    }

    const name = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      flags[name] = next;
      i += 1;
    } else {
      flags[name] = true;
    }
  }

  return { flags, positional };
}

function renderJson(stream, payload) {
  write(stream, JSON.stringify(payload, null, 2));
}

function renderQuickstartShellScript(quickstart) {
  return [
    '# metro setup quickstart --shell prints this script; it has not run until a shell executes it.',
    '# Run it directly with:',
    '#   metro setup quickstart --shell | zsh',
    '# This creates sample files under ${TMPDIR:-/tmp}/metro-quickstart and runs a local sandbox preview.',
    '# No live APIs are called. Re-run setup auth --check-env after exporting your sandbox key.',
    quickstart.shellCommandBlock,
  ].join('\n');
}

function printHelp(stdout) {
  write(stdout, [
    ...helpHeaderLines(),
    '',
    'Offline commands:',
    ...offlineHelpLines(),
    '',
    'Live reads and sandbox writes require read-gate/apply-gate evidence and current-turn confirmation.',
    'Use metro status --json for workspace, auth, and endpoint allowlist summary.',
    'Use metro harness run --suite onboard --execute --json for the full local onboarding harness.',
  ].join('\n'));
}

function loadJsonFile(file) {
  return loadStructuredFile(file);
}

function loadTextFile(file) {
  const resolved = path.resolve(file);
  return fs.readFileSync(resolved, 'utf8');
}

function splitCommaSeparatedPaths(value) {
  if (!value || value === true) return [];
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function runShapeCommand(positional, flags, streams) {
  const action = positional[1];
  if (action === 'list') {
    const payload = {
      schemaVersion: 'metro.shape.list.v1',
      shapes: listShapes(),
    };
    if (flags.json) {
      renderJson(streams.stdout, payload);
    } else {
      for (const shape of payload.shapes) {
        write(streams.stdout, `${shape.id}\t${shape.maturity}\t${shape.title}`);
      }
    }
    return 0;
  }

  if (action === 'explain') {
    const shapeId = positional[2];
    const payload = explainShape(shapeId);
    if (!payload) {
      write(streams.stderr, `Unknown shape: ${shapeId || '(missing)'}`);
      return 1;
    }
    if (flags.json) {
      renderJson(streams.stdout, payload);
    } else {
      write(streams.stdout, `${payload.title} (${payload.id})`);
      write(streams.stdout, `Maturity: ${payload.maturity}`);
      write(streams.stdout, `Purpose: ${payload.purpose}`);
      write(streams.stdout, `Supported modes: ${payload.supportedModes.join(', ')}`);
      write(streams.stdout, `Validator rules: ${payload.validatorRuleIds.join(', ')}`);
    }
    return 0;
  }

  write(streams.stderr, `Unknown shape command: ${action || '(missing)'}`);
  return 1;
}

function runValidateCommand(flags, streams) {
  if (!flags.shape) {
    write(streams.stderr, 'validate requires --shape <shape>');
    return 1;
  }
  if (!flags.file) {
    write(streams.stderr, 'validate requires --file <input.json|yaml>');
    return 1;
  }

  let input;
  try {
    input = loadJsonFile(flags.file);
  } catch (error) {
    write(streams.stderr, `Failed to read input JSON/YAML: ${error.message}`);
    return 1;
  }

  const result = validateShapeInput(flags.shape, input);
  if (flags.json) {
    renderJson(streams.stdout, result);
  } else {
    renderValidationHuman(streams.stdout, result, flags.shape);
  }

  return result.valid ? 0 : 1;
}

function runInputCommand(positional, flags, streams) {
  const action = positional[1];
  if (action !== 'normalize') {
    write(streams.stderr, `Unknown input command: ${action || '(missing)'}`);
    return 1;
  }

  const shape = flags.shape || null;
  const endpointId = flags.api || flags.endpoint || positional[2] || null;
  if (Boolean(shape) === Boolean(endpointId)) {
    write(streams.stderr, 'input normalize requires exactly one target: --shape <shape> or --api <endpoint-id>');
    return 1;
  }
  if (!flags.file) {
    write(streams.stderr, 'input normalize requires --file <input.json|yaml>');
    return 1;
  }

  let input;
  try {
    input = loadJsonFile(flags.file);
  } catch (error) {
    write(streams.stderr, `Failed to read input JSON/YAML: ${error.message}`);
    return 1;
  }

  const result = buildInputNormalization({
    shape,
    endpointId,
    input,
    filePath: flags.file,
    rootDir: process.cwd(),
  });

  if (flags.json) {
    renderJson(streams.stdout, result);
  } else if (result.valid) {
    write(streams.stdout, `Input normalization passed for ${result.target.id}.`);
    write(streams.stdout, `Mode: ${result.mode}`);
    write(streams.stdout, `Normalized hash: ${result.normalizedHash}`);
    write(streams.stdout, `Live execution enabled: ${result.liveExecution.enabledInCurrentCli ? 'yes' : 'no'}`);
  } else {
    write(streams.stdout, `Input normalization failed for ${result.target.id || '(unknown)'}.`);
    for (const finding of result.findings) {
      write(streams.stdout, `- ${finding.id} [${finding.severity}] ${finding.message}`);
    }
  }

  return result.valid ? 0 : 1;
}

function resolveTenant(flags, streams, commandLabel = 'Preview') {
  if (flags.sandbox && flags.prod) {
    write(streams.stderr, 'Choose exactly one tenant: --sandbox or --prod.');
    return null;
  }
  if (flags.sandbox) return 'sandbox';
  if (flags.prod) return 'production';
  write(streams.stderr, `${commandLabel} requires explicit tenant selection: --sandbox or --prod.`);
  return null;
}

function packageQuickstartPreviewExample() {
  return 'metro package preview --shape pro-annual --file "${TMPDIR:-/tmp}/metro-quickstart/pro-annual.json" --sandbox --json';
}

function writePackagePreviewNextSteps(stream) {
  write(stream, 'Example using the quickstart sample file:');
  write(stream, `  ${packageQuickstartPreviewExample()}`);
  write(stream, 'If the sample file does not exist yet, run:');
  write(stream, '  metro setup quickstart --shell | zsh');
  write(stream, 'Tip: --sandbox is a flag on the same metro command, not a separate command.');
}

function tenantFromFlags(flags) {
  if (flags.sandbox && flags.prod) return null;
  if (flags.sandbox) return 'sandbox';
  if (flags.prod) return 'production';
  return null;
}

function previewDefinitionFor(positional) {
  const group = positional[0];
  if (group === 'custom-contract' && positional[1] === 'preview') {
    return {
      label: 'custom-contract',
      expectedShape: 'enterprise-custom-contract',
      shapeRequired: false,
    };
  }

  if (group === 'customer' && positional[1] === 'setup' && positional[2] === 'preview') {
    return {
      label: 'customer setup',
      expectedShape: 'customer-setup',
      shapeRequired: false,
    };
  }

  if (positional[1] === 'preview') {
    const expectedShape = {
      package: 'pro-annual',
      credit: 'complimentary-credit-grant',
      'billing-provider': 'stripe-billing-provider-attachment',
    }[group];
    if (!expectedShape) return null;
    return {
      label: group,
      expectedShape,
      supportedShapes: group === 'credit'
        ? ['complimentary-credit-grant', 'paid-credit-top-up']
        : group === 'package'
          ? ['pro-annual', 'pro-annual-self-serve-v2']
          : [expectedShape],
      shapeRequired: true,
    };
  }

  if (group === 'contract' && positional[1] === 'move-plan' && positional[2] === 'preview') {
    return {
      label: 'contract move-plan',
      expectedShape: 'package-plan-move-no-immediate-invoice',
      supportedShapes: ['package-plan-move-no-immediate-invoice', 'package-plan-move-immediate-invoice'],
      shapeRequired: false,
    };
  }

  if (group === 'package' && positional[1] === 'archive' && positional[2] === 'preview') {
    return {
      label: 'package archive',
      expectedShape: 'package-alias-archive-handoff',
      shapeRequired: false,
    };
  }

  if (group === 'product' && positional[1] === 'retire' && positional[2] === 'preview') {
    return {
      label: 'product retire',
      expectedShape: 'product-rate-retirement',
      shapeRequired: false,
    };
  }

  if (group === 'rate-card' && positional[1] === 'dimensional' && positional[2] === 'preview') {
    return {
      label: 'rate-card dimensional',
      expectedShape: 'dimensional-rate-card',
      shapeRequired: false,
    };
  }

  if (group === 'invoice' && positional[1] === 'issue-date' && positional[2] === 'preview') {
    return {
      label: 'invoice issue-date',
      expectedShape: 'invoice-issue-date-update',
      shapeRequired: false,
    };
  }

  if (group === 'subscription' && positional[1] === 'contract' && positional[2] === 'preview') {
    return {
      label: 'subscription contract',
      expectedShape: 'direct-subscription-contract',
      shapeRequired: false,
    };
  }

  if (group === 'usage' && positional[1] === 'ingest' && positional[2] === 'preview') {
    return {
      label: 'usage ingest',
      expectedShape: 'usage-ingest-preview',
      shapeRequired: false,
    };
  }

  return null;
}

function runPreviewCommand(positional, flags, streams) {
  const definition = previewDefinitionFor(positional);
  if (!definition) {
    write(streams.stderr, `Unknown preview command: ${positional.join(' ') || '(missing)'}`);
    return 1;
  }

  const shape = flags.shape || definition.expectedShape;
  const supportedShapes = definition.supportedShapes || [definition.expectedShape];
  if (!supportedShapes.includes(shape) || (definition.shapeRequired && !flags.shape)) {
    const supplied = flags.shape ? ` Received --shape ${flags.shape}.` : '';
    write(streams.stderr, `${definition.label} preview currently supports --shape ${supportedShapes.join(' or ')}.${supplied}`);
    if (definition.label === 'package') writePackagePreviewNextSteps(streams.stderr);
    return 1;
  }

  const tenant = resolveTenant(flags, streams);
  if (!tenant) {
    if (definition.label === 'package') writePackagePreviewNextSteps(streams.stderr);
    return 2;
  }

  if (!flags.file) {
    write(streams.stderr, `${definition.label} preview requires --file <input.json|yaml>.`);
    if (definition.label === 'package') writePackagePreviewNextSteps(streams.stderr);
    return 1;
  }

  let input;
  try {
    input = loadJsonFile(flags.file);
  } catch (error) {
    write(streams.stderr, `Failed to read input JSON/YAML: ${error.message}`);
    return 1;
  }

  const preview = buildPreview(shape, input, { tenant });
  if (flags.json) {
    renderJson(streams.stdout, preview);
  } else if (preview.blocked) {
    write(streams.stdout, `Preview blocked for ${shape}: ${preview.blockReason}`);
    for (const finding of preview.validation?.findings || []) {
      write(streams.stdout, `- ${finding.id} [${finding.severity}] ${finding.message}`);
    }
  } else {
    write(streams.stdout, `Preview built for ${shape} on ${tenant}.`);
    write(streams.stdout, `Payload hash: ${preview.payloadHash}`);
    write(streams.stdout, `Actions: ${preview.actions.length}`);
    write(streams.stdout, `Apply supported: ${preview.applySupported ? 'yes' : 'no'}`);
  }

  return preview.blocked ? 1 : 0;
}

function runDocsCommand(positional, flags, streams) {
  const action = positional[1];
  if (action === 'command-reference') {
    return renderCommandReference(flags, streams);
  }
  if (action === 'explain') {
    const topic = positional[2] || flags.topic;
    if (flags.list) {
      if (topic) {
        write(streams.stderr, 'docs explain --list does not accept <topic> or --topic');
        return 1;
      }
      const payload = docsExplainTopicIndex();
      const formatErr = exclusiveFormatError(flags);
      if (formatErr) {
        write(streams.stderr, formatErr);
        return 1;
      }
      if (flags.html) {
        streams.stdout.write(renderExplainReferenceHtml(payload));
      } else if (flags.markdown) {
        streams.stdout.write(renderReferenceMarkdown(payload, { title: 'Docs explain topic index' }));
      } else if (flags.json) {
        renderJson(streams.stdout, payload);
      } else {
        write(streams.stdout, 'Docs explain topic index');
        write(streams.stdout, `Operating topics: ${payload.summary.operatingTopicCount}`);
        for (const topicInfo of payload.operatingTopics) {
          write(streams.stdout, `- ${topicInfo.id} [${topicInfo.status}] ${topicInfo.summary}`);
        }
        write(streams.stdout, `Lookup kinds: ${payload.summary.lookupKindCount}`);
        write(streams.stdout, payload.nextSafeStep);
      }
      return 0;
    }
    if (flags.html) {
      write(streams.stderr, 'docs explain --html currently requires --list (use --markdown or --json for a single topic)');
      return 1;
    }
    if (!topic) {
      write(streams.stderr, 'docs explain requires <topic> or --topic <topic>');
      return 1;
    }
    const payload = explainDocsTopic(topic);
    if (!payload) {
      write(streams.stderr, `Unknown docs topic: ${topic}`);
      return 1;
    }
    const formatErr = exclusiveFormatError(flags);
    if (formatErr) {
      write(streams.stderr, formatErr);
      return 1;
    }
    if (flags.markdown) {
      streams.stdout.write(renderReferenceMarkdown(payload));
    } else if (flags.json) {
      renderJson(streams.stdout, payload);
    } else {
      write(streams.stdout, `${payload.match.title} (${payload.match.id})`);
      write(streams.stdout, `Type: ${payload.match.type}`);
      write(streams.stdout, `Status: ${payload.match.status}`);
      write(streams.stdout, `API access: ${payload.match.apiAccess}`);
      write(streams.stdout, `Summary: ${payload.match.summary}`);
      if (payload.match.sources?.length) {
        write(streams.stdout, `Sources: ${payload.match.sources.join(', ')}`);
      }
    }
    return 0;
  }
  if (action === 'api-reference') {
    return renderReferenceOutput(flags, streams, apiReference({ family: flags.family || null }), renderApiReferenceHtml, 'api reference');
  }
  if (action === 'evidence-gate-reference') {
    return renderReferenceOutput(flags, streams, evidenceGateReference(), renderEvidenceGateReferenceHtml, 'evidence gate reference');
  }
  if (action === 'input-reference') {
    return renderReferenceOutput(flags, streams, inputReference(), renderInputReferenceHtml, 'input reference');
  }
  if (action === 'shape-reference') {
    return renderReferenceOutput(flags, streams, shapeReference(), renderShapeReferenceHtml, 'shape reference');
  }
  if (action === 'validator-reference') {
    return renderReferenceOutput(flags, streams, validatorReference(), renderValidatorReferenceHtml, 'validator reference');
  }
  if (action === 'gotcha-reference') {
    return renderReferenceOutput(flags, streams, gotchaReference(), renderGotchaReferenceHtml, 'gotcha reference');
  }

  write(streams.stderr, `Unknown docs command: ${action || '(missing)'}`);
  return 1;
}

function renderReferenceOutput(flags, streams, payload, renderHtml, label) {
  const formatErr = exclusiveFormatError(flags);
  if (formatErr) {
    write(streams.stderr, formatErr);
    return 1;
  }
  if (flags.html) {
    streams.stdout.write(renderHtml(payload));
    return 0;
  }
  if (flags.markdown) {
    streams.stdout.write(renderReferenceMarkdown(payload, { title: label }));
    return 0;
  }
  if (flags.json) {
    renderJson(streams.stdout, payload);
  } else {
    write(streams.stdout, label);
    write(streams.stdout, `Schema: ${payload.schemaVersion}`);
    write(streams.stdout, `Run with --json, --html, or --markdown for the full generated reference.`);
  }
  return 0;
}

function renderCommandReference(flags, streams) {
  const payload = commandReference();
  if (flags.json || flags.html || flags.markdown) {
    return renderReferenceOutput(flags, streams, payload, renderCommandReferenceHtml, 'command reference');
  }
  {
    write(streams.stdout, 'Command reference');
    for (const command of payload.commands) {
      write(streams.stdout, `- ${command.command}`);
    }
    write(streams.stdout, '');
    write(streams.stdout, 'Unsupported commands');
    for (const command of payload.unsupportedCommands) {
      write(streams.stdout, `- ${command.command}`);
    }
  }
  return 0;
}

function runSchemaCommand(positional, flags, streams) {
  if (positional.length > 1) {
    write(streams.stderr, `Unknown schema command: ${positional.slice(1).join(' ')}`);
    return 1;
  }
  return renderCommandReference(flags, streams);
}

function runSetupCommand(positional, flags, streams) {
  const action = positional[1];

  if (action === 'quickstart') {
    const quickstart = buildSetupQuickstart({ workspacePack: flags.workspace || null });
    if (flags.json && flags.shell) {
      write(streams.stderr, 'setup quickstart supports exactly one structured output mode: --json or --shell.');
      return 1;
    }
    if (flags.json) {
      renderJson(streams.stdout, quickstart);
    } else if (flags.shell) {
      write(streams.stdout, renderQuickstartShellScript(quickstart));
    } else {
      write(streams.stdout, quickstart.title);
      write(streams.stdout, `API access: ${quickstart.apiAccess}`);
      write(streams.stdout, `Live execution enabled: ${quickstart.liveExecution.enabledInCurrentCli ? 'yes' : 'no'}`);
      write(streams.stdout, '');
      write(streams.stdout, 'Run:');
      for (const step of quickstart.commands) {
        write(streams.stdout, step.command);
      }
      write(streams.stdout, '');
      write(streams.stdout, 'Expected preview summary:');
      write(streams.stdout, `${quickstart.expectedPreviewSummary.schemaVersion} ${quickstart.expectedPreviewSummary.workflow} ${quickstart.expectedPreviewSummary.shape} ${quickstart.expectedPreviewSummary.tenant}`);
      write(streams.stdout, '');
      write(streams.stdout, 'Safety boundary: a green preview is not production approval.');
    }
    return 0;
  }

  if (action === 'template') {
    const template = buildSetupTemplate({ workspacePack: flags.workspace || null });
    if (flags.json) {
      renderJson(streams.stdout, template);
    } else {
      write(streams.stdout, 'Metro profile template');
      for (const [name, profile] of Object.entries(template.profiles)) {
        write(streams.stdout, `- ${name}: ${profile.tenant} via ${profile.metronomeKeyEnv}`);
      }
      write(streams.stdout, 'Store env var names only; local preview does not require API keys.');
    }
    return 0;
  }

  if (action === 'doctor') {
    if (!flags.file) {
      write(streams.stderr, 'setup doctor requires --file <profiles.json>');
      return 1;
    }
    let input;
    try {
      input = loadJsonFile(flags.file);
    } catch (error) {
      write(streams.stderr, `Failed to read profile JSON/YAML: ${error.message}`);
      return 1;
    }

    const result = validateProfileConfig(input);
    if (flags.json) {
      renderJson(streams.stdout, result);
    } else if (result.valid) {
      write(streams.stdout, `Profile doctor passed for ${result.summary.profileCount} profile(s).`);
      for (const profile of result.profiles) {
        write(streams.stdout, `- ${profile.name}: ${profile.tenant}, env ${profile.metronomeKeyEnv} present=${profile.envPresent ? 'yes' : 'no'}`);
      }
    } else {
      write(streams.stdout, 'Profile doctor failed:');
      for (const finding of result.findings) {
        write(streams.stdout, `- ${finding.id} [${finding.severity}] ${finding.message}`);
      }
    }
    return result.valid ? 0 : 1;
  }

  if (action === 'auth') {
    if (!flags.file) {
      write(streams.stderr, 'setup auth requires --file <profiles.json>');
      return 1;
    }
    let input;
    try {
      input = loadJsonFile(flags.file);
    } catch (error) {
      write(streams.stderr, `Failed to read profile JSON/YAML: ${error.message}`);
      return 1;
    }

    const result = buildSetupAuthCheck(input, {
      profileName: flags.profile || null,
      checkEnv: flags['check-env'] === true,
      env: process.env,
    });

    if (flags.json) {
      renderJson(streams.stdout, result);
    } else if (result.valid) {
      write(streams.stdout, `Auth check for ${result.summary.profileCount} profile(s).`);
      for (const profile of result.profiles) {
        const keyStatus = result.checkEnv
          ? (profile.keyConfigured ? 'configured' : 'missing')
          : 'not checked';
        write(streams.stdout, `- ${profile.name} (${profile.tenant}): ${profile.metronomeKeyEnv} ${keyStatus}`);
      }
      write(streams.stdout, result.nextSafeStep);
    } else {
      write(streams.stdout, 'Auth check failed:');
      for (const finding of result.findings) {
        write(streams.stdout, `- ${finding.id} [${finding.severity}] ${finding.message}`);
      }
      if (result.profileFilter && result.profiles.length === 0) {
        write(streams.stdout, `- Profile "${result.profileFilter}" was not found.`);
      }
    }
    return result.valid && (!result.checkEnv || result.summary.allKeysConfigured) ? 0 : 1;
  }

  if (action === 'init') {
    const initOptions = {
      dir: flags.dir || null,
      force: flags.force === true,
      workspacePack: flags.workspace || null,
    };
    const result = flags.write === true
      ? writeSetupInit(initOptions)
      : buildSetupInit(initOptions);

    if (flags.json) {
      renderJson(streams.stdout, result);
    } else if (result.written) {
      write(streams.stdout, `Created ${result.profilePath}`);
      write(streams.stdout, result.nextSafeStep);
    } else if (result.blocked) {
      write(streams.stdout, result.blockReason);
      write(streams.stdout, result.nextSafeStep);
    } else {
      write(streams.stdout, `Would create ${result.profilePath}`);
      write(streams.stdout, 'Run metro setup init --write to create the file.');
    }
    return result.valid || result.written ? 0 : 1;
  }

  if (action === 'resolve') {
    if (!flags.file) {
      write(streams.stderr, 'setup resolve requires --file <profiles.json>');
      return 1;
    }
    if (!flags.profile) {
      write(streams.stderr, 'setup resolve requires --profile <name>');
      return 1;
    }
    if (!flags['key-fingerprint']) {
      write(streams.stderr, 'setup resolve requires --key-fingerprint <fingerprint>');
      return 1;
    }
    let input;
    try {
      input = loadJsonFile(flags.file);
    } catch (error) {
      write(streams.stderr, `Failed to read profile JSON/YAML: ${error.message}`);
      return 1;
    }

    const result = resolveTenantProfile(input, {
      profileName: flags.profile,
      expectedTenant: flags['expect-tenant'] || null,
      keyFingerprint: flags['key-fingerprint'],
      checkEnv: flags['check-env'] === true,
      env: process.env,
    });
    if (flags.json) {
      renderJson(streams.stdout, result);
    } else if (result.valid) {
      write(streams.stdout, `Profile resolved: ${result.tenantProfile.profileName}`);
      write(streams.stdout, `Tenant: ${result.tenantProfile.tenant}`);
      write(streams.stdout, `Key env: ${result.tenantProfile.keyEnv}`);
      write(streams.stdout, `Key fingerprint: ${result.tenantProfile.keyFingerprint}`);
      if (result.profile.envPresence.checked) {
        write(streams.stdout, `Env present: ${result.profile.envPresence.present ? 'yes' : 'no'}`);
      }
      write(streams.stdout, 'Live API execution: disabled');
    } else {
      write(streams.stdout, 'Profile resolution failed:');
      for (const finding of result.findings) {
        write(streams.stdout, `- ${finding.id} [${finding.severity}] ${finding.message}`);
      }
    }
    return result.valid ? 0 : 1;
  }

  write(streams.stderr, `Unknown setup command: ${action || '(missing)'}`);
  return 1;
}

function optionalProfileBinding(flags, streams) {
  if (!flags.file || !flags.profile) return null;
  let input;
  try {
    input = loadStructuredFile(flags.file);
  } catch (error) {
    write(streams.stderr, `Failed to read profile JSON/YAML: ${error.message}`);
    return { error: true };
  }

  const validation = validateProfileConfig(input, {
    checkEnv: flags['check-env'] !== false,
    env: process.env,
  });
  const selected = validation.profiles.find((entry) => entry.name === flags.profile);
  if (!selected) {
    write(streams.stderr, `Profile "${flags.profile}" not found in ${flags.file}`);
    return { error: true };
  }

  const expectTenant = flags.sandbox ? 'sandbox' : flags.prod ? 'production' : null;
  if (expectTenant && selected.tenant !== expectTenant) {
    write(streams.stderr, `Profile "${flags.profile}" is ${selected.tenant} but command tenant is ${expectTenant}.`);
    return { error: true };
  }

  return {
    profile: flags.profile,
    tenant: selected.tenant,
    metronomeKeyEnv: selected.metronomeKeyEnv,
    keyConfigured: selected.envPresent === true,
    workspaceCatalog: extractWorkspaceCatalogFromConfig(input, flags.profile),
  };
}

function runWorkspaceCommand(positional, flags, streams) {
  const action = positional[1];

  if (action === 'list') {
    const payload = {
      schemaVersion: 'metro.workspace.list.v1',
      apiAccess: 'none',
      activePackId: resolvePackId({ workspace: flags.workspace || null }),
      packs: listWorkspacePacks({ workspace: flags.workspace || null }),
    };
    if (flags.json) {
      renderJson(streams.stdout, payload);
    } else {
      write(streams.stdout, `Active workspace pack: ${payload.activePackId}`);
      for (const pack of payload.packs) {
        write(streams.stdout, `${pack.active ? '*' : ' '} ${pack.id}${pack.npmName ? ` (${pack.npmName})` : ''}`);
      }
      write(streams.stdout, 'Next: metro workspace use <generic|stub> [--write]');
    }
    return 0;
  }

  if (action === 'current') {
    const payload = describeWorkspaceResolution({ workspace: flags.workspace || null });
    if (flags.json) {
      renderJson(streams.stdout, payload);
    } else {
      write(streams.stdout, `Workspace pack: ${payload.packId} (${payload.packName})`);
      write(streams.stdout, `Source priority: --workspace > METRO_WORKSPACE_PACK > session > profiles > config > default (${payload.sources.builtInDefault})`);
      write(streams.stdout, `Next: metro workspace use ${payload.packId === 'generic' ? 'lev' : 'generic'} --write`);
    }
    return 0;
  }

  if (action === 'use') {
    const packId = positional[2] || flags.pack || flags.workspace || null;
    if (!packId || packId === true) {
      write(streams.stderr, 'Usage: metro workspace use <generic|stub> [--write] [--json]');
      return 1;
    }
    try {
      const sessionId = setSessionWorkspacePack(packId);
      let sticky = null;
      if (flags.write === true) {
        sticky = writeStickyWorkspacePack(sessionId, { configDir: flags.dir || null });
      }
      const payload = {
        schemaVersion: 'metro.workspace.use.v1',
        apiAccess: 'none',
        packId: sessionId,
        sticky: Boolean(sticky),
        configPath: sticky?.path || null,
        nextSafeStep: sticky
          ? `Sticky pack ${sessionId} written to ${sticky.path}. Subsequent metro commands use this pack without METRO_WORKSPACE_PACK.`
          : `Session pack set to ${sessionId}. Pass --write to persist in ~/.metro/config.json.`,
      };
      if (flags.json) {
        renderJson(streams.stdout, payload);
      } else {
        write(streams.stdout, payload.nextSafeStep);
      }
      return 0;
    } catch (error) {
      write(streams.stderr, error.message);
      return 1;
    }
  }

  if (action === 'explain') {
    const model = getWorkspaceModel();
    const pack = getQuickstartPackConfig(resolveQuickstartPackId({ workspace: flags.workspace || null }));
    const tenant = flags.sandbox ? 'sandbox' : flags.prod ? 'production' : null;
    const payload = {
      schemaVersion: model.schemaVersion,
      apiAccess: 'none',
      tenant,
      catalogPattern: model.catalogPattern,
      tierRateCards: model.tierRateCards,
      apiTokenConventions: model.apiTokenConventions,
      intents: listIntents(),
      nextCommands: [
        'metro plan list --json',
        'metro route --goal "add charge code SP-FIND" --sandbox --json',
        `metro workspace status --file profiles.json --profile ${pack.profiles.defaultProfile} --check-env --json`,
      ],
      nextSafeStep: 'Use metro plan <intent> (--sandbox|--prod) for the optimal shape and commands for a billing goal.',
    };
    if (flags.json) {
      renderJson(streams.stdout, payload);
    } else {
      const title = 'Metro workspace model (local reference).';
      write(streams.stdout, title);
      write(streams.stdout, model.catalogPattern.summary);
      write(streams.stdout, `Intents: ${model.intentCount}`);
      write(streams.stdout, 'Next: metro plan list');
    }
    return 0;
  }

  if (action === 'status') {
    const model = getWorkspaceModel();
    const binding = flags.file && flags.profile
      ? optionalProfileBinding(flags, streams)
      : null;
    if (binding?.error) return 1;

    const tenant = flags.sandbox ? 'sandbox' : flags.prod ? 'production' : binding?.tenant || null;
    const catalogBindings = tenant
      ? resolveWorkspaceCatalog({
        tenant,
        workspaceCatalog: binding?.workspaceCatalog || null,
      })
      : null;

    const payload = {
      schemaVersion: 'metro.workspace.status.v1',
      apiAccess: 'none',
      workspace: {
        schemaVersion: model.schemaVersion,
        catalogPattern: model.catalogPattern.id,
        intentCount: model.intentCount,
      },
      profile: binding,
      catalogBindings,
      connected: binding ? binding.keyConfigured === true : false,
      nextSafeStep: binding?.keyConfigured
        ? 'Profile key env is set; use metro plan <intent> with matching --sandbox or --prod.'
        : 'Run metro setup template --json and metro setup resolve to bind a tenant profile.',
    };

    if (flags.json) {
      renderJson(streams.stdout, payload);
    } else {
      write(streams.stdout, binding
        ? `Workspace status for profile ${binding.profile} (${binding.tenant}).`
        : 'Workspace model loaded (no profile - pass --file and --profile for connection status).');
      write(streams.stdout, `Catalog pattern: ${model.catalogPattern.id}`);
      if (binding) {
        write(streams.stdout, `Key env ${binding.metronomeKeyEnv}: ${binding.keyConfigured ? 'set' : 'missing'}`);
      }
      write(streams.stdout, `Next: ${payload.nextSafeStep}`);
    }
    return 0;
  }

  write(streams.stderr, `Unknown workspace command: ${action || '(missing)'}`);
  write(streams.stderr, 'Try: metro workspace list|use|current|explain [--json] | metro workspace status --file <profiles.json> --profile <name> [--json]');
  return 1;
}

function runModeCommand(positional, flags, streams) {
  const action = positional[1] || 'show';

  if (action === 'help') {
    write(streams.stderr, 'Usage: metro mode [show] | metro mode set <local-only|read-only|read-write> | metro mode reset');
    write(streams.stderr, 'Sticky ceiling for this machine. Confirmation tokens still required for every write.');
    return 1;
  }

  if (action === 'show' || action === 'get' || action === 'status') {
    const payload = loadOperatorMode();
    if (flags.json) {
      renderJson(streams.stdout, payload);
    } else {
      write(streams.stdout, `Operator mode: ${payload.mode} (source: ${payload.source})`);
      write(streams.stdout, `Live reads: ${payload.allows.liveRead ? 'allowed' : 'blocked'}; live writes: ${payload.allows.liveWrite ? 'allowed' : 'blocked'}`);
      write(streams.stdout, MODE_HELP[payload.mode]);
      write(streams.stdout, `Next: ${payload.nextSafeStep}`);
    }
    return payload.valid === false ? 1 : 0;
  }

  if (action === 'set') {
    const modeArg = positional[2] || flags.mode || null;
    if (!modeArg) {
      write(streams.stderr, `Usage: metro mode set <${OPERATOR_MODES.join('|')}>`);
      return 1;
    }
    try {
      const payload = setOperatorMode(modeArg);
      if (flags.json) {
        renderJson(streams.stdout, payload);
      } else {
        write(streams.stdout, `Operator mode set to ${payload.mode} (saved at ${payload.path})`);
        write(streams.stdout, `Live reads: ${payload.allows.liveRead ? 'allowed' : 'blocked'}; live writes: ${payload.allows.liveWrite ? 'allowed' : 'blocked'}`);
        write(streams.stdout, payload.nextSafeStep);
      }
      return 0;
    } catch (error) {
      write(streams.stderr, error.message);
      return error.code === 'MTR-MODE-INVALID' ? 2 : 1;
    }
  }

  if (action === 'reset') {
    const payload = resetOperatorMode();
    if (flags.json) {
      renderJson(streams.stdout, payload);
    } else {
      write(streams.stdout, `Operator mode reset to default ${payload.mode}`);
      write(streams.stdout, payload.nextSafeStep);
    }
    return 0;
  }

  write(streams.stderr, `Unknown mode command: ${action}`);
  write(streams.stderr, 'Try: metro mode show | metro mode set read-only | metro mode set read-write | metro mode reset');
  return 1;
}

function runStatusCommand(flags, streams) {
  const model = getWorkspaceModel();
  const readiness = apiReadinessCompactSummary();
  const liveReads = listLiveReadEndpointIds();
  const liveWrites = listLiveApplySandboxEndpointIds();
  const operatorMode = loadOperatorMode();

  const profilePath = flags.file
    ? path.resolve(String(flags.file))
    : path.join(defaultMetroConfigDir(), 'profiles.json');

  let auth = null;
  if (flags.file || fs.existsSync(profilePath)) {
    try {
      const config = loadJsonFile(flags.file || profilePath);
      auth = buildSetupAuthCheck(config, {
        profileName: flags.profile || null,
        checkEnv: flags['check-env'] === true,
      });
    } catch (error) {
      auth = {
        schemaVersion: 'metro.setup.auth.v1',
        valid: false,
        error: 'profile-load-failed',
        message: error.message,
        profilePath,
      };
    }
  }

  const keysReady = auth?.summary?.allKeysConfigured === true;
  const payload = {
    schemaVersion: 'metro.status.v1',
    generatedFrom: 'metronome-cli/src/cli.js',
    apiAccess: 'none',
    localOnly: true,
    operatorMode: {
      mode: operatorMode.mode,
      source: operatorMode.source,
      allows: operatorMode.allows,
      path: operatorMode.path,
    },
    workspace: {
      schemaVersion: model.schemaVersion,
      catalogPattern: model.catalogPattern.id,
      intentCount: model.intentCount,
    },
    profilePath: fs.existsSync(profilePath) || flags.file ? profilePath : null,
    auth,
    liveEndpointAllowlist: {
      read: liveReads,
      sandboxApply: liveWrites,
      readCount: liveReads.length,
      sandboxApplyCount: liveWrites.length,
    },
    readiness: {
      readEndpointCount: readiness.readEndpointCount,
      writeEndpointCount: readiness.writeEndpointCount,
      summary: readiness.summary,
      writeSummary: readiness.writeSummary,
      missingEvidence: readiness.missingEvidence,
    },
    connected: keysReady,
    nextCommands: [
      'metro mode set read-only',
      'metro ops who <customer> --prod',
      'metro setup quickstart --shell | zsh',
    ],
    nextSafeStep: !operatorMode.allows.liveRead
      ? 'Mode is local-only. Run metro mode set read-only before live customer lookups.'
      : keysReady
        ? 'Run metro ops who <customer> --prod, or metro mode set read-write before apply.'
        : auth?.valid === false && auth?.error === 'profile-load-failed'
          ? 'Run metro setup init --write to create ~/.metro/profiles.json.'
          : 'Run metro setup init --write, export METRONOME_SANDBOX_KEY, then metro status --check-env --json.',
  };

  if (flags.json) {
    renderJson(streams.stdout, payload);
  } else {
    write(streams.stdout, 'metro status - local command center dashboard.');
    write(streams.stdout, `Operator mode: ${operatorMode.mode} (reads ${operatorMode.allows.liveRead ? 'on' : 'off'}, writes ${operatorMode.allows.liveWrite ? 'on' : 'off'})`);
    write(streams.stdout, `Workspace intents: ${model.intentCount}; catalog: ${model.catalogPattern.id}`);
    write(streams.stdout, `Catalog allowlist: ${liveReads.length} live reads; ${liveWrites.length} sandbox writes`);
    if (auth?.profiles?.length) {
      for (const profile of auth.profiles) {
        const keyState = flags['check-env']
          ? (profile.keyConfigured ? 'set' : 'missing')
          : 'not checked';
        write(streams.stdout, `Profile ${profile.name} (${profile.tenant}): ${profile.metronomeKeyEnv} ${keyState}`);
      }
    } else if (payload.profilePath) {
      write(streams.stdout, `Profile file: ${payload.profilePath} (not loaded - pass --file or create with metro setup init --write)`);
    }
    write(streams.stdout, `Next: ${payload.nextSafeStep}`);
  }

  return auth?.valid === false && auth?.error === 'profile-load-failed' ? 1 : 0;
}

function runInstallDoctorCommand(flags, streams) {
  const payload = buildInstallDoctor();
  if (flags.json) {
    renderJson(streams.stdout, payload);
  } else {
    write(streams.stdout, 'metro install doctor');
    write(streams.stdout, `Healthy: ${payload.healthy ? 'yes' : 'no'}`);
    for (const check of payload.checks) {
      write(streams.stdout, `[${check.status}] ${check.title}: ${check.detail}`);
      if (check.remediation) {
        write(streams.stdout, `  fix: ${check.remediation}`);
      }
    }
    write(streams.stdout, 'Recommended install (one line):');
    write(streams.stdout, payload.recommendedInstall.oneLiner);
    write(streams.stdout, `Next: ${payload.nextSafeStep}`);
  }
  return payload.healthy ? 0 : 1;
}

function runHarnessCommand(positional, flags, streams) {
  const action = positional[1];
  const metroBin = path.join(__dirname, '..', '..', '..', 'bin', 'metro.js');

  if (!action || action === 'help') {
    write(streams.stderr, 'Usage: metro harness list | metro harness run --suite <id> [--execute] [--json] | metro harness intent <intent> (--sandbox|--prod) [--out <dir>] [--execute] [--json] | metro harness read <endpoint> --file <request.json> (--sandbox|--prod) [--execute] [--json] | metro harness apply <endpoint> --file <request.json> [--execute] [--json]');
    return 1;
  }

  const harnessOptions = {
    fixtureRoot: flags['fixture-root'] || flags.fixtureRoot || null,
    tenant: flags.sandbox ? 'sandbox' : flags.prod ? 'production' : 'sandbox',
  };

  if (action === 'list') {
    const payload = listHarnessSuites();
    if (flags.json) {
      renderJson(streams.stdout, payload);
    } else {
      write(streams.stdout, 'Metro harness suites (local-only).');
      for (const suite of payload.suites) {
        write(streams.stdout, `  ${suite.id}\t${suite.title}`);
      }
      write(streams.stdout, `Next: ${payload.nextSafeStep}`);
    }
    return 0;
  }

  if (action === 'run') {
    const suiteId = flags.suite || flags['suite-id'] || 'onboard';
    let plan = buildHarnessPlan(suiteId, harnessOptions);
    if (!plan.valid) {
      if (flags.json) renderJson(streams.stderr, plan);
      else write(streams.stderr, plan.error || 'Harness plan failed.');
      return 1;
    }

    if (flags.execute === true) {
      const execution = executeHarnessSteps(plan.steps, {
        metroBin,
        cwd: process.cwd(),
        env: process.env,
        stopOnFailure: flags['continue-on-failure'] !== true,
      });
      plan = { ...plan, execution };
    }

    if (flags.json) {
      renderJson(streams.stdout, plan);
    } else {
      write(streams.stdout, `Harness suite: ${plan.suite} (${plan.summary.executableStepCount} executable steps)`);
      for (const stepEntry of plan.steps) {
        const marker = stepEntry.status === 'skipped-fixture-missing' ? 'SKIP' : 'PLAN';
        write(streams.stdout, `  [${marker}] ${stepEntry.id}: ${stepEntry.command}`);
      }
      if (plan.execution) {
        write(streams.stdout, `Executed: ${plan.execution.passed} passed, ${plan.execution.failed} failed, ${plan.execution.skipped} skipped`);
      } else {
        write(streams.stdout, `Next: metro harness run --suite ${plan.suite} --execute --json`);
      }
    }
    return plan.execution ? (plan.execution.allRequiredPassed ? 0 : 1) : 0;
  }

  if (action === 'intent') {
    const intentId = positional[2];
    if (!intentId) {
      write(streams.stderr, 'Usage: metro harness intent <intent> (--sandbox|--prod) [--out <dir>] [--execute] [--json]');
      return 1;
    }
    const tenant = resolveTenant(flags, streams, 'Harness intent');
    if (!tenant) return 2;

    const outDir = flags.out || flags.dir || null;
    if (outDir) fs.mkdirSync(path.resolve(String(outDir)), { recursive: true });

    let plan = buildIntentHarnessPlan(intentId, {
      ...harnessOptions,
      tenant,
      outDir,
    });
    if (!plan.valid) {
      if (flags.json) renderJson(streams.stderr, plan);
      else write(streams.stderr, plan.message || plan.error || 'Intent harness failed.');
      return 1;
    }

    if (flags.execute === true) {
      const execution = executeHarnessSteps(plan.steps, {
        metroBin,
        cwd: process.cwd(),
        env: process.env,
      });
      plan = { ...plan, execution };
    }

    if (flags.json) {
      renderJson(streams.stdout, plan);
    } else {
      write(streams.stdout, `Intent harness: ${plan.intentId} (${plan.recommendedShape})`);
      for (const stepEntry of plan.steps) {
        write(streams.stdout, `  ${stepEntry.id}: ${stepEntry.command}`);
      }
      write(streams.stdout, `Next: ${plan.nextSafeStep}`);
    }
    return plan.execution ? (plan.execution.allRequiredPassed ? 0 : 1) : 0;
  }

  if (action === 'read') {
    const endpointId = positional[2];
    if (!endpointId || !flags.file) {
      write(streams.stderr, 'Usage: metro harness read <endpoint-id> --file <request.json> (--sandbox|--prod) [--execute] [--json]');
      return 1;
    }
    const tenant = resolveTenant(flags, streams, 'Harness read');
    if (!tenant) return 2;

    let plan = buildReadHarnessPlan(endpointId, {
      ...harnessOptions,
      tenant,
      requestFile: flags.file,
    });
    if (!plan.valid) {
      if (flags.json) renderJson(streams.stderr, plan);
      else write(streams.stderr, plan.error || 'Read harness failed.');
      return 1;
    }

    if (flags.execute === true) {
      const execution = executeHarnessSteps(plan.steps, {
        metroBin,
        cwd: process.cwd(),
        env: process.env,
      });
      plan = { ...plan, execution };
    }

    if (flags.json) renderJson(streams.stdout, plan);
    else {
      write(streams.stdout, `Read harness: ${endpointId} (live=${plan.liveReadSupported})`);
      write(streams.stdout, plan.nextSafeStep);
    }
    return plan.execution ? (plan.execution.allRequiredPassed ? 0 : 1) : 0;
  }

  if (action === 'apply') {
    const endpointId = positional[2];
    if (!endpointId || !flags.file) {
      write(streams.stderr, 'Usage: metro harness apply <endpoint-id> --file <request.json> [--execute] [--json]');
      return 1;
    }

    let plan = buildApplyHarnessPlan(endpointId, {
      ...harnessOptions,
      requestFile: flags.file,
    });
    if (!plan.valid) {
      if (flags.json) renderJson(streams.stderr, plan);
      else write(streams.stderr, plan.error || 'Apply harness failed.');
      return 1;
    }

    if (flags.execute === true) {
      const execution = executeHarnessSteps(plan.steps, {
        metroBin,
        cwd: process.cwd(),
        env: process.env,
      });
      plan = { ...plan, execution };
    }

    if (flags.json) renderJson(streams.stdout, plan);
    else {
      write(streams.stdout, `Apply harness: ${endpointId} (live=${plan.liveWriteSupported})`);
      write(streams.stdout, plan.nextSafeStep);
    }
    return plan.execution ? (plan.execution.allRequiredPassed ? 0 : 1) : 0;
  }

  write(streams.stderr, `Unknown harness command: ${action}`);
  return 1;
}

function runPlanCommand(positional, flags, streams) {
  const intentId = positional[1];

  if (!intentId || intentId === 'help') {
    write(streams.stderr, 'Usage: metro plan list | metro plan template <intent> | metro plan <intent> (--sandbox|--prod) [--json]');
    return 1;
  }

  if (intentId === 'list') {
    const payload = {
      schemaVersion: 'metro.workspace.plan.list.v1',
      apiAccess: 'none',
      intents: listIntents(),
      nextSafeStep: 'metro plan <intent> (--sandbox|--prod) --json',
    };
    if (flags.json) {
      renderJson(streams.stdout, payload);
    } else {
      write(streams.stdout, 'Workspace plan intents:');
      for (const intent of payload.intents) {
        write(streams.stdout, `  ${intent.id} - ${intent.title}`);
      }
    }
    return 0;
  }

  if (intentId === 'template') {
    const templateIntentId = positional[2];
    if (!templateIntentId) {
      write(streams.stderr, 'Usage: metro plan template <intent> (--sandbox|--prod) [--out <out.json>] [--json]');
      return 1;
    }

    const tenant = resolveTenant(flags, streams, 'Plan template');
    if (!tenant) return 2;

    const profileBinding = optionalProfileBinding(flags, streams);
    if (profileBinding?.error) return 1;

    const templatePayload = buildPlanInputTemplate(templateIntentId, {
      tenant,
      token: flags.token,
      actionCode: flags['action-code'] || flags.actionCode,
      displayName: flags['display-name'] || flags.displayName,
      price: flags.price,
      creditGrantMode: flags['credit-grant-mode'] || flags.creditGrantMode,
      annualCreditsTotal: flags['annual-credits-total'] || flags.annualCreditsTotal,
      profileResolution: profileBinding,
      workspaceCatalog: profileBinding?.workspaceCatalog || null,
    });

    const outPath = flags.out || flags['output-file'] || null;
    if (outPath) {
      if (!templatePayload.valid) {
        if (flags.json) renderJson(streams.stderr, templatePayload);
        else write(streams.stderr, templatePayload.message || 'Template generation failed.');
        return 1;
      }
      const resolvedOut = path.resolve(String(outPath));
      fs.writeFileSync(resolvedOut, `${JSON.stringify(templatePayload.inputTemplate, null, 2)}\n`, 'utf8');
      if (flags.json) {
        renderJson(streams.stdout, {
          ...templatePayload,
          writtenTo: resolvedOut,
        });
      } else {
        write(streams.stdout, `Wrote ${templatePayload.intentId} inputTemplate to ${resolvedOut}`);
        if (templatePayload.validateCommand) write(streams.stdout, `Next: ${templatePayload.validateCommand.replace('<input.json>', resolvedOut)}`);
      }
      return 0;
    }

    if (flags.json) {
      renderJson(streams.stdout, templatePayload);
    } else if (!templatePayload.valid) {
      write(streams.stderr, templatePayload.message || 'Template generation failed.');
      for (const command of templatePayload.nextCommands || []) write(streams.stderr, `  ${command}`);
    } else {
      write(streams.stdout, `# ${templatePayload.intentId} inputTemplate (${templatePayload.tenant})`);
      write(streams.stdout, JSON.stringify(templatePayload.inputTemplate, null, 2));
      if (templatePayload.validateCommand) {
        write(streams.stdout, '');
        write(streams.stdout, `Next: ${templatePayload.validateCommand}`);
      }
    }
    return templatePayload.valid ? 0 : 1;
  }

  const tenant = resolveTenant(flags, streams, 'Plan');
  if (!tenant) return 2;

  const profileBinding = optionalProfileBinding(flags, streams);
  if (profileBinding?.error) return 1;

  const planConfigDir = flags.dir && flags.dir !== true
    ? path.resolve(String(flags.dir))
    : snapshotConfigDir();
  const planSnapshot = readSnapshot(tenant, { configDir: planConfigDir });
  const planClassification = planSnapshot
    ? (planSnapshot.classification || classifyAccount(planSnapshot))
    : null;

  const plan = buildWorkspacePlan(intentId, {
    tenant,
    goal: flags.goal || flags.query,
    token: flags.token,
    actionCode: flags['action-code'] || flags.actionCode,
    displayName: flags['display-name'] || flags.displayName,
    name: flags.name && flags.name !== true ? String(flags.name) : null,
    aggregation: flags.aggregation && flags.aggregation !== true ? String(flags.aggregation) : null,
    eventType: flags['event-type'] || flags.eventType || null,
    dimensionKey: flags['dimension-key'] || flags.dimensionKey || null,
    price: flags.price,
    creditGrantMode: flags['credit-grant-mode'] || flags.creditGrantMode,
    annualCreditsTotal: flags['annual-credits-total'] || flags.annualCreditsTotal,
    profileResolution: profileBinding,
    workspaceCatalog: profileBinding?.workspaceCatalog || null,
    accountPattern: planClassification?.pattern || null,
  });

  if (flags.json) {
    renderJson(streams.stdout, plan);
  } else if (!plan.valid) {
    write(streams.stderr, plan.message || 'Plan failed.');
    if (plan.nextCommands) {
      for (const command of plan.nextCommands) write(streams.stderr, `  ${command}`);
    }
  } else {
    write(streams.stdout, plan.intent.title);
    write(streams.stdout, `Tenant: ${plan.tenant}`);
    write(streams.stdout, `Optimal shape: ${plan.recommendation.recommendedShape || '(read-only ops)'}`);
    if (plan.recommendation.catalogMode) {
      write(streams.stdout, `Catalog mode: ${plan.recommendation.catalogMode}`);
    }
    write(streams.stdout, plan.recommendation.optimalPathSummary);
    if (plan.willNotDo?.length) {
      write(streams.stdout, '');
      write(streams.stdout, 'Will NOT:');
      for (const line of plan.willNotDo) write(streams.stdout, `  - ${line}`);
    }
    if (plan.rejectedPaths?.length) {
      write(streams.stdout, '');
      write(streams.stdout, 'Rejected paths:');
      for (const rejected of plan.rejectedPaths) {
        write(streams.stdout, `  - ${rejected.endpointId}: ${rejected.reason}`);
      }
    }
    write(streams.stdout, '');
    write(streams.stdout, `Next: ${plan.nextSafeStep}`);
  }

  return plan.valid ? 0 : 1;
}

function runRouteCommand(flags, streams) {
  const goal = flags.goal || flags.query;
  const endpointId = flags.api || flags.endpoint;

  if (!goal && !endpointId) {
    write(streams.stderr, 'route requires --goal "<billing goal>" and/or --api <endpoint-id>');
    return 1;
  }

  let tenant = null;
  if (flags.sandbox) tenant = 'sandbox';
  if (flags.prod) tenant = 'production';
  if (flags.sandbox && flags.prod) {
    write(streams.stderr, 'Choose at most one tenant: --sandbox or --prod.');
    return 1;
  }

  const profileBinding = optionalProfileBinding(flags, streams);
  const workspaceCatalog = profileBinding?.workspaceCatalog || null;
  const configDir = flags.dir && flags.dir !== true
    ? path.resolve(String(flags.dir))
    : snapshotConfigDir();
  const snapshot = tenant ? readSnapshot(tenant, { configDir }) : null;
  const classification = snapshot
    ? (snapshot.classification || classifyAccount(snapshot))
    : null;

  let routed = routeWorkspaceRequest({
    tenant,
    goal,
    endpointId,
    actionCode: flags['action-code'] || flags.actionCode,
    displayName: flags['display-name'] || flags.displayName,
    price: flags.price,
    token: flags.token,
    workspaceCatalog,
    accountPattern: classification?.pattern || null,
  });

  const promoteCodebase = detectPromoteOpportunity({
    hasSnapshot: Boolean(snapshot),
    accountPattern: classification?.pattern || null,
    routed,
    goal,
  });

  if (tenant && typeof enrichRouteResult === 'function') {
    routed = enrichRouteResult(routed, {
      classification,
      snapshotMeta: snapshot
        ? { path: snapshotPath(tenant, configDir), capturedAt: snapshot.capturedAt }
        : null,
      promoteCodebase,
    });
  } else if (promoteCodebase) {
    routed = { ...routed, promoteCodebase };
  }

  if (flags.json) {
    renderJson(streams.stdout, routed);
  } else if (routed.refused) {
    write(streams.stderr, `Refused: ${endpointId}`);
    write(streams.stderr, routed.reason);
    write(streams.stderr, `Use instead: metro plan ${routed.recommendedIntent}${tenant === 'sandbox' ? ' --sandbox' : tenant === 'production' ? ' --prod' : ''}`);
    if (routed.promoteCodebase?.signal) {
      write(streams.stderr, '');
      write(streams.stderr, `This can be faster. ${routed.promoteCodebase.suggestedPrTitle}`);
      write(streams.stderr, `Faster path: ${routed.promoteCodebase.fasterPath}`);
      write(streams.stderr, 'Draft a PR so the next agent does not hit this refusal. See agents.md#promote-the-codebase');
    }
  } else if (!routed.valid) {
    write(streams.stderr, routed.message || 'No route matched.');
    if (routed.promoteCodebase?.signal) {
      write(streams.stderr, `This can be faster → ${routed.promoteCodebase.suggestedPrTitle}`);
      write(streams.stderr, `Faster path: ${routed.promoteCodebase.fasterPath}`);
    }
  } else {
    write(streams.stdout, `Intent: ${routed.intentId}${routed.match ? ` (confidence ${routed.match.confidence})` : ''}`);
    write(streams.stdout, `Shape: ${routed.recommendedShape || '(see plan)'}`);
    if (routed.accountPattern) {
      write(streams.stdout, `Account pattern: ${routed.accountPattern}`);
    }
    if (routed.oneShotSummary) {
      write(streams.stdout, `Summary: ${routed.oneShotSummary}`);
    }
    write(streams.stdout, `Next: ${routed.nextSafeStep}`);
    if (routed.promoteCodebase?.signal) {
      write(streams.stdout, '');
      write(streams.stdout, `This can be faster. Suggested PR: ${routed.promoteCodebase.suggestedPrTitle}`);
      write(streams.stdout, `Faster path: ${routed.promoteCodebase.fasterPath}`);
    }
  }

  return routed.refused ? 2 : routed.valid ? 0 : 1;
}

function runSourceBoundaryCommand(positional, flags, streams) {
  const action = positional[1];

  if (action === 'template') {
    const template = buildSourceBoundaryTemplate({
      workflow: flags.workflow || '<workflow>',
      shape: flags.shape || '<shape>',
    });
    if (flags.json) {
      renderJson(streams.stdout, template);
    } else {
      write(streams.stdout, `Source-boundary template for ${template.workflow} ${template.shape}`);
      write(streams.stdout, `Required reviewed docs: ${template.requiredReviewedDocs.join(', ')}`);
      write(streams.stdout, 'Generated artifacts are evidence-only; one-off scripts must not be command handlers.');
    }
    return 0;
  }

  if (action === 'validate') {
    if (!flags.file) {
      write(streams.stderr, 'source-boundary validate requires --file <source-boundary.json>');
      return 1;
    }
    let input;
    try {
      input = loadJsonFile(flags.file);
    } catch (error) {
      write(streams.stderr, `Failed to read source-boundary JSON/YAML: ${error.message}`);
      return 1;
    }

    const result = validateSourceBoundary(input);
    if (flags.json) {
      renderJson(streams.stdout, result);
    } else if (result.valid) {
      write(streams.stdout, `Source-boundary validation passed for ${result.workflow || '(workflow)'} ${result.shape || '(shape)'}.`);
    } else {
      write(streams.stdout, 'Source-boundary validation failed:');
      for (const finding of result.findings) {
        write(streams.stdout, `- ${finding.id} [${finding.severity}] ${finding.message}`);
      }
    }
    return result.valid ? 0 : 1;
  }

  write(streams.stderr, `Unknown source-boundary command: ${action || '(missing)'}`);
  return 1;
}

function runReleaseCommand(positional, flags, streams) {
  const action = positional[1];
  if (action === 'readiness') {
    const payload = buildReleaseReadiness();
    if (flags.json) {
      renderJson(streams.stdout, payload);
    } else {
      write(streams.stdout, 'Metronome CLI release readiness');
      write(streams.stdout, `Package: ${payload.package.name}@${payload.package.version}`);
      write(streams.stdout, `API access: ${payload.apiAccess}`);
      write(streams.stdout, `Live execution enabled: ${payload.liveExecution.enabledInCurrentCli ? 'yes' : 'no'}`);
      write(streams.stdout, `Publish ready: ${payload.publish.readyForPublish ? 'yes' : 'no'}`);
      write(streams.stdout, `Private package: ${payload.package.private ? 'yes' : 'no'}`);
      write(streams.stdout, 'Blocking evidence:');
      for (const blocker of payload.blockers) {
        write(streams.stdout, `- ${blocker.blockerId}: ${blocker.title} (${blocker.status})`);
      }
      write(streams.stdout, `Next safe step: ${payload.nextSafeStep}`);
    }
    return 0;
  }

  if (action === 'artifact-manifest') {
    const payload = buildReleaseArtifactManifest();
    if (flags.json) {
      renderJson(streams.stdout, payload);
    } else {
      write(streams.stdout, 'Metronome CLI release artifact manifest');
      write(streams.stdout, `Package: ${payload.package.name}@${payload.package.version}`);
      write(streams.stdout, `API access: ${payload.apiAccess}`);
      write(streams.stdout, `Writes files: ${payload.writesFiles ? 'yes' : 'no'}`);
      write(streams.stdout, `Recommended artifacts: ${payload.recommendedArtifacts.length}`);
      write(streams.stdout, 'Required artifacts:');
      for (const artifact of payload.recommendedArtifacts.filter((item) => item.required)) {
        write(streams.stdout, `- ${artifact.filename}: ${artifact.sourceCommand}`);
      }
      write(streams.stdout, `Next safe step: ${payload.nextSafeStep}`);
    }
    return 0;
  }

  if (action === 'evidence-plan') {
    const policyFile = flags.policy || flags.file;
    if (!policyFile || policyFile === true) {
      write(streams.stderr, 'release evidence-plan requires --policy <policy.json|yaml>');
      return 1;
    }
    let policy;
    try {
      policy = loadJsonFile(policyFile);
    } catch (error) {
      write(streams.stderr, `Failed to read release evidence policy: ${error.message}`);
      return 1;
    }
    const payload = buildReleaseEvidencePlan(policy);
    if (flags.json) {
      renderJson(streams.stdout, payload);
    } else {
      write(streams.stdout, 'Metronome CLI release evidence plan');
      write(streams.stdout, `Policy: ${payload.policy.policyId || '(missing)'}`);
      write(streams.stdout, `Artifact directory: ${payload.policy.artifactDirectory || '(missing)'}`);
      write(streams.stdout, `API access: ${payload.apiAccess}`);
      write(streams.stdout, `Writes files: ${payload.writesFiles ? 'yes' : 'no'}`);
      write(streams.stdout, `Plan valid: ${payload.valid ? 'yes' : 'no'}`);
      write(streams.stdout, `Planned artifacts: ${payload.summary.plannedArtifactCount}`);
      if (!payload.valid) {
        write(streams.stdout, 'Findings:');
        for (const finding of payload.findings) {
          write(streams.stdout, `- ${finding.findingId}: ${finding.message}`);
        }
      }
      write(streams.stdout, `Next safe step: ${payload.nextSafeStep}`);
    }
    return payload.valid ? 0 : 1;
  }

  if (action === 'evidence-check') {
    if (!flags.dir || flags.dir === true) {
      write(streams.stderr, 'release evidence-check requires --dir <artifact-directory>');
      return 1;
    }
    const payload = checkReleaseEvidenceDirectory(flags.dir);
    if (flags.json) {
      renderJson(streams.stdout, payload);
    } else {
      write(streams.stdout, 'Metronome CLI release evidence check');
      write(streams.stdout, `Directory: ${payload.directory.input}`);
      write(streams.stdout, `API access: ${payload.apiAccess}`);
      write(streams.stdout, `Writes files: ${payload.writesFiles ? 'yes' : 'no'}`);
      write(streams.stdout, `Required artifacts passing: ${payload.summary.validRequiredArtifactCount}/${payload.summary.requiredArtifactCount}`);
      write(streams.stdout, `Evidence valid: ${payload.valid ? 'yes' : 'no'}`);
      if (!payload.valid) {
        write(streams.stdout, 'Findings:');
        for (const finding of payload.findings) {
          write(streams.stdout, `- ${finding.findingId}: ${finding.message}`);
        }
        if (payload.recoveryCommands.length > 0) {
          write(streams.stdout, 'Recovery commands:');
          for (const command of payload.recoveryCommands) {
            write(streams.stdout, `- ${command.filename}: ${command.sourceCommand}`);
          }
        }
      }
      write(streams.stdout, `Next safe step: ${payload.nextSafeStep}`);
    }
    return payload.valid ? 0 : 1;
  }

  if (action === 'retention-policy') {
    const subaction = positional[2];
    if (subaction === 'template') {
      const payload = buildReleaseRetentionPolicyTemplate();
      if (flags.json) {
        renderJson(streams.stdout, payload);
      } else {
        write(streams.stdout, 'Metronome CLI release retention policy template');
        write(streams.stdout, `API access: ${payload.apiAccess}`);
        write(streams.stdout, `Writes files: ${payload.writesFiles ? 'yes' : 'no'}`);
        write(streams.stdout, `Required artifacts: ${payload.requiredArtifactFilenames.length}`);
        write(streams.stdout, `Retained validation artifacts: ${payload.retainedValidationArtifactFilenames.length}`);
        write(streams.stdout, `Next safe step: ${payload.nextSafeStep}`);
      }
      return 0;
    }

    if (subaction === 'validate') {
      if (!flags.file || flags.file === true) {
        write(streams.stderr, 'release retention-policy validate requires --file <policy.json|yaml>');
        return 1;
      }
      let policy;
      try {
        policy = loadJsonFile(flags.file);
      } catch (error) {
        write(streams.stderr, `Failed to read release retention policy: ${error.message}`);
        return 1;
      }
      const payload = validateReleaseRetentionPolicy(policy);
      if (flags.json) {
        renderJson(streams.stdout, payload);
      } else {
        write(streams.stdout, 'Metronome CLI release retention policy validation');
        write(streams.stdout, `Policy: ${payload.policyId || '(missing)'}`);
        write(streams.stdout, `Artifact directory: ${payload.artifactDirectory || '(missing)'}`);
        write(streams.stdout, `API access: ${payload.apiAccess}`);
        write(streams.stdout, `Writes files: ${payload.writesFiles ? 'yes' : 'no'}`);
        write(streams.stdout, `Policy valid: ${payload.valid ? 'yes' : 'no'}`);
        if (!payload.valid) {
          write(streams.stdout, 'Findings:');
          for (const finding of payload.findings) {
            write(streams.stdout, `- ${finding.findingId}: ${finding.message}`);
          }
        }
        write(streams.stdout, `Next safe step: ${payload.nextSafeStep}`);
      }
      return payload.valid ? 0 : 1;
    }

    write(streams.stderr, `Unknown release retention-policy command: ${subaction || '(missing)'}`);
    return 1;
  }

  write(streams.stderr, `Unknown release command: ${action || '(missing)'}`);
  return 1;
}

function runApiCommand(positional, flags, streams) {
  if (positional[0] !== 'api') return null;

  const action = positional[1];
  if (action === 'catalog') {
    const payload = apiCatalog({ family: flags.family || null });
    if (flags.family && payload.endpointCount === 0) {
      write(streams.stderr, `Unknown API endpoint family: ${flags.family}`);
      return 1;
    }
    if (flags.json) {
      renderJson(streams.stdout, payload);
    } else {
      write(streams.stdout, 'Metronome API endpoint catalog (local-only)');
      write(streams.stdout, `API access: ${payload.apiAccess}`);
      write(streams.stdout, `Live execution enabled: ${payload.liveExecution.enabledInCurrentCli ? 'yes' : 'no'}`);
      for (const endpoint of payload.endpoints) {
        write(streams.stdout, `${endpoint.id}\t${endpoint.method} ${endpoint.path}\t${endpoint.supportStatus}`);
      }
    }
    return 0;
  }

  if (action === 'explain') {
    const endpointId = positional[2];
    const payload = apiEndpointDetail(endpointId);
    if (!payload) {
      write(streams.stderr, `Unknown API endpoint: ${endpointId || '(missing)'}`);
      return 1;
    }
    if (flags.json) {
      renderJson(streams.stdout, payload);
    } else {
      const endpoint = payload.endpoint;
      write(streams.stdout, `${endpoint.title} (${endpoint.id})`);
      write(streams.stdout, `Endpoint: ${endpoint.method} ${endpoint.path}`);
      write(streams.stdout, `Operation: ${endpoint.operationType}`);
      write(streams.stdout, `Support: ${endpoint.supportStatus}`);
      write(streams.stdout, `Current CLI API access: ${endpoint.apiAccessInCurrentCli}`);
      write(streams.stdout, `Permission scope: ${endpoint.permissionScope}`);
      write(streams.stdout, `Policy gates: ${endpoint.policyGates.join(', ')}`);
    }
    return 0;
  }

  if (action === 'search') {
    const query = flags.query || positional.slice(2).join(' ');
    if (!String(query || '').trim()) {
      write(streams.stderr, 'api search requires a query, either as positional words or --query <text>.');
      return 1;
    }
    const payload = apiEndpointSearch({ query, family: flags.family || null });
    if (flags.family && !payload.filters.familyKnown) {
      write(streams.stderr, `Unknown API endpoint family: ${flags.family}`);
      return 1;
    }
    if (flags.json) {
      renderJson(streams.stdout, payload);
    } else {
      write(streams.stdout, 'Metronome API search (local-only)');
      write(streams.stdout, `Query: ${payload.filters.query}`);
      write(streams.stdout, `API access: ${payload.apiAccess}`);
      write(streams.stdout, `Live execution enabled: ${payload.liveExecution.enabledInCurrentCli ? 'yes' : 'no'}`);
      write(streams.stdout, `Results: ${payload.resultCount}`);
      for (const result of payload.results) {
        write(streams.stdout, `${result.endpointId}\t${result.method} ${result.path}\t${result.operationType}\t${result.supportStatus}`);
      }
    }
    return 0;
  }

  if (action === 'diff') {
    const leftId = positional[2];
    const rightId = positional[3];
    if (!leftId || !rightId) {
      write(streams.stderr, 'api diff requires <left-endpoint-id> <right-endpoint-id>');
      return 1;
    }
    const payload = apiEndpointDiff(leftId, rightId);
    if (!payload) {
      const unknown = [
        apiEndpointDetail(leftId) ? null : leftId,
        apiEndpointDetail(rightId) ? null : rightId,
      ].filter(Boolean).join(', ');
      write(streams.stderr, `Unknown API endpoint for diff: ${unknown}`);
      return 1;
    }
    if (flags.json) {
      renderJson(streams.stdout, payload);
    } else {
      write(streams.stdout, 'Metronome API endpoint diff (local-only)');
      write(streams.stdout, `Left: ${payload.endpoints.left.id} (${payload.endpoints.left.method} ${payload.endpoints.left.path})`);
      write(streams.stdout, `Right: ${payload.endpoints.right.id} (${payload.endpoints.right.method} ${payload.endpoints.right.path})`);
      write(streams.stdout, `API access: ${payload.apiAccess}`);
      write(streams.stdout, `Live execution enabled: ${payload.liveExecution.enabledInCurrentCli ? 'yes' : 'no'}`);
      write(streams.stdout, `Differences: ${payload.summary.differenceCount}`);
      for (const difference of payload.differences) {
        write(streams.stdout, `- ${difference.field}: ${difference.same ? 'same' : 'different'}`);
      }
    }
    return 0;
  }

  if (action === 'export') {
    const payload = buildApiExportBundle({ family: flags.family || null });
    if (!payload) {
      write(streams.stderr, `Unknown API endpoint family: ${flags.family}`);
      return 1;
    }
    if (flags.json) {
      renderJson(streams.stdout, payload);
    } else {
      write(streams.stdout, 'Metronome API export bundle (local-only)');
      write(streams.stdout, `API access: ${payload.apiAccess}`);
      write(streams.stdout, `Live execution enabled: ${payload.liveExecution.enabledInCurrentCli ? 'yes' : 'no'}`);
      write(streams.stdout, `Endpoint docs: ${payload.summary.endpointCount}`);
      write(streams.stdout, `Commands: ${payload.summary.commandCount}`);
      write(streams.stdout, `Shapes: ${payload.summary.shapeCount}`);
      write(streams.stdout, `Validator rules: ${payload.summary.validatorRuleCount}`);
      write(streams.stdout, `Gotchas: ${payload.summary.gotchaCount}`);
      write(streams.stdout, `Examples: ${payload.summary.exampleCount}`);
      write(streams.stdout, 'Run with --json for the full source-linked export.');
    }
    return 0;
  }

  if (action === 'scopes') {
    const payload = permissionScopeReference({ family: flags.family || null });
    if (flags.json) {
      renderJson(streams.stdout, payload);
    } else {
      write(streams.stdout, 'Metronome API permission scopes (local-only)');
      write(streams.stdout, `API access: ${payload.apiAccess}`);
      write(streams.stdout, `Live execution enabled: ${payload.liveExecution.enabledInCurrentCli ? 'yes' : 'no'}`);
      for (const scope of payload.scopes) {
        write(streams.stdout, `${scope.scope}\t${scope.accessClass}\t${scope.endpointCount} endpoint(s)\t${scope.liveCommandStatus}`);
      }
    }
    return 0;
  }

  if (action === 'approvals') {
    const payload = approvalPolicyReference({ family: flags.family || null });
    if (flags.json) {
      renderJson(streams.stdout, payload);
    } else {
      write(streams.stdout, 'Metronome API approval policies (local-only)');
      write(streams.stdout, `API access: ${payload.apiAccess}`);
      write(streams.stdout, `Live execution enabled: ${payload.liveExecution.enabledInCurrentCli ? 'yes' : 'no'}`);
      for (const policy of payload.policies) {
        write(streams.stdout, `${policy.scope}\t${policy.approvalTier}\t${policy.accountableOwnerRole}\t${policy.liveCommandStatus}`);
      }
    }
    return 0;
  }

  if (action === 'readiness') {
    const payload = flags.summary
      ? apiReadinessCompactSummary({ family: flags.family || null })
      : apiReadinessSummary({ family: flags.family || null });
    if (flags.family && payload.catalogEndpointCount === 0) {
      write(streams.stderr, `Unknown API endpoint family: ${flags.family}`);
      return 1;
    }
    if (flags.json) {
      renderJson(streams.stdout, payload);
    } else if (flags.summary) {
      write(streams.stdout, 'Metronome API readiness summary (local-only)');
      write(streams.stdout, `API access: ${payload.apiAccess}`);
      write(streams.stdout, `Live read enabled: ${payload.summary.liveReadEnabledInCurrentCli ? 'yes' : 'no'}`);
      write(streams.stdout, `Live write enabled: ${payload.writeSummary.liveWriteEnabledInCurrentCli ? 'yes' : 'no'}`);
      write(streams.stdout, `Read endpoints: ${payload.readEndpointCount}`);
      write(streams.stdout, `Read endpoints with missing evidence: ${payload.missingEvidence.readEndpointCount}`);
      write(streams.stdout, `Write endpoints: ${payload.writeEndpointCount}`);
      write(streams.stdout, `Write endpoints with missing evidence: ${payload.missingEvidence.writeEndpointCount}`);
      write(streams.stdout, `Full report: ${payload.fullReportCommand}`);
    } else {
      write(streams.stdout, 'Metronome API read endpoint readiness (local-only)');
      write(streams.stdout, `API access: ${payload.apiAccess}`);
      write(streams.stdout, `Live read enabled: ${payload.summary.liveReadEnabledInCurrentCli ? 'yes' : 'no'}`);
      write(streams.stdout, `Read endpoints: ${payload.readEndpointCount}`);
      write(streams.stdout, `Golden-covered endpoints: ${payload.summary.goldenCoveredEndpoints}`);
      for (const endpoint of payload.endpoints) {
        write(streams.stdout, `${endpoint.endpointId}\tvalidator=${endpoint.requestValidator.status}\tread-plan=${endpoint.localReadPlan.status}\tgolden=${endpoint.goldenOutput.covered ? 'yes' : 'no'}`);
      }
    }
    return 0;
  }

  if (action === 'validate') {
    const endpointId = positional[2];
    if (!endpointId) {
      write(streams.stderr, 'api validate requires <endpoint-id>');
      return 1;
    }
    if (!flags.file) {
      write(streams.stderr, 'api validate requires --file <request.json|yaml>');
      return 1;
    }
    let input;
    try {
      input = loadJsonFile(flags.file);
    } catch (error) {
      write(streams.stderr, `Failed to read API request JSON/YAML: ${error.message}`);
      return 1;
    }

    const result = validateApiEndpointRequest(endpointId, input);
    if (!result) {
      write(streams.stderr, `Unknown API endpoint: ${endpointId}`);
      return 1;
    }
    if (flags.json) {
      renderJson(streams.stdout, result);
    } else if (result.valid) {
      write(streams.stdout, `API request validation passed for ${endpointId}.`);
      write(streams.stdout, `Live execution enabled: ${result.liveExecution.enabledInCurrentCli ? 'yes' : 'no'}`);
    } else {
      write(streams.stdout, `API request validation failed for ${endpointId}:`);
      for (const finding of result.findings) {
        write(streams.stdout, `- ${finding.id} [${finding.severity}] ${finding.message}`);
      }
    }
    return result.valid ? 0 : 1;
  }

  if (action === 'preview') {
    const endpointId = positional[2];
    if (!endpointId) {
      write(streams.stderr, 'api preview requires <endpoint-id>');
      return 1;
    }
    const tenant = resolveTenant(flags, streams, 'API preview');
    if (!tenant) return 2;
    if (!flags.file) {
      write(streams.stderr, 'api preview requires --file <request.json|yaml>');
      return 1;
    }
    let input;
    try {
      input = loadJsonFile(flags.file);
    } catch (error) {
      write(streams.stderr, `Failed to read API request JSON/YAML: ${error.message}`);
      return 1;
    }

    const preview = buildApiEndpointPreview(endpointId, input, { tenant });
    if (!preview) {
      write(streams.stderr, `Unknown API endpoint: ${endpointId}`);
      return 1;
    }
    if (flags.json) {
      renderJson(streams.stdout, preview);
    } else if (preview.blocked) {
      write(streams.stdout, `API preview blocked for ${endpointId}: ${preview.blockReason}`);
      for (const finding of preview.validation?.findings || []) {
        write(streams.stdout, `- ${finding.id} [${finding.severity}] ${finding.message}`);
      }
    } else {
      write(streams.stdout, `API preview built for ${endpointId} on ${tenant}.`);
      write(streams.stdout, `Payload hash: ${preview.payloadHash}`);
      write(streams.stdout, `Live execution enabled: ${preview.liveExecution.enabledInCurrentCli ? 'yes' : 'no'}`);
      write(streams.stdout, `Apply supported: ${preview.applySupported ? 'yes' : 'no'}`);
    }
    return preview.blocked ? 1 : 0;
  }

  if (action === 'read-plan') {
    const endpointId = positional[2];
    if (!endpointId) {
      write(streams.stderr, 'api read-plan requires <endpoint-id>');
      return 1;
    }
    const tenant = resolveTenant(flags, streams, 'API read-plan');
    if (!tenant) return 2;
    if (!flags.file) {
      write(streams.stderr, 'api read-plan requires --file <request.json|yaml>');
      return 1;
    }
    let input;
    try {
      input = loadJsonFile(flags.file);
    } catch (error) {
      write(streams.stderr, `Failed to read API read request JSON/YAML: ${error.message}`);
      return 1;
    }

    const plan = buildApiEndpointReadPlan(endpointId, input, { tenant });
    if (!plan) {
      write(streams.stderr, `Unknown API endpoint: ${endpointId}`);
      return 1;
    }
    if (flags.json) {
      renderJson(streams.stdout, plan);
    } else if (plan.blocked) {
      write(streams.stdout, `API read-plan blocked for ${endpointId}: ${plan.blockReason}`);
      for (const finding of plan.validation?.findings || []) {
        write(streams.stdout, `- ${finding.id} [${finding.severity}] ${finding.message}`);
      }
    } else {
      write(streams.stdout, `API read-plan built for ${endpointId} on ${tenant}.`);
      write(streams.stdout, `Request hash: ${plan.requestSummary.requestHash}`);
      write(streams.stdout, `Live read enabled: ${plan.liveExecution.enabledInCurrentCli ? 'yes' : 'no'}`);
      write(streams.stdout, `Future confirm-live-read required: ${plan.requiredLiveReadGate.confirmLiveReadToken.required ? 'yes' : 'no'}`);
    }
    return plan.blocked ? 1 : 0;
  }

  if (action === 'read-preflight') {
    const endpointId = positional[2];
    if (!endpointId) {
      write(streams.stderr, 'api read-preflight requires <endpoint-id>');
      return 1;
    }
    const tenant = resolveTenant(flags, streams, 'API read-preflight');
    if (!tenant) return 2;
    if (!flags.file) {
      write(streams.stderr, 'api read-preflight requires --file <request.json|yaml>');
      return 1;
    }

    let requestInput = null;
    let requestLoadError = null;
    let readGate = null;
    let readGateLoadError = null;
    let readGateRootDir = process.cwd();

    try {
      requestInput = loadJsonFile(flags.file);
    } catch (error) {
      requestLoadError = error.message;
    }

    if (flags['read-gate']) {
      try {
        const resolvedReadGate = path.resolve(flags['read-gate']);
        readGateRootDir = path.dirname(resolvedReadGate);
        readGate = loadJsonFile(resolvedReadGate);
      } catch (error) {
        readGateLoadError = error.message;
      }
    }

    const preflight = buildApiReadPreflight({
      endpointId,
      tenant,
      tenantFlags: {
        sandbox: flags.sandbox === true,
        prod: flags.prod === true,
      },
      requestInput,
      requestLoadError,
      requestFileProvided: Boolean(flags.file),
      readGate,
      readGateLoadError,
      readGateFileProvided: Boolean(flags['read-gate']),
      readGateRootDir,
      confirmLiveRead: flags['confirm-live-read'] || null,
      command: ['metro', ...positional].join(' '),
    });

    if (flags.json) {
      renderJson(streams.stdout, preflight);
    } else {
      write(streams.stdout, `API read-preflight for ${endpointId} on ${tenant}.`);
      write(streams.stdout, `Local evidence ready: ${preflight.summary.localEvidenceReady ? 'yes' : 'no'}`);
      write(streams.stdout, `Read plan valid: ${preflight.summary.readPlanValid ? 'yes' : 'no'}`);
      write(streams.stdout, `Read gate valid: ${preflight.summary.readGateValid ? 'yes' : 'no'}`);
      write(streams.stdout, `Live read enabled: ${preflight.readEnabledInCurrentCli ? 'yes' : 'no'}`);
      for (const blocker of preflight.blockers) {
        write(streams.stdout, `- ${blocker.id}: ${blocker.message}`);
      }
    }
    return preflight.summary.readPlanValid ? 0 : 1;
  }

  if (action === 'preflight') {
    const subaction = positional[2];

    if (subaction === 'template') {
      if (!flags.preview) {
        write(streams.stderr, 'api preflight template requires --preview <api-preview.json>');
        return 1;
      }
      let preview;
      let profileResolution = null;
      try {
        preview = loadJsonFile(flags.preview);
        if (flags['profile-resolution']) {
          profileResolution = loadJsonFile(flags['profile-resolution']);
        }
      } catch (error) {
        write(streams.stderr, `Failed to read API preflight evidence JSON/YAML: ${error.message}`);
        return 1;
      }

      const template = buildApiPreflightTemplate(preview, {
        previewPath: flags.preview,
        profileResolution,
        profileResolutionPath: flags['profile-resolution'] || null,
        approvalId: flags['approval-id'] || null,
      });
      if (!template) {
        write(streams.stderr, 'api preflight template requires a valid metro.api.preview.v1 JSON file for a reviewed endpoint.');
        return 1;
      }
      if (flags.json) {
        renderJson(streams.stdout, template);
      } else {
        write(streams.stdout, `API preflight template for ${template.previewBinding.endpointId} on ${template.previewBinding.tenant}.`);
        write(streams.stdout, `Payload hash: ${template.previewBinding.payloadHash}`);
        write(streams.stdout, `Required evidence: ${template.requiredEvidence.map((item) => item.id).join(', ')}`);
        write(streams.stdout, `Expert API apply enabled: ${template.futureApply.enabledInCurrentCli ? 'yes' : 'no'}`);
      }
      return 0;
    }

    if (subaction === 'validate') {
      if (!flags.file) {
        write(streams.stderr, 'api preflight validate requires --file <api-preflight.json>');
        return 1;
      }
      let input;
      let resolvedFile;
      try {
        resolvedFile = path.resolve(flags.file);
        input = loadJsonFile(resolvedFile);
      } catch (error) {
        write(streams.stderr, `Failed to read API preflight JSON/YAML: ${error.message}`);
        return 1;
      }

      const result = validateApiPreflight(input, { rootDir: path.dirname(resolvedFile) });
      if (flags.json) {
        renderJson(streams.stdout, result);
      } else if (result.valid) {
        write(streams.stdout, `API preflight validation passed for ${result.summary.endpointId}.`);
        write(streams.stdout, `Expert API apply enabled: ${result.applyEnabledInCurrentCli ? 'yes' : 'no'}`);
      } else {
        write(streams.stdout, 'API preflight validation failed:');
        for (const finding of result.findings) {
          write(streams.stdout, `- ${finding.id} [${finding.severity}] ${finding.message}`);
        }
      }
      return result.valid ? 0 : 1;
    }

    write(streams.stderr, `Unknown api preflight command: ${subaction || '(missing)'}`);
    return 1;
  }

  if (action === 'sandbox-proof') {
    const subaction = positional[2];

    if (subaction === 'template') {
      if (!flags.preview) {
        write(streams.stderr, 'api sandbox-proof template requires --preview <api-preview.json>');
        return 1;
      }
      if (!flags.preflight) {
        write(streams.stderr, 'api sandbox-proof template requires --preflight <api-preflight.json>');
        return 1;
      }

      let preview;
      let preflight;
      try {
        preview = loadJsonFile(flags.preview);
        preflight = loadJsonFile(flags.preflight);
      } catch (error) {
        write(streams.stderr, `Failed to read API sandbox-proof evidence JSON/YAML: ${error.message}`);
        return 1;
      }

      const template = buildApiSandboxProofTemplate({
        preview,
        preflight,
        previewPath: flags.preview,
        preflightPath: flags.preflight,
        reviewedBy: flags['reviewed-by'] || null,
        owner: flags.owner || null,
      });
      if (!template) {
        write(streams.stderr, 'api sandbox-proof template requires matching valid sandbox metro.api.preview.v1 and metro.api.preflight.v1 evidence for a reviewed write endpoint.');
        return 1;
      }
      if (flags.json) {
        renderJson(streams.stdout, template);
      } else {
        write(streams.stdout, `API sandbox-proof template for ${template.endpointId} on ${template.tenant}.`);
        write(streams.stdout, `Payload hash: ${template.payloadHash}`);
        write(streams.stdout, `Preflight payload hash: ${template.preflightPayloadHash}`);
        write(streams.stdout, `Expert API apply enabled: ${template.applyEnabledInCurrentCli ? 'yes' : 'no'}`);
      }
      return 0;
    }

    if (subaction === 'validate') {
      if (!flags.file) {
        write(streams.stderr, 'api sandbox-proof validate requires --file <api-sandbox-proof.json>');
        return 1;
      }
      let input;
      try {
        input = loadJsonFile(flags.file);
      } catch (error) {
        write(streams.stderr, `Failed to read API sandbox-proof JSON/YAML: ${error.message}`);
        return 1;
      }

      const result = validateApiSandboxProof(input);
      if (flags.json) {
        renderJson(streams.stdout, result);
      } else if (result.valid) {
        write(streams.stdout, `API sandbox-proof validation passed for ${result.summary.endpointId}.`);
        write(streams.stdout, `Expert API apply enabled: ${result.applyEnabledInCurrentCli ? 'yes' : 'no'}`);
      } else {
        write(streams.stdout, 'API sandbox-proof validation failed:');
        for (const finding of result.findings) {
          write(streams.stdout, `- ${finding.id} [${finding.severity}] ${finding.message}`);
        }
      }
      return result.valid ? 0 : 1;
    }

    write(streams.stderr, `Unknown api sandbox-proof command: ${subaction || '(missing)'}`);
    return 1;
  }

  if (action === 'read-gate') {
    const subaction = positional[2];

    if (subaction === 'template') {
      if (!flags['read-plan']) {
        write(streams.stderr, 'api read-gate template requires --read-plan <api-read-plan.json>');
        return 1;
      }

      let readPlan;
      let profileResolution = null;
      try {
        readPlan = loadJsonFile(flags['read-plan']);
      } catch (error) {
        write(streams.stderr, `Failed to read API read-plan JSON/YAML: ${error.message}`);
        return 1;
      }
      if (flags['profile-resolution']) {
        try {
          profileResolution = loadJsonFile(flags['profile-resolution']);
        } catch (error) {
          write(streams.stderr, `Failed to read profile resolution JSON/YAML: ${error.message}`);
          return 1;
        }
      }

      const template = buildApiReadGateTemplate({
        readPlan,
        readPlanPath: flags['read-plan'],
        profileResolution,
        profileResolutionPath: flags['profile-resolution'] || null,
        profile: flags.profile || null,
        keyEnv: flags['key-env'] || null,
        keyFingerprint: flags['key-fingerprint'] || null,
        authorizationId: flags['authorization-id'] || null,
        approvedBy: flags['approved-by'] || null,
        auditLog: flags['audit-log'] || null,
      });
      if (!template) {
        write(streams.stderr, 'api read-gate template requires a valid unblocked metro.api.read-plan.v1 JSON file for a reviewed read endpoint.');
        return 1;
      }
      if (flags.json) {
        renderJson(streams.stdout, template);
      } else {
        write(streams.stdout, `API read-gate template for ${template.binding.endpointId} on ${template.binding.tenant}.`);
        write(streams.stdout, `Request hash: ${template.binding.requestHash}`);
        write(streams.stdout, `Read-plan file hash: ${template.readPlan.fileHash}`);
        write(streams.stdout, `Expert API read enabled: ${template.futureRead.enabledInCurrentCli ? 'yes' : 'no'}`);
      }
      return 0;
    }

    if (subaction === 'validate') {
      if (!flags.file) {
        write(streams.stderr, 'api read-gate validate requires --file <api-read-gate.json>');
        return 1;
      }
      let input;
      let resolvedFile;
      try {
        resolvedFile = path.resolve(flags.file);
        input = loadJsonFile(resolvedFile);
      } catch (error) {
        write(streams.stderr, `Failed to read API read-gate JSON/YAML: ${error.message}`);
        return 1;
      }

      const result = validateApiReadGate(input, { rootDir: path.dirname(resolvedFile) });
      if (flags.json) {
        renderJson(streams.stdout, result);
      } else if (result.valid) {
        write(streams.stdout, `API read-gate validation passed for ${result.summary.endpointId}.`);
        write(streams.stdout, `Expert API read enabled: ${result.readEnabledInCurrentCli ? 'yes' : 'no'}`);
      } else {
        write(streams.stdout, 'API read-gate validation failed:');
        for (const finding of result.findings) {
          write(streams.stdout, `- ${finding.id} [${finding.severity}] ${finding.message}`);
        }
      }
      return result.valid ? 0 : 1;
    }

    write(streams.stderr, `Unknown api read-gate command: ${subaction || '(missing)'}`);
    return 1;
  }

  if (action === 'read-mock') {
    const endpointId = positional[2];
    if (!endpointId) {
      write(streams.stderr, 'api read-mock requires <endpoint-id>');
      return 1;
    }
    if (!flags.file) {
      write(streams.stderr, 'api read-mock requires --file <request.json|yaml>');
      return 1;
    }
    if (!flags['read-gate']) {
      write(streams.stderr, 'api read-mock requires --read-gate <api-read-gate.json>');
      return 1;
    }
    if (!flags['mock-response']) {
      write(streams.stderr, 'api read-mock requires --mock-response <response-data.json>');
      return 1;
    }

    let requestInput;
    let readGate;
    let mockResponse;
    let resolvedReadGate;
    try {
      requestInput = loadJsonFile(flags.file);
      resolvedReadGate = path.resolve(flags['read-gate']);
      readGate = loadJsonFile(resolvedReadGate);
      mockResponse = loadJsonFile(flags['mock-response']);
    } catch (error) {
      write(streams.stderr, `Failed to read API read-mock input JSON/YAML: ${error.message}`);
      return 1;
    }

    const result = buildApiReadMockBundle({
      endpointId,
      requestInput,
      readGate,
      mockResponse,
      readGateRootDir: path.dirname(resolvedReadGate),
      actor: flags.actor || null,
    });
    if (flags.json) {
      renderJson(streams.stdout, result);
    } else if (!result.blocked) {
      write(streams.stdout, `API read-mock built for ${result.endpoint.id} on ${result.tenant}.`);
      write(streams.stdout, `Request hash: ${result.readResult.requestSummary.requestHash}`);
      write(streams.stdout, `Response hash: ${result.readResult.responseSummary.responseHash}`);
      write(streams.stdout, `Live read enabled: ${result.readEnabledInCurrentCli ? 'yes' : 'no'}`);
    } else {
      write(streams.stdout, 'API read-mock blocked:');
      const findings = [
        ...(result.readGateValidation?.findings || []),
        ...(result.readResultValidation?.findings || []),
      ];
      for (const finding of findings) {
        write(streams.stdout, `- ${finding.id} [${finding.severity}] ${finding.message}`);
      }
    }
    return result.blocked ? 1 : 0;
  }

  if (action === 'read-pipeline') {
    const endpointId = positional[2];
    if (!endpointId) {
      write(streams.stderr, 'api read-pipeline requires <endpoint-id>');
      return 1;
    }
    if (!flags.file) {
      write(streams.stderr, 'api read-pipeline requires --file <request.json|yaml>');
      return 1;
    }
    if (!flags['read-gate']) {
      write(streams.stderr, 'api read-pipeline requires --read-gate <api-read-gate.json>');
      return 1;
    }
    if (!flags['mock-response']) {
      write(streams.stderr, 'api read-pipeline requires --mock-response <response-data.json>');
      return 1;
    }
    if (!flags.out) {
      write(streams.stderr, 'api read-pipeline requires --out <api-read-audit.jsonl>');
      return 1;
    }
    if (!flags.actor) {
      write(streams.stderr, 'api read-pipeline requires --actor <id>');
      return 1;
    }
    const wantsDryRun = flags['dry-run'] === true;
    const wantsWrite = flags.write === true;
    if (wantsDryRun === wantsWrite) {
      write(streams.stderr, 'api read-pipeline requires exactly one of --dry-run or --write');
      return 1;
    }

    let requestInput;
    let readGate;
    let mockResponse;
    let resolvedReadGate;
    try {
      requestInput = loadJsonFile(flags.file);
      resolvedReadGate = path.resolve(flags['read-gate']);
      readGate = loadJsonFile(resolvedReadGate);
      mockResponse = loadJsonFile(flags['mock-response']);
    } catch (error) {
      write(streams.stderr, `Failed to read API read-pipeline input JSON/YAML: ${error.message}`);
      return 1;
    }

    const plan = buildApiReadPipelinePlan({
      endpointId,
      requestInput,
      readGate,
      mockResponse,
      readGateRootDir: path.dirname(resolvedReadGate),
      actor: flags.actor,
      outPath: flags.out,
      mode: wantsDryRun ? 'dry-run' : 'write',
      timestamp: flags.timestamp || null,
    });
    const result = wantsWrite ? writeApiReadPipeline(plan) : plan;

    if (flags.json) {
      renderJson(streams.stdout, result);
    } else if (!result.blocked) {
      write(streams.stdout, `API read-pipeline ${result.mode} prepared for ${result.endpoint.id} on ${result.tenant}.`);
      write(streams.stdout, `Request hash: ${result.summary.requestHash}`);
      write(streams.stdout, `Response hash: ${result.summary.responseHash}`);
      write(streams.stdout, `Audit row hash: ${result.summary.auditRowHash}`);
      write(streams.stdout, `Rows written: ${result.summary.auditRowsWritten}`);
      write(streams.stdout, `Live read enabled: ${result.readEnabledInCurrentCli ? 'yes' : 'no'}`);
    } else {
      write(streams.stdout, 'API read-pipeline blocked:');
      const findings = [
        ...(result.readMock?.readGateValidation?.findings || []),
        ...(result.readMock?.readResultValidation?.findings || []),
        ...(result.readAuditWrite?.findings || []),
      ];
      for (const finding of findings) {
        write(streams.stdout, `- ${finding.id} [${finding.severity}] ${finding.message}`);
      }
    }
    return result.blocked ? 1 : 0;
  }

  if (action === 'read-result') {
    const subaction = positional[2];

    if (subaction === 'verify') {
      if (!flags.file) {
        write(streams.stderr, 'api read-result verify requires --file <api-read-result.json>');
        return 1;
      }
      let input;
      try {
        input = loadJsonFile(flags.file);
      } catch (error) {
        write(streams.stderr, `Failed to read API read-result JSON/YAML: ${error.message}`);
        return 1;
      }

      const result = verifyApiReadResult(input);
      if (flags.json) {
        renderJson(streams.stdout, result);
      } else if (result.valid) {
        write(streams.stdout, `API read-result validation passed for ${result.summary.endpointId}.`);
        write(streams.stdout, `Transport mode: ${result.summary.transportMode}`);
        write(streams.stdout, `Live read enabled: ${result.readEnabledInCurrentCli ? 'yes' : 'no'}`);
      } else {
        write(streams.stdout, 'API read-result validation failed:');
        for (const finding of result.findings) {
          write(streams.stdout, `- ${finding.id} [${finding.severity}] ${finding.message}`);
        }
      }
      return result.valid ? 0 : 1;
    }

    write(streams.stderr, `Unknown api read-result command: ${subaction || '(missing)'}`);
    return 1;
  }

  if (action === 'read-audit') {
    const subaction = positional[2];

    if (subaction === 'template') {
      if (!flags['read-gate']) {
        write(streams.stderr, 'api read-audit template requires --read-gate <api-read-gate.json>');
        return 1;
      }
      if (!flags['read-result']) {
        write(streams.stderr, 'api read-audit template requires --read-result <api-read-result.json>');
        return 1;
      }
      let readGate;
      let readResult;
      let resolvedReadGate;
      try {
        resolvedReadGate = path.resolve(flags['read-gate']);
        readGate = loadJsonFile(resolvedReadGate);
        readResult = loadJsonFile(flags['read-result']);
      } catch (error) {
        write(streams.stderr, `Failed to read API read-audit evidence JSON/YAML: ${error.message}`);
        return 1;
      }

      const template = buildApiReadAuditTemplate({
        readGate,
        readResult,
        readGateRootDir: path.dirname(resolvedReadGate),
        actor: flags.actor || null,
      });
      if (!template) {
        write(streams.stderr, 'api read-audit template requires matching valid metro.api.read-gate.v1 and metro.api.read-result.v1 evidence for a reviewed read endpoint.');
        return 1;
      }
      if (flags.json) {
        renderJson(streams.stdout, template);
      } else {
        write(streams.stdout, `API read-audit template for ${template.endpoint.id} on ${template.tenant}.`);
        write(streams.stdout, `Request hash: ${template.row.requestSummary.requestHash}`);
        write(streams.stdout, `Response hash: ${template.row.responseSummary.responseHash}`);
        write(streams.stdout, `Live read enabled: ${template.readEnabledInCurrentCli ? 'yes' : 'no'}`);
      }
      return 0;
    }

    if (subaction === 'write') {
      if (!flags['read-gate']) {
        write(streams.stderr, 'api read-audit write requires --read-gate <api-read-gate.json>');
        return 1;
      }
      if (!flags['read-result']) {
        write(streams.stderr, 'api read-audit write requires --read-result <api-read-result.json>');
        return 1;
      }
      if (!flags.out) {
        write(streams.stderr, 'api read-audit write requires --out <api-read-audit.jsonl>');
        return 1;
      }
      if (!flags.actor) {
        write(streams.stderr, 'api read-audit write requires --actor <id>');
        return 1;
      }
      const wantsDryRun = flags['dry-run'] === true;
      const wantsWrite = flags.write === true;
      if (wantsDryRun === wantsWrite) {
        write(streams.stderr, 'api read-audit write requires exactly one of --dry-run or --write');
        return 1;
      }

      let readGate;
      let readResult;
      let resolvedReadGate;
      try {
        resolvedReadGate = path.resolve(flags['read-gate']);
        readGate = loadJsonFile(resolvedReadGate);
        readResult = loadJsonFile(flags['read-result']);
      } catch (error) {
        write(streams.stderr, `Failed to read API read-audit evidence JSON/YAML: ${error.message}`);
        return 1;
      }

      const plan = buildApiReadAuditWritePlan({
        readGate,
        readResult,
        readGateRootDir: path.dirname(resolvedReadGate),
        actor: flags.actor,
        outPath: flags.out,
        mode: wantsDryRun ? 'dry-run' : 'write',
        timestamp: flags.timestamp || null,
      });
      const result = wantsWrite ? writeApiReadAuditJsonl(plan) : plan;

      if (flags.json) {
        renderJson(streams.stdout, result);
      } else if (!result.blocked) {
        write(streams.stdout, `API read-audit ${result.mode} prepared for ${result.endpoint.id} on ${result.tenant}.`);
        write(streams.stdout, `Target: ${result.target.path}`);
        write(streams.stdout, `Row hash: ${result.rowHash}`);
        write(streams.stdout, `Rows written: ${result.write.rowsWritten}`);
        write(streams.stdout, `Live read enabled: ${result.readEnabledInCurrentCli ? 'yes' : 'no'}`);
      } else {
        write(streams.stdout, 'API read-audit write blocked:');
        for (const finding of result.findings) {
          write(streams.stdout, `- ${finding.id} [${finding.severity}] ${finding.message}`);
        }
      }
      return result.blocked ? 1 : 0;
    }

    if (subaction === 'validate') {
      if (!flags.file) {
        write(streams.stderr, 'api read-audit validate requires --file <api-read-audit.jsonl>');
        return 1;
      }
      let input;
      try {
        input = loadTextFile(flags.file);
      } catch (error) {
        write(streams.stderr, `Failed to read API read-audit JSONL: ${error.message}`);
        return 1;
      }

      const result = validateApiReadAuditJsonl(input);
      if (flags.json) {
        renderJson(streams.stdout, result);
      } else if (result.valid) {
        write(streams.stdout, `API read-audit validation passed for ${result.rowCount} row(s).`);
        write(streams.stdout, `Live read enabled: ${result.readEnabledInCurrentCli ? 'yes' : 'no'}`);
      } else {
        write(streams.stdout, 'API read-audit validation failed:');
        for (const finding of result.findings) {
          write(streams.stdout, `- ${finding.id} [${finding.severity}] ${finding.message}`);
        }
      }
      return result.valid ? 0 : 1;
    }

    write(streams.stderr, `Unknown api read-audit command: ${subaction || '(missing)'}`);
    return 1;
  }

  if (action === 'apply-gate') {
    const subaction = positional[2];

    if (subaction === 'template') {
      if (!flags.preview) {
        write(streams.stderr, 'api apply-gate template requires --preview <api-preview.json>');
        return 1;
      }
      if (!flags.preflight) {
        write(streams.stderr, 'api apply-gate template requires --preflight <api-preflight.json>');
        return 1;
      }

      let preview;
      let preflight;
      let sandboxProof = null;
      let profileResolution = null;
      try {
        preview = loadJsonFile(flags.preview);
        preflight = loadJsonFile(flags.preflight);
        if (flags['sandbox-proof']) {
          sandboxProof = loadJsonFile(flags['sandbox-proof']);
        }
        if (flags['profile-resolution']) {
          profileResolution = loadJsonFile(flags['profile-resolution']);
        }
      } catch (error) {
        write(streams.stderr, `Failed to read API apply-gate evidence JSON/YAML: ${error.message}`);
        return 1;
      }
      if (preview.endpoint?.operationType === 'write' && !flags['sandbox-proof']) {
        write(streams.stderr, 'api apply-gate template requires --sandbox-proof <sandbox-proof.json> for write endpoints');
        return 1;
      }

      const template = buildApiApplyGateTemplate({
        preview,
        preflight,
        sandboxProof,
        previewPath: flags.preview,
        preflightPath: flags.preflight,
        sandboxProofPath: flags['sandbox-proof'] || null,
        profileResolution,
        profileResolutionPath: flags['profile-resolution'] || null,
        approvalId: flags['approval-id'] || null,
        owner: flags.owner || null,
        keyEnv: flags['key-env'] || null,
        keyFingerprint: flags['key-fingerprint'] || null,
        auditLog: flags['audit-log'] || null,
      });
      if (!template) {
        write(streams.stderr, 'api apply-gate template requires matching valid metro.api.preview.v1 and metro.api.preflight.v1 evidence for a reviewed endpoint.');
        return 1;
      }
      if (flags.json) {
        renderJson(streams.stdout, template);
      } else {
        write(streams.stdout, `API apply-gate template for ${template.binding.endpointId} on ${template.binding.tenant}.`);
        write(streams.stdout, `Payload hash: ${template.binding.payloadHash}`);
        write(streams.stdout, `Preview file hash: ${template.preview.fileHash}`);
        write(streams.stdout, `Preflight file hash: ${template.preflight.fileHash}`);
        write(streams.stdout, `Expert API apply enabled: ${template.futureApply.enabledInCurrentCli ? 'yes' : 'no'}`);
      }
      return 0;
    }

    if (subaction === 'validate') {
      if (!flags.file) {
        write(streams.stderr, 'api apply-gate validate requires --file <api-apply-gate.json>');
        return 1;
      }
      let input;
      let resolvedFile;
      try {
        resolvedFile = path.resolve(flags.file);
        input = loadJsonFile(resolvedFile);
      } catch (error) {
        write(streams.stderr, `Failed to read API apply-gate JSON/YAML: ${error.message}`);
        return 1;
      }

      const result = validateApiApplyGate(input, { rootDir: path.dirname(resolvedFile) });
      if (flags.json) {
        renderJson(streams.stdout, result);
      } else if (result.valid) {
        write(streams.stdout, `API apply-gate validation passed for ${result.summary.endpointId}.`);
        write(streams.stdout, `Expert API apply enabled: ${result.applyEnabledInCurrentCli ? 'yes' : 'no'}`);
      } else {
        write(streams.stdout, 'API apply-gate validation failed:');
        for (const finding of result.findings) {
          write(streams.stdout, `- ${finding.id} [${finding.severity}] ${finding.message}`);
        }
      }
      return result.valid ? 0 : 1;
    }

    write(streams.stderr, `Unknown api apply-gate command: ${subaction || '(missing)'}`);
    return 1;
  }

  if (action === 'approval-record') {
    const subaction = positional[2];

    if (subaction === 'template') {
      if (!flags['apply-gate']) {
        write(streams.stderr, 'api approval-record template requires --apply-gate <api-apply-gate.json>');
        return 1;
      }

      let applyGate;
      try {
        applyGate = loadJsonFile(flags['apply-gate']);
      } catch (error) {
        write(streams.stderr, `Failed to read API apply-gate JSON/YAML: ${error.message}`);
        return 1;
      }

      const template = buildApiApprovalRecordTemplate({
        applyGate,
        applyGatePath: flags['apply-gate'],
        approvalId: flags['approval-id'] || null,
        requestedBy: flags['requested-by'] || null,
        approvedBy: flags['approved-by'] || null,
        owner: flags.owner || null,
        businessPurpose: flags['business-purpose'] || null,
        expiresAt: flags['expires-at'] || null,
      });
      if (!template) {
        write(streams.stderr, 'api approval-record template requires a valid metro.api.apply-gate.v1 file for a reviewed write endpoint.');
        return 1;
      }
      if (flags.json) {
        renderJson(streams.stdout, template);
      } else {
        write(streams.stdout, `API approval-record template for ${template.binding.endpointId} on ${template.binding.tenant}.`);
        write(streams.stdout, `Approval ID: ${template.approval.approvalId}`);
        write(streams.stdout, `Apply-gate file hash: ${template.applyGate.fileHash}`);
        write(streams.stdout, `Expert API apply enabled: ${template.futureApply.enabledInCurrentCli ? 'yes' : 'no'}`);
        write(streams.stdout, `Live apply authorized by this record: ${template.liveApplyAuthorizedByThisRecord ? 'yes' : 'no'}`);
      }
      return 0;
    }

    if (subaction === 'validate') {
      if (!flags.file) {
        write(streams.stderr, 'api approval-record validate requires --file <api-approval-record.json>');
        return 1;
      }
      let input;
      let resolvedFile;
      try {
        resolvedFile = path.resolve(flags.file);
        input = loadJsonFile(resolvedFile);
      } catch (error) {
        write(streams.stderr, `Failed to read API approval-record JSON/YAML: ${error.message}`);
        return 1;
      }

      const result = validateApiApprovalRecord(input, { rootDir: path.dirname(resolvedFile) });
      if (flags.json) {
        renderJson(streams.stdout, result);
      } else if (result.valid) {
        write(streams.stdout, `API approval-record validation passed for ${result.summary.endpointId}.`);
        write(streams.stdout, `Expert API apply enabled: ${result.applyEnabledInCurrentCli ? 'yes' : 'no'}`);
        write(streams.stdout, `Live apply authorized by this record: ${result.liveApplyAuthorizedByThisRecord ? 'yes' : 'no'}`);
      } else {
        write(streams.stdout, 'API approval-record validation failed:');
        for (const finding of result.findings) {
          write(streams.stdout, `- ${finding.id} [${finding.severity}] ${finding.message}`);
        }
      }
      return result.valid ? 0 : 1;
    }

    write(streams.stderr, `Unknown api approval-record command: ${subaction || '(missing)'}`);
    return 1;
  }

  if (action === 'apply-audit') {
    const subaction = positional[2];

    if (subaction === 'template') {
      if (!flags['approval-record']) {
        write(streams.stderr, 'api apply-audit template requires --approval-record <api-approval-record.json>');
        return 1;
      }

      let approvalRecord;
      let resolvedApprovalRecord;
      try {
        resolvedApprovalRecord = path.resolve(flags['approval-record']);
        approvalRecord = loadJsonFile(resolvedApprovalRecord);
      } catch (error) {
        write(streams.stderr, `Failed to read API approval-record JSON/YAML: ${error.message}`);
        return 1;
      }

      const template = buildApiApplyAuditTemplate({
        approvalRecord,
        approvalRecordPath: flags['approval-record'],
        rootDir: process.cwd(),
        actor: flags.actor || null,
      });
      if (!template) {
        write(streams.stderr, 'api apply-audit template requires a valid metro.api.approval-record.v1 file for a reviewed write endpoint.');
        return 1;
      }
      if (flags.json) {
        renderJson(streams.stdout, template);
      } else {
        write(streams.stdout, `API apply-audit template for ${template.endpoint.id} on ${template.tenant}.`);
        write(streams.stdout, `Approval ID: ${template.row.approvalRecord.approvalId}`);
        write(streams.stdout, `Payload hash: ${template.row.requestSummary.payloadHash}`);
        write(streams.stdout, `Expert API apply enabled: ${template.applyEnabledInCurrentCli ? 'yes' : 'no'}`);
        write(streams.stdout, `Live apply authorized by this record: ${template.liveApplyAuthorizedByThisRecord ? 'yes' : 'no'}`);
      }
      return 0;
    }

    if (subaction === 'write') {
      if (!flags['approval-record']) {
        write(streams.stderr, 'api apply-audit write requires --approval-record <api-approval-record.json>');
        return 1;
      }
      if (!flags.out) {
        write(streams.stderr, 'api apply-audit write requires --out <api-apply-audit.jsonl>');
        return 1;
      }
      if (!flags.actor) {
        write(streams.stderr, 'api apply-audit write requires --actor <id>');
        return 1;
      }
      const wantsDryRun = flags['dry-run'] === true;
      const wantsWrite = flags.write === true;
      if (wantsDryRun === wantsWrite) {
        write(streams.stderr, 'api apply-audit write requires exactly one of --dry-run or --write');
        return 1;
      }

      let approvalRecord;
      let resolvedApprovalRecord;
      try {
        resolvedApprovalRecord = path.resolve(flags['approval-record']);
        approvalRecord = loadJsonFile(resolvedApprovalRecord);
      } catch (error) {
        write(streams.stderr, `Failed to read API approval-record JSON/YAML: ${error.message}`);
        return 1;
      }

      const plan = buildApiApplyAuditWritePlan({
        approvalRecord,
        approvalRecordPath: flags['approval-record'],
        approvalRecordRootDir: process.cwd(),
        actor: flags.actor,
        outPath: flags.out,
        mode: wantsDryRun ? 'dry-run' : 'write',
        timestamp: flags.timestamp || null,
      });
      const result = wantsWrite ? writeApiApplyAuditJsonl(plan) : plan;

      if (flags.json) {
        renderJson(streams.stdout, result);
      } else if (!result.blocked) {
        write(streams.stdout, `API apply-audit ${result.mode} prepared for ${result.endpoint.id} on ${result.tenant}.`);
        write(streams.stdout, `Target: ${result.target.path}`);
        write(streams.stdout, `Row hash: ${result.rowHash}`);
        write(streams.stdout, `Rows written: ${result.write.rowsWritten}`);
        write(streams.stdout, `Expert API apply enabled: ${result.applyEnabledInCurrentCli ? 'yes' : 'no'}`);
        write(streams.stdout, `Live apply authorized by this record: ${result.liveApplyAuthorizedByThisRecord ? 'yes' : 'no'}`);
      } else {
        write(streams.stdout, 'API apply-audit write blocked:');
        for (const finding of result.findings) {
          write(streams.stdout, `- ${finding.id} [${finding.severity}] ${finding.message}`);
        }
      }
      return result.blocked ? 1 : 0;
    }

    if (subaction === 'validate') {
      if (!flags.file) {
        write(streams.stderr, 'api apply-audit validate requires --file <api-apply-audit.jsonl>');
        return 1;
      }
      let input;
      try {
        input = loadTextFile(flags.file);
      } catch (error) {
        write(streams.stderr, `Failed to read API apply-audit JSONL: ${error.message}`);
        return 1;
      }

      const result = validateApiApplyAuditJsonl(input);
      if (flags.json) {
        renderJson(streams.stdout, result);
      } else if (result.valid) {
        write(streams.stdout, `API apply-audit validation passed for ${result.rowCount} row(s).`);
        write(streams.stdout, `Expert API apply enabled: ${result.applyEnabledInCurrentCli ? 'yes' : 'no'}`);
        write(streams.stdout, `Live apply authorized by this record: ${result.liveApplyAuthorizedByThisRecord ? 'yes' : 'no'}`);
      } else {
        write(streams.stdout, 'API apply-audit validation failed:');
        for (const finding of result.findings) {
          write(streams.stdout, `- ${finding.id} [${finding.severity}] ${finding.message}`);
        }
      }
      return result.valid ? 0 : 1;
    }

    write(streams.stderr, `Unknown api apply-audit command: ${subaction || '(missing)'}`);
    return 1;
  }

  if (action === 'apply-readback') {
    const subaction = positional[2];

    if (subaction === 'verify') {
      if (!flags['apply-audit']) {
        write(streams.stderr, 'api apply-readback verify requires --apply-audit <api-apply-audit.jsonl>');
        return 1;
      }
      if (!flags['read-result']) {
        write(streams.stderr, 'api apply-readback verify requires --read-result <api-read-result.json>');
        return 1;
      }

      let applyAuditText;
      let readResult;
      try {
        applyAuditText = loadTextFile(flags['apply-audit']);
        readResult = loadJsonFile(flags['read-result']);
      } catch (error) {
        write(streams.stderr, `Failed to read API apply-readback evidence: ${error.message}`);
        return 1;
      }

      const result = verifyApiApplyReadback({
        applyAuditText,
        applyAuditPath: flags['apply-audit'],
        readResult,
        readResultPath: flags['read-result'],
        rowNumber: flags.row || null,
      });
      if (flags.json) {
        renderJson(streams.stdout, result);
      } else if (result.valid) {
        write(streams.stdout, `API apply-readback evidence bound for ${result.summary.applyEndpointId} using ${result.summary.readEndpointId}.`);
        write(streams.stdout, `Evidence-bound checks: ${result.summary.evidenceBoundChecks}/${result.summary.plannedReadBackChecks}`);
        write(streams.stdout, `Semantic apply success proven: ${result.summary.semanticApplySuccessProven ? 'yes' : 'no'}`);
        write(streams.stdout, `Live apply enabled: ${result.applyEnabledInCurrentCli ? 'yes' : 'no'}`);
      } else {
        write(streams.stdout, 'API apply-readback verification failed:');
        for (const finding of result.findings) {
          write(streams.stdout, `- ${finding.id} [${finding.severity}] ${finding.message}`);
        }
      }
      return result.valid ? 0 : 1;
    }

    write(streams.stderr, `Unknown api apply-readback command: ${subaction || '(missing)'}`);
    return 1;
  }

  if (action === 'apply-result') {
    const subaction = positional[2];

    if (subaction === 'template') {
      if (!flags['apply-audit']) {
        write(streams.stderr, 'api apply-result template requires --apply-audit <api-apply-audit.jsonl>');
        return 1;
      }
      if (!flags['apply-readback']) {
        write(streams.stderr, 'api apply-result template requires --apply-readback <api-apply-readback.json>');
        return 1;
      }

      let applyAuditText;
      let applyReadbackReport;
      try {
        applyAuditText = loadTextFile(flags['apply-audit']);
        applyReadbackReport = loadJsonFile(flags['apply-readback']);
      } catch (error) {
        write(streams.stderr, `Failed to read API apply-result prerequisites: ${error.message}`);
        return 1;
      }

      const result = buildApiApplyResultTemplate({
        applyAuditText,
        applyAuditPath: flags['apply-audit'],
        applyReadbackReport,
        applyReadbackPath: flags['apply-readback'],
        rowNumber: flags.row || null,
      });
      if (flags.json) {
        renderJson(streams.stdout, result);
      } else if (!result.blocked) {
        write(streams.stdout, `API apply-result template prepared for ${result.endpoint.id} on ${result.tenant}.`);
        write(streams.stdout, `Apply enabled in current CLI: ${result.applyEnabledInCurrentCli ? 'yes' : 'no'}`);
      } else {
        write(streams.stdout, 'API apply-result template blocked:');
        for (const finding of result.findings) {
          write(streams.stdout, `- ${finding.id} [${finding.severity}] ${finding.message}`);
        }
      }
      return result.blocked ? 1 : 0;
    }

    if (subaction === 'validate') {
      if (!flags.file) {
        write(streams.stderr, 'api apply-result validate requires --file <api-apply-result.json>');
        return 1;
      }
      if (!flags['apply-audit']) {
        write(streams.stderr, 'api apply-result validate requires --apply-audit <api-apply-audit.jsonl>');
        return 1;
      }
      if (!flags['apply-readback']) {
        write(streams.stderr, 'api apply-result validate requires --apply-readback <api-apply-readback.json>');
        return 1;
      }

      let input;
      let applyAuditText;
      let applyReadbackReport;
      try {
        input = loadJsonFile(flags.file);
        applyAuditText = loadTextFile(flags['apply-audit']);
        applyReadbackReport = loadJsonFile(flags['apply-readback']);
      } catch (error) {
        write(streams.stderr, `Failed to read API apply-result evidence: ${error.message}`);
        return 1;
      }

      const result = validateApiApplyResult(input, {
        applyAuditText,
        applyReadbackReport,
        rowNumber: flags.row || null,
      });
      if (flags.json) {
        renderJson(streams.stdout, result);
      } else if (result.valid) {
        write(streams.stdout, `API apply-result validation passed for ${result.summary.endpointId} on ${result.summary.tenant}.`);
        write(streams.stdout, `Semantic apply success proven: ${result.summary.semanticApplySuccessProven ? 'yes' : 'no'}`);
      } else {
        write(streams.stdout, 'API apply-result validation failed:');
        for (const finding of result.findings) {
          write(streams.stdout, `- ${finding.id} [${finding.severity}] ${finding.message}`);
        }
      }
      return result.valid ? 0 : 1;
    }

    write(streams.stderr, `Unknown api apply-result command: ${subaction || '(missing)'}`);
    return 1;
  }

  if (action === 'read') {
    const endpointId = positional[2] || null;
    const tenant = tenantFromFlags(flags);
    let requestInput = null;
    let requestLoadError = null;
    let readGate = null;
    let readGateLoadError = null;
    let readGateRootDir = process.cwd();

    if (flags.file) {
      try {
        requestInput = loadJsonFile(flags.file);
      } catch (error) {
        requestLoadError = error.message;
      }
    }

    if (flags['read-gate']) {
      try {
        const resolvedReadGate = path.resolve(flags['read-gate']);
        readGateRootDir = path.dirname(resolvedReadGate);
        readGate = loadJsonFile(resolvedReadGate);
      } catch (error) {
        readGateLoadError = error.message;
      }
    }

    const refusalPreview = buildApiReadRefusal({
      endpointId,
      tenant,
      tenantFlags: {
        sandbox: flags.sandbox === true,
        prod: flags.prod === true,
      },
      requestInput,
      requestLoadError,
      requestFileProvided: Boolean(flags.file),
      readGate,
      readGateLoadError,
      readGateFileProvided: Boolean(flags['read-gate']),
      readGateRootDir,
      confirmLiveRead: flags['confirm-live-read'] || null,
      command: ['metro', ...positional].join(' '),
    });

    if (refusalPreview.blocked) {
      if (flags.json) {
        renderJson(streams.stderr, refusalPreview);
      } else {
        renderRefusalHuman(streams.stderr, refusalPreview);
      }
      return 2;
    }

    return runLiveApiRead({
      endpointId,
      requestInput,
      readGate,
      confirmLiveRead: flags['confirm-live-read'],
      tenantFlags: {
        sandbox: flags.sandbox === true,
        prod: flags.prod === true,
      },
      rootDir: readGateRootDir,
    }).then((result) => {
      if (result.blocked) {
        const refusal = buildApiReadRefusal({
          endpointId,
          tenant,
          tenantFlags: { sandbox: flags.sandbox === true, prod: flags.prod === true },
          requestInput,
          requestFileProvided: Boolean(flags.file),
          readGate,
          readGateFileProvided: Boolean(flags['read-gate']),
          readGateRootDir,
          confirmLiveRead: flags['confirm-live-read'] || null,
          command: ['metro', ...positional].join(' '),
        });
        if (flags.json) renderJson(streams.stderr, refusal);
        else renderRefusalHuman(streams.stderr, refusal);
        return 2;
      }

      if (flags.json) {
        renderJson(streams.stdout, result);
      } else {
        renderLiveReadSuccessHuman(streams.stderr, result);
        renderJson(streams.stdout, result);
      }
      return 0;
    }).catch((error) => {
      const payload = buildRefusal({
        command: ['metro', ...positional].join(' '),
        reason: error.message || 'Live Metronome read failed.',
        nextCommands: [
          'metro api read-gate validate --file <api-read-gate.json> --json',
          'metro docs explain refusal-troubleshooting --json',
        ],
      });
      if (flags.json) renderJson(streams.stderr, payload);
      else renderRefusalHuman(streams.stderr, payload);
      return 1;
    });
  }

  if (action === 'apply') {
    const endpointId = positional[2] || null;
    const tenant = tenantFromFlags(flags);
    let requestInput = null;
    let requestLoadError = null;
    let applyGate = null;
    let applyGateLoadError = null;
    let applyGateRootDir = process.cwd();
    let approvalRecord = null;
    let approvalRecordLoadError = null;

    if (flags.file) {
      try {
        requestInput = loadJsonFile(flags.file);
      } catch (error) {
        requestLoadError = error.message;
      }
    }

    if (flags['apply-gate']) {
      try {
        const resolved = path.resolve(flags['apply-gate']);
        applyGateRootDir = path.dirname(resolved);
        applyGate = loadJsonFile(resolved);
      } catch (error) {
        applyGateLoadError = error.message;
      }
    }

    if (flags['approval-record']) {
      try {
        approvalRecord = loadJsonFile(path.resolve(flags['approval-record']));
      } catch (error) {
        approvalRecordLoadError = error.message;
      }
    }

    if (!endpointId || endpointId !== 'contracts.create' || !flags.sandbox) {
      return safetyRefusal(
        positional,
        streams,
        'Live apply is limited to sandbox contracts.create in the current CLI release.',
        null,
        [
          'metro api preview contracts.create --file <request.json> --sandbox --json',
          'metro api apply-gate validate --file <api-apply-gate.json> --json',
          'metro docs explain first-safe-preview --json',
        ],
      );
    }

    return runLiveApiApply({
      endpointId,
      tenant,
      tenantFlags: { sandbox: flags.sandbox === true, prod: flags.prod === true },
      requestInput,
      requestLoadError,
      requestFileProvided: Boolean(flags.file),
      applyGate,
      applyGateLoadError,
      applyGateFileProvided: Boolean(flags['apply-gate']),
      applyGateRootDir,
      approvalRecord,
      approvalRecordLoadError,
      approvalRecordFileProvided: Boolean(flags['approval-record']),
      confirmLiveApply: flags['confirm-live-apply'] || null,
      confirmGreenfieldCreate: flags['confirm-greenfield-create'] || null,
    }).then((result) => {
      if (result.blocked) {
        const payload = buildRefusal({
          command: ['metro', ...positional].join(' '),
          reason: result.blockReason || 'Sandbox apply refused.',
          nextCommands: (result.blockers || []).slice(0, 3).map((blocker) => {
            if (blocker.id === 'apply-gate-required') {
              return 'metro api apply-gate template --preview <preview.json> --preflight <preflight.json> --sandbox-proof <proof.json> --json';
            }
            if (blocker.id === 'confirm-greenfield-create-required') {
              return 'metro api apply … --confirm-greenfield-create=I_UNDERSTAND_SANDBOX_CATALOG_CREATE';
            }
            if (blocker.id === 'metronome-key-not-configured') {
              return 'export METRONOME_SANDBOX_KEY=\'<your-key>\'';
            }
            return 'metro api apply-gate validate --file <api-apply-gate.json> --json';
          }),
          extra: { blockers: result.blockers || [] },
        });
        if (flags.json) renderJson(streams.stderr, payload);
        else renderRefusalHuman(streams.stderr, payload);
        return 2;
      }

      if (flags.json) {
        renderJson(streams.stdout, result);
      } else {
        renderLiveApplySuccessHuman(streams.stderr, result);
        renderJson(streams.stdout, result);
      }
      return 0;
    }).catch((error) => {
      const payload = buildRefusal({
        command: ['metro', ...positional].join(' '),
        reason: error.message || 'Live sandbox apply failed.',
        nextCommands: [
          'metro api validate contracts.create --file <request.json> --json',
          'metro docs explain refusal-troubleshooting --json',
        ],
      });
      if (flags.json) renderJson(streams.stderr, payload);
      else renderRefusalHuman(streams.stderr, payload);
      return 1;
    });
  }

  write(streams.stderr, `Unknown api command: ${action || '(missing)'}`);
  return 1;
}

function runAuditCommand(positional, flags, streams) {
  const action = positional[1];

  if (action === 'template') {
    if (!flags.workflow) {
      write(streams.stderr, 'audit template requires --workflow <workflow>');
      return 1;
    }
    if (!flags.shape) {
      write(streams.stderr, 'audit template requires --shape <shape>');
      return 1;
    }
    if (flags.sandbox && flags.prod) {
      write(streams.stderr, 'Choose at most one tenant for the template: --sandbox or --prod.');
      return 2;
    }
    const template = buildAuditTemplate({
      workflow: flags.workflow,
      shape: flags.shape,
      tenant: tenantFromFlags(flags) || '<sandbox|production>',
    });
    if (!template) {
      write(streams.stderr, `Unsupported audit template pair: ${flags.workflow} ${flags.shape}`);
      return 1;
    }
    if (flags.json) {
      renderJson(streams.stdout, template);
    } else {
      write(streams.stdout, `Audit template for ${template.workflow} ${template.shape}`);
      write(streams.stdout, `Tenant: ${template.tenant}`);
      write(streams.stdout, `Endpoint: ${template.row.endpoint.method} ${template.row.endpoint.path}`);
    }
    return 0;
  }

  if (action === 'validate') {
    if (!flags.file) {
      write(streams.stderr, 'audit validate requires --file <audit.jsonl>');
      return 1;
    }
    let input;
    try {
      input = loadTextFile(flags.file);
    } catch (error) {
      write(streams.stderr, `Failed to read audit JSONL: ${error.message}`);
      return 1;
    }
    const result = validateAuditJsonl(input);
    if (flags.json) {
      renderJson(streams.stdout, result);
    } else if (result.valid) {
      write(streams.stdout, `Audit validation passed for ${result.rowCount} row(s).`);
    } else {
      write(streams.stdout, 'Audit validation failed:');
      for (const finding of result.findings) {
        write(streams.stdout, `- ${finding.id} [${finding.severity}] ${finding.message}`);
      }
    }
    return result.valid ? 0 : 1;
  }

  if (action === 'export') {
    const exportAction = positional[2];
    if (exportAction === 'classify') {
      if (!flags.file) {
        write(streams.stderr, 'audit export classify requires --file <audit-export.json>');
        return 1;
      }
      let input;
      try {
        input = loadJsonFile(flags.file);
      } catch (error) {
        write(streams.stderr, `Failed to read audit export JSON: ${error.message}`);
        return 1;
      }
      const tenant = tenantFromFlags(flags);
      const payload = buildAuditExportClassify(input, {
        tenant,
        token: flags.token,
      });
      if (flags.json) {
        renderJson(streams.stdout, payload);
      } else {
        write(streams.stdout, `Classified ${payload.filteredRowCount}/${payload.rowCount} rows`);
        write(streams.stdout, `Top intents: ${payload.topIntents.join(', ') || '(none)'}`);
        write(streams.stdout, `Next: ${payload.nextSafeStep}`);
      }
      return 0;
    }

    if (exportAction === 'plan') {
      const tenant = tenantFromFlags(flags);
      if (!tenant) {
        write(streams.stderr, 'audit export plan requires --sandbox or --prod.');
        return 2;
      }
      const payload = buildAuditExportPlan({
        tenant,
        token: flags.token,
        startingOn: flags['starting-on'] || flags.startingOn,
        endingBefore: flags['ending-before'] || flags.endingBefore,
        limit: flags.limit,
        sort: flags.sort,
      });
      if (flags.json) {
        renderJson(streams.stdout, payload);
      } else {
        write(streams.stdout, 'Audit export plan (read-planned, not live by default)');
        write(streams.stdout, payload.nextSafeStep);
      }
      return 0;
    }

    write(streams.stderr, 'Try: metro audit export classify --file <export.json> [--token <name>] [--json]');
    write(streams.stderr, '     metro audit export plan --token <name> (--sandbox|--prod) [--json]');
    return 1;
  }

  if (action === 'write') {
    if (!flags.file) {
      write(streams.stderr, 'audit write requires --file <audit-rows.jsonl>');
      return 1;
    }
    if (!flags.out) {
      write(streams.stderr, 'audit write requires --out <audit.jsonl>');
      return 1;
    }
    const wantsDryRun = flags['dry-run'] === true;
    const wantsWrite = flags.write === true;
    if (wantsDryRun === wantsWrite) {
      write(streams.stderr, 'audit write requires exactly one of --dry-run or --write');
      return 1;
    }

    let input;
    try {
      input = loadTextFile(flags.file);
    } catch (error) {
      write(streams.stderr, `Failed to read audit JSONL: ${error.message}`);
      return 1;
    }

    const plan = buildAuditWritePlan({
      auditText: input,
      auditPath: flags.file,
      outPath: flags.out,
      mode: wantsDryRun ? 'dry-run' : 'write',
    });
    const result = wantsWrite ? writeAuditJsonl(plan) : plan;

    if (flags.json) {
      renderJson(streams.stdout, result);
    } else if (!result.blocked) {
      write(streams.stdout, `Audit ${result.mode} prepared for ${result.source.rowCount} row(s).`);
      write(streams.stdout, `Target: ${result.target.path}`);
      write(streams.stdout, `Rows written: ${result.write.rowsWritten}`);
      write(streams.stdout, `Apply enabled in current CLI: ${result.applyEnabledInCurrentCli ? 'yes' : 'no'}`);
      write(streams.stdout, `Live apply authorized by this record: ${result.liveApplyAuthorizedByThisRecord ? 'yes' : 'no'}`);
    } else {
      write(streams.stdout, 'Audit write blocked:');
      for (const finding of result.findings) {
        write(streams.stdout, `- ${finding.id} [${finding.severity}] ${finding.message}`);
      }
    }
    return result.blocked ? 1 : 0;
  }

  write(streams.stderr, `Unknown audit command: ${action || '(missing)'}`);
  write(streams.stderr, 'Try: metro audit template | metro audit validate | metro audit export classify | metro audit export plan | metro audit write');
  return 1;
}

function runApplyGateCommand(positional, flags, streams) {
  const action = positional[1];

  if (action === 'template') {
    if (!flags.workflow) {
      write(streams.stderr, 'apply-gate template requires --workflow <workflow>');
      return 1;
    }
    if (!flags.shape) {
      write(streams.stderr, 'apply-gate template requires --shape <shape>');
      return 1;
    }
    if (flags.sandbox && flags.prod) {
      write(streams.stderr, 'Choose at most one tenant for the template: --sandbox or --prod.');
      return 2;
    }
    const template = buildApplyGateTemplate({
      workflow: flags.workflow,
      shape: flags.shape,
      tenant: tenantFromFlags(flags) || '<sandbox|production>',
    });
    if (!template) {
      write(streams.stderr, `Unsupported apply-gate pair: ${flags.workflow} ${flags.shape}`);
      return 1;
    }
    if (flags.json) {
      renderJson(streams.stdout, template);
    } else {
      write(streams.stdout, `Apply gate template for ${template.workflow} ${template.shape}`);
      write(streams.stdout, `Tenant: ${template.tenant}`);
      write(streams.stdout, `Apply enabled in current CLI: ${template.applyEnabledInCurrentCli ? 'yes' : 'no'}`);
    }
    return 0;
  }

  if (action === 'validate') {
    if (!flags.file) {
      write(streams.stderr, 'apply-gate validate requires --file <apply-gate.json>');
      return 1;
    }
    let input;
    let resolvedFile;
    try {
      resolvedFile = path.resolve(flags.file);
      input = loadJsonFile(resolvedFile);
    } catch (error) {
      write(streams.stderr, `Failed to read apply-gate JSON/YAML: ${error.message}`);
      return 1;
    }

    const result = validateApplyGate(input, { rootDir: path.dirname(resolvedFile) });
    if (flags.json) {
      renderJson(streams.stdout, result);
    } else if (result.valid) {
      write(streams.stdout, `Apply gate validation passed for ${result.workflow} ${result.shape}.`);
      write(streams.stdout, `Apply enabled in current CLI: ${result.applyEnabledInCurrentCli ? 'yes' : 'no'}`);
    } else {
      write(streams.stdout, 'Apply gate validation failed:');
      for (const finding of result.findings) {
        write(streams.stdout, `- ${finding.id} [${finding.severity}] ${finding.message}`);
      }
    }
    return result.valid ? 0 : 1;
  }

  write(streams.stderr, `Unknown apply-gate command: ${action || '(missing)'}`);
  return 1;
}

function runApprovalRecordCommand(positional, flags, streams) {
  const action = positional[1];

  if (action === 'template') {
    if (!flags['apply-gate']) {
      write(streams.stderr, 'approval-record template requires --apply-gate <apply-gate.json>');
      return 1;
    }

    let applyGate;
    try {
      applyGate = loadJsonFile(flags['apply-gate']);
    } catch (error) {
      write(streams.stderr, `Failed to read workflow apply-gate JSON/YAML: ${error.message}`);
      return 1;
    }

    const template = buildWorkflowApprovalRecordTemplate({
      applyGate,
      applyGatePath: flags['apply-gate'],
      approvalId: flags['approval-id'] || null,
      requestedBy: flags['requested-by'] || null,
      approvedBy: flags['approved-by'] || null,
      owner: flags.owner || null,
      businessPurpose: flags['business-purpose'] || null,
      expiresAt: flags['expires-at'] || null,
    });
    if (!template) {
      write(streams.stderr, 'approval-record template requires a valid metro.apply-gate.v1 file for a supported workflow apply gate.');
      return 1;
    }
    if (flags.json) {
      renderJson(streams.stdout, template);
    } else {
      write(streams.stdout, `Workflow approval-record template for ${template.binding.workflow} ${template.binding.shape} on ${template.binding.tenant}.`);
      write(streams.stdout, `Approval ID: ${template.approval.approvalId}`);
      write(streams.stdout, `Apply-gate file hash: ${template.applyGate.fileHash}`);
      write(streams.stdout, `Workflow apply enabled: ${template.futureApply.enabledInCurrentCli ? 'yes' : 'no'}`);
      write(streams.stdout, `Live apply authorized by this record: ${template.liveApplyAuthorizedByThisRecord ? 'yes' : 'no'}`);
    }
    return 0;
  }

  if (action === 'validate') {
    if (!flags.file) {
      write(streams.stderr, 'approval-record validate requires --file <workflow-approval-record.json>');
      return 1;
    }
    let input;
    let resolvedFile;
    try {
      resolvedFile = path.resolve(flags.file);
      input = loadJsonFile(resolvedFile);
    } catch (error) {
      write(streams.stderr, `Failed to read workflow approval-record JSON/YAML: ${error.message}`);
      return 1;
    }

    const result = validateWorkflowApprovalRecord(input, { rootDir: path.dirname(resolvedFile) });
    if (flags.json) {
      renderJson(streams.stdout, result);
    } else if (result.valid) {
      write(streams.stdout, `Workflow approval-record validation passed for ${result.summary.workflow} ${result.summary.shape}.`);
      write(streams.stdout, `Workflow apply enabled: ${result.applyEnabledInCurrentCli ? 'yes' : 'no'}`);
      write(streams.stdout, `Live apply authorized by this record: ${result.liveApplyAuthorizedByThisRecord ? 'yes' : 'no'}`);
    } else {
      write(streams.stdout, 'Workflow approval-record validation failed:');
      for (const finding of result.findings) {
        write(streams.stdout, `- ${finding.id} [${finding.severity}] ${finding.message}`);
      }
    }
    return result.valid ? 0 : 1;
  }

  write(streams.stderr, `Unknown approval-record command: ${action || '(missing)'}`);
  return 1;
}

function runApplyReadbackCommand(positional, flags, streams) {
  const action = positional[1];
  if (action !== 'verify') {
    write(streams.stderr, `Unknown apply-readback command: ${action || '(missing)'}`);
    return 1;
  }

  if (!flags.audit) {
    write(streams.stderr, 'apply-readback verify requires --audit <audit.jsonl>');
    return 1;
  }
  const inspectOutputPaths = [
    ...(flags['inspect-output'] ? [flags['inspect-output']] : []),
    ...splitCommaSeparatedPaths(flags['inspect-outputs']),
  ];
  if (inspectOutputPaths.length === 0) {
    write(streams.stderr, 'apply-readback verify requires --inspect-output <inspect-output.json> or --inspect-outputs <inspect-output-a.json,inspect-output-b.json>');
    return 1;
  }

  let auditText;
  try {
    auditText = loadTextFile(flags.audit);
  } catch (error) {
    write(streams.stderr, `Failed to read workflow audit JSONL: ${error.message}`);
    return 1;
  }

  let inspectOutputs;
  try {
    inspectOutputs = inspectOutputPaths.map((filePath) => ({
      filePath,
      output: loadJsonFile(filePath),
    }));
  } catch (error) {
    write(streams.stderr, `Failed to read inspect-output JSON/YAML: ${error.message}`);
    return 1;
  }

  const result = verifyWorkflowApplyReadback({
    auditText,
    auditPath: flags.audit,
    inspectOutputs,
    rowNumber: flags.row || null,
  });

  if (flags.json) {
    renderJson(streams.stdout, result);
  } else if (result.valid) {
    write(streams.stdout, `Workflow apply-readback verification passed for ${result.summary.workflow} ${result.summary.shape}.`);
    write(streams.stdout, `Inspect workflow: ${(result.summary.inspectWorkflows || [result.summary.inspectWorkflow]).filter(Boolean).join(', ')}`);
    write(streams.stdout, `Evidence-bound checks: ${result.summary.evidenceBoundChecks}/${result.summary.plannedReadBackChecks}`);
    write(streams.stdout, `Live apply enabled: ${result.summary.liveApplyEnabledInCurrentCli ? 'yes' : 'no'}`);
    write(streams.stdout, `Live read enabled: ${result.summary.liveReadEnabledInCurrentCli ? 'yes' : 'no'}`);
  } else {
    write(streams.stdout, 'Workflow apply-readback verification blocked:');
    for (const finding of result.findings) {
      write(streams.stdout, `- ${finding.id} [${finding.severity}] ${finding.message}`);
    }
  }

  return result.valid ? 0 : 1;
}

function inspectWorkflowFor(positional) {
  if (positional[0] === 'customer' && positional[1] === 'billing-state') {
    return 'customer.billing-state';
  }
  if (positional[0] === 'package' && positional[1] === 'inspect') {
    return 'package.inspect';
  }
  if (positional[0] === 'product' && positional[1] === 'inspect') {
    return 'product.inspect';
  }
  if (positional[0] === 'billing-provider' && positional[1] === 'inspect') {
    return 'billing-provider.inspect';
  }
  if (positional[0] === 'contract' && positional[1] === 'inspect') {
    return 'contract.inspect';
  }
  if (positional[0] === 'invoice' && positional[1] === 'inspect') {
    return 'invoice.inspect';
  }
  if (positional[0] === 'subscription' && positional[1] === 'history' && positional[2] === 'inspect') {
    return 'subscription.history.inspect';
  }
  return null;
}

function runInspectPlanCommand(positional, flags, streams) {
  const workflow = inspectWorkflowFor(positional);
  if (!workflow) return null;

  const definition = getInspectPlanDefinition(workflow);
  if (!definition) {
    write(streams.stderr, `Unsupported inspect workflow: ${workflow}`);
    return 1;
  }

  if (!flags.plan) {
    return safetyRefusal(
      positional,
      streams,
      'Live inspect execution is not implemented in the offline CLI slice.',
      `Use ${definition.command} --json to review the local read plan without calling Metronome.`,
    );
  }

  const tenant = resolveTenant(flags, streams, 'Inspect plan');
  if (!tenant) return 2;

  const identifierDefinitions = [
    {
      flag: definition.identifierFlag,
      name: definition.identifierName,
    },
    ...(definition.additionalIdentifiers || []),
  ];
  const identifiers = identifierDefinitions.reduce((collected, identifier) => ({
    ...collected,
    [identifier.name]: flags[identifier.flag],
  }), {});
  const planOptions = { tenant };
  let timestampFindings = [];
  if (workflow === 'contract.inspect' && Object.prototype.hasOwnProperty.call(flags, 'at')) {
    timestampFindings = validateHourBoundaryTimestamp('at', flags.at);
    if (timestampFindings.length === 0) {
      planOptions.templateValues = {
        'hour-boundary timestamp': flags.at,
      };
    }
  }

  const plan = buildInspectPlan(workflow, identifiers, planOptions);

  if (timestampFindings.length > 0) {
    const validation = plan.valid === false
      ? { ...plan, findings: [...plan.findings, ...timestampFindings] }
      : {
        schemaVersion: 'metro.inspect.plan.validation.v1',
        workflow,
        valid: false,
        findings: timestampFindings,
      };
    if (flags.json) {
      renderJson(streams.stdout, validation);
    } else {
      write(streams.stdout, `Inspect plan validation failed for ${workflow}:`);
      for (const finding of validation.findings) {
        write(streams.stdout, `- ${finding.id} [${finding.severity}] ${finding.message}`);
      }
    }
    return 1;
  }

  if (plan.valid === false) {
    if (flags.json) {
      renderJson(streams.stdout, plan);
    } else {
      write(streams.stdout, `Inspect plan validation failed for ${workflow}:`);
      for (const finding of plan.findings) {
        write(streams.stdout, `- ${finding.id} [${finding.severity}] ${finding.message}`);
      }
    }
    return 1;
  }

  if (flags.json) {
    renderJson(streams.stdout, plan);
  } else {
    write(streams.stdout, `${plan.title} for ${plan.tenant}.`);
    write(streams.stdout, `Target: ${Object.entries(plan.target.identifiers).map(([name, value]) => `${name}=${value}`).join(', ')}`);
    write(streams.stdout, `Live execution enabled: ${plan.liveExecution.enabledInCurrentCli ? 'yes' : 'no'}`);
    write(streams.stdout, 'Planned read endpoints:');
    for (const endpoint of plan.endpointPlan) {
      write(streams.stdout, `- ${endpoint.method} ${endpoint.path}`);
    }
  }

  return 0;
}

function runPreflightCommand(positional, flags, streams) {
  const action = positional[1];

  if (action === 'template') {
    if (!flags.workflow) {
      write(streams.stderr, 'preflight template requires --workflow <workflow>');
      return 1;
    }
    if (!flags.shape) {
      write(streams.stderr, 'preflight template requires --shape <shape>');
      return 1;
    }
    if (flags.sandbox && flags.prod) {
      write(streams.stderr, 'Choose at most one tenant for the template: --sandbox or --prod.');
      return 2;
    }

    const template = buildPreflightTemplate({
      workflow: flags.workflow,
      shape: flags.shape,
      tenant: tenantFromFlags(flags) || '<sandbox|production>',
    });
    if (!template) {
      write(streams.stderr, `Unsupported preflight pair: ${flags.workflow} ${flags.shape}`);
      return 1;
    }
    if (flags.json) {
      renderJson(streams.stdout, template);
    } else {
      write(streams.stdout, `Preflight template for ${flags.workflow} ${flags.shape}`);
      write(streams.stdout, `Tenant: ${template.tenant}`);
      write(streams.stdout, `Apply enabled in current CLI: ${template.execution.enabledInCurrentCli ? 'yes' : 'no'}`);
      write(streams.stdout, `Endpoints: ${template.execution.endpoints.map((endpoint) => `${endpoint.method} ${endpoint.path}`).join(', ')}`);
    }
    return 0;
  }

  if (action === 'validate') {
    if (!flags.file) {
      write(streams.stderr, 'preflight validate requires --file <preflight.json>');
      return 1;
    }
    let input;
    try {
      input = loadJsonFile(flags.file);
    } catch (error) {
      write(streams.stderr, `Failed to read preflight JSON/YAML: ${error.message}`);
      return 1;
    }

    const result = validatePreflight(input);
    if (flags.json) {
      renderJson(streams.stdout, result);
    } else if (result.valid) {
      write(streams.stdout, 'Preflight validation passed.');
    } else {
      write(streams.stdout, 'Preflight validation failed:');
      for (const finding of result.findings) {
        write(streams.stdout, `- ${finding.id} [${finding.severity}] ${finding.message}`);
      }
    }
    return result.valid ? 0 : 1;
  }

  write(streams.stderr, `Unknown preflight command: ${action || '(missing)'}`);
  return 1;
}

function runProofCommand(positional, flags, streams) {
  const action = positional[1];

  if (action === 'sandbox-template') {
    if (!flags.workflow) {
      write(streams.stderr, 'proof sandbox-template requires --workflow <workflow>');
      return 1;
    }
    if (!flags.shape) {
      write(streams.stderr, 'proof sandbox-template requires --shape <shape>');
      return 1;
    }

    const template = buildSandboxProofTemplate({
      workflow: flags.workflow,
      shape: flags.shape,
    });
    if (!template) {
      write(streams.stderr, `Unsupported sandbox proof pair: ${flags.workflow} ${flags.shape}`);
      return 1;
    }
    if (flags.json) {
      renderJson(streams.stdout, template);
    } else {
      write(streams.stdout, `Sandbox proof template for ${template.workflow} ${template.shape}`);
      write(streams.stdout, `Tenant: ${template.tenant}`);
      write(streams.stdout, `Production apply allowed: ${template.maturityGate.productionApplyAllowed ? 'yes' : 'no'}`);
      write(streams.stdout, `Endpoints: ${template.sandboxExecution.endpoints.map((endpoint) => `${endpoint.method} ${endpoint.path}`).join(', ')}`);
    }
    return 0;
  }

  if (action === 'validate') {
    if (!flags.file) {
      write(streams.stderr, 'proof validate requires --file <sandbox-proof.json>');
      return 1;
    }
    let input;
    try {
      input = loadJsonFile(flags.file);
    } catch (error) {
      write(streams.stderr, `Failed to read sandbox proof JSON/YAML: ${error.message}`);
      return 1;
    }

    const result = validateSandboxProof(input);
    if (flags.json) {
      renderJson(streams.stdout, result);
    } else if (result.valid) {
      write(streams.stdout, 'Sandbox proof validation passed.');
    } else {
      write(streams.stdout, 'Sandbox proof validation failed:');
      for (const finding of result.findings) {
        write(streams.stdout, `- ${finding.id} [${finding.severity}] ${finding.message}`);
      }
    }
    return result.valid ? 0 : 1;
  }

  write(streams.stderr, `Unknown proof command: ${action || '(missing)'}`);
  return 1;
}

function runVerifyCommand(positional, flags, streams) {
  const action = positional[1];
  if ((action === undefined && flags['audit-log']) || action === 'audit-log') {
    const auditLogPath = flags['audit-log'] || flags.file;
    if (!auditLogPath) {
      write(streams.stderr, 'verify --audit-log requires <audit.jsonl> or verify audit-log --file <audit.jsonl>');
      return 1;
    }

    let auditText;
    try {
      auditText = loadTextFile(auditLogPath);
    } catch (error) {
      write(streams.stderr, `Failed to read audit log JSONL: ${error.message}`);
      return 1;
    }

    const result = verifyAuditLog(auditText, { sourcePath: auditLogPath });
    if (flags.json) {
      renderJson(streams.stdout, result);
    } else if (result.valid) {
      write(streams.stdout, `audit-log verification passed for ${result.summary.rowCount} row(s).`);
      write(streams.stdout, `Evidence status: ${result.summary.evidenceStatus}`);
    } else {
      write(streams.stdout, 'audit-log verification failed:');
      for (const finding of result.findings) {
        write(streams.stdout, `- ${finding.id} [${finding.severity}] ${finding.message}`);
      }
    }
    return result.valid ? 0 : 1;
  }

  if (!['inspect-output', 'apply-result', 'apply-result-template'].includes(action)) {
    return null;
  }

  if (action === 'apply-result-template') {
    if (!flags.workflow) {
      write(streams.stderr, 'verify apply-result-template requires --workflow <workflow>');
      return 1;
    }
    if (!flags.shape) {
      write(streams.stderr, 'verify apply-result-template requires --shape <shape>');
      return 1;
    }
    if (flags.sandbox && flags.prod) {
      write(streams.stderr, 'Choose at most one tenant for the template: --sandbox or --prod.');
      return 2;
    }

    const template = buildApplyResultTemplate({
      workflow: flags.workflow,
      shape: flags.shape,
      tenant: tenantFromFlags(flags) || '<sandbox|production>',
    });
    if (!template) {
      write(streams.stderr, `Unsupported apply-result template pair: ${flags.workflow} ${flags.shape}`);
      return 1;
    }
    if (flags.json) {
      renderJson(streams.stdout, template);
    } else {
      write(streams.stdout, `Apply-result template for ${template.workflow} ${template.shape}`);
      write(streams.stdout, `Tenant: ${template.tenant}`);
      write(streams.stdout, `Apply enabled in current CLI: ${template.applyEnabledInCurrentCli ? 'yes' : 'no'}`);
      write(streams.stdout, `Required writes: ${template.requiredWriteEndpoints.map((item) => `${item.method} ${item.path}`).join(', ')}`);
    }
    return 0;
  }

  if (!flags.file) {
    write(streams.stderr, `verify ${action} requires --file <${action}.json>`);
    return 1;
  }

  let input;
  try {
    input = loadJsonFile(flags.file);
  } catch (error) {
    write(streams.stderr, `Failed to read verify input JSON/YAML: ${error.message}`);
    return 1;
  }

  const result = action === 'inspect-output'
    ? verifyInspectOutput(input)
    : verifyApplyResult(input);
  if (flags.json) {
    renderJson(streams.stdout, result);
  } else if (result.valid) {
    write(streams.stdout, `${action} verification passed for ${result.inspectedSchemaVersion}.`);
  } else {
    write(streams.stdout, `${action} verification failed:`);
    for (const finding of result.findings) {
      write(streams.stdout, `- ${finding.id} [${finding.severity}] ${finding.message}`);
    }
  }
  return result.valid ? 0 : 1;
}

function safetyRefusal(positional, streams, reason, nextSafeStep, nextCommands = null) {
  const command = positional.join(' ');
  const payload = buildRefusal({
    command,
    reason: reason || 'This command is not available in the current CLI release.',
    nextSafeStep,
    nextCommands: nextCommands || [
      'metro schema --json',
      'metro docs explain first-safe-preview --json',
    ],
  });
  renderJson(streams.stderr, payload);
  return 2;
}

function run(argv = process.argv.slice(2), streams = { stdout: process.stdout, stderr: process.stderr }) {
  const { flags, positional } = parseArgs(argv);

  if (flags.workspace && flags.workspace !== true) {
    try {
      setSessionWorkspacePack(flags.workspace);
    } catch (error) {
      write(streams.stderr, error.message);
      return 1;
    }
  }

  if (flags.help || positional.length === 0) {
    printHelp(streams.stdout);
    return 0;
  }

  const apiResult = runApiCommand(positional, flags, streams);
  if (apiResult !== null) {
    return apiResult;
  }

  if (positional[0] === 'input') {
    return runInputCommand(positional, flags, streams);
  }

  if (previewDefinitionFor(positional)) {
    return runPreviewCommand(positional, flags, streams);
  }

  if (positional[0] === 'preflight') {
    return runPreflightCommand(positional, flags, streams);
  }

  if (positional[0] === 'audit') {
    return runAuditCommand(positional, flags, streams);
  }

  if (positional[0] === 'apply-gate') {
    return runApplyGateCommand(positional, flags, streams);
  }

  if (positional[0] === 'approval-record') {
    return runApprovalRecordCommand(positional, flags, streams);
  }

  if (positional[0] === 'apply-readback') {
    return runApplyReadbackCommand(positional, flags, streams);
  }

  if (positional[0] === 'setup') {
    return runSetupCommand(positional, flags, streams);
  }

  if (positional[0] === 'mode') {
    return runModeCommand(positional, flags, streams);
  }

  if (positional[0] === 'status') {
    return runStatusCommand(flags, streams);
  }

  if (positional[0] === 'doctor') {
    return runInstallDoctorCommand(flags, streams);
  }

  if (positional[0] === 'harness') {
    return runHarnessCommand(positional, flags, streams);
  }

  if (positional[0] === 'dimensional') {
    return runDimensionalCommand(positional, flags, streams, argv);
  }

  if (positional[0] === 'contract' && positional[1] === 'move-plan' && ['preflight', 'apply', 'bulk-preflight', 'bulk-apply'].includes(positional[2])) {
    const out = runContractMovePlanCommand(positional, flags, streams, argv);
    if (out && typeof out.then === 'function') {
      return out;
    }
    return out;
  }

  if (positional[0] === 'customer' && positional[1] === 'resolve') {
    return runContractMovePlanCommand(positional, flags, streams, argv);
  }

  if (positional[0] === 'customer' && positional[1] === 'balances') {
    return runCustomerBalancesCommand(positional, flags, streams, argv);
  }

  if (positional[0] === 'ops') {
    return runOpsCommand(positional, flags, streams, argv);
  }

  if (positional[0] === 'catalog' && (positional[1] === 'bind' || flags.show === true)) {
    return runCatalogBindCommand(positional, flags, streams, argv);
  }

  if (positional[0] === 'tenant' && (positional[1] === 'snapshot' || positional[1] === 'show')) {
    return runTenantSnapshotCommand(positional, flags, streams);
  }

  if (positional[0] === 'contract' && positional[1] === 'extend-trial') {
    return runContractExtendTrialCommand(positional, flags, streams, argv);
  }

  if (positional[0] === 'contract' && positional[1] === 'expire') {
    return runContractExpireCommand(positional, flags, streams, argv);
  }

  if (positional[0] === 'ledger-adjustment' && (positional[1] === 'preflight' || positional[1] === 'apply')) {
    return runLedgerAdjustmentCommand(positional, flags, streams, argv);
  }

  if (positional[0] === 'package' && positional[1] === 'customers') {
    return runPackageCustomersCommand(positional, flags, streams, argv);
  }

  if (positional[0] === 'package' && positional[1] === 'list') {
    return runPackageListCommand(positional, flags, streams, argv);
  }

  if (positional[0] === 'contract' && positional[1] === 'repair-accidental' && (positional[2] === 'preflight' || positional[2] === 'apply')) {
    return runContractRepairAccidentalCommand(positional, flags, streams, argv);
  }

  if (positional[0] === 'billing-provider' && positional[1] === 'cutover' && (positional[2] === 'preflight' || positional[2] === 'apply')) {
    return runBillingProviderCutoverCommand(positional, flags, streams, argv);
  }

  if (positional[0] === 'workspace') {
    return runWorkspaceCommand(positional, flags, streams);
  }

  if (positional[0] === 'plan') {
    return runPlanCommand(positional, flags, streams);
  }

  if (positional[0] === 'route') {
    return runRouteCommand(flags, streams);
  }

  if (positional[0] === 'source-boundary') {
    return runSourceBoundaryCommand(positional, flags, streams);
  }

  if (positional[0] === 'release') {
    return runReleaseCommand(positional, flags, streams);
  }

  if (positional[0] === 'proof') {
    return runProofCommand(positional, flags, streams);
  }

  if (positional[0] === 'verify') {
    const verifyResult = runVerifyCommand(positional, flags, streams);
    if (verifyResult !== null) {
      return verifyResult;
    }
  }

  const inspectPlanResult = runInspectPlanCommand(positional, flags, streams);
  if (inspectPlanResult !== null) {
    return inspectPlanResult;
  }

  if (positional[0] === 'product' && positional[1] === 'retire' && positional[2] === 'apply') {
    return safetyRefusal(
      positional,
      streams,
      'Product retirement apply is blocked until inspected rate schedules, sandbox proof, audit logs, production hash confirmation, read-back verification, rollback evidence, and owner approval exist.',
      'Use metro product retire preview --file <input.json|yaml> (--sandbox|--prod) --json to review the local rate-close and optional archive plan without calling Metronome.',
    );
  }

  if (positional[0] === 'package' && positional[1] === 'archive' && positional[2] === 'apply') {
    return safetyRefusal(
      positional,
      streams,
      'Package archive apply is blocked until replacement alias handoff evidence, sandbox proof, audit logs, production hash confirmation, read-back verification, rollback evidence, and owner approval exist.',
      'Use metro package archive preview --file <input.json|yaml> (--sandbox|--prod) --json to review the local alias-live archive plan without calling Metronome.',
    );
  }

  if (positional[0] === 'customer' && positional[1] === 'setup' && positional[2] === 'apply') {
    return safetyRefusal(
      positional,
      streams,
      'Customer setup apply is blocked until duplicate customer state, archived alias collision checks, sandbox proof, audit logs, production hash confirmation, read-back verification, invoice-side-effect proof, and owner approval exist.',
      'Use metro customer setup preview --file <input.json|yaml> (--sandbox|--prod) --json to review the local customer setup plan without calling Metronome.',
    );
  }

  if (positional[0] === 'invoice' && positional[1] === 'issue-date' && positional[2] === 'apply') {
    return safetyRefusal(
      positional,
      streams,
      'Invoice issue-date apply is blocked until draft invoice state, contract end evidence, Stripe behavior, sandbox proof, audit logs, read-back verification, remediation evidence, and owner approval exist.',
      'Use metro invoice issue-date preview --file <input.json|yaml> (--sandbox|--prod) --json to review the local issue-date update plan without calling Metronome.',
    );
  }

  if (positional[0] === 'subscription' && positional[1] === 'contract' && positional[2] === 'apply') {
    return safetyRefusal(
      positional,
      streams,
      'Direct subscription contract apply is blocked until subscription rate-card evidence, sandbox proof, audit logs, production hash confirmation, read-back verification, rollback evidence, and owner approval exist.',
      'Use metro subscription contract preview --file <input.json|yaml> (--sandbox|--prod) --json to review the local subscription contract plan without calling Metronome.',
    );
  }

  if (positional[0] === 'usage' && positional[1] === 'ingest' && positional[2] === 'apply') {
    return safetyRefusal(
      positional,
      streams,
      'Usage ingest apply is blocked until preview-events proof, canary support, audit logs, production hash confirmation, read-back verification, rollback evidence, and owner approval exist.',
      'Use metro usage ingest preview --file <input.json|yaml> (--sandbox|--prod) --json to review the local usage event plan without calling Metronome.',
    );
  }

  if (positional[0] === 'custom-contract' && positional[1] === 'apply') {
    return safetyRefusal(
      positional,
      streams,
      'Custom-contract apply is blocked until inspected current state, sandbox proof, audit logs, production hash confirmation, read-back verification, rollback evidence, and owner approval exist.',
      'Use metro custom-contract preview --file <input.json|yaml> (--sandbox|--prod) --json to review the local custom-contract payload plan without calling Metronome.',
    );
  }

  if (positional.includes('apply') || positional.includes('inspect') || positional.includes('preview') || positional.includes('verify')) {
    return safetyRefusal(positional, streams);
  }

  if (positional[0] === 'shape') {
    return runShapeCommand(positional, flags, streams);
  }

  if (positional[0] === 'validate') {
    return runValidateCommand(flags, streams);
  }

  if (positional[0] === 'docs') {
    return runDocsCommand(positional, flags, streams);
  }

  if (positional[0] === 'schema') {
    return runSchemaCommand(positional, flags, streams);
  }

  write(streams.stderr, `Unknown command: ${positional.join(' ')}`);
  return 1;
}

function main() {
  const code = run();
  if (code && typeof code.then === 'function') {
    code
      .then((exitCode) => {
        process.exitCode = exitCode;
      })
      .catch((error) => {
        process.stderr.write(`${error.stack || error.message || error}\n`);
        process.exitCode = 1;
      });
    return;
  }
  process.exitCode = code;
}

module.exports = {
  main,
  parseArgs,
  run,
};
