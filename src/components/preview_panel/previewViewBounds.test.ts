import { afterEach, describe, expect, it } from "vitest";
import {
  boundsEqual,
  computePreviewViewBounds,
  getRendererZoomFactor,
} from "./previewViewBounds";

const RECT = { x: 100.4, y: 50.6, width: 800.5, height: 600.2 };

describe("computePreviewViewBounds", () => {
  it("rounds CSS pixels to whole DIPs at 100% zoom", () => {
    expect(computePreviewViewBounds(RECT, 1)).toEqual({
      x: 100,
      y: 51,
      width: 801,
      height: 600,
    });
  });

  it("scales by the zoom factor, because setBounds works in window DIPs", () => {
    expect(
      computePreviewViewBounds({ x: 100, y: 50, width: 800, height: 600 }, 1.5),
    ).toEqual({ x: 150, y: 75, width: 1200, height: 900 });
  });

  it("clamps negative sizes, which happens while a panel collapses", () => {
    expect(
      computePreviewViewBounds({ x: 0, y: 0, width: -10, height: -1 }, 1),
    ).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });

  it("falls back to 1 for a nonsensical zoom factor", () => {
    for (const zoom of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        computePreviewViewBounds({ x: 10, y: 10, width: 10, height: 10 }, zoom),
      ).toEqual({ x: 10, y: 10, width: 10, height: 10 });
    }
  });
});

describe("boundsEqual", () => {
  const bounds = { x: 1, y: 2, width: 3, height: 4 };

  it("compares every dimension", () => {
    expect(boundsEqual(bounds, { ...bounds })).toBe(true);
    expect(boundsEqual(bounds, { ...bounds, height: 5 })).toBe(false);
    expect(boundsEqual(bounds, null)).toBe(false);
    expect(boundsEqual(null, null)).toBe(true);
  });
});

describe("getRendererZoomFactor", () => {
  afterEach(() => {
    delete (window as any).electron;
  });

  it("defaults to 1 when the Electron bridge is unavailable", () => {
    expect(getRendererZoomFactor()).toBe(1);
  });

  it("reads the factor exposed by the preload bridge", () => {
    (window as any).electron = { webFrame: { getZoomFactor: () => 1.25 } };
    expect(getRendererZoomFactor()).toBe(1.25);
  });

  it("ignores an invalid factor", () => {
    (window as any).electron = { webFrame: { getZoomFactor: () => 0 } };
    expect(getRendererZoomFactor()).toBe(1);
  });
});
