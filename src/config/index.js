/**
 * @module config
 * @description Configuration management for Super Z Twin. Handles loading from
 *              ~/.superz/config.yaml, merging with repo-level overrides,
 *              environment variable overrides, and config validation.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { parse, stringify } from 'yaml';

/** @typedef {import('../utils/logger.js').default} Logger */

/**
 * Default configuration values. Any missing config keys fall back to these.
 * @type {object}
 */
const DEFAULTS = {
  version: '0.1.0',
  provider: {
    type: null,       // 'zeroclaw' | 'piagent' | 'claude' | 'openai' | 'proxy'
    apiKey: null,
    baseUrl: null,    // Custom base URL (for proxy or self-hosted)
    model: null,      // Override default model
  },
  agent: {
    name: 'Super Z',
    parallelism: 3,            // Max concurrent tasks
    riskTolerance: 'balanced', // 'conservative' | 'balanced' | 'aggressive'
    autoCommit: true,
    autoPush: false,
    branchPrefix: 'superz/',
    commitStyle: 'conventional', // 'conventional' | 'descriptive' | 'minimal'
    maxRetries: 3,
    timeout: 120_000,          // API call timeout in ms
  },
  preferences: {
    languages: ['javascript', 'typescript'],
    frameworks: [],
    codeStyle: 'clean',
    testFirst: false,
    documentation: 'standard',  // 'minimal' | 'standard' | 'comprehensive'
    verbose: false,
  },
  paths: {
    configDir: path.join(os.homedir(), '.superz'),
    logsDir: path.join(os.homedir(), '.superz', 'logs'),
    cacheDir: path.join(os.homedir(), '.superz', 'cache'),
  },
};

/**
 * Environment variable mapping to config paths.
 * Keys are env var names; values are dot-path strings into the config object.
 * @type {Record<string, string>}
 */
const ENV_OVERRIDES = {
  SUPERZ_PROVIDER_TYPE: 'provider.type',
  SUPERZ_API_KEY: 'provider.apiKey',
  SUPERZ_BASE_URL: 'provider.baseUrl',
  SUPERZ_MODEL: 'provider.model',
  SUPERZ_PARALLELISM: 'agent.parallelism',
  SUPERZ_RISK_TOLERANCE: 'agent.riskTolerance',
  SUPERZ_AUTO_COMMIT: 'agent.autoCommit',
  SUPERZ_AUTO_PUSH: 'agent.autoPush',
  SUPERZ_BRANCH_PREFIX: 'agent.branchPrefix',
  SUPERZ_VERBOSE: 'preferences.verbose',
  SUPERZ_LOG_LEVEL: 'preferences.logLevel',
  GITHUB_TOKEN: 'agent.githubToken',
};

/**
 * Deep-merge two objects. Source values overwrite target values recursively.
 * Arrays are replaced, not merged.
 * @param {object} target — Base object.
 * @param {object} source — Override object.
 * @returns {object} Merged result (new object).
 */
function deepMerge(target, source) {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (
      source[key] !== null &&
      typeof source[key] === 'object' &&
      !Array.isArray(source[key]) &&
      target[key] !== null &&
      typeof target[key] === 'object' &&
      !Array.isArray(target[key])
    ) {
      result[key] = deepMerge(target[key], source[key]);
    } else if (source[key] !== undefined) {
      result[key] = source[key];
    }
  }
  return result;
}

/**
 * Set a nested value in an object using a dot-path string.
 * @param {object} obj — Target object.
 * @param {string} dotPath — Dot-separated path (e.g., "provider.apiKey").
 * @param {*} value — Value to set.
 */
function setNestedValue(obj, dotPath, value) {
  const keys = dotPath.split('.');
  let current = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (!(keys[i] in current)) {
      current[keys[i]] = {};
    }
    current = current[keys[i]];
  }
  current[keys[keys.length - 1]] = value;
}

/**
 * Validate a configuration object for required fields and correct types.
 * @param {object} config — The config to validate.
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateConfig(config) {
  const errors = [];

  if (!config.provider || !config.provider.type) {
    errors.push('provider.type is required — run "superz onboard" to configure');
  }

  const validProviders = ['zeroclaw', 'piagent', 'claude', 'openai', 'proxy'];
  if (config.provider?.type && !validProviders.includes(config.provider.type)) {
    errors.push(`provider.type must be one of: ${validProviders.join(', ')}`);
  }

  if (config.provider?.type === 'proxy' && !config.provider?.baseUrl) {
    errors.push('provider.baseUrl is required when provider.type is "proxy"');
  }

  if (config.agent?.parallelism !== undefined) {
    if (!Number.isInteger(config.agent.parallelism) || config.agent.parallelism < 1) {
      errors.push('agent.parallelism must be a positive integer');
    }
  }

  const validRisk = ['conservative', 'balanced', 'aggressive'];
  if (config.agent?.riskTolerance && !validRisk.includes(config.agent.riskTolerance)) {
    errors.push(`agent.riskTolerance must be one of: ${validRisk.join(', ')}`);
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Load and merge configuration from all sources.
 *
 * Priority order (highest to lowest):
 *   1. Environment variables
 *   2. Repo-level .superz/config.yaml
 *   3. User-level ~/.superz/config.yaml
 *   4. Built-in defaults
 *
 * @param {object} [opts]
 * @param {string} [opts.repoDir=process.cwd()] — Repository directory for repo-level config.
 * @param {Logger} [opts.logger] — Logger instance for debug output.
 * @returns {object} Fully merged and validated configuration.
 */
export function loadConfig({ repoDir = process.cwd(), logger } = {}) {
  let config = structuredClone(DEFAULTS);

  // 1. Load user-level config
  const userConfigPath = path.join(os.homedir(), '.superz', 'config.yaml');
  if (fs.existsSync(userConfigPath)) {
    try {
      const raw = fs.readFileSync(userConfigPath, 'utf-8');
      const userConfig = parse(raw);
      config = deepMerge(config, userConfig);
      logger?.debug('Loaded user config', { path: userConfigPath });
    } catch (err) {
      logger?.warn('Failed to parse user config', { path: userConfigPath, error: err.message });
    }
  }

  // 2. Load repo-level config
  const repoConfigPath = path.join(repoDir, '.superz', 'config.yaml');
  if (fs.existsSync(repoConfigPath)) {
    try {
      const raw = fs.readFileSync(repoConfigPath, 'utf-8');
      const repoConfig = parse(raw);
      config = deepMerge(config, repoConfig);
      logger?.debug('Loaded repo config', { path: repoConfigPath });
    } catch (err) {
      logger?.warn('Failed to parse repo config', { path: repoConfigPath, error: err.message });
    }
  }

  // 3. Apply environment variable overrides
  for (const [envVar, configPath] of Object.entries(ENV_OVERRIDES)) {
    const value = process.env[envVar];
    if (value !== undefined) {
      // Coerce string env vars to appropriate types
      let parsed = value;
      if (value === 'true') parsed = true;
      else if (value === 'false') parsed = false;
      else if (/^\d+$/.test(value)) parsed = parseInt(value, 10);

      setNestedValue(config, configPath, parsed);
      logger?.debug('Applied env override', { envVar, configPath, value: parsed });
    }
  }

  // Validate
  const validation = validateConfig(config);
  if (!validation.valid) {
    logger?.warn('Configuration validation warnings', { errors: validation.errors });
  }

  return config;
}

/**
 * Save configuration to the user-level config file.
 * @param {object} config — Configuration object to save.
 * @param {string} [configPath] — Override save path.
 * @returns {{ path: string }} The path where config was saved.
 */
export function saveConfig(config, configPath) {
  const saveTo = configPath || path.join(os.homedir(), '.superz', 'config.yaml');

  // Ensure directory exists
  const dir = path.dirname(saveTo);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Write with YAML format
  const yamlStr = stringify(config, { lineWidth: 100, sortMapEntries: true });
  fs.writeFileSync(saveTo, yamlStr, 'utf-8');

  return { path: saveTo };
}

/**
 * Get the path to the user-level config directory.
 * @returns {string}
 */
export function getConfigDir() {
  return path.join(os.homedir(), '.superz');
}

/**
 * Check whether the user has completed onboarding.
 * @returns {boolean}
 */
export function isOnboarded() {
  const configPath = path.join(os.homedir(), '.superz', 'config.yaml');
  return fs.existsSync(configPath);
}

export { DEFAULTS };
