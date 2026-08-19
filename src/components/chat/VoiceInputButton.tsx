import { Loader2, Mic, Square } from "lucide-react";
import { useChatVoiceInput } from "@/hooks/useChatVoiceInput";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * Live waveform shown while the user is speaking. Bars follow the microphone
 * spectrum so it is obvious the app is hearing something.
 */
function Waveform({ levels }: { levels: number[] }) {
  return (
    <span
      className="flex h-5 items-center gap-[2px]"
      aria-hidden="true"
      data-testid="voice-input-waveform"
    >
      {levels.map((level, index) => (
        <span
          key={index}
          className="w-[2px] rounded-full bg-current transition-[height] duration-75"
          style={{ height: `${Math.max(3, level * 20)}px` }}
        />
      ))}
    </span>
  );
}

/**
 * Microphone control for chat composers. Tap to speak, tap again to stop —
 * the transcript is handed to `onTranscript`, which sends it to the chat.
 */
export function VoiceInputButton({
  onTranscript,
  onError,
  disabled,
  className,
  size = 20,
}: {
  onTranscript: (text: string) => void;
  onError?: (message: string) => void;
  disabled?: boolean;
  className?: string;
  size?: number;
}) {
  const {
    isRecording,
    isTranscribing,
    isAvailable,
    levels,
    toggleRecording,
    cancelRecording,
  } = useChatVoiceInput({ onTranscript, onError });

  const label = isTranscribing
    ? "Transcribing…"
    : isRecording
      ? "Stop and send"
      : isAvailable
        ? "Speak your message"
        : "Add an ElevenLabs API key in Settings → Voice Assistant";

  if (isRecording) {
    return (
      <div
        role="status"
        aria-live="polite"
        data-testid="voice-input-recording"
        className={cn(
          "flex items-center gap-2 rounded-full border border-rose-400/40 bg-rose-400/10 px-2.5 py-1 text-rose-500 dark:text-rose-300",
          className,
        )}
      >
        <span className="relative flex size-2" aria-hidden="true">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-rose-400 opacity-70" />
          <span className="relative inline-flex size-2 rounded-full bg-rose-500" />
        </span>
        <span className="text-[10px] font-semibold tracking-[0.12em] uppercase">
          Recording
        </span>
        <Waveform levels={levels} />
        <button
          type="button"
          onClick={toggleRecording}
          aria-label="Stop recording and send"
          className="grid size-6 place-items-center rounded-full bg-rose-500/20 hover:bg-rose-500/30 focus-visible:ring-2 focus-visible:ring-rose-400/60 focus-visible:outline-none"
        >
          <Square size={12} className="fill-current" />
        </button>
        <button
          type="button"
          onClick={cancelRecording}
          aria-label="Discard recording"
          className="text-xs text-rose-600/70 hover:text-rose-500 focus-visible:ring-2 focus-visible:ring-rose-400/60 focus-visible:outline-none dark:text-rose-200/60 dark:hover:text-rose-100"
        >
          Cancel
        </button>
      </div>
    );
  }

  const button = (
    <button
      type="button"
      onClick={toggleRecording}
      disabled={disabled || isTranscribing || !isAvailable}
      aria-label={label}
      data-testid="voice-input-button"
      className={cn(
        "grid place-items-center rounded-full p-1.5 transition-colors",
        "text-muted-foreground hover:bg-accent hover:text-foreground",
        "focus-visible:ring-2 focus-visible:ring-cyan-400/60 focus-visible:outline-none",
        "disabled:cursor-not-allowed disabled:opacity-40",
        className,
      )}
    >
      {isTranscribing ? (
        <Loader2 size={size} className="animate-spin" />
      ) : (
        <Mic size={size} />
      )}
    </button>
  );

  return (
    <Tooltip>
      <TooltipTrigger render={button} />
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}
