import { useEffect } from "react";
import { Button } from "@/components/ui/button";

import { Label } from "@/components/ui/label";

import { IpcClient } from "@/ipc/ipc_client";
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

import { ExternalLink, Plus, Trash2 } from "lucide-react";
import { useTheme } from "@/contexts/ThemeContext";
import type { SupabaseProject } from "@/ipc/ipc_types";
import { isSupabaseConnected } from "@/lib/schemas";

export function SupabaseConnector({ appId }: { appId: number }) {
  const { settings, refreshSettings } = useSettings();
  const { app, refreshApp } = useLoadApp(appId);
  const { lastDeepLink, clearLastDeepLink } = useDeepLink();
  const { isDarkMode } = useTheme();

  // Check if there are any connected organizations
  const isConnected = isSupabaseConnected(settings);

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
        throw new Error("Project not found");
      }
      await setAppProject({
        projectId,
        appId,
        organizationSlug,
      });
      toast.success("Project connected to app successfully");
      await refreshApp();
    } catch (error) {
      toast.error("Failed to connect project to app: " + error);
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
      await IpcClient.getInstance().fakeHandleSupabaseConnect({
        appId,
        fakeProjectId: "fake-project-id",
      });
    } else {
      await IpcClient.getInstance().openExternalUrl(
        "https://supabase-oauth.dyad.sh/api/connect-supabase/login",
      );
    }
  };

  const handleUnsetProject = async () => {
    try {
      await unsetAppProject(appId);
      toast.success("Project disconnected from app successfully");
      await refreshApp();
    } catch (error) {
      console.error("Failed to disconnect project:", error);
      toast.error("Failed to disconnect project from app");
    }
  };

  const handleDeleteOrganization = async (organizationSlug: string) => {
    try {
      await deleteOrganization({ organizationSlug });
      toast.success("Organization disconnected successfully");
    } catch (error) {
      toast.error("Failed to disconnect organization: " + error);
    }
  };

  // Connected and has project set
  if (isConnected && app?.supabaseProjectName) {
    return (
      <Card className="mt-1">
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            Supabase Project{" "}
            <Button
              variant="outline"
              onClick={() => {
                IpcClient.getInstance().openExternalUrl(
                  `https://supabase.com/dashboard/project/${app.supabaseProjectId}`,
                );
              }}
              className="ml-2 px-2 py-1"
              style={{ display: "inline-flex", alignItems: "center" }}
              asChild
            >
              <div className="flex items-center gap-2">
                <img
                  src={isDarkMode ? supabaseLogoDark : supabaseLogoLight}
                  alt="Supabase Logo"
                  style={{ height: 20, width: "auto", marginRight: 4 }}
                />
                <ExternalLink className="h-4 w-4" />
              </div>
            </Button>
          </CardTitle>
          <CardDescription className="flex flex-col gap-1.5 text-sm">
            This app is connected to project:{" "}
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
              <Label htmlFor="supabase-branch-select">Database Branch</Label>
              <Select
                value={app.supabaseProjectId || ""}
                onValueChange={async (supabaseBranchProjectId) => {
                  try {
                    const branch = branches.find(
                      (b) => b.projectRef === supabaseBranchProjectId,
                    );
                    if (!branch) {
                      throw new Error("Branch not found");
                    }
                    // Keep the same organizationSlug from the app
                    await setAppProject({
                      projectId: branch.projectRef,
                      parentProjectId: branch.parentProjectRef,
                      appId,
                      organizationSlug: app.supabaseOrganizationSlug,
                    });
                    toast.success("Branch selected");
                    await refreshApp();
                  } catch (error) {
                    toast.error("Failed to set branch: " + error);
                  }
                }}
                disabled={isLoadingBranches || isSettingAppProject}
              >
                <SelectTrigger
                  id="supabase-branch-select"
                  data-testid="supabase-branch-select"
                >
                  <SelectValue placeholder="Select a branch" />
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
            </div>

            <Button variant="destructive" onClick={handleUnsetProject}>
              Disconnect Project
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
            Supabase Projects
            <Button
              variant="outline"
              size="sm"
              onClick={handleAddAccount}
              className="gap-1"
            >
              <Plus className="h-4 w-4" />
              Add Organization
            </Button>
          </CardTitle>
          <CardDescription>
            Select a Supabase project to connect to this app
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
              Error loading projects: {projectsError.message}
              <Button
                variant="outline"
                className="mt-2"
                onClick={() => refetchProjects()}
              >
                Retry
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Connected organizations list */}
              <div className="space-y-2">
                <Label>Connected Organizations</Label>
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
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-muted-foreground hover:text-destructive shrink-0"
                        onClick={() =>
                          handleDeleteOrganization(org.organizationSlug)
                        }
                        title="Disconnect organization"
                      >
                        <Trash2 className="h-3.5 w-3.5 mr-1" />
                        <span className="text-xs">Disconnect</span>
                      </Button>
                    </div>
                  ))}
                </div>
              </div>

              {projects.length === 0 ? (
                <p className="text-sm text-gray-500">
                  No projects found in your connected Supabase organizations.
                </p>
              ) : (
                <div className="space-y-2">
                  <Label htmlFor="project-select">Project</Label>
                  <Select
                    value={currentProjectValue}
                    onValueChange={handleProjectSelect}
                  >
                    <SelectTrigger id="project-select">
                      <SelectValue placeholder="Select a project" />
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
