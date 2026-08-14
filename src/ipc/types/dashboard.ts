import { z } from "zod";
import { createClient, defineContract } from "../contracts/core";

/**
 * Contracts for the dashboard's where-and-when panel.
 *
 * Only the parts that need the main process live here: the clock is local and
 * needs no IPC, but naming a place and fetching its weather is a network call,
 * and network calls belong on the other side of the bridge.
 *
 * Everything is nullable. An unreachable weather service produces null, which
 * the dashboard shows as unavailable — never a plausible-looking guess.
 */

export const DashboardConditionsSchema = z.object({
  location: z
    .object({
      name: z.string(),
      admin1: z.string().optional(),
      country: z.string().optional(),
      /** Where the name came from, so the UI can say it is an estimate. */
      source: z.enum(["saved", "timezone"]),
    })
    .nullable(),
  weather: z
    .object({
      temperature: z.number(),
      apparentTemperature: z.number().nullable(),
      humidity: z.number().nullable(),
      windSpeed: z.number().nullable(),
      weatherCode: z.number(),
      isDay: z.boolean(),
      units: z.object({
        temperature: z.string(),
        windSpeed: z.string(),
      }),
      observedAt: z.string(),
      source: z.string(),
    })
    .nullable(),
  /** Why there is nothing to show, when there is nothing to show. */
  unavailableReason: z.string().nullable(),
});

export type DashboardConditions = z.infer<typeof DashboardConditionsSchema>;

export const dashboardContracts = {
  /** Current place and weather. Read only; changes nothing. */
  conditions: defineContract({
    channel: "dashboard:conditions",
    input: z.void(),
    output: DashboardConditionsSchema,
  }),
  /** Pin a place by name, or clear it to go back to the timezone guess. */
  setLocation: defineContract({
    channel: "dashboard:set-location",
    input: z.object({ location: z.string().max(120) }),
    output: DashboardConditionsSchema,
  }),
} as const;

export const dashboardClient = createClient(dashboardContracts);
