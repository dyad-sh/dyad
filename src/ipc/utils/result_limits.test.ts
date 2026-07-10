import { describe, expect, it } from "vitest";
import { takeUtf8Prefix, takeUtf8Suffix, truncateUtf8 } from "./result_limits";

describe("UTF-8 result limits", () => {
  it("keeps exact byte boundaries intact", () => {
    expect(takeUtf8Prefix("ab😀cd", 6)).toBe("ab😀");
    expect(takeUtf8Suffix("ab😀cd", 6)).toBe("😀cd");
  });

  it("never splits multi-byte characters", () => {
    const result = truncateUtf8("😀😀😀", 9);

    expect(Buffer.byteLength(result.text, "utf8")).toBeLessThanOrEqual(9);
    expect(result.text).not.toContain("�");
    expect(result.truncated).toBe(true);
  });

  it("does not mark a value at the boundary as truncated", () => {
    expect(truncateUtf8("é", 2)).toEqual({
      text: "é",
      truncated: false,
    });
  });
});
