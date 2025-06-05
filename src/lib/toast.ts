import { toast } from "sonner";
import { PostHog } from "posthog-js";

/**
 * Toast utility functions for consistent notifications across the app
 */

/**
 * Show a success toast
 * @param message The message to display
 */
export const showSuccess = (message: string) => {
  toast.success(message);
};

/**
 * Show an error toast
 * @param message The error message to display
 */
export const showError = (message: any) => {
  toast.error(message.toString());
  console.error(message);
};

/**
 * Show a warning toast
 * @param message The warning message to display
 */
export const showWarning = (message: string) => {
  toast.warning(message);
  console.warn(message);
};

/**
 * Show an info toast
 * @param message The info message to display
 */
export const showInfo = (message: string) => {
  toast.info(message);
};

/**
 * Show a loading toast that can be updated with success/error
 * @param loadingMessage The message to show while loading
 * @param promise The promise to track
 * @param successMessage Optional success message
 * @param errorMessage Optional error message
 */
export const showLoading = <T>(
  loadingMessage: string,
  promise: Promise<T>,
  successMessage?: string,
  errorMessage?: string,
) => {
  return toast.promise(promise, {
    loading: loadingMessage,
    success: () => successMessage || "Operation completed successfully",
    error: (err) => errorMessage || `Error: ${err.message || "Unknown error"}`,
  });
};

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
