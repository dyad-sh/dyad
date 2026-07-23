import { useTranslation } from "react-i18next";
import { useEffect, useRef, useState } from "react";
import { useAtom } from "jotai";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ipc } from "@/ipc/types";
import { showSuccess, showWarning } from "@/lib/toast";
import { CheckCircle2, Info, Loader2, XCircle } from "lucide-react";
import { useDyadGithubRepos } from "@/hooks/useGithubRepos";
import { useLoadApps } from "@/hooks/useLoadApps";
import { useSettings } from "@/hooks/useSettings";
import { UnconnectedGitHubConnector } from "@/components/GitHubConnector";
import {
  importDyadAppStatusesAtom,
  isImportingDyadAppsAtom,
  type ImportStatus,
} from "@/atoms/importDyadAppsAtoms";

export function ImportDyadAppsTab({ isOpen }: { isOpen: boolean }) {
  const { t } = useTranslation(["home", "common"]);
  const { settings, refreshSettings } = useSettings();
  const isAuthenticated = !!settings?.githubAccessToken;
  const { repos, loading, error, refetch, markImported } = useDyadGithubRepos({
    enabled: isOpen && isAuthenticated,
  });
  const { refreshApps } = useLoadApps();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Import progress lives in atoms so it survives the dialog being closed —
  // clones keep running in the background and progress is restored on reopen.
  const [statuses, setStatuses] = useAtom(importDyadAppStatusesAtom);
  const [isImporting, setIsImporting] = useAtom(isImportingDyadAppsAtom);

  // Pre-select every not-yet-imported repo the first time repos load. On
  // later refetches (window focus, the post-import refetch) keep the user's
  // manual selections and only drop repos that have since been imported —
  // otherwise a refetch would silently re-check everything they unchecked.
  const hasPreSelected = useRef(false);
  useEffect(() => {
    if (repos.length === 0) return;
    setSelected((prev) => {
      if (!hasPreSelected.current) {
        hasPreSelected.current = true;
        return new Set(
          repos.filter((repo) => !repo.alreadyImported).map((r) => r.full_name),
        );
      }
      const next = new Set(prev);
      for (const repo of repos) {
        if (repo.alreadyImported) {
          next.delete(repo.full_name);
        }
      }
      return next;
    });
  }, [repos]);

  const importableRepos = repos.filter((repo) => !repo.alreadyImported);
  const selectedCount = importableRepos.filter((repo) =>
    selected.has(repo.full_name),
  ).length;
  const allSelected =
    importableRepos.length > 0 && selectedCount === importableRepos.length;

  const toggleRepo = (fullName: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(fullName);
      } else {
        next.delete(fullName);
      }
      return next;
    });
  };

  const toggleAll = (checked: boolean) => {
    setSelected(
      checked ? new Set(importableRepos.map((r) => r.full_name)) : new Set(),
    );
  };

  const setStatus = (fullName: string, status: ImportStatus) => {
    setStatuses((prev) => ({ ...prev, [fullName]: status }));
  };

  const handleImportSelected = async () => {
    // Clear any stale progress from a previous run before starting fresh.
    setStatuses({});
    setIsImporting(true);
    let imported = 0;
    let failed = 0;
    // Component-tagger upgrade can fail even when the clone itself succeeds; the
    // single-repo path surfaces this, so bulk import must too rather than
    // silently reporting a clean success.
    let autoUpgradeWarnings = 0;
    const importedFullNames: string[] = [];
    try {
      for (const repo of importableRepos) {
        if (!selected.has(repo.full_name)) continue;
        setStatus(repo.full_name, { state: "importing" });
        try {
          const result = await ipc.github.cloneRepoFromUrl({
            url: `https://github.com/${repo.full_name}.git`,
            appName: repo.name,
            optimizeForDyad: true,
            dedupeName: true,
          });
          if ("error" in result) {
            failed++;
            setStatus(repo.full_name, {
              state: "error",
              message: result.error,
            });
          } else {
            imported++;
            importedFullNames.push(repo.full_name);
            if (result.autoUpgradeWarning) {
              autoUpgradeWarnings++;
            }
            setStatus(repo.full_name, { state: "done" });
          }
        } catch (error: unknown) {
          failed++;
          setStatus(repo.full_name, {
            state: "error",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
      try {
        await refreshApps();
      } catch (e) {
        console.error("Failed to refresh apps", e);
      }
      if (failed > 0) {
        showWarning(
          t("home:bulkImportCompleteWithErrors", { imported, failed }),
        );
      } else if (imported > 0) {
        showSuccess(t("home:bulkImportComplete", { count: imported }));
      }
      if (autoUpgradeWarnings > 0) {
        showWarning(
          t("home:bulkImportAutoUpgradeWarning", {
            count: autoUpgradeWarnings,
          }),
        );
      }
    } finally {
      setIsImporting(false);
      // Flag the just-imported repos as imported in the cache directly instead
      // of a refetch: a refetch re-runs the expensive discovery scan and would
      // briefly re-offer these repos, allowing a duplicate clone on a second
      // click before the fresh list lands.
      markImported(importedFullNames);
    }
  };

  if (!isAuthenticated) {
    return (
      <UnconnectedGitHubConnector
        appId={null}
        folderName=""
        settings={settings}
        refreshSettings={refreshSettings}
        handleRepoSetupComplete={() => undefined}
        expanded={false}
      />
    );
  }

  return (
    <>
      <p className="text-xs sm:text-sm text-muted-foreground">
        {t("home:dyadAppsDescription")}
      </p>

      {loading && (
        <div className="flex justify-center py-8">
          <Loader2 className="animate-spin h-6 w-6" />
        </div>
      )}

      {!loading && error && (
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <p className="text-xs sm:text-sm text-red-500">
            {t("home:dyadReposLoadError")}
          </p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            {t("home:retry")}
          </Button>
        </div>
      )}

      {!loading && !error && repos.length === 0 && (
        <p className="text-xs sm:text-sm text-muted-foreground text-center py-4">
          {t("home:noDyadReposFound")}
        </p>
      )}

      {isImporting && (
        <div className="flex items-center gap-2 rounded-md bg-muted px-3 py-2 text-xs sm:text-sm text-muted-foreground">
          <Info className="h-4 w-4 flex-shrink-0" />
          <span>{t("home:bulkImportBackgroundHint")}</span>
        </div>
      )}

      {repos.length > 0 && (
        <>
          <div className="flex items-center space-x-2">
            <Checkbox
              id="select-all-dyad-repos"
              checked={allSelected}
              onCheckedChange={(checked) => toggleAll(checked === true)}
              disabled={isImporting || importableRepos.length === 0}
            />
            <Label
              htmlFor="select-all-dyad-repos"
              className="text-xs sm:text-sm cursor-pointer"
            >
              {t("home:selectAll")}
            </Label>
          </div>

          <div className="flex flex-col space-y-2 max-h-64 overflow-y-auto overflow-x-hidden">
            {repos.map((repo) => {
              const status = statuses[repo.full_name];
              return (
                <div
                  key={repo.full_name}
                  data-testid={`dyad-repo-row-${repo.full_name.replace(/[^a-zA-Z0-9_-]/g, "-")}`}
                  className="flex items-center justify-between p-3 border rounded-lg hover:bg-accent/50 transition-colors min-w-0"
                >
                  <div className="flex items-center min-w-0 flex-1 overflow-hidden mr-2 gap-3">
                    <Checkbox
                      aria-label={repo.full_name}
                      checked={selected.has(repo.full_name)}
                      onCheckedChange={(checked) =>
                        toggleRepo(repo.full_name, checked === true)
                      }
                      disabled={isImporting || repo.alreadyImported}
                    />
                    <div className="min-w-0 flex-1 overflow-hidden">
                      <p className="font-semibold truncate text-sm">
                        {repo.name}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {repo.full_name}
                      </p>
                      {status?.state === "error" && (
                        <p className="text-xs text-red-500 break-words">
                          {status.message}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex-shrink-0">
                    {repo.alreadyImported ? (
                      <span className="text-xs text-muted-foreground">
                        {t("home:alreadyImported")}
                      </span>
                    ) : status?.state === "importing" ? (
                      <Loader2 className="animate-spin h-4 w-4 text-muted-foreground" />
                    ) : status?.state === "done" ? (
                      <CheckCircle2 className="h-4 w-4 text-green-500" />
                    ) : status?.state === "error" ? (
                      <XCircle className="h-4 w-4 text-red-500" />
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>

          <Button
            onClick={handleImportSelected}
            disabled={isImporting || selectedCount === 0}
            className="w-full"
          >
            {isImporting ? (
              <>
                <Loader2 className="animate-spin mr-2 h-4 w-4" />
                {t("common:importing")}
              </>
            ) : (
              t("home:importSelected", { count: selectedCount })
            )}
          </Button>
        </>
      )}
    </>
  );
}
