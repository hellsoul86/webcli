export type RequestId = string | number;
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | Array<JsonValue>
  | {
      [key: string]: JsonValue;
    };

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
export type HazelnutScope = "example" | "workspace-shared" | "all-shared" | "personal";
export type ProductSurface = "chatgpt" | "codex" | "api" | "atlas";
export type WebSearchMode = "disabled" | "cached" | "live";
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

export type AccountRateLimitWindowSnapshot = {
  windowDurationMins: number | null;
  usedPercent: number | null;
  remainingPercent: number | null;
  resetsAt: number | null;
};

export type AccountRateLimitSnapshot = {
  primary: AccountRateLimitWindowSnapshot | null;
  secondary: AccountRateLimitWindowSnapshot | null;
};

export type AccountRateLimitsSnapshot = {
  rateLimits: AccountRateLimitSnapshot;
  rateLimitsByLimitId: Record<string, AccountRateLimitSnapshot | null>;
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

export type ThreadMetadataGitInfoUpdate = {
  sha?: string | null;
  branch?: string | null;
  originUrl?: string | null;
};

export type TokenUsageBreakdown = {
  totalTokens: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
};

export type ThreadTokenUsage = {
  total: TokenUsageBreakdown;
  last: TokenUsageBreakdown;
  modelContextWindow: number | null;
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
  tokenUsage?: ThreadTokenUsage | null;
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

export type PendingServerRequestMethod =
  | "item/commandExecution/requestApproval"
  | "item/fileChange/requestApproval"
  | "item/tool/requestUserInput"
  | "mcpServer/elicitation/request"
  | "item/permissions/requestApproval"
  | "item/tool/call"
  | "account/chatgptAuthTokens/refresh"
  | "applyPatchApproval"
  | "execCommandApproval";

export type PendingServerRequestKind =
  | "commandExecutionApproval"
  | "fileChangeApproval"
  | "requestUserInput"
  | "mcpServerElicitation"
  | "permissionsApproval"
  | "dynamicToolCall"
  | "chatgptAuthTokensRefresh"
  | "applyPatchApproval"
  | "execCommandApproval";

type PendingServerRequestBase<
  TKind extends PendingServerRequestKind,
  TMethod extends PendingServerRequestMethod,
> = {
  id: RequestId;
  kind: TKind;
  method: TMethod;
  threadId: string | null;
  turnId: string | null;
  itemId: string | null;
  params: Record<string, unknown>;
};

export type PendingServerRequest =
  | PendingServerRequestBase<"commandExecutionApproval", "item/commandExecution/requestApproval">
  | PendingServerRequestBase<"fileChangeApproval", "item/fileChange/requestApproval">
  | PendingServerRequestBase<"requestUserInput", "item/tool/requestUserInput">
  | PendingServerRequestBase<"mcpServerElicitation", "mcpServer/elicitation/request">
  | PendingServerRequestBase<"permissionsApproval", "item/permissions/requestApproval">
  | PendingServerRequestBase<"dynamicToolCall", "item/tool/call">
  | PendingServerRequestBase<"chatgptAuthTokensRefresh", "account/chatgptAuthTokens/refresh">
  | PendingServerRequestBase<"applyPatchApproval", "applyPatchApproval">
  | PendingServerRequestBase<"execCommandApproval", "execCommandApproval">;

// Compatibility alias while the UI migrates from approval-focused naming.
export type PendingApproval = PendingServerRequest;

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

export type ConfigRequirementsSnapshot = {
  allowedApprovalPolicies: Array<ApprovalPolicy> | null;
  allowedSandboxModes: Array<SandboxMode> | null;
  allowedWebSearchModes: Array<WebSearchMode> | null;
  featureRequirements: Record<string, boolean> | null;
  enforceResidency: "us" | null;
};

export type ConfigMergeStrategy = "replace" | "upsert";

export type ConfigEdit = {
  keyPath: string;
  value: JsonValue;
  mergeStrategy: ConfigMergeStrategy;
};

export type ConfigBatchWriteInput = {
  edits: Array<ConfigEdit>;
  filePath?: string | null;
  expectedVersion?: string | null;
  reloadUserConfig?: boolean;
};

export type ConfigBatchWriteResult = {
  status: "ok" | "okOverridden";
  version: string;
  filePath: string;
  overriddenMessage: string | null;
};

export type ExternalAgentConfigMigrationItemType =
  | "AGENTS_MD"
  | "CONFIG"
  | "SKILLS"
  | "MCP_SERVER_CONFIG";

export type ExternalAgentConfigMigrationItem = {
  itemType: ExternalAgentConfigMigrationItemType;
  description: string;
  cwd: string | null;
};

export type ExternalAgentConfigDetectInput = {
  includeHome?: boolean;
  cwds?: Array<string> | null;
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

export type AccountLoginCompleted = {
  loginId: string | null;
  success: boolean;
  error: string | null;
};

export type TextPosition = {
  line: number;
  column: number;
};

export type TextRange = {
  start: TextPosition;
  end: TextPosition;
};

export type ConfigWarningNotice = {
  summary: string;
  details: string | null;
  path: string | null;
  range: TextRange | null;
};

export type DeprecationNotice = {
  summary: string;
  details: string | null;
};

export type ModelRerouteReason = "highRiskCyberActivity";

export type ModelRerouteEvent = {
  threadId: string;
  turnId: string;
  fromModel: string;
  toModel: string;
  reason: ModelRerouteReason;
};

export type McpServerSnapshot = {
  name: string;
  authStatus: string;
  toolsCount: number;
  resourcesCount: number;
};

export type SkillSummary = {
  name: string;
  description: string;
  shortDescription: string | null;
  path: string;
  enabled: boolean;
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
  isEnabled: boolean;
  pluginDisplayNames: Array<string>;
  installUrl: string | null;
};

export type AppInstallHint = {
  id: string;
  name: string;
  description: string | null;
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

export type RemoteSkillSummary = {
  id: string;
  name: string;
  description: string;
};

export type RemoteSkillExportResult = {
  id: string;
  path: string;
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
