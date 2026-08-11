import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, SendHorizontal, Settings2, X } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useJarvisSession } from "@/hooks/useJarvisSession";
import { useSettings } from "@/hooks/useSettings";
import { JarvisOrb, jarvisStateLabel } from "./JarvisOrb";
import { JarvisControlBar } from "./JarvisControlBar";
import { JarvisActivityTimeline } from "./JarvisActivityTimeline";
import { JarvisTranscriptDrawer } from "./JarvisTranscriptDrawer";
import {
  JarvisResultCanvas,
  type JarvisResultCard,
} from "./JarvisResultCanvas";
import { playActivationChime } from "@/lib/jarvis/interface_sounds";

export function JarvisWorkspace() {
  const { settings } = useSettings();
  const session = useJarvisSession();
  const [showTranscript, setShowTranscript] = useState(true);
  const [showActivity, setShowActivity] = useState(true);
  const [draft, setDraft] = useState("");

  const jarvisSettings = settings?.jarvis;
  const autoStart = jarvisSettings?.startListeningOnOpen ?? true;
  const playSounds = jarvisSettings?.playInterfaceSounds ?? true;

  const { start, stop, interrupt, sendText, toggleMute, clearSession } =
    session;

  // Open the live session whenever the workspace mounts. `start()` ignores
  // duplicate calls, and the hook stops the session on unmount, so this stays
  // correct under StrictMode's mount/unmount/remount cycle.
  useEffect(() => {
    if (!autoStart) return;
    void (async () => {
      if (playSounds) playActivationChime();
      await start();
    })();
  }, [autoStart, playSounds, start]);

  useEffect(() => {
    setShowActivity(jarvisSettings?.showActivityPanel ?? true);
  }, [jarvisSettings?.showActivityPanel]);

  const toggleSession = useCallback(() => {
    if (session.isActive) {
      void stop("Ended by user");
    } else {
      if (playSounds) playActivationChime();
      void start();
    }
  }, [session.isActive, playSounds, start, stop]);

  const stopSpeaking = useCallback(() => {
    void interrupt("stop-button");
  }, [interrupt]);

  // Keyboard shortcuts: Esc stops speech, Alt+M mutes, Alt+J ends the session.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && session.state === "speaking") {
        event.preventDefault();
        stopSpeaking();
        return;
      }
      if (event.altKey && event.key.toLowerCase() === "m") {
        event.preventDefault();
        toggleMute();
        return;
      }
      if (event.altKey && event.key.toLowerCase() === "j") {
        event.preventDefault();
        toggleSession();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [session.state, stopSpeaking, toggleMute, toggleSession]);

  const submitDraft = () => {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    void sendText(text);
  };

  const cards = useMemo<JarvisResultCard[]>(() => {
    const result: JarvisResultCard[] = [];

    // Assistant answers, newest last, streaming answer pinned to the end.
    for (const entry of session.transcript) {
      if (entry.role !== "assistant") continue;
      result.push({ kind: "answer", id: entry.id, text: entry.text });
    }
    if (session.streamingText) {
      result.push({
        kind: "answer",
        id: "streaming",
        text: session.streamingText,
        isStreaming: true,
      });
    }
    // Show the most recent results first so the user isn't scrolling.
    return result.reverse();
  }, [session.transcript, session.streamingText]);

  const statusLabel = jarvisStateLabel(session.state);
  const modelLabel = session.model
    ? `${session.model.provider} · ${session.model.name}`
    : "Model not resolved";

  return (
    <div
      className="jarvis-workspace font-jarvis-ui flex h-full flex-col overflow-hidden"
      data-state={session.state}
    >
      <header className="flex shrink-0 items-center gap-3 px-6 pt-[calc(var(--layout-title-bar-offset)+0.75rem)] pb-3">
        <h1 className="font-jarvis-display text-sm text-cyan-100/90">JARVIS</h1>
        <span
          className="rounded-full border border-cyan-400/20 px-2 py-0.5 text-[10px] tracking-widest text-cyan-300/70 uppercase"
          aria-live="polite"
        >
          {statusLabel}
        </span>
        <span className="ml-auto truncate font-mono text-[10px] text-cyan-100/35">
          {modelLabel}
        </span>
        {/* Voice, listening, permissions and ElevenLabs live here now rather
            than in System, which is a list of technical destinations. */}
        <Link
          to="/jarvis/settings"
          aria-label="Voice assistant settings"
          title="Voice assistant settings"
          className="shrink-0 rounded-md p-1 text-cyan-100/40 transition-colors hover:bg-cyan-400/10 hover:text-cyan-100"
          data-testid="jarvis-open-settings"
        >
          <Settings2 className="size-3.5" />
        </Link>
      </header>

      {session.error && (
        <div
          role="alert"
          className="mx-6 mb-3 flex shrink-0 items-start gap-2 rounded-lg border border-amber-400/30 bg-amber-400/5 px-3 py-2"
        >
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-300/80" />
          <p className="flex-1 text-xs leading-relaxed text-amber-100/85">
            {session.error}
          </p>
          <button
            type="button"
            onClick={session.dismissError}
            aria-label="Dismiss error"
            className="rounded p-0.5 text-amber-200/60 hover:text-amber-100 focus-visible:ring-1 focus-visible:ring-amber-400/60 focus-visible:outline-none"
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-hidden px-6 pb-6 lg:flex-row">
        {/* A. Central orb + controls */}
        <section className="flex shrink-0 flex-col items-center justify-center gap-5 lg:w-[380px]">
          <JarvisOrb
            state={session.state}
            amplitude={session.amplitude}
            size={240}
          />

          <div className="min-h-10 max-w-sm px-4 text-center">
            {session.partialTranscript ? (
              <p className="text-sm leading-relaxed text-cyan-100/70 italic">
                {session.partialTranscript}
              </p>
            ) : (
              <p className="text-xs tracking-widest text-cyan-200/35 uppercase">
                {!session.isActive
                  ? "Session offline"
                  : session.micDenied
                    ? "Microphone unavailable — type below"
                    : !session.voiceConfigured
                      ? "Voice not configured — type below"
                      : "Listening continuously"}
              </p>
            )}
          </div>

          <JarvisControlBar
            isActive={session.isActive}
            isMuted={session.isMuted}
            canStopSpeaking={session.state === "speaking"}
            onToggleSession={toggleSession}
            onToggleMute={toggleMute}
            onStopSpeaking={stopSpeaking}
            onToggleTranscript={() => setShowTranscript((value) => !value)}
            onToggleActivity={() => setShowActivity((value) => !value)}
            showTranscript={showTranscript}
            showActivity={showActivity}
          />

          <div className="flex w-full max-w-sm items-center gap-2">
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  submitDraft();
                }
              }}
              placeholder="Type to JARVIS…"
              aria-label="Send a message to JARVIS"
              disabled={!session.isActive}
              className="min-w-0 flex-1 rounded-lg border border-cyan-400/20 bg-transparent px-3 py-2 text-sm text-cyan-50 placeholder:text-cyan-100/30 focus-visible:border-cyan-400/50 focus-visible:ring-1 focus-visible:ring-cyan-400/40 focus-visible:outline-none disabled:opacity-40"
            />
            <button
              type="button"
              onClick={submitDraft}
              disabled={!session.isActive || !draft.trim()}
              aria-label="Send message"
              className="grid size-9 shrink-0 place-items-center rounded-lg border border-cyan-400/20 text-cyan-200/70 hover:bg-cyan-400/10 hover:text-cyan-100 focus-visible:ring-2 focus-visible:ring-cyan-400/60 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-35"
            >
              <SendHorizontal className="size-4" />
            </button>
          </div>
        </section>

        {/* B. Results + C. Activity */}
        <section className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
          <div className="min-h-0 flex-1 overflow-y-auto pr-1">
            <JarvisResultCanvas
              cards={cards}
              emptyHint={
                session.isActive
                  ? "Ask JARVIS a question. Answers, images and tool results appear here."
                  : "Start a session to talk with JARVIS."
              }
            />
          </div>

          {showActivity && <JarvisActivityTimeline events={session.activity} />}
          {showTranscript && (
            <JarvisTranscriptDrawer
              entries={session.transcript}
              onClear={clearSession}
            />
          )}
        </section>
      </div>
    </div>
  );
}
