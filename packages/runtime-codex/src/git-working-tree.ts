import { spawn } from "node:child_process";
import { AppError } from "@webcli/contracts";
import type {
  GitBranchReference,
  GitWorkingTreeFile,
  GitWorkingTreeFileStatus,
  GitWorkingTreeSnapshot,
} from "@webcli/contracts";

type ReadGitWorkingTreeSnapshotInput = {
  cwd: string;
  workspaceId: string;
  workspaceName: string;
};

type StatusRecord = {
  path: string;
  oldPath: string | null;
  status: GitWorkingTreeFileStatus;
  staged: boolean;
  unstaged: boolean;
};

type CommandResult = {
  code: number;
  stdout: string;
  stderr: string;
};

export async function readGitWorkingTreeSnapshot(
  input: ReadGitWorkingTreeSnapshotInput,
): Promise<GitWorkingTreeSnapshot> {
  const repoRootResult = await runCommand(
    "git",
    ["rev-parse", "--show-toplevel"],
    input.cwd,
    [0, 128],
  );

  if (repoRootResult.code !== 0) {
    return {
      workspaceId: input.workspaceId,
      workspaceName: input.workspaceName,
      repoRoot: null,
      branch: null,
      isGitRepository: false,
      clean: true,
      stagedCount: 0,
      unstagedCount: 0,
      untrackedCount: 0,
      generatedAt: Date.now(),
      files: [],
    };
  }

  const repoRoot = repoRootResult.stdout.trim();
  const [branchResult, statusResult] = await Promise.all([
    runCommand("git", ["rev-parse", "--abbrev-ref", "HEAD"], repoRoot, [0, 128]),
    runCommand(
      "git",
      ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
      repoRoot,
      [0],
    ),
  ]);
  const headResult = await runCommand("git", ["rev-parse", "--verify", "HEAD"], repoRoot, [0, 128]);
  const hasHead = headResult.code === 0;

  const records = parseStatusRecords(statusResult.stdout);
  const files = await Promise.all(
    records.map((record) => buildWorkingTreeFile(repoRoot, record, hasHead)),
  );

  return {
    workspaceId: input.workspaceId,
    workspaceName: input.workspaceName,
    repoRoot,
    branch: branchResult.code === 0 ? branchResult.stdout.trim() || null : null,
    isGitRepository: true,
    clean: files.length === 0,
    stagedCount: records.filter((record) => record.staged).length,
    unstagedCount: records.filter((record) => record.unstaged).length,
    untrackedCount: records.filter((record) => record.status === "untracked").length,
    generatedAt: Date.now(),
    files: files.sort((left: GitWorkingTreeFile, right: GitWorkingTreeFile) =>
      left.path.localeCompare(right.path),
    ),
  };
}

export async function readGitBranches(
  cwd: string,
): Promise<{ branches: Array<GitBranchReference>; currentBranch: string | null }> {
  const repoRootResult = await runCommand(
    "git",
    ["rev-parse", "--show-toplevel"],
    cwd,
    [0, 128],
  );

  if (repoRootResult.code !== 0) {
    return {
      branches: [],
      currentBranch: null,
    };
  }

  const repoRoot = repoRootResult.stdout.trim();
  const [currentBranchResult, listResult] = await Promise.all([
    runCommand("git", ["rev-parse", "--abbrev-ref", "HEAD"], repoRoot, [0, 128]),
    runCommand("git", ["for-each-ref", "--format=%(refname:short)", "refs/heads"], repoRoot, [0]),
  ]);

  const currentBranch =
    currentBranchResult.code === 0 ? currentBranchResult.stdout.trim() || null : null;
  const names = listResult.stdout
    .split("\n")
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (currentBranch && !names.includes(currentBranch)) {
    names.unshift(currentBranch);
  }

  return {
    currentBranch,
    branches: names.map((name) => ({
      name,
      current: currentBranch === name,
    })),
  };
}

export async function switchGitBranch(cwd: string, branch: string): Promise<void> {
  const repoRootResult = await runCommand(
    "git",
    ["rev-parse", "--show-toplevel"],
    cwd,
    [0, 128],
  );

  if (repoRootResult.code !== 0) {
    throw new AppError("git.not_repo", "Current project is not a Git repository");
  }

  const repoRoot = repoRootResult.stdout.trim();
  const switchResult = await runCommand("git", ["switch", branch], repoRoot, [0]);
  if (switchResult.code !== 0) {
    throw new AppError(
      "git.branch_switch_failed",
      switchResult.stderr.trim() || `Failed to switch Git branch to ${branch}`,
      { branch },
    );
  }
}

async function buildWorkingTreeFile(
  repoRoot: string,
  record: StatusRecord,
  hasHead: boolean,
): Promise<GitWorkingTreeFile> {
  const patch = await readPatch(repoRoot, record, hasHead);
  const { additions, deletions } = countPatchChanges(patch);

  return {
    path: record.path,
    status: record.status,
    staged: record.staged,
    unstaged: record.unstaged,
    additions,
    deletions,
    patch,
    oldPath: record.oldPath,
  };
}

async function readPatch(
  repoRoot: string,
  record: StatusRecord,
  hasHead: boolean,
): Promise<string> {
  if (record.status === "untracked") {
    const result = await runCommand(
      "git",
      ["diff", "--no-index", "--", "/dev/null", record.path],
      repoRoot,
      [0, 1],
    );
    return trimTrailingNewline(result.stdout);
  }

  if (hasHead) {
    const result = await runCommand(
      "git",
      [
        "diff",
        "HEAD",
        "--no-ext-diff",
        "--patch",
        "--submodule=diff",
        "--find-renames",
        "--find-copies",
        "--",
        record.path,
      ],
      repoRoot,
      [0, 1],
    );
    return trimTrailingNewline(result.stdout);
  }

  const patchParts: Array<string> = [];

  if (record.staged) {
    const stagedResult = await runCommand(
      "git",
      [
        "diff",
        "--cached",
        "--no-ext-diff",
        "--patch",
        "--submodule=diff",
        "--find-renames",
        "--find-copies",
        "--",
        record.path,
      ],
      repoRoot,
      [0, 1],
    );
    if (stagedResult.stdout.trim()) {
      patchParts.push(trimTrailingNewline(stagedResult.stdout));
    }
  }

  if (record.unstaged) {
    const unstagedResult = await runCommand(
      "git",
      [
        "diff",
        "--no-ext-diff",
        "--patch",
        "--submodule=diff",
        "--find-renames",
        "--find-copies",
        "--",
        record.path,
      ],
      repoRoot,
      [0, 1],
    );
    if (unstagedResult.stdout.trim()) {
      patchParts.push(trimTrailingNewline(unstagedResult.stdout));
    }
  }

  return patchParts.join("\n\n");
}

function parseStatusRecords(output: string): Array<StatusRecord> {
  const chunks = output.split("\0");
  const records: Array<StatusRecord> = [];

  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    if (!chunk) {
      continue;
    }

    const x = chunk[0] ?? " ";
    const y = chunk[1] ?? " ";
    const path = chunk.slice(3);
    if (!path) {
      continue;
    }

    let oldPath: string | null = null;
    if (x === "R" || x === "C" || y === "R" || y === "C") {
      oldPath = chunks[index + 1] || null;
      index += 1;
    }

    records.push({
      path,
      oldPath,
      status: deriveStatus(x, y),
      staged: x !== " " && x !== "?" && x !== "!",
      unstaged: y !== " " && y !== "?" && y !== "!",
    });
  }

  return records;
}

function deriveStatus(x: string, y: string): GitWorkingTreeFileStatus {
  const pair = `${x}${y}`;

  if (pair === "??") {
    return "untracked";
  }

  if (
    x === "U" ||
    y === "U" ||
    pair === "AA" ||
    pair === "DD" ||
    pair === "AU" ||
    pair === "UA" ||
    pair === "DU" ||
    pair === "UD" ||
    pair === "UU"
  ) {
    return "conflicted";
  }

  if (x === "R" || y === "R") {
    return "renamed";
  }

  if (x === "C" || y === "C") {
    return "copied";
  }

  if (x === "D" || y === "D") {
    return "deleted";
  }

  if (x === "A" || y === "A") {
    return "added";
  }

  if (x === "T" || y === "T") {
    return "typechange";
  }

  return "modified";
}

function countPatchChanges(patch: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;

  for (const line of patch.split("\n")) {
    if (line.startsWith("+++ ") || line.startsWith("--- ")) {
      continue;
    }

    if (line.startsWith("+")) {
      additions += 1;
      continue;
    }

    if (line.startsWith("-")) {
      deletions += 1;
    }
  }

  return { additions, deletions };
}

function trimTrailingNewline(value: string): string {
  return value.replace(/\n+$/u, "");
}

async function runCommand(
  command: string,
  args: Array<string>,
  cwd: string,
  acceptedExitCodes: Array<number>,
): Promise<CommandResult> {
  return new Promise<CommandResult>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      const exitCode = code ?? -1;
      if (!acceptedExitCodes.includes(exitCode)) {
        reject(
          new Error(
            stderr.trim() || `${command} ${args.join(" ")} failed with exit code ${exitCode}`,
          ),
        );
        return;
      }

      resolve({
        code: exitCode,
        stdout,
        stderr,
      });
    });
  });
}
