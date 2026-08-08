import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  Boxes,
  CalendarDays,
  Code2,
  LayoutGrid,
  MessageSquare,
} from "lucide-react";
import { BrainiacBackground } from "@/components/brainiac/BrainiacBackground";
import { BrainiacHudCore } from "@/components/brainiac/BrainiacHudCore";
import { BrainiacHudPanels } from "@/components/brainiac/BrainiacHudPanels";
import type { BrainiacVoiceState } from "@/components/brainiac/brainiac-voice-state";
import { BrainiacVoiceControls } from "@/components/brainiac/BrainiacVoiceControls";
import { BrainiacWaveform } from "@/components/brainiac/BrainiacWaveform";

const agentDeck = [
  { label: "Chat", icon: MessageSquare, to: "/chat-agent" },
  { label: "Coder", icon: Code2, to: "/coder" },
  { label: "Planner", icon: CalendarDays, to: "/planner" },
  { label: "Agent OS", icon: Boxes, to: "/agent-os" },
  { label: "Apps", icon: LayoutGrid, to: "/apps" },
] as const;

function useHudClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

export default function BrainiacPage() {
  const [voiceState, setVoiceState] = useState<BrainiacVoiceState>("idle");
  const timeoutsRef = useRef<number[]>([]);
  const clock = useHudClock();

  const clearScheduled = useCallback(() => {
    for (const id of timeoutsRef.current) {
      window.clearTimeout(id);
    }
    timeoutsRef.current = [];
  }, []);

  const schedule = useCallback((fn: () => void, ms: number) => {
    const id = window.setTimeout(fn, ms);
    timeoutsRef.current.push(id);
  }, []);

  useEffect(() => () => clearScheduled(), [clearScheduled]);

  const onToggleListening = () => {
    if (voiceState === "listening") {
      clearScheduled();
      setVoiceState("thinking");
      schedule(() => {
        setVoiceState("speaking");
        schedule(() => setVoiceState("idle"), 2000);
      }, 1200);
      return;
    }
    if (voiceState !== "idle") {
      return;
    }
    clearScheduled();
    setVoiceState("listening");
  };

  const waveformActive =
    voiceState === "listening" ||
    voiceState === "speaking" ||
    voiceState === "thinking";

  const clockLabel = clock.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const dateLabel = clock
    .toLocaleDateString([], {
      weekday: "short",
      month: "short",
      day: "2-digit",
    })
    .toUpperCase();

  return (
    <div
      className="brainiac-page scanline flex min-h-0 flex-1 flex-col"
      data-testid="brainiac-page"
      data-voice-state={voiceState}
    >
      <BrainiacBackground />
      <div className="brainiac-frame" aria-hidden />

      {/* Scattered HUD coordinates (reference-style ambient readouts) */}
      <div className="brainiac-coords font-mono" aria-hidden>
        <span style={{ top: "13%", left: "27%" }}>F 9101</span>
        <span style={{ top: "11%", right: "31%" }}>B-101</span>
        <span style={{ top: "40%", left: "19%" }}>196.161</span>
        <span style={{ top: "46%", right: "18%" }}>19051</span>
        <span style={{ bottom: "31%", left: "31%" }}>14 05</span>
        <span style={{ bottom: "26%", right: "29%" }}>9610.193.871</span>
      </div>

      <div className="brainiac-top-rail font-jarvis-ui" aria-hidden>
        <span>META HUMAN OS // MARK VII</span>
        <span className="brainiac-top-rail-title font-jarvis-display">
          META HUMAN OS
        </span>
        <span className="font-mono">
          {dateLabel} · {clockLabel}
        </span>
      </div>

      <div className="brainiac-hud brainiac-hud--instrument">
        <BrainiacHudPanels side="left" voiceState={voiceState} />
        <BrainiacHudCore voiceState={voiceState} />
        <BrainiacHudPanels side="right" voiceState={voiceState} />
      </div>

      {/* Agent quick-launch deck */}
      <nav className="brainiac-agent-deck" aria-label="Agent quick launch">
        <span className="brainiac-agent-deck-label font-jarvis-ui">
          AGENT DECK
        </span>
        {agentDeck.map((agent) => (
          <Link
            key={agent.label}
            to={agent.to}
            className="brainiac-agent-tile"
            data-testid={`agent-deck-${agent.label.toLowerCase().replace(/\s+/g, "-")}`}
          >
            <span className="brainiac-agent-tile-icon">
              <agent.icon className="size-4" />
            </span>
            <span className="brainiac-agent-tile-label font-jarvis-ui">
              {agent.label}
            </span>
          </Link>
        ))}
        <span className="brainiac-agent-deck-hint font-jarvis-ui" aria-hidden>
          QUICK LAUNCH
        </span>
      </nav>

      <div className="brainiac-footer-hud brainiac-dock">
        <BrainiacWaveform active={waveformActive} voiceState={voiceState} />
        <BrainiacVoiceControls
          voiceState={voiceState}
          onToggleListening={onToggleListening}
        />
      </div>
    </div>
  );
}
