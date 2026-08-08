import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  Check,
  Copy,
  Database,
  FlaskConical,
  Server,
} from "lucide-react";
import { ipc } from "@/ipc/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { queryKeys } from "@/lib/queryKeys";
import { getErrorMessage } from "@/lib/errors";

type EnvKind = "prod" | "dev";

interface DatabaseUrlPanelProps {
  appId: number;
}

const storageKey = (appId: number) => `dyad.databaseUrlPanel.env.${appId}`;

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

export const DatabaseUrlPanel = ({ appId }: DatabaseUrlPanelProps) => {
  const [selectedEnv, setSelectedEnv] = useState<EnvKind | null>(() =>
    readPersistedEnv(appId),
  );
  const [pendingEnv, setPendingEnv] = useState<EnvKind | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setSelectedEnv(readPersistedEnv(appId));
    setPendingEnv(null);
    setCopied(false);
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
    setCopied(false);
  };

  const handleCopy = async () => {
    if (!data?.connectionUri) return;
    await navigator.clipboard.writeText(data.connectionUri);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Card data-testid="database-url-panel">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2">
          <Database className="w-5 h-5 text-primary" />
          Database URL
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {selectedEnv === null ? (
          <>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Pick the database your deployed app should connect to. Copy the
              connection string into your hosting provider's{" "}
              <code className="font-mono text-xs">DATABASE_URL</code>{" "}
              environment variable.
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

            <div>
              <label
                htmlFor={`db-url-${appId}`}
                className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1 block"
              >
                {ENV_META[selectedEnv].title} database URL
              </label>
              <p className="text-xs text-gray-600 dark:text-gray-400 mb-2">
                Paste this into your deployed app's{" "}
                <code className="font-mono">DATABASE_URL</code> environment
                variable.
              </p>
              <div className="flex items-center gap-2">
                <Input
                  id={`db-url-${appId}`}
                  readOnly
                  type="text"
                  value={
                    isLoading ? "" : error ? "" : (data?.connectionUri ?? "")
                  }
                  placeholder={isLoading ? "Loading…" : ""}
                  className="font-mono text-xs"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={handleCopy}
                  disabled={!data?.connectionUri}
                  aria-label="Copy URL"
                >
                  {copied ? (
                    <Check className="w-4 h-4 text-green-600 dark:text-green-400" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </Button>
              </div>
              {error && (
                <p className="text-sm text-red-600 dark:text-red-400 mt-2">
                  {getErrorMessage(error)}
                </p>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
};
