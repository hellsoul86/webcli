import type {
  AccountSummary,
  AppErrorPayload,
  BootstrapSettingsSummary,
  ModelOption,
  RuntimeStatus,
  ThreadSummary,
  WorkspaceRecord,
} from "./domain.js";

export type ApiErrorResponse = {
  message: string;
  code?: AppErrorPayload["code"];
  params?: AppErrorPayload["params"];
};

export type HealthResponse = {
  status: "ok";
  runtime: RuntimeStatus;
  codexCommand: string;
};

export type BootstrapResponse = {
  runtime: RuntimeStatus;
  account: AccountSummary;
  models: Array<ModelOption>;
  workspaces: Array<WorkspaceRecord>;
  activeThreads: Array<ThreadSummary>;
  archivedThreadCount: number;
  settings: BootstrapSettingsSummary;
};

export type ThreadSummaryPageResponse = {
  items: Array<ThreadSummary>;
  nextCursor: string | null;
};

export type PathSuggestion = {
  value: string;
  absPath: string;
};

export type PathSuggestionsResponse = {
  homePath: string;
  query: string;
  normalizedQuery: string;
  resolvedPath: string;
  withinHome: boolean;
  isDirectory: boolean;
  data: Array<PathSuggestion>;
};
