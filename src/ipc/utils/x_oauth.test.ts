import { describe, expect, it } from "vitest";

import { X_OAUTH_REDIRECT_URI, X_OAUTH_SCOPES } from "@/lib/xOAuth";

describe("X OAuth configuration", () => {
  it("uses a fixed loopback callback that can be allow-listed in X", () => {
    expect(new URL(X_OAUTH_REDIRECT_URI)).toMatchObject({
      protocol: "http:",
      hostname: "127.0.0.1",
      port: "49192",
      pathname: "/x-oauth/callback",
    });
  });

  it("requests user-context publishing, media, and refresh permissions", () => {
    expect(X_OAUTH_SCOPES).toEqual(
      expect.arrayContaining([
        "tweet.read",
        "users.read",
        "tweet.write",
        "media.write",
        "offline.access",
      ]),
    );
  });
});
