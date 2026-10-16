/**
 * The chat message behind the Cloudflare tab's "Convert to Nitro" button.
 *
 * The agent's `enable_nitro` tool makes the same change the Neon integration
 * makes on connect, so the message asks for that tool by name: written by
 * hand, the setup can come out different from the one the deploy expects.
 * Kept apart from the tab so the wording can be tested without rendering it.
 */
export function buildCloudflareNitroConversionPrompt(): string {
  return [
    "Add a Nitro server layer to this app so it can be deployed to Cloudflare Workers.",
    "Use the `enable_nitro` tool to add it rather than writing the Nitro files by hand, and make no other changes: add no routes, and leave how the app works as it is.",
    "If the tool is not available, say so and stop.",
  ].join(" ");
}
