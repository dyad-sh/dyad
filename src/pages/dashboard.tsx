import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Activity, MapPin, Loader2 } from "lucide-react";

import { ParticleBackground } from "@/components/home/ParticleBackground";
import {
  JarvisOrb,
  type JarvisOrbState,
} from "@/components/dashboard/JarvisOrb";
import {
  WeatherIcon,
  weatherCondition,
} from "@/components/weather/weather_presentation";
import {
  useDashboardConditions,
  useDashboardState,
} from "@/hooks/useDashboardState";
import type { HealthTone } from "@/lib/dashboard/system_health";
import { formatRatio, formatReadout } from "@/lib/dashboard/readout";
import { cn } from "@/lib/utils";

const TONE_DOT: Record<HealthTone, string> = {
  healthy: "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]",
  attention: "bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.8)]",
  offline: "bg-rose-400 shadow-[0_0_8px_rgba(251,113,133,0.8)]",
  unknown: "bg-slate-500",
};

const TONE_TEXT: Record<HealthTone, string> = {
  healthy: "text-emerald-300",
  attention: "text-amber-300",
  offline: "text-rose-300",
  unknown: "text-slate-400",
};

/**
 * A heading in the HUD's voice.
 *
 * The rule running to the right of it is the instrument-panel detail that
 * makes a label read as a channel heading rather than a card title.
 */
function PanelTitle({
  children,
  index,
}: {
  children: React.ReactNode;
  /** The channel number on the right, when there is a count worth showing. */
  index?: string;
}) {
  return (
    <div className="mb-2 flex shrink-0 items-center gap-2">
      <h2 className="text-[10px] font-semibold tracking-[0.28em] text-cyan-100/55">
        {children}
      </h2>
      <span className="h-px flex-1 bg-gradient-to-r from-cyan-400/25 to-transparent" />
      {index && (
        <span className="font-mono text-[10px] text-cyan-100/30">{index}</span>
      )}
    </div>
  );
}

/**
 * A panel that keeps its overflow to itself.
 *
 * The dashboard is one screen with no page scroll, so a list that outgrows its
 * panel scrolls inside it rather than pushing the orb off the bottom.
 */
function Panel({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("hud-panel flex min-h-0 flex-col p-4", className)}>
      {children}
    </section>
  );
}

/**
 * The local clock.
 *
 * Ticks on its own so the time stays right without the page being revisited,
 * and formats through the OS locale rather than a format chosen here.
 */
function useNow(): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  return now;
}

function greetingFor(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function TimePanel() {
  const now = useNow();

  const time = useMemo(
    () =>
      now.toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
      }),
    [now],
  );
  const weekday = now.toLocaleDateString(undefined, { weekday: "long" });
  const date = now.toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const seconds = now.toLocaleTimeString(undefined, { second: "2-digit" });

  return (
    <div data-testid="dashboard-clock">
      <p className="text-sm text-cyan-100/60">
        {greetingFor(now.getHours())}, {weekday}
      </p>
      {/* Scales with the window's height so a short window shrinks the clock
          rather than losing the panel below it. */}
      <p className="mt-1 flex items-baseline gap-2">
        <span className="text-[clamp(2.5rem,7vh,3.75rem)] leading-none font-semibold tracking-tight text-cyan-50 tabular-nums">
          {time}
        </span>
        {/* Seconds set apart: they are the part that proves the clock is live
            without making the hour harder to read. */}
        <span className="font-mono text-sm text-cyan-300/50 tabular-nums">
          {seconds.padStart(2, "0")}
        </span>
      </p>
      <p className="mt-1.5 text-xs tracking-[0.2em] text-cyan-100/50 uppercase">
        {weekday} · {date}
      </p>
    </div>
  );
}

/** One number and its label, in the readout row under the orb. */
function Readout({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className="font-mono text-sm text-cyan-100/85 tabular-nums">
        {value}
      </span>
      <span className="text-[9px] tracking-[0.18em] text-cyan-100/35">
        {label}
      </span>
    </div>
  );
}

function ConditionsPanel() {
  const { data, isLoading } = useDashboardConditions();

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-cyan-100/40">
        <Loader2 className="size-4 animate-spin" />
        Locating…
      </div>
    );
  }

  const location = data?.location;
  const weather = data?.weather;

  return (
    <div className="text-right" data-testid="dashboard-conditions">
      {location ? (
        <>
          <p className="flex items-center justify-end gap-1.5 text-lg font-medium text-cyan-50">
            <MapPin className="size-4 text-cyan-300/70" />
            {location.name}
          </p>
          <p className="text-xs text-cyan-100/45">
            {[location.admin1, location.country].filter(Boolean).join(", ")}
            {/* Said plainly, because a guess presented as a fact is worse than
                no location at all. */}
            {location.source === "timezone" && " · from timezone"}
          </p>
        </>
      ) : (
        <p className="text-sm text-cyan-100/40">Location unavailable</p>
      )}

      {weather ? (
        <div className="mt-3 flex items-start justify-end gap-3">
          <div className="text-right">
            <p className="text-3xl font-semibold text-cyan-50">
              {Math.round(weather.temperature)}
              {weather.units.temperature}
            </p>
            <p className="text-xs tracking-wider text-cyan-100/50 uppercase">
              {weatherCondition(weather.weatherCode)}
            </p>
            <p className="mt-1 text-[11px] text-cyan-100/35">
              {weather.apparentTemperature !== null &&
                `Feels ${Math.round(weather.apparentTemperature)}${weather.units.temperature}`}
              {weather.humidity !== null &&
                ` · ${Math.round(weather.humidity)}%`}
              {weather.windSpeed !== null &&
                ` · ${Math.round(weather.windSpeed)} ${weather.units.windSpeed}`}
            </p>
          </div>
          <WeatherIcon
            code={weather.weatherCode}
            isDay={weather.isDay}
            className="size-9 text-cyan-200/80"
          />
        </div>
      ) : (
        <p className="mt-3 text-xs text-cyan-100/35">
          {data?.unavailableReason ?? "Weather unavailable"}
        </p>
      )}
    </div>
  );
}

export default function DashboardPage() {
  const { health, overall, services, activity, metrics } = useDashboardState();

  /**
   * The orb's state, from what is actually known.
   *
   * Ready means the app can answer: at least one AI provider is configured.
   * Anything else is offline, which is the truth rather than a friendlier word
   * for it.
   */
  const orbState: JarvisOrbState = useMemo(() => {
    const providers = health.find((row) => row.id === "providers");
    if (!providers || providers.tone === "unknown") return "processing";
    return providers.tone === "healthy" ? "ready" : "offline";
  }, [health]);

  return (
    <div className="home-jarvis hud-frame relative flex min-h-0 w-full flex-1 flex-col overflow-hidden">
      <ParticleBackground className="z-0" />
      {/* One screen. The page itself never scrolls; anything that outgrows its
          panel scrolls inside that panel. */}
      <div className="relative z-10 flex min-h-0 flex-1 flex-col gap-3 overflow-hidden px-5 py-4 sm:px-7">
        {/* Title row: what this is, and whether it is well. */}
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-cyan-400/10 pb-2">
          <div className="flex items-center gap-3">
            <h1 className="text-xs font-semibold tracking-[0.35em] text-cyan-100/60">
              META HUMAN OS
            </h1>
            <span className="hidden font-mono text-[10px] tracking-widest text-cyan-100/25 sm:inline">
              // COMMAND CENTER
            </span>
          </div>
          <p
            className={cn(
              "flex items-center gap-2 font-mono text-xs font-medium tracking-wider uppercase",
              TONE_TEXT[overall.tone],
            )}
            data-testid="dashboard-overall-status"
          >
            <span
              className={cn(
                "size-2 rounded-full",
                TONE_DOT[overall.tone],
                overall.tone !== "healthy" &&
                  "motion-safe:animate-[pulse_1.8s_ease-in-out_infinite]",
              )}
            />
            {overall.message}
          </p>
        </div>

        {/* Three columns on a wide window: when and where on the left, the orb
            in the middle, what is connected on the right. Narrower windows
            stack them, and each column keeps its own overflow. */}
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)_minmax(0,1fr)]">
          <div className="flex min-h-0 flex-col gap-3">
            <Panel className="shrink-0">
              <TimePanel />
            </Panel>

            <Panel className="min-h-0 flex-1">
              <PanelTitle index={`${health.length}`}>SYSTEM HEALTH</PanelTitle>
              <ul
                className="min-h-0 flex-1 space-y-0.5 overflow-y-auto"
                data-testid="dashboard-health"
              >
                {health.map((row) => (
                  <li key={row.id}>
                    <Link
                      to={row.to}
                      className="flex items-center gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-cyan-500/8"
                    >
                      <span
                        className={cn(
                          "size-2 shrink-0 rounded-full",
                          TONE_DOT[row.tone],
                        )}
                      />
                      <span className="flex-1 truncate text-sm text-cyan-50/90">
                        {row.label}
                      </span>
                      <span
                        className={cn("shrink-0 text-xs", TONE_TEXT[row.tone])}
                      >
                        {row.status}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Panel>
          </div>

          {/* The centrepiece, given the middle of the screen to itself, with
              the machine's own counts read out beneath it. */}
          <div className="flex min-h-0 flex-col items-center justify-center gap-4">
            <JarvisOrb
              state={orbState}
              detail={
                orbState === "offline"
                  ? "No AI provider configured yet"
                  : undefined
              }
            />

            <div
              className="flex items-center gap-5 border-t border-cyan-400/10 pt-3"
              data-testid="dashboard-readouts"
            >
              <Readout
                label="NODES"
                value={formatRatio(metrics.devicesHealthy, metrics.devices)}
              />
              <Readout label="SOURCES" value={formatReadout(metrics.sources)} />
              <Readout label="CHUNKS" value={formatReadout(metrics.chunks)} />
              <Readout
                label="COLLECTIONS"
                value={formatReadout(metrics.collections)}
              />
            </div>

            {metrics.embeddingModel && (
              <p className="font-mono text-[10px] tracking-widest text-cyan-100/25">
                EMBED · {metrics.embeddingModel.toUpperCase()}
              </p>
            )}
          </div>

          <div className="flex min-h-0 flex-col gap-3">
            <Panel className="shrink-0">
              <ConditionsPanel />
            </Panel>

            <Panel className="min-h-0 flex-1">
              <PanelTitle index={`${services.length}`}>
                CONNECTED SERVICES
              </PanelTitle>
              {services.length === 0 ? (
                <p className="px-2 py-1.5 text-sm text-cyan-100/35">
                  Nothing connected yet.
                </p>
              ) : (
                <ul
                  className="min-h-0 flex-1 space-y-0.5 overflow-y-auto"
                  data-testid="dashboard-services"
                >
                  {services.map((service) => (
                    <li key={service.id}>
                      <Link
                        to={service.to}
                        className="flex items-center gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-cyan-500/8"
                      >
                        <span className="size-2 shrink-0 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
                        <span className="flex-1 truncate text-sm text-cyan-50/90">
                          {service.name}
                        </span>
                        {service.detail && (
                          <span className="shrink-0 text-xs text-cyan-100/35">
                            {service.detail}
                          </span>
                        )}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        </div>

        {/* Activity, only where something already records it. A strip along the
            bottom: it is the least urgent thing here, so it gets one line. */}
        {activity.length > 0 && (
          <Panel className="shrink-0">
            <PanelTitle>RECENT ACTIVITY</PanelTitle>
            <ul
              className="flex gap-2 overflow-x-auto"
              data-testid="dashboard-activity"
            >
              {activity.slice(0, 4).map((entry) => (
                <li
                  key={entry.id}
                  className="flex min-w-0 shrink-0 items-center gap-2 rounded-lg border border-cyan-400/10 bg-cyan-500/5 px-3 py-1.5 text-xs"
                >
                  <Activity className="size-3.5 shrink-0 text-cyan-300/50" />
                  <span className="max-w-64 truncate text-cyan-50/80">
                    {entry.message}
                  </span>
                  <span className="shrink-0 text-cyan-100/30">
                    {new Date(entry.at).toLocaleTimeString(undefined, {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </li>
              ))}
            </ul>
          </Panel>
        )}
      </div>
    </div>
  );
}
