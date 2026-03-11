import type { RequestId } from "./generated/RequestId";

export type JsonRpcVersion = "2.0";

export type JsonRpcRequest<TMethod extends string = string, TParams = unknown> = {
  jsonrpc: JsonRpcVersion;
  id: RequestId;
  method: TMethod;
  params: TParams;
};

export type JsonRpcNotification<TMethod extends string = string, TParams = unknown> = {
  jsonrpc: JsonRpcVersion;
  method: TMethod;
  params: TParams;
};

export type JsonRpcError = {
  code: number;
  message: string;
  data?: unknown;
};

export type JsonRpcResponse<TResult = unknown> = {
  jsonrpc?: JsonRpcVersion;
  id: RequestId;
  result?: TResult;
  error?: JsonRpcError;
};

export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse;

export function encodeJsonRpcLine(message: JsonRpcMessage): string {
  return `${JSON.stringify(message)}\n`;
}

export function parseJsonRpcLine(line: string): JsonRpcMessage {
  return JSON.parse(line) as JsonRpcMessage;
}

export function isJsonRpcRequest(value: JsonRpcMessage): value is JsonRpcRequest {
  return "method" in value && "id" in value;
}

export function isJsonRpcNotification(
  value: JsonRpcMessage,
): value is JsonRpcNotification {
  return "method" in value && !("id" in value);
}

export function isJsonRpcResponse(value: JsonRpcMessage): value is JsonRpcResponse {
  return "id" in value && !("method" in value);
}

