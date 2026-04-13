/**
 * @module cognitive/decision-engine
 * @description
 * Decision Engine for Super Z — the core orchestration layer that transforms a list of
 * available tasks into an optimized execution plan consisting of parallel batches.
 *
 * The Decision Engine consumes the cognitive profile to make decisions that feel
 * authentic to Super Z's working style: aggressive parallelization, calculated risk
 * acceptance, and minimum 5 rounds of iteration.
 *
 * Architecture:
 *   - Prioritizer handles task scoring and ordering.
 *   - RiskAssessor evaluates individual task risk.
 *   - IterationManager tracks round progress.
 *   - This engine orchestrates them all into a coherent plan.
 *
 * @example
 *   import { DecisionEngine } from './decision-engine.js';
 *   import { cognitiveProfile } from './profile.js';
 *
 *   const engine = new DecisionEngine(cognitiveProfile);
 *   const plan = engine.plan(tasks, { currentRound: 1, completedTasks: [] });
 *   console.log(plan.batches);
 *
 * @author FLUX Fleet Archive
 * @version 3.7.0
 */

import { cognitiveProfile } from './profile.js';

/**
 * @typedef {Object} Task
 * @property {string} id - Unique task identifier.
 * @property {string} title - Human-readable task title.
 * @property {string} description - Detailed task description.
 * @property {string[]} [dependencies] - IDs of tasks that must complete first.
 * @property {string[]} [repos] - Repositories this task touches.
 * @property {number} [estimatedHours] - Rough effort estimate in hours.
 * @property {string[]} [languages] - Programming languages involved.
 * @property {number} [urgency=0.5] - Time pressure (0 = no rush, 1 = critical).
 * @property {number} [impact=0.5] - Business/technical impact (0 = trivial, 1 = high).
 * @property {string[]} [tags] - Arbitrary classification tags.
 * @property {Object} [meta] - Additional metadata.
 */

/**
 * @typedef {Object} TaskBatch
 * @property {Task[]} tasks - Tasks in this batch (executed in parallel).
 * @property {string} strategy - "parallel" | "sequential" | "mixed".
 * @property {number} estimatedTime - Estimated wall-clock time for this batch in hours.
 * @property {string} rationale - Why this batch was composed this way.
 */

/**
 * @typedef {Object} RiskNote
 * @property {string} taskId - Task that carries the risk.
 * @property {string} type - Risk classification.
 * @property {string} level - "low" | "medium" | "high" | "critical".
 * @property {string[]} mitigations - Recommended mitigations.
 * @property {string} reasoning - Why this risk was assessed at this level.
 */

/**
 * @typedef {Object} ExecutionPlan
 * @property {TaskBatch[]} batches - Ordered list of task batches.
 * @property {RiskNote[]} risks - Identified risks across all tasks.
 * @property {string[]} notes - Architectural and strategic observations.
 * @property {Object} summary - High-level plan summary.
 * @property {number} summary.totalTasks - Total tasks in the plan.
 * @property {number} summary.parallelBatches - Number of parallel batches.
 * @property {number} summary.totalEstimatedHours - Total estimated effort.
 * @property {number} summary.utilization - Worker utilization percentage.
 * @property {number} summary.averageRisk - Average risk score across all tasks.
 */

/**
 * @typedef {Object} ExecutionContext
 * @property {number} [currentRound=1] - Current iteration round.
 * @property {string[]} [completedTasks=[]] - IDs of already-completed tasks.
 * @property {string[]} [failedTasks=[]] - IDs of tasks that failed.
 * @property {number} [availableWorkers=8] - Current worker capacity.
 * @property {Object} [roundResults] - Results from the previous round.
 */

/**
 * Decision Engine — takes a list of tasks and produces an optimized execution plan.
 *
 * The engine follows Super Z's cognitive patterns:
 * 1. Score and rank all tasks using weighted prioritization.
 * 2. Check dependencies to determine which tasks are immediately actionable.
 * 3. Assess risk for each actionable task.
 * 4. Group tasks into parallel batches respecting worker capacity.
 * 5. Attach risk notes and strategic observations.
 */
export class DecisionEngine {
  /**
   * Create a new Decision Engine instance.
   * @param {Object} profile - Super Z's cognitive profile (from profile.js).
   * @param {Object} [options] - Optional overrides.
   * @param {number} [options.maxWorkers] - Override max parallel workers.
   * @param {number} [options.riskTolerance] - Override risk tolerance threshold.
   */
  constructor(profile = cognitiveProfile, options = {}) {
    this.profile = profile;
    this.maxWorkers = options.maxWorkers ?? profile.thinkingPatterns.parallelExecution.maxWorkers;
    this.riskTolerance = options.riskTolerance ?? profile.thinkingPatterns.riskTolerance;
    this.minBatchSize = profile.thinkingPatterns.parallelExecution.batchSize;
    this.minRounds = 5;
    this.iterationHistory = [];
    this._riskAssessor = null;
    this._prioritizer = null;
  }

  /**
   * Inject a RiskAssessor instance for dependency injection.
   * @param {Object} assessor - Object with assessRisk(task) method.
   */
  setRiskAssessor(assessor) {
    this._riskAssessor = assessor;
  }

  /**
   * Inject a Prioritizer instance for dependency injection.
   * @param {Object} prioritizer - Object with score(task) method.
   */
  setPrioritizer(prioritizer) {
    this._prioritizer = prioritizer;
  }

  // ── Core Planning ──────────────────────────────────────────────────────────

  /**
   * Generate an execution plan from a list of tasks.
   *
   * This is the primary entry point for the Decision Engine. It takes raw tasks,
   * scores them, resolves dependencies, assesses risks, and produces an ordered
   * sequence of parallel batches.
   *
   * @param {Task[]} tasks - Available tasks to plan.
   * @param {ExecutionContext} [context={}] - Current execution context.
   * @returns {ExecutionPlan} Structured execution plan.
   *
   * @example
   *   const plan = engine.plan([
   *     { id: 't1', title: 'Refactor API', repos: ['flux-sdk'], urgency: 0.8, impact: 0.9 },
   *     { id: 't2', title: 'Fix typo', repos: ['flux-cli'], urgency: 0.2, impact: 0.1 },
   *   ], { currentRound: 1, completedTasks: [] });
   */
  plan(tasks, context = {}) {
    const {
      currentRound = 1,
      completedTasks = [],
      failedTasks = [],
      availableWorkers = this.maxWorkers,
      roundResults = null,
    } = context;

    if (tasks.length === 0) {
      return {
        batches: [],
        risks: [],
        notes: ["No tasks provided — nothing to plan."],
        summary: this._emptySummary(),
      };
    }

    // Step 1: Score all tasks
    const scored = tasks.map((task) => ({
      task,
      score: this._scoreTask(task),
      effort: this.estimateEffort(task),
      risk: this.assessRisk(task),
      deps: this.checkDependencies(task, completedTasks),
    }));

    // Step 2: Filter to actionable tasks (dependencies met)
    const actionable = scored
      .filter((s) => s.deps.ready)
      .sort((a, b) => b.score - a.score);

    const blocked = scored.filter((s) => !s.deps.ready);

    // Step 3: Select strategy
    const strategy = this.selectStrategy(actionable.map((s) => s.task));

    // Step 4: Build batches
    const batches = this._buildBatches(actionable, availableWorkers, strategy);

    // Step 5: Collect risks across all tasks
    const risks = scored
      .filter((s) => s.risk.level !== 'low')
      .map((s) => ({
        taskId: s.task.id,
        type: s.risk.type,
        level: s.risk.level,
        mitigations: s.risk.mitigations,
        reasoning: s.risk.reasoning,
      }));

    // Step 6: Generate strategic notes
    const notes = this._generateNotes(actionable, blocked, batches, currentRound);

    // Step 7: Summary
    const summary = this._buildSummary(batches, scored);

    return { batches, risks, notes, summary };
  }

  // ── Risk Assessment ────────────────────────────────────────────────────────

  /**
   * Assess the risk level of a single task.
   *
   * Uses a multi-factor risk model considering:
   * - Scope (number of repos touched)
   * - Dependencies (are they stable?)
   * - Effort (longer tasks are riskier)
   * - Language complexity (systems languages have higher risk ceiling)
   * - Explicit risk tags
   *
   * @param {Task} task - Task to assess.
   * @returns {{ level: string, type: string, mitigations: string[], reasoning: string, score: number }}
   */
  assessRisk(task) {
    if (this._riskAssessor) {
      return this._riskAssessor.assessRisk(task);
    }

    let riskScore = 0;
    let riskType = 'general';
    const mitigations = [];
    const factors = [];

    // Repo count factor (0-25 points)
    const repoCount = task.repos?.length ?? 1;
    if (repoCount >= 4) {
      riskScore += 25;
      riskType = 'cross_repo';
      mitigations.push('Run cross-repo dependency analysis before starting.');
      factors.push(`${repoCount} repos touched — high coordination risk`);
    } else if (repoCount >= 2) {
      riskScore += 15;
      riskType = 'cross_repo';
      mitigations.push('Verify downstream repo compatibility after changes.');
      factors.push(`${repoCount} repos touched — moderate coordination risk`);
    }

    // Effort factor (0-25 points)
    const effort = task.estimatedHours ?? 2;
    if (effort >= 8) {
      riskScore += 25;
      riskType = riskType === 'cross_repo' ? 'cross_repo_large' : 'large_effort';
      mitigations.push('Break into subtasks with intermediate checkpoints.');
      factors.push(`${effort}h estimated — significant scope`);
    } else if (effort >= 4) {
      riskScore += 15;
      mitigations.push('Set round-based checkpoints to track progress.');
      factors.push(`${effort}h estimated — moderate scope`);
    }

    // Language risk factor (0-20 points)
    const hasSystemsLang = task.languages?.some((l) => ['rust', 'c'].includes(l));
    if (hasSystemsLang) {
      riskScore += 20;
      mitigations.push('Add memory-safety tests and runtime checks for systems code.');
      factors.push('Systems-level language — memory safety risk');
    }

    // Dependency factor (0-15 points)
    const depCount = task.dependencies?.length ?? 0;
    if (depCount >= 3) {
      riskScore += 15;
      riskType = 'dependency_chain';
      mitigations.push('Validate all upstream dependencies are stable before starting.');
      factors.push(`${depCount} dependencies — chain failure risk`);
    } else if (depCount >= 1) {
      riskScore += 8;
      factors.push(`${depCount} dependencies — standard dependency risk`);
    }

    // Explicit high-urgency flag (0-15 points)
    if (task.urgency >= 0.9) {
      riskScore += 15;
      riskType = 'time_pressure';
      mitigations.push('Time pressure detected — consider scope reduction to meet deadline.');
      factors.push('High urgency — time pressure risk');
    }

    // Check for explicit risk tags
    const riskTags = task.tags?.filter((t) =>
      ['breaking', 'migration', 'deprecation', 'schema-change'].includes(t)
    ) ?? [];
    if (riskTags.length > 0) {
      riskScore += riskTags.length * 10;
      mitigations.push(`Detected risk tags: ${riskTags.join(', ')}. Plan rollback strategy.`);
      factors.push(`Risk tags: ${riskTags.join(', ')}`);
    }

    // Classify
    let level;
    if (riskScore >= 70) {
      level = 'critical';
    } else if (riskScore >= 50) {
      level = 'high';
    } else if (riskScore >= 25) {
      level = 'medium';
    } else {
      level = 'low';
    }

    return {
      level,
      type: riskType,
      mitigations: mitigations.length > 0 ? mitigations : ['Standard development risk — no special mitigations needed.'],
      reasoning: factors.join('. ') + `.`,
      score: riskScore,
    };
  }

  // ── Dependency Checking ────────────────────────────────────────────────────

  /**
   * Check whether a task's dependencies have been satisfied.
   *
   * @param {Task} task - Task to check.
   * @param {string[]} completedTasks - IDs of completed tasks.
   * @returns {{ ready: boolean, blockedBy: string[] }}
   */
  checkDependencies(task, completedTasks = []) {
    const required = task.dependencies ?? [];
    const blockedBy = required.filter((depId) => !completedTasks.includes(depId));
    return {
      ready: blockedBy.length === 0,
      blockedBy,
    };
  }

  // ── Effort Estimation ──────────────────────────────────────────────────────

  /**
   * Estimate effort for a task.
   *
   * Uses the provided estimate if available, otherwise heuristics based on
   * repos touched, languages, and tags.
   *
   * @param {Task} task - Task to estimate.
   * @returns {{ hours: number, complexity: string, confidence: number }}
   */
  estimateEffort(task) {
    // If explicit estimate provided, trust it
    if (task.estimatedHours) {
      const complexity =
        task.estimatedHours >= 8 ? 'high' : task.estimatedHours >= 4 ? 'medium' : 'low';
      return { hours: task.estimatedHours, complexity, confidence: 0.85 };
    }

    // Heuristic estimation
    let base = 1.0;

    // Repo factor
    base += (task.repos?.length ?? 1) * 0.5;

    // Language factor
    const hasSystems = task.languages?.some((l) => ['rust', 'c'].includes(l));
    if (hasSystems) base += 1.5;

    // Tag factor
    const highEffortTags = ['refactor', 'migration', 'architecture', 'rewrite'];
    const matchingTags = task.tags?.filter((t) => highEffortTags.includes(t)) ?? [];
    base += matchingTags.length * 1.0;

    // Description length proxy for complexity
    const descLen = task.description?.length ?? 0;
    if (descLen > 500) base += 1.0;

    const hours = Math.round(base * 2) / 2; // Round to nearest 0.5
    const complexity = hours >= 8 ? 'high' : hours >= 4 ? 'medium' : 'low';

    return {
      hours,
      complexity,
      confidence: 0.6, // Lower confidence for heuristic estimates
    };
  }

  // ── Strategy Selection ─────────────────────────────────────────────────────

  /**
   * Select execution strategy for a set of tasks.
   *
   * "parallel" — all tasks can run simultaneously (no conflicts).
   * "sequential" — tasks must run one at a time (shared resources).
   * "mixed" — some parallelism possible but with constraints.
   *
   * @param {Task[]} tasks - Tasks to strategize.
   * @returns {"parallel"|"sequential"|"mixed"}
   */
  selectStrategy(tasks) {
    if (tasks.length === 0) return 'sequential';
    if (tasks.length === 1) return 'sequential';

    // Check for repo conflicts (same repo touched by multiple tasks)
    const repoTaskCount = {};
    for (const task of tasks) {
      for (const repo of task.repos ?? ['unknown']) {
        repoTaskCount[repo] = (repoTaskCount[repo] ?? 0) + 1;
      }
    }

    const maxRepoOverlap = Math.max(...Object.values(repoTaskCount));

    // If any repo is touched by more than 3 tasks, go mixed (some sequential needed)
    if (maxRepoOverlap > 3) return 'mixed';

    // If tasks have inter-dependencies, go sequential
    const hasInternalDeps = tasks.some((t) =>
      t.dependencies?.some((d) => tasks.some((other) => other.id === d))
    );
    if (hasInternalDeps) return 'mixed';

    // Default: parallel — Super Z's preferred strategy
    return 'parallel';
  }

  // ── Iteration Check ────────────────────────────────────────────────────────

  /**
   * Determine whether another iteration round is warranted based on results.
   *
   * Super Z defaults to "yes, keep iterating" unless:
   * - Minimum 5 rounds completed AND diminishing returns detected.
   * - All tasks are complete.
   * - Quality metrics are fully met.
   *
   * @param {Object} results - Round results.
   * @param {number} results.roundNumber - Current round number.
   * @param {number} results.improvement - Fractional improvement this round (0-1).
   * @param {number} results.tasksRemaining - Tasks still incomplete.
   * @param {number} results.qualityScore - Overall quality metric (0-1).
   * @returns {{ shouldIterate: boolean, reason: string }}
   */
  shouldIterate(results) {
    const { roundNumber, improvement = 0, tasksRemaining = 0, qualityScore = 0 } = results;

    // If work remains, keep going
    if (tasksRemaining > 0) {
      // But if we've been at it too long, check diminishing returns
      if (roundNumber >= 12) {
        if (improvement < 0.05) {
          return {
            shouldIterate: false,
            reason: `Round ${roundNumber} — diminishing returns (${(improvement * 100).toFixed(1)}% improvement). Consider reframing the problem.`,
          };
        }
      }
      return {
        shouldIterate: true,
        reason: `${tasksRemaining} task(s) remaining. Continue iterating.`,
      };
    }

    // All tasks done but not enough rounds
    if (roundNumber < 5) {
      return {
        shouldIterate: true,
        reason: `All tasks complete at round ${roundNumber}, but minimum is 5. Finding improvement opportunities...`,
      };
    }

    // All tasks done and minimum rounds met — check if quality warrants more
    if (qualityScore < 0.95 && improvement >= 0.05) {
      return {
        shouldIterate: true,
        reason: `Quality at ${(qualityScore * 100).toFixed(1)}% with ${(improvement * 100).toFixed(1)}% improvement rate. Push for higher quality.`,
      };
    }

    // Diminishing returns check
    if (improvement < 0.03) {
      return {
        shouldIterate: false,
        reason: `Quality at ${(qualityScore * 100).toFixed(1)}% with ${(improvement * 100).toFixed(1)}% improvement. Diminishing returns — wrap up.`,
      };
    }

    return {
      shouldIterate: true,
      reason: `Quality improving at ${(improvement * 100).toFixed(1)}% per round. Worth continuing.`,
    };
  }

  // ── Report Generation ──────────────────────────────────────────────────────

  /**
   * Generate a structured progress report for a session.
   *
   * @param {Object} session - Session data.
   * @param {string} session.sessionId - Session identifier.
   * @param {Object[]} session.rounds - Completed round data.
   * @param {Task[]} session.completedTasks - Tasks completed in this session.
   * @param {Task[]} session.remainingTasks - Tasks still pending.
   * @param {Object} session.metrics - Session metrics.
   * @returns {Object} Structured report.
   */
  generateReport(session) {
    const { sessionId, rounds = [], completedTasks = [], remainingTasks = [], metrics = {} } = session;

    const totalRounds = rounds.length;
    const totalCompleted = completedTasks.length;
    const totalRemaining = remainingTasks.length;
    const completionRate = totalCompleted + totalRemaining > 0
      ? totalCompleted / (totalCompleted + totalRemaining)
      : 1;

    return {
      header: {
        sessionId,
        agent: this.profile.identity.name,
        rank: this.profile.identity.rank,
        fleetId: this.profile.identity.fleetId,
        generatedAt: new Date().toISOString(),
      },
      overview: {
        roundsCompleted: totalRounds,
        tasksCompleted: totalCompleted,
        tasksRemaining: totalRemaining,
        completionRate: Math.round(completionRate * 100) + '%',
        targetMet: completionRate >= 0.95,
      },
      metrics: {
        ...(metrics.totalHours && { totalHours: metrics.totalHours }),
        ...(metrics.avgRoundTime && { avgRoundTime: metrics.avgRoundTime }),
        ...(metrics.peakWorkers && { peakWorkers: metrics.peakWorkers }),
        ...(metrics.bugsFound && { bugsFound: metrics.bugsFound }),
        ...(metrics.prsOpened && { prsOpened: metrics.prsOpened }),
      },
      roundBreakdown: rounds.map((round, i) => ({
        round: i + 1,
        tasksAttempted: round.tasksAttempted ?? 0,
        tasksCompleted: round.tasksCompleted ?? 0,
        improvements: round.improvements ?? [],
        issues: round.issues ?? [],
      })),
      nextActions: totalRemaining > 0
        ? [`Complete ${totalRemaining} remaining task(s).`, ...this._suggestNextActions(remainingTasks)]
        : ['Session complete. Consider follow-up improvements in next session.'],
    };
  }

  // ── Private Methods ────────────────────────────────────────────────────────

  /**
   * Score a task using weighted prioritization matching Super Z's style.
   * @param {Task} task
   * @returns {number} Score (0-1).
   * @private
   */
  _scoreTask(task) {
    const weights = {
      impact: 0.35,    // Super Z values high-impact work
      urgency: 0.25,   // Time pressure matters but less than impact
      effort: 0.15,    // Prefer lower effort (inverted: 1 - normalized)
      risk: 0.10,      // Slight preference for lower risk (inverted)
      alignment: 0.15, // Fleet/domain alignment
    };

    const impact = task.impact ?? 0.5;
    const urgency = task.urgency ?? 0.5;

    // Effort: invert so low-effort tasks score higher
    const effortRaw = task.estimatedHours ?? 2;
    const effort = 1 - Math.min(effortRaw / 10, 1);

    // Risk: invert so low-risk tasks score higher, but Super Z tolerates risk
    const riskAssessment = this.assessRisk(task);
    const risk = 1 - Math.min(riskAssessment.score / 100, 1);

    // Alignment: check if task touches Super Z's primary repos or domains
    const primaryRepoOverlap = (task.repos ?? []).filter((r) =>
      this.profile.identity.primaryRepos.includes(r)
    ).length;
    const alignment = primaryRepoOverlap > 0 ? 0.8 + primaryRepoOverlap * 0.05 : 0.4;

    return (
      impact * weights.impact +
      urgency * weights.urgency +
      effort * weights.effort +
      risk * weights.risk +
      alignment * weights.alignment
    );
  }

  /**
   * Build parallel batches from scored tasks.
   * @param {Array} scored - Scored task objects.
   * @param {number} workers - Available worker count.
   * @param {string} strategy - Execution strategy.
   * @returns {TaskBatch[]}
   * @private
   */
  _buildBatches(scored, workers, strategy) {
    const batches = [];

    if (strategy === 'parallel') {
      // All tasks in one parallel batch, respecting worker limit
      for (let i = 0; i < scored.length; i += workers) {
        const batchTasks = scored.slice(i, i + workers);
        const maxTime = Math.max(...batchTasks.map((s) => s.effort.hours));
        batches.push({
          tasks: batchTasks.map((s) => s.task),
          strategy: 'parallel',
          estimatedTime: maxTime,
          rationale: batchTasks.length === workers
            ? 'Full capacity batch — all workers engaged.'
            : `Batch of ${batchTasks.length} tasks — ${workers - batchTasks.length} worker(s) reserved for reactive work.`,
        });
      }
    } else if (strategy === 'sequential') {
      // Each task gets its own batch
      for (const s of scored) {
        batches.push({
          tasks: [s.task],
          strategy: 'sequential',
          estimatedTime: s.effort.hours,
          rationale: 'Sequential execution — resource conflicts or strong ordering.',
        });
      }
    } else {
      // Mixed: group by repo, then parallel within groups
      const repoGroups = this._groupByRepo(scored);
      for (const [repo, group] of repoGroups) {
        const maxTime = Math.max(...group.map((s) => s.effort.hours));
        batches.push({
          tasks: group.map((s) => s.task),
          strategy: 'parallel',
          estimatedTime: maxTime,
          rationale: `Mixed strategy — ${repo} batch. ${group.length} task(s) parallelized within repo scope.`,
        });
      }
    }

    return batches;
  }

  /**
   * Group scored tasks by their primary repository.
   * @param {Array} scored
   * @returns {Map<string, Array>}
   * @private
   */
  _groupByRepo(scored) {
    const groups = new Map();
    for (const s of scored) {
      const repo = s.task.repos?.[0] ?? 'unspecified';
      if (!groups.has(repo)) groups.set(repo, []);
      groups.get(repo).push(s);
    }
    return groups;
  }

  /**
   * Generate strategic notes about the plan.
   * @private
   */
  _generateNotes(actionable, blocked, batches, round) {
    const notes = [];

    if (round <= 1) {
      notes.push('Session start — aggressive parallel dispatch. Bottles will follow progress.');
    }

    if (blocked.length > 0) {
      notes.push(
        `${blocked.length} task(s) blocked by dependencies: ` +
        blocked.map((b) => `${b.task.id} (waiting on: ${b.deps.blockedBy.join(', ')})`).join('; ') +
        '.'
      );
    }

    const totalWorkers = batches.reduce((sum, b) => sum + b.tasks.length, 0);
    const utilization = Math.round((totalWorkers / this.maxWorkers) * 100);
    notes.push(`Worker utilization: ${utilization}% (${totalWorkers}/${this.maxWorkers} workers engaged).`);

    if (utilization < 50) {
      notes.push('Low utilization — consider pulling in blocked tasks or delegating.');
    }

    // Check for cross-repo tasks in same batch
    for (const batch of batches) {
      const repos = new Set(batch.tasks.flatMap((t) => t.repos ?? []));
      if (repos.size > 2) {
        notes.push(
          `Batch contains ${repos.size} repos — monitor for merge conflicts. ` +
          `Consider fleet signal broadcast.`
        );
      }
    }

    return notes;
  }

  /**
   * Build plan summary.
   * @private
   */
  _buildSummary(batches, scored) {
    const totalTasks = scored.length;
    const parallelBatches = batches.filter((b) => b.strategy === 'parallel').length;
    const totalHours = batches.reduce((sum, b) => sum + b.estimatedTime, 0);
    const totalWorkers = batches.reduce((sum, b) => sum + b.tasks.length, 0);
    const utilization = totalWorkers > 0 ? Math.round((totalWorkers / this.maxWorkers) * 100) : 0;
    const avgRisk = scored.length > 0
      ? scored.reduce((sum, s) => sum + s.risk.score, 0) / scored.length
      : 0;

    return {
      totalTasks,
      parallelBatches,
      totalEstimatedHours: Math.round(totalHours * 10) / 10,
      utilization: `${utilization}%`,
      averageRisk: Math.round(avgRisk),
    };
  }

  /**
   * Suggest next actions for remaining tasks.
   * @private
   */
  _suggestNextActions(remainingTasks) {
    return remainingTasks.slice(0, 5).map((t) => `Address: ${t.title} (${t.id})`);
  }

  /**
   * Empty summary for zero-task plans.
   * @private
   */
  _emptySummary() {
    return {
      totalTasks: 0,
      parallelBatches: 0,
      totalEstimatedHours: 0,
      utilization: '0%',
      averageRisk: 0,
    };
  }
}

export default DecisionEngine;
