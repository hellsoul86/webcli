import type { Thread } from "./Thread";
export type ThreadListResponse = {
    data: Array<Thread>;
    /**
     * Opaque cursor to pass to the next call to continue after the last item.
     * if None, there are no more items to return.
     */
    nextCursor: string | null;
};
//# sourceMappingURL=ThreadListResponse.d.ts.map