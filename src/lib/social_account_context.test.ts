import { describe, expect, it } from "vitest";

import { buildSocialAccountContext } from "@/lib/social_account_context";
import type { UserSettings } from "@/lib/schemas";

describe("buildSocialAccountContext", () => {
  it("exposes the connected X identity without exposing credentials", () => {
    const context = buildSocialAccountContext({
      socialMedia: {
        x: {
          authType: "oauth2",
          clientId: "client-id",
          clientSecret: { value: "client-secret" },
          accessToken: { value: "access-token" },
          refreshToken: { value: "refresh-token" },
          username: "724real",
          displayName: "724 Real",
          followersCount: 420,
        },
      },
    } as UserSettings);

    expect(context).toContain('"username":"724real"');
    expect(context).toContain('"profileUrl":"https://x.com/724real"');
    expect(context).toContain("Do not ask the user for their X handle");
    expect(context).not.toContain("client-secret");
    expect(context).not.toContain("access-token");
    expect(context).not.toContain("refresh-token");
  });

  it("adds no prompt context when social accounts are disconnected", () => {
    expect(buildSocialAccountContext({} as UserSettings)).toBe("");
  });
});
