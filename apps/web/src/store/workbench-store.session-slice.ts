import type { StateCreator } from "zustand";
import {
  buildPlaceholderItem,
  cloneThreadView,
  cloneTurn,
  createEmptyThreadView,
  createEmptyTurn,
  mergeTurn,
  mergeThreadSummary,
} from "./workbench-store.helpers";
import type { SessionSlice, TimelineEntry, WorkbenchState } from "./workbench-store.types";

export const createSessionSlice: StateCreator<WorkbenchState, [], [], SessionSlice> = (set) => ({
  threads: {},
  pendingApprovals: [],
  hydrateThread: (thread) =>
    set((state) => ({
      threads: {
        ...state.threads,
        [thread.thread.id]: cloneThreadView(thread),
      },
    })),
  upsertThread: (thread) =>
    set((state) => ({
      threads: {
        ...state.threads,
        [thread.id]: mergeThreadSummary(state.threads[thread.id], thread),
      },
    })),
  renameThread: (threadId, threadName) =>
    set((state) => {
      const threadView = state.threads[threadId];
      if (!threadView) {
        return state;
      }

      return {
        threads: {
          ...state.threads,
          [threadId]: {
            ...threadView,
            thread: {
              ...threadView.thread,
              name: threadName ?? null,
            },
          },
        },
      };
    }),
  markThreadArchived: (threadId, archived) =>
    set((state) => {
      const threadView = state.threads[threadId];
      if (!threadView || threadView.archived === archived) {
        return state;
      }

      return {
        threads: {
          ...state.threads,
          [threadId]: {
            ...threadView,
            archived,
            thread: {
              ...threadView.thread,
              archived,
            },
          },
        },
      };
    }),
  applyTurn: (threadId, turn) =>
    set((state) => {
      const threadView = state.threads[threadId] ?? createEmptyThreadView(threadId);
      const existingTurn = threadView.turns[turn.turn.id];

      return {
        threads: {
          ...state.threads,
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
      };
    }),
  applyTimelineItem: (threadId, item) =>
    set((state) => {
      const threadView = state.threads[threadId] ?? createEmptyThreadView(threadId);
      const turn = threadView.turns[item.turnId] ?? createEmptyTurn(item.turnId);

      return {
        threads: {
          ...state.threads,
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
      };
    }),
  appendDelta: (threadId, turnId, itemId, kind, delta) =>
    set((state) => {
      const threadView = state.threads[threadId] ?? createEmptyThreadView(threadId);
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
        threads: {
          ...state.threads,
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
      };
    }),
  setLatestDiff: (threadId, diff) =>
    set((state) => {
      const threadView = state.threads[threadId];
      if (!threadView) {
        return state;
      }

      return {
        threads: {
          ...state.threads,
          [threadId]: {
            ...threadView,
            latestDiff: diff,
          },
        },
      };
    }),
  setLatestPlan: (threadId, payload) =>
    set((state) => {
      const threadView = state.threads[threadId];
      if (!threadView) {
        return state;
      }

      return {
        threads: {
          ...state.threads,
          [threadId]: {
            ...threadView,
            latestPlan: payload,
          },
        },
      };
    }),
  setReview: (threadId, review) =>
    set((state) => {
      const threadView = state.threads[threadId];
      if (!threadView) {
        return state;
      }

      return {
        threads: {
          ...state.threads,
          [threadId]: {
            ...threadView,
            review,
          },
        },
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
  clearThread: (threadId) =>
    set((state) => {
      const nextThreads = { ...state.threads };
      delete nextThreads[threadId];
      return { threads: nextThreads };
    }),
});
