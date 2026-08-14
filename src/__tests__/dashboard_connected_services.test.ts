import { describe, expect, it } from "vitest";

import { buildConnectedServices } from "@/lib/dashboard/connected_services";
import type { UserSettings } from "@/lib/schemas";

/**
 * The panel answers "what is connected". A service that appears without a
 * connection behind it is the one failure that matters here, so that is what
 * these check.
 */

const EMPTY = {
  providers: [],
  mcpServerCount: 0,
  dataSourceCount: 0,
};

function settings(overrides: Partial<UserSettings>): UserSettings {
  return overrides as UserSettings;
}

describe("connected services", () => {
  it("lists nothing when nothing is configured", () => {
    expect(
      buildConnectedServices({ settings: settings({}), ...EMPTY }),
    ).toEqual([]);
  });

  it("lists nothing when settings have not loaded", () => {
    // Null settings mean "not known yet", which must not become "connected".
    expect(buildConnectedServices({ settings: null, ...EMPTY })).toEqual([]);
  });

  it("lists GitHub only once a token is stored", () => {
    const withToken = buildConnectedServices({
      settings: settings({
        githubAccessToken: { value: "x" },
      } as Partial<UserSettings>),
      ...EMPTY,
    });
    expect(withToken.map((service) => service.id)).toContain("github");
  });

  it("lists a configured AI provider under its own name", () => {
    const services = buildConnectedServices({
      settings: settings({}),
      ...EMPTY,
      providers: [{ id: "openai", name: "OpenAI" }],
    });
    expect(services).toHaveLength(1);
    expect(services[0].name).toBe("OpenAI");
    expect(services[0].to).toContain("openai");
  });

  it("does not list MCP or data sources when there are none", () => {
    const services = buildConnectedServices({
      settings: settings({}),
      providers: [],
      mcpServerCount: 0,
      dataSourceCount: 0,
    });
    expect(services).toEqual([]);
  });

  it("does not list counts that are still unknown", () => {
    const services = buildConnectedServices({
      settings: settings({}),
      providers: [],
      mcpServerCount: null,
      dataSourceCount: null,
    });
    expect(services).toEqual([]);
  });

  it("gives every service somewhere to go", () => {
    const services = buildConnectedServices({
      settings: settings({
        githubAccessToken: { value: "x" },
        vercelAccessToken: { value: "y" },
      } as Partial<UserSettings>),
      providers: [{ id: "anthropic", name: "Anthropic" }],
      mcpServerCount: 2,
      dataSourceCount: 1,
    });
    expect(services.length).toBeGreaterThan(0);
    for (const service of services) {
      expect(service.to.startsWith("/"), `${service.id} has no screen`).toBe(
        true,
      );
    }
  });
});
