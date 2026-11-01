import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAtomValue, useSetAtom } from "jotai";
import { Database, Loader2, X } from "lucide-react";
import { useState } from "react";

import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { dismissedNeonMigrationBannerAppIdsAtom } from "@/atoms/previewAtoms";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useLoadApp } from "@/hooks/useLoadApp";
import { useRunApp } from "@/hooks/useRunApp";
import { ipc, type NeonDevelopmentBranchStatus } from "@/ipc/types";
import { getErrorMessage } from "@/lib/errors";
import { queryKeys } from "@/lib/queryKeys";
import { showWarning, toast } from "@/lib/toast";

type MigrationState =
  | { kind: "idle" }
  | { kind: "migrating" }
  | { kind: "migrated" }
  | { kind: "error"; message: string };

function formatNames(names: string[]): string {
  return names.length <= 1
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/**
 * Offers moving an app's Neon development branch off the old child-branch
 * layout, which leaves a backup branch behind on every database undo (see
 * src/ipc/utils/neon_dev_branch.ts).
 */
export function NeonMigrationBanner() {
  const appId = useAtomValue(selectedAppIdAtom);
  const { app } = useLoadApp(appId);
  const dismissed = useAtomValue(dismissedNeonMigrationBannerAppIdsAtom);
  const { data: status } = useQuery({
    queryKey: queryKeys.neon.developmentBranchStatus({ appId }),
    queryFn: () => ipc.neon.getDevelopmentBranchStatus({ appId: appId! }),
    enabled:
      appId !== null && !!app?.neonProjectId && !!app.neonDevelopmentBranchId,
    // A failed check (offline, expired token) just leaves the banner hidden.
    retry: false,
    // Each check lists the project's branches over the Neon API. Changes to
    // the app, its deploy database, and undos invalidate it instead.
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });

  if (appId === null || !status?.needsMigration || dismissed.has(appId)) {
    return null;
  }
  return (
    <NeonMigrationBannerContent key={appId} appId={appId} status={status} />
  );
}

function NeonMigrationBannerContent({
  appId,
  status,
}: {
  appId: number;
  status: NeonDevelopmentBranchStatus;
}) {
  const setDismissed = useSetAtom(dismissedNeonMigrationBannerAppIdsAtom);
  const { loading: appRunLoading, restartApp, stopApp } = useRunApp();
  const queryClient = useQueryClient();
  const [state, setState] = useState<MigrationState>({ kind: "idle" });
  const [confirming, setConfirming] = useState(false);

  const handleMigrate = async () => {
    setConfirming(false);
    setState({ kind: "migrating" });
    let migrated = false;
    try {
      // Nothing may write to the database while it is copied. Other apps on
      // the same branch are moved too; they start again when next opened.
      for (const id of [appId, ...status.otherApps.map((a) => a.id)]) {
        await stopApp(id);
      }
      const { warning, backupPath } = await ipc.neon.migrateDevelopmentBranch({
        appId,
      });
      migrated = true;
      if (backupPath) {
        toast.success("Migrated your development database.", {
          description: "A copy of the old data was saved on this computer.",
          duration: 15_000,
          action: {
            label: "Show backup",
            onClick: () => void ipc.system.showItemInFolder(backupPath),
          },
        });
      }
      if (warning) showWarning(warning);
      setState({ kind: "migrated" });
    } catch (error) {
      setState({ kind: "error", message: getErrorMessage(error) });
    }
    try {
      await restartApp({ appId });
    } catch (error) {
      // Keep a migration error if there was one; it matters more.
      if (migrated) {
        setState({
          kind: "error",
          message: `Migrated the development database, but could not restart the app: ${getErrorMessage(error)}`,
        });
      }
    }
    if (migrated) {
      await queryClient.invalidateQueries({ queryKey: queryKeys.neon.all });
    }
  };

  const backups =
    status.leakedBackups === 1
      ? "1 old backup"
      : `${status.leakedBackups} old backups`;
  const deploying = status.appsDeployingWithDevelopment;
  const deployer =
    deploying.length === 1 && deploying[0].id === appId
      ? "Your app deploys"
      : `${formatNames(deploying.map((a) => a.name))} ${deploying.length === 1 ? "deploys" : "deploy"}`;
  const otherApps = status.otherApps.map((a) => a.name);
  const message =
    deploying.length > 0
      ? `${deployer} with your development database. We recommend deploying with production.`
      : state.kind === "migrated"
        ? "Development database migrated. Restarting preview..."
        : state.kind === "error"
          ? state.message
          : // The details and side effects are in the confirmation dialog.
            "Your Neon database is using a legacy setup that leaves backup branches " +
            "behind. Migrate to clean them up." +
            (otherApps.length > 0
              ? ` Also used by ${formatNames(otherApps)}.`
              : "");
  const isMigrating = state.kind === "migrating";

  return (
    <div
      className="flex min-h-10 items-center gap-3 border-b border-amber-200/80 bg-amber-50/80 px-3 py-2 text-sm text-amber-950 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-100"
      data-testid="neon-migration-banner"
    >
      <Database className="size-4 shrink-0 text-amber-700 dark:text-amber-300" />
      {/* Wraps rather than truncating: errors such as the branch-limit
          upgrade steps must be readable in full. */}
      <span
        className="min-w-0 flex-1 text-left"
        data-testid="neon-migration-banner-message"
      >
        {message}
      </span>
      <div className="flex shrink-0 items-center gap-1.5">
        {/* Migrating deletes the branch the live app talks to. */}
        {deploying.length === 0 && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setConfirming(true)}
            disabled={isMigrating || state.kind === "migrated" || appRunLoading}
            data-testid="neon-migration-banner-migrate"
          >
            {isMigrating ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Database className="size-3.5" />
            )}
            {isMigrating ? "Migrating" : "Migrate"}
          </Button>
        )}
        <Button
          size="icon"
          variant="ghost"
          className="size-7"
          onClick={() => setDismissed((ids) => new Set(ids).add(appId))}
          disabled={isMigrating}
          aria-label="Dismiss Neon migration banner"
        >
          <X className="size-3.5" />
        </Button>
      </div>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent data-testid="neon-migration-confirm-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>
              Migrate your development database?
            </AlertDialogTitle>
            <AlertDialogDescription
              render={<div />}
              className="space-y-2 text-left"
            >
              <p>
                Your database uses a legacy setup that leaves a backup branch
                behind on every database undo, which eventually uses up your
                Neon branch limit.
              </p>
              <p>
                Dyad copies your development database to a new Neon branch, then
                deletes the old branch
                {status.leakedBackups > 0 ? ` and its ${backups}` : ""}.
                {otherApps.length > 0
                  ? ` ${formatNames(otherApps)} ${otherApps.length === 1 ? "uses" : "use"} the same database and ${otherApps.length === 1 ? "moves" : "move"} too.`
                  : ""}
              </p>
              <ul className="list-disc space-y-1 pl-5">
                <li>Earlier versions can no longer restore the database.</li>
                <li>Your app's users may need to sign in again.</li>
                <li>The app stops while the data is copied.</li>
              </ul>
              <p className="font-medium">
                Neon can't recover deleted branches, so Dyad first saves a copy
                of your development data on this computer. It includes your
                app's user accounts, so keep it private.
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleMigrate}
              data-testid="neon-migration-confirm"
            >
              Migrate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
