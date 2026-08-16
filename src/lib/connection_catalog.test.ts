import { describe, expect, it } from "vitest";

import { INTEGRATIONS, PLUGIN_CATEGORIES } from "./connection_catalog";

describe("connection catalog taxonomy", () => {
  it("groups every plugin under the requested product category", () => {
    expect(
      PLUGIN_CATEGORIES.map(({ title, plugins }) => ({
        title,
        plugins: plugins.map((plugin) => plugin.title),
      })),
    ).toEqual([
      {
        title: "Developer & Project Tools",
        plugins: ["GitHub", "Vercel", "Lovable"],
      },
      {
        title: "Search & Live Data",
        plugins: ["DuckDuckGo", "CoinGecko", "Open-Meteo", "Maps"],
      },
      {
        title: "Travel & Flights",
        plugins: [
          "Travel Search",
          "Amadeus Flight Offers",
          "Skyscanner",
          "Duffel Sandbox",
        ],
      },
    ]);
  });

  it("keeps owned accounts, data and publishers in Integrations", () => {
    expect(INTEGRATIONS.map((integration) => integration.title)).toEqual([
      "Supabase",
      "Facebook",
      "X",
    ]);
  });

  it("never classifies one connection as both a plugin and integration", () => {
    const pluginIds = new Set<string>(
      PLUGIN_CATEGORIES.flatMap((category) =>
        category.plugins.map((plugin) => plugin.id),
      ),
    );
    const overlap = INTEGRATIONS.filter((integration) =>
      pluginIds.has(integration.id),
    );
    expect(overlap).toEqual([]);
  });
});
