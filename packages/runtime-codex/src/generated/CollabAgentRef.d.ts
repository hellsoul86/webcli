import type { ThreadId } from "./ThreadId";
export type CollabAgentRef = {
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
};
//# sourceMappingURL=CollabAgentRef.d.ts.map