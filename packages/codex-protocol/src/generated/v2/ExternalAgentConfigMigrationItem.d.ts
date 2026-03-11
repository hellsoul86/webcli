import type { ExternalAgentConfigMigrationItemType } from "./ExternalAgentConfigMigrationItemType";
export type ExternalAgentConfigMigrationItem = {
    itemType: ExternalAgentConfigMigrationItemType;
    description: string;
    /**
     * Null or empty means home-scoped migration; non-empty means repo-scoped migration.
     */
    cwd: string | null;
};
//# sourceMappingURL=ExternalAgentConfigMigrationItem.d.ts.map