import { useEffect, useMemo, useRef, useState } from "react";
import { useAtomValue } from "jotai";
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Cog,
  Loader2,
  Sparkles,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ConsoleEntry } from "@/ipc/types";
import {
  currentConsoleEntriesAtom,
  currentPreviewAppExitAtom,
  currentPreviewRunStartedAtAtom,
  type PreviewAppExit,
} from "@/atoms/previewRuntimeAtoms";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { selectedChatIdAtom } from "@/atoms/chatAtoms";
import { useRunApp } from "@/hooks/useRunApp";
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

// Node/npm print deprecations and warnings to stderr, so they surface here as
// level="error" even though they aren't actionable failures. Treat them as
// warnings: don't count them in the error banner, and render with warn styling.
export function isWarningMessage(message: string): boolean {
  return (
    /DeprecationWarning/i.test(message) ||
    /Deprecation:\s/i.test(message) ||
    /npm warn/i.test(message)
  );
}

export function isPreviewErrorMessage(message: string): boolean {
  return /\bERR_PNPM_[A-Z0-9_]+\b/.test(message);
}

function isActionableErrorEntry(entry: ConsoleEntry): boolean {
  if (isWarningMessage(entry.message)) {
    return false;
  }
  return entry.level === "error" || isPreviewErrorMessage(entry.message);
}

function displayLevel(entry: ConsoleEntry): ConsoleEntry["level"] {
  if (entry.level === "error" && isWarningMessage(entry.message)) {
    return "warn";
  }
  if (entry.level === "info" && isPreviewErrorMessage(entry.message)) {
    return "error";
  }
  return entry.level;
}

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

export function didPreviewCommandFail({
  previewAppExit,
  sessionStartedAt,
  currentAppId,
}: {
  previewAppExit: PreviewAppExit | null;
  sessionStartedAt: number;
  currentAppId: number | null;
}) {
  return (
    previewAppExit !== null &&
    previewAppExit.appId === currentAppId &&
    previewAppExit.timestamp >= sessionStartedAt &&
    previewAppExit.exitCode !== null &&
    previewAppExit.exitCode !== 0
  );
}

export function shouldShowPreviewErrorBanner({
  errorMessages,
  previewAppExit,
  sessionStartedAt,
  currentAppId,
}: {
  errorMessages: string[];
  previewAppExit: PreviewAppExit | null;
  sessionStartedAt: number;
  currentAppId: number | null;
}) {
  return (
    errorMessages.length > 0 &&
    didPreviewCommandFail({ previewAppExit, sessionStartedAt, currentAppId })
  );
}

interface PreviewLoadingScreenProps {
  // True while the app is being spawned/restarted (useRunApp).
  loading: boolean;
  // True once the dev server is reachable and the iframe can render.
  // Until then we stay on the loading screen so users can see startup
  // logs and any errors that surface after spawn but before the server
  // is ready (e.g. a malformed package.json that fails npm).
  isAppUrlReady: boolean;
  // True when the preview failed before startup logs could explain the issue.
  // In that case the regular preview error banner is more actionable than a
  // persistent "waiting for logs" loading state.
  hasStartupError: boolean;
}

export function PreviewLoadingScreen({
  loading,
  isAppUrlReady,
  hasStartupError,
}: PreviewLoadingScreenProps) {
  const { t } = useTranslation("home");
  const consoleEntries = useAtomValue(currentConsoleEntriesAtom);
  const previewAppExit = useAtomValue(currentPreviewAppExitAtom);
  const previewRunStartedAt = useAtomValue(currentPreviewRunStartedAtAtom);
  const selectedAppId = useAtomValue(selectedAppIdAtom);
  const selectedChatId = useAtomValue(selectedChatIdAtom);
  const { streamMessage, isStreaming } = useStreamChat();
  const { restartApp } = useRunApp();

  const isVisible = loading || (!isAppUrlReady && !hasStartupError);

  const [isErrorsExpanded, setIsErrorsExpanded] = useState(false);
  const [visibleStartedAt, setVisibleStartedAt] = useState(Date.now());
  const wasVisibleRef = useRef<boolean>(isVisible);
  const logListRef = useRef<HTMLDivElement>(null);
  // Tail-follow: keep pinning to the bottom as new logs stream in, but only
  // while the user is already there. Once they scroll up to read earlier
  // output, stop auto-scrolling so they don't get yanked back down.
  const isAtBottomRef = useRef(true);

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
      return;
    }
    wasVisibleRef.current = false;
  }, [isVisible]);

  useEffect(() => {
    setIsErrorsExpanded(false);
    isAtBottomRef.current = true;
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
      if (!isActionableErrorEntry(entry)) {
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
    if (!el || !isAtBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [sessionEntries.length]);

  const handleLogScroll = () => {
    const el = logListRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    isAtBottomRef.current = distanceFromBottom < 8;
  };

  const handleRebuild = () => {
    void restartApp({ removeNodeModules: true });
  };

  const handleFixAllErrors = () => {
    if (!selectedChatId || errorMessages.length === 0) return;
    const includedErrorMessages = errorMessages.slice(0, MAX_ERRORS_FOR_AI_FIX);
    const count = includedErrorMessages.length;
    const intro = t("preview.loadingScreen.startupFixPrompt", { count });
    const omittedCount = errorMessages.length - includedErrorMessages.length;
    const body = `${t("preview.loadingScreen.errorLogExcerpts")}\n${JSON.stringify(
      includedErrorMessages.map((msg, i) => ({
        index: i + 1,
        message: sanitizePreviewErrorForPrompt(msg),
      })),
      null,
      2,
    )}${omittedCount > 0 ? `\n\n${t("preview.loadingScreen.additionalErrorsOmitted", { count: omittedCount })}` : ""}`;
    streamMessage({ prompt: `${intro}\n\n${body}`, chatId: selectedChatId });
  };

  if (!isVisible) return null;

  const showErrorBanner = shouldShowPreviewErrorBanner({
    errorMessages,
    previewAppExit,
    sessionStartedAt,
    currentAppId: selectedAppId,
  });
  const errorCount = errorMessages.length;

  return (
    <div
      data-testid="preview-loading-screen"
      className={cn(
        "absolute inset-0 flex flex-col items-center overflow-hidden p-4 sm:p-6",
        "bg-gradient-to-br from-background/70 via-background/75 to-background/85 backdrop-blur-sm",
      )}
    >
      <div
        data-testid="preview-loading-card"
        className={cn(
          "flex min-h-0 flex-1 w-full max-w-2xl flex-col",
          "bg-[var(--background-darkest)] rounded-xl shadow-2xl ring-1 ring-border/70 overflow-hidden",
        )}
      >
        {/* Sticky status bar */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-[var(--background-darkest)] flex-shrink-0">
          <Loader2 className="size-4 animate-spin text-primary flex-shrink-0" />
          <span className="text-sm font-medium text-foreground flex-shrink-0">
            {t("preview.loadingScreen.preparingPreview")}
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
            onScroll={handleLogScroll}
            className="h-full overflow-y-auto overscroll-contain px-3 py-2 font-mono text-xs"
            data-testid="preview-loading-log-list"
          >
            {sessionEntries.length === 0 ? (
              <p className="italic text-muted-foreground">
                {t("preview.loadingScreen.waitingForLogs")}
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
                  {t("preview.loadingScreen.errorSummary", {
                    count: errorCount,
                  })}
                </span>
                {isErrorsExpanded ? (
                  <ChevronUp size={14} className="flex-shrink-0" />
                ) : (
                  <ChevronDown size={14} className="flex-shrink-0" />
                )}
              </button>
              <div className="flex-1" />
              <button
                type="button"
                onClick={handleRebuild}
                disabled={loading}
                className="cursor-pointer flex items-center gap-1 px-2.5 py-1 border border-border text-foreground hover:bg-muted rounded text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                data-testid="preview-loading-rebuild-button"
              >
                <Cog size={14} />
                <span>{t("preview.rebuild")}</span>
              </button>
              <button
                type="button"
                onClick={handleFixAllErrors}
                disabled={isStreaming || !selectedChatId}
                className="cursor-pointer flex items-center gap-1 px-2.5 py-1 bg-red-600 hover:bg-red-700 dark:bg-red-600 dark:hover:bg-red-500 text-white rounded text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                data-testid="preview-loading-fix-errors-button"
              >
                <Sparkles size={14} />
                <span>
                  {t("preview.loadingScreen.fixErrorsWithAi", {
                    count: errorCount,
                  })}
                </span>
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
