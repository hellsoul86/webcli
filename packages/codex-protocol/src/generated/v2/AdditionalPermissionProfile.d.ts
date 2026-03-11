import type { AdditionalFileSystemPermissions } from "./AdditionalFileSystemPermissions";
import type { AdditionalMacOsPermissions } from "./AdditionalMacOsPermissions";
import type { AdditionalNetworkPermissions } from "./AdditionalNetworkPermissions";
export type AdditionalPermissionProfile = {
    network: AdditionalNetworkPermissions | null;
    fileSystem: AdditionalFileSystemPermissions | null;
    macos: AdditionalMacOsPermissions | null;
};
//# sourceMappingURL=AdditionalPermissionProfile.d.ts.map