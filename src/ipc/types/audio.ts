import { z } from "zod";
import { defineContract, createClient } from "../contracts/core";

// =============================================================================
// Transcription Schemas
// =============================================================================

export const TranscribeAudioParamsSchema = z.object({
  audioData: z.array(z.number()),
  filename: z.string(),
  requestId: z.string(),
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
