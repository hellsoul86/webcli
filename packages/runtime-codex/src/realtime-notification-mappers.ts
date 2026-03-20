import type { JsonValue, RealtimeAudioChunk } from "@webcli/contracts";
import type { SessionRuntimeEvent } from "@webcli/core";
import type { ThreadRealtimeClosedNotification } from "./generated/v2/ThreadRealtimeClosedNotification";
import type { ThreadRealtimeErrorNotification } from "./generated/v2/ThreadRealtimeErrorNotification";
import type { ThreadRealtimeItemAddedNotification } from "./generated/v2/ThreadRealtimeItemAddedNotification";
import type { ThreadRealtimeOutputAudioDeltaNotification } from "./generated/v2/ThreadRealtimeOutputAudioDeltaNotification";
import type { ThreadRealtimeStartedNotification } from "./generated/v2/ThreadRealtimeStartedNotification";

export function mapThreadRealtimeStarted(
  payload: ThreadRealtimeStartedNotification,
): SessionRuntimeEvent {
  return {
    type: "thread.realtime.started",
    threadId: payload.threadId,
    sessionId: payload.sessionId,
  };
}

export function mapThreadRealtimeItemAdded(
  payload: ThreadRealtimeItemAddedNotification,
): SessionRuntimeEvent {
  return {
    type: "thread.realtime.itemAdded",
    threadId: payload.threadId,
    item: payload.item as JsonValue,
  };
}

export function mapThreadRealtimeOutputAudioDelta(
  payload: ThreadRealtimeOutputAudioDeltaNotification,
): SessionRuntimeEvent {
  return {
    type: "thread.realtime.outputAudio.delta",
    threadId: payload.threadId,
    audio: mapRealtimeAudioChunk(payload.audio),
  };
}

export function mapThreadRealtimeError(
  payload: ThreadRealtimeErrorNotification,
): SessionRuntimeEvent {
  return {
    type: "thread.realtime.error",
    threadId: payload.threadId,
    message: payload.message,
  };
}

export function mapThreadRealtimeClosed(
  payload: ThreadRealtimeClosedNotification,
): SessionRuntimeEvent {
  return {
    type: "thread.realtime.closed",
    threadId: payload.threadId,
    reason: payload.reason,
  };
}

function mapRealtimeAudioChunk(chunk: RealtimeAudioChunk): RealtimeAudioChunk {
  return {
    data: chunk.data,
    sampleRate: chunk.sampleRate,
    numChannels: chunk.numChannels,
    samplesPerChannel: chunk.samplesPerChannel,
  };
}
