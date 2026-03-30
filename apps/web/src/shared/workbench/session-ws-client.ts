/**
 * SessionClient — per-session WebSocket client.
 *
 * Connects to `/ws/sessions/:id` instead of the legacy centralized `/ws`.
 *
 * Improvements over the legacy WorkbenchClient:
 *  - Exponential backoff reconnection (1s → 2s → 4s → ... → 30s max)
 *  - Message validation with type guards (no unsafe `as` casts)
 *  - Error handling for dead socket sends
 *  - Connection state tracking
 *  - Disposable (cleanup on unmount)
 */

import type {
  AppClientMessage,
  AppRequestMethod,
  AppRequestParams,
  AppRequestResult,
  AppServerMessage,
  RequestId,
} from "@webcli/contracts";
import { AppError } from "@webcli/contracts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type NotificationListener = (message: AppServerMessage) => void;
type ConnectionListener = (connected: boolean) => void;

export type SessionClientState = "disconnected" | "connecting" | "connected";

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function isServerMessage(data: unknown): data is AppServerMessage {
  if (!data || typeof data !== "object") return false;
  const msg = data as Record<string, unknown>;
  return msg.type === "server.response" || msg.type === "server.notification";
}

// ---------------------------------------------------------------------------
// SessionClient
// ---------------------------------------------------------------------------

const MIN_RECONNECT_MS = 1000;
const MAX_RECONNECT_MS = 30000;
const BACKOFF_FACTOR = 2;

export class SessionClient {
  private readonly sessionId: string;
  private socket: WebSocket | null = null;
  private listeners = new Set<NotificationListener>();
  private connectionListeners = new Set<ConnectionListener>();
  private pending = new Map<
    RequestId,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
    }
  >();
  private connectPromise: Promise<void> | null = null;
  private reconnectTimer: number | null = null;
  private reconnectDelay = MIN_RECONNECT_MS;
  private _state: SessionClientState = "disconnected";
  private disposed = false;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  get state(): SessionClientState {
    return this._state;
  }

  // -------------------------------------------------------------------------
  // Connection
  // -------------------------------------------------------------------------

  async connect(): Promise<void> {
    if (this.disposed) return;
    if (this.socket?.readyState === WebSocket.OPEN) return;
    if (this.connectPromise) return this.connectPromise;

    this._state = "connecting";
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${protocol}//${window.location.host}/ws/sessions/${this.sessionId}`;

    this.connectPromise = new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(url);
      this.socket = socket;

      socket.addEventListener("open", () => {
        this._state = "connected";
        this.reconnectDelay = MIN_RECONNECT_MS; // reset backoff
        this.connectPromise = null;
        this.notifyConnection(true);
        resolve();
      });

      socket.addEventListener("message", (event) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(event.data as string);
        } catch {
          console.warn("[SessionClient] Invalid JSON from server");
          return;
        }

        if (!isServerMessage(parsed)) {
          console.warn("[SessionClient] Unknown message format:", parsed);
          return;
        }

        const message = parsed;

        if (message.type === "server.response") {
          const pending = this.pending.get(message.id);
          this.pending.delete(message.id);
          if (!pending) return;

          if (message.error) {
            const payload = message.error.data;
            if (payload?.code) {
              pending.reject(
                new AppError(payload.code, message.error.message, payload.params),
              );
            } else {
              pending.reject(new Error(message.error.message));
            }
          } else {
            pending.resolve(message.result);
          }
          return;
        }

        // Notification — broadcast to all listeners
        for (const listener of this.listeners) {
          try {
            listener(message);
          } catch (err) {
            console.error("[SessionClient] Listener error:", err);
          }
        }
      });

      socket.addEventListener("close", (event) => {
        this._state = "disconnected";
        this.socket = null;
        this.connectPromise = null;
        this.notifyConnection(false);
        this.rejectPending(
          `WebSocket closed: ${event.code} ${event.reason || ""}`.trim(),
        );
        this.scheduleReconnect();
      });

      socket.addEventListener("error", () => {
        // The close event will fire after this; reject the connect promise
        this.connectPromise = null;
        reject(new Error(`Failed to connect to session ${this.sessionId}`));
      });
    });

    return this.connectPromise;
  }

  disconnect(): void {
    this.clearReconnectTimer();
    if (this.socket) {
      this.socket.close(1000, "Client disconnect");
      this.socket = null;
    }
    this._state = "disconnected";
    this.rejectPending("Client disconnected");
  }

  dispose(): void {
    this.disposed = true;
    this.disconnect();
    this.listeners.clear();
    this.connectionListeners.clear();
  }

  // -------------------------------------------------------------------------
  // RPC
  // -------------------------------------------------------------------------

  async call<TMethod extends AppRequestMethod>(
    method: TMethod,
    params: AppRequestParams<TMethod>,
  ): Promise<AppRequestResult<TMethod>> {
    await this.connect();

    return new Promise<AppRequestResult<TMethod>>((resolve, reject) => {
      const id = window.crypto.randomUUID();
      this.pending.set(id, {
        resolve: (value) => resolve(value as AppRequestResult<TMethod>),
        reject,
      });

      try {
        this.send({
          type: "client.call",
          id,
          method,
          params,
        } as AppClientMessage);
      } catch (err) {
        this.pending.delete(id);
        reject(err);
      }
    });
  }

  // -------------------------------------------------------------------------
  // Subscriptions
  // -------------------------------------------------------------------------

  subscribe(listener: NotificationListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  onConnectionChange(listener: ConnectionListener): () => void {
    this.connectionListeners.add(listener);
    return () => {
      this.connectionListeners.delete(listener);
    };
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  private send(message: AppClientMessage): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket is not connected");
    }
    this.socket.send(JSON.stringify(message));
  }

  private rejectPending(reason: string): void {
    for (const pending of this.pending.values()) {
      pending.reject(new Error(reason));
    }
    this.pending.clear();
  }

  private notifyConnection(connected: boolean): void {
    for (const listener of this.connectionListeners) {
      try {
        listener(connected);
      } catch {
        // ignore listener errors
      }
    }
  }

  private scheduleReconnect(): void {
    if (this.disposed) return;
    if (this.reconnectTimer !== null) return;

    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, this.reconnectDelay);

    // Exponential backoff with jitter
    this.reconnectDelay = Math.min(
      this.reconnectDelay * BACKOFF_FACTOR + Math.random() * 500,
      MAX_RECONNECT_MS,
    );
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}
