import { describe, expect, it } from "vitest";
import {
  pluginAvailabilityColumns,
  readPluginAvailability,
  resolvePluginConnectionForApp,
  type PluginAvailability,
} from "./mcp_plugin_availability";
import {
  appConfigConnection,
  mcpConnectionKey,
  parseMcpConnectionKey,
  pluginConnection,
} from "@/shared/mcp_connection_ref";

describe("plugin availability columns", () => {
  const cases: PluginAvailability[] = [
    { pluginEnabled: true, defaultScope: "all" },
    { pluginEnabled: false, defaultScope: "all" },
    { pluginEnabled: true, defaultScope: "selected" },
    { pluginEnabled: false, defaultScope: "selected" },
    { pluginEnabled: true, defaultScope: "none" },
    { pluginEnabled: false, defaultScope: "none" },
  ];

  it.each(cases)("round-trips %o with the experiment on", (availability) => {
    expect(
      readPluginAvailability(pluginAvailabilityColumns(availability), true),
    ).toEqual(availability);
  });

  it("only writes the column older builds read for a plugin on for every app", () => {
    expect(
      pluginAvailabilityColumns({ pluginEnabled: true, defaultScope: "all" })
        .enabled,
    ).toBe(true);
    // Older builds would otherwise use a limited plugin in every app.
    for (const defaultScope of ["selected", "none"] as const) {
      expect(
        pluginAvailabilityColumns({ pluginEnabled: true, defaultScope })
          .enabled,
      ).toBe(false);
    }
  });

  it("reads only the legacy switch with the experiment off, like older builds", () => {
    const limited = pluginAvailabilityColumns({
      pluginEnabled: true,
      defaultScope: "none",
    });
    expect(readPluginAvailability(limited, false)).toEqual({
      pluginEnabled: false,
      defaultScope: "all",
    });
  });

  it("treats a plugin an older build turned on as serving every app", () => {
    const limited = pluginAvailabilityColumns({
      pluginEnabled: false,
      defaultScope: "selected",
    });
    expect(readPluginAvailability({ ...limited, enabled: true }, true)).toEqual(
      { pluginEnabled: true, defaultScope: "all" },
    );
  });

  it("falls back to every app for a scope it doesn't know", () => {
    expect(
      readPluginAvailability(
        { enabled: false, defaultScope: "someday", scopedEnabled: true },
        true,
      ),
    ).toEqual({ pluginEnabled: false, defaultScope: "all" });
  });
});

describe("resolvePluginConnectionForApp", () => {
  const base = {
    serverId: 4,
    defaultAppIds: new Set([10]),
    appConfigId: null,
    appId: 10,
  };

  it("uses the app's own configuration whatever the default's scope", () => {
    for (const defaultScope of ["all", "selected", "none"] as const) {
      expect(
        resolvePluginConnectionForApp({
          ...base,
          availability: { pluginEnabled: true, defaultScope },
          appConfigId: 9,
          appId: 11,
        }),
      ).toEqual(appConfigConnection(4, 9));
    }
  });

  it("falls back to the default only where the default serves the app", () => {
    const resolve = (
      defaultScope: PluginAvailability["defaultScope"],
      appId: number,
    ) =>
      resolvePluginConnectionForApp({
        ...base,
        availability: { pluginEnabled: true, defaultScope },
        appId,
      });
    expect(resolve("all", 11)).toEqual(pluginConnection(4));
    expect(resolve("selected", 10)).toEqual(pluginConnection(4));
    expect(resolve("selected", 11)).toBeNull();
    expect(resolve("none", 10)).toBeNull();
  });

  it("serves no app while the plugin is off", () => {
    expect(
      resolvePluginConnectionForApp({
        ...base,
        availability: { pluginEnabled: false, defaultScope: "all" },
        appConfigId: 9,
      }),
    ).toBeNull();
  });
});

describe("connection keys", () => {
  it("round-trips both kinds of configuration", () => {
    for (const ref of [pluginConnection(5), appConfigConnection(5, 3)]) {
      expect(parseMcpConnectionKey(mcpConnectionKey(ref))).toEqual(ref);
    }
  });

  it("gives a plugin and an app-specific configuration with the same row id different keys", () => {
    expect(mcpConnectionKey(pluginConnection(3))).not.toBe(
      mcpConnectionKey(appConfigConnection(5, 3)),
    );
  });

  it("rejects keys that name nothing", () => {
    for (const key of ["", "-3", "1.5", "4:", ":3", "4:3:2"]) {
      expect(() => parseMcpConnectionKey(key)).toThrow();
    }
  });
});
