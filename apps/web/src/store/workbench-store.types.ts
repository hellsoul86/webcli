import type {
  CommandSessionSnapshot,
  FuzzySearchSnapshot,
  IntegrationSnapshot,
  InspectorTab,
  PendingApproval as WorkbenchPendingApproval,
  RequestId,
  ReviewOutput,
  RuntimeStatus,
  SettingsTab,
  ThreadArchiveMode,
  ThreadSummary,
  TimelineEntry as WorkbenchTimelineEntry,
  WorkbenchThread,
  WorkbenchTurn,
} from "@webcli/contracts";

export type { InspectorTab, SettingsTab, ThreadArchiveMode } from "@webcli/contracts";

export type PendingApproval = WorkbenchPendingApproval;
export type TimelineEntry = WorkbenchTimelineEntry;
export type ThreadView = WorkbenchThread;
export type CommandSession = CommandSessionSnapshot;

export type IntegrationState = IntegrationSnapshot & {
  settingsOpen: boolean;
  settingsTab: SettingsTab;
  fuzzySearch: FuzzySearchSnapshot;
};

export type UiSlice = {
  connection: RuntimeStatus;
  activeWorkspaceId: string | "all";
  activeThreadId: string | null;
  inspectorTab: InspectorTab;
  threadLifecycle: {
    archivedMode: ThreadArchiveMode;
  };
  setConnection: (next: Partial<RuntimeStatus>) => void;
  setActiveWorkspace: (workspaceId: string | "all") => void;
  setActiveThread: (threadId: string | null) => void;
  setInspectorTab: (tab: InspectorTab) => void;
  setArchivedMode: (mode: ThreadArchiveMode) => void;
};

export type SessionSlice = {
  threads: Record<string, ThreadView>;
  pendingApprovals: Array<PendingApproval>;
  hydrateThread: (thread: ThreadView) => void;
  upsertThread: (thread: ThreadSummary) => void;
  renameThread: (threadId: string, threadName: string | null | undefined) => void;
  markThreadArchived: (threadId: string, archived: boolean) => void;
  applyTurn: (threadId: string, turn: WorkbenchTurn) => void;
  applyTimelineItem: (threadId: string, item: TimelineEntry) => void;
  appendDelta: (
    threadId: string,
    turnId: string,
    itemId: string,
    kind: TimelineEntry["kind"],
    delta: string,
  ) => void;
  setLatestDiff: (threadId: string, diff: string) => void;
  setLatestPlan: (threadId: string, payload: ThreadView["latestPlan"]) => void;
  setReview: (threadId: string, review: ReviewOutput | null) => void;
  queueApproval: (approval: PendingApproval) => void;
  resolveApproval: (id: RequestId) => void;
  clearThread: (threadId: string) => void;
};

export type CommandSlice = {
  commandSessions: Record<string, CommandSession>;
  commandOrder: Array<string>;
  startCommandSession: (input: {
    processId: string;
    command: string;
    cwd: string | null;
    tty: boolean;
    allowStdin: boolean;
  }) => void;
  setCommandSession: (session: CommandSession | null) => void;
  appendCommandOutput: (processId: string, stream: "stdout" | "stderr", text: string) => void;
  completeCommandSession: (
    processId: string,
    payload: { exitCode: number | null; stdout: string; stderr: string },
  ) => void;
  failCommandSession: (processId: string, message: string) => void;
};

export type IntegrationSlice = {
  integrations: IntegrationState;
  setSettingsOpen: (open: boolean) => void;
  setSettingsTab: (tab: SettingsTab) => void;
  setIntegrations: (next: Partial<IntegrationState>) => void;
  setIntegrationSnapshot: (snapshot: IntegrationSnapshot) => void;
  setFuzzySearch: (next: Partial<FuzzySearchSnapshot>) => void;
  clearFuzzySearch: () => void;
};

export type WorkbenchState = UiSlice & SessionSlice & CommandSlice & IntegrationSlice;
