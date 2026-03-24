import { createReadStream, existsSync, mkdirSync, statSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { extname } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import { AppError, isAppError } from "@webcli/contracts";
import type {
  ApiErrorResponse,
  AppClientMessage,
  AppErrorPayload,
  BootstrapResponse,
  HealthResponse,
  PathSuggestionsResponse,
  SessionSummary,
  ThreadSummaryPageResponse,
  WorkspaceCreateInput,
  WorkspaceDismissInput,
  WorkspaceUpdateInput,
} from "@webcli/contracts";
import {
  SessionManager,
  ThreadProjectionService,
  WorkbenchService,
  WorkspaceCatalogService,
  WorkspaceRepo,
  type SessionRuntime,
} from "@webcli/core";
import { CodexRuntime } from "@webcli/runtime-codex";
import type { AppEnv } from "./env.js";

type AppContext = {
  app: FastifyInstance;
  service: WorkbenchService;
  sessionManager: SessionManager;
  runtime: SessionRuntime;
  workspaceRepo: WorkspaceRepo;
};

export async function createApp(
  env: AppEnv,
  overrides?: {
    runtime?: SessionRuntime;
    workspaceRepo?: WorkspaceRepo;
    service?: WorkbenchService;
  },
): Promise<AppContext> {
  mkdirSync(env.dataDir, { recursive: true });
  const app = Fastify({ logger: false });
  const runtime: SessionRuntime =
    overrides?.runtime ??
    (new CodexRuntime({ codexCommand: env.codexCommand }) as SessionRuntime);
  const workspaceRepo = overrides?.workspaceRepo ?? new WorkspaceRepo(env.dbPath);
  const workspaceCatalog = new WorkspaceCatalogService();
  const threadProjection = new ThreadProjectionService(workspaceCatalog);
  const service =
    overrides?.service ?? new WorkbenchService(runtime, workspaceRepo);

  // Create SessionManager (new session-oriented architecture)
  const sessionManager = new SessionManager({
    runtime,
    workspaceRepo,
    threadProjection,
  });

  app.addHook("onClose", async () => {
    await service.stop();
  });

  await service.start();
  // Event routing is handled by WorkbenchService (registers connections,
  // broadcasts thread/approval/git events). SessionManager provides
  // session CRUD and connection lifecycle only.
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

  // -------------------------------------------------------------------------
  // Health & Bootstrap (unchanged)
  // -------------------------------------------------------------------------

  app.get("/api/health", async () => {
    const response: HealthResponse = service.createHealthResponse(env.codexCommand);
    return response;
  });

  app.get("/api/bootstrap", async () => {
    const response: BootstrapResponse = await service.getBootstrap();
    return response;
  });

  // -------------------------------------------------------------------------
  // Thread summaries (legacy, kept for backward compat)
  // -------------------------------------------------------------------------

  app.get("/api/thread-summaries", async (request, reply) => {
    try {
      const query = request.query as {
        archived?: string;
        cursor?: string;
        limit?: string;
        workspaceId?: string;
      };
      const response: ThreadSummaryPageResponse = await service.listThreadSummaries({
        archived: query.archived === "true",
        cursor: query.cursor ?? null,
        limit: query.limit ? Number.parseInt(query.limit, 10) : null,
        workspaceId: query.workspaceId && query.workspaceId !== "all" ? query.workspaceId : undefined,
      });
      return response;
    } catch (error) {
      reply.code(400);
      return toApiErrorResponse(error, "Invalid thread summary query");
    }
  });

  // -------------------------------------------------------------------------
  // Session REST API (new, aligned with Kimi CLI)
  // -------------------------------------------------------------------------

  app.get("/api/sessions", async () => {
    const sessions: SessionSummary[] = sessionManager.listSessions();
    return { items: sessions };
  });

  app.post("/api/sessions", async (request, reply) => {
    try {
      const body = request.body as {
        workspaceId?: string;
        cwd?: string;
      } | null;
      const session = sessionManager.createSession({
        workspaceId: body?.workspaceId,
        cwd: body?.cwd,
      });
      reply.code(201);
      return { sessionId: session.id, status: session.getStatus() };
    } catch (error) {
      reply.code(400);
      return toApiErrorResponse(error, "Failed to create session");
    }
  });

  app.get<{ Params: { id: string } }>("/api/sessions/:id", async (request, reply) => {
    const session = sessionManager.getSession(request.params.id);
    if (!session) {
      reply.code(404);
      return toApiErrorResponse(
        new AppError("thread.not_found", "Session not found"),
        "Session not found",
      );
    }
    return { sessionId: session.id, status: session.getStatus() };
  });

  app.delete<{ Params: { id: string } }>("/api/sessions/:id", async (request, reply) => {
    const deleted = sessionManager.deleteSession(request.params.id);
    if (!deleted) {
      reply.code(404);
      return toApiErrorResponse(
        new AppError("thread.not_found", "Session not found"),
        "Session not found",
      );
    }
    reply.code(204);
    return null;
  });

  // -------------------------------------------------------------------------
  // Per-session WebSocket (new, aligned with Kimi CLI)
  // -------------------------------------------------------------------------

  app.get<{ Params: { id: string } }>(
    "/ws/sessions/:id",
    { websocket: true },
    (socket, request) => {
      const sessionId = request.params.id;
      const connectionId = randomUUID();
      const session = sessionManager.getSession(sessionId);

      if (!session) {
        socket.close(4004, "Session not found");
        return;
      }

      const sender = (message: import("@webcli/contracts").AppServerMessage) => {
        try {
          socket.send(JSON.stringify(message));
        } catch {
          // Socket is dead; unregister will happen on close event
        }
      };

      const registered = sessionManager.registerConnection(
        sessionId,
        connectionId,
        sender,
      );

      if (!registered) {
        socket.close(4004, "Failed to register connection");
        return;
      }

      // Register in WorkbenchService for event broadcasting (thread updates,
      // approvals, git snapshots, etc.). SessionManager handles session CRUD only.
      service.registerConnection(sessionId, connectionId, sender);

      socket.on("message", (raw: Buffer) => {
        void handleSessionWsMessage(
          service,
          sessionManager,
          sessionId,
          connectionId,
          raw.toString(),
          (data: string) => {
            try {
              socket.send(data);
            } catch {
              // ignore dead socket
            }
          },
        );
      });

      socket.on("close", () => {
        sessionManager.unregisterConnection(connectionId);
        service.unregisterConnection(connectionId);
      });

      socket.on("error", () => {
        sessionManager.unregisterConnection(connectionId);
        service.unregisterConnection(connectionId);
      });
    },
  );

  // -------------------------------------------------------------------------
  // Workspace REST API
  // -------------------------------------------------------------------------

  app.get("/api/workspaces", async () => {
    return service.listWorkspaces();
  });

  app.get("/api/workspace-path-suggestions", async (request) => {
    const query = request.query as { query?: string };
    const response: PathSuggestionsResponse = service.listPathSuggestions(query.query);
    return response;
  });

  app.get("/api/resource", async (request, reply) => {
    try {
      const query = request.query as { path?: string };
      const requestedPath = query.path?.trim();
      if (!requestedPath) {
        reply.code(400);
        return toApiErrorResponse(
          new AppError("resource.path_required", "Resource path is required"),
          "Resource path is required",
        );
      }

      const absPath = await service.resolveReadableResourcePath(requestedPath);
      const stats = statSync(absPath, { throwIfNoEntry: false });
      if (!stats || !stats.isFile()) {
        reply.code(404);
        return toApiErrorResponse(
          new AppError("resource.not_found", "Resource not found"),
          "Resource not found",
        );
      }

      reply.header("Cache-Control", "private, max-age=60");
      reply.header("Content-Disposition", "inline");
      reply.type(contentTypeForPath(absPath));
      return reply.send(createReadStream(absPath));
    } catch (error) {
      reply.code(400);
      return toApiErrorResponse(error, "Invalid resource path");
    }
  });

  app.post("/api/workspaces", async (request, reply) => {
    try {
      const payload = request.body as WorkspaceCreateInput;
      const created = service.createWorkspace(payload);
      reply.code(201);
      return created;
    } catch (error) {
      reply.code(400);
      return toApiErrorResponse(error, "Invalid workspace payload");
    }
  });

  app.post("/api/workspaces/dismiss", async (request, reply) => {
    try {
      const payload = request.body as { absPath: string };
      service.dismissWorkspace(payload);
      reply.code(204);
      return null;
    } catch (error) {
      reply.code(400);
      return toApiErrorResponse(error, "Invalid workspace path");
    }
  });

  app.patch<{ Params: { id: string } }>("/api/workspaces/:id", async (request, reply) => {
    try {
      const payload = request.body as Partial<WorkspaceCreateInput>;
      const updated = service.updateWorkspace(request.params.id, payload);
      if (!updated) {
        reply.code(404);
        return toApiErrorResponse(
          new AppError("workspace.not_found", "Workspace not found"),
          "Workspace not found",
        );
      }

      return updated;
    } catch (error) {
      reply.code(400);
      return toApiErrorResponse(error, "Invalid workspace payload");
    }
  });

  app.delete<{ Params: { id: string } }>("/api/workspaces/:id", async (request, reply) => {
    const deleted = service.deleteWorkspace(request.params.id);
    if (!deleted) {
      reply.code(404);
      return toApiErrorResponse(
        new AppError("workspace.not_found", "Workspace not found"),
        "Workspace not found",
      );
    }

    reply.code(204);
    return null;
  });

  // -------------------------------------------------------------------------
  // SPA fallback
  // -------------------------------------------------------------------------

  if (webDistExists) {
    app.get("/*", async (_request, reply) => {
      return reply.sendFile("index.html");
    });
  }

  return { app, service, sessionManager, runtime, workspaceRepo };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function contentTypeForPath(value: string): string {
  const extension = extname(value).toLowerCase();
  const map: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".bmp": "image/bmp",
    ".ico": "image/x-icon",
    ".avif": "image/avif",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".ogg": "audio/ogg",
    ".oga": "audio/ogg",
    ".m4a": "audio/mp4",
    ".aac": "audio/aac",
    ".flac": "audio/flac",
    ".mp4": "video/mp4",
    ".m4v": "video/mp4",
    ".webm": "video/webm",
    ".mov": "video/quicktime",
    ".md": "text/markdown; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
  };
  return map[extension] ?? "application/octet-stream";
}

/**
 * Handle WebSocket message on a per-session connection (new architecture).
 * Routes RPC calls through WorkbenchService but sends responses via the
 * session's connection.
 */
async function handleSessionWsMessage(
  service: WorkbenchService,
  sessionManager: SessionManager,
  sessionId: string,
  connectionId: string,
  raw: string,
  send: (data: string) => void,
): Promise<void> {
  let message: AppClientMessage;
  try {
    message = JSON.parse(raw) as AppClientMessage;
  } catch {
    send(
      JSON.stringify({
        type: "server.response",
        id: "invalid-json",
        error: {
          code: -32700,
          message: "Invalid JSON payload",
          data: toAppErrorPayload(
            new AppError("invalid.json", "Invalid JSON payload"),
            "Invalid JSON payload",
          ),
        },
      }),
    );
    return;
  }

  try {
    const result = await service.handleClientCall(sessionId, message);

    // Bind thread to session after thread.open / thread.resume / thread.unarchive / thread.fork
    if (
      result &&
      typeof result === "object" &&
      "thread" in result &&
      result.thread &&
      typeof result.thread === "object" &&
      "thread" in result.thread
    ) {
      const threadData = result.thread as { thread?: { id?: string } };
      if (threadData.thread?.id) {
        sessionManager.bindThread(sessionId, threadData.thread.id);
      }
    }

    // Bind command process to session after command.start
    if (
      message.method === "command.start" &&
      result &&
      typeof result === "object" &&
      "session" in result
    ) {
      const cmdResult = result as { session?: { processId?: string } };
      if (cmdResult.session?.processId) {
        sessionManager.bindProcess(sessionId, cmdResult.session.processId);
      }
    }

    send(
      JSON.stringify({
        type: "server.response",
        id: message.id,
        result,
      }),
    );
  } catch (error) {
    send(
      JSON.stringify({
        type: "server.response",
        id: message.id,
        error: {
          code: -32000,
          message: error instanceof Error ? error.message : "Request failed",
          data: toAppErrorPayload(error, "Request failed"),
        },
      }),
    );
  }
}

function toAppErrorPayload(error: unknown, _fallbackMessage: string): AppErrorPayload | undefined {
  if (isAppError(error)) {
    return error.toPayload();
  }
  return undefined;
}

function toApiErrorResponse(error: unknown, fallbackMessage: string): ApiErrorResponse {
  if (isAppError(error)) {
    const payload = error.toPayload();
    return {
      message: payload.message,
      code: payload.code,
      ...(payload.params ? { params: payload.params } : {}),
    };
  }

  return {
    message: error instanceof Error ? error.message : fallbackMessage,
  };
}
