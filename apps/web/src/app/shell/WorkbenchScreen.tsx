import {
  memo,
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
import Editor, { type OnMount } from "@monaco-editor/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ApprovalPolicy,
  BootstrapResponse,
  ConfigSnapshot,
  InspectorTab,
  ModelOption,
  PendingApproval,
  ReasoningEffort,
  SandboxMode,
  SettingsTab,
  ThreadArchiveMode,
  ThreadSummary,
  TimelineEntry,
  WorkspaceRecord,
} from "@webcli/contracts";
import { api } from "../../api";
import { codexClient } from "../../lib/codex-client";
import { routeWorkbenchServerMessage } from "../../shared/workbench/event-router";
import {
  type CodeLinkReference,
  type ImagePreviewReference,
  inferCodeLanguage,
  RenderableCodeBlock,
  RenderableMarkdown,
} from "../../shared/workbench/renderable-content";
import {
  selectTimeline,
  useWorkbenchStore,
  type CommandSession,
  type ThreadView,
} from "../../store/workbench-store";

const PROMPT_SUGGESTIONS = [
  "总结当前改动，并指出最危险的回归点。",
  "审查这个仓库结构，然后给出下一步三项改动。",
  "找出当前 workspace 里最高风险的 bug，并直接修掉。",
];

const SETTINGS_TABS: Array<{ id: SettingsTab; label: string }> = [
  { id: "general", label: "通用" },
  { id: "integrations", label: "集成" },
  { id: "skills", label: "技能" },
  { id: "apps", label: "Apps" },
  { id: "plugins", label: "Plugins" },
  { id: "archived", label: "已归档" },
];

const INSPECTOR_TABS: Array<{ id: InspectorTab; label: string }> = [
  { id: "diff", label: "Diff" },
  { id: "review", label: "Review" },
  { id: "plan", label: "Plan" },
  { id: "command", label: "Command" },
  { id: "mcp", label: "MCP" },
];

const REASONING_EFFORT_LABELS: Record<ReasoningEffort, string> = {
  none: "关闭",
  minimal: "最少",
  low: "低",
  medium: "中",
  high: "高",
  xhigh: "超高",
};

const SETTINGS_REASONING_EFFORT_OPTIONS: Array<{ value: "" | ReasoningEffort; label: string }> = [
  { value: "", label: "默认" },
  ...Object.entries(REASONING_EFFORT_LABELS).map(([value, label]) => ({
    value: value as ReasoningEffort,
    label,
  })),
];

const DEFAULT_SIDEBAR_WIDTH = 326;
const SIDEBAR_WIDTH_STORAGE_KEY = "webcli.sidebarWidth";

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

type ComposerDropdownOption<T extends string> = {
  value: T;
  label: string;
  testIdSuffix?: string;
  icon?: ReactNode;
};

type QueuedPrompt = {
  id: string;
  threadId: string;
  text: string;
};

export function App() {
  const queryClient = useQueryClient();
  const connection = useWorkbenchStore((state) => state.connection);
  const activeWorkspaceId = useWorkbenchStore((state) => state.activeWorkspaceId);
  const activeThreadId = useWorkbenchStore((state) => state.activeThreadId);
  const inspectorTab = useWorkbenchStore((state) => state.inspectorTab);
  const archivedMode = useWorkbenchStore((state) => state.threadLifecycle.archivedMode);
  const threads = useWorkbenchStore((state) => state.threads);
  const pendingApprovals = useWorkbenchStore((state) => state.pendingApprovals);
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
  const hydrateThread = useWorkbenchStore((state) => state.hydrateThread);
  const upsertThread = useWorkbenchStore((state) => state.upsertThread);
  const renameThreadInStore = useWorkbenchStore((state) => state.renameThread);
  const markThreadArchived = useWorkbenchStore((state) => state.markThreadArchived);
  const applyTurn = useWorkbenchStore((state) => state.applyTurn);
  const applyTimelineItem = useWorkbenchStore((state) => state.applyTimelineItem);
  const setLatestDiff = useWorkbenchStore((state) => state.setLatestDiff);
  const setLatestPlan = useWorkbenchStore((state) => state.setLatestPlan);
  const setReview = useWorkbenchStore((state) => state.setReview);
  const queueApproval = useWorkbenchStore((state) => state.queueApproval);
  const resolveApprovalInStore = useWorkbenchStore((state) => state.resolveApproval);
  const setCommandSession = useWorkbenchStore((state) => state.setCommandSession);
  const appendCommandOutput = useWorkbenchStore((state) => state.appendCommandOutput);
  const appendDelta = useWorkbenchStore((state) => state.appendDelta);
  const setIntegrationSnapshot = useWorkbenchStore((state) => state.setIntegrationSnapshot);
  const setFuzzySearch = useWorkbenchStore((state) => state.setFuzzySearch);
  const clearFuzzySearch = useWorkbenchStore((state) => state.clearFuzzySearch);

  const [composer, setComposer] = useState("");
  const [workspaceEditor, setWorkspaceEditor] = useState<WorkspaceRecord | null>(null);
  const [workspaceModalOpen, setWorkspaceModalOpen] = useState(false);
  const [codePreview, setCodePreview] = useState<CodeLinkReference | null>(null);
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
  const [completedThreadMarks, setCompletedThreadMarks] = useState<Record<string, true>>({});
  const [relativeTimeNow, setRelativeTimeNow] = useState(() => Date.now());
  const [sidebarWidth, setSidebarWidth] = useState(() => readInitialSidebarWidth());
  const [sidebarResizing, setSidebarResizing] = useState(false);
  const [threadTitleEditing, setThreadTitleEditing] = useState(false);
  const [threadTitleDraft, setThreadTitleDraft] = useState("");
  const [queuedPrompts, setQueuedPrompts] = useState<Record<string, Array<QueuedPrompt>>>({});
  const [composerModel, setComposerModel] = useState("");
  const [composerReasoningEffort, setComposerReasoningEffort] = useState<"" | ReasoningEffort>("");
  const [busyMessage, setBusyMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const autoOpenedWorkspaceModalRef = useRef(false);
  const sidebarResizeStateRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const sidebarResizeFrameRef = useRef<number | null>(null);
  const liveSidebarWidthRef = useRef(sidebarWidth);
  const desktopShellRef = useRef<HTMLDivElement | null>(null);
  const conversationBodyRef = useRef<HTMLDivElement | null>(null);
  const autoFollowTimelineRef = useRef(true);
  const previousActiveThreadIdRef = useRef<string | null>(null);
  const previousThreadStatusesRef = useRef<Record<string, ThreadSummary["status"]>>({});
  const queuedDispatchingThreadsRef = useRef(new Set<string>());
  const restoredThreadIdRef = useRef<string | null>(null);

  const bootstrapQuery = useQuery({
    queryKey: ["bootstrap"],
    queryFn: () => api.bootstrap(),
    refetchInterval: 30_000,
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

  const codePreviewQuery = useQuery({
    queryKey: ["code-preview", codePreview?.path],
    queryFn: () => api.resourceText(codePreview!.path),
    enabled: Boolean(codePreview?.path),
    staleTime: 30_000,
  });

  const bootstrap = bootstrapQuery.data ?? null;
  const account = bootstrap?.account ?? null;
  const models = bootstrap?.models ?? [];
  const workspaces = bootstrap?.workspaces ?? [];
  const activeThreadEntries = bootstrap?.activeThreads ?? [];
  const archivedThreadEntries = bootstrap?.archivedThreads ?? [];
  const storeThreadEntries = useMemo(
    () => Object.values(threads).map((threadView) => threadView.thread),
    [threads],
  );
  const allThreadEntries = useMemo(
    () => dedupeThreads([...activeThreadEntries, ...archivedThreadEntries, ...storeThreadEntries]),
    [activeThreadEntries, archivedThreadEntries, storeThreadEntries],
  );
  const selectedThreadEntries = useMemo(
    () => allThreadEntries.filter((thread) => (archivedMode === "archived" ? thread.archived : !thread.archived)),
    [allThreadEntries, archivedMode],
  );
  const workspaceTree = useMemo(
    () =>
      workspaces.map((workspace) => ({
        workspace,
        threads: selectedThreadEntries.filter((thread) => thread.workspaceId === workspace.id),
      })),
    [selectedThreadEntries, workspaces],
  );
  const selectedWorkspace =
    workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? null;
  const activeThreadEntry =
    (activeThreadId
      ? allThreadEntries.find((thread) => thread.id === activeThreadId) ?? threads[activeThreadId]?.thread
      : null) ?? null;
  const activeThreadView = activeThreadId ? threads[activeThreadId] ?? null : null;
  const selectedWorkspaceForContext =
    selectedWorkspace ??
    (activeThreadEntry?.workspaceId
      ? workspaces.find((workspace) => workspace.id === activeThreadEntry.workspaceId) ?? null
      : null);
  const searchableWorkspace = selectedWorkspaceForContext;
  const timeline = useMemo(() => selectTimeline(activeThreadView), [activeThreadView]);
  const latestCommandSession =
    commandOrder.length > 0 ? commandSessions[commandOrder[0]] ?? null : null;
  const activeTurn = activeThreadView ? findActiveTurn(activeThreadView) : null;
  const activeThreadArchived = activeThreadView?.archived ?? activeThreadEntry?.archived ?? false;
  const activePlan = activeThreadView?.latestPlan ?? null;
  const diffStats = summarizeDiff(activeThreadView?.latestDiff ?? "");
  const diffFiles = summarizeDiffFiles(activeThreadView?.latestDiff ?? "");
  const headerWorkspaceLabel = selectedWorkspaceForContext?.name ?? "选择项目";
  const threadTitle = formatThreadTitle(activeThreadEntry) ?? "新会话";
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
  const fastModeAvailable = Boolean(selectedBaseComposerModel?.upgradeModel);
  const fastModeEnabled =
    Boolean(selectedBaseComposerModel?.upgradeModel) &&
    selectedBaseComposerModel?.upgradeModel === selectedActualComposerModel?.model;
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
  const composerModelLabel =
    (selectedBaseComposerModel ? formatModelDisplayName(selectedBaseComposerModel) : null) ??
    formatModelValue(composerModel) ??
    "选择模型";
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
  const sidebarBounds = useMemo(
    () =>
      getSidebarWidthBounds(typeof window === "undefined" ? DEFAULT_SIDEBAR_WIDTH * 2 : window.innerWidth),
    [],
  );
  const desktopShellStyle = useMemo(
    () =>
      ({
        "--sidebar-width": `${sidebarWidth}px`,
        minHeight: "100vh",
      }) as CSSProperties,
    [sidebarWidth],
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
        setSettingsTab("general");
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
    const handleResize = () => {
      setSidebarWidth((current) => clampSidebarWidth(current, window.innerWidth));
    };

    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    liveSidebarWidthRef.current = sidebarWidth;
    desktopShellRef.current?.style.setProperty("--sidebar-width", `${sidebarWidth}px`);
    window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(sidebarWidth));
  }, [sidebarWidth]);

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
          "--sidebar-width",
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
    void codexClient.connect();
    const unsubscribeMessages = codexClient.subscribe((message) => {
      routeWorkbenchServerMessage(message, {
        queryClient,
        setConnection,
        upsertThread,
        applyTurn,
        applyTimelineItem,
        appendDelta,
        setLatestDiff,
        setLatestPlan,
        setReview,
        queueApproval,
        resolveApproval: resolveApprovalInStore,
        setCommandSession,
        appendCommandOutput,
        setIntegrationSnapshot,
      });
    });
    const unsubscribeConnection = codexClient.onConnectionChange((connected) => {
      setConnection({ connected });
    });

    return () => {
      unsubscribeMessages();
      unsubscribeConnection();
    };
  }, [
    appendCommandOutput,
    appendDelta,
    applyTimelineItem,
    applyTurn,
    queryClient,
    queueApproval,
    resolveApprovalInStore,
    setCommandSession,
    setConnection,
    setIntegrationSnapshot,
    setLatestDiff,
    setLatestPlan,
    setReview,
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

  const latestTimelineEntry = timeline.length > 0 ? timeline[timeline.length - 1] ?? null : null;

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
    latestTimelineEntry?.body.length,
    activeTurn?.turn.id,
    activeTurn?.turn.status,
  ]);

  function handleConversationScroll(): void {
    const container = conversationBodyRef.current;
    if (!container) {
      return;
    }

    autoFollowTimelineRef.current = isNearBottom(container);
  }

  useEffect(() => {
    if (!bootstrap) {
      return;
    }

    setConnection(bootstrap.runtime);
    for (const thread of [...bootstrap.activeThreads, ...bootstrap.archivedThreads]) {
      upsertThread(thread);
    }

    setExpandedWorkspaceIds((current) => {
      const validIds = current.filter((id) => workspaces.some((workspace) => workspace.id === id));
      return validIds.length > 0 ? validIds : workspaces.map((workspace) => workspace.id);
    });

    if (activeWorkspaceId !== "all" && workspaces.some((workspace) => workspace.id === activeWorkspaceId)) {
      return;
    }

    if (workspaces[0]) {
      setActiveWorkspace(workspaces[0].id);
      return;
    }

    setActiveWorkspace("all");
  }, [
    activeWorkspaceId,
    bootstrap,
    setActiveWorkspace,
    setConnection,
    upsertThread,
    workspaces,
  ]);

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
    if (!bootstrap || !activeThreadId) {
      restoredThreadIdRef.current = null;
      return;
    }

    if (threads[activeThreadId]?.turnOrder.length) {
      restoredThreadIdRef.current = null;
      return;
    }

    const summary = allThreadEntries.find((thread) => thread.id === activeThreadId);
    if (!summary || restoredThreadIdRef.current === activeThreadId) {
      return;
    }

    restoredThreadIdRef.current = activeThreadId;
    if (summary.workspaceId) {
      setActiveWorkspace(summary.workspaceId);
    }

    setBusyMessage("正在恢复线程...");
    void runAction(async () => {
      const response = await codexClient.call("thread.resume", {
        threadId: activeThreadId,
      });
      hydrateThread(response.thread);
    });
  }, [activeThreadId, allThreadEntries, bootstrap, hydrateThread, setActiveWorkspace, threads]);

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
            setErrorMessage(error instanceof Error ? error.message : "文件搜索失败");
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

      const threadView = threads[threadId];
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
          setErrorMessage(error instanceof Error ? error.message : "排队消息发送失败");
        })
        .finally(() => {
          queuedDispatchingThreadsRef.current.delete(threadId);
        });
    }
  }, [applyTurn, queuedPrompts, threads]);

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

  function openCodePreview(reference: CodeLinkReference): void {
    setCodePreview(reference);
  }

  function closeCodePreview(): void {
    setCodePreview(null);
  }

  function openImagePreview(reference: ImagePreviewReference): void {
    setImagePreview(reference);
  }

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

  async function runAction(action: () => Promise<void>): Promise<void> {
    setErrorMessage(null);
    try {
      await action();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "请求失败");
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
        setWorkspaceMutationError(`项目路径必须位于 ${pathCheck.homePath} 内。`);
        return;
      }

      if (!pathCheck.isDirectory) {
        setWorkspaceMutationError("项目路径不是可用目录。");
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
        setBusyMessage(`已切换到现有项目：${duplicateWorkspace.name}`);
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
      const message = error instanceof Error ? error.message : "项目保存失败";
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
      setWorkspaceMutationError(error instanceof Error ? error.message : "项目删除失败");
      setWorkspaceMutationPending(false);
    }
  }

  async function openThread(workspaceId = selectedWorkspaceForContext?.id ?? null): Promise<void> {
    if (!workspaceId) {
      return;
    }

    setBusyMessage("正在创建线程...");
    await runAction(async () => {
      const response = await codexClient.call("thread.open", { workspaceId });
      hydrateThread(response.thread);
      setActiveWorkspace(workspaceId);
      setActiveThread(response.thread.thread.id);
      setInspectorTab("diff");
    });
  }

  async function handleResumeThread(threadId: string, workspaceId?: string | null): Promise<void> {
    setThreadMenuId(null);
    if (workspaceId) {
      setActiveWorkspace(workspaceId);
    }
    setActiveThread(threadId);

    if (threads[threadId]?.turnOrder.length) {
      return;
    }

    setBusyMessage("正在恢复线程...");
    await runAction(async () => {
      const response = await codexClient.call("thread.resume", {
        threadId,
      });
      hydrateThread(response.thread);
    });
  }

  async function ensureThreadForPrompt(): Promise<string | null> {
    if (activeThreadId) {
      return activeThreadId;
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

    setBusyMessage("正在启动 turn...");
    await runAction(async () => {
      const threadId = await ensureThreadForPrompt();
      if (!threadId) {
        throw new Error("请先选择一个项目");
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

  async function handleRunReview(): Promise<void> {
    if (!activeThreadId) {
      return;
    }

    setBusyMessage("正在启动 review...");
    await runAction(async () => {
      const response = await codexClient.call("review.start", {
        threadId: activeThreadId,
      });
      if (response.turn) {
        applyTurn(activeThreadId, response.turn);
      }
      setInspectorTab("review");
    });
  }

  async function handleInterrupt(): Promise<void> {
    if (!activeThreadId || !activeTurn) {
      return;
    }

    setBusyMessage("正在中断当前 turn...");
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
    const currentTitle = formatThreadTitle(thread) ?? "未命名线程";
    const rawName = requestedName ?? window.prompt("输入新的线程名称", currentTitle) ?? "";
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

    setBusyMessage("正在重命名线程...");
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

  async function handleForkThread(thread: ThreadSummary): Promise<void> {
    setBusyMessage("正在 fork 线程...");
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
    setBusyMessage(thread.archived ? "正在恢复线程..." : "正在归档线程...");
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
    });
  }

  async function handleUnarchiveThread(thread: ThreadSummary): Promise<void> {
    setBusyMessage("正在恢复线程...");
    await runAction(async () => {
      const response = await codexClient.call("thread.unarchive", {
        threadId: thread.id,
      });
      hydrateThread(response.thread);
      markThreadArchived(thread.id, false);
      setArchivedMode("active");
    });
  }

  async function handleCompactThread(threadId: string): Promise<void> {
    setBusyMessage("正在 compact 线程...");
    await runAction(async () => {
      await codexClient.call("thread.compact", {
        threadId,
      });
    });
  }

  async function handleComposerModelChange(nextModel: string): Promise<void> {
    const normalizedModel = nextModel || null;
    const baseConfig = integrations.config ?? bootstrap?.settings.config ?? null;
    const nextBaseModelOption =
      composerModelMap.get(nextModel) ??
      baseComposerModels.find((model) => model.isDefault) ??
      baseComposerModels[0] ??
      null;
    const nextActualModel =
      fastModeEnabled && nextBaseModelOption?.upgradeModel
        ? nextBaseModelOption.upgradeModel
        : nextBaseModelOption?.model ?? normalizedModel;
    const nextModelOption =
      (nextActualModel ? composerModelMap.get(nextActualModel) : null) ??
      selectedActualComposerModel;
    const nextReasoningEffort = resolveComposerReasoningEffort(
      normalizeReasoningEffort(baseConfig?.reasoningEffort) ?? composerReasoningEffort,
      nextModelOption,
    );
    setComposerModel(nextActualModel ?? "");
    setComposerReasoningEffort(nextReasoningEffort);
    setBusyMessage("正在切换模型...");
    await runAction(async () => {
      const response = await codexClient.call("settings.save", {
        model: nextActualModel ?? null,
        reasoningEffort: nextReasoningEffort,
        approvalPolicy: baseConfig?.approvalPolicy ?? null,
        sandboxMode: baseConfig?.sandboxMode ?? null,
      });
      setIntegrationSnapshot(response.snapshot);
      patchBootstrapCache(queryClient, (current) => ({
        ...current,
        settings: {
          ...current.settings,
          config: {
            model: nextActualModel ?? null,
            reasoningEffort: nextReasoningEffort,
            approvalPolicy: baseConfig?.approvalPolicy ?? null,
            sandboxMode: baseConfig?.sandboxMode ?? null,
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

  async function handleFastModeToggle(): Promise<void> {
    if (!selectedBaseComposerModel?.upgradeModel) {
      return;
    }

    const baseConfig = integrations.config ?? bootstrap?.settings.config ?? null;
    const nextActualModel = fastModeEnabled
      ? selectedBaseComposerModel.model
      : selectedBaseComposerModel.upgradeModel;
    const nextModelOption = composerModelMap.get(nextActualModel) ?? selectedBaseComposerModel;
    const nextReasoningEffort = resolveComposerReasoningEffort(
      composerReasoningEffort,
      nextModelOption,
    );

    setComposerModel(nextActualModel);
    setComposerReasoningEffort(nextReasoningEffort);
    setBusyMessage(fastModeEnabled ? "正在关闭 Fast 模式..." : "正在开启 Fast 模式...");
    await runAction(async () => {
      const response = await codexClient.call("settings.save", {
        model: nextActualModel,
        reasoningEffort: nextReasoningEffort,
        approvalPolicy: baseConfig?.approvalPolicy ?? null,
        sandboxMode: baseConfig?.sandboxMode ?? null,
      });
      setIntegrationSnapshot(response.snapshot);
      patchBootstrapCache(queryClient, (current) => ({
        ...current,
        settings: {
          ...current.settings,
          config: {
            model: nextActualModel,
            reasoningEffort: nextReasoningEffort,
            approvalPolicy: baseConfig?.approvalPolicy ?? null,
            sandboxMode: baseConfig?.sandboxMode ?? null,
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
    const baseConfig = integrations.config ?? bootstrap?.settings.config ?? null;
    setComposerReasoningEffort(nextEffort);
    setBusyMessage("正在切换思考级别...");
    await runAction(async () => {
      const response = await codexClient.call("settings.save", {
        model: baseConfig?.model ?? null,
        reasoningEffort: nextEffort,
        approvalPolicy: baseConfig?.approvalPolicy ?? null,
        sandboxMode: baseConfig?.sandboxMode ?? null,
      });
      setIntegrationSnapshot(response.snapshot);
      patchBootstrapCache(queryClient, (current) => ({
        ...current,
        settings: {
          ...current.settings,
          config: {
            model: baseConfig?.model ?? null,
            reasoningEffort: nextEffort,
            approvalPolicy: baseConfig?.approvalPolicy ?? null,
            sandboxMode: baseConfig?.sandboxMode ?? null,
          },
        },
      }));
    });
  }

  async function handleRunCommand(): Promise<void> {
    if (!searchableWorkspace || !commandInput.trim()) {
      return;
    }

    setBusyMessage("正在执行命令...");
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

  async function handleResolveApproval(
    approval: PendingApproval,
    decision: "accept" | "decline",
  ): Promise<void> {
    await runAction(async () => {
      await codexClient.call("approval.resolve", {
        requestId: approval.id,
        decision,
      });
      resolveApprovalInStore(approval.id);
    });
  }

  async function handleConfigSave(payload: ConfigSnapshot): Promise<void> {
    setBusyMessage("正在保存设置...");
    await runAction(async () => {
      const response = await codexClient.call("settings.save", payload);
      setIntegrationSnapshot(response.snapshot);
      setSettingsNotice("默认配置已保存。");
      await invalidateBootstrap();
    });
  }

  async function handleRefreshIntegrations(): Promise<void> {
    setBusyMessage("正在刷新集成...");
    await runAction(async () => {
      const response = await codexClient.call("integrations.refresh", {
        workspaceId: activeWorkspaceId,
        threadId: activeThreadId,
      });
      setIntegrationSnapshot(response.snapshot);
      setSettingsNotice("集成快照已刷新。");
    });
  }

  async function handleMcpLogin(name: string): Promise<void> {
    setBusyMessage(`正在打开 ${name} 登录...`);
    await runAction(async () => {
      const response = await codexClient.call("integrations.mcp.login", {
        name,
      });
      window.open(response.authorizationUrl, "_blank", "noopener,noreferrer");
    });
  }

  async function handleMcpReload(): Promise<void> {
    setBusyMessage("正在 reload MCP...");
    await runAction(async () => {
      const response = await codexClient.call("integrations.mcp.reload", {});
      setIntegrationSnapshot(response.snapshot);
      setSettingsNotice("MCP 配置已刷新。");
    });
  }

  async function handlePluginUninstall(pluginId: string): Promise<void> {
    setBusyMessage("正在卸载插件...");
    await runAction(async () => {
      const response = await codexClient.call("integrations.plugin.uninstall", {
        pluginId,
        workspaceId: activeWorkspaceId,
        threadId: activeThreadId,
      });
      setIntegrationSnapshot(response.snapshot);
      setSettingsNotice("插件已卸载。");
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
        <div className="workbench-shell" style={{ gridColumn: "1 / -1" }}>
          <div className="conversation-ready">
            <p className="conversation-empty__eyebrow">Loading</p>
            <h2>正在连接工作台</h2>
            <p>等待 bootstrap、workspaces 和线程快照。</p>
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
      <aside className="sidebar-shell">
        <div className="sidebar-brand">
          <div className="sidebar-brand__mark">C</div>
          <div className="sidebar-brand__body">
            <span className="sidebar-brand__eyebrow">Remote Codex</span>
            <strong>webcli</strong>
          </div>
        </div>

        <section className="sidebar-section">
          <div className="sidebar-tree-toolbar">
            <button
              className={
                activeWorkspaceId === "all"
                  ? "workspace-tree__row sidebar-tree-toolbar__label sidebar-toggle--active"
                  : "workspace-tree__row sidebar-tree-toolbar__label"
              }
              data-testid="workspace-all-button"
              onClick={() => handleWorkspaceSelect("all")}
            >
              <span>{`项目(${workspaces.length})`}</span>
            </button>
            <button
              className="sidebar-icon-button"
              data-testid="workspace-create-button"
              aria-label="新项目"
              onClick={openCreateWorkspaceModal}
            >
              <FolderPlusIcon />
            </button>
          </div>

          <div className="workspace-tree">
            {workspaceTree.map(({ workspace, threads: workspaceThreads }) => (
              <div className="workspace-group" key={workspace.id}>
                <WorkspaceListRow
                  workspace={workspace}
                  active={workspace.id === activeWorkspaceId}
                  expanded={expandedWorkspaceIds.includes(workspace.id)}
                  onSelect={() => handleWorkspaceSelect(workspace.id)}
                  onCompose={() => void openThread(workspace.id)}
                  onEdit={() => openEditWorkspaceModal(workspace)}
                />
                {expandedWorkspaceIds.includes(workspace.id) && workspaceThreads.length > 0 ? (
                  <div className="thread-list thread-list--nested">
                    {workspaceThreads.map((thread) => (
                      <ThreadRow
                        key={thread.id}
                        thread={thread}
                        now={relativeTimeNow}
                        active={thread.id === activeThreadId}
                        running={isThreadRunning(thread.status)}
                        showCompletionMark={Boolean(completedThreadMarks[thread.id])}
                        nested
                      menuOpen={threadMenuId === thread.id}
                      onClick={() => void handleResumeThread(thread.id, workspace.id)}
                      onToggleMenu={() =>
                          setThreadMenuId((current) => (current === thread.id ? null : thread.id))
                        }
                        onRename={() => void handleRenameThread(thread)}
                        onFork={() => void handleForkThread(thread)}
                        onArchive={() => void handleArchiveThread(thread)}
                      />
                    ))}
                  </div>
                ) : null}
                {expandedWorkspaceIds.includes(workspace.id) && workspaceThreads.length === 0 ? (
                  <div className="sidebar-empty-state sidebar-empty-state--nested">
                    这个项目里还没有线程。
                  </div>
                ) : null}
              </div>
            ))}
            {workspaceTree.length > 0 && workspaceTree.every((group) => group.threads.length === 0) ? (
              <div className="sidebar-empty-state">当前视图里还没有线程。</div>
            ) : null}
            {workspaceTree.length === 0 ? (
              <div className="sidebar-empty-state">先注册一个项目，再开始桌面工作台会话。</div>
            ) : null}
          </div>
        </section>

        <button
          className="sidebar-settings-button"
          data-testid="settings-button"
          onClick={() => {
            setSettingsOpen(true);
            setSettingsTab("general");
            setSettingsNotice(null);
          }}
        >
          <span>设置</span>
          <span className="sidebar-settings-button__meta">
            {connection.connected ? "在线" : "离线"}
          </span>
        </button>
      </aside>

      <div
        className={sidebarResizing ? "sidebar-resizer sidebar-resizer--active" : "sidebar-resizer"}
        data-testid="sidebar-resizer"
        role="separator"
        tabIndex={0}
        aria-label="调整边栏宽度"
        aria-orientation="vertical"
        aria-valuemin={sidebarBounds.min}
        aria-valuemax={sidebarBounds.max}
        aria-valuenow={Math.round(sidebarWidth)}
        onPointerDown={handleSidebarResizeStart}
        onKeyDown={handleSidebarResizeKeyDown}
      />

      <div className="workbench-shell">
        <header className="window-toolbar">
          <div className="window-toolbar__title">
            <div className="conversation-header__trail">
              <span className="conversation-header__workspace">{headerWorkspaceLabel}</span>
              <span className="conversation-header__separator">→</span>
              {threadTitleEditing && activeThreadEntry ? (
                <input
                  className="conversation-header__title-input"
                  data-testid="thread-title-input"
                  autoFocus
                  value={threadTitleDraft}
                  onChange={(event) => setThreadTitleDraft(event.target.value)}
                  onBlur={() => void handleRenameThread(activeThreadEntry, threadTitleDraft)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void handleRenameThread(activeThreadEntry, threadTitleDraft);
                    }
                    if (event.key === "Escape") {
                      event.preventDefault();
                      setThreadTitleEditing(false);
                      setThreadTitleDraft(formatThreadTitle(activeThreadEntry) ?? "");
                    }
                  }}
                />
              ) : (
                <div className="conversation-header__title-group">
                  <h1 data-testid="thread-title-display">{threadTitle}</h1>
                  {activeThreadEntry ? (
                    <button
                      className="conversation-header__edit-button"
                      data-testid="thread-title-edit-button"
                      aria-label="编辑会话标题"
                      onClick={() => {
                        setThreadTitleDraft(threadTitle);
                        setThreadTitleEditing(true);
                      }}
                    >
                      <EditIcon />
                    </button>
                  ) : null}
                </div>
              )}
            </div>
          </div>

          <div className="window-toolbar__actions">
            <StatusPill
              label={connection.connected ? "Connected" : "Disconnected"}
              tone={connection.connected ? "green" : "amber"}
            />
            {account?.email ? <StatusPill label={account.email} tone="slate" /> : null}
            <button
              className="toolbar-pill-button"
              onClick={() =>
                selectedWorkspaceForContext
                  ? openEditWorkspaceModal(selectedWorkspaceForContext)
                  : openCreateWorkspaceModal()
              }
            >
              打开
            </button>
            <button
              className="toolbar-pill-button"
              data-testid="workspace-search-button"
              onClick={() => setPaletteOpen(true)}
            >
              命令
            </button>
            <button
              className="toolbar-pill-button"
              data-testid="review-button"
              onClick={() => void handleRunReview()}
              disabled={!activeThreadId}
            >
              提交
            </button>
          </div>

          <div className="window-toolbar__stats">
            <span className="window-stat window-stat--positive">+{diffStats.additions}</span>
            <span className="window-stat window-stat--negative">-{diffStats.deletions}</span>
          </div>
        </header>

        <div className="window-body">
          <section className="conversation-shell">
            <div
              className="conversation-body"
              ref={conversationBodyRef}
              onScroll={handleConversationScroll}
            >
              {!selectedWorkspaceForContext && !activeThreadId ? (
                <EmptyWorkspaceState onCreateWorkspace={openCreateWorkspaceModal} />
              ) : activeThreadView ? (
                timeline.length > 0 ? (
                  <div className="timeline-stream" data-testid="timeline-list">
                    {timeline.map((entry) => (
                      <ConversationEntry
                        key={entry.id}
                        entry={entry}
                        cwd={activeThreadEntry?.cwd ?? selectedWorkspaceForContext?.absPath ?? null}
                        onCodeLinkActivate={openCodePreview}
                        onImageActivate={openImagePreview}
                      />
                    ))}
                  </div>
                ) : (
                  <EmptyThreadState
                    thread={activeThreadView.thread}
                    archived={activeThreadArchived}
                  />
                )
              ) : (
                <ReadyState
                  workspace={selectedWorkspaceForContext}
                  onSuggestionClick={(prompt) => setComposer(prompt)}
                />
              )}
            </div>

            <div className="composer-shell">
              <div className="composer-shell__toolbar">
                <div className="composer-toolbar__selectors">
                  {fastModeAvailable ? (
                    <button
                      type="button"
                      className={[
                        "composer-fast-toggle",
                        fastModeEnabled ? "composer-fast-toggle--active" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      data-testid="composer-fast-toggle"
                      aria-label="Fast 模式"
                      aria-pressed={fastModeEnabled ? "true" : "false"}
                      onClick={() => void handleFastModeToggle()}
                    >
                      <BoltIcon />
                    </button>
                  ) : null}
                  <ComposerInlineDropdown
                    testId="composer-model-select"
                    value={selectedBaseComposerModel?.model ?? composerModel}
                    label={composerModelLabel}
                    options={composerModelOptions}
                    disabled={composerModelOptions.length === 0}
                    onChange={(value) => void handleComposerModelChange(value)}
                  />
                  <ComposerInlineDropdown
                    testId="composer-reasoning-select"
                    icon={<ReasoningEffortIcon effort={effectiveComposerReasoningEffort} />}
                    value={effectiveComposerReasoningEffort}
                    label={composerReasoningLabel}
                    options={composerReasoningOptions}
                    menuTitle="选择推理功能"
                    onChange={(value) => void handleComposerReasoningEffortChange(value)}
                  />
                </div>
                <button
                  className="ghost-button"
                  data-testid="compact-button"
                  onClick={() => activeThreadId && void handleCompactThread(activeThreadId)}
                  disabled={!activeThreadId}
                >
                  Compact
                </button>
              </div>

              {activePlan && (activePlan.explanation || activePlan.plan.length > 0) ? (
                <ComposerPlanCard plan={activePlan} />
              ) : null}

              {activeQueuedPrompts.length > 0 ? (
                <div className="composer-queue" data-testid="composer-queue">
                  {activeQueuedPrompts.map((queuedPrompt, index) => (
                    <div key={queuedPrompt.id} className="composer-queue__item">
                      <span className="composer-queue__label">{`排队 ${index + 1}`}</span>
                      <span className="composer-queue__text">{queuedPrompt.text}</span>
                    </div>
                  ))}
                </div>
              ) : null}

              <div className="composer-input-shell">
                <textarea
                  data-testid="composer-input"
                  value={composer}
                  onChange={(event) => setComposer(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.nativeEvent.isComposing) {
                      return;
                    }

                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void handleSendMessage();
                    }
                  }}
                  placeholder="Ask Codex to patch code, review a diff, explain a failure, or execute a plan..."
                />
                <button
                  className={
                    activeTurn
                      ? "composer-inline-button composer-inline-button--interrupt"
                      : "composer-inline-button composer-inline-button--send"
                  }
                  data-testid="send-button"
                  aria-label={activeTurn ? "Interrupt" : "发送"}
                  onClick={() => {
                    if (activeTurn) {
                      void handleInterrupt();
                      return;
                    }
                    void handleSendMessage();
                  }}
                  disabled={
                    activeTurn
                      ? !activeThreadId
                      : !composer.trim() || (!selectedWorkspaceForContext && !activeThreadId)
                  }
                >
                  {activeTurn ? <InterruptIcon /> : <SendArrowIcon />}
                </button>
              </div>
            </div>
          </section>

          <aside className="inspector-shell">
            <div className="inspector-header">
              <div>
                <p className="inspector-header__eyebrow">Inspector</p>
                <strong>{activeThreadView ? "未提交改动" : "线程输出"}</strong>
              </div>
              <div className="inspector-header__stats">
                <span>{diffStats.files} files</span>
                <span className="window-stat window-stat--positive">+{diffStats.additions}</span>
                <span className="window-stat window-stat--negative">-{diffStats.deletions}</span>
              </div>
            </div>

            <div className="inspector-tabs">
              {INSPECTOR_TABS.map((tab) => (
                <button
                  key={tab.id}
                  className={tab.id === inspectorTab ? "inspector-tab inspector-tab--active" : "inspector-tab"}
                  data-testid={`inspector-tab-${tab.id}`}
                  onClick={() => setInspectorTab(tab.id)}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="inspector-content" data-testid="inspector-panel">
              <InspectorPanel
                tab={inspectorTab}
                threadView={activeThreadView}
                timeline={timeline}
                diffFiles={diffFiles}
                latestCommandSession={latestCommandSession}
                commandInput={commandInput}
                commandStdin={commandStdin}
                commandCols={commandCols}
                commandRows={commandRows}
                mcpServers={integrations.mcpServers}
                onCommandChange={setCommandInput}
                onCommandStdinChange={setCommandStdin}
                onCommandColsChange={setCommandCols}
                onCommandRowsChange={setCommandRows}
                onRunCommand={() => void handleRunCommand()}
                onSendCommandInput={() => void handleSendCommandInput()}
                onResizeCommand={() => void handleResizeCommand()}
                onTerminateCommand={() => void handleTerminateCommand()}
                onOpenSettings={() => {
                  setSettingsOpen(true);
                  setSettingsTab("integrations");
                }}
              />
            </div>

            <ApprovalRail approvals={pendingApprovals} onResolve={handleResolveApproval} />
          </aside>
        </div>
      </div>

      {workspaceModalOpen ? (
        <WorkspaceModal
          initialValue={workspaceEditor}
          models={models}
          submitting={workspaceMutationPending}
          submitError={workspaceMutationError}
          onClose={closeWorkspaceModal}
          onDelete={workspaceEditor ? () => void handleDeleteWorkspace() : undefined}
          deleteLabel={workspaceEditor?.source === "derived" ? "移除" : "删除"}
          onSubmit={(input) => void handleWorkspaceSubmit(input)}
        />
      ) : null}

      {codePreview ? (
        <CodePreviewModal
          reference={codePreview}
          content={codePreviewQuery.data ?? ""}
          loading={codePreviewQuery.isLoading}
          error={codePreviewQuery.error instanceof Error ? codePreviewQuery.error.message : null}
          onClose={closeCodePreview}
        />
      ) : null}

      {imagePreview ? (
        <ImagePreviewModal reference={imagePreview} onClose={closeImagePreview} />
      ) : null}

      {integrations.settingsOpen ? (
        <SettingsOverlay
          tab={integrations.settingsTab}
          notice={settingsNotice}
          accountEmail={account?.email ?? null}
          accountType={account?.accountType ?? "unknown"}
          requiresOpenaiAuth={account?.requiresOpenaiAuth ?? false}
          config={integrations.config ?? bootstrap?.settings.config ?? null}
          models={models}
          mcpServers={integrations.mcpServers}
          skills={integrations.skills}
          apps={integrations.apps}
          plugins={integrations.plugins}
          archivedThreads={archivedThreadEntries}
          activeWorkspaceId={activeWorkspaceId}
          onClose={() => setSettingsOpen(false)}
          onTabChange={(tab) => setSettingsTab(tab)}
          onConfigSave={(payload) => void handleConfigSave(payload)}
          onRefresh={() => void handleRefreshIntegrations()}
          onMcpLogin={(name) => void handleMcpLogin(name)}
          onMcpReload={() => void handleMcpReload()}
          onOpenArchivedThread={(threadId) => {
            setSettingsOpen(false);
            setArchivedMode("archived");
            void handleResumeThread(threadId);
          }}
          onUnarchiveThread={(thread) => void handleUnarchiveThread(thread)}
          onPluginUninstall={(pluginId) => void handlePluginUninstall(pluginId)}
        />
      ) : null}

      {paletteOpen ? (
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
      ) : null}

      {blocking ? <BlockingOverlay email={account?.email ?? null} /> : null}

      <div
        style={{
          position: "fixed",
          right: 18,
          bottom: 14,
          display: "grid",
          gap: 4,
          justifyItems: "end",
          zIndex: 35,
        }}
      >
        <span data-testid="footer-status" className="muted">
          {busyMessage ?? "就绪"}
        </span>
        {errorMessage ? <span style={{ color: "#f06d65", fontSize: "0.85rem" }}>{errorMessage}</span> : null}
      </div>
    </div>
  );
}

function WorkspaceListRow(props: {
  workspace: WorkspaceRecord;
  active: boolean;
  expanded: boolean;
  onSelect: () => void;
  onCompose?: () => void;
  onEdit?: () => void;
}) {
  return (
    <div className="workspace-row" data-active={props.active ? "true" : "false"}>
      <button
        className="workspace-row__main"
        data-testid={`workspace-row-${props.workspace.id}`}
        onClick={props.onSelect}
        title={props.workspace.absPath}
      >
        <div className="workspace-row__title">
          {props.expanded ? <FolderOpenIcon /> : <FolderIcon />}
          <strong>{props.workspace.name}</strong>
        </div>
      </button>
      <div className="workspace-row__actions">
        {props.onEdit ? (
          <button
            className="workspace-row__icon-button"
            onClick={props.onEdit}
            aria-label="维护项目"
          >
            <GearIcon />
          </button>
        ) : null}
        {props.onCompose ? (
          <button
            className="workspace-row__icon-button"
            data-testid={props.active ? "thread-open-button" : undefined}
            onClick={props.onCompose}
            aria-label="新增会话"
          >
            <ComposeIcon />
          </button>
        ) : null}
      </div>
    </div>
  );
}

function ThreadRow(props: {
  thread: ThreadSummary;
  now: number;
  active: boolean;
  running: boolean;
  showCompletionMark: boolean;
  nested?: boolean;
  menuOpen: boolean;
  onClick: () => void;
  onToggleMenu: () => void;
  onRename: () => void;
  onFork: () => void;
  onArchive: () => void;
}) {
  return (
    <div
      className={[
        "thread-row",
        props.nested ? "thread-row--nested" : "",
        props.active ? "thread-row--active" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <button
        className="thread-row__main"
        data-testid={`thread-row-${props.thread.id}`}
        onClick={props.onClick}
      >
        <div className="thread-row__title">
          {props.running ? (
            <span
              className="thread-row__status-indicator thread-row__status-indicator--running"
              title="运行中"
            />
          ) : props.showCompletionMark ? (
            <span
              className="thread-row__status-indicator thread-row__status-indicator--completed"
              title="有新完成输出"
            />
          ) : null}
          <strong>{formatThreadTitle(props.thread) ?? "未命名线程"}</strong>
        </div>
        <span className="thread-row__time" title={formatAbsoluteDateTime(props.thread.updatedAt)}>
          {formatRelativeThreadAge(props.thread.updatedAt, props.now)}
        </span>
      </button>
      <button
        className="thread-row__menu-trigger"
        data-testid={`thread-menu-${props.thread.id}`}
        onClick={(event) => {
          event.stopPropagation();
          props.onToggleMenu();
        }}
      >
        <MoreIcon />
      </button>

      {props.menuOpen ? (
        <div className="thread-row__menu" onClick={(event) => event.stopPropagation()}>
          <button onClick={props.onRename}>重命名</button>
          <button onClick={props.onFork}>Fork</button>
          <button onClick={props.onArchive}>{props.thread.archived ? "恢复" : "归档"}</button>
        </div>
      ) : null}
    </div>
  );
}

function ComposerInlineDropdown<T extends string>(props: {
  testId: string;
  icon?: ReactNode;
  value: T;
  label: string;
  options: Array<ComposerDropdownOption<T>>;
  menuTitle?: string;
  disabled?: boolean;
  onChange: (value: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node) || !rootRef.current?.contains(target)) {
        setOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div
      ref={rootRef}
      className={[
        "composer-inline-select",
        open ? "composer-inline-select--open" : "",
        props.disabled ? "composer-inline-select--disabled" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <button
        type="button"
        className="composer-inline-select__trigger"
        data-testid={props.testId}
        data-value={props.value}
        aria-haspopup="menu"
        aria-expanded={open ? "true" : "false"}
        disabled={props.disabled}
        onClick={() => setOpen((current) => !current)}
      >
        {props.icon ? <span className="composer-inline-select__icon">{props.icon}</span> : null}
        <span className="composer-inline-select__label">{props.label}</span>
        <span className="composer-inline-select__chevron" aria-hidden="true" />
      </button>

      {open ? (
        <div className="composer-inline-select__menu" role="menu" data-testid={`${props.testId}-menu`}>
          {props.menuTitle ? (
            <div className="composer-inline-select__menu-title">{props.menuTitle}</div>
          ) : null}
          {props.options.map((option) => {
            const selected = option.value === props.value;
            return (
              <button
                key={(option.testIdSuffix ?? option.value) || "default"}
                type="button"
                role="menuitemradio"
                className="composer-inline-select__option"
                data-selected={selected ? "true" : "false"}
                data-testid={`${props.testId}-option-${(option.testIdSuffix ?? option.value) || "default"}`}
                aria-checked={selected ? "true" : "false"}
                onClick={() => {
                  setOpen(false);
                  props.onChange(option.value);
                }}
              >
                {option.icon ? (
                  <span className="composer-inline-select__option-icon" aria-hidden="true">
                    {option.icon}
                  </span>
                ) : null}
                <span className="composer-inline-select__option-label">{option.label}</span>
                {selected ? (
                  <span className="composer-inline-select__option-check" aria-hidden="true">
                    <CheckIcon />
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function EmptyWorkspaceState(props: { onCreateWorkspace: () => void }) {
  return (
    <div className="conversation-empty">
      <p className="conversation-empty__eyebrow">Get Started</p>
      <h2>先把本地仓库路径挂进来。</h2>
      <p>
        这个 web 工作台应该像桌面端一样承载真实会话。先注册项目根目录，再开始 Codex
        线程。
      </p>
      <button className="primary-button" onClick={props.onCreateWorkspace}>
        注册项目
      </button>
    </div>
  );
}

function ReadyState(props: {
  workspace: WorkspaceRecord | null;
  onSuggestionClick: (prompt: string) => void;
}) {
  return (
    <div className="conversation-ready">
      <div>
        <p className="conversation-empty__eyebrow">Ready</p>
        <h2>{props.workspace ? `在 ${props.workspace.name} 中开始线程` : "选择一个项目"}</h2>
      </div>
      <div className="suggestion-list">
        {PROMPT_SUGGESTIONS.map((prompt) => (
          <button
            key={prompt}
            className="suggestion-chip"
            onClick={() => props.onSuggestionClick(prompt)}
          >
            {prompt}
          </button>
        ))}
      </div>
    </div>
  );
}

function EmptyThreadState(props: { thread: ThreadSummary; archived: boolean }) {
  return (
    <div className="conversation-ready">
      <div>
        <p className="conversation-empty__eyebrow">
          {props.archived ? "Archived" : describeThreadStatus(props.thread.status)}
        </p>
        <h2>{formatThreadTitle(props.thread)}</h2>
      </div>
      <p>线程已经创建，但还没有完整 timeline。发送下一条消息后，这里会切到真正的工作流视图。</p>
    </div>
  );
}

function ComposerPlanCard(props: {
  plan: NonNullable<ThreadView["latestPlan"]>;
}) {
  const completedCount = props.plan.plan.filter((step) => normalizePlanStepStatus(step.status) === "completed").length;

  return (
    <section className="composer-plan" data-testid="composer-plan">
      <div className="composer-plan__header">
        <div>
          <span className="composer-plan__eyebrow">Plan</span>
          <strong>{`共 ${props.plan.plan.length} 个任务，已完成 ${completedCount} 个`}</strong>
        </div>
      </div>

      {props.plan.explanation ? (
        <p className="composer-plan__explanation">{props.plan.explanation}</p>
      ) : null}

      {props.plan.plan.length > 0 ? (
        <div className="composer-plan__list">
          {props.plan.plan.map((step, index) => {
            const normalizedStatus = normalizePlanStepStatus(step.status);
            return (
              <div key={`${index}-${step.step}`} className="composer-plan__row">
                <span
                  className={`composer-plan__status composer-plan__status--${normalizedStatus}`}
                  aria-hidden="true"
                />
                <span className="composer-plan__index">{`${index + 1}.`}</span>
                <span className="composer-plan__step">{step.step}</span>
                <span className="composer-plan__state">{formatPlanStepStatus(step.status)}</span>
              </div>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

const ConversationEntry = memo(function ConversationEntry(props: {
  entry: TimelineEntry;
  cwd?: string | null;
  onCodeLinkActivate?: (reference: CodeLinkReference) => void;
  onImageActivate?: (reference: ImagePreviewReference) => void;
}) {
  const { entry, cwd, onCodeLinkActivate, onImageActivate } = props;
  return isMessageEntry(entry.kind) ? (
    <MessageEntry
      entry={entry}
      cwd={cwd}
      onCodeLinkActivate={onCodeLinkActivate}
      onImageActivate={onImageActivate}
    />
  ) : (
    <ActivityEntry
      entry={entry}
      cwd={cwd}
      onCodeLinkActivate={onCodeLinkActivate}
      onImageActivate={onImageActivate}
    />
  );
});

const MessageEntry = memo(function MessageEntry(props: {
  entry: TimelineEntry;
  cwd?: string | null;
  onCodeLinkActivate?: (reference: CodeLinkReference) => void;
  onImageActivate?: (reference: ImagePreviewReference) => void;
}) {
  const { entry, cwd, onCodeLinkActivate, onImageActivate } = props;
  const placeholder = entry.kind === "agentMessage" ? "正在输出..." : "...";

  return (
    <article
      className={`stream-entry stream-entry--message ${
        entry.kind === "userMessage" ? "stream-entry--user" : "stream-entry--assistant"
      }`}
      data-testid={`timeline-item-${entry.id}`}
    >
      {entry.body.trim() ? (
        <RenderableMarkdown
          text={entry.body}
          cwd={cwd}
          onCodeLinkActivate={onCodeLinkActivate}
          onImageActivate={onImageActivate}
        />
      ) : (
        <div className="stream-entry__placeholder">{placeholder}</div>
      )}
    </article>
  );
});

const ActivityEntry = memo(function ActivityEntry(props: {
  entry: TimelineEntry;
  cwd?: string | null;
  onCodeLinkActivate?: (reference: CodeLinkReference) => void;
  onImageActivate?: (reference: ImagePreviewReference) => void;
}) {
  const { entry, cwd, onCodeLinkActivate, onImageActivate } = props;
  const summary = describeActivitySummary(entry);
  const details = describeActivityDetails(entry);
  const collapsible = shouldCollapseActivityByDefault(entry.kind) && Boolean(details?.trim());
  const [expanded, setExpanded] = useState(() => !collapsible);

  return (
    <article
      className={`stream-entry stream-entry--activity stream-entry--activity-${entry.kind}`}
      data-testid={`timeline-item-${entry.id}`}
    >
      {collapsible ? (
        <button
          className={expanded ? "stream-activity__toggle stream-activity__toggle--expanded" : "stream-activity__toggle"}
          type="button"
          onClick={() => setExpanded((current) => !current)}
        >
          <span className="stream-activity__chevron" aria-hidden="true">
            ▸
          </span>
          <span className="stream-activity__summary">
            {renderInlineFormattedText(summary, `${entry.id}-summary`)}
          </span>
        </button>
      ) : (
        <div className="stream-activity__summary">
          {renderInlineFormattedText(summary, `${entry.id}-summary`)}
        </div>
      )}
      {details && (!collapsible || expanded) ? (
        <div className="stream-activity__details">
          <RenderableMarkdown
            text={details}
            cwd={cwd}
            compact
            onCodeLinkActivate={onCodeLinkActivate}
            onImageActivate={onImageActivate}
          />
        </div>
      ) : null}
    </article>
  );
});

function renderInlineFormattedText(text: string, keyPrefix: string): ReactNode {
  if (!text) {
    return null;
  }

  return text.split(/(`[^`\n]+`|\[[^\]]+\]\([^)]+\))/g).map((part, index) => {
    if (!part) {
      return null;
    }

    if (part.startsWith("`") && part.endsWith("`")) {
      return <code key={`${keyPrefix}-code-${index}`}>{part.slice(1, -1)}</code>;
    }

    const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (linkMatch) {
      return (
        <a
          key={`${keyPrefix}-link-${index}`}
          href={linkMatch[2]}
          target="_blank"
          rel="noreferrer"
        >
          {linkMatch[1]}
        </a>
      );
    }

    return <span key={`${keyPrefix}-text-${index}`}>{part}</span>;
  });
}

function InspectorPanel(props: {
  tab: InspectorTab;
  threadView: ThreadView | null;
  timeline: Array<TimelineEntry>;
  diffFiles: Array<string>;
  latestCommandSession: CommandSession | null;
  commandInput: string;
  commandStdin: string;
  commandCols: string;
  commandRows: string;
  mcpServers: ReturnType<typeof useWorkbenchStore.getState>["integrations"]["mcpServers"];
  onCommandChange: (value: string) => void;
  onCommandStdinChange: (value: string) => void;
  onCommandColsChange: (value: string) => void;
  onCommandRowsChange: (value: string) => void;
  onRunCommand: () => void;
  onSendCommandInput: () => void;
  onResizeCommand: () => void;
  onTerminateCommand: () => void;
  onOpenSettings: () => void;
}) {
  const latestMcp = [...props.timeline]
    .reverse()
    .find((entry) => entry.kind === "mcpToolCall");

  if (!props.threadView) {
    return (
      <div className="inspector-empty">
        <strong>没有选中线程</strong>
        <p>先选一个线程，或者在项目里发出第一条消息。</p>
      </div>
    );
  }

  if (props.tab === "diff") {
    return (
      <div className="inspector-panel inspector-panel--stack">
        <div className="inspector-section">
          <div className="inspector-section__header">
            <strong>文件差异</strong>
            <span>{props.diffFiles.length} files</span>
          </div>
          <div className="diff-file-list">
            {props.diffFiles.length > 0 ? (
              props.diffFiles.map((file) => <span key={file}>{file}</span>)
            ) : (
              <span>No diff yet.</span>
            )}
          </div>
        </div>
        <div className="terminal-output" data-testid="diff-output">
          <RenderableCodeBlock value={props.threadView.latestDiff || "No diff yet."} language="diff" />
        </div>
      </div>
    );
  }

  if (props.tab === "review") {
    const review = props.threadView.review;
    return (
      <div className="inspector-panel inspector-panel--stack" data-testid="review-output">
        {review ? (
          <>
            <div className="inspector-section">
              <div className="inspector-section__header">
                <strong>{review.overall_correctness}</strong>
                <span>{review.findings.length} findings</span>
              </div>
              <p>{review.overall_explanation}</p>
            </div>
            <div className="review-list">
              {review.findings.map((finding) => (
                <div
                  key={`${finding.title}-${finding.code_location.absolute_file_path}`}
                  className="review-card"
                >
                  <strong>{finding.title}</strong>
                  <p>{finding.body}</p>
                  <span className="muted">
                    {compactPath(finding.code_location.absolute_file_path, 4)}:
                    {finding.code_location.line_range.start}
                  </span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="inspector-empty" style={{ height: "auto" }}>
            <strong>还没有结构化 review</strong>
            <p>点击顶部提交，或者让 Codex 对当前改动作一次 review。</p>
          </div>
        )}
      </div>
    );
  }

  if (props.tab === "plan") {
    return (
      <div className="inspector-panel inspector-panel--stack" data-testid="plan-output">
        {props.threadView.latestPlan ? (
          <>
            <div className="inspector-section">
              <div className="inspector-section__header">
                <strong>Live plan</strong>
                <span>{props.threadView.latestPlan.plan.length} steps</span>
              </div>
              <p>{props.threadView.latestPlan.explanation}</p>
            </div>
            <div className="plan-list">
              {props.threadView.latestPlan.plan.map((step) => (
                <div key={step.step} className="plan-row">
                  <strong>{step.step}</strong>
                  <span>{step.status}</span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="inspector-empty" style={{ height: "auto" }}>
            <strong>没有 live plan</strong>
            <p>当 Codex 发出 plan 更新时，这里会实时刷新。</p>
          </div>
        )}
      </div>
    );
  }

  if (props.tab === "command") {
    return (
      <div className="inspector-panel inspector-panel--stack">
        <div className="inspector-section">
          <div className="inspector-section__header">
            <strong>本地命令会话</strong>
            <span>{props.latestCommandSession?.status ?? "idle"}</span>
          </div>
          <div className="command-bar">
            <input
              data-testid="command-input"
              value={props.commandInput}
              onChange={(event) => props.onCommandChange(event.target.value)}
              placeholder="git status"
            />
            <button
              className="primary-button"
              data-testid="command-run-button"
              onClick={props.onRunCommand}
            >
              运行
            </button>
          </div>
          <div className="command-grid">
            <label>
              <span>Cols</span>
              <input
                value={props.commandCols}
                onChange={(event) => props.onCommandColsChange(event.target.value)}
              />
            </label>
            <label>
              <span>Rows</span>
              <input
                value={props.commandRows}
                onChange={(event) => props.onCommandRowsChange(event.target.value)}
              />
            </label>
            <button className="ghost-button" onClick={props.onResizeCommand}>
              Resize
            </button>
            <button
              className="ghost-button"
              data-testid="command-stop-button"
              onClick={props.onTerminateCommand}
            >
              Terminate
            </button>
          </div>
          <div className="command-bar">
            <input
              data-testid="command-stdin-input"
              value={props.commandStdin}
              onChange={(event) => props.onCommandStdinChange(event.target.value)}
              placeholder="stdin..."
            />
            <button
              className="ghost-button"
              data-testid="command-stdin-send-button"
              onClick={props.onSendCommandInput}
            >
              Send stdin
            </button>
          </div>
        </div>
        <div className="terminal-output" data-testid="command-output">
          <pre>
            {props.latestCommandSession
              ? `${props.latestCommandSession.stdout}${props.latestCommandSession.stderr ? `\n${props.latestCommandSession.stderr}` : ""}`.trim() ||
                "Command started. Waiting for output..."
              : "No command session yet."}
          </pre>
        </div>
      </div>
    );
  }

  return (
    <div className="inspector-panel inspector-panel--stack">
      <div className="inspector-section">
        <div className="inspector-section__header">
          <strong>MCP Servers</strong>
          <button className="ghost-button" onClick={props.onOpenSettings}>
            打开设置
          </button>
        </div>
        {props.mcpServers.length > 0 ? (
          <div className="mcp-list">
            {props.mcpServers.map((server) => (
              <div key={server.name} className="mcp-card">
                <strong>{server.name}</strong>
                <span>{server.authStatus}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted">还没有加载 MCP server 状态。</p>
        )}
      </div>
      <div className="terminal-output">
        <pre>{latestMcp?.body || "No MCP activity yet."}</pre>
      </div>
    </div>
  );
}

function ApprovalRail(props: {
  approvals: Array<PendingApproval>;
  onResolve: (approval: PendingApproval, decision: "accept" | "decline") => Promise<void>;
}) {
  if (props.approvals.length === 0) {
    return null;
  }

  return (
    <div className="approval-rail">
      <div className="inspector-section__header">
        <strong>审批</strong>
        <span>{props.approvals.length}</span>
      </div>
      {props.approvals.map((approval) => (
        <div
          key={String(approval.id)}
          className="approval-card"
          data-testid={`approval-card-${String(approval.id)}`}
        >
          <strong>{approval.method}</strong>
          <pre>{JSON.stringify(approval.params, null, 2)}</pre>
          <div className="approval-actions">
            <button
              className="primary-button"
              data-testid={`approval-accept-${String(approval.id)}`}
              onClick={() => void props.onResolve(approval, "accept")}
            >
              接受
            </button>
            <button
              className="ghost-button"
              data-testid={`approval-decline-${String(approval.id)}`}
              onClick={() => void props.onResolve(approval, "decline")}
            >
              拒绝
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function SettingsOverlay(props: {
  tab: SettingsTab;
  notice: string | null;
  accountEmail: string | null;
  accountType: string;
  requiresOpenaiAuth: boolean;
  config: ConfigSnapshot | null;
  models: Array<ModelOption>;
  mcpServers: ReturnType<typeof useWorkbenchStore.getState>["integrations"]["mcpServers"];
  skills: ReturnType<typeof useWorkbenchStore.getState>["integrations"]["skills"];
  apps: ReturnType<typeof useWorkbenchStore.getState>["integrations"]["apps"];
  plugins: ReturnType<typeof useWorkbenchStore.getState>["integrations"]["plugins"];
  archivedThreads: Array<ThreadSummary>;
  activeWorkspaceId: string | "all";
  onClose: () => void;
  onTabChange: (tab: SettingsTab) => void;
  onConfigSave: (payload: ConfigSnapshot) => void;
  onRefresh: () => void;
  onMcpLogin: (name: string) => void;
  onMcpReload: () => void;
  onOpenArchivedThread: (threadId: string) => void;
  onUnarchiveThread: (thread: ThreadSummary) => void;
  onPluginUninstall: (pluginId: string) => void;
}) {
  const [model, setModel] = useState(props.config?.model ?? "");
  const [reasoningEffort, setReasoningEffort] = useState<"" | ReasoningEffort>(
    normalizeReasoningEffort(props.config?.reasoningEffort) ?? "",
  );
  const [approvalPolicy, setApprovalPolicy] = useState(
    normalizeApprovalPolicy(props.config?.approvalPolicy) ?? "on-request",
  );
  const [sandboxMode, setSandboxMode] = useState(
    normalizeSandboxMode(props.config?.sandboxMode) ?? "danger-full-access",
  );

  useEffect(() => {
    setModel(props.config?.model ?? "");
    setReasoningEffort(normalizeReasoningEffort(props.config?.reasoningEffort) ?? "");
    setApprovalPolicy(normalizeApprovalPolicy(props.config?.approvalPolicy) ?? "on-request");
    setSandboxMode(normalizeSandboxMode(props.config?.sandboxMode) ?? "danger-full-access");
  }, [props.config]);

  return (
    <div className="overlay-shell" style={settingsOverlayStyle}>
      <div
        className="settings-panel"
        data-testid="settings-panel"
        style={dockedSettingsPanelStyle}
      >
        <aside className="settings-sidebar">
          <div>
            <p className="settings-sidebar__eyebrow">Settings</p>
            <strong>桌面工作台配置</strong>
          </div>
          <div className="settings-sidebar__tabs">
            {SETTINGS_TABS.map((tab) => (
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
            关闭
          </button>
        </aside>

        <section className="settings-content">
          {props.notice ? <div className="settings-notice">{props.notice}</div> : null}

          {props.tab === "general" ? (
            <div className="settings-stack">
              <div className="settings-card">
                <div className="inspector-section__header">
                  <strong>账号</strong>
                  <span>{props.accountEmail ?? "未连接"}</span>
                </div>
                <p className="muted">
                  Auth method: {props.accountType} · requires OpenAI auth:{" "}
                  {String(props.requiresOpenaiAuth)}
                </p>
              </div>

              <div className="settings-card">
                <div className="inspector-section__header">
                  <strong>默认代理配置</strong>
                  <span>{props.models.length} models</span>
                </div>
                <div className="settings-form-grid">
                  <label>
                    <span>Model</span>
                    <input
                      data-testid="settings-model-input"
                      value={model}
                      list="settings-model-options"
                      onChange={(event) => setModel(event.target.value)}
                      placeholder="Default"
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
                    <span>命令审批</span>
                    <select
                      data-testid="settings-approval-policy"
                      value={approvalPolicy}
                      onChange={(event) =>
                        setApprovalPolicy(event.target.value as EditableApprovalPolicy)
                      }
                    >
                      <option value="on-request">按需确认</option>
                      <option value="on-failure">失败后确认</option>
                      <option value="untrusted">高风险时确认</option>
                      <option value="never">从不询问</option>
                    </select>
                  </label>
                  <label>
                    <span>思考级别</span>
                    <select
                      data-testid="settings-reasoning-effort"
                      value={reasoningEffort}
                      onChange={(event) =>
                        setReasoningEffort(event.target.value as "" | ReasoningEffort)
                      }
                    >
                      {SETTINGS_REASONING_EFFORT_OPTIONS.map((option) => (
                        <option key={option.value || "default"} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>沙箱权限</span>
                    <select
                      data-testid="settings-sandbox-mode"
                      value={sandboxMode}
                      onChange={(event) =>
                        setSandboxMode(event.target.value as EditableSandboxMode)
                      }
                    >
                      <option value="danger-full-access">full access</option>
                      <option value="workspace-write">workspace write</option>
                      <option value="read-only">read only</option>
                    </select>
                  </label>
                </div>
                <p className="muted">
                  命令审批控制 Codex 在执行命令或写文件前何时向你确认。沙箱权限默认使用 full
                  access。
                </p>
                <div className="approval-actions">
                  <button
                    className="primary-button"
                    data-testid="settings-save-button"
                    onClick={() =>
                      props.onConfigSave({
                        model: model || null,
                        reasoningEffort: reasoningEffort || null,
                        approvalPolicy,
                        sandboxMode,
                      })
                    }
                  >
                    保存默认配置
                  </button>
                  <button
                    className="ghost-button"
                    data-testid="settings-refresh-button"
                    onClick={props.onRefresh}
                  >
                    刷新集成
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {props.tab === "integrations" ? (
            <div className="settings-stack">
              <div className="settings-card">
                <div className="inspector-section__header">
                  <strong>MCP Servers</strong>
                  <button className="ghost-button" onClick={props.onMcpReload}>
                    Reload
                  </button>
                </div>
                <div className="mcp-list">
                  {props.mcpServers.length > 0 ? (
                    props.mcpServers.map((server) => (
                      <div key={server.name} className="mcp-card">
                        <div>
                          <strong>{server.name}</strong>
                          <p className="muted">
                            tools {server.toolsCount} · resources {server.resourcesCount}
                          </p>
                        </div>
                        <div className="mcp-card__actions">
                          <span>{server.authStatus}</span>
                          {server.authStatus.toLowerCase().includes("not") ? (
                            <button
                              className="ghost-button"
                              onClick={() => props.onMcpLogin(server.name)}
                            >
                              Login
                            </button>
                          ) : null}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="sidebar-empty-state">还没有 MCP server 数据。</div>
                  )}
                </div>
              </div>
            </div>
          ) : null}

          {props.tab === "skills" ? (
            <div className="settings-stack">
              {props.skills.length > 0 ? (
                props.skills.map((group) => (
                  <div key={group.cwd} className="settings-card">
                    <div className="inspector-section__header">
                      <strong>{compactPath(group.cwd, 4)}</strong>
                      <span>{group.skills.length} skills</span>
                    </div>
                    <div className="tag-cloud">
                      {group.skills.map((skill) => (
                        <span key={skill.name} className="tag-chip">
                          {skill.name}
                        </span>
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
                <div className="settings-card">
                  <p className="muted">当前没有技能快照。</p>
                </div>
              )}
            </div>
          ) : null}

          {props.tab === "apps" ? (
            <div className="settings-stack">
              <div className="settings-card">
                <div className="inspector-section__header">
                  <strong>Apps</strong>
                  <span>{props.apps.length}</span>
                </div>
                {props.apps.length > 0 ? (
                  <div className="plugin-list">
                    {props.apps.map((app) => (
                      <div key={app.id} className="plugin-row">
                        <div>
                          <strong>{app.name}</strong>
                          <p className="muted">{app.description ?? "No description"}</p>
                        </div>
                        <div className="mcp-card__actions">
                          <span>{app.isAccessible ? "available" : "blocked"}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="muted">当前没有 app 列表。</p>
                )}
              </div>
            </div>
          ) : null}

          {props.tab === "plugins" ? (
            <div className="settings-stack">
              {props.plugins.length > 0 ? (
                props.plugins.map((marketplace) => (
                  <div key={marketplace.path} className="settings-card">
                    <div className="inspector-section__header">
                      <strong>{marketplace.name}</strong>
                      <span>{marketplace.plugins.length} plugins</span>
                    </div>
                    <div className="plugin-list">
                      {marketplace.plugins.map((plugin) => (
                        <div key={plugin.id} className="plugin-row">
                          <div>
                            <strong>{plugin.name}</strong>
                            <p className="muted">
                              {plugin.installed ? "installed" : "not installed"} ·{" "}
                              {plugin.enabled ? "enabled" : "disabled"}
                            </p>
                          </div>
                          {plugin.installed ? (
                            <button
                              className="ghost-button"
                              onClick={() => props.onPluginUninstall(plugin.id)}
                            >
                              卸载
                            </button>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              ) : (
                <div className="settings-card">
                  <p className="muted">当前没有插件快照。</p>
                </div>
              )}
            </div>
          ) : null}

          {props.tab === "archived" ? (
            <div className="settings-stack">
              <div className="settings-card">
                <div className="inspector-section__header">
                  <strong>归档线程</strong>
                  <span>{props.archivedThreads.length}</span>
                </div>
                <div className="archived-list">
                  {props.archivedThreads.map((thread) => (
                    <div key={thread.id} className="archived-row">
                      <div>
                        <strong>{formatThreadTitle(thread)}</strong>
                        <p className="muted">
                          {props.activeWorkspaceId === "all"
                            ? thread.workspaceName ?? "未归属"
                            : compactPath(thread.cwd, 4)}
                        </p>
                      </div>
                      <div className="archived-row__actions">
                        <button
                          className="ghost-button"
                          onClick={() => props.onOpenArchivedThread(thread.id)}
                        >
                          打开
                        </button>
                        <button
                          className="ghost-button"
                          onClick={() => props.onUnarchiveThread(thread)}
                        >
                          恢复
                        </button>
                      </div>
                    </div>
                  ))}
                  {props.archivedThreads.length === 0 ? (
                    <div className="sidebar-empty-state">当前没有归档线程。</div>
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
  return (
    <div className="overlay-shell" style={passThroughOverlayStyle}>
      <div className="palette-panel" style={interactiveOverlayPanelStyle}>
        <div className="palette-panel__header">
          <strong>命令菜单</strong>
          <button className="ghost-button" onClick={props.onClose}>
            关闭
          </button>
        </div>
        <input
          className="palette-input"
          data-testid="workspace-search-input"
          autoFocus
          value={props.query}
          onChange={(event) => props.onQueryChange(event.target.value)}
          placeholder="搜索动作或文件，支持 Cmd/Ctrl+K 打开"
        />

        <div className="palette-section">
          <p className="palette-section__title">Quick actions</p>
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
            <div className="palette-empty">没有匹配动作。</div>
          )}
        </div>

        <div className="palette-section">
          <p className="palette-section__title">File search</p>
          {props.loading ? <div className="palette-empty">搜索中...</div> : null}
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
            <div className="palette-empty">没有匹配文件。</div>
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
            <p className="settings-sidebar__eyebrow">Workspace</p>
            <strong>
              {discoveredWorkspace ? "接管项目" : props.initialValue ? "编辑项目" : "新项目"}
            </strong>
          </div>
          <button className="ghost-button" onClick={props.onClose}>
            关闭
          </button>
        </div>

        <label>
          <span>名称</span>
          <input
            data-testid="workspace-name-input"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>

        <label>
          <span>项目路径</span>
          <input
            data-testid="workspace-path-input"
            value={absPath}
            disabled={discoveredWorkspace}
            onChange={(event) => setAbsPath(event.target.value)}
            placeholder="~/Development/webcli"
          />
          {discoveredWorkspace ? (
            <span className="field-note">
              这个路径来自已发现的 session 目录。保存后会转成正式项目，并沿用这个目录。
            </span>
          ) : null}
          {!pathWithinHome ? (
            <span className="field-note field-note--danger">
              路径不能超出 <code>~/</code> 范围。
            </span>
          ) : null}
          {pathValidationPending ? (
            <span className="field-note">正在校验目录…</span>
          ) : null}
          {pathWithinHome && pathIsDirectory === false ? (
            <span className="field-note field-note--danger">
              {discoveredWorkspace
                ? "这个 session 对应的目录当前已经不存在，不能接管保存；如果不再需要，可以直接移除。"
                : "当前路径不是可用目录。请先选择一个现有目录。"}
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
          <span>默认模型</span>
          <select
            data-testid="workspace-model-select"
            value={defaultModel}
            onChange={(event) => setDefaultModel(event.target.value)}
          >
            <option value="">Default</option>
            {props.models.map((model) => (
              <option key={model.id} value={model.model}>
                {formatModelDisplayName(model)}
              </option>
            ))}
          </select>
        </label>

        <div className="settings-form-grid">
          <label>
            <span>命令审批</span>
            <select
              value={approvalPolicy}
              onChange={(event) =>
                setApprovalPolicy(event.target.value as EditableApprovalPolicy)
              }
            >
              <option value="on-request">按需确认</option>
              <option value="on-failure">失败后确认</option>
              <option value="untrusted">高风险时确认</option>
              <option value="never">从不询问</option>
            </select>
          </label>

          <label>
            <span>沙箱权限</span>
            <select
              value={sandboxMode}
              onChange={(event) =>
                setSandboxMode(event.target.value as EditableSandboxMode)
              }
            >
              <option value="danger-full-access">full access</option>
              <option value="workspace-write">workspace write</option>
              <option value="read-only">read only</option>
            </select>
          </label>
        </div>
        <p className="muted">
          {discoveredWorkspace
            ? "自动发现项目保存后会写入本地 SQLite，此后可像普通项目一样维护模型、审批和沙箱设置。"
            : "命令审批决定 Codex 执行命令或改文件前是否先向你确认。项目默认使用 full access。"}
        </p>
        {props.submitError ? <div className="settings-notice">{props.submitError}</div> : null}

        <div className="modal-panel__footer">
          {props.onDelete ? (
            <button className="danger-button" onClick={props.onDelete} disabled={props.submitting}>
              {props.deleteLabel ?? "删除"}
            </button>
          ) : (
            <span className="muted">Workspace 元数据保存在本地 SQLite。</span>
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
            {props.submitting ? "保存中..." : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}

function CodePreviewModal(props: {
  reference: CodeLinkReference;
  content: string;
  loading: boolean;
  error: string | null;
  onClose: () => void;
}) {
  const language = useMemo(() => inferCodeLanguage(props.reference.path), [props.reference.path]);
  const fileName =
    props.reference.label?.trim() || props.reference.path.split("/").pop() || props.reference.path;
  const locationLabel =
    props.reference.line !== null
      ? `第 ${props.reference.line} 行${props.reference.column !== null ? `, 第 ${props.reference.column} 列` : ""}`
      : null;

  const handleEditorMount = useMemo<OnMount>(
    () => (editor, monaco) => {
      if (props.reference.line === null) {
        return;
      }

      const lineNumber = Math.max(1, props.reference.line);
      const column = Math.max(1, props.reference.column ?? 1);
      editor.revealLineInCenter(lineNumber);
      editor.setPosition({ lineNumber, column });
      editor.createDecorationsCollection([
        {
          range: new monaco.Range(lineNumber, 1, lineNumber, 1),
          options: {
            isWholeLine: true,
            className: "code-preview__line-highlight",
            linesDecorationsClassName: "code-preview__line-gutter",
          },
        },
      ]);
    },
    [props.reference.column, props.reference.line],
  );

  return (
    <div className="overlay-shell" style={centeredModalOverlayStyle}>
      <div
        className="modal-panel code-preview-modal"
        style={interactiveOverlayPanelStyle}
        data-testid="code-preview-modal"
      >
        <div className="modal-panel__header">
          <div>
            <p className="settings-sidebar__eyebrow">Code Preview</p>
            <strong data-testid="code-preview-title">{fileName}</strong>
            <div className="conversation-header__meta">
              <span>{compactPath(props.reference.path, 5)}</span>
              {locationLabel ? (
                <>
                  <span>·</span>
                  <span>{locationLabel}</span>
                </>
              ) : null}
              <span>·</span>
              <span>{language}</span>
            </div>
          </div>
          <button className="ghost-button" onClick={props.onClose}>
            关闭
          </button>
        </div>

        {props.loading ? (
          <div className="inspector-empty" style={{ height: "100%" }}>
            <strong>正在加载代码</strong>
            <p>{compactPath(props.reference.path, 5)}</p>
          </div>
        ) : null}

        {!props.loading && props.error ? (
          <div className="inspector-empty" style={{ height: "100%" }}>
            <strong>无法打开代码预览</strong>
            <p>{props.error}</p>
          </div>
        ) : null}

        {!props.loading && !props.error ? (
          <div className="code-preview-editor" data-testid="code-preview-editor">
            <Editor
              key={`${props.reference.path}:${props.reference.line ?? 0}:${props.reference.column ?? 0}`}
              height="100%"
              path={props.reference.path}
              language={language}
              theme="vs-dark"
              value={props.content}
              onMount={handleEditorMount}
              options={{
                readOnly: true,
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                wordWrap: "on",
                lineNumbers: "on",
                glyphMargin: false,
                folding: true,
                renderLineHighlight: "all",
                padding: {
                  top: 14,
                  bottom: 14,
                },
              }}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ImagePreviewModal(props: {
  reference: ImagePreviewReference;
  onClose: () => void;
}) {
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
            <p className="settings-sidebar__eyebrow">Image Preview</p>
            {props.reference.label ? (
              <strong>{props.reference.label}</strong>
            ) : (
              <strong>查看图片</strong>
            )}
          </div>
          <button className="ghost-button" onClick={props.onClose}>
            关闭
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
  return (
    <div className="overlay-shell">
      <div className="blocking-card">
        <p className="settings-sidebar__eyebrow">Authentication Required</p>
        <h2>先在目标服务器执行 `codex login`</h2>
        <p>
          这个 Web 工作台不会在浏览器里代办登录。必须先在运行 app-server 的那台机器上完成
          Codex CLI 认证，然后再刷新页面。
        </p>
        {email ? <p className="muted">Last known account: {email}</p> : null}
        <pre>ssh your-server && codex login</pre>
      </div>
    </div>
  );
}

function StatusPill(props: {
  label: string;
  tone: "green" | "amber" | "slate";
}) {
  return <span className={`status-pill status-pill--${props.tone}`}>{props.label}</span>;
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
  justifyItems: "end",
  alignItems: "start",
  paddingLeft: "calc(var(--sidebar-width) + 24px)",
  background: "rgba(5, 6, 10, 0.2)",
};

const dockedSettingsPanelStyle: CSSProperties = {
  ...interactiveOverlayPanelStyle,
  width: "min(980px, calc(100vw - var(--sidebar-width) - 36px))",
  maxHeight: "calc(100vh - 48px)",
};

function FolderIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="M2.5 6a2 2 0 0 1 2-2h3.1c.34 0 .66.16.85.42l.95 1.28c.19.26.5.42.84.42h5.25a2 2 0 0 1 2 2v5.75a2 2 0 0 1-2 2H4.5a2 2 0 0 1-2-2z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function FolderOpenIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="M2.5 7.25a2 2 0 0 1 2-2h3.1c.34 0 .66.16.85.42l.95 1.28c.19.26.5.42.84.42h4.3a2 2 0 0 1 1.95 2.46l-.8 3.6a2 2 0 0 1-1.95 1.54H4.55a2 2 0 0 1-1.95-2.4z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M2.7 8h14.1"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function FolderPlusIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="M2.5 5.5a2 2 0 0 1 2-2h3l1.4 1.7a1 1 0 0 0 .78.36h5.82a2 2 0 0 1 2 2v6.75a2 2 0 0 1-2 2H4.5a2 2 0 0 1-2-2z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M10 8v5M7.5 10.5h5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ComposeIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="M4.25 5.75A1.5 1.5 0 0 1 5.75 4.25h6.5a1.5 1.5 0 0 1 1.5 1.5v1.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M4.25 9.25v5a1.5 1.5 0 0 0 1.5 1.5h6.5a1.5 1.5 0 0 0 1.5-1.5V11.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M10.9 9.2 15.6 4.5a1.35 1.35 0 0 1 1.9 0 1.35 1.35 0 0 1 0 1.9L12.8 11.1 10 12z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function BoltIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="M11.8 1.8 4.7 10h4l-1 8.2L15.3 10h-4.1l.6-8.2Z"
        fill="currentColor"
      />
    </svg>
  );
}

function ReasoningEffortIcon(props: { effort: ReasoningEffort }) {
  const accentCount =
    props.effort === "minimal"
      ? 1
      : props.effort === "low"
        ? 2
        : props.effort === "medium"
          ? 3
          : props.effort === "high"
            ? 4
            : props.effort === "xhigh"
              ? 5
              : 0;

  if (props.effort === "none") {
    return (
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <circle cx="10" cy="10" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <path
          d="M6.2 13.8 13.8 6.2"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="M7.3 3.1a3 3 0 0 0-3 3v.25a2.8 2.8 0 0 0 .4 5.56h.22a2.9 2.9 0 0 0 2.77 2.98h.08a2.9 2.9 0 0 0 2.2-1v-8.9a2.95 2.95 0 0 0-2.7-1.9Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M12.7 3.1a3 3 0 0 1 3 3v.25a2.8 2.8 0 0 1-.4 5.56h-.22a2.9 2.9 0 0 1-2.77 2.98h-.08a2.9 2.9 0 0 1-2.2-1v-8.9a2.95 2.95 0 0 1 2.7-1.9Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {accentCount >= 2 ? (
        <path
          d="M8 6.4c.78.14 1.45.58 1.86 1.18M8.1 10.1c.92.08 1.67.5 2.14 1.1"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.15"
          strokeLinecap="round"
        />
      ) : null}
      {accentCount >= 3 ? (
        <path
          d="M12 6.4c-.78.14-1.45.58-1.86 1.18M11.9 10.1c-.92.08-1.67.5-2.14 1.1"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.15"
          strokeLinecap="round"
        />
      ) : null}
      {accentCount >= 4 ? (
        <circle cx="10" cy="8.2" r="1.1" fill="currentColor" />
      ) : null}
      {accentCount >= 5 ? (
        <path
          d="M15 2.4v2.1M13.95 3.45h2.1M14.3 2.8l1.4 1.4M15.7 2.8l-1.4 1.4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinecap="round"
        />
      ) : null}
      {accentCount === 1 ? <circle cx="10" cy="10.2" r="1" fill="currentColor" /> : null}
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="m4.9 10.4 3.2 3.2 7-7"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="m8.1 2.9.45 1.7a5.9 5.9 0 0 1 2.9 0l.45-1.7 1.9.8-.5 1.7c.48.34.91.76 1.26 1.24l1.72-.5.79 1.9-1.7.45a5.9 5.9 0 0 1 0 2.9l1.7.45-.8 1.9-1.71-.5a5.9 5.9 0 0 1-1.25 1.25l.5 1.71-1.9.79-.45-1.7a5.9 5.9 0 0 1-2.9 0l-.45 1.7-1.9-.8.5-1.7a5.9 5.9 0 0 1-1.24-1.26l-1.72.5-.79-1.9 1.7-.45a5.9 5.9 0 0 1 0-2.9l-1.7-.45.8-1.9 1.71.5c.34-.48.76-.9 1.25-1.25l-.5-1.71z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <circle cx="10" cy="10" r="2.3" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function MoreIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="4" cy="10" r="1.4" fill="currentColor" />
      <circle cx="10" cy="10" r="1.4" fill="currentColor" />
      <circle cx="16" cy="10" r="1.4" fill="currentColor" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="M13.8 3.6a1.7 1.7 0 0 1 2.4 0l.2.2a1.7 1.7 0 0 1 0 2.4l-7.8 7.8-3.5.9.9-3.5 7.8-7.8Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path
        d="M11.9 5.5 14.5 8.1"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function SendArrowIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="m10 3.8 4.8 4.8-1.1 1.1-2.9-2.8v8.3H9.2V6.9L6.4 9.7 5.2 8.6 10 3.8Z"
        fill="currentColor"
      />
    </svg>
  );
}

function InterruptIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <rect x="5.2" y="5.2" width="9.6" height="9.6" rx="2.2" fill="currentColor" />
    </svg>
  );
}

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
      label: "新线程",
      description: input.activeThreadEntry ? "切回空白输入态，准备新建线程" : "准备开始一个新的 thread",
      run: input.onNewThread,
    },
    {
      id: "workspace",
      label: "新建项目",
      description: "打开项目注册面板",
      run: input.onOpenWorkspaceModal,
    },
    {
      id: "settings",
      label: "打开设置",
      description: "查看账号、模型、MCP、skills 和 archived threads",
      run: input.onOpenSettings,
    },
    {
      id: "archived",
      label: input.archivedMode === "archived" ? "切回活跃线程" : "切到归档线程",
      description: "切换当前 sidebar 线程视图",
      run: input.onToggleArchived,
    },
    {
      id: "review",
      label: "切到 Review",
      description: "右侧 inspector 切到 review 面板",
      run: () => input.onFocusInspector("review"),
    },
    {
      id: "command",
      label: "切到 Command",
      description: "右侧 inspector 切到 command 面板",
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
    return "按需确认";
  }

  if (value === "on-failure") {
    return "失败后确认";
  }

  if (value === "untrusted") {
    return "高风险时确认";
  }

  if (value === "never") {
    return "从不询问";
  }

  return "默认";
}

function formatSandboxMode(value: SandboxMode | null | undefined): string {
  if (value === "danger-full-access") {
    return "full access";
  }

  if (value === "workspace-write") {
    return "workspace write";
  }

  if (value === "read-only") {
    return "read only";
  }

  return "default";
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

  return "未命名线程";
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
  return REASONING_EFFORT_LABELS[value] ?? value;
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
    icon: <ReasoningEffortIcon effort={effort} />,
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

  const delta = Math.max(0, now - normalizedUpdatedAt);
  if (delta < 60_000) {
    return "刚刚";
  }

  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const week = 7 * day;
  const month = 30 * day;
  const year = 365 * day;

  if (delta < hour) {
    return `${Math.floor(delta / minute)}分`;
  }

  if (delta < day) {
    return `${Math.floor(delta / hour)}时`;
  }

  if (delta < week) {
    return `${Math.floor(delta / day)}天`;
  }

  if (delta < month) {
    return `${Math.floor(delta / week)}周`;
  }

  if (delta < year) {
    return `${Math.floor(delta / month)}月`;
  }

  return `${Math.floor(delta / year)}年`;
}

function formatAbsoluteDateTime(timestamp: number): string {
  const normalizedTimestamp = normalizeTimestamp(timestamp);
  if (!Number.isFinite(normalizedTimestamp) || normalizedTimestamp <= 0) {
    return "";
  }

  return new Date(normalizedTimestamp).toLocaleString("zh-CN", {
    hour12: false,
  });
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

function describeThreadStatus(status: ThreadSummary["status"] | string | null | undefined): string {
  if (!status) {
    return "unknown";
  }

  if (typeof status === "string") {
    return status;
  }

  if (status.type === "active") {
    return "active";
  }

  return status.type ?? "unknown";
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
    return "已完成";
  }

  if (status === "in_progress" || status === "inProgress" || status === "running" || status === "active") {
    return "进行中";
  }

  if (status === "pending" || status === "not_started" || status === "todo") {
    return "待开始";
  }

  return status || "待开始";
}

function isNearBottom(element: HTMLElement): boolean {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= 72;
}

function isMessageEntry(kind: TimelineEntry["kind"] | string): boolean {
  return kind === "userMessage" || kind === "agentMessage";
}

function shouldCollapseActivityByDefault(kind: TimelineEntry["kind"]): boolean {
  return (
    kind === "reasoning" ||
    kind === "plan" ||
    kind === "commandExecution" ||
    kind === "fileChange" ||
    kind === "mcpToolCall" ||
    kind === "dynamicToolCall" ||
    kind === "collabAgentToolCall" ||
    kind === "webSearch" ||
    kind === "imageGeneration"
  );
}

function describeActivitySummary(entry: TimelineEntry): string {
  const raw = asRecord(entry.raw);

  switch (entry.kind) {
    case "reasoning":
      return entry.body.trim() ? "思考过程" : "正在思考";
    case "plan":
      return "已更新计划";
    case "commandExecution": {
      const command = readString(raw, "command") ?? entry.title;
      return `${describeExecutionStatus(readString(raw, "status"), "正在执行", "已执行", "执行失败", "已拒绝执行")} \`${command}\``;
    }
    case "fileChange": {
      const changes = readArray(raw, "changes");
      const status = readString(raw, "status");
      const fileLabel = changes.length > 0 ? ` ${changes.length} 个文件` : "";
      return `${describeExecutionStatus(status, "正在修改", "已修改", "修改失败", "已拒绝修改")}${fileLabel}`;
    }
    case "mcpToolCall": {
      const server = readString(raw, "server") ?? "MCP";
      const tool = readString(raw, "tool") ?? entry.title;
      return `${describeExecutionStatus(readString(raw, "status"), "正在调用", "已调用", "调用失败", "调用失败")} \`${server} / ${tool}\``;
    }
    case "dynamicToolCall": {
      const tool = readString(raw, "tool") ?? entry.title;
      return `${describeExecutionStatus(readString(raw, "status"), "正在调用", "已调用", "调用失败", "调用失败")} \`${tool}\``;
    }
    case "collabAgentToolCall": {
      const tool = readString(raw, "tool") ?? entry.title;
      return `${describeExecutionStatus(readString(raw, "status"), "正在协作", "已完成协作", "协作失败", "协作失败")} \`${tool}\``;
    }
    case "webSearch": {
      const action = asRecord(raw?.action);
      if (readString(action, "type") === "openPage") {
        return `打开页面 \`${readString(action, "url") ?? entry.body}\``;
      }
      if (readString(action, "type") === "findInPage") {
        return `页内搜索 \`${readString(action, "pattern") ?? entry.body}\``;
      }
      return `搜索 \`${readString(raw, "query") ?? entry.body}\``;
    }
    case "enteredReviewMode":
      return "进入 review";
    case "exitedReviewMode":
      return "完成 review";
    case "imageView":
      return `查看图片 \`${readString(raw, "path") ?? entry.title}\``;
    case "imageGeneration":
      return `${describeImageGenerationStatus(readString(raw, "status"))} 图片`;
    case "contextCompaction":
      return "已压缩上下文";
    default:
      return entry.title || String(entry.kind);
  }
}

function describeActivityDetails(entry: TimelineEntry): string | null {
  const raw = asRecord(entry.raw);

  switch (entry.kind) {
    case "reasoning":
    case "plan":
      return entry.body.trim() || null;
    case "commandExecution": {
      const parts: Array<string> = [];
      const cwd = readString(raw, "cwd");
      const output = readString(raw, "aggregatedOutput") ?? entry.body;
      const exitCode = readNumber(raw, "exitCode");
      const durationMs = readNumber(raw, "durationMs");

      if (cwd) {
        parts.push(`目录：\`${compactPath(cwd, 4)}\``);
      }
      if (Number.isFinite(exitCode)) {
        parts.push(`退出码：\`${String(exitCode)}\``);
      }
      if (durationMs !== null && Number.isFinite(durationMs)) {
        parts.push(`耗时：\`${formatDuration(durationMs)}\``);
      }
      if (output.trim()) {
        parts.push(`\`\`\`text\n${output.trim()}\n\`\`\``);
      }
      return parts.join("\n\n") || null;
    }
    case "fileChange": {
      const changes = readArray(raw, "changes")
        .map(asRecord)
        .filter((change): change is Record<string, unknown> => change !== null);
      if (changes.length === 0) {
        return entry.body.trim() || null;
      }

      return changes
        .map((change) => `- ${describePatchChange(change)} \`${compactPath(readString(change, "path") ?? "", 4)}\``)
        .join("\n");
    }
    case "mcpToolCall": {
      const parts: Array<string> = [];
      const args = raw?.arguments;
      const result = raw?.result;
      const error = asRecord(raw?.error);
      const durationMs = readNumber(raw, "durationMs");

      if (args !== undefined) {
        parts.push(`参数\n\n\`\`\`json\n${safeJson(args)}\n\`\`\``);
      }
      if (result !== undefined && result !== null) {
        parts.push(`结果\n\n\`\`\`json\n${safeJson(result)}\n\`\`\``);
      } else if (entry.body.trim()) {
        parts.push(entry.body.trim());
      }
      if (error && readString(error, "message")) {
        parts.push(`错误：${readString(error, "message")}`);
      }
      if (durationMs !== null && Number.isFinite(durationMs)) {
        parts.push(`耗时：\`${formatDuration(durationMs)}\``);
      }
      return parts.join("\n\n") || null;
    }
    case "dynamicToolCall": {
      const parts: Array<string> = [];
      const args = raw?.arguments;
      const contentItems = readArray(raw, "contentItems");
      const durationMs = readNumber(raw, "durationMs");
      const success = readBoolean(raw, "success");

      if (args !== undefined) {
        parts.push(`参数\n\n\`\`\`json\n${safeJson(args)}\n\`\`\``);
      }
      if (contentItems.length > 0) {
        parts.push(formatDynamicToolOutput(contentItems));
      } else if (entry.body.trim()) {
        parts.push(entry.body.trim());
      }
      if (success !== null) {
        parts.push(success ? "执行成功" : "执行失败");
      }
      if (durationMs !== null && Number.isFinite(durationMs)) {
        parts.push(`耗时：\`${formatDuration(durationMs)}\``);
      }
      return parts.join("\n\n") || null;
    }
    case "collabAgentToolCall": {
      const parts: Array<string> = [];
      const prompt = readString(raw, "prompt");
      const receiverThreadIds = readArray(raw, "receiverThreadIds")
        .map((value) => (typeof value === "string" ? value : null))
        .filter(Boolean);

      if (prompt) {
        parts.push(prompt);
      }
      if (receiverThreadIds.length > 0) {
        parts.push(`接收线程：${receiverThreadIds.map((id) => `\`${id}\``).join("、")}`);
      }
      return parts.join("\n\n") || null;
    }
    case "webSearch": {
      const action = asRecord(raw?.action);
      const queries = readArray(action, "queries")
        .map((value) => (typeof value === "string" ? value : null))
        .filter(Boolean);
      if (queries.length > 0) {
        return queries.map((query) => `- \`${query}\``).join("\n");
      }
      if (entry.body.trim()) {
        return entry.body.trim();
      }
      return null;
    }
    case "enteredReviewMode":
    case "exitedReviewMode":
      return describeReviewSummary(readString(raw, "review"));
    case "imageGeneration": {
      const revisedPrompt = readString(raw, "revisedPrompt");
      const result = readString(raw, "result");
      return [revisedPrompt, result].filter(Boolean).join("\n\n") || null;
    }
    default:
      return entry.body.trim() || null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function readString(record: Record<string, unknown> | null, key: string): string | null {
  if (!record) {
    return null;
  }
  const value = record[key];
  return typeof value === "string" ? value : null;
}

function readNumber(record: Record<string, unknown> | null, key: string): number | null {
  if (!record) {
    return null;
  }
  const value = record[key];
  return typeof value === "number" ? value : null;
}

function readBoolean(record: Record<string, unknown> | null, key: string): boolean | null {
  if (!record) {
    return null;
  }
  const value = record[key];
  return typeof value === "boolean" ? value : null;
}

function readArray(record: Record<string, unknown> | null, key: string): Array<unknown> {
  if (!record) {
    return [];
  }
  const value = record[key];
  return Array.isArray(value) ? value : [];
}

function describeExecutionStatus(
  status: string | null,
  inProgress: string,
  completed: string,
  failed: string,
  declined: string,
): string {
  if (status === "completed") {
    return completed;
  }
  if (status === "failed") {
    return failed;
  }
  if (status === "declined") {
    return declined;
  }
  return inProgress;
}

function describePatchChange(change: Record<string, unknown>): string {
  const kind = asRecord(change.kind);
  const type = readString(kind, "type");
  if (type === "add") {
    return "新增";
  }
  if (type === "delete") {
    return "删除";
  }

  const movePath = readString(kind, "move_path");
  if (movePath) {
    return `移动到 \`${compactPath(movePath, 4)}\``;
  }

  return "编辑";
}

function describeReviewSummary(review: string | null): string | null {
  if (!review) {
    return null;
  }

  try {
    const parsed = JSON.parse(review) as {
      findings?: Array<unknown>;
      overall_correctness?: string;
      overall_explanation?: string;
    };
    const parts = [
      parsed.overall_correctness ? `结论：${parsed.overall_correctness}` : null,
      typeof parsed.findings?.length === "number" ? `发现：${parsed.findings.length} 条` : null,
      parsed.overall_explanation ?? null,
    ].filter(Boolean);
    return parts.join("\n\n");
  } catch {
    return review;
  }
}

function formatDynamicToolOutput(items: Array<unknown>): string {
  const lines = items
    .map(asRecord)
    .filter(Boolean)
    .map((item) => {
      const type = readString(item, "type");
      if (type === "inputText") {
        return readString(item, "text");
      }
      if (type === "inputImage") {
        const imageUrl = readString(item, "imageUrl");
        return imageUrl ? `![](${imageUrl})` : null;
      }
      return safeJson(item);
    })
    .filter(Boolean);

  return lines.join("\n\n");
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function formatDuration(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return "0 ms";
  }
  if (value < 1000) {
    return `${Math.round(value)} ms`;
  }
  if (value < 60_000) {
    return `${(value / 1000).toFixed(1)} s`;
  }
  return `${(value / 60_000).toFixed(1)} min`;
}

function describeImageGenerationStatus(status: string | null): string {
  if (status === "completed") {
    return "已生成";
  }
  if (status === "failed") {
    return "生成失败";
  }
  return "正在生成";
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

function summarizeDiffFiles(diff: string): Array<string> {
  return diff
    .split("\n")
    .filter((line) => line.startsWith("diff --git "))
    .map((line) => line.replace("diff --git a/", "").replace(/^(.+?) b\/.+$/, "$1"));
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

function dedupeThreads(entries: Array<ThreadSummary>): Array<ThreadSummary> {
  const map = new Map<string, ThreadSummary>();
  for (const entry of entries) {
    map.set(entry.id, entry);
  }

  return [...map.values()];
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
