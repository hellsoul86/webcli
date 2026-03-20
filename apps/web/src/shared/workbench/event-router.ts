import type { QueryClient } from "@tanstack/react-query";
import type {
  AccountSummary,
  AppServerMessage,
  BootstrapResponse,
  RuntimeStatus,
  ThreadSummary,
  TimelineEntry as WorkbenchTimelineEntry,
} from "@webcli/contracts";
import { useWorkbenchStore } from "../../store/workbench-store";

type StoreState = ReturnType<typeof useWorkbenchStore.getState>;

export type WorkbenchEventContext = {
  queryClient: QueryClient;
  setConnection: StoreState["setConnection"];
  upsertThread: StoreState["upsertThread"];
  markThreadClosed: StoreState["markThreadClosed"];
  applyTurn: StoreState["applyTurn"];
  applyTimelineItem: StoreState["applyTimelineItem"];
  appendDelta: StoreState["appendDelta"];
  appendDeltaBatch: StoreState["appendDeltaBatch"];
  setLatestDiff: StoreState["setLatestDiff"];
  setLatestPlan: StoreState["setLatestPlan"];
  setReview: StoreState["setReview"];
  setTurnTokenUsage: StoreState["setTurnTokenUsage"];
  setWorkspaceGitSnapshot: StoreState["setWorkspaceGitSnapshot"];
  queueApproval: StoreState["queueApproval"];
  resolveApproval: StoreState["resolveApproval"];
  setCommandSession: StoreState["setCommandSession"];
  appendCommandOutput: StoreState["appendCommandOutput"];
  setIntegrations: StoreState["setIntegrations"];
  setIntegrationSnapshot: StoreState["setIntegrationSnapshot"];
  onTimelineDeltaFlush?: (
    entries: Array<{
      threadId: string;
      turnId: string;
      itemId: string;
      kind: WorkbenchTimelineEntry["kind"];
      delta: string;
    }>,
  ) => void;
};

type TimelineDeltaEntry = {
  threadId: string;
  turnId: string;
  itemId: string;
  kind: WorkbenchTimelineEntry["kind"];
  delta: string;
};

export function routeWorkbenchServerMessage(
  message: AppServerMessage,
  context: WorkbenchEventContext,
): void {
  if (message.type !== "server.notification") {
    return;
  }

  switch (message.method) {
    case "runtime.statusChanged": {
      const previousConnection = useWorkbenchStore.getState().connection;
      context.setConnection(message.params.runtime);
      patchBootstrapRuntimeStatus(context.queryClient, message.params.runtime);
      const currentBootstrap = context.queryClient.getQueryData<BootstrapResponse>(["bootstrap"]);
      const shouldRefreshBootstrap =
        message.params.runtime.connected &&
        currentBootstrap !== undefined &&
        (!previousConnection.connected ||
          previousConnection.restartCount !== message.params.runtime.restartCount ||
          currentBootstrap.activeThreads.length === 0);

      if (shouldRefreshBootstrap) {
        void context.queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
      }
      if (shouldRefreshBootstrap) {
        void context.queryClient.invalidateQueries({ queryKey: ["thread-list"] });
      }
      return;
    }
    case "account.updated":
      patchBootstrapAccountSummary(context.queryClient, message.params.account);
      return;
    case "thread.updated":
      patchBootstrapThreadSummary(
        context.queryClient,
        useWorkbenchStore.getState().threadSummaries[message.params.thread.id],
        message.params.thread,
      );
      context.upsertThread(message.params.thread);
      return;
    case "thread.closed":
      context.markThreadClosed(message.params.threadId);
      return;
    case "thread.tokenUsageUpdated":
      context.setTurnTokenUsage(
        message.params.threadId,
        message.params.turnId,
        message.params.tokenUsage,
      );
      return;
    case "turn.updated":
      context.applyTurn(message.params.threadId, message.params.turn);
      return;
    case "timeline.item":
      context.applyTimelineItem(message.params.threadId, message.params.item);
      return;
    case "timeline.delta":
      context.appendDelta(
        message.params.threadId,
        message.params.item.turnId,
        message.params.item.id,
        message.params.item.kind,
        message.params.item.body,
      );
      return;
    case "diff.updated":
      context.setLatestDiff(message.params.threadId, message.params.diff);
      return;
    case "plan.updated":
      context.setLatestPlan(message.params.threadId, message.params.plan);
      return;
    case "review.updated":
      context.setReview(message.params.threadId, message.params.review);
      return;
    case "workspace.git.updated":
      context.setWorkspaceGitSnapshot(message.params.snapshot);
      return;
    case "command.output":
      if (message.params.session) {
        context.setCommandSession(message.params.session);
      } else if (message.params.text) {
        context.appendCommandOutput(
          message.params.processId,
          message.params.stream,
          message.params.text,
        );
      }
      return;
    case "approval.requested":
      context.queueApproval(message.params.approval);
      return;
    case "approval.resolved":
      context.resolveApproval(message.params.requestId);
      return;
    case "serverRequest.requested":
      context.queueApproval(message.params.request);
      return;
    case "serverRequest.resolved":
      context.resolveApproval(message.params.requestId);
      return;
    case "integrations.updated":
      context.setIntegrationSnapshot(message.params.snapshot);
      return;
    case "skills.changed":
      void context.queryClient.invalidateQueries({ queryKey: ["integrations"] });
      return;
    case "app.listUpdated":
      context.setIntegrations({ apps: message.params.apps });
      void context.queryClient.invalidateQueries({ queryKey: ["integrations"] });
      return;
  }
}

export function createWorkbenchMessageDispatcher(context: WorkbenchEventContext): {
  dispatch: (message: AppServerMessage) => void;
  dispose: () => void;
} {
  const pendingDeltas = new Map<string, TimelineDeltaEntry>();
  let frameId: number | ReturnType<typeof setTimeout> | null = null;
  const target = typeof window !== "undefined" ? window : globalThis;

  const cancelFrame =
    typeof target.cancelAnimationFrame === "function"
      ? (id: number | ReturnType<typeof setTimeout>) => target.cancelAnimationFrame(id as number)
      : (id: number | ReturnType<typeof setTimeout>) =>
          target.clearTimeout(id as ReturnType<typeof setTimeout>);
  const requestFrame =
    typeof target.requestAnimationFrame === "function"
      ? (callback: () => void) => target.requestAnimationFrame(callback)
      : (callback: () => void) => target.setTimeout(callback, 16);

  const flush = () => {
    if (pendingDeltas.size === 0) {
      return;
    }

    const batch = [...pendingDeltas.values()];
    pendingDeltas.clear();
    context.appendDeltaBatch(batch);
    context.onTimelineDeltaFlush?.(batch);
  };

  const scheduleFlush = () => {
    if (frameId !== null) {
      return;
    }

    frameId = requestFrame(() => {
      frameId = null;
      flush();
    });
  };

  return {
    dispatch(message) {
      if (message.type === "server.notification" && message.method === "timeline.delta") {
        const entry: TimelineDeltaEntry = {
          threadId: message.params.threadId,
          turnId: message.params.item.turnId,
          itemId: message.params.item.id,
          kind: message.params.item.kind,
          delta: message.params.item.body,
        };
        const key = `${entry.threadId}:${entry.turnId}:${entry.itemId}:${entry.kind}`;
        const existing = pendingDeltas.get(key);
        if (existing) {
          existing.delta = `${existing.delta}${entry.delta}`;
        } else {
          pendingDeltas.set(key, entry);
        }
        scheduleFlush();
        return;
      }

      flush();
      routeWorkbenchServerMessage(message, context);
    },
    dispose() {
      if (frameId !== null) {
        cancelFrame(frameId);
        frameId = null;
      }
      flush();
    },
  };
}

function patchBootstrapAccountSummary(
  queryClient: QueryClient,
  account: AccountSummary,
): void {
  queryClient.setQueryData<BootstrapResponse | undefined>(["bootstrap"], (current) =>
    current
      ? {
          ...current,
          account,
        }
      : current,
  );
}

function patchBootstrapRuntimeStatus(
  queryClient: QueryClient,
  runtime: RuntimeStatus,
): void {
  queryClient.setQueryData<BootstrapResponse | undefined>(["bootstrap"], (current) =>
    current
      ? {
          ...current,
          runtime,
        }
      : current,
  );
}

function patchBootstrapThreadSummary(
  queryClient: QueryClient,
  previousThread: ThreadSummary | undefined,
  nextThread: ThreadSummary,
): void {
  queryClient.setQueryData<BootstrapResponse | undefined>(["bootstrap"], (current) => {
    if (!current) {
      return current;
    }

    const nextActiveThreads = current.activeThreads.filter((thread) => thread.id !== nextThread.id);
    let archivedThreadCount = current.archivedThreadCount;

    if (previousThread?.archived && !nextThread.archived) {
      archivedThreadCount = Math.max(0, archivedThreadCount - 1);
    } else if (!previousThread?.archived && nextThread.archived) {
      archivedThreadCount += 1;
    } else if (!previousThread && nextThread.archived) {
      archivedThreadCount += 1;
    }

    if (!nextThread.archived) {
      nextActiveThreads.push(nextThread);
      nextActiveThreads.sort(sortThreadSummaries);
    }

    return {
      ...current,
      activeThreads: nextActiveThreads,
      archivedThreadCount,
    };
  });
}

function sortThreadSummaries(left: ThreadSummary, right: ThreadSummary): number {
  return (
    right.updatedAt - left.updatedAt ||
    right.createdAt - left.createdAt ||
    left.id.localeCompare(right.id)
  );
}
