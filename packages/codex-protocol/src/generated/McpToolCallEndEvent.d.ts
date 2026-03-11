import type { CallToolResult } from "./CallToolResult";
import type { McpInvocation } from "./McpInvocation";
export type McpToolCallEndEvent = {
    /**
     * Identifier for the corresponding McpToolCallBegin that finished.
     */
    call_id: string;
    invocation: McpInvocation;
    duration: string;
    /**
     * Result of the tool call. Note this could be an error.
     */
    result: {
        Ok: CallToolResult;
    } | {
        Err: string;
    };
};
//# sourceMappingURL=McpToolCallEndEvent.d.ts.map