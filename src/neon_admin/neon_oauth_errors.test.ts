import { describe, expect, it } from "vitest";
import { getNeonOAuthErrorCode } from "./neon_oauth_errors";

describe("safe Neon OAuth diagnostics", () => {
  it.each([
    [
      {
        error: "Failed to refresh tokens",
        details: { error: "invalid_grant", error_description: "secret" },
      },
      "invalid_grant",
    ],
    [
      {
        error: "Failed to refresh tokens",
        details: { error: "invalid_client" },
      },
      "invalid_client",
    ],
    [
      {
        error: "Failed to refresh tokens",
        details: { error_description: "invalid_grant" },
      },
      undefined,
    ],
    [{ error: "invalid_grant", error_description: "secret" }, "invalid_grant"],
    [
      { error: { code: "invalid_client", message: "secret" } },
      "invalid_client",
    ],
    [{ code: "server_error" }, "server_error"],
    [{ error: "secret-token" }, undefined],
    [{ error_description: "invalid_grant" }, undefined],
    [null, undefined],
  ])("extracts only known codes from %j", async (body, code) => {
    expect(
      await getNeonOAuthErrorCode(new Response(JSON.stringify(body))),
    ).toBe(code);
  });
  it("handles non-JSON proxy errors", async () => {
    expect(
      await getNeonOAuthErrorCode(
        new Response("<html>private upstream error</html>"),
      ),
    ).toBeUndefined();
  });
});
