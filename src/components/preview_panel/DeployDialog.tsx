import { useCallback, useEffect, useRef, useState } from "react";
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { CheckCircle2, CloudUpload, Database, Loader2 } from "lucide-react";
import { ipc, type App } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";
import { getErrorMessage } from "@/lib/errors";
import { DyadErrorKind, isDyadError } from "@/errors/dyad_error";
import { useLoadApp } from "@/hooks/useLoadApp";
import { useCloudflareAppStatus } from "@/hooks/useCloudflareDeploy";
import { useCoolifyDeploy } from "@/hooks/useCoolifyDeploy";
import {
  useGithubOps,
  isAppliedGithubOpsReceipt,
} from "@/github_ops/useGithubOps";
import { GitHubConnector } from "@/components/GitHubConnector";
import { VercelConnector } from "@/components/VercelConnector";
import { CloudflareConnector } from "@/components/CloudflareConnector";
import { NeonSignInButton } from "@/components/NeonSignInButton";
import {
  MigrationPanelBody,
  type MigrationOutcome,
} from "@/components/MigrationPanel";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type DatabaseBranch = "production" | "development";

function FinishDeploymentButton() {
  return (
    <DialogFooter>
      <DialogClose render={<Button type="button" />}>Finish</DialogClose>
    </DialogFooter>
  );
}

function ErrorNotice({ error }: { error: unknown }) {
  return error ? (
    <p role="alert" className="text-sm text-destructive whitespace-pre-wrap">
      {getErrorMessage(error)}
    </p>
  ) : null;
}

function DatabaseCheckError({
  appId,
  error,
  onRetry,
}: {
  appId: number;
  error: unknown;
  onRetry: () => void;
}) {
  return (
    <>
      <ErrorNotice error={error} />
      {isDyadError(error) && error.kind === DyadErrorKind.Auth && (
        <NeonSignInButton appId={appId} />
      )}
      <Button variant="outline" className="mr-2" onClick={onRetry}>
        Retry database check
      </Button>
    </>
  );
}

function Progress({ children }: { children: React.ReactNode }) {
  return (
    <p
      role="status"
      className="flex items-center gap-2 text-sm text-muted-foreground"
    >
      <Loader2 className="size-4 animate-spin" />
      {children}
    </p>
  );
}

function useDatabaseContext(app: App) {
  const project = useQuery({
    queryKey: queryKeys.neon.project({ appId: app.id }),
    queryFn: () => ipc.neon.getProject({ appId: app.id }),
    enabled: !!app.neonProjectId,
    staleTime: 0,
    // A failed refetch on focus would unmount a migration in progress.
    refetchOnWindowFocus: false,
    retry: false,
  });
  const activeId = app.neonActiveBranchId ?? app.neonDevelopmentBranchId;
  const activeBranch = project.data?.branches.find(
    (branch) => branch.branchId === activeId,
  );
  const production = project.data?.branches.find(
    (branch) => branch.type === "production",
  );
  // Cached branches from an earlier opening are not verification, but
  // branches verified here stay usable while a refetch runs.
  const ready =
    !app.neonProjectId ||
    (project.isFetchedAfterMount &&
      !project.error &&
      !!activeBranch &&
      !!production);
  return { project, ready, isProduction: activeBranch?.type === "production" };
}

/** Mounted anew for each opening/app, so verification never carries into another deployment. */
export function DeployDialog({
  appId,
  onClose,
}: {
  appId: number;
  onClose: () => void;
}) {
  // Only migration and commit work should prevent dismissal. Remote requests
  // can stall, so deployment setup and polling must leave the dialog closable.
  const [busy, setBusy] = useState(false);
  const appQuery = useQuery({
    queryKey: queryKeys.apps.detail({ appId }),
    queryFn: () => ipc.app.getApp(appId),
    staleTime: 0,
    retry: false,
  });
  // Capture the entry point once. Connecting a provider during setup must not
  // replace the wizard with the already-hosted confirmation screen.
  const [initialApp, setInitialApp] = useState<App | null>(null);
  useEffect(() => {
    if (!initialApp && appQuery.data && !appQuery.isFetching && !appQuery.error)
      setInitialApp(appQuery.data);
  }, [initialApp, appQuery.data, appQuery.isFetching, appQuery.error]);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent
        showCloseButton={!busy}
        className="sm:max-w-2xl max-h-[85vh] flex flex-col overflow-hidden"
      >
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <CloudUpload className="size-5" />
            Deploy{initialApp ? ` ${initialApp.name}` : " app"}
          </DialogTitle>
          <DialogDescription>
            Prepare your database and publish your latest code.
          </DialogDescription>
        </DialogHeader>
        {initialApp ? (
          initialApp.vercelProjectId ||
          Object.values(initialApp.deploymentProvidersInUse).some(Boolean) ? (
            <HostedDeploy app={initialApp} onBusyChange={setBusy} />
          ) : (
            <FirstDeploy app={initialApp} onBusyChange={setBusy} />
          )
        ) : (
          <div className="min-h-0 overflow-y-auto scrollbar-on-hover space-y-4">
            {appQuery.error ? (
              <>
                <ErrorNotice error={appQuery.error} />
                <Button onClick={() => void appQuery.refetch()}>Retry</Button>
              </>
            ) : (
              <Progress>Checking app…</Progress>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function DeploymentStepIndicator({
  steps,
  step,
}: {
  steps: string[];
  step: number;
}) {
  return (
    <div className="shrink-0 space-y-5">
      <ol
        aria-label="Deployment steps"
        className="flex gap-3 text-xs text-muted-foreground"
      >
        {steps.map((label, index) => (
          <li
            key={label}
            aria-current={index === step ? "step" : undefined}
            className={`flex flex-1 items-center gap-1.5 border-b-2 pb-3 ${index === step ? "border-primary text-primary font-medium" : "border-border"}`}
          >
            {index < step ? (
              <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />
            ) : (
              <span>{index + 1}.</span>
            )}
            {label}
          </li>
        ))}
      </ol>
      <h2 className="font-semibold" aria-live="polite">
        Step {step + 1} — {steps[step]}
      </h2>
    </div>
  );
}

function FirstDeploy({
  app,
  onBusyChange,
}: {
  app: App;
  onBusyChange: (busy: boolean) => void;
}) {
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [branch, setBranch] = useState<DatabaseBranch>("production");
  return (
    <div className="flex min-h-0 flex-col gap-5">
      <DeploymentStepIndicator
        steps={["Database", "GitHub repository", "Deployment"]}
        step={step}
      />
      <div className="min-h-0 overflow-y-auto scrollbar-on-hover">
        {step === 0 && (
          <DatabaseStep
            app={app}
            onBusyChange={onBusyChange}
            onComplete={(selected) => {
              setBranch(selected);
              setStep(1);
            }}
          />
        )}
        {step === 1 && (
          <GithubStep
            app={app}
            onComplete={() => setStep(2)}
            onBusyChange={onBusyChange}
          />
        )}
        {step === 2 && <DeploymentStep app={app} branch={branch} />}
      </div>
    </div>
  );
}

function DatabaseStep({
  app,
  onComplete,
  onBusyChange,
}: {
  app: App;
  onComplete: (branch: DatabaseBranch) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const { project, ready, isProduction } = useDatabaseContext(app);
  const queryClient = useQueryClient();
  const [choice, setChoice] = useState<DatabaseBranch | null>(null);
  const [migrationOutcome, setMigrationOutcome] =
    useState<MigrationOutcome | null>(null);
  const [migrating, setMigrating] = useState(false);
  const selected = isProduction ? "production" : choice;
  const save = useMutation({
    mutationFn: async () => {
      if (!ready || (app.neonProjectId && !selected))
        throw new Error("Choose and verify a database first.");
      if (app.neonProjectId) {
        await ipc.neon.setSelectedDatabaseBranchType({
          appId: app.id,
          branchType: selected!,
        });
        const current = await ipc.app.getApp(app.id);
        if (
          current.selectedDatabaseBranchType !== selected ||
          current.neonProjectId !== app.neonProjectId ||
          (current.neonActiveBranchId ?? current.neonDevelopmentBranchId) !==
            (app.neonActiveBranchId ?? app.neonDevelopmentBranchId)
        ) {
          throw new Error(
            "The database selection changed. Close Deploy and try again.",
          );
        }
        queryClient.setQueryData(
          queryKeys.apps.detail({ appId: app.id }),
          current,
        );
        await queryClient.invalidateQueries({
          queryKey: queryKeys.vercel.syncPreview({ appId: app.id }),
        });
      }
    },
    onSuccess: () => onComplete(selected ?? "production"),
  });
  const needsMigration =
    !!app.neonProjectId && !isProduction && choice === "production";
  return (
    <div className="space-y-4">
      {!ready ? (
        <>
          {project.isFetching ? (
            <Progress>Checking database branches…</Progress>
          ) : (
            <DatabaseCheckError
              appId={app.id}
              error={
                project.error ??
                new Error(
                  "Could not verify the active and production database branches. Check your Neon connection.",
                )
              }
              onRetry={() => void project.refetch()}
            />
          )}
        </>
      ) : !app.neonProjectId || isProduction ? (
        <p className="text-sm text-muted-foreground">
          {app.neonProjectId ? "You are on the main database branch. " : ""}No
          database migration is required.
        </p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            Choose the database your deployed app will use.
          </p>
          <div className="grid grid-cols-2 gap-3">
            {(["production", "development"] as const).map((value) => (
              <Button
                key={value}
                variant={choice === value ? "default" : "outline"}
                disabled={migrating || save.isPending}
                aria-pressed={choice === value}
                onClick={() => {
                  setChoice(value);
                  setMigrationOutcome(null);
                }}
              >
                <Database className="size-4" />
                {value === "production"
                  ? "Production database"
                  : "Development database"}
              </Button>
            ))}
          </div>
          {choice === "development" && (
            <p className="text-sm text-muted-foreground">
              No migration is required. Your deployed app will share the
              development database.
            </p>
          )}
          {needsMigration && !migrationOutcome && (
            <MigrationPanelBody
              appId={app.id}
              presentation="inline"
              onVerified={setMigrationOutcome}
              onBusyChange={setMigrating}
            />
          )}
          {needsMigration && migrationOutcome && (
            <p role="status" className="text-sm text-green-600">
              {migrationOutcome === "no-changes"
                ? "No schema changes needed. You can continue."
                : "Migration applied successfully. You can continue."}
            </p>
          )}
        </>
      )}
      <ErrorNotice error={save.error} />
      <div className="flex justify-end">
        <Button
          disabled={
            !ready ||
            migrating ||
            save.isPending ||
            (!!app.neonProjectId && !selected) ||
            (needsMigration && !migrationOutcome)
          }
          onClick={() => save.mutate()}
        >
          Continue to GitHub
        </Button>
      </div>
      <BusyState busy={migrating} onChange={onBusyChange} />
    </div>
  );
}

function BusyState({
  busy,
  onChange,
}: {
  busy: boolean;
  onChange: (busy: boolean) => void;
}) {
  useEffect(() => {
    onChange(busy);
    return () => onChange(false);
  }, [busy, onChange]);
  return null;
}

function useDeploymentLifetime() {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return mounted;
}

function useDeploymentCommit(
  appId: number,
  onBusyChange: (busy: boolean) => void,
) {
  const mounted = useDeploymentLifetime();
  useEffect(() => () => onBusyChange(false), [onBusyChange]);
  const commit = async () => {
    if (!mounted.current) return false;
    const files = await ipc.git.getUncommittedFiles({ appId });
    if (!mounted.current) return false;
    if (files.length) {
      onBusyChange(true);
      try {
        await ipc.git.commitChanges({
          appId,
          message: "Prepare deployment",
          operationId: `deploy:${crypto.randomUUID()}`,
        });
      } finally {
        onBusyChange(false);
      }
    }
    return mounted.current;
  };
  return { commit, mounted };
}

function GithubStep({
  app,
  onComplete,
  onBusyChange,
}: {
  app: App;
  onComplete: () => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const { app: current } = useLoadApp(app.id);
  const { projection, connection, dispatch } = useGithubOps(app.id);
  const { commit, mounted } = useDeploymentCommit(app.id, onBusyChange);
  const files = useQuery({
    queryKey: queryKeys.uncommittedFiles.byApp({ appId: app.id }),
    queryFn: () => ipc.git.getUncommittedFiles({ appId: app.id }),
    staleTime: 0,
  });
  const sync = useMutation({
    mutationFn: async () => {
      if (!(await commit())) return;
      await dispatch({ type: "BANNER_DISMISSED" });
      if (!mounted.current) return;
      const receipt = await dispatch({
        type: "OP_REQUESTED",
        op: { type: "push", mode: "normal", provider: "github" },
      });
      if (!isAppliedGithubOpsReceipt(receipt))
        throw new Error(
          "GitHub could not start the sync. Resolve any pending GitHub operation and retry.",
        );
    },
    onSettled: () => files.refetch(),
  });
  const verify = useMutation({
    mutationFn: () =>
      ipc.github.verifyConnection({ appId: app.id, requireSynced: true }),
    onSuccess: () => {
      if (mounted.current) onComplete();
    },
    onError: () => files.refetch(),
  });
  return (
    <div className="space-y-4">
      <GitHubConnector appId={app.id} folderName={app.name} expanded />
      {!!files.data?.length && (
        <div className="space-y-2">
          <p className="text-sm">
            Commit your local changes and sync them to GitHub before deploying.
          </p>
          <Button
            disabled={
              connection !== "ready" ||
              projection.isOperationInFlight ||
              sync.isPending ||
              verify.isPending ||
              !current?.githubRepo
            }
            onClick={() => sync.mutate()}
          >
            {sync.isPending
              ? "Committing and syncing…"
              : "Commit changes and sync to GitHub"}
          </Button>
        </div>
      )}
      <ErrorNotice error={files.error ?? sync.error} />
      <ErrorNotice error={verify.error} />
      <div className="flex justify-end">
        <Button
          disabled={
            !current?.githubOrg ||
            !current.githubRepo ||
            connection !== "ready" ||
            projection.isOperationInFlight ||
            sync.isPending ||
            verify.isPending
          }
          onClick={() => verify.mutate()}
        >
          {verify.isPending ? "Continuing…" : "Continue to deployment"}
        </Button>
      </div>
    </div>
  );
}

function DeploymentStep({ app, branch }: { app: App; branch: DatabaseBranch }) {
  const [provider, setProvider] = useState<"vercel" | "cloudflare">("vercel");
  return (
    <div className="space-y-4">
      <div className="flex gap-2" aria-label="Deployment provider">
        <Button
          variant={provider === "vercel" ? "default" : "outline"}
          aria-pressed={provider === "vercel"}
          onClick={() => setProvider("vercel")}
        >
          Vercel
        </Button>
        <Button
          variant={provider === "cloudflare" ? "default" : "outline"}
          aria-pressed={provider === "cloudflare"}
          onClick={() => setProvider("cloudflare")}
        >
          Cloudflare
        </Button>
      </div>
      {provider === "vercel" ? (
        <VercelDeployStep app={app} branch={branch} />
      ) : (
        <CloudflareDeployStep app={app} />
      )}
    </div>
  );
}

function VercelDeployStep({
  app,
  branch,
  environmentConfigured = false,
  completion,
}: {
  app: App;
  branch?: DatabaseBranch;
  environmentConfigured?: boolean;
  completion?: React.ReactNode;
}) {
  const { app: current } = useLoadApp(app.id);
  const queryClient = useQueryClient();
  const startedProject = useRef<string | null>(null);
  const mounted = useDeploymentLifetime();
  // Vercel applies environment variables only to builds that start after
  // they are set, and a connected project's latest deployment can predate
  // this flow, so the step starts its own build and verifies that one.
  const redeploy = useMutation({
    mutationFn: () => ipc.vercel.createDeployment({ appId: app.id }),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: queryKeys.vercel.deployments({ appId: app.id }),
      }),
  });
  const sync = useMutation({
    mutationFn: async () => {
      const result = await ipc.vercel.syncNeonConfig({
        appId: app.id,
        branchType: branch,
      });
      if (!result.envPushed)
        throw new Error(
          result.warning ?? "Could not configure Vercel environment variables.",
        );
      return result;
    },
    onSuccess: () => {
      if (mounted.current) redeploy.mutate();
    },
  });
  useEffect(() => {
    if (
      !current?.vercelProjectId ||
      startedProject.current === current.vercelProjectId
    )
      return;
    let disposed = false;
    // Wait for Strict Mode's effect replay before starting the mutation so
    // its result remains attached to the live observer.
    queueMicrotask(() => {
      if (disposed) return;
      startedProject.current = current.vercelProjectId;
      if (app.neonProjectId && !environmentConfigured) sync.mutate();
      else redeploy.mutate();
    });
    return () => {
      disposed = true;
    };
  }, [
    app.neonProjectId,
    environmentConfigured,
    current?.vercelProjectId,
    sync.mutate,
    redeploy.mutate,
  ]);
  const deploymentUid = redeploy.data?.uid;
  const deployments = useQuery({
    queryKey: queryKeys.vercel.deployments({ appId: app.id }),
    queryFn: () => ipc.vercel.getDeployments({ appId: app.id }),
    enabled: !!deploymentUid,
    staleTime: 0,
    refetchInterval: (query) =>
      query.state.data?.some(
        (deployment) =>
          deployment.uid === deploymentUid &&
          ["READY", "ERROR", "CANCELED"].includes(deployment.readyState),
      )
        ? false
        : 5000,
    retry: false,
  });
  const started = deployments.data?.find(
    (deployment) => deployment.uid === deploymentUid,
  );
  const failed =
    started?.readyState === "ERROR" || started?.readyState === "CANCELED";
  const complete =
    !!deploymentUid && !deployments.error && started?.readyState === "READY";
  return (
    <div className="space-y-4">
      {!environmentConfigured && (
        <VercelConnector appId={app.id} folderName={app.name} deferDeployment />
      )}
      {sync.isPending && (
        <Progress>Configuring Vercel environment variables…</Progress>
      )}
      {sync.isError && (
        <>
          <ErrorNotice error={sync.error} />
          <Button onClick={() => sync.mutate()}>Retry environment setup</Button>
        </>
      )}
      {sync.data?.warning && (
        <p role="status" className="text-sm text-amber-600">
          {sync.data.warning}
        </p>
      )}
      {redeploy.isPending && <Progress>Starting a Vercel deployment…</Progress>}
      {deploymentUid && !complete && !failed && !deployments.error && (
        <Progress>Building on Vercel…</Progress>
      )}
      {(redeploy.isError || failed) && (
        <>
          <ErrorNotice
            error={
              redeploy.error ??
              new Error(
                "The Vercel deployment did not finish. Check its build logs in Vercel, then retry.",
              )
            }
          />
          <Button onClick={() => redeploy.mutate()}>Retry deployment</Button>
        </>
      )}
      <ErrorNotice error={deployments.error} />
      {complete && (
        <p
          role="status"
          className="flex items-center gap-2 text-sm text-green-600"
        >
          <CheckCircle2 className="size-4" />
          Deployment verified
          {app.neonProjectId ? " and environment variables configured" : ""}.
        </p>
      )}
      {complete && (completion ?? <FinishDeploymentButton />)}
    </div>
  );
}

function CloudflareDeployStep({ app }: { app: App }) {
  const status = useCloudflareAppStatus({ appId: app.id });
  const deployments = useQueries({
    queries: (status.data?.connections ?? []).map((connection) => ({
      queryKey: queryKeys.cloudflare.deploymentStatus({
        appId: app.id,
        rootDirectory: connection.rootDirectory,
      }),
      queryFn: () =>
        ipc.cloudflare.getDeploymentStatus({
          appId: app.id,
          rootDirectory: connection.rootDirectory,
        }),
      staleTime: 0,
      refetchInterval: 5000,
    })),
  });
  const complete =
    deployments.length > 0 &&
    deployments.every(
      (query) =>
        !query.error &&
        query.data?.state === "live" &&
        !query.data.ruleMissing &&
        !query.data.ruleDeploys &&
        !query.data.tokenRevoked,
    );
  const error = status.error ?? deployments.find((query) => query.error)?.error;
  const failed = deployments.some(
    (query) =>
      query.data?.state === "failed" || query.data?.state === "cancelled",
  );
  const pending = deployments.some(
    (query) =>
      query.isLoading ||
      query.data?.state === "queued" ||
      query.data?.state === "building",
  );
  return (
    <div className="space-y-4">
      <CloudflareConnector appId={app.id} />
      {pending && <Progress>Building on Cloudflare…</Progress>}
      <ErrorNotice error={error} />
      {failed && (
        <ErrorNotice
          error={
            new Error(
              "A Cloudflare deployment failed or was cancelled. Check its build logs in Cloudflare and retry the build there, or sync a code fix from GitHub.",
            )
          }
        />
      )}
      {(error || failed) && (
        <Button
          onClick={() => {
            void status.refetch();
            for (const deployment of deployments) void deployment.refetch();
          }}
        >
          Retry deployment status
        </Button>
      )}
      {complete && (
        <p role="status" className="text-sm text-green-600">
          Cloudflare deployment verified.
        </p>
      )}
      {complete && <FinishDeploymentButton />}
    </div>
  );
}

function HostedDeploy({
  app,
  onBusyChange,
}: {
  app: App;
  onBusyChange: (busy: boolean) => void;
}) {
  const { project, ready, isProduction } = useDatabaseContext(app);
  const [confirmed, setConfirmed] = useState(false);
  const [databaseVerified, setDatabaseVerified] = useState(false);
  // Reject remote history that would require a merge before changing production.
  // A later remote change or network failure can still interrupt the push.
  const preflight = useMutation({
    mutationFn: () =>
      ipc.github.verifyConnection({ appId: app.id, requirePushable: true }),
    onSuccess: () => setConfirmed(true),
  });
  const needsMigration =
    !!app.neonProjectId &&
    !isProduction &&
    app.selectedDatabaseBranchType !== "development";
  const step = !confirmed ? 0 : needsMigration && !databaseVerified ? 1 : 2;
  return (
    <div className="flex min-h-0 flex-col gap-4">
      <DeploymentStepIndicator
        steps={["Overview", "Database", "Deployment"]}
        step={step}
      />
      <div className="min-h-0 overflow-y-auto scrollbar-on-hover space-y-4">
        {!confirmed ? (
          <>
            <p className="text-sm">This app is already hosted. Deploy will:</p>
            <ol className="list-decimal pl-5 text-sm space-y-2">
              <li>
                Check whether a database migration is required and ask you to
                review and approve any changes.
              </li>
              <li>
                Push the latest codebase changes to GitHub to trigger your
                hosting provider’s deployment.
              </li>
              {app.vercelProjectId && (
                <li>
                  Start and verify a Vercel build with the updated environment,
                  even when there are no new code changes.
                </li>
              )}
              {app.deploymentProvidersInUse.coolify && (
                <li>
                  Start a deployment on your Coolify server, which does not
                  build on push.
                </li>
              )}
            </ol>
            {!ready &&
              (project.isFetching ? (
                <Progress>Checking database branches…</Progress>
              ) : (
                <DatabaseCheckError
                  appId={app.id}
                  error={
                    project.error ??
                    new Error("Could not verify the database branches.")
                  }
                  onRetry={() => void project.refetch()}
                />
              ))}
            {preflight.isError && (
              <>
                <ErrorNotice error={preflight.error} />
                <GitHubConnector
                  appId={app.id}
                  folderName={app.name}
                  expanded
                />
              </>
            )}
            <Button
              disabled={!ready || preflight.isPending}
              onClick={() => preflight.mutate()}
            >
              {preflight.isPending ? "Checking GitHub…" : "Review and deploy"}
            </Button>
          </>
        ) : needsMigration && !databaseVerified ? (
          <MigrationPanelBody
            appId={app.id}
            presentation="inline"
            autoPreview
            onBusyChange={onBusyChange}
            onVerified={() => setDatabaseVerified(true)}
          />
        ) : (
          <PushDeployment app={app} onBusyChange={onBusyChange} />
        )}
      </div>
    </div>
  );
}

function PushDeployment({
  app,
  onBusyChange,
}: {
  app: App;
  onBusyChange: (busy: boolean) => void;
}) {
  const github = useGithubOps(app.id);
  const { commit, mounted } = useDeploymentCommit(app.id, onBusyChange);
  const started = useRef(false);
  const verifiedBanner = useRef(github.projection.banner);
  const [environmentWarning, setEnvironmentWarning] = useState<string>();
  const push = useMutation({
    mutationFn: async () => {
      await ipc.github.verifyConnection({
        appId: app.id,
        requirePushable: true,
      });
      if (!mounted.current) return;
      if (app.vercelProjectId && app.neonProjectId) {
        setEnvironmentWarning(undefined);
        // Also repairs a project whose first guided setup was abandoned.
        const result = await ipc.vercel.syncNeonConfig({ appId: app.id });
        if (!mounted.current) return;
        if (!result.envPushed) {
          throw new Error(
            result.warning ??
              "Could not configure Vercel environment variables.",
          );
        }
        setEnvironmentWarning(result.warning);
      }
      if (!(await commit())) return;
      await github.dispatch({ type: "BANNER_DISMISSED" });
      if (!mounted.current) return;
      const receipt = await github.dispatch({
        type: "OP_REQUESTED",
        op: { type: "push", mode: "normal", provider: "github" },
      });
      if (!isAppliedGithubOpsReceipt(receipt))
        throw new Error(
          "GitHub could not start the push. Resolve any pending GitHub operation and retry.",
        );
    },
  });
  useEffect(() => {
    if (
      started.current ||
      github.connection !== "ready" ||
      github.projection.isOperationInFlight
    )
      return;
    let disposed = false;
    // Strict Mode detaches mutation observers during effect replay. Starting
    // afterward lets the push receipt update the UI and trigger verification.
    queueMicrotask(() => {
      if (disposed || started.current) return;
      started.current = true;
      push.mutate();
    });
    return () => {
      disposed = true;
    };
  }, [github.connection, github.projection.isOperationInFlight, push.mutate]);
  const verification = useMutation({
    mutationFn: () =>
      ipc.github.verifyConnection({ appId: app.id, requireSynced: true }),
  });
  // Banners auto-dismiss. Retain the verified result locally so a slow remote
  // check can finish even after the connector has cleared its success banner.
  useEffect(() => {
    if (
      push.isSuccess &&
      !github.projection.isOperationInFlight &&
      github.projection.banner !== verifiedBanner.current &&
      github.projection.banner?.kind === "success" &&
      github.projection.completedOperation === "push"
    ) {
      verifiedBanner.current = github.projection.banner;
      verification.mutate();
    }
  }, [push.isSuccess, github.projection, verification.mutate]);
  const usesCoolify = app.deploymentProvidersInUse.coolify;
  const usesVercel = !!app.vercelProjectId;
  return (
    <div className="space-y-4">
      {environmentWarning && (
        <p role="status" className="text-sm text-amber-600">
          {environmentWarning}
        </p>
      )}
      {verification.isSuccess ? (
        <>
          <p
            role="status"
            className="flex items-center gap-2 text-sm text-green-600"
          >
            <CheckCircle2 className="size-4" />
            Latest code verified on GitHub.
            {usesCoolify || usesVercel
              ? ""
              : " Your hosting provider will build the update."}
          </p>
          {usesVercel ? (
            <VercelDeployStep
              app={app}
              environmentConfigured
              completion={
                usesCoolify ? <CoolifyRedeploy appId={app.id} /> : undefined
              }
            />
          ) : usesCoolify ? (
            <CoolifyRedeploy appId={app.id} />
          ) : null}
        </>
      ) : (
        <>
          {(push.isPending || github.projection.isSyncing) && (
            <Progress>Pushing latest code to GitHub…</Progress>
          )}
          {verification.isPending && (
            <Progress>Verifying the latest code on GitHub…</Progress>
          )}
          <ErrorNotice error={push.error ?? verification.error} />
          {push.isError && (
            <Button onClick={() => push.mutate()}>Retry deployment push</Button>
          )}
          {verification.isError && (
            <Button onClick={() => verification.mutate()}>
              Verify push again
            </Button>
          )}
          <GitHubConnector appId={app.id} folderName={app.name} expanded />
        </>
      )}
      {verification.isSuccess && !usesCoolify && !usesVercel && (
        <FinishDeploymentButton />
      )}
    </div>
  );
}

type CoolifyAttempt = {
  requestedAt: number;
  started: boolean;
  /** Set when this request follows a build that was already running. */
  waitedOut: boolean;
};

/** Coolify clones from GitHub but does not build on push, so start its build. */
function CoolifyRedeploy({ appId }: { appId: number }) {
  const { snapshot, deploy } = useCoolifyDeploy(appId);
  const requested = useRef(false);
  const [attempt, setAttempt] = useState<CoolifyAttempt | null>(null);
  const request = useCallback(
    (waitedOut = false) => {
      setAttempt({ requestedAt: Date.now(), started: false, waitedOut });
      deploy.mutate();
    },
    [deploy.mutate],
  );
  useEffect(() => {
    if (requested.current) return;
    let disposed = false;
    queueMicrotask(() => {
      if (disposed || requested.current) return;
      requested.current = true;
      request();
    });
    return () => {
      disposed = true;
    };
  }, [request]);
  const finished =
    snapshot.type === "succeeded" || snapshot.type === "failed"
      ? snapshot
      : null;
  useEffect(() => {
    if (!attempt || attempt.started) return;
    if (
      snapshot.type === "running" &&
      snapshot.startedAt >= attempt.requestedAt
    ) {
      setAttempt({ ...attempt, started: true });
    } else if (
      !attempt.waitedOut &&
      finished &&
      finished.finishedAt > attempt.requestedAt
    ) {
      // Coolify ignores a request while it is already deploying. That build
      // started before the push, so ask again once it has ended.
      request(true);
    }
  }, [attempt, snapshot, finished, request]);
  const result = attempt?.started ? finished : null;
  return (
    <>
      {result?.type === "succeeded" ? (
        <p
          role="status"
          className="flex items-center gap-2 text-sm text-green-600"
        >
          <CheckCircle2 className="size-4" />
          Coolify deployment finished.
        </p>
      ) : deploy.isError || result?.type === "failed" ? (
        <>
          <ErrorNotice
            error={
              deploy.error ??
              new Error(
                result?.type === "failed"
                  ? result.error
                  : "The Coolify deployment failed.",
              )
            }
          />
          <Button onClick={() => request()}>Retry Coolify deployment</Button>
        </>
      ) : (
        <Progress>Deploying to Coolify…</Progress>
      )}
      {result?.type === "succeeded" && <FinishDeploymentButton />}
    </>
  );
}
