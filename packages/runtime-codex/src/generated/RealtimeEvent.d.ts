import type { RealtimeAudioFrame } from "./RealtimeAudioFrame";
import type { RealtimeHandoffRequested } from "./RealtimeHandoffRequested";
import type { JsonValue } from "./serde_json/JsonValue";
export type RealtimeEvent = {
    "SessionUpdated": {
        session_id: string;
        instructions: string | null;
    };
} | {
    "AudioOut": RealtimeAudioFrame;
} | {
    "ConversationItemAdded": JsonValue;
} | {
    "ConversationItemDone": {
        item_id: string;
    };
} | {
    "HandoffRequested": RealtimeHandoffRequested;
} | {
    "Error": string;
};
//# sourceMappingURL=RealtimeEvent.d.ts.map