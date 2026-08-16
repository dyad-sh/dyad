import { describe, expect, it } from "vitest";

import {
  ConnectXParamsSchema,
  SocialConnectionsStatusSchema,
  SocialPostSchema,
} from "@/ipc/types/social_media";
import { XConnectionSchema } from "@/lib/schemas";

describe("X OAuth credentials", () => {
  it("accepts OAuth 2.0 client credentials for the PKCE sign-in flow", () => {
    expect(
      ConnectXParamsSchema.parse({
        clientId: "oauth2-client-id",
        clientSecret: "oauth2-client-secret",
      }),
    ).toEqual({
      clientId: "oauth2-client-id",
      clientSecret: "oauth2-client-secret",
    });
  });

  it("stores OAuth 2.0 connections without legacy consumer secrets", () => {
    expect(
      XConnectionSchema.parse({
        authType: "oauth2",
        accessToken: { value: "oauth2-user-token" },
        refreshToken: { value: "oauth2-refresh-token" },
        clientId: "oauth2-client-id",
        clientSecret: { value: "oauth2-client-secret" },
        username: "example_user",
      }),
    ).toMatchObject({
      authType: "oauth2",
      accessToken: { value: "oauth2-user-token" },
      refreshToken: { value: "oauth2-refresh-token" },
      clientId: "oauth2-client-id",
      username: "example_user",
    });
  });

  it("continues to accept existing OAuth 1.0a connections", () => {
    expect(
      XConnectionSchema.safeParse({
        apiKey: { value: "consumer-key" },
        apiSecret: { value: "consumer-secret" },
        accessToken: { value: "access-token" },
        accessTokenSecret: { value: "access-token-secret" },
      }).success,
    ).toBe(true);
  });

  it("exposes profile insights without exposing credentials", () => {
    const status = SocialConnectionsStatusSchema.parse({
      facebook: { connected: false },
      x: {
        connected: true,
        username: "example_user",
        displayName: "Example User",
        bio: "Building useful things.",
        verified: true,
        followersCount: 12500,
        followingCount: 420,
        postCount: 880,
      },
    });

    expect(status.x.followersCount).toBe(12500);
    expect(status.x).not.toHaveProperty("accessToken");
  });

  it("retains X performance snapshots on planner posts", () => {
    const post = SocialPostSchema.parse({
      id: "post-1",
      platform: "x",
      content: "A polished post",
      status: "posted",
      postedAt: 1,
      externalId: "123",
      metrics: {
        replies: 3,
        reposts: 8,
        likes: 42,
        quotes: 2,
        impressions: 1400,
      },
      metricsUpdatedAt: 2,
      createdAt: 1,
      updatedAt: 2,
    });

    expect(post.metrics?.likes).toBe(42);
    expect(post.metrics?.impressions).toBe(1400);
  });
});
