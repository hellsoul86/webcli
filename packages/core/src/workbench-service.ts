import { randomUUID } from "node:crypto";
import { AppError } from "@webcli/contracts";
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
  GitWorkingTreeSnapshot,
  HealthResponse,
  IntegrationSnapshot,
  PendingApproval,
  RequestId,
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
  ensureHomeScopedPath,
  listHomePathSuggestions,
  resolveHomeDirectory,
} from "./home-paths.js";
import type { SessionRuntime, SessionRuntimeEvent } from "./runtime.js";
import { ThreadProjectionService } from "./thread-projection-service.js";
import { WorkspaceCatalogService } from "./workspace-catalog-service.js";
import { WorkspaceRepo } from "./workspace-repo.js";

type ConnectionSender = (message: AppServerMessage) => void;

type ConnectionRecord = {
  sessionId: string;
  sender: ConnectionSender;
};

const MAX_RETAINED_THREAD_VIEWS = 5;
const DEFAULT_THREAD_PAGE_SIZE = 50;

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

  constructor(
    private readonly runtime: SessionRuntime,
    private readonly workspaceRepo: WorkspaceRepo,
    homePath = resolveHomeDirectory(),
  ) {
    this.homePath = homePath;
    this.runtime.subscribe((event) => {
      void this.handleRuntimeEvent(event);
    });
  }

  async start(): Promise<void> {
    void this.runtime.start().catch(() => {});
  }

  async stop(): Promise<void> {
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

  createWorkspace(input: WorkspaceCreateInput): WorkspaceRecord {
    const normalized = this.validateWorkspaceInput(input);
    const created = this.workspaceRepo.create(normalized);
    this.invalidateWorkspaceCatalog();
    return created;
  }

  dismissWorkspace(input: WorkspaceDismissInput): void {
    const absPath = ensureHomeScopedPath(input.absPath, this.homePath);
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
          message.params as AppRequestParams<"account.login.start">,
        );
      case "account.login.cancel":
        return this.handleAccountLoginCancel(
          message.params as AppRequestParams<"account.login.cancel">,
        );
      case "account.logout":
        return this.handleAccountLogout();
      case "thread.open":
        return this.handleThreadOpen(
          sessionId,
          message.params as AppRequestParams<"thread.open">,
        );
      case "thread.resume":
        return this.handleThreadResume(
          sessionId,
          message.params as AppRequestParams<"thread.resume">,
        );
      case "thread.rename":
        {
          const params = message.params as AppRequestParams<"thread.rename">;
          await this.runtime.renameThread(params.threadId, params.name);
        }
        return { ok: true };
      case "thread.archive":
        {
          const params = message.params as AppRequestParams<"thread.archive">;
          const summary = this.threadSummaries.get(params.threadId);
          await this.runtime.archiveThread(params.threadId, summary?.path ?? null);
        }
        return { ok: true };
      case "thread.unarchive":
        return this.handleThreadUnarchive(
          sessionId,
          message.params as AppRequestParams<"thread.unarchive">,
        );
      case "thread.fork":
        return this.handleThreadFork(
          sessionId,
          message.params as AppRequestParams<"thread.fork">,
        );
      case "thread.compact":
        await this.runtime.compactThread(
          (message.params as AppRequestParams<"thread.compact">).threadId,
        );
        return { ok: true };
      case "thread.rollback":
        return this.handleThreadRollback(
          sessionId,
          message.params as AppRequestParams<"thread.rollback">,
        );
      case "turn.start":
        return this.handleTurnStart(message.params as AppRequestParams<"turn.start">);
      case "turn.interrupt":
        {
          const params = message.params as AppRequestParams<"turn.interrupt">;
          await this.runtime.interruptTurn(params.threadId, params.turnId);
        }
        return { ok: true };
      case "turn.steer":
        {
          const params = message.params as AppRequestParams<"turn.steer">;
          await this.runtime.steerTurn(params.threadId, params.turnId, params.prompt);
        }
        return { ok: true };
      case "review.start":
        return this.handleReviewStart(message.params as AppRequestParams<"review.start">);
      case "command.start":
        return this.handleCommandStart(
          sessionId,
          message.params as AppRequestParams<"command.start">,
        );
      case "command.write":
        {
          const params = message.params as AppRequestParams<"command.write">;
          await this.runtime.writeCommand(params.processId, params.text);
        }
        return { ok: true };
      case "command.resize":
        {
          const params = message.params as AppRequestParams<"command.resize">;
          await this.runtime.resizeCommand(params.processId, params.cols, params.rows);
        }
        return { ok: true };
      case "command.stop":
        await this.runtime.stopCommand(
          (message.params as AppRequestParams<"command.stop">).processId,
        );
        return { ok: true };
      case "approval.resolve":
        return this.handleApprovalResolve(
          (message.params as AppRequestParams<"approval.resolve">).requestId,
          (message.params as AppRequestParams<"approval.resolve">).decision,
        );
      case "integrations.refresh":
        return {
          snapshot: await this.refreshIntegrations(
            (message.params as AppRequestParams<"integrations.refresh">).workspaceId,
            (message.params as AppRequestParams<"integrations.refresh">).threadId,
          ),
        };
      case "integrations.mcp.login":
        return {
          authorizationUrl: await this.runtime.loginMcp(
            (message.params as AppRequestParams<"integrations.mcp.login">).name,
          ),
        };
      case "integrations.mcp.reload":
        await this.runtime.reloadMcp();
        return {
          snapshot: await this.refreshIntegrations(),
        };
      case "integrations.plugin.uninstall":
        await this.runtime.uninstallPlugin(
          (message.params as AppRequestParams<"integrations.plugin.uninstall">).pluginId,
        );
        return {
          snapshot: await this.refreshIntegrations(
            (message.params as AppRequestParams<"integrations.plugin.uninstall">).workspaceId,
            (message.params as AppRequestParams<"integrations.plugin.uninstall">).threadId,
          ),
        };
      case "settings.save":
        {
          const params = message.params as AppRequestParams<"settings.save">;
          await this.runtime.saveSettings({
            model: params.model,
            reasoningEffort: params.reasoningEffort,
            serviceTier: params.serviceTier,
            approvalPolicy: normalizeNullableEnum(params.approvalPolicy),
            sandboxMode: normalizeNullableEnum(params.sandboxMode),
          } as ConfigSnapshot);
        }
        return {
          snapshot: await this.refreshIntegrations(),
        };
      case "workspace.git.read":
        return this.handleWorkspaceGitRead(
          message.params as AppRequestParams<"workspace.git.read">,
        );
      case "workspace.git.branches.read":
        return this.handleWorkspaceGitBranchesRead(
          message.params as AppRequestParams<"workspace.git.branches.read">,
        );
      case "workspace.git.branch.switch":
        return this.handleWorkspaceGitBranchSwitch(
          message.params as AppRequestParams<"workspace.git.branch.switch">,
        );
      case "workspace.searchFiles":
        return this.handleWorkspaceSearch(
          message.params as AppRequestParams<"workspace.searchFiles">,
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

    const workspaces = await this.getWorkspaceCatalog([
      { cwd: runtimeThread.cwd, updatedAt: runtimeThread.updatedAt },
    ]);
    const thread = this.threadProjection.toWorkbenchThread(runtimeThread, workspaces);
    this.setThreadView(thread);
    this.threadSummaries.set(thread.thread.id, thread.thread);
    this.invalidateWorkspaceCatalog();
    this.broadcast("thread.updated", { thread: thread.thread });
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

  private async handleThreadResume(
    sessionId: string,
    params: { threadId: string },
  ): Promise<{ thread: WorkbenchThread }> {
    const existing = this.threadSummaries.get(params.threadId) ?? null;
    const runtimeThread = await this.runtime.resumeThread(params.threadId, existing?.path ?? null);
    this.approvalBroker.rememberThreadOwner(runtimeThread.id, sessionId);

    const workspaces = await this.getWorkspaceCatalog([
      { cwd: runtimeThread.cwd, updatedAt: runtimeThread.updatedAt },
    ]);
    const thread = this.threadProjection.toWorkbenchThread(
      runtimeThread,
      workspaces,
      this.threadViews.get(runtimeThread.id),
    );
    this.setThreadView(thread);
    this.threadSummaries.set(thread.thread.id, thread.thread);
    this.invalidateWorkspaceCatalog();
    this.broadcast("thread.updated", { thread: thread.thread });
    return { thread };
  }

  private async handleThreadUnarchive(
    sessionId: string,
    params: { threadId: string },
  ): Promise<{ thread: WorkbenchThread }> {
    const runtimeThread = await this.runtime.unarchiveThread(params.threadId);
    this.approvalBroker.rememberThreadOwner(runtimeThread.id, sessionId);
    const workspaces = await this.getWorkspaceCatalog([
      { cwd: runtimeThread.cwd, updatedAt: runtimeThread.updatedAt },
    ]);
    const thread = this.threadProjection.toWorkbenchThread(
      runtimeThread,
      workspaces,
      this.threadViews.get(runtimeThread.id),
    );
    this.setThreadView(thread);
    this.threadSummaries.set(thread.thread.id, thread.thread);
    this.invalidateWorkspaceCatalog();
    this.broadcast("thread.updated", { thread: thread.thread });
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
    const workspaces = await this.getWorkspaceCatalog([
      { cwd: runtimeThread.cwd, updatedAt: runtimeThread.updatedAt },
    ]);
    const thread = this.threadProjection.toWorkbenchThread(runtimeThread, workspaces);
    this.setThreadView(thread);
    this.threadSummaries.set(thread.thread.id, thread.thread);
    this.invalidateWorkspaceCatalog();
    this.broadcast("thread.updated", { thread: thread.thread });
    return { thread };
  }

  private async handleThreadRollback(
    sessionId: string,
    params: { threadId: string; numTurns: number },
  ): Promise<{ thread: WorkbenchThread }> {
    const runtimeThread = await this.runtime.rollbackThread(params.threadId, params.numTurns);
    this.approvalBroker.rememberThreadOwner(runtimeThread.id, sessionId);
    const workspaces = await this.getWorkspaceCatalog([
      { cwd: runtimeThread.cwd, updatedAt: runtimeThread.updatedAt },
    ]);
    const thread = this.threadProjection.toWorkbenchThread(
      runtimeThread,
      workspaces,
      this.threadViews.get(runtimeThread.id),
    );
    this.setThreadView(thread);
    this.threadSummaries.set(thread.thread.id, thread.thread);
    this.invalidateWorkspaceCatalog();
    this.broadcast("thread.updated", { thread: thread.thread });
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

    await this.runtime.resolveApproval(approval, decision);
    this.approvalBroker.resolve(requestId);
    this.broadcast("approval.resolved", { requestId });
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

  private async handleRuntimeEvent(event: SessionRuntimeEvent): Promise<void> {
    switch (event.type) {
      case "status.changed":
        this.broadcast("runtime.statusChanged", { runtime: event.status });
        return;
      case "account.updated":
        this.broadcast("account.updated", { account: event.account });
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
        return;
      }
      case "approval.resolved":
        this.approvalBroker.resolve(event.requestId);
        this.broadcast("approval.resolved", { requestId: event.requestId });
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
    }
  }

  private async refreshIntegrations(
    workspaceId?: string | "all",
    threadId?: string | null,
  ): Promise<IntegrationSnapshot> {
    const workspace = workspaceId && workspaceId !== "all" ? await this.resolveWorkspace(workspaceId) : null;
    return this.runtime.getIntegrationSnapshot({
      cwd: workspace?.absPath ?? null,
      threadId: threadId ?? null,
    });
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
