import { useState } from "react";
import { NeonSignInButton } from "@/components/NeonSignInButton";
import { NeonLogo } from "@/components/NeonLogo";
import { useTranslation } from "react-i18next";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ipc, type NeonProjectListItem } from "@/ipc/types";
import { toast } from "sonner";
import { useSettings } from "@/hooks/useSettings";
import {
  Select,
  SelectContent,
  SelectItem,
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
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { useLoadApp } from "@/hooks/useLoadApp";
import { Switch } from "@/components/ui/switch";
import {
  ExternalLink,
  Info,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useTheme } from "@/contexts/ThemeContext";
import { useNeon } from "@/hooks/useNeon";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import { isNeonSupportedFramework } from "@/lib/framework_constants";
import { getErrorMessage } from "@/lib/errors";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export function NeonConnector({ appId }: { appId: number }) {
  const { t } = useTranslation("home");
  const { updateSettings } = useSettings();
  const { app, loading: isLoadingApp, refreshApp } = useLoadApp(appId);
  const queryClient = useQueryClient();
  const { isDarkMode } = useTheme();

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [createProjectError, setCreateProjectError] = useState<string | null>(
    null,
  );
  const [isConnecting, setIsConnecting] = useState(false);
  const [isSwitchingBranch, setIsSwitchingBranch] = useState(false);
  const [isUpdatingEmailVerification, setIsUpdatingEmailVerification] =
    useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [isDisconnectingAccount, setIsDisconnectingAccount] = useState(false);
  const [isDisconnectDialogOpen, setIsDisconnectDialogOpen] = useState(false);
  const [removeFromVercel, setRemoveFromVercel] = useState(true);
  const [removeFromCloudflare, setRemoveFromCloudflare] = useState(true);
  const [isDisconnectAccountDialogOpen, setIsDisconnectAccountDialogOpen] =
    useState(false);
  const formatToastError = (error: unknown) => getErrorMessage(error);
  const projectDateFormatter = new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
  });

  const {
    isConnected,
    projects,
    projectInfo,
    branches,
    emailPasswordConfig,
    isLoadingEmailConfig,
    isLoadingProjects,
    isFetchingProjects,
    projectsError,
    isLoadingBranches,
    branchesError,
    refetchProjects,
  } = useNeon(appId);

  const handleProjectSelect = async (projectId: string) => {
    setIsConnecting(true);
    try {
      const result = await ipc.neon.setAppProject({ appId, projectId });
      toast.success(t("integrations.neon.projectConnected"));
      if (result.warning) {
        toast.warning(result.warning);
      }
      await refreshApp();
      queryClient.invalidateQueries({ queryKey: queryKeys.apps.all });
      queryClient.invalidateQueries({
        queryKey: queryKeys.appEnvVars.byApp({ appId }),
      });
      // Invalidate all neon queries by prefix so stale branchId keys are covered
      queryClient.invalidateQueries({
        queryKey: queryKeys.neon.all,
      });
    } catch (error) {
      toast.error(
        t("integrations.neon.failedConnectProject", {
          error: formatToastError(error),
        }),
      );
    } finally {
      setIsConnecting(false);
    }
  };

  const handleCreateProject = async () => {
    if (!newProjectName.trim()) return;

    setCreateProjectError(null);
    setIsCreating(true);
    try {
      const result = await ipc.neon.createProject({
        name: newProjectName.trim(),
        appId,
      });
      toast.success(t("integrations.neon.projectConnected"));
      if (result.warning) {
        toast.warning(result.warning);
      }
      setShowCreateForm(false);
      setNewProjectName("");
      await refetchProjects();
      await refreshApp();
      queryClient.invalidateQueries({ queryKey: queryKeys.apps.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.neon.all });
      queryClient.invalidateQueries({
        queryKey: queryKeys.appEnvVars.byApp({ appId }),
      });
    } catch (error) {
      const errorMessage = formatToastError(error);
      setCreateProjectError(errorMessage);
      toast.error(
        t("integrations.neon.failedConnectProject", {
          error: errorMessage,
        }),
      );
    } finally {
      setIsCreating(false);
    }
  };

  const handleUnsetProject = async () => {
    setIsDisconnecting(true);
    const shouldRemoveFromVercel = removeFromVercel && !!app?.vercelProjectId;
    const shouldRemoveFromCloudflare =
      removeFromCloudflare && !!app?.deploymentProvidersInUse.cloudflare;
    try {
      await ipc.neon.unsetAppProject({ appId });

      // Clean up the Neon env vars we pushed to Vercel (default-on, opt-out).
      // Non-fatal: the Neon project is already unlinked, so a Vercel cleanup
      // failure only warrants a warning, not a failed disconnect.
      if (shouldRemoveFromVercel) {
        try {
          const result = await ipc.vercel.removeNeonEnvVars({ appId });
          if (result.warning) {
            toast.warning(result.warning);
          }
        } catch (vercelError) {
          console.error(
            "Failed to remove Neon env vars from Vercel:",
            vercelError,
          );
          toast.warning(t("integrations.neon.failedRemoveVercelEnvVars"));
        }
      }
      // The same for the secrets on the app's Cloudflare Workers.
      if (shouldRemoveFromCloudflare) {
        try {
          const result = await ipc.cloudflare.removeNeonEnvVars({ appId });
          if (result.warning) {
            toast.warning(result.warning);
          }
        } catch (cloudflareError) {
          console.error(
            "Failed to remove Neon secrets from Cloudflare:",
            cloudflareError,
          );
          toast.warning(t("integrations.neon.failedRemoveCloudflareEnvVars"));
        }
      }

      toast.success(t("integrations.neon.projectDisconnected"));
      setIsDisconnectDialogOpen(false);
      await refreshApp();
      queryClient.invalidateQueries({ queryKey: queryKeys.apps.all });
      queryClient.invalidateQueries({
        queryKey: queryKeys.appEnvVars.byApp({ appId }),
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.neon.all });
    } catch (error) {
      console.error("Failed to disconnect project:", error);
      toast.error(t("integrations.neon.failedDisconnectProject"));
    } finally {
      setIsDisconnecting(false);
    }
  };

  const handleDisconnectAccount = async () => {
    setIsDisconnectingAccount(true);
    try {
      // Clear app's Neon DB rows first so the app doesn't end up in a
      // broken state (linked to Neon but no OAuth token).
      if (app?.neonProjectId) {
        await ipc.neon.unsetAppProject({ appId });
        await refreshApp();
      }
      await updateSettings({ neon: undefined });
      setShowCreateForm(false);
      setNewProjectName("");
      setCreateProjectError(null);
      queryClient.removeQueries({ queryKey: queryKeys.neon.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.apps.all });
      toast.success(t("integrations.neon.disconnected"));
    } catch (error) {
      console.error("Failed to disconnect from Neon:", error);
      toast.error(t("integrations.neon.failedDisconnect"));
    } finally {
      setIsDisconnectingAccount(false);
    }
  };

  const handleEmailVerificationToggle = async (checked: boolean) => {
    setIsUpdatingEmailVerification(true);
    try {
      await ipc.neon.updateEmailVerification({
        appId,
        requireEmailVerification: checked,
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.neon.emailPasswordConfig({
          appId,
          branchId:
            app?.neonActiveBranchId ?? app?.neonDevelopmentBranchId ?? null,
        }),
      });
      toast.success(
        checked
          ? t("integrations.neon.emailVerificationEnabled")
          : t("integrations.neon.emailVerificationDisabled"),
      );
    } catch (error) {
      toast.error(
        t("integrations.neon.failedUpdateEmailVerification", {
          error: formatToastError(error),
        }),
      );
    } finally {
      setIsUpdatingEmailVerification(false);
    }
  };

  const handleBranchSelect = async (branchId: string) => {
    setIsSwitchingBranch(true);
    try {
      const result = await ipc.neon.setActiveBranch({ appId, branchId });
      const branch = branches.find((b) => b.branchId === branchId);
      toast.success(
        `${t("integrations.neon.branchSwitched")}: ${branch?.branchName ?? branchId}. ${t("integrations.neon.envUpdated")}`,
      );
      if (result.warning) {
        toast.warning(result.warning);
      }
      await refreshApp();
      queryClient.invalidateQueries({
        queryKey: queryKeys.appEnvVars.byApp({ appId }),
      });
    } catch (error) {
      toast.error(
        t("integrations.neon.failedSetBranch", {
          error: formatToastError(error),
        }),
      );
    } finally {
      setIsSwitchingBranch(false);
    }
  };

  const formatProjectDetails = (project: NeonProjectListItem) => {
    const details = [project.regionId];
    const createdAtMs = Date.parse(project.createdAt);

    if (Number.isFinite(createdAtMs)) {
      details.push(projectDateFormatter.format(new Date(createdAtMs)));
    }

    return details.join(" • ");
  };

  const getBranchBadgeVariant = (
    type: string,
  ): "default" | "secondary" | "outline" => {
    switch (type) {
      case "production":
        return "default";
      case "development":
        return "secondary";
      default:
        return "outline";
    }
  };

  // Neon is available for Next.js and Vite projects (Vite apps automatically
  // get a Nitro server layer added on connect).
  if (isLoadingApp) {
    return (
      <Card className="mt-1">
        <CardHeader>
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-4 w-48" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-10 w-full" />
        </CardContent>
      </Card>
    );
  }
  if (
    !isNeonSupportedFramework({
      files: app?.files,
      frameworkType: app?.frameworkType ?? null,
    })
  ) {
    return (
      <Card className="mt-1">
        <CardHeader>
          <CardTitle>{t("integrations.neon.database")}</CardTitle>
          <CardDescription>
            {t("integrations.neon.unsupportedFramework")}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  // State 1: Connected and has project set
  if (isConnected && app?.neonProjectId) {
    return (
      <Card className="mt-1">
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-2">
              <CardTitle className="flex flex-wrap items-center gap-2">
                <span>{t("integrations.neon.project")}</span>
                <Badge
                  variant="secondary"
                  className="max-w-full truncate px-3 py-1 text-base font-bold"
                  title={projectInfo?.projectName ?? app.neonProjectId}
                >
                  {projectInfo?.projectName ?? app.neonProjectId}
                </Badge>
              </CardTitle>
              <CardDescription className="text-sm">
                {t("integrations.neon.connectedToProject")}
              </CardDescription>
            </div>
            <Button
              variant="outline"
              aria-label={t("integrations.neon.openInConsole")}
              title={t("integrations.neon.openInConsole")}
              onClick={() => {
                ipc.system.openExternalUrl(
                  `https://console.neon.tech/app/projects/${app.neonProjectId}`,
                );
              }}
              className="inline-flex items-center gap-2 px-2 py-1"
            >
              <NeonLogo isDarkMode={isDarkMode} aria-hidden="true" />
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="neon-branch-select">
                {t("integrations.neon.activeBranch")}
              </Label>
              {branchesError ? (
                <div className="text-sm text-red-500">
                  <p>
                    {t("integrations.neon.errorLoadingBranches", {
                      message: formatToastError(branchesError),
                    })}
                  </p>
                  <Button
                    variant="outline"
                    className="mt-2"
                    onClick={() =>
                      queryClient.invalidateQueries({
                        queryKey: queryKeys.neon.project({ appId }),
                      })
                    }
                  >
                    {t("integrations.neon.retry")}
                  </Button>
                </div>
              ) : isLoadingBranches ? (
                <Skeleton className="h-10 w-full" />
              ) : branches.filter((b) => b.type !== "preview").length === 0 ? (
                <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                  <p>{t("integrations.neon.noBranchesFound")}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      onClick={() =>
                        queryClient.invalidateQueries({
                          queryKey: queryKeys.neon.project({ appId }),
                        })
                      }
                    >
                      {t("integrations.neon.retry")}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => {
                        ipc.system.openExternalUrl(
                          `https://console.neon.tech/app/projects/${app.neonProjectId}`,
                        );
                      }}
                    >
                      {t("integrations.neon.openInConsole")}
                    </Button>
                  </div>
                </div>
              ) : (
                <Select
                  value={app.neonActiveBranchId ?? ""}
                  onValueChange={(value) => value && handleBranchSelect(value)}
                  disabled={isSwitchingBranch}
                >
                  <SelectTrigger
                    id="neon-branch-select"
                    data-testid="neon-branch-select"
                  >
                    <SelectValue
                      placeholder={t("integrations.neon.selectBranch")}
                    >
                      {app.neonActiveBranchId
                        ? (branches.find(
                            (b) => b.branchId === app.neonActiveBranchId,
                          )?.branchName ?? app.neonActiveBranchId)
                        : undefined}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {branches
                      .filter((branch) => branch.type !== "preview")
                      .map((branch) => (
                        <SelectItem
                          key={branch.branchId}
                          value={branch.branchId}
                        >
                          <span className="flex items-center gap-2">
                            {branch.branchName}
                            <Badge
                              variant={getBranchBadgeVariant(branch.type)}
                              className="text-xs"
                            >
                              {t(`integrations.neon.${branch.type}`)}
                            </Badge>
                          </span>
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            {!isLoadingEmailConfig && emailPasswordConfig && (
              <div className="space-y-1">
                <div className="flex items-center space-x-2">
                  <Switch
                    id="neon-email-verification"
                    checked={emailPasswordConfig.require_email_verification}
                    onCheckedChange={handleEmailVerificationToggle}
                    disabled={isUpdatingEmailVerification}
                  />
                  <Label htmlFor="neon-email-verification">
                    {t("integrations.neon.requireEmailVerification")}
                  </Label>
                </div>
                <p className="text-xs text-muted-foreground pl-9">
                  {t("integrations.neon.emailVerificationHelp")}
                </p>
                <button
                  type="button"
                  onClick={() =>
                    ipc.system.openExternalUrl(
                      "https://neon.com/docs/auth/production-checklist#email-provider",
                    )
                  }
                  className="mt-2 w-full flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800 hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-200 dark:hover:bg-blue-900/30 transition-colors"
                >
                  <Info className="h-4 w-4 flex-shrink-0 text-blue-600 dark:text-blue-400" />
                  <span className="flex-1 text-left">
                    {t("integrations.neon.customEmailProviderHint")}
                  </span>
                  <ExternalLink className="h-3.5 w-3.5 flex-shrink-0 opacity-70" />
                </button>
              </div>
            )}

            <AlertDialog
              open={isDisconnectDialogOpen}
              onOpenChange={(open) => {
                if (isDisconnecting) return;
                setIsDisconnectDialogOpen(open);
                if (open) {
                  setRemoveFromVercel(true);
                  setRemoveFromCloudflare(true);
                }
              }}
            >
              <AlertDialogTrigger
                className={buttonVariants({ variant: "destructive" })}
              >
                <Trash2 className="h-4 w-4 mr-1" />
                {t("integrations.neon.disconnectProject")}
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    {t("integrations.neon.disconnectProject")}
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {t("integrations.neon.disconnectConfirmation")}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                {app?.vercelProjectId && (
                  <label className="flex items-start gap-2 rounded-md border border-border p-3 text-sm">
                    <Checkbox
                      checked={removeFromVercel}
                      onCheckedChange={(checked) =>
                        setRemoveFromVercel(checked === true)
                      }
                      disabled={isDisconnecting}
                      className="mt-0.5"
                    />
                    <span className="flex flex-col gap-0.5">
                      <span className="font-medium">
                        {t("integrations.neon.removeVercelEnvVars")}
                      </span>
                      <span className="text-xs text-gray-600 dark:text-gray-400">
                        {t("integrations.neon.removeVercelEnvVarsHelp")}
                      </span>
                    </span>
                  </label>
                )}
                {app?.deploymentProvidersInUse.cloudflare && (
                  <label
                    className="flex items-start gap-2 rounded-md border border-border p-3 text-sm"
                    data-testid="neon-remove-cloudflare-secrets"
                  >
                    <Checkbox
                      checked={removeFromCloudflare}
                      onCheckedChange={(checked) =>
                        setRemoveFromCloudflare(checked === true)
                      }
                      disabled={isDisconnecting}
                      className="mt-0.5"
                    />
                    <span className="flex flex-col gap-0.5">
                      <span className="font-medium">
                        {t("integrations.neon.removeCloudflareEnvVars")}
                      </span>
                      <span className="text-xs text-gray-600 dark:text-gray-400">
                        {t("integrations.neon.removeCloudflareEnvVarsHelp")}
                      </span>
                    </span>
                  </label>
                )}
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={isDisconnecting}>
                    {t("integrations.neon.cancel")}
                  </AlertDialogCancel>
                  <AlertDialogAction
                    onClick={(e) => {
                      e.preventDefault();
                      handleUnsetProject();
                    }}
                    disabled={isDisconnecting}
                    className="bg-destructive text-white hover:bg-destructive/90"
                  >
                    {isDisconnecting && (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    )}
                    {t("integrations.neon.disconnectProject")}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </CardContent>
      </Card>
    );
  }

  // State 2: Connected, no project set — show project selector
  if (isConnected) {
    return (
      <Card className="mt-1">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>{t("integrations.neon.projects")}</CardTitle>
            <div className="flex items-center gap-2">
              <AlertDialog
                open={isDisconnectAccountDialogOpen}
                onOpenChange={(open) => {
                  if (!isDisconnectingAccount)
                    setIsDisconnectAccountDialogOpen(open);
                }}
              >
                <AlertDialogTrigger
                  className={buttonVariants({
                    variant: "outline",
                    size: "sm",
                  })}
                  disabled={isDisconnectingAccount}
                >
                  {isDisconnectingAccount && (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  )}
                  {t("integrations.neon.disconnect")}
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      {t("integrations.neon.disconnectAccountTitle")}
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      {t("integrations.neon.disconnectAccountConfirmation")}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel disabled={isDisconnectingAccount}>
                      {t("integrations.neon.cancel")}
                    </AlertDialogCancel>
                    <AlertDialogAction
                      onClick={(e) => {
                        e.preventDefault();
                        handleDisconnectAccount();
                      }}
                      disabled={isDisconnectingAccount}
                      className="bg-destructive text-white hover:bg-destructive/90"
                    >
                      {isDisconnectingAccount && (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      )}
                      {t("integrations.neon.disconnect")}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
              <Button
                variant="outline"
                size="icon"
                onClick={() => refetchProjects()}
                disabled={isFetchingProjects}
                title={t("integrations.neon.refreshProjects")}
                aria-label={t("integrations.neon.refreshProjects")}
                aria-busy={isFetchingProjects}
              >
                <RefreshCw
                  className={`h-4 w-4 ${isFetchingProjects ? "animate-spin" : ""}`}
                />
              </Button>
            </div>
          </div>
          <CardDescription>
            {t("integrations.neon.selectProjectDescription")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoadingProjects ? (
            <div className="space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : projectsError ? (
            <div className="text-red-500">
              {t("integrations.neon.errorLoadingProjects", {
                message: formatToastError(projectsError),
              })}
              <Button
                variant="outline"
                className="mt-2"
                onClick={() => refetchProjects()}
              >
                {t("integrations.neon.retry")}
              </Button>
            </div>
          ) : showCreateForm ? (
            <div className="space-y-3">
              <Label htmlFor="neon-new-project-name">
                {t("integrations.neon.projectName")}
              </Label>
              <Input
                id="neon-new-project-name"
                value={newProjectName}
                onChange={(e) => {
                  setNewProjectName(e.target.value);
                  if (createProjectError) {
                    setCreateProjectError(null);
                  }
                }}
                placeholder="my-app-db"
                autoFocus
                disabled={isCreating}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreateProject();
                }}
              />
              {createProjectError && (
                <p role="alert" className="text-sm text-red-600">
                  {createProjectError}
                </p>
              )}
              <div className="flex gap-2">
                <Button
                  onClick={handleCreateProject}
                  disabled={isCreating || !newProjectName.trim()}
                  size="sm"
                >
                  {isCreating
                    ? t("integrations.neon.creating")
                    : t("integrations.neon.create")}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowCreateForm(false);
                    setNewProjectName("");
                    setCreateProjectError(null);
                  }}
                  disabled={isCreating}
                  size="sm"
                >
                  {t("integrations.neon.cancel")}
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {projects.length === 0 ? (
                <p className="text-sm text-gray-500">
                  {t("integrations.neon.noProjectsFound")}
                </p>
              ) : (
                <div className="space-y-2">
                  <Label htmlFor="neon-project-select">
                    {t("integrations.neon.project")}
                  </Label>
                  <Select
                    value=""
                    onValueChange={(v) => v && handleProjectSelect(v)}
                    disabled={isConnecting}
                  >
                    <SelectTrigger
                      id="neon-project-select"
                      data-testid="neon-project-select"
                    >
                      {isConnecting ? (
                        <span className="flex items-center gap-2">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          {t("integrations.neon.connecting")}
                        </span>
                      ) : (
                        <SelectValue
                          placeholder={t("integrations.neon.selectAProject")}
                        />
                      )}
                    </SelectTrigger>
                    <SelectContent>
                      {projects.map((project) => (
                        <SelectItem key={project.id} value={project.id}>
                          <div className="flex min-w-0 flex-col">
                            <span className="truncate font-medium">
                              {project.name}
                            </span>
                            <span className="truncate text-xs text-muted-foreground">
                              {formatProjectDetails(project)}
                            </span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <Button
                variant="outline"
                onClick={() => setShowCreateForm(true)}
                className="gap-1"
              >
                <Plus className="h-4 w-4" />
                {t("integrations.neon.createNewProject")}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  // State 3: Not connected — show connect button
  return (
    <Card className="mt-1">
      <CardHeader>
        <CardTitle>{t("integrations.neon.database")}</CardTitle>
        <CardDescription>{t("integrations.neon.freeTier")}</CardDescription>
      </CardHeader>
      <CardContent>
        <NeonSignInButton appId={appId} />
      </CardContent>
    </Card>
  );
}
