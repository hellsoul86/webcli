import type { AdditionalFileSystemPermissions } from "./AdditionalFileSystemPermissions";
import type { AdditionalNetworkPermissions } from "./AdditionalNetworkPermissions";
import type { GrantedMacOsPermissions } from "./GrantedMacOsPermissions";
export type GrantedPermissionProfile = {
    network?: AdditionalNetworkPermissions;
    fileSystem?: AdditionalFileSystemPermissions;
    macos?: GrantedMacOsPermissions;
};
//# sourceMappingURL=GrantedPermissionProfile.d.ts.map