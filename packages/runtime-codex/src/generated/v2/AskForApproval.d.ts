export type AskForApproval = "untrusted" | "on-failure" | "on-request" | {
    "reject": {
        sandbox_approval: boolean;
        rules: boolean;
        mcp_elicitations: boolean;
    };
} | "never";
//# sourceMappingURL=AskForApproval.d.ts.map