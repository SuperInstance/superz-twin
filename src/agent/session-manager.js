/**
 * @module session-manager
 * @description Session management for the SuperZ Twin agent.
 *
 * Manages work sessions with start/end/pause/resume semantics,
 * periodic auto-save to ~/.superz/sessions/, and session history.
 * Sessions capture the full operational state of the agent for
 * crash recovery and audit purposes.
 */

import { EventEmitter } from 'node:events';
import {
  mkdir,
  writeFile,
  readFile,
  readdir,
  stat,
  rm,
  copyFile,
} from 'node:fs/promises';
import { join, resolve, homedir } from 'node:path';
import { randomUUID } from 'node:crypto';

// ---------------------------------------------------------------------------
// Session States
// ---------------------------------------------------------------------------

/** @enum {string} */
export const SessionState = Object.freeze({
  ACTIVE: 'active',
  PAUSED: 'paused',
  ENDED: 'ended',
  ARCHIVED: 'archived',
});

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SUPERZ_DIR = join(homedir(), '.superz');
const SESSIONS_DIR = join(SUPERZ_DIR, 'sessions');
const HISTORY_FILE = join(SUPERZ_DIR, 'session-history.json');

// ---------------------------------------------------------------------------
// SessionManager
// ---------------------------------------------------------------------------

/**
 * Manages agent work sessions with persistence, pause/resume, and history.
 *
 * Events:
 *   - `session:started`  (session)
 *   - `session:paused`   (session)
 *   - `session:resumed`  (session)
 *   - `session:ended`    (session, report)
 *   - `session:restored` (session)
 *   - `session:saved`    (sessionId, filePath)
 *   - `error`            (error)
 */
export class SessionManager extends EventEmitter {
  /**
   * @param {object} [options]
   * @param {string} [options.baseDir] — Override session storage directory
   */
  constructor({ baseDir } = {}) {
    super();

    this.baseDir = baseDir ?? SESSIONS_DIR;
    this.historyFile = baseDir ? join(baseDir, '..', 'session-history.json') : HISTORY_FILE;

    /** @type {Map<string, object>} Active sessions keyed by ID */
    this._sessions = new Map();

    /** @type {number|null} Auto-save interval handle */
    this._autoSaveHandle = null;

    /** @type {number} Auto-save interval in ms */
    this._autoSaveIntervalMs = 30_000; // 30 seconds

    /** @type {Array<object>} Session history log */
    this._history = [];
  }

  // -----------------------------------------------------------------------
  // Initialization
  // -----------------------------------------------------------------------

  /**
   * Initialize the session manager — ensure directories exist and load history.
   * @returns {Promise<void>}
   */
  async init() {
    await mkdir(this.baseDir, { recursive: true });
    await mkdir(SUPERZ_DIR, { recursive: true });

    // Load session history
    try {
      const historyData = await readFile(this.historyFile, 'utf-8');
      this._history = JSON.parse(historyData);
    } catch {
      // No history file yet — start fresh
      this._history = [];
    }
  }

  // -----------------------------------------------------------------------
  // Start Session
  // -----------------------------------------------------------------------

  /**
   * Begin a new work session.
   *
   * @param {object} config
   * @param {string} [config.name] — Human-readable session name
   * @param {string} [config.description] — Session description
   * @param {object} [config.goals] — Session goals/objectives
   * @param {string} [config.repository] — Target repository URL
   * @param {string} [config.branch] — Target branch
   * @param {object} [config.metadata] — Additional metadata
   * @returns {Promise<object>} The new session object
   */
  async startSession(config = {}) {
    const sessionId = randomUUID();
    const now = Date.now();

    const session = {
      id: sessionId,
      name: config.name ?? `Session ${now}`,
      description: config.description ?? '',
      state: SessionState.ACTIVE,
      goals: config.goals ?? {},
      repository: config.repository ?? '',
      branch: config.branch ?? '',
      metadata: config.metadata ?? {},

      // Timestamps
      startedAt: now,
      updatedAt: now,
      pausedAt: null,
      resumedAt: null,
      endedAt: null,

      // Operational state
      tasksCompleted: 0,
      tasksFailed: 0,
      ticksExecuted: 0,
      pullRequestsCreated: 0,
      filesModified: [],

      // Snapshots (for pause/resume)
      snapshot: null,
    };

    this._sessions.set(sessionId, session);
    this._addToHistory(session);

    // Persist immediately
    await this._persistSession(session);

    this.emit('session:started', session);
    return session;
  }

  // -----------------------------------------------------------------------
  // End Session
  // -----------------------------------------------------------------------

  /**
   * Finalize a session and generate a summary report.
   *
   * @param {string} sessionId
   * @param {object} [options]
   * @param {string} [options.summary] — Optional human-written summary
   * @param {boolean} [options.archive=true] — Move to archive after ending
   * @returns {Promise<object>} End-of-session report
   */
  async endSession(sessionId, { summary, archive = true } = {}) {
    const session = this._getSession(sessionId);

    if (session.state === SessionState.ENDED) {
      throw new Error(`Session ${sessionId} is already ended`);
    }

    const now = Date.now();
    session.state = SessionState.ENDED;
    session.endedAt = now;
    session.updatedAt = now;

    if (this._autoSaveHandle && this._sessions.size === 0) {
      clearInterval(this._autoSaveHandle);
      this._autoSaveHandle = null;
    }

    // Generate report
    const duration = now - session.startedAt;
    const report = {
      sessionId: session.id,
      name: session.name,
      description: session.description,
      summary: summary ?? this._generateSessionSummary(session),
      duration,
      durationHuman: this._formatDuration(duration),
      startedAt: new Date(session.startedAt).toISOString(),
      endedAt: new Date(now).toISOString(),

      metrics: {
        tasksCompleted: session.tasksCompleted,
        tasksFailed: session.tasksFailed,
        successRate: session.tasksCompleted + session.tasksFailed > 0
          ? Math.round((session.tasksCompleted / (session.tasksCompleted + session.tasksFailed)) * 100) / 100
          : 0,
        ticksExecuted: session.ticksExecuted,
        pullRequestsCreated: session.pullRequestsCreated,
        filesModified: session.filesModified.length,
      },

      goals: session.goals,
      repository: session.repository,
      branch: session.branch,
    };

    // Save report alongside session
    await this._persistSession(session);
    await this._writeSessionReport(sessionId, report);

    // Update history
    this._updateHistory(sessionId, {
      state: SessionState.ENDED,
      endedAt: now,
      report,
    });

    if (archive) {
      await this._archiveSession(sessionId);
      session.state = SessionState.ARCHIVED;
    }

    this.emit('session:ended', session, report);
    return report;
  }

  // -----------------------------------------------------------------------
  // Pause / Resume
  // -----------------------------------------------------------------------

  /**
   * Pause an active session. Saves state for later resume.
   *
   * @param {string} sessionId
   * @returns {Promise<object>} Paused session state
   */
  async pauseSession(sessionId) {
    const session = this._getSession(sessionId);

    if (session.state !== SessionState.ACTIVE) {
      throw new Error(`Cannot pause session in state ${session.state}`);
    }

    session.state = SessionState.PAUSED;
    session.pausedAt = Date.now();
    session.updatedAt = Date.now();

    // Save snapshot for resume
    session.snapshot = {
      taskQueueSize: 0,
      activeTasks: [],
      metrics: {
        tasksCompleted: session.tasksCompleted,
        tasksFailed: session.tasksFailed,
        ticksExecuted: session.ticksExecuted,
      },
    };

    await this._persistSession(session);
    this._updateHistory(sessionId, { state: SessionState.PAUSED, pausedAt: session.pausedAt });

    this.emit('session:paused', session);
    return session;
  }

  /**
   * Resume a paused session.
   *
   * @param {string} sessionId
   * @returns {Promise<object>} Resumed session
   */
  async resumeSession(sessionId) {
    const session = this._getSession(sessionId);

    if (session.state !== SessionState.PAUSED) {
      throw new Error(`Cannot resume session in state ${session.state}`);
    }

    session.state = SessionState.ACTIVE;
    session.resumedAt = Date.now();
    session.updatedAt = Date.now();

    await this._persistSession(session);
    this._updateHistory(sessionId, { state: SessionState.ACTIVE, resumedAt: session.resumedAt });

    this.emit('session:resumed', session);
    return session;
  }

  // -----------------------------------------------------------------------
  // Auto-Save
  // -----------------------------------------------------------------------

  /**
   * Enable periodic auto-save of all active sessions.
   *
   * @param {number} [intervalMs=30000] — Auto-save interval in milliseconds
   * @returns {void}
   */
  autoSave(intervalMs) {
    this._autoSaveIntervalMs = intervalMs ?? this._autoSaveIntervalMs;

    if (this._autoSaveHandle) {
      clearInterval(this._autoSaveHandle);
    }

    this._autoSaveHandle = setInterval(async () => {
      try {
        await this._saveAllSessions();
      } catch (err) {
        this.emit('error', err);
      }
    }, this._autoSaveIntervalMs);
  }

  /**
   * Stop auto-save.
   * @returns {void}
   */
  stopAutoSave() {
    if (this._autoSaveHandle) {
      clearInterval(this._autoSaveHandle);
      this._autoSaveHandle = null;
    }
  }

  // -----------------------------------------------------------------------
  // Restore Session
  // -----------------------------------------------------------------------

  /**
   * Restore a session from saved state on disk.
   *
   * @param {string} sessionId
   * @returns {Promise<object>} Restored session
   */
  async restoreSession(sessionId) {
    const filePath = join(this.baseDir, `${sessionId}.json`);
    let data;

    try {
      const raw = await readFile(filePath, 'utf-8');
      data = JSON.parse(raw);
    } catch {
      // Try archive
      const archivePath = join(this.baseDir, 'archive', `${sessionId}.json`);
      try {
        const raw = await readFile(archivePath, 'utf-8');
        data = JSON.parse(raw);
      } catch {
        throw new Error(`Session ${sessionId} not found on disk`);
      }
    }

    // Validate session data
    if (!data.id || !data.startedAt) {
      throw new Error(`Invalid session data for ${sessionId}`);
    }

    // Restore to active state if it was paused
    if (data.state === SessionState.PAUSED) {
      data.state = SessionState.PAUSED; // Keep paused — caller must resume
    } else if (data.state === SessionState.ENDED || data.state === SessionState.ARCHIVED) {
      data.state = SessionState.ARCHIVED;
    } else {
      data.state = SessionState.ACTIVE;
    }

    data.updatedAt = Date.now();
    this._sessions.set(sessionId, data);

    this.emit('session:restored', data);
    return data;
  }

  // -----------------------------------------------------------------------
  // Session History
  // -----------------------------------------------------------------------

  /**
   * List all past sessions from history.
   *
   * @param {object} [options]
   * @param {number} [options.limit=50] — Max sessions to return
   * @param {string} [options.state] — Filter by state
   * @returns {Promise<Array<object>>}
   */
  async sessionHistory({ limit = 50, state } = {}) {
    let sessions = [...this._history];

    if (state) {
      sessions = sessions.filter((s) => s.state === state);
    }

    // Sort by most recent first
    sessions.sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));

    return sessions.slice(0, limit);
  }

  // -----------------------------------------------------------------------
  // Session State Access
  // -----------------------------------------------------------------------

  /**
   * Get the current session state by ID.
   * @param {string} sessionId
   * @returns {object|null}
   */
  getSessionState(sessionId) {
    return this._sessions.get(sessionId) ?? null;
  }

  /**
   * Get all active sessions.
   * @returns {object[]}
   */
  getActiveSessions() {
    return Array.from(this._sessions.values()).filter(
      (s) => s.state === SessionState.ACTIVE || s.state === SessionState.PAUSED
    );
  }

  /**
   * Update a session's operational metrics.
   * @param {string} sessionId
   * @param {object} updates — Partial updates to merge
   * @returns {Promise<void>}
   */
  async updateSession(sessionId, updates) {
    const session = this._getSession(sessionId);
    Object.assign(session, updates, { updatedAt: Date.now() });
    await this._persistSession(session);
  }

  // -----------------------------------------------------------------------
  // Private: Persistence
  // -----------------------------------------------------------------------

  /**
   * Persist a single session to disk.
   * @param {object} session
   * @returns {Promise<void>}
   * @private
   */
  async _persistSession(session) {
    const filePath = join(this.baseDir, `${session.id}.json`);
    const data = JSON.stringify(session, null, 2);
    await writeFile(filePath, data, 'utf-8');
    this.emit('session:saved', session.id, filePath);
  }

  /**
   * Save all active sessions to disk.
   * @returns {Promise<void>}
   * @private
   */
  async _saveAllSessions() {
    const saves = [];
    for (const session of this._sessions.values()) {
      if (session.state === SessionState.ACTIVE || session.state === SessionState.PAUSED) {
        saves.push(this._persistSession(session).catch(() => {}));
      }
    }
    await Promise.all(saves);
  }

  /**
   * Write a session report to disk.
   * @param {string} sessionId
   * @param {object} report
   * @returns {Promise<void>}
   * @private
   */
  async _writeSessionReport(sessionId, report) {
    const reportDir = join(this.baseDir, 'reports');
    await mkdir(reportDir, { recursive: true });
    const reportPath = join(reportDir, `${sessionId}.json`);
    await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf-8');
  }

  /**
   * Archive a session (move to archive directory).
   * @param {string} sessionId
   * @returns {Promise<void>}
   * @private
   */
  async _archiveSession(sessionId) {
    const srcPath = join(this.baseDir, `${sessionId}.json`);
    const archiveDir = join(this.baseDir, 'archive');
    await mkdir(archiveDir, { recursive: true });
    const destPath = join(archiveDir, `${sessionId}.json`);
    await copyFile(srcPath, destPath).catch(() => {});
    await rm(srcPath, { force: true }).catch(() => {});
  }

  // -----------------------------------------------------------------------
  // Private: History Management
  // -----------------------------------------------------------------------

  /**
   * Add a session to the history log.
   * @param {object} session
   * @private
   */
  _addToHistory(session) {
    this._history.push({
      id: session.id,
      name: session.name,
      description: session.description,
      state: session.state,
      startedAt: session.startedAt,
      repository: session.repository,
      branch: session.branch,
    });
    this._persistHistory();
  }

  /**
   * Update a history entry.
   * @param {string} sessionId
   * @param {object} updates
   * @private
   */
  _updateHistory(sessionId, updates) {
    const entry = this._history.find((h) => h.id === sessionId);
    if (entry) {
      Object.assign(entry, updates);
    }
    this._persistHistory();
  }

  /**
   * Persist history to disk.
   * @private
   */
  async _persistHistory() {
    try {
      await mkdir(SUPERZ_DIR, { recursive: true });
      await writeFile(this.historyFile, JSON.stringify(this._history, null, 2), 'utf-8');
    } catch (err) {
      this.emit('error', new Error(`Failed to persist history: ${err.message}`));
    }
  }

  // -----------------------------------------------------------------------
  // Private: Utilities
  // -----------------------------------------------------------------------

  /**
   * Get or throw on missing session.
   * @param {string} sessionId
   * @returns {object}
   * @private
   */
  _getSession(sessionId) {
    const session = this._sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found. Active sessions: ${[...this._sessions.keys()].join(', ')}`);
    }
    return session;
  }

  /**
   * Generate a human-readable session summary.
   * @param {object} session
   * @returns {string}
   * @private
   */
  _generateSessionSummary(session) {
    const total = session.tasksCompleted + session.tasksFailed;
    const rate = total > 0 ? Math.round((session.tasksCompleted / total) * 100) : 0;
    return (
      `Session "${session.name}": ${session.tasksCompleted}/${total} tasks completed ` +
      `(${rate}% success rate), ${session.pullRequestsCreated} PRs created, ` +
      `${session.filesModified.length} files modified over ${session.ticksExecuted} ticks.`
    );
  }

  /**
   * Format a duration in ms to a human-readable string.
   * @param {number} ms
   * @returns {string}
   * @private
   */
  _formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  }
}

export default SessionManager;
