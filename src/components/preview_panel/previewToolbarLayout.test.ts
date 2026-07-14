import { describe, expect, it } from "vitest";
import { getPreviewToolbarActionVisibility } from "./previewToolbarLayout";

describe("getPreviewToolbarActionVisibility", () => {
  it("shows secondary actions before the toolbar has been measured", () => {
    expect(getPreviewToolbarActionVisibility(null)).toEqual({
      showOpenBrowser: true,
    });
  });

  it("keeps all actions visible in a wide toolbar", () => {
    expect(getPreviewToolbarActionVisibility(900)).toEqual({
      showOpenBrowser: true,
    });
  });

  it("keeps open in browser visible at medium widths", () => {
    expect(getPreviewToolbarActionVisibility(760)).toEqual({
      showOpenBrowser: true,
    });
  });

  it("moves open in browser into overflow in a narrow toolbar", () => {
    expect(getPreviewToolbarActionVisibility(600)).toEqual({
      showOpenBrowser: false,
    });
  });
});
