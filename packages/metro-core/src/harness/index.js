'use strict';

const fs = require('fs');
const path = require('path');

const { getApiEndpoint } = require('../api-catalog');
const {
  isLiveApplySandboxEndpoint,
  isLiveReadEndpoint,
  listLiveApplySandboxEndpointIds,
  listLiveReadEndpointIds,
} = require('../clients/live-endpoints');
const { listIntents } = require('../workspace/model');
const { buildPlanInputTemplate } = require('../workspace/plan');
const {
  fixturePathForEndpoint,
  resolveHarnessFixtureRoot,
  standardShapeFixtures,
} = require('./fixtures');
const { getQuickstartPackConfig, resolveQuickstartPackId } = require('../setup/quickstart-config');

const HARNESS_SCHEMA_VERSION = 'metro.harness.v1';
const HARNESS_LIST_SCHEMA_VERSION = 'metro.harness.list.v1';

const LOCAL_ONLY = Object.freeze({
  enabledInCurrentCli: false,
  reason: 'Harness plans and local execution prove CLI behavior only; live Metronome access still requires current-turn authorization and evidence gates.',
  nextSafeStep: 'Use metro harness run --suite onboard --execute --json after install, or --suite local when test fixtures are available.',
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

// Report fixtureRoot relative to the CLI checkout so harness payloads (and
// their goldens) are identical on any machine; external roots stay absolute.
function portableFixtureRoot(fixtureRoot) {
  if (!fixtureRoot) return fixtureRoot;
  const cliRoot = path.resolve(__dirname, '..', '..', '..', '..');
  const relative = path.relative(cliRoot, fixtureRoot);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    return fixtureRoot;
  }
  return relative;
}

function step(definition) {
  return {
    status: 'planned',
    required: definition.required !== false,
    fixtureRequired: definition.fixtureRequired === true,
    skipReason: null,
    skipExecution: false,
    expectedExitCode: definition.expectedExitCode ?? 0,
    ...definition,
  };
}

function markSkippedSteps(steps, fixtureRoot) {
  return steps.map((entry) => {
    if (!entry.fixtureRequired || entry.skipExecution) return entry;
    if (fixtureRoot) return entry;
    return {
      ...entry,
      status: 'skipped-fixture-missing',
      skipExecution: true,
      skipReason: 'Set METRO_HARNESS_FIXTURE_ROOT (or --fixture-root) to a directory of shape and API fixtures.',
    };
  });
}

function summarizeSteps(steps) {
  const requiredSteps = steps.filter((entry) => entry.required !== false);
  const fixtureSteps = steps.filter((entry) => entry.fixtureRequired);
  const skippedSteps = steps.filter((entry) => entry.status === 'skipped-fixture-missing');
  return {
    stepCount: steps.length,
    requiredStepCount: requiredSteps.length,
    fixtureStepCount: fixtureSteps.length,
    skippedFixtureSteps: skippedSteps.length,
    executableStepCount: steps.length - skippedSteps.length,
  };
}

const HARNESS_SUITES = Object.freeze([
  {
    id: 'onboard',
    title: 'New teammate / agent onboarding',
    description: 'Schema discovery, workspace orientation, status dashboard, profile template, and release readiness - no fixtures or API keys.',
    apiAccess: 'none',
    fixtureRequired: false,
    executeSupported: true,
    estimatedMinutes: 1,
  },
  {
    id: 'local',
    title: 'Local shape and preview proof',
    description: 'Onboarding steps plus pro-annual validate/preview and API readiness summary. Requires a fixture directory (--fixture-root or METRO_HARNESS_FIXTURE_ROOT).',
    apiAccess: 'none',
    fixtureRequired: true,
    executeSupported: true,
    estimatedMinutes: 2,
  },
  {
    id: 'workspace',
    title: 'Workspace intent plans',
    description: 'Build a sandbox plan for every workspace intent to prove routing, input templates, and command ladders stay valid.',
    apiAccess: 'none',
    fixtureRequired: false,
    executeSupported: true,
    estimatedMinutes: 1,
  },
  {
    id: 'live-allowlist',
    title: 'Live endpoint allowlist audit',
    description: 'Summarize enabled live reads and sandbox writes and cross-check catalog entries without calling Metronome.',
    apiAccess: 'none',
    fixtureRequired: false,
    executeSupported: true,
    estimatedMinutes: 1,
  },
  {
    id: 'api-literacy',
    title: 'API catalog and read-plan literacy',
    description: 'Docs topics, output anatomy, catalog readiness, endpoint explain, validate + read-plan - no API keys.',
    apiAccess: 'none',
    fixtureRequired: true,
    executeSupported: true,
    estimatedMinutes: 1,
  },
  {
    id: 'agent-literacy',
    title: 'Agent markdown + decision-tree literacy',
    description: 'Schema, markdown docs refs, credits.product.decision topic, and route for ambiguous catalog asks - no fixtures or API keys.',
    apiAccess: 'none',
    fixtureRequired: false,
    executeSupported: true,
    estimatedMinutes: 1,
  },
  {
    id: 'policy',
    title: 'Safety refusal exit-code contract',
    description: 'Live verbs, missing tenant, and blocked applies refuse with exit 2 (safety refusal, not validation failure).',
    apiAccess: 'none',
    fixtureRequired: true,
    executeSupported: true,
    estimatedMinutes: 1,
  },
  {
    id: 'pack-ops',
    title: 'Workspace pack native ops (offline)',
    description: 'For packs that export ops: package plan move dry-run apply, route scoring, and production apply refusal without API keys.',
    apiAccess: 'none',
    fixtureRequired: true,
    executeSupported: true,
    estimatedMinutes: 1,
  },
]);

function listHarnessSuites() {
  return {
    schemaVersion: HARNESS_LIST_SCHEMA_VERSION,
    generatedFrom: 'packages/metro-core/src/harness/index.js',
    apiAccess: 'none',
    localOnly: true,
    liveExecution: clone(LOCAL_ONLY),
    suites: HARNESS_SUITES.map((suite) => ({ ...suite })),
    nextCommands: [
      'metro harness run --suite onboard --execute --json',
      'metro harness run --suite agent-literacy --execute --json',
      'metro harness run --suite api-literacy --fixture-root <fixture-dir> --execute --json',
      'metro harness run --suite policy --fixture-root <fixture-dir> --execute --json',
      'metro harness run --suite pack-ops --fixture-root <fixture-dir> --execute --json',
      'metro harness intent annual-self-serve-package --sandbox --json',
    ],
    nextSafeStep: 'Run metro harness run --suite onboard --execute --json after install.',
  };
}

function buildOnboardSteps() {
  const pack = getQuickstartPackConfig(resolveQuickstartPackId());
  return [
    step({
      id: 'schema-discovery',
      order: 1,
      command: 'metro schema --json',
      proves: 'Command catalog and schema versions are discoverable before workflow commands run.',
    }),
    step({
      id: 'workspace-explain',
      order: 2,
      command: 'metro workspace explain --json',
      proves: `Operators and agents can inspect ${pack.workspaceOrientationNote} before choosing a billing goal.`,
    }),
    step({
      id: 'plan-list',
      order: 3,
      command: 'metro plan list --json',
      proves: 'Billing intents map to recommended shapes and verification reads.',
    }),
    step({
      id: 'status-dashboard',
      order: 4,
      command: 'metro status --json',
      proves: 'Workspace, allowlist, and readiness summary compose into one dashboard.',
    }),
    step({
      id: 'setup-template',
      order: 5,
      command: 'metro setup template --json',
      proves: 'Profile template stores tenant names and key env var names only.',
    }),
    step({
      id: 'release-readiness',
      order: 6,
      command: 'metro release readiness --json',
      proves: 'Release contract, blockers, and disabled live/npm access are documented locally.',
    }),
  ];
}

function buildLocalSteps(fixtureRoot) {
  const fixtures = fixtureRoot ? standardShapeFixtures(fixtureRoot) : null;
  const proAnnual = fixtures && fs.existsSync(fixtures.proAnnual) ? fixtures.proAnnual : null;

  const steps = [
    ...buildOnboardSteps(),
    step({
      id: 'validate-pro-annual',
      order: 7,
      command: proAnnual
        ? `metro validate --shape pro-annual --file ${proAnnual} --json`
        : 'metro validate --shape pro-annual --file <missing-fixture> --json',
      proves: 'Checked-in pro-annual fixture passes local schema and guardrail validation.',
      fixtureRequired: true,
      skipExecution: !proAnnual,
      status: proAnnual ? 'planned' : 'skipped-fixture-missing',
      skipReason: proAnnual ? null : 'Requires <pro-annual-valid.json> from a source checkout or METRO_HARNESS_FIXTURE_ROOT.',
    }),
    step({
      id: 'preview-pro-annual',
      order: 8,
      command: proAnnual
        ? `metro package preview --shape pro-annual --file ${proAnnual} --sandbox --json`
        : 'metro package preview --shape pro-annual --file <missing-fixture> --sandbox --json',
      proves: 'Package workflow emits a sandbox-labeled preview with stable payload hash.',
      fixtureRequired: true,
      skipExecution: !proAnnual,
      status: proAnnual ? 'planned' : 'skipped-fixture-missing',
      skipReason: proAnnual ? null : 'Requires <pro-annual-valid.json> from a source checkout or METRO_HARNESS_FIXTURE_ROOT.',
    }),
    step({
      id: 'api-readiness-summary',
      order: 9,
      command: 'metro api readiness --summary --json',
      proves: 'Read/write endpoint evidence coverage and allowlist counts are summarized.',
    }),
    step({
      id: 'harness-self-check',
      order: 10,
      command: 'metro harness list --json',
      proves: 'Harness registry remains introspectable for agents and CI wrappers.',
    }),
  ];

  return steps;
}

function buildWorkspaceSteps(options = {}) {
  const tenantFlag = options.tenant === 'production' ? '--prod' : '--sandbox';
  return listIntents().map((intent, index) => step({
    id: `plan-${intent.id}`,
    order: index + 1,
    command: `metro plan ${intent.id} ${tenantFlag} --json`,
    proves: `Workspace intent "${intent.id}" produces a valid plan with commands and inputTemplate coverage.`,
  }));
}

function buildLiveAllowlistSteps() {
  const readIds = listLiveReadEndpointIds();
  const writeIds = listLiveApplySandboxEndpointIds();
  return [
    step({
      id: 'status-allowlist',
      order: 1,
      command: 'metro status --json',
      proves: 'Live read and sandbox apply allowlists are exposed on the status dashboard.',
    }),
    step({
      id: 'setup-auth-allowlist',
      order: 2,
      command: 'metro setup template --json',
      proves: 'Profile template remains available for auth follow-on (use setup auth with --file when profiles exist).',
      required: false,
    }),
    ...readIds.map((endpointId, index) => step({
      id: `read-catalog-${endpointId}`,
      order: 10 + index,
      command: `metro api explain ${endpointId} --json`,
      proves: `Live read endpoint ${endpointId} has a reviewed catalog contract.`,
      required: false,
    })),
    ...writeIds.map((endpointId, index) => step({
      id: `apply-catalog-${endpointId}`,
      order: 100 + index,
      command: `metro api explain ${endpointId} --json`,
      proves: `Sandbox apply endpoint ${endpointId} has a reviewed catalog contract and write proof ladder.`,
      required: false,
    })),
  ];
}

function refusalStep(definition) {
  return step({ ...definition, expectedExitCode: 2 });
}

function buildAgentLiteracySteps() {
  return [
    step({
      id: 'schema-json',
      order: 1,
      command: 'metro schema --json',
      proves: 'Agents discover command contracts and exit codes from schema stdout.',
    }),
    step({
      id: 'docs-explain-list-markdown',
      order: 2,
      command: 'metro docs explain --list --markdown',
      proves: 'Operating topics (decision trees) are available as Markdown for agent context.',
    }),
    step({
      id: 'docs-command-reference-markdown',
      order: 3,
      command: 'metro docs command-reference --markdown',
      proves: 'Full command catalog can be loaded as Markdown without HTML scraping.',
    }),
    step({
      id: 'credits-product-decision',
      order: 4,
      command: 'metro docs explain credits.product.decision --markdown',
      proves: 'Ambiguous credits/product asks have an explicit interview fork before writes.',
    }),
    step({
      id: 'route-credits-product',
      order: 5,
      command: 'metro route --goal "add a credits product" --sandbox --json',
      proves: 'Workspace routing points vague credits-product language at the decision intent.',
    }),
    step({
      id: 'tenant-snapshot-show',
      order: 6,
      command: 'metro tenant snapshot show --markdown',
      proves: 'Tenant snapshot command is wired; missing snapshot exits non-zero with bind next step (offline).',
      expectedExitCode: 1,
      required: false,
    }),
    step({
      id: 'greenfield-plan',
      order: 7,
      command: 'metro plan greenfield-credits-product --sandbox --json',
      proves: 'Greenfield intent emits local BM+product request templates without authorizing live apply.',
    }),
    step({
      id: 'promote-codebase-on-route',
      order: 8,
      command: 'metro route --goal "add a credits product" --sandbox --json',
      proves: 'Route JSON includes promoteCodebase when snapshot is missing so agents offer a PR instead of thrashing.',
    }),
    step({
      id: 'output-anatomy-markdown',
      order: 9,
      command: 'metro docs explain output.anatomy --markdown',
      proves: 'Stdout vs stderr and schemaVersion rules are loadable as Markdown.',
    }),
  ];
}

function buildApiLiteracySteps(fixtureRoot) {
  const contractsGet = fixtureRoot
    ? path.join(fixtureRoot, 'api-contracts-get-valid.json')
    : null;
  const steps = [
    step({
      id: 'docs-explain-list',
      order: 1,
      command: 'metro docs explain --list --json',
      proves: 'Operating doc topics are discoverable before workflow commands run.',
    }),
    step({
      id: 'docs-output-anatomy',
      order: 2,
      command: 'metro docs explain output.anatomy --json',
      proves: 'Agents can learn stdout vs stderr and exit-code semantics locally.',
    }),
    step({
      id: 'docs-refusal-troubleshooting',
      order: 3,
      command: 'metro docs explain refusal.troubleshooting --json',
      proves: 'Safety refusals (exit 2) are documented separately from validation failures.',
    }),
    step({
      id: 'api-scopes',
      order: 4,
      command: 'metro api scopes --json',
      proves: 'Permission scopes are listed for catalog review without live API access.',
    }),
    step({
      id: 'api-readiness-summary',
      order: 5,
      command: 'metro api readiness --summary --json',
      proves: 'Read/write endpoint evidence coverage is summarized from the local catalog.',
    }),
    step({
      id: 'api-explain-contracts-get',
      order: 6,
      command: 'metro api explain contracts.get.v2 --json',
      proves: 'A canonical read endpoint exposes contracts, sources, and proof ladder metadata.',
    }),
    step({
      id: 'api-validate-contracts-get',
      order: 7,
      command: contractsGet
        ? `metro api validate contracts.get.v2 --file ${contractsGet} --json`
        : 'metro api validate contracts.get.v2 --file <missing-fixture> --json',
      proves: 'Reviewed request JSON passes local API validation before read-plan.',
      fixtureRequired: true,
      skipExecution: !contractsGet,
      status: contractsGet ? 'planned' : 'skipped-fixture-missing',
      skipReason: contractsGet ? null : 'Requires <api-contracts-get-valid.json>.',
    }),
    step({
      id: 'api-read-plan-contracts-get',
      order: 8,
      command: contractsGet
        ? `metro api read-plan contracts.get.v2 --file ${contractsGet} --sandbox --json`
        : 'metro api read-plan contracts.get.v2 --file <missing-fixture> --sandbox --json',
      proves: 'Read-plan binds validated request to tenant, hashes, and read-gate prerequisites.',
      fixtureRequired: true,
      skipExecution: !contractsGet,
      status: contractsGet ? 'planned' : 'skipped-fixture-missing',
      skipReason: contractsGet ? null : 'Requires <api-contracts-get-valid.json>.',
    }),
    step({
      id: 'harness-read-self-check',
      order: 9,
      command: contractsGet
        ? `metro harness read contracts.get.v2 --file ${contractsGet} --sandbox --json`
        : 'metro harness read contracts.get.v2 --file <missing-fixture> --sandbox --json',
      proves: 'Read sub-harness composes validate, read-plan, and read-gate steps for one endpoint.',
      fixtureRequired: true,
      skipExecution: !contractsGet,
      status: contractsGet ? 'planned' : 'skipped-fixture-missing',
      skipReason: contractsGet ? null : 'Requires <api-contracts-get-valid.json>.',
    }),
  ];
  return markSkippedSteps(steps, fixtureRoot);
}

function buildPolicySteps(fixtureRoot) {
  const proAnnual = fixtureRoot ? path.join(fixtureRoot, 'pro-annual-valid.json') : null;
  const customerSetup = fixtureRoot ? path.join(fixtureRoot, 'customer-setup-valid.json') : null;
  const contractsCreate = fixtureRoot ? path.join(fixtureRoot, 'api-contracts-create-valid.json') : null;
  const contractsGet = fixtureRoot ? path.join(fixtureRoot, 'api-contracts-get-valid.json') : null;
  const confirmHash = 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

  const steps = [
    refusalStep({
      id: 'policy-api-read-bare',
      order: 1,
      command: 'metro api read contracts.get.v2 --sandbox --json',
      proves: 'Live read refuses without request file, read-gate, and current-turn confirmation.',
    }),
    refusalStep({
      id: 'policy-api-apply-prod',
      order: 2,
      command: contractsCreate
        ? `metro api apply contracts.create --file ${contractsCreate} --prod --json`
        : 'metro api apply contracts.create --file <missing-fixture> --prod --json',
      proves: 'Production API apply is refused in the current CLI release.',
      fixtureRequired: true,
      skipExecution: !contractsCreate,
      status: contractsCreate ? 'planned' : 'skipped-fixture-missing',
    }),
    refusalStep({
      id: 'policy-package-preview-no-tenant',
      order: 3,
      command: proAnnual
        ? `metro package preview --shape pro-annual --file ${proAnnual} --json`
        : 'metro package preview --shape pro-annual --file <missing-fixture> --json',
      proves: 'Package preview refuses when --sandbox|--prod is omitted.',
      fixtureRequired: true,
      skipExecution: !proAnnual,
      status: proAnnual ? 'planned' : 'skipped-fixture-missing',
    }),
    refusalStep({
      id: 'policy-customer-setup-apply',
      order: 4,
      command: customerSetup
        ? `metro customer setup apply --file ${customerSetup} --sandbox --confirm-hash ${confirmHash} --json`
        : 'metro customer setup apply --file <missing-fixture> --sandbox --json',
      proves: 'Workflow apply runners refuse until preview, proof, and approval evidence exist.',
      fixtureRequired: true,
      skipExecution: !customerSetup,
      status: customerSetup ? 'planned' : 'skipped-fixture-missing',
    }),
    refusalStep({
      id: 'policy-package-apply-prod',
      order: 5,
      command: 'metro package apply --shape pro-annual --prod --json',
      proves: 'Package apply refuses on production tenant.',
    }),
    refusalStep({
      id: 'policy-route-products-create',
      order: 6,
      command: 'metro route --goal "add new pricing dimension FEATURE_X" --api products.create --sandbox --json',
      proves: 'Workspace routing refuses suboptimal API paths for dimensional goals.',
    }),
    refusalStep({
      id: 'policy-api-read-plan-no-tenant',
      order: 7,
      command: contractsGet
        ? `metro api read-plan contracts.get.v2 --file ${contractsGet} --json`
        : 'metro api read-plan contracts.get.v2 --file <missing-fixture> --json',
      proves: 'API read-plan refuses without explicit tenant flags.',
      fixtureRequired: true,
      skipExecution: !contractsGet,
      status: contractsGet ? 'planned' : 'skipped-fixture-missing',
    }),
  ];
  return markSkippedSteps(steps, fixtureRoot);
}

function buildPackOpsSteps(fixtureRoot) {
  const movePlan = fixtureRoot ? path.join(fixtureRoot, 'contract-move-plan-valid.json') : null;
  const confirmHash = 'sha256:95c1f5fc6f73824d3bc1095b23a317a3a3ea7f4fad682445029b2dc03bfec3f6';

  const steps = [
    step({
      id: 'pack-ops-route-downgrade',
      order: 1,
      command: 'metro route --goal "downgrade customer from Pro to Core at end of term" --prod --json',
      proves: 'Natural-language downgrade goals route to package-plan-move intent.',
      expectedExitCode: 0,
    }),
    step({
      id: 'pack-ops-move-plan-apply-dry-run',
      order: 2,
      command: movePlan
        ? `metro contract move-plan apply --file ${movePlan} --prod --confirm-hash ${confirmHash} --json`
        : 'metro contract move-plan apply --file <missing-fixture> --prod --json',
      proves: 'Contract move-plan apply dry-runs locally with reviewed confirm-hash (no Metronome writes).',
      fixtureRequired: true,
      skipExecution: !movePlan,
      status: movePlan ? 'planned' : 'skipped-fixture-missing',
      expectedExitCode: 0,
    }),
    step({
      id: 'pack-ops-move-plan-apply-prod-refusal',
      order: 3,
      command: movePlan
        ? `metro contract move-plan apply --file ${movePlan} --prod --confirm-hash ${confirmHash} --apply --json`
        : 'metro contract move-plan apply --file <missing-fixture> --prod --apply --json',
      proves: 'Production move-plan apply refuses without ALLOW_DANGEROUS_SCRIPT or --confirm-prod-apply.',
      fixtureRequired: true,
      skipExecution: !movePlan,
      status: movePlan ? 'planned' : 'skipped-fixture-missing',
      expectedExitCode: 1,
    }),
    step({
      id: 'pack-ops-move-plan-pack-missing',
      order: 4,
      command: movePlan
        ? `METRO_WORKSPACE_PACK=stub metro contract move-plan preflight --to=core --customer-id=test --prod --json`
        : 'metro contract move-plan preflight --to=core --prod --json',
      proves: 'Contract move-plan preflight refuses when workspace pack is not loaded.',
      fixtureRequired: false,
      expectedExitCode: 2,
    }),
  ];
  return markSkippedSteps(steps, fixtureRoot);
}

function buildHarnessPlan(suiteId, options = {}) {
  const suite = HARNESS_SUITES.find((entry) => entry.id === suiteId);
  if (!suite) {
    return {
      schemaVersion: HARNESS_SCHEMA_VERSION,
      valid: false,
      apiAccess: 'none',
      error: 'unknown-suite',
      suite: suiteId,
      availableSuites: HARNESS_SUITES.map((entry) => entry.id),
      nextSafeStep: 'Run metro harness list --json',
    };
  }

  const fixtureRoot = resolveHarnessFixtureRoot(options);
  let steps;
  if (suiteId === 'onboard') {
    steps = buildOnboardSteps();
  } else if (suiteId === 'local') {
    steps = buildLocalSteps(fixtureRoot);
  } else if (suiteId === 'workspace') {
    steps = buildWorkspaceSteps({ tenant: options.tenant || 'sandbox' });
  } else if (suiteId === 'live-allowlist') {
    steps = buildLiveAllowlistSteps();
  } else if (suiteId === 'api-literacy') {
    steps = buildApiLiteracySteps(fixtureRoot);
  } else if (suiteId === 'agent-literacy') {
    steps = buildAgentLiteracySteps();
  } else if (suiteId === 'policy') {
    steps = buildPolicySteps(fixtureRoot);
  } else if (suiteId === 'pack-ops') {
    steps = buildPackOpsSteps(fixtureRoot);
  } else {
    steps = [];
  }

  const summary = summarizeSteps(steps);
  return {
    schemaVersion: HARNESS_SCHEMA_VERSION,
    valid: true,
    apiAccess: 'none',
    localOnly: true,
    liveExecution: clone(LOCAL_ONLY),
    suite: suite.id,
    suiteTitle: suite.title,
    suiteDescription: suite.description,
    fixtureRoot: portableFixtureRoot(fixtureRoot),
    fixtureRequired: suite.fixtureRequired,
    executeSupported: suite.executeSupported,
    tenant: options.tenant || null,
    steps,
    summary,
    nextCommands: [
      `metro harness run --suite ${suite.id} --execute --json`,
      'metro status --json',
    ],
    nextSafeStep: summary.skippedFixtureSteps > 0
      ? 'Export METRO_HARNESS_FIXTURE_ROOT (or pass --fixture-root) to a fixture directory before --suite local --execute.'
      : `Run metro harness run --suite ${suite.id} --execute --json to execute all planned steps locally.`,
  };
}

function eachValidateCommand(template, validateFile) {
  return template.validateCommand.replace('<input.json>', validateFile);
}

function buildIntentHarnessPlan(intentId, options = {}) {
  const tenant = options.tenant === 'production' ? 'production' : 'sandbox';
  const tenantFlag = tenant === 'production' ? '--prod' : '--sandbox';
  const template = buildPlanInputTemplate(intentId, { tenant, ...options });

  if (!template.valid) {
    return {
      schemaVersion: HARNESS_SCHEMA_VERSION,
      valid: false,
      apiAccess: 'none',
      harness: 'intent',
      intentId,
      tenant,
      error: template.error || 'intent-template-invalid',
      message: template.message,
      availableIntents: template.availableIntents || listIntents().map((entry) => entry.id),
      nextSafeStep: 'Run metro plan list --json',
    };
  }

  const fixtureRoot = resolveHarnessFixtureRoot(options);
  const outDir = options.outDir ? path.resolve(String(options.outDir)) : null;
  const outFile = outDir ? path.join(outDir, `${intentId}-input.json`) : null;
  const steps = [
    step({
      id: 'plan-intent',
      order: 1,
      command: `metro plan ${intentId} ${tenantFlag} --json`,
      proves: 'Workspace plan binds intent to recommended shape, commands, and verification reads.',
    }),
    step({
      id: 'template-intent',
      order: 2,
      command: outFile
        ? `metro plan template ${intentId} ${tenantFlag} --out ${outFile} --json`
        : `metro plan template ${intentId} ${tenantFlag} --json`,
      proves: 'Focused inputTemplate is emitted for validate/preview follow-on.',
      fixtureRequired: Boolean(outFile),
    }),
  ];

  if (template.validateCommand && template.recommendedShape) {
    const validateFile = outFile || '<input.json>';
    steps.push(step({
      id: 'validate-shape',
      order: 3,
      command: eachValidateCommand(template, validateFile),
      proves: `Recommended shape ${template.recommendedShape} validation passes on the inputTemplate.`,
      fixtureRequired: Boolean(outFile),
    }));
  }

  if (template.previewCommand) {
    steps.push(step({
      id: 'preview-shape',
      order: 4,
      command: template.previewCommand.replace('<input.json>', outFile || '<input.json>'),
      proves: 'Shape preview emits a tenant-labeled local payload plan.',
      fixtureRequired: Boolean(outFile),
      required: false,
    }));
  }

  const resolvedSteps = markSkippedSteps(steps, outFile ? fixtureRoot || outDir : fixtureRoot);

  return {
    schemaVersion: HARNESS_SCHEMA_VERSION,
    valid: true,
    apiAccess: 'none',
    localOnly: true,
    liveExecution: clone(LOCAL_ONLY),
    harness: 'intent',
    intentId: template.intentId,
    tenant,
    recommendedShape: template.recommendedShape,
    catalogMode: template.catalogMode,
    inputTemplate: template.inputTemplate,
    writtenTo: outFile,
    steps: resolvedSteps,
    summary: summarizeSteps(resolvedSteps),
    nextSafeStep: outFile
      ? `Run metro harness intent ${intentId} ${tenantFlag} --out ${path.dirname(outFile)} --execute --json`
      : `Run metro harness intent ${intentId} ${tenantFlag} --execute --json`,
  };
}

function buildReadHarnessPlan(endpointId, options = {}) {
  const endpoint = getApiEndpoint(endpointId);
  if (!endpoint || endpoint.operationType !== 'read') {
    return {
      schemaVersion: HARNESS_SCHEMA_VERSION,
      valid: false,
      apiAccess: 'none',
      harness: 'read',
      endpointId,
      error: 'not-read-endpoint',
      nextSafeStep: 'Run metro api readiness --summary --json for reviewed read endpoints.',
    };
  }

  const tenant = options.tenant === 'production' ? 'production' : 'sandbox';
  const tenantFlag = tenant === 'production' ? '--prod' : '--sandbox';
  const fixtureRoot = resolveHarnessFixtureRoot(options);
  const requestFile = options.requestFile
    ? path.resolve(String(options.requestFile))
    : (fixtureRoot ? fixturePathForEndpoint(endpointId, fixtureRoot) : null);

  const steps = [
    step({
      id: 'validate-request',
      order: 1,
      command: requestFile
        ? `metro api validate ${endpointId} --file ${requestFile} --json`
        : `metro api validate ${endpointId} --file <request.json> --json`,
      proves: 'Request shape is locally valid and secret-free.',
      fixtureRequired: !options.requestFile,
    }),
    step({
      id: 'read-plan',
      order: 2,
      command: requestFile
        ? `metro api read-plan ${endpointId} --file ${requestFile} ${tenantFlag} --json`
        : `metro api read-plan ${endpointId} --file <request.json> ${tenantFlag} --json`,
      proves: 'Local read plan binds method, path, request hash, and live-read support flag.',
      fixtureRequired: !options.requestFile,
    }),
    step({
      id: 'read-mock',
      order: 3,
      command: requestFile
        ? `metro api read-mock ${endpointId} --file ${requestFile} --read-gate <read-gate.json> --mock-response <mock.json> --actor harness-local --json`
        : `metro api read-mock ${endpointId} --file <request.json> --read-gate <read-gate.json> --mock-response <mock.json> --actor harness-local --json`,
      proves: 'Mocked read runner produces read-result and audit template contracts.',
      fixtureRequired: true,
      required: false,
      skipExecution: true,
      status: 'manual-fixture-chain',
      skipReason: 'Requires read-gate and mock-response fixtures; use maintainer checkout golden fixtures.',
    }),
  ];

  const resolvedSteps = options.requestFile
    ? steps.filter((entry) => entry.id !== 'read-mock').map((entry) => ({ ...entry, fixtureRequired: false }))
    : markSkippedSteps(steps, fixtureRoot);

  return {
    schemaVersion: HARNESS_SCHEMA_VERSION,
    valid: true,
    apiAccess: 'none',
    localOnly: true,
    liveExecution: clone(LOCAL_ONLY),
    harness: 'read',
    endpointId,
    tenant,
    liveReadSupported: isLiveReadEndpoint(endpointId),
    requestFile,
    steps: resolvedSteps,
    summary: summarizeSteps(resolvedSteps),
    nextSafeStep: isLiveReadEndpoint(endpointId)
      ? 'Complete read-gate evidence, then use metro api read with current-turn confirmation for live sandbox reads.'
      : 'This endpoint is local-evidence only until added to the live read allowlist.',
  };
}

function buildApplyHarnessPlan(endpointId, options = {}) {
  const endpoint = getApiEndpoint(endpointId);
  if (!endpoint || endpoint.operationType === 'read') {
    return {
      schemaVersion: HARNESS_SCHEMA_VERSION,
      valid: false,
      apiAccess: 'none',
      harness: 'apply',
      endpointId,
      error: 'not-write-endpoint',
      nextSafeStep: 'Run metro api readiness --summary --json for reviewed write endpoints.',
    };
  }

  const tenant = 'sandbox';
  const fixtureRoot = resolveHarnessFixtureRoot(options);
  const requestFile = options.requestFile
    ? path.resolve(String(options.requestFile))
    : (fixtureRoot ? fixturePathForEndpoint(endpointId, fixtureRoot) : null);

  const steps = [
    step({
      id: 'validate-request',
      order: 1,
      command: requestFile
        ? `metro api validate ${endpointId} --file ${requestFile} --json`
        : `metro api validate ${endpointId} --file <request.json> --json`,
      proves: 'Write request is locally valid before preview or apply evidence.',
      fixtureRequired: !options.requestFile,
    }),
    step({
      id: 'api-preview',
      order: 2,
      command: requestFile
        ? `metro api preview ${endpointId} --file ${requestFile} --sandbox --json`
        : `metro api preview ${endpointId} --file <request.json> --sandbox --json`,
      proves: 'Local preview binds request hash, side effects, and permission scope.',
      fixtureRequired: !options.requestFile,
    }),
    step({
      id: 'preflight-template',
      order: 3,
      command: 'metro api preflight template --preview <api-preview.json> --json',
      proves: 'Preflight template captures tenant binding, idempotency, and read-back plan.',
      skipExecution: true,
      required: false,
      status: 'manual-evidence-chain',
      skipReason: 'Run after saving preview output to a file.',
    }),
    step({
      id: 'apply-gate-template',
      order: 4,
      command: 'metro api apply-gate template --preview <api-preview.json> --preflight <api-preflight.json> --json',
      proves: 'Apply gate hash-binds preview, preflight, and sandbox proof evidence.',
      skipExecution: true,
      required: false,
      status: 'manual-evidence-chain',
      skipReason: 'Run after validated preflight evidence exists.',
    }),
  ];

  const resolvedSteps = markSkippedSteps(
    options.requestFile ? steps.slice(0, 2).map((entry) => ({ ...entry, fixtureRequired: false })) : steps.slice(0, 2),
    fixtureRoot,
  );

  return {
    schemaVersion: HARNESS_SCHEMA_VERSION,
    valid: true,
    apiAccess: 'none',
    localOnly: true,
    liveExecution: clone(LOCAL_ONLY),
    harness: 'apply',
    endpointId,
    tenant,
    liveWriteSupported: isLiveApplySandboxEndpoint(endpointId),
    requestFile,
    steps: resolvedSteps,
    summary: summarizeSteps(resolvedSteps),
    nextSafeStep: isLiveApplySandboxEndpoint(endpointId)
      ? 'Complete apply-gate and approval-record evidence before metro api apply with current-turn confirmation.'
      : 'This write endpoint is local-evidence only until added to the sandbox apply allowlist.',
  };
}

module.exports = {
  HARNESS_SCHEMA_VERSION,
  HARNESS_LIST_SCHEMA_VERSION,
  HARNESS_SUITES,
  listHarnessSuites,
  buildHarnessPlan,
  buildIntentHarnessPlan,
  buildReadHarnessPlan,
  buildApplyHarnessPlan,
};
