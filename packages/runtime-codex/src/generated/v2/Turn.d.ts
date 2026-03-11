import type { ThreadItem } from "./ThreadItem";
import type { TurnError } from "./TurnError";
import type { TurnStatus } from "./TurnStatus";
export type Turn = {
    id: string;
    /**
     * Only populated on a `thread/resume` or `thread/fork` response.
     * For all other responses and notifications returning a Turn,
     * the items field will be an empty list.
     */
    items: Array<ThreadItem>;
    status: TurnStatus;
    /**
     * Only populated when the Turn's status is failed.
     */
    error: TurnError | null;
};
//# sourceMappingURL=Turn.d.ts.map