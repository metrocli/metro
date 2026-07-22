'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PROFILE_RESOLUTION_SCHEMA_VERSION = 'metro.profile.resolve.v1';
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const PLACEHOLDER_PATTERN = /^<[^>]+>$/;

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonEmpty(value) {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

function filled(value) {
  return nonEmpty(value) && !PLACEHOLDER_PATTERN.test(String(value).trim());
}

function isSha256(value) {
  return typeof value === 'string' && SHA256_PATTERN.test(value);
}

function resolveLocalPath(filePath, rootDir) {
  if (!filled(filePath)) return null;
  if (path.isAbsolute(filePath)) return filePath;
  return path.resolve(rootDir || process.cwd(), filePath);
}

function hashFile(filePath) {
  return `sha256:${crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')}`;
}

function hashProfileResolutionFileIfReadable(filePath, rootDir, placeholder = 'sha256:<64 lowercase hex profile resolution file hash>') {
  const resolved = resolveLocalPath(filePath, rootDir);
  if (!resolved) return placeholder;
  try {
    return hashFile(resolved);
  } catch {
    return placeholder;
  }
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function keyEnvForTenant(tenant) {
  return tenant === 'production' ? '<METRONOME_PROD_KEY>' : '<METRONOME_SANDBOX_KEY>';
}

function profileResolutionIsUsable(profileResolution, tenant) {
  return isObject(profileResolution)
    && profileResolution.schemaVersion === PROFILE_RESOLUTION_SCHEMA_VERSION
    && profileResolution.valid === true
    && profileResolution.blocked === false
    && profileResolution.apiAccess === 'none'
    && profileResolution.localOnly === true
    && profileResolution.liveExecution?.enabledInCurrentCli === false
    && profileResolution.profile?.readyForLiveApi === false
    && profileResolution.tenantProfile?.profileBindingConfirmed === true
    && profileResolution.tenantProfile?.tenant === tenant
    && filled(profileResolution.tenantProfile?.profileName)
    && filled(profileResolution.tenantProfile?.keyEnv)
    && filled(profileResolution.tenantProfile?.keyFingerprint);
}

function profileResolutionMatchesTenantProfile(profileResolution, tenantProfile) {
  if (!profileResolution || !tenantProfile) return true;
  const resolvedProfile = profileResolution.tenantProfile;
  return resolvedProfile?.profileName === tenantProfile.profileName
    && resolvedProfile?.tenant === tenantProfile.tenant
    && resolvedProfile?.keyEnv === tenantProfile.keyEnv
    && resolvedProfile?.keyFingerprint === tenantProfile.keyFingerprint
    && tenantProfile.profileBindingConfirmed === true;
}

function buildProfileResolutionSection(options = {}) {
  const {
    profileResolutionPath,
    rootDir,
    valid = false,
    placeholder = 'sha256:<64 lowercase hex profile resolution file hash>',
  } = options;

  return {
    filePath: profileResolutionPath || '<path-to-metro-profile-resolve-json>',
    fileHash: hashProfileResolutionFileIfReadable(profileResolutionPath, rootDir, placeholder),
    schemaVersion: PROFILE_RESOLUTION_SCHEMA_VERSION,
    valid,
  };
}

function validateProfileResolutionEvidence(options = {}) {
  const {
    input,
    rootDir = process.cwd(),
    findings,
    addFinding,
    scanForSecrets,
    required = true,
    localOnlyFindingId,
    targetLabel,
    expectedTenant,
    expectedTenantPath,
    consistencyContext,
    sectionPath = 'tenantProfile.profileResolution',
    objectRequiredMessage,
  } = options;

  const profile = input?.tenantProfile;
  const section = profile?.profileResolution;
  const label = targetLabel || 'gate';
  const tenantPath = expectedTenantPath || 'binding.tenant';
  const consistency = consistencyContext || `profile resolution and ${label}`;
  const add = (id, message, pathName, remediation) => addFinding(id, message, pathName, remediation);

  if (section === undefined) {
    if (required) {
      add('MTR-TENANT-006', `${sectionPath} is required.`, sectionPath, 'Use metro setup resolve --json and reference that local evidence file.');
    }
    return false;
  }

  if (!isObject(section)) {
    add(
      'MTR-TENANT-006',
      objectRequiredMessage || `${sectionPath} must be an object.`,
      sectionPath,
      'Use metro setup resolve --json and reference that local evidence file.',
    );
    return false;
  }

  const startFindingCount = findings.length;
  if (!filled(section.filePath)) {
    add('MTR-TENANT-006', `${sectionPath}.filePath is required.`, `${sectionPath}.filePath`, 'Point to the reviewed metro setup resolve JSON file.');
  }
  if (!isSha256(section.fileHash)) {
    add('MTR-HASH-001', `${sectionPath}.fileHash must be sha256:<64 lowercase hex>.`, `${sectionPath}.fileHash`, 'Hash the reviewed metro setup resolve JSON file and record the sha256 value.');
  }
  if (section.schemaVersion !== PROFILE_RESOLUTION_SCHEMA_VERSION) {
    add('MTR-TENANT-006', `${sectionPath}.schemaVersion must be ${PROFILE_RESOLUTION_SCHEMA_VERSION}.`, `${sectionPath}.schemaVersion`, 'Use output from metro setup resolve --json.');
  }
  if (section.valid !== true) {
    add('MTR-TENANT-006', `${sectionPath}.valid must be true.`, `${sectionPath}.valid`, 'Only a valid metro setup resolve artifact can satisfy profile resolution evidence.');
  }

  const resolved = resolveLocalPath(section.filePath, rootDir);
  if (!resolved) return false;

  let parsed;
  try {
    const actualHash = hashFile(resolved);
    if (isSha256(section.fileHash) && section.fileHash !== actualHash) {
      add(
        'MTR-HASH-002',
        `${sectionPath}.fileHash does not match the current file contents.`,
        `${sectionPath}.fileHash`,
        'Re-review the changed profile resolution file and update the hash only after confirming the tenant binding is intended.',
      );
    }
    parsed = readJsonFile(resolved);
  } catch (error) {
    add(
      'MTR-TENANT-006',
      `Failed to read or parse ${sectionPath} evidence: ${error.message}`,
      `${sectionPath}.filePath`,
      'Use a readable local metro setup resolve JSON file.',
    );
    return false;
  }

  if (scanForSecrets) {
    scanForSecrets(parsed, findings, `${sectionPath}.file`);
  }

  if (parsed.schemaVersion !== PROFILE_RESOLUTION_SCHEMA_VERSION) {
    add('MTR-TENANT-006', `Profile resolution file schemaVersion must be ${PROFILE_RESOLUTION_SCHEMA_VERSION}.`, `${sectionPath}.filePath`, 'Use output from metro setup resolve --json.');
  }
  if (parsed.valid !== true || parsed.blocked === true) {
    add('MTR-TENANT-006', 'Profile resolution file must be valid and unblocked.', `${sectionPath}.filePath`, `Fix metro setup resolve findings before binding this ${label}.`);
  }
  if (parsed.apiAccess !== 'none' || parsed.localOnly !== true || parsed.liveExecution?.enabledInCurrentCli !== false) {
    add(localOnlyFindingId, 'Profile resolution file must be local-only and keep live execution disabled.', `${sectionPath}.filePath`, 'Use local profile resolution output from the current CLI.');
  }
  if (parsed.profile?.readyForLiveApi !== false) {
    add('MTR-TENANT-006', 'Profile resolution file must not claim readyForLiveApi.', `${sectionPath}.filePath`, 'Keep profile resolution as local evidence, not live authorization.');
  }
  if (parsed.expectedTenant && parsed.expectedTenant !== expectedTenant) {
    add('MTR-TENANT-006', `Profile resolution expectedTenant must match ${tenantPath}.`, `${sectionPath}.filePath`, `Regenerate profile resolution for the same tenant as the ${label}.`);
  }

  const resolvedProfile = parsed.tenantProfile;
  if (!isObject(resolvedProfile)) {
    add('MTR-TENANT-006', 'Profile resolution file must include tenantProfile evidence.', `${sectionPath}.filePath`, 'Use output from metro setup resolve --json.');
  } else {
    if (resolvedProfile.profileName !== profile?.profileName) {
      add('MTR-TENANT-006', 'tenantProfile.profileName must match the profile resolution file.', 'tenantProfile.profileName', `Regenerate the ${label} from the reviewed profile resolution evidence.`);
    }
    if (resolvedProfile.tenant !== expectedTenant || resolvedProfile.tenant !== profile?.tenant) {
      add('MTR-TENANT-006', `Resolved tenant must match ${tenantPath} and tenantProfile.tenant.`, 'tenantProfile.tenant', `Use one tenant consistently across ${consistency}.`);
    }
    if (resolvedProfile.keyEnv !== profile?.keyEnv) {
      add('MTR-TENANT-006', 'tenantProfile.keyEnv must match the profile resolution file.', 'tenantProfile.keyEnv', `Regenerate the ${label} from the reviewed profile resolution evidence.`);
    }
    if (resolvedProfile.keyFingerprint !== profile?.keyFingerprint) {
      add('MTR-TENANT-006', 'tenantProfile.keyFingerprint must match the profile resolution file.', 'tenantProfile.keyFingerprint', `Regenerate the ${label} from the reviewed profile resolution evidence.`);
    }
    if (resolvedProfile.profileBindingConfirmed !== true) {
      add('MTR-TENANT-006', 'Profile resolution file must confirm the tenant profile binding.', `${sectionPath}.filePath`, 'Use a valid metro setup resolve artifact.');
    }
  }

  return findings.length === startFindingCount;
}

module.exports = {
  PROFILE_RESOLUTION_SCHEMA_VERSION,
  buildProfileResolutionSection,
  hashProfileResolutionFileIfReadable,
  keyEnvForTenant,
  profileResolutionIsUsable,
  profileResolutionMatchesTenantProfile,
  validateProfileResolutionEvidence,
};
