import { createReadStream, existsSync, mkdirSync, statSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { extname } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import type {
  AppClientMessage,
  BootstrapResponse,
  HealthResponse,
  PathSuggestionsResponse,
  WorkspaceCreateInput,
  WorkspaceDismissInput,
  WorkspaceRecord,
  WorkspaceUpdateInput,
} from "@webcli/contracts";
import {
  WorkbenchService,
  WorkspaceRepo,
  ensureHomeScopedPath,
  type SessionRuntime,
} from "@webcli/core";
import { CodexRuntime } from "@webcli/runtime-codex";
import type { AppEnv } from "./env.js";

type AppContext = {
  app: FastifyInstance;
  service: WorkbenchService;
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
  const runtime =
    overrides?.runtime ?? new CodexRuntime({ codexCommand: env.codexCommand });
  const workspaceRepo = overrides?.workspaceRepo ?? new WorkspaceRepo(env.dbPath);
  const service =
    overrides?.service ?? new WorkbenchService(runtime, workspaceRepo);

  app.addHook("onClose", async () => {
    await service.stop();
  });

  await service.start();
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
    const response: HealthResponse = service.createHealthResponse(env.codexCommand);
    return response;
  });

  app.get("/api/bootstrap", async () => {
    const response: BootstrapResponse = await service.getBootstrap();
    return response;
  });

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
        return { message: "Resource path is required" };
      }

      const absPath = ensureHomeScopedPath(requestedPath);
      const stats = statSync(absPath, { throwIfNoEntry: false });
      if (!stats || !stats.isFile()) {
        reply.code(404);
        return { message: "Resource not found" };
      }

      reply.header("Cache-Control", "private, max-age=60");
      reply.header("Content-Disposition", "inline");
      reply.type(contentTypeForPath(absPath));
      return reply.send(createReadStream(absPath));
    } catch (error) {
      reply.code(400);
      return { message: error instanceof Error ? error.message : "Invalid resource path" };
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
      return { message: error instanceof Error ? error.message : "Invalid workspace payload" };
    }
  });

  app.post("/api/workspaces/dismiss", async (request, reply) => {
    try {
      const payload = request.body as WorkspaceDismissInput;
      service.dismissWorkspace(payload);
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
      const updated = service.updateWorkspace(request.params.id, payload);
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
    const deleted = service.deleteWorkspace(request.params.id);
    if (!deleted) {
      reply.code(404);
      return { message: "Workspace not found" };
    }

    reply.code(204);
    return null;
  });

  app.get("/ws", { websocket: true }, (socket, request) => {
    const query = request.query as { clientSessionId?: string };
    const clientSessionId = query.clientSessionId?.trim() || randomUUID();
    const connectionId = randomUUID();

    service.registerConnection(clientSessionId, connectionId, (message) => {
      socket.send(JSON.stringify(message));
    });

    socket.on("message", (raw: Buffer) => {
      void handleWsMessage(service, clientSessionId, raw.toString(), socket.send.bind(socket));
    });

    socket.on("close", () => {
      service.unregisterConnection(connectionId);
    });
  });

  if (webDistExists) {
    app.get("/*", async (_request, reply) => {
      return reply.sendFile("index.html");
    });
  }

  return { app, service, runtime, workspaceRepo };
}

function contentTypeForPath(value: string): string {
  const extension = extname(value).toLowerCase();
  if (extension === ".png") {
    return "image/png";
  }
  if (extension === ".jpg" || extension === ".jpeg") {
    return "image/jpeg";
  }
  if (extension === ".gif") {
    return "image/gif";
  }
  if (extension === ".webp") {
    return "image/webp";
  }
  if (extension === ".svg") {
    return "image/svg+xml";
  }
  if (extension === ".bmp") {
    return "image/bmp";
  }
  if (extension === ".ico") {
    return "image/x-icon";
  }
  if (extension === ".avif") {
    return "image/avif";
  }
  if (extension === ".mp3") {
    return "audio/mpeg";
  }
  if (extension === ".wav") {
    return "audio/wav";
  }
  if (extension === ".ogg" || extension === ".oga") {
    return "audio/ogg";
  }
  if (extension === ".m4a") {
    return "audio/mp4";
  }
  if (extension === ".aac") {
    return "audio/aac";
  }
  if (extension === ".flac") {
    return "audio/flac";
  }
  if (extension === ".mp4" || extension === ".m4v") {
    return "video/mp4";
  }
  if (extension === ".webm") {
    return "video/webm";
  }
  if (extension === ".mov") {
    return "video/quicktime";
  }
  if (extension === ".md") {
    return "text/markdown; charset=utf-8";
  }
  if (extension === ".txt") {
    return "text/plain; charset=utf-8";
  }

  return "application/octet-stream";
}

async function handleWsMessage(
  service: WorkbenchService,
  sessionId: string,
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
        },
      }),
    );
    return;
  }

  try {
    const result = await service.handleClientCall(sessionId, message);
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
          message: error instanceof Error ? error.message : "Workbench request failed",
        },
      }),
    );
  }
}
