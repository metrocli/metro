#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const siteDir = __dirname;
const packageRoot = path.resolve(siteDir, '../../..');
const coreSrc = (...segments) => path.join(packageRoot, 'packages/metro-core/src', ...segments);
const htmlPath = path.join(siteDir, 'index.html');
const installPath = path.join(siteDir, 'install.html');
const integrationPath = path.join(siteDir, 'integration.html');
const agentsPath = path.join(siteDir, 'agents.html');
const commandReferencePath = path.join(siteDir, 'command-reference.html');
const explainReferencePath = path.join(siteDir, 'explain-reference.html');
const apiReferencePath = path.join(siteDir, 'api-reference.html');
const evidenceGateReferencePath = path.join(siteDir, 'evidence-gate-reference.html');
const inputReferencePath = path.join(siteDir, 'input-reference.html');
const shapeReferencePath = path.join(siteDir, 'shape-reference.html');
const validatorReferencePath = path.join(siteDir, 'validator-reference.html');
const gotchaReferencePath = path.join(siteDir, 'gotcha-reference.html');
const planningReadmePath = path.join(packageRoot, 'docs/metronome-cli/README.md');
const metronomeUpstreamPath = path.join(siteDir, 'metronome-upstream.html');
const htmlPagePaths = [
  htmlPath,
  installPath,
  integrationPath,
  agentsPath,
  metronomeUpstreamPath,
  commandReferencePath,
  explainReferencePath,
  apiReferencePath,
  evidenceGateReferencePath,
  inputReferencePath,
  shapeReferencePath,
  validatorReferencePath,
  gotchaReferencePath,
];
const sourcesPath = path.join(siteDir, 'sources.json');
const stylesPath = path.join(siteDir, 'styles.css');
const { apiReference } = require(coreSrc('docs/api-reference'));
const { renderApiReferenceHtml } = require(coreSrc('docs/api-reference-html'));
const { commandReference } = require(coreSrc('commands/catalog'));
const { renderCommandReferenceHtml } = require(coreSrc('docs/command-reference-html'));
const { docsExplainTopicIndex } = require(coreSrc('docs/explain'));
const { renderExplainReferenceHtml } = require(coreSrc('docs/explain-reference-html'));
const { evidenceGateReference } = require(coreSrc('docs/evidence-gate-reference'));
const { renderEvidenceGateReferenceHtml } = require(coreSrc('docs/evidence-gate-reference-html'));
const { gotchaReference } = require(coreSrc('docs/gotcha-reference'));
const { renderGotchaReferenceHtml } = require(coreSrc('docs/gotcha-reference-html'));
const { inputReference } = require(coreSrc('docs/input-reference'));
const { renderInputReferenceHtml } = require(coreSrc('docs/input-reference-html'));
const { shapeReference, validatorReference } = require(coreSrc('docs/shape-validator-reference'));
const { renderShapeReferenceHtml, renderValidatorReferenceHtml } = require(coreSrc('docs/shape-validator-reference-html'));
const { verifyInspectOutput } = require(coreSrc('verify/inspect-output'));

const requiredSections = [
  'home',
  'setup',
  'safety',
  'commands',
  'shapes',
  'validators',
  'gotchas',
  'proof',
  'try-it',
  'live-today',
  'quick-paths',
  'agents',
  'changelog',
  'sources',
];

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function readJson(file) {
  return JSON.parse(read(file));
}

function parseSourceIds(html) {
  const ids = new Set();
  const sourceAttr = /data-source="([^"]+)"/g;
  let match;
  while ((match = sourceAttr.exec(html)) !== null) {
    for (const token of match[1].trim().split(/\s+/)) {
      if (token) ids.add(token);
    }
  }
  return [...ids].sort();
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertIncludes(values, expected, message) {
  assert(Array.isArray(values), `${message}: expected an array`);
  assert(values.includes(expected), message);
}

function assertTextIncludesAll(text, expectedValues, context) {
  for (const expected of expectedValues) {
    assert(text.includes(expected), `${context} missing "${expected}"`);
  }
}

function assertNoTabs(text, context) {
  const firstTabIndex = text.indexOf('\t');
  assert(firstTabIndex === -1, `${context} contains a tab character near offset ${firstTabIndex}`);
}

function assertReferencePageIndex(reference, referenceHtml, ariaLabel, expectedIds, context) {
  assert(Array.isArray(reference.sectionNavigation), `${context} JSON missing section navigation`);
  assert(
    JSON.stringify(reference.sectionNavigation.map((section) => section.id)) === JSON.stringify(expectedIds),
    `${context} section navigation ids mismatch`,
  );
  assert(
    reference.sectionNavigation.every((section) => section.href === `#${section.id}`),
    `${context} section navigation hrefs must match ids`,
  );
  assert(
    referenceHtml.includes(`<nav class="reference-jumps" aria-label="${ariaLabel}">`),
    `${context} HTML missing page index navigation`,
  );
  assert(referenceHtml.includes('<strong>Page index</strong>'), `${context} HTML missing page index label`);
  for (const id of expectedIds) {
    assert(referenceHtml.includes(`href="#${id}"`), `${context} HTML missing page index link: #${id}`);
    assert(referenceHtml.includes(`id="${id}"`), `${context} HTML missing section anchor: ${id}`);
  }
}

function isExternalHref(href) {
  return /^https?:\/\//.test(href);
}

function isSkippedLocalReference(reference) {
  return (
    !reference
    || reference.startsWith('data:')
    || reference.startsWith('mailto:')
    || reference.startsWith('tel:')
    || reference.startsWith('javascript:')
    || isExternalHref(reference)
  );
}

function htmlIds(html) {
  const ids = new Set();
  const idAttr = /\bid="([^"]+)"/g;
  let match;
  while ((match = idAttr.exec(html)) !== null) {
    ids.add(match[1]);
  }
  return ids;
}

function splitLocalReference(reference) {
  const hashIndex = reference.indexOf('#');
  const beforeHash = hashIndex === -1 ? reference : reference.slice(0, hashIndex);
  const fragment = hashIndex === -1 ? '' : reference.slice(hashIndex + 1);
  const queryIndex = beforeHash.indexOf('?');
  const filePart = queryIndex === -1 ? beforeHash : beforeHash.slice(0, queryIndex);
  return { filePart, fragment };
}

function verifyLocalReference(fromFile, reference, label) {
  if (isSkippedLocalReference(reference)) return 0;

  const { filePart, fragment } = splitLocalReference(reference);
  const targetFile = filePart
    ? path.resolve(path.dirname(fromFile), filePart)
    : fromFile;
  assert(fs.existsSync(targetFile), `${label} points at missing local file: ${reference}`);

  if (fragment && path.extname(targetFile) === '.html') {
    assert(htmlIds(read(targetFile)).has(fragment), `${label} points at missing local anchor: ${reference}`);
  }

  return 1;
}

function verifyHtmlLocalReferences(pagePath, html) {
  let verified = 0;
  const attr = /\b(?:href|src)="([^"]+)"/g;
  let match;
  while ((match = attr.exec(html)) !== null) {
    verified += verifyLocalReference(pagePath, match[1], path.basename(pagePath));
  }
  return verified;
}

function verifyCssLocalReferences(cssPath, css) {
  let verified = 0;
  const url = /url\(([^)]+)\)/g;
  let match;
  while ((match = url.exec(css)) !== null) {
    const reference = match[1].trim().replace(/^['"]|['"]$/g, '');
    verified += verifyLocalReference(cssPath, reference, path.basename(cssPath));
  }
  return verified;
}

function verifyLocalHref(sourceId, href) {
  if (isExternalHref(href)) return;
  const resolved = path.resolve(siteDir, href);
  assert(fs.existsSync(resolved), `Source "${sourceId}" points at missing local file: ${href}`);
}

function assertSideEffectProfileCoverage(reference, apiReferenceHtml) {
  const endpointsRequiringProfiles = reference.endpoints.filter((endpoint) => (
    endpoint.operationType === 'write' || endpoint.operationType === 'preview'
  ));
  assert(endpointsRequiringProfiles.length > 0, 'API reference has no write or live-preview endpoints to check');

  const renderedProfileCount = (apiReferenceHtml.match(/<h3>Side-effect profile<\/h3>/g) || []).length;
  assert(
    renderedProfileCount >= endpointsRequiringProfiles.length,
    `api-reference.html renders ${renderedProfileCount} side-effect profile section(s), expected at least ${endpointsRequiringProfiles.length}`,
  );

  for (const endpoint of endpointsRequiringProfiles) {
    const profile = endpoint.sideEffectProfile;
    assert(profile, `API endpoint ${endpoint.id} is ${endpoint.operationType} but has no sideEffectProfile`);
    assert(profile.schemaVersion === 'metro.api.side-effect-profile.v1', `API endpoint ${endpoint.id} sideEffectProfile schema mismatch`);
    assert(profile.riskClass, `API endpoint ${endpoint.id} sideEffectProfile missing riskClass`);
    assert(profile.summary, `API endpoint ${endpoint.id} sideEffectProfile missing summary`);
    assert(Array.isArray(profile.futureLiveSideEffects) && profile.futureLiveSideEffects.length > 0, `API endpoint ${endpoint.id} sideEffectProfile missing futureLiveSideEffects`);
    assert(Array.isArray(profile.requiredReviews) && profile.requiredReviews.length > 0, `API endpoint ${endpoint.id} sideEffectProfile missing requiredReviews`);
    assert(Array.isArray(profile.rollbackOrRemediation) && profile.rollbackOrRemediation.length > 0, `API endpoint ${endpoint.id} sideEffectProfile missing rollbackOrRemediation`);
    assert(Array.isArray(profile.sources) && profile.sources.length > 0, `API endpoint ${endpoint.id} sideEffectProfile missing sources`);
    assert(apiReferenceHtml.includes(profile.riskClass), `api-reference.html missing side-effect risk class for ${endpoint.id}`);
    assert(apiReferenceHtml.includes(profile.summary), `api-reference.html missing side-effect summary for ${endpoint.id}`);
  }
}

function assertUnsupportedExpertApiLiveVerbs(reference, commandReferenceHtml) {
  const unsupportedById = Object.fromEntries((reference.unsupportedCommands || []).map((command) => [command.id, command]));
  const supportedById = Object.fromEntries((reference.commands || []).map((command) => [command.id, command]));
  const readCommand = supportedById['api.read'];
  const applyCommand = supportedById['api.apply'];
  const legacyReadBlocked = unsupportedById['api.read.legacy-blocked'];
  const legacyApplyBlocked = unsupportedById['api.apply.legacy-blocked'];
  const readPlanCommand = supportedById['api.read-plan'];
  const readPreflightCommand = supportedById['api.read-preflight'];
  const readGateTemplateCommand = supportedById['api.read-gate.template'];
  const readGateValidateCommand = supportedById['api.read-gate.validate'];
  const readMockCommand = supportedById['api.read-mock'];
  const readPipelineCommand = supportedById['api.read-pipeline'];
  const readResultVerifyCommand = supportedById['api.read-result.verify'];
  const readAuditTemplateCommand = supportedById['api.read-audit.template'];
  const readAuditWriteCommand = supportedById['api.read-audit.write'];
  const readAuditValidateCommand = supportedById['api.read-audit.validate'];
  const contractInspectPlanCommand = supportedById['contract.inspect.plan'];
  const workflowApprovalRecordTemplateCommand = supportedById['approval-record.template'];
  const workflowApprovalRecordValidateCommand = supportedById['approval-record.validate'];
  const workflowApplyReadbackVerifyCommand = supportedById['apply-readback.verify'];

  assert(readPlanCommand, 'command reference missing supported local api.read-plan entry');
  assert(readPlanCommand.status === 'local', 'api.read-plan must remain a supported local-only planning command');
  assert(readPlanCommand.mode === 'inspect-plan', 'api.read-plan must remain inspect-plan mode');
  assert(readPlanCommand.apiAccess === 'none', 'api.read-plan must not declare live API access');
  assert(readPreflightCommand, 'command reference missing supported local api.read-preflight entry');
  assert(readPreflightCommand.status === 'local', 'api.read-preflight must remain local-only');
  assert(readPreflightCommand.mode === 'explain', 'api.read-preflight must remain explain mode');
  assert(readPreflightCommand.apiAccess === 'none', 'api.read-preflight must not declare live API access');
  assert(readGateTemplateCommand, 'command reference missing supported local api.read-gate template entry');
  assert(readGateTemplateCommand.status === 'local', 'api.read-gate template must remain local-only');
  assert(readGateTemplateCommand.apiAccess === 'none', 'api.read-gate template must not declare live API access');
  assert(readGateValidateCommand, 'command reference missing supported local api.read-gate validate entry');
  assert(readGateValidateCommand.status === 'local', 'api.read-gate validate must remain local-only');
  assert(readGateValidateCommand.apiAccess === 'none', 'api.read-gate validate must not declare live API access');
  assert(readMockCommand, 'command reference missing supported local api.read-mock entry');
  assert(readMockCommand.status === 'local', 'api.read-mock must remain local-only');
  assert(readMockCommand.mode === 'verify', 'api.read-mock must remain verify mode');
  assert(readMockCommand.apiAccess === 'none', 'api.read-mock must not declare live API access');
  assert(readPipelineCommand, 'command reference missing supported local api.read-pipeline entry');
  assert(readPipelineCommand.status === 'local', 'api.read-pipeline must remain local-only');
  assert(readPipelineCommand.mode === 'audit', 'api.read-pipeline must remain audit mode');
  assert(readPipelineCommand.apiAccess === 'none', 'api.read-pipeline must not declare live API access');
  assert(readResultVerifyCommand, 'command reference missing supported local api.read-result verify entry');
  assert(readResultVerifyCommand.status === 'local', 'api.read-result verify must remain local-only');
  assert(readResultVerifyCommand.mode === 'verify', 'api.read-result verify must remain verify mode');
  assert(readResultVerifyCommand.apiAccess === 'none', 'api.read-result verify must not declare live API access');
  assert(readAuditTemplateCommand, 'command reference missing supported local api.read-audit template entry');
  assert(readAuditTemplateCommand.status === 'local', 'api.read-audit template must remain local-only');
  assert(readAuditTemplateCommand.apiAccess === 'none', 'api.read-audit template must not declare live API access');
  assert(readAuditWriteCommand, 'command reference missing supported local api.read-audit write entry');
  assert(readAuditWriteCommand.status === 'local', 'api.read-audit write must remain local-only');
  assert(readAuditWriteCommand.mode === 'audit', 'api.read-audit write must remain audit mode');
  assert(readAuditWriteCommand.apiAccess === 'none', 'api.read-audit write must not declare live API access');
  assert(readAuditValidateCommand, 'command reference missing supported local api.read-audit validate entry');
  assert(readAuditValidateCommand.status === 'local', 'api.read-audit validate must remain local-only');
  assert(readAuditValidateCommand.mode === 'validate', 'api.read-audit validate must remain validate mode');
  assert(readAuditValidateCommand.apiAccess === 'none', 'api.read-audit validate must not declare live API access');
  assert(contractInspectPlanCommand, 'command reference missing supported local contract.inspect.plan entry');
  assert(contractInspectPlanCommand.status === 'local', 'contract.inspect.plan must remain local-only');
  assert(contractInspectPlanCommand.apiAccess === 'none', 'contract.inspect.plan must not declare live API access');
  assert(contractInspectPlanCommand.command.includes('--at <timestamp>'), 'contract.inspect.plan command missing --at timestamp flag');
  assert(contractInspectPlanCommand.optionalFlags.includes('--at'), 'contract.inspect.plan optional flags missing --at');
  assert(workflowApprovalRecordTemplateCommand, 'command reference missing local workflow approval-record.template entry');
  assert(workflowApprovalRecordValidateCommand, 'command reference missing local workflow approval-record.validate entry');
  assert(workflowApprovalRecordTemplateCommand.status === 'local', 'workflow approval-record.template must remain local-only');
  assert(workflowApprovalRecordValidateCommand.status === 'local', 'workflow approval-record.validate must remain local-only');
  assert(workflowApprovalRecordTemplateCommand.mode === 'explain', 'workflow approval-record.template must remain explain mode');
  assert(workflowApprovalRecordValidateCommand.mode === 'validate', 'workflow approval-record.validate must remain validate mode');
  assert(workflowApprovalRecordTemplateCommand.apiAccess === 'none', 'workflow approval-record.template must not declare live API access');
  assert(workflowApprovalRecordValidateCommand.apiAccess === 'none', 'workflow approval-record.validate must not declare live API access');
  assert(workflowApprovalRecordTemplateCommand.command.includes('--apply-gate <apply-gate.json>'), 'workflow approval-record.template command missing apply-gate flag');
  assert(workflowApprovalRecordValidateCommand.command.includes('--file <workflow-approval-record.json>'), 'workflow approval-record.validate command missing file flag');
  assert(workflowApplyReadbackVerifyCommand, 'command reference missing local workflow apply-readback.verify entry');
  assert(workflowApplyReadbackVerifyCommand.status === 'local', 'workflow apply-readback.verify must remain local-only');
  assert(workflowApplyReadbackVerifyCommand.mode === 'verify', 'workflow apply-readback.verify must remain verify mode');
  assert(workflowApplyReadbackVerifyCommand.apiAccess === 'none', 'workflow apply-readback.verify must not declare live API access');
  assert(workflowApplyReadbackVerifyCommand.command.includes('--audit <audit.jsonl>'), 'workflow apply-readback.verify command missing audit flag');
  assert(workflowApplyReadbackVerifyCommand.command.includes('--inspect-output <inspect-output.json>'), 'workflow apply-readback.verify command missing inspect-output flag');
  assert(workflowApplyReadbackVerifyCommand.command.includes('--inspect-outputs <inspect-output-a.json,inspect-output-b.json>'), 'workflow apply-readback.verify command missing multi inspect-outputs flag');

  assert(readCommand, 'command reference missing live-guarded api.read entry');
  assert(readCommand.status === 'live-guarded', 'api.read must be live-guarded in the current CLI');
  assert(readCommand.mode === 'read', 'api.read entry must remain read mode');
  assert(readCommand.apiAccess === 'read', 'api.read entry must declare read API access');
  assert(readCommand.description.includes('contracts.get.v2'), 'api.read description must name contracts.get.v2');

  assert(applyCommand, 'command reference missing live-guarded api.apply entry');
  assert(applyCommand.status === 'live-guarded', 'api.apply must be live-guarded in the current CLI');
  assert(applyCommand.mode === 'apply', 'api.apply entry must remain apply mode');
  assert(applyCommand.apiAccess === 'write', 'api.apply entry must declare write API access');
  assert(applyCommand.description.includes('contracts.create'), 'api.apply description must name contracts.create');

  assert(legacyReadBlocked, 'command reference missing legacy blocked api.read entry');
  assert(legacyApplyBlocked, 'command reference missing legacy blocked api.apply entry');

  const approvalRecordTemplateCommand = supportedById['api.approval-record.template'];
  const approvalRecordValidateCommand = supportedById['api.approval-record.validate'];
  const applyAuditTemplateCommand = supportedById['api.apply-audit.template'];
  const applyAuditWriteCommand = supportedById['api.apply-audit.write'];
  const applyAuditValidateCommand = supportedById['api.apply-audit.validate'];
  const applyReadbackVerifyCommand = supportedById['api.apply-readback.verify'];
  const applyResultTemplateCommand = supportedById['api.apply-result.template'];
  const applyResultValidateCommand = supportedById['api.apply-result.validate'];
  assert(approvalRecordTemplateCommand, 'command reference missing local api.approval-record.template entry');
  assert(approvalRecordValidateCommand, 'command reference missing local api.approval-record.validate entry');
  assert(applyAuditTemplateCommand, 'command reference missing local api.apply-audit.template entry');
  assert(applyAuditWriteCommand, 'command reference missing local api.apply-audit.write entry');
  assert(applyAuditValidateCommand, 'command reference missing local api.apply-audit.validate entry');
  assert(applyReadbackVerifyCommand, 'command reference missing local api.apply-readback.verify entry');
  assert(applyResultTemplateCommand, 'command reference missing local api.apply-result.template entry');
  assert(applyResultValidateCommand, 'command reference missing local api.apply-result.validate entry');
  assert(approvalRecordTemplateCommand.status === 'local', 'api.approval-record.template must remain local-only');
  assert(approvalRecordValidateCommand.status === 'local', 'api.approval-record.validate must remain local-only');
  assert(applyAuditTemplateCommand.status === 'local', 'api.apply-audit.template must remain local-only');
  assert(applyAuditWriteCommand.status === 'local', 'api.apply-audit.write must remain local-only');
  assert(applyAuditValidateCommand.status === 'local', 'api.apply-audit.validate must remain local-only');
  assert(applyReadbackVerifyCommand.status === 'local', 'api.apply-readback.verify must remain local-only');
  assert(applyResultTemplateCommand.status === 'local', 'api.apply-result.template must remain local-only');
  assert(applyResultValidateCommand.status === 'local', 'api.apply-result.validate must remain local-only');
  assert(applyReadbackVerifyCommand.mode === 'verify', 'api.apply-readback.verify must remain verify mode');
  assert(applyResultTemplateCommand.mode === 'template', 'api.apply-result.template must remain template mode');
  assert(applyResultValidateCommand.mode === 'verify', 'api.apply-result.validate must remain verify mode');
  assert(approvalRecordTemplateCommand.apiAccess === 'none', 'api.approval-record.template must not declare live API access');
  assert(approvalRecordValidateCommand.apiAccess === 'none', 'api.approval-record.validate must not declare live API access');
  assert(applyAuditTemplateCommand.apiAccess === 'none', 'api.apply-audit.template must not declare live API access');
  assert(applyAuditWriteCommand.apiAccess === 'none', 'api.apply-audit.write must not declare live API access');
  assert(applyAuditValidateCommand.apiAccess === 'none', 'api.apply-audit.validate must not declare live API access');
  assert(applyReadbackVerifyCommand.apiAccess === 'none', 'api.apply-readback.verify must not declare live API access');
  assert(applyResultTemplateCommand.apiAccess === 'none', 'api.apply-result.template must not declare live API access');
  assert(applyResultValidateCommand.apiAccess === 'none', 'api.apply-result.validate must not declare live API access');
  assert(approvalRecordTemplateCommand.command.includes('--apply-gate <api-apply-gate.json>'), 'api.approval-record.template command missing apply-gate flag');
  assert(approvalRecordValidateCommand.command.includes('--file <api-approval-record.json>'), 'api.approval-record.validate command missing file flag');
  assert(applyAuditTemplateCommand.command.includes('--approval-record <api-approval-record.json>'), 'api.apply-audit.template command missing approval-record flag');
  assert(applyAuditWriteCommand.command.includes('--out <api-apply-audit.jsonl>'), 'api.apply-audit.write command missing out flag');
  assert(applyAuditValidateCommand.command.includes('--file <api-apply-audit.jsonl>'), 'api.apply-audit.validate command missing file flag');
  assert(applyReadbackVerifyCommand.command.includes('--apply-audit <api-apply-audit.jsonl>'), 'api.apply-readback.verify command missing apply-audit flag');
  assert(applyReadbackVerifyCommand.command.includes('--read-result <api-read-result.json>'), 'api.apply-readback.verify command missing read-result flag');
  assert(applyResultTemplateCommand.command.includes('--apply-readback <api-apply-readback.json>'), 'api.apply-result.template command missing apply-readback flag');
  assert(applyResultValidateCommand.command.includes('--file <api-apply-result.json>'), 'api.apply-result.validate command missing file flag');

  assert(supportedById['api.read'], 'api.read must appear in supported commands');
  assert(supportedById['api.apply'], 'api.apply must appear in supported commands');
  assert(commandReferenceHtml.includes('<div class="command-id">api.read-plan</div>'), 'command-reference.html missing local api.read-plan row');
  assert(commandReferenceHtml.includes('<div class="command-id">api.read-preflight</div>'), 'command-reference.html missing local api.read-preflight row');
  assert(commandReferenceHtml.includes('<div class="command-id">api.read-gate.template</div>'), 'command-reference.html missing local api.read-gate template row');
  assert(commandReferenceHtml.includes('<div class="command-id">api.read-gate.validate</div>'), 'command-reference.html missing local api.read-gate validate row');
  assert(commandReferenceHtml.includes('<div class="command-id">api.read-mock</div>'), 'command-reference.html missing local api.read-mock row');
  assert(commandReferenceHtml.includes('<div class="command-id">api.read-pipeline</div>'), 'command-reference.html missing local api.read-pipeline row');
  assert(commandReferenceHtml.includes('<div class="command-id">api.read-result.verify</div>'), 'command-reference.html missing local api.read-result verify row');
  assert(commandReferenceHtml.includes('<div class="command-id">api.read-audit.template</div>'), 'command-reference.html missing local api.read-audit template row');
  assert(commandReferenceHtml.includes('<div class="command-id">api.read-audit.write</div>'), 'command-reference.html missing local api.read-audit write row');
  assert(commandReferenceHtml.includes('<div class="command-id">api.read-audit.validate</div>'), 'command-reference.html missing local api.read-audit validate row');
  assert(commandReferenceHtml.includes('<div class="command-id">api.sandbox-proof.template</div>'), 'command-reference.html missing local api.sandbox-proof template row');
  assert(commandReferenceHtml.includes('<div class="command-id">api.sandbox-proof.validate</div>'), 'command-reference.html missing local api.sandbox-proof validate row');
  assert(commandReferenceHtml.includes('<div class="command-id">api.approval-record.template</div>'), 'command-reference.html missing local api.approval-record template row');
  assert(commandReferenceHtml.includes('<div class="command-id">api.approval-record.validate</div>'), 'command-reference.html missing local api.approval-record validate row');
  assert(commandReferenceHtml.includes('<div class="command-id">approval-record.template</div>'), 'command-reference.html missing local workflow approval-record template row');
  assert(commandReferenceHtml.includes('<div class="command-id">approval-record.validate</div>'), 'command-reference.html missing local workflow approval-record validate row');
  assert(commandReferenceHtml.includes('<div class="command-id">apply-readback.verify</div>'), 'command-reference.html missing local workflow apply-readback verify row');
  assert(commandReferenceHtml.includes('<div class="command-id">api.apply-audit.template</div>'), 'command-reference.html missing local api.apply-audit template row');
  assert(commandReferenceHtml.includes('<div class="command-id">api.apply-audit.write</div>'), 'command-reference.html missing local api.apply-audit write row');
  assert(commandReferenceHtml.includes('<div class="command-id">api.apply-audit.validate</div>'), 'command-reference.html missing local api.apply-audit validate row');
  assert(commandReferenceHtml.includes('<div class="command-id">api.apply-readback.verify</div>'), 'command-reference.html missing local api.apply-readback verify row');
  assert(commandReferenceHtml.includes('<div class="command-id">api.apply-result.template</div>'), 'command-reference.html missing local api.apply-result template row');
  assert(commandReferenceHtml.includes('<div class="command-id">api.apply-result.validate</div>'), 'command-reference.html missing local api.apply-result validate row');
  assert(commandReferenceHtml.includes('metro api read-plan'), 'command-reference.html missing api.read-plan command text');
  assert(commandReferenceHtml.includes('metro api read-preflight'), 'command-reference.html missing api.read-preflight command text');
  assert(commandReferenceHtml.includes('metro api read-gate template'), 'command-reference.html missing api.read-gate template command text');
  assert(commandReferenceHtml.includes('metro api read-gate validate'), 'command-reference.html missing api.read-gate validate command text');
  assert(commandReferenceHtml.includes('metro api read-mock'), 'command-reference.html missing api.read-mock command text');
  assert(commandReferenceHtml.includes('metro api read-pipeline'), 'command-reference.html missing api.read-pipeline command text');
  assert(commandReferenceHtml.includes('metro api read-result verify'), 'command-reference.html missing api.read-result verify command text');
  assert(commandReferenceHtml.includes('metro api read-audit template'), 'command-reference.html missing api.read-audit template command text');
  assert(commandReferenceHtml.includes('metro api read-audit write'), 'command-reference.html missing api.read-audit write command text');
  assert(commandReferenceHtml.includes('metro api read-audit validate'), 'command-reference.html missing api.read-audit validate command text');
  assert(commandReferenceHtml.includes('metro api sandbox-proof template'), 'command-reference.html missing api.sandbox-proof template command text');
  assert(commandReferenceHtml.includes('metro api sandbox-proof validate'), 'command-reference.html missing api.sandbox-proof validate command text');
  assert(commandReferenceHtml.includes('metro api approval-record template'), 'command-reference.html missing api.approval-record template command text');
  assert(commandReferenceHtml.includes('metro api approval-record validate'), 'command-reference.html missing api.approval-record validate command text');
  assert(commandReferenceHtml.includes('metro approval-record template'), 'command-reference.html missing workflow approval-record template command text');
  assert(commandReferenceHtml.includes('metro approval-record validate'), 'command-reference.html missing workflow approval-record validate command text');
  assert(commandReferenceHtml.includes('metro apply-readback verify'), 'command-reference.html missing workflow apply-readback verify command text');
  assert(commandReferenceHtml.includes('metro api apply-audit template'), 'command-reference.html missing api.apply-audit template command text');
  assert(commandReferenceHtml.includes('metro api apply-audit write'), 'command-reference.html missing api.apply-audit write command text');
  assert(commandReferenceHtml.includes('metro api apply-audit validate'), 'command-reference.html missing api.apply-audit validate command text');
  assert(commandReferenceHtml.includes('metro api apply-readback verify'), 'command-reference.html missing api.apply-readback verify command text');
  assert(commandReferenceHtml.includes('metro api apply-result template'), 'command-reference.html missing api.apply-result template command text');
  assert(commandReferenceHtml.includes('metro api apply-result validate'), 'command-reference.html missing api.apply-result validate command text');
  assert(
    commandReferenceHtml.includes('metro contract inspect --contract-id &lt;id&gt; (--sandbox|--prod) --plan [--at &lt;timestamp&gt;] [--json]'),
    'command-reference.html missing contract.inspect.plan --at command text',
  );
  assert(commandReferenceHtml.includes('<div class="command-id">api.read</div>'), 'command-reference.html missing live-guarded api.read row');
  assert(commandReferenceHtml.includes('<div class="command-id">api.apply</div>'), 'command-reference.html missing live-guarded api.apply row');
  assert(commandReferenceHtml.includes('status-pill live-guarded'), 'command-reference.html missing live-guarded status pill');
  assert(commandReferenceHtml.includes('contracts.get.v2'), 'command-reference.html missing contracts.get.v2 live read coverage');
  assert(commandReferenceHtml.includes('contracts.create'), 'command-reference.html missing contracts.create live apply coverage');
}

function assertApiReadPlanCoverage(reference, apiReferenceHtml) {
  const readEndpoints = reference.endpoints.filter((endpoint) => endpoint.operationType === 'read');
  assert(readEndpoints.length > 0, 'API reference has no read endpoints to check');
  assert(apiReferenceHtml.includes('<h3>API read plan</h3>'), 'api-reference.html missing API read plan sections');
  assert(apiReferenceHtml.includes('metro api read-plan'), 'api-reference.html missing metro api read-plan command text');

  for (const endpoint of reference.endpoints) {
    assert(endpoint.apiReadPlan, `API endpoint ${endpoint.id} missing apiReadPlan coverage`);
    assert(endpoint.apiReadPlan.schemaVersion === 'metro.api.read-plan.v1', `API endpoint ${endpoint.id} apiReadPlan schema mismatch`);
    assert(endpoint.apiReadPlan.apiAccess === 'none', `API endpoint ${endpoint.id} apiReadPlan must be local-only`);
    if (endpoint.operationType !== 'read') {
      assert(endpoint.apiReadPlan.liveReadEnabledInCurrentCli === false, `API endpoint ${endpoint.id} apiReadPlan must keep live read disabled`);
    }
    if (endpoint.operationType === 'read') {
      assert(endpoint.apiReadPlan.supportStatus === 'local-read-plan', `API endpoint ${endpoint.id} read-plan should be local-read-plan`);
    } else {
      assert(endpoint.apiReadPlan.supportStatus === 'not-read-endpoint', `API endpoint ${endpoint.id} read-plan should be not-read-endpoint`);
    }
  }
}

function assertApiReadGateCoverage(reference, apiReferenceHtml) {
  const readEndpoints = reference.endpoints.filter((endpoint) => endpoint.operationType === 'read');
  assert(readEndpoints.length > 0, 'API reference has no read endpoints to check for read gates');
  assert(apiReferenceHtml.includes('<h3>API read gate</h3>'), 'api-reference.html missing API read gate sections');
  assert(apiReferenceHtml.includes('metro api read-gate template'), 'api-reference.html missing metro api read-gate template command text');
  assert(apiReferenceHtml.includes('local-read-gate-manifest'), 'api-reference.html missing local read-gate support status');

  for (const endpoint of reference.endpoints) {
    assert(endpoint.apiReadGate, `API endpoint ${endpoint.id} missing apiReadGate coverage`);
    assert(endpoint.apiReadGate.schemaVersion === 'metro.api.read-gate.v1', `API endpoint ${endpoint.id} apiReadGate schema mismatch`);
    assert(endpoint.apiReadGate.apiAccess === 'none', `API endpoint ${endpoint.id} apiReadGate must be local-only`);
    if (endpoint.operationType !== 'read') {
      assert(endpoint.apiReadGate.readEnabledInCurrentCli === false, `API endpoint ${endpoint.id} apiReadGate must keep live read disabled`);
    }
    if (endpoint.operationType === 'read') {
      assert(endpoint.apiReadGate.supportStatus === 'local-read-gate-manifest', `API endpoint ${endpoint.id} read-gate should be local-read-gate-manifest`);
      assert(endpoint.apiReadGate.requiredEvidence.includes('current-turn-authorization'), `API endpoint ${endpoint.id} read-gate missing authorization evidence`);
      assert(endpoint.apiReadGate.requiredEvidence.includes('audit-safe-request-summary'), `API endpoint ${endpoint.id} read-gate missing audit evidence`);
    } else {
      assert(endpoint.apiReadGate.supportStatus === 'not-read-endpoint', `API endpoint ${endpoint.id} read-gate should be not-read-endpoint`);
    }
  }
}

function assertApiReadMockCoverage(reference, apiReferenceHtml) {
  const readEndpoints = reference.endpoints.filter((endpoint) => endpoint.operationType === 'read');
  assert(readEndpoints.length > 0, 'API reference has no read endpoints to check for read mocks');
  assert(apiReferenceHtml.includes('<h3>API read mock</h3>'), 'api-reference.html missing API read mock sections');
  assert(apiReferenceHtml.includes('metro api read-mock'), 'api-reference.html missing metro api read-mock command text');
  assert(apiReferenceHtml.includes('local-mocked-read-runner'), 'api-reference.html missing local read-mock support status');

  for (const endpoint of reference.endpoints) {
    assert(endpoint.apiReadMock, `API endpoint ${endpoint.id} missing apiReadMock coverage`);
    assert(endpoint.apiReadMock.schemaVersion === 'metro.api.read-mock.v1', `API endpoint ${endpoint.id} apiReadMock schema mismatch`);
    assert(endpoint.apiReadMock.apiAccess === 'none', `API endpoint ${endpoint.id} apiReadMock must be local-only`);
    if (endpoint.operationType !== 'read') {
      assert(endpoint.apiReadMock.readEnabledInCurrentCli === false, `API endpoint ${endpoint.id} apiReadMock must keep live read disabled`);
    }
    assert(endpoint.apiReadMock.command.includes('metro api read-mock'), `API endpoint ${endpoint.id} apiReadMock missing command`);
    if (endpoint.operationType === 'read') {
      assert(endpoint.apiReadMock.supportStatus === 'local-mocked-read-runner', `API endpoint ${endpoint.id} read-mock should be local-mocked-read-runner`);
      assert(endpoint.apiReadMock.requiresReadGate.includes('metro api read-gate validate'), `API endpoint ${endpoint.id} read-mock missing read-gate requirement`);
      assert(endpoint.apiReadMock.producesReadResult === 'metro.api.read-result.v1', `API endpoint ${endpoint.id} read-mock missing read-result output contract`);
      assert(endpoint.apiReadMock.producesReadAuditTemplate === 'metro.api.read-audit.template.v1', `API endpoint ${endpoint.id} read-mock missing read-audit output contract`);
    } else {
      assert(endpoint.apiReadMock.supportStatus === 'not-read-endpoint', `API endpoint ${endpoint.id} read-mock should be not-read-endpoint`);
    }
  }
}

function assertApiReadPipelineCoverage(reference, apiReferenceHtml) {
  const readEndpoints = reference.endpoints.filter((endpoint) => endpoint.operationType === 'read');
  assert(readEndpoints.length > 0, 'API reference has no read endpoints to check for read pipelines');
  assert(apiReferenceHtml.includes('<h3>API read pipeline</h3>'), 'api-reference.html missing API read pipeline sections');
  assert(apiReferenceHtml.includes('metro api read-pipeline'), 'api-reference.html missing metro api read-pipeline command text');
  assert(apiReferenceHtml.includes('local-mocked-read-audit-pipeline'), 'api-reference.html missing local read-pipeline support status');

  for (const endpoint of reference.endpoints) {
    assert(endpoint.apiReadPipeline, `API endpoint ${endpoint.id} missing apiReadPipeline coverage`);
    assert(endpoint.apiReadPipeline.schemaVersion === 'metro.api.read-pipeline.v1', `API endpoint ${endpoint.id} apiReadPipeline schema mismatch`);
    assert(endpoint.apiReadPipeline.apiAccess === 'none', `API endpoint ${endpoint.id} apiReadPipeline must be local-only`);
    if (endpoint.operationType !== 'read') {
      assert(endpoint.apiReadPipeline.readEnabledInCurrentCli === false, `API endpoint ${endpoint.id} apiReadPipeline must keep live read disabled`);
    }
    assert(endpoint.apiReadPipeline.command.includes('metro api read-pipeline'), `API endpoint ${endpoint.id} apiReadPipeline missing command`);
    if (endpoint.operationType === 'read') {
      assert(endpoint.apiReadPipeline.supportStatus === 'local-mocked-read-audit-pipeline', `API endpoint ${endpoint.id} read-pipeline should be local-mocked-read-audit-pipeline`);
      assert(endpoint.apiReadPipeline.requiresReadGate.includes('metro api read-gate validate'), `API endpoint ${endpoint.id} read-pipeline missing read-gate requirement`);
      assert(endpoint.apiReadPipeline.producesReadResult === 'metro.api.read-result.v1', `API endpoint ${endpoint.id} read-pipeline missing read-result output contract`);
      assert(endpoint.apiReadPipeline.producesReadAuditWrite === 'metro.api.read-audit.write.v1', `API endpoint ${endpoint.id} read-pipeline missing read-audit writer output contract`);
    } else {
      assert(endpoint.apiReadPipeline.supportStatus === 'not-read-endpoint', `API endpoint ${endpoint.id} read-pipeline should be not-read-endpoint`);
    }
  }
}

function assertApiReadResultCoverage(reference, apiReferenceHtml) {
  const readEndpoints = reference.endpoints.filter((endpoint) => endpoint.operationType === 'read');
  assert(readEndpoints.length > 0, 'API reference has no read endpoints to check for read results');
  assert(apiReferenceHtml.includes('<h3>API read result</h3>'), 'api-reference.html missing API read result sections');
  assert(apiReferenceHtml.includes('metro api read-result verify'), 'api-reference.html missing metro api read-result verify command text');
  assert(apiReferenceHtml.includes('mocked-read-result-contract'), 'api-reference.html missing mocked read-result support status');

  for (const endpoint of reference.endpoints) {
    assert(endpoint.apiReadResult, `API endpoint ${endpoint.id} missing apiReadResult coverage`);
    assert(endpoint.apiReadResult.schemaVersion === 'metro.api.read-result.v1', `API endpoint ${endpoint.id} apiReadResult schema mismatch`);
    assert(endpoint.apiReadResult.apiAccess === 'none', `API endpoint ${endpoint.id} apiReadResult must be local-only`);
    if (endpoint.operationType !== 'read') {
      assert(endpoint.apiReadResult.readEnabledInCurrentCli === false, `API endpoint ${endpoint.id} apiReadResult must keep live read disabled`);
    }
    assert(endpoint.apiReadResult.validationCommand.includes('metro api read-result verify'), `API endpoint ${endpoint.id} apiReadResult missing verifier command`);
    if (endpoint.operationType === 'read') {
      assert(endpoint.apiReadResult.supportStatus === 'mocked-read-result-contract', `API endpoint ${endpoint.id} read-result should be mocked-read-result-contract`);
      assert(endpoint.apiReadResult.requiresReadGate.includes('metro api read-gate validate'), `API endpoint ${endpoint.id} read-result missing read-gate requirement`);
    } else {
      assert(endpoint.apiReadResult.supportStatus === 'not-read-endpoint', `API endpoint ${endpoint.id} read-result should be not-read-endpoint`);
    }
  }
}

function assertApiReadAuditCoverage(reference, apiReferenceHtml) {
  const readEndpoints = reference.endpoints.filter((endpoint) => endpoint.operationType === 'read');
  assert(readEndpoints.length > 0, 'API reference has no read endpoints to check for read audits');
  assert(apiReferenceHtml.includes('<h3>API read audit</h3>'), 'api-reference.html missing API read audit sections');
  assert(apiReferenceHtml.includes('metro api read-audit validate'), 'api-reference.html missing metro api read-audit validate command text');
  assert(apiReferenceHtml.includes('mocked-read-audit-contract'), 'api-reference.html missing mocked read-audit support status');

  for (const endpoint of reference.endpoints) {
    assert(endpoint.apiReadAudit, `API endpoint ${endpoint.id} missing apiReadAudit coverage`);
    assert(endpoint.apiReadAudit.schemaVersion === 'metro.api.read-audit.v1', `API endpoint ${endpoint.id} apiReadAudit schema mismatch`);
    assert(endpoint.apiReadAudit.apiAccess === 'none', `API endpoint ${endpoint.id} apiReadAudit must be local-only`);
    if (endpoint.operationType !== 'read') {
      assert(endpoint.apiReadAudit.readEnabledInCurrentCli === false, `API endpoint ${endpoint.id} apiReadAudit must keep live read disabled`);
    }
    assert(endpoint.apiReadAudit.validationCommand.includes('metro api read-audit validate'), `API endpoint ${endpoint.id} apiReadAudit missing validate command`);
    if (endpoint.operationType === 'read') {
      assert(endpoint.apiReadAudit.supportStatus === 'mocked-read-audit-contract', `API endpoint ${endpoint.id} read-audit should be mocked-read-audit-contract`);
      assert(endpoint.apiReadAudit.requiresReadGate.includes('metro api read-gate validate'), `API endpoint ${endpoint.id} read-audit missing read-gate requirement`);
      assert(endpoint.apiReadAudit.requiresReadResult.includes('metro api read-result verify'), `API endpoint ${endpoint.id} read-audit missing read-result requirement`);
      assert(endpoint.apiReadAudit.templateCommand.includes('metro api read-audit template'), `API endpoint ${endpoint.id} read-audit missing template command`);
      assert(endpoint.apiReadAudit.writeCommand.includes('metro api read-audit write'), `API endpoint ${endpoint.id} read-audit missing write command`);
    } else {
      assert(endpoint.apiReadAudit.supportStatus === 'not-read-endpoint', `API endpoint ${endpoint.id} read-audit should be not-read-endpoint`);
    }
  }
}

function assertInstallPathProfileResolutionCoverage(installHtml) {
  assert(
    installHtml.includes('metro api preflight template --preview api-preview.json --profile-resolution profile-resolution.json --approval-id approval-local-contracts-create-001 --json'),
    'install.html GitHub path must show profile-resolution-bound API preflight',
  );
  assert(
    installHtml.includes('metro api apply-gate template --preview api-preview.json --preflight api-preflight.json --sandbox-proof api-sandbox-proof.json --profile-resolution profile-resolution.json'),
    'install.html GitHub path must show profile-resolution-bound API apply gate',
  );
}

function assertInstallPathTerminalDocsHarnessCoverage(installHtml) {
  for (const command of [
    'metro api search contract create --json',
    'metro api diff contracts.create contracts.updateEndDate --json',
    'metro api export --family contracts --json',
    'metro docs explain contracts.create --json',
    'metro docs explain --list --json',
    'metro docs explain input.normalize --json',
    'metro docs explain contract-overrides.inspection --json',
    'metro docs explain product-rate-retirement.readback --json',
    'metro api read-pipeline contracts.get.v2',
  ]) {
    assert(
      installHtml.includes(command),
      `install.html missing terminal documentation harness command: ${command}`,
    );
  }
}

function assertInstallPageIndexCoverage(installHtml) {
  assert(
    installHtml.includes('<nav class="reference-jumps" aria-label="Install guide sections">'),
    'install.html missing install guide page index navigation',
  );
  assert(installHtml.includes('<strong>Page index</strong>'), 'install.html missing page index label');

  for (const id of ['first-safe-preview', 'current-local', 'target-install', 'troubleshooting']) {
    assert(installHtml.includes(`href="#${id}"`), `install.html page index missing link: #${id}`);
    assert(installHtml.includes(`id="${id}"`), `install.html page index target missing anchor: ${id}`);
  }

  for (const text of [
    'Prove install works before any API key - no customer risk.',
    'One command → global <code>metro</code> binary.',
    'npm publish is future - GitHub install is today.',
    'ENOTDIR, missing binary, profile blockers.',
  ]) {
    assert(installHtml.includes(text), `install.html page index missing summary: ${text}`);
  }
}

function assertFirstSafePreviewPathCoverage(installHtml, readme) {
  for (const text of [
    'id="first-safe-preview"',
    'First Safe Preview',
    'Minimum success path',
    'Install from GitHub, print the quickstart, then run its local checks.',
    'git clone --depth 1 https://github.com/metrocli/metro.git ~/.metro/src',
    'Terminal guide',
    'metro setup quickstart --shell | zsh',
    'metro setup quickstart --json',
    'Prerequisites',
    'Users do not need any parent',
    'parent billing-operations monorepo',
    'metro schema --json',
    'metro setup template --json',
    'metro setup resolve --file "$METRO_QUICKSTART_DIR/profiles.json" --profile metro-sandbox --expect-tenant sandbox --key-fingerprint fp_sandbox_setup_resolve_reviewed --json',
    'metro validate --shape pro-annual --file "$METRO_QUICKSTART_DIR/pro-annual.json" --json',
    'metro package preview --shape pro-annual --file "$METRO_QUICKSTART_DIR/pro-annual.json" --sandbox --json',
    '"schemaVersion": "metro.preview.v1"',
    '"workflow": "package.create"',
    '"shape": "pro-annual"',
    '"tenant": "sandbox"',
    '"payloadHash": "sha256:..."',
    '"blocked": false',
    'green preview is not production approval',
    'metro api readiness --summary --json',
    'live reads, live writes, Stripe delivery, or package apply',
  ]) {
    assert(installHtml.includes(text), `install.html first safe preview path missing: ${text}`);
  }

  for (const text of [
    'Installed user path:',
    'git clone --depth 1 https://github.com/metrocli/metro.git ~/.metro/src',
    'metro setup quickstart --shell | zsh',
    'metro setup quickstart --json',
    'Piping it',
    'to `zsh` runs that block',
    '${TMPDIR:-/tmp}/metro-quickstart',
    'Users do not need to',
    'parent billing-operations monorepo',
    'Maintainer checkout proof:',
    'node bin/metro.js setup template --json',
    'node bin/metro.js setup resolve --file test/fixtures/setup/profiles-valid.json --profile metro-sandbox --expect-tenant sandbox --key-fingerprint fp_sandbox_setup_resolve_reviewed --json',
    'node bin/metro.js validate --shape pro-annual --file test/fixtures/pro-annual-valid.json --json',
    'node bin/metro.js input normalize --shape pro-annual --file test/fixtures/pro-annual-valid.yaml --json',
    'node bin/metro.js input normalize --api contracts.create --file test/fixtures/api-contracts-create-valid.yaml --json',
    'node bin/metro.js package preview --shape pro-annual --file test/fixtures/pro-annual-valid.json --sandbox --json',
    'node bin/metro.js validate --shape pro-annual --file test/fixtures/pro-annual-valid.yaml --json',
    'node bin/metro.js api validate contracts.create --file test/fixtures/api-contracts-create-valid.yaml --json',
    '"schemaVersion": "metro.preview.v1"',
    '"workflow": "package.create"',
    '"shape": "pro-annual"',
    '"tenant": "sandbox"',
    '"payloadHash": "sha256:..."',
    '"blocked": false',
    'It does not read `.env`, call Metronome',
    'deliver to Stripe, or enable apply.',
  ]) {
    assert(readme.includes(text), `README first safe preview path missing: ${text}`);
  }
}

function assertAutomationIntegrationContractCoverage(installHtml, readme) {
  for (const text of [
    'Automation integration contract',
    'metro schema --json',
    'parse only documented JSON schemas from stdout',
    'failures exit <code>1</code>',
    'refusals exit <code>2</code>',
    'metro.refusal.v1',
    'endpoint-specific refusal JSON',
    'Do not infer authorization from profile files',
    'passing apply-gate validation',
  ]) {
    assert(installHtml.includes(text), `install.html automation integration contract missing: ${text}`);
  }

  for (const text of [
    'Automation integration contract:',
    'Use `metro schema --json` for command discovery',
    'parse documented JSON',
    'Exit code `0` means success, `1` means validation or input failure, and `2`',
    'Safety refusals may emit `metro.refusal.v1` or endpoint-specific refusal JSON',
    'profile files, environment variable',
    'preview hashes, and apply-gate validation',
    'are not authorization.',
  ]) {
    assert(readme.includes(text), `README automation integration contract missing: ${text}`);
  }
}

function assertIntegrationGuideCoverage(integrationHtml, html, readme) {
  for (const id of ['contract', 'ci', 'evidence', 'boundaries']) {
    assert(integrationHtml.includes(`href="#${id}"`), `integration.html page index missing link: #${id}`);
    assert(integrationHtml.includes(`id="${id}"`), `integration.html page index missing target: ${id}`);
  }

  for (const text of [
    'Integrate metro by contracts, not by scraped copy.',
    'metro schema --json',
    'metro docs command-reference --json',
    'metro input normalize --shape pro-annual --file pro-annual.yaml --json',
    'metro input normalize --api contracts.create --file contracts-create.yaml --json',
    'metro.input.normalize.v1',
    'metro api readiness --summary --json',
    'metro api readiness --json',
    'metro release retention-policy template --json',
    'metro release retention-policy validate --file policy.json --json',
    'metro release evidence-plan --policy policy.json --json',
    'npm run test:install',
    'npm run test:unit',
    'npm run test:golden',
    'node docs/metronome-cli/site/verify-site.js',
    'metro api read-pipeline ... --dry-run --json',
    'metro api apply-result validate',
    'Profile files, environment variable names, key presence, fixture',
    'not authorization for live Metronome',
    'It does not expose live expert API read or apply',
    'Safety refusals may emit <code>metro.refusal.v1</code>',
    'href="install.html#first-safe-preview"',
    'href="api-reference.html#write-proof-ladder"',
    'href="command-reference.html"',
  ]) {
    assert(integrationHtml.includes(text), `integration.html missing integration guidance: ${text}`);
  }

  assert(html.includes('href="integration.html"'), 'index.html missing integration.html link');
  assert(html.includes('Open integration guide'), 'index.html missing integration guide pathway link');
  assert(readme.includes('site/integration.html'), 'planning README missing integration.html start-here entry');
  assert(readme.includes('automation and CI integration path'), 'planning README missing integration guide docs text');
}

function normalizeReadmeCommandText(text) {
  return text
    .replace(/node\s+metronome-cli\/bin\/metro\.js/g, 'metro')
    .replace(/node\s+bin\/metro\.js/g, 'metro')
    .replace(/\s+/g, ' ');
}

function catalogCommandStem(command) {
  return command
    .replace(/\s+\[[^\]]+\]/g, '')
    .replace(/\s+\([^)]*\)/g, '')
    .replace(/\s+<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function catalogCommandIdentity(command) {
  const tokens = command.split(/\s+/);
  const identity = [];
  for (const token of tokens) {
    if (token.startsWith('--') || token.startsWith('<') || token.startsWith('[') || token.startsWith('(')) break;
    identity.push(token);
  }
  return identity.join(' ');
}

const README_CATALOG_COMMAND_GROUPS = new Set(['docs', 'setup', 'source-boundary', 'verify', 'shape', 'validate', 'input', 'approval-record', 'apply-readback']);

const README_EXPERT_API_PROOF_COMMAND_IDS = new Set([
  'api.catalog',
  'api.explain',
  'api.search',
  'api.diff',
  'api.export',
  'api.scopes',
  'api.approvals',
  'api.readiness',
  'api.validate',
  'api.read-plan',
  'api.read-gate.template',
  'api.read-gate.validate',
  'api.read-mock',
  'api.read-pipeline',
  'api.read-result.verify',
  'api.read-audit.template',
  'api.read-audit.write',
  'api.read-audit.validate',
  'api.preview',
  'api.preflight.template',
  'api.preflight.validate',
  'api.sandbox-proof.template',
  'api.sandbox-proof.validate',
  'api.apply-gate.template',
  'api.apply-gate.validate',
  'api.approval-record.template',
  'api.approval-record.validate',
  'api.apply-audit.template',
  'api.apply-audit.write',
  'api.apply-audit.validate',
  'api.apply-readback.verify',
  'api.apply-result.template',
  'api.apply-result.validate',
]);

function assertReadmeCatalogCommandCoverage(reference, planningReadme, packageReadme) {
  const checkedCommands = (reference.commands || []).filter((command) => (
    README_CATALOG_COMMAND_GROUPS.has(command.group)
      || README_EXPERT_API_PROOF_COMMAND_IDS.has(command.id)
  ));
  assert(checkedCommands.length > 0, 'command catalog has no README command groups to check');

  for (const [label, text] of [
    ['planning README', planningReadme],
    ['package README', packageReadme],
  ]) {
    const normalized = normalizeReadmeCommandText(text);
    for (const command of checkedCommands) {
      const stem = command.group === 'docs'
        ? catalogCommandStem(command.command)
        : catalogCommandIdentity(command.command);
      assert(
        normalized.includes(stem),
          `${label} missing catalog command ${command.id}: ${stem}`,
      );
      if (README_EXPERT_API_PROOF_COMMAND_IDS.has(command.id)) continue;
      for (const requiredFlag of command.requiredFlags || []) {
        if (!requiredFlag.startsWith('--')) continue;
        const alternatives = requiredFlag.split(/\s+or\s+/);
        if (alternatives.length > 1) {
          assert(
            alternatives.some((flag) => normalized.includes(flag)),
            `${label} missing one of required flag alternatives ${requiredFlag} for catalog command ${command.id}`,
          );
          continue;
        }
        assert(
          normalized.includes(requiredFlag),
          `${label} missing required flag ${requiredFlag} for catalog command ${command.id}`,
        );
      }
    }
  }
}

function assertReadmeRateCardArchiveCoverage(planningReadme, packageReadme) {
  const expectedTexts = [
    'rateCards.create',
    'rateCards.update',
    'rateCards.archive',
    'rateCards.setProductOrder',
    'rate-card create proof ladder',
    'POST /v1/contract-pricing/rate-cards/create',
    '`rateCards.get` mocked read-result',
    'fiat credit type',
    'custom pricing-unit',
    'alias uniqueness',
    'duplicate rate-card',
    'rate-card archive',
    'package/contract dependency inventory',
    'existing contract pricing preservation',
    'rateCards.get/list',
    'Endpoint-specific proof-ladder fixtures',
    'rate-card product-order proof ladder',
    'POST /v1/contract-pricing/rate-cards/setRateCardProductsOrder',
    '`rateCards.getRates` read-result',
    'complete product inventory and desired order',
    '`rateCards.getRates/getRateSchedule` read-back planning',
    'all four rate-card write endpoints',
    '`rateCards.archive`, and `rateCards.setProductOrder`',
    'Use `metro api readiness --summary --json` for gap counts, then `metro api readiness --json` plus checked fixture filenames before choosing the next fixture-boundary pass',
    'live expert API read/apply disabled',
    'rate-card update proof ladder',
    'POST /v1/contract-pricing/rate-cards/update',
    'metadata ownership',
    'alias uniqueness and transition review',
    'rate-card archive proof ladder',
    'POST /v1/contract-pricing/rate-cards/archive',
    'package/contract dependency inventory',
    'existing contract pricing preservation',
    'post-archive `rateCards.get/list`',
  ];

  for (const [label, text] of [
    ['planning README', planningReadme],
    ['package README', packageReadme],
  ]) {
    const normalized = text.replace(/\s+/g, ' ');
    for (const expected of expectedTexts) {
      assert(normalized.includes(expected), `${label} missing rate-card archive coverage note: ${expected}`);
    }
  }
}

function assertRateCardFixtureBoundarySiteCoverage(html) {
  for (const expected of [
    'Rate-card fixture boundary',
    "ls test/golden/api | rg 'rate-cards'",
    'Endpoint-specific proof-ladder fixtures now exist for all four rate-card write endpoints',
    '<code>rateCards.archive</code>, and <code>rateCards.setProductOrder</code>',
    'mocked <code>rateCards.getRates</code> read-result and apply-readback evidence',
    'Use <code>metro api readiness --summary --json</code> for gap counts, then <code>metro api readiness --json</code> plus checked fixture filenames before choosing the next fixture-boundary pass',
  ]) {
    assert(html.includes(expected), `index.html missing rate-card fixture boundary coverage: ${expected}`);
  }
}

function assertCustomFieldFixtureBoundarySiteCoverage(html) {
  for (const expected of [
    'Custom-field key fixture boundary',
    "ls test/golden/api | rg 'custom-fields-(add-key|remove-key|set-values|delete-values)|custom-fields-list-keys|commits-list-custom-fields-(set-values|delete-values)'",
    'All four custom-field write endpoints',
    '<code>customFields.deleteValues</code>',
    '<code>customFields.listKeys</code> allowlist evidence',
    '<code>commit/grant_reason</code> is absent after removal',
    '<code>commit/granted_by</code>',
    '<code>commits.list</code> entity read-back evidence',
    'pre-delete <code>commits.list</code> source-value evidence',
    'post-delete <code>commits.list</code> evidence',
    'the unrelated field remains preserved',
    'Live expert API read/apply remains disabled',
  ]) {
    assert(html.includes(expected), `index.html missing custom-field key fixture boundary coverage: ${expected}`);
  }
}

function assertReadmeBillableMetricWriteCoverage(planningReadme, packageReadme) {
  const expectedTexts = [
    'billableMetrics.create',
    'billableMetrics.update',
    'billableMetrics.archive',
    'POST /v1/billable-metrics/create',
    'reviewed standard',
    'metric shape',
    'rejecting SQL metric configuration',
    'PUT /v1/billable-metrics/{billable_metric_id}',
    'body.name',
    'metric configuration mutation',
    'billable metric archive',
    'POST /v1/billable-metrics/archive',
    'body.id',
    'existing Product association review',
    'metric/product rollout planning',
    'billableMetrics.get/list',
    'include_archived',
    'archived_at',
    'live expert API read/apply disabled',
  ];

  for (const [label, text] of [
    ['planning README', planningReadme],
    ['package README', packageReadme],
  ]) {
    for (const expected of expectedTexts) {
      assert(text.includes(expected), `${label} missing billable-metric expert write coverage note: ${expected}`);
    }
  }
}

function assertReadmeCustomFieldWriteCoverage(planningReadme, packageReadme) {
  const expectedTexts = [
    'customFields.addKey',
    'customFields.removeKey',
    'customFields.setValues',
    'customFields.deleteValues',
    'POST /v1/customFields/addKey',
    'POST /v1/customFields/removeKey',
    'key allowlist mutation',
    'value mutation',
    'body.entity',
    'body.key',
    'body.enforce_uniqueness',
    'customFields.listKeys',
    'collision/read-back evidence',
    'POST /v1/customFields/setValues',
    'POST /v1/customFields/deleteValues',
    'body.entity_id',
    'body.custom_fields',
    'body.keys[]',
    '200-character value limit',
    'target entity identity',
    'downstream metadata consumer review',
    'All four custom-field write endpoints now have',
    'planned apply-audit',
    'read-result',
    'commit/grant_reason` key is absent after removal',
    '`customFields.listKeys` allowlist evidence',
    '`commit/granted_by`',
    '`commits.list` entity read-back evidence',
    'The delete-values path uses pre-delete `commits.list`',
    'post-delete `commits.list` evidence',
    'unrelated field remains preserved',
    'live expert API read/apply disabled',
  ];

  for (const [label, text] of [
    ['planning README', planningReadme],
    ['package README', packageReadme],
  ]) {
    const normalized = text.replace(/\s+/g, ' ');
    for (const expected of expectedTexts) {
      assert(normalized.includes(expected), `${label} missing custom-field expert write coverage note: ${expected}`);
    }
  }
}

function assertReadmeProductArchiveCoverage(planningReadme, packageReadme) {
  const expectedTexts = [
    'products.create',
    'products.update',
    'products.archive',
    'all three product write endpoints',
    'preflight',
    'sandbox-proof',
    'apply-gate',
    'approval-record',
    'planned apply-audit',
    'read-result',
    'apply-readback',
    'apply-result',
    'product create proof ladder',
    'POST /v1/contract-pricing/products/create',
    'customer-facing name',
    'billable metric',
    'duplicate product/shadower',
    'dimensional key',
    'invoice-name',
    'rate-card addRates handoff',
    'product update proof ladder',
    'POST /v1/contract-pricing/products/update',
    'scheduled USAGE product updates',
    'hour-boundary `body.starting_at`',
    'existing product identity',
    'billing-continuity',
    'products.get` update-history',
    'rateCards.getRates` can show current display names',
    'name-at-timestamp',
    'product archive',
    'body.product_id',
    'active rate-card inventory review',
    'rateCardCloseVerified',
    'invoice-line behavior review',
    'irreversibility review',
    'products.get/list',
    'rateCards.getRates/getRateSchedule',
    'product get read-result',
    'live expert API read/apply disabled',
  ];

  for (const [label, text] of [
    ['planning README', planningReadme],
    ['package README', packageReadme],
  ]) {
    const normalized = text.replace(/\s+/g, ' ');
    for (const expected of expectedTexts) {
      assert(normalized.includes(expected), `${label} missing product archive coverage note: ${expected}`);
    }
  }
}

function assertReadmePackageWriteCoverage(planningReadme, packageReadme) {
  const expectedTexts = [
    'packages.create',
    'packages.archive',
    'preflight',
    'sandbox-proof',
    'apply-gate',
    'approval-record',
    'planned apply-audit',
    'apply-readback',
    'apply-result',
    'POST /v1/packages/create',
    'package alias/rate-card/contract-template evidence',
    'body.name',
    'body.rate_card_id',
    'body.aliases',
    'local `body.contract`',
    'body.uniqueness_key',
    'billing-provider behavior',
    'alias handoff',
    'alias uniqueness',
    'package terms/frequency',
    'invoice behavior',
    'Stripe delivery',
    'contract-create compatibility',
    'stable idempotency review',
    'POST /v1/packages/archive',
    'body.package_id',
    'alias-only archive',
    'replacement alias read-back',
    'contracts-on-package inventory',
    'packages.get/list',
    'read-result',
    'apply-readback evidence',
    'apply-result evidence',
    'live expert API read/apply disabled',
  ];

  for (const [label, text] of [
    ['planning README', planningReadme],
    ['package README', packageReadme],
  ]) {
    const normalized = text.replace(/\s+/g, ' ');
    for (const expected of expectedTexts) {
      assert(normalized.includes(expected), `${label} missing package expert write coverage note: ${expected}`);
    }
  }
}

function assertReadmeSecurityReadCoverage(planningReadme, packageReadme) {
  const expectedTexts = [
    'security.getServices',
    'security.getAuditLogs',
    'local validation, read-plan, read-mock',
    'read-pipeline, and read-audit evidence',
    'GET /v1/services',
    '/v1/security/services',
    'service registry output',
    'usage direction',
    'IP ranges',
    'GET /v1/auditLogs',
    'query parameters',
    '/v1/security/auditLogs',
    'date filters with `next_page`',
    'resource_type',
    'resource_id',
    'live expert API reads disabled',
    'current-turn authorization',
    'tenant selection',
    'read-gate',
    'mock/read-result',
    'read-audit evidence',
  ];

  for (const [label, text] of [
    ['planning README', planningReadme],
    ['package README', packageReadme],
  ]) {
    const normalized = text.replace(/\s+/g, ' ');
    for (const expected of expectedTexts) {
      assert(normalized.includes(expected), `${label} missing security expert read coverage note: ${expected}`);
    }
  }
}

function assertReadPlanGoldenShape(label, payload) {
  assert(payload.schemaVersion === 'metro.api.read-plan.v1', `${label} read-plan schema mismatch`);
  assert(payload.apiAccess === 'none', `${label} read-plan must be local-only`);
  assert(payload.validation && payload.validation.apiAccess === 'none', `${label} validation must be local-only`);
  assert(
    payload.liveExecution && typeof payload.liveExecution.enabledInCurrentCli === 'boolean',
    `${label} must declare liveExecution.enabledInCurrentCli`,
  );
  assert(
    payload.validation.liveExecution && payload.validation.liveExecution.enabledInCurrentCli === false,
    `${label} validation must keep live execution disabled`,
  );
  if (payload.liveExecution.enabledInCurrentCli) {
    assert(payload.liveReadSupported === true, `${label} live-enabled plan must mark liveReadSupported`);
  } else {
    assert(payload.liveReadSupported === false, `${label} must keep live read unsupported`);
  }
}

function assertReadPlanGoldenCoverage() {
  const apiGoldenDir = path.join(packageRoot, 'test', 'golden', 'api');
  const postBody = readJson(path.join(apiGoldenDir, 'read-plan.contracts-get-v2.sandbox.json'));
  const contractsList = readJson(path.join(apiGoldenDir, 'read-plan.contracts-list-v2.sandbox.json'));
  const contractsRateSchedule = readJson(path.join(apiGoldenDir, 'read-plan.contracts-rate-schedule.sandbox.json'));
  const customerBalances = readJson(path.join(apiGoldenDir, 'read-plan.customer-balances-list.sandbox.json'));
  const seatBalances = readJson(path.join(apiGoldenDir, 'read-plan.seat-balances-list.sandbox.json'));
  const commitsList = readJson(path.join(apiGoldenDir, 'read-plan.commits-list.sandbox.json'));
  const creditsList = readJson(path.join(apiGoldenDir, 'read-plan.credits-list.sandbox.json'));
  const eventsSearch = readJson(path.join(apiGoldenDir, 'read-plan.events-search.sandbox.json'));
  const billableMetricsGet = readJson(path.join(apiGoldenDir, 'read-plan.billable-metrics-get.sandbox.json'));
  const billableMetricsList = readJson(path.join(apiGoldenDir, 'read-plan.billable-metrics-list.sandbox.json'));
  const packagesGet = readJson(path.join(apiGoldenDir, 'read-plan.packages-get.sandbox.json'));
  const packagesList = readJson(path.join(apiGoldenDir, 'read-plan.packages-list.sandbox.json'));
  const billingProviderGet = readJson(path.join(apiGoldenDir, 'read-plan.billing-provider-get.production.json'));
  const productsGet = readJson(path.join(apiGoldenDir, 'read-plan.products-get.sandbox.json'));
  const productsList = readJson(path.join(apiGoldenDir, 'read-plan.products-list.sandbox.json'));
  const rateCardsGet = readJson(path.join(apiGoldenDir, 'read-plan.rate-cards-get.sandbox.json'));
  const rateCardsList = readJson(path.join(apiGoldenDir, 'read-plan.rate-cards-list.sandbox.json'));
  const rateCardsGetRates = readJson(path.join(apiGoldenDir, 'read-plan.rate-cards-get-rates.sandbox.json'));
  const rateCardSchedule = readJson(path.join(apiGoldenDir, 'read-plan.rate-card-schedule.sandbox.json'));
  const invoicesGet = readJson(path.join(apiGoldenDir, 'read-plan.invoices-get.production.json'));
  const getPathQuery = readJson(path.join(apiGoldenDir, 'read-plan.invoices-list-for-customer.production.json'));
  const customersGet = readJson(path.join(apiGoldenDir, 'read-plan.customers-get.sandbox.json'));
  const customersList = readJson(path.join(apiGoldenDir, 'read-plan.customers-list.sandbox.json'));
  const implicitQuery = readJson(path.join(apiGoldenDir, 'read-plan.usage-groups.sandbox.json'));
  const usageBatch = readJson(path.join(apiGoldenDir, 'read-plan.usage-batch.sandbox.json'));
  const blockedInvalid = readJson(path.join(apiGoldenDir, 'read-plan.usage-groups-invalid-body.sandbox.json'));
  const usageBatchInvalid = readJson(path.join(apiGoldenDir, 'read-plan.usage-batch-invalid-body.sandbox.json'));

  assertReadPlanGoldenShape('contracts.get.v2 POST body', postBody);
  assert(postBody.endpoint.id === 'contracts.get.v2', 'POST body read-plan golden must use contracts.get.v2');
  assert(postBody.endpoint.method === 'POST', 'POST body read-plan golden must use POST');
  assert(postBody.endpoint.path === '/v2/contracts/get', 'POST body read-plan golden path mismatch');
  assert(postBody.tenant === 'sandbox', 'POST body read-plan golden must prove sandbox tenant selection');
  assert(postBody.validation.valid === true, 'POST body read-plan golden must be valid');
  assert(postBody.blocked === false, 'POST body read-plan golden must not be blocked');
  assert(postBody.requestSummary.envelopeMode === 'explicit', 'POST body read-plan golden must use explicit envelope mode');
  assertIncludes(postBody.requestSummary.bodyKeys, 'contract_id', 'POST body read-plan golden missing body contract_id');
  assert(postBody.requestSummary.queryKeys.length === 0, 'POST body read-plan golden must not use query keys');
  assert(postBody.requestSummary.pathKeys.length === 0, 'POST body read-plan golden must not use path keys');
  assert(postBody.plannedRead && postBody.plannedRead.type === 'planned-read', 'POST body read-plan golden missing planned read');
  assert(
    postBody.requiredLiveReadGate.status === 'blocked-until-guarded-read-runner',
    'POST body read-plan golden must keep live read gate blocked',
  );

  for (const postBodyInspect of [
    {
      label: 'contracts.list.v2 POST body',
      payload: contractsList,
      endpointId: 'contracts.list.v2',
      path: '/v2/contracts/list',
      tenant: 'sandbox',
      bodyKey: 'customer_id',
    },
    {
      label: 'customerBalances.list POST body',
      payload: customerBalances,
      endpointId: 'customerBalances.list',
      path: '/v1/contracts/customerBalances/list',
      tenant: 'sandbox',
      bodyKey: 'customer_id',
    },
    {
      label: 'seatBalances.list POST body',
      payload: seatBalances,
      endpointId: 'seatBalances.list',
      path: '/v1/contracts/seatBalances/list',
      tenant: 'sandbox',
      bodyKey: 'customer_id',
    },
    {
      label: 'commits.list POST body',
      payload: commitsList,
      endpointId: 'commits.list',
      path: '/v1/contracts/customerCommits/list',
      tenant: 'sandbox',
      bodyKey: 'customer_id',
    },
    {
      label: 'credits.list POST body',
      payload: creditsList,
      endpointId: 'credits.list',
      path: '/v1/contracts/customerCredits/list',
      tenant: 'sandbox',
      bodyKey: 'customer_id',
    },
    {
      label: 'events.search POST body',
      payload: eventsSearch,
      endpointId: 'events.search',
      path: '/v1/events/search',
      tenant: 'sandbox',
      bodyKey: 'transactionIds',
    },
    {
      label: 'packages.get POST body',
      payload: packagesGet,
      endpointId: 'packages.get',
      path: '/v1/packages/get',
      tenant: 'sandbox',
      bodyKey: 'package_id',
    },
    {
      label: 'billingProvider.getCustomerConfigurations POST body',
      payload: billingProviderGet,
      endpointId: 'billingProvider.getCustomerConfigurations',
      path: '/v1/getCustomerBillingProviderConfigurations',
      tenant: 'production',
      bodyKey: 'customer_id',
    },
    {
      label: 'products.get POST body',
      payload: productsGet,
      endpointId: 'products.get',
      path: '/v1/contract-pricing/products/get',
      tenant: 'sandbox',
      bodyKey: 'id',
    },
    {
      label: 'rateCards.get POST body',
      payload: rateCardsGet,
      endpointId: 'rateCards.get',
      path: '/v1/contract-pricing/rate-cards/get',
      tenant: 'sandbox',
      bodyKey: 'id',
    },
    {
      label: 'rateCards.getRateSchedule POST body',
      payload: rateCardSchedule,
      endpointId: 'rateCards.getRateSchedule',
      path: '/v1/contract-pricing/rate-cards/getRateSchedule',
      tenant: 'sandbox',
      bodyKey: 'rate_card_id',
    },
    {
      label: 'invoices.get POST body',
      payload: invoicesGet,
      endpointId: 'invoices.get',
      path: '/v1/invoices/get',
      tenant: 'production',
      bodyKey: 'invoice_id',
    },
  ]) {
    const { label, payload, endpointId, path: endpointPath, tenant, bodyKey } = postBodyInspect;
    assertReadPlanGoldenShape(label, payload);
    assert(payload.endpoint.id === endpointId, `${label} read-plan golden endpoint mismatch`);
    assert(payload.endpoint.method === 'POST', `${label} read-plan golden must use POST`);
    assert(payload.endpoint.path === endpointPath, `${label} read-plan golden path mismatch`);
    assert(payload.tenant === tenant, `${label} read-plan golden tenant mismatch`);
    assert(payload.validation.valid === true, `${label} read-plan golden must be valid`);
    assert(payload.blocked === false, `${label} read-plan golden must not be blocked`);
    assert(payload.requestSummary.envelopeMode === 'explicit', `${label} read-plan golden must use explicit envelope mode`);
    assertIncludes(payload.requestSummary.bodyKeys, bodyKey, `${label} read-plan golden missing body ${bodyKey}`);
    assert(payload.requestSummary.queryKeys.length === 0, `${label} read-plan golden must not use query keys`);
    assert(payload.requestSummary.pathKeys.length === 0, `${label} read-plan golden must not use path keys`);
    assert(payload.plannedRead && payload.plannedRead.type === 'planned-read', `${label} read-plan golden missing planned read`);
    assert(
      payload.requiredLiveReadGate.status === 'blocked-until-guarded-read-runner',
      `${label} read-plan golden must keep live read gate blocked`,
    );
  }
  assertIncludes(contractsList.requestSummary.bodyKeys, 'include_archived', 'contracts.list.v2 read-plan golden missing body include_archived');
  assertIncludes(customerBalances.requestSummary.bodyKeys, 'include_balance', 'customerBalances.list read-plan golden missing body include_balance');
  assertIncludes(customerBalances.requestSummary.bodyKeys, 'include_contract_balances', 'customerBalances.list read-plan golden missing body include_contract_balances');
  for (const expectedKey of [
    'contract_id',
    'subscription_ids',
    'seat_ids',
    'include_credits_and_commits',
    'include_ledgers',
    'covering_date',
    'limit',
  ]) {
    assertIncludes(seatBalances.requestSummary.bodyKeys, expectedKey, `seatBalances.list read-plan golden missing body ${expectedKey}`);
  }
  assert(seatBalances.requestSummary.queryKeys.length === 0, 'seatBalances.list read-plan golden must not use query keys');
  assert(seatBalances.requestSummary.pathKeys.length === 0, 'seatBalances.list read-plan golden must not use path keys');
  assertIncludes(commitsList.requestSummary.bodyKeys, 'include_contract_commits', 'commits.list read-plan golden missing body include_contract_commits');
  assertIncludes(creditsList.requestSummary.bodyKeys, 'include_contract_credits', 'credits.list read-plan golden missing body include_contract_credits');

  assertReadPlanGoldenShape('contracts.getRateSchedule POST body with query pagination', contractsRateSchedule);
  assert(
    contractsRateSchedule.endpoint.id === 'contracts.getRateSchedule',
    'contracts.getRateSchedule read-plan golden endpoint mismatch',
  );
  assert(contractsRateSchedule.endpoint.method === 'POST', 'contracts.getRateSchedule read-plan golden must use POST');
  assert(
    contractsRateSchedule.endpoint.path === '/v1/contracts/getContractRateSchedule',
    'contracts.getRateSchedule read-plan golden path mismatch',
  );
  assert(contractsRateSchedule.tenant === 'sandbox', 'contracts.getRateSchedule read-plan golden tenant mismatch');
  assert(contractsRateSchedule.validation.valid === true, 'contracts.getRateSchedule read-plan golden must be valid');
  assert(contractsRateSchedule.blocked === false, 'contracts.getRateSchedule read-plan golden must not be blocked');
  assert(
    contractsRateSchedule.requestSummary.envelopeMode === 'explicit',
    'contracts.getRateSchedule read-plan golden must use explicit envelope mode',
  );
  for (const expectedKey of ['at', 'contract_id', 'customer_id', 'selectors']) {
    assertIncludes(
      contractsRateSchedule.requestSummary.bodyKeys,
      expectedKey,
      `contracts.getRateSchedule read-plan golden missing body ${expectedKey}`,
    );
  }
  for (const expectedKey of ['limit', 'next_page']) {
    assertIncludes(
      contractsRateSchedule.requestSummary.queryKeys,
      expectedKey,
      `contracts.getRateSchedule read-plan golden missing query ${expectedKey}`,
    );
  }
  assert(
    contractsRateSchedule.requestSummary.pathKeys.length === 0,
    'contracts.getRateSchedule read-plan golden must not use path keys',
  );
  assert(
    contractsRateSchedule.plannedRead.path === '/v1/contracts/getContractRateSchedule',
    'contracts.getRateSchedule read-plan golden planned path mismatch',
  );
  assert(
    contractsRateSchedule.requiredLiveReadGate.status === 'blocked-until-guarded-read-runner',
    'contracts.getRateSchedule read-plan golden must keep live read gate blocked',
  );

  assertReadPlanGoldenShape('billableMetrics.get GET path', billableMetricsGet);
  assert(billableMetricsGet.endpoint.id === 'billableMetrics.get', 'billableMetrics.get read-plan golden endpoint mismatch');
  assert(billableMetricsGet.endpoint.method === 'GET', 'billableMetrics.get read-plan golden must use GET');
  assert(
    billableMetricsGet.endpoint.path === '/v1/billable-metrics/{billable_metric_id}',
    'billableMetrics.get read-plan golden path mismatch',
  );
  assert(billableMetricsGet.tenant === 'sandbox', 'billableMetrics.get read-plan golden tenant mismatch');
  assert(billableMetricsGet.validation.valid === true, 'billableMetrics.get read-plan golden must be valid');
  assert(billableMetricsGet.blocked === false, 'billableMetrics.get read-plan golden must not be blocked');
  assert(billableMetricsGet.requestSummary.envelopeMode === 'explicit', 'billableMetrics.get read-plan golden must use explicit envelope mode');
  assert(billableMetricsGet.requestSummary.bodyKeys.length === 0, 'billableMetrics.get read-plan golden must not use body keys');
  assertIncludes(billableMetricsGet.requestSummary.pathKeys, 'billable_metric_id', 'billableMetrics.get read-plan golden missing path billable_metric_id');
  assert(billableMetricsGet.requestSummary.queryKeys.length === 0, 'billableMetrics.get read-plan golden must not use query keys');
  assert(
    billableMetricsGet.requiredLiveReadGate.status === 'blocked-until-guarded-read-runner',
    'billableMetrics.get read-plan golden must keep live read gate blocked',
  );

  assertReadPlanGoldenShape('billableMetrics.list GET query', billableMetricsList);
  assert(billableMetricsList.endpoint.id === 'billableMetrics.list', 'billableMetrics.list read-plan golden endpoint mismatch');
  assert(billableMetricsList.endpoint.method === 'GET', 'billableMetrics.list read-plan golden must use GET');
  assert(billableMetricsList.endpoint.path === '/v1/billable-metrics', 'billableMetrics.list read-plan golden path mismatch');
  assert(billableMetricsList.tenant === 'sandbox', 'billableMetrics.list read-plan golden tenant mismatch');
  assert(billableMetricsList.validation.valid === true, 'billableMetrics.list read-plan golden must be valid');
  assert(billableMetricsList.blocked === false, 'billableMetrics.list read-plan golden must not be blocked');
  assert(billableMetricsList.requestSummary.envelopeMode === 'explicit', 'billableMetrics.list read-plan golden must use explicit envelope mode');
  assert(billableMetricsList.requestSummary.bodyKeys.length === 0, 'billableMetrics.list read-plan golden must not use body keys');
  assert(billableMetricsList.requestSummary.pathKeys.length === 0, 'billableMetrics.list read-plan golden must not use path keys');
  for (const expectedKey of ['include_archived', 'limit', 'next_page']) {
    assertIncludes(billableMetricsList.requestSummary.queryKeys, expectedKey, `billableMetrics.list read-plan golden missing query ${expectedKey}`);
  }
  assert(
    billableMetricsList.requiredLiveReadGate.status === 'blocked-until-guarded-read-runner',
    'billableMetrics.list read-plan golden must keep live read gate blocked',
  );

  assertReadPlanGoldenShape('packages.list POST query', packagesList);
  assert(packagesList.endpoint.id === 'packages.list', 'packages.list read-plan golden endpoint mismatch');
  assert(packagesList.endpoint.method === 'POST', 'packages.list read-plan golden must use POST');
  assert(packagesList.endpoint.path === '/v1/packages/list', 'packages.list read-plan golden path mismatch');
  assert(packagesList.tenant === 'sandbox', 'packages.list read-plan golden tenant mismatch');
  assert(packagesList.validation.valid === true, 'packages.list read-plan golden must be valid');
  assert(packagesList.blocked === false, 'packages.list read-plan golden must not be blocked');
  assert(packagesList.requestSummary.envelopeMode === 'explicit', 'packages.list read-plan golden must use explicit envelope mode');
  assert(packagesList.requestSummary.bodyKeys.length === 0, 'packages.list read-plan golden must not use body pagination keys');
  assertIncludes(packagesList.requestSummary.queryKeys, 'limit', 'packages.list read-plan golden missing query limit');
  assertIncludes(packagesList.requestSummary.queryKeys, 'next_page', 'packages.list read-plan golden missing query next_page');
  assert(packagesList.requestSummary.pathKeys.length === 0, 'packages.list read-plan golden must not use path keys');
  assert(packagesList.plannedRead && packagesList.plannedRead.type === 'planned-read', 'packages.list read-plan golden missing planned read');
  assert(
    packagesList.requiredLiveReadGate.status === 'blocked-until-guarded-read-runner',
    'packages.list read-plan golden must keep live read gate blocked',
  );

  for (const listReadPlan of [
    {
      label: 'products.list POST query',
      payload: productsList,
      endpointId: 'products.list',
      path: '/v1/contract-pricing/products/list',
      bodyKeys: ['archive_filter'],
    },
    {
      label: 'rateCards.list POST query',
      payload: rateCardsList,
      endpointId: 'rateCards.list',
      path: '/v1/contract-pricing/rate-cards/list',
      bodyKeys: [],
    },
    {
      label: 'rateCards.getRates POST body with query pagination',
      payload: rateCardsGetRates,
      endpointId: 'rateCards.getRates',
      path: '/v1/contract-pricing/rate-cards/getRates',
      bodyKeys: ['at', 'rate_card_id', 'selectors'],
    },
  ]) {
    const { label, payload } = listReadPlan;
    assertReadPlanGoldenShape(label, payload);
    assert(payload.endpoint.id === listReadPlan.endpointId, `${label} read-plan golden endpoint mismatch`);
    assert(payload.endpoint.method === 'POST', `${label} read-plan golden must use POST`);
    assert(payload.endpoint.path === listReadPlan.path, `${label} read-plan golden path mismatch`);
    assert(payload.tenant === 'sandbox', `${label} read-plan golden tenant mismatch`);
    assert(payload.validation.valid === true, `${label} read-plan golden must be valid`);
    assert(payload.blocked === false, `${label} read-plan golden must not be blocked`);
    assert(payload.requestSummary.envelopeMode === 'explicit', `${label} read-plan golden must use explicit envelope mode`);
    if (listReadPlan.bodyKeys.length === 0) {
      assert(payload.requestSummary.bodyKeys.length === 0, `${label} read-plan golden must not use body keys`);
    }
    for (const expectedKey of listReadPlan.bodyKeys) {
      assertIncludes(payload.requestSummary.bodyKeys, expectedKey, `${label} read-plan golden missing body ${expectedKey}`);
    }
    assertIncludes(payload.requestSummary.queryKeys, 'limit', `${label} read-plan golden missing query limit`);
    assertIncludes(payload.requestSummary.queryKeys, 'next_page', `${label} read-plan golden missing query next_page`);
    assert(payload.requestSummary.pathKeys.length === 0, `${label} read-plan golden must not use path keys`);
    assert(payload.plannedRead && payload.plannedRead.type === 'planned-read', `${label} read-plan golden missing planned read`);
    assert(
      payload.requiredLiveReadGate.status === 'blocked-until-guarded-read-runner',
      `${label} read-plan golden must keep live read gate blocked`,
    );
  }

  assertReadPlanGoldenShape('invoices.listForCustomer GET path/query', getPathQuery);
  assert(getPathQuery.endpoint.id === 'invoices.listForCustomer', 'GET path/query read-plan golden must use invoices.listForCustomer');
  assert(getPathQuery.endpoint.method === 'GET', 'GET path/query read-plan golden must use GET');
  assert(
    getPathQuery.endpoint.path === '/v1/customers/{customer_id}/invoices',
    'GET path/query read-plan golden path mismatch',
  );
  assert(getPathQuery.tenant === 'production', 'GET path/query read-plan golden must prove production tenant selection');
  assert(getPathQuery.validation.valid === true, 'GET path/query read-plan golden must be valid');
  assert(getPathQuery.blocked === false, 'GET path/query read-plan golden must not be blocked');
  assert(getPathQuery.requestSummary.envelopeMode === 'explicit', 'GET path/query read-plan golden must use explicit envelope mode');
  assert(getPathQuery.requestSummary.bodyKeys.length === 0, 'GET path/query read-plan golden must not use body keys');
  assertIncludes(getPathQuery.requestSummary.pathKeys, 'customer_id', 'GET path/query read-plan golden missing path customer_id');
  assertIncludes(getPathQuery.requestSummary.queryKeys, 'limit', 'GET path/query read-plan golden missing query limit');
  assertIncludes(getPathQuery.requestSummary.queryKeys, 'status', 'GET path/query read-plan golden missing query status');
  assert(getPathQuery.plannedRead && getPathQuery.plannedRead.type === 'planned-read', 'GET path/query read-plan golden missing planned read');

  assertReadPlanGoldenShape('customers.get GET path', customersGet);
  assert(customersGet.endpoint.id === 'customers.get', 'customers.get read-plan golden endpoint mismatch');
  assert(customersGet.endpoint.method === 'GET', 'customers.get read-plan golden must use GET');
  assert(customersGet.endpoint.path === '/v1/customers/{customer_id}', 'customers.get read-plan golden path mismatch');
  assert(customersGet.tenant === 'sandbox', 'customers.get read-plan golden tenant mismatch');
  assert(customersGet.validation.valid === true, 'customers.get read-plan golden must be valid');
  assert(customersGet.blocked === false, 'customers.get read-plan golden must not be blocked');
  assert(customersGet.requestSummary.envelopeMode === 'explicit', 'customers.get read-plan golden must use explicit envelope mode');
  assert(customersGet.requestSummary.bodyKeys.length === 0, 'customers.get read-plan golden must not use body keys');
  assertIncludes(customersGet.requestSummary.pathKeys, 'customer_id', 'customers.get read-plan golden missing path customer_id');
  assert(customersGet.requestSummary.queryKeys.length === 0, 'customers.get read-plan golden must not use query keys');

  assertReadPlanGoldenShape('customers.list GET query', customersList);
  assert(customersList.endpoint.id === 'customers.list', 'customers.list read-plan golden endpoint mismatch');
  assert(customersList.endpoint.method === 'GET', 'customers.list read-plan golden must use GET');
  assert(customersList.endpoint.path === '/v1/customers', 'customers.list read-plan golden path mismatch');
  assert(customersList.tenant === 'sandbox', 'customers.list read-plan golden tenant mismatch');
  assert(customersList.validation.valid === true, 'customers.list read-plan golden must be valid');
  assert(customersList.blocked === false, 'customers.list read-plan golden must not be blocked');
  assert(customersList.requestSummary.envelopeMode === 'explicit', 'customers.list read-plan golden must use explicit envelope mode');
  assert(customersList.requestSummary.bodyKeys.length === 0, 'customers.list read-plan golden must not use body keys');
  assert(customersList.requestSummary.pathKeys.length === 0, 'customers.list read-plan golden must not use path keys');
  for (const expectedKey of ['customer_ids', 'limit', 'only_archived']) {
    assertIncludes(customersList.requestSummary.queryKeys, expectedKey, `customers.list read-plan golden missing query ${expectedKey}`);
  }

  assertReadPlanGoldenShape('usage.groups POST body with query pagination', implicitQuery);
  assert(implicitQuery.endpoint.id === 'usage.groups', 'usage.groups read-plan golden endpoint mismatch');
  assert(implicitQuery.endpoint.method === 'POST', 'usage.groups read-plan golden must use POST');
  assert(implicitQuery.endpoint.path === '/v1/usage/groups', 'usage.groups read-plan golden path mismatch');
  assert(implicitQuery.tenant === 'sandbox', 'usage.groups read-plan golden must prove sandbox tenant selection');
  assert(implicitQuery.validation.valid === true, 'usage.groups read-plan golden must be valid');
  assert(implicitQuery.blocked === false, 'usage.groups read-plan golden must not be blocked');
  assert(
    implicitQuery.requestSummary.envelopeMode === 'explicit',
    'usage.groups read-plan golden must use explicit envelope mode',
  );
  for (const expectedKey of ['billable_metric_id', 'customer_id', 'ending_before', 'group_key', 'starting_on', 'window_size']) {
    assertIncludes(implicitQuery.requestSummary.bodyKeys, expectedKey, `usage.groups read-plan golden missing body ${expectedKey}`);
  }
  assert(implicitQuery.requestSummary.pathKeys.length === 0, 'usage.groups read-plan golden must not use path keys');
  assertIncludes(implicitQuery.requestSummary.queryKeys, 'limit', 'usage.groups read-plan golden missing query limit');
  assert(implicitQuery.plannedRead && implicitQuery.plannedRead.type === 'planned-read', 'usage.groups read-plan golden missing planned read');

  assertReadPlanGoldenShape('usage.batch POST body with query pagination', usageBatch);
  assert(usageBatch.endpoint.id === 'usage.batch', 'usage.batch read-plan golden endpoint mismatch');
  assert(usageBatch.endpoint.method === 'POST', 'usage.batch read-plan golden must use POST');
  assert(usageBatch.endpoint.path === '/v1/usage', 'usage.batch read-plan golden path mismatch');
  assert(usageBatch.tenant === 'sandbox', 'usage.batch read-plan golden must prove sandbox tenant selection');
  assert(usageBatch.validation.valid === true, 'usage.batch read-plan golden must be valid');
  assert(usageBatch.blocked === false, 'usage.batch read-plan golden must not be blocked');
  assert(usageBatch.requestSummary.envelopeMode === 'explicit', 'usage.batch read-plan golden must use explicit envelope mode');
  for (const expectedKey of ['billable_metrics', 'customer_ids', 'ending_before', 'starting_on', 'window_size']) {
    assertIncludes(usageBatch.requestSummary.bodyKeys, expectedKey, `usage.batch read-plan golden missing body ${expectedKey}`);
  }
  assert(usageBatch.requestSummary.pathKeys.length === 0, 'usage.batch read-plan golden must not use path keys');
  assertIncludes(usageBatch.requestSummary.queryKeys, 'next_page', 'usage.batch read-plan golden missing query next_page');
  assert(usageBatch.plannedRead && usageBatch.plannedRead.type === 'planned-read', 'usage.batch read-plan golden missing planned read');

  assertReadPlanGoldenShape('usage.groups blocked invalid', blockedInvalid);
  assert(blockedInvalid.endpoint.id === 'usage.groups', 'blocked read-plan golden must use usage.groups');
  assert(blockedInvalid.endpoint.method === 'POST', 'blocked read-plan golden must use POST');
  assert(blockedInvalid.endpoint.path === '/v1/usage/groups', 'blocked read-plan golden path mismatch');
  assert(blockedInvalid.tenant === 'sandbox', 'blocked read-plan golden must prove sandbox tenant selection');
  assert(blockedInvalid.validation.valid === false, 'blocked read-plan golden must be invalid');
  assert(blockedInvalid.blocked === true, 'blocked read-plan golden must be blocked');
  assert(blockedInvalid.requestSummary === null, 'blocked read-plan golden must not include a request summary');
  assert(blockedInvalid.plannedRead === null, 'blocked read-plan golden must not include a planned read');
  assert(
    blockedInvalid.requiredLiveReadGate.status === 'blocked-until-valid-request',
    'blocked read-plan golden must stop at the valid-request gate',
  );
  assert(
    blockedInvalid.validation.validation.envelopeMode === 'explicit',
    'blocked read-plan golden must preserve explicit envelope mode',
  );
  const findingPaths = blockedInvalid.validation.findings.map((finding) => finding.path);
  for (const expectedPath of ['query.customer_id', 'query.starting_on', 'query.ending_before', 'body.customer_id']) {
    assertIncludes(findingPaths, expectedPath, `blocked read-plan golden missing finding ${expectedPath}`);
  }

  assertReadPlanGoldenShape('usage.batch blocked invalid', usageBatchInvalid);
  assert(usageBatchInvalid.endpoint.id === 'usage.batch', 'usage.batch blocked read-plan golden endpoint mismatch');
  assert(usageBatchInvalid.endpoint.method === 'POST', 'usage.batch blocked read-plan golden must use POST');
  assert(usageBatchInvalid.endpoint.path === '/v1/usage', 'usage.batch blocked read-plan golden path mismatch');
  assert(usageBatchInvalid.tenant === 'sandbox', 'usage.batch blocked read-plan golden must prove sandbox tenant selection');
  assert(usageBatchInvalid.validation.valid === false, 'usage.batch blocked read-plan golden must be invalid');
  assert(usageBatchInvalid.blocked === true, 'usage.batch blocked read-plan golden must be blocked');
  assert(usageBatchInvalid.requestSummary === null, 'usage.batch blocked read-plan golden must not include a request summary');
  assert(usageBatchInvalid.plannedRead === null, 'usage.batch blocked read-plan golden must not include a planned read');
  assert(
    usageBatchInvalid.requiredLiveReadGate.status === 'blocked-until-valid-request',
    'usage.batch blocked read-plan golden must stop at the valid-request gate',
  );
  const usageBatchFindingPaths = usageBatchInvalid.validation.findings.map((finding) => finding.path);
  for (const expectedPath of ['body.window_size', 'body.starting_on', 'body.next_page', 'query.customer_ids']) {
    assertIncludes(usageBatchFindingPaths, expectedPath, `usage.batch blocked read-plan golden missing finding ${expectedPath}`);
  }
}

function assertReadMockGoldenShape(label, payload) {
  assert(payload.schemaVersion === 'metro.api.read-mock.v1', `${label} read-mock schema mismatch`);
  assert(payload.apiAccess === 'none', `${label} read-mock must be local-only`);
  assert(payload.liveExecution && payload.liveExecution.enabledInCurrentCli === false, `${label} read-mock must keep live execution disabled`);
  assert(payload.readEnabledInCurrentCli === false, `${label} read-mock must keep live read disabled`);
  assert(payload.blocked === false, `${label} read-mock must not be blocked`);
  assert(payload.readResult && payload.readResult.schemaVersion === 'metro.api.read-result.v1', `${label} missing read-result payload`);
  assert(payload.readResult.apiAccess === 'mocked-read', `${label} read-result must use mocked transport`);
  assert(payload.readResult.liveExecution.enabledInCurrentCli === false, `${label} read-result must keep live execution disabled`);
  assert(payload.readResult.readEnabledInCurrentCli === false, `${label} read-result must keep live read disabled`);
  assert(payload.readResultValidation && payload.readResultValidation.valid === true, `${label} read-result validation must pass`);
  assert(
    payload.readAuditTemplate && payload.readAuditTemplate.schemaVersion === 'metro.api.read-audit.template.v1',
    `${label} missing read-audit template`,
  );
  assert(
    payload.readAuditTemplate.row.requestSummary.rawRequestBodyStored === false,
    `${label} read-audit template must not store raw request bodies`,
  );
  assert(
    payload.readAuditTemplate.row.responseSummary.responseHash === payload.readResult.responseSummary.responseHash,
    `${label} read-audit response hash must match read-result response hash`,
  );
}

function assertReadPipelineGoldenShape(label, payload) {
  assert(payload.schemaVersion === 'metro.api.read-pipeline.v1', `${label} read-pipeline schema mismatch`);
  assert(payload.apiAccess === 'none', `${label} read-pipeline must be local-only`);
  assert(payload.liveExecution && payload.liveExecution.enabledInCurrentCli === false, `${label} read-pipeline must keep live execution disabled`);
  assert(payload.readEnabledInCurrentCli === false, `${label} read-pipeline must keep live read disabled`);
  assert(payload.transportMode === 'mocked', `${label} read-pipeline must use mocked transport`);
  assert(payload.mode === 'dry-run', `${label} read-pipeline golden must be a dry-run`);
  assert(payload.blocked === false, `${label} read-pipeline must not be blocked`);
  assert(payload.summary.liveReadEnabledInCurrentCli === false, `${label} read-pipeline summary must keep live reads disabled`);
  assert(payload.summary.readResultValid === true, `${label} read-pipeline read-result summary must pass`);
  assert(payload.summary.auditRowValid === true, `${label} read-pipeline audit row summary must pass`);
  assert(payload.summary.auditRowsWritten === 0, `${label} read-pipeline dry-run must not write audit rows`);
  assert(payload.readMock && payload.readMock.schemaVersion === 'metro.api.read-mock.v1', `${label} read-pipeline missing read-mock payload`);
  assert(payload.readMock.readResultValidation.valid === true, `${label} read-pipeline read-result validation must pass`);
  assert(payload.readAuditWrite && payload.readAuditWrite.schemaVersion === 'metro.api.read-audit.write.v1', `${label} read-pipeline missing read-audit writer payload`);
  assert(payload.readAuditWrite.rowValidation.valid === true, `${label} read-pipeline audit row validation must pass`);
  assert(payload.readAuditWrite.write.wrote === false, `${label} read-pipeline golden must not write local files`);
  assert(payload.readAuditWrite.row.requestSummary.rawRequestBodyStored === false, `${label} read-pipeline must not store raw request bodies`);
  assert(
    payload.readAuditWrite.row.responseSummary.responseHash === payload.readMock.readResult.responseSummary.responseHash,
    `${label} read-pipeline audit response hash must match read-result response hash`,
  );
}

function assertReadMockGoldenCoverage() {
  const apiGoldenDir = path.join(packageRoot, 'test', 'golden', 'api');
  const contracts = readJson(path.join(apiGoldenDir, 'read-mock.contracts-get-v2.bundle.sandbox.json'));
  const readPipeline = readJson(path.join(apiGoldenDir, 'read-pipeline.contracts-get-v2.dry-run.sandbox.json'));
  const eventsSearchPipeline = readJson(path.join(apiGoldenDir, 'read-pipeline.events-search.dry-run.sandbox.json'));
  const billableMetricsGetPipeline = readJson(path.join(apiGoldenDir, 'read-pipeline.billable-metrics-get.dry-run.sandbox.json'));
  const billableMetricsListPipeline = readJson(path.join(apiGoldenDir, 'read-pipeline.billable-metrics-list.dry-run.sandbox.json'));
  const packagesPipeline = readJson(path.join(apiGoldenDir, 'read-pipeline.packages-list.dry-run.sandbox.json'));
  const billingProviderPipeline = readJson(path.join(apiGoldenDir, 'read-pipeline.billing-provider-get.dry-run.production.json'));
  const customFieldsListKeysPipeline = readJson(path.join(apiGoldenDir, 'read-pipeline.custom-fields-list-keys.dry-run.sandbox.json'));
  const pricingUnitsPipeline = readJson(path.join(apiGoldenDir, 'read-pipeline.settings-pricing-units-list.dry-run.sandbox.json'));
  const securityServicesPipeline = readJson(path.join(apiGoldenDir, 'read-pipeline.security-services-get.dry-run.sandbox.json'));
  const securityAuditLogsPipeline = readJson(path.join(apiGoldenDir, 'read-pipeline.security-audit-logs.dry-run.sandbox.json'));
  const invoicesPipeline = readJson(path.join(apiGoldenDir, 'read-pipeline.invoices-list-for-customer.dry-run.production.json'));
  const customersGetPipeline = readJson(path.join(apiGoldenDir, 'read-pipeline.customers-get.dry-run.sandbox.json'));
  const contractsListPipeline = readJson(path.join(apiGoldenDir, 'read-pipeline.contracts-list-v2.dry-run.sandbox.json'));
  const contractsRateSchedulePipeline = readJson(path.join(apiGoldenDir, 'read-pipeline.contracts-rate-schedule.dry-run.sandbox.json'));
  const customerBalancesPipeline = readJson(path.join(apiGoldenDir, 'read-pipeline.customer-balances-list.dry-run.sandbox.json'));
  const seatBalancesPipeline = readJson(path.join(apiGoldenDir, 'read-pipeline.seat-balances-list.dry-run.sandbox.json'));
  const commitsListPipeline = readJson(path.join(apiGoldenDir, 'read-pipeline.commits-list.dry-run.sandbox.json'));
  const creditsListPipeline = readJson(path.join(apiGoldenDir, 'read-pipeline.credits-list.dry-run.sandbox.json'));
  const packagesGetPipeline = readJson(path.join(apiGoldenDir, 'read-pipeline.packages-get.dry-run.sandbox.json'));
  const productsGetPipeline = readJson(path.join(apiGoldenDir, 'read-pipeline.products-get.dry-run.sandbox.json'));
  const productsListPipeline = readJson(path.join(apiGoldenDir, 'read-pipeline.products-list.dry-run.sandbox.json'));
  const rateCardsGetPipeline = readJson(path.join(apiGoldenDir, 'read-pipeline.rate-cards-get.dry-run.sandbox.json'));
  const rateCardsListPipeline = readJson(path.join(apiGoldenDir, 'read-pipeline.rate-cards-list.dry-run.sandbox.json'));
  const rateCardsGetRatesPipeline = readJson(path.join(apiGoldenDir, 'read-pipeline.rate-cards-get-rates.dry-run.sandbox.json'));
  const rateCardSchedulePipeline = readJson(path.join(apiGoldenDir, 'read-pipeline.rate-card-schedule.dry-run.sandbox.json'));
  const invoicesGetPipeline = readJson(path.join(apiGoldenDir, 'read-pipeline.invoices-get.dry-run.production.json'));
  const customersListPipeline = readJson(path.join(apiGoldenDir, 'read-pipeline.customers-list.dry-run.sandbox.json'));
  const usageGroupsPipeline = readJson(path.join(apiGoldenDir, 'read-pipeline.usage-groups.dry-run.sandbox.json'));
  const usageBatchPipeline = readJson(path.join(apiGoldenDir, 'read-pipeline.usage-batch.dry-run.sandbox.json'));
  const contractsList = readJson(path.join(apiGoldenDir, 'read-mock.contracts-list-v2.bundle.sandbox.json'));
  const customerBalances = readJson(path.join(apiGoldenDir, 'read-mock.customer-balances-list.bundle.sandbox.json'));
  const seatBalances = readJson(path.join(apiGoldenDir, 'read-mock.seat-balances-list.bundle.sandbox.json'));
  const commitsList = readJson(path.join(apiGoldenDir, 'read-mock.commits-list.bundle.sandbox.json'));
  const creditsList = readJson(path.join(apiGoldenDir, 'read-mock.credits-list.bundle.sandbox.json'));
  const invoices = readJson(path.join(apiGoldenDir, 'read-mock.invoices-list-for-customer.bundle.production.json'));
  const billingProvider = readJson(path.join(apiGoldenDir, 'read-mock.billing-provider-get.bundle.production.json'));
  const customFieldsListKeys = readJson(path.join(apiGoldenDir, 'read-mock.custom-fields-list-keys.bundle.sandbox.json'));
  const pricingUnits = readJson(path.join(apiGoldenDir, 'read-mock.settings-pricing-units-list.bundle.sandbox.json'));
  const securityServices = readJson(path.join(apiGoldenDir, 'read-mock.security-services-get.bundle.sandbox.json'));
  const securityAuditLogs = readJson(path.join(apiGoldenDir, 'read-mock.security-audit-logs.bundle.sandbox.json'));
  const packages = readJson(path.join(apiGoldenDir, 'read-mock.packages-list.bundle.sandbox.json'));
  const usageGroups = readJson(path.join(apiGoldenDir, 'read-mock.usage-groups.bundle.sandbox.json'));
  const usageBatch = readJson(path.join(apiGoldenDir, 'read-mock.usage-batch.bundle.sandbox.json'));
  const eventsSearch = readJson(path.join(apiGoldenDir, 'read-mock.events-search.bundle.sandbox.json'));
  const billableMetricsGet = readJson(path.join(apiGoldenDir, 'read-mock.billable-metrics-get.bundle.sandbox.json'));
  const billableMetricsList = readJson(path.join(apiGoldenDir, 'read-mock.billable-metrics-list.bundle.sandbox.json'));
  const customersGet = readJson(path.join(apiGoldenDir, 'read-mock.customers-get.bundle.sandbox.json'));
  const customersList = readJson(path.join(apiGoldenDir, 'read-mock.customers-list.bundle.sandbox.json'));
  const productsList = readJson(path.join(apiGoldenDir, 'read-mock.products-list.bundle.sandbox.json'));
  const rateCardsGet = readJson(path.join(apiGoldenDir, 'read-mock.rate-cards-get.bundle.sandbox.json'));
  const rateCardsList = readJson(path.join(apiGoldenDir, 'read-mock.rate-cards-list.bundle.sandbox.json'));
  const rateCardsGetRates = readJson(path.join(apiGoldenDir, 'read-mock.rate-cards-get-rates.bundle.sandbox.json'));
  const contractsRateSchedule = readJson(path.join(apiGoldenDir, 'read-mock.contracts-rate-schedule.bundle.sandbox.json'));

  assertReadMockGoldenShape('contracts.get.v2 POST body', contracts);
  assert(contracts.endpoint.id === 'contracts.get.v2', 'contracts.get.v2 read-mock golden endpoint mismatch');
  assert(contracts.tenant === 'sandbox', 'contracts.get.v2 read-mock golden tenant mismatch');
  assert(contracts.readResult.requestSummary.method === 'POST', 'contracts.get.v2 read-mock request must use POST');
  assert(contracts.readResult.requestSummary.path === '/v2/contracts/get', 'contracts.get.v2 read-mock path mismatch');
  assertIncludes(contracts.readResult.requestSummary.bodyKeys, 'contract_id', 'contracts.get.v2 read-mock missing body contract_id');
  assert(contracts.readResult.requestSummary.queryKeys.length === 0, 'contracts.get.v2 read-mock must not use query keys');
  assert(contracts.readResult.requestSummary.pathKeys.length === 0, 'contracts.get.v2 read-mock must not use path keys');

  assertReadPipelineGoldenShape('contracts.get.v2 POST body', readPipeline);
  assert(readPipeline.endpoint.id === 'contracts.get.v2', 'contracts.get.v2 read-pipeline endpoint mismatch');
  assert(readPipeline.tenant === 'sandbox', 'contracts.get.v2 read-pipeline tenant mismatch');
  assert(readPipeline.readMock.readResult.requestSummary.method === 'POST', 'contracts.get.v2 read-pipeline request must use POST');
  assert(readPipeline.readMock.readResult.requestSummary.path === '/v2/contracts/get', 'contracts.get.v2 read-pipeline path mismatch');
  assertIncludes(readPipeline.readMock.readResult.requestSummary.bodyKeys, 'contract_id', 'contracts.get.v2 read-pipeline missing body contract_id');

  assertReadPipelineGoldenShape('events.search POST body', eventsSearchPipeline);
  assert(eventsSearchPipeline.endpoint.id === 'events.search', 'events.search read-pipeline endpoint mismatch');
  assert(eventsSearchPipeline.tenant === 'sandbox', 'events.search read-pipeline tenant mismatch');
  assert(eventsSearchPipeline.readMock.readResult.requestSummary.method === 'POST', 'events.search read-pipeline request must use POST');
  assert(eventsSearchPipeline.readMock.readResult.requestSummary.path === '/v1/events/search', 'events.search read-pipeline path mismatch');
  assertIncludes(eventsSearchPipeline.readMock.readResult.requestSummary.bodyKeys, 'transactionIds', 'events.search read-pipeline missing body transactionIds');

  assertReadPipelineGoldenShape('packages.list paginated POST query', packagesPipeline);
  assert(packagesPipeline.endpoint.id === 'packages.list', 'packages.list read-pipeline endpoint mismatch');
  assert(packagesPipeline.tenant === 'sandbox', 'packages.list read-pipeline tenant mismatch');
  assert(packagesPipeline.readMock.readResult.requestSummary.method === 'POST', 'packages.list read-pipeline request must use POST');
  assert(packagesPipeline.readMock.readResult.requestSummary.path === '/v1/packages/list?limit=50&next_page=cursor-test', 'packages.list read-pipeline path/query mismatch');
  assert(packagesPipeline.readMock.readResult.requestSummary.bodyKeys.length === 0, 'packages.list read-pipeline must keep pagination out of body');
  assertIncludes(packagesPipeline.readMock.readResult.requestSummary.queryKeys, 'limit', 'packages.list read-pipeline missing query limit');
  assertIncludes(packagesPipeline.readMock.readResult.requestSummary.queryKeys, 'next_page', 'packages.list read-pipeline missing query next_page');

  assertReadPipelineGoldenShape('billingProvider.getCustomerConfigurations POST body', billingProviderPipeline);
  assert(billingProviderPipeline.endpoint.id === 'billingProvider.getCustomerConfigurations', 'billingProvider.getCustomerConfigurations read-pipeline endpoint mismatch');
  assert(billingProviderPipeline.tenant === 'production', 'billingProvider.getCustomerConfigurations read-pipeline tenant mismatch');
  assert(billingProviderPipeline.readMock.readResult.requestSummary.method === 'POST', 'billingProvider.getCustomerConfigurations read-pipeline request must use POST');
  assert(billingProviderPipeline.readMock.readResult.requestSummary.path === '/v1/getCustomerBillingProviderConfigurations', 'billingProvider.getCustomerConfigurations read-pipeline path mismatch');
  assertIncludes(billingProviderPipeline.readMock.readResult.requestSummary.bodyKeys, 'customer_id', 'billingProvider.getCustomerConfigurations read-pipeline missing body customer_id');
  assert(billingProviderPipeline.readAuditWrite.row.keyFingerprint.envVar === 'METRONOME_PROD_KEY', 'billingProvider.getCustomerConfigurations read-pipeline must bind production key env name only');

  assertReadPipelineGoldenShape('invoices.listForCustomer GET path/query', invoicesPipeline);
  assert(invoicesPipeline.endpoint.id === 'invoices.listForCustomer', 'invoices.listForCustomer read-pipeline endpoint mismatch');
  assert(invoicesPipeline.tenant === 'production', 'invoices.listForCustomer read-pipeline tenant mismatch');
  assert(invoicesPipeline.readMock.readResult.requestSummary.method === 'GET', 'invoices.listForCustomer read-pipeline request must use GET');
  assert(
    invoicesPipeline.readMock.readResult.requestSummary.path === '/v1/customers/customer-test-001/invoices?limit=50&sort=date_desc&status=DRAFT',
    'invoices.listForCustomer read-pipeline path/query mismatch',
  );
  assert(invoicesPipeline.readMock.readResult.requestSummary.bodyKeys.length === 0, 'invoices.listForCustomer read-pipeline must not use body keys');
  assertIncludes(invoicesPipeline.readMock.readResult.requestSummary.pathKeys, 'customer_id', 'invoices.listForCustomer read-pipeline missing path customer_id');
  assertIncludes(invoicesPipeline.readMock.readResult.requestSummary.queryKeys, 'status', 'invoices.listForCustomer read-pipeline missing query status');

  assertReadPipelineGoldenShape('customers.get GET path', customersGetPipeline);
  assert(customersGetPipeline.endpoint.id === 'customers.get', 'customers.get read-pipeline endpoint mismatch');
  assert(customersGetPipeline.tenant === 'sandbox', 'customers.get read-pipeline tenant mismatch');
  assert(customersGetPipeline.readMock.readResult.requestSummary.method === 'GET', 'customers.get read-pipeline request must use GET');
  assert(customersGetPipeline.readMock.readResult.requestSummary.path === '/v1/customers/customer-test-001', 'customers.get read-pipeline path mismatch');
  assert(customersGetPipeline.readMock.readResult.requestSummary.bodyKeys.length === 0, 'customers.get read-pipeline must not use body keys');
  assertIncludes(customersGetPipeline.readMock.readResult.requestSummary.pathKeys, 'customer_id', 'customers.get read-pipeline missing path customer_id');

  for (const item of [
    {
      label: 'contracts.list.v2 POST body',
      payload: contractsListPipeline,
      endpointId: 'contracts.list.v2',
      tenant: 'sandbox',
      method: 'POST',
      path: '/v2/contracts/list',
      bodyKeys: ['customer_id', 'include_archived'],
      responsePath: ['next_page'],
      responseValue: 'cursor-next-test',
    },
    {
      label: 'contracts.getRateSchedule POST body with query pagination',
      payload: contractsRateSchedulePipeline,
      endpointId: 'contracts.getRateSchedule',
      tenant: 'sandbox',
      method: 'POST',
      path: '/v1/contracts/getContractRateSchedule?limit=50&next_page=cursor-test',
      bodyKeys: ['at', 'contract_id', 'customer_id', 'selectors'],
      queryKeys: ['limit', 'next_page'],
      responsePath: ['data', 0, 'override_rate', 'price'],
      responseValue: 12500,
    },
    {
      label: 'customerBalances.list POST body',
      payload: customerBalancesPipeline,
      endpointId: 'customerBalances.list',
      tenant: 'sandbox',
      method: 'POST',
      path: '/v1/contracts/customerBalances/list',
      bodyKeys: ['customer_id', 'include_balance', 'include_contract_balances'],
      responsePath: ['data', 0, 'id'],
      responseValue: 'commit-test-001',
    },
    {
      label: 'seatBalances.list POST body',
      payload: seatBalancesPipeline,
      endpointId: 'seatBalances.list',
      tenant: 'sandbox',
      method: 'POST',
      path: '/v1/contracts/seatBalances/list',
      bodyKeys: [
        'contract_id',
        'covering_date',
        'customer_id',
        'include_credits_and_commits',
        'include_ledgers',
        'limit',
        'seat_ids',
        'subscription_ids',
      ],
      responsePath: ['data', 0, 'seat_id'],
      responseValue: 'user-test-001',
    },
    {
      label: 'commits.list POST body',
      payload: commitsListPipeline,
      endpointId: 'commits.list',
      tenant: 'sandbox',
      method: 'POST',
      path: '/v1/contracts/customerCommits/list',
      bodyKeys: ['customer_id', 'include_archived', 'include_balance', 'include_contract_commits', 'include_ledgers'],
      responsePath: ['data', 0, 'id'],
      responseValue: 'commit-test-001',
    },
    {
      label: 'credits.list POST body',
      payload: creditsListPipeline,
      endpointId: 'credits.list',
      tenant: 'sandbox',
      method: 'POST',
      path: '/v1/contracts/customerCredits/list',
      bodyKeys: ['customer_id', 'include_archived', 'include_balance', 'include_contract_credits', 'include_ledgers'],
      responsePath: ['data', 0, 'id'],
      responseValue: 'credit-test-001',
    },
    {
      label: 'billableMetrics.get GET path',
      payload: billableMetricsGetPipeline,
      endpointId: 'billableMetrics.get',
      tenant: 'sandbox',
      method: 'GET',
      path: '/v1/billable-metrics/00000000-0000-4000-8000-000000000001',
      pathKeys: ['billable_metric_id'],
      responsePath: ['data', 'id'],
      responseValue: '00000000-0000-4000-8000-000000000001',
    },
    {
      label: 'billableMetrics.list GET query',
      payload: billableMetricsListPipeline,
      endpointId: 'billableMetrics.list',
      tenant: 'sandbox',
      method: 'GET',
      path: '/v1/billable-metrics?include_archived=false&limit=50&next_page=cursor-test',
      queryKeys: ['include_archived', 'limit', 'next_page'],
      responsePath: ['next_page'],
      responseValue: 'cursor-next-test',
    },
    {
      label: 'packages.get POST body',
      payload: packagesGetPipeline,
      endpointId: 'packages.get',
      tenant: 'sandbox',
      method: 'POST',
      path: '/v1/packages/get',
      bodyKeys: ['package_id'],
      responsePath: ['id'],
      responseValue: 'package-test-001',
    },
    {
      label: 'products.get POST body',
      payload: productsGetPipeline,
      endpointId: 'products.get',
      tenant: 'sandbox',
      method: 'POST',
      path: '/v1/contract-pricing/products/get',
      bodyKeys: ['id'],
      responsePath: ['id'],
      responseValue: 'product-test-001',
    },
    {
      label: 'products.list POST body with query pagination',
      payload: productsListPipeline,
      endpointId: 'products.list',
      tenant: 'sandbox',
      method: 'POST',
      path: '/v1/contract-pricing/products/list?limit=50&next_page=cursor-test',
      bodyKeys: ['archive_filter'],
      queryKeys: ['limit', 'next_page'],
      responsePath: ['data', 0, 'id'],
      responseValue: 'product-test-001',
    },
    {
      label: 'rateCards.get POST body',
      payload: rateCardsGetPipeline,
      endpointId: 'rateCards.get',
      tenant: 'sandbox',
      method: 'POST',
      path: '/v1/contract-pricing/rate-cards/get',
      bodyKeys: ['id'],
      responsePath: ['data', 'id'],
      responseValue: 'rate-card-test-001',
    },
    {
      label: 'rateCards.list POST query',
      payload: rateCardsListPipeline,
      endpointId: 'rateCards.list',
      tenant: 'sandbox',
      method: 'POST',
      path: '/v1/contract-pricing/rate-cards/list?limit=50&next_page=cursor-test',
      queryKeys: ['limit', 'next_page'],
      responsePath: ['data', 0, 'id'],
      responseValue: 'rate-card-test-001',
    },
    {
      label: 'rateCards.getRates POST body with query pagination',
      payload: rateCardsGetRatesPipeline,
      endpointId: 'rateCards.getRates',
      tenant: 'sandbox',
      method: 'POST',
      path: '/v1/contract-pricing/rate-cards/getRates?limit=50&next_page=cursor-test',
      bodyKeys: ['at', 'rate_card_id', 'selectors'],
      queryKeys: ['limit', 'next_page'],
      responsePath: ['data', 0, 'product_id'],
      responseValue: 'product-test-001',
    },
    {
      label: 'rateCards.getRateSchedule POST body',
      payload: rateCardSchedulePipeline,
      endpointId: 'rateCards.getRateSchedule',
      tenant: 'sandbox',
      method: 'POST',
      path: '/v1/contract-pricing/rate-cards/getRateSchedule',
      bodyKeys: ['rate_card_id'],
      responsePath: ['data', 0, 'rate_card_id'],
      responseValue: 'rate-card-test-001',
    },
    {
      label: 'invoices.get POST body',
      payload: invoicesGetPipeline,
      endpointId: 'invoices.get',
      tenant: 'production',
      method: 'POST',
      path: '/v1/invoices/get',
      bodyKeys: ['invoice_id'],
      responsePath: ['id'],
      responseValue: 'invoice-test-001',
      keyEnv: 'METRONOME_PROD_KEY',
    },
    {
      label: 'customers.list GET query',
      payload: customersListPipeline,
      endpointId: 'customers.list',
      tenant: 'sandbox',
      method: 'GET',
      path: '/v1/customers?customer_ids=customer-test-001&customer_ids=customer-test-002&limit=50&only_archived=false',
      queryKeys: ['customer_ids', 'limit', 'only_archived'],
      responsePath: ['next_page'],
      responseValue: 'cursor-next-test',
    },
    {
      label: 'usage.groups POST body with query pagination',
      payload: usageGroupsPipeline,
      endpointId: 'usage.groups',
      tenant: 'sandbox',
      method: 'POST',
      path: '/v1/usage/groups?limit=100',
      bodyKeys: ['billable_metric_id', 'customer_id', 'ending_before', 'group_key', 'starting_on', 'window_size'],
      queryKeys: ['limit'],
      responsePath: ['next_page'],
      responseValue: 'cursor-next-test',
    },
    {
      label: 'usage.batch POST body with query pagination',
      payload: usageBatchPipeline,
      endpointId: 'usage.batch',
      tenant: 'sandbox',
      method: 'POST',
      path: '/v1/usage?next_page=cursor-test',
      bodyKeys: ['billable_metrics', 'customer_ids', 'ending_before', 'starting_on', 'window_size'],
      queryKeys: ['next_page'],
      responsePath: ['next_page'],
      responseValue: 'cursor-next-test',
    },
    {
      label: 'customFields.listKeys POST body with query pagination',
      payload: customFieldsListKeysPipeline,
      endpointId: 'customFields.listKeys',
      tenant: 'sandbox',
      method: 'POST',
      path: '/v1/customFields/listKeys?next_page=cursor-custom-fields-test',
      bodyKeys: ['entities'],
      queryKeys: ['next_page'],
      responsePath: ['next_page'],
      responseValue: 'cursor-custom-fields-next-test',
    },
    {
      label: 'security.getAuditLogs GET query filters',
      payload: securityAuditLogsPipeline,
      endpointId: 'security.getAuditLogs',
      tenant: 'sandbox',
      method: 'GET',
      path: '/v1/auditLogs?ending_before=2026-06-02T00%3A00%3A00.000Z&limit=50&resource_id=customer-test-001&resource_type=customer&sort=date_asc&starting_on=2026-06-01T00%3A00%3A00.000Z',
      queryKeys: ['ending_before', 'limit', 'resource_id', 'resource_type', 'sort', 'starting_on'],
      responsePath: ['next_page'],
      responseValue: 'audit-cursor-test-002',
    },
  ]) {
    const { label, payload } = item;
    assertReadPipelineGoldenShape(label, payload);
    assert(payload.endpoint.id === item.endpointId, `${label} read-pipeline endpoint mismatch`);
    assert(payload.tenant === item.tenant, `${label} read-pipeline tenant mismatch`);
    assert(payload.readMock.readResult.requestSummary.method === item.method, `${label} read-pipeline method mismatch`);
    assert(payload.readMock.readResult.requestSummary.path === item.path, `${label} read-pipeline path mismatch`);
    const bodyKeys = item.bodyKeys || [];
    for (const key of bodyKeys) {
      assertIncludes(payload.readMock.readResult.requestSummary.bodyKeys, key, `${label} read-pipeline missing body ${key}`);
    }
    if (bodyKeys.length === 0) {
      assert(payload.readMock.readResult.requestSummary.bodyKeys.length === 0, `${label} read-pipeline must not use body keys`);
    }
    for (const key of item.pathKeys || []) {
      assertIncludes(payload.readMock.readResult.requestSummary.pathKeys, key, `${label} read-pipeline missing path ${key}`);
    }
    for (const key of item.queryKeys || []) {
      assertIncludes(payload.readMock.readResult.requestSummary.queryKeys, key, `${label} read-pipeline missing query ${key}`);
    }
    const actualResponseValue = item.responsePath.reduce((value, key) => value?.[key], payload.readMock.readResult.responseData);
    assert(actualResponseValue === item.responseValue, `${label} read-pipeline response fixture mismatch`);
    if (item.keyEnv) {
      assert(payload.readAuditWrite.row.keyFingerprint.envVar === item.keyEnv, `${label} read-pipeline key env mismatch`);
    }
  }

  assertReadMockGoldenShape('contracts.list.v2 POST body', contractsList);
  assert(contractsList.endpoint.id === 'contracts.list.v2', 'contracts.list.v2 read-mock golden endpoint mismatch');
  assert(contractsList.tenant === 'sandbox', 'contracts.list.v2 read-mock golden tenant mismatch');
  assert(contractsList.readResult.requestSummary.method === 'POST', 'contracts.list.v2 read-mock request must use POST');
  assert(contractsList.readResult.requestSummary.path === '/v2/contracts/list', 'contracts.list.v2 read-mock path mismatch');
  assertIncludes(contractsList.readResult.requestSummary.bodyKeys, 'customer_id', 'contracts.list.v2 read-mock missing body customer_id');
  assertIncludes(contractsList.readResult.requestSummary.bodyKeys, 'include_archived', 'contracts.list.v2 read-mock missing body include_archived');
  assert(contractsList.readResult.requestSummary.queryKeys.length === 0, 'contracts.list.v2 read-mock must not use query keys');
  assert(contractsList.readResult.requestSummary.pathKeys.length === 0, 'contracts.list.v2 read-mock must not use path keys');
  assert(contractsList.readResult.responseData.next_page === 'cursor-next-test', 'contracts.list.v2 read-mock missing pagination response');

  assertReadMockGoldenShape('contracts.getRateSchedule POST body with query pagination', contractsRateSchedule);
  assert(
    contractsRateSchedule.endpoint.id === 'contracts.getRateSchedule',
    'contracts.getRateSchedule read-mock golden endpoint mismatch',
  );
  assert(contractsRateSchedule.tenant === 'sandbox', 'contracts.getRateSchedule read-mock golden tenant mismatch');
  assert(
    contractsRateSchedule.readResult.requestSummary.method === 'POST',
    'contracts.getRateSchedule read-mock request must use POST',
  );
  assert(
    contractsRateSchedule.readResult.requestSummary.path === '/v1/contracts/getContractRateSchedule?limit=50&next_page=cursor-test',
    'contracts.getRateSchedule read-mock path/query mismatch',
  );
  for (const expectedKey of ['at', 'contract_id', 'customer_id', 'selectors']) {
    assertIncludes(
      contractsRateSchedule.readResult.requestSummary.bodyKeys,
      expectedKey,
      `contracts.getRateSchedule read-mock missing body ${expectedKey}`,
    );
  }
  for (const expectedKey of ['limit', 'next_page']) {
    assertIncludes(
      contractsRateSchedule.readResult.requestSummary.queryKeys,
      expectedKey,
      `contracts.getRateSchedule read-mock missing query ${expectedKey}`,
    );
  }
  assert(
    contractsRateSchedule.readResult.requestSummary.pathKeys.length === 0,
    'contracts.getRateSchedule read-mock must not use path keys',
  );
  assert(
    contractsRateSchedule.readResult.responseData.data[0].override_rate.price === 12500,
    'contracts.getRateSchedule read-mock response must include override rate',
  );
  assert(
    contractsRateSchedule.readResult.responseData.data[0].commit_rate.credit_type.name != null,
    'contracts.getRateSchedule read-mock response must include commit credit type',
  );
  assert(
    contractsRateSchedule.readResult.responseData.next_page === 'cursor-next-test',
    'contracts.getRateSchedule read-mock missing pagination response',
  );

  assertReadMockGoldenShape('customerBalances.list POST body', customerBalances);
  assert(customerBalances.endpoint.id === 'customerBalances.list', 'customerBalances.list read-mock golden endpoint mismatch');
  assert(customerBalances.tenant === 'sandbox', 'customerBalances.list read-mock golden tenant mismatch');
  assert(customerBalances.readResult.requestSummary.method === 'POST', 'customerBalances.list read-mock request must use POST');
  assert(customerBalances.readResult.requestSummary.path === '/v1/contracts/customerBalances/list', 'customerBalances.list read-mock path mismatch');
  assertIncludes(customerBalances.readResult.requestSummary.bodyKeys, 'customer_id', 'customerBalances.list read-mock missing body customer_id');
  assertIncludes(customerBalances.readResult.requestSummary.bodyKeys, 'include_balance', 'customerBalances.list read-mock missing body include_balance');
  assertIncludes(customerBalances.readResult.requestSummary.bodyKeys, 'include_contract_balances', 'customerBalances.list read-mock missing body include_contract_balances');
  assert(customerBalances.readResult.requestSummary.queryKeys.length === 0, 'customerBalances.list read-mock must not use query keys');
  assert(customerBalances.readResult.requestSummary.pathKeys.length === 0, 'customerBalances.list read-mock must not use path keys');
  assert(customerBalances.readResult.responseData.data[0].id === 'commit-test-001', 'customerBalances.list read-mock response must include balance id');

  assertReadMockGoldenShape('seatBalances.list POST body', seatBalances);
  assert(seatBalances.endpoint.id === 'seatBalances.list', 'seatBalances.list read-mock golden endpoint mismatch');
  assert(seatBalances.tenant === 'sandbox', 'seatBalances.list read-mock golden tenant mismatch');
  assert(seatBalances.readResult.requestSummary.method === 'POST', 'seatBalances.list read-mock request must use POST');
  assert(seatBalances.readResult.requestSummary.path === '/v1/contracts/seatBalances/list', 'seatBalances.list read-mock path mismatch');
  for (const expectedKey of [
    'contract_id',
    'covering_date',
    'customer_id',
    'include_credits_and_commits',
    'include_ledgers',
    'limit',
    'seat_ids',
    'subscription_ids',
  ]) {
    assertIncludes(seatBalances.readResult.requestSummary.bodyKeys, expectedKey, `seatBalances.list read-mock missing body ${expectedKey}`);
  }
  assert(seatBalances.readResult.requestSummary.queryKeys.length === 0, 'seatBalances.list read-mock must not use query keys');
  assert(seatBalances.readResult.requestSummary.pathKeys.length === 0, 'seatBalances.list read-mock must not use path keys');
  assert(seatBalances.readResult.responseData.data[0].seat_id === 'user-test-001', 'seatBalances.list read-mock response must include seat id');
  assert(seatBalances.readResult.responseData.pagination.next_page === 'cursor-seat-next-test', 'seatBalances.list read-mock response must include pagination');

  assertReadMockGoldenShape('commits.list POST body', commitsList);
  assert(commitsList.endpoint.id === 'commits.list', 'commits.list read-mock golden endpoint mismatch');
  assert(commitsList.tenant === 'sandbox', 'commits.list read-mock golden tenant mismatch');
  assert(commitsList.readResult.requestSummary.method === 'POST', 'commits.list read-mock request must use POST');
  assert(commitsList.readResult.requestSummary.path === '/v1/contracts/customerCommits/list', 'commits.list read-mock path mismatch');
  assertIncludes(commitsList.readResult.requestSummary.bodyKeys, 'customer_id', 'commits.list read-mock missing body customer_id');
  assertIncludes(commitsList.readResult.requestSummary.bodyKeys, 'include_contract_commits', 'commits.list read-mock missing body include_contract_commits');
  assert(commitsList.readResult.requestSummary.queryKeys.length === 0, 'commits.list read-mock must not use query keys');
  assert(commitsList.readResult.requestSummary.pathKeys.length === 0, 'commits.list read-mock must not use path keys');
  assert(commitsList.readResult.responseData.data[0].id === 'commit-test-001', 'commits.list read-mock response must include commit id');

  assertReadMockGoldenShape('credits.list POST body', creditsList);
  assert(creditsList.endpoint.id === 'credits.list', 'credits.list read-mock golden endpoint mismatch');
  assert(creditsList.tenant === 'sandbox', 'credits.list read-mock golden tenant mismatch');
  assert(creditsList.readResult.requestSummary.method === 'POST', 'credits.list read-mock request must use POST');
  assert(creditsList.readResult.requestSummary.path === '/v1/contracts/customerCredits/list', 'credits.list read-mock path mismatch');
  assertIncludes(creditsList.readResult.requestSummary.bodyKeys, 'customer_id', 'credits.list read-mock missing body customer_id');
  assertIncludes(creditsList.readResult.requestSummary.bodyKeys, 'include_contract_credits', 'credits.list read-mock missing body include_contract_credits');
  assert(creditsList.readResult.requestSummary.queryKeys.length === 0, 'credits.list read-mock must not use query keys');
  assert(creditsList.readResult.requestSummary.pathKeys.length === 0, 'credits.list read-mock must not use path keys');
  assert(creditsList.readResult.responseData.data[0].id === 'credit-test-001', 'credits.list read-mock response must include credit id');

  assertReadMockGoldenShape('invoices.listForCustomer GET path/query', invoices);
  assert(invoices.endpoint.id === 'invoices.listForCustomer', 'invoices.listForCustomer read-mock golden endpoint mismatch');
  assert(invoices.tenant === 'production', 'invoices.listForCustomer read-mock golden tenant mismatch');
  assert(invoices.readResult.requestSummary.method === 'GET', 'invoices.listForCustomer read-mock request must use GET');
  assert(
    invoices.readResult.requestSummary.path === '/v1/customers/customer-test-001/invoices?limit=50&sort=date_desc&status=DRAFT',
    'invoices.listForCustomer read-mock path/query mismatch',
  );
  assert(invoices.readResult.requestSummary.bodyKeys.length === 0, 'invoices.listForCustomer read-mock must not use body keys');
  assertIncludes(invoices.readResult.requestSummary.pathKeys, 'customer_id', 'invoices.listForCustomer read-mock missing path customer_id');
  for (const expectedKey of ['limit', 'sort', 'status']) {
    assertIncludes(invoices.readResult.requestSummary.queryKeys, expectedKey, `invoices.listForCustomer read-mock missing query ${expectedKey}`);
  }
  assert(invoices.readResult.responseData.next_page === 'cursor-next-test', 'invoices.listForCustomer read-mock missing pagination response');

  assertReadMockGoldenShape('billingProvider.getCustomerConfigurations POST body', billingProvider);
  assert(
    billingProvider.endpoint.id === 'billingProvider.getCustomerConfigurations',
    'billingProvider.getCustomerConfigurations read-mock golden endpoint mismatch',
  );
  assert(billingProvider.tenant === 'production', 'billingProvider.getCustomerConfigurations read-mock golden tenant mismatch');
  assert(
    billingProvider.readResult.requestSummary.method === 'POST',
    'billingProvider.getCustomerConfigurations read-mock request must use POST',
  );
  assert(
    billingProvider.readResult.requestSummary.path === '/v1/getCustomerBillingProviderConfigurations',
    'billingProvider.getCustomerConfigurations read-mock path mismatch',
  );
  assertIncludes(
    billingProvider.readResult.requestSummary.bodyKeys,
    'customer_id',
    'billingProvider.getCustomerConfigurations read-mock missing body customer_id',
  );
  assert(
    billingProvider.readResult.requestSummary.queryKeys.length === 0,
    'billingProvider.getCustomerConfigurations read-mock must not use query keys',
  );
  assert(
    billingProvider.readResult.requestSummary.pathKeys.length === 0,
    'billingProvider.getCustomerConfigurations read-mock must not use path keys',
  );
  assert(
    billingProvider.readResult.responseData.data[0].billing_provider === 'stripe',
    'billingProvider.getCustomerConfigurations read-mock response must include Stripe provider data',
  );
  assert(
    billingProvider.readAuditTemplate.row.keyFingerprint.envVar === 'METRONOME_PROD_KEY',
    'billingProvider.getCustomerConfigurations read-mock audit template must bind production key env name',
  );

  assertReadMockGoldenShape('customFields.listKeys POST body with query pagination', customFieldsListKeys);
  assert(customFieldsListKeys.endpoint.id === 'customFields.listKeys', 'customFields.listKeys read-mock golden endpoint mismatch');
  assert(customFieldsListKeys.tenant === 'sandbox', 'customFields.listKeys read-mock golden tenant mismatch');
  assert(customFieldsListKeys.readResult.requestSummary.method === 'POST', 'customFields.listKeys read-mock request must use POST');
  assert(
    customFieldsListKeys.readResult.requestSummary.path === '/v1/customFields/listKeys?next_page=cursor-custom-fields-test',
    'customFields.listKeys read-mock path/query mismatch',
  );
  assertIncludes(customFieldsListKeys.readResult.requestSummary.bodyKeys, 'entities', 'customFields.listKeys read-mock missing body entities');
  assertIncludes(customFieldsListKeys.readResult.requestSummary.queryKeys, 'next_page', 'customFields.listKeys read-mock missing query next_page');
  assert(customFieldsListKeys.readResult.requestSummary.pathKeys.length === 0, 'customFields.listKeys read-mock must not use path keys');
  assert(customFieldsListKeys.readResult.responseData.data[0].key === 'x_account_id', 'customFields.listKeys read-mock missing custom field key');
  assert(customFieldsListKeys.readResult.responseData.next_page === 'cursor-custom-fields-next-test', 'customFields.listKeys read-mock missing pagination response');

  assertReadPipelineGoldenShape('customFields.listKeys POST body with query pagination', customFieldsListKeysPipeline);
  assert(customFieldsListKeysPipeline.endpoint.id === 'customFields.listKeys', 'customFields.listKeys read-pipeline endpoint mismatch');
  assert(customFieldsListKeysPipeline.tenant === 'sandbox', 'customFields.listKeys read-pipeline tenant mismatch');
  assert(customFieldsListKeysPipeline.readMock.readResult.requestSummary.path === '/v1/customFields/listKeys?next_page=cursor-custom-fields-test', 'customFields.listKeys read-pipeline path/query mismatch');
  assert(customFieldsListKeysPipeline.readMock.readResult.responseData.data[1].entity === 'commit', 'customFields.listKeys read-pipeline missing commit key row');

  assertReadMockGoldenShape('settings.listPricingUnits GET query', pricingUnits);
  assert(pricingUnits.endpoint.id === 'settings.listPricingUnits', 'settings.listPricingUnits read-mock golden endpoint mismatch');
  assert(pricingUnits.tenant === 'sandbox', 'settings.listPricingUnits read-mock golden tenant mismatch');
  assert(pricingUnits.readResult.requestSummary.method === 'GET', 'settings.listPricingUnits read-mock request must use GET');
  assert(
    pricingUnits.readResult.requestSummary.path === '/v1/credit-types/list?limit=50&next_page=cursor-test',
    'settings.listPricingUnits read-mock path/query mismatch',
  );
  assert(pricingUnits.readResult.requestSummary.bodyKeys.length === 0, 'settings.listPricingUnits read-mock must not use body keys');
  assert(pricingUnits.readResult.requestSummary.pathKeys.length === 0, 'settings.listPricingUnits read-mock must not use path keys');
  for (const expectedKey of ['limit', 'next_page']) {
    assertIncludes(pricingUnits.readResult.requestSummary.queryKeys, expectedKey, `settings.listPricingUnits read-mock missing query ${expectedKey}`);
  }
  assert(pricingUnits.readResult.responseData.next_page === 'cursor-next-test', 'settings.listPricingUnits read-mock missing pagination response');

  assertReadPipelineGoldenShape('settings.listPricingUnits GET query', pricingUnitsPipeline);
  assert(pricingUnitsPipeline.endpoint.id === 'settings.listPricingUnits', 'settings.listPricingUnits read-pipeline endpoint mismatch');
  assert(pricingUnitsPipeline.tenant === 'sandbox', 'settings.listPricingUnits read-pipeline tenant mismatch');
  assert(pricingUnitsPipeline.readMock.readResult.requestSummary.method === 'GET', 'settings.listPricingUnits read-pipeline request must use GET');
  assert(
    pricingUnitsPipeline.readMock.readResult.requestSummary.path === '/v1/credit-types/list?limit=50&next_page=cursor-test',
    'settings.listPricingUnits read-pipeline path/query mismatch',
  );

  assertReadMockGoldenShape('security.getServices GET no params', securityServices);
  assert(securityServices.endpoint.id === 'security.getServices', 'security.getServices read-mock golden endpoint mismatch');
  assert(securityServices.tenant === 'sandbox', 'security.getServices read-mock golden tenant mismatch');
  assert(securityServices.readResult.requestSummary.method === 'GET', 'security.getServices read-mock request must use GET');
  assert(securityServices.readResult.requestSummary.path === '/v1/services', 'security.getServices read-mock path mismatch');
  assert(securityServices.readResult.requestSummary.bodyKeys.length === 0, 'security.getServices read-mock must not use body keys');
  assert(securityServices.readResult.requestSummary.queryKeys.length === 0, 'security.getServices read-mock must not use query keys');
  assert(securityServices.readResult.requestSummary.pathKeys.length === 0, 'security.getServices read-mock must not use path keys');
  assert(securityServices.readResult.responseData.services[0].usage === 'makes_connections_from', 'security.getServices read-mock missing service usage');

  assertReadPipelineGoldenShape('security.getServices GET no params', securityServicesPipeline);
  assert(securityServicesPipeline.endpoint.id === 'security.getServices', 'security.getServices read-pipeline endpoint mismatch');
  assert(securityServicesPipeline.tenant === 'sandbox', 'security.getServices read-pipeline tenant mismatch');
  assert(securityServicesPipeline.readMock.readResult.requestSummary.method === 'GET', 'security.getServices read-pipeline request must use GET');
  assert(securityServicesPipeline.readMock.readResult.requestSummary.path === '/v1/services', 'security.getServices read-pipeline path mismatch');
  assert(securityServicesPipeline.readMock.readResult.responseData.services[1].usage === 'accepts_connections_at', 'security.getServices read-pipeline missing service registry response');

  assertReadMockGoldenShape('security.getAuditLogs GET query filters', securityAuditLogs);
  assert(securityAuditLogs.endpoint.id === 'security.getAuditLogs', 'security.getAuditLogs read-mock golden endpoint mismatch');
  assert(securityAuditLogs.tenant === 'sandbox', 'security.getAuditLogs read-mock golden tenant mismatch');
  assert(securityAuditLogs.readResult.requestSummary.method === 'GET', 'security.getAuditLogs read-mock request must use GET');
  assert(
    securityAuditLogs.readResult.requestSummary.path === '/v1/auditLogs?ending_before=2026-06-02T00%3A00%3A00.000Z&limit=50&resource_id=customer-test-001&resource_type=customer&sort=date_asc&starting_on=2026-06-01T00%3A00%3A00.000Z',
    'security.getAuditLogs read-mock path/query mismatch',
  );
  assert(securityAuditLogs.readResult.requestSummary.bodyKeys.length === 0, 'security.getAuditLogs read-mock must not use body keys');
  assert(securityAuditLogs.readResult.requestSummary.pathKeys.length === 0, 'security.getAuditLogs read-mock must not use path keys');
  for (const expectedKey of ['ending_before', 'limit', 'resource_id', 'resource_type', 'sort', 'starting_on']) {
    assertIncludes(securityAuditLogs.readResult.requestSummary.queryKeys, expectedKey, `security.getAuditLogs read-mock missing query ${expectedKey}`);
  }
  assert(securityAuditLogs.readResult.responseData.data[0].status === 'success', 'security.getAuditLogs read-mock missing audit log status');
  assert(securityAuditLogs.readResult.responseData.next_page === 'audit-cursor-test-002', 'security.getAuditLogs read-mock missing next_page');

  assertReadPipelineGoldenShape('security.getAuditLogs GET query filters', securityAuditLogsPipeline);
  assert(securityAuditLogsPipeline.endpoint.id === 'security.getAuditLogs', 'security.getAuditLogs read-pipeline endpoint mismatch');
  assert(securityAuditLogsPipeline.tenant === 'sandbox', 'security.getAuditLogs read-pipeline tenant mismatch');
  assert(securityAuditLogsPipeline.readMock.readResult.requestSummary.method === 'GET', 'security.getAuditLogs read-pipeline request must use GET');
  assert(
    securityAuditLogsPipeline.readMock.readResult.requestSummary.path === '/v1/auditLogs?ending_before=2026-06-02T00%3A00%3A00.000Z&limit=50&resource_id=customer-test-001&resource_type=customer&sort=date_asc&starting_on=2026-06-01T00%3A00%3A00.000Z',
    'security.getAuditLogs read-pipeline path/query mismatch',
  );
  assert(securityAuditLogsPipeline.readMock.readResult.responseData.data[1].status === 'pending', 'security.getAuditLogs read-pipeline missing audit log response');

  assertReadMockGoldenShape('packages.list paginated POST query', packages);
  assert(packages.endpoint.id === 'packages.list', 'packages.list read-mock golden endpoint mismatch');
  assert(packages.tenant === 'sandbox', 'packages.list read-mock golden tenant mismatch');
  assert(packages.readResult.requestSummary.method === 'POST', 'packages.list read-mock request must use POST');
  assert(packages.readResult.requestSummary.path === '/v1/packages/list?limit=50&next_page=cursor-test', 'packages.list read-mock path/query mismatch');
  assert(packages.readResult.requestSummary.bodyKeys.length === 0, 'packages.list read-mock must keep pagination out of body');
  assert(packages.readResult.requestSummary.pathKeys.length === 0, 'packages.list read-mock must not use path keys');
  for (const expectedKey of ['limit', 'next_page']) {
    assertIncludes(packages.readResult.requestSummary.queryKeys, expectedKey, `packages.list read-mock missing query ${expectedKey}`);
  }
  assert(packages.readResult.responseData.next_page === 'cursor-next-test', 'packages.list read-mock missing pagination response');

  assertReadMockGoldenShape('products.list POST body with query pagination', productsList);
  assert(productsList.endpoint.id === 'products.list', 'products.list read-mock golden endpoint mismatch');
  assert(productsList.tenant === 'sandbox', 'products.list read-mock golden tenant mismatch');
  assert(productsList.readResult.requestSummary.method === 'POST', 'products.list read-mock request must use POST');
  assert(
    productsList.readResult.requestSummary.path === '/v1/contract-pricing/products/list?limit=50&next_page=cursor-test',
    'products.list read-mock path/query mismatch',
  );
  assertIncludes(productsList.readResult.requestSummary.bodyKeys, 'archive_filter', 'products.list read-mock missing body archive_filter');
  assert(productsList.readResult.requestSummary.pathKeys.length === 0, 'products.list read-mock must not use path keys');
  for (const expectedKey of ['limit', 'next_page']) {
    assertIncludes(productsList.readResult.requestSummary.queryKeys, expectedKey, `products.list read-mock missing query ${expectedKey}`);
  }
  assert(productsList.readResult.responseData.data[0].id === 'product-test-001', 'products.list read-mock response must include product id');

  assertReadMockGoldenShape('rateCards.get POST body', rateCardsGet);
  assert(rateCardsGet.endpoint.id === 'rateCards.get', 'rateCards.get read-mock golden endpoint mismatch');
  assert(rateCardsGet.tenant === 'sandbox', 'rateCards.get read-mock golden tenant mismatch');
  assert(rateCardsGet.readResult.requestSummary.method === 'POST', 'rateCards.get read-mock request must use POST');
  assert(rateCardsGet.readResult.requestSummary.path === '/v1/contract-pricing/rate-cards/get', 'rateCards.get read-mock path mismatch');
  assertIncludes(rateCardsGet.readResult.requestSummary.bodyKeys, 'id', 'rateCards.get read-mock missing body id');
  assert(rateCardsGet.readResult.requestSummary.queryKeys.length === 0, 'rateCards.get read-mock must not use query keys');
  assert(rateCardsGet.readResult.requestSummary.pathKeys.length === 0, 'rateCards.get read-mock must not use path keys');
  assert(rateCardsGet.readResult.responseData.data.id === 'rate-card-test-001', 'rateCards.get read-mock response must include rate card id');

  assertReadMockGoldenShape('rateCards.list POST query', rateCardsList);
  assert(rateCardsList.endpoint.id === 'rateCards.list', 'rateCards.list read-mock golden endpoint mismatch');
  assert(rateCardsList.tenant === 'sandbox', 'rateCards.list read-mock golden tenant mismatch');
  assert(rateCardsList.readResult.requestSummary.method === 'POST', 'rateCards.list read-mock request must use POST');
  assert(
    rateCardsList.readResult.requestSummary.path === '/v1/contract-pricing/rate-cards/list?limit=50&next_page=cursor-test',
    'rateCards.list read-mock path/query mismatch',
  );
  assert(rateCardsList.readResult.requestSummary.bodyKeys.length === 0, 'rateCards.list read-mock must not use body keys');
  assert(rateCardsList.readResult.requestSummary.pathKeys.length === 0, 'rateCards.list read-mock must not use path keys');
  for (const expectedKey of ['limit', 'next_page']) {
    assertIncludes(rateCardsList.readResult.requestSummary.queryKeys, expectedKey, `rateCards.list read-mock missing query ${expectedKey}`);
  }
  assert(rateCardsList.readResult.responseData.data[0].id === 'rate-card-test-001', 'rateCards.list read-mock response must include rate card id');

  assertReadMockGoldenShape('rateCards.getRates POST body with query pagination', rateCardsGetRates);
  assert(rateCardsGetRates.endpoint.id === 'rateCards.getRates', 'rateCards.getRates read-mock golden endpoint mismatch');
  assert(rateCardsGetRates.tenant === 'sandbox', 'rateCards.getRates read-mock golden tenant mismatch');
  assert(rateCardsGetRates.readResult.requestSummary.method === 'POST', 'rateCards.getRates read-mock request must use POST');
  assert(
    rateCardsGetRates.readResult.requestSummary.path === '/v1/contract-pricing/rate-cards/getRates?limit=50&next_page=cursor-test',
    'rateCards.getRates read-mock path/query mismatch',
  );
  for (const expectedKey of ['at', 'rate_card_id', 'selectors']) {
    assertIncludes(rateCardsGetRates.readResult.requestSummary.bodyKeys, expectedKey, `rateCards.getRates read-mock missing body ${expectedKey}`);
  }
  assert(rateCardsGetRates.readResult.requestSummary.pathKeys.length === 0, 'rateCards.getRates read-mock must not use path keys');
  for (const expectedKey of ['limit', 'next_page']) {
    assertIncludes(rateCardsGetRates.readResult.requestSummary.queryKeys, expectedKey, `rateCards.getRates read-mock missing query ${expectedKey}`);
  }
  assert(rateCardsGetRates.readResult.responseData.data[0].product_id === 'product-test-001', 'rateCards.getRates read-mock response must include product id');
  assert(rateCardsGetRates.readResult.responseData.next_page === 'cursor-next-test', 'rateCards.getRates read-mock missing pagination response');

  assertReadMockGoldenShape('usage.groups POST body with query pagination', usageGroups);
  assert(usageGroups.endpoint.id === 'usage.groups', 'usage.groups read-mock golden endpoint mismatch');
  assert(usageGroups.tenant === 'sandbox', 'usage.groups read-mock golden tenant mismatch');
  assert(usageGroups.readResult.requestSummary.method === 'POST', 'usage.groups read-mock request must use POST');
  assert(usageGroups.readResult.requestSummary.envelopeMode === 'explicit', 'usage.groups read-mock must use explicit envelope mode');
  assert(
    usageGroups.readResult.requestSummary.path === '/v1/usage/groups?limit=100',
    'usage.groups read-mock path/query mismatch',
  );
  for (const expectedKey of ['billable_metric_id', 'customer_id', 'ending_before', 'group_key', 'starting_on', 'window_size']) {
    assertIncludes(usageGroups.readResult.requestSummary.bodyKeys, expectedKey, `usage.groups read-mock missing body ${expectedKey}`);
  }
  assert(usageGroups.readResult.requestSummary.pathKeys.length === 0, 'usage.groups read-mock must not use path keys');
  for (const expectedKey of ['limit']) {
    assertIncludes(usageGroups.readResult.requestSummary.queryKeys, expectedKey, `usage.groups read-mock missing query ${expectedKey}`);
  }
  assert(usageGroups.readResult.responseData.next_page === 'cursor-next-test', 'usage.groups read-mock missing pagination response');

  assertReadMockGoldenShape('usage.batch POST body with query pagination', usageBatch);
  assert(usageBatch.endpoint.id === 'usage.batch', 'usage.batch read-mock golden endpoint mismatch');
  assert(usageBatch.tenant === 'sandbox', 'usage.batch read-mock golden tenant mismatch');
  assert(usageBatch.readResult.requestSummary.method === 'POST', 'usage.batch read-mock request must use POST');
  assert(usageBatch.readResult.requestSummary.envelopeMode === 'explicit', 'usage.batch read-mock must use explicit envelope mode');
  assert(
    usageBatch.readResult.requestSummary.path === '/v1/usage?next_page=cursor-test',
    'usage.batch read-mock path/query mismatch',
  );
  for (const expectedKey of ['billable_metrics', 'customer_ids', 'ending_before', 'starting_on', 'window_size']) {
    assertIncludes(usageBatch.readResult.requestSummary.bodyKeys, expectedKey, `usage.batch read-mock missing body ${expectedKey}`);
  }
  assert(usageBatch.readResult.requestSummary.pathKeys.length === 0, 'usage.batch read-mock must not use path keys');
  assertIncludes(usageBatch.readResult.requestSummary.queryKeys, 'next_page', 'usage.batch read-mock missing query next_page');
  assert(usageBatch.readResult.responseData.next_page === 'cursor-next-test', 'usage.batch read-mock missing pagination response');

  assertReadMockGoldenShape('events.search POST body', eventsSearch);
  assert(eventsSearch.endpoint.id === 'events.search', 'events.search read-mock golden endpoint mismatch');
  assert(eventsSearch.tenant === 'sandbox', 'events.search read-mock golden tenant mismatch');
  assert(eventsSearch.readResult.requestSummary.method === 'POST', 'events.search read-mock request must use POST');
  assert(eventsSearch.readResult.requestSummary.path === '/v1/events/search', 'events.search read-mock path mismatch');
  assert(eventsSearch.readResult.requestSummary.envelopeMode === 'explicit', 'events.search read-mock must use explicit envelope mode');
  assertIncludes(eventsSearch.readResult.requestSummary.bodyKeys, 'transactionIds', 'events.search read-mock missing body transactionIds');
  assert(eventsSearch.readResult.requestSummary.queryKeys.length === 0, 'events.search read-mock must not use query keys');
  assert(eventsSearch.readResult.requestSummary.pathKeys.length === 0, 'events.search read-mock must not use path keys');
  assert(
    eventsSearch.readResult.responseData.data[0].transaction_id === 'txn-test-001',
    'events.search read-mock response must include searched transaction id',
  );

  assertReadMockGoldenShape('billableMetrics.get GET path', billableMetricsGet);
  assert(billableMetricsGet.endpoint.id === 'billableMetrics.get', 'billableMetrics.get read-mock golden endpoint mismatch');
  assert(billableMetricsGet.tenant === 'sandbox', 'billableMetrics.get read-mock golden tenant mismatch');
  assert(billableMetricsGet.readResult.requestSummary.method === 'GET', 'billableMetrics.get read-mock request must use GET');
  assert(
    billableMetricsGet.readResult.requestSummary.path === '/v1/billable-metrics/00000000-0000-4000-8000-000000000001',
    'billableMetrics.get read-mock path mismatch',
  );
  assert(billableMetricsGet.readResult.requestSummary.bodyKeys.length === 0, 'billableMetrics.get read-mock must not use body keys');
  assertIncludes(billableMetricsGet.readResult.requestSummary.pathKeys, 'billable_metric_id', 'billableMetrics.get read-mock missing path billable_metric_id');
  assert(billableMetricsGet.readResult.requestSummary.queryKeys.length === 0, 'billableMetrics.get read-mock must not use query keys');
  assert(
    billableMetricsGet.readResult.responseData.data.id === '00000000-0000-4000-8000-000000000001',
    'billableMetrics.get read-mock response must include billable metric id',
  );

  assertReadMockGoldenShape('billableMetrics.list GET query', billableMetricsList);
  assert(billableMetricsList.endpoint.id === 'billableMetrics.list', 'billableMetrics.list read-mock golden endpoint mismatch');
  assert(billableMetricsList.tenant === 'sandbox', 'billableMetrics.list read-mock golden tenant mismatch');
  assert(billableMetricsList.readResult.requestSummary.method === 'GET', 'billableMetrics.list read-mock request must use GET');
  assert(
    billableMetricsList.readResult.requestSummary.path === '/v1/billable-metrics?include_archived=false&limit=50&next_page=cursor-test',
    'billableMetrics.list read-mock path/query mismatch',
  );
  assert(billableMetricsList.readResult.requestSummary.bodyKeys.length === 0, 'billableMetrics.list read-mock must not use body keys');
  assert(billableMetricsList.readResult.requestSummary.pathKeys.length === 0, 'billableMetrics.list read-mock must not use path keys');
  for (const expectedKey of ['include_archived', 'limit', 'next_page']) {
    assertIncludes(billableMetricsList.readResult.requestSummary.queryKeys, expectedKey, `billableMetrics.list read-mock missing query ${expectedKey}`);
  }
  assert(billableMetricsList.readResult.responseData.next_page === 'cursor-next-test', 'billableMetrics.list read-mock missing pagination response');

  assertReadMockGoldenShape('customers.get GET path', customersGet);
  assert(customersGet.endpoint.id === 'customers.get', 'customers.get read-mock golden endpoint mismatch');
  assert(customersGet.tenant === 'sandbox', 'customers.get read-mock golden tenant mismatch');
  assert(customersGet.readResult.requestSummary.method === 'GET', 'customers.get read-mock request must use GET');
  assert(customersGet.readResult.requestSummary.path === '/v1/customers/customer-test-001', 'customers.get read-mock path mismatch');
  assert(customersGet.readResult.requestSummary.envelopeMode === 'explicit', 'customers.get read-mock must use explicit envelope mode');
  assert(customersGet.readResult.requestSummary.bodyKeys.length === 0, 'customers.get read-mock must not use body keys');
  assertIncludes(customersGet.readResult.requestSummary.pathKeys, 'customer_id', 'customers.get read-mock missing path customer_id');
  assert(customersGet.readResult.requestSummary.queryKeys.length === 0, 'customers.get read-mock must not use query keys');
  assert(customersGet.readResult.responseData.id === 'customer-test-001', 'customers.get read-mock response must include customer id');

  assertReadMockGoldenShape('customers.list GET query', customersList);
  assert(customersList.endpoint.id === 'customers.list', 'customers.list read-mock golden endpoint mismatch');
  assert(customersList.tenant === 'sandbox', 'customers.list read-mock golden tenant mismatch');
  assert(customersList.readResult.requestSummary.method === 'GET', 'customers.list read-mock request must use GET');
  assert(
    customersList.readResult.requestSummary.path === '/v1/customers?customer_ids=customer-test-001&customer_ids=customer-test-002&limit=50&only_archived=false',
    'customers.list read-mock path/query mismatch',
  );
  assert(customersList.readResult.requestSummary.envelopeMode === 'explicit', 'customers.list read-mock must use explicit envelope mode');
  assert(customersList.readResult.requestSummary.bodyKeys.length === 0, 'customers.list read-mock must not use body keys');
  assert(customersList.readResult.requestSummary.pathKeys.length === 0, 'customers.list read-mock must not use path keys');
  for (const expectedKey of ['customer_ids', 'limit', 'only_archived']) {
    assertIncludes(customersList.readResult.requestSummary.queryKeys, expectedKey, `customers.list read-mock missing query ${expectedKey}`);
  }
  assert(customersList.readResult.responseData.next_page === 'cursor-next-test', 'customers.list read-mock missing pagination response');
}

function assertReadAuditGoldenCoverage() {
  const apiGoldenDir = path.join(packageRoot, 'test', 'golden', 'api');
  const contractsGet = readJson(path.join(apiGoldenDir, 'read-audit.contracts-get-v2.validation.sandbox.json'));
  const contractsList = readJson(path.join(apiGoldenDir, 'read-audit.contracts-list-v2.validation.sandbox.json'));
  const contractsRateSchedule = readJson(path.join(apiGoldenDir, 'read-audit.contracts-rate-schedule.validation.sandbox.json'));
  const customersGet = readJson(path.join(apiGoldenDir, 'read-audit.customers-get.validation.sandbox.json'));
  const customersList = readJson(path.join(apiGoldenDir, 'read-audit.customers-list.validation.sandbox.json'));
  const customerBalances = readJson(path.join(apiGoldenDir, 'read-audit.customer-balances-list.validation.sandbox.json'));
  const seatBalances = readJson(path.join(apiGoldenDir, 'read-audit.seat-balances-list.validation.sandbox.json'));
  const billingProvider = readJson(path.join(apiGoldenDir, 'read-audit.billing-provider-get.validation.production.json'));
  const invoicesGet = readJson(path.join(apiGoldenDir, 'read-audit.invoices-get.validation.production.json'));
  const invoicesListForCustomer = readJson(path.join(apiGoldenDir, 'read-audit.invoices-list-for-customer.validation.production.json'));
  const commitsList = readJson(path.join(apiGoldenDir, 'read-audit.commits-list.validation.sandbox.json'));
  const creditsList = readJson(path.join(apiGoldenDir, 'read-audit.credits-list.validation.sandbox.json'));
  const eventsSearch = readJson(path.join(apiGoldenDir, 'read-audit.events-search.validation.sandbox.json'));
  const usageGroups = readJson(path.join(apiGoldenDir, 'read-audit.usage-groups.validation.sandbox.json'));
  const usageBatch = readJson(path.join(apiGoldenDir, 'read-audit.usage-batch.validation.sandbox.json'));
  const billableMetricsGet = readJson(path.join(apiGoldenDir, 'read-audit.billable-metrics-get.validation.sandbox.json'));
  const billableMetricsList = readJson(path.join(apiGoldenDir, 'read-audit.billable-metrics-list.validation.sandbox.json'));
  const pricingUnits = readJson(path.join(apiGoldenDir, 'read-audit.settings-pricing-units-list.validation.sandbox.json'));
  const securityServices = readJson(path.join(apiGoldenDir, 'read-audit.security-services-get.validation.sandbox.json'));
  const securityAuditLogs = readJson(path.join(apiGoldenDir, 'read-audit.security-audit-logs.validation.sandbox.json'));
  const customFieldsListKeys = readJson(path.join(apiGoldenDir, 'read-audit.custom-fields-list-keys.validation.sandbox.json'));
  const productsGet = readJson(path.join(apiGoldenDir, 'read-audit.products-get.validation.sandbox.json'));
  const productsList = readJson(path.join(apiGoldenDir, 'read-audit.products-list.validation.sandbox.json'));
  const packagesGet = readJson(path.join(apiGoldenDir, 'read-audit.packages-get.validation.sandbox.json'));
  const packagesList = readJson(path.join(apiGoldenDir, 'read-audit.packages-list.validation.sandbox.json'));
  const rateCardsGet = readJson(path.join(apiGoldenDir, 'read-audit.rate-cards-get.validation.sandbox.json'));
  const rateCardsList = readJson(path.join(apiGoldenDir, 'read-audit.rate-cards-list.validation.sandbox.json'));
  const rateCardsGetRates = readJson(path.join(apiGoldenDir, 'read-audit.rate-cards-get-rates.validation.sandbox.json'));
  const rateCardSchedule = readJson(path.join(apiGoldenDir, 'read-audit.rate-card-schedule.validation.sandbox.json'));

  for (const item of [
    { label: 'contracts.get.v2', payload: contractsGet, tenant: 'sandbox' },
    { label: 'contracts.list.v2', payload: contractsList, tenant: 'sandbox' },
    { label: 'contracts.getRateSchedule', payload: contractsRateSchedule, tenant: 'sandbox' },
    { label: 'products.get', payload: productsGet, tenant: 'sandbox' },
    { label: 'products.list', payload: productsList, tenant: 'sandbox' },
    { label: 'packages.get', payload: packagesGet, tenant: 'sandbox' },
    { label: 'packages.list', payload: packagesList, tenant: 'sandbox' },
    { label: 'rateCards.get', payload: rateCardsGet, tenant: 'sandbox' },
    { label: 'rateCards.list', payload: rateCardsList, tenant: 'sandbox' },
    { label: 'rateCards.getRates', payload: rateCardsGetRates, tenant: 'sandbox' },
    { label: 'rateCards.getRateSchedule', payload: rateCardSchedule, tenant: 'sandbox' },
    { label: 'customers.get', payload: customersGet, tenant: 'sandbox' },
    { label: 'customers.list', payload: customersList, tenant: 'sandbox' },
    { label: 'customerBalances.list', payload: customerBalances, tenant: 'sandbox' },
    { label: 'seatBalances.list', payload: seatBalances, tenant: 'sandbox' },
    { label: 'billingProvider.getCustomerConfigurations', payload: billingProvider, tenant: 'production' },
    { label: 'invoices.get', payload: invoicesGet, tenant: 'production' },
    { label: 'invoices.listForCustomer', payload: invoicesListForCustomer, tenant: 'production' },
    { label: 'commits.list', payload: commitsList, tenant: 'sandbox' },
    { label: 'credits.list', payload: creditsList, tenant: 'sandbox' },
    { label: 'events.search', payload: eventsSearch, tenant: 'sandbox' },
    { label: 'usage.groups', payload: usageGroups, tenant: 'sandbox' },
    { label: 'usage.batch', payload: usageBatch, tenant: 'sandbox' },
    { label: 'billableMetrics.get', payload: billableMetricsGet, tenant: 'sandbox' },
    { label: 'billableMetrics.list', payload: billableMetricsList, tenant: 'sandbox' },
    { label: 'settings.listPricingUnits', payload: pricingUnits, tenant: 'sandbox' },
    { label: 'customFields.listKeys', payload: customFieldsListKeys, tenant: 'sandbox' },
    { label: 'security.getServices', payload: securityServices, tenant: 'sandbox' },
    { label: 'security.getAuditLogs', payload: securityAuditLogs, tenant: 'sandbox' },
  ]) {
    const { label, payload } = item;
    assert(payload.schemaVersion === 'metro.api.read-audit.validation.v1', `${label} read-audit validation schema mismatch`);
    assert(payload.apiAccess === 'none', `${label} read-audit validation must be local-only`);
    assert(payload.liveExecution && payload.liveExecution.enabledInCurrentCli === false, `${label} read-audit validation must keep live execution disabled`);
    assert(payload.readEnabledInCurrentCli === false, `${label} read-audit validation must keep reads disabled`);
    assert(payload.valid === true, `${label} read-audit validation must pass`);
    assert(payload.rowCount === 1, `${label} read-audit validation must cover one JSONL row`);
    assert(payload.summary.endpointIds.length === 1 && payload.summary.endpointIds[0] === label, `${label} read-audit validation endpoint mismatch`);
    assert(payload.summary.tenants.length === 1 && payload.summary.tenants[0] === item.tenant, `${label} read-audit validation tenant mismatch`);
    assert(payload.summary.successRows === 1, `${label} read-audit validation missing success row`);
    assert(payload.summary.mockedRows === 1, `${label} read-audit validation missing mocked row`);
    assert(payload.findings.length === 0, `${label} read-audit validation must not have findings`);
  }
}

function assertReadinessGoldenCoverage() {
  const currentApiReference = apiReference();
  const readiness = readJson(path.join(packageRoot, 'test', 'golden', 'api', 'readiness.json'));
  assert(readiness.schemaVersion === 'metro.api.readiness.v1', 'api readiness golden schema mismatch');
  assert(readiness.apiAccess === 'none', 'api readiness golden must be local-only');
  assert(readiness.liveExecution.enabledInCurrentCli === false, 'api readiness golden must keep live execution disabled');
  assert(readiness.catalogEndpointCount === currentApiReference.endpointCount, 'api readiness golden catalog endpoint count mismatch');
  assert(readiness.readEndpointCount === currentApiReference.readReadiness.readEndpointCount, 'api readiness golden read endpoint count mismatch');
  assert(readiness.writeEndpointCount === currentApiReference.readReadiness.writeEndpointCount, 'api readiness golden write endpoint count mismatch');
  assert(readiness.summary.endpointSpecificValidators === readiness.readEndpointCount, 'api readiness golden validator coverage mismatch');
  assert(readiness.summary.localReadPlans === readiness.readEndpointCount, 'api readiness golden read-plan coverage mismatch');
  assert(readiness.summary.goldenCoveredEndpoints === readiness.readEndpointCount, 'api readiness golden read-plan golden coverage mismatch');
  assert(readiness.summary.readMockCoveredEndpoints === readiness.readEndpointCount, 'api readiness golden read-mock coverage mismatch');
  assert(readiness.summary.readPipelineGoldenCoveredEndpoints === readiness.readEndpointCount, 'api readiness golden read-pipeline coverage mismatch');
  assert(readiness.summary.persistedReadAuditCoveredEndpoints === readiness.readEndpointCount, 'api readiness golden persisted read-audit coverage mismatch');
  assert(readiness.summary.missingReadMockEndpoints === 0, 'api readiness golden must have no missing read-mock endpoints');
  assert(readiness.summary.missingReadPipelineGoldenEndpoints === 0, 'api readiness golden must have no missing read-pipeline endpoints');
  assert(readiness.summary.missingPersistedReadAuditEndpoints === 0, 'api readiness golden must have no missing persisted read-audit endpoints');
  assert(readiness.readinessStatuses['full-local-read-evidence'] === readiness.readEndpointCount, 'api readiness golden status mismatch');
  assert(readiness.writeSummary.endpointSpecificValidators === readiness.writeEndpointCount, 'api readiness golden write validator coverage mismatch');
  assert(readiness.writeSummary.localPreviews === readiness.writeEndpointCount, 'api readiness golden write preview coverage mismatch');
  assert(readiness.writeSummary.apiPreflights === readiness.writeEndpointCount, 'api readiness golden write preflight coverage mismatch');
  assert(readiness.writeSummary.apiSandboxProofs === readiness.writeEndpointCount, 'api readiness golden write sandbox-proof coverage mismatch');
  assert(readiness.writeSummary.apiApplyGates === readiness.writeEndpointCount, 'api readiness golden write apply-gate coverage mismatch');
  assert(readiness.writeSummary.apiApprovalRecords === readiness.writeEndpointCount, 'api readiness golden write approval-record coverage mismatch');
  assert(readiness.writeSummary.apiApplyAudits === readiness.writeEndpointCount, 'api readiness golden write apply-audit coverage mismatch');
  assert(readiness.writeSummary.apiApplyReadbacks === readiness.writeEndpointCount, 'api readiness golden write apply-readback coverage mismatch');
  assert(readiness.writeSummary.apiApplyResults === readiness.writeEndpointCount, 'api readiness golden write apply-result coverage mismatch');
  assert(readiness.writeSummary.missingLocalPreviews === 0, 'api readiness golden must have no missing write previews');
  assert(readiness.writeSummary.missingApiPreflights === 0, 'api readiness golden must have no missing write preflights');
  assert(readiness.writeSummary.missingApiSandboxProofs === 0, 'api readiness golden must have no missing write sandbox proofs');
  assert(readiness.writeSummary.missingApiApplyGates === 0, 'api readiness golden must have no missing write apply gates');
  assert(readiness.writeSummary.missingApiApprovalRecords === 0, 'api readiness golden must have no missing write approval records');
  assert(readiness.writeSummary.missingApiApplyAudits === 0, 'api readiness golden must have no missing write apply audits');
  assert(readiness.writeSummary.missingApiApplyReadbacks === 0, 'api readiness golden must have no missing write apply readbacks');
  assert(readiness.writeSummary.missingApiApplyResults === 0, 'api readiness golden must have no missing write apply results');
  assert(readiness.writeSummary.liveWriteEnabledInCurrentCli === true, 'api readiness golden must report allowlisted live writes enabled');
  assert(readiness.writeSummary.applyEnabledInCurrentCli === true, 'api readiness golden must report allowlisted apply enabled');
  assert(readiness.writeReadinessStatuses['local-write-proof-ladder-mapped'] === readiness.writeEndpointCount, 'api readiness golden write status mismatch');
  assert(Array.isArray(readiness.writeProofLadder), 'api readiness golden missing write proof ladder');
  assert(readiness.writeProofLadder.length === 9, 'api readiness golden write proof ladder length mismatch');
  assert(
    readiness.writeProofLadder.map((step) => step.id).join('>') === [
      'request-validation',
      'local-api-preview',
      'api-preflight',
      'api-sandbox-proof',
      'api-apply-gate',
      'api-approval-record',
      'api-apply-audit',
      'api-apply-readback',
      'api-apply-result',
    ].join('>'),
    'api readiness golden write proof ladder order mismatch',
  );
  assert(readiness.writeProofLadder.every((step) => step.apiAccess === 'none'), 'api readiness golden ladder must be local-only');
  assert(readiness.writeProofLadder.every((step) => step.liveExecutionEnabledInCurrentCli === false), 'api readiness golden ladder must keep live execution disabled');
  assert(readiness.writeProofLadder.every((step) => step.applyEnabledInCurrentCli === false), 'api readiness golden ladder must keep apply disabled');
  assert(readiness.writeProofLadder[8].unlocks === 'future-guarded-apply-runner-only', 'api readiness golden ladder must end before future guarded runner');
  assertIncludes(readiness.generatedFrom, 'metronome-cli/src/api-catalog/preview.js', 'api readiness golden missing preview source');
  assertIncludes(readiness.generatedFrom, 'metronome-cli/src/api-catalog/preflight.js', 'api readiness golden missing preflight source');
  assertIncludes(readiness.generatedFrom, 'metronome-cli/src/api-catalog/apply-gate.js', 'api readiness golden missing apply-gate source');
  assertIncludes(readiness.generatedFrom, 'metronome-cli/src/api-catalog/approval-record.js', 'api readiness golden missing approval-record source');
  assertIncludes(readiness.generatedFrom, 'metronome-cli/src/api-catalog/apply-audit.js', 'api readiness golden missing apply-audit source');
  assertIncludes(readiness.generatedFrom, 'metronome-cli/src/api-catalog/apply-readback.js', 'api readiness golden missing apply-readback source');
  assertIncludes(readiness.generatedFrom, 'metronome-cli/src/api-catalog/apply-result.js', 'api readiness golden missing apply-result source');
  assertIncludes(readiness.generatedFrom, 'metronome-cli/src/api-catalog/read-mock.js', 'api readiness golden missing read-mock source');
  assertIncludes(readiness.generatedFrom, 'metronome-cli/src/api-catalog/read-pipeline.js', 'api readiness golden missing read-pipeline source');
  assertIncludes(readiness.generatedFrom, 'metronome-cli/src/api-catalog/read-audit.js', 'api readiness golden missing read-audit source');
  assertIncludes(readiness.persistedReadAuditCoverageTypes, 'persisted-jsonl-validation', 'api readiness golden missing persisted read-audit coverage type');

  for (const family of readiness.coverageByFamily) {
    assert(family.readEndpoints === family.endpointSpecificValidators, `${family.family} readiness validator family coverage mismatch`);
    assert(family.readEndpoints === family.readPlans, `${family.family} readiness read-plan family coverage mismatch`);
    assert(family.readEndpoints === family.readMocks, `${family.family} readiness read-mock family coverage mismatch`);
    assert(family.readEndpoints === family.readPipelines, `${family.family} readiness read-pipeline family coverage mismatch`);
    assert(family.readEndpoints === family.persistedReadAudits, `${family.family} readiness persisted audit family coverage mismatch`);
    assert(family.missingPersistedReadAuditEndpoints.length === 0, `${family.family} readiness must not miss persisted audit endpoints`);
  }

  for (const family of readiness.writeCoverageByFamily) {
    assert(family.writeEndpoints === family.endpointSpecificValidators, `${family.family} write readiness validator family coverage mismatch`);
    assert(family.writeEndpoints === family.localPreviews, `${family.family} write readiness preview family coverage mismatch`);
    assert(family.writeEndpoints === family.apiPreflights, `${family.family} write readiness preflight family coverage mismatch`);
    assert(family.writeEndpoints === family.apiSandboxProofs, `${family.family} write readiness sandbox-proof family coverage mismatch`);
    assert(family.writeEndpoints === family.apiApplyGates, `${family.family} write readiness apply-gate family coverage mismatch`);
    assert(family.writeEndpoints === family.apiApprovalRecords, `${family.family} write readiness approval-record family coverage mismatch`);
    assert(family.writeEndpoints === family.apiApplyAudits, `${family.family} write readiness apply-audit family coverage mismatch`);
    assert(family.writeEndpoints === family.apiApplyReadbacks, `${family.family} write readiness apply-readback family coverage mismatch`);
    assert(family.writeEndpoints === family.apiApplyResults, `${family.family} write readiness apply-result family coverage mismatch`);
    assert(family.missingSandboxProofEndpoints.length === 0, `${family.family} write readiness must not miss sandbox-proof endpoints`);
    assert(family.missingApplyGateEndpoints.length === 0, `${family.family} write readiness must not miss apply-gate endpoints`);
    assert(family.missingApprovalRecordEndpoints.length === 0, `${family.family} write readiness must not miss approval-record endpoints`);
    assert(family.missingApplyAuditEndpoints.length === 0, `${family.family} write readiness must not miss apply-audit endpoints`);
    assert(family.missingApplyReadbackEndpoints.length === 0, `${family.family} write readiness must not miss apply-readback endpoints`);
    assert(family.missingApplyResultEndpoints.length === 0, `${family.family} write readiness must not miss apply-result endpoints`);
  }

  const rateCards = readiness.coverageByFamily.find((family) => family.family === 'rate-cards');
  assert(rateCards && rateCards.readEndpoints === 4, 'api readiness golden must summarize four rate-card read endpoints');
  assert(rateCards.persistedReadAudits === 4, 'api readiness golden must summarize four rate-card persisted read audits');
  const billingProvider = readiness.coverageByFamily.find((family) => family.family === 'billing-provider');
  assert(billingProvider && billingProvider.readEndpoints === 2, 'api readiness golden must summarize two billing-provider read endpoints');
  assert(billingProvider.persistedReadAudits === 2, 'api readiness golden must summarize two billing-provider persisted read audits');
  const credits = readiness.coverageByFamily.find((family) => family.family === 'credits');
  assert(credits && credits.readEndpoints === 4, 'api readiness golden must summarize four credit read endpoints');
  assert(credits.persistedReadAudits === 4, 'api readiness golden must summarize four credit persisted read audits');
  const seatBalances = readiness.endpoints.find((endpoint) => endpoint.endpointId === 'seatBalances.list');
  assert(seatBalances, 'api readiness golden missing seatBalances.list endpoint');
  assert(seatBalances.readMockOutput.covered === true, 'seatBalances.list readiness missing read-mock coverage');
  assert(seatBalances.readPipelineGoldenOutput.covered === true, 'seatBalances.list readiness missing read-pipeline coverage');
  assert(seatBalances.persistedReadAuditOutput.covered === true, 'seatBalances.list readiness missing persisted read-audit coverage');
  const payments = readiness.coverageByFamily.find((family) => family.family === 'payments');
  assert(payments && payments.readEndpoints === 1, 'api readiness golden must summarize one payments read endpoint');
  assert(payments.persistedReadAudits === 1, 'api readiness golden must summarize one payments persisted read audit');
  const invoicePayments = readiness.endpoints.find((endpoint) => endpoint.endpointId === 'payments.listForInvoice');
  assert(invoicePayments, 'api readiness golden missing payments.listForInvoice endpoint');
  assert(invoicePayments.readMockOutput.covered === true, 'payments.listForInvoice readiness missing read-mock coverage');
  assert(invoicePayments.readPipelineGoldenOutput.covered === true, 'payments.listForInvoice readiness missing read-pipeline coverage');
  assert(invoicePayments.persistedReadAuditOutput.covered === true, 'payments.listForInvoice readiness missing persisted read-audit coverage');
  const configuredBillingProviders = readiness.endpoints.find((endpoint) => endpoint.endpointId === 'billingProvider.listConfiguredProviders');
  assert(configuredBillingProviders, 'api readiness golden missing billingProvider.listConfiguredProviders endpoint');
  assert(configuredBillingProviders.readMockOutput.covered === true, 'billingProvider.listConfiguredProviders readiness missing read-mock coverage');
  assert(configuredBillingProviders.readPipelineGoldenOutput.covered === true, 'billingProvider.listConfiguredProviders readiness missing read-pipeline coverage');
  assert(configuredBillingProviders.persistedReadAuditOutput.covered === true, 'billingProvider.listConfiguredProviders readiness missing persisted read-audit coverage');
  const customFields = readiness.coverageByFamily.find((family) => family.family === 'custom-fields');
  assert(customFields && customFields.readEndpoints === 1, 'api readiness golden must summarize one custom-fields read endpoint');
  assert(customFields.persistedReadAudits === 1, 'api readiness golden must summarize one custom-fields persisted read audit');
  const billableMetricsWrite = readiness.writeCoverageByFamily.find((family) => family.family === 'billable-metrics');
  assert(billableMetricsWrite && billableMetricsWrite.writeEndpoints === 3, 'api readiness golden must summarize three billable-metrics write endpoints');
  assert(billableMetricsWrite.apiApplyGates === 3, 'api readiness golden must summarize three billable-metrics write apply gates');
  assert(billableMetricsWrite.apiApplyReadbacks === 3, 'api readiness golden must summarize three billable-metrics write apply readbacks');
  assert(billableMetricsWrite.apiApplyResults === 3, 'api readiness golden must summarize three billable-metrics write apply results');
  const billableMetricsCreate = readiness.writeEndpoints.find((endpoint) => endpoint.endpointId === 'billableMetrics.create');
  assert(billableMetricsCreate, 'api readiness golden missing billableMetrics.create write endpoint');
  assert(billableMetricsCreate.localPreview.hasLocalPreview === true, 'billableMetrics.create readiness missing local preview coverage');
  assert(billableMetricsCreate.apiPreflight.hasLocalPreflight === true, 'billableMetrics.create readiness missing preflight coverage');
  assert(billableMetricsCreate.apiSandboxProof.hasLocalSandboxProof === true, 'billableMetrics.create readiness missing sandbox-proof coverage');
  assert(billableMetricsCreate.apiApplyGate.hasLocalApplyGate === true, 'billableMetrics.create readiness missing apply-gate coverage');
  assert(billableMetricsCreate.apiApprovalRecord.hasLocalApprovalRecord === true, 'billableMetrics.create readiness missing approval-record coverage');
  assert(billableMetricsCreate.apiApplyAudit.hasLocalApplyAudit === true, 'billableMetrics.create readiness missing apply-audit coverage');
  assert(billableMetricsCreate.apiApplyReadback.hasLocalApplyReadback === true, 'billableMetrics.create readiness missing apply-readback coverage');
  assert(billableMetricsCreate.apiApplyResult.hasLocalApplyResult === true, 'billableMetrics.create readiness missing apply-result coverage');
  assert(billableMetricsCreate.sideEffectProfile.riskClass === 'billable-metric-configuration-risk', 'billableMetrics.create readiness missing side-effect profile');
  assert(billableMetricsCreate.liveWriteSupported === false, 'billableMetrics.create readiness must keep live writes disabled');
  const billableMetricsUpdate = readiness.writeEndpoints.find((endpoint) => endpoint.endpointId === 'billableMetrics.update');
  assert(billableMetricsUpdate, 'api readiness golden missing billableMetrics.update write endpoint');
  assert(billableMetricsUpdate.localPreview.hasLocalPreview === true, 'billableMetrics.update readiness missing local preview coverage');
  assert(billableMetricsUpdate.apiPreflight.hasLocalPreflight === true, 'billableMetrics.update readiness missing preflight coverage');
  assert(billableMetricsUpdate.apiSandboxProof.hasLocalSandboxProof === true, 'billableMetrics.update readiness missing sandbox-proof coverage');
  assert(billableMetricsUpdate.apiApplyGate.hasLocalApplyGate === true, 'billableMetrics.update readiness missing apply-gate coverage');
  assert(billableMetricsUpdate.apiApprovalRecord.hasLocalApprovalRecord === true, 'billableMetrics.update readiness missing approval-record coverage');
  assert(billableMetricsUpdate.apiApplyAudit.hasLocalApplyAudit === true, 'billableMetrics.update readiness missing apply-audit coverage');
  assert(billableMetricsUpdate.apiApplyReadback.hasLocalApplyReadback === true, 'billableMetrics.update readiness missing apply-readback coverage');
  assert(billableMetricsUpdate.apiApplyResult.hasLocalApplyResult === true, 'billableMetrics.update readiness missing apply-result coverage');
  assert(billableMetricsUpdate.sideEffectProfile.riskClass === 'billable-metric-display-name-risk', 'billableMetrics.update readiness missing side-effect profile');
  assert(billableMetricsUpdate.liveWriteSupported === false, 'billableMetrics.update readiness must keep live writes disabled');
  const billableMetricsArchive = readiness.writeEndpoints.find((endpoint) => endpoint.endpointId === 'billableMetrics.archive');
  assert(billableMetricsArchive, 'api readiness golden missing billableMetrics.archive write endpoint');
  assert(billableMetricsArchive.localPreview.hasLocalPreview === true, 'billableMetrics.archive readiness missing local preview coverage');
  assert(billableMetricsArchive.apiPreflight.hasLocalPreflight === true, 'billableMetrics.archive readiness missing preflight coverage');
  assert(billableMetricsArchive.apiSandboxProof.hasLocalSandboxProof === true, 'billableMetrics.archive readiness missing sandbox-proof coverage');
  assert(billableMetricsArchive.apiApplyGate.hasLocalApplyGate === true, 'billableMetrics.archive readiness missing apply-gate coverage');
  assert(billableMetricsArchive.apiApprovalRecord.hasLocalApprovalRecord === true, 'billableMetrics.archive readiness missing approval-record coverage');
  assert(billableMetricsArchive.apiApplyAudit.hasLocalApplyAudit === true, 'billableMetrics.archive readiness missing apply-audit coverage');
  assert(billableMetricsArchive.apiApplyReadback.hasLocalApplyReadback === true, 'billableMetrics.archive readiness missing apply-readback coverage');
  assert(billableMetricsArchive.apiApplyResult.hasLocalApplyResult === true, 'billableMetrics.archive readiness missing apply-result coverage');
  assert(billableMetricsArchive.sideEffectProfile.riskClass === 'billable-metric-archive-risk', 'billableMetrics.archive readiness missing side-effect profile');
  assert(billableMetricsArchive.liveWriteSupported === false, 'billableMetrics.archive readiness must keep live writes disabled');
  const productsWrite = readiness.writeCoverageByFamily.find((family) => family.family === 'products');
  assert(productsWrite && productsWrite.writeEndpoints === 3, 'api readiness golden must summarize three products write endpoints');
  assert(productsWrite.apiApplyGates === 3, 'api readiness golden must summarize three products write apply gates');
  assert(productsWrite.apiApplyReadbacks === 3, 'api readiness golden must summarize three products write apply readbacks');
  assert(productsWrite.apiApplyResults === 3, 'api readiness golden must summarize three products write apply results');
  const productsCreate = readiness.writeEndpoints.find((endpoint) => endpoint.endpointId === 'products.create');
  assert(productsCreate, 'api readiness golden missing products.create write endpoint');
  assert(productsCreate.localPreview.hasLocalPreview === true, 'products.create readiness missing local preview coverage');
  assert(productsCreate.apiPreflight.hasLocalPreflight === true, 'products.create readiness missing preflight coverage');
  assert(productsCreate.apiSandboxProof.hasLocalSandboxProof === true, 'products.create readiness missing sandbox-proof coverage');
  assert(productsCreate.apiApplyGate.hasLocalApplyGate === true, 'products.create readiness missing apply-gate coverage');
  assert(productsCreate.apiApprovalRecord.hasLocalApprovalRecord === true, 'products.create readiness missing approval-record coverage');
  assert(productsCreate.apiApplyAudit.hasLocalApplyAudit === true, 'products.create readiness missing apply-audit coverage');
  assert(productsCreate.apiApplyReadback.hasLocalApplyReadback === true, 'products.create readiness missing apply-readback coverage');
  assert(productsCreate.apiApplyResult.hasLocalApplyResult === true, 'products.create readiness missing apply-result coverage');
  assert(productsCreate.sideEffectProfile.riskClass === 'product-catalog-create-risk', 'products.create readiness missing side-effect profile');
  assert(productsCreate.liveWriteSupported === false, 'products.create readiness must keep live writes disabled');
  const productsUpdate = readiness.writeEndpoints.find((endpoint) => endpoint.endpointId === 'products.update');
  assert(productsUpdate, 'api readiness golden missing products.update write endpoint');
  assert(productsUpdate.localPreview.hasLocalPreview === true, 'products.update readiness missing local preview coverage');
  assert(productsUpdate.apiPreflight.hasLocalPreflight === true, 'products.update readiness missing preflight coverage');
  assert(productsUpdate.apiSandboxProof.hasLocalSandboxProof === true, 'products.update readiness missing sandbox-proof coverage');
  assert(productsUpdate.apiApplyGate.hasLocalApplyGate === true, 'products.update readiness missing apply-gate coverage');
  assert(productsUpdate.apiApprovalRecord.hasLocalApprovalRecord === true, 'products.update readiness missing approval-record coverage');
  assert(productsUpdate.apiApplyAudit.hasLocalApplyAudit === true, 'products.update readiness missing apply-audit coverage');
  assert(productsUpdate.apiApplyReadback.hasLocalApplyReadback === true, 'products.update readiness missing apply-readback coverage');
  assert(productsUpdate.apiApplyResult.hasLocalApplyResult === true, 'products.update readiness missing apply-result coverage');
  assert(productsUpdate.sideEffectProfile.riskClass === 'product-scheduled-update-risk', 'products.update readiness missing side-effect profile');
  assert(productsUpdate.liveWriteSupported === false, 'products.update readiness must keep live writes disabled');
  const productsArchive = readiness.writeEndpoints.find((endpoint) => endpoint.endpointId === 'products.archive');
  assert(productsArchive, 'api readiness golden missing products.archive write endpoint');
  assert(productsArchive.localPreview.hasLocalPreview === true, 'products.archive readiness missing local preview coverage');
  assert(productsArchive.apiPreflight.hasLocalPreflight === true, 'products.archive readiness missing preflight coverage');
  assert(productsArchive.apiSandboxProof.hasLocalSandboxProof === true, 'products.archive readiness missing sandbox-proof coverage');
  assert(productsArchive.apiApplyGate.hasLocalApplyGate === true, 'products.archive readiness missing apply-gate coverage');
  assert(productsArchive.apiApprovalRecord.hasLocalApprovalRecord === true, 'products.archive readiness missing approval-record coverage');
  assert(productsArchive.apiApplyAudit.hasLocalApplyAudit === true, 'products.archive readiness missing apply-audit coverage');
  assert(productsArchive.apiApplyReadback.hasLocalApplyReadback === true, 'products.archive readiness missing apply-readback coverage');
  assert(productsArchive.apiApplyResult.hasLocalApplyResult === true, 'products.archive readiness missing apply-result coverage');
  assert(productsArchive.sideEffectProfile.riskClass === 'product-rate-card-retirement-risk', 'products.archive readiness missing side-effect profile');
  assert(productsArchive.liveWriteSupported === false, 'products.archive readiness must keep live writes disabled');
  const rateCardsWrite = readiness.writeCoverageByFamily.find((family) => family.family === 'rate-cards');
  assert(rateCardsWrite && rateCardsWrite.writeEndpoints === 5, 'api readiness golden must summarize five rate-cards write endpoints');
  assert(rateCardsWrite.apiApplyGates === 5, 'api readiness golden must summarize five rate-cards write apply gates');
  assert(rateCardsWrite.apiApplyReadbacks === 5, 'api readiness golden must summarize five rate-cards write apply readbacks');
  assert(rateCardsWrite.apiApplyResults === 5, 'api readiness golden must summarize five rate-cards write apply results');
  const rateCardsCreate = readiness.writeEndpoints.find((endpoint) => endpoint.endpointId === 'rateCards.create');
  assert(rateCardsCreate, 'api readiness golden missing rateCards.create write endpoint');
  assert(rateCardsCreate.localPreview.hasLocalPreview === true, 'rateCards.create readiness missing local preview coverage');
  assert(rateCardsCreate.apiPreflight.hasLocalPreflight === true, 'rateCards.create readiness missing preflight coverage');
  assert(rateCardsCreate.apiSandboxProof.hasLocalSandboxProof === true, 'rateCards.create readiness missing sandbox-proof coverage');
  assert(rateCardsCreate.apiApplyGate.hasLocalApplyGate === true, 'rateCards.create readiness missing apply-gate coverage');
  assert(rateCardsCreate.apiApprovalRecord.hasLocalApprovalRecord === true, 'rateCards.create readiness missing approval-record coverage');
  assert(rateCardsCreate.apiApplyAudit.hasLocalApplyAudit === true, 'rateCards.create readiness missing apply-audit coverage');
  assert(rateCardsCreate.apiApplyReadback.hasLocalApplyReadback === true, 'rateCards.create readiness missing apply-readback coverage');
  assert(rateCardsCreate.apiApplyResult.hasLocalApplyResult === true, 'rateCards.create readiness missing apply-result coverage');
  assert(rateCardsCreate.sideEffectProfile.riskClass === 'rate-card-catalog-create-risk', 'rateCards.create readiness missing side-effect profile');
  assert(rateCardsCreate.liveWriteSupported === false, 'rateCards.create readiness must keep live writes disabled');
  const rateCardsUpdate = readiness.writeEndpoints.find((endpoint) => endpoint.endpointId === 'rateCards.update');
  assert(rateCardsUpdate, 'api readiness golden missing rateCards.update write endpoint');
  assert(rateCardsUpdate.localPreview.hasLocalPreview === true, 'rateCards.update readiness missing local preview coverage');
  assert(rateCardsUpdate.apiPreflight.hasLocalPreflight === true, 'rateCards.update readiness missing preflight coverage');
  assert(rateCardsUpdate.apiSandboxProof.hasLocalSandboxProof === true, 'rateCards.update readiness missing sandbox-proof coverage');
  assert(rateCardsUpdate.apiApplyGate.hasLocalApplyGate === true, 'rateCards.update readiness missing apply-gate coverage');
  assert(rateCardsUpdate.apiApprovalRecord.hasLocalApprovalRecord === true, 'rateCards.update readiness missing approval-record coverage');
  assert(rateCardsUpdate.apiApplyAudit.hasLocalApplyAudit === true, 'rateCards.update readiness missing apply-audit coverage');
  assert(rateCardsUpdate.apiApplyReadback.hasLocalApplyReadback === true, 'rateCards.update readiness missing apply-readback coverage');
  assert(rateCardsUpdate.apiApplyResult.hasLocalApplyResult === true, 'rateCards.update readiness missing apply-result coverage');
  assert(rateCardsUpdate.sideEffectProfile.riskClass === 'rate-card-metadata-alias-risk', 'rateCards.update readiness missing side-effect profile');
  assert(rateCardsUpdate.liveWriteSupported === false, 'rateCards.update readiness must keep live writes disabled');
  const rateCardsArchive = readiness.writeEndpoints.find((endpoint) => endpoint.endpointId === 'rateCards.archive');
  assert(rateCardsArchive, 'api readiness golden missing rateCards.archive write endpoint');
  assert(rateCardsArchive.localPreview.hasLocalPreview === true, 'rateCards.archive readiness missing local preview coverage');
  assert(rateCardsArchive.apiPreflight.hasLocalPreflight === true, 'rateCards.archive readiness missing preflight coverage');
  assert(rateCardsArchive.apiSandboxProof.hasLocalSandboxProof === true, 'rateCards.archive readiness missing sandbox-proof coverage');
  assert(rateCardsArchive.apiApplyGate.hasLocalApplyGate === true, 'rateCards.archive readiness missing apply-gate coverage');
  assert(rateCardsArchive.apiApprovalRecord.hasLocalApprovalRecord === true, 'rateCards.archive readiness missing approval-record coverage');
  assert(rateCardsArchive.apiApplyAudit.hasLocalApplyAudit === true, 'rateCards.archive readiness missing apply-audit coverage');
  assert(rateCardsArchive.apiApplyReadback.hasLocalApplyReadback === true, 'rateCards.archive readiness missing apply-readback coverage');
  assert(rateCardsArchive.apiApplyResult.hasLocalApplyResult === true, 'rateCards.archive readiness missing apply-result coverage');
  assert(rateCardsArchive.sideEffectProfile.riskClass === 'rate-card-archive-risk', 'rateCards.archive readiness missing side-effect profile');
  assert(rateCardsArchive.liveWriteSupported === false, 'rateCards.archive readiness must keep live writes disabled');
  const rateCardsSetProductOrder = readiness.writeEndpoints.find((endpoint) => endpoint.endpointId === 'rateCards.setProductOrder');
  assert(rateCardsSetProductOrder, 'api readiness golden missing rateCards.setProductOrder write endpoint');
  assert(rateCardsSetProductOrder.localPreview.hasLocalPreview === true, 'rateCards.setProductOrder readiness missing local preview coverage');
  assert(rateCardsSetProductOrder.apiPreflight.hasLocalPreflight === true, 'rateCards.setProductOrder readiness missing preflight coverage');
  assert(rateCardsSetProductOrder.apiSandboxProof.hasLocalSandboxProof === true, 'rateCards.setProductOrder readiness missing sandbox-proof coverage');
  assert(rateCardsSetProductOrder.apiApplyGate.hasLocalApplyGate === true, 'rateCards.setProductOrder readiness missing apply-gate coverage');
  assert(rateCardsSetProductOrder.apiApprovalRecord.hasLocalApprovalRecord === true, 'rateCards.setProductOrder readiness missing approval-record coverage');
  assert(rateCardsSetProductOrder.apiApplyAudit.hasLocalApplyAudit === true, 'rateCards.setProductOrder readiness missing apply-audit coverage');
  assert(rateCardsSetProductOrder.apiApplyReadback.hasLocalApplyReadback === true, 'rateCards.setProductOrder readiness missing apply-readback coverage');
  assert(rateCardsSetProductOrder.apiApplyResult.hasLocalApplyResult === true, 'rateCards.setProductOrder readiness missing apply-result coverage');
  assert(rateCardsSetProductOrder.sideEffectProfile.riskClass === 'rate-card-product-order-risk', 'rateCards.setProductOrder readiness missing side-effect profile');
  assert(rateCardsSetProductOrder.liveWriteSupported === false, 'rateCards.setProductOrder readiness must keep live writes disabled');
  const customFieldsWrite = readiness.writeCoverageByFamily.find((family) => family.family === 'custom-fields');
  assert(customFieldsWrite && customFieldsWrite.writeEndpoints === 4, 'api readiness golden must summarize four custom-fields write endpoints');
  assert(customFieldsWrite.apiApplyGates === 4, 'api readiness golden must summarize four custom-fields write apply gates');
  assert(customFieldsWrite.apiApplyReadbacks === 4, 'api readiness golden must summarize four custom-fields write apply readbacks');
  assert(customFieldsWrite.apiApplyResults === 4, 'api readiness golden must summarize four custom-fields write apply results');
  const customFieldsListKeys = readiness.endpoints.find((endpoint) => endpoint.endpointId === 'customFields.listKeys');
  assert(customFieldsListKeys, 'api readiness golden missing customFields.listKeys endpoint');
  assert(customFieldsListKeys.readMockOutput.covered === true, 'customFields.listKeys readiness missing read-mock coverage');
  assert(customFieldsListKeys.readPipelineGoldenOutput.covered === true, 'customFields.listKeys readiness missing read-pipeline coverage');
  assert(customFieldsListKeys.persistedReadAuditOutput.covered === true, 'customFields.listKeys readiness missing persisted read-audit coverage');
  const customFieldsAddKey = readiness.writeEndpoints.find((endpoint) => endpoint.endpointId === 'customFields.addKey');
  assert(customFieldsAddKey, 'api readiness golden missing customFields.addKey write endpoint');
  assert(customFieldsAddKey.localPreview.hasLocalPreview === true, 'customFields.addKey readiness missing local preview coverage');
  assert(customFieldsAddKey.apiPreflight.hasLocalPreflight === true, 'customFields.addKey readiness missing preflight coverage');
  assert(customFieldsAddKey.apiSandboxProof.hasLocalSandboxProof === true, 'customFields.addKey readiness missing sandbox-proof coverage');
  assert(customFieldsAddKey.apiApplyGate.hasLocalApplyGate === true, 'customFields.addKey readiness missing apply-gate coverage');
  assert(customFieldsAddKey.apiApprovalRecord.hasLocalApprovalRecord === true, 'customFields.addKey readiness missing approval-record coverage');
  assert(customFieldsAddKey.apiApplyAudit.hasLocalApplyAudit === true, 'customFields.addKey readiness missing apply-audit coverage');
  assert(customFieldsAddKey.apiApplyReadback.hasLocalApplyReadback === true, 'customFields.addKey readiness missing apply-readback coverage');
  assert(customFieldsAddKey.apiApplyResult.hasLocalApplyResult === true, 'customFields.addKey readiness missing apply-result coverage');
  assert(customFieldsAddKey.sideEffectProfile.riskClass === 'custom-field-allowlist-risk', 'customFields.addKey readiness missing side-effect profile');
  assert(customFieldsAddKey.liveWriteSupported === false, 'customFields.addKey readiness must keep live writes disabled');
  const customFieldsRemoveKey = readiness.writeEndpoints.find((endpoint) => endpoint.endpointId === 'customFields.removeKey');
  assert(customFieldsRemoveKey, 'api readiness golden missing customFields.removeKey write endpoint');
  assert(customFieldsRemoveKey.localPreview.hasLocalPreview === true, 'customFields.removeKey readiness missing local preview coverage');
  assert(customFieldsRemoveKey.apiPreflight.hasLocalPreflight === true, 'customFields.removeKey readiness missing preflight coverage');
  assert(customFieldsRemoveKey.apiSandboxProof.hasLocalSandboxProof === true, 'customFields.removeKey readiness missing sandbox-proof coverage');
  assert(customFieldsRemoveKey.apiApplyGate.hasLocalApplyGate === true, 'customFields.removeKey readiness missing apply-gate coverage');
  assert(customFieldsRemoveKey.apiApprovalRecord.hasLocalApprovalRecord === true, 'customFields.removeKey readiness missing approval-record coverage');
  assert(customFieldsRemoveKey.apiApplyAudit.hasLocalApplyAudit === true, 'customFields.removeKey readiness missing apply-audit coverage');
  assert(customFieldsRemoveKey.apiApplyReadback.hasLocalApplyReadback === true, 'customFields.removeKey readiness missing apply-readback coverage');
  assert(customFieldsRemoveKey.apiApplyResult.hasLocalApplyResult === true, 'customFields.removeKey readiness missing apply-result coverage');
  assert(customFieldsRemoveKey.sideEffectProfile.riskClass === 'custom-field-allowlist-removal-risk', 'customFields.removeKey readiness missing side-effect profile');
  assert(customFieldsRemoveKey.liveWriteSupported === false, 'customFields.removeKey readiness must keep live writes disabled');
  const customFieldsSetValues = readiness.writeEndpoints.find((endpoint) => endpoint.endpointId === 'customFields.setValues');
  assert(customFieldsSetValues, 'api readiness golden missing customFields.setValues write endpoint');
  assert(customFieldsSetValues.localPreview.hasLocalPreview === true, 'customFields.setValues readiness missing local preview coverage');
  assert(customFieldsSetValues.apiPreflight.hasLocalPreflight === true, 'customFields.setValues readiness missing preflight coverage');
  assert(customFieldsSetValues.apiSandboxProof.hasLocalSandboxProof === true, 'customFields.setValues readiness missing sandbox-proof coverage');
  assert(customFieldsSetValues.apiApplyGate.hasLocalApplyGate === true, 'customFields.setValues readiness missing apply-gate coverage');
  assert(customFieldsSetValues.apiApprovalRecord.hasLocalApprovalRecord === true, 'customFields.setValues readiness missing approval-record coverage');
  assert(customFieldsSetValues.apiApplyAudit.hasLocalApplyAudit === true, 'customFields.setValues readiness missing apply-audit coverage');
  assert(customFieldsSetValues.apiApplyReadback.hasLocalApplyReadback === true, 'customFields.setValues readiness missing apply-readback coverage');
  assert(customFieldsSetValues.apiApplyResult.hasLocalApplyResult === true, 'customFields.setValues readiness missing apply-result coverage');
  assert(customFieldsSetValues.sideEffectProfile.riskClass === 'custom-field-value-write-risk', 'customFields.setValues readiness missing side-effect profile');
  assert(customFieldsSetValues.liveWriteSupported === true, 'customFields.setValues readiness must report allowlisted live write');
  assert(customFieldsSetValues.applyEnabledInCurrentCli === true, 'customFields.setValues readiness must report allowlisted apply');
  const customFieldsDeleteValues = readiness.writeEndpoints.find((endpoint) => endpoint.endpointId === 'customFields.deleteValues');
  assert(customFieldsDeleteValues, 'api readiness golden missing customFields.deleteValues write endpoint');
  assert(customFieldsDeleteValues.localPreview.hasLocalPreview === true, 'customFields.deleteValues readiness missing local preview coverage');
  assert(customFieldsDeleteValues.apiPreflight.hasLocalPreflight === true, 'customFields.deleteValues readiness missing preflight coverage');
  assert(customFieldsDeleteValues.apiSandboxProof.hasLocalSandboxProof === true, 'customFields.deleteValues readiness missing sandbox-proof coverage');
  assert(customFieldsDeleteValues.apiApplyGate.hasLocalApplyGate === true, 'customFields.deleteValues readiness missing apply-gate coverage');
  assert(customFieldsDeleteValues.apiApprovalRecord.hasLocalApprovalRecord === true, 'customFields.deleteValues readiness missing approval-record coverage');
  assert(customFieldsDeleteValues.apiApplyAudit.hasLocalApplyAudit === true, 'customFields.deleteValues readiness missing apply-audit coverage');
  assert(customFieldsDeleteValues.apiApplyReadback.hasLocalApplyReadback === true, 'customFields.deleteValues readiness missing apply-readback coverage');
  assert(customFieldsDeleteValues.apiApplyResult.hasLocalApplyResult === true, 'customFields.deleteValues readiness missing apply-result coverage');
  assert(customFieldsDeleteValues.sideEffectProfile.riskClass === 'custom-field-value-deletion-risk', 'customFields.deleteValues readiness missing side-effect profile');
  assert(customFieldsDeleteValues.liveWriteSupported === false, 'customFields.deleteValues readiness must keep live writes disabled');
  const settings = readiness.coverageByFamily.find((family) => family.family === 'settings');
  assert(settings && settings.readEndpoints === 1, 'api readiness golden must summarize one settings read endpoint');
  assert(settings.persistedReadAudits === 1, 'api readiness golden must summarize one settings persisted read audit');
  const pricingUnits = readiness.endpoints.find((endpoint) => endpoint.endpointId === 'settings.listPricingUnits');
  assert(pricingUnits, 'api readiness golden missing settings.listPricingUnits endpoint');
  assert(pricingUnits.readMockOutput.covered === true, 'settings.listPricingUnits readiness missing read-mock coverage');
  assert(pricingUnits.readPipelineGoldenOutput.covered === true, 'settings.listPricingUnits readiness missing read-pipeline coverage');
  assert(pricingUnits.persistedReadAuditOutput.covered === true, 'settings.listPricingUnits readiness missing persisted read-audit coverage');
  const security = readiness.coverageByFamily.find((family) => family.family === 'security');
  assert(security && security.readEndpoints === 2, 'api readiness golden must summarize two security read endpoints');
  assert(security.persistedReadAudits === 2, 'api readiness golden must summarize two security persisted read audits');
  const securityServices = readiness.endpoints.find((endpoint) => endpoint.endpointId === 'security.getServices');
  assert(securityServices, 'api readiness golden missing security.getServices endpoint');
  assert(securityServices.readMockOutput.covered === true, 'security.getServices readiness missing read-mock coverage');
  assert(securityServices.readPipelineGoldenOutput.covered === true, 'security.getServices readiness missing read-pipeline coverage');
  assert(securityServices.persistedReadAuditOutput.covered === true, 'security.getServices readiness missing persisted read-audit coverage');
  const securityAuditLogs = readiness.endpoints.find((endpoint) => endpoint.endpointId === 'security.getAuditLogs');
  assert(securityAuditLogs, 'api readiness golden missing security.getAuditLogs endpoint');
  assert(securityAuditLogs.readMockOutput.covered === true, 'security.getAuditLogs readiness missing read-mock coverage');
  assert(securityAuditLogs.readPipelineGoldenOutput.covered === true, 'security.getAuditLogs readiness missing read-pipeline coverage');
  assert(securityAuditLogs.persistedReadAuditOutput.covered === true, 'security.getAuditLogs readiness missing persisted read-audit coverage');
  const rateCardSchedule = readiness.endpoints.find((endpoint) => endpoint.endpointId === 'rateCards.getRateSchedule');
  assert(rateCardSchedule, 'api readiness golden missing rateCards.getRateSchedule endpoint');
  assert(rateCardSchedule.readMockOutput.covered === true, 'rateCards.getRateSchedule readiness missing read-mock coverage');
  assert(rateCardSchedule.readPipelineGoldenOutput.covered === true, 'rateCards.getRateSchedule readiness missing read-pipeline coverage');
  assert(rateCardSchedule.persistedReadAuditOutput.covered === true, 'rateCards.getRateSchedule readiness missing persisted read-audit coverage');
  assert(
    rateCardSchedule.persistedReadAuditOutput.examples.some((example) => example.fixturePath.endsWith('api-read-audit-rate-card-schedule-valid.jsonl')),
    'rateCards.getRateSchedule readiness missing persisted audit fixture path',
  );
  const contracts = readiness.writeCoverageByFamily.find((family) => family.family === 'contracts');
  assert(contracts && contracts.writeEndpoints === 4, 'api readiness golden must summarize four contract write endpoints');
  assert(contracts.apiSandboxProofs === 4, 'api readiness golden must summarize four contract write sandbox proofs');
  assert(contracts.apiApplyGates === 4, 'api readiness golden must summarize four contract write apply gates');
  assert(contracts.apiApprovalRecords === 4, 'api readiness golden must summarize four contract write approval records');
  assert(contracts.apiApplyAudits === 4, 'api readiness golden must summarize four contract write apply audits');
  assert(contracts.apiApplyReadbacks === 4, 'api readiness golden must summarize four contract write apply readbacks');
  assert(contracts.apiApplyResults === 4, 'api readiness golden must summarize four contract write apply results');
  const contractEdit = readiness.writeEndpoints.find((endpoint) => endpoint.endpointId === 'contracts.edit.v2');
  assert(contractEdit, 'api readiness golden missing contracts.edit.v2 write endpoint');
  assert(contractEdit.localPreview.hasLocalPreview === true, 'contracts.edit.v2 readiness missing local preview coverage');
  assert(contractEdit.apiPreflight.hasLocalPreflight === true, 'contracts.edit.v2 readiness missing preflight coverage');
  assert(contractEdit.apiSandboxProof.hasLocalSandboxProof === true, 'contracts.edit.v2 readiness missing sandbox-proof coverage');
  assert(contractEdit.apiApplyGate.hasLocalApplyGate === true, 'contracts.edit.v2 readiness missing apply-gate coverage');
  assert(contractEdit.apiApprovalRecord.hasLocalApprovalRecord === true, 'contracts.edit.v2 readiness missing approval-record coverage');
  assert(contractEdit.apiApplyAudit.hasLocalApplyAudit === true, 'contracts.edit.v2 readiness missing apply-audit coverage');
  assert(contractEdit.apiApplyReadback.hasLocalApplyReadback === true, 'contracts.edit.v2 readiness missing apply-readback coverage');
  assert(contractEdit.apiApplyResult.hasLocalApplyResult === true, 'contracts.edit.v2 readiness missing apply-result coverage');
  assert(contractEdit.liveWriteSupported === true, 'contracts.edit.v2 readiness must report allowlisted live write');
  assert(contractEdit.applyEnabledInCurrentCli === true, 'contracts.edit.v2 readiness must report allowlisted apply');
}

function assertSetupResolveGoldenCoverage() {
  const setupResolve = readJson(path.join(packageRoot, 'test', 'golden', 'setup', 'resolve.metro-sandbox.json'));
  const serialized = JSON.stringify(setupResolve);

  assert(setupResolve.schemaVersion === 'metro.profile.resolve.v1', 'setup resolve golden schema mismatch');
  assert(setupResolve.generatedFrom === 'metronome-cli/src/setup/profiles.js', 'setup resolve golden source mismatch');
  assert(setupResolve.apiAccess === 'none', 'setup resolve golden must not declare API access');
  assert(setupResolve.localOnly === true, 'setup resolve golden must remain local-only');
  assert(setupResolve.valid === true, 'setup resolve golden must remain valid');
  assert(setupResolve.blocked === false, 'setup resolve golden must not be blocked');
  assert(setupResolve.profileName === 'metro-sandbox', 'setup resolve golden profile name mismatch');
  assert(setupResolve.expectedTenant === 'sandbox', 'setup resolve golden expected tenant mismatch');
  assert(
    setupResolve.liveExecution && setupResolve.liveExecution.enabledInCurrentCli === false,
    'setup resolve golden must keep live execution disabled',
  );
  assert(setupResolve.profile && setupResolve.profile.name === 'metro-sandbox', 'setup resolve golden selected profile mismatch');
  assert(setupResolve.profile.tenant === 'sandbox', 'setup resolve golden selected profile tenant mismatch');
  assert(setupResolve.profile.metronomeKeyEnv === 'METRONOME_SANDBOX_KEY', 'setup resolve golden selected profile key env mismatch');
  assert(
    setupResolve.profile.envPresence
      && setupResolve.profile.envPresence.checked === false
      && setupResolve.profile.envPresence.present === null,
    'setup resolve golden must avoid env-value inspection by default',
  );
  assert(setupResolve.profile.readyForLiveApi === false, 'setup resolve golden must not imply live API readiness');
  assert(setupResolve.tenantProfile && setupResolve.tenantProfile.profileName === 'metro-sandbox', 'setup resolve golden tenant profile mismatch');
  assert(setupResolve.tenantProfile.tenant === 'sandbox', 'setup resolve golden tenant profile tenant mismatch');
  assert(setupResolve.tenantProfile.keyEnv === 'METRONOME_SANDBOX_KEY', 'setup resolve golden tenant profile key env mismatch');
  assert(
    setupResolve.tenantProfile.keyFingerprint === 'fp_sandbox_setup_resolve_reviewed',
    'setup resolve golden tenant profile fingerprint mismatch',
  );
  assert(setupResolve.tenantProfile.profileBindingConfirmed === true, 'setup resolve golden must confirm profile binding');
  assert(Array.isArray(setupResolve.findings) && setupResolve.findings.length === 0, 'setup resolve golden must have no findings');
  assert(!/(sk_live_|sk_test_|pk_live_|Bearer\s+[A-Za-z0-9._-]+|prod_[A-Za-z0-9]{12,})/.test(serialized), 'setup resolve golden must not contain secret-shaped values');
}

function assertSetupQuickstartGoldenCoverage() {
  const quickstart = readJson(path.join(packageRoot, 'test', 'golden', 'setup', 'quickstart.json'));
  const serialized = JSON.stringify(quickstart);

  assert(quickstart.schemaVersion === 'metro.setup.quickstart.v1', 'setup quickstart golden schema mismatch');
  assert(quickstart.generatedFrom === 'metronome-cli/src/setup/profiles.js', 'setup quickstart golden source mismatch');
  assert(quickstart.apiAccess === 'none', 'setup quickstart golden must not declare API access');
  assert(quickstart.localOnly === true, 'setup quickstart golden must remain local-only');
  assert(
    quickstart.liveExecution && quickstart.liveExecution.enabledInCurrentCli === false,
    'setup quickstart golden must keep live execution disabled',
  );
  assert(Array.isArray(quickstart.commands) && quickstart.commands.length >= 8, 'setup quickstart golden must list at least eight local commands');
  assert(
    quickstart.shellCommandBlock === quickstart.commands.map((step) => step.command).join('\n'),
    'setup quickstart shell command block must be derived from local commands',
  );
  for (const command of [
    'METRO_QUICKSTART_DIR="${TMPDIR:-/tmp}/metro-quickstart"\nmkdir -p "$METRO_QUICKSTART_DIR"',
    'metro schema --json',
    'metro setup template --json',
    'metro setup resolve --file "$METRO_QUICKSTART_DIR/profiles.json" --profile metro-sandbox --expect-tenant sandbox --key-fingerprint fp_sandbox_setup_resolve_reviewed --json',
    'metro validate --shape pro-annual --file "$METRO_QUICKSTART_DIR/pro-annual.json" --json',
    'metro package preview --shape pro-annual --file "$METRO_QUICKSTART_DIR/pro-annual.json" --sandbox --json',
  ]) {
    assert(quickstart.commands.some((step) => step.command === command), `setup quickstart golden missing command: ${command}`);
    assert(quickstart.shellCommandBlock.includes(command), `setup quickstart shell block missing command: ${command}`);
  }
  assert(!quickstart.shellCommandBlock.includes('node bin/metro.js'), 'setup quickstart shell block must use installed metro commands');
  assert(!quickstart.shellCommandBlock.includes('test/fixtures'), 'setup quickstart shell block must not depend on source fixtures');
  assert(quickstart.expectedPreviewSummary.schemaVersion === 'metro.preview.v1', 'setup quickstart preview summary schema mismatch');
  assert(quickstart.expectedPreviewSummary.workflow === 'package.create', 'setup quickstart preview workflow mismatch');
  assert(quickstart.expectedPreviewSummary.shape === 'pro-annual', 'setup quickstart preview shape mismatch');
  assert(quickstart.expectedPreviewSummary.tenant === 'sandbox', 'setup quickstart preview tenant mismatch');
  assert(quickstart.expectedPreviewSummary.blocked === false, 'setup quickstart preview must remain unblocked');
  assert(quickstart.expectedProfileResolutionSummary.readyForLiveApi === false, 'setup quickstart must not imply live API readiness');
  assert(quickstart.expectedProfileResolutionSummary.envPresenceChecked === false, 'setup quickstart must not inspect env values');
  assert(
    quickstart.safetyBoundaries.some((boundary) => boundary.includes('green preview is not production approval')),
    'setup quickstart golden missing production approval boundary',
  );
  assert(!/(sk_live_|sk_test_|pk_live_|Bearer\s+[A-Za-z0-9._-]+|prod_[A-Za-z0-9]{12,})/.test(serialized), 'setup quickstart golden must not contain secret-shaped values');
}

function assertInspectOutputVerificationCoverage() {
  const fixture = readJson(path.join(packageRoot, 'test', 'fixtures', 'inspect', 'product-inspect-output-valid.json'));
  const result = verifyInspectOutput(fixture);
  const contractFixture = readJson(path.join(packageRoot, 'test', 'fixtures', 'inspect', 'contract-inspect-output-valid.json'));
  const contractResult = verifyInspectOutput(contractFixture);
  const invoiceFixture = readJson(path.join(packageRoot, 'test', 'fixtures', 'inspect', 'invoice-inspect-output-valid.json'));
  const invoiceResult = verifyInspectOutput(invoiceFixture);
  const productGolden = readJson(path.join(packageRoot, 'test', 'golden', 'verify', 'product-inspect-output-valid.json'));
  const contractGolden = readJson(path.join(packageRoot, 'test', 'golden', 'verify', 'contract-inspect-output-valid.json'));
  const invoiceGolden = readJson(path.join(packageRoot, 'test', 'golden', 'verify', 'invoice-inspect-output-valid.json'));

  assert(fixture.schemaVersion === 'metro.product.inspect.v1', 'product inspect fixture schema mismatch');
  assert(fixture.generatedFrom === 'metronome-cli/src/inspect/index.js', 'product inspect fixture source mismatch');
  assert(fixture.tenant === 'sandbox', 'product inspect fixture tenant mismatch');
  assert(fixture.productId === 'prod_sch052', 'product inspect fixture product id mismatch');
  assert(Array.isArray(fixture.requestSummary) && fixture.requestSummary.length === 1, 'product inspect fixture must summarize one read endpoint');
  assert(fixture.requestSummary[0].method === 'POST', 'product inspect fixture request method mismatch');
  assert(fixture.requestSummary[0].path === '/v1/contract-pricing/products/get', 'product inspect fixture request path mismatch');
  assert(fixture.product && fixture.product.id === fixture.productId, 'product inspect fixture product identity mismatch');
  assert(fixture.currentVersion && fixture.currentVersion.name === 'SCH052', 'product inspect fixture missing current version evidence');
  assert(fixture.initialVersion && fixture.initialVersion.name === 'SCH052', 'product inspect fixture missing initial version evidence');
  assert(Array.isArray(fixture.scheduledUpdates) && fixture.scheduledUpdates.length === 1, 'product inspect fixture missing scheduled update evidence');
  assert(Array.isArray(fixture.verificationWarnings) && fixture.verificationWarnings.length === 0, 'product inspect fixture must stay warning-free');
  assert(result.valid === true, 'product inspect fixture must verify as valid inspect output');
  assert(result.inspectedSchemaVersion === 'metro.product.inspect.v1', 'product inspect verification schema mismatch');
  assert(result.summary.requestCount === 1, 'product inspect verification request count mismatch');
  assert(result.summary.warningCount === 0, 'product inspect verification warning count mismatch');
  assert(productGolden.valid === true && productGolden.inspectedSchemaVersion === 'metro.product.inspect.v1', 'product inspect verification golden mismatch');
  assert(productGolden.summary.requestCount === 1 && productGolden.summary.warningCount === 0, 'product inspect verification golden summary mismatch');

  assert(contractFixture.schemaVersion === 'metro.contract.inspect.v1', 'contract inspect fixture schema mismatch');
  assert(contractFixture.generatedFrom === 'metronome-cli/src/inspect/index.js', 'contract inspect fixture source mismatch');
  assert(contractFixture.tenant === 'sandbox', 'contract inspect fixture tenant mismatch');
  assert(contractFixture.contractId === 'contract-test', 'contract inspect fixture contract id mismatch');
  assert(contractFixture.at === '2026-07-01T00:00:00.000Z', 'contract inspect fixture at timestamp mismatch');
  assert(contractFixture.coveringDate === contractFixture.at, 'contract inspect fixture compatibility timestamp mismatch');
  assert(Array.isArray(contractFixture.requestSummary) && contractFixture.requestSummary.length === 3, 'contract inspect fixture request count mismatch');
  assert(contractFixture.requestSummary[0].path === '/v2/contracts/get', 'contract inspect fixture contract get path mismatch');
  assert(contractFixture.requestSummary[1].path === '/v2/contracts/getEditHistory', 'contract inspect fixture edit history path mismatch');
  assert(contractFixture.requestSummary[2].path === '/v1/contracts/getContractRateSchedule?limit=100', 'contract inspect fixture rate schedule path mismatch');
  assert(contractFixture.contract && contractFixture.contract.id === contractFixture.contractId, 'contract inspect fixture contract identity mismatch');
  assert(Array.isArray(contractFixture.editHistory) && contractFixture.editHistory.length === 1, 'contract inspect fixture edit history evidence mismatch');
  assert(contractFixture.rateSchedule && Array.isArray(contractFixture.rateSchedule.rates), 'contract inspect fixture rate schedule evidence mismatch');
  assert(Array.isArray(contractFixture.verificationWarnings) && contractFixture.verificationWarnings.length === 0, 'contract inspect fixture must stay warning-free');
  assert(contractResult.valid === true, 'contract inspect fixture must verify as valid inspect output');
  assert(contractResult.inspectedSchemaVersion === 'metro.contract.inspect.v1', 'contract inspect verification schema mismatch');
  assert(contractResult.summary.requestCount === 3, 'contract inspect verification request count mismatch');
  assert(contractResult.summary.warningCount === 0, 'contract inspect verification warning count mismatch');
  assert(contractGolden.valid === true && contractGolden.inspectedSchemaVersion === 'metro.contract.inspect.v1', 'contract inspect verification golden mismatch');
  assert(contractGolden.summary.tenant === 'sandbox', 'contract inspect verification golden tenant mismatch');
  assert(contractGolden.summary.requestCount === 3 && contractGolden.summary.warningCount === 0, 'contract inspect verification golden summary mismatch');

  assert(invoiceFixture.schemaVersion === 'metro.invoice.inspect.v1', 'invoice inspect fixture schema mismatch');
  assert(invoiceFixture.generatedFrom === 'metronome-cli/src/inspect/index.js', 'invoice inspect fixture source mismatch');
  assert(invoiceFixture.tenant === 'production', 'invoice inspect fixture tenant mismatch');
  assert(invoiceFixture.invoiceId === 'invoice-test', 'invoice inspect fixture invoice id mismatch');
  assert(Array.isArray(invoiceFixture.requestSummary) && invoiceFixture.requestSummary.length === 2, 'invoice inspect fixture request count mismatch');
  assert(invoiceFixture.requestSummary[0].path === '/v1/invoices/get', 'invoice inspect fixture invoice get path mismatch');
  assert(invoiceFixture.requestSummary[1].path === '/v1/invoices/payments/list', 'invoice inspect fixture payments path mismatch');
  assert(invoiceFixture.invoice && invoiceFixture.invoice.id === invoiceFixture.invoiceId, 'invoice inspect fixture invoice identity mismatch');
  assert(invoiceFixture.status === 'FINALIZED', 'invoice inspect fixture finalized status mismatch');
  assert(Array.isArray(invoiceFixture.payments) && invoiceFixture.payments.length === 1, 'invoice inspect fixture payment evidence mismatch');
  assert(
    Array.isArray(invoiceFixture.stripeReconciliationWarnings)
      && invoiceFixture.stripeReconciliationWarnings.some((warning) => warning.id === 'MTR-INV-004'),
    'invoice inspect fixture missing finalized-invoice reconciliation warning',
  );
  assert(invoiceResult.valid === true, 'invoice inspect fixture must verify as valid inspect output');
  assert(invoiceResult.inspectedSchemaVersion === 'metro.invoice.inspect.v1', 'invoice inspect verification schema mismatch');
  assert(invoiceResult.summary.requestCount === 2, 'invoice inspect verification request count mismatch');
  assert(invoiceResult.summary.warningCount === 1, 'invoice inspect verification warning count mismatch');
  assert(invoiceGolden.valid === true && invoiceGolden.inspectedSchemaVersion === 'metro.invoice.inspect.v1', 'invoice inspect verification golden mismatch');
  assert(invoiceGolden.summary.tenant === 'production', 'invoice inspect verification golden tenant mismatch');
  assert(invoiceGolden.summary.requestCount === 2 && invoiceGolden.summary.warningCount === 1, 'invoice inspect verification golden summary mismatch');
}

function main() {
  const html = read(htmlPath);
  const installHtml = read(installPath);
  const integrationHtml = read(integrationPath);
  const commandReferenceHtml = read(commandReferencePath);
  const explainReferenceHtml = read(explainReferencePath);
  const apiReferenceHtml = read(apiReferencePath);
  const evidenceGateReferenceHtml = read(evidenceGateReferencePath);
  const inputReferenceHtml = read(inputReferencePath);
  const shapeReferenceHtml = read(shapeReferencePath);
  const validatorReferenceHtml = read(validatorReferencePath);
  const gotchaReferenceHtml = read(gotchaReferencePath);
  const planningReadme = read(planningReadmePath);
  const packageReadme = read(path.join(packageRoot, 'README.md'));
  const styles = read(stylesPath);
  const siteJs = read(path.join(siteDir, 'site.js'));
  for (const pagePath of htmlPagePaths) {
    assertNoTabs(read(pagePath), path.basename(pagePath));
  }
  const allPageHtml = [
    html,
    installHtml,
    integrationHtml,
    commandReferenceHtml,
    explainReferenceHtml,
    apiReferenceHtml,
    evidenceGateReferenceHtml,
    inputReferenceHtml,
    shapeReferenceHtml,
    validatorReferenceHtml,
    gotchaReferenceHtml,
  ].join('\n');
  const sourceMap = JSON.parse(read(sourcesPath));
  const sources = sourceMap.sources || {};
  const currentApiReference = apiReference();
  const currentExplainReference = docsExplainTopicIndex();
  const currentEvidenceGateReference = evidenceGateReference();
  const currentInputReference = inputReference();
  const currentShapeReference = shapeReference();
  const currentValidatorReference = validatorReference();
  const currentGotchaReference = gotchaReference();
  assert(Array.isArray(currentApiReference.sectionNavigation), 'api reference JSON missing section navigation');
  assert(
    currentApiReference.sectionNavigation.some((section) => section.id === 'write-proof-ladder' && section.href === '#write-proof-ladder'),
    'api reference JSON missing write proof ladder navigation entry',
  );

  assert(sourceMap.schemaVersion === 'metro.docs.sources.v1', 'sources.json schemaVersion mismatch');
  assert(sources['metro-input-files'], 'sources.json missing metro input loader source');
  assert(sources['metro-input-normalize'], 'sources.json missing metro input normalize source');
  assert(sources['metro-input-normalize-shape-golden'], 'sources.json missing input normalize shape golden source');
  assert(sources['metro-input-normalize-api-golden'], 'sources.json missing input normalize API golden source');
  assert(sources['metro-input-reference'], 'sources.json missing metro input reference source');
  assert(sources['metro-input-reference-html'], 'sources.json missing metro input reference HTML source');
  assert(sources['metro-docs-explain-reference-html'], 'sources.json missing docs explain reference HTML source');
  assert(sources['metro-docs-explain-reference-page'], 'sources.json missing docs explain reference page source');
  assert(sources['metro-docs-explain-input-normalize-golden'], 'sources.json missing input normalize docs explain golden source');
  assert(sources['metro-docs-explain-install-troubleshooting-golden'], 'sources.json missing install troubleshooting docs explain golden source');
  assert(sources['metro-release-readiness-golden'], 'sources.json missing release readiness golden source');
  assert(sources['metro-release-artifact-manifest-golden'], 'sources.json missing release artifact manifest golden source');
  assert(sources['metro-release-evidence-plan-golden'], 'sources.json missing release evidence-plan golden source');
  assert(sources['metro-release-evidence-check-golden'], 'sources.json missing release evidence-check golden source');
  assert(sources['metro-release-retention-policy-golden'], 'sources.json missing release retention-policy golden source');
  assert(sources['metro-docs-explain-package-publish-readiness-golden'], 'sources.json missing package publish readiness docs explain golden source');
  assert(sources['metro-docs-explain-setup-troubleshooting-golden'], 'sources.json missing setup troubleshooting docs explain golden source');
  assert(sources['metro-docs-explain-output-anatomy-golden'], 'sources.json missing output anatomy docs explain golden source');
  assert(sources['metro-docs-explain-refusal-troubleshooting-golden'], 'sources.json missing refusal troubleshooting docs explain golden source');
  assert(sources['metro-docs-explain-topic-index-golden'], 'sources.json missing docs explain topic index golden source');

  for (const section of requiredSections) {
    assert(html.includes(`id="${section}"`), `Missing required section: ${section}`);
  }

  assert(html.includes('href="install.html"'), 'index.html missing install.html link');
  assert(html.includes('href="integration.html"'), 'index.html missing integration.html link');
  assert(html.includes('href="agents.html"'), 'index.html missing agents.html link');
  assert(html.includes('agent harnessing guide'), 'index.html missing agent harnessing guide link text');
  assert(html.includes('href="api-reference.html"'), 'index.html missing api-reference.html link');
  assert(html.includes('href="explain-reference.html"'), 'index.html missing explain-reference.html link');
  assert(html.includes('href="evidence-gate-reference.html"'), 'index.html missing evidence-gate-reference.html link');
  assert(html.includes('href="input-reference.html"'), 'index.html missing input-reference.html link');
  assert(installHtml.includes('id="current-local"'), 'install.html missing GitHub install path section');
  assert(installHtml.includes('id="target-install"'), 'install.html missing target install section');
  assert(installHtml.includes('id="troubleshooting"'), 'install.html missing troubleshooting section');
  assertInstallPageIndexCoverage(installHtml);
  assert(installHtml.includes('GitHub Install Path'), 'install.html missing GitHub install path heading');
  assert(installHtml.includes('GitHub install'), 'install.html missing GitHub install summary');
  assert(installHtml.includes('git clone --depth 1 https://github.com/metrocli/metro.git ~/.metro/src'), 'install.html missing GitHub install command');
  assert(installHtml.includes('scripts/install-global.sh'), 'install.html missing install-global.sh');
  assert(installHtml.includes('metro doctor'), 'install.html missing metro doctor');
  assert(installHtml.includes('npm run test:install'), 'install.html missing install smoke test command');
  assert(installHtml.includes('metro schema --json'), 'install.html missing schema discovery command');
  assert(installHtml.includes('metro setup quickstart'), 'install.html missing setup quickstart command');
  assert(installHtml.includes('metro setup quickstart --shell | zsh'), 'install.html missing executable setup quickstart shell command');
  assert(installHtml.includes('metro setup doctor'), 'install.html missing setup doctor command');
  assert(installHtml.includes('metro setup resolve'), 'install.html missing setup resolve command');
  assert(installHtml.includes('metro docs explain install.troubleshooting --json'), 'install.html missing install troubleshooting docs explain command');
  assert(installHtml.includes('metro release readiness --json'), 'install.html missing release readiness command');
  assert(installHtml.includes('metro release artifact-manifest --json'), 'install.html missing release artifact manifest command');
  assert(installHtml.includes('metro release retention-policy template --json'), 'install.html missing release retention-policy template command');
  assert(installHtml.includes('metro release retention-policy validate --file'), 'install.html missing release retention-policy validate command');
  assert(installHtml.includes('metro release evidence-plan --policy'), 'install.html missing release evidence-plan command');
  assert(installHtml.includes('metro release evidence-check --dir'), 'install.html missing release evidence-check command');
  assert(installHtml.includes('metro docs explain package.publish-readiness --json'), 'install.html missing package publish readiness docs explain command');
  assert(installHtml.includes('Release decision gate'), 'install.html missing release decision gate');
  assert(installHtml.includes('GitHub install is current; npm registry publishing remains blocked.'), 'install.html missing package publish blocked status');
  assert(installHtml.includes('<code>private:true removal</code>'), 'install.html missing private flag removal blocker');
  assert(installHtml.includes('<code>npm publish</code>'), 'install.html missing npm publish blocker');
  assert(installHtml.includes('<code>npm token handling</code>'), 'install.html missing npm token blocker');
  assert(installHtml.includes('registry destination'), 'install.html missing registry destination requirement');
  assert(installHtml.includes('GitHub install is the current distribution path'), 'install.html missing GitHub install boundary');
  assert(
    commandReferenceHtml.includes('metro api approvals [--family &lt;family&gt;] [--json]'),
    'command-reference.html missing api approvals command',
  );
  assert(
    commandReferenceHtml.includes('metro docs evidence-gate-reference [--json|--html]'),
    'command-reference.html missing evidence gate reference command',
  );
  assert(
    commandReferenceHtml.includes('metro docs input-reference [--json|--html]'),
    'command-reference.html missing input reference command',
  );
  assert(
    commandReferenceHtml.includes('metro release readiness [--json]'),
    'command-reference.html missing release readiness command',
  );
  assert(
    commandReferenceHtml.includes('metro release artifact-manifest [--json]'),
    'command-reference.html missing release artifact manifest command',
  );
  assert(
    commandReferenceHtml.includes('metro release evidence-check --dir &lt;artifact-directory&gt; [--json]'),
    'command-reference.html missing release evidence-check command',
  );
  assert(
    commandReferenceHtml.includes('metro release evidence-plan --policy &lt;policy.json|yaml&gt; [--json]'),
    'command-reference.html missing release evidence-plan command',
  );
  assert(
    commandReferenceHtml.includes('metro release retention-policy template [--json]'),
    'command-reference.html missing release retention-policy template command',
  );
  assert(
    commandReferenceHtml.includes('metro release retention-policy validate --file &lt;policy.json|yaml&gt; [--json]'),
    'command-reference.html missing release retention-policy validate command',
  );
  assert(
    planningReadme.includes('site/input-reference.html'),
    'planning README missing generated input reference page link',
  );
  assert(
    packageReadme.includes('metro docs input-reference --json'),
    'package README missing input reference CLI command',
  );
  assert(
    installHtml.includes('metro docs input-reference --json'),
    'install.html missing input reference command',
  );
  assert(
    integrationHtml.includes('metro docs input-reference --json'),
    'integration.html missing input reference command',
  );
  assert(html.includes('metro api readiness --summary --json'), 'index.html missing compact api readiness command');
  assert(html.includes('metro api readiness --json'), 'index.html missing full api readiness command');
  assert(html.includes('aria-label="First safe preview command"'), 'index.html hero must label the first safe preview command');
  assert(
    html.includes('data-installed-command="metro setup quickstart --shell | zsh"'),
    'index.html hero must mark the executable installed setup quickstart shell command',
  );
  assert(
    html.includes('data-copy-text="git clone --depth 1 https://github.com/metrocli/metro.git ~/.metro/src 2>/dev/null || true; bash ~/.metro/src/scripts/install-global.sh"') || html.includes('scripts/install-global.sh'),
    'index.html hero copy must install from GitHub before executing setup quickstart',
  );
  assert(!html.includes('data-local-repo-command="node bin/metro.js setup quickstart --shell"'), 'index.html hero must not use local repo setup command');
  assert(
    html.includes('data-local-repo-command-block="true"'),
    'index.html maintainer setup block must mark cwd-sensitive command blocks for local repo hydration',
  );
  assert(!installHtml.includes('data-local-repo-command-block="true"'), 'install.html terminal guide must not require local repo hydration');
  assert(
    siteJs.includes("const marker = '/docs/metronome-cli/site/';"),
    'site.js missing local repo root derivation for file-opened docs',
  );
  assert(html.includes('aria-label="First safe preview checklist"'), 'index.html hero must include first safe preview checklist');
  for (const expected of [
    '1. install from GitHub',
    '2. run installed <code>metro</code>',
    '3. stop at <code>metro.preview.v1</code>',
    'The copied command installs the standalone private GitHub package',
    'runs the installed quickstart block',
    'does not require the',
    'full operations checkout',
    'sandbox-labeled,',
    'hash-bound',
    'not approval',
    'complete local read/write evidence',
    'Expand guarded live coverage with audit writing and read-back verification',
    'billing without the Metronome maze',
    'metro ops who',
    'Skip the confusing billing UI',
  ]) {
    assert(html.includes(expected), `index.html missing first-run hero guidance: ${expected}`);
  }
  for (const expected of [
    'Run the six commands it prints',
    '`metro.preview.v1`',
    '`tenant: "sandbox"`',
    '`sha256:` payload hash',
    '`blocked: false`',
    'not authorize live reads',
    'live writes, Stripe delivery, or apply',
    'For the full local evidence tour',
    'cd /path/to/metronome-cli',
  ]) {
    assert(planningReadme.includes(expected), `planning README missing short first-run guidance: ${expected}`);
  }
  assert(html.includes('metro setup quickstart --shell | zsh'), 'index.html missing executable setup quickstart shell command');
  assert(html.includes('metro setup quickstart --json'), 'index.html missing setup quickstart command');
  assert(html.includes('pro-annual-valid.yaml'), 'index.html missing YAML first preview fixture');
  assert(installHtml.includes('$METRO_QUICKSTART_DIR/pro-annual.json'), 'install.html missing temp quickstart preview fixture');
  assert(html.includes('metro setup resolve'), 'index.html missing setup resolve command');
  assert(
    html.includes('<code>at</code> is canonical and <code>coveringDate</code> remains a v1 compatibility alias'),
    'index.html missing contract inspect timestamp alias note',
  );
  assert(
    html.includes('customer, package, product, billing-provider, contract, and invoice inspect outputs'),
    'index.html missing product inspect runner coverage text',
  );
  assert(
    html.includes('product version evidence, billing-provider delivery evidence'),
    'index.html missing product inspect-output verifier coverage text',
  );
  assert(
    commandReferenceHtml.includes('metro api readiness [--family &lt;family&gt;] [--summary] [--json]'),
    'command-reference.html missing api readiness command',
  );
  assertFirstSafePreviewPathCoverage(installHtml, packageReadme);
  assertAutomationIntegrationContractCoverage(installHtml, packageReadme);
  assertIntegrationGuideCoverage(integrationHtml, html, planningReadme);
  assert(html.includes('metro api search contract create --json'), 'index.html missing api search command');
  assert(
    commandReferenceHtml.includes('metro api search &lt;query&gt; [--query &lt;text&gt;] [--family &lt;family&gt;] [--json]'),
    'command-reference.html missing api search command',
  );
  assert(
    html.includes('metro-api-search-golden'),
    'index.html missing api search golden source id',
  );
  assert(html.includes('metro api diff contracts.create contracts.updateEndDate --json'), 'index.html missing api diff command');
  assert(
    commandReferenceHtml.includes('metro api diff &lt;left-endpoint-id&gt; &lt;right-endpoint-id&gt; [--json]'),
    'command-reference.html missing api diff command',
  );
  assert(
    html.includes('metro-api-diff-golden'),
    'index.html missing api diff golden source id',
  );
  assert(html.includes('metro api export --family contracts --json'), 'index.html missing api export command');
  assert(
    commandReferenceHtml.includes('metro api export [--family &lt;family&gt;] [--json]'),
    'command-reference.html missing api export command',
  );
  assert(
    html.includes('metro-api-export-golden'),
    'index.html missing api export golden source id',
  );
  assert(html.includes('metro docs explain contracts.create --json'), 'index.html missing docs explain command');
  assert(
    html.includes('metro docs explain --list --json'),
    'index.html missing docs explain topic index command',
  );
  assert(
    html.includes('metro docs explain input.normalize --json'),
    'index.html missing input normalize docs explain command',
  );
  assert(
    html.includes('metro docs explain output.anatomy --json'),
    'index.html missing output anatomy docs explain command',
  );
  assert(
    html.includes('metro docs explain contract-overrides.inspection --json'),
    'index.html missing contract override docs explain command',
  );
  assert(
    html.includes('metro docs explain product-rate-retirement.readback --json'),
    'index.html missing product rate retirement readback docs explain command',
  );
  assert(
    installHtml.includes('metro docs explain input.normalize --json'),
    'install.html missing input normalize docs explain command',
  );
  assert(
    installHtml.includes('metro docs explain output.anatomy --json'),
    'install.html missing output anatomy docs explain command',
  );
  assert(
    installHtml.includes('metro docs explain --list --json'),
    'install.html missing docs explain topic index command',
  );
  assert(
    installHtml.includes('metro docs explain --list --html'),
    'install.html missing docs explain topic index HTML command',
  );
  assert(
    integrationHtml.includes('metro docs explain input.normalize --json'),
    'integration.html missing input normalize docs explain command',
  );
  assert(
    integrationHtml.includes('metro docs explain output.anatomy --json'),
    'integration.html missing output anatomy docs explain command',
  );
  assert(
    integrationHtml.includes('metro docs explain --list --json'),
    'integration.html missing docs explain topic index command',
  );
  assert(
    integrationHtml.includes('metro docs explain --list --html'),
    'integration.html missing docs explain topic index HTML command',
  );
  assert(
    packageReadme.includes('metro docs explain input.normalize --json'),
    'package README missing input normalize docs explain command',
  );
  assert(
    packageReadme.includes('metro docs explain output.anatomy --json'),
    'package README missing output anatomy docs explain command',
  );
  assert(
    packageReadme.includes('metro docs explain --list --json'),
    'package README missing docs explain topic index command',
  );
  assert(
    planningReadme.includes('node bin/metro.js docs explain input.normalize --json'),
    'planning README missing input normalize docs explain command',
  );
  assert(
    planningReadme.includes('node bin/metro.js docs explain output.anatomy --json'),
    'planning README missing output anatomy docs explain command',
  );
  assert(
    planningReadme.includes('node bin/metro.js docs explain --list --json'),
    'planning README missing docs explain topic index command',
  );
  assert(
    installHtml.includes('metro docs explain contract-overrides.inspection --json'),
    'install.html missing contract override docs explain command',
  );
  assert(
    installHtml.includes('metro docs explain product-rate-retirement.readback --json'),
    'install.html missing product rate retirement readback docs explain command',
  );
  assert(
    commandReferenceHtml.includes('metro docs explain &lt;topic&gt; [--topic &lt;topic&gt;] [--list] [--json|--html]'),
    'command-reference.html missing docs explain command',
  );
  assert(
    commandReferenceHtml.includes('&lt;topic&gt;|--topic|--list'),
    'command-reference.html missing docs explain list required flag',
  );
  assert(
    html.includes('metro-docs-explain-golden'),
    'index.html missing docs explain golden source id',
  );
  assert(
    html.includes('metro-docs-explain-input-normalize-golden'),
    'index.html missing input normalize docs explain golden source id',
  );
  assert(
    html.includes('metro-docs-explain-install-troubleshooting-golden'),
    'index.html missing install troubleshooting docs explain golden source id',
  );
  assert(
    html.includes('metro docs explain install.troubleshooting --json'),
    'index.html missing install troubleshooting docs explain command',
  );
  assert(
    html.includes('metro-docs-explain-package-publish-readiness-golden'),
    'index.html missing package publish readiness docs explain golden source id',
  );
  assert(
    html.includes('metro-release-readiness-golden'),
    'index.html missing release readiness golden source id',
  );
  assert(
    html.includes('metro-release-artifact-manifest-golden'),
    'index.html missing release artifact manifest golden source id',
  );
  assert(
    html.includes('metro-release-evidence-plan-golden'),
    'index.html missing release evidence-plan golden source id',
  );
  assert(
    html.includes('metro-release-evidence-check-golden'),
    'index.html missing release evidence-check golden source id',
  );
  assert(
    html.includes('metro-release-retention-policy-golden'),
    'index.html missing release retention-policy golden source id',
  );
  assert(
    html.includes('metro release readiness --json'),
    'index.html missing release readiness command',
  );
  assert(
    html.includes('metro release artifact-manifest --json'),
    'index.html missing release artifact manifest command',
  );
  assert(
    html.includes('metro release retention-policy template --json'),
    'index.html missing release retention-policy template command',
  );
  assert(
    html.includes('metro release retention-policy validate --file'),
    'index.html missing release retention-policy validate command',
  );
  assert(
    html.includes('metro release evidence-plan --policy'),
    'index.html missing release evidence-plan command',
  );
  assert(
    html.includes('metro release evidence-check --dir'),
    'index.html missing release evidence-check command',
  );
  assert(
    html.includes('metro docs explain package.publish-readiness --json'),
    'index.html missing package publish readiness docs explain command',
  );
  assert(
    html.includes('metro-docs-explain-setup-troubleshooting-golden'),
    'index.html missing setup troubleshooting docs explain golden source id',
  );
  assert(
    html.includes('metro docs explain setup.troubleshooting --json'),
    'index.html missing setup troubleshooting docs explain command',
  );
  assert(
    html.includes('metro-docs-explain-output-anatomy-golden'),
    'index.html missing output anatomy docs explain golden source id',
  );
  assert(
    html.includes('metro-docs-explain-refusal-troubleshooting-golden'),
    'index.html missing refusal troubleshooting docs explain golden source id',
  );
  assert(
    html.includes('metro docs explain refusal.troubleshooting --json'),
    'index.html missing refusal troubleshooting docs explain command',
  );
  assert(
    html.includes('metro-docs-explain-topic-index-golden'),
    'index.html missing docs explain topic index golden source id',
  );
  assert(
    html.includes('metro-docs-explain-reference-html'),
    'index.html missing docs explain reference HTML source id',
  );
  assert(
    html.includes('metro-docs-explain-reference-page'),
    'index.html missing docs explain reference page source id',
  );
  assert(
    html.includes('metro-input-normalize-shape-golden'),
    'index.html missing input normalize shape golden source id',
  );
  assert(
    html.includes('metro-input-normalize-api-golden'),
    'index.html missing input normalize API golden source id',
  );
  assert(
    html.includes('metro-docs-explain-contract-overrides-golden'),
    'index.html missing contract override docs explain golden source id',
  );
  assert(
    html.includes('metro-docs-explain-product-rate-retirement-readback-golden'),
    'index.html missing product rate retirement readback docs explain golden source id',
  );
  assert(html.includes('metro api read-plan contracts.get.v2'), 'index.html missing api read-plan command');
  assert(installHtml.includes('metro api read-plan contracts.get.v2'), 'install.html missing api read-plan command');
  assert(
    commandReferenceHtml.includes('metro api read-plan &lt;endpoint-id&gt; --file &lt;request.json|yaml&gt; (--sandbox|--prod) [--json]'),
    'command-reference.html missing api read-plan command',
  );
  assert(html.includes('metro api read-preflight contracts.get.v2'), 'index.html missing api read-preflight command');
  assert(
    commandReferenceHtml.includes('metro api read-preflight &lt;endpoint-id&gt; --file &lt;request.json|yaml&gt; (--sandbox|--prod) [--read-gate &lt;api-read-gate.json&gt;] [--confirm-live-read &lt;token&gt;] [--json]'),
    'command-reference.html missing api read-preflight command',
  );
  assert(
    html.includes('metro-api-read-preflight-golden'),
    'index.html missing api read-preflight golden source id',
  );
  assert(
    commandReferenceHtml.includes('metro api read-gate template --read-plan &lt;api-read-plan.json&gt; [--profile-resolution &lt;profile-resolution.json&gt;]'),
    'command-reference.html missing api read-gate template command',
  );
  assert(
    apiReferenceHtml.includes('tenant-profile-resolution-file-hash'),
    'api-reference.html missing profile-resolution evidence requirement',
  );
  assert(
    html.includes('metro api preflight template --preview api-preview.json --profile-resolution profile-resolution.json --json'),
    'index.html missing api preflight profile-resolution command',
  );
  assert(
    commandReferenceHtml.includes('metro api preflight template --preview &lt;api-preview.json&gt; [--profile-resolution &lt;profile-resolution.json&gt;]'),
    'command-reference.html missing api preflight profile-resolution flag',
  );
  assert(
    commandReferenceHtml.includes('metro api sandbox-proof template --preview &lt;api-preview.json&gt; --preflight &lt;api-preflight.json&gt; [--reviewed-by &lt;reviewer&gt;]'),
    'command-reference.html missing api sandbox-proof reviewed-by flag',
  );
  assert(
    commandReferenceHtml.includes('metro api apply-gate template --preview &lt;api-preview.json&gt; --preflight &lt;api-preflight.json&gt; [--sandbox-proof &lt;sandbox-proof.json&gt;] [--profile-resolution &lt;profile-resolution.json&gt;]'),
    'command-reference.html missing api apply-gate profile-resolution flag',
  );
  assert(
    commandReferenceHtml.includes('metro api approval-record template --apply-gate &lt;api-apply-gate.json&gt;'),
    'command-reference.html missing api approval-record template command',
  );
  assert(
    commandReferenceHtml.includes('metro api approval-record validate --file &lt;api-approval-record.json&gt;'),
    'command-reference.html missing api approval-record validate command',
  );
  assert(
    commandReferenceHtml.includes('metro api apply-audit template --approval-record &lt;api-approval-record.json&gt;'),
    'command-reference.html missing api apply-audit template command',
  );
  assert(
    commandReferenceHtml.includes('metro api apply-audit write --approval-record &lt;api-approval-record.json&gt; --out &lt;api-apply-audit.jsonl&gt; --actor &lt;id&gt; (--dry-run|--write)'),
    'command-reference.html missing api apply-audit write command',
  );
  assert(
    commandReferenceHtml.includes('metro api apply-audit validate --file &lt;api-apply-audit.jsonl&gt;'),
    'command-reference.html missing api apply-audit validate command',
  );
  assert(
    commandReferenceHtml.includes('metro apply-readback verify --audit &lt;audit.jsonl&gt; (--inspect-output &lt;inspect-output.json&gt;|--inspect-outputs &lt;inspect-output-a.json,inspect-output-b.json&gt;)'),
    'command-reference.html missing workflow apply-readback verify command',
  );
  assert(
    commandReferenceHtml.includes('Production gates bind sandbox proof by reviewed endpoint id and request hash while binding approval to the production preview hash.'),
    'command-reference.html missing production sandbox-proof request-hash binding description',
  );
  assert(
    html.includes('metro-api-preflight-profile-resolution-fixture'),
    'index.html missing api preflight profile-resolution source id',
  );
  assert(
    html.includes('metro-api-profile-resolution-helper'),
    'index.html missing shared profile-resolution helper source id',
  );
  assert(
    commandReferenceHtml.includes('metro api read-gate validate --file &lt;api-read-gate.json&gt; [--json]'),
    'command-reference.html missing api read-gate validate command',
  );
  assert(
    commandReferenceHtml.includes('metro api read-mock &lt;endpoint-id&gt; --file &lt;request.json|yaml&gt; --read-gate &lt;api-read-gate.json&gt; --mock-response &lt;response-data.json&gt;'),
    'command-reference.html missing api read-mock command',
  );
  assert(
    commandReferenceHtml.includes('metro api read-result verify --file &lt;api-read-result.json&gt; [--json]'),
    'command-reference.html missing api read-result verify command',
  );
  assert(
    commandReferenceHtml.includes('metro api read-audit template --read-gate &lt;api-read-gate.json&gt; --read-result &lt;api-read-result.json&gt;'),
    'command-reference.html missing api read-audit template command',
  );
  assert(
    commandReferenceHtml.includes('metro api read-audit write --read-gate &lt;api-read-gate.json&gt; --read-result &lt;api-read-result.json&gt; --out &lt;api-read-audit.jsonl&gt; --actor &lt;id&gt; (--dry-run|--write)'),
    'command-reference.html missing api read-audit write command',
  );
  assert(
    commandReferenceHtml.includes('metro api read-audit validate --file &lt;api-read-audit.jsonl&gt; [--json]'),
    'command-reference.html missing api read-audit validate command',
  );
  assert(
    commandReferenceHtml.includes('metro setup resolve --file &lt;profiles.json&gt; --profile &lt;name&gt; --key-fingerprint &lt;fingerprint&gt; [--expect-tenant &lt;tenant&gt;] [--check-env] [--json]'),
    'command-reference.html missing setup resolve command',
  );
  assert(
    commandReferenceHtml.includes('metro setup quickstart [--json|--shell]'),
    'command-reference.html missing setup quickstart command',
  );
  assert(
    commandReferenceHtml.includes('metro rate-card dimensional preview --file &lt;input.json|yaml&gt; (--sandbox|--prod) [--shape dimensional-rate-card] [--json]'),
    'command-reference.html missing dimensional rate-card preview command',
  );
  assert(
    commandReferenceHtml.includes('metro rate-card dimensional apply --file &lt;input.json|yaml&gt; (--sandbox|--prod) --confirm-hash &lt;hash&gt;'),
    'command-reference.html missing dimensional rate-card apply refusal command',
  );
  assert(
    commandReferenceHtml.includes('metro api read &lt;endpoint-id&gt; --file &lt;request.json|yaml&gt; (--sandbox|--prod) --read-gate &lt;api-read-gate.json&gt; --confirm-live-read &lt;token&gt; [--json]'),
    'command-reference.html missing endpoint-aware api read refusal command',
  );
  assert(
    commandReferenceHtml.includes('<nav class="reference-jumps" aria-label="Command reference sections">'),
    'command-reference.html missing page index navigation',
  );
  assert(commandReferenceHtml.includes('<strong>Page index</strong>'), 'command-reference.html missing page index label');
  for (const href of [
    '#command-summary',
    '#supported-local-commands',
    '#unsupported-commands',
  ]) {
    assert(commandReferenceHtml.includes(`href="${href}"`), `command-reference.html missing page index link: ${href}`);
  }
  assert(commandReferenceHtml.includes('id="command-summary"'), 'command-reference.html missing command summary anchor');
  assert(commandReferenceHtml.includes('id="supported-local-commands"'), 'command-reference.html missing supported local commands anchor');
  assert(commandReferenceHtml.includes('id="unsupported-commands"'), 'command-reference.html missing unsupported commands anchor');
  assertReferencePageIndex(
    currentShapeReference,
    shapeReferenceHtml,
    'Shape reference sections',
    ['shape-summary', 'shape-catalog'],
    'shape reference',
  );
  assertReferencePageIndex(
    currentValidatorReference,
    validatorReferenceHtml,
    'Validator reference sections',
    ['validator-summary', 'validator-rules'],
    'validator reference',
  );
  assertReferencePageIndex(
    currentGotchaReference,
    gotchaReferenceHtml,
    'Gotcha reference sections',
    ['gotcha-summary', 'gotcha-coverage'],
    'gotcha reference',
  );
  assertReferencePageIndex(
    currentEvidenceGateReference,
    evidenceGateReferenceHtml,
    'Evidence gate reference sections',
    ['evidence-gate-summary', 'evidence-gates'],
    'evidence gate reference',
  );
  assertReferencePageIndex(
    currentInputReference,
    inputReferenceHtml,
    'Input reference sections',
    ['input-summary', 'supported-formats', 'normalization-contract', 'secret-scan'],
    'input reference',
  );
  assert(inputReferenceHtml.includes('Metronome CLI input reference'), 'input-reference.html missing page title');
  assert(inputReferenceHtml.includes('metro.input.normalize.v1'), 'input-reference.html missing normalize schema version');
  assert(inputReferenceHtml.includes('supported-subset'), 'input-reference.html missing YAML subset status');
  assert(inputReferenceHtml.includes('MTR-SECRET-001'), 'input-reference.html missing secret-scan rule');
  assert(inputReferenceHtml.includes('normalizedHash'), 'input-reference.html missing normalized hash field');
  assert(shapeReferenceHtml.includes('dimensional-rate-card'), 'shape-reference.html missing dimensional rate-card shape');
  assert(validatorReferenceHtml.includes('MTR-RATE-005'), 'validator-reference.html missing dimensional rate-card validator rule');
  assert(gotchaReferenceHtml.includes('dimensional-metric-compound-group-key'), 'gotcha-reference.html missing dimensional metric group-key gotcha');
  assert(gotchaReferenceHtml.includes('dimensional-one-product-not-per-action'), 'gotcha-reference.html missing dimensional one-product gotcha');
  assert(apiReferenceHtml.includes('<h2>Approval policies</h2>'), 'api-reference.html missing approval policies section');
  assert(apiReferenceHtml.includes('<nav class="reference-jumps" aria-label="API reference sections">'), 'api-reference.html missing page index navigation');
  assert(apiReferenceHtml.includes('<strong>Page index</strong>'), 'api-reference.html missing page index label');
  assert(apiReferenceHtml.includes('href="#write-proof-ladder"'), 'api-reference.html missing write proof ladder page-index link');
  assert(apiReferenceHtml.includes('Ordered request-validation through apply-result evidence'), 'api-reference.html missing write proof ladder page-index description');
  assert(apiReferenceHtml.includes('<h2>Read endpoint readiness</h2>'), 'api-reference.html missing read endpoint readiness section');
  assert(apiReferenceHtml.includes('<h2>Write endpoint gate readiness</h2>'), 'api-reference.html missing write endpoint gate readiness section');
  assert(
    apiReferenceHtml.includes(`<span>Reviewed endpoints</span><strong>${currentApiReference.endpointCount}</strong>`),
    'api-reference.html summary grid endpoint count is stale',
  );
  assert(
    apiReferenceHtml.includes(`<span>Operation types</span><strong>preview: ${currentApiReference.operationTypes.preview}, read: ${currentApiReference.operationTypes.read}, write: ${currentApiReference.operationTypes.write}</strong>`),
    'api-reference.html summary grid operation types are stale',
  );
  assert(
    apiReferenceHtml.includes(`<span>Read readiness</span><strong>full-local-read-evidence: ${currentApiReference.readReadiness.readEndpointCount}</strong>`),
    'api-reference.html summary grid read readiness count is stale',
  );
  assert(apiReferenceHtml.includes('<nav class="reference-jumps" aria-label="API reference sections">'), 'api-reference.html missing reference jump navigation');
  for (const href of [
    '#families',
    '#permission-scopes',
    '#approval-policies',
    '#read-endpoint-readiness',
    '#write-proof-ladder',
    '#write-endpoint-coverage',
    '#endpoint-contracts',
  ]) {
    assert(apiReferenceHtml.includes(`href="${href}"`), `api-reference.html missing reference jump link: ${href}`);
  }
  assert(apiReferenceHtml.includes('id="families"'), 'api-reference.html missing families anchor');
  assert(apiReferenceHtml.includes('id="permission-scopes"'), 'api-reference.html missing permission scopes anchor');
  assert(apiReferenceHtml.includes('id="approval-policies"'), 'api-reference.html missing approval policies anchor');
  assert(apiReferenceHtml.includes('id="read-endpoint-readiness"'), 'api-reference.html missing read endpoint readiness anchor');
  assert(apiReferenceHtml.includes('id="write-endpoint-coverage"'), 'api-reference.html missing write endpoint coverage anchor');
  assert(apiReferenceHtml.includes('id="endpoint-contracts"'), 'api-reference.html missing endpoint contracts anchor');
  assert(apiReferenceHtml.includes('id="write-endpoint-gate-readiness"'), 'api-reference.html missing write endpoint readiness anchor');
  assert(apiReferenceHtml.includes('<h3 id="write-proof-ladder">Write proof ladder</h3>'), 'api-reference.html missing write proof ladder anchor');
  assert(
    apiReferenceHtml.indexOf('id="write-endpoint-gate-readiness"') < apiReferenceHtml.indexOf('id="write-proof-ladder"')
      && apiReferenceHtml.indexOf('id="write-proof-ladder"') < apiReferenceHtml.indexOf('id="write-endpoint-coverage"'),
    'api-reference.html write coverage anchors must stay inside the write readiness section',
  );
  assert(apiReferenceHtml.includes('<th>Order</th>'), 'api-reference.html missing write proof ladder order column');
  assert(apiReferenceHtml.includes('<th>Unlocks</th>'), 'api-reference.html missing write proof ladder unlock column');
  assert(apiReferenceHtml.includes('<td>1</td><td><code>request-validation</code></td>'), 'api-reference.html missing write proof ladder first step');
  assert(apiReferenceHtml.includes('<td>9</td><td><code>api-apply-result</code></td>'), 'api-reference.html missing write proof ladder final step');
  assert(apiReferenceHtml.includes('future-guarded-apply-runner-only'), 'api-reference.html missing future guarded runner unlock boundary');
  assert(apiReferenceHtml.includes('Every ladder step keeps API access, live execution, and apply disabled in the current CLI.'), 'api-reference.html missing local-only ladder explanation');
  assert(html.includes('Expert API write proof ladder'), 'index.html missing expert API write proof ladder quick path');
  assert(html.includes('href="api-reference.html#write-proof-ladder"'), 'index.html missing anchored write proof ladder link');
  assert(html.includes('Open write proof ladder'), 'index.html missing write proof ladder link text');
  assert(html.includes('request validation through apply-result evidence'), 'index.html missing write proof ladder sequence summary');
  assert(html.includes('future guarded apply runner'), 'index.html missing guarded apply runner boundary summary');
  assert(html.includes('Sandbox <code>contracts.create</code> uses the guarded apply runner today'), 'index.html missing write proof ladder live-guarded apply summary');
  assert(apiReferenceHtml.includes('<h3>Family coverage</h3>'), 'api-reference.html missing readiness family coverage table');
  assert(apiReferenceHtml.includes('<h3>Endpoint coverage</h3>'), 'api-reference.html missing readiness endpoint coverage table');
  assert(apiReferenceHtml.includes('<th>Persisted audits</th>'), 'api-reference.html missing persisted audit family coverage column');
  assert(apiReferenceHtml.includes('<td><code>rate-cards</code></td><td>4</td><td>4/4</td><td>4/4</td><td>4/4</td><td>4/4</td><td>4/4</td>'), 'api-reference.html missing complete rate-card readiness family row');
  assert(apiReferenceHtml.includes('<th>Write endpoints</th>'), 'api-reference.html missing write readiness endpoint column');
  assert(apiReferenceHtml.includes('<th>Sandbox proofs</th>'), 'api-reference.html missing sandbox-proof family coverage column');
  assert(apiReferenceHtml.includes('sandbox-proof request-hash binding'), 'api-reference.html missing sandbox-proof request-hash binding summary');
  assert(apiReferenceHtml.includes('sandbox-proof-request-hash-binding'), 'api-reference.html missing sandbox-proof request-hash binding evidence requirement');
  assert(apiReferenceHtml.includes('<td><code>contracts</code></td><td>4</td><td>4/4</td><td>4/4</td><td>4/4</td><td>4/4</td><td>4/4</td><td>4/4</td><td>4/4</td><td>4/4</td>'), 'api-reference.html missing complete contract write readiness family row');
  assert(apiReferenceHtml.includes('<td><code>rate-cards</code></td><td>5</td><td>5/5</td><td>5/5</td><td>5/5</td><td>5/5</td><td>5/5</td><td>5/5</td><td>5/5</td><td>5/5</td>'), 'api-reference.html missing complete rate-card write readiness family row');
  assert(apiReferenceHtml.includes('<h3>API approval record</h3>'), 'api-reference.html missing API approval record sections');
  assert(apiReferenceHtml.includes('metro api approval-record template'), 'api-reference.html missing api approval-record template command text');
  assert(apiReferenceHtml.includes('metro api approval-record validate'), 'api-reference.html missing api approval-record validate command text');
  assert(apiReferenceHtml.includes('local-approval-record'), 'api-reference.html missing local approval-record support status');
  assert(apiReferenceHtml.includes('validated-apply-gate-file-hash'), 'api-reference.html missing approval-record apply-gate hash evidence requirement');
  assert(apiReferenceHtml.includes('current-turn-authorization-still-required'), 'api-reference.html missing approval-record current-turn authorization evidence requirement');
  assert(apiReferenceHtml.includes('<h3>API apply audit</h3>'), 'api-reference.html missing API apply audit sections');
  assert(apiReferenceHtml.includes('metro api apply-audit template'), 'api-reference.html missing api apply-audit template command text');
  assert(apiReferenceHtml.includes('metro api apply-audit write'), 'api-reference.html missing api apply-audit write command text');
  assert(apiReferenceHtml.includes('metro api apply-audit validate'), 'api-reference.html missing api apply-audit validate command text');
  assert(apiReferenceHtml.includes('local-planned-apply-audit'), 'api-reference.html missing local planned apply-audit support status');
  assert(apiReferenceHtml.includes('validated-approval-record-file-hash'), 'api-reference.html missing apply-audit approval-record hash evidence requirement');
  assert(apiReferenceHtml.includes('<h3>API apply read-back</h3>'), 'api-reference.html missing API apply read-back sections');
  assert(apiReferenceHtml.includes('metro api apply-readback verify'), 'api-reference.html missing api apply-readback verify command text');
  assert(apiReferenceHtml.includes('local-apply-readback-verifier'), 'api-reference.html missing local apply-readback verifier support status');
  assert(apiReferenceHtml.includes('validated-apply-audit-jsonl'), 'api-reference.html missing apply-readback apply-audit evidence requirement');
  assert(apiReferenceHtml.includes('compatible-read-back-endpoint'), 'api-reference.html missing apply-readback compatibility evidence requirement');
  assert(apiReferenceHtml.includes('Allowed read-back endpoints'), 'api-reference.html missing apply-readback allowed endpoint list');
  assert(apiReferenceHtml.includes('<li><code>contracts.get.v2</code></li>'), 'api-reference.html missing contracts.get.v2 apply-readback compatibility endpoint');
  assert(apiReferenceHtml.includes('semantic-apply-success-not-proven'), 'api-reference.html missing apply-readback non-success evidence requirement');
  assert(apiReferenceHtml.includes('<h3>API apply result</h3>'), 'api-reference.html missing API apply result sections');
  assert(apiReferenceHtml.includes('metro api apply-result template'), 'api-reference.html missing api apply-result template command text');
  assert(apiReferenceHtml.includes('metro api apply-result validate'), 'api-reference.html missing api apply-result validate command text');
  assert(apiReferenceHtml.includes('local-apply-result-contract'), 'api-reference.html missing local apply-result support status');
  assert(apiReferenceHtml.includes('current-turn-authorization-captured-at-execution'), 'api-reference.html missing apply-result authorization evidence requirement');
  assert(apiReferenceHtml.includes('semantic-read-back-success'), 'api-reference.html missing apply-result semantic read-back evidence requirement');
  assert(apiReferenceHtml.includes('metro api sandbox-proof template'), 'api-reference.html missing api sandbox-proof command text');
  assert(apiReferenceHtml.includes('metro api readiness --summary --json'), 'api-reference.html missing compact api readiness command text');
  assert(apiReferenceHtml.includes('metro api readiness --json'), 'api-reference.html missing full api readiness command text');
  assert(apiReferenceHtml.includes('full-local-read-evidence'), 'api-reference.html missing full local read evidence status');
  assert(apiReferenceHtml.includes('local-write-proof-ladder-mapped'), 'api-reference.html missing local write proof ladder status');
  assert(apiReferenceHtml.includes('metro api read-mock'), 'api-reference.html missing api read-mock command text');
  assert(apiReferenceHtml.includes('metro api read-pipeline'), 'api-reference.html missing api read-pipeline command text');
  assert(apiReferenceHtml.includes('<code>customers.get</code>'), 'api-reference.html missing customers.get endpoint');
  assert(apiReferenceHtml.includes('<code>customers.list</code>'), 'api-reference.html missing customers.list endpoint');
  assert(apiReferenceHtml.includes('<code>contracts.list.v2</code>'), 'api-reference.html missing contracts.list.v2 endpoint');
  assert(apiReferenceHtml.includes('<code>contracts.getRateSchedule</code>'), 'api-reference.html missing contracts.getRateSchedule endpoint');
  assert(apiReferenceHtml.includes('<code>customerBalances.list</code>'), 'api-reference.html missing customerBalances.list endpoint');
  assert(apiReferenceHtml.includes('<code>seatBalances.list</code>'), 'api-reference.html missing seatBalances.list endpoint');
  assert(apiReferenceHtml.includes('<code>commits.list</code>'), 'api-reference.html missing commits.list endpoint');
  assert(apiReferenceHtml.includes('<code>credits.list</code>'), 'api-reference.html missing credits.list endpoint');
  assert(apiReferenceHtml.includes('metro api read-result verify'), 'api-reference.html missing api read-result verify command text');
  assert(apiReferenceHtml.includes('metro api read-audit validate'), 'api-reference.html missing api read-audit validate command text');
  assert(apiReferenceHtml.includes('<h3>Side-effect profile</h3>'), 'api-reference.html missing side-effect profile sections');
  assert(apiReferenceHtml.includes('blocked-until-apply-runner'), 'api-reference.html missing blocked apply-runner status');
  assert(html.includes('Expert API read-plan matrix'), 'index.html missing read-plan proof matrix card');
  assert(html.includes('Expert API read result'), 'index.html missing read-result proof card');
  assert(html.includes('Expert API read refusal'), 'index.html missing read-refusal proof card');
  assert(html.includes('Expert API read mock'), 'index.html missing read-mock proof card');
  assert(html.includes('Expert API read pipeline'), 'index.html missing read-pipeline proof card');
  assert(html.includes('Expert API read audit'), 'index.html missing read-audit proof card');
  assert(html.includes('Dimensional rate-card preview'), 'index.html missing dimensional rate-card shape card');
  assert(html.includes('MTR-RATE-005'), 'index.html missing dimensional rate-card validator card');
  assert(html.includes('metro.js api read contracts.get.v2'), 'index.html missing api read refusal command');
  assert(html.includes('metro api read-mock'), 'index.html missing api read-mock command');
  assert(html.includes('metro api read-pipeline'), 'index.html missing api read-pipeline command');
  assert(
    html.includes('Evidence gate path for preview-only writes'),
    'index.html missing preview-only evidence gate path section',
  );
  assert(
    html.includes('evidence-gate-reference.html'),
    'index.html missing generated evidence gate reference page link',
  );
  assert(
    planningReadme.includes('site/evidence-gate-reference.html'),
    'planning README missing generated evidence gate reference page link',
  );
  assert(
    planningReadme.includes('metro.js docs evidence-gate-reference --json'),
    'planning README missing evidence gate reference CLI command',
  );
  assert(
    packageReadme.includes('metro docs evidence-gate-reference --json'),
    'package README missing evidence gate reference CLI command',
  );
  assert(
    evidenceGateReferenceHtml.includes('Metronome CLI evidence gate reference'),
    'evidence-gate-reference.html missing page title',
  );
  assert(
    evidenceGateReferenceHtml.includes('full-local-template-path'),
    'evidence-gate-reference.html missing full local template status',
  );
  assert(
    evidenceGateReferenceHtml.includes(`<span>Preflight-only</span><strong>${currentEvidenceGateReference.summary.preflightOnly}</strong>`),
    'evidence-gate-reference.html missing preflight-only summary count',
  );
  assert(
    evidenceGateReferenceHtml.includes('usage.ingest-preview'),
    'evidence-gate-reference.html missing usage ingest workflow',
  );
  assert(
    evidenceGateReferenceHtml.includes('complimentary-credit-grant'),
    'evidence-gate-reference.html missing complimentary credit grant shape',
  );
  assert(
    evidenceGateReferenceHtml.includes('live execution enabled: no'),
    'evidence-gate-reference.html must keep live execution disabled',
  );
  assert(
    html.includes('metro preflight template --workflow usage.ingest-preview --shape usage-ingest-preview --prod --json'),
    'index.html missing usage ingest preflight template evidence command',
  );
  assert(
    html.includes('metro audit template --workflow usage.ingest-preview --shape usage-ingest-preview --prod --json'),
    'index.html missing usage ingest audit template evidence command',
  );
  assert(
    html.includes('metro proof sandbox-template --workflow usage.ingest-preview --shape usage-ingest-preview --json'),
    'index.html missing usage ingest sandbox proof template evidence command',
  );
  assert(
    html.includes('metro apply-gate template --workflow usage.ingest-preview --shape usage-ingest-preview --prod --json'),
    'index.html missing usage ingest apply-gate template evidence command',
  );
  assert(
    html.includes('metro apply-gate validate --file &lt;apply-gate.json&gt; --json'),
    'index.html missing usage ingest apply-gate validation evidence command',
  );
  assert(
    html.includes('This is local evidence only; it does not authorize live'),
    'index.html missing local-only evidence gate refusal language',
  );
  assert(
    html.includes('Dry-run goldens cover all reviewed read endpoints'),
    'index.html missing full read-pipeline proof coverage text',
  );
  assertTextIncludesAll(html, [
    'local mocked expert API read pipeline',
    'event-search POST body',
    'billing-provider POST body',
    'billable-metric GET path/query',
    'product catalog POST body/query pagination',
    'rate-card metadata POST body',
    'rate-card list POST query',
    'rate-card getRates POST body/query pagination',
    'customer GET path/query',
    'contract-list POST body',
    'contract rate-schedule POST body/query pagination',
    'customer-balance POST body',
    'seat-balance POST body',
    'commit-list POST body',
    'credit-list POST body',
    'usage-groups POST body/query pagination',
    'usage-batch POST body/query pagination',
    'paginated list request summaries',
  ], 'index.html read-mock proof coverage text');
  assert(html.includes('metro api read-result verify'), 'index.html missing api read-result verify command');
  assert(html.includes('metro api read-audit write'), 'index.html missing api read-audit write command');
  assert(html.includes('metro api read-audit validate'), 'index.html missing api read-audit validate command');
  assert(
    html.includes('products.get product state readback'),
    'index.html missing products.get read-audit validation proof text',
  );
  assert(
    html.includes('products.list catalog pagination'),
    'index.html missing products.list read-audit validation proof text',
  );
  assert(
    html.includes('contracts.list.v2 customer contract list'),
    'index.html missing contracts.list.v2 read-audit validation proof text',
  );
  assert(
    html.includes('invoices.get invoice readback'),
    'index.html missing invoices.get read-audit validation proof text',
  );
  assert(
    html.includes('invoices.listForCustomer invoice inventory'),
    'index.html missing invoices.listForCustomer read-audit validation proof text',
  );
  assert(
    html.includes('packages.get package readback'),
    'index.html missing packages.get read-audit validation proof text',
  );
  assert(
    html.includes('packages.list package catalog pagination'),
    'index.html missing packages.list read-audit validation proof text',
  );
  assert(
    html.includes('rateCards.get metadata readback'),
    'index.html missing rateCards.get read-audit validation proof text',
  );
  assert(
    html.includes('rateCards.list catalog pagination'),
    'index.html missing rateCards.list read-audit validation proof text',
  );
  assert(
    html.includes('rateCards.getRates product/rate readback'),
    'index.html missing rateCards.getRates read-audit validation proof text',
  );
  assert(
    html.includes('rateCards.getRateSchedule scheduled rate-card readback'),
    'index.html missing rateCards.getRateSchedule read-audit validation proof text',
  );
  assert(
    html.includes('read-plan, read-mock, read-pipeline, and persisted read-audit coverage by endpoint family'),
    'index.html missing endpoint-family readiness proof text',
  );
  assert(
    html.includes('events.search event lookup'),
    'index.html missing events.search read-audit validation proof text',
  );
  assert(
    html.includes('usage.groups grouped usage readback'),
    'index.html missing usage.groups read-audit validation proof text',
  );
  assert(
    html.includes('usage.batch usage window readback'),
    'index.html missing usage.batch read-audit validation proof text',
  );
  assert(
    html.includes('billableMetrics.get metric configuration readback'),
    'index.html missing billableMetrics.get read-audit validation proof text',
  );
  assert(
    html.includes('billableMetrics.list metric catalog pagination'),
    'index.html missing billableMetrics.list read-audit validation proof text',
  );
  assertTextIncludesAll(html, [
    'all reviewed read endpoint goldens',
    'billable-metric GET path/query coverage',
    'product-list POST body/query placement',
    'rate-card metadata/list/getRates coverage',
    'customer GET path/query',
    'contract-list POST body',
    'contract rate-schedule POST body/query pagination',
    'customer-balance POST body',
    'seat-balance POST body',
    'commit-list POST body',
    'credit-list POST body',
    'usage-groups POST body/query pagination',
    'usage-batch POST body/query pagination',
    'blocked invalid usage-groups and usage-batch query/body placement',
  ], 'index.html read-plan proof matrix coverage text');
  for (const sourceId of [
    'metro-api-read-plan-golden-post-body',
    'metro-api-read-plan-golden-events-search',
    'metro-api-read-plan-golden-packages-get',
    'metro-api-read-plan-golden-packages-list',
    'metro-api-read-plan-golden-billing-provider-get',
    'metro-api-read-plan-golden-products-get',
    'metro-api-read-plan-golden-products-list',
    'metro-api-read-plan-golden-rate-cards-get',
    'metro-api-read-plan-golden-rate-cards-list',
    'metro-api-read-plan-golden-rate-cards-get-rates',
    'metro-api-read-plan-golden-rate-card-schedule',
    'metro-api-read-plan-golden-invoices-get',
    'metro-api-read-plan-golden-get-path-query',
    'metro-api-read-plan-golden-customers-get',
    'metro-api-read-plan-golden-customers-list',
    'metro-api-read-plan-golden-contracts-list',
    'metro-api-read-plan-golden-contracts-rate-schedule',
    'metro-api-read-plan-golden-customer-balances',
    'metro-api-read-plan-golden-seat-balances',
    'metro-api-read-plan-golden-commits-list',
    'metro-api-read-plan-golden-credits-list',
    'metro-api-read-plan-golden-usage-groups-post-body',
    'metro-api-read-plan-golden-usage-batch-post-body',
    'metro-api-read-plan-golden-blocked-invalid',
    'metro-api-read-plan-golden-usage-batch-blocked-invalid',
    'metro-api-read-result',
    'metro-api-profile-resolution-helper',
    'metro-api-read-gate-profile-resolution-fixture',
    'metro-api-read-result-fixture',
    'metro-api-read-result-golden',
    'metro-api-read-mock',
    'metro-api-read-mock-response-fixture',
    'metro-api-read-mock-golden',
    'metro-api-read-pipeline',
    'metro-api-read-pipeline-golden',
    'metro-api-read-pipeline-events-golden',
    'metro-api-read-pipeline-packages-golden',
    'metro-api-read-pipeline-billing-provider-golden',
    'metro-api-read-pipeline-invoices-golden',
    'metro-api-read-pipeline-customers-get-golden',
    'metro-api-read-pipeline-contracts-list-golden',
    'metro-api-read-pipeline-contracts-rate-schedule-golden',
    'metro-api-read-pipeline-customer-balances-golden',
    'metro-api-read-pipeline-seat-balances-golden',
    'metro-api-read-pipeline-commits-list-golden',
    'metro-api-read-pipeline-credits-list-golden',
    'metro-api-read-pipeline-packages-get-golden',
    'metro-api-read-pipeline-products-get-golden',
    'metro-api-read-pipeline-products-list-golden',
    'metro-api-read-pipeline-rate-cards-get-golden',
    'metro-api-read-pipeline-rate-cards-list-golden',
    'metro-api-read-pipeline-rate-cards-get-rates-golden',
    'metro-api-read-pipeline-rate-card-schedule-golden',
    'metro-api-read-pipeline-invoices-get-golden',
    'metro-api-read-pipeline-customers-list-golden',
    'metro-api-read-pipeline-usage-groups-golden',
    'metro-api-read-pipeline-usage-batch-golden',
    'metro-api-read-mock-contracts-list-gate-fixture',
    'metro-api-read-mock-contracts-list-response-fixture',
    'metro-api-read-mock-contracts-list-golden',
    'metro-api-read-mock-contracts-rate-schedule-gate-fixture',
    'metro-api-read-mock-contracts-rate-schedule-response-fixture',
    'metro-api-read-mock-contracts-rate-schedule-golden',
    'metro-api-read-mock-customer-balances-gate-fixture',
    'metro-api-read-mock-customer-balances-response-fixture',
    'metro-api-read-mock-customer-balances-golden',
    'metro-api-read-mock-seat-balances-gate-fixture',
    'metro-api-read-mock-seat-balances-response-fixture',
    'metro-api-read-mock-seat-balances-golden',
    'metro-api-read-mock-commits-list-gate-fixture',
    'metro-api-read-mock-commits-list-response-fixture',
    'metro-api-read-mock-commits-list-golden',
    'metro-api-read-mock-credits-list-gate-fixture',
    'metro-api-read-mock-credits-list-response-fixture',
    'metro-api-read-mock-credits-list-golden',
    'metro-api-read-mock-invoices-gate-fixture',
    'metro-api-read-mock-invoices-response-fixture',
    'metro-api-read-mock-invoices-golden',
    'metro-api-read-mock-billing-provider-gate-fixture',
    'metro-api-read-mock-billing-provider-response-fixture',
    'metro-api-read-mock-billing-provider-golden',
    'metro-api-read-mock-packages-gate-fixture',
    'metro-api-read-mock-packages-response-fixture',
    'metro-api-read-mock-packages-golden',
    'metro-api-read-mock-products-list-gate-fixture',
    'metro-api-read-mock-products-list-response-fixture',
    'metro-api-read-mock-products-list-golden',
    'metro-api-read-mock-rate-cards-get-gate-fixture',
    'metro-api-read-mock-rate-cards-get-response-fixture',
    'metro-api-read-mock-rate-cards-get-golden',
    'metro-api-read-mock-rate-cards-list-gate-fixture',
    'metro-api-read-mock-rate-cards-list-response-fixture',
    'metro-api-read-mock-rate-cards-list-golden',
    'metro-api-read-mock-rate-cards-get-rates-gate-fixture',
    'metro-api-read-mock-rate-cards-get-rates-response-fixture',
    'metro-api-read-mock-rate-cards-get-rates-golden',
    'metro-api-read-mock-usage-gate-fixture',
    'metro-api-read-mock-usage-response-fixture',
    'metro-api-read-mock-usage-golden',
    'metro-api-read-mock-usage-batch-gate-fixture',
    'metro-api-read-mock-usage-batch-response-fixture',
    'metro-api-read-mock-usage-batch-golden',
    'metro-api-read-mock-events-gate-fixture',
    'metro-api-read-mock-events-response-fixture',
    'metro-api-read-mock-events-golden',
    'metro-api-read-mock-customers-get-gate-fixture',
    'metro-api-read-mock-customers-get-response-fixture',
    'metro-api-read-mock-customers-get-golden',
    'metro-api-read-mock-customers-list-gate-fixture',
    'metro-api-read-mock-customers-list-response-fixture',
    'metro-api-read-mock-customers-list-golden',
    'metro-api-read-refusal',
    'metro-api-read-refusal-golden',
    'metro-api-read-audit',
    'metro-api-read-audit-write-golden',
    'metro-api-read-audit-fixture',
    'metro-api-read-audit-golden',
    'metro-api-read-audit-contracts-list-fixture',
    'metro-api-read-audit-contracts-list-golden',
    'metro-api-read-audit-contracts-rate-schedule-fixture',
    'metro-api-read-audit-contracts-rate-schedule-golden',
    'metro-api-read-audit-rate-cards-get-rates-fixture',
    'metro-api-read-audit-rate-cards-get-rates-golden',
    'metro-api-read-audit-rate-card-schedule-fixture',
    'metro-api-read-audit-rate-card-schedule-golden',
    'metro-api-read-audit-rate-cards-get-fixture',
    'metro-api-read-audit-rate-cards-get-golden',
    'metro-api-read-audit-rate-cards-list-fixture',
    'metro-api-read-audit-rate-cards-list-golden',
    'metro-api-read-audit-products-get-fixture',
    'metro-api-read-audit-products-get-golden',
    'metro-api-read-audit-products-list-fixture',
    'metro-api-read-audit-products-list-golden',
    'metro-api-read-audit-packages-get-fixture',
    'metro-api-read-audit-packages-get-golden',
    'metro-api-read-audit-packages-list-fixture',
    'metro-api-read-audit-packages-list-golden',
    'metro-api-read-audit-customers-get-fixture',
    'metro-api-read-audit-customers-get-golden',
    'metro-api-read-audit-customers-list-fixture',
    'metro-api-read-audit-customers-list-golden',
    'metro-api-read-audit-customer-balances-fixture',
    'metro-api-read-audit-customer-balances-golden',
    'metro-api-read-audit-seat-balances-fixture',
    'metro-api-read-audit-seat-balances-golden',
    'metro-api-read-audit-billing-provider-fixture',
    'metro-api-read-audit-billing-provider-golden',
    'metro-api-read-audit-invoices-get-fixture',
    'metro-api-read-audit-invoices-get-golden',
    'metro-api-read-audit-invoices-list-for-customer-fixture',
    'metro-api-read-audit-invoices-list-for-customer-golden',
    'metro-api-read-audit-commits-list-fixture',
    'metro-api-read-audit-commits-list-golden',
    'metro-api-read-audit-credits-list-fixture',
    'metro-api-read-audit-credits-list-golden',
    'metro-api-read-audit-events-search-fixture',
    'metro-api-read-audit-events-search-golden',
    'metro-api-read-audit-usage-groups-fixture',
    'metro-api-read-audit-usage-groups-golden',
    'metro-api-read-audit-usage-batch-fixture',
    'metro-api-read-audit-usage-batch-golden',
    'metro-api-read-audit-billable-metrics-get-fixture',
    'metro-api-read-audit-billable-metrics-get-golden',
    'metro-api-read-audit-billable-metrics-list-fixture',
    'metro-api-read-audit-billable-metrics-list-golden',
    'metro-usage-ingest-preflight-golden',
    'metro-usage-ingest-audit-golden',
    'metro-usage-ingest-proof-golden',
    'metro-usage-ingest-apply-gate-golden',
    'metro-evidence-gate-reference',
    'metro-evidence-gate-reference-html',
    'metro-evidence-gate-reference-golden',
    'metro-setup-resolve-golden',
    'metro-product-verify-golden',
    'metro-contract-verify-golden',
    'metro-invoice-verify-golden',
    'metro-api-apply-result',
    'metro-api-apply-result-golden',
  ]) {
    assert(html.includes(sourceId), `index.html proof section missing ${sourceId} source id`);
  }
  const workflowRailMatch = html.match(/<div class="workflow-rail"[\s\S]*?<\/div>/);
  assert(workflowRailMatch, 'index.html missing workflow rail');
  const workflowStageCount = (workflowRailMatch[0].match(/<span>/g) || []).length;
  assert(workflowStageCount === 6, `workflow rail expected 6 stages, found ${workflowStageCount}`);
  assert(
    styles.includes('grid-template-columns: repeat(6, minmax(0, 1fr));'),
    'styles.css workflow rail must keep six desktop columns for six stages',
  );

  const usedSourceIds = parseSourceIds(allPageHtml);
  for (const sourceId of usedSourceIds) {
    assert(sources[sourceId], `HTML references missing source id: ${sourceId}`);
  }

  for (const [sourceId, source] of Object.entries(sources)) {
    assert(source.title, `Source "${sourceId}" missing title`);
    assert(source.href, `Source "${sourceId}" missing href`);
    assert(Array.isArray(source.supports) && source.supports.length > 0, `Source "${sourceId}" missing supports list`);
    verifyLocalHref(sourceId, source.href);
  }

  assert(fs.existsSync(path.join(siteDir, 'nav.js')), 'site missing nav.js sidebar manifest');
  const navJs = read(path.join(siteDir, 'nav.js'));
  assert(navJs.includes('Why metro exists'), 'nav.js missing why-metro entry');
  assert(navJs.includes('Look up a customer'), 'nav.js missing customer look-up entry');
  assert(navJs.includes('Upstream Metronome changelog'), 'nav.js missing upstream changelog link');
  assert(navJs.includes('When work is thrashing'), 'nav.js missing promote-codebase entry');
  assert(navJs.includes('Agent harnessing guide'), 'nav.js missing agent harnessing link');
  assert(navJs.includes('Task recipes'), 'nav.js missing task recipes section');
  assert(navJs.includes('Common tasks'), 'nav.js missing common tasks section');
  assert(fs.existsSync(path.join(siteDir, 'metronome-upstream.html')), 'site missing metronome-upstream.html');
  assert(fs.existsSync(path.join(siteDir, 'metronome-upstream.json')), 'site missing metronome-upstream.json');
  assert(styles.includes('white-space: pre-wrap'), 'styles.css must wrap long pre lines (pre-wrap)');
  assert(styles.includes('.code-block'), 'styles.css missing .code-block wrapper for pinned Copy');
  assert(siteJs.includes("wrap.className = 'code-block'"), 'site.js must wrap pre in .code-block for pinned Copy');
  assert(siteJs.includes("pre.closest('.agent-prompt-card')"), 'site.js must skip duplicate Copy on agent-prompt-card');

  assert(styles.includes('.hero.hero-prose'), 'styles.css missing hero-prose single-column rule');
  assert(styles.includes('.manual-section > .terminal-contract'), 'styles.css missing full-bleed terminal-contract layout');
  assert(!styles.includes('flex: 0 0 178px'), 'styles.css must not pin terminal-contract label to 178px');
  assert(styles.includes('repeat(auto-fit, minmax(160px, 1fr))'), 'styles.css summary-grid must auto-fit long summary cards');
  assert(styles.includes('.table-wrap'), 'styles.css missing table-wrap');
  assert(styles.includes('overflow-x: auto'), 'styles.css tables need horizontal scroll inside table-wrap');
  assert(styles.includes('grid-template-columns: repeat(3, minmax(0, 1fr))'), 'styles.css workflow-rail should collapse to 3 cols mid-width');
  assert(styles.includes('minmax(0, 7.5rem) minmax(0, 1fr)'), 'styles.css agent-recipe-meta must not use a rigid 120px label column');

  const agentsHtmlForPromote = read(path.join(siteDir, 'agents.html'));
  assert(agentsHtmlForPromote.includes('hero-prose'), 'agents.html hero must use hero-prose (not homepage side rail)');
  assert(
    /hero-copy[\s\S]*terminal-contract[\s\S]*<\/div>\s*<\/section>/.test(agentsHtmlForPromote),
    'agents.html Agent contract must live inside hero-copy, not the hero side column',
  );
  assert(agentsHtmlForPromote.includes('id="promote-codebase"'), 'agents.html missing promote-codebase section');
  assert(agentsHtmlForPromote.includes('This can be faster'), 'agents.html missing promote-codebase prompt language');
  assert(
    agentsHtmlForPromote.includes('PROMOTE THE CODEBASE'),
    'agents.html system prompt must include promote-the-codebase rule',
  );

  for (const asset of [
    'styles.css',
    'layout.js',
    'site.js',
    'nav.js',
    'assets/favicon-dark.png',
    'assets/favicon-light.png',
  ]) {
    assert(fs.existsSync(path.join(siteDir, asset)), `Missing static asset: ${asset}`);
  }
  const verifiedLocalReferenceCount = htmlPagePaths.reduce((count, pagePath) => {
    return count + verifyHtmlLocalReferences(pagePath, read(pagePath));
  }, 0) + verifyCssLocalReferences(stylesPath, styles);

  const currentCommandReference = commandReference();
  assert(Array.isArray(currentCommandReference.sectionNavigation), 'command reference JSON missing section navigation');
  assert(
    JSON.stringify(currentCommandReference.sectionNavigation.map((section) => section.id)) === JSON.stringify([
      'command-summary',
      'supported-local-commands',
      'unsupported-commands',
    ]),
    'command reference section navigation ids mismatch',
  );
  assert(
    currentCommandReference.sectionNavigation.every((section) => section.href === `#${section.id}`),
    'command reference section navigation hrefs must match ids',
  );
  assertUnsupportedExpertApiLiveVerbs(currentCommandReference, commandReferenceHtml);
  const planningCorpus = `${planningReadme}\n${packageReadme}`;
  assertReadmeCatalogCommandCoverage(currentCommandReference, planningCorpus, packageReadme);
  assertReadmeBillableMetricWriteCoverage(planningCorpus, packageReadme);
  assertReadmeCustomFieldWriteCoverage(planningCorpus, packageReadme);
  assertReadmeRateCardArchiveCoverage(planningCorpus, packageReadme);
  assertRateCardFixtureBoundarySiteCoverage(html);
  assertCustomFieldFixtureBoundarySiteCoverage(html);
  assertReadmeProductArchiveCoverage(planningCorpus, packageReadme);
  assertReadmePackageWriteCoverage(planningCorpus, packageReadme);
  assertReadmeSecurityReadCoverage(planningCorpus, packageReadme);
  const expectedCommandReferenceHtml = renderCommandReferenceHtml(currentCommandReference);
  assert(commandReferenceHtml === expectedCommandReferenceHtml, 'command-reference.html is not current with metronome-cli/src/commands/catalog.js');
  assertReferencePageIndex(currentExplainReference, explainReferenceHtml, 'Docs explain reference sections', [
    'explain-summary',
    'operating-topics',
    'lookup-kinds',
    'source-boundary',
  ], 'docs explain reference');
  const expectedExplainReferenceHtml = renderExplainReferenceHtml(currentExplainReference);
  assert(explainReferenceHtml === expectedExplainReferenceHtml, 'explain-reference.html is not current with metronome-cli/src/docs/explain.js');
  assertApiReadPlanCoverage(currentApiReference, apiReferenceHtml);
  assertApiReadGateCoverage(currentApiReference, apiReferenceHtml);
  assertApiReadMockCoverage(currentApiReference, apiReferenceHtml);
  assertApiReadPipelineCoverage(currentApiReference, apiReferenceHtml);
  assertApiReadResultCoverage(currentApiReference, apiReferenceHtml);
  assertApiReadAuditCoverage(currentApiReference, apiReferenceHtml);
  assertInstallPathProfileResolutionCoverage(installHtml);
  assertInstallPathTerminalDocsHarnessCoverage(installHtml);
  assertSetupQuickstartGoldenCoverage();
  assertSetupResolveGoldenCoverage();
  assertInspectOutputVerificationCoverage();
  assertReadPlanGoldenCoverage();
  assertReadMockGoldenCoverage();
  assertReadAuditGoldenCoverage();
  assertReadinessGoldenCoverage();
  assertSideEffectProfileCoverage(currentApiReference, apiReferenceHtml);
  const expectedApiReferenceHtml = renderApiReferenceHtml(currentApiReference);
  assert(apiReferenceHtml === expectedApiReferenceHtml, 'api-reference.html is not current with metronome-cli/src/api-catalog/index.js');
  const expectedEvidenceGateReferenceHtml = renderEvidenceGateReferenceHtml(currentEvidenceGateReference);
  assert(evidenceGateReferenceHtml === expectedEvidenceGateReferenceHtml, 'evidence-gate-reference.html is not current with metronome-cli/src/docs/evidence-gate-reference.js');
  const expectedInputReferenceHtml = renderInputReferenceHtml(currentInputReference);
  assert(inputReferenceHtml === expectedInputReferenceHtml, 'input-reference.html is not current with metronome-cli/src/docs/input-reference.js');
  const expectedShapeReferenceHtml = renderShapeReferenceHtml(currentShapeReference);
  assert(shapeReferenceHtml === expectedShapeReferenceHtml, 'shape-reference.html is not current with metronome-cli/src/shapes/index.js');
  const expectedValidatorReferenceHtml = renderValidatorReferenceHtml(currentValidatorReference);
  assert(validatorReferenceHtml === expectedValidatorReferenceHtml, 'validator-reference.html is not current with metronome-cli/src/validators/rules.js');
  const expectedGotchaReferenceHtml = renderGotchaReferenceHtml(currentGotchaReference);
  assert(gotchaReferenceHtml === expectedGotchaReferenceHtml, 'gotcha-reference.html is not current with metronome-cli/src/docs/gotcha-reference.js');

  for (const [pageName, pageHtml] of Object.entries({
    'install.html': installHtml,
    'integration.html': integrationHtml,
    'command-reference.html': commandReferenceHtml,
    'explain-reference.html': explainReferenceHtml,
    'api-reference.html': apiReferenceHtml,
    'evidence-gate-reference.html': evidenceGateReferenceHtml,
    'input-reference.html': inputReferenceHtml,
    'shape-reference.html': shapeReferenceHtml,
    'validator-reference.html': validatorReferenceHtml,
    'gotcha-reference.html': gotchaReferenceHtml,
  })) {
    assert(pageHtml.includes('<script src="layout.js"></script>'), `${pageName} missing shared layout.js script`);
    assert(pageHtml.includes('<script src="nav.js"></script>'), `${pageName} missing shared nav.js script`);
    assert(pageHtml.includes('<script src="site.js"></script>'), `${pageName} missing shared site.js script`);
  }

  const forbidden = ['TODO', 'TBD'];
  for (const marker of forbidden) {
    assert(!html.includes(marker), `index.html contains unresolved marker: ${marker}`);
    assert(!installHtml.includes(marker), `install.html contains unresolved marker: ${marker}`);
    assert(!integrationHtml.includes(marker), `integration.html contains unresolved marker: ${marker}`);
    assert(!commandReferenceHtml.includes(marker), `command-reference.html contains unresolved marker: ${marker}`);
    assert(!explainReferenceHtml.includes(marker), `explain-reference.html contains unresolved marker: ${marker}`);
    assert(!apiReferenceHtml.includes(marker), `api-reference.html contains unresolved marker: ${marker}`);
    assert(!evidenceGateReferenceHtml.includes(marker), `evidence-gate-reference.html contains unresolved marker: ${marker}`);
    assert(!inputReferenceHtml.includes(marker), `input-reference.html contains unresolved marker: ${marker}`);
    assert(!shapeReferenceHtml.includes(marker), `shape-reference.html contains unresolved marker: ${marker}`);
    assert(!validatorReferenceHtml.includes(marker), `validator-reference.html contains unresolved marker: ${marker}`);
    assert(!gotchaReferenceHtml.includes(marker), `gotcha-reference.html contains unresolved marker: ${marker}`);
  }

  console.log(`Metronome CLI docs site verified: ${requiredSections.length} sections, ${usedSourceIds.length} used source ids, ${Object.keys(sources).length} source records, ${verifiedLocalReferenceCount} local references.`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

module.exports = {
  parseSourceIds,
};
