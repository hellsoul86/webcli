import type { WebSearchMode } from "../WebSearchMode";
import type { AskForApproval } from "./AskForApproval";
import type { ResidencyRequirement } from "./ResidencyRequirement";
import type { SandboxMode } from "./SandboxMode";
export type ConfigRequirements = {
    allowedApprovalPolicies: Array<AskForApproval> | null;
    allowedSandboxModes: Array<SandboxMode> | null;
    allowedWebSearchModes: Array<WebSearchMode> | null;
    featureRequirements: {
        [key in string]?: boolean;
    } | null;
    enforceResidency: ResidencyRequirement | null;
};
//# sourceMappingURL=ConfigRequirements.d.ts.map