'use strict';

function list(value) {
  return Array.isArray(value) ? value : [];
}

function nonEmpty(value) {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

function normalizePath(value) {
  return String(value || '').trim().replace(/\\/g, '/').replace(/^\.\//, '');
}

function finding(id, severity, message, path, remediation) {
  return { id, severity, message, path, remediation };
}

// Evidence from a previous (external) billing system is historical context
// only: it can explain a migration, but it must never back a current workflow.
const EXTERNAL_BILLING_EVIDENCE_KEY = 'externalBillingEvidence';
const EXTERNAL_BILLING_ASSERTION_KEY = 'noExternalBillingCurrentIntegration';
// Deprecated input names, accepted for one release (0.2.x) with a warning, then removed.
const DEPRECATED_KEYS = { evidence: 'hyperlineEvidence', assertion: 'noHyperlineCurrentIntegration' }; // leak-allow: deprecated alias, remove after 0.2.x
const EXTERNAL_BILLING_SOURCE_TYPES = ['external-billing-evidence', 'legacy-billing-evidence'];
const EXTERNAL_BILLING_PATH = /(^|[/_.-])(legacy|previous|external|old)[-_]billing([/_.-]|$)/i;

function deprecationWarning(oldKey, newKey) {
  return {
    id: 'MTR-REPO-003',
    severity: 'warning',
    message: `${oldKey} is deprecated; rename it to ${newKey}. The old name is accepted until the next minor release.`,
    path: oldKey,
    remediation: `Rename ${oldKey} to ${newKey} in the source-boundary manifest.`,
  };
}

function externalBillingEvidence(input, warnings) {
  if (input[EXTERNAL_BILLING_EVIDENCE_KEY] && typeof input[EXTERNAL_BILLING_EVIDENCE_KEY] === 'object') {
    return { evidence: input[EXTERNAL_BILLING_EVIDENCE_KEY], label: EXTERNAL_BILLING_EVIDENCE_KEY };
  }
  if (input[DEPRECATED_KEYS.evidence] && typeof input[DEPRECATED_KEYS.evidence] === 'object') {
    warnings.push(deprecationWarning(DEPRECATED_KEYS.evidence, EXTERNAL_BILLING_EVIDENCE_KEY));
    return { evidence: input[DEPRECATED_KEYS.evidence], label: DEPRECATED_KEYS.evidence };
  }
  return { evidence: {}, label: EXTERNAL_BILLING_EVIDENCE_KEY };
}

function isGeneratedArtifactPath(filePath) {
  const normalized = normalizePath(filePath);
  return (
    /^(output|outputs|reports)\//.test(normalized)
    || /^absolute-historical-financial-data/.test(normalized)
    || /^arr-historicals-/.test(normalized)
    || /^(legacy|previous|external)-billing-export\//.test(normalized)
    || /^(legacy|previous|external)-billing-(live-)?snapshot/.test(normalized)
    || /^metronome\/logs\//.test(normalized)
    || /^metronome\/[^/]+\/results\//.test(normalized)
  );
}

function isOneOffScriptPath(filePath) {
  const normalized = normalizePath(filePath);
  if (!/\.(js|mjs|cjs|py)$/.test(normalized)) return false;
  return (
    /^[^/]+\.(js|mjs|cjs|py)$/.test(normalized)
    || /^scripts\//.test(normalized)
    || /^archive\//.test(normalized)
    || /^migration\//.test(normalized)
    || /^metronome\/cutover\/(one-offs|probes)\//.test(normalized)
    || /^metronome\/setup-/.test(normalized)
    || /^metronome\/.*(migrate|migration|repair|retry|wipe|force|provision|transition|cleanup|archive|remove)/.test(normalized)
  );
}

function isExternalBillingSource(source) {
  return (
    EXTERNAL_BILLING_SOURCE_TYPES.includes(String(source.sourceType || ''))
    || source.externalBilling === true
    || EXTERNAL_BILLING_PATH.test(normalizePath(source.path))
  );
}

function isHistoricalOrGeneratedType(sourceType) {
  return [
    'generated-artifact',
    'generated-evidence',
    'historical-evidence',
    'legacy-evidence',
    'one-off-script',
    'quarantined-script',
  ].includes(String(sourceType || ''));
}

const REQUIRED_REVIEWED_DOCS = [
  'docs/SAFETY.md',
  'docs/metronome-cli/one-goal.md',
  'docs/metronome-cli/CLI_ARCHITECTURE.md',
];

function buildSourceBoundaryTemplate({ workflow = '<workflow>', shape = '<shape>' } = {}) {
  return {
    schemaVersion: 'metro.source-boundary.v1',
    workflow,
    shape,
    localOnly: true,
    requiredReviewedDocs: [...REQUIRED_REVIEWED_DOCS],
    currentSources: [
      {
        path: 'docs/metronome-cli/one-goal.md',
        sourceType: 'current-source',
        role: 'goal',
        reviewed: true,
      },
      {
        path: 'packages/metro-core/src/cli.js',
        sourceType: 'current-source',
        role: 'command-handler',
        reviewed: true,
      },
    ],
    generatedArtifacts: [
      {
        path: '<optional-generated-proof-or-golden>',
        sourceType: 'generated-evidence',
        role: 'proof-only',
        usedAsCanonicalSource: false,
        boundaryDoc: '<boundary-doc-or-test>',
        reviewed: true,
      },
    ],
    entryPoints: [
      {
        path: 'packages/metro-core/src/cli.js',
        sourceType: 'current-source',
        role: 'command-handler',
        importedAsCommandHandler: true,
        oneOffScript: false,
        reviewedAgainst: 'docs/metronome-cli/CLI_ARCHITECTURE.md',
      },
      {
        path: '<legacy-or-quarantined-script-if-used-as-evidence>',
        sourceType: 'quarantined-script',
        role: 'historical-reference-only',
        importedAsCommandHandler: false,
        oneOffScript: true,
        reviewedAgainst: '<script-review-note>',
      },
    ],
    externalBillingEvidence: {
      used: false,
      usedAsCurrentIntegration: false,
      explicitlyRequested: false,
      usagePurpose: 'not-used',
    },
    assertions: {
      noOneOffScriptCommandHandlers: true,
      noGeneratedArtifactAsCanonicalSource: true,
      noExternalBillingCurrentIntegration: true,
    },
  };
}

function validateRequiredDocs(input, findings) {
  const reviewedDocs = new Set([
    ...list(input.requiredReviewedDocs).map(normalizePath),
    ...list(input.currentSources).map((source) => normalizePath(source.path)),
  ]);
  for (const doc of REQUIRED_REVIEWED_DOCS) {
    if (!reviewedDocs.has(doc)) {
      findings.push(finding(
        'MTR-REPO-002',
        'error',
        `source-boundary manifest must include reviewed required context ${doc}.`,
        'requiredReviewedDocs',
        'Add the required context file to requiredReviewedDocs or currentSources before using this manifest as workflow evidence.',
      ));
    }
  }
}

function validateCurrentSources(input, findings) {
  const sources = list(input.currentSources);
  if (sources.length === 0) {
    findings.push(finding(
      'MTR-REPO-002',
      'error',
      'source-boundary manifest must include at least one reviewed current source.',
      'currentSources',
      'Add current source files such as docs, CLI modules, fixtures, or tests that support the workflow.',
    ));
    return;
  }

  sources.forEach((source, index) => {
    const pathLabel = `currentSources[${index}]`;
    const sourcePath = normalizePath(source.path);
    if (!nonEmpty(sourcePath)) {
      findings.push(finding('MTR-REPO-002', 'error', 'current source path is required.', `${pathLabel}.path`, 'Provide a repo-relative source path.'));
      return;
    }
    if (source.reviewed !== true) {
      findings.push(finding(
        'MTR-REPO-002',
        'error',
        `${sourcePath} must be marked reviewed before it can support workflow evidence.`,
        `${pathLabel}.reviewed`,
        'Read the source and set reviewed:true only after checking it for the current task.',
      ));
    }
    if (isGeneratedArtifactPath(sourcePath) || isHistoricalOrGeneratedType(source.sourceType)) {
      findings.push(finding(
        'MTR-REPO-002',
        'error',
        `${sourcePath} is generated, historical, or quarantined evidence and cannot be a current source.`,
        pathLabel,
        'Move this entry to generatedArtifacts or entryPoints and cite a current source for the workflow logic.',
      ));
    }
    if (isExternalBillingSource(source) && source.usedAsCurrentIntegration === true) {
      findings.push(finding(
        'MTR-REPO-003',
        'error',
        `${sourcePath} is evidence from a previous billing system and cannot support a current billing integration.`,
        pathLabel,
        'Use previous-billing-system evidence only for historical migration context unless the user explicitly asks for legacy work.',
      ));
    }
  });
}

function validateGeneratedArtifacts(input, findings) {
  list(input.generatedArtifacts).forEach((artifact, index) => {
    const pathLabel = `generatedArtifacts[${index}]`;
    const artifactPath = normalizePath(artifact.path);
    if (!nonEmpty(artifactPath)) {
      findings.push(finding('MTR-REPO-002', 'error', 'generated artifact path is required.', `${pathLabel}.path`, 'Provide a repo-relative generated artifact or proof path.'));
      return;
    }
    if (artifact.usedAsCanonicalSource !== false) {
      findings.push(finding(
        'MTR-REPO-002',
        'error',
        `${artifactPath} must be evidence-only and cannot be the canonical source for workflow logic.`,
        `${pathLabel}.usedAsCanonicalSource`,
        'Set usedAsCanonicalSource:false and cite current source files for the workflow behavior.',
      ));
    }
    if (!nonEmpty(artifact.boundaryDoc)) {
      findings.push(finding(
        'MTR-REPO-002',
        'error',
        `${artifactPath} needs a boundary document or test that explains how the artifact may be used.`,
        `${pathLabel}.boundaryDoc`,
        'Cite a boundary document, a test, or another reviewed source that explains how the artifact may be used.',
      ));
    }
    if (artifact.reviewed !== true) {
      findings.push(finding(
        'MTR-REPO-002',
        'error',
        `${artifactPath} must be reviewed before it can be used as evidence.`,
        `${pathLabel}.reviewed`,
        'Review the artifact boundary and mark reviewed:true only after checking it for the current task.',
      ));
    }
  });
}

function validateEntryPoints(input, findings) {
  list(input.entryPoints).forEach((entry, index) => {
    const pathLabel = `entryPoints[${index}]`;
    const entryPath = normalizePath(entry.path);
    if (!nonEmpty(entryPath)) {
      findings.push(finding('MTR-REPO-001', 'error', 'entry point path is required.', `${pathLabel}.path`, 'Provide a repo-relative entry point path.'));
      return;
    }

    const oneOff = (
      entry.oneOffScript === true
      || ['one-off-script', 'quarantined-script', 'historical-script', 'legacy-script'].includes(String(entry.sourceType || ''))
      || isOneOffScriptPath(entryPath)
    );
    const promoted = (
      entry.importedAsCommandHandler === true
      || entry.exposedAsCliCommand === true
      || nonEmpty(entry.commandId)
    );

    if (oneOff && promoted) {
      findings.push(finding(
        'MTR-REPO-001',
        'error',
        `${entryPath} is a one-off or quarantined script and must not be promoted as a CLI command handler.`,
        pathLabel,
        'Extract reusable logic into packages/metro-core/src with tests; leave the runnable one-off quarantined as evidence only.',
      ));
    }
    if (oneOff && !nonEmpty(entry.reviewedAgainst)) {
      findings.push(finding(
        'MTR-REPO-001',
        'error',
        `${entryPath} is one-off or quarantined evidence and needs a reviewed policy/source-baseline reference.`,
        `${pathLabel}.reviewedAgainst`,
        'Cite a reviewed script policy or review note before using it as evidence.',
      ));
    }
  });
}

function validateExternalBilling(input, findings, warnings) {
  const { evidence, label } = externalBillingEvidence(input, warnings);
  if (evidence.usedAsCurrentIntegration === true) {
    findings.push(finding(
      'MTR-REPO-003',
      'error',
      'Evidence from a previous billing system must not be used as a current billing integration.',
      `${label}.usedAsCurrentIntegration`,
      'Use current Metronome, payment-provider, or CRM evidence for current workflows; keep the previous billing system historical unless explicitly requested.',
    ));
  }
  if (evidence.used === true && evidence.explicitlyRequested !== true && evidence.usagePurpose !== 'historical-evidence') {
    findings.push(finding(
      'MTR-REPO-003',
      'error',
      'Previous-billing-system evidence is used without an explicit legacy request or historical-evidence purpose.',
      label,
      'Set usagePurpose:"historical-evidence" for old migration context or remove the previous billing system evidence from the current workflow.',
    ));
  }
  return evidence;
}

function validateAssertions(input, findings, warnings) {
  const assertions = input.assertions || {};
  let externalBillingAssertion = assertions[EXTERNAL_BILLING_ASSERTION_KEY];
  if (externalBillingAssertion === undefined && assertions[DEPRECATED_KEYS.assertion] !== undefined) {
    warnings.push(deprecationWarning(`assertions.${DEPRECATED_KEYS.assertion}`, `assertions.${EXTERNAL_BILLING_ASSERTION_KEY}`));
    externalBillingAssertion = assertions[DEPRECATED_KEYS.assertion];
  }
  if (assertions.noOneOffScriptCommandHandlers !== true) {
    findings.push(finding(
      'MTR-REPO-001',
      'error',
      'source-boundary assertions must confirm no one-off scripts are command handlers.',
      'assertions.noOneOffScriptCommandHandlers',
      'Set the assertion only after validating entryPoints and extracting any reusable logic into tested CLI modules.',
    ));
  }
  if (assertions.noGeneratedArtifactAsCanonicalSource !== true) {
    findings.push(finding(
      'MTR-REPO-002',
      'error',
      'source-boundary assertions must confirm generated artifacts are evidence-only.',
      'assertions.noGeneratedArtifactAsCanonicalSource',
      'Set the assertion only after current source files support the workflow and generated artifacts are evidence-only.',
    ));
  }
  if (externalBillingAssertion !== true) {
    findings.push(finding(
      'MTR-REPO-003',
      'error',
      'source-boundary assertions must confirm the previous billing system is not a current integration.',
      `assertions.${EXTERNAL_BILLING_ASSERTION_KEY}`,
      'Set the assertion only after removing the previous billing system from current workflow dependencies.',
    ));
  }
}

function validateSourceBoundary(input) {
  const findings = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    findings.push(finding('MTR-REPO-002', 'error', 'source-boundary input must be a JSON object.', '', 'Use metro source-boundary template --json as the starting point.'));
    return {
      schemaVersion: 'metro.source-boundary.validation.v1',
      apiAccess: 'none',
      valid: false,
      findings,
      warnings: [],
      summary: {
        currentSourceCount: 0,
        generatedArtifactCount: 0,
        entryPointCount: 0,
      },
    };
  }

  if (input.schemaVersion !== 'metro.source-boundary.v1') {
    findings.push(finding(
      'MTR-REPO-002',
      'error',
      'source-boundary manifest must use schemaVersion metro.source-boundary.v1.',
      'schemaVersion',
      'Regenerate the manifest with metro source-boundary template --json.',
    ));
  }

  validateRequiredDocs(input, findings);
  validateCurrentSources(input, findings);
  validateGeneratedArtifacts(input, findings);
  validateEntryPoints(input, findings);
  const warnings = [];
  const evidence = validateExternalBilling(input, findings, warnings);
  validateAssertions(input, findings, warnings);

  return {
    schemaVersion: 'metro.source-boundary.validation.v1',
    apiAccess: 'none',
    workflow: input.workflow || null,
    shape: input.shape || null,
    valid: findings.length === 0,
    findings,
    warnings,
    summary: {
      currentSourceCount: list(input.currentSources).length,
      generatedArtifactCount: list(input.generatedArtifacts).length,
      entryPointCount: list(input.entryPoints).length,
      externalBillingUsed: evidence.used === true,
    },
  };
}

module.exports = {
  buildSourceBoundaryTemplate,
  isGeneratedArtifactPath,
  isOneOffScriptPath,
  validateSourceBoundary,
};
