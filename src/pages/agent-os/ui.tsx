import type { ComponentType, ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { AgentStatus, LogLevel, TaskStatus } from "./data";

export function GlassCard({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-cyan-400/12 bg-[rgba(8,20,40,0.5)] shadow-[0_0_24px_rgba(0,229,255,0.05),inset_0_1px_0_0_rgba(0,229,255,0.08)] backdrop-blur-xl",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <h2 className="font-jarvis-ui text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300/55">
      {children}
    </h2>
  );
}

/** Consistent empty-state used by views that have no data until agents run. */
export function EmptyState({
  icon: Icon,
  title,
  hint,
  action,
  className,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  hint?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-2xl border border-dashed border-cyan-400/15 bg-[rgba(8,20,40,0.35)] px-6 py-14 text-center",
        className,
      )}
    >
      <span className="grid size-12 place-items-center rounded-2xl border border-cyan-400/20 bg-cyan-500/10 text-cyan-300 shadow-[0_0_24px_rgba(0,229,255,0.12)]">
        <Icon className="size-6" />
      </span>
      <p className="mt-4 font-jarvis-ui text-sm font-semibold tracking-wide text-white/80">
        {title}
      </p>
      {hint && <p className="mt-1 max-w-md text-xs text-white/40">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

const AGENT_STATUS: Record<
  AgentStatus,
  { dot: string; text: string; label: string }
> = {
  online: {
    dot: "bg-emerald-400 shadow-[0_0_10px_2px_rgba(52,211,153,0.5)]",
    text: "text-emerald-300",
    label: "Online",
  },
  idle: { dot: "bg-amber-400", text: "text-amber-300", label: "Idle" },
  offline: { dot: "bg-slate-500", text: "text-slate-400", label: "Offline" },
  error: {
    dot: "bg-rose-500 shadow-[0_0_10px_2px_rgba(244,63,94,0.45)]",
    text: "text-rose-300",
    label: "Error",
  },
};

export function StatusDot({ status }: { status: AgentStatus }) {
  return (
    <span
      className={cn(
        "inline-block size-2 rounded-full",
        AGENT_STATUS[status].dot,
      )}
      aria-hidden
    />
  );
}

export function StatusBadge({ status }: { status: AgentStatus }) {
  const s = AGENT_STATUS[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-xs font-medium",
        s.text,
      )}
    >
      <span className={cn("size-1.5 rounded-full", s.dot)} />
      {s.label}
    </span>
  );
}

const TASK_STATUS: Record<TaskStatus, { text: string; bg: string }> = {
  pending: {
    text: "text-slate-300",
    bg: "bg-slate-400/10 border-slate-400/20",
  },
  running: {
    text: "text-cyan-300",
    bg: "bg-cyan-500/10 border-cyan-400/30",
  },
  completed: {
    text: "text-emerald-300",
    bg: "bg-emerald-500/10 border-emerald-400/30",
  },
  failed: { text: "text-rose-300", bg: "bg-rose-500/10 border-rose-400/30" },
};

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  const s = TASK_STATUS[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium capitalize",
        s.bg,
        s.text,
      )}
    >
      {status === "running" && (
        <span className="size-1.5 animate-pulse rounded-full bg-cyan-400" />
      )}
      {status}
    </span>
  );
}

const LOG_LEVEL: Record<LogLevel, string> = {
  info: "text-sky-300 bg-sky-500/10 border-sky-400/20",
  warning: "text-amber-300 bg-amber-500/10 border-amber-400/20",
  error: "text-rose-300 bg-rose-500/10 border-rose-400/20",
};

export function LogLevelBadge({ level }: { level: LogLevel }) {
  return (
    <span
      className={cn(
        "inline-flex w-16 justify-center rounded-md border px-1.5 py-0.5 text-[11px] font-semibold uppercase",
        LOG_LEVEL[level],
      )}
    >
      {level}
    </span>
  );
}

/** Mini SVG bar chart. */
export function MiniBars({
  data,
  className,
  color = "#00e5ff",
}: {
  data: number[];
  className?: string;
  color?: string;
}) {
  const max = Math.max(...data, 1);
  const w = 100;
  const gap = 2.5;
  const bw = (w - gap * (data.length - 1)) / data.length;
  return (
    <svg
      viewBox={`0 0 ${w} 40`}
      preserveAspectRatio="none"
      className={cn("h-full w-full", className)}
    >
      {data.map((v, i) => {
        const h = (v / max) * 38;
        return (
          <rect
            key={i}
            x={i * (bw + gap)}
            y={40 - h}
            width={bw}
            height={h}
            rx={1}
            fill={color}
            opacity={0.35 + (v / max) * 0.6}
          />
        );
      })}
    </svg>
  );
}

/** SVG area/line chart. */
export function AreaChart({
  data,
  color = "#22c55e",
  className,
}: {
  data: number[];
  color?: string;
  className?: string;
}) {
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const w = 100;
  const h = 40;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((v - min) / (max - min || 1)) * (h - 4) - 2;
    return [x, y] as const;
  });
  const line = pts.map(([x, y]) => `${x},${y}`).join(" ");
  const area = `0,${h} ${line} ${w},${h}`;
  const id = `ao-grad-${color.replace("#", "")}`;
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      className={cn("h-full w-full", className)}
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={area} fill={`url(#${id})`} />
      <polyline
        points={line}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/** SVG donut gauge (0..1). */
export function Donut({
  value,
  color = "#00e5ff",
  label,
  sublabel,
}: {
  value: number;
  color?: string;
  label: string;
  sublabel?: string;
}) {
  const r = 34;
  const c = 2 * Math.PI * r;
  const dash = Math.max(0, Math.min(1, value)) * c;
  return (
    <div className="relative grid size-[92px] place-items-center">
      <svg viewBox="0 0 80 80" className="size-full -rotate-90">
        <circle
          cx="40"
          cy="40"
          r={r}
          fill="none"
          stroke="rgba(255,255,255,0.08)"
          strokeWidth="7"
        />
        <circle
          cx="40"
          cy="40"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${c}`}
        />
      </svg>
      <div className="absolute text-center">
        <div className="text-base font-semibold text-white">{label}</div>
        {sublabel && (
          <div className="text-[10px] text-white/45">{sublabel}</div>
        )}
      </div>
    </div>
  );
}

export const AGENT_TYPE_COLOR: Record<string, string> = {
  Hermes: "text-cyan-300 bg-cyan-500/10 border-cyan-400/25",
  OpenClaw: "text-sky-300 bg-sky-500/10 border-sky-400/25",
  MCP: "text-emerald-300 bg-emerald-500/10 border-emerald-400/25",
  Custom: "text-amber-300 bg-amber-500/10 border-amber-400/25",
};

export function TypeBadge({ type }: { type: string }) {
  return (
    <span
      className={cn(
        "inline-flex rounded-md border px-2 py-0.5 text-[11px] font-medium",
        AGENT_TYPE_COLOR[type] ?? "text-white/60 bg-white/5 border-white/10",
      )}
    >
      {type}
    </span>
  );
}
