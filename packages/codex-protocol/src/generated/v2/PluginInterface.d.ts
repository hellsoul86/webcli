import type { AbsolutePathBuf } from "../AbsolutePathBuf";
export type PluginInterface = {
    displayName: string | null;
    shortDescription: string | null;
    longDescription: string | null;
    developerName: string | null;
    category: string | null;
    capabilities: Array<string>;
    websiteUrl: string | null;
    privacyPolicyUrl: string | null;
    termsOfServiceUrl: string | null;
    defaultPrompt: string | null;
    brandColor: string | null;
    composerIcon: AbsolutePathBuf | null;
    logo: AbsolutePathBuf | null;
    screenshots: Array<AbsolutePathBuf>;
};
//# sourceMappingURL=PluginInterface.d.ts.map