import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Activity as ActivityIcon,
  AlertTriangle,
  Boxes,
  CheckCircle2,
  ChevronRight,
  KeyRound,
  Loader2,
  Moon,
  Power,
  Send,
  Zap,
} from "lucide-react";

import { ipc } from "@/ipc/types";
import { cn } from "@/lib/utils";
import type { Agent, AgentStatus } from "../data";
import { StatusBadge, TypeBadge } from "../ui";

const ARCH_FLOW = [
  "Dashboard UI",
  "API Layer",
  "Shared Memory",
  "Agent Router",
  "Agents",
];

const STATUS_META: Record<
  AgentStatus,
  { label: string; bar: string; text: string }
> = {
  online: {
    label: "Online",
    bar: "bg-emerald-400",
    text: "text-emerald-300",
  },
  idle: { label: "Idle", bar: "bg-amber-400", text: "text-amber-300" },
  offline: { label: "Offline", bar: "bg-slate-500", text: "text-slate-400" },
  error: { label: "Error", bar: "bg-rose-500", text: "text-rose-300" },
};

/** Gold-tracked HUD section label. */
function HudLabel({ children }: { children: ReactNode }) {
  return (
    <h2 className="aos-stark-label font-jarvis-ui text-[11px] font-semibold uppercase tracking-[0.24em]">
      {children}
    </h2>
  );
}

/** Iron Man power readout: 12 charge segments lit by `fraction`. */
function PowerSegments({
  fraction,
  accent,
}: {
  fraction: number;
  accent: string;
}) {
  const lit = Math.round(Math.max(0, Math.min(1, fraction)) * 12);
  return (
    <div className="flex gap-[3px]">
      {Array.from({ length: 12 }, (_, i) => (
        <span
          key={i}
          className="h-2 flex-1 rounded-[2px]"
          style={
            i < lit
              ? {
                  background: accent,
                  boxShadow: `0 0 8px ${accent}66`,
                  opacity: 0.45 + (i / 12) * 0.55,
                }
              : { background: "rgba(255,255,255,0.07)" }
          }
        />
      ))}
    </div>
  );
}

/** KPI "power cell" with icon, value and a segmented charge bar. */
function PowerCell({
  label,
  value,
  sub,
  icon: Icon,
  accent,
  fraction,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: typeof Boxes;
  accent: string;
  fraction: number;
}) {
  return (
    <div className="aos-hud-panel p-3.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-jarvis-ui text-[10px] font-semibold uppercase tracking-[0.18em] text-white/40">
            {label}
          </p>
          <p
            className="mt-1 font-jarvis-display text-2xl font-semibold tracking-tight text-white"
            style={{ textShadow: `0 0 18px ${accent}55` }}
          >
            {value}
          </p>
          {sub && (
            <p className="mt-0.5 truncate text-[11px] text-white/40">{sub}</p>
          )}
        </div>
        <div
          className="grid size-8 shrink-0 place-items-center rounded-lg border border-white/10"
          style={{ background: `${accent}1a`, color: accent }}
        >
          <Icon className="size-4" />
        </div>
      </div>
      <div className="mt-3">
        <PowerSegments fraction={fraction} accent={accent} />
      </div>
    </div>
  );
}

/**
 * The arc reactor — fleet integrity gauge. Rotating segmented rings around a
 * pulsing core, with the integrity arc drawn at the outer radius.
 */
function ArcReactor({
  online,
  total,
  errors,
}: {
  online: number;
  total: number;
  errors: number;
}) {
  const integrity = total > 0 ? online / total : 0;
  const pct = Math.round(integrity * 100);
  const R = 96;
  const C = 2 * Math.PI * R;
  const critical = errors > 0;

  return (
    <div className="relative mx-auto grid size-64 place-items-center sm:size-72">
      <svg viewBox="0 0 240 240" className="aos-reactor-glow size-full">
        <defs>
          <radialGradient id="aos-core-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#d8fbff" stopOpacity="0.95" />
            <stop offset="40%" stopColor="#00e5ff" stopOpacity="0.6" />
            <stop offset="100%" stopColor="#00e5ff" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="aos-integrity" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#00e5ff" />
            <stop offset="100%" stopColor="#34d399" />
          </linearGradient>
        </defs>

        {/* Outer tick ring */}
        <g
          className="aos-reactor-ring--slow"
          style={{ transformOrigin: "120px 120px" }}
        >
          {Array.from({ length: 60 }, (_, i) => {
            const angle = (i / 60) * Math.PI * 2;
            const long = i % 5 === 0;
            const r1 = long ? 108 : 112;
            return (
              <line
                key={i}
                x1={120 + Math.cos(angle) * r1}
                y1={120 + Math.sin(angle) * r1}
                x2={120 + Math.cos(angle) * 117}
                y2={120 + Math.sin(angle) * 117}
                stroke="rgba(0,229,255,0.5)"
                strokeWidth={long ? 1.6 : 0.8}
                opacity={long ? 0.85 : 0.4}
              />
            );
          })}
        </g>

        {/* Integrity arc */}
        <circle
          cx="120"
          cy="120"
          r={R}
          fill="none"
          stroke="rgba(255,255,255,0.07)"
          strokeWidth="5"
        />
        <circle
          cx="120"
          cy="120"
          r={R}
          fill="none"
          stroke="url(#aos-integrity)"
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={`${integrity * C} ${C}`}
          transform="rotate(-90 120 120)"
          style={{ transition: "stroke-dasharray 0.8s ease" }}
        />

        {/* Mid segmented ring */}
        <g
          className="aos-reactor-ring--mid"
          style={{ transformOrigin: "120px 120px" }}
        >
          <circle
            cx="120"
            cy="120"
            r="80"
            fill="none"
            stroke="rgba(0,229,255,0.45)"
            strokeWidth="7"
            strokeDasharray="34 18"
            opacity="0.55"
          />
        </g>

        {/* Inner fast ring */}
        <g
          className="aos-reactor-ring--fast"
          style={{ transformOrigin: "120px 120px" }}
        >
          <circle
            cx="120"
            cy="120"
            r="62"
            fill="none"
            stroke={critical ? "rgba(244,63,94,0.55)" : "rgba(245,199,100,0.5)"}
            strokeWidth="2.5"
            strokeDasharray="10 14"
          />
        </g>

        {/* Reactor core */}
        <circle
          cx="120"
          cy="120"
          r="52"
          fill="url(#aos-core-glow)"
          className="aos-reactor-core"
        />
        <circle
          cx="120"
          cy="120"
          r="34"
          fill="rgba(2,8,18,0.88)"
          stroke="rgba(0,229,255,0.5)"
          strokeWidth="1.5"
        />
        {Array.from({ length: 8 }, (_, i) => {
          const angle = (i / 8) * Math.PI * 2 + Math.PI / 8;
          return (
            <line
              key={i}
              x1={120 + Math.cos(angle) * 36}
              y1={120 + Math.sin(angle) * 36}
              x2={120 + Math.cos(angle) * 48}
              y2={120 + Math.sin(angle) * 48}
              stroke="rgba(0,229,255,0.8)"
              strokeWidth="3.5"
              strokeLinecap="round"
              opacity="0.8"
            />
          );
        })}
      </svg>

      {/* Center readout */}
      <div className="absolute text-center">
        <div className="font-jarvis-display text-4xl font-semibold tracking-tight text-white [text-shadow:0_0_24px_rgba(0,229,255,0.6)]">
          {pct}
          <span className="text-xl text-cyan-300/80">%</span>
        </div>
        <div className="font-jarvis-ui text-[9px] uppercase tracking-[0.32em] text-cyan-300/65">
          Fleet integrity
        </div>
        <div className="mt-0.5 text-[11px] tabular-nums text-white/45">
          {online}/{total} online
        </div>
      </div>
    </div>
  );
}

export function DashboardView({
  agents,
  isLoading,
}: {
  agents: Agent[];
  isLoading: boolean;
}) {
  const counts = {
    online: agents.filter((a) => a.status === "online").length,
    idle: agents.filter((a) => a.status === "idle").length,
    offline: agents.filter((a) => a.status === "offline").length,
    error: agents.filter((a) => a.status === "error").length,
  };
  const enabled = agents.filter((a) => a.enabled).length;
  const connected = agents.filter((a) => a.hasApiKey).length;
  const total = agents.length;

  const [prompt, setPrompt] = useState("");
  const [targetId, setTargetId] = useState("");
  const [run, setRun] = useState<{
    status: "idle" | "running" | "completed" | "error";
    output: string;
    ms: number;
  }>({ status: "idle", output: "", ms: 0 });
  const runStreamId = useRef<string | null>(null);

  // Keep a valid target selected as agents load/change.
  useEffect(() => {
    if (agents.length === 0) {
      setTargetId("");
    } else if (!agents.some((a) => a.id === targetId)) {
      setTargetId(agents[0].id);
    }
  }, [agents, targetId]);

  // Cancel an in-flight command if the dashboard unmounts.
  useEffect(() => {
    return () => {
      const id = runStreamId.current;
      if (id) {
        ipc.agentOsChatStream.cancel(id);
        ipc.agentOs.chatCancel(id).catch(() => {});
      }
    };
  }, []);

  const handleRun = () => {
    const trimmed = prompt.trim();
    if (!trimmed || run.status === "running") return;
    const agent = agents.find((a) => a.id === targetId);
    if (!agent) return;
    setPrompt("");
    const start = Date.now();
    const streamId = `aosc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    runStreamId.current = streamId;
    setRun({ status: "running", output: "", ms: 0 });
    ipc.agentOsChatStream.start(
      {
        streamId,
        agentId: agent.id,
        messages: [{ role: "user", content: trimmed }],
      },
      {
        onChunk: ({ delta }) =>
          setRun((prev) => ({
            ...prev,
            output: prev.output + delta,
            ms: Date.now() - start,
          })),
        onEnd: ({ content }) => {
          setRun((prev) => ({
            status: "completed",
            output:
              content ||
              prev.output ||
              "(the endpoint returned an empty response)",
            ms: Date.now() - start,
          }));
          runStreamId.current = null;
        },
        onError: ({ error }) => {
          setRun({ status: "error", output: error, ms: Date.now() - start });
          runStreamId.current = null;
        },
      },
    );
  };

  return (
    <div className="space-y-5">
      {/* Telemetry rail: routing pipeline */}
      <div className="aos-hud-panel flex flex-wrap items-center gap-x-2 gap-y-1.5 px-4 py-2.5">
        <span className="aos-stark-label font-jarvis-ui text-[10px] font-semibold uppercase tracking-[0.24em]">
          Routing
        </span>
        {ARCH_FLOW.map((step, i) => (
          <span key={step} className="flex items-center gap-2">
            <span
              className={
                i === 0
                  ? "rounded-lg border border-cyan-400/30 bg-cyan-500/10 px-2.5 py-1 font-jarvis-ui text-xs font-medium text-cyan-200"
                  : i === ARCH_FLOW.length - 1
                    ? "rounded-lg border border-emerald-400/30 bg-emerald-500/10 px-2.5 py-1 font-jarvis-ui text-xs font-medium text-emerald-200"
                    : "rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 font-jarvis-ui text-xs text-white/75"
              }
            >
              {step}
            </span>
            {i < ARCH_FLOW.length - 1 && (
              <ChevronRight className="size-3.5 text-cyan-400/50" />
            )}
          </span>
        ))}
        <span className="ml-auto hidden font-mono text-[10px] uppercase tracking-[0.18em] text-white/30 lg:block">
          Isolated channel · the dashboard never talks to agents directly
        </span>
      </div>

      {/* Hero: power cells · arc reactor · fleet diagnostics */}
      <div className="grid items-stretch gap-4 xl:grid-cols-[1fr_minmax(300px,auto)_1fr]">
        {/* Power cells */}
        <div className="grid grid-cols-2 content-start gap-3">
          <PowerCell
            label="Total Agents"
            value={String(total)}
            sub={`${enabled} enabled`}
            icon={Boxes}
            accent="#00e5ff"
            fraction={total > 0 ? enabled / total : 0}
          />
          <PowerCell
            label="Online"
            value={String(counts.online)}
            sub="ready to run"
            icon={Zap}
            accent="#34d399"
            fraction={total > 0 ? counts.online / total : 0}
          />
          <PowerCell
            label="Idle"
            value={String(counts.idle)}
            sub="standing by"
            icon={Moon}
            accent="#f5c764"
            fraction={total > 0 ? counts.idle / total : 0}
          />
          <PowerCell
            label="Enabled"
            value={String(enabled)}
            sub={`${total - enabled} disabled`}
            icon={Power}
            accent="#00e5ff"
            fraction={total > 0 ? enabled / total : 0}
          />
        </div>

        {/* Arc reactor */}
        <div className="aos-hud-panel aos-hud-panel--sweep flex flex-col items-center justify-center px-6 py-5">
          <ArcReactor
            online={counts.online}
            total={total}
            errors={counts.error}
          />
          <div className="mt-1 flex items-center gap-4 font-jarvis-ui text-[10px] uppercase tracking-[0.2em] text-white/40">
            <span className="inline-flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.7)]" />
              Core stable
            </span>
            <span
              className={cn(
                "inline-flex items-center gap-1.5",
                counts.error > 0 && "text-rose-300",
              )}
            >
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  counts.error > 0
                    ? "animate-pulse bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.7)]"
                    : "bg-white/20",
                )}
              />
              {counts.error > 0 ? `${counts.error} fault(s)` : "No faults"}
            </span>
          </div>
        </div>

        {/* Fleet diagnostics */}
        <div className="flex flex-col gap-3">
          <div className="aos-hud-panel flex-1 p-4">
            <HudLabel>Fleet Status</HudLabel>
            <div className="mt-3 space-y-3">
              {(Object.keys(STATUS_META) as AgentStatus[]).map((s) => {
                const n = counts[s];
                const meta = STATUS_META[s];
                return (
                  <div key={s} className="space-y-1">
                    <div className="flex items-center justify-between font-jarvis-ui text-xs">
                      <span className={meta.text}>{meta.label}</span>
                      <span className="tabular-nums text-white/45">{n}</span>
                    </div>
                    <div className="flex gap-[3px]">
                      {Array.from({ length: 14 }, (_, i) => {
                        const lit =
                          total > 0 && i < Math.round((n / total) * 14);
                        return (
                          <span
                            key={i}
                            className={cn(
                              "h-1.5 flex-1 rounded-[2px]",
                              lit ? meta.bar : "bg-white/6",
                            )}
                          />
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <PowerCell
            label="Errors"
            value={String(counts.error)}
            sub={counts.error > 0 ? "needs attention" : "all healthy"}
            icon={AlertTriangle}
            accent={counts.error > 0 ? "#f43f5e" : "#34d399"}
            fraction={total > 0 ? counts.error / total : 0}
          />
          <PowerCell
            label="Connected"
            value={String(connected)}
            sub="API key set"
            icon={KeyRound}
            accent="#f5c764"
            fraction={total > 0 ? connected / total : 0}
          />
        </div>
      </div>

      {/* Command deck + telemetry feed */}
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="aos-hud-panel aos-hud-panel--sweep p-5 xl:col-span-2">
          <div className="flex items-center justify-between">
            <HudLabel>Direct Command</HudLabel>
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-cyan-300/45">
              routed via agent router
            </span>
          </div>
          <div className="mt-3 rounded-xl border border-cyan-400/15 bg-black/35 p-3 shadow-[inset_0_0_18px_rgba(0,229,255,0.04)]">
            <div className="flex items-start gap-2">
              <span className="mt-0.5 select-none font-mono text-sm text-cyan-300/70">
                ❯
              </span>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleRun();
                  }
                }}
                rows={3}
                placeholder={
                  agents.length === 0
                    ? "Register an agent first to route a command…"
                    : "Ask an agent to perform a task..."
                }
                disabled={agents.length === 0}
                className="w-full resize-none bg-transparent font-mono text-sm text-white outline-none placeholder:text-white/30 disabled:opacity-60"
                data-testid="agent-os-command-input"
              />
            </div>
            <div className="mt-2 flex items-center justify-between gap-2">
              <select
                value={targetId}
                onChange={(e) => setTargetId(e.target.value)}
                disabled={agents.length === 0}
                className="rounded-lg border border-cyan-400/20 bg-white/5 px-2.5 py-1.5 font-jarvis-ui text-xs text-white/80 outline-none disabled:opacity-50"
              >
                {agents.length === 0 ? (
                  <option className="bg-[#0a1628]">No agents</option>
                ) : (
                  agents.map((a) => (
                    <option key={a.id} value={a.id} className="bg-[#0a1628]">
                      {a.icon} {a.name}
                    </option>
                  ))
                )}
              </select>
              <button
                type="button"
                onClick={handleRun}
                disabled={
                  agents.length === 0 ||
                  !prompt.trim() ||
                  run.status === "running"
                }
                className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-cyan-500 to-emerald-500 px-3.5 py-1.5 font-jarvis-ui text-sm font-medium text-white shadow-[0_0_18px_rgba(0,229,255,0.35)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {run.status === "running" ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Send className="size-3.5" />
                )}
                {run.status === "running" ? "Running" : "Execute"}
              </button>
            </div>
          </div>
        </div>

        <div className="aos-hud-panel flex flex-col p-5">
          <div className="flex items-center justify-between">
            <HudLabel>Response Feed</HudLabel>
            <span
              className={
                run.status === "running"
                  ? "inline-flex items-center gap-1.5 font-jarvis-ui text-xs text-cyan-300"
                  : run.status === "completed"
                    ? "inline-flex items-center gap-1.5 font-jarvis-ui text-xs text-emerald-300"
                    : run.status === "error"
                      ? "inline-flex items-center gap-1.5 font-jarvis-ui text-xs text-rose-300"
                      : "font-jarvis-ui text-xs text-white/30"
              }
            >
              {run.status === "running" && (
                <span className="size-1.5 animate-pulse rounded-full bg-cyan-400" />
              )}
              {run.status === "idle" ? "Standby" : run.status}
            </span>
          </div>
          <pre
            className={
              run.status === "error"
                ? "mt-3 min-h-24 flex-1 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-rose-400/30 bg-rose-500/10 p-3 font-mono text-[12px] leading-relaxed text-rose-200"
                : "mt-3 min-h-24 flex-1 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-cyan-400/15 bg-black/35 p-3 font-mono text-[12px] leading-relaxed text-white/80"
            }
          >
            {run.status === "running" && !run.output
              ? "Sending request to the agent endpoint…"
              : run.output || "Responses from the agent endpoint appear here."}
            {run.status === "running" && (
              <span className="aos-console-caret ml-0.5 inline-block h-3.5 w-1.5 bg-cyan-400 align-middle" />
            )}
          </pre>
          <div className="mt-3 grid grid-cols-2 gap-2 text-center">
            <div className="rounded-lg border border-cyan-400/15 bg-white/5 py-1.5">
              <div className="font-jarvis-display text-sm font-semibold text-white">
                {(run.ms / 1000).toFixed(1)}s
              </div>
              <div className="font-jarvis-ui text-[10px] uppercase tracking-[0.16em] text-white/40">
                round-trip
              </div>
            </div>
            <div className="rounded-lg border border-cyan-400/15 bg-white/5 py-1.5">
              <div className="font-jarvis-display text-sm font-semibold capitalize text-white">
                {run.status === "idle" ? "—" : run.status}
              </div>
              <div className="font-jarvis-ui text-[10px] uppercase tracking-[0.16em] text-white/40">
                status
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Agent registry + system log */}
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="aos-hud-panel p-5 xl:col-span-2">
          <div className="flex items-center justify-between">
            <HudLabel>Agent Registry</HudLabel>
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/30">
              {total} registered
            </span>
          </div>
          {!isLoading && agents.length === 0 ? (
            <p className="mt-4 text-sm text-white/40">
              No agents registered. Add one from the Agents tab to populate this
              overview.
            </p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="text-left font-jarvis-ui text-[10px] uppercase tracking-[0.2em] text-cyan-300/45">
                    <th className="pb-2 font-medium">Agent</th>
                    <th className="pb-2 font-medium">Status</th>
                    <th className="pb-2 font-medium">Type</th>
                    <th className="pb-2 font-medium">Model</th>
                    <th className="pb-2 font-medium">Last Activity</th>
                    <th className="pb-2 text-right font-medium">Tasks</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-cyan-400/8">
                  {agents.map((a) => (
                    <tr key={a.id} className="aos-holo-row text-white/80">
                      <td className="py-2.5 pl-1.5">
                        <div className="flex items-center gap-2.5">
                          <span className="grid size-8 place-items-center rounded-lg border border-cyan-400/15 bg-white/5 text-base">
                            {a.icon}
                          </span>
                          <div className="min-w-0">
                            <div className="truncate font-medium text-white">
                              {a.name}
                            </div>
                            <div className="truncate font-mono text-[11px] text-white/35">
                              {a.endpoint || "no endpoint"}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="py-2.5">
                        <StatusBadge status={a.status} />
                      </td>
                      <td className="py-2.5">
                        <TypeBadge type={a.type} />
                      </td>
                      <td className="py-2.5 font-mono text-[12px] text-white/55">
                        {a.model || "—"}
                      </td>
                      <td className="py-2.5 text-white/45">{a.lastActivity}</td>
                      <td className="py-2.5 pr-1.5 text-right tabular-nums text-white/70">
                        {a.taskCount.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="aos-hud-panel p-5">
          <HudLabel>System Log</HudLabel>
          {agents.length === 0 ? (
            <div className="mt-3 flex items-center gap-2.5 text-sm text-white/40">
              <ActivityIcon className="size-4 text-white/30" />
              Activity will appear here as agents run.
            </div>
          ) : (
            <div className="mt-3 space-y-3">
              {[...agents]
                .sort((a, b) => (a.name > b.name ? 1 : -1))
                .slice(0, 6)
                .map((a) => (
                  <div key={a.id} className="flex gap-2.5 text-sm">
                    <div className="mt-0.5">
                      {a.status === "error" ? (
                        <AlertTriangle className="size-4 text-rose-400" />
                      ) : a.enabled ? (
                        <CheckCircle2 className="size-4 text-emerald-400" />
                      ) : (
                        <ActivityIcon className="size-4 text-cyan-400" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="leading-snug text-white/75">
                        <span className="font-medium text-white">{a.name}</span>{" "}
                        {a.status === "error"
                          ? "reported an error"
                          : a.enabled
                            ? "registered and enabled"
                            : "is disabled"}
                      </p>
                      <span className="font-mono text-[11px] text-white/30">
                        {a.lastActivity}
                      </span>
                    </div>
                  </div>
                ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
