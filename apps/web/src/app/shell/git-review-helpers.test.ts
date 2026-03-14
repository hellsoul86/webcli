import { describe, expect, it } from "vitest";
import type { GitWorkingTreeFile } from "@webcli/contracts";
import {
  buildGitReviewGroups,
  collectAutoExpandedDirectoryKeys,
  resolvePreferredGitReviewFile,
} from "./git-review-helpers";

function makeFile(
  path: string,
  overrides: Partial<GitWorkingTreeFile> = {},
): GitWorkingTreeFile {
  return {
    path,
    status: "modified",
    staged: false,
    unstaged: true,
    additions: 1,
    deletions: 0,
    patch: `diff --git a/${path} b/${path}`,
    oldPath: null,
    ...overrides,
  };
}

describe("git review helpers", () => {
  it("groups files by review status in the expected order", () => {
    const groups = buildGitReviewGroups(
      [
        makeFile("src/conflict.ts", { status: "conflicted" }),
        makeFile("src/mixed.ts", { staged: true, unstaged: true }),
        makeFile("src/staged.ts", { staged: true, unstaged: false }),
        makeFile("src/unstaged.ts"),
        makeFile("src/new.ts", { status: "untracked", staged: false, unstaged: true }),
      ],
      "",
    );

    expect(groups.map((group) => group.id)).toEqual([
      "conflicted",
      "staged-unstaged",
      "staged",
      "unstaged",
      "untracked",
    ]);
  });

  it("auto-expands root directories and selected file ancestors", () => {
    const groups = buildGitReviewGroups(
      [
        makeFile("apps/web/src/App.tsx", { staged: true, unstaged: true }),
        makeFile("docs/review/notes.md", { status: "conflicted" }),
      ],
      "",
    );

    const expanded = collectAutoExpandedDirectoryKeys(groups, "apps/web/src/App.tsx", "");

    expect(expanded).toContain("staged-unstaged:apps");
    expect(expanded).toContain("staged-unstaged:apps/web");
    expect(expanded).toContain("staged-unstaged:apps/web/src");
    expect(expanded).toContain("conflicted:docs");
  });

  it("falls back to the first visible file when the current selection disappears", () => {
    const groups = buildGitReviewGroups(
      [
        makeFile("README.md"),
        makeFile("src/new.ts", { status: "untracked", staged: false, unstaged: true }),
      ],
      "src/",
    );

    expect(resolvePreferredGitReviewFile(groups, "README.md")).toBe("src/new.ts");
  });
});
