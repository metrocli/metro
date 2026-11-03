'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { isApplyGateSupported } = require('../evidence-gates/support');
const { validatePreflight } = require('../preflight');
const { validateSandboxProof } = require('../proof/sandbox-manifest');

const SECRET_KEY_PATTERN = /(secret|token|api[_-]?key|authorization|bearer|password|private[_-]?key)/i;
const SECRET_VALUE_PATTERN = /(sk_live_|sk_test_|pk_live_|prod_[A-Za-z0-9]{12,}|Bearer\s+[A-Za-z0-9._-]+)/;

function isObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function nonEmpty(value) {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

function filled(value) {
  return nonEmpty(value) && !/^<[^>]+>$/.test(String(value).trim());
}

function isSha256(value) {
  return typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
}

function finding(id, severity, message, path, remediation) {
  return { id, severity, message, path, remediation };
}

function resolveLocalPath(filePath, rootDir) {
  if (!filled(filePath)) return null;
  if (path.isAbsolute(filePath)) return filePath;
  return path.resolve(rootDir, filePath);
}

function fileHash(filePath) {
  return `sha256:${crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')}`;
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function tenantFlag(tenant) {
  if (tenant === 'production') return '--prod';
  if (tenant === 'sandbox') return '--sandbox';
  return '(--sandbox|--prod)';
}

function previewCommandFor(workflow, shape, tenant) {
  const flag = tenantFlag(tenant);
  if (workflow === 'customer.setup' && shape === 'customer-setup') {
    return `metro customer setup preview --file <input.json|yaml> ${flag} --json`;
  }
  if (workflow === 'contract.move-plan.apply') {
    return `metro contract move-plan preview --file <input.json|yaml> ${flag} --json`;
  }
  if (workflow === 'credit.apply' && shape === 'complimentary-credit-grant') {
    return `metro credit preview --shape complimentary-credit-grant --file <input.json|yaml> ${flag} --json`;
  }
  if (workflow === 'credit.apply' && shape === 'paid-credit-top-up') {
    return `metro credit preview --shape paid-credit-top-up --file <input.json|yaml> ${flag} --json`;
  }
  if (workflow === 'subscription.contract.apply' && shape === 'direct-subscription-contract') {
    return `metro subscription contract preview --shape direct-subscription-contract --file <input.json|yaml> ${flag} --json`;
  }
  if (workflow === 'custom-contract.create' && shape === 'enterprise-custom-contract') {
    return `metro custom-contract preview --file <input.json|yaml> ${flag} --json`;
  }
  if (workflow === 'billing-provider.attach' && shape === 'stripe-billing-provider-attachment') {
    return `metro billing-provider preview --shape stripe-billing-provider-attachment --file <input.json|yaml> ${flag} --json`;
  }
  if (workflow === 'invoice.issue-date-update' && shape === 'invoice-issue-date-update') {
    return `metro invoice issue-date preview --file <input.json|yaml> ${flag} --json`;
  }
  if (workflow === 'product.rate-retirement' && shape === 'product-rate-retirement') {
    return `metro product retire preview --file <input.json|yaml> ${flag} --json`;
  }
  if (workflow === 'rate-card.dimensional.apply' && shape === 'dimensional-rate-card') {
    return `metro rate-card dimensional preview --file <input.json|yaml> ${flag} --json`;
  }
  if (workflow === 'package.archive' && shape === 'package-alias-archive-handoff') {
    return `metro package archive preview --file <input.json|yaml> ${flag} --json`;
  }
  if (workflow === 'usage.ingest-preview' && shape === 'usage-ingest-preview') {
    return `metro usage ingest preview --file <input.json|yaml> ${flag} --json`;
  }
  return `metro package preview --shape pro-annual --file <input.json|yaml> ${flag} --json`;
}

function executionCommandFor(workflow, shape, tenant) {
  const flag = tenantFlag(tenant);
  if (workflow === 'customer.setup' && shape === 'customer-setup') {
    return `metro customer setup apply --file <input.json|yaml> ${flag} --confirm-hash <hash>`;
  }
  if (workflow === 'contract.move-plan.apply') {
    return `metro contract move-plan apply --file <input.json|yaml> ${flag} --confirm-hash <hash>`;
  }
  if (workflow === 'credit.apply' && shape === 'complimentary-credit-grant') {
    return `metro credit apply --shape complimentary-credit-grant --file <input.json|yaml> ${flag} --confirm-hash <hash>`;
  }
  if (workflow === 'credit.apply' && shape === 'paid-credit-top-up') {
    return `metro credit apply --shape paid-credit-top-up --file <input.json|yaml> ${flag} --confirm-hash <hash>`;
  }
  if (workflow === 'subscription.contract.apply' && shape === 'direct-subscription-contract') {
    return `metro subscription contract apply --file <input.json|yaml> ${flag} --confirm-hash <hash>`;
  }
  if (workflow === 'custom-contract.create' && shape === 'enterprise-custom-contract') {
    return `metro custom-contract apply --file <input.json|yaml> ${flag} --confirm-hash <hash>`;
  }
  if (workflow === 'billing-provider.attach' && shape === 'stripe-billing-provider-attachment') {
    return `metro billing-provider apply --shape stripe-billing-provider-attachment --file <input.json|yaml> ${flag} --confirm-hash <hash>`;
  }
  if (workflow === 'invoice.issue-date-update' && shape === 'invoice-issue-date-update') {
    return `metro invoice issue-date apply --file <input.json|yaml> ${flag} --confirm-hash <hash>`;
  }
  if (workflow === 'product.rate-retirement' && shape === 'product-rate-retirement') {
    return `metro product retire apply --file <input.json|yaml> ${flag} --confirm-hash <hash>`;
  }
  if (workflow === 'rate-card.dimensional.apply' && shape === 'dimensional-rate-card') {
    return `metro rate-card dimensional apply --file <input.json|yaml> ${flag} --confirm-hash <hash>`;
  }
  if (workflow === 'package.archive' && shape === 'package-alias-archive-handoff') {
    return `metro package archive apply --file <input.json|yaml> ${flag} --confirm-hash <hash>`;
  }
  if (workflow === 'usage.ingest-preview' && shape === 'usage-ingest-preview') {
    return `metro usage ingest apply --file <input.json|yaml> ${flag} --confirm-hash <hash>`;
  }
  return `metro package apply --shape pro-annual --file <input.json|yaml> ${flag} --confirm-hash <hash>`;
}

function buildApplyGateTemplate({ workflow, shape, tenant = '<sandbox|production>' }) {
  if (!isApplyGateSupported(workflow, shape)) return null;
  const production = tenant === 'production' || tenant === '<sandbox|production>';
  const fingerprintEnv = tenant === 'sandbox' ? 'METRONOME_SANDBOX_KEY' : '<METRONOME_SANDBOX_KEY|METRONOME_PROD_KEY>';

  return {
    schemaVersion: 'metro.apply-gate.v1',
    workflow,
    shape,
    tenant,
    localOnly: true,
    status: 'template',
    applyEnabledInCurrentCli: false,
    preview: {
      command: previewCommandFor(workflow, shape, tenant),
      outputPath: '<path-to-reviewed-preview-json>',
      payloadHash: 'sha256:<64 lowercase hex reviewed preview hash>',
    },
    preflight: {
      filePath: '<path-to-reviewed-preflight-json>',
      fileHash: 'sha256:<64 lowercase hex preflight file hash>',
      validationResult: 'passed',
    },
    sandboxProof: {
      required: production,
      filePath: production ? '<path-to-sandbox-proof-json>' : '<optional-sandbox-proof-json>',
      fileHash: production ? 'sha256:<64 lowercase hex sandbox proof file hash>' : '<optional-sha256>',
      validationResult: production ? 'passed' : 'not_required_for_sandbox',
    },
    approval: {
      command: executionCommandFor(workflow, shape, tenant),
      confirmHash: 'sha256:<64 lowercase hex reviewed preview hash>',
      owner: '<billing-ops-owner>',
      productionConfirmation: production ? 'sha256:<same reviewed preview hash>' : 'not_required_for_sandbox',
    },
    keyFingerprint: {
      envVar: production ? '<METRONOME_PROD_KEY>' : fingerprintEnv,
      previewFingerprint: '<non-secret fingerprint from preview/preflight>',
      applyFingerprint: '<non-secret fingerprint from apply environment>',
    },
    auditLog: {
      destination: '<jsonl-audit-log-path>',
      writerImplementedInCurrentCli: false,
    },
    verification: {
      readBackRequired: true,
      runnerImplementedInCurrentCli: false,
    },
    rollback: {
      reviewed: true,
      owner: '<billing-ops-owner>',
    },
    idempotency: {
      reviewed: true,
    },
    sources: [
      'docs/metronome-cli/one-goal.md',
      'docs/metronome-cli/CLI_ARCHITECTURE.md',
      'docs/metronome-cli/VALIDATION_AND_GUARDRAILS.md',
      'docs/metronome-cli/GOTCHAS.md',
      'skills/metronome-danger-zone/SKILL.md',
    ],
  };
}

function collectSecretFindings(value, pathName = '$') {
  const findings = [];
  if (typeof value === 'string') {
    if (SECRET_VALUE_PATTERN.test(value)) {
      findings.push(finding(
        'MTR-SECRET-002',
        'error',
        `Apply gate appears to contain a secret-like value at ${pathName}.`,
        pathName,
        'Store environment variable names, hashes, or non-secret fingerprints only.',
      ));
    }
    return findings;
  }
  if (!isObject(value)) return findings;
  for (const [key, nested] of Object.entries(value)) {
    const nestedPath = `${pathName}.${key}`;
    if (SECRET_KEY_PATTERN.test(key) && key !== 'keyFingerprint') {
      findings.push(finding(
        'MTR-SECRET-001',
        'error',
        `Apply gate contains forbidden secret-shaped field ${nestedPath}.`,
        nestedPath,
        'Never store raw keys, tokens, passwords, or Authorization headers in apply gate manifests.',
      ));
    }
    findings.push(...collectSecretFindings(nested, nestedPath));
  }
  return findings;
}

function validateHash(value, pathName, findings) {
  if (!isSha256(value)) {
    findings.push(finding(
      'MTR-HASH-001',
      'error',
      `${pathName} must be sha256:<64 lowercase hex>.`,
      pathName,
      'Use the canonical hash emitted by preview or computed for the local evidence file.',
    ));
  }
}

function validateFileEvidence(section, pathName, validator, input, options, findings) {
  if (!filled(section?.filePath)) {
    findings.push(finding(
      'MTR-APPLY-GATE-004',
      'error',
      `${pathName}.filePath is required.`,
      `${pathName}.filePath`,
      'Point to the reviewed local evidence file.',
    ));
    return null;
  }
  validateHash(section?.fileHash, `${pathName}.fileHash`, findings);

  const resolved = resolveLocalPath(section.filePath, options.rootDir);
  try {
    const actualHash = fileHash(resolved);
    if (isSha256(section.fileHash) && actualHash !== section.fileHash) {
      findings.push(finding(
        'MTR-HASH-002',
        'error',
        `${pathName}.fileHash does not match the current file contents.`,
        `${pathName}.fileHash`,
        'Re-review the file and update the hash only after confirming the changed evidence is intended.',
      ));
    }
    const parsed = readJsonFile(resolved);
    const result = validator(parsed);
    if (!result.valid) {
      findings.push(finding(
        pathName === 'preflight' ? 'MTR-PREFLIGHT-001' : 'MTR-PROOF-001',
        'error',
        `${pathName} evidence did not pass its validator.`,
        pathName,
        `Run metro ${pathName === 'preflight' ? 'preflight' : 'proof'} validate on the referenced file and fix the findings before apply can be gated.`,
      ));
    }
    if (section.validationResult !== 'passed') {
      findings.push(finding(
        pathName === 'preflight' ? 'MTR-PREFLIGHT-001' : 'MTR-PROOF-006',
        'error',
        `${pathName}.validationResult must be passed.`,
        `${pathName}.validationResult`,
        'Only passing local evidence can satisfy an apply gate.',
      ));
    }
    if (parsed.workflow !== input.workflow || parsed.shape !== input.shape) {
      findings.push(finding(
        'MTR-APPLY-GATE-005',
        'error',
        `${pathName} workflow and shape must match the apply gate manifest.`,
        pathName,
        'Use evidence for the exact workflow and shape being gated.',
      ));
    }
    return { parsed, result };
  } catch (error) {
    findings.push(finding(
      'MTR-APPLY-GATE-006',
      'error',
      `Failed to read or parse ${pathName} evidence: ${error.message}`,
      `${pathName}.filePath`,
      'Use a readable local JSON evidence file.',
    ));
    return null;
  }
}

function validateTenantCommand(command, tenant, pathName, findings) {
  if (!filled(command)) {
    findings.push(finding(
      'MTR-APPLY-GATE-007',
      'error',
      `${pathName} is required.`,
      pathName,
      'Record the exact command that produced or will consume the reviewed hash.',
    ));
    return;
  }
  const text = String(command);
  if (tenant === 'production' && (!/(^|\s)--prod(\s|$)/.test(text) || /(^|\s)--sandbox(\s|$)/.test(text))) {
    findings.push(finding(
      'MTR-TENANT-001',
      'error',
      `${pathName} must use --prod and must not use --sandbox for a production apply gate.`,
      pathName,
      'Regenerate production approval evidence from a tenant-explicit production preview command.',
    ));
  }
  if (tenant === 'sandbox' && (!/(^|\s)--sandbox(\s|$)/.test(text) || /(^|\s)--prod(\s|$)/.test(text))) {
    findings.push(finding(
      'MTR-TENANT-001',
      'error',
      `${pathName} must use --sandbox and must not use --prod for a sandbox apply gate.`,
      pathName,
      'Use sandbox-only commands for sandbox gates.',
    ));
  }
}

function validateFingerprint(input, findings) {
  const fingerprint = input.keyFingerprint;
  if (!isObject(fingerprint)) {
    findings.push(finding(
      'MTR-TENANT-004',
      'error',
      'keyFingerprint is required.',
      'keyFingerprint',
      'Record non-secret key fingerprint metadata before apply.',
    ));
    return;
  }
  for (const field of ['envVar', 'previewFingerprint', 'applyFingerprint']) {
    if (!filled(fingerprint[field])) {
      findings.push(finding(
        'MTR-TENANT-004',
        'error',
        `keyFingerprint.${field} is required.`,
        `keyFingerprint.${field}`,
        'Record non-secret fingerprint fields; never record raw keys.',
      ));
    }
  }
  if (input.tenant === 'production' && !/PROD|PRODUCTION/.test(String(fingerprint.envVar || ''))) {
    findings.push(finding(
      'MTR-TENANT-001',
      'error',
      'production apply gate must name a production Metronome key environment variable.',
      'keyFingerprint.envVar',
      'Use a production-scoped key env var name such as METRONOME_PROD_KEY.',
    ));
  }
  if (input.tenant === 'sandbox' && !/SANDBOX|TEST/.test(String(fingerprint.envVar || ''))) {
    findings.push(finding(
      'MTR-TENANT-001',
      'error',
      'sandbox apply gate must name a sandbox Metronome key environment variable.',
      'keyFingerprint.envVar',
      'Use a sandbox-scoped key env var name such as METRONOME_SANDBOX_KEY.',
    ));
  }
  if (filled(fingerprint.previewFingerprint) && filled(fingerprint.applyFingerprint)
    && fingerprint.previewFingerprint !== fingerprint.applyFingerprint) {
    findings.push(finding(
      'MTR-TENANT-004',
      'error',
      'keyFingerprint.applyFingerprint must match keyFingerprint.previewFingerprint.',
      'keyFingerprint.applyFingerprint',
      'Re-run preview/preflight with the same tenant key or restart approval if the key changed.',
    ));
  }
}

function validateApplyGate(input, options = {}) {
  const rootDir = options.rootDir || process.cwd();
  const findings = [];

  if (!isObject(input)) {
    return {
      schemaVersion: 'metro.apply-gate.validation.v1',
      valid: false,
      applyEnabledInCurrentCli: false,
      findings: [finding(
        'MTR-APPLY-GATE-000',
        'error',
        'Apply gate manifest must be a JSON object.',
        '$',
        'Start from metro apply-gate template and fill in the evidence fields.',
      )],
      summary: { preflightValidated: false, sandboxProofValidated: false },
    };
  }

  if (input.schemaVersion !== 'metro.apply-gate.v1') {
    findings.push(finding(
      'MTR-APPLY-GATE-001',
      'error',
      'schemaVersion must be metro.apply-gate.v1.',
      'schemaVersion',
      'Start from the current metro apply-gate template.',
    ));
  }

  if (!isApplyGateSupported(input.workflow, input.shape)) {
    findings.push(finding(
      'MTR-APPLY-GATE-002',
      'error',
      'workflow and shape are not a supported apply gate pair.',
      'workflow',
      'Use a gate template for a supported future apply workflow.',
    ));
  }

  if (!['sandbox', 'production'].includes(input.tenant)) {
    findings.push(finding(
      'MTR-TENANT-001',
      'error',
      'tenant must be sandbox or production.',
      'tenant',
      'Apply gates must target exactly one tenant.',
    ));
  }

  if (input.localOnly !== true || input.applyEnabledInCurrentCli !== false) {
    findings.push(finding(
      'MTR-APPLY-GATE-003',
      'error',
      'localOnly must be true and applyEnabledInCurrentCli must be false.',
      'applyEnabledInCurrentCli',
      'This CLI slice validates evidence only; it does not enable live apply execution.',
    ));
  }

  validateTenantCommand(input.preview?.command, input.tenant, 'preview.command', findings);
  validateTenantCommand(input.approval?.command, input.tenant, 'approval.command', findings);
  if (!filled(input.preview?.outputPath)) {
    findings.push(finding(
      'MTR-PREFLIGHT-005',
      'error',
      'preview.outputPath is required.',
      'preview.outputPath',
      'Point to the reviewed preview JSON.',
    ));
  }
  validateHash(input.preview?.payloadHash, 'preview.payloadHash', findings);
  validateHash(input.approval?.confirmHash, 'approval.confirmHash', findings);
  if (isSha256(input.preview?.payloadHash) && isSha256(input.approval?.confirmHash)
    && input.preview.payloadHash !== input.approval.confirmHash) {
    findings.push(finding(
      'MTR-TENANT-002',
      'error',
      'approval.confirmHash must match preview.payloadHash.',
      'approval.confirmHash',
      'Apply confirmation must bind to the exact reviewed preview hash.',
    ));
  }
  if (input.tenant === 'production' && input.approval?.productionConfirmation !== input.preview?.payloadHash) {
    findings.push(finding(
      'MTR-TENANT-002',
      'error',
      'production apply gate requires approval.productionConfirmation to equal the reviewed preview hash.',
      'approval.productionConfirmation',
      'Paste the exact preview hash into productionConfirmation after review.',
    ));
  }
  if (!filled(input.approval?.owner)) {
    findings.push(finding(
      'MTR-APPLY-GATE-008',
      'error',
      'approval.owner is required.',
      'approval.owner',
      'Record the billing-ops owner who reviewed this gate.',
    ));
  }

  validateFingerprint(input, findings);

  const preflightEvidence = validateFileEvidence(input.preflight, 'preflight', validatePreflight, input, { rootDir }, findings);
  if (preflightEvidence?.parsed) {
    const preflight = preflightEvidence.parsed;
    if (preflight.tenant !== input.tenant) {
      findings.push(finding(
        'MTR-TENANT-001',
        'error',
        'preflight tenant must match apply gate tenant.',
        'preflight.tenant',
        'Use preflight evidence generated for the same tenant as the apply gate.',
      ));
    }
    if (preflight.preview?.payloadHash !== input.preview?.payloadHash) {
      findings.push(finding(
        'MTR-TENANT-002',
        'error',
        'preflight preview payload hash must match apply gate preview hash.',
        'preflight.preview.payloadHash',
        'Regenerate or re-review the gate if the preflight references a different preview hash.',
      ));
    }
    if (preflight.execution?.enabledInCurrentCli !== false) {
      findings.push(finding(
        'MTR-APPLY-GATE-003',
        'error',
        'preflight execution.enabledInCurrentCli must remain false.',
        'preflight.execution.enabledInCurrentCli',
        'Do not use this offline gate to silently enable apply execution.',
      ));
    }
  }

  const proofRequired = input.tenant === 'production' || input.sandboxProof?.required === true;
  let sandboxProofValidated = false;
  if (proofRequired) {
    const proofEvidence = validateFileEvidence(input.sandboxProof, 'sandboxProof', validateSandboxProof, input, { rootDir }, findings);
    sandboxProofValidated = Boolean(proofEvidence?.result?.valid);
    if (input.sandboxProof?.required !== true) {
      findings.push(finding(
        'MTR-VERIFY-003',
        'error',
        'production apply gates require sandboxProof.required=true.',
        'sandboxProof.required',
        'Production gates must cite passing sandbox proof for the same workflow and shape.',
      ));
    }
  }

  if (!filled(input.auditLog?.destination)) {
    findings.push(finding(
      'MTR-AUDIT-001',
      'error',
      'auditLog.destination is required.',
      'auditLog.destination',
      'Record the JSONL audit log path the future apply runner must write.',
    ));
  }
  if (input.verification?.readBackRequired !== true) {
    findings.push(finding(
      'MTR-VERIFY-001',
      'error',
      'verification.readBackRequired must be true.',
      'verification.readBackRequired',
      'Every apply gate must require read-back verification after writes.',
    ));
  }
  if (input.rollback?.reviewed !== true || !filled(input.rollback?.owner)) {
    findings.push(finding(
      'MTR-VERIFY-002',
      'error',
      'rollback.reviewed=true and rollback.owner are required.',
      'rollback',
      'Record rollback ownership before apply can be gated.',
    ));
  }
  if (input.idempotency?.reviewed !== true) {
    findings.push(finding(
      'MTR-IDEMP-001',
      'error',
      'idempotency.reviewed must be true.',
      'idempotency.reviewed',
      'Review uniqueness keys or duplicate-prevention strategy before apply.',
    ));
  }

  findings.push(...collectSecretFindings(input));

  return {
    schemaVersion: 'metro.apply-gate.validation.v1',
    inspectedSchemaVersion: input.schemaVersion || null,
    workflow: input.workflow || null,
    shape: input.shape || null,
    tenant: input.tenant || null,
    valid: !findings.some((item) => item.severity === 'error'),
    applyEnabledInCurrentCli: false,
    findings,
    summary: {
      preflightValidated: Boolean(preflightEvidence?.result?.valid),
      sandboxProofRequired: proofRequired,
      sandboxProofValidated,
      auditDestination: input.auditLog?.destination || null,
    },
  };
}

module.exports = {
  buildApplyGateTemplate,
  validateApplyGate,
};
