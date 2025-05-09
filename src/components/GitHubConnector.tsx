import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Github, Clipboard, Check } from "lucide-react";
import { IpcClient } from "@/ipc/ipc_client";
import { useSettings } from "@/hooks/useSettings";
import { useLoadApp } from "@/hooks/useLoadApp";

interface GitHubConnectorProps {
  appId: number | null;
  folderName: string;
}

export function GitHubConnector({ appId, folderName }: GitHubConnectorProps) {
  // --- GitHub Device Flow State ---
  const { app, refreshApp } = useLoadApp(appId);
  const { settings, refreshSettings } = useSettings();
  const [githubUserCode, setGithubUserCode] = useState<string | null>(null);
  const [githubVerificationUri, setGithubVerificationUri] = useState<
    string | null
  >(null);
  const [githubError, setGithubError] = useState<string | null>(null);
  const [isConnectingToGithub, setIsConnectingToGithub] = useState(false);
  const [githubStatusMessage, setGithubStatusMessage] = useState<string | null>(
    null,
  );
  const [codeCopied, setCodeCopied] = useState(false);
  // --- ---

  const handleConnectToGithub = async () => {
    if (!appId) return;
    setIsConnectingToGithub(true);
    setGithubError(null);
    setGithubUserCode(null);
    setGithubVerificationUri(null);
    setGithubStatusMessage("Requesting device code from GitHub...");

    // Send IPC message to main process to start the flow
    IpcClient.getInstance().startGithubDeviceFlow(appId);
  };

  useEffect(() => {
    if (!appId) return; // Don't set up listeners if appId is null initially

    const cleanupFunctions: (() => void)[] = [];

    // Listener for updates (user code, verification uri, status messages)
    const removeUpdateListener =
      IpcClient.getInstance().onGithubDeviceFlowUpdate((data) => {
        console.log("Received github:flow-update", data);
        if (data.userCode) {
          setGithubUserCode(data.userCode);
        }
        if (data.verificationUri) {
          setGithubVerificationUri(data.verificationUri);
        }
        if (data.message) {
          setGithubStatusMessage(data.message);
        }

        setGithubError(null); // Clear previous errors on new update
        if (!data.userCode && !data.verificationUri && data.message) {
          // Likely just a status message, keep connecting state
          setIsConnectingToGithub(true);
        }
        if (data.userCode && data.verificationUri) {
          setIsConnectingToGithub(true); // Still connecting until success/error
        }
      });
    cleanupFunctions.push(removeUpdateListener);

    // Listener for success
    const removeSuccessListener =
      IpcClient.getInstance().onGithubDeviceFlowSuccess((data) => {
        console.log("Received github:flow-success", data);
        setGithubStatusMessage("Successfully connected to GitHub!");
        setGithubUserCode(null); // Clear user-facing info
        setGithubVerificationUri(null);
        setGithubError(null);
        setIsConnectingToGithub(false);
        refreshSettings();
        // TODO: Maybe update parent UI to show "Connected" state or trigger next action
      });
    cleanupFunctions.push(removeSuccessListener);

    // Listener for errors
    const removeErrorListener = IpcClient.getInstance().onGithubDeviceFlowError(
      (data) => {
        console.log("Received github:flow-error", data);
        setGithubError(data.error || "An unknown error occurred.");
        setGithubStatusMessage(null);
        setGithubUserCode(null);
        setGithubVerificationUri(null);
        setIsConnectingToGithub(false);
      },
    );
    cleanupFunctions.push(removeErrorListener);

    // Cleanup function to remove all listeners when component unmounts or appId changes
    return () => {
      cleanupFunctions.forEach((cleanup) => cleanup());
      // Optional: Send a message to main process to cancel polling if component unmounts
      // Only cancel if we were actually connecting for this specific appId
      // IpcClient.getInstance().cancelGithubDeviceFlow(appId);
      // Reset state when appId changes or component unmounts
      setGithubUserCode(null);
      setGithubVerificationUri(null);
      setGithubError(null);
      setIsConnectingToGithub(false);
      setGithubStatusMessage(null);
    };
  }, [appId]); // Re-run effect if appId changes

  // --- Create Repo State ---
  const [repoName, setRepoName] = useState(folderName);
  const [repoAvailable, setRepoAvailable] = useState<boolean | null>(null);
  const [repoCheckError, setRepoCheckError] = useState<string | null>(null);
  const [isCheckingRepo, setIsCheckingRepo] = useState(false);
  const [isCreatingRepo, setIsCreatingRepo] = useState(false);
  const [createRepoError, setCreateRepoError] = useState<string | null>(null);
  const [createRepoSuccess, setCreateRepoSuccess] = useState<boolean>(false);
  // --- Sync to GitHub State ---
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncSuccess, setSyncSuccess] = useState<boolean>(false);
  // Assume org is the authenticated user for now (could add org input later)
  // TODO: After device flow, fetch and store the GitHub username/org in settings for use here
  const githubOrg = ""; // Use empty string for now (GitHub API will default to the authenticated user)

  const handleRepoNameBlur = async () => {
    setRepoCheckError(null);
    setRepoAvailable(null);
    if (!repoName) return;
    setIsCheckingRepo(true);
    try {
      const result = await IpcClient.getInstance().checkGithubRepoAvailable(
        githubOrg,
        repoName,
      );
      setRepoAvailable(result.available);
      if (!result.available) {
        setRepoCheckError(result.error || "Repository name is not available.");
      }
    } catch (err: any) {
      setRepoCheckError(err.message || "Failed to check repo availability.");
    } finally {
      setIsCheckingRepo(false);
    }
  };

  const handleCreateRepo = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateRepoError(null);
    setIsCreatingRepo(true);
    setCreateRepoSuccess(false);
    try {
      await IpcClient.getInstance().createGithubRepo(
        githubOrg,
        repoName,
        appId!,
      );
      setCreateRepoSuccess(true);
      setRepoCheckError(null);
      refreshApp();
    } catch (err: any) {
      setCreateRepoError(err.message || "Failed to create repository.");
    } finally {
      setIsCreatingRepo(false);
    }
  };

  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [disconnectError, setDisconnectError] = useState<string | null>(null);

  const handleDisconnectRepo = async () => {
    if (!appId) return;
    setIsDisconnecting(true);
    setDisconnectError(null);
    try {
      await IpcClient.getInstance().disconnectGithubRepo(appId);
      refreshApp();
    } catch (err: any) {
      setDisconnectError(err.message || "Failed to disconnect repository.");
    } finally {
      setIsDisconnecting(false);
    }
  };

  if (!settings?.githubAccessToken) {
    return (
      <div className="mt-1 w-full">
        {" "}
        <Button
          onClick={handleConnectToGithub}
          className="cursor-pointer w-full py-5 flex justify-center items-center gap-2"
          size="lg"
          variant="outline"
          disabled={isConnectingToGithub || !appId} // Also disable if appId is null
        >
          Connect to GitHub
          <Github className="h-5 w-5" />
          {isConnectingToGithub && (
            <svg
              className="animate-spin h-5 w-5 ml-2"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              ></circle>
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              ></path>
            </svg>
          )}
        </Button>
        {/* GitHub Connection Status/Instructions */}
        {(githubUserCode || githubStatusMessage || githubError) && (
          <div className="mt-6 p-4 border rounded-md bg-gray-50 dark:bg-gray-700/50 border-gray-200 dark:border-gray-600">
            <h4 className="font-medium mb-2">GitHub Connection</h4>
            {githubError && (
              <p className="text-red-600 dark:text-red-400 mb-2">
                Error: {githubError}
              </p>
            )}
            {githubUserCode && githubVerificationUri && (
              <div className="mb-2">
                <p>
                  1. Go to:
                  <a
                    href={githubVerificationUri} // Make it a direct link
                    onClick={(e) => {
                      e.preventDefault();
                      IpcClient.getInstance().openExternalUrl(
                        githubVerificationUri,
                      );
                    }}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-1 text-blue-600 hover:underline dark:text-blue-400"
                  >
                    {githubVerificationUri}
                  </a>
                </p>
                <p>
                  2. Enter code:
                  <strong className="ml-1 font-mono text-lg tracking-wider bg-gray-200 dark:bg-gray-600 px-2 py-0.5 rounded">
                    {githubUserCode}
                  </strong>
                  <button
                    className="ml-2 p-1 rounded-md hover:bg-gray-300 dark:hover:bg-gray-500 focus:outline-none"
                    onClick={() => {
                      if (githubUserCode) {
                        navigator.clipboard
                          .writeText(githubUserCode)
                          .then(() => {
                            setCodeCopied(true);
                            setTimeout(() => setCodeCopied(false), 2000);
                          })
                          .catch((err) =>
                            console.error("Failed to copy code:", err),
                          );
                      }
                    }}
                    title="Copy to clipboard"
                  >
                    {codeCopied ? (
                      <Check className="h-4 w-4 text-green-500" />
                    ) : (
                      <Clipboard className="h-4 w-4" />
                    )}
                  </button>
                </p>
              </div>
            )}
            {githubStatusMessage && (
              <p className="text-sm text-gray-600 dark:text-gray-300">
                {githubStatusMessage}
              </p>
            )}
          </div>
        )}
      </div>
    );
  }

  if (app?.githubOrg && app?.githubRepo) {
    const handleSyncToGithub = async () => {
      setIsSyncing(true);
      setSyncError(null);
      setSyncSuccess(false);
      try {
        const result = await IpcClient.getInstance().syncGithubRepo(appId!);
        if (result.success) {
          setSyncSuccess(true);
        } else {
          setSyncError(result.error || "Failed to sync to GitHub.");
        }
      } catch (err: any) {
        setSyncError(err.message || "Failed to sync to GitHub.");
      } finally {
        setIsSyncing(false);
      }
    };

    return (
      <div className="mt-4 w-full border border-gray-200 rounded-md p-4">
        <p>Connected to GitHub Repo:</p>
        <a
          onClick={(e) => {
            e.preventDefault();
            IpcClient.getInstance().openExternalUrl(
              `https://github.com/${app.githubOrg}/${app.githubRepo}`,
            );
          }}
          className="cursor-pointer text-blue-600 hover:underline dark:text-blue-400"
          target="_blank"
          rel="noopener noreferrer"
        >
          {app.githubOrg}/{app.githubRepo}
        </a>
        <div className="mt-2 flex gap-2">
          <Button onClick={handleSyncToGithub} disabled={isSyncing}>
            {isSyncing ? (
              <>
                <svg
                  className="animate-spin h-5 w-5 mr-2 inline"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  style={{ display: "inline" }}
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  ></circle>
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  ></path>
                </svg>
                Syncing...
              </>
            ) : (
              "Sync to GitHub"
            )}
          </Button>
          <Button
            onClick={handleDisconnectRepo}
            disabled={isDisconnecting}
            variant="outline"
          >
            {isDisconnecting ? "Disconnecting..." : "Disconnect from repo"}
          </Button>
        </div>
        {syncError && <p className="text-red-600 mt-2">{syncError}</p>}
        {syncSuccess && (
          <p className="text-green-600 mt-2">Successfully pushed to GitHub!</p>
        )}
        {disconnectError && (
          <p className="text-red-600 mt-2">{disconnectError}</p>
        )}
      </div>
    );
  } else {
    return (
      <div className="mt-4 w-full border border-gray-200 rounded-md p-4">
        <p>Set up your GitHub repo</p>
        <form className="mt-4 space-y-2" onSubmit={handleCreateRepo}>
          <label className="block text-sm font-medium">Repository Name</label>
          <input
            className="w-full border rounded px-2 py-1"
            value={repoName}
            onChange={(e) => {
              setRepoName(e.target.value);
              setRepoAvailable(null);
              setRepoCheckError(null);
            }}
            onBlur={handleRepoNameBlur}
            disabled={isCreatingRepo}
          />
          {isCheckingRepo && (
            <p className="text-xs text-gray-500">Checking availability...</p>
          )}
          {repoAvailable === true && (
            <p className="text-xs text-green-600">
              Repository name is available!
            </p>
          )}
          {repoAvailable === false && (
            <p className="text-xs text-red-600">{repoCheckError}</p>
          )}
          <Button
            type="submit"
            disabled={isCreatingRepo || repoAvailable === false || !repoName}
          >
            {isCreatingRepo ? "Creating..." : "Create Repo"}
          </Button>
        </form>
        {createRepoError && (
          <p className="text-red-600 mt-2">{createRepoError}</p>
        )}
        {createRepoSuccess && (
          <p className="text-green-600 mt-2">Repository created and linked!</p>
        )}
      </div>
    );
  }
}
