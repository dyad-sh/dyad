import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ListedApp } from "@/ipc/types/app";
import { AppShowcaseCard } from "./AppShowcaseCard";

const app = {
  id: 7,
  name: "Neon dashboard",
} as ListedApp;

describe("AppShowcaseCard", () => {
  it("renders a visual project thumbnail when no screenshot exists", () => {
    render(<AppShowcaseCard app={app} thumbnailUrl={null} onClick={vi.fn()} />);

    expect(screen.getByTestId("app-thumbnail-fallback")).toBeTruthy();
  });

  it("renders a saved project screenshot when available", () => {
    const { container } = render(
      <AppShowcaseCard
        app={app}
        thumbnailUrl="dyad-media://media/app/.dyad/screenshot/preview.png"
        onClick={vi.fn()}
      />,
    );

    expect(container.querySelector("img")?.getAttribute("src")).toContain(
      "preview.png",
    );
    expect(screen.queryByTestId("app-thumbnail-fallback")).toBeNull();
  });
});
