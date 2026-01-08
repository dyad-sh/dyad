import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { IpcClient } from "@/ipc/ipc_client";
import { useSettings } from "@/hooks/useSettings";
import { useLoadApp } from "@/hooks/useLoadApp";
import { useAllExtensionData } from "@/hooks/useExtensionData";
import { useCloudflareDeployments } from "../cloudflare/hooks";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { CloudflareProject } from "./types";
import { showSuccess, showError } from "@/lib/toast";

// Helper to invoke extension IPC channels
function invokeExtensionChannel(channel: string, ...args: any[]): Promise<any> {
  const ipcClient = IpcClient.getInstance() as any;
  return ipcClient.ipcRenderer.invoke(channel, ...args);
}

interface CloudflareConnectorProps {
  appId: number;
  folderName: string;
}

interface ConnectedCloudflareConnectorProps {
  appId: number;
  refreshApp: () => void;
}

interface UnconnectedCloudflareConnectorProps {
  appId: number | null;
  folderName: string;
  settings: any;
  refreshSettings: () => void;
  refreshApp: () => void;
}

function ConnectedCloudflareConnector({
  appId,
  refreshApp,
}: ConnectedCloudflareConnectorProps) {
  const {
    deployments,
    isLoading: isLoadingDeployments,
    error: deploymentsError,
    getDeployments,
    disconnectProject,
    isDisconnecting,
    disconnectError,
  } = useCloudflareDeployments(appId);

  // Get project data from extension data
  const { data: extensionData } = useAllExtensionData("cloudflare", appId);
  const projectName = extensionData?.projectName || null;
  const deploymentUrl = extensionData?.deploymentUrl || null;

  const handleDisconnectProject = async () => {
    await disconnectProject();
    refreshApp();
  };

  return (
    <div className="mt-4 w-full rounded-md">
      <p className="text-sm text-gray-600 dark:text-gray-300">
        Connected to Cloudflare Pages Project:
      </p>
      {projectName && (
        <a
          onClick={(e) => {
            e.preventDefault();
            IpcClient.getInstance().openExternalUrl(
              `https://dash.cloudflare.com/pages`,
            );
          }}
          className="cursor-pointer text-blue-600 hover:underline dark:text-blue-400"
          target="_blank"
          rel="noopener noreferrer"
        >
          {projectName}
        </a>
      )}
      {deploymentUrl && (
        <div className="mt-2">
          <p className="text-sm text-gray-600 dark:text-gray-300">
            Live URL:{" "}
            <a
              onClick={(e) => {
                e.preventDefault();
                IpcClient.getInstance().openExternalUrl(deploymentUrl);
              }}
              className="cursor-pointer text-blue-600 hover:underline dark:text-blue-400 font-mono"
              target="_blank"
              rel="noopener noreferrer"
            >
              {deploymentUrl}
            </a>
          </p>
        </div>
      )}
      <div className="mt-2 flex gap-2">
        <Button onClick={getDeployments} disabled={isLoadingDeployments}>
          {isLoadingDeployments ? "Loading..." : "Refresh Deployments"}
        </Button>
        <Button
          onClick={handleDisconnectProject}
          disabled={isDisconnecting}
          variant="outline"
        >
          {isDisconnecting ? "Disconnecting..." : "Disconnect"}
        </Button>
      </div>
      {deploymentsError && (
        <div className="mt-2">
          <p className="text-red-600 text-sm">{deploymentsError}</p>
        </div>
      )}
      {disconnectError && (
        <div className="mt-2">
          <p className="text-red-600 text-sm">{disconnectError}</p>
        </div>
      )}
      {deployments.length > 0 && (
        <div className="mt-4">
          <h4 className="font-medium mb-2 text-sm">Recent Deployments:</h4>
          <div className="space-y-2">
            {deployments.slice(0, 5).map((deployment) => (
              <div
                key={deployment.id}
                className="bg-gray-50 dark:bg-gray-800 rounded-md p-3"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                        deployment.latest_stage?.status === "success"
                          ? "bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-300"
                          : deployment.latest_stage?.status === "active"
                            ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-300"
                            : "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300"
                      }`}
                    >
                      {deployment.latest_stage?.status || "unknown"}
                    </span>
                    <span className="text-sm text-gray-600 dark:text-gray-300">
                      {new Date(deployment.created_on).toLocaleString()}
                    </span>
                  </div>
                  <a
                    onClick={(e) => {
                      e.preventDefault();
                      IpcClient.getInstance().openExternalUrl(deployment.url);
                    }}
                    className="cursor-pointer text-blue-600 hover:underline dark:text-blue-400 text-sm"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    View
                  </a>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function UnconnectedCloudflareConnector({
  appId,
  folderName,
  settings,
  refreshSettings,
  refreshApp,
}: UnconnectedCloudflareConnectorProps) {
  const [accessToken, setAccessToken] = useState("");
  const [isSavingToken, setIsSavingToken] = useState(false);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [tokenSuccess, setTokenSuccess] = useState(false);
  const [projectSetupMode, setProjectSetupMode] = useState<
    "create" | "existing"
  >("create");
  const [availableProjects, setAvailableProjects] = useState<
    CloudflareProject[]
  >([]);
  const [isLoadingProjects, setIsLoadingProjects] = useState(false);
  const [selectedProject, setSelectedProject] = useState<string>("");
  const [projectName, setProjectName] = useState(folderName);
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [createProjectError, setCreateProjectError] = useState<string | null>(
    null,
  );
  const [createProjectSuccess, setCreateProjectSuccess] = useState(false);

  const cloudflareToken = settings?.extensionSettings?.cloudflare?.accessToken;

  const isConnected = !!cloudflareToken;

  useEffect(() => {
    if (isConnected && projectSetupMode === "existing") {
      loadAvailableProjects();
    }
  }, [isConnected, projectSetupMode]);

  const loadAvailableProjects = async () => {
    setIsLoadingProjects(true);
    try {
      const projects = await invokeExtensionChannel(
        "extension:cloudflare:list-projects",
      );
      setAvailableProjects(projects || []);
    } catch (error: any) {
      console.error("Failed to load Cloudflare projects:", error);
    } finally {
      setIsLoadingProjects(false);
    }
  };

  const handleSaveAccessToken = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accessToken.trim()) return;

    setIsSavingToken(true);
    setTokenError(null);
    setTokenSuccess(false);

    try {
      await invokeExtensionChannel("extension:cloudflare:save-token", {
        token: accessToken.trim(),
      });
      setTokenSuccess(true);
      setAccessToken("");
      refreshSettings();
      showSuccess("Successfully connected to Cloudflare Pages");
    } catch (err: any) {
      setTokenError(err.message || "Failed to save access token.");
    } finally {
      setIsSavingToken(false);
    }
  };

  const handleSetupProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!appId) return;

    setIsCreatingProject(true);
    setCreateProjectError(null);
    setCreateProjectSuccess(false);

    try {
      if (projectSetupMode === "create") {
        await invokeExtensionChannel("extension:cloudflare:create-project", {
          appId,
          name: projectName,
        });
      } else {
        await invokeExtensionChannel(
          "extension:cloudflare:connect-existing-project",
          {
            appId,
            projectId: selectedProject,
          },
        );
      }
      setCreateProjectSuccess(true);
      refreshApp();
      showSuccess(
        projectSetupMode === "create"
          ? "Project created and linked successfully!"
          : "Connected to project successfully!",
      );
    } catch (err: any) {
      setCreateProjectError(err.message || "Failed to setup project.");
    } finally {
      setIsCreatingProject(false);
    }
  };

  if (!isConnected) {
    return (
      <div className="mt-4 w-full rounded-md">
        <div className="font-medium mb-2">Cloudflare Pages</div>
        <div className="space-y-4">
          <div>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
              Connect your Cloudflare account to deploy your projects to
              Cloudflare Pages.
            </p>
            <form onSubmit={handleSaveAccessToken} className="space-y-3">
              <div>
                <Label className="block text-sm font-medium mb-1">
                  Cloudflare API Token
                </Label>
                <Input
                  type="password"
                  placeholder="Enter your Cloudflare API token"
                  value={accessToken}
                  onChange={(e) => setAccessToken(e.target.value)}
                  disabled={isSavingToken}
                  className="w-full"
                />
              </div>
              <Button
                type="submit"
                disabled={!accessToken.trim() || isSavingToken}
                className="w-full"
              >
                {isSavingToken ? "Saving Token..." : "Save Access Token"}
              </Button>
            </form>
            {tokenError && (
              <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md p-3 mt-3">
                <p className="text-sm text-red-800 dark:text-red-200">
                  {tokenError}
                </p>
              </div>
            )}
            {tokenSuccess && (
              <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-md p-3 mt-3">
                <p className="text-sm text-green-800 dark:text-green-200">
                  Successfully connected to Cloudflare! You can now set up your
                  project below.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-4 w-full rounded-md">
      <div className="font-medium mb-2">
        Set up your Cloudflare Pages project
      </div>
      <div className="pt-0 space-y-4">
        <div>
          <div className="flex rounded-md border border-gray-200 dark:border-gray-700">
            <Button
              type="button"
              variant={projectSetupMode === "create" ? "default" : "ghost"}
              className={`flex-1 rounded-none rounded-l-md border-0 ${
                projectSetupMode === "create"
                  ? "bg-primary text-primary-foreground"
                  : "hover:bg-gray-50 dark:hover:bg-gray-800"
              }`}
              onClick={() => {
                setProjectSetupMode("create");
                setCreateProjectError(null);
                setCreateProjectSuccess(false);
              }}
            >
              Create new project
            </Button>
            <Button
              type="button"
              variant={projectSetupMode === "existing" ? "default" : "ghost"}
              className={`flex-1 rounded-none rounded-r-md border-0 border-l border-gray-200 dark:border-gray-700 ${
                projectSetupMode === "existing"
                  ? "bg-primary text-primary-foreground"
                  : "hover:bg-gray-50 dark:hover:bg-gray-800"
              }`}
              onClick={() => {
                setProjectSetupMode("existing");
                setCreateProjectError(null);
                setCreateProjectSuccess(false);
              }}
            >
              Connect to existing project
            </Button>
          </div>
        </div>

        <form className="space-y-4" onSubmit={handleSetupProject}>
          {projectSetupMode === "create" ? (
            <div>
              <Label className="block text-sm font-medium">Project Name</Label>
              <Input
                className="w-full mt-1"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                disabled={isCreatingProject}
              />
            </div>
          ) : (
            <div>
              <Label className="block text-sm font-medium">
                Select Project
              </Label>
              <Select
                value={selectedProject}
                onValueChange={setSelectedProject}
                disabled={isLoadingProjects}
              >
                <SelectTrigger className="w-full mt-1">
                  <SelectValue
                    placeholder={
                      isLoadingProjects
                        ? "Loading projects..."
                        : "Select a project"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {availableProjects.map((project) => (
                    <SelectItem key={project.id} value={project.id}>
                      {project.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <Button
            type="submit"
            disabled={
              isCreatingProject ||
              (projectSetupMode === "create" && !projectName) ||
              (projectSetupMode === "existing" && !selectedProject)
            }
          >
            {isCreatingProject
              ? projectSetupMode === "create"
                ? "Creating..."
                : "Connecting..."
              : projectSetupMode === "create"
                ? "Create Project"
                : "Connect to Project"}
          </Button>
        </form>

        {createProjectError && (
          <p className="text-red-600 mt-2 text-sm">{createProjectError}</p>
        )}
        {createProjectSuccess && (
          <p className="text-green-600 mt-2 text-sm">
            {projectSetupMode === "create"
              ? "Project created and linked!"
              : "Connected to project!"}
          </p>
        )}
      </div>
    </div>
  );
}

export function CloudflareConnector({
  appId,
  folderName,
}: CloudflareConnectorProps) {
  const { app, refreshApp } = useLoadApp(appId);
  const { settings, refreshSettings } = useSettings();
  const { data: extensionData } = useAllExtensionData("cloudflare", appId);

  // Check if project is connected
  const isConnected = !!extensionData?.projectId;

  if (isConnected && appId && app) {
    return (
      <ConnectedCloudflareConnector appId={appId} refreshApp={refreshApp} />
    );
  } else {
    return (
      <UnconnectedCloudflareConnector
        appId={appId}
        folderName={folderName}
        settings={settings}
        refreshSettings={refreshSettings}
        refreshApp={refreshApp}
      />
    );
  }
}

export function CloudflareSettings() {
  const { settings, updateSettings } = useSettings();
  const [accessToken, setAccessToken] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  const cloudflareToken = settings?.extensionSettings?.cloudflare?.accessToken;
  const isConnected = !!cloudflareToken;

  const handleSaveToken = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accessToken.trim()) return;

    setIsSaving(true);
    setError(null);
    setSuccess(false);

    try {
      await invokeExtensionChannel("extension:cloudflare:save-token", {
        token: accessToken.trim(),
      });
      setSuccess(true);
      setAccessToken("");
      // Refresh settings to get the updated token
      const result = await updateSettings({});
      if (result) {
        showSuccess("Successfully connected to Cloudflare Pages");
      }
    } catch (err: any) {
      setError(err.message || "Failed to save token");
      showError(err.message || "Failed to save token");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDisconnect = async () => {
    setIsDisconnecting(true);
    setError(null);
    try {
      const result = await updateSettings({
        extensionSettings: {
          ...settings?.extensionSettings,
          cloudflare: {
            ...settings?.extensionSettings?.cloudflare,
            accessToken: undefined,
          },
        },
      });
      if (result) {
        showSuccess("Successfully disconnected from Cloudflare Pages");
      } else {
        showError("Failed to disconnect from Cloudflare Pages");
      }
    } catch (err: any) {
      setError(err.message || "Failed to disconnect");
      showError(err.message || "Failed to disconnect");
    } finally {
      setIsDisconnecting(false);
    }
  };

  return (
    <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-900 rounded-lg border">
      <div>
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">
          Cloudflare Pages
        </h3>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          {isConnected
            ? "Your account is connected to Cloudflare Pages."
            : "Connect your Cloudflare account to deploy projects."}
        </p>
      </div>
      {isConnected ? (
        <Button
          onClick={handleDisconnect}
          variant="destructive"
          size="sm"
          disabled={isDisconnecting}
        >
          {isDisconnecting ? "Disconnecting..." : "Disconnect"}
        </Button>
      ) : (
        <form onSubmit={handleSaveToken} className="flex gap-2">
          <Input
            type="password"
            placeholder="API Token"
            value={accessToken}
            onChange={(e) => setAccessToken(e.target.value)}
            disabled={isSaving}
            className="w-48"
          />
          <Button
            type="submit"
            disabled={!accessToken.trim() || isSaving}
            size="sm"
          >
            {isSaving ? "Saving..." : "Connect"}
          </Button>
        </form>
      )}
      {error && <p className="text-red-600 text-xs mt-1">{error}</p>}
      {success && <p className="text-green-600 text-xs mt-1">Connected!</p>}
    </div>
  );
}
