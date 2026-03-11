import type { MacOsAutomationPermission } from "../MacOsAutomationPermission";
import type { MacOsPreferencesPermission } from "../MacOsPreferencesPermission";
export type GrantedMacOsPermissions = {
    preferences?: MacOsPreferencesPermission;
    automations?: MacOsAutomationPermission;
    accessibility?: boolean;
    calendar?: boolean;
};
//# sourceMappingURL=GrantedMacOsPermissions.d.ts.map