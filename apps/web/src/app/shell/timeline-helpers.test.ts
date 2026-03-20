import { beforeEach, describe, expect, it } from "vitest";
import type { TimelineEntry } from "@webcli/contracts";
import { setAppLocale } from "../../i18n/init";
import {
  describeActivityDetails,
  describeActivitySummary,
  shouldCollapseActivityByDefault,
} from "./timeline-helpers";

describe("timeline helpers", () => {
  beforeEach(async () => {
    await setAppLocale("zh-CN");
  });

  it("describes raw response items without falling back to raw json", () => {
    const entry: TimelineEntry = {
      id: "raw-1",
      turnId: "turn-1",
      kind: "rawResponseItem",
      title: "Raw Response",
      body: "Hello from raw response",
      raw: {
        type: "rawResponseItem",
        responseItemType: "message",
        responseItem: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "Hello from raw response" }],
        },
      },
    };

    expect(describeActivitySummary(entry)).toBe("原始响应消息");
    expect(describeActivityDetails(entry)).toContain("角色：`assistant`");
    expect(describeActivityDetails(entry)).toContain("Hello from raw response");
    expect(describeActivityDetails(entry)).not.toContain('"responseItemType"');
    expect(shouldCollapseActivityByDefault("rawResponseItem")).toBe(true);
  });

  it("describes terminal interaction items as first-class activity", () => {
    const entry: TimelineEntry = {
      id: "terminal-1",
      turnId: "turn-1",
      kind: "commandExecutionInteraction",
      title: "Terminal Input",
      body: "y\n",
      raw: {
        type: "commandExecutionInteraction",
        processId: "proc-123",
        itemId: "cmd-1",
        stdin: "y\n",
      },
    };

    expect(describeActivitySummary(entry)).toBe("终端输入 `y`");
    expect(describeActivityDetails(entry)).toContain("进程：`proc-123`");
    expect(describeActivityDetails(entry)).toContain("```text");
    expect(describeActivityDetails(entry)).toContain("y");
    expect(shouldCollapseActivityByDefault("commandExecutionInteraction")).toBe(false);
  });
});
