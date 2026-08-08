import { describe, expect, it } from "vitest";
import {
  applySettingsPatch,
  isSettingsTabDirty,
  mergeSettingsPatch,
} from "./settingsDraftMerge";
import type { UserSettings } from "./schemas";

const saved = {
  enableAutoUpdate: true,
  enableContextCompaction: false,
  experiments: { enableSandboxScriptExecution: false },
  selectedModel: { provider: "openai", name: "gpt-4.1" },
} as UserSettings;

describe("mergeSettingsPatch", () => {
  it("merges nested experiments without dropping other experiment keys", () => {
    const merged = mergeSettingsPatch(
      {
        experiments: {
          enableSandboxScriptExecution: false,
          enableCloudSandbox: true,
        },
      },
      { experiments: { enableSandboxScriptExecution: true } },
    );
    expect(merged.experiments).toEqual({
      enableSandboxScriptExecution: true,
      enableCloudSandbox: true,
    });
  });
});

describe("isSettingsTabDirty", () => {
  it("returns false when draft matches saved", () => {
    expect(isSettingsTabDirty(saved, { enableAutoUpdate: true })).toBe(false);
  });

  it("returns true when a field differs", () => {
    expect(isSettingsTabDirty(saved, { enableAutoUpdate: false })).toBe(true);
  });

  it("returns false after reverting a change in the draft", () => {
    const draft = mergeSettingsPatch(
      { enableAutoUpdate: false },
      { enableAutoUpdate: true },
    );
    expect(isSettingsTabDirty(saved, draft)).toBe(false);
  });
});

describe("applySettingsPatch", () => {
  it("applies chat agent model override", () => {
    const result = applySettingsPatch(saved, {
      chatAgentModel: { provider: "openrouter", name: "test/model" },
    });
    expect(result.chatAgentModel).toEqual({
      provider: "openrouter",
      name: "test/model",
    });
    expect(result.enableAutoUpdate).toBe(true);
  });
});
