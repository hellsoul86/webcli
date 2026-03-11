import type { PermissionProfile } from "./PermissionProfile";
export type RequestPermissionsEvent = {
    /**
     * Responses API call id for the associated tool call, if available.
     */
    call_id: string;
    /**
     * Turn ID that this request belongs to.
     * Uses `#[serde(default)]` for backwards compatibility.
     */
    turn_id: string;
    reason: string | null;
    permissions: PermissionProfile;
};
//# sourceMappingURL=RequestPermissionsEvent.d.ts.map