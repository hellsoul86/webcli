export type RequestId = string | number;

export type AppErrorCode =
  | "invalid.json"
  | "resource.path_required"
  | "resource.not_found"
  | "resource.outside_scope"
  | "thread_summaries.invalid_query"
  | "workspace.not_found"
  | "workspace.payload_required"
  | "workspace.name_required"
  | "workspace.path_required"
  | "workspace.not_directory"
  | "workspace.outside_home"
  | "thread.not_found"
  | "approval.not_pending"
  | "git.not_repo"
  | "git.file_not_found"
  | "git.file_read_failed"
  | "git.branch_switch_failed"
  | "account.api_key_invalid"
  | "account.login_canceled"
  | "account.auth_required"
  | "account.chatgpt_tokens_invalid"
  | "account.device_code_start_failed";

export type AppErrorPayload = {
  code: AppErrorCode;
  message: string;
  params?: Record<string, string | number | boolean | null>;
};

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly params?: Record<string, string | number | boolean | null>;

  constructor(
    code: AppErrorCode,
    message: string,
    params?: Record<string, string | number | boolean | null>,
  ) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.params = params;
  }

  toPayload(): AppErrorPayload {
    return {
      code: this.code,
      message: this.message,
      ...(this.params ? { params: this.params } : {}),
    };
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}

export type ApprovalPolicy = "on-request" | "on-failure" | "untrusted" | "never";
export type SandboxMode = "danger-full-access" | "workspace-write" | "read-only";
export type ReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh";
export type ServiceTier = "fast" | "flex";
export type SettingsTab =
  | "account"
  | "general"
  | "defaults"
  | "integrations"
  | "extensions"
  | "history";
export type InspectorTab = "diff" | "review" | "plan" | "command" | "mcp";
export type ThreadArchiveMode = "active" | "archived";
export type ForcedLoginMethod = "chatgpt" | "api";
export type TimelineItemKind =
  | "userMessage"
  | "agentMessage"
  | "plan"
  | "reasoning"
  | "commandExecution"
  | "fileChange"
  | "mcpToolCall"
  | "dynamicToolCall"
  | "collabAgentToolCall"
  | "webSearch"
  | "imageView"
  | "imageGeneration"
  | "enteredReviewMode"
  | "exitedReviewMode"
  | "contextCompaction";

export type ThreadRuntimeStatus =
  | { type: "notLoaded" }
  | { type: "idle" }
  | { type: "systemError" }
  | { type: "active"; activeFlags: Array<string> };

export type RuntimeStatus = {
  connected: boolean;
  childPid: number | null;
  authenticated: boolean;
  requiresOpenaiAuth: boolean;
  restartCount: number;
  lastError: string | null;
};

export type AccountUsageWindow = {
  label: string;
  remainingPercent: number | null;
  usedPercent: number | null;
  resetsAt: number | null;
};

export type AccountSummary = {
  authenticated: boolean;
  requiresOpenaiAuth: boolean;
  accountType: "chatgpt" | "apiKey" | "unknown";
  email: string | null;
  planType: string | null;
  usageWindows: Array<AccountUsageWindow>;
};

export type ModelOption = {
  id: string;
  model: string;
  displayName: string;
  description: string;
  upgradeModel: string | null;
  supportedReasoningEfforts: Array<{
    reasoningEffort: ReasoningEffort;
    description: string;
  }>;
  defaultReasoningEffort: ReasoningEffort;
  hidden: boolean;
  isDefault: boolean;
};

export type WorkspaceRecord = {
  id: string;
  name: string;
  absPath: string;
  source: "saved" | "derived";
  defaultModel: string | null;
  approvalPolicy: ApprovalPolicy;
  sandboxMode: SandboxMode;
  createdAt: string;
  updatedAt: string;
};

export type WorkspaceCreateInput = {
  name: string;
  absPath: string;
  defaultModel?: string | null;
  approvalPolicy?: ApprovalPolicy;
  sandboxMode?: SandboxMode;
};

export type WorkspaceUpdateInput = Partial<WorkspaceCreateInput>;

export type WorkspaceDismissInput = {
  absPath: string;
};

export type ThreadSummary = {
  id: string;
  name: string | null;
  preview: string;
  archived: boolean;
  cwd: string;
  createdAt: number;
  updatedAt: number;
  status: ThreadRuntimeStatus;
  modelProvider: string;
  source: string;
  agentNickname: string | null;
  agentRole: string | null;
  gitInfo: unknown;
  path: string | null;
  ephemeral: boolean;
  workspaceId: string | null;
  workspaceName: string | null;
};

export type TimelineEntry = {
  id: string;
  turnId: string;
  kind: TimelineItemKind | string;
  title: string;
  body: string;
  raw: unknown;
};

export type TurnRecord = {
  id: string;
  status: string;
  errorMessage: string | null;
};

export type WorkbenchTurn = {
  turn: TurnRecord;
  itemOrder: Array<string>;
  items: Record<string, TimelineEntry>;
};

export type LivePlanStep = {
  step: string;
  status: string;
};

export type LivePlan = {
  turnId: string;
  explanation: string | null;
  plan: Array<LivePlanStep>;
};

export type ReviewCodeLocation = {
  absolute_file_path: string;
  line_range: {
    start: number;
    end: number;
  };
};

export type ReviewFinding = {
  title: string;
  body: string;
  confidence_score: number;
  priority: number;
  code_location: ReviewCodeLocation;
};

export type ReviewOutput = {
  findings: Array<ReviewFinding>;
  overall_correctness: string;
  overall_explanation: string;
  overall_confidence_score: number;
};

export type GitWorkingTreeFileStatus =
  | "modified"
  | "added"
  | "deleted"
  | "renamed"
  | "copied"
  | "untracked"
  | "typechange"
  | "conflicted";

export type GitWorkingTreeFile = {
  path: string;
  status: GitWorkingTreeFileStatus;
  staged: boolean;
  unstaged: boolean;
  additions: number;
  deletions: number;
  patch: string;
  oldPath?: string | null;
};

export type GitWorkingTreeSnapshot = {
  workspaceId: string;
  workspaceName: string;
  repoRoot: string | null;
  branch: string | null;
  isGitRepository: boolean;
  clean: boolean;
  stagedCount: number;
  unstagedCount: number;
  untrackedCount: number;
  generatedAt: number;
  files: Array<GitWorkingTreeFile>;
};

export type GitBranchReference = {
  name: string;
  current: boolean;
};

export type GitFileReviewDetail =
  | {
      path: string;
      oldPath: string | null;
      status: GitWorkingTreeFileStatus;
      language: string | null;
      mode: "inline-diff";
      originalText: string;
      modifiedText: string;
    }
  | {
      path: string;
      oldPath: string | null;
      status: GitWorkingTreeFileStatus;
      language: string | null;
      mode: "patch" | "binary" | "unavailable";
      patch: string;
      reason: string;
    };

export type WorkbenchThread = {
  thread: ThreadSummary;
  archived: boolean;
  turnOrder: Array<string>;
  turns: Record<string, WorkbenchTurn>;
  latestDiff: string;
  latestPlan: LivePlan | null;
  review: ReviewOutput | null;
};

export type PendingApproval = {
  id: RequestId;
  method: string;
  threadId: string | null;
  turnId: string | null;
  itemId: string | null;
  params: unknown;
};

export type CommandSessionSnapshot = {
  processId: string;
  command: string;
  cwd: string | null;
  tty: boolean;
  allowStdin: boolean;
  status: "running" | "completed" | "failed";
  stdout: string;
  stderr: string;
  exitCode: number | null;
  createdAt: number;
};

export type FuzzyFileSearchResult = {
  path: string;
  score: number;
};

export type FuzzySearchSnapshot = {
  sessionId: string | null;
  query: string;
  status: "idle" | "loading" | "completed";
  results: Array<FuzzyFileSearchResult>;
};

export type AuthStatusSnapshot = {
  authMethod: string | null;
  requiresOpenaiAuth: boolean;
};

export type ConfigSnapshot = {
  model: string | null;
  reasoningEffort: ReasoningEffort | null;
  serviceTier: ServiceTier | null;
  approvalPolicy: ApprovalPolicy | null;
  sandboxMode: SandboxMode | null;
  forcedLoginMethod: ForcedLoginMethod | null;
};

export type AccountStateSnapshot = {
  account: AccountSummary;
  authStatus: AuthStatusSnapshot | null;
};

export type AccountLoginStartInput =
  | {
      type: "chatgpt";
    }
  | {
      type: "deviceCode";
    }
  | {
      type: "apiKey";
      apiKey: string;
    }
  | {
      type: "chatgptAuthTokens";
      accessToken: string;
      chatgptAccountId: string;
      chatgptPlanType?: string | null;
    };

export type AccountLoginStartResponse =
  | {
      type: "chatgpt";
      loginId: string;
      authUrl: string;
    }
  | {
      type: "deviceCode";
      loginId: string;
      verificationUrl: string;
      userCode: string;
      expiresAt: number | null;
    }
  | {
      type: "apiKey";
    }
  | {
      type: "chatgptAuthTokens";
    };

export type AccountLoginCancelStatus = "canceled" | "notFound";

export type McpServerSnapshot = {
  name: string;
  authStatus: string;
  toolsCount: number;
  resourcesCount: number;
};

export type SkillSummary = {
  name: string;
};

export type SkillErrorSummary = {
  message: string;
};

export type SkillGroupSnapshot = {
  cwd: string;
  skills: Array<SkillSummary>;
  errors: Array<SkillErrorSummary>;
};

export type AppSnapshot = {
  id: string;
  name: string;
  description: string | null;
  isAccessible: boolean;
  pluginDisplayNames: Array<string>;
  installUrl: string | null;
};

export type PluginSnapshot = {
  id: string;
  name: string;
  installed: boolean;
  enabled: boolean;
};

export type PluginMarketplaceSnapshot = {
  path: string;
  name: string;
  plugins: Array<PluginSnapshot>;
};

export type IntegrationSnapshot = {
  authStatus: AuthStatusSnapshot | null;
  config: ConfigSnapshot | null;
  mcpServers: Array<McpServerSnapshot>;
  skills: Array<SkillGroupSnapshot>;
  apps: Array<AppSnapshot>;
  plugins: Array<PluginMarketplaceSnapshot>;
};

export type BootstrapSettingsSummary = {
  config: ConfigSnapshot | null;
};
