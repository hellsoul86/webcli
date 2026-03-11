import { basename, resolve, sep } from "node:path";
import type { ThreadListEntry, WorkspaceRecord } from "@webcli/codex-protocol";
import type { Thread } from "@webcli/codex-protocol";
import { isWithinHomePath } from "./home-paths.js";

function normalizePath(value: string): string {
  return resolve(value);
}

function isBoundaryPrefix(prefix: string, candidate: string): boolean {
  if (candidate === prefix) {
    return true;
  }

  return candidate.startsWith(`${prefix}${sep}`);
}

export function matchWorkspaceForPath(
  workspaces: Array<WorkspaceRecord>,
  cwd: string,
): WorkspaceRecord | null {
  const normalizedCwd = normalizePath(cwd);
  let winner: WorkspaceRecord | null = null;

  for (const workspace of workspaces) {
    const normalizedWorkspacePath = normalizePath(workspace.absPath);
    if (!isBoundaryPrefix(normalizedWorkspacePath, normalizedCwd)) {
      continue;
    }

    if (
      winner === null ||
      normalizePath(winner.absPath).length < normalizedWorkspacePath.length
    ) {
      winner = workspace;
    }
  }

  return winner;
}

export function buildWorkspaceCatalog(
  savedWorkspaces: Array<WorkspaceRecord>,
  threads: Array<Thread>,
  homePath: string,
  ignoredPaths: Array<string> = [],
): Array<WorkspaceRecord> {
  const catalog = [...savedWorkspaces];
  const knownPaths = new Set(savedWorkspaces.map((workspace) => normalizePath(workspace.absPath)));
  const normalizedIgnoredPaths = ignoredPaths.map((path) => normalizePath(path));
  const inferredByPath = new Map<string, WorkspaceRecord>();

  for (const thread of threads) {
    const normalizedCwd = normalizePath(thread.cwd);
    if (!isWithinHomePath(normalizedCwd, homePath)) {
      continue;
    }

    if (normalizedIgnoredPaths.some((ignoredPath) => isBoundaryPrefix(ignoredPath, normalizedCwd))) {
      continue;
    }

    if (matchWorkspaceForPath(savedWorkspaces, normalizedCwd)) {
      continue;
    }

    const existing = inferredByPath.get(normalizedCwd);
    const timestamp = new Date(thread.updatedAt).toISOString();
    if (existing) {
      if (existing.updatedAt < timestamp) {
        inferredByPath.set(normalizedCwd, {
          ...existing,
          updatedAt: timestamp,
        });
      }
      continue;
    }

    if (knownPaths.has(normalizedCwd)) {
      continue;
    }

    inferredByPath.set(normalizedCwd, {
      id: `derived:${normalizedCwd}`,
      name: normalizedCwd === normalizePath(homePath) ? "~" : basename(normalizedCwd),
      absPath: normalizedCwd,
      source: "derived",
      defaultModel: null,
      approvalPolicy: "on-request",
      sandboxMode: "danger-full-access",
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }

  return [
    ...catalog,
    ...Array.from(inferredByPath.values()).sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt) || left.absPath.localeCompare(right.absPath),
    ),
  ];
}

export function decorateThread(
  thread: Thread,
  workspaces: Array<WorkspaceRecord>,
  archived: boolean,
): ThreadListEntry {
  const workspace = matchWorkspaceForPath(workspaces, thread.cwd);

  return {
    id: thread.id,
    name: thread.name,
    preview: thread.preview,
    archived,
    cwd: thread.cwd,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    status: thread.status,
    modelProvider: thread.modelProvider,
    source: thread.source,
    agentNickname: thread.agentNickname,
    agentRole: thread.agentRole,
    gitInfo: thread.gitInfo,
    path: thread.path,
    ephemeral: thread.ephemeral,
    workspaceId: workspace?.id ?? null,
    workspaceName: workspace?.name ?? null,
  };
}
