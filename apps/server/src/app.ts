import { existsSync, mkdirSync } from "node:fs";
import Fastify, { type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import type {
  AccountResponse,
  BridgeStatus,
  ClientWsMessage,
  HealthResponse,
  Model,
  ModelsResponse,
  PathSuggestionsResponse,
  ThreadsResponse,
  WorkspaceCreateInput,
  WorkspaceDismissInput,
  WorkspaceUpdateInput,
} from "@webcli/codex-protocol";
import { buildWorkspaceCatalog, decorateThread } from "./path-utils.js";
import { WorkspaceRepo } from "./workspace-repo.js";
import { CodexBridge } from "./codex-bridge.js";
import type { AppEnv } from "./env.js";
import {
  ensureHomeScopedDirectory,
  ensureHomeScopedPath,
  listHomePathSuggestions,
  resolveHomeDirectory,
} from "./home-paths.js";

export type BridgeClient = {
  start(): Promise<void>;
  stop(): Promise<void>;
  getStatus(): BridgeStatus;
  getAccountSummary(force?: boolean): Promise<AccountResponse>;
  listModels(): Promise<Array<Model>>;
  listThreads(
    archived?: boolean | "all",
  ): Promise<Array<import("@webcli/codex-protocol").Thread>>;
  registerConnection(connectionId: string, sender: (message: unknown) => void): void;
  unregisterConnection(connectionId: string): void;
  handleClientMessage(connectionId: string, message: ClientWsMessage): Promise<void>;
};

type AppContext = {
  app: FastifyInstance;
  bridge: BridgeClient;
  workspaceRepo: WorkspaceRepo;
};

export async function createApp(
  env: AppEnv,
  overrides?: { bridge?: BridgeClient; workspaceRepo?: WorkspaceRepo },
): Promise<AppContext> {
  mkdirSync(env.dataDir, { recursive: true });
  const homePath = resolveHomeDirectory();
  const app = Fastify({ logger: false });
  const bridge =
    overrides?.bridge ?? new CodexBridge({ codexCommand: env.codexCommand });
  const workspaceRepo = overrides?.workspaceRepo ?? new WorkspaceRepo(env.dbPath);

  app.addHook("onClose", async () => {
    await bridge.stop();
    workspaceRepo.close();
  });

  await bridge.start();
  await app.register(fastifyWebsocket);

  const webDistExists = existsSync(env.webDistDir);
  if (webDistExists) {
    await app.register(fastifyStatic, {
      root: env.webDistDir,
      prefix: "/",
      wildcard: false,
      index: false,
    });
  }

  app.get("/api/health", async () => {
    const response: HealthResponse = {
      status: "ok",
      bridge: bridge.getStatus(),
      codexCommand: env.codexCommand,
    };
    return response;
  });

  app.get("/api/account", async () => {
    const response: AccountResponse = await bridge.getAccountSummary(true);
    return response;
  });

  app.get("/api/models", async () => {
    const response: ModelsResponse = {
      data: await bridge.listModels(),
    };
    return response;
  });

  app.get("/api/workspaces", async () => {
    const savedWorkspaces = workspaceRepo.list();
    const ignoredPaths = workspaceRepo.listIgnoredPaths();
    const snapshot = await loadThreadSnapshot(bridge);
    return buildWorkspaceCatalog(savedWorkspaces, snapshot.allThreads, homePath, ignoredPaths);
  });
  app.get("/api/workspace-path-suggestions", async (request) => {
    const query = request.query as { query?: string };
    const response: PathSuggestionsResponse = listHomePathSuggestions(query.query, homePath);
    return response;
  });

  app.post("/api/workspaces", async (request, reply) => {
    try {
      const payload = request.body as WorkspaceCreateInput;
      const normalized = validateWorkspaceInput(payload, homePath);
      const created = workspaceRepo.create(normalized);
      reply.code(201);
      return created;
    } catch (error) {
      reply.code(400);
      return { message: error instanceof Error ? error.message : "Invalid workspace payload" };
    }
  });

  app.post("/api/workspaces/dismiss", async (request, reply) => {
    try {
      const payload = request.body as WorkspaceDismissInput;
      const absPath = ensureHomeScopedPath(payload.absPath, homePath);
      workspaceRepo.ignorePath(absPath);
      reply.code(204);
      return null;
    } catch (error) {
      reply.code(400);
      return { message: error instanceof Error ? error.message : "Invalid workspace path" };
    }
  });

  app.patch<{ Params: { id: string } }>("/api/workspaces/:id", async (request, reply) => {
    try {
      const payload = request.body as WorkspaceUpdateInput;
      const normalized = validateWorkspaceUpdate(payload, homePath);
      const updated = workspaceRepo.update(request.params.id, normalized);
      if (!updated) {
        reply.code(404);
        return { message: "Workspace not found" };
      }

      return updated;
    } catch (error) {
      reply.code(400);
      return { message: error instanceof Error ? error.message : "Invalid workspace payload" };
    }
  });

  app.delete<{ Params: { id: string } }>("/api/workspaces/:id", async (request, reply) => {
    const deleted = workspaceRepo.delete(request.params.id);
    if (!deleted) {
      reply.code(404);
      return { message: "Workspace not found" };
    }

    reply.code(204);
    return null;
  });

  app.get("/api/threads", async (request) => {
    const query = request.query as { workspaceId?: string; archived?: string };
    const archivedFilter = normalizeArchivedFilter(query.archived);
    const savedWorkspaces = workspaceRepo.list();
    const ignoredPaths = workspaceRepo.listIgnoredPaths();
    const snapshot = await loadThreadSnapshot(bridge);
    const workspaces = buildWorkspaceCatalog(
      savedWorkspaces,
      snapshot.allThreads,
      homePath,
      ignoredPaths,
    );
    const decorated = decorateThreads(snapshot, workspaces, archivedFilter);
    const filtered = filterThreadsByWorkspaceScope(decorated, query.workspaceId);

    filtered.sort((left, right) => right.updatedAt - left.updatedAt);

    const response: ThreadsResponse = { data: filtered };
    return response;
  });

  app.get("/ws", { websocket: true }, (socket) => {
    const connectionId = crypto.randomUUID();
    bridge.registerConnection(connectionId, (message) => {
      socket.send(JSON.stringify(message));
    });

    socket.on("message", (raw: Buffer) => {
      void handleWsMessage(bridge, connectionId, raw.toString(), socket.send.bind(socket));
    });

    socket.on("close", () => {
      bridge.unregisterConnection(connectionId);
    });
  });

  if (webDistExists) {
    app.get("/*", async (_request, reply) => {
      return reply.sendFile("index.html");
    });
  }

  return { app, bridge, workspaceRepo };
}

async function loadThreadSnapshot(
  bridge: BridgeClient,
): Promise<{
  activeThreads: Array<import("@webcli/codex-protocol").Thread>;
  archivedThreads: Array<import("@webcli/codex-protocol").Thread>;
  allThreads: Array<import("@webcli/codex-protocol").Thread>;
}> {
  const [activeThreads, archivedThreads] = await Promise.all([
    bridge.listThreads(false),
    bridge.listThreads(true),
  ]);

  return {
    activeThreads,
    archivedThreads,
    allThreads: [...activeThreads, ...archivedThreads],
  };
}

function decorateThreads(
  snapshot: {
    activeThreads: Array<import("@webcli/codex-protocol").Thread>;
    archivedThreads: Array<import("@webcli/codex-protocol").Thread>;
    allThreads: Array<import("@webcli/codex-protocol").Thread>;
  },
  workspaces: Array<import("@webcli/codex-protocol").WorkspaceRecord>,
  archivedFilter: boolean | "all",
): Array<import("@webcli/codex-protocol").ThreadListEntry> {
  if (archivedFilter === "all") {
    return [
      ...snapshot.activeThreads.map((thread) => decorateThread(thread, workspaces, false)),
      ...snapshot.archivedThreads.map((thread) => decorateThread(thread, workspaces, true)),
    ];
  }

  const threads = archivedFilter ? snapshot.archivedThreads : snapshot.activeThreads;
  return threads.map((thread) => decorateThread(thread, workspaces, archivedFilter));
}

function filterThreadsByWorkspaceScope(
  threads: Array<import("@webcli/codex-protocol").ThreadListEntry>,
  workspaceId: string | undefined,
): Array<import("@webcli/codex-protocol").ThreadListEntry> {
  if (!workspaceId || workspaceId === "all") {
    return threads.filter((thread) => thread.workspaceId !== null);
  }

  return threads.filter((thread) => thread.workspaceId === workspaceId);
}

async function handleWsMessage(
  bridge: BridgeClient,
  connectionId: string,
  raw: string,
  send: (data: string) => void,
): Promise<void> {
  let message: ClientWsMessage;
  try {
    message = JSON.parse(raw) as ClientWsMessage;
  } catch {
    send(
      JSON.stringify({
        type: "server.response",
        id: "invalid-json",
        error: {
          code: -32700,
          message: "Invalid JSON payload",
        },
      }),
    );
    return;
  }

  try {
    await bridge.handleClientMessage(connectionId, message);
  } catch (error) {
    send(
      JSON.stringify({
        type: "server.response",
        id: message.id,
        error: {
          code: -32000,
          message: error instanceof Error ? error.message : "Bridge request failed",
        },
      }),
    );
  }
}

function validateWorkspaceInput(
  input: WorkspaceCreateInput,
  homePath: string,
): WorkspaceCreateInput {
  if (!input || typeof input !== "object") {
    throw new Error("Workspace payload is required");
  }

  if (!input.name?.trim()) {
    throw new Error("Workspace name is required");
  }

  if (!input.absPath?.trim()) {
    throw new Error("Workspace path is required");
  }

  const absPath = ensureHomeScopedDirectory(input.absPath, homePath);

  return {
    name: input.name.trim(),
    absPath,
    defaultModel: input.defaultModel ?? null,
    approvalPolicy: input.approvalPolicy ?? "on-request",
    sandboxMode: input.sandboxMode ?? "danger-full-access",
  };
}

function validateWorkspaceUpdate(
  input: WorkspaceUpdateInput,
  homePath: string,
): WorkspaceUpdateInput {
  if (!input || typeof input !== "object") {
    return {};
  }

  if (input.absPath) {
    ensureHomeScopedDirectory(input.absPath, homePath);
  }

  return {
    name: input.name?.trim(),
    absPath: input.absPath
      ? ensureHomeScopedDirectory(input.absPath, homePath)
      : undefined,
    defaultModel:
      input.defaultModel === undefined ? undefined : (input.defaultModel ?? null),
    approvalPolicy: input.approvalPolicy,
    sandboxMode: input.sandboxMode,
  };
}

function normalizeArchivedFilter(
  value: string | undefined,
): boolean | "all" {
  if (!value) {
    return false;
  }

  if (value === "true") {
    return true;
  }

  if (value === "all") {
    return "all";
  }

  return false;
}
