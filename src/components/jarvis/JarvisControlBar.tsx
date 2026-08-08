import {
  Activity,
  Mic,
  MicOff,
  Power,
  Settings2,
  Square,
  MessagesSquare,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Link } from "@tanstack/react-router";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

function ControlButton({
  icon: Icon,
  label,
  onClick,
  isActive,
  tone = "default",
  disabled,
  shortcut,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  isActive?: boolean;
  tone?: "default" | "danger";
  disabled?: boolean;
  shortcut?: string;
}) {
  const button = (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={isActive}
      className={cn(
        "grid size-9 place-items-center rounded-lg border transition-colors",
        "focus-visible:ring-2 focus-visible:ring-cyan-400/60 focus-visible:outline-none",
        "disabled:cursor-not-allowed disabled:opacity-35",
        isActive
          ? "border-cyan-400/50 bg-cyan-400/15 text-cyan-100"
          : "border-cyan-400/20 text-cyan-200/70 hover:bg-cyan-400/10 hover:text-cyan-100",
        tone === "danger" &&
          "border-rose-400/25 text-rose-200/70 hover:bg-rose-400/10 hover:text-rose-100",
      )}
    >
      <Icon className="size-4" />
    </button>
  );

  return (
    <Tooltip>
      <TooltipTrigger render={button} />
      <TooltipContent side="bottom">
        {label}
        {shortcut && (
          <span className="ml-2 font-mono text-[10px] opacity-60">
            {shortcut}
          </span>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

export function JarvisControlBar({
  isActive,
  isMuted,
  canStopSpeaking,
  onToggleSession,
  onToggleMute,
  onStopSpeaking,
  onToggleTranscript,
  onToggleActivity,
  showTranscript,
  showActivity,
}: {
  isActive: boolean;
  isMuted: boolean;
  canStopSpeaking: boolean;
  onToggleSession: () => void;
  onToggleMute: () => void;
  onStopSpeaking: () => void;
  onToggleTranscript: () => void;
  onToggleActivity: () => void;
  showTranscript: boolean;
  showActivity: boolean;
}) {
  return (
    <div
      className="jarvis-panel flex items-center gap-1.5 rounded-xl px-2 py-1.5"
      role="toolbar"
      aria-label="JARVIS controls"
    >
      <ControlButton
        icon={isMuted ? MicOff : Mic}
        label={isMuted ? "Unmute microphone" : "Mute microphone"}
        onClick={onToggleMute}
        isActive={!isMuted && isActive}
        disabled={!isActive}
        shortcut="⌥M"
      />
      <ControlButton
        icon={Square}
        label="Stop speaking"
        onClick={onStopSpeaking}
        disabled={!canStopSpeaking}
        shortcut="Esc"
      />
      <ControlButton
        icon={Power}
        label={isActive ? "End session" : "Start session"}
        onClick={onToggleSession}
        tone={isActive ? "danger" : "default"}
        shortcut="⌥J"
      />

      <span className="mx-1 h-5 w-px bg-cyan-400/15" aria-hidden="true" />

      <ControlButton
        icon={MessagesSquare}
        label="Transcript"
        onClick={onToggleTranscript}
        isActive={showTranscript}
      />
      <ControlButton
        icon={Activity}
        label="Activity"
        onClick={onToggleActivity}
        isActive={showActivity}
      />

      <Tooltip>
        <TooltipTrigger
          render={
            <Link
              to="/settings"
              aria-label="Voice settings"
              className="grid size-9 place-items-center rounded-lg border border-cyan-400/20 text-cyan-200/70 transition-colors hover:bg-cyan-400/10 hover:text-cyan-100 focus-visible:ring-2 focus-visible:ring-cyan-400/60 focus-visible:outline-none"
            >
              <Settings2 className="size-4" />
            </Link>
          }
        />
        <TooltipContent side="bottom">Voice settings</TooltipContent>
      </Tooltip>
    </div>
  );
}
