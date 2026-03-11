import type { AbsolutePathBuf } from "../AbsolutePathBuf";
export type PluginListParams = {
    /**
     * Optional working directories used to discover repo marketplaces. When omitted,
     * only home-scoped marketplaces and the official curated marketplace are considered.
     */
    cwds?: Array<AbsolutePathBuf> | null;
};
//# sourceMappingURL=PluginListParams.d.ts.map