import { Globe } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ipc } from "@/ipc/types";

/** What a pill says about a deployment at a glance. */
export type DeploymentTone = "success" | "pending" | "failure" | "neutral";

export interface RecentDeploymentRow {
  key: string;
  label: string;
  tone: DeploymentTone;
  createdAt: Date | null;
  /** Where this deployment is served, when it still is. */
  url: string | null;
  /** A short extra beside the date, such as a commit hash. */
  detail?: string | null;
}

const TONE_CLASS: Record<DeploymentTone, string> = {
  success:
    "bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-300",
  pending:
    "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-300",
  failure: "bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-300",
  neutral: "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300",
};

/**
 * The last few deployments of an app on one provider, as the Vercel card has
 * always listed them: a status pill, when it happened, and a link to it.
 *
 * Each provider reduces its own deployments to rows, so the list looks the
 * same whichever it came from, and which deployments make the list is the
 * caller's to decide.
 */
export function RecentDeploymentsList({
  rows,
  className,
  testId,
}: {
  rows: RecentDeploymentRow[];
  className?: string;
  testId?: string;
}) {
  const { t } = useTranslation("home");
  if (rows.length === 0) return null;
  return (
    <div className={className} data-testid={testId}>
      <h4 className="font-medium mb-2">
        {t("integrations.vercel.recentDeployments")}
      </h4>
      <div className="space-y-2">
        {rows.map((row) => (
          <DeploymentRow key={row.key} row={row} />
        ))}
      </div>
    </div>
  );
}

function DeploymentRow({ row }: { row: RecentDeploymentRow }) {
  const { url } = row;
  return (
    <div
      className="bg-gray-50 dark:bg-gray-800 rounded-md p-3"
      data-testid="recent-deployment"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${TONE_CLASS[row.tone]}`}
          >
            {row.label}
          </span>
          {row.createdAt && (
            <span className="text-sm text-gray-600 dark:text-gray-300">
              {row.createdAt.toLocaleString()}
            </span>
          )}
          {row.detail && (
            <span className="text-xs text-gray-500 dark:text-gray-400 font-mono">
              {row.detail}
            </span>
          )}
        </div>
        {url && (
          <a
            href={url}
            onClick={(e) => {
              e.preventDefault();
              ipc.system.openExternalUrl(url);
            }}
            className="cursor-pointer text-blue-600 hover:underline dark:text-blue-400 text-sm"
            target="_blank"
            rel="noopener noreferrer"
          >
            <Globe className="h-4 w-4 inline mr-1" />
            View
          </a>
        )}
      </div>
    </div>
  );
}
