import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import type {
  AccountResponse,
  BridgeStatus,
  ClientWsMessage,
  Model,
  ServerWsMessage,
  Thread,
} from "@webcli/codex-protocol";
import { createApp, type BridgeClient } from "../src/app.js";
import type { AppEnv } from "../src/env.js";
import { WorkspaceRepo } from "../src/workspace-repo.js";

class FakeBridge implements BridgeClient {
  messages: Array<ClientWsMessage> = [];
  connections = new Map<string, (message: ServerWsMessage) => void>();
  listThreadFilters: Array<boolean | "all" | undefined> = [];
  status: BridgeStatus = {
    connected: true,
    childPid: 123,
    authenticated: true,
    requiresOpenaiAuth: true,
    restartCount: 0,
    lastError: null,
  };
  account: AccountResponse = {
    authenticated: true,
    requiresOpenaiAuth: true,
    accountType: "chatgpt",
    email: "user@example.com",
    planType: "pro",
  };
  models: Array<Model> = [];
  activeThreads: Array<Thread> = [];
  archivedThreads: Array<Thread> = [];

  async start(): Promise<void> {}
  async stop(): Promise<void> {}
  getStatus(): BridgeStatus {
    return this.status;
  }
  async getAccountSummary(): Promise<AccountResponse> {
    return this.account;
  }
  async listModels(): Promise<Array<Model>> {
    return this.models;
  }
  async listThreads(archived: boolean | "all" = false): Promise<Array<Thread>> {
    this.listThreadFilters.push(archived);

    if (archived === "all") {
      return [...this.activeThreads, ...this.archivedThreads];
    }

    return archived ? this.archivedThreads : this.activeThreads;
  }
  registerConnection(connectionId: string, sender: (message: ServerWsMessage) => void): void {
    this.connections.set(connectionId, sender);
    sender({
      type: "server.notification",
      method: "server.status",
      params: this.status,
    });
  }
  unregisterConnection(connectionId: string): void {
    this.connections.delete(connectionId);
  }
  async handleClientMessage(_connectionId: string, message: ClientWsMessage): Promise<void> {
    this.messages.push(message);
  }

  broadcast(message: ServerWsMessage): void {
    for (const sender of this.connections.values()) {
      sender(message);
    }
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
  it("serves REST APIs and forwards websocket traffic", async () => {
    const workspacePath = join(tempDir, "workspace");
    const derivedWorkspacePath = join(tempDir, "derived-project");
    mkdirSync(workspacePath, { recursive: true });

    const env: AppEnv = {
      host: "127.0.0.1",
      port: 0,
      codexCommand: "codex",
      dataDir: tempDir,
      dbPath: join(tempDir, "app.sqlite"),
      webDistDir: join(tempDir, "missing-web"),
    };
    const bridge = new FakeBridge();
    bridge.activeThreads = [
      {
        id: "thread-1",
        preview: "Preview",
        ephemeral: false,
        modelProvider: "openai",
        createdAt: 1,
        updatedAt: 2,
        status: { type: "idle" },
        path: null,
        cwd: workspacePath,
        cliVersion: "0.111.0",
        source: "appServer",
        agentNickname: null,
        agentRole: null,
        gitInfo: null,
        name: "Thread",
        turns: [],
      },
      {
        id: "thread-outside",
        preview: "Outside workspace",
        ephemeral: false,
        modelProvider: "openai",
        createdAt: 5,
        updatedAt: 6,
        status: { type: "idle" },
        path: null,
        cwd: "/tmp/outside-workspace",
        cliVersion: "0.111.0",
        source: "appServer",
        agentNickname: null,
        agentRole: null,
        gitInfo: null,
        name: "Outside",
        turns: [],
      },
      {
        id: "thread-derived",
        preview: "Derived project",
        ephemeral: false,
        modelProvider: "openai",
        createdAt: 7,
        updatedAt: 8,
        status: { type: "idle" },
        path: null,
        cwd: derivedWorkspacePath,
        cliVersion: "0.111.0",
        source: "appServer",
        agentNickname: null,
        agentRole: null,
        gitInfo: null,
        name: "Derived",
        turns: [],
      },
    ];
    bridge.archivedThreads = [
      {
        id: "thread-2",
        preview: "Archived preview",
        ephemeral: false,
        modelProvider: "openai",
        createdAt: 3,
        updatedAt: 4,
        status: { type: "idle" },
        path: null,
        cwd: workspacePath,
        cliVersion: "0.111.0",
        source: "appServer",
        agentNickname: null,
        agentRole: null,
        gitInfo: null,
        name: "Archived thread",
        turns: [],
      },
    ];
    const repo = new WorkspaceRepo(env.dbPath);
    repo.create({
      name: "Workspace",
      absPath: workspacePath,
      approvalPolicy: "on-request",
      sandboxMode: "danger-full-access",
    });

    const { app } = await createApp(env, { bridge, workspaceRepo: repo });
    await app.listen({ host: env.host, port: 0 });
    const address = app.server.address();
    const port = typeof address === "object" && address ? address.port : 0;

    const health = await fetch(`http://${env.host}:${port}/api/health`).then((response) =>
      response.json(),
    );
    expect(health.bridge.connected).toBe(true);

    const pathSuggestions = await fetch(
      `http://${env.host}:${port}/api/workspace-path-suggestions?query=~/`,
    ).then((response) => response.json());
    expect(pathSuggestions.homePath).toBe(homedir());
    expect(pathSuggestions.withinHome).toBe(true);

    const workspaces = await fetch(`http://${env.host}:${port}/api/workspaces`).then((response) =>
      response.json(),
    );
    expect(workspaces).toHaveLength(2);
    expect(workspaces[0].source).toBe("saved");
    expect(workspaces[1].source).toBe("derived");
    expect(workspaces[1].absPath).toBe(derivedWorkspacePath);

    const threads = await fetch(
      `http://${env.host}:${port}/api/threads?workspaceId=all`,
    ).then((response) => response.json());
    expect(threads.data).toHaveLength(2);
    expect(threads.data.every((thread: { archived: boolean }) => thread.archived === false)).toBe(
      true,
    );
    expect(
      threads.data.map((thread: { workspaceName: string }) => thread.workspaceName).sort(),
    ).toEqual(["Workspace", "derived-project"]);
    expect(bridge.listThreadFilters).toContain(false);

    const archivedThreads = await fetch(
      `http://${env.host}:${port}/api/threads?workspaceId=all&archived=true`,
    ).then((response) => response.json());
    expect(archivedThreads.data).toHaveLength(1);
    expect(archivedThreads.data[0].id).toBe("thread-2");
    expect(archivedThreads.data[0].archived).toBe(true);

    const allThreads = await fetch(
      `http://${env.host}:${port}/api/threads?workspaceId=all&archived=all`,
    ).then((response) => response.json());
    expect(allThreads.data).toHaveLength(3);
    expect(bridge.listThreadFilters).toContain(true);
    expect(bridge.listThreadFilters.filter((value) => value === false)).not.toHaveLength(0);

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
    expect(workspacesAfterDismiss[0].absPath).toBe(workspacePath);

    const ws = new WebSocket(`ws://${env.host}:${port}/ws`);
    const received = await new Promise<Array<ServerWsMessage>>((resolve, reject) => {
      const messages: Array<ServerWsMessage> = [];
      ws.on("message", (payload: WebSocket.RawData) => {
        messages.push(JSON.parse(payload.toString()) as ServerWsMessage);
        if (messages.length === 2) {
          resolve(messages);
        }
      });
      ws.on("open", () => {
        ws.send(
          JSON.stringify({
            type: "client.call",
            id: "client-1",
            method: "thread/read",
            params: {
              threadId: "thread-1",
              includeTurns: true,
            },
          } satisfies ClientWsMessage),
        );

        bridge.broadcast({
          type: "server.notification",
          method: "thread/started",
          params: {
            thread: bridge.activeThreads[0],
          },
        });
      });
      ws.on("error", reject);
    });

    expect(received[0].type).toBe("server.notification");
    await waitFor(() => bridge.messages.length === 1);
    ws.close();
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
      bridge: new FakeBridge(),
      workspaceRepo: new WorkspaceRepo(env.dbPath),
    });
    await app.listen({ host: env.host, port: 0 });
    const address = app.server.address();
    const port = typeof address === "object" && address ? address.port : 0;

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
});

async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("Timed out waiting for condition");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
