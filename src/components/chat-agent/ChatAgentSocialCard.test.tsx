import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ChatAgentXProfileCard } from "./ChatAgentSocialCard";

vi.mock("@/ipc/types", () => ({
  ipc: { system: { openExternalUrl: vi.fn() } },
}));

describe("ChatAgentXProfileCard", () => {
  it("renders the connected identity and last-synced statistics", () => {
    render(
      <ChatAgentXProfileCard
        presentation={{
          kind: "x-profile",
          username: "724real",
          displayName: "724",
          profileUrl: "https://x.com/724real",
          profileImageUrl: "https://example.com/avatar.jpg",
          bio: "Code. Train. Shred.",
          verified: true,
          followersCount: 3181,
          followingCount: 5638,
          postCount: 661,
          profileSyncedAt: Date.now(),
        }}
      />,
    );

    expect(screen.getByTestId("chat-x-profile-card")).toBeTruthy();
    expect(screen.getByText("@724real")).toBeTruthy();
    expect(screen.getByText("Code. Train. Shred.")).toBeTruthy();
    expect(screen.getByText("3.2K")).toBeTruthy();
    expect(screen.getByText("661")).toBeTruthy();
    expect(screen.getByRole("button", { name: /view on x/i })).toBeTruthy();
  });
});
