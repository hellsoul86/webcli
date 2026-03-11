import type { JsonValue } from "./serde_json/JsonValue";
export type DynamicToolCallRequest = {
    callId: string;
    turnId: string;
    tool: string;
    arguments: JsonValue;
};
//# sourceMappingURL=DynamicToolCallRequest.d.ts.map