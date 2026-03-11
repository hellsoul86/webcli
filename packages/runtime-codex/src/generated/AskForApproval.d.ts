import type { RejectConfig } from "./RejectConfig";
/**
 * Determines the conditions under which the user is consulted to approve
 * running the command proposed by Codex.
 */
export type AskForApproval = "untrusted" | "on-failure" | "on-request" | {
    "reject": RejectConfig;
} | "never";
//# sourceMappingURL=AskForApproval.d.ts.map