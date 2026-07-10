import { describe, expect, it } from "vitest";
import {
  MAX_AUDIO_FILENAME_LENGTH,
  MAX_AUDIO_RECORDING_BYTES,
  MAX_AUDIO_REQUEST_ID_LENGTH,
  TranscribeAudioParamsSchema,
} from "./audio";

const validRequest = {
  audioData: new Uint8Array([1, 2, 3]),
  filename: "recording.webm",
  requestId: "request-id",
};

describe("TranscribeAudioParamsSchema", () => {
  it("accepts a typed array at the byte limit", () => {
    const bytes = new Uint8Array(MAX_AUDIO_RECORDING_BYTES + 1);

    expect(
      TranscribeAudioParamsSchema.safeParse({
        ...validRequest,
        audioData: bytes.subarray(0, MAX_AUDIO_RECORDING_BYTES),
      }).success,
    ).toBe(true);
    expect(
      TranscribeAudioParamsSchema.safeParse({
        ...validRequest,
        audioData: bytes,
      }).success,
    ).toBe(false);
  });

  it("rejects empty audio and boxed number arrays", () => {
    expect(
      TranscribeAudioParamsSchema.safeParse({
        ...validRequest,
        audioData: new Uint8Array(),
      }).success,
    ).toBe(false);
    expect(
      TranscribeAudioParamsSchema.safeParse({
        ...validRequest,
        audioData: [1, 2, 3],
      }).success,
    ).toBe(false);
  });

  it("enforces filename and request ID length boundaries", () => {
    expect(
      TranscribeAudioParamsSchema.safeParse({
        ...validRequest,
        filename: `${"a".repeat(MAX_AUDIO_FILENAME_LENGTH - 5)}.webm`,
        requestId: "r".repeat(MAX_AUDIO_REQUEST_ID_LENGTH),
      }).success,
    ).toBe(true);
    expect(
      TranscribeAudioParamsSchema.safeParse({
        ...validRequest,
        filename: "a".repeat(MAX_AUDIO_FILENAME_LENGTH + 1),
      }).success,
    ).toBe(false);
    expect(
      TranscribeAudioParamsSchema.safeParse({
        ...validRequest,
        requestId: "r".repeat(MAX_AUDIO_REQUEST_ID_LENGTH + 1),
      }).success,
    ).toBe(false);
    expect(
      TranscribeAudioParamsSchema.safeParse({
        ...validRequest,
        filename: "../recording.webm",
      }).success,
    ).toBe(false);
  });

  it.each([".", "..", " . ", " .. "])(
    "rejects the traversal filename %j",
    (filename) => {
      expect(
        TranscribeAudioParamsSchema.safeParse({
          ...validRequest,
          filename,
        }).success,
      ).toBe(false);
    },
  );

  it("accepts header-safe request IDs and rejects invalid characters", () => {
    expect(
      TranscribeAudioParamsSchema.safeParse({
        ...validRequest,
        requestId: "request-123_abc.def:ghi",
      }).success,
    ).toBe(true);

    for (const requestId of [
      "request id",
      "request\r\nX-Injected: true",
      "request-id-💥",
    ]) {
      expect(
        TranscribeAudioParamsSchema.safeParse({
          ...validRequest,
          requestId,
        }).success,
      ).toBe(false);
    }
  });
});
