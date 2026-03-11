import { create } from "zustand";
import {
  createJSONStorage,
  persist,
  type StateStorage,
} from "zustand/middleware";
import type {
  BridgeStatus,
  FuzzyFileSearchResult,
  GetAuthStatusResponse,
  RequestId,
  ReviewOutputEvent,
  ServerRequestMethod,
  Thread,
  ThreadItem,
  Turn,
} from "@webcli/codex-protocol";
import type { AppInfo } from "../../../../packages/codex-protocol/src/generated/v2/AppInfo";
import type { ConfigReadResponse } from "../../../../packages/codex-protocol/src/generated/v2/ConfigReadResponse";
import type { ItemCompletedNotification } from "../../../../packages/codex-protocol/src/generated/v2/ItemCompletedNotification";
import type { ItemStartedNotification } from "../../../../packages/codex-protocol/src/generated/v2/ItemStartedNotification";
import type { McpServerStatus } from "../../../../packages/codex-protocol/src/generated/v2/McpServerStatus";
import type { PluginMarketplaceEntry } from "../../../../packages/codex-protocol/src/generated/v2/PluginMarketplaceEntry";
import type { SkillsListEntry } from "../../../../packages/codex-protocol/src/generated/v2/SkillsListEntry";
import type { TurnPlanStep } from "../../../../packages/codex-protocol/src/generated/v2/TurnPlanStep";

export type InspectorTab = "diff" | "review" | "plan" | "command" | "mcp";
export type ThreadArchiveMode = "active" | "archived";
export type SettingsTab =
  | "general"
  | "integrations"
  | "skills"
  | "apps"
  | "plugins"
  | "archived";

export type PendingApproval = {
  id: RequestId;
  method: ServerRequestMethod;
  params: unknown;
};

export type TimelineEntry = {
  id: string;
  turnId: string;
  kind: ThreadItem["type"];
  title: string;
  body: string;
  raw: ThreadItem;
};

export type TurnView = {
  turn: Turn;
  itemOrder: Array<string>;
  items: Record<string, TimelineEntry>;
};

export type ThreadView = {
  thread: Thread;
  archived: boolean;
  turnOrder: Array<string>;
  turns: Record<string, TurnView>;
  latestDiff: string;
  latestPlan: {
    explanation: string | null;
    plan: Array<TurnPlanStep>;
  } | null;
  review: ReviewOutputEvent | null;
};

export type CommandSession = {
  processId: string;
  command: string;
  cwd: string | null;
  tty: boolean;
  allowStdin: boolean;
  status: "running" | "completed" | "failed";
  stdout: string;
  stderr: string;
  exitCode: number | null;
  createdAt: number;
};

export type FuzzySearchState = {
  sessionId: string | null;
  query: string;
  status: "idle" | "loading" | "completed";
  results: Array<FuzzyFileSearchResult>;
};

export type IntegrationState = {
  settingsOpen: boolean;
  settingsTab: SettingsTab;
  authStatus: GetAuthStatusResponse | null;
  config: ConfigReadResponse | null;
  mcpServers: Array<McpServerStatus>;
  skills: Array<SkillsListEntry>;
  apps: Array<AppInfo>;
  plugins: Array<PluginMarketplaceEntry>;
  fuzzySearch: FuzzySearchState;
};

type WorkbenchState = {
  connection: BridgeStatus;
  activeWorkspaceId: string | "all";
  activeThreadId: string | null;
  inspectorTab: InspectorTab;
  threadLifecycle: {
    archivedMode: ThreadArchiveMode;
  };
  threads: Record<string, ThreadView>;
  pendingApprovals: Array<PendingApproval>;
  commandSessions: Record<string, CommandSession>;
  commandOrder: Array<string>;
  integrations: IntegrationState;
  setConnection: (next: Partial<BridgeStatus>) => void;
  setActiveWorkspace: (workspaceId: string | "all") => void;
  setActiveThread: (threadId: string | null) => void;
  setInspectorTab: (tab: InspectorTab) => void;
  setArchivedMode: (mode: ThreadArchiveMode) => void;
  setSettingsOpen: (open: boolean) => void;
  setSettingsTab: (tab: SettingsTab) => void;
  hydrateThread: (thread: Thread) => void;
  upsertThread: (thread: Thread) => void;
  renameThread: (threadId: string, threadName: string | null | undefined) => void;
  markThreadArchived: (threadId: string, archived: boolean) => void;
  applyTurn: (threadId: string, turn: Turn) => void;
  applyItemNotification: (
    notification: ItemStartedNotification | ItemCompletedNotification,
  ) => void;
  appendDelta: (
    threadId: string,
    turnId: string,
    itemId: string,
    kind: TimelineEntry["kind"],
    delta: string,
  ) => void;
  setLatestDiff: (threadId: string, diff: string) => void;
  setLatestPlan: (
    threadId: string,
    payload: { explanation: string | null; plan: Array<TurnPlanStep> },
  ) => void;
  setReview: (threadId: string, review: ReviewOutputEvent | null) => void;
  queueApproval: (approval: PendingApproval) => void;
  resolveApproval: (id: RequestId) => void;
  clearThread: (threadId: string) => void;
  startCommandSession: (input: {
    processId: string;
    command: string;
    cwd: string | null;
    tty: boolean;
    allowStdin: boolean;
  }) => void;
  appendCommandOutput: (
    processId: string,
    stream: "stdout" | "stderr",
    text: string,
  ) => void;
  completeCommandSession: (
    processId: string,
    payload: { exitCode: number; stdout: string; stderr: string },
  ) => void;
  failCommandSession: (processId: string, message: string) => void;
  setIntegrations: (next: Partial<IntegrationState>) => void;
  setFuzzySearch: (next: Partial<FuzzySearchState>) => void;
  clearFuzzySearch: () => void;
};

const WORKBENCH_STORAGE_KEY = "webcli-workbench";
const WORKBENCH_STORAGE_VERSION = 1;

const defaultConnection: BridgeStatus = {
  connected: false,
  childPid: null,
  authenticated: false,
  requiresOpenaiAuth: true,
  restartCount: 0,
  lastError: null,
};

const defaultIntegrations: IntegrationState = {
  settingsOpen: false,
  settingsTab: "general",
  authStatus: null,
  config: null,
  mcpServers: [],
  skills: [],
  apps: [],
  plugins: [],
  fuzzySearch: {
    sessionId: null,
    query: "",
    status: "idle",
    results: [],
  },
};

const memoryStorage = new Map<string, string>();

function resolvePersistStorage(): StateStorage {
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

export const useWorkbenchStore = create<WorkbenchState>()(
  persist(
    (set) => ({
      connection: defaultConnection,
      activeWorkspaceId: "all",
      activeThreadId: null,
      inspectorTab: "diff",
      threadLifecycle: {
        archivedMode: "active",
      },
      threads: {},
      pendingApprovals: [],
      commandSessions: {},
      commandOrder: [],
      integrations: defaultIntegrations,
      setConnection: (next) =>
        set((state) => ({
          connection: {
            ...state.connection,
            ...next,
          },
        })),
      setActiveWorkspace: (workspaceId) => set({ activeWorkspaceId: workspaceId }),
      setActiveThread: (threadId) => set({ activeThreadId: threadId }),
      setInspectorTab: (tab) => set({ inspectorTab: tab }),
      setArchivedMode: (mode) =>
        set((state) => ({
          threadLifecycle: {
            ...state.threadLifecycle,
            archivedMode: mode,
          },
        })),
      setSettingsOpen: (open) =>
        set((state) => ({
          integrations: {
            ...state.integrations,
            settingsOpen: open,
          },
        })),
      setSettingsTab: (tab) =>
        set((state) => ({
          integrations: {
            ...state.integrations,
            settingsTab: tab,
          },
        })),
      hydrateThread: (thread) =>
        set((state) => ({
          threads: {
            ...state.threads,
            [thread.id]: buildThreadView(thread, state.threads[thread.id]?.archived ?? false),
          },
        })),
      upsertThread: (thread) =>
        set((state) => ({
          threads: {
            ...state.threads,
            [thread.id]: mergeThread(state.threads[thread.id], thread),
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
              },
            },
          };
        }),
      applyTurn: (threadId, turn) =>
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
                turnOrder: threadView.turnOrder.includes(turn.id)
                  ? threadView.turnOrder
                  : [...threadView.turnOrder, turn.id],
                turns: {
                  ...threadView.turns,
                  [turn.id]: buildTurnView(turn),
                },
              },
            },
          };
        }),
      applyItemNotification: (notification) =>
        set((state) => {
          const threadView = state.threads[notification.threadId];
          if (!threadView) {
            return state;
          }

          const existingTurn =
            threadView.turns[notification.turnId] ??
            buildTurnView({
              id: notification.turnId,
              items: [],
              status: "inProgress",
              error: null,
            });
          const nextEntry = normalizeItem(notification.item, notification.turnId);

          return {
            threads: {
              ...state.threads,
              [notification.threadId]: {
                ...threadView,
                turnOrder: threadView.turnOrder.includes(notification.turnId)
                  ? threadView.turnOrder
                  : [...threadView.turnOrder, notification.turnId],
                turns: {
                  ...threadView.turns,
                  [notification.turnId]: {
                    ...existingTurn,
                    itemOrder: existingTurn.itemOrder.includes(notification.item.id)
                      ? existingTurn.itemOrder
                      : [...existingTurn.itemOrder, notification.item.id],
                    items: {
                      ...existingTurn.items,
                      [notification.item.id]: nextEntry,
                    },
                  },
                },
              },
            },
          };
        }),
      appendDelta: (threadId, turnId, itemId, kind, delta) =>
        set((state) => {
          const threadView = state.threads[threadId];
          if (!threadView) {
            return state;
          }

          const turn =
            threadView.turns[turnId] ??
            buildTurnView({
              id: turnId,
              items: [],
              status: "inProgress",
              error: null,
            });
          const current =
            turn.items[itemId] ?? normalizeItem(buildPlaceholderItem(itemId, kind), turnId);
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
          pendingApprovals: state.pendingApprovals.some(
            (candidate) => candidate.id === approval.id,
          )
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
      startCommandSession: ({ processId, command, cwd, tty, allowStdin }) =>
        set((state) => ({
          commandSessions: {
            ...state.commandSessions,
            [processId]: {
              processId,
              command,
              cwd,
              tty,
              allowStdin,
              status: "running",
              stdout: "",
              stderr: "",
              exitCode: null,
              createdAt: Date.now(),
            },
          },
          commandOrder: state.commandOrder.includes(processId)
            ? state.commandOrder
            : [processId, ...state.commandOrder],
        })),
      appendCommandOutput: (processId, stream, text) =>
        set((state) => {
          const session = state.commandSessions[processId];
          if (!session) {
            return state;
          }

          return {
            commandSessions: {
              ...state.commandSessions,
              [processId]: {
                ...session,
                [stream]: `${session[stream]}${text}`,
              },
            },
          };
        }),
      completeCommandSession: (processId, payload) =>
        set((state) => {
          const session = state.commandSessions[processId];
          if (!session) {
            return state;
          }

          return {
            commandSessions: {
              ...state.commandSessions,
              [processId]: {
                ...session,
                status: payload.exitCode === 0 ? "completed" : "failed",
                exitCode: payload.exitCode,
                stdout: payload.stdout ? `${session.stdout}${payload.stdout}` : session.stdout,
                stderr: payload.stderr ? `${session.stderr}${payload.stderr}` : session.stderr,
              },
            },
          };
        }),
      failCommandSession: (processId, message) =>
        set((state) => {
          const session = state.commandSessions[processId];
          if (!session) {
            return state;
          }

          return {
            commandSessions: {
              ...state.commandSessions,
              [processId]: {
                ...session,
                status: "failed",
                stderr: `${session.stderr}${session.stderr ? "\n" : ""}${message}`,
              },
            },
          };
        }),
      setIntegrations: (next) =>
        set((state) => ({
          integrations: {
            ...state.integrations,
            ...next,
          },
        })),
      setFuzzySearch: (next) =>
        set((state) => ({
          integrations: {
            ...state.integrations,
            fuzzySearch: {
              ...state.integrations.fuzzySearch,
              ...next,
            },
          },
        })),
      clearFuzzySearch: () =>
        set((state) => ({
          integrations: {
            ...state.integrations,
            fuzzySearch: defaultIntegrations.fuzzySearch,
          },
        })),
    }),
    {
      name: WORKBENCH_STORAGE_KEY,
      version: WORKBENCH_STORAGE_VERSION,
      storage: createJSONStorage(resolvePersistStorage),
      migrate: (persistedState: any) => ({
        ...persistedState,
        threadLifecycle: {
          archivedMode: "active",
        },
      }),
      partialize: (state) => ({
        activeThreadId: state.activeThreadId,
        activeWorkspaceId: state.activeWorkspaceId,
        inspectorTab: state.inspectorTab,
      }),
    },
  ),
);

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
  if (!threadView) {
    return [];
  }

  return threadView.turnOrder.flatMap((turnId) => {
    const turn = threadView.turns[turnId];
    return turn.itemOrder.map((itemId) => turn.items[itemId]).filter(Boolean);
  });
}

function buildThreadView(thread: Thread, archived = false): ThreadView {
  const turns: Record<string, TurnView> = {};
  const turnOrder: Array<string> = [];

  for (const turn of thread.turns) {
    turns[turn.id] = buildTurnView(turn);
    turnOrder.push(turn.id);
  }

  return {
    thread,
    archived,
    turnOrder,
    turns,
    latestDiff: "",
    latestPlan: null,
    review: null,
  };
}

function mergeThread(existing: ThreadView | undefined, thread: Thread): ThreadView {
  if (!existing) {
    return buildThreadView(thread);
  }

  return {
    ...existing,
    thread: {
      ...existing.thread,
      ...thread,
    },
  };
}

function buildTurnView(turn: Turn): TurnView {
  const items = Object.fromEntries(
    turn.items.map((item) => [item.id, normalizeItem(item, turn.id)]),
  ) as Record<string, TimelineEntry>;

  return {
    turn,
    itemOrder: turn.items.map((item) => item.id),
    items,
  };
}

function normalizeItem(item: ThreadItem, turnId: string): TimelineEntry {
  switch (item.type) {
    case "userMessage":
      return {
        id: item.id,
        turnId,
        kind: item.type,
        title: "You",
        body: item.content
          .map((entry) => ("text" in entry ? entry.text : JSON.stringify(entry)))
          .join("\n"),
        raw: item,
      };
    case "agentMessage":
      return {
        id: item.id,
        turnId,
        kind: item.type,
        title: "Codex",
        body: item.text,
        raw: item,
      };
    case "plan":
      return {
        id: item.id,
        turnId,
        kind: item.type,
        title: "Plan",
        body: item.text,
        raw: item,
      };
    case "reasoning":
      return {
        id: item.id,
        turnId,
        kind: item.type,
        title: "Reasoning",
        body: [...item.summary, ...item.content].join("\n"),
        raw: item,
      };
    case "commandExecution":
      return {
        id: item.id,
        turnId,
        kind: item.type,
        title: item.command,
        body: item.aggregatedOutput ?? "",
        raw: item,
      };
    case "fileChange":
      return {
        id: item.id,
        turnId,
        kind: item.type,
        title: "File Change",
        body: item.changes.map((change) => `${change.kind}: ${change.path}`).join("\n"),
        raw: item,
      };
    case "mcpToolCall":
      return {
        id: item.id,
        turnId,
        kind: item.type,
        title: `${item.server} / ${item.tool}`,
        body: item.result ? JSON.stringify(item.result, null, 2) : "",
        raw: item,
      };
    case "dynamicToolCall":
      return {
        id: item.id,
        turnId,
        kind: item.type,
        title: item.tool,
        body: item.contentItems ? JSON.stringify(item.contentItems, null, 2) : "",
        raw: item,
      };
    case "collabAgentToolCall":
      return {
        id: item.id,
        turnId,
        kind: item.type,
        title: item.tool,
        body: item.prompt ?? "",
        raw: item,
      };
    case "webSearch":
      return {
        id: item.id,
        turnId,
        kind: item.type,
        title: "Web Search",
        body: item.query,
        raw: item,
      };
    case "imageView":
    case "imageGeneration":
    case "enteredReviewMode":
    case "exitedReviewMode":
    case "contextCompaction":
      return {
        id: item.id,
        turnId,
        kind: item.type,
        title: item.type,
        body: JSON.stringify(item, null, 2),
        raw: item,
      };
    default:
      const fallback = item as ThreadItem;
      return {
        id: fallback.id,
        turnId,
        kind: fallback.type,
        title: fallback.type,
        body: JSON.stringify(fallback, null, 2),
        raw: fallback,
      };
  }
}

function buildPlaceholderItem(itemId: string, kind: TimelineEntry["kind"]): ThreadItem {
  switch (kind) {
    case "agentMessage":
      return { type: "agentMessage", id: itemId, text: "", phase: null };
    case "plan":
      return { type: "plan", id: itemId, text: "" };
    case "reasoning":
      return { type: "reasoning", id: itemId, summary: [], content: [] };
    case "commandExecution":
      return {
        type: "commandExecution",
        id: itemId,
        command: "",
        cwd: "",
        processId: null,
        status: "inProgress",
        commandActions: [],
        aggregatedOutput: "",
        exitCode: null,
        durationMs: null,
      };
    case "fileChange":
      return {
        type: "fileChange",
        id: itemId,
        changes: [],
        status: "inProgress",
      };
    default:
      return {
        type: "agentMessage",
        id: itemId,
        text: "",
        phase: null,
      };
  }
}
