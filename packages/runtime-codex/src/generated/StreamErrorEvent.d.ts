import type { CodexErrorInfo } from "./CodexErrorInfo";
export type StreamErrorEvent = {
    message: string;
    codex_error_info: CodexErrorInfo | null;
    /**
     * Optional details about the underlying stream failure (often the same
     * human-readable message that is surfaced as the terminal error if retries
     * are exhausted).
     */
    additional_details: string | null;
};
//# sourceMappingURL=StreamErrorEvent.d.ts.map