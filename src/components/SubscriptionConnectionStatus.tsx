import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { useSubscriptionAccount } from "@/hooks/useSubscriptionAccount";
import { useSettings } from "@/hooks/useSettings";
import { useDeepLink } from "@/contexts/DeepLinkContext";
import { queryKeys } from "@/lib/queryKeys";
import { ipc } from "@/ipc/types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "./ui/dialog";
import { Button } from "./ui/button";

/** Mounted once, so closing the picker does not interrupt sign-in completion. */
export function SubscriptionConnectionStatus() {
  const status = useSubscriptionAccount();
  const client = useQueryClient();
  const { lastDeepLink, clearLastDeepLink } = useDeepLink();
  useEffect(() => {
    if (lastDeepLink?.type !== "chatgpt-connected") return;
    void client.invalidateQueries({ queryKey: queryKeys.settings.all });
    clearLastDeepLink();
  }, [lastDeepLink, clearLastDeepLink, client]);
  useEffect(() => {
    if (status.data?.celebrationPending)
      void client.invalidateQueries({ queryKey: queryKeys.settings.user });
  }, [status.data?.celebrationPending, client]);
  const close = async () => {
    await ipc.settings.acknowledgeSubscriptionConnection();
    await client.invalidateQueries({
      queryKey: queryKeys.settings.codexSubscription,
    });
  };
  return (
    <Dialog
      open={Boolean(status.data?.connected && status.data.celebrationPending)}
      onOpenChange={(open) => {
        if (!open) void close();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="mx-auto mb-3 rounded-full bg-primary/10 p-4 text-primary">
            <Sparkles className="size-8" />
          </div>
          <DialogTitle>Enjoy your extra Dyad usage!</DialogTitle>
          <DialogDescription>
            Your ChatGPT subscription is connected.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <p>
            Uses your ChatGPT subscription for eligible models (marked in the
            model list).
          </p>
          <p>Uses up to 1.5 Dyad Pro credits / 1 million tokens processed.</p>
        </div>
        <DialogFooter>
          <Button className="w-full" onClick={() => void close()}>
            Let's build
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function SubscriptionLimitBanner() {
  const { settings } = useSettings();
  const status = useSubscriptionAccount();
  if (
    !settings?.enableDyadPro ||
    settings.proModelUsage === "pro" ||
    !status.data?.connected ||
    !status.data.limitReached
  )
    return null;
  return (
    <div
      role="status"
      className="mx-3 mb-2 rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs text-muted-foreground"
    >
      You've reached a ChatGPT subscription usage limit. Upgrade your ChatGPT
      subscription tier or switch to Pro credit usage by selecting{" "}
      <strong>Pro credits</strong> under <strong>Model usage</strong> in the Pro
      menu.
    </div>
  );
}
