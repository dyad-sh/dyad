import { useAtom, useAtomValue } from "jotai";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { useLoadApps } from "@/hooks/useLoadApps";
import { useRouter } from "@tanstack/react-router";
import { useSettings } from "@/hooks/useSettings";
import { Button } from "@/components/ui/button";
// @ts-ignore
import logo from "../../assets/logo.svg";
import { providerSettingsRoute } from "@/routes/settings/providers/$provider";
import { cn } from "@/lib/utils";
import { useDeepLink } from "@/contexts/DeepLinkContext";
import { useEffect, useState } from "react";
import { DyadProSuccessDialog } from "@/components/DyadProSuccessDialog";
import { useTheme } from "@/contexts/ThemeContext";
import { ipc } from "@/ipc/types";
import { useSystemPlatform } from "@/hooks/useSystemPlatform";
import { useUserBudgetInfo } from "@/hooks/useUserBudgetInfo";
import type { UserBudgetInfo } from "@/ipc/types";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ChatTabs } from "@/components/chat/ChatTabs";
import { selectedChatIdAtom } from "@/atoms/chatAtoms";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";

export const TitleBar = () => {
  const [selectedAppId] = useAtom(selectedAppIdAtom);
  const selectedChatId = useAtomValue(selectedChatIdAtom);
  const { apps } = useLoadApps();
  const { navigate } = useRouter();
  const { settings, refreshSettings } = useSettings();
  const queryClient = useQueryClient();
  const [isSuccessDialogOpen, setIsSuccessDialogOpen] = useState(false);
  const platform = useSystemPlatform();
  const showWindowControls = platform !== null && platform !== "darwin";

  const showDyadProSuccessDialog = () => {
    setIsSuccessDialogOpen(true);
  };

  const { lastDeepLink, clearLastDeepLink } = useDeepLink();
  useEffect(() => {
    const handleDeepLink = async () => {
      if (lastDeepLink?.type === "dyad-pro-return") {
        await refreshSettings();
        // Refetch user budget when Dyad Pro key is set via deep link
        queryClient.invalidateQueries({ queryKey: queryKeys.userBudget.info });
        showDyadProSuccessDialog();
        clearLastDeepLink();
      }
    };
    handleDeepLink();
  }, [lastDeepLink?.timestamp]);

  const selectedApp = apps.find((app) => app.id === selectedAppId);
  const displayText = selectedApp ? selectedApp.name : "No app selected";

  const handleAppClick = () => {
    if (selectedApp) {
      navigate({ to: "/app-details", search: { appId: selectedApp.id } });
    }
  };

  const isDyadPro = !!settings?.providerSettings?.auto?.apiKey?.value;
  const isDyadProEnabled = Boolean(settings?.enableDyadPro);

  return (
    <>
      <div className="@container z-11 w-full h-[calc(var(--layout-title-bar-offset)+1px)] pt-1 bg-(--sidebar) absolute top-0 left-0 app-region-drag flex items-center">
        {/*
         * Left region matches the sidebar's expanded width so chat tabs always
         * start past the sidebar panel's right edge. Without this, an active
         * tab's flat-bottom edge ends up over the sidebar instead of the white
         * main content area, breaking the "tab merges into content" affordance.
         */}
        <div className="flex items-center shrink-0">
          <div className={`${showWindowControls ? "pl-2" : "pl-18"}`}></div>

          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  data-testid="title-bar-app-name-button"
                  data-app-name={selectedApp?.name ?? ""}
                  aria-label={
                    selectedApp
                      ? `Manage ${selectedApp.name}`
                      : "No app selected"
                  }
                  variant="outline"
                  size="sm"
                  disabled={!selectedApp}
                  className={cn(
                    "no-app-region-drag ml-2 h-7 px-1.5 gap-1.5 flex items-center font-medium text-xs",
                    selectedApp
                      ? "cursor-pointer"
                      : "opacity-70 cursor-default disabled:opacity-70",
                  )}
                  onClick={handleAppClick}
                />
              }
            >
              <img src={logo} alt="Dyad" className="w-5 h-5 shrink-0" />
              <span className="hidden @2xl:inline max-w-40 truncate">
                Manage app
              </span>
            </TooltipTrigger>
            <TooltipContent>{displayText}</TooltipContent>
          </Tooltip>
          {isDyadPro && <DyadProButton isDyadProEnabled={isDyadProEnabled} />}
        </div>

        <div className="flex-1 min-w-0 overflow-hidden self-end">
          <ChatTabs selectedChatId={selectedChatId} />
        </div>

        {showWindowControls && <WindowsControls />}
      </div>

      <DyadProSuccessDialog
        isOpen={isSuccessDialogOpen}
        onClose={() => setIsSuccessDialogOpen(false)}
      />
    </>
  );
};

function WindowsControls() {
  const { isDarkMode } = useTheme();

  const minimizeWindow = () => {
    ipc.system.minimizeWindow();
  };

  const maximizeWindow = () => {
    ipc.system.maximizeWindow();
  };

  const closeWindow = () => {
    ipc.system.closeWindow();
  };

  return (
    <div className="ml-auto flex no-app-region-drag -mt-1 h-[var(--layout-title-bar-offset)] self-start">
      <button
        className="w-12 h-full flex items-center justify-center hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
        onClick={minimizeWindow}
        aria-label="Minimize"
      >
        <svg
          width="12"
          height="1"
          viewBox="0 0 12 1"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <rect
            width="12"
            height="1"
            fill={isDarkMode ? "#ffffff" : "#000000"}
          />
        </svg>
      </button>
      <button
        className="w-12 h-full flex items-center justify-center hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
        onClick={maximizeWindow}
        aria-label="Maximize"
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <rect
            x="0.5"
            y="0.5"
            width="11"
            height="11"
            stroke={isDarkMode ? "#ffffff" : "#000000"}
          />
        </svg>
      </button>
      <button
        className="w-12 h-full flex items-center justify-center hover:bg-red-500 transition-colors"
        onClick={closeWindow}
        aria-label="Close"
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M1 1L11 11M1 11L11 1"
            stroke={isDarkMode ? "#ffffff" : "#000000"}
            strokeWidth="1.5"
          />
        </svg>
      </button>
    </div>
  );
}

export function DyadProButton({
  isDyadProEnabled,
}: {
  isDyadProEnabled: boolean;
}) {
  const { navigate } = useRouter();
  const { userBudget } = useUserBudgetInfo();
  return (
    <Button
      data-testid="title-bar-dyad-pro-button"
      onClick={() => {
        navigate({
          to: providerSettingsRoute.id,
          params: { provider: "auto" },
        });
      }}
      variant="outline"
      className={cn(
        "hidden @2xl:block ml-1 no-app-region-drag h-7 text-xs px-2 pt-1 pb-1",
        isDyadProEnabled &&
          "bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100 dark:bg-indigo-950/60 dark:text-indigo-300 dark:border-indigo-900 dark:hover:bg-indigo-900/40",
      )}
      size="sm"
    >
      {isDyadProEnabled
        ? userBudget?.isTrial
          ? "Pro Trial"
          : "Pro"
        : "Pro (off)"}
      {userBudget && isDyadProEnabled && (
        <AICreditStatus userBudget={userBudget} />
      )}
    </Button>
  );
}

export function AICreditStatus({
  userBudget,
}: {
  userBudget: NonNullable<UserBudgetInfo>;
}) {
  const total = Math.round(userBudget.totalCredits);
  const used = Math.round(userBudget.usedCredits);
  const remaining = Math.max(0, total - used);
  const resetDate = userBudget.budgetResetDate
    ? new Date(userBudget.budgetResetDate).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      })
    : null;
  return (
    <Tooltip>
      <TooltipTrigger>
        <div className="text-xs pl-1 mt-0.5 opacity-90">· {remaining}</div>
      </TooltipTrigger>
      <TooltipContent>
        <div className="flex flex-col gap-0.5 text-xs">
          <p className="font-medium">
            {remaining.toLocaleString()} of {total.toLocaleString()} credits
            remaining
          </p>
          {resetDate && <p className="opacity-80">Resets on {resetDate}</p>}
          <p className="opacity-60">
            Note: credit status may take a moment to update.
          </p>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
