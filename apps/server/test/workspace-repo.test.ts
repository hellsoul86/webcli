import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WorkspaceRepo } from "@webcli/core";

const tempDirs: Array<string> = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("WorkspaceRepo", () => {
  it("creates, updates, lists, and deletes workspaces", () => {
    const dir = mkdtempSync(join(tmpdir(), "webcli-repo-"));
    tempDirs.push(dir);

    const workspaceDir = join(dir, "workspace");
    const repo = new WorkspaceRepo(join(dir, "app.sqlite"));

    const created = repo.create({
      name: "Workspace",
      absPath: workspaceDir,
      approvalPolicy: "on-request",
      sandboxMode: "danger-full-access",
    });

    expect(repo.list()).toHaveLength(1);

    const updated = repo.update(created.id, {
      name: "Renamed",
      defaultModel: "gpt-5-codex",
    });

    expect(updated?.name).toBe("Renamed");
    expect(updated?.defaultModel).toBe("gpt-5-codex");
    expect(repo.delete(created.id)).toBe(true);
    expect(repo.listIgnoredPaths()).toEqual([workspaceDir]);
    repo.unignorePath(workspaceDir);
    expect(repo.listIgnoredPaths()).toEqual([]);
    expect(repo.list()).toHaveLength(0);
    repo.close();
  });
});
