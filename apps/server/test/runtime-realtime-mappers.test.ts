import { describe, expect, it } from "vitest";
import {
  mapThreadRealtimeClosed,
  mapThreadRealtimeError,
  mapThreadRealtimeItemAdded,
  mapThreadRealtimeOutputAudioDelta,
  mapThreadRealtimeStarted,
} from "../../../packages/runtime-codex/src/realtime-notification-mappers.js";

describe("runtime realtime notification mappers", () => {
  it("maps realtime started notifications", () => {
    expect(
      mapThreadRealtimeStarted({
        threadId: "thread-1",
        sessionId: "session-1",
      }),
    ).toEqual({
      type: "thread.realtime.started",
      threadId: "thread-1",
      sessionId: "session-1",
    });
  });

  it("maps realtime item notifications", () => {
    expect(
      mapThreadRealtimeItemAdded({
        threadId: "thread-1",
        item: {
          type: "transcript",
          text: "hello",
        },
      }),
    ).toEqual({
      type: "thread.realtime.itemAdded",
      threadId: "thread-1",
      item: {
        type: "transcript",
        text: "hello",
      },
    });
  });

  it("maps realtime audio notifications without dropping audio metadata", () => {
    expect(
      mapThreadRealtimeOutputAudioDelta({
        threadId: "thread-1",
        audio: {
          data: "AQID",
          sampleRate: 16000,
          numChannels: 1,
          samplesPerChannel: 2,
        },
      }),
    ).toEqual({
      type: "thread.realtime.outputAudio.delta",
      threadId: "thread-1",
      audio: {
        data: "AQID",
        sampleRate: 16000,
        numChannels: 1,
        samplesPerChannel: 2,
      },
    });
  });

  it("maps realtime error notifications", () => {
    expect(
      mapThreadRealtimeError({
        threadId: "thread-1",
        message: "microphone disconnected",
      }),
    ).toEqual({
      type: "thread.realtime.error",
      threadId: "thread-1",
      message: "microphone disconnected",
    });
  });

  it("maps realtime close notifications", () => {
    expect(
      mapThreadRealtimeClosed({
        threadId: "thread-1",
        reason: "session-finished",
      }),
    ).toEqual({
      type: "thread.realtime.closed",
      threadId: "thread-1",
      reason: "session-finished",
    });
  });
});
