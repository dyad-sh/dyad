import { describe, expect, it } from "vitest";

import {
  DIFF_BINARY_PLACEHOLDER,
  DIFF_TOO_LARGE_PLACEHOLDER,
} from "@/shared/diff_placeholders";
import { sanitizeDiffContent } from "./diff_content";

const NUL = String.fromCharCode(0);
const REPLACEMENT_CHAR = String.fromCharCode(0xfffd);

describe("sanitizeDiffContent", () => {
  it("passes ordinary text through unchanged", () => {
    const content = "const x = 1;\nconsole.log(x);\n";
    expect(sanitizeDiffContent(content)).toBe(content);
  });

  it("replaces content containing a NUL byte with the binary placeholder", () => {
    expect(sanitizeDiffContent(`abc${NUL}def`)).toBe(DIFF_BINARY_PLACEHOLDER);
  });

  it("replaces content with the U+FFFD replacement char with the binary placeholder", () => {
    // Invalid UTF-8 bytes without a NUL decode to U+FFFD; treating that as
    // binary prevents an edit from writing mojibake back over the asset.
    expect(sanitizeDiffContent(`PNG${REPLACEMENT_CHAR}data`)).toBe(
      DIFF_BINARY_PLACEHOLDER,
    );
  });

  it("replaces oversized content with the too-large placeholder", () => {
    const huge = "a".repeat(1_000_001);
    expect(sanitizeDiffContent(huge)).toBe(DIFF_TOO_LARGE_PLACEHOLDER);
  });
});
