'use strict';

const { renderBrandHeadLinks, renderGeneratedBrand, renderSiteScript } = require('./html-branding');

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderList(values) {
  if (!values || values.length === 0) return '<span class="muted">none</span>';
  return `<ul class="compact-list">${values.map((value) => `<li><code>${escapeHtml(value)}</code></li>`).join('')}</ul>`;
}

function renderTextList(values) {
  if (!values || values.length === 0) return '<span class="muted">none</span>';
  return `<ul class="compact-list">${values.map((value) => `<li>${escapeHtml(value)}</li>`).join('')}</ul>`;
}

function renderCounts(counts) {
  const entries = Object.entries(counts || {}).sort(([a], [b]) => a.localeCompare(b));
  if (!entries.length) return '<span class="muted">none</span>';
  return entries.map(([key, count]) => `${escapeHtml(key)}: ${escapeHtml(count)}`).join(', ');
}

function renderGeneratedFrom(value) {
  const values = Array.isArray(value) ? value : [value];
  return values.map((item) => `<code>${escapeHtml(item)}</code>`).join(', ');
}

function renderStatus(value) {
  const className = value === 'unsupported-live-execution' ? 'unsupported' : 'local';
  return `<span class="status-pill ${className}">${escapeHtml(value)}</span>`;
}

function renderSummaryCards(reference) {
  return [
    `<article><span>Reviewed endpoints</span><strong>${escapeHtml(reference.endpointCount)}</strong></article>`,
    `<article><span>Families</span><strong>${escapeHtml(reference.families.length)}</strong></article>`,
    `<article><span>Operation types</span><strong>${renderCounts(reference.operationTypes)}</strong></article>`,
    `<article><span>Request validators</span><strong>${renderCounts(reference.requestValidationStatuses)}</strong></article>`,
    `<article><span>API read plans</span><strong>${renderCounts(reference.apiReadPlanStatuses)}</strong></article>`,
    `<article><span>API read gates</span><strong>${renderCounts(reference.apiReadGateStatuses)}</strong></article>`,
    `<article><span>API read mocks</span><strong>${renderCounts(reference.apiReadMockStatuses)}</strong></article>`,
    `<article><span>API read pipelines</span><strong>${renderCounts(reference.apiReadPipelineStatuses)}</strong></article>`,
    `<article><span>API read results</span><strong>${renderCounts(reference.apiReadResultStatuses)}</strong></article>`,
    `<article><span>API read audits</span><strong>${renderCounts(reference.apiReadAuditStatuses)}</strong></article>`,
    `<article><span>Read readiness</span><strong>${renderCounts(reference.apiReadinessStatuses)}</strong></article>`,
    `<article><span>Write readiness</span><strong>${renderCounts(reference.apiWriteReadinessStatuses)}</strong></article>`,
    `<article><span>Local previews</span><strong>${renderCounts(reference.localPreviewStatuses)}</strong></article>`,
    `<article><span>API preflights</span><strong>${renderCounts(reference.apiPreflightStatuses)}</strong></article>`,
    `<article><span>API sandbox proofs</span><strong>${renderCounts(reference.apiSandboxProofStatuses)}</strong></article>`,
    `<article><span>API apply gates</span><strong>${renderCounts(reference.apiApplyGateStatuses)}</strong></article>`,
    `<article><span>API approval records</span><strong>${renderCounts(reference.apiApprovalRecordStatuses)}</strong></article>`,
    `<article><span>API apply audits</span><strong>${renderCounts(reference.apiApplyAuditStatuses)}</strong></article>`,
    `<article><span>API apply read-backs</span><strong>${renderCounts(reference.apiApplyReadbackStatuses)}</strong></article>`,
    `<article><span>API apply results</span><strong>${renderCounts(reference.apiApplyResultStatuses)}</strong></article>`,
    `<article><span>Permission scopes</span><strong>${escapeHtml(reference.permissionScopes.scopeCount)}</strong></article>`,
    `<article><span>Approval policies</span><strong>${escapeHtml(reference.approvalPolicies.policyCount)}</strong></article>`,
    `<article><span>Live API access</span><strong>${escapeHtml(reference.apiAccess)}</strong></article>`,
  ].join('');
}

function renderReferenceJumps(reference) {
  return `<nav class="reference-jumps" aria-label="API reference sections">
          <strong>Page index</strong>
          ${reference.sectionNavigation.map((section) => `<a href="${escapeHtml(section.href)}"><span>${escapeHtml(section.label)}</span><small>${escapeHtml(section.description)}</small></a>`).join('\n          ')}
        </nav>`;
}

function renderFamilyRow(family) {
  return [
    '<tr>',
    `<td><code>${escapeHtml(family.family)}</code></td>`,
    `<td>${escapeHtml(family.endpointCount)}</td>`,
    `<td>${renderCounts(family.operationTypes)}</td>`,
    `<td>${renderCounts(family.supportStatuses)}</td>`,
    '</tr>',
  ].join('');
}

function renderScopeRow(scope) {
  return [
    '<tr>',
    `<td><code>${escapeHtml(scope.scope)}</code></td>`,
    `<td>${escapeHtml(scope.accessClass)}</td>`,
    `<td>${escapeHtml(scope.endpointCount)}</td>`,
    `<td>${escapeHtml(scope.approvalModel)}</td>`,
    `<td>${escapeHtml(scope.liveCommandStatus)}</td>`,
    '</tr>',
  ].join('');
}

function renderApprovalPolicyRow(policy) {
  return [
    '<tr>',
    `<td><code>${escapeHtml(policy.scope)}</code></td>`,
    `<td>${escapeHtml(policy.approvalTier)}</td>`,
    `<td>${escapeHtml(policy.accountableOwnerRole)}</td>`,
    `<td>${renderList(policy.requiredApproverRoles)}</td>`,
    `<td>${escapeHtml(policy.liveCommandStatus)}</td>`,
    '</tr>',
  ].join('');
}

function renderReadinessRow(endpoint) {
  return [
    '<tr>',
    `<td><code>${escapeHtml(endpoint.endpointId)}</code></td>`,
    `<td>${escapeHtml(endpoint.family)}</td>`,
    `<td><code>${escapeHtml(endpoint.method)} ${escapeHtml(endpoint.path)}</code></td>`,
    `<td>${escapeHtml(endpoint.requestValidator.status)}</td>`,
    `<td>${escapeHtml(endpoint.localReadPlan.status)}</td>`,
    `<td>${endpoint.goldenOutput.covered ? 'yes' : 'no'}</td>`,
    `<td>${renderList(endpoint.goldenOutput.coverageTypes)}</td>`,
    `<td>${escapeHtml(endpoint.readiness)}</td>`,
    '</tr>',
  ].join('');
}

function renderWriteReadinessRow(endpoint) {
  return [
    '<tr>',
    `<td><code>${escapeHtml(endpoint.endpointId)}</code></td>`,
    `<td>${escapeHtml(endpoint.family)}</td>`,
    `<td><code>${escapeHtml(endpoint.method)} ${escapeHtml(endpoint.path)}</code></td>`,
    `<td>${escapeHtml(endpoint.requestValidator.status)}</td>`,
    `<td>${escapeHtml(endpoint.localPreview.status)}</td>`,
    `<td>${escapeHtml(endpoint.apiPreflight.status)}</td>`,
    `<td>${escapeHtml(endpoint.apiSandboxProof.status)}</td>`,
    `<td>${escapeHtml(endpoint.apiApplyGate.status)}</td>`,
    `<td>${escapeHtml(endpoint.apiApprovalRecord.status)}</td>`,
    `<td>${escapeHtml(endpoint.apiApplyAudit.status)}</td>`,
    `<td>${escapeHtml(endpoint.apiApplyReadback.status)}</td>`,
    `<td>${escapeHtml(endpoint.apiApplyResult.status)}</td>`,
    `<td>${endpoint.sideEffectProfile ? escapeHtml(endpoint.sideEffectProfile.riskClass) : '<span class="muted">none</span>'}</td>`,
    `<td>${escapeHtml(endpoint.readiness)}</td>`,
    '</tr>',
  ].join('');
}

function renderCoverageCount(count, total) {
  return `${escapeHtml(count)}/${escapeHtml(total)}`;
}

function renderReadinessFamilyRow(family) {
  const missingEvidence = [
    ...family.missingValidatorEndpoints.map((endpoint) => `${endpoint}: validator`),
    ...family.missingReadPlanEndpoints.map((endpoint) => `${endpoint}: read plan`),
    ...family.missingReadMockEndpoints.map((endpoint) => `${endpoint}: read mock`),
    ...family.missingReadPipelineEndpoints.map((endpoint) => `${endpoint}: read pipeline`),
    ...family.missingPersistedReadAuditEndpoints.map((endpoint) => `${endpoint}: persisted read audit`),
  ];

  return [
    '<tr>',
    `<td><code>${escapeHtml(family.family)}</code></td>`,
    `<td>${escapeHtml(family.readEndpoints)}</td>`,
    `<td>${renderCoverageCount(family.endpointSpecificValidators, family.readEndpoints)}</td>`,
    `<td>${renderCoverageCount(family.readPlans, family.readEndpoints)}</td>`,
    `<td>${renderCoverageCount(family.readMocks, family.readEndpoints)}</td>`,
    `<td>${renderCoverageCount(family.readPipelines, family.readEndpoints)}</td>`,
    `<td>${renderCoverageCount(family.persistedReadAudits, family.readEndpoints)}</td>`,
    `<td>${renderTextList(missingEvidence)}</td>`,
    '</tr>',
  ].join('');
}

function renderWriteReadinessFamilyRow(family) {
  const missingEvidence = [
    ...family.missingValidatorEndpoints.map((endpoint) => `${endpoint}: validator`),
    ...family.missingPreviewEndpoints.map((endpoint) => `${endpoint}: preview`),
    ...family.missingPreflightEndpoints.map((endpoint) => `${endpoint}: preflight`),
    ...family.missingSandboxProofEndpoints.map((endpoint) => `${endpoint}: sandbox proof`),
    ...family.missingApplyGateEndpoints.map((endpoint) => `${endpoint}: apply gate`),
    ...family.missingApprovalRecordEndpoints.map((endpoint) => `${endpoint}: approval record`),
    ...family.missingApplyAuditEndpoints.map((endpoint) => `${endpoint}: apply audit`),
    ...family.missingApplyReadbackEndpoints.map((endpoint) => `${endpoint}: apply read-back`),
    ...family.missingApplyResultEndpoints.map((endpoint) => `${endpoint}: apply result`),
  ];

  return [
    '<tr>',
    `<td><code>${escapeHtml(family.family)}</code></td>`,
    `<td>${escapeHtml(family.writeEndpoints)}</td>`,
    `<td>${renderCoverageCount(family.endpointSpecificValidators, family.writeEndpoints)}</td>`,
    `<td>${renderCoverageCount(family.localPreviews, family.writeEndpoints)}</td>`,
    `<td>${renderCoverageCount(family.apiPreflights, family.writeEndpoints)}</td>`,
    `<td>${renderCoverageCount(family.apiSandboxProofs, family.writeEndpoints)}</td>`,
    `<td>${renderCoverageCount(family.apiApplyGates, family.writeEndpoints)}</td>`,
    `<td>${renderCoverageCount(family.apiApprovalRecords, family.writeEndpoints)}</td>`,
    `<td>${renderCoverageCount(family.apiApplyAudits, family.writeEndpoints)}</td>`,
    `<td>${renderCoverageCount(family.apiApplyReadbacks, family.writeEndpoints)}</td>`,
    `<td>${renderCoverageCount(family.apiApplyResults, family.writeEndpoints)}</td>`,
    `<td>${renderTextList(missingEvidence)}</td>`,
    '</tr>',
  ].join('');
}

function renderWriteProofLadderRow(step) {
  return [
    '<tr>',
    `<td>${escapeHtml(step.order)}</td>`,
    `<td><code>${escapeHtml(step.id)}</code></td>`,
    `<td><code>${escapeHtml(step.command)}</code></td>`,
    `<td>${step.validationCommand ? `<code>${escapeHtml(step.validationCommand)}</code>` : '<span class="muted">none</span>'}</td>`,
    `<td>${escapeHtml(step.proves)}</td>`,
    `<td><code>${escapeHtml(step.unlocks)}</code></td>`,
    `<td><code>${escapeHtml(step.apiAccess)}</code></td>`,
    `<td><code>${escapeHtml(step.liveExecutionEnabledInCurrentCli)}</code></td>`,
    `<td><code>${escapeHtml(step.applyEnabledInCurrentCli)}</code></td>`,
    '</tr>',
  ].join('');
}

function renderSideEffectProfile(profile) {
  if (!profile) return '';
  return `<h3>Side-effect profile</h3>
          <p><code>${escapeHtml(profile.riskClass)}</code> ${escapeHtml(profile.summary)}</p>
          <div class="reference-columns">
            <section>
              <h3>Future live side effects</h3>
              ${renderTextList(profile.futureLiveSideEffects)}
            </section>
            <section>
              <h3>Required reviews</h3>
              ${renderTextList(profile.requiredReviews)}
            </section>
            <section>
              <h3>Rollback or remediation</h3>
              ${renderTextList(profile.rollbackOrRemediation)}
            </section>
            <section>
              <h3>Side-effect sources</h3>
              ${renderList(profile.sources)}
            </section>
          </div>`;
}

function renderEndpointCard(endpoint) {
  const sideEffectHtml = endpoint.sideEffectProfile
    ? `\n          ${renderSideEffectProfile(endpoint.sideEffectProfile)}`
    : '';

  return `<article class="reference-card">
          <h2>${escapeHtml(endpoint.title)}</h2>
          <p><code>${escapeHtml(endpoint.id)}</code> ${renderStatus(endpoint.supportStatus)}</p>
          <div class="reference-columns">
            <section>
              <h3>Endpoint</h3>
              <p><code>${escapeHtml(endpoint.method)} ${escapeHtml(endpoint.path)}</code></p>
              <p>${escapeHtml(endpoint.operationType)} · ${escapeHtml(endpoint.family)}</p>
            </section>
            <section>
              <h3>Access</h3>
              <p>Current CLI API access: <code>${escapeHtml(endpoint.apiAccessInCurrentCli)}</code></p>
              <p>Permission scope: <code>${escapeHtml(endpoint.permissionScope)}</code></p>
              <p>Tenant: ${escapeHtml(endpoint.tenant.selection)}</p>
            </section>
            <section>
              <h3>Current commands</h3>
              ${renderList(endpoint.currentCommands)}
            </section>
            <section>
              <h3>Future commands</h3>
              ${renderList(endpoint.futureCommands)}
            </section>
          </div>
          <h3>Request contract</h3>
          <p>${escapeHtml(endpoint.requestContract.summary)}</p>
          <h3>Request validation</h3>
          <p>Command: <code>${escapeHtml(endpoint.requestValidation.command)}</code></p>
          <p>Status: <code>${escapeHtml(endpoint.requestValidation.supportStatus)}</code></p>
          ${renderList(endpoint.requestValidation.checked)}
          <h3>API read plan</h3>
          <p>Command: <code>${escapeHtml(endpoint.apiReadPlan.command)}</code></p>
          <p>Status: <code>${escapeHtml(endpoint.apiReadPlan.supportStatus)}</code></p>
          <p>Requires: <code>${escapeHtml(endpoint.apiReadPlan.requiresValidation)}</code></p>
          <p>Live read enabled in current CLI: <code>${escapeHtml(endpoint.apiReadPlan.liveReadEnabledInCurrentCli)}</code></p>
          <h3>API read gate</h3>
          <p>Command: <code>${escapeHtml(endpoint.apiReadGate.command)}</code></p>
          <p>Validate: <code>${escapeHtml(endpoint.apiReadGate.validationCommand)}</code></p>
          <p>Status: <code>${escapeHtml(endpoint.apiReadGate.supportStatus)}</code></p>
          <p>Requires: <code>${escapeHtml(endpoint.apiReadGate.requiresReadPlan)}</code></p>
          <p>Read enabled in current CLI: <code>${escapeHtml(endpoint.apiReadGate.readEnabledInCurrentCli)}</code></p>
          ${renderList(endpoint.apiReadGate.requiredEvidence)}
          <h3>API read mock</h3>
          <p>Command: <code>${escapeHtml(endpoint.apiReadMock.command)}</code></p>
          <p>Status: <code>${escapeHtml(endpoint.apiReadMock.supportStatus)}</code></p>
          <p>Requires read gate: <code>${escapeHtml(endpoint.apiReadMock.requiresReadGate)}</code></p>
          <p>Produces read result: <code>${escapeHtml(endpoint.apiReadMock.producesReadResult)}</code></p>
          <p>Produces read audit template: <code>${escapeHtml(endpoint.apiReadMock.producesReadAuditTemplate)}</code></p>
          <p>Read enabled in current CLI: <code>${escapeHtml(endpoint.apiReadMock.readEnabledInCurrentCli)}</code></p>
          <h3>API read pipeline</h3>
          <p>Command: <code>${escapeHtml(endpoint.apiReadPipeline.command)}</code></p>
          <p>Status: <code>${escapeHtml(endpoint.apiReadPipeline.supportStatus)}</code></p>
          <p>Requires read gate: <code>${escapeHtml(endpoint.apiReadPipeline.requiresReadGate)}</code></p>
          <p>Produces read result: <code>${escapeHtml(endpoint.apiReadPipeline.producesReadResult)}</code></p>
          <p>Produces read audit writer output: <code>${escapeHtml(endpoint.apiReadPipeline.producesReadAuditWrite)}</code></p>
          <p>Read enabled in current CLI: <code>${escapeHtml(endpoint.apiReadPipeline.readEnabledInCurrentCli)}</code></p>
          <h3>API read result</h3>
          <p>Validate: <code>${escapeHtml(endpoint.apiReadResult.validationCommand)}</code></p>
          <p>Status: <code>${escapeHtml(endpoint.apiReadResult.supportStatus)}</code></p>
          <p>Requires: <code>${escapeHtml(endpoint.apiReadResult.requiresReadGate)}</code></p>
          <p>Read enabled in current CLI: <code>${escapeHtml(endpoint.apiReadResult.readEnabledInCurrentCli)}</code></p>
          <h3>API read audit</h3>
          <p>Template: <code>${escapeHtml(endpoint.apiReadAudit.templateCommand)}</code></p>
          <p>Validate: <code>${escapeHtml(endpoint.apiReadAudit.validationCommand)}</code></p>
          <p>Status: <code>${escapeHtml(endpoint.apiReadAudit.supportStatus)}</code></p>
          <p>Requires read gate: <code>${escapeHtml(endpoint.apiReadAudit.requiresReadGate)}</code></p>
          <p>Requires read result: <code>${escapeHtml(endpoint.apiReadAudit.requiresReadResult)}</code></p>
          <p>Read enabled in current CLI: <code>${escapeHtml(endpoint.apiReadAudit.readEnabledInCurrentCli)}</code></p>
          <h3>Local preview</h3>
          <p>Command: <code>${escapeHtml(endpoint.localPreview.command)}</code></p>
          <p>Status: <code>${escapeHtml(endpoint.localPreview.supportStatus)}</code></p>
          <p>Requires: <code>${escapeHtml(endpoint.localPreview.requiresValidation)}</code></p>${sideEffectHtml}
          <h3>API preflight</h3>
          <p>Command: <code>${escapeHtml(endpoint.apiPreflight.command)}</code></p>
          <p>Validate: <code>${escapeHtml(endpoint.apiPreflight.validationCommand)}</code></p>
          <p>Status: <code>${escapeHtml(endpoint.apiPreflight.supportStatus)}</code></p>
          <p>Requires: <code>${escapeHtml(endpoint.apiPreflight.requiresPreview)}</code></p>
          ${renderList(endpoint.apiPreflight.requiredEvidence)}
          <h3>API sandbox proof</h3>
          <p>Command: <code>${escapeHtml(endpoint.apiSandboxProof.command || 'not required')}</code></p>
          <p>Validate: <code>${escapeHtml(endpoint.apiSandboxProof.validationCommand)}</code></p>
          <p>Status: <code>${escapeHtml(endpoint.apiSandboxProof.supportStatus)}</code></p>
          ${renderList(endpoint.apiSandboxProof.requiredEvidence)}
          <h3>API apply gate</h3>
          <p>Command: <code>${escapeHtml(endpoint.apiApplyGate.command)}</code></p>
          <p>Validate: <code>${escapeHtml(endpoint.apiApplyGate.validationCommand)}</code></p>
          <p>Status: <code>${escapeHtml(endpoint.apiApplyGate.supportStatus)}</code></p>
          <p>Requires: <code>${escapeHtml(endpoint.apiApplyGate.requiresPreflight)}</code></p>
          ${renderList(endpoint.apiApplyGate.requiredEvidence)}
          <h3>API approval record</h3>
          <p>Command: <code>${escapeHtml(endpoint.apiApprovalRecord.command || 'not required')}</code></p>
          <p>Validate: <code>${escapeHtml(endpoint.apiApprovalRecord.validationCommand)}</code></p>
          <p>Status: <code>${escapeHtml(endpoint.apiApprovalRecord.supportStatus)}</code></p>
          <p>Requires: <code>${escapeHtml(endpoint.apiApprovalRecord.requiresApplyGate || 'not required')}</code></p>
          <p>Apply enabled in current CLI: <code>${escapeHtml(endpoint.apiApprovalRecord.applyEnabledInCurrentCli)}</code></p>
          ${renderList(endpoint.apiApprovalRecord.requiredEvidence)}
          <h3>API apply audit</h3>
          <p>Template: <code>${escapeHtml(endpoint.apiApplyAudit.templateCommand || 'not required')}</code></p>
          <p>Write: <code>${escapeHtml(endpoint.apiApplyAudit.writeCommand || 'not required')}</code></p>
          <p>Validate: <code>${escapeHtml(endpoint.apiApplyAudit.validationCommand)}</code></p>
          <p>Status: <code>${escapeHtml(endpoint.apiApplyAudit.supportStatus)}</code></p>
          <p>Requires: <code>${escapeHtml(endpoint.apiApplyAudit.requiresApprovalRecord || 'not required')}</code></p>
          <p>Apply enabled in current CLI: <code>${escapeHtml(endpoint.apiApplyAudit.applyEnabledInCurrentCli)}</code></p>
          ${renderList(endpoint.apiApplyAudit.requiredEvidence)}
          <h3>API apply read-back</h3>
          <p>Verify: <code>${escapeHtml(endpoint.apiApplyReadback.verificationCommand || 'not required')}</code></p>
          <p>Status: <code>${escapeHtml(endpoint.apiApplyReadback.supportStatus)}</code></p>
          <p>Requires apply audit: <code>${escapeHtml(endpoint.apiApplyReadback.requiresApplyAudit || 'not required')}</code></p>
          <p>Requires read result: <code>${escapeHtml(endpoint.apiApplyReadback.requiresReadResult || 'not required')}</code></p>
          <p>Apply enabled in current CLI: <code>${escapeHtml(endpoint.apiApplyReadback.applyEnabledInCurrentCli)}</code></p>
          <p>Read enabled in current CLI: <code>${escapeHtml(endpoint.apiApplyReadback.readEnabledInCurrentCli)}</code></p>
          <p>Allowed read-back endpoints:</p>
          ${renderList(endpoint.apiApplyReadback.allowedReadEndpointIds)}
          ${renderList(endpoint.apiApplyReadback.requiredEvidence)}
          <h3>API apply result</h3>
          <p>Template: <code>${escapeHtml(endpoint.apiApplyResult.templateCommand || 'not required')}</code></p>
          <p>Validate: <code>${escapeHtml(endpoint.apiApplyResult.validationCommand || 'not required')}</code></p>
          <p>Status: <code>${escapeHtml(endpoint.apiApplyResult.supportStatus)}</code></p>
          <p>Apply enabled in current CLI: <code>${escapeHtml(endpoint.apiApplyResult.applyEnabledInCurrentCli)}</code></p>
          <p>Live apply authorized by this record: <code>${escapeHtml(endpoint.apiApplyResult.liveApplyAuthorizedByThisRecord)}</code></p>
          ${renderList(endpoint.apiApplyResult.requiredEvidence)}
          <div class="reference-columns">
            <section>
              <h3>Required fields</h3>
              ${renderList(endpoint.requestContract.requiredFields)}
            </section>
            <section>
              <h3>Forbidden fields</h3>
              ${renderList(endpoint.requestContract.forbiddenFields)}
            </section>
          </div>
          <h3>Response contract</h3>
          <p>${escapeHtml(endpoint.responseContract.summary)}</p>
          <h3>Policy gates</h3>
          ${renderList(endpoint.policyGates)}
          <h3>Sources</h3>
          ${renderList(endpoint.sources)}
        </article>`;
}

function renderApiReferenceHtml(reference, options = {}) {
  const stylesheetHref = options.stylesheetHref || 'styles.css';
  const indexHref = options.indexHref || 'index.html';

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Metronome CLI API Reference</title>
    <meta name="description" content="Generated reviewed endpoint catalog for the Metronome CLI expert API layer.">
${renderBrandHeadLinks(options)}
    <link rel="stylesheet" href="${escapeHtml(stylesheetHref)}">
  </head>
  <body class="generated-reference">
    <main class="generated-shell">
      <header class="generated-header">
        ${renderGeneratedBrand({ ...options, indexHref })}
        <a href="${escapeHtml(indexHref)}">Back to operating manual</a>
        <p class="eyebrow">Generated from ${renderGeneratedFrom(reference.generatedFrom)}</p>
        <h1>Metronome CLI API reference</h1>
        <p>This page is generated from the reviewed endpoint catalog used by <code>metro api catalog --json</code>, the local validator used by <code>metro api validate &lt;endpoint-id&gt; --file &lt;request.json|yaml&gt;</code>, the compact local readiness summary used by <code>metro api readiness --summary --json</code>, the full readiness report used by <code>metro api readiness --json</code>, the local read-plan builder used by <code>metro api read-plan &lt;endpoint-id&gt; --file &lt;request.json|yaml&gt; (--sandbox|--prod)</code>, the local read-gate binder used by <code>metro api read-gate template --read-plan &lt;api-read-plan.json&gt;</code>, the local mocked read pipeline used by <code>metro api read-mock &lt;endpoint-id&gt; --file &lt;request.json|yaml&gt; --read-gate &lt;api-read-gate.json&gt; --mock-response &lt;response-data.json&gt;</code>, the local read-pipeline audit shortcut used by <code>metro api read-pipeline &lt;endpoint-id&gt; --file &lt;request.json|yaml&gt; --read-gate &lt;api-read-gate.json&gt; --mock-response &lt;response-data.json&gt; --out &lt;api-read-audit.jsonl&gt; --actor &lt;id&gt; (--dry-run|--write)</code>, the local mocked read-result verifier used by <code>metro api read-result verify --file &lt;api-read-result.json&gt;</code>, the local read-audit validator used by <code>metro api read-audit validate --file &lt;api-read-audit.jsonl&gt;</code>, the local preview builder used by <code>metro api preview &lt;endpoint-id&gt; --file &lt;request.json|yaml&gt; (--sandbox|--prod)</code>, the local preflight binder used by <code>metro api preflight template --preview &lt;api-preview.json&gt;</code>, the local apply-gate manifest used by <code>metro api apply-gate validate --file &lt;api-apply-gate.json&gt;</code>, the local approval-record validator used by <code>metro api approval-record validate --file &lt;api-approval-record.json&gt;</code>, the local planned apply-audit writer used by <code>metro api apply-audit write --approval-record &lt;api-approval-record.json&gt; --out &lt;api-apply-audit.jsonl&gt; --actor &lt;id&gt; (--dry-run|--write)</code>, the local apply read-back verifier used by <code>metro api apply-readback verify --apply-audit &lt;api-apply-audit.jsonl&gt; --read-result &lt;api-read-result.json&gt;</code>, and the local apply-result contract used by <code>metro api apply-result template --apply-audit &lt;api-apply-audit.jsonl&gt; --apply-readback &lt;api-apply-readback.json&gt;</code> and <code>metro api apply-result validate --file &lt;api-apply-result.json&gt; --apply-audit &lt;api-apply-audit.jsonl&gt; --apply-readback &lt;api-apply-readback.json&gt;</code>. It documents endpoint IDs, request validators, read readiness, read-plan hashes, read-gate file hashes, read-mock bundles, read-pipeline audit rows, read-result hashes, read-audit rows, preview hashes, preflight evidence, apply-gate file hashes, approval-record file hashes, planned apply-audit rows, apply read-back evidence binding, apply-result evidence contracts, sandbox-proof request-hash binding, and gates only; live API execution is disabled in the current CLI and durable approval/audit/result records still require current-turn authorization before any future live operation.</p>
        ${renderReferenceJumps(reference)}
        <div class="summary-grid">${renderSummaryCards(reference)}</div>
      </header>

      <section id="families" class="generated-section">
        <h2>Families</h2>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Family</th>
                <th>Endpoints</th>
                <th>Operation types</th>
                <th>Support statuses</th>
              </tr>
            </thead>
            <tbody>
              ${reference.families.map(renderFamilyRow).join('\n              ')}
            </tbody>
          </table>
        </div>
      </section>

      <section id="permission-scopes" class="generated-section">
        <h2>Permission scopes</h2>
        <p>The expert API layer uses catalog-derived permission scopes before any future live runner can be considered. Read scopes require explicit live-read authorization and a guarded read client. Write scopes require owner approval bound to reviewed preview and preflight evidence.</p>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Scope</th>
                <th>Access</th>
                <th>Endpoints</th>
                <th>Approval model</th>
                <th>Live status</th>
              </tr>
            </thead>
            <tbody>
              ${reference.permissionScopes.scopes.map(renderScopeRow).join('\n              ')}
            </tbody>
          </table>
        </div>
      </section>

      <section id="approval-policies" class="generated-section">
        <h2>Approval policies</h2>
        <p>The approval policy map is local reference data, not IAM and not live authorization. It names the owner role, approver roles, approval record fields, and evidence expected before future expert API execution can be considered.</p>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Scope</th>
                <th>Tier</th>
                <th>Owner role</th>
                <th>Approver roles</th>
                <th>Live status</th>
              </tr>
            </thead>
            <tbody>
              ${reference.approvalPolicies.policies.map(renderApprovalPolicyRow).join('\n              ')}
            </tbody>
          </table>
        </div>
      </section>

      <section id="read-endpoint-readiness" class="generated-section">
        <h2>Read endpoint readiness</h2>
        <p>This local-only summary reports which reviewed read endpoints have endpoint-specific validators, read-plan goldens, read-mock evidence, read-pipeline goldens, and persisted read-audit validation. It does not enable live reads.</p>
        <h3>Family coverage</h3>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Family</th>
                <th>Read endpoints</th>
                <th>Validators</th>
                <th>Read plans</th>
                <th>Read mocks</th>
                <th>Read pipelines</th>
                <th>Persisted audits</th>
                <th>Missing evidence</th>
              </tr>
            </thead>
            <tbody>
              ${reference.readReadiness.coverageByFamily.map(renderReadinessFamilyRow).join('\n              ')}
            </tbody>
          </table>
        </div>
        <h3>Endpoint coverage</h3>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Endpoint</th>
                <th>Family</th>
                <th>Method/path</th>
                <th>Validator</th>
                <th>Read plan</th>
                <th>Golden</th>
                <th>Coverage types</th>
                <th>Readiness</th>
              </tr>
            </thead>
            <tbody>
              ${reference.readReadiness.endpoints.map(renderReadinessRow).join('\n              ')}
            </tbody>
          </table>
        </div>
      </section>

      <section id="write-endpoint-gate-readiness" class="generated-section">
        <h2>Write endpoint gate readiness</h2>
        <p>This local-only summary reports which reviewed write endpoints have endpoint-specific validators, local previews, API preflights, API sandbox-proof templates, API apply-gate manifests, approval-record contracts, planned apply-audit contracts, apply read-back verifiers, and apply-result contracts. It does not enable live writes.</p>
        <h3 id="write-proof-ladder">Write proof ladder</h3>
        <p>The write proof ladder is the reviewed local sequence every expert API write endpoint must satisfy before any future guarded apply runner can be considered. Every ladder step keeps API access, live execution, and apply disabled in the current CLI.</p>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Order</th>
                <th>Stage</th>
                <th>Command</th>
                <th>Validation</th>
                <th>Proves</th>
                <th>Unlocks</th>
                <th>API access</th>
                <th>Live execution</th>
                <th>Apply</th>
              </tr>
            </thead>
            <tbody>
              ${reference.writeProofLadder.map(renderWriteProofLadderRow).join('\n              ')}
            </tbody>
          </table>
        </div>
        <h3>Family coverage</h3>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Family</th>
                <th>Write endpoints</th>
                <th>Validators</th>
                <th>Previews</th>
                <th>Preflights</th>
                <th>Sandbox proofs</th>
                <th>Apply gates</th>
                <th>Approval records</th>
                <th>Apply audits</th>
                <th>Apply read-backs</th>
                <th>Apply results</th>
                <th>Missing evidence</th>
              </tr>
            </thead>
            <tbody>
              ${reference.readReadiness.writeCoverageByFamily.map(renderWriteReadinessFamilyRow).join('\n              ')}
            </tbody>
          </table>
        </div>
        <h3 id="write-endpoint-coverage">Endpoint coverage</h3>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Endpoint</th>
                <th>Family</th>
                <th>Method/path</th>
                <th>Validator</th>
                <th>Preview</th>
                <th>Preflight</th>
                <th>Sandbox proof</th>
                <th>Apply gate</th>
                <th>Approval record</th>
                <th>Apply audit</th>
                <th>Apply read-back</th>
                <th>Apply result</th>
                <th>Risk</th>
                <th>Readiness</th>
              </tr>
            </thead>
            <tbody>
              ${reference.readReadiness.writeEndpoints.map(renderWriteReadinessRow).join('\n              ')}
            </tbody>
          </table>
        </div>
      </section>

      <section id="endpoint-contracts" class="generated-section reference-stack">
        ${reference.endpoints.map(renderEndpointCard).join('\n        ')}
      </section>
    </main>
${renderSiteScript(options)}
  </body>
</html>
`;
}

module.exports = {
  renderApiReferenceHtml,
};
