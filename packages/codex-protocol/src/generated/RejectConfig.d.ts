export type RejectConfig = {
    /**
     * Reject approval prompts related to sandbox escalation.
     */
    sandbox_approval: boolean;
    /**
     * Reject prompts triggered by execpolicy `prompt` rules.
     */
    rules: boolean;
    /**
     * Reject MCP elicitation prompts.
     */
    mcp_elicitations: boolean;
};
//# sourceMappingURL=RejectConfig.d.ts.map