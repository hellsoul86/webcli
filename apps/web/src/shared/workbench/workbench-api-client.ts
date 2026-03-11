import type {
  BootstrapResponse,
  HealthResponse,
  PathSuggestionsResponse,
  WorkspaceCreateInput,
  WorkspaceDismissInput,
  WorkspaceRecord,
  WorkspaceUpdateInput,
} from "@webcli/contracts";

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
      const parsed = JSON.parse(body) as { message?: string };
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
