/**
 * @module cognitive/risk-assessor
 * @description
 * Risk Assessment Module for Super Z — classifies, scores, and provides mitigations
 * for risks associated with development tasks.
 *
 * Super Z's approach to risk is "accept then mitigate": high risk tolerance means
 * risky tasks are NOT avoided, but they are identified early and mitigations are
 * prepared in parallel. This module implements that philosophy.
 *
 * Risk classification:
 *   - LOW (0-24):    Standard development risk. Proceed normally.
 *   - MEDIUM (25-49): Moderate risk. Add tests, document decisions.
 *   - HIGH (50-74):   Significant risk. Prepare rollback plan, consider staging.
 *   - CRITICAL (75+): Potential for serious damage. Mandatory architect review.
 *
 * The risk assessor can be used standalone or injected into the DecisionEngine.
 *
 * @example
 *   import { RiskAssessor } from './risk-assessor.js';
 *
 *   const assessor = new RiskAssessor();
 *   const assessment = assessor.assessRisk({
 *     id: 't1',
 *     title: 'Rewrite auth middleware',
 *     repos: ['flux-gateway', 'flux-runtime', 'flux-sdk'],
 *     tags: ['breaking', 'security'],
 *   });
 *   console.log(assessment.level, assessment.score);
 *
 * @author FLUX Fleet Archive
 * @version 3.7.0
 */

/**
 * @typedef {Object} RiskAssessment
 * @property {string} level - "low" | "medium" | "high" | "critical".
 * @property {number} score - Numeric score (0-100).
 * @property {string} type - Primary risk classification.
 * @property {string[]} factors - Individual risk factors identified.
 * @property {string[]} mitigations - Recommended mitigation strategies.
 * @property {string} reasoning - Human-readable risk reasoning.
 * @property {string} decision - "proceed" | "proceed_with_caution" | "review_required" | "block".
 */

/**
 * Risk patterns registry — predefined risk categories with their indicators and mitigations.
 */
const RISK_PATTERNS = {
  ci_failure: {
    name: 'CI Failure Risk',
    description: 'Change may break continuous integration pipeline.',
    indicators: ['changes test framework', 'modifies ci config', 'adds new language'],
    baseScore: 20,
    mitigations: [
      'Run CI pipeline in dry-run mode before pushing.',
      'Add parallel test execution to catch flaky tests early.',
      'Pin dependency versions in CI config to prevent surprise breaks.',
    ],
  },
  merge_conflict: {
    name: 'Merge Conflict Risk',
    description: 'Change may conflict with in-progress work in target branch.',
    indicators: ['multi-repo change', 'shared dependency modification', 'long-lived branch'],
    baseScore: 25,
    mitigations: [
      'Rebase target branch before starting work.',
      'Send fleet signal to agents working on affected files.',
      'Consider breaking into smaller, focused PRs to reduce conflict surface.',
    ],
  },
  scope_creep: {
    name: 'Scope Creep Risk',
    description: 'Task scope may expand beyond original intent during implementation.',
    indicators: ['large estimated effort', 'vague description', 'refactor tag'],
    baseScore: 15,
    mitigations: [
      'Define explicit acceptance criteria before starting.',
      'Set round-based scope checkpoints (review every 2 rounds).',
      'Document "out of scope" items explicitly in PR description.',
    ],
  },
  dependency_hell: {
    name: 'Dependency Hell Risk',
    description: 'Change may introduce or worsen dependency conflicts.',
    indicators: ['adds new dependency', 'updates major version', 'cross-language dependency'],
    baseScore: 30,
    mitigations: [
      'Audit transitive dependencies before and after change.',
      'Pin exact versions for all new dependencies.',
      'Test in isolated environment before integrating.',
      'Prepare rollback plan for dependency changes.',
    ],
  },
  data_loss: {
    name: 'Data Loss Risk',
    description: 'Change may result in irreversible data loss.',
    indicators: ['schema change', 'database migration', 'data transformation', 'deletion'],
    baseScore: 70,
    mitigations: [
      'MANDATORY: Create database backup before applying schema changes.',
      'Write reversible migration scripts (up AND down).',
      'Test migration on production-like data snapshot.',
      'Implement dry-run mode that validates without executing.',
    ],
  },
  production_outage: {
    name: 'Production Outage Risk',
    description: 'Change may cause service downtime or degradation.',
    indicators: ['infrastructure change', 'config change', 'deployment pipeline', 'hot-reload'],
    baseScore: 65,
    mitigations: [
      'Implement feature flag or gradual rollout.',
      'Prepare instant rollback procedure.',
      'Notify fleet and stakeholders before applying.',
      'Schedule during low-traffic window.',
    ],
  },
  security_vulnerability: {
    name: 'Security Vulnerability Risk',
    description: 'Change may introduce security weaknesses.',
    indicators: ['auth change', 'input handling', 'crypto', 'permission model', 'api endpoint'],
    baseScore: 60,
    mitigations: [
      'Conduct security review of changed code paths.',
      'Add input validation and sanitization tests.',
      'Review permission boundaries for affected endpoints.',
      'Run automated security scanning (SAST/DAST).',
    ],
  },
  performance_regression: {
    name: 'Performance Regression Risk',
    description: 'Change may degrade system performance.',
    indicators: ['hot path modification', 'algorithm change', 'query change', 'caching'],
    baseScore: 35,
    mitigations: [
      'Benchmark before and after changes.',
      'Add performance regression tests to CI.',
      'Profile the change in staging environment.',
      'Set performance budgets for critical paths.',
    ],
  },
  breaking_change: {
    name: 'Breaking Change Risk',
    description: 'Change may break backward compatibility for consumers.',
    indicators: ['api change', 'interface change', 'deprecation', 'contract change'],
    baseScore: 45,
    mitigations: [
      'Document all breaking changes in migration guide.',
      'Provide deprecation period with compatibility shim.',
      'Notify all downstream consumers via fleet broadcast.',
      'Version the API change (semver major bump).',
    ],
  },
  cross_repo_cascade: {
    name: 'Cross-Repo Cascade Risk',
    description: 'Change in one repo may break dependent repos.',
    indicators: ['multi-repo', 'shared library', 'sdk change', 'api contract'],
    baseScore: 40,
    mitigations: [
      'Map all downstream consumers before starting.',
      'Run integration tests across all affected repos.',
      'Coordinate deployment order (publish upstream before downstream updates).',
      'Consider using a compatibility layer during transition.',
    ],
  },
};

/**
 * Risk Assessor — evaluates task risk with Super Z's calculated-boldness philosophy.
 */
export class RiskAssessor {
  /**
   * Create a new Risk Assessor.
   * @param {Object} [options] - Configuration overrides.
   * @param {number} [options.tolerance=0.85] - Risk tolerance threshold (0-1).
   * @param {string[]} [options.redLines] - Risk types that trigger mandatory review.
   * @param {boolean} [options.verbose=false] - Include detailed reasoning in output.
   */
  constructor(options = {}) {
    this.tolerance = options.tolerance ?? 0.85;
    this.redLines = options.redLines ?? [
      'data_loss',
      'production_outage',
      'security_vulnerability',
    ];
    this.verbose = options.verbose ?? true;
    this.assessmentHistory = [];
  }

  // ── Core Assessment ───────────────────────────────────────────────────────

  /**
   * Perform a comprehensive risk assessment for a task.
   *
   * Analyzes the task across multiple risk dimensions:
   *   1. Pattern matching against known risk types.
   *   2. Structural analysis (repos, dependencies, effort).
   *   3. Tag-based risk indicators.
   *   4. Language-specific risk factors.
   *   5. Red line checks for mandatory review triggers.
   *
   * @param {Object} task - Task to assess.
   * @param {string} task.id - Task identifier.
   * @param {string} task.title - Task title.
   * @param {string} [task.description] - Task description.
   * @param {string[]} [task.repos] - Repositories touched.
   * @param {string[]} [task.dependencies] - Task dependencies.
   * @param {string[]} [task.languages] - Languages involved.
   * @param {string[]} [task.tags] - Classification tags.
   * @param {number} [task.estimatedHours] - Estimated effort.
   * @returns {RiskAssessment} Full risk assessment.
   */
  assessRisk(task) {
    const factors = [];
    const mitigations = new Set();
    let totalScore = 0;
    let primaryType = 'general';

    // Step 1: Pattern matching
    const patternMatches = this._matchPatterns(task);
    for (const match of patternMatches) {
      factors.push(`${match.pattern.name}: ${match.matchedIndicator}`);
      for (const m of match.pattern.mitigations) mitigations.add(m);
      totalScore += match.pattern.baseScore;
      // Track highest-scoring pattern as primary type
      if (match.pattern.baseScore >= (RISK_PATTERNS[primaryType]?.baseScore ?? 0)) {
        primaryType = match.key;
      }
    }

    // Step 2: Structural analysis
    const structuralScore = this._structuralRisk(task);
    if (structuralScore > 0) {
      totalScore += structuralScore.score;
      factors.push(...structuralScore.factors);
      for (const m of structuralScore.mitigations) mitigations.add(m);
    }

    // Step 3: Red line check
    const redLineHit = this._checkRedLines(task, patternMatches);
    if (redLineHit) {
      totalScore = Math.max(totalScore, 75); // Force at least critical threshold
      factors.push(`RED LINE: ${redLineHit}. Mandatory architect review required.`);
    }

    // Step 4: Cap and classify
    totalScore = Math.min(totalScore, 100);
    const level = this._classifyScore(totalScore);

    // Step 5: Make proceed/block decision
    const decision = this.shouldProceed(task, totalScore);

    // Step 6: Build reasoning
    const reasoning = this._buildReasoning(task, level, totalScore, factors, redLineHit);

    const assessment = {
      level,
      score: totalScore,
      type: primaryType,
      factors,
      mitigations: [...mitigations],
      reasoning,
      decision: decision.decision,
    };

    // Record for history
    this.assessmentHistory.push({
      taskId: task.id,
      ...assessment,
      timestamp: new Date().toISOString(),
    });

    return assessment;
  }

  // ── Classification ────────────────────────────────────────────────────────

  /**
   * Classify a task into a risk level.
   *
   * @param {Object} task - Task to classify.
   * @returns {"low"|"medium"|"high"|"critical"} Risk level.
   */
  classifyRisk(task) {
    return this.assessRisk(task).level;
  }

  /**
   * Calculate a numeric risk score (0-100) for a task.
   *
   * @param {Object} task - Task to score.
   * @returns {number} Risk score.
   */
  calculateRiskScore(task) {
    return this.assessRisk(task).score;
  }

  // ── Proceed Decision ──────────────────────────────────────────────────────

  /**
   * Decide whether to proceed with a task given its risk score.
   *
   * Super Z's decision logic:
   *   - CRITICAL with red line → BLOCK (no exceptions).
   *   - CRITICAL without red line → REVIEW_REQUIRED (proceed after review).
   *   - HIGH → PROCEED_WITH_CAUTION (mitigations prepared, proceed).
   *   - MEDIUM → PROCEED (standard precautions).
   *   - LOW → PROCEED (no special action needed).
   *
   * Risk tolerance influences the boundary between caution and cautionless proceed.
   *
   * @param {Object} task - Task being evaluated.
   * @param {number} [score] - Pre-calculated risk score (will assess if not provided).
   * @returns {{ decision: string, reasoning: string, conditions: string[] }}
   */
  shouldProceed(task, score) {
    const riskScore = score ?? this.calculateRiskScore(task);
    const level = this._classifyScore(riskScore);

    const result = {
      decision: 'proceed',
      reasoning: '',
      conditions: [],
    };

    if (level === 'critical') {
      // Check for red line hits
      const patternMatches = this._matchPatterns(task);
      const redLineHit = this._checkRedLines(task, patternMatches);

      if (redLineHit) {
        result.decision = 'block';
        result.reasoning = `Red line triggered: ${redLineHit}. This change must not proceed without explicit Architect override.`;
        result.conditions.push('Obtain explicit approval from Fleet Architect.');
        result.conditions.push('Prepare and test rollback procedure.');
        result.conditions.push('Notify all affected fleet members.');
      } else {
        result.decision = 'review_required';
        result.reasoning = `Critical risk score (${riskScore}/100) but no red line hit. ` +
          'Proceed after thorough review and mitigation preparation.';
        result.conditions.push('Complete architectural review.');
        result.conditions.push('Prepare all identified mitigations before starting.');
        result.conditions.push('Set up monitoring for early detection of issues.');
      }
    } else if (level === 'high') {
      result.decision = 'proceed_with_caution';
      result.reasoning = `High risk score (${riskScore}/100). Proceed with mitigations prepared and monitoring active.`;
      result.conditions.push('Implement identified mitigations in parallel with the task.');
      result.conditions.push('Monitor for issues during and after implementation.');
      result.conditions.push('Prepare rollback plan.');
    } else if (level === 'medium') {
      result.decision = 'proceed';
      result.reasoning = `Medium risk score (${riskScore}/100). Standard development precautions sufficient.`;
      result.conditions.push('Write/update tests for affected code paths.');
      result.conditions.push('Document any non-obvious decisions.');
    } else {
      result.decision = 'proceed';
      result.reasoning = `Low risk score (${riskScore}/100). No special precautions needed.`;
    }

    return result;
  }

  // ── Mitigation Registry ───────────────────────────────────────────────────

  /**
   * Get predefined mitigation strategies for a risk type.
   *
   * @param {string} riskType - Key from RISK_PATTERNS (e.g., "ci_failure", "merge_conflict").
   * @returns {{ name: string, description: string, mitigations: string[] } | null}
   */
  getMitigationStrategies(riskType) {
    return RISK_PATTERNS[riskType] ?? null;
  }

  /**
   * Get all available risk pattern definitions.
   * @returns {Object} Full risk pattern registry.
   */
  getAllRiskPatterns() {
    return { ...RISK_PATTERNS };
  }

  // ── Assessment History ────────────────────────────────────────────────────

  /**
   * Get risk assessment history for the current session.
   * @returns {Object[]} Assessment records.
   */
  getHistory() {
    return [...this.assessmentHistory];
  }

  /**
   * Get statistics about assessments performed.
   * @returns {Object} Summary statistics.
   */
  getStats() {
    const total = this.assessmentHistory.length;
    if (total === 0) {
      return { totalAssessments: 0, levelDistribution: {}, averageScore: 0 };
    }

    const levelDist = {};
    for (const a of this.assessmentHistory) {
      levelDist[a.level] = (levelDist[a.level] ?? 0) + 1;
    }

    const avgScore = this.assessmentHistory.reduce((sum, a) => sum + a.score, 0) / total;

    return {
      totalAssessments: total,
      levelDistribution: levelDist,
      averageScore: Math.round(avgScore * 10) / 10,
      criticalCount: levelDist['critical'] ?? 0,
      blockedCount: this.assessmentHistory.filter((a) => a.decision === 'block').length,
    };
  }

  // ── Private Methods ───────────────────────────────────────────────────────

  /**
   * Match a task against known risk patterns.
   * @private
   */
  _matchPatterns(task) {
    const matches = [];
    const taskText = [
      task.title,
      task.description,
      ...(task.tags ?? []),
    ].join(' ').toLowerCase();

    for (const [key, pattern] of Object.entries(RISK_PATTERNS)) {
      for (const indicator of pattern.indicators) {
        if (taskText.includes(indicator.toLowerCase())) {
          matches.push({ key, pattern, matchedIndicator: indicator });
          break; // One match per pattern is enough
        }
      }
    }

    return matches;
  }

  /**
   * Analyze structural risk factors of a task.
   * @private
   */
  _structuralRisk(task) {
    const factors = [];
    const mitigations = [];
    let score = 0;

    // Repo count
    const repoCount = task.repos?.length ?? 1;
    if (repoCount >= 4) {
      score += 20;
      factors.push(`Touches ${repoCount} repositories — high coordination complexity.`);
      mitigations.push('Coordinate deployment order across all affected repos.');
    } else if (repoCount >= 2) {
      score += 10;
      factors.push(`Touches ${repoCount} repositories.`);
    }

    // Dependency depth
    const depCount = task.dependencies?.length ?? 0;
    if (depCount >= 3) {
      score += 15;
      factors.push(`Has ${depCount} upstream dependencies — chain failure risk.`);
      mitigations.push('Validate all upstream dependencies are stable.');
    }

    // Effort magnitude
    const hours = task.estimatedHours ?? 2;
    if (hours >= 8) {
      score += 10;
      factors.push(`Large effort (${hours}h) — increased scope risk.`);
    }

    // Language complexity
    const systemsLangs = task.languages?.filter((l) => ['rust', 'c', 'c++'].includes(l)) ?? [];
    if (systemsLangs.length > 0) {
      score += 15;
      factors.push(`Systems language(s): ${systemsLangs.join(', ')} — memory safety and undefined behavior risk.`);
      mitigations.push('Add memory safety tests and runtime assertions.');
    }

    return {
      score,
      factors,
      mitigations,
    };
  }

  /**
   * Check if any red lines are triggered.
   * @private
   */
  _checkRedLines(task, patternMatches) {
    const matchedKeys = patternMatches.map((m) => m.key);
    for (const redLine of this.redLines) {
      if (matchedKeys.includes(redLine)) {
        return redLine.replace(/_/g, ' ');
      }
    }

    // Also check task tags for red line indicators
    const tagRedLines = {
      data_loss: ['data-loss', 'schema-drop', 'irreversible'],
      production_outage: ['outage', 'downtime', 'production-critical'],
      security_vulnerability: ['security', 'vulnerability', 'exploit'],
    };

    for (const [redLine, tagIndicators] of Object.entries(tagRedLines)) {
      if (this.redLines.includes(redLine)) {
        const taskTags = (task.tags ?? []).map((t) => t.toLowerCase());
        for (const indicator of tagIndicators) {
          if (taskTags.includes(indicator)) {
            return redLine.replace(/_/g, ' ');
          }
        }
      }
    }

    return null;
  }

  /**
   * Classify a numeric score into a risk level.
   * @private
   */
  _classifyScore(score) {
    if (score >= 75) return 'critical';
    if (score >= 50) return 'high';
    if (score >= 25) return 'medium';
    return 'low';
  }

  /**
   * Build human-readable risk reasoning.
   * @private
   */
  _buildReasoning(task, level, score, factors, redLineHit) {
    const lines = [`Task "${task.title}" assessed at ${level.toUpperCase()} risk (${score}/100).`];

    if (redLineHit) {
      lines.push(`⚠️ RED LINE: ${redLineHit}. This is a non-negotiable safety boundary.`);
    }

    if (factors.length > 0) {
      lines.push('Risk factors identified:');
      for (const factor of factors) {
        lines.push(`  - ${factor}`);
      }
    }

    const toleranceNote = this.tolerance >= 0.8
      ? 'Note: Agent has high risk tolerance. This assessment reflects calculated boldness, not recklessness.'
      : `Note: Agent risk tolerance is ${this.tolerance}. Assessment calibrated accordingly.`;
    lines.push(toleranceNote);

    return lines.join('\n');
  }
}

/**
 * Export the risk patterns registry for external reference.
 */
export { RISK_PATTERNS };

export default RiskAssessor;
