import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SocialPost } from "@/ipc/types/social_media";
import { PostDetailsModal } from "./PostDetailsModal";

const mocks = vi.hoisted(() => ({
  refreshPostMetrics: vi.fn(),
}));

vi.mock("@/hooks/useSocialMedia", () => ({
  useSocialConnections: () => ({
    connections: {
      facebook: { connected: false },
      x: {
        connected: true,
        username: "724real",
        displayName: "724",
      },
    },
  }),
  useSocialPosts: () => ({
    createPost: vi.fn(),
    updatePost: vi.fn(),
    deletePost: vi.fn(),
    publishPost: vi.fn(),
    refreshPostMetrics: mocks.refreshPostMetrics,
  }),
}));

const publishedPost: SocialPost = {
  id: "post-1",
  platform: "x",
  content: "Live X post",
  image: null,
  prompt: null,
  status: "posted",
  scheduledFor: null,
  postedAt: 1_786_872_883_169,
  externalId: "2088922390386598035",
  externalUrl: "https://x.com/724real/status/2088922390386598035",
  error: null,
  metrics: null,
  metricsUpdatedAt: null,
  createdAt: 1_786_872_882_514,
  updatedAt: 1_786_872_883_169,
};

describe("PostDetailsModal", () => {
  beforeEach(() => {
    mocks.refreshPostMetrics.mockReset();
  });

  it("retrieves X performance automatically when a published post opens", async () => {
    mocks.refreshPostMetrics.mockResolvedValue({
      ...publishedPost,
      metrics: {
        replies: 3,
        reposts: 8,
        likes: 42,
        quotes: 2,
        impressions: 1400,
      },
      metricsUpdatedAt: 1_786_872_900_000,
    });

    render(
      <PostDetailsModal post={publishedPost} open onOpenChange={vi.fn()} />,
    );

    await waitFor(() => {
      expect(mocks.refreshPostMetrics).toHaveBeenCalledTimes(1);
      expect(mocks.refreshPostMetrics).toHaveBeenCalledWith("post-1");
    });
    expect((await screen.findAllByText("42")).length).toBeGreaterThan(0);
    expect((await screen.findAllByText("1.4K")).length).toBeGreaterThan(0);
  });

  it("shows the X API failure inside the performance panel", async () => {
    mocks.refreshPostMetrics.mockRejectedValue(
      new Error("X API access level does not include post lookup."),
    );

    render(
      <PostDetailsModal post={publishedPost} open onOpenChange={vi.fn()} />,
    );

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Could not retrieve X performance: X API access level does not include post lookup.",
    );
  });
});
