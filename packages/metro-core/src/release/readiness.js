'use strict';

const fs = require('fs');
const path = require('path');
const packageManifest = require('../../../../package.json');

const RELEASE_READINESS_SCHEMA_VERSION = 'metro.release.readiness.v1';
const RELEASE_ARTIFACT_MANIFEST_SCHEMA_VERSION = 'metro.release.artifact-manifest.v1';
const RELEASE_EVIDENCE_CHECK_SCHEMA_VERSION = 'metro.release.evidence-check.v1';
const RELEASE_EVIDENCE_PLAN_SCHEMA_VERSION = 'metro.release.evidence-plan.v1';
const RELEASE_RETENTION_POLICY_SCHEMA_VERSION = 'metro.release.retention-policy.v1';
const RELEASE_RETENTION_POLICY_VALIDATION_SCHEMA_VERSION = 'metro.release.retention-policy.validation.v1';

const RETAINED_VALIDATION_ARTIFACT_FILENAMES = [
  'metro.release-evidence-check.json',
];

const REQUIRED_RETENTION_POLICY_CHECKS = [
  'node metronome-cli/bin/metro.js release artifact-manifest --json',
  'node metronome-cli/bin/metro.js release evidence-check --dir <artifact-dir> --json',
  'npm --prefix metronome-cli test',
  'node docs/metronome-cli/site/verify-site.js',
  'npm run check:syntax',
  'npm run secrets:scan',
];

const REQUIRED_RETENTION_POLICY_ACKNOWLEDGEMENTS = [
  'no-env-files',
  'no-npm-token-storage',
  'no-npm-registry-or-publish',
  'no-live-api-authorization',
  'no-source-folder-artifacts',
];

const RELEASE_ARTIFACT_SOURCE_DIRS = [
  '.cursor',
  '.github',
  'archive',
  'docs',
  'lib',
  'metronome',
  'metronome-cli',
  'migration',
  'scripts',
  'stripe-invoice-notifier',
  'tests',
  'tools',
];

function packageFilesAllowlist(manifest) {
  return Array.isArray(manifest.files) ? [...manifest.files] : [];
}

function hasMetroBinary(manifest) {
  return Boolean(manifest.bin && manifest.bin.metro === 'bin/metro.js');
}

function buildReleaseReadiness(options = {}) {
  const manifest = options.packageManifest || packageManifest;
  const filesAllowlist = packageFilesAllowlist(manifest);
  const manifestPrivateFlag = manifest.private === true;
  const metroBinaryDeclared = hasMetroBinary(manifest);
  const runtimeFilesAllowlisted = ['bin/', 'src/', 'README.md']
    .every((entry) => filesAllowlist.includes(entry));

  return {
    schemaVersion: RELEASE_READINESS_SCHEMA_VERSION,
    generatedFrom: [
      'metronome-cli/src/release/readiness.js',
      'metronome-cli/package.json',
      'metronome-cli/test/package.test.js',
      'metronome-cli/test/install.test.js',
    ],
    apiAccess: 'none',
    localOnly: true,
    liveExecution: {
      enabledInCurrentCli: false,
      metronome: false,
      stripe: false,
      hubspot: false,
      hyperline: false,
      posthog: false,
      slack: false,
      npmRegistry: false,
    },
    package: {
      name: manifest.name,
      version: manifest.version,
      private: manifestPrivateFlag,
      description: manifest.description,
      bin: { ...(manifest.bin || {}) },
      metroBinaryDeclared,
      filesAllowlist,
      runtimeFilesAllowlisted,
    },
    installTarget: {
      targetCommand: 'npm install -g @metrocli/metro',
      targetStatus: 'planned',
      currentlyProvenPath: 'local tarball install smoke test',
      currentlyProvenCommand: 'npm --prefix metronome-cli run test:install',
    },
    publish: {
      readyForPublish: false,
      enabledInCurrentCli: false,
      canRemovePrivateFlag: false,
      canAddPublishWorkflow: false,
      canUseNpmToken: false,
      registryChecked: false,
      tokenLoaded: false,
      dryRunAgainstRegistryPerformed: false,
      decision: 'not-ready-to-publish',
    },
    localProof: [
      {
        id: 'package-dry-run',
        command: 'npm --prefix metronome-cli run test:package',
        status: 'available-local-command',
        proves: [
          'npm pack --dry-run includes runtime CLI files.',
          'The metro binary is included and executable in the package tarball.',
          'test/, node_modules/, and .env paths are excluded from the package tarball.',
        ],
        sourceIds: ['metro-package-test'],
      },
      {
        id: 'install-smoke-test',
        command: 'npm --prefix metronome-cli run test:install',
        status: 'available-local-command',
        proves: [
          'npm pack writes a local tarball.',
          'npm install --global --prefix <tmp> exposes a metro binary from that tarball.',
          'The installed metro binary can run metro shape list --json without Metronome keys.',
        ],
        sourceIds: ['metro-install-test'],
      },
      {
        id: 'command-contracts',
        command: 'npm --prefix metronome-cli run test:golden',
        status: 'available-local-command',
        proves: [
          'Stable JSON output contracts match checked golden fixtures.',
          'Release readiness output is covered by a checked golden fixture.',
          'Release evidence-plan output is covered by a checked golden fixture.',
          'Release evidence-check output is covered by a checked golden fixture.',
        ],
        sourceIds: ['metro-release-readiness-golden', 'metro-release-evidence-plan-golden', 'metro-release-evidence-check-golden'],
      },
      {
        id: 'docs-site-verifier',
        command: 'node docs/metronome-cli/site/verify-site.js',
        status: 'available-local-command',
        proves: [
          'The docs site source map and command references include the release readiness surface.',
          'The install page keeps publishing blocked until registry, provenance, approval, versioning, and integrity evidence exist.',
        ],
        sourceIds: [
          'metro-release-readiness-golden',
          'metro-release-artifact-manifest-golden',
          'metro-release-evidence-plan-golden',
          'metro-release-evidence-check-golden',
          'metro-docs-explain-package-publish-readiness-golden',
        ],
      },
    ],
    blockers: [
      {
        blockerId: 'METRO-PUBLISH-001',
        title: 'Package manifest is private',
        status: manifestPrivateFlag ? 'blocking' : 'requires-review',
        evidence: 'metronome-cli/package.json declares "private": true.',
        nextSafeStep: 'Keep private:true until registry destination, owner approval, versioning, provenance, integrity, and publish proof are reviewed.',
      },
      {
        blockerId: 'METRO-PUBLISH-002',
        title: 'Internal registry destination is not documented',
        status: 'blocking',
        evidence: 'The target npm install -g @metrocli/metro path remains planned, not proven by registry evidence.',
        nextSafeStep: 'Document the internal registry URL or distribution channel, package scope owner, authentication model, and publish permissions.',
      },
      {
        blockerId: 'METRO-PUBLISH-003',
        title: 'Release provenance and approval evidence are missing',
        status: 'blocking',
        evidence: 'Current proof covers local package and install smoke tests only.',
        nextSafeStep: 'Define release approval, version bump, changelog, source-baseline, package integrity, and provenance requirements.',
      },
      {
        blockerId: 'METRO-PUBLISH-004',
        title: 'Publish dry-run proof is missing',
        status: 'blocking',
        evidence: 'No registry-specific publish dry-run or equivalent package-upload proof exists in the current CLI.',
        nextSafeStep: 'Add a secret-safe publish proof that does not read .env files or print npm tokens before enabling any publish workflow.',
      },
    ],
    requiredEvidenceBeforePublish: [
      'Internal registry URL or package distribution channel.',
      'Package owner and release approver roles.',
      'Versioning policy and changelog requirement.',
      'Release provenance, package integrity, or signing-equivalent evidence.',
      'Reviewed release evidence output directory and retention policy.',
      'Secret-safe publish dry-run or registry-specific publish proof.',
      'Passing syntax, secret scan, package tests, install smoke test, command contract goldens, and docs site verification.',
    ],
    safeLocalCommands: [
      'node metronome-cli/bin/metro.js release readiness --json',
      'node metronome-cli/bin/metro.js release artifact-manifest --json',
      'node metronome-cli/bin/metro.js release retention-policy template --json',
      'node metronome-cli/bin/metro.js release retention-policy validate --file <policy.json|yaml> --json',
      'node metronome-cli/bin/metro.js release evidence-plan --policy <policy.json|yaml> --json',
      'node metronome-cli/bin/metro.js release evidence-check --dir <artifact-dir> --json',
      'npm --prefix metronome-cli run test:package',
      'npm --prefix metronome-cli run test:install',
      'npm --prefix metronome-cli run test:golden',
      'npm --prefix metronome-cli test',
      'npm run check:syntax',
      'npm run secrets:scan',
      'node docs/metronome-cli/site/verify-site.js',
      'node metronome-cli/bin/metro.js docs explain package.publish-readiness --json',
    ],
    refusedActions: [
      'Remove private:true from metronome-cli/package.json.',
      'Run npm publish.',
      'Handle npm tokens in the CLI or docs.',
      'Treat local tarball install proof as internal registry proof.',
      'Enable live Metronome reads or writes through the published binary without the normal tenant, preflight, audit, approval, rollback, and read-back gates.',
    ],
    sourceIds: [
      'metro-release-readiness-golden',
      'metro-release-evidence-plan-golden',
      'metro-release-evidence-check-golden',
      'metro-release-retention-policy-golden',
      'metro-package-test',
      'metro-install-test',
      'metro-docs-explain-package-publish-readiness-golden',
    ],
    nextSafeStep: 'Run the local package/install/readiness checks, validate a release retention policy, generate a release evidence plan, then document registry, owner, approval, versioning, provenance, integrity, and publish dry-run evidence before changing package publication state.',
  };
}

function buildReleaseArtifactManifest(options = {}) {
  const readiness = buildReleaseReadiness(options);

  return {
    schemaVersion: RELEASE_ARTIFACT_MANIFEST_SCHEMA_VERSION,
    generatedFrom: [
      'metronome-cli/src/release/readiness.js',
      'metronome-cli/src/commands/catalog.js',
      'metronome-cli/src/docs/explain.js',
      'metronome-cli/test/golden.test.js',
      'docs/metronome-cli/site/integration.html',
    ],
    apiAccess: 'none',
    localOnly: true,
    writesFiles: false,
    liveExecution: { ...readiness.liveExecution },
    package: { ...readiness.package },
    purpose: 'Plan the local CI/release evidence bundle for the metro package without creating artifacts, reading npm registry state, loading tokens, or authorizing publish.',
    recommendedArtifacts: [
      {
        artifactId: 'metro.schema',
        filename: 'metro.schema.json',
        sourceCommand: 'node metronome-cli/bin/metro.js schema --json',
        schemaVersion: 'metro.docs.command-reference.v1',
        required: true,
        proves: [
          'The installed command catalog is machine-readable.',
          'Automation can discover local command contracts without scraping HTML.',
        ],
        retentionStatus: 'operator-owned',
        sourceIds: ['metro-command-reference-golden'],
      },
      {
        artifactId: 'metro.command-reference',
        filename: 'metro.command-reference.json',
        sourceCommand: 'node metronome-cli/bin/metro.js docs command-reference --json',
        schemaVersion: 'metro.docs.command-reference.v1',
        required: true,
        proves: [
          'The documented command surface matches the local command catalog.',
          'Release and safety commands declare apiAccess and schema versions.',
        ],
        retentionStatus: 'operator-owned',
        sourceIds: ['metro-command-reference-golden'],
      },
      {
        artifactId: 'metro.docs-explain.topic-index',
        filename: 'metro.docs-explain.topic-index.json',
        sourceCommand: 'node metronome-cli/bin/metro.js docs explain --list --json',
        schemaVersion: 'metro.docs.explain.index.v1',
        required: true,
        proves: [
          'Source-linked operating topics are discoverable by agents.',
          'Package publish readiness and CI local-check topics remain indexed.',
        ],
        retentionStatus: 'operator-owned',
        sourceIds: ['metro-docs-explain-topic-index-golden'],
      },
      {
        artifactId: 'metro.api-readiness.summary',
        filename: 'metro.api-readiness.summary.json',
        sourceCommand: 'node metronome-cli/bin/metro.js api readiness --summary --json',
        schemaVersion: 'metro.api.readiness.summary.v1',
        required: true,
        proves: [
          'Expert endpoint catalog proof ladders are summarized locally.',
          'Live API execution remains disabled for the current CLI release.',
        ],
        retentionStatus: 'operator-owned',
        sourceIds: ['metro-api-readiness-summary-golden'],
      },
      {
        artifactId: 'metro.release-readiness',
        filename: 'metro.release-readiness.json',
        sourceCommand: 'node metronome-cli/bin/metro.js release readiness --json',
        schemaVersion: RELEASE_READINESS_SCHEMA_VERSION,
        required: true,
        proves: [
          'Package/install proof exists for the local tarball path.',
          'Publish, registry, token, provenance, approval, and integrity blockers remain explicit.',
        ],
        retentionStatus: 'operator-owned',
        sourceIds: ['metro-release-readiness-golden'],
      },
      {
        artifactId: 'metro.release-artifact-manifest',
        filename: 'metro.release-artifact-manifest.json',
        sourceCommand: 'node metronome-cli/bin/metro.js release artifact-manifest --json',
        schemaVersion: RELEASE_ARTIFACT_MANIFEST_SCHEMA_VERSION,
        required: true,
        proves: [
          'The release evidence bundle plan is itself stable and source-linked.',
          'The command does not create artifacts or touch npm registry state.',
        ],
        retentionStatus: 'operator-owned',
        sourceIds: ['metro-release-artifact-manifest-golden'],
      },
      {
        artifactId: 'site-verify',
        filename: 'site-verify.log',
        sourceCommand: 'node docs/metronome-cli/site/verify-site.js',
        schemaVersion: null,
        required: true,
        proves: [
          'The static docs site source map and generated references are internally consistent.',
          'Release readiness and artifact-manifest surfaces are present in docs.',
        ],
        retentionStatus: 'operator-owned',
        sourceIds: ['metro-docs-site-verifier'],
      },
      {
        artifactId: 'package-dry-run',
        filename: 'package-dry-run.log',
        sourceCommand: 'npm --prefix metronome-cli run test:package',
        schemaVersion: null,
        required: true,
        proves: readiness.localProof.find((proof) => proof.id === 'package-dry-run').proves,
        retentionStatus: 'operator-owned',
        sourceIds: ['metro-package-test'],
      },
      {
        artifactId: 'install-smoke',
        filename: 'install-smoke.log',
        sourceCommand: 'npm --prefix metronome-cli run test:install',
        schemaVersion: null,
        required: true,
        proves: readiness.localProof.find((proof) => proof.id === 'install-smoke-test').proves,
        retentionStatus: 'operator-owned',
        sourceIds: ['metro-install-test'],
      },
      {
        artifactId: 'syntax-check',
        filename: 'syntax-check.log',
        sourceCommand: 'npm run check:syntax',
        schemaVersion: null,
        required: true,
        proves: [
          'Repository JavaScript and package syntax checks pass for the reviewed workspace.',
        ],
        retentionStatus: 'operator-owned',
        sourceIds: ['repo-syntax-check'],
      },
      {
        artifactId: 'secret-scan',
        filename: 'secret-scan.log',
        sourceCommand: 'npm run secrets:scan',
        schemaVersion: null,
        required: true,
        proves: [
          'The reviewed workspace passes the local secret scanning command before release evidence is trusted.',
        ],
        retentionStatus: 'operator-owned',
        sourceIds: ['repo-secret-scan'],
      },
    ],
    generationRules: [
      'Run commands from the repository root unless the command itself uses npm --prefix metronome-cli.',
      'Capture stdout and stderr separately; JSON artifacts should contain stdout JSON only.',
      'Record command, exit code, schemaVersion, and sourceIds with each retained artifact.',
      'Keep artifact output paths outside source folders unless a reviewed docs/golden fixture intentionally belongs in source.',
      'Do not include .env contents, npm tokens, Metronome keys, Stripe keys, or live customer data in release artifacts.',
      'Validate a release retention policy before adding any command that creates or overwrites release artifacts.',
      'Generate a release evidence plan from the validated retention policy before collecting artifacts.',
    ],
    blockedActions: [
      'Create or overwrite release artifacts from this command.',
      'Read npm registry state or run npm publish.',
      'Load, validate, print, or store npm tokens.',
      'Read .env files or live API credentials.',
      'Treat artifact presence as approval to remove private:true or publish.',
      'Treat local CI artifacts as live Metronome, Stripe, HubSpot, Hyperline, PostHog, Slack, Zoom, SMTP, or npm-registry authorization.',
    ],
    openQuestions: [
      'Reviewed output directory and retention policy for release evidence artifacts, represented by a valid metro.release.retention-policy.v1 file.',
      'Internal registry destination or package distribution channel.',
      'Package owner, release approver, and approval record format.',
      'Versioning policy, changelog gate, source-baseline gate, and package integrity or signing-equivalent evidence.',
      'Secret-safe publish dry-run or registry-specific upload proof.',
    ],
    relatedReadiness: {
      schemaVersion: readiness.schemaVersion,
      decision: readiness.publish.decision,
      readyForPublish: readiness.publish.readyForPublish,
      registryChecked: readiness.publish.registryChecked,
      tokenLoaded: readiness.publish.tokenLoaded,
      dryRunAgainstRegistryPerformed: readiness.publish.dryRunAgainstRegistryPerformed,
      blockers: readiness.blockers.map((blocker) => blocker.blockerId),
    },
    refusedActions: readiness.refusedActions,
    sourceIds: [
      'metro-release-artifact-manifest-golden',
      'metro-release-evidence-plan-golden',
      'metro-release-readiness-golden',
      'metro-release-retention-policy-golden',
      'metro-command-reference-golden',
      'metro-docs-explain-ci-local-checks-golden',
      'metro-docs-explain-package-publish-readiness-golden',
      'metro-api-readiness-summary-golden',
      'metro-package-test',
      'metro-install-test',
    ],
    nextSafeStep: 'Create and validate a release retention policy, generate a release evidence plan, then run the listed local commands and store their outputs without adding publish, registry, token, .env, or live API access.',
  };
}

function artifactDisplayPath(directoryInput, filename) {
  const cleanedDirectory = String(directoryInput || '').replace(/[\\/]+$/, '');
  return cleanedDirectory ? path.join(cleanedDirectory, filename) : filename;
}

function artifactFinding(findingId, severity, message, extra = {}) {
  return {
    findingId,
    severity,
    message,
    ...extra,
  };
}

function inspectArtifact(directoryResolved, directoryInput, artifact) {
  const artifactPath = path.join(directoryResolved, artifact.filename);
  const check = {
    artifactId: artifact.artifactId,
    filename: artifact.filename,
    path: artifactDisplayPath(directoryInput, artifact.filename),
    required: artifact.required,
    sourceCommand: artifact.sourceCommand,
    expectedSchemaVersion: artifact.schemaVersion,
    actualSchemaVersion: null,
    exists: false,
    readable: false,
    isFile: false,
    nonEmpty: false,
    parsedJson: false,
    valid: false,
    findings: [],
  };

  let stat;
  try {
    stat = fs.statSync(artifactPath);
  } catch (error) {
    check.findings.push(artifactFinding(
      'METRO-RELEASE-EVIDENCE-ARTIFACT-MISSING',
      artifact.required ? 'error' : 'warning',
      `Artifact ${artifact.filename} is missing.`,
      { artifactId: artifact.artifactId },
    ));
    return check;
  }

  check.exists = true;
  check.isFile = stat.isFile();
  check.nonEmpty = stat.size > 0;

  if (!check.isFile) {
    check.findings.push(artifactFinding(
      'METRO-RELEASE-EVIDENCE-ARTIFACT-NOT-FILE',
      artifact.required ? 'error' : 'warning',
      `Artifact ${artifact.filename} is not a regular file.`,
      { artifactId: artifact.artifactId },
    ));
    return check;
  }

  try {
    fs.accessSync(artifactPath, fs.constants.R_OK);
    check.readable = true;
  } catch (error) {
    check.findings.push(artifactFinding(
      'METRO-RELEASE-EVIDENCE-ARTIFACT-UNREADABLE',
      artifact.required ? 'error' : 'warning',
      `Artifact ${artifact.filename} is not readable.`,
      { artifactId: artifact.artifactId },
    ));
    return check;
  }

  if (!check.nonEmpty) {
    check.findings.push(artifactFinding(
      'METRO-RELEASE-EVIDENCE-ARTIFACT-EMPTY',
      artifact.required ? 'error' : 'warning',
      `Artifact ${artifact.filename} is empty.`,
      { artifactId: artifact.artifactId },
    ));
    return check;
  }

  if (!artifact.schemaVersion) {
    check.valid = true;
    return check;
  }

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
    check.parsedJson = true;
    check.actualSchemaVersion = parsed && parsed.schemaVersion ? parsed.schemaVersion : null;
  } catch (error) {
    check.findings.push(artifactFinding(
      'METRO-RELEASE-EVIDENCE-JSON-PARSE',
      artifact.required ? 'error' : 'warning',
      `Artifact ${artifact.filename} is not valid JSON.`,
      { artifactId: artifact.artifactId },
    ));
    return check;
  }

  if (check.actualSchemaVersion !== artifact.schemaVersion) {
    check.findings.push(artifactFinding(
      'METRO-RELEASE-EVIDENCE-SCHEMA-MISMATCH',
      artifact.required ? 'error' : 'warning',
      `Artifact ${artifact.filename} has schemaVersion ${check.actualSchemaVersion || '(missing)'}; expected ${artifact.schemaVersion}.`,
      { artifactId: artifact.artifactId },
    ));
    return check;
  }

  check.valid = true;
  return check;
}

function checkReleaseEvidenceDirectory(directoryInput, options = {}) {
  const manifest = buildReleaseArtifactManifest(options);
  const input = typeof directoryInput === 'string' ? directoryInput : '';
  const findings = [];
  const directory = {
    input: input || null,
    exists: false,
    readable: false,
    isDirectory: false,
  };

  if (!input) {
    findings.push(artifactFinding(
      'METRO-RELEASE-EVIDENCE-DIR-REQUIRED',
      'error',
      'release evidence-check requires --dir <artifact-directory>.',
    ));
  } else {
    const resolvedDirectory = path.resolve(input);
    try {
      const stat = fs.statSync(resolvedDirectory);
      directory.exists = true;
      directory.isDirectory = stat.isDirectory();
    } catch (error) {
      findings.push(artifactFinding(
        'METRO-RELEASE-EVIDENCE-DIR-MISSING',
        'error',
        `Evidence directory ${input} does not exist.`,
      ));
    }

    if (directory.exists && !directory.isDirectory) {
      findings.push(artifactFinding(
        'METRO-RELEASE-EVIDENCE-DIR-NOT-DIRECTORY',
        'error',
        `Evidence path ${input} is not a directory.`,
      ));
    }

    if (directory.exists && directory.isDirectory) {
      try {
        fs.accessSync(resolvedDirectory, fs.constants.R_OK);
        directory.readable = true;
      } catch (error) {
        findings.push(artifactFinding(
          'METRO-RELEASE-EVIDENCE-DIR-UNREADABLE',
          'error',
          `Evidence directory ${input} is not readable.`,
        ));
      }
    }
  }

  const canInspectArtifacts = directory.exists && directory.isDirectory && directory.readable;
  const artifactChecks = canInspectArtifacts
    ? manifest.recommendedArtifacts.map((artifact) => inspectArtifact(path.resolve(input), input, artifact))
    : manifest.recommendedArtifacts.map((artifact) => ({
      artifactId: artifact.artifactId,
      filename: artifact.filename,
      path: artifactDisplayPath(input, artifact.filename),
      required: artifact.required,
      sourceCommand: artifact.sourceCommand,
      expectedSchemaVersion: artifact.schemaVersion,
      actualSchemaVersion: null,
      exists: false,
      readable: false,
      isFile: false,
      nonEmpty: false,
      parsedJson: false,
      valid: false,
      findings: [artifactFinding(
        'METRO-RELEASE-EVIDENCE-DIR-UNAVAILABLE',
        artifact.required ? 'error' : 'warning',
        `Artifact ${artifact.filename} was not inspected because the evidence directory is unavailable.`,
        { artifactId: artifact.artifactId },
      )],
    }));

  const artifactFindings = artifactChecks.flatMap((check) => check.findings);
  const requiredArtifacts = artifactChecks.filter((check) => check.required);
  const requiredInvalid = requiredArtifacts.filter((check) => !check.valid);
  const schemaMismatches = artifactFindings.filter((finding) => finding.findingId === 'METRO-RELEASE-EVIDENCE-SCHEMA-MISMATCH');
  const recoveryCommands = requiredInvalid.map((check) => ({
    artifactId: check.artifactId,
    filename: check.filename,
    path: check.path,
    sourceCommand: check.sourceCommand,
    findingIds: check.findings.map((finding) => finding.findingId),
  }));
  const valid = findings.length === 0 && requiredInvalid.length === 0;

  return {
    schemaVersion: RELEASE_EVIDENCE_CHECK_SCHEMA_VERSION,
    generatedFrom: [
      'metronome-cli/src/release/readiness.js',
      'metronome-cli/src/commands/catalog.js',
      'metronome-cli/src/cli.js',
      'metronome-cli/test/golden.test.js',
    ],
    apiAccess: 'none',
    localOnly: true,
    writesFiles: false,
    liveExecution: { ...manifest.liveExecution },
    directory,
    valid,
    manifest: {
      schemaVersion: manifest.schemaVersion,
      artifactCount: manifest.recommendedArtifacts.length,
      requiredArtifactCount: manifest.recommendedArtifacts.filter((artifact) => artifact.required).length,
      writesFiles: manifest.writesFiles,
    },
    summary: {
      artifactCount: artifactChecks.length,
      requiredArtifactCount: requiredArtifacts.length,
      validRequiredArtifactCount: requiredArtifacts.length - requiredInvalid.length,
      missingRequiredArtifactCount: requiredArtifacts.filter((check) => !check.exists).length,
      invalidRequiredArtifactCount: requiredInvalid.length,
      recoveryCommandCount: recoveryCommands.length,
      schemaMismatchCount: schemaMismatches.length,
      unreadableArtifactCount: artifactChecks.filter((check) => check.exists && !check.readable).length,
    },
    artifactChecks,
    recoveryCommands,
    findings: [...findings, ...artifactFindings],
    safetyBoundaries: [
      'This command reads only the files named by the release artifact manifest under --dir.',
      'Log artifacts are checked by file metadata only; their contents are not printed or parsed.',
      'JSON artifacts are parsed only to compare the top-level schemaVersion field.',
      'Passing evidence-check is not approval to publish, remove private:true, load npm tokens, or run live API operations.',
    ],
    blockedActions: [
      'Create, overwrite, or retain release artifacts.',
      'Read .env files, npm tokens, Metronome keys, Stripe keys, or live customer data.',
      'Read npm registry state or run npm publish.',
      'Treat local artifact validation as live API or package-publish authorization.',
    ],
    relatedReadiness: manifest.relatedReadiness,
    sourceIds: [
      'metro-release-evidence-check-golden',
      'metro-release-artifact-manifest-golden',
      'metro-release-readiness-golden',
    ],
    nextSafeStep: valid
      ? 'Store this evidence-check result with the reviewed local artifact bundle, then keep publish blocked until registry, owner, approval, versioning, provenance, integrity, and publish dry-run evidence are reviewed.'
      : 'Run the listed recoveryCommands for missing or invalid required artifacts, rerun evidence-check, and do not treat the bundle as release evidence until all required artifacts pass.',
  };
}

function buildReleaseRetentionPolicyTemplate(options = {}) {
  const manifest = buildReleaseArtifactManifest(options);
  const requiredArtifactFilenames = manifest.recommendedArtifacts
    .filter((artifact) => artifact.required)
    .map((artifact) => artifact.filename);

  return {
    schemaVersion: RELEASE_RETENTION_POLICY_SCHEMA_VERSION,
    generatedFrom: [
      'metronome-cli/src/release/readiness.js',
      'metronome-cli/src/commands/catalog.js',
      'metronome-cli/src/cli.js',
      'docs/metronome-cli/site/install.html',
      'docs/metronome-cli/site/integration.html',
    ],
    apiAccess: 'none',
    localOnly: true,
    writesFiles: false,
    liveExecution: { ...manifest.liveExecution },
    purpose: 'Document the reviewed release evidence output directory, retention period, owner, approver, access model, cleanup cadence, and blocked actions before any future command is allowed to write release artifacts.',
    policyId: '<release-evidence-policy-id>',
    artifactDirectory: '<reviewed-non-source-artifact-directory>',
    retentionDays: 180,
    owner: '<team-or-person>',
    approver: '<release-approver>',
    reviewedAt: '<YYYY-MM-DD>',
    accessControl: 'authorized-release-operators',
    cleanupCadence: 'per-release-or-monthly',
    storageClassification: 'internal-release-evidence-no-secrets',
    requiredArtifactFilenames,
    retainedValidationArtifactFilenames: [...RETAINED_VALIDATION_ARTIFACT_FILENAMES],
    allowedArtifactFilenames: [
      ...requiredArtifactFilenames,
      ...RETAINED_VALIDATION_ARTIFACT_FILENAMES,
    ],
    requiredLocalChecks: [...REQUIRED_RETENTION_POLICY_CHECKS],
    blockedActionsAcknowledged: [...REQUIRED_RETENTION_POLICY_ACKNOWLEDGEMENTS],
    directoryRules: [
      'Use an operator-reviewed artifact directory outside source folders such as docs/, metronome-cli/, metronome/, lib/, tools/, scripts/, archive/, and migration/.',
      'Do not use a path containing .env, .git, or node_modules.',
      'Keep release artifacts out of source folders unless a checked golden fixture is intentionally part of tests.',
      'Retain the evidence-check result alongside the artifact bundle so validators can prove the retained files matched the manifest.',
    ],
    blockedActions: [
      'Create or overwrite release artifacts from this template command.',
      'Read .env files, npm tokens, Metronome keys, Stripe keys, or live customer data.',
      'Read npm registry state or run npm publish.',
      'Treat a retention policy as approval to remove private:true, publish, or run live API operations.',
    ],
    relatedManifest: {
      schemaVersion: manifest.schemaVersion,
      artifactCount: manifest.recommendedArtifacts.length,
      requiredArtifactCount: requiredArtifactFilenames.length,
      writesFiles: manifest.writesFiles,
    },
    sourceIds: [
      'metro-release-retention-policy-golden',
      'metro-release-artifact-manifest-golden',
      'metro-release-evidence-check-golden',
    ],
    nextSafeStep: 'Copy this template into a reviewed local policy file outside source folders, replace placeholder owner/approver/directory fields, run metro release retention-policy validate --file <policy.json> --json, then run metro release evidence-plan --policy <policy.json> --json before adding any artifact-writing command.',
  };
}

function releasePolicyFinding(findingId, severity, message, extra = {}) {
  return {
    findingId,
    severity,
    message,
    ...extra,
  };
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isPlaceholderValue(value) {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  return (
    trimmed.length === 0
    || /^<[^>]+>$/.test(trimmed)
    || /\bTBD\b/i.test(trimmed)
    || /\bTODO\b/i.test(trimmed)
    || /placeholder/i.test(trimmed)
  );
}

function normalizedArtifactDirectory(value) {
  if (typeof value !== 'string') return '';
  const resolved = path.resolve(value);
  const cwd = process.cwd();
  const relative = path.relative(cwd, resolved);
  const normalizedRelative = relative.split(path.sep).join('/');
  if (relative && !normalizedRelative.startsWith('../') && normalizedRelative !== '..' && !path.isAbsolute(relative)) {
    return normalizedRelative.replace(/\/+$/, '');
  }
  return value.split(/[\\/]+/).filter(Boolean).join('/').replace(/\/+$/, '');
}

function validateReleasePolicyString(policy, fieldName, findings) {
  const value = policy[fieldName];
  if (typeof value !== 'string' || isPlaceholderValue(value)) {
    findings.push(releasePolicyFinding(
      `METRO-RELEASE-RETENTION-${fieldName.replace(/[A-Z]/g, (letter) => `-${letter}`).toUpperCase()}-REQUIRED`,
      'error',
      `Retention policy field ${fieldName} must be a reviewed non-placeholder string.`,
      { field: fieldName },
    ));
    return null;
  }
  return value;
}

function validateArtifactDirectoryPolicy(policy, findings) {
  const value = validateReleasePolicyString(policy, 'artifactDirectory', findings);
  if (!value) return;

  const normalized = normalizedArtifactDirectory(value);
  const segments = normalized.split('/').filter(Boolean);
  const forbiddenSegment = segments.find((segment) => ['.env', '.git', 'node_modules'].includes(segment));
  if (forbiddenSegment) {
    findings.push(releasePolicyFinding(
      'METRO-RELEASE-RETENTION-DIRECTORY-FORBIDDEN-SEGMENT',
      'error',
      `Artifact directory must not contain ${forbiddenSegment}.`,
      { field: 'artifactDirectory', artifactDirectory: value },
    ));
  }

  const sourceDir = RELEASE_ARTIFACT_SOURCE_DIRS.find((dir) => normalized === dir || normalized.startsWith(`${dir}/`));
  if (sourceDir) {
    findings.push(releasePolicyFinding(
      'METRO-RELEASE-RETENTION-DIRECTORY-SOURCE-FOLDER',
      'error',
      `Artifact directory ${value} is inside source folder ${sourceDir}/.`,
      { field: 'artifactDirectory', artifactDirectory: value, sourceDir },
    ));
  }
}

function validateReleasePolicyArrayIncludes(policy, fieldName, requiredValues, findings) {
  const values = policy[fieldName];
  if (!Array.isArray(values)) {
    findings.push(releasePolicyFinding(
      `METRO-RELEASE-RETENTION-${fieldName.replace(/[A-Z]/g, (letter) => `-${letter}`).toUpperCase()}-ARRAY`,
      'error',
      `Retention policy field ${fieldName} must be an array.`,
      { field: fieldName },
    ));
    return [];
  }

  const missing = requiredValues.filter((value) => !values.includes(value));
  for (const value of missing) {
    findings.push(releasePolicyFinding(
      `METRO-RELEASE-RETENTION-${fieldName.replace(/[A-Z]/g, (letter) => `-${letter}`).toUpperCase()}-MISSING`,
      'error',
      `Retention policy field ${fieldName} is missing ${value}.`,
      { field: fieldName, value },
    ));
  }

  return values;
}

function validateReleaseRetentionPolicy(policy, options = {}) {
  const template = buildReleaseRetentionPolicyTemplate(options);
  const findings = [];

  if (!isPlainObject(policy)) {
    findings.push(releasePolicyFinding(
      'METRO-RELEASE-RETENTION-POLICY-OBJECT',
      'error',
      'Retention policy must be a JSON or YAML object.',
    ));
  } else {
    if (policy.schemaVersion !== RELEASE_RETENTION_POLICY_SCHEMA_VERSION) {
      findings.push(releasePolicyFinding(
        'METRO-RELEASE-RETENTION-SCHEMA',
        'error',
        `Retention policy schemaVersion must be ${RELEASE_RETENTION_POLICY_SCHEMA_VERSION}.`,
        { expected: RELEASE_RETENTION_POLICY_SCHEMA_VERSION, actual: policy.schemaVersion || null },
      ));
    }

    for (const fieldName of [
      'policyId',
      'owner',
      'approver',
      'reviewedAt',
      'accessControl',
      'cleanupCadence',
      'storageClassification',
    ]) {
      validateReleasePolicyString(policy, fieldName, findings);
    }

    validateArtifactDirectoryPolicy(policy, findings);

    if (!Number.isInteger(policy.retentionDays) || policy.retentionDays < 1 || policy.retentionDays > 3660) {
      findings.push(releasePolicyFinding(
        'METRO-RELEASE-RETENTION-DAYS',
        'error',
        'Retention policy retentionDays must be an integer between 1 and 3660.',
        { field: 'retentionDays', actual: policy.retentionDays ?? null },
      ));
    }

    if (typeof policy.reviewedAt === 'string' && !isPlaceholderValue(policy.reviewedAt) && !/^\d{4}-\d{2}-\d{2}$/.test(policy.reviewedAt)) {
      findings.push(releasePolicyFinding(
        'METRO-RELEASE-RETENTION-REVIEWED-AT-FORMAT',
        'error',
        'Retention policy reviewedAt must use YYYY-MM-DD.',
        { field: 'reviewedAt', actual: policy.reviewedAt },
      ));
    }

    const allowedArtifactFilenames = validateReleasePolicyArrayIncludes(
      policy,
      'allowedArtifactFilenames',
      template.allowedArtifactFilenames,
      findings,
    );
    const templateAllowedArtifactFilenames = new Set(template.allowedArtifactFilenames);
    const unsafeAllowedArtifact = allowedArtifactFilenames.find((filename) => (
      typeof filename !== 'string'
      || filename.includes('/')
      || filename.includes('\\')
      || filename === '.env'
      || filename.startsWith('.env.')
      || (!templateAllowedArtifactFilenames.has(filename) && filename.toLowerCase().includes('token'))
      || (!templateAllowedArtifactFilenames.has(filename) && filename.toLowerCase().includes('secret'))
      || (!templateAllowedArtifactFilenames.has(filename) && filename.toLowerCase().includes('key'))
    ));
    if (unsafeAllowedArtifact) {
      findings.push(releasePolicyFinding(
        'METRO-RELEASE-RETENTION-UNSAFE-ARTIFACT-FILENAME',
        'error',
        `Retention policy allowedArtifactFilenames contains unsafe artifact name ${unsafeAllowedArtifact}.`,
        { field: 'allowedArtifactFilenames', value: unsafeAllowedArtifact },
      ));
    }

    validateReleasePolicyArrayIncludes(
      policy,
      'requiredArtifactFilenames',
      template.requiredArtifactFilenames,
      findings,
    );
    validateReleasePolicyArrayIncludes(
      policy,
      'retainedValidationArtifactFilenames',
      template.retainedValidationArtifactFilenames,
      findings,
    );
    validateReleasePolicyArrayIncludes(
      policy,
      'requiredLocalChecks',
      template.requiredLocalChecks,
      findings,
    );
    validateReleasePolicyArrayIncludes(
      policy,
      'blockedActionsAcknowledged',
      template.blockedActionsAcknowledged,
      findings,
    );
  }

  const errorCount = findings.filter((finding) => finding.severity === 'error').length;
  const warningCount = findings.filter((finding) => finding.severity === 'warning').length;
  const valid = errorCount === 0;

  return {
    schemaVersion: RELEASE_RETENTION_POLICY_VALIDATION_SCHEMA_VERSION,
    generatedFrom: [
      'metronome-cli/src/release/readiness.js',
      'metronome-cli/src/commands/catalog.js',
      'metronome-cli/src/cli.js',
      'metronome-cli/test/golden.test.js',
    ],
    apiAccess: 'none',
    localOnly: true,
    writesFiles: false,
    liveExecution: { ...template.liveExecution },
    valid,
    policyId: isPlainObject(policy) && typeof policy.policyId === 'string' ? policy.policyId : null,
    artifactDirectory: isPlainObject(policy) && typeof policy.artifactDirectory === 'string' ? policy.artifactDirectory : null,
    summary: {
      requiredArtifactCount: template.requiredArtifactFilenames.length,
      retainedValidationArtifactCount: template.retainedValidationArtifactFilenames.length,
      requiredLocalCheckCount: template.requiredLocalChecks.length,
      requiredAcknowledgementCount: template.blockedActionsAcknowledged.length,
      findingCount: findings.length,
      errorCount,
      warningCount,
    },
    expected: {
      schemaVersion: RELEASE_RETENTION_POLICY_SCHEMA_VERSION,
      requiredArtifactFilenames: [...template.requiredArtifactFilenames],
      retainedValidationArtifactFilenames: [...template.retainedValidationArtifactFilenames],
      requiredLocalChecks: [...template.requiredLocalChecks],
      blockedActionsAcknowledged: [...template.blockedActionsAcknowledged],
    },
    findings,
    safetyBoundaries: [
      'This command validates a local policy file only; it does not create directories or artifacts.',
      'A valid retention policy is prerequisite evidence for future artifact writers, not permission to publish or call live APIs.',
      'Artifact directories inside source folders are rejected to keep generated release evidence out of the source tree.',
    ],
    blockedActions: template.blockedActions,
    relatedManifest: template.relatedManifest,
    sourceIds: [
      'metro-release-retention-policy-golden',
      'metro-release-artifact-manifest-golden',
      'metro-release-evidence-check-golden',
    ],
    nextSafeStep: valid
      ? 'Use this reviewed retention policy with metro release evidence-plan --policy <policy.json> --json before future artifact-writer design, then keep artifact writing, npm registry, publish, token, .env, and live API behavior blocked until separately reviewed.'
      : 'Fix the listed retention policy findings before using it as release evidence or designing artifact-writing commands.',
  };
}

function buildReleaseEvidencePlan(policy, options = {}) {
  const manifest = buildReleaseArtifactManifest(options);
  const validation = validateReleaseRetentionPolicy(policy, options);
  const artifactDirectory = validation.artifactDirectory || null;
  const artifactDirectoryForCommand = artifactDirectory || '<artifact-dir>';
  const allowedFilenames = new Set(
    isPlainObject(policy) && Array.isArray(policy.allowedArtifactFilenames)
      ? policy.allowedArtifactFilenames
      : [],
  );

  const plannedArtifacts = manifest.recommendedArtifacts.map((artifact, index) => ({
    order: index + 1,
    artifactId: artifact.artifactId,
    filename: artifact.filename,
    path: artifactDirectory ? artifactDisplayPath(artifactDirectory, artifact.filename) : artifact.filename,
    required: artifact.required,
    sourceCommand: artifact.sourceCommand,
    expectedSchemaVersion: artifact.schemaVersion,
    captureMode: artifact.schemaVersion ? 'stdout-json' : 'command-log',
    allowedByPolicy: allowedFilenames.has(artifact.filename),
    writeEnabledInCurrentCli: false,
    proves: [...artifact.proves],
    sourceIds: [...artifact.sourceIds],
  }));

  const retainedValidationArtifacts = RETAINED_VALIDATION_ARTIFACT_FILENAMES.map((filename) => ({
    filename,
    path: artifactDirectory ? artifactDisplayPath(artifactDirectory, filename) : filename,
    sourceCommand: `node metronome-cli/bin/metro.js release evidence-check --dir ${artifactDirectoryForCommand} --json`,
    expectedSchemaVersion: RELEASE_EVIDENCE_CHECK_SCHEMA_VERSION,
    allowedByPolicy: allowedFilenames.has(filename),
    writeEnabledInCurrentCli: false,
  }));

  const requiredArtifacts = plannedArtifacts.filter((artifact) => artifact.required);
  const requiredArtifactsAllowedByPolicy = requiredArtifacts.filter((artifact) => artifact.allowedByPolicy).length;
  const retainedValidationArtifactsAllowedByPolicy = retainedValidationArtifacts
    .filter((artifact) => artifact.allowedByPolicy).length;

  return {
    schemaVersion: RELEASE_EVIDENCE_PLAN_SCHEMA_VERSION,
    generatedFrom: [
      'metronome-cli/src/release/readiness.js',
      'metronome-cli/src/commands/catalog.js',
      'metronome-cli/src/cli.js',
      'metronome-cli/test/golden.test.js',
      'docs/metronome-cli/site/integration.html',
    ],
    apiAccess: 'none',
    localOnly: true,
    writesFiles: false,
    liveExecution: { ...manifest.liveExecution },
    valid: validation.valid,
    planStatus: validation.valid ? 'ready-for-manual-capture' : 'blocked-invalid-retention-policy',
    policy: {
      policyId: validation.policyId,
      artifactDirectory,
      validationSchemaVersion: validation.schemaVersion,
      valid: validation.valid,
      findingCount: validation.summary.findingCount,
      errorCount: validation.summary.errorCount,
      warningCount: validation.summary.warningCount,
    },
    summary: {
      plannedArtifactCount: plannedArtifacts.length,
      requiredArtifactCount: requiredArtifacts.length,
      requiredArtifactsAllowedByPolicy,
      retainedValidationArtifactCount: retainedValidationArtifacts.length,
      retainedValidationArtifactsAllowedByPolicy,
      writesFiles: false,
    },
    plannedArtifacts,
    retainedValidationArtifacts,
    manualRunOrder: [
      ...plannedArtifacts.map((artifact) => artifact.sourceCommand),
      `node metronome-cli/bin/metro.js release evidence-check --dir ${artifactDirectoryForCommand} --json`,
    ],
    safetyBoundaries: [
      'This command plans release evidence capture only; it does not create directories, write artifacts, or run artifact commands.',
      'The retention policy must validate before this plan can be used as release evidence.',
      'Artifacts must be captured by reviewed local automation or an operator into the reviewed non-source directory named by the retention policy.',
      'A release evidence plan is not publish approval, npm registry proof, token handling permission, or live API authorization.',
    ],
    blockedActions: [
      'Create, overwrite, or retain release artifacts from this plan command.',
      'Read .env files, npm tokens, Metronome keys, Stripe keys, or live customer data.',
      'Read npm registry state or run npm publish.',
      'Treat a valid evidence plan as approval to remove private:true, publish, or run live API operations.',
    ],
    relatedManifest: {
      schemaVersion: manifest.schemaVersion,
      artifactCount: manifest.recommendedArtifacts.length,
      requiredArtifactCount: requiredArtifacts.length,
      writesFiles: manifest.writesFiles,
    },
    relatedRetentionPolicyValidation: {
      schemaVersion: validation.schemaVersion,
      valid: validation.valid,
      findingCount: validation.summary.findingCount,
      errorCount: validation.summary.errorCount,
      warningCount: validation.summary.warningCount,
    },
    findings: validation.findings,
    sourceIds: [
      'metro-release-evidence-plan-golden',
      'metro-release-retention-policy-golden',
      'metro-release-artifact-manifest-golden',
      'metro-release-evidence-check-golden',
    ],
    nextSafeStep: validation.valid
      ? 'Run the manualRunOrder commands and capture their outputs into the reviewed artifact directory, then run release evidence-check and retain its result alongside the bundle. Keep artifact writing, npm registry, publish, token, .env, and live API behavior blocked until separately reviewed.'
      : 'Fix the retention policy findings, rerun retention-policy validate, then regenerate this evidence plan before collecting release artifacts.',
  };
}

module.exports = {
  RELEASE_ARTIFACT_MANIFEST_SCHEMA_VERSION,
  RELEASE_EVIDENCE_CHECK_SCHEMA_VERSION,
  RELEASE_EVIDENCE_PLAN_SCHEMA_VERSION,
  RELEASE_RETENTION_POLICY_SCHEMA_VERSION,
  RELEASE_RETENTION_POLICY_VALIDATION_SCHEMA_VERSION,
  RELEASE_READINESS_SCHEMA_VERSION,
  buildReleaseArtifactManifest,
  buildReleaseEvidencePlan,
  buildReleaseRetentionPolicyTemplate,
  checkReleaseEvidenceDirectory,
  buildReleaseReadiness,
  validateReleaseRetentionPolicy,
};
