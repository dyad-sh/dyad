import { useEffect, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
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
import { ipc } from "@/ipc/types";
import { getErrorMessage } from "@/lib/errors";
import { queryKeys } from "@/lib/queryKeys";

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
  const handledRevision = useRef<number | null>(null);
  const startedOperation = useRef<string | null>(null);
  // A completed flow can outlive its initiating component. Other/re-mounted
  // buttons must still allow another sign-in (for example to change accounts).
  const isFinishing =
    flowState.status === "connected" &&
    flowState.invocationRef.operationId === startedOperation.current;

  useEffect(() => {
    if (
      flowState.status !== "connected" &&
      flowState.status !== "failed" &&
      flowState.status !== "cancelled"
    ) {
      return;
    }
    if (flowState.invocationRef.operationId !== startedOperation.current)
      return;
    if (handledRevision.current === flowState.revision) return;
    handledRevision.current = flowState.revision;

    void (async () => {
      try {
        if (flowState.status === "connected") {
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: queryKeys.settings.all }),
            queryClient.invalidateQueries({ queryKey: queryKeys.neon.all }),
            appId === undefined
              ? Promise.resolve()
              : queryClient.invalidateQueries({
                  queryKey: queryKeys.apps.detail({ appId }),
                }),
          ]);
          if (reconnect && appId !== undefined) {
            const app = await queryClient.fetchQuery({
              queryKey: queryKeys.apps.detail({ appId }),
              queryFn: () => ipc.app.getApp(appId),
            });
            if (app.neonProjectId) {
              await queryClient.fetchQuery({
                queryKey: queryKeys.neon.project({ appId }),
                queryFn: () => ipc.neon.getProject({ appId }),
              });
            }
          }
          toast.success(
            t(
              reconnect
                ? "integrations.neon.reconnectedSuccess"
                : "integrations.neon.connectedSuccess",
            ),
          );
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
