import { Mic, Square, Loader } from "lucide-react";
import { hasDyadProKey } from "@/lib/schemas";
import { useSettings } from "@/hooks/useSettings";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/tooltip";

type VoiceInputButtonProps = {
  isRecording: boolean;
  isTranscribing: boolean;
  onClick: () => void;
};

export function VoiceInputButton({
  isRecording,
  isTranscribing,
  onClick,
}: VoiceInputButtonProps) {
  const { settings } = useSettings();
  const hasProKey = settings ? hasDyadProKey(settings) : false;
  const proModeTogglable = hasProKey && Boolean(settings?.enableDyadPro);

  const isDisabled = isTranscribing || !proModeTogglable;

  const className = `
    px-2 py-2 rounded-lg transition-colors
    ${
      isRecording
        ? "bg-red-500/10 text-red-500 animate-pulse"
        : isTranscribing
          ? "bg-yellow-500/10 text-yellow-500"
          : proModeTogglable
            ? "hover:bg-(--background-darkest) text-(--sidebar-accent-fg)"
            : "opacity-50 cursor-not-allowed"
    }
  `;

  const title = isRecording
    ? "Stop recording"
    : isTranscribing
      ? "Transcribing..."
      : proModeTogglable
        ? "Start voice input"
        : "Pro feature only";

  const button = (
    <button
      onClick={proModeTogglable ? onClick : undefined}
      className={className}
      title={title}
      disabled={isDisabled}
    >
      {isRecording ? (
        <Square size={20} fill="currentColor" />
      ) : isTranscribing ? (
        <Loader size={20} className="animate-spin" />
      ) : (
        <Mic size={20} />
      )}
    </button>
  );
  return proModeTogglable ? (
    button
  ) : (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent>{title}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
