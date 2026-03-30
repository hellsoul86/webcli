/**
 * SessionManager — manages all SessionProcess instances.
 *
 * Replaces the connection-management and routing parts of WorkbenchService.
 * The global-level concerns (workspace CRUD, account, models) remain in
 * WorkbenchService, while session-scoped concerns (thread lifecycle,
 * approvals, commands) are handled by SessionProcess.
 *
 * Key responsibilities:
 *  - Session CRUD (create / list / get / archive / delete)
 *  - Route runtime events to the correct SessionProcess by threadId
 *  - Manage session↔connection mapping
 */

import { randomUUID } from "node:crypto";
import type {
  AppEventMethod,
  AppEventParams,
  PendingServerRequest,
  SessionSummary,
} from "@webcli/contracts";
import type { SessionRuntime, SessionRuntimeEvent } from "./runtime.js";
import { SessionProcess, type SessionSender } from "./session-process.js";
import type { ThreadProjectionService } from "./thread-projection-service.js";
import type { WorkspaceRepo } from "./workspace-repo.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SessionManagerOptions = {
  runtime: SessionRuntime;
  workspaceRepo: WorkspaceRepo;
  threadProjection: ThreadProjectionService;
};

// ---------------------------------------------------------------------------
// SessionManager
// ---------------------------------------------------------------------------

export class SessionManager {
  private readonly runtime: SessionRuntime;
  private readonly workspaceRepo: WorkspaceRepo;
  private readonly threadProjection: ThreadProjectionService;

  /** All active sessions. */
  private readonly sessions = new Map<string, SessionProcess>();

  /** Reverse lookup: threadId → sessionId. */
  private readonly threadToSession = new Map<string, string>();

  /** Reverse lookup: connectionId → sessionId. */
  private readonly connectionToSession = new Map<string, string>();

  /** Reverse lookup: processId → sessionId (for command routing). */
  private readonly processToSession = new Map<string, string>();

  constructor(options: SessionManagerOptions) {
    this.runtime = options.runtime;
    this.workspaceRepo = options.workspaceRepo;
    this.threadProjection = options.threadProjection;
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Subscribe to runtime events and route them to the correct session.
   * Call this once at startup after the runtime is started.
   */
  subscribeToRuntime(): void {
    this.runtime.subscribe((event) => {
      void this.handleRuntimeEvent(event).catch((err) => {
        console.error("[SessionManager] Runtime event handler error:", err);
      });
    });
  }

  // -------------------------------------------------------------------------
  // Session CRUD
  // -------------------------------------------------------------------------

  createSession(options?: {
    workspaceId?: string;
    cwd?: string;
  }): SessionProcess {
    const id = randomUUID();
    const session = new SessionProcess({
      id,
      workspaceId: options?.workspaceId ?? null,
      cwd: options?.cwd ?? "",
    });
    session.transitionTo("idle", { reason: "created" });
    this.sessions.set(id, session);
    return session;
  }

  getSession(sessionId: string): SessionProcess | null {
    return this.sessions.get(sessionId) ?? null;
  }

  getSessionByThreadId(threadId: string): SessionProcess | null {
    const sessionId = this.threadToSession.get(threadId);
    if (!sessionId) return null;
    return this.sessions.get(sessionId) ?? null;
  }

  getSessionByConnectionId(connectionId: string): SessionProcess | null {
    const sessionId = this.connectionToSession.get(connectionId);
    if (!sessionId) return null;
    return this.sessions.get(sessionId) ?? null;
  }

  getSessionByProcessId(processId: string): SessionProcess | null {
    const sessionId = this.processToSession.get(processId);
    if (!sessionId) return null;
    return this.sessions.get(sessionId) ?? null;
  }

  listSessions(_options?: { archived?: boolean }): SessionSummary[] {
    const result: SessionSummary[] = [];
    for (const session of this.sessions.values()) {
      result.push(this.toSessionSummary(session));
    }
    return result;
  }

  deleteSession(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    // Clean up reverse lookups
    if (session.threadId) {
      this.threadToSession.delete(session.threadId);
    }
    for (const [connId, sessId] of this.connectionToSession) {
      if (sessId === sessionId) {
        this.connectionToSession.delete(connId);
      }
    }
    for (const [procId, sessId] of this.processToSession) {
      if (sessId === sessionId) {
        this.processToSession.delete(procId);
      }
    }

    session.dispose();
    this.sessions.delete(sessionId);
    return true;
  }

  // -------------------------------------------------------------------------
  // Connection management
  // -------------------------------------------------------------------------

  registerConnection(
    sessionId: string,
    connectionId: string,
    sender: SessionSender,
  ): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    this.connectionToSession.set(connectionId, sessionId);
    session.addConnection(connectionId, sender);
    return true;
  }

  unregisterConnection(connectionId: string): void {
    const sessionId = this.connectionToSession.get(connectionId);
    if (!sessionId) return;

    this.connectionToSession.delete(connectionId);
    const session = this.sessions.get(sessionId);
    session?.removeConnection(connectionId);
  }

  // -------------------------------------------------------------------------
  // Thread binding
  // -------------------------------------------------------------------------

  bindThread(sessionId: string, threadId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.bindThread(threadId);
    this.threadToSession.set(threadId, sessionId);
  }

  // -------------------------------------------------------------------------
  // Command process binding
  // -------------------------------------------------------------------------

  bindProcess(sessionId: string, processId: string): void {
    this.processToSession.set(processId, sessionId);
  }

  // -------------------------------------------------------------------------
  // Runtime event routing
  // -------------------------------------------------------------------------

  private async handleRuntimeEvent(event: SessionRuntimeEvent): Promise<void> {
    switch (event.type) {
      // Thread-scoped events → route to owning session
      case "thread.updated": {
        const session = this.getSessionByThreadId(event.thread.id);
        if (!session) return;
        const workspaces = this.workspaceRepo.list();
        const summary = this.threadProjection.toThreadSummary(
          event.thread,
          workspaces,
        );
        const existing = session.threadView;
        if (existing) {
          session.setThreadView(
            this.threadProjection.toWorkbenchThread(
              event.thread,
              workspaces,
              existing,
            ),
          );
        }
        session.broadcastNotification("thread.updated", { thread: summary });
        return;
      }

      case "thread.closed": {
        const session = this.getSessionByThreadId(event.threadId);
        if (!session) return;
        session.broadcastNotification("thread.closed", {
          threadId: event.threadId,
        });
        return;
      }

      case "thread.status.changed":
      case "thread.name.changed":
      case "thread.archive.changed": {
        // These are sub-events of thread.updated; the runtime also fires
        // thread.updated, so we can safely ignore these for now.
        return;
      }

      case "thread.tokenUsage.updated": {
        const session = this.getSessionByThreadId(event.threadId);
        if (!session) return;
        session.broadcastNotification("thread.tokenUsageUpdated", {
          threadId: event.threadId,
          turnId: event.turnId,
          tokenUsage: event.tokenUsage,
        });
        return;
      }

      case "turn.updated": {
        const session = this.getSessionByThreadId(event.threadId);
        if (!session) return;
        if (session.threadView) {
          session.setThreadView(
            this.threadProjection.applyTurn(session.threadView, event.turn),
          );
        }
        const workbenchTurn = this.threadProjection.toWorkbenchTurn(event.turn);
        session.broadcastNotification("turn.updated", {
          threadId: event.threadId,
          turn: workbenchTurn,
        });
        return;
      }

      case "timeline.item": {
        const session = this.getSessionByThreadId(event.threadId);
        if (!session) return;
        if (session.threadView) {
          session.setThreadView(
            this.threadProjection.applyTimelineItem(
              session.threadView,
              event.item,
            ),
          );
        }
        session.broadcastNotification("timeline.item", {
          threadId: event.threadId,
          item: event.item,
        });
        return;
      }

      case "timeline.delta": {
        const session = this.getSessionByThreadId(event.threadId);
        if (!session) return;
        if (session.threadView) {
          session.setThreadView(
            this.threadProjection.appendTimelineDelta(
              session.threadView,
              event.item,
            ),
          );
        }
        session.broadcastNotification("timeline.delta", {
          threadId: event.threadId,
          item: event.item,
        });
        return;
      }

      case "diff.updated": {
        const session = this.getSessionByThreadId(event.threadId);
        if (!session) return;
        if (session.threadView) {
          session.setThreadView(
            this.threadProjection.applyDiff(session.threadView, event.diff),
          );
        }
        session.broadcastNotification("diff.updated", {
          threadId: event.threadId,
          diff: event.diff,
        });
        return;
      }

      case "plan.updated": {
        const session = this.getSessionByThreadId(event.threadId);
        if (!session) return;
        const plan = {
          turnId: event.turnId,
          explanation: event.explanation,
          plan: event.plan,
        };
        if (session.threadView) {
          session.setThreadView(
            this.threadProjection.applyPlan(session.threadView, plan),
          );
        }
        session.broadcastNotification("plan.updated", {
          threadId: event.threadId,
          plan,
        });
        return;
      }

      case "review.updated": {
        const session = this.getSessionByThreadId(event.threadId);
        if (!session) return;
        if (session.threadView) {
          session.setThreadView(
            this.threadProjection.applyReview(
              session.threadView,
              event.review,
            ),
          );
        }
        session.broadcastNotification("review.updated", {
          threadId: event.threadId,
          review: event.review,
        });
        return;
      }

      // Realtime events → route to thread's session
      case "thread.realtime.started": {
        const session = this.getSessionByThreadId(event.threadId);
        if (!session) return;
        session.broadcastNotification("thread.realtimeStarted", {
          threadId: event.threadId,
          sessionId: event.sessionId,
        });
        return;
      }

      case "thread.realtime.itemAdded": {
        const session = this.getSessionByThreadId(event.threadId);
        if (!session) return;
        session.broadcastNotification("thread.realtimeItemAdded", {
          threadId: event.threadId,
          item: event.item,
        });
        return;
      }

      case "thread.realtime.outputAudio.delta": {
        const session = this.getSessionByThreadId(event.threadId);
        if (!session) return;
        session.broadcastNotification("thread.realtimeOutputAudioDelta", {
          threadId: event.threadId,
          audio: event.audio,
        });
        return;
      }

      case "thread.realtime.error": {
        const session = this.getSessionByThreadId(event.threadId);
        if (!session) return;
        session.broadcastNotification("thread.realtimeError", {
          threadId: event.threadId,
          message: event.message,
        });
        return;
      }

      case "thread.realtime.closed": {
        const session = this.getSessionByThreadId(event.threadId);
        if (!session) return;
        session.broadcastNotification("thread.realtimeClosed", {
          threadId: event.threadId,
          reason: event.reason,
        });
        return;
      }

      // Approval events → route to thread's session
      case "approval.requested": {
        const request: PendingServerRequest = event.approval;
        const threadId = request.threadId;
        const session = threadId
          ? this.getSessionByThreadId(threadId)
          : null;
        if (!session) {
          console.warn(
            `[SessionManager] No session for approval on thread ${threadId}. Request ${String(request.id)} dropped.`,
          );
          return;
        }
        session.queueRequest(request);
        session.broadcastNotification("serverRequest.requested", { request });
        session.broadcastNotification("approval.requested", { approval: request });
        return;
      }

      case "approval.resolved": {
        const requestId = event.requestId;
        for (const session of this.sessions.values()) {
          if (session.getRequest(requestId)) {
            session.resolveRequest(requestId);
            session.broadcastNotification("serverRequest.resolved", { requestId });
            session.broadcastNotification("approval.resolved", { requestId });
            return;
          }
        }
        return;
      }

      // Command events → route to process owner
      case "command.output": {
        const session = this.getSessionByProcessId(event.processId);
        if (!session) return;
        session.appendCommandOutput(event.processId, event.stream, event.text);
        session.broadcastNotification("command.output", {
          processId: event.processId,
          stream: event.stream,
          text: event.text,
          session: session.getCommand(event.processId),
        });
        return;
      }

      case "command.completed": {
        const session = this.getSessionByProcessId(event.processId);
        if (!session) return;
        const cmdSnapshot = session.completeCommand(event.processId, {
          cwd: null,
          exitCode: event.session.exitCode,
        });
        session.broadcastNotification("command.output", {
          processId: event.processId,
          stream: "stdout",
          text: "",
          session: cmdSnapshot,
        });
        return;
      }

      // Global events → broadcast to ALL sessions
      case "status.changed": {
        this.broadcastToAll("runtime.statusChanged", {
          runtime: event.status,
        });
        return;
      }

      case "account.updated": {
        this.broadcastToAll("account.updated", {
          account: event.account,
        });
        return;
      }

      case "account.login.completed": {
        // Requires integration snapshot — handled by WorkbenchService
        return;
      }

      case "account.rateLimits.updated": {
        this.broadcastToAll("account.rateLimitsUpdated", {
          rateLimits: event.rateLimits,
        });
        return;
      }

      case "model.rerouted": {
        const session = this.getSessionByThreadId(event.reroute.threadId);
        if (!session) return;
        session.broadcastNotification("model.rerouted", {
          reroute: event.reroute,
        });
        return;
      }

      case "config.warning": {
        this.broadcastToAll("config.warning", { warning: event.warning });
        return;
      }

      case "deprecation.notice": {
        this.broadcastToAll("deprecation.notice", { notice: event.notice });
        return;
      }

      case "skills.changed": {
        this.broadcastToAll("skills.changed", {});
        return;
      }

      case "app.list.updated": {
        this.broadcastToAll("app.listUpdated", { apps: event.apps });
        return;
      }

      default:
        // Unknown event types are ignored
        return;
    }
  }

  // -------------------------------------------------------------------------
  // Broadcast to all sessions
  // -------------------------------------------------------------------------

  private broadcastToAll<TMethod extends AppEventMethod>(
    method: TMethod,
    params: AppEventParams<TMethod>,
  ): void {
    for (const session of this.sessions.values()) {
      session.broadcastNotification(method, params);
    }
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private toSessionSummary(session: SessionProcess): SessionSummary {
    const view = session.threadView;
    return {
      id: session.id,
      title: view?.thread.name ?? null,
      preview: view?.thread.preview ?? "",
      threadId: session.threadId,
      workspaceId: session.workspaceId,
      workspaceName: view?.thread.workspaceName ?? null,
      cwd: session.cwd,
      archived: false,
      status: session.getStatus(),
      createdAt: view?.thread.createdAt ?? Date.now(),
      updatedAt: view?.thread.updatedAt ?? Date.now(),
    };
  }
}
