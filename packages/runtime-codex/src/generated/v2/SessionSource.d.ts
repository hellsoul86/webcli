import type { SubAgentSource } from "../SubAgentSource";
export type SessionSource = "cli" | "vscode" | "exec" | "appServer" | {
    "subAgent": SubAgentSource;
} | "unknown";
//# sourceMappingURL=SessionSource.d.ts.map