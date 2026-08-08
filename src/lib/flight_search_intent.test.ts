import { describe, expect, it } from "vitest";
import { inferFlexibleFlightSearchIntent } from "./flight_search_intent";

describe("inferFlexibleFlightSearchIntent", () => {
  it("completes a flexible flight request from conversational details", () => {
    expect(
      inferFlexibleFlightSearchIntent(
        [
          { role: "user", content: "Find flights from Brisbane to Phuket" },
          {
            role: "assistant",
            content:
              "From: Brisbane (BNE)\nTo: Phuket (HKT)\nWhen: September (assuming Sep 2026)\nTravellers: 2 adults\nCabin: Economy",
          },
          { role: "user", content: "10 nights" },
        ],
        new Date(2026, 7, 8),
      ),
    ).toEqual({
      originIata: "BNE",
      destinationIata: "HKT",
      departureMonth: "2026-09",
      tripLengthNights: 10,
      adults: 2,
      cabinClass: "CABIN_CLASS_ECONOMY",
    });
  });

  it("uses the next future occurrence when the user omits the year", () => {
    expect(
      inferFlexibleFlightSearchIntent(
        [
          {
            role: "user",
            content: "Flights BNE → HKT, September, business, 2 adults",
          },
          { role: "assistant", content: "How long would you like to stay?" },
          { role: "user", content: "return for 14 nights" },
        ],
        new Date(2026, 10, 1),
      )?.departureMonth,
    ).toBe("2027-09");
  });

  it("does not repeat a search for an unrelated follow-up", () => {
    expect(
      inferFlexibleFlightSearchIntent(
        [
          { role: "user", content: "Flights BNE → HKT in September 2026" },
          { role: "assistant", content: "I created your search." },
          { role: "user", content: "thanks" },
        ],
        new Date(2026, 7, 8),
      ),
    ).toBeNull();
  });
});
