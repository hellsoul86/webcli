import type { AbsolutePathBuf } from "../AbsolutePathBuf";
export type ReadOnlyAccess = {
    "type": "restricted";
    includePlatformDefaults: boolean;
    readableRoots: Array<AbsolutePathBuf>;
} | {
    "type": "fullAccess";
};
//# sourceMappingURL=ReadOnlyAccess.d.ts.map