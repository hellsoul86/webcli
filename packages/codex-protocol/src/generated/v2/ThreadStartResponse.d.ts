import type { ReasoningEffort } from "../ReasoningEffort";
import type { ServiceTier } from "../ServiceTier";
import type { AskForApproval } from "./AskForApproval";
import type { SandboxPolicy } from "./SandboxPolicy";
import type { Thread } from "./Thread";
export type ThreadStartResponse = {
    thread: Thread;
    model: string;
    modelProvider: string;
    serviceTier: ServiceTier | null;
    cwd: string;
    approvalPolicy: AskForApproval;
    sandbox: SandboxPolicy;
    reasoningEffort: ReasoningEffort | null;
};
//# sourceMappingURL=ThreadStartResponse.d.ts.map