/**
 * @module cognitive/iteration-manager
 * @description
 * Iteration Manager for Super Z — tracks rounds of work, analyzes results, and
 * decides when to continue iterating versus wrap up a session.
 *
 * Super Z's iteration philosophy:
 *   - Minimum 5 rounds per session (no exceptions).
 *   - Target 7 rounds for most sessions.
 *   - Forced evaluation after 12 rounds.
 *   - A session ending before round 5 has left value on the table.
 *
 * The iteration manager is the "conscience" that prevents premature completion
 * and the "brake" that prevents infinite polishing loops.
 *
 * @example
 *   import { IterationManager } from './iteration-manager.js';
 *
 *   const im = new IterationManager();
 *   im.startRound(1, [task1, task2]);
 *   im.recordResults(1, { improvements: ['Reduced latency by 40%'], issues: ['One test flaky'] });
 *   const analysis = im.analyzeRoundResults(1);
 *   const nextBatch = im.planNextRound(im.getRounds(), [task3, task4]);
 *   const diminishing = im.diminishingReturnsCheck(5, improvements);
 *
 * @author FLUX Fleet Archive
 * @version 3.7.0
 */

/**
 * @typedef {Object} RoundRecord
 * @property {number} roundNumber - Round number (1-indexed).
 * @property {Object[]} tasksAttempted - Tasks assigned to this round.
 * @property {Object[]} tasksCompleted - Tasks completed in this round.
 * @property {Object[]} tasksFailed - Tasks that failed in this round.
 * @property {string[]} improvements - Improvements made this round.
 * @property {string[]} issues - Issues discovered this round.
 * @property {number} qualityScore - Quality assessment (0-1).
 * @property {number} improvementRate - Improvement vs previous round (0-1).
 * @property {number} duration - Time spent on this round in minutes.
 * @property {string[]} notes - Free-form observations.
 * @property {string} startedAt - ISO timestamp when round started.
 * @property {string} completedAt - ISO timestamp when round completed.
 */

/**
 * @typedef {Object} NextRoundPlan
 * @property {Object[]} tasks - Tasks for the next round.
 * @property {string} strategy - "continue" | "pivot" | "deepen" | "wrap_up".
 * @property {string} rationale - Why this plan was chosen.
 * @property {string[]} focusAreas - Specific areas to focus on.
 * @property {string[]} avoidAreas - Areas that have been exhausted or are counterproductive.
 */

/**
 * @typedef {Object} SessionSummary
 * @property {string} sessionId - Session identifier.
 * @property {number} totalRounds - Total rounds completed.
 * @property {number} totalTasksCompleted - Cumulative tasks completed.
 * @property {number} totalTasksFailed - Cumulative tasks failed.
 * @property {number} averageQuality - Average quality across rounds.
 * @property {number} peakQuality - Highest quality achieved in any round.
 * @property {number} averageImprovement - Average improvement rate.
 * @property {boolean} diminishingReturns - Whether diminishing returns were detected.
 * @property {number} roundOfDiminishing - Round where diminishing returns started (0 if never).
 * @property {string[]} topImprovements - Most significant improvements across all rounds.
 * @property {string[]} recurringIssues - Issues that appeared in multiple rounds.
 * @property {string[]} lessonsLearned - Key takeaways from the session.
 * @property {RoundRecord[]} rounds - Full round-by-round data.
 * @property {string} conclusion - Session outcome summary.
 */

/**
 * Iteration Manager — orchestrates the rhythm of Super Z's work sessions.
 */
export class IterationManager {
  /**
   * Create a new Iteration Manager.
   * @param {Object} [options] - Configuration overrides.
   * @param {number} [options.minRounds=5] - Minimum rounds before considering session complete.
   * @param {number} [options.targetRounds=7] - Target number of rounds for a typical session.
   * @param {number} [options.maxRoundsBeforeEval=12] - Force evaluation at this round.
   * @param {number} [options.diminishingThreshold=0.05] - Improvement rate below which diminishing returns are detected.
   */
  constructor(options = {}) {
    this.minRounds = options.minRounds ?? 5;
    this.targetRounds = options.targetRounds ?? 7;
    this.maxRoundsBeforeEval = options.maxRoundsBeforeEval ?? 12;
    this.diminishingThreshold = options.diminishingThreshold ?? 0.05;

    /** @type {Map<number, RoundRecord>} */
    this._rounds = new Map();

    this._currentRound = 0;
    this._sessionStartTime = null;
  }

  // ── Round Lifecycle ───────────────────────────────────────────────────────

  /**
   * Start a new iteration round.
   *
   * @param {number} roundNumber - Round number (auto-incremented if not provided).
   * @param {Object[]} [tasks=[]] - Tasks assigned to this round.
   * @returns {number} The round number that was started.
   */
  startRound(roundNumber, tasks = []) {
    if (!this._sessionStartTime) {
      this._sessionStartTime = new Date().toISOString();
    }

    this._currentRound = roundNumber ?? this._currentRound + 1;
    this._rounds.set(this._currentRound, {
      roundNumber: this._currentRound,
      tasksAttempted: tasks,
      tasksCompleted: [],
      tasksFailed: [],
      improvements: [],
      issues: [],
      qualityScore: 0,
      improvementRate: 0,
      duration: 0,
      notes: [],
      startedAt: new Date().toISOString(),
      completedAt: null,
    });

    return this._currentRound;
  }

  /**
   * Record results for a completed round.
   *
   * @param {number} roundNumber - Round to record results for.
   * @param {Object} results - Round results.
   * @param {Object[]} [results.tasksCompleted=[]] - Tasks completed.
   * @param {Object[]} [results.tasksFailed=[]] - Tasks that failed.
   * @param {string[]} [results.improvements=[]] - Improvements made.
   * @param {string[]} [results.issues=[]] - Issues discovered.
   * @param {number} [results.qualityScore=0.5] - Quality assessment (0-1).
   * @param {number} [results.duration=0] - Duration in minutes.
   * @param {string[]} [results.notes=[]] - Observations.
   */
  recordResults(roundNumber, results = {}) {
    const round = this._rounds.get(roundNumber);
    if (!round) {
      throw new Error(`Round ${roundNumber} not found. Start it first with startRound().`);
    }

    const {
      tasksCompleted = [],
      tasksFailed = [],
      improvements = [],
      issues = [],
      qualityScore = 0.5,
      duration = 0,
      notes = [],
    } = results;

    // Calculate improvement rate vs previous round
    const prevRound = this._rounds.get(roundNumber - 1);
    let improvementRate = 0;
    if (prevRound && prevRound.qualityScore > 0) {
      improvementRate = Math.max(0, (qualityScore - prevRound.qualityScore) / prevRound.qualityScore);
    }

    round.tasksCompleted = tasksCompleted;
    round.tasksFailed = tasksFailed;
    round.improvements = improvements;
    round.issues = issues;
    round.qualityScore = Math.min(Math.max(qualityScore, 0), 1);
    round.improvementRate = Math.min(improvementRate, 1);
    round.duration = duration;
    round.notes = notes;
    round.completedAt = new Date().toISOString();

    return round;
  }

  // ── Analysis ──────────────────────────────────────────────────────────────

  /**
   * Analyze results from a specific round to identify what worked and what didn't.
   *
   * @param {number} roundNumber - Round to analyze.
   * @returns {Object} Round analysis.
   */
  analyzeRoundResults(roundNumber) {
    const round = this._rounds.get(roundNumber);
    if (!round) {
      return { error: `Round ${roundNumber} not found.`, roundNumber };
    }

    const prevRound = this._rounds.get(roundNumber - 1);
    const analysis = {
      roundNumber,
      qualityTrend: 'stable',
      productivity: 'normal',
      observations: [],
      warnings: [],
    };

    // Quality trend
    if (prevRound) {
      if (round.qualityScore > prevRound.qualityScore + 0.05) {
        analysis.qualityTrend = 'improving';
        analysis.observations.push(
          `Quality improved by ${((round.qualityScore - prevRound.qualityScore) * 100).toFixed(1)}% ` +
          `(${prevRound.qualityScore.toFixed(2)} → ${round.qualityScore.toFixed(2)}).`
        );
      } else if (round.qualityScore < prevRound.qualityScore - 0.05) {
        analysis.qualityTrend = 'declining';
        analysis.observations.push(
          `Quality declined by ${((prevRound.qualityScore - round.qualityScore) * 100).toFixed(1)}%. ` +
          'Investigate whether recent changes introduced regressions.'
        );
        analysis.warnings.push('Quality regression detected — review recent changes carefully.');
      } else {
        analysis.qualityTrend = 'stable';
        analysis.observations.push('Quality stable — within ±5% of previous round.');
      }
    }

    // Productivity assessment
    const completionRate = round.tasksAttempted.length > 0
      ? round.tasksCompleted.length / round.tasksAttempted.length
      : 0;

    if (completionRate >= 0.8) {
      analysis.productivity = 'high';
      analysis.observations.push(
        `High productivity: ${round.tasksCompleted.length}/${round.tasksAttempted.length} tasks completed.`
      );
    } else if (completionRate >= 0.5) {
      analysis.productivity = 'normal';
      analysis.observations.push(
        `Normal productivity: ${round.tasksCompleted.length}/${round.tasksAttempted.length} tasks completed.`
      );
    } else if (round.tasksAttempted.length > 0) {
      analysis.productivity = 'low';
      analysis.observations.push(
        `Low productivity: ${round.tasksCompleted.length}/${round.tasksAttempted.length} tasks completed. ` +
        'Consider reducing task scope or addressing blockers.'
      );
      analysis.warnings.push('Low completion rate — tasks may be over-scoped or blocked.');
    }

    // Issue analysis
    if (round.issues.length > 3) {
      analysis.warnings.push(
        `${round.issues.length} issues discovered — above normal threshold. ` +
        'Consider whether the current approach is viable.'
      );
    }

    // Diminishing returns warning
    if (round.improvementRate < this.diminishingThreshold && prevRound) {
      analysis.observations.push(
        `Improvement rate at ${(round.improvementRate * 100).toFixed(1)}% — approaching diminishing returns.`
      );
    }

    // Recommended next action
    if (roundNumber < this.minRounds) {
      analysis.recommendedAction = 'continue';
      analysis.observations.push(
        `Round ${roundNumber} of minimum ${this.minRounds}. Must continue iterating.`
      );
    } else if (round.improvementRate < this.diminishingThreshold) {
      analysis.recommendedAction = 'evaluate';
      analysis.observations.push('Diminishing returns detected. Evaluate whether to continue or wrap up.');
    } else {
      analysis.recommendedAction = 'continue';
      analysis.observations.push('Good improvement trajectory. Continue iterating.');
    }

    return analysis;
  }

  /**
   * Plan the next round based on previous rounds and remaining work.
   *
   * @param {RoundRecord[]} previousRounds - Completed round records.
   * @param {Object[]} remainingTasks - Tasks still to be done.
   * @returns {NextRoundPlan} Plan for the next round.
   */
  planNextRound(previousRounds, remainingTasks = []) {
    const nextRoundNumber = previousRounds.length + 1;
    const lastRound = previousRounds[previousRounds.length - 1];
    const plan = {
      tasks: [...remainingTasks],
      strategy: 'continue',
      rationale: '',
      focusAreas: [],
      avoidAreas: [],
    };

    // No remaining tasks — find improvements
    if (remainingTasks.length === 0) {
      if (nextRoundNumber < this.minRounds) {
        plan.strategy = 'deepen';
        plan.rationale = `No remaining tasks but below minimum ${this.minRounds} rounds. ` +
          'Deepening quality and finding improvement opportunities.';
        plan.focusAreas = ['code quality', 'test coverage', 'documentation', 'edge cases'];

        // Analyze what areas need improvement from previous rounds
        if (lastRound) {
          for (const issue of lastRound.issues) {
            plan.focusAreas.push(`Address: ${issue}`);
          }
        }
      } else {
        plan.strategy = 'wrap_up';
        plan.rationale = 'All tasks complete and minimum rounds met. Wrapping up session.';
        plan.tasks = [];
      }

      return plan;
    }

    // Analyze previous round performance to inform strategy
    if (lastRound) {
      const lastCompletionRate = lastRound.tasksAttempted.length > 0
        ? lastRound.tasksCompleted.length / lastRound.tasksAttempted.length
        : 1;

      // If last round had low completion, reduce scope
      if (lastCompletionRate < 0.5) {
        plan.strategy = 'pivot';
        plan.rationale = `Previous round had ${Math.round(lastCompletionRate * 100)}% completion rate. ` +
          'Reducing scope and focusing on highest-priority tasks.';
        // Keep only top priority tasks
        plan.tasks = remainingTasks.slice(0, Math.max(2, Math.ceil(remainingTasks.length * 0.5)));
        plan.focusAreas.push('Reduce scope per task to increase completion rate.');
      }

      // If last round had many issues, focus on stabilization
      if (lastRound.issues.length >= 3) {
        if (plan.strategy !== 'pivot') plan.strategy = 'continue';
        plan.rationale += ' Previous round surfaced issues that need attention.';
        plan.focusAreas.push('Address issues from previous round before adding new work.');
        plan.avoidAreas.push('Introducing new changes that could compound existing issues.');
      }

      // If improvement rate is high, keep momentum
      if (lastRound.improvementRate > 0.1) {
        if (plan.strategy !== 'pivot') plan.strategy = 'deepen';
        plan.rationale += ' Strong improvement trajectory — push deeper into remaining work.';
      }

      // Forced evaluation checkpoint
      if (nextRoundNumber >= this.maxRoundsBeforeEval) {
        plan.strategy = 'wrap_up';
        plan.rationale = `Reached round ${nextRoundNumber} (evaluation threshold). ` +
          'Must evaluate whether continued iteration is productive.';
        plan.focusAreas.push('Session evaluation — is the approach still viable?');
        plan.focusAreas.push('Document what was learned before continuing or stopping.');
      }
    }

    // Default rationale if none was set
    if (!plan.rationale) {
      plan.rationale = `Round ${nextRoundNumber}: ${plan.tasks.length} tasks remaining. Standard continuation.`;
    }

    // Always include fleet coordination focus area for multi-repo tasks
    const reposInvolved = new Set(plan.tasks.flatMap((t) => t.repos ?? []));
    if (reposInvolved.size > 1) {
      plan.focusAreas.push(`Cross-repo coordination for ${reposInvolved.size} repos.`);
    }

    return plan;
  }

  // ── Diminishing Returns ───────────────────────────────────────────────────

  /**
   * Check whether diminishing returns have been reached.
   *
   * Uses a sliding window approach: compares improvement rates over the last
   * few rounds rather than just the last one, to filter out noise.
   *
   * @param {number} roundNumber - Current round number.
   * @param {number[]} [improvements] - Improvement rates for each round (0-1).
   *   If not provided, calculated from recorded rounds.
   * @returns {{ diminishing: boolean, confidence: number, reason: string }}
   */
  diminishingReturnsCheck(roundNumber, improvements) {
    // Gather improvement rates
    const rates = improvements ?? this._getImprovementRates();
    if (rates.length < 2) {
      return {
        diminishing: false,
        confidence: 0,
        reason: 'Insufficient data — need at least 2 rounds of improvement data.',
      };
    }

    // Sliding window of last 3 rounds (or fewer if not enough data)
    const windowSize = Math.min(3, rates.length);
    const recentRates = rates.slice(-windowSize);
    const avgRate = recentRates.reduce((s, r) => s + r, 0) / recentRates.length;

    // Also check trend: are rates declining?
    const trend = recentRates.length >= 2
      ? recentRates[recentRates.length - 1] - recentRates[0]
      : 0;

    // Below minimum threshold — clear diminishing returns
    if (avgRate < this.diminishingThreshold * 0.5) {
      return {
        diminishing: true,
        confidence: 0.9,
        reason: `Average improvement rate over last ${windowSize} rounds: ` +
          `${(avgRate * 100).toFixed(1)}% — well below ${(this.diminishingThreshold * 100).toFixed(1)}% threshold. ` +
          'Diminishing returns clearly detected.',
      };
    }

    // Below threshold but not severe
    if (avgRate < this.diminishingThreshold) {
      return {
        diminishing: true,
        confidence: 0.6,
        reason: `Average improvement rate: ${(avgRate * 100).toFixed(1)}% — below threshold. ` +
          'Approaching diminishing returns. Consider wrapping up in 1-2 rounds.',
      };
    }

    // Above threshold but declining trend
    if (trend < -this.diminishingThreshold) {
      return {
        diminishing: true,
        confidence: 0.5,
        reason: `Improvement rate declining (${(trend * 100).toFixed(1)}% trend over last ${windowSize} rounds). ` +
          'Not yet at threshold but trajectory suggests diminishing returns ahead.',
      };
    }

    // No diminishing returns
    return {
      diminishing: false,
      confidence: 0.7,
      reason: `Average improvement rate: ${(avgRate * 100).toFixed(1)}% — above threshold. ` +
        'Productive iteration. Continue.',
    };
  }

  // ── Session Summary ───────────────────────────────────────────────────────

  /**
   * Generate a comprehensive session summary from all completed rounds.
   *
   * This is NOT a brief summary — it's the detailed 26K-word-style documentation
   * that Super Z produces. It includes every data point, every observation, and
   * every lesson learned.
   *
   * @param {string} [sessionId] - Session identifier.
   * @returns {SessionSummary} Comprehensive session summary.
   */
  generateSessionSummary(sessionId) {
    const rounds = this.getAllRounds();
    const totalRounds = rounds.length;

    if (totalRounds === 0) {
      return {
        sessionId: sessionId ?? 'unknown',
        totalRounds: 0,
        totalTasksCompleted: 0,
        totalTasksFailed: 0,
        averageQuality: 0,
        peakQuality: 0,
        averageImprovement: 0,
        diminishingReturns: false,
        roundOfDiminishing: 0,
        topImprovements: [],
        recurringIssues: [],
        lessonsLearned: ['No rounds recorded — session not started or empty.'],
        rounds: [],
        conclusion: 'Session produced no output. Either not started or all rounds were empty.',
      };
    }

    // Aggregate metrics
    const totalCompleted = rounds.reduce((s, r) => s + r.tasksCompleted.length, 0);
    const totalFailed = rounds.reduce((s, r) => s + r.tasksFailed.length, 0);
    const qualityScores = rounds.map((r) => r.qualityScore).filter((q) => q > 0);
    const avgQuality = qualityScores.length > 0
      ? qualityScores.reduce((s, q) => s + q, 0) / qualityScores.length
      : 0;
    const peakQuality = qualityScores.length > 0 ? Math.max(...qualityScores) : 0;
    const improvementRates = rounds.map((r) => r.improvementRate).filter((r) => r > 0);
    const avgImprovement = improvementRates.length > 0
      ? improvementRates.reduce((s, r) => s + r, 0) / improvementRates.length
      : 0;

    // Collect all improvements across rounds
    const allImprovements = rounds.flatMap((r) => r.improvements);
    const topImprovements = [...new Set(allImprovements)].slice(0, 10);

    // Find recurring issues (appear in 2+ rounds)
    const issueCounts = {};
    for (const round of rounds) {
      for (const issue of round.issues) {
        const normalized = issue.toLowerCase().trim();
        issueCounts[normalized] = (issueCounts[normalized] ?? 0) + 1;
      }
    }
    const recurringIssues = Object.entries(issueCounts)
      .filter(([_, count]) => count >= 2)
      .map(([issue, count]) => `${issue} (appeared in ${count} rounds)`)
      .sort((a, b) => {
        const countA = parseInt(a.match(/\d+/)?.[0] ?? '0');
        const countB = parseInt(b.match(/\d+/)?.[0] ?? '0');
        return countB - countA;
      });

    // Check for diminishing returns
    const dimCheck = this.diminishingReturnsCheck(totalRounds);
    const roundOfDiminishing = dimCheck.diminishing
      ? this._findDiminishingRound(rounds)
      : 0;

    // Generate lessons learned
    const lessonsLearned = this._extractLessons(rounds);

    // Build conclusion
    const conclusion = this._buildConclusion({
      totalRounds,
      totalCompleted,
      totalFailed,
      avgQuality,
      peakQuality,
      dimCheck,
      recurringIssues,
    });

    return {
      sessionId: sessionId ?? `session-${this._sessionStartTime ?? Date.now()}`,
      totalRounds,
      totalTasksCompleted: totalCompleted,
      totalTasksFailed: totalFailed,
      averageQuality: Math.round(avgQuality * 100) / 100,
      peakQuality: Math.round(peakQuality * 100) / 100,
      averageImprovement: Math.round(avgImprovement * 100) / 100,
      diminishingReturns: dimCheck.diminishing,
      roundOfDiminishing,
      topImprovements,
      recurringIssues,
      lessonsLearned,
      rounds,
      conclusion,
    };
  }

  // ── Accessors ─────────────────────────────────────────────────────────────

  /**
   * Get all recorded rounds.
   * @returns {RoundRecord[]} All round records.
   */
  getAllRounds() {
    return [...this._rounds.values()].sort((a, b) => a.roundNumber - b.roundNumber);
  }

  /**
   * Get a specific round record.
   * @param {number} roundNumber
   * @returns {RoundRecord|undefined}
   */
  getRound(roundNumber) {
    return this._rounds.get(roundNumber);
  }

  /**
   * Get the current round number.
   * @returns {number}
   */
  getCurrentRound() {
    return this._currentRound;
  }

  /**
   * Get total duration of all completed rounds in minutes.
   * @returns {number}
   */
  getTotalDuration() {
    return [...this._rounds.values()].reduce((s, r) => s + r.duration, 0);
  }

  // ── Private Methods ───────────────────────────────────────────────────────

  /**
   * Extract improvement rates from recorded rounds.
   * @private
   */
  _getImprovementRates() {
    return [...this._rounds.values()]
      .sort((a, b) => a.roundNumber - b.roundNumber)
      .map((r) => r.improvementRate);
  }

  /**
   * Find which round diminishing returns started.
   * @private
   */
  _findDiminishingRound(rounds) {
    const sorted = [...rounds].sort((a, b) => a.roundNumber - b.roundNumber);
    for (const round of sorted) {
      if (round.improvementRate < this.diminishingThreshold) {
        return round.roundNumber;
      }
    }
    return 0;
  }

  /**
   * Extract lessons learned from round observations.
   * @private
   */
  _extractLessons(rounds) {
    const lessons = [];
    const seen = new Set();

    // Pattern-based lesson extraction
    for (const round of rounds) {
      // If a task failed and was later fixed, that's a lesson
      if (round.tasksFailed.length > 0 && round.tasksCompleted.length > 0) {
        lessons.push(
          `Round ${round.roundNumber}: Failures occurred alongside successes. ` +
          'Ensure failing tasks are documented for future reference.'
        );
      }

      // If quality declined, that's a lesson
      if (round.improvementRate < 0) {
        lessons.push(
          `Round ${round.roundNumber}: Quality declined — investigate what change caused regression.`
        );
      }

      // Custom notes are lessons
      for (const note of round.notes) {
        if (!seen.has(note)) {
          seen.add(note);
          lessons.push(`Round ${round.roundNumber}: ${note}`);
        }
      }

      // Specific improvements are lessons
      for (const imp of round.improvements) {
        if (!seen.has(imp)) {
          seen.add(imp);
          lessons.push(imp);
        }
      }
    }

    return lessons.slice(0, 20); // Cap at 20 lessons
  }

  /**
   * Build session conclusion.
   * @private
   */
  _buildConclusion({ totalRounds, totalCompleted, totalFailed, avgQuality, peakQuality, dimCheck, recurringIssues }) {
    const parts = [];

    parts.push(`Session completed ${totalRounds} round(s) with ${totalCompleted} task(s) completed.`);

    if (totalFailed > 0) {
      parts.push(`${totalFailed} task(s) failed — these should be re-evaluated in a future session.`);
    }

    parts.push(`Average quality: ${(avgQuality * 100).toFixed(1)}%. Peak quality: ${(peakQuality * 100).toFixed(1)}%.`);

    if (totalRounds < this.minRounds) {
      parts.push(
        `⚠️ Session ended after only ${totalRounds} round(s) — below the minimum ${this.minRounds} rounds. ` +
        'Value was likely left on the table.'
      );
    }

    if (dimCheck.diminishing) {
      parts.push(`Diminishing returns detected: ${dimCheck.reason}`);
    }

    if (recurringIssues.length > 0) {
      parts.push(
        `Recurring issues detected: ${recurringIssues.length}. ` +
        'These should be addressed systematically rather than ad-hoc.'
      );
    }

    if (avgQuality >= 0.9 && totalRounds >= this.minRounds) {
      parts.push('Session was productive and high-quality. Good work.');
    }

    return parts.join(' ');
  }
}

export default IterationManager;
