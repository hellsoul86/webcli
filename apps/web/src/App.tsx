import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import Editor from "@monaco-editor/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  FuzzyFileSearchResponse,
  GetAuthStatusResponse,
  RequestId,
  ReviewOutputEvent,
  ServerWsMessage,
  Thread,
  ThreadListEntry,
  ThreadResumeResponse,
  ThreadStartResponse,
  Turn,
  TurnStartResponse,
  WorkspaceRecord,
} from "@webcli/codex-protocol";
import type { AppInfo } from "../../../packages/codex-protocol/src/generated/v2/AppInfo";
import type { CommandExecResponse } from "../../../packages/codex-protocol/src/generated/v2/CommandExecResponse";
import type { ConfigReadResponse } from "../../../packages/codex-protocol/src/generated/v2/ConfigReadResponse";
import type { ListMcpServerStatusResponse } from "../../../packages/codex-protocol/src/generated/v2/ListMcpServerStatusResponse";
import type { McpServerOauthLoginResponse } from "../../../packages/codex-protocol/src/generated/v2/McpServerOauthLoginResponse";
import type { PluginListResponse } from "../../../packages/codex-protocol/src/generated/v2/PluginListResponse";
import type { SkillsListResponse } from "../../../packages/codex-protocol/src/generated/v2/SkillsListResponse";
import type { ThreadArchiveResponse } from "../../../packages/codex-protocol/src/generated/v2/ThreadArchiveResponse";
import type { ThreadForkResponse } from "../../../packages/codex-protocol/src/generated/v2/ThreadForkResponse";
import type { ThreadLoadedListResponse } from "../../../packages/codex-protocol/src/generated/v2/ThreadLoadedListResponse";
import type { ThreadRollbackResponse } from "../../../packages/codex-protocol/src/generated/v2/ThreadRollbackResponse";
import type { ThreadSetNameResponse } from "../../../packages/codex-protocol/src/generated/v2/ThreadSetNameResponse";
import type { ThreadUnarchiveResponse } from "../../../packages/codex-protocol/src/generated/v2/ThreadUnarchiveResponse";
import type { TurnPlanStep } from "../../../packages/codex-protocol/src/generated/v2/TurnPlanStep";
import { api } from "./api";
import { codexClient, isServerRequestNotification } from "./lib/codex-client";
import {
  selectTimeline,
  useWorkbenchStore,
  type CommandSession,
  type InspectorTab,
  type PendingApproval,
  type SettingsTab,
  type TimelineEntry,
} from "./store/workbench-store";

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

const DEFAULT_SIDEBAR_WIDTH = 326;
const SIDEBAR_WIDTH_STORAGE_KEY = "webcli.sidebarWidth";

export function App() {
  const queryClient = useQueryClient();
  const connection = useWorkbenchStore((state) => state.connection);
  const activeWorkspaceId = useWorkbenchStore((state) => state.activeWorkspaceId);
  const activeThreadId = useWorkbenchStore((state) => state.activeThreadId);
  const inspectorTab = useWorkbenchStore((state) => state.inspectorTab);
  const pendingApprovals = useWorkbenchStore((state) => state.pendingApprovals);
  const threads = useWorkbenchStore((state) => state.threads);
  const threadLifecycle = useWorkbenchStore((state) => state.threadLifecycle);
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
  const renameThread = useWorkbenchStore((state) => state.renameThread);
  const markThreadArchived = useWorkbenchStore((state) => state.markThreadArchived);
  const applyTurn = useWorkbenchStore((state) => state.applyTurn);
  const applyItemNotification = useWorkbenchStore((state) => state.applyItemNotification);
  const appendDelta = useWorkbenchStore((state) => state.appendDelta);
  const setLatestDiff = useWorkbenchStore((state) => state.setLatestDiff);
  const setLatestPlan = useWorkbenchStore((state) => state.setLatestPlan);
  const setReview = useWorkbenchStore((state) => state.setReview);
  const queueApproval = useWorkbenchStore((state) => state.queueApproval);
  const resolveApproval = useWorkbenchStore((state) => state.resolveApproval);
  const startCommandSession = useWorkbenchStore((state) => state.startCommandSession);
  const appendCommandOutput = useWorkbenchStore((state) => state.appendCommandOutput);
  const completeCommandSession = useWorkbenchStore((state) => state.completeCommandSession);
  const failCommandSession = useWorkbenchStore((state) => state.failCommandSession);
  const setIntegrations = useWorkbenchStore((state) => state.setIntegrations);
  const setFuzzySearch = useWorkbenchStore((state) => state.setFuzzySearch);
  const clearFuzzySearch = useWorkbenchStore((state) => state.clearFuzzySearch);

  const [composer, setComposer] = useState("");
  const [workspaceEditor, setWorkspaceEditor] = useState<WorkspaceRecord | null>(null);
  const [workspaceModalOpen, setWorkspaceModalOpen] = useState(false);
  const [expandedWorkspaceIds, setExpandedWorkspaceIds] = useState<Array<string>>([]);
  const [threadMenuId, setThreadMenuId] = useState<string | null>(null);
  const [settingsNotice, setSettingsNotice] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [commandInput, setCommandInput] = useState("git status");
  const [commandStdin, setCommandStdin] = useState("");
  const [commandCols, setCommandCols] = useState("120");
  const [commandRows, setCommandRows] = useState("30");
  const [relativeTimeNow, setRelativeTimeNow] = useState(() => Date.now());
  const [sidebarWidth, setSidebarWidth] = useState(() => readInitialSidebarWidth());
  const [sidebarResizing, setSidebarResizing] = useState(false);
  const requestedThreadIdRef = useRef<string | null>(null);
  const sidebarResizeStateRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const expandedWorkspacesInitializedRef = useRef(false);

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

      setSidebarWidth(
        clampSidebarWidth(state.startWidth + event.clientX - state.startX, window.innerWidth),
      );
    };

    const stopResizing = () => {
      sidebarResizeStateRef.current = null;
      setSidebarResizing(false);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopResizing);
    window.addEventListener("pointercancel", stopResizing);

    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopResizing);
      window.removeEventListener("pointercancel", stopResizing);
    };
  }, [sidebarResizing]);

  const accountQuery = useQuery({
    queryKey: ["account"],
    queryFn: api.account,
    refetchInterval: 30_000,
  });
  const modelsQuery = useQuery({
    queryKey: ["models"],
    queryFn: api.models,
  });
  const workspacesQuery = useQuery({
    queryKey: ["workspaces"],
    queryFn: api.workspaces,
  });
  const activeThreadsQuery = useQuery({
    queryKey: ["threads", "all", "active"],
    queryFn: () =>
      api.threads({
        workspaceId: "all",
        archived: false,
      }),
  });
  const archivedThreadsQuery = useQuery({
    queryKey: ["threads", "all", "archived"],
    queryFn: () =>
      api.threads({
        workspaceId: "all",
        archived: true,
      }),
  });
  const loadedThreadsQuery = useQuery({
    queryKey: ["loaded-threads"],
    queryFn: listLoadedThreadIds,
    refetchInterval: 5_000,
  });
  const authStatusQuery = useQuery({
    queryKey: ["auth-status"],
    queryFn: () =>
      codexClient.call<GetAuthStatusResponse, "getAuthStatus">("getAuthStatus", {
        includeToken: false,
        refreshToken: false,
      }),
    enabled: integrations.settingsOpen,
  });
  const configQuery = useQuery({
    queryKey: ["config", activeWorkspaceId],
    queryFn: () =>
      codexClient.call<ConfigReadResponse, "config/read">("config/read", {
        includeLayers: true,
        cwd: selectedWorkspacePath(workspacesQuery.data ?? [], activeWorkspaceId),
      }),
    enabled: integrations.settingsOpen,
  });
  const mcpQuery = useQuery({
    queryKey: ["mcp-servers"],
    queryFn: listAllMcpServers,
    enabled: integrations.settingsOpen,
  });
  const skillsQuery = useQuery({
    queryKey: ["skills", activeWorkspaceId],
    queryFn: () =>
      codexClient.call<SkillsListResponse, "skills/list">("skills/list", {
        cwds: selectedWorkspacePath(workspacesQuery.data ?? [], activeWorkspaceId)
          ? [selectedWorkspacePath(workspacesQuery.data ?? [], activeWorkspaceId)!]
          : undefined,
        forceReload: false,
      }),
    enabled: integrations.settingsOpen,
  });
  const appsQuery = useQuery({
    queryKey: ["apps", activeThreadId],
    queryFn: () => listAllApps(activeThreadId),
    enabled: integrations.settingsOpen,
  });
  const pluginsQuery = useQuery({
    queryKey: ["plugins", activeWorkspaceId],
    queryFn: () =>
      codexClient.call<PluginListResponse, "plugin/list">("plugin/list", {
        cwds: selectedWorkspacePath(workspacesQuery.data ?? [], activeWorkspaceId)
          ? [selectedWorkspacePath(workspacesQuery.data ?? [], activeWorkspaceId)!]
          : undefined,
      }),
    enabled: integrations.settingsOpen,
  });

  const workspaces = workspacesQuery.data ?? [];
  const activeThreadEntries = activeThreadsQuery.data?.data ?? [];
  const archivedThreadEntries = archivedThreadsQuery.data?.data ?? [];
  const allThreadEntries = dedupeThreads([...activeThreadEntries, ...archivedThreadEntries]);
  const loadedThreadIds = loadedThreadsQuery.data ?? [];
  const loadedThreadIdSet = useMemo(() => new Set(loadedThreadIds), [loadedThreadIds]);
  const activeThreadEntry = allThreadEntries.find((thread) => thread.id === activeThreadId) ?? null;
  const sidebarThreadsReady =
    workspacesQuery.isFetched && activeThreadsQuery.isFetched && loadedThreadsQuery.isFetched;
  const workspaceTree = useMemo(
    () =>
      workspaces.map((workspace) => {
        const activeThreads = activeThreadEntries.filter((thread) => thread.workspaceId === workspace.id);
        const loadedThreads = allThreadEntries.filter(
          (thread) => thread.workspaceId === workspace.id && loadedThreadIdSet.has(thread.id),
        );

        return {
          workspace,
          threads: dedupeThreads([...loadedThreads, ...activeThreads]).sort(
            (left, right) => right.updatedAt - left.updatedAt,
          ),
        };
      }),
    [activeThreadEntries, allThreadEntries, loadedThreadIdSet, workspaces],
  );
  const activeThreadView = activeThreadId ? threads[activeThreadId] ?? null : null;
  const activeThreadArchived = activeThreadEntry?.archived ?? activeThreadView?.archived ?? false;
  const selectedWorkspace =
    workspaces.find((workspace) => workspace.id === activeWorkspaceId) ??
    workspaces.find((workspace) => workspace.id === activeThreadEntry?.workspaceId) ??
    null;
  const timeline = useMemo(() => selectTimeline(activeThreadView), [activeThreadView]);
  const diffStats = useMemo(
    () => summarizeDiff(activeThreadView?.latestDiff ?? ""),
    [activeThreadView?.latestDiff],
  );
  const diffFiles = useMemo(
    () => summarizeDiffFiles(activeThreadView?.latestDiff ?? ""),
    [activeThreadView?.latestDiff],
  );
  const latestCommandSession = commandOrder.length > 0 ? commandSessions[commandOrder[0]] : null;
  const activeTurn = activeThreadView ? findActiveTurn(activeThreadView) : null;
  const blocking = accountQuery.data && !accountQuery.data.authenticated;
  const paletteActions = useMemo(
    () => buildPaletteActions({
      activeThreadView,
      selectedWorkspace,
      archivedMode: threadLifecycle.archivedMode,
    }),
    [activeThreadView, selectedWorkspace, threadLifecycle.archivedMode],
  );
  const filteredPaletteActions = paletteActions.filter((action) =>
    [action.label, action.description].join(" ").toLowerCase().includes(paletteQuery.toLowerCase()),
  );
  const threadTitle =
    formatThreadTitle(activeThreadView?.thread ?? activeThreadEntry ?? null) ??
    selectedWorkspace?.name ??
    "选择线程";
  const threadSubtitle = activeThreadView
    ? [
        describeThreadStatus(activeThreadView.thread.status),
        activeThreadArchived ? "已归档" : null,
        compactPath(activeThreadView.thread.cwd, 4),
      ]
        .filter(Boolean)
        .join(" · ")
    : selectedWorkspace
      ? compactPath(selectedWorkspace.absPath, 4)
      : "先注册一个项目路径，然后再开始线程。";
  const sidebarBounds = getSidebarWidthBounds();
  const desktopShellStyle = useMemo(
    () =>
      ({
        "--sidebar-width": `${sidebarWidth}px`,
      }) as CSSProperties,
    [sidebarWidth],
  );

  useEffect(() => {
    if (workspaces.length > 0 && activeWorkspaceId === "all") {
      return;
    }
  }, [activeWorkspaceId, workspaces]);

  useEffect(() => {
    if (workspaces.length > 0 && activeWorkspaceId === "all") {
      return;
    }

    if (workspaces.length > 0 && !workspaces.some((workspace) => workspace.id === activeWorkspaceId)) {
      setActiveWorkspace(workspaces[0].id);
    }
  }, [activeWorkspaceId, setActiveWorkspace, workspaces]);

  useEffect(() => {
    for (const entry of allThreadEntries) {
      if (threads[entry.id] && threads[entry.id]!.archived !== entry.archived) {
        markThreadArchived(entry.id, entry.archived);
      }
    }
  }, [allThreadEntries, markThreadArchived, threads]);

  useEffect(() => {
    if (expandedWorkspacesInitializedRef.current) {
      return;
    }

    if (!sidebarThreadsReady || workspaceTree.length === 0) {
      return;
    }

    setExpandedWorkspaceIds(
      workspaceTree.filter((group) => group.threads.length > 0).map((group) => group.workspace.id),
    );
    expandedWorkspacesInitializedRef.current = true;
  }, [sidebarThreadsReady, workspaceTree]);

  useEffect(() => {
    if (activeWorkspaceId === "all") {
      return;
    }

    setExpandedWorkspaceIds((current) =>
      current.includes(activeWorkspaceId) ? current : [...current, activeWorkspaceId],
    );
  }, [activeWorkspaceId]);

  useEffect(() => {
    void codexClient.connect();
    const unsubscribeMessages = codexClient.subscribe((message) => {
      handleServerMessage(message, {
        queryClient,
        setConnection,
        upsertThread,
        renameThread,
        markThreadArchived,
        applyTurn,
        applyItemNotification,
        appendDelta,
        setLatestDiff,
        setLatestPlan,
        setReview,
        queueApproval,
        resolveApproval,
        appendCommandOutput,
        setFuzzySearch,
        setArchivedMode,
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
    applyItemNotification,
    applyTurn,
    markThreadArchived,
    queryClient,
    queueApproval,
    renameThread,
    resolveApproval,
    setArchivedMode,
    setConnection,
    setFuzzySearch,
    setLatestDiff,
    setLatestPlan,
    setReview,
    upsertThread,
  ]);

  useEffect(() => {
    if (!activeThreadId) {
      requestedThreadIdRef.current = null;
      return;
    }

    if (threads[activeThreadId]) {
      return;
    }

    requestedThreadIdRef.current = activeThreadId;
    const threadPath = allThreadEntries.find((thread) => thread.id === activeThreadId)?.path ?? null;
    void resumeThread(activeThreadId, threadPath)
      .then((thread) => {
        if (requestedThreadIdRef.current !== activeThreadId) {
          return;
        }
        hydrateThread(thread);
        void queryClient.invalidateQueries({ queryKey: ["loaded-threads"] });
      })
      .catch(() => {});
  }, [activeThreadId, allThreadEntries, hydrateThread, queryClient, threads]);

  function handleSidebarResizeStart(event: ReactPointerEvent<HTMLDivElement>): void {
    if (window.innerWidth <= 1120) {
      return;
    }

    event.preventDefault();
    sidebarResizeStateRef.current = {
      startX: event.clientX,
      startWidth: sidebarWidth,
    };
    setSidebarResizing(true);
  }

  function handleSidebarResizeKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
      return;
    }

    event.preventDefault();
    const delta = event.key === "ArrowLeft" ? -24 : 24;
    setSidebarWidth((current) => clampSidebarWidth(current + delta, window.innerWidth));
  }

  useEffect(() => {
    if (authStatusQuery.data) {
      setIntegrations({ authStatus: authStatusQuery.data });
    }
  }, [authStatusQuery.data, setIntegrations]);

  useEffect(() => {
    if (configQuery.data) {
      setIntegrations({ config: configQuery.data });
    }
  }, [configQuery.data, setIntegrations]);

  useEffect(() => {
    if (mcpQuery.data) {
      setIntegrations({ mcpServers: mcpQuery.data });
    }
  }, [mcpQuery.data, setIntegrations]);

  useEffect(() => {
    if (skillsQuery.data) {
      setIntegrations({ skills: skillsQuery.data.data });
    }
  }, [setIntegrations, skillsQuery.data]);

  useEffect(() => {
    if (appsQuery.data) {
      setIntegrations({ apps: appsQuery.data });
    }
  }, [appsQuery.data, setIntegrations]);

  useEffect(() => {
    if (pluginsQuery.data) {
      setIntegrations({ plugins: pluginsQuery.data.marketplaces });
    }
  }, [pluginsQuery.data, setIntegrations]);

  useEffect(() => {
    if (!paletteOpen) {
      clearFuzzySearch();
      return;
    }

    const trimmed = paletteQuery.trim();
    if (!trimmed || !selectedWorkspace) {
      setFuzzySearch({
        sessionId: null,
        query: trimmed,
        status: "idle",
        results: [],
      });
      return;
    }

    const timeout = window.setTimeout(() => {
      setFuzzySearch({
        query: trimmed,
        status: "loading",
        results: [],
      });
      void codexClient
        .call<FuzzyFileSearchResponse, "fuzzyFileSearch">("fuzzyFileSearch", {
          query: trimmed,
          roots: [selectedWorkspace.absPath],
          cancellationToken: null,
        })
        .then((response) => {
          setFuzzySearch({
            query: trimmed,
            status: "completed",
            results: response.files,
          });
        })
        .catch(() => {
          setFuzzySearch({
            query: trimmed,
            status: "completed",
            results: [],
          });
        });
    }, 180);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [clearFuzzySearch, paletteOpen, paletteQuery, selectedWorkspace, setFuzzySearch]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "n") {
        event.preventDefault();
        setActiveThread(null);
        setComposer("");
      }

      if (event.key === "Escape") {
        setThreadMenuId(null);
        setPaletteOpen(false);
        if (workspaceModalOpen) {
          setWorkspaceModalOpen(false);
          setWorkspaceEditor(null);
        }
        if (integrations.settingsOpen) {
          setSettingsOpen(false);
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [integrations.settingsOpen, setActiveThread, setSettingsOpen, workspaceModalOpen]);

  const createWorkspaceMutation = useMutation({
    mutationFn: api.createWorkspace,
    onSuccess: (workspace) => {
      void queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      void queryClient.invalidateQueries({ queryKey: ["threads"] });
      setActiveWorkspace(workspace.id);
      setWorkspaceModalOpen(false);
      setWorkspaceEditor(null);
    },
  });

  const updateWorkspaceMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: WorkspaceFormInput }) =>
      api.updateWorkspace(id, input),
    onSuccess: (workspace) => {
      void queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      void queryClient.invalidateQueries({ queryKey: ["threads"] });
      setActiveWorkspace(workspace.id);
      setWorkspaceModalOpen(false);
      setWorkspaceEditor(null);
    },
  });

  const deleteWorkspaceMutation = useMutation({
    mutationFn: api.deleteWorkspace,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      void queryClient.invalidateQueries({ queryKey: ["threads"] });
      setWorkspaceModalOpen(false);
      setWorkspaceEditor(null);
      setActiveWorkspace("all");
      setActiveThread(null);
    },
  });
  const dismissWorkspaceMutation = useMutation({
    mutationFn: api.dismissWorkspace,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      void queryClient.invalidateQueries({ queryKey: ["threads"] });
      setWorkspaceModalOpen(false);
      setWorkspaceEditor(null);
      setActiveWorkspace("all");
      setActiveThread(null);
    },
  });

  const workspaceMutationError =
    createWorkspaceMutation.error ??
    updateWorkspaceMutation.error ??
    deleteWorkspaceMutation.error ??
    dismissWorkspaceMutation.error;
  const workspaceMutationPending =
    createWorkspaceMutation.isPending ||
    updateWorkspaceMutation.isPending ||
    deleteWorkspaceMutation.isPending ||
    dismissWorkspaceMutation.isPending;

  function resetWorkspaceMutations(): void {
    createWorkspaceMutation.reset();
    updateWorkspaceMutation.reset();
    deleteWorkspaceMutation.reset();
    dismissWorkspaceMutation.reset();
  }

  function openCreateWorkspaceModal(): void {
    resetWorkspaceMutations();
    setWorkspaceEditor(null);
    setWorkspaceModalOpen(true);
  }

  function openEditWorkspaceModal(workspace: WorkspaceRecord): void {
    resetWorkspaceMutations();
    setWorkspaceEditor(workspace);
    setWorkspaceModalOpen(true);
  }

  function handleWorkspaceSubmit(input: WorkspaceFormInput): void {
    if (workspaceEditor?.source === "saved") {
      updateWorkspaceMutation.mutate({
        id: workspaceEditor.id,
        input,
      });
      return;
    }

    createWorkspaceMutation.mutate(input);
  }

  function handleWorkspaceSelect(workspaceId: string | "all"): void {
    requestedThreadIdRef.current = null;
    setActiveWorkspace(workspaceId);
    setActiveThread(null);
    setArchivedMode("active");
    if (workspaceId === "all") {
      setExpandedWorkspaceIds([]);
      return;
    }

    setExpandedWorkspaceIds((current) =>
      current.includes(workspaceId) ? current : [...current, workspaceId],
    );
  }

  function handleWorkspaceCompose(workspaceId: string): void {
    handleWorkspaceSelect(workspaceId);
    setComposer("");
  }

  async function handleSendMessage(): Promise<void> {
    const text = composer.trim();
    if (!text) {
      return;
    }

    let threadId = activeThreadId;
    if (!threadId) {
      if (!selectedWorkspace) {
        return;
      }

      const response = await codexClient.call<ThreadStartResponse, "thread/start">(
        "thread/start",
        {
          cwd: selectedWorkspace.absPath,
          model: selectedWorkspace.defaultModel,
          approvalPolicy: selectedWorkspace.approvalPolicy,
          sandbox: selectedWorkspace.sandboxMode,
          experimentalRawEvents: false,
          persistExtendedHistory: true,
        },
      );
      threadId = response.thread.id;
      setActiveThread(threadId);
      hydrateThread(response.thread);
      void queryClient.invalidateQueries({ queryKey: ["threads"] });
      void queryClient.invalidateQueries({ queryKey: ["loaded-threads"] });
    }

    const response = await codexClient.call<TurnStartResponse, "turn/start">("turn/start", {
      threadId,
      input: [
        {
          type: "text",
          text,
          text_elements: [],
        },
      ],
    });
    applyTurn(threadId, response.turn);
    setComposer("");
  }

  async function handleResumeThread(
    threadId: string,
    workspaceId: string | "all" = "all",
  ): Promise<void> {
    const threadEntry = allThreadEntries.find((thread) => thread.id === threadId) ?? null;
    const resolvedWorkspaceId =
      workspaceId === "all" ? (threadEntry?.workspaceId ?? "all") : workspaceId;

    requestedThreadIdRef.current = threadId;
    setThreadMenuId(null);
    setActiveWorkspace(resolvedWorkspaceId);
    setActiveThread(threadId);
    if (resolvedWorkspaceId !== "all") {
      setExpandedWorkspaceIds((current) =>
        current.includes(resolvedWorkspaceId) ? current : [...current, resolvedWorkspaceId],
      );
    }

    try {
      const threadPath = threadEntry?.path ?? null;
      const thread = await resumeThread(threadId, threadPath);
      if (requestedThreadIdRef.current !== threadId) {
        return;
      }
      hydrateThread(thread);
      void queryClient.invalidateQueries({ queryKey: ["threads"] });
      void queryClient.invalidateQueries({ queryKey: ["loaded-threads"] });
    } catch {}
  }

  async function handleRunReview(): Promise<void> {
    if (!activeThreadId) {
      return;
    }

    const response = await codexClient.call<any, "review/start">("review/start", {
      threadId: activeThreadId,
      target: { type: "uncommittedChanges" },
      delivery: "inline",
    });
    if (response.turn) {
      applyTurn(activeThreadId, response.turn);
    }
    setInspectorTab("review");
  }

  async function handleRenameThread(thread: ThreadListEntry): Promise<void> {
    const nextName = window.prompt("线程名称", thread.name ?? "")?.trim();
    if (!nextName || nextName === thread.name) {
      return;
    }

    await codexClient.call<ThreadSetNameResponse, "thread/name/set">("thread/name/set", {
      threadId: thread.id,
      name: nextName,
    });
    renameThread(thread.id, nextName);
    void queryClient.invalidateQueries({ queryKey: ["threads"] });
  }

  async function handleArchiveThread(thread: ThreadListEntry): Promise<void> {
    await codexClient.call<ThreadArchiveResponse, "thread/archive">("thread/archive", {
      threadId: thread.id,
    });
    markThreadArchived(thread.id, true);
    if (activeThreadId === thread.id) {
      setArchivedMode("archived");
    }
    void queryClient.invalidateQueries({ queryKey: ["threads"] });
    void queryClient.invalidateQueries({ queryKey: ["loaded-threads"] });
  }

  async function handleUnarchiveThread(thread: ThreadListEntry): Promise<void> {
    const response = await codexClient.call<ThreadUnarchiveResponse, "thread/unarchive">(
      "thread/unarchive",
      {
        threadId: thread.id,
      },
    );
    hydrateThread(response.thread);
    markThreadArchived(thread.id, false);
    if (activeThreadId === thread.id) {
      setArchivedMode("active");
    }
    void queryClient.invalidateQueries({ queryKey: ["threads"] });
    void queryClient.invalidateQueries({ queryKey: ["loaded-threads"] });
  }

  async function handleForkThread(thread: ThreadListEntry): Promise<void> {
    const response = await codexClient.call<ThreadForkResponse, "thread/fork">("thread/fork", {
      threadId: thread.id,
      cwd: thread.cwd,
      persistExtendedHistory: true,
    });
    hydrateThread(response.thread);
    setActiveThread(response.thread.id);
    setArchivedMode("active");
    void queryClient.invalidateQueries({ queryKey: ["threads"] });
    void queryClient.invalidateQueries({ queryKey: ["loaded-threads"] });
  }

  async function handleCompactThread(threadId: string): Promise<void> {
    await codexClient.call<Record<string, never>, "thread/compact/start">(
      "thread/compact/start",
      {
        threadId,
      },
    );
  }

  async function handleRollbackThread(threadId: string): Promise<void> {
    const raw = window.prompt("回滚最近多少个 turn？", "1");
    if (!raw) {
      return;
    }

    const numTurns = Number.parseInt(raw, 10);
    if (!Number.isFinite(numTurns) || numTurns < 1) {
      return;
    }

    const response = await codexClient.call<ThreadRollbackResponse, "thread/rollback">(
      "thread/rollback",
      {
        threadId,
        numTurns,
      },
    );
    hydrateThread(response.thread);
    void queryClient.invalidateQueries({ queryKey: ["threads"] });
    void queryClient.invalidateQueries({ queryKey: ["loaded-threads"] });
  }

  async function handleInterrupt(): Promise<void> {
    if (!activeThreadId || !activeTurn) {
      return;
    }

    await codexClient.call<Record<string, never>, "turn/interrupt">("turn/interrupt", {
      threadId: activeThreadId,
      turnId: activeTurn.id,
    });
  }

  async function handleSteer(): Promise<void> {
    if (!activeThreadId || !activeTurn) {
      return;
    }

    const text = window.prompt("向当前 turn 追加指导", "");
    if (!text?.trim()) {
      return;
    }

    await codexClient.call<any, "turn/steer">("turn/steer", {
      threadId: activeThreadId,
      expectedTurnId: activeTurn.id,
      input: [
        {
          type: "text",
          text,
          text_elements: [],
        },
      ],
    });
  }

  async function handleRunCommand(): Promise<void> {
    if (!selectedWorkspace || !commandInput.trim()) {
      return;
    }

    const processId = crypto.randomUUID();
    const cols = sanitizeTerminalSize(commandCols, 120);
    const rows = sanitizeTerminalSize(commandRows, 30);
    startCommandSession({
      processId,
      command: commandInput,
      cwd: selectedWorkspace.absPath,
      tty: true,
      allowStdin: true,
    });
    setInspectorTab("command");

    void codexClient
      .call<CommandExecResponse, "command/exec">("command/exec", {
        command: ["/bin/zsh", "-lc", commandInput],
        processId,
        cwd: selectedWorkspace.absPath,
        tty: true,
        streamStdin: true,
        streamStdoutStderr: true,
        size: { cols, rows },
      })
      .then((response) => {
        completeCommandSession(processId, response);
      })
      .catch((error) => {
        failCommandSession(processId, error instanceof Error ? error.message : "Command failed");
      });
  }

  async function handleSendCommandInput(): Promise<void> {
    if (!latestCommandSession || !commandStdin.trim()) {
      return;
    }

    await codexClient.call<Record<string, never>, "command/exec/write">(
      "command/exec/write",
      {
        processId: latestCommandSession.processId,
        deltaBase64: encodeBase64(`${commandStdin}\n`),
        closeStdin: false,
      },
    );
    setCommandStdin("");
  }

  async function handleResizeCommand(): Promise<void> {
    if (!latestCommandSession) {
      return;
    }

    await codexClient.call<Record<string, never>, "command/exec/resize">(
      "command/exec/resize",
      {
        processId: latestCommandSession.processId,
        size: {
          cols: sanitizeTerminalSize(commandCols, 120),
          rows: sanitizeTerminalSize(commandRows, 30),
        },
      },
    );
  }

  async function handleTerminateCommand(): Promise<void> {
    if (!latestCommandSession) {
      return;
    }

    await codexClient.call<Record<string, never>, "command/exec/terminate">(
      "command/exec/terminate",
      {
        processId: latestCommandSession.processId,
      },
    );
  }

  async function handleConfigSave(next: {
    model: string | null;
    approvalPolicy: string | null;
    sandboxMode: string | null;
  }): Promise<void> {
    await Promise.all([
      codexClient.call<Record<string, never>, "config/value/write">("config/value/write", {
        keyPath: "model",
        value: next.model,
        mergeStrategy: "replace",
      }),
      codexClient.call<Record<string, never>, "config/value/write">("config/value/write", {
        keyPath: "approval_policy",
        value: next.approvalPolicy,
        mergeStrategy: "replace",
      }),
      codexClient.call<Record<string, never>, "config/value/write">("config/value/write", {
        keyPath: "sandbox_mode",
        value: next.sandboxMode,
        mergeStrategy: "replace",
      }),
    ]);

    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["config"] }),
      queryClient.invalidateQueries({ queryKey: ["account"] }),
    ]);
  }

  async function handleMcpLogin(name: string): Promise<void> {
    const response = await codexClient.call<
      McpServerOauthLoginResponse,
      "mcpServer/oauth/login"
    >("mcpServer/oauth/login", {
      name,
    });
    window.open(response.authorizationUrl, "_blank", "noopener,noreferrer");
  }

  async function handleMcpReload(): Promise<void> {
    await codexClient.call<Record<string, never>, "config/mcpServer/reload">(
      "config/mcpServer/reload",
      undefined,
    );
    await queryClient.invalidateQueries({ queryKey: ["mcp-servers"] });
  }

  async function handlePluginUninstall(pluginId: string): Promise<void> {
    await codexClient.call<Record<string, never>, "plugin/uninstall">("plugin/uninstall", {
      pluginId,
    });
    await queryClient.invalidateQueries({ queryKey: ["plugins"] });
  }

  function handlePaletteAction(action: PaletteAction): void {
    setPaletteOpen(false);
    setPaletteQuery("");
    action.run();
  }

  async function resumeThread(threadId: string, path: string | null = null): Promise<Thread> {
    try {
      const response = await codexClient.call<ThreadResumeResponse, "thread/resume">(
        "thread/resume",
        {
          threadId,
          persistExtendedHistory: true,
        },
      );
      return response.thread;
    } catch (error) {
      if (!path) {
        throw error;
      }

      const response = await codexClient.call<ThreadResumeResponse, "thread/resume">(
        "thread/resume",
        {
          threadId,
          path,
          persistExtendedHistory: true,
        },
      );
      return response.thread;
    }
  }

  return (
    <div className="desktop-shell" style={desktopShellStyle}>
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
                  ? "workspace-tree__row workspace-tree__row--active sidebar-tree-toolbar__label"
                  : "workspace-tree__row sidebar-tree-toolbar__label"
              }
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
                  onSelect={() => handleWorkspaceSelect(workspace.id)}
                  onCompose={() => handleWorkspaceCompose(workspace.id)}
                  onEdit={() => openEditWorkspaceModal(workspace)}
                />
                {expandedWorkspaceIds.includes(workspace.id) && workspaceThreads.length > 0 ? (
                  <div className="thread-list thread-list--nested" data-testid={`thread-list-${workspace.id}`}>
                    {workspaceThreads.map((thread) => (
                      <ThreadRow
                        key={thread.id}
                        thread={thread}
                        now={relativeTimeNow}
                        active={thread.id === activeThreadId}
                        nested
                        menuOpen={threadMenuId === thread.id}
                        onClick={() => void handleResumeThread(thread.id, workspace.id)}
                        onToggleMenu={() =>
                          setThreadMenuId((current) => (current === thread.id ? null : thread.id))
                        }
                        onRename={() => void handleRenameThread(thread)}
                        onFork={() => void handleForkThread(thread)}
                        onArchive={() => void handleArchiveThread(thread)}
                        onCompact={() => void handleCompactThread(thread.id)}
                        onRollback={() => void handleRollbackThread(thread.id)}
                      />
                    ))}
                  </div>
                ) : null}
                {expandedWorkspaceIds.includes(workspace.id) && workspaceThreads.length === 0 ? (
                  <div className="sidebar-empty-state sidebar-empty-state--nested">
                    这个工作台里还没有打开会话。
                  </div>
                ) : null}
              </div>
            ))}
            {workspaceTree.every((group) => group.threads.length === 0) ? (
              <div className="sidebar-empty-state">当前工作台里还没有打开会话。</div>
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
            <div className="window-toolbar__eyebrow">
              {activeThreadView ? "线程" : selectedWorkspace ? "项目" : "准备"}
            </div>
            <strong>{threadTitle}</strong>
            <span className="window-toolbar__subtitle">{threadSubtitle}</span>
          </div>

          <div className="window-toolbar__actions">
            <StatusPill
              label={connection.connected ? "Connected" : "Disconnected"}
              tone={connection.connected ? "green" : "amber"}
            />
            {accountQuery.data?.email ? (
              <StatusPill label={accountQuery.data.email} tone="slate" />
            ) : null}
            <button
              className="toolbar-pill-button"
              onClick={() =>
                selectedWorkspace
                  ? openEditWorkspaceModal(selectedWorkspace)
                  : openCreateWorkspaceModal()
              }
            >
              打开
            </button>
            <button
              className="toolbar-pill-button"
              data-testid="command-palette-button"
              onClick={() => setPaletteOpen(true)}
            >
              命令
            </button>
            <button
              className="toolbar-pill-button"
              data-testid="run-review-button"
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
            <header className="conversation-header">
              <div>
                <p className="conversation-header__eyebrow">
                  {selectedWorkspace ? "项目上下文" : "启动"}
                </p>
                <h1>{threadTitle}</h1>
                <div className="conversation-header__meta">
                  {selectedWorkspace ? (
                    <>
                      <span>{selectedWorkspace.name}</span>
                      <span>·</span>
                      <span>{formatApprovalPolicy(selectedWorkspace.approvalPolicy)}</span>
                      <span>·</span>
                      <span>{formatSandboxMode(selectedWorkspace.sandboxMode)}</span>
                    </>
                  ) : (
                    <span>选择一个项目后，就可以开始真实的 Codex 会话。</span>
                  )}
                </div>
              </div>

              <div className="conversation-header__actions">
                <button
                  className="ghost-button"
                  onClick={() => void handleSteer()}
                  disabled={!activeTurn}
                >
                  Steer
                </button>
                <button
                  className="ghost-button"
                  onClick={() => void handleInterrupt()}
                  disabled={!activeTurn}
                >
                  Interrupt
                </button>
                <button
                  className="ghost-button"
                  onClick={() => activeThreadId && void handleCompactThread(activeThreadId)}
                  disabled={!activeThreadId}
                >
                  Compact
                </button>
                <button
                  className="ghost-button"
                  onClick={() => activeThreadId && void handleRollbackThread(activeThreadId)}
                  disabled={!activeThreadId}
                >
                  Rollback
                </button>
              </div>
            </header>

            <div className="conversation-body">
              {!selectedWorkspace && !activeThreadId ? (
                <EmptyWorkspaceState onCreateWorkspace={openCreateWorkspaceModal} />
              ) : activeThreadView ? (
                timeline.length > 0 ? (
                  <div className="timeline-stream">
                    {timeline.map((entry) => (
                      <TimelineCard key={entry.id} entry={entry} />
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
                  workspace={selectedWorkspace}
                  onSuggestionClick={(prompt) => setComposer(prompt)}
                />
              )}
            </div>

            <div className="composer-shell">
              <div className="composer-shell__meta">
                <div className="meta-pill-row">
                  {selectedWorkspace ? (
                    <>
                      <span className="meta-pill meta-pill--accent">{selectedWorkspace.name}</span>
                      {selectedWorkspace.defaultModel ? (
                        <span className="meta-pill">{selectedWorkspace.defaultModel}</span>
                      ) : null}
                      <span className="meta-pill">
                        {formatApprovalPolicy(selectedWorkspace.approvalPolicy)}
                      </span>
                      <span className="meta-pill">
                        {formatSandboxMode(selectedWorkspace.sandboxMode)}
                      </span>
                    </>
                  ) : activeThreadEntry ? (
                    <>
                      <span className="meta-pill meta-pill--accent">
                        {activeThreadEntry.workspaceName ?? "未归属"}
                      </span>
                      <span className="meta-pill">{compactPath(activeThreadEntry.cwd, 4)}</span>
                    </>
                  ) : (
                    <span className="meta-pill">未选择项目</span>
                  )}
                </div>
                <span className="muted">
                  {modelsQuery.data?.data.length ?? 0} models available
                </span>
              </div>

              <textarea
                data-testid="composer-input"
                value={composer}
                onChange={(event) => setComposer(event.target.value)}
                onKeyDown={(event) => {
                  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                    event.preventDefault();
                    void handleSendMessage();
                  }
                }}
                placeholder="Ask Codex to patch code, review a diff, explain a failure, or execute a plan..."
              />

              <div className="composer-shell__footer">
                <span className="muted">
                  {selectedWorkspace
                    ? `${compactPath(selectedWorkspace.absPath, 4)} · Cmd/Ctrl+Enter 发送`
                    : activeThreadEntry
                      ? `${compactPath(activeThreadEntry.cwd, 4)} · 当前线程可继续对话`
                      : "先选择项目，再开始新线程。"}
                </span>
                <div className="composer-button-row">
                  <button
                    className="ghost-button"
                    onClick={() => setComposer("")}
                    disabled={!composer}
                  >
                    清空
                  </button>
                  <button
                    className="primary-button"
                    data-testid="send-button"
                    onClick={() => void handleSendMessage()}
                    disabled={!composer.trim() || (!selectedWorkspace && !activeThreadId)}
                  >
                    发送
                  </button>
                </div>
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
                <span className="inspector-header__stats--positive">+{diffStats.additions}</span>
                <span className="inspector-header__stats--negative">-{diffStats.deletions}</span>
              </div>
            </div>

            <div className="inspector-tabs">
              {INSPECTOR_TABS.map((tab) => (
                <button
                  key={tab.id}
                  className={tab.id === inspectorTab ? "inspector-tab inspector-tab--active" : "inspector-tab"}
                  onClick={() => setInspectorTab(tab.id)}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="inspector-content">
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

            <ApprovalRail approvals={pendingApprovals} onResolve={resolveApproval} />
          </aside>
        </div>
      </div>

      {workspaceModalOpen ? (
        <WorkspaceModal
          initialValue={workspaceEditor}
          models={modelsQuery.data?.data ?? []}
          submitting={workspaceMutationPending}
          submitError={workspaceMutationError instanceof Error ? workspaceMutationError.message : null}
          onClose={() => {
            resetWorkspaceMutations();
            setWorkspaceEditor(null);
            setWorkspaceModalOpen(false);
          }}
          onDelete={
            workspaceEditor
              ? workspaceEditor.source === "saved"
                ? () => deleteWorkspaceMutation.mutate(workspaceEditor.id)
                : () => dismissWorkspaceMutation.mutate({ absPath: workspaceEditor.absPath })
              : undefined
          }
          deleteLabel={workspaceEditor?.source === "derived" ? "移除" : "删除"}
          onSubmit={handleWorkspaceSubmit}
        />
      ) : null}

      {integrations.settingsOpen ? (
        <SettingsOverlay
          tab={integrations.settingsTab}
          notice={settingsNotice}
          accountEmail={accountQuery.data?.email ?? null}
          authStatus={integrations.authStatus}
          config={integrations.config}
          models={modelsQuery.data?.data ?? []}
          mcpServers={integrations.mcpServers}
          skills={integrations.skills}
          apps={integrations.apps}
          plugins={integrations.plugins}
          archivedThreads={archivedThreadEntries}
          activeWorkspaceId={activeWorkspaceId}
          onClose={() => setSettingsOpen(false)}
          onTabChange={(tab) => setSettingsTab(tab)}
          onConfigSave={(payload) => void handleConfigSave(payload)}
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
          fileResults={integrations.fuzzySearch.results}
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

      {blocking ? <BlockingOverlay email={accountQuery.data?.email ?? null} /> : null}
    </div>
  );
}

function handleServerMessage(
  message: ServerWsMessage,
  context: {
    queryClient: ReturnType<typeof useQueryClient>;
    setConnection: (next: Partial<ReturnType<typeof useWorkbenchStore.getState>["connection"]>) => void;
    upsertThread: (thread: Thread) => void;
    renameThread: (threadId: string, threadName: string | null | undefined) => void;
    markThreadArchived: (threadId: string, archived: boolean) => void;
    applyTurn: (threadId: string, turn: Turn) => void;
    applyItemNotification: ReturnType<typeof useWorkbenchStore.getState>["applyItemNotification"];
    appendDelta: ReturnType<typeof useWorkbenchStore.getState>["appendDelta"];
    setLatestDiff: ReturnType<typeof useWorkbenchStore.getState>["setLatestDiff"];
    setLatestPlan: ReturnType<typeof useWorkbenchStore.getState>["setLatestPlan"];
    setReview: ReturnType<typeof useWorkbenchStore.getState>["setReview"];
    queueApproval: ReturnType<typeof useWorkbenchStore.getState>["queueApproval"];
    resolveApproval: ReturnType<typeof useWorkbenchStore.getState>["resolveApproval"];
    appendCommandOutput: ReturnType<typeof useWorkbenchStore.getState>["appendCommandOutput"];
    setFuzzySearch: ReturnType<typeof useWorkbenchStore.getState>["setFuzzySearch"];
    setArchivedMode: ReturnType<typeof useWorkbenchStore.getState>["setArchivedMode"];
  },
): void {
  if (message.type !== "server.notification") {
    return;
  }

  if (message.method === "server.status") {
    context.setConnection(message.params);
    return;
  }

  if (message.method === "thread/started") {
    context.upsertThread((message.params as { thread: Thread }).thread);
    void context.queryClient.invalidateQueries({ queryKey: ["threads"] });
    void context.queryClient.invalidateQueries({ queryKey: ["loaded-threads"] });
    return;
  }

  if (message.method === "thread/status/changed") {
    const { threadId, status } = message.params as {
      threadId: string;
      status: Thread["status"];
    };
    const thread = useWorkbenchStore.getState().threads[threadId]?.thread;
    if (thread) {
      context.upsertThread({ ...thread, status });
    }
    void context.queryClient.invalidateQueries({ queryKey: ["threads"] });
    return;
  }

  if (message.method === "thread/name/updated") {
    const { threadId, threadName } = message.params as {
      threadId: string;
      threadName?: string;
    };
    context.renameThread(threadId, threadName);
    void context.queryClient.invalidateQueries({ queryKey: ["threads"] });
    return;
  }

  if (message.method === "thread/archived") {
    const { threadId } = message.params as { threadId: string };
    context.markThreadArchived(threadId, true);
    if (useWorkbenchStore.getState().activeThreadId === threadId) {
      context.setArchivedMode("archived");
    }
    void context.queryClient.invalidateQueries({ queryKey: ["threads"] });
    void context.queryClient.invalidateQueries({ queryKey: ["loaded-threads"] });
    return;
  }

  if (message.method === "thread/unarchived") {
    const { threadId } = message.params as { threadId: string };
    context.markThreadArchived(threadId, false);
    void context.queryClient.invalidateQueries({ queryKey: ["threads"] });
    void context.queryClient.invalidateQueries({ queryKey: ["loaded-threads"] });
    return;
  }

  if (message.method === "turn/started" || message.method === "turn/completed") {
    const { threadId, turn } = message.params as { threadId: string; turn: Turn };
    context.applyTurn(threadId, turn);
    void context.queryClient.invalidateQueries({ queryKey: ["threads"] });
    return;
  }

  if (message.method === "item/started" || message.method === "item/completed") {
    context.applyItemNotification(message.params as any);
    return;
  }

  if (message.method === "item/agentMessage/delta") {
    const { threadId, turnId, itemId, delta } = message.params as any;
    context.appendDelta(threadId, turnId, itemId, "agentMessage", delta);
    return;
  }

  if (message.method === "item/plan/delta") {
    const { threadId, turnId, itemId, delta } = message.params as any;
    context.appendDelta(threadId, turnId, itemId, "plan", delta);
    return;
  }

  if (
    message.method === "item/reasoning/summaryTextDelta" ||
    message.method === "item/reasoning/summaryPartAdded" ||
    message.method === "item/reasoning/textDelta"
  ) {
    const { threadId, turnId, itemId, delta } = message.params as any;
    context.appendDelta(threadId, turnId, itemId, "reasoning", delta ?? "");
    return;
  }

  if (message.method === "item/commandExecution/outputDelta") {
    const { threadId, turnId, itemId, delta } = message.params as any;
    context.appendDelta(threadId, turnId, itemId, "commandExecution", delta);
    return;
  }

  if (message.method === "item/fileChange/outputDelta") {
    const { threadId, turnId, itemId, delta } = message.params as any;
    context.appendDelta(threadId, turnId, itemId, "fileChange", delta);
    return;
  }

  if (message.method === "command/exec/outputDelta") {
    const { processId, stream, deltaBase64 } = message.params as {
      processId: string;
      stream: "stdout" | "stderr";
      deltaBase64: string;
    };
    context.appendCommandOutput(processId, stream, decodeBase64(deltaBase64));
    return;
  }

  if (message.method === "turn/diff/updated") {
    const { threadId, diff } = message.params as any;
    context.setLatestDiff(threadId, diff);
    return;
  }

  if (message.method === "turn/plan/updated") {
    const { threadId, explanation, plan } = message.params as any;
    context.setLatestPlan(threadId, { explanation, plan });
    return;
  }

  if (message.method === "fuzzyFileSearch/sessionUpdated") {
    const { sessionId, query, files } = message.params as any;
    context.setFuzzySearch({
      sessionId,
      query,
      status: "loading",
      results: files,
    });
    return;
  }

  if (message.method === "fuzzyFileSearch/sessionCompleted") {
    context.setFuzzySearch({ status: "completed" });
    return;
  }

  if (message.method === "serverRequest/resolved") {
    const { requestId } = message.params as { requestId: RequestId };
    context.resolveApproval(requestId);
    return;
  }

  if (isServerRequestNotification(message)) {
    context.queueApproval({
      id: message.id,
      method: message.method,
      params: message.params,
    });
    return;
  }

  if (
    message.method === "account/updated" ||
    message.method === "account/login/completed" ||
    message.method === "account/rateLimits/updated"
  ) {
    void context.queryClient.invalidateQueries({ queryKey: ["account"] });
    void context.queryClient.invalidateQueries({ queryKey: ["auth-status"] });
    return;
  }

  if (
    message.method === "skills/changed" ||
    message.method === "app/list/updated" ||
    message.method === "mcpServer/oauthLogin/completed"
  ) {
    void context.queryClient.invalidateQueries({ queryKey: ["skills"] });
    void context.queryClient.invalidateQueries({ queryKey: ["apps"] });
    void context.queryClient.invalidateQueries({ queryKey: ["mcp-servers"] });
  }
}

type WorkspaceFormInput = {
  name: string;
  absPath: string;
  defaultModel?: string | null;
  approvalPolicy?: "on-request" | "never" | "on-failure" | "untrusted";
  sandboxMode?: "workspace-write" | "read-only" | "danger-full-access";
};

type EditableApprovalPolicy = NonNullable<WorkspaceFormInput["approvalPolicy"]>;
type EditableSandboxMode = NonNullable<WorkspaceFormInput["sandboxMode"]>;

type PaletteAction = {
  id: string;
  label: string;
  description: string;
  run: () => void;
};

function WorkspaceListRow(props: {
  workspace: WorkspaceRecord;
  active: boolean;
  onSelect: () => void;
  onCompose?: () => void;
  onEdit?: () => void;
}) {
  return (
    <div className={props.active ? "workspace-row workspace-row--active" : "workspace-row"}>
      <button
        className="workspace-row__main"
        onClick={props.onSelect}
        title={props.workspace.absPath}
      >
        <div className="workspace-row__title">
          <FolderIcon />
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

function ThreadRow(props: {
  thread: ThreadListEntry;
  now: number;
  active: boolean;
  nested?: boolean;
  menuOpen: boolean;
  onClick: () => void;
  onToggleMenu: () => void;
  onRename: () => void;
  onFork: () => void;
  onArchive: () => void;
  onCompact: () => void;
  onRollback: () => void;
}) {
  return (
    <div
      className={
        props.active
          ? props.nested
            ? "thread-row thread-row--nested thread-row--active"
            : "thread-row thread-row--active"
          : props.nested
            ? "thread-row thread-row--nested"
            : "thread-row"
      }
      data-testid={`thread-${props.thread.id}`}
      role="button"
      tabIndex={0}
      onClick={props.onClick}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          props.onClick();
        }
      }}
    >
      <div className="thread-row__main">
        <strong>{formatThreadTitle(props.thread)}</strong>
        <span className="thread-row__time" title={formatAbsoluteDateTime(props.thread.updatedAt)}>
          {formatRelativeThreadAge(props.thread.updatedAt, props.now)}
        </span>
      </div>
      <button
        className="thread-row__menu-trigger"
        data-testid={`thread-menu-${props.thread.id}`}
        onClick={(event) => {
          event.stopPropagation();
          props.onToggleMenu();
        }}
      >
        ⋯
      </button>

      {props.menuOpen ? (
        <div
          className="thread-row__menu"
          onClick={(event) => event.stopPropagation()}
        >
          <button onClick={props.onRename}>重命名</button>
          <button onClick={props.onFork}>Fork</button>
          <button onClick={props.onCompact}>Compact</button>
          <button onClick={props.onRollback}>Rollback</button>
          <button onClick={props.onArchive}>归档切换</button>
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
        这个 web 版直接镜像 Codex app-server 的线程和 turn。先注册项目根目录，再开始真实会话。
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

function EmptyThreadState(props: { thread: Thread; archived: boolean }) {
  return (
    <div className="conversation-ready">
      <div>
        <p className="conversation-empty__eyebrow">
          {props.archived ? "Archived" : describeThreadStatus(props.thread.status)}
        </p>
        <h2>{formatThreadTitle(props.thread)}</h2>
      </div>
      <p>
        线程已经创建，但还没有完整 timeline。下一条用户消息或 agent 输出到来后，这里会切到真正的工作流视图。
      </p>
    </div>
  );
}

function TimelineCard({ entry }: { entry: TimelineEntry }) {
  return (
    <article
      className={`timeline-card timeline-card--${entry.kind} ${
        entry.kind === "userMessage" ? "timeline-card--user" : ""
      }`}
    >
      <div className="timeline-card__header">
        <strong>{entry.title}</strong>
        <span className="timeline-card__kind">{labelForEntryKind(entry.kind)}</span>
      </div>
      <pre>{entry.body || "..."}</pre>
    </article>
  );
}

function InspectorPanel(props: {
  tab: InspectorTab;
  threadView: ReturnType<typeof useWorkbenchStore.getState>["threads"][string] | null;
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
      <div className="inspector-panel inspector-panel--diff">
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
        <div className="inspector-editor">
          <Editor
            height="100%"
            theme="vs-dark"
            defaultLanguage="diff"
            options={{ readOnly: true, minimap: { enabled: false } }}
            value={props.threadView.latestDiff || "No diff yet."}
          />
        </div>
      </div>
    );
  }

  if (props.tab === "review") {
    const parsedReview = parseReview(props.threadView.review, props.timeline);
    return (
      <div className="inspector-panel inspector-panel--stack">
        {parsedReview ? (
          <>
            <div className="inspector-section">
              <div className="inspector-section__header">
                <strong>{parsedReview.overall_correctness}</strong>
                <span>{parsedReview.findings.length} findings</span>
              </div>
              <p>{parsedReview.overall_explanation}</p>
            </div>
            <div className="review-list">
              {parsedReview.findings.map((finding) => (
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
          <div className="inspector-empty">
            <strong>还没有结构化 review</strong>
            <p>点击顶部提交，或者让 Codex 对当前改动作一次 review。</p>
          </div>
        )}
      </div>
    );
  }

  if (props.tab === "plan") {
    return (
      <div className="inspector-panel inspector-panel--stack">
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
              {props.threadView.latestPlan.plan.map((step: TurnPlanStep) => (
                <div key={step.step} className="plan-row">
                  <strong>{step.step}</strong>
                  <span>{step.status}</span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="inspector-empty">
            <strong>没有 live plan</strong>
            <p>当 Codex 发出 plan delta 时，这里会实时更新。</p>
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
              data-testid="command-terminate-button"
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
              data-testid="command-stdin-button"
              onClick={props.onSendCommandInput}
            >
              Send stdin
            </button>
          </div>
        </div>
        <div className="terminal-output">
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
  onResolve: (id: RequestId) => void;
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
        <div key={String(approval.id)} className="approval-card">
          <strong>{approval.method}</strong>
          <pre>{JSON.stringify(approval.params, null, 2)}</pre>
          <div className="approval-actions">
            <button
              className="primary-button"
              onClick={() => {
                respondToApproval(approval.id, approval.method as any, approval.params, "accept");
                props.onResolve(approval.id);
              }}
            >
              Accept
            </button>
            <button
              className="ghost-button"
              onClick={() => {
                respondToApproval(approval.id, approval.method as any, approval.params, "decline");
                props.onResolve(approval.id);
              }}
            >
              Decline
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
  authStatus: GetAuthStatusResponse | null;
  config: ConfigReadResponse | null;
  models: Array<{ model: string; displayName: string }>;
  mcpServers: ReturnType<typeof useWorkbenchStore.getState>["integrations"]["mcpServers"];
  skills: ReturnType<typeof useWorkbenchStore.getState>["integrations"]["skills"];
  apps: Array<AppInfo>;
  plugins: ReturnType<typeof useWorkbenchStore.getState>["integrations"]["plugins"];
  archivedThreads: Array<ThreadListEntry>;
  activeWorkspaceId: string | "all";
  onClose: () => void;
  onTabChange: (tab: SettingsTab) => void;
  onConfigSave: (payload: {
    model: string | null;
    approvalPolicy: string | null;
    sandboxMode: string | null;
  }) => void;
  onMcpLogin: (name: string) => void;
  onMcpReload: () => void;
  onOpenArchivedThread: (threadId: string) => void;
  onUnarchiveThread: (thread: ThreadListEntry) => void;
  onPluginUninstall: (pluginId: string) => void;
}) {
  const [model, setModel] = useState(props.config?.config.model ?? "");
  const [approvalPolicy, setApprovalPolicy] = useState(
    normalizeApprovalPolicy(props.config?.config.approval_policy as any) ?? "on-request",
  );
  const [sandboxMode, setSandboxMode] = useState(
    normalizeSandboxMode(props.config?.config.sandbox_mode as any) ?? "danger-full-access",
  );

  useEffect(() => {
    setModel(props.config?.config.model ?? "");
    setApprovalPolicy(
      normalizeApprovalPolicy(props.config?.config.approval_policy as any) ?? "on-request",
    );
    setSandboxMode(
      normalizeSandboxMode(props.config?.config.sandbox_mode as any) ?? "danger-full-access",
    );
  }, [props.config]);

  return (
    <div className="overlay-shell">
      <div className="settings-panel">
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
                  Auth method: {props.authStatus?.authMethod ?? "unknown"} · requires OpenAI auth:{" "}
                  {String(props.authStatus?.requiresOpenaiAuth ?? null)}
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
                    <select value={model} onChange={(event) => setModel(event.target.value)}>
                      <option value="">Default</option>
                      {props.models.map((entry) => (
                        <option key={entry.model} value={entry.model}>
                          {entry.displayName}
                        </option>
                      ))}
                    </select>
                  </label>
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
                  命令审批控制 Codex 在执行命令或写文件前何时向你确认。沙箱权限默认使用 full
                  access。
                </p>
                <div className="settings-card__actions">
                  <button
                    className="primary-button"
                    onClick={() =>
                      props.onConfigSave({
                        model: model || null,
                        approvalPolicy,
                        sandboxMode,
                      })
                    }
                  >
                    保存默认配置
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
                  {props.mcpServers.map((server) => (
                    <div key={server.name} className="mcp-card">
                      <div>
                        <strong>{server.name}</strong>
                        <p className="muted">
                          tools {Object.keys(server.tools ?? {}).length} · resources{" "}
                          {server.resources.length}
                        </p>
                      </div>
                      <div className="mcp-card__actions">
                        <span>{server.authStatus}</span>
                        {server.authStatus === "notLoggedIn" ? (
                          <button
                            className="ghost-button"
                            onClick={() => props.onMcpLogin(server.name)}
                          >
                            Login
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : null}

          {props.tab === "skills" ? (
            <div className="settings-stack">
              {props.skills.map((group) => (
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
                    {group.skills.length === 0 ? <span className="muted">No local skills</span> : null}
                  </div>
                  {group.errors.length > 0 ? (
                    <pre className="settings-pre">
                      {group.errors.map((entry) => entry.message).join("\n")}
                    </pre>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}

          {props.tab === "apps" ? (
            <div className="settings-stack">
              {props.apps.map((app) => (
                <div key={app.id} className="settings-card">
                  <div className="inspector-section__header">
                    <strong>{app.name}</strong>
                    <span>{app.isAccessible ? "accessible" : "restricted"}</span>
                  </div>
                  <p>{app.description ?? "No description"}</p>
                  <div className="tag-cloud">
                    {app.pluginDisplayNames.map((name) => (
                      <span key={name} className="tag-chip">
                        {name}
                      </span>
                    ))}
                  </div>
                  {app.installUrl ? (
                    <a
                      className="settings-link"
                      href={app.installUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open install page
                    </a>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}

          {props.tab === "plugins" ? (
            <div className="settings-stack">
              {props.plugins.map((marketplace) => (
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
                            {plugin.installed ? "installed" : "available"} ·{" "}
                            {plugin.enabled ? "enabled" : "disabled"}
                          </p>
                        </div>
                        {plugin.installed ? (
                          <button
                            className="ghost-button"
                            onClick={() => props.onPluginUninstall(plugin.id)}
                          >
                            Uninstall
                          </button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
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
    <div className="overlay-shell">
      <div className="palette-panel">
        <div className="palette-panel__header">
          <strong>命令菜单</strong>
          <button className="ghost-button" onClick={props.onClose}>
            关闭
          </button>
        </div>
        <input
          className="palette-input"
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
  models: Array<{ model: string; displayName: string }>;
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
  const pathWithinHome =
    homePath === null ? true : isHomeScopedInput(absPath, homePath);
  const pathIsDirectory = pathSuggestions?.isDirectory ?? false;

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
    <div className="overlay-shell">
      <div className="modal-panel">
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
          {pathWithinHome && !pathIsDirectory ? (
            <span className="field-note field-note--danger">
              {discoveredWorkspace
                ? "这个 session 对应的目录当前已经不存在，不能接管保存；如果不再需要，可以直接移除。"
                : "当前路径不是可用目录。请先选择一个现有目录。"}
            </span>
          ) : null}
          {!discoveredWorkspace && !pathIsDirectory && pathSuggestions?.data.length ? (
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
              <option key={model.model} value={model.model}>
                {model.displayName}
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
            disabled={props.submitting || !pathWithinHome || !pathIsDirectory}
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
  return (
    <span className={`status-pill status-pill--${props.tone}`}>{props.label}</span>
  );
}

function parseReview(
  review: ReviewOutputEvent | null,
  timeline: Array<TimelineEntry>,
): ReviewOutputEvent | null {
  if (review) {
    return review;
  }

  const rawReview = [...timeline]
    .reverse()
    .find((entry) => entry.kind === "exitedReviewMode");

  if (!rawReview?.body) {
    return null;
  }

  return parseReviewFromRaw(rawReview.body);
}

function parseReviewFromRaw(value: string | null | undefined): ReviewOutputEvent | null {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value) as ReviewOutputEvent;
  } catch {
    return null;
  }
}

function respondToApproval(
  id: RequestId,
  method: string,
  params: any,
  decision: "accept" | "decline",
): void {
  if (method === "item/commandExecution/requestApproval") {
    codexClient.respondToServerRequest(id, method, { decision });
    return;
  }

  if (method === "item/fileChange/requestApproval") {
    codexClient.respondToServerRequest(id, method, { decision });
    return;
  }

  if (method === "item/tool/requestUserInput") {
    const answers = Object.fromEntries(
      (params.questions ?? []).map((question: any) => [
        question.id,
        {
          answers: [question.options?.[0]?.label ?? ""],
        },
      ]),
    );
    codexClient.respondToServerRequest(id, method, { answers });
  }
}

function normalizeApprovalPolicy(
  value: WorkspaceRecord["approvalPolicy"] | string | undefined,
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

function normalizeSandboxMode(
  value: WorkspaceRecord["sandboxMode"] | string | undefined,
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

function formatApprovalPolicy(value: WorkspaceRecord["approvalPolicy"]): string {
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

  return "custom";
}

function formatSandboxMode(value: WorkspaceRecord["sandboxMode"]): string {
  if (value === "danger-full-access") {
    return "full access";
  }

  if (value === "workspace-write") {
    return "workspace write";
  }

  return "read only";
}

function formatThreadTitle(
  thread:
    | Pick<ThreadListEntry, "name" | "preview">
    | Pick<Thread, "name" | "preview">
    | null,
): string | null {
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

function getSidebarWidthBounds(
  viewportWidth = typeof window === "undefined" ? DEFAULT_SIDEBAR_WIDTH * 2 : window.innerWidth,
): { min: number; max: number } {
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

function describeThreadStatus(status: { type?: string } | string | null | undefined): string {
  if (!status) {
    return "unknown";
  }

  if (typeof status === "string") {
    return status;
  }

  return status.type ?? "unknown";
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

function labelForEntryKind(kind: TimelineEntry["kind"]): string {
  if (kind === "agentMessage") {
    return "assistant";
  }

  if (kind === "userMessage") {
    return "you";
  }

  if (kind === "commandExecution") {
    return "command";
  }

  if (kind === "mcpToolCall") {
    return "mcp";
  }

  return kind;
}

function findActiveTurn(
  threadView: ReturnType<typeof useWorkbenchStore.getState>["threads"][string],
): Turn | null {
  for (const turnId of [...threadView.turnOrder].reverse()) {
    const turn = threadView.turns[turnId]?.turn;
    if (turn && turn.status === "inProgress") {
      return turn;
    }
  }

  return null;
}

function dedupeThreads(entries: Array<ThreadListEntry>): Array<ThreadListEntry> {
  const map = new Map<string, ThreadListEntry>();
  for (const entry of entries) {
    map.set(entry.id, entry);
  }

  return [...map.values()];
}

function selectedWorkspacePath(
  workspaces: Array<WorkspaceRecord>,
  workspaceId: string | "all",
): string | null {
  if (workspaceId === "all") {
    return null;
  }

  return workspaces.find((workspace) => workspace.id === workspaceId)?.absPath ?? null;
}

function buildPaletteActions(input: {
  activeThreadView: ReturnType<typeof useWorkbenchStore.getState>["threads"][string] | null;
  selectedWorkspace: WorkspaceRecord | null;
  archivedMode: "active" | "archived";
}): Array<PaletteAction> {
  return [
    {
      id: "new-thread",
      label: "新线程",
      description: "清空当前选择，开始一个新的 thread",
      run: () => {
        useWorkbenchStore.getState().setActiveThread(null);
      },
    },
    {
      id: "settings",
      label: "打开设置",
      description: "查看账号、模型、MCP、skills 和 archived threads",
      run: () => {
        useWorkbenchStore.getState().setSettingsOpen(true);
        useWorkbenchStore.getState().setSettingsTab("general");
      },
    },
    {
      id: "archived",
      label: input.archivedMode === "archived" ? "切回活跃线程" : "切到归档线程",
      description: "切换当前 sidebar 线程视图",
      run: () => {
        useWorkbenchStore
          .getState()
          .setArchivedMode(input.archivedMode === "archived" ? "active" : "archived");
      },
    },
    {
      id: "review",
      label: "切到 Review",
      description: "右侧 inspector 切到 review 面板",
      run: () => {
        useWorkbenchStore.getState().setInspectorTab("review");
      },
    },
    {
      id: "command",
      label: "切到 Command",
      description: "右侧 inspector 切到 command 面板",
      run: () => {
        useWorkbenchStore.getState().setInspectorTab("command");
      },
    },
  ];
}

function encodeBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function decodeBase64(value: string): string {
  const binary = atob(value);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function sanitizeTerminalSize(value: string, fallback: number): number {
  const next = Number.parseInt(value, 10);
  if (!Number.isFinite(next) || next < 20) {
    return fallback;
  }

  return next;
}

async function listAllMcpServers() {
  const data = [] as ListMcpServerStatusResponse["data"];
  let cursor: string | null = null;

  do {
    const response: ListMcpServerStatusResponse = await codexClient.call<
      ListMcpServerStatusResponse,
      "mcpServerStatus/list"
    >("mcpServerStatus/list", {
      cursor,
      limit: 100,
    });
    data.push(...response.data);
    cursor = response.nextCursor;
  } while (cursor);

  return data;
}

async function listAllApps(threadId: string | null) {
  const data = [] as Array<AppInfo>;
  let cursor: string | null = null;

  do {
    const response: { data: Array<AppInfo>; nextCursor: string | null } =
      await codexClient.call<any, "app/list">("app/list", {
      cursor,
      limit: 100,
      threadId,
      forceRefetch: false,
    });
    data.push(...response.data);
    cursor = response.nextCursor;
  } while (cursor);

  return data;
}

async function listLoadedThreadIds(): Promise<Array<string>> {
  const ids: Array<string> = [];
  let cursor: string | null = null;

  do {
    const response: ThreadLoadedListResponse = await codexClient.call<
      ThreadLoadedListResponse,
      "thread/loaded/list"
    >(
      "thread/loaded/list",
      {
        cursor,
        limit: 200,
      },
    );
    ids.push(...response.data);
    cursor = response.nextCursor;
  } while (cursor);

  return ids;
}
