import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  buildTaskBranchName,
  buildWorktreePath,
  finishTask,
  normalizeTaskSlug,
  startTask,
  syncTask,
  WorkflowError,
} from "./task-workflow.mjs";

test("normalizeTaskSlug removes codex prefix and slugifies input", () => {
  assert.equal(normalizeTaskSlug("Codex/Git Review Panel"), "git-review-panel");
});

test("task:start rejects a dirty primary checkout", () => {
  const repo = createFixtureRepo();
  writeFileSync(path.join(repo.primary, "dirty.txt"), "dirty\n");

  assert.throws(
    () => startTask({ cwd: repo.primary, slug: "dirty-check" }),
    new WorkflowError("task:start requires a clean working tree."),
  );
});

test("task:start creates and then reuses a task worktree", () => {
  const repo = createFixtureRepo();

  const created = startTask({ cwd: repo.primary, slug: "git review" });
  const expectedBranch = buildTaskBranchName("git-review");
  const expectedPath = buildWorktreePath(repo.primary, "git-review");

  assert.equal(created.action, "created");
  assert.equal(created.branchName, expectedBranch);
  assert.equal(realpathSync(created.worktreePath), realpathSync(expectedPath));
  assert.equal(runGit(repo.primary, ["branch", "--show-current"]).stdout, "main");
  assert.equal(runGit(created.worktreePath, ["branch", "--show-current"]).stdout, expectedBranch);
  assert.ok(existsSync(created.worktreePath));

  const reused = startTask({ cwd: repo.primary, slug: "git review" });
  assert.equal(reused.action, "reused");
  assert.equal(realpathSync(reused.worktreePath), realpathSync(expectedPath));

  const worktreeList = runGit(repo.primary, ["worktree", "list", "--porcelain"]).stdout;
  assert.equal((worktreeList.match(/worktree /g) ?? []).length, 2);
});

test("task:sync rebases a clean task worktree and rejects dirty worktrees", () => {
  const repo = createFixtureRepo();
  const started = startTask({ cwd: repo.primary, slug: "sync-flow" });

  const advancedMain = path.join(repo.root, "main-update");
  runGit(repo.root, ["clone", repo.origin, advancedMain]);
  runGit(advancedMain, ["checkout", "main"]);
  configureGitIdentity(advancedMain);
  writeFileSync(path.join(advancedMain, "README.md"), "updated on main\n");
  runGit(advancedMain, ["add", "README.md"]);
  runGit(advancedMain, ["commit", "-m", "advance main"]);
  runGit(advancedMain, ["push", "origin", "main"]);

  const synced = syncTask({ cwd: started.worktreePath });
  assert.equal(synced.branchName, buildTaskBranchName("sync-flow"));
  assert.match(
    runGit(started.worktreePath, ["show", "--stat", "--oneline", "HEAD"]).stdout,
    /advance main/,
  );

  writeFileSync(path.join(started.worktreePath, "dirty.txt"), "dirty\n");
  assert.throws(
    () => syncTask({ cwd: started.worktreePath }),
    new WorkflowError("task:sync requires a clean working tree."),
  );
});

test("task:finish only cleans up merged branches", () => {
  const repo = createFixtureRepo();
  const started = startTask({ cwd: repo.primary, slug: "finish-flow" });
  const branchName = buildTaskBranchName("finish-flow");

  writeFileSync(path.join(started.worktreePath, "feature.txt"), "feature\n");
  runGit(started.worktreePath, ["add", "feature.txt"]);
  runGit(started.worktreePath, ["commit", "-m", "feature work"]);

  assert.throws(
    () => finishTask({ cwd: repo.primary, slug: "finish-flow" }),
    new WorkflowError(`Refusing to clean up ${branchName} because it has not been merged into origin/main.`),
  );

  runGit(repo.primary, ["merge", "--squash", branchName]);
  runGit(repo.primary, ["commit", "-m", "merge finish flow"]);
  runGit(repo.primary, ["push", "origin", "main"]);

  const finished = finishTask({ cwd: repo.primary, slug: "finish-flow" });
  assert.equal(finished.branchName, branchName);
  assert.ok(!existsSync(started.worktreePath));
  assert.equal(runGit(repo.primary, ["branch", "--list", branchName]).stdout, "");
});

function createFixtureRepo() {
  const root = mkdtempSync(path.join(os.tmpdir(), "webcli-workflow-"));
  const origin = realpathSync(root);
  const originPath = path.join(origin, "origin.git");
  const seed = path.join(origin, "seed");
  const primary = path.join(origin, "webcli");

  runGit(origin, ["init", "--bare", originPath]);
  runGit(origin, ["clone", originPath, seed]);
  configureGitIdentity(seed);
  runGit(seed, ["checkout", "-b", "main"]);
  writeFileSync(path.join(seed, "README.md"), "seed\n");
  runGit(seed, ["add", "README.md"]);
  runGit(seed, ["commit", "-m", "initial commit"]);
  runGit(seed, ["push", "-u", "origin", "main"]);

  runGit(origin, ["clone", originPath, primary]);
  configureGitIdentity(primary);
  runGit(primary, ["checkout", "main"]);

  return { root: origin, origin: originPath, primary, seed };
}

function configureGitIdentity(cwd) {
  runGit(cwd, ["config", "user.name", "Workflow Test"]);
  runGit(cwd, ["config", "user.email", "workflow@example.com"]);
}

function runGit(cwd, args) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
  });

  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `git ${args.join(" ")} failed`).trim());
  }

  return {
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
  };
}
