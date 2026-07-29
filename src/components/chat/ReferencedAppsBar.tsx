import { Boxes, X } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ipc } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";

interface ReferencedAppsBarProps {
  chatId: number | null | undefined;
  /**
   * Referenced apps only stay available across turns in agent-backed modes,
   * where the model reads them on demand via tool calls. Build mode injects
   * full codebases per turn, so nothing is carried over and nothing is shown.
   */
  isEnabled: boolean;
  /**
   * Blocks detaching while a turn is in flight. The running turn resolves its
   * referenced apps once, before the model call, and its tools read that
   * snapshot — so a detach here could not revoke access until the turn ended,
   * while the chip disappearing would claim it already had.
   */
  isStreaming: boolean;
}

/**
 * Shows the apps that stay readable for the rest of this chat, with a way to
 * detach them. Without this the stickiness would be invisible — the user could
 * not tell which apps the agent can still read, or stop it reading one.
 */
export function ReferencedAppsBar({
  chatId,
  isEnabled,
  isStreaming,
}: ReferencedAppsBarProps) {
  const { t } = useTranslation("chat");
  const queryClient = useQueryClient();

  const activeChatId = chatId ?? null;

  const chatQuery = useQuery({
    queryKey: queryKeys.chats.detail({ chatId: activeChatId }),
    queryFn: () => ipc.chat.getChat(activeChatId!),
    enabled: activeChatId !== null && isEnabled,
  });

  const removeMutation = useMutation({
    mutationFn: async (appId: number) => {
      if (activeChatId === null) return;
      await ipc.chat.removeChatReferencedApp({ chatId: activeChatId, appId });
    },
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.chats.detail({ chatId: activeChatId }),
      });
    },
    meta: { showErrorToast: true },
  });

  const referencedApps = chatQuery.data?.referencedApps ?? [];
  const isDetachDisabled = isStreaming || removeMutation.isPending;

  if (!isEnabled || activeChatId === null || referencedApps.length === 0) {
    return null;
  }

  return (
    <div
      className="px-2 pt-2 flex flex-wrap items-center gap-1"
      data-testid="referenced-apps-bar"
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <span className="flex items-center gap-1 text-xs text-muted-foreground" />
          }
        >
          <Boxes size={12} />
          <span>{t("referencedApps.label")}</span>
        </TooltipTrigger>
        <TooltipContent>{t("referencedApps.description")}</TooltipContent>
      </Tooltip>
      {referencedApps.map((app) => (
        <div
          key={app.id}
          className="flex items-center bg-muted rounded-md px-2 py-1 text-xs gap-1"
          data-testid={`referenced-app-chip-${app.name}`}
        >
          <span className="truncate max-w-[140px]">{app.name}</span>
          <Tooltip>
            {/* The trigger is the wrapper, not the button: a disabled button
                swallows hover, so the "why" would never surface. */}
            <TooltipTrigger
              render={
                <span
                  className={cn(
                    "flex items-center",
                    isDetachDisabled && "cursor-not-allowed",
                  )}
                />
              }
            >
              <button
                type="button"
                onClick={() => removeMutation.mutate(app.id)}
                disabled={isDetachDisabled}
                className={cn(
                  "hover:bg-muted-foreground/20 rounded-full p-0.5 cursor-pointer",
                  isDetachDisabled && "pointer-events-none opacity-50",
                )}
                aria-label={t("referencedApps.remove", { appName: app.name })}
              >
                <X size={12} />
              </button>
            </TooltipTrigger>
            <TooltipContent>
              {isStreaming
                ? t("referencedApps.removeDisabledWhileStreaming")
                : t("referencedApps.remove", { appName: app.name })}
            </TooltipContent>
          </Tooltip>
        </div>
      ))}
    </div>
  );
}
