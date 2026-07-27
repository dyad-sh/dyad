// @vitest-environment node
import { describe, expect, it } from "vitest";

import { DyadErrorKind } from "@/errors/dyad_error";
import { classifyPiProviderError } from "./provider_error";

describe("classifyPiProviderError", () => {
  it.each([
    ["401 Unauthorized", DyadErrorKind.Auth],
    ["API key is invalid", DyadErrorKind.Auth],
    ["429 Too Many Requests", DyadErrorKind.RateLimited],
    ["400 invalid request: unsupported parameter", DyadErrorKind.Validation],
    ["Request was rejected by the content filter", DyadErrorKind.Precondition],
    ["upstream connection reset", DyadErrorKind.External],
  ])("classifies %s", (message, expected) => {
    expect(classifyPiProviderError({ errorMessage: message })).toBe(expected);
  });

  it("uses a structured diagnostic status when the display message is generic", () => {
    expect(
      classifyPiProviderError({
        errorMessage: "Provider request failed",
        diagnostics: [
          {
            type: "provider_error",
            timestamp: 1,
            details: { status: 429 },
          },
        ],
      }),
    ).toBe(DyadErrorKind.RateLimited);
  });
});
