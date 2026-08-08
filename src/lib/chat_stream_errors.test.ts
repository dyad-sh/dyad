import { describe, expect, it } from "vitest";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { formatChatStreamError } from "./chat_stream_errors";

describe("formatChatStreamError", () => {
  it("returns DyadError message unchanged", () => {
    const err = new DyadError("Model not loaded", DyadErrorKind.Validation);
    expect(formatChatStreamError(err)).toBe("Model not loaded");
  });

  it("maps LM Studio connection failures", () => {
    expect(
      formatChatStreamError(new Error("fetch failed"), {
        provider: "lmstudio",
      }),
    ).toContain("LM Studio");
  });

  it("maps missing model for LM Studio", () => {
    expect(
      formatChatStreamError(new Error("Model 'foo' not found"), {
        provider: "lmstudio",
        modelName: "foo",
      }),
    ).toContain('LM Studio does not have "foo"');
  });

  it("maps context length errors", () => {
    expect(
      formatChatStreamError(new Error("maximum context length exceeded")),
    ).toContain("context window");
  });
});
