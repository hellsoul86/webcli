export function encodeJsonRpcLine(message) {
    return `${JSON.stringify(message)}\n`;
}
export function parseJsonRpcLine(line) {
    return JSON.parse(line);
}
export function isJsonRpcRequest(value) {
    return "method" in value && "id" in value;
}
export function isJsonRpcNotification(value) {
    return "method" in value && !("id" in value);
}
export function isJsonRpcResponse(value) {
    return "id" in value && !("method" in value);
}
//# sourceMappingURL=jsonrpc.js.map