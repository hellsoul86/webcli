import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const DEFAULT_BRANCH = "main";
const TASK_BRANCH_PREFIX = "codex/";

export class WorkflowError extends Error {
  constructor(message) {
    super(message);
    this.name = "WorkflowError";
  }
}

export function normalizeTaskSlug(input) {
  const normalized = String(input ?? "")
    .trim()
    .replace(/^codex\//i, "")
    .toLowerCase()
    .replace(/[^a-z0-9/_-]+/g, "-")
    .replace(/[\\/]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  if (!normalized) {
    throw new WorkflowError("Task slug is required. Example: npm run task:start -- git-review-panel");
  }

  return normalized;
}

export function buildTaskBranchName(slug) {
  return `${TASK_BRANCH_PREFIX}${normalizeTaskSlug(slug)}`;
}

export function buildWorktreePath(repoRoot, slug) {
  const repoName = path.basename(repoRoot);
  return path.resolve(repoRoot, "..", ".codex", "worktrees", `${repoName}-${normalizeTaskSlug(slug)}`);
}

export function parseWorktreeList(output) {
  const records = [];
  const lines = output.split(/\r?\n/);
  let current = null;

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line) {
      if (current) {
        records.push(current);
        current = null;
      }
      continue;
    }

    const [key, ...rest] = line.split(" ");
    const value = rest.join(" ");
    if (key === "worktree") {
      if (current) {
        records.push(current);
      }
      current = { path: value, branch: null, head: null };
      continue;
    }

    if (!current) {
      continue;
    }

    if (key === "branch") {
      current.branch = value.replace(/^refs\/heads\//, "");
    } else if (key === "HEAD") {
      current.head = value;
    }
  }

  if (current) {
    records.push(current);
  }

  return records;
}

export function listWorktrees(cwd) {
  return parseWorktreeList(runGit(["worktree", "list", "--porcelain"], { cwd, trim: false }).stdout);
}

export function startTask({ cwd, slug }) {
  const repoRoot = resolveRepoRoot(cwd);
  ensurePrimaryMainCheckout(repoRoot);
  ensureCleanWorkingTree(repoRoot, "task:start");

  const normalizedSlug = normalizeTaskSlug(slug);
  const branchName = buildTaskBranchName(normalizedSlug);
  const worktreePath = buildWorktreePath(repoRoot, normalizedSlug);

  fetchOrigin(repoRoot);

  const worktrees = listWorktrees(repoRoot);
  const existingWorktree =
    worktrees.find((entry) => entry.branch === branchName) ??
    worktrees.find((entry) => path.resolve(entry.path) === worktreePath);

  if (existingWorktree) {
    return {
      action: "reused",
      branchName,
      repoRoot,
      worktreePath: path.resolve(existingWorktree.path),
    };
  }

  if (existsSync(worktreePath)) {
    throw new WorkflowError(
      `Refusing to create worktree because the target path already exists: ${worktreePath}`,
    );
  }

  mkdirSync(path.dirname(worktreePath), { recursive: true });

  if (localBranchExists(repoRoot, branchName)) {
    runGit(["worktree", "add", worktreePath, branchName], { cwd: repoRoot });
  } else {
    runGit(["worktree", "add", "-b", branchName, worktreePath, `origin/${DEFAULT_BRANCH}`], {
      cwd: repoRoot,
    });
  }

  return {
    action: "created",
    branchName,
    repoRoot,
    worktreePath,
  };
}

export function syncTask({ cwd }) {
  const repoRoot = resolveRepoRoot(cwd);
  ensureLinkedTaskWorktree(repoRoot, "task:sync");
  ensureCleanWorkingTree(repoRoot, "task:sync");

  const branchName = currentBranch(repoRoot);
  fetchOrigin(repoRoot);
  runGit(["rebase", `origin/${DEFAULT_BRANCH}`], { cwd: repoRoot });

  return {
    branchName,
    repoRoot,
  };
}

export function finishTask({ cwd, slug }) {
  const repoRoot = resolveRepoRoot(cwd);
  ensurePrimaryMainCheckout(repoRoot);
  ensureCleanWorkingTree(repoRoot, "task:finish");

  const normalizedSlug = normalizeTaskSlug(slug);
  const branchName = buildTaskBranchName(normalizedSlug);

  fetchOrigin(repoRoot);

  if (!localBranchExists(repoRoot, branchName)) {
    throw new WorkflowError(`Local branch does not exist: ${branchName}`);
  }

  if (!branchMergedIntoMain(repoRoot, branchName)) {
    throw new WorkflowError(
      `Refusing to clean up ${branchName} because it has not been merged into origin/${DEFAULT_BRANCH}.`,
    );
  }

  const worktree = listWorktrees(repoRoot).find((entry) => entry.branch === branchName);
  if (worktree) {
    const worktreePath = path.resolve(worktree.path);
    if (worktreePath === repoRoot) {
      throw new WorkflowError("Refusing to remove the primary checkout.");
    }

    ensureCleanWorkingTree(worktreePath, "task:finish");
    runGit(["worktree", "remove", worktreePath], { cwd: repoRoot });
  }

  runGit(["branch", branchHasAncestorMerge(repoRoot, branchName) ? "-d" : "-D", branchName], {
    cwd: repoRoot,
  });

  return {
    branchName,
    repoRoot,
    worktreePath: worktree ? path.resolve(worktree.path) : null,
  };
}

function cli() {
  const [, , command, maybeSlug] = process.argv;

  try {
    switch (command) {
      case "start": {
        const result = startTask({ cwd: process.cwd(), slug: maybeSlug });
        printStartResult(result);
        break;
      }
      case "sync": {
        const result = syncTask({ cwd: process.cwd() });
        console.log(`Rebased ${result.branchName} onto origin/${DEFAULT_BRANCH}.`);
        break;
      }
      case "finish": {
        const result = finishTask({ cwd: process.cwd(), slug: maybeSlug });
        console.log(`Removed local worktree and deleted ${result.branchName}.`);
        break;
      }
      default:
        throw new WorkflowError(
          "Unknown command. Use one of: start, sync, finish.",
        );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  }
}

function printStartResult(result) {
  const lines = [
    result.action === "reused"
      ? `Reusing ${result.branchName}.`
      : `Created ${result.branchName}.`,
    `Worktree: ${result.worktreePath}`,
    `Next: cd ${shellQuote(result.worktreePath)}`,
    `Push when ready: git push -u origin ${result.branchName}`,
    "Open a draft PR after the first push: gh pr create --draft --fill",
  ];
  console.log(lines.join("\n"));
}

function resolveRepoRoot(cwd) {
  return path.resolve(runGit(["rev-parse", "--show-toplevel"], { cwd }).stdout);
}

function ensurePrimaryMainCheckout(repoRoot) {
  const branchName = currentBranch(repoRoot);
  if (branchName !== DEFAULT_BRANCH) {
    throw new WorkflowError(
      `task:start and task:finish must run from the clean primary ${DEFAULT_BRANCH} checkout. Current branch: ${branchName || "(detached)"}.`,
    );
  }

  const gitDir = resolveGitMetaPath(repoRoot, runGit(["rev-parse", "--git-dir"], { cwd: repoRoot }).stdout);
  const commonDir = resolveGitMetaPath(
    repoRoot,
    runGit(["rev-parse", "--git-common-dir"], { cwd: repoRoot }).stdout,
  );

  if (gitDir !== commonDir) {
    throw new WorkflowError("This command must run from the primary checkout, not from a linked worktree.");
  }
}

function ensureLinkedTaskWorktree(repoRoot, commandName) {
  const branchName = currentBranch(repoRoot);
  if (!branchName.startsWith(TASK_BRANCH_PREFIX)) {
    throw new WorkflowError(
      `${commandName} must run from a ${TASK_BRANCH_PREFIX}<task-slug> branch. Current branch: ${branchName || "(detached)"}.`,
    );
  }

  const gitDir = resolveGitMetaPath(repoRoot, runGit(["rev-parse", "--git-dir"], { cwd: repoRoot }).stdout);
  const commonDir = resolveGitMetaPath(
    repoRoot,
    runGit(["rev-parse", "--git-common-dir"], { cwd: repoRoot }).stdout,
  );

  if (gitDir === commonDir) {
    throw new WorkflowError(`${commandName} must run from a linked worktree, not from the primary checkout.`);
  }
}

function currentBranch(cwd) {
  return runGit(["branch", "--show-current"], { cwd }).stdout;
}

function ensureCleanWorkingTree(cwd, commandName) {
  const status = runGit(["status", "--porcelain", "--untracked-files=normal"], {
    cwd,
    trim: false,
  }).stdout.trim();

  if (status) {
    throw new WorkflowError(`${commandName} requires a clean working tree.`);
  }
}

function fetchOrigin(cwd) {
  runGit(["fetch", "origin", "--prune"], { cwd });
}

function localBranchExists(cwd, branchName) {
  const result = spawnSync("git", ["show-ref", "--verify", "--quiet", `refs/heads/${branchName}`], {
    cwd,
    encoding: "utf8",
  });
  return result.status === 0;
}

function branchMergedIntoMain(cwd, branchName) {
  if (branchHasAncestorMerge(cwd, branchName)) {
    return true;
  }

  const githubMerged = githubPullRequestMerged(cwd, branchName);
  if (githubMerged !== null) {
    return githubMerged;
  }

  return !remoteBranchExists(cwd, branchName) && branchChangesApplied(cwd, branchName);
}

function branchHasAncestorMerge(cwd, branchName) {
  const result = spawnSync("git", ["merge-base", "--is-ancestor", branchName, `origin/${DEFAULT_BRANCH}`], {
    cwd,
    encoding: "utf8",
  });
  return result.status === 0;
}

function resolveGitMetaPath(repoRoot, gitPath) {
  return path.resolve(repoRoot, gitPath);
}

function githubPullRequestMerged(cwd, branchName) {
  const result = spawnSync(
    "gh",
    [
      "pr",
      "list",
      "--state",
      "merged",
      "--base",
      DEFAULT_BRANCH,
      "--head",
      branchName,
      "--json",
      "number,mergedAt",
    ],
    {
      cwd,
      encoding: "utf8",
    },
  );

  if (result.status !== 0) {
    return null;
  }

  const pullRequests = JSON.parse(result.stdout || "[]");
  return pullRequests.some((pullRequest) => pullRequest.mergedAt);
}

function remoteBranchExists(cwd, branchName) {
  const result = spawnSync("git", ["ls-remote", "--exit-code", "--heads", "origin", branchName], {
    cwd,
    encoding: "utf8",
  });
  return result.status === 0;
}

function branchChangesApplied(cwd, branchName) {
  const result = spawnSync("git", ["cherry", `origin/${DEFAULT_BRANCH}`, branchName], {
    cwd,
    encoding: "utf8",
  });

  if (result.status !== 0) {
    return false;
  }

  const lines = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return !lines.some((line) => line.startsWith("+"));
}

function runGit(args, options = {}) {
  const result = spawnSync("git", args, {
    cwd: options.cwd,
    encoding: "utf8",
  });

  if (result.status !== 0) {
    throw new WorkflowError((result.stderr || result.stdout || `git ${args.join(" ")} failed`).trim());
  }

  return {
    stdout: options.trim === false ? result.stdout : result.stdout.trim(),
    stderr: result.stderr.trim(),
  };
}

function shellQuote(value) {
  if (/^[A-Za-z0-9_./:-]+$/.test(value)) {
    return value;
  }
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

const isMainModule = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMainModule) {
  cli();
}
