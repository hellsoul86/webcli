import type {
  AccountSummary,
  AccountLoginCancelStatus,
  AccountLoginStartInput,
  AccountLoginStartResponse,
  AccountStateSnapshot,
  AppErrorPayload,
  CommandSessionSnapshot,
  FuzzySearchSnapshot,
  GitWorkingTreeSnapshot,
  GitBranchReference,
  IntegrationSnapshot,
  LivePlan,
  PendingApproval,
  PendingServerRequest,
  ReasoningEffort,
  RequestId,
  ReviewOutput,
  RuntimeStatus,
  ServiceTier,
  ThreadMetadataGitInfoUpdate,
  ThreadSummary,
  ThreadTokenUsage,
  TimelineEntry,
  WorkbenchThread,
  WorkbenchTurn,
} from "./domain.js";

type RpcDefinition<TParams, TResult> = {
  params: TParams;
  result: TResult;
};

export type AppRequestMap = {
  "account.read": RpcDefinition<Record<string, never>, {
    state: AccountStateSnapshot;
    snapshot: IntegrationSnapshot;
  }>;
  "account.login.start": RpcDefinition<AccountLoginStartInput, {
    login: AccountLoginStartResponse;
    state: AccountStateSnapshot;
    snapshot: IntegrationSnapshot;
  }>;
  "account.login.cancel": RpcDefinition<{ loginId: string }, {
    status: AccountLoginCancelStatus;
    state: AccountStateSnapshot;
    snapshot: IntegrationSnapshot;
  }>;
  "account.logout": RpcDefinition<Record<string, never>, {
    state: AccountStateSnapshot;
    snapshot: IntegrationSnapshot;
  }>;
  "thread.open": RpcDefinition<{ workspaceId: string }, { thread: WorkbenchThread }>;
  "thread.resume": RpcDefinition<{ threadId: string }, { thread: WorkbenchThread }>;
  "thread.list": RpcDefinition<{
    archived: boolean;
    cursor?: string | null;
    limit?: number | null;
    workspaceId?: string | "all";
  }, {
    items: Array<ThreadSummary>;
    nextCursor: string | null;
  }>;
  "thread.read": RpcDefinition<{ threadId: string }, { thread: WorkbenchThread }>;
  "thread.metadata.update": RpcDefinition<{
    threadId: string;
    gitInfo?: ThreadMetadataGitInfoUpdate | null;
  }, { thread: WorkbenchThread }>;
  "thread.unsubscribe": RpcDefinition<{ threadId: string }, {
    status: "notLoaded" | "notSubscribed" | "unsubscribed";
  }>;
  "thread.rename": RpcDefinition<{ threadId: string; name: string }, { ok: true }>;
  "thread.archive": RpcDefinition<{ threadId: string }, { ok: true }>;
  "thread.unarchive": RpcDefinition<{ threadId: string }, { thread: WorkbenchThread }>;
  "thread.fork": RpcDefinition<{ threadId: string }, { thread: WorkbenchThread }>;
  "thread.compact": RpcDefinition<{ threadId: string }, { ok: true }>;
  "thread.rollback": RpcDefinition<{ threadId: string; numTurns: number }, { thread: WorkbenchThread }>;
  "turn.start": RpcDefinition<{
    threadId: string;
    prompt: string;
    effort?: ReasoningEffort | null;
  }, { turn: WorkbenchTurn }>;
  "turn.interrupt": RpcDefinition<{ threadId: string; turnId: string }, { ok: true }>;
  "turn.steer": RpcDefinition<{ threadId: string; turnId: string; prompt: string }, { ok: true }>;
  "review.start": RpcDefinition<{ threadId: string }, { turn: WorkbenchTurn | null }>;
  "command.start": RpcDefinition<{
    workspaceId: string;
    command: string;
    cols: number;
    rows: number;
  }, { session: CommandSessionSnapshot }>;
  "command.write": RpcDefinition<{ processId: string; text: string }, { ok: true }>;
  "command.resize": RpcDefinition<{ processId: string; cols: number; rows: number }, { ok: true }>;
  "command.stop": RpcDefinition<{ processId: string }, { ok: true }>;
  "approval.resolve": RpcDefinition<{
    requestId: RequestId;
    decision: "accept" | "decline";
  }, { ok: true }>;
  "serverRequest.resolve": RpcDefinition<{
    requestId: RequestId;
    decision: "accept" | "decline";
  }, { ok: true }>;
  "integrations.refresh": RpcDefinition<{
    workspaceId?: string | "all";
    threadId?: string | null;
  }, { snapshot: IntegrationSnapshot }>;
  "integrations.mcp.login": RpcDefinition<{ name: string }, { authorizationUrl: string }>;
  "integrations.mcp.reload": RpcDefinition<Record<string, never>, { snapshot: IntegrationSnapshot }>;
  "integrations.plugin.uninstall": RpcDefinition<{
    pluginId: string;
    workspaceId?: string | "all";
    threadId?: string | null;
  }, { snapshot: IntegrationSnapshot }>;
  "settings.save": RpcDefinition<{
    model: string | null;
    reasoningEffort: ReasoningEffort | null;
    serviceTier: ServiceTier | null;
    approvalPolicy: string | null;
    sandboxMode: string | null;
    forcedLoginMethod: import("./domain.js").ForcedLoginMethod | null;
  }, { snapshot: IntegrationSnapshot }>;
  "workspace.git.read": RpcDefinition<{
    workspaceId: string;
  }, { snapshot: GitWorkingTreeSnapshot }>;
  "workspace.git.branches.read": RpcDefinition<{
    workspaceId: string;
  }, { branches: Array<GitBranchReference>; currentBranch: string | null }>;
  "workspace.git.branch.switch": RpcDefinition<{
    workspaceId: string;
    branch: string;
  }, { snapshot: GitWorkingTreeSnapshot; branches: Array<GitBranchReference>; currentBranch: string | null }>;
  "workspace.git.file.read": RpcDefinition<{
    workspaceId: string;
    path: string;
  }, { detail: import("./domain.js").GitFileReviewDetail }>;
  "workspace.searchFiles": RpcDefinition<{
    workspaceId: string;
    query: string;
  }, { search: FuzzySearchSnapshot }>;
};

export type AppRequestMethod = keyof AppRequestMap;
export type AppRequestParams<TMethod extends AppRequestMethod> = AppRequestMap[TMethod]["params"];
export type AppRequestResult<TMethod extends AppRequestMethod> = AppRequestMap[TMethod]["result"];

export type AppEventMap = {
  "runtime.statusChanged": { runtime: RuntimeStatus };
  "account.updated": { account: AccountSummary };
  "thread.updated": { thread: ThreadSummary };
  "thread.closed": { threadId: string };
  "thread.tokenUsageUpdated": {
    threadId: string;
    turnId: string;
    tokenUsage: ThreadTokenUsage;
  };
  "turn.updated": { threadId: string; turn: WorkbenchTurn };
  "timeline.item": { threadId: string; item: TimelineEntry };
  "timeline.delta": { threadId: string; item: TimelineEntry };
  "diff.updated": { threadId: string; diff: string };
  "plan.updated": { threadId: string; plan: LivePlan };
  "review.updated": { threadId: string; review: ReviewOutput | null };
  "workspace.git.updated": { snapshot: GitWorkingTreeSnapshot };
  "command.output": {
    processId: string;
    stream: "stdout" | "stderr";
    text: string;
    session: CommandSessionSnapshot | null;
  };
  "approval.requested": { approval: PendingApproval };
  "approval.resolved": { requestId: RequestId };
  "serverRequest.requested": { request: PendingServerRequest };
  "serverRequest.resolved": { requestId: RequestId };
  "integrations.updated": { snapshot: IntegrationSnapshot };
};

export type AppEventMethod = keyof AppEventMap;
export type AppEventParams<TMethod extends AppEventMethod> = AppEventMap[TMethod];

export type AppClientCallEnvelope<
  TMethod extends AppRequestMethod = AppRequestMethod,
> = TMethod extends AppRequestMethod
  ? {
      type: "client.call";
      id: RequestId;
      method: TMethod;
      params: AppRequestParams<TMethod>;
    }
  : never;

export type AppServerResponseEnvelope<
  TMethod extends AppRequestMethod = AppRequestMethod,
> = TMethod extends AppRequestMethod
  ? {
      type: "server.response";
      id: RequestId;
      result?: AppRequestResult<TMethod>;
      error?: {
        code: number;
        message: string;
        data?: AppErrorPayload;
      };
    }
  : never;

export type AppServerNotificationEnvelope<
  TMethod extends AppEventMethod = AppEventMethod,
> = TMethod extends AppEventMethod
  ? {
      type: "server.notification";
      method: TMethod;
      params: AppEventParams<TMethod>;
    }
  : never;

export type AppClientMessage = AppClientCallEnvelope;
export type AppServerMessage = AppServerResponseEnvelope | AppServerNotificationEnvelope;
