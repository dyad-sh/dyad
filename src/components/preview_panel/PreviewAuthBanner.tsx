import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import type { PreviewAuthStatus } from "@/app_run/state";

export function PreviewAuthBanner({
  status,
  onRetry,
  disabled,
}: {
  status?: PreviewAuthStatus;
  onRetry: () => void;
  disabled?: boolean;
}) {
  if (!status) return null;
  const pending = status.state === "pending";
  return (
    <div
      role="status"
      className="flex shrink-0 items-center gap-3 border-b border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm"
      data-testid="preview-auth-banner"
    >
      {pending && (
        <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden="true" />
      )}
      <p className="min-w-0 flex-1">
        {pending
          ? status.provider === "neon"
            ? "Registering this app's preview address with Neon in the background. OAuth sign-in and authentication redirects may not work until registration finishes."
            : "Registering this app's preview redirect URLs with Supabase in the background. Authentication redirects may not work until registration finishes."
          : status.message}
      </p>
      {!pending && (
        <Button
          variant="outline"
          size="sm"
          onClick={onRetry}
          disabled={disabled}
        >
          Restart and retry
        </Button>
      )}
    </div>
  );
}
