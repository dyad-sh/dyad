import { Link } from "@tanstack/react-router";
import {
  Activity,
  Bell,
  BellOff,
  CheckCircle2,
  Cpu,
  Radio,
  ShieldAlert,
  Sparkles,
  Users,
} from "lucide-react";

import type { VectorActivity } from "@/ipc/types/vector";
import type { HealthRow, HealthTone } from "@/lib/dashboard/system_health";
import { formatRatio, formatReadout } from "@/lib/dashboard/readout";
import { cn } from "@/lib/utils";

const TONE_STYLE: Record<HealthTone, string> = {
  healthy: "text-emerald-300 border-emerald-400/20 bg-emerald-400/7",
  attention: "text-amber-300 border-amber-400/20 bg-amber-400/7",
  offline: "text-rose-300 border-rose-400/20 bg-rose-400/7",
  unknown: "text-slate-400 border-slate-400/15 bg-slate-400/5",
};

const TONE_DOT: Record<HealthTone, string> = {
  healthy: "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.75)]",
  attention: "bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.75)]",
  offline: "bg-rose-400 shadow-[0_0_8px_rgba(251,113,133,0.75)]",
  unknown: "bg-slate-500",
};

export type DashboardNotice = {
  id: string;
  label: string;
  detail: string;
  tone: HealthTone | "info";
  to?: string;
  at?: string;
};

export function buildDashboardNotifications(
  health: HealthRow[],
  activity: VectorActivity[],
): DashboardNotice[] {
  const healthNotices = health
    .filter((row) => row.tone === "offline" || row.tone === "attention")
    .map((row) => ({
      id: `health-${row.id}`,
      label: row.label,
      detail: row.status,
      tone: row.tone,
      to: row.to,
    }));
  const activityNotices = activity.slice(0, 3).map((entry) => ({
    id: `activity-${entry.id}`,
    label: entry.tone === "warning" ? "System event" : "Recent activity",
    detail: entry.message,
    tone: entry.tone === "warning" ? ("attention" as const) : ("info" as const),
    at: entry.at,
  }));
  return [...healthNotices, ...activityNotices].slice(0, 5);
}

function StatTile({
  icon: Icon,
  value,
  label,
  accent,
}: {
  icon: typeof Activity;
  value: string;
  label: string;
  accent: string;
}) {
  return (
    <div className="group relative overflow-hidden rounded-xl border border-cyan-400/12 bg-cyan-950/16 px-3 py-2.5">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-300/30 to-transparent" />
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="font-mono text-lg leading-none font-semibold text-cyan-50 tabular-nums">
            {value}
          </p>
          <p className="mt-1 text-[9px] font-semibold tracking-[0.18em] text-cyan-100/35 uppercase">
            {label}
          </p>
        </div>
        <span
          className={cn("grid size-8 place-items-center rounded-lg", accent)}
        >
          <Icon className="size-3.5" />
        </span>
      </div>
    </div>
  );
}

function NoticeRow({ notice }: { notice: DashboardNotice }) {
  const content = (
    <div className="flex min-w-0 items-center gap-2.5 rounded-lg border border-cyan-400/8 bg-cyan-950/12 px-2.5 py-2 transition-colors hover:border-cyan-300/20 hover:bg-cyan-400/5">
      <span
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          notice.tone === "info" ? "bg-cyan-400" : TONE_DOT[notice.tone],
        )}
      />
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-medium text-cyan-50/80">
          {notice.label}
        </p>
        <p className="truncate text-[10px] text-cyan-100/35">{notice.detail}</p>
      </div>
      {notice.at && (
        <span className="shrink-0 font-mono text-[9px] text-cyan-100/25">
          {new Date(notice.at).toLocaleTimeString(undefined, {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
      )}
    </div>
  );
  return notice.to ? <Link to={notice.to}>{content}</Link> : content;
}

export function SystemHealthHologram({
  health,
  overall,
  metrics,
  agentsOnline,
  agentTotal,
  connectionCount,
  activity,
  notificationsEnabled,
}: {
  health: HealthRow[];
  overall: { tone: HealthTone; message: string };
  metrics: {
    devices: number | null;
    devicesHealthy: number | null;
    collections: number | null;
    sources: number | null;
    chunks: number | null;
    embeddingModel: string | null;
  };
  agentsOnline: number;
  agentTotal: number;
  connectionCount: number;
  activity: VectorActivity[];
  notificationsEnabled: boolean;
}) {
  const notices = buildDashboardNotifications(health, activity);
  const actionCount = health.filter(
    (row) => row.tone === "attention" || row.tone === "offline",
  ).length;
  const healthyCount = health.filter((row) => row.tone === "healthy").length;
  const hasUnknownHealth = health.some((row) => row.tone === "unknown");

  return (
    <section
      className="relative flex w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-cyan-300/16 bg-[#03101d]/72 shadow-[0_0_70px_-34px_rgba(34,211,238,0.55)] backdrop-blur-xl"
      data-testid="dashboard-system-hologram"
    >
      <div className="pointer-events-none absolute inset-0 opacity-30 [background-image:linear-gradient(rgba(34,211,238,0.06)_1px,transparent_1px),linear-gradient(90deg,rgba(34,211,238,0.05)_1px,transparent_1px)] [background-size:28px_28px]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-cyan-400/7 to-transparent" />

      <header className="relative flex items-center justify-between gap-4 border-b border-cyan-400/10 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span className="grid size-8 place-items-center rounded-lg border border-cyan-300/20 bg-cyan-400/8 text-cyan-300">
            <Cpu className="size-4" />
          </span>
          <div>
            <h2 className="text-xs font-semibold tracking-[0.24em] text-cyan-50/85 uppercase">
              System health matrix
            </h2>
            <p className="mt-0.5 text-[10px] text-cyan-100/35">
              Live readings from connected Meta Human OS services
            </p>
          </div>
        </div>
        <span
          className={cn(
            "inline-flex items-center gap-2 rounded-full border px-2.5 py-1 font-mono text-[9px] tracking-wider uppercase",
            TONE_STYLE[overall.tone],
          )}
        >
          <span
            className={cn("size-1.5 rounded-full", TONE_DOT[overall.tone])}
          />
          {overall.message}
        </span>
      </header>

      <div className="relative grid grid-cols-2 gap-2.5 p-3 sm:grid-cols-4">
        <StatTile
          icon={CheckCircle2}
          value={`${healthyCount}/${health.length}`}
          label="Healthy systems"
          accent="bg-emerald-400/10 text-emerald-300"
        />
        <StatTile
          icon={ShieldAlert}
          value={String(actionCount)}
          label="Needs attention"
          accent={
            actionCount > 0
              ? "bg-amber-400/10 text-amber-300"
              : "bg-cyan-400/8 text-cyan-300"
          }
        />
        <StatTile
          icon={Users}
          value={`${agentsOnline}/${agentTotal}`}
          label="Agents online"
          accent="bg-violet-400/10 text-violet-300"
        />
        <StatTile
          icon={Radio}
          value={String(connectionCount)}
          label="Live connections"
          accent="bg-cyan-400/8 text-cyan-300"
        />
      </div>

      <div className="relative grid min-h-0 gap-3 px-3 pb-3 md:grid-cols-[1.08fr_0.92fr]">
        <div className="min-h-0 rounded-xl border border-cyan-400/10 bg-[#020b15]/44 p-2.5">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[9px] font-semibold tracking-[0.2em] text-cyan-100/40 uppercase">
              Core services
            </p>
            <Sparkles className="size-3 text-cyan-300/35" />
          </div>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {health.map((row) => (
              <Link
                key={row.id}
                to={row.to}
                className="flex min-w-0 items-center gap-2 rounded-lg border border-cyan-400/8 bg-cyan-950/10 px-2.5 py-2 transition-colors hover:border-cyan-300/20 hover:bg-cyan-400/5"
                title={`${row.label}: ${row.status}`}
              >
                <span
                  className={cn(
                    "size-1.5 shrink-0 rounded-full",
                    TONE_DOT[row.tone],
                  )}
                />
                <span className="min-w-0 flex-1 truncate text-[11px] text-cyan-50/70">
                  {row.label}
                </span>
                <span
                  className={cn(
                    "shrink-0 text-[9px]",
                    TONE_STYLE[row.tone].split(" ")[0],
                  )}
                >
                  {row.status}
                </span>
              </Link>
            ))}
          </div>
        </div>

        <div className="min-h-0 rounded-xl border border-cyan-400/10 bg-[#020b15]/44 p-2.5">
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="text-[9px] font-semibold tracking-[0.2em] text-cyan-100/40 uppercase">
              Action centre
            </p>
            <span className="inline-flex items-center gap-1.5 text-[9px] text-cyan-100/35">
              {notificationsEnabled ? (
                <Bell className="size-3 text-emerald-300/70" />
              ) : (
                <BellOff className="size-3 text-amber-300/70" />
              )}
              OS alerts {notificationsEnabled ? "on" : "muted"}
            </span>
          </div>
          <div className="space-y-1.5">
            {notices.length > 0 ? (
              notices.map((notice) => (
                <NoticeRow key={notice.id} notice={notice} />
              ))
            ) : (
              <div className="flex min-h-20 flex-col items-center justify-center rounded-lg border border-emerald-400/10 bg-emerald-400/4 text-center">
                {hasUnknownHealth ? (
                  <Activity className="size-5 text-cyan-300/55" />
                ) : (
                  <CheckCircle2 className="size-5 text-emerald-300/65" />
                )}
                <p className="mt-1.5 text-[11px] font-medium text-emerald-200/70">
                  {hasUnknownHealth
                    ? "Waiting for health reports"
                    : "No system notifications"}
                </p>
                <p className="text-[9px] text-cyan-100/30">
                  {hasUnknownHealth
                    ? "The action centre will update as services respond."
                    : "Everything currently reporting is clear."}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      <footer className="relative grid grid-cols-4 border-t border-cyan-400/10 bg-cyan-950/12">
        {[
          ["Nodes", formatRatio(metrics.devicesHealthy, metrics.devices)],
          ["Sources", formatReadout(metrics.sources)],
          ["Chunks", formatReadout(metrics.chunks)],
          ["Collections", formatReadout(metrics.collections)],
        ].map(([label, value], index) => (
          <div
            key={label}
            className={cn(
              "px-2 py-2 text-center",
              index > 0 && "border-l border-cyan-400/8",
            )}
          >
            <p className="font-mono text-xs font-medium text-cyan-100/75 tabular-nums">
              {value}
            </p>
            <p className="mt-0.5 text-[8px] tracking-[0.17em] text-cyan-100/25 uppercase">
              {label}
            </p>
          </div>
        ))}
      </footer>
    </section>
  );
}
