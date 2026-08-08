import { Mic, MicOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { BrainiacVoiceState } from "./brainiac-voice-state";
import { BRAINIAC_VOICE_STATE_LABEL } from "./brainiac-voice-state";

const HINT: Record<BrainiacVoiceState, string> = {
  idle: "Mic channel armed. Awaiting command input.",
  listening: "Voice capture matrix is sampling local input.",
  thinking: "Routing prompt vectors through the cognition core.",
  speaking: "Audio response channel is transmitting.",
};

export function BrainiacVoiceControls({
  voiceState,
  onToggleListening,
}: {
  voiceState: BrainiacVoiceState;
  onToggleListening: () => void;
}) {
  const listening = voiceState === "listening";
  const busy = voiceState === "thinking" || voiceState === "speaking";

  return (
    <footer className="brainiac-voice" data-testid="brainiac-voice-controls">
      <div className="brainiac-command-rail font-jarvis-ui" aria-hidden>
        <span>UPLINK 01</span>
        <span>COMMAND DECK</span>
        <span>SECURE BUS</span>
      </div>
      <div className="brainiac-voice-readout font-jarvis-ui">
        <span className="brainiac-voice-label tracking-[0.2em]">
          VOICE INTERFACE
        </span>
        <span
          className={cn(
            "brainiac-voice-state tracking-[0.25em]",
            voiceState !== "idle" && "brainiac-voice-state--live",
            voiceState === "speaking" && "brainiac-voice-state--success",
            voiceState === "thinking" && "brainiac-voice-state--thinking",
          )}
          data-voice-state={voiceState}
        >
          {BRAINIAC_VOICE_STATE_LABEL[voiceState]}
        </span>
      </div>
      <p className="brainiac-voice-hint font-jarvis-ui">{HINT[voiceState]}</p>
      <div
        className={cn(
          "gradient-border gradient-border-glow brainiac-mic-shell",
          listening && "brainiac-mic-shell--listening",
          voiceState === "speaking" && "brainiac-mic-shell--speaking",
        )}
      >
        <Button
          type="button"
          variant="outline"
          size="lg"
          className={cn(
            "brainiac-mic-btn",
            listening && "brainiac-mic-btn--active",
          )}
          onClick={onToggleListening}
          disabled={busy}
          data-testid="brainiac-mic-button"
          aria-pressed={listening}
          aria-label={
            listening ? "Stop listening preview" : "Start listening preview"
          }
        >
          {listening ? (
            <MicOff className="size-5" />
          ) : (
            <Mic className="size-5" />
          )}
          <span className="font-jarvis-ui tracking-[0.2em]">
            {listening ? "END SESSION" : "ACTIVATE MIC"}
          </span>
        </Button>
      </div>
    </footer>
  );
}
