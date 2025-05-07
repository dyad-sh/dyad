import { toast } from "sonner";

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
    success: (data) => successMessage || "Operation completed successfully",
    error: (err) => errorMessage || `Error: ${err.message || "Unknown error"}`,
  });
};

export const showUncommittedFilesWarning = (files: string[]) => {
  showWarning(
    `Some changed files were not committed. Please use git to manually commit them.
    \n\n${files.join("\n")}`,
  );
};

// Re-export for direct use
export { toast };
