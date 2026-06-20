import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronDown, Copy, Eye, EyeOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ipc } from "@/ipc/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { queryKeys } from "@/lib/queryKeys";
import { getErrorMessage } from "@/lib/errors";

interface DatabaseEnvVarsProps {
  appId: number;
  branchType: "production" | "development";
}

interface EnvVarRow {
  key: string;
  value: string;
  // Contains credentials/secrets — masked behind a show/hide toggle.
  secret: boolean;
}

export const DatabaseEnvVars = ({
  appId,
  branchType,
}: DatabaseEnvVarsProps) => {
  const { t } = useTranslation("home");
  const [expanded, setExpanded] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [revealedKeys, setRevealedKeys] = useState<Set<string>>(new Set());

  // Lazy fetch: only resolve (and provision) env vars once the user expands.
  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.neon.branchEnvVars({ appId, branchType }),
    queryFn: () => ipc.neon.getBranchEnvVars({ appId, branchType }),
    enabled: expanded,
    staleTime: 5 * 60 * 1000,
  });

  const rows: EnvVarRow[] = data
    ? [
        { key: "DATABASE_URL", value: data.databaseUrl, secret: true },
        ...(data.neonAuthBaseUrl
          ? [
              {
                key: "NEON_AUTH_BASE_URL",
                value: data.neonAuthBaseUrl,
                secret: false,
              },
            ]
          : []),
        ...(data.neonAuthCookieSecret
          ? [
              {
                key: "NEON_AUTH_COOKIE_SECRET",
                value: data.neonAuthCookieSecret,
                secret: true,
              },
            ]
          : []),
      ]
    : [];

  const toggleExpanded = () => {
    if (expanded) {
      // Collapsing: re-mask any revealed secrets so they aren't visible the
      // next time the panel is expanded.
      setRevealedKeys(new Set());
    }
    setExpanded((v) => !v);
  };

  const toggleReveal = (key: string) => {
    setRevealedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const handleCopy = async (row: EnvVarRow) => {
    await navigator.clipboard.writeText(row.value);
    setCopiedKey(row.key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  return (
    <div
      className="rounded-lg border border-border"
      data-testid="database-env-vars"
    >
      <button
        type="button"
        onClick={toggleExpanded}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-sm font-medium hover:bg-accent hover:text-accent-foreground rounded-lg"
      >
        <span>{t("integrations.database.envVars.title")}</span>
        <ChevronDown
          className={`w-4 h-4 transition-transform ${
            expanded ? "rotate-180" : ""
          }`}
        />
      </button>
      {expanded && (
        <div className="space-y-3 border-t border-border px-4 py-3">
          <p className="text-xs text-gray-600 dark:text-gray-400">
            {t("integrations.database.envVars.description")}
          </p>
          {isLoading && (
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {t("integrations.database.envVars.loading")}
            </p>
          )}
          {error && (
            <p className="text-sm text-red-600 dark:text-red-400">
              {getErrorMessage(error)}
            </p>
          )}
          {rows.map((row) => (
            <div key={row.key}>
              <label
                htmlFor={`env-${appId}-${branchType}-${row.key}`}
                className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-1 block font-mono"
              >
                {row.key}
              </label>
              <div className="flex items-center gap-2">
                <Input
                  id={`env-${appId}-${branchType}-${row.key}`}
                  readOnly
                  type={
                    row.secret && !revealedKeys.has(row.key)
                      ? "password"
                      : "text"
                  }
                  value={row.value}
                  className="font-mono text-xs"
                />
                {row.secret && (
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() => toggleReveal(row.key)}
                    aria-label={`${
                      revealedKeys.has(row.key) ? "Hide" : "Show"
                    } ${row.key}`}
                    aria-pressed={revealedKeys.has(row.key)}
                  >
                    {revealedKeys.has(row.key) ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </Button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => handleCopy(row)}
                  aria-label={`Copy ${row.key}`}
                >
                  {copiedKey === row.key ? (
                    <Check className="w-4 h-4 text-green-600 dark:text-green-400" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
