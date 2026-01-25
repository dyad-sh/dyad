import type {
  ClipboardEvent,
  Dispatch,
  ReactNode,
  SetStateAction,
} from "react";
import { useVoiceInput } from "@/hooks/useAudioRecorder";
import { VoiceWaveform } from "./VoiceWaveform";
import { VoiceInputButton } from "./VoiceInputButton";
import { LexicalChatInput } from "./LexicalChatInput";

type LexicalVoiceInputRowProps = {
  value: string;
  setValue: Dispatch<SetStateAction<string>>;
  onSubmit: () => void;
  onPaste?: (event: ClipboardEvent) => void;
  placeholder?: string;
  isStreaming: boolean;
  disableSend: boolean;
  excludeCurrentApp: boolean;
  disableLexicalSendButton?: boolean;
  cancelButton?: ReactNode;
  sendIcon: ReactNode;
};

export function LexicalVoiceInputRow({
  value,
  setValue,
  onSubmit,
  onPaste,
  placeholder,
  isStreaming,
  disableSend,
  excludeCurrentApp,
  disableLexicalSendButton = false,
  cancelButton,
  sendIcon,
}: LexicalVoiceInputRowProps) {
  const { isTranscribing, isRecording, analyser, handleMicClick } =
    useVoiceInput({
      appendText: (text) => {
        if (text) {
          setValue((prev) => (prev ? `${prev} ${text}` : text));
        }
      },
    });
  const isVoiceBusy = isRecording || isTranscribing;
  const isSendDisabled = disableSend || isVoiceBusy;

  return (
    <div className="flex items-start space-x-2 ">
      {isRecording ? (
        <VoiceWaveform analyser={analyser} />
      ) : (
        <LexicalChatInput
          value={value}
          onChange={setValue}
          onSubmit={onSubmit}
          onPaste={onPaste}
          placeholder={placeholder}
          excludeCurrentApp={excludeCurrentApp}
          disableSendButton={disableLexicalSendButton || isVoiceBusy}
        />
      )}

      {isStreaming ? (
        (cancelButton ?? null)
      ) : (
        <div className="flex items-center mt-1 mr-1">
          <VoiceInputButton
            isRecording={isRecording}
            isTranscribing={isTranscribing}
            onClick={handleMicClick}
          />
          <button
            onClick={onSubmit}
            disabled={isSendDisabled}
            className="px-2 py-2 mt-1 mr-1 hover:bg-(--background-darkest) text-(--sidebar-accent-fg) rounded-lg disabled:opacity-50"
            title="Send message"
          >
            {sendIcon}
          </button>
        </div>
      )}
    </div>
  );
}
