'use strict';

const ENV_NAME_PATTERN = /^[A-Z][A-Z0-9_]*$/;

function resolveKeyFromEnv(keyEnv) {
  if (!keyEnv || typeof keyEnv !== 'string' || !ENV_NAME_PATTERN.test(keyEnv.trim())) {
    return {
      configured: false,
      keyEnv: keyEnv || null,
      reason: 'Tenant profile must name a valid Metronome key environment variable.',
    };
  }

  const envName = keyEnv.trim();
  const value = process.env[envName];
  if (!value || String(value).trim() === '') {
    return {
      configured: false,
      keyEnv: envName,
      reason: `Environment variable ${envName} is not set. Export your Metronome API key before running live commands.`,
    };
  }

  return {
    configured: true,
    keyEnv: envName,
    value: String(value).trim(),
  };
}

module.exports = {
  resolveKeyFromEnv,
};
