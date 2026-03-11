import type { ExecOutputStream } from "./ExecOutputStream";
export type ExecCommandOutputDeltaEvent = {
    /**
     * Identifier for the ExecCommandBegin that produced this chunk.
     */
    call_id: string;
    /**
     * Which stream produced this chunk.
     */
    stream: ExecOutputStream;
    /**
     * Raw bytes from the stream (may not be valid UTF-8).
     */
    chunk: string;
};
//# sourceMappingURL=ExecCommandOutputDeltaEvent.d.ts.map