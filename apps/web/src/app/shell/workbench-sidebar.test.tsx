import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ThreadSummary, WorkspaceRecord } from "@webcli/contracts";
import { setAppLocale } from "../../i18n/init";
import type { SidebarWorkspaceGroup } from "./workbench-sidebar";
import { WorkbenchSidebar } from "./workbench-sidebar";

const workspace: WorkspaceRecord = {
  id: "workspace-1",
  name: "repo",
  absPath: "/srv/webcli-staging/repo",
  source: "derived",
  defaultModel: "gpt-5.4",
  approvalPolicy: "never",
  sandboxMode: "danger-full-access",
  createdAt: "2026-03-21T00:00:00.000Z",
  updatedAt: "2026-03-21T00:00:00.000Z",
};

const thread: ThreadSummary = {
  id: "thread-1",
  name: "Inspect repo",
  preview: "Inspect repo",
  archived: false,
  cwd: "/srv/webcli-staging/repo",
  createdAt: Date.now(),
  updatedAt: Date.now(),
  status: { type: "active", activeFlags: ["turn"] },
  modelProvider: "openai",
  source: "codex",
  agentNickname: null,
  agentRole: null,
  gitInfo: null,
  path: null,
  ephemeral: false,
  workspaceId: "workspace-1",
  workspaceName: "repo",
};

function buildWorkspaceGroup(): SidebarWorkspaceGroup {
  return {
    workspace,
    subtitle: null,
    active: true,
    expanded: true,
    threads: [
      {
        thread,
        title: "Inspect repo",
        relativeTime: "刚刚",
        absoluteTime: "2026-03-21 12:00",
        active: true,
        running: true,
        showCompletionMark: false,
        menuOpen: true,
      },
    ],
  };
}

describe("WorkbenchSidebar", () => {
  beforeEach(async () => {
    await setAppLocale("zh-CN");
  });

  it("routes workspace, compose, thread, and thread-menu actions through the sidebar callbacks", () => {
    const onSelectAll = vi.fn();
    const onCreateWorkspace = vi.fn();
    const onSelectWorkspace = vi.fn();
    const onComposeWorkspace = vi.fn();
    const onEditWorkspace = vi.fn();
    const onResumeThread = vi.fn();
    const onToggleThreadMenu = vi.fn();
    const onRenameThread = vi.fn();
    const onForkThread = vi.fn();
    const onArchiveThread = vi.fn();

    render(
      <WorkbenchSidebar
        visibleWorkspaceCount={1}
        workspaceGroups={[buildWorkspaceGroup()]}
        activeWorkspaceId="workspace-1"
        emptyProjects={false}
        emptyThreads={false}
        onSelectAll={onSelectAll}
        onCreateWorkspace={onCreateWorkspace}
        onSelectWorkspace={onSelectWorkspace}
        onComposeWorkspace={onComposeWorkspace}
        onEditWorkspace={onEditWorkspace}
        onResumeThread={onResumeThread}
        onToggleThreadMenu={onToggleThreadMenu}
        onRenameThread={onRenameThread}
        onForkThread={onForkThread}
        onArchiveThread={onArchiveThread}
      />,
    );

    fireEvent.click(screen.getByTestId("workspace-all-button"));
    fireEvent.click(screen.getByTestId("workspace-create-button"));
    fireEvent.click(screen.getByTestId("workspace-row-workspace-1"));
    fireEvent.click(screen.getByTestId("thread-open-button"));
    fireEvent.click(screen.getByTestId("thread-row-thread-1"));
    fireEvent.click(screen.getByTestId("thread-menu-thread-1"));

    expect(onSelectAll).toHaveBeenCalledTimes(1);
    expect(onCreateWorkspace).toHaveBeenCalledTimes(1);
    expect(onSelectWorkspace).toHaveBeenCalledWith("workspace-1");
    expect(onComposeWorkspace).toHaveBeenCalledWith("workspace-1");
    expect(onResumeThread).toHaveBeenCalledWith("thread-1", "workspace-1");
    expect(onToggleThreadMenu).toHaveBeenCalledWith("thread-1");

    fireEvent.click(screen.getByText("重命名"));
    fireEvent.click(screen.getByText("Fork"));
    fireEvent.click(screen.getByText("归档"));

    expect(onRenameThread).toHaveBeenCalledWith(thread);
    expect(onForkThread).toHaveBeenCalledWith(thread);
    expect(onArchiveThread).toHaveBeenCalledWith(thread);
  });
});
