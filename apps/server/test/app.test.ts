import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import type {
  AccountLoginCancelStatus,
  AccountLoginStartInput,
  AccountLoginStartResponse,
  AccountStateSnapshot,
  AccountSummary,
  AppInstallHint,
  AppSnapshot,
  AppClientMessage,
  AppServerMessage,
  ApprovalPolicy,
  ConfigSnapshot,
  FuzzySearchSnapshot,
  GitBranchReference,
  GitFileReviewDetail,
  GitWorkingTreeFile,
  GitWorkingTreeSnapshot,
  HazelnutScope,
  IntegrationSnapshot,
  ModelOption,
  McpServerSnapshot,
  PendingApproval,
  PluginMarketplaceSnapshot,
  ProductSurface,
  ReasoningEffort,
  RemoteSkillExportResult,
  RemoteSkillSummary,
  RuntimeStatus,
  SandboxMode,
  ThreadMetadataGitInfoUpdate,
  SkillGroupSnapshot,
} from "@webcli/contracts";
import {
  WorkspaceRepo,
  type RuntimeThreadConfig,
  type RuntimeThreadRecord,
  type RuntimeTurnRecord,
  type SessionRuntime,
  type SessionRuntimeEvent,
  type SessionRuntimeListener,
} from "@webcli/core";
import { createApp } from "../src/app.js";
import type { AppEnv } from "../src/env.js";

class FakeRuntime implements SessionRuntime {
  readonly listeners = new Set<SessionRuntimeListener>();
  readonly approvalResolutions: Array<{
    approval: PendingApproval;
    decision: "accept" | "decline";
  }> = [];

  status: RuntimeStatus = {
    connected: true,
    childPid: 123,
    authenticated: true,
    requiresOpenaiAuth: true,
    restartCount: 0,
    lastError: null,
  };

  account: AccountSummary = {
    authenticated: true,
    requiresOpenaiAuth: true,
    accountType: "chatgpt",
    email: "user@example.com",
    planType: "pro",
    usageWindows: [
      {
        label: "5h",
        remainingPercent: 75,
        usedPercent: 25,
        resetsAt: 1_710_000_000,
      },
      {
        label: "1w",
        remainingPercent: 48,
        usedPercent: 52,
        resetsAt: 1_710_604_800,
      },
    ],
  };

  models: Array<ModelOption> = [
    {
      id: "gpt-5-codex",
      model: "gpt-5-codex",
      displayName: "GPT-5 Codex",
      description: "Default",
      upgradeModel: "gpt-5-codex-spark",
      supportedReasoningEfforts: [
        { reasoningEffort: "low", description: "Low reasoning effort" },
        { reasoningEffort: "medium", description: "Medium reasoning effort" },
        { reasoningEffort: "high", description: "High reasoning effort" },
        { reasoningEffort: "xhigh", description: "Extra high reasoning effort" },
      ],
      defaultReasoningEffort: "high",
      hidden: false,
      isDefault: true,
    },
  ];

  config: ConfigSnapshot = {
    model: "gpt-5-codex",
    reasoningEffort: "high",
    serviceTier: null,
    approvalPolicy: "on-request",
    sandboxMode: "danger-full-access",
    forcedLoginMethod: null,
  };

  activeThreads: Array<RuntimeThreadRecord> = [];
  archivedThreads: Array<RuntimeThreadRecord> = [];
  nextThreadId = 1;
  gitCurrentBranch = "main";
  gitBranches = ["main", "feature/demo"];
  mcpServers: Array<McpServerSnapshot> = [
    {
      name: "filesystem",
      authStatus: "connected",
      toolsCount: 2,
      resourcesCount: 1,
    },
  ];
  skills: Array<SkillGroupSnapshot> = [
    {
      cwd: "/workspace",
      skills: [
        {
          name: "lint",
          description: "Run lint checks",
          shortDescription: "Lint",
          path: "/workspace/.codex/skills/lint",
          enabled: true,
        },
      ],
      errors: [],
    },
  ];
  remoteSkills: Array<RemoteSkillSummary> = [
    {
      id: "remote-lint",
      name: "Remote lint",
      description: "Shared lint skill",
    },
  ];
  apps: Array<AppSnapshot> = [
    {
      id: "github",
      name: "GitHub",
      description: "Connector",
      isAccessible: true,
      isEnabled: true,
      pluginDisplayNames: ["github-plugin"],
      installUrl: "https://example.com/install",
    },
  ];
  plugins: Array<PluginMarketplaceSnapshot> = [
    {
      path: "/plugins/official",
      name: "Official",
      plugins: [
        {
          id: "github-plugin",
          name: "github-plugin",
          installed: false,
          enabled: false,
        },
      ],
    },
  ];

  async start(): Promise<void> {}
  async stop(): Promise<void> {}

  subscribe(listener: SessionRuntimeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(event: SessionRuntimeEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  getStatus(): RuntimeStatus {
    return { ...this.status };
  }

  async getAccountSummary(): Promise<AccountSummary> {
    return { ...this.account };
  }

  async readAccountState(): Promise<AccountStateSnapshot> {
    return {
      account: { ...this.account },
      authStatus: {
        authMethod:
          this.account.accountType === "chatgpt"
            ? "chatgpt"
            : this.account.accountType === "apiKey"
              ? "apikey"
              : null,
        requiresOpenaiAuth: this.account.requiresOpenaiAuth,
      },
    };
  }

  async loginAccount(input: AccountLoginStartInput): Promise<AccountLoginStartResponse> {
    if (input.type === "chatgpt") {
      return {
        type: "chatgpt",
        loginId: "login-123",
        authUrl: "https://example.com/login",
      };
    }
    if (input.type === "deviceCode") {
      return {
        type: "deviceCode",
        loginId: "device-login-123",
        verificationUrl: "https://auth.openai.com/codex/device",
        userCode: "ABCD-EFGH",
        expiresAt: Date.now() + 15 * 60_000,
      };
    }
    this.account = {
      ...this.account,
      authenticated: true,
      requiresOpenaiAuth: false,
      accountType: input.type === "apiKey" ? "apiKey" : "chatgpt",
      email: input.type === "apiKey" ? null : "user@example.com",
      planType: input.type === "apiKey" ? null : "pro",
    };
    this.emit({ type: "account.updated", account: this.account });
    return { type: input.type };
  }

  async cancelAccountLogin(): Promise<AccountLoginCancelStatus> {
    return "canceled";
  }

  async logoutAccount(): Promise<void> {
    this.account = {
      authenticated: false,
      requiresOpenaiAuth: true,
      accountType: "unknown",
      email: null,
      planType: null,
      usageWindows: [],
    };
    this.emit({ type: "account.updated", account: this.account });
  }

  async listModels(): Promise<Array<ModelOption>> {
    return [...this.models];
  }

  async listThreads(archived: boolean): Promise<Array<RuntimeThreadRecord>> {
    return archived ? [...this.archivedThreads] : [...this.activeThreads];
  }

  async readThread(threadId: string): Promise<RuntimeThreadRecord> {
    const thread =
      this.activeThreads.find((entry) => entry.id === threadId) ??
      this.archivedThreads.find((entry) => entry.id === threadId);
    if (!thread) {
      throw new Error("Thread not found");
    }
    return thread;
  }

  async listLoadedThreadIds(): Promise<Array<string>> {
    return this.activeThreads.map((thread) => thread.id);
  }

  async openThread(input: RuntimeThreadConfig): Promise<RuntimeThreadRecord> {
    const thread = makeRuntimeThread(input.cwd, {
      id: `thread-opened-${this.nextThreadId++}`,
      name: "Opened thread",
      createdAt: this.nextThreadId,
      updatedAt: this.nextThreadId,
      archived: false,
      approvalPolicy: input.approvalPolicy,
      sandboxMode: input.sandboxMode,
    });
    this.activeThreads = [thread, ...this.activeThreads];
    this.emit({ type: "thread.updated", thread });
    return thread;
  }

  async resumeThread(threadId: string): Promise<RuntimeThreadRecord> {
    return this.readThread(threadId);
  }

  async updateThreadMetadata(
    threadId: string,
    input: { gitInfo?: ThreadMetadataGitInfoUpdate | null },
  ): Promise<RuntimeThreadRecord> {
    const thread = await this.readThread(threadId);
    const next = {
      ...thread,
      gitInfo:
        input.gitInfo === undefined
          ? thread.gitInfo
          : input.gitInfo === null
            ? null
            : {
                ...(thread.gitInfo && typeof thread.gitInfo === "object"
                  ? (thread.gitInfo as Record<string, unknown>)
                  : {}),
                ...(input.gitInfo.originUrl !== undefined ? { originUrl: input.gitInfo.originUrl } : {}),
                ...(input.gitInfo.branch !== undefined ? { branch: input.gitInfo.branch } : {}),
                ...(input.gitInfo.sha !== undefined ? { sha: input.gitInfo.sha } : {}),
              },
    };
    this.activeThreads = this.activeThreads.map((entry) => (entry.id === threadId ? next : entry));
    this.archivedThreads = this.archivedThreads.map((entry) => (entry.id === threadId ? next : entry));
    this.emit({ type: "thread.updated", thread: next });
    return next;
  }

  async unsubscribeThread(
    threadId: string,
  ): Promise<"notLoaded" | "notSubscribed" | "unsubscribed"> {
    const thread = await this.readThread(threadId);
    if (thread.status.type === "notLoaded") {
      return "notLoaded";
    }

    const next = { ...thread, status: { type: "notLoaded" } as const };
    this.activeThreads = this.activeThreads.map((entry) => (entry.id === threadId ? next : entry));
    this.archivedThreads = this.archivedThreads.map((entry) => (entry.id === threadId ? next : entry));
    this.emit({ type: "thread.closed", threadId });
    return "unsubscribed";
  }

  async renameThread(threadId: string, name: string): Promise<void> {
    this.activeThreads = this.activeThreads.map((thread) =>
      thread.id === threadId ? { ...thread, name } : thread,
    );
    this.emit({ type: "thread.name.changed", threadId, name });
  }

  async archiveThread(threadId: string): Promise<void> {
    const thread = this.activeThreads.find((entry) => entry.id === threadId);
    if (!thread) {
      return;
    }
    this.activeThreads = this.activeThreads.filter((entry) => entry.id !== threadId);
    this.archivedThreads = [{ ...thread, archived: true }, ...this.archivedThreads];
    this.emit({ type: "thread.archive.changed", threadId, archived: true });
  }

  async unarchiveThread(threadId: string): Promise<RuntimeThreadRecord> {
    const thread = this.archivedThreads.find((entry) => entry.id === threadId);
    if (!thread) {
      throw new Error("Thread not found");
    }
    this.archivedThreads = this.archivedThreads.filter((entry) => entry.id !== threadId);
    const next = { ...thread, archived: false };
    this.activeThreads = [next, ...this.activeThreads];
    this.emit({ type: "thread.archive.changed", threadId, archived: false });
    return next;
  }

  async forkThread(threadId: string, cwd: string): Promise<RuntimeThreadRecord> {
    const base = await this.resumeThread(threadId);
    const forked = {
      ...base,
      id: `thread-fork-${this.nextThreadId++}`,
      cwd,
      archived: false,
    };
    this.activeThreads = [forked, ...this.activeThreads];
    this.emit({ type: "thread.updated", thread: forked });
    return forked;
  }

  async compactThread(): Promise<void> {}

  async rollbackThread(threadId: string): Promise<RuntimeThreadRecord> {
    return this.resumeThread(threadId);
  }

  async startTurn(
    threadId: string,
    prompt: string,
    effort?: ReasoningEffort | null,
  ): Promise<RuntimeTurnRecord> {
    if (effort !== undefined) {
      this.config.reasoningEffort = effort ?? null;
    }
    const turn: RuntimeTurnRecord = {
      id: `turn-${Date.now()}`,
      status: "running",
      errorMessage: null,
      tokenUsage: null,
      items: [
        {
          id: `item-${Date.now()}`,
          turnId: `turn-${Date.now()}`,
          kind: "userMessage",
          title: "You",
          body: prompt,
          raw: { prompt },
        },
      ],
    };
    this.emit({ type: "turn.updated", threadId, turn });
    return turn;
  }

  async interruptTurn(): Promise<void> {}
  async steerTurn(): Promise<void> {}
  async startReview(): Promise<RuntimeTurnRecord | null> {
    return null;
  }
  async startCommand(): Promise<void> {}
  async writeCommand(): Promise<void> {}
  async resizeCommand(): Promise<void> {}
  async stopCommand(): Promise<void> {}

  async readConfigSnapshot(): Promise<ConfigSnapshot | null> {
    return { ...this.config };
  }

  async getIntegrationSnapshot(): Promise<IntegrationSnapshot> {
    const authMethod =
      this.account.accountType === "chatgpt"
        ? "chatgpt"
        : this.account.accountType === "apiKey"
          ? "apikey"
          : null;

    return {
      authStatus: {
        authMethod,
        requiresOpenaiAuth: this.account.requiresOpenaiAuth,
      },
      config: { ...this.config },
      mcpServers: this.mcpServers.map((server) => ({ ...server })),
      skills: this.skills.map((group) => ({
        ...group,
        skills: group.skills.map((skill) => ({ ...skill })),
        errors: group.errors.map((error) => ({ ...error })),
      })),
      apps: this.apps.map((app) => ({ ...app, pluginDisplayNames: [...app.pluginDisplayNames] })),
      plugins: this.plugins.map((marketplace) => ({
        ...marketplace,
        plugins: marketplace.plugins.map((plugin) => ({ ...plugin })),
      })),
    };
  }

  async saveSettings(input: ConfigSnapshot): Promise<void> {
    this.config = { ...input };
  }

  async readWorkspaceGitSnapshot(
    cwd: string,
    workspaceId: string,
    workspaceName: string,
  ): Promise<GitWorkingTreeSnapshot> {
    return makeGitSnapshot(workspaceId, workspaceName, cwd, this.gitCurrentBranch);
  }

  async readWorkspaceGitBranches(): Promise<{
    branches: Array<GitBranchReference>;
    currentBranch: string | null;
  }> {
    return {
      branches: this.gitBranches.map((name) => ({
        name,
        current: name === this.gitCurrentBranch,
      })),
      currentBranch: this.gitCurrentBranch,
    };
  }

  async switchWorkspaceGitBranch(_cwd: string, branch: string): Promise<void> {
    if (!this.gitBranches.includes(branch)) {
      this.gitBranches.push(branch);
    }
    this.gitCurrentBranch = branch;
  }

  async readWorkspaceGitFileDetail(
    _cwd: string,
    file: GitWorkingTreeFile,
  ): Promise<GitFileReviewDetail> {
    return makeGitFileReviewDetail(file);
  }

  async loginMcp(): Promise<string> {
    return "https://example.com/auth";
  }

  async reloadMcp(): Promise<void> {}
  async listMcpServerStatuses(): Promise<Array<McpServerSnapshot>> {
    return this.mcpServers.map((server) => ({ ...server }));
  }

  async listSkills(): Promise<Array<SkillGroupSnapshot>> {
    return this.skills.map((group) => ({
      ...group,
      skills: group.skills.map((skill) => ({ ...skill })),
      errors: group.errors.map((error) => ({ ...error })),
    }));
  }

  async listRemoteSkills(_input: {
    hazelnutScope: HazelnutScope;
    productSurface: ProductSurface;
    enabled: boolean;
  }): Promise<Array<RemoteSkillSummary>> {
    return this.remoteSkills.map((skill) => ({ ...skill }));
  }

  async exportRemoteSkill(hazelnutId: string): Promise<RemoteSkillExportResult> {
    const exported = this.remoteSkills.find((skill) => skill.id === hazelnutId);
    const path = `/workspace/.codex/skills/${hazelnutId}`;
    if (exported) {
      this.skills = this.skills.map((group, index) =>
        index === 0
          ? {
              ...group,
              skills: [
                ...group.skills,
                {
                  name: exported.name,
                  description: exported.description,
                  shortDescription: exported.name,
                  path,
                  enabled: true,
                },
              ],
            }
          : group,
      );
    }
    return { id: hazelnutId, path };
  }

  async writeSkillConfig(
    path: string,
    enabled: boolean,
  ): Promise<{ effectiveEnabled: boolean }> {
    this.skills = this.skills.map((group) => ({
      ...group,
      skills: group.skills.map((skill) =>
        skill.path === path ? { ...skill, enabled } : skill,
      ),
    }));
    return { effectiveEnabled: enabled };
  }

  async listApps(): Promise<Array<AppSnapshot>> {
    return this.apps.map((app) => ({ ...app, pluginDisplayNames: [...app.pluginDisplayNames] }));
  }

  async listPlugins(): Promise<Array<PluginMarketplaceSnapshot>> {
    return this.plugins.map((marketplace) => ({
      ...marketplace,
      plugins: marketplace.plugins.map((plugin) => ({ ...plugin })),
    }));
  }

  async installPlugin(input: {
    marketplacePath: string;
    pluginName: string;
  }): Promise<{ appsNeedingAuth: Array<AppInstallHint> }> {
    this.plugins = this.plugins.map((marketplace) =>
      marketplace.path === input.marketplacePath
        ? {
            ...marketplace,
            plugins: marketplace.plugins.map((plugin) =>
              plugin.name === input.pluginName
                ? { ...plugin, installed: true, enabled: true }
                : plugin,
            ),
          }
        : marketplace,
    );
    return {
      appsNeedingAuth: this.apps.map((app) => ({
        id: app.id,
        name: app.name,
        description: app.description,
        installUrl: app.installUrl,
      })),
    };
  }

  async uninstallPlugin(pluginId: string): Promise<void> {
    this.plugins = this.plugins.map((marketplace) => ({
      ...marketplace,
      plugins: marketplace.plugins.map((plugin) =>
        plugin.id === pluginId ? { ...plugin, installed: false, enabled: false } : plugin,
      ),
    }));
  }

  async searchFiles(): Promise<FuzzySearchSnapshot> {
    return {
      sessionId: null,
      query: "",
      status: "completed",
      results: [],
    };
  }

  async resolveApproval(
    approval: PendingApproval,
    decision: "accept" | "decline",
  ): Promise<void> {
    this.approvalResolutions.push({ approval, decision });
  }
}

let tempDir = "";

beforeEach(() => {
  tempDir = mkdtempSync(join(homedir(), ".webcli-app-"));
});

afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("createApp", () => {
  it("serves bootstrap data and scopes approvals to the owning client session", async () => {
    const workspacePath = join(tempDir, "workspace");
    const derivedWorkspacePath = join(tempDir, "derived-project");
    mkdirSync(workspacePath, { recursive: true });
    mkdirSync(derivedWorkspacePath, { recursive: true });

    const env: AppEnv = {
      host: "127.0.0.1",
      port: 0,
      codexCommand: "codex",
      dataDir: tempDir,
      dbPath: join(tempDir, "app.sqlite"),
      webDistDir: join(tempDir, "missing-web"),
    };

    const runtime = new FakeRuntime();
    runtime.activeThreads = [
      makeRuntimeThread(workspacePath, {
        id: "thread-1",
        name: "Saved thread",
        createdAt: 1,
        updatedAt: 2,
      }),
      makeRuntimeThread(derivedWorkspacePath, {
        id: "thread-derived",
        name: "Derived thread",
        createdAt: 5,
        updatedAt: 6,
      }),
      makeRuntimeThread("/srv/outside-workspace", {
        id: "thread-outside",
        name: "Outside",
        createdAt: 7,
        updatedAt: 8,
      }),
    ];
    runtime.archivedThreads = [
      makeRuntimeThread(workspacePath, {
        id: "thread-archived",
        name: "Archived",
        archived: true,
        createdAt: 3,
        updatedAt: 4,
      }),
    ];

    const repo = new WorkspaceRepo(env.dbPath);
    const savedWorkspace = repo.create({
      name: "Workspace",
      absPath: workspacePath,
      approvalPolicy: "on-request",
      sandboxMode: "danger-full-access",
    });

    const { app } = await createApp(env, { runtime, workspaceRepo: repo });
    await app.listen({ host: env.host, port: 0 });
    const port = getBoundPort(app);

    const health = await fetch(`http://${env.host}:${port}/api/health`).then((response) =>
      response.json(),
    );
    expect(health.status).toBe("ok");
    expect(health.runtime.connected).toBe(true);
    expect(health.codexCommand).toBe("codex");

    const bootstrap = await fetch(`http://${env.host}:${port}/api/bootstrap`).then((response) =>
      response.json(),
    );
    expect(bootstrap.account.email).toBe("user@example.com");
    expect(bootstrap.account.usageWindows).toEqual([
      expect.objectContaining({ label: "5h", remainingPercent: 75 }),
      expect.objectContaining({ label: "1w", remainingPercent: 48 }),
    ]);
    expect(bootstrap.models).toHaveLength(1);
    expect(bootstrap.workspaces).toHaveLength(3);
    expect(bootstrap.activeThreads).toHaveLength(3);
    expect(bootstrap.archivedThreadCount).toBe(1);
    expect(
      bootstrap.activeThreads
        .map((thread: { workspaceName: string | null }) => thread.workspaceName)
        .filter(Boolean)
        .sort(),
    ).toEqual(["Workspace", "derived-project", "outside-workspace"]);
    expect(
      bootstrap.activeThreads.find((thread: { id: string }) => thread.id === "thread-outside"),
    ).toMatchObject({
      workspaceId: "derived:/srv/outside-workspace",
      workspaceName: "outside-workspace",
    });

    const archivedPage = await fetch(
      `http://${env.host}:${port}/api/thread-summaries?archived=true&limit=1`,
    ).then((response) => response.json());
    expect(archivedPage.items).toHaveLength(1);
    expect(archivedPage.items[0].id).toBe("thread-archived");
    expect(archivedPage.nextCursor).toBeNull();

    const filteredArchivedPage = await fetch(
      `http://${env.host}:${port}/api/thread-summaries?archived=true&workspaceId=${savedWorkspace.id}`,
    ).then((response) => response.json());
    expect(filteredArchivedPage.items).toHaveLength(1);
    expect(filteredArchivedPage.items[0].workspaceId).toBe(savedWorkspace.id);

    const suggestions = await fetch(
      `http://${env.host}:${port}/api/workspace-path-suggestions?query=~/`,
    ).then((response) => response.json());
    expect(suggestions.homePath).toBe(homedir());
    expect(suggestions.withinHome).toBe(true);

    const dismissResponse = await fetch(`http://${env.host}:${port}/api/workspaces/dismiss`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ absPath: derivedWorkspacePath }),
    });
    expect(dismissResponse.status).toBe(204);

    const workspacesAfterDismiss = await fetch(`http://${env.host}:${port}/api/workspaces`).then(
      (response) => response.json(),
    );
    expect(workspacesAfterDismiss).toHaveLength(2);
    expect(workspacesAfterDismiss.map((workspace: { id: string }) => workspace.id)).toEqual(
      expect.arrayContaining(["derived:/srv/outside-workspace", savedWorkspace.id]),
    );

    const dismissOutsideResponse = await fetch(`http://${env.host}:${port}/api/workspaces/dismiss`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ absPath: "/srv/outside-workspace" }),
    });
    expect(dismissOutsideResponse.status).toBe(204);

    const workspacesAfterOutsideDismiss = await fetch(
      `http://${env.host}:${port}/api/workspaces`,
    ).then((response) => response.json());
    expect(workspacesAfterOutsideDismiss).toHaveLength(1);
    expect(workspacesAfterOutsideDismiss[0].id).toBe(savedWorkspace.id);

    const sessionAMessages: Array<AppServerMessage> = [];
    const sessionBMessages: Array<AppServerMessage> = [];
    const wsA = new WebSocket(`ws://${env.host}:${port}/ws?clientSessionId=session-a`);
    const wsB = new WebSocket(`ws://${env.host}:${port}/ws?clientSessionId=session-b`);
    wsA.on("message", (payload: WebSocket.RawData) => {
      sessionAMessages.push(JSON.parse(payload.toString()) as AppServerMessage);
    });
    wsB.on("message", (payload: WebSocket.RawData) => {
      sessionBMessages.push(JSON.parse(payload.toString()) as AppServerMessage);
    });

    await Promise.all([waitForOpen(wsA), waitForOpen(wsB)]);
    await waitFor(() => hasNotification(sessionAMessages, "runtime.statusChanged"));
    await waitFor(() => hasNotification(sessionBMessages, "runtime.statusChanged"));

    wsA.send(
      JSON.stringify({
        type: "client.call",
        id: "open-1",
        method: "thread.open",
        params: {
          workspaceId: savedWorkspace.id,
        },
      } satisfies AppClientMessage),
    );

    await waitFor(() => hasResponse(sessionAMessages, "open-1"));
    const openResponse = getResponse(sessionAMessages, "open-1");
    expect(openResponse?.result && "thread" in openResponse.result).toBe(true);

    wsA.send(
      JSON.stringify({
        type: "client.call",
        id: "git-read-1",
        method: "workspace.git.read",
        params: {
          workspaceId: savedWorkspace.id,
        },
      } satisfies AppClientMessage),
    );

    await waitFor(() => hasResponse(sessionAMessages, "git-read-1"));
    const gitReadResponse = getResponse(sessionAMessages, "git-read-1");
    expect(gitReadResponse?.result && "snapshot" in gitReadResponse.result).toBe(true);
    const gitSnapshot = (
      gitReadResponse?.result && "snapshot" in gitReadResponse.result
        ? gitReadResponse.result.snapshot
        : null
    ) as GitWorkingTreeSnapshot | null;
    expect(gitSnapshot?.workspaceId).toBe(savedWorkspace.id);

    wsA.send(
      JSON.stringify({
        type: "client.call",
        id: "git-file-read-1",
        method: "workspace.git.file.read",
        params: {
          workspaceId: savedWorkspace.id,
          path: "README.md",
        },
      } satisfies AppClientMessage),
    );

    await waitFor(() => hasResponse(sessionAMessages, "git-file-read-1"));
    const gitFileReadResponse = getResponse(sessionAMessages, "git-file-read-1");
    expect(gitFileReadResponse?.result && "detail" in gitFileReadResponse.result).toBe(true);
    expect(
      gitFileReadResponse?.result &&
        "detail" in gitFileReadResponse.result &&
        gitFileReadResponse.result.detail.mode === "inline-diff"
        ? gitFileReadResponse.result.detail.modifiedText
        : null,
    ).toContain("new");

    const openedThreadId = runtime.activeThreads[0]?.id;
    expect(openedThreadId).toBeTruthy();

    const approval: PendingApproval = {
      id: "approval-1",
      kind: "commandExecutionApproval",
      method: "item/commandExecution/requestApproval",
      threadId: openedThreadId ?? null,
      turnId: null,
      itemId: null,
      params: {
        command: "rm -rf .",
      },
    };
    runtime.emit({
      type: "approval.requested",
      approval,
    });

    await waitFor(() =>
      sessionAMessages.some(
        (message) =>
          message.type === "server.notification" &&
          message.method === "approval.requested" &&
          message.params.approval.id === approval.id,
      ),
    );
    await delay(100);
    expect(
      sessionBMessages.some(
        (message) =>
          message.type === "server.notification" &&
          message.method === "approval.requested" &&
          message.params.approval.id === approval.id,
      ),
    ).toBe(false);

    wsA.send(
      JSON.stringify({
        type: "client.call",
        id: "approval-resolve-1",
        method: "approval.resolve",
        params: {
          requestId: approval.id,
          decision: "accept",
        },
      } satisfies AppClientMessage),
    );

    await waitFor(() => runtime.approvalResolutions.length === 1);
    expect(runtime.approvalResolutions[0]).toEqual({
      approval,
      decision: "accept",
    });

    runtime.emit({
      type: "diff.updated",
      threadId: "thread-1",
      diff: "diff --git a/README.md b/README.md\n+changed",
    });

    await waitFor(() =>
      sessionAMessages.some(
        (message) =>
          message.type === "server.notification" &&
          message.method === "workspace.git.updated" &&
          message.params.snapshot.workspaceId === savedWorkspace.id,
        ),
    );

    wsA.send(
      JSON.stringify({
        type: "client.call",
        id: "thread-list-1",
        method: "thread.list",
        params: {
          archived: false,
          limit: 20,
        },
      } satisfies AppClientMessage),
    );

    await waitFor(() => hasResponse(sessionAMessages, "thread-list-1"));
    const threadListResponse = getResponse(sessionAMessages, "thread-list-1");
    expect(
      threadListResponse?.result &&
        "items" in threadListResponse.result &&
        threadListResponse.result.items.some((thread) => thread.id === openedThreadId),
    ).toBe(true);

    wsA.send(
      JSON.stringify({
        type: "client.call",
        id: "thread-read-1",
        method: "thread.read",
        params: {
          threadId: openedThreadId,
        },
      } satisfies AppClientMessage),
    );

    await waitFor(() => hasResponse(sessionAMessages, "thread-read-1"));
    const threadReadResponse = getResponse(sessionAMessages, "thread-read-1");
    expect(
      threadReadResponse?.result &&
        "thread" in threadReadResponse.result &&
        threadReadResponse.result.thread.thread.id === openedThreadId,
    ).toBe(true);

    wsA.send(
      JSON.stringify({
        type: "client.call",
        id: "thread-meta-1",
        method: "thread.metadata.update",
        params: {
          threadId: openedThreadId,
          gitInfo: {
            branch: "feature/parity",
          },
        },
      } satisfies AppClientMessage),
    );

    await waitFor(() => hasResponse(sessionAMessages, "thread-meta-1"));
    const threadMetaResponse = getResponse(sessionAMessages, "thread-meta-1");
    expect(
      threadMetaResponse?.result &&
        "thread" in threadMetaResponse.result &&
        threadMetaResponse.result.thread.thread.gitInfo,
    ).toMatchObject({ branch: "feature/parity" });

    wsA.send(
      JSON.stringify({
        type: "client.call",
        id: "thread-unsubscribe-1",
        method: "thread.unsubscribe",
        params: {
          threadId: openedThreadId,
        },
      } satisfies AppClientMessage),
    );

    await waitFor(() => hasResponse(sessionAMessages, "thread-unsubscribe-1"));
    const threadUnsubscribeResponse = getResponse(sessionAMessages, "thread-unsubscribe-1");
    expect(
      threadUnsubscribeResponse?.result &&
        "status" in threadUnsubscribeResponse.result &&
        threadUnsubscribeResponse.result.status,
    ).toBe("unsubscribed");
    await waitFor(() =>
      sessionAMessages.some(
        (message) =>
          message.type === "server.notification" &&
          message.method === "thread.closed" &&
          message.params.threadId === openedThreadId,
      ),
    );

    wsA.close();
    wsB.close();
    await app.close();
  });

  it("rejects workspace creation outside the current home directory", async () => {
    const env: AppEnv = {
      host: "127.0.0.1",
      port: 0,
      codexCommand: "codex",
      dataDir: tempDir,
      dbPath: join(tempDir, "app.sqlite"),
      webDistDir: join(tempDir, "missing-web"),
    };

    const { app } = await createApp(env, {
      runtime: new FakeRuntime(),
      workspaceRepo: new WorkspaceRepo(env.dbPath),
    });
    await app.listen({ host: env.host, port: 0 });
    const port = getBoundPort(app);

    const response = await fetch(`http://${env.host}:${port}/api/workspaces`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Outside",
        absPath: "/tmp",
      }),
    });

    expect(response.ok).toBe(false);
    expect(await response.text()).toContain("must stay inside");
    await app.close();
  });

  it("handles account websocket rpc flows", async () => {
    const env: AppEnv = {
      host: "127.0.0.1",
      port: 0,
      codexCommand: "codex",
      dataDir: tempDir,
      dbPath: join(tempDir, "app.sqlite"),
      webDistDir: join(tempDir, "missing-web"),
    };

    const runtime = new FakeRuntime();
    const { app } = await createApp(env, {
      runtime,
      workspaceRepo: new WorkspaceRepo(env.dbPath),
    });
    await app.listen({ host: env.host, port: 0 });
    const port = getBoundPort(app);

    const messages: Array<AppServerMessage> = [];
    const ws = new WebSocket(`ws://${env.host}:${port}/ws?clientSessionId=account-session`);
    ws.on("message", (payload: WebSocket.RawData) => {
      messages.push(JSON.parse(payload.toString()) as AppServerMessage);
    });

    await waitForOpen(ws);
    await waitFor(() => hasNotification(messages, "runtime.statusChanged"));

    ws.send(
      JSON.stringify({
        type: "client.call",
        id: "account-read",
        method: "account.read",
        params: {},
      } satisfies AppClientMessage),
    );
    await waitFor(() => hasResponse(messages, "account-read"));
    const readResponse = getResponse(messages, "account-read");
    expect(readResponse?.result && "state" in readResponse.result).toBe(true);
    expect(
      readResponse?.result && "state" in readResponse.result
        ? readResponse.result.state.account.email
        : null,
    ).toBe("user@example.com");

    ws.send(
      JSON.stringify({
        type: "client.call",
        id: "account-chatgpt-login",
        method: "account.login.start",
        params: { type: "chatgpt" },
      } satisfies AppClientMessage),
    );
    await waitFor(() => hasResponse(messages, "account-chatgpt-login"));
    const chatgptLogin = getResponse(messages, "account-chatgpt-login");
    expect(chatgptLogin?.result && "login" in chatgptLogin.result).toBe(true);
    expect(
      chatgptLogin?.result && "login" in chatgptLogin.result && chatgptLogin.result.login.type === "chatgpt"
        ? chatgptLogin.result.login.authUrl
        : null,
    ).toBe("https://example.com/login");

    ws.send(
      JSON.stringify({
        type: "client.call",
        id: "account-device-code-login",
        method: "account.login.start",
        params: { type: "deviceCode" },
      } satisfies AppClientMessage),
    );
    await waitFor(() => hasResponse(messages, "account-device-code-login"));
    const deviceCodeLogin = getResponse(messages, "account-device-code-login");
    expect(deviceCodeLogin?.result && "login" in deviceCodeLogin.result).toBe(true);
    expect(
      deviceCodeLogin?.result &&
        "login" in deviceCodeLogin.result &&
        deviceCodeLogin.result.login.type === "deviceCode"
        ? deviceCodeLogin.result.login.userCode
        : null,
    ).toBe("ABCD-EFGH");

    ws.send(
      JSON.stringify({
        type: "client.call",
        id: "account-login-cancel",
        method: "account.login.cancel",
        params: { loginId: "login-123" },
      } satisfies AppClientMessage),
    );
    await waitFor(() => hasResponse(messages, "account-login-cancel"));
    const cancelResponse = getResponse(messages, "account-login-cancel");
    expect(cancelResponse?.result && "status" in cancelResponse.result).toBe(true);
    expect(
      cancelResponse?.result && "status" in cancelResponse.result
        ? cancelResponse.result.status
        : null,
    ).toBe("canceled");

    ws.send(
      JSON.stringify({
        type: "client.call",
        id: "account-api-login",
        method: "account.login.start",
        params: { type: "apiKey", apiKey: "sk-test" },
      } satisfies AppClientMessage),
    );
    await waitFor(() => hasResponse(messages, "account-api-login"));
    const apiLogin = getResponse(messages, "account-api-login");
    expect(apiLogin?.result && "state" in apiLogin.result).toBe(true);
    expect(
      apiLogin?.result && "state" in apiLogin.result
        ? apiLogin.result.state.account.accountType
        : null,
    ).toBe("apiKey");
    expect(
      apiLogin?.result && "state" in apiLogin.result
        ? apiLogin.result.state.authStatus?.authMethod
        : null,
    ).toBe("apikey");

    ws.send(
      JSON.stringify({
        type: "client.call",
        id: "account-logout",
        method: "account.logout",
        params: {},
      } satisfies AppClientMessage),
    );
    await waitFor(() => hasResponse(messages, "account-logout"));
    const logoutResponse = getResponse(messages, "account-logout");
    expect(logoutResponse?.result && "state" in logoutResponse.result).toBe(true);
    expect(
      logoutResponse?.result && "state" in logoutResponse.result
        ? logoutResponse.result.state.account.authenticated
        : true,
    ).toBe(false);

    ws.close();
    await app.close();
  });

  it("handles extensions and capability websocket rpc flows", async () => {
    const env: AppEnv = {
      host: "127.0.0.1",
      port: 0,
      codexCommand: "codex",
      dataDir: tempDir,
      dbPath: join(tempDir, "app.sqlite"),
      webDistDir: join(tempDir, "missing-web"),
    };

    const runtime = new FakeRuntime();
    const { app } = await createApp(env, {
      runtime,
      workspaceRepo: new WorkspaceRepo(env.dbPath),
    });
    await app.listen({ host: env.host, port: 0 });
    const port = getBoundPort(app);

    const messages: Array<AppServerMessage> = [];
    const ws = new WebSocket(`ws://${env.host}:${port}/ws?clientSessionId=extensions-session`);
    ws.on("message", (payload: WebSocket.RawData) => {
      messages.push(JSON.parse(payload.toString()) as AppServerMessage);
    });

    await waitForOpen(ws);
    await waitFor(() => hasNotification(messages, "runtime.statusChanged"));

    const send = <TMethod extends AppClientMessage["method"]>(
      id: string,
      method: TMethod,
      params: Extract<AppClientMessage, { method: TMethod }>["params"],
    ) => {
      ws.send(
        JSON.stringify({
          type: "client.call",
          id,
          method,
          params,
        } as AppClientMessage),
      );
    };

    send("mcp-list", "mcpServerStatus.list", {});
    await waitFor(() => hasResponse(messages, "mcp-list"));
    const mcpListResult = getResponse(messages, "mcp-list")?.result as
      | { servers: Array<{ name: string }> }
      | undefined;
    expect(mcpListResult?.servers[0]?.name).toBe("filesystem");

    send("skills-list", "skills.list", {});
    await waitFor(() => hasResponse(messages, "skills-list"));
    const skillsListResult = getResponse(messages, "skills-list")?.result as
      | { skills: Array<{ skills: Array<{ name: string }> }> }
      | undefined;
    expect(skillsListResult?.skills[0]?.skills[0]?.name).toBe("lint");

    send("skills-remote-list", "skills.remote.list", {
      hazelnutScope: "personal",
      productSurface: "codex",
      enabled: true,
    });
    await waitFor(() => hasResponse(messages, "skills-remote-list"));
    const remoteSkillsResult = getResponse(messages, "skills-remote-list")?.result as
      | { skills: Array<{ id: string }> }
      | undefined;
    expect(remoteSkillsResult?.skills[0]?.id).toBe("remote-lint");

    send("skills-remote-export", "skills.remote.export", {
      hazelnutId: "remote-lint",
    });
    await waitFor(() => hasResponse(messages, "skills-remote-export"));
    const exportResult = getResponse(messages, "skills-remote-export")?.result as
      | { skill: { path: string } }
      | undefined;
    expect(exportResult?.skill.path).toContain("remote-lint");

    send("skills-config-write", "skills.config.write", {
      path: "/workspace/.codex/skills/remote-lint",
      enabled: false,
    });
    await waitFor(() => hasResponse(messages, "skills-config-write"));
    const configWriteResult = getResponse(messages, "skills-config-write")?.result as
      | { effectiveEnabled: boolean }
      | undefined;
    expect(configWriteResult?.effectiveEnabled).toBe(false);

    send("plugin-list", "plugin.list", {});
    await waitFor(() => hasResponse(messages, "plugin-list"));
    const pluginListResult = getResponse(messages, "plugin-list")?.result as
      | { marketplaces: Array<{ plugins: Array<{ installed: boolean }> }> }
      | undefined;
    expect(pluginListResult?.marketplaces[0]?.plugins[0]?.installed).toBe(false);

    send("plugin-install", "plugin.install", {
      marketplacePath: "/plugins/official",
      pluginName: "github-plugin",
    });
    await waitFor(() => hasResponse(messages, "plugin-install"));
    const pluginInstallResult = getResponse(messages, "plugin-install")?.result as
      | { appsNeedingAuth: Array<{ id: string }> }
      | undefined;
    expect(pluginInstallResult?.appsNeedingAuth[0]?.id).toBe("github");

    send("plugin-uninstall", "plugin.uninstall", {
      pluginId: "github-plugin",
    });
    await waitFor(() => hasResponse(messages, "plugin-uninstall"));
    const pluginUninstallResult = getResponse(messages, "plugin-uninstall")?.result as
      | { marketplaces: Array<{ plugins: Array<{ installed: boolean }> }> }
      | undefined;
    expect(pluginUninstallResult?.marketplaces[0]?.plugins[0]?.installed).toBe(false);

    send("app-list", "app.list", {
      threadId: null,
      forceRefetch: true,
    });
    await waitFor(() => hasResponse(messages, "app-list"));
    const appListResult = getResponse(messages, "app-list")?.result as
      | { apps: Array<{ id: string }> }
      | undefined;
    expect(appListResult?.apps[0]?.id).toBe("github");

    runtime.emit({ type: "skills.changed" });
    runtime.emit({
      type: "app.list.updated",
      apps: [
        {
          id: "slack",
          name: "Slack",
          description: "Notifier",
          isAccessible: true,
          isEnabled: true,
          pluginDisplayNames: ["slack-plugin"],
          installUrl: "https://example.com/slack",
        },
      ],
    });

    await waitFor(() => hasNotification(messages, "skills.changed"));
    await waitFor(() => hasNotification(messages, "app.listUpdated"));

    const appListUpdated = messages.find(
      (message) =>
        message.type === "server.notification" && message.method === "app.listUpdated",
    );
    expect(
      appListUpdated &&
        appListUpdated.type === "server.notification" &&
        appListUpdated.method === "app.listUpdated"
        ? appListUpdated.params.apps[0]?.id
        : null,
    ).toBe("slack");

    ws.close();
    await app.close();
  });

  it("serves home-scoped local resources for the web client", async () => {
    const mediaPath = join(tempDir, "preview.png");
    writeFileSync(mediaPath, Buffer.from("png-bytes"));

    const env: AppEnv = {
      host: "127.0.0.1",
      port: 0,
      codexCommand: "codex",
      dataDir: tempDir,
      dbPath: join(tempDir, "app.sqlite"),
      webDistDir: join(tempDir, "missing-web"),
    };

    const { app } = await createApp(env, {
      runtime: new FakeRuntime(),
      workspaceRepo: new WorkspaceRepo(env.dbPath),
    });
    await app.listen({ host: env.host, port: 0 });
    const port = getBoundPort(app);

    const response = await fetch(
      `http://${env.host}:${port}/api/resource?path=${encodeURIComponent(mediaPath)}`,
    );
    const body = Buffer.from(await response.arrayBuffer());

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("image/png");
    expect(body.toString()).toBe("png-bytes");

    await app.close();
  });

  it("serves thread-scoped local resources outside the home directory", async () => {
    const threadRoot = mkdtempSync(join(tmpdir(), "webcli-resource-"));
    const mediaPath = join(threadRoot, "preview.png");
    writeFileSync(mediaPath, Buffer.from("png-bytes"));

    const env: AppEnv = {
      host: "127.0.0.1",
      port: 0,
      codexCommand: "codex",
      dataDir: tempDir,
      dbPath: join(tempDir, "app.sqlite"),
      webDistDir: join(tempDir, "missing-web"),
    };

    const runtime = new FakeRuntime();
    runtime.activeThreads = [
      makeRuntimeThread(threadRoot, {
        id: "thread-outside-home",
        name: "Outside home",
        createdAt: 1,
        updatedAt: 1,
      }),
    ];

    const { app } = await createApp(env, {
      runtime,
      workspaceRepo: new WorkspaceRepo(env.dbPath),
    });

    try {
      await app.listen({ host: env.host, port: 0 });
      const port = getBoundPort(app);

      const response = await fetch(
        `http://${env.host}:${port}/api/resource?path=${encodeURIComponent(mediaPath)}`,
      );
      const body = Buffer.from(await response.arrayBuffer());

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("image/png");
      expect(body.toString()).toBe("png-bytes");
    } finally {
      await app.close();
      rmSync(threadRoot, { recursive: true, force: true });
    }
  });

  it("refreshes cached thread summaries after the runtime reconnects", async () => {
    const workspacePath = join(tempDir, "workspace");
    mkdirSync(workspacePath, { recursive: true });

    const env: AppEnv = {
      host: "127.0.0.1",
      port: 0,
      codexCommand: "codex",
      dataDir: tempDir,
      dbPath: join(tempDir, "app.sqlite"),
      webDistDir: join(tempDir, "missing-web"),
    };

    const runtime = new FakeRuntime();
    const { app } = await createApp(env, {
      runtime,
      workspaceRepo: new WorkspaceRepo(env.dbPath),
    });

    try {
      await app.listen({ host: env.host, port: 0 });
      const port = getBoundPort(app);

      const initialBootstrap = await fetch(`http://${env.host}:${port}/api/bootstrap`).then(
        (response) => response.json(),
      );
      expect(initialBootstrap.activeThreads).toHaveLength(0);
      expect(initialBootstrap.archivedThreadCount).toBe(0);

      setTimeout(() => {
        runtime.activeThreads = [
          makeRuntimeThread(workspacePath, {
            id: "thread-recovered",
            name: "Recovered",
            createdAt: 10,
            updatedAt: 11,
          }),
        ];
        runtime.archivedThreads = [
          makeRuntimeThread(workspacePath, {
            id: "thread-archived-recovered",
            name: "Recovered archived",
            archived: true,
            createdAt: 8,
            updatedAt: 9,
          }),
        ];
      }, 50);

      runtime.status = {
        ...runtime.status,
        restartCount: runtime.status.restartCount + 1,
      };
      runtime.emit({
        type: "status.changed",
        status: runtime.status,
      });

      await waitForAsync(async () => {
        const recoveredBootstrap = await fetch(`http://${env.host}:${port}/api/bootstrap`).then(
          (response) => response.json(),
        );
        return (
          recoveredBootstrap.activeThreads.length === 1 &&
          recoveredBootstrap.activeThreads[0].id === "thread-recovered" &&
          recoveredBootstrap.archivedThreadCount === 1
        );
      }, 3000);
    } finally {
      await app.close();
    }
  });
});

function makeRuntimeThread(
  cwd: string,
  input: {
    id: string;
    name: string | null;
    createdAt: number;
    updatedAt: number;
    archived?: boolean;
    approvalPolicy?: ApprovalPolicy;
    sandboxMode?: SandboxMode;
  },
): RuntimeThreadRecord {
  return {
    id: input.id,
    name: input.name,
    preview: input.name ?? "Preview",
    archived: input.archived ?? false,
    cwd,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    status: { type: "idle" },
    modelProvider: "openai",
    source: "appServer",
    agentNickname: null,
    agentRole: null,
    gitInfo: null,
    path: null,
    ephemeral: false,
    turns: [],
  };
}

function makeGitSnapshot(
  workspaceId: string,
  workspaceName: string,
  cwd: string,
  branch: string,
): GitWorkingTreeSnapshot {
  return {
    workspaceId,
    workspaceName,
    repoRoot: cwd,
    branch,
    isGitRepository: true,
    clean: false,
    stagedCount: 1,
    unstagedCount: 1,
    untrackedCount: 0,
    generatedAt: Date.now(),
    files: [
      {
        path: "README.md",
        status: "modified",
        staged: true,
        unstaged: true,
        additions: 2,
        deletions: 1,
        patch: "diff --git a/README.md b/README.md\n@@ -1 +1,2 @@\n-old\n+new\n+line",
        oldPath: null,
      },
    ],
  };
}

function makeGitFileReviewDetail(file: GitWorkingTreeFile): GitFileReviewDetail {
  if (file.path === "README.md") {
    return {
      path: file.path,
      oldPath: file.oldPath ?? null,
      status: file.status,
      language: "markdown",
      mode: "inline-diff",
      originalText: "old\n",
      modifiedText: "new\nline\n",
    };
  }

  return {
    path: file.path,
    oldPath: file.oldPath ?? null,
    status: file.status,
    language: "plaintext",
    mode: "patch",
    patch: file.patch,
    reason: "Patch fallback",
  };
}

function getBoundPort(app: Awaited<ReturnType<typeof createApp>>["app"]): number {
  const address = app.server.address();
  return typeof address === "object" && address ? address.port : 0;
}

function hasNotification(messages: Array<AppServerMessage>, method: string): boolean {
  return messages.some(
    (message) => message.type === "server.notification" && message.method === method,
  );
}

function hasResponse(messages: Array<AppServerMessage>, id: string): boolean {
  return messages.some((message) => message.type === "server.response" && message.id === id);
}

function getResponse(messages: Array<AppServerMessage>, id: string) {
  return messages.find(
    (message): message is Extract<AppServerMessage, { type: "server.response" }> =>
      message.type === "server.response" && message.id === id,
  );
}

async function waitForOpen(socket: WebSocket): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", reject);
  });
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("Timed out waiting for condition");
    }
    await delay(10);
  }
}

async function waitForAsync(predicate: () => Promise<boolean>, timeoutMs = 1000): Promise<void> {
  const startedAt = Date.now();
  while (!(await predicate())) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("Timed out waiting for condition");
    }
    await delay(10);
  }
}
