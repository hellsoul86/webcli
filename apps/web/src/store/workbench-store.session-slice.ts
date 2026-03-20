import type { StateCreator } from "zustand";
import type { JsonValue, RealtimeAudioChunk } from "@webcli/contracts";
import { buildRealtimeWavBlob, decodeRealtimeAudioChunk } from "../shared/workbench/realtime-audio";
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
import type {
  RealtimeAudioState,
  RealtimeSessionState,
  RealtimeTranscriptEntry,
  SessionSlice,
  TimelineEntry,
  WorkbenchState,
} from "./workbench-store.types";

const MAX_HYDRATED_THREADS = 2;
const REALTIME_AUDIO_REBUILD_DEBOUNCE_MS = 500;
const realtimeAudioUrlTimers = new Map<string, ReturnType<typeof setTimeout>>();
let realtimeTranscriptSequence = 0;

function applyDeltaEntries(
  threadViewState: WorkbenchState,
  entries: Array<{
    threadId: string;
    turnId: string;
    itemId: string;
    kind: TimelineEntry["kind"];
    delta: string;
  }>,
) {
  if (entries.length === 0) {
    return threadViewState;
  }

  const nextHydratedThreads = { ...threadViewState.hydratedThreads };
  let nextHydratedOrder = threadViewState.hydratedOrder;
  let changed = false;

  for (const entry of entries) {
    const summary = threadViewState.threadSummaries[entry.threadId];
    const threadView =
      nextHydratedThreads[entry.threadId] ?? createEmptyThreadView(entry.threadId, summary);
    const turn = threadView.turns[entry.turnId] ?? createEmptyTurn(entry.turnId);
    const current =
      turn.items[entry.itemId] ?? buildPlaceholderItem(entry.itemId, entry.turnId, entry.kind);
    const nextItem: TimelineEntry =
      entry.kind === "reasoning"
        ? {
            ...current,
            body: current.body ? `${current.body}\n${entry.delta}`.trim() : entry.delta,
          }
        : {
            ...current,
            body: `${current.body}${entry.delta}`,
          };

    nextHydratedThreads[entry.threadId] = {
      ...threadView,
      turnOrder: threadView.turnOrder.includes(entry.turnId)
        ? threadView.turnOrder
        : [...threadView.turnOrder, entry.turnId],
      turns: {
        ...threadView.turns,
        [entry.turnId]: {
          ...turn,
          itemOrder: turn.itemOrder.includes(entry.itemId)
            ? turn.itemOrder
            : [...turn.itemOrder, entry.itemId],
          items: {
            ...turn.items,
            [entry.itemId]: nextItem,
          },
        },
      },
    };
    nextHydratedOrder = touchOrderedIds(nextHydratedOrder, entry.threadId);
    changed = true;
  }

  if (!changed) {
    return threadViewState;
  }

  return {
    hydratedThreads: nextHydratedThreads,
    hydratedOrder: nextHydratedOrder,
  };
}

function createEmptyRealtimeAudioState(): RealtimeAudioState {
  return {
    sampleRate: null,
    numChannels: null,
    chunkCount: 0,
    pcmChunks: [],
    objectUrl: null,
    decodeError: null,
  };
}

function createRealtimeSessionState(
  threadId: string,
  sessionId: string | null,
): RealtimeSessionState {
  const now = Date.now();
  return {
    threadId,
    sessionId,
    status: "live",
    startedAt: now,
    updatedAt: now,
    closedAt: null,
    errorMessage: null,
    closeReason: null,
    items: [],
    audio: createEmptyRealtimeAudioState(),
  };
}

function revokeObjectUrl(objectUrl: string | null): void {
  if (!objectUrl || typeof URL?.revokeObjectURL !== "function") {
    return;
  }
  URL.revokeObjectURL(objectUrl);
}

function cancelRealtimeAudioUrlTimer(threadId: string): void {
  const timer = realtimeAudioUrlTimers.get(threadId);
  if (timer !== undefined) {
    clearTimeout(timer);
    realtimeAudioUrlTimers.delete(threadId);
  }
}

function extractRealtimeTextPreview(value: JsonValue): string | null {
  if (typeof value === "string") {
    return value;
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const candidate = value as Record<string, JsonValue>;
  for (const key of ["text", "content", "transcript"]) {
    const entry = candidate[key];
    if (typeof entry === "string" && entry.trim()) {
      return entry;
    }
  }

  if (Array.isArray(candidate.content)) {
    const joined = candidate.content
      .map((entry) => {
        if (typeof entry === "string") {
          return entry;
        }
        if (entry && typeof entry === "object" && !Array.isArray(entry)) {
          const nested = entry as Record<string, JsonValue>;
          return typeof nested.text === "string" ? nested.text : null;
        }
        return null;
      })
      .filter((entry): entry is string => Boolean(entry?.trim()))
      .join("\n");
    return joined || null;
  }

  return null;
}

function getRealtimeKindLabel(value: JsonValue): string {
  if (typeof value === "string") {
    return "text";
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "item";
  }

  const candidate = value as Record<string, JsonValue>;
  if (typeof candidate.type === "string" && candidate.type.trim()) {
    return candidate.type;
  }
  if (typeof candidate.kind === "string" && candidate.kind.trim()) {
    return candidate.kind;
  }
  return "item";
}

function createRealtimeTranscriptEntry(raw: JsonValue): RealtimeTranscriptEntry {
  const candidateId =
    raw && typeof raw === "object" && !Array.isArray(raw) && typeof raw.id === "string"
      ? raw.id
      : null;
  const id = candidateId ?? `realtime-item-${Date.now()}-${realtimeTranscriptSequence++}`;
  return {
    id,
    receivedAt: Date.now(),
    raw,
    kindLabel: getRealtimeKindLabel(raw),
    textPreview: extractRealtimeTextPreview(raw),
    jsonPreview: JSON.stringify(raw, null, 2) ?? String(raw),
  };
}

function scheduleRealtimeAudioObjectUrlRebuild(
  set: Parameters<StateCreator<WorkbenchState, [], [], SessionSlice>>[0],
  get: Parameters<StateCreator<WorkbenchState, [], [], SessionSlice>>[1],
  threadId: string,
  immediate = false,
): void {
  cancelRealtimeAudioUrlTimer(threadId);

  const rebuild = () => {
    realtimeAudioUrlTimers.delete(threadId);
    set((state) => {
      const session = state.realtimeSessionsByThreadId[threadId];
      if (
        !session ||
        session.audio.decodeError ||
        session.audio.sampleRate === null ||
        session.audio.numChannels === null ||
        session.audio.pcmChunks.length === 0
      ) {
        return state;
      }

      const blob = buildRealtimeWavBlob(
        session.audio.pcmChunks,
        session.audio.sampleRate,
        session.audio.numChannels,
      );
      const nextObjectUrl =
        typeof URL?.createObjectURL === "function" ? URL.createObjectURL(blob) : null;

      if (session.audio.objectUrl && session.audio.objectUrl !== nextObjectUrl) {
        revokeObjectUrl(session.audio.objectUrl);
      }

      return {
        realtimeSessionsByThreadId: {
          ...state.realtimeSessionsByThreadId,
          [threadId]: {
            ...session,
            audio: {
              ...session.audio,
              objectUrl: nextObjectUrl,
            },
          },
        },
      };
    });
  };

  if (immediate) {
    rebuild();
    return;
  }

  const timer = setTimeout(rebuild, REALTIME_AUDIO_REBUILD_DEBOUNCE_MS);
  realtimeAudioUrlTimers.set(threadId, timer);
}

function cleanupRealtimeSession(session: RealtimeSessionState | undefined): void {
  if (!session) {
    return;
  }
  cancelRealtimeAudioUrlTimer(session.threadId);
  revokeObjectUrl(session.audio.objectUrl);
}

export const createSessionSlice: StateCreator<WorkbenchState, [], [], SessionSlice> = (set, get) => ({
  threadSummaries: {},
  hydratedThreads: {},
  hydratedOrder: [],
  gitSnapshotsByWorkspaceId: {},
  selectedGitFileByWorkspaceId: {},
  pendingApprovals: [],
  realtimeSessionsByThreadId: {},
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
            : null,
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
  markThreadClosed: (threadId) =>
    set((state) => {
      const summary = state.threadSummaries[threadId];
      const hydrated = state.hydratedThreads[threadId];
      if (!summary && !hydrated) {
        return state;
      }

      const nextSummary = summary
        ? {
            ...summary,
            status: { type: "notLoaded" } as const,
          }
        : null;

      return {
        threadSummaries: nextSummary
          ? {
              ...state.threadSummaries,
              [threadId]: nextSummary,
            }
          : state.threadSummaries,
        hydratedThreads: hydrated
          ? {
              ...state.hydratedThreads,
              [threadId]: {
                ...hydrated,
                thread: nextSummary ?? hydrated.thread,
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
    set((state) =>
      applyDeltaEntries(state, [
        {
          threadId,
          turnId,
          itemId,
          kind,
          delta,
        },
      ]),
    ),
  appendDeltaBatch: (entries) =>
    set((state) => applyDeltaEntries(state, entries)),
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
  setTurnTokenUsage: (threadId, turnId, tokenUsage) =>
    set((state) => {
      const threadView = state.hydratedThreads[threadId];
      const turn = threadView?.turns[turnId];
      if (!threadView || !turn) {
        return state;
      }

      return {
        hydratedThreads: {
          ...state.hydratedThreads,
          [threadId]: {
            ...threadView,
            turns: {
              ...threadView.turns,
              [turnId]: {
                ...turn,
                turn: {
                  ...turn.turn,
                  tokenUsage,
                },
              },
            },
          },
        },
        hydratedOrder: touchOrderedIds(state.hydratedOrder, threadId),
      };
    }),
  startRealtimeSession: (threadId, sessionId) =>
    set((state) => {
      cleanupRealtimeSession(state.realtimeSessionsByThreadId[threadId]);
      return {
        realtimeSessionsByThreadId: {
          ...state.realtimeSessionsByThreadId,
          [threadId]: createRealtimeSessionState(threadId, sessionId),
        },
      };
    }),
  appendRealtimeItem: (threadId, item) =>
    set((state) => {
      const session =
        state.realtimeSessionsByThreadId[threadId] ?? createRealtimeSessionState(threadId, null);
      return {
        realtimeSessionsByThreadId: {
          ...state.realtimeSessionsByThreadId,
          [threadId]: {
            ...session,
            updatedAt: Date.now(),
            items: [...session.items, createRealtimeTranscriptEntry(item)],
          },
        },
      };
    }),
  appendRealtimeAudio: (threadId, chunk) => {
    set((state) => {
      const session =
        state.realtimeSessionsByThreadId[threadId] ?? createRealtimeSessionState(threadId, null);
      const audio = session.audio;

      if (audio.decodeError) {
        return {
          realtimeSessionsByThreadId: {
            ...state.realtimeSessionsByThreadId,
            [threadId]: {
              ...session,
              updatedAt: Date.now(),
              audio: {
                ...audio,
                chunkCount: audio.chunkCount + 1,
              },
            },
          },
        };
      }

      try {
        const decoded = decodeRealtimeAudioChunk(chunk, {
          sampleRate: audio.sampleRate ?? chunk.sampleRate,
          numChannels: audio.numChannels ?? chunk.numChannels,
        });

        const nextSession: RealtimeSessionState = {
          ...session,
          updatedAt: Date.now(),
          audio: {
            ...audio,
            sampleRate: decoded.sampleRate,
            numChannels: decoded.numChannels,
            chunkCount: audio.chunkCount + 1,
            pcmChunks: [...audio.pcmChunks, decoded.pcmBytes],
          },
        };

        return {
          realtimeSessionsByThreadId: {
            ...state.realtimeSessionsByThreadId,
            [threadId]: nextSession,
          },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const nextSession: RealtimeSessionState = {
          ...session,
          updatedAt: Date.now(),
          audio: {
            ...audio,
            chunkCount: audio.chunkCount + 1,
            decodeError: message,
          },
        };
        if (audio.objectUrl) {
          revokeObjectUrl(audio.objectUrl);
          nextSession.audio.objectUrl = null;
        }
        cancelRealtimeAudioUrlTimer(threadId);
        return {
          realtimeSessionsByThreadId: {
            ...state.realtimeSessionsByThreadId,
            [threadId]: nextSession,
          },
        };
      }
    });
    scheduleRealtimeAudioObjectUrlRebuild(set, get, threadId);
  },
  failRealtimeSession: (threadId, message) =>
    set((state) => {
      const session =
        state.realtimeSessionsByThreadId[threadId] ?? createRealtimeSessionState(threadId, null);
      return {
        realtimeSessionsByThreadId: {
          ...state.realtimeSessionsByThreadId,
          [threadId]: {
            ...session,
            status: "error",
            updatedAt: Date.now(),
            errorMessage: message,
          },
        },
      };
    }),
  closeRealtimeSession: (threadId, reason) => {
    set((state) => {
      const session =
        state.realtimeSessionsByThreadId[threadId] ?? createRealtimeSessionState(threadId, null);
      return {
        realtimeSessionsByThreadId: {
          ...state.realtimeSessionsByThreadId,
          [threadId]: {
            ...session,
            status: session.status === "error" ? "error" : "closed",
            updatedAt: Date.now(),
            closedAt: Date.now(),
            closeReason: reason,
          },
        },
      };
    });
    scheduleRealtimeAudioObjectUrlRebuild(set, get, threadId, true);
  },
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
      const nextRealtimeSessions = { ...state.realtimeSessionsByThreadId };
      cleanupRealtimeSession(nextRealtimeSessions[threadId]);
      delete nextRealtimeSessions[threadId];
      return {
        hydratedThreads: nextHydratedThreads,
        hydratedOrder: state.hydratedOrder.filter((candidate) => candidate !== threadId),
        realtimeSessionsByThreadId: nextRealtimeSessions,
      };
    }),
});
