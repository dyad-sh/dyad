import { describe, expect, it } from "vitest";
import { isProviderVisibleInSettings } from "./settings_provider_visibility";

describe("settings provider visibility", () => {
  it("hides internal Meta Human OS and Phantom providers", () => {
    expect(isProviderVisibleInSettings("auto")).toBe(false);
    expect(isProviderVisibleInSettings("phantom")).toBe(false);
  });

  it("keeps user-configurable cloud and local providers visible", () => {
    expect(isProviderVisibleInSettings("openrouter")).toBe(true);
    expect(isProviderVisibleInSettings("ollama")).toBe(true);
    expect(isProviderVisibleInSettings("lmstudio")).toBe(true);
  });
});
