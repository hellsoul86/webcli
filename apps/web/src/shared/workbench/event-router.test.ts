import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppServerMessage, BootstrapResponse } from "@webcli/contracts";
import { resetWorkbenchPersistStorage, useWorkbenchStore } from "../../store/workbench-store";
import {
  createWorkbenchMessageDispatcher,
  routeWorkbenchServerMessage,
} from "./event-router";

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal(
    "requestAnimationFrame",
    ((callback: FrameRequestCallback) => window.setTimeout(() => callback(16), 16)) as typeof requestAnimationFrame,
  );
  vi.stubGlobal(
    "cancelAnimationFrame",
    ((id: number) => window.clearTimeout(id)) as typeof cancelAnimationFrame,
  );
});

afterEach(() => {
  useWorkbenchStore.setState({
    connection: {
      connected: false,
      childPid: null,
      authenticated: false,
      requiresOpenaiAuth: true,
      restartCount: 0,
      lastError: null,
    },
    activeWorkspaceId: "all",
    activeThreadId: null,
    inspectorTab: "diff",
    threadLifecycle: {
      archivedMode: "active",
    },
    threadSummaries: {},
    hydratedThreads: {},
    hydratedOrder: [],
    gitSnapshotsByWorkspaceId: {},
    selectedGitFileByWorkspaceId: {},
    pendingApprovals: [],
    commandSessions: {},
    commandOrder: [],
    integrations: {
      settingsOpen: false,
      settingsTab: "general",
      authStatus: null,
      config: null,
      mcpServers: [],
      skills: [],
      apps: [],
      plugins: [],
      fuzzySearch: {
        sessionId: null,
        query: "",
        status: "idle",
        results: [],
      },
    },
  });
  resetWorkbenchPersistStorage();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("routeWorkbenchServerMessage", () => {
  it("applies full timeline items without treating them as deltas", () => {
    const queryClient = new QueryClient();
    const applyTimelineItem = vi.fn();
    const appendDelta = vi.fn();

    const message: AppServerMessage = {
      type: "server.notification",
      method: "timeline.item",
      params: {
        threadId: "thread-1",
        item: {
          id: "item-1",
          turnId: "turn-1",
          kind: "fileChange",
          title: "File Change",
          body: "update: README.md",
          raw: { type: "fileChange" },
        },
      },
    };

    routeWorkbenchServerMessage(message, {
      queryClient,
      setConnection: vi.fn(),
      upsertThread: vi.fn(),
      applyTurn: vi.fn(),
      applyTimelineItem,
      appendDelta,
      appendDeltaBatch: vi.fn(),
      setLatestDiff: vi.fn(),
      setLatestPlan: vi.fn(),
      setReview: vi.fn(),
      queueApproval: vi.fn(),
      resolveApproval: vi.fn(),
      setCommandSession: vi.fn(),
      appendCommandOutput: vi.fn(),
      setIntegrationSnapshot: vi.fn(),
      setWorkspaceGitSnapshot: vi.fn(),
    });

    expect(applyTimelineItem).toHaveBeenCalledWith("thread-1", {
      id: "item-1",
      turnId: "turn-1",
      kind: "fileChange",
      title: "File Change",
      body: "update: README.md",
      raw: { type: "fileChange" },
    });
    expect(appendDelta).not.toHaveBeenCalled();
  });

  it("appends timeline deltas instead of replacing the whole item", () => {
    const queryClient = new QueryClient();
    const applyTimelineItem = vi.fn();
    const appendDelta = vi.fn();

    const message: AppServerMessage = {
      type: "server.notification",
      method: "timeline.delta",
      params: {
        threadId: "thread-1",
        item: {
          id: "item-1",
          turnId: "turn-1",
          kind: "agentMessage",
          title: "Codex",
          body: "Part A",
          raw: { type: "agentMessage" },
        },
      },
    };

    routeWorkbenchServerMessage(message, {
      queryClient,
      setConnection: vi.fn(),
      upsertThread: vi.fn(),
      applyTurn: vi.fn(),
      applyTimelineItem,
      appendDelta,
      appendDeltaBatch: vi.fn(),
      setLatestDiff: vi.fn(),
      setLatestPlan: vi.fn(),
      setReview: vi.fn(),
      queueApproval: vi.fn(),
      resolveApproval: vi.fn(),
      setCommandSession: vi.fn(),
      appendCommandOutput: vi.fn(),
      setIntegrationSnapshot: vi.fn(),
      setWorkspaceGitSnapshot: vi.fn(),
    });

    expect(appendDelta).toHaveBeenCalledWith(
      "thread-1",
      "turn-1",
      "item-1",
      "agentMessage",
      "Part A",
    );
    expect(applyTimelineItem).not.toHaveBeenCalled();
  });

  it("batches timeline deltas once per animation frame", () => {
    const queryClient = new QueryClient();
    const appendDeltaBatch = vi.fn();
    const dispatcher = createWorkbenchMessageDispatcher({
      queryClient,
      setConnection: vi.fn(),
      upsertThread: vi.fn(),
      applyTurn: vi.fn(),
      applyTimelineItem: vi.fn(),
      appendDelta: vi.fn(),
      appendDeltaBatch,
      setLatestDiff: vi.fn(),
      setLatestPlan: vi.fn(),
      setReview: vi.fn(),
      queueApproval: vi.fn(),
      resolveApproval: vi.fn(),
      setCommandSession: vi.fn(),
      appendCommandOutput: vi.fn(),
      setIntegrationSnapshot: vi.fn(),
      setWorkspaceGitSnapshot: vi.fn(),
      onTimelineDeltaFlush: vi.fn(),
    });

    dispatcher.dispatch({
      type: "server.notification",
      method: "timeline.delta",
      params: {
        threadId: "thread-1",
        item: {
          id: "item-1",
          turnId: "turn-1",
          kind: "agentMessage",
          title: "Codex",
          body: "Part A",
          raw: { type: "agentMessage" },
        },
      },
    });
    dispatcher.dispatch({
      type: "server.notification",
      method: "timeline.delta",
      params: {
        threadId: "thread-1",
        item: {
          id: "item-1",
          turnId: "turn-1",
          kind: "agentMessage",
          title: "Codex",
          body: " + Part B",
          raw: { type: "agentMessage" },
        },
      },
    });

    expect(appendDeltaBatch).not.toHaveBeenCalled();

    vi.runAllTimers();

    expect(appendDeltaBatch).toHaveBeenCalledTimes(1);
    expect(appendDeltaBatch).toHaveBeenCalledWith([
      {
        threadId: "thread-1",
        turnId: "turn-1",
        itemId: "item-1",
        kind: "agentMessage",
        delta: "Part A + Part B",
      },
    ]);

    dispatcher.dispose();
  });

  it("refreshes bootstrap when runtime reconnects into an empty cached thread list", () => {
    const queryClient = new QueryClient();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
    const bootstrap: BootstrapResponse = {
      runtime: {
        connected: true,
        childPid: 11,
        authenticated: true,
        requiresOpenaiAuth: false,
        restartCount: 1,
        lastError: null,
      },
      account: {
        authenticated: true,
        requiresOpenaiAuth: false,
        accountType: "chatgpt",
        email: "user@example.com",
        planType: "pro",
        usageWindows: [],
      },
      models: [],
      workspaces: [],
      activeThreads: [],
      archivedThreadCount: 0,
      settings: {
        config: null,
      },
    };
    queryClient.setQueryData(["bootstrap"], bootstrap);
    useWorkbenchStore.setState({
      connection: {
        connected: true,
        childPid: 11,
        authenticated: true,
        requiresOpenaiAuth: false,
        restartCount: 1,
        lastError: null,
      },
    });

    routeWorkbenchServerMessage(
      {
        type: "server.notification",
        method: "runtime.statusChanged",
        params: {
          runtime: {
            connected: true,
            childPid: 22,
            authenticated: true,
            requiresOpenaiAuth: false,
            restartCount: 1,
            lastError: null,
          },
        },
      },
      {
        queryClient,
        setConnection: vi.fn(),
        upsertThread: vi.fn(),
        applyTurn: vi.fn(),
        applyTimelineItem: vi.fn(),
        appendDelta: vi.fn(),
        appendDeltaBatch: vi.fn(),
        setLatestDiff: vi.fn(),
        setLatestPlan: vi.fn(),
        setReview: vi.fn(),
        queueApproval: vi.fn(),
        resolveApproval: vi.fn(),
        setCommandSession: vi.fn(),
        appendCommandOutput: vi.fn(),
        setIntegrationSnapshot: vi.fn(),
        setWorkspaceGitSnapshot: vi.fn(),
      },
    );

    expect(queryClient.getQueryData<BootstrapResponse>(["bootstrap"])?.runtime.childPid).toBe(22);
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["bootstrap"] });
  });
});
