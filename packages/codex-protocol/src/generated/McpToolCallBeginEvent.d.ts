import type { McpInvocation } from "./McpInvocation";
export type McpToolCallBeginEvent = {
    /**
     * Identifier so this can be paired with the McpToolCallEnd event.
     */
    call_id: string;
    invocation: McpInvocation;
};
//# sourceMappingURL=McpToolCallBeginEvent.d.ts.map