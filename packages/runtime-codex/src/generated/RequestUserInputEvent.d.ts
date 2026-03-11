import type { RequestUserInputQuestion } from "./RequestUserInputQuestion";
export type RequestUserInputEvent = {
    /**
     * Responses API call id for the associated tool call, if available.
     */
    call_id: string;
    /**
     * Turn ID that this request belongs to.
     * Uses `#[serde(default)]` for backwards compatibility.
     */
    turn_id: string;
    questions: Array<RequestUserInputQuestion>;
};
//# sourceMappingURL=RequestUserInputEvent.d.ts.map