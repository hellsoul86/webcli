import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { setAppLocale } from "../../i18n/init";
import type { RealtimeSessionState } from "../../store/workbench-store";
import { RealtimeSessionPanel } from "./realtime-session-panel";

function makeSession(
  overrides: Partial<RealtimeSessionState> = {},
): RealtimeSessionState {
  return {
    threadId: "thread-1",
    sessionId: "session-1",
    status: "live",
    startedAt: 1,
    updatedAt: 2,
    closedAt: null,
    errorMessage: null,
    closeReason: null,
    items: [
      {
        id: "item-1",
        receivedAt: 2,
        raw: { type: "transcript", text: "Hello realtime" },
        kindLabel: "transcript",
        textPreview: "Hello realtime",
        jsonPreview: "{\n  \"type\": \"transcript\",\n  \"text\": \"Hello realtime\"\n}",
      },
      {
        id: "item-2",
        receivedAt: 3,
        raw: { kind: "unknown", nested: { ok: true } },
        kindLabel: "unknown",
        textPreview: null,
        jsonPreview: "{\n  \"kind\": \"unknown\",\n  \"nested\": {\n    \"ok\": true\n  }\n}",
      },
    ],
    audio: {
      sampleRate: 16000,
      numChannels: 1,
      chunkCount: 2,
      pcmChunks: [],
      objectUrl: "blob:realtime-audio",
      decodeError: null,
    },
    ...overrides,
  };
}

describe("RealtimeSessionPanel", () => {
  beforeEach(async () => {
    await setAppLocale("zh-CN");
  });

  it("renders transcript previews, JSON fallbacks, and an audio player", () => {
    render(<RealtimeSessionPanel session={makeSession()} />);

    expect(screen.getByTestId("realtime-session-panel")).toBeVisible();
    expect(screen.getByText("Hello realtime")).toBeVisible();
    expect(screen.getByText(/"kind": "unknown"/)).toBeVisible();
    expect(screen.getByTestId("realtime-audio-player")).toHaveAttribute(
      "src",
      "blob:realtime-audio",
    );
  });

  it("shows decode errors without removing transcript content", () => {
    render(
      <RealtimeSessionPanel
        session={makeSession({
          status: "error",
          errorMessage: "microphone disconnected",
          audio: {
            sampleRate: 16000,
            numChannels: 1,
            chunkCount: 1,
            pcmChunks: [],
            objectUrl: null,
            decodeError: "Realtime audio chunk must contain an even number of PCM16 bytes.",
          },
        })}
      />,
    );

    expect(screen.getByTestId("realtime-session-error")).toHaveTextContent(
      "microphone disconnected",
    );
    expect(screen.getByTestId("realtime-audio-error")).toHaveTextContent("音频解码失败");
    expect(screen.getByText("Hello realtime")).toBeVisible();
  });
});
