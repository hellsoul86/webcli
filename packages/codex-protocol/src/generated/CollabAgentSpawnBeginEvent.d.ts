import type { ThreadId } from "./ThreadId";
export type CollabAgentSpawnBeginEvent = {
    /**
     * Identifier for the collab tool call.
     */
    call_id: string;
    /**
     * Thread ID of the sender.
     */
    sender_thread_id: ThreadId;
    /**
     * Initial prompt sent to the agent. Can be empty to prevent CoT leaking at the
     * beginning.
     */
    prompt: string;
};
//# sourceMappingURL=CollabAgentSpawnBeginEvent.d.ts.map