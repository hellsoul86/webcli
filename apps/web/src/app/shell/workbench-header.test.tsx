import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AccountUsageWindow,
  ConversationSummarySnapshot,
  ThreadSummary,
} from "@webcli/contracts";
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

const conversationSummary: ConversationSummarySnapshot = {
  conversationId: "thread-1",
  path: "/srv/webcli-staging/repo/.codex/threads/thread-1.json",
  preview: "Inspect repo health and explain pending changes",
  timestamp: "2026-03-21T01:00:00.000Z",
  updatedAt: "2026-03-21T01:05:00.000Z",
  modelProvider: "openai",
  cwd: "/srv/webcli-staging/repo",
  cliVersion: "0.114.0",
  source: "cli",
  gitInfo: {
    sha: "abc1234",
    branch: "main",
    originUrl: "https://github.com/hellsoul86/webcli.git",
  },
};

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
        conversationSummary={null}
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
        onOpenTerminal={() => {}}
        onRunReview={() => {}}
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
        conversationSummary={null}
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
        onOpenTerminal={() => {}}
        onRunReview={() => {}}
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

  it("shows the active conversation summary under the thread title", () => {
    render(
      <WorkbenchHeader
        headerWorkspaceLabel="repo"
        threadTitle="Inspect repo"
        activeThreadEntry={activeThread}
        conversationSummary={conversationSummary}
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
        onStartThreadTitleEdit={() => {}}
        onToggleSpeed={() => {}}
        onLocaleChange={() => {}}
        onOpenTerminal={() => {}}
        onRunReview={() => {}}
        onOpenSettings={() => {}}
      />,
    );

    expect(screen.getByTestId("thread-summary-display")).toHaveTextContent(
      "Inspect repo health and explain pending changes · main",
    );
  });
});
