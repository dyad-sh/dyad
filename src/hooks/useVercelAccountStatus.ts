import { useQuery } from "@tanstack/react-query";
import { ipc, type VercelAccountStatus } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";

/**
 * Hook to fetch and manage Vercel account status.
 * Returns information about account blocks/warnings (e.g., fair use limits exceeded).
 */
export function useVercelAccountStatus(enabled: boolean = true) {
  const {
    data: accountStatus,
    isLoading,
    error,
    refetch,
  } = useQuery<VercelAccountStatus, Error>({
    queryKey: queryKeys.vercel.accountStatus,
    queryFn: () => {
      return ipc.vercel.getAccountStatus();
    },
    enabled,
    // Refetch every 5 minutes to keep status up-to-date
    staleTime: 5 * 60 * 1000,
    // Don't throw errors to UI, handle gracefully
    retry: false,
  });

  return {
    accountStatus,
    isLoading,
    error: error?.message || null,
    refetch,
    // Helper properties for common checks
    isSoftBlocked: accountStatus?.softBlock !== null,
    softBlockReason: accountStatus?.softBlock?.reason || null,
    blockedDueToOverageType:
      accountStatus?.softBlock?.blockedDueToOverageType || null,
  };
}

/**
 * Get a user-friendly message for a soft block reason.
 */
export function getSoftBlockMessage(
  reason: VercelAccountStatus["softBlock"] extends null
    ? never
    : NonNullable<VercelAccountStatus["softBlock"]>["reason"],
  blockedDueToOverageType?: string | null,
): string {
  switch (reason) {
    case "FAIR_USE_LIMITS_EXCEEDED":
      if (blockedDueToOverageType) {
        const overageTypeMessage = getOverageTypeMessage(
          blockedDueToOverageType,
        );
        return `Your Vercel account has exceeded fair use limits for ${overageTypeMessage}. Deployments may be paused until your usage resets or you upgrade your plan.`;
      }
      return "Your Vercel account has exceeded fair use limits. Deployments may be paused until your usage resets or you upgrade your plan.";
    case "SUBSCRIPTION_CANCELED":
      return "Your Vercel subscription has been canceled. Please reactivate your subscription to continue deploying.";
    case "SUBSCRIPTION_EXPIRED":
      return "Your Vercel subscription has expired. Please renew your subscription to continue deploying.";
    case "UNPAID_INVOICE":
      return "Your Vercel account has an unpaid invoice. Please pay your invoice to continue deploying.";
    case "ENTERPRISE_TRIAL_ENDED":
      return "Your Vercel enterprise trial has ended. Please upgrade to continue deploying.";
    case "BLOCKED_FOR_PLATFORM_ABUSE":
      return "Your Vercel account has been blocked due to platform policy violations. Please contact Vercel support.";
    default:
      return "Your Vercel account has a restriction that may affect deployments. Please check your Vercel dashboard for details.";
  }
}

/**
 * Get a user-friendly message for an overage type.
 */
function getOverageTypeMessage(overageType: string): string {
  const overageMessages: Record<string, string> = {
    bandwidth: "bandwidth",
    functionInvocation: "serverless function invocations",
    functionDuration: "serverless function duration",
    edgeMiddlewareInvocations: "edge middleware invocations",
    edgeFunctionExecutionUnits: "edge function execution",
    imageOptimizationTransformation: "image optimizations",
    serverlessFunctionExecution: "serverless function executions",
    dataCacheRead: "data cache reads",
    dataCacheWrite: "data cache writes",
    analyticsUsage: "analytics usage",
    artifacts: "build artifacts",
    webAnalyticsEvent: "web analytics events",
  };

  return (
    overageMessages[overageType] ||
    overageType
      .replace(/([A-Z])/g, " $1")
      .toLowerCase()
      .trim()
  );
}
