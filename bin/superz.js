#!/usr/bin/env node

/**
 * @file CLI entry point for Super Z Twin.
 * @description Provides the `superz` command with subcommands for onboarding,
 *              initialization, running the agent, status inspection, and
 *              reconfiguration. Built with Commander.js for robust CLI parsing.
 */

import { program } from 'commander';
import chalk from 'chalk';
import { runOnboarding } from '../src/onboarding/index.js';
import { isOnboarded, loadConfig, saveConfig } from '../src/config/index.js';
import { getLogger } from '../src/utils/logger.js';
import { getRepoInfo, isGitRepo } from '../src/utils/git.js';

// ─── Program Metadata ────────────────────────────────────────────────────────

program
  .name('superz')
  .description('⚡ Super Z Twin — Digital git-agent with FLUX-native cognition')
  .version('0.1.0', '-v, --version', 'Show version number')
  .helpOption('-h, --help', 'Show help');

// ─── Onboard Command ─────────────────────────────────────────────────────────

program
  .command('onboard')
  .description('Run the interactive onboarding wizard')
  .option('-r, --reconfigure', 'Reconfigure existing setup', false)
  .action(async (opts) => {
    try {
      const result = await runOnboarding({ reconfigure: opts.reconfigure });
      if (!result.success) {
        process.exitCode = 1;
      }
    } catch (err) {
      console.error(chalk.red('Onboarding failed:'), err.message);
      process.exitCode = 1;
    }
  });

// ─── Init Command ─────────────────────────────────────────────────────────────

program
  .command('init [repo]')
  .description('Initialize the agent in a repository directory')
  .option('-f, --force', 'Initialize even if already set up', false)
  .action(async (repo, opts) => {
    const logger = getLogger();

    if (!isOnboarded()) {
      console.error(chalk.yellow('⚠ Not onboarded yet. Run "superz onboard" first.'));
      process.exitCode = 1;
      return;
    }

    const targetPath = repo ? repo.trim() : process.cwd();
    const config = loadConfig({ logger });

    // Validate it's a git repo
    if (!isGitRepo(targetPath)) {
      console.error(chalk.red(`✖ "${targetPath}" is not a git repository.`));
      process.exitCode = 1;
      return;
    }

    try {
      const info = getRepoInfo(targetPath);
      logger.info('Initializing agent in repository', { path: targetPath, branch: info.branch });

      // Create .superz directory in repo
      const { mkdirSync, writeFileSync } = await import('node:fs');
      const { join } = await import('node:path');
      const { stringify } = await import('yaml');

      const superzDir = join(targetPath, '.superz');
      mkdirSync(superzDir, { recursive: true });

      // Write repo-level config (minimal — inherits from user config)
      const repoConfig = {
        repo: {
          path: targetPath,
          remoteUrl: info.remoteUrl,
          defaultBranch: info.branch,
        },
        agent: {
          branchPrefix: config.agent.branchPrefix,
        },
      };

      const configPath = join(superzDir, 'config.yaml');
      writeFileSync(configPath, stringify(repoConfig, { lineWidth: 100 }), 'utf-8');

      // Add .superz to .gitignore
      const gitignorePath = join(targetPath, '.gitignore');
      try {
        const { readFileSync } = await import('node:fs');
        let gitignore = '';
        if (readFileSync(gitignorePath, 'utf-8').includes('.superz/')) {
          // Already in .gitignore
        } else {
          gitignore = readFileSync(gitignorePath, 'utf-8');
          writeFileSync(gitignorePath, `${gitignore.trimEnd()}\n.superz/\n`, 'utf-8');
        }
      } catch {
        // .gitignore doesn't exist or can't be read — create it
        writeFileSync(gitignorePath, '.superz/\n', 'utf-8');
      }

      logger.success('Agent initialized', {
        path: targetPath,
        remote: info.remoteUrl || 'no remote',
        branch: info.branch,
        config: configPath,
      });

      console.log('');
      console.log(chalk.green('  ✔ Super Z Twin initialized in this repository'));
      console.log(chalk.dim(`    Repository: ${info.remoteUrl || targetPath}`));
      console.log(chalk.dim(`    Branch:     ${info.branch}`));
      console.log(chalk.dim(`    Config:     ${configPath}`));
      console.log('');
      console.log(chalk.cyan('  Next step:'));
      console.log(chalk.dim('    superz run   — Start the agent loop'));
      console.log('');

    } catch (err) {
      logger.error('Initialization failed', { error: err.message });
      process.exitCode = 1;
    }
  });

// ─── Run Command ─────────────────────────────────────────────────────────────

program
  .command('run')
  .description('Start the agent loop')
  .option('-v, --verbose', 'Enable verbose output', false)
  .option('--dry-run', 'Simulate without making changes', false)
  .action(async (opts) => {
    const logger = getLogger({ verbose: opts.verbose });

    if (!isOnboarded()) {
      console.error(chalk.yellow('⚠ Not onboarded yet. Run "superz onboard" first.'));
      process.exitCode = 1;
      return;
    }

    const config = loadConfig({ logger });
    logger.banner();
    logger.info('Starting Super Z Twin agent loop', {
      provider: config.provider.type,
      parallelism: config.agent.parallelism,
      risk: config.agent.riskTolerance,
      dryRun: opts.dryRun || false,
    });

    // Dynamically import the main SuperZTwin class
    try {
      const { SuperZTwin } = await import('../src/index.js');
      const agent = new SuperZTwin({ config, logger, dryRun: opts.dryRun });

      // Handle graceful shutdown
      const shutdown = async (signal) => {
        logger.info(`Received ${signal} — shutting down gracefully...`);
        await agent.stop();
        process.exit(0);
      };
      process.on('SIGINT', () => shutdown('SIGINT'));
      process.on('SIGTERM', () => shutdown('SIGTERM'));

      await agent.start();

    } catch (err) {
      logger.error('Agent failed to start', { error: err.message, stack: err.stack });
      console.error(chalk.red('\n  Failed to start agent. Check logs for details.\n'));
      process.exitCode = 1;
    }
  });

// ─── Status Command ──────────────────────────────────────────────────────────

program
  .command('status')
  .description('Show current agent state and configuration')
  .option('-v, --verbose', 'Show detailed configuration', false)
  .action(async (opts) => {
    const logger = getLogger();

    if (!isOnboarded()) {
      console.log(chalk.yellow('\n  ⚠ Not onboarded yet. Run "superz onboard" to get started.\n'));
      return;
    }

    const config = loadConfig({ logger });
    const repoInfo = isGitRepo() ? getRepoInfo() : null;

    console.log('');
    console.log(chalk.cyan.bold('  ╔═══════════════════════════════════════════╗'));
    console.log(chalk.cyan.bold('  ║') + chalk.white.bold('   SUPER Z TWIN — Agent Status          ') + chalk.cyan.bold('║'));
    console.log(chalk.cyan.bold('  ╚═══════════════════════════════════════════╝'));
    console.log('');

    // Provider info
    console.log(chalk.bold('  Provider:'));
    console.log(`    Type:     ${chalk.green(config.provider.type)}`);
    console.log(`    Model:    ${chalk.dim(config.provider.model || 'default')}`);
    console.log(`    Base URL: ${chalk.dim(config.provider.baseUrl || 'default')}`);
    console.log(`    API Key:  ${config.provider.apiKey ? chalk.green('●●●●●●●●') : chalk.red('not set')}`);
    console.log('');

    // Agent settings
    console.log(chalk.bold('  Agent:'));
    console.log(`    Name:           ${chalk.white(config.agent.name)}`);
    console.log(`    Parallelism:    ${chalk.white(String(config.agent.parallelism))}`);
    console.log(`    Risk Tolerance: ${chalk.white(config.agent.riskTolerance)}`);
    console.log(`    Auto-commit:    ${config.agent.autoCommit ? chalk.green('enabled') : chalk.red('disabled')}`);
    console.log(`    Auto-push:      ${config.agent.autoPush ? chalk.green('enabled') : chalk.red('disabled')}`);
    console.log('');

    // Repo info
    if (repoInfo) {
      console.log(chalk.bold('  Repository:'));
      console.log(`    Path:    ${chalk.dim(repoInfo.repoRoot)}`);
      console.log(`    Remote:  ${chalk.dim(repoInfo.remoteUrl || 'none')}`);
      console.log(`    Branch:  ${chalk.green(repoInfo.branch)}`);
      console.log(`    Commit:  ${chalk.dim(repoInfo.shortHash)}`);
      console.log(`    Status:  ${repoInfo.isClean ? chalk.green('clean') : chalk.yellow('has changes')}`);
    } else {
      console.log(chalk.bold('  Repository:'));
      console.log(`    ${chalk.dim('Not initialized in a git repo. Run "superz init <path>"')}`);
    }
    console.log('');

    // Preferences
    if (opts.verbose) {
      console.log(chalk.bold('  Preferences:'));
      console.log(`    Languages:     ${chalk.white(config.preferences.languages.join(', '))}`);
      console.log(`    Documentation: ${chalk.white(config.preferences.documentation)}`);
      console.log(`    Code Style:    ${chalk.white(config.preferences.codeStyle)}`);
      console.log('');

      console.log(chalk.bold('  Paths:'));
      console.log(`    Config:  ${chalk.dim(config.paths.configDir)}`);
      console.log(`    Logs:    ${chalk.dim(config.paths.logsDir)}`);
      console.log(`    Cache:   ${chalk.dim(config.paths.cacheDir)}`);
      console.log('');
    }
  });

// ─── Configure Command ───────────────────────────────────────────────────────

program
  .command('configure')
  .description('Reconfigure API provider and settings')
  .action(async () => {
    const logger = getLogger();

    if (!isOnboarded()) {
      console.error(chalk.yellow('⚠ Not onboarded yet. Run "superz onboard" first.'));
      process.exitCode = 1;
      return;
    }

    try {
      const result = await runOnboarding({ reconfigure: true });
      if (!result.success) {
        process.exitCode = 1;
      }
    } catch (err) {
      logger.error('Reconfiguration failed', { error: err.message });
      process.exitCode = 1;
    }
  });

// ─── Parse ───────────────────────────────────────────────────────────────────

program.parse(process.argv);
