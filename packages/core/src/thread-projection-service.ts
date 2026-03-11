import type {
  LivePlan,
  ReviewOutput,
  ThreadSummary,
  TimelineEntry,
  WorkbenchThread,
  WorkbenchTurn,
  WorkspaceRecord,
} from "@webcli/contracts";
import { WorkspaceCatalogService } from "./workspace-catalog-service.js";
import type { RuntimeThreadRecord, RuntimeTurnRecord } from "./runtime.js";

export class ThreadProjectionService {
  constructor(private readonly workspaceCatalog = new WorkspaceCatalogService()) {}

  toThreadSummary(
    thread: RuntimeThreadRecord,
    workspaces: Array<WorkspaceRecord>,
  ): ThreadSummary {
    const workspace = this.workspaceCatalog.matchWorkspaceForPath(workspaces, thread.cwd);
    return {
      id: thread.id,
      name: thread.name,
      preview: thread.preview,
      archived: thread.archived,
      cwd: thread.cwd,
      createdAt: thread.createdAt,
      updatedAt: thread.updatedAt,
      status: thread.status,
      modelProvider: thread.modelProvider,
      source: thread.source,
      agentNickname: thread.agentNickname,
      agentRole: thread.agentRole,
      gitInfo: thread.gitInfo,
      path: thread.path,
      ephemeral: thread.ephemeral,
      workspaceId: workspace?.id ?? null,
      workspaceName: workspace?.name ?? null,
    };
  }

  toWorkbenchTurn(turn: RuntimeTurnRecord): WorkbenchTurn {
    return {
      turn: {
        id: turn.id,
        status: turn.status,
        errorMessage: turn.errorMessage,
      },
      itemOrder: turn.items.map((item) => item.id),
      items: Object.fromEntries(turn.items.map((item) => [item.id, item])),
    };
  }

  toWorkbenchThread(
    thread: RuntimeThreadRecord,
    workspaces: Array<WorkspaceRecord>,
    existing?: Pick<WorkbenchThread, "latestDiff" | "latestPlan" | "review">,
  ): WorkbenchThread {
    const turns = Object.fromEntries(
      thread.turns.map((turn) => [turn.id, this.toWorkbenchTurn(turn)]),
    ) as Record<string, WorkbenchTurn>;

    return {
      thread: this.toThreadSummary(thread, workspaces),
      archived: thread.archived,
      turnOrder: thread.turns.map((turn) => turn.id),
      turns,
      latestDiff: existing?.latestDiff ?? "",
      latestPlan: existing?.latestPlan ?? null,
      review: existing?.review ?? null,
    };
  }

  appendTimelineDelta(
    threadView: WorkbenchThread,
    item: TimelineEntry,
  ): WorkbenchThread {
    const existingTurn = threadView.turns[item.turnId] ?? {
      turn: {
        id: item.turnId,
        status: "inProgress",
        errorMessage: null,
      },
      itemOrder: [],
      items: {},
    };
    const current = existingTurn.items[item.id];
    const nextItem: TimelineEntry =
      item.kind === "reasoning"
        ? {
            ...item,
            body: current?.body ? `${current.body}\n${item.body}`.trim() : item.body,
          }
        : {
            ...item,
            body: `${current?.body ?? ""}${item.body}`,
          };

    return {
      ...threadView,
      turnOrder: threadView.turnOrder.includes(item.turnId)
        ? threadView.turnOrder
        : [...threadView.turnOrder, item.turnId],
      turns: {
        ...threadView.turns,
        [item.turnId]: {
          ...existingTurn,
          itemOrder: existingTurn.itemOrder.includes(item.id)
            ? existingTurn.itemOrder
            : [...existingTurn.itemOrder, item.id],
          items: {
            ...existingTurn.items,
            [item.id]: nextItem,
          },
        },
      },
    };
  }

  applyTimelineItem(
    threadView: WorkbenchThread,
    item: TimelineEntry,
  ): WorkbenchThread {
    const existingTurn = threadView.turns[item.turnId] ?? {
      turn: {
        id: item.turnId,
        status: "inProgress",
        errorMessage: null,
      },
      itemOrder: [],
      items: {},
    };

    return {
      ...threadView,
      turnOrder: threadView.turnOrder.includes(item.turnId)
        ? threadView.turnOrder
        : [...threadView.turnOrder, item.turnId],
      turns: {
        ...threadView.turns,
        [item.turnId]: {
          ...existingTurn,
          itemOrder: existingTurn.itemOrder.includes(item.id)
            ? existingTurn.itemOrder
            : [...existingTurn.itemOrder, item.id],
          items: {
            ...existingTurn.items,
            [item.id]: item,
          },
        },
      },
    };
  }

  applyTurn(
    threadView: WorkbenchThread,
    turn: RuntimeTurnRecord,
  ): WorkbenchThread {
    return {
      ...threadView,
      turnOrder: threadView.turnOrder.includes(turn.id)
        ? threadView.turnOrder
        : [...threadView.turnOrder, turn.id],
      turns: {
        ...threadView.turns,
        [turn.id]: this.toWorkbenchTurn(turn),
      },
    };
  }

  applyPlan(threadView: WorkbenchThread, plan: LivePlan): WorkbenchThread {
    return {
      ...threadView,
      latestPlan: plan,
    };
  }

  applyDiff(threadView: WorkbenchThread, diff: string): WorkbenchThread {
    return {
      ...threadView,
      latestDiff: diff,
    };
  }

  applyReview(threadView: WorkbenchThread, review: ReviewOutput | null): WorkbenchThread {
    return {
      ...threadView,
      review,
    };
  }
}
