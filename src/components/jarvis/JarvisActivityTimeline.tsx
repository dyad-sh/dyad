import { useState } from "react";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  CircleDashed,
  Loader2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { JarvisActivityEvent } from "@/ipc/types/jarvis";

const STATUS_STYLES: Record<
  JarvisActivityEvent["status"],
  { icon: typeof Check; className: string }
> = {
  queued: { icon: CircleDashed, className: "text-cyan-200/40" },
  running: { icon: Loader2, className: "text-cyan-300 animate-spin" },
  success: { icon: Check, className: "text-emerald-300/80" },
  warning: { icon: AlertTriangle, className: "text-amber-300/80" },
  failed: { icon: X, className: "text-rose-300/80" },
};

function formatTime(timestamp: string) {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
}

function formatDuration(durationMs?: number) {
  if (durationMs == null) return null;
  if (durationMs < 1000) return `${Math.round(durationMs)}ms`;
  return `${(durationMs / 1000).toFixed(1)}s`;
}

function ActivityRow({ event }: { event: JarvisActivityEvent }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const { icon: Icon, className } = STATUS_STYLES[event.status];
  const duration = formatDuration(event.durationMs);
  const hasDetails =
    !!event.summary ||
    (event.metadata && Object.keys(event.metadata).length > 0);

  const content = (
    <>
      <Icon className={cn("mt-0.5 size-3.5 shrink-0", className)} />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="truncate text-xs text-cyan-50/90">
            {event.title}
          </span>
          {duration && (
            <span className="shrink-0 font-mono text-[10px] text-cyan-100/35">
              {duration}
            </span>
          )}
        </span>
        {isExpanded && event.summary && (
          <span className="mt-1 block text-[11px] leading-relaxed text-cyan-100/50">
            {event.summary}
          </span>
        )}
      </span>
      <span className="shrink-0 font-mono text-[10px] text-cyan-100/30">
        {formatTime(event.timestamp)}
      </span>
    </>
  );

  if (!hasDetails) {
    return <li className="flex items-start gap-2 px-3 py-1.5">{content}</li>;
  }

  return (
    <li>
      <button
        type="button"
        onClick={() => setIsExpanded((previous) => !previous)}
        aria-expanded={isExpanded}
        className="flex w-full items-start gap-2 rounded px-3 py-1.5 text-left hover:bg-cyan-400/5 focus-visible:ring-1 focus-visible:ring-cyan-400/50 focus-visible:outline-none"
      >
        {content}
      </button>
    </li>
  );
}

/**
 * Live timeline of operational steps. Shows only safe operational
 * information — never hidden reasoning.
 */
export function JarvisActivityTimeline({
  events,
  defaultOpen = true,
}: {
  events: JarvisActivityEvent[];
  defaultOpen?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const visible = events.filter((event) => event.isUserVisible);

  return (
    <section className="jarvis-panel rounded-xl">
      <button
        type="button"
        onClick={() => setIsOpen((previous) => !previous)}
        aria-expanded={isOpen}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left focus-visible:ring-1 focus-visible:ring-cyan-400/50 focus-visible:outline-none"
      >
        {isOpen ? (
          <ChevronDown className="size-3.5 text-cyan-300/60" />
        ) : (
          <ChevronRight className="size-3.5 text-cyan-300/60" />
        )}
        <span className="font-jarvis-ui text-xs tracking-widest text-cyan-300/70 uppercase">
          Activity
        </span>
        <span className="ml-auto font-mono text-[10px] text-cyan-100/30">
          {visible.length}
        </span>
      </button>

      {isOpen && (
        <div className="max-h-64 overflow-y-auto border-t border-cyan-400/10 py-1">
          {visible.length === 0 ? (
            <p className="px-3 py-3 text-xs text-cyan-100/35">
              No activity yet.
            </p>
          ) : (
            <ol className="space-y-0.5">
              {visible.map((event) => (
                <ActivityRow key={event.id} event={event} />
              ))}
            </ol>
          )}
        </div>
      )}
    </section>
  );
}
