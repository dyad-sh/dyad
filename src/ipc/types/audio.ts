import { z } from "zod";
import { defineContract, createClient } from "../contracts/core";

// =============================================================================
// Transcription Schemas
// =============================================================================

export const MAX_AUDIO_RECORDING_BYTES = 10 * 1024 * 1024;
export const MAX_AUDIO_RECORDING_DURATION_MS = 5 * 60 * 1000;
export const AUDIO_RECORDING_TIMESLICE_MS = 1000;
export const MAX_AUDIO_FILENAME_LENGTH = 255;
export const MAX_AUDIO_REQUEST_ID_LENGTH = 128;
export const AUDIO_REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]+$/;

export const TranscribeAudioParamsSchema = z.object({
  audioData: z
    .instanceof(Uint8Array)
    .refine((data) => data.byteLength > 0, "Audio data cannot be empty")
    .refine(
      (data) => data.byteLength <= MAX_AUDIO_RECORDING_BYTES,
      `Audio data cannot exceed ${MAX_AUDIO_RECORDING_BYTES} bytes`,
    ),
  filename: z
    .string()
    .trim()
    .min(1)
    .max(MAX_AUDIO_FILENAME_LENGTH)
    .refine(
      (filename) =>
        !filename.includes("/") &&
        !filename.includes("\\") &&
        filename !== "." &&
        filename !== "..",
      "Filename must not contain path separators or traversal segments",
    ),
  requestId: z
    .string()
    .trim()
    .min(1)
    .max(MAX_AUDIO_REQUEST_ID_LENGTH)
    .regex(AUDIO_REQUEST_ID_PATTERN, "Request ID contains invalid characters"),
});

export type TranscribeAudioParams = z.infer<typeof TranscribeAudioParamsSchema>;

export const TranscribeAudioResultSchema = z.object({
  text: z.string(),
});

export type TranscribeAudioResult = z.infer<typeof TranscribeAudioResultSchema>;

// =============================================================================
// Contracts
// =============================================================================

export const audioContracts = {
  transcribeAudio: defineContract({
    channel: "pro:transcribe-audio" as const,
    input: TranscribeAudioParamsSchema,
    output: TranscribeAudioResultSchema,
  }),
};

// =============================================================================
// Client
// =============================================================================

export const audioClient = createClient(audioContracts);
