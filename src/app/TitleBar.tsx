import { useAtom } from "jotai";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { useLoadApps } from "@/hooks/useLoadApps";
import { useRouter } from "@tanstack/react-router";
import { useSettings } from "@/hooks/useSettings";
import { Button } from "@/components/ui/button";
// @ts-ignore
import logo from "../../assets/logo_transparent.png";
import { providerSettingsRoute } from "@/routes/settings/providers/$provider";
import { cn } from "@/lib/utils";
import { useDeepLink } from "@/contexts/DeepLinkContext";
import { useEffect, useState } from "react";
import { DyadProSuccessDialog } from "@/components/DyadProSuccessDialog";
import { useTheme } from "@/contexts/ThemeContext";
import { IpcClient } from "@/ipc/ipc_client";

export const TitleBar = () => {
  const [selectedAppId] = useAtom(selectedAppIdAtom);
  const { apps } = useLoadApps();
  const { navigate } = useRouter();
  const { settings, refreshSettings } = useSettings();
  const [isSuccessDialogOpen, setIsSuccessDialogOpen] = useState(false);
  const [showWindowControls, setShowWindowControls] = useState(false);

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

  const showDyadProSuccessDialog = () => {
    setIsSuccessDialogOpen(true);
  };

  const { lastDeepLink } = useDeepLink();
  useEffect(() => {
    const handleDeepLink = async () => {
      if (lastDeepLink?.type === "dyad-pro-return") {
        await refreshSettings();
        showDyadProSuccessDialog();
      }
    };
    handleDeepLink();
  }, [lastDeepLink]);

  // Get selected app name
  const selectedApp = apps.find((app) => app.id === selectedAppId);
  const displayText = selectedApp
    ? `App: ${selectedApp.name}`
    : "(no app selected)";

  const handleAppClick = () => {
    if (selectedApp) {
      navigate({ to: "/app-details", search: { appId: selectedApp.id } });
    }
  };

  const isDyadPro = !!settings?.providerSettings?.auto?.apiKey?.value;
  const isDyadProEnabled = settings?.enableDyadPro;

  return (
    <>
      <div className="@container z-11 w-full h-11 bg-(--sidebar) absolute top-0 left-0 app-region-drag flex items-center">
        <div className="pl-20"></div>
        <img src={logo} alt="Dyad Logo" className="w-6 h-6 mr-2" />
        <Button
          variant="outline"
          size="sm"
          className={`hidden @md:block no-app-region-drag text-sm font-medium ${
            selectedApp ? "cursor-pointer" : ""
          }`}
          onClick={handleAppClick}
        >
          {displayText}
        </Button>
        {isDyadPro && (
          <Button
            onClick={() => {
              navigate({
                to: providerSettingsRoute.id,
                params: { provider: "auto" },
              });
            }}
            variant="outline"
            className={cn(
              "ml-4 no-app-region-drag h-7 bg-indigo-600 text-white dark:bg-indigo-600 dark:text-white",
              !isDyadProEnabled && "bg-zinc-600 dark:bg-zinc-600",
            )}
            size="sm"
          >
            {isDyadProEnabled ? "Dyad Pro" : "Dyad Pro (disabled)"}
          </Button>
        )}
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
        className="w-12 h-11 flex items-center justify-center hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
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
        className="w-12 h-11 flex items-center justify-center hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
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
        className="w-12 h-11 flex items-center justify-center hover:bg-red-500 transition-colors"
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
