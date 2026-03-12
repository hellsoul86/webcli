import type { StateCreator } from "zustand";
import {
  buildPlaceholderItem,
  cloneThreadView,
  cloneTurn,
  createEmptyThreadView,
  createEmptyTurn,
  hasPendingApprovalForThread,
  mergeHydratedThreadSummary,
  mergeTurn,
  touchOrderedIds,
  upsertThreadSummary,
} from "./workbench-store.helpers";
import type { SessionSlice, TimelineEntry, WorkbenchState } from "./workbench-store.types";

const MAX_HYDRATED_THREADS = 2;

export const createSessionSlice: StateCreator<WorkbenchState, [], [], SessionSlice> = (set) => ({
  threadSummaries: {},
  hydratedThreads: {},
  hydratedOrder: [],
  gitSnapshotsByWorkspaceId: {},
  selectedGitFileByWorkspaceId: {},
  pendingApprovals: [],
  syncBootstrapActiveThreads: (threads) =>
    set((state) => {
      const activeIds = new Set(threads.map((thread) => thread.id));
      const nextSummaries = { ...state.threadSummaries };

      for (const thread of threads) {
        nextSummaries[thread.id] = upsertThreadSummary(nextSummaries[thread.id], thread);
      }

      for (const [threadId, thread] of Object.entries(nextSummaries)) {
        if (!thread.archived && !activeIds.has(threadId)) {
          nextSummaries[threadId] = {
            ...thread,
            archived: true,
          };
        }
      }

      const nextHydratedThreads = { ...state.hydratedThreads };
      for (const thread of threads) {
        if (!nextHydratedThreads[thread.id]) {
          continue;
        }
        nextHydratedThreads[thread.id] = mergeHydratedThreadSummary(nextHydratedThreads[thread.id], thread);
      }

      return {
        threadSummaries: nextSummaries,
        hydratedThreads: nextHydratedThreads,
      };
    }),
  hydrateThread: (thread) =>
    set((state) => ({
      threadSummaries: {
        ...state.threadSummaries,
        [thread.thread.id]: upsertThreadSummary(state.threadSummaries[thread.thread.id], thread.thread),
      },
      hydratedThreads: {
        ...state.hydratedThreads,
        [thread.thread.id]: cloneThreadView(thread),
      },
      hydratedOrder: touchOrderedIds(state.hydratedOrder, thread.thread.id),
    })),
  upsertThread: (thread) =>
    set((state) => ({
      threadSummaries: {
        ...state.threadSummaries,
        [thread.id]: upsertThreadSummary(state.threadSummaries[thread.id], thread),
      },
      hydratedThreads: state.hydratedThreads[thread.id]
        ? {
            ...state.hydratedThreads,
            [thread.id]: mergeHydratedThreadSummary(state.hydratedThreads[thread.id], thread),
          }
        : state.hydratedThreads,
    })),
  setWorkspaceGitSnapshot: (snapshot) =>
    set((state) => ({
      gitSnapshotsByWorkspaceId: {
        ...state.gitSnapshotsByWorkspaceId,
        [snapshot.workspaceId]: {
          ...snapshot,
          files: snapshot.files.map((file) => ({ ...file })),
        },
      },
      selectedGitFileByWorkspaceId: {
        ...state.selectedGitFileByWorkspaceId,
        [snapshot.workspaceId]:
          snapshot.files.some(
            (file) => file.path === state.selectedGitFileByWorkspaceId[snapshot.workspaceId],
          )
            ? state.selectedGitFileByWorkspaceId[snapshot.workspaceId] ?? null
            : snapshot.files[0]?.path ?? null,
      },
    })),
  selectWorkspaceGitFile: (workspaceId, path) =>
    set((state) => ({
      selectedGitFileByWorkspaceId: {
        ...state.selectedGitFileByWorkspaceId,
        [workspaceId]: path,
      },
    })),
  renameThread: (threadId, threadName) =>
    set((state) => {
      const summary = state.threadSummaries[threadId];
      const hydrated = state.hydratedThreads[threadId];
      if (!summary && !hydrated) {
        return state;
      }

      return {
        threadSummaries: summary
          ? {
              ...state.threadSummaries,
              [threadId]: {
                ...summary,
                name: threadName ?? null,
              },
            }
          : state.threadSummaries,
        hydratedThreads: hydrated
          ? {
              ...state.hydratedThreads,
              [threadId]: {
                ...hydrated,
                thread: {
                  ...hydrated.thread,
                  name: threadName ?? null,
                },
              },
            }
          : state.hydratedThreads,
      };
    }),
  markThreadArchived: (threadId, archived) =>
    set((state) => {
      const summary = state.threadSummaries[threadId];
      const hydrated = state.hydratedThreads[threadId];
      if (!summary && !hydrated) {
        return state;
      }

      return {
        threadSummaries: summary
          ? {
              ...state.threadSummaries,
              [threadId]: {
                ...summary,
                archived,
              },
            }
          : state.threadSummaries,
        hydratedThreads: hydrated
          ? {
              ...state.hydratedThreads,
              [threadId]: {
                ...hydrated,
                archived,
                thread: {
                  ...hydrated.thread,
                  archived,
                },
              },
            }
          : state.hydratedThreads,
      };
    }),
  applyTurn: (threadId, turn) =>
    set((state) => {
      const summary = state.threadSummaries[threadId];
      const threadView = state.hydratedThreads[threadId] ?? createEmptyThreadView(threadId, summary);
      const existingTurn = threadView.turns[turn.turn.id];

      return {
        hydratedThreads: {
          ...state.hydratedThreads,
          [threadId]: {
            ...threadView,
            turnOrder: threadView.turnOrder.includes(turn.turn.id)
              ? threadView.turnOrder
              : [...threadView.turnOrder, turn.turn.id],
            turns: {
              ...threadView.turns,
              [turn.turn.id]: existingTurn ? mergeTurn(existingTurn, turn) : cloneTurn(turn),
            },
          },
        },
        hydratedOrder: touchOrderedIds(state.hydratedOrder, threadId),
      };
    }),
  applyTimelineItem: (threadId, item) =>
    set((state) => {
      const summary = state.threadSummaries[threadId];
      const threadView = state.hydratedThreads[threadId] ?? createEmptyThreadView(threadId, summary);
      const turn = threadView.turns[item.turnId] ?? createEmptyTurn(item.turnId);

      return {
        hydratedThreads: {
          ...state.hydratedThreads,
          [threadId]: {
            ...threadView,
            turnOrder: threadView.turnOrder.includes(item.turnId)
              ? threadView.turnOrder
              : [...threadView.turnOrder, item.turnId],
            turns: {
              ...threadView.turns,
              [item.turnId]: {
                ...turn,
                itemOrder: turn.itemOrder.includes(item.id)
                  ? turn.itemOrder
                  : [...turn.itemOrder, item.id],
                items: {
                  ...turn.items,
                  [item.id]: item,
                },
              },
            },
          },
        },
        hydratedOrder: touchOrderedIds(state.hydratedOrder, threadId),
      };
    }),
  appendDelta: (threadId, turnId, itemId, kind, delta) =>
    set((state) => {
      const summary = state.threadSummaries[threadId];
      const threadView = state.hydratedThreads[threadId] ?? createEmptyThreadView(threadId, summary);
      const turn = threadView.turns[turnId] ?? createEmptyTurn(turnId);
      const current = turn.items[itemId] ?? buildPlaceholderItem(itemId, turnId, kind);
      const nextItem: TimelineEntry =
        kind === "reasoning"
          ? {
              ...current,
              body: current.body ? `${current.body}\n${delta}`.trim() : delta,
            }
          : {
              ...current,
              body: `${current.body}${delta}`,
            };

      return {
        hydratedThreads: {
          ...state.hydratedThreads,
          [threadId]: {
            ...threadView,
            turnOrder: threadView.turnOrder.includes(turnId)
              ? threadView.turnOrder
              : [...threadView.turnOrder, turnId],
            turns: {
              ...threadView.turns,
              [turnId]: {
                ...turn,
                itemOrder: turn.itemOrder.includes(itemId)
                  ? turn.itemOrder
                  : [...turn.itemOrder, itemId],
                items: {
                  ...turn.items,
                  [itemId]: nextItem,
                },
              },
            },
          },
        },
        hydratedOrder: touchOrderedIds(state.hydratedOrder, threadId),
      };
    }),
  setLatestDiff: (threadId, diff) =>
    set((state) => {
      const threadView = state.hydratedThreads[threadId];
      if (!threadView) {
        return state;
      }

      return {
        hydratedThreads: {
          ...state.hydratedThreads,
          [threadId]: {
            ...threadView,
            latestDiff: diff,
          },
        },
        hydratedOrder: touchOrderedIds(state.hydratedOrder, threadId),
      };
    }),
  setLatestPlan: (threadId, payload) =>
    set((state) => {
      const threadView = state.hydratedThreads[threadId];
      if (!threadView) {
        return state;
      }

      return {
        hydratedThreads: {
          ...state.hydratedThreads,
          [threadId]: {
            ...threadView,
            latestPlan: payload,
          },
        },
        hydratedOrder: touchOrderedIds(state.hydratedOrder, threadId),
      };
    }),
  setReview: (threadId, review) =>
    set((state) => {
      const threadView = state.hydratedThreads[threadId];
      if (!threadView) {
        return state;
      }

      return {
        hydratedThreads: {
          ...state.hydratedThreads,
          [threadId]: {
            ...threadView,
            review,
          },
        },
        hydratedOrder: touchOrderedIds(state.hydratedOrder, threadId),
      };
    }),
  queueApproval: (approval) =>
    set((state) => ({
      pendingApprovals: state.pendingApprovals.some((candidate) => candidate.id === approval.id)
        ? state.pendingApprovals
        : [...state.pendingApprovals, approval],
    })),
  resolveApproval: (id) =>
    set((state) => ({
      pendingApprovals: state.pendingApprovals.filter((approval) => approval.id !== id),
    })),
  touchHydratedThread: (threadId) =>
    set((state) => ({
      hydratedOrder: threadId ? touchOrderedIds(state.hydratedOrder, threadId) : state.hydratedOrder,
    })),
  sweepHydratedThreads: (activeThreadId) =>
    set((state) => {
      const pinned = new Set<string>();
      if (activeThreadId) {
        pinned.add(activeThreadId);
      }

      for (const [threadId, summary] of Object.entries(state.threadSummaries)) {
        if (summary.status.type === "active" || hasPendingApprovalForThread(state.pendingApprovals, threadId)) {
          pinned.add(threadId);
        }
      }

      const keepIds = new Set<string>([...pinned]);
      for (const threadId of state.hydratedOrder) {
        if (keepIds.size >= Math.max(MAX_HYDRATED_THREADS, pinned.size)) {
          break;
        }
        if (state.hydratedThreads[threadId]) {
          keepIds.add(threadId);
        }
      }

      const nextHydratedThreads = Object.fromEntries(
        Object.entries(state.hydratedThreads).filter(([threadId]) => keepIds.has(threadId)),
      );
      const nextHydratedOrder = state.hydratedOrder.filter((threadId) => keepIds.has(threadId));

      if (
        nextHydratedOrder.length === state.hydratedOrder.length &&
        Object.keys(nextHydratedThreads).length === Object.keys(state.hydratedThreads).length
      ) {
        return state;
      }

      return {
        hydratedThreads: nextHydratedThreads,
        hydratedOrder: nextHydratedOrder,
      };
    }),
  clearThread: (threadId) =>
    set((state) => {
      const nextHydratedThreads = { ...state.hydratedThreads };
      delete nextHydratedThreads[threadId];
      return {
        hydratedThreads: nextHydratedThreads,
        hydratedOrder: state.hydratedOrder.filter((candidate) => candidate !== threadId),
      };
    }),
});
