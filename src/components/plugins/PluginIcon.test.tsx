import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PluginIcon } from "./PluginIcon";

const ICON_URL = "https://api.dyad.sh/v1/mcp-catalog/icons/example.svg";

describe("PluginIcon", () => {
  it("shows the icon when there is a URL", () => {
    render(<PluginIcon name="Example" iconUrl={ICON_URL} />);
    const icon = screen.getByTestId<HTMLImageElement>("plugin-icon");
    expect(icon.src).toBe(ICON_URL);
    expect(screen.queryByTestId("plugin-icon-fallback")).toBeNull();
  });

  it("shows the initial when there is no URL", () => {
    render(<PluginIcon name="example" />);
    expect(screen.queryByTestId("plugin-icon")).toBeNull();
    expect(screen.getByTestId("plugin-icon-fallback").textContent).toBe("E");
  });

  it("keeps a whole first character, not half an emoji", () => {
    render(<PluginIcon name="🚀 Rocket" />);
    expect(screen.getByTestId("plugin-icon-fallback").textContent).toBe("🚀");
  });

  it("falls back to the initial when the icon fails to load", () => {
    render(<PluginIcon name="Example" iconUrl={ICON_URL} />);
    fireEvent.error(screen.getByTestId("plugin-icon"));
    expect(screen.queryByTestId("plugin-icon")).toBeNull();
    expect(screen.getByTestId("plugin-icon-fallback").textContent).toBe("E");
  });

  // The name sits next to the tile already; a second copy in the image's
  // accessible name would be read twice.
  it("stays decorative", () => {
    render(<PluginIcon name="Example" iconUrl={ICON_URL} />);
    expect(screen.queryByRole("img")).toBeNull();
  });
});
