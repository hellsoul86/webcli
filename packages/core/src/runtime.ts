import type {
  AccountLoginCompleted,
  AccountLoginCancelStatus,
  AccountLoginStartInput,
  AccountLoginStartResponse,
  AccountRateLimitsSnapshot,
  AccountStateSnapshot,
  AccountSummary,
  AppInstallHint,
  ApprovalPolicy,
  CommandSessionSnapshot,
  ConfigBatchWriteInput,
  ConfigBatchWriteResult,
  ConfigRequirementsSnapshot,
  ConfigWarningNotice,
  ConfigSnapshot,
  DeprecationNotice,
  ExternalAgentConfigDetectInput,
  ExternalAgentConfigMigrationItem,
  FuzzySearchSnapshot,
  GitBranchReference,
  GitFileReviewDetail,
  GitWorkingTreeFile,
  GitWorkingTreeSnapshot,
  HazelnutScope,
  IntegrationSnapshot,
  ModelOption,
  McpServerSnapshot,
  ModelRerouteEvent,
  PendingServerRequest,
  PluginMarketplaceSnapshot,
  ProductSurface,
  ReasoningEffort,
  RemoteSkillExportResult,
  RemoteSkillSummary,
  RuntimeStatus,
  SandboxMode,
  ThreadMetadataGitInfoUpdate,
  ThreadTokenUsage,
  SkillGroupSnapshot,
  TimelineEntry,
  ThreadRuntimeStatus,
  AppSnapshot,
} from "@webcli/contracts";

export type RuntimeTurnRecord = {
  id: string;
  status: string;
  errorMessage: string | null;
  tokenUsage: ThreadTokenUsage | null;
  items: Array<TimelineEntry>;
};

export type RuntimeThreadRecord = {
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
  turns: Array<RuntimeTurnRecord>;
};

export type RuntimeThreadConfig = {
  cwd: string;
  model: string | null;
  approvalPolicy: ApprovalPolicy;
  sandboxMode: SandboxMode;
};

export type SessionRuntimeEvent =
  | { type: "status.changed"; status: RuntimeStatus }
  | { type: "account.updated"; account: AccountSummary }
  | { type: "account.login.completed"; login: AccountLoginCompleted }
  | { type: "account.rateLimits.updated"; rateLimits: AccountRateLimitsSnapshot }
  | { type: "model.rerouted"; reroute: ModelRerouteEvent }
  | { type: "config.warning"; warning: ConfigWarningNotice }
  | { type: "deprecation.notice"; notice: DeprecationNotice }
  | { type: "thread.updated"; thread: RuntimeThreadRecord }
  | {
      type: "thread.status.changed";
      threadId: string;
      status: ThreadRuntimeStatus;
    }
  | {
      type: "thread.name.changed";
      threadId: string;
      name: string | null;
    }
  | {
      type: "thread.archive.changed";
      threadId: string;
      archived: boolean;
    }
  | {
      type: "thread.closed";
      threadId: string;
    }
  | {
      type: "thread.tokenUsage.updated";
      threadId: string;
      turnId: string;
      tokenUsage: ThreadTokenUsage;
    }
  | {
      type: "turn.updated";
      threadId: string;
      turn: RuntimeTurnRecord;
    }
  | {
      type: "timeline.item";
      threadId: string;
      item: TimelineEntry;
    }
  | {
      type: "timeline.delta";
      threadId: string;
      item: TimelineEntry;
    }
  | {
      type: "diff.updated";
      threadId: string;
      diff: string;
    }
  | {
      type: "plan.updated";
      threadId: string;
      turnId: string;
      explanation: string | null;
      plan: Array<{ step: string; status: string }>;
    }
  | {
      type: "review.updated";
      threadId: string;
      review: import("@webcli/contracts").ReviewOutput | null;
    }
  | {
      type: "approval.requested";
      approval: PendingServerRequest;
    }
  | {
      type: "approval.resolved";
      requestId: string;
    }
  | {
      type: "command.output";
      processId: string;
      stream: "stdout" | "stderr";
      text: string;
    }
  | {
      type: "command.completed";
      processId: string;
      session: {
        status: "completed" | "failed";
        exitCode: number | null;
        stdout: string;
        stderr: string;
      };
    }
  | { type: "skills.changed" }
  | { type: "app.list.updated"; apps: Array<AppSnapshot> };

export type SessionRuntimeListener = (event: SessionRuntimeEvent) => void;

export interface SessionRuntime {
  start(): Promise<void>;
  stop(): Promise<void>;
  subscribe(listener: SessionRuntimeListener): () => void;
  getStatus(): RuntimeStatus;
  getAccountSummary(force?: boolean): Promise<AccountSummary>;
  readAccountState(): Promise<AccountStateSnapshot>;
  readAccountRateLimits(): Promise<AccountRateLimitsSnapshot>;
  loginAccount(input: AccountLoginStartInput): Promise<AccountLoginStartResponse>;
  cancelAccountLogin(loginId: string): Promise<AccountLoginCancelStatus>;
  logoutAccount(): Promise<void>;
  listModels(): Promise<Array<ModelOption>>;
  listThreads(archived: boolean): Promise<Array<RuntimeThreadRecord>>;
  readThread(threadId: string): Promise<RuntimeThreadRecord>;
  listLoadedThreadIds(): Promise<Array<string>>;
  openThread(input: RuntimeThreadConfig): Promise<RuntimeThreadRecord>;
  resumeThread(threadId: string, path?: string | null): Promise<RuntimeThreadRecord>;
  updateThreadMetadata(
    threadId: string,
    input: { gitInfo?: ThreadMetadataGitInfoUpdate | null },
  ): Promise<RuntimeThreadRecord>;
  unsubscribeThread(
    threadId: string,
  ): Promise<"notLoaded" | "notSubscribed" | "unsubscribed">;
  renameThread(threadId: string, name: string): Promise<void>;
  archiveThread(threadId: string, path?: string | null): Promise<void>;
  unarchiveThread(threadId: string): Promise<RuntimeThreadRecord>;
  forkThread(threadId: string, cwd: string): Promise<RuntimeThreadRecord>;
  compactThread(threadId: string): Promise<void>;
  rollbackThread(threadId: string, numTurns: number): Promise<RuntimeThreadRecord>;
  startTurn(
    threadId: string,
    prompt: string,
    effort?: ReasoningEffort | null,
  ): Promise<RuntimeTurnRecord>;
  interruptTurn(threadId: string, turnId: string): Promise<void>;
  steerTurn(threadId: string, turnId: string, prompt: string): Promise<void>;
  startReview(threadId: string): Promise<RuntimeTurnRecord | null>;
  startCommand(input: {
    processId: string;
    command: string;
    cwd: string;
    cols: number;
    rows: number;
  }): Promise<void>;
  writeCommand(processId: string, text: string): Promise<void>;
  resizeCommand(processId: string, cols: number, rows: number): Promise<void>;
  stopCommand(processId: string): Promise<void>;
  readConfigSnapshot(cwd?: string | null): Promise<ConfigSnapshot | null>;
  readConfigRequirements(): Promise<ConfigRequirementsSnapshot | null>;
  batchWriteConfig(input: ConfigBatchWriteInput): Promise<ConfigBatchWriteResult>;
  detectExternalAgentConfig(
    input: ExternalAgentConfigDetectInput,
  ): Promise<Array<ExternalAgentConfigMigrationItem>>;
  importExternalAgentConfig(items: Array<ExternalAgentConfigMigrationItem>): Promise<void>;
  getIntegrationSnapshot(input: {
    cwd?: string | null;
    threadId?: string | null;
  }): Promise<IntegrationSnapshot>;
  saveSettings(input: ConfigSnapshot): Promise<void>;
  readWorkspaceGitSnapshot(
    cwd: string,
    workspaceId: string,
    workspaceName: string,
  ): Promise<GitWorkingTreeSnapshot>;
  readWorkspaceGitBranches(
    cwd: string,
  ): Promise<{ branches: Array<GitBranchReference>; currentBranch: string | null }>;
  switchWorkspaceGitBranch(cwd: string, branch: string): Promise<void>;
  readWorkspaceGitFileDetail(cwd: string, file: GitWorkingTreeFile): Promise<GitFileReviewDetail>;
  loginMcp(name: string): Promise<string>;
  reloadMcp(): Promise<void>;
  listMcpServerStatuses(): Promise<Array<McpServerSnapshot>>;
  listSkills(cwd?: string | null): Promise<Array<SkillGroupSnapshot>>;
  listRemoteSkills(input: {
    hazelnutScope: HazelnutScope;
    productSurface: ProductSurface;
    enabled: boolean;
  }): Promise<Array<RemoteSkillSummary>>;
  exportRemoteSkill(hazelnutId: string): Promise<RemoteSkillExportResult>;
  writeSkillConfig(path: string, enabled: boolean): Promise<{ effectiveEnabled: boolean }>;
  listApps(input: {
    threadId?: string | null;
    forceRefetch?: boolean;
  }): Promise<Array<AppSnapshot>>;
  listPlugins(cwd?: string | null): Promise<Array<PluginMarketplaceSnapshot>>;
  installPlugin(input: {
    marketplacePath: string;
    pluginName: string;
  }): Promise<{ appsNeedingAuth: Array<AppInstallHint> }>;
  uninstallPlugin(pluginId: string): Promise<void>;
  searchFiles(input: { query: string; roots: Array<string> }): Promise<FuzzySearchSnapshot>;
  resolveApproval(approval: PendingServerRequest, decision: "accept" | "decline"): Promise<void>;
}
