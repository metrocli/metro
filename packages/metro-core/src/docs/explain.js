'use strict';

const { buildApiExportBundle } = require('../api-catalog/export');
const { buildReleaseArtifactManifest, buildReleaseReadiness } = require('../release/readiness');
const { buildSetupQuickstart, buildSetupTemplate } = require('../setup/profiles');
const packageManifest = require('../../../../package.json');
const { loadPackExplainTopics } = require('./load-pack-explain-topics');

const packExplainTopics = loadPackExplainTopics();

const DOCS_EXPLAIN_SCHEMA_VERSION = 'metro.docs.explain.v1';
const DOCS_EXPLAIN_INDEX_SCHEMA_VERSION = 'metro.docs.explain.index.v1';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function uniq(values) {
  return [...new Set((values || []).filter(Boolean))].sort();
}

function refusalCommandEntry(commandId, commandsById, unsupportedById) {
  return unsupportedById[commandId] || commandsById[commandId] || null;
}

function isRefusalCommand(commandId, commandsById, unsupportedById) {
  const entry = refusalCommandEntry(commandId, commandsById, unsupportedById);
  if (!entry) return false;
  if (unsupportedById[commandId]) return true;
  return entry.status === 'live-guarded';
}

function prefixedTopic(rawTopic) {
  const topic = String(rawTopic || '').trim();
  const match = /^(endpoint|api|family|command|shape|rule|validator|gotcha|scope|policy|example):(.+)$/.exec(topic);
  if (!match) return { topic, kind: null, value: topic };
  return { topic, kind: match[1], value: match[2].trim() };
}

function baseResult(bundle, parsed, match) {
  return {
    schemaVersion: DOCS_EXPLAIN_SCHEMA_VERSION,
    generatedFrom: [
      'metronome-cli/src/docs/explain.js',
      ...bundle.generatedFrom,
    ],
    apiAccess: 'none',
    liveExecution: clone(bundle.liveExecution),
    filters: {
      topic: parsed.topic,
      kind: parsed.kind,
      resolvedTopic: parsed.value,
    },
    match,
    nextSafeStep: 'Use this explanation to choose a source-linked local command, preview, validator, or evidence bundle. It does not authorize live reads or writes.',
  };
}

function endpointMatch(endpoint) {
  return {
    type: 'api-endpoint',
    id: endpoint.id,
    title: endpoint.title,
    summary: endpoint.requestContract?.summary || endpoint.title,
    status: endpoint.supportStatus,
    apiAccess: endpoint.apiAccessInCurrentCli,
    keyFields: {
      family: endpoint.family,
      method: endpoint.method,
      path: endpoint.path,
      operationType: endpoint.operationType,
      permissionScope: endpoint.permissionScope,
      requestContract: clone(endpoint.requestContract || {}),
      responseContract: clone(endpoint.responseContract || {}),
      sideEffectProfile: endpoint.sideEffectProfile ? {
        riskClass: endpoint.sideEffectProfile.riskClass,
        summary: endpoint.sideEffectProfile.summary,
      } : null,
    },
    related: {
      commands: uniq([...(endpoint.currentCommands || []), ...(endpoint.futureCommands || [])]),
      policyGates: clone(endpoint.policyGates || []),
    },
    sourceIds: clone(endpoint.sourceIds || []),
    sources: clone(endpoint.sources || []),
  };
}

function familyMatch(family) {
  return {
    type: 'api-family',
    id: family.family,
    title: `${family.family} API family`,
    summary: `${family.endpointCount} reviewed endpoint(s) in the ${family.family} family.`,
    status: 'local-reference',
    apiAccess: 'none',
    keyFields: {
      endpointCount: family.endpointCount,
      operationTypes: clone(family.operationTypes || {}),
      supportStatuses: clone(family.supportStatuses || {}),
    },
    related: {
      commands: ['metro docs api-reference --family <family> --json', 'metro api catalog --family <family> --json'],
    },
    sourceIds: [],
    sources: ['metronome-cli/src/docs/api-reference.js', 'metronome-cli/src/api-catalog/index.js'],
  };
}

function commandMatch(command) {
  return {
    type: 'command',
    id: command.id,
    title: command.command,
    summary: command.description || command.command,
    status: command.status,
    apiAccess: command.apiAccess,
    keyFields: {
      group: command.group,
      mode: command.mode,
      schemaVersion: command.schemaVersion,
      requiredFlags: clone(command.requiredFlags || []),
      optionalFlags: clone(command.optionalFlags || []),
      exitCodes: clone(command.exitCodes || {}),
    },
    related: {
      command: command.command,
    },
    sourceIds: [],
    sources: clone(command.sources || []),
  };
}

function shapeMatch(shape) {
  return {
    type: 'shape',
    id: shape.id,
    title: shape.title,
    summary: shape.purpose,
    status: shape.maturity,
    apiAccess: 'none',
    keyFields: {
      workflow: shape.workflow,
      supportedModes: clone(shape.supportedModes || []),
      requiredInput: clone(shape.requiredInput || []),
      blockedModes: clone(shape.blockedModes || {}),
    },
    related: {
      validatorRuleIds: clone(shape.validatorRuleIds || []),
    },
    sourceIds: [],
    sources: clone(shape.sources || []),
  };
}

function ruleMatch(rule, validatorDocs) {
  return {
    type: 'validator-rule',
    id: rule.id,
    title: rule.title,
    summary: rule.remediation,
    status: rule.severity,
    apiAccess: 'none',
    keyFields: {
      severity: rule.severity,
      remediation: rule.remediation,
    },
    related: {
      shapeIds: clone(validatorDocs.shapeIdsByRuleId[rule.id] || []),
    },
    sourceIds: [],
    sources: ['docs/metronome-cli/VALIDATION_AND_GUARDRAILS.md', 'metronome-cli/src/validators/rules.js'],
  };
}

function gotchaMatch(gotcha) {
  return {
    type: 'gotcha',
    id: gotcha.id,
    title: gotcha.gotcha,
    summary: gotcha.notes,
    status: gotcha.coverageStatus,
    apiAccess: 'none',
    keyFields: {
      category: gotcha.category,
      coverageStatus: gotcha.coverageStatus,
      missingRuleIds: clone(gotcha.missingRuleIds || []),
    },
    related: {
      ruleIds: clone(gotcha.ruleIds || []),
      plannedRuleIds: clone(gotcha.plannedRuleIds || []),
      commandIds: clone(gotcha.commandIds || []),
    },
    sourceIds: [],
    sources: clone(gotcha.sources || []),
  };
}

function scopeMatch(scope, policy) {
  return {
    type: 'permission-scope',
    id: scope.scope,
    title: `${scope.scope} permission scope`,
    summary: policy ? policy.confirmationRequirement : scope.approvalModel,
    status: scope.liveCommandStatus,
    apiAccess: scope.accessClass,
    keyFields: {
      family: scope.family,
      accessClass: scope.accessClass,
      endpointCount: scope.endpointCount,
      endpointIds: clone(scope.endpointIds || []),
      approvalTier: policy?.approvalTier || null,
      accountableOwnerRole: policy?.accountableOwnerRole || null,
      evidenceRequirements: clone(policy?.evidenceRequirements || scope.requiredBeforeLive || []),
    },
    related: {
      endpointIds: clone(scope.endpointIds || []),
      requiredApproverRoles: clone(policy?.requiredApproverRoles || []),
    },
    sourceIds: [],
    sources: clone(policy?.sources || ['metronome-cli/src/api-catalog/index.js']),
  };
}

function exampleMatch(example) {
  return {
    type: 'example-fixture',
    id: example.id,
    title: example.command,
    summary: `Checked-in golden fixture: ${example.golden}`,
    status: 'golden-covered',
    apiAccess: 'none',
    keyFields: {
      command: example.command,
      golden: example.golden,
      covers: clone(example.covers || []),
    },
    related: {
      command: example.command,
    },
    sourceIds: [],
    sources: [example.golden],
  };
}

function inputNormalizeTopic(topic, bundle) {
  if (topic !== 'input.normalize') return null;
  const commandsById = Object.fromEntries(
    bundle.sections.commandReference.commands.map((command) => [command.id, command]),
  );
  const normalizeCommand = commandsById['input.normalize'];
  const inputReferenceCommand = commandsById['docs.input-reference'];
  if (!normalizeCommand || !inputReferenceCommand) return null;

  return {
    type: 'operating-doc-topic',
    id: 'input.normalize',
    title: 'Input normalization contract',
    summary: 'Use metro input normalize to turn local JSON/YAML workflow shape inputs and reviewed expert API request envelopes into stable canonical JSON, validation findings, and deterministic hashes before preview, proof, or future apply work.',
    status: 'local-proof-backed',
    apiAccess: 'none',
    keyFields: {
      outputSchemaVersion: 'metro.input.normalize.v1',
      docsReferenceSchemaVersion: 'metro.docs.input-reference.v1',
      liveExecutionEnabledInCurrentCli: false,
      modes: ['shape', 'api-request'],
      supportedFormats: ['json', 'yaml'],
      canonicalization: 'sorted-json-object-keys',
      roundTripGuarantee: 'When redaction.normalizedInputSuppressed is false, JSON.parse(normalizedJson) deep-equals normalizedInput.',
      hashGuarantee: 'normalizedHash is a sha256 hash of normalizedInput after sorted-key canonicalization.',
      secretBoundary: 'Secret-shaped keys or values suppress normalizedInput, normalizedJson, and normalizedHash instead of echoing sensitive material.',
      validators: ['validateShapeInput', 'validateApiEndpointRequest'],
      secretScanRuleIds: ['MTR-SECRET-001', 'MTR-SECRET-002'],
      commandIds: ['input.normalize', 'docs.input-reference'],
      goldenFixtures: [
        'metronome-cli/test/golden/input/normalize.pro-annual-yaml.json',
        'metronome-cli/test/golden/input/normalize.api-contracts-create-yaml.json',
        'metronome-cli/test/golden/docs/input-reference.json',
      ],
    },
    related: {
      commandIds: ['input.normalize', 'docs.input-reference'],
      commands: [
        normalizeCommand.command,
        inputReferenceCommand.command,
        'metro validate --shape <shape> --file <input.json|yaml> --json',
        'metro api validate <endpoint-id> --file <request.json|yaml> --json',
      ],
      nextLocalEvidence: [
        'metro docs input-reference --json',
        'metro input normalize --shape pro-annual --file metronome-cli/test/fixtures/pro-annual-valid.yaml --json',
        'metro input normalize --api contracts.create --file metronome-cli/test/fixtures/api-contracts-create-valid.yaml --json',
      ],
    },
    sourceIds: uniq([
      'metro-input-files',
      'metro-input-normalize',
      'metro-input-reference',
      'metro-input-reference-golden',
      'metro-input-normalize-shape-golden',
      'metro-input-normalize-api-golden',
      'metro-docs-explain-input-normalize-golden',
    ]),
    sources: uniq([
      ...normalizeCommand.sources,
      ...inputReferenceCommand.sources,
      'metronome-cli/src/docs/explain.js',
      'metronome-cli/test/golden/input/normalize.pro-annual-yaml.json',
      'metronome-cli/test/golden/input/normalize.api-contracts-create-yaml.json',
      'metronome-cli/test/golden/docs/input-reference.json',
    ]),
  };
}

function firstSafePreviewTopic(topic, bundle) {
  if (topic !== 'first-safe-preview') return null;
  const commandsById = Object.fromEntries(
    bundle.sections.commandReference.commands.map((command) => [command.id, command]),
  );
  const quickstartCommand = commandsById['setup.quickstart'];
  const schemaCommand = commandsById['docs.schema'];
  const validateCommand = commandsById['validate.shape'];
  const previewCommand = commandsById['package.preview.pro-annual'];
  if (!quickstartCommand || !schemaCommand || !validateCommand || !previewCommand) return null;

  const quickstart = buildSetupQuickstart();
  return {
    type: 'operating-doc-topic',
    id: 'first-safe-preview',
    title: 'First safe preview path',
    summary: quickstart.purpose,
    status: 'local-install-backed',
    apiAccess: 'none',
    keyFields: {
      quickstartSchemaVersion: quickstart.schemaVersion,
      previewSchemaVersion: quickstart.expectedPreviewSummary.schemaVersion,
      previewWorkflow: quickstart.expectedPreviewSummary.workflow,
      previewShape: quickstart.expectedPreviewSummary.shape,
      previewTenant: quickstart.expectedPreviewSummary.tenant,
      liveExecutionEnabledInCurrentCli: quickstart.liveExecution.enabledInCurrentCli,
      commandCount: quickstart.commands.length,
      commandIds: quickstart.commands.map((command) => command.id),
      commands: quickstart.commands.map((command) => command.command),
      prerequisites: clone(quickstart.prerequisites),
      safetyBoundaries: clone(quickstart.safetyBoundaries),
      expectedOutputCues: {
        profileResolutionSchemaVersion: quickstart.expectedProfileResolutionSummary.schemaVersion,
        readyForLiveApi: quickstart.expectedProfileResolutionSummary.readyForLiveApi,
        envPresenceChecked: quickstart.expectedProfileResolutionSummary.envPresenceChecked,
        blocked: quickstart.expectedPreviewSummary.blocked,
      },
    },
    related: {
      commands: [
        quickstartCommand.command,
        schemaCommand.command,
        validateCommand.command,
        previewCommand.command,
        'metro docs explain first-safe-preview --json',
        'metro docs explain --list --json',
        'metro docs command-reference --json',
      ],
      sourceFiles: clone(quickstart.sources),
    },
    sourceIds: uniq([
      'metro-safe-preview-quickstart',
      'metro-setup-quickstart',
      'metro-install-test',
      'metro-setup-resolve-golden',
      'metro-docs-explain-first-safe-preview-golden',
      'metro-docs-explain-topic-index-golden',
    ]),
    sources: uniq([
      ...quickstart.sources,
      'docs/metronome-cli/site/install.html#first-safe-preview',
      'metronome-cli/src/docs/explain.js',
      'metronome-cli/test/golden/docs/explain.first-safe-preview.json',
    ]),
  };
}

function installTroubleshootingTopic(topic, bundle) {
  if (topic !== 'install.troubleshooting') return null;
  const commandsById = Object.fromEntries(
    bundle.sections.commandReference.commands.map((command) => [command.id, command]),
  );
  const commandIds = [
    'docs.schema',
    'docs.explain',
    'docs.command-reference',
    'setup.quickstart',
    'setup.template',
    'setup.doctor',
    'setup.resolve',
  ].filter((commandId) => commandsById[commandId]);
  if (!commandsById['docs.schema'] || !commandsById['setup.quickstart'] || !commandsById['docs.explain']) return null;

  return {
    type: 'operating-doc-topic',
    id: 'install.troubleshooting',
    title: 'Install troubleshooting',
    summary: 'Use this topic when npm packaging, global installation, or the installed metro binary fails: prove the package manifest, runtime file allowlist, executable bin, temporary-prefix install, and local-only smoke command before moving to setup profiles or safe preview work.',
    status: 'local-install-backed',
    apiAccess: 'none',
    keyFields: {
      liveExecutionEnabledInCurrentCli: false,
      packageName: packageManifest.name,
      packageVersion: packageManifest.version,
      privatePackage: packageManifest.private === true,
      binaryName: 'metro',
      binaryPath: packageManifest.bin?.metro || null,
      packageFilesAllowlist: clone(packageManifest.files || []),
      packageTestAssertions: [
        'npm pack --dry-run --json returns one @metrocli/metro package result.',
        'The packed package includes README.md, package.json, bin/metro.js, and runtime src/ modules.',
        'The packed package excludes test/, node_modules/, and .env paths.',
        'bin/metro.js is packed with executable mode 0755.',
      ],
      installSmokeAssertions: [
        'npm pack --json writes a local tarball named metrocli-metro-0.0.0.tgz.',
        'npm install --global --prefix <tmp> --ignore-scripts installs the tarball into a temporary prefix.',
        'The installed metro binary exists under the temporary prefix.',
        'The installed binary runs metro shape list --json and emits metro.shape.list.v1.',
        'Metronome key environment variables are removed from the smoke-test environment.',
      ],
      commonFailures: [
        {
          failureId: 'METRO-INSTALL-001',
          symptom: 'The metro executable is missing after install.',
          nextSafeStep: 'Run npm --prefix metronome-cli run test:package, confirm bin/metro.js is included and executable, then rerun npm --prefix metronome-cli run test:install.',
        },
        {
          failureId: 'METRO-INSTALL-002',
          symptom: 'Runtime files are missing from the tarball.',
          nextSafeStep: 'Inspect metronome-cli/package.json files allowlist and npm pack --dry-run --json output before changing source paths.',
        },
        {
          failureId: 'METRO-INSTALL-003',
          symptom: 'The tarball includes tests, node_modules, .env, or other non-runtime material.',
          nextSafeStep: 'Keep the package files allowlist scoped to bin/, src/, and README.md, then rerun package and install tests.',
        },
        {
          failureId: 'METRO-INSTALL-004',
          symptom: 'The target npm install path is unavailable.',
          nextSafeStep: 'Use the local tarball smoke path until internal registry publishing is configured; do not treat the planned npm path as current release proof.',
        },
        {
          failureId: 'METRO-INSTALL-005',
          symptom: 'npm install -g git+https://github.com/metrocli/metro.git prints added 1 package then metro: command not found, or later fails with ENOTDIR while renaming @metrocli/metro.',
          nextSafeStep: 'Run metro doctor --json for PATH, symlink, and checkout checks plus the canonical install one-liner. Or: git clone --depth 1 https://github.com/metrocli/metro.git ~/.metro/src && bash ~/.metro/src/scripts/install-global.sh (re-run later: bash ~/.metro/src/scripts/install-global.sh). Then metro setup quickstart --shell | zsh.',
        },

        {
          symptom: 'ls -la "$(npm root -g)/@metrocli/metro" shows a symlink into ~/.npm/_cacache/tmp/git-clone… and bin/metro.js is missing behind that link.',
          nextSafeStep: 'Run metro doctor. Confirm the broken temp-cache symlink, then replace it with bash ~/.metro/src/scripts/install-global.sh (or the install one-liner it prints). Do not retry npm install -g git+…. Prove with metro --help before quickstart.',
        },
      ],
      recoveryOrder: [
        'Read metronome-cli/package.json for the package name, bin.metro path, and files allowlist.',
        'Run npm --prefix metronome-cli run test:package to verify npm pack dry-run contents and executable bin metadata.',
        'Run npm --prefix metronome-cli run test:install to prove a temporary global install exposes the metro binary.',
        'Run metro schema --json or metro shape list --json from the installed binary before using setup or preview commands.',
        'After install proof passes, use metro docs explain setup.troubleshooting --json for profile or tenant-binding failures.',
      ],
      blockedDoesNotMean: [
        'A local tarball smoke test does not prove internal npm registry publishing.',
        'A successful install authorizes live Metronome reads or writes.',
        'A present Metronome key in the shell should be read or printed during install validation.',
        'A working metro binary allows workflow apply or expert API apply without preflight, sandbox proof, audit, approval, rollback, and read-back evidence.',
      ],
      safeLocalCommands: [
        'npm --prefix metronome-cli run test:package',
        'npm --prefix metronome-cli run test:install',
        'npm --prefix metronome-cli test',
        'node metronome-cli/bin/metro.js schema --json',
        'node metronome-cli/bin/metro.js shape list --json',
        'node metronome-cli/bin/metro.js setup quickstart --json',
      ],
      proofFiles: [
        'metronome-cli/package.json',
        'metronome-cli/test/package.test.js',
        'metronome-cli/test/install.test.js',
        'docs/metronome-cli/site/install.html',
        'metronome-cli/test/golden/docs/explain.install-troubleshooting.json',
      ],
    },
    related: {
      commands: [
        'metro docs explain install.troubleshooting --json',
        'metro docs explain first-safe-preview --json',
        'metro docs explain setup.troubleshooting --json',
        'metro setup quickstart --json',
        'metro setup template --json',
        'metro shape list --json',
        'metro schema --json',
      ],
      commandsById: commandIds.map((commandId) => commandsById[commandId].command),
      sourceFiles: [
        'metronome-cli/package.json',
        'metronome-cli/test/package.test.js',
        'metronome-cli/test/install.test.js',
        'docs/metronome-cli/site/install.html',
      ],
    },
    sourceIds: uniq([
      'metro-package-test',
      'metro-install-test',
      'metro-safe-preview-quickstart',
      'metro-docs-explain-first-safe-preview-golden',
      'metro-docs-explain-install-troubleshooting-golden',
      'metro-docs-explain-topic-index-golden',
    ]),
    sources: uniq([
      'docs/SAFETY.md',
      'docs/metronome-cli/one-goal.md',
      'docs/metronome-cli/CLI_ARCHITECTURE.md',
      'docs/metronome-cli/site/install.html',
      'metronome-cli/package.json',
      'metronome-cli/src/docs/explain.js',
      'metronome-cli/test/package.test.js',
      'metronome-cli/test/install.test.js',
    ]),
  };
}

function packagePublishReadinessTopic(topic, bundle) {
  if (topic !== 'package.publish-readiness') return null;
  const readiness = buildReleaseReadiness();
  const artifactManifest = buildReleaseArtifactManifest();
  const commandsById = Object.fromEntries(
    bundle.sections.commandReference.commands.map((command) => [command.id, command]),
  );
  const commandIds = [
    'release.readiness',
    'release.artifact-manifest',
    'release.evidence-plan',
    'release.evidence-check',
    'release.retention-policy.template',
    'release.retention-policy.validate',
    'docs.schema',
    'docs.explain',
    'docs.command-reference',
    'setup.quickstart',
    'shape.list',
  ].filter((commandId) => commandsById[commandId]);
  if (!commandsById['docs.explain'] || !commandsById['docs.schema'] || !commandsById['shape.list']) return null;

  return {
    type: 'operating-doc-topic',
    id: 'package.publish-readiness',
    title: 'Package publish readiness',
    summary: 'Use this topic before treating the local tarball install path as an internal npm release: current proof covers npm pack contents and a temporary-prefix metro install, while registry publishing, release provenance, approval ownership, and signing or equivalent integrity evidence remain explicit blockers.',
    status: 'blocked-open-questions',
    apiAccess: 'none',
    keyFields: {
      liveExecutionEnabledInCurrentCli: false,
      releaseReadinessSchemaVersion: readiness.schemaVersion,
      releaseReadinessCommand: 'metro release readiness --json',
      releaseArtifactManifestSchemaVersion: artifactManifest.schemaVersion,
      releaseArtifactManifestCommand: 'metro release artifact-manifest --json',
      releaseArtifactManifestWritesFiles: artifactManifest.writesFiles,
      releaseEvidencePlanSchemaVersion: 'metro.release.evidence-plan.v1',
      releaseEvidencePlanCommand: 'metro release evidence-plan --policy <policy.json|yaml> --json',
      releaseEvidencePlanWritesFiles: false,
      releaseEvidenceCheckSchemaVersion: 'metro.release.evidence-check.v1',
      releaseEvidenceCheckCommand: 'metro release evidence-check --dir <artifact-dir> --json',
      releaseEvidenceCheckWritesFiles: false,
      releaseRetentionPolicySchemaVersion: 'metro.release.retention-policy.v1',
      releaseRetentionPolicyValidationSchemaVersion: 'metro.release.retention-policy.validation.v1',
      releaseRetentionPolicyTemplateCommand: 'metro release retention-policy template --json',
      releaseRetentionPolicyValidateCommand: 'metro release retention-policy validate --file <policy.json|yaml> --json',
      releaseRetentionPolicyWritesFiles: false,
      publishEnabledInCurrentCli: false,
      packageName: readiness.package.name,
      packageVersion: readiness.package.version,
      manifestPrivateFlag: readiness.package.private,
      currentSupportedInstallPath: readiness.installTarget.currentlyProvenPath,
      targetInstallCommand: readiness.installTarget.targetCommand,
      targetInstallStatus: readiness.installTarget.targetStatus,
      localProofAlreadyAvailable: [
        'npm pack dry-run includes the runtime files and excludes test/, node_modules/, and .env paths.',
        'The package manifest exposes the metro binary at bin/metro.js.',
        'The install smoke test packs a local tarball, installs it into a temporary prefix, and runs the installed metro shape list --json command.',
        'The install smoke test removes Metronome key environment variables from its process environment.',
        'The release readiness command reports package/install proof and publish blockers without npm registry or credential access.',
        'The release artifact manifest lists the local evidence artifacts and source commands without creating files or touching registry state.',
        'The release evidence-plan command binds a valid retention policy to the artifact manifest and returns manual capture order without creating directories or files.',
        'The release evidence-check command validates an operator-supplied artifact directory against the manifest without writing files, reading .env, loading tokens, or touching registry state.',
        'The release retention-policy commands document and validate the reviewed artifact output directory and retention rules before any future artifact writer exists.',
      ],
      releaseDecisionGate: {
        decision: readiness.publish.decision,
        canRemovePrivateFlag: readiness.publish.canRemovePrivateFlag,
        canAddPublishWorkflow: readiness.publish.canAddPublishWorkflow,
        canUseNpmToken: readiness.publish.canUseNpmToken,
        currentAllowedAction: 'Keep the package private and use local package/install smoke proof only.',
        nextReviewInputs: [
          'Document the internal registry URL or package distribution channel.',
          'Name package owner and release approver roles.',
        'Define versioning, changelog, package integrity, and provenance requirements.',
        'Validate the reviewed artifact output directory and retention policy.',
        'Add a secret-safe publish dry-run or registry-specific publish proof.',
        ],
      },
      publishBlockers: [
        {
          blockerId: 'METRO-PUBLISH-001',
          title: 'Package manifest is private',
          evidence: 'metronome-cli/package.json has "private": true.',
          nextSafeStep: 'Do not remove private:true until the registry, owner approval, versioning, provenance, and release-gate evidence are documented and reviewed.',
        },
        {
          blockerId: 'METRO-PUBLISH-002',
          title: 'Internal registry destination is not documented',
          evidence: 'docs/metronome-cli/site/install.html marks npm install -g @metrocli/metro as planned because registry publishing is not configured yet.',
          nextSafeStep: 'Document the intended internal registry, package scope owner, authentication model, and publish permissions before enabling a publish workflow.',
        },
        {
          blockerId: 'METRO-PUBLISH-003',
          title: 'Release provenance and approval evidence are missing',
          evidence: 'Current local proof covers package and install smoke tests only.',
          nextSafeStep: 'Define release approval, version bump, changelog, package integrity, and source-baseline checks before claiming publish readiness.',
        },
        {
          blockerId: 'METRO-PUBLISH-004',
          title: 'Publish dry-run proof is missing',
          evidence: 'metro release readiness --json reports registryChecked=false and dryRunAgainstRegistryPerformed=false.',
          nextSafeStep: 'Add secret-safe registry-specific publish proof before enabling any publish workflow.',
        },
      ],
      requiredBeforePublish: readiness.requiredEvidenceBeforePublish,
      safeLocalCommands: [
        'node metronome-cli/bin/metro.js release readiness --json',
        'node metronome-cli/bin/metro.js release artifact-manifest --json',
        'npm --prefix metronome-cli run test:package',
        'npm --prefix metronome-cli run test:install',
        'npm --prefix metronome-cli test',
        'node metronome-cli/bin/metro.js release retention-policy template --json',
        'node metronome-cli/bin/metro.js release retention-policy validate --file <policy.json|yaml> --json',
        'node metronome-cli/bin/metro.js release evidence-plan --policy <policy.json|yaml> --json',
        'node metronome-cli/bin/metro.js release evidence-check --dir <artifact-dir> --json',
        'npm run check:syntax',
        'npm run secrets:scan',
        'node docs/metronome-cli/site/verify-site.js',
        'node metronome-cli/bin/metro.js docs explain package.publish-readiness --json',
        'node metronome-cli/bin/metro.js docs explain install.troubleshooting --json',
      ],
      refusedAssumptions: [
        'Treating a successful local tarball install as proof of internal publishing.',
        'Removing private:true is a safe release step by itself.',
        'A publish command should read .env files or print npm tokens.',
        'A published CLI can run live Metronome reads or writes without the same tenant, preflight, proof, audit, approval, rollback, and read-back gates.',
      ],
    },
    related: {
      commands: [
        'metro release readiness --json',
        'metro release artifact-manifest --json',
        'metro release retention-policy template --json',
        'metro release retention-policy validate --file <policy.json|yaml> --json',
        'metro release evidence-plan --policy <policy.json|yaml> --json',
        'metro release evidence-check --dir <artifact-dir> --json',
        'metro docs explain package.publish-readiness --json',
        'metro docs explain install.troubleshooting --json',
        'metro docs explain first-safe-preview --json',
        'metro schema --json',
        'metro shape list --json',
      ],
      commandsById: commandIds.map((commandId) => commandsById[commandId].command),
      sourceFiles: [
        'metronome-cli/package.json',
        'metronome-cli/test/package.test.js',
        'metronome-cli/test/install.test.js',
        'docs/metronome-cli/site/install.html',
      ],
    },
    sourceIds: uniq([
      'metro-release-readiness-golden',
      'metro-release-artifact-manifest-golden',
      'metro-release-evidence-plan-golden',
      'metro-release-evidence-check-golden',
      'metro-release-retention-policy-golden',
      'metro-package-test',
      'metro-install-test',
      'metro-safe-preview-quickstart',
      'metro-docs-explain-install-troubleshooting-golden',
      'metro-docs-explain-package-publish-readiness-golden',
      'metro-docs-explain-topic-index-golden',
    ]),
    sources: uniq([
      'docs/SAFETY.md',
      'docs/SOURCE_BASELINE.md',
      'docs/metronome-cli/one-goal.md',
      'docs/metronome-cli/CLI_ARCHITECTURE.md',
      'docs/metronome-cli/site/install.html',
      'metronome-cli/package.json',
      'metronome-cli/src/release/readiness.js',
      'metronome-cli/src/docs/explain.js',
      'metronome-cli/test/package.test.js',
      'metronome-cli/test/install.test.js',
      'metronome-cli/test/golden/release/evidence-check.valid.json',
      'metronome-cli/test/golden/release/retention-policy.template.json',
      'metronome-cli/test/golden/release/retention-policy.validation.valid.json',
    ]),
  };
}

function ciLocalChecksTopic(topic, bundle) {
  if (topic !== 'ci.local-checks') return null;
  const commandsById = Object.fromEntries(
    bundle.sections.commandReference.commands.map((command) => [command.id, command]),
  );
  const commandIds = [
    'docs.schema',
    'docs.command-reference',
    'docs.explain',
    'docs.input-reference',
    'api.readiness',
    'release.readiness',
    'release.artifact-manifest',
    'release.evidence-plan',
    'release.evidence-check',
    'release.retention-policy.template',
    'release.retention-policy.validate',
    'setup.quickstart',
    'validate.shape',
    'package.preview.pro-annual',
  ].filter((commandId) => commandsById[commandId]);
  if (!commandsById['docs.schema'] || !commandsById['api.readiness'] || !commandsById['release.readiness']) return null;

  return {
    type: 'operating-doc-topic',
    id: 'ci.local-checks',
    title: 'CI local checks',
    summary: 'Use this topic when wiring metro into CI or agent automation: run package, install, unit, golden, site, syntax, and secret-scan checks that need no API keys, then parse metro JSON contracts instead of scraping prose.',
    status: 'local-proof-backed',
    apiAccess: 'none',
    keyFields: {
      liveExecutionEnabledInCurrentCli: false,
      ciPurpose: 'Prove the CLI package, command contracts, generated docs, and safety boundaries without loading API clients or reading .env files.',
      minimumCheckSequence: [
        {
          step: 'package',
          command: 'npm --prefix metronome-cli run test:package',
          proves: 'npm pack dry-run contains only runtime CLI files and an executable metro binary.',
        },
        {
          step: 'install',
          command: 'npm --prefix metronome-cli run test:install',
          proves: 'A temporary-prefix install exposes a working metro binary without Metronome keys.',
        },
        {
          step: 'unit',
          command: 'npm --prefix metronome-cli run test:unit',
          proves: 'Command handlers, validators, local previews, profile checks, and docs topics remain executable.',
        },
        {
          step: 'golden',
          command: 'npm --prefix metronome-cli run test:golden',
          proves: 'Stable JSON and generated-reference contracts match checked fixtures.',
        },
        {
          step: 'site',
          command: 'node docs/metronome-cli/site/verify-site.js',
          proves: 'The source-linked docs site and generated references are internally consistent.',
        },
        {
          step: 'repository',
          command: 'npm run check:syntax && npm run secrets:scan',
          proves: 'Repository syntax and secret-scan checks pass after reviewing root package scripts.',
        },
      ],
      machineReadableDiscovery: [
        'node metronome-cli/bin/metro.js schema --json',
        'node metronome-cli/bin/metro.js docs command-reference --json',
        'node metronome-cli/bin/metro.js docs explain --list --json',
        'node metronome-cli/bin/metro.js docs input-reference --json',
        'node metronome-cli/bin/metro.js api readiness --summary --json',
        'node metronome-cli/bin/metro.js release readiness --json',
        'node metronome-cli/bin/metro.js release artifact-manifest --json',
        'node metronome-cli/bin/metro.js release retention-policy template --json',
        'node metronome-cli/bin/metro.js release retention-policy validate --file <policy.json|yaml> --json',
        'node metronome-cli/bin/metro.js release evidence-plan --policy <policy.json|yaml> --json',
        'node metronome-cli/bin/metro.js release evidence-check --dir <artifact-dir> --json',
      ],
      parseRules: [
        'Parse stdout by schemaVersion and command id; do not scrape generated HTML or README prose when the CLI exposes an equivalent JSON contract.',
        'Treat exit code 0 as local evidence success, exit code 1 as input or validation failure, and exit code 2 as a useful safety refusal.',
        'Keep stdout and stderr separate so successful evidence payloads are not conflated with refusal JSON or validation findings.',
        'Store command, exit code, schemaVersion, payload hashes, sourceIds, generatedFrom, and nextSafeStep with any CI artifact.',
      ],
      blockedDoesNotMean: [
        'Passing CI authorizes live Metronome, Stripe, CRM, analytics, chat, email, npm registry, or customer-impacting work.',
        'A local apply-gate or readiness payload can replace current-turn authorization.',
        'A present API key or npm token should be loaded, printed, or used by CI checks.',
        'Local tarball install proof is internal npm registry publish proof.',
      ],
      recommendedArtifacts: [
        'metro.schema.json',
        'metro.docs-explain.topic-index.json',
        'metro.api-readiness.summary.json',
        'metro.release-readiness.json',
        'metro.release-artifact-manifest.json',
        'metro.release-evidence-plan.json',
        'site-verify.log',
      ],
      retainedValidationArtifacts: [
        'metro.release-evidence-check.json',
        'metro.release-retention-policy.validation.json',
      ],
      commandIds,
      sourceFiles: [
        'metronome-cli/package.json',
        'metronome-cli/test/package.test.js',
        'metronome-cli/test/install.test.js',
        'metronome-cli/test/golden.test.js',
        'docs/metronome-cli/site/verify-site.js',
        'docs/metronome-cli/site/integration.html',
      ],
    },
    related: {
      commands: [
        'metro docs explain ci.local-checks --json',
        'metro docs explain output.anatomy --json',
        'metro docs explain package.publish-readiness --json',
        'metro schema --json',
        'metro api readiness --summary --json',
        'metro release readiness --json',
        'metro release artifact-manifest --json',
        'metro release retention-policy template --json',
        'metro release retention-policy validate --file <policy.json|yaml> --json',
        'metro release evidence-plan --policy <policy.json|yaml> --json',
        'metro release evidence-check --dir <artifact-dir> --json',
      ],
      commandsById: commandIds.map((commandId) => commandsById[commandId].command),
      sourceFiles: [
        'metronome-cli/package.json',
        'metronome-cli/test/package.test.js',
        'metronome-cli/test/install.test.js',
        'metronome-cli/test/golden.test.js',
        'docs/metronome-cli/site/integration.html',
      ],
    },
    sourceIds: uniq([
      'metro-command-catalog',
      'metro-command-reference-golden',
      'metro-release-readiness-golden',
      'metro-release-artifact-manifest-golden',
      'metro-release-evidence-plan-golden',
      'metro-release-evidence-check-golden',
      'metro-release-retention-policy-golden',
      'metro-package-test',
      'metro-install-test',
      'metro-api-readiness-summary-golden',
      'metro-docs-explain-output-anatomy-golden',
      'metro-docs-explain-ci-local-checks-golden',
      'metro-docs-explain-topic-index-golden',
    ]),
    sources: uniq([
      'docs/SAFETY.md',
      'docs/metronome-cli/one-goal.md',
      'docs/metronome-cli/CLI_ARCHITECTURE.md',
      'docs/metronome-cli/site/integration.html',
      'metronome-cli/package.json',
      'metronome-cli/src/commands/catalog.js',
      'metronome-cli/src/docs/explain.js',
      'metronome-cli/src/release/readiness.js',
      'metronome-cli/test/package.test.js',
      'metronome-cli/test/install.test.js',
      'metronome-cli/test/golden.test.js',
      'metronome-cli/test/golden/release/evidence-check.valid.json',
      'metronome-cli/test/golden/release/retention-policy.template.json',
      'metronome-cli/test/golden/release/retention-policy.validation.valid.json',
      'docs/metronome-cli/site/verify-site.js',
    ]),
  };
}

function setupTroubleshootingTopic(topic, bundle) {
  if (topic !== 'setup.troubleshooting') return null;
  const commandsById = Object.fromEntries(
    bundle.sections.commandReference.commands.map((command) => [command.id, command]),
  );
  const commandIds = [
    'setup.quickstart',
    'setup.template',
    'setup.doctor',
    'setup.resolve',
    'docs.explain',
    'docs.command-reference',
  ].filter((commandId) => commandsById[commandId]);
  if (!commandsById['setup.quickstart'] || !commandsById['setup.doctor'] || !commandsById['setup.resolve']) return null;

  const quickstart = buildSetupQuickstart();
  const template = buildSetupTemplate();
  return {
    type: 'operating-doc-topic',
    id: 'setup.troubleshooting',
    title: 'Setup troubleshooting',
    summary: 'Use this topic when the first safe preview path, local profile doctor, or profile resolution fails: keep setup local-only, inspect schemaVersion and findings, fix the profile file or non-secret fingerprint, then rerun setup doctor and setup resolve before using profile evidence in read-gate or preflight manifests.',
    status: 'local-proof-backed',
    apiAccess: 'none',
    keyFields: {
      liveExecutionEnabledInCurrentCli: false,
      quickstartSchemaVersion: quickstart.schemaVersion,
      profileTemplateSchemaVersion: template.schemaVersion,
      doctorSchemaVersion: 'metro.setup.doctor.v1',
      profileResolutionSchemaVersion: quickstart.expectedProfileResolutionSummary.schemaVersion,
      localRecoveryCommandIds: commandIds,
      commonFailures: [
        {
          ruleId: 'MTR-SETUP-001',
          symptom: 'Profile config schemaVersion is not metro.profiles.v1.',
          nextSafeStep: 'Regenerate the skeleton with metro setup template --json, then rerun metro setup doctor --file <profiles.json> --json.',
        },
        {
          ruleId: 'MTR-TENANT-003',
          symptom: 'A profile does not resolve to exactly one tenant.',
          nextSafeStep: 'Set tenant to sandbox or production explicitly; never infer tenant from key names or local env state.',
        },
        {
          ruleId: 'MTR-AUTH-002',
          symptom: 'A sandbox profile is paired with a production-looking env var or a production profile is paired with a sandbox/test env var.',
          nextSafeStep: 'Use tenant-matched env var names such as METRONOME_SANDBOX_KEY or METRONOME_PROD_KEY, then rerun setup doctor.',
        },
        {
          ruleId: 'MTR-SECRET-001',
          symptom: 'The profile file contains secret-shaped field names.',
          nextSafeStep: 'Keep only metronomeKeyEnv in profile files; remove raw key, token, authorization, bearer, password, and private-key fields.',
        },
        {
          ruleId: 'MTR-SECRET-002',
          symptom: 'The profile file or key fingerprint contains a secret-shaped value.',
          nextSafeStep: 'Replace raw keys or bearer tokens with environment variable names or non-secret fingerprints such as fp_sandbox_reviewed.',
        },
        {
          ruleId: 'MTR-TENANT-005',
          symptom: 'The selected profile tenant does not match --expect-tenant.',
          nextSafeStep: 'Choose the profile whose tenant matches the planned workflow before attaching profile-resolution evidence to a gate.',
        },
      ],
      recoveryOrder: [
        'Run metro setup quickstart --json to confirm the local-only first safe preview path and expected setup outputs.',
        'Run metro setup template --json and compare your profile file to the generated metro.profiles.v1 skeleton.',
        'Run metro setup doctor --file <profiles.json> --json and fix error findings before checking env presence or building gates.',
        'Run metro setup resolve --file <profiles.json> --profile <name> --expect-tenant <tenant> --key-fingerprint <fingerprint> --json with a non-secret fingerprint.',
        'Use the resulting tenantProfile only as local evidence for read-gate or preflight manifests; it is not live API authorization.',
      ],
      safeLocalCommands: [
        'metro setup quickstart --json',
        'metro setup template --json',
        'metro setup doctor --file metronome-cli/test/fixtures/setup/profiles-valid.json --json',
        'metro setup doctor --file metronome-cli/test/fixtures/setup/profiles-invalid-secret.json --json',
        'metro setup resolve --file metronome-cli/test/fixtures/setup/profiles-valid.json --profile metro-sandbox --expect-tenant sandbox --key-fingerprint fp_sandbox_setup_resolve_reviewed --json',
      ],
      blockedDoesNotMean: [
        'A missing env var blocks local validation or preview.',
        'A present env var authorizes a live read or write.',
        'A profile-resolution object can replace current-turn authorization, read-gate, preflight, approval, audit, or read-back evidence.',
      ],
      fixturePaths: [
        'metronome-cli/test/fixtures/setup/profiles-valid.json',
        'metronome-cli/test/fixtures/setup/profiles-invalid-secret.json',
      ],
      goldenFixtures: [
        'metronome-cli/test/golden/setup/quickstart.json',
        'metronome-cli/test/golden/setup/template.json',
        'metronome-cli/test/golden/setup/resolve.metro-sandbox.json',
        'metronome-cli/test/golden/docs/explain.setup-troubleshooting.json',
      ],
    },
    related: {
      commands: [
        'metro docs explain setup.troubleshooting --json',
        'metro docs explain first-safe-preview --json',
        'metro setup quickstart --json',
        'metro setup template --json',
        'metro setup doctor --file <profiles.json> --json',
        'metro setup resolve --file <profiles.json> --profile <name> --expect-tenant <tenant> --key-fingerprint <fingerprint> --json',
      ],
      commandsById: commandIds.map((commandId) => commandsById[commandId].command),
      sourceFiles: [
        'metronome-cli/src/setup/profiles.js',
        'metronome-cli/test/fixtures/setup/profiles-valid.json',
        'metronome-cli/test/fixtures/setup/profiles-invalid-secret.json',
        'metronome-cli/test/golden/setup/quickstart.json',
        'metronome-cli/test/golden/setup/resolve.metro-sandbox.json',
      ],
    },
    sourceIds: uniq([
      'metro-setup-profiles',
      'metro-setup-fixtures',
      'metro-setup-resolve-golden',
      'metro-setup-quickstart',
      'metro-install-test',
      'metro-docs-explain-first-safe-preview-golden',
      'metro-docs-explain-setup-troubleshooting-golden',
      'metro-docs-explain-topic-index-golden',
    ]),
    sources: uniq([
      'docs/SAFETY.md',
      'docs/metronome-cli/one-goal.md',
      'docs/metronome-cli/CLI_ARCHITECTURE.md',
      'docs/metronome-cli/site/install.html',
      'metronome-cli/src/commands/catalog.js',
      'metronome-cli/src/docs/explain.js',
      'metronome-cli/src/setup/profiles.js',
      'metronome-cli/test/fixtures/setup/profiles-valid.json',
      'metronome-cli/test/fixtures/setup/profiles-invalid-secret.json',
      'metronome-cli/test/golden/setup/quickstart.json',
      'metronome-cli/test/golden/setup/template.json',
      'metronome-cli/test/golden/setup/resolve.metro-sandbox.json',
    ]),
  };
}

function outputAnatomyTopic(topic, bundle) {
  if (topic !== 'output.anatomy') return null;
  const commandsById = Object.fromEntries(
    bundle.sections.commandReference.commands.map((command) => [command.id, command]),
  );
  const unsupportedById = Object.fromEntries(
    (bundle.sections.commandReference.unsupportedCommands || []).map((command) => [command.id, command]),
  );
  const examplesById = Object.fromEntries(
    bundle.sections.examples.fixtures.map((example) => [example.id, example]),
  );
  const commandIds = [
    'setup.quickstart',
    'docs.schema',
    'docs.explain',
    'input.normalize',
    'package.preview.pro-annual',
    'api.preview',
    'api.read-plan',
    'api.read-pipeline',
    'api.apply-gate.validate',
    'api.apply-result.validate',
  ].filter((commandId) => commandsById[commandId]);
  const refusalCommandIds = ['api.read', 'api.apply'].filter((commandId) => isRefusalCommand(commandId, commandsById, unsupportedById));
  const exampleIds = [
    'api.catalog.contracts',
    'api.explain.contracts-create',
    'api.preview.contracts-create',
    'api.preflight.contracts-create',
    'api.readiness',
  ].filter((exampleId) => examplesById[exampleId]);
  if (!commandsById['docs.explain'] || !commandsById['input.normalize'] || !commandsById['api.preview']) return null;

  return {
    type: 'operating-doc-topic',
    id: 'output.anatomy',
    title: 'JSON output anatomy',
    summary: 'Use this topic to read metro JSON output consistently: identify the schema version first, check live-execution flags and API access, inspect status/refusal fields, then follow generatedFrom, sourceIds, sources, payload hashes, and nextSafeStep before using the output as local evidence.',
    status: 'local-proof-backed',
    apiAccess: 'none',
    keyFields: {
      liveExecutionEnabledInCurrentCli: false,
      stableTopLevelFields: [
        'schemaVersion',
        'apiAccess',
        'liveExecution',
        'generatedFrom',
        'sourceIds',
        'sources',
        'nextSafeStep',
      ],
      streamContract: {
        stdout: [
          'Successful --json commands emit the documented JSON evidence contract on stdout.',
          'Human-readable output is for operators; automation should request --json and parse by schemaVersion.',
        ],
        stderr: [
          'Validation, input, unsupported-format, and safety-refusal failures write the blocker to stderr.',
          'Safety refusals exit 2 and may emit metro.refusal.v1 or an endpoint-specific refusal schema on stderr.',
        ],
        automationRules: [
          'Keep stdout and stderr separate when storing evidence so success payloads and refusals are not conflated.',
          'Record command, exit code, schemaVersion, blockReason or findings, and nextSafeStep before retrying.',
          'Use CLI JSON references instead of scraping generated HTML or prose pages when an equivalent contract exists.',
        ],
      },
      evidenceFieldsByMode: {
        preview: ['tenant', 'workflow', 'shape', 'payloadHash', 'blocked', 'actions', 'warnings'],
        docsExplain: ['filters', 'match.type', 'match.id', 'match.keyFields', 'match.related'],
        inputNormalize: ['normalizedInput', 'normalizedJson', 'normalizedHash', 'redaction'],
        readPipeline: ['readPlan', 'readGate', 'mockResponse', 'auditLog', 'dryRun'],
        applyGate: ['previewBinding', 'profileResolution', 'approval', 'sandboxProof', 'audit'],
      },
      interpretationOrder: [
        'Read schemaVersion before parsing any other field.',
        'Treat apiAccess:none and liveExecution.enabledInCurrentCli:false as the default local-only boundary.',
        'Use payloadHash, normalizedHash, requestHash, or evidence hash fields as review bindings, not authorization.',
        'Read blocked, status, findings, refusal schema, and nextSafeStep before planning a follow-up command.',
        'Use generatedFrom, sourceIds, sources, and checked golden fixtures to prove where a claim came from.',
      ],
      exitCodes: {
        success: 0,
        validationOrInputFailure: 1,
        safetyRefusal: 2,
      },
      refusalSchemas: ['metro.refusal.v1', 'endpoint-specific refusal JSON on stderr'],
      commandIds,
      refusalCommandIds,
      exampleFixtureIds: exampleIds,
      goldenFixtures: exampleIds.map((exampleId) => examplesById[exampleId].golden),
    },
    related: {
      commands: [
        'metro docs explain output.anatomy --json',
        'metro docs explain --list --json',
        'metro docs command-reference --json',
        'metro input normalize --shape pro-annual --file metronome-cli/test/fixtures/pro-annual-valid.yaml --json',
        'metro api preview contracts.create --file metronome-cli/test/fixtures/api-contracts-create-valid.json --sandbox --json',
        'metro api read-pipeline contracts.get.v2 --file metronome-cli/test/fixtures/api-contracts-get-valid.json --read-gate metronome-cli/test/fixtures/api-read-gate-contracts-get-valid.json --mock-response metronome-cli/test/fixtures/api-contracts-get-mock-response.json --out audit-logs/api-read-pipeline-contracts-get.jsonl --actor agent-local-test --dry-run --json',
      ],
      commandsById: commandIds.map((commandId) => commandsById[commandId].command),
      refusalCommands: refusalCommandIds.map((commandId) => refusalCommandEntry(commandId, commandsById, unsupportedById).command),
    },
    sourceIds: uniq([
      'metro-command-catalog',
      'metro-command-reference-golden',
      'metro-docs-explain-output-anatomy-golden',
      'metro-docs-explain-topic-index-golden',
      'metro-input-normalize-shape-golden',
      'metro-api-preview-golden',
      'metro-api-read-pipeline-golden',
      ...exampleIds.map((exampleId) => `example:${exampleId}`),
    ]),
    sources: uniq([
      'docs/metronome-cli/README.md',
      'docs/metronome-cli/site/integration.html',
      'metronome-cli/src/commands/catalog.js',
      'metronome-cli/src/docs/explain.js',
      'metronome-cli/src/input/normalize.js',
      'metronome-cli/src/api-catalog/preview.js',
      'metronome-cli/src/api-catalog/read-pipeline.js',
      'metronome-cli/test/golden/docs/command-reference.json',
      'metronome-cli/test/golden/docs/explain.output-anatomy.json',
      'metronome-cli/test/golden/input/normalize.pro-annual-yaml.json',
      'metronome-cli/test/golden/api/preview.contracts-create.sandbox.json',
      'metronome-cli/test/golden/api/read-pipeline.contracts-get.dry-run.sandbox.json',
      ...exampleIds.map((exampleId) => examplesById[exampleId].golden),
    ]),
  };
}

function refusalTroubleshootingTopic(topic, bundle) {
  if (topic !== 'refusal.troubleshooting') return null;
  const commandsById = Object.fromEntries(
    bundle.sections.commandReference.commands.map((command) => [command.id, command]),
  );
  const unsupportedById = Object.fromEntries(
    (bundle.sections.commandReference.unsupportedCommands || []).map((command) => [command.id, command]),
  );
  const examplesById = Object.fromEntries(
    bundle.sections.examples.fixtures.map((example) => [example.id, example]),
  );
  const localCommandIds = [
    'docs.explain',
    'docs.command-reference',
    'api.readiness',
    'api.read-preflight',
    'api.read-plan',
    'api.read-gate.template',
    'api.read-gate.validate',
    'api.preview',
    'api.preflight.template',
    'api.apply-gate.template',
    'api.apply-gate.validate',
    'api.apply-result.validate',
  ].filter((commandId) => commandsById[commandId]);
  const refusalCommandIds = [
    'api.read',
    'api.apply',
    'package.apply',
    'contract.move-plan.apply',
    'product.retire.apply',
    'custom-contract.apply',
  ].filter((commandId) => isRefusalCommand(commandId, commandsById, unsupportedById));
  const exampleIds = [
    'api.readiness',
    'api.preview.contracts-create',
    'api.preflight.contracts-create',
  ].filter((exampleId) => examplesById[exampleId]);
  if (!commandsById['docs.explain'] || !commandsById['api.readiness'] || !commandsById['api.read']) return null;

  return {
    type: 'operating-doc-topic',
    id: 'refusal.troubleshooting',
    title: 'Refusal troubleshooting',
    summary: 'Use this topic when metro refuses a live read, live apply, unsupported workflow apply, or unsafe input: keep the refusal as a safety signal, identify the schema and blocked command, then gather the local preview, preflight, gate, audit, read-back, and approval evidence named by nextSafeStep before retrying any narrower local command.',
    status: 'local-proof-backed',
    apiAccess: 'none',
    keyFields: {
      liveExecutionEnabledInCurrentCli: false,
      refusalSchemas: ['metro.refusal.v1', 'metro.api.read.refusal.v1'],
      refusalCommandIds,
      localRecoveryCommandIds: localCommandIds,
      recoveryOrder: [
        'Read schemaVersion, command, blockReason, blockers, findings, and nextSafeStep before changing input.',
        'Use metro docs command-reference --json or metro docs explain command:<id> --json to confirm whether the refused command is intentionally unsupported.',
        'Use metro api readiness --summary --json for local endpoint readiness and gap counts before planning expert API read or write follow-up work.',
        'For expert reads, run metro api read only after read-gate validation, tenant selection, and METRONOME_SANDBOX_KEY or METRONOME_PROD_KEY are configured.',
        'For expert writes or workflow applies, build preview/preflight/apply-gate/audit/read-back evidence; sandbox contracts.create is live-guarded with explicit confirmation.',
        'If the refusal cites secrets, tenant ambiguity, raw endpoint paths, invoice side effects, Stripe behavior, idempotency, or rollback gaps, fix the local evidence instead of bypassing the refusal.',
      ],
      blockedDoesNotMean: [
        'A local .env or API key is sufficient authorization.',
        'A dry-run or preview proves the live write validator will accept the payload.',
        'A confirm hash can replace reviewed preflight, sandbox proof, audit, read-back, rollback, and approval evidence.',
      ],
      safeFollowUpByMode: {
        validate: ['metro validate --shape <shape> --file <input.json|yaml> --json', 'metro api validate <endpoint-id> --file <request.json|yaml> --json'],
        preview: ['metro package preview --shape pro-annual --file <input.json|yaml> --sandbox --json', 'metro api preview <endpoint-id> --file <request.json|yaml> --sandbox --json'],
        read: ['metro api read-plan <endpoint-id> --file <request.json|yaml> --sandbox --json', 'metro api read-preflight <endpoint-id> --file <request.json|yaml> --sandbox --json'],
        apply: ['metro preflight template --workflow <workflow> --shape <shape> --prod --json', 'metro apply-gate template --workflow <workflow> --shape <shape> --prod --json', 'metro verify apply-result-template --workflow <workflow> --shape <shape> --sandbox --json'],
      },
      sourceBackedRules: [
        'No silent production access; every live path needs explicit tenant selection.',
        'Do not infer permission from .env files, local keys, script names, or dry-run flags.',
        'Broad expert API access must use reviewed endpoint IDs, not raw endpoint paths.',
        'Production writes require preview hash binding plus reviewed preflight, audit, idempotency, rollback/remediation, and read-back evidence.',
      ],
      goldenFixtures: [
        'metronome-cli/test/golden/api/read.refusal.contracts-get-v2.sandbox.json',
        'metronome-cli/test/golden/api/readiness-summary.json',
        'metronome-cli/test/golden/docs/command-reference.json',
        ...exampleIds.map((exampleId) => examplesById[exampleId].golden),
      ],
    },
    related: {
      commands: [
        'metro docs explain refusal.troubleshooting --json',
        'metro docs explain output.anatomy --json',
        'metro docs command-reference --json',
        'metro api readiness --summary --json',
        'metro api read-preflight <endpoint-id> --file <request.json|yaml> --sandbox --json',
        'metro api preview <endpoint-id> --file <request.json|yaml> --sandbox --json',
        'metro apply-gate template --workflow <workflow> --shape <shape> --prod --json',
      ],
      localRecoveryCommands: localCommandIds.map((commandId) => commandsById[commandId].command),
      refusedCommands: refusalCommandIds.map((commandId) => refusalCommandEntry(commandId, commandsById, unsupportedById).command),
    },
    sourceIds: uniq([
      'metro-command-catalog',
      'metro-command-reference-golden',
      'metro-docs-explain-output-anatomy-golden',
      'metro-docs-explain-topic-index-golden',
      'metro-docs-explain-refusal-troubleshooting-golden',
      'metro-api-readiness-golden',
      'metro-api-read-refusal-golden',
      ...exampleIds.map((exampleId) => `example:${exampleId}`),
    ]),
    sources: uniq([
      'docs/SAFETY.md',
      'docs/API_OPERATIONS.md',
      'docs/metronome-cli/one-goal.md',
      'docs/metronome-cli/CLI_ARCHITECTURE.md',
      'docs/metronome-cli/VALIDATION_AND_GUARDRAILS.md',
      'docs/metronome-cli/GOTCHAS.md',
      '.cursor/skills/metronome-danger-zone/SKILL.md',
      'metronome-cli/src/commands/catalog.js',
      'metronome-cli/src/docs/explain.js',
      'metronome-cli/src/api-catalog/read-refusal.js',
      'metronome-cli/src/api-catalog/readiness.js',
      'metronome-cli/test/golden/api/read.refusal.contracts-get-v2.sandbox.json',
      'metronome-cli/test/golden/api/readiness-summary.json',
      'metronome-cli/test/golden/docs/command-reference.json',
      'metronome-cli/test/golden/docs/explain.output-anatomy.json',
      ...exampleIds.map((exampleId) => examplesById[exampleId].golden),
    ]),
  };
}

function billingProviderAttachmentTopic(topic, bundle) {
  if (topic !== 'billing-provider.attachment') return null;
  const commandsById = Object.fromEntries(
    bundle.sections.commandReference.commands.map((command) => [command.id, command]),
  );
  const unsupportedById = Object.fromEntries(
    (bundle.sections.commandReference.unsupportedCommands || []).map((command) => [command.id, command]),
  );
  const endpointsById = Object.fromEntries(
    bundle.sections.apiReference.endpoints.map((endpoint) => [endpoint.id, endpoint]),
  );
  const shape = bundle.sections.shapeReference.shapes.find((candidate) => candidate.id === 'stripe-billing-provider-attachment');
  const previewCommand = commandsById['billing-provider.preview.stripe-attachment'];
  const inspectPlanCommand = commandsById['billing-provider.inspect.plan'];
  const blockedInspect = unsupportedById['billing-provider.inspect'];
  const relatedEndpointIds = [
    'billingProvider.setCustomerConfigurations',
    'billingProvider.getCustomerConfigurations',
    'billingProvider.listConfiguredProviders',
    'customers.get',
    'invoices.listForCustomer',
  ].filter((endpointId) => endpointsById[endpointId]);
  if (!shape || !previewCommand || !inspectPlanCommand) return null;

  return {
    type: 'operating-doc-topic',
    id: 'billing-provider.attachment',
    title: 'Billing-provider attachment workflow',
    summary: 'Use the local Stripe billing-provider attachment shape to validate delivery method scope, existing configuration policy, Stripe draft behavior, and read-back evidence before any future customer billing-provider write is considered.',
    status: 'local-preview-backed',
    apiAccess: 'none',
    keyFields: {
      workflow: 'billing-provider.attach',
      shape: 'stripe-billing-provider-attachment',
      liveExecutionEnabledInCurrentCli: false,
      applyEnabledInCurrentCli: false,
      previewSchemaVersion: 'metro.preview.v1',
      evidenceTemplateSchemaVersions: {
        preflight: 'metro.preflight.v1',
        audit: 'metro.audit.template.v1',
        sandboxProof: 'metro.sandbox-proof.v1',
        applyGate: 'metro.apply-gate.v1',
      },
      requiredInputSections: clone(shape.requiredInput || []),
      relatedEndpointIds,
      relatedRuleIds: [
        'MTR-BILL-001',
        'MTR-BILL-002',
        'MTR-BILL-003',
        'MTR-BILL-004',
        'MTR-BILL-005',
        'MTR-VERIFY-001',
        'MTR-VERIFY-002',
      ],
      localEvidencePath: [
        'Validate the local input with metro validate --shape stripe-billing-provider-attachment.',
        'Run billing-provider inspect with --plan before previewing an attachment so the planned read-back surface is explicit.',
        'Run billing-provider preview in sandbox mode and inspect the payload hash, delivery evidence, draft behavior, expected side effects, and verification plan.',
        'Use preflight, audit, sandbox-proof, and apply-gate templates as local evidence contracts only; they do not enable billing-provider apply.',
        'Before any future live runner exists, prove current billing-provider state, account-level multi-entity delivery evidence, customer config read-back, invoice delivery posture, rollback/remediation, and owner approval.',
      ],
      blockedApplyReasons: [
        'No billing-provider apply runner is enabled in the current CLI.',
        'The preview can plan setCustomerBillingProviderConfigurations and updateConfig payloads, but it does not call Metronome.',
        'Wrong Stripe delivery settings can route invoices to the wrong Stripe customer, account, collection method, or draft behavior.',
        'Live reads or writes require explicit current-turn authorization, tenant selection, audit, canary, rollback, and read-back evidence.',
      ],
      localProof: [
        'metronome-cli/test/fixtures/stripe-billing-provider-valid.json',
        'metronome-cli/test/golden/stripe-billing-provider-attachment-preview.sandbox.json',
        'metronome-cli/test/golden/inspect/billing-provider.plan.production.json',
        'metronome-cli/test/golden/preflight/billing-provider-attach.stripe-billing-provider-attachment.template.production.json',
        'metronome-cli/test/golden/audit/billing-provider-attach.stripe-billing-provider-attachment.template.production.json',
        'metronome-cli/test/golden/proof/billing-provider-attach.stripe-billing-provider-attachment.sandbox-template.json',
        'metronome-cli/test/golden/apply-gate/billing-provider-attach.stripe-billing-provider-attachment.template.production.json',
        'metronome-cli/test/golden/api/read-plan.billing-provider-get.production.json',
        'metronome-cli/test/golden/api/read-plan.billing-provider-list-configured.sandbox.json',
        'metronome-cli/test/golden/api/read-pipeline.billing-provider-get.dry-run.production.json',
        'metronome-cli/test/golden/api/read-pipeline.billing-provider-list-configured.dry-run.sandbox.json',
      ],
    },
    related: {
      commands: [
        'metro docs explain billing-provider.attachment --json',
        'metro validate --shape stripe-billing-provider-attachment --file metronome-cli/test/fixtures/stripe-billing-provider-valid.json --json',
        'metro input normalize --shape stripe-billing-provider-attachment --file metronome-cli/test/fixtures/stripe-billing-provider-valid.json --json',
        inspectPlanCommand.command,
        previewCommand.command,
        'metro preflight template --workflow billing-provider.attach --shape stripe-billing-provider-attachment --prod --json',
        'metro audit template --workflow billing-provider.attach --shape stripe-billing-provider-attachment --prod --json',
        'metro proof sandbox-template --workflow billing-provider.attach --shape stripe-billing-provider-attachment --json',
        'metro apply-gate template --workflow billing-provider.attach --shape stripe-billing-provider-attachment --prod --json',
        'metro api read-plan billingProvider.getCustomerConfigurations --file metronome-cli/test/fixtures/api-billing-provider-get-valid.json --prod --json',
        'metro api read-plan billingProvider.listConfiguredProviders --file metronome-cli/test/fixtures/api-billing-provider-list-configured-valid.json --sandbox --json',
      ],
      blockedCommands: blockedInspect ? [blockedInspect.command] : [],
      endpointIds: relatedEndpointIds,
    },
    sourceIds: uniq([
      'metronome-stripe-delivery',
      'endpoint-matrix',
      'official-billing-provider',
      'official-billing-provider-get',
      'official-list-configured-billing-providers',
      'official-customer-get',
      'official-customer-update-config',
      'official-invoice-list',
      'metro-billing-provider-attach-fixture',
      'metro-billing-provider-preview-golden',
      'metro-billing-provider-inspect-plan-golden',
      'metro-docs-explain-billing-provider-attachment-golden',
      'metro-docs-explain-topic-index-golden',
    ]),
    sources: uniq([
      'docs/metronome-cli/one-goal.md',
      'docs/metronome-cli/SHAPE_CATALOG.md',
      'docs/metronome-cli/VALIDATION_AND_GUARDRAILS.md',
      'docs/metronome-cli/GOTCHAS.md',
      '.cursor/skills/metronome-stripe-delivery/SKILL.md',
      '.cursor/skills/metronome-danger-zone/references/endpoint-matrix.md#7-billing-provider-configs-stripe',
      'metronome-cli/src/docs/explain.js',
      'metronome-cli/src/shapes/index.js',
      'metronome-cli/src/validators/index.js',
      'metronome-cli/src/preview/index.js',
      'metronome-cli/src/preflight/index.js',
      'metronome-cli/src/audit/index.js',
      'metronome-cli/src/proof/sandbox-manifest.js',
      'metronome-cli/src/apply-gate/index.js',
      'metronome-cli/src/inspect/index.js',
      'metronome-cli/test/fixtures/stripe-billing-provider-valid.json',
      'metronome-cli/test/golden/stripe-billing-provider-attachment-preview.sandbox.json',
      'metronome-cli/test/golden/inspect/billing-provider.plan.production.json',
      'metronome-cli/test/golden/docs/explain.billing-provider-attachment.json',
      ...relatedEndpointIds.flatMap((endpointId) => endpointsById[endpointId].sources || []),
    ]),
  };
}

function customerSetupTopic(topic, bundle) {
  if (topic !== 'customer.setup') return null;
  const commandsById = Object.fromEntries(
    bundle.sections.commandReference.commands.map((command) => [command.id, command]),
  );
  const unsupportedById = Object.fromEntries(
    (bundle.sections.commandReference.unsupportedCommands || []).map((command) => [command.id, command]),
  );
  const endpointsById = Object.fromEntries(
    bundle.sections.apiReference.endpoints.map((endpoint) => [endpoint.id, endpoint]),
  );
  const shape = bundle.sections.shapeReference.shapes.find((candidate) => candidate.id === 'customer-setup');
  const previewCommand = commandsById['customer.setup.preview'];
  const blockedApply = unsupportedById['customer.setup.apply'];
  const relatedEndpointIds = [
    'customers.list',
    'customers.create',
    'customers.get',
    'customers.updateConfig',
    'billingProvider.getCustomerConfigurations',
    'invoices.listForCustomer',
  ].filter((endpointId) => endpointsById[endpointId]);
  if (!shape || !previewCommand) return null;

  return {
    type: 'operating-doc-topic',
    id: 'customer.setup',
    title: 'Customer setup preview workflow',
    summary: 'Use the local customer-setup shape to validate customer identity, ingest alias collision review, optional Stripe billing-provider configuration, customer configuration, read-back checks, and rollback planning before any customer create workflow is considered.',
    status: 'local-preview-backed',
    apiAccess: 'none',
    keyFields: {
      workflow: 'customer.setup',
      shape: 'customer-setup',
      liveExecutionEnabledInCurrentCli: false,
      applyEnabledInCurrentCli: false,
      previewSchemaVersion: 'metro.preview.v1',
      evidenceTemplateSchemaVersions: {
        preflight: 'metro.preflight.v1',
        audit: 'metro.audit.template.v1',
        sandboxProof: 'metro.sandbox-proof.v1',
        applyGate: 'metro.apply-gate.v1',
      },
      requiredInputSections: clone(shape.requiredInput || []),
      relatedEndpointIds,
      relatedRuleIds: [
        'MTR-CUST-001',
        'MTR-CUST-002',
        'MTR-CUST-003',
        'MTR-CUST-004',
        'MTR-BILL-001',
        'MTR-BILL-002',
        'MTR-BILL-004',
        'MTR-BILL-005',
        'MTR-IDEMP-003',
        'MTR-VERIFY-001',
        'MTR-VERIFY-002',
      ],
      localEvidencePath: [
        'Validate the local input with metro validate --shape customer-setup.',
        'Normalize JSON or YAML input before preview when the input is coming from an operator, agent, or generated artifact.',
        'Run customer setup preview in sandbox mode and inspect the payload hash, planned reads, planned writes, side effects, warnings, verification plan, and applyBlocker.',
        'Use the preflight, audit, sandbox-proof, and apply-gate templates as local evidence contracts only; they do not enable live apply.',
        'Before any future live runner exists, prove ingest alias collision state, archived customer review, Stripe billing-provider read-back, no-invoice side effects, rollback/remediation, and owner approval.',
      ],
      blockedApplyReasons: [
        'No customer setup apply runner is enabled in the current CLI.',
        'Preview, template generation, and gate validation are local evidence only.',
        'Customer create can affect customer access, ingest alias ownership, Stripe delivery posture, and later invoice routing.',
        'Live reads or writes require explicit current-turn authorization, tenant selection, audit, canary, rollback, and read-back evidence.',
      ],
      localProof: [
        'metronome-cli/test/fixtures/customer-setup-valid.json',
        'metronome-cli/test/golden/customer-setup-preview.sandbox.json',
        'metronome-cli/test/golden/preflight/customer-setup.customer-setup.template.production.json',
        'metronome-cli/test/golden/audit/customer-setup.customer-setup.template.production.json',
        'metronome-cli/test/golden/proof/customer-setup.customer-setup.sandbox-template.json',
        'metronome-cli/test/golden/apply-gate/customer-setup.customer-setup.template.production.json',
      ],
    },
    related: {
      commands: [
        'metro docs explain customer.setup --json',
        'metro validate --shape customer-setup --file metronome-cli/test/fixtures/customer-setup-valid.json --json',
        'metro input normalize --shape customer-setup --file metronome-cli/test/fixtures/customer-setup-valid.json --json',
        previewCommand.command,
        'metro preflight template --workflow customer.setup --shape customer-setup --prod --json',
        'metro audit template --workflow customer.setup --shape customer-setup --prod --json',
        'metro proof sandbox-template --workflow customer.setup --shape customer-setup --json',
        'metro apply-gate template --workflow customer.setup --shape customer-setup --prod --json',
        'metro api read-plan customers.get --file metronome-cli/test/fixtures/api-customers-get-valid.json --sandbox --json',
        'metro api read-plan customers.list --file metronome-cli/test/fixtures/api-customers-list-valid.json --sandbox --json',
      ],
      blockedCommands: blockedApply ? [blockedApply.command] : [],
      endpointIds: relatedEndpointIds,
    },
    sourceIds: uniq([
      'metronome-customers-hierarchies',
      'metronome-stripe-delivery',
      'endpoint-matrix',
      'official-customer-create',
      'official-customer-get',
      'official-customer-list',
      'official-customer-update-config',
      'official-billing-provider',
      'official-invoice-list',
      'metro-customer-setup-fixtures',
      'metro-customer-setup-preview-golden',
      'metro-docs-explain-customer-setup-golden',
      'metro-docs-explain-topic-index-golden',
    ]),
    sources: uniq([
      'docs/metronome-cli/one-goal.md',
      'docs/metronome-cli/SHAPE_CATALOG.md',
      'docs/metronome-cli/VALIDATION_AND_GUARDRAILS.md',
      'docs/metronome-cli/GOTCHAS.md',
      '.cursor/skills/metronome-customers-hierarchies/SKILL.md',
      '.cursor/skills/metronome-stripe-delivery/SKILL.md',
      '.cursor/skills/metronome-danger-zone/references/endpoint-matrix.md',
      'metronome-cli/src/docs/explain.js',
      'metronome-cli/src/shapes/index.js',
      'metronome-cli/src/validators/index.js',
      'metronome-cli/src/preview/index.js',
      'metronome-cli/src/preflight/index.js',
      'metronome-cli/src/audit/index.js',
      'metronome-cli/src/proof/sandbox-manifest.js',
      'metronome-cli/src/apply-gate/index.js',
      'metronome-cli/test/fixtures/customer-setup-valid.json',
      'metronome-cli/test/golden/customer-setup-preview.sandbox.json',
      'metronome-cli/test/golden/docs/explain.customer-setup.json',
      ...relatedEndpointIds.flatMap((endpointId) => endpointsById[endpointId].sources || []),
    ]),
  };
}

function creditsProductDecisionTopic(topic) {
  if (topic !== 'credits.product.decision') return null;
  return {
    type: 'operating-doc-topic',
    id: 'credits.product.decision',
    title: 'Credits / usage product decision tree',
    summary: 'When someone says "add a credits product", stop and classify before creating Metronome objects. Most asks are (A) a new pricing dimension on an existing USAGE product, (B) a credit grant on an existing contract, (C) credits inside a package commit schedule, or rarely (D) a greenfield USAGE product + billable metric. Do not create products or billable metrics for new action codes.',
    status: 'local-preview-backed',
    apiAccess: 'none',
    keyFields: {
      interview: [
        'Is there already a shared USAGE product that burns credits via pricing_group_key (action_code / dimension)?',
        'Do they need a new chargeable code on that product, or a new standalone product/metric?',
        'Are they granting balance to one customer, or changing catalog pricing for everyone?',
        'If greenfield: what aggregation (COUNT events vs SUM of a property), group keys, and event properties?',
        'How should it attach: rate card + package only, or also recurring_commits / contract edits?',
      ],
      forks: {
        A_dimensional_value: {
          when: 'Shared credits-consumed USAGE product already exists; need a new code/price.',
          do: [
            'metro docs explain rate-cards.dimensional --markdown',
            'metro plan add-pricing-dimension-value --dimension-key <KEY> --price <n> --sandbox --json',
            'metro validate --shape dimensional-rate-card --file <input.json> --json',
            'metro rate-card dimensional preview --file <input.json> --sandbox --json',
          ],
          refuse: ['products.create', 'billableMetrics.create', 'rateCards.update (replace card)'],
        },
        B_grant_on_contract: {
          when: 'Give one customer more credits / complimentary / paid top-up.',
          do: [
            'metro ops who "<customer>" --sandbox',
            'metro plan complimentary-credits --sandbox --json',
            'metro credit preview --shape complimentary-credit-grant --file <grant.json> --sandbox --json',
          ],
        },
        C_package_commit_schedule: {
          when: 'Credits ship with a plan fee / trial package for new contracts.',
          do: [
            'metro plan annual-subscription-package --sandbox --json',
            'metro plan free-trial-package --sandbox --json',
            'metro package preview --shape pro-annual-self-serve-v2|free-credit-trial --file <pkg.json> --sandbox --json',
          ],
        },
        D_greenfield_product_metric: {
          when: 'No shared USAGE product yet, or aggregation/event shape must change.',
          do: [
            'metro catalog bind --sandbox --write',
            'metro docs explain products.create --markdown',
            'metro docs explain billableMetrics.create --markdown',
            'metro api preview products.create --file <product.json> --sandbox --json (local ladder only until write is enablelisted)',
          ],
          note: 'Public/generic v1 has no first-class apply shape for greenfield BM+product. Stay on validate/preview/API-catalog ladder; confirm aggregation (COUNT vs SUM), group_keys, and credit_type_id before any write.',
        },
      },
      aggregationCheatSheet: {
        COUNT: 'Bill once per matching event (common for action_code dimensional burns).',
        SUM: 'Bill the numeric property total (e.g. credit_amount / quantity fields).',
        UNIQUE: 'Bill distinct values of a property; rare for credits products - confirm product need first.',
      },
    },
    related: {
      commands: [
        'metro docs explain credits.product.decision --markdown',
        'metro route --goal "add a credits product" --sandbox --json',
        'metro plan add-pricing-dimension-value --dimension-key <KEY> --price <n> --sandbox --json',
        'metro plan complimentary-credits --sandbox --json',
        'metro catalog bind --sandbox --write',
      ],
    },
    sourceIds: [
      'credits-product-decision',
      'rate-cards-dimensional',
      'shape-dimensional-rate-card',
      'shape-complimentary-credit-grant',
    ],
    sources: [
      'docs/metronome-cli/COOKBOOK.md',
      'docs/metronome-cli/site/agents.md',
      'docs/metronome-cli/SHAPE_CATALOG.md',
      'docs/metronome-cli/GOTCHAS.md',
      'https://docs.metronome.com/api-reference/products/create-a-product.md',
      'https://docs.metronome.com/api-reference/billable-metrics/create-a-billable-metric.md',
    ],
  };
}

function workspaceRoutingTopic(topic, bundle) {
  if (topic !== 'workspace.routing') return null;
  return {
    type: 'operating-doc-topic',
    id: 'workspace.routing',
    title: 'Workspace-aware plan routing',
    summary: 'Use metro workspace explain, metro plan <intent>, and metro route --goal to pick optimal shapes, refuse suboptimal API paths (e.g. products.create for a new action code), and bind sandbox/production via tenant profiles. For ambiguous "credits product" asks start with metro docs explain credits.product.decision --markdown.',
    status: 'local-preview-backed',
    apiAccess: 'none',
    keyFields: {
      commands: [
        'metro workspace explain --json',
        'metro workspace status --file profiles.json --profile metro-sandbox --check-env --json',
        'metro plan list --json',
        'metro plan add-action-rate --action-code SP-FIND --display-name "Ideal Sponsor Finder" --price 20 --sandbox --json',
        'metro plan multi-tier-rate-rollout --action-code SP-FIND --sandbox --json',
        'metro audit export classify --file audit-export.json --token sh-test --sandbox --json',
        'metro route --goal "add charge code SP-FIND" --sandbox --json',
        'metro route --api products.create --goal "new action code" --sandbox --json',
        'metro docs explain rate-cards.dimensional --json',
      ],
      catalogMode: 'add-rates-only for new action codes on existing dimensional product',
      intents: [
        'add-action-rate',
        'multi-tier-rate-rollout',
        'package-plan-move',
        'package-version-handoff',
        'complimentary-credits',
        'billing-provider-repair',
        'onboard-from-package',
        'audit-token-history',
        'annual-self-serve-package',
        'ledger-adjustment',
      ],
    },
    related: {
      commands: [
        'metro workspace explain --json',
        'metro plan add-action-rate --sandbox --json',
        'metro route --goal "<billing goal>" --sandbox --json',
      ],
    },
    sourceIds: ['metro-workspace-routing'],
    sources: packExplainTopics.workspaceRoutingSources(),
  };
}

function dimensionalRateCardTopic(topic, bundle) {
  return packExplainTopics.buildDimensionalRateCardTopic(topic, bundle);
}

function sendInvoiceStripeTopic(topic, bundle) {
  return packExplainTopics.buildSendInvoiceStripeTopic(topic, bundle);
}

function contractTransitionsRebuyTopic(topic, bundle) {
  return packExplainTopics.buildContractTransitionsRebuyTopic(topic, bundle);
}

function contractOverrideInspectionTopic(topic, bundle) {
  if (topic !== 'contract-overrides.inspection') return null;
  const endpoints = Object.fromEntries(
    bundle.sections.apiReference.endpoints.map((endpoint) => [endpoint.id, endpoint]),
  );
  const contractRateSchedule = endpoints['contracts.getRateSchedule'];
  const rateCardGetRates = endpoints['rateCards.getRates'];
  if (!contractRateSchedule || !rateCardGetRates) return null;

  return {
    type: 'operating-doc-topic',
    id: 'contract-overrides.inspection',
    title: 'Contract override inspection',
    summary: 'Use contracts.getRateSchedule for customer-specific contract prices that must include contract-level overrides; use rateCards.getRates for rate-card source prices before customer contract overrides.',
    status: 'local-proof-backed',
    apiAccess: 'none',
    keyFields: {
      recommendedEndpointId: contractRateSchedule.id,
      recommendedPath: contractRateSchedule.path,
      comparisonEndpointId: rateCardGetRates.id,
      comparisonPath: rateCardGetRates.path,
      liveExecutionEnabledInCurrentCli: false,
      decisionRules: [
        'Use contracts.getRateSchedule when customer_id and contract_id are known or when negotiated discounts, promotions, or contract-level overrides must be reflected.',
        'Use rateCards.getRates when checking the rate-card source price at a timestamp before customer-specific contract overrides are applied.',
        'Do not use raw paths or curl-style calls; use reviewed endpoint IDs, explicit tenant selection, validation, read-plan, read-gate, read-mock, and read-pipeline evidence.',
      ],
      requestPlacement: {
        'contracts.getRateSchedule': {
          body: ['customer_id', 'contract_id', 'at', 'selectors'],
          query: ['limit', 'next_page'],
        },
        'rateCards.getRates': {
          body: ['rate_card_id', 'at', 'selectors'],
          query: ['limit', 'next_page'],
        },
      },
      responseFields: {
        'contracts.getRateSchedule': ['rate_card_id', 'product_id', 'product_name', 'product_tags', 'product_custom_fields', 'pricing_group_values', 'entitled', 'list_rate', 'override_rate', 'commit_rate', 'billing_frequency', 'next_page'],
        'rateCards.getRates': ['product_id', 'product_name', 'product_tags', 'product_custom_fields', 'pricing_group_values', 'entitled', 'rate', 'commit_rate', 'billing_frequency', 'next_page'],
      },
      localProof: [
        'metronome-cli/test/golden/api/read-plan.contracts-rate-schedule.sandbox.json',
        'metronome-cli/test/golden/api/read-mock.contracts-rate-schedule.bundle.sandbox.json',
        'metronome-cli/test/golden/api/read-pipeline.contracts-rate-schedule.dry-run.sandbox.json',
        'metronome-cli/test/golden/api/read-plan.rate-cards-get-rates.sandbox.json',
        'metronome-cli/test/golden/api/read-mock.rate-cards-get-rates.bundle.sandbox.json',
        'metronome-cli/test/golden/api/read-pipeline.rate-cards-get-rates.dry-run.sandbox.json',
      ],
    },
    related: {
      endpointIds: [contractRateSchedule.id, rateCardGetRates.id],
      commands: [
        'metro docs explain contract-overrides.inspection --json',
        'metro api explain contracts.getRateSchedule --json',
        'metro api explain rateCards.getRates --json',
        'metro api read-plan contracts.getRateSchedule --file metronome-cli/test/fixtures/api-contracts-rate-schedule-valid.json --sandbox --json',
        'metro api read-plan rateCards.getRates --file metronome-cli/test/fixtures/api-rate-cards-get-rates-valid.json --sandbox --json',
        'metro api read-pipeline contracts.getRateSchedule --file metronome-cli/test/fixtures/api-contracts-rate-schedule-valid.json --read-gate metronome-cli/test/fixtures/api-read-gate-contracts-rate-schedule-valid.json --mock-response metronome-cli/test/fixtures/api-contracts-rate-schedule-mock-response.json --out audit-logs/api-read-pipeline-contracts-rate-schedule.jsonl --actor agent-local-test --dry-run --json',
      ],
    },
    sourceIds: uniq([
      ...(contractRateSchedule.sourceIds || []),
      ...(rateCardGetRates.sourceIds || []),
      'metro-api-read-plan-golden-contracts-rate-schedule',
      'metro-api-read-mock-contracts-rate-schedule-golden',
      'metro-api-read-pipeline-contracts-rate-schedule-golden',
      'metro-api-read-plan-golden-rate-cards-get-rates',
      'metro-api-read-mock-rate-cards-get-rates-golden',
      'metro-api-read-pipeline-rate-cards-get-rates-golden',
    ]),
    sources: uniq([
      ...contractRateSchedule.sources,
      ...rateCardGetRates.sources,
      'metronome-cli/src/docs/explain.js',
      'metronome-cli/test/fixtures/api-contracts-rate-schedule-valid.json',
      'metronome-cli/test/fixtures/api-contracts-rate-schedule-mock-response.json',
      'metronome-cli/test/golden/api/read-pipeline.contracts-rate-schedule.dry-run.sandbox.json',
      'metronome-cli/test/golden/api/read-pipeline.rate-cards-get-rates.dry-run.sandbox.json',
    ]),
  };
}

function productRateRetirementReadbackTopic(topic, bundle) {
  if (topic !== 'product-rate-retirement.readback') return null;
  const endpoints = Object.fromEntries(
    bundle.sections.apiReference.endpoints.map((endpoint) => [endpoint.id, endpoint]),
  );
  const productsGet = endpoints['products.get'];
  const productsArchive = endpoints['products.archive'];
  const rateCardGetRates = endpoints['rateCards.getRates'];
  const rateCardAddRates = endpoints['rateCards.addRates'];
  const rateCardSchedule = endpoints['rateCards.getRateSchedule'];
  if (!productsGet || !productsArchive || !rateCardGetRates || !rateCardAddRates || !rateCardSchedule) return null;

  return {
    type: 'operating-doc-topic',
    id: 'product-rate-retirement.readback',
    title: 'Product rate retirement read-back',
    summary: 'Use rateCards.addRates only as a reviewed future write for closing rates; verify product retirement with rateCards.getRates, rateCards.getRateSchedule, products.get, and invoice-impact evidence before any product archive is considered.',
    status: 'local-proof-backed',
    apiAccess: 'none',
    keyFields: {
      workflow: 'product.rate-retirement',
      shape: 'product-rate-retirement',
      liveExecutionEnabledInCurrentCli: false,
      writeEndpointIds: [rateCardAddRates.id, productsArchive.id],
      readbackEndpointIds: [rateCardGetRates.id, rateCardSchedule.id, productsGet.id],
      relatedProofShapeIds: ['product-rate-retirement', 'package-alias-archive-handoff'],
      decisionRules: [
        'Close affected product rates first with rateCards.addRates entries using entitled:false and price:0.',
        'Use rateCards.getRates at the retirement timestamp to prove the effective rate no longer entitles or prices the retired product.',
        'Use rateCards.getRateSchedule to inspect scheduled rate-card changes around the retirement timestamp.',
        'Use products.get to prove product archive or scheduled product state; product archive is optional and never substitutes for rate close proof.',
        'Package archive handoff proof is only a related read-back pattern for archive workflows; it does not authorize product archive or rate-card writes.',
        'Keep invoice-impact review and rollback/remediation evidence attached before any future apply gate.',
      ],
      requestPlacement: {
        'rateCards.getRates': {
          body: ['rate_card_id', 'at', 'selectors'],
          query: ['limit', 'next_page'],
        },
        'rateCards.getRateSchedule': {
          body: ['rate_card_id'],
          query: [],
        },
        'products.get': {
          body: ['id'],
          query: [],
        },
      },
      localProof: [
        'metronome-cli/test/golden/product-rate-retirement-preview.sandbox.json',
        'metronome-cli/test/golden/preflight/product-rate-retirement.product-rate-retirement.template.production.json',
        'metronome-cli/test/golden/audit/product-rate-retirement.product-rate-retirement.template.production.json',
        'metronome-cli/test/golden/proof/product-rate-retirement.product-rate-retirement.sandbox-template.json',
        'metronome-cli/test/golden/apply-gate/product-rate-retirement.product-rate-retirement.template.production.json',
        'metronome-cli/test/golden/api/read-plan.products-get.sandbox.json',
        'metronome-cli/test/golden/api/read-plan.rate-cards-get-rates.sandbox.json',
        'metronome-cli/test/golden/api/read-plan.rate-card-schedule.sandbox.json',
        'metronome-cli/test/golden/api/read-pipeline.products-get.dry-run.sandbox.json',
        'metronome-cli/test/golden/api/read-pipeline.rate-cards-get-rates.dry-run.sandbox.json',
        'metronome-cli/test/golden/api/read-pipeline.rate-card-schedule.dry-run.sandbox.json',
        'metronome-cli/test/fixtures/api-read-audit-products-get-valid.jsonl',
        'metronome-cli/test/golden/api/read-audit.products-get.validation.sandbox.json',
        'metronome-cli/test/fixtures/api-read-audit-rate-cards-get-rates-valid.jsonl',
        'metronome-cli/test/golden/api/read-audit.rate-cards-get-rates.validation.sandbox.json',
        'metronome-cli/test/golden/proof/package-archive.package-alias-archive-handoff.sandbox-template.json',
      ],
    },
    related: {
      endpointIds: [rateCardAddRates.id, rateCardGetRates.id, rateCardSchedule.id, productsGet.id, productsArchive.id],
      commands: [
        'metro docs explain product-rate-retirement.readback --json',
        'metro product retire preview --file metronome-cli/test/fixtures/product-rate-retirement-valid.json --sandbox --json',
        'metro api explain rateCards.addRates --json',
        'metro api explain rateCards.getRates --json',
        'metro api explain rateCards.getRateSchedule --json',
        'metro api explain products.get --json',
        'metro api explain products.archive --json',
        'metro api read-plan rateCards.getRates --file metronome-cli/test/fixtures/api-rate-cards-get-rates-valid.json --sandbox --json',
        'metro api read-plan rateCards.getRateSchedule --file metronome-cli/test/fixtures/api-rate-card-schedule-valid.json --sandbox --json',
        'metro api read-plan products.get --file metronome-cli/test/fixtures/api-products-get-valid.json --sandbox --json',
        'metro api read-audit validate --file metronome-cli/test/fixtures/api-read-audit-products-get-valid.jsonl --json',
        'metro preflight template --workflow product.rate-retirement --shape product-rate-retirement --prod --json',
        'metro proof sandbox-template --workflow product.rate-retirement --shape product-rate-retirement --json',
        'metro apply-gate template --workflow product.rate-retirement --shape product-rate-retirement --prod --json',
      ],
    },
    sourceIds: uniq([
      ...(rateCardAddRates.sourceIds || []),
      ...(rateCardGetRates.sourceIds || []),
      ...(rateCardSchedule.sourceIds || []),
      ...(productsGet.sourceIds || []),
      ...(productsArchive.sourceIds || []),
      'metro-product-retirement-preview-golden',
      'metro-api-read-plan-golden-products-get',
      'metro-api-read-plan-golden-rate-cards-get-rates',
      'metro-api-read-plan-golden-rate-card-schedule',
      'metro-api-read-pipeline-products-get-golden',
      'metro-api-read-pipeline-rate-cards-get-rates-golden',
      'metro-api-read-pipeline-rate-card-schedule-golden',
      'metro-api-read-audit-products-get-fixture',
      'metro-api-read-audit-products-get-golden',
      'metro-api-read-audit-rate-cards-get-rates-fixture',
      'metro-api-read-audit-rate-cards-get-rates-golden',
      'metro-docs-explain-product-rate-retirement-readback-golden',
    ]),
    sources: uniq([
      ...rateCardAddRates.sources,
      ...rateCardGetRates.sources,
      ...rateCardSchedule.sources,
      ...productsGet.sources,
      ...productsArchive.sources,
      'docs/metronome-cli/SHAPE_CATALOG.md#product-or-rate-retirement',
      'docs/metronome-cli/VALIDATION_AND_GUARDRAILS.md#rate-card-rules',
      'metronome-cli/src/docs/explain.js',
      'metronome-cli/src/shapes/index.js',
      'metronome-cli/src/validators/index.js',
      'metronome-cli/test/fixtures/product-rate-retirement-valid.json',
      'metronome-cli/test/golden/product-rate-retirement-preview.sandbox.json',
      'metronome-cli/test/fixtures/api-read-audit-products-get-valid.jsonl',
      'metronome-cli/test/golden/proof/package-archive.package-alias-archive-handoff.sandbox-template.json',
    ]),
  };
}

function operatingDocTopicMatches(bundle) {
  const topicIds = [
    'first-safe-preview',
    'install.troubleshooting',
    'package.publish-readiness',
    'ci.local-checks',
    'setup.troubleshooting',
    'input.normalize',
    'output.anatomy',
    'refusal.troubleshooting',
    'billing-provider.attachment',
    'send-invoice.stripe',
    'contract-transitions.rebuy',
    'customer.setup',
    'credits.product.decision',
    'rate-cards.dimensional',
    'workspace.routing',
    'contract-overrides.inspection',
    'product-rate-retirement.readback',
  ];

  return topicIds
    .map((topic) => (
      inputNormalizeTopic(topic, bundle)
      || firstSafePreviewTopic(topic, bundle)
      || installTroubleshootingTopic(topic, bundle)
      || packagePublishReadinessTopic(topic, bundle)
      || ciLocalChecksTopic(topic, bundle)
      || setupTroubleshootingTopic(topic, bundle)
      || outputAnatomyTopic(topic, bundle)
      || refusalTroubleshootingTopic(topic, bundle)
      || billingProviderAttachmentTopic(topic, bundle)
      || sendInvoiceStripeTopic(topic, bundle)
      || contractTransitionsRebuyTopic(topic, bundle)
      || customerSetupTopic(topic, bundle)
      || creditsProductDecisionTopic(topic)
      || workspaceRoutingTopic(topic, bundle)
      || dimensionalRateCardTopic(topic, bundle)
      || contractOverrideInspectionTopic(topic, bundle)
      || productRateRetirementReadbackTopic(topic, bundle)
    ))
    .filter(Boolean);
}

function summarizeOperatingTopic(match) {
  return {
    id: match.id,
    title: match.title,
    type: match.type,
    status: match.status,
    apiAccess: match.apiAccess,
    summary: match.summary,
    explainCommand: `metro docs explain ${match.id} --json`,
    relatedCommandCount: match.related?.commands?.length || 0,
    sourceIds: clone(match.sourceIds || []),
    sources: clone(match.sources || []),
  };
}

function docsExplainTopicIndex() {
  const bundle = buildApiExportBundle();
  const { apiReference, commandReference, shapeReference, validatorReference, gotchaReference, examples } = bundle.sections;
  const operatingTopics = operatingDocTopicMatches(bundle).map(summarizeOperatingTopic);
  const lookupKinds = [
    {
      kind: 'api-endpoint',
      prefixes: ['api:', 'endpoint:'],
      unprefixedExactMatch: true,
      count: apiReference.endpoints.length,
      exampleTopics: apiReference.endpoints.slice(0, 4).map((endpoint) => endpoint.id),
      description: 'Reviewed Metronome endpoint IDs from the local expert API catalog.',
    },
    {
      kind: 'api-family',
      prefixes: ['family:'],
      unprefixedExactMatch: true,
      count: apiReference.families.length,
      exampleTopics: apiReference.families.slice(0, 4).map((family) => family.family),
      description: 'Endpoint-family summaries derived from the reviewed API catalog.',
    },
    {
      kind: 'command',
      prefixes: ['command:'],
      unprefixedExactMatch: true,
      count: commandReference.commands.length,
      exampleTopics: ['command:input.normalize', 'command:docs.explain', 'command:api.read-plan'],
      description: 'Supported local command metadata from the command catalog.',
    },
    {
      kind: 'shape',
      prefixes: ['shape:'],
      unprefixedExactMatch: true,
      count: shapeReference.shapes.length,
      exampleTopics: shapeReference.shapes.slice(0, 4).map((shape) => `shape:${shape.id}`),
      description: 'Workflow shape summaries and validator links from the shape catalog.',
    },
    {
      kind: 'validator-rule',
      prefixes: ['rule:', 'validator:'],
      unprefixedExactMatch: true,
      count: validatorReference.rules.length,
      exampleTopics: validatorReference.rules.slice(0, 4).map((rule) => rule.id),
      description: 'Validator rules, severities, and remediation guidance.',
    },
    {
      kind: 'gotcha',
      prefixes: ['gotcha:'],
      unprefixedExactMatch: false,
      count: gotchaReference.gotchas.length,
      exampleTopics: gotchaReference.gotchas.slice(0, 4).map((gotcha) => `gotcha:${gotcha.id}`),
      description: 'Known failure modes from the gotcha register.',
    },
    {
      kind: 'permission-scope',
      prefixes: ['scope:', 'policy:'],
      unprefixedExactMatch: true,
      count: apiReference.permissionScopes.scopes.length,
      exampleTopics: apiReference.permissionScopes.scopes.slice(0, 4).map((scope) => scope.scope),
      description: 'Permission scopes and owner/approval policy requirements.',
    },
    {
      kind: 'example-fixture',
      prefixes: ['example:'],
      unprefixedExactMatch: false,
      count: examples.fixtures.length,
      exampleTopics: examples.fixtures.slice(0, 4).map((example) => `example:${example.id}`),
      description: 'Checked command/output fixtures used as local proof examples.',
    },
  ];

  return {
    schemaVersion: DOCS_EXPLAIN_INDEX_SCHEMA_VERSION,
    generatedFrom: [
      'metronome-cli/src/docs/explain.js',
      ...bundle.generatedFrom,
    ],
    apiAccess: 'none',
    liveExecution: clone(bundle.liveExecution),
    summary: {
      operatingTopicCount: operatingTopics.length,
      lookupKindCount: lookupKinds.length,
      genericExplainableCount: lookupKinds.reduce((sum, kind) => sum + kind.count, 0),
      liveApiAccess: 'none',
    },
    sectionNavigation: [
      {
        id: 'explain-summary',
        label: 'Summary',
        description: 'Local-only topic counts, live execution status, and next safe step.',
        href: '#explain-summary',
      },
      {
        id: 'operating-topics',
        label: 'Operating Topics',
        description: 'Curated source-linked operating explanations with stable metro docs explain commands.',
        href: '#operating-topics',
      },
      {
        id: 'lookup-kinds',
        label: 'Lookup Kinds',
        description: 'Typed prefixes and example topics for endpoint, command, shape, rule, gotcha, scope, policy, and fixture lookup.',
        href: '#lookup-kinds',
      },
      {
        id: 'source-boundary',
        label: 'Source Boundary',
        description: 'Files and source IDs that prove the generated index without authorizing live API access.',
        href: '#source-boundary',
      },
    ],
    operatingTopics,
    lookupKinds,
    sourceIds: uniq([
      'metro-docs-explain-topic-index-golden',
      ...operatingTopics.flatMap((topic) => topic.sourceIds || []),
    ]),
    sources: uniq([
      'docs/metronome-cli/one-goal.md',
      'docs/metronome-cli/CLI_ARCHITECTURE.md',
      'metronome-cli/src/docs/explain.js',
      ...operatingTopics.flatMap((topic) => topic.sources || []),
    ]),
    nextSafeStep: 'Run metro docs explain <topic> --json for a single topic, or use explicit prefixes such as command:, shape:, gotcha:, rule:, scope:, policy:, and example: to avoid ambiguous IDs. This index does not authorize live reads or writes.',
  };
}

function explainDocsTopic(rawTopic) {
  const parsed = prefixedTopic(rawTopic);
  if (!parsed.topic || !parsed.value) return null;
  const bundle = buildApiExportBundle();
  const { apiReference, commandReference, shapeReference, validatorReference, gotchaReference, examples } = bundle.sections;
  const topic = parsed.value;
  const kind = parsed.kind;

  const inputNormalization = inputNormalizeTopic(topic, bundle);
  if (inputNormalization && !kind) {
    return baseResult(bundle, parsed, inputNormalization);
  }

  const firstSafePreview = firstSafePreviewTopic(topic, bundle);
  if (firstSafePreview && !kind) {
    return baseResult(bundle, parsed, firstSafePreview);
  }

  const installTroubleshooting = installTroubleshootingTopic(topic, bundle);
  if (installTroubleshooting && !kind) {
    return baseResult(bundle, parsed, installTroubleshooting);
  }

  const packagePublishReadiness = packagePublishReadinessTopic(topic, bundle);
  if (packagePublishReadiness && !kind) {
    return baseResult(bundle, parsed, packagePublishReadiness);
  }

  const ciLocalChecks = ciLocalChecksTopic(topic, bundle);
  if (ciLocalChecks && !kind) {
    return baseResult(bundle, parsed, ciLocalChecks);
  }

  const setupTroubleshooting = setupTroubleshootingTopic(topic, bundle);
  if (setupTroubleshooting && !kind) {
    return baseResult(bundle, parsed, setupTroubleshooting);
  }

  const outputAnatomy = outputAnatomyTopic(topic, bundle);
  if (outputAnatomy && !kind) {
    return baseResult(bundle, parsed, outputAnatomy);
  }

  const refusalTroubleshooting = refusalTroubleshootingTopic(topic, bundle);
  if (refusalTroubleshooting && !kind) {
    return baseResult(bundle, parsed, refusalTroubleshooting);
  }

  const customerSetup = customerSetupTopic(topic, bundle);
  if (customerSetup && !kind) {
    return baseResult(bundle, parsed, customerSetup);
  }

  const billingProviderAttachment = billingProviderAttachmentTopic(topic, bundle);
  if (billingProviderAttachment && !kind) {
    return baseResult(bundle, parsed, billingProviderAttachment);
  }

  const creditsProductDecision = creditsProductDecisionTopic(topic);
  if (creditsProductDecision && !kind) {
    return baseResult(bundle, parsed, creditsProductDecision);
  }

  const workspaceRouting = workspaceRoutingTopic(topic, bundle);
  if (workspaceRouting && !kind) {
    return baseResult(bundle, parsed, workspaceRouting);
  }

  const matchers = [
    ['endpoint', () => apiReference.endpoints.find((endpoint) => endpoint.id === topic), endpointMatch],
    ['api', () => apiReference.endpoints.find((endpoint) => endpoint.id === topic), endpointMatch],
    ['family', () => apiReference.families.find((family) => family.family === topic), familyMatch],
    ['command', () => commandReference.commands.find((command) => command.id === topic), commandMatch],
    ['shape', () => shapeReference.shapes.find((shape) => shape.id === topic), shapeMatch],
    ['rule', () => validatorReference.rules.find((rule) => rule.id === topic), (rule) => ruleMatch(rule, validatorReference)],
    ['validator', () => validatorReference.rules.find((rule) => rule.id === topic), (rule) => ruleMatch(rule, validatorReference)],
    ['gotcha', () => gotchaReference.gotchas.find((gotcha) => gotcha.id === topic), gotchaMatch],
    ['scope', () => apiReference.permissionScopes.scopes.find((scope) => scope.scope === topic), (scope) => scopeMatch(scope, apiReference.approvalPolicies.policies.find((policy) => policy.scope === scope.scope))],
    ['policy', () => apiReference.approvalPolicies.policies.find((policy) => policy.scope === topic), (policy) => {
      const scope = apiReference.permissionScopes.scopes.find((candidate) => candidate.scope === policy.scope);
      return scope ? scopeMatch(scope, policy) : null;
    }],
    ['example', () => examples.fixtures.find((example) => example.id === topic), exampleMatch],
  ];

  for (const [matcherKind, find, build] of matchers) {
    if (kind && kind !== matcherKind) continue;
    const found = find();
    if (found) {
      const match = build(found);
      if (match) return baseResult(bundle, parsed, match);
    }
  }

  const contractOverrideInspection = contractOverrideInspectionTopic(topic, bundle);
  if (contractOverrideInspection && !kind) {
    return baseResult(bundle, parsed, contractOverrideInspection);
  }

  const productRateRetirementReadback = productRateRetirementReadbackTopic(topic, bundle);
  if (productRateRetirementReadback && !kind) {
    return baseResult(bundle, parsed, productRateRetirementReadback);
  }

  const sendInvoiceStripe = sendInvoiceStripeTopic(topic, bundle);
  if (sendInvoiceStripe && !kind) {
    return baseResult(bundle, parsed, sendInvoiceStripe);
  }

  const contractTransitionsRebuy = contractTransitionsRebuyTopic(topic, bundle);
  if (contractTransitionsRebuy && !kind) {
    return baseResult(bundle, parsed, contractTransitionsRebuy);
  }

  const planned = dimensionalRateCardTopic(topic, bundle);
  if (planned && (!kind || kind === 'shape' || kind === 'family')) {
    return baseResult(bundle, parsed, planned);
  }

  return null;
}

module.exports = {
  DOCS_EXPLAIN_INDEX_SCHEMA_VERSION,
  DOCS_EXPLAIN_SCHEMA_VERSION,
  docsExplainTopicIndex,
  explainDocsTopic,
};
