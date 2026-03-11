import type { FileChange } from "./FileChange";
export type ApplyPatchApprovalRequestEvent = {
    /**
     * Responses API call id for the associated patch apply call, if available.
     */
    call_id: string;
    /**
     * Turn ID that this patch belongs to.
     * Uses `#[serde(default)]` for backwards compatibility with older senders.
     */
    turn_id: string;
    changes: {
        [key in string]?: FileChange;
    };
    /**
     * Optional explanatory reason (e.g. request for extra write access).
     */
    reason: string | null;
    /**
     * When set, the agent is asking the user to allow writes under this root for the remainder of the session.
     */
    grant_root: string | null;
};
//# sourceMappingURL=ApplyPatchApprovalRequestEvent.d.ts.map