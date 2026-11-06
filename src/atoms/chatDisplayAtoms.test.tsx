// @vitest-environment happy-dom
import { act, cleanup, renderHook } from "@testing-library/react";
import { createStore, Provider, useAtom } from "jotai";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

async function mountTokenBarPreference() {
  const { showTokenBarAtom } = await import("./chatDisplayAtoms");
  const store = createStore();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Provider store={store}>{children}</Provider>
  );
  return renderHook(() => useAtom(showTokenBarAtom), { wrapper });
}

describe("token usage visibility", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it("starts hidden when the user has no saved preference", async () => {
    const preference = await mountTokenBarPreference();
    expect(preference.result.current[0]).toBe(false);
    expect(localStorage.getItem("show-token-bar")).toBeNull();
  });

  it("restores the saved preference before mounting", async () => {
    localStorage.setItem("show-token-bar", "true");
    const { showTokenBarAtom } = await import("./chatDisplayAtoms");
    expect(createStore().get(showTokenBarAtom)).toBe(true);
  });

  it("keeps both toggle choices after a renderer restart", async () => {
    const first = await mountTokenBarPreference();
    act(() => first.result.current[1]((visible) => !visible));
    expect(first.result.current[0]).toBe(true);
    expect(localStorage.getItem("show-token-bar")).toBe("true");
    first.unmount();

    vi.resetModules();
    const restarted = await mountTokenBarPreference();
    expect(restarted.result.current[0]).toBe(true);
    act(() => restarted.result.current[1]((visible) => !visible));
    expect(localStorage.getItem("show-token-bar")).toBe("false");
    restarted.unmount();

    vi.resetModules();
    const hidden = await mountTokenBarPreference();
    expect(hidden.result.current[0]).toBe(false);
  });
});
