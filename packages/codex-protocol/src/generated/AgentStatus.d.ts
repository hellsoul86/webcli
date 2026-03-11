/**
 * Agent lifecycle status, derived from emitted events.
 */
export type AgentStatus = "pending_init" | "running" | {
    "completed": string | null;
} | {
    "errored": string;
} | "shutdown" | "not_found";
//# sourceMappingURL=AgentStatus.d.ts.map