import { useState } from "react";
import { useAtom } from "jotai";
import { FlaskConical, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { dismissedLegacyTestMigrationAppIdsAtom } from "@/atoms/testRuntimeAtoms";
import {
  useLegacyTests,
  useMigrateLegacyTests,
} from "@/hooks/useLegacyTestMigration";
import { showError, showSuccess } from "@/lib/toast";
import { MigrateTestsDialog } from "./MigrateTestsDialog";

/**
 * Non-blocking offer to move an app's Playwright specs out of the legacy
 * `tests/` directory into `e2e-tests/`. Renders nothing unless specs are still
 * detected in `tests/` and the offer hasn't been dismissed this session. A
 * completed move clears the files from `tests/`, so detection re-runs empty and
 * the banner self-clears.
 */
export function MigrateTestsBanner({ appId }: { appId: number }) {
  const [dismissedIds, setDismissedIds] = useAtom(
    dismissedLegacyTestMigrationAppIdsAtom,
  );
  const dismissed = dismissedIds.has(appId);
  const legacyQuery = useLegacyTests(appId, !dismissed);
  const migrate = useMigrateLegacyTests();
  const [dialogOpen, setDialogOpen] = useState(false);

  const files = legacyQuery.data?.files ?? [];
  if (dismissed || files.length === 0) {
    return null;
  }

  const dismiss = () => {
    setDismissedIds((prev) => {
      const next = new Set(prev);
      next.add(appId);
      return next;
    });
  };

  const handleConfirm = async (selected: string[]) => {
    try {
      const { results } = await migrate.mutateAsync({ appId, files: selected });
      const moved = results.filter((r) => r.ok).length;
      const failed = results.filter((r) => !r.ok);
      if (moved > 0) {
        showSuccess(
          `Moved ${moved} test${moved === 1 ? "" : "s"} to e2e-tests/`,
        );
      }
      if (failed.length > 0) {
        showError(
          `Couldn't move ${failed.length} test${failed.length === 1 ? "" : "s"}: ${failed
            .map((r) => `${r.file} (${r.error})`)
            .join("; ")}`,
        );
      }
      setDialogOpen(false);
    } catch (error) {
      showError(error);
    }
  };

  const count = files.length;

  return (
    <>
      <div
        className="flex min-h-10 items-center gap-3 border-b border-amber-200/80 bg-amber-50/80 px-3 py-2 text-sm text-amber-950 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-100"
        data-testid="migrate-tests-banner"
      >
        <FlaskConical className="size-4 shrink-0 text-amber-700 dark:text-amber-300" />
        <span className="min-w-0 flex-1 truncate">
          {count} Playwright test{count === 1 ? "" : "s"} still live in{" "}
          <code>tests/</code>. Move {count === 1 ? "it" : "them"} to{" "}
          <code>e2e-tests/</code> to keep {count === 1 ? "it" : "them"} in this
          panel.
        </span>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setDialogOpen(true)}
            data-testid="migrate-tests-banner-review"
          >
            Review &amp; move
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="size-7"
            onClick={dismiss}
            aria-label="Dismiss test migration offer"
          >
            <X className="size-3.5" />
          </Button>
        </div>
      </div>
      <MigrateTestsDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        files={files}
        onConfirm={handleConfirm}
        isSubmitting={migrate.isPending}
      />
    </>
  );
}
