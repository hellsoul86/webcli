import type { FunctionCallOutputBody } from "./FunctionCallOutputBody";
/**
 * The payload we send back to OpenAI when reporting a tool call result.
 *
 * `body` serializes directly as the wire value for `function_call_output.output`.
 * `success` remains internal metadata for downstream handling.
 */
export type FunctionCallOutputPayload = {
    body: FunctionCallOutputBody;
    success: boolean | null;
};
//# sourceMappingURL=FunctionCallOutputPayload.d.ts.map