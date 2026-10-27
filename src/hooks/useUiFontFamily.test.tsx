import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resolveUiFontFamily, useUiFontFamily } from "@/hooks/useUiFontFamily";
import { UI_FONT_FAMILY_STACKS } from "@/shared/settings_defaults";

const mocks = vi.hoisted(() => ({
  settings: { current: null as { uiFontFamily?: string } | null },
}));

vi.mock("@/hooks/useSettings", () => ({
  useSettings: () => ({ settings: mocks.settings.current }),
}));

describe("resolveUiFontFamily", () => {
  it("falls back to the default for an unknown or missing value", () => {
    expect(resolveUiFontFamily(undefined)).toBe("geist");
    expect(resolveUiFontFamily(null)).toBe("geist");
    expect(resolveUiFontFamily("comic-sans")).toBe("geist");
  });

  it("keeps a known value", () => {
    expect(resolveUiFontFamily("fraunces")).toBe("fraunces");
    expect(resolveUiFontFamily("geist")).toBe("geist");
  });
});

describe("useUiFontFamily", () => {
  beforeEach(() => {
    mocks.settings.current = null;
    document.documentElement.style.removeProperty("--default-font-family");
  });

  afterEach(() => {
    document.documentElement.style.removeProperty("--default-font-family");
  });

  it("applies the configured font stack to the document root", () => {
    mocks.settings.current = { uiFontFamily: "fraunces" };

    const { result } = renderHook(() => useUiFontFamily());

    expect(result.current).toBe("fraunces");
    expect(
      document.documentElement.style.getPropertyValue("--default-font-family"),
    ).toBe(UI_FONT_FAMILY_STACKS.fraunces);
  });

  it("applies the default when nothing is configured", () => {
    const { result } = renderHook(() => useUiFontFamily());

    expect(result.current).toBe("geist");
    expect(
      document.documentElement.style.getPropertyValue("--default-font-family"),
    ).toBe(UI_FONT_FAMILY_STACKS.geist);
  });

  it("restores the previous value when the font changes", () => {
    mocks.settings.current = { uiFontFamily: "geist" };
    const { rerender } = renderHook(() => useUiFontFamily());

    mocks.settings.current = { uiFontFamily: "fraunces" };
    rerender();

    expect(
      document.documentElement.style.getPropertyValue("--default-font-family"),
    ).toBe(UI_FONT_FAMILY_STACKS.fraunces);
  });
});
