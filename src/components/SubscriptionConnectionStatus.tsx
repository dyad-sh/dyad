import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { useSubscriptionAccount } from "@/hooks/useSubscriptionAccount";
import { useFirstPromptProviderResume } from "@/first_prompt/FirstPromptProvider";
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
import { isDyadProEnabled } from "@/lib/schemas";

/** Mounted once, so closing the picker does not interrupt sign-in completion. */
export function SubscriptionConnectionStatus() {
  const { settings } = useSettings();
  const hasPro = settings && isDyadProEnabled(settings);
  const status = useSubscriptionAccount();
  const resumeFirstPrompt = useFirstPromptProviderResume();
  const [resumeRequested, setResumeRequested] = useState(false);
  const [resumeError, setResumeError] = useState<string>();
  const client = useQueryClient();
  const { lastDeepLink, clearLastDeepLink } = useDeepLink();
  useEffect(() => {
    if (lastDeepLink?.type !== "chatgpt-connected") return;
    void client.invalidateQueries({ queryKey: queryKeys.settings.all });
    clearLastDeepLink();
  }, [lastDeepLink, clearLastDeepLink, client]);
  useEffect(() => {
    if (
      status.data?.connected &&
      !status.data.pending &&
      status.data.celebrationPending &&
      !status.data.setupError
    ) {
      setResumeRequested(true);
    } else if (
      !status.data?.connected ||
      status.data.pending ||
      status.data.setupError
    ) {
      setResumeRequested(false);
    }
  }, [
    status.data?.connected,
    status.data?.pending,
    status.data?.celebrationPending,
    status.data?.setupError,
  ]);
  useEffect(() => {
    if (
      !status.data?.connected ||
      status.data.pending ||
      !resumeRequested ||
      status.data.setupError
    )
      return;
    let cancelled = false;
    void client
      .fetchQuery({
        queryKey: queryKeys.settings.user,
        queryFn: () => ipc.settings.getUserSettings(),
        staleTime: 0,
        retry: 2,
        retryDelay: 250,
      })
      .then((updatedSettings) => {
        if (!cancelled) {
          setResumeError(undefined);
          resumeFirstPrompt(updatedSettings);
        }
      })
      .catch(() => {
        if (!cancelled)
          setResumeError(
            "Your prompt is still saved. Close this dialog and send it again to continue.",
          );
      });
    return () => {
      cancelled = true;
    };
  }, [
    status.data?.connected,
    status.data?.pending,
    resumeRequested,
    status.data?.setupError,
    client,
    resumeFirstPrompt,
  ]);
  const close = async () => {
    await ipc.settings.acknowledgeSubscriptionConnection();
    await client.invalidateQueries({
      queryKey: queryKeys.settings.codexSubscription,
    });
  };
  return (
    <Dialog
      open={Boolean(
        status.data?.connected &&
        !status.data.pending &&
        status.data.celebrationPending,
      )}
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
          {(status.data?.setupError || resumeError) && (
            <p role="alert">{status.data?.setupError ?? resumeError}</p>
          )}
          {(!settings || hasPro) && (
            <p>
              {!settings
                ? "Checking Dyad Pro status…"
                : "Uses up to 1.5 Dyad Pro credits / 1 million tokens processed."}
            </p>
          )}
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
    !settings ||
    settings.proModelUsage === "pro" ||
    settings.proModelUsage === "api-key" ||
    !status.data?.connected ||
    !status.data.limitReached
  )
    return null;
  return (
    <div
      role="status"
      className="mx-3 mb-2 rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs text-muted-foreground"
    >
      You've reached a ChatGPT subscription usage limit. Wait for your limit to
      reset or upgrade your ChatGPT subscription tier.
      {!isDyadProEnabled(settings) && (
        <>
          {" "}
          You can also disconnect ChatGPT in the Subscription menu to use your
          OpenAI API key.
        </>
      )}
      {isDyadProEnabled(settings) && (
        <>
          {" "}
          You can also select <strong>Pro credits</strong> under{" "}
          <strong>Model usage</strong> in the Pro menu.
        </>
      )}
    </div>
  );
}
