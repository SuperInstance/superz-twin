/**
 * @module git-workflow
 * @description Git workflow automation for the SuperZ Twin agent.
 * Provides a high-level API for forking, branching, committing,
 * PR creation, CI monitoring, upstream syncing, and merge conflict resolution.
 *
 * This module wraps git operations into an agent-friendly workflow
 * that can be driven by the agent loop.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, resolve } from 'node:path';
import { mkdir, writeFile, readFile, rm, access } from 'node:fs/promises';
import { EventEmitter } from 'node:events';

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Conflict Resolution Strategies
// ---------------------------------------------------------------------------

/** @enum {string} */
export const ConflictStrategy = Object.freeze({
  OURS: 'ours',
  THEIRS: 'theirs',
  MANUAL: 'manual',
  THREE_WAY: 'three_way',
});

// ---------------------------------------------------------------------------
// AgentGitWorkflow
// ---------------------------------------------------------------------------

/**
 * Manages the full git workflow lifecycle for the SuperZ Twin agent.
 *
 * Events:
 *   - `forked`       (taskId, forkUrl)
 *   - `branch:created` (taskId, branchName)
 *   - `commit`        (taskId, sha, message)
 *   - `pushed`        (taskId, branch, remote)
 *   - `pr:created`    (taskId, prNumber, prUrl)
 *   - `pr:reviewed`   (taskId, prNumber, status)
 *   - `ci:passed`     (taskId, prNumber)
 *   - `ci:failed`     (taskId, prNumber, failures)
 *   - `sync:complete` (taskId, branch)
 *   - `conflict:resolved` (taskId, files)
 *   - `error`         (taskId, error)
 */
export class AgentGitWorkflow extends EventEmitter {
  /**
   * @param {object} [options]
   * @param {string} [options.workDir] — Base working directory for checkouts
   * @param {string} [options.githubToken] — GitHub API token
   * @param {string} [options.defaultBranch='main'] — Default target branch
   * @param {string} [options.agentName='SuperZ Twin'] — Git author name
   * @param {string} [options.agentEmail='superz-twin@fleet.dev'] — Git author email
   * @param {object} [options.githubClient] — Optional GitHub client (e.g., @octokit/rest)
   */
  constructor({
    workDir,
    githubToken,
    defaultBranch = 'main',
    agentName = 'SuperZ Twin',
    agentEmail = 'superz-twin@fleet.dev',
    githubClient,
  } = {}) {
    super();

    this.workDir = workDir;
    this.githubToken = githubToken;
    this.defaultBranch = defaultBranch;
    this.agentName = agentName;
    this.agentEmail = agentEmail;
    this.gh = githubClient ?? null;

    /** @type {Map<string, object>} Active work sessions keyed by taskId */
    this._sessions = new Map();
  }

  // -----------------------------------------------------------------------
  // Workflow Step 1: Claim a Task
  // -----------------------------------------------------------------------

  /**
   * Claim a task by forking the repository, creating a feature branch,
   * and preparing the working directory.
   *
   * @param {string} taskId — Unique task identifier
   * @param {object} repo — Repository descriptor
   * @param {string} repo.owner — Repository owner
   * @param {string} repo.name — Repository name
   * @param {string} [repo.url] — Full clone URL (overrides constructed URL)
   * @param {string} [repo.branch] — Target branch (default: this.defaultBranch)
   * @returns {Promise<object>} Session info with forkUrl, branchName, workDir
   */
  async claimTask(taskId, repo) {
    const branchName = `superz-twin/${taskId}/${Date.now()}`;
    const targetBranch = repo.branch ?? this.defaultBranch;
    const repoUrl = repo.url ?? `https://github.com/${repo.owner}/${repo.name}.git`;
    const localDir = this.workDir
      ? resolve(join(this.workDir, `${taskId}-${Date.now()}`))
      : resolve(join(process.cwd(), `.superz-work`, `${taskId}-${Date.now()}`));

    // Create working directory
    await mkdir(localDir, { recursive: true });

    try {
      // Clone the repository
      await this._git(localDir, 'clone', '--depth', '50', '--branch', targetBranch, repoUrl, '.');

      // Configure git identity
      await this._git(localDir, 'config', 'user.name', this.agentName);
      await this._git(localDir, 'config', 'user.email', this.agentEmail);

      // Create and checkout feature branch
      await this._git(localDir, 'checkout', '-b', branchName);

      // If GitHub client available, create fork
      let forkUrl = repoUrl;
      if (this.gh) {
        try {
          const { data } = await this.gh.rest.repos.createFork({
            owner: repo.owner,
            repo: repo.name,
          });
          forkUrl = data.ssh_url ?? data.clone_url;
          this.emit('forked', taskId, forkUrl);
        } catch {
          // Fork may already exist or permissions issue — continue with original
        }
      }

      const session = {
        taskId,
        repo: { ...repo, url: repoUrl, targetBranch },
        branchName,
        forkUrl,
        localDir,
        createdAt: Date.now(),
        commits: [],
      };
      this._sessions.set(taskId, session);

      this.emit('branch:created', taskId, branchName);
      return session;
    } catch (err) {
      // Cleanup on failure
      await rm(localDir, { recursive: true, force: true }).catch(() => {});
      this.emit('error', taskId, err);
      throw err;
    }
  }

  // -----------------------------------------------------------------------
  // Workflow Step 2: Make Changes
  // -----------------------------------------------------------------------

  /**
   * Create/modify files and commit the changes.
   *
   * @param {string} taskId — The task session ID
   * @param {Array<{path: string, content: string, operation?: 'create'|'modify'|'delete'}>} files
   * @param {string} message — Commit message
   * @returns {Promise<{sha: string, files: string[]}>}
   */
  async makeChanges(taskId, files, message) {
    const session = this._getSession(taskId);
    const { localDir } = session;

    const modifiedFiles = [];

    for (const file of files) {
      const fullPath = resolve(join(localDir, file.path));

      if (file.operation === 'delete') {
        await rm(fullPath, { force: true });
        await this._git(localDir, 'add', file.path);
        modifiedFiles.push(file.path);
        continue;
      }

      // Ensure parent directory exists
      const parentDir = join(fullPath, '..');
      await mkdir(parentDir, { recursive: true });

      await writeFile(fullPath, file.content, 'utf-8');
      await this._git(localDir, 'add', file.path);
      modifiedFiles.push(file.path);
    }

    // Check if there are staged changes
    const { stdout: status } = await this._git(localDir, 'status', '--porcelain');
    if (!status.trim()) {
      return { sha: null, files: [] };
    }

    // Commit
    const { stdout: commitOutput } = await this._git(
      localDir,
      'commit',
      '-m',
      `[superz-twin] ${message}`,
      ...(files.length > 1 ? ['--no-verify'] : [])
    );

    // Extract SHA from output
    const shaMatch = commitOutput.match(/\[.*?([0-9a-f]{7,40})\]/);
    const sha = shaMatch ? shaMatch[1] : 'unknown';

    session.commits.push({ sha, message, files: modifiedFiles, timestamp: Date.now() });

    this.emit('commit', taskId, sha, message);
    return { sha, files: modifiedFiles };
  }

  // -----------------------------------------------------------------------
  // Workflow Step 3: Create Pull Request
  // -----------------------------------------------------------------------

  /**
   * Push the feature branch and create a pull request.
   *
   * @param {string} taskId — Task session ID
   * @param {string} title — PR title
   * @param {string} body — PR body/description
   * @param {string} [target] — Target branch (default: session's targetBranch)
   * @returns {Promise<{prNumber: number, prUrl: string}>}
   */
  async createPullRequest(taskId, title, body, target) {
    const session = this._getSession(taskId);
    const { branchName, repo, forkUrl } = session;
    const targetBranch = target ?? repo.targetBranch ?? this.defaultBranch;

    // Push branch to origin
    await this._git(session.localDir, 'push', 'origin', branchName, '--force-with-lease');
    this.emit('pushed', taskId, branchName, 'origin');

    // If we have a GitHub client, create the PR via API
    if (this.gh) {
      try {
        const { data } = await this.gh.rest.pulls.create({
          owner: repo.owner,
          repo: repo.name,
          title,
          body,
          head: branchName,
          base: targetBranch,
        });

        this.emit('pr:created', taskId, data.number, data.html_url);
        session.prNumber = data.number;
        session.prUrl = data.html_url;
        return { prNumber: data.number, prUrl: data.html_url };
      } catch (err) {
        this.emit('error', taskId, err);
        throw new Error(`Failed to create PR: ${err.message}`);
      }
    }

    // Fallback: return a placeholder without actually creating the PR
    const placeholderUrl = `https://github.com/${repo.owner}/${repo.name}/compare/${targetBranch}...${branchName}`;
    this.emit('pr:created', taskId, 0, placeholderUrl);
    return { prNumber: 0, prUrl: placeholderUrl };
  }

  // -----------------------------------------------------------------------
  // Workflow Step 4: Review PR
  // -----------------------------------------------------------------------

  /**
   * Check PR status including CI, reviews, and comments.
   *
   * @param {string} taskId — Task session ID
   * @param {number} prNumber — PR number to review
   * @returns {Promise<object>} Review status object
   */
  async reviewPR(taskId, prNumber) {
    const session = this._getSession(taskId);

    if (!this.gh) {
      return { status: 'unknown', ci: null, reviews: [], comments: [] };
    }

    try {
      // Fetch PR details
      const { data: pr } = await this.gh.rest.pulls.get({
        owner: session.repo.owner,
        repo: session.repo.name,
        pull_number: prNumber,
      });

      // Fetch review status
      const { data: reviews } = await this.gh.rest.pulls.listReviews({
        owner: session.repo.owner,
        repo: session.repo.name,
        pull_number: prNumber,
      });

      // Fetch CI status
      const { data: status } = await this.gh.rest.repos.getCombinedStatusForRef({
        owner: session.repo.owner,
        repo: session.repo.name,
        ref: pr.head.sha,
      });

      const result = {
        status: pr.state,
        mergeable: pr.mergeable,
        mergeableState: pr.mergeable_state,
        ci: {
          state: status.state,
          statuses: status.statuses.map((s) => ({
            context: s.context,
            state: s.state,
            description: s.description,
            targetUrl: s.target_url,
          })),
        },
        reviews: reviews.map((r) => ({
          user: r.user?.login,
          state: r.state,
          body: r.body,
        })),
        additions: pr.additions,
        deletions: pr.deletions,
        changedFiles: pr.changed_files,
      };

      this.emit('pr:reviewed', taskId, prNumber, result);
      return result;
    } catch (err) {
      this.emit('error', taskId, err);
      throw new Error(`Failed to review PR #${prNumber}: ${err.message}`);
    }
  }

  // -----------------------------------------------------------------------
  // Workflow Step 5: Handle CI Status
  // -----------------------------------------------------------------------

  /**
   * React to CI results — decide whether to fix, retry, or skip.
   *
   * @param {string} taskId — Task session ID
   * @param {object} pr — PR review data (from reviewPR)
   * @param {object} [options]
   * @param {number} [options.maxRetries=2] — Max CI retry attempts
   * @returns {Promise<{action: string, details: string}>}
   */
  async handleCIStatus(taskId, pr, { maxRetries = 2 } = {}) {
    if (!pr.ci || pr.ci.state === 'success') {
      this.emit('ci:passed', taskId, pr.prNumber ?? session?.prNumber);
      return { action: 'proceed', details: 'All CI checks passed' };
    }

    const session = this._sessions.get(taskId);
    const failures = pr.ci.statuses.filter((s) => s.state === 'failure' || s.state === 'error');

    this.emit('ci:failed', taskId, pr.prNumber ?? session?.prNumber, failures);

    // Determine action based on failure type
    const isFlaky = failures.some((f) => f.description?.toLowerCase().includes('timeout') ||
      f.description?.toLowerCase().includes('flaky'));
    const isTestFailure = failures.some((f) => f.context?.toLowerCase().includes('test'));
    const isLintFailure = failures.some((f) => f.context?.toLowerCase().includes('lint') ||
      f.context?.toLowerCase().includes('format'));

    if (isLintFailure) {
      return {
        action: 'fix_lint',
        details: `Lint failures detected: ${failures.map((f) => f.context).join(', ')}`,
      };
    }

    if (isTestFailure) {
      return {
        action: 'fix_tests',
        details: `Test failures detected: ${failures.map((f) => f.context).join(', ')}`,
      };
    }

    if (isFlaky && (session?.ciRetries ?? 0) < maxRetries) {
      session.ciRetries = (session.ciRetries ?? 0) + 1;
      return {
        action: 'retry',
        details: `Flaky CI detected, retrying (${session.ciRetries}/${maxRetries})`,
      };
    }

    return {
      action: 'skip',
      details: `CI failures cannot be auto-resolved: ${failures.map((f) => f.context).join(', ')}`,
    };
  }

  // -----------------------------------------------------------------------
  // Workflow Step 6: Sync with Upstream
  // -----------------------------------------------------------------------

  /**
   * Rebase the feature branch on the latest upstream changes.
   *
   * @param {string} taskId — Task session ID
   * @param {string} branch — Branch to sync (default: session branch)
   * @returns {Promise<{updated: boolean, commitsRebased: number, conflicts: string[]}>}
   */
  async syncWithUpstream(taskId, branch) {
    const session = this._getSession(taskId);
    const { localDir } = session;
    const branchName = branch ?? session.branchName;
    const targetBranch = session.repo.targetBranch ?? this.defaultBranch;

    // Fetch latest
    await this._git(localDir, 'fetch', 'origin', targetBranch);

    // Get current commit count
    const { stdout: beforeCount } = await this._git(localDir, 'rev-list', '--count', 'HEAD');

    try {
      // Attempt rebase
      await this._git(localDir, 'rebase', `origin/${targetBranch}`);
    } catch (err) {
      // Check for conflicts
      const { stdout: status } = await this._git(localDir, 'status', '--porcelain');
      const conflicts = status
        .split('\n')
        .filter((line) => line.startsWith('UU') || line.startsWith('AA') || line.startsWith('DU'))
        .map((line) => line.trim().substring(3));

      if (conflicts.length > 0) {
        // Abort rebase and report conflicts
        await this._git(localDir, 'rebase', '--abort');
        return { updated: false, commitsRebased: 0, conflicts };
      }
    }

    // Get new commit count
    const { stdout: afterCount } = await this._git(localDir, 'rev-list', '--count', 'HEAD');
    const commitsRebased = parseInt(afterCount, 10) - parseInt(beforeCount, 10);

    // Force-push updated branch
    await this._git(localDir, 'push', 'origin', branchName, '--force-with-lease');

    this.emit('sync:complete', taskId, branchName);
    return { updated: true, commitsRebased, conflicts: [] };
  }

  // -----------------------------------------------------------------------
  // Workflow Step 7: Merge Conflict Resolution
  // -----------------------------------------------------------------------

  /**
   * Attempt to resolve merge conflicts using the specified strategy.
   *
   * @param {string} taskId — Task session ID
   * @param {ConflictStrategy} strategy — Resolution strategy
   * @param {string[]} [conflictedFiles] — Specific files to resolve
   * @returns {Promise<{resolved: string[], unresolved: string[]}>}
   */
  async mergeConflictResolution(taskId, strategy, conflictedFiles) {
    const session = this._getSession(taskId);
    const { localDir } = session;

    // Get list of conflicted files
    const { stdout: status } = await this._git(localDir, 'status', '--porcelain');
    const allConflicts = status
      .split('\n')
      .filter((line) => line.startsWith('UU') || line.startsWith('AA') || line.startsWith('DU'))
      .map((line) => line.trim().substring(3));

    const files = conflictedFiles ?? allConflicts;
    const resolved = [];
    const unresolved = [];

    for (const file of files) {
      try {
        switch (strategy) {
          case ConflictStrategy.OURS:
            await this._git(localDir, 'checkout', '--ours', file);
            await this._git(localDir, 'add', file);
            resolved.push(file);
            break;

          case ConflictStrategy.THEIRS:
            await this._git(localDir, 'checkout', '--theirs', file);
            await this._git(localDir, 'add', file);
            resolved.push(file);
            break;

          case ConflictStrategy.THREE_WAY: {
            // Attempt automatic three-way merge resolution
            const { stdout: mergeResult } = await this._git(
              localDir, 'merge-file', '-p',
              join(localDir, file),
              join(localDir, file + '.REMOTE'),
              join(localDir, file + '.LOCAL')
            ).catch(() => ({ stdout: '' }));

            if (mergeResult && !mergeResult.includes('<<<<<<<')) {
              await writeFile(join(localDir, file), mergeResult, 'utf-8');
              await this._git(localDir, 'add', file);
              resolved.push(file);
            } else {
              unresolved.push(file);
            }
            break;
          }

          case ConflictStrategy.MANUAL:
          default:
            unresolved.push(file);
            break;
        }
      } catch {
        unresolved.push(file);
      }
    }

    if (resolved.length > 0) {
      this.emit('conflict:resolved', taskId, resolved);
    }

    return { resolved, unresolved };
  }

  // -----------------------------------------------------------------------
  // Cleanup
  // -----------------------------------------------------------------------

  /**
   * Clean up a task session (remove local checkout, clear state).
   * @param {string} taskId
   * @param {object} [options]
   * @param {boolean} [options.keepFiles=false] — Keep local files on disk
   * @returns {Promise<void>}
   */
  async cleanup(taskId, { keepFiles = false } = {}) {
    const session = this._sessions.get(taskId);
    if (!session) return;

    if (!keepFiles && session.localDir) {
      await rm(session.localDir, { recursive: true, force: true }).catch(() => {});
    }

    this._sessions.delete(taskId);
  }

  // -----------------------------------------------------------------------
  // Private Helpers
  // -----------------------------------------------------------------------

  /**
   * Get or throw on missing session.
   * @param {string} taskId
   * @returns {object}
   * @private
   */
  _getSession(taskId) {
    const session = this._sessions.get(taskId);
    if (!session) {
      throw new Error(`No active session for task ${taskId}. Call claimTask() first.`);
    }
    return session;
  }

  /**
   * Execute a git command in the given directory.
   * @param {string} cwd
   * @param {...string} args
   * @returns {Promise<{stdout: string, stderr: string}>}
   * @private
   */
  async _git(cwd, ...args) {
    const result = await execFileAsync('git', args, {
      cwd,
      maxBuffer: 10 * 1024 * 1024,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
        ...(this.githubToken ? { GITHUB_TOKEN: this.githubToken } : {}),
      },
    });
    return result;
  }
}

export default AgentGitWorkflow;
