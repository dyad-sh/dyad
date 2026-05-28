import { Database, Globe, Shield } from "lucide-react";

interface VercelSyncSummaryCardProps {
  branchType: "production" | "development";
  vercelProjectName?: string;
  /**
   * When `true`, render copy that fits the post-deploy "Sync to Vercel"
   * button (the project already exists and the trusted domain is known).
   * When `false`, render copy for the first-deploy flow inside the
   * "Create Vercel Project" form (project + domain don't exist yet).
   */
  isResync?: boolean;
  trustedDomain?: string | null;
}

const ENV_VARS = [
  {
    key: "DATABASE_URL",
    description: "Neon connection string for the selected branch.",
  },
  {
    key: "NEON_AUTH_BASE_URL",
    description: "Base URL for Neon Auth on the selected branch.",
  },
  {
    key: "NEON_AUTH_COOKIE_SECRET",
    description: "Per-branch cookie secret used by Neon Auth.",
  },
] as const;

export function VercelSyncSummaryCard({
  branchType,
  vercelProjectName,
  isResync = false,
  trustedDomain,
}: VercelSyncSummaryCardProps) {
  const branchLabel =
    branchType === "production" ? "Production" : "Development";

  return (
    <div
      data-testid="vercel-sync-summary-card"
      className="rounded-md border border-blue-200 bg-blue-50 p-4 text-sm dark:border-blue-800 dark:bg-blue-900/20"
    >
      <div className="flex items-center gap-2 mb-3">
        <Shield className="h-4 w-4 text-blue-700 dark:text-blue-300" />
        <span className="font-medium text-blue-900 dark:text-blue-100">
          {isResync
            ? "Review what will be synced"
            : "Before we deploy: review what will be configured"}
        </span>
      </div>

      <div className="space-y-3">
        <div>
          <div className="flex items-center gap-2 text-blue-900 dark:text-blue-100">
            <Database className="h-3.5 w-3.5" />
            <span className="font-medium">
              Environment variables (Vercel · production + preview +
              development)
            </span>
          </div>
          <ul className="mt-1 ml-5 list-disc text-xs text-blue-800 dark:text-blue-200">
            {ENV_VARS.map((env) => (
              <li key={env.key}>
                <code className="font-mono">{env.key}</code> — {env.description}
              </li>
            ))}
          </ul>
          <p className="ml-5 mt-1 text-xs text-blue-700 dark:text-blue-300">
            Sourced from your {branchLabel} Neon branch.
          </p>
        </div>

        <div>
          <div className="flex items-center gap-2 text-blue-900 dark:text-blue-100">
            <Globe className="h-3.5 w-3.5" />
            <span className="font-medium">Neon Auth trusted domain</span>
          </div>
          <p className="ml-5 mt-1 text-xs text-blue-800 dark:text-blue-200">
            {isResync && trustedDomain ? (
              <>
                <code className="font-mono">{trustedDomain}</code> will be added
                to the redirect allowlist on your {branchLabel} branch.
              </>
            ) : isResync ? (
              <>
                The deployment domain will be added to the redirect allowlist on
                your {branchLabel} branch. (No deployment URL yet — we'll
                resolve it now.)
              </>
            ) : (
              <>
                Once the first deployment finishes, the resolved{" "}
                <code className="font-mono">
                  {vercelProjectName
                    ? `${vercelProjectName}.vercel.app`
                    : "<project>.vercel.app"}
                </code>{" "}
                domain will be added to the redirect allowlist on your{" "}
                {branchLabel} branch so OAuth redirects don't get rejected.
              </>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
