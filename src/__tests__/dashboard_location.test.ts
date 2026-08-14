import { describe, expect, it } from "vitest";

import { cityFromTimeZone } from "@/lib/dashboard/location_from_timezone";

/**
 * The timezone names a city without asking for a position, but only sometimes.
 * The important case is the one where it does not: a fixed-offset zone must
 * produce nothing rather than a city that does not exist.
 */
describe("naming a city from a timezone", () => {
  it("reads the city out of a regional zone", () => {
    expect(cityFromTimeZone("Australia/Brisbane")).toBe("Brisbane");
    expect(cityFromTimeZone("Europe/London")).toBe("London");
  });

  it("restores the spaces the identifier removed", () => {
    expect(cityFromTimeZone("America/New_York")).toBe("New York");
  });

  it("takes the city from a three-part zone", () => {
    expect(cityFromTimeZone("America/Argentina/Buenos_Aires")).toBe(
      "Buenos Aires",
    );
  });

  it("gives nothing for a zone that names no place", () => {
    // These are offsets wearing a place's clothing.
    expect(cityFromTimeZone("UTC")).toBeNull();
    expect(cityFromTimeZone("Etc/GMT-10")).toBeNull();
    expect(cityFromTimeZone("Etc/UTC")).toBeNull();
  });

  it("gives nothing when there is no timezone at all", () => {
    expect(cityFromTimeZone(undefined)).toBeNull();
    expect(cityFromTimeZone("")).toBeNull();
  });
});
