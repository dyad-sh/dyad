import { atom, useAtom } from "jotai";
import { AlertTriangle, Clock3, Pause, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { usePostHog } from "posthog-js/react";
import { ipc, type SubscriptionStatus } from "@/ipc/types";
import { useSubscriptionStatus } from "@/hooks/useSubscriptionStatus";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const dismissedBillingAlertsAtom = atom<Set<string>>(new Set<string>());

function alertFingerprint(status: SubscriptionStatus) {
  return `${status.alert}:${status.effectiveAt ?? "none"}`;
}

export function SubscriptionStatusBanner() {
  const { t, i18n } = useTranslation("common");
  const posthog = usePostHog();
  const { data: status } = useSubscriptionStatus();
  const [dismissedAlerts, setDismissedAlerts] = useAtom(
    dismissedBillingAlertsAtom,
  );
  const shownFingerprints = useRef(new Set<string>());
  const previousAlert = useRef<SubscriptionStatus | null>(null);

  useEffect(() => {
    if (status?.alert) {
      const fingerprint = alertFingerprint(status);
      if (!shownFingerprints.current.has(fingerprint)) {
        shownFingerprints.current.add(fingerprint);
        posthog.capture("billing_nudge_shown", {
          alert: status.alert,
          has_effective_at: status.effectiveAt !== null,
        });
      }
      previousAlert.current = status;
      return;
    }

    if (status?.alert === null && previousAlert.current?.alert) {
      posthog.capture("billing_nudge_resolved", {
        alert: previousAlert.current.alert,
        has_effective_at: previousAlert.current.effectiveAt !== null,
      });
      previousAlert.current = null;
    }
  }, [posthog, status]);

  if (!status?.alert) {
    return null;
  }

  const fingerprint = alertFingerprint(status);
  if (dismissedAlerts.has(fingerprint)) {
    return null;
  }

  const isPastDue = status.alert === "payment_past_due";
  const isEnding = status.alert === "subscription_ending";
  const formattedDate = status.effectiveAt
    ? new Intl.DateTimeFormat(i18n.resolvedLanguage ?? i18n.language, {
        dateStyle: "medium",
      }).format(new Date(status.effectiveAt))
    : null;
  const message = isPastDue
    ? t("billingNudge.paymentPastDue")
    : isEnding
      ? t("billingNudge.subscriptionEnding", { date: formattedDate })
      : t("billingNudge.subscriptionPaused");
  const actionLabel = isPastDue
    ? t("billingNudge.managePaymentMethods")
    : isEnding
      ? t("billingNudge.manageSubscription")
      : t("billingNudge.resumeSubscription");
  const Icon = isPastDue ? AlertTriangle : isEnding ? Clock3 : Pause;

  return (
    <div
      role={isPastDue ? "alert" : "status"}
      className={cn(
        "flex w-full shrink-0 items-center gap-3 border-b px-4 py-2.5 text-sm",
        isPastDue
          ? "border-destructive/30 bg-destructive/10 text-destructive"
          : isEnding
            ? "border-amber-500/30 bg-amber-500/10 text-amber-950 dark:text-amber-100"
            : "border-blue-500/25 bg-blue-500/10 text-blue-950 dark:text-blue-100",
      )}
      data-testid="subscription-status-banner"
      data-alert={status.alert}
    >
      <Icon className="size-4 shrink-0" aria-hidden="true" />
      <p className="min-w-0 flex-1 leading-5">{message}</p>
      {status.actionUrl && (
        <Button
          type="button"
          size="sm"
          variant={isPastDue ? "destructive" : "outline"}
          className={cn(
            "h-7 shrink-0",
            !isPastDue &&
              "border-current/30 bg-background/80 hover:bg-background",
          )}
          onClick={() => {
            posthog.capture("billing_nudge_clicked", {
              alert: status.alert,
              has_effective_at: status.effectiveAt !== null,
            });
            ipc.system.openBillingAction(status.actionUrl!);
          }}
        >
          {actionLabel}
        </Button>
      )}
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="size-7 shrink-0 text-current hover:bg-black/5 hover:text-current dark:hover:bg-white/10"
        aria-label={t("billingNudge.dismiss")}
        onClick={() => {
          posthog.capture("billing_nudge_dismissed", {
            alert: status.alert,
            has_effective_at: status.effectiveAt !== null,
          });
          setDismissedAlerts((current) => {
            const next = new Set(current);
            next.add(fingerprint);
            return next;
          });
        }}
      >
        <X className="size-4" aria-hidden="true" />
      </Button>
    </div>
  );
}
