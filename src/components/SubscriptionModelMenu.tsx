import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ipc } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";
import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import { useSubscriptionAccount } from "@/hooks/useSubscriptionAccount";
import { useSettings } from "@/hooks/useSettings";
import { hasDyadProKey } from "@/lib/schemas";
import { useState } from "react";

export function SubscriptionModelMenu() {
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const status = useSubscriptionAccount(open);
  const { settings } = useSettings();
  const hasPro = settings && hasDyadProKey(settings);
  const action = useMutation({
    mutationFn: (kind: "connect" | "disconnect") =>
      kind === "connect"
        ? ipc.settings.connectCodexSubscription({ acceptCharges: true })
        : ipc.settings.disconnectCodexSubscription(),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: queryKeys.settings.all });
    },
  });
  const connected = status.data?.connected;
  return (
    <DropdownMenuSub open={open} onOpenChange={setOpen}>
      <DropdownMenuSubTrigger
        openOnHover
        delay={100}
        closeDelay={150}
        aria-label={`Subscription${connected ? ", ChatGPT connected" : ""}. Open submenu.`}
      >
        Subscription
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-80">
        <DropdownMenuLabel>ChatGPT subscription</DropdownMenuLabel>
        <p className="px-2 py-2 text-sm text-muted-foreground">
          Get up to 5x usage with Pro credits by connecting your ChatGPT
          subscription
        </p>
        <p className="px-2 pb-2 text-xs text-muted-foreground">
          Uses up to 1.5 Pro credits / 1M tokens
        </p>
        {(status.error || action.error || status.data?.error) && (
          <p role="alert" className="px-2 py-1 text-xs text-destructive">
            {action.error?.message ??
              status.error?.message ??
              status.data?.error}
          </p>
        )}
        <DropdownMenuItem
          closeOnClick={false}
          disabled={
            action.isPending ||
            status.isLoading ||
            status.data?.pending ||
            (!connected && !hasPro)
          }
          onClick={() => action.mutate(connected ? "disconnect" : "connect")}
        >
          {status.data?.pending
            ? "Waiting for browser sign-in…"
            : connected
              ? "Disconnect ChatGPT"
              : "Connect with ChatGPT"}
        </DropdownMenuItem>
        {!hasPro && !connected && (
          <p className="px-2 py-1 text-xs text-muted-foreground">
            Connect Dyad Pro first to use this feature.
          </p>
        )}
        {status.data?.pending && (
          <DropdownMenuItem
            closeOnClick={false}
            onClick={() => action.mutate("disconnect")}
          >
            Cancel sign-in
          </DropdownMenuItem>
        )}
        {connected && status.data && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Usage limits</DropdownMenuLabel>
            {status.data.windows.map((window) => (
              <div key={window.windowSeconds} className="px-2 py-2 space-y-1">
                <div className="flex justify-between text-xs">
                  <span>
                    {window.windowSeconds === 18000
                      ? "5-hour"
                      : window.windowSeconds === 604800
                        ? "Weekly"
                        : `${window.windowSeconds / 3600}-hour`}
                  </span>
                  <span>{Math.round(window.usedPercent)}% used</span>
                </div>
                <progress
                  aria-label={`${window.windowSeconds / 3600}-hour usage`}
                  className="w-full h-1.5 accent-primary"
                  max={100}
                  value={Math.min(100, window.usedPercent)}
                />
                <p className="text-xs text-muted-foreground">
                  Resets {new Date(window.resetsAt).toLocaleString()}
                </p>
              </div>
            ))}
            {(status.data.limitsError || !status.data.windows.length) && (
              <p className="px-2 py-1 text-xs text-muted-foreground">
                {status.data.limitsError ??
                  "Usage limits are not available for this account."}
              </p>
            )}
            {status.data.modelsError && (
              <p className="px-2 py-1 text-xs text-muted-foreground">
                {status.data.modelsError}
              </p>
            )}
          </>
        )}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
