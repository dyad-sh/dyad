import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  Check,
  Copy,
  ExternalLink,
  FlaskConical,
  Info,
  Rocket,
  Server,
} from "lucide-react";
import { ipc } from "@/ipc/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { queryKeys } from "@/lib/queryKeys";
import { getErrorMessage } from "@/lib/errors";

type EnvKind = "prod" | "dev";

interface DeploymentEnvPanelProps {
  appId: number;
}

const storageKey = (appId: number) => `dyad.deploymentEnvPanel.env.${appId}`;

const readPersistedEnv = (appId: number): EnvKind | null => {
  try {
    const raw = localStorage.getItem(storageKey(appId));
    return raw === "prod" || raw === "dev" ? raw : null;
  } catch {
    return null;
  }
};

const ENV_META: Record<
  EnvKind,
  {
    branchType: "production" | "development";
    title: string;
    description: string;
    icon: typeof Server;
  }
> = {
  prod: {
    branchType: "production",
    title: "Production",
    description:
      "Pick this once real users are using the app and you need their data kept safe.",
    icon: Server,
  },
  dev: {
    branchType: "development",
    title: "Development",
    description:
      "Pick this if you're still experimenting and no real users are testing the app yet.",
    icon: FlaskConical,
  },
};

export const DeploymentEnvPanel = ({ appId }: DeploymentEnvPanelProps) => {
  const [selectedEnv, setSelectedEnv] = useState<EnvKind | null>(() =>
    readPersistedEnv(appId),
  );
  const [pendingEnv, setPendingEnv] = useState<EnvKind | null>(null);

  useEffect(() => {
    setSelectedEnv(readPersistedEnv(appId));
    setPendingEnv(null);
  }, [appId]);

  const confirmEnv = () => {
    if (pendingEnv === null) return;
    try {
      localStorage.setItem(storageKey(appId), pendingEnv);
    } catch {
      // ignore — UI still works without persistence
    }
    setSelectedEnv(pendingEnv);
  };

  const branchType =
    selectedEnv !== null ? ENV_META[selectedEnv].branchType : null;

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.neon.branchConnectionUri({
      appId,
      branchType: branchType ?? "development",
    }),
    queryFn: () =>
      ipc.neon.getBranchConnectionUri({
        appId,
        branchType: branchType!,
      }),
    enabled: branchType !== null,
    staleTime: 5 * 60 * 1000,
  });

  const handleBack = () => {
    try {
      localStorage.removeItem(storageKey(appId));
    } catch {
      // ignore
    }
    setSelectedEnv(null);
    setPendingEnv(null);
  };

  return (
    <Card data-testid="deployment-env-panel">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2">
          <Rocket className="w-5 h-5 text-primary" />
          Deployment environment
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {selectedEnv === null ? (
          <>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Pick the database your deployed app should connect to. We'll show
              you the environment variables to set in your hosting provider.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {(Object.keys(ENV_META) as EnvKind[]).map((kind) => {
                const meta = ENV_META[kind];
                const Icon = meta.icon;
                const isSelected = pendingEnv === kind;
                return (
                  <button
                    key={kind}
                    type="button"
                    onClick={() => setPendingEnv(kind)}
                    aria-pressed={isSelected}
                    className={`text-left rounded-lg border bg-background p-4 transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                      isSelected
                        ? "border-primary ring-2 ring-primary"
                        : "border-border"
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <Icon className="w-4 h-4 text-primary" />
                      <span className="font-medium">{meta.title}</span>
                    </div>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      {meta.description}
                    </p>
                  </button>
                );
              })}
            </div>
            <div className="flex justify-end">
              <Button
                type="button"
                onClick={confirmEnv}
                disabled={pendingEnv === null}
              >
                Continue
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleBack}
                className="-ml-2"
              >
                <ArrowLeft className="w-4 h-4" />
                Back to selection
              </Button>
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                {ENV_META[selectedEnv].title}
              </span>
            </div>

            <p className="text-sm text-gray-600 dark:text-gray-400">
              Add these environment variables to your hosting provider so the
              deployed app can connect to Neon.
            </p>

            <div className="space-y-3">
              <EnvVarRow
                id={`db-url-${appId}-${selectedEnv}`}
                name="DATABASE_URL"
                value={data?.connectionUri ?? ""}
                isLoading={isLoading}
              />
              {(isLoading || data?.neonAuth) && (
                <EnvVarRow
                  id={`neon-auth-base-url-${appId}-${selectedEnv}`}
                  name="NEON_AUTH_BASE_URL"
                  value={data?.neonAuth?.baseUrl ?? ""}
                  isLoading={isLoading}
                />
              )}
              {(isLoading || data?.neonAuth?.cookieSecret !== undefined) && (
                <EnvVarRow
                  id={`neon-auth-cookie-secret-${appId}-${selectedEnv}`}
                  name="NEON_AUTH_COOKIE_SECRET"
                  value={data?.neonAuth?.cookieSecret ?? ""}
                  isLoading={isLoading}
                />
              )}
            </div>

            {error && (
              <p className="text-sm text-red-600 dark:text-red-400">
                {getErrorMessage(error)}
              </p>
            )}

            {data?.neonAuth && (
              <button
                type="button"
                onClick={() =>
                  ipc.system.openExternalUrl(
                    "https://neon.com/docs/auth/guides/configure-domains",
                  )
                }
                className="w-full flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800 hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-200 dark:hover:bg-blue-900/30 transition-colors"
              >
                <Info className="h-4 w-4 flex-shrink-0 text-blue-600 dark:text-blue-400" />
                <span className="flex-1 text-left">
                  Add your deployed domain to Neon Auth's trusted domains after
                  deploying.
                </span>
                <ExternalLink className="h-3.5 w-3.5 flex-shrink-0 opacity-70" />
              </button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
};

interface EnvVarRowProps {
  id: string;
  name: string;
  value: string;
  isLoading: boolean;
}

const EnvVarRow = ({ id, name, value, isLoading }: EnvVarRowProps) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!value) return;
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div>
      <label
        htmlFor={id}
        className="font-mono text-xs font-medium text-gray-700 dark:text-gray-300 mb-1 block"
      >
        {name}
      </label>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          readOnly
          type="text"
          value={isLoading ? "" : value}
          placeholder={isLoading ? "Loading…" : ""}
          className="font-mono text-xs"
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={handleCopy}
          disabled={!value}
          aria-label={`Copy ${name}`}
        >
          {copied ? (
            <Check className="w-4 h-4 text-green-600 dark:text-green-400" />
          ) : (
            <Copy className="w-4 h-4" />
          )}
        </Button>
      </div>
    </div>
  );
};
