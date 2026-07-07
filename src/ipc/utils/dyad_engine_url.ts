export function getDyadEngineBaseUrl(): string {
  return process.env.DYAD_ENGINE_URL ?? "https://engine.dyad.sh/v1";
}
