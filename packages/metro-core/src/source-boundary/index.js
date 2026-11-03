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

function isGeneratedArtifactPath(filePath) {
  const normalized = normalizePath(filePath);
  return (
    /^(output|outputs|reports)\//.test(normalized)
    || /^absolute-historical-financial-data/.test(normalized)
    || /^arr-historicals-/.test(normalized)
    || /^hyperline-export\//.test(normalized)
    || /^hyperline-live-snapshot/.test(normalized)
    || /^hyperline-historical-export\.json$/.test(normalized)
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

function isHistoricalHyperlinePath(filePath) {
  return /hyperline/i.test(normalizePath(filePath));
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
  'docs/REPO_MAP.md',
  'docs/SOURCE_BASELINE.md',
  'docs/metronome-cli/one-goal.md',
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
        path: 'metronome-cli/src/cli.js',
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
        boundaryDoc: 'docs/cleanup/artifact-boundaries.generated.md',
        reviewed: true,
      },
    ],
    entryPoints: [
      {
        path: 'metronome-cli/src/cli.js',
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
        reviewedAgainst: 'tools/script-policy.json',
      },
    ],
    hyperlineEvidence: {
      used: false,
      usedAsCurrentIntegration: false,
      explicitlyRequested: false,
      usagePurpose: 'not-used',
    },
    assertions: {
      noOneOffScriptCommandHandlers: true,
      noGeneratedArtifactAsCanonicalSource: true,
      noHyperlineCurrentIntegration: true,
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
    if (isHistoricalHyperlinePath(sourcePath) && source.usedAsCurrentIntegration === true) {
      findings.push(finding(
        'MTR-REPO-003',
        'error',
        `${sourcePath} is Hyperline-named evidence and cannot support a current billing integration.`,
        pathLabel,
        'Use Hyperline evidence only for historical migration context unless the user explicitly asks for legacy work.',
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
        'Cite docs/cleanup/artifact-boundaries.generated.md, a golden test, or another reviewed boundary source.',
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
        'Extract reusable logic into metronome-cli/src with tests; leave the runnable one-off quarantined as evidence only.',
      ));
    }
    if (oneOff && !nonEmpty(entry.reviewedAgainst)) {
      findings.push(finding(
        'MTR-REPO-001',
        'error',
        `${entryPath} is one-off or quarantined evidence and needs a reviewed policy/source-baseline reference.`,
        `${pathLabel}.reviewedAgainst`,
        'Cite tools/script-policy.json, docs/SCRIPT_RISK.generated.md, or docs/SOURCE_BASELINE.generated.md before using it as evidence.',
      ));
    }
  });
}

function validateHyperline(input, findings) {
  const evidence = input.hyperlineEvidence || {};
  if (evidence.usedAsCurrentIntegration === true) {
    findings.push(finding(
      'MTR-REPO-003',
      'error',
      'Hyperline evidence must not be used as a current billing integration.',
      'hyperlineEvidence.usedAsCurrentIntegration',
      'Use current Metronome/Stripe/CRM evidence for current workflows; keep Hyperline historical unless explicitly requested.',
    ));
  }
  if (evidence.used === true && evidence.explicitlyRequested !== true && evidence.usagePurpose !== 'historical-evidence') {
    findings.push(finding(
      'MTR-REPO-003',
      'error',
      'Hyperline evidence is used without an explicit legacy request or historical-evidence purpose.',
      'hyperlineEvidence',
      'Set usagePurpose:"historical-evidence" for old migration context or remove Hyperline evidence from the current workflow.',
    ));
  }
}

function validateAssertions(input, findings) {
  const assertions = input.assertions || {};
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
  if (assertions.noHyperlineCurrentIntegration !== true) {
    findings.push(finding(
      'MTR-REPO-003',
      'error',
      'source-boundary assertions must confirm Hyperline is not a current integration.',
      'assertions.noHyperlineCurrentIntegration',
      'Set the assertion only after removing Hyperline from current workflow dependencies.',
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
  validateHyperline(input, findings);
  validateAssertions(input, findings);

  return {
    schemaVersion: 'metro.source-boundary.validation.v1',
    apiAccess: 'none',
    workflow: input.workflow || null,
    shape: input.shape || null,
    valid: findings.length === 0,
    findings,
    summary: {
      currentSourceCount: list(input.currentSources).length,
      generatedArtifactCount: list(input.generatedArtifacts).length,
      entryPointCount: list(input.entryPoints).length,
      hyperlineUsed: input.hyperlineEvidence?.used === true,
    },
  };
}

module.exports = {
  buildSourceBoundaryTemplate,
  isGeneratedArtifactPath,
  isOneOffScriptPath,
  validateSourceBoundary,
};
