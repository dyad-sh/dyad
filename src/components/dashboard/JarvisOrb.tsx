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
 */

export type JarvisOrbState = "ready" | "processing" | "offline";

const STATE_LABEL: Record<JarvisOrbState, string> = {
  ready: "Ready",
  processing: "Processing",
  offline: "Offline",
};

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
  const isOffline = state === "offline";

  return (
    <div
      className={cn("flex flex-col items-center gap-4", className)}
      data-testid="jarvis-orb"
      data-state={state}
    >
      <div className="relative grid size-44 place-items-center sm:size-52">
        {/* Rings. Each turns at its own rate so the movement reads as depth
            rather than one spinning object. Motion is disabled outright for
            anyone who asked for less of it. */}
        <span
          className={cn(
            "absolute inset-0 rounded-full border border-cyan-400/25",
            "motion-safe:animate-[spin_28s_linear_infinite]",
            isOffline && "border-slate-500/20",
          )}
          style={{
            borderTopColor: "transparent",
            borderBottomColor: "transparent",
          }}
        />
        <span
          className={cn(
            "absolute inset-4 rounded-full border border-cyan-300/20",
            "motion-safe:animate-[spin_18s_linear_infinite_reverse]",
            isOffline && "border-slate-500/15",
          )}
          style={{
            borderLeftColor: "transparent",
            borderRightColor: "transparent",
          }}
        />
        <span
          className={cn(
            "absolute inset-9 rounded-full border border-cyan-200/15",
            "motion-safe:animate-[spin_40s_linear_infinite]",
            isOffline && "border-slate-500/10",
          )}
          style={{ borderTopColor: "transparent" }}
        />

        {/* Glow. Kept to one soft halo: the brief asks for restraint. */}
        <span
          className={cn(
            "absolute inset-10 rounded-full blur-2xl",
            isOffline ? "bg-slate-500/10" : "bg-cyan-400/25",
            state === "processing" &&
              "motion-safe:animate-[pulse_2s_ease-in-out_infinite]",
          )}
        />

        {/* Core. */}
        <span
          className={cn(
            "relative size-16 rounded-full sm:size-20",
            isOffline
              ? "bg-gradient-to-br from-slate-400/30 to-slate-600/20"
              : "bg-gradient-to-br from-cyan-200/90 via-cyan-400/70 to-teal-500/60",
            !isOffline && "shadow-[0_0_40px_-4px_rgba(34,211,238,0.55)]",
            state === "processing" &&
              "motion-safe:animate-[pulse_1.6s_ease-in-out_infinite]",
          )}
        />
      </div>

      <div className="text-center">
        <p className="text-xs font-semibold tracking-[0.35em] text-cyan-100/70">
          JARVIS
        </p>
        <p
          className={cn(
            "mt-1 text-sm font-medium tracking-wide",
            isOffline ? "text-slate-400" : "text-cyan-200",
          )}
        >
          {STATE_LABEL[state].toUpperCase()}
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
