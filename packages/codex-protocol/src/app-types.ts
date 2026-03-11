import type { PlanType } from "./generated/PlanType";
import type { AskForApproval } from "./generated/v2/AskForApproval";
import type { GitInfo } from "./generated/v2/GitInfo";
import type { Model } from "./generated/v2/Model";
import type { SessionSource } from "./generated/v2/SessionSource";
import type { SandboxMode } from "./generated/v2/SandboxMode";
import type { ThreadStatus } from "./generated/v2/ThreadStatus";

export type WorkspaceRecord = {
  id: string;
  name: string;
  absPath: string;
  source: "saved" | "derived";
  defaultModel: string | null;
  approvalPolicy: AskForApproval;
  sandboxMode: SandboxMode;
  createdAt: string;
  updatedAt: string;
};

export type WorkspaceCreateInput = {
  name: string;
  absPath: string;
  defaultModel?: string | null;
  approvalPolicy?: AskForApproval;
  sandboxMode?: SandboxMode;
};

export type WorkspaceUpdateInput = Partial<WorkspaceCreateInput>;

export type WorkspaceDismissInput = {
  absPath: string;
};

export type ThreadListEntry = {
  id: string;
  name: string | null;
  preview: string;
  archived: boolean;
  cwd: string;
  createdAt: number;
  updatedAt: number;
  status: ThreadStatus;
  modelProvider: string;
  source: SessionSource;
  agentNickname: string | null;
  agentRole: string | null;
  gitInfo: GitInfo | null;
  path: string | null;
  ephemeral: boolean;
  workspaceId: string | null;
  workspaceName: string | null;
};

export type HealthResponse = {
  status: "ok";
  bridge: import("./ws").BridgeStatus;
  codexCommand: string;
};

export type AccountResponse = {
  authenticated: boolean;
  requiresOpenaiAuth: boolean;
  accountType: "chatgpt" | "apiKey" | "unknown";
  email: string | null;
  planType: PlanType | null;
};

export type ModelsResponse = {
  data: Array<Model>;
};

export type ThreadsResponse = {
  data: Array<ThreadListEntry>;
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
