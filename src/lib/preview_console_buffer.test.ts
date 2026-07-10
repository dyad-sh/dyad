import { describe, expect, it } from "vitest";
import {
  boundUtf8String,
  formatPreviewConsoleMessage,
  formatPreviewNetworkStatus,
  getUtf8ByteLength,
} from "./preview_console_buffer";

describe("preview console formatting", () => {
  it("bounds the truncation suffix itself when it exceeds the byte limit", () => {
    const bounded = boundUtf8String(
      "value that must be truncated",
      2,
      "marker",
    );

    expect(bounded).toEqual({ value: "ma", byteLength: 2 });
    expect(getUtf8ByteLength(bounded.value)).toBeLessThanOrEqual(2);
  });

  it("does not split a multibyte suffix to fill an undersized budget", () => {
    const bounded = boundUtf8String("value that must be truncated", 2, "🙂");

    expect(bounded).toEqual({ value: "", byteLength: 0 });
  });

  it("preserves HTTP status zero while labeling non-numeric statuses unknown", () => {
    expect(formatPreviewNetworkStatus(0)).toBe("[0]");
    expect(formatPreviewNetworkStatus(204)).toBe("[204]");
    expect(formatPreviewNetworkStatus(undefined)).toBe("[unknown status]");
    expect(formatPreviewNetworkStatus("200")).toBe("[unknown status]");
  });

  it("formats only explicit value arrays", () => {
    expect(formatPreviewConsoleMessage("[LOG]", ["hello", 42])).toBe(
      "[LOG] hello 42",
    );
  });
});
