import type { FileSystemPermissions } from "./FileSystemPermissions";
import type { MacOsSeatbeltProfileExtensions } from "./MacOsSeatbeltProfileExtensions";
import type { NetworkPermissions } from "./NetworkPermissions";
export type PermissionProfile = {
    network: NetworkPermissions | null;
    file_system: FileSystemPermissions | null;
    macos: MacOsSeatbeltProfileExtensions | null;
};
//# sourceMappingURL=PermissionProfile.d.ts.map