/**
 * Codex errors that we expose to clients.
 */
export type CodexErrorInfo = "context_window_exceeded" | "usage_limit_exceeded" | "server_overloaded" | {
    "http_connection_failed": {
        http_status_code: number | null;
    };
} | {
    "response_stream_connection_failed": {
        http_status_code: number | null;
    };
} | "internal_server_error" | "unauthorized" | "bad_request" | "sandbox_error" | {
    "response_stream_disconnected": {
        http_status_code: number | null;
    };
} | {
    "response_too_many_failed_attempts": {
        http_status_code: number | null;
    };
} | "thread_rollback_failed" | "other";
//# sourceMappingURL=CodexErrorInfo.d.ts.map