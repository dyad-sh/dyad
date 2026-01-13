import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Github } from "lucide-react";
import { useSettings } from "@/hooks/useSettings";
import { showSuccess, showError } from "@/lib/toast";
import { Input } from "@/components/ui/input";

export function GitHubIntegration() {
  const { settings, updateSettings } = useSettings();
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [showTokenInput, setShowTokenInput] = useState(false);
  const [token, setToken] = useState("");

  const handleConnectToGithub = async () => {
    if (!token.trim()) {
      showError("Please enter a GitHub token");
      return;
    }

    setIsConnecting(true);
    try {
      const result = await updateSettings({
        githubAccessToken: token,
      });
      if (result) {
        showSuccess("Successfully connected to GitHub");
        setShowTokenInput(false);
        setToken("");
      } else {
        showError("Failed to connect to GitHub");
      }
    } catch (err: any) {
      showError(
        err.message || "An error occurred while connecting to GitHub",
      );
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDisconnectFromGithub = async () => {
    setIsDisconnecting(true);
    try {
      const result = await updateSettings({
        githubAccessToken: undefined,
        githubUser: undefined,
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
    return (
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">
            GitHub Integration
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Connect your GitHub account to push and sync repositories.
          </p>
        </div>

        {!showTokenInput ? (
          <Button
            onClick={() => setShowTokenInput(true)}
            variant="outline"
            size="sm"
            className="flex items-center gap-2"
          >
            <Github className="h-4 w-4" />
            Connect GitHub
          </Button>
        ) : (
          <div className="flex items-center gap-2">
            <Input
              type="password"
              placeholder="GitHub Personal Access Token"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              className="w-64"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  handleConnectToGithub();
                }
              }}
            />
            <Button
              onClick={handleConnectToGithub}
              disabled={isConnecting || !token.trim()}
              size="sm"
            >
              {isConnecting ? "Connecting..." : "Connect"}
            </Button>
            <Button
              onClick={() => {
                setShowTokenInput(false);
                setToken("");
              }}
              variant="ghost"
              size="sm"
            >
              Cancel
            </Button>
          </div>
        )}
      </div>
    );
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
