export type BatchSpeechToTextModel = "scribe_v1" | "scribe_v2";

/**
 * The chat microphone uploads a completed recording to ElevenLabs' batch
 * speech-to-text endpoint. Realtime model ids belong to a different API, so
 * map them to the current batch model instead of sending an invalid id.
 */
export function resolveBatchSpeechToTextModel(
  configuredModelId?: string,
): BatchSpeechToTextModel {
  return configuredModelId?.trim() === "scribe_v1" ? "scribe_v1" : "scribe_v2";
}
