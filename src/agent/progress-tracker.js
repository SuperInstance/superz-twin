/**
 * @module progress-tracker
 * @description Progress tracking for the SuperZ Twin agent.
 *
 * Records metrics, defines milestone checkpoints, generates structured
 * progress reports, and persists/restores state to disk.
 * Provides the observability layer for understanding agent performance
 * over time.
 */

import { EventEmitter } from 'node:events';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join, homedir } from 'node:path';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SUPERZ_DIR = join(homedir(), '.superz');
const METRICS_FILE = join(SUPERZ_DIR, 'metrics.json');

// ---------------------------------------------------------------------------
// Default Milestones
// ---------------------------------------------------------------------------

/** @type {Record<string, {description: string, condition: (metrics: object) => boolean, achieved?: boolean}>} */
const DEFAULT_MILESTONES = {
  first_task_completed: {
    description: 'First task successfully completed',
    condition: (metrics) => (metrics['agent.total_tasks_succeeded'] ?? 0) >= 1,
    achieved: false,
  },
  ten_tasks_completed: {
    description: 'Ten tasks successfully completed',
    condition: (metrics) => (metrics['agent.total_tasks_succeeded'] ?? 0) >= 10,
    achieved: false,
  },
  hundred_tasks_completed: {
    description: 'Hundred tasks successfully completed',
    condition: (metrics) => (metrics['agent.total_tasks_succeeded'] ?? 0) >= 100,
    achieved: false,
  },
  first_pr_created: {
    description: 'First pull request created',
    condition: (metrics) => (metrics['agent.total_prs_created'] ?? 0) >= 1,
    achieved: false,
  },
  ten_prs_created: {
    description: 'Ten pull requests created',
    condition: (metrics) => (metrics['agent.total_prs_created'] ?? 0) >= 10,
    achieved: false,
  },
  fifty_prs_created: {
    description: 'Fifty pull requests created',
    condition: (metrics) => (metrics['agent.total_prs_created'] ?? 0) >= 50,
    achieved: false,
  },
  zero_failure_streak: {
    description: '100 consecutive tasks without failure',
    condition: (metrics) => (metrics['agent.consecutive_successes'] ?? 0) >= 100,
    achieved: false,
  },
  uptime_one_hour: {
    description: 'Agent uptime exceeds 1 hour',
    condition: (metrics) => {
      const start = metrics['agent.loop_started_at'];
      if (!start) return false;
      return (Date.now() - start) >= 3_600_000;
    },
    achieved: false,
  },
  uptime_eight_hours: {
    description: 'Agent uptime exceeds 8 hours',
    condition: (metrics) => {
      const start = metrics['agent.loop_started_at'];
      if (!start) return false;
      return (Date.now() - start) >= 28_800_000;
    },
    achieved: false,
  },
  cross_language_analysis: {
    description: 'First cross-language analysis performed',
    condition: (metrics) => (metrics['flux.cross_language_analyses'] ?? 0) >= 1,
    achieved: false,
  },
  convergence_check: {
    description: 'First ISA convergence check performed',
    condition: (metrics) => (metrics['flux.convergence_checks'] ?? 0) >= 1,
    achieved: false,
  },
  first_fluxasm_generated: {
    description: 'First FLUX assembly generated',
    condition: (metrics) => (metrics['flux.asm_generated'] ?? 0) >= 1,
    achieved: false,
  },
};

// ---------------------------------------------------------------------------
// ProgressTracker
// ---------------------------------------------------------------------------

/**
 * Tracks agent progress through metrics and milestones.
 *
 * Events:
 *   - `metric:recorded`    (name, value)
 *   - `milestone:reached`  (milestoneId, milestone)
 *   - `milestone:reset`    (milestoneId)
 *   - `persisted`         (filePath)
 *   - `restored`          (filePath)
 *   - `report:generated`  (report)
 *   - `error`             (error)
 */
export class ProgressTracker extends EventEmitter {
  /**
   * @param {object} [options]
   * @param {string} [options.persistPath] — Override metrics persistence path
   * @param {Record<string, object>} [options.customMilestones] — Additional milestones
   */
  constructor({ persistPath, customMilestones } = {}) {
    super();

    this.persistPath = persistPath ?? METRICS_FILE;

    /** @type {Record<string, number|string|boolean>} All tracked metrics */
    this.metrics = {};

    /** @type {Record<string, {description: string, condition: function, achieved: boolean}>} Milestones */
    this.milestones = {
      ...DEFAULT_MILESTONES,
      ...(customMilestones ?? {}),
    };

    /** @type {Array<{timestamp: number, type: string, data: object}>} Event log */
    this.eventLog = [];

    /** @type {Map<string, number>} Metric history for trend analysis */
    this._metricHistory = new Map();

    /** @type {number} Maximum history entries per metric */
    this._maxHistoryPerMetric = 1000;
  }

  // -----------------------------------------------------------------------
  // Metric Tracking
  // -----------------------------------------------------------------------

  /**
   * Record a metric value.
   *
   * @param {string} name — Metric name (dot-separated namespace recommended)
   * @param {number|string|boolean} value — Metric value
   * @returns {void}
   *
   * @example
   * tracker.trackMetric('agent.total_tasks', 42);
   * tracker.trackMetric('git.prs_created', 7);
   * tracker.trackMetric('flux.asm_generated', 3);
   */
  trackMetric(name, value) {
    const previousValue = this.metrics[name];
    this.metrics[name] = value;

    // Track history
    if (!this._metricHistory.has(name)) {
      this._metricHistory.set(name, []);
    }
    const history = this._metricHistory.get(name);
    history.push({ timestamp: Date.now(), value });
    if (history.length > this._maxHistoryPerMetric) {
      history.shift(); // Remove oldest
    }

    // Track consecutive successes
    if (name === 'agent.total_tasks_succeeded' && typeof value === 'number') {
      this.metrics['agent.consecutive_successes'] = value;
    }
    if (name === 'agent.total_tasks_failed' && typeof value === 'number') {
      this.metrics['agent.consecutive_successes'] = 0;
    }

    // Log event
    this.eventLog.push({
      timestamp: Date.now(),
      type: 'metric',
      data: { name, value, previousValue },
    });

    this.emit('metric:recorded', name, value);

    // Check milestones after every metric update
    this._checkAllMilestones();
  }

  /**
   * Retrieve all current metrics.
   *
   * @returns {Record<string, number|string|boolean>}
   */
  getMetrics() {
    return { ...this.metrics };
  }

  /**
   * Get a single metric value.
   *
   * @param {string} name — Metric name
   * @returns {number|string|boolean|undefined}
   */
  getMetric(name) {
    return this.metrics[name];
  }

  /**
   * Get the history of a metric over time.
   *
   * @param {string} name — Metric name
   * @param {object} [options]
   * @param {number} [options.limit] — Max entries to return
   * @param {number} [options.since] — Only entries after this timestamp
   * @returns {Array<{timestamp: number, value: number|string|boolean}>}
   */
  getMetricHistory(name, { limit, since } = {}) {
    const history = this._metricHistory.get(name) ?? [];

    let filtered = history;
    if (since) {
      filtered = filtered.filter((entry) => entry.timestamp >= since);
    }

    if (limit) {
      filtered = filtered.slice(-limit);
    }

    return [...filtered];
  }

  /**
   * Get metrics organized by namespace prefix.
   *
   * @param {string} prefix — Namespace prefix (e.g., 'agent', 'git', 'flux')
   * @returns {Record<string, number|string|boolean>}
   */
  getMetricsByPrefix(prefix) {
    const result = {};
    const key = prefix.endsWith('.') ? prefix : `${prefix}.`;

    for (const [name, value] of Object.entries(this.metrics)) {
      if (name.startsWith(key)) {
        result[name] = value;
      }
    }

    return result;
  }

  // -----------------------------------------------------------------------
  // Milestone Management
  // -----------------------------------------------------------------------

  /**
   * Check if a specific milestone has been reached.
   * If it has just been reached, emit a `milestone:reached` event.
   *
   * @param {string} milestoneId — Milestone identifier
   * @returns {boolean} Whether the milestone is achieved
   */
  checkMilestone(milestoneId) {
    const milestone = this.milestones[milestoneId];
    if (!milestone) return false;

    const wasAchieved = milestone.achieved;
    const isAchieved = milestone.condition(this.metrics);

    if (isAchieved && !wasAchieved) {
      milestone.achieved = true;
      this.eventLog.push({
        timestamp: Date.now(),
        type: 'milestone',
        data: { milestoneId, action: 'reached' },
      });
      this.emit('milestone:reached', milestoneId, milestone);
      return true;
    }

    return isAchieved;
  }

  /**
   * Define a new milestone.
   *
   * @param {string} id — Unique milestone identifier
   * @param {string} description — Human-readable description
   * @param {function} condition — Function that takes metrics and returns boolean
   * @returns {void}
   */
  defineMilestone(id, description, condition) {
    this.milestones[id] = {
      description,
      condition,
      achieved: false,
    };
  }

  /**
   * Reset a milestone (mark as not achieved).
   *
   * @param {string} milestoneId
   * @returns {void}
   */
  resetMilestone(milestoneId) {
    const milestone = this.milestones[milestoneId];
    if (milestone) {
      milestone.achieved = false;
      this.eventLog.push({
        timestamp: Date.now(),
        type: 'milestone',
        data: { milestoneId, action: 'reset' },
      });
      this.emit('milestone:reset', milestoneId);
    }
  }

  /**
   * Get all milestones with their current status.
   *
   * @returns {Record<string, {description: string, achieved: boolean}>}
   */
  getMilestoneStatus() {
    const result = {};
    for (const [id, milestone] of Object.entries(this.milestones)) {
      result[id] = {
        description: milestone.description,
        achieved: milestone.achieved,
      };
    }
    return result;
  }

  /**
   * Get only achieved milestones.
   * @returns {Array<{id: string, description: string, achievedAt?: number}>}
   */
  getAchievedMilestones() {
    const achieved = [];
    for (const [id, milestone] of Object.entries(this.milestones)) {
      if (milestone.achieved) {
        // Find when it was achieved from event log
        const event = this.eventLog.find(
          (e) => e.type === 'milestone' && e.data.milestoneId === id && e.data.action === 'reached'
        );
        achieved.push({
          id,
          description: milestone.description,
          achievedAt: event?.timestamp,
        });
      }
    }
    return achieved;
  }

  // -----------------------------------------------------------------------
  // Progress Report Generation
  // -----------------------------------------------------------------------

  /**
   * Generate a structured progress report.
   *
   * @returns {object} Progress report
   */
  generateProgressReport() {
    const now = Date.now();
    const startTime = this.metrics['agent.loop_started_at'] ?? now;
    const uptime = now - startTime;

    const tasksSucceeded = this.metrics['agent.total_tasks_succeeded'] ?? 0;
    const tasksFailed = this.metrics['agent.total_tasks_failed'] ?? 0;
    const totalTasks = tasksSucceeded + tasksFailed;
    const successRate = totalTasks > 0 ? Math.round((tasksSucceeded / totalTasks) * 100) / 100 : 0;

    const totalTicks = this.metrics['agent.total_ticks'] ?? 0;
    const idleTicks = this.metrics['agent.idle_ticks'] ?? 0;
    const activeTicks = totalTicks - idleTicks;
    const utilizationRate = totalTicks > 0 ? Math.round((activeTicks / totalTicks) * 100) / 100 : 0;

    const achieved = this.getAchievedMilestones();
    const totalMilestones = Object.keys(this.milestones).length;

    const report = {
      generatedAt: new Date(now).toISOString(),
      uptime: {
        ms: uptime,
        human: this._formatDuration(uptime),
        startedAt: new Date(startTime).toISOString(),
      },

      taskMetrics: {
        total: totalTasks,
        succeeded: tasksSucceeded,
        failed: tasksFailed,
        successRate,
        consecutiveSuccesses: this.metrics['agent.consecutive_successes'] ?? 0,
      },

      agentMetrics: {
        totalTicks,
        idleTicks,
        activeTicks,
        utilizationRate,
        averageTasksPerTick: activeTicks > 0 ? Math.round((totalTasks / activeTicks) * 100) / 100 : 0,
      },

      gitMetrics: {
        prsCreated: this.metrics['agent.total_prs_created'] ?? 0,
        filesModified: this.metrics['agent.total_files_modified'] ?? 0,
      },

      fluxMetrics: {
        analysesPerformed: this.metrics['flux.cross_language_analyses'] ?? 0,
        convergenceChecks: this.metrics['flux.convergence_checks'] ?? 0,
        asmGenerated: this.metrics['flux.asm_generated'] ?? 0,
      },

      milestones: {
        achieved: achieved.length,
        total: totalMilestones,
        percentage: Math.round((achieved.length / totalMilestones) * 100),
        list: achieved,
      },

      recentEvents: this.eventLog.slice(-20),
    };

    this.emit('report:generated', report);
    return report;
  }

  /**
   * Generate a human-readable summary string.
   * @returns {string}
   */
  generateSummary() {
    const report = this.generateProgressReport();
    const lines = [];

    lines.push('═══ Super Z Twin — Progress Report ═══');
    lines.push(`Uptime: ${report.uptime.human}`);
    lines.push('');
    lines.push('Tasks:');
    lines.push(`  Total: ${report.taskMetrics.total} (✓ ${report.taskMetrics.succeeded} | ✗ ${report.taskMetrics.failed})`);
    lines.push(`  Success Rate: ${(report.taskMetrics.successRate * 100).toFixed(1)}%`);
    if (report.taskMetrics.consecutiveSuccesses > 0) {
      lines.push(`  Consecutive Successes: ${report.taskMetrics.consecutiveSuccesses}`);
    }
    lines.push('');
    lines.push('Agent:');
    lines.push(`  Ticks: ${report.agentMetrics.totalTicks} (${report.agentMetrics.activeTicks} active, ${report.agentMetrics.idleTicks} idle)`);
    lines.push(`  Utilization: ${(report.agentMetrics.utilizationRate * 100).toFixed(1)}%`);
    if (report.agentMetrics.averageTasksPerTick > 0) {
      lines.push(`  Avg Tasks/Tick: ${report.agentMetrics.averageTasksPerTick}`);
    }
    lines.push('');
    lines.push('FLUX:');
    lines.push(`  Analyses: ${report.fluxMetrics.analysesPerformed}`);
    lines.push(`  Convergence Checks: ${report.fluxMetrics.convergenceChecks}`);
    lines.push(`  Assembly Generated: ${report.fluxMetrics.asmGenerated}`);
    lines.push('');
    lines.push(`Milestones: ${report.milestones.achieved}/${report.milestones.total} (${report.milestones.percentage}%)`);
    for (const m of report.milestones.list) {
      lines.push(`  ✓ ${m.description}`);
    }

    return lines.join('\n');
  }

  // -----------------------------------------------------------------------
  // Persistence
  // -----------------------------------------------------------------------

  /**
   * Persist all metrics, milestones, and event log to disk.
   *
   * @returns {Promise<void>}
   */
  async persist() {
    try {
      const dir = this.persistPath.substring(0, this.persistPath.lastIndexOf('/')) ||
        this.persistPath.substring(0, this.persistPath.lastIndexOf('\\'));

      await mkdir(dir, { recursive: true });

      const data = {
        persistedAt: Date.now(),
        metrics: this.metrics,
        milestones: Object.fromEntries(
          Object.entries(this.milestones).map(([id, m]) => [id, {
            description: m.description,
            achieved: m.achieved,
          }])
        ),
        eventLog: this.eventLog.slice(-500), // Keep last 500 events
        metricHistory: Object.fromEntries(
          [...this._metricHistory.entries()].map(([name, entries]) => [
            name,
            entries.slice(-100), // Keep last 100 per metric
          ])
        ),
      };

      await writeFile(this.persistPath, JSON.stringify(data, null, 2), 'utf-8');
      this.emit('persisted', this.persistPath);
    } catch (err) {
      this.emit('error', new Error(`Failed to persist metrics: ${err.message}`));
    }
  }

  /**
   * Restore metrics, milestones, and event log from disk.
   *
   * @param {string} [filePath] — Override path to restore from
   * @returns {Promise<boolean>} Whether restoration succeeded
   */
  async restore(filePath) {
    const path = filePath ?? this.persistPath;

    try {
      const raw = await readFile(path, 'utf-8');
      const data = JSON.parse(raw);

      // Restore metrics
      if (data.metrics) {
        this.metrics = { ...this.metrics, ...data.metrics };
      }

      // Restore milestone achievement status (don't overwrite conditions)
      if (data.milestones) {
        for (const [id, milestoneData] of Object.entries(data.milestones)) {
          if (this.milestones[id] && typeof milestoneData.achieved === 'boolean') {
            this.milestones[id].achieved = milestoneData.achieved;
          }
        }
      }

      // Restore event log
      if (data.eventLog) {
        this.eventLog = [...data.eventLog];
      }

      // Restore metric history
      if (data.metricHistory) {
        for (const [name, entries] of Object.entries(data.metricHistory)) {
          if (!this._metricHistory.has(name)) {
            this._metricHistory.set(name, []);
          }
          this._metricHistory.get(name).push(...entries);
        }
      }

      this.emit('restored', path);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Reset all metrics and milestones to initial state.
   * @returns {void}
   */
  reset() {
    this.metrics = {};
    this.eventLog = [];
    this._metricHistory.clear();

    for (const milestone of Object.values(this.milestones)) {
      milestone.achieved = false;
    }
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  /**
   * Check all milestones for achievement.
   * @private
   */
  _checkAllMilestones() {
    for (const id of Object.keys(this.milestones)) {
      this.checkMilestone(id);
    }
  }

  /**
   * Format duration in ms to human-readable string.
   * @param {number} ms
   * @returns {string}
   * @private
   */
  _formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
    if (hours > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  }
}

export default ProgressTracker;
