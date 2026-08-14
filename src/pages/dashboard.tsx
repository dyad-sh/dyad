import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Activity, MapPin, Loader2 } from "lucide-react";

import { PageContainer } from "@/components/PageContainer";
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

/** A heading in the HUD's voice: small, spaced, quiet. */
function PanelTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-3 text-[10px] font-semibold tracking-[0.28em] text-cyan-100/45">
      {children}
    </h2>
  );
}

function Panel({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "rounded-2xl border border-cyan-400/15 bg-[rgba(5,16,31,0.55)] p-5 backdrop-blur",
        className,
      )}
    >
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

  return (
    <div data-testid="dashboard-clock">
      <p className="text-sm text-cyan-100/60">
        {greetingFor(now.getHours())}, {weekday}
      </p>
      <p className="mt-1 text-6xl leading-none font-semibold tracking-tight text-cyan-50 tabular-nums">
        {time}
      </p>
      <p className="mt-2 text-xs tracking-[0.2em] text-cyan-100/50 uppercase">
        {weekday} · {date}
      </p>
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
  const { health, overall, services, activity } = useDashboardState();

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
    <div className="home-jarvis relative flex min-h-0 w-full flex-1 flex-col overflow-hidden">
      <ParticleBackground className="z-0" />
      <div
        className="relative z-10 flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto"
        data-reset-scroll-on-route
      >
        <PageContainer size="xl" className="py-6">
          {/* Title row: what this is, and whether it is well. */}
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-xs font-semibold tracking-[0.35em] text-cyan-100/50">
              META HUMAN OS
            </h1>
            <p
              className={cn(
                "flex items-center gap-2 text-xs font-medium tracking-wider uppercase",
                TONE_TEXT[overall.tone],
              )}
              data-testid="dashboard-overall-status"
            >
              <span
                className={cn("size-2 rounded-full", TONE_DOT[overall.tone])}
              />
              {overall.message}
            </p>
          </div>

          {/* Where and when. */}
          <div className="mb-8 flex flex-wrap items-start justify-between gap-6">
            <TimePanel />
            <ConditionsPanel />
          </div>

          {/* The centrepiece. */}
          <div className="mb-10 flex justify-center">
            <JarvisOrb
              state={orbState}
              detail={
                orbState === "offline"
                  ? "No AI provider configured yet"
                  : undefined
              }
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel>
              <PanelTitle>SYSTEM HEALTH</PanelTitle>
              <ul className="space-y-1" data-testid="dashboard-health">
                {health.map((row) => (
                  <li key={row.id}>
                    <Link
                      to={row.to}
                      className="flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-cyan-500/8"
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

            <Panel>
              <PanelTitle>CONNECTED SERVICES</PanelTitle>
              {services.length === 0 ? (
                <p className="px-2 py-2 text-sm text-cyan-100/35">
                  Nothing connected yet.
                </p>
              ) : (
                <ul className="space-y-1" data-testid="dashboard-services">
                  {services.map((service) => (
                    <li key={service.id}>
                      <Link
                        to={service.to}
                        className="flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-cyan-500/8"
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

          {/* Activity, only where something already records it. */}
          {activity.length > 0 && (
            <Panel className="mt-4">
              <PanelTitle>RECENT ACTIVITY</PanelTitle>
              <ul className="space-y-2" data-testid="dashboard-activity">
                {activity.slice(0, 6).map((entry) => (
                  <li
                    key={entry.id}
                    className="flex items-start gap-3 px-2 text-sm"
                  >
                    <Activity className="mt-0.5 size-3.5 shrink-0 text-cyan-300/50" />
                    <span className="flex-1 text-cyan-50/80">
                      {entry.message}
                    </span>
                    <span className="shrink-0 text-xs text-cyan-100/30">
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
        </PageContainer>
      </div>
    </div>
  );
}
