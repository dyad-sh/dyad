import type { ToolExecutionOptions, ToolSet } from "ai";
import { z } from "zod";
import type { UserSettings } from "@/lib/schemas";
import type { ChatAgentToolPresentation } from "../types/chat_agent";

const DUCKDUCKGO_API_URL = "https://api.duckduckgo.com/";
const DUCKDUCKGO_HTML_URL = "https://html.duckduckgo.com/html/";
const DUCKDUCKGO_TIMEOUT_MS = 7_000;
const COINGECKO_PUBLIC_URL = "https://api.coingecko.com/api/v3";
const COINGECKO_PRO_URL = "https://pro-api.coingecko.com/api/v3";
const OPEN_METEO_GEOCODING_URL =
  "https://geocoding-api.open-meteo.com/v1/search";
const OPEN_METEO_FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const PHOTON_GEOCODING_URL = "https://photon.komoot.io/api/";
const OPEN_FREE_MAP_STYLE_URL = "https://tiles.openfreemap.org/styles";
const SKYSCANNER_API_URL = "https://partners.api.skyscanner.net/apiservices/v3";
const AMADEUS_TEST_API_URL = "https://test.api.amadeus.com";
const AMADEUS_PRODUCTION_API_URL = "https://api.amadeus.com";
const DUFFEL_API_URL = "https://api.duffel.com";

type ToolResultCallback = (result: {
  serverName: string;
  toolName: string;
  result: string;
  status: "completed" | "error";
  presentation?: ChatAgentToolPresentation;
}) => void;

async function fetchJson(
  url: string,
  init?: RequestInit,
  timeoutMs = 20_000,
): Promise<Record<string, unknown>> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...init,
        headers: {
          Accept: "application/json",
          "Accept-Language": "en-AU,en;q=0.9",
          "User-Agent": "MetaHumanOS/1.0 (+https://github.com/dyad-sh/dyad)",
          ...init?.headers,
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
      const rawBody = await response.text();
      let body: Record<string, unknown> = {};
      if (rawBody) {
        try {
          body = JSON.parse(rawBody) as Record<string, unknown>;
        } catch {
          throw new Error(
            `${response.status} ${response.statusText}: the service returned an invalid response`,
          );
        }
      }
      if (!response.ok) {
        const detail =
          typeof body.message === "string"
            ? body.message
            : typeof body.error === "string"
              ? body.error
              : response.statusText;
        const error = new Error(`${response.status} ${detail}`.trim());
        if (response.status !== 429 && response.status < 500) throw error;
        lastError = error;
      } else {
        return body;
      }
    } catch (error) {
      lastError = error;
    }

    if (attempt === 0) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("The service could not be reached.");
}

async function fetchText(url: string, timeoutMs = 20_000): Promise<string> {
  const response = await fetch(url, {
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en-AU,en;q=0.9",
      "User-Agent":
        "Mozilla/5.0 (compatible; MetaHumanOS/1.0; +https://github.com/dyad-sh/dyad)",
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`.trim());
  }
  return response.text();
}

function decodeHtml(value: string) {
  const namedEntities: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };
  return value
    .replace(/&#(\d+);/g, (_match, code: string) =>
      String.fromCodePoint(Number(code)),
    )
    .replace(/&#x([\da-f]+);/gi, (_match, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replace(/&([a-z]+);/gi, (match, name: string) => {
      return namedEntities[name.toLowerCase()] ?? match;
    });
}

function htmlToText(value: string) {
  return decodeHtml(value.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function unwrapDuckDuckGoUrl(value: string) {
  const decoded = decodeHtml(value);
  const absolute = decoded.startsWith("//") ? `https:${decoded}` : decoded;
  try {
    const parsed = new URL(absolute);
    const destination = parsed.searchParams.get("uddg");
    return destination ?? parsed.toString();
  } catch {
    return "";
  }
}

export type DuckDuckGoWebResult = {
  title: string;
  url: string;
  snippet: string;
  source?: string;
  displayUrl?: string;
  favicon?: string;
  publishedAt?: string;
};

export function parseDuckDuckGoHtml(html: string): DuckDuckGoWebResult[] {
  const starts = [...html.matchAll(/<div class="result results_links\b/g)].map(
    (match) => match.index,
  );
  return starts.flatMap((start, index) => {
    const block = html.slice(start, starts[index + 1] ?? html.length);
    const titleMatch =
      /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(
        block,
      );
    const snippetMatch =
      /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/i.exec(block);
    if (!titleMatch || !snippetMatch) return [];

    const url = unwrapDuckDuckGoUrl(titleMatch[1]);
    if (!/^https?:\/\//i.test(url)) return [];

    const parsedUrl = new URL(url);
    const displayUrl = /<a[^>]*class="result__url"[^>]*>([\s\S]*?)<\/a>/i.exec(
      block,
    );
    const publishedAt = /(\d{4}-\d{2}-\d{2})T[\d:.+-]+/.exec(block)?.[1];
    const source = parsedUrl.hostname.replace(/^www\./, "");
    return [
      {
        title: htmlToText(titleMatch[2]),
        url,
        snippet: htmlToText(snippetMatch[1]),
        source,
        displayUrl: displayUrl
          ? htmlToText(displayUrl[1])
          : `${source}${parsedUrl.pathname === "/" ? "" : parsedUrl.pathname}`,
        favicon: `https://icons.duckduckgo.com/ip3/${parsedUrl.hostname}.ico`,
        publishedAt,
      },
    ];
  });
}

function flattenDuckDuckGoTopics(topics: unknown): DuckDuckGoWebResult[] {
  if (!Array.isArray(topics)) return [];
  return topics.flatMap((topic) => {
    if (!topic || typeof topic !== "object") return [];
    const record = topic as Record<string, unknown>;
    if (Array.isArray(record.Topics)) {
      return flattenDuckDuckGoTopics(record.Topics);
    }
    if (
      typeof record.Text !== "string" ||
      typeof record.FirstURL !== "string"
    ) {
      return [];
    }
    const separator = record.Text.indexOf(" - ");
    return [
      {
        title: separator > 0 ? record.Text.slice(0, separator) : record.Text,
        snippet: separator > 0 ? record.Text.slice(separator + 3) : record.Text,
        url: record.FirstURL,
      },
    ];
  });
}

export async function searchDuckDuckGo(query: string) {
  const instantAnswerUrl = new URL(DUCKDUCKGO_API_URL);
  instantAnswerUrl.searchParams.set("q", query);
  instantAnswerUrl.searchParams.set("format", "json");
  instantAnswerUrl.searchParams.set("no_html", "1");
  instantAnswerUrl.searchParams.set("no_redirect", "1");
  instantAnswerUrl.searchParams.set("skip_disambig", "0");
  const htmlUrl = new URL(DUCKDUCKGO_HTML_URL);
  htmlUrl.searchParams.set("q", query);
  const [instantAnswerResponse, htmlResponse] = await Promise.allSettled([
    fetchJson(instantAnswerUrl.toString(), undefined, DUCKDUCKGO_TIMEOUT_MS),
    fetchText(htmlUrl.toString(), DUCKDUCKGO_TIMEOUT_MS),
  ]);
  if (
    instantAnswerResponse.status === "rejected" &&
    htmlResponse.status === "rejected"
  ) {
    throw new Error(`DuckDuckGo search failed: ${String(htmlResponse.reason)}`);
  }
  const body =
    instantAnswerResponse.status === "fulfilled"
      ? instantAnswerResponse.value
      : {};
  const abstract =
    typeof body.AbstractText === "string" ? body.AbstractText : undefined;
  const abstractUrl =
    typeof body.AbstractURL === "string" ? body.AbstractURL : undefined;
  const abstractTitle =
    typeof body.Heading === "string" && body.Heading
      ? body.Heading
      : "Instant Answer";
  const related = [
    ...flattenDuckDuckGoTopics(body.Results),
    ...flattenDuckDuckGoTopics(body.RelatedTopics),
  ];
  const standardResults =
    htmlResponse.status === "fulfilled"
      ? parseDuckDuckGoHtml(htmlResponse.value)
      : [];
  const combinedResults = [
    ...standardResults,
    ...(abstract && abstractUrl
      ? [
          {
            title: abstractTitle,
            url: abstractUrl,
            snippet: abstract,
          },
        ]
      : []),
    ...related,
  ];
  const seenUrls = new Set<string>();
  const results = combinedResults
    .filter((result) => {
      if (seenUrls.has(result.url)) return false;
      seenUrls.add(result.url);
      return true;
    })
    .slice(0, 8);

  return {
    query,
    abstract,
    results,
    searchUrl: `https://duckduckgo.com/?q=${encodeURIComponent(query)}`,
  };
}

function coinGeckoRequestOptions(settings: UserSettings) {
  const config = settings.researchPlugins?.coinGecko;
  const plan = config?.plan ?? "public";
  const apiKey = config?.apiKey?.value?.trim();
  const headers: Record<string, string> = {};
  if (apiKey && plan === "demo") headers["x-cg-demo-api-key"] = apiKey;
  if (apiKey && plan === "pro") headers["x-cg-pro-api-key"] = apiKey;
  return {
    baseUrl: plan === "pro" ? COINGECKO_PRO_URL : COINGECKO_PUBLIC_URL,
    headers,
  };
}

export async function searchCoinGecko(
  query: string,
  currency: string,
  settings: UserSettings,
) {
  const { baseUrl, headers } = coinGeckoRequestOptions(settings);
  const search = await fetchJson(
    `${baseUrl}/search?query=${encodeURIComponent(query)}`,
    { headers },
  );
  const candidates = Array.isArray(search.coins) ? search.coins : [];
  const ids = candidates
    .slice(0, 5)
    .map((coin) =>
      coin && typeof coin === "object"
        ? String((coin as Record<string, unknown>).id ?? "")
        : "",
    )
    .filter(Boolean);
  if (ids.length === 0) {
    return { query, currency: currency.toUpperCase(), coins: [] };
  }
  const markets = await fetchJson(
    `${baseUrl}/coins/markets?vs_currency=${encodeURIComponent(currency.toLowerCase())}&ids=${encodeURIComponent(ids.join(","))}&price_change_percentage=24h`,
    { headers },
  );
  const rows = Array.isArray(markets) ? markets : [];
  const coins = rows.slice(0, 5).flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const item = row as Record<string, unknown>;
    return [
      {
        id: String(item.id ?? ""),
        name: String(item.name ?? item.id ?? "Unknown"),
        symbol: String(item.symbol ?? "").toUpperCase(),
        image: typeof item.image === "string" ? item.image : undefined,
        price:
          typeof item.current_price === "number"
            ? item.current_price
            : Number(item.current_price ?? 0),
        change24h:
          typeof item.price_change_percentage_24h === "number"
            ? item.price_change_percentage_24h
            : undefined,
        marketCap:
          typeof item.market_cap === "number" ? item.market_cap : undefined,
        volume24h:
          typeof item.total_volume === "number" ? item.total_volume : undefined,
      },
    ];
  });
  return { query, currency: currency.toUpperCase(), coins };
}

export type OpenMeteoPlace = {
  id: string;
  name: string;
  admin1?: string;
  country?: string;
  countryCode?: string;
  latitude: number;
  longitude: number;
  elevation?: number;
  timezone?: string;
  population?: number;
};

function optionalNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function parseOpenMeteoPlaces(value: unknown): OpenMeteoPlace[] {
  const results = Array.isArray(value) ? value : [];
  return results.flatMap((value) => {
    const item = asRecord(value);
    const latitude = optionalNumber(item.latitude);
    const longitude = optionalNumber(item.longitude);
    const name = optionalString(item.name);
    if (latitude == null || longitude == null || !name) return [];
    return [
      {
        id: String(item.id ?? `${latitude},${longitude}`),
        name,
        admin1: optionalString(item.admin1),
        country: optionalString(item.country),
        countryCode: optionalString(item.country_code),
        latitude,
        longitude,
        elevation: optionalNumber(item.elevation),
        timezone: optionalString(item.timezone),
        population: optionalNumber(item.population),
      },
    ];
  });
}

async function searchPhotonPlaces(query: string, count: number) {
  const url = new URL(PHOTON_GEOCODING_URL);
  url.searchParams.set("q", query.trim());
  url.searchParams.set("limit", String(Math.min(Math.max(count, 1), 8)));
  url.searchParams.set("lang", "en");
  const body = await fetchJson(url.toString(), undefined, 10_000);
  const features = Array.isArray(body.features) ? body.features : [];
  return features.flatMap((value): OpenMeteoPlace[] => {
    const feature = asRecord(value);
    const properties = asRecord(feature.properties);
    const geometry = asRecord(feature.geometry);
    const coordinates = Array.isArray(geometry.coordinates)
      ? geometry.coordinates
      : [];
    const longitude = optionalNumber(coordinates[0]);
    const latitude = optionalNumber(coordinates[1]);
    const name = optionalString(properties.name);
    if (latitude == null || longitude == null || !name) return [];
    const countryCode = optionalString(properties.countrycode);
    return [
      {
        id: String(
          properties.osm_id ??
            properties.osm_value ??
            `${latitude},${longitude}`,
        ),
        name,
        admin1:
          optionalString(properties.state) ??
          optionalString(properties.county) ??
          optionalString(properties.city),
        country: optionalString(properties.country),
        countryCode: countryCode?.toUpperCase(),
        latitude,
        longitude,
      },
    ];
  });
}

export async function searchOpenMeteoPlaces(query: string, count = 5) {
  const cleanedQuery = query.trim().replace(/\s+/g, " ");
  const url = new URL(OPEN_METEO_GEOCODING_URL);
  url.searchParams.set("name", cleanedQuery);
  url.searchParams.set("count", String(Math.min(Math.max(count, 1), 8)));
  url.searchParams.set("language", "en");
  url.searchParams.set("format", "json");
  let primaryError: unknown;
  try {
    const body = await fetchJson(url.toString(), undefined, 10_000);
    const places = parseOpenMeteoPlaces(body.results);
    if (places.length > 0) return { query: cleanedQuery, places };
  } catch (error) {
    primaryError = error;
  }

  try {
    const places = await searchPhotonPlaces(cleanedQuery, count);
    return { query: cleanedQuery, places };
  } catch (fallbackError) {
    const primaryDetail =
      primaryError instanceof Error ? ` ${primaryError.message}` : "";
    const fallbackDetail =
      fallbackError instanceof Error ? ` ${fallbackError.message}` : "";
    throw new Error(
      `Location lookup failed.${primaryDetail}${fallbackDetail}`.trim(),
    );
  }
}

function weatherArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export async function getOpenMeteoWeather(
  location: string,
  settings: UserSettings,
) {
  const { places } = await searchOpenMeteoPlaces(location, 1);
  const place = places[0];
  if (!place) throw new Error(`No weather location found for “${location}”.`);

  const config = settings.researchPlugins?.weather;
  const temperatureUnit = config?.temperatureUnit ?? "celsius";
  const windSpeedUnit = config?.windSpeedUnit ?? "kmh";
  const forecastDays = Math.min(Math.max(config?.forecastDays ?? 7, 1), 10);
  const url = new URL(OPEN_METEO_FORECAST_URL);
  url.searchParams.set("latitude", String(place.latitude));
  url.searchParams.set("longitude", String(place.longitude));
  url.searchParams.set("timezone", "auto");
  url.searchParams.set("forecast_days", String(forecastDays));
  url.searchParams.set("temperature_unit", temperatureUnit);
  url.searchParams.set("wind_speed_unit", windSpeedUnit);
  url.searchParams.set(
    "current",
    [
      "temperature_2m",
      "relative_humidity_2m",
      "apparent_temperature",
      "precipitation",
      "weather_code",
      "wind_speed_10m",
      "wind_direction_10m",
      "wind_gusts_10m",
      "is_day",
    ].join(","),
  );
  url.searchParams.set(
    "daily",
    [
      "weather_code",
      "temperature_2m_max",
      "temperature_2m_min",
      "precipitation_probability_max",
      "precipitation_sum",
      "wind_speed_10m_max",
      "sunrise",
      "sunset",
    ].join(","),
  );
  const body = await fetchJson(url.toString(), undefined, 12_000);
  const current = asRecord(body.current);
  const currentUnits = asRecord(body.current_units);
  const daily = asRecord(body.daily);
  const dates = weatherArray<string>(daily.time);
  const weatherCodes = weatherArray<number>(daily.weather_code);
  const maximums = weatherArray<number>(daily.temperature_2m_max);
  const minimums = weatherArray<number>(daily.temperature_2m_min);
  const rainChances = weatherArray<number>(daily.precipitation_probability_max);
  const rainTotals = weatherArray<number>(daily.precipitation_sum);
  const winds = weatherArray<number>(daily.wind_speed_10m_max);
  const sunrises = weatherArray<string>(daily.sunrise);
  const sunsets = weatherArray<string>(daily.sunset);

  return {
    location: place,
    timezone: optionalString(body.timezone) ?? place.timezone,
    current: {
      time: String(current.time ?? ""),
      temperature: Number(current.temperature_2m ?? 0),
      apparentTemperature: optionalNumber(current.apparent_temperature),
      humidity: optionalNumber(current.relative_humidity_2m),
      precipitation: optionalNumber(current.precipitation),
      weatherCode: Number(current.weather_code ?? 0),
      windSpeed: optionalNumber(current.wind_speed_10m),
      windDirection: optionalNumber(current.wind_direction_10m),
      windGusts: optionalNumber(current.wind_gusts_10m),
      isDay: Number(current.is_day ?? 1) === 1,
    },
    units: {
      temperature: String(currentUnits.temperature_2m ?? "°C"),
      precipitation: String(currentUnits.precipitation ?? "mm"),
      windSpeed: String(currentUnits.wind_speed_10m ?? "km/h"),
    },
    daily: dates.map((date, index) => ({
      date,
      weatherCode: Number(weatherCodes[index] ?? 0),
      temperatureMax: Number(maximums[index] ?? 0),
      temperatureMin: Number(minimums[index] ?? 0),
      precipitationProbability: optionalNumber(rainChances[index]),
      precipitationSum: optionalNumber(rainTotals[index]),
      windSpeedMax: optionalNumber(winds[index]),
      sunrise: optionalString(sunrises[index]),
      sunset: optionalString(sunsets[index]),
    })),
    source: "Open-Meteo",
  };
}

export async function searchOpenFreeMapPlaces(
  query: string,
  settings: UserSettings,
) {
  const data = await searchOpenMeteoPlaces(query, 6);
  if (data.places.length === 0) {
    throw new Error(`No map location found for “${query}”.`);
  }
  const style = settings.researchPlugins?.maps?.style ?? "dark";
  return {
    ...data,
    style,
    styleUrl: `${OPEN_FREE_MAP_STYLE_URL}/${style}`,
    provider: "OpenFreeMap",
  };
}

function parseIsoDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error(`Invalid date: ${value}. Use YYYY-MM-DD.`);
  const parsed = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
  const date = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day));
  if (
    date.getUTCFullYear() !== parsed.year ||
    date.getUTCMonth() !== parsed.month - 1 ||
    date.getUTCDate() !== parsed.day
  ) {
    throw new Error(`Invalid date: ${value}. Use a real calendar date.`);
  }
  return parsed;
}

function compactFlightDate(value: string) {
  parseIsoDate(value);
  return value.replace(/-/g, "").slice(2);
}

function parseIsoMonth(value: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) throw new Error(`Invalid month: ${value}. Use YYYY-MM.`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) {
    throw new Error(`Invalid month: ${value}. Use a real calendar month.`);
  }
  return { year, month };
}

function utcIsoDate(year: number, month: number, day: number) {
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
}

function addDays(value: string, days: number) {
  const parsed = parseIsoDate(value);
  const date = new Date(
    Date.UTC(parsed.year, parsed.month - 1, parsed.day + days),
  );
  return date.toISOString().slice(0, 10);
}

function normalizeIata(value: string) {
  const iata = value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(iata)) {
    throw new Error(
      `Invalid airport code: ${value}. Use a 3-letter IATA code.`,
    );
  }
  return iata;
}

function cabinClassForSearch(value?: string) {
  return (
    {
      CABIN_CLASS_ECONOMY: "economy",
      CABIN_CLASS_PREMIUM_ECONOMY: "premiumeconomy",
      CABIN_CLASS_BUSINESS: "business",
      CABIN_CLASS_FIRST: "first",
    }[value ?? "CABIN_CLASS_ECONOMY"] ?? "economy"
  );
}

function amadeusTravelClass(value?: string) {
  return (
    {
      CABIN_CLASS_ECONOMY: "ECONOMY",
      CABIN_CLASS_PREMIUM_ECONOMY: "PREMIUM_ECONOMY",
      CABIN_CLASS_BUSINESS: "BUSINESS",
      CABIN_CLASS_FIRST: "FIRST",
    }[value ?? "CABIN_CLASS_ECONOMY"] ?? "ECONOMY"
  );
}

type KeylessTravelSearchInput = {
  originIata: string;
  destinationIata: string;
  departureDate?: string;
  departureMonth?: string;
  returnDate?: string;
  tripLengthNights?: number;
  adults?: number;
  cabinClass?: string;
};

function createSkyscannerSearchUrl(input: {
  origin: string;
  destination: string;
  departureDate: string;
  returnDate?: string;
  adults: number;
  cabinClass?: string;
}) {
  const departure = compactFlightDate(input.departureDate);
  const returning = input.returnDate
    ? `/${compactFlightDate(input.returnDate)}`
    : "";
  const searchUrl = new URL(
    `https://www.skyscanner.com.au/transport/flights/${input.origin.toLowerCase()}/${input.destination.toLowerCase()}/${departure}${returning}/`,
  );
  searchUrl.searchParams.set("adultsv2", String(input.adults));
  searchUrl.searchParams.set(
    "cabinclass",
    cabinClassForSearch(input.cabinClass),
  );
  return searchUrl.toString();
}

function flexibleDepartureDates(departureMonth: string) {
  const { year, month } = parseIsoMonth(departureMonth);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return [3, 10, 17, 24]
    .filter((day) => day <= daysInMonth)
    .map((day) => utcIsoDate(year, month, day));
}

export function createKeylessTravelSearch(input: KeylessTravelSearchInput) {
  const origin = normalizeIata(input.originIata);
  const destination = normalizeIata(input.destinationIata);
  const adults = Math.min(Math.max(input.adults ?? 1, 1), 8);
  const tripLengthNights = input.tripLengthNights
    ? Math.min(Math.max(input.tripLengthNights, 1), 60)
    : undefined;

  if (input.departureDate && input.departureMonth) {
    throw new Error(
      "Choose either an exact departure date or a flexible month.",
    );
  }
  if (!input.departureDate && !input.departureMonth) {
    throw new Error("Add an exact departure date or a flexible travel month.");
  }
  if (input.departureMonth && input.returnDate) {
    throw new Error(
      "Use trip length in nights with a flexible month instead of one fixed return date.",
    );
  }

  const departureDates = input.departureMonth
    ? flexibleDepartureDates(input.departureMonth)
    : [input.departureDate!];
  const searchOptions = departureDates.map((departureDate) => {
    const returnDate = input.departureMonth
      ? tripLengthNights
        ? addDays(departureDate, tripLengthNights)
        : undefined
      : (input.returnDate ??
        (tripLengthNights
          ? addDays(departureDate, tripLengthNights)
          : undefined));
    return {
      departureDate,
      returnDate,
      searchUrl: createSkyscannerSearchUrl({
        origin,
        destination,
        departureDate,
        returnDate,
        adults,
        cabinClass: input.cabinClass,
      }),
    };
  });
  const primaryOption = searchOptions[0];

  return {
    provider: "Skyscanner Search",
    origin,
    destination,
    departureDate: primaryOption.departureDate,
    returnDate: primaryOption.returnDate,
    flexibleMonth: input.departureMonth,
    tripLengthNights,
    adults,
    cabinClass: input.cabinClass ?? "CABIN_CLASS_ECONOMY",
    currency: "AUD",
    searchUrl: primaryOption.searchUrl,
    searchOptions: input.departureMonth ? searchOptions : undefined,
    notice: input.departureMonth
      ? "Compare flexible dates on Skyscanner · current prices and booking remain on Skyscanner"
      : "Keyless search link · current prices and booking remain on Skyscanner",
    itineraries: [],
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function parseIsoDurationMinutes(value: unknown) {
  if (typeof value !== "string") return 0;
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?$/.exec(value);
  if (!match) return 0;
  return Number(match[1] ?? 0) * 60 + Number(match[2] ?? 0);
}

export async function searchSkyscannerFlights(
  input: {
    originIata: string;
    destinationIata: string;
    departureDate: string;
    returnDate?: string;
    adults?: number;
    cabinClass?: string;
  },
  settings: UserSettings,
) {
  const config = settings.researchPlugins?.skyscanner;
  const apiKey = config?.apiKey?.value?.trim();
  if (!apiKey) {
    throw new Error(
      "Skyscanner requires an approved partner API key in Settings → Plugins.",
    );
  }
  const queryLegs = [
    {
      originPlaceId: { iata: input.originIata.toUpperCase() },
      destinationPlaceId: { iata: input.destinationIata.toUpperCase() },
      date: parseIsoDate(input.departureDate),
    },
    ...(input.returnDate
      ? [
          {
            originPlaceId: { iata: input.destinationIata.toUpperCase() },
            destinationPlaceId: { iata: input.originIata.toUpperCase() },
            date: parseIsoDate(input.returnDate),
          },
        ]
      : []),
  ];
  const body = await fetchJson(
    `${SKYSCANNER_API_URL}/flights/live/search/create`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify({
        query: {
          market: config?.market || "AU",
          locale: config?.locale || "en-AU",
          currency: config?.currency || "AUD",
          queryLegs,
          adults: input.adults ?? 1,
          cabinClass: input.cabinClass ?? "CABIN_CLASS_ECONOMY",
        },
      }),
    },
  );
  const content = asRecord(body.content);
  const results = asRecord(content.results);
  const itineraries = asRecord(results.itineraries);
  const legs = asRecord(results.legs);
  const carriers = asRecord(results.carriers);
  const parsed = Object.entries(itineraries)
    .slice(0, 8)
    .map(([id, value]) => {
      const itinerary = asRecord(value);
      const pricingOptions = Array.isArray(itinerary.pricingOptions)
        ? itinerary.pricingOptions
        : [];
      const firstPrice = asRecord(asRecord(pricingOptions[0]).price);
      const items = Array.isArray(asRecord(pricingOptions[0]).items)
        ? (asRecord(pricingOptions[0]).items as unknown[])
        : [];
      const legIds = Array.isArray(itinerary.legIds)
        ? itinerary.legIds.map(String)
        : [];
      const legSummaries = legIds.map((legId) => {
        const leg = asRecord(legs[legId]);
        const carrierIds = Array.isArray(leg.marketingCarrierIds)
          ? leg.marketingCarrierIds.map(String)
          : [];
        return {
          origin: String(leg.originPlaceId ?? input.originIata),
          destination: String(leg.destinationPlaceId ?? input.destinationIata),
          departure: String(leg.departureDateTime ?? ""),
          arrival: String(leg.arrivalDateTime ?? ""),
          durationMinutes: Number(leg.durationInMinutes ?? 0),
          stopCount: Math.max(Number(leg.stopCount ?? 0), 0),
          carriers: carrierIds.map((carrierId) =>
            String(asRecord(carriers[carrierId]).name ?? carrierId),
          ),
        };
      });
      return {
        id,
        price: Number(firstPrice.amount ?? 0) / 1000,
        deepLink:
          typeof asRecord(items[0]).deepLink === "string"
            ? (asRecord(items[0]).deepLink as string)
            : undefined,
        legs: legSummaries,
      };
    });
  return {
    provider: "Skyscanner",
    origin: input.originIata.toUpperCase(),
    destination: input.destinationIata.toUpperCase(),
    departureDate: input.departureDate,
    returnDate: input.returnDate,
    adults: input.adults ?? 1,
    cabinClass: input.cabinClass ?? "CABIN_CLASS_ECONOMY",
    currency: config?.currency || "AUD",
    notice:
      "Live prices from Skyscanner Partner API · availability may change before booking",
    itineraries: parsed,
  };
}

async function getAmadeusAccessToken(settings: UserSettings) {
  const config = settings.researchPlugins?.amadeus;
  const apiKey = config?.apiKey?.value?.trim();
  const apiSecret = config?.apiSecret?.value?.trim();
  if (!apiKey || !apiSecret) {
    throw new Error(
      "Amadeus requires an API key and secret in Settings → Plugins.",
    );
  }
  const baseUrl =
    config?.environment === "production"
      ? AMADEUS_PRODUCTION_API_URL
      : AMADEUS_TEST_API_URL;
  const body = await fetchJson(
    `${baseUrl}/v1/security/oauth2/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: apiKey,
        client_secret: apiSecret,
      }).toString(),
    },
    12_000,
  );
  const accessToken =
    typeof body.access_token === "string" ? body.access_token : undefined;
  if (!accessToken) throw new Error("Amadeus did not return an access token.");
  return { baseUrl, accessToken };
}

export async function searchAmadeusFlights(
  input: {
    originIata: string;
    destinationIata: string;
    departureDate: string;
    returnDate?: string;
    adults?: number;
    cabinClass?: string;
  },
  settings: UserSettings,
) {
  const origin = normalizeIata(input.originIata);
  const destination = normalizeIata(input.destinationIata);
  parseIsoDate(input.departureDate);
  if (input.returnDate) parseIsoDate(input.returnDate);
  const config = settings.researchPlugins?.amadeus;
  const { baseUrl, accessToken } = await getAmadeusAccessToken(settings);
  const url = new URL(`${baseUrl}/v2/shopping/flight-offers`);
  url.searchParams.set("originLocationCode", origin);
  url.searchParams.set("destinationLocationCode", destination);
  url.searchParams.set("departureDate", input.departureDate);
  if (input.returnDate) url.searchParams.set("returnDate", input.returnDate);
  url.searchParams.set("adults", String(input.adults ?? 1));
  url.searchParams.set("travelClass", amadeusTravelClass(input.cabinClass));
  url.searchParams.set("currencyCode", config?.currency || "AUD");
  url.searchParams.set("max", "8");
  const body = await fetchJson(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const carriers = asRecord(asRecord(body.dictionaries).carriers);
  const offers = Array.isArray(body.data) ? body.data : [];
  const itineraries = offers.slice(0, 8).flatMap((value, index) => {
    const offer = asRecord(value);
    const price = asRecord(offer.price);
    const journeys = Array.isArray(offer.itineraries) ? offer.itineraries : [];
    const legs = journeys.flatMap((journey) => {
      const itinerary = asRecord(journey);
      const segments = Array.isArray(itinerary.segments)
        ? itinerary.segments.map(asRecord)
        : [];
      const first = segments[0];
      const last = segments.at(-1);
      if (!first || !last) return [];
      const carrierCodes = [
        ...new Set(
          segments
            .map((segment) => String(segment.carrierCode ?? ""))
            .filter(Boolean),
        ),
      ];
      return [
        {
          origin: String(asRecord(first.departure).iataCode ?? origin),
          destination: String(asRecord(last.arrival).iataCode ?? destination),
          departure: String(asRecord(first.departure).at ?? ""),
          arrival: String(asRecord(last.arrival).at ?? ""),
          durationMinutes: parseIsoDurationMinutes(itinerary.duration),
          stopCount: Math.max(segments.length - 1, 0),
          carriers: carrierCodes.map((code) => String(carriers[code] ?? code)),
        },
      ];
    });
    if (legs.length === 0) return [];
    return [
      {
        id: String(offer.id ?? `amadeus-${index}`),
        price: Number(price.grandTotal ?? price.total ?? 0),
        legs,
      },
    ];
  });
  return {
    provider: "Amadeus",
    origin,
    destination,
    departureDate: input.departureDate,
    returnDate: input.returnDate,
    adults: input.adults ?? 1,
    cabinClass: input.cabinClass ?? "CABIN_CLASS_ECONOMY",
    currency: String(
      asRecord(asRecord(offers[0]).price).currency ?? config?.currency ?? "AUD",
    ),
    notice:
      config?.environment === "production"
        ? "Flight offers from Amadeus · refresh before booking"
        : "Amadeus test environment · coverage and fares may be limited",
    itineraries,
  };
}

function requireDuffelTestToken(settings: UserSettings) {
  const token =
    settings.researchPlugins?.duffel?.accessToken?.value?.trim() ?? "";
  if (!token) {
    throw new Error(
      "Duffel Sandbox requires a test token in Settings → Plugins.",
    );
  }
  if (!token.startsWith("duffel_test_")) {
    throw new Error(
      "Duffel Sandbox only accepts tokens beginning with duffel_test_.",
    );
  }
  return token;
}

export async function searchDuffelSandboxFlights(
  input: {
    originIata: string;
    destinationIata: string;
    departureDate: string;
    returnDate?: string;
    adults?: number;
    cabinClass?: string;
  },
  settings: UserSettings,
) {
  const origin = normalizeIata(input.originIata);
  const destination = normalizeIata(input.destinationIata);
  parseIsoDate(input.departureDate);
  if (input.returnDate) parseIsoDate(input.returnDate);
  const token = requireDuffelTestToken(settings);
  const adults = Math.min(Math.max(input.adults ?? 1, 1), 8);
  const slices = [
    {
      origin,
      destination,
      departure_date: input.departureDate,
    },
    ...(input.returnDate
      ? [
          {
            origin: destination,
            destination: origin,
            departure_date: input.returnDate,
          },
        ]
      : []),
  ];
  const body = await fetchJson(
    `${DUFFEL_API_URL}/air/offer_requests?return_offers=true&supplier_timeout=10000`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "Duffel-Version": "v2",
        "Accept-Encoding": "gzip",
      },
      body: JSON.stringify({
        data: {
          cabin_class: cabinClassForSearch(input.cabinClass).replace(
            "premiumeconomy",
            "premium_economy",
          ),
          slices,
          passengers: Array.from({ length: adults }, () => ({
            type: "adult",
          })),
        },
      }),
    },
    20_000,
  );
  const data = asRecord(body.data);
  const offers = Array.isArray(data.offers) ? data.offers : [];
  const itineraries = offers.slice(0, 8).flatMap((value, index) => {
    const offer = asRecord(value);
    const owner = asRecord(offer.owner);
    const offerSlices = Array.isArray(offer.slices) ? offer.slices : [];
    const legs = offerSlices.flatMap((slice) => {
      const journey = asRecord(slice);
      const segments = Array.isArray(journey.segments)
        ? journey.segments.map(asRecord)
        : [];
      const first = segments[0];
      const last = segments.at(-1);
      if (!first || !last) return [];
      return [
        {
          origin: String(asRecord(first.origin).iata_code ?? origin),
          destination: String(
            asRecord(last.destination).iata_code ?? destination,
          ),
          departure: String(first.departing_at ?? ""),
          arrival: String(last.arriving_at ?? ""),
          durationMinutes: parseIsoDurationMinutes(journey.duration),
          stopCount: Math.max(segments.length - 1, 0),
          carriers: [String(owner.name ?? "Duffel Airways")],
        },
      ];
    });
    if (legs.length === 0) return [];
    return [
      {
        id: String(offer.id ?? `duffel-${index}`),
        price: Number(offer.total_amount ?? 0),
        legs,
      },
    ];
  });
  return {
    provider: "Duffel Sandbox",
    origin,
    destination,
    departureDate: input.departureDate,
    returnDate: input.returnDate,
    adults,
    cabinClass: input.cabinClass ?? "CABIN_CLASS_ECONOMY",
    currency: String(asRecord(offers[0]).total_currency ?? "USD"),
    notice: "Simulated Duffel test data · not real or bookable fares",
    itineraries,
  };
}

export async function testResearchPlugin(
  plugin:
    | "travel-search"
    | "duckduckgo"
    | "coingecko"
    | "weather"
    | "maps"
    | "skyscanner"
    | "amadeus"
    | "duffel",
  settings: UserSettings,
) {
  if (plugin === "travel-search") {
    createKeylessTravelSearch({
      originIata: "BNE",
      destinationIata: "SYD",
      departureDate: "2027-01-15",
    });
    return "Keyless travel search is ready.";
  }
  if (plugin === "duckduckgo") {
    await searchDuckDuckGo("DuckDuckGo");
    return "DuckDuckGo Instant Answers is online.";
  }
  if (plugin === "coingecko") {
    await searchCoinGecko("bitcoin", "usd", settings);
    return "CoinGecko market data is online.";
  }
  if (plugin === "weather") {
    await getOpenMeteoWeather("Brisbane", settings);
    return "Open-Meteo weather is online.";
  }
  if (plugin === "maps") {
    const data = await searchOpenFreeMapPlaces("Brisbane", settings);
    if (data.places.length === 0)
      throw new Error("Place search returned no results.");
    await fetchJson(data.styleUrl, undefined, 10_000);
    return "Map place search and OpenFreeMap tiles are ready.";
  }
  if (plugin === "amadeus") {
    await getAmadeusAccessToken(settings);
    return "Amadeus credentials are valid.";
  }
  if (plugin === "duffel") {
    const token = requireDuffelTestToken(settings);
    await fetchJson(`${DUFFEL_API_URL}/air/airlines?limit=1`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Duffel-Version": "v2",
      },
    });
    return "Duffel Sandbox is connected.";
  }
  const apiKey = settings.researchPlugins?.skyscanner?.apiKey?.value?.trim();
  if (!apiKey) throw new Error("Enter and save a Skyscanner partner API key.");
  await fetchJson(`${SKYSCANNER_API_URL}/autosuggest/flights`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey },
    body: JSON.stringify({
      query: {
        market: settings.researchPlugins?.skyscanner?.market || "AU",
        locale: settings.researchPlugins?.skyscanner?.locale || "en-AU",
        searchTerm: "Brisbane",
        includedEntityTypes: ["PLACE_TYPE_CITY", "PLACE_TYPE_AIRPORT"],
      },
    }),
  });
  return "Skyscanner partner API is connected.";
}

export function buildResearchPluginToolSet(
  settings: UserSettings,
  onToolResult: ToolResultCallback,
): ToolSet {
  const tools: ToolSet = {};
  const webSearchCache = new Map<string, ReturnType<typeof searchDuckDuckGo>>();
  const travelSearchEnabled =
    settings.researchPlugins?.travelSearch?.enabled !== false;
  const duckDuckGoEnabled =
    settings.researchPlugins?.duckDuckGo?.enabled !== false;
  const coinGeckoEnabled =
    settings.researchPlugins?.coinGecko?.enabled !== false;
  const weatherEnabled = settings.researchPlugins?.weather?.enabled !== false;
  const mapsEnabled = settings.researchPlugins?.maps?.enabled !== false;
  const skyscannerEnabled =
    settings.researchPlugins?.skyscanner?.enabled === true &&
    Boolean(settings.researchPlugins.skyscanner.apiKey?.value);
  const amadeusEnabled =
    settings.researchPlugins?.amadeus?.enabled === true &&
    Boolean(settings.researchPlugins.amadeus.apiKey?.value) &&
    Boolean(settings.researchPlugins.amadeus.apiSecret?.value);
  const duffelEnabled =
    settings.researchPlugins?.duffel?.enabled === true &&
    Boolean(settings.researchPlugins.duffel.accessToken?.value);

  if (travelSearchEnabled) {
    tools.open_flight_search = {
      description:
        "Create free Skyscanner flight-search links without an API key. Supports either an exact departureDate, or a flexible departureMonth plus optional tripLengthNights. A flexible month returns several date windows so the user can compare fares without choosing an exact date first. Use details already supplied in the conversation and never invent prices.",
      inputSchema: z
        .object({
          originIata: z.string().length(3),
          destinationIata: z.string().length(3),
          departureDate: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .optional(),
          departureMonth: z
            .string()
            .regex(/^\d{4}-\d{2}$/)
            .optional(),
          returnDate: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .optional(),
          tripLengthNights: z.number().int().min(1).max(60).optional(),
          adults: z.number().int().min(1).max(8).default(1),
          cabinClass: z
            .enum([
              "CABIN_CLASS_ECONOMY",
              "CABIN_CLASS_PREMIUM_ECONOMY",
              "CABIN_CLASS_BUSINESS",
              "CABIN_CLASS_FIRST",
            ])
            .default("CABIN_CLASS_ECONOMY"),
        })
        .refine((input) => input.departureDate || input.departureMonth, {
          message: "Provide departureDate or departureMonth.",
        })
        .refine((input) => !(input.departureDate && input.departureMonth), {
          message: "Use departureDate or departureMonth, not both.",
        }),
      execute: async (
        input: Parameters<typeof createKeylessTravelSearch>[0],
      ) => {
        try {
          const data = {
            ...createKeylessTravelSearch(input),
            currency: settings.researchPlugins?.travelSearch?.currency || "AUD",
          };
          const result = JSON.stringify(data);
          onToolResult({
            serverName: "Travel Search",
            toolName: "Create flight search",
            result,
            status: "completed",
            presentation: { kind: "flight-search", ...data },
          });
          return result;
        } catch (error) {
          const result = error instanceof Error ? error.message : String(error);
          onToolResult({
            serverName: "Travel Search",
            toolName: "Create flight search",
            result,
            status: "error",
          });
          throw error;
        }
      },
    };
  }

  if (duckDuckGoEnabled) {
    tools.search_web = {
      description:
        "Search live DuckDuckGo web results and Instant Answers. Use for explicit web searches, current facts, news topics, people, organisations, products, and unfamiliar terms. Cite the returned source URLs and never claim the search failed when results are present.",
      inputSchema: z.object({ query: z.string().min(2).max(300) }),
      execute: async (
        { query }: { query: string },
        _options: ToolExecutionOptions,
      ) => {
        try {
          const cacheKey = query.trim().toLocaleLowerCase();
          let pendingSearch = webSearchCache.get(cacheKey);
          if (!pendingSearch) {
            pendingSearch = searchDuckDuckGo(query);
            webSearchCache.set(cacheKey, pendingSearch);
          }
          const data = await pendingSearch;
          const result = JSON.stringify(data);
          onToolResult({
            serverName: "DuckDuckGo",
            toolName: "Web search",
            result,
            status: "completed",
            presentation: { kind: "web-search", ...data },
          });
          return result;
        } catch (error) {
          const result = error instanceof Error ? error.message : String(error);
          onToolResult({
            serverName: "DuckDuckGo",
            toolName: "Web search",
            result,
            status: "error",
          });
          throw error;
        }
      },
    };
  }

  if (coinGeckoEnabled) {
    tools.search_crypto_markets = {
      description:
        "Get current cryptocurrency prices and market data from CoinGecko. Use for coin prices, token lookups, market cap, volume, and 24-hour change.",
      inputSchema: z.object({
        query: z.string().min(1).max(100),
        currency: z.string().length(3).default("usd"),
      }),
      execute: async (
        { query, currency }: { query: string; currency: string },
        _options: ToolExecutionOptions,
      ) => {
        try {
          const data = await searchCoinGecko(query, currency, settings);
          const result = JSON.stringify(data);
          onToolResult({
            serverName: "CoinGecko",
            toolName: "Crypto market search",
            result,
            status: "completed",
            presentation: { kind: "crypto-market", ...data },
          });
          return result;
        } catch (error) {
          const result = error instanceof Error ? error.message : String(error);
          onToolResult({
            serverName: "CoinGecko",
            toolName: "Crypto market search",
            result,
            status: "error",
          });
          throw error;
        }
      },
    };
  }

  if (weatherEnabled) {
    tools.get_weather = {
      description:
        "Get live current weather and a daily forecast from Open-Meteo. Use whenever the user asks about weather, temperature, rain, wind, or a forecast for a named city or place. Do not answer current weather from memory.",
      inputSchema: z.object({
        location: z.string().min(2).max(160),
      }),
      execute: async ({ location }: { location: string }) => {
        try {
          const data = await getOpenMeteoWeather(location, settings);
          const result = JSON.stringify(data);
          onToolResult({
            serverName: "Open-Meteo",
            toolName: "Weather forecast",
            result,
            status: "completed",
            presentation: { kind: "weather-forecast", ...data },
          });
          return result;
        } catch (error) {
          const result = error instanceof Error ? error.message : String(error);
          onToolResult({
            serverName: "Open-Meteo",
            toolName: "Weather forecast",
            result,
            status: "error",
          });
          throw error;
        }
      },
    };
  }

  if (mapsEnabled) {
    tools.search_places = {
      description:
        "Find cities, towns, regions, or postcodes and display them on an interactive map. Use for map or location requests. This place search does not find street addresses or businesses, so state that limitation when relevant.",
      inputSchema: z.object({
        query: z.string().min(2).max(160),
      }),
      execute: async ({ query }: { query: string }) => {
        try {
          const data = await searchOpenFreeMapPlaces(query, settings);
          const result = JSON.stringify(data);
          onToolResult({
            serverName: "OpenFreeMap",
            toolName: "Place search",
            result,
            status: "completed",
            presentation: { kind: "map-places", ...data },
          });
          return result;
        } catch (error) {
          const result = error instanceof Error ? error.message : String(error);
          onToolResult({
            serverName: "OpenFreeMap",
            toolName: "Place search",
            result,
            status: "error",
          });
          throw error;
        }
      },
    };
  }

  if (skyscannerEnabled) {
    tools.search_flights = {
      description:
        "Search live flight prices with Skyscanner. Only call after the user gives origin, destination, and departure date. Airport IATA codes are required.",
      inputSchema: z.object({
        originIata: z.string().length(3),
        destinationIata: z.string().length(3),
        departureDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        returnDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
        adults: z.number().int().min(1).max(8).default(1),
        cabinClass: z
          .enum([
            "CABIN_CLASS_ECONOMY",
            "CABIN_CLASS_PREMIUM_ECONOMY",
            "CABIN_CLASS_BUSINESS",
            "CABIN_CLASS_FIRST",
          ])
          .default("CABIN_CLASS_ECONOMY"),
      }),
      execute: async (input: Parameters<typeof searchSkyscannerFlights>[0]) => {
        try {
          const data = await searchSkyscannerFlights(input, settings);
          const result = JSON.stringify(data);
          onToolResult({
            serverName: "Skyscanner",
            toolName: "Flight search",
            result,
            status: "completed",
            presentation: { kind: "flight-search", ...data },
          });
          return result;
        } catch (error) {
          const result = error instanceof Error ? error.message : String(error);
          onToolResult({
            serverName: "Skyscanner",
            toolName: "Flight search",
            result,
            status: "error",
          });
          throw error;
        }
      },
    };
  }

  if (amadeusEnabled) {
    tools.search_flights_amadeus = {
      description:
        "Search structured flight offers with the configured Amadeus API. Use only after the user provides origin, destination, and departure date. Test-environment coverage can be limited.",
      inputSchema: z.object({
        originIata: z.string().length(3),
        destinationIata: z.string().length(3),
        departureDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        returnDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
        adults: z.number().int().min(1).max(8).default(1),
        cabinClass: z
          .enum([
            "CABIN_CLASS_ECONOMY",
            "CABIN_CLASS_PREMIUM_ECONOMY",
            "CABIN_CLASS_BUSINESS",
            "CABIN_CLASS_FIRST",
          ])
          .default("CABIN_CLASS_ECONOMY"),
      }),
      execute: async (input: Parameters<typeof searchAmadeusFlights>[0]) => {
        try {
          const data = await searchAmadeusFlights(input, settings);
          const result = JSON.stringify(data);
          onToolResult({
            serverName: "Amadeus",
            toolName: "Flight offer search",
            result,
            status: "completed",
            presentation: { kind: "flight-search", ...data },
          });
          return result;
        } catch (error) {
          const result = error instanceof Error ? error.message : String(error);
          onToolResult({
            serverName: "Amadeus",
            toolName: "Flight offer search",
            result,
            status: "error",
          });
          throw error;
        }
      },
    };
  }

  if (duffelEnabled) {
    tools.search_flights_duffel_sandbox = {
      description:
        "Search simulated Duffel sandbox flight offers for development and testing. Never describe these as real, live, or bookable fares.",
      inputSchema: z.object({
        originIata: z.string().length(3),
        destinationIata: z.string().length(3),
        departureDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        returnDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
        adults: z.number().int().min(1).max(8).default(1),
        cabinClass: z
          .enum([
            "CABIN_CLASS_ECONOMY",
            "CABIN_CLASS_PREMIUM_ECONOMY",
            "CABIN_CLASS_BUSINESS",
            "CABIN_CLASS_FIRST",
          ])
          .default("CABIN_CLASS_ECONOMY"),
      }),
      execute: async (
        input: Parameters<typeof searchDuffelSandboxFlights>[0],
      ) => {
        try {
          const data = await searchDuffelSandboxFlights(input, settings);
          const result = JSON.stringify(data);
          onToolResult({
            serverName: "Duffel Sandbox",
            toolName: "Sandbox flight search",
            result,
            status: "completed",
            presentation: { kind: "flight-search", ...data },
          });
          return result;
        } catch (error) {
          const result = error instanceof Error ? error.message : String(error);
          onToolResult({
            serverName: "Duffel Sandbox",
            toolName: "Sandbox flight search",
            result,
            status: "error",
          });
          throw error;
        }
      },
    };
  }

  return tools;
}
