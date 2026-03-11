import { randomUUID } from "node:crypto";
import type {
  AppClientCallEnvelope,
  AppClientMessage,
  AppEventMethod,
  AppEventParams,
  AppRequestParams,
  AppRequestMethod,
  AppRequestResult,
  AppServerMessage,
  AppServerNotificationEnvelope,
  BootstrapResponse,
  CommandSessionSnapshot,
  ConfigSnapshot,
  HealthResponse,
  IntegrationSnapshot,
  PendingApproval,
  RequestId,
  ThreadSummary,
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
    const [account, models, activeThreads, archivedThreads, loadedThreadIds, config] = await Promise.all([
      this.runtime.getAccountSummary(true),
      this.runtime.listModels(),
      this.runtime.listThreads(false),
      this.runtime.listThreads(true),
      this.runtime.listLoadedThreadIds(),
      this.runtime.readConfigSnapshot(),
    ]);
    const workspaces = this.workspaceCatalog.buildWorkspaceCatalog(
      this.workspaceRepo.list(),
      [...activeThreads, ...archivedThreads],
      this.homePath,
      this.workspaceRepo.listIgnoredPaths(),
    );

    const activeSummaries = activeThreads.map((thread) =>
      this.threadProjection.toThreadSummary(thread, workspaces),
    );
    const archivedSummaries = archivedThreads.map((thread) =>
      this.threadProjection.toThreadSummary(thread, workspaces),
    );

    this.replaceThreadSummaryCache(activeSummaries, archivedSummaries);

    return {
      runtime: this.runtime.getStatus(),
      account,
      models,
      workspaces,
      activeThreads: activeSummaries,
      archivedThreads: archivedSummaries,
      loadedThreadIds,
      settings: {
        config,
      },
    };
  }

  listWorkspaces(): Promise<Array<WorkspaceRecord>> {
    return this.buildWorkspaceCatalog();
  }

  listPathSuggestions(query: string | undefined) {
    return listHomePathSuggestions(query, this.homePath);
  }

  createWorkspace(input: WorkspaceCreateInput): WorkspaceRecord {
    const normalized = this.validateWorkspaceInput(input);
    return this.workspaceRepo.create(normalized);
  }

  dismissWorkspace(input: WorkspaceDismissInput): void {
    const absPath = ensureHomeScopedPath(input.absPath, this.homePath);
    this.workspaceRepo.ignorePath(absPath);
  }

  updateWorkspace(id: string, input: WorkspaceUpdateInput): WorkspaceRecord | null {
    const normalized = this.validateWorkspaceUpdate(input);
    return this.workspaceRepo.update(id, normalized);
  }

  deleteWorkspace(id: string): boolean {
    return this.workspaceRepo.delete(id);
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
        await this.runtime.archiveThread(
          (message.params as AppRequestParams<"thread.archive">).threadId,
        );
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
            approvalPolicy: normalizeNullableEnum(params.approvalPolicy),
            sandboxMode: normalizeNullableEnum(params.sandboxMode),
          } as ConfigSnapshot);
        }
        return {
          snapshot: await this.refreshIntegrations(),
        };
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
      throw new Error("Workspace not found");
    }

    const runtimeThread = await this.runtime.openThread({
      cwd: workspace.absPath,
      model: workspace.defaultModel,
      approvalPolicy: workspace.approvalPolicy,
      sandboxMode: workspace.sandboxMode,
    });
    this.approvalBroker.rememberThreadOwner(runtimeThread.id, sessionId);

    const workspaces = await this.buildWorkspaceCatalog();
    const thread = this.threadProjection.toWorkbenchThread(runtimeThread, workspaces);
    this.threadViews.set(thread.thread.id, thread);
    this.threadSummaries.set(thread.thread.id, thread.thread);
    this.broadcast("thread.updated", { thread: thread.thread });
    return { thread };
  }

  private async handleThreadResume(
    sessionId: string,
    params: { threadId: string },
  ): Promise<{ thread: WorkbenchThread }> {
    const existing = this.threadSummaries.get(params.threadId) ?? null;
    const runtimeThread = await this.runtime.resumeThread(params.threadId, existing?.path ?? null);
    this.approvalBroker.rememberThreadOwner(runtimeThread.id, sessionId);

    const workspaces = await this.buildWorkspaceCatalog();
    const thread = this.threadProjection.toWorkbenchThread(
      runtimeThread,
      workspaces,
      this.threadViews.get(runtimeThread.id),
    );
    this.threadViews.set(thread.thread.id, thread);
    this.threadSummaries.set(thread.thread.id, thread.thread);
    this.broadcast("thread.updated", { thread: thread.thread });
    return { thread };
  }

  private async handleThreadUnarchive(
    sessionId: string,
    params: { threadId: string },
  ): Promise<{ thread: WorkbenchThread }> {
    const runtimeThread = await this.runtime.unarchiveThread(params.threadId);
    this.approvalBroker.rememberThreadOwner(runtimeThread.id, sessionId);
    const workspaces = await this.buildWorkspaceCatalog();
    const thread = this.threadProjection.toWorkbenchThread(
      runtimeThread,
      workspaces,
      this.threadViews.get(runtimeThread.id),
    );
    this.threadViews.set(thread.thread.id, thread);
    this.threadSummaries.set(thread.thread.id, thread.thread);
    this.broadcast("thread.updated", { thread: thread.thread });
    return { thread };
  }

  private async handleThreadFork(
    sessionId: string,
    params: { threadId: string },
  ): Promise<{ thread: WorkbenchThread }> {
    const summary = this.threadSummaries.get(params.threadId);
    if (!summary) {
      throw new Error("Thread not found");
    }

    const runtimeThread = await this.runtime.forkThread(params.threadId, summary.cwd);
    this.approvalBroker.rememberThreadOwner(runtimeThread.id, sessionId);
    const workspaces = await this.buildWorkspaceCatalog();
    const thread = this.threadProjection.toWorkbenchThread(runtimeThread, workspaces);
    this.threadViews.set(thread.thread.id, thread);
    this.threadSummaries.set(thread.thread.id, thread.thread);
    this.broadcast("thread.updated", { thread: thread.thread });
    return { thread };
  }

  private async handleThreadRollback(
    sessionId: string,
    params: { threadId: string; numTurns: number },
  ): Promise<{ thread: WorkbenchThread }> {
    const runtimeThread = await this.runtime.rollbackThread(params.threadId, params.numTurns);
    this.approvalBroker.rememberThreadOwner(runtimeThread.id, sessionId);
    const workspaces = await this.buildWorkspaceCatalog();
    const thread = this.threadProjection.toWorkbenchThread(
      runtimeThread,
      workspaces,
      this.threadViews.get(runtimeThread.id),
    );
    this.threadViews.set(thread.thread.id, thread);
    this.threadSummaries.set(thread.thread.id, thread.thread);
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
      this.threadViews.set(params.threadId, this.threadProjection.applyTurn(existing, turn));
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
      this.threadViews.set(params.threadId, this.threadProjection.applyTurn(existing, turn));
    }
    return { turn: projected };
  }

  private async handleCommandStart(
    sessionId: string,
    params: { workspaceId: string; command: string; cols: number; rows: number },
  ): Promise<{ session: CommandSessionSnapshot }> {
    const workspace = await this.resolveWorkspace(params.workspaceId);
    if (!workspace) {
      throw new Error("Workspace not found");
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
      throw new Error("Approval no longer pending");
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
      throw new Error("Workspace not found");
    }

    return {
      search: await this.runtime.searchFiles({
        query: params.query,
        roots: [workspace.absPath],
      }),
    };
  }

  private async handleRuntimeEvent(event: SessionRuntimeEvent): Promise<void> {
    switch (event.type) {
      case "status.changed":
        this.broadcast("runtime.statusChanged", { runtime: event.status });
        return;
      case "thread.updated": {
        const workspaces = await this.buildWorkspaceCatalog();
        const summary = this.threadProjection.toThreadSummary(event.thread, workspaces);
        this.threadSummaries.set(summary.id, summary);
        const existing = this.threadViews.get(summary.id);
        if (existing) {
          this.threadViews.set(
            summary.id,
            this.threadProjection.toWorkbenchThread(event.thread, workspaces, existing),
          );
        }
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
          this.threadViews.set(event.threadId, {
            ...existing,
            thread: next,
          });
        }
        this.broadcast("thread.updated", { thread: next });
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
          this.threadViews.set(event.threadId, {
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
          this.threadViews.set(event.threadId, {
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
          this.threadViews.set(
            event.threadId,
            this.threadProjection.applyTurn(existing, event.turn),
          );
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
          this.threadViews.set(
            event.threadId,
            this.threadProjection.applyTimelineItem(existing, event.item),
          );
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
          this.threadViews.set(
            event.threadId,
            this.threadProjection.appendTimelineDelta(existing, event.item),
          );
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
          this.threadViews.set(event.threadId, this.threadProjection.applyDiff(existing, event.diff));
        }
        this.broadcast("diff.updated", { threadId: event.threadId, diff: event.diff });
        return;
      }
      case "plan.updated": {
        const plan = {
          explanation: event.explanation,
          plan: event.plan,
        };
        const existing = this.threadViews.get(event.threadId);
        if (existing) {
          this.threadViews.set(event.threadId, this.threadProjection.applyPlan(existing, plan));
        }
        this.broadcast("plan.updated", { threadId: event.threadId, plan });
        return;
      }
      case "review.updated": {
        const existing = this.threadViews.get(event.threadId);
        if (existing) {
          this.threadViews.set(
            event.threadId,
            this.threadProjection.applyReview(existing, event.review),
          );
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

    const workspaces = await this.buildWorkspaceCatalog();
    return workspaces.find((workspace) => workspace.id === id) ?? null;
  }

  private async buildWorkspaceCatalog(): Promise<Array<WorkspaceRecord>> {
    const [activeThreads, archivedThreads] = await Promise.all([
      this.runtime.listThreads(false),
      this.runtime.listThreads(true),
    ]);

    return this.workspaceCatalog.buildWorkspaceCatalog(
      this.workspaceRepo.list(),
      [...activeThreads, ...archivedThreads],
      this.homePath,
      this.workspaceRepo.listIgnoredPaths(),
    );
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

  private validateWorkspaceInput(input: WorkspaceCreateInput): WorkspaceCreateInput {
    if (!input || typeof input !== "object") {
      throw new Error("Workspace payload is required");
    }

    if (!input.name?.trim()) {
      throw new Error("Workspace name is required");
    }

    if (!input.absPath?.trim()) {
      throw new Error("Workspace path is required");
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
