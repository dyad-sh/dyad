import { describe, expect, it } from "vitest";
import {
  mergePostHogChunkIds,
  readPostHogChunkIds,
} from "@/shared/posthog_chunk_ids";

describe("readPostHogChunkIds", () => {
  it("returns undefined for builds without injected chunk IDs", () => {
    expect(readPostHogChunkIds({})).toBeUndefined();
    expect(readPostHogChunkIds({ _posthogChunkIds: {} })).toBeUndefined();
  });

  it("returns the registry, dropping non-string IDs", () => {
    expect(
      readPostHogChunkIds({
        _posthogChunkIds: { "Error\n at main.js:1:1": "chunk-a", bad: 1 },
      }),
    ).toEqual({ "Error\n at main.js:1:1": "chunk-a" });
  });
});

describe("mergePostHogChunkIds", () => {
  it("adds forwarded main-process IDs alongside the renderer's own", () => {
    const host = { _posthogChunkIds: { "renderer-stack": "chunk-r" } };
    mergePostHogChunkIds({ "main-stack": "chunk-m" }, host);
    expect(host._posthogChunkIds).toEqual({
      "renderer-stack": "chunk-r",
      "main-stack": "chunk-m",
    });
  });

  it("creates the registry when the renderer has none", () => {
    const host: { _posthogChunkIds?: unknown } = {};
    mergePostHogChunkIds({ "main-stack": "chunk-m" }, host);
    expect(host._posthogChunkIds).toEqual({ "main-stack": "chunk-m" });
  });

  it.each([undefined, null, "chunk", ["chunk"], {}])(
    "ignores malformed input %j",
    (forwarded) => {
      const host = { _posthogChunkIds: { "renderer-stack": "chunk-r" } };
      const before = host._posthogChunkIds;
      mergePostHogChunkIds(forwarded, host);
      expect(host._posthogChunkIds).toBe(before);
    },
  );
});
