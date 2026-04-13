/**
 * @module task-executor
 * @description Task execution engine for the SuperZ Twin agent.
 * Handles single and batch task execution against AI providers,
 * prompt construction, result parsing, timeouts, and retries.
 */

import { EventEmitter } from 'node:events';

// ---------------------------------------------------------------------------
// Task Type Definitions
// ---------------------------------------------------------------------------

/** @enum {string} Supported task types */
export const TaskType = Object.freeze({
  CODE_CHANGE: 'code_change',
  PR_CREATE: 'pr_create',
  ANALYSIS: 'analysis',
  REFACTOR: 'refactor',
  TEST: 'test',
  DOCS: 'docs',
  COMMUNICATION_RESPONSE: 'communication_response',
});

/**
 * Schema for a single task.
 * @typedef {object} Task
 * @property {string} id — Unique task identifier
 * @property {string} type — One of {@link TaskType}
 * @property {object} payload — Task-specific payload data
 * @property {number} [priority=0] — Higher = more urgent
 * @property {number} [retries=0] — Number of times this task has been retried
 * @property {number} [timeoutMs=120000] — Per-task timeout in ms
 * @property {object} [context] — Additional execution context
 */

/**
 * Structured result from task execution.
 * @typedef {object} TaskResult
 * @property {boolean} success
 * @property {string} type
 * @property {string} taskId
 * @property {object} data — Parsed result payload
 * @property {string} raw — Raw AI response text
 * @property {number} durationMs
 * @property {number} attempts
 * @property {string} [error]
 */

// ---------------------------------------------------------------------------
// TaskExecutor
// ---------------------------------------------------------------------------

/**
 * Executes tasks against AI providers with robust error handling,
 * timeout enforcement, and retry logic.
 *
 * Events:
 *   - `task:start`   (taskId)
 *   - `task:success` (taskId, result)
 *   - `task:failure` (taskId, error)
 *   - `task:timeout` (taskId)
 *   - `task:retry`   (taskId, attempt)
 */
export class TaskExecutor extends EventEmitter {
  /**
   * @param {object} [options]
   * @param {number} [options.defaultTimeoutMs=120_000] — Default per-task timeout
   * @param {number} [options.maxRetries=3] — Maximum retry attempts
   * @param {number} [options.retryDelayMs=2000] — Delay between retries (exponential backoff base)
   * @param {number} [options.maxBatchConcurrency=5] — Max parallel tasks in a batch
   */
  constructor({
    defaultTimeoutMs = 120_000,
    maxRetries = 3,
    retryDelayMs = 2_000,
    maxBatchConcurrency = 5,
  } = {}) {
    super();
    this.defaultTimeoutMs = defaultTimeoutMs;
    this.maxRetries = maxRetries;
    this.retryDelayMs = retryDelayMs;
    this.maxBatchConcurrency = maxBatchConcurrency;
  }

  // -----------------------------------------------------------------------
  // Single Task Execution
  // -----------------------------------------------------------------------

  /**
   * Execute a single task using the given AI provider.
   *
   * @param {Task} task — The task to execute
   * @param {object} provider — AI provider with `complete(prompt)` method
   * @returns {Promise<TaskResult>}
   */
  async executeTask(task, provider) {
    const taskId = task.id ?? `task_${Date.now()}`;
    const startTime = Date.now();
    const timeoutMs = task.timeoutMs ?? this.defaultTimeoutMs;
    let lastError;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (attempt > 0) {
        const delay = this.retryDelayMs * Math.pow(2, attempt - 1);
        this.emit('task:retry', taskId, attempt);
        await this._sleep(delay);
      }

      this.emit('task:start', taskId);

      try {
        const prompt = this.buildPrompt(task, task.context ?? {});
        const raw = await this._withTimeout(
          provider.complete(prompt),
          timeoutMs,
          `Task ${taskId} timed out after ${timeoutMs}ms`
        );
        const data = this.parseResult(raw);
        const durationMs = Date.now() - startTime;

        const result = {
          success: true,
          type: task.type,
          taskId,
          data,
          raw: typeof raw === 'string' ? raw : JSON.stringify(raw),
          durationMs,
          attempts: attempt + 1,
        };

        this.emit('task:success', taskId, result);
        return result;
      } catch (err) {
        lastError = err;
        if (err.message?.includes('timed out')) {
          this.emit('task:timeout', taskId);
        }
        this.emit('task:failure', taskId, err);
      }
    }

    // All retries exhausted
    const durationMs = Date.now() - startTime;
    return {
      success: false,
      type: task.type,
      taskId,
      data: null,
      raw: '',
      durationMs,
      attempts: this.maxRetries + 1,
      error: lastError?.message ?? 'Unknown error',
    };
  }

  // -----------------------------------------------------------------------
  // Batch Execution
  // -----------------------------------------------------------------------

  /**
   * Execute multiple tasks in parallel with concurrency control.
   *
   * @param {Task[]} tasks — Array of tasks to execute
   * @param {object} provider — AI provider
   * @param {number} [concurrency] — Max parallel tasks (default from constructor)
   * @returns {Promise<TaskResult[]>}
   */
  async executeBatch(tasks, provider, concurrency) {
    const limit = concurrency ?? this.maxBatchConcurrency;
    const results = new Array(tasks.length);
    let nextIndex = 0;

    /**
     * Worker: pull tasks off the queue until exhausted.
     * @returns {Promise<void>}
     */
    const worker = async () => {
      while (nextIndex < tasks.length) {
        const index = nextIndex++;
        results[index] = await this.executeTask(tasks[index], provider);
      }
    };

    // Spawn up to `limit` parallel workers
    const workers = Array.from({ length: Math.min(limit, tasks.length) }, () => worker());
    await Promise.all(workers);
    return results;
  }

  // -----------------------------------------------------------------------
  // Prompt Construction
  // -----------------------------------------------------------------------

  /**
   * Construct the appropriate prompt for the AI based on task type and context.
   *
   * @param {Task} task
   * @param {object} context
   * @returns {string} Fully constructed prompt
   */
  buildPrompt(task, context = {}) {
    const systemHeader = this._systemHeader(task.type);
    const contextBlock = this._contextBlock(context);
    const taskBlock = this._taskBlock(task);

    return [
      systemHeader,
      contextBlock ? `## Context\n${contextBlock}` : '',
      taskBlock,
    ]
      .filter(Boolean)
      .join('\n\n');
  }

  // -----------------------------------------------------------------------
  // Result Parsing
  // -----------------------------------------------------------------------

  /**
   * Parse an AI response into a structured result object.
   *
   * Handles multiple response formats:
   *   - JSON string → parsed object
   *   - Markdown code block → extracted content
   *   - Plain text → wrapped in { content, format: 'text' }
   *
   * @param {object|string} raw — Raw AI response
   * @returns {object} Parsed result
   */
  parseResult(raw) {
    const text = typeof raw === 'string' ? raw : JSON.stringify(raw);

    // Attempt JSON parse (including JSON in code blocks)
    const jsonMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    const jsonCandidate = jsonMatch ? jsonMatch[1].trim() : text.trim();

    try {
      const parsed = JSON.parse(jsonCandidate);
      if (typeof parsed === 'object' && parsed !== null) {
        return { format: 'json', ...parsed };
      }
    } catch {
      // Not JSON — continue
    }

    // Extract code blocks if present
    const codeBlockMatch = text.match(/```\w*\n([\s\S]*?)```/);
    const codeBlocks = codeBlockMatch
      ? text.match(/```\w*\n([\s\S]*?)```/g).map((b) => b.replace(/```\w*\n?/, '').replace(/```$/, ''))
      : [];

    // Extract plain text (strip markdown headers)
    const plainText = text.replace(/^#{1,6}\s.*$/gm, '').trim();

    return {
      format: 'markdown',
      content: plainText,
      codeBlocks,
      rawLength: text.length,
    };
  }

  // -----------------------------------------------------------------------
  // Private: Prompt Helpers
  // -----------------------------------------------------------------------

  /**
   * Build system header based on task type.
   * @param {string} type
   * @returns {string}
   * @private
   */
  _systemHeader(type) {
    const headers = {
      [TaskType.CODE_CHANGE]:
        'You are Super Z, a FLUX Fleet Architect AI agent. ' +
        'You are making targeted code changes. Respond with the modified files in JSON format: ' +
        '{ "files": [{ "path": "...", "content": "..." }], "summary": "..." }',
      [TaskType.PR_CREATE]:
        'You are Super Z, a FLUX Fleet Architect AI agent. ' +
        'Create a detailed pull request description. Respond with: ' +
        '{ "title": "...", "body": "...", "labels": [...], "reviewers": [...] }',
      [TaskType.ANALYSIS]:
        'You are Super Z, a FLUX Fleet Architect AI agent. ' +
        'Analyze the provided code and produce a structured analysis. ' +
        'Respond with: { "findings": [...], "risks": [...], "suggestions": [...] }',
      [TaskType.REFACTOR]:
        'You are Super Z, a FLUX Fleet Architect AI agent. ' +
        'Refactor the provided code for clarity, performance, and correctness. ' +
        'Respond with refactored files and explanation.',
      [TaskType.TEST]:
        'You are Super Z, a FLUX Fleet Architect AI agent. ' +
        'Generate comprehensive tests for the provided code. ' +
        'Respond with: { "test_files": [{ "path": "...", "content": "..." }], "coverage_notes": "..." }',
      [TaskType.DOCS]:
        'You are Super Z, a FLUX Fleet Architect AI agent. ' +
        'Generate or update documentation. Respond with: { "files": [...], "readme": "..." }',
      [TaskType.COMMUNICATION_RESPONSE]:
        'You are Super Z, a FLUX Fleet Architect AI agent. ' +
        'Respond to a team communication professionally. Keep it concise and actionable.',
    };

    return `# System Instructions\n${headers[type] ?? headers[TaskType.ANALYSIS]}`;
  }

  /**
   * Build context block from context object.
   * @param {object} ctx
   * @returns {string}
   * @private
   */
  _contextBlock(ctx) {
    const parts = [];
    if (ctx.repository) parts.push(`Repository: ${ctx.repository}`);
    if (ctx.branch) parts.push(`Branch: ${ctx.branch}`);
    if (ctx.baseBranch) parts.push(`Base branch: ${ctx.baseBranch}`);
    if (ctx.files) parts.push(`Files:\n${ctx.files.map((f) => `  - ${f}`).join('\n')}`);
    if (ctx.previousResults) {
      parts.push(`Previous results:\n${JSON.stringify(ctx.previousResults, null, 2)}`);
    }
    if (ctx.constraints) parts.push(`Constraints: ${ctx.constraints}`);
    return parts.join('\n');
  }

  /**
   * Build task-specific instruction block.
   * @param {Task} task
   * @returns {string}
   * @private
   */
  _taskBlock(task) {
    const payloadStr =
      typeof task.payload === 'string'
        ? task.payload
        : JSON.stringify(task.payload, null, 2);

    return `## Task\nType: ${task.type}\n\n${payloadStr}`;
  }

  // -----------------------------------------------------------------------
  // Private: Utilities
  // -----------------------------------------------------------------------

  /**
   * Wrap a promise with a timeout.
   * @template T
   * @param {Promise<T>} promise
   * @param {number} ms
   * @param {string} message
   * @returns {Promise<T>}
   * @private
   */
  async _withTimeout(promise, ms, message) {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    });
    try {
      return await Promise.race([promise, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Sleep for a given number of milliseconds.
   * @param {number} ms
   * @returns {Promise<void>}
   * @private
   */
  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export default TaskExecutor;
