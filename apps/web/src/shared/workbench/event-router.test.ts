import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppServerMessage } from "@webcli/contracts";
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
});
