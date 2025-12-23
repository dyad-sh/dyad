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
import type { SupabaseProjectWithAccount } from "@/ipc/ipc_types";

export function SupabaseConnector({ appId }: { appId: number }) {
  const { settings, refreshSettings } = useSettings();
  const { app, refreshApp } = useLoadApp(appId);
  const { lastDeepLink, clearLastDeepLink } = useDeepLink();
  const { isDarkMode } = useTheme();
  useEffect(() => {
    const handleDeepLink = async () => {
      if (lastDeepLink?.type === "supabase-oauth-return") {
        await refreshSettings();
        await loadAccounts();
        await loadProjects();
        await refreshApp();
        clearLastDeepLink();
      }
    };
    handleDeepLink();
  }, [lastDeepLink?.timestamp]);
  const {
    accounts,
    projects,
    loading,
    error,
    loadAccounts,
    deleteAccount,
    loadProjects,
    branches,
    loadBranches,
    setAppProject,
    unsetAppProject,
  } = useSupabase();

  // Check if there are any connected accounts
  const hasConnectedAccounts = accounts.length > 0;

  useEffect(() => {
    // Load accounts and projects when the component mounts
    loadAccounts();
  }, [loadAccounts]);

  useEffect(() => {
    // Load projects when accounts are available
    if (hasConnectedAccounts) {
      loadProjects();
    }
  }, [hasConnectedAccounts, loadProjects]);

  const handleProjectSelect = async (projectValue: string) => {
    try {
      // projectValue format: "userId:organizationId:projectId"
      const [userId, organizationId, projectId] = projectValue.split(":");
      const project = projects.find(
        (p) =>
          p.id === projectId &&
          p.userId === userId &&
          p.organizationId === organizationId,
      );
      if (!project) {
        throw new Error("Project not found");
      }
      await setAppProject({
        projectId,
        appId,
        userId,
        organizationId,
      });
      toast.success("Project connected to app successfully");
      await refreshApp();
    } catch (error) {
      toast.error("Failed to connect project to app: " + error);
    }
  };

  // Group projects by account for display
  const groupedProjects = projects.reduce(
    (acc, project) => {
      const accountKey = `${project.userId}:${project.organizationId}`;
      if (!acc[accountKey]) {
        const account = accounts.find(
          (a) =>
            a.userId === project.userId &&
            a.organizationId === project.organizationId,
        );
        acc[accountKey] = {
          accountLabel:
            account?.organizationName ||
            account?.userEmail ||
            `Account ${project.userId.slice(0, 8)}`,
          projects: [],
        };
      }
      acc[accountKey].projects.push(project);
      return acc;
    },
    {} as Record<
      string,
      { accountLabel: string; projects: SupabaseProjectWithAccount[] }
    >,
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

  const projectIdForBranches =
    app?.supabaseParentProjectId || app?.supabaseProjectId;
  useEffect(() => {
    if (projectIdForBranches) {
      loadBranches(projectIdForBranches);
    }
  }, [projectIdForBranches, loadBranches]);

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

  const handleDeleteAccount = async (
    userId: string,
    organizationId: string,
  ) => {
    try {
      await deleteAccount({ userId, organizationId });
      toast.success("Account disconnected successfully");
      await loadProjects();
    } catch (error) {
      toast.error("Failed to disconnect account: " + error);
    }
  };

  // Connected and has project set
  if (hasConnectedAccounts && app?.supabaseProjectName) {
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
          <CardDescription>
            This app is connected to project: {app.supabaseProjectName}
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
                    // Keep the same userId/organizationId from the app
                    await setAppProject({
                      projectId: branch.projectRef,
                      parentProjectId: branch.parentProjectRef,
                      appId,
                      userId: app.supabaseUserId!,
                      organizationId: app.supabaseOrganizationId!,
                    });
                    toast.success("Branch selected");
                    await refreshApp();
                  } catch (error) {
                    toast.error("Failed to set branch: " + error);
                  }
                }}
                disabled={loading}
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

  // Connected accounts exist, show project selector
  if (hasConnectedAccounts) {
    // Build current project value for the select
    const currentProjectValue =
      app?.supabaseUserId &&
      app?.supabaseOrganizationId &&
      app?.supabaseProjectId
        ? `${app.supabaseUserId}:${app.supabaseOrganizationId}:${app.supabaseProjectId}`
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
              Add Account
            </Button>
          </CardTitle>
          <CardDescription>
            Select a Supabase project to connect to this app
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : error ? (
            <div className="text-red-500">
              Error loading projects: {error.message}
              <Button
                variant="outline"
                className="mt-2"
                onClick={() => loadProjects()}
              >
                Retry
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Connected accounts list */}
              <div className="space-y-2">
                <Label>Connected Accounts</Label>
                <div className="space-y-1">
                  {accounts.map((account) => (
                    <div
                      key={`${account.userId}:${account.organizationId}`}
                      className="flex items-center justify-between p-2 rounded-md bg-muted/50 text-sm"
                    >
                      <span>
                        {account.organizationName ||
                          account.userEmail ||
                          `Account ${account.userId.slice(0, 8)}`}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                        onClick={() =>
                          handleDeleteAccount(
                            account.userId,
                            account.organizationId,
                          )
                        }
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>

              {projects.length === 0 ? (
                <p className="text-sm text-gray-500">
                  No projects found in your connected Supabase accounts.
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
                        ([
                          accountKey,
                          { accountLabel, projects: accountProjects },
                        ]) => (
                          <SelectGroup key={accountKey}>
                            <SelectLabel>{accountLabel}</SelectLabel>
                            {accountProjects.map((project) => (
                              <SelectItem
                                key={`${project.userId}:${project.organizationId}:${project.id}`}
                                value={`${project.userId}:${project.organizationId}:${project.id}`}
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
