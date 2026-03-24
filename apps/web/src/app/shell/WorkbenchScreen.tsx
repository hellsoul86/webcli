import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { TFunction } from "i18next";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AccountLoginCompleted,
  AccountRateLimitsSnapshot,
  AccountSummary,
  AccountStateSnapshot,
  AccountUsageWindow,
  ApprovalPolicy,
  AuthStatusSnapshot,
  BootstrapResponse,
  ConfigSnapshot,
  ConfigRequirementsSnapshot,
  ConfigWarningNotice,
  DeprecationNotice,
  ExternalAgentConfigMigrationItem,
  ForcedLoginMethod,
  GitBranchReference,
  GitRemoteDiffSnapshot,
  GitWorkingTreeFile,
  GitWorkingTreeSnapshot,
  HazelnutScope,
  IntegrationSnapshot,
  InspectorTab,
  ModelRerouteEvent,
  ModelOption,
  ServerRequestResolveInput,
  ProductSurface,
  ReasoningEffort,
  RemoteSkillSummary,
  SandboxMode,
  ServiceTier,
  SettingsTab,
  ThreadArchiveMode,
  ThreadSummary,
  TimelineEntry,
  WorkspaceRecord,
} from "@webcli/contracts";
import { api } from "../../api";
import { useActiveClient } from "../../hooks/use-active-client";
import { useIsMobile } from "../../hooks/use-is-mobile";
import { localizeError, localizeErrorWithFallback } from "../../i18n/errors";
import { formatDateTime, formatNumber, formatPercent, formatRelativeShort } from "../../i18n/format";
import { translate } from "../../i18n/init";
import { useAppLocale } from "../../i18n/use-i18n";
import { createWorkbenchMessageDispatcher } from "../../shared/workbench/event-router";
import {
  type CodeLinkReference,
  type ImagePreviewReference,
} from "../../shared/workbench/renderable-content";
import {
  countTimelineEntries,
  selectTimelineWindow,
  useWorkbenchStore,
  type CommandSession,
  type ThreadView,
} from "../../store/workbench-store";
import {
  resolvePreferredSelection,
  summarizeGitSnapshot,
} from "./inspector-helpers";
import { ConversationPane, ComposerPane } from "./conversation-pane";
import { WorkbenchHeader } from "./workbench-header";
import { RightRail } from "./right-rail";
import { type ComposerDropdownOption, type ComposerSpeedMode } from "./workbench-shell-controls";
import { WorkbenchSidebar } from "./workbench-sidebar";
import { WorkbenchOverlays } from "./workbench-overlays";

const LazyGitReviewPanel = lazy(() =>
  import("./git-review-panel").then((module) => ({
    default: module.GitReviewPanel,
  })),
);

const LazyCodePreviewDialog = lazy(() =>
  import("./code-preview-dialog").then((module) => ({
    default: module.CodePreviewDialog,
  })),
);

const DEFAULT_SIDEBAR_WIDTH = 326;
const DEFAULT_INSPECTOR_WIDTH = 360;
const SIDEBAR_WIDTH_STORAGE_KEY = "webcli.sidebarWidth";
const INSPECTOR_WIDTH_STORAGE_KEY = "webcli.gitTreeWidth";
const INITIAL_TIMELINE_WINDOW_SIZE = 80;
const TIMELINE_WINDOW_BATCH_SIZE = 80;
const TIMELINE_WINDOW_SCROLL_THRESHOLD = 120;
const ACCOUNT_RATE_LIMITS_QUERY_KEY = ["account-rate-limits"] as const;
const CONFIG_REQUIREMENTS_QUERY_KEY = ["config-requirements"] as const;
const MAX_SETTINGS_SURFACE_ITEMS = 6;

type WorkspaceFormInput = {
  name: string;
  absPath: string;
  defaultModel?: string | null;
  approvalPolicy?: ApprovalPolicy;
  sandboxMode?: SandboxMode;
};

type EditableApprovalPolicy = NonNullable<WorkspaceRecord["approvalPolicy"]>;
type EditableSandboxMode = NonNullable<WorkspaceRecord["sandboxMode"]>;

type PaletteAction = {
  id: string;
  label: string;
  description: string;
  run: () => void;
};

type AccountLoginState = {
  method: "chatgpt" | "deviceCode" | "apiKey" | "chatgptAuthTokens";
  loginId: string | null;
  authUrlOpened: boolean;
  verificationUrl: string | null;
  userCode: string | null;
  expiresAt: number | null;
  phase: "pending" | "failed";
  error: string | null;
};

type QueuedPrompt = {
  id: string;
  threadId: string;
  text: string;
};

function buildPromptSuggestions(t: TFunction): Array<string> {
  return [
    t("prompts.summarizeRisks"),
    t("prompts.reviewStructure"),
    t("prompts.fixHighestRiskBug"),
  ];
}

function buildSettingsTabs(t: TFunction): Array<{ id: SettingsTab; label: string }> {
  return [
    { id: "account", label: t("settings.tabs.account") },
    { id: "general", label: t("settings.tabs.general") },
    { id: "defaults", label: t("settings.tabs.defaults") },
    { id: "integrations", label: t("settings.tabs.integrations") },
    { id: "extensions", label: t("settings.tabs.extensions") },
    { id: "history", label: t("settings.tabs.history") },
  ];
}

function getReasoningEffortLabels(t: TFunction): Record<ReasoningEffort, string> {
  return {
    none: t("settings.reasoningLevels.none"),
    minimal: t("settings.reasoningLevels.minimal"),
    low: t("settings.reasoningLevels.low"),
    medium: t("settings.reasoningLevels.medium"),
    high: t("settings.reasoningLevels.high"),
    xhigh: t("settings.reasoningLevels.xhigh"),
  };
}

function buildApprovalPolicyOptions(t: TFunction): Array<ComposerDropdownOption<EditableApprovalPolicy>> {
  return [
    { value: "on-request", label: t("settings.approvalPolicies.on-request"), testIdSuffix: "on-request" },
    { value: "on-failure", label: t("settings.approvalPolicies.on-failure"), testIdSuffix: "on-failure" },
    { value: "untrusted", label: t("settings.approvalPolicies.untrusted"), testIdSuffix: "untrusted" },
    { value: "never", label: t("settings.approvalPolicies.never"), testIdSuffix: "never" },
  ];
}

function buildSandboxModeOptions(t: TFunction): Array<ComposerDropdownOption<EditableSandboxMode>> {
  return [
    { value: "danger-full-access", label: t("settings.sandboxModes.danger-full-access"), testIdSuffix: "full-access" },
    { value: "workspace-write", label: t("settings.sandboxModes.workspace-write"), testIdSuffix: "workspace-write" },
    { value: "read-only", label: t("settings.sandboxModes.read-only"), testIdSuffix: "read-only" },
  ];
}

function buildSettingsReasoningEffortOptions(t: TFunction): Array<{ value: "" | ReasoningEffort; label: string }> {
  const labels = getReasoningEffortLabels(t);
  return [
    { value: "", label: t("common.default") },
    ...Object.entries(labels).map(([value, label]) => ({
      value: value as ReasoningEffort,
      label,
    })),
  ];
}

function splitPathSegments(value: string): Array<string> {
  return value.split("/").filter(Boolean);
}

function prependDistinctByKey<T>(
  items: Array<T>,
  next: T,
  getKey: (item: T) => string,
  limit = MAX_SETTINGS_SURFACE_ITEMS,
): Array<T> {
  const nextKey = getKey(next);
  return [next, ...items.filter((item) => getKey(item) !== nextKey)].slice(0, limit);
}

function getExternalAgentConfigItemKey(item: ExternalAgentConfigMigrationItem): string {
  return `${item.itemType}:${item.cwd ?? "home"}:${item.description}`;
}

function arraysEqual(left: Array<string>, right: Array<string>): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((value, index) => value === right[index]);
}

function getWorkspaceDuplicateHint(
  workspace: WorkspaceRecord,
  workspaces: Array<WorkspaceRecord>,
): string | null {
  if (workspaces.filter((entry) => entry.name === workspace.name).length < 2) {
    return null;
  }

  const segments = splitPathSegments(workspace.absPath);
  const worktreesIndex = segments.lastIndexOf("worktrees");
  if (worktreesIndex >= 0 && segments[worktreesIndex - 1] === ".codex") {
    const worktreeId = segments[worktreesIndex + 1];
    return worktreeId ? `.codex/worktrees/${worktreeId}` : ".codex/worktrees";
  }

  return segments.at(-2) ?? workspace.absPath;
}

export function App() {
  const { t, locale, setLocale } = useAppLocale();
  const queryClient = useQueryClient();

  // Session-aware client: connects via per-session WebSocket (/ws/sessions/:id).
  const codexClient = useActiveClient();
  const isMobile = useIsMobile();

  const connection = useWorkbenchStore((state) => state.connection);
  const activeWorkspaceId = useWorkbenchStore((state) => state.activeWorkspaceId);
  const activeThreadId = useWorkbenchStore((state) => state.activeThreadId);
  const archivedMode = useWorkbenchStore((state) => state.threadLifecycle.archivedMode);
  const threadSummaries = useWorkbenchStore((state) => state.threadSummaries);
  const hydratedThreads = useWorkbenchStore((state) => state.hydratedThreads);
  const gitSnapshotsByWorkspaceId = useWorkbenchStore((state) => state.gitSnapshotsByWorkspaceId);
  const selectedGitFileByWorkspaceId = useWorkbenchStore(
    (state) => state.selectedGitFileByWorkspaceId,
  );
  const pendingApprovals = useWorkbenchStore((state) => state.pendingApprovals);
  const realtimeSessionsByThreadId = useWorkbenchStore((state) => state.realtimeSessionsByThreadId);
  const commandSessions = useWorkbenchStore((state) => state.commandSessions);
  const commandOrder = useWorkbenchStore((state) => state.commandOrder);
  const integrations = useWorkbenchStore((state) => state.integrations);
  const setConnection = useWorkbenchStore((state) => state.setConnection);
  const setActiveWorkspace = useWorkbenchStore((state) => state.setActiveWorkspace);
  const setActiveThread = useWorkbenchStore((state) => state.setActiveThread);
  const setInspectorTab = useWorkbenchStore((state) => state.setInspectorTab);
  const setArchivedMode = useWorkbenchStore((state) => state.setArchivedMode);
  const setSettingsOpen = useWorkbenchStore((state) => state.setSettingsOpen);
  const setSettingsTab = useWorkbenchStore((state) => state.setSettingsTab);
  const syncBootstrapActiveThreads = useWorkbenchStore((state) => state.syncBootstrapActiveThreads);
  const hydrateThread = useWorkbenchStore((state) => state.hydrateThread);
  const upsertThread = useWorkbenchStore((state) => state.upsertThread);
  const markThreadClosed = useWorkbenchStore((state) => state.markThreadClosed);
  const setWorkspaceGitSnapshot = useWorkbenchStore((state) => state.setWorkspaceGitSnapshot);
  const selectWorkspaceGitFile = useWorkbenchStore((state) => state.selectWorkspaceGitFile);
  const renameThreadInStore = useWorkbenchStore((state) => state.renameThread);
  const markThreadArchived = useWorkbenchStore((state) => state.markThreadArchived);
  const applyTurn = useWorkbenchStore((state) => state.applyTurn);
  const applyTimelineItem = useWorkbenchStore((state) => state.applyTimelineItem);
  const setLatestDiff = useWorkbenchStore((state) => state.setLatestDiff);
  const setLatestPlan = useWorkbenchStore((state) => state.setLatestPlan);
  const setReview = useWorkbenchStore((state) => state.setReview);
  const setTurnTokenUsage = useWorkbenchStore((state) => state.setTurnTokenUsage);
  const startRealtimeSession = useWorkbenchStore((state) => state.startRealtimeSession);
  const appendRealtimeItem = useWorkbenchStore((state) => state.appendRealtimeItem);
  const appendRealtimeAudio = useWorkbenchStore((state) => state.appendRealtimeAudio);
  const failRealtimeSession = useWorkbenchStore((state) => state.failRealtimeSession);
  const closeRealtimeSession = useWorkbenchStore((state) => state.closeRealtimeSession);
  const queueApproval = useWorkbenchStore((state) => state.queueApproval);
  const resolveApprovalInStore = useWorkbenchStore((state) => state.resolveApproval);
  const setCommandSession = useWorkbenchStore((state) => state.setCommandSession);
  const appendCommandOutput = useWorkbenchStore((state) => state.appendCommandOutput);
  const appendDelta = useWorkbenchStore((state) => state.appendDelta);
  const appendDeltaBatch = useWorkbenchStore((state) => state.appendDeltaBatch);
  const setIntegrations = useWorkbenchStore((state) => state.setIntegrations);
  const setIntegrationSnapshot = useWorkbenchStore((state) => state.setIntegrationSnapshot);
  const setFuzzySearch = useWorkbenchStore((state) => state.setFuzzySearch);
  const clearFuzzySearch = useWorkbenchStore((state) => state.clearFuzzySearch);
  const touchHydratedThread = useWorkbenchStore((state) => state.touchHydratedThread);
  const sweepHydratedThreads = useWorkbenchStore((state) => state.sweepHydratedThreads);

  // Mobile sidebar: visible when no thread is active or user taps back.
  const [mobileSidebarForced, setMobileSidebarForced] = useState(false);
  const mobileSidebarVisible = isMobile
    ? mobileSidebarForced || !activeThreadId
    : true;

  const [composer, setComposer] = useState("");
  const [workspaceEditor, setWorkspaceEditor] = useState<WorkspaceRecord | null>(null);
  const [workspaceModalOpen, setWorkspaceModalOpen] = useState(false);
  const [codePreview, setCodePreview] = useState<CodeLinkReference | null>(null);
  const [codePreviewVisible, setCodePreviewVisible] = useState(false);
  const [imagePreview, setImagePreview] = useState<ImagePreviewReference | null>(null);
  const [expandedWorkspaceIds, setExpandedWorkspaceIds] = useState<Array<string>>([]);
  const [threadMenuId, setThreadMenuId] = useState<string | null>(null);
  const [settingsNotice, setSettingsNotice] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [commandInput, setCommandInput] = useState("git status");
  const [commandStdin, setCommandStdin] = useState("");
  const [commandCols, setCommandCols] = useState("120");
  const [commandRows, setCommandRows] = useState("30");
  const [workspaceMutationPending, setWorkspaceMutationPending] = useState(false);
  const [workspaceMutationError, setWorkspaceMutationError] = useState<string | null>(null);
  const [accountLoginState, setAccountLoginState] = useState<AccountLoginState | null>(null);
  const [lastAccountLoginCompletion, setLastAccountLoginCompletion] =
    useState<AccountLoginCompleted | null>(null);
  const [configWarnings, setConfigWarnings] = useState<Array<ConfigWarningNotice>>([]);
  const [deprecationNotices, setDeprecationNotices] = useState<Array<DeprecationNotice>>([]);
  const [modelReroutes, setModelReroutes] = useState<Array<ModelRerouteEvent>>([]);
  const [externalAgentConfigItems, setExternalAgentConfigItems] = useState<
    Array<ExternalAgentConfigMigrationItem>
  >([]);
  const [selectedExternalAgentConfigKeys, setSelectedExternalAgentConfigKeys] = useState<
    Array<string>
  >([]);
  const [externalAgentConfigPending, setExternalAgentConfigPending] = useState(false);
  const [completedThreadMarks, setCompletedThreadMarks] = useState<Record<string, true>>({});
  const [relativeTimeNow, setRelativeTimeNow] = useState(() => Date.now());
  const [sidebarWidth, setSidebarWidth] = useState(() => readInitialSidebarWidth());
  const [sidebarResizing, setSidebarResizing] = useState(false);
  const [inspectorWidth, setInspectorWidth] = useState(() => readInitialInspectorWidth());
  const [inspectorResizing, setInspectorResizing] = useState(false);
  const [gitWorkbenchExpanded, setGitWorkbenchExpanded] = useState(false);
  const [gitTreeFilterByWorkspaceId, setGitTreeFilterByWorkspaceId] = useState<Record<string, string>>({});
  const [visibleTimelineCount, setVisibleTimelineCount] = useState(INITIAL_TIMELINE_WINDOW_SIZE);
  const [timelineDeltaVersion, setTimelineDeltaVersion] = useState(0);
  const [streamingPlainItems, setStreamingPlainItems] = useState<Record<string, true>>({});
  const [threadTitleEditing, setThreadTitleEditing] = useState(false);
  const [threadTitleDraft, setThreadTitleDraft] = useState("");
  const [queuedPrompts, setQueuedPrompts] = useState<Record<string, Array<QueuedPrompt>>>({});
  const [composerModel, setComposerModel] = useState("");
  const [composerReasoningEffort, setComposerReasoningEffort] = useState<"" | ReasoningEffort>("");
  const [busyMessage, setBusyMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [gitBranchesByWorkspaceId, setGitBranchesByWorkspaceId] = useState<
    Record<string, Array<GitBranchReference>>
  >({});
  const [gitBranchSwitchPending, setGitBranchSwitchPending] = useState(false);
  const autoOpenedWorkspaceModalRef = useRef(false);
  const codePreviewClearTimerRef = useRef<number | null>(null);
  const sidebarResizeStateRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const sidebarResizeFrameRef = useRef<number | null>(null);
  const liveSidebarWidthRef = useRef(sidebarWidth);
  const inspectorResizeStateRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const inspectorResizeFrameRef = useRef<number | null>(null);
  const liveInspectorWidthRef = useRef(inspectorWidth);
  const desktopShellRef = useRef<HTMLDivElement | null>(null);
  const conversationBodyRef = useRef<HTMLDivElement | null>(null);
  const autoFollowTimelineRef = useRef(true);
  const timelinePrependRestoreRef = useRef<{ previousScrollHeight: number; previousScrollTop: number } | null>(
    null,
  );
  const timelineWindowLoadingRef = useRef(false);
  const streamingPlainItemTimersRef = useRef<Record<string, number>>({});
  const activeThreadIdRef = useRef<string | null>(activeThreadId);
  const previousActiveThreadIdRef = useRef<string | null>(null);
  const previousThreadStatusesRef = useRef<Record<string, ThreadSummary["status"]>>({});
  const queuedDispatchingThreadsRef = useRef(new Set<string>());
  const restoredThreadIdRef = useRef<string | null>(null);
  const remoteSkillsFilters = useMemo(
    () =>
      ({
        hazelnutScope: "personal",
        productSurface: "codex",
        enabled: true,
      }) satisfies {
        hazelnutScope: HazelnutScope;
        productSurface: ProductSurface;
        enabled: boolean;
      },
    [],
  );
  const promptSuggestions = useMemo(() => buildPromptSuggestions(t), [t]);
  const settingsTabs = useMemo(() => buildSettingsTabs(t), [t]);
  const reasoningEffortLabels = useMemo(() => getReasoningEffortLabels(t), [t]);
  const approvalPolicyOptions = useMemo(() => buildApprovalPolicyOptions(t), [t]);
  const sandboxModeOptions = useMemo(() => buildSandboxModeOptions(t), [t]);
  const settingsReasoningEffortOptions = useMemo(
    () => buildSettingsReasoningEffortOptions(t),
    [t],
  );

  const bootstrapQuery = useQuery({
    queryKey: ["bootstrap"],
    queryFn: () => api.bootstrap(),
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const activeThreadsQuery = useQuery({
    queryKey: ["thread-list", "active"],
    queryFn: () =>
      codexClient.call("thread.list", {
        archived: false,
        limit: 500,
      }),
    enabled: connection.connected,
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const archivedThreadsQuery = useInfiniteQuery({
    queryKey: ["thread-list", "archived", activeWorkspaceId],
    queryFn: ({ pageParam }) =>
      codexClient.call("thread.list", {
        archived: true,
        cursor: pageParam ?? null,
        limit: 50,
        workspaceId: activeWorkspaceId,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: connection.connected && integrations.settingsOpen && integrations.settingsTab === "history",
    staleTime: 60_000,
  });

  const integrationsQuery = useQuery({
    queryKey: ["integrations", activeWorkspaceId, activeThreadId],
    queryFn: () =>
      codexClient.call("integrations.refresh", {
        workspaceId: activeWorkspaceId,
        threadId: activeThreadId,
      }),
    enabled: integrations.settingsOpen,
  });

  const remoteSkillsQuery = useQuery({
    queryKey: ["remote-skills", remoteSkillsFilters],
    queryFn: () => codexClient.call("skills.remote.list", remoteSkillsFilters),
    enabled: integrations.settingsOpen && integrations.settingsTab === "extensions",
    staleTime: 60_000,
  });

  const accountRateLimitsQuery = useQuery({
    queryKey: ACCOUNT_RATE_LIMITS_QUERY_KEY,
    queryFn: () => codexClient.call("account.rateLimits.read", {}),
    enabled: integrations.settingsOpen && Boolean(bootstrapQuery.data?.account.authenticated),
    staleTime: 60_000,
  });

  const configRequirementsQuery = useQuery({
    queryKey: CONFIG_REQUIREMENTS_QUERY_KEY,
    queryFn: () => codexClient.call("configRequirements.read", {}),
    enabled: integrations.settingsOpen,
    staleTime: 60_000,
  });

  const codePreviewQuery = useQuery({
    queryKey: ["code-preview", codePreview?.path],
    queryFn: () => api.resourceText(codePreview!.path),
    enabled: Boolean(codePreviewVisible && codePreview?.path),
    staleTime: 30_000,
  });

  useEffect(() => {
    return () => {
      if (codePreviewClearTimerRef.current !== null) {
        window.clearTimeout(codePreviewClearTimerRef.current);
      }
    };
  }, []);

  const bootstrap = bootstrapQuery.data ?? null;
  const account = bootstrap?.account ?? null;
  const accountRateLimits =
    account?.authenticated ? accountRateLimitsQuery.data?.rateLimits ?? null : null;
  const configRequirements = configRequirementsQuery.data?.requirements ?? null;
  const models = bootstrap?.models ?? [];
  const workspaces = bootstrap?.workspaces ?? [];
  const archivedThreadCount = bootstrap?.archivedThreadCount ?? 0;
  const allThreadEntries = useMemo(
    () => Object.values(threadSummaries).sort(sortThreadsDescending),
    [threadSummaries],
  );
  const activeThreadEntries = useMemo(
    () =>
      allThreadEntries.filter((thread) => !thread.archived),
    [allThreadEntries],
  );
  const workspaceIdsWithActiveThreads = useMemo(
    () =>
      new Set(
        activeThreadEntries
          .map((thread) => thread.workspaceId)
          .filter((workspaceId): workspaceId is string => Boolean(workspaceId)),
      ),
    [activeThreadEntries],
  );
  const visibleSidebarWorkspaces = useMemo(
    () =>
      workspaces.filter(
        (workspace) =>
          workspace.source === "saved" || workspaceIdsWithActiveThreads.has(workspace.id),
      ),
    [workspaceIdsWithActiveThreads, workspaces],
  );
  const archivedThreadEntries = useMemo(
    () =>
      (archivedThreadsQuery.data?.pages ?? [])
        .flatMap((page) => page.items)
        .sort(sortThreadsDescending),
    [archivedThreadsQuery.data],
  );
  const workspaceTree = useMemo(
    () =>
      visibleSidebarWorkspaces.map((workspace) => ({
        workspace,
        threads: activeThreadEntries.filter((thread) => thread.workspaceId === workspace.id),
      })),
    [activeThreadEntries, visibleSidebarWorkspaces],
  );
  const sidebarGroups = useMemo(
    () =>
      workspaceTree.map(({ workspace, threads }) => ({
        workspace,
        subtitle: getWorkspaceDuplicateHint(workspace, visibleSidebarWorkspaces),
        active: workspace.id === activeWorkspaceId,
        expanded: expandedWorkspaceIds.includes(workspace.id),
        threads: threads.map((thread) => ({
          thread,
          title: formatThreadTitle(thread) ?? t("workspace.untitledThread"),
          relativeTime: formatRelativeThreadAge(thread.updatedAt, relativeTimeNow),
          absoluteTime: formatAbsoluteDateTime(thread.updatedAt),
          active: thread.id === activeThreadId,
          running: isThreadRunning(thread.status),
          showCompletionMark: Boolean(completedThreadMarks[thread.id]),
          menuOpen: threadMenuId === thread.id,
        })),
      })),
    [
      activeThreadId,
      activeWorkspaceId,
      completedThreadMarks,
      expandedWorkspaceIds,
      relativeTimeNow,
      t,
      threadMenuId,
      visibleSidebarWorkspaces,
      workspaceTree,
    ],
  );
  const selectedWorkspace =
    workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? null;
  const activeThreadEntry =
    (activeThreadId
      ? threadSummaries[activeThreadId] ?? hydratedThreads[activeThreadId]?.thread ?? null
      : null) ?? null;
  const conversationSummaryQuery = useQuery({
    queryKey: [
      "conversation-summary",
      activeThreadEntry?.id ?? null,
      activeThreadEntry?.path ?? null,
      activeThreadEntry?.updatedAt ?? null,
    ],
    queryFn: () =>
      activeThreadEntry?.path
        ? codexClient.call("conversation.summary.read", { rolloutPath: activeThreadEntry.path })
        : codexClient.call("conversation.summary.read", { conversationId: activeThreadEntry!.id }),
    enabled: connection.connected && Boolean(activeThreadEntry),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
  const activeThreadView = activeThreadId ? hydratedThreads[activeThreadId] ?? null : null;
  const selectedWorkspaceForContext =
    selectedWorkspace ??
    (activeThreadEntry?.workspaceId
      ? workspaces.find((workspace) => workspace.id === activeThreadEntry.workspaceId) ?? null
      : null);
  const currentGitWorkspace = selectedWorkspaceForContext;
  const currentGitWorkspaceId = currentGitWorkspace?.id ?? null;
  const searchableWorkspace = selectedWorkspaceForContext;
  const timelineEntryCount = useMemo(() => countTimelineEntries(activeThreadView), [activeThreadView]);
  const timeline = useMemo(
    () => selectTimelineWindow(activeThreadView, visibleTimelineCount),
    [activeThreadView, visibleTimelineCount],
  );
  const hiddenTimelineEntryCount = Math.max(0, timelineEntryCount - timeline.length);
  const latestCommandSession =
    commandOrder.length > 0 ? commandSessions[commandOrder[0]] ?? null : null;
  const activeTurn = activeThreadView ? findActiveTurn(activeThreadView) : null;
  const activeRealtimeSession = activeThreadId
    ? realtimeSessionsByThreadId[activeThreadId] ?? null
    : null;
  const activeThreadArchived = activeThreadView?.archived ?? activeThreadEntry?.archived ?? false;
  const activePlan =
    activeTurn &&
    activeThreadView?.latestPlan &&
    activeThreadView.latestPlan.turnId === activeTurn.turn.id
      ? activeThreadView.latestPlan
      : null;
  const activeGitSnapshot =
    (currentGitWorkspaceId ? gitSnapshotsByWorkspaceId[currentGitWorkspaceId] ?? null : null) ?? null;
  const currentGitBranches = currentGitWorkspaceId
    ? gitBranchesByWorkspaceId[currentGitWorkspaceId] ?? []
    : [];
  const gitFiles = activeGitSnapshot?.files ?? [];
  const reviewThreadId =
    activeThreadEntry && activeThreadEntry.workspaceId === currentGitWorkspaceId
      ? activeThreadEntry.id
      : null;
  const headerWorkspaceLabel = selectedWorkspaceForContext?.name ?? t("toolbar.selectWorkspace");
  const threadTitle = formatThreadTitle(activeThreadEntry) ?? t("toolbar.untitledSession");
  const visibleModels = useMemo(() => models.filter((model) => !model.hidden), [models]);
  const composerModelMap = useMemo(
    () => new Map(visibleModels.map((model) => [model.model, model])),
    [visibleModels],
  );
  const upgradeTargetToBaseModel = useMemo(() => {
    const entries = visibleModels
      .filter((model) => model.upgradeModel)
      .map((model) => [model.upgradeModel!, model] as const);
    return new Map(entries);
  }, [visibleModels]);
  const selectedActualComposerModel = useMemo(
    () =>
      composerModelMap.get(composerModel) ??
      visibleModels.find((model) => model.isDefault) ??
      visibleModels[0] ??
      null,
    [composerModel, visibleModels],
  );
  const selectedBaseComposerModel = useMemo(
    () =>
      (selectedActualComposerModel
        ? upgradeTargetToBaseModel.get(selectedActualComposerModel.model) ?? selectedActualComposerModel
        : null) ??
      null,
    [selectedActualComposerModel, upgradeTargetToBaseModel],
  );
  const composerServiceTier = normalizeServiceTier(
    bootstrap?.settings.config?.serviceTier ?? integrations.config?.serviceTier,
  );
  const composerApprovalPolicy =
    normalizeApprovalPolicy(bootstrap?.settings.config?.approvalPolicy ?? integrations.config?.approvalPolicy) ??
    "on-request";
  const composerSandboxMode =
    normalizeSandboxMode(bootstrap?.settings.config?.sandboxMode ?? integrations.config?.sandboxMode) ??
    "danger-full-access";
  const fastModeEnabled = composerServiceTier === "fast";
  const baseComposerModels = useMemo(
    () =>
      visibleModels.filter((model) => !upgradeTargetToBaseModel.has(model.model)),
    [upgradeTargetToBaseModel, visibleModels],
  );
  const composerModelOptions = useMemo<Array<ComposerDropdownOption<string>>>(
    () =>
      baseComposerModels.map((model) => ({
        value: model.model,
        label: formatModelDisplayName(model),
        testIdSuffix: model.id,
      })),
    [baseComposerModels],
  );
  const composerReasoningOptions = useMemo<Array<ComposerDropdownOption<ReasoningEffort>>>(
    () => buildComposerReasoningOptions(selectedActualComposerModel),
    [selectedActualComposerModel],
  );
  const composerSpeedMode: ComposerSpeedMode = fastModeEnabled ? "fast" : "standard";
  const composerModelLabel =
    (selectedBaseComposerModel ? formatModelDisplayName(selectedBaseComposerModel) : null) ??
    formatModelValue(composerModel) ??
    t("composer.modelMenu");
  const effectiveComposerReasoningEffort = resolveComposerReasoningEffort(
    composerReasoningEffort,
    selectedActualComposerModel,
  );
  const composerReasoningLabel =
    composerReasoningOptions.find((option) => option.value === effectiveComposerReasoningEffort)?.label ??
    formatReasoningEffortLabel(effectiveComposerReasoningEffort);
  const activeQueuedPrompts = activeThreadId ? queuedPrompts[activeThreadId] ?? [] : [];
  const blocking =
    bootstrap !== null &&
    !bootstrap.runtime.authenticated &&
    bootstrap.runtime.requiresOpenaiAuth;
  const toolbarUsageWindows = useMemo(
    () => selectToolbarUsageWindows(account?.usageWindows ?? []),
    [account?.usageWindows],
  );
  const gitSummary = useMemo(() => summarizeGitSnapshot(activeGitSnapshot), [activeGitSnapshot]);
  const currentGitBranchName = activeGitSnapshot?.branch ?? null;
  const gitBranchOptions = useMemo<Array<ComposerDropdownOption<string>>>(() => {
    const names = new Set<string>();
    const entries: Array<GitBranchReference> = [];

    if (currentGitBranchName) {
      entries.push({
        name: currentGitBranchName,
        current: true,
      });
      names.add(currentGitBranchName);
    }

    for (const branch of currentGitBranches) {
      if (names.has(branch.name)) {
        continue;
      }
      names.add(branch.name);
      entries.push(branch);
    }

    return entries.map((branch) => ({
      value: branch.name,
      label: branch.name,
    }));
  }, [currentGitBranchName, currentGitBranches]);
  const toolbarLocaleOptions = useMemo(
    () => [
      { value: "zh-CN" as const, label: t("settings.languageOptions.zhCN"), testIdSuffix: "zh-cn" },
      { value: "en-US" as const, label: t("settings.languageOptions.enUS"), testIdSuffix: "en-us" },
    ],
    [t],
  );
  const currentGitTreeFilter = currentGitWorkspaceId
    ? gitTreeFilterByWorkspaceId[currentGitWorkspaceId] ?? ""
    : "";
  const sidebarBounds = useMemo(
    () =>
      getSidebarWidthBounds(typeof window === "undefined" ? DEFAULT_SIDEBAR_WIDTH * 2 : window.innerWidth),
    [],
  );
  const inspectorBounds = useMemo(
    () =>
      getInspectorWidthBounds(
        typeof window === "undefined" ? DEFAULT_INSPECTOR_WIDTH * 2 : window.innerWidth,
      ),
    [],
  );
  const desktopShellStyle = useMemo(
    () =>
      ({
        "--sidebar-width": `${sidebarWidth}px`,
        "--sidebar-preview-width": `${sidebarWidth}px`,
        "--git-tree-width": `${inspectorWidth}px`,
        minHeight: "100vh",
      }) as CSSProperties,
    [inspectorWidth, sidebarWidth],
  );
  const filteredPaletteActions = useMemo(() => {
    const actions = buildPaletteActions({
      activeThreadEntry,
      archivedMode,
      onNewThread: () => {
        setActiveThread(null);
        setComposer("");
      },
      onToggleArchived: () =>
        setArchivedMode(archivedMode === "archived" ? "active" : "archived"),
      onOpenSettings: () => {
        setSettingsOpen(true);
        setSettingsTab("account");
      },
      onFocusInspector: (tab) => setInspectorTab(tab),
      onOpenWorkspaceModal: openCreateWorkspaceModal,
    });
    const normalizedQuery = paletteQuery.trim().toLowerCase();
    if (!normalizedQuery) {
      return actions;
    }

    return actions.filter((action) =>
      [action.label, action.description].some((field) =>
        field.toLowerCase().includes(normalizedQuery),
      ),
    );
  }, [
    activeThreadEntry,
    archivedMode,
    paletteQuery,
    setActiveThread,
    setArchivedMode,
    setInspectorTab,
    setSettingsOpen,
    setSettingsTab,
  ]);
  const paletteFileResults = useMemo(
    () =>
      adaptFileResults(
        integrations.fuzzySearch.results,
        searchableWorkspace?.absPath ?? activeThreadEntry?.cwd ?? "",
      ),
    [activeThreadEntry?.cwd, integrations.fuzzySearch.results, searchableWorkspace?.absPath],
  );

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setRelativeTimeNow(Date.now());
    }, 60_000);

    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    if (
      !accountLoginState ||
      accountLoginState.phase !== "pending" ||
      (accountLoginState.method !== "chatgpt" && accountLoginState.method !== "deviceCode")
    ) {
      return;
    }

    let cancelled = false;
    const intervalId = window.setInterval(() => {
      void (async () => {
        try {
          if (
            accountLoginState.method === "deviceCode" &&
            accountLoginState.expiresAt !== null &&
            Date.now() >= accountLoginState.expiresAt
          ) {
            if (!cancelled) {
              setAccountLoginState((current) =>
                current && current.loginId === accountLoginState.loginId
                  ? {
                      ...current,
                      phase: "failed",
                      error: t("settings.deviceCodeExpired"),
                    }
                  : current,
              );
            }
            return;
          }
          const response = await codexClient.call("account.read", {});
          if (cancelled) {
            return;
          }
          applyAccountResult(response);
          if (response.state.account.authenticated) {
            setAccountLoginState(null);
            setSettingsNotice(
              t(
                accountLoginState.method === "deviceCode"
                  ? "settings.notices.deviceCodeLoginSuccess"
                  : "settings.notices.chatgptLoginSuccess",
              ),
            );
          }
        } catch {
          // Keep polling until the user cancels or runtime notifies completion.
        }
      })();
    }, 2500);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [accountLoginState, t]);

  useEffect(() => {
    const handleResize = () => {
      setSidebarWidth((current) => clampSidebarWidth(current, window.innerWidth));
      setInspectorWidth((current) => clampInspectorWidth(current, window.innerWidth));
    };

    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    liveSidebarWidthRef.current = sidebarWidth;
    desktopShellRef.current?.style.setProperty("--sidebar-width", `${sidebarWidth}px`);
    desktopShellRef.current?.style.setProperty("--sidebar-preview-width", `${sidebarWidth}px`);
    window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(sidebarWidth));
  }, [sidebarWidth]);

  useEffect(() => {
    liveInspectorWidthRef.current = inspectorWidth;
    desktopShellRef.current?.style.setProperty("--git-tree-width", `${inspectorWidth}px`);
    window.localStorage.setItem(INSPECTOR_WIDTH_STORAGE_KEY, String(inspectorWidth));
  }, [inspectorWidth]);

  useEffect(() => {
    if (!sidebarResizing) {
      return;
    }

    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const handlePointerMove = (event: PointerEvent) => {
      const state = sidebarResizeStateRef.current;
      if (!state) {
        return;
      }

      const nextWidth = clampSidebarWidth(
        state.startWidth + event.clientX - state.startX,
        window.innerWidth,
      );
      liveSidebarWidthRef.current = nextWidth;

      if (sidebarResizeFrameRef.current !== null) {
        return;
      }

      sidebarResizeFrameRef.current = window.requestAnimationFrame(() => {
        sidebarResizeFrameRef.current = null;
        desktopShellRef.current?.style.setProperty(
          "--sidebar-preview-width",
          `${liveSidebarWidthRef.current}px`,
        );
      });
    };

    const stopResizing = () => {
      if (sidebarResizeFrameRef.current !== null) {
        window.cancelAnimationFrame(sidebarResizeFrameRef.current);
        sidebarResizeFrameRef.current = null;
      }

      setSidebarWidth(liveSidebarWidthRef.current);
      sidebarResizeStateRef.current = null;
      setSidebarResizing(false);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopResizing);
    window.addEventListener("pointercancel", stopResizing);

    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      if (sidebarResizeFrameRef.current !== null) {
        window.cancelAnimationFrame(sidebarResizeFrameRef.current);
        sidebarResizeFrameRef.current = null;
      }
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopResizing);
      window.removeEventListener("pointercancel", stopResizing);
    };
  }, [sidebarResizing]);

  useEffect(() => {
    if (!inspectorResizing) {
      return;
    }

    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const handlePointerMove = (event: PointerEvent) => {
      const state = inspectorResizeStateRef.current;
      if (!state) {
        return;
      }

      const nextWidth = clampInspectorWidth(
        state.startWidth + (state.startX - event.clientX),
        window.innerWidth,
      );
      liveInspectorWidthRef.current = nextWidth;

      if (inspectorResizeFrameRef.current !== null) {
        return;
      }

      inspectorResizeFrameRef.current = window.requestAnimationFrame(() => {
        inspectorResizeFrameRef.current = null;
        desktopShellRef.current?.style.setProperty(
          "--git-tree-width",
          `${liveInspectorWidthRef.current}px`,
        );
      });
    };

    const stopResizing = () => {
      if (inspectorResizeFrameRef.current !== null) {
        window.cancelAnimationFrame(inspectorResizeFrameRef.current);
        inspectorResizeFrameRef.current = null;
      }

      setInspectorWidth(liveInspectorWidthRef.current);
      inspectorResizeStateRef.current = null;
      setInspectorResizing(false);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopResizing);
    window.addEventListener("pointercancel", stopResizing);

    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      if (inspectorResizeFrameRef.current !== null) {
        window.cancelAnimationFrame(inspectorResizeFrameRef.current);
        inspectorResizeFrameRef.current = null;
      }
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopResizing);
      window.removeEventListener("pointercancel", stopResizing);
    };
  }, [inspectorResizing]);

  const markStreamingItems = useCallback(
    (
      entries: Array<{
        threadId: string;
        itemId: string;
        kind: TimelineEntry["kind"];
      }>,
    ) => {
      const activeId = activeThreadIdRef.current;
      const nextItemIds = entries
        .filter(
          (entry) =>
            entry.threadId === activeId &&
            (entry.kind === "agentMessage" || entry.kind === "reasoning"),
        )
        .map((entry) => entry.itemId);

      if (nextItemIds.length === 0) {
        return;
      }

      setTimelineDeltaVersion((current) => current + 1);
      setStreamingPlainItems((current) => {
        const next = { ...current };
        for (const itemId of nextItemIds) {
          next[itemId] = true;
        }
        return next;
      });

      for (const itemId of nextItemIds) {
        const existingTimer = streamingPlainItemTimersRef.current[itemId];
        if (existingTimer !== undefined) {
          window.clearTimeout(existingTimer);
        }
        streamingPlainItemTimersRef.current[itemId] = window.setTimeout(() => {
          delete streamingPlainItemTimersRef.current[itemId];
          setStreamingPlainItems((current) => {
            if (!current[itemId]) {
              return current;
            }
            const next = { ...current };
            delete next[itemId];
            return next;
          });
        }, 220);
      }
    },
    [],
  );

  useEffect(() => {
    void codexClient.connect();
    const dispatcher = createWorkbenchMessageDispatcher({
      queryClient,
      setConnection,
      upsertThread,
      markThreadClosed,
      applyTurn,
      applyTimelineItem,
      appendDelta,
      appendDeltaBatch,
      setLatestDiff,
      setLatestPlan,
      setReview,
      setTurnTokenUsage,
      startRealtimeSession,
      appendRealtimeItem,
      appendRealtimeAudio,
      failRealtimeSession,
      closeRealtimeSession,
      setWorkspaceGitSnapshot,
      queueApproval,
      resolveApproval: resolveApprovalInStore,
      setCommandSession,
      appendCommandOutput,
      setIntegrations,
      setIntegrationSnapshot,
      onAccountLoginCompleted: (params) => {
        setLastAccountLoginCompletion(params.login);
        applyAccountResult({
          state: params.state,
          snapshot: params.snapshot,
        });
        void queryClient.invalidateQueries({ queryKey: ACCOUNT_RATE_LIMITS_QUERY_KEY });
        if (params.login.success) {
          setAccountLoginState(null);
          setSettingsNotice(
            t(
              accountLoginState?.method === "deviceCode"
                ? "settings.notices.deviceCodeLoginSuccess"
                : "settings.notices.chatgptLoginSuccess",
            ),
          );
          return;
        }

        setAccountLoginState((current) =>
          current && (!params.login.loginId || current.loginId === params.login.loginId)
            ? {
                ...current,
                phase: "failed",
                error: params.login.error ?? t("settings.notices.loginFailed"),
              }
            : current,
        );
        setSettingsNotice(params.login.error ?? t("settings.notices.loginFailed"));
      },
      onModelRerouted: (reroute) => {
        setModelReroutes((current) =>
          prependDistinctByKey(
            current,
            reroute,
            (entry) =>
              `${entry.threadId}:${entry.turnId}:${entry.fromModel}:${entry.toModel}:${entry.reason}`,
          ),
        );
      },
      onConfigWarning: (warning) => {
        setConfigWarnings((current) =>
          prependDistinctByKey(
            current,
            warning,
            (entry) =>
              `${entry.summary}:${entry.path ?? ""}:${entry.range?.start.line ?? 0}:${entry.range?.start.column ?? 0}`,
          ),
        );
      },
      onDeprecationNotice: (notice) => {
        setDeprecationNotices((current) =>
          prependDistinctByKey(current, notice, (entry) => `${entry.summary}:${entry.details ?? ""}`),
        );
      },
      onTimelineDeltaFlush: (entries) => {
        markStreamingItems(entries);
      },
    });
    const unsubscribeMessages = codexClient.subscribe((message) => {
      dispatcher.dispatch(message);
    });
    const unsubscribeConnection = codexClient.onConnectionChange((connected) => {
      setConnection({ connected });
      if (connected) {
        void invalidateBootstrap();
      }
    });

    return () => {
      dispatcher.dispose();
      unsubscribeMessages();
      unsubscribeConnection();
    };
  }, [
    accountLoginState,
    appendCommandOutput,
    appendDelta,
    appendDeltaBatch,
    appendRealtimeAudio,
    appendRealtimeItem,
    applyTimelineItem,
    applyTurn,
    closeRealtimeSession,
    codexClient.connect,
    codexClient.subscribe,
    codexClient.onConnectionChange,
    codexClient.sessionId,
    failRealtimeSession,
    markThreadClosed,
    markStreamingItems,
    queryClient,
    queueApproval,
    resolveApprovalInStore,
    setCommandSession,
    setConnection,
    setIntegrations,
    setConfigWarnings,
    setDeprecationNotices,
    setIntegrationSnapshot,
    setLastAccountLoginCompletion,
    setLatestDiff,
    setLatestPlan,
    setModelReroutes,
    setReview,
    setTurnTokenUsage,
    setWorkspaceGitSnapshot,
    startRealtimeSession,
    t,
    upsertThread,
  ]);

  useEffect(() => {
    const seenThreadIds = new Set(allThreadEntries.map((thread) => thread.id));
    setCompletedThreadMarks((current) => {
      let changed = false;
      const next = { ...current };

      for (const thread of allThreadEntries) {
        const previousStatus = previousThreadStatusesRef.current[thread.id];
        const wasRunning = isThreadRunning(previousStatus);
        const isRunning = isThreadRunning(thread.status);

        if (wasRunning && !isRunning && activeThreadId !== thread.id && !next[thread.id]) {
          next[thread.id] = true;
          changed = true;
        }

        if ((activeThreadId === thread.id || isRunning) && next[thread.id]) {
          delete next[thread.id];
          changed = true;
        }

        previousThreadStatusesRef.current[thread.id] = thread.status;
      }

      for (const threadId of Object.keys(previousThreadStatusesRef.current)) {
        if (!seenThreadIds.has(threadId)) {
          delete previousThreadStatusesRef.current[threadId];
        }
      }

      for (const threadId of Object.keys(next)) {
        if (!seenThreadIds.has(threadId)) {
          delete next[threadId];
          changed = true;
        }
      }

      return changed ? next : current;
    });
  }, [activeThreadId, allThreadEntries]);

  useEffect(() => {
    setThreadTitleEditing(false);
    setThreadTitleDraft(formatThreadTitle(activeThreadEntry) ?? "");
  }, [activeThreadEntry?.id, activeThreadEntry?.name, activeThreadEntry?.preview]);

  useEffect(() => {
    const nextModel =
      selectedWorkspaceForContext?.defaultModel ??
      integrations.config?.model ??
      bootstrap?.settings.config?.model ??
      visibleModels.find((model) => model.isDefault)?.model ??
      "";
    setComposerModel(nextModel);
  }, [
    bootstrap?.settings.config?.model,
    integrations.config?.model,
    selectedWorkspaceForContext?.defaultModel,
    selectedWorkspaceForContext?.id,
    visibleModels,
  ]);

  useEffect(() => {
    const nextReasoningEffort =
      normalizeReasoningEffort(integrations.config?.reasoningEffort) ??
      normalizeReasoningEffort(bootstrap?.settings.config?.reasoningEffort) ??
      "";
    setComposerReasoningEffort(nextReasoningEffort);
  }, [bootstrap?.settings.config?.reasoningEffort, integrations.config?.reasoningEffort]);

  useEffect(() => {
    if (!composerReasoningEffort || !selectedActualComposerModel) {
      return;
    }

    const supportedEfforts = new Set(
      selectedActualComposerModel.supportedReasoningEfforts.map((option) => option.reasoningEffort),
    );
    if (!supportedEfforts.has(composerReasoningEffort)) {
      setComposerReasoningEffort(selectedActualComposerModel.defaultReasoningEffort);
    }
  }, [composerReasoningEffort, selectedActualComposerModel]);

  useEffect(() => {
    setVisibleTimelineCount(INITIAL_TIMELINE_WINDOW_SIZE);
    timelinePrependRestoreRef.current = null;
    timelineWindowLoadingRef.current = false;
    autoFollowTimelineRef.current = true;
    activeThreadIdRef.current = activeThreadId;
    setStreamingPlainItems({});
    setTimelineDeltaVersion(0);
    for (const timerId of Object.values(streamingPlainItemTimersRef.current)) {
      window.clearTimeout(timerId);
    }
    streamingPlainItemTimersRef.current = {};
  }, [activeThreadId]);

  useEffect(() => {
    activeThreadIdRef.current = activeThreadId;
  }, [activeThreadId]);

  const latestTimelineEntry = timeline.length > 0 ? timeline[timeline.length - 1] ?? null : null;

  useLayoutEffect(() => {
    const pendingRestore = timelinePrependRestoreRef.current;
    const container = conversationBodyRef.current;
    if (!pendingRestore || !container) {
      return;
    }

    const deltaHeight = container.scrollHeight - pendingRestore.previousScrollHeight;
    container.scrollTop = pendingRestore.previousScrollTop + deltaHeight;
    timelinePrependRestoreRef.current = null;
    timelineWindowLoadingRef.current = false;
  }, [timeline.length]);

  useEffect(
    () => () => {
      for (const timerId of Object.values(streamingPlainItemTimersRef.current)) {
        window.clearTimeout(timerId);
      }
      streamingPlainItemTimersRef.current = {};
    },
    [],
  );

  useLayoutEffect(() => {
    const container = conversationBodyRef.current;
    if (!container) {
      return;
    }

    const threadChanged = previousActiveThreadIdRef.current !== activeThreadId;
    previousActiveThreadIdRef.current = activeThreadId;

    if (!threadChanged && !autoFollowTimelineRef.current) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      const target = conversationBodyRef.current;
      if (!target) {
        return;
      }

      target.scrollTo({
        top: target.scrollHeight,
        behavior: "auto",
      });
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [
    activeThreadId,
    timeline.length,
    latestTimelineEntry?.id,
    timelineDeltaVersion,
    activeTurn?.turn.id,
    activeTurn?.turn.status,
  ]);

  const loadOlderTimelineEntries = useCallback((): void => {
    const container = conversationBodyRef.current;
    if (
      !container ||
      hiddenTimelineEntryCount === 0 ||
      timelineWindowLoadingRef.current
    ) {
      return;
    }

    timelineWindowLoadingRef.current = true;
    timelinePrependRestoreRef.current = {
      previousScrollHeight: container.scrollHeight,
      previousScrollTop: container.scrollTop,
    };
    setVisibleTimelineCount((current) =>
      Math.min(timelineEntryCount, current + TIMELINE_WINDOW_BATCH_SIZE),
    );
  }, [hiddenTimelineEntryCount, timelineEntryCount]);

  const handleConversationScroll = useCallback((): void => {
    const container = conversationBodyRef.current;
    if (!container) {
      return;
    }

    autoFollowTimelineRef.current = isNearBottom(container);
    if (
      container.scrollTop <= TIMELINE_WINDOW_SCROLL_THRESHOLD &&
      hiddenTimelineEntryCount > 0
    ) {
      loadOlderTimelineEntries();
    }
  }, [hiddenTimelineEntryCount, loadOlderTimelineEntries]);

  useEffect(() => {
    if (!bootstrap) {
      return;
    }

    setConnection(bootstrap.runtime);
    syncBootstrapActiveThreads(bootstrap.activeThreads);
  }, [bootstrap, setConnection, syncBootstrapActiveThreads]);

  useEffect(() => {
    const activeThreadPage = activeThreadsQuery.data;
    if (!activeThreadPage) {
      return;
    }

    syncBootstrapActiveThreads(activeThreadPage.items);
  }, [activeThreadsQuery.data, syncBootstrapActiveThreads]);

  useEffect(() => {
    if (!bootstrap) {
      return;
    }

    setExpandedWorkspaceIds((current) => {
      const validIds = current.filter((id) =>
        visibleSidebarWorkspaces.some((workspace) => workspace.id === id),
      );
      const nextIds =
        validIds.length > 0
          ? validIds
          : visibleSidebarWorkspaces.map((workspace) => workspace.id);
      return arraysEqual(current, nextIds) ? current : nextIds;
    });

    if (activeWorkspaceId !== "all" && workspaces.some((workspace) => workspace.id === activeWorkspaceId)) {
      return;
    }

    if (visibleSidebarWorkspaces[0]) {
      setActiveWorkspace(visibleSidebarWorkspaces[0].id);
      return;
    }

    setActiveWorkspace("all");
  }, [activeWorkspaceId, bootstrap, setActiveWorkspace, visibleSidebarWorkspaces, workspaces]);

  useEffect(() => {
    if (!bootstrap || workspaceModalOpen || autoOpenedWorkspaceModalRef.current || blocking) {
      return;
    }

    if (workspaces.length === 0) {
      autoOpenedWorkspaceModalRef.current = true;
      openCreateWorkspaceModal();
    }
  }, [blocking, bootstrap, workspaceModalOpen, workspaces.length]);

  useEffect(() => {
    if (!connection.connected || !currentGitWorkspaceId) {
      return;
    }

    let cancelled = false;
    void Promise.all([
      codexClient.call("workspace.git.read", {
        workspaceId: currentGitWorkspaceId,
      }),
      codexClient.call("workspace.git.branches.read", {
        workspaceId: currentGitWorkspaceId,
      }),
    ])
      .then(([gitResponse, branchResponse]) => {
        if (!cancelled) {
          setWorkspaceGitSnapshot(gitResponse.snapshot);
          setGitBranchesByWorkspaceId((current) => ({
            ...current,
            [currentGitWorkspaceId]: branchResponse.branches,
          }));
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setErrorMessage(localizeErrorWithFallback(error, "errors.requestFailed"));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [connection.connected, connection.restartCount, currentGitWorkspaceId, setWorkspaceGitSnapshot]);

  useEffect(() => {
    if (!currentGitWorkspaceId) {
      setGitWorkbenchExpanded(false);
    }
  }, [currentGitWorkspaceId]);

  useEffect(() => {
    if (!bootstrap || !activeThreadId) {
      restoredThreadIdRef.current = null;
      return;
    }

    if (hydratedThreads[activeThreadId]?.turnOrder.length) {
      restoredThreadIdRef.current = null;
      return;
    }

    const summary = threadSummaries[activeThreadId] ?? null;
    if (!summary || restoredThreadIdRef.current === activeThreadId) {
      return;
    }

    restoredThreadIdRef.current = activeThreadId;
    if (summary.workspaceId) {
      setActiveWorkspace(summary.workspaceId);
    }

    setBusyMessage(t("composer.busy.resumingThread"));
    void runAction(async () => {
      const response = await codexClient.call("thread.read", {
        threadId: activeThreadId,
      });
      hydrateThread(response.thread);
    });
  }, [
    activeThreadId,
    bootstrap,
    hydrateThread,
    hydratedThreads,
    setActiveWorkspace,
    threadSummaries,
  ]);

  useEffect(() => {
    if (!archivedThreadEntries.length) {
      return;
    }

    for (const thread of archivedThreadEntries) {
      upsertThread(thread);
    }
  }, [archivedThreadEntries, upsertThread]);

  useEffect(() => {
    if (activeThreadId) {
      touchHydratedThread(activeThreadId);
    }
    sweepHydratedThreads(activeThreadId);
  }, [
    activeThreadId,
    hydratedThreads,
    pendingApprovals,
    sweepHydratedThreads,
    touchHydratedThread,
  ]);

  useEffect(() => {
    const snapshot = integrationsQuery.data?.snapshot;
    if (snapshot) {
      setIntegrationSnapshot(snapshot);
    }
  }, [integrationsQuery.data, setIntegrationSnapshot]);

  useEffect(() => {
    if (!paletteOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPaletteOpen(false);
        setPaletteQuery("");
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [paletteOpen]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen(true);
      }

      if (event.key === "Escape") {
        setThreadMenuId(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    if (!gitWorkbenchExpanded) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setGitWorkbenchExpanded(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [gitWorkbenchExpanded]);

  useEffect(() => {
    if (!paletteOpen || !searchableWorkspace) {
      return;
    }

    const normalizedQuery = paletteQuery.trim();
    if (!normalizedQuery) {
      clearFuzzySearch();
      return;
    }

    setFuzzySearch({
      query: normalizedQuery,
      status: "loading",
      results: [],
    });

    let cancelled = false;
    const timerId = window.setTimeout(() => {
      void codexClient
        .call("workspace.searchFiles", {
          workspaceId: searchableWorkspace.id,
          query: normalizedQuery,
        })
        .then((response) => {
          if (!cancelled) {
            setFuzzySearch(response.search);
          }
        })
        .catch((error) => {
          if (!cancelled) {
            setErrorMessage(localizeErrorWithFallback(error, "errors.requestFailed"));
          }
        });
    }, 160);

    return () => {
      cancelled = true;
      window.clearTimeout(timerId);
    };
  }, [
    clearFuzzySearch,
    paletteOpen,
    paletteQuery,
    searchableWorkspace,
    setFuzzySearch,
  ]);

  useEffect(() => {
    for (const [threadId, queue] of Object.entries(queuedPrompts)) {
      if (!queue.length || queuedDispatchingThreadsRef.current.has(threadId)) {
        continue;
      }

      const threadView = hydratedThreads[threadId];
      if (!threadView || findActiveTurn(threadView)) {
        continue;
      }

      const nextPrompt = queue[0];
      queuedDispatchingThreadsRef.current.add(threadId);

      void codexClient
        .call("turn.start", {
          threadId,
          prompt: nextPrompt.text,
        })
        .then((response) => {
          applyTurn(threadId, response.turn);
          setQueuedPrompts((current) => removeQueuedPrompt(current, threadId, nextPrompt.id));
        })
        .catch((error) => {
          setErrorMessage(localizeErrorWithFallback(error, "errors.requestFailed"));
        })
        .finally(() => {
          queuedDispatchingThreadsRef.current.delete(threadId);
        });
    }
  }, [applyTurn, hydratedThreads, queuedPrompts]);

  function openCreateWorkspaceModal(): void {
    setWorkspaceEditor(null);
    setWorkspaceMutationError(null);
    setWorkspaceModalOpen(true);
  }

  function openEditWorkspaceModal(workspace: WorkspaceRecord): void {
    setWorkspaceEditor(workspace);
    setWorkspaceMutationError(null);
    setWorkspaceModalOpen(true);
  }

  function closeWorkspaceModal(): void {
    setWorkspaceEditor(null);
    setWorkspaceMutationError(null);
    setWorkspaceMutationPending(false);
    setWorkspaceModalOpen(false);
  }

  const openCodePreview = useCallback((reference: CodeLinkReference): void => {
    if (codePreviewClearTimerRef.current !== null) {
      window.clearTimeout(codePreviewClearTimerRef.current);
      codePreviewClearTimerRef.current = null;
    }
    setCodePreview(reference);
    setCodePreviewVisible(true);
  }, []);

  function closeCodePreview(): void {
    setCodePreviewVisible(false);
    if (codePreviewClearTimerRef.current !== null) {
      window.clearTimeout(codePreviewClearTimerRef.current);
    }
    codePreviewClearTimerRef.current = window.setTimeout(() => {
      setCodePreview(null);
      codePreviewClearTimerRef.current = null;
    }, 0);
  }

  const openImagePreview = useCallback((reference: ImagePreviewReference): void => {
    setImagePreview(reference);
  }, []);

  function closeImagePreview(): void {
    setImagePreview(null);
  }

  function handleWorkspaceSelect(workspaceId: string | "all"): void {
    setActiveWorkspace(workspaceId);
    if (workspaceId !== "all") {
      setExpandedWorkspaceIds((current) =>
        current.includes(workspaceId) ? current : [...current, workspaceId],
      );
    }
  }

  function handleSidebarResizeStart(event: ReactPointerEvent<HTMLDivElement>): void {
    event.currentTarget.setPointerCapture?.(event.pointerId);
    sidebarResizeStateRef.current = {
      startX: event.clientX,
      startWidth: sidebarWidth,
    };
    liveSidebarWidthRef.current = sidebarWidth;
    desktopShellRef.current?.style.setProperty("--sidebar-preview-width", `${sidebarWidth}px`);
    setSidebarResizing(true);
  }

  function handleSidebarResizeKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
      return;
    }

    event.preventDefault();
    const delta = event.key === "ArrowLeft" ? -18 : 18;
    setSidebarWidth((current) => clampSidebarWidth(current + delta, window.innerWidth));
  }

  function handleInspectorResizeStart(event: ReactPointerEvent<HTMLDivElement>): void {
    event.currentTarget.setPointerCapture?.(event.pointerId);
    inspectorResizeStateRef.current = {
      startX: event.clientX,
      startWidth: inspectorWidth,
    };
    liveInspectorWidthRef.current = inspectorWidth;
    setInspectorResizing(true);
  }

  function handleInspectorResizeKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
      return;
    }

    event.preventDefault();
    const delta = event.key === "ArrowLeft" ? 18 : -18;
    setInspectorWidth((current) => clampInspectorWidth(current + delta, window.innerWidth));
  }

  async function runAction(action: () => Promise<void>): Promise<void> {
    setErrorMessage(null);
    try {
      await action();
    } catch (error) {
      setErrorMessage(localizeErrorWithFallback(error, "errors.requestFailed"));
    } finally {
      setBusyMessage(null);
    }
  }

  async function invalidateBootstrap(): Promise<void> {
    await queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
  }

  async function handleWorkspaceSubmit(input: WorkspaceFormInput): Promise<void> {
    setWorkspaceMutationError(null);
    try {
      const pathCheck = await api.workspacePathSuggestions(input.absPath);
      if (!pathCheck.withinHome) {
        setWorkspaceMutationError(
          t("workspace.outsideHomeInline", { homePath: pathCheck.homePath }),
        );
        return;
      }

      if (!pathCheck.isDirectory) {
        setWorkspaceMutationError(t("workspace.invalidDirectoryInline"));
        return;
      }

      const duplicateWorkspace = workspaces.find(
        (workspace) =>
          workspace.absPath === pathCheck.resolvedPath &&
          workspace.id !== workspaceEditor?.id,
      );
      if (duplicateWorkspace) {
        setActiveWorkspace(duplicateWorkspace.id);
        closeWorkspaceModal();
        setBusyMessage(t("workspace.duplicateSwitched", { name: duplicateWorkspace.name }));
        return;
      }

      const payload = {
        name: input.name.trim(),
        absPath: pathCheck.resolvedPath,
        defaultModel: input.defaultModel ?? null,
        approvalPolicy: input.approvalPolicy ?? "on-request",
        sandboxMode: input.sandboxMode ?? "danger-full-access",
      };

      setWorkspaceMutationPending(true);
      const workspace =
        workspaceEditor && workspaceEditor.source === "saved"
          ? await api.updateWorkspace(workspaceEditor.id, payload)
          : await api.createWorkspace(payload);
      setActiveWorkspace(workspace.id);
      closeWorkspaceModal();
      void invalidateBootstrap();
    } catch (error) {
      const message =
        error instanceof Error ? localizeError(error) : t("workspace.saveFailed");
      if (message.includes("workspaces.abs_path")) {
        closeWorkspaceModal();
        void invalidateBootstrap();
        return;
      }

      setWorkspaceMutationError(message);
    } finally {
      setWorkspaceMutationPending(false);
    }
  }

  async function handleDeleteWorkspace(): Promise<void> {
    if (!workspaceEditor) {
      return;
    }

    setWorkspaceMutationError(null);
    setWorkspaceMutationPending(true);
    try {
      if (workspaceEditor.source === "derived") {
        await api.dismissWorkspace({ absPath: workspaceEditor.absPath });
      } else {
        await api.deleteWorkspace(workspaceEditor.id);
      }

      if (activeWorkspaceId === workspaceEditor.id) {
        setActiveWorkspace("all");
      }
      closeWorkspaceModal();
      void invalidateBootstrap();
    } catch (error) {
      setWorkspaceMutationError(error instanceof Error ? localizeError(error) : t("workspace.deleteFailed"));
      setWorkspaceMutationPending(false);
    }
  }

  async function openThread(workspaceId = selectedWorkspaceForContext?.id ?? null): Promise<void> {
    if (!workspaceId) {
      return;
    }

    setBusyMessage(t("composer.busy.creatingThread"));
    await runAction(async () => {
      const response = await codexClient.call("thread.open", { workspaceId });
      hydrateThread(response.thread);
      setActiveWorkspace(workspaceId);
      setActiveThread(response.thread.thread.id);
      setInspectorTab("diff");
      if (isMobile) setMobileSidebarForced(false);
    });
  }

  async function handleResumeThread(threadId: string, workspaceId?: string | null): Promise<void> {
    setThreadMenuId(null);
    if (workspaceId) {
      setActiveWorkspace(workspaceId);
    }
    setActiveThread(threadId);
    if (isMobile) setMobileSidebarForced(false);

    if (hydratedThreads[threadId]?.turnOrder.length) {
      return;
    }

    setBusyMessage(t("composer.busy.resumingThread"));
    await runAction(async () => {
      const response = await codexClient.call("thread.read", {
        threadId,
      });
      hydrateThread(response.thread);
    });
  }

  async function ensureLoadedThread(threadId: string): Promise<string> {
    const summary = threadSummaries[threadId] ?? hydratedThreads[threadId]?.thread ?? null;
    if (summary?.status.type !== "notLoaded") {
      return threadId;
    }

    const response = await codexClient.call("thread.resume", {
      threadId,
    });
    hydrateThread(response.thread);
    return response.thread.thread.id;
  }

  async function ensureThreadForPrompt(): Promise<string | null> {
    if (activeThreadId) {
      return ensureLoadedThread(activeThreadId);
    }

    const workspaceId = selectedWorkspaceForContext?.id ?? null;
    if (!workspaceId) {
      return null;
    }

    const response = await codexClient.call("thread.open", { workspaceId });
    hydrateThread(response.thread);
    setActiveWorkspace(workspaceId);
    setActiveThread(response.thread.thread.id);
    return response.thread.thread.id;
  }

  async function startPromptTurn(threadId: string, prompt: string): Promise<void> {
    const response = await codexClient.call("turn.start", {
      threadId,
      prompt,
      effort: effectiveComposerReasoningEffort,
    });
    applyTurn(threadId, response.turn);
  }

  async function handleSendMessage(): Promise<void> {
    if (!composer.trim()) {
      return;
    }

    const prompt = composer.trim();
    const existingActiveThreadId = activeThreadId;
    const existingActiveQueue =
      existingActiveThreadId ? queuedPrompts[existingActiveThreadId] ?? [] : [];

    if (existingActiveThreadId && (Boolean(activeTurn) || existingActiveQueue.length > 0)) {
      setQueuedPrompts((current) => appendQueuedPrompt(current, existingActiveThreadId, prompt));
      setComposer("");
      return;
    }

    setBusyMessage(t("composer.busy.startingTurn"));
    await runAction(async () => {
      const threadId = await ensureThreadForPrompt();
      if (!threadId) {
        throw new Error(t("workspace.createThreadPrompt"));
      }

      if ((queuedPrompts[threadId] ?? []).length > 0) {
        setQueuedPrompts((current) => appendQueuedPrompt(current, threadId, prompt));
        setComposer("");
        return;
      }

      await startPromptTurn(threadId, prompt);
      setComposer("");
    });
  }

  async function handleRefreshWorkspaceGit(): Promise<void> {
    if (!currentGitWorkspaceId) {
      return;
    }

    setBusyMessage(t("composer.busy.refreshingGit"));
    await runAction(async () => {
      const response = await codexClient.call("workspace.git.read", {
        workspaceId: currentGitWorkspaceId,
      });
      setWorkspaceGitSnapshot(response.snapshot);
    });
  }

  async function handleGitBranchChange(branch: string): Promise<void> {
    if (
      !currentGitWorkspaceId ||
      !activeGitSnapshot?.isGitRepository ||
      branch === currentGitBranchName
    ) {
      return;
    }

    setBusyMessage(t("composer.busy.switchingBranch", { branch }));
    setErrorMessage(null);
    setGitBranchSwitchPending(true);

    try {
      const response = await codexClient.call("workspace.git.branch.switch", {
        workspaceId: currentGitWorkspaceId,
        branch,
      });
      setWorkspaceGitSnapshot(response.snapshot);
      setGitBranchesByWorkspaceId((current) => ({
        ...current,
        [currentGitWorkspaceId]: response.branches,
      }));
    } catch (error) {
      setErrorMessage(localizeErrorWithFallback(error, "errors.requestFailed"));
    } finally {
      setBusyMessage(null);
      setGitBranchSwitchPending(false);
    }
  }

  async function handleRunReview(): Promise<void> {
    if (!reviewThreadId) {
      return;
    }

    setBusyMessage(t("composer.reviewStart"));
    await runAction(async () => {
      await ensureLoadedThread(reviewThreadId);
      const response = await codexClient.call("review.start", {
        threadId: reviewThreadId,
      });
      if (response.turn) {
        applyTurn(reviewThreadId, response.turn);
      }
    });
  }

  async function handleInterrupt(): Promise<void> {
    if (!activeThreadId || !activeTurn) {
      return;
    }

    setBusyMessage(t("composer.busy.interruptingTurn"));
    await runAction(async () => {
      await codexClient.call("turn.interrupt", {
        threadId: activeThreadId,
        turnId: activeTurn.turn.id,
      });
    });
  }

  async function handleRenameThread(
    thread: ThreadSummary,
    requestedName?: string,
  ): Promise<void> {
    const currentTitle = formatThreadTitle(thread) ?? t("workspace.untitledThread");
    const rawName = requestedName ?? window.prompt(t("workspace.renamePrompt"), currentTitle) ?? "";
    const nextName = rawName.trim();
    if (!nextName) {
      if (requestedName !== undefined) {
        setThreadTitleEditing(false);
        setThreadTitleDraft(currentTitle);
      }
      return;
    }
    if (nextName === currentTitle) {
      setThreadTitleEditing(false);
      return;
    }

    setBusyMessage(t("composer.busy.renamingThread"));
    let renamed = false;
    await runAction(async () => {
      await codexClient.call("thread.rename", {
        threadId: thread.id,
        name: nextName,
      });
      renameThreadInStore(thread.id, nextName);
      renamed = true;
    });
    if (renamed) {
      setThreadTitleEditing(false);
    }
  }

  async function handleReadGitFileDetail(path: string) {
    if (!currentGitWorkspaceId) {
      throw new Error(t("git.noCurrentProjectDetail"));
    }

    const response = await codexClient.call("workspace.git.file.read", {
      workspaceId: currentGitWorkspaceId,
      path,
    });
    return response.detail;
  }

  async function handleReadGitDiffToRemote(): Promise<GitRemoteDiffSnapshot> {
    if (!currentGitWorkspace) {
      throw new Error(t("git.noCurrentProjectDetail"));
    }

    const response = await codexClient.call("git.diffToRemote", {
      cwd: currentGitWorkspace.absPath,
    });
    return response.diff;
  }

  async function handleForkThread(thread: ThreadSummary): Promise<void> {
    setBusyMessage(t("composer.busy.forkingThread"));
    await runAction(async () => {
      const response = await codexClient.call("thread.fork", {
        threadId: thread.id,
      });
      hydrateThread(response.thread);
      setActiveThread(response.thread.thread.id);
      if (response.thread.thread.workspaceId) {
        setActiveWorkspace(response.thread.thread.workspaceId);
      }
    });
  }

  async function handleArchiveThread(thread: ThreadSummary): Promise<void> {
    setBusyMessage(
      thread.archived ? t("composer.busy.unarchivingThread") : t("composer.busy.archivingThread"),
    );
    await runAction(async () => {
      if (thread.archived) {
        const response = await codexClient.call("thread.unarchive", {
          threadId: thread.id,
        });
        hydrateThread(response.thread);
        markThreadArchived(thread.id, false);
        setArchivedMode("active");
      } else {
        await codexClient.call("thread.archive", {
          threadId: thread.id,
        });
        markThreadArchived(thread.id, true);
        if (activeThreadId === thread.id) {
          setArchivedMode("archived");
        }
      }
      await queryClient.invalidateQueries({ queryKey: ["archived-thread-summaries"] });
    });
  }

  async function handleUnarchiveThread(thread: ThreadSummary): Promise<void> {
    setBusyMessage(t("composer.busy.unarchivingThread"));
    await runAction(async () => {
      const response = await codexClient.call("thread.unarchive", {
        threadId: thread.id,
      });
      hydrateThread(response.thread);
      markThreadArchived(thread.id, false);
      setArchivedMode("active");
      await queryClient.invalidateQueries({ queryKey: ["archived-thread-summaries"] });
    });
  }

  async function handleCompactThread(threadId: string): Promise<void> {
    setBusyMessage(t("composer.busy.compactingThread"));
    await runAction(async () => {
      await codexClient.call("thread.compact", {
        threadId,
      });
    });
  }

  async function handleComposerModelChange(nextModel: string): Promise<void> {
    const normalizedModel = nextModel || null;
    const baseConfig = bootstrap?.settings.config ?? integrations.config ?? null;
    const nextBaseModelOption =
      composerModelMap.get(nextModel) ??
      baseComposerModels.find((model) => model.isDefault) ??
      baseComposerModels[0] ??
      null;
    const nextActualModel = nextBaseModelOption?.model ?? normalizedModel;
    const nextModelOption =
      (nextActualModel ? composerModelMap.get(nextActualModel) : null) ??
      selectedActualComposerModel;
    const nextReasoningEffort = resolveComposerReasoningEffort(
      normalizeReasoningEffort(baseConfig?.reasoningEffort) ?? composerReasoningEffort,
      nextModelOption,
    );
    setComposerModel(nextActualModel ?? "");
    setComposerReasoningEffort(nextReasoningEffort);
    setBusyMessage(t("composer.busy.switchingModel"));
    await runAction(async () => {
      const response = await codexClient.call("settings.save", {
        model: nextActualModel ?? null,
        reasoningEffort: nextReasoningEffort,
        serviceTier: baseConfig?.serviceTier ?? null,
        approvalPolicy: baseConfig?.approvalPolicy ?? null,
        sandboxMode: baseConfig?.sandboxMode ?? null,
        forcedLoginMethod: baseConfig?.forcedLoginMethod ?? null,
      });
      setIntegrationSnapshot(response.snapshot);
      patchBootstrapCache(queryClient, (current) => ({
        ...current,
        settings: {
          ...current.settings,
          config: {
            model: nextActualModel ?? null,
            reasoningEffort: nextReasoningEffort,
            serviceTier: baseConfig?.serviceTier ?? null,
            approvalPolicy: baseConfig?.approvalPolicy ?? null,
            sandboxMode: baseConfig?.sandboxMode ?? null,
            forcedLoginMethod: baseConfig?.forcedLoginMethod ?? null,
          },
        },
      }));

      if (selectedWorkspaceForContext?.source === "saved") {
        const updatedWorkspace = await api.updateWorkspace(selectedWorkspaceForContext.id, {
          defaultModel: normalizedModel,
        });
        patchBootstrapCache(queryClient, (current) => ({
          ...current,
          workspaces: current.workspaces.map((workspace) =>
            workspace.id === updatedWorkspace.id ? updatedWorkspace : workspace,
          ),
        }));
      }
    });
  }

  async function handleComposerSpeedChange(nextSpeed: ComposerSpeedMode): Promise<void> {
    if (nextSpeed === composerSpeedMode) {
      return;
    }

    const baseConfig = bootstrap?.settings.config ?? integrations.config ?? null;
    const nextActualModel = selectedActualComposerModel?.model ?? composerModel ?? null;
    const nextServiceTier: ServiceTier | null = nextSpeed === "fast" ? "fast" : null;
    const nextModelOption = (nextActualModel ? composerModelMap.get(nextActualModel) : null) ?? selectedActualComposerModel;
    const nextReasoningEffort = resolveComposerReasoningEffort(
      composerReasoningEffort,
      nextModelOption,
    );

    setComposerModel(nextActualModel ?? "");
    setComposerReasoningEffort(nextReasoningEffort);
    setBusyMessage(
      nextSpeed === "fast"
        ? t("composer.busy.switchingSpeedFast")
        : t("composer.busy.switchingSpeedStandard"),
    );
    await runAction(async () => {
      const response = await codexClient.call("settings.save", {
        model: nextActualModel,
        reasoningEffort: nextReasoningEffort,
        serviceTier: nextServiceTier,
        approvalPolicy: baseConfig?.approvalPolicy ?? null,
        sandboxMode: baseConfig?.sandboxMode ?? null,
        forcedLoginMethod: baseConfig?.forcedLoginMethod ?? null,
      });
      setIntegrationSnapshot(response.snapshot);
      patchBootstrapCache(queryClient, (current) => ({
        ...current,
        settings: {
          ...current.settings,
          config: {
            model: nextActualModel,
            reasoningEffort: nextReasoningEffort,
            serviceTier: nextServiceTier,
            approvalPolicy: baseConfig?.approvalPolicy ?? null,
            sandboxMode: baseConfig?.sandboxMode ?? null,
            forcedLoginMethod: baseConfig?.forcedLoginMethod ?? null,
          },
        },
      }));

      if (selectedWorkspaceForContext?.source === "saved") {
      const updatedWorkspace = await api.updateWorkspace(selectedWorkspaceForContext.id, {
          defaultModel: nextActualModel,
      });
        patchBootstrapCache(queryClient, (current) => ({
          ...current,
          workspaces: current.workspaces.map((workspace) =>
            workspace.id === updatedWorkspace.id ? updatedWorkspace : workspace,
          ),
        }));
      }
    });
  }

  async function handleComposerReasoningEffortChange(nextEffort: ReasoningEffort): Promise<void> {
    const baseConfig = bootstrap?.settings.config ?? integrations.config ?? null;
    setComposerReasoningEffort(nextEffort);
    setBusyMessage(t("composer.busy.switchingReasoning"));
    await runAction(async () => {
      const response = await codexClient.call("settings.save", {
        model: baseConfig?.model ?? null,
        reasoningEffort: nextEffort,
        serviceTier: baseConfig?.serviceTier ?? null,
        approvalPolicy: baseConfig?.approvalPolicy ?? null,
        sandboxMode: baseConfig?.sandboxMode ?? null,
        forcedLoginMethod: baseConfig?.forcedLoginMethod ?? null,
      });
      setIntegrationSnapshot(response.snapshot);
      patchBootstrapCache(queryClient, (current) => ({
        ...current,
        settings: {
          ...current.settings,
          config: {
            model: baseConfig?.model ?? null,
            reasoningEffort: nextEffort,
            serviceTier: baseConfig?.serviceTier ?? null,
            approvalPolicy: baseConfig?.approvalPolicy ?? null,
            sandboxMode: baseConfig?.sandboxMode ?? null,
            forcedLoginMethod: baseConfig?.forcedLoginMethod ?? null,
          },
        },
      }));
    });
  }

  async function handleComposerApprovalPolicyChange(nextPolicy: EditableApprovalPolicy): Promise<void> {
    const baseConfig = bootstrap?.settings.config ?? integrations.config ?? null;
    setBusyMessage(t("composer.busy.switchingApproval"));
    await runAction(async () => {
      const response = await codexClient.call("settings.save", {
        model: baseConfig?.model ?? null,
        reasoningEffort: normalizeReasoningEffort(baseConfig?.reasoningEffort) ?? effectiveComposerReasoningEffort,
        serviceTier: baseConfig?.serviceTier ?? null,
        approvalPolicy: nextPolicy,
        sandboxMode: baseConfig?.sandboxMode ?? null,
        forcedLoginMethod: baseConfig?.forcedLoginMethod ?? null,
      });
      setIntegrationSnapshot(response.snapshot);
      patchBootstrapCache(queryClient, (current) => ({
        ...current,
        settings: {
          ...current.settings,
          config: {
            model: baseConfig?.model ?? null,
            reasoningEffort:
              normalizeReasoningEffort(baseConfig?.reasoningEffort) ?? effectiveComposerReasoningEffort,
            serviceTier: baseConfig?.serviceTier ?? null,
            approvalPolicy: nextPolicy,
            sandboxMode: baseConfig?.sandboxMode ?? null,
            forcedLoginMethod: baseConfig?.forcedLoginMethod ?? null,
          },
        },
      }));
    });
  }

  async function handleComposerSandboxModeChange(nextMode: EditableSandboxMode): Promise<void> {
    const baseConfig = bootstrap?.settings.config ?? integrations.config ?? null;
    setBusyMessage(t("composer.busy.switchingSandbox"));
    await runAction(async () => {
      const response = await codexClient.call("settings.save", {
        model: baseConfig?.model ?? null,
        reasoningEffort: normalizeReasoningEffort(baseConfig?.reasoningEffort) ?? effectiveComposerReasoningEffort,
        serviceTier: baseConfig?.serviceTier ?? null,
        approvalPolicy: baseConfig?.approvalPolicy ?? null,
        sandboxMode: nextMode,
        forcedLoginMethod: baseConfig?.forcedLoginMethod ?? null,
      });
      setIntegrationSnapshot(response.snapshot);
      patchBootstrapCache(queryClient, (current) => ({
        ...current,
        settings: {
          ...current.settings,
          config: {
            model: baseConfig?.model ?? null,
            reasoningEffort:
              normalizeReasoningEffort(baseConfig?.reasoningEffort) ?? effectiveComposerReasoningEffort,
            serviceTier: baseConfig?.serviceTier ?? null,
            approvalPolicy: baseConfig?.approvalPolicy ?? null,
            sandboxMode: nextMode,
            forcedLoginMethod: baseConfig?.forcedLoginMethod ?? null,
          },
        },
      }));
    });
  }

  async function handleRunCommand(): Promise<void> {
    if (!searchableWorkspace || !commandInput.trim()) {
      return;
    }

    setBusyMessage(t("composer.busy.startingCommand"));
    await runAction(async () => {
      const response = await codexClient.call("command.start", {
        workspaceId: searchableWorkspace.id,
        command: commandInput.trim(),
        cols: sanitizeTerminalSize(commandCols, 120),
        rows: sanitizeTerminalSize(commandRows, 30),
      });
      setCommandSession(response.session);
      setInspectorTab("command");
    });
  }

  async function handleSendCommandInput(): Promise<void> {
    if (!latestCommandSession || !commandStdin) {
      return;
    }

    await runAction(async () => {
      await codexClient.call("command.write", {
        processId: latestCommandSession.processId,
        text: commandStdin,
      });
      setCommandStdin("");
    });
  }

  async function handleResizeCommand(): Promise<void> {
    if (!latestCommandSession) {
      return;
    }

    await runAction(async () => {
      await codexClient.call("command.resize", {
        processId: latestCommandSession.processId,
        cols: sanitizeTerminalSize(commandCols, 120),
        rows: sanitizeTerminalSize(commandRows, 30),
      });
    });
  }

  async function handleTerminateCommand(): Promise<void> {
    if (!latestCommandSession) {
      return;
    }

    await runAction(async () => {
      await codexClient.call("command.stop", {
        processId: latestCommandSession.processId,
      });
    });
  }

  async function handleResolveServerRequest(
    resolution: ServerRequestResolveInput,
  ): Promise<void> {
    await runAction(async () => {
      await codexClient.call("serverRequest.resolve", resolution);
      resolveApprovalInStore(resolution.requestId);
    });
  }

  async function handleConfigSave(payload: ConfigSnapshot): Promise<void> {
    setBusyMessage(t("composer.busy.savingSettings"));
    await runAction(async () => {
      const response = await codexClient.call("settings.save", payload);
      setIntegrationSnapshot(response.snapshot);
      setSettingsNotice(t("settings.notices.defaultsSaved"));
      await invalidateBootstrap();
    });
  }

  async function handleRefreshIntegrations(): Promise<void> {
    setBusyMessage(t("composer.busy.refreshingIntegrations"));
    await runAction(async () => {
      const response = await codexClient.call("integrations.refresh", {
        workspaceId: activeWorkspaceId,
        threadId: activeThreadId,
      });
      setIntegrationSnapshot(response.snapshot);
      setSettingsNotice(t("settings.notices.integrationsRefreshed"));
    });
  }

  async function handleMcpLogin(name: string): Promise<void> {
    setBusyMessage(t("composer.busy.openingLogin", { name }));
    await runAction(async () => {
      const response = await codexClient.call("integrations.mcp.login", {
        name,
      });
      window.open(response.authorizationUrl, "_blank", "noopener,noreferrer");
    });
  }

  async function handleMcpReload(): Promise<void> {
    setBusyMessage(t("composer.busy.reloadingMcp"));
    await runAction(async () => {
      const response = await codexClient.call("integrations.mcp.reload", {});
      setIntegrationSnapshot(response.snapshot);
      setSettingsNotice(t("settings.notices.mcpReloaded"));
    });
  }

  async function handleRefreshMcpServers(): Promise<void> {
    setBusyMessage(t("composer.busy.refreshingMcpServers"));
    await runAction(async () => {
      const response = await codexClient.call("mcpServerStatus.list", {});
      setIntegrations({ mcpServers: response.servers });
      setSettingsNotice(t("settings.notices.mcpServersRefreshed"));
    });
  }

  async function handleRefreshSkills(): Promise<void> {
    setBusyMessage(t("composer.busy.refreshingSkills"));
    await runAction(async () => {
      const response = await codexClient.call("skills.list", {
        workspaceId: activeWorkspaceId,
      });
      setIntegrations({ skills: response.skills });
      setSettingsNotice(t("settings.notices.skillsRefreshed"));
    });
  }

  async function handleRemoteSkillsRefresh(): Promise<void> {
    setBusyMessage(t("composer.busy.refreshingSkills"));
    await runAction(async () => {
      await remoteSkillsQuery.refetch();
      setSettingsNotice(t("settings.notices.remoteSkillsRefreshed"));
    });
  }

  async function handleRemoteSkillExport(hazelnutId: string): Promise<void> {
    setBusyMessage(t("composer.busy.exportingSkill"));
    await runAction(async () => {
      const response = await codexClient.call("skills.remote.export", {
        hazelnutId,
        workspaceId: activeWorkspaceId,
      });
      setIntegrations({ skills: response.skills });
      await remoteSkillsQuery.refetch();
      setSettingsNotice(t("settings.notices.remoteSkillExported", { path: response.skill.path }));
    });
  }

  async function handleSkillConfigWrite(path: string, enabled: boolean): Promise<void> {
    setBusyMessage(t("composer.busy.updatingSkill"));
    await runAction(async () => {
      const response = await codexClient.call("skills.config.write", {
        path,
        enabled,
        workspaceId: activeWorkspaceId,
      });
      setIntegrations({ skills: response.skills });
      setSettingsNotice(
        t(
          response.effectiveEnabled
            ? "settings.notices.skillEnabled"
            : "settings.notices.skillDisabled",
        ),
      );
    });
  }

  async function handleRefreshApps(): Promise<void> {
    setBusyMessage(t("composer.busy.refreshingApps"));
    await runAction(async () => {
      const response = await codexClient.call("app.list", {
        threadId: activeThreadId,
        forceRefetch: true,
      });
      setIntegrations({ apps: response.apps });
      setSettingsNotice(t("settings.notices.appsRefreshed"));
    });
  }

  async function handleRefreshPlugins(): Promise<void> {
    setBusyMessage(t("composer.busy.refreshingPlugins"));
    await runAction(async () => {
      const response = await codexClient.call("plugin.list", {
        workspaceId: activeWorkspaceId,
      });
      setIntegrations({ plugins: response.marketplaces });
      setSettingsNotice(t("settings.notices.pluginsRefreshed"));
    });
  }

  async function handlePluginInstall(marketplacePath: string, pluginName: string): Promise<void> {
    setBusyMessage(t("composer.busy.installingPlugin"));
    await runAction(async () => {
      const response = await codexClient.call("plugin.install", {
        marketplacePath,
        pluginName,
        workspaceId: activeWorkspaceId,
        threadId: activeThreadId,
      });
      setIntegrations({
        plugins: response.marketplaces,
        apps: response.apps,
      });
      setSettingsNotice(
        response.appsNeedingAuth.length > 0
          ? t("settings.notices.pluginInstalledAuthRequired", {
              apps: response.appsNeedingAuth.map((app) => app.name).join(", "),
            })
          : t("settings.notices.pluginInstalled"),
      );
    });
  }

  async function handlePluginUninstall(pluginId: string): Promise<void> {
    setBusyMessage(t("composer.busy.uninstallingPlugin"));
    await runAction(async () => {
      const response = await codexClient.call("plugin.uninstall", {
        pluginId,
        workspaceId: activeWorkspaceId,
        threadId: activeThreadId,
      });
      setIntegrations({
        plugins: response.marketplaces,
        apps: response.apps,
      });
      setSettingsNotice(t("settings.notices.pluginUninstalled"));
    });
  }

  function applyAccountResult(input: {
    state: AccountStateSnapshot;
    snapshot: IntegrationSnapshot;
  }): void {
    setIntegrationSnapshot(input.snapshot);
    patchBootstrapCache(queryClient, (current) => ({
      ...current,
      account: input.state.account,
    }));
    if (!input.state.account.authenticated) {
      queryClient.removeQueries({ queryKey: ACCOUNT_RATE_LIMITS_QUERY_KEY, exact: true });
    }
  }

  async function handleAccountRefresh(): Promise<void> {
    await runAction(async () => {
      const response = await codexClient.call("account.read", {});
      applyAccountResult(response);
      if (response.state.account.authenticated) {
        await queryClient.invalidateQueries({ queryKey: ACCOUNT_RATE_LIMITS_QUERY_KEY });
      }
      setSettingsNotice(t("settings.notices.accountRefreshed"));
    });
  }

  async function handleChatgptLogin(): Promise<void> {
    await runAction(async () => {
      const response = await codexClient.call("account.login.start", {
        type: "chatgpt",
      });
      applyAccountResult(response);
      if (response.login.type === "chatgpt") {
        window.open(response.login.authUrl, "_blank", "noopener,noreferrer");
        setLastAccountLoginCompletion(null);
        setAccountLoginState({
          method: "chatgpt",
          loginId: response.login.loginId,
          authUrlOpened: true,
          verificationUrl: response.login.authUrl,
          userCode: null,
          expiresAt: null,
          phase: "pending",
          error: null,
        });
        setSettingsNotice(t("settings.notices.chatgptLoginPending"));
      }
    });
  }

  async function handleDeviceCodeLogin(): Promise<void> {
    await runAction(async () => {
      const response = await codexClient.call("account.login.start", {
        type: "deviceCode",
      });
      applyAccountResult(response);
      if (response.login.type === "deviceCode") {
        setLastAccountLoginCompletion(null);
        setAccountLoginState({
          method: "deviceCode",
          loginId: response.login.loginId,
          authUrlOpened: false,
          verificationUrl: response.login.verificationUrl,
          userCode: response.login.userCode,
          expiresAt: response.login.expiresAt,
          phase: "pending",
          error: null,
        });
        setSettingsNotice(t("settings.notices.deviceCodeLoginPending"));
      }
    });
  }

  async function handleApiKeyLogin(apiKey: string): Promise<boolean> {
    let success = false;
    await runAction(async () => {
      const response = await codexClient.call("account.login.start", {
        type: "apiKey",
        apiKey,
      });
      applyAccountResult(response);
      await queryClient.invalidateQueries({ queryKey: ACCOUNT_RATE_LIMITS_QUERY_KEY });
      setLastAccountLoginCompletion(null);
      setAccountLoginState(null);
      setSettingsNotice(t("settings.notices.apiKeyLoginSuccess"));
      success = true;
    });
    return success;
  }

  async function handleChatgptTokensLogin(input: {
    accessToken: string;
    chatgptAccountId: string;
    chatgptPlanType?: string | null;
  }): Promise<boolean> {
    let success = false;
    await runAction(async () => {
      const response = await codexClient.call("account.login.start", {
        type: "chatgptAuthTokens",
        accessToken: input.accessToken,
        chatgptAccountId: input.chatgptAccountId,
        chatgptPlanType: input.chatgptPlanType ?? null,
      });
      applyAccountResult(response);
      await queryClient.invalidateQueries({ queryKey: ACCOUNT_RATE_LIMITS_QUERY_KEY });
      setLastAccountLoginCompletion(null);
      setAccountLoginState(null);
      setSettingsNotice(t("settings.notices.tokensLoginSuccess"));
      success = true;
    });
    return success;
  }

  async function handleCancelChatgptLogin(): Promise<void> {
    const loginId = accountLoginState?.loginId;
    if (!loginId) {
      return;
    }

    await runAction(async () => {
      const response = await codexClient.call("account.login.cancel", {
        loginId,
      });
      applyAccountResult(response);
      setLastAccountLoginCompletion(null);
      setAccountLoginState(null);
      setSettingsNotice(
        response.status === "canceled"
          ? t("settings.notices.loginCanceled")
          : t("settings.notices.loginCancelNotFound"),
      );
    });
  }

  async function handleAccountLogout(): Promise<void> {
    await runAction(async () => {
      const response = await codexClient.call("account.logout", {});
      applyAccountResult(response);
      setLastAccountLoginCompletion(null);
      setAccountLoginState(null);
      setSettingsNotice(t("settings.notices.loggedOut"));
    });
  }

  async function handleDetectExternalAgentConfig(): Promise<void> {
    setBusyMessage(t("composer.busy.detectingExternalAgentConfig"));
    setExternalAgentConfigPending(true);
    await runAction(async () => {
      const response = await codexClient.call("externalAgentConfig.detect", {
        includeHome: true,
        cwds: selectedWorkspaceForContext ? [selectedWorkspaceForContext.absPath] : null,
      });
      setExternalAgentConfigItems(response.items);
      setSelectedExternalAgentConfigKeys(response.items.map(getExternalAgentConfigItemKey));
      setSettingsNotice(
        response.items.length > 0
          ? t("settings.notices.externalAgentConfigDetected", { count: response.items.length })
          : t("settings.notices.externalAgentConfigEmpty"),
      );
    }).finally(() => {
      setExternalAgentConfigPending(false);
    });
  }

  function handleToggleExternalAgentConfigItem(item: ExternalAgentConfigMigrationItem): void {
    const key = getExternalAgentConfigItemKey(item);
    setSelectedExternalAgentConfigKeys((current) =>
      current.includes(key) ? current.filter((entry) => entry !== key) : [...current, key],
    );
  }

  async function handleImportExternalAgentConfig(): Promise<void> {
    const selectedItems = externalAgentConfigItems.filter((item) =>
      selectedExternalAgentConfigKeys.includes(getExternalAgentConfigItemKey(item)),
    );
    if (selectedItems.length === 0) {
      return;
    }

    setBusyMessage(t("composer.busy.importingExternalAgentConfig"));
    setExternalAgentConfigPending(true);
    await runAction(async () => {
      await codexClient.call("externalAgentConfig.import", {
        migrationItems: selectedItems,
      });
      const refresh = await codexClient.call("integrations.refresh", {
        workspaceId: activeWorkspaceId,
        threadId: activeThreadId,
      });
      setIntegrationSnapshot(refresh.snapshot);
      await queryClient.invalidateQueries({ queryKey: CONFIG_REQUIREMENTS_QUERY_KEY });
      await queryClient.invalidateQueries({ queryKey: ACCOUNT_RATE_LIMITS_QUERY_KEY });
      setSettingsNotice(
        t("settings.notices.externalAgentConfigImported", { count: selectedItems.length }),
      );
    }).finally(() => {
      setExternalAgentConfigPending(false);
    });
  }

  function handlePaletteAction(action: PaletteAction): void {
    setPaletteOpen(false);
    setPaletteQuery("");
    action.run();
  }

  if (bootstrapQuery.isLoading && !bootstrap) {
    return (
      <div className="desktop-shell" data-testid="desktop-shell" style={desktopShellStyle}>
        <div className="workbench-shell workbench-shell--loading" style={{ gridColumn: "1 / -1" }}>
          <div className="conversation-ready">
            <p className="conversation-empty__eyebrow">{t("shell.loadingEyebrow")}</p>
            <h2>{t("shell.loadingTitle")}</h2>
            <p>{t("shell.loadingBody")}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="desktop-shell"
      data-testid="desktop-shell"
      ref={desktopShellRef}
      style={desktopShellStyle}
    >
      {isMobile && (
        <div
          className={`mobile-drawer-overlay${mobileSidebarVisible ? " mobile-drawer-overlay--visible" : ""}`}
          onClick={() => setMobileSidebarForced(false)}
        />
      )}

      <WorkbenchSidebar
        className={isMobile ? (mobileSidebarVisible ? "sidebar-shell--open" : undefined) : undefined}
        visibleWorkspaceCount={visibleSidebarWorkspaces.length}
        workspaceGroups={sidebarGroups}
        activeWorkspaceId={activeWorkspaceId}
        emptyProjects={workspaceTree.length === 0}
        emptyThreads={workspaceTree.length > 0 && workspaceTree.every((group) => group.threads.length === 0)}
        onSelectAll={() => handleWorkspaceSelect("all")}
        onCreateWorkspace={openCreateWorkspaceModal}
        onSelectWorkspace={handleWorkspaceSelect}
        onComposeWorkspace={(workspaceId) => void openThread(workspaceId)}
        onEditWorkspace={openEditWorkspaceModal}
        onResumeThread={(threadId, workspaceId) => void handleResumeThread(threadId, workspaceId)}
        onToggleThreadMenu={(threadId) =>
          setThreadMenuId((current) => (current === threadId ? null : threadId))
        }
        onRenameThread={(thread) => void handleRenameThread(thread)}
        onForkThread={(thread) => void handleForkThread(thread)}
        onArchiveThread={(thread) => void handleArchiveThread(thread)}
      />

      <div
        className={sidebarResizing ? "sidebar-resizer sidebar-resizer--active" : "sidebar-resizer"}
        data-testid="sidebar-resizer"
        role="separator"
        tabIndex={0}
        aria-label={t("sidebar.resizeSidebar")}
        aria-orientation="vertical"
        aria-valuemin={sidebarBounds.min}
        aria-valuemax={sidebarBounds.max}
        aria-valuenow={Math.round(sidebarWidth)}
        onPointerDown={handleSidebarResizeStart}
        onKeyDown={handleSidebarResizeKeyDown}
      />
      <div
        aria-hidden="true"
        className={
          sidebarResizing
            ? "sidebar-resize-guide sidebar-resize-guide--active"
            : "sidebar-resize-guide"
        }
      />

      <div className="workbench-shell">
        <WorkbenchHeader
          headerWorkspaceLabel={headerWorkspaceLabel}
          threadTitle={threadTitle}
          activeThreadEntry={activeThreadEntry}
          conversationSummary={conversationSummaryQuery.data?.summary ?? null}
          threadTitleEditing={threadTitleEditing}
          threadTitleDraft={threadTitleDraft}
          toolbarUsageWindows={toolbarUsageWindows}
          composerSpeedMode={composerSpeedMode}
          locale={locale}
          toolbarLocaleOptions={toolbarLocaleOptions}
          isMobile={isMobile}
          onMobileBack={() => setMobileSidebarForced(true)}
          onThreadTitleDraftChange={setThreadTitleDraft}
          onCommitThreadTitle={() => {
            if (activeThreadEntry) {
              void handleRenameThread(activeThreadEntry, threadTitleDraft);
            }
          }}
          onCancelThreadTitle={() => {
            setThreadTitleEditing(false);
            setThreadTitleDraft(formatThreadTitle(activeThreadEntry) ?? "");
          }}
          onStartThreadTitleEdit={() => {
            setThreadTitleDraft(threadTitle);
            setThreadTitleEditing(true);
          }}
          onToggleSpeed={() =>
            void handleComposerSpeedChange(composerSpeedMode === "fast" ? "standard" : "fast")
          }
          onLocaleChange={setLocale}
          onOpenSettings={() => {
            setSettingsOpen(true);
            setSettingsTab("account");
            setSettingsNotice(null);
          }}
        />

        <div className="window-body">
          <ConversationPane
            gitWorkbenchExpanded={gitWorkbenchExpanded}
            gitReviewPanel={
              <Suspense fallback={<GitReviewPanelLoadingState />}>
                <LazyGitReviewPanel
                  workspace={currentGitWorkspace}
                  snapshot={activeGitSnapshot}
                  selectedPath={
                    currentGitWorkspaceId
                      ? selectedGitFileByWorkspaceId[currentGitWorkspaceId] ?? null
                      : null
                  }
                  treeFilter={currentGitTreeFilter}
                  treeWidth={inspectorWidth}
                  treeBounds={inspectorBounds}
                  treeResizing={inspectorResizing}
                  onClose={() => setGitWorkbenchExpanded(false)}
                  onSelectFile={(path) => {
                    if (!currentGitWorkspaceId) {
                      return;
                    }
                    selectWorkspaceGitFile(currentGitWorkspaceId, path);
                  }}
                  onTreeFilterChange={(nextValue) => {
                    if (!currentGitWorkspaceId) {
                      return;
                    }
                    setGitTreeFilterByWorkspaceId((current) => ({
                      ...current,
                      [currentGitWorkspaceId]: nextValue,
                    }));
                  }}
                  onRefresh={() => void handleRefreshWorkspaceGit()}
                  onReadFileDetail={handleReadGitFileDetail}
                  onReadRemoteDiff={handleReadGitDiffToRemote}
                  onResizeStart={handleInspectorResizeStart}
                  onResizeKeyDown={handleInspectorResizeKeyDown}
                />
              </Suspense>
            }
            selectedWorkspaceForContext={selectedWorkspaceForContext}
            activeThreadId={activeThreadId}
            activeThreadView={activeThreadView}
            activeThreadEntry={activeThreadEntry}
            activeThreadTitle={threadTitle}
            activeThreadArchived={activeThreadArchived}
            timeline={timeline}
            hiddenTimelineEntryCount={hiddenTimelineEntryCount}
            timelineEntryCount={timelineEntryCount}
            cwd={activeThreadEntry?.cwd ?? selectedWorkspaceForContext?.absPath ?? null}
            streamingPlainItems={streamingPlainItems}
            realtimeSession={activeRealtimeSession}
            composerPane={
              <ComposerPane
                composer={composer}
                activeTurn={activeTurn}
                selectedWorkspaceForContext={selectedWorkspaceForContext}
                activeThreadId={activeThreadId}
                composerModelValue={selectedBaseComposerModel?.model ?? composerModel}
                composerModelLabel={composerModelLabel}
                composerModelOptions={composerModelOptions}
                composerReasoningValue={effectiveComposerReasoningEffort}
                composerReasoningLabel={composerReasoningLabel}
                composerReasoningOptions={composerReasoningOptions}
                composerApprovalPolicy={composerApprovalPolicy}
                composerApprovalPolicyLabel={formatApprovalPolicy(composerApprovalPolicy)}
                approvalPolicyOptions={approvalPolicyOptions}
                composerSandboxMode={composerSandboxMode}
                composerSandboxModeLabel={formatSandboxMode(composerSandboxMode)}
                sandboxModeOptions={sandboxModeOptions}
                currentGitWorkspace={currentGitWorkspace}
                gitSummary={gitSummary}
                currentGitBranchName={currentGitBranchName}
                gitBranchOptions={gitBranchOptions}
                gitBranchSwitchPending={gitBranchSwitchPending}
                activeGitSnapshot={activeGitSnapshot}
                activePlan={activePlan}
                queuedPrompts={activeQueuedPrompts}
                onComposerChange={setComposer}
                onKeyDown={(event) => {
                  if (event.nativeEvent.isComposing) {
                    return;
                  }

                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void handleSendMessage();
                  }
                }}
                onModelChange={(value) => void handleComposerModelChange(value)}
                onReasoningChange={(value) => void handleComposerReasoningEffortChange(value)}
                onApprovalPolicyChange={(value) => void handleComposerApprovalPolicyChange(value)}
                onSandboxModeChange={(value) => void handleComposerSandboxModeChange(value)}
                onGitBranchChange={(branch) => void handleGitBranchChange(branch)}
                onOpenReview={() => setGitWorkbenchExpanded(true)}
                onInterrupt={() => void handleInterrupt()}
                onSend={() => void handleSendMessage()}
              />
            }
            conversationBodyRef={conversationBodyRef}
            onConversationScroll={handleConversationScroll}
            onCodeLinkActivate={openCodePreview}
            onImageActivate={openImagePreview}
            onLoadOlder={loadOlderTimelineEntries}
            onCreateWorkspace={openCreateWorkspaceModal}
            onSuggestionClick={setComposer}
          />
          <RightRail requests={pendingApprovals} onResolve={handleResolveServerRequest} />
        </div>
      </div>

      <WorkbenchOverlays
        workspaceModal={
          workspaceModalOpen ? (
            <WorkspaceModal
              initialValue={workspaceEditor}
              models={models}
              submitting={workspaceMutationPending}
              submitError={workspaceMutationError}
              onClose={closeWorkspaceModal}
              onDelete={workspaceEditor ? () => void handleDeleteWorkspace() : undefined}
              deleteLabel={workspaceEditor?.source === "derived" ? t("common.remove") : t("common.delete")}
              onSubmit={(input) => void handleWorkspaceSubmit(input)}
            />
          ) : null
        }
        codePreview={
          codePreview && codePreviewVisible ? (
            <Suspense fallback={<CodePreviewDialogLoadingState reference={codePreview} onClose={closeCodePreview} />}>
              <LazyCodePreviewDialog
                reference={codePreview}
                content={codePreviewQuery.data ?? ""}
                loading={codePreviewQuery.isLoading}
                error={codePreviewQuery.error instanceof Error ? codePreviewQuery.error.message : null}
                onClose={closeCodePreview}
              />
            </Suspense>
          ) : null
        }
        imagePreview={imagePreview ? <ImagePreviewModal reference={imagePreview} onClose={closeImagePreview} /> : null}
        settingsOverlay={
          integrations.settingsOpen ? (
            <SettingsOverlay
          tab={integrations.settingsTab}
          notice={settingsNotice}
          account={account}
          accountRateLimits={accountRateLimits}
          accountRateLimitsLoading={accountRateLimitsQuery.isLoading || accountRateLimitsQuery.isFetching}
          accountRateLimitsError={
            accountRateLimitsQuery.error instanceof Error ? accountRateLimitsQuery.error.message : null
          }
          authStatus={integrations.authStatus}
          configRequirements={configRequirements}
          configRequirementsLoading={
            configRequirementsQuery.isLoading || configRequirementsQuery.isFetching
          }
          configRequirementsError={
            configRequirementsQuery.error instanceof Error
              ? configRequirementsQuery.error.message
              : null
          }
          configWarnings={configWarnings}
          deprecationNotices={deprecationNotices}
          modelReroutes={modelReroutes}
          externalAgentConfigItems={externalAgentConfigItems}
          selectedExternalAgentConfigKeys={selectedExternalAgentConfigKeys}
          externalAgentConfigPending={externalAgentConfigPending}
          lastAccountLoginCompletion={lastAccountLoginCompletion}
          loginState={accountLoginState}
          config={bootstrap?.settings.config ?? integrations.config ?? null}
          models={models}
          mcpServers={integrations.mcpServers}
          skills={integrations.skills}
          remoteSkills={remoteSkillsQuery.data?.skills ?? []}
          remoteSkillsLoading={remoteSkillsQuery.isLoading || remoteSkillsQuery.isFetching}
          apps={integrations.apps}
          plugins={integrations.plugins}
          archivedThreads={archivedThreadEntries}
          archivedThreadCount={archivedThreadCount}
          archivedThreadsLoading={archivedThreadsQuery.isLoading || archivedThreadsQuery.isFetchingNextPage}
          archivedThreadsHasMore={Boolean(archivedThreadsQuery.hasNextPage)}
          activeWorkspaceId={activeWorkspaceId}
          onClose={() => setSettingsOpen(false)}
          onTabChange={(tab) => setSettingsTab(tab)}
          onConfigSave={(payload) => void handleConfigSave(payload)}
          onRefresh={() => void handleRefreshIntegrations()}
          onAccountRefresh={() => void handleAccountRefresh()}
          onChatgptLogin={() => void handleChatgptLogin()}
          onDeviceCodeLogin={() => void handleDeviceCodeLogin()}
          onApiKeyLogin={(apiKey) => handleApiKeyLogin(apiKey)}
          onChatgptTokensLogin={(input) => handleChatgptTokensLogin(input)}
          onCancelChatgptLogin={() => void handleCancelChatgptLogin()}
          onAccountLogout={() => void handleAccountLogout()}
          onDetectExternalAgentConfig={() => void handleDetectExternalAgentConfig()}
          onToggleExternalAgentConfigItem={(item) => handleToggleExternalAgentConfigItem(item)}
          onImportExternalAgentConfig={() => void handleImportExternalAgentConfig()}
          onMcpLogin={(name) => void handleMcpLogin(name)}
          onMcpStatusRefresh={() => void handleRefreshMcpServers()}
          onMcpReload={() => void handleMcpReload()}
          onSkillsRefresh={() => void handleRefreshSkills()}
          onRemoteSkillsRefresh={() => void handleRemoteSkillsRefresh()}
          onRemoteSkillExport={(hazelnutId) => void handleRemoteSkillExport(hazelnutId)}
          onSkillConfigWrite={(path, enabled) => void handleSkillConfigWrite(path, enabled)}
          onAppsRefresh={() => void handleRefreshApps()}
          onPluginsRefresh={() => void handleRefreshPlugins()}
          onPluginInstall={(marketplacePath, pluginName) =>
            void handlePluginInstall(marketplacePath, pluginName)}
          onOpenArchivedThread={(threadId) => {
            setSettingsOpen(false);
            setArchivedMode("archived");
            void handleResumeThread(threadId);
          }}
          onUnarchiveThread={(thread) => void handleUnarchiveThread(thread)}
          onPluginUninstall={(pluginId) => void handlePluginUninstall(pluginId)}
          onArchivedLoadMore={() => void archivedThreadsQuery.fetchNextPage()}
            />
          ) : null
        }
        commandPalette={
          paletteOpen ? (
            <CommandPalette
          query={paletteQuery}
          actions={filteredPaletteActions}
          fileResults={paletteFileResults}
          loading={integrations.fuzzySearch.status === "loading"}
          onQueryChange={setPaletteQuery}
          onClose={() => {
            setPaletteOpen(false);
            setPaletteQuery("");
          }}
          onActionSelect={handlePaletteAction}
          onFileSelect={(file) => {
            setComposer(`Inspect ${file.path} and explain how it affects the current feature.`);
            setPaletteOpen(false);
            setPaletteQuery("");
          }}
            />
          ) : null
        }
        blockingOverlay={blocking ? <BlockingOverlay email={account?.email ?? null} /> : null}
        errorMessage={errorMessage}
      />
    </div>
  );
}

function SettingsOverlay(props: {
  tab: SettingsTab;
  notice: string | null;
  account: AccountSummary | null;
  accountRateLimits: AccountRateLimitsSnapshot | null;
  accountRateLimitsLoading: boolean;
  accountRateLimitsError: string | null;
  authStatus: AuthStatusSnapshot | null;
  configRequirements: ConfigRequirementsSnapshot | null;
  configRequirementsLoading: boolean;
  configRequirementsError: string | null;
  configWarnings: Array<ConfigWarningNotice>;
  deprecationNotices: Array<DeprecationNotice>;
  modelReroutes: Array<ModelRerouteEvent>;
  externalAgentConfigItems: Array<ExternalAgentConfigMigrationItem>;
  selectedExternalAgentConfigKeys: Array<string>;
  externalAgentConfigPending: boolean;
  lastAccountLoginCompletion: AccountLoginCompleted | null;
  loginState: AccountLoginState | null;
  config: ConfigSnapshot | null;
  models: Array<ModelOption>;
  mcpServers: ReturnType<typeof useWorkbenchStore.getState>["integrations"]["mcpServers"];
  skills: ReturnType<typeof useWorkbenchStore.getState>["integrations"]["skills"];
  remoteSkills: Array<RemoteSkillSummary>;
  remoteSkillsLoading: boolean;
  apps: ReturnType<typeof useWorkbenchStore.getState>["integrations"]["apps"];
  plugins: ReturnType<typeof useWorkbenchStore.getState>["integrations"]["plugins"];
  archivedThreads: Array<ThreadSummary>;
  archivedThreadCount: number;
  archivedThreadsLoading: boolean;
  archivedThreadsHasMore: boolean;
  activeWorkspaceId: string | "all";
  onClose: () => void;
  onTabChange: (tab: SettingsTab) => void;
  onConfigSave: (payload: ConfigSnapshot) => void;
  onRefresh: () => void;
  onAccountRefresh: () => void;
  onChatgptLogin: () => void;
  onDeviceCodeLogin: () => void;
  onApiKeyLogin: (apiKey: string) => Promise<boolean>;
  onChatgptTokensLogin: (input: {
    accessToken: string;
    chatgptAccountId: string;
    chatgptPlanType?: string | null;
  }) => Promise<boolean>;
  onCancelChatgptLogin: () => void;
  onAccountLogout: () => void;
  onDetectExternalAgentConfig: () => void;
  onToggleExternalAgentConfigItem: (item: ExternalAgentConfigMigrationItem) => void;
  onImportExternalAgentConfig: () => void;
  onMcpLogin: (name: string) => void;
  onMcpStatusRefresh: () => void;
  onMcpReload: () => void;
  onSkillsRefresh: () => void;
  onRemoteSkillsRefresh: () => void;
  onRemoteSkillExport: (hazelnutId: string) => void;
  onSkillConfigWrite: (path: string, enabled: boolean) => void;
  onAppsRefresh: () => void;
  onPluginsRefresh: () => void;
  onPluginInstall: (marketplacePath: string, pluginName: string) => void;
  onOpenArchivedThread: (threadId: string) => void;
  onUnarchiveThread: (thread: ThreadSummary) => void;
  onPluginUninstall: (pluginId: string) => void;
  onArchivedLoadMore: () => void;
}) {
  const { t, locale, setLocale } = useAppLocale();
  const settingsTabs = useMemo(() => buildSettingsTabs(t), [t]);
  const approvalPolicyOptions = useMemo(() => buildApprovalPolicyOptions(t), [t]);
  const sandboxModeOptions = useMemo(() => buildSandboxModeOptions(t), [t]);
  const settingsReasoningEffortOptions = useMemo(
    () => buildSettingsReasoningEffortOptions(t),
    [t],
  );
  const serviceTierOptions = useMemo(
    () => [
      { value: "standard", label: t("settings.serviceTierOptions.standard") },
      { value: "fast", label: t("settings.serviceTierOptions.fast") },
      { value: "flex", label: t("settings.serviceTierOptions.flex") },
    ],
    [t],
  );
  const accountSummary =
    props.account ??
    ({
      authenticated: false,
      requiresOpenaiAuth: true,
      accountType: "unknown",
      email: null,
      planType: null,
      usageWindows: [],
    } satisfies AccountSummary);
  const [model, setModel] = useState(props.config?.model ?? "");
  const [reasoningEffort, setReasoningEffort] = useState<"" | ReasoningEffort>(
    normalizeReasoningEffort(props.config?.reasoningEffort) ?? "",
  );
  const [serviceTierMode, setServiceTierMode] = useState<"standard" | "fast" | "flex">(
    serializeServiceTierMode(props.config?.serviceTier),
  );
  const [approvalPolicy, setApprovalPolicy] = useState(
    normalizeApprovalPolicy(props.config?.approvalPolicy) ?? "on-request",
  );
  const [sandboxMode, setSandboxMode] = useState(
    normalizeSandboxMode(props.config?.sandboxMode) ?? "danger-full-access",
  );
  const [apiKey, setApiKey] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [chatgptAccountId, setChatgptAccountId] = useState("");
  const [chatgptPlanType, setChatgptPlanType] = useState("");

  useEffect(() => {
    setModel(props.config?.model ?? "");
    setReasoningEffort(normalizeReasoningEffort(props.config?.reasoningEffort) ?? "");
    setServiceTierMode(serializeServiceTierMode(props.config?.serviceTier));
    setApprovalPolicy(normalizeApprovalPolicy(props.config?.approvalPolicy) ?? "on-request");
    setSandboxMode(normalizeSandboxMode(props.config?.sandboxMode) ?? "danger-full-access");
  }, [props.config]);

  useEffect(() => {
    if (props.tab === "account") {
      return;
    }

    setApiKey("");
    setAccessToken("");
    setChatgptAccountId("");
    setChatgptPlanType("");
  }, [props.tab]);

  const authMethodLabel = formatSettingsAuthMethodLabel(
    props.authStatus?.authMethod ?? accountSummary.accountType,
    t,
  );
  const forcedLoginMethodLabel = formatForcedLoginMethodLabel(
    props.config?.forcedLoginMethod ?? null,
    t,
  );
  const accountStateLabel = props.loginState?.phase === "pending"
    ? t("settings.accountStates.pending")
    : accountSummary.authenticated
      ? t("settings.accountStates.connected")
      : accountSummary.requiresOpenaiAuth
        ? t("settings.accountStates.needsAuth")
        : t("settings.accountStates.disconnected");
  const selectedExternalAgentConfigCount = props.externalAgentConfigItems.filter((item) =>
    props.selectedExternalAgentConfigKeys.includes(getExternalAgentConfigItemKey(item)),
  ).length;

  const handleApiKeySubmit = async (): Promise<void> => {
    if (!apiKey.trim()) {
      return;
    }
    const submitted = apiKey.trim();
    setApiKey("");
    const success = await props.onApiKeyLogin(submitted);
    if (!success) {
      setApiKey(submitted);
    }
  };

  const handleChatgptTokensSubmit = async (): Promise<void> => {
    if (!accessToken.trim() || !chatgptAccountId.trim()) {
      return;
    }
    const payload = {
      accessToken: accessToken.trim(),
      chatgptAccountId: chatgptAccountId.trim(),
      chatgptPlanType: chatgptPlanType.trim() || null,
    };
    const success = await props.onChatgptTokensLogin(payload);
    if (success) {
      setAccessToken("");
      setChatgptAccountId("");
      setChatgptPlanType("");
    }
  };

  return (
    <div className="overlay-shell" style={settingsOverlayStyle}>
      <div
        className="settings-panel"
        data-testid="settings-panel"
        style={dockedSettingsPanelStyle}
      >
        <aside className="settings-sidebar">
          <div>
            <p className="settings-sidebar__eyebrow">{t("settings.titleEyebrow")}</p>
            <strong>{t("settings.title")}</strong>
          </div>
          <div className="settings-sidebar__tabs">
            {settingsTabs.map((tab) => (
              <button
                key={tab.id}
                className={tab.id === props.tab ? "settings-tab settings-tab--active" : "settings-tab"}
                onClick={() => props.onTabChange(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <button className="ghost-button" onClick={props.onClose}>
            {t("common.close")}
          </button>
        </aside>

        <section className="settings-content">
          {props.notice ? <div className="settings-notice">{props.notice}</div> : null}

          {props.tab === "account" ? (
            <div className="settings-stack">
              <div className="settings-card">
                <div className="inspector-section__header">
                  <strong>{t("settings.accountSummary")}</strong>
                  <span>{accountStateLabel}</span>
                </div>
                <div className="settings-detail-grid">
                  <div>
                    <span className="field-note">{t("settings.accountFields.email")}</span>
                    <strong>{accountSummary.email ?? t("settings.accountDisconnected")}</strong>
                  </div>
                  <div>
                    <span className="field-note">{t("settings.accountFields.plan")}</span>
                    <strong>{accountSummary.planType ?? t("common.unknown")}</strong>
                  </div>
                  <div>
                    <span className="field-note">{t("settings.accountFields.loginMethod")}</span>
                    <strong>{formatSettingsAuthMethodLabel(accountSummary.accountType, t)}</strong>
                  </div>
                  <div>
                    <span className="field-note">{t("settings.accountFields.authMethod")}</span>
                    <strong>{authMethodLabel}</strong>
                  </div>
                </div>
                <div className="settings-usage-grid">
                  {accountSummary.usageWindows.length > 0 ? (
                    accountSummary.usageWindows.map((window) => (
                      <div
                        key={window.label}
                        className="settings-usage-item"
                        title={buildUsageWindowTitle(window)}
                      >
                        <span className="field-note">{window.label}</span>
                        <strong>{formatUsageRemaining(window.remainingPercent)}</strong>
                      </div>
                    ))
                  ) : (
                    <div className="settings-empty-inline">{t("settings.accountUsageEmpty")}</div>
                  )}
                </div>
                <div className="approval-actions">
                  <button className="ghost-button" onClick={props.onAccountRefresh}>
                    {t("settings.accountActions.refresh")}
                  </button>
                  <button
                    className="ghost-button"
                    onClick={props.onAccountLogout}
                    disabled={!accountSummary.authenticated}
                  >
                    {t("settings.accountActions.logout")}
                  </button>
                </div>
              </div>

              <div className="settings-card">
                <div className="inspector-section__header">
                  <strong>{t("settings.accountRateLimitsTitle")}</strong>
                  <span>{props.accountRateLimits ? t("common.active") : t("common.unknownState")}</span>
                </div>
                {props.accountRateLimitsLoading ? (
                  <div className="settings-empty-inline">{t("common.loading")}</div>
                ) : props.accountRateLimitsError ? (
                  <div className="settings-empty-inline">{props.accountRateLimitsError}</div>
                ) : props.accountRateLimits ? (
                  <div className="settings-stack">
                    {buildAccountRateLimitSections(props.accountRateLimits, t).map((section) => (
                      <div key={section.id} className="settings-diagnostics">
                        <div className="inspector-section__header">
                          <strong>{section.label}</strong>
                        </div>
                        {section.windows.length > 0 ? (
                          section.windows.map((window) => (
                            <div key={`${section.id}:${window.slot}`}>
                              <span className="field-note">
                                {t(`settings.accountRateLimitSlots.${window.slot}`)}
                              </span>
                              <strong>{formatAccountRateLimitWindow(window.window, locale, t)}</strong>
                            </div>
                          ))
                        ) : (
                          <div className="settings-empty-inline">
                            {t("settings.accountUsageEmpty")}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="settings-empty-inline">{t("settings.accountUsageEmpty")}</div>
                )}
              </div>

              <div className="settings-card">
                <div className="inspector-section__header">
                  <strong>{t("settings.accountLoginTitle")}</strong>
                  <span>{accountStateLabel}</span>
                </div>
                <div className="settings-stack">
                  <div className="settings-inline-actions">
                    <button
                      className="primary-button"
                      onClick={props.onChatgptLogin}
                      disabled={props.loginState?.phase === "pending"}
                    >
                      {t("settings.accountActions.loginWithChatgpt")}
                    </button>
                    <button
                      className="ghost-button"
                      onClick={props.onDeviceCodeLogin}
                      disabled={props.loginState?.phase === "pending"}
                    >
                      {t("settings.accountActions.loginWithDeviceCode")}
                    </button>
                  </div>

                  <label>
                    <span>{t("settings.accountActions.loginWithApiKey")}</span>
                    <input
                      type="password"
                      data-testid="settings-api-key-input"
                      value={apiKey}
                      onChange={(event) => setApiKey(event.target.value)}
                      placeholder={t("settings.accountApiKeyPlaceholder")}
                    />
                    <span className="field-note">{t("settings.accountApiKeyHelp")}</span>
                  </label>

                  <div className="approval-actions">
                    <button
                      className="primary-button"
                      onClick={() => void handleApiKeySubmit()}
                      disabled={!apiKey.trim() || props.loginState?.phase === "pending"}
                    >
                      {t("settings.accountActions.saveApiKey")}
                    </button>
                  </div>

                  {props.loginState?.phase === "pending" ? (
                    <div className="settings-login-pending">
                      <div>
                        <strong>
                          {props.loginState.method === "deviceCode"
                            ? t("settings.deviceCodePendingTitle")
                            : t("settings.loginPendingTitle")}
                        </strong>
                        <p className="muted">
                          {props.loginState.method === "deviceCode"
                            ? t("settings.deviceCodePendingBody", {
                                loginId: props.loginState.loginId ?? t("common.unknown"),
                              })
                            : t("settings.loginPendingBody", {
                                loginId: props.loginState.loginId ?? t("common.unknown"),
                              })}
                        </p>
                        {props.loginState.method === "deviceCode" ? (
                          <div className="settings-diagnostics">
                            <div>
                              <span className="field-note">{t("settings.deviceCodeUrlLabel")}</span>
                              <strong>{props.loginState.verificationUrl ?? t("common.unknown")}</strong>
                            </div>
                            <div>
                              <span className="field-note">{t("settings.deviceCodeCodeLabel")}</span>
                              <strong>{props.loginState.userCode ?? t("common.unknown")}</strong>
                            </div>
                            <div>
                              <span className="field-note">{t("settings.deviceCodeExpiresLabel")}</span>
                              <strong>
                                {props.loginState.expiresAt
                                  ? formatDateTime(props.loginState.expiresAt / 1000, locale)
                                  : t("common.unknown")}
                              </strong>
                            </div>
                          </div>
                        ) : null}
                      </div>
                      <div className="approval-actions">
                        {props.loginState.method === "deviceCode" && props.loginState.verificationUrl ? (
                          <button
                            className="ghost-button"
                            onClick={() =>
                              window.open(props.loginState?.verificationUrl ?? "", "_blank", "noopener,noreferrer")
                            }
                          >
                            {t("settings.accountActions.openVerificationPage")}
                          </button>
                        ) : null}
                        <button className="ghost-button" onClick={props.onCancelChatgptLogin}>
                          {t("settings.accountActions.cancelLogin")}
                        </button>
                      </div>
                    </div>
                  ) : null}

                  {props.loginState?.phase === "failed" && props.loginState.error ? (
                    <div className="settings-empty-inline">{props.loginState.error}</div>
                  ) : null}

                  {props.lastAccountLoginCompletion ? (
                    <div className="settings-diagnostics">
                      <div>
                        <span className="field-note">{t("settings.accountFields.lastLoginResult")}</span>
                        <strong>
                          {props.lastAccountLoginCompletion.success
                            ? t("settings.accountLoginResult.success")
                            : t("settings.accountLoginResult.failed")}
                        </strong>
                      </div>
                      <div>
                        <span className="field-note">{t("settings.accountFields.lastLoginId")}</span>
                        <strong>{props.lastAccountLoginCompletion.loginId ?? t("common.unknown")}</strong>
                      </div>
                      <div>
                        <span className="field-note">{t("settings.accountFields.lastLoginError")}</span>
                        <strong>{props.lastAccountLoginCompletion.error ?? t("common.unknown")}</strong>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>

              <details className="settings-card settings-advanced" open={Boolean(props.loginState?.phase === "failed")}>
                <summary className="settings-advanced__summary">
                  <strong>{t("settings.accountAdvancedTitle")}</strong>
                </summary>
                <div className="settings-stack">
                  <label>
                    <span>{t("settings.accountFields.accessToken")}</span>
                    <input
                      type="password"
                      value={accessToken}
                      onChange={(event) => setAccessToken(event.target.value)}
                    />
                  </label>
                  <div className="settings-form-grid">
                    <label>
                      <span>{t("settings.accountFields.chatgptAccountId")}</span>
                      <input
                        value={chatgptAccountId}
                        onChange={(event) => setChatgptAccountId(event.target.value)}
                      />
                    </label>
                    <label>
                      <span>{t("settings.accountFields.chatgptPlanType")}</span>
                      <input
                        value={chatgptPlanType}
                        onChange={(event) => setChatgptPlanType(event.target.value)}
                      />
                    </label>
                  </div>
                  <div className="approval-actions">
                    <button
                      className="ghost-button"
                      onClick={() => void handleChatgptTokensSubmit()}
                      disabled={!accessToken.trim() || !chatgptAccountId.trim()}
                    >
                      {t("settings.accountActions.importTokens")}
                    </button>
                  </div>

                  <div className="settings-diagnostics">
                    <div>
                      <span className="field-note">{t("settings.accountFields.authMethod")}</span>
                      <strong>{authMethodLabel}</strong>
                    </div>
                    <div>
                      <span className="field-note">{t("settings.accountFields.requiresOpenaiAuth")}</span>
                      <strong>
                        {(props.authStatus?.requiresOpenaiAuth ?? accountSummary.requiresOpenaiAuth)
                          ? t("common.yes")
                          : t("common.no")}
                      </strong>
                    </div>
                    <div>
                      <span className="field-note">{t("settings.accountFields.forcedLoginMethod")}</span>
                      <strong>{forcedLoginMethodLabel}</strong>
                    </div>
                  </div>
                </div>
              </details>

              <div className="settings-card">
                <div className="inspector-section__header">
                  <strong>{t("settings.externalAgentConfigTitle")}</strong>
                  <span>{formatNumber(props.externalAgentConfigItems.length)}</span>
                </div>
                <p className="field-note">{t("settings.externalAgentConfigHelp")}</p>
                <div className="approval-actions">
                  <button
                    className="ghost-button"
                    onClick={props.onDetectExternalAgentConfig}
                    disabled={props.externalAgentConfigPending}
                  >
                    {t("settings.accountActions.detectExternalAgentConfig")}
                  </button>
                  <button
                    className="primary-button"
                    onClick={props.onImportExternalAgentConfig}
                    disabled={props.externalAgentConfigPending || selectedExternalAgentConfigCount === 0}
                  >
                    {t("settings.accountActions.importExternalAgentConfig", {
                      count: selectedExternalAgentConfigCount,
                    })}
                  </button>
                </div>
                {props.externalAgentConfigItems.length > 0 ? (
                  <div className="settings-stack">
                    {props.externalAgentConfigItems.map((item) => {
                      const key = getExternalAgentConfigItemKey(item);
                      const checked = props.selectedExternalAgentConfigKeys.includes(key);
                      return (
                        <label key={key} className="settings-inline-actions">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => props.onToggleExternalAgentConfigItem(item)}
                          />
                          <span>
                            <strong>{formatExternalAgentConfigItemType(item.itemType, t)}</strong>
                            {": "}
                            {item.description}
                            {item.cwd ? ` (${item.cwd})` : ` (${t("settings.externalAgentConfigHomeScope")})`}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                ) : (
                  <div className="settings-empty-inline">
                    {t("settings.externalAgentConfigEmpty")}
                  </div>
                )}
              </div>

              <div className="settings-card">
                <div className="inspector-section__header">
                  <strong>{t("settings.warningsTitle")}</strong>
                  <span>
                    {formatNumber(
                      props.configWarnings.length +
                        props.deprecationNotices.length +
                        props.modelReroutes.length,
                    )}
                  </span>
                </div>
                {props.configWarnings.length === 0 &&
                props.deprecationNotices.length === 0 &&
                props.modelReroutes.length === 0 ? (
                  <div className="settings-empty-inline">{t("settings.warningsEmpty")}</div>
                ) : (
                  <div className="settings-stack">
                    {props.configWarnings.map((warning, index) => (
                      <div key={`warning:${index}`} className="settings-diagnostics">
                        <div>
                          <span className="field-note">{t("settings.warningKinds.config")}</span>
                          <strong>{warning.summary}</strong>
                        </div>
                        {warning.details ? (
                          <div>
                            <span className="field-note">{t("settings.warningDetailsLabel")}</span>
                            <strong>{warning.details}</strong>
                          </div>
                        ) : null}
                        {warning.path ? (
                          <div>
                            <span className="field-note">{t("settings.warningPathLabel")}</span>
                            <strong>
                              {warning.path}
                              {warning.range
                                ? `:${warning.range.start.line}:${warning.range.start.column}`
                                : ""}
                            </strong>
                          </div>
                        ) : null}
                      </div>
                    ))}
                    {props.deprecationNotices.map((notice, index) => (
                      <div key={`deprecation:${index}`} className="settings-diagnostics">
                        <div>
                          <span className="field-note">{t("settings.warningKinds.deprecation")}</span>
                          <strong>{notice.summary}</strong>
                        </div>
                        {notice.details ? (
                          <div>
                            <span className="field-note">{t("settings.warningDetailsLabel")}</span>
                            <strong>{notice.details}</strong>
                          </div>
                        ) : null}
                      </div>
                    ))}
                    {props.modelReroutes.map((reroute) => (
                      <div
                        key={`${reroute.threadId}:${reroute.turnId}:${reroute.fromModel}:${reroute.toModel}`}
                        className="settings-diagnostics"
                      >
                        <div>
                          <span className="field-note">{t("settings.warningKinds.reroute")}</span>
                          <strong>
                            {t("settings.modelRerouteSummary", {
                              fromModel: reroute.fromModel,
                              toModel: reroute.toModel,
                            })}
                          </strong>
                        </div>
                        <div>
                          <span className="field-note">{t("settings.warningReasonLabel")}</span>
                          <strong>{formatModelRerouteReason(reroute.reason, t)}</strong>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : null}

          {props.tab === "general" ? (
            <div className="settings-stack">
              <div className="settings-card">
                <div className="inspector-section__header">
                  <strong>{t("settings.generalTitle")}</strong>
                </div>
                <label>
                  <span>{t("settings.language")}</span>
                  <select
                    data-testid="settings-language"
                    value={locale}
                    onChange={(event) => void setLocale(event.target.value as "zh-CN" | "en-US")}
                  >
                    <option value="zh-CN">{t("settings.languageOptions.zhCN")}</option>
                    <option value="en-US">{t("settings.languageOptions.enUS")}</option>
                  </select>
                </label>
              </div>
            </div>
          ) : null}

          {props.tab === "defaults" ? (
            <div className="settings-stack">
              <div className="settings-card">
                <div className="inspector-section__header">
                  <strong>{t("settings.configRequirementsTitle")}</strong>
                  <span>{props.configRequirements ? t("common.active") : t("common.unknownState")}</span>
                </div>
                {props.configRequirementsLoading ? (
                  <div className="settings-empty-inline">{t("common.loading")}</div>
                ) : props.configRequirementsError ? (
                  <div className="settings-empty-inline">{props.configRequirementsError}</div>
                ) : props.configRequirements ? (
                  <div className="settings-diagnostics">
                    <div>
                      <span className="field-note">{t("settings.configRequirementFields.approvalPolicies")}</span>
                      <strong>
                        {formatConfigRequirementList(
                          props.configRequirements.allowedApprovalPolicies?.map((policy) =>
                            formatApprovalPolicyLabel(policy, t),
                          ) ?? [],
                          t,
                        )}
                      </strong>
                    </div>
                    <div>
                      <span className="field-note">{t("settings.configRequirementFields.sandboxModes")}</span>
                      <strong>
                        {formatConfigRequirementList(
                          props.configRequirements.allowedSandboxModes?.map((mode) =>
                            formatSandboxModeLabel(mode, t),
                          ) ?? [],
                          t,
                        )}
                      </strong>
                    </div>
                    <div>
                      <span className="field-note">{t("settings.configRequirementFields.webSearchModes")}</span>
                      <strong>
                        {formatConfigRequirementList(
                          props.configRequirements.allowedWebSearchModes?.map((mode) =>
                            formatWebSearchModeLabel(mode, t),
                          ) ?? [],
                          t,
                        )}
                      </strong>
                    </div>
                    <div>
                      <span className="field-note">{t("settings.configRequirementFields.residency")}</span>
                      <strong>
                        {props.configRequirements.enforceResidency
                          ? t("settings.configRequirementResidency.us")
                          : t("settings.configRequirementResidency.none")}
                      </strong>
                    </div>
                    <div>
                      <span className="field-note">{t("settings.configRequirementFields.features")}</span>
                      <strong>
                        {formatFeatureRequirements(props.configRequirements.featureRequirements, t)}
                      </strong>
                    </div>
                  </div>
                ) : (
                  <div className="settings-empty-inline">{t("settings.configRequirementsEmpty")}</div>
                )}
              </div>

              <div className="settings-card">
                <div className="inspector-section__header">
                  <strong>{t("settings.defaultAgentConfig")}</strong>
                  <span>{t("settings.modelCount", { count: props.models.length })}</span>
                </div>
                <div className="settings-form-grid">
                  <label>
                    <span>{t("settings.model")}</span>
                    <input
                      data-testid="settings-model-input"
                      value={model}
                      list="settings-model-options"
                      onChange={(event) => setModel(event.target.value)}
                      placeholder={t("settings.modelPlaceholder")}
                    />
                    <datalist id="settings-model-options">
                      {props.models.map((entry) => (
                        <option key={entry.id} value={entry.model}>
                          {formatModelDisplayName(entry)}
                        </option>
                      ))}
                    </datalist>
                  </label>
                  <label>
                    <span>{t("settings.reasoningEffort")}</span>
                    <select
                      data-testid="settings-reasoning-effort"
                      value={reasoningEffort}
                      onChange={(event) =>
                        setReasoningEffort(event.target.value as "" | ReasoningEffort)
                      }
                    >
                      {settingsReasoningEffortOptions.map((option) => (
                        <option key={option.value || "default"} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>{t("settings.serviceTier")}</span>
                    <select
                      data-testid="settings-service-tier"
                      value={serviceTierMode}
                      onChange={(event) =>
                        setServiceTierMode(event.target.value as "standard" | "fast" | "flex")
                      }
                    >
                      {serviceTierOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>{t("settings.approvalPolicy")}</span>
                    <select
                      data-testid="settings-approval-policy"
                      value={approvalPolicy}
                      onChange={(event) =>
                        setApprovalPolicy(event.target.value as EditableApprovalPolicy)
                      }
                    >
                      {approvalPolicyOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>{t("settings.sandboxMode")}</span>
                    <select
                      data-testid="settings-sandbox-mode"
                      value={sandboxMode}
                      onChange={(event) =>
                        setSandboxMode(event.target.value as EditableSandboxMode)
                      }
                    >
                      {sandboxModeOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <p className="muted">{t("settings.configHelp")}</p>
                <div className="approval-actions">
                  <button
                    className="primary-button"
                    data-testid="settings-save-button"
                    onClick={() =>
                      props.onConfigSave({
                        model: model || null,
                        reasoningEffort: reasoningEffort || null,
                        serviceTier: deserializeServiceTierMode(serviceTierMode),
                        approvalPolicy,
                        sandboxMode,
                        forcedLoginMethod: props.config?.forcedLoginMethod ?? null,
                      })
                    }
                  >
                    {t("settings.saveDefaults")}
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {props.tab === "integrations" ? (
            <div className="settings-stack">
              <div className="settings-card">
                <div className="inspector-section__header">
                  <strong>{t("settings.integrationsTitle")}</strong>
                  <div className="approval-actions">
                    <button className="ghost-button" onClick={props.onRefresh}>
                      {t("settings.refreshIntegrations")}
                    </button>
                    <button className="ghost-button" onClick={props.onMcpStatusRefresh}>
                      {t("settings.refreshMcpServers")}
                    </button>
                    <button className="ghost-button" onClick={props.onMcpReload}>
                      {t("settings.integrationsReload")}
                    </button>
                  </div>
                </div>
                <div className="mcp-list">
                  {props.mcpServers.length > 0 ? (
                    props.mcpServers.map((server) => (
                      <div key={server.name} className="mcp-card">
                        <div>
                          <strong>{server.name}</strong>
                          <p className="muted">
                            {t("settings.mcpToolsResources", {
                              tools: formatNumber(server.toolsCount),
                              resources: formatNumber(server.resourcesCount),
                            })}
                          </p>
                        </div>
                        <div className="mcp-card__actions">
                          <span>{server.authStatus}</span>
                          {server.authStatus.toLowerCase().includes("not") ? (
                            <button
                              className="ghost-button"
                              onClick={() => props.onMcpLogin(server.name)}
                            >
                              {t("settings.mcpLogin")}
                            </button>
                          ) : null}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="sidebar-empty-state">{t("settings.noMcpServers")}</div>
                  )}
                </div>
              </div>
            </div>
          ) : null}

          {props.tab === "extensions" ? (
            <div className="settings-stack">
              <div className="settings-card">
                <div className="inspector-section__header">
                  <strong>{t("settings.extensions.skills")}</strong>
                  <div className="approval-actions">
                    <button className="ghost-button" onClick={props.onSkillsRefresh}>
                      {t("settings.refreshSkills")}
                    </button>
                    <button className="ghost-button" onClick={props.onRemoteSkillsRefresh}>
                      {t("settings.refreshRemoteSkills")}
                    </button>
                  </div>
                </div>
                {props.skills.length > 0 ? (
                  props.skills.map((group) => (
                    <div key={group.cwd} className="settings-section">
                      <div className="inspector-section__header">
                        <strong>{compactPath(group.cwd, 4)}</strong>
                        <span>{t("settings.skillsCount", { count: group.skills.length })}</span>
                      </div>
                      <div className="plugin-list">
                        {group.skills.map((skill) => (
                          <div key={skill.path} className="plugin-row">
                            <div>
                              <strong>{skill.name}</strong>
                              <p className="muted">
                                {skill.shortDescription ?? skill.description} ·{" "}
                                {skill.enabled ? t("common.enabled") : t("common.disabled")}
                              </p>
                            </div>
                            <button
                              className="ghost-button"
                              onClick={() => props.onSkillConfigWrite(skill.path, !skill.enabled)}
                            >
                              {skill.enabled ? t("settings.skillDisable") : t("settings.skillEnable")}
                            </button>
                          </div>
                        ))}
                      </div>
                      {group.errors.length > 0 ? (
                        <pre className="settings-pre">
                          {group.errors.map((error) => error.message).join("\n")}
                        </pre>
                      ) : null}
                    </div>
                  ))
                ) : (
                  <p className="muted">{t("settings.skillsEmpty")}</p>
                )}
              </div>

              <div className="settings-card">
                <div className="inspector-section__header">
                  <strong>{t("settings.remoteSkillsTitle")}</strong>
                  <span>{formatNumber(props.remoteSkills.length)}</span>
                </div>
                {props.remoteSkillsLoading ? (
                  <p className="muted">{t("settings.remoteSkillsLoading")}</p>
                ) : props.remoteSkills.length > 0 ? (
                  <div className="plugin-list">
                    {props.remoteSkills.map((skill) => (
                      <div key={skill.id} className="plugin-row">
                        <div>
                          <strong>{skill.name}</strong>
                          <p className="muted">{skill.description}</p>
                        </div>
                        <button
                          className="ghost-button"
                          onClick={() => props.onRemoteSkillExport(skill.id)}
                        >
                          {t("settings.remoteSkillExport")}
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="muted">{t("settings.remoteSkillsEmpty")}</p>
                )}
              </div>

              <div className="settings-card">
                <div className="inspector-section__header">
                  <strong>{t("settings.extensions.apps")}</strong>
                  <div className="approval-actions">
                    <span>{formatNumber(props.apps.length)}</span>
                    <button className="ghost-button" onClick={props.onAppsRefresh}>
                      {t("settings.refreshApps")}
                    </button>
                  </div>
                </div>
                {props.apps.length > 0 ? (
                  <div className="plugin-list">
                    {props.apps.map((app) => (
                      <div key={app.id} className="plugin-row">
                        <div>
                          <strong>{app.name}</strong>
                          <p className="muted">
                            {app.description ?? t("common.noDescription")} ·{" "}
                            {app.isAccessible ? t("common.available") : t("common.blocked")} ·{" "}
                            {app.isEnabled ? t("common.enabled") : t("common.disabled")}
                          </p>
                          {app.pluginDisplayNames.length > 0 ? (
                            <p className="muted">
                              {t("settings.appPlugins", {
                                plugins: app.pluginDisplayNames.join(", "),
                              })}
                            </p>
                          ) : null}
                        </div>
                        <div className="mcp-card__actions">
                          {app.installUrl ? (
                            <a
                              className="ghost-button"
                              href={app.installUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              {t("settings.appInstall")}
                            </a>
                          ) : (
                            <span>{app.isAccessible ? t("common.available") : t("common.blocked")}</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="muted">{t("settings.appsEmpty")}</p>
                )}
              </div>

              <div className="settings-card">
                <div className="inspector-section__header">
                  <strong>{t("settings.extensions.plugins")}</strong>
                  <button className="ghost-button" onClick={props.onPluginsRefresh}>
                    {t("settings.refreshPlugins")}
                  </button>
                </div>
                {props.plugins.length > 0 ? (
                  props.plugins.map((marketplace) => (
                    <div key={marketplace.path} className="settings-section">
                      <div className="inspector-section__header">
                        <strong>{marketplace.name}</strong>
                        <span>{t("settings.pluginsCount", { count: marketplace.plugins.length })}</span>
                      </div>
                      <div className="plugin-list">
                        {marketplace.plugins.map((plugin) => (
                          <div key={plugin.id} className="plugin-row">
                            <div>
                              <strong>{plugin.name}</strong>
                              <p className="muted">
                                {plugin.installed ? t("common.installed") : t("common.notInstalled")} ·{" "}
                                {plugin.enabled ? t("common.enabled") : t("common.disabled")}
                              </p>
                            </div>
                            {plugin.installed ? (
                              <button
                                className="ghost-button"
                                onClick={() => props.onPluginUninstall(plugin.id)}
                              >
                                {t("settings.pluginUninstall")}
                              </button>
                            ) : (
                              <button
                                className="ghost-button"
                                onClick={() => props.onPluginInstall(marketplace.path, plugin.name)}
                              >
                                {t("settings.pluginInstall")}
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="muted">{t("settings.pluginsEmpty")}</p>
                )}
              </div>
            </div>
          ) : null}

          {props.tab === "history" ? (
            <div className="settings-stack">
              <div className="settings-card">
                <div className="inspector-section__header">
                  <strong>{t("settings.archivedThreads")}</strong>
                  <span>{formatNumber(props.archivedThreadCount)}</span>
                </div>
                <div className="archived-list">
                  {props.archivedThreads.map((thread) => (
                    <div key={thread.id} className="archived-row">
                      <div>
                        <strong>{formatThreadTitle(thread)}</strong>
                        <p className="muted">
                          {props.activeWorkspaceId === "all"
                            ? thread.workspaceName ?? t("settings.currentWorkspaceUnowned")
                            : compactPath(thread.cwd, 4)}
                        </p>
                      </div>
                      <div className="archived-row__actions">
                        <button
                          className="ghost-button"
                          onClick={() => props.onOpenArchivedThread(thread.id)}
                        >
                          {t("settings.openArchivedThread")}
                        </button>
                        <button
                          className="ghost-button"
                          onClick={() => props.onUnarchiveThread(thread)}
                        >
                          {t("settings.unarchiveThread")}
                        </button>
                      </div>
                    </div>
                  ))}
                  {props.archivedThreads.length === 0 && !props.archivedThreadsLoading ? (
                    <div className="sidebar-empty-state">{t("settings.archivedEmpty")}</div>
                  ) : null}
                  {props.archivedThreadsHasMore ? (
                    <button
                      className="ghost-button"
                      onClick={props.onArchivedLoadMore}
                      disabled={props.archivedThreadsLoading}
                    >
                      {props.archivedThreadsLoading ? t("common.loading") : t("common.loadMore")}
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}

function CommandPalette(props: {
  query: string;
  actions: Array<PaletteAction>;
  fileResults: Array<{ path: string; file_name: string; root: string; score: number }>;
  loading: boolean;
  onQueryChange: (value: string) => void;
  onClose: () => void;
  onActionSelect: (action: PaletteAction) => void;
  onFileSelect: (file: { path: string; file_name: string; root: string; score: number }) => void;
}) {
  const { t } = useAppLocale();
  return (
    <div className="overlay-shell" style={passThroughOverlayStyle}>
      <div className="palette-panel" style={interactiveOverlayPanelStyle}>
        <div className="palette-panel__header">
          <strong>{t("palette.title")}</strong>
          <button className="ghost-button" onClick={props.onClose}>
            {t("common.close")}
          </button>
        </div>
        <input
          className="palette-input"
          data-testid="workspace-search-input"
          autoFocus
          value={props.query}
          onChange={(event) => props.onQueryChange(event.target.value)}
          placeholder={t("palette.searchPlaceholder")}
        />

        <div className="palette-section">
          <p className="palette-section__title">{t("palette.quickActions")}</p>
          {props.actions.length > 0 ? (
            props.actions.map((action) => (
              <button
                key={action.id}
                className="palette-row"
                onClick={() => props.onActionSelect(action)}
              >
                <strong>{action.label}</strong>
                <span>{action.description}</span>
              </button>
            ))
          ) : (
            <div className="palette-empty">{t("palette.noActionMatches")}</div>
          )}
        </div>

        <div className="palette-section">
          <p className="palette-section__title">{t("palette.fileSearch")}</p>
          {props.loading ? <div className="palette-empty">{t("palette.searching")}</div> : null}
          {!props.loading && props.fileResults.length > 0
            ? props.fileResults.map((file) => (
                <button
                  key={`${file.root}:${file.path}`}
                  className="palette-row"
                  data-testid="workspace-search-result"
                  onClick={() => props.onFileSelect(file)}
                >
                  <strong>{file.file_name}</strong>
                  <span>{compactPath(`${file.root}/${file.path}`, 5)}</span>
                </button>
              ))
            : null}
          {!props.loading && props.query.trim() && props.fileResults.length === 0 ? (
            <div className="palette-empty">{t("palette.noFileMatches")}</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function WorkspaceModal(props: {
  initialValue: WorkspaceRecord | null;
  models: Array<ModelOption>;
  submitting: boolean;
  submitError: string | null;
  onClose: () => void;
  onSubmit: (input: WorkspaceFormInput) => void;
  onDelete?: () => void;
  deleteLabel?: string;
}) {
  const { t } = useAppLocale();
  const discoveredWorkspace = props.initialValue?.source === "derived";
  const [name, setName] = useState(props.initialValue?.name ?? "");
  const [absPath, setAbsPath] = useState(props.initialValue?.absPath ?? "~/");
  const [defaultModel, setDefaultModel] = useState(props.initialValue?.defaultModel ?? "");
  const [approvalPolicy, setApprovalPolicy] = useState<EditableApprovalPolicy>(
    normalizeApprovalPolicy(props.initialValue?.approvalPolicy) ?? "on-request",
  );
  const [sandboxMode, setSandboxMode] = useState<EditableSandboxMode>(
    normalizeSandboxMode(props.initialValue?.sandboxMode) ?? "danger-full-access",
  );
  const pathSuggestionsQuery = useQuery({
    queryKey: ["workspace-path-suggestions", absPath],
    queryFn: () => api.workspacePathSuggestions(absPath),
    placeholderData: (previous) => previous,
  });
  const pathSuggestions = pathSuggestionsQuery.data;
  const homePath = pathSuggestions?.homePath ?? null;
  const pathWithinHome = homePath === null ? true : isHomeScopedInput(absPath, homePath);
  const pathIsDirectory = pathSuggestions?.isDirectory ?? null;
  const pathValidationPending = pathSuggestionsQuery.isPending || pathSuggestionsQuery.isFetching;

  useEffect(() => {
    if (!homePath) {
      return;
    }

    const normalized = normalizeWorkspacePathInput(absPath, homePath);
    if (normalized !== absPath) {
      setAbsPath(normalized);
    }
  }, [absPath, homePath]);

  return (
    <div className="overlay-shell" style={centeredModalOverlayStyle}>
      <div className="modal-panel" style={interactiveOverlayPanelStyle}>
        <div className="modal-panel__header">
          <div>
            <p className="settings-sidebar__eyebrow">{t("workspace.modalEyebrow")}</p>
            <strong>
              {discoveredWorkspace
                ? t("workspace.modalTitleAdopt")
                : props.initialValue
                  ? t("workspace.modalTitleEdit")
                  : t("workspace.modalTitleNew")}
            </strong>
          </div>
          <button className="ghost-button" onClick={props.onClose}>
            {t("common.close")}
          </button>
        </div>

        <label>
          <span>{t("workspace.name")}</span>
          <input
            data-testid="workspace-name-input"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>

        <label>
          <span>{t("workspace.path")}</span>
          <input
            data-testid="workspace-path-input"
            value={absPath}
            disabled={discoveredWorkspace}
            onChange={(event) => setAbsPath(event.target.value)}
            placeholder="~/Development/webcli"
          />
          {discoveredWorkspace ? (
            <span className="field-note">{t("workspace.discoveredPathHelp")}</span>
          ) : null}
          {!pathWithinHome ? (
            <span className="field-note field-note--danger">{t("workspace.outsideHome")}</span>
          ) : null}
          {pathValidationPending ? (
            <span className="field-note">{t("workspace.validatingPath")}</span>
          ) : null}
          {pathWithinHome && pathIsDirectory === false ? (
            <span className="field-note field-note--danger">
              {discoveredWorkspace
                ? t("workspace.saveExistingDirectoryMissing")
                : t("workspace.invalidDirectory")}
            </span>
          ) : null}
          {!discoveredWorkspace && pathIsDirectory === false && pathSuggestions?.data.length ? (
            <div className="path-suggestion-list">
              {pathSuggestions.data.map((entry) => (
                <button
                  key={entry.absPath}
                  type="button"
                  className="path-suggestion-row"
                  onClick={() => setAbsPath(entry.value)}
                >
                  <strong>{entry.value}</strong>
                  <span>{entry.absPath}</span>
                </button>
              ))}
            </div>
          ) : null}
        </label>

        <label>
          <span>{t("workspace.defaultModel")}</span>
          <select
            data-testid="workspace-model-select"
            value={defaultModel}
            onChange={(event) => setDefaultModel(event.target.value)}
          >
            <option value="">{t("common.default")}</option>
            {props.models.map((model) => (
              <option key={model.id} value={model.model}>
                {formatModelDisplayName(model)}
              </option>
            ))}
          </select>
        </label>

        <div className="settings-form-grid">
          <label>
            <span>{t("settings.approvalPolicy")}</span>
            <select
              value={approvalPolicy}
              onChange={(event) =>
                setApprovalPolicy(event.target.value as EditableApprovalPolicy)
              }
            >
              <option value="on-request">{t("settings.approvalPolicies.on-request")}</option>
              <option value="on-failure">{t("settings.approvalPolicies.on-failure")}</option>
              <option value="untrusted">{t("settings.approvalPolicies.untrusted")}</option>
              <option value="never">{t("settings.approvalPolicies.never")}</option>
            </select>
          </label>

          <label>
            <span>{t("settings.sandboxMode")}</span>
            <select
              value={sandboxMode}
              onChange={(event) =>
                setSandboxMode(event.target.value as EditableSandboxMode)
              }
            >
              <option value="danger-full-access">{t("settings.sandboxModes.danger-full-access")}</option>
              <option value="workspace-write">{t("settings.sandboxModes.workspace-write")}</option>
              <option value="read-only">{t("settings.sandboxModes.read-only")}</option>
            </select>
          </label>
        </div>
        <p className="muted">
          {discoveredWorkspace
            ? t("workspace.autoDiscoveredHelp")
            : t("settings.configHelp")}
        </p>
        {props.submitError ? <div className="settings-notice">{props.submitError}</div> : null}

        <div className="modal-panel__footer">
          {props.onDelete ? (
            <button className="danger-button" onClick={props.onDelete} disabled={props.submitting}>
              {props.deleteLabel ?? t("common.delete")}
            </button>
          ) : (
            <span className="muted">{t("workspace.metadataStored")}</span>
          )}

          <button
            className="primary-button"
            data-testid="workspace-save-button"
            disabled={props.submitting || !pathWithinHome}
            onClick={() =>
              props.onSubmit({
                name,
                absPath,
                defaultModel: defaultModel || null,
                approvalPolicy,
                sandboxMode,
              })
            }
          >
            {props.submitting ? t("workspace.savePending") : t("common.save")}
          </button>
        </div>
      </div>
    </div>
  );
}

function GitReviewPanelLoadingState() {
  const { t } = useAppLocale();

  return (
    <div className="git-review-panel git-review-panel--empty" data-testid="git-workbench">
      <strong>{t("git.loadingDetailTitle")}</strong>
      <p>{t("git.readingTreeDetail")}</p>
    </div>
  );
}

function CodePreviewDialogLoadingState(props: {
  reference: CodeLinkReference;
  onClose: () => void;
}) {
  const { t } = useAppLocale();

  return (
    <div className="overlay-shell" style={centeredModalOverlayStyle}>
      <div
        className="modal-panel code-preview-modal"
        style={interactiveOverlayPanelStyle}
        data-testid="code-preview-modal"
      >
        <div className="modal-panel__header">
          <div>
            <p className="settings-sidebar__eyebrow">{t("modal.codePreview")}</p>
            <strong data-testid="code-preview-title">
              {props.reference.label?.trim() || props.reference.path.split("/").pop() || props.reference.path}
            </strong>
          </div>
          <button className="ghost-button" onClick={props.onClose}>
            {t("common.close")}
          </button>
        </div>
        <div className="inspector-empty" style={{ height: "100%" }}>
          <strong>{t("modal.loadingCode")}</strong>
          <p>{compactPath(props.reference.path, 5)}</p>
        </div>
      </div>
    </div>
  );
}

function ImagePreviewModal(props: {
  reference: ImagePreviewReference;
  onClose: () => void;
}) {
  const { t } = useAppLocale();
  return (
    <div
      className="overlay-shell"
      style={centeredModalOverlayStyle}
      onClick={props.onClose}
    >
      <div
        className="image-preview-modal"
        style={interactiveOverlayPanelStyle}
        data-testid="image-preview-modal"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="image-preview-modal__header">
          <div>
            <p className="settings-sidebar__eyebrow">{t("modal.imagePreview")}</p>
            {props.reference.label ? (
              <strong>{props.reference.label}</strong>
            ) : (
              <strong>{t("modal.viewImage")}</strong>
            )}
          </div>
          <button className="ghost-button" onClick={props.onClose}>
            {t("common.close")}
          </button>
        </div>
        <div className="image-preview-modal__body">
          <img
            data-testid="image-preview-full"
            src={props.reference.src}
            alt={props.reference.alt ?? props.reference.label ?? ""}
          />
        </div>
      </div>
    </div>
  );
}

function BlockingOverlay({ email }: { email: string | null }) {
  const { t } = useAppLocale();
  return (
    <div className="overlay-shell">
      <div className="blocking-card">
        <p className="settings-sidebar__eyebrow">{t("shell.blockingEyebrow")}</p>
        <h2>{t("shell.blockingTitle")}</h2>
        <p>{t("shell.blockingBody")}</p>
        {email ? <p className="muted">{t("shell.lastKnownAccount", { email })}</p> : null}
        <pre>ssh your-server && codex login</pre>
      </div>
    </div>
  );
}

const passThroughOverlayStyle: CSSProperties = {
  pointerEvents: "none",
};

const centeredModalOverlayStyle: CSSProperties = {
  ...passThroughOverlayStyle,
  justifyItems: "center",
  alignItems: "center",
};

const interactiveOverlayPanelStyle: CSSProperties = {
  pointerEvents: "auto",
};

const settingsOverlayStyle: CSSProperties = {
  ...passThroughOverlayStyle,
  justifyItems: "center",
  alignItems: "center",
};

const dockedSettingsPanelStyle: CSSProperties = {
  ...interactiveOverlayPanelStyle,
  width: "min(980px, calc(100vw - 48px))",
  maxHeight: "calc(100vh - 48px)",
};

function buildPaletteActions(input: {
  activeThreadEntry: ThreadSummary | null;
  archivedMode: ThreadArchiveMode;
  onNewThread: () => void;
  onToggleArchived: () => void;
  onOpenSettings: () => void;
  onFocusInspector: (tab: InspectorTab) => void;
  onOpenWorkspaceModal: () => void;
}): Array<PaletteAction> {
  return [
    {
      id: "new-thread",
      label: translate("palette.actions.newThreadLabel"),
      description: input.activeThreadEntry
        ? translate("palette.actions.newThreadDescriptionActive")
        : translate("palette.actions.newThreadDescriptionIdle"),
      run: input.onNewThread,
    },
    {
      id: "workspace",
      label: translate("palette.actions.newProjectLabel"),
      description: translate("palette.actions.newProjectDescription"),
      run: input.onOpenWorkspaceModal,
    },
    {
      id: "settings",
      label: translate("palette.actions.openSettingsLabel"),
      description: translate("palette.actions.openSettingsDescription"),
      run: input.onOpenSettings,
    },
    {
      id: "archived",
      label:
        input.archivedMode === "archived"
          ? translate("palette.actions.showActiveLabel")
          : translate("palette.actions.showArchivedLabel"),
      description: translate("palette.actions.toggleArchivedDescription"),
      run: input.onToggleArchived,
    },
    {
      id: "review",
      label: translate("palette.actions.showReviewLabel"),
      description: translate("palette.actions.showReviewDescription"),
      run: () => input.onFocusInspector("review"),
    },
    {
      id: "command",
      label: translate("palette.actions.showCommandLabel"),
      description: translate("palette.actions.showCommandDescription"),
      run: () => input.onFocusInspector("command"),
    },
  ];
}

function patchBootstrapCache(
  queryClient: ReturnType<typeof useQueryClient>,
  updater: (current: BootstrapResponse) => BootstrapResponse,
): void {
  queryClient.setQueryData<BootstrapResponse>(["bootstrap"], (current) =>
    current ? updater(current) : current,
  );
}

function appendQueuedPrompt(
  current: Record<string, Array<QueuedPrompt>>,
  threadId: string,
  text: string,
): Record<string, Array<QueuedPrompt>> {
  const nextPrompt: QueuedPrompt = {
    id: window.crypto.randomUUID(),
    threadId,
    text,
  };

  return {
    ...current,
    [threadId]: [...(current[threadId] ?? []), nextPrompt],
  };
}

function removeQueuedPrompt(
  current: Record<string, Array<QueuedPrompt>>,
  threadId: string,
  promptId: string,
): Record<string, Array<QueuedPrompt>> {
  const nextQueue = (current[threadId] ?? []).filter((prompt) => prompt.id !== promptId);
  if (nextQueue.length === 0) {
    const next = { ...current };
    delete next[threadId];
    return next;
  }

  return {
    ...current,
    [threadId]: nextQueue,
  };
}

function normalizeApprovalPolicy(
  value: WorkspaceRecord["approvalPolicy"] | ConfigSnapshot["approvalPolicy"] | undefined,
): EditableApprovalPolicy | null {
  if (
    value === "on-request" ||
    value === "never" ||
    value === "on-failure" ||
    value === "untrusted"
  ) {
    return value;
  }

  return null;
}

function normalizeReasoningEffort(
  value: ConfigSnapshot["reasoningEffort"] | undefined,
): ReasoningEffort | null {
  if (
    value === "none" ||
    value === "minimal" ||
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "xhigh"
  ) {
    return value;
  }

  return null;
}

function normalizeServiceTier(
  value: ConfigSnapshot["serviceTier"] | undefined,
): ServiceTier | null {
  if (value === "fast" || value === "flex") {
    return value;
  }

  return null;
}

function serializeServiceTierMode(
  value: ConfigSnapshot["serviceTier"] | undefined,
): "standard" | "fast" | "flex" {
  if (value === "fast" || value === "flex") {
    return value;
  }

  return "standard";
}

function deserializeServiceTierMode(
  value: "standard" | "fast" | "flex",
): ServiceTier | null {
  if (value === "fast" || value === "flex") {
    return value;
  }

  return null;
}

function normalizeSandboxMode(
  value: WorkspaceRecord["sandboxMode"] | ConfigSnapshot["sandboxMode"] | undefined,
): EditableSandboxMode | null {
  if (
    value === "workspace-write" ||
    value === "read-only" ||
    value === "danger-full-access"
  ) {
    return value;
  }

  return null;
}

function formatApprovalPolicy(value: ApprovalPolicy | null | undefined): string {
  if (value === "on-request") {
    return translate("settings.approvalPolicies.on-request");
  }

  if (value === "on-failure") {
    return translate("settings.approvalPolicies.on-failure");
  }

  if (value === "untrusted") {
    return translate("settings.approvalPolicies.untrusted");
  }

  if (value === "never") {
    return translate("settings.approvalPolicies.never");
  }

  return translate("common.default");
}

function formatApprovalPolicyLabel(value: ApprovalPolicy, t: TFunction): string {
  switch (value) {
    case "on-request":
      return t("settings.approvalPolicies.on-request");
    case "on-failure":
      return t("settings.approvalPolicies.on-failure");
    case "untrusted":
      return t("settings.approvalPolicies.untrusted");
    case "never":
      return t("settings.approvalPolicies.never");
    default:
      return value;
  }
}

function formatSettingsAuthMethodLabel(
  value: string | null | undefined,
  t: TFunction,
): string {
  switch (value) {
    case "chatgpt":
      return t("settings.authTypes.chatgpt");
    case "api":
    case "apiKey":
    case "apikey":
      return t("settings.authTypes.apiKey");
    case "chatgptAuthTokens":
      return t("settings.authTypes.chatgptAuthTokens");
    default:
      return t("settings.authTypes.unknown");
  }
}

function formatForcedLoginMethodLabel(
  value: ForcedLoginMethod | null | undefined,
  t: TFunction,
): string {
  switch (value) {
    case "chatgpt":
      return t("settings.forcedLoginMethods.chatgpt");
    case "api":
      return t("settings.forcedLoginMethods.api");
    default:
      return t("settings.forcedLoginMethods.default");
  }
}

function formatSandboxMode(value: SandboxMode | null | undefined): string {
  if (value === "danger-full-access") {
    return translate("settings.sandboxModes.danger-full-access");
  }

  if (value === "workspace-write") {
    return translate("settings.sandboxModes.workspace-write");
  }

  if (value === "read-only") {
    return translate("settings.sandboxModes.read-only");
  }

  return translate("common.default");
}

function formatSandboxModeLabel(value: SandboxMode, t: TFunction): string {
  switch (value) {
    case "danger-full-access":
      return t("settings.sandboxModes.danger-full-access");
    case "workspace-write":
      return t("settings.sandboxModes.workspace-write");
    case "read-only":
      return t("settings.sandboxModes.read-only");
    default:
      return value;
  }
}

function formatWebSearchModeLabel(
  value: NonNullable<ConfigRequirementsSnapshot["allowedWebSearchModes"]>[number],
  t: TFunction,
): string {
  switch (value) {
    case "disabled":
      return t("settings.webSearchModes.disabled");
    case "cached":
      return t("settings.webSearchModes.cached");
    case "live":
      return t("settings.webSearchModes.live");
    default:
      return String(value);
  }
}

function formatConfigRequirementList(values: Array<string>, t: TFunction): string {
  return values.length > 0 ? values.join(", ") : t("settings.configRequirementsUnrestricted");
}

function formatFeatureRequirements(
  requirements: ConfigRequirementsSnapshot["featureRequirements"],
  t: TFunction,
): string {
  if (!requirements || Object.keys(requirements).length === 0) {
    return t("settings.configRequirementsUnrestricted");
  }

  return Object.entries(requirements)
    .map(([feature, enabled]) =>
      `${feature}: ${enabled ? t("common.enabled") : t("common.disabled")}`,
    )
    .join(", ");
}

function buildAccountRateLimitSections(
  rateLimits: AccountRateLimitsSnapshot,
  t: TFunction,
): Array<{
  id: string;
  label: string;
  windows: Array<{
    slot: "primary" | "secondary";
    window: AccountRateLimitsSnapshot["rateLimits"]["primary"];
  }>;
}> {
  const sections = [
    {
      id: "default",
      label: t("settings.accountRateLimitSections.default"),
      snapshot: rateLimits.rateLimits,
    },
    ...Object.entries(rateLimits.rateLimitsByLimitId).map(([limitId, snapshot]) => ({
      id: limitId,
      label: t("settings.accountRateLimitSections.limit", { limitId }),
      snapshot,
    })),
  ];

  return sections.map((section) => ({
    id: section.id,
    label: section.label,
    windows: section.snapshot
      ? [
          { slot: "primary" as const, window: section.snapshot.primary },
          { slot: "secondary" as const, window: section.snapshot.secondary },
        ].filter((entry) => entry.window !== null)
      : [],
  }));
}

function formatAccountRateLimitWindow(
  window: AccountRateLimitsSnapshot["rateLimits"]["primary"],
  locale: string,
  t: TFunction,
): string {
  if (!window) {
    return t("common.unknown");
  }

  const parts: Array<string> = [
    t("settings.accountRateLimitWindowSummary", {
      duration: formatUsageWindowDuration(window.windowDurationMins, t),
      remaining: formatUsageRemaining(window.remainingPercent),
    }),
  ];
  if (window.usedPercent !== null) {
    parts.push(
      t("settings.accountRateLimitWindowUsed", {
        used: `${Math.round(window.usedPercent)}%`,
      }),
    );
  }
  if (window.resetsAt) {
    parts.push(formatDateTime(window.resetsAt / 1000, locale as "zh-CN" | "en-US"));
  }
  return parts.join(" · ");
}

function formatUsageWindowDuration(value: number | null, t: TFunction): string {
  if (!value || value <= 0) {
    return t("common.unknown");
  }

  if (value % 10_080 === 0) {
    return t("settings.duration.weeks", { count: value / 10_080 });
  }
  if (value % 1_440 === 0) {
    return t("settings.duration.days", { count: value / 1_440 });
  }
  if (value % 60 === 0) {
    return t("settings.duration.hours", { count: value / 60 });
  }
  return t("settings.duration.minutes", { count: value });
}

function formatExternalAgentConfigItemType(
  value: ExternalAgentConfigMigrationItem["itemType"],
  t: TFunction,
): string {
  switch (value) {
    case "AGENTS_MD":
      return t("settings.externalAgentConfigTypes.agents");
    case "CONFIG":
      return t("settings.externalAgentConfigTypes.config");
    case "SKILLS":
      return t("settings.externalAgentConfigTypes.skills");
    case "MCP_SERVER_CONFIG":
      return t("settings.externalAgentConfigTypes.mcp");
    default:
      return value;
  }
}

function formatModelRerouteReason(
  value: ModelRerouteEvent["reason"],
  t: TFunction,
): string {
  switch (value) {
    case "highRiskCyberActivity":
      return t("settings.modelRerouteReasons.highRiskCyberActivity");
    default:
      return value;
  }
}

function formatThreadTitle(thread: Pick<ThreadSummary, "name" | "preview"> | null): string | null {
  if (!thread) {
    return null;
  }

  const name = thread.name?.trim();
  if (name) {
    return name;
  }

  const preview = thread.preview?.trim();
  if (preview) {
    return preview.split("\n")[0]!.slice(0, 72);
  }

  return translate("workspace.untitledThread");
}

function formatModelDisplayName(model: Pick<ModelOption, "displayName" | "model">): string {
  const preferred = model.displayName?.trim();
  if (preferred) {
    return formatModelValue(preferred) ?? preferred;
  }

  return formatModelValue(model.model) ?? model.model;
}

function formatModelValue(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  if (!normalized) {
    return null;
  }

  if (/^gpt/i.test(normalized)) {
    return normalized.replace(/^gpt/i, "GPT");
  }

  if (/^codex/i.test(normalized)) {
    return normalized.replace(/^codex/i, "Codex");
  }

  return normalized;
}

function formatReasoningEffortLabel(value: ReasoningEffort): string {
  switch (value) {
    case "none":
      return translate("settings.reasoningLevels.none");
    case "minimal":
      return translate("settings.reasoningLevels.minimal");
    case "low":
      return translate("settings.reasoningLevels.low");
    case "medium":
      return translate("settings.reasoningLevels.medium");
    case "high":
      return translate("settings.reasoningLevels.high");
    case "xhigh":
      return translate("settings.reasoningLevels.xhigh");
    default:
      return value;
  }
}

function buildComposerReasoningOptions(
  model: ModelOption | null,
): Array<ComposerDropdownOption<ReasoningEffort>> {
  const efforts =
    model?.supportedReasoningEfforts.map((option) => option.reasoningEffort) ??
    (["low", "medium", "high", "xhigh"] as ReasoningEffort[]);

  return [...new Set(efforts)].map((effort) => ({
    value: effort,
    label: formatReasoningEffortLabel(effort),
    testIdSuffix: effort,
  }));
}

function resolveComposerReasoningEffort(
  requested: "" | ReasoningEffort,
  model: ModelOption | null,
): ReasoningEffort {
  const supportedEfforts =
    model?.supportedReasoningEfforts.map((option) => option.reasoningEffort) ??
    (["low", "medium", "high", "xhigh"] as ReasoningEffort[]);

  if (requested && supportedEfforts.includes(requested)) {
    return requested;
  }

  if (model && supportedEfforts.includes(model.defaultReasoningEffort)) {
    return model.defaultReasoningEffort;
  }

  return supportedEfforts[0] ?? "medium";
}

function formatRelativeThreadAge(updatedAt: number, now: number): string {
  const normalizedUpdatedAt = normalizeTimestamp(updatedAt);
  if (!Number.isFinite(normalizedUpdatedAt) || normalizedUpdatedAt <= 0) {
    return "";
  }
  return formatRelativeShort(normalizedUpdatedAt, now);
}

function formatAbsoluteDateTime(timestamp: number): string {
  const normalizedTimestamp = normalizeTimestamp(timestamp);
  if (!Number.isFinite(normalizedTimestamp) || normalizedTimestamp <= 0) {
    return "";
  }

  return formatDateTime(normalizedTimestamp);
}

function normalizeTimestamp(timestamp: number): number {
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return 0;
  }

  return timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp;
}

function readInitialSidebarWidth(): number {
  if (typeof window === "undefined") {
    return DEFAULT_SIDEBAR_WIDTH;
  }

  const storedValue = Number(window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY));
  const initialWidth =
    Number.isFinite(storedValue) && storedValue > 0 ? storedValue : DEFAULT_SIDEBAR_WIDTH;
  return clampSidebarWidth(initialWidth, window.innerWidth);
}

function readInitialInspectorWidth(): number {
  if (typeof window === "undefined") {
    return DEFAULT_INSPECTOR_WIDTH;
  }

  const storedValue = Number(window.localStorage.getItem(INSPECTOR_WIDTH_STORAGE_KEY));
  const initialWidth =
    Number.isFinite(storedValue) && storedValue > 0 ? storedValue : DEFAULT_INSPECTOR_WIDTH;
  return clampInspectorWidth(initialWidth, window.innerWidth);
}

function getSidebarWidthBounds(viewportWidth: number): { min: number; max: number } {
  const min = Math.round(viewportWidth / 6);
  const max = Math.round(viewportWidth / 3);
  return {
    min,
    max: Math.max(min, max),
  };
}

function clampSidebarWidth(width: number, viewportWidth: number): number {
  const { min, max } = getSidebarWidthBounds(viewportWidth);
  return Math.min(Math.max(Math.round(width), min), max);
}

function getInspectorWidthBounds(viewportWidth: number): { min: number; max: number } {
  const min = Math.round(viewportWidth / 6);
  const max = Math.round(viewportWidth / 3);
  return {
    min,
    max: Math.max(min, max),
  };
}

function clampInspectorWidth(width: number, viewportWidth: number): number {
  const { min, max } = getInspectorWidthBounds(viewportWidth);
  return Math.min(Math.max(Math.round(width), min), max);
}

function normalizeWorkspacePathInput(value: string, homePath: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "~/";
  }

  if (trimmed === homePath) {
    return "~/";
  }

  if (trimmed.startsWith(`${homePath}/`)) {
    return `~${trimmed.slice(homePath.length)}`;
  }

  return trimmed;
}

function isHomeScopedInput(value: string, homePath: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "~" || trimmed === "~/") {
    return true;
  }

  if (trimmed.startsWith("~/")) {
    return !trimmed.includes("/../") && !trimmed.endsWith("/..");
  }

  if (trimmed === homePath || trimmed.startsWith(`${homePath}/`)) {
    return true;
  }

  if (trimmed.startsWith("/")) {
    return false;
  }

  return !trimmed.startsWith("../");
}

function compactPath(value: string, keepSegments = 3): string {
  const parts = value.split("/").filter(Boolean);
  if (parts.length <= keepSegments) {
    return value;
  }

  return `.../${parts.slice(-keepSegments).join("/")}`;
}

function buildCodePreviewReference(
  path: string,
  line: number | null,
  label: string | null,
): CodeLinkReference {
  return {
    path,
    line,
    column: null,
    href: path,
    resolvedHref: path,
    label,
  };
}

function describeThreadStatus(status: ThreadSummary["status"] | string | null | undefined): string {
  if (!status) {
    return translate("common.unknownState");
  }

  if (typeof status === "string") {
    return status === "active" ? translate("common.active") : status;
  }

  if (status.type === "active") {
    return translate("common.active");
  }

  return status.type ?? translate("common.unknownState");
}

function isThreadRunning(status: ThreadSummary["status"] | string | null | undefined): boolean {
  return typeof status === "object" && status !== null && status.type === "active";
}

function normalizePlanStepStatus(status: string | null | undefined): "completed" | "active" | "pending" {
  if (status === "completed" || status === "done") {
    return "completed";
  }

  if (status === "in_progress" || status === "inProgress" || status === "running" || status === "active") {
    return "active";
  }

  return "pending";
}

function formatPlanStepStatus(status: string | null | undefined): string {
  if (status === "completed" || status === "done") {
    return translate("timeline.planCompleted");
  }

  if (status === "in_progress" || status === "inProgress" || status === "running" || status === "active") {
    return translate("timeline.planActive");
  }

  if (status === "pending" || status === "not_started" || status === "todo") {
    return translate("timeline.planPending");
  }

  return status || translate("timeline.planPending");
}

function isNearBottom(element: HTMLElement): boolean {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= 72;
}

function summarizeDiff(diff: string): {
  files: number;
  additions: number;
  deletions: number;
} {
  if (!diff) {
    return { files: 0, additions: 0, deletions: 0 };
  }

  let files = 0;
  let additions = 0;
  let deletions = 0;

  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      files += 1;
      continue;
    }

    if (line.startsWith("+++ ") || line.startsWith("--- ")) {
      continue;
    }

    if (line.startsWith("+")) {
      additions += 1;
      continue;
    }

    if (line.startsWith("-")) {
      deletions += 1;
    }
  }

  return { files, additions, deletions };
}

function formatGitFileStatus(file: GitWorkingTreeFile): string {
  const parts = [formatGitFileBadge(file.status)];
  if (file.oldPath) {
    parts.push(`${file.oldPath} → ${file.path}`);
  } else {
    parts.push(
      file.staged && file.unstaged
        ? translate("git.stagedAndUnstaged")
        : file.staged
          ? translate("git.stagedTracked")
          : file.unstaged
            ? translate("git.unstagedTracked")
            : translate("git.tracked"),
    );
  }
  return parts.join(" · ");
}

function formatGitFileBadge(status: GitWorkingTreeFile["status"]): string {
  switch (status) {
    case "modified":
      return translate("git.fileStatus.modified");
    case "added":
      return translate("git.fileStatus.added");
    case "deleted":
      return translate("git.fileStatus.deleted");
    case "renamed":
      return translate("git.fileStatus.renamed");
    case "copied":
      return translate("git.fileStatus.copied");
    case "untracked":
      return translate("git.fileStatus.untracked");
    case "typechange":
      return translate("git.fileStatus.typechange");
    case "conflicted":
      return translate("git.fileStatus.conflicted");
    default:
      return status;
  }
}

function findActiveTurn(threadView: ThreadView): ThreadView["turns"][string] | null {
  for (const turnId of [...threadView.turnOrder].reverse()) {
    const turn = threadView.turns[turnId];
    if (
      turn &&
      (turn.turn.status === "in_progress" ||
        turn.turn.status === "inProgress" ||
        turn.turn.status === "running")
    ) {
      return turn;
    }
  }

  return null;
}

function sortThreadsDescending(left: ThreadSummary, right: ThreadSummary): number {
  return (
    right.updatedAt - left.updatedAt ||
    right.createdAt - left.createdAt ||
    left.id.localeCompare(right.id)
  );
}

function selectToolbarUsageWindows(
  usageWindows: Array<AccountUsageWindow>,
): Array<AccountUsageWindow> {
  return [...usageWindows]
    .sort((left, right) => compareToolbarUsageWindows(left.label, right.label))
    .slice(0, 2);
}

function compareToolbarUsageWindows(left: string, right: string): number {
  return usageWindowPriority(left) - usageWindowPriority(right) || left.localeCompare(right);
}

function usageWindowPriority(label: string): number {
  if (label === "5h") {
    return 0;
  }

  if (label === "1w") {
    return 1;
  }

  return 10;
}

function formatUsageRemaining(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "--";
  }

  return `${Math.round(Math.max(0, Math.min(100, value)))}%`;
}

function buildUsageWindowTitle(window: AccountUsageWindow): string {
  const parts = [`${window.label} ${formatUsageRemaining(window.remainingPercent)}`];
  if (window.resetsAt) {
    parts.push(formatAbsoluteDateTime(window.resetsAt));
  }
  return parts.join(" · ");
}

function adaptFileResults(
  results: Array<{ path: string; score: number }>,
  root: string,
): Array<{ path: string; file_name: string; root: string; score: number }> {
  return results.map((entry) => {
    const normalizedPath =
      root && entry.path.startsWith(`${root}/`) ? entry.path.slice(root.length + 1) : entry.path;
    return {
      path: normalizedPath,
      file_name: normalizedPath.split("/").pop() ?? normalizedPath,
      root,
      score: entry.score,
    };
  });
}

function sanitizeTerminalSize(value: string, fallback: number): number {
  const next = Number.parseInt(value, 10);
  if (!Number.isFinite(next) || next < 20) {
    return fallback;
  }

  return next;
}
