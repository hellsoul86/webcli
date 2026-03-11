import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ensureHomeScopedDirectory,
  ensureHomeScopedPath,
  listHomePathSuggestions,
  toDisplayPath,
} from "../src/home-paths.js";

const tempDirs: Array<string> = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("home path helpers", () => {
  it("accepts directories inside the declared home path", () => {
    const homePath = mkdtempSync(join(tmpdir(), "webcli-home-"));
    tempDirs.push(homePath);
    const workspacePath = join(homePath, "Development", "webcli");
    mkdirSync(workspacePath, { recursive: true });

    expect(ensureHomeScopedDirectory("~/Development/webcli", homePath)).toBe(workspacePath);
    expect(toDisplayPath(workspacePath, homePath)).toBe("~/Development/webcli");
  });

  it("rejects directories outside the declared home path", () => {
    const homePath = mkdtempSync(join(tmpdir(), "webcli-home-"));
    const outsideRoot = mkdtempSync(join(tmpdir(), "webcli-outside-"));
    tempDirs.push(homePath, outsideRoot);
    const outsidePath = join(outsideRoot, "workspace");
    mkdirSync(outsidePath, { recursive: true });

    expect(() => ensureHomeScopedDirectory(outsidePath, homePath)).toThrow(
      "must stay inside",
    );
  });

  it("accepts missing paths as long as they stay inside the declared home path", () => {
    const homePath = mkdtempSync(join(tmpdir(), "webcli-home-"));
    tempDirs.push(homePath);

    expect(ensureHomeScopedPath("~/missing/project", homePath)).toBe(
      join(homePath, "missing", "project"),
    );
  });

  it("lists home-scoped directory suggestions and flags outside queries", () => {
    const homePath = mkdtempSync(join(tmpdir(), "webcli-home-"));
    tempDirs.push(homePath);
    mkdirSync(join(homePath, "Development"), { recursive: true });
    mkdirSync(join(homePath, "Documents"), { recursive: true });

    const suggestions = listHomePathSuggestions("~/De", homePath);
    expect(suggestions.withinHome).toBe(true);
    expect(suggestions.data.map((entry) => entry.value)).toContain("~/Development");

    const outside = listHomePathSuggestions("/tmp", homePath);
    expect(outside.withinHome).toBe(false);
    expect(outside.data).toHaveLength(0);
  });
});
