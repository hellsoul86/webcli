/**
 * Session REST API client (aligned with Kimi CLI web mode).
 *
 * Provides typed access to the session-oriented REST endpoints.
 */

import type {
  ApiErrorResponse,
  SessionSummary,
  SessionStatus,
} from "@webcli/contracts";
import { AppError as RemoteAppError } from "@webcli/contracts";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  if (!response.ok) {
    const body = await response.text();
    try {
      const parsed = JSON.parse(body) as ApiErrorResponse;
      if (parsed.code) {
        throw new RemoteAppError(
          parsed.code,
          parsed.message || `${response.status} ${response.statusText}`,
          parsed.params,
        );
      }
      throw new Error(parsed.message || `${response.status} ${response.statusText}`);
    } catch (error) {
      if (error instanceof Error && error.message !== body) {
        throw error;
      }
      throw new Error(body || `${response.status} ${response.statusText}`);
    }
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export type CreateSessionResponse = {
  sessionId: string;
  status: SessionStatus;
};

export type SessionListResponse = {
  items: SessionSummary[];
};

export class SessionApiClient {
  listSessions(): Promise<SessionListResponse> {
    return request("/api/sessions");
  }

  createSession(input?: {
    workspaceId?: string;
    cwd?: string;
  }): Promise<CreateSessionResponse> {
    return request("/api/sessions", {
      method: "POST",
      body: JSON.stringify(input ?? {}),
    });
  }

  getSession(
    sessionId: string,
  ): Promise<{ sessionId: string; status: SessionStatus }> {
    return request(`/api/sessions/${sessionId}`);
  }

  deleteSession(sessionId: string): Promise<void> {
    return request(`/api/sessions/${sessionId}`, {
      method: "DELETE",
    });
  }
}

export const sessionApiClient = new SessionApiClient();
