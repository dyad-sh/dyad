import { useEffect, useMemo, useRef, useState } from "react";
import { useAtomValue } from "jotai";
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Loader2,
  Sparkles,
  X,
} from "lucide-react";
import type { ConsoleEntry } from "@/ipc/types";
import {
  appConsoleEntriesAtom,
  previewRunStartedAtAtom,
} from "@/atoms/appAtoms";
import { selectedChatIdAtom } from "@/atoms/chatAtoms";
import { useStreamChat } from "@/hooks/useStreamChat";
import { cn } from "@/lib/utils";

const STARTUP_LOG_MESSAGES = new Set([
  "Connecting to app...",
  "Restarting app...",
]);
const MAX_ERRORS_FOR_AI_FIX = 10;
const MAX_ERROR_CHARS_FOR_AI_FIX = 2_000;

function formatTime(ts: number) {
  const d = new Date(ts);
  return d.toTimeString().slice(0, 8);
}

// Node prints DeprecationWarnings to stderr (e.g. "(node:1234) [DEP0123]
// DeprecationWarning: ..."), so they surface here as level="error" even
// though they aren't actionable failures. Treat them as warnings: don't
// count them in the error banner, and render them with warn styling.
function isDeprecationWarning(message: string): boolean {
  return /DeprecationWarning/i.test(message);
}

function displayLevel(entry: ConsoleEntry): ConsoleEntry["level"] {
  if (entry.level === "error" && isDeprecationWarning(entry.message)) {
    return "warn";
  }
  return entry.level;
}

const EXIT_ANIMATION_MS = 400;

const PREVIEW_STARTUP_FIX_INTRO = (errorCount: number) =>
  `The app failed to start. We ran into ${errorCount} error(s) either while installing node modules or running the dev script. Please review package.json to identify and fix the issue(s). Focus on critical errors and do not try to fix non-critical errors like deprecation warnings.`;

export function getPreviewLoadingSessionStartedAt({
  consoleEntries,
  runStartedAt,
}: {
  consoleEntries: ConsoleEntry[];
  runStartedAt: number;
}) {
  for (let i = consoleEntries.length - 1; i >= 0; i--) {
    const entry = consoleEntries[i];
    if (
      entry.type === "server" &&
      entry.level === "info" &&
      entry.timestamp >= runStartedAt &&
      STARTUP_LOG_MESSAGES.has(entry.message)
    ) {
      return entry.timestamp;
    }
  }
  return runStartedAt;
}

export function sanitizePreviewErrorForPrompt(message: string) {
  const withoutAnsi = message.replace(/\x1B\[[0-9;]*[A-Za-z]/g, "");
  const withoutControlChars = withoutAnsi.replace(
    // Keep newlines and tabs because stack traces are more useful with shape.
    /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g,
    "",
  );
  return withoutControlChars.length > MAX_ERROR_CHARS_FOR_AI_FIX
    ? `${withoutControlChars.slice(0, MAX_ERROR_CHARS_FOR_AI_FIX)}\n[truncated]`
    : withoutControlChars;
}

interface PreviewLoadingScreenProps {
  // True while the app is being spawned/restarted (useRunApp).
  loading: boolean;
  // True once the dev server is reachable and the iframe can render.
  // Until then we stay on the loading screen so users can see startup
  // logs and any errors that surface after spawn but before the server
  // is ready (e.g. a malformed package.json that fails npm).
  isAppUrlReady: boolean;
}

export function PreviewLoadingScreen({
  loading,
  isAppUrlReady,
}: PreviewLoadingScreenProps) {
  const consoleEntries = useAtomValue(appConsoleEntriesAtom);
  const previewRunStartedAt = useAtomValue(previewRunStartedAtAtom);
  const selectedChatId = useAtomValue(selectedChatIdAtom);
  const { streamMessage, isStreaming } = useStreamChat();

  const isVisible = loading || !isAppUrlReady;

  const [shouldRender, setShouldRender] = useState(isVisible);
  const [isExiting, setIsExiting] = useState(false);
  const [isErrorsExpanded, setIsErrorsExpanded] = useState(false);
  const [errorsDismissed, setErrorsDismissed] = useState(false);
  const [visibleStartedAt, setVisibleStartedAt] = useState(Date.now());
  const wasVisibleRef = useRef<boolean>(isVisible);
  const logListRef = useRef<HTMLDivElement>(null);

  const runStartedAt = previewRunStartedAt ?? visibleStartedAt;

  const sessionStartedAt = useMemo(
    () =>
      getPreviewLoadingSessionStartedAt({
        consoleEntries,
        runStartedAt,
      }),
    [consoleEntries, runStartedAt],
  );

  useEffect(() => {
    if (isVisible) {
      if (!wasVisibleRef.current) {
        setVisibleStartedAt(Date.now());
      }
      wasVisibleRef.current = true;
      setShouldRender(true);
      setIsExiting(false);
      return;
    }
    wasVisibleRef.current = false;
    if (!shouldRender) return;
    setIsExiting(true);
    const timer = setTimeout(() => {
      setShouldRender(false);
      setIsExiting(false);
    }, EXIT_ANIMATION_MS);
    return () => clearTimeout(timer);
  }, [isVisible, shouldRender]);

  useEffect(() => {
    setErrorsDismissed(false);
    setIsErrorsExpanded(false);
  }, [sessionStartedAt]);

  const sessionEntries = useMemo(
    () =>
      consoleEntries.filter(
        (entry) =>
          entry.timestamp >= sessionStartedAt &&
          (entry.type === "server" ||
            entry.level === "error" ||
            entry.level === "warn"),
      ),
    [consoleEntries, sessionStartedAt],
  );

  const errorMessages = useMemo(() => {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const entry of sessionEntries) {
      if (entry.level !== "error" || isDeprecationWarning(entry.message)) {
        continue;
      }
      const key = entry.message;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(entry.message);
    }
    return result;
  }, [sessionEntries]);

  const latestServerLine = useMemo(() => {
    for (let i = sessionEntries.length - 1; i >= 0; i--) {
      const entry = sessionEntries[i];
      if (entry.type === "server" && entry.level === "info") {
        return entry.message.split("\n")[0];
      }
    }
    return null;
  }, [sessionEntries]);

  useEffect(() => {
    const el = logListRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [sessionEntries.length]);

  const handleFixAllErrors = () => {
    if (!selectedChatId || errorMessages.length === 0) return;
    const includedErrorMessages = errorMessages.slice(0, MAX_ERRORS_FOR_AI_FIX);
    const count = includedErrorMessages.length;
    const intro = PREVIEW_STARTUP_FIX_INTRO(count);
    const omittedCount = errorMessages.length - includedErrorMessages.length;
    const body = `Error log excerpts (JSON):\n${JSON.stringify(
      includedErrorMessages.map((msg, i) => ({
        index: i + 1,
        message: sanitizePreviewErrorForPrompt(msg),
      })),
      null,
      2,
    )}${omittedCount > 0 ? `\n\n${omittedCount} additional error(s) omitted.` : ""}`;
    streamMessage({ prompt: `${intro}\n\n${body}`, chatId: selectedChatId });
  };

  if (!shouldRender) return null;

  const showErrorBanner = errorMessages.length > 0 && !errorsDismissed;
  const errorCount = errorMessages.length;

  return (
    <div
      data-testid="preview-loading-screen"
      className={cn(
        "absolute inset-0 flex items-center justify-center p-4 sm:p-6",
        "bg-gradient-to-br from-background/70 via-background/75 to-background/85 backdrop-blur-sm",
        "transition-all ease-in-out",
        isExiting
          ? "translate-y-full opacity-0 pointer-events-none"
          : "translate-y-0 opacity-100",
      )}
      style={{ transitionDuration: `${EXIT_ANIMATION_MS}ms` }}
    >
      <div
        data-testid="preview-loading-card"
        className={cn(
          "w-full max-w-2xl max-h-full flex flex-col",
          "bg-[var(--background-darkest)] rounded-xl shadow-2xl ring-1 ring-border/70 overflow-hidden",
          "transition-transform ease-out",
          isExiting ? "scale-95" : "scale-100",
        )}
        style={{ transitionDuration: `${EXIT_ANIMATION_MS}ms` }}
      >
        {/* Sticky status bar */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-[var(--background-darkest)] flex-shrink-0">
          <Loader2 className="size-4 animate-spin text-primary flex-shrink-0" />
          <span className="text-sm font-medium text-foreground flex-shrink-0">
            Preparing preview
          </span>
          {latestServerLine && (
            <>
              <span className="text-xs text-muted-foreground flex-shrink-0">
                ·
              </span>
              <span
                className="text-xs text-muted-foreground truncate font-mono min-w-0"
                data-testid="preview-loading-latest-server-line"
              >
                {latestServerLine}
              </span>
            </>
          )}
        </div>

        {/* Log stream */}
        <div className="relative flex-1 min-h-0">
          <div
            className="pointer-events-none absolute inset-x-0 top-0 z-10 h-6 bg-gradient-to-b from-[var(--background-darkest)] to-transparent"
            aria-hidden
          />
          <div
            ref={logListRef}
            className="h-full overflow-y-auto px-3 py-2 font-mono text-xs"
            data-testid="preview-loading-log-list"
          >
            {sessionEntries.length === 0 ? (
              <p className="italic text-muted-foreground">
                Waiting for server logs…
              </p>
            ) : (
              sessionEntries.map((entry, i) => (
                <LogRow key={`${entry.timestamp}-${i}`} entry={entry} />
              ))
            )}
          </div>
        </div>

        {/* Sticky error footer */}
        {showErrorBanner && (
          <div
            data-testid="preview-loading-error-banner"
            className="flex-shrink-0 border-t border-red-300/40 dark:border-red-900/50 bg-red-50/90 dark:bg-red-950/40 backdrop-blur-sm"
          >
            {isErrorsExpanded && (
              <ul className="px-3 py-2 max-h-32 overflow-y-auto border-b border-red-300/30 dark:border-red-900/30 space-y-0.5">
                {errorMessages.map((msg, i) => (
                  <li
                    key={i}
                    className="text-xs font-mono text-red-700 dark:text-red-300 truncate"
                    title={msg}
                  >
                    • {msg.split("\n")[0]}
                  </li>
                ))}
              </ul>
            )}
            <div className="flex items-center gap-2 px-3 py-2">
              <button
                type="button"
                onClick={() => setIsErrorsExpanded((v) => !v)}
                className="flex items-center gap-1.5 text-red-700 dark:text-red-300 hover:opacity-80 cursor-pointer"
                aria-expanded={isErrorsExpanded}
                data-testid="preview-loading-error-toggle"
              >
                <AlertTriangle size={14} className="flex-shrink-0" />
                <span className="text-sm font-medium">
                  {errorCount} error(s)
                </span>
                {isErrorsExpanded ? (
                  <ChevronUp size={14} className="flex-shrink-0" />
                ) : (
                  <ChevronDown size={14} className="flex-shrink-0" />
                )}
              </button>
              <button
                type="button"
                onClick={() => setErrorsDismissed(true)}
                className="p-1 rounded text-red-500 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/40 flex-shrink-0 cursor-pointer"
                aria-label="Dismiss errors"
                data-testid="preview-loading-error-dismiss"
              >
                <X size={14} />
              </button>
              <div className="flex-1" />
              <button
                type="button"
                onClick={handleFixAllErrors}
                disabled={isStreaming || !selectedChatId}
                className="cursor-pointer flex items-center gap-1 px-2.5 py-1 bg-red-600 hover:bg-red-700 dark:bg-red-600 dark:hover:bg-red-500 text-white rounded text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                data-testid="preview-loading-fix-errors-button"
              >
                <Sparkles size={14} />
                <span>Fix {errorCount} error(s) with AI</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function LogRow({ entry }: { entry: ConsoleEntry }) {
  const time = formatTime(entry.timestamp);
  const level = displayLevel(entry);
  const chipClass =
    level === "error"
      ? "bg-red-500/15 text-red-600 dark:text-red-400"
      : level === "warn"
        ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
        : "bg-zinc-500/15 text-zinc-600 dark:text-zinc-400";
  const accentClass =
    level === "error"
      ? "border-l-2 border-red-500/60 pl-2"
      : level === "warn"
        ? "border-l-2 border-amber-500/60 pl-2"
        : "pl-[10px]";
  return (
    <div
      className={cn(
        "flex items-start gap-2 py-0.5 whitespace-pre-wrap break-words",
        accentClass,
      )}
    >
      <span className="text-zinc-500 dark:text-zinc-500 shrink-0 select-none tabular-nums">
        {time}
      </span>
      <span
        className={cn(
          "px-1.5 rounded text-[10px] uppercase tracking-wide shrink-0 leading-5",
          chipClass,
        )}
      >
        {level}
      </span>
      <span className="flex-1 min-w-0 text-zinc-700 dark:text-zinc-200">
        {entry.message}
      </span>
    </div>
  );
}
