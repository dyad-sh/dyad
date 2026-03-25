import { useAtom, useSetAtom } from "jotai";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { isPreviewOpenAtom } from "@/atoms/viewAtoms";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { useSettings } from "@/hooks/useSettings";
// @ts-ignore
import customLogo from "../../assets/smileyone.png";
import { useDeepLink } from "@/contexts/DeepLinkContext";
import { useEffect, useMemo, useState } from "react";
import { useTheme } from "@/contexts/ThemeContext";
import { IpcClient } from "@/ipc/ipc_client";
import { useSidebar } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { PanelLeft, PanelLeftClose, PanelRightOpen, PanelRightClose, Search } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { AppSearchDialog } from "@/components/AppSearchDialog";
import { useLoadApps } from "@/hooks/useLoadApps";
import { selectedChatIdAtom } from "@/atoms/chatAtoms";

export const TitleBar = () => {
  const [selectedAppId] = useAtom(selectedAppIdAtom);
  const location = useLocation();
  const { settings, refreshSettings } = useSettings();
  const [showWindowControls, setShowWindowControls] = useState(false);
  const { state, toggleSidebar } = useSidebar();
  const isCollapsed = state === "collapsed";
  const [isPreviewOpen, setIsPreviewOpen] = useAtom(isPreviewOpenAtom);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const { apps } = useLoadApps();
  const navigate = useNavigate();
  const [, setSelectedAppId] = useAtom(selectedAppIdAtom);
  const setSelectedChatId = useSetAtom(selectedChatIdAtom);

  const allApps = useMemo(
    () =>
      apps.map((a) => ({
        id: a.id,
        name: a.name,
        createdAt: a.createdAt,
        matchedChatTitle: null,
        matchedChatMessage: null,
      })),
    [apps],
  );

  useEffect(() => {
    // Check if we're running on Windows
    const checkPlatform = async () => {
      try {
        const platform = await IpcClient.getInstance().getSystemPlatform();
        setShowWindowControls(platform !== "darwin");
      } catch (error) {
        console.error("Failed to get platform info:", error);
      }
    };

    checkPlatform();
  }, []);

  const { lastDeepLink, clearLastDeepLink } = useDeepLink();
  useEffect(() => {
    const handleDeepLink = async () => {
      if (lastDeepLink?.type === "joy-pro-return") {
        await refreshSettings();
        clearLastDeepLink();
      }
    };
    handleDeepLink();
  }, [lastDeepLink?.timestamp]);

  return (
    <>
      <div className="@container z-11 w-full h-11 bg-(--sidebar) backdrop-blur-xl border-b border-border/30 absolute top-0 left-0 app-region-drag flex items-center gap-3">
        <div className={`${showWindowControls ? "pl-2" : "pl-18"}`}></div>

        {/* Logo and Branding */}
        <div className="flex items-center gap-2 no-app-region-drag">
          <img src={customLogo} alt="Create Logo" className="w-8 h-8 rounded-md shadow-sm ring-1 ring-border/20" />
          <div className="flex flex-col">
            <span className="text-sm font-bold bg-gradient-to-r from-violet-500 via-purple-500 to-indigo-500 bg-clip-text text-transparent leading-tight drop-shadow-sm">
              Create
            </span>
            <span className="text-[9px] text-muted-foreground/50 -mt-0.5 tracking-wide">
              Build • Create • Share
            </span>
          </div>
        </div>

        {/* Sidebar Toggle Button */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleSidebar}
              className="h-7 w-7 rounded-md hover:bg-primary/10 hover:text-primary transition-all no-app-region-drag border border-transparent hover:border-primary/20"
            >
              {isCollapsed ? (
                <PanelLeft className="h-3.5 w-3.5 text-muted-foreground" />
              ) : (
                <PanelLeftClose className="h-3.5 w-3.5 text-muted-foreground" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          </TooltipContent>
        </Tooltip>

        {/* Center Search */}
        <button
          onClick={() => setIsSearchOpen(true)}
          className="flex-1 max-w-md mx-auto flex items-center gap-2 h-7 px-3 rounded-md bg-muted/50 hover:bg-muted text-muted-foreground text-xs transition-colors no-app-region-drag border border-border/40 hover:border-border/60 cursor-pointer"
        >
          <Search className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">Search apps...</span>
          <kbd className="ml-auto hidden @sm:inline-flex items-center gap-0.5 rounded border border-border/60 bg-background/50 px-1.5 py-0.5 text-[10px] text-muted-foreground/70 font-mono">
            Ctrl K
          </kbd>
        </button>

        {/* Preview Panel Toggle */}
        {location.pathname === "/chat" && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setIsPreviewOpen(!isPreviewOpen)}
                className="h-7 w-7 rounded-md hover:bg-primary/10 hover:text-primary transition-all no-app-region-drag border border-transparent hover:border-primary/20"
              >
                {isPreviewOpen ? (
                  <PanelRightClose className="h-3.5 w-3.5 text-muted-foreground" />
                ) : (
                  <PanelRightOpen className="h-3.5 w-3.5 text-muted-foreground" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {isPreviewOpen ? "Close preview" : "Open preview"}
            </TooltipContent>
          </Tooltip>
        )}

        {showWindowControls && <WindowsControls />}
      </div>

      <AppSearchDialog
        open={isSearchOpen}
        onOpenChange={setIsSearchOpen}
        onSelectApp={(appId) => {
          setSelectedAppId(appId);
          setSelectedChatId(null);
          navigate({ to: "/chat" });
        }}
        allApps={allApps}
      />
    </>
  );
};

function WindowsControls() {
  const { isDarkMode } = useTheme();
  const ipcClient = IpcClient.getInstance();

  const minimizeWindow = () => {
    ipcClient.minimizeWindow();
  };

  const maximizeWindow = () => {
    ipcClient.maximizeWindow();
  };

  const closeWindow = () => {
    ipcClient.closeWindow();
  };

  return (
    <div className="ml-auto flex no-app-region-drag">
      <button
        className="w-10 h-10 flex items-center justify-center hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
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
        className="w-10 h-10 flex items-center justify-center hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
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
        className="w-10 h-10 flex items-center justify-center hover:bg-red-500 transition-colors"
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

