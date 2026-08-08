/**
 * Picks which of a model's returned images to actually use.
 *
 * A prompt asks for "an image", singular, and the chat shows one card with one
 * Download button. Some models nonetheless answer with several near-identical
 * variants for a single prompt — Gemini 3 Pro Image does — and every extra one
 * is shown twice over: once in the conversation and once as a stray file in
 * the vault. Keep the first.
 */
export function selectGeneratedImages(urls: string[]): string[] {
  const usable = urls.filter((url) => url.startsWith("data:image/"));
  const unique = [...new Set(usable)];
  return unique.slice(0, 1);
}
