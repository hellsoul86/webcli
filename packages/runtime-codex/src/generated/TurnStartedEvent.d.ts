import type { ModeKind } from "./ModeKind";
export type TurnStartedEvent = {
    turn_id: string;
    model_context_window: bigint | null;
    collaboration_mode_kind: ModeKind;
};
//# sourceMappingURL=TurnStartedEvent.d.ts.map