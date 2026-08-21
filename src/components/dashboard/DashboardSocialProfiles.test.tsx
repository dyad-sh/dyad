import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";

import { DashboardSocialProfiles } from "./DashboardSocialProfiles";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to, ...props }: ComponentProps<"a"> & { to: string }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));

describe("DashboardSocialProfiles", () => {
  it("shows the connected X profile and real planner activity", () => {
    const onRefreshX = vi.fn();
    render(
      <DashboardSocialProfiles
        connections={{
          facebook: { connected: false },
          x: {
            connected: true,
            username: "724real",
            displayName: "724",
            followersCount: 3181,
            followingCount: 5638,
            postCount: 661,
            verified: true,
          },
        }}
        posts={[
          {
            id: "published",
            platform: "x",
            content: "Published",
            status: "posted",
            postedAt: Date.now(),
            metrics: {
              replies: 2,
              reposts: 3,
              likes: 10,
              quotes: 1,
            },
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
          {
            id: "scheduled",
            platform: "x",
            content: "Scheduled",
            status: "scheduled",
            scheduledFor: Date.now() + 60_000,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
        ]}
        refreshing={false}
        onRefreshX={onRefreshX}
      />,
    );

    const card = screen.getByTestId("dashboard-social-profiles");
    expect(card.textContent).toContain("@724real");
    expect(card.textContent).toContain("3,181");
    expect(card.textContent).toContain("30d published");
    expect(card.textContent).toContain("Scheduled");
    expect(card.textContent).toContain("16");

    fireEvent.click(screen.getByTitle("Refresh X profile"));
    expect(onRefreshX).toHaveBeenCalledOnce();
  });
});
