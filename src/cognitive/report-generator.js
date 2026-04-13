/**
 * @module cognitive/report-generator
 * @description
 * Report Generator for Super Z — produces structured documentation in Super Z's
 * distinctive style: comprehensive (not summarized), cross-referenced, table-heavy,
 * and formatted as "messages in bottles" per the fleet communication protocol.
 *
 * Super Z's documentation philosophy:
 *   - A session log should be EXHAUSTIVE, not a summary.
 *   - Target: 20,000-30,000 words per session (this module provides the structure).
 *   - Every decision should be traceable to its reasoning.
 *   - Cross-repo references are always included.
 *   - Reports serve as "messages in bottles" — self-contained context packages
 *     that can be consumed asynchronously by any fleet member or future session.
 *
 * Output formats:
 *   - Bottle messages: fleet communication format with structured sections.
 *   - Session logs: detailed round-by-round documentation.
 *   - PR descriptions: structured pull request bodies with cross-repo context.
 *   - Progress updates: fleet-wide status broadcasts.
 *
 * @example
 *   import { ReportGenerator } from './report-generator.js';
 *   import { cognitiveProfile } from './profile.js';
 *
 *   const rg = new ReportGenerator(cognitiveProfile);
 *   const bottle = rg.generateBottle({ content: 'Task X complete', intent: 'DONE' });
 *   console.log(bottle);
 *
 * @author FLUX Fleet Archive
 * @version 3.7.0
 */

import { cognitiveProfile } from './profile.js';

/**
 * @typedef {Object} BottleMessage
 * @property {string} protocol - Always "BOTTLE" for message-in-a-bottle protocol.
 * @property {string} version - Bottle protocol version.
 * @property {Object} header - Origin and addressing metadata.
 * @property {string} header.origin - Sender identity.
 * @property {string} header.fleetId - Fleet identifier.
 * @property {string} header.timestamp - ISO timestamp.
 * @property {string} header.bottleId - Unique bottle identifier.
 * @property {string} header.intent - Message intent (SYNC|ALERT|DONE|WARN|COORD).
 * @property {string[]} header.addressedTo - Intended recipients.
 * @property {Object} body - Message body sections.
 * @property {string} body.context - What this relates to.
 * @property {string} body.content - The core message.
 * @property {Object} [body.metrics] - Quantitative data.
 * @property {string[]} [body.cross_repo_impact] - Cross-repo references.
 * @property {string[]} [body.risks_identified] - Risks found.
 * @property {string[]} [body.lessons_learned] - Lessons for future sessions.
 * @property {string[]} [body.next_actions] - What happens next.
 * @property {string} signature - Agent signature line.
 */

/**
 * Report Generator — produces all documentation artifacts in Super Z's style.
 */
export class ReportGenerator {
  /**
   * Create a new Report Generator.
   * @param {Object} [profile] - Super Z's cognitive profile.
   */
  constructor(profile = cognitiveProfile) {
    this.profile = profile;
    this.protocolVersion = '2.1';
    this.bottleCounter = 0;
    this._bottleLog = [];
  }

  // ── Bottle Protocol ───────────────────────────────────────────────────────

  /**
   * Generate a message-in-a-bottle for fleet communication.
   *
   * Bottles are self-contained context packages that can be consumed asynchronously.
   * They follow a strict schema defined in the cognitive profile's bottleFormat.
   *
   * @param {Object} content - Bottle content.
   * @param {string} content.content - Core message body.
   * @param {string} [content.context=''] - Context for this message.
   * @param {string} [content.intent='SYNC'] - Message intent.
   * @param {string[]} [content.addressedTo=[]] - Intended recipients.
   * @param {Object} [content.metrics] - Quantitative data to include.
   * @param {string[]} [content.crossRepoImpact=[]] - Cross-repo references.
   * @param {string[]} [content.risksIdentified=[]] - Risks to flag.
   * @param {string[]} [content.lessonsLearned=[]] - Lessons to record.
   * @param {string[]} [content.nextActions=[]] - Next steps.
   * @param {string} [type='custom'] - Bottle type for template selection.
   * @returns {BottleMessage} Structured bottle message.
   */
  generateBottle(content, type = 'custom') {
    this.bottleCounter++;
    const now = new Date();

    const bottleId = `BTL-${this.profile.identity.fleetId}-${now.getFullYear()}` +
      `${String(now.getMonth() + 1).padStart(2, '0')}` +
      `${String(now.getDate()).padStart(2, '0')}-` +
      `${String(this.bottleCounter).padStart(4, '0')}`;

    const intent = content.intent ?? this._intentForType(type);

    const bottle = {
      protocol: 'BOTTLE',
      version: this.protocolVersion,
      header: {
        origin: this.profile.identity.name,
        fleetId: this.profile.identity.fleetId,
        rank: this.profile.identity.rank,
        timestamp: now.toISOString(),
        bottleId,
        intent,
        addressedTo: content.addressedTo ?? ['fleet-all'],
        type,
      },
      body: {
        context: content.context ?? '',
        content: content.content,
        ...(content.metrics && { metrics: content.metrics }),
        ...(content.crossRepoImpact && {
          cross_repo_impact: content.crossRepoImpact,
        }),
        ...(content.risksIdentified && {
          risks_identified: content.risksIdentified,
        }),
        ...(content.lessonsLearned && {
          lessons_learned: content.lessonsLearned,
        }),
        ...(content.nextActions && { next_actions: content.nextActions }),
      },
      signature: `— ${this.profile.identity.name} [${this.profile.identity.rank}] | ${this.profile.identity.fleetId}`,
    };

    this._bottleLog.push(bottle);
    return bottle;
  }

  /**
   * Render a bottle message as formatted markdown.
   *
   * @param {BottleMessage} bottle - Bottle to render.
   * @returns {string} Markdown-formatted bottle message.
   */
  renderBottle(bottle) {
    const lines = [];
    const h = bottle.header;

    lines.push('```');
    lines.push(`🫧 BOTTLE v${bottle.version} | ${bottle.protocol} PROTOCOL`);
    lines.push(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    lines.push(`Origin:    ${h.origin} [${h.rank}]`);
    lines.push(`Fleet:     ${h.fleetId}`);
    lines.push(`Time:      ${h.timestamp}`);
    lines.push(`Bottle ID: ${h.bottleId}`);
    lines.push(`Intent:    ${h.intent}`);
    lines.push(`To:        ${h.addressedTo.join(', ')}`);
    lines.push(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    lines.push('');

    // Context
    if (bottle.body.context) {
      lines.push('## Context');
      lines.push(bottle.body.context);
      lines.push('');
    }

    // Content
    lines.push('## Content');
    lines.push(bottle.body.content);
    lines.push('');

    // Metrics
    if (bottle.body.metrics) {
      lines.push('## Metrics');
      lines.push('| Metric | Value |');
      lines.push('|--------|-------|');
      for (const [key, value] of Object.entries(bottle.body.metrics)) {
        lines.push(`| ${key} | ${value} |`);
      }
      lines.push('');
    }

    // Cross-repo impact
    if (bottle.body.cross_repo_impact?.length > 0) {
      lines.push('## Cross-Repo Impact');
      for (const impact of bottle.body.cross_repo_impact) {
        lines.push(`- ${impact}`);
      }
      lines.push('');
    }

    // Risks
    if (bottle.body.risks_identified?.length > 0) {
      lines.push('## Risks Identified');
      for (const risk of bottle.body.risks_identified) {
        lines.push(`- ⚠️ ${risk}`);
      }
      lines.push('');
    }

    // Lessons
    if (bottle.body.lessons_learned?.length > 0) {
      lines.push('## Lessons Learned');
      for (const lesson of bottle.body.lessons_learned) {
        lines.push(`- 📝 ${lesson}`);
      }
      lines.push('');
    }

    // Next actions
    if (bottle.body.next_actions?.length > 0) {
      lines.push('## Next Actions');
      for (let i = 0; i < bottle.body.next_actions.length; i++) {
        lines.push(`${i + 1}. ${bottle.body.next_actions[i]}`);
      }
      lines.push('');
    }

    lines.push(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    lines.push(bottle.signature);
    lines.push('```');

    return lines.join('\n');
  }

  // ── Session Log ───────────────────────────────────────────────────────────

  /**
   * Generate a comprehensive session log from round data.
   *
   * This is the 26K-word style documentation — exhaustive, not summarized.
   * Every round, every task, every decision is recorded in detail.
   *
   * @param {Object[]} rounds - Round records from IterationManager.
   * @param {Object} [metadata={}] - Session metadata.
   * @param {string} [metadata.sessionId] - Session identifier.
   * @param {string} [metadata.objective] - Session objective.
   * @param {string[]} [metadata.reposInvolved] - Repositories touched.
   * @returns {string} Markdown-formatted session log.
   */
  generateSessionLog(rounds, metadata = {}) {
    const lines = [];
    const timestamp = new Date().toISOString();

    lines.push('# Session Log');
    lines.push('');
    lines.push(`**Agent:** ${this.profile.identity.name} [${this.profile.identity.rank}]`);
    lines.push(`**Fleet:** ${this.profile.identity.fleetId}`);
    lines.push(`**Session:** ${metadata.sessionId ?? 'unspecified'}`);
    lines.push(`**Started:** ${timestamp}`);
    lines.push(`**Rounds:** ${rounds.length}`);
    lines.push('');

    // Objective
    if (metadata.objective) {
      lines.push('## Objective');
      lines.push(metadata.objective);
      lines.push('');
    }

    // Repositories
    if (metadata.reposInvolved?.length > 0) {
      lines.push('## Repositories Involved');
      lines.push('| Repository | Role |');
      lines.push('|-----------|------|');
      for (const repo of metadata.reposInvolved) {
        lines.push(`| ${repo} | active |`);
      }
      lines.push('');
    }

    // Session overview table
    lines.push('## Session Overview');
    lines.push('| Round | Tasks Attempted | Completed | Failed | Quality | Improvement | Duration |');
    lines.push('|-------|----------------|-----------|--------|---------|-------------|----------|');

    let totalCompleted = 0;
    let totalFailed = 0;
    let totalDuration = 0;

    for (const round of rounds) {
      const completed = round.tasksCompleted?.length ?? 0;
      const failed = round.tasksFailed?.length ?? 0;
      const attempted = round.tasksAttempted?.length ?? 0;
      totalCompleted += completed;
      totalFailed += failed;
      totalDuration += round.duration ?? 0;

      lines.push(
        `| ${round.roundNumber} | ${attempted} | ${completed} | ${failed} | ` +
        `${(round.qualityScore * 100).toFixed(1)}% | ` +
        `${(round.improvementRate * 100).toFixed(1)}% | ${round.duration ?? '-'}m |`
      );
    }

    lines.push('');
    lines.push(`**Totals:** ${totalCompleted} completed, ${totalFailed} failed, ${totalDuration}m total duration.`);
    lines.push('');

    // Round-by-round detail
    for (const round of rounds) {
      lines.push(`## Round ${round.roundNumber}`);
      lines.push('');
      lines.push(`**Started:** ${round.startedAt ?? 'unknown'}`);
      lines.push(`**Completed:** ${round.completedAt ?? 'unknown'}`);
      lines.push(`**Duration:** ${round.duration ?? 'unknown'} minutes`);
      lines.push(`**Quality Score:** ${(round.qualityScore * 100).toFixed(1)}%`);
      lines.push(`**Improvement Rate:** ${(round.improvementRate * 100).toFixed(1)}%`);
      lines.push('');

      // Tasks attempted
      if (round.tasksAttempted?.length > 0) {
        lines.push('### Tasks Attempted');
        for (const task of round.tasksAttempted) {
          lines.push(`- **${task.id}:** ${task.title}`);
          if (task.description) {
            lines.push(`  > ${task.description}`);
          }
          if (task.repos?.length > 0) {
            lines.push(`  > Repos: ${task.repos.join(', ')}`);
          }
        }
        lines.push('');
      }

      // Tasks completed
      if (round.tasksCompleted?.length > 0) {
        lines.push('### Tasks Completed');
        for (const task of round.tasksCompleted) {
          lines.push(`- ✅ **${task.id}:** ${task.title}`);
        }
        lines.push('');
      }

      // Tasks failed
      if (round.tasksFailed?.length > 0) {
        lines.push('### Tasks Failed');
        for (const task of round.tasksFailed) {
          lines.push(`- ❌ **${task.id}:** ${task.title}`);
        }
        lines.push('');
      }

      // Improvements
      if (round.improvements?.length > 0) {
        lines.push('### Improvements');
        for (const imp of round.improvements) {
          lines.push(`- 📈 ${imp}`);
        }
        lines.push('');
      }

      // Issues
      if (round.issues?.length > 0) {
        lines.push('### Issues');
        for (const issue of round.issues) {
          lines.push(`- ⚠️ ${issue}`);
        }
        lines.push('');
      }

      // Notes
      if (round.notes?.length > 0) {
        lines.push('### Notes');
        for (const note of round.notes) {
          lines.push(`- 📝 ${note}`);
        }
        lines.push('');
      }
    }

    // Signature
    lines.push('---');
    lines.push(`*Log generated by ${this.profile.identity.name} [${this.profile.identity.rank}] — ${timestamp}*`);

    return lines.join('\n');
  }

  // ── PR Description ────────────────────────────────────────────────────────

  /**
   * Generate a structured PR description matching Super Z's aggressive_push style.
   *
   * PR descriptions are comprehensive, include cross-repo context, and are
   * designed to be updated iteratively as the PR evolves from draft to merge-ready.
   *
   * @param {Object} changes - PR change information.
   * @param {string} changes.title - PR title.
   * @param {string} [changes.description] - Detailed description.
   * @param {Object[]} [changes.filesChanged=[]] - Changed files with descriptions.
   * @param {string[]} [changes.reposAffected=[]] - Repositories affected.
   * @param {string[]} [changes.breakingChanges=[]] - Breaking changes.
   * @param {string[]} [changes.testingNotes=[]] - Testing instructions.
   * @param {Object} [changes.metrics] - Performance/quality metrics.
   * @param {string[]} [changes.dependencies] - New or updated dependencies.
   * @param {string} [changes.prType='feat'] - PR type (feat|fix|refactor|docs|chore).
   * @returns {string} Markdown-formatted PR description.
   */
  generatePRDescription(changes) {
    const lines = [];

    const typeEmoji = {
      feat: '✨',
      fix: '🐛',
      refactor: '🔨',
      docs: '📚',
      chore: '🔧',
      perf: '⚡',
    };

    const emoji = typeEmoji[changes.prType] ?? '✨';
    lines.push(`# ${emoji} ${changes.title}`);
    lines.push('');

    if (changes.description) {
      lines.push(changes.description);
      lines.push('');
    }

    // Summary table
    lines.push('## Summary');
    lines.push('| Metric | Value |');
    lines.push('|--------|-------|');
    lines.push(`| Files Changed | ${changes.filesChanged?.length ?? 0} |`);
    lines.push(`| Repos Affected | ${changes.reposAffected?.length ?? 1} |`);
    lines.push(`| Breaking Changes | ${changes.breakingChanges?.length ?? 0} |`);
    if (changes.metrics) {
      for (const [key, value] of Object.entries(changes.metrics)) {
        lines.push(`| ${key} | ${value} |`);
      }
    }
    lines.push('');

    // Repositories
    if (changes.reposAffected?.length > 0) {
      lines.push('## Repositories Affected');
      for (const repo of changes.reposAffected) {
        lines.push(`- \`${repo}\``);
      }
      lines.push('');
    }

    // Files changed
    if (changes.filesChanged?.length > 0) {
      lines.push('## Files Changed');
      lines.push('| File | Change |');
      lines.push('|------|--------|');
      for (const file of changes.filesChanged) {
        const desc = file.description ?? '';
        lines.push(`| \`${file.path}\` | ${desc} |`);
      }
      lines.push('');
    }

    // Breaking changes
    if (changes.breakingChanges?.length > 0) {
      lines.push('## ⚠️ Breaking Changes');
      for (const bc of changes.breakingChanges) {
        lines.push(`- ${bc}`);
      }
      lines.push('');
    }

    // Dependencies
    if (changes.dependencies?.length > 0) {
      lines.push('## Dependencies');
      for (const dep of changes.dependencies) {
        lines.push(`- ${dep}`);
      }
      lines.push('');
    }

    // Testing
    if (changes.testingNotes?.length > 0) {
      lines.push('## Testing');
      for (const note of changes.testingNotes) {
        lines.push(`- ${note}`);
      }
      lines.push('');
    }

    // Reviewer notes
    lines.push('## Reviewer Notes');
    lines.push('- This PR follows Super Z\'s aggressive_push strategy — opened early, updated often.');
    lines.push('- Check commit history for detailed decision rationale.');
    lines.push('- Cross-repo impacts are documented above — verify downstream consumers.');

    lines.push('');
    lines.push('---');
    lines.push(`*PR by ${this.profile.identity.name} [${this.profile.identity.rank}] | ${this.profile.identity.fleetId}*`);

    return lines.join('\n');
  }

  // ── Progress Update ───────────────────────────────────────────────────────

  /**
   * Generate a fleet progress update message.
   *
   * @param {Object[]} completed - Completed tasks.
   * @param {Object[]} remaining - Remaining tasks.
   * @param {Object} [options] - Additional options.
   * @param {number} [options.currentRound] - Current round number.
   * @param {number} [options.sessionId] - Session identifier.
   * @param {string[]} [options.blockers] - Current blockers.
   * @returns {string} Markdown-formatted progress update.
   */
  generateProgressUpdate(completed, remaining, options = {}) {
    const total = completed.length + remaining.length;
    const pct = total > 0 ? Math.round((completed.length / total) * 100) : 100;

    const lines = [];
    lines.push(`## 🟢 WIP — ${this.profile.identity.name} Progress Update`);
    lines.push('');

    if (options.currentRound) {
      lines.push(`**Round:** ${options.currentRound}`);
    }
    lines.push(`**Progress:** ${completed.length}/${total} tasks (${pct}%)`);
    lines.push(`**Session:** ${options.sessionId ?? 'active'}`);
    lines.push('');

    // Progress bar
    const filled = Math.round(pct / 5);
    const empty = 20 - filled;
    lines.push(`[${'█'.repeat(filled)}${'░'.repeat(empty)}] ${pct}%`);
    lines.push('');

    // Completed table
    if (completed.length > 0) {
      lines.push('### Completed');
      lines.push('| Task | Repo | Impact |');
      lines.push('|------|------|--------|');
      for (const task of completed) {
        const repos = task.repos?.join(', ') ?? '-';
        const impact = task.impact ? `${(task.impact * 100).toFixed(0)}%` : '-';
        lines.push(`| ${task.id}: ${task.title} | ${repos} | ${impact} |`);
      }
      lines.push('');
    }

    // Remaining table
    if (remaining.length > 0) {
      lines.push('### Remaining');
      lines.push('| Task | Repo | Urgency |');
      lines.push('|------|------|---------|');
      for (const task of remaining) {
        const repos = task.repos?.join(', ') ?? '-';
        const urgency = task.urgency ? `${(task.urgency * 100).toFixed(0)}%` : '-';
        lines.push(`| ${task.id}: ${task.title} | ${repos} | ${urgency} |`);
      }
      lines.push('');
    }

    // Blockers
    if (options.blockers?.length > 0) {
      lines.push('### 🟡 Blockers');
      for (const blocker of options.blockers) {
        lines.push(`- ${blocker}`);
      }
      lines.push('');
    }

    lines.push(`*Update from ${this.profile.identity.name} [${this.profile.identity.rank}]*`);

    return lines.join('\n');
  }

  // ── Risk Alert ────────────────────────────────────────────────────────────

  /**
   * Generate a risk alert bottle for fleet broadcast.
   *
   * @param {Object} risk - Risk information.
   * @param {string} risk.description - Risk description.
   * @param {string} risk.level - Risk level.
   * @param {string} risk.source - Where the risk was found.
   * @param {string[]} risk.affectedRepos - Repos that could be impacted.
   * @param {string[]} risk.mitigations - Recommended mitigations.
   * @returns {BottleMessage} Risk alert bottle.
   */
  generateRiskAlert(risk) {
    const levelEmoji = {
      low: '🟢',
      medium: '🟡',
      high: '🟠',
      critical: '🔴',
    };

    return this.generateBottle({
      content: `${levelEmoji[risk.level] ?? '⚠️'} **[${risk.level.toUpperCase()}]** ${risk.description}`,
      context: `Risk discovered at: ${risk.source}`,
      intent: 'ALERT',
      addressedTo: ['fleet-all'],
      risksIdentified: [risk.description],
      nextActions: risk.mitigations ?? ['Investigate and assess impact.'],
      crossRepoImpact: risk.affectedRepos?.map(
        (r) => `${r} may be affected by ${risk.source}`
      ) ?? [],
    }, 'risk_alert');
  }

  // ── Completion Notice ─────────────────────────────────────────────────────

  /**
   * Generate a completion notice bottle.
   *
   * @param {Object} completion - Completion information.
   * @param {string} completion.title - What was completed.
   * @param {string} completion.description - How it was implemented.
   * @param {string[]} completion.reposAffected - Repos touched.
   * @param {Object} [completion.metrics] - Performance/quality metrics.
   * @param {string[]} [completion.downstreamImpact] - Downstream consumers to notify.
   * @returns {BottleMessage} Completion notice bottle.
   */
  generateCompletionNotice(completion) {
    return this.generateBottle({
      content: `✅ **COMPLETE:** ${completion.title}`,
      context: completion.description ?? '',
      intent: 'DONE',
      addressedTo: ['fleet-all'],
      metrics: completion.metrics ?? undefined,
      crossRepoImpact: completion.downstreamImpact ?? completion.reposAffected ?? [],
      lessonsLearned: completion.lessonsLearned ?? [],
      nextActions: [
        'Review and verify completion.',
        ...(completion.downstreamImpact ?? []).map(
          (d) => `Notify downstream: ${d}`
        ),
      ],
    }, 'completion');
  }

  // ── Accessors ─────────────────────────────────────────────────────────────

  /**
   * Get all bottles generated in this session.
   * @returns {BottleMessage[]} Bottle log.
   */
  getBottleLog() {
    return [...this._bottleLog];
  }

  /**
   * Get the number of bottles generated.
   * @returns {number}
   */
  getBottleCount() {
    return this.bottleCounter;
  }

  // ── Private Methods ───────────────────────────────────────────────────────

  /**
   * Determine intent for a bottle type.
   * @private
   */
  _intentForType(type) {
    const intentMap = {
      progress_update: 'SYNC',
      blocker_alert: 'ALERT',
      completion_notice: 'DONE',
      risk_alert: 'WARN',
      coordination_request: 'COORD',
      handoff: 'SYNC',
      custom: 'SYNC',
    };
    return intentMap[type] ?? 'SYNC';
  }
}

export default ReportGenerator;
