import type { StateStorage } from "zustand/middleware";
import type { PendingApproval, ThreadSummary, WorkbenchTurn } from "@webcli/contracts";
import {
  WORKBENCH_STORAGE_KEY,
  defaultIntegrations,
} from "./workbench-store.defaults";
import type { ThreadView, TimelineEntry } from "./workbench-store.types";

const memoryStorage = new Map<string, string>();

export function resolvePersistStorage(): StateStorage {
  const candidate =
    typeof window !== "undefined" ? (window.localStorage as Storage | undefined) : undefined;

  if (
    candidate &&
    typeof candidate.getItem === "function" &&
    typeof candidate.setItem === "function" &&
    typeof candidate.removeItem === "function"
  ) {
    return candidate;
  }

  return {
    getItem: (name) => memoryStorage.get(name) ?? null,
    setItem: (name, value) => {
      memoryStorage.set(name, value);
    },
    removeItem: (name) => {
      memoryStorage.delete(name);
    },
  };
}

export function resetWorkbenchPersistStorage(): void {
  memoryStorage.clear();

  if (typeof window === "undefined") {
    return;
  }

  const candidate = window.localStorage as Partial<Storage> | undefined;
  if (!candidate) {
    return;
  }

  if (typeof candidate.removeItem === "function") {
    candidate.removeItem(WORKBENCH_STORAGE_KEY);
    return;
  }

  if (typeof candidate.clear === "function") {
    candidate.clear();
  }
}

export function selectTimeline(threadView: ThreadView | null | undefined): Array<TimelineEntry> {
  return selectTimelineWindow(threadView, Number.POSITIVE_INFINITY);
}

export function countTimelineEntries(threadView: ThreadView | null | undefined): number {
  if (!threadView) {
    return 0;
  }

  let total = 0;
  for (const turnId of threadView.turnOrder) {
    const turn = threadView.turns[turnId];
    if (turn) {
      total += turn.itemOrder.length;
    }
  }
  return total;
}

export function selectTimelineWindow(
  threadView: ThreadView | null | undefined,
  limit: number,
): Array<TimelineEntry> {
  if (!threadView || limit <= 0) {
    return [];
  }

  if (!Number.isFinite(limit)) {
    return threadView.turnOrder.flatMap((turnId) => {
      const turn = threadView.turns[turnId];
      return turn ? turn.itemOrder.map((itemId) => turn.items[itemId]).filter(Boolean) : [];
    });
  }

  const remainingItems: Array<TimelineEntry> = [];
  let remaining = Math.floor(limit);

  for (let turnIndex = threadView.turnOrder.length - 1; turnIndex >= 0 && remaining > 0; turnIndex -= 1) {
    const turnId = threadView.turnOrder[turnIndex];
    const turn = threadView.turns[turnId];
    if (!turn) {
      continue;
    }

    for (let itemIndex = turn.itemOrder.length - 1; itemIndex >= 0 && remaining > 0; itemIndex -= 1) {
      const itemId = turn.itemOrder[itemIndex];
      const item = turn.items[itemId];
      if (!item) {
        continue;
      }
      remainingItems.push(item);
      remaining -= 1;
    }
  }

  return remainingItems.reverse();
}

export function cloneThreadView(thread: ThreadView): ThreadView {
  return {
    ...thread,
    turnOrder: [...thread.turnOrder],
    turns: Object.fromEntries(
      Object.entries(thread.turns).map(([turnId, turn]) => [turnId, cloneTurn(turn)]),
    ),
    thread: {
      ...thread.thread,
    },
    latestPlan: thread.latestPlan
      ? {
          turnId: thread.latestPlan.turnId,
          explanation: thread.latestPlan.explanation,
          plan: [...thread.latestPlan.plan],
        }
      : null,
    review: thread.review
      ? {
          ...thread.review,
          findings: [...thread.review.findings],
        }
      : null,
  };
}

export function cloneTurn(turn: WorkbenchTurn): WorkbenchTurn {
  return {
    turn: {
      ...turn.turn,
    },
    itemOrder: [...turn.itemOrder],
    items: { ...turn.items },
  };
}

export function mergeTurn(existing: WorkbenchTurn | undefined, incoming: WorkbenchTurn): WorkbenchTurn {
  if (!existing) {
    return cloneTurn(incoming);
  }

  const itemOrder = dedupeOrderedIds([...incoming.itemOrder, ...existing.itemOrder]);
  const itemIds = new Set([...Object.keys(existing.items), ...Object.keys(incoming.items)]);
  const items = Object.fromEntries(
    [...itemIds].map((itemId) => {
      const previous = existing.items[itemId];
      const next = incoming.items[itemId];
      return [itemId, mergeTimelineEntry(previous, next)];
    }),
  );

  return {
    turn: {
      ...existing.turn,
      ...incoming.turn,
    },
    itemOrder,
    items,
  };
}

export function mergeHydratedThreadSummary(
  existing: ThreadView | undefined,
  thread: ThreadSummary,
): ThreadView {
  if (!existing) {
    return {
      ...createEmptyThreadView(thread.id, thread),
      archived: thread.archived,
      thread,
    };
  }

  return {
    ...existing,
    archived: thread.archived,
    thread: {
      ...existing.thread,
      ...thread,
    },
  };
}

export function upsertThreadSummary(
  existing: ThreadSummary | undefined,
  thread: ThreadSummary,
): ThreadSummary {
  return existing
    ? {
        ...existing,
        ...thread,
      }
    : thread;
}

export function createEmptyThreadView(
  threadId: string,
  summary?: ThreadSummary | null,
): ThreadView {
  return {
    thread: summary ?? createPlaceholderThreadSummary(threadId),
    archived: summary?.archived ?? false,
    turnOrder: [],
    turns: {},
    latestDiff: "",
    latestPlan: null,
    review: null,
  };
}

export function createEmptyTurn(turnId: string): WorkbenchTurn {
  return {
    turn: {
      id: turnId,
      status: "in_progress",
      errorMessage: null,
    },
    itemOrder: [],
    items: {},
  };
}

export function buildPlaceholderItem(
  itemId: string,
  turnId: string,
  kind: TimelineEntry["kind"],
): TimelineEntry {
  return {
    id: itemId,
    turnId,
    kind,
    title: normalizePlaceholderTitle(kind),
    body: "",
    raw: {
      id: itemId,
      type: kind,
    },
  };
}

function mergeTimelineEntry(
  existing: TimelineEntry | undefined,
  incoming: TimelineEntry | undefined,
): TimelineEntry {
  if (!existing && incoming) {
    return incoming;
  }

  if (existing && !incoming) {
    return existing;
  }

  if (!existing || !incoming) {
    throw new Error("Expected at least one timeline entry");
  }

  const existingBody = existing.body ?? "";
  const incomingBody = incoming.body ?? "";
  const body = incomingBody.length >= existingBody.length ? incomingBody : existingBody;

  return {
    ...existing,
    ...incoming,
    body,
    raw:
      typeof existing.raw === "object" && existing.raw !== null &&
      typeof incoming.raw === "object" && incoming.raw !== null
        ? {
            ...existing.raw,
            ...incoming.raw,
          }
        : incoming.raw ?? existing.raw,
  };
}

export function resetFuzzySearchState() {
  return {
    ...defaultIntegrations.fuzzySearch,
    results: [...defaultIntegrations.fuzzySearch.results],
  };
}

export function touchOrderedIds(ids: Array<string>, target: string): Array<string> {
  return [target, ...ids.filter((candidate) => candidate !== target)];
}

export function hasPendingApprovalForThread(
  approvals: Array<PendingApproval>,
  threadId: string,
): boolean {
  return approvals.some((approval) => approval.threadId === threadId);
}

function createPlaceholderThreadSummary(threadId: string): ThreadSummary {
  return {
    id: threadId,
    name: null,
    preview: "",
    archived: false,
    cwd: "",
    createdAt: 0,
    updatedAt: 0,
    status: { type: "notLoaded" },
    modelProvider: "",
    source: "appServer",
    agentNickname: null,
    agentRole: null,
    gitInfo: null,
    path: null,
    ephemeral: false,
    workspaceId: null,
    workspaceName: null,
  };
}

function normalizePlaceholderTitle(kind: TimelineEntry["kind"]): string {
  if (kind === "agentMessage") {
    return "Codex";
  }

  if (kind === "userMessage") {
    return "You";
  }

  if (kind === "commandExecution") {
    return "Command";
  }

  if (kind === "commandExecutionInteraction") {
    return "Terminal Input";
  }

  if (kind === "fileChange") {
    return "File Change";
  }

  if (kind === "rawResponseItem") {
    return "Raw Response";
  }

  if (kind === "mcpToolCall") {
    return "MCP";
  }

  return String(kind);
}

function dedupeOrderedIds(ids: Array<string>): Array<string> {
  const seen = new Set<string>();
  const ordered: Array<string> = [];

  for (const id of ids) {
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    ordered.push(id);
  }

  return ordered;
}
