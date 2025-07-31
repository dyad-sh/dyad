import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Globe } from "lucide-react";
import { IpcClient } from "@/ipc/ipc_client";
import { useSettings } from "@/hooks/useSettings";
import { useLoadApp } from "@/hooks/useLoadApp";
import { useVercelDeployments } from "@/hooks/useVercelDeployments";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { App } from "@/ipc/ipc_types";

interface VercelConnectorProps {
  appId: number | null;
  folderName: string;
}

interface VercelProject {
  id: string;
  name: string;
  framework: string | null;
}

interface ConnectedVercelConnectorProps {
  appId: number;
  app: App;
  refreshApp: () => void;
}

interface UnconnectedVercelConnectorProps {
  appId: number | null;
  folderName: string;
  settings: any;
  refreshSettings: () => void;
  refreshApp: () => void;
}

function ConnectedVercelConnector({
  appId,
  app,
  refreshApp,
}: ConnectedVercelConnectorProps) {
  const {
    deployments,
    isLoading: isLoadingDeployments,
    error: deploymentsError,
    getDeployments: handleGetDeployments,
    disconnectProject,
    isDisconnecting,
    disconnectError,
  } = useVercelDeployments(appId);

  const handleDisconnectProject = async () => {
    await disconnectProject();
    refreshApp();
  };

  return (
    <div
      className="mt-4 w-full rounded-md"
      data-testid="vercel-connected-project"
    >
      <p className="text-sm text-gray-600 dark:text-gray-300">
        Connected to Vercel Project:
      </p>
      <a
        onClick={(e) => {
          e.preventDefault();
          IpcClient.getInstance().openExternalUrl(
            `https://vercel.com/${app.vercelTeamSlug}/${app.vercelProjectName}`,
          );
        }}
        className="cursor-pointer text-blue-600 hover:underline dark:text-blue-400"
        target="_blank"
        rel="noopener noreferrer"
      >
        {app.vercelProjectName}
      </a>
      {app.vercelDeploymentUrl && (
        <div className="mt-2">
          <p className="text-sm text-gray-600 dark:text-gray-300">
            Live URL:{" "}
            <a
              onClick={(e) => {
                e.preventDefault();
                if (app.vercelDeploymentUrl) {
                  IpcClient.getInstance().openExternalUrl(
                    app.vercelDeploymentUrl,
                  );
                }
              }}
              className="cursor-pointer text-blue-600 hover:underline dark:text-blue-400 font-mono"
              target="_blank"
              rel="noopener noreferrer"
            >
              {app.vercelDeploymentUrl}
            </a>
          </p>
        </div>
      )}
      <div className="mt-2 flex gap-2">
        <Button onClick={handleGetDeployments} disabled={isLoadingDeployments}>
          {isLoadingDeployments ? (
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
              Getting Deployments...
            </>
          ) : (
            "Refresh Deployments"
          )}
        </Button>
        <Button
          onClick={handleDisconnectProject}
          disabled={isDisconnecting}
          variant="outline"
        >
          {isDisconnecting ? "Disconnecting..." : "Disconnect from project"}
        </Button>
      </div>
      {deploymentsError && (
        <div className="mt-2">
          <p className="text-red-600">{deploymentsError}</p>
        </div>
      )}
      {deployments.length > 0 && (
        <div className="mt-4">
          <h4 className="font-medium mb-2">Recent Deployments:</h4>
          <div className="space-y-2">
            {deployments.map((deployment) => (
              <div
                key={deployment.uid}
                className="bg-gray-50 dark:bg-gray-800 rounded-md p-3"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                        deployment.readyState === "READY"
                          ? "bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-300"
                          : deployment.readyState === "BUILDING"
                            ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-300"
                            : "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300"
                      }`}
                    >
                      {deployment.readyState}
                    </span>
                    <span className="text-sm text-gray-600 dark:text-gray-300">
                      {new Date(deployment.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <a
                    onClick={(e) => {
                      e.preventDefault();
                      IpcClient.getInstance().openExternalUrl(
                        `https://${deployment.url}`,
                      );
                    }}
                    className="cursor-pointer text-blue-600 hover:underline dark:text-blue-400 text-sm"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Globe className="h-4 w-4 inline mr-1" />
                    View
                  </a>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {disconnectError && (
        <p className="text-red-600 mt-2">{disconnectError}</p>
      )}
    </div>
  );
}

function UnconnectedVercelConnector({
  appId,
  folderName,
  settings,
  refreshSettings,
  refreshApp,
}: UnconnectedVercelConnectorProps) {
  // --- Manual Token Entry State ---
  const [accessToken, setAccessToken] = useState("");
  const [isSavingToken, setIsSavingToken] = useState(false);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [tokenSuccess, setTokenSuccess] = useState(false);

  // --- Project Setup State ---
  const [projectSetupMode, setProjectSetupMode] = useState<
    "create" | "existing"
  >("create");
  const [availableProjects, setAvailableProjects] = useState<VercelProject[]>(
    [],
  );
  const [isLoadingProjects, setIsLoadingProjects] = useState(false);
  const [selectedProject, setSelectedProject] = useState<string>("");

  // Create new project state
  const [projectName, setProjectName] = useState(folderName);
  const [projectAvailable, setProjectAvailable] = useState<boolean | null>(
    null,
  );
  const [projectCheckError, setProjectCheckError] = useState<string | null>(
    null,
  );
  const [isCheckingProject, setIsCheckingProject] = useState(false);
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [createProjectError, setCreateProjectError] = useState<string | null>(
    null,
  );
  const [createProjectSuccess, setCreateProjectSuccess] =
    useState<boolean>(false);

  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Load available projects when Vercel is connected
  useEffect(() => {
    if (settings?.vercelAccessToken && projectSetupMode === "existing") {
      loadAvailableProjects();
    }
  }, [settings?.vercelAccessToken, projectSetupMode]);

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
    };
  }, []);

  const loadAvailableProjects = async () => {
    setIsLoadingProjects(true);
    try {
      const projects = await IpcClient.getInstance().listVercelProjects();
      setAvailableProjects(projects);
    } catch (error) {
      console.error("Failed to load Vercel projects:", error);
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
      await IpcClient.getInstance().saveVercelAccessToken({
        token: accessToken.trim(),
      });
      setTokenSuccess(true);
      setAccessToken("");
      refreshSettings();
    } catch (err: any) {
      setTokenError(err.message || "Failed to save access token.");
    } finally {
      setIsSavingToken(false);
    }
  };

  const checkProjectAvailability = useCallback(async (name: string) => {
    setProjectCheckError(null);
    setProjectAvailable(null);
    if (!name) return;
    setIsCheckingProject(true);
    try {
      const result = await IpcClient.getInstance().isVercelProjectAvailable({
        name,
      });
      setProjectAvailable(result.available);
      if (!result.available) {
        setProjectCheckError(result.error || "Project name is not available.");
      }
    } catch (err: any) {
      setProjectCheckError(
        err.message || "Failed to check project availability.",
      );
    } finally {
      setIsCheckingProject(false);
    }
  }, []);

  const debouncedCheckProjectAvailability = useCallback(
    (name: string) => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
      debounceTimeoutRef.current = setTimeout(() => {
        checkProjectAvailability(name);
      }, 500);
    },
    [checkProjectAvailability],
  );

  const handleSetupProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!appId) return;

    setCreateProjectError(null);
    setIsCreatingProject(true);
    setCreateProjectSuccess(false);

    try {
      if (projectSetupMode === "create") {
        await IpcClient.getInstance().createVercelProject({
          name: projectName,
          appId,
        });
      } else {
        await IpcClient.getInstance().connectToExistingVercelProject({
          projectId: selectedProject,
          appId,
        });
      }
      setCreateProjectSuccess(true);
      setProjectCheckError(null);
      refreshApp();
    } catch (err: any) {
      setCreateProjectError(
        err.message ||
          `Failed to ${projectSetupMode === "create" ? "create" : "connect to"} project.`,
      );
    } finally {
      setIsCreatingProject(false);
    }
  };

  if (!settings?.vercelAccessToken) {
    return (
      <div className="mt-1 w-full" data-testid="vercel-unconnected-project">
        <div className="w-ful">
          <div className="flex items-center gap-2 mb-4">
            <h3 className="font-medium">Connect to Vercel</h3>
          </div>

          <div className="space-y-4">
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-md p-3">
              <p className="text-sm text-blue-800 dark:text-blue-200 mb-2">
                To connect your app to Vercel, you'll need to create an access
                token:
              </p>
              <ol className="list-decimal list-inside text-sm text-blue-700 dark:text-blue-300 space-y-1">
                <li>If you don't have a Vercel account, sign up first</li>
                <li>Go to Vercel settings to create a token</li>
                <li>Copy the token and paste it below</li>
              </ol>

              <div className="flex gap-2 mt-3">
                <Button
                  onClick={() => {
                    IpcClient.getInstance().openExternalUrl(
                      "https://vercel.com/signup",
                    );
                  }}
                  variant="outline"
                  className="flex-1"
                >
                  Sign Up for Vercel
                </Button>
                <Button
                  onClick={() => {
                    IpcClient.getInstance().openExternalUrl(
                      "https://vercel.com/account/settings/tokens",
                    );
                  }}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 text-white"
                >
                  Open Vercel Settings
                </Button>
              </div>
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
                className="w-full"
              >
                {isSavingToken ? (
                  <>
                    <svg
                      className="animate-spin h-4 w-4 mr-2"
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
                    Saving Token...
                  </>
                ) : (
                  "Save Access Token"
                )}
              </Button>
            </form>

            {tokenError && (
              <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md p-3">
                <p className="text-sm text-red-800 dark:text-red-200">
                  {tokenError}
                </p>
              </div>
            )}

            {tokenSuccess && (
              <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-md p-3">
                <p className="text-sm text-green-800 dark:text-green-200">
                  Successfully connected to Vercel! You can now set up your
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
    <div className="mt-4 w-full rounded-md" data-testid="vercel-setup-project">
      {/* Collapsible Header */}
      <div className="font-medium mb-2">Set up your Vercel project</div>

      {/* Collapsible Content */}
      <div
        className={`overflow-hidden transition-all duration-300 ease-in-out`}
      >
        <div className="pt-0 space-y-4">
          {/* Mode Selection */}
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
              <>
                <div>
                  <Label className="block text-sm font-medium">
                    Project Name
                  </Label>
                  <Input
                    data-testid="vercel-create-project-name-input"
                    className="w-full mt-1"
                    value={projectName}
                    onChange={(e) => {
                      const newValue = e.target.value;
                      setProjectName(newValue);
                      setProjectAvailable(null);
                      setProjectCheckError(null);
                      debouncedCheckProjectAvailability(newValue);
                    }}
                    disabled={isCreatingProject}
                  />
                  {isCheckingProject && (
                    <p className="text-xs text-gray-500 mt-1">
                      Checking availability...
                    </p>
                  )}
                  {projectAvailable === true && (
                    <p className="text-xs text-green-600 mt-1">
                      Project name is available!
                    </p>
                  )}
                  {projectAvailable === false && (
                    <p className="text-xs text-red-600 mt-1">
                      {projectCheckError}
                    </p>
                  )}
                </div>
              </>
            ) : (
              <>
                <div>
                  <Label className="block text-sm font-medium">
                    Select Project
                  </Label>
                  <Select
                    value={selectedProject}
                    onValueChange={setSelectedProject}
                    disabled={isLoadingProjects}
                  >
                    <SelectTrigger
                      className="w-full mt-1"
                      data-testid="vercel-project-select"
                    >
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
                          {project.name}{" "}
                          {project.framework && `(${project.framework})`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}

            <Button
              type="submit"
              disabled={
                isCreatingProject ||
                (projectSetupMode === "create" &&
                  (projectAvailable === false || !projectName)) ||
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
            <p className="text-red-600 mt-2">{createProjectError}</p>
          )}
          {createProjectSuccess && (
            <p className="text-green-600 mt-2">
              {projectSetupMode === "create"
                ? "Project created and linked!"
                : "Connected to project!"}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export function VercelConnector({ appId, folderName }: VercelConnectorProps) {
  const { app, refreshApp } = useLoadApp(appId);
  const { settings, refreshSettings } = useSettings();

  if (app?.vercelProjectId && appId) {
    return (
      <ConnectedVercelConnector
        appId={appId}
        app={app}
        refreshApp={refreshApp}
      />
    );
  } else {
    return (
      <UnconnectedVercelConnector
        appId={appId}
        folderName={folderName}
        settings={settings}
        refreshSettings={refreshSettings}
        refreshApp={refreshApp}
      />
    );
  }
}
