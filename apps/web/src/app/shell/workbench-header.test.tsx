import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountUsageWindow, ThreadSummary } from "@webcli/contracts";
import { setAppLocale } from "../../i18n/init";
import { WorkbenchHeader } from "./workbench-header";

const activeThread: ThreadSummary = {
  id: "thread-1",
  name: "Inspect repo",
  preview: "Inspect repo",
  archived: false,
  cwd: "/srv/webcli-staging/repo",
  createdAt: Date.now(),
  updatedAt: Date.now(),
  status: { type: "idle" },
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

const usageWindows: Array<AccountUsageWindow> = [
  {
    label: "5h",
    remainingPercent: 82,
    usedPercent: 18,
    resetsAt: null,
  },
];

describe("WorkbenchHeader", () => {
  beforeEach(async () => {
    await setAppLocale("zh-CN");
  });

  it("shows the thread title and routes edit and settings actions through callbacks", () => {
    const onStartThreadTitleEdit = vi.fn();
    const onOpenSettings = vi.fn();

    render(
      <WorkbenchHeader
        headerWorkspaceLabel="repo"
        threadTitle="Inspect repo"
        activeThreadEntry={activeThread}
        threadTitleEditing={false}
        threadTitleDraft="Inspect repo"
        toolbarUsageWindows={usageWindows}
        composerSpeedMode="standard"
        locale="zh-CN"
        toolbarLocaleOptions={[
          { value: "zh-CN", label: "中文", testIdSuffix: "zh-cn" },
          { value: "en-US", label: "English", testIdSuffix: "en-us" },
        ]}
        onThreadTitleDraftChange={() => {}}
        onCommitThreadTitle={() => {}}
        onCancelThreadTitle={() => {}}
        onStartThreadTitleEdit={onStartThreadTitleEdit}
        onToggleSpeed={() => {}}
        onLocaleChange={() => {}}
        onOpenSettings={onOpenSettings}
      />,
    );

    expect(screen.getByTestId("thread-title-display")).toHaveTextContent("Inspect repo");

    fireEvent.click(screen.getByTestId("thread-title-edit-button"));
    fireEvent.click(screen.getByTestId("settings-button"));

    expect(onStartThreadTitleEdit).toHaveBeenCalledTimes(1);
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it("commits and cancels title edits from the inline editor", () => {
    const onThreadTitleDraftChange = vi.fn();
    const onCommitThreadTitle = vi.fn();
    const onCancelThreadTitle = vi.fn();

    render(
      <WorkbenchHeader
        headerWorkspaceLabel="repo"
        threadTitle="Inspect repo"
        activeThreadEntry={activeThread}
        threadTitleEditing
        threadTitleDraft="Inspect repo"
        toolbarUsageWindows={usageWindows}
        composerSpeedMode="standard"
        locale="zh-CN"
        toolbarLocaleOptions={[
          { value: "zh-CN", label: "中文", testIdSuffix: "zh-cn" },
          { value: "en-US", label: "English", testIdSuffix: "en-us" },
        ]}
        onThreadTitleDraftChange={onThreadTitleDraftChange}
        onCommitThreadTitle={onCommitThreadTitle}
        onCancelThreadTitle={onCancelThreadTitle}
        onStartThreadTitleEdit={() => {}}
        onToggleSpeed={() => {}}
        onLocaleChange={() => {}}
        onOpenSettings={() => {}}
      />,
    );

    const input = screen.getByTestId("thread-title-input");
    fireEvent.change(input, { target: { value: "New title" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.keyDown(input, { key: "Escape" });

    expect(onThreadTitleDraftChange).toHaveBeenCalledWith("New title");
    expect(onCommitThreadTitle).toHaveBeenCalledTimes(1);
    expect(onCancelThreadTitle).toHaveBeenCalledTimes(1);
  });
});
