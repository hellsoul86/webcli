/**
 * useActiveClient — provides a session-aware RPC client.
 *
 * On mount, creates a server-side session via REST API, then connects
 * a per-session WebSocket to `/ws/sessions/:id`.
 *
 * Returns an object with `call()` / `subscribe()` / `onConnectionChange()`
 * matching the same API shape used throughout WorkbenchScreen.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AppRequestMethod,
  AppRequestParams,
  AppRequestResult,
  AppServerMessage,
} from "@webcli/contracts";
import { SessionClient } from "../shared/workbench/session-ws-client";
import { sessionApiClient } from "../shared/workbench/session-api-client";

type Listener = (message: AppServerMessage) => void;
type ConnectionListener = (connected: boolean) => void;

export type ActiveClient = {
  call: <TMethod extends AppRequestMethod>(
    method: TMethod,
    params: AppRequestParams<TMethod>,
  ) => Promise<AppRequestResult<TMethod>>;
  subscribe: (listener: Listener) => () => void;
  onConnectionChange: (listener: ConnectionListener) => () => void;
  connect: () => Promise<void>;
  sessionId: string | null;
};

const SESSION_STORAGE_KEY = "webcli.activeSessionId";

function loadPersistedSessionId(): string | null {
  try {
    return window.localStorage.getItem(SESSION_STORAGE_KEY);
  } catch {
    return null;
  }
}

function persistSessionId(id: string): void {
  try {
    window.localStorage.setItem(SESSION_STORAGE_KEY, id);
  } catch {
    // ignore
  }
}

export function useActiveClient(): ActiveClient {
  const sessionClientRef = useRef<SessionClient | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);

  // Create session + connect on mount
  useEffect(() => {
    let cancelled = false;

    async function initSession() {
      try {
        let sid: string;
        const existing = loadPersistedSessionId();

        if (existing) {
          try {
            await sessionApiClient.getSession(existing);
            sid = existing;
          } catch {
            const created = await sessionApiClient.createSession();
            sid = created.sessionId;
          }
        } else {
          const created = await sessionApiClient.createSession();
          sid = created.sessionId;
        }

        if (cancelled) return;

        persistSessionId(sid);
        setSessionId(sid);

        const client = new SessionClient(sid);
        sessionClientRef.current = client;

        void client.connect().catch((err) => {
          console.error("[useActiveClient] Session connect failed:", err);
        });
      } catch (err) {
        console.error("[useActiveClient] Failed to init session:", err);
      }
    }

    void initSession();

    return () => {
      cancelled = true;
      if (sessionClientRef.current) {
        sessionClientRef.current.dispose();
        sessionClientRef.current = null;
      }
    };
  }, []);

  const call = useCallback(
    <TMethod extends AppRequestMethod>(
      method: TMethod,
      params: AppRequestParams<TMethod>,
    ): Promise<AppRequestResult<TMethod>> => {
      if (!sessionClientRef.current) {
        return Promise.reject(new Error("Session not initialized"));
      }
      return sessionClientRef.current.call(method, params);
    },
    [],
  );

  const subscribe = useCallback(
    (listener: Listener): (() => void) => {
      if (!sessionClientRef.current) {
        return () => {};
      }
      return sessionClientRef.current.subscribe(listener);
    },
    [],
  );

  const onConnectionChange = useCallback(
    (listener: ConnectionListener): (() => void) => {
      if (!sessionClientRef.current) {
        return () => {};
      }
      return sessionClientRef.current.onConnectionChange(listener);
    },
    [],
  );

  const connect = useCallback(async () => {
    if (sessionClientRef.current) {
      return sessionClientRef.current.connect();
    }
  }, []);

  return useMemo(() => ({
    call,
    subscribe,
    onConnectionChange,
    connect,
    sessionId,
  }), [call, subscribe, onConnectionChange, connect, sessionId]);
}
