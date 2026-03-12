import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { AppError } from "@webcli/contracts";
import type {
  GitBranchReference,
  GitFileReviewDetail,
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

type BufferCommandResult = {
  code: number;
  stdout: Buffer;
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

export async function readGitFileReviewDetail(
  cwd: string,
  file: GitWorkingTreeFile,
): Promise<GitFileReviewDetail> {
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
  const language = inferGitFileLanguage(file.path);
  const fallbackPatch = file.patch || "";

  if (file.status === "conflicted") {
    return {
      path: file.path,
      oldPath: file.oldPath ?? null,
      status: file.status,
      language,
      mode: "patch",
      patch: fallbackPatch,
      reason: "Merge conflicts are shown as raw patch output.",
    };
  }

  if (file.status === "copied" || file.status === "typechange") {
    return {
      path: file.path,
      oldPath: file.oldPath ?? null,
      status: file.status,
      language,
      mode: "patch",
      patch: fallbackPatch,
      reason: "This change is shown as raw patch output.",
    };
  }

  try {
    const detail = await buildGitFileReviewDetail(repoRoot, file, language);
    return detail;
  } catch (error) {
    return {
      path: file.path,
      oldPath: file.oldPath ?? null,
      status: file.status,
      language,
      mode: "unavailable",
      patch: fallbackPatch,
      reason:
        error instanceof Error && error.message
          ? error.message
          : "Unable to load file contents for inline diff.",
    };
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

async function buildGitFileReviewDetail(
  repoRoot: string,
  file: GitWorkingTreeFile,
  language: string | null,
): Promise<GitFileReviewDetail> {
  const [originalBuffer, modifiedBuffer] = await Promise.all([
    readGitOriginalBuffer(repoRoot, file),
    readGitModifiedBuffer(repoRoot, file),
  ]);

  const originalText = decodeGitTextBuffer(originalBuffer);
  const modifiedText = decodeGitTextBuffer(modifiedBuffer);

  if (originalText === null || modifiedText === null) {
    return {
      path: file.path,
      oldPath: file.oldPath ?? null,
      status: file.status,
      language,
      mode: "binary",
      patch: file.patch || "",
      reason: "Binary or non-text content cannot be rendered as inline diff.",
    };
  }

  return {
    path: file.path,
    oldPath: file.oldPath ?? null,
    status: file.status,
    language,
    mode: "inline-diff",
    originalText,
    modifiedText,
  };
}

async function readGitOriginalBuffer(repoRoot: string, file: GitWorkingTreeFile): Promise<Buffer> {
  switch (file.status) {
    case "added":
    case "untracked":
      return Buffer.alloc(0);
    case "renamed":
      return readGitObjectBuffer(repoRoot, file.oldPath ?? file.path);
    case "deleted":
    case "modified":
      return readGitObjectBuffer(repoRoot, file.path);
    default:
      return Buffer.alloc(0);
  }
}

async function readGitModifiedBuffer(repoRoot: string, file: GitWorkingTreeFile): Promise<Buffer> {
  switch (file.status) {
    case "deleted":
      return Buffer.alloc(0);
    case "modified":
    case "added":
    case "untracked":
    case "renamed":
      return readWorkingTreeBuffer(repoRoot, file.path);
    default:
      return Buffer.alloc(0);
  }
}

async function readGitObjectBuffer(repoRoot: string, path: string): Promise<Buffer> {
  if (!path) {
    return Buffer.alloc(0);
  }

  const result = await runCommandBuffer(
    "git",
    ["show", `HEAD:${path}`],
    repoRoot,
    [0],
  );
  return result.stdout;
}

async function readWorkingTreeBuffer(repoRoot: string, path: string): Promise<Buffer> {
  try {
    return await readFile(join(repoRoot, path));
  } catch {
    throw new AppError("git.file_read_failed", "Unable to read file from working tree", {
      path,
    });
  }
}

function decodeGitTextBuffer(buffer: Buffer): string | null {
  if (buffer.length === 0) {
    return "";
  }

  if (buffer.includes(0)) {
    return null;
  }

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return null;
  }
}

function inferGitFileLanguage(path: string): string | null {
  const normalized = path.replace(/\\/g, "/");
  const fileName = normalized.split("/").pop()?.toLowerCase() ?? "";
  const extension = extname(fileName).toLowerCase();

  if (fileName === "dockerfile") {
    return "dockerfile";
  }
  if (fileName === "makefile") {
    return "makefile";
  }
  if (fileName.endsWith(".test.ts") || fileName.endsWith(".spec.ts") || extension === ".ts") {
    return "typescript";
  }
  if (fileName.endsWith(".test.tsx") || fileName.endsWith(".spec.tsx") || extension === ".tsx") {
    return "typescript";
  }
  if (extension === ".js" || extension === ".mjs" || extension === ".jsx") {
    return "javascript";
  }
  if (extension === ".json") {
    return "json";
  }
  if (extension === ".md") {
    return "markdown";
  }
  if (extension === ".py") {
    return "python";
  }
  if (extension === ".rs") {
    return "rust";
  }
  if (extension === ".go") {
    return "go";
  }
  if (extension === ".java") {
    return "java";
  }
  if (extension === ".css" || extension === ".scss") {
    return "css";
  }
  if (extension === ".html") {
    return "html";
  }
  if (extension === ".xml") {
    return "xml";
  }
  if (extension === ".yml" || extension === ".yaml") {
    return "yaml";
  }
  if (extension === ".sh") {
    return "shell";
  }
  if (extension === ".sql") {
    return "sql";
  }
  if (extension === ".toml") {
    return "ini";
  }
  if (extension === ".php") {
    return "php";
  }
  if (extension === ".rb") {
    return "ruby";
  }
  if (extension === ".swift") {
    return "swift";
  }
  if (extension === ".kt" || extension === ".kts") {
    return "kotlin";
  }
  if (extension === ".cpp" || extension === ".cc" || extension === ".hpp" || extension === ".h") {
    return "cpp";
  }
  if (extension === ".c") {
    return "c";
  }
  if (extension === ".lua") {
    return "lua";
  }
  if (extension === ".txt") {
    return "plaintext";
  }

  return extension ? "plaintext" : null;
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

async function runCommandBuffer(
  command: string,
  args: Array<string>,
  cwd: string,
  acceptedExitCodes: Array<number>,
): Promise<BufferCommandResult> {
  return new Promise<BufferCommandResult>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const stdoutChunks: Array<Buffer> = [];
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
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
        stdout: Buffer.concat(stdoutChunks),
        stderr,
      });
    });
  });
}
