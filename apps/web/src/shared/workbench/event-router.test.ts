import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import type { AppServerMessage } from "@webcli/contracts";
import { routeWorkbenchServerMessage } from "./event-router";

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
});
