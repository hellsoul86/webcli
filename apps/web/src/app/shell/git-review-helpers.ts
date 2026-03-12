import type { GitWorkingTreeFile } from "@webcli/contracts";

export type GitReviewGroupId =
  | "conflicted"
  | "staged-unstaged"
  | "staged"
  | "unstaged"
  | "untracked";

export type GitReviewTreeNode =
  | {
      kind: "directory";
      id: string;
      key: string;
      name: string;
      path: string;
      additions: number;
      deletions: number;
      fileCount: number;
      children: Array<GitReviewTreeNode>;
    }
  | {
      kind: "file";
      id: string;
      key: string;
      name: string;
      path: string;
      file: GitWorkingTreeFile;
    };

export type GitReviewGroup = {
  id: GitReviewGroupId;
  files: Array<GitWorkingTreeFile>;
  additions: number;
  deletions: number;
  fileCount: number;
  tree: Array<GitReviewTreeNode>;
};

type InternalDirectory = {
  name: string;
  path: string;
  directories: Map<string, InternalDirectory>;
  files: Array<GitWorkingTreeFile>;
};

const GROUP_ORDER: Array<GitReviewGroupId> = [
  "conflicted",
  "staged-unstaged",
  "staged",
  "unstaged",
  "untracked",
];

export function buildGitReviewGroups(
  files: Array<GitWorkingTreeFile>,
  query: string,
): Array<GitReviewGroup> {
  const normalizedQuery = query.trim().toLowerCase();
  const grouped = new Map<GitReviewGroupId, Array<GitWorkingTreeFile>>();

  for (const file of files) {
    if (normalizedQuery && !file.path.toLowerCase().includes(normalizedQuery)) {
      continue;
    }

    const groupId = classifyGitReviewGroup(file);
    const groupFiles = grouped.get(groupId) ?? [];
    groupFiles.push(file);
    grouped.set(groupId, groupFiles);
  }

  return GROUP_ORDER.flatMap((groupId) => {
    const groupFiles = grouped.get(groupId) ?? [];
    if (groupFiles.length === 0) {
      return [];
    }

    return [
      {
        id: groupId,
        files: [...groupFiles].sort((left, right) => left.path.localeCompare(right.path)),
        additions: groupFiles.reduce((total, file) => total + file.additions, 0),
        deletions: groupFiles.reduce((total, file) => total + file.deletions, 0),
        fileCount: groupFiles.length,
        tree: buildGitReviewTree(groupId, groupFiles),
      },
    ];
  });
}

export function resolvePreferredGitReviewFile(
  groups: ReadonlyArray<GitReviewGroup>,
  currentPath: string | null | undefined,
): string | null {
  const availablePaths = groups.flatMap((group) => group.files.map((file) => file.path));
  if (currentPath && availablePaths.includes(currentPath)) {
    return currentPath;
  }

  return availablePaths[0] ?? null;
}

export function findGitReviewFile(
  groups: ReadonlyArray<GitReviewGroup>,
  path: string | null | undefined,
): GitWorkingTreeFile | null {
  if (!path) {
    return null;
  }

  for (const group of groups) {
    const match = group.files.find((file) => file.path === path);
    if (match) {
      return match;
    }
  }

  return null;
}

export function collectAutoExpandedDirectoryKeys(
  groups: ReadonlyArray<GitReviewGroup>,
  selectedPath: string | null,
  query: string,
): Array<string> {
  const keys = new Set<string>();
  const filtered = query.trim().length > 0;

  for (const group of groups) {
    for (const node of group.tree) {
      if (node.kind === "directory") {
        keys.add(node.key);
      }
    }

    if (selectedPath) {
      const selectedFile = group.files.find((file) => file.path === selectedPath);
      if (selectedFile) {
        for (const ancestor of collectAncestorPaths(selectedFile.path)) {
          keys.add(makeDirectoryKey(group.id, ancestor));
        }
      }
    }

    if (filtered) {
      for (const file of group.files) {
        for (const ancestor of collectAncestorPaths(file.path)) {
          keys.add(makeDirectoryKey(group.id, ancestor));
        }
      }
    }
  }

  return [...keys];
}

export function makeDirectoryKey(groupId: GitReviewGroupId, path: string): string {
  return `${groupId}:${path || "__root__"}`;
}

function classifyGitReviewGroup(file: GitWorkingTreeFile): GitReviewGroupId {
  if (file.status === "conflicted") {
    return "conflicted";
  }
  if (file.staged && file.unstaged) {
    return "staged-unstaged";
  }
  if (file.staged) {
    return "staged";
  }
  if (file.status === "untracked") {
    return "untracked";
  }
  return "unstaged";
}

function buildGitReviewTree(
  groupId: GitReviewGroupId,
  files: Array<GitWorkingTreeFile>,
): Array<GitReviewTreeNode> {
  const root: InternalDirectory = {
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

  return finalizeDirectory(groupId, root).children;
}

function finalizeDirectory(
  groupId: GitReviewGroupId,
  directory: InternalDirectory,
): Extract<GitReviewTreeNode, { kind: "directory" }> {
  const children: Array<GitReviewTreeNode> = [];
  let additions = 0;
  let deletions = 0;
  let fileCount = 0;

  const sortedDirectories = [...directory.directories.values()].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
  for (const childDirectory of sortedDirectories) {
    const childNode = finalizeDirectory(groupId, childDirectory);
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
      id: `${groupId}:file:${file.path}`,
      key: `${groupId}:file:${file.path}`,
      name: file.path.split("/").pop() ?? file.path,
      path: file.path,
      file,
    });
  }

  return {
    kind: "directory",
    id: `${groupId}:dir:${directory.path || "__root__"}`,
    key: makeDirectoryKey(groupId, directory.path),
    name: directory.name || "__root__",
    path: directory.path,
    additions,
    deletions,
    fileCount,
    children,
  };
}

function collectAncestorPaths(path: string): Array<string> {
  const segments = path.split("/").filter(Boolean);
  const paths: Array<string> = [];

  for (let index = 0; index < segments.length - 1; index += 1) {
    paths.push(segments.slice(0, index + 1).join("/"));
  }

  return paths;
}
