import { useCallback, useEffect, useRef, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import { jarvisClient, jarvisEventClient } from "@/ipc/types/jarvis";
import type { JarvisActivityEvent } from "@/ipc/types/jarvis";
import type { JarvisState } from "@/shared/jarvis/state_machine";
import {
  MicrophoneCapture,
  arrayBufferToBase64,
} from "@/lib/jarvis/microphone_capture";
import {
  AudioPlaybackCoordinator,
  base64ToArrayBuffer,
} from "@/lib/jarvis/audio_playback";
import { useSettings } from "@/hooks/useSettings";

export interface JarvisTranscriptEntry {
  id: string;
  role: "user" | "assistant" | "tool" | "system";
  text: string;
  timestamp: string;
}

export interface JarvisSessionSnapshot {
  state: JarvisState;
  partialTranscript: string;
  transcript: JarvisTranscriptEntry[];
  activity: JarvisActivityEvent[];
  streamingText: string;
  amplitude: number;
  error: string | null;
  model: { provider: string; name: string } | null;
  micDenied: boolean;
  isMuted: boolean;
  voiceConfigured: boolean;
}

const MAX_ACTIVITY_EVENTS = 200;

/**
 * Owns the renderer half of a Meta Human OS voice session: microphone capture,
 * TTS playback, and the event stream from the main process. The main process
 * remains the authority on session state — this mirrors it.
 */
export function useJarvisSession() {
  const { settings } = useSettings();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [state, setState] = useState<JarvisState>("offline");
  const [partialTranscript, setPartialTranscript] = useState("");
  const [transcript, setTranscript] = useState<JarvisTranscriptEntry[]>([]);
  const [activity, setActivity] = useState<JarvisActivityEvent[]>([]);
  const [streamingText, setStreamingText] = useState("");
  const [amplitude, setAmplitude] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [model, setModel] = useState<{ provider: string; name: string } | null>(
    null,
  );
  const [micDenied, setMicDenied] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [voiceConfigured, setVoiceConfigured] = useState(false);
  const [isStarting, setIsStarting] = useState(false);

  const sessionIdRef = useRef<string | null>(null);
  const micRef = useRef<MicrophoneCapture | null>(null);
  const playbackRef = useRef<AudioPlaybackCoordinator | null>(null);
  const stateRef = useRef<JarvisState>("offline");
  /** Engine-dependent: 16 kHz for the pipeline, 24 kHz for realtime. */
  const captureSampleRateRef = useRef(16000);

  const jarvisSettings = settings?.jarvis;

  const setSessionState = useCallback((next: JarvisState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const teardownAudio = useCallback(() => {
    micRef.current?.stop();
    micRef.current = null;
    playbackRef.current?.dispose();
    playbackRef.current = null;
    setAmplitude(0);
  }, []);

  // Subscribe to main-process session events for the session's lifetime.
  useEffect(() => {
    const forSession = <T extends { sessionId: string }>(
      handler: (payload: T) => void,
    ) => {
      return (payload: T) => {
        if (payload.sessionId !== sessionIdRef.current) return;
        handler(payload);
      };
    };

    const unsubscribers = [
      jarvisEventClient.onState(
        forSession(({ state: next }) => {
          setSessionState(next);
          // Cut playback the moment the session leaves a speaking state.
          if (next === "interrupted") {
            playbackRef.current?.cancel();
          }
        }),
      ),
      jarvisEventClient.onPartialTranscript(
        forSession(({ text }) => setPartialTranscript(text)),
      ),
      jarvisEventClient.onCommittedTranscript(
        forSession(({ entryId, role, text }) => {
          setPartialTranscript("");
          setTranscript((previous) => [
            ...previous,
            { id: entryId, role, text, timestamp: new Date().toISOString() },
          ]);
        }),
      ),
      jarvisEventClient.onAssistantDelta(
        forSession(({ delta }) =>
          setStreamingText((previous) => previous + delta),
        ),
      ),
      jarvisEventClient.onAssistantDone(forSession(() => setStreamingText(""))),
      jarvisEventClient.onAudioChunk(
        forSession(({ chunk, sampleRate }) => {
          playbackRef.current?.enqueue(base64ToArrayBuffer(chunk), sampleRate);
        }),
      ),
      jarvisEventClient.onAudioDone(forSession(() => {})),
      jarvisEventClient.onActivity(
        forSession((event: JarvisActivityEvent) => {
          setActivity((previous) => {
            // Activity events are updated in place when a running step
            // resolves (same id, new status/duration).
            const index = previous.findIndex((item) => item.id === event.id);
            if (index >= 0) {
              const next = [...previous];
              next[index] = event;
              return next;
            }
            return [...previous, event].slice(-MAX_ACTIVITY_EVENTS);
          });
        }),
      ),
      jarvisEventClient.onError(forSession(({ message }) => setError(message))),
      jarvisEventClient.onEnded(
        forSession(() => {
          teardownAudio();
          sessionIdRef.current = null;
          setSessionId(null);
          setSessionState("offline");
          setPartialTranscript("");
          setStreamingText("");
        }),
      ),
    ];

    return () => {
      for (const unsubscribe of unsubscribers) unsubscribe();
    };
  }, [setSessionState, teardownAudio]);

  const start = useCallback(
    async (options?: { mock?: boolean }) => {
      if (sessionIdRef.current || isStarting) return;
      setIsStarting(true);
      setError(null);
      setMicDenied(false);

      const id = uuidv4();
      sessionIdRef.current = id;
      setSessionId(id);
      setSessionState("connecting");
      // Activity and transcript belong to a session; carrying the previous
      // one over stacks duplicate greetings and stale steps.
      setTranscript([]);
      setActivity([]);
      setStreamingText("");
      setPartialTranscript("");

      playbackRef.current = new AudioPlaybackCoordinator({
        onAmplitude: (value) => {
          if (stateRef.current === "speaking") setAmplitude(value);
        },
        onError: (message) => setError(message),
      });

      try {
        const result = await jarvisClient.startSession({
          sessionId: id,
          mock: options?.mock,
        });
        setModel(result.model);
        setVoiceConfigured(result.voiceConfigured);
        captureSampleRateRef.current = result.captureSampleRate;
      } catch (startError) {
        sessionIdRef.current = null;
        setSessionId(null);
        setSessionState("error");
        setError(
          startError instanceof Error
            ? startError.message
            : "Could not start the Meta Human OS session.",
        );
        teardownAudio();
        setIsStarting(false);
        return;
      }

      // Microphone is optional: a denied permission degrades to text mode
      // rather than failing the session.
      try {
        const capture = new MicrophoneCapture({
          deviceId: jarvisSettings?.inputDeviceId || undefined,
          targetSampleRate: captureSampleRateRef.current,
          // Default both off. Chromium's audio processing converges a few
          // seconds after the stream opens — using our own TTS playback as the
          // echo reference — and then emits digital silence, which reads as a
          // dead microphone. Users can re-enable them in Voice settings.
          echoCancellation: jarvisSettings?.echoCancellation ?? false,
          noiseSuppression: jarvisSettings?.noiseSuppression ?? false,
          vadThreshold: jarvisSettings?.vadSensitivity,
          silenceTimeoutMs: jarvisSettings?.silenceTimeoutMs,
          onAudio: (pcm16) => {
            void jarvisClient
              .sendAudioChunk({
                sessionId: id,
                chunk: arrayBufferToBase64(pcm16),
              })
              .catch(() => {});
          },
          onAmplitude: (value) => {
            if (stateRef.current !== "speaking") setAmplitude(value);
          },
          onSpeechStart: () => {
            // Barge-in: silence our own output before the turn is submitted.
            if (
              stateRef.current === "speaking" ||
              stateRef.current === "thinking" ||
              stateRef.current === "executingTool"
            ) {
              playbackRef.current?.cancel();
            }
            void jarvisClient
              .speechActivity({ sessionId: id, kind: "start" })
              .catch(() => {});
          },
          onDeviceIssue: (message: string) => setError(message),
          onSpeechEnd: () => {
            void jarvisClient
              .speechActivity({ sessionId: id, kind: "end" })
              .catch(() => {});
          },
        });
        await capture.start();
        micRef.current = capture;
      } catch (micError) {
        setMicDenied(true);
        setError(
          micError instanceof DOMException &&
            micError.name === "NotAllowedError"
            ? "Microphone access was denied. Grant permission to talk, or type below to continue in text mode."
            : "No microphone is available. You can still type below to continue in text mode.",
        );
      } finally {
        setIsStarting(false);
      }
    },
    [isStarting, jarvisSettings, setSessionState, teardownAudio],
  );

  const stop = useCallback(
    async (reason = "Stopped by user") => {
      const id = sessionIdRef.current;
      teardownAudio();
      sessionIdRef.current = null;
      setSessionId(null);
      setSessionState("offline");
      setPartialTranscript("");
      setStreamingText("");
      if (id) {
        await jarvisClient
          .stopSession({ sessionId: id, reason })
          .catch(() => {});
      }
    },
    [setSessionState, teardownAudio],
  );

  const interrupt = useCallback(
    async (reason: "barge-in" | "stop-button" | "mute" | "navigation") => {
      const id = sessionIdRef.current;
      playbackRef.current?.cancel();
      if (!id) return;
      await jarvisClient.interrupt({ sessionId: id, reason }).catch(() => {});
    },
    [],
  );

  const sendText = useCallback(async (text: string) => {
    const id = sessionIdRef.current;
    if (!id || !text.trim()) return;
    await jarvisClient
      .sendTextTurn({ sessionId: id, text: text.trim() })
      .catch(() => {});
  }, []);

  const toggleMute = useCallback(() => {
    const capture = micRef.current;
    if (!capture) return;
    const next = !capture.isMuted;
    capture.setMuted(next);
    setIsMuted(next);
    if (next) void interrupt("mute");
  }, [interrupt]);

  const clearSession = useCallback(() => {
    setTranscript([]);
    setActivity([]);
    setStreamingText("");
    setPartialTranscript("");
    setError(null);
  }, []);

  // Tear the session down when the workspace unmounts. React StrictMode
  // mounts, unmounts and remounts in development, so the refs must be reset
  // here — otherwise the remount sees a stale session id, skips starting,
  // and leaves the workspace with no microphone.
  useEffect(() => {
    return () => {
      const id = sessionIdRef.current;
      sessionIdRef.current = null;
      micRef.current?.stop();
      micRef.current = null;
      playbackRef.current?.dispose();
      playbackRef.current = null;
      if (id) {
        void jarvisClient
          .stopSession({ sessionId: id, reason: "Workspace closed" })
          .catch(() => {});
      }
    };
  }, []);

  return {
    sessionId,
    isActive: sessionId !== null,
    isStarting,
    state,
    partialTranscript,
    transcript,
    activity,
    streamingText,
    amplitude,
    error,
    model,
    micDenied,
    isMuted,
    voiceConfigured,
    start,
    stop,
    interrupt,
    sendText,
    toggleMute,
    clearSession,
    dismissError: () => setError(null),
  };
}
