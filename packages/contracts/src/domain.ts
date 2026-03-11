export type RequestId = string | number;

export type ApprovalPolicy = "on-request" | "on-failure" | "untrusted" | "never";
export type SandboxMode = "danger-full-access" | "workspace-write" | "read-only";
export type ReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh";
export type SettingsTab =
  | "general"
  | "integrations"
  | "skills"
  | "apps"
  | "plugins"
  | "archived";
export type InspectorTab = "diff" | "review" | "plan" | "command" | "mcp";
export type ThreadArchiveMode = "active" | "archived";
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

export type AccountSummary = {
  authenticated: boolean;
  requiresOpenaiAuth: boolean;
  accountType: "chatgpt" | "apiKey" | "unknown";
  email: string | null;
  planType: string | null;
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
  approvalPolicy: ApprovalPolicy | null;
  sandboxMode: SandboxMode | null;
};

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
