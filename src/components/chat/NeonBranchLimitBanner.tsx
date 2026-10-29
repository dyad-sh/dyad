import { Database, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  useTestRunQueue,
  useDismissNeonBranchLimit,
} from "@/hooks/useTestRunQueue";
import { useLoadApp } from "@/hooks/useLoadApp";
import { ipc } from "@/ipc/types";
import { Button } from "@/components/ui/button";

export function NeonBranchLimitBanner({ appId }: { appId: number | null }) {
  const { t } = useTranslation("chat");
  const { data } = useTestRunQueue(appId);
  const { app } = useLoadApp(appId);
  const dismiss = useDismissNeonBranchLimit();
  const notice = data?.neonBranchLimit;
  if (appId === null || !notice || app?.neonProjectId !== notice.projectId)
    return null;

  return (
    <div
      className="px-3 pt-1 pb-2 shrink-0"
      data-testid="neon-branch-limit-banner"
    >
      <div
        role="status"
        className="mx-auto flex max-w-3xl flex-wrap items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-50 px-3 py-3 text-amber-900 dark:border-amber-300/20 dark:bg-amber-900/40 dark:text-amber-100"
      >
        <Database aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        <div className="min-w-0 flex-1 basis-48 text-sm leading-snug">
          <p className="font-medium">{t("neonBranchLimit.title")}</p>
          <p className="mt-1">
            {t(
              notice.status === "waiting"
                ? "neonBranchLimit.waiting"
                : "neonBranchLimit.blocked",
            )}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            void ipc.system.openExternalUrl("https://console.neon.tech")
          }
        >
          {t("neonBranchLimit.manage")}
        </Button>
        {notice.status === "blocked" && (
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label={t("neonBranchLimit.dismiss")}
            disabled={dismiss.isPending}
            onClick={() => dismiss.mutate({ appId, runId: notice.runId })}
          >
            <X className="size-4" aria-hidden="true" />
          </Button>
        )}
      </div>
    </div>
  );
}
