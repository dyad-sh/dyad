import { useState, useRef, useCallback } from "react";
import { IpcClient } from "@/ipc/ipc_client";

export interface AudioRecorderState {
  isRecording: boolean;
  recordingTime: number;
  audioBlob: Blob | null;
}
type UseVoiceInputOptions = {
  // how to insert the transcribed text into this input
  appendText: (text: string) => void;
  // optional error handler (e.g. setError in ChatInput)
  onError?: (message: string) => void;
};

export function useAudioRecorder(onRecordingComplete?: (blob: Blob) => void) {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // Setup Audio Context for visualization
      const audioContext = new AudioContext();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);

      analyserRef.current = analyser;
      audioContextRef.current = audioContext;

      const mediaRecorder = new MediaRecorder(stream);

      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        setAudioBlob(blob);
        if (onRecordingComplete) {
          onRecordingComplete(blob);
        }
        stream.getTracks().forEach((track) => track.stop());

        // Cleanup AudioContext
        if (audioContextRef.current) {
          audioContextRef.current.close();
          audioContextRef.current = null;
        }
        analyserRef.current = null;
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingTime(0);
      setAudioBlob(null);

      timerRef.current = setInterval(() => {
        setRecordingTime((prev) => prev + 1);
      }, 1000);
    } catch (err) {
      console.error("Error starting recording:", err);
      throw err;
    }
  }, [onRecordingComplete]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
  }, [isRecording]);

  return {
    isRecording,
    recordingTime,
    audioBlob,
    startRecording,
    stopRecording,
    analyser: analyserRef.current,
  };
}

export function useVoiceInput({ appendText, onError }: UseVoiceInputOptions) {
  const [isTranscribing, setIsTranscribing] = useState(false);

  const handleRecordingComplete = useCallback(
    async (blob: Blob) => {
      setIsTranscribing(true);
      try {
        const reader = new FileReader();
        reader.readAsDataURL(blob);

        reader.onloadend = async () => {
          try {
            const base64data = reader.result as string;
            const base64Content = base64data.split(",")[1];

            const text = await IpcClient.getInstance().transcribeAudio(
              base64Content,
              "webm",
            );

            if (text) {
              appendText(text);
            }
          } catch (err) {
            console.error("Transcription failed", err);
            onError?.("Failed to transcribe audio");
          } finally {
            setIsTranscribing(false);
          }
        };
      } catch (err) {
        console.error("Transcription failed", err);
        onError?.("Failed to transcribe audio");
        setIsTranscribing(false);
      }
    },
    [appendText, onError],
  );

  const { isRecording, startRecording, stopRecording, analyser } =
    useAudioRecorder(handleRecordingComplete);

  const handleMicClick = () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  return {
    isTranscribing,
    isRecording,
    analyser,
    handleMicClick,
    startRecording,
    stopRecording,
  };
}
