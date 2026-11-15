/**
 * posthog-cli injects a snippet into each bundle that registers the bundle's
 * chunk ID on `globalThis._posthogChunkIds`, keyed by a stack trace captured
 * inside that bundle. posthog-js reads this registry to tag each stack frame
 * with the chunk ID PostHog uses to find the uploaded source map.
 *
 * Main-process bundles register in the main process, but posthog-js runs in
 * the renderer. Exceptions forwarded from main therefore carry main's
 * registry, and the renderer merges it into its own before capturing.
 */
export const POSTHOG_CHUNK_IDS_PROPERTY = "posthog_chunk_ids";

export type PostHogChunkIdRegistry = Record<string, string>;

type ChunkIdHost = { _posthogChunkIds?: unknown };

/** Returns this process's registry, or undefined in builds without chunk IDs. */
export function readPostHogChunkIds(
  host: ChunkIdHost = globalThis as ChunkIdHost,
): PostHogChunkIdRegistry | undefined {
  const registry = toChunkIdRegistry(host._posthogChunkIds);
  return registry && Object.keys(registry).length > 0 ? registry : undefined;
}

/** Adds forwarded chunk IDs to this process's registry; ignores malformed input. */
export function mergePostHogChunkIds(
  forwarded: unknown,
  host: ChunkIdHost = globalThis as ChunkIdHost,
): void {
  const incoming = toChunkIdRegistry(forwarded);
  if (!incoming || Object.keys(incoming).length === 0) {
    return;
  }
  host._posthogChunkIds = {
    ...toChunkIdRegistry(host._posthogChunkIds),
    ...incoming,
  };
}

function toChunkIdRegistry(value: unknown): PostHogChunkIdRegistry | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const registry: PostHogChunkIdRegistry = {};
  for (const [stack, chunkId] of Object.entries(value)) {
    if (typeof chunkId === "string") {
      registry[stack] = chunkId;
    }
  }
  return registry;
}
