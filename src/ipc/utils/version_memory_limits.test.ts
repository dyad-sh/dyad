import { describe, expect, it } from "vitest";
import { vi } from "vitest";
import { loadBoundedDiffContent, truncateUtf8 } from "./version_memory_limits";

describe("truncateUtf8", () => {
  it("preserves text within the byte budget", () => {
    expect(truncateUtf8("small message", 32)).toEqual({
      value: "small message",
      truncated: false,
    });
  });

  it("caps bytes without splitting a multi-byte character", () => {
    const result = truncateUtf8("hello 😀😀😀", 13);

    expect(result.truncated).toBe(true);
    expect(Buffer.byteLength(result.value, "utf8")).toBeLessThanOrEqual(13);
    expect(result.value).not.toContain("�");
    expect(result.value.endsWith("…")).toBe(true);
  });
});

describe("loadBoundedDiffContent", () => {
  it("does not read a blob that exceeds the preflight size budget", async () => {
    const read = vi.fn();

    await expect(
      loadBoundedDiffContent({
        maxBytes: 1_000,
        getSize: async () => 1_001,
        read,
      }),
    ).resolves.toEqual({
      content: "<file too large to display>",
      status: "too-large",
    });
    expect(read).not.toHaveBeenCalled();
  });

  it("returns normal text within the preflight budget", async () => {
    await expect(
      loadBoundedDiffContent({
        maxBytes: 1_000,
        getSize: async () => 5,
        read: async () => "hello",
      }),
    ).resolves.toEqual({ content: "hello", status: "available" });
  });
});
