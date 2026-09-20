import { Button } from "@/components/ui/button";

export function NeonAuthWarning({
  message,
  onRetry,
  disabled,
}: {
  message?: string;
  onRetry: () => void;
  disabled?: boolean;
}) {
  if (!message) return null;
  return (
    <div
      role="status"
      className="flex shrink-0 items-center gap-3 border-b border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm"
      data-testid="neon-auth-warning"
    >
      <p className="min-w-0 flex-1">{message}</p>
      <Button variant="outline" size="sm" onClick={onRetry} disabled={disabled}>
        Restart and retry
      </Button>
    </div>
  );
}
