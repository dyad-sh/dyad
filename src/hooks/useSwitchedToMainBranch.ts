import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useStore } from "jotai";
import type { App, EditAppFileReturnType } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";
import { showInfo } from "@/lib/toast";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { useVersionPreviewManager } from "@/hooks/useVersionPreview";
import { useRunApp } from "./useRunApp";
import { useSettings } from "./useSettings";

/**
 * Reacts to an `editAppFile` result that re-attached the app to a branch.
 *
 * When a file is edited while a historical version is checked out (detached
 * HEAD), the backend switches back to a branch so the edit becomes a new
 * version on top of it. That switch also changes branch/version state and, for
 * Neon apps, the database branch — so the renderer must refresh the affected
 * queries and restart the app (mirroring the version-preview return path). This
 * keeps that handling in one place for every file-save call site.
 */
export function useSwitchedToMainBranch() {
  const queryClient = useQueryClient();
  const store = useStore();
  const previewManager = useVersionPreviewManager();
  const { restartApp } = useRunApp();
  const { settings } = useSettings();
  const { t } = useTranslation("home");

  return useCallback(
    async (
      appId: number,
      result: EditAppFileReturnType | undefined,
      options: { restartApp?: boolean } = {},
    ) => {
      if (!result?.switchedToMainBranch) {
        return;
      }
      // The backend re-attached HEAD to the writable branch, so the version
      // preview session's belief that a historical version is still checked out
      // is now stale. Send CLOSE to that app's preview machine to reconcile it:
      // it returns to the origin branch (an idempotent checkout, since HEAD is
      // already there) and leaves version-diff mode. The machine is per-app, so
      // this is correctly scoped even if the user has since switched apps.
      previewManager.send(appId, { type: "CLOSE" });
      // Prefix invalidation: `branches.current` is `["currentBranch", appId]`,
      // which also covers `branches.tip` (`[..., "tip", branch]`), so the
      // writable-branch tip cached by `useWritableVersionTip` is refreshed here
      // too — the re-attach moved the tip by staging a new version on the branch.
      await queryClient.invalidateQueries({
        queryKey: queryKeys.branches.current({ appId }),
      });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.versions.list({ appId }),
      });
      showInfo(t("preview.switchedToMainOnEdit"));
      // The switch changed the database branch and the checked-out code, so the
      // running app needs to restart to pick them up (same as a checkout).
      const cachedApp = queryClient.getQueryData<App | null>(
        queryKeys.apps.detail({ appId }),
      );
      // Gate the restart on this app still being selected: restartApp() targets
      // the currently-selected app (not `appId`), so if the user navigated to a
      // different app while the save was in flight, restarting here would restart
      // the wrong app.
      if (
        store.get(selectedAppIdAtom) === appId &&
        (settings?.runtimeMode2 === "cloud" ||
          options.restartApp ||
          !!cachedApp?.neonProjectId)
      ) {
        await restartApp();
      }
    },
    [queryClient, store, previewManager, restartApp, settings?.runtimeMode2, t],
  );
}
