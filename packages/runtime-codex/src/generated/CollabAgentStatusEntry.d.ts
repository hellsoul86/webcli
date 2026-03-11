import type { AgentStatus } from "./AgentStatus";
import type { ThreadId } from "./ThreadId";
export type CollabAgentStatusEntry = {
    /**
     * Thread ID of the receiver/new agent.
     */
    thread_id: ThreadId;
    /**
     * Optional nickname assigned to an AgentControl-spawned sub-agent.
     */
    agent_nickname?: string | null;
    /**
     * Optional role (agent_role) assigned to an AgentControl-spawned sub-agent.
     */
    agent_role?: string | null;
    /**
     * Last known status of the agent.
     */
    status: AgentStatus;
};
//# sourceMappingURL=CollabAgentStatusEntry.d.ts.map