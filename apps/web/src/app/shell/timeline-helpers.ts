import type { TimelineEntry } from "@webcli/contracts";
import { translate } from "../../i18n/init";

export function isMessageEntry(kind: TimelineEntry["kind"]  ): boolean {
  return kind === "userMessage" || kind === "agentMessage";
}

export function shouldCollapseActivityByDefault(kind: TimelineEntry["kind"]): boolean {
  return (
    kind === "reasoning" ||
    kind === "plan" ||
    kind === "commandExecution" ||
    kind === "fileChange" ||
    kind === "mcpToolCall" ||
    kind === "dynamicToolCall" ||
    kind === "collabAgentToolCall" ||
    kind === "webSearch" ||
    kind === "imageGeneration" ||
    kind === "rawResponseItem"
  );
}

export function describeActivitySummary(entry: TimelineEntry): string {
  const raw = asRecord(entry.raw);

  switch (entry.kind) {
    case "reasoning":
      return entry.body.trim() ? translate("timeline.thinking") : translate("timeline.thinkingInProgress");
    case "plan":
      return translate("timeline.updatedPlan");
    case "commandExecution": {
      const command = readString(raw, "command") ?? entry.title;
      return `${describeExecutionStatus(
        readString(raw, "status"),
        translate("timeline.commandRunning"),
        translate("timeline.commandCompleted"),
        translate("timeline.commandFailed"),
        translate("timeline.commandDeclined"),
      )} \`${command}\``;
    }
    case "commandExecutionInteraction":
      return translate("timeline.terminalInteraction", {
        value: formatInlinePreview(entry.body || readString(raw, "stdin") || ""),
      });
    case "fileChange": {
      const changes = readArray(raw, "changes");
      const status = readString(raw, "status");
      const fileLabel =
        changes.length > 0 ? ` ${translate("git.fileCount", { count: changes.length })}` : "";
      return `${describeExecutionStatus(
        status,
        translate("timeline.fileRunning"),
        translate("timeline.fileCompleted"),
        translate("timeline.fileFailed"),
        translate("timeline.fileDeclined"),
      )}${fileLabel}`;
    }
    case "mcpToolCall": {
      const server = readString(raw, "server") ?? "MCP";
      const tool = readString(raw, "tool") ?? entry.title;
      return `${describeExecutionStatus(
        readString(raw, "status"),
        translate("timeline.toolRunning"),
        translate("timeline.toolCompleted"),
        translate("timeline.toolFailed"),
        translate("timeline.toolFailed"),
      )} \`${server} / ${tool}\``;
    }
    case "dynamicToolCall": {
      const tool = readString(raw, "tool") ?? entry.title;
      return `${describeExecutionStatus(
        readString(raw, "status"),
        translate("timeline.toolRunning"),
        translate("timeline.toolCompleted"),
        translate("timeline.toolFailed"),
        translate("timeline.toolFailed"),
      )} \`${tool}\``;
    }
    case "collabAgentToolCall": {
      const tool = readString(raw, "tool") ?? entry.title;
      return `${describeExecutionStatus(
        readString(raw, "status"),
        translate("timeline.collabRunning"),
        translate("timeline.collabCompleted"),
        translate("timeline.collabFailed"),
        translate("timeline.collabFailed"),
      )} \`${tool}\``;
    }
    case "webSearch": {
      const action = asRecord(raw?.action);
      if (readString(action, "type") === "openPage") {
        return translate("timeline.openPage", { value: readString(action, "url") ?? entry.body });
      }
      if (readString(action, "type") === "findInPage") {
        return translate("timeline.findInPage", { value: readString(action, "pattern") ?? entry.body });
      }
      return translate("timeline.search", { value: readString(raw, "query") ?? entry.body });
    }
    case "rawResponseItem":
      return describeRawResponseSummary(raw);
    case "enteredReviewMode":
      return translate("timeline.enteredReview");
    case "exitedReviewMode":
      return translate("timeline.exitedReview");
    case "imageView":
      return translate("timeline.viewImage", { value: readString(raw, "path") ?? entry.title });
    case "imageGeneration":
      return translate("timeline.generatedImage", {
        status: describeImageGenerationStatus(readString(raw, "status")),
      });
    case "contextCompaction":
      return translate("timeline.contextCompacted");
    default:
      return entry.title || String(entry.kind);
  }
}

export function describeActivityDetails(entry: TimelineEntry): string | null {
  const raw = asRecord(entry.raw);

  switch (entry.kind) {
    case "reasoning":
    case "plan":
      return entry.body.trim() || null;
    case "commandExecution": {
      const parts: Array<string> = [];
      const cwd = readString(raw, "cwd");
      const output = readString(raw, "aggregatedOutput") ?? entry.body;
      const exitCode = readNumber(raw, "exitCode");
      const durationMs = readNumber(raw, "durationMs");

      if (cwd) {
        parts.push(translate("timeline.cwd", { value: compactPath(cwd, 4) }));
      }
      if (Number.isFinite(exitCode)) {
        parts.push(translate("timeline.exitCode", { value: String(exitCode) }));
      }
      if (durationMs !== null && Number.isFinite(durationMs)) {
        parts.push(translate("timeline.duration", { value: formatDuration(durationMs) }));
      }
      if (output.trim()) {
        parts.push(`\`\`\`text\n${output.trim()}\n\`\`\``);
      }
      return parts.join("\n\n") || null;
    }
    case "commandExecutionInteraction": {
      const parts: Array<string> = [];
      const processId = readString(raw, "processId");
      const stdin = entry.body || readString(raw, "stdin") || "";
      if (processId) {
        parts.push(translate("timeline.terminalProcess", { value: processId }));
      }
      if (stdin.trim()) {
        parts.push(`${translate("timeline.terminalInputLabel")}\n\n\`\`\`text\n${stdin.trim()}\n\`\`\``);
      }
      return parts.join("\n\n") || null;
    }
    case "fileChange": {
      const changes = readArray(raw, "changes")
        .map(asRecord)
        .filter((change): change is Record<string, unknown> => change !== null);
      if (changes.length === 0) {
        return entry.body.trim() || null;
      }

      return changes
        .map((change) => `- ${describePatchChange(change)} \`${compactPath(readString(change, "path") ?? "", 4)}\``)
        .join("\n");
    }
    case "mcpToolCall": {
      const parts: Array<string> = [];
      const args = raw?.arguments;
      const result = raw?.result;
      const error = asRecord(raw?.error);
      const durationMs = readNumber(raw, "durationMs");

      if (args !== undefined) {
        parts.push(`${translate("timeline.arguments")}\n\n\`\`\`json\n${safeJson(args)}\n\`\`\``);
      }
      if (result !== undefined && result !== null) {
        parts.push(`${translate("timeline.result")}\n\n\`\`\`json\n${safeJson(result)}\n\`\`\``);
      } else if (entry.body.trim()) {
        parts.push(entry.body.trim());
      }
      if (error && readString(error, "message")) {
        parts.push(translate("timeline.error", { value: readString(error, "message") }));
      }
      if (durationMs !== null && Number.isFinite(durationMs)) {
        parts.push(translate("timeline.duration", { value: formatDuration(durationMs) }));
      }
      return parts.join("\n\n") || null;
    }
    case "dynamicToolCall": {
      const parts: Array<string> = [];
      const args = raw?.arguments;
      const contentItems = readArray(raw, "contentItems");
      const durationMs = readNumber(raw, "durationMs");
      const success = readBoolean(raw, "success");

      if (args !== undefined) {
        parts.push(`${translate("timeline.arguments")}\n\n\`\`\`json\n${safeJson(args)}\n\`\`\``);
      }
      if (contentItems.length > 0) {
        parts.push(formatDynamicToolOutput(contentItems));
      } else if (entry.body.trim()) {
        parts.push(entry.body.trim());
      }
      if (success !== null) {
        parts.push(success ? translate("timeline.success") : translate("timeline.failure"));
      }
      if (durationMs !== null && Number.isFinite(durationMs)) {
        parts.push(translate("timeline.duration", { value: formatDuration(durationMs) }));
      }
      return parts.join("\n\n") || null;
    }
    case "collabAgentToolCall": {
      const parts: Array<string> = [];
      const prompt = readString(raw, "prompt");
      const receiverThreadIds = readArray(raw, "receiverThreadIds")
        .map((value) => (typeof value === "string" ? value : null))
        .filter(Boolean);

      if (prompt) {
        parts.push(prompt);
      }
      if (receiverThreadIds.length > 0) {
        parts.push(
          translate("timeline.receiverThreads", {
            value: receiverThreadIds.map((id) => `\`${id}\``).join("、"),
          }),
        );
      }
      return parts.join("\n\n") || null;
    }
    case "webSearch": {
      const action = asRecord(raw?.action);
      const queries = readArray(action, "queries")
        .map((value) => (typeof value === "string" ? value : null))
        .filter(Boolean);
      if (queries.length > 0) {
        return queries.map((query) => `- \`${query}\``).join("\n");
      }
      if (entry.body.trim()) {
        return entry.body.trim();
      }
      return null;
    }
    case "rawResponseItem":
      return describeRawResponseDetails(raw, entry.body);
    case "enteredReviewMode":
    case "exitedReviewMode":
      return describeReviewSummary(readString(raw, "review"));
    case "imageGeneration": {
      const revisedPrompt = readString(raw, "revisedPrompt");
      const result = readString(raw, "result");
      return [revisedPrompt, result].filter(Boolean).join("\n\n") || null;
    }
    default:
      return entry.body.trim() || null;
  }
}

function describeRawResponseSummary(raw: Record<string, unknown> | null): string {
  const responseItem = asRecord(raw?.responseItem);
  const responseItemType = readString(raw, "responseItemType") ?? readString(responseItem, "type");

  switch (responseItemType) {
    case "message":
      return translate("timeline.rawResponseMessage");
    case "reasoning":
      return translate("timeline.rawResponseReasoning");
    case "local_shell_call":
      return translate("timeline.rawResponseLocalShell");
    case "function_call":
      return translate("timeline.rawResponseFunctionCall", {
        value: readString(responseItem, "name") ?? translate("timeline.rawResponseFallbackValue"),
      });
    case "function_call_output":
      return translate("timeline.rawResponseFunctionResult");
    case "custom_tool_call":
      return translate("timeline.rawResponseCustomToolCall", {
        value: readString(responseItem, "name") ?? translate("timeline.rawResponseFallbackValue"),
      });
    case "custom_tool_call_output":
      return translate("timeline.rawResponseCustomToolResult");
    case "web_search_call":
      return translate("timeline.rawResponseWebSearch");
    case "image_generation_call":
      return translate("timeline.rawResponseImageGeneration");
    case "ghost_snapshot":
      return translate("timeline.rawResponseGhostSnapshot");
    case "compaction":
      return translate("timeline.rawResponseCompaction");
    default:
      return translate("timeline.rawResponseItem");
  }
}

function describeRawResponseDetails(
  raw: Record<string, unknown> | null,
  fallbackBody: string,
): string | null {
  const responseItem = asRecord(raw?.responseItem);
  const responseItemType = readString(raw, "responseItemType") ?? readString(responseItem, "type");
  if (!responseItem || !responseItemType) {
    return fallbackBody.trim() || null;
  }

  switch (responseItemType) {
    case "message": {
      const parts: Array<string> = [];
      const role = readString(responseItem, "role");
      const phase = readString(responseItem, "phase");
      const content = readArray(responseItem, "content")
        .map(asRecord)
        .filter((item): item is Record<string, unknown> => item !== null)
        .map((item) => {
          const type = readString(item, "type");
          if (type === "input_text" || type === "output_text") {
            return readString(item, "text");
          }
          if (type === "input_image") {
            return readString(item, "image_url");
          }
          return null;
        })
        .filter(Boolean)
        .join("\n\n");

      if (role) {
        parts.push(translate("timeline.rawResponseRole", { value: role }));
      }
      if (phase) {
        parts.push(translate("timeline.rawResponsePhase", { value: phase }));
      }
      if (content) {
        parts.push(content);
      }
      return parts.join("\n\n") || fallbackBody.trim() || null;
    }
    case "reasoning": {
      const summary = readArray(responseItem, "summary")
        .map(asRecord)
        .filter((item): item is Record<string, unknown> => item !== null)
        .map((item) => readString(item, "text"))
        .filter(Boolean)
        .map((line) => `- ${line}`)
        .join("\n");
      const content = readArray(responseItem, "content")
        .map(asRecord)
        .filter((item): item is Record<string, unknown> => item !== null)
        .map((item) => readString(item, "text"))
        .filter(Boolean)
        .join("\n\n");
      return [summary, content].filter(Boolean).join("\n\n") || fallbackBody.trim() || null;
    }
    case "local_shell_call": {
      const action = asRecord(responseItem.action);
      const command = readArray(action, "command")
        .map((value) => (typeof value === "string" ? value : null))
        .filter(Boolean)
        .join(" ");
      const cwd = readString(action, "working_directory");
      const status = readString(responseItem, "status");
      const parts = [
        command ? `\`\`\`bash\n${command}\n\`\`\`` : null,
        cwd ? translate("timeline.cwd", { value: compactPath(cwd, 4) }) : null,
        status ? translate("timeline.rawResponseStatus", { value: status }) : null,
      ].filter(Boolean);
      return parts.join("\n\n") || fallbackBody.trim() || null;
    }
    case "function_call":
      return [
        translate("timeline.arguments"),
        "",
        `\`\`\`json\n${readString(responseItem, "arguments") ?? fallbackBody.trim()}\n\`\`\``,
      ].join("\n");
    case "function_call_output":
      return formatOutputDetails(responseItem.output);
    case "custom_tool_call":
      return [
        translate("timeline.rawResponseInput"),
        "",
        `\`\`\`text\n${readString(responseItem, "input") ?? fallbackBody.trim()}\n\`\`\``,
      ].join("\n");
    case "custom_tool_call_output":
      return formatOutputDetails(responseItem.output);
    case "web_search_call":
      return safeJson(responseItem.action ?? responseItem);
    case "image_generation_call": {
      const revisedPrompt = readString(responseItem, "revised_prompt");
      const result = readString(responseItem, "result");
      return [revisedPrompt, result].filter(Boolean).join("\n\n") || fallbackBody.trim() || null;
    }
    case "ghost_snapshot":
      return safeJson(responseItem.ghost_commit ?? responseItem);
    case "compaction":
      return readString(responseItem, "encrypted_content") ?? (fallbackBody.trim() || null);
    default:
      return fallbackBody.trim() || safeJson(responseItem);
  }
}

function formatOutputDetails(value: unknown): string {
  return [translate("timeline.result"), "", `\`\`\`json\n${safeJson(value)}\n\`\`\``].join("\n");
}

function formatInlinePreview(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return translate("timeline.terminalInteractionFallback");
  }
  return normalized.length > 48 ? `${normalized.slice(0, 45)}…` : normalized;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function readString(record: Record<string, unknown> | null, key: string): string | null {
  if (!record) {
    return null;
  }
  const value = record[key];
  return typeof value === "string" ? value : null;
}

function readNumber(record: Record<string, unknown> | null, key: string): number | null {
  if (!record) {
    return null;
  }
  const value = record[key];
  return typeof value === "number" ? value : null;
}

function readBoolean(record: Record<string, unknown> | null, key: string): boolean | null {
  if (!record) {
    return null;
  }
  const value = record[key];
  return typeof value === "boolean" ? value : null;
}

function readArray(record: Record<string, unknown> | null, key: string): Array<unknown> {
  if (!record) {
    return [];
  }
  const value = record[key];
  return Array.isArray(value) ? value : [];
}

function describeExecutionStatus(
  status: string | null,
  inProgress: string,
  completed: string,
  failed: string,
  declined: string,
): string {
  if (status === "completed") {
    return completed;
  }
  if (status === "failed") {
    return failed;
  }
  if (status === "declined") {
    return declined;
  }
  return inProgress;
}

function describePatchChange(change: Record<string, unknown>): string {
  const kind = asRecord(change.kind);
  const type = readString(kind, "type");
  if (type === "add") {
    return translate("timeline.patchAdded");
  }
  if (type === "delete") {
    return translate("timeline.patchDeleted");
  }

  const movePath = readString(kind, "move_path");
  if (movePath) {
    return translate("timeline.patchMoved", { value: compactPath(movePath, 4) });
  }

  return translate("timeline.patchEdited");
}

function describeReviewSummary(review: string | null): string | null {
  if (!review) {
    return null;
  }

  try {
    const parsed = JSON.parse(review) as {
      findings?: Array<unknown>;
      overall_correctness?: string;
      overall_explanation?: string;
    };
    const parts = [
      parsed.overall_correctness
        ? translate("timeline.reviewOverall", { value: parsed.overall_correctness })
        : null,
      typeof parsed.findings?.length === "number"
        ? translate("timeline.reviewFindings", {
            count: parsed.findings.length,
          })
        : null,
      parsed.overall_explanation ?? null,
    ].filter(Boolean);
    return parts.join("\n\n");
  } catch {
    return review;
  }
}

function formatDynamicToolOutput(items: Array<unknown>): string {
  const lines = items
    .map(asRecord)
    .filter(Boolean)
    .map((item) => {
      const type = readString(item, "type");
      if (type === "inputText") {
        return readString(item, "text");
      }
      if (type === "inputImage") {
        const imageUrl = readString(item, "imageUrl");
        return imageUrl ? `![](${imageUrl})` : null;
      }
      return safeJson(item);
    })
    .filter(Boolean);

  return lines.join("\n\n");
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function formatDuration(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return "0 ms";
  }
  if (value < 1000) {
    return `${Math.round(value)} ms`;
  }
  if (value < 60_000) {
    return `${(value / 1000).toFixed(1)} s`;
  }
  return `${(value / 60_000).toFixed(1)} min`;
}

function describeImageGenerationStatus(status: string | null): string {
  if (status === "completed") {
    return translate("timeline.imageCompleted");
  }
  if (status === "failed") {
    return translate("timeline.imageFailed");
  }
  return translate("timeline.imageRunning");
}

function compactPath(value: string, keepSegments = 3): string {
  const parts = value.split("/").filter(Boolean);
  if (parts.length <= keepSegments) {
    return value;
  }

  return `.../${parts.slice(-keepSegments).join("/")}`;
}
