import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ipc } from "@/ipc/types";
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
import { Skeleton } from "@/components/ui/skeleton";
import { useLoadApp } from "@/hooks/useLoadApp";
import { useDeepLink } from "@/contexts/DeepLinkContext";
import { Switch } from "@/components/ui/switch";
import { ExternalLink, Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useTheme } from "@/contexts/ThemeContext";
import { useNeon } from "@/hooks/useNeon";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import { NEXTJS_CONFIG_FILES } from "@/lib/framework_constants";
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

function isNextJsProject(files: string[] | undefined): boolean {
  if (!files) return false;
  return files.some((file) => NEXTJS_CONFIG_FILES.includes(file));
}

export function NeonConnector({ appId }: { appId: number }) {
  const { t } = useTranslation("home");
  const { settings, refreshSettings } = useSettings();
  const { app, loading: isLoadingApp, refreshApp } = useLoadApp(appId);
  const { lastDeepLink, clearLastDeepLink } = useDeepLink();
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
  const [isOpeningOauth, setIsOpeningOauth] = useState(false);

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

  useEffect(() => {
    const handleDeepLink = async () => {
      if (lastDeepLink?.type === "neon-oauth-return") {
        setIsOpeningOauth(false);
        await refreshSettings();
        await refetchProjects();
        await refreshApp();
        toast.success(t("integrations.neon.connectedSuccess"));
        clearLastDeepLink();
      }
    };
    handleDeepLink();
  }, [lastDeepLink?.timestamp]);

  const handleConnect = async () => {
    try {
      setIsOpeningOauth(true);
      if (settings?.isTestMode) {
        await ipc.neon.fakeConnect();
      } else {
        await ipc.system.openExternalUrl(
          "https://oauth.dyad.sh/api/integrations/neon/login",
        );
      }
      // Reset after 60s if the OAuth return never arrives
      setTimeout(() => setIsOpeningOauth(false), 60_000);
    } catch (error) {
      setIsOpeningOauth(false);
      toast.error(String(error));
    }
  };

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
          error: String(error),
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
      const errorMessage =
        error instanceof Error ? error.message : String(error);
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
    try {
      await ipc.neon.unsetAppProject({ appId });
      toast.success(t("integrations.neon.disconnectProject"));
      await refreshApp();
      queryClient.invalidateQueries({ queryKey: queryKeys.apps.all });
      queryClient.invalidateQueries({
        queryKey: queryKeys.appEnvVars.byApp({ appId }),
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.neon.all });
    } catch (error) {
      console.error("Failed to disconnect project:", error);
      toast.error(t("integrations.neon.failedDisconnectProject"));
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
          branchId: app?.neonActiveBranchId ?? null,
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
          error: String(error),
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
          error: String(error),
        }),
      );
    } finally {
      setIsSwitchingBranch(false);
    }
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

  // Neon is only available for Next.js projects
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
  if (!isNextJsProject(app?.files)) {
    return (
      <Card className="mt-1">
        <CardHeader>
          <CardTitle>{t("integrations.neon.database")}</CardTitle>
          <CardDescription>{t("integrations.neon.nextjsOnly")}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  // State 1: Connected and has project set
  if (isConnected && app?.neonProjectId) {
    return (
      <Card className="mt-1">
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            {t("integrations.neon.project")}
            <Button
              variant="outline"
              aria-label={t("integrations.neon.openInConsole")}
              title={t("integrations.neon.openInConsole")}
              onClick={() => {
                ipc.system.openExternalUrl(
                  `https://console.neon.tech/app/projects/${app.neonProjectId}`,
                );
              }}
              className="ml-2 px-2 py-1 inline-flex items-center gap-2"
            >
              <NeonSvg isDarkMode={isDarkMode} aria-hidden="true" />
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
            </Button>
          </CardTitle>
          <CardDescription className="flex flex-col gap-1.5 text-sm">
            {t("integrations.neon.connectedToProject")}
            <Badge
              variant="secondary"
              className="ml-2 max-w-full truncate text-base font-bold px-3 py-1"
              title={projectInfo?.projectName ?? app.neonProjectId}
            >
              {projectInfo?.projectName ?? app.neonProjectId}
            </Badge>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="neon-branch-select">
                {t("integrations.neon.activeBranch")}
              </Label>
              {branchesError ? (
                <p className="text-sm text-red-500">
                  {t("integrations.neon.errorLoadingBranches", {
                    message:
                      branchesError instanceof Error
                        ? branchesError.message
                        : typeof branchesError === "string"
                          ? branchesError
                          : JSON.stringify(branchesError),
                  })}
                </p>
              ) : isLoadingBranches ? (
                <Skeleton className="h-10 w-full" />
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
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {branches.map((branch) => (
                      <SelectItem key={branch.branchId} value={branch.branchId}>
                        <span className="flex items-center gap-2">
                          {branch.branchName}
                          <Badge
                            variant={getBranchBadgeVariant(branch.type)}
                            className="text-xs"
                          >
                            {t(`integrations.neon.${branch.type}`, {
                              defaultValue: branch.type,
                            })}
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
              </div>
            )}

            <AlertDialog>
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
                <AlertDialogFooter>
                  <AlertDialogCancel>
                    {t("integrations.neon.cancel")}
                  </AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleUnsetProject}
                    className="bg-destructive text-white hover:bg-destructive/90"
                  >
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
          <CardTitle className="flex items-center justify-between">
            {t("integrations.neon.projects")}
            <div className="flex items-center gap-2">
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
          </CardTitle>
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
                message:
                  projectsError instanceof Error
                    ? projectsError.message
                    : typeof projectsError === "string"
                      ? projectsError
                      : JSON.stringify(projectsError),
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
              <Label>{t("integrations.neon.projectName")}</Label>
              <Input
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
                      <SelectValue
                        placeholder={t("integrations.neon.selectAProject")}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {projects.map((project) => (
                        <SelectItem key={project.id} value={project.id}>
                          {project.name}
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
        <Button
          variant="outline"
          onClick={handleConnect}
          disabled={isOpeningOauth}
          className="w-auto h-10 flex items-center justify-center px-4 py-2 border-2 transition-colors font-medium text-sm dark:bg-gray-900 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800"
          data-testid="connect-neon-button"
        >
          {isOpeningOauth ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              <span>{t("integrations.neon.completingSignIn")}</span>
            </>
          ) : (
            <>
              <span className="mr-2">{t("integrations.neon.connectTo")}</span>
              <NeonSvg isDarkMode={isDarkMode} />
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}

function NeonSvg({
  isDarkMode,
  className,
}: {
  isDarkMode?: boolean;
  className?: string;
}) {
  const textColor = isDarkMode ? "#fff" : "#000";

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="68"
      height="18"
      fill="none"
      viewBox="0 0 102 28"
      className={className}
    >
      <path
        fill="#12FFF7"
        fillRule="evenodd"
        d="M0 4.828C0 2.16 2.172 0 4.851 0h18.436c2.679 0 4.85 2.161 4.85 4.828V20.43c0 2.758-3.507 3.955-5.208 1.778l-5.318-6.809v8.256c0 2.4-1.955 4.345-4.367 4.345H4.851C2.172 28 0 25.839 0 23.172zm4.851-.966a.97.97 0 0 0-.97.966v18.344c0 .534.435.966.97.966h8.539c.268 0 .34-.216.34-.483v-11.07c0-2.76 3.507-3.956 5.208-1.779l5.319 6.809V4.828c0-.534.05-.966-.485-.966z"
        clipRule="evenodd"
      />
      <path
        fill="url(#a)"
        fillRule="evenodd"
        d="M0 4.828C0 2.16 2.172 0 4.851 0h18.436c2.679 0 4.85 2.161 4.85 4.828V20.43c0 2.758-3.507 3.955-5.208 1.778l-5.318-6.809v8.256c0 2.4-1.955 4.345-4.367 4.345H4.851C2.172 28 0 25.839 0 23.172zm4.851-.966a.97.97 0 0 0-.97.966v18.344c0 .534.435.966.97.966h8.539c.268 0 .34-.216.34-.483v-11.07c0-2.76 3.507-3.956 5.208-1.779l5.319 6.809V4.828c0-.534.05-.966-.485-.966z"
        clipRule="evenodd"
      />
      <path
        fill="url(#b)"
        fillRule="evenodd"
        d="M0 4.828C0 2.16 2.172 0 4.851 0h18.436c2.679 0 4.85 2.161 4.85 4.828V20.43c0 2.758-3.507 3.955-5.208 1.778l-5.318-6.809v8.256c0 2.4-1.955 4.345-4.367 4.345H4.851C2.172 28 0 25.839 0 23.172zm4.851-.966a.97.97 0 0 0-.97.966v18.344c0 .534.435.966.97.966h8.539c.268 0 .34-.216.34-.483v-11.07c0-2.76 3.507-3.956 5.208-1.779l5.319 6.809V4.828c0-.534.05-.966-.485-.966z"
        clipRule="evenodd"
      />
      <path
        fill="#B9FFB3"
        d="M23.287 0c2.679 0 4.85 2.161 4.85 4.828V20.43c0 2.758-3.507 3.955-5.208 1.778l-5.319-6.809v8.256c0 2.4-1.954 4.345-4.366 4.345a.484.484 0 0 0 .485-.483V12.584c0-2.758 3.508-3.955 5.21-1.777l5.318 6.808V.965a.97.97 0 0 0-.97-.965"
      />
      <path
        fill={textColor}
        d="M48.112 7.432v8.032l-7.355-8.032H36.93v13.136h3.49v-8.632l8.01 8.632h3.173V7.432zM58.075 17.64v-2.326h7.815v-2.797h-7.815V10.36h9.48V7.432H54.514v13.136H67.75v-2.927zM77.028 21c4.909 0 8.098-2.552 8.098-7s-3.19-7-8.098-7c-4.91 0-8.081 2.552-8.081 7s3.172 7 8.08 7m0-3.115c-2.73 0-4.413-1.408-4.413-3.885s1.701-3.885 4.413-3.885c2.729 0 4.412 1.408 4.412 3.885s-1.683 3.885-4.412 3.885M98.508 7.432v8.032l-7.355-8.032h-3.828v13.136h3.491v-8.632l8.01 8.632H102V7.432z"
      />
      <defs>
        <linearGradient
          id="a"
          x1="28.138"
          x2="3.533"
          y1="28"
          y2="-.12"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#B9FFB3" />
          <stop offset="1" stopColor="#B9FFB3" stopOpacity="0" />
        </linearGradient>
        <linearGradient
          id="b"
          x1="28.138"
          x2="11.447"
          y1="28"
          y2="21.476"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#1A1A1A" stopOpacity=".9" />
          <stop offset="1" stopColor="#1A1A1A" stopOpacity="0" />
        </linearGradient>
      </defs>
    </svg>
  );
}
