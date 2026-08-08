import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatAgentResearchResultCard } from "./ChatAgentResearchResultCard";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ChatAgentResearchResultCard", () => {
  it("renders live weather as a native forecast card", () => {
    render(
      <ChatAgentResearchResultCard
        presentation={{
          kind: "weather-forecast",
          location: {
            id: "brisbane",
            name: "Brisbane",
            admin1: "Queensland",
            country: "Australia",
            latitude: -27.47,
            longitude: 153.03,
          },
          timezone: "Australia/Brisbane",
          current: {
            time: "2026-08-08T14:00",
            temperature: 23.4,
            apparentTemperature: 22.8,
            humidity: 61,
            precipitation: 0,
            weatherCode: 1,
            windSpeed: 12.5,
            windGusts: 21,
            isDay: true,
          },
          units: {
            temperature: "°C",
            precipitation: "mm",
            windSpeed: "km/h",
          },
          daily: [
            {
              date: "2026-08-08",
              weatherCode: 1,
              temperatureMax: 25,
              temperatureMin: 14,
              precipitationProbability: 10,
            },
          ],
          source: "Open-Meteo",
        }}
      />,
    );

    expect(screen.getByText("Brisbane, Queensland, Australia")).toBeTruthy();
    expect(screen.getByText("Partly cloudy", { exact: false })).toBeTruthy();
    expect(screen.getByText("Today")).toBeTruthy();
    expect(
      screen
        .getByText("Brisbane, Queensland, Australia")
        .closest("section")
        ?.classList.contains("chat-card-fly-in"),
    ).toBe(true);
  });

  it("renders mapped places with an interactive-map result surface", () => {
    render(
      <ChatAgentResearchResultCard
        presentation={{
          kind: "map-places",
          query: "Brisbane",
          style: "dark",
          styleUrl: "https://tiles.openfreemap.org/styles/dark",
          provider: "OpenFreeMap",
          places: [
            {
              id: "brisbane",
              name: "Brisbane",
              admin1: "Queensland",
              country: "Australia",
              latitude: -27.47,
              longitude: 153.03,
            },
          ],
        }}
      />,
    );

    expect(screen.getByText("Map results")).toBeTruthy();
    expect(screen.getByText("1 locations · Brisbane")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /Brisbane/ })).toHaveLength(2);
    expect(screen.getByTestId("chat-agent-interactive-map")).toBeTruthy();
  });

  it("renders actual raster map imagery without relying on WebGL", async () => {
    render(
      <ChatAgentResearchResultCard
        presentation={{
          kind: "map-places",
          query: "Surfers Paradise",
          style: "dark",
          styleUrl: "https://tiles.openfreemap.org/styles/dark",
          provider: "OpenFreeMap",
          places: [
            {
              id: "surfers-paradise",
              name: "Surfers Paradise",
              admin1: "Queensland",
              country: "Australia",
              latitude: -27.9989899,
              longitude: 153.42398,
            },
          ],
        }}
      />,
    );

    await waitFor(() => {
      const tiles = screen.getAllByTestId("chat-agent-map-tile");
      expect(tiles.length).toBeGreaterThan(0);
      expect(tiles[0].getAttribute("src")).toMatch(
        /^https:\/\/basemaps\.cartocdn\.com\/dark_all\/13\/\d+\/\d+@2x\.png$/,
      );
    });
  });

  it("renders flexible flight dates as selectable fare windows", () => {
    render(
      <ChatAgentResearchResultCard
        presentation={{
          kind: "flight-search",
          provider: "Skyscanner Search",
          origin: "BNE",
          destination: "HKT",
          departureDate: "2026-09-03",
          returnDate: "2026-09-13",
          flexibleMonth: "2026-09",
          tripLengthNights: 10,
          adults: 2,
          cabinClass: "CABIN_CLASS_ECONOMY",
          currency: "AUD",
          searchUrl: "https://www.skyscanner.com.au/first",
          searchOptions: [
            {
              departureDate: "2026-09-03",
              returnDate: "2026-09-13",
              searchUrl: "https://www.skyscanner.com.au/first",
            },
            {
              departureDate: "2026-09-10",
              returnDate: "2026-09-20",
              searchUrl: "https://www.skyscanner.com.au/second",
            },
          ],
          notice: "Compare flexible dates on Skyscanner",
          itineraries: [],
        }}
      />,
    );

    expect(screen.getByText("BNE → HKT")).toBeTruthy();
    expect(
      screen.getByText("Flexible September 2026 · 10 nights"),
    ).toBeTruthy();
    expect(screen.getByText("2 adults")).toBeTruthy();
    expect(screen.getByText("Economy")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /Check fares/ })).toHaveLength(
      2,
    );
    expect(screen.queryByRole("button", { name: /Open search/ })).toBeNull();
  });
});
