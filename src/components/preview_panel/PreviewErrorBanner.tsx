import { useState } from "react";
import { ChevronRight, Lightbulb, Sparkles, X } from "lucide-react";
import { CopyErrorMessage } from "@/components/CopyErrorMessage";
import { useStreamChat } from "@/hooks/useStreamChat";
import { cn } from "@/lib/utils";

interface PreviewErrorBannerProps {
  error:
    | {
        message: string;
        source: "preview-app" | "dyad-app" | "dyad-sync";
      }
    | undefined;
  onDismiss: () => void;
  onAIFix: () => void;
}

export function PreviewErrorBanner({
  error,
  onDismiss,
  onAIFix,
}: PreviewErrorBannerProps) {
  const [isBannerCollapsed, setIsBannerCollapsed] = useState(false);
  const [isErrorMessageCollapsed, setIsErrorMessageCollapsed] = useState(true);
  const { isStreaming } = useStreamChat();

  if (!error) return null;

  const isDockerError = error.message.includes("Cannot connect to the Docker");
  const isInternalDyadError = error.source === "dyad-app";
  const isSyncError = error.source === "dyad-sync";

  const getTruncatedError = () => {
    const firstLine = error.message.split("\n")[0];
    const snippetLength = 250;
    const snippet = error.message.substring(0, snippetLength);
    return firstLine.length < snippet.length
      ? firstLine
      : snippet + (snippet.length === snippetLength ? "..." : "");
  };

  return (
    <div
      className="absolute top-2 left-2 right-2 z-10 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-md shadow-sm p-2"
      data-testid="preview-error-banner"
    >
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss error banner"
        className="absolute top-1 left-1 p-1 hover:bg-red-100 dark:hover:bg-red-900 rounded"
      >
        <X size={14} className="text-red-500 dark:text-red-400" />
      </button>
      <button
        type="button"
        onClick={() => setIsBannerCollapsed((collapsed) => !collapsed)}
        aria-label={
          isBannerCollapsed ? "Expand error banner" : "Collapse error banner"
        }
        aria-expanded={!isBannerCollapsed}
        aria-controls="preview-error-banner-content"
        className="absolute top-1 left-7 p-1 hover:bg-red-100 dark:hover:bg-red-900 rounded"
        data-testid="preview-error-banner-toggle"
      >
        <ChevronRight
          size={14}
          className={cn(
            "text-red-500 dark:text-red-400 transform transition-transform",
            !isBannerCollapsed && "rotate-90",
          )}
        />
      </button>

      {(isInternalDyadError || isSyncError) && (
        <div className="absolute top-1 right-1 p-1 bg-red-100 dark:bg-red-900 rounded-md text-xs font-medium text-red-700 dark:text-red-300">
          {isSyncError ? "Cloud sync issue" : "Internal Dyad error"}
        </div>
      )}

      {isBannerCollapsed ? (
        <div
          className={cn(
            "pl-12 pr-1 py-1 text-xs font-mono text-red-700 dark:text-red-300 truncate",
            (isInternalDyadError || isSyncError) && "pr-32",
          )}
          title={error.message}
        >
          {getTruncatedError()}
        </div>
      ) : (
        <div id="preview-error-banner-content">
          {/* Error message in the middle */}
          <div
            className={cn(
              "pl-12 pr-6 py-1 text-sm",
              (isInternalDyadError || isSyncError) && "pt-6",
            )}
          >
            <button
              type="button"
              className="w-full text-left text-red-700 dark:text-red-300 text-wrap font-mono whitespace-pre-wrap break-words text-xs cursor-pointer flex gap-1 items-start"
              onClick={() =>
                setIsErrorMessageCollapsed((collapsed) => !collapsed)
              }
              aria-label={
                isErrorMessageCollapsed
                  ? `Show full error message: ${getTruncatedError()}`
                  : `Hide full error message: ${error.message}`
              }
              aria-expanded={!isErrorMessageCollapsed}
            >
              <ChevronRight
                size={14}
                className={cn(
                  "mt-0.5 flex-shrink-0 transform transition-transform",
                  !isErrorMessageCollapsed && "rotate-90",
                )}
              />

              <span>
                {isErrorMessageCollapsed ? getTruncatedError() : error.message}
              </span>
            </button>
          </div>

          {/* Tip message */}
          <div className="mt-2 px-6">
            <div className="relative p-2 bg-red-100 dark:bg-red-900 rounded-sm flex gap-1 items-center">
              <div>
                <Lightbulb
                  size={16}
                  className="text-red-800 dark:text-red-300"
                />
              </div>
              <span className="text-sm text-red-700 dark:text-red-200">
                <span className="font-medium">Tip: </span>
                {isDockerError
                  ? "Make sure Docker Desktop is running and try restarting the app."
                  : isSyncError
                    ? "Dyad could not upload your latest local changes to the cloud sandbox. Check your network connection or wait for sync to recover."
                    : isInternalDyadError
                      ? "Try restarting the Dyad app or restarting your computer to see if that fixes the error."
                      : "Check if restarting the app fixes the error."}
              </span>
            </div>
          </div>

          {/* Action buttons at the bottom */}
          {!isDockerError && error.source === "preview-app" && (
            <div className="mt-3 px-6 flex justify-end gap-2">
              <CopyErrorMessage errorMessage={error.message} />
              <button
                type="button"
                disabled={isStreaming}
                onClick={onAIFix}
                className="cursor-pointer flex items-center space-x-1 px-2 py-1 bg-red-500 dark:bg-red-600 text-white rounded text-sm hover:bg-red-600 dark:hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Sparkles size={14} />
                <span>Fix error with AI</span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
