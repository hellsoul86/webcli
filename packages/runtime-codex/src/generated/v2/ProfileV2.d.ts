import type { ReasoningEffort } from "../ReasoningEffort";
import type { ReasoningSummary } from "../ReasoningSummary";
import type { ServiceTier } from "../ServiceTier";
import type { Verbosity } from "../Verbosity";
import type { WebSearchMode } from "../WebSearchMode";
import type { JsonValue } from "../serde_json/JsonValue";
import type { AskForApproval } from "./AskForApproval";
import type { ToolsV2 } from "./ToolsV2";
export type ProfileV2 = {
    model: string | null;
    model_provider: string | null;
    approval_policy: AskForApproval | null;
    service_tier: ServiceTier | null;
    model_reasoning_effort: ReasoningEffort | null;
    model_reasoning_summary: ReasoningSummary | null;
    model_verbosity: Verbosity | null;
    web_search: WebSearchMode | null;
    tools: ToolsV2 | null;
    chatgpt_base_url: string | null;
} & ({
    [key in string]?: number | string | boolean | Array<JsonValue> | {
        [key in string]?: JsonValue;
    } | null;
});
//# sourceMappingURL=ProfileV2.d.ts.map