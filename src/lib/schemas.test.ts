import { describe, it, expect } from "vitest";
import { migrateStoredSettings, StoredUserSettingsSchema } from "@/lib/schemas";

const baseSettings = {
  selectedModel: { name: "auto", provider: "auto" },
  providerSettings: {},
  selectedTemplateId: "react",
  enableAutoUpdate: true,
  releaseChannel: "stable",
};

// Pins that the lastKnownPerformance shape written by the performance
// monitor survives the validation parse in writeSettings, and that old
// records without the newer optional fields still parse.
describe("StoredUserSettingsSchema lastKnownPerformance", () => {
  it("preserves memory, activity, and peak fields through a parse", () => {
    const lastKnownPerformance = {
      timestamp: 1751500000000,
      memoryUsageMB: 400,
      cpuUsagePercent: 12.5,
      systemMemoryUsageMB: 8000,
      systemMemoryTotalMB: 16000,
      systemCpuPercent: 33,
      heapUsedMB: 512,
      heapLimitMB: 4144,
      processWorkingSetsMB: { browser: 400, tab: 900, utility: 300 },
      activity: {
        activeStreams: 1,
        runningApps: 2,
        extractCodebase: true,
        tsUtilityProcess: null,
      },
      peakHeapUsedMB: 1024,
      peakHeapPct: 24.7,
      peakRssMB: 2048,
      peakProcessWorkingSetsMB: { browser: 900, tab: 2000, utility: 800 },
      peakActivity: {
        activeStreams: 2,
        runningApps: 3,
        extractCodebase: false,
        tsUtilityProcess: "tsc",
      },
      peakTimestamp: 1751499970000,
    };

    const parsed = StoredUserSettingsSchema.parse({
      ...baseSettings,
      lastKnownPerformance,
    });

    expect(parsed.lastKnownPerformance).toEqual(lastKnownPerformance);
  });

  it("still accepts records without the new optional fields", () => {
    const parsed = StoredUserSettingsSchema.parse({
      ...baseSettings,
      lastKnownPerformance: {
        timestamp: 1751500000000,
        memoryUsageMB: 400,
      },
    });

    expect(parsed.lastKnownPerformance).toEqual({
      timestamp: 1751500000000,
      memoryUsageMB: 400,
    });
  });
});

describe("migrateStoredSettings", () => {
  it("accepts and removes the deprecated native Git setting", () => {
    const stored = StoredUserSettingsSchema.parse({
      ...baseSettings,
      enableNativeGit: false,
    });

    expect(migrateStoredSettings(stored)).not.toHaveProperty("enableNativeGit");
  });
});
