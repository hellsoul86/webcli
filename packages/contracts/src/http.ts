import type {
  AccountSummary,
  BootstrapSettingsSummary,
  ModelOption,
  RuntimeStatus,
  ThreadSummary,
  WorkspaceRecord,
} from "./domain.js";

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
  archivedThreads: Array<ThreadSummary>;
  loadedThreadIds: Array<string>;
  settings: BootstrapSettingsSummary;
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
