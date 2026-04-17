import { toast as sonnerToast } from "sonner";

interface ToastOptions {
  title?: string;
  description?: string;
  variant?: "default" | "destructive";
}

/**
 * shadcn/ui-style toast adapter wrapping sonner.
 * The CreateAssetWizard calls `toast({ title, description, variant })`.
 */
export function toast(opts: ToastOptions) {
  const message = opts.title
    ? opts.description
      ? `${opts.title}: ${opts.description}`
      : opts.title
    : opts.description ?? "";

  if (opts.variant === "destructive") {
    sonnerToast.error(message);
  } else {
    sonnerToast.success(message);
  }
}

export function useToast() {
  return { toast };
}
