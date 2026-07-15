import { atom, useAtom } from "jotai";
import { AlertTriangle, Clock3, Pause, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { usePostHog } from "posthog-js/react";
import { ipc, type SubscriptionStatus } from "@/ipc/types";
import { useSubscriptionStatus } from "@/hooks/useSubscriptionStatus";
import { useUserBudgetInfo } from "@/hooks/useUserBudgetInfo";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const dismissedBillingAlertsAtom = atom<Set<string>>(new Set<string>());
const DAY_IN_MS = 24 * 60 * 60 * 1000;

function alertFingerprint(status: SubscriptionStatus) {
  return `${status.alert}:${status.effectiveAt ?? "none"}`;
}

export function SubscriptionStatusBanner() {
  const { t, i18n } = useTranslation("common");
  const posthog = usePostHog();
  const { data: status } = useSubscriptionStatus();
  const { userBudget } = useUserBudgetInfo({
    enabled: status?.alert === "subscription_ending",
  });
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
  const daysUntilEnd = status.effectiveAt
    ? Math.max(
        0,
        Math.ceil(
          (new Date(status.effectiveAt).getTime() - Date.now()) / DAY_IN_MS,
        ),
      )
    : null;
  const remainingCredits = userBudget
    ? Math.round(Math.max(0, userBudget.totalCredits - userBudget.usedCredits))
    : null;
  const formattedCredits =
    remainingCredits === null
      ? null
      : new Intl.NumberFormat(i18n.resolvedLanguage ?? i18n.language).format(
          remainingCredits,
        );
  const message = isPastDue
    ? t("billingNudge.paymentPastDue")
    : isEnding
      ? [
          t("billingNudge.subscriptionEnding", { count: daysUntilEnd ?? 0 }),
          remainingCredits === null
            ? null
            : t("billingNudge.creditsLost", {
                count: remainingCredits,
                credits: formattedCredits,
              }),
        ]
          .filter(Boolean)
          .join(" ")
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
        "flex min-h-11 w-full shrink-0 items-center gap-2.5 border-b px-4 py-1.5 text-sm text-foreground",
        isPastDue
          ? "border-destructive/30 bg-destructive/20"
          : isEnding
            ? "border-amber-500/25 bg-amber-500/8"
            : "border-blue-500/20 bg-blue-500/8",
      )}
      data-testid="subscription-status-banner"
      data-alert={status.alert}
    >
      <Icon
        className={cn(
          "size-4 shrink-0",
          isPastDue
            ? "text-destructive-foreground"
            : isEnding
              ? "text-amber-600 dark:text-amber-400"
              : "text-blue-600 dark:text-blue-400",
        )}
        aria-hidden="true"
      />
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-2">
        <p className="min-w-0 max-w-[75ch] leading-5">{message}</p>
        {status.actionUrl && (
          <Button
            type="button"
            size="sm"
            variant="default"
            className="h-8 shrink-0"
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
      </div>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="size-8 shrink-0 text-muted-foreground hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10"
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
