import type { QueryClient } from "@tanstack/react-query";
import type { AppServerMessage } from "@webcli/contracts";
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
    case "thread.updated":
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
