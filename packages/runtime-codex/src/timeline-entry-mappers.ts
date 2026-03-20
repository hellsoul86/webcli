import type { TimelineEntry } from "@webcli/contracts";
import type { ContentItem } from "./generated/ContentItem.js";
import type { FunctionCallOutputPayload } from "./generated/FunctionCallOutputPayload.js";
import type { ResponseItem } from "./generated/ResponseItem.js";
import type { TerminalInteractionNotification } from "./generated/v2/TerminalInteractionNotification.js";

export function mapRawResponseItemCompleted(input: {
  id: string;
  turnId: string;
  item: ResponseItem;
}): TimelineEntry {
  return {
    id: input.id,
    turnId: input.turnId,
    kind: "rawResponseItem",
    title: describeRawResponseItemTitle(input.item),
    body: describeRawResponseItemBody(input.item),
    raw: {
      type: "rawResponseItem",
      responseItemType: input.item.type,
      responseItem: input.item,
    },
  };
}

export function mapTerminalInteractionTimelineEntry(input: {
  id: string;
  turnId: string;
  params: TerminalInteractionNotification;
}): TimelineEntry {
  return {
    id: input.id,
    turnId: input.turnId,
    kind: "commandExecutionInteraction",
    title: "Terminal Input",
    body: input.params.stdin,
    raw: {
      type: "commandExecutionInteraction",
      itemId: input.params.itemId,
      processId: input.params.processId,
      stdin: input.params.stdin,
    },
  };
}

function describeRawResponseItemTitle(item: ResponseItem): string {
  switch (item.type) {
    case "message":
      return "Response Message";
    case "reasoning":
      return "Response Reasoning";
    case "local_shell_call":
      return "Raw Shell Call";
    case "function_call":
      return `Function Call: ${item.name}`;
    case "function_call_output":
      return "Function Output";
    case "custom_tool_call":
      return `Tool Call: ${item.name}`;
    case "custom_tool_call_output":
      return "Tool Output";
    case "web_search_call":
      return "Web Search Call";
    case "image_generation_call":
      return "Image Generation Call";
    case "ghost_snapshot":
      return "Ghost Snapshot";
    case "compaction":
      return "Response Compaction";
    case "other":
      return "Raw Response Item";
  }
}

function describeRawResponseItemBody(item: ResponseItem): string {
  switch (item.type) {
    case "message":
      return flattenResponseMessageContent(item.content);
    case "reasoning": {
      const summary = item.summary
        .map((part) => ("text" in part ? part.text : ""))
        .filter(Boolean)
        .join("\n");
      const content = (item.content ?? [])
        .map((part) => ("text" in part ? part.text : ""))
        .filter(Boolean)
        .join("\n");
      return [summary, content].filter(Boolean).join("\n\n");
    }
    case "local_shell_call":
      return item.action.type === "exec"
        ? item.action.command.join(" ")
        : safeJson(item.action);
    case "function_call":
      return item.arguments;
    case "function_call_output":
      return formatFunctionCallOutput(item.output);
    case "custom_tool_call":
      return item.input;
    case "custom_tool_call_output":
      return formatFunctionCallOutput(item.output);
    case "web_search_call":
      return safeJson(item.action ?? item);
    case "image_generation_call":
      return [item.revised_prompt ?? null, item.result].filter(Boolean).join("\n\n");
    case "ghost_snapshot":
      return safeJson(item.ghost_commit);
    case "compaction":
      return item.encrypted_content;
    case "other":
      return safeJson(item);
  }
}

function flattenResponseMessageContent(content: Array<ContentItem>): string {
  return content
    .map((part) => {
      switch (part.type) {
        case "input_text":
        case "output_text":
          return part.text;
        case "input_image":
          return part.image_url;
      }
    })
    .filter(Boolean)
    .join("\n\n");
}

function formatFunctionCallOutput(output: FunctionCallOutputPayload): string {
  if (typeof output.body === "string") {
    return output.body;
  }
  return safeJson(output.body);
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
