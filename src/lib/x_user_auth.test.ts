import { describe, expect, it } from "vitest";

import { shouldRefreshXUserAuth } from "./x_user_auth";

describe("X user-auth recovery", () => {
  it("retries an app-only classification with the saved refresh token", () => {
    expect(
      shouldRefreshXUserAuth(
        403,
        "Authenticating with OAuth 2.0 Application-Only is forbidden",
      ),
    ).toBe(true);
  });

  it("retries an expired or rejected bearer token", () => {
    expect(shouldRefreshXUserAuth(401, "Invalid token")).toBe(true);
  });

  it("does not retry a genuine missing-scope error", () => {
    expect(
      shouldRefreshXUserAuth(
        403,
        "Client is not permitted to perform this action",
      ),
    ).toBe(false);
  });
});
