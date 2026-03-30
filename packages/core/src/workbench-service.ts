import { randomUUID } from "node:crypto";
import { resolve, sep } from "node:path";
import { AppError, buildDefaultServerRequestResolveInput, isLegacyServerRequestResolveInput } from "@webcli/contracts";
import type {
  AppClientCallEnvelope,
  AppClientMessage,
  AppEventMethod,
  AppEventParams,
  AppRequestMethod,
  AppRequestParams,
  AppRequestResult,
  AppServerMessage,
  AppServerNotificationEnvelope,
  BootstrapResponse,
  CommandSessionSnapshot,
  ConfigSnapshot,
  ConfigWarningNotice,
  DeprecationNotice,
  GitWorkingTreeSnapshot,
  HealthResponse,
  IntegrationSnapshot,
  LegacyServerRequestResolveInput,
  ModelRerouteEvent,
  RequestId,
  RuntimeStatus,
  ServerRequestResolveInput,
  ThreadSummary,
  ThreadSummaryPageResponse,
  WorkbenchThread,
  WorkspaceCreateInput,
  WorkspaceDismissInput,
  WorkspaceRecord,
  WorkspaceUpdateInput,
} from "@webcli/contracts";
import { ApprovalBroker } from "./approval-broker.js";
import { CommandService } from "./command-service.js";
import {
  ensureHomeScopedDirectory,
  isWithinHomePath,
  listHomePathSuggestions,
  resolveHomeDirectory,
  resolveWorkspacePath,
} from "./home-paths.js";
import type { RuntimeThreadRecord, SessionRuntime, SessionRuntimeEvent } from "./runtime.js";
import { ThreadProjectionService } from "./thread-projection-service.js";
import { WorkspaceCatalogService } from "./workspace-catalog-service.js";
import type { WorkspaceRepo } from "./workspace-repo.js";

type ConnectionSender = (message: AppServerMessage) => void;

type ConnectionRecord = {
  sessionId: string;
  sender: ConnectionSender;
};

const MAX_RETAINED_THREAD_VIEWS = 5;
const DEFAULT_THREAD_PAGE_SIZE = 50;
const THREAD_SUMMARY_WARMUP_RETRY_MS = 1000;
const MAX_THREAD_SUMMARY_WARMUP_ATTEMPTS = 5;

export class WorkbenchService {
  private readonly homePath: string;
  private readonly workspaceCatalog = new WorkspaceCatalogService();
  private readonly threadProjection = new ThreadProjectionService(this.workspaceCatalog);
  private readonly approvalBroker = new ApprovalBroker();
  private readonly commandService = new CommandService();
  private readonly connections = new Map<string, ConnectionRecord>();
  private readonly sessionConnections = new Map<string, Set<string>>();
  private readonly threadViews = new Map<string, WorkbenchThread>();
  private readonly threadSummaries = new Map<string, ThreadSummary>();
  private readonly workspaceGitSnapshots = new Map<string, GitWorkingTreeSnapshot>();
  private summaryCacheInitialized = false;
  private cachedWorkspaceCatalog: Array<WorkspaceRecord> | null = null;
  private runtimeStatus: RuntimeStatus;
  private threadSummaryWarmupTimer: ReturnType<typeof setTimeout> | null = null;
  private threadSummaryWarmupAttempt = 0;

  constructor(
    private readonly runtime: SessionRuntime,
    private readonly workspaceRepo: WorkspaceRepo,
    homePath = resolveHomeDirectory(),
  ) {
    this.homePath = homePath;
    this.runtimeStatus = runtime.getStatus();
    this.runtime.subscribe((event) => {
      void this.handleRuntimeEvent(event);
    });
  }

  async start(): Promise<void> {
    void this.runtime.start().catch(() => {});
  }

  async stop(): Promise<void> {
    this.clearThreadSummaryWarmupTimer();
    await this.runtime.stop();
    this.workspaceRepo.close();
  }

  createHealthResponse(codexCommand: string): HealthResponse {
    return {
      status: "ok",
      runtime: this.runtime.getStatus(),
      codexCommand,
    };
  }

  async getBootstrap(): Promise<BootstrapResponse> {
    await this.ensureThreadSummaryCache();
    const [account, models, config] = await Promise.all([
      this.runtime.getAccountSummary(true),
      this.runtime.listModels(),
      this.runtime.readConfigSnapshot(),
    ]);
    const workspaces = await this.getWorkspaceCatalog();
    this.reprojectThreadSummaries(workspaces);
    const summaries = this.getSortedThreadSummaries();
    const activeSummaries = summaries.filter((thread) => !thread.archived);
    const archivedThreadCount = summaries.length - activeSummaries.length;

    return {
      runtime: this.runtime.getStatus(),
      account,
      models,
      workspaces,
      activeThreads: activeSummaries,
      archivedThreadCount,
      settings: {
        config,
      },
    };
  }

  async listWorkspaces(): Promise<Array<WorkspaceRecord>> {
    await this.ensureThreadSummaryCache();
    return this.getWorkspaceCatalog();
  }

  async listThreadSummaries(input: {
    archived: boolean;
    cursor?: string | null;
    limit?: number | null;
    workspaceId?: string | undefined;
  }): Promise<ThreadSummaryPageResponse> {
    await this.ensureThreadSummaryCache();
    const workspaces = await this.getWorkspaceCatalog();
    this.reprojectThreadSummaries(workspaces);
    const filtered = this.workspaceCatalog
      .filterThreadsByWorkspaceScope(
        this.getSortedThreadSummaries().filter((thread) => thread.archived === input.archived),
        input.workspaceId,
      );
    const offset = parseThreadPageCursor(input.cursor);
    const pageSize = clampThreadPageSize(input.limit);
    const items = filtered.slice(offset, offset + pageSize);
    const nextCursor = offset + pageSize < filtered.length ? String(offset + pageSize) : null;
    return {
      items,
      nextCursor,
    };
  }

  listPathSuggestions(query: string | undefined) {
    return listHomePathSuggestions(query, this.homePath);
  }

  async resolveReadableResourcePath(value: string): Promise<string> {
    const normalized = resolveWorkspacePath(value, this.homePath);
    if (isWithinHomePath(normalized, this.homePath)) {
      return normalized;
    }

    await this.ensureThreadSummaryCache();
    const allowedRoots = new Set<string>([resolve(process.cwd())]);
    for (const workspace of this.workspaceRepo.list()) {
      allowedRoots.add(resolve(workspace.absPath));
    }
    for (const thread of this.threadSummaries.values()) {
      allowedRoots.add(resolve(thread.cwd));
    }

    for (const root of allowedRoots) {
      if (normalized === root || normalized.startsWith(`${root}${sep}`)) {
        return normalized;
      }
    }

    throw new AppError(
      "resource.outside_scope",
      "Resource path must stay inside the home directory or a known thread root",
    );
  }

  createWorkspace(input: WorkspaceCreateInput): WorkspaceRecord {
    const normalized = this.validateWorkspaceInput(input);
    const created = this.workspaceRepo.create(normalized);
    this.invalidateWorkspaceCatalog();
    return created;
  }

  dismissWorkspace(input: WorkspaceDismissInput): void {
    const absPath = resolveWorkspacePath(input.absPath, this.homePath);
    this.workspaceRepo.ignorePath(absPath);
    this.invalidateWorkspaceCatalog();
  }

  updateWorkspace(id: string, input: WorkspaceUpdateInput): WorkspaceRecord | null {
    const normalized = this.validateWorkspaceUpdate(input);
    const updated = this.workspaceRepo.update(id, normalized);
    this.invalidateWorkspaceCatalog();
    return updated;
  }

  deleteWorkspace(id: string): boolean {
    const deleted = this.workspaceRepo.delete(id);
    this.invalidateWorkspaceCatalog();
    return deleted;
  }

  registerConnection(sessionId: string, connectionId: string, sender: ConnectionSender): void {
    this.connections.set(connectionId, { sessionId, sender });
    const sessionConnectionIds = this.sessionConnections.get(sessionId) ?? new Set<string>();
    sessionConnectionIds.add(connectionId);
    this.sessionConnections.set(sessionId, sessionConnectionIds);

    this.notifyConnection(connectionId, "runtime.statusChanged", {
      runtime: this.runtime.getStatus(),
    });
    for (const approval of this.approvalBroker.listForSession(sessionId)) {
      this.notifyConnection(connectionId, "approval.requested", { approval });
      this.notifyConnection(connectionId, "serverRequest.requested", { request: approval });
    }
  }

  unregisterConnection(connectionId: string): void {
    const record = this.connections.get(connectionId);
    if (!record) {
      return;
    }

    this.connections.delete(connectionId);
    const sessionConnectionIds = this.sessionConnections.get(record.sessionId);
    if (!sessionConnectionIds) {
      return;
    }

    sessionConnectionIds.delete(connectionId);
    if (sessionConnectionIds.size === 0) {
      this.sessionConnections.delete(record.sessionId);
    }
  }

  async handleClientCall(
    sessionId: string,
    message: AppClientMessage,
  ): Promise<AppRequestResult<AppRequestMethod>> {
    switch (message.method) {
      case "account.read":
        return this.handleAccountRead();
      case "account.login.start":
        return this.handleAccountLoginStart(
          message.params,
        );
      case "account.login.cancel":
        return this.handleAccountLoginCancel(
          message.params,
        );
      case "account.logout":
        return this.handleAccountLogout();
      case "account.rateLimits.read":
        return {
          rateLimits: await this.runtime.readAccountRateLimits(),
        };
      case "thread.open":
        return this.handleThreadOpen(
          sessionId,
          message.params,
        );
      case "thread.resume":
        return this.handleThreadResume(
          sessionId,
          message.params,
        );
      case "thread.list":
        return this.handleThreadList(
          message.params,
        );
      case "thread.read":
        return this.handleThreadRead(
          message.params,
        );
      case "thread.metadata.update":
        return this.handleThreadMetadataUpdate(
          message.params,
        );
      case "thread.unsubscribe":
        return this.handleThreadUnsubscribe(
          message.params,
        );
      case "thread.rename":
        {
          const params = message.params;
          await this.runtime.renameThread(params.threadId, params.name);
        }
        return { ok: true };
      case "thread.archive":
        {
          const params = message.params;
          const summary = this.threadSummaries.get(params.threadId);
          await this.runtime.archiveThread(params.threadId, summary?.path ?? null);
        }
        return { ok: true };
      case "thread.unarchive":
        return this.handleThreadUnarchive(
          sessionId,
          message.params,
        );
      case "thread.fork":
        return this.handleThreadFork(
          sessionId,
          message.params,
        );
      case "thread.compact":
        await this.runtime.compactThread(
          (message.params).threadId,
        );
        return { ok: true };
      case "thread.rollback":
        return this.handleThreadRollback(
          sessionId,
          message.params,
        );
      case "turn.start":
        return this.handleTurnStart(message.params);
      case "turn.interrupt":
        {
          const params = message.params;
          await this.runtime.interruptTurn(params.threadId, params.turnId);
        }
        return { ok: true };
      case "turn.steer":
        {
          const params = message.params;
          await this.runtime.steerTurn(params.threadId, params.turnId, params.prompt);
        }
        return { ok: true };
      case "review.start":
        return this.handleReviewStart(message.params);
      case "command.start":
        return this.handleCommandStart(
          sessionId,
          message.params,
        );
      case "command.write":
        {
          const params = message.params;
          await this.runtime.writeCommand(params.processId, params.text);
        }
        return { ok: true };
      case "command.resize":
        {
          const params = message.params;
          await this.runtime.resizeCommand(params.processId, params.cols, params.rows);
        }
        return { ok: true };
      case "command.stop":
        await this.runtime.stopCommand(
          (message.params).processId,
        );
        return { ok: true };
      case "approval.resolve":
        return this.handleApprovalResolve(
          (message.params).requestId,
          (message.params).decision,
        );
      case "serverRequest.resolve":
        return this.handleServerRequestResolve(
          message.params,
        );
      case "integrations.refresh":
        return {
          snapshot: await this.refreshIntegrations(
            (message.params).workspaceId,
            (message.params).threadId,
          ),
        };
      case "integrations.mcp.login":
        return {
          authorizationUrl: await this.runtime.loginMcp(
            (message.params).name,
          ),
        };
      case "integrations.mcp.reload":
        await this.runtime.reloadMcp();
        return {
          snapshot: await this.refreshIntegrations(),
        };
      case "mcpServerStatus.list":
        return {
          servers: await this.runtime.listMcpServerStatuses(),
        };
      case "skills.list":
        return {
          skills: await this.runtime.listSkills(
            await this.resolveWorkspaceCwd(
              (message.params).workspaceId,
            ),
          ),
        };
      case "skills.remote.list":
        return {
          skills: await this.runtime.listRemoteSkills(
            message.params,
          ),
        };
      case "skills.remote.export":
        return this.handleRemoteSkillExport(
          message.params,
        );
      case "skills.config.write":
        return this.handleSkillConfigWrite(
          message.params,
        );
      case "app.list":
        return {
          apps: await this.runtime.listApps(
            message.params,
          ),
        };
      case "plugin.list":
        return {
          marketplaces: await this.runtime.listPlugins(
            await this.resolveWorkspaceCwd(
              (message.params).workspaceId,
            ),
          ),
        };
      case "plugin.install":
        return this.handlePluginInstall(
          message.params,
        );
      case "plugin.uninstall":
        return this.handlePluginUninstall(
          message.params,
        );
      case "integrations.plugin.uninstall":
        await this.runtime.uninstallPlugin(
          (message.params).pluginId,
        );
        return {
          snapshot: await this.refreshIntegrations(
            (message.params).workspaceId,
            (message.params).threadId,
          ),
        };
      case "settings.save":
        {
          const params = message.params;
          await this.runtime.saveSettings({
            model: params.model,
            reasoningEffort: params.reasoningEffort,
            serviceTier: params.serviceTier,
            approvalPolicy: normalizeNullableEnum(params.approvalPolicy),
            sandboxMode: normalizeNullableEnum(params.sandboxMode),
            forcedLoginMethod: normalizeNullableEnum(params.forcedLoginMethod),
          } as ConfigSnapshot);
        }
        return {
          snapshot: await this.refreshIntegrations(),
        };
      case "config.batchWrite":
        return {
          write: await this.runtime.batchWriteConfig(
            message.params,
          ),
        };
      case "configRequirements.read":
        return {
          requirements: await this.runtime.readConfigRequirements(),
        };
      case "externalAgentConfig.detect":
        return {
          items: await this.runtime.detectExternalAgentConfig(
            message.params,
          ),
        };
      case "externalAgentConfig.import":
        await this.runtime.importExternalAgentConfig(
          (message.params).migrationItems,
        );
        return { ok: true };
      case "conversation.summary.read":
        return {
          summary: await this.runtime.readConversationSummary(
            message.params,
          ),
        };
      case "workspace.git.read":
        return this.handleWorkspaceGitRead(
          message.params,
        );
      case "workspace.git.branches.read":
        return this.handleWorkspaceGitBranchesRead(
          message.params,
        );
      case "workspace.git.branch.switch":
        return this.handleWorkspaceGitBranchSwitch(
          message.params,
        );
      case "workspace.git.file.read":
        return this.handleWorkspaceGitFileRead(
          message.params,
        );
      case "git.diffToRemote":
        return {
          diff: await this.runtime.readGitDiffToRemote(
            (message.params).cwd,
          ),
        };
      case "workspace.searchFiles":
        return this.handleWorkspaceSearch(
          message.params,
        );
      default:
        throw new Error(`Unsupported method: ${(message as AppClientCallEnvelope).method}`);
    }
  }

  private async handleThreadOpen(
    sessionId: string,
    params: { workspaceId: string },
  ): Promise<{ thread: WorkbenchThread }> {
    const workspace = await this.resolveWorkspace(params.workspaceId);
    if (!workspace) {
      throw new AppError("workspace.not_found", "Workspace not found");
    }

    const runtimeThread = await this.runtime.openThread({
      cwd: workspace.absPath,
      model: workspace.defaultModel,
      approvalPolicy: workspace.approvalPolicy,
      sandboxMode: workspace.sandboxMode,
    });
    this.approvalBroker.rememberThreadOwner(runtimeThread.id, sessionId);
    const thread = await this.hydrateRuntimeThread(runtimeThread);
    return { thread };
  }

  private async handleAccountRead(): Promise<AppRequestResult<"account.read">> {
    const state = await this.runtime.readAccountState();
    const snapshot = await this.refreshIntegrations();
    return {
      state,
      snapshot,
    };
  }

  private async handleAccountLoginStart(
    params: AppRequestParams<"account.login.start">,
  ): Promise<AppRequestResult<"account.login.start">> {
    const login = await this.runtime.loginAccount(params);
    const state = await this.runtime.readAccountState();
    const snapshot = await this.refreshIntegrations();
    this.broadcast("integrations.updated", { snapshot });
    return {
      login,
      state,
      snapshot,
    };
  }

  private async handleAccountLoginCancel(
    params: AppRequestParams<"account.login.cancel">,
  ): Promise<AppRequestResult<"account.login.cancel">> {
    const status = await this.runtime.cancelAccountLogin(params.loginId);
    const state = await this.runtime.readAccountState();
    const snapshot = await this.refreshIntegrations();
    return {
      status,
      state,
      snapshot,
    };
  }

  private async handleAccountLogout(): Promise<AppRequestResult<"account.logout">> {
    await this.runtime.logoutAccount();
    const state = await this.runtime.readAccountState();
    const snapshot = await this.refreshIntegrations();
    this.broadcast("integrations.updated", { snapshot });
    return {
      state,
      snapshot,
    };
  }

  private async handleThreadList(
    params: AppRequestParams<"thread.list">,
  ): Promise<AppRequestResult<"thread.list">> {
    return this.listThreadSummaries({
      archived: params.archived,
      cursor: params.cursor ?? null,
      limit: params.limit ?? null,
      workspaceId:
        params.workspaceId && params.workspaceId !== "all" ? params.workspaceId : undefined,
    });
  }

  private async handleThreadRead(
    params: AppRequestParams<"thread.read">,
  ): Promise<AppRequestResult<"thread.read">> {
    const existingSummary = this.threadSummaries.get(params.threadId) ?? null;
    const runtimeThread = await this.runtime.readThread(params.threadId);
    return {
      thread: await this.hydrateRuntimeThread(runtimeThread, {
        archived: existingSummary?.archived ?? false,
        existingView: this.threadViews.get(params.threadId),
      }),
    };
  }

  private async handleThreadMetadataUpdate(
    params: AppRequestParams<"thread.metadata.update">,
  ): Promise<AppRequestResult<"thread.metadata.update">> {
    const existingSummary = this.threadSummaries.get(params.threadId) ?? null;
    const runtimeThread = await this.runtime.updateThreadMetadata(params.threadId, {
      gitInfo: params.gitInfo ?? undefined,
    });
    return {
      thread: await this.hydrateRuntimeThread(runtimeThread, {
        archived: existingSummary?.archived ?? false,
        existingView: this.threadViews.get(params.threadId),
      }),
    };
  }

  private async handleThreadUnsubscribe(
    params: AppRequestParams<"thread.unsubscribe">,
  ): Promise<AppRequestResult<"thread.unsubscribe">> {
    const status = await this.runtime.unsubscribeThread(params.threadId);
    this.applyThreadClosed(params.threadId);
    return { status };
  }

  private async hydrateRuntimeThread(
    runtimeThread: RuntimeThreadRecord,
    options?: {
      archived?: boolean;
      existingView?: WorkbenchThread | null;
    },
  ): Promise<WorkbenchThread> {
    const archived = options?.archived ?? runtimeThread.archived;
    const workspaces = await this.getWorkspaceCatalog([
      { cwd: runtimeThread.cwd, updatedAt: runtimeThread.updatedAt },
    ]);
    const thread = this.threadProjection.toWorkbenchThread(
      {
        ...runtimeThread,
        archived,
      },
      workspaces,
      options?.existingView ?? undefined,
    );
    this.setThreadView(thread);
    this.threadSummaries.set(thread.thread.id, thread.thread);
    this.invalidateWorkspaceCatalog();
    this.broadcast("thread.updated", { thread: thread.thread });
    return thread;
  }

  private async handleRemoteSkillExport(
    params: AppRequestParams<"skills.remote.export">,
  ): Promise<AppRequestResult<"skills.remote.export">> {
    const skill = await this.runtime.exportRemoteSkill(params.hazelnutId);
    const skills = await this.runtime.listSkills(await this.resolveWorkspaceCwd(params.workspaceId));
    return {
      skill,
      skills,
    };
  }

  private async handleSkillConfigWrite(
    params: AppRequestParams<"skills.config.write">,
  ): Promise<AppRequestResult<"skills.config.write">> {
    const response = await this.runtime.writeSkillConfig(params.path, params.enabled);
    const skills = await this.runtime.listSkills(await this.resolveWorkspaceCwd(params.workspaceId));
    return {
      effectiveEnabled: response.effectiveEnabled,
      skills,
    };
  }

  private async handlePluginInstall(
    params: AppRequestParams<"plugin.install">,
  ): Promise<AppRequestResult<"plugin.install">> {
    const install = await this.runtime.installPlugin({
      marketplacePath: params.marketplacePath,
      pluginName: params.pluginName,
    });
    const [marketplaces, apps] = await Promise.all([
      this.runtime.listPlugins(await this.resolveWorkspaceCwd(params.workspaceId)),
      this.runtime.listApps({
        threadId: params.threadId ?? null,
        forceRefetch: true,
      }),
    ]);
    return {
      marketplaces,
      apps,
      appsNeedingAuth: install.appsNeedingAuth,
    };
  }

  private async handlePluginUninstall(
    params: AppRequestParams<"plugin.uninstall">,
  ): Promise<AppRequestResult<"plugin.uninstall">> {
    await this.runtime.uninstallPlugin(params.pluginId);
    const [marketplaces, apps] = await Promise.all([
      this.runtime.listPlugins(await this.resolveWorkspaceCwd(params.workspaceId)),
      this.runtime.listApps({
        threadId: params.threadId ?? null,
        forceRefetch: true,
      }),
    ]);
    return {
      marketplaces,
      apps,
    };
  }

  private async handleThreadResume(
    sessionId: string,
    params: { threadId: string },
  ): Promise<{ thread: WorkbenchThread }> {
    const existing = this.threadSummaries.get(params.threadId) ?? null;
    const runtimeThread = await this.runtime.resumeThread(params.threadId, existing?.path ?? null);
    this.approvalBroker.rememberThreadOwner(runtimeThread.id, sessionId);
    const thread = await this.hydrateRuntimeThread(runtimeThread, {
      archived: existing?.archived ?? false,
      existingView: this.threadViews.get(runtimeThread.id),
    });
    return { thread };
  }

  private async handleThreadUnarchive(
    sessionId: string,
    params: { threadId: string },
  ): Promise<{ thread: WorkbenchThread }> {
    const runtimeThread = await this.runtime.unarchiveThread(params.threadId);
    this.approvalBroker.rememberThreadOwner(runtimeThread.id, sessionId);
    const thread = await this.hydrateRuntimeThread(runtimeThread, {
      archived: false,
      existingView: this.threadViews.get(runtimeThread.id),
    });
    return { thread };
  }

  private async handleThreadFork(
    sessionId: string,
    params: { threadId: string },
  ): Promise<{ thread: WorkbenchThread }> {
    const summary = this.threadSummaries.get(params.threadId);
    if (!summary) {
      throw new AppError("thread.not_found", "Thread not found");
    }

    const runtimeThread = await this.runtime.forkThread(params.threadId, summary.cwd);
    this.approvalBroker.rememberThreadOwner(runtimeThread.id, sessionId);
    const thread = await this.hydrateRuntimeThread(runtimeThread);
    return { thread };
  }

  private async handleThreadRollback(
    sessionId: string,
    params: { threadId: string; numTurns: number },
  ): Promise<{ thread: WorkbenchThread }> {
    const existing = this.threadSummaries.get(params.threadId) ?? null;
    const runtimeThread = await this.runtime.rollbackThread(params.threadId, params.numTurns);
    this.approvalBroker.rememberThreadOwner(runtimeThread.id, sessionId);
    const thread = await this.hydrateRuntimeThread(runtimeThread, {
      archived: existing?.archived ?? false,
      existingView: this.threadViews.get(runtimeThread.id),
    });
    return { thread };
  }

  private async handleTurnStart(
    params: { threadId: string; prompt: string; effort?: import("@webcli/contracts").ReasoningEffort | null },
  ): Promise<{ turn: WorkbenchThread["turns"][string] }> {
    const turn = await this.runtime.startTurn(
      params.threadId,
      params.prompt,
      params.effort ?? null,
    );
    const projected = this.threadProjection.toWorkbenchTurn(turn);
    const existing = this.threadViews.get(params.threadId);
    if (existing) {
      this.setThreadView(this.threadProjection.applyTurn(existing, turn));
    }
    return { turn: projected };
  }

  private async handleReviewStart(
    params: { threadId: string },
  ): Promise<{ turn: WorkbenchThread["turns"][string] | null }> {
    const turn = await this.runtime.startReview(params.threadId);
    if (!turn) {
      return { turn: null };
    }

    const projected = this.threadProjection.toWorkbenchTurn(turn);
    const existing = this.threadViews.get(params.threadId);
    if (existing) {
      this.setThreadView(this.threadProjection.applyTurn(existing, turn));
    }
    return { turn: projected };
  }

  private async handleCommandStart(
    sessionId: string,
    params: { workspaceId: string; command: string; cols: number; rows: number },
  ): Promise<{ session: CommandSessionSnapshot }> {
    const workspace = await this.resolveWorkspace(params.workspaceId);
    if (!workspace) {
      throw new AppError("workspace.not_found", "Workspace not found");
    }

    const processId = randomUUID();
    const session = this.commandService.start({
      processId,
      command: params.command,
      cwd: workspace.absPath,
      tty: true,
      allowStdin: true,
    });
    this.approvalBroker.rememberProcessOwner(processId, sessionId);
    void this.runtime.startCommand({
      processId,
      command: params.command,
      cwd: workspace.absPath,
      cols: params.cols,
      rows: params.rows,
    });
    return { session };
  }

  private async handleApprovalResolve(
    requestId: RequestId,
    decision: "accept" | "decline",
  ): Promise<{ ok: true }> {
    const approval = this.approvalBroker.get(requestId);
    if (!approval) {
      throw new AppError("approval.not_pending", "Approval no longer pending");
    }

    await this.runtime.resolveServerRequest(
      approval,
      buildDefaultServerRequestResolveInput(approval, decision),
    );
    this.approvalBroker.resolve(requestId);
    this.broadcast("approval.resolved", { requestId });
    this.broadcast("serverRequest.resolved", { requestId });
    return { ok: true };
  }

  private async handleServerRequestResolve(
    input: ServerRequestResolveInput | LegacyServerRequestResolveInput,
  ): Promise<{ ok: true }> {
    const requestId = input.requestId;
    const request = this.approvalBroker.get(requestId);
    if (!request) {
      throw new AppError("approval.not_pending", "Approval no longer pending");
    }

    const normalized = isLegacyServerRequestResolveInput(input)
      ? buildDefaultServerRequestResolveInput(request, input.decision)
      : input;
    await this.runtime.resolveServerRequest(request, normalized);
    this.approvalBroker.resolve(requestId);
    this.broadcast("approval.resolved", { requestId });
    this.broadcast("serverRequest.resolved", { requestId });
    return { ok: true };
  }

  private async handleWorkspaceSearch(
    params: { workspaceId: string; query: string },
  ): Promise<{ search: import("@webcli/contracts").FuzzySearchSnapshot }> {
    const workspace = await this.resolveWorkspace(params.workspaceId);
    if (!workspace) {
      throw new AppError("workspace.not_found", "Workspace not found");
    }

    return {
      search: await this.runtime.searchFiles({
        query: params.query,
        roots: [workspace.absPath],
      }),
    };
  }

  private async handleWorkspaceGitRead(
    params: { workspaceId: string },
  ): Promise<{ snapshot: GitWorkingTreeSnapshot }> {
    const workspace = await this.resolveWorkspace(params.workspaceId);
    if (!workspace) {
      throw new AppError("workspace.not_found", "Workspace not found");
    }

    const snapshot = await this.runtime.readWorkspaceGitSnapshot(
      workspace.absPath,
      workspace.id,
      workspace.name,
    );
    this.workspaceGitSnapshots.set(workspace.id, snapshot);
    this.broadcast("workspace.git.updated", { snapshot });
    return { snapshot };
  }

  private async handleWorkspaceGitBranchesRead(
    params: { workspaceId: string },
  ): Promise<{
    branches: Array<import("@webcli/contracts").GitBranchReference>;
    currentBranch: string | null;
  }> {
    const workspace = await this.resolveWorkspace(params.workspaceId);
    if (!workspace) {
      throw new AppError("workspace.not_found", "Workspace not found");
    }

    return this.runtime.readWorkspaceGitBranches(workspace.absPath);
  }

  private async handleWorkspaceGitBranchSwitch(
    params: { workspaceId: string; branch: string },
  ): Promise<{
    snapshot: GitWorkingTreeSnapshot;
    branches: Array<import("@webcli/contracts").GitBranchReference>;
    currentBranch: string | null;
  }> {
    const workspace = await this.resolveWorkspace(params.workspaceId);
    if (!workspace) {
      throw new AppError("workspace.not_found", "Workspace not found");
    }

    await this.runtime.switchWorkspaceGitBranch(workspace.absPath, params.branch);
    const snapshot = await this.runtime.readWorkspaceGitSnapshot(
      workspace.absPath,
      workspace.id,
      workspace.name,
    );
    this.workspaceGitSnapshots.set(workspace.id, snapshot);
    this.broadcast("workspace.git.updated", { snapshot });
    const branchState = await this.runtime.readWorkspaceGitBranches(workspace.absPath);

    return {
      snapshot,
      branches: branchState.branches,
      currentBranch: branchState.currentBranch,
    };
  }

  private async handleWorkspaceGitFileRead(
    params: { workspaceId: string; path: string },
  ): Promise<{ detail: import("@webcli/contracts").GitFileReviewDetail }> {
    const workspace = await this.resolveWorkspace(params.workspaceId);
    if (!workspace) {
      throw new AppError("workspace.not_found", "Workspace not found");
    }

    let snapshot = this.workspaceGitSnapshots.get(workspace.id);
    let file = snapshot?.files.find((entry) => entry.path === params.path) ?? null;

    if (!snapshot || !file) {
      snapshot = await this.runtime.readWorkspaceGitSnapshot(
        workspace.absPath,
        workspace.id,
        workspace.name,
      );
      this.workspaceGitSnapshots.set(workspace.id, snapshot);
      file = snapshot.files.find((entry) => entry.path === params.path) ?? null;
    }

    if (!file) {
      throw new AppError("git.file_not_found", "Git file not found", {
        path: params.path,
      });
    }

    return {
      detail: await this.runtime.readWorkspaceGitFileDetail(workspace.absPath, file),
    };
  }

  private async handleRuntimeEvent(event: SessionRuntimeEvent): Promise<void> {
    switch (event.type) {
      case "status.changed":
        {
          const previousStatus = this.runtimeStatus;
          this.runtimeStatus = event.status;
          const shouldWarmup =
            event.status.connected &&
            (!previousStatus.connected || previousStatus.restartCount !== event.status.restartCount);

          if (shouldWarmup) {
            this.resetThreadSummaryCache();
            this.scheduleThreadSummaryWarmup();
          }
        }
        this.broadcast("runtime.statusChanged", { runtime: event.status });
        return;
      case "account.updated":
        this.broadcast("account.updated", { account: event.account });
        return;
      case "account.login.completed": {
        const state = await this.runtime.readAccountState();
        const snapshot = await this.refreshIntegrations();
        this.broadcast("account.login.completed", {
          login: event.login,
          state,
          snapshot,
        });
        return;
      }
      case "account.rateLimits.updated":
        this.broadcast("account.rateLimitsUpdated", {
          rateLimits: event.rateLimits,
        });
        return;
      case "model.rerouted":
        this.broadcastModelRerouted(event.reroute);
        return;
      case "config.warning":
        this.broadcastConfigWarning(event.warning);
        return;
      case "deprecation.notice":
        this.broadcastDeprecationNotice(event.notice);
        return;
      case "thread.updated": {
        const workspaces = await this.getWorkspaceCatalog([
          { cwd: event.thread.cwd, updatedAt: event.thread.updatedAt },
        ]);
        const summary = this.threadProjection.toThreadSummary(event.thread, workspaces);
        this.threadSummaries.set(summary.id, summary);
        const existing = this.threadViews.get(summary.id);
        if (existing) {
          this.setThreadView(
            this.threadProjection.toWorkbenchThread(event.thread, workspaces, existing),
          );
        }
        this.invalidateWorkspaceCatalog();
        this.broadcast("thread.updated", { thread: summary });
        return;
      }
      case "thread.status.changed": {
        const summary = this.threadSummaries.get(event.threadId);
        if (!summary) {
          return;
        }

        const next = {
          ...summary,
          status: event.status,
          updatedAt: Math.max(summary.updatedAt, Math.floor(Date.now() / 1000)),
        };
        this.threadSummaries.set(event.threadId, next);
        const existing = this.threadViews.get(event.threadId);
        if (existing) {
          this.setThreadView({
            ...existing,
            thread: next,
          });
        }
        this.broadcast("thread.updated", { thread: next });
        if (!isThreadRunning(event.status)) {
          void this.refreshWorkspaceGitSnapshotForWorkspaceId(next.workspaceId);
        }
        return;
      }
      case "thread.name.changed": {
        const summary = this.threadSummaries.get(event.threadId);
        if (!summary) {
          return;
        }
        const next = { ...summary, name: event.name };
        this.threadSummaries.set(event.threadId, next);
        const existing = this.threadViews.get(event.threadId);
        if (existing) {
          this.setThreadView({
            ...existing,
            thread: next,
          });
        }
        this.broadcast("thread.updated", { thread: next });
        return;
      }
      case "thread.archive.changed": {
        const summary = this.threadSummaries.get(event.threadId);
        if (!summary) {
          return;
        }
        const next = { ...summary, archived: event.archived };
        this.threadSummaries.set(event.threadId, next);
        const existing = this.threadViews.get(event.threadId);
        if (existing) {
          this.setThreadView({
            ...existing,
            archived: event.archived,
            thread: next,
          });
        }
        this.broadcast("thread.updated", { thread: next });
        return;
      }
      case "thread.closed":
        this.applyThreadClosed(event.threadId);
        return;
      case "thread.tokenUsage.updated":
        this.applyTurnTokenUsage(event.threadId, event.turnId, event.tokenUsage);
        return;
      case "thread.realtime.started":
        this.broadcast("thread.realtimeStarted", {
          threadId: event.threadId,
          sessionId: event.sessionId,
        });
        return;
      case "thread.realtime.itemAdded":
        this.broadcast("thread.realtimeItemAdded", {
          threadId: event.threadId,
          item: event.item,
        });
        return;
      case "thread.realtime.outputAudio.delta":
        this.broadcast("thread.realtimeOutputAudioDelta", {
          threadId: event.threadId,
          audio: event.audio,
        });
        return;
      case "thread.realtime.error":
        this.broadcast("thread.realtimeError", {
          threadId: event.threadId,
          message: event.message,
        });
        return;
      case "thread.realtime.closed":
        this.broadcast("thread.realtimeClosed", {
          threadId: event.threadId,
          reason: event.reason,
        });
        return;
      case "turn.updated": {
        const existing = this.threadViews.get(event.threadId);
        if (existing) {
          this.setThreadView(this.threadProjection.applyTurn(existing, event.turn));
        }
        this.broadcast("turn.updated", {
          threadId: event.threadId,
          turn: this.threadProjection.toWorkbenchTurn(event.turn),
        });
        return;
      }
      case "timeline.item": {
        const existing = this.threadViews.get(event.threadId);
        if (existing) {
          this.setThreadView(this.threadProjection.applyTimelineItem(existing, event.item));
        }
        this.broadcast("timeline.item", {
          threadId: event.threadId,
          item: event.item,
        });
        return;
      }
      case "timeline.delta": {
        const existing = this.threadViews.get(event.threadId);
        if (existing) {
          this.setThreadView(this.threadProjection.appendTimelineDelta(existing, event.item));
        }
        this.broadcast("timeline.delta", {
          threadId: event.threadId,
          item: event.item,
        });
        return;
      }
      case "diff.updated": {
        const existing = this.threadViews.get(event.threadId);
        if (existing) {
          this.setThreadView(this.threadProjection.applyDiff(existing, event.diff));
        }
        this.broadcast("diff.updated", { threadId: event.threadId, diff: event.diff });
        void this.refreshWorkspaceGitSnapshotForThread(event.threadId);
        return;
      }
      case "plan.updated": {
        const plan = {
          turnId: event.turnId,
          explanation: event.explanation,
          plan: event.plan,
        };
        const existing = this.threadViews.get(event.threadId);
        if (existing) {
          this.setThreadView(this.threadProjection.applyPlan(existing, plan));
        }
        this.broadcast("plan.updated", { threadId: event.threadId, plan });
        return;
      }
      case "review.updated": {
        const existing = this.threadViews.get(event.threadId);
        if (existing) {
          this.setThreadView(this.threadProjection.applyReview(existing, event.review));
        }
        this.broadcast("review.updated", { threadId: event.threadId, review: event.review });
        return;
      }
      case "approval.requested": {
        const sessionId = this.approvalBroker.resolveSessionIdForThread(event.approval.threadId);
        if (!sessionId) {
          return;
        }
        this.approvalBroker.queue(event.approval, sessionId);
        this.notifySession(sessionId, "approval.requested", { approval: event.approval });
        this.notifySession(sessionId, "serverRequest.requested", { request: event.approval });
        return;
      }
      case "approval.resolved":
        this.approvalBroker.resolve(event.requestId);
        this.broadcast("approval.resolved", { requestId: event.requestId });
        this.broadcast("serverRequest.resolved", { requestId: event.requestId });
        return;
      case "command.output": {
        const session = this.commandService.appendOutput(event.processId, event.stream, event.text);
        const ownerSessionId = this.approvalBroker.resolveSessionIdForProcess(event.processId);
        if (!ownerSessionId) {
          return;
        }
        this.notifySession(ownerSessionId, "command.output", {
          processId: event.processId,
          stream: event.stream,
          text: event.text,
          session,
        });
        return;
      }
      case "command.completed": {
        const session = this.commandService.complete(event.processId, event.session);
        const ownerSessionId = this.approvalBroker.resolveSessionIdForProcess(event.processId);
        if (!ownerSessionId) {
          return;
        }
        this.notifySession(ownerSessionId, "command.output", {
          processId: event.processId,
          stream: "stdout",
          text: "",
          session,
        });
        void this.refreshWorkspaceGitSnapshotForPath(session?.cwd ?? null);
        return;
      }
      case "skills.changed":
        this.broadcast("skills.changed", {});
        return;
      case "app.list.updated":
        this.broadcast("app.listUpdated", { apps: event.apps });
        return;
    }
  }

  private applyThreadClosed(threadId: string): void {
    const summary = this.threadSummaries.get(threadId);
    if (summary) {
      const next = {
        ...summary,
        status: { type: "notLoaded" } as const,
      };
      this.threadSummaries.set(threadId, next);
      const existing = this.threadViews.get(threadId);
      if (existing) {
        this.setThreadView({
          ...existing,
          thread: next,
        });
      }
      this.broadcast("thread.updated", { thread: next });
    }
    this.broadcast("thread.closed", { threadId });
  }

  private applyTurnTokenUsage(
    threadId: string,
    turnId: string,
    tokenUsage: import("@webcli/contracts").ThreadTokenUsage,
  ): void {
    const existing = this.threadViews.get(threadId);
    if (!existing) {
      this.broadcast("thread.tokenUsageUpdated", {
        threadId,
        turnId,
        tokenUsage,
      });
      return;
    }

    const turn = existing.turns[turnId];
    if (!turn) {
      this.broadcast("thread.tokenUsageUpdated", {
        threadId,
        turnId,
        tokenUsage,
      });
      return;
    }

    this.setThreadView({
      ...existing,
      turns: {
        ...existing.turns,
        [turnId]: {
          ...turn,
          turn: {
            ...turn.turn,
            tokenUsage,
          },
        },
      },
    });
    this.broadcast("thread.tokenUsageUpdated", {
      threadId,
      turnId,
      tokenUsage,
    });
  }

  private async refreshIntegrations(
    workspaceId?: string | "all",
    threadId?: string | null,
  ): Promise<IntegrationSnapshot> {
    return this.runtime.getIntegrationSnapshot({
      cwd: await this.resolveWorkspaceCwd(workspaceId),
      threadId: threadId ?? null,
    });
  }

  private async resolveWorkspaceCwd(
    workspaceId?: string | "all",
  ): Promise<string | null> {
    const workspace = workspaceId && workspaceId !== "all" ? await this.resolveWorkspace(workspaceId) : null;
    return workspace?.absPath ?? null;
  }

  private async resolveWorkspace(id: string): Promise<WorkspaceRecord | null> {
    const saved = this.workspaceRepo.get(id);
    if (saved) {
      return saved;
    }

    await this.ensureThreadSummaryCache();
    const workspaces = await this.getWorkspaceCatalog();
    return workspaces.find((workspace) => workspace.id === id) ?? null;
  }

  private async refreshWorkspaceGitSnapshotForThread(threadId: string): Promise<void> {
    const summary = this.threadSummaries.get(threadId);
    if (!summary) {
      return;
    }

    await this.refreshWorkspaceGitSnapshotForWorkspaceId(summary.workspaceId);
  }

  private async refreshWorkspaceGitSnapshotForPath(cwd: string | null | undefined): Promise<void> {
    if (!cwd) {
      return;
    }

    const workspaces = await this.getWorkspaceCatalog([
      { cwd, updatedAt: Math.floor(Date.now() / 1000) },
    ]);
    const workspace = this.workspaceCatalog.matchWorkspaceForPath(workspaces, cwd);
    if (!workspace) {
      return;
    }

    await this.refreshWorkspaceGitSnapshot(workspace);
  }

  private async refreshWorkspaceGitSnapshotForWorkspaceId(
    workspaceId: string | null | undefined,
  ): Promise<void> {
    if (!workspaceId) {
      return;
    }

    const workspace = await this.resolveWorkspace(workspaceId);
    if (!workspace) {
      return;
    }

    await this.refreshWorkspaceGitSnapshot(workspace);
  }

  private async refreshWorkspaceGitSnapshot(workspace: WorkspaceRecord): Promise<void> {
    const snapshot = await this.runtime.readWorkspaceGitSnapshot(
      workspace.absPath,
      workspace.id,
      workspace.name,
    );
    this.workspaceGitSnapshots.set(workspace.id, snapshot);
    this.broadcast("workspace.git.updated", { snapshot });
  }

  private replaceThreadSummaryCache(
    activeThreads: Array<ThreadSummary>,
    archivedThreads: Array<ThreadSummary>,
  ): void {
    this.threadSummaries.clear();
    for (const thread of [...activeThreads, ...archivedThreads]) {
      this.threadSummaries.set(thread.id, thread);
    }
  }

  private async ensureThreadSummaryCache(): Promise<void> {
    if (this.summaryCacheInitialized) {
      return;
    }

    await this.refreshThreadSummaryCache();
  }

  private async refreshThreadSummaryCache(): Promise<void> {
    const [activeThreads, archivedThreads] = await Promise.all([
      this.runtime.listThreads(false),
      this.runtime.listThreads(true),
    ]);
    const workspaces = this.workspaceCatalog.buildWorkspaceCatalog(
      this.workspaceRepo.list(),
      [...activeThreads, ...archivedThreads],
      this.homePath,
      this.workspaceRepo.listIgnoredPaths(),
    );
    this.cachedWorkspaceCatalog = workspaces;
    this.replaceThreadSummaryCache(
      activeThreads.map((thread) => this.threadProjection.toThreadSummary(thread, workspaces)),
      archivedThreads.map((thread) => this.threadProjection.toThreadSummary(thread, workspaces)),
    );
    this.summaryCacheInitialized = true;
  }

  private async getWorkspaceCatalog(
    extraThreads: Array<{ cwd: string; updatedAt: number }> = [],
  ): Promise<Array<WorkspaceRecord>> {
    await this.ensureThreadSummaryCache();
    if (extraThreads.length === 0 && this.cachedWorkspaceCatalog) {
      return this.cachedWorkspaceCatalog;
    }

    const workspaces = this.workspaceCatalog.buildWorkspaceCatalog(
      this.workspaceRepo.list(),
      [
        ...Array.from(this.threadSummaries.values()).map((thread) => ({
          cwd: thread.cwd,
          updatedAt: thread.updatedAt,
        })),
        ...extraThreads,
      ],
      this.homePath,
      this.workspaceRepo.listIgnoredPaths(),
    );

    if (extraThreads.length === 0) {
      this.cachedWorkspaceCatalog = workspaces;
    }

    return workspaces;
  }

  private getSortedThreadSummaries(): Array<ThreadSummary> {
    return [...this.threadSummaries.values()].sort(
      (left, right) =>
        right.updatedAt - left.updatedAt ||
        right.createdAt - left.createdAt ||
        left.id.localeCompare(right.id),
    );
  }

  private invalidateWorkspaceCatalog(): void {
    this.cachedWorkspaceCatalog = null;
  }

  private resetThreadSummaryCache(): void {
    this.summaryCacheInitialized = false;
    this.invalidateWorkspaceCatalog();
  }

  private clearThreadSummaryWarmupTimer(): void {
    if (this.threadSummaryWarmupTimer !== null) {
      clearTimeout(this.threadSummaryWarmupTimer);
      this.threadSummaryWarmupTimer = null;
    }
  }

  private scheduleThreadSummaryWarmup(): void {
    this.clearThreadSummaryWarmupTimer();
    this.threadSummaryWarmupAttempt = 0;
    void this.runThreadSummaryWarmup();
  }

  private async runThreadSummaryWarmup(): Promise<void> {
    if (!this.runtime.getStatus().connected) {
      return;
    }

    this.threadSummaryWarmupAttempt += 1;
    await this.refreshThreadSummaryCache();

    if (this.threadSummaries.size > 0) {
      this.broadcast("runtime.statusChanged", { runtime: this.runtime.getStatus() });
      return;
    }

    if (this.threadSummaryWarmupAttempt >= MAX_THREAD_SUMMARY_WARMUP_ATTEMPTS) {
      return;
    }

    this.summaryCacheInitialized = false;
    this.threadSummaryWarmupTimer = setTimeout(() => {
      this.threadSummaryWarmupTimer = null;
      void this.runThreadSummaryWarmup();
    }, THREAD_SUMMARY_WARMUP_RETRY_MS);
  }

  private reprojectThreadSummaries(workspaces: Array<WorkspaceRecord>): void {
    for (const [threadId, summary] of this.threadSummaries.entries()) {
      const workspace = this.workspaceCatalog.matchWorkspaceForPath(workspaces, summary.cwd);
      if (
        summary.workspaceId === (workspace?.id ?? null) &&
        summary.workspaceName === (workspace?.name ?? null)
      ) {
        continue;
      }

      const next = {
        ...summary,
        workspaceId: workspace?.id ?? null,
        workspaceName: workspace?.name ?? null,
      };
      this.threadSummaries.set(threadId, next);
      const existing = this.threadViews.get(threadId);
      if (existing) {
        this.setThreadView({
          ...existing,
          thread: next,
        });
      }
    }
  }

  private setThreadView(thread: WorkbenchThread): void {
    this.threadViews.delete(thread.thread.id);
    this.threadViews.set(thread.thread.id, thread);
    this.pruneThreadViews();
  }

  private pruneThreadViews(): void {
    if (this.threadViews.size <= MAX_RETAINED_THREAD_VIEWS) {
      return;
    }

    const pinnedThreadIds = new Set<string>();
    for (const approval of this.approvalBroker.list()) {
      if (approval.threadId) {
        pinnedThreadIds.add(approval.threadId);
      }
    }
    for (const summary of this.threadSummaries.values()) {
      if (isThreadRunning(summary)) {
        pinnedThreadIds.add(summary.id);
      }
    }

    for (const threadId of this.threadViews.keys()) {
      if (this.threadViews.size <= MAX_RETAINED_THREAD_VIEWS) {
        break;
      }
      if (pinnedThreadIds.has(threadId)) {
        continue;
      }
      this.threadViews.delete(threadId);
    }
  }

  private validateWorkspaceInput(input: WorkspaceCreateInput): WorkspaceCreateInput {
    if (!input || typeof input !== "object") {
      throw new AppError("workspace.payload_required", "Workspace payload is required");
    }

    if (!input.name?.trim()) {
      throw new AppError("workspace.name_required", "Workspace name is required");
    }

    if (!input.absPath?.trim()) {
      throw new AppError("workspace.path_required", "Workspace path is required");
    }

    return {
      name: input.name.trim(),
      absPath: ensureHomeScopedDirectory(input.absPath, this.homePath),
      defaultModel: input.defaultModel ?? null,
      approvalPolicy: input.approvalPolicy ?? "on-request",
      sandboxMode: input.sandboxMode ?? "danger-full-access",
    };
  }

  private validateWorkspaceUpdate(input: WorkspaceUpdateInput): WorkspaceUpdateInput {
    if (!input || typeof input !== "object") {
      return {};
    }

    return {
      name: input.name?.trim(),
      absPath: input.absPath
        ? ensureHomeScopedDirectory(input.absPath, this.homePath)
        : undefined,
      defaultModel:
        input.defaultModel === undefined ? undefined : (input.defaultModel ?? null),
      approvalPolicy: input.approvalPolicy,
      sandboxMode: input.sandboxMode,
    };
  }

  private notifyConnection<TMethod extends AppEventMethod>(
    connectionId: string,
    method: TMethod,
    params: AppEventParams<TMethod>,
  ): void {
    const message = {
      type: "server.notification",
      method,
      params,
    } as AppServerNotificationEnvelope<TMethod>;
    this.connections.get(connectionId)?.sender(message);
  }

  private notifySession<TMethod extends AppEventMethod>(
    sessionId: string,
    method: TMethod,
    params: AppEventParams<TMethod>,
  ): void {
    const connectionIds = this.sessionConnections.get(sessionId);
    if (!connectionIds) {
      return;
    }

    for (const connectionId of connectionIds) {
      this.notifyConnection(connectionId, method, params);
    }
  }

  private broadcast<TMethod extends AppEventMethod>(
    method: TMethod,
    params: AppEventParams<TMethod>,
  ): void {
    for (const connectionId of this.connections.keys()) {
      this.notifyConnection(connectionId, method, params);
    }
  }

  private broadcastModelRerouted(reroute: ModelRerouteEvent): void {
    this.broadcast("model.rerouted", { reroute });
  }

  private broadcastConfigWarning(warning: ConfigWarningNotice): void {
    this.broadcast("config.warning", { warning });
  }

  private broadcastDeprecationNotice(notice: DeprecationNotice): void {
    this.broadcast("deprecation.notice", { notice });
  }
}

function normalizeNullableEnum<T extends string>(value: T | null): T | null {
  return value ?? null;
}

function clampThreadPageSize(value: number | null | undefined): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_THREAD_PAGE_SIZE;
  }

  return Math.min(Math.max(Math.floor(value ?? DEFAULT_THREAD_PAGE_SIZE), 1), 200);
}

function parseThreadPageCursor(value: string | null | undefined): number {
  if (!value) {
    return 0;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function isThreadRunning(threadOrStatus: ThreadSummary | ThreadSummary["status"]): boolean {
  const status = "status" in threadOrStatus ? threadOrStatus.status : threadOrStatus;
  return status.type === "active";
}
