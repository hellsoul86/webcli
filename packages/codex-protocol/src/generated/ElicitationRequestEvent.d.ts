import type { ElicitationRequest } from "./ElicitationRequest";
export type ElicitationRequestEvent = {
    /**
     * Turn ID that this elicitation belongs to, when known.
     */
    turn_id?: string;
    server_name: string;
    id: string | number;
    request: ElicitationRequest;
};
//# sourceMappingURL=ElicitationRequestEvent.d.ts.map