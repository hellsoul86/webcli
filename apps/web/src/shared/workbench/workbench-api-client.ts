import type {
  ApiErrorResponse,
  BootstrapResponse,
  HealthResponse,
  PathSuggestionsResponse,
  ThreadSummaryPageResponse,
  WorkspaceCreateInput,
  WorkspaceDismissInput,
  WorkspaceRecord,
  WorkspaceUpdateInput,
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

async function requestText(path: string, init?: RequestInit): Promise<string> {
  const response = await fetch(path, init);

  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || `${response.status} ${response.statusText}`);
  }

  return response.text();
}

export class WorkbenchApiClient {
  health(): Promise<HealthResponse> {
    return request("/api/health");
  }

  bootstrap(): Promise<BootstrapResponse> {
    return request("/api/bootstrap");
  }

  threadSummaries(input: {
    archived: boolean;
    cursor?: string | null;
    limit?: number;
    workspaceId?: string | "all";
  }): Promise<ThreadSummaryPageResponse> {
    const params = new URLSearchParams({
      archived: String(input.archived),
      ...(input.cursor ? { cursor: input.cursor } : {}),
      ...(input.limit ? { limit: String(input.limit) } : {}),
      ...(input.workspaceId && input.workspaceId !== "all"
        ? { workspaceId: input.workspaceId }
        : {}),
    });
    return request(`/api/thread-summaries?${params.toString()}`);
  }

  workspacePathSuggestions(query: string): Promise<PathSuggestionsResponse> {
    return request(
      `/api/workspace-path-suggestions?${new URLSearchParams({ query }).toString()}`,
    );
  }

  workspaces(): Promise<Array<WorkspaceRecord>> {
    return request("/api/workspaces");
  }

  createWorkspace(input: WorkspaceCreateInput): Promise<WorkspaceRecord> {
    return request("/api/workspaces", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  updateWorkspace(id: string, input: WorkspaceUpdateInput): Promise<WorkspaceRecord> {
    return request(`/api/workspaces/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
  }

  deleteWorkspace(id: string): Promise<void> {
    return request(`/api/workspaces/${id}`, {
      method: "DELETE",
    });
  }

  dismissWorkspace(input: WorkspaceDismissInput): Promise<void> {
    return request("/api/workspaces/dismiss", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  resourceText(path: string): Promise<string> {
    return requestText(`/api/resource?${new URLSearchParams({ path }).toString()}`);
  }
}

export const workbenchApiClient = new WorkbenchApiClient();
export const api = workbenchApiClient;
