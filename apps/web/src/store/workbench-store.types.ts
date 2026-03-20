import type {
  CommandSessionSnapshot,
  FuzzySearchSnapshot,
  GitWorkingTreeSnapshot,
  IntegrationSnapshot,
  InspectorTab,
  PendingApproval as WorkbenchPendingApproval,
  RequestId,
  ReviewOutput,
  RuntimeStatus,
  SettingsTab,
  ThreadTokenUsage,
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
  threadSummaries: Record<string, ThreadSummary>;
  hydratedThreads: Record<string, ThreadView>;
  hydratedOrder: Array<string>;
  gitSnapshotsByWorkspaceId: Record<string, GitWorkingTreeSnapshot>;
  selectedGitFileByWorkspaceId: Record<string, string | null>;
  pendingApprovals: Array<PendingApproval>;
  syncBootstrapActiveThreads: (threads: Array<ThreadSummary>) => void;
  hydrateThread: (thread: ThreadView) => void;
  upsertThread: (thread: ThreadSummary) => void;
  setWorkspaceGitSnapshot: (snapshot: GitWorkingTreeSnapshot) => void;
  selectWorkspaceGitFile: (workspaceId: string, path: string | null) => void;
  renameThread: (threadId: string, threadName: string | null | undefined) => void;
  markThreadArchived: (threadId: string, archived: boolean) => void;
  markThreadClosed: (threadId: string) => void;
  applyTurn: (threadId: string, turn: WorkbenchTurn) => void;
  applyTimelineItem: (threadId: string, item: TimelineEntry) => void;
  appendDelta: (
    threadId: string,
    turnId: string,
    itemId: string,
    kind: TimelineEntry["kind"],
    delta: string,
  ) => void;
  appendDeltaBatch: (
    entries: Array<{
      threadId: string;
      turnId: string;
      itemId: string;
      kind: TimelineEntry["kind"];
      delta: string;
    }>,
  ) => void;
  setLatestDiff: (threadId: string, diff: string) => void;
  setLatestPlan: (threadId: string, payload: ThreadView["latestPlan"]) => void;
  setReview: (threadId: string, review: ReviewOutput | null) => void;
  setTurnTokenUsage: (
    threadId: string,
    turnId: string,
    tokenUsage: ThreadTokenUsage,
  ) => void;
  queueApproval: (approval: PendingApproval) => void;
  resolveApproval: (id: RequestId) => void;
  touchHydratedThread: (threadId: string) => void;
  sweepHydratedThreads: (activeThreadId: string | null) => void;
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
