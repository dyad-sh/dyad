import { describe, expect, it } from "vitest";

import {
  buildHealthRows,
  summariseHealth,
  type HealthInput,
} from "@/lib/dashboard/system_health";

/**
 * The dashboard's job is to be believed at a glance, so the thing worth testing
 * is that it never claims to know something it does not: nothing loaded must
 * not read as healthy, and nothing configured must not read as connected.
 */

const NOTHING_LOADED: HealthInput = {
  infrastructure: null,
  providers: null,
  dataSources: null,
  storage: null,
  vector: null,
};

const ALL_WELL: HealthInput = {
  infrastructure: { healthy: 3, degraded: 0, offline: 0, total: 3 },
  providers: { configured: 2 },
  dataSources: { total: 1, connected: 1, errored: 0 },
  storage: { localVaultReady: true, cloudConnected: false },
  vector: { state: "ready", message: "Ready" },
};

function rowFor(input: HealthInput, id: string) {
  const row = buildHealthRows(input).find((candidate) => candidate.id === id);
  expect(row, `no ${id} row`).toBeDefined();
  return row!;
}

describe("system health rows", () => {
  it("reports nothing as healthy before anything has loaded", () => {
    for (const row of buildHealthRows(NOTHING_LOADED)) {
      expect(row.tone, `${row.id} claimed a state too early`).toBe("unknown");
    }
  });

  it("links every row to a screen that owns it", () => {
    for (const row of buildHealthRows(ALL_WELL)) {
      expect(row.to.startsWith("/"), `${row.id} has no destination`).toBe(true);
    }
  });

  it("calls an unscanned inventory unknown, not healthy", () => {
    // No devices found is not the same as everything being well.
    const row = rowFor(
      {
        ...ALL_WELL,
        infrastructure: { healthy: 0, degraded: 0, offline: 0, total: 0 },
      },
      "infrastructure",
    );
    expect(row.tone).toBe("unknown");
  });

  it("surfaces offline infrastructure over degraded", () => {
    const row = rowFor(
      {
        ...ALL_WELL,
        infrastructure: { healthy: 1, degraded: 1, offline: 2, total: 4 },
      },
      "infrastructure",
    );
    expect(row.tone).toBe("offline");
    expect(row.status).toContain("2");
  });

  it("treats no configured provider as needing attention", () => {
    const row = rowFor(
      { ...ALL_WELL, providers: { configured: 0 } },
      "providers",
    );
    expect(row.tone).toBe("attention");
  });

  it("reports a data source error rather than the connected count", () => {
    const row = rowFor(
      { ...ALL_WELL, dataSources: { total: 2, connected: 1, errored: 1 } },
      "data-sources",
    );
    expect(row.tone).toBe("attention");
  });

  it("describes an unrecognised vector state in its own words", () => {
    // Better an honest message from the service than a word invented here.
    const row = rowFor(
      {
        ...ALL_WELL,
        vector: { state: "quiescent", message: "Paused by user" },
      },
      "vector",
    );
    expect(row.status).toBe("Paused by user");
  });
});

describe("the overall summary", () => {
  it("says all systems nominal only when everything reported well", () => {
    const summary = summariseHealth(buildHealthRows(ALL_WELL));
    expect(summary.tone).toBe("healthy");
    expect(summary.message).toBe("All systems nominal");
  });

  it("never says nominal while anything is still loading", () => {
    const summary = summariseHealth(buildHealthRows(NOTHING_LOADED));
    expect(summary.tone).toBe("unknown");
    expect(summary.message).not.toContain("nominal");
  });

  it("names the one thing that needs attention", () => {
    const summary = summariseHealth(
      buildHealthRows({ ...ALL_WELL, providers: { configured: 0 } }),
    );
    expect(summary.message).toBe("AI Providers needs attention");
  });

  it("counts them when there is more than one", () => {
    const summary = summariseHealth(
      buildHealthRows({
        ...ALL_WELL,
        providers: { configured: 0 },
        storage: { localVaultReady: false, cloudConnected: false },
      }),
    );
    expect(summary.message).toBe("2 services need attention");
    expect(summary.tone).toBe("attention");
  });

  it("is offline when anything is offline, even alongside milder problems", () => {
    const summary = summariseHealth(
      buildHealthRows({
        ...ALL_WELL,
        providers: { configured: 0 },
        vector: { state: "error", message: "crashed" },
      }),
    );
    expect(summary.tone).toBe("offline");
  });
});
