import { EventEmitter } from "node:events";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import readline from "node:readline";
import {
  encodeJsonRpcLine,
  parseJsonRpcLine,
  type AccountResponse,
  type BridgeStatus,
  type ClientCallEnvelope,
  type ClientRequestMethod,
  type ClientRequestParams,
  type ClientWsMessage,
  type GetAccountResponse,
  type JsonRpcError,
  type JsonRpcMessage,
  type Model,
  type ModelListResponse,
  type RequestId,
  type ServerNotificationEnvelope,
  type ServerNotificationMethod,
  type ServerRequest,
  type ServerRequestMethod,
  type ServerWsMessage,
  type Thread,
  type ThreadListResponse,
} from "@webcli/codex-protocol";

type ConnectionSender = (message: ServerWsMessage) => void;

type PendingExternalRequest = {
  kind: "external";
  connectionId: string;
  clientRequestId: RequestId;
  method: ClientRequestMethod;
};

type PendingInternalRequest<TResult> = {
  kind: "internal";
  method: ClientRequestMethod;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

type PendingRequest<TResult = unknown> =
  | PendingExternalRequest
  | PendingInternalRequest<TResult>;

type PendingServerRequest = {
  method: ServerRequestMethod;
  params: ServerRequest["params"];
};

const CLIENT_REQUEST_METHODS = new Set<ClientRequestMethod>([
  "initialize",
  "thread/start",
  "thread/resume",
  "thread/fork",
  "thread/archive",
  "thread/unsubscribe",
  "thread/name/set",
  "thread/metadata/update",
  "thread/unarchive",
  "thread/compact/start",
  "thread/rollback",
  "thread/list",
  "thread/loaded/list",
  "thread/read",
  "skills/list",
  "plugin/list",
  "skills/remote/list",
  "skills/remote/export",
  "app/list",
  "skills/config/write",
  "plugin/install",
  "plugin/uninstall",
  "turn/start",
  "turn/steer",
  "turn/interrupt",
  "review/start",
  "model/list",
  "experimentalFeature/list",
  "mcpServer/oauth/login",
  "config/mcpServer/reload",
  "mcpServerStatus/list",
  "windowsSandbox/setupStart",
  "account/login/start",
  "account/login/cancel",
  "account/logout",
  "account/rateLimits/read",
  "feedback/upload",
  "command/exec",
  "command/exec/write",
  "command/exec/terminate",
  "command/exec/resize",
  "config/read",
  "externalAgentConfig/detect",
  "externalAgentConfig/import",
  "config/value/write",
  "config/batchWrite",
  "configRequirements/read",
  "account/read",
  "getConversationSummary",
  "gitDiffToRemote",
  "getAuthStatus",
  "fuzzyFileSearch",
]);

const SERVER_REQUEST_METHODS = new Set<ServerRequestMethod>([
  "item/commandExecution/requestApproval",
  "item/fileChange/requestApproval",
  "item/tool/requestUserInput",
  "mcpServer/elicitation/request",
  "item/tool/call",
  "account/chatgptAuthTokens/refresh",
  "applyPatchApproval",
  "execCommandApproval",
]);

type BridgeOptions = {
  codexCommand: string;
};

export class CodexBridge extends EventEmitter {
  private child: ChildProcessWithoutNullStreams | null = null;
  private startPromise: Promise<void> | null = null;
  private stopRequested = false;
  private requestCounter = 0;
  private restartTimer: NodeJS.Timeout | null = null;
  private readonly codexCommand: string;
  private readonly connections = new Map<string, ConnectionSender>();
  private readonly pendingRequests = new Map<RequestId, PendingRequest>();
  private readonly pendingServerRequests = new Map<RequestId, PendingServerRequest>();
  private account: AccountResponse = {
    authenticated: false,
    requiresOpenaiAuth: true,
    accountType: "unknown",
    email: null,
    planType: null,
  };
  private status: BridgeStatus = {
    connected: false,
    childPid: null,
    authenticated: false,
    requiresOpenaiAuth: true,
    restartCount: 0,
    lastError: null,
  };

  constructor(options: BridgeOptions) {
    super();
    this.codexCommand = options.codexCommand;
  }

  async start(): Promise<void> {
    if (this.startPromise) {
      return this.startPromise;
    }

    this.stopRequested = false;
    this.startPromise = this.spawnProcess();
    return this.startPromise;
  }

  async stop(): Promise<void> {
    this.stopRequested = true;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }

    if (this.child) {
      this.child.kill();
    }
  }

  getStatus(): BridgeStatus {
    return { ...this.status };
  }

  async getAccountSummary(force = true): Promise<AccountResponse> {
    if (force) {
      await this.refreshAccountSummary();
    }

    return { ...this.account };
  }

  registerConnection(connectionId: string, sender: ConnectionSender): void {
    this.connections.set(connectionId, sender);
    sender({
      type: "server.notification",
      method: "server.status",
      params: this.getStatus(),
    });

    for (const [id, request] of this.pendingServerRequests.entries()) {
      sender({
        type: "server.notification",
        id,
        method: request.method,
        params: request.params,
      } as ServerNotificationEnvelope);
    }
  }

  unregisterConnection(connectionId: string): void {
    this.connections.delete(connectionId);
  }

  async handleClientMessage(
    connectionId: string,
    message: ClientWsMessage,
  ): Promise<void> {
    if (!this.connections.has(connectionId)) {
      return;
    }

    if (SERVER_REQUEST_METHODS.has(message.method as ServerRequestMethod)) {
      await this.resolveServerRequest(
        connectionId,
        message as ClientCallEnvelope<ServerRequestMethod>,
      );
      return;
    }

    if (!CLIENT_REQUEST_METHODS.has(message.method as ClientRequestMethod)) {
      this.sendError(connectionId, message.id, {
        code: -32601,
        message: `Unknown method: ${String(message.method)}`,
      });
      return;
    }

    await this.ensureStarted();
    const upstreamId = this.makeUpstreamId(connectionId, message.id);
    this.pendingRequests.set(upstreamId, {
      kind: "external",
      connectionId,
      clientRequestId: message.id,
      method: message.method as ClientRequestMethod,
    });

    this.writeMessage({
      jsonrpc: "2.0",
      id: upstreamId,
      method: message.method as ClientRequestMethod,
      params: message.params,
    });
  }

  async listModels(): Promise<Array<Model>> {
    const data = await this.collectPages<ModelListResponse, "model/list">(
      "model/list",
      { includeHidden: true },
    );
    return data;
  }

  async listThreads(archived: boolean | "all" = false): Promise<Array<Thread>> {
    if (archived === "all") {
      const [active, archivedThreads] = await Promise.all([
        this.listThreads(false),
        this.listThreads(true),
      ]);
      return [...active, ...archivedThreads];
    }

    const data = await this.collectPages<ThreadListResponse, "thread/list">("thread/list", {
      archived,
      sortKey: "updated_at",
    });
    return data;
  }

  async call<TResult, TMethod extends ClientRequestMethod>(
    method: TMethod,
    params: ClientRequestParams<TMethod>,
  ): Promise<TResult> {
    await this.ensureStarted();

    return new Promise<TResult>((resolve, reject) => {
      const id = this.makeInternalId(method);
      this.pendingRequests.set(id, {
        kind: "internal",
        method,
        resolve: (value) => resolve(value as TResult),
        reject,
      });

      this.writeMessage({
        jsonrpc: "2.0",
        id,
        method,
        params,
      });
    });
  }

  private async spawnProcess(): Promise<void> {
    const child = spawn(this.codexCommand, ["app-server", "--listen", "stdio://"], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.child = child;
    this.status = {
      ...this.status,
      connected: false,
      childPid: child.pid ?? null,
      lastError: null,
    };
    this.broadcastStatus();

    const stdout = readline.createInterface({ input: child.stdout });
    stdout.on("line", (line) => {
      void this.handleStdoutLine(line);
    });

    const stderr = readline.createInterface({ input: child.stderr });
    stderr.on("line", (line) => {
      const trimmed = line.trim();
      if (!trimmed) {
        return;
      }
      this.setLastError(trimmed);
    });

    child.on("exit", (code, signal) => {
      this.child = null;
      this.status = {
        ...this.status,
        connected: false,
        childPid: null,
        lastError:
          this.status.lastError ??
          `codex app-server exited (${signal ?? "code"}:${code ?? "unknown"})`,
      };
      this.rejectPendingRequests(
        new Error(this.status.lastError ?? "codex app-server exited"),
      );
      this.broadcastStatus();
      this.startPromise = null;

      if (!this.stopRequested) {
        this.status = {
          ...this.status,
          restartCount: this.status.restartCount + 1,
        };
        this.broadcastStatus();
        this.restartTimer = setTimeout(() => {
          void this.start();
        }, 1000);
      }
    });

    await this.initializeChild();
  }

  private async initializeChild(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const id = this.makeInternalId("initialize");
      this.pendingRequests.set(id, {
        kind: "internal",
        method: "initialize",
        resolve: () => resolve(),
        reject,
      });

      this.writeMessage({
        jsonrpc: "2.0",
        id,
        method: "initialize",
        params: {
          clientInfo: {
            name: "webcli-server",
            version: "0.1.0",
          },
          capabilities: {
            experimentalApi: true,
          },
        },
      });
    });

    this.status = {
      ...this.status,
      connected: true,
      lastError: null,
    };
    await this.refreshAccountSummary();
    this.broadcastStatus();
  }

  private async ensureStarted(): Promise<void> {
    if (this.child && this.status.connected) {
      return;
    }

    if (!this.startPromise) {
      await this.start();
      return;
    }

    await this.startPromise;
  }

  private writeMessage(message: JsonRpcMessage): void {
    if (!this.child?.stdin.writable) {
      throw new Error("codex app-server is not connected");
    }

    this.child.stdin.write(encodeJsonRpcLine(message));
  }

  private async handleStdoutLine(line: string): Promise<void> {
    let message: JsonRpcMessage;
    try {
      message = parseJsonRpcLine(line);
    } catch (error) {
      this.setLastError(
        error instanceof Error ? error.message : "Failed to parse JSON-RPC line",
      );
      return;
    }

    if ("id" in message && !("method" in message)) {
      this.handleResponse(message.id, message.result, message.error);
      return;
    }

    if ("method" in message && !("id" in message)) {
      this.handleNotification(
        message.method as ServerNotificationMethod,
        message.params,
      );
      return;
    }

    if ("method" in message && "id" in message) {
      const requestMessage = message as {
        id: RequestId;
        method: string;
        params: unknown;
      };
      this.handleServerRequest(
        requestMessage.id,
        requestMessage.method as ServerRequestMethod,
        requestMessage.params as ServerRequest["params"],
      );
    }
  }

  private handleResponse(
    upstreamId: RequestId,
    result: unknown,
    error: JsonRpcError | undefined,
  ): void {
    const pending = this.pendingRequests.get(upstreamId);
    this.pendingRequests.delete(upstreamId);

    if (!pending) {
      return;
    }

    if (pending.method === "account/read" && !error) {
      this.updateAccountSummaryFromResult(result);
    }

    if (pending.kind === "internal") {
      if (error) {
        pending.reject(new Error(error.message));
      } else {
        pending.resolve(result);
      }
      return;
    }

    const sender = this.connections.get(pending.connectionId);
    if (!sender) {
      return;
    }

    sender({
      type: "server.response",
      id: pending.clientRequestId,
      ...(error ? { error } : { result }),
    });
  }

  private handleNotification(method: ServerNotificationMethod, params: unknown): void {
    if (
      method === "account/updated" ||
      method === "account/login/completed" ||
      method === "account/rateLimits/updated"
    ) {
      void this.refreshAccountSummary();
    }

    this.broadcast({
      type: "server.notification",
      method,
      params,
    } as ServerNotificationEnvelope);
  }

  private handleServerRequest(
    id: RequestId,
    method: ServerRequestMethod,
    params: ServerRequest["params"],
  ): void {
    this.pendingServerRequests.set(id, { method, params });
    this.broadcast({
      type: "server.notification",
      id,
      method,
      params,
    } as ServerNotificationEnvelope);
  }

  private async resolveServerRequest(
    connectionId: string,
    message: ClientCallEnvelope<ServerRequestMethod>,
  ): Promise<void> {
    const pending = this.pendingServerRequests.get(message.id);
    if (!pending) {
      this.sendError(connectionId, message.id, {
        code: -32000,
        message: "Server request is no longer pending",
      });
      return;
    }

    this.pendingServerRequests.delete(message.id);
    this.writeMessage({
      jsonrpc: "2.0",
      id: message.id,
      result: message.params,
    });

    const sender = this.connections.get(connectionId);
    sender?.({
      type: "server.response",
      id: message.id,
      result: { ok: true },
    });
  }

  private sendError(
    connectionId: string,
    requestId: RequestId,
    error: JsonRpcError,
  ): void {
    const sender = this.connections.get(connectionId);
    if (!sender) {
      return;
    }

    sender({
      type: "server.response",
      id: requestId,
      error,
    });
  }

  private broadcast(message: ServerWsMessage): void {
    for (const sender of this.connections.values()) {
      sender(message);
    }
  }

  private broadcastStatus(): void {
    this.broadcast({
      type: "server.notification",
      method: "server.status",
      params: this.getStatus(),
    });
  }

  private makeInternalId(method: string): string {
    this.requestCounter += 1;
    return `internal:${method}:${this.requestCounter}`;
  }

  private makeUpstreamId(connectionId: string, clientRequestId: RequestId): string {
    return `client:${connectionId}:${String(clientRequestId)}`;
  }

  private rejectPendingRequests(error: Error): void {
    for (const [id, pending] of this.pendingRequests.entries()) {
      this.pendingRequests.delete(id);
      if (pending.kind === "internal") {
        pending.reject(error);
        continue;
      }

      const sender = this.connections.get(pending.connectionId);
      sender?.({
        type: "server.response",
        id: pending.clientRequestId,
        error: {
          code: -32000,
          message: error.message,
        },
      });
    }
  }

  private async refreshAccountSummary(): Promise<void> {
    try {
      const response = await this.call<GetAccountResponse, "account/read">(
        "account/read",
        { refreshToken: false },
      );
      this.updateAccountSummaryFromResult(response);
    } catch (error) {
      this.account = {
        authenticated: false,
        requiresOpenaiAuth: true,
        accountType: "unknown",
        email: null,
        planType: null,
      };
      this.status = {
        ...this.status,
        authenticated: false,
        requiresOpenaiAuth: true,
        lastError:
          error instanceof Error ? error.message : "Failed to refresh account",
      };
      this.broadcastStatus();
    }
  }

  private updateAccountSummaryFromResult(result: unknown): void {
    const response = result as GetAccountResponse;
    const account = response.account;
    this.account = {
      authenticated: account !== null,
      requiresOpenaiAuth: response.requiresOpenaiAuth,
      accountType: account?.type ?? "unknown",
      email: account?.type === "chatgpt" ? account.email : null,
      planType: account?.type === "chatgpt" ? account.planType : null,
    };
    this.status = {
      ...this.status,
      authenticated: this.account.authenticated,
      requiresOpenaiAuth: response.requiresOpenaiAuth,
      lastError: this.status.connected ? null : this.status.lastError,
    };
    this.broadcastStatus();
  }

  private async collectPages<
    TResult extends { data: Array<unknown>; nextCursor: string | null },
    TMethod extends "model/list" | "thread/list",
  >(
    method: TMethod,
    params: ClientRequestParams<TMethod>,
  ): Promise<Array<TResult["data"][number]>> {
    let cursor: string | null = null;
    const data: Array<TResult["data"][number]> = [];

    do {
      const requestParams = {
        ...(params as Record<string, unknown>),
        cursor,
      } as ClientRequestParams<TMethod>;
      const response: TResult = await this.call<TResult, TMethod>(
        method,
        requestParams,
      );
      data.push(...response.data);
      cursor = response.nextCursor;
    } while (cursor);

    return data;
  }

  private setLastError(message: string): void {
    this.status = {
      ...this.status,
      lastError: message,
    };
    this.broadcastStatus();
  }
}
