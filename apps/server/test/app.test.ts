import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import type {
  AccountSummary,
  AppClientMessage,
  AppServerMessage,
  ApprovalPolicy,
  ConfigSnapshot,
  FuzzySearchSnapshot,
  IntegrationSnapshot,
  ModelOption,
  PendingApproval,
  ReasoningEffort,
  RuntimeStatus,
  SandboxMode,
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
    approvalPolicy: "on-request",
    sandboxMode: "danger-full-access",
  };

  activeThreads: Array<RuntimeThreadRecord> = [];
  archivedThreads: Array<RuntimeThreadRecord> = [];
  nextThreadId = 1;

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

  async listModels(): Promise<Array<ModelOption>> {
    return [...this.models];
  }

  async listThreads(archived: boolean): Promise<Array<RuntimeThreadRecord>> {
    return archived ? [...this.archivedThreads] : [...this.activeThreads];
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
    const thread =
      this.activeThreads.find((entry) => entry.id === threadId) ??
      this.archivedThreads.find((entry) => entry.id === threadId);
    if (!thread) {
      throw new Error("Thread not found");
    }
    return thread;
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
    return {
      authStatus: {
        authMethod: "chatgpt",
        requiresOpenaiAuth: false,
      },
      config: { ...this.config },
      mcpServers: [],
      skills: [],
      apps: [],
      plugins: [],
    };
  }

  async saveSettings(input: ConfigSnapshot): Promise<void> {
    this.config = { ...input };
  }

  async loginMcp(): Promise<string> {
    return "https://example.com/auth";
  }

  async reloadMcp(): Promise<void> {}
  async uninstallPlugin(): Promise<void> {}

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
      makeRuntimeThread("/tmp/outside-workspace", {
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
    expect(bootstrap.models).toHaveLength(1);
    expect(bootstrap.workspaces).toHaveLength(2);
    expect(bootstrap.activeThreads).toHaveLength(3);
    expect(bootstrap.archivedThreads).toHaveLength(1);
    expect(bootstrap.loadedThreadIds).toEqual(
      bootstrap.activeThreads.map((thread: { id: string }) => thread.id),
    );
    expect(
      bootstrap.activeThreads
        .map((thread: { workspaceName: string | null }) => thread.workspaceName)
        .filter(Boolean)
        .sort(),
    ).toEqual(["Workspace", "derived-project"]);

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
    expect(workspacesAfterDismiss).toHaveLength(1);
    expect(workspacesAfterDismiss[0].id).toBe(savedWorkspace.id);

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

    const openedThreadId = runtime.activeThreads[0]?.id;
    expect(openedThreadId).toBeTruthy();

    const approval: PendingApproval = {
      id: "approval-1",
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
