import { useEffect, useRef } from "react";
import {
  acknowledgeConnectionFlow,
  cancelConnectionFlow,
  startConnectionFlow,
  useConnectionFlow,
  useUnsolicitedConnectionReturn,
} from "@/hooks/useConnectionFlow";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";

import { Label } from "@/components/ui/label";

import { ipc, type SupabaseProject } from "@/ipc/types";
import { toast } from "sonner";
import { useSettings } from "@/hooks/useSettings";
import { useRedeploySupabaseFunctions, useSupabase } from "@/hooks/useSupabase";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useLoadApp } from "@/hooks/useLoadApp";
import {
  useLegacySupabaseKey,
  useSwitchToPublishableKey,
} from "@/hooks/useLegacySupabaseKey";

// @ts-ignore
import supabaseLogoLight from "../../assets/supabase/supabase-logo-wordmark--light.svg";
// @ts-ignore
import supabaseLogoDark from "../../assets/supabase/supabase-logo-wordmark--dark.svg";
// @ts-ignore
import connectSupabaseDark from "../../assets/supabase/connect-supabase-dark.svg";
// @ts-ignore
import connectSupabaseLight from "../../assets/supabase/connect-supabase-light.svg";

import {
  ExternalLink,
  Info,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { getErrorMessage } from "@/lib/errors";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { useTheme } from "@/contexts/ThemeContext";
import {
  hasSupabaseCredentialsForOrganization,
  isSupabaseConnected,
} from "@/lib/schemas";
import { showError } from "@/lib/toast";

function findLinkedSupabaseProject(
  projects: SupabaseProject[],
  projectId: string,
  parentProjectId?: string | null,
) {
  const organizationLookupProjectId = parentProjectId ?? projectId;
  return projects.find((project) => project.id === organizationLookupProjectId);
}

export function SupabaseConnector({ appId }: { appId: number }) {
  const { t } = useTranslation(["home", "common"]);
  const { settings, refreshSettings } = useSettings();
  const { app, refreshApp } = useLoadApp(appId);
  const { isDarkMode } = useTheme();

  // A linked app must be authenticated to its own organization. Before a
  // project is selected, any connected organization can populate the picker.
  const isConnected = app?.supabaseProjectId
    ? hasSupabaseCredentialsForOrganization(
        settings,
        app.supabaseOrganizationSlug,
      )
    : isSupabaseConnected(settings);

  // Gates the update offer: true only when the app's generated client is
  // holding this project's legacy key and a publishable key exists to replace
  // it.
  const legacyKeyQuery = useLegacySupabaseKey({
    appId,
    projectId: app?.supabaseProjectId ?? null,
    enabled: isConnected && !!app?.supabaseProjectId,
  });
  const hasLegacyKey = legacyKeyQuery.data?.hasLegacyKey ?? false;
  const switchKey = useSwitchToPublishableKey();
  const { redeployAllFunctions, redeployProgress, isRedeployingFunctions } =
    useRedeploySupabaseFunctions(appId);

  const branchesProjectId =
    app?.supabaseParentProjectId || app?.supabaseProjectId;

  const {
    organizations,
    projects,
    branches,
    isLoadingProjects,
    isFetchingProjects,
    isLoadingOrganizations,
    organizationsError,
    projectsError,
    isLoadingBranches,
    branchesError,
    isSettingAppProject,
    refetchOrganizations,
    refetchProjects,
    deleteOrganization,
    setAppProject,
    unsetAppProject,
  } = useSupabase({
    branchesProjectId,
    branchesOrganizationSlug: app?.supabaseOrganizationSlug,
  });

  // The connection flow lives in the main process; this component only
  // projects it. Timeouts (Supabase historically had none — a closed
  // browser left it silently stuck), double-start protection and
  // OAuth-return correlation are handled by the typed-ref-keyed state machine.
  const { flowState, isFlowActive } = useConnectionFlow("supabase");

  const refreshAfterConnectRef = useRef<() => Promise<void>>(async () => {});
  refreshAfterConnectRef.current = async () => {
    await refreshSettings();
    await refetchOrganizations();
    const refreshedProjects = await refetchProjects();
    if (app?.supabaseProjectId && !app.supabaseOrganizationSlug) {
      const linkedProject = findLinkedSupabaseProject(
        refreshedProjects.data ?? [],
        app.supabaseProjectId,
        app.supabaseParentProjectId,
      );
      if (linkedProject) {
        try {
          await ipc.supabase.setAppProject({
            appId,
            projectId: app.supabaseProjectId,
            parentProjectId: app.supabaseParentProjectId,
            organizationSlug: linkedProject.organizationSlug,
          });
        } catch (error) {
          console.error("Failed to recover legacy Supabase link:", error);
          toast.error(
            t("integrations.supabase.failedConnectProject", {
              error: String(error),
            }),
          );
        }
      }
    }
    await refreshApp();
  };

  useEffect(() => {
    const flow = flowState;
    if (flow.status === "connected") {
      void (async () => {
        try {
          await refreshAfterConnectRef.current();
        } finally {
          await acknowledgeConnectionFlow("supabase", flow.invocationRef);
        }
      })();
    } else if (flow.status === "failed") {
      if (flow.reason === "timeout") {
        toast.warning(t("integrations.supabase.signInTimedOut"));
      } else if (flow.reason !== "user_cancelled") {
        toast.error(flow.message ?? t("integrations.supabase.connectFailed"));
      }
      void acknowledgeConnectionFlow("supabase", flow.invocationRef);
    } else if (flow.status === "cancelled") {
      void acknowledgeConnectionFlow("supabase", flow.invocationRef);
    }
  }, [flowState, t]);

  // A dyad://supabase-oauth-return processed with no active flow (cold
  // start, app restarted mid-flow, or a return that arrived after the flow
  // timed out): tokens are already stored, just refresh what we show.
  useUnsolicitedConnectionReturn("supabase", () => {
    void refreshAfterConnectRef.current();
  });

  const handleProjectSelect = async (projectValue: string) => {
    try {
      // projectValue format: "organizationSlug:projectId"
      const [organizationSlug, projectId] = projectValue.split(":");
      const project = projects.find(
        (p) => p.id === projectId && p.organizationSlug === organizationSlug,
      );
      if (!project) {
        throw new Error(t("integrations.supabase.projectNotFound"));
      }
      await setAppProject({
        projectId,
        appId,
        organizationSlug,
      });
      toast.success(t("integrations.supabase.projectConnected"));
      await refreshApp();
    } catch (error) {
      toast.error(
        t("integrations.supabase.failedConnectProject", {
          error: String(error),
        }),
      );
    }
  };

  // Group projects by organization for display
  const groupedProjects = projects.reduce(
    (acc, project) => {
      const orgKey = project.organizationSlug;
      if (!acc[orgKey]) {
        // Find the organization info to get the name
        const orgInfo = organizations.find(
          (o) => o.organizationSlug === project.organizationSlug,
        );
        acc[orgKey] = {
          orgLabel:
            orgInfo?.name ||
            `Organization ${project.organizationSlug.slice(0, 8)}`,
          projects: [],
        };
      }
      acc[orgKey].projects.push(project);
      return acc;
    },
    {} as Record<string, { orgLabel: string; projects: SupabaseProject[] }>,
  );

  const handleAddAccount = async () => {
    try {
      // Starting is a no-op while a flow is already active (double-click).
      const { started, invocationRef } = await startConnectionFlow("supabase");
      if (!started) {
        return;
      }
      try {
        if (settings?.isTestMode) {
          await ipc.supabase.fakeConnectAndSetProject({
            appId,
            fakeProjectId: "fake-project-id",
          });
        } else {
          await ipc.system.openExternalUrl(
            "https://supabase-oauth.dyad.sh/api/connect-supabase/login",
          );
        }
      } catch (error) {
        await cancelConnectionFlow("supabase", invocationRef);
        throw error;
      }
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  const handleUpdateApiKey = async () => {
    try {
      const { outcome } = await switchKey.mutateAsync({ appId });
      if (outcome === "switched") {
        toast.success(t("integrations.supabase.apiKeyUpdated"));
      } else if (outcome === "already-current") {
        toast.success(t("integrations.supabase.apiKeyAlreadyCurrent"));
      } else {
        // The key is still legacy and Dyad couldn't act on it. Reporting
        // success here would leave the user believing a broken app was fixed.
        toast.info(t("integrations.supabase.apiKeyNotUpdated"));
      }
    } catch (error) {
      console.error("Failed to update the app's Supabase key:", error);
      toast.error(
        t("integrations.supabase.failedUpdateApiKey", {
          error: String(error),
        }),
      );
    }
  };

  const handleUnsetProject = async () => {
    try {
      await unsetAppProject(appId);
      toast.success(t("integrations.supabase.disconnectProject"));
      await refreshApp();
    } catch (error) {
      console.error("Failed to disconnect project:", error);
      toast.error(t("integrations.supabase.failedDisconnectProject"));
    }
  };

  const handleRedeployAllFunctions = async () => {
    try {
      const result = await redeployAllFunctions();
      if (result.errors.length > 0) {
        showError(
          t("integrations.supabase.redeployFailed", {
            error: result.errors.join("\n"),
          }),
        );
      } else if (
        result.functionCount === 0 &&
        result.prunedFunctionNames.length > 0
      ) {
        toast.success(
          t("integrations.supabase.redeployPrunedOnly", {
            functions: result.prunedFunctionNames.join(", "),
          }),
        );
      } else if (result.functionCount === 0) {
        toast.info(t("integrations.supabase.noFunctionsToRedeploy"));
      } else if (result.prunedFunctionNames.length > 0) {
        toast.success(
          t("integrations.supabase.redeploySucceededWithPruning", {
            count: result.functionCount,
            functions: result.prunedFunctionNames.join(", "),
          }),
        );
      } else {
        toast.success(
          t("integrations.supabase.redeploySucceeded", {
            count: result.functionCount,
          }),
        );
      }
    } catch (error) {
      showError(
        t("integrations.supabase.redeployFailed", {
          error: getErrorMessage(error),
        }),
      );
    }
  };

  const handleDeleteOrganization = async (organizationSlug: string) => {
    try {
      await deleteOrganization({ organizationSlug });
      toast.success(t("integrations.supabase.orgDisconnected"));
    } catch {
      toast.error(t("integrations.supabase.failedDisconnect"));
    }
  };

  const linkedProjectForRelink = app?.supabaseProjectId
    ? findLinkedSupabaseProject(
        projects,
        app.supabaseProjectId,
        app.supabaseParentProjectId,
      )
    : undefined;
  const isLoadingRelinkCandidate = isLoadingOrganizations || isLoadingProjects;
  const handleRelinkProject = async () => {
    if (!app?.supabaseProjectId || !linkedProjectForRelink) return;
    try {
      await setAppProject({
        appId,
        projectId: app.supabaseProjectId,
        parentProjectId: app.supabaseParentProjectId,
        organizationSlug: linkedProjectForRelink.organizationSlug,
      });
      toast.success(t("integrations.supabase.projectConnected"));
      await refreshApp();
    } catch (error) {
      toast.error(
        t("integrations.supabase.failedConnectProject", {
          error: String(error),
        }),
      );
    }
  };

  // Keep recovery controls available when the app still points at a project
  // whose organization token has been removed. Hiding the association here
  // would strand the user on a generic account-connect screen.
  if (app?.supabaseProjectId && !isConnected) {
    return (
      <Card className="mt-1" data-testid="supabase-reconnect-card">
        <CardHeader>
          <CardTitle>{t("integrations.supabase.project")}</CardTitle>
          <div className="flex flex-col gap-1.5 text-sm text-muted-foreground">
            {t("integrations.supabase.connectedToProject")}
            <Badge variant="secondary" className="w-fit text-base font-bold">
              {app.supabaseProjectName || app.supabaseProjectId}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription>
              {t("integrations.supabase.organizationCredentialsMissing")}
            </AlertDescription>
          </Alert>
          {(organizationsError || projectsError) && (
            <div className="text-red-500">
              {t("integrations.supabase.errorLoadingProjects", {
                message: (organizationsError || projectsError)?.message,
              })}
              <Button
                variant="outline"
                className="mt-2"
                onClick={async () => {
                  await refetchOrganizations();
                  await refetchProjects();
                }}
              >
                {t("common:retry")}
              </Button>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {isLoadingRelinkCandidate ? (
              <Button variant="outline" disabled>
                <Loader2 className="h-4 w-4 animate-spin" />
                {t("integrations.supabase.relinkProject")}
              </Button>
            ) : linkedProjectForRelink ? (
              <Button
                variant="outline"
                onClick={handleRelinkProject}
                disabled={isSettingAppProject}
                data-testid="relink-supabase-project-button"
              >
                {t("integrations.supabase.relinkProject")}
              </Button>
            ) : null}
            <Button
              variant="outline"
              onClick={handleAddAccount}
              disabled={isFlowActive}
              data-testid="reconnect-supabase-button"
            >
              {t("integrations.supabase.addOrganization")}
            </Button>
            <Button variant="destructive" onClick={handleUnsetProject}>
              {t("integrations.supabase.disconnectProject")}
            </Button>
            {isFlowActive && "invocationRef" in flowState && (
              <Button
                variant="ghost"
                onClick={() =>
                  void cancelConnectionFlow("supabase", flowState.invocationRef)
                }
                data-testid="cancel-supabase-flow-button"
              >
                {t("integrations.supabase.cancelSignIn")}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  // Connected and has project set
  if (isConnected && app?.supabaseProjectName) {
    return (
      <Card className="mt-1">
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            {t("integrations.supabase.project")}{" "}
            <Button
              variant="outline"
              onClick={() => {
                ipc.system.openExternalUrl(
                  `https://supabase.com/dashboard/project/${app.supabaseProjectId}`,
                );
              }}
              className="ml-2 px-2 py-1 inline-flex items-center gap-2"
            >
              <img
                src={isDarkMode ? supabaseLogoDark : supabaseLogoLight}
                alt="Supabase Logo"
                style={{ height: 20, width: "auto", marginRight: 4 }}
              />
              <ExternalLink className="h-4 w-4" />
            </Button>
          </CardTitle>
          <CardDescription className="flex flex-col gap-1.5 text-sm">
            {t("integrations.supabase.connectedToProject")}{" "}
            <Badge
              variant="secondary"
              className="ml-2 text-base font-bold px-3 py-1"
            >
              {app.supabaseProjectName}
            </Badge>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="supabase-branch-select">
                {t("integrations.supabase.databaseBranch")}
              </Label>
              {branchesError ? (
                <Alert>
                  <Info className="h-4 w-4" />
                  <AlertDescription>
                    {getErrorMessage(branchesError)}
                  </AlertDescription>
                </Alert>
              ) : (
                <Select
                  value={app.supabaseProjectId || ""}
                  onValueChange={async (supabaseBranchProjectId) => {
                    try {
                      const branch = branches.find(
                        (b) => b.projectRef === supabaseBranchProjectId,
                      );
                      if (!branch) {
                        throw new Error(
                          t("integrations.supabase.branchNotFound"),
                        );
                      }
                      // Keep the same organizationSlug from the app
                      await setAppProject({
                        projectId: branch.projectRef,
                        parentProjectId: branch.parentProjectRef,
                        appId,
                        organizationSlug: app.supabaseOrganizationSlug,
                      });
                      toast.success(t("integrations.supabase.branchSelected"));
                      await refreshApp();
                    } catch (error) {
                      toast.error(
                        t("integrations.supabase.failedSetBranch", {
                          error: String(error),
                        }),
                      );
                    }
                  }}
                  disabled={isLoadingBranches || isSettingAppProject}
                >
                  <SelectTrigger
                    id="supabase-branch-select"
                    data-testid="supabase-branch-select"
                  >
                    <SelectValue
                      placeholder={t("integrations.supabase.selectBranch")}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {branches.map((branch) => (
                      <SelectItem
                        key={branch.projectRef}
                        value={branch.projectRef}
                      >
                        {branch.name}
                        {branch.isDefault && " (Default)"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            {/* Shown only once the app's client is confirmed to hold this
            project's legacy key — an app already on a publishable key has
            nothing to update. Detection has to find the key for this to appear
            at all (see detectLegacyAppKey). */}
            {hasLegacyKey && (
              <div className="space-y-2" data-testid="supabase-legacy-key">
                <Alert>
                  <Info className="h-4 w-4" />
                  <AlertDescription>
                    {t("integrations.supabase.legacyApiKeyWarning")}
                  </AlertDescription>
                </Alert>
                <Button
                  variant="outline"
                  onClick={handleUpdateApiKey}
                  disabled={switchKey.isPending}
                  data-testid="supabase-update-api-key-button"
                >
                  {t("integrations.supabase.updateApiKey")}
                </Button>
                <p className="text-xs text-muted-foreground">
                  {t("integrations.supabase.updateApiKeyDescription")}
                </p>
              </div>
            )}

            <div className="space-y-2">
              <Button
                variant="outline"
                onClick={handleRedeployAllFunctions}
                disabled={isRedeployingFunctions}
                data-testid="supabase-redeploy-functions-button"
              >
                {isRedeployingFunctions && (
                  <Loader2 className="h-4 w-4 animate-spin" />
                )}
                {isRedeployingFunctions
                  ? redeployProgress
                    ? t("integrations.supabase.redeployProgress", {
                        completed: redeployProgress.completed,
                        total: redeployProgress.total,
                      })
                    : t("integrations.supabase.preparingRedeploy")
                  : t("integrations.supabase.redeployFunctions")}
              </Button>
              <p className="text-xs text-muted-foreground">
                {t("integrations.supabase.redeployFunctionsDescription")}
              </p>
            </div>

            <Button variant="destructive" onClick={handleUnsetProject}>
              {t("integrations.supabase.disconnectProject")}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Connected organizations exist, show project selector
  if (isConnected) {
    // Build current project value for the select
    const currentProjectValue =
      app?.supabaseOrganizationSlug && app?.supabaseProjectId
        ? `${app.supabaseOrganizationSlug}:${app.supabaseProjectId}`
        : "";

    return (
      <Card className="mt-1">
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            {t("integrations.supabase.projects")}
            <div className="flex items-center gap-2">
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => refetchProjects()}
                      disabled={isFetchingProjects}
                    />
                  }
                >
                  <RefreshCw
                    className={`h-4 w-4 ${isFetchingProjects ? "animate-spin" : ""}`}
                  />
                </TooltipTrigger>
                <TooltipContent>
                  {t("integrations.supabase.refreshProjects")}
                </TooltipContent>
              </Tooltip>
              <Button
                variant="outline"
                size="sm"
                onClick={handleAddAccount}
                disabled={isFlowActive}
                className="gap-1"
              >
                <Plus className="h-4 w-4" />
                {t("integrations.supabase.addOrganization")}
              </Button>
              {isFlowActive && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    if ("invocationRef" in flowState) {
                      void cancelConnectionFlow(
                        "supabase",
                        flowState.invocationRef,
                      );
                    }
                  }}
                  data-testid="cancel-supabase-flow-button"
                >
                  {t("integrations.supabase.cancelSignIn")}
                </Button>
              )}
            </div>
          </CardTitle>
          <CardDescription>
            {t("integrations.supabase.selectProjectDescription")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoadingProjects || isFetchingProjects ? (
            <div className="space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : projectsError ? (
            <div className="text-red-500">
              {t("integrations.supabase.errorLoadingProjects", {
                message: projectsError.message,
              })}
              <Button
                variant="outline"
                className="mt-2"
                onClick={() => refetchProjects()}
              >
                {t("common:retry")}
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Connected organizations list */}
              <div className="space-y-2">
                <Label>
                  {t("integrations.supabase.connectedOrganizations")}
                </Label>
                <div className="space-y-1">
                  {organizations.map((org) => (
                    <div
                      key={org.organizationSlug}
                      className="flex items-center justify-between p-2 rounded-md bg-muted/50 text-sm gap-2"
                    >
                      <div className="flex flex-col min-w-0 flex-1">
                        <span className="font-medium truncate">
                          {org.name ||
                            `Organization ${org.organizationSlug.slice(0, 8)}`}
                        </span>
                        {org.ownerEmail && (
                          <span className="text-xs text-muted-foreground truncate">
                            {org.ownerEmail}
                          </span>
                        )}
                      </div>
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-muted-foreground hover:text-destructive shrink-0"
                              onClick={() =>
                                handleDeleteOrganization(org.organizationSlug)
                              }
                            />
                          }
                        >
                          <Trash2 className="h-3.5 w-3.5 mr-1" />
                          <span className="text-xs">Disconnect</span>
                        </TooltipTrigger>
                        <TooltipContent>
                          {t("integrations.supabase.disconnectOrganization")}
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  ))}
                </div>
              </div>

              {projects.length === 0 ? (
                <p className="text-sm text-gray-500">
                  {t("integrations.supabase.noProjectsFound")}
                </p>
              ) : (
                <div className="space-y-2">
                  <Label htmlFor="project-select">Project</Label>
                  <Select
                    value={currentProjectValue}
                    onValueChange={(v) => v && handleProjectSelect(v)}
                  >
                    <SelectTrigger id="project-select">
                      <SelectValue
                        placeholder={t("integrations.supabase.selectAProject")}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(groupedProjects).map(
                        ([orgKey, { orgLabel, projects: orgProjects }]) => (
                          <SelectGroup key={orgKey}>
                            <SelectLabel>{orgLabel}</SelectLabel>
                            {orgProjects.map((project) => (
                              <SelectItem
                                key={`${project.organizationSlug}:${project.id}`}
                                value={`${project.organizationSlug}:${project.id}`}
                              >
                                {project.name || project.id}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        ),
                      )}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  // No accounts connected, show connect button
  return (
    <div className="flex flex-col space-y-4 p-4 border rounded-md">
      <div className="flex flex-col md:flex-row items-center justify-between">
        <h2 className="text-lg font-medium">Integrations</h2>
        <img
          onClick={isFlowActive ? undefined : handleAddAccount}
          src={isDarkMode ? connectSupabaseDark : connectSupabaseLight}
          alt="Connect to Supabase"
          aria-busy={isFlowActive}
          className={`w-full h-10 min-h-8 min-w-20 ${
            isFlowActive ? "cursor-wait opacity-60" : "cursor-pointer"
          }`}
          data-testid="connect-supabase-button"
        />
      </div>
      {isFlowActive && (
        <div className="flex justify-end">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              if ("invocationRef" in flowState) {
                void cancelConnectionFlow("supabase", flowState.invocationRef);
              }
            }}
            data-testid="cancel-supabase-flow-button"
          >
            {t("integrations.supabase.cancelSignIn")}
          </Button>
        </div>
      )}
    </div>
  );
}
