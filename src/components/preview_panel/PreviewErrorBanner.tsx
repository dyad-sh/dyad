import { useState } from "react";
import {
  CircleAlert,
  ChevronDown,
  ChevronUp,
  Lightbulb,
  Sparkles,
  X,
} from "lucide-react";
import { CopyErrorMessage } from "@/components/CopyErrorMessage";
import { useStreamChat } from "@/hooks/useStreamChat";
import type { PreviewError } from "@/preview_iframe/state";

interface PreviewErrorBannerProps {
  error: PreviewError;
  onDismiss: () => void;
  onAIFix: () => void;
}

export function PreviewErrorBanner({
  error,
  onDismiss,
  onAIFix,
}: PreviewErrorBannerProps) {
  const [isBannerCollapsed, setIsBannerCollapsed] = useState(false);
  const [areErrorDetailsVisible, setAreErrorDetailsVisible] = useState(false);
  const { isStreaming } = useStreamChat();

  const isDockerError = error.message.includes("Cannot connect to the Docker");
  const isInternalDyadError = error.source === "dyad-app";
  const isSyncError = error.source === "dyad-sync";

  const firstLine = error.message.split("\n")[0];
  const summaryWithoutErrorPrefix = firstLine.replace(/^Error:?\s+/i, "");
  const errorSummary = summaryWithoutErrorPrefix || firstLine;

  return (
    <div
      className="absolute top-2 left-2 right-2 z-10 rounded-md border border-red-200 bg-red-50 p-3 shadow-sm dark:border-red-800 dark:bg-red-950"
      data-testid="preview-error-banner"
    >
      <div className="flex items-start gap-2">
        <CircleAlert
          aria-hidden="true"
          size={16}
          className="mt-0.5 shrink-0 text-red-600 dark:text-red-400"
        />

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <p
              className="truncate text-sm font-medium text-red-800 dark:text-red-200"
              title={error.message}
            >
              {errorSummary}
            </p>
            {(isInternalDyadError || isSyncError) && (
              <span className="shrink-0 rounded bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-700 dark:bg-red-900 dark:text-red-300">
                {isSyncError ? "Cloud sync issue" : "Internal Dyad error"}
              </span>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            onClick={() => setIsBannerCollapsed((collapsed) => !collapsed)}
            aria-label={
              isBannerCollapsed
                ? "Expand error banner"
                : "Collapse error banner"
            }
            aria-expanded={!isBannerCollapsed}
            aria-controls="preview-error-banner-content"
            className="rounded p-1 text-red-500 transition-colors hover:bg-red-100 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-900 dark:hover:text-red-200"
            data-testid="preview-error-banner-toggle"
          >
            {isBannerCollapsed ? (
              <ChevronDown aria-hidden="true" size={14} />
            ) : (
              <ChevronUp aria-hidden="true" size={14} />
            )}
          </button>
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss error banner"
            className="rounded p-1 text-red-500 transition-colors hover:bg-red-100 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-900 dark:hover:text-red-200"
          >
            <X aria-hidden="true" size={14} />
          </button>
        </div>
      </div>

      {!isBannerCollapsed && (
        <div id="preview-error-banner-content" className="mt-2 pl-6">
          <button
            type="button"
            className="text-xs font-medium text-red-700 underline-offset-2 hover:text-red-900 hover:underline dark:text-red-300 dark:hover:text-red-100"
            onClick={() =>
              setAreErrorDetailsVisible((detailsVisible) => !detailsVisible)
            }
            aria-expanded={areErrorDetailsVisible}
          >
            {areErrorDetailsVisible ? "Hide details" : "Show details"}
          </button>

          {areErrorDetailsVisible && (
            <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-xs text-red-700 dark:text-red-300">
              {error.message}
            </pre>
          )}

          <div className="mt-2 flex items-start gap-2 text-sm text-red-700 dark:text-red-200">
            <Lightbulb
              aria-hidden="true"
              size={15}
              className="mt-0.5 shrink-0 text-red-600 dark:text-red-300"
            />
            <span>
              {isDockerError
                ? "Make sure Docker Desktop is running and try restarting the app."
                : isSyncError
                  ? "Dyad could not upload your latest local changes to the cloud sandbox. Check your network connection or wait for sync to recover."
                  : isInternalDyadError
                    ? "Try restarting the Dyad app or your computer."
                    : "Try restarting the app."}
            </span>
          </div>

          {!isDockerError && error.source === "preview-app" && (
            <div className="mt-3 flex justify-end gap-2">
              <CopyErrorMessage errorMessage={error.message} />
              <button
                type="button"
                disabled={isStreaming}
                onClick={onAIFix}
                className="flex cursor-pointer items-center gap-1 rounded bg-red-500 px-2 py-1 text-sm text-white transition-colors hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-red-600 dark:hover:bg-red-700"
              >
                <Sparkles aria-hidden="true" size={14} />
                <span>Fix error with AI</span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
