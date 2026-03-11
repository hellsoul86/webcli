import { describe, expect, it } from "vitest";
import type { Thread, WorkspaceRecord } from "@webcli/codex-protocol";
import {
  buildWorkspaceCatalog,
  decorateThread,
  matchWorkspaceForPath,
} from "../src/path-utils.js";

function makeWorkspace(
  id: string,
  absPath: string,
  name = id,
): WorkspaceRecord {
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

function makeThread(cwd: string): Thread {
  return {
    id: "thread-1",
    preview: "Preview",
    ephemeral: false,
    modelProvider: "openai",
    createdAt: 1,
    updatedAt: 2,
    status: { type: "idle" },
    path: null,
    cwd,
    cliVersion: "0.111.0",
    source: "appServer",
    agentNickname: null,
    agentRole: null,
    gitInfo: null,
    name: "Test thread",
    turns: [],
  };
}

describe("path utils", () => {
  it("matches the longest workspace prefix", () => {
    const winner = matchWorkspaceForPath(
      [
        makeWorkspace("root", "/srv/repos"),
        makeWorkspace("nested", "/srv/repos/nested"),
      ],
      "/srv/repos/nested/project",
    );

    expect(winner?.id).toBe("nested");
  });

  it("decorates thread with workspace metadata", () => {
    const decorated = decorateThread(
      makeThread("/srv/repos/nested/project"),
      [makeWorkspace("root", "/srv/repos"), makeWorkspace("nested", "/srv/repos/nested")],
      true,
    );

    expect(decorated.workspaceId).toBe("nested");
    expect(decorated.workspaceName).toBe("nested");
    expect(decorated.archived).toBe(true);
  });

  it("builds derived workspaces for home-scoped threads outside saved projects", () => {
    const catalog = buildWorkspaceCatalog(
      [makeWorkspace("saved", "/Users/roy/Development/webcli")],
      [
        makeThread("/Users/roy"),
        makeThread("/Users/roy/OtherProject"),
        makeThread("/Users/roy/Development/webcli/subdir"),
        makeThread("/tmp/outside"),
      ],
      "/Users/roy",
    );

    expect(catalog.map((workspace) => workspace.absPath).sort()).toEqual([
      "/Users/roy",
      "/Users/roy/Development/webcli",
      "/Users/roy/OtherProject",
    ]);
    expect(catalog.filter((workspace) => workspace.source === "derived")).toHaveLength(2);
    expect(catalog.find((workspace) => workspace.absPath === "/Users/roy")?.name).toBe("~");
  });

  it("skips derived workspaces inside ignored paths", () => {
    const catalog = buildWorkspaceCatalog(
      [],
      [makeThread("/Users/roy/Documents"), makeThread("/Users/roy/Documents/nested")],
      "/Users/roy",
      ["/Users/roy/Documents"],
    );

    expect(catalog).toHaveLength(0);
  });
});
