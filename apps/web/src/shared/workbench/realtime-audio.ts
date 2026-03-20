import type { RealtimeAudioChunk } from "@webcli/contracts";

export type DecodedRealtimeAudioChunk = {
  pcmBytes: Uint8Array;
  sampleRate: number;
  numChannels: number;
  samplesPerChannel: number;
};

export function decodeRealtimeAudioChunk(
  chunk: RealtimeAudioChunk,
  expected?: { sampleRate: number; numChannels: number },
): DecodedRealtimeAudioChunk {
  const pcmBytes = decodeBase64(chunk.data);

  if (pcmBytes.byteLength === 0) {
    throw new Error("Empty realtime audio chunk.");
  }

  if (pcmBytes.byteLength % 2 !== 0) {
    throw new Error("Realtime audio chunk must contain an even number of PCM16 bytes.");
  }

  if (chunk.numChannels <= 0) {
    throw new Error("Realtime audio chunk must declare a positive channel count.");
  }

  if (chunk.sampleRate <= 0) {
    throw new Error("Realtime audio chunk must declare a positive sample rate.");
  }

  if (expected) {
    if (expected.sampleRate !== chunk.sampleRate) {
      throw new Error("Realtime audio chunk changed sample rate within the same session.");
    }
    if (expected.numChannels !== chunk.numChannels) {
      throw new Error("Realtime audio chunk changed channel count within the same session.");
    }
  }

  const samplesPerChannel = pcmBytes.byteLength / 2 / chunk.numChannels;
  if (!Number.isInteger(samplesPerChannel) || samplesPerChannel <= 0) {
    throw new Error("Realtime audio chunk has invalid PCM16 channel alignment.");
  }

  if (
    chunk.samplesPerChannel !== null &&
    chunk.samplesPerChannel !== samplesPerChannel
  ) {
    throw new Error("Realtime audio chunk sample metadata does not match its PCM payload.");
  }

  return {
    pcmBytes,
    sampleRate: chunk.sampleRate,
    numChannels: chunk.numChannels,
    samplesPerChannel,
  };
}

export function buildRealtimeWavBlob(
  chunks: Array<Uint8Array>,
  sampleRate: number,
  numChannels: number,
): Blob {
  const totalDataBytes = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const buffer = new ArrayBuffer(44 + totalDataBytes);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const blockAlign = numChannels * 2;
  const byteRate = sampleRate * blockAlign;

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + totalDataBytes, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, totalDataBytes, true);

  let offset = 44;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new Blob([buffer], { type: "audio/wav" });
}

function decodeBase64(value: string): Uint8Array {
  const trimmed = value.trim();
  if (!trimmed) {
    return new Uint8Array();
  }

  if (typeof atob === "function") {
    const binary = atob(trimmed);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }

  return Uint8Array.from(Buffer.from(trimmed, "base64"));
}

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let index = 0; index < text.length; index += 1) {
    view.setUint8(offset + index, text.charCodeAt(index));
  }
}
