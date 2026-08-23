import { describe, expect, it } from "vitest";
import { safeTempPreviewErrorMessage } from "./temp_preview_safe_error";

describe("safeTempPreviewErrorMessage", () => {
  it("redacts build paths and credentials before presentation", () => {
    const result = safeTempPreviewErrorMessage(
      new Error(
        "Build failed at '/Users/alice/Client Project/.env'\nAuthorization: Bearer private-token-value-12345",
      ),
    );

    expect(result).toContain("Build failed");
    expect(result).not.toContain("alice");
    expect(result).not.toContain("Client Project");
    expect(result).not.toContain("private-token-value-12345");
  });

  it("redacts upstream URLs and bounds oversized messages", () => {
    const result = safeTempPreviewErrorMessage(
      new Error(
        `temp.md failed at https://internal.corp/upload?token=secret ${"x".repeat(50_000)}`,
      ),
    );

    expect(result).not.toContain("internal.corp");
    expect(result).not.toContain("token=secret");
    expect(result.length).toBeLessThan(20_000);
  });
});
