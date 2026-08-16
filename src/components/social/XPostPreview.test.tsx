import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { XPostPreview } from "./XPostPreview";

describe("XPostPreview", () => {
  it("renders the connected profile, media, copy, and engagement", () => {
    render(
      <XPostPreview
        displayName="Example User"
        username="example_user"
        profileImageUrl="https://example.com/avatar.jpg"
        verified
        content="Shipping a much better social workspace today."
        image="data:image/png;base64,aGVsbG8="
        metrics={{
          replies: 4,
          reposts: 12,
          likes: 98,
          quotes: 1,
          impressions: 2400,
        }}
      />,
    );

    expect(screen.getByTestId("x-post-preview")).toBeTruthy();
    expect(screen.getByText("Example User")).toBeTruthy();
    expect(screen.getByText("@example_user")).toBeTruthy();
    expect(
      screen.getByText("Shipping a much better social workspace today."),
    ).toBeTruthy();
    expect(screen.getByAltText("Post attachment preview")).toBeTruthy();
    expect(screen.getByText("98")).toBeTruthy();
    expect(screen.getByText("2.4K")).toBeTruthy();
  });
});
