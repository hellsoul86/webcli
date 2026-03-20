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
      markThreadClosed: vi.fn(),
      applyTurn: vi.fn(),
      applyTimelineItem,
      appendDelta,
      appendDeltaBatch: vi.fn(),
      setLatestDiff: vi.fn(),
      setLatestPlan: vi.fn(),
      setReview: vi.fn(),
      setTurnTokenUsage: vi.fn(),
      queueApproval: vi.fn(),
      resolveApproval: vi.fn(),
      setCommandSession: vi.fn(),
      appendCommandOutput: vi.fn(),
      setIntegrations: vi.fn(),
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
      markThreadClosed: vi.fn(),
      applyTurn: vi.fn(),
      applyTimelineItem,
      appendDelta,
      appendDeltaBatch: vi.fn(),
      setLatestDiff: vi.fn(),
      setLatestPlan: vi.fn(),
      setReview: vi.fn(),
      setTurnTokenUsage: vi.fn(),
      queueApproval: vi.fn(),
      resolveApproval: vi.fn(),
      setCommandSession: vi.fn(),
      appendCommandOutput: vi.fn(),
      setIntegrations: vi.fn(),
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
      markThreadClosed: vi.fn(),
      applyTurn: vi.fn(),
      applyTimelineItem: vi.fn(),
      appendDelta: vi.fn(),
      appendDeltaBatch,
      setLatestDiff: vi.fn(),
      setLatestPlan: vi.fn(),
      setReview: vi.fn(),
      setTurnTokenUsage: vi.fn(),
      queueApproval: vi.fn(),
      resolveApproval: vi.fn(),
      setCommandSession: vi.fn(),
      appendCommandOutput: vi.fn(),
      setIntegrations: vi.fn(),
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
        markThreadClosed: vi.fn(),
        applyTurn: vi.fn(),
        applyTimelineItem: vi.fn(),
        appendDelta: vi.fn(),
        appendDeltaBatch: vi.fn(),
        setLatestDiff: vi.fn(),
        setLatestPlan: vi.fn(),
        setReview: vi.fn(),
        setTurnTokenUsage: vi.fn(),
        queueApproval: vi.fn(),
        resolveApproval: vi.fn(),
        setCommandSession: vi.fn(),
        appendCommandOutput: vi.fn(),
        setIntegrations: vi.fn(),
        setIntegrationSnapshot: vi.fn(),
        setWorkspaceGitSnapshot: vi.fn(),
      },
    );

    expect(queryClient.getQueryData<BootstrapResponse>(["bootstrap"])?.runtime.childPid).toBe(22);
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["bootstrap"] });
  });

  it("marks threads as closed when the runtime emits thread.closed", () => {
    const queryClient = new QueryClient();
    const markThreadClosed = vi.fn();

    routeWorkbenchServerMessage(
      {
        type: "server.notification",
        method: "thread.closed",
        params: {
          threadId: "thread-1",
        },
      },
      {
        queryClient,
        setConnection: vi.fn(),
        upsertThread: vi.fn(),
        markThreadClosed,
        applyTurn: vi.fn(),
        applyTimelineItem: vi.fn(),
        appendDelta: vi.fn(),
        appendDeltaBatch: vi.fn(),
        setLatestDiff: vi.fn(),
        setLatestPlan: vi.fn(),
        setReview: vi.fn(),
        setTurnTokenUsage: vi.fn(),
        queueApproval: vi.fn(),
        resolveApproval: vi.fn(),
        setCommandSession: vi.fn(),
        appendCommandOutput: vi.fn(),
        setIntegrations: vi.fn(),
        setIntegrationSnapshot: vi.fn(),
        setWorkspaceGitSnapshot: vi.fn(),
      },
    );

    expect(markThreadClosed).toHaveBeenCalledWith("thread-1");
  });

  it("applies turn token usage updates from runtime notifications", () => {
    const queryClient = new QueryClient();
    const setTurnTokenUsage = vi.fn();

    routeWorkbenchServerMessage(
      {
        type: "server.notification",
        method: "thread.tokenUsageUpdated",
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          tokenUsage: {
            total: {
              totalTokens: 42,
              inputTokens: 20,
              cachedInputTokens: 4,
              outputTokens: 18,
              reasoningOutputTokens: 6,
            },
            last: {
              totalTokens: 10,
              inputTokens: 4,
              cachedInputTokens: 1,
              outputTokens: 5,
              reasoningOutputTokens: 2,
            },
            modelContextWindow: 128000,
          },
        },
      },
      {
        queryClient,
        setConnection: vi.fn(),
        upsertThread: vi.fn(),
        markThreadClosed: vi.fn(),
        applyTurn: vi.fn(),
        applyTimelineItem: vi.fn(),
        appendDelta: vi.fn(),
        appendDeltaBatch: vi.fn(),
        setLatestDiff: vi.fn(),
        setLatestPlan: vi.fn(),
        setReview: vi.fn(),
        setTurnTokenUsage,
        queueApproval: vi.fn(),
        resolveApproval: vi.fn(),
        setCommandSession: vi.fn(),
        appendCommandOutput: vi.fn(),
        setIntegrations: vi.fn(),
        setIntegrationSnapshot: vi.fn(),
        setWorkspaceGitSnapshot: vi.fn(),
      },
    );

    expect(setTurnTokenUsage).toHaveBeenCalledWith("thread-1", "turn-1", {
      total: {
        totalTokens: 42,
        inputTokens: 20,
        cachedInputTokens: 4,
        outputTokens: 18,
        reasoningOutputTokens: 6,
      },
      last: {
        totalTokens: 10,
        inputTokens: 4,
        cachedInputTokens: 1,
        outputTokens: 5,
        reasoningOutputTokens: 2,
      },
      modelContextWindow: 128000,
    });
  });

  it("invalidates integrations when skills change", () => {
    const queryClient = new QueryClient();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");

    routeWorkbenchServerMessage(
      {
        type: "server.notification",
        method: "skills.changed",
        params: {},
      },
      {
        queryClient,
        setConnection: vi.fn(),
        upsertThread: vi.fn(),
        markThreadClosed: vi.fn(),
        applyTurn: vi.fn(),
        applyTimelineItem: vi.fn(),
        appendDelta: vi.fn(),
        appendDeltaBatch: vi.fn(),
        setLatestDiff: vi.fn(),
        setLatestPlan: vi.fn(),
        setReview: vi.fn(),
        setTurnTokenUsage: vi.fn(),
        queueApproval: vi.fn(),
        resolveApproval: vi.fn(),
        setCommandSession: vi.fn(),
        appendCommandOutput: vi.fn(),
        setIntegrations: vi.fn(),
        setIntegrationSnapshot: vi.fn(),
        setWorkspaceGitSnapshot: vi.fn(),
      },
    );

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["integrations"] });
  });

  it("updates app state when the runtime pushes an app list refresh", () => {
    const queryClient = new QueryClient();
    const setIntegrations = vi.fn();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");

    routeWorkbenchServerMessage(
      {
        type: "server.notification",
        method: "app.listUpdated",
        params: {
          apps: [
            {
              id: "github",
              name: "GitHub",
              description: "Connector",
              isAccessible: true,
              isEnabled: true,
              pluginDisplayNames: ["plugins/github"],
              installUrl: "https://example.com/install",
            },
          ],
        },
      },
      {
        queryClient,
        setConnection: vi.fn(),
        upsertThread: vi.fn(),
        markThreadClosed: vi.fn(),
        applyTurn: vi.fn(),
        applyTimelineItem: vi.fn(),
        appendDelta: vi.fn(),
        appendDeltaBatch: vi.fn(),
        setLatestDiff: vi.fn(),
        setLatestPlan: vi.fn(),
        setReview: vi.fn(),
        setTurnTokenUsage: vi.fn(),
        queueApproval: vi.fn(),
        resolveApproval: vi.fn(),
        setCommandSession: vi.fn(),
        appendCommandOutput: vi.fn(),
        setIntegrations,
        setIntegrationSnapshot: vi.fn(),
        setWorkspaceGitSnapshot: vi.fn(),
      },
    );

    expect(setIntegrations).toHaveBeenCalledWith({
      apps: [
        {
          id: "github",
          name: "GitHub",
          description: "Connector",
          isAccessible: true,
          isEnabled: true,
          pluginDisplayNames: ["plugins/github"],
          installUrl: "https://example.com/install",
        },
      ],
    });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["integrations"] });
  });

  it("applies account login completion state and forwards the callback", () => {
    const queryClient = new QueryClient();
    const setIntegrationSnapshot = vi.fn();
    const onAccountLoginCompleted = vi.fn();
    const bootstrap: BootstrapResponse = {
      runtime: {
        connected: true,
        childPid: 11,
        authenticated: false,
        requiresOpenaiAuth: true,
        restartCount: 1,
        lastError: null,
      },
      account: {
        authenticated: false,
        requiresOpenaiAuth: true,
        accountType: "unknown",
        email: null,
        planType: null,
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

    routeWorkbenchServerMessage(
      {
        type: "server.notification",
        method: "account.login.completed",
        params: {
          login: {
            loginId: "login-1",
            success: true,
            error: null,
          },
          state: {
            account: {
              authenticated: true,
              requiresOpenaiAuth: false,
              accountType: "chatgpt",
              email: "user@example.com",
              planType: "pro",
              usageWindows: [],
            },
            authStatus: {
              authMethod: "chatgpt",
              requiresOpenaiAuth: false,
            },
          },
          snapshot: {
            authStatus: {
              authMethod: "chatgpt",
              requiresOpenaiAuth: false,
            },
            config: null,
            mcpServers: [],
            skills: [],
            apps: [],
            plugins: [],
          },
        },
      },
      {
        queryClient,
        setConnection: vi.fn(),
        upsertThread: vi.fn(),
        markThreadClosed: vi.fn(),
        applyTurn: vi.fn(),
        applyTimelineItem: vi.fn(),
        appendDelta: vi.fn(),
        appendDeltaBatch: vi.fn(),
        setLatestDiff: vi.fn(),
        setLatestPlan: vi.fn(),
        setReview: vi.fn(),
        setTurnTokenUsage: vi.fn(),
        queueApproval: vi.fn(),
        resolveApproval: vi.fn(),
        setCommandSession: vi.fn(),
        appendCommandOutput: vi.fn(),
        setIntegrations: vi.fn(),
        setIntegrationSnapshot,
        setWorkspaceGitSnapshot: vi.fn(),
        onAccountLoginCompleted,
      },
    );

    expect(queryClient.getQueryData<BootstrapResponse>(["bootstrap"])?.account.email).toBe(
      "user@example.com",
    );
    expect(setIntegrationSnapshot).toHaveBeenCalledWith({
      authStatus: {
        authMethod: "chatgpt",
        requiresOpenaiAuth: false,
      },
      config: null,
      mcpServers: [],
      skills: [],
      apps: [],
      plugins: [],
    });
    expect(onAccountLoginCompleted).toHaveBeenCalledTimes(1);
  });

  it("stores account rate limits updates in the query cache", () => {
    const queryClient = new QueryClient();

    routeWorkbenchServerMessage(
      {
        type: "server.notification",
        method: "account.rateLimitsUpdated",
        params: {
          rateLimits: {
            rateLimits: {
              primary: {
                windowDurationMins: 300,
                usedPercent: 25,
                remainingPercent: 75,
                resetsAt: 1_700_000_000_000,
              },
              secondary: null,
            },
            rateLimitsByLimitId: {},
          },
        },
      },
      {
        queryClient,
        setConnection: vi.fn(),
        upsertThread: vi.fn(),
        markThreadClosed: vi.fn(),
        applyTurn: vi.fn(),
        applyTimelineItem: vi.fn(),
        appendDelta: vi.fn(),
        appendDeltaBatch: vi.fn(),
        setLatestDiff: vi.fn(),
        setLatestPlan: vi.fn(),
        setReview: vi.fn(),
        setTurnTokenUsage: vi.fn(),
        queueApproval: vi.fn(),
        resolveApproval: vi.fn(),
        setCommandSession: vi.fn(),
        appendCommandOutput: vi.fn(),
        setIntegrations: vi.fn(),
        setIntegrationSnapshot: vi.fn(),
        setWorkspaceGitSnapshot: vi.fn(),
      },
    );

    expect(queryClient.getQueryData(["account-rate-limits"])).toEqual({
      rateLimits: {
        rateLimits: {
          primary: {
            windowDurationMins: 300,
            usedPercent: 25,
            remainingPercent: 75,
            resetsAt: 1_700_000_000_000,
          },
          secondary: null,
        },
        rateLimitsByLimitId: {},
      },
    });
  });

  it("forwards warning and reroute notifications to the provided callbacks", () => {
    const queryClient = new QueryClient();
    const onConfigWarning = vi.fn();
    const onDeprecationNotice = vi.fn();
    const onModelRerouted = vi.fn();
    const context = {
      queryClient,
      setConnection: vi.fn(),
      upsertThread: vi.fn(),
      markThreadClosed: vi.fn(),
      applyTurn: vi.fn(),
      applyTimelineItem: vi.fn(),
      appendDelta: vi.fn(),
      appendDeltaBatch: vi.fn(),
      setLatestDiff: vi.fn(),
      setLatestPlan: vi.fn(),
      setReview: vi.fn(),
      setTurnTokenUsage: vi.fn(),
      queueApproval: vi.fn(),
      resolveApproval: vi.fn(),
      setCommandSession: vi.fn(),
      appendCommandOutput: vi.fn(),
      setIntegrations: vi.fn(),
      setIntegrationSnapshot: vi.fn(),
      setWorkspaceGitSnapshot: vi.fn(),
      onConfigWarning,
      onDeprecationNotice,
      onModelRerouted,
    };

    routeWorkbenchServerMessage(
      {
        type: "server.notification",
        method: "config.warning",
        params: {
          warning: {
            summary: "Managed config blocked a value",
            details: "Project config overrides user config",
            path: "/tmp/config.toml",
            range: null,
          },
        },
      },
      context,
    );
    routeWorkbenchServerMessage(
      {
        type: "server.notification",
        method: "deprecation.notice",
        params: {
          notice: {
            summary: "Legacy key is deprecated",
            details: "Use model_reasoning_effort instead",
          },
        },
      },
      context,
    );
    routeWorkbenchServerMessage(
      {
        type: "server.notification",
        method: "model.rerouted",
        params: {
          reroute: {
            threadId: "thread-1",
            turnId: "turn-1",
            fromModel: "gpt-5",
            toModel: "gpt-5-safe",
            reason: "highRiskCyberActivity",
          },
        },
      },
      context,
    );

    expect(onConfigWarning).toHaveBeenCalledWith({
      summary: "Managed config blocked a value",
      details: "Project config overrides user config",
      path: "/tmp/config.toml",
      range: null,
    });
    expect(onDeprecationNotice).toHaveBeenCalledWith({
      summary: "Legacy key is deprecated",
      details: "Use model_reasoning_effort instead",
    });
    expect(onModelRerouted).toHaveBeenCalledWith({
      threadId: "thread-1",
      turnId: "turn-1",
      fromModel: "gpt-5",
      toModel: "gpt-5-safe",
      reason: "highRiskCyberActivity",
    });
  });
});
