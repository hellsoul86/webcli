import type { AbsolutePathBuf } from "../AbsolutePathBuf";
import type { NetworkAccess } from "./NetworkAccess";
import type { ReadOnlyAccess } from "./ReadOnlyAccess";
export type SandboxPolicy = {
    "type": "dangerFullAccess";
} | {
    "type": "readOnly";
    access: ReadOnlyAccess;
    networkAccess: boolean;
} | {
    "type": "externalSandbox";
    networkAccess: NetworkAccess;
} | {
    "type": "workspaceWrite";
    writableRoots: Array<AbsolutePathBuf>;
    readOnlyAccess: ReadOnlyAccess;
    networkAccess: boolean;
    excludeTmpdirEnvVar: boolean;
    excludeSlashTmp: boolean;
};
//# sourceMappingURL=SandboxPolicy.d.ts.map