/**
 * @module superz-twin
 * @description Main entry point for the Super Z Twin digital git-agent.
 *              Loads configuration, initializes the cognitive profile,
 *              sets up the API provider, and manages the agent lifecycle.
 *
 * This is designed as a standalone, API-agnostic agent core that can be
 * extended with provider-specific adapters.
 */

import os from 'node:os';
import path from 'node:path';
import { getLogger } from './utils/logger.js';
import { loadConfig, validateConfig } from './config/index.js';
import { isGitRepo, getRepoInfo, getChangedFiles } from './utils/git.js';

/**
 * Agent lifecycle states.
 * @readonly
 * @enum {string}
 */
export const AgentState = {
  IDLE: 'idle',
  INITIALIZING: 'initializing',
  RUNNING: 'running',
  PAUSED: 'paused',
  SHUTTING_DOWN: 'shutting_down',
  STOPPED: 'stopped',
  ERROR: 'error',
};

/**
 * SuperZTwin — The core digital twin agent class.
 *
 * Orchestrates the full agent lifecycle: config loading, cognitive profile
 * initialization, provider setup, task processing loop, and graceful shutdown.
 *
 * @example
 * import { SuperZTwin } from './src/index.js';
 * const agent = new SuperZTwin();
 * await agent.start();
 */
export class SuperZTwin {
  /**
   * Create a new SuperZTwin instance.
   * @param {object} [opts]
   * @param {object} [opts.config] — Pre-loaded config (loads from disk if omitted).
   * @param {import('./utils/logger.js').default} [opts.logger] — Logger instance.
   * @param {string} [opts.repoDir=process.cwd()] — Repository working directory.
   * @param {boolean} [opts.dryRun=false] — Simulate without making real changes.
   */
  constructor({ config, logger, repoDir = process.cwd(), dryRun = false } = {}) {
    /** @type {object} Fully resolved configuration */
    this.config = config || loadConfig({ repoDir, logger });

    /** @type {import('./utils/logger.js').default} Logger instance */
    this.logger = logger || getLogger({
      verbose: this.config.preferences?.verbose,
      context: 'superz',
    });

    /** @type {string} Repository working directory */
    this.repoDir = repoDir;

    /** @type {boolean} Dry-run mode — no actual git operations */
    this.dryRun = dryRun;

    /** @type {AgentState} Current agent lifecycle state */
    this.state = AgentState.IDLE;

    /** @type {object|null} Cognitive profile */
    this.cognitiveProfile = null;

    /** @type {object|null} API provider adapter */
    this.provider = null;

    /** @type {number} Agent start timestamp */
    this.startedAt = null;

    /** @type {object} Agent runtime metrics */
    this.metrics = {
      tasksProcessed: 0,
      tasksSucceeded: 0,
      tasksFailed: 0,
      commitsMade: 0,
      errors: [],
    };

    /** @type {NodeJS.Timeout|null} Main loop interval handle */
    this._loopHandle = null;
  }

  /**
   * Initialize the cognitive profile for the agent.
   * The cognitive profile encodes Super Z's working style: decision patterns,
   * risk assessment heuristics, code style preferences, and communication style.
   *
   * @returns {object} The initialized cognitive profile.
   */
  _initCognitiveProfile() {
    this.cognitiveProfile = {
      identity: {
        name: this.config.agent.name || 'Super Z',
        role: 'FLUX Fleet Architect',
        version: this.config.version || '0.1.0',
      },
      cognition: {
        riskTolerance: this.config.agent.riskTolerance || 'balanced',
        parallelism: this.config.agent.parallelism || 3,
        decisionStyle: 'evidence-based',
        learningRate: 'adaptive',
        errorHandling: 'resilient',
      },
      codeStyle: {
        languages: this.config.preferences.languages || ['javascript', 'typescript'],
        frameworks: this.config.preferences.frameworks || [],
        style: this.config.preferences.codeStyle || 'clean',
        testFirst: this.config.preferences.testFirst || false,
        documentation: this.config.preferences.documentation || 'standard',
        commitStyle: this.config.agent.commitStyle || 'conventional',
      },
      gitBehavior: {
        autoCommit: this.config.agent.autoCommit !== false,
        autoPush: this.config.agent.autoPush === true,
        branchPrefix: this.config.agent.branchPrefix || 'superz/',
        maxRetries: this.config.agent.maxRetries || 3,
      },
    };

    this.logger.debug('Cognitive profile initialized', {
      risk: this.cognitiveProfile.cognition.riskTolerance,
      parallelism: this.cognitiveProfile.cognition.parallelism,
      languages: this.cognitiveProfile.codeStyle.languages,
    });

    return this.cognitiveProfile;
  }

  /**
   * Initialize the API provider adapter based on config.
   * Validates provider configuration and prepares the communication layer.
   *
   * @returns {object} Provider adapter instance.
   * @throws {Error} If provider type is invalid or required config is missing.
   */
  _initProvider() {
    const { type, apiKey, baseUrl, model } = this.config.provider;

    if (!type) {
      throw new Error('No provider type configured. Run "superz onboard" to set up.');
    }

    const validProviders = ['zeroclaw', 'piagent', 'claude', 'openai', 'proxy'];
    if (!validProviders.includes(type)) {
      throw new Error(`Invalid provider type: "${type}". Must be one of: ${validProviders.join(', ')}`);
    }

    this.provider = {
      type,
      apiKey,
      baseUrl,
      model,
      initialized: true,
      /** Send a completion request to the provider. @param {object} payload @returns {Promise<object>} */
      async complete(payload) {
        if (!this.initialized) throw new Error('Provider not initialized');
        // This will be implemented by provider-specific adapters
        throw new Error(`Provider adapter for "${type}" not yet implemented`);
      },
    };

    this.logger.info('Provider initialized', {
      type,
      model: model || 'default',
      baseUrl: baseUrl || 'default',
      hasApiKey: !!apiKey,
    });

    return this.provider;
  }

  /**
   * Validate the environment and repository state before starting.
   * @returns {{ valid: boolean, issues: string[] }}
   */
  _validateEnvironment() {
    const issues = [];

    // Config validation
    const validation = validateConfig(this.config);
    if (!validation.valid) {
      issues.push(...validation.errors);
    }

    // Repository check
    if (!isGitRepo(this.repoDir)) {
      issues.push(`Not a git repository: ${this.repoDir}`);
    } else {
      const info = getRepoInfo(this.repoDir);
      if (!info.remoteUrl) {
        issues.push('No git remote configured — auto-push will not work');
      }
      if (!info.isClean) {
        const changed = getChangedFiles(this.repoDir);
        const total = changed.staged.length + changed.unstaged.length + changed.untracked.length;
        issues.push(`Working tree has ${total} uncommitted change(s)`);
      }
    }

    return { valid: issues.length === 0, issues };
  }

  /**
   * Start the agent.
   * Performs full initialization, environment validation, and enters the main loop.
   *
   * @returns {Promise<void>}
   * @throws {Error} If initialization fails.
   */
  async start() {
    if (this.state === AgentState.RUNNING) {
      this.logger.warn('Agent is already running');
      return;
    }

    this.state = AgentState.INITIALIZING;
    this.startedAt = Date.now();

    this.logger.banner();
    this.logger.section('Initialization');

    // Validate environment
    const envCheck = this._validateEnvironment();
    if (!envCheck.valid) {
      for (const issue of envCheck.issues) {
        this.logger.warn(issue);
      }
      if (envCheck.issues.some(i => i.includes('provider'))) {
        throw new Error('Provider misconfigured — run "superz configure" to fix');
      }
    }

    // Initialize components
    try {
      this._initCognitiveProfile();
      this._initProvider();
    } catch (err) {
      this.state = AgentState.ERROR;
      this.metrics.errors.push({ phase: 'init', error: err.message });
      throw err;
    }

    // Transition to running
    this.state = AgentState.RUNNING;
    this.logger.success('Agent is running', {
      provider: this.config.provider.type,
      repo: this.repoDir,
      dryRun: this.dryRun,
    });

    // Display runtime info
    console.log('');
    console.log(chalk.cyan('  ⚡ Agent ready. Waiting for tasks...\n'));

    // The agent loop will be expanded with task processing in future iterations.
    // For now, the agent enters an idle state that can be interrupted by signals.
    this._startIdleLoop();
  }

  /**
   * Internal idle loop that keeps the agent alive.
   * In production, this would poll for tasks, process events, etc.
   * @private
   */
  _startIdleLoop() {
    if (this._loopHandle) clearInterval(this._loopHandle);

    this._loopHandle = setInterval(() => {
      if (this.state !== AgentState.RUNNING) {
        clearInterval(this._loopHandle);
        this._loopHandle = null;
        return;
      }
      // Heartbeat — placeholder for task polling
      this.logger.debug('Heartbeat', {
        uptime: Math.round((Date.now() - this.startedAt) / 1000),
        tasks: this.metrics.tasksProcessed,
      });
    }, 60_000); // Heartbeat every 60s
  }

  /**
   * Pause the agent loop without full shutdown.
   */
  async pause() {
    if (this.state !== AgentState.RUNNING) {
      this.logger.warn('Cannot pause — agent is not running');
      return;
    }
    this.state = AgentState.PAUSED;
    this.logger.info('Agent paused');
  }

  /**
   * Resume a paused agent.
   */
  async resume() {
    if (this.state !== AgentState.PAUSED) {
      this.logger.warn('Cannot resume — agent is not paused');
      return;
    }
    this.state = AgentState.RUNNING;
    this.logger.info('Agent resumed');
    this._startIdleLoop();
  }

  /**
   * Stop the agent and clean up resources.
   *
   * @returns {Promise<void>}
   */
  async stop() {
    this.state = AgentState.SHUTTING_DOWN;

    // Clear the loop
    if (this._loopHandle) {
      clearInterval(this._loopHandle);
      this._loopHandle = null;
    }

    // Shutdown the provider
    if (this.provider) {
      this.provider.initialized = false;
    }

    const uptime = this.startedAt
      ? Math.round((Date.now() - this.startedAt) / 1000)
      : 0;

    this.state = AgentState.STOPPED;
    this.logger.success('Agent stopped', {
      uptime: `${uptime}s`,
      tasksProcessed: this.metrics.tasksProcessed,
      tasksSucceeded: this.metrics.tasksSucceeded,
      tasksFailed: this.metrics.tasksFailed,
      errors: this.metrics.errors.length,
    });

    console.log('');
    console.log(chalk.dim(`  Session: ${uptime}s uptime, ${this.metrics.tasksProcessed} tasks processed`));
    console.log('');
  }

  /**
   * Get the current agent status summary.
   * @returns {object} Status object with state, metrics, and config info.
   */
  getStatus() {
    return {
      state: this.state,
      uptime: this.startedAt ? Date.now() - this.startedAt : 0,
      provider: {
        type: this.config.provider.type,
        model: this.config.provider.model,
        baseUrl: this.config.provider.baseUrl,
      },
      metrics: { ...this.metrics },
      dryRun: this.dryRun,
      repoDir: this.repoDir,
    };
  }
}

// ─── Direct Execution (when run as `node src/index.js`) ────────────────────

/**
 * chalk is imported lazily here to avoid import overhead when used as a library.
 */
let chalk;

/**
 * Main function for direct execution.
 * @param {string[]} [argv] — Command-line arguments.
 */
export async function main(argv = process.argv.slice(2)) {
  const { default: chalkMod } = await import('chalk');
  chalk = chalkMod;

  const logger = getLogger({ verbose: false });
  const config = loadConfig({ logger });
  const agent = new SuperZTwin({ config, logger });

  // Handle graceful shutdown
  const shutdown = async (signal) => {
    logger.info(`Received ${signal} — shutting down...`);
    await agent.stop();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Handle uncaught errors
  process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception', { error: err.message, stack: err.stack });
    agent.stop().then(() => process.exit(1));
  });

  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled rejection', { reason: String(reason) });
  });

  try {
    await agent.start();
  } catch (err) {
    logger.error('Fatal error', { error: err.message });
    process.exitCode = 1;
  }
}

// Run main when executed directly
const isDirectRun = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'));
if (isDirectRun) {
  main();
}

export default SuperZTwin;
