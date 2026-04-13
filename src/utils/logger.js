/**
 * @module logger
 * @description Structured logging system with color-coded output levels,
 *              file logging, and optional verbose mode. Produces clean
 *              console output and persistent logs in ~/.superz/logs/.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import chalk from 'chalk';

/** @typedef {'debug' | 'info' | 'warn' | 'error' | 'success'} LogLevel */

/** Log level numeric priorities (higher = more severe) */
const LEVEL_PRIORITY = { debug: 0, info: 1, warn: 2, error: 3, success: 1 };

/** Chalk style map per level */
const LEVEL_STYLE = {
  debug: chalk.gray.dim,
  info: chalk.blue,
  warn: chalk.yellow,
  error: chalk.red.bold,
  success: chalk.green,
};

/** Log prefix icons per level */
const LEVEL_ICON = {
  debug: '🔍',
  info: 'ℹ️ ',
  warn: '⚠️ ',
  error: '✖',
  success: '✔',
};

/**
 * Format a ISO timestamp as a compact, human-readable string.
 * @param {Date} [date] — The date to format (defaults to now).
 * @returns {string} Formatted timestamp like "2025-01-15 09:30:05"
 */
function formatTimestamp(date = new Date()) {
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');
  const s = String(date.getSeconds()).padStart(2, '0');
  return `${y}-${mo}-${d} ${h}:${mi}:${s}`;
}

/**
 * Ensure the log directory exists. Creates it recursively if missing.
 * @param {string} logDir — Absolute path to the log directory.
 */
function ensureLogDir(logDir) {
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
}

/**
 * Appends a raw log line to the daily log file.
 * @param {string} logDir — Log directory path.
 * @param {string} level — Log level string.
 * @param {string} message — Log message.
 * @param {object} [meta] — Optional structured metadata.
 */
function writeToFile(logDir, level, message, meta) {
  try {
    ensureLogDir(logDir);
    const date = new Date();
    const fileDate = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const logFile = path.join(logDir, `superz-${fileDate}.log`);

    const entry = {
      timestamp: date.toISOString(),
      level,
      message,
      ...(meta && Object.keys(meta).length > 0 ? { meta } : {}),
    };

    fs.appendFileSync(logFile, JSON.stringify(entry) + '\n');
  } catch {
    // Silent fail — logging should never crash the agent
  }
}

class Logger {
  /**
   * Create a new Logger instance.
   * @param {object} [opts]
   * @param {LogLevel} [opts.level='info'] — Minimum log level to display.
   * @param {boolean} [opts.verbose=false] — Enable verbose (debug) output.
   * @param {string} [opts.context='superz'] — Logging context / module label.
   * @param {string|null} [opts.logDir=null] — Directory for log files. Defaults to ~/.superz/logs/.
   * @param {boolean} [opts.fileLogging=true] — Whether to write logs to disk.
   */
  constructor({
    level = 'info',
    verbose = false,
    context = 'superz',
    logDir = null,
    fileLogging = true,
  } = {}) {
    /** @type {LogLevel} */
    this.level = verbose ? 'debug' : level;
    this.verbose = verbose;
    this.context = context;
    this.fileLogging = fileLogging;
    this.logDir = logDir || path.join(os.homedir(), '.superz', 'logs');
    this._childCounters = new Map();
  }

  /**
   * Create a child logger with a specific sub-context.
   * @param {string} subContext — Sub-context label (e.g., "git", "config").
   * @returns {Logger} New child Logger instance.
   */
  child(subContext) {
    const count = this._childCounters.get(subContext) || 0;
    this._childCounters.set(subContext, count + 1);
    return new Logger({
      level: this.level,
      verbose: this.verbose,
      context: `${this.context}:${subContext}`,
      logDir: this.logDir,
      fileLogging: this.fileLogging,
    });
  }

  /**
   * Set the minimum log level.
   * @param {LogLevel} newLevel — New minimum log level.
   */
  setLevel(newLevel) {
    this.level = newLevel;
  }

  /**
   * Enable or disable verbose mode.
   * @param {boolean} enabled
   */
  setVerbose(enabled) {
    this.verbose = enabled;
    if (enabled) this.level = 'debug';
  }

  /**
   * Core logging method. Formats and emits a log entry.
   * @param {LogLevel} level — Log level.
   * @param {string} message — Log message.
   * @param {object} [meta] — Optional structured metadata.
   */
  _log(level, message, meta) {
    if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[this.level]) return;

    const timestamp = formatTimestamp();
    const style = LEVEL_STYLE[level] || chalk.white;
    const icon = LEVEL_ICON[level] || '';
    const levelTag = `[${level.toUpperCase()}]`;

    // Console output
    const prefix = style(`${icon} ${timestamp} ${levelTag}`);
    const ctx = chalk.dim(`(${this.context})`);
    const formatted = `${prefix} ${ctx} ${message}`;

    if (level === 'error') {
      console.error(formatted);
    } else {
      console.log(formatted);
    }

    // Print metadata on next line if present
    if (meta && Object.keys(meta).length > 0 && this.verbose) {
      console.log(chalk.dim('  └', JSON.stringify(meta, null, 2)));
    }

    // File logging
    if (this.fileLogging) {
      writeToFile(this.logDir, level, message, meta);
    }
  }

  /** Log a debug message. @param {string} msg @param {object} [meta] */
  debug(msg, meta) { this._log('debug', msg, meta); }

  /** Log an info message. @param {string} msg @param {object} [meta] */
  info(msg, meta) { this._log('info', msg, meta); }

  /** Log a warning message. @param {string} msg @param {object} [meta] */
  warn(msg, meta) { this._log('warn', msg, meta); }

  /** Log an error message. @param {string} msg @param {object} [meta] */
  error(msg, meta) { this._log('error', msg, meta); }

  /** Log a success message. @param {string} msg @param {object} [meta] */
  success(msg, meta) { this._log('success', msg, meta); }

  /**
   * Create a visual section separator in log output.
   * @param {string} [title] — Optional section title.
   */
  section(title) {
    const line = chalk.dim('─'.repeat(60));
    if (title) {
      console.log(`\n${line}`);
      console.log(chalk.bold.cyan(`  ${title}`));
      console.log(`${line}\n`);
    } else {
      console.log(line);
    }
  }

  /**
   * Display a branded banner for the agent.
   */
  banner() {
    console.log('');
    console.log(chalk.cyan.bold('  ╔═══════════════════════════════════════════╗'));
    console.log(chalk.cyan.bold('  ║') + chalk.white.bold('   ⚡ SUPER Z TWIN — Digital Git Agent  ') + chalk.cyan.bold('║'));
    console.log(chalk.cyan.bold('  ║') + chalk.dim('   FLUX-native cognition • Standalone    ') + chalk.cyan.bold('║'));
    console.log(chalk.cyan.bold('  ╚═══════════════════════════════════════════╝'));
    console.log('');
  }
}

/** Singleton logger instance used across the application. */
let _defaultLogger = null;

/**
 * Get the default singleton logger instance.
 * @param {object} [opts] — Options forwarded to Logger constructor (only on first call).
 * @returns {Logger} The default logger.
 */
export function getLogger(opts) {
  if (!_defaultLogger) {
    _defaultLogger = new Logger(opts);
  }
  return _defaultLogger;
}

/**
 * Reset the default logger (useful for testing).
 */
export function resetLogger() {
  _defaultLogger = null;
}

export { Logger };
export default Logger;
