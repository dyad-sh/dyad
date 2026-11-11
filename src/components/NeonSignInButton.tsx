import { useEffect, useRef } from "react";
import {
  type QueryClient,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { NeonLogo } from "@/components/NeonLogo";
import { useTheme } from "@/contexts/ThemeContext";
import {
  acknowledgeConnectionFlow,
  cancelConnectionFlow,
  startConnectionFlow,
  useConnectionFlow,
} from "@/hooks/useConnectionFlow";
import { useSettings } from "@/hooks/useSettings";
import { buildOAuthLoginUrl } from "@/connection_flow/oauth_deep_link";
import { ipc, type App } from "@/ipc/types";
import { getErrorMessage } from "@/lib/errors";
import { queryKeys } from "@/lib/queryKeys";

interface NeonSignInInitiator {
  appId?: number;
  reconnect: boolean;
  /** The initiating button is mounted and will handle the outcome itself. */
  mounted: boolean;
}

// Module scope, so a sign-in outcome is still handled and acknowledged after
// the initiating button unmounts. The chat banner can be dismissed, and every
// notice unmounts on navigation while the browser OAuth step is open.
const neonSignInInitiators = new Map<string, NeonSignInInitiator>();
// Outcomes (operation id + revision) already claimed by a mounted button, so
// several mounted buttons never toast or acknowledge the same outcome twice.
const handledNeonSignInOutcomes = new Set<string>();

/**
 * Refreshes the linked project even if the surface that shows it is not
 * mounted. Best effort: the sign-in already succeeded, so a failure (for
 * example, the new account cannot use the project) stays in the query cache
 * for the inline NeonReconnectionNotice instead of being toasted.
 */
async function refreshReconnectedProject(
  queryClient: QueryClient,
  appId: number,
): Promise<void> {
  const appKey = queryKeys.apps.detail({ appId });
  await queryClient.prefetchQuery({
    queryKey: appKey,
    queryFn: () => ipc.app.getApp(appId),
  });
  if (!queryClient.getQueryData<App>(appKey)?.neonProjectId) return;
  await queryClient.prefetchQuery({
    queryKey: queryKeys.neon.project({ appId }),
    queryFn: () => ipc.neon.getProject({ appId }),
  });
}

export function NeonSignInButton({
  appId,
  reconnect = false,
  projectAccessDenied = false,
}: {
  appId?: number;
  reconnect?: boolean;
  projectAccessDenied?: boolean;
}) {
  const { t } = useTranslation("home");
  const { isDarkMode } = useTheme();
  const { settings } = useSettings();
  const queryClient = useQueryClient();
  const { flowState, isFlowActive } = useConnectionFlow("neon");
  const startedOperation = useRef<string | null>(null);
  const isMounted = useRef(false);
  // A completed flow can outlive its initiating component. Other/re-mounted
  // buttons must still allow another sign-in (for example to change accounts).
  const isFinishing =
    flowState.status === "connected" &&
    flowState.invocationRef.operationId === startedOperation.current;

  useEffect(() => {
    isMounted.current = true;
    const operationId = startedOperation.current;
    const initiator = operationId && neonSignInInitiators.get(operationId);
    if (initiator) initiator.mounted = true;
    return () => {
      isMounted.current = false;
      const operationId = startedOperation.current;
      const initiator = operationId && neonSignInInitiators.get(operationId);
      if (initiator) initiator.mounted = false;
    };
  }, []);

  useEffect(() => {
    if (
      flowState.status !== "connected" &&
      flowState.status !== "failed" &&
      flowState.status !== "cancelled"
    ) {
      return;
    }
    const { operationId } = flowState.invocationRef;
    const initiator = neonSignInInitiators.get(operationId);
    // A mounted initiator handles its own outcome. Otherwise any mounted
    // button handles it once, on behalf of the initiator when it is known.
    if (operationId !== startedOperation.current && initiator?.mounted) return;
    const outcomeKey = `${operationId}:${flowState.revision}`;
    if (handledNeonSignInOutcomes.has(outcomeKey)) return;
    handledNeonSignInOutcomes.add(outcomeKey);
    neonSignInInitiators.delete(operationId);
    const outcome = initiator ?? { appId, reconnect };

    void (async () => {
      try {
        if (flowState.status === "connected") {
          const outcomeAppId = outcome.appId;
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: queryKeys.settings.all }),
            queryClient.invalidateQueries({ queryKey: queryKeys.neon.all }),
            outcomeAppId === undefined
              ? Promise.resolve()
              : queryClient.invalidateQueries({
                  queryKey: queryKeys.apps.detail({ appId: outcomeAppId }),
                }),
          ]);
          toast.success(
            t(
              outcome.reconnect
                ? "integrations.neon.reconnectedSuccess"
                : "integrations.neon.connectedSuccess",
            ),
          );
          if (outcome.reconnect && outcomeAppId !== undefined) {
            await refreshReconnectedProject(queryClient, outcomeAppId);
          }
        } else if (flowState.status === "failed") {
          if (flowState.reason === "timeout") {
            toast.warning(t("integrations.neon.signInTimedOut"));
          } else if (flowState.reason !== "user_cancelled") {
            toast.error(
              flowState.message ?? t("integrations.neon.connectFailed"),
            );
          }
        }
      } finally {
        await acknowledgeConnectionFlow("neon", flowState.invocationRef);
      }
    })().catch((error) => toast.error(getErrorMessage(error)));
  }, [appId, flowState, queryClient, t, reconnect]);

  const signIn = useMutation({
    mutationFn: async () => {
      if (!settings || isFlowActive || isFinishing) return;
      const { started, invocationRef } = await startConnectionFlow("neon");
      if (!started) return;
      startedOperation.current = invocationRef.operationId;
      neonSignInInitiators.set(invocationRef.operationId, {
        appId,
        reconnect,
        mounted: isMounted.current,
      });
      try {
        if (settings?.isTestMode) {
          await ipc.neon.fakeConnect();
        } else {
          await ipc.system.openExternalUrl(
            buildOAuthLoginUrl("neon", invocationRef),
          );
        }
      } catch (error) {
        await cancelConnectionFlow("neon", invocationRef);
        throw error;
      }
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  });

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        variant="outline"
        onClick={() => signIn.mutate()}
        disabled={!settings || isFlowActive || isFinishing || signIn.isPending}
        className="w-auto min-h-10 h-auto max-w-full whitespace-normal flex items-center justify-center px-4 py-2 border-2 transition-colors font-medium text-sm dark:bg-gray-900 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800"
        data-testid="connect-neon-button"
        aria-label={
          reconnect
            ? t(
                projectAccessDenied
                  ? "integrations.neon.signInAnotherAccount"
                  : "integrations.neon.reconnectTitle",
              )
            : t("integrations.neon.connectTo") + " Neon"
        }
      >
        {isFlowActive || isFinishing || signIn.isPending ? (
          <>
            <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
            {t(
              flowState.status === "awaiting-return"
                ? "integrations.neon.waitingForSignIn"
                : "integrations.neon.completingSignIn",
            )}
          </>
        ) : (
          <>
            <span className={reconnect ? undefined : "mr-2"}>
              {t(
                reconnect
                  ? projectAccessDenied
                    ? "integrations.neon.signInAnotherAccount"
                    : "integrations.neon.reconnectTitle"
                  : "integrations.neon.connectTo",
              )}
            </span>
            {!reconnect && <NeonLogo isDarkMode={isDarkMode} />}
          </>
        )}
      </Button>
      {isFlowActive && "invocationRef" in flowState && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          data-testid="cancel-neon-flow-button"
          onClick={() => {
            void cancelConnectionFlow("neon", flowState.invocationRef).catch(
              (error) => toast.error(getErrorMessage(error)),
            );
          }}
        >
          {t("integrations.neon.cancelSignIn")}
        </Button>
      )}
    </div>
  );
}
