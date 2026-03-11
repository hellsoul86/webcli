import type {
  AccountResponse,
  HealthResponse,
  ModelsResponse,
  PathSuggestionsResponse,
  ThreadsResponse,
  WorkspaceCreateInput,
  WorkspaceDismissInput,
  WorkspaceRecord,
  WorkspaceUpdateInput,
} from "@webcli/codex-protocol";

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

export const api = {
  health: () => request<HealthResponse>("/api/health"),
  account: () => request<AccountResponse>("/api/account"),
  models: () => request<ModelsResponse>("/api/models"),
  workspacePathSuggestions: (query: string) =>
    request<PathSuggestionsResponse>(
      `/api/workspace-path-suggestions?${new URLSearchParams({ query }).toString()}`,
    ),
  workspaces: () => request<Array<WorkspaceRecord>>("/api/workspaces"),
  createWorkspace: (input: WorkspaceCreateInput) =>
    request<WorkspaceRecord>("/api/workspaces", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateWorkspace: (id: string, input: WorkspaceUpdateInput) =>
    request<WorkspaceRecord>(`/api/workspaces/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  deleteWorkspace: (id: string) =>
    request<void>(`/api/workspaces/${id}`, {
      method: "DELETE",
    }),
  dismissWorkspace: (input: WorkspaceDismissInput) =>
    request<void>("/api/workspaces/dismiss", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  threads: (input: {
    workspaceId: string | "all";
    archived?: boolean | "all";
  }) => {
    const query = new URLSearchParams({
      workspaceId: input.workspaceId,
      archived:
        input.archived === undefined
          ? "false"
          : input.archived === "all"
            ? "all"
            : String(input.archived),
    });
    return request<ThreadsResponse>(`/api/threads?${query.toString()}`);
  },
};
