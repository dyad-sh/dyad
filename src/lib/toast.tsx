import { toast } from "sonner";
import { PostHog } from "posthog-js";
import React from "react";
import { CustomErrorToast } from "../components/CustomErrorToast";
import { InputRequestToast } from "../components/InputRequestToast";
import { McpConsentToast } from "../components/McpConsentToast";

/**
 * Toast utility functions for consistent notifications across the app
 */

/**
 * Shows a success toast.
 * @param {string} message - The message to display.
 */
export const showSuccess = (message: string) => {
  toast.success(message);
};

/**
 * Shows an error toast.
 * @param {any} message - The error message to display.
 * @returns {string | number} The ID of the toast.
 */
export const showError = (message: any) => {
  const errorMessage = message.toString();
  console.error(message);

  const onCopy = (toastId: string | number) => {
    navigator.clipboard.writeText(errorMessage);

    // Update the toast to show the 'copied' state
    toast.custom(
      (t) => (
        <CustomErrorToast
          message={errorMessage}
          toastId={t}
          copied={true}
          onCopy={() => onCopy(t)}
        />
      ),
      { id: toastId, duration: Infinity },
    );

    // After 2 seconds, revert the toast back to the original state
    setTimeout(() => {
      toast.custom(
        (t) => (
          <CustomErrorToast
            message={errorMessage}
            toastId={t}
            copied={false}
            onCopy={() => onCopy(t)}
          />
        ),
        { id: toastId, duration: Infinity },
      );
    }, 2000);
  };

  // Use custom error toast with enhanced features
  const toastId = toast.custom(
    (t) => (
      <CustomErrorToast
        message={errorMessage}
        toastId={t}
        onCopy={() => onCopy(t)}
      />
    ),
    { duration: 8_000 },
  );

  return toastId;
};

/**
 * Shows a warning toast.
 * @param {string} message - The warning message to display.
 */
export const showWarning = (message: string) => {
  toast.warning(message);
  console.warn(message);
};

/**
 * Shows an info toast.
 * @param {string} message - The info message to display.
 */
export const showInfo = (message: string) => {
  toast.info(message);
};

/**
 * Shows an input request toast for interactive prompts (y/n).
 * @param {string} message - The prompt message to display.
 * @param {(response: "y" | "n") => void} onResponse - The callback function called when the user responds.
 * @returns {string | number} The ID of the toast.
 */
export const showInputRequest = (
  message: string,
  onResponse: (response: "y" | "n") => void,
) => {
  const toastId = toast.custom(
    (t) => (
      <InputRequestToast
        message={message}
        toastId={t}
        onResponse={onResponse}
      />
    ),
    { duration: Infinity }, // Don't auto-close
  );

  return toastId;
};

/**
 * Shows a toast for MCP tool consent.
 * @param {object} args - The arguments for the toast.
 * @param {string} args.serverName - The name of the server.
 * @param {string} args.toolName - The name of the tool.
 * @param {string | null} [args.toolDescription] - A description of the tool.
 * @param {string | null} [args.inputPreview] - A preview of the input.
 * @param {(d: "accept-once" | "accept-always" | "decline") => void} args.onDecision - The callback for the user's decision.
 * @returns {string | number} The ID of the toast.
 */
export function showMcpConsentToast(args: {
  serverName: string;
  toolName: string;
  toolDescription?: string | null;
  inputPreview?: string | null;
  onDecision: (d: "accept-once" | "accept-always" | "decline") => void;
}) {
  const toastId = toast.custom(
    (t) => (
      <McpConsentToast
        toastId={t}
        serverName={args.serverName}
        toolName={args.toolName}
        toolDescription={args.toolDescription}
        inputPreview={args.inputPreview}
        onDecision={args.onDecision}
      />
    ),
    { duration: Infinity },
  );
  return toastId;
}

/**
 * Shows a toast for extra files that were changed outside of Dyad.
 * @param {object} args - The arguments for the toast.
 * @param {string[]} args.files - The files that were changed.
 * @param {string} [args.error] - An error message.
 * @param {PostHog} args.posthog - The PostHog instance.
 */
export const showExtraFilesToast = ({
  files,
  error,
  posthog,
}: {
  files: string[];
  error?: string;
  posthog: PostHog;
}) => {
  if (error) {
    showError(
      `Error committing files ${files.join(", ")} changed outside of Dyad: ${error}`,
    );
    posthog.capture("extra-files:error", {
      files: files,
      error,
    });
  } else {
    showWarning(
      `Files changed outside of Dyad have automatically been committed:
    \n\n${files.join("\n")}`,
    );
    posthog.capture("extra-files:warning", {
      files: files,
    });
  }
};

// Re-export for direct use
export { toast };
