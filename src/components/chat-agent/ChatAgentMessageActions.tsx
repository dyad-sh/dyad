import {
  Check,
  Copy,
  Download,
  Loader2,
  RotateCw,
  ThumbsDown,
  ThumbsUp,
  Volume2,
  VolumeX,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { jarvisClient } from "@/ipc/types/jarvis";
import { showError } from "@/lib/toast";
import { useAtomValue } from "jotai";
import { userSettingsAtom } from "@/atoms/appAtoms";

export type MessageFeedback = "up" | "down" | null;

type ChatAgentMessageActionsProps = {
  messageId: string;
  content: string;
  isLastAssistant: boolean;
  isStreaming: boolean;
  feedback: MessageFeedback;
  onFeedback: (messageId: string, feedback: MessageFeedback) => void;
  onRegenerate?: () => void;
  /** Saves the picture or video this reply produced, when there is one. */
  onDownload?: () => void;
};

let activeSpeechUtterance: SpeechSynthesisUtterance | null = null;
let activeAudio: HTMLAudioElement | null = null;
let activePlaybackOwner: symbol | null = null;
let activePlaybackStopped: (() => void) | null = null;
let readAloudRequestId = 0;

function stopSpeech() {
  readAloudRequestId += 1;
  if (typeof window !== "undefined" && window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
  if (activeAudio) {
    activeAudio.pause();
    activeAudio.removeAttribute("src");
    activeAudio.load();
  }
  const onStopped = activePlaybackStopped;
  activeSpeechUtterance = null;
  activeAudio = null;
  activePlaybackOwner = null;
  activePlaybackStopped = null;
  onStopped?.();
}

function ActionIconButton({
  label,
  onClick,
  disabled,
  pressed,
  reaction,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  pressed?: boolean;
  /** Shapes the press feedback: thumbs lift or drop, the rest just pop. */
  reaction?: "up" | "down" | "copy" | "speak" | "regenerate";
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn(
              "chat-agent-message-action-btn",
              pressed && "chat-agent-message-action-btn--pressed",
            )}
            aria-label={label}
            aria-pressed={pressed}
            data-reaction={reaction}
            disabled={disabled}
            onClick={onClick}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

export function ChatAgentMessageActions({
  messageId,
  content,
  isLastAssistant,
  isStreaming,
  feedback,
  onFeedback,
  onRegenerate,
  onDownload,
}: ChatAgentMessageActionsProps) {
  const [copied, setCopied] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isPreparingSpeech, setIsPreparingSpeech] = useState(false);
  const settings = useAtomValue(userSettingsAtom);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const playbackOwnerRef = useRef(Symbol(messageId));
  const mountedRef = useRef(true);

  useEffect(() => {
    const owner = playbackOwnerRef.current;
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (activePlaybackOwner === owner) {
        stopSpeech();
      }
    };
  }, []);

  const handleCopy = async () => {
    if (!content.trim()) return;
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard may be unavailable
    }
  };

  const handleFeedback = (value: MessageFeedback) => {
    const next = feedback === value ? null : value;
    onFeedback(messageId, next);
  };

  const handleReadAloud = useCallback(async () => {
    if (!content.trim() || typeof window === "undefined") return;

    if (isSpeaking || isPreparingSpeech) {
      stopSpeech();
      setIsSpeaking(false);
      setIsPreparingSpeech(false);
      return;
    }

    stopSpeech();
    const owner = playbackOwnerRef.current;
    const onStopped = () => {
      if (!mountedRef.current) return;
      setIsSpeaking(false);
      setIsPreparingSpeech(false);
    };

    if (settings?.jarvis?.chatReadAloudProvider === "elevenlabs") {
      const requestId = ++readAloudRequestId;
      setIsPreparingSpeech(true);
      activePlaybackOwner = owner;
      activePlaybackStopped = onStopped;
      try {
        const speech = await jarvisClient.synthesizeSpeech({ text: content });
        if (requestId !== readAloudRequestId || !mountedRef.current) return;

        const audio = new Audio(
          `data:${speech.mimeType};base64,${speech.audioBase64}`,
        );
        activeAudio = audio;
        activePlaybackOwner = owner;
        activePlaybackStopped = onStopped;
        audio.onended = () => {
          if (activeAudio !== audio) return;
          activeAudio = null;
          activePlaybackOwner = null;
          activePlaybackStopped = null;
          onStopped();
        };
        audio.onerror = () => {
          if (activeAudio === audio) stopSpeech();
          showError("The generated ElevenLabs audio could not be played.");
        };
        setIsPreparingSpeech(false);
        setIsSpeaking(true);
        await audio.play();
      } catch (error) {
        if (requestId !== readAloudRequestId || !mountedRef.current) return;
        if (activePlaybackOwner === owner) {
          activePlaybackOwner = null;
          activePlaybackStopped = null;
        }
        setIsPreparingSpeech(false);
        setIsSpeaking(false);
        showError(error instanceof Error ? error.message : String(error));
      }
      return;
    }

    if (!window.speechSynthesis) return;

    const utterance = new SpeechSynthesisUtterance(content);
    utteranceRef.current = utterance;
    activeSpeechUtterance = utterance;
    activePlaybackOwner = owner;
    activePlaybackStopped = onStopped;

    utterance.onend = () => {
      if (activeSpeechUtterance === utterance) {
        activeSpeechUtterance = null;
        activePlaybackOwner = null;
        activePlaybackStopped = null;
        onStopped();
      }
    };
    utterance.onerror = () => {
      if (activeSpeechUtterance === utterance) {
        activeSpeechUtterance = null;
        activePlaybackOwner = null;
        activePlaybackStopped = null;
        onStopped();
      }
    };

    setIsSpeaking(true);
    window.speechSynthesis.speak(utterance);
  }, [content, isPreparingSpeech, isSpeaking, settings]);

  const hasText = Boolean(content.trim());
  // A generated picture or video is a real reply even with no words attached,
  // so it still deserves feedback and a way to keep the file.
  if (isStreaming || (!hasText && !onDownload)) {
    return null;
  }

  return (
    <div
      className="chat-agent-message-actions"
      data-testid="chat-agent-message-actions"
    >
      {/* Wrapped so the confirmation can sit against the button itself — a
          corner toast is easy to miss when your eyes are on the message. */}
      {hasText && (
        <span className="chat-copy-wrap">
          <ActionIconButton
            label={copied ? "Copied" : "Copy"}
            reaction="copy"
            onClick={() => void handleCopy()}
          >
            {copied ? (
              <Check className="size-4" />
            ) : (
              <Copy className="size-4" />
            )}
          </ActionIconButton>
          {copied && (
            <span
              className="chat-copied-pill"
              role="status"
              aria-live="polite"
              data-testid="chat-copied-pill"
            >
              Copied
            </span>
          )}
        </span>
      )}

      <ActionIconButton
        label="Good response"
        reaction="up"
        onClick={() => handleFeedback("up")}
        pressed={feedback === "up"}
      >
        <ThumbsUp className="size-4" />
      </ActionIconButton>

      <ActionIconButton
        label="Bad response"
        reaction="down"
        onClick={() => handleFeedback("down")}
        pressed={feedback === "down"}
      >
        <ThumbsDown className="size-4" />
      </ActionIconButton>

      {onDownload && (
        <ActionIconButton label="Download" reaction="copy" onClick={onDownload}>
          <Download className="size-4" />
        </ActionIconButton>
      )}

      {isLastAssistant && onRegenerate && (
        <ActionIconButton
          label="Regenerate"
          reaction="regenerate"
          onClick={onRegenerate}
          disabled={isStreaming}
        >
          <RotateCw className="size-4" />
        </ActionIconButton>
      )}

      {hasText && (
        <ActionIconButton
          label={
            isPreparingSpeech
              ? "Cancel voice generation"
              : isSpeaking
                ? "Stop reading aloud"
                : settings?.jarvis?.chatReadAloudProvider === "elevenlabs"
                  ? "Read aloud with ElevenLabs"
                  : "Read aloud"
          }
          reaction="speak"
          onClick={() => void handleReadAloud()}
          pressed={isSpeaking || isPreparingSpeech}
        >
          {isPreparingSpeech ? (
            <Loader2 className="size-4 animate-spin" />
          ) : isSpeaking ? (
            <VolumeX className="size-4" />
          ) : (
            <Volume2 className="size-4" />
          )}
        </ActionIconButton>
      )}
    </div>
  );
}
