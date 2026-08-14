/**
 * Where the machine is, inferred from its own clock.
 *
 * The IANA timezone the OS is set to carries a place name — "Australia/Brisbane"
 * — so the dashboard can name a city without asking anyone for permission,
 * without a location service, and without sending an IP address anywhere to be
 * looked up. It is a guess at the nearest large city, not a position, which is
 * both the privacy advantage and the limitation.
 *
 * Anyone who wants a different place sets one; this is only the default.
 */

/**
 * The city in a timezone identifier, or null when it does not name one.
 *
 * "UTC", "GMT+10" and "Etc/GMT-10" name no place, so they produce nothing
 * rather than a city that does not exist.
 */
export function cityFromTimeZone(timeZone: string | undefined): string | null {
  if (!timeZone) return null;

  const parts = timeZone.split("/");
  // A bare "UTC" has no region, and the Etc/* zone is a fixed offset dressed up
  // as a place.
  if (parts.length < 2 || parts[0] === "Etc") return null;

  const city = parts[parts.length - 1]?.replace(/_/g, " ").trim();
  if (!city) return null;

  // "GMT+10" and friends sometimes appear as the final segment.
  if (/^(GMT|UTC)/i.test(city)) return null;

  return city;
}

/** The timezone this process is running in, or undefined if it cannot be read. */
export function currentTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}
