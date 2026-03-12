import type {
  GitWorkingTreeFile,
  GitWorkingTreeSnapshot,
  ReviewFinding,
  TimelineEntry,
  WorkbenchThread,
} from "@webcli/contracts";
import { formatNumber } from "../../i18n/format";
import { translate } from "../../i18n/init";

export type DiffSection = {
  id: string;
  path: string;
  label: string;
  diff: string;
  additions: number;
  deletions: number;
};

export type GitFileTreeNode =
  | {
      kind: "directory";
      id: string;
      name: string;
      path: string;
      additions: number;
      deletions: number;
      fileCount: number;
      children: Array<GitFileTreeNode>;
    }
  | {
      kind: "file";
      id: string;
      name: string;
      path: string;
      file: GitWorkingTreeFile;
    };

export type GitSnapshotSummary = {
  state: "loading" | "not-a-repo" | "clean" | "dirty";
  files: number;
  additions: number;
  deletions: number;
  expandable: boolean;
  title: string;
  detail: string;
};

type InternalGitDirectory = {
  name: string;
  path: string;
  directories: Map<string, InternalGitDirectory>;
  files: Array<GitWorkingTreeFile>;
};

export function splitUnifiedDiffByFile(diff: string): Array<DiffSection> {
  if (!diff.trim()) {
    return [];
  }

  const lines = diff.split("\n");
  const sections: Array<DiffSection> = [];
  let currentPath: string | null = null;
  let currentLines: Array<string> = [];

  const flush = () => {
    if (!currentPath || currentLines.length === 0) {
      return;
    }

    const content = currentLines.join("\n");
    sections.push({
      id: currentPath,
      path: currentPath,
      label: currentPath,
      diff: content,
      additions: countDiffLines(content, "+"),
      deletions: countDiffLines(content, "-"),
    });
  };

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      flush();
      currentPath = extractDiffPath(line) ?? `diff-${sections.length + 1}`;
      currentLines = [line];
      continue;
    }

    currentLines.push(line);
  }

  flush();

  if (sections.length > 0) {
    return sections;
  }

  return [
    {
      id: "full-diff",
      path: translate("git.fullDiff"),
      label: translate("git.fullDiff"),
      diff,
      additions: countDiffLines(diff, "+"),
      deletions: countDiffLines(diff, "-"),
    },
  ];
}

export function buildGitFileTree(files: Array<GitWorkingTreeFile>): Array<GitFileTreeNode> {
  if (files.length === 0) {
    return [];
  }

  const root: InternalGitDirectory = {
    name: "",
    path: "",
    directories: new Map(),
    files: [],
  };

  for (const file of files) {
    const segments = file.path.split("/").filter(Boolean);
    let currentDirectory = root;
    let currentPath = "";

    for (const segment of segments.slice(0, -1)) {
      currentPath = currentPath ? `${currentPath}/${segment}` : segment;
      let nextDirectory = currentDirectory.directories.get(segment);
      if (!nextDirectory) {
        nextDirectory = {
          name: segment,
          path: currentPath,
          directories: new Map(),
          files: [],
        };
        currentDirectory.directories.set(segment, nextDirectory);
      }

      currentDirectory = nextDirectory;
    }

    currentDirectory.files.push(file);
  }

  return finalizeGitDirectory(root).children;
}

export function filterGitFilesByQuery(
  files: Array<GitWorkingTreeFile>,
  query: string,
): Array<GitWorkingTreeFile> {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return files;
  }

  return files.filter((file) => file.path.toLowerCase().includes(normalizedQuery));
}

export function summarizeGitSnapshot(
  snapshot: GitWorkingTreeSnapshot | null,
): GitSnapshotSummary {
  if (!snapshot) {
    return {
      state: "loading",
      files: 0,
      additions: 0,
      deletions: 0,
      expandable: false,
      title: translate("git.readingTreeTitle"),
      detail: translate("git.readingTreeDetail"),
    };
  }

  const totals = snapshot.files.reduce(
    (accumulator, file) => ({
      files: accumulator.files + 1,
      additions: accumulator.additions + file.additions,
      deletions: accumulator.deletions + file.deletions,
    }),
    { files: 0, additions: 0, deletions: 0 },
  );

  if (!snapshot.isGitRepository) {
    return {
      state: "not-a-repo",
      ...totals,
      expandable: false,
      title: translate("git.notRepoTitle"),
      detail: translate("git.notRepoDetail"),
    };
  }

  if (snapshot.clean) {
    return {
      state: "clean",
      ...totals,
      expandable: true,
      title: translate("git.cleanTitle"),
      detail: translate("git.cleanDetail"),
    };
  }

  return {
    state: "dirty",
    ...totals,
    expandable: true,
    title: translate("git.dirtyTitle"),
    detail: translate("git.dirtyDetail", {
      files: formatNumber(totals.files),
      additions: formatNumber(totals.additions),
      deletions: formatNumber(totals.deletions),
    }),
  };
}

export function resolvePreferredSelection<T extends string>(
  availableIds: ReadonlyArray<T>,
  currentId: string | null | undefined,
): T | null {
  if (currentId && availableIds.includes(currentId as T)) {
    return currentId as T;
  }

  return availableIds[0] ?? null;
}

export function buildReviewFindingId(finding: ReviewFinding, index: number): string {
  return [
    finding.code_location.absolute_file_path,
    finding.code_location.line_range.start,
    finding.code_location.line_range.end,
    finding.title,
    index,
  ].join(":");
}

export function collectLatestMcpEntriesByServer(
  thread: WorkbenchThread | null,
): Record<string, TimelineEntry> {
  if (!thread) {
    return {};
  }

  const latestByServer: Record<string, TimelineEntry> = {};

  for (const turnId of [...thread.turnOrder].reverse()) {
    const turn = thread.turns[turnId];
    if (!turn) {
      continue;
    }

    for (const itemId of [...turn.itemOrder].reverse()) {
      const item = turn.items[itemId];
      if (!item || item.kind !== "mcpToolCall") {
        continue;
      }

      const server = readString(asRecord(item.raw), "server") ?? "MCP";
      if (!latestByServer[server]) {
        latestByServer[server] = item;
      }
    }
  }

  return latestByServer;
}

export function selectPreferredMcpServer(
  availableServerNames: ReadonlyArray<string>,
  latestByServer: Record<string, TimelineEntry>,
  currentId: string | null | undefined,
): string | null {
  if (currentId && availableServerNames.includes(currentId)) {
    return currentId;
  }

  for (const serverName of availableServerNames) {
    if (latestByServer[serverName]) {
      return serverName;
    }
  }

  return availableServerNames[0] ?? null;
}

function extractDiffPath(line: string): string | null {
  const match = line.match(/^diff --git a\/(.+?) b\/.+$/);
  return match?.[1] ?? null;
}

function countDiffLines(diff: string, prefix: "+" | "-"): number {
  let count = 0;

  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ ") || line.startsWith("--- ")) {
      continue;
    }

    if (line.startsWith(prefix)) {
      count += 1;
    }
  }

  return count;
}

function finalizeGitDirectory(directory: InternalGitDirectory): Extract<GitFileTreeNode, { kind: "directory" }> {
  const children: Array<GitFileTreeNode> = [];
  let additions = 0;
  let deletions = 0;
  let fileCount = 0;

  const sortedDirectories = Array.from(directory.directories.values()).sort((left, right) =>
    left.name.localeCompare(right.name),
  );
  for (const childDirectory of sortedDirectories) {
    const childNode = finalizeGitDirectory(childDirectory);
    additions += childNode.additions;
    deletions += childNode.deletions;
    fileCount += childNode.fileCount;
    children.push(childNode);
  }

  const sortedFiles = [...directory.files].sort((left, right) => left.path.localeCompare(right.path));
  for (const file of sortedFiles) {
    additions += file.additions;
    deletions += file.deletions;
    fileCount += 1;
    children.push({
      kind: "file",
      id: file.path,
      name: file.path.split("/").pop() ?? file.path,
      path: file.path,
      file,
    });
  }

  return {
    kind: "directory",
    id: directory.path || "__root__",
    name: directory.name || "__root__",
    path: directory.path,
    additions,
    deletions,
    fileCount,
    children,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function readString(record: Record<string, unknown> | null, key: string): string | null {
  if (!record) {
    return null;
  }

  const value = record[key];
  return typeof value === "string" ? value : null;
}
