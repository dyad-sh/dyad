import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useSetAtom } from "jotai";
import { Activity, MapPin, Loader2 } from "lucide-react";

import {
  activeAgentWorkspaceTabAtom,
  agentWorkspaceTabsAtom,
} from "@/atoms/chatAgentAtoms";
import { useAgentOsAgents } from "@/hooks/useAgentOsAgents";
import { openHermesWorkspaceTab } from "@/lib/hermes_workspace_tabs";
import {
  dashboardAgents,
  isAgentReachable,
  reachableAgentCount,
} from "@/lib/dashboard/dashboard_agents";
import { StatusDot } from "@/pages/agent-os/ui";
import type { Agent } from "@/pages/agent-os/data";

import { ParticleBackground } from "@/components/home/ParticleBackground";
import { SystemHealthHologram } from "@/components/dashboard/SystemHealthHologram";
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

/**
 * The label at the head of a row of pills.
 *
 * Fixed width so the rows line up down the left edge, which is what makes a
 * loose collection of pills read as instrumentation.
 */
function ChannelLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="w-14 shrink-0 text-[10px] font-semibold tracking-[0.22em] text-cyan-100/40">
      {children}
    </span>
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
  const { health, overall, services, activity, metrics, notificationsEnabled } =
    useDashboardState();
  const navigate = useNavigate();
  const { agents } = useAgentOsAgents();
  const setWorkspaceTabs = useSetAtom(agentWorkspaceTabsAtom);
  const setActiveWorkspaceTab = useSetAtom(activeAgentWorkspaceTabAtom);

  const hermesAgents = useMemo(() => dashboardAgents(agents), [agents]);

  /**
   * Opens the agent's chat the way the Agents page does.
   *
   * The same workspace-tab atoms, so the chat that appears is the one that was
   * already there rather than a second way into it.
   */
  const openAgent = (agent: Agent) => {
    setWorkspaceTabs((current) =>
      openHermesWorkspaceTab(current, {
        id: agent.id,
        name: agent.name,
        icon: agent.icon || "🪽",
      }),
    );
    setActiveWorkspaceTab(agent.id);
    void navigate({ to: "/agent-os" });
  };

  return (
    <div className="home-jarvis hud-frame relative flex min-h-0 w-full flex-1 flex-col overflow-hidden">
      <ParticleBackground className="z-0" />
      {/* One screen. The page itself never scrolls; anything that outgrows its
          panel scrolls inside that panel. */}
      <div className="relative z-10 flex min-h-0 flex-1 flex-col gap-3 overflow-hidden px-5 py-4 sm:px-7">
        {/* Title row: what this is, and whether it is well. The name belongs to
            the orb now, so this says what the screen is instead. */}
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-cyan-400/10 pb-2">
          <h1 className="text-xs font-semibold tracking-[0.35em] text-cyan-100/60">
            COMMAND CENTER
          </h1>
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

        {/* When and where, in the top corners as bare readouts. No panels: a
            box either side of the orb is what made this look heavy, and this
            information is legible without one. */}
        <div className="flex shrink-0 items-start justify-between gap-6">
          <TimePanel />
          <ConditionsPanel />
        </div>

        {/* Operational centrepiece: health, alerts and live capacity replace
            the decorative orb, using only state the owning screens report. */}
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto scrollbar-on-hover">
          <SystemHealthHologram
            health={health}
            overall={overall}
            metrics={metrics}
            agentsOnline={reachableAgentCount(hermesAgents)}
            agentTotal={hermesAgents.length}
            connectionCount={services.length}
            activity={activity}
            notificationsEnabled={notificationsEnabled}
          />
        </div>

        {/* Agents, connections and activity remain as compact channels beneath
            the central health matrix. */}
        <div className="shrink-0 space-y-2 border-t border-cyan-400/10 pt-3">
          {/* The registered Hermes agents. A pill opens that agent's chat,
              through the same tabs the Agents page uses. */}
          {hermesAgents.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <ChannelLabel>AGENTS</ChannelLabel>
              <ul
                className="flex max-h-16 flex-wrap items-center gap-2 overflow-y-auto"
                data-testid="dashboard-agents"
              >
                {hermesAgents.map((agent) => (
                  <li key={agent.id}>
                    <button
                      type="button"
                      onClick={() => openAgent(agent)}
                      className="hud-pill"
                      title={`${agent.name} · ${agent.model || agent.type} · last active ${agent.lastActivity}`}
                      data-testid={`dashboard-agent-${agent.id}`}
                    >
                      <StatusDot status={agent.status} />
                      <span
                        className={cn(
                          // An unreachable agent is still listed, just not
                          // dressed up as one you can use.
                          isAgentReachable(agent.status)
                            ? "text-cyan-50/85"
                            : "text-cyan-50/40",
                        )}
                      >
                        {agent.name}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              <span className="font-mono text-[10px] text-cyan-100/25">
                {reachableAgentCount(hermesAgents)}/{hermesAgents.length}
              </span>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <ChannelLabel>LINKED</ChannelLabel>
            {services.length === 0 ? (
              <p className="text-xs text-cyan-100/35">Nothing connected yet.</p>
            ) : (
              <ul
                className="flex max-h-16 flex-wrap items-center gap-2 overflow-y-auto"
                data-testid="dashboard-services"
              >
                {services.map((service) => (
                  <li key={service.id}>
                    <Link
                      to={service.to}
                      className="hud-pill"
                      title={service.detail}
                    >
                      <span className="size-1.5 shrink-0 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]" />
                      <span className="text-cyan-50/85">{service.name}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Activity, only where something already records it. One line: it is
              the least urgent thing on the screen. */}
          {activity.length > 0 && (
            <div className="flex items-center gap-3">
              <ChannelLabel>LOG</ChannelLabel>
              <ul
                className="flex min-w-0 flex-1 items-center gap-4 overflow-x-auto"
                data-testid="dashboard-activity"
              >
                {activity.slice(0, 3).map((entry) => (
                  <li
                    key={entry.id}
                    className="flex shrink-0 items-center gap-2 text-xs"
                  >
                    <Activity className="size-3 shrink-0 text-cyan-300/40" />
                    <span className="max-w-64 truncate text-cyan-50/60">
                      {entry.message}
                    </span>
                    <span className="font-mono text-[10px] text-cyan-100/25">
                      {new Date(entry.at).toLocaleTimeString(undefined, {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
