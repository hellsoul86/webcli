import { randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import readline from "node:readline";
import { AppError } from "@webcli/contracts";
import type {
  AccountUsageWindow,
  AccountLoginCancelStatus,
  AccountLoginStartInput,
  AccountLoginStartResponse,
  AccountStateSnapshot,
  AccountSummary,
  ApprovalPolicy,
  ConfigSnapshot,
  ForcedLoginMethod,
  FuzzySearchSnapshot,
  GitBranchReference,
  GitFileReviewDetail,
  GitWorkingTreeFile,
  GitWorkingTreeSnapshot,
  IntegrationSnapshot,
  ModelOption,
  PendingApproval,
  RuntimeStatus,
  SandboxMode,
  TimelineEntry,
} from "@webcli/contracts";
import type {
  RuntimeThreadConfig,
  RuntimeThreadRecord,
  RuntimeTurnRecord,
  SessionRuntime,
  SessionRuntimeEvent,
  SessionRuntimeListener,
} from "@webcli/core";
import type { FuzzyFileSearchResponse } from "./generated/FuzzyFileSearchResponse";
import type { GetAuthStatusResponse } from "./generated/GetAuthStatusResponse";
import type { ReviewOutputEvent } from "./generated/ReviewOutputEvent";
import type { ApplyPatchApprovalResponse } from "./generated/ApplyPatchApprovalResponse";
import type { ExecCommandApprovalResponse } from "./generated/ExecCommandApprovalResponse";
import type { RequestId } from "./generated/RequestId";
import type { AppInfo } from "./generated/v2/AppInfo";
import type { AskForApproval } from "./generated/v2/AskForApproval";
import type { CommandExecResponse } from "./generated/v2/CommandExecResponse";
import type { ConfigReadResponse } from "./generated/v2/ConfigReadResponse";
import type { GetAccountResponse } from "./generated/v2/GetAccountResponse";
import type { GetAccountRateLimitsResponse } from "./generated/v2/GetAccountRateLimitsResponse";
import type { LoginAccountResponse } from "./generated/v2/LoginAccountResponse";
import type { CancelLoginAccountResponse } from "./generated/v2/CancelLoginAccountResponse";
import type { ListMcpServerStatusResponse } from "./generated/v2/ListMcpServerStatusResponse";
import type { McpServerOauthLoginResponse } from "./generated/v2/McpServerOauthLoginResponse";
import type { ModelListResponse } from "./generated/v2/ModelListResponse";
import type { PermissionsRequestApprovalResponse } from "./generated/v2/PermissionsRequestApprovalResponse";
import type { PluginListResponse } from "./generated/v2/PluginListResponse";
import type { ReviewStartResponse } from "./generated/v2/ReviewStartResponse";
import type { SandboxMode as RuntimeSandboxMode } from "./generated/v2/SandboxMode";
import type { SkillsListResponse } from "./generated/v2/SkillsListResponse";
import type { Thread } from "./generated/v2/Thread";
import type { ThreadLoadedListResponse } from "./generated/v2/ThreadLoadedListResponse";
import type { ThreadListResponse } from "./generated/v2/ThreadListResponse";
import type { ThreadItem } from "./generated/v2/ThreadItem";
import type { ThreadForkResponse } from "./generated/v2/ThreadForkResponse";
import type { ThreadResumeResponse } from "./generated/v2/ThreadResumeResponse";
import type { ThreadRollbackResponse } from "./generated/v2/ThreadRollbackResponse";
import type { ThreadStartResponse } from "./generated/v2/ThreadStartResponse";
import type { ThreadUnarchiveResponse } from "./generated/v2/ThreadUnarchiveResponse";
import type { Turn } from "./generated/v2/Turn";
import type { TurnStartResponse } from "./generated/v2/TurnStartResponse";
import {
  encodeJsonRpcLine,
  parseJsonRpcLine,
  type JsonRpcError,
  type JsonRpcMessage,
} from "./jsonrpc.js";
import {
  readGitBranches,
  readGitFileReviewDetail,
  readGitWorkingTreeSnapshot,
  switchGitBranch,
} from "./git-working-tree.js";
import {
  type ClientRequestMethod,
  type ClientRequestParams,
  type ServerNotificationMethod,
  type ServerRequestMethod,
  type ServerRequestParams,
  type ServerRequestResult,
  type ServerRequestResultMap,
} from "./ws.js";

type AppListResponse = {
  data: Array<AppInfo>;
  nextCursor: string | null;
};

type PendingRequest = {
  method: ClientRequestMethod;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

type PendingServerRequest = {
  method: ServerRequestMethod;
  params: ServerRequestParams<ServerRequestMethod>;
};

type BridgeOptions = {
  codexCommand: string;
};

type PendingDeviceCodeLogin = {
  child: ReturnType<typeof spawn>;
};

export class CodexRuntime implements SessionRuntime {
  private child: ChildProcessWithoutNullStreams | null = null;
  private startPromise: Promise<void> | null = null;
  private stopRequested = false;
  private requestCounter = 0;
  private restartTimer: NodeJS.Timeout | null = null;
  private readonly listeners = new Set<SessionRuntimeListener>();
  private readonly pendingRequests = new Map<RequestId, PendingRequest>();
  private readonly pendingServerRequests = new Map<RequestId, PendingServerRequest>();
  private readonly pendingDeviceCodeLogins = new Map<string, PendingDeviceCodeLogin>();
  private readonly canceledDeviceCodeLogins = new Set<string>();
  private account: AccountSummary = {
    authenticated: false,
    requiresOpenaiAuth: true,
    accountType: "unknown",
    email: null,
    planType: null,
    usageWindows: [],
  };
  private status: RuntimeStatus = {
    connected: false,
    childPid: null,
    authenticated: false,
    requiresOpenaiAuth: true,
    restartCount: 0,
    lastError: null,
  };

  constructor(private readonly options: BridgeOptions) {}

  subscribe(listener: SessionRuntimeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
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

    for (const login of this.pendingDeviceCodeLogins.values()) {
      login.child.kill();
    }
    this.pendingDeviceCodeLogins.clear();
    this.canceledDeviceCodeLogins.clear();

    if (this.child) {
      this.child.kill();
    }
  }

  getStatus(): RuntimeStatus {
    return { ...this.status };
  }

  async getAccountSummary(force = true): Promise<AccountSummary> {
    if (force) {
      await this.refreshAccountSummary();
    }

    return { ...this.account };
  }

  async readAccountState(): Promise<AccountStateSnapshot> {
    const [account, authStatus] = await Promise.all([
      this.getAccountSummary(true),
      this.readAuthStatusSnapshot(),
    ]);
    return {
      account,
      authStatus,
    };
  }

  async loginAccount(input: AccountLoginStartInput): Promise<AccountLoginStartResponse> {
    try {
      switch (input.type) {
        case "chatgpt": {
          const response = await this.call<LoginAccountResponse, "account/login/start">(
            "account/login/start",
            { type: "chatgpt" },
          );
          if (response.type !== "chatgpt") {
            throw new Error("Unexpected login response");
          }
          return {
            type: "chatgpt",
            loginId: response.loginId,
            authUrl: response.authUrl,
          };
        }
        case "deviceCode":
          return this.startDeviceCodeLogin();
        case "apiKey": {
          const response = await this.call<LoginAccountResponse, "account/login/start">(
            "account/login/start",
            { type: "apiKey", apiKey: input.apiKey },
          );
          if (response.type !== "apiKey") {
            throw new Error("Unexpected login response");
          }
          await this.refreshAccountSummary();
          this.emit({ type: "account.updated", account: { ...this.account } });
          this.emitStatus();
          return { type: "apiKey" };
        }
        case "chatgptAuthTokens": {
          const response = await this.call<LoginAccountResponse, "account/login/start">(
            "account/login/start",
            {
              type: "chatgptAuthTokens",
              accessToken: input.accessToken,
              chatgptAccountId: input.chatgptAccountId,
              chatgptPlanType: input.chatgptPlanType ?? null,
            },
          );
          if (response.type !== "chatgptAuthTokens") {
            throw new Error("Unexpected login response");
          }
          await this.refreshAccountSummary();
          this.emit({ type: "account.updated", account: { ...this.account } });
          this.emitStatus();
          return { type: "chatgptAuthTokens" };
        }
      }
    } catch (error) {
      throw normalizeAccountLoginError(input.type, error);
    }
  }

  async cancelAccountLogin(loginId: string): Promise<AccountLoginCancelStatus> {
    const pendingDeviceCodeLogin = this.pendingDeviceCodeLogins.get(loginId);
    if (pendingDeviceCodeLogin) {
      this.canceledDeviceCodeLogins.add(loginId);
      this.pendingDeviceCodeLogins.delete(loginId);
      pendingDeviceCodeLogin.child.kill();
      return "canceled";
    }

    const response = await this.call<CancelLoginAccountResponse, "account/login/cancel">(
      "account/login/cancel",
      { loginId },
    );
    return response.status;
  }

  async logoutAccount(): Promise<void> {
    await this.call("account/logout", undefined);
    await this.refreshAccountSummary();
    this.emit({ type: "account.updated", account: { ...this.account } });
    this.emitStatus();
  }

  async listModels(): Promise<Array<ModelOption>> {
    const models = await this.collectPages<ModelListResponse, "model/list">("model/list", {
      includeHidden: true,
    });
    return models.map((model) => ({
      id: model.id,
      model: model.model,
      displayName: model.displayName,
      description: model.description,
      upgradeModel: model.upgrade ?? null,
      supportedReasoningEfforts: model.supportedReasoningEfforts.map((option) => ({
        reasoningEffort: option.reasoningEffort,
        description: option.description,
      })),
      defaultReasoningEffort: model.defaultReasoningEffort,
      hidden: model.hidden,
      isDefault: model.isDefault,
    }));
  }

  async listThreads(archived: boolean): Promise<Array<RuntimeThreadRecord>> {
    const threads = await this.collectPages<ThreadListResponse, "thread/list">("thread/list", {
      archived,
      sortKey: "updated_at",
    });
    return threads.map((thread) => mapRuntimeThread(thread, archived));
  }

  async listLoadedThreadIds(): Promise<Array<string>> {
    return this.collectPages<ThreadLoadedListResponse, "thread/loaded/list">(
      "thread/loaded/list",
      {
        limit: 200,
      },
    );
  }

  async openThread(input: RuntimeThreadConfig): Promise<RuntimeThreadRecord> {
    const response = await this.call<ThreadStartResponse, "thread/start">("thread/start", {
      cwd: input.cwd,
      model: input.model,
      approvalPolicy: input.approvalPolicy,
      sandbox: input.sandboxMode,
      experimentalRawEvents: false,
      persistExtendedHistory: true,
    });
    return mapRuntimeThread(response.thread, false);
  }

  async resumeThread(threadId: string, path?: string | null): Promise<RuntimeThreadRecord> {
    try {
      const response = await this.call<ThreadResumeResponse, "thread/resume">(
        "thread/resume",
        {
          threadId,
          persistExtendedHistory: true,
        },
      );
      return mapRuntimeThread(response.thread, false);
    } catch (error) {
      if (!path) {
        throw error;
      }

      const response = await this.call<ThreadResumeResponse, "thread/resume">(
        "thread/resume",
        {
          threadId,
          path,
          persistExtendedHistory: true,
        },
      );
      return mapRuntimeThread(response.thread, false);
    }
  }

  async renameThread(threadId: string, name: string): Promise<void> {
    await this.call("thread/name/set", { threadId, name });
  }

  async archiveThread(threadId: string, path?: string | null): Promise<void> {
    try {
      await this.call("thread/archive", { threadId });
    } catch (error) {
      if (!path) {
        throw error;
      }

      await this.resumeThread(threadId, path);
      await this.call("thread/archive", { threadId });
    }
  }

  async unarchiveThread(threadId: string): Promise<RuntimeThreadRecord> {
    const response = await this.call<ThreadUnarchiveResponse, "thread/unarchive">(
      "thread/unarchive",
      { threadId },
    );
    return mapRuntimeThread(response.thread, false);
  }

  async forkThread(threadId: string, cwd: string): Promise<RuntimeThreadRecord> {
    const response = await this.call<ThreadForkResponse, "thread/fork">("thread/fork", {
      threadId,
      cwd,
      persistExtendedHistory: true,
    });
    return mapRuntimeThread(response.thread, false);
  }

  async compactThread(threadId: string): Promise<void> {
    await this.call("thread/compact/start", { threadId });
  }

  async rollbackThread(threadId: string, numTurns: number): Promise<RuntimeThreadRecord> {
    const response = await this.call<ThreadRollbackResponse, "thread/rollback">(
      "thread/rollback",
      {
        threadId,
        numTurns,
      },
    );
    return mapRuntimeThread(response.thread, false);
  }

  async startTurn(
    threadId: string,
    prompt: string,
    effort?: ConfigSnapshot["reasoningEffort"],
  ): Promise<RuntimeTurnRecord> {
    const response = await this.call<TurnStartResponse, "turn/start">("turn/start", {
      threadId,
      effort: effort ?? undefined,
      input: [
        {
          type: "text",
          text: prompt,
          text_elements: [],
        },
      ],
    });
    return mapRuntimeTurn(response.turn);
  }

  async interruptTurn(threadId: string, turnId: string): Promise<void> {
    await this.call("turn/interrupt", { threadId, turnId });
  }

  async steerTurn(threadId: string, turnId: string, prompt: string): Promise<void> {
    await this.call("turn/steer", {
      threadId,
      expectedTurnId: turnId,
      input: [
        {
          type: "text",
          text: prompt,
          text_elements: [],
        },
      ],
    });
  }

  async startReview(threadId: string): Promise<RuntimeTurnRecord | null> {
    const response = await this.call<ReviewStartResponse, "review/start">("review/start", {
      threadId,
      target: { type: "uncommittedChanges" },
      delivery: "inline",
    });
    return response.turn ? mapRuntimeTurn(response.turn) : null;
  }

  async startCommand(input: {
    processId: string;
    command: string;
    cwd: string;
    cols: number;
    rows: number;
  }): Promise<void> {
    await this.ensureStarted();
    void this.call<CommandExecResponse, "command/exec">("command/exec", {
      command: ["/bin/zsh", "-lc", input.command],
      processId: input.processId,
      cwd: input.cwd,
      tty: true,
      streamStdin: true,
      streamStdoutStderr: true,
      size: {
        cols: input.cols,
        rows: input.rows,
      },
    })
      .then((response) => {
        this.emit({
          type: "command.completed",
          processId: input.processId,
          session: {
            status: response.exitCode === 0 ? "completed" : "failed",
            exitCode: response.exitCode,
            stdout: response.stdout,
            stderr: response.stderr,
          },
        });
      })
      .catch((error) => {
        this.emit({
          type: "command.completed",
          processId: input.processId,
          session: {
            status: "failed",
            exitCode: null,
            stdout: "",
            stderr: error instanceof Error ? error.message : "Command failed",
          },
        });
      });
  }

  async writeCommand(processId: string, text: string): Promise<void> {
    await this.call("command/exec/write", {
      processId,
      deltaBase64: encodeTextToBase64(text),
      closeStdin: false,
    });
  }

  async resizeCommand(processId: string, cols: number, rows: number): Promise<void> {
    await this.call("command/exec/resize", {
      processId,
      size: { cols, rows },
    });
  }

  async stopCommand(processId: string): Promise<void> {
    await this.call("command/exec/terminate", {
      processId,
    });
  }

  async readConfigSnapshot(cwd?: string | null): Promise<ConfigSnapshot | null> {
    const response = await this.call<ConfigReadResponse, "config/read">("config/read", {
      includeLayers: false,
      cwd: cwd ?? undefined,
    });
    return {
      model: response.config.model ?? null,
      reasoningEffort: response.config.model_reasoning_effort ?? null,
      serviceTier: response.config.service_tier ?? null,
      approvalPolicy: normalizeApprovalPolicy(response.config.approval_policy),
      sandboxMode: normalizeSandboxMode(response.config.sandbox_mode),
      forcedLoginMethod: normalizeForcedLoginMethod(response.config.forced_login_method),
    };
  }

  async getIntegrationSnapshot(input: {
    cwd?: string | null;
    threadId?: string | null;
  }): Promise<IntegrationSnapshot> {
    const [authStatus, config, mcpServers, skills, apps, plugins] = await Promise.all([
      this.call<GetAuthStatusResponse, "getAuthStatus">("getAuthStatus", {
        includeToken: false,
        refreshToken: false,
      }),
      this.readConfigSnapshot(input.cwd),
      this.listAllMcpServers(),
      this.listSkills(input.cwd),
      this.listApps(input.threadId ?? null),
      this.listPlugins(input.cwd),
    ]);

    return {
      authStatus: {
        authMethod: authStatus.authMethod ?? null,
        requiresOpenaiAuth: authStatus.requiresOpenaiAuth ?? false,
      },
      config,
      mcpServers: mcpServers.map((server) => ({
        name: server.name,
        authStatus: server.authStatus,
        toolsCount: Object.keys(server.tools ?? {}).length,
        resourcesCount: server.resources.length,
      })),
      skills: skills.map((entry) => ({
        cwd: entry.cwd,
        skills: entry.skills.map((skill) => ({ name: skill.name })),
        errors: entry.errors.map((error) => ({ message: error.message })),
      })),
      apps: apps.map((app) => ({
        id: app.id,
        name: app.name,
        description: app.description,
        isAccessible: app.isAccessible,
        pluginDisplayNames: app.pluginDisplayNames,
        installUrl: app.installUrl,
      })),
      plugins: plugins.map((entry) => ({
        path: entry.path,
        name: entry.name,
        plugins: entry.plugins.map((plugin) => ({
          id: plugin.id,
          name: plugin.name,
          installed: plugin.installed,
          enabled: plugin.enabled,
        })),
      })),
    };
  }

  async saveSettings(input: ConfigSnapshot): Promise<void> {
    await Promise.all([
      this.call("config/value/write", {
        keyPath: "model",
        value: input.model,
        mergeStrategy: "replace",
      }),
      this.call("config/value/write", {
        keyPath: "model_reasoning_effort",
        value: input.reasoningEffort,
        mergeStrategy: "replace",
      }),
      this.call("config/value/write", {
        keyPath: "service_tier",
        value: input.serviceTier,
        mergeStrategy: "replace",
      }),
      this.call("config/value/write", {
        keyPath: "approval_policy",
        value: input.approvalPolicy,
        mergeStrategy: "replace",
      }),
      this.call("config/value/write", {
        keyPath: "sandbox_mode",
        value: input.sandboxMode,
        mergeStrategy: "replace",
      }),
    ]);
  }

  async loginMcp(name: string): Promise<string> {
    const response = await this.call<McpServerOauthLoginResponse, "mcpServer/oauth/login">(
      "mcpServer/oauth/login",
      { name },
    );
    return response.authorizationUrl;
  }

  async reloadMcp(): Promise<void> {
    await this.call("config/mcpServer/reload", undefined);
  }

  async uninstallPlugin(pluginId: string): Promise<void> {
    await this.call("plugin/uninstall", { pluginId });
  }

  async searchFiles(input: {
    query: string;
    roots: Array<string>;
  }): Promise<FuzzySearchSnapshot> {
    const response = await this.call<FuzzyFileSearchResponse, "fuzzyFileSearch">(
      "fuzzyFileSearch",
      {
        query: input.query,
        roots: input.roots,
        cancellationToken: null,
      },
    );

    return {
      sessionId: null,
      query: input.query,
      status: "completed",
      results: response.files.map((file) => ({
        path: file.path,
        score: file.score,
      })),
    };
  }

  async readWorkspaceGitSnapshot(
    cwd: string,
    workspaceId: string,
    workspaceName: string,
  ): Promise<GitWorkingTreeSnapshot> {
    return readGitWorkingTreeSnapshot({
      cwd,
      workspaceId,
      workspaceName,
    });
  }

  async readWorkspaceGitBranches(
    cwd: string,
  ): Promise<{ branches: Array<GitBranchReference>; currentBranch: string | null }> {
    return readGitBranches(cwd);
  }

  async switchWorkspaceGitBranch(cwd: string, branch: string): Promise<void> {
    await switchGitBranch(cwd, branch);
  }

  async readWorkspaceGitFileDetail(
    cwd: string,
    file: GitWorkingTreeFile,
  ): Promise<GitFileReviewDetail> {
    return readGitFileReviewDetail(cwd, file);
  }

  async resolveApproval(
    approval: PendingApproval,
    decision: "accept" | "decline",
  ): Promise<void> {
    const pending = this.pendingServerRequests.get(approval.id);
    if (!pending) {
      throw new Error("Approval no longer pending");
    }

    this.pendingServerRequests.delete(approval.id);
    const result = mapApprovalDecision(pending.method, pending.params, decision);
    this.writeMessage({
      jsonrpc: "2.0",
      id: approval.id,
      result,
    });
  }

  private async call<TResult, TMethod extends ClientRequestMethod>(
    method: TMethod,
    params: ClientRequestParams<TMethod>,
  ): Promise<TResult> {
    await this.ensureStarted();

    return new Promise<TResult>((resolve, reject) => {
      const id = this.makeInternalId(method);
      this.pendingRequests.set(id, {
        method,
        resolve: (value) => {
          if (method === "account/read") {
            this.updateAccountSummaryFromResult(value as GetAccountResponse);
          }
          resolve(value as TResult);
        },
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
    const child = spawn(this.options.codexCommand, ["app-server", "--listen", "stdio://"], {
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
    this.emitStatus();

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
      this.emitStatus();
      this.startPromise = null;

      if (!this.stopRequested) {
        this.status = {
          ...this.status,
          restartCount: this.status.restartCount + 1,
        };
        this.emitStatus();
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
            name: "webcli-runtime-codex",
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
    this.emitStatus();
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

  private async readAuthStatusSnapshot() {
    const authStatus = await this.call<GetAuthStatusResponse, "getAuthStatus">("getAuthStatus", {
      includeToken: false,
      refreshToken: false,
    });
    return {
      authMethod: authStatus.authMethod ?? null,
      requiresOpenaiAuth: authStatus.requiresOpenaiAuth ?? false,
    };
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
      this.handleNotification(message.method as ServerNotificationMethod, message.params);
      return;
    }

    if ("method" in message && "id" in message) {
      this.handleServerRequest(
        message.id,
        message.method as ServerRequestMethod,
        message.params as ServerRequestParams<ServerRequestMethod>,
      );
    }
  }

  private handleResponse(
    id: RequestId,
    result: unknown,
    error: JsonRpcError | undefined,
  ): void {
    const pending = this.pendingRequests.get(id);
    this.pendingRequests.delete(id);
    if (!pending) {
      return;
    }

    if (error) {
      pending.reject(new Error(error.message));
      return;
    }

    pending.resolve(result);
  }

  private handleNotification(method: ServerNotificationMethod, params: unknown): void {
    if (
      method === "account/updated" ||
      method === "account/login/completed" ||
      method === "account/rateLimits/updated"
    ) {
      void this.refreshAccountSummary().then((account) => {
        this.emit({
          type: "account.updated",
          account,
        });
        this.emitStatus();
      });
      return;
    }

    if (method === "thread/started") {
      this.emit({
        type: "thread.updated",
        thread: mapRuntimeThread((params as { thread: Thread }).thread, false),
      });
      return;
    }

    if (method === "thread/status/changed") {
      const payload = params as { threadId: string; status: RuntimeThreadRecord["status"] };
      this.emit({
        type: "thread.status.changed",
        threadId: payload.threadId,
        status: payload.status,
      });
      return;
    }

    if (method === "thread/name/updated") {
      const payload = params as { threadId: string; threadName?: string };
      this.emit({
        type: "thread.name.changed",
        threadId: payload.threadId,
        name: payload.threadName ?? null,
      });
      return;
    }

    if (method === "thread/archived" || method === "thread/unarchived") {
      const payload = params as { threadId: string };
      this.emit({
        type: "thread.archive.changed",
        threadId: payload.threadId,
        archived: method === "thread/archived",
      });
      return;
    }

    if (method === "turn/started" || method === "turn/completed") {
      const payload = params as { threadId: string; turn: Turn };
      this.emit({
        type: "turn.updated",
        threadId: payload.threadId,
        turn: mapRuntimeTurn(payload.turn),
      });

      const review = parseReviewFromTurn(payload.turn);
      if (review) {
        this.emit({
          type: "review.updated",
          threadId: payload.threadId,
          review,
        });
      }
      return;
    }

    if (method === "item/started" || method === "item/completed") {
      const payload = params as { threadId: string; turnId: string; item: ThreadItem };
      this.emitTimelineItem(payload.threadId, normalizeItem(payload.item, payload.turnId));
      return;
    }

    if (method === "item/agentMessage/delta") {
      this.emitDelta(params as any, "agentMessage");
      return;
    }

    if (method === "item/plan/delta") {
      this.emitDelta(params as any, "plan");
      return;
    }

    if (
      method === "item/reasoning/summaryTextDelta" ||
      method === "item/reasoning/summaryPartAdded" ||
      method === "item/reasoning/textDelta"
    ) {
      this.emitDelta(params as any, "reasoning");
      return;
    }

    if (method === "item/commandExecution/outputDelta") {
      this.emitDelta(params as any, "commandExecution");
      return;
    }

    if (method === "item/fileChange/outputDelta") {
      this.emitDelta(params as any, "fileChange");
      return;
    }

    if (method === "item/mcpToolCall/progress") {
      const payload = params as {
        threadId: string;
        turnId: string;
        itemId: string;
        message: string;
      };
      this.emit({
        type: "timeline.delta",
        threadId: payload.threadId,
        item: {
          id: payload.itemId,
          turnId: payload.turnId,
          kind: "mcpToolCall",
          title: "MCP",
          body: payload.message,
          raw: {
            type: "mcpToolCall",
            id: payload.itemId,
          },
        },
      });
      return;
    }

    if (method === "command/exec/outputDelta") {
      const payload = params as {
        processId: string;
        stream: "stdout" | "stderr";
        deltaBase64: string;
      };
      this.emit({
        type: "command.output",
        processId: payload.processId,
        stream: payload.stream,
        text: decodeBase64(payload.deltaBase64),
      });
      return;
    }

    if (method === "thread/compacted") {
      const payload = params as { threadId: string; turnId: string };
      this.emitTimelineItem(
        payload.threadId,
        normalizeItem(
          {
            type: "contextCompaction",
            id: this.makeInternalId("contextCompaction"),
          },
          payload.turnId,
        ),
      );
      return;
    }

    if (method === "turn/diff/updated") {
      const payload = params as { threadId: string; diff: string };
      this.emit({
        type: "diff.updated",
        threadId: payload.threadId,
        diff: payload.diff,
      });
      return;
    }

    if (method === "turn/plan/updated") {
      const payload = params as {
        threadId: string;
        turnId: string;
        explanation: string | null;
        plan: Array<{ step: string; status: string }>;
      };
      this.emit({
        type: "plan.updated",
        threadId: payload.threadId,
        turnId: payload.turnId,
        explanation: payload.explanation,
        plan: payload.plan,
      });
      return;
    }

    if (method === "serverRequest/resolved") {
      const payload = params as { requestId: string };
      this.emit({
        type: "approval.resolved",
        requestId: payload.requestId,
      });
    }
  }

  private handleServerRequest(
    id: RequestId,
    method: ServerRequestMethod,
    params: ServerRequestParams<ServerRequestMethod>,
  ): void {
    this.pendingServerRequests.set(id, { method, params });
    this.emit({
      type: "approval.requested",
      approval: mapPendingApproval(id, method, params),
    });
  }

  private emit(event: SessionRuntimeEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  private emitTimelineItem(threadId: string, item: TimelineEntry): void {
    this.emit({
      type: "timeline.item",
      threadId,
      item,
    });
  }

  private emitStatus(): void {
    this.emit({
      type: "status.changed",
      status: this.getStatus(),
    });
  }

  private emitDelta(
    params: { threadId: string; turnId: string; itemId: string; delta?: string },
    kind: TimelineEntry["kind"],
  ): void {
    this.emit({
      type: "timeline.delta",
      threadId: params.threadId,
      item: {
        id: params.itemId,
        turnId: params.turnId,
        kind,
        title: normalizeDeltaTitle(kind),
        body: params.delta ?? "",
        raw: {
          type: kind,
          id: params.itemId,
        },
      },
    });
  }

  private makeInternalId(method: string): string {
    this.requestCounter += 1;
    return `runtime:${method}:${this.requestCounter}`;
  }

  private rejectPendingRequests(error: Error): void {
    for (const [id, pending] of this.pendingRequests.entries()) {
      this.pendingRequests.delete(id);
      pending.reject(error);
    }
  }

  private async refreshAccountSummary(): Promise<AccountSummary> {
    const [accountResult, rateLimitsResult] = await Promise.allSettled([
      this.call<GetAccountResponse, "account/read">("account/read", {
        refreshToken: false,
      }),
      this.call<GetAccountRateLimitsResponse, "account/rateLimits/read">(
        "account/rateLimits/read",
        undefined,
      ),
    ]);

    if (accountResult.status === "fulfilled") {
      this.updateAccountSummaryFromResult(accountResult.value);
      if (rateLimitsResult.status === "fulfilled") {
        this.updateAccountUsageFromResult(rateLimitsResult.value);
      } else {
        this.account = {
          ...this.account,
          usageWindows: [],
        };
      }
      return { ...this.account };
    }

    {
      const error = accountResult.reason;
      this.account = {
        authenticated: false,
        requiresOpenaiAuth: true,
        accountType: "unknown",
        email: null,
        planType: null,
        usageWindows: [],
      };
      this.status = {
        ...this.status,
        authenticated: false,
        requiresOpenaiAuth: true,
        lastError: error instanceof Error ? error.message : "Failed to refresh account",
      };
    }
    return { ...this.account };
  }

  private updateAccountSummaryFromResult(response: GetAccountResponse): void {
    const account = response.account;
    this.account = {
      authenticated: account !== null,
      requiresOpenaiAuth: response.requiresOpenaiAuth,
      accountType: account?.type ?? "unknown",
      email: account?.type === "chatgpt" ? account.email : null,
      planType: account?.type === "chatgpt" ? account.planType : null,
      usageWindows: this.account.usageWindows,
    };
    this.status = {
      ...this.status,
      authenticated: this.account.authenticated,
      requiresOpenaiAuth: response.requiresOpenaiAuth,
      lastError: this.status.connected ? null : this.status.lastError,
    };
  }

  private updateAccountUsageFromResult(response: GetAccountRateLimitsResponse): void {
    this.account = {
      ...this.account,
      usageWindows: mapAccountUsageWindows(response),
    };
  }

  private async listAllMcpServers() {
    const data = [] as ListMcpServerStatusResponse["data"];
    let cursor: string | null = null;

    do {
      const response: ListMcpServerStatusResponse =
        await this.call<ListMcpServerStatusResponse, "mcpServerStatus/list">(
        "mcpServerStatus/list",
        {
          cursor,
          limit: 100,
        },
      );
      data.push(...response.data);
      cursor = response.nextCursor;
    } while (cursor);

    return data;
  }

  private async listSkills(cwd?: string | null) {
    const response: SkillsListResponse = await this.call<SkillsListResponse, "skills/list">(
      "skills/list",
      {
      cwds: cwd ? [cwd] : undefined,
      forceReload: false,
      },
    );
    return response.data;
  }

  private async listApps(threadId: string | null) {
    const data = [] as Array<AppInfo>;
    let cursor: string | null = null;

    do {
      const response: AppListResponse = await this.call<AppListResponse, "app/list">(
        "app/list",
        {
          cursor,
          limit: 100,
          threadId,
          forceRefetch: false,
        },
      );
      data.push(...response.data);
      cursor = response.nextCursor;
    } while (cursor);

    return data;
  }

  private async listPlugins(cwd?: string | null) {
    const response: PluginListResponse = await this.call<PluginListResponse, "plugin/list">(
      "plugin/list",
      {
      cwds: cwd ? [cwd] : undefined,
      },
    );
    return response.marketplaces;
  }

  private async collectPages<
    TResult extends { data: Array<unknown>; nextCursor: string | null },
    TMethod extends "model/list" | "thread/list" | "thread/loaded/list",
  >(
    method: TMethod,
    params: ClientRequestParams<TMethod>,
  ): Promise<Array<TResult["data"][number]>> {
    let cursor: string | null = null;
    const data: Array<TResult["data"][number]> = [];

    do {
      const response: TResult = await this.call<TResult, TMethod>(method, {
        ...(params as Record<string, unknown>),
        cursor,
      } as ClientRequestParams<TMethod>);
      data.push(...response.data);
      cursor = response.nextCursor;
    } while (cursor);

    return data;
  }

  private async startDeviceCodeLogin(): Promise<AccountLoginStartResponse> {
    const loginId = randomUUID();
    const child = spawn(this.options.codexCommand, ["login", "--device-auth"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        FORCE_COLOR: "0",
        NO_COLOR: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    this.pendingDeviceCodeLogins.set(loginId, { child });

    let output = "";
    let settled = false;

    return new Promise<AccountLoginStartResponse>((resolve, reject) => {
      const startupTimer = setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        this.pendingDeviceCodeLogins.delete(loginId);
        child.kill();
        reject(
          new AppError(
            "account.device_code_start_failed",
            "Failed to read device code login instructions",
          ),
        );
      }, 10_000);

      const maybeResolve = () => {
        if (settled) {
          return;
        }

        const parsed = parseDeviceCodePrompt(output);
        if (!parsed.verificationUrl || !parsed.userCode) {
          return;
        }

        settled = true;
        clearTimeout(startupTimer);
        resolve({
          type: "deviceCode",
          loginId,
          verificationUrl: parsed.verificationUrl,
          userCode: parsed.userCode,
          expiresAt: parsed.expiresAt,
        });
      };

      const handleChunk = (chunk: string) => {
        output += stripAnsi(chunk);
        maybeResolve();
      };

      child.stdout.on("data", (chunk) => {
        handleChunk(chunk.toString());
      });

      child.stderr.on("data", (chunk) => {
        handleChunk(chunk.toString());
      });

      child.once("error", (error) => {
        clearTimeout(startupTimer);
        this.pendingDeviceCodeLogins.delete(loginId);
        if (!settled) {
          settled = true;
          reject(new AppError("account.device_code_start_failed", error.message));
          return;
        }
        this.setLastError(error.message);
      });

      child.once("exit", (code, signal) => {
        clearTimeout(startupTimer);
        void this.handleDeviceCodeLoginExit(loginId, code, signal, output, settled, reject);
      });
    });
  }

  private async handleDeviceCodeLoginExit(
    loginId: string,
    code: number | null,
    signal: NodeJS.Signals | null,
    output: string,
    settled: boolean,
    reject: (error: Error) => void,
  ): Promise<void> {
    const wasCanceled = this.canceledDeviceCodeLogins.delete(loginId);
    this.pendingDeviceCodeLogins.delete(loginId);

    if (wasCanceled) {
      return;
    }

    if (!settled) {
      reject(
        new AppError(
          "account.device_code_start_failed",
          output.trim() || `codex login --device-auth exited (${signal ?? code ?? "unknown"})`,
        ),
      );
      return;
    }

    try {
      await this.refreshAccountSummary();
      this.emit({ type: "account.updated", account: { ...this.account } });
      this.emitStatus();
    } catch (error) {
      if (error instanceof Error) {
        this.setLastError(error.message);
      }
      return;
    }

    if (code !== 0 || signal !== null) {
      this.setLastError(
        output.trim() || `Device code login exited (${signal ?? "code"}:${code ?? "unknown"})`,
      );
    }
  }

  private setLastError(message: string): void {
    this.status = {
      ...this.status,
      lastError: message,
    };
    this.emitStatus();
  }
}

function mapRuntimeThread(thread: Thread, archived: boolean): RuntimeThreadRecord {
  return {
    id: thread.id,
    name: thread.name,
    preview: thread.preview,
    archived,
    cwd: thread.cwd,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    status: mapThreadStatus(thread.status),
    modelProvider: thread.modelProvider,
    source: normalizeSessionSource(thread.source),
    agentNickname: thread.agentNickname,
    agentRole: thread.agentRole,
    gitInfo: thread.gitInfo,
    path: thread.path,
    ephemeral: thread.ephemeral,
    turns: thread.turns.map((turn) => mapRuntimeTurn(turn)),
  };
}

function mapThreadStatus(status: Thread["status"]): RuntimeThreadRecord["status"] {
  if (status.type === "active") {
    return {
      type: "active",
      activeFlags: status.activeFlags.map((flag) => String(flag)),
    };
  }

  return status;
}

function mapRuntimeTurn(turn: Turn): RuntimeTurnRecord {
  return {
    id: turn.id,
    status: turn.status,
    errorMessage: turn.error?.message ?? null,
    items: turn.items.map((item) => normalizeItem(item, turn.id)),
  };
}

function normalizeItem(item: ThreadItem, turnId: string): TimelineEntry {
  switch (item.type) {
    case "userMessage":
      return {
        id: item.id,
        turnId,
        kind: item.type,
        title: "You",
        body: item.content
          .map((entry) => {
            if (entry.type === "text") {
              return entry.text;
            }

            if (entry.type === "image") {
              return `![](${entry.url})`;
            }

            if (entry.type === "localImage") {
              return `![](${entry.path})`;
            }

            if (entry.type === "skill" || entry.type === "mention") {
              return `[${entry.name}](${entry.path})`;
            }

            return "";
          })
          .filter(Boolean)
          .join("\n\n"),
        raw: item,
      };
    case "agentMessage":
      return {
        id: item.id,
        turnId,
        kind: item.type,
        title: "Codex",
        body: item.text,
        raw: item,
      };
    case "plan":
      return {
        id: item.id,
        turnId,
        kind: item.type,
        title: "Plan",
        body: item.text,
        raw: item,
      };
    case "reasoning":
      return {
        id: item.id,
        turnId,
        kind: item.type,
        title: "Reasoning",
        body: [...item.summary, ...item.content].join("\n"),
        raw: item,
      };
    case "commandExecution":
      return {
        id: item.id,
        turnId,
        kind: item.type,
        title: item.command,
        body: item.aggregatedOutput ?? "",
        raw: item,
      };
    case "fileChange":
      return {
        id: item.id,
        turnId,
        kind: item.type,
        title: "File Change",
        body: item.changes.map((change) => `${change.kind}: ${change.path}`).join("\n"),
        raw: item,
      };
    case "mcpToolCall":
      return {
        id: item.id,
        turnId,
        kind: item.type,
        title: `${item.server} / ${item.tool}`,
        body: item.result ? JSON.stringify(item.result, null, 2) : "",
        raw: item,
      };
    case "dynamicToolCall":
      return {
        id: item.id,
        turnId,
        kind: item.type,
        title: item.tool,
        body: item.contentItems ? JSON.stringify(item.contentItems, null, 2) : "",
        raw: item,
      };
    case "collabAgentToolCall":
      return {
        id: item.id,
        turnId,
        kind: item.type,
        title: item.tool,
        body: item.prompt ?? "",
        raw: item,
      };
    case "webSearch":
      return {
        id: item.id,
        turnId,
        kind: item.type,
        title: "Web Search",
        body: item.query,
        raw: item,
      };
    case "imageView":
      return {
        id: item.id,
        turnId,
        kind: item.type,
        title: "Image",
        body: item.path,
        raw: item,
      };
    case "imageGeneration":
      return {
        id: item.id,
        turnId,
        kind: item.type,
        title: "Image Generation",
        body: [item.revisedPrompt, item.result].filter(Boolean).join("\n\n"),
        raw: item,
      };
    case "enteredReviewMode":
      return {
        id: item.id,
        turnId,
        kind: item.type,
        title: "Entered Review",
        body: item.review,
        raw: item,
      };
    case "exitedReviewMode":
      return {
        id: item.id,
        turnId,
        kind: item.type,
        title: "Exited Review",
        body: item.review,
        raw: item,
      };
    case "contextCompaction":
      return {
        id: item.id,
        turnId,
        kind: item.type,
        title: "Context Compaction",
        body: "",
        raw: item,
      };
    default:
      const unknownItem = item as { id: string; type: string };
      return {
        id: unknownItem.id,
        turnId,
        kind: unknownItem.type,
        title: unknownItem.type,
        body: JSON.stringify(item, null, 2),
        raw: item,
      };
  }
}

function parseReviewFromTurn(turn: Turn): ReviewOutputEvent | null {
  const reviewItem = [...turn.items]
    .reverse()
    .find((item) => item.type === "exitedReviewMode" || item.type === "enteredReviewMode");
  if (!reviewItem || !("review" in reviewItem) || !reviewItem.review) {
    return null;
  }

  try {
    return JSON.parse(reviewItem.review) as ReviewOutputEvent;
  } catch {
    return null;
  }
}

function mapPendingApproval(
  id: RequestId,
  method: ServerRequestMethod,
  params: ServerRequestParams<ServerRequestMethod>,
): PendingApproval {
  const payload = params as Record<string, unknown>;
  return {
    id,
    method,
    threadId:
      typeof payload.threadId === "string"
        ? payload.threadId
        : typeof payload.conversationId === "string"
          ? payload.conversationId
          : null,
    turnId: typeof payload.turnId === "string" ? payload.turnId : null,
    itemId: typeof payload.itemId === "string" ? payload.itemId : null,
    params,
  };
}

function mapApprovalDecision(
  method: ServerRequestMethod,
  params: ServerRequestParams<ServerRequestMethod>,
  decision: "accept" | "decline",
): ServerRequestResult<ServerRequestMethod> {
  if (method === "item/commandExecution/requestApproval") {
    return {
      decision: decision === "accept" ? "accept" : "decline",
    } as ServerRequestResultMap["item/commandExecution/requestApproval"];
  }

  if (method === "item/fileChange/requestApproval") {
    return {
      decision: decision === "accept" ? "accept" : "decline",
    } as ServerRequestResultMap["item/fileChange/requestApproval"];
  }

  if (method === "item/tool/requestUserInput") {
    const questions =
      (params as { questions?: Array<{ id: string; options?: Array<{ label: string }> }> })
        .questions ?? [];
    return {
      answers:
        decision === "accept"
          ? Object.fromEntries(
              questions.map((question) => [
                question.id,
                {
                  answers: [question.options?.[0]?.label ?? ""],
                },
              ]),
            )
          : {},
    } as ServerRequestResultMap["item/tool/requestUserInput"];
  }

  if (method === "applyPatchApproval") {
    return {
      decision: decision === "accept" ? "approved" : "rejected",
    } as ApplyPatchApprovalResponse;
  }

  if (method === "execCommandApproval") {
    return {
      decision: decision === "accept" ? "approved" : "rejected",
    } as ExecCommandApprovalResponse;
  }

  if (method === "item/permissions/requestApproval") {
    return {
      permissions: {},
    } as PermissionsRequestApprovalResponse;
  }

  throw new Error(`Unsupported approval method: ${method}`);
}

function normalizeDeltaTitle(kind: TimelineEntry["kind"]): string {
  if (kind === "agentMessage") {
    return "Codex";
  }

  if (kind === "plan") {
    return "Plan";
  }

  if (kind === "reasoning") {
    return "Reasoning";
  }

  if (kind === "commandExecution") {
    return "Command";
  }

  if (kind === "fileChange") {
    return "File Change";
  }

  return String(kind);
}

function mapAccountUsageWindows(
  response: GetAccountRateLimitsResponse,
): Array<AccountUsageWindow> {
  const snapshots = [
    response.rateLimits,
    ...Object.values(response.rateLimitsByLimitId ?? {}).filter(
      (snapshot): snapshot is NonNullable<typeof snapshot> => Boolean(snapshot),
    ),
  ];
  const usageByLabel = new Map<string, AccountUsageWindow>();

  for (const snapshot of snapshots) {
    for (const window of [snapshot.primary, snapshot.secondary]) {
      if (!window) {
        continue;
      }

      const label = formatUsageWindowLabel(window.windowDurationMins);
      if (!label || usageByLabel.has(label)) {
        continue;
      }

      const usedPercent = clampPercent(window.usedPercent);
      usageByLabel.set(label, {
        label,
        usedPercent,
        remainingPercent: usedPercent === null ? null : clampPercent(100 - usedPercent),
        resetsAt: window.resetsAt ?? null,
      });
    }
  }

  return Array.from(usageByLabel.values()).sort(compareUsageWindows);
}

function formatUsageWindowLabel(windowDurationMins: number | null): string | null {
  if (!windowDurationMins || windowDurationMins <= 0) {
    return null;
  }

  if (windowDurationMins === 300) {
    return "5h";
  }

  if (windowDurationMins === 10_080) {
    return "1w";
  }

  if (windowDurationMins % 10_080 === 0) {
    return `${windowDurationMins / 10_080}w`;
  }

  if (windowDurationMins % 1_440 === 0) {
    return `${windowDurationMins / 1_440}d`;
  }

  if (windowDurationMins % 60 === 0) {
    return `${windowDurationMins / 60}h`;
  }

  return `${windowDurationMins}m`;
}

function compareUsageWindows(left: AccountUsageWindow, right: AccountUsageWindow): number {
  return usageWindowSortValue(left.label) - usageWindowSortValue(right.label);
}

function usageWindowSortValue(label: string): number {
  if (label === "5h") {
    return 0;
  }

  if (label === "1w") {
    return 1;
  }

  return 10;
}

function clampPercent(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return Math.min(100, Math.max(0, value));
}

function normalizeNullableString<T extends string>(value: T | null | undefined): T | null {
  return value ?? null;
}

function normalizeApprovalPolicy(value: AskForApproval | null | undefined): ApprovalPolicy | null {
  if (value === "on-request" || value === "on-failure" || value === "untrusted" || value === "never") {
    return value;
  }

  if (value && typeof value === "object" && "reject" in value) {
    return "never";
  }

  return null;
}

function normalizeSandboxMode(
  value: RuntimeSandboxMode | null | undefined,
): SandboxMode | null {
  if (
    value === "danger-full-access" ||
    value === "workspace-write" ||
    value === "read-only"
  ) {
    return value;
  }

  return null;
}

function normalizeForcedLoginMethod(
  value: string | null | undefined,
): ForcedLoginMethod | null {
  if (value === "chatgpt" || value === "api") {
    return value;
  }

  return null;
}

function normalizeAccountLoginError(
  type: AccountLoginStartInput["type"],
  error: unknown,
) {
  if (error instanceof AppError) {
    return error;
  }

  if (!(error instanceof Error)) {
    return error;
  }

  const message = error.message.toLowerCase();
  if (
    type === "apiKey" &&
    (message.includes("api key") || message.includes("invalid_api_key") || message.includes("unauthorized") || message.includes("401"))
  ) {
    return new AppError("account.api_key_invalid", error.message);
  }

  if (
    type === "chatgptAuthTokens" &&
    (message.includes("token") || message.includes("jwt") || message.includes("account id") || message.includes("chatgpt"))
  ) {
    return new AppError("account.chatgpt_tokens_invalid", error.message);
  }

  if (type === "deviceCode") {
    return new AppError("account.device_code_start_failed", error.message);
  }

  return error;
}

function stripAnsi(value: string): string {
  return value
    .replace(/\u001B\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/\u001B\][^\u0007]*(?:\u0007|\u001B\\)/g, "");
}

function parseDeviceCodePrompt(output: string): {
  verificationUrl: string | null;
  userCode: string | null;
  expiresAt: number | null;
} {
  const verificationUrl = output.match(/https:\/\/auth\.openai\.com\/codex\/device\S*/i)?.[0] ?? null;
  const userCode = output.match(/\b([A-Z0-9]{4,}(?:-[A-Z0-9]{4,})+)\b/)?.[1] ?? null;
  const minutes = output.match(/expires in (\d+) minutes?/i)?.[1];
  return {
    verificationUrl,
    userCode,
    expiresAt: minutes ? Date.now() + Number.parseInt(minutes, 10) * 60_000 : null,
  };
}

function normalizeSessionSource(source: Thread["source"]): string {
  return typeof source === "string" ? source : "subAgent";
}

function encodeTextToBase64(value: string): string {
  return Buffer.from(value, "utf8").toString("base64");
}

function decodeBase64(value: string): string {
  return Buffer.from(value, "base64").toString("utf8");
}
