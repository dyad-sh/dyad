import { describe, expect, it } from "vitest";
import {
  getLandscapeWindowBounds,
  getPortraitWindowBounds,
} from "./window_layout";

const workArea = { x: 0, y: 24, width: 1_440, height: 876 };

describe("window layout bounds", () => {
  it("creates a centered portrait window within the display", () => {
    const bounds = getPortraitWindowBounds(workArea);

    expect(bounds.height).toBeGreaterThan(bounds.width);
    expect(bounds.x).toBeGreaterThanOrEqual(workArea.x);
    expect(bounds.y).toBeGreaterThanOrEqual(workArea.y);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(workArea.width);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(
      workArea.y + workArea.height,
    );
  });

  it("creates a centered landscape window within the display", () => {
    const bounds = getLandscapeWindowBounds(workArea);

    expect(bounds.width).toBeGreaterThan(bounds.height);
    expect(bounds.x).toBeGreaterThanOrEqual(workArea.x);
    expect(bounds.y).toBeGreaterThanOrEqual(workArea.y);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(workArea.width);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(
      workArea.y + workArea.height,
    );
  });
});
