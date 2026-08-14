import log from "electron-log";

import { readSettings, writeSettings } from "../../main/settings";

import { createTypedHandler } from "./base";
import {
  dashboardContracts,
  type DashboardConditions,
} from "../types/dashboard";
import { getOpenMeteoWeather } from "../utils/research_plugins";
import {
  cityFromTimeZone,
  currentTimeZone,
} from "@/lib/dashboard/location_from_timezone";

const logger = log.scope("dashboard_handlers");

/**
 * The place to report conditions for.
 *
 * A saved place wins; otherwise the OS timezone names the nearest large city.
 * Nothing is invented: a timezone that names no place produces none.
 */
function resolveLocation(): {
  query: string;
  source: "saved" | "timezone";
} | null {
  const saved = readSettings().dashboardLocation?.trim();
  if (saved) return { query: saved, source: "saved" };

  const city = cityFromTimeZone(currentTimeZone());
  return city ? { query: city, source: "timezone" } : null;
}

/**
 * Current place and weather, or an honest account of why there is neither.
 *
 * Reuses the weather the chat agent already uses, so there is one Open-Meteo
 * client in the app rather than two that can disagree.
 */
async function loadConditions(): Promise<DashboardConditions> {
  const resolved = resolveLocation();
  if (!resolved) {
    return {
      location: null,
      weather: null,
      unavailableReason:
        "No location set, and this machine's timezone does not name a city.",
    };
  }

  try {
    const forecast = await getOpenMeteoWeather(resolved.query, readSettings());
    return {
      location: {
        name: forecast.location.name,
        admin1: forecast.location.admin1,
        country: forecast.location.country,
        source: resolved.source,
      },
      weather: {
        temperature: forecast.current.temperature,
        apparentTemperature: forecast.current.apparentTemperature ?? null,
        humidity: forecast.current.humidity ?? null,
        windSpeed: forecast.current.windSpeed ?? null,
        weatherCode: forecast.current.weatherCode,
        isDay: forecast.current.isDay,
        units: {
          temperature: forecast.units.temperature,
          windSpeed: forecast.units.windSpeed,
        },
        observedAt: forecast.current.time,
        source: forecast.source,
      },
      unavailableReason: null,
    };
  } catch (error) {
    logger.warn(
      "Could not load dashboard conditions:",
      error instanceof Error ? error.message : error,
    );
    return {
      // The place is still known even when its weather is not, so it is still
      // shown rather than blanked along with the failure.
      location: {
        name: resolved.query,
        source: resolved.source,
      },
      weather: null,
      unavailableReason:
        error instanceof Error
          ? error.message
          : "Weather is unavailable right now.",
    };
  }
}

export function registerDashboardHandlers() {
  createTypedHandler(dashboardContracts.conditions, async () => {
    return loadConditions();
  });

  createTypedHandler(dashboardContracts.setLocation, async (_event, input) => {
    const location = input.location.trim();
    // Empty means "go back to the timezone guess" rather than "no location".
    writeSettings({ dashboardLocation: location || undefined });
    return loadConditions();
  });
}
