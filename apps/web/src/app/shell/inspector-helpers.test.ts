import { describe, expect, it } from "vitest";
import type {
  GitWorkingTreeFile,
  GitWorkingTreeSnapshot,
  TimelineEntry,
  WorkbenchThread,
} from "@webcli/contracts";
import {
  buildGitFileTree,
  buildReviewFindingId,
  collectLatestMcpEntriesByServer,
  filterGitFilesByQuery,
  resolvePreferredSelection,
  selectPreferredMcpServer,
  splitUnifiedDiffByFile,
  summarizeGitSnapshot,
} from "./inspector-helpers";

describe("inspector helpers", () => {
  it("splits a unified diff into file sections", () => {
    const sections = splitUnifiedDiffByFile([
      "diff --git a/src/app.ts b/src/app.ts",
      "--- a/src/app.ts",
      "+++ b/src/app.ts",
      "@@ -1,1 +1,2 @@",
      "-old",
      "+new",
      "+extra",
      "diff --git a/src/main.ts b/src/main.ts",
      "--- a/src/main.ts",
      "+++ b/src/main.ts",
      "@@ -1,1 +1,1 @@",
      "-left",
      "+right",
    ].join("\n"));

    expect(sections.map((section) => section.path)).toEqual(["src/app.ts", "src/main.ts"]);
    expect(sections[0].additions).toBe(2);
    expect(sections[0].deletions).toBe(1);
  });

  it("returns a synthetic full diff section when no git headers exist", () => {
    const sections = splitUnifiedDiffByFile("+hello\n-world");

    expect(sections).toHaveLength(1);
    expect(sections[0].path).toBe("完整差异");
  });

  it("prefers the current selected item when it still exists", () => {
    expect(resolvePreferredSelection(["a", "b", "c"], "b")).toBe("b");
    expect(resolvePreferredSelection(["a", "b", "c"], "x")).toBe("a");
    expect(resolvePreferredSelection([], "x")).toBeNull();
  });

  it("builds a nested git file tree from changed file paths", () => {
    const tree = buildGitFileTree([
      makeGitFile("README.md", 2, 1),
      makeGitFile("src/app.ts", 4, 2),
      makeGitFile("src/components/Button.tsx", 3, 0),
    ]);

    expect(tree).toHaveLength(2);
    expect(tree[0]).toMatchObject({
      kind: "directory",
      name: "src",
      fileCount: 2,
      additions: 7,
      deletions: 2,
    });
    expect(tree[1]).toMatchObject({
      kind: "file",
      path: "README.md",
    });

    const srcNode = tree[0];
    if (srcNode.kind !== "directory") {
      throw new Error("expected directory node");
    }

    expect(srcNode.children[0]).toMatchObject({
      kind: "directory",
      name: "components",
    });
    expect(srcNode.children[1]).toMatchObject({
      kind: "file",
      path: "src/app.ts",
    });
  });

  it("filters git files only by changed path query", () => {
    const files = [
      makeGitFile("README.md", 2, 1),
      makeGitFile("src/app.ts", 4, 2),
      makeGitFile("src/components/Button.tsx", 3, 0),
    ];

    expect(filterGitFilesByQuery(files, "")).toHaveLength(3);
    expect(filterGitFilesByQuery(files, "button").map((file) => file.path)).toEqual([
      "src/components/Button.tsx",
    ]);
  });

  it("summarizes dirty, clean, and not-a-repo git snapshots", () => {
    expect(summarizeGitSnapshot(null)).toMatchObject({
      state: "loading",
      expandable: false,
    });

    expect(
      summarizeGitSnapshot(
        makeGitSnapshot({
          isGitRepository: false,
          clean: true,
          files: [],
        }),
      ),
    ).toMatchObject({
      state: "not-a-repo",
      expandable: false,
    });

    expect(
      summarizeGitSnapshot(
        makeGitSnapshot({
          clean: true,
          files: [],
        }),
      ),
    ).toMatchObject({
      state: "clean",
      expandable: true,
      files: 0,
    });

    expect(
      summarizeGitSnapshot(
        makeGitSnapshot({
          clean: false,
          files: [makeGitFile("src/app.ts", 4, 2)],
        }),
      ),
    ).toMatchObject({
      state: "dirty",
      expandable: true,
      files: 1,
      additions: 4,
      deletions: 2,
    });
  });

  it("builds stable review finding ids", () => {
    expect(
      buildReviewFindingId(
        {
          title: "Issue",
          body: "Body",
          confidence_score: 0.9,
          priority: 1,
          code_location: {
            absolute_file_path: "/tmp/a.ts",
            line_range: { start: 10, end: 12 },
          },
        },
        2,
      ),
    ).toBe("/tmp/a.ts:10:12:Issue:2");
  });

  it("selects latest MCP activity per server and falls back correctly", () => {
    const thread = makeThread([
      makeMcpEntry("entry-1", "turn-1", "github", "older"),
      makeMcpEntry("entry-2", "turn-2", "slack", "latest"),
      makeMcpEntry("entry-3", "turn-2", "github", "newest-github"),
    ]);

    const latest = collectLatestMcpEntriesByServer(thread);
    expect(latest.github?.body).toBe("newest-github");
    expect(latest.slack?.body).toBe("latest");

    expect(selectPreferredMcpServer(["slack", "github"], latest, null)).toBe("slack");
    expect(selectPreferredMcpServer(["slack", "github"], latest, "github")).toBe("github");
    expect(selectPreferredMcpServer(["slack", "github"], latest, "missing")).toBe("slack");
  });
});

function makeThread(items: Array<TimelineEntry>): WorkbenchThread {
  return {
    thread: {
      id: "thread-1",
      name: "Thread",
      preview: "",
      archived: false,
      cwd: "/srv/project",
      createdAt: 1,
      updatedAt: 2,
      status: { type: "idle" },
      modelProvider: "openai",
      source: "appServer",
      agentNickname: null,
      agentRole: null,
      gitInfo: null,
      path: null,
      ephemeral: false,
      workspaceId: "workspace-1",
      workspaceName: "Workspace",
    },
    archived: false,
    turnOrder: ["turn-1", "turn-2"],
    turns: {
      "turn-1": {
        turn: { id: "turn-1", status: "completed", errorMessage: null },
        itemOrder: items.filter((item) => item.turnId === "turn-1").map((item) => item.id),
        items: Object.fromEntries(items.filter((item) => item.turnId === "turn-1").map((item) => [item.id, item])),
      },
      "turn-2": {
        turn: { id: "turn-2", status: "completed", errorMessage: null },
        itemOrder: items.filter((item) => item.turnId === "turn-2").map((item) => item.id),
        items: Object.fromEntries(items.filter((item) => item.turnId === "turn-2").map((item) => [item.id, item])),
      },
    },
    latestDiff: "",
    latestPlan: null,
    review: null,
  };
}

function makeMcpEntry(id: string, turnId: string, server: string, body: string): TimelineEntry {
  return {
    id,
    turnId,
    kind: "mcpToolCall",
    title: `${server} tool`,
    body,
    raw: {
      server,
      tool: "search",
      status: "completed",
    },
  };
}

function makeGitFile(path: string, additions: number, deletions: number): GitWorkingTreeFile {
  return {
    path,
    status: "modified",
    staged: false,
    unstaged: true,
    additions,
    deletions,
    patch: "",
    oldPath: null,
  };
}

function makeGitSnapshot(
  overrides: Partial<GitWorkingTreeSnapshot> = {},
): GitWorkingTreeSnapshot {
  return {
    workspaceId: "workspace-1",
    workspaceName: "Workspace",
    repoRoot: "/srv/project",
    branch: "main",
    clean: false,
    isGitRepository: true,
    stagedCount: 0,
    unstagedCount: 1,
    untrackedCount: 0,
    generatedAt: Date.now(),
    files: [makeGitFile("src/app.ts", 4, 2)],
    ...overrides,
  };
}
