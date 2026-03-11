import type { JsonValue } from "./serde_json/JsonValue";
/**
 * The server's response to a tool call.
 */
export type CallToolResult = {
    content: Array<JsonValue>;
    structuredContent?: JsonValue;
    isError?: boolean;
    _meta?: JsonValue;
};
//# sourceMappingURL=CallToolResult.d.ts.map