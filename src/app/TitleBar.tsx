import { useAtom, useAtomValue } from "jotai";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { useLoadApps } from "@/hooks/useLoadApps";
import { useRouter } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
// @ts-ignore
import logo from "../../assets/logo.svg";
import { cn } from "@/lib/utils";
import { useTheme } from "@/contexts/ThemeContext";
import { ipc } from "@/ipc/types";
import { useSystemPlatform } from "@/hooks/useSystemPlatform";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ChatTabs } from "@/components/chat/ChatTabs";
import { selectedChatIdAtom } from "@/atoms/chatAtoms";

export const TitleBar = () => {
  const [selectedAppId] = useAtom(selectedAppIdAtom);
  const selectedChatId = useAtomValue(selectedChatIdAtom);
  const { apps } = useLoadApps();
  const { navigate } = useRouter();
  const platform = useSystemPlatform();
  const showWindowControls = platform !== null && platform !== "darwin";

  const selectedApp = apps.find((app) => app.id === selectedAppId);
  const displayText = selectedApp ? selectedApp.name : "No app selected";

  const handleAppClick = () => {
    if (selectedApp) {
      navigate({ to: "/app-details", search: { appId: selectedApp.id } });
    }
  };

  return (
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
                data-app-path={selectedApp?.path ?? ""}
                aria-label={
                  selectedApp ? `Manage ${selectedApp.name}` : "No app selected"
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
      </div>

      <div className="flex-1 min-w-0 overflow-hidden self-end">
        <ChatTabs selectedChatId={selectedChatId} />
      </div>

      {showWindowControls && <WindowsControls />}
    </div>
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
