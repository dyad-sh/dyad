import { afterEach, describe, expect, it, vi } from "vitest";
import type { UserSettings } from "@/lib/schemas";
import {
  buildResearchPluginToolSet,
  createKeylessTravelSearch,
  getOpenMeteoWeather,
  parseDuckDuckGoHtml,
  searchCoinGecko,
  searchDuckDuckGo,
  searchOpenFreeMapPlaces,
} from "./research_plugins";

const settings: UserSettings = {
  selectedModel: { provider: "auto", name: "auto" },
  providerSettings: {},
  selectedTemplateId: "react",
  enableAutoUpdate: true,
  releaseChannel: "stable",
  researchPlugins: {
    travelSearch: { enabled: true },
    duckDuckGo: { enabled: true },
    coinGecko: { enabled: true, plan: "public" },
    weather: {
      enabled: true,
      temperatureUnit: "celsius",
      windSpeedUnit: "kmh",
      forecastDays: 7,
    },
    maps: { enabled: true, style: "dark" },
    skyscanner: { enabled: false },
    amadeus: { enabled: false, environment: "test" },
    duffel: { enabled: false },
  },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("research plugins", () => {
  it("creates a keyless Skyscanner search without claiming fare data", () => {
    expect(
      createKeylessTravelSearch({
        originIata: "BNE",
        destinationIata: "NRT",
        departureDate: "2027-01-15",
        returnDate: "2027-01-28",
        adults: 2,
      }),
    ).toMatchObject({
      provider: "Skyscanner Search",
      origin: "BNE",
      destination: "NRT",
      itineraries: [],
      searchUrl: expect.stringContaining(
        "/transport/flights/bne/nrt/270115/270128/",
      ),
    });
  });

  it("creates several ready-to-open searches for a flexible month", () => {
    const result = createKeylessTravelSearch({
      originIata: "BNE",
      destinationIata: "HKT",
      departureMonth: "2026-09",
      tripLengthNights: 10,
      adults: 2,
      cabinClass: "CABIN_CLASS_ECONOMY",
    });

    expect(result).toMatchObject({
      origin: "BNE",
      destination: "HKT",
      flexibleMonth: "2026-09",
      tripLengthNights: 10,
      adults: 2,
      cabinClass: "CABIN_CLASS_ECONOMY",
      departureDate: "2026-09-03",
      returnDate: "2026-09-13",
    });
    expect(result.searchOptions).toHaveLength(4);
    expect(result.searchOptions?.[1]).toMatchObject({
      departureDate: "2026-09-10",
      returnDate: "2026-09-20",
      searchUrl: expect.stringContaining(
        "/transport/flights/bne/hkt/260910/260920/",
      ),
    });
    expect(result.searchOptions?.[1].searchUrl).toContain("adultsv2=2");
    expect(result.searchOptions?.[1].searchUrl).toContain("cabinclass=economy");
  });

  it("normalizes live DuckDuckGo web results for cards", async () => {
    const html = `
      <div class="result results_links results_links_deep web-result ">
        <h2 class="result__title">
          <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fnews.example.com%2Fstory&amp;rut=abc">Today&#x27;s headline</a>
        </h2>
        <a class="result__url" href="#">news.example.com/story</a>
        <span>&nbsp; &nbsp; 2026-07-29T00:00:00.0000000</span>
        <a class="result__snippet" href="#">A <b>live</b> result &amp; summary.</a>
      </div>`;
    expect(parseDuckDuckGoHtml(html)).toEqual([
      {
        title: "Today's headline",
        url: "https://news.example.com/story",
        snippet: "A live result & summary.",
        source: "news.example.com",
        displayUrl: "news.example.com/story",
        favicon: "https://icons.duckduckgo.com/ip3/news.example.com.ico",
        publishedAt: "2026-07-29",
      },
    ]);
  });

  it("combines standard DuckDuckGo results with Instant Answers", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              Heading: "Brisbane",
              AbstractText: "Brisbane is the capital of Queensland.",
              AbstractURL: "https://example.com/brisbane",
              RelatedTopics: [
                {
                  Text: "Brisbane River - A river through Brisbane.",
                  FirstURL: "https://example.com/river",
                },
              ],
            }),
            { status: 200 },
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            `<div class="result results_links web-result ">
              <a class="result__a" href="https://example.com/news">Brisbane news</a>
              <a class="result__url">example.com/news</a>
              <a class="result__snippet">The latest news from Brisbane.</a>
            </div>`,
            { status: 200 },
          ),
        ),
    );

    await expect(searchDuckDuckGo("Brisbane")).resolves.toMatchObject({
      query: "Brisbane",
      results: [
        {
          title: "Brisbane news",
          url: "https://example.com/news",
        },
        {
          title: "Brisbane",
          url: "https://example.com/brisbane",
        },
        {
          title: "Brisbane River",
          url: "https://example.com/river",
        },
      ],
    });
  });

  it("reuses an identical web search within the same agent turn", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ RelatedTopics: [] }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(
          `<div class="result results_links web-result ">
            <a class="result__a" href="https://example.com/news">Brisbane news</a>
            <a class="result__url">example.com/news</a>
            <a class="result__snippet">The latest news from Brisbane.</a>
          </div>`,
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    const tools = buildResearchPluginToolSet(settings, vi.fn());
    const search = tools.search_web?.execute as
      | ((
          input: { query: string },
          options: Record<string, unknown>,
        ) => Promise<string>)
      | undefined;
    expect(search).toBeTypeOf("function");

    await search?.({ query: "Brisbane news" }, {});
    await search?.({ query: "  BRISBANE NEWS  " }, {});

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("resolves a CoinGecko search into current market rows", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ coins: [{ id: "bitcoin" }] }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              id: "bitcoin",
              name: "Bitcoin",
              symbol: "btc",
              current_price: 100000,
              price_change_percentage_24h: 2.5,
              market_cap: 2000000,
              total_volume: 300000,
            },
          ]),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      searchCoinGecko("bitcoin", "aud", settings),
    ).resolves.toMatchObject({
      currency: "AUD",
      coins: [
        {
          name: "Bitcoin",
          symbol: "BTC",
          price: 100000,
          change24h: 2.5,
        },
      ],
    });
  });

  it("resolves a location into current weather and a daily forecast", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            results: [
              {
                id: 2174003,
                name: "Brisbane",
                latitude: -27.46794,
                longitude: 153.02809,
                timezone: "Australia/Brisbane",
                country: "Australia",
                admin1: "Queensland",
              },
            ],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            timezone: "Australia/Brisbane",
            current: {
              time: "2026-08-08T14:00",
              temperature_2m: 23.4,
              relative_humidity_2m: 61,
              apparent_temperature: 22.8,
              precipitation: 0,
              weather_code: 1,
              wind_speed_10m: 12.5,
              wind_direction_10m: 110,
              wind_gusts_10m: 21,
              is_day: 1,
            },
            current_units: {
              temperature_2m: "°C",
              precipitation: "mm",
              wind_speed_10m: "km/h",
            },
            daily: {
              time: ["2026-08-08", "2026-08-09"],
              weather_code: [1, 61],
              temperature_2m_max: [25, 22],
              temperature_2m_min: [14, 13],
              precipitation_probability_max: [10, 70],
              precipitation_sum: [0, 4.2],
              wind_speed_10m_max: [18, 25],
              sunrise: ["2026-08-08T06:22", "2026-08-09T06:21"],
              sunset: ["2026-08-08T17:24", "2026-08-09T17:25"],
            },
            daily_units: {},
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      getOpenMeteoWeather("Brisbane", settings),
    ).resolves.toMatchObject({
      location: { name: "Brisbane", country: "Australia" },
      current: {
        temperature: 23.4,
        humidity: 61,
        weatherCode: 1,
      },
      daily: [
        { date: "2026-08-08", precipitationProbability: 10 },
        { date: "2026-08-09", precipitationProbability: 70 },
      ],
    });
    expect(String(fetchMock.mock.calls[1][0])).toContain("forecast_days=7");
  });

  it("creates an OpenFreeMap presentation from keyless place search", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            results: [
              {
                id: 2174003,
                name: "Brisbane",
                latitude: -27.46794,
                longitude: 153.02809,
                country: "Australia",
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    );

    await expect(
      searchOpenFreeMapPlaces("Brisbane", settings),
    ).resolves.toMatchObject({
      query: "Brisbane",
      provider: "OpenFreeMap",
      styleUrl: "https://tiles.openfreemap.org/styles/dark",
      places: [{ name: "Brisbane", latitude: -27.46794 }],
    });
  });

  it("falls back to fuzzy Photon lookup for misspelled map places", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ generationtime_ms: 0.2 }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            type: "FeatureCollection",
            features: [
              {
                type: "Feature",
                properties: {
                  osm_id: 11675453,
                  name: "Surfers Paradise",
                  city: "Gold Coast",
                  state: "Queensland",
                  country: "Australia",
                  countrycode: "AU",
                },
                geometry: {
                  type: "Point",
                  coordinates: [153.42398, -27.9989899],
                },
              },
            ],
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      searchOpenFreeMapPlaces("sufers paradise", settings),
    ).resolves.toMatchObject({
      query: "sufers paradise",
      places: [
        {
          name: "Surfers Paradise",
          admin1: "Queensland",
          country: "Australia",
          countryCode: "AU",
          latitude: -27.9989899,
          longitude: 153.42398,
        },
      ],
    });
    expect(String(fetchMock.mock.calls[1][0])).toContain("photon.komoot.io");
  });

  it("uses the fuzzy location fallback before requesting weather", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ generationtime_ms: 0.2 }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            features: [
              {
                properties: {
                  osm_id: 11675453,
                  name: "Surfers Paradise",
                  state: "Queensland",
                  country: "Australia",
                  countrycode: "AU",
                },
                geometry: {
                  coordinates: [153.42398, -27.9989899],
                },
              },
            ],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            timezone: "Australia/Brisbane",
            current: {
              time: "2026-08-08T07:00",
              temperature_2m: 13.3,
              weather_code: 1,
              is_day: 1,
            },
            current_units: {
              temperature_2m: "°C",
              precipitation: "mm",
              wind_speed_10m: "km/h",
            },
            daily: {
              time: ["2026-08-08"],
              weather_code: [1],
              temperature_2m_max: [22],
              temperature_2m_min: [11],
            },
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      getOpenMeteoWeather("Surfers Paradise Queensland", settings),
    ).resolves.toMatchObject({
      location: { name: "Surfers Paradise", admin1: "Queensland" },
      timezone: "Australia/Brisbane",
      current: { temperature: 13.3 },
    });
    expect(String(fetchMock.mock.calls[2][0])).toContain("api.open-meteo.com");
    expect(String(fetchMock.mock.calls[2][0])).toContain(
      "latitude=-27.9989899",
    );
  });

  it("only exposes Skyscanner after it is enabled with a key", () => {
    expect(Object.keys(buildResearchPluginToolSet(settings, vi.fn()))).toEqual([
      "open_flight_search",
      "search_web",
      "search_crypto_markets",
      "get_weather",
      "search_places",
    ]);
    expect(
      Object.keys(
        buildResearchPluginToolSet(
          {
            ...settings,
            researchPlugins: {
              ...settings.researchPlugins,
              skyscanner: {
                enabled: true,
                apiKey: { value: "partner-key" },
              },
            },
          },
          vi.fn(),
        ),
      ),
    ).toContain("search_flights");
  });

  it("removes disabled plugins from Chat Agent completely", () => {
    expect(
      Object.keys(
        buildResearchPluginToolSet(
          {
            ...settings,
            researchPlugins: {
              travelSearch: { enabled: false },
              duckDuckGo: { enabled: false },
              coinGecko: { enabled: false, plan: "public" },
              weather: { enabled: false },
              maps: { enabled: false },
              skyscanner: {
                enabled: false,
                apiKey: { value: "partner-key" },
              },
              amadeus: { enabled: false },
              duffel: { enabled: false },
            },
          },
          vi.fn(),
        ),
      ),
    ).toEqual([]);
  });
});
