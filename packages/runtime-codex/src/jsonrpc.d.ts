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
export declare function encodeJsonRpcLine(message: JsonRpcMessage): string;
export declare function parseJsonRpcLine(line: string): JsonRpcMessage;
export declare function isJsonRpcRequest(value: JsonRpcMessage): value is JsonRpcRequest;
export declare function isJsonRpcNotification(value: JsonRpcMessage): value is JsonRpcNotification;
export declare function isJsonRpcResponse(value: JsonRpcMessage): value is JsonRpcResponse;
//# sourceMappingURL=jsonrpc.d.ts.map