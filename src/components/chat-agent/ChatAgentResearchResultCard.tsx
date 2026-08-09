import {
  ArrowUpRight,
  CalendarDays,
  Coins,
  ExternalLink,
  Globe2,
  Plane,
  Search,
  Users,
} from "lucide-react";
import type { ChatAgentToolPresentation } from "@/ipc/types/chat_agent";
import { ipc } from "@/ipc/types";
import { ChatAgentDatabaseResultCard } from "./ChatAgentDatabaseResultCard";
import { ChatAgentMapCard } from "./ChatAgentMapCard";
import { ChatAgentWeatherCard } from "./ChatAgentWeatherCard";

type ResearchPresentation = Exclude<
  ChatAgentToolPresentation,
  { kind: "lovable-projects" }
>;
type FlightPresentation = Extract<
  ResearchPresentation,
  { kind: "flight-search" }
>;

function openUrl(url: string) {
  void ipc.system.openExternalUrl(url);
}

function formatMoney(value: number, currency: string) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: currency.toUpperCase(),
    maximumFractionDigits: value < 1 ? 6 : 2,
  }).format(value);
}

function formatCompact(value?: number) {
  if (value == null) return "—";
  return new Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatDuration(minutes: number) {
  if (!minutes) return "Duration unavailable";
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function formatPublishedDate(value?: string) {
  if (!value) return undefined;
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year:
      date.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  }).format(date);
}

function formatFlightDate(value: string) {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

function formatFlightMonth(value: string) {
  const date = new Date(`${value}-01T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "long",
    year: "numeric",
  }).format(date);
}

function formatCabinClass(value?: string) {
  return (
    {
      CABIN_CLASS_ECONOMY: "Economy",
      CABIN_CLASS_PREMIUM_ECONOMY: "Premium economy",
      CABIN_CLASS_BUSINESS: "Business",
      CABIN_CLASS_FIRST: "First",
    }[value ?? "CABIN_CLASS_ECONOMY"] ??
    value ??
    "Economy"
  );
}

function FlightSearchCard({
  presentation,
}: {
  presentation: FlightPresentation;
}) {
  const flexibleOptions = presentation.searchOptions ?? [];
  const passengerLabel = `${presentation.adults ?? 1} adult${
    (presentation.adults ?? 1) === 1 ? "" : "s"
  }`;
  const tripLabel = presentation.flexibleMonth
    ? [
        `Flexible ${formatFlightMonth(presentation.flexibleMonth)}`,
        presentation.tripLengthNights
          ? `${presentation.tripLengthNights} night${presentation.tripLengthNights === 1 ? "" : "s"}`
          : "One way",
      ].join(" · ")
    : `${formatFlightDate(presentation.departureDate)}${
        presentation.returnDate
          ? ` – ${formatFlightDate(presentation.returnDate)}`
          : " · One way"
      }`;

  return (
    <section className="chat-card-fly-in mt-3 overflow-hidden rounded-2xl border border-cyan-400/20 bg-[#061225]/95 shadow-[0_0_28px_rgba(0,229,255,0.07)]">
      <header className="flex items-center justify-between gap-3 border-b border-cyan-400/12 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-cyan-400/10 text-cyan-300">
            <Plane className="size-4.5" />
          </span>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-cyan-50">
              {presentation.origin} → {presentation.destination}
            </div>
            <div className="truncate text-xs text-cyan-100/50">{tripLabel}</div>
          </div>
        </div>
        {presentation.searchUrl && flexibleOptions.length === 0 && (
          <button
            type="button"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-cyan-400/20 px-2.5 py-1.5 text-xs text-cyan-100/65 transition-colors hover:bg-cyan-400/8 hover:text-cyan-50"
            onClick={() => openUrl(presentation.searchUrl!)}
          >
            Open search <ExternalLink className="size-3.5" />
          </button>
        )}
      </header>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-cyan-400/10 bg-cyan-400/3 px-4 py-2.5 text-xs text-cyan-100/55">
        <span className="inline-flex items-center gap-1.5">
          <Users className="size-3.5 text-cyan-300/70" />
          {passengerLabel}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Plane className="size-3.5 text-cyan-300/70" />
          {formatCabinClass(presentation.cabinClass)}
        </span>
        {presentation.tripLengthNights ? (
          <span className="inline-flex items-center gap-1.5">
            <CalendarDays className="size-3.5 text-cyan-300/70" />
            Return trip
          </span>
        ) : null}
      </div>

      {flexibleOptions.length > 0 ? (
        <div className="p-3">
          <div className="mb-2.5 flex items-baseline justify-between gap-3 px-1">
            <p className="text-xs font-medium text-cyan-50/80">
              Compare departure windows
            </p>
            <p className="text-[10px] text-cyan-100/35">
              Select a date to check current fares
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {flexibleOptions.map((option) => (
              <button
                key={`${option.departureDate}-${option.returnDate ?? "one-way"}`}
                type="button"
                className="group flex items-center justify-between gap-3 rounded-xl border border-cyan-400/14 bg-cyan-400/4 px-3.5 py-3 text-left transition-all hover:-translate-y-0.5 hover:border-cyan-300/35 hover:bg-cyan-400/8 hover:shadow-md"
                onClick={() => openUrl(option.searchUrl)}
              >
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-cyan-50">
                    {formatFlightDate(option.departureDate)}
                  </span>
                  <span className="mt-0.5 block text-xs text-cyan-100/45">
                    {option.returnDate
                      ? `Return ${formatFlightDate(option.returnDate)}`
                      : "One way"}
                  </span>
                </span>
                <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-cyan-300/75 group-hover:text-cyan-200">
                  Check fares
                  <ArrowUpRight className="size-3.5 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="divide-y divide-cyan-400/8">
          {presentation.itineraries.length > 0 ? (
            presentation.itineraries.slice(0, 6).map((itinerary) => {
              const firstLeg = itinerary.legs[0];
              const summary = itinerary.legs
                .map((leg) => leg.carriers.join(", "))
                .filter(Boolean)
                .join(" · ");
              const card = (
                <>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-cyan-50">
                      {summary || "Flight itinerary"}
                    </div>
                    <div className="mt-1 text-xs text-cyan-100/45">
                      {firstLeg
                        ? `${formatDuration(firstLeg.durationMinutes)} · ${
                            firstLeg.stopCount === 0
                              ? "Direct"
                              : `${firstLeg.stopCount} stop${firstLeg.stopCount === 1 ? "" : "s"}`
                          }`
                        : "Itinerary details available at booking"}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-sm font-semibold tabular-nums text-cyan-50">
                      {formatMoney(itinerary.price, presentation.currency)}
                    </span>
                    {itinerary.deepLink && (
                      <ArrowUpRight className="size-4 text-cyan-300/55" />
                    )}
                  </div>
                </>
              );
              return itinerary.deepLink ? (
                <button
                  key={itinerary.id}
                  type="button"
                  className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left hover:bg-cyan-400/5"
                  onClick={() => openUrl(itinerary.deepLink!)}
                >
                  {card}
                </button>
              ) : (
                <div
                  key={itinerary.id}
                  className="flex items-center justify-between gap-4 px-4 py-3"
                >
                  {card}
                </div>
              );
            })
          ) : (
            <p className="px-4 py-4 text-sm text-cyan-100/45">
              {presentation.searchUrl
                ? "Open the search to view current fares and availability."
                : "No flight offers were returned for this route."}
            </p>
          )}
        </div>
      )}
      <footer className="border-t border-cyan-400/10 px-4 py-2 text-[10px] text-cyan-100/35">
        {presentation.notice ??
          `Results from ${presentation.provider ?? "the configured flight provider"} · availability may change`}
      </footer>
    </section>
  );
}

export function ChatAgentResearchResultCard({
  presentation,
}: {
  presentation: ResearchPresentation;
}) {
  if (presentation.kind === "web-search") {
    return (
      <section className="chat-card-fly-in mt-3 overflow-hidden rounded-2xl border border-border/70 bg-card/92 shadow-sm">
        <header className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="grid size-8 place-items-center rounded-lg bg-primary/10 text-primary">
              <Search className="size-4" />
            </span>
            <div className="min-w-0">
              <div className="text-sm font-medium text-foreground">
                Web results
              </div>
              <div className="truncate text-xs text-muted-foreground">
                {presentation.results.length} results · {presentation.query}
              </div>
            </div>
          </div>
          <button
            type="button"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            onClick={() => openUrl(presentation.searchUrl)}
          >
            DuckDuckGo <ExternalLink className="size-3.5" />
          </button>
        </header>
        {presentation.abstract && (
          <p className="border-b border-border/60 px-4 py-3 text-sm leading-relaxed text-foreground/80">
            {presentation.abstract}
          </p>
        )}
        <div className="grid gap-3 p-3 sm:grid-cols-2">
          {presentation.results.length > 0 ? (
            presentation.results.map((result, index) => (
              <button
                key={result.url}
                type="button"
                className="group flex min-h-32 w-full flex-col rounded-xl border border-border/65 bg-background/55 p-3.5 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/35 hover:bg-muted/45 hover:shadow-md"
                onClick={() => openUrl(result.url)}
              >
                <span className="flex w-full min-w-0 items-center gap-2">
                  <span className="grid size-6 shrink-0 place-items-center overflow-hidden rounded-md border border-border/60 bg-muted text-[10px] text-muted-foreground">
                    {result.favicon ? (
                      <img
                        src={result.favicon}
                        alt=""
                        loading="lazy"
                        className="size-4 object-contain"
                        onError={(event) => {
                          event.currentTarget.style.display = "none";
                        }}
                      />
                    ) : (
                      <Globe2 className="size-3.5" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-xs font-medium text-muted-foreground">
                    {result.source ?? result.displayUrl ?? "Web source"}
                  </span>
                  <span className="grid size-5 shrink-0 place-items-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">
                    {index + 1}
                  </span>
                </span>
                <span className="mt-2.5 min-w-0">
                  <span className="line-clamp-2 block text-sm font-semibold leading-snug text-foreground group-hover:text-primary">
                    {result.title}
                  </span>
                  <span className="mt-1.5 line-clamp-2 block text-xs leading-relaxed text-muted-foreground">
                    {result.snippet}
                  </span>
                </span>
                <span className="mt-auto flex w-full items-center justify-between gap-2 pt-3 text-[10px] text-muted-foreground">
                  <span className="truncate">
                    {formatPublishedDate(result.publishedAt) ??
                      result.displayUrl ??
                      result.source}
                  </span>
                  <ArrowUpRight className="size-3.5 shrink-0 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-primary" />
                </span>
              </button>
            ))
          ) : (
            <p className="col-span-full px-1 py-3 text-sm text-muted-foreground">
              No web results were returned. Try a broader search or open
              DuckDuckGo.
            </p>
          )}
        </div>
        {presentation.results.length > 0 && (
          <footer className="border-t border-border/60 px-4 py-2 text-[10px] text-muted-foreground">
            Live results from DuckDuckGo · select a card to open its source
          </footer>
        )}
      </section>
    );
  }

  if (presentation.kind === "crypto-market") {
    return (
      <section className="chat-card-fly-in mt-3 overflow-hidden rounded-2xl border border-cyan-400/20 bg-[#061225]/95 shadow-[0_0_28px_rgba(0,229,255,0.07)]">
        <header className="flex items-center gap-2.5 border-b border-cyan-400/12 px-4 py-3">
          <span className="grid size-8 place-items-center rounded-lg bg-cyan-400/10 text-cyan-300">
            <Coins className="size-4" />
          </span>
          <div>
            <div className="text-sm font-medium text-cyan-50">
              CoinGecko market data
            </div>
            <div className="text-xs text-cyan-100/45">
              {presentation.query} · {presentation.currency}
            </div>
          </div>
        </header>
        <div className="divide-y divide-cyan-400/8">
          {presentation.coins.length > 0 ? (
            presentation.coins.map((coin) => (
              <div
                key={coin.id}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-4 py-3"
              >
                <div className="flex min-w-0 items-center gap-3">
                  {coin.image ? (
                    <img
                      src={coin.image}
                      alt=""
                      className="size-8 shrink-0 rounded-full"
                    />
                  ) : (
                    <span className="grid size-8 shrink-0 place-items-center rounded-full bg-cyan-400/10 text-xs text-cyan-200">
                      {coin.symbol.slice(0, 2)}
                    </span>
                  )}
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-cyan-50">
                      {coin.name}
                    </div>
                    <div className="text-xs uppercase text-cyan-100/40">
                      {coin.symbol}
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-semibold tabular-nums text-cyan-50">
                    {formatMoney(coin.price, presentation.currency)}
                  </div>
                  <div
                    className={`text-xs tabular-nums ${
                      (coin.change24h ?? 0) >= 0
                        ? "text-emerald-400"
                        : "text-rose-400"
                    }`}
                  >
                    {coin.change24h == null
                      ? "24h —"
                      : `${coin.change24h >= 0 ? "+" : ""}${coin.change24h.toFixed(2)}%`}
                  </div>
                  <div className="mt-1 text-[10px] text-cyan-100/35">
                    Cap {formatCompact(coin.marketCap)} · Vol{" "}
                    {formatCompact(coin.volume24h)}
                  </div>
                </div>
              </div>
            ))
          ) : (
            <p className="px-4 py-4 text-sm text-cyan-100/45">
              No matching coins were found.
            </p>
          )}
        </div>
        <footer className="border-t border-cyan-400/10 px-4 py-2 text-[10px] text-cyan-100/35">
          Live market data · prices can change rapidly
        </footer>
      </section>
    );
  }

  if (presentation.kind === "database-result") {
    return <ChatAgentDatabaseResultCard presentation={presentation} />;
  }

  if (presentation.kind === "weather-forecast") {
    return <ChatAgentWeatherCard presentation={presentation} />;
  }

  if (presentation.kind === "map-places") {
    return <ChatAgentMapCard presentation={presentation} />;
  }

  return <FlightSearchCard presentation={presentation} />;
}
