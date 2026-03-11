import type {
  ClientRequestMethod,
  ClientRequestParams,
  ClientWsMessage,
  RequestId,
  ServerNotificationEnvelope,
  ServerRequestMethod,
  ServerRequestResult,
  ServerWsMessage,
} from "@webcli/codex-protocol";

type Listener = (message: ServerWsMessage) => void;
type ConnectionListener = (connected: boolean) => void;

export class CodexClient {
  private socket: WebSocket | null = null;
  private listeners = new Set<Listener>();
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

  async connect(): Promise<void> {
    if (this.socket?.readyState === WebSocket.OPEN) {
      return;
    }

    if (this.connectPromise) {
      return this.connectPromise;
    }

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${protocol}//${window.location.host}/ws`;

    this.connectPromise = new Promise((resolve, reject) => {
      const socket = new WebSocket(url);
      this.socket = socket;

      socket.addEventListener("open", () => {
        this.notifyConnection(true);
        this.connectPromise = null;
        resolve();
      });

      socket.addEventListener("message", (event) => {
        const message = JSON.parse(event.data) as ServerWsMessage;
        if (message.type === "server.response") {
          const pending = this.pending.get(message.id);
          this.pending.delete(message.id);

          if (!pending) {
            return;
          }

          if (message.error) {
            pending.reject(new Error(message.error.message));
          } else {
            pending.resolve(message.result);
          }
          return;
        }

        for (const listener of this.listeners) {
          listener(message);
        }
      });

      socket.addEventListener("close", () => {
        this.notifyConnection(false);
        this.socket = null;
        this.connectPromise = null;
        this.rejectPending("WebSocket connection closed");
        this.scheduleReconnect();
      });

      socket.addEventListener("error", () => {
        reject(new Error("Failed to connect to /ws"));
      });
    });

    return this.connectPromise;
  }

  subscribe(listener: Listener): () => void {
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

  async call<TResult, TMethod extends ClientRequestMethod>(
    method: TMethod,
    params: ClientRequestParams<TMethod>,
  ): Promise<TResult> {
    await this.connect();

    return new Promise<TResult>((resolve, reject) => {
      const id = crypto.randomUUID();
      this.pending.set(id, {
        resolve: (value) => resolve(value as TResult),
        reject,
      });
      this.send({
        type: "client.call",
        id,
        method,
        params,
      } as ClientWsMessage);
    });
  }

  respondToServerRequest<TMethod extends ServerRequestMethod>(
    id: RequestId,
    method: TMethod,
    params: ServerRequestResult<TMethod>,
  ): void {
    this.send({
      type: "client.call",
      id,
      method,
      params,
    } as ClientWsMessage);
  }

  private send(message: ClientWsMessage): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket is not connected");
    }

    this.socket.send(JSON.stringify(message));
  }

  private rejectPending(message: string): void {
    for (const pending of this.pending.values()) {
      pending.reject(new Error(message));
    }
    this.pending.clear();
  }

  private notifyConnection(connected: boolean): void {
    for (const listener of this.connectionListeners) {
      listener(connected);
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) {
      return;
    }

    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, 1500);
  }
}

export const codexClient = new CodexClient();

export function isServerRequestNotification(
  message: ServerWsMessage,
): message is ServerNotificationEnvelope<ServerRequestMethod> {
  return (
    message.type === "server.notification" &&
    "id" in message &&
    typeof message.id !== "undefined"
  );
}
