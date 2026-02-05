import { useState, useRef, useCallback, useEffect } from "react";
import log from "electron-log";
import { ipc } from "@/ipc/types";

const logger = log.scope("useAudioRecorder");

export interface AudioRecorderState {
  isRecording: boolean;
  audioBlob: Blob | null;
}

type UseVoiceInputOptions = {
  // how to insert the transcribed text into this input
  appendText: (text: string) => void;
  // optional error handler (e.g. setError in ChatInput)
  onError?: (message: string) => void;
};

export function useAudioRecorder(
  onRecordingComplete?: (blob: Blob) => void,
  onError?: (message: string) => void,
) {
  const [isRecording, setIsRecording] = useState(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const isMountedRef = useRef(true);
  const isStartingRef = useRef(false);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      if (mediaRecorderRef.current) {
        mediaRecorderRef.current.ondataavailable = null;
        mediaRecorderRef.current.onstop = null;
        if (mediaRecorderRef.current.state !== "inactive") {
          try {
            mediaRecorderRef.current.stop();
          } catch (error) {
            logger.warn("Failed to stop media recorder on unmount", error);
          }
        }
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
      if (audioContextRef.current) {
        audioContextRef.current.close();
        audioContextRef.current = null;
      }
      setAnalyser(null);
    };
  }, []);

  const startRecording = useCallback(async () => {
    if (isStartingRef.current || isRecording) return;
    isStartingRef.current = true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      streamRef.current = stream;

      // Setup Audio Context for visualization
      const audioContext = new AudioContext();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);

      setAnalyser(analyser);
      audioContextRef.current = audioContext;

      const mediaRecorder = new MediaRecorder(stream);

      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onerror = (event) => {
        logger.error("MediaRecorder error:", event);
        onError?.("Recording failed unexpectedly.");
        if (isMountedRef.current) {
          setIsRecording(false);
        }
        stream.getTracks().forEach((track) => track.stop());
        if (streamRef.current === stream) {
          streamRef.current = null;
        }
        if (audioContextRef.current) {
          audioContextRef.current.close();
          audioContextRef.current = null;
        }
        setAnalyser(null);
      };

      const recorderAudioContext = audioContext;

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        if (isMountedRef.current) {
          setIsRecording(false);
          setAudioBlob(blob);
        }
        if (onRecordingComplete) {
          onRecordingComplete(blob);
        }
        stream.getTracks().forEach((track) => track.stop());
        if (streamRef.current === stream) {
          streamRef.current = null;
        }

        // Cleanup AudioContext
        if (audioContextRef.current === recorderAudioContext) {
          audioContextRef.current.close();
          audioContextRef.current = null;
        }
        setAnalyser(null);
      };

      mediaRecorder.start();
      setIsRecording(true);
      setAudioBlob(null);
    } catch (err) {
      logger.error("Error starting recording:", err);
      // Cleanup any resources acquired before the error
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
      if (audioContextRef.current) {
        audioContextRef.current.close();
        audioContextRef.current = null;
      }
      setAnalyser(null);
      throw err;
    } finally {
      isStartingRef.current = false;
    }
  }, [isRecording, onError, onRecordingComplete]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && isRecording) {
      if (mediaRecorderRef.current.state !== "inactive") {
        try {
          mediaRecorderRef.current.requestData();
          mediaRecorderRef.current.stop();
        } catch (error) {
          logger.warn("Failed to stop media recorder", error);
        }
      }
      isStartingRef.current = false;
    }
  }, [isRecording]);

  return {
    isRecording,
    audioBlob,
    startRecording,
    stopRecording,
    analyser,
  };
}

export function useVoiceInput({ appendText, onError }: UseVoiceInputOptions) {
  const [isTranscribing, setIsTranscribing] = useState(false);

  const handleRecordingComplete = useCallback(
    async (blob: Blob) => {
      setIsTranscribing(true);
      try {
        const base64Content = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onerror = () => {
            reject(new Error("Failed to read audio file"));
          };
          reader.onload = () => {
            const base64data = reader.result as string | null;
            if (!base64data) {
              reject(new Error("Failed to convert audio to base64"));
              return;
            }
            const content = base64data.split(",")[1];
            if (!content) {
              reject(new Error("Invalid audio data format"));
              return;
            }
            resolve(content);
          };
          reader.readAsDataURL(blob);
        });

        const text = await ipc.misc.transcribeAudio({
          audioData: base64Content,
          format: "webm",
        });

        if (text) {
          appendText(text);
        }
      } catch (err) {
        logger.error("Transcription failed", err);
        onError?.(
          err instanceof Error ? err.message : "Failed to transcribe audio",
        );
      }
      setIsTranscribing(false);
    },
    [appendText, onError],
  );

  const { isRecording, startRecording, stopRecording, analyser } =
    useAudioRecorder(handleRecordingComplete, onError);

  const handleMicClick = async () => {
    if (isRecording) {
      stopRecording();
    } else {
      try {
        await startRecording();
      } catch (err) {
        logger.error("Failed to start recording:", err);
        onError?.("Failed to start recording. Check microphone permissions.");
      }
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
