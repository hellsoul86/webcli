import type { AppToolApproval } from "./AppToolApproval";
import type { AppToolsConfig } from "./AppToolsConfig";
import type { AppsDefaultConfig } from "./AppsDefaultConfig";
export type AppsConfig = {
    _default: AppsDefaultConfig | null;
} & ({
    [key in string]?: {
        enabled: boolean;
        destructive_enabled: boolean | null;
        open_world_enabled: boolean | null;
        default_tools_approval_mode: AppToolApproval | null;
        default_tools_enabled: boolean | null;
        tools: AppToolsConfig | null;
    };
});
//# sourceMappingURL=AppsConfig.d.ts.map