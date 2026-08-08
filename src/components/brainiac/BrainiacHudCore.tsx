import brainiacAvatar from "../../../assets/brainiac/brainiac-live-ai.jpg";
import type { BrainiacVoiceState } from "./brainiac-voice-state";
import { BRAINIAC_VOICE_STATE_LABEL } from "./brainiac-voice-state";
import { cn } from "@/lib/utils";

const RING_TICKS = Array.from({ length: 40 }, (_, i) => i * 9);

const CORE_CALLOUTS = [
  { label: "TARGETING", className: "brainiac-core-callout--top" },
  { label: "SYNAPSE", className: "brainiac-core-callout--right" },
  { label: "ARC BUS", className: "brainiac-core-callout--bottom" },
  { label: "VOICE IO", className: "brainiac-core-callout--left" },
];

export function BrainiacHudCore({
  voiceState,
}: {
  voiceState: BrainiacVoiceState;
}) {
  return (
    <div
      className="brainiac-core"
      data-testid="brainiac-hud-core"
      data-voice-state={voiceState}
    >
      <p className="brainiac-core-interface-label font-jarvis-ui">
        META HUMAN CORE
      </p>

      <div className="brainiac-core-stage">
        <div className="brainiac-core-brackets" aria-hidden>
          <span />
          <span />
          <span />
          <span />
        </div>
        <svg viewBox="0 0 420 420" className="brainiac-core-rings" aria-hidden>
          <g className="brainiac-ring brainiac-ring-gold">
            <circle
              cx="210"
              cy="210"
              r="206"
              fill="none"
              stroke="rgba(245, 199, 100, 0.55)"
              strokeWidth="2.5"
              strokeDasharray="64 260"
              strokeLinecap="round"
            />
            <circle
              cx="210"
              cy="210"
              r="206"
              fill="none"
              stroke="rgba(245, 199, 100, 0.25)"
              strokeWidth="1"
              strokeDasharray="6 18"
            />
          </g>
          {/* Wide segmented band — the reference's chunky mid ring */}
          <g className="brainiac-ring brainiac-ring-band">
            <circle
              cx="210"
              cy="210"
              r="152"
              fill="none"
              stroke="rgba(0, 210, 255, 0.08)"
              strokeWidth="20"
              strokeDasharray="72 26"
            />
            <circle
              cx="210"
              cy="210"
              r="152"
              fill="none"
              stroke="rgba(0, 210, 255, 0.16)"
              strokeWidth="20"
              strokeDasharray="18 80"
              strokeDashoffset="40"
            />
          </g>
          {/* Bright inner arcs hugging the core */}
          <g className="brainiac-ring brainiac-ring-inner-arcs">
            <circle
              cx="210"
              cy="210"
              r="92"
              fill="none"
              stroke="rgba(125, 243, 255, 0.85)"
              strokeWidth="5"
              strokeDasharray="64 514"
              strokeLinecap="round"
            />
            <circle
              cx="210"
              cy="210"
              r="92"
              fill="none"
              stroke="rgba(125, 243, 255, 0.45)"
              strokeWidth="5"
              strokeDasharray="42 536"
              strokeDashoffset="-300"
              strokeLinecap="round"
            />
          </g>
          <g className="brainiac-ring brainiac-ring-a">
            <circle
              cx="210"
              cy="210"
              r="198"
              fill="none"
              stroke="currentColor"
              strokeWidth="0.75"
              strokeDasharray="4 14"
              opacity="0.35"
            />
          </g>
          <g className="brainiac-ring brainiac-ring-b">
            <circle
              cx="210"
              cy="210"
              r="168"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.25"
              strokeDasharray="22 8"
              opacity="0.55"
            />
          </g>
          <g className="brainiac-ring brainiac-ring-c">
            <circle
              cx="210"
              cy="210"
              r="138"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeDasharray="2 10"
              opacity="0.7"
            />
          </g>
          <g className="brainiac-ring brainiac-ring-d">
            <circle
              cx="210"
              cy="210"
              r="108"
              fill="none"
              stroke="currentColor"
              strokeWidth="1"
              strokeDasharray="48 6"
              opacity="0.5"
            />
          </g>
          <g className="brainiac-ring brainiac-ring-e">
            <polygon
              points="210,118 278,155 278,265 210,302 142,265 142,155"
              fill="none"
              stroke="currentColor"
              strokeWidth="1"
              opacity="0.45"
            />
          </g>
          <g className="brainiac-ring brainiac-ring-ticks">
            {RING_TICKS.map((deg) => {
              const angle = (deg * Math.PI) / 180;
              const x1 = 210 + Math.cos(angle) * 184;
              const y1 = 210 + Math.sin(angle) * 184;
              const x2 = 210 + Math.cos(angle) * (deg % 45 === 0 ? 162 : 172);
              const y2 = 210 + Math.sin(angle) * (deg % 45 === 0 ? 162 : 172);
              return (
                <line
                  key={deg}
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke="currentColor"
                  strokeWidth={deg % 45 === 0 ? "1.5" : "0.75"}
                  opacity={deg % 45 === 0 ? "0.6" : "0.28"}
                />
              );
            })}
          </g>
          {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => (
            <line
              key={deg}
              x1="210"
              y1="210"
              x2={210 + Math.cos((deg * Math.PI) / 180) * 88}
              y2={210 + Math.sin((deg * Math.PI) / 180) * 88}
              stroke="currentColor"
              strokeWidth="0.5"
              opacity="0.2"
            />
          ))}
        </svg>

        <div className="brainiac-core-crosshair brainiac-core-crosshair--h" />
        <div className="brainiac-core-crosshair brainiac-core-crosshair--v" />

        <div className="brainiac-core-glow-disc" aria-hidden />
        <div className="brainiac-avatar-wrap">
          <img
            src={brainiacAvatar}
            alt=""
            className="brainiac-avatar"
            draggable={false}
          />
          <div className="brainiac-avatar-scan" aria-hidden />
          {voiceState === "speaking" && (
            <div className="brainiac-voice-pulse" aria-hidden />
          )}
        </div>

        <div
          className="brainiac-core-callouts font-jarvis-ui"
          data-testid="brainiac-core-callouts"
        >
          {CORE_CALLOUTS.map((callout) => (
            <span
              key={callout.label}
              className={cn("brainiac-core-callout", callout.className)}
            >
              {callout.label}
            </span>
          ))}
        </div>
      </div>

      <div className="brainiac-core-halo" />
      <p className="brainiac-core-status font-jarvis-ui">
        {BRAINIAC_VOICE_STATE_LABEL[voiceState]}
      </p>
      <div
        className="brainiac-core-readouts font-jarvis-ui"
        data-testid="brainiac-core-readouts"
      >
        <span>LATENCY 08MS</span>
        <span>VECTORS LOCKED</span>
        <span>VOICE LINK</span>
      </div>
    </div>
  );
}
