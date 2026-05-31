import { useEffect, useState } from "react";
import {
  ArrowLeft,
  Database,
  FlaskConical,
  Loader2,
  Server,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";
import { useLoadApp } from "@/hooks/useLoadApp";
import { useNeon } from "@/hooks/useNeon";
import { MigrationPanelBody } from "@/components/MigrationPanel";
import { DatabaseEnvVars } from "@/components/preview_panel/DatabaseEnvVars";

type EnvKind = "prod" | "dev";

interface DatabaseSectionProps {
  appId: number;
}

const storageKey = (appId: number) => `dyad.databaseSection.env.${appId}`;

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
    icon: typeof Server;
  }
> = {
  prod: { branchType: "production", icon: Server },
  dev: { branchType: "development", icon: FlaskConical },
};

export const DatabaseSection = ({ appId }: DatabaseSectionProps) => {
  const { t } = useTranslation("home");
  const { app } = useLoadApp(appId);
  const { branches, isLoadingBranches } = useNeon(appId);

  const productionBranch = branches.find((b) => b.type === "production");
  const effectiveBranchId =
    app?.neonActiveBranchId ?? app?.neonDevelopmentBranchId;
  const isProductionBranchActive =
    !!effectiveBranchId && effectiveBranchId === productionBranch?.branchId;

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
    <Card data-testid="database-section">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2">
          <Database className="w-5 h-5 text-primary" />
          {t("integrations.database.title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoadingBranches ? (
          <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
            <Loader2 className="w-4 h-4 animate-spin" />
            {t("integrations.database.loading")}
          </div>
        ) : isProductionBranchActive ? (
          // Case 2: the app is already on the production branch.
          <>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {t("integrations.database.productionActiveMessage")}
            </p>
            <DatabaseEnvVars appId={appId} branchType="production" />
          </>
        ) : selectedEnv === null ? (
          // Case 1: pick which database branch to deploy against.
          <>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {t("integrations.database.pickDatabase")}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {(Object.keys(ENV_META) as EnvKind[]).map((kind) => {
                const meta = ENV_META[kind];
                const Icon = meta.icon;
                const isSelected = pendingEnv === kind;
                const metaKey = kind === "prod" ? "production" : "development";
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
                      <span className="font-medium">
                        {t(`integrations.database.${metaKey}.title`)}
                      </span>
                    </div>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      {t(`integrations.database.${metaKey}.description`)}
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
                {t("integrations.database.continue")}
              </Button>
            </div>
          </>
        ) : (
          // Case 1: a branch was picked — show migration (production only) + env vars.
          <>
            <div className="flex items-center justify-between">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleBack}
                className="-ml-2"
              >
                <ArrowLeft className="w-4 h-4" />
                {t("integrations.database.backToSelection")}
              </Button>
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                {t(
                  `integrations.database.${
                    selectedEnv === "prod" ? "production" : "development"
                  }.title`,
                )}
              </span>
            </div>

            {selectedEnv === "prod" && <MigrationPanelBody appId={appId} />}

            <DatabaseEnvVars
              appId={appId}
              branchType={ENV_META[selectedEnv].branchType}
            />
          </>
        )}
      </CardContent>
    </Card>
  );
};
