/**
 * @module agent-loop
 * @description Main agent execution loop for the SuperZ Twin digital agent.
 * Implements a state-machine-driven loop with event emitter lifecycle,
 * parallel batch execution, and graceful shutdown semantics.
 */

import { EventEmitter } from 'node:events';
import { TaskExecutor } from './task-executor.js';
import { ProgressTracker } from './progress-tracker.js';

// ---------------------------------------------------------------------------
// Agent States
// ---------------------------------------------------------------------------

/** @enum {string} Valid agent loop states */
export const AgentState = Object.freeze({
  IDLE: 'IDLE',
  PLANNING: 'PLANNING',
  EXECUTING: 'EXECUTING',
  REVIEWING: 'REVIEWING',
  REPORTING: 'REPORTING',
  STOPPED: 'STOPPED',
  ERROR: 'ERROR',
});

/** Valid state transitions */
const VALID_TRANSITIONS = {
  [AgentState.IDLE]: [AgentState.PLANNING, AgentState.STOPPED],
  [AgentState.PLANNING]: [AgentState.EXECUTING, AgentState.IDLE, AgentState.ERROR],
  [AgentState.EXECUTING]: [AgentState.REVIEWING, AgentState.ERROR],
  [AgentState.REVIEWING]: [AgentState.REPORTING, AgentState.PLANNING, AgentState.IDLE],
  [AgentState.REPORTING]: [AgentState.IDLE],
  [AgentState.STOPPED]: [],
  [AgentState.ERROR]: [AgentState.IDLE, AgentState.STOPPED],
};

// ---------------------------------------------------------------------------
// SuperZTwinAgent
// ---------------------------------------------------------------------------

/**
 * The main digital-twin agent loop.
 *
 * Lifecycle events emitted:
 *   - `state:change`  (oldState, newState)
 *   - `tick:start`    (tickNumber)
 *   - `tick:end`      (tickNumber, results)
 *   - `tick:error`    (tickNumber, error)
 *   - `task:planned`  (taskPlan)
 *   - `task:executed` (task, result)
 *   - `shutdown`      ()
 *   - `error`         (error)
 */
export class SuperZTwinAgent extends EventEmitter {
  /**
   * @param {object} options
   * @param {import('./task-executor.js').TaskExecutor} [options.executor]
   * @param {import('./progress-tracker.js').ProgressTracker} [options.progressTracker]
   * @param {number} [options.tickIntervalMs=5000] — sleep between ticks
   * @param {number} [options.maxParallelTasks=5] — max concurrent task executions
   * @param {number} [options.maxRetries=3]
   */
  constructor({
    executor,
    progressTracker,
    tickIntervalMs = 5_000,
    maxParallelTasks = 5,
    maxRetries = 3,
  } = {}) {
    super();

    this.executor = executor ?? new TaskExecutor();
    this.progress = progressTracker ?? new ProgressTracker();
    this.tickIntervalMs = tickIntervalMs;
    this.maxParallelTasks = maxParallelTasks;
    this.maxRetries = maxRetries;

    /** @type {Map<number, object>} Inbound task queue keyed by insertion order */
    this.taskQueue = new Map();
    this.taskQueueSeq = 0;

    /** @type {Map<string, object>} Active communication channels */
    this.communications = new Map();

    /** @type {string} Current state */
    this._state = AgentState.IDLE;

    /** @type {number} Tick counter */
    this.tickCount = 0;

    /** @type {number|null} setInterval handle */
    this._loopHandle = null;

    /** @type {boolean} Graceful shutdown flag */
    this._stopping = false;

    /** @type {AbortController|null} Active tick abort controller */
    this._tickAbort = null;
  }

  // -----------------------------------------------------------------------
  // State Machine
  // -----------------------------------------------------------------------

  /** @returns {string} Current agent state */
  get state() {
    return this._state;
  }

  /**
   * Transition to a new state, validating the transition.
   * @param {string} newState
   * @throws {Error} If transition is invalid
   */
  _transitionTo(newState) {
    const allowed = VALID_TRANSITIONS[this._state];
    if (!allowed || !allowed.includes(newState)) {
      throw new Error(
        `Invalid state transition: ${this._state} → ${newState}. ` +
        `Allowed: [${allowed?.join(', ') ?? 'none'}]`
      );
    }
    const oldState = this._state;
    this._state = newState;
    this.emit('state:change', oldState, newState);
  }

  // -----------------------------------------------------------------------
  // Public API — Task Intake
  // -----------------------------------------------------------------------

  /**
   * Enqueue a task for processing.
   * @param {object} task — Task descriptor (type, payload, priority, etc.)
   * @returns {number} Task sequence ID
   */
  enqueueTask(task) {
    const id = ++this.taskQueueSeq;
    this.taskQueue.set(id, {
      id,
      enqueuedAt: Date.now(),
      retries: 0,
      ...task,
    });
    return id;
  }

  /**
   * Register an incoming communication message.
   * @param {string} channel
   * @param {object} message
   */
  postCommunication(channel, message) {
    this.communications.set(channel, {
      ...message,
      receivedAt: Date.now(),
    });
  }

  // -----------------------------------------------------------------------
  // Public API — Lifecycle
  // -----------------------------------------------------------------------

  /**
   * Start the agent loop.
   * @returns {Promise<void>}
   */
  async start() {
    if (this._state !== AgentState.IDLE && this._state !== AgentState.STOPPED) {
      throw new Error(`Cannot start from state ${this._state}`);
    }
    this._stopping = false;
    this._transitionTo(AgentState.IDLE);
    this.progress.trackMetric('agent.loop_started_at', Date.now());
    this.emit('loop:started');

    // Begin ticking
    const tick = async () => {
      if (this._stopping) return;
      try {
        await this.tick();
      } catch (err) {
        this.emit('error', err);
      }
      if (!this._stopping) {
        this._loopHandle = setTimeout(tick, this.tickIntervalMs);
      }
    };

    // Execute first tick immediately, then schedule
    await this.tick();
    this._loopHandle = setTimeout(tick, this.tickIntervalMs);
  }

  /**
   * Gracefully stop the agent loop.
   * Waits for the current tick to finish.
   * @returns {Promise<void>}
   */
  async stop() {
    this._stopping = true;
    if (this._tickAbort) {
      this._tickAbort.abort();
    }
    if (this._loopHandle !== null) {
      clearTimeout(this._loopHandle);
      this._loopHandle = null;
    }
    this._transitionTo(AgentState.STOPPED);
    this.progress.trackMetric('agent.loop_stopped_at', Date.now());
    this.progress.persist();
    this.emit('shutdown');
  }

  // -----------------------------------------------------------------------
  // Tick — One Iteration of the Agent Loop
  // -----------------------------------------------------------------------

  /**
   * Execute one full tick of the agent loop.
   *
   * 1. Check for new tasks / communications
   * 2. Run decision engine to plan next actions
   * 3. Execute planned actions (parallel batches)
   * 4. Collect results
   * 5. Assess results, iterate if needed
   * 6. Report progress
   * 7. Sleep until next tick (handled by scheduler)
   *
   * @returns {Promise<object>} Tick results summary
   */
  async tick() {
    this._tickAbort = new AbortController();
    const signal = this._tickAbort.signal;
    const tickNum = ++this.tickCount;
    this.emit('tick:start', tickNum);
    this.progress.trackMetric('agent.total_ticks', this.tickCount);

    let results = {
      tickNum,
      tasksPlanned: 0,
      tasksExecuted: 0,
      tasksSucceeded: 0,
      tasksFailed: 0,
      communicationsProcessed: 0,
      actions: [],
    };

    try {
      // ── Step 1: Check for new tasks/communications ──────────────────────
      this._transitionTo(AgentState.IDLE);
      const inbound = this._drainInbound();
      results.communicationsProcessed = inbound.communications.length;

      // If nothing to do, go idle and return
      if (inbound.tasks.length === 0) {
        this.progress.trackMetric('agent.idle_ticks', (this.progress.getMetrics()['agent.idle_ticks'] ?? 0) + 1);
        this.emit('tick:end', tickNum, results);
        return results;
      }

      // ── Step 2: Planning ────────────────────────────────────────────────
      this._transitionTo(AgentState.PLANNING);
      const plan = this._decisionEngine(inbound.tasks, inbound.communications);
      results.tasksPlanned = plan.length;
      plan.forEach((task) => this.emit('task:planned', task));

      // ── Step 3: Execute planned actions (parallel batches) ──────────────
      this._transitionTo(AgentState.EXECUTING);
      const batchResults = await this._executeBatch(plan, signal);
      results.tasksExecuted = batchResults.length;
      results.tasksSucceeded = batchResults.filter((r) => r.status === 'fulfilled').length;
      results.tasksFailed = batchResults.filter((r) => r.status === 'rejected').length;

      // ── Step 4: Collect results ─────────────────────────────────────────
      const collected = batchResults.map((r, i) => ({
        task: plan[i],
        result: r.status === 'fulfilled' ? r.value : r.reason,
        success: r.status === 'fulfilled',
      }));
      results.actions = collected;
      collected.forEach(({ task, result }) => {
        this.emit('task:executed', task, result);
      });

      // ── Step 5: Assess results, iterate if needed ───────────────────────
      this._transitionTo(AgentState.REVIEWING);
      const retryTasks = this._assessAndRetry(collected, plan);
      if (retryTasks.length > 0 && !signal.aborted) {
        for (const retryTask of retryTasks) {
          try {
            const retryResult = await this.executor.executeTask(retryTask, this._getProvider());
            results.tasksExecuted++;
            results.tasksSucceeded++;
            this.emit('task:executed', retryTask, retryResult);
          } catch (err) {
            results.tasksExecuted++;
            results.tasksFailed++;
            this.emit('task:executed', retryTask, { error: err.message });
          }
        }
      }

      // ── Step 6: Report progress ─────────────────────────────────────────
      this._transitionTo(AgentState.REPORTING);
      this._reportProgress(results);
      this.progress.persist();

      // ── Return to IDLE ──────────────────────────────────────────────────
      this._transitionTo(AgentState.IDLE);
    } catch (err) {
      if (this._state !== AgentState.STOPPED) {
        this._transitionTo(AgentState.ERROR);
        this.emit('tick:error', tickNum, err);
      }
      throw err;
    } finally {
      this._tickAbort = null;
      this.emit('tick:end', tickNum, results);
    }

    return results;
  }

  // -----------------------------------------------------------------------
  // Internal: Decision Engine
  // -----------------------------------------------------------------------

  /**
   * Run the decision engine to produce an execution plan from inbound items.
   * @param {Array<object>} tasks
   * @param {Array<object>} communications
   * @returns {Array<object>} Ordered list of tasks to execute
   * @private
   */
  _decisionEngine(tasks, communications) {
    // Priority ordering: higher priority first, then FIFO
    const sorted = [...tasks].sort((a, b) => {
      const pA = a.priority ?? 0;
      const pB = b.priority ?? 0;
      if (pB !== pA) return pB - pA;
      return a.enqueuedAt - b.enqueuedAt;
    });

    // Deduplicate by type+id to avoid double-execution
    const seen = new Set();
    const plan = [];
    for (const task of sorted) {
      const key = `${task.type}:${task.id}`;
      if (!seen.has(key)) {
        seen.add(key);
        plan.push(task);
      }
    }

    // Process communications as reaction tasks if they imply actions
    for (const comm of communications) {
      if (comm.requiresAction && comm.action) {
        plan.push({
          type: 'communication_response',
          payload: comm,
          priority: -1,
        });
      }
    }

    return plan.slice(0, this.maxParallelTasks);
  }

  // -----------------------------------------------------------------------
  // Internal: Batch Execution
  // -----------------------------------------------------------------------

  /**
   * Execute a batch of tasks in parallel using Promise.allSettled.
   * @param {Array<object>} tasks
   * @param {AbortSignal} signal
   * @returns {Promise<PromiseSettledResult[]>}
   * @private
   */
  async _executeBatch(tasks, signal) {
    const provider = this._getProvider();
    const promises = tasks.map((task) => {
      if (signal.aborted) {
        return Promise.reject(new Error('Tick aborted'));
      }
      return this.executor.executeTask(task, provider);
    });
    return Promise.allSettled(promises);
  }

  // -----------------------------------------------------------------------
  // Internal: Assessment & Retry
  // -----------------------------------------------------------------------

  /**
   * Assess execution results and decide which tasks need retrying.
   * @param {Array<{task: object, result: object, success: boolean}>} collected
   * @param {Array<object>} plan
   * @returns {Array<object>} Tasks that should be retried
   * @private
   */
  _assessAndRetry(collected, plan) {
    const retries = [];
    for (const item of collected) {
      if (!item.success) {
        const task = item.task;
        if ((task.retries ?? 0) < this.maxRetries) {
          retries.push({ ...task, retries: (task.retries ?? 0) + 1 });
        }
      }
    }
    return retries;
  }

  // -----------------------------------------------------------------------
  // Internal: Inbound Draining
  // -----------------------------------------------------------------------

  /**
   * Drain all pending tasks and communications from queues.
   * @returns {{tasks: object[], communications: object[]}}
   * @private
   */
  _drainInbound() {
    const tasks = Array.from(this.taskQueue.values());
    this.taskQueue.clear();
    this.taskQueueSeq = 0;

    const communications = Array.from(this.communications.values());
    this.communications.clear();

    return { tasks, communications };
  }

  // -----------------------------------------------------------------------
  // Internal: Progress Reporting
  // -----------------------------------------------------------------------

  /**
   * Emit progress metrics and check milestones.
   * @param {object} results — tick results
   * @private
   */
  _reportProgress(results) {
    this.progress.trackMetric('agent.total_tasks_executed', results.tasksExecuted);
    this.progress.trackMetric('agent.total_tasks_succeeded', results.tasksSucceeded);
    this.progress.trackMetric('agent.total_tasks_failed', results.tasksFailed);
    this.progress.checkMilestone('first_task_completed');
    this.progress.checkMilestone('ten_tasks_completed');
    this.progress.checkMilestone('hundred_tasks_completed');
  }

  /**
   * Get the AI provider (placeholder — can be injected or configured).
   * @returns {object}
   * @private
   */
  _getProvider() {
    return {
      name: 'default',
      complete: async (prompt) => ({ content: `Processed: ${prompt}` }),
    };
  }
}

export default SuperZTwinAgent;
