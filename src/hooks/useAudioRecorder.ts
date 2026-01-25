import { useState, useRef, useCallback, useEffect } from "react";
import { ipc } from "@/ipc/types";

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

export function useAudioRecorder(onRecordingComplete?: (blob: Blob) => void) {
  const [isRecording, setIsRecording] = useState(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const analyserRef = useRef<AnalyserNode | null>(null);
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
            console.warn("Failed to stop media recorder on unmount", error);
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
      analyserRef.current = null;
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

      mediaRecorder.onerror = (event) => {
        console.error("MediaRecorder error:", event);
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
        analyserRef.current = null;
      };

      const recorderAudioContext = audioContext;
      const recorderAnalyser = analyser;

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        if (isMountedRef.current) {
          setIsRecording(false);
          setAudioBlob(blob);
          if (onRecordingComplete) {
            onRecordingComplete(blob);
          }
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
        if (analyserRef.current === recorderAnalyser) {
          analyserRef.current = null;
        }
      };

      mediaRecorder.start();
      setIsRecording(true);
      setAudioBlob(null);
    } catch (err) {
      console.error("Error starting recording:", err);
      throw err;
    } finally {
      isStartingRef.current = false;
    }
  }, [isRecording, onRecordingComplete]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && isRecording) {
      if (mediaRecorderRef.current.state !== "inactive") {
        try {
          mediaRecorderRef.current.requestData();
          mediaRecorderRef.current.stop();
        } catch (error) {
          console.warn("Failed to stop media recorder", error);
        }
      }
      setIsRecording(false);
      isStartingRef.current = false;
    }
  }, [isRecording]);

  return {
    isRecording,
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

        reader.onerror = () => {
          console.error("FileReader error:", reader.error);
          onError?.("Failed to read audio file");
          setIsTranscribing(false);
        };

        reader.onload = async () => {
          try {
            const base64data = reader.result as string | null;
            if (!base64data) {
              onError?.("Failed to convert audio to base64");
              setIsTranscribing(false);
              return;
            }
            const base64Content = base64data.split(",")[1];
            if (!base64Content) {
              onError?.("Invalid audio data format");
              setIsTranscribing(false);
              return;
            }

            const text = await ipc.misc.transcribeAudio({
              audioData: base64Content,
              format: "webm",
            });

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

  const handleMicClick = async () => {
    if (isRecording) {
      stopRecording();
    } else {
      try {
        await startRecording();
      } catch (err) {
        console.error("Failed to start recording:", err);
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
