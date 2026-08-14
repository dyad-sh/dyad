import { useId } from "react";

import { cn } from "@/lib/utils";

/**
 * The dashboard's centrepiece.
 *
 * Visual infrastructure: it shows a state and nothing else. There is no
 * microphone here, no speech, no wake word and no agent — those are a later
 * job, and the point of building the orb now is that the later job can attach
 * to it without the dashboard being redesigned around it.
 *
 * When that happens, `state` gains its own values and `onActivate` becomes a
 * real interaction. Everything else about this component stays put.
 *
 * Drawn as SVG rather than stacked divs: the tick ring, the segmented arcs and
 * the sweep need real geometry, and one element per ring keeps a detailed
 * picture cheap to animate — every moving part is a transform on a group.
 */

export type JarvisOrbState = "ready" | "processing" | "offline";

const STATE_LABEL: Record<JarvisOrbState, string> = {
  ready: "Ready",
  processing: "Processing",
  offline: "Offline",
};

/** Evenly spaced marks around a circle, longer every fifth. */
function tickMarks(count: number, radius: number, length: number) {
  return Array.from({ length: count }, (_, index) => {
    const angle = (index / count) * Math.PI * 2;
    const long = index % 5 === 0;
    const inner = radius - (long ? length * 1.9 : length);
    return {
      key: index,
      x1: 100 + Math.cos(angle) * radius,
      y1: 100 + Math.sin(angle) * radius,
      x2: 100 + Math.cos(angle) * inner,
      y2: 100 + Math.sin(angle) * inner,
      long,
    };
  });
}

/** An arc, as a path, from one angle to another. */
function arcPath(radius: number, fromDeg: number, toDeg: number) {
  const from = (fromDeg * Math.PI) / 180;
  const to = (toDeg * Math.PI) / 180;
  const large = toDeg - fromDeg > 180 ? 1 : 0;
  return [
    `M ${100 + Math.cos(from) * radius} ${100 + Math.sin(from) * radius}`,
    `A ${radius} ${radius} 0 ${large} 1`,
    `${100 + Math.cos(to) * radius} ${100 + Math.sin(to) * radius}`,
  ].join(" ");
}

const TICKS = tickMarks(60, 92, 3);

export function JarvisOrb({
  state,
  detail,
  className,
}: {
  state: JarvisOrbState;
  /** One short line under the state, when there is something true to say. */
  detail?: string;
  className?: string;
}) {
  // Ids must be unique per instance: two orbs on one page would otherwise
  // share a gradient and the second would inherit the first's.
  const uid = useId().replace(/:/g, "");
  const isOffline = state === "offline";

  const line = isOffline ? "rgb(148 163 184)" : "rgb(103 232 249)";

  return (
    <div
      className={cn("flex flex-col items-center gap-3", className)}
      data-testid="jarvis-orb"
      data-state={state}
    >
      {/* Sized against the viewport height, not a fixed width: the dashboard
          fits on one screen, so the orb has to give way when the window is
          short rather than pushing everything else off the bottom. */}
      <div className="relative grid size-[clamp(8rem,26vh,15rem)] place-items-center">
        <svg
          viewBox="0 0 200 200"
          className={cn(
            "size-full",
            !isOffline &&
              // The app's existing orb breathing, reused rather than a second
              // keyframe that does the same thing slightly differently.
              "drop-shadow-[0_0_18px_rgba(34,211,238,0.28)] motion-safe:animate-[jarvis-orb-breathe_6s_ease-in-out_infinite]",
          )}
          aria-hidden="true"
        >
          <defs>
            <radialGradient id={`${uid}-core`}>
              <stop
                offset="0%"
                stopColor="#ecfeff"
                stopOpacity={isOffline ? 0.35 : 0.95}
              />
              <stop
                offset="55%"
                stopColor="#22d3ee"
                stopOpacity={isOffline ? 0.2 : 0.7}
              />
              <stop
                offset="100%"
                stopColor="#0e7490"
                stopOpacity={isOffline ? 0.1 : 0.35}
              />
            </radialGradient>
            {/* The radar sweep: opaque at its leading edge, gone by its tail. */}
            <linearGradient id={`${uid}-sweep`} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor={line} stopOpacity="0.32" />
              <stop offset="100%" stopColor={line} stopOpacity="0" />
            </linearGradient>
            <filter id={`${uid}-glow`}>
              <feGaussianBlur stdDeviation="4" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Tick ring: the outermost detail, turning slowly. */}
          <g
            className="motion-safe:animate-[spin_60s_linear_infinite]"
            style={{ transformOrigin: "100px 100px" }}
          >
            {TICKS.map((tick) => (
              <line
                key={tick.key}
                x1={tick.x1}
                y1={tick.y1}
                x2={tick.x2}
                y2={tick.y2}
                stroke={line}
                strokeWidth={tick.long ? 1.1 : 0.6}
                strokeOpacity={tick.long ? 0.55 : 0.25}
              />
            ))}
          </g>

          {/* Segmented ring, turning the other way. */}
          <g
            className="motion-safe:animate-[spin_28s_linear_infinite_reverse]"
            style={{ transformOrigin: "100px 100px" }}
          >
            <circle
              cx="100"
              cy="100"
              r="80"
              fill="none"
              stroke={line}
              strokeWidth="1"
              strokeOpacity="0.3"
              strokeDasharray="34 12 6 12"
            />
            <path
              d={arcPath(80, -140, -100)}
              fill="none"
              stroke={line}
              strokeWidth="2.5"
              strokeOpacity={isOffline ? 0.3 : 0.75}
              strokeLinecap="round"
            />
          </g>

          {/* Bracket arcs: the pair that reads as a frame around the core. */}
          <g
            className="motion-safe:animate-[spin_20s_linear_infinite]"
            style={{ transformOrigin: "100px 100px" }}
          >
            <path
              d={arcPath(66, 20, 110)}
              fill="none"
              stroke={line}
              strokeWidth="1.6"
              strokeOpacity="0.5"
              strokeLinecap="round"
            />
            <path
              d={arcPath(66, 200, 290)}
              fill="none"
              stroke={line}
              strokeWidth="1.6"
              strokeOpacity="0.5"
              strokeLinecap="round"
            />
          </g>

          {/* The sweep, only while there is something to sweep for. */}
          {!isOffline && (
            <g
              className="motion-safe:animate-[spin_4.5s_linear_infinite]"
              style={{ transformOrigin: "100px 100px" }}
            >
              <path
                d={`M 100 100 L 152 100 A 52 52 0 0 0 126 55 Z`}
                fill={`url(#${uid}-sweep)`}
              />
            </g>
          )}

          {/* Reticle: four marks on the axes, still, so the movement around
              them has something to be measured against. */}
          <g stroke={line} strokeOpacity="0.45" strokeWidth="1">
            <line x1="100" y1="44" x2="100" y2="52" />
            <line x1="100" y1="148" x2="100" y2="156" />
            <line x1="44" y1="100" x2="52" y2="100" />
            <line x1="148" y1="100" x2="156" y2="100" />
          </g>

          <circle
            cx="100"
            cy="100"
            r="48"
            fill="none"
            stroke={line}
            strokeWidth="0.8"
            strokeOpacity="0.25"
          />

          {/* Core. */}
          <circle
            cx="100"
            cy="100"
            r="30"
            fill={`url(#${uid}-core)`}
            filter={isOffline ? undefined : `url(#${uid}-glow)`}
            className={cn(
              state === "processing" &&
                "motion-safe:animate-[pulse_1.6s_ease-in-out_infinite]",
            )}
          />
          <circle
            cx="100"
            cy="100"
            r="30"
            fill="none"
            stroke={line}
            strokeWidth="1"
            strokeOpacity="0.6"
          />
        </svg>
      </div>

      <div className="text-center">
        <p className="text-[10px] font-semibold tracking-[0.45em] text-cyan-100/60">
          META HUMAN OS
        </p>
        <p
          className={cn(
            "mt-1 font-mono text-xs tracking-[0.2em]",
            isOffline ? "text-slate-400" : "text-cyan-200",
          )}
        >
          <span className="opacity-40">[</span>{" "}
          {STATE_LABEL[state].toUpperCase()}{" "}
          <span className="opacity-40">]</span>
        </p>
        {detail && (
          <p className="text-muted-foreground mt-1 max-w-56 text-xs">
            {detail}
          </p>
        )}
      </div>
    </div>
  );
}
