/**
 * @module onboarding
 * @description Interactive onboarding system for Super Z Twin. Guides new users
 *              through provider selection, connection testing, preference
 *              configuration, and repo setup. Generates the config file at
 *              ~/.superz/config.yaml.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import inquirer from 'inquirer';
import chalk from 'chalk';
import ora from 'ora';
import { getLogger } from '../utils/logger.js';
import { loadConfig, saveConfig, getConfigDir } from '../config/index.js';
import { getProviderChoices, testProvider, buildProviderConfig } from './providers.js';

/**
 * ASCII art welcome banner displayed at the start of onboarding.
 * @type {string}
 */
const WELCOME_ART = `
${chalk.cyan.bold('  ████████╗███████╗██╗     ███████╗████████╗██╗ ██████╗ ███╗   ██╗')}
${chalk.cyan.bold('  ╚══██╔══╝██╔════╝██║     ██╔════╝╚══██╔══╝██║██╔═══██╗████╗  ██║')}
${chalk.cyan.bold('     ██║   █████╗  ██║     █████╗     ██║   ██║██║   ██║██╔██╗ ██║')}
${chalk.cyan.bold('     ██║   ██╔══╝  ██║     ██╔══╝     ██║   ██║██║   ██║██║╚██╗██║')}
${chalk.cyan.bold('     ██║   ███████╗███████╗███████╗   ██║   ██║╚██████╔╝██║ ╚████║')}
${chalk.cyan.bold('     ╚═╝   ╚══════╝╚══════╝╚══════╝   ╚═╝   ╚═╝╝╚════╝ ╚═╝  ╚═══╝')}
${chalk.white.bold('                     ⚡  D I G I T A L   T W I N  ⚡')}
`;

/**
 * Run the full interactive onboarding flow.
 * Guides the user through 6 steps and writes the config file.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.reconfigure=false] — Skip welcome if reconfiguring.
 * @returns {Promise<{ success: boolean, configPath: string|null }>}
 */
export async function runOnboarding({ reconfigure = false } = {}) {
  const logger = getLogger({ verbose: true });

  // ─── Welcome ─────────────────────────────────────────────────────────
  if (!reconfigure) {
    console.log(WELCOME_ART);
    console.log(chalk.white('  Welcome to the Super Z Twin setup wizard.\n'));
    console.log(chalk.dim('  This will configure your digital twin agent with an AI provider,'));
    console.log(chalk.dim('  working preferences, and a target repository.\n'));

    const { proceed } = await inquirer.prompt([{
      type: 'confirm',
      name: 'proceed',
      message: 'Ready to begin?',
      default: true,
    }]);
    if (!proceed) {
      console.log(chalk.yellow('\n  Onboarding cancelled. Run "superz onboard" anytime to restart.\n'));
      return { success: false, configPath: null };
    }
  }

  // ─── Step 1: Provider Selection ──────────────────────────────────────
  console.log('');
  logger.section('Step 1: Choose AI Provider');

  const providerChoices = getProviderChoices();
  const { providerType } = await inquirer.prompt([{
    type: 'list',
    name: 'providerType',
    message: 'Select your AI provider:',
    choices: providerChoices.map(p => ({
      name: `${p.name}  ${chalk.dim(`— ${p.description}`)}`,
      value: p.value,
      short: p.name,
    })),
  }]);

  const selectedProvider = providerChoices.find(p => p.value === providerType);
  console.log(chalk.dim(`  Selected: ${selectedProvider.name}\n`));

  // ─── Step 2: API Key / Proxy URL ─────────────────────────────────────
  logger.section('Step 2: Authentication');

  const answers = { providerType };

  if (providerType === 'proxy') {
    const { baseUrl } = await inquirer.prompt([{
      type: 'input',
      name: 'baseUrl',
      message: 'Proxy base URL:',
      validate: (v) => v.trim().length > 0 ? true : 'URL is required',
    }]);
    answers.baseUrl = baseUrl.trim().replace(/\/+$/, '');

    const { proxyApiKey } = await inquirer.prompt([{
      type: 'input',
      name: 'proxyApiKey',
      message: 'API key (leave empty if not required):',
      default: '',
    }]);
    answers.apiKey = proxyApiKey || null;

  } else {
    const { apiKey } = await inquirer.prompt([{
      type: 'password',
      name: 'apiKey',
      message: `Enter your ${selectedProvider.name} API key:`,
      mask: '*',
      validate: (v) => v.trim().length > 0 ? true : 'API key is required',
    }]);
    answers.apiKey = apiKey.trim();

    const { customBase } = await inquirer.prompt([{
      type: 'input',
      name: 'customBase',
      message: 'Custom base URL (leave empty for default):',
      default: '',
    }]);
    answers.baseUrl = customBase.trim() || null;
  }

  // ─── Step 3: Test Connection ─────────────────────────────────────────
  logger.section('Step 3: Connection Test');

  const spinner = ora('Testing provider connection...').start();
  const result = await testProvider({
    type: providerType,
    apiKey: answers.apiKey,
    baseUrl: answers.baseUrl,
    timeout: 15_000,
    logger,
  });

  if (result.success) {
    spinner.succeed(chalk.green(result.message));
    if (result.capabilities) {
      if (result.capabilities.models) {
        console.log(chalk.dim(`  Available models: ${result.capabilities.models.slice(0, 5).join(', ')}...`));
      }
    }
  } else {
    spinner.fail(chalk.red(result.message));
    const { continueAnyway } = await inquirer.prompt([{
      type: 'confirm',
      name: 'continueAnyway',
      message: 'Connection test failed. Continue anyway?',
      default: false,
    }]);
    if (!continueAnyway) {
      console.log(chalk.yellow('\n  Onboarding cancelled. Check your credentials and try again.\n'));
      return { success: false, configPath: null };
    }
  }
  console.log('');

  // ─── Step 4: Working Preferences ─────────────────────────────────────
  logger.section('Step 4: Working Preferences');

  const { parallelism } = await inquirer.prompt([{
    type: 'list',
    name: 'parallelism',
    message: 'Max concurrent tasks (parallelism):',
    choices: [
      { name: 'Conservative (1-2 tasks)', value: 2 },
      { name: 'Balanced (3-5 tasks)', value: 3 },
      { name: 'Aggressive (6-10 tasks)', value: 6 },
      { name: 'Maximum (10+ tasks)', value: 10 },
    ],
    default: 1,
  }]);

  const { riskTolerance } = await inquirer.prompt([{
    type: 'list',
    name: 'riskTolerance',
    message: 'Risk tolerance for code changes:',
    choices: [
      { name: 'Conservative — Ask before every change', value: 'conservative' },
      { name: 'Balanced — Confirm on significant changes', value: 'balanced' },
      { name: 'Aggressive — Autonomous with minimal prompts', value: 'aggressive' },
    ],
    default: 1,
  }]);

  const { languages } = await inquirer.prompt([{
    type: 'checkbox',
    name: 'languages',
    message: 'Preferred programming languages:',
    choices: [
      'javascript', 'typescript', 'python', 'rust', 'go', 'java',
      'csharp', 'cpp', 'ruby', 'php', 'swift', 'kotlin',
    ],
    default: ['javascript', 'typescript'],
  }]);

  const { autoCommit, autoPush } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'autoCommit',
      message: 'Auto-commit changes after tasks?',
      default: true,
    },
    {
      type: 'confirm',
      name: 'autoPush',
      message: 'Auto-push commits to remote?',
      default: false,
    },
  ]);

  // ─── Step 5: Target Repository ───────────────────────────────────────
  logger.section('Step 5: Target Repository');

  const { repoAction } = await inquirer.prompt([{
    type: 'list',
    name: 'repoAction',
    message: 'How would you like to set up the target repository?',
    choices: [
      { name: 'Use current directory', value: 'current' },
      { name: 'Clone from URL', value: 'clone' },
      { name: 'Set up later', value: 'later' },
    ],
  }]);

  let targetRepo = null;

  if (repoAction === 'current') {
    targetRepo = process.cwd();
    console.log(chalk.dim(`  Using: ${targetRepo}`));
  } else if (repoAction === 'clone') {
    const { repoUrl } = await inquirer.prompt([{
      type: 'input',
      name: 'repoUrl',
      message: 'Repository URL to clone:',
      validate: (v) => v.trim().length > 0 ? true : 'Repository URL is required',
    }]);

    const { cloneDir } = await inquirer.prompt([{
      type: 'input',
      name: 'cloneDir',
      message: 'Clone destination directory:',
      default: path.join(os.homedir(), 'superz-workspace'),
    }]);

    console.log('');
    const cloneSpinner = ora(`Cloning ${repoUrl}...`).start();
    try {
      if (!fs.existsSync(cloneDir)) {
        fs.mkdirSync(cloneDir, { recursive: true });
      }
      execSync(`git clone ${repoUrl.trim()} ${path.join(cloneDir, path.basename(repoUrl.trim(), '.git'))}`, {
        stdio: 'pipe',
        timeout: 60_000,
      });
      targetRepo = path.join(cloneDir, path.basename(repoUrl.trim(), '.git'));
      cloneSpinner.succeed(chalk.green(`Cloned to ${targetRepo}`));
    } catch (err) {
      cloneSpinner.fail(chalk.red(`Clone failed: ${err.message}`));
      targetRepo = null;
    }
  } else {
    console.log(chalk.dim('  You can set up a repository later with "superz init <path>".'));
  }

  // ─── Step 6: Generate Config ─────────────────────────────────────────
  logger.section('Step 6: Save Configuration');

  const providerConfig = buildProviderConfig(answers);
  const fullConfig = {
    version: '0.1.0',
    provider: providerConfig,
    agent: {
      name: 'Super Z',
      parallelism,
      riskTolerance,
      autoCommit,
      autoPush,
      branchPrefix: 'superz/',
      commitStyle: 'conventional',
      maxRetries: 3,
      timeout: 120_000,
    },
    preferences: {
      languages: languages.length > 0 ? languages : ['javascript', 'typescript'],
      frameworks: [],
      codeStyle: 'clean',
      testFirst: false,
      documentation: 'standard',
      verbose: false,
    },
    paths: {
      configDir: getConfigDir(),
      logsDir: path.join(getConfigDir(), 'logs'),
      cacheDir: path.join(getConfigDir(), 'cache'),
    },
    ...(targetRepo ? { repo: { path: targetRepo } } : {}),
  };

  const saveSpinner = ora('Writing configuration...').start();

  try {
    const { path: configPath } = saveConfig(fullConfig);

    // Ensure log/cache directories exist
    for (const dir of [fullConfig.paths.logsDir, fullConfig.paths.cacheDir]) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }

    saveSpinner.succeed(chalk.green(`Configuration saved to ${configPath}`));
  } catch (err) {
    saveSpinner.fail(chalk.red(`Failed to save config: ${err.message}`));
    return { success: false, configPath: null };
  }

  // ─── Success ─────────────────────────────────────────────────────────
  console.log('');
  console.log(chalk.green.bold('  ✅ Onboarding complete!\n'));
  console.log(chalk.white('  Your Super Z Twin is configured and ready.'));
  console.log('');
  console.log(chalk.cyan('  Quick start:'));
  console.log(chalk.dim('    superz init <repo>   — Initialize agent in a repository'));
  console.log(chalk.dim('    superz run           — Start the agent loop'));
  console.log(chalk.dim('    superz status        — View current agent state'));
  console.log(chalk.dim('    superz configure     — Reconfigure settings'));
  console.log('');
  console.log(chalk.dim(`  Config: ${getConfigDir()}/config.yaml`));
  console.log('');

  return { success: true, configPath: path.join(getConfigDir(), 'config.yaml') };
}
