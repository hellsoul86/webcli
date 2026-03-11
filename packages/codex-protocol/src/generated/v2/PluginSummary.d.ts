import type { PluginInterface } from "./PluginInterface";
import type { PluginSource } from "./PluginSource";
export type PluginSummary = {
    id: string;
    name: string;
    source: PluginSource;
    installed: boolean;
    enabled: boolean;
    interface: PluginInterface | null;
};
//# sourceMappingURL=PluginSummary.d.ts.map