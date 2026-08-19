import { describe, expect, it } from "vitest";

import {
  shouldRetryXTokenAsPublicClient,
  xTokenAuthorization,
} from "./x_oauth";

describe("X OAuth client authentication", () => {
  it("form-encodes reserved characters before building Basic auth", () => {
    const authorization = xTokenAuthorization("client+id", "secret+/=");
    const decoded = Buffer.from(
      authorization!.slice("Basic ".length),
      "base64",
    ).toString("utf8");

    expect(decoded).toBe("client%2Bid:secret%2B%2F%3D");
  });

  it("falls back to public-client auth when X rejects the Basic header", () => {
    expect(
      shouldRetryXTokenAsPublicClient(
        401,
        "Missing valid authorization header",
        true,
      ),
    ).toBe(true);
  });

  it("does not hide refresh-token or scope errors behind a retry", () => {
    expect(shouldRetryXTokenAsPublicClient(400, "invalid_grant", true)).toBe(
      false,
    );
    expect(
      shouldRetryXTokenAsPublicClient(
        401,
        "Missing valid authorization header",
        false,
      ),
    ).toBe(false);
  });
});
