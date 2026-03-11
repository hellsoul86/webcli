import type { JsonValue } from "./serde_json/JsonValue";
export type McpInvocation = {
    /**
     * Name of the MCP server as defined in the config.
     */
    server: string;
    /**
     * Name of the tool as given by the MCP server.
     */
    tool: string;
    /**
     * Arguments to the tool call.
     */
    arguments: JsonValue | null;
};
//# sourceMappingURL=McpInvocation.d.ts.map