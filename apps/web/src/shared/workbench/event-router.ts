import type { QueryClient } from "@tanstack/react-query";
import type {
  AccountSummary,
  AppServerMessage,
  BootstrapResponse,
  ThreadSummary,
} from "@webcli/contracts";
import { useWorkbenchStore } from "../../store/workbench-store";

type StoreState = ReturnType<typeof useWorkbenchStore.getState>;

export type WorkbenchEventContext = {
  queryClient: QueryClient;
  setConnection: StoreState["setConnection"];
  upsertThread: StoreState["upsertThread"];
  applyTurn: StoreState["applyTurn"];
  applyTimelineItem: StoreState["applyTimelineItem"];
  appendDelta: StoreState["appendDelta"];
  setLatestDiff: StoreState["setLatestDiff"];
  setLatestPlan: StoreState["setLatestPlan"];
  setReview: StoreState["setReview"];
  setWorkspaceGitSnapshot: StoreState["setWorkspaceGitSnapshot"];
  queueApproval: StoreState["queueApproval"];
  resolveApproval: StoreState["resolveApproval"];
  setCommandSession: StoreState["setCommandSession"];
  appendCommandOutput: StoreState["appendCommandOutput"];
  setIntegrationSnapshot: StoreState["setIntegrationSnapshot"];
};

export function routeWorkbenchServerMessage(
  message: AppServerMessage,
  context: WorkbenchEventContext,
): void {
  if (message.type !== "server.notification") {
    return;
  }

  switch (message.method) {
    case "runtime.statusChanged":
      context.setConnection(message.params.runtime);
      return;
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
    case "integrations.updated":
      context.setIntegrationSnapshot(message.params.snapshot);
      return;
  }
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
