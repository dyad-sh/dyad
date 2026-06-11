import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Globe, Loader2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { ipc, App } from "@/ipc/types";
import { useSettings } from "@/hooks/useSettings";
import { useLoadApp } from "@/hooks/useLoadApp";
import { useVercelDeployments } from "@/hooks/useVercelDeployments";
import { queryKeys } from "@/lib/queryKeys";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  useVercelProjectSetup,
  useVercelTokenSetup,
} from "./VercelConnector.hooks";

interface VercelConnectorProps {
  appId: number | null;
  folderName: string;
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
  neonProjectId: string | null;
  refreshSettings: () => void;
  refreshApp: () => void;
}

type VercelTokenViewState = ReturnType<typeof useVercelTokenSetup>["state"];
type VercelTokenViewActions = ReturnType<typeof useVercelTokenSetup>["actions"];
type VercelProjectSetupViewState = ReturnType<
  typeof useVercelProjectSetup
>["state"];
type VercelProjectSetupViewActions = ReturnType<
  typeof useVercelProjectSetup
>["actions"];

function ConnectedVercelConnector({
  appId,
  app,
  refreshApp,
}: ConnectedVercelConnectorProps) {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const {
    deployments,
    isLoading: isLoadingDeployments,
    error: deploymentsError,
    getDeployments,
    disconnectProject,
    isDisconnecting,
    disconnectError,
  } = useVercelDeployments(appId);

  const handleGetDeployments = async () => {
    setIsRefreshing(true);
    try {
      const minLoadingTime = new Promise((resolve) => setTimeout(resolve, 750));
      await Promise.all([getDeployments(), minLoadingTime]);
      // Refresh app data to get the updated deployment URL
      refreshApp();
    } finally {
      setIsRefreshing(false);
    }
  };

  const isLoadingOrRefreshing = isLoadingDeployments || isRefreshing;

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
          ipc.system.openExternalUrl(
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
                  ipc.system.openExternalUrl(app.vercelDeploymentUrl);
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
        <Button onClick={handleGetDeployments} disabled={isLoadingOrRefreshing}>
          {isLoadingOrRefreshing ? (
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
              Refreshing...
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
                      ipc.system.openExternalUrl(`https://${deployment.url}`);
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

interface VercelTokenFormProps {
  state: VercelTokenViewState;
  actions: VercelTokenViewActions;
  canSubmit: boolean;
}

function VercelTokenForm({ state, actions, canSubmit }: VercelTokenFormProps) {
  const { accessToken, isSavingToken, tokenError, tokenSuccess } = state;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await actions.submit();
  };

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
                  ipc.system.openExternalUrl("https://vercel.com/signup");
                }}
                variant="outline"
                className="flex-1"
              >
                Sign Up for Vercel
              </Button>
              <Button
                onClick={() => {
                  ipc.system.openExternalUrl(
                    "https://vercel.com/account/settings/tokens",
                  );
                }}
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white"
              >
                Open Vercel Settings
              </Button>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <Label className="block text-sm font-medium mb-1">
                Vercel Access Token
              </Label>
              <Input
                type="password"
                placeholder="Enter your Vercel access token"
                value={accessToken}
                onChange={(e) => actions.setToken(e.target.value)}
                disabled={isSavingToken}
                className="w-full"
              />
            </div>

            <Button type="submit" disabled={!canSubmit} className="w-full">
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

interface VercelProjectSetupFormProps {
  state: VercelProjectSetupViewState;
  actions: VercelProjectSetupViewActions;
  canSubmit: boolean;
  syncPreview: ReactNode;
}

function VercelProjectSetupForm({
  state,
  actions,
  canSubmit,
  syncPreview,
}: VercelProjectSetupFormProps) {
  const {
    mode,
    availableProjects,
    isLoadingProjects,
    selectedProject,
    projectName,
    projectAvailable,
    projectCheckError,
    isCheckingProject,
    isCreatingProject,
    createProjectError,
    createProjectSuccess,
  } = state;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await actions.submit();
  };

  return (
    <div className="mt-4 w-full rounded-md" data-testid="vercel-setup-project">
      <div className="font-medium mb-2">Set up your Vercel project</div>

      <div className="overflow-hidden transition-all duration-300 ease-in-out">
        <div className="pt-0 space-y-4">
          <div>
            <div className="flex rounded-md border border-gray-200 dark:border-gray-700">
              <Button
                type="button"
                variant={mode === "create" ? "default" : "ghost"}
                className={`flex-1 rounded-none rounded-l-md border-0 ${
                  mode === "create"
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-gray-50 dark:hover:bg-gray-800"
                }`}
                onClick={() => actions.setMode("create")}
              >
                Create new project
              </Button>
              <Button
                type="button"
                variant={mode === "existing" ? "default" : "ghost"}
                className={`flex-1 rounded-none rounded-r-md border-0 border-l border-gray-200 dark:border-gray-700 ${
                  mode === "existing"
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-gray-50 dark:hover:bg-gray-800"
                }`}
                onClick={() => actions.setMode("existing")}
              >
                Connect to existing project
              </Button>
            </div>
          </div>

          <form className="space-y-4" onSubmit={handleSubmit}>
            {mode === "create" ? (
              <>
                <div>
                  <Label className="block text-sm font-medium">
                    Project Name
                  </Label>
                  <Input
                    data-testid="vercel-create-project-name-input"
                    className="w-full mt-1"
                    value={projectName}
                    onChange={(e) => actions.setProjectName(e.target.value)}
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
                {syncPreview}
              </>
            ) : (
              <div>
                <Label className="block text-sm font-medium">
                  Select Project
                </Label>
                <Select
                  value={selectedProject}
                  onValueChange={(v) => actions.selectProject(v ?? "")}
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
            )}

            <Button type="submit" disabled={!canSubmit}>
              {isCreatingProject
                ? mode === "create"
                  ? "Creating..."
                  : "Connecting..."
                : mode === "create"
                  ? "Create Project"
                  : "Connect to Project"}
            </Button>
          </form>

          {createProjectError && (
            <p className="text-red-600 mt-2">{createProjectError}</p>
          )}
          {createProjectSuccess && (
            <p className="text-green-600 mt-2">
              {mode === "create"
                ? "Project created and linked!"
                : "Connected to project!"}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function UnconnectedVercelConnector({
  appId,
  folderName,
  settings,
  neonProjectId,
  refreshSettings,
  refreshApp,
}: UnconnectedVercelConnectorProps) {
  const { t } = useTranslation("home");
  const {
    state: tokenState,
    actions: tokenActions,
    canSubmit: canSubmitToken,
  } = useVercelTokenSetup({ refreshSettings });

  const {
    state: projectSetup,
    actions: projectActions,
    canSubmit: canSubmitProjectSetup,
  } = useVercelProjectSetup({
    appId,
    folderName,
    hasVercelCredentials: !!settings?.vercelAccessToken,
    refreshApp,
  });
  const projectSetupMode = projectSetup.mode;

  // For Neon-connected apps, preview what will be auto-configured on Vercel
  // (env var keys + trusted domains) so the user approves before deploying.
  const showSyncPreview =
    !!neonProjectId && appId !== null && projectSetupMode === "create";
  const {
    data: syncPreview,
    isLoading: isSyncPreviewLoading,
    error: syncPreviewError,
  } = useQuery({
    queryKey: queryKeys.vercel.syncPreview({ appId }),
    queryFn: () => ipc.vercel.getSyncPreview({ appId: appId! }),
    enabled: showSyncPreview,
    staleTime: 60 * 1000,
  });

  if (!settings?.vercelAccessToken) {
    return (
      <VercelTokenForm
        state={tokenState}
        actions={tokenActions}
        canSubmit={canSubmitToken}
      />
    );
  }

  return (
    <VercelProjectSetupForm
      state={projectSetup}
      actions={projectActions}
      canSubmit={canSubmitProjectSetup}
      syncPreview={
        showSyncPreview &&
        (isSyncPreviewLoading || syncPreviewError || syncPreview) ? (
          <div
            className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-md p-3"
            data-testid="vercel-sync-preview"
          >
            <p className="text-sm font-medium text-blue-800 dark:text-blue-200 mb-1">
              {t("integrations.vercel.syncPreviewTitle")}
            </p>
            {isSyncPreviewLoading ? (
              <p className="flex items-center gap-2 text-xs text-blue-700 dark:text-blue-300">
                <Loader2 className="w-3 h-3 animate-spin" />
                {t("integrations.vercel.syncPreviewLoading")}
              </p>
            ) : syncPreviewError ? (
              <p className="text-xs text-red-600 dark:text-red-400">
                {t("integrations.vercel.syncPreviewError")}
              </p>
            ) : syncPreview ? (
              <>
                <p className="text-xs text-blue-700 dark:text-blue-300 mb-2">
                  {t("integrations.vercel.syncPreviewIntro", {
                    branchType: syncPreview.branchType,
                  })}
                </p>
                <ul className="list-disc list-inside text-xs font-mono text-blue-800 dark:text-blue-200 space-y-0.5">
                  {syncPreview.envKeys.map((key) => (
                    <li key={key}>{key}</li>
                  ))}
                </ul>
                {syncPreview.authActive && (
                  <p className="text-xs text-blue-700 dark:text-blue-300 mt-2">
                    {t("integrations.vercel.syncPreviewAuthDomain")}
                  </p>
                )}
              </>
            ) : null}
          </div>
        ) : null
      }
    />
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
        neonProjectId={app?.neonProjectId ?? null}
        refreshSettings={refreshSettings}
        refreshApp={refreshApp}
      />
    );
  }
}
