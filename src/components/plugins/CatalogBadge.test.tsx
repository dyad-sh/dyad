import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CatalogBadge } from "./CatalogBadge";

describe("CatalogBadge", () => {
  it("shows the word in the default size", () => {
    render(<CatalogBadge />);
    expect(screen.getByTestId("catalog-badge").textContent).toBe("Catalog");
  });

  it("keeps the word for screen readers in the icon size", () => {
    render(<CatalogBadge size="icon" />);
    const badge = screen.getByTestId("catalog-badge");
    expect(badge.textContent).toBe("Catalog");
    // Only the icon is visible; the label is screen-reader text.
    expect(screen.getByText("Catalog").classList.contains("sr-only")).toBe(
      true,
    );
  });
});
