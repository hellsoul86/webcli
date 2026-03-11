import type {
  CommandSessionSnapshot,
  FuzzySearchSnapshot,
  IntegrationSnapshot,
  LivePlan,
  PendingApproval,
  ReasoningEffort,
  RequestId,
  ReviewOutput,
  RuntimeStatus,
  ThreadSummary,
  TimelineEntry,
  WorkbenchThread,
  WorkbenchTurn,
} from "./domain.js";

type RpcDefinition<TParams, TResult> = {
  params: TParams;
  result: TResult;
};

export type AppRequestMap = {
  "thread.open": RpcDefinition<{ workspaceId: string }, { thread: WorkbenchThread }>;
  "thread.resume": RpcDefinition<{ threadId: string }, { thread: WorkbenchThread }>;
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
    approvalPolicy: string | null;
    sandboxMode: string | null;
  }, { snapshot: IntegrationSnapshot }>;
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
  "thread.updated": { thread: ThreadSummary };
  "turn.updated": { threadId: string; turn: WorkbenchTurn };
  "timeline.item": { threadId: string; item: TimelineEntry };
  "timeline.delta": { threadId: string; item: TimelineEntry };
  "diff.updated": { threadId: string; diff: string };
  "plan.updated": { threadId: string; plan: LivePlan };
  "review.updated": { threadId: string; review: ReviewOutput | null };
  "command.output": {
    processId: string;
    stream: "stdout" | "stderr";
    text: string;
    session: CommandSessionSnapshot | null;
  };
  "approval.requested": { approval: PendingApproval };
  "approval.resolved": { requestId: RequestId };
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
        data?: unknown;
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
