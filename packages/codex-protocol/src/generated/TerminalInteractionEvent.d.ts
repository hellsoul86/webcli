export type TerminalInteractionEvent = {
    /**
     * Identifier for the ExecCommandBegin that produced this chunk.
     */
    call_id: string;
    /**
     * Process id associated with the running command.
     */
    process_id: string;
    /**
     * Stdin sent to the running session.
     */
    stdin: string;
};
//# sourceMappingURL=TerminalInteractionEvent.d.ts.map