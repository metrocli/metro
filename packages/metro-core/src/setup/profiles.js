'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { validateWorkspaceCatalogShape, SANDBOX_REFERENCE_CATALOG } = require('../workspace/catalog-bindings');
const {
  resolveQuickstartPackId,
  getQuickstartPackConfig,
} = require('./quickstart-config');
const {
  listLiveApplySandboxEndpointIds,
  listLiveReadEndpointIds,
} = require('../clients/live-endpoints');
const { writeStickyWorkspacePack } = require('../workspace/loader');

const VALID_TENANTS = new Set(['sandbox', 'production']);
const PROFILE_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{1,63}$/;
const ENV_NAME_PATTERN = /^[A-Z][A-Z0-9_]*$/;
const KEY_FINGERPRINT_PATTERN = /^(fp_[A-Za-z0-9][A-Za-z0-9._:-]{5,127}|sha256:[a-f0-9]{64})$/;
const PLACEHOLDER_PATTERN = /^(<.*>|todo|tbd|replace[-_ ]?me|example)$/i;
const SECRET_KEY_PATTERN = /(secret|token|api[_-]?key|authorization|bearer|password|private[_-]?key)/i;
const SECRET_VALUE_PATTERN = /(sk_live_|sk_test_|pk_live_|prod_[A-Za-z0-9]{12,}|Bearer\s+[A-Za-z0-9._-]+)/;
const PROFILE_RESOLUTION_SCHEMA_VERSION = 'metro.profile.resolve.v1';
const LOCAL_ONLY_LIVE_EXECUTION = Object.freeze({
  enabledInCurrentCli: false,
  reason: 'Tenant profile resolution is local-only; the current CLI does not load API clients or read secret values.',
  nextSafeStep: 'Use the resolved tenant profile as local evidence for read-gate or preflight manifests; live API access still requires current-turn authorization.',
});
const QUICKSTART_DIR_VAR = '$METRO_QUICKSTART_DIR';

function buildFirstSafePreviewCommands(packId = 'generic') {
  const pack = getQuickstartPackConfig(packId);
  const profileName = pack.profiles.defaultProfile;
  const profileConfig = {
    schemaVersion: pack.profiles.schemaVersion,
    profiles: pack.profiles.profiles,
  };
  const annual = pack.annual;
  return [
    {
      id: 'prepare-temp-directory',
      command: 'METRO_QUICKSTART_DIR="${TMPDIR:-/tmp}/metro-quickstart"\nmkdir -p "$METRO_QUICKSTART_DIR"',
      proves: 'Creates a local temp directory for sample quickstart files without touching repo source files.',
      apiAccess: 'none',
    },
    {
      id: 'write-sample-profile',
      command: `cat > "${QUICKSTART_DIR_VAR}/profiles.json" <<'JSON'\n${JSON.stringify(profileConfig, null, 2)}\nJSON`,
      proves: 'Writes a sample profile file that stores tenant names and key environment variable names only.',
      apiAccess: 'none',
    },
    {
      id: 'write-sample-preview-input',
      command: `cat > "${QUICKSTART_DIR_VAR}/${annual.filename}" <<'JSON'\n${JSON.stringify(annual.input, null, 2)}\nJSON`,
      proves: `Writes a deterministic local ${annual.shape} preview input with future-dated sandbox-safe sample values.`,
      apiAccess: 'none',
    },
    {
      id: 'command-schema-discovery',
      command: 'metro schema --json',
      proves: 'Automation and operators can inspect the generated command, status, schema, and exit-code catalog before running workflow commands.',
      apiAccess: 'none',
    },
    {
      id: 'profile-template',
      command: 'metro setup template --json',
      proves: 'The profile file shape stores tenant names and key environment variable names only.',
      apiAccess: 'none',
    },
    {
      id: 'profile-resolution',
      command: `metro setup resolve --file "${QUICKSTART_DIR_VAR}/profiles.json" --profile ${profileName} --expect-tenant sandbox --key-fingerprint fp_sandbox_setup_resolve_reviewed --json`,
      proves: 'The sandbox profile binds to one tenant with a non-secret fingerprint and without env-value inspection.',
      apiAccess: 'none',
    },
    {
      id: 'shape-validation',
      command: `metro validate --shape ${annual.shape} --file "${QUICKSTART_DIR_VAR}/${annual.filename}" --json`,
      proves: `The ${annual.shape} fixture passes local schema and guardrail validation before preview.`,
      apiAccess: 'none',
    },
    {
      id: 'sandbox-preview',
      command: `${annual.previewCommand} --file "${QUICKSTART_DIR_VAR}/${annual.filename}" --sandbox --json`,
      proves: 'The package workflow emits a sandbox-labeled local preview with a stable payload hash.',
      apiAccess: 'none',
    },
    {
      id: 'workspace-orientation',
      command: 'metro workspace explain --json',
      proves: `Operators and agents can inspect ${pack.workspaceOrientationNote} before choosing a billing goal.`,
      apiAccess: 'none',
    },
    {
      id: 'plan-discovery',
      command: 'metro plan list --json',
      proves: 'The CLI exposes reviewed billing intents with recommended shapes and verification reads.',
      apiAccess: 'none',
    },
    {
      id: 'harness-onboard',
      command: 'metro harness run --suite onboard --execute --json',
      proves: 'Full local onboarding harness: schema, workspace, plan, status, setup template, release readiness.',
      apiAccess: 'none',
    },
    {
      id: 'auth-check',
      // check-env exits 1 when the key env var is absent (tested behavior);
      // inside the no-key quickstart that status report must not set the
      // script's exit code, so the step itself carries the || true.
      command: `metro setup auth --file "${QUICKSTART_DIR_VAR}/profiles.json" --profile ${profileName} --check-env --json || true`,
      proves: 'Key env var presence can be checked without printing secret values; key presence is not authorization.',
      apiAccess: 'none',
    },
  ];
}

function buildQuickstartShellCommandBlock(packId = 'generic') {
  return buildFirstSafePreviewCommands(packId).map((step) => step.command).join('\n');
}

function finding(id, severity, message, remediation) {
  return {
    id,
    severity,
    message,
    remediation,
  };
}

function isObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function nonEmpty(value) {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

function filled(value) {
  if (!nonEmpty(value)) return false;
  return !PLACEHOLDER_PATTERN.test(String(value).trim());
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function stampWorkspacePackOnProfiles(profiles, packId) {
  const next = {};
  for (const [name, profile] of Object.entries(profiles || {})) {
    next[name] = {
      ...profile,
      workspacePack: profile.workspacePack || packId,
    };
  }
  return next;
}

function buildSetupTemplate(options = {}) {
  const packId = resolveQuickstartPackId(options);
  const pack = getQuickstartPackConfig(packId);
  return clone({
    schemaVersion: pack.profiles.schemaVersion,
    defaultProfile: pack.profiles.defaultProfile,
    profiles: stampWorkspacePackOnProfiles(pack.profiles.profiles, packId),
    notes: [
      'Store environment variable names only; never paste raw API keys into this file.',
      'Bind workspaceCatalog.rateCardIds and product ids for your tenant before rollout plans.',
      'A profile resolves to one tenant. Key presence is not authorization for live API reads or writes.',
      'Local preview and validation commands do not require API keys.',
    ],
  });
}

function buildSetupQuickstart(options = {}) {
  const packId = resolveQuickstartPackId(options);
  const pack = getQuickstartPackConfig(packId);
  const commands = buildFirstSafePreviewCommands(packId);
  const annual = pack.annual;
  const profileName = pack.profiles.defaultProfile;
  return clone({
    schemaVersion: 'metro.setup.quickstart.v1',
    generatedFrom: 'metronome-cli/src/setup/profiles.js',
    workspacePack: packId,
    apiAccess: 'none',
    localOnly: true,
    liveExecution: {
      enabledInCurrentCli: false,
      reason: 'The first safe preview path writes sample files to a local temp directory and uses local validators only; it does not load API clients, inspect .env files, or contact Metronome.',
      nextSafeStep: 'After this path passes, use metro docs command-reference --html or metro api readiness --summary --json for broader local coverage, then metro api readiness --json for endpoint-level detail. Live operations still require explicit current-turn authorization and the documented preflight gates.',
    },
    title: 'First Safe Preview',
    purpose: 'Give a new authorized teammate or internal agent one terminal-native path to prove installability, command discovery, profile shape, local validation, and sandbox-labeled preview without live API access.',
    prerequisites: [
      'Install metro from the authorized GitHub repository or run it from the package source checkout.',
      'Use a shell that supports quoted here-documents, such as zsh or bash.',
      'Do not load .env files or paste API keys.',
      'Use the temp sample files emitted by this quickstart only.',
    ],
    commands,
    shellCommandBlock: buildQuickstartShellCommandBlock(packId),
    expectedPreviewSummary: {
      schemaVersion: 'metro.preview.v1',
      workflow: 'package.create',
      shape: annual.shape,
      tenant: 'sandbox',
      payloadHash: 'sha256:...',
      blocked: false,
    },
    expectedProfileResolutionSummary: {
      schemaVersion: PROFILE_RESOLUTION_SCHEMA_VERSION,
      apiAccess: 'none',
      localOnly: true,
      profileName,
      expectedTenant: 'sandbox',
      readyForLiveApi: false,
      envPresenceChecked: false,
    },
    liveEndpointAllowlist: {
      read: listLiveReadEndpointIds(),
      sandboxApply: listLiveApplySandboxEndpointIds(),
      note: 'Live operations still require read-gate or apply-gate evidence and explicit current-turn confirmation tokens.',
    },
    nextStepsAfterQuickstart: [
      'metro setup init --workspace generic --write',
      'metro status --check-env --json',
      `metro setup auth --file ~/.metro/profiles.json --profile ${profileName} --check-env --json`,
      'metro plan list --json',
      `metro plan template ${pack.planTemplateIntent} --sandbox --out annual-input.json --json`,
      'metro api readiness --summary --json',
      'See docs/metronome-cli/QUICKSTART.md for first live sandbox read and write paths.',
    ],
    safetyBoundaries: [
      'This quickstart does not read .env files.',
      'This quickstart does not call Metronome, Stripe, a CRM, analytics, chat, email, or any other live system.',
      'A green preview is not production approval and does not authorize live reads, live writes, Stripe delivery, sandbox apply, or production apply.',
      'Future live operations require exact current-turn authorization, tenant proof, preflight, audit, sandbox proof where applicable, read-back verification, rollback or remediation, and approval evidence.',
    ],
    sources: [
      pack.oneGoalDoc,
      pack.quickstartDoc,
      'docs/SAFETY.md',
      'metronome-cli/src/commands/catalog.js',
      'metronome-cli/src/setup/profiles.js',
    ],
  });
}

function collectSecretFindings(value, path = '$') {
  const findings = [];

  if (typeof value === 'string') {
    if (SECRET_VALUE_PATTERN.test(value)) {
      findings.push(finding(
        'MTR-SECRET-002',
        'error',
        `Profile config appears to contain a secret-like value at ${path}.`,
        'Keep only environment variable names in profile files; remove raw keys and bearer tokens.',
      ));
    }
    return findings;
  }

  if (!isObject(value)) return findings;

  for (const [key, nested] of Object.entries(value)) {
    const nestedPath = `${path}.${key}`;
    if (SECRET_KEY_PATTERN.test(key) && key !== 'metronomeKeyEnv') {
      findings.push(finding(
        'MTR-SECRET-001',
        'error',
        `Profile config contains forbidden secret-shaped field ${nestedPath}.`,
        'Use metronomeKeyEnv to name an environment variable; never store raw key fields.',
      ));
    }
    findings.push(...collectSecretFindings(nested, nestedPath));
  }

  return findings;
}

function envPresent(env, envName) {
  return Object.prototype.hasOwnProperty.call(env, envName) && String(env[envName] || '').trim() !== '';
}

function tenantEnvLooksWrong(tenant, envName) {
  if (!nonEmpty(tenant) || !nonEmpty(envName)) return false;
  if (tenant === 'sandbox') return /PROD|PRODUCTION/i.test(envName);
  if (tenant === 'production') return /SANDBOX|TEST/i.test(envName);
  return false;
}

function validateProfileConfig(config, options = {}) {
  const env = options.env || process.env;
  const checkEnv = options.checkEnv !== false;
  const findings = [];
  const profiles = [];

  if (!isObject(config)) {
    return {
      schemaVersion: 'metro.setup.doctor.v1',
      inspectedSchemaVersion: null,
      apiAccess: 'none',
      valid: false,
      findings: [finding(
        'MTR-SETUP-000',
        'error',
        'Profile config must be a JSON object.',
        'Use metro setup template --json to create the profile file shape.',
      )],
      profiles,
      summary: {
        profileCount: 0,
        sandboxProfiles: 0,
        productionProfiles: 0,
        envVarsPresent: 0,
        envVarsMissing: 0,
      },
    };
  }

  if (config.schemaVersion !== 'metro.profiles.v1') {
    findings.push(finding(
      'MTR-SETUP-001',
      'error',
      'Profile config schemaVersion must be metro.profiles.v1.',
      'Regenerate the profile skeleton with metro setup template --json.',
    ));
  }

  if (!isObject(config.profiles) || Object.keys(config.profiles).length === 0) {
    findings.push(finding(
      'MTR-SETUP-002',
      'error',
      'Profile config must include a non-empty profiles object.',
      'Add at least one profile that resolves to sandbox or production.',
    ));
  } else {
    for (const [name, profile] of Object.entries(config.profiles)) {
      const result = {
        name,
        tenant: profile?.tenant || null,
        metronomeKeyEnv: profile?.metronomeKeyEnv || null,
        envPresent: checkEnv ? false : null,
        readyForLiveApi: false,
      };

      if (!PROFILE_NAME_PATTERN.test(name)) {
        findings.push(finding(
          'MTR-SETUP-003',
          'error',
          `Profile name "${name}" must use lowercase letters, numbers, dots, underscores, or dashes and be 2-64 characters.`,
          'Rename the profile to a stable CLI-safe identifier such as acme-sandbox.',
        ));
      }

      if (!isObject(profile)) {
        findings.push(finding(
          'MTR-SETUP-004',
          'error',
          `Profile "${name}" must be an object.`,
          'Use tenant and metronomeKeyEnv fields for each profile.',
        ));
        profiles.push(result);
        continue;
      }

      if (!VALID_TENANTS.has(profile.tenant)) {
        findings.push(finding(
          'MTR-TENANT-003',
          'error',
          `Profile "${name}" must resolve to exactly one tenant: sandbox or production.`,
          'Set tenant to sandbox or production; do not infer tenant from key names or local env state.',
        ));
      }

      if (!nonEmpty(profile.metronomeKeyEnv) || !ENV_NAME_PATTERN.test(profile.metronomeKeyEnv)) {
        findings.push(finding(
          'MTR-AUTH-001',
          'error',
          `Profile "${name}" must use an uppercase metronomeKeyEnv environment variable name.`,
          'Store only an environment variable name such as METRONOME_SANDBOX_KEY, not the key value.',
        ));
      } else if (checkEnv) {
        result.envPresent = envPresent(env, profile.metronomeKeyEnv);
        result.readyForLiveApi = result.envPresent && VALID_TENANTS.has(profile.tenant) && !tenantEnvLooksWrong(profile.tenant, profile.metronomeKeyEnv);
        if (!result.envPresent) {
          findings.push(finding(
            'MTR-AUTH-003',
            'warning',
            `Environment variable ${profile.metronomeKeyEnv} is not present for profile "${name}".`,
            'Set the variable in the shell before an explicitly authorized live command; local preview does not require it.',
          ));
        }
      }

      if (tenantEnvLooksWrong(profile.tenant, profile.metronomeKeyEnv)) {
        findings.push(finding(
          'MTR-AUTH-002',
          'error',
          `Profile "${name}" appears to pair tenant ${profile.tenant} with ${profile.metronomeKeyEnv}.`,
          'Use sandbox key env vars for sandbox profiles and production key env vars for production profiles.',
        ));
        result.readyForLiveApi = false;
      }

      profiles.push(result);
    }
  }

  if (isObject(config.profiles)) {
    for (const [name, profile] of Object.entries(config.profiles)) {
      if (isObject(profile?.workspaceCatalog)) {
        findings.push(...validateWorkspaceCatalogShape(profile.workspaceCatalog, name));
      }
    }
  }

  findings.push(...collectSecretFindings(config));

  return {
    schemaVersion: 'metro.setup.doctor.v1',
    inspectedSchemaVersion: config.schemaVersion || null,
    apiAccess: 'none',
    valid: !findings.some((item) => item.severity === 'error'),
    findings,
    profiles,
      summary: {
        profileCount: profiles.length,
        sandboxProfiles: profiles.filter((profile) => profile.tenant === 'sandbox').length,
        productionProfiles: profiles.filter((profile) => profile.tenant === 'production').length,
        envVarsPresent: checkEnv ? profiles.filter((profile) => profile.envPresent).length : 0,
        envVarsMissing: checkEnv ? profiles.filter((profile) => !profile.envPresent).length : 0,
      },
    };
}

function resolveTenantProfile(config, options = {}) {
  const checkEnv = options.checkEnv === true;
  const validation = validateProfileConfig(config, {
    env: options.env || process.env,
    checkEnv,
  });
  const findings = [...validation.findings];
  const profileName = nonEmpty(options.profileName) ? String(options.profileName).trim() : null;
  const expectedTenant = nonEmpty(options.expectedTenant) ? String(options.expectedTenant).trim() : null;
  const keyFingerprint = nonEmpty(options.keyFingerprint) ? String(options.keyFingerprint).trim() : null;
  let selectedProfile = null;

  if (!filled(profileName)) {
    findings.push(finding(
      'MTR-SETUP-005',
      'error',
      'Profile resolution requires --profile <name>.',
      'Choose a named profile from the profile file instead of inferring tenant from local env state.',
    ));
  } else if (!PROFILE_NAME_PATTERN.test(profileName)) {
    findings.push(finding(
      'MTR-SETUP-003',
      'error',
      'Resolved profile name must use lowercase letters, numbers, dots, underscores, or dashes and be 2-64 characters.',
      'Pass a stable CLI-safe profile name such as acme-sandbox.',
    ));
  } else {
    selectedProfile = validation.profiles.find((profile) => profile.name === profileName) || null;
    if (!selectedProfile) {
      findings.push(finding(
        'MTR-SETUP-006',
        'error',
        `Profile "${profileName}" was not found in the profile file.`,
        'Run metro setup doctor --file <profiles.json> --json and choose one of the declared profile names.',
      ));
    }
  }

  if (expectedTenant !== null && !VALID_TENANTS.has(expectedTenant)) {
    findings.push(finding(
      'MTR-TENANT-003',
      'error',
      'Expected tenant must be sandbox or production.',
      'Pass --expect-tenant sandbox or --expect-tenant production when binding a profile to a workflow.',
    ));
  }

  if (selectedProfile && expectedTenant && selectedProfile.tenant !== expectedTenant) {
    findings.push(finding(
      'MTR-TENANT-005',
      'error',
      `Profile "${selectedProfile.name}" resolves to tenant ${selectedProfile.tenant}, not ${expectedTenant}.`,
      'Use a profile whose tenant matches the planned workflow tenant before any read gate or preflight uses this binding.',
    ));
  }

  if (!filled(keyFingerprint)) {
    findings.push(finding(
      'MTR-AUTH-004',
      'error',
      'Profile resolution requires --key-fingerprint <fingerprint>.',
      'Pass a non-secret key fingerprint such as fp_sandbox_reviewed or sha256:<64 lowercase hex chars>; never pass a raw API key.',
    ));
  } else if (SECRET_VALUE_PATTERN.test(keyFingerprint)) {
    findings.push(finding(
      'MTR-SECRET-002',
      'error',
      'Key fingerprint appears to contain a secret-like value.',
      'Replace it with a non-secret fingerprint label or hash; never pass or print raw API keys.',
    ));
  } else if (!KEY_FINGERPRINT_PATTERN.test(keyFingerprint)) {
    findings.push(finding(
      'MTR-AUTH-005',
      'error',
      'Key fingerprint must use fp_<label> or sha256:<64 lowercase hex chars>.',
      'Use a stable non-secret fingerprint that can be compared across preview, gate, and audit evidence.',
    ));
  }

  const valid = !findings.some((item) => item.severity === 'error');
  const profile = selectedProfile ? {
    name: selectedProfile.name,
    tenant: selectedProfile.tenant,
    metronomeKeyEnv: selectedProfile.metronomeKeyEnv,
    envPresence: {
      checked: checkEnv,
      present: checkEnv ? selectedProfile.envPresent : null,
    },
    readyForLiveApi: false,
  } : null;

  return {
    schemaVersion: PROFILE_RESOLUTION_SCHEMA_VERSION,
    generatedFrom: 'metronome-cli/src/setup/profiles.js',
    apiAccess: 'none',
    localOnly: true,
    valid,
    blocked: !valid,
    profileName,
    expectedTenant,
    liveExecution: clone(LOCAL_ONLY_LIVE_EXECUTION),
    profile,
    tenantProfile: valid ? {
      profileName: selectedProfile.name,
      tenant: selectedProfile.tenant,
      keyEnv: selectedProfile.metronomeKeyEnv,
      keyFingerprint,
      profileBindingConfirmed: true,
    } : null,
    validationSummary: validation.summary,
    findings,
    nextSafeStep: valid
      ? 'Use tenantProfile as local profile-binding evidence in read-gate or preflight manifests. This does not authorize live API access.'
      : 'Fix the profile resolution findings before using this binding in read-gate or preflight evidence.',
  };
}

function buildSetupAuthCheck(config, options = {}) {
  const checkEnv = options.checkEnv === true;
  const profileName = nonEmpty(options.profileName) ? String(options.profileName).trim() : null;
  const validation = validateProfileConfig(config, {
    env: options.env || process.env,
    checkEnv,
  });

  const profiles = profileName
    ? validation.profiles.filter((entry) => entry.name === profileName)
    : validation.profiles;

  const authProfiles = profiles.map((profile) => ({
    name: profile.name,
    tenant: profile.tenant,
    metronomeKeyEnv: profile.metronomeKeyEnv,
    keyConfigured: checkEnv ? profile.envPresent === true : null,
    readyForLiveApi: false,
    authorizationNote: 'Key presence is not authorization. Live reads and writes still require current-turn confirmation and evidence gates.',
  }));

  const allKeysConfigured = checkEnv && authProfiles.length > 0
    && authProfiles.every((profile) => profile.keyConfigured === true);

  return {
    schemaVersion: 'metro.setup.auth.v1',
    generatedFrom: 'metronome-cli/src/setup/profiles.js',
    apiAccess: 'none',
    localOnly: true,
    checkEnv,
    valid: validation.valid && (!profileName || authProfiles.length > 0),
    profileFilter: profileName,
    liveExecution: clone(LOCAL_ONLY_LIVE_EXECUTION),
    liveEndpointAllowlist: {
      read: listLiveReadEndpointIds(),
      sandboxApply: listLiveApplySandboxEndpointIds(),
    },
    profiles: authProfiles,
    summary: {
      profileCount: authProfiles.length,
      keysConfigured: checkEnv ? authProfiles.filter((profile) => profile.keyConfigured).length : null,
      keysMissing: checkEnv ? authProfiles.filter((profile) => !profile.keyConfigured).length : null,
      allKeysConfigured,
    },
    findings: validation.findings,
    nextSafeStep: !checkEnv
      ? 'Re-run with --check-env to verify key env var presence without printing secret values.'
      : allKeysConfigured
        ? 'Keys are present for the selected profile(s). Use read-gate or apply-gate evidence before metro api read or metro api apply.'
        : 'Export the required key env var for your profile, then re-run setup auth --check-env. Example: export METRONOME_SANDBOX_KEY=...',
    setupHints: {
      sandbox: 'export METRONOME_SANDBOX_KEY=<sandbox-key-from-metronome-dashboard>',
      production: 'export METRONOME_PROD_KEY=<production-key-from-metronome-dashboard>',
    },
  };
}

function defaultMetroConfigDir() {
  return path.join(os.homedir(), '.metro');
}

function buildSetupInit(options = {}) {
  const packId = resolveQuickstartPackId(options);
  const pack = getQuickstartPackConfig(packId);
  const profileName = pack.profiles.defaultProfile;
  const targetDir = options.dir
    ? path.resolve(String(options.dir))
    : defaultMetroConfigDir();
  const profilePath = path.join(targetDir, 'profiles.json');
  const template = buildSetupTemplate(options);
  const exists = fs.existsSync(profilePath);

  return {
    schemaVersion: 'metro.setup.init.v1',
    generatedFrom: 'metronome-cli/src/setup/profiles.js',
    workspacePack: packId,
    apiAccess: 'none',
    localOnly: true,
    targetDir,
    profilePath,
    profileExists: exists,
    wouldCreate: !exists,
    valid: !exists || options.force === true,
    blocked: exists && !options.force,
    blockReason: exists && !options.force
      ? 'profiles.json already exists; pass --force to overwrite or choose another --dir.'
      : null,
    template,
    envHints: {
      sandbox: 'export METRONOME_SANDBOX_KEY=<key>',
      production: 'export METRONOME_PROD_KEY=<key>',
    },
    nextCommands: [
      `metro setup auth --file ${profilePath} --profile ${profileName} --check-env --json`,
      'metro status --file ' + profilePath + ` --profile ${profileName} --check-env --json`,
      packId === 'generic'
        ? 'metro setup quickstart --workspace generic --shell | zsh'
        : 'metro setup quickstart --shell | zsh',
    ],
    nextSafeStep: exists && !options.force
      ? 'Use existing profiles.json or pass --force to replace it.'
      : 'Run metro setup init --write to create ~/.metro/profiles.json, then export your sandbox key.',
  };
}

function writeSetupInit(options = {}) {
  const plan = buildSetupInit(options);
  if (plan.blocked) {
    return {
      ...plan,
      written: false,
      valid: false,
    };
  }

  fs.mkdirSync(plan.targetDir, { recursive: true });
  fs.writeFileSync(plan.profilePath, `${JSON.stringify(plan.template, null, 2)}\n`, 'utf8');
  const sticky = writeStickyWorkspacePack(plan.workspacePack, { configDir: plan.targetDir });

  return {
    ...plan,
    written: true,
    valid: true,
    profileExists: true,
    wouldCreate: false,
    blocked: false,
    blockReason: null,
    configPath: sticky.path,
    defaultWorkspacePack: sticky.defaultWorkspacePack,
    nextSafeStep: `Profiles written to ${plan.profilePath}; sticky pack ${sticky.defaultWorkspacePack} in ${sticky.path}. Run metro setup auth --file ${plan.profilePath} --profile ${getQuickstartPackConfig(resolveQuickstartPackId(options)).profiles.defaultProfile} --check-env --json`,
  };
}

module.exports = {
  buildSetupTemplate,
  buildSetupQuickstart,
  buildSetupAuthCheck,
  buildSetupInit,
  writeSetupInit,
  defaultMetroConfigDir,
  resolveTenantProfile,
  validateProfileConfig,
};
