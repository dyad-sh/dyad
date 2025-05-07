import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Github } from "lucide-react";
import { useSettings } from "@/hooks/useSettings";
import { showSuccess, showError } from "@/lib/toast";

export function GitHubIntegration() {
  const { settings, updateSettings } = useSettings();
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  const handleDisconnectFromGithub = async () => {
    setIsDisconnecting(true);
    try {
      const result = await updateSettings({
        githubAccessToken: undefined,
      });
      if (result) {
        showSuccess("Successfully disconnected from GitHub");
      } else {
        showError("Failed to disconnect from GitHub");
      }
    } catch (err: any) {
      showError(
        err.message || "An error occurred while disconnecting from GitHub",
      );
    } finally {
      setIsDisconnecting(false);
    }
  };

  const isConnected = !!settings?.githubAccessToken;

  if (!isConnected) {
    return null;
  }

  return (
    <div className="flex items-center justify-between">
      <div>
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">
          GitHub Integration
        </h3>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          Your account is connected to GitHub.
        </p>
      </div>

      <Button
        onClick={handleDisconnectFromGithub}
        variant="destructive"
        size="sm"
        disabled={isDisconnecting}
        className="flex items-center gap-2"
      >
        {isDisconnecting ? "Disconnecting..." : "Disconnect from GitHub"}
        <Github className="h-4 w-4" />
      </Button>
    </div>
  );
}
