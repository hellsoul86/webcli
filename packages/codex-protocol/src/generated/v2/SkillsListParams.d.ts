import type { SkillsListExtraRootsForCwd } from "./SkillsListExtraRootsForCwd";
export type SkillsListParams = {
    /**
     * When empty, defaults to the current session working directory.
     */
    cwds?: Array<string>;
    /**
     * When true, bypass the skills cache and re-scan skills from disk.
     */
    forceReload?: boolean;
    /**
     * Optional per-cwd extra roots to scan as user-scoped skills.
     */
    perCwdExtraUserRoots?: Array<SkillsListExtraRootsForCwd> | null;
};
//# sourceMappingURL=SkillsListParams.d.ts.map