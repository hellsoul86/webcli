import type { RequestId } from "./generated/RequestId";
import type { ClientRequest } from "./generated/ClientRequest";
import type { ServerNotification } from "./generated/ServerNotification";
import type { ServerRequest } from "./generated/ServerRequest";
import type { Account } from "./generated/v2/Account";
import type { PlanType } from "./generated/PlanType";

type ExtractParams<
  TUnion extends { method: string },
  TMethod extends TUnion["method"],
> = Extract<TUnion, { method: TMethod }> extends { params: infer TParams }
  ? TParams
  : never;

export type ClientRequestMethod = ClientRequest["method"];
export type ServerNotificationMethod = ServerNotification["method"];
export type ServerRequestMethod = ServerRequest["method"];

export type ClientRequestParams<TMethod extends ClientRequestMethod> = ExtractParams<
  ClientRequest,
  TMethod
>;

export type ServerNotificationParams<
  TMethod extends ServerNotificationMethod,
> = ExtractParams<ServerNotification, TMethod>;

export type ServerRequestParams<TMethod extends ServerRequestMethod> = ExtractParams<
  ServerRequest,
  TMethod
>;

export type ServerRequestResultMap = {
  "item/commandExecution/requestApproval": import("./generated/v2/CommandExecutionRequestApprovalResponse").CommandExecutionRequestApprovalResponse;
  "item/fileChange/requestApproval": import("./generated/v2/FileChangeRequestApprovalResponse").FileChangeRequestApprovalResponse;
  "item/tool/requestUserInput": import("./generated/v2/ToolRequestUserInputResponse").ToolRequestUserInputResponse;
  "mcpServer/elicitation/request": import("./generated/v2/McpServerElicitationRequestResponse").McpServerElicitationRequestResponse;
  "item/permissions/requestApproval": import("./generated/v2/PermissionsRequestApprovalResponse").PermissionsRequestApprovalResponse;
  "item/tool/call": import("./generated/v2/DynamicToolCallResponse").DynamicToolCallResponse;
  "account/chatgptAuthTokens/refresh": import("./generated/v2/ChatgptAuthTokensRefreshResponse").ChatgptAuthTokensRefreshResponse;
  applyPatchApproval: import("./generated/ApplyPatchApprovalResponse").ApplyPatchApprovalResponse;
  execCommandApproval: import("./generated/ExecCommandApprovalResponse").ExecCommandApprovalResponse;
};

export type ServerRequestResult<TMethod extends ServerRequestMethod> =
  ServerRequestResultMap[Extract<TMethod, keyof ServerRequestResultMap>];

export type BridgeStatus = {
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
  accountType: Account["type"] | "unknown";
  email: string | null;
  planType: PlanType | null;
  usageWindows: Array<{
    label: string;
    remainingPercent: number | null;
    usedPercent: number | null;
    resetsAt: number | null;
  }>;
};

export type ClientCallEnvelope<
  TMethod extends ClientRequestMethod | ServerRequestMethod =
    | ClientRequestMethod
    | ServerRequestMethod,
> = {
  type: "client.call";
  id: RequestId;
  method: TMethod;
  params: TMethod extends ClientRequestMethod
    ? ClientRequestParams<TMethod>
    : TMethod extends ServerRequestMethod
      ? ServerRequestResult<TMethod>
      : never;
};

export type ServerResponseEnvelope = {
  type: "server.response";
  id: RequestId;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
};

export type ServerNotificationEnvelope<
  TMethod extends ServerNotificationMethod | ServerRequestMethod | "server.status" =
    | ServerNotificationMethod
    | ServerRequestMethod
    | "server.status",
> = TMethod extends "server.status"
  ? {
      type: "server.notification";
      method: "server.status";
      params: BridgeStatus;
    }
  : TMethod extends ServerNotificationMethod
    ? {
        type: "server.notification";
        method: TMethod;
        params: ServerNotificationParams<TMethod>;
      }
    : {
        type: "server.notification";
        id: RequestId;
        method: TMethod;
        params: ServerRequestParams<Extract<TMethod, ServerRequestMethod>>;
      };

export type ClientWsMessage = ClientCallEnvelope;
export type ServerWsMessage = ServerResponseEnvelope | ServerNotificationEnvelope;
