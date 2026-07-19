import { useQuery } from "@tanstack/react-query";
import { useAtomValue } from "jotai";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

import { Database, GitBranch } from "lucide-react";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { useLoadApp } from "@/hooks/useLoadApp";
import { ipc } from "@/ipc/types";
import type { GetNeonProjectResponse, NeonBranch } from "@/ipc/types";
import { NeonDisconnectButton } from "@/components/NeonDisconnectButton";
import { queryKeys } from "@/lib/queryKeys";
import { useTranslation } from "react-i18next";
import { formatDate as formatLocaleDate } from "@/i18n/format";

const getBranchTypeColor = (type: NeonBranch["type"]) => {
  switch (type) {
    case "production":
      return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300";
    case "development":
      return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300";
    case "snapshot":
      return "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300";
    case "preview":
      return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300";
    default:
      return "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300";
  }
};

export const NeonConfigure = () => {
  const { t, i18n } = useTranslation("home");
  const selectedAppId = useAtomValue(selectedAppIdAtom);
  const { app } = useLoadApp(selectedAppId);
  const branchTypeLabels: Record<string, string> = {
    production: t("integrations.neon.production"),
    development: t("integrations.neon.development"),
    snapshot: t("integrations.neon.snapshot"),
    preview: t("integrations.neon.preview"),
  };

  // Query to get Neon project information
  const {
    data: neonProject,
    isLoading,
    error,
  } = useQuery<GetNeonProjectResponse, Error>({
    queryKey: queryKeys.neon.project({ appId: selectedAppId }),
    queryFn: async () => {
      if (!selectedAppId) throw new Error("No app selected");
      return await ipc.neon.getProject({ appId: selectedAppId });
    },
    enabled: !!selectedAppId && !!app?.neonProjectId,
    meta: { showErrorToast: true },
  });

  // Don't show component if app doesn't have Neon project
  if (!app?.neonProjectId) {
    return null;
  }

  // Show loading state
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database size={20} />
            {t("integrations.neon.database")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <div className="text-sm text-muted-foreground">
              {t("preview.neonConfigure.loading")}
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Show error state
  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database size={20} />
            {t("integrations.neon.database")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <div className="text-sm text-red-500">
              {t("preview.neonConfigure.errorLoading", {
                error: error.message,
              })}
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!neonProject) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 justify-between">
          <div className="flex items-center gap-2">
            <Database size={20} />
            {t("integrations.neon.database")}
          </div>
          <NeonDisconnectButton />
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Project Information */}
        <div className="space-y-2">
          <div className="text-sm font-medium">
            {t("preview.neonConfigure.projectInformation")}
          </div>
          <div className="bg-muted/50 p-3 rounded-md space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">
                {t("preview.neonConfigure.projectName")}
              </span>
              <span className="font-medium">{neonProject.projectName}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">
                {t("preview.neonConfigure.projectId")}
              </span>
              <span className="font-mono text-xs">{neonProject.projectId}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">
                {t("preview.neonConfigure.organization")}
              </span>
              <span className="font-mono text-xs">{neonProject.orgId}</span>
            </div>
          </div>
        </div>

        {/* Branches */}
        <div className="space-y-2">
          <div className="text-sm font-medium flex items-center gap-2">
            <GitBranch size={16} />
            {t("preview.neonConfigure.branches", {
              count: neonProject.branches.length,
            })}
          </div>
          <div className="space-y-2">
            {neonProject.branches.map((branch) => (
              <div
                key={branch.branchId}
                className="flex items-center justify-between p-3 border rounded-md"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm truncate">
                      {branch.branchName}
                    </span>
                    <Badge
                      variant="secondary"
                      className={getBranchTypeColor(branch.type)}
                    >
                      {branchTypeLabels[branch.type] ?? branch.type}
                    </Badge>
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {t("preview.neonConfigure.branchId", {
                      id: branch.branchId,
                    })}
                  </div>
                  {branch.parentBranchName && (
                    <div className="text-xs text-muted-foreground">
                      {t("preview.neonConfigure.parent", {
                        name: branch.parentBranchName.slice(0, 20),
                      })}
                    </div>
                  )}
                  <div className="text-xs text-muted-foreground">
                    {t("preview.neonConfigure.updated", {
                      date: formatLocaleDate(
                        new Date(branch.lastUpdated),
                        i18n.language,
                      ),
                    })}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
