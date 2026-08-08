export type FlightConversationMessage = {
  role: "user" | "assistant";
  content: string;
};

export type FlexibleFlightSearchIntent = {
  originIata: string;
  destinationIata: string;
  departureMonth: string;
  tripLengthNights: number;
  adults: number;
  cabinClass:
    | "CABIN_CLASS_ECONOMY"
    | "CABIN_CLASS_PREMIUM_ECONOMY"
    | "CABIN_CLASS_BUSINESS"
    | "CABIN_CLASS_FIRST";
};

const MONTH_NUMBERS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

function lastMatch(text: string, expression: RegExp) {
  return [...text.matchAll(expression)].at(-1);
}

function inferDepartureMonth(text: string, now: Date) {
  const iso = lastMatch(text, /\b(20\d{2})-(0[1-9]|1[0-2])\b/g);
  if (iso) return `${iso[1]}-${iso[2]}`;

  const named = lastMatch(
    text,
    /\b(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec)\b(?:\s*(?:,|in)?\s*(20\d{2}))?/gi,
  );
  if (!named) return null;
  const month = MONTH_NUMBERS[named[1]!.toLowerCase()];
  if (!month) return null;
  const suppliedYear = named[2] ? Number(named[2]) : undefined;
  const year =
    suppliedYear ??
    (month >= now.getMonth() + 1 ? now.getFullYear() : now.getFullYear() + 1);
  return `${year}-${String(month).padStart(2, "0")}`;
}

function inferAirportPair(text: string) {
  const direct = lastMatch(text, /\b([A-Z]{3})\s*(?:→|->|to)\s*([A-Z]{3})\b/g);
  if (direct) return [direct[1]!, direct[2]!] as const;

  // The assistant resolves city names to IATA once, then writes them as
  // "Brisbane (BNE)" and "Phuket (HKT)". Reusing those verified codes is
  // safer than maintaining an incomplete city-to-airport table here.
  const codes = [...text.matchAll(/\(([A-Z]{3})\)/g)]
    .map((match) => match[1]!)
    .filter((code, index, all) => all.indexOf(code) === index);
  return codes.length >= 2 ? ([codes[0]!, codes[1]!] as const) : null;
}

function inferCabinClass(
  text: string,
): FlexibleFlightSearchIntent["cabinClass"] {
  const matches = [
    ...text.matchAll(
      /\b(premium\s+economy|economy|business(?:\s+class)?|first(?:\s+class)?)\b/gi,
    ),
  ];
  const value = matches.at(-1)?.[1]?.toLowerCase() ?? "economy";
  if (value.startsWith("premium")) return "CABIN_CLASS_PREMIUM_ECONOMY";
  if (value.startsWith("business")) return "CABIN_CLASS_BUSINESS";
  if (value.startsWith("first")) return "CABIN_CLASS_FIRST";
  return "CABIN_CLASS_ECONOMY";
}

/**
 * Recovers a complete flexible-flight request from recent chat turns.
 *
 * This is deliberately narrow: it only fires when the latest user message is
 * adding travel criteria and the conversation already contains an explicitly
 * resolved IATA route. It cannot accidentally turn an unrelated follow-up into
 * a flight search.
 */
export function inferFlexibleFlightSearchIntent(
  messages: FlightConversationMessage[],
  now = new Date(),
): FlexibleFlightSearchIntent | null {
  const recent = messages.slice(-10);
  const latestUser = [...recent]
    .reverse()
    .find((message) => message.role === "user")?.content;
  if (!latestUser) return null;
  if (
    !/\b(?:flights?|fares?|night|nights|adults?|economy|business|first|return|one[- ]way|january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec|20\d{2}-\d{2})\b/i.test(
      latestUser,
    )
  ) {
    return null;
  }

  const transcript = recent.map((message) => message.content).join("\n");
  if (!/\b(?:flights?|fares?|skyscanner)\b/i.test(transcript)) return null;

  const airports = inferAirportPair(transcript);
  const departureMonth = inferDepartureMonth(transcript, now);
  const stay = lastMatch(transcript, /\b(\d{1,2})\s*nights?\b/gi);
  if (!airports || !departureMonth || !stay) return null;

  const tripLengthNights = Number(stay[1]);
  if (tripLengthNights < 1 || tripLengthNights > 60) return null;
  const adultMatch = lastMatch(transcript, /\b([1-8])\s*adults?\b/gi);

  return {
    originIata: airports[0],
    destinationIata: airports[1],
    departureMonth,
    tripLengthNights,
    adults: adultMatch ? Number(adultMatch[1]) : 1,
    cabinClass: inferCabinClass(transcript),
  };
}
