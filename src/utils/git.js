/**
 * @module git
 * @description Git utility functions for repository inspection, branch management,
 *              commit/push workflows, and GitHub PR creation. All commands are
 *              executed via the `git` CLI and return structured results.
 */

import { execSync } from 'node:child_process';

/**
 * Default options for child_process.execSync calls.
 * @type {{ encoding: string, stdio: string[], timeout: number }}
 */
const DEFAULT_OPTS = {
  encoding: 'utf-8',
  stdio: ['pipe', 'pipe', 'pipe'],
  timeout: 30_000,
};

/**
 * Execute a git command in the given working directory.
 * @param {string} args — Git arguments (e.g., "status --porcelain").
 * @param {string} [cwd=process.cwd()] — Working directory.
 * @param {ExecSyncOptions} [opts={}] — Additional exec options.
 * @returns {string} Stdout from the command.
 * @throws {Error} If the git command fails.
 */
function gitExec(args, cwd = process.cwd(), opts = {}) {
  const merged = { ...DEFAULT_OPTS, ...opts };
  return execSync(`git ${args}`, { ...merged, cwd }).trim();
}

/**
 * Check whether the current working directory is inside a git repository.
 * @param {string} [cwd=process.cwd()]
 * @returns {boolean}
 */
export function isGitRepo(cwd = process.cwd()) {
  try {
    gitExec('rev-parse --is-inside-work-tree', cwd);
    return true;
  } catch {
    return false;
  }
}

/**
 * Gather comprehensive repository information.
 * @param {string} [cwd=process.cwd()]
 * @returns {{ remoteUrl: string|null, branch: string, commitHash: string, shortHash: string, repoRoot: string, isClean: boolean }}
 */
export function getRepoInfo(cwd = process.cwd()) {
  let remoteUrl = null;
  try {
    remoteUrl = gitExec('remote get-url origin', cwd);
  } catch {
    // No remote configured
  }

  const branch = gitExec('rev-parse --abbrev-ref HEAD', cwd);
  const commitHash = gitExec('rev-parse HEAD', cwd);
  const shortHash = gitExec('rev-parse --short HEAD', cwd);
  const repoRoot = gitExec('rev-parse --show-toplevel', cwd);

  let isClean = true;
  try {
    const status = gitExec('status --porcelain', cwd);
    isClean = status.length === 0;
  } catch {
    isClean = false;
  }

  return { remoteUrl, branch, commitHash, shortHash, repoRoot, isClean };
}

/**
 * Create a new git branch and switch to it.
 * @param {string} name — Branch name.
 * @param {string} [cwd=process.cwd()]
 * @returns {{ branch: string }} The created branch name.
 */
export function createBranch(name, cwd = process.cwd()) {
  const sanitized = name.replace(/\s+/g, '-').toLowerCase();
  gitExec(`checkout -b ${sanitized}`, cwd);
  return { branch: sanitized };
}

/**
 * Stage, commit, and push changes to the remote repository.
 * @param {string[]} files — File paths to stage (relative to repo root).
 * @param {string} message — Commit message.
 * @param {string} [cwd=process.cwd()]
 * @param {{ push?: boolean, remote?: string }} [opts]
 * @returns {{ commitHash: string, branch: string, pushed: boolean }}
 */
export function commitAndPush(files, message, cwd = process.cwd(), { push = true, remote = 'origin' } = {}) {
  // Stage specified files
  for (const file of files) {
    gitExec(`add ${file}`, cwd);
  }

  // Commit
  const commitHash = gitExec('commit -m', cwd)
    ? gitExec(`commit -m "${message.replace(/"/g, '\\"')}"`, cwd)
    : gitExec(`commit -m "${message.replace(/"/g, '\\"')}"`, cwd);

  const actualHash = gitExec('rev-parse --short HEAD', cwd);
  const branch = gitExec('rev-parse --abbrev-ref HEAD', cwd);

  let pushed = false;
  if (push) {
    try {
      gitExec(`push ${remote} ${branch}`, cwd);
      pushed = true;
    } catch (err) {
      // Push may fail if no remote or permissions issue — commit still succeeded
      pushed = false;
    }
  }

  return { commitHash: actualHash, branch, pushed };
}

/**
 * List files that have uncommitted changes.
 * @param {string} [cwd=process.cwd()]
 * @returns {{ staged: string[], unstaged: string[], untracked: string[] }}
 */
export function getChangedFiles(cwd = process.cwd()) {
  const staged = [];
  const unstaged = [];
  const untracked = [];

  try {
    const output = gitExec('status --porcelain', cwd);
    for (const line of output.split('\n').filter(Boolean)) {
      const statusCode = line.slice(0, 2);
      const filePath = line.slice(3).trim();

      // XY status format: X = index, Y = work tree
      if (statusCode[1] === '?' || statusCode === '??') {
        untracked.push(filePath);
      } else if (statusCode[0] !== ' ' && statusCode[0] !== '?') {
        staged.push(filePath);
      } else if (statusCode[1] !== ' ') {
        unstaged.push(filePath);
      }
    }
  } catch {
    // Not a git repo or git error
  }

  return { staged, unstaged, untracked };
}

/**
 * Create a GitHub Pull Request via the GitHub API.
 * Requires GITHUB_TOKEN environment variable.
 * @param {string} title — PR title.
 * @param {string} body — PR body (Markdown).
 * @param {object} [opts]
 * @param {string} [opts.head] — Source branch (defaults to current branch).
 * @param {string} [opts.base='main'] — Target branch.
 * @param {string} [opts.token] — GitHub token (defaults to GITHUB_TOKEN env var).
 * @param {string} [opts.cwd=process.cwd()]
 * @returns {Promise<{ url: string, number: number }>} The created PR info.
 * @throws {Error} If GITHUB_TOKEN is not set or API call fails.
 */
export async function createPR(title, body, opts = {}) {
  const {
    head,
    base = 'main',
    token = process.env.GITHUB_TOKEN,
    cwd = process.cwd(),
  } = opts;

  if (!token) {
    throw new Error('GITHUB_TOKEN environment variable is required to create a PR');
  }

  const currentBranch = head || gitExec('rev-parse --abbrev-ref HEAD', cwd);
  const info = getRepoInfo(cwd);

  if (!info.remoteUrl) {
    throw new Error('No git remote configured — cannot create PR');
  }

  // Parse owner/repo from remote URL
  const repoMatch = info.remoteUrl.match(/(?:github\.com[/:]|@)([^/]+)\/([^/.]+)/);
  if (!repoMatch) {
    throw new Error(`Cannot parse GitHub owner/repo from remote URL: ${info.remoteUrl}`);
  }

  const [, owner, repo] = repoMatch;

  const response = await fetch('https://api.github.com/repos/{owner}/{repo}/pulls'
    .replace('{owner}', owner)
    .replace('{repo}', repo), {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'superz-twin/0.1.0',
    },
    body: JSON.stringify({ title, body, head: currentBranch, base }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`GitHub API error (${response.status}): ${errorBody}`);
  }

  const pr = await response.json();
  return { url: pr.html_url, number: pr.number };
}

/**
 * Get the default branch name for the repository.
 * @param {string} [cwd=process.cwd()]
 * @returns {string} Default branch name (usually "main" or "master").
 */
export function getDefaultBranch(cwd = process.cwd()) {
  try {
    return gitExec('symbolic-ref refs/remotes/origin/HEAD --short', cwd).replace('origin/', '');
  } catch {
    return 'main';
  }
}
