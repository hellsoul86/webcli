import { describe, expect, it } from "vitest";
import type { WorkspaceRecord } from "@webcli/contracts";
import {
  ThreadProjectionService,
  WorkspaceCatalogService,
  type RuntimeThreadRecord,
} from "@webcli/core";

function makeWorkspace(id: string, absPath: string, name = id): WorkspaceRecord {
  const now = new Date().toISOString();
  return {
    id,
    name,
    absPath,
    source: "saved",
    defaultModel: null,
    approvalPolicy: "on-request",
    sandboxMode: "danger-full-access",
    createdAt: now,
    updatedAt: now,
  };
}

function makeThread(cwd: string, archived = false): RuntimeThreadRecord {
  return {
    id: `thread:${cwd}`,
    name: "Test thread",
    preview: "Preview",
    archived,
    cwd,
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
    turns: [],
  };
}

describe("workspace projection helpers", () => {
  it("matches the longest workspace prefix", () => {
    const catalog = new WorkspaceCatalogService();
    const winner = catalog.matchWorkspaceForPath(
      [
        makeWorkspace("root", "/srv/repos"),
        makeWorkspace("nested", "/srv/repos/nested"),
      ],
      "/srv/repos/nested/project",
    );

    expect(winner?.id).toBe("nested");
  });

  it("decorates thread summaries with workspace metadata", () => {
    const projection = new ThreadProjectionService();
    const summary = projection.toThreadSummary(
      makeThread("/srv/repos/nested/project", true),
      [
        makeWorkspace("root", "/srv/repos"),
        makeWorkspace("nested", "/srv/repos/nested"),
      ],
    );

    expect(summary.workspaceId).toBe("nested");
    expect(summary.workspaceName).toBe("nested");
    expect(summary.archived).toBe(true);
  });

  it("builds derived workspaces for home-scoped and outside-home threads outside saved projects", () => {
    const catalog = new WorkspaceCatalogService().buildWorkspaceCatalog(
      [makeWorkspace("saved", "/Users/roy/Development/webcli")],
      [
        makeThread("/Users/roy"),
        makeThread("/Users/roy/OtherProject"),
        makeThread("/Users/roy/Development/webcli/subdir"),
        makeThread("/srv/staging/repo"),
      ],
      "/Users/roy",
    );

    expect(catalog.map((workspace) => workspace.absPath).sort()).toEqual([
      "/Users/roy",
      "/Users/roy/Development/webcli",
      "/Users/roy/OtherProject",
      "/srv/staging/repo",
    ]);
    expect(catalog.filter((workspace) => workspace.source === "derived")).toHaveLength(3);
    expect(catalog.find((workspace) => workspace.absPath === "/Users/roy")?.name).toBe("~");
    expect(catalog.find((workspace) => workspace.absPath === "/srv/staging/repo")?.name).toBe(
      "repo",
    );
  });

  it("still infers nested projects when home root itself is saved", () => {
    const catalog = new WorkspaceCatalogService().buildWorkspaceCatalog(
      [makeWorkspace("home", "/Users/roy", "根目录")],
      [makeThread("/Users/roy/Development/cl_grid")],
      "/Users/roy",
    );

    expect(catalog.map((workspace) => workspace.absPath).sort()).toEqual([
      "/Users/roy",
      "/Users/roy/Development/cl_grid",
    ]);
    expect(
      catalog.find((workspace) => workspace.absPath === "/Users/roy/Development/cl_grid"),
    ).toMatchObject({
      source: "derived",
      name: "cl_grid",
    });
  });

  it("skips derived workspaces inside ignored paths", () => {
    const catalog = new WorkspaceCatalogService().buildWorkspaceCatalog(
      [],
      [
        makeThread("/Users/roy/Documents"),
        makeThread("/Users/roy/Documents/nested"),
        makeThread("/srv/staging/repo"),
        makeThread("/srv/staging/repo/apps/web"),
      ],
      "/Users/roy",
      ["/Users/roy/Documents", "/srv/staging/repo"],
    );

    expect(catalog).toHaveLength(0);
  });
});
