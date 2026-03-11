import type { ThreadId } from "./ThreadId";
export type CollabResumeBeginEvent = {
    /**
     * Identifier for the collab tool call.
     */
    call_id: string;
    /**
     * Thread ID of the sender.
     */
    sender_thread_id: ThreadId;
    /**
     * Thread ID of the receiver.
     */
    receiver_thread_id: ThreadId;
    /**
     * Optional nickname assigned to the receiver agent.
     */
    receiver_agent_nickname?: string | null;
    /**
     * Optional role assigned to the receiver agent.
     */
    receiver_agent_role?: string | null;
};
//# sourceMappingURL=CollabResumeBeginEvent.d.ts.map