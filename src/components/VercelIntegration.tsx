import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSettings } from "@/hooks/useSettings";
import { showSuccess, showError } from "@/lib/toast";
import { IpcClient } from "@/ipc/ipc_client";

export function VercelIntegration() {
  const { settings, updateSettings, refreshSettings } = useSettings();
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    username?: string;
    error?: string;
  } | null>(null);
  const [accessToken, setAccessToken] = useState("");
  const [isSavingToken, setIsSavingToken] = useState(false);

  const isConnected = !!settings?.vercelAccessToken;

  const handleDisconnectFromVercel = async () => {
    setIsDisconnecting(true);
    try {
      const result = await updateSettings({
        vercelAccessToken: undefined,
      });
      if (result) {
        showSuccess("Successfully disconnected from Vercel");
        setTestResult(null);
      } else {
        showError("Failed to disconnect from Vercel");
      }
    } catch (err: any) {
      showError(
        err.message || "An error occurred while disconnecting from Vercel",
      );
    } finally {
      setIsDisconnecting(false);
    }
  };

  const handleTestConnection = async () => {
    setIsTesting(true);
    setTestResult(null);
    try {
      const result = await IpcClient.getInstance().testVercelConnection();
      setTestResult({
        success: true,
        username: result.username,
      });
      showSuccess(`Connected as ${result.username}`);
    } catch (err: any) {
      setTestResult({
        success: false,
        error: err.message,
      });
      showError(err.message || "Connection test failed");
    } finally {
      setIsTesting(false);
    }
  };

  const handleCopyDiagnostics = () => {
    const token = settings?.vercelAccessToken?.value || "";
    const maskedToken = token ? `***...${token.slice(-4)}` : "(not set)";

    const diagnostics = {
      connected: isConnected,
      hasToken: !!settings?.vercelAccessToken,
      maskedToken,
      lastTestResult: testResult
        ? testResult.success
          ? `OK (${testResult.username})`
          : `Error: ${testResult.error}`
        : "Not tested",
    };

    navigator.clipboard.writeText(JSON.stringify(diagnostics, null, 2));
    showSuccess("Diagnostics copied to clipboard");
  };

  const handleSaveAccessToken = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accessToken.trim()) return;

    setIsSavingToken(true);
    try {
      await IpcClient.getInstance().saveVercelAccessToken({
        token: accessToken.trim(),
      });
      showSuccess("Vercel access token saved successfully");
      setAccessToken("");
      refreshSettings();
      // Auto-test the connection
      setTimeout(handleTestConnection, 500);
    } catch (err: any) {
      showError(err.message || "Failed to save access token");
    } finally {
      setIsSavingToken(false);
    }
  };

  // Show token entry form when not connected
  if (!isConnected) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Vercel Integration
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Connect to Vercel to deploy your apps directly.
            </p>
          </div>
          <svg
            className="h-5 w-5 text-gray-400"
            fill="currentColor"
            viewBox="0 0 24 24"
          >
            <path d="M24 22.525H0l12-21.05 12 21.05z" />
          </svg>
        </div>

        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-md p-3">
          <p className="text-sm text-blue-800 dark:text-blue-200 mb-2">
            To connect to Vercel, you need to create an access token:
          </p>
          <ol className="list-decimal list-inside text-sm text-blue-700 dark:text-blue-300 space-y-1">
            <li>Go to Vercel Account Settings → Tokens</li>
            <li>Create a new token with "Full Account" scope</li>
            <li>Copy the token and paste it below</li>
          </ol>
          <Button
            onClick={() => {
              IpcClient.getInstance().openExternalUrl(
                "https://vercel.com/account/tokens",
              );
            }}
            variant="outline"
            size="sm"
            className="mt-3"
          >
            Open Vercel Settings
          </Button>
        </div>

        <form onSubmit={handleSaveAccessToken} className="space-y-3">
          <div>
            <Label className="block text-sm font-medium mb-1">
              Vercel Access Token
            </Label>
            <Input
              type="password"
              placeholder="Enter your Vercel access token"
              value={accessToken}
              onChange={(e) => setAccessToken(e.target.value)}
              disabled={isSavingToken}
              className="w-full"
            />
          </div>
          <Button
            type="submit"
            disabled={!accessToken.trim() || isSavingToken}
            size="sm"
          >
            {isSavingToken ? "Saving..." : "Save Token"}
          </Button>
        </form>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Vercel Integration
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            {testResult?.success
              ? `Connected as ${testResult.username}`
              : "Your account is connected to Vercel."}
          </p>
        </div>
        <svg
          className="h-5 w-5 text-green-500"
          fill="currentColor"
          viewBox="0 0 24 24"
        >
          <path d="M24 22.525H0l12-21.05 12 21.05z" />
        </svg>
      </div>

      {testResult?.success === false && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md p-3">
          <p className="text-sm text-red-800 dark:text-red-200">
            Connection test failed: {testResult.error}
          </p>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          onClick={handleTestConnection}
          variant="outline"
          size="sm"
          disabled={isTesting}
        >
          {isTesting ? "Testing..." : "Test Connection"}
        </Button>
        <Button onClick={handleCopyDiagnostics} variant="outline" size="sm">
          Copy Diagnostics
        </Button>
        <Button
          onClick={handleDisconnectFromVercel}
          variant="destructive"
          size="sm"
          disabled={isDisconnecting}
        >
          {isDisconnecting ? "Disconnecting..." : "Disconnect"}
        </Button>
      </div>
    </div>
  );
}
