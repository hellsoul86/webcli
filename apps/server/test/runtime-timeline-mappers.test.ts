import { describe, expect, it } from "vitest";
import {
  mapRawResponseItemCompleted,
  mapTerminalInteractionTimelineEntry,
} from "../../../packages/runtime-codex/src/timeline-entry-mappers.js";

describe("runtime timeline mappers", () => {
  it("maps raw response completions to first-class timeline items", () => {
    const entry = mapRawResponseItemCompleted({
      id: "raw-1",
      turnId: "turn-1",
      item: {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "Hello from raw response" }],
      },
    });

    expect(entry.kind).toBe("rawResponseItem");
    expect(entry.title).toBe("Response Message");
    expect(entry.body).toContain("Hello from raw response");
    expect(entry.raw).toMatchObject({
      type: "rawResponseItem",
      responseItemType: "message",
    });
  });

  it("maps terminal interactions into dedicated timeline items", () => {
    const entry = mapTerminalInteractionTimelineEntry({
      id: "terminal-1",
      turnId: "turn-1",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        itemId: "cmd-1",
        processId: "proc-123",
        stdin: "y\n",
      },
    });

    expect(entry.kind).toBe("commandExecutionInteraction");
    expect(entry.title).toBe("Terminal Input");
    expect(entry.body).toBe("y\n");
    expect(entry.raw).toMatchObject({
      type: "commandExecutionInteraction",
      processId: "proc-123",
      itemId: "cmd-1",
      stdin: "y\n",
    });
  });
});
