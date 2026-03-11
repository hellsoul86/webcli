import { readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import type { PathSuggestionsResponse } from "@webcli/contracts";

export function resolveHomeDirectory(): string {
  return resolve(homedir());
}

export function resolveWorkspacePath(value: string, homePath = resolveHomeDirectory()): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "~" || trimmed === "~/") {
    return homePath;
  }

  if (trimmed.startsWith("~/")) {
    return resolve(homePath, trimmed.slice(2));
  }

  if (trimmed === homePath || trimmed.startsWith(`${homePath}${sep}`)) {
    return resolve(trimmed);
  }

  if (trimmed.startsWith(sep)) {
    return resolve(trimmed);
  }

  return resolve(homePath, trimmed);
}

export function isWithinHomePath(candidate: string, homePath = resolveHomeDirectory()): boolean {
  const normalizedCandidate = resolve(candidate);
  const normalizedHome = resolve(homePath);
  return (
    normalizedCandidate === normalizedHome ||
    normalizedCandidate.startsWith(`${normalizedHome}${sep}`)
  );
}

export function toDisplayPath(candidate: string, homePath = resolveHomeDirectory()): string {
  const normalizedCandidate = resolve(candidate);
  const normalizedHome = resolve(homePath);
  if (!isWithinHomePath(normalizedCandidate, normalizedHome)) {
    return normalizedCandidate;
  }

  const rel = relative(normalizedHome, normalizedCandidate);
  return rel ? `~/${rel}` : "~/";
}

export function ensureHomeScopedDirectory(
  value: string,
  homePath = resolveHomeDirectory(),
): string {
  const normalized = ensureHomeScopedPath(value, homePath);
  const stats = statSync(normalized, { throwIfNoEntry: false });
  if (!stats || !stats.isDirectory()) {
    throw new Error(`Workspace path is not a directory: ${value}`);
  }

  return normalized;
}

export function ensureHomeScopedPath(
  value: string,
  homePath = resolveHomeDirectory(),
): string {
  const normalized = resolveWorkspacePath(value, homePath);
  if (!isWithinHomePath(normalized, homePath)) {
    throw new Error(`Workspace path must stay inside ${toDisplayPath(homePath, homePath)}`);
  }

  return normalized;
}

export function listHomePathSuggestions(
  query: string | undefined,
  homePath = resolveHomeDirectory(),
): PathSuggestionsResponse {
  const trimmed = query?.trim() ?? "";
  const normalizedQuery = normalizeQueryForDisplay(trimmed, homePath);
  const absoluteTarget = resolveWorkspacePath(trimmed || "~/", homePath);
  const withinHome = isWithinHomePath(absoluteTarget, homePath);

  if (!withinHome) {
    return {
      homePath,
      query: trimmed,
      normalizedQuery,
      resolvedPath: absoluteTarget,
      withinHome: false,
      isDirectory: false,
      data: [],
    };
  }

  const search = resolveSearchDirectory(trimmed, absoluteTarget, homePath);
  if (!search) {
    return {
      homePath,
      query: trimmed,
      normalizedQuery,
      resolvedPath: absoluteTarget,
      withinHome: true,
      isDirectory: isDirectory(absoluteTarget),
      data: [],
    };
  }

  const prefixLower = search.prefix.toLowerCase();
  const suggestions = readdirSync(search.directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .filter((entry) => entry.name.toLowerCase().startsWith(prefixLower))
    .sort((left, right) => left.name.localeCompare(right.name))
    .slice(0, 12)
    .map((entry) => {
      const absPath = join(search.directory, entry.name);
      return {
        value: toDisplayPath(absPath, homePath),
        absPath,
      };
    });

  return {
    homePath,
    query: trimmed,
    normalizedQuery,
    resolvedPath: absoluteTarget,
    withinHome: true,
    isDirectory: isDirectory(absoluteTarget),
    data: suggestions,
  };
}

function normalizeQueryForDisplay(value: string, homePath: string): string {
  if (!value) {
    return "~/";
  }

  if (value === "~" || value === "~/") {
    return "~/";
  }

  if (value.startsWith("~/")) {
    return value;
  }

  if (value === homePath || value.startsWith(`${homePath}${sep}`)) {
    return toDisplayPath(value, homePath);
  }

  if (value.startsWith(sep)) {
    return value;
  }

  return `~/${value.replace(/^\.?\//, "")}`;
}

function resolveSearchDirectory(
  query: string,
  absoluteTarget: string,
  homePath: string,
): { directory: string; prefix: string } | null {
  const queryTargetsDirectory =
    !query ||
    query === "~" ||
    query === "~/" ||
    query.endsWith("/") ||
    isDirectory(absoluteTarget);

  let directory = queryTargetsDirectory ? absoluteTarget : dirname(absoluteTarget);
  let prefix = queryTargetsDirectory ? "" : basename(absoluteTarget);

  while (isWithinHomePath(directory, homePath)) {
    if (isDirectory(directory)) {
      return { directory, prefix };
    }

    if (directory === homePath) {
      return null;
    }

    prefix = basename(directory);
    directory = dirname(directory);
  }

  return null;
}

function isDirectory(value: string): boolean {
  const stats = statSync(value, { throwIfNoEntry: false });
  return Boolean(stats?.isDirectory());
}
