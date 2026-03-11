import type { SubAgentSource } from "./SubAgentSource";
export type SessionSource = "cli" | "vscode" | "exec" | "mcp" | {
    "subagent": SubAgentSource;
} | "unknown";
//# sourceMappingURL=SessionSource.d.ts.map