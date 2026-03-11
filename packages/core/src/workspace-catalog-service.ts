import { basename, resolve, sep } from "node:path";
import type { ThreadSummary, WorkspaceRecord } from "@webcli/contracts";
import { isWithinHomePath } from "./home-paths.js";
import type { RuntimeThreadRecord } from "./runtime.js";

function normalizePath(value: string): string {
  return resolve(value);
}

function isBoundaryPrefix(prefix: string, candidate: string): boolean {
  if (candidate === prefix) {
    return true;
  }

  return candidate.startsWith(`${prefix}${sep}`);
}

export class WorkspaceCatalogService {
  matchWorkspaceForPath(
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

  buildWorkspaceCatalog(
    savedWorkspaces: Array<WorkspaceRecord>,
    threads: Array<RuntimeThreadRecord>,
    homePath: string,
    ignoredPaths: Array<string> = [],
  ): Array<WorkspaceRecord> {
    const catalog = [...savedWorkspaces];
    const normalizedHomePath = normalizePath(homePath);
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

      const matchedSavedWorkspace = this.matchWorkspaceForPath(savedWorkspaces, normalizedCwd);
      if (
        matchedSavedWorkspace &&
        normalizePath(matchedSavedWorkspace.absPath) !== normalizedHomePath
      ) {
        continue;
      }

      const existing = inferredByPath.get(normalizedCwd);
      const timestamp = new Date(thread.updatedAt * 1000).toISOString();
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
        name: normalizedCwd === normalizedHomePath ? "~" : basename(normalizedCwd),
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

  filterThreadsByWorkspaceScope(
    threads: Array<ThreadSummary>,
    workspaceId: string | undefined,
  ): Array<ThreadSummary> {
    if (!workspaceId || workspaceId === "all") {
      return threads.filter((thread) => thread.workspaceId !== null);
    }

    return threads.filter((thread) => thread.workspaceId === workspaceId);
  }
}
