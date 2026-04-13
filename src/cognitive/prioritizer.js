/**
 * @module cognitive/prioritizer
 * @description
 * Task Prioritization System for Super Z — weight-based scoring engine that ranks tasks
 * according to Super Z's cognitive profile: impact-heavy, risk-tolerant, breadth-valuing.
 *
 * The prioritizer is designed to produce orderings that feel authentic to Super Z's style.
 * It does NOT simply sort by urgency — it considers a multi-dimensional score that
 * balances impact, urgency, effort efficiency, risk tolerance, and fleet alignment.
 *
 * Key behaviors:
 *   - High-impact tasks bubble to the top regardless of effort.
 *   - Risk is considered but does NOT block (Super Z tolerates risk).
 *   - Cross-repo tasks get a boost (domain alignment).
 *   - Dynamic reprioritization adapts to new information mid-session.
 *
 * @example
 *   import { Prioritizer } from './prioritizer.js';
 *
 *   const p = new Prioritizer();
 *   const ranked = p.prioritize(tasks);
 *   console.log(ranked.map(r => ({ id: r.task.id, score: r.score })));
 *
 * @author FLUX Fleet Archive
 * @version 3.7.0
 */

/**
 * @typedef {Object} WeightConfig
 * @property {number} urgency - Time pressure weight (default: 0.25).
 * @property {number} impact - Business/technical impact weight (default: 0.35).
 * @property {number} effort - Effort efficiency weight (default: 0.15, inverted).
 * @property {number} risk - Risk tolerance weight (default: 0.10, inverted).
 * @property {number} alignment - Fleet/domain alignment weight (default: 0.15).
 */

/**
 * @typedef {Object} ScoredTask
 * @property {Object} task - The original task object.
 * @property {number} score - Composite score (0-1).
 * @property {Object} breakdown - Individual dimension scores.
 * @property {string} rank - Letter rank: "S" | "A" | "B" | "C" | "D".
 */

/**
 * @typedef {Object} BlockingChain
 * @property {string} root - Root task ID (no blockers).
 * @property {string[]} chain - Ordered chain of blocked tasks.
 * @property {number} depth - Chain length.
 * @property {number} totalEffort - Cumulative effort in hours.
 */

/**
 * Task Prioritizer — scores, ranks, and organizes tasks for optimal execution order.
 */
export class Prioritizer {
  /**
   * Create a new Prioritizer.
   * @param {Object} [options] - Configuration overrides.
   * @param {WeightConfig} [options.weights] - Custom scoring weights.
   * @param {string[]} [options.primaryRepos] - Repos that boost alignment score.
   * @param {string[]} [options.preferredLanguages] - Languages that boost alignment.
   */
  constructor(options = {}) {
    /**
     * Default weights matching Super Z's cognitive style:
     *   - Impact dominant (0.35): high-value work first.
     *   - Urgency significant (0.25): but not all-consuming.
     *   - Effort inverted (0.15): prefer lower-effort wins.
     *   - Alignment important (0.15): fleet/domain fit matters.
     *   - Risk minor (0.10): Super Z tolerates risk, so it barely penalizes.
     */
    this.weights = {
      urgency: options.weights?.urgency ?? 0.25,
      impact: options.weights?.impact ?? 0.35,
      effort: options.weights?.effort ?? 0.15,
      risk: options.weights?.risk ?? 0.10,
      alignment: options.weights?.alignment ?? 0.15,
    };

    this.primaryRepos = options.primaryRepos ?? [
      'flux-runtime',
      'flux-sdk',
      'flux-cli',
      'flux-gateway',
      'flux-dashboard',
    ];

    this.preferredLanguages = options.preferredLanguages ?? [
      'go', 'rust', 'python', 'typescript', 'javascript', 'c',
    ];
  }

  // ── Core Scoring ──────────────────────────────────────────────────────────

  /**
   * Score and rank a list of tasks.
   *
   * Each task receives a composite score (0-1) based on weighted dimensions.
   * Tasks are returned sorted by score (highest first).
   *
   * @param {Object[]} tasks - Tasks to prioritize.
   * @returns {ScoredTask[]} Scored and ranked tasks, sorted descending.
   */
  prioritize(tasks) {
    return tasks
      .map((task) => this.score(task))
      .sort((a, b) => b.score - a.score);
  }

  /**
   * Calculate the composite score for a single task.
   *
   * Breaks down into individual dimension scores for transparency:
   *   - urgencyScore: how time-pressured (0-1, from task.urgency).
   *   - impactScore: how valuable (0-1, from task.impact).
   *   - effortScore: how efficient (0-1, inverted — low effort = high score).
   *   - riskScore: how safe (0-1, inverted — low risk = high score, but weight is low).
   *   - alignmentScore: how well-aligned with Super Z's domains/repos (0-1).
   *
   * @param {Object} task - Task to score.
   * @returns {ScoredTask} Scored task with breakdown.
   */
  score(task) {
    const urgencyScore = this._urgencyScore(task);
    const impactScore = this._impactScore(task);
    const effortScore = this._effortScore(task);
    const riskScore = this._riskScore(task);
    const alignmentScore = this._alignmentScore(task);

    const composite =
      urgencyScore * this.weights.urgency +
      impactScore * this.weights.impact +
      effortScore * this.weights.effort +
      riskScore * this.weights.risk +
      alignmentScore * this.weights.alignment;

    return {
      task,
      score: Math.round(composite * 1000) / 1000, // 3 decimal places
      breakdown: {
        urgency: Math.round(urgencyScore * 1000) / 1000,
        impact: Math.round(impactScore * 1000) / 1000,
        effort: Math.round(effortScore * 1000) / 1000,
        risk: Math.round(riskScore * 1000) / 1000,
        alignment: Math.round(alignmentScore * 1000) / 1000,
      },
      rank: this._letterRank(composite),
    };
  }

  // ── Dynamic Reprioritization ──────────────────────────────────────────────

  /**
   * Reprioritize tasks based on new information received mid-session.
   *
   * Common triggers for reprioritization:
   *   - A blocking dependency was resolved (unblock dependent tasks).
   *   - A task failed (reassess dependent tasks).
   *   - New urgency information arrived (deadline moved up).
   *   - A fleet signal indicated a shared resource conflict.
   *   - CI feedback revealed unexpected issues.
   *
   * @param {Object[]} currentTasks - Currently prioritized task list.
   * @param {Object} newInfo - New information affecting priorities.
   * @param {string} [newInfo.trigger] - What triggered the reprioritization.
   * @param {string[]} [newInfo.unblockedTasks] - Task IDs that are now unblocked.
   * @param {string[]} [newInfo.failedTasks] - Task IDs that have failed.
   * @param {Object} [newInfo.urgencyUpdates] - Map of taskId → new urgency value.
   * @param {string} [newInfo.conflictingRepo] - Repo with a resource conflict.
   * @returns {{ tasks: ScoredTask[], changes: string[] }} Updated ranking with change log.
   */
  rePrioritize(currentTasks, newInfo = {}) {
    const changes = [];
    let tasks = currentTasks.map((entry) => {
      // Dereference if ScoredTask format
      const task = entry.task ?? entry;
      const mutableTask = { ...task, dependencies: [...(task.dependencies ?? [])] };

      // Handle unblocked tasks
      if (newInfo.unblockedTasks?.includes(mutableTask.id)) {
        changes.push(`Task ${mutableTask.id} unblocked — dependencies resolved. Score boosted.`);
      }

      // Handle failed tasks — mark dependents as blocked
      if (newInfo.failedTasks?.includes(mutableTask.id)) {
        changes.push(`Task ${mutableTask.id} failed. Dependent tasks may need re-evaluation.`);
      }

      // Apply urgency updates
      if (newInfo.urgencyUpdates?.[mutableTask.id] !== undefined) {
        const oldUrgency = mutableTask.urgency ?? 0.5;
        mutableTask.urgency = newInfo.urgencyUpdates[mutableTask.id];
        changes.push(
          `Task ${mutableTask.id} urgency updated: ${oldUrgency.toFixed(2)} → ${mutableTask.urgency.toFixed(2)}.`
        );
      }

      // Handle repo conflicts — deprioritize tasks in conflicting repo
      if (newInfo.conflictingRepo && mutableTask.repos?.includes(newInfo.conflictingRepo)) {
        mutableTask.urgency = Math.max(0, (mutableTask.urgency ?? 0.5) - 0.2);
        changes.push(
          `Task ${mutableTask.id} deprioritized due to repo conflict in ${newInfo.conflictingRepo}.`
        );
      }

      return mutableTask;
    });

    // Remove failed tasks from the active queue
    if (newInfo.failedTasks?.length > 0) {
      const failedSet = new Set(newInfo.failedTasks);
      const before = tasks.length;
      tasks = tasks.filter((t) => !failedSet.has(t.id));
      changes.push(`Removed ${before - tasks.length} failed task(s) from active queue.`);
    }

    const ranked = this.prioritize(tasks);

    return {
      tasks: ranked,
      changes,
      timestamp: new Date().toISOString(),
    };
  }

  // ── Blocking Chain Analysis ────────────────────────────────────────────────

  /**
   * Identify task dependency chains — sequences of tasks where each blocks the next.
   *
   * Blocking chains are critical for planning because:
   *   - The root task in a chain is the highest-leverage item to accelerate.
   *   - Chain depth indicates how many rounds a downstream task will be delayed.
   *   - Long chains should be broken by parallelizing independent sub-tasks.
   *
   * @param {Object[]} tasks - Tasks to analyze for dependency chains.
   * @returns {BlockingChain[]} Identified blocking chains, sorted by depth (longest first).
   */
  getBlockingChains(tasks) {
    const taskMap = new Map(tasks.map((t) => [t.id, t]));
    const visited = new Set();
    const chains = [];

    // Find root tasks (tasks with no dependencies, or dependencies not in task list)
    const roots = tasks.filter((t) => {
      const deps = t.dependencies ?? [];
      return deps.length === 0 || deps.every((d) => !taskMap.has(d));
    });

    // For each root, trace the dependency chain
    for (const root of roots) {
      const chain = this._traceChain(root, taskMap, visited);
      if (chain.length > 1) {
        chains.push({
          root: root.id,
          chain: chain,
          depth: chain.length,
          totalEffort: chain.reduce((sum, id) => {
            const t = taskMap.get(id);
            return sum + (t?.estimatedHours ?? 1);
          }, 0),
        });
      }
    }

    // Also find chains where the root IS in the task list but its dependency is not
    // (external dependency — these are "waiting" chains)
    const waitingTasks = tasks.filter((t) => {
      const deps = t.dependencies ?? [];
      return deps.length > 0 && !deps.every((d) => taskMap.has(d));
    });

    for (const task of waitingTasks) {
      const chain = this._traceChain(task, taskMap, visited);
      if (chain.length > 0) {
        chains.push({
          root: `${task.id} (external_dep)`,
          chain: chain,
          depth: chain.length + 1, // +1 for the external dependency
          totalEffort: chain.reduce((sum, id) => {
            const t = taskMap.get(id);
            return sum + (t?.estimatedHours ?? 1);
          }, 0),
        });
      }
    }

    return chains.sort((a, b) => b.depth - a.depth);
  }

  // ── Delegation Suggestions ─────────────────────────────────────────────────

  /**
   * Suggest tasks that could be delegated to parallel fleet agents.
   *
   * Delegation criteria:
   *   - Low-to-medium risk (don't delegate critical tasks).
   *   - Well-defined scope (clear task description).
   *   - Self-contained (minimal cross-repo impact).
   *   - Lower priority (Super Z keeps high-value work local).
   *   - Effort > 0.5h (not worth delegating trivial tasks).
   *
   * @param {Object[]} tasks - Tasks to evaluate for delegation.
   * @param {number} [capacity=8] - Current worker capacity (tasks in-flight).
   * @returns {Object[]} Delegation recommendations, sorted by suitability.
   */
  suggestDelegation(tasks, capacity = 8) {
    const scored = this.prioritize(tasks);

    // Delegate tasks that are:
    // - Rank C or below (not Super Z's top priorities)
    // - Single-repo (self-contained)
    // - Not critical risk
    return scored
      .filter((entry) => {
        const task = entry.task;
        const repos = task.repos ?? [];

        // Don't delegate top-priority tasks
        if (entry.rank === 'S' || entry.rank === 'A') return false;

        // Don't delegate multi-repo tasks (coordination overhead)
        if (repos.length > 1) return false;

        // Don't delegate trivially small tasks
        if ((task.estimatedHours ?? 1) < 0.5) return false;

        // Don't delegate tasks tagged as critical
        if (task.tags?.includes('critical')) return false;

        // Don't delegate if capacity is low
        if (capacity < 3) return false;

        return true;
      })
      .map((entry) => ({
        task: entry.task,
        delegationScore: Math.round(entry.score * 1000) / 1000,
        suggestedAgent: this._suggestAgent(entry.task),
        reason: this._delegationReason(entry),
        context: this._buildDelegationContext(entry.task),
      }));
  }

  // ── Top-N Selection ────────────────────────────────────────────────────────

  /**
   * Select the top N tasks from a prioritized list.
   *
   * @param {Object[]} tasks - Tasks to select from.
   * @param {number} [n=6] - Number of tasks to select.
   * @returns {ScoredTask[]} Top N scored tasks.
   */
  topN(tasks, n = 6) {
    return this.prioritize(tasks).slice(0, n);
  }

  /**
   * Get the weight configuration for inspection or serialization.
   * @returns {WeightConfig} Current weight configuration.
   */
  getWeights() {
    return { ...this.weights };
  }

  /**
   * Update weights at runtime.
   * @param {Partial<WeightConfig>} newWeights - Weights to update.
   */
  setWeights(newWeights) {
    const total = Object.values({ ...this.weights, ...newWeights }).reduce((s, v) => s + v, 0);
    if (Math.abs(total - 1.0) > 0.01) {
      console.warn(
        `[Prioritizer] Weights sum to ${total.toFixed(3)}, expected 1.0. ` +
        'Scores may not be properly normalized.'
      );
    }
    Object.assign(this.weights, newWeights);
  }

  // ── Private Scoring Methods ───────────────────────────────────────────────

  /**
   * Urgency dimension: how time-pressured is this task?
   * Higher urgency = higher score.
   * @private
   */
  _urgencyScore(task) {
    return Math.min(Math.max(task.urgency ?? 0.5, 0), 1);
  }

  /**
   * Impact dimension: how valuable is completing this task?
   * Higher impact = higher score.
   * @private
   */
  _impactScore(task) {
    return Math.min(Math.max(task.impact ?? 0.5, 0), 1);
  }

  /**
   * Effort dimension: how efficiently can we get value?
   * INVERTED: lower effort = higher score (quick wins score well).
   * @private
   */
  _effortScore(task) {
    const hours = task.estimatedHours ?? 2;
    // Logistic decay: score drops as effort increases
    return 1 - Math.min(hours / 10, 1);
  }

  /**
   * Risk dimension: how safe is this task?
   * INVERTED: lower risk = higher score.
   * Note: weight is only 0.10 because Super Z tolerates risk.
   * @private
   */
  _riskScore(task) {
    // Check for risk-indicating tags
    const riskTags = task.tags?.filter((t) =>
      ['breaking', 'migration', 'deprecation', 'schema-change', 'high-risk'].includes(t)
    ) ?? [];

    // Cross-repo adds risk
    const repoCount = task.repos?.length ?? 1;

    let riskLevel = 0;
    riskLevel += riskTags.length * 0.15;
    riskLevel += Math.max(0, repoCount - 1) * 0.1;
    riskLevel += task.urgency > 0.9 ? 0.1 : 0;

    // Invert: high risk → low score
    return Math.max(1 - Math.min(riskLevel, 1), 0);
  }

  /**
   * Alignment dimension: how well does this task fit Super Z's domain expertise?
   * @private
   */
  _alignmentScore(task) {
    let score = 0.3; // Base score for any task

    // Repo alignment
    const repoOverlap = (task.repos ?? []).filter((r) => this.primaryRepos.includes(r)).length;
    score += repoOverlap * 0.15;

    // Language alignment
    const langOverlap = (task.languages ?? []).filter((l) => this.preferredLanguages.includes(l)).length;
    score += langOverlap * 0.1;

    // Tag alignment with Super Z's strengths
    const strengthTags = [
      'refactor', 'api', 'ci', 'cd', 'pipeline', 'test', 'infrastructure',
      'performance', 'optimization', 'architecture',
    ];
    const tagOverlap = (task.tags ?? []).filter((t) =>
      strengthTags.some((s) => t.toLowerCase().includes(s))
    ).length;
    score += tagOverlap * 0.08;

    return Math.min(score, 1);
  }

  /**
   * Convert numeric score to letter rank.
   * Super Z uses letter ranks for quick assessment.
   * @private
   */
  _letterRank(score) {
    if (score >= 0.85) return 'S';  // Critical — drop everything and do this
    if (score >= 0.70) return 'A';  // High priority — schedule immediately
    if (score >= 0.55) return 'B';  // Medium priority — next available slot
    if (score >= 0.40) return 'C';  // Low priority — delegate or defer
    return 'D';                      // Minimal priority — backlog
  }

  /**
   * Trace a dependency chain from a root task.
   * @private
   */
  _traceChain(root, taskMap, visited) {
    const chain = [root.id];
    visited.add(root.id);
    let current = root;

    while (true) {
      // Find tasks that depend on current
      const dependents = [...taskMap.values()].filter(
        (t) => t.dependencies?.includes(current.id) && !visited.has(t.id)
      );

      if (dependents.length === 0) break;

      // Follow the first dependent (simple chain, not DAG)
      current = dependents[0];
      chain.push(current.id);
      visited.add(current.id);
    }

    return chain;
  }

  /**
   * Suggest which fleet agent type should handle a delegated task.
   * @private
   */
  _suggestAgent(task) {
    const langs = task.languages ?? [];
    if (langs.includes('rust') || langs.includes('c')) return 'systems-specialist';
    if (langs.includes('python')) return 'backend-worker';
    if (langs.includes('typescript') || langs.includes('javascript')) return 'frontend-worker';
    if (task.tags?.includes('test')) return 'test-specialist';
    if (task.tags?.includes('docs')) return 'documentation-agent';
    return 'general-worker';
  }

  /**
   * Explain why a task is a good delegation candidate.
   * @private
   */
  _delegationReason(entry) {
    const reasons = [];
    if (entry.rank === 'C') reasons.push('Medium priority');
    if (entry.rank === 'D') reasons.push('Low priority');
    reasons.push('Self-contained scope');
    reasons.push('Does not require Architect-level decisions');
    return reasons.join('. ') + '.';
  }

  /**
   * Build context package for delegation handoff.
   * @private
   */
  _buildDelegationContext(task) {
    return {
      title: task.title,
      description: task.description,
      repos: task.repos ?? [],
      languages: task.languages ?? [],
      estimatedHours: task.estimatedHours ?? null,
      acceptanceCriteria: task.tags ?? [],
      notes: 'Delegated by Super Z — Architect review expected before merge.',
    };
  }
}

export default Prioritizer;
