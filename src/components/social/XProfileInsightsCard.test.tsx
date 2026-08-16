import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { XProfileInsightsCard } from "./XProfileInsightsCard";

describe("XProfileInsightsCard", () => {
  it("uses the active theme surface and readable semantic text", () => {
    const { container } = render(
      <XProfileInsightsCard
        profile={{
          connected: true,
          username: "724real",
          displayName: "724",
          followersCount: 3181,
          followingCount: 5638,
          postCount: 661,
        }}
        posts={[]}
        refreshing={false}
        onRefresh={vi.fn()}
      />,
    );

    const card = container.querySelector("section");
    expect(card?.className).toContain("bg-card");
    expect(card?.className).toContain("border-border");
    expect(card?.className).not.toContain("linear-gradient");
    expect(screen.getByText("@724real")).toBeTruthy();
  });
});
