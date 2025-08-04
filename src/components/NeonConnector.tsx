import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { IpcClient } from "@/ipc/ipc_client";
import { toast } from "sonner";
import { useSettings } from "@/hooks/useSettings";

import { useDeepLink } from "@/contexts/DeepLinkContext";
import { ExternalLink } from "lucide-react";
import { useTheme } from "@/contexts/ThemeContext";
import { NeonDisconnectButton } from "@/components/NeonDisconnectButton";

export function NeonConnector() {
  const { settings, refreshSettings } = useSettings();
  const { lastDeepLink } = useDeepLink();
  const { isDarkMode } = useTheme();

  useEffect(() => {
    const handleDeepLink = async () => {
      if (lastDeepLink?.type === "neon-oauth-return") {
        await refreshSettings();
        toast.success("Successfully connected to Neon!");
      }
    };
    handleDeepLink();
  }, [lastDeepLink]);

  if (settings?.neon?.accessToken) {
    return (
      <div className="flex flex-col space-y-4 p-4 border bg-white dark:bg-gray-800 max-w-100 rounded-md">
        <div className="flex flex-col items-start justify-between">
          <div className="flex items-center justify-between w-full">
            <h2 className="text-lg font-medium pb-1">Neon Database</h2>
            <Button
              variant="outline"
              onClick={() => {
                IpcClient.getInstance().openExternalUrl(
                  "https://console.neon.tech/",
                );
              }}
              className="ml-2 px-2 py-1 h-8 mb-2"
              style={{ display: "inline-flex", alignItems: "center" }}
              asChild
            >
              <div className="flex items-center gap-1">
                Neon
                <ExternalLink className="h-3 w-3" />
              </div>
            </Button>
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400 pb-3">
            You are connected to Neon Database
          </p>
          <NeonDisconnectButton />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col space-y-4 p-4 border bg-white dark:bg-gray-800 max-w-100 rounded-md">
      <div className="flex flex-col items-start justify-between">
        <h2 className="text-lg font-medium pb-1">Neon Database</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 pb-3">
          Neon Database has a good free tier with backups and up to 10 projects.
        </p>
        <div
          onClick={async () => {
            if (settings?.isTestMode) {
              await IpcClient.getInstance().fakeHandleNeonConnect();
            } else {
              await IpcClient.getInstance().openExternalUrl(
                "https://oauth.dyad.sh/api/integrations/neon/login",
              );
            }
          }}
          className="w-auto h-10 cursor-pointer flex items-center justify-center px-4 py-2 rounded-md border-2 transition-colors font-medium text-sm dark:bg-gray-900 dark:border-gray-700"
          data-testid="connect-neon-button"
        >
          <span className="mr-2">Connect to</span>
          <NeonSvg isDarkMode={isDarkMode} />
        </div>
      </div>
    </div>
  );
}

function NeonSvg({
  isDarkMode,
  className,
}: {
  isDarkMode?: boolean;
  className?: string;
}) {
  const textColor = isDarkMode ? "#fff" : "#000";

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="68"
      height="18"
      fill="none"
      viewBox="0 0 102 28"
      className={className}
    >
      <path
        fill="#12FFF7"
        fillRule="evenodd"
        d="M0 4.828C0 2.16 2.172 0 4.851 0h18.436c2.679 0 4.85 2.161 4.85 4.828V20.43c0 2.758-3.507 3.955-5.208 1.778l-5.318-6.809v8.256c0 2.4-1.955 4.345-4.367 4.345H4.851C2.172 28 0 25.839 0 23.172zm4.851-.966a.97.97 0 0 0-.97.966v18.344c0 .534.435.966.97.966h8.539c.268 0 .34-.216.34-.483v-11.07c0-2.76 3.507-3.956 5.208-1.779l5.319 6.809V4.828c0-.534.05-.966-.485-.966z"
        clipRule="evenodd"
      />
      <path
        fill="url(#a)"
        fillRule="evenodd"
        d="M0 4.828C0 2.16 2.172 0 4.851 0h18.436c2.679 0 4.85 2.161 4.85 4.828V20.43c0 2.758-3.507 3.955-5.208 1.778l-5.318-6.809v8.256c0 2.4-1.955 4.345-4.367 4.345H4.851C2.172 28 0 25.839 0 23.172zm4.851-.966a.97.97 0 0 0-.97.966v18.344c0 .534.435.966.97.966h8.539c.268 0 .34-.216.34-.483v-11.07c0-2.76 3.507-3.956 5.208-1.779l5.319 6.809V4.828c0-.534.05-.966-.485-.966z"
        clipRule="evenodd"
      />
      <path
        fill="url(#b)"
        fillRule="evenodd"
        d="M0 4.828C0 2.16 2.172 0 4.851 0h18.436c2.679 0 4.85 2.161 4.85 4.828V20.43c0 2.758-3.507 3.955-5.208 1.778l-5.318-6.809v8.256c0 2.4-1.955 4.345-4.367 4.345H4.851C2.172 28 0 25.839 0 23.172zm4.851-.966a.97.97 0 0 0-.97.966v18.344c0 .534.435.966.97.966h8.539c.268 0 .34-.216.34-.483v-11.07c0-2.76 3.507-3.956 5.208-1.779l5.319 6.809V4.828c0-.534.05-.966-.485-.966z"
        clipRule="evenodd"
      />
      <path
        fill="#B9FFB3"
        d="M23.287 0c2.679 0 4.85 2.161 4.85 4.828V20.43c0 2.758-3.507 3.955-5.208 1.778l-5.319-6.809v8.256c0 2.4-1.954 4.345-4.366 4.345a.484.484 0 0 0 .485-.483V12.584c0-2.758 3.508-3.955 5.21-1.777l5.318 6.808V.965a.97.97 0 0 0-.97-.965"
      />
      <path
        fill={textColor}
        d="M48.112 7.432v8.032l-7.355-8.032H36.93v13.136h3.49v-8.632l8.01 8.632h3.173V7.432zM58.075 17.64v-2.326h7.815v-2.797h-7.815V10.36h9.48V7.432H54.514v13.136H67.75v-2.927zM77.028 21c4.909 0 8.098-2.552 8.098-7s-3.19-7-8.098-7c-4.91 0-8.081 2.552-8.081 7s3.172 7 8.08 7m0-3.115c-2.73 0-4.413-1.408-4.413-3.885s1.701-3.885 4.413-3.885c2.729 0 4.412 1.408 4.412 3.885s-1.683 3.885-4.412 3.885M98.508 7.432v8.032l-7.355-8.032h-3.828v13.136h3.491v-8.632l8.01 8.632H102V7.432z"
      />
      <defs>
        <linearGradient
          id="a"
          x1="28.138"
          x2="3.533"
          y1="28"
          y2="-.12"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#B9FFB3" />
          <stop offset="1" stopColor="#B9FFB3" stopOpacity="0" />
        </linearGradient>
        <linearGradient
          id="b"
          x1="28.138"
          x2="11.447"
          y1="28"
          y2="21.476"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#1A1A1A" stopOpacity=".9" />
          <stop offset="1" stopColor="#1A1A1A" stopOpacity="0" />
        </linearGradient>
      </defs>
    </svg>
  );
}
