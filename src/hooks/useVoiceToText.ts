import { useCallback, useEffect, useState } from "react";
import { systemClock, uuidIdSource } from "@/state_machines/clock";
import {
  useControllerSnapshot,
  useManagerLifecycle,
} from "@/state_machines/react";
import { createBrowserVoiceCommandRunner } from "@/voice_to_text/commands";
import {
  isVoiceRecording,
  isVoiceTranscribing,
  VoiceToTextController,
} from "@/voice_to_text/controller";

interface UseVoiceToTextOptions {
  enabled: boolean;
  onTranscription: (text: string) => void;
  onError?: (error: string) => void;
}

export function useVoiceToText({
  enabled,
  onTranscription,
  onError,
}: UseVoiceToTextOptions) {
  const [{ controller, runner }] = useState(() => {
    const commandRunner = createBrowserVoiceCommandRunner({
      clock: systemClock,
      idSource: uuidIdSource,
      callbacks: { onTranscription, onError },
    });
    return {
      runner: commandRunner,
      controller: new VoiceToTextController({
        idSource: uuidIdSource,
        runner: commandRunner,
      }),
    };
  });

  useManagerLifecycle(controller);
  useEffect(() => {
    runner.updateCallbacks({ onTranscription, onError });
  }, [runner, onTranscription, onError]);

  const state = useControllerSnapshot(controller);
  const toggleRecording = useCallback(() => {
    if (enabled || isVoiceRecording(controller.getSnapshot())) {
      controller.toggle();
    }
  }, [controller, enabled]);

  return {
    isRecording: isVoiceRecording(state),
    isTranscribing: isVoiceTranscribing(state),
    toggleRecording,
  };
}
