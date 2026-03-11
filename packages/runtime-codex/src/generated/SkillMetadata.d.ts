import type { SkillDependencies } from "./SkillDependencies";
import type { SkillInterface } from "./SkillInterface";
import type { SkillScope } from "./SkillScope";
export type SkillMetadata = {
    name: string;
    description: string;
    /**
     * Legacy short_description from SKILL.md. Prefer SKILL.json interface.short_description.
     */
    short_description?: string;
    interface?: SkillInterface;
    dependencies?: SkillDependencies;
    path: string;
    scope: SkillScope;
    enabled: boolean;
};
//# sourceMappingURL=SkillMetadata.d.ts.map