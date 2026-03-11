import type { AgentStatus } from "./AgentStatus";
import type { CollabAgentStatusEntry } from "./CollabAgentStatusEntry";
import type { ThreadId } from "./ThreadId";
export type CollabWaitingEndEvent = {
    /**
     * Thread ID of the sender.
     */
    sender_thread_id: ThreadId;
    /**
     * ID of the waiting call.
     */
    call_id: string;
    /**
     * Optional receiver metadata paired with final statuses.
     */
    agent_statuses?: Array<CollabAgentStatusEntry>;
    /**
     * Last known status of the receiver agents reported to the sender agent.
     */
    statuses: {
        [key in ThreadId]?: AgentStatus;
    };
};
//# sourceMappingURL=CollabWaitingEndEvent.d.ts.map