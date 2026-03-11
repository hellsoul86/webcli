import type { Resource } from "../Resource";
import type { ResourceTemplate } from "../ResourceTemplate";
import type { Tool } from "../Tool";
import type { McpAuthStatus } from "./McpAuthStatus";
export type McpServerStatus = {
    name: string;
    tools: {
        [key in string]?: Tool;
    };
    resources: Array<Resource>;
    resourceTemplates: Array<ResourceTemplate>;
    authStatus: McpAuthStatus;
};
//# sourceMappingURL=McpServerStatus.d.ts.map