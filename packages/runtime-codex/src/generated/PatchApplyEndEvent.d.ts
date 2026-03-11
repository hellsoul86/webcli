import type { FileChange } from "./FileChange";
import type { PatchApplyStatus } from "./PatchApplyStatus";
export type PatchApplyEndEvent = {
    /**
     * Identifier for the PatchApplyBegin that finished.
     */
    call_id: string;
    /**
     * Turn ID that this patch belongs to.
     * Uses `#[serde(default)]` for backwards compatibility.
     */
    turn_id: string;
    /**
     * Captured stdout (summary printed by apply_patch).
     */
    stdout: string;
    /**
     * Captured stderr (parser errors, IO failures, etc.).
     */
    stderr: string;
    /**
     * Whether the patch was applied successfully.
     */
    success: boolean;
    /**
     * The changes that were applied (mirrors PatchApplyBeginEvent::changes).
     */
    changes: {
        [key in string]?: FileChange;
    };
    /**
     * Completion status for this patch application.
     */
    status: PatchApplyStatus;
};
//# sourceMappingURL=PatchApplyEndEvent.d.ts.map