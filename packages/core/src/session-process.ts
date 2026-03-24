/**
 * SessionProcess — per-session lifecycle manager.
 *
 * Modelled after Kimi CLI's `SessionProcess` (Python), but adapted for
 * WebCLI's architecture where a single shared CodexRuntime hosts all threads.
 *
 * Responsibilities:
 *  - State machine: stopped → idle → busy → restarting → error
 *  - WebSocket fanout with replay buffer for late-joining clients
 *  - Per-session pending approvals (no longer global)
 *  - Message history for session replay
 */

import type {
  AppServerMessage,
  AppServerNotificationEnvelope,
  AppEventMethod,
  AppEventParams,
  PendingServerRequest,
  RequestId,
  SessionState,
  SessionStatus,
  SessionNotice,
  WorkbenchThread,
  TimelineEntry,
  WorkbenchTurn,
  LivePlan,
  ReviewOutput,
  CommandSessionSnapshot,
  GitWorkingTreeSnapshot,
} from "@webcli/contracts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SessionSender = (message: AppServerMessage) => void;

export type SessionConnection = {
  connectionId: string;
  sender: SessionSender;
  replaying: boolean;
  replayBuffer: AppServerMessage[];
};

export type SessionProcessOptions = {
  id: string;
  threadId?: string | null;
  workspaceId?: string | null;
  cwd?: string;
};

const MAX_HISTORY_ITEMS = 2000;

// ---------------------------------------------------------------------------
// SessionProcess
// ---------------------------------------------------------------------------

export class SessionProcess {
  readonly id: string;

  /** The Codex thread bound to this session (null before first turn). */
  private _threadId: string | null;
  private _workspaceId: string | null;
  private _cwd: string;

  // State machine
  private _state: SessionState = "stopped";
  private _seq = 0;
  private _reason: string | null = null;
  private _detail: string | null = null;

  // WebSocket fanout
  private readonly _connections = new Map<string, SessionConnection>();

  // Pending server requests / approvals (session-scoped)
  private readonly _pendingRequests = new Map<RequestId, PendingServerRequest>();

  // Command session tracking (session-scoped)
  private readonly _commandSessions = new Map<string, CommandSessionSnapshot>();

  // Message history for replay
  private readonly _history: AppServerMessage[] = [];

  // Thread view cache
  private _threadView: WorkbenchThread | null = null;
  private _gitSnapshot: GitWorkingTreeSnapshot | null = null;

  constructor(options: SessionProcessOptions) {
    this.id = options.id;
    this._threadId = options.threadId ?? null;
    this._workspaceId = options.workspaceId ?? null;
    this._cwd = options.cwd ?? "";
  }

  // -------------------------------------------------------------------------
  // Getters
  // -------------------------------------------------------------------------

  get threadId(): string | null {
    return this._threadId;
  }

  get workspaceId(): string | null {
    return this._workspaceId;
  }

  get cwd(): string {
    return this._cwd;
  }

  get state(): SessionState {
    return this._state;
  }

  get isBusy(): boolean {
    return this._state === "busy";
  }

  get isAlive(): boolean {
    return this._state !== "stopped" && this._state !== "error";
  }

  get connectionCount(): number {
    return this._connections.size;
  }

  get threadView(): WorkbenchThread | null {
    return this._threadView;
  }

  get gitSnapshot(): GitWorkingTreeSnapshot | null {
    return this._gitSnapshot;
  }

  // -------------------------------------------------------------------------
  // State machine
  // -------------------------------------------------------------------------

  getStatus(): SessionStatus {
    return {
      sessionId: this.id,
      state: this._state,
      seq: this._seq,
      reason: this._reason,
      detail: this._detail,
      updatedAt: Date.now(),
    };
  }

  /**
   * Transition to a new state. If the state actually changed, broadcasts
   * a status notification to all connected clients.
   */
  transitionTo(
    state: SessionState,
    options?: { reason?: string; detail?: string },
  ): void {
    const reason = options?.reason ?? null;
    const detail = options?.detail ?? null;

    if (
      this._state === state &&
      this._reason === reason &&
      this._detail === detail
    ) {
      return; // no-op
    }

    this._state = state;
    this._reason = reason;
    this._detail = detail;
    this._seq += 1;

    this.broadcastNotification("runtime.statusChanged", {
      runtime: {
        connected: this.isAlive,
        childPid: null,
        authenticated: true,
        requiresOpenaiAuth: false,
        restartCount: 0,
        lastError: state === "error" ? (reason ?? "unknown") : null,
      },
    });
  }

  // -------------------------------------------------------------------------
  // Thread binding
  // -------------------------------------------------------------------------

  bindThread(threadId: string): void {
    this._threadId = threadId;
  }

  setWorkspace(workspaceId: string | null, cwd: string): void {
    this._workspaceId = workspaceId;
    this._cwd = cwd;
  }

  setThreadView(view: WorkbenchThread): void {
    this._threadView = view;
  }

  setGitSnapshot(snapshot: GitWorkingTreeSnapshot | null): void {
    this._gitSnapshot = snapshot;
  }

  // -------------------------------------------------------------------------
  // WebSocket connection management
  // -------------------------------------------------------------------------

  /**
   * Add a WebSocket connection and begin replaying history.
   * New messages arriving during replay are buffered and flushed after replay
   * completes (matching Kimi CLI's pattern).
   */
  addConnection(connectionId: string, sender: SessionSender): void {
    const conn: SessionConnection = {
      connectionId,
      sender,
      replaying: true,
      replayBuffer: [],
    };
    this._connections.set(connectionId, conn);

    // Replay history
    for (const message of this._history) {
      try {
        sender(message);
      } catch {
        // Connection might have closed during replay
        this._connections.delete(connectionId);
        return;
      }
    }

    // Flush any messages that arrived during replay
    const buffered = conn.replayBuffer;
    conn.replaying = false;
    conn.replayBuffer = [];
    for (const message of buffered) {
      try {
        sender(message);
      } catch {
        this._connections.delete(connectionId);
        return;
      }
    }
  }

  removeConnection(connectionId: string): void {
    this._connections.delete(connectionId);
  }

  hasConnection(connectionId: string): boolean {
    return this._connections.has(connectionId);
  }

  // -------------------------------------------------------------------------
  // Broadcasting
  // -------------------------------------------------------------------------

  /**
   * Broadcast a notification to all connected clients.
   * During replay, messages are buffered per-connection.
   */
  broadcastNotification<TMethod extends AppEventMethod>(
    method: TMethod,
    params: AppEventParams<TMethod>,
  ): void {
    const message: AppServerNotificationEnvelope = {
      type: "server.notification",
      method,
      params,
    } as AppServerNotificationEnvelope;

    this.broadcastRaw(message);
  }

  broadcastRaw(message: AppServerMessage): void {
    // Append to history (bounded)
    this._history.push(message);
    if (this._history.length > MAX_HISTORY_ITEMS) {
      this._history.splice(0, this._history.length - MAX_HISTORY_ITEMS);
    }

    // Fanout
    for (const [connId, conn] of this._connections) {
      if (conn.replaying) {
        conn.replayBuffer.push(message);
        continue;
      }
      try {
        conn.sender(message);
      } catch {
        // Dead connection — remove silently
        this._connections.delete(connId);
      }
    }
  }

  /**
   * Send a message to a specific connection (for RPC responses).
   */
  sendTo(connectionId: string, message: AppServerMessage): void {
    const conn = this._connections.get(connectionId);
    if (!conn) return;
    try {
      conn.sender(message);
    } catch {
      this._connections.delete(connectionId);
    }
  }

  // -------------------------------------------------------------------------
  // Pending approvals / server requests (session-scoped)
  // -------------------------------------------------------------------------

  queueRequest(request: PendingServerRequest): void {
    this._pendingRequests.set(request.id, request);
  }

  getRequest(requestId: RequestId): PendingServerRequest | undefined {
    return this._pendingRequests.get(requestId);
  }

  resolveRequest(requestId: RequestId): PendingServerRequest | undefined {
    const request = this._pendingRequests.get(requestId);
    this._pendingRequests.delete(requestId);
    return request;
  }

  listRequests(): PendingServerRequest[] {
    return Array.from(this._pendingRequests.values());
  }

  clearRequests(): void {
    this._pendingRequests.clear();
  }

  // -------------------------------------------------------------------------
  // Command sessions (session-scoped)
  // -------------------------------------------------------------------------

  startCommand(snapshot: CommandSessionSnapshot): void {
    this._commandSessions.set(snapshot.processId, snapshot);
  }

  getCommand(processId: string): CommandSessionSnapshot | null {
    return this._commandSessions.get(processId) ?? null;
  }

  completeCommand(
    processId: string,
    payload: { cwd: string | null; exitCode: number | null } | null,
  ): CommandSessionSnapshot | null {
    const session = this._commandSessions.get(processId);
    if (!session) return null;

    const updated: CommandSessionSnapshot = {
      ...session,
      status: payload?.exitCode === 0 ? "completed" : "failed",
      exitCode: payload?.exitCode ?? null,
      cwd: payload?.cwd ?? session.cwd,
    };
    this._commandSessions.set(processId, updated);
    return updated;
  }

  appendCommandOutput(
    processId: string,
    stream: "stdout" | "stderr",
    text: string,
  ): void {
    const session = this._commandSessions.get(processId);
    if (!session) return;

    this._commandSessions.set(processId, {
      ...session,
      [stream]: session[stream] + text,
    });
  }

  // -------------------------------------------------------------------------
  // Cleanup
  // -------------------------------------------------------------------------

  /**
   * Dispose of all state. Called when the session is permanently removed.
   */
  dispose(): void {
    this._state = "stopped";
    this._connections.clear();
    this._pendingRequests.clear();
    this._commandSessions.clear();
    this._history.length = 0;
    this._threadView = null;
    this._gitSnapshot = null;
  }
}
