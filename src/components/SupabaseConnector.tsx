import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";

import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";

import { ipc, type SupabaseProject } from "@/ipc/types";
import { toast } from "sonner";
import { useSettings } from "@/hooks/useSettings";
import { useSupabase } from "@/hooks/useSupabase";
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
import { useDeepLink } from "@/contexts/DeepLinkContext";

// @ts-ignore
import supabaseLogoLight from "../../assets/supabase/supabase-logo-wordmark--light.svg";
// @ts-ignore
import supabaseLogoDark from "../../assets/supabase/supabase-logo-wordmark--dark.svg";
// @ts-ignore
import connectSupabaseDark from "../../assets/supabase/connect-supabase-dark.svg";
// @ts-ignore
import connectSupabaseLight from "../../assets/supabase/connect-supabase-light.svg";

import { ExternalLink, Info, Plus, RefreshCw, Trash2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { getErrorMessage } from "@/lib/errors";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { useTheme } from "@/contexts/ThemeContext";
import {
  getEffectiveAppSupabaseMode,
  hasSelfHostedSupabaseConfig,
  isSupabaseConnected,
  type SupabaseAppMode,
} from "@/lib/schemas";

export function SupabaseConnector({ appId }: { appId: number }) {
  const { t } = useTranslation(["home", "common"]);
  const { settings, refreshSettings } = useSettings();
  const { app, refreshApp } = useLoadApp(appId);
  const { lastDeepLink, clearLastDeepLink } = useDeepLink();
  const { isDarkMode } = useTheme();

  // Check if there are any connected organizations
  const isConnected = isSupabaseConnected(settings);
  const hasSelfHostedSupabase = hasSelfHostedSupabaseConfig(settings);
  const appSupabaseMode = getEffectiveAppSupabaseMode(app);
  const [selectedMode, setSelectedMode] = useState<SupabaseAppMode | null>(
    appSupabaseMode ?? (hasSelfHostedSupabase ? "self-hosted" : "cloud"),
  );
  const [selfHostedProjectId, setSelfHostedProjectId] = useState(
    appSupabaseMode === "self-hosted" ? app?.supabaseProjectId || "" : "",
  );

  const branchesProjectId =
    app?.supabaseParentProjectId || app?.supabaseProjectId;

  const {
    organizations,
    projects,
    branches,
    isLoadingProjects,
    isFetchingProjects,
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
    branchesMode: appSupabaseMode,
  });

  useEffect(() => {
    setSelectedMode(
      appSupabaseMode ?? (hasSelfHostedSupabase ? "self-hosted" : "cloud"),
    );
    setSelfHostedProjectId(
      appSupabaseMode === "self-hosted" ? app?.supabaseProjectId || "" : "",
    );
  }, [
    app?.supabaseProjectId,
    appSupabaseMode,
    hasSelfHostedSupabase,
    isConnected,
  ]);

  useEffect(() => {
    const handleDeepLink = async () => {
      if (lastDeepLink?.type === "supabase-oauth-return") {
        await refreshSettings();
        await refetchOrganizations();
        await refetchProjects();
        await refreshApp();
        clearLastDeepLink();
      }
    };
    handleDeepLink();
  }, [lastDeepLink?.timestamp]);

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
        mode: "cloud",
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

  const handleSelfHostedProjectSave = async () => {
    const projectId = selfHostedProjectId.trim();
    if (!projectId) {
      toast.error(t("integrations.supabase.enterProjectId"));
      return;
    }

    try {
      await setAppProject({
        appId,
        projectId,
        parentProjectId: null,
        organizationSlug: null,
        mode: "self-hosted",
      });
      toast.success(t("integrations.supabase.selfHostedProjectConnected"));
      await refreshApp();
    } catch (error) {
      toast.error(
        t("integrations.supabase.failedConnectSelfHosted") +
          `: ${String(error)}`,
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

  const handleDeleteOrganization = async (organizationSlug: string) => {
    try {
      await deleteOrganization({ organizationSlug });
      toast.success(t("integrations.supabase.orgDisconnected"));
    } catch {
      toast.error(t("integrations.supabase.failedDisconnect"));
    }
  };

  const modeSelector =
    isConnected || hasSelfHostedSupabase ? (
      <div className="flex gap-2">
        <Button
          variant={selectedMode === "cloud" ? "default" : "outline"}
          size="sm"
          onClick={() => setSelectedMode("cloud")}
        >
          Cloud
        </Button>
        {hasSelfHostedSupabase && (
          <Button
            variant={selectedMode === "self-hosted" ? "default" : "outline"}
            size="sm"
            onClick={() => setSelectedMode("self-hosted")}
          >
            Self-hosted
          </Button>
        )}
      </div>
    ) : null;

  // Connected and has project set
  if (
    selectedMode !== "self-hosted" &&
    appSupabaseMode === "cloud" &&
    app?.supabaseProjectName
  ) {
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
            {modeSelector}
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
                        mode: "cloud",
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

            <Button variant="destructive" onClick={handleUnsetProject}>
              {t("integrations.supabase.disconnectProject")}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (selectedMode === "self-hosted" && (hasSelfHostedSupabase || (appSupabaseMode === "self-hosted" && app?.supabaseProjectId))) {
    return (
      <Card className="mt-1">
        <CardHeader>
          <CardTitle>{t("integrations.supabase.selfHostedTitle")}</CardTitle>
          <CardDescription>
            {t("integrations.supabase.selfHostedDescription")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {modeSelector}
          <div className="space-y-2">
            <Label htmlFor="self-hosted-project-id">Project ID</Label>
            <Input
              id="self-hosted-project-id"
              value={selfHostedProjectId}
              onChange={(e) => setSelfHostedProjectId(e.target.value)}
              placeholder="your-project-ref"
            />
          </div>

          {appSupabaseMode === "self-hosted" && app?.supabaseProjectId ? (
            <div className="rounded-md border p-3 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-medium">
                    {app.supabaseProjectName || app.supabaseProjectId}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {t("integrations.supabase.selfHostedConnected")}
                  </div>
                </div>
                <Badge variant="secondary">Self-hosted</Badge>
              </div>

              <p className="text-xs text-muted-foreground">
                {t("integrations.supabase.branchingNotAvailable")}
              </p>

              <Button variant="destructive" onClick={handleUnsetProject}>
                {t("integrations.supabase.disconnectProject")}
              </Button>
            </div>
          ) : null}

          <Button onClick={handleSelfHostedProjectSave}>
            {t("integrations.supabase.useSelfHostedProject")}
          </Button>
        </CardContent>
      </Card>
    );
  }

  // Connected organizations exist, show cloud project selector
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
                className="gap-1"
              >
                <Plus className="h-4 w-4" />
                {t("integrations.supabase.addOrganization")}
              </Button>
            </div>
          </CardTitle>
          <CardDescription>
            {t("integrations.supabase.selectProjectDescription")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-4">{modeSelector}</div>
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

  // Cloud mode selected but no accounts connected yet
  if (selectedMode === "cloud" && !isConnected) {
    return (
      <Card className="mt-1">
        <CardHeader>
          <CardTitle>{t("integrations.supabase.selfHostedTitle")}</CardTitle>
          <CardDescription>
            {t("integrations.supabase.connectCloudDescription")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {modeSelector}
          <div className="flex flex-col space-y-4 border rounded-md p-4">
            <div className="flex flex-col md:flex-row items-center justify-between gap-3">
              <div className="text-sm text-muted-foreground">
                {t("integrations.supabase.noCloudOrganizations")}
              </div>
              <img
                onClick={handleAddAccount}
                src={isDarkMode ? connectSupabaseDark : connectSupabaseLight}
                alt="Connect to Supabase"
                className="w-full h-10 min-h-8 min-w-20 cursor-pointer"
                data-testid="connect-supabase-button"
              />
            </div>
          </div>
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
          onClick={handleAddAccount}
          src={isDarkMode ? connectSupabaseDark : connectSupabaseLight}
          alt="Connect to Supabase"
          className="w-full h-10 min-h-8 min-w-20 cursor-pointer"
          data-testid="connect-supabase-button"
        />
      </div>
    </div>
  );
}
