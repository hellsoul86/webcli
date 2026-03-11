import type { CollabAgentRef } from "./CollabAgentRef";
import type { ThreadId } from "./ThreadId";
export type CollabWaitingBeginEvent = {
    /**
     * Thread ID of the sender.
     */
    sender_thread_id: ThreadId;
    /**
     * Thread ID of the receivers.
     */
    receiver_thread_ids: Array<ThreadId>;
    /**
     * Optional nicknames/roles for receivers.
     */
    receiver_agents?: Array<CollabAgentRef>;
    /**
     * ID of the waiting call.
     */
    call_id: string;
};
//# sourceMappingURL=CollabWaitingBeginEvent.d.ts.map