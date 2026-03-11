import type { HistoryEntry } from "./HistoryEntry";
export type GetHistoryEntryResponseEvent = {
    offset: number;
    log_id: bigint;
    /**
     * The entry at the requested offset, if available and parseable.
     */
    entry: HistoryEntry | null;
};
//# sourceMappingURL=GetHistoryEntryResponseEvent.d.ts.map