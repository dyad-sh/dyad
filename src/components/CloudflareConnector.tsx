import { useEffect, useRef, useState } from "react";
import { ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ipc } from "@/ipc/types";
import type {
  CloudflareConnection,
  CloudflareTargetSummary,
  CloudflareWorkerSummary,
} from "@/ipc/types";
import { useSettings } from "@/hooks/useSettings";
import {
  useCloudflareAccounts,
  useCloudflareAppStatus,
  useCloudflareDeploymentStatus,
  useCloudflareRepoAccess,
  useCloudflareWorkers,
  useConnectCloudflareWorker,
  useDisconnectCloudflareWorker,
  useSaveCloudflareToken,
} from "@/hooks/useCloudflareDeploy";
import {
  CLOUDFLARE_CONNECT_GITHUB_URL,
  buildCloudflareTokenTemplateUrl,
  isDeploymentInProgress,
  isValidWorkerName,
  type CloudflareDeploymentState,
} from "@/cloudflare_deploy/build_config";

/**
 * When a target deploys. A sync that pushes nothing never reaches Cloudflare,
 * and a folder's deploy rule only watches that folder.
 */
function deployTriggerText(target: { rootDirectory: string; label: string }) {
  return target.rootDirectory === ""
    ? "Deploys whenever a sync pushes new commits to GitHub."
    : `Deploys whenever a sync pushes changes inside ${target.label} to GitHub.`;
}

const noticeClass =
  "bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-md p-3 text-sm text-blue-800 dark:text-blue-200";
const warningClass =
  "bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-md p-3 text-sm text-amber-800 dark:text-amber-200";
const errorClass =
  "bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md p-3 text-sm text-red-800 dark:text-red-200";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function CloudflareConnector({ appId }: { appId: number }) {
  const { settings } = useSettings();
  if (!settings?.cloudflareAccessToken) {
    return <TokenForm />;
  }
  return <ConnectedAccount appId={appId} />;
}

// ---------------------------------------------------------------------------
// API token
// ---------------------------------------------------------------------------

function TokenForm() {
  const { refreshSettings } = useSettings();
  const [token, setToken] = useState("");
  const saveToken = useSaveCloudflareToken();
  const isSaving = saveToken.isPending;

  const handleSave = (event: React.FormEvent) => {
    event.preventDefault();
    if (!token.trim()) return;
    saveToken.mutate(token.trim(), {
      onSuccess: () => {
        setToken("");
        refreshSettings();
      },
    });
  };

  return (
    <div className="space-y-4" data-testid="cloudflare-token-form">
      <h3 className="font-medium">Connect to Cloudflare</h3>
      <div className={noticeClass}>
        <p className="mb-2">
          Cloudflare needs an API token to deploy your Workers. This is a
          one-time step:
        </p>
        <ol className="list-decimal list-inside space-y-1">
          <li>If you don't have a Cloudflare account, sign up first</li>
          <li>
            Create the token. The form opens with the right permissions already
            chosen, so continue to the summary and create it
          </li>
          <li>Copy the token and paste it below</li>
        </ol>
        <div className="flex gap-2 mt-3">
          <Button
            variant="outline"
            className="flex-1"
            onClick={() =>
              ipc.system.openExternalUrl("https://dash.cloudflare.com/sign-up")
            }
          >
            Sign Up for Cloudflare
          </Button>
          <Button
            className="flex-1 bg-blue-600 hover:bg-blue-700 text-white"
            onClick={() =>
              ipc.system.openExternalUrl(buildCloudflareTokenTemplateUrl())
            }
          >
            Create API Token
          </Button>
        </div>
      </div>

      <form onSubmit={handleSave} className="space-y-3">
        <div>
          <Label
            htmlFor="cloudflare-api-token"
            className="block text-sm font-medium mb-1"
          >
            Cloudflare API Token
          </Label>
          <Input
            id="cloudflare-api-token"
            type="password"
            placeholder="Paste your Cloudflare API token"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            disabled={isSaving}
            className="w-full"
          />
        </div>
        <Button
          type="submit"
          disabled={!token.trim() || isSaving}
          className="w-full"
        >
          {isSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          {isSaving ? "Checking Token..." : "Save API Token"}
        </Button>
      </form>

      {saveToken.error && (
        <div className={errorClass}>{errorMessage(saveToken.error)}</div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Account, target and readiness
// ---------------------------------------------------------------------------

function ConnectedAccount({ appId }: { appId: number }) {
  const accounts = useCloudflareAccounts();
  const status = useCloudflareAppStatus({ appId });
  const [chosenAccountId, setChosenAccountId] = useState<string | null>(null);
  const [chosenTarget, setChosenTarget] = useState<string | null>(null);

  const loading = (
    <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
      <Loader2 className="h-4 w-4 animate-spin" />
      Loading Cloudflare...
    </div>
  );
  if (status.isLoading) {
    return loading;
  }
  if (!status.data) {
    // Only with nothing to show. A later refetch that fails keeps what is
    // already on screen rather than replacing it with an error.
    return status.error ? (
      <div className={errorClass}>{errorMessage(status.error)}</div>
    ) : null;
  }
  // Only setting a folder up needs the accounts. A connected folder is shown
  // without them, since a revoked token fails this call first.
  const accountList = accounts.data;
  // Every folder the tab has something to say about: the ones that can be
  // deployed, and any still connected whose Wrangler config has since left
  // the branch. Those keep their rule on Cloudflare, so they must stay
  // reachable here to be disconnected.
  const connections = status.data.connections;
  const deployable = status.data.targets;
  const folders: DeployFolder[] = [
    ...deployable.map((target) => ({
      rootDirectory: target.rootDirectory,
      label: target.label,
      target,
    })),
    ...connections
      .filter(
        (connection) =>
          !deployable.some(
            (target) => target.rootDirectory === connection.rootDirectory,
          ),
      )
      .map((connection) => ({
        rootDirectory: connection.rootDirectory,
        label: connection.rootDirectory || "App root",
        target: null,
      })),
  ];
  if (folders.length === 0) {
    return (
      <div className={noticeClass} data-testid="cloudflare-no-targets">
        <p className="font-medium mb-1">No Cloudflare Worker found</p>
        <p>
          Dyad deploys folders that contain a Wrangler config (wrangler.jsonc,
          wrangler.json or wrangler.toml). Add a Worker to this app, then sync
          it to GitHub.
        </p>
      </div>
    );
  }

  const accountId = chosenAccountId ?? accountList?.[0]?.id ?? null;
  const folder =
    folders.find((candidate) => candidate.rootDirectory === chosenTarget) ??
    folders[0];
  const target = folder.target;
  const connection = connections.find(
    (candidate) => candidate.rootDirectory === folder.rootDirectory,
  );

  return (
    <div className="space-y-4" data-testid="cloudflare-connector">
      {folders.length > 1 && (
        <TargetList
          folders={folders}
          connections={connections}
          selected={folder.rootDirectory}
          onSelect={setChosenTarget}
        />
      )}

      {connection ? (
        <>
          {!target && (
            <div
              className={warningClass}
              data-testid="cloudflare-config-missing"
            >
              Dyad cannot find a Wrangler config for {folder.label} on{" "}
              {status.data.branch}. If the config is gone, Cloudflare cannot
              build it either, but its deploy rule is still there: restore the
              config, or disconnect {folder.label} to remove the rule.
            </div>
          )}
          <DeploymentCard
            // Each folder's Disconnect state is its own.
            key={connection.rootDirectory}
            appId={appId}
            connection={connection}
            targetLabel={folder.label}
            hasConfig={target !== null}
          />
        </>
      ) : !target ? null : !accountList ? (
        accounts.error ? (
          <div className={errorClass} data-testid="cloudflare-accounts-error">
            {errorMessage(accounts.error)}
          </div>
        ) : (
          loading
        )
      ) : accountList.length === 0 ? (
        <div className={warningClass} data-testid="cloudflare-no-accounts">
          This API token can no longer see any Cloudflare account. Disconnect
          Cloudflare under Settings &gt; Integrations, then add a new token
          here.
        </div>
      ) : (
        <>
          {accountList.length > 1 && (
            <div>
              <Label
                htmlFor="cloudflare-account"
                className="block text-sm font-medium mb-1"
              >
                Cloudflare account
              </Label>
              <Select
                value={accountId ?? ""}
                onValueChange={(value) => {
                  // Base UI reports a cleared selection as null.
                  if (value) setChosenAccountId(value);
                }}
                items={accountList.map((account) => ({
                  value: account.id,
                  label: account.name,
                }))}
              >
                <SelectTrigger
                  id="cloudflare-account"
                  className="w-full"
                  data-testid="cloudflare-account-select"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {accountList.map((account) => (
                    <SelectItem key={account.id} value={account.id}>
                      {account.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {!status.data.synced ? (
            <div className={warningClass} data-testid="cloudflare-not-synced">
              <p className="font-medium mb-1">Sync to GitHub first</p>
              <p>
                Cloudflare deploys what is on GitHub, and the latest commit on{" "}
                {status.data.branch} has not been pushed yet. Sync the app above
                and this continues on its own.
              </p>
            </div>
          ) : accountId ? (
            <TargetSetup
              // The form seeds itself from the target and the account.
              key={`${accountId}:${target.rootDirectory}`}
              appId={appId}
              accountId={accountId}
              target={target}
              connections={status.data.connections}
            />
          ) : null}
        </>
      )}
    </div>
  );
}

/** A folder shown in the tab. `target` is null when Dyad cannot find its Wrangler config. */
interface DeployFolder {
  rootDirectory: string;
  label: string;
  target: CloudflareTargetSummary | null;
}

/**
 * Every deployable folder and whether it is connected. A list rather than a
 * dropdown because the folders are not alternatives: each deploys to its own
 * Worker, and any number of them can be connected at once.
 */
function TargetList({
  folders,
  connections,
  selected,
  onSelect,
}: {
  folders: DeployFolder[];
  connections: CloudflareConnection[];
  selected: string;
  onSelect: (rootDirectory: string) => void;
}) {
  return (
    <div className="space-y-2" data-testid="cloudflare-target-list">
      <p className="text-sm text-gray-600 dark:text-gray-400">
        Each folder here deploys to its own Worker, and each connected one
        deploys when a sync pushes changes to it.
      </p>
      <ul className="border rounded-md divide-y">
        {folders.map((target) => {
          const connection = connections.find(
            (candidate) => candidate.rootDirectory === target.rootDirectory,
          );
          const isSelected = target.rootDirectory === selected;
          return (
            <li key={target.rootDirectory}>
              <button
                type="button"
                aria-pressed={isSelected}
                onClick={() => onSelect(target.rootDirectory)}
                className={`w-full flex items-center justify-between gap-3 px-3 py-2 text-left text-sm cursor-pointer hover:bg-muted/50 ${
                  isSelected ? "bg-muted" : "bg-transparent"
                }`}
              >
                <span className="font-medium truncate">{target.label}</span>
                <span
                  className={
                    !connection
                      ? "text-xs text-gray-500 dark:text-gray-400"
                      : target.target
                        ? "text-xs text-green-700 dark:text-green-400 truncate"
                        : "text-xs text-amber-700 dark:text-amber-400 truncate"
                  }
                >
                  {!connection
                    ? "Not connected"
                    : target.target
                      ? `Connected to ${connection.workerName}`
                      : `Connected to ${connection.workerName}, config missing`}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function TargetSetup({
  appId,
  accountId,
  target,
  connections,
}: {
  appId: number;
  accountId: string;
  target: CloudflareTargetSummary;
  connections: CloudflareConnection[];
}) {
  const access = useCloudflareRepoAccess({ appId, accountId });
  const workers = useCloudflareWorkers({ accountId });
  // Access arrives while the user is off in a browser, and Cloudflare gives
  // no sign of it there. Dyad comes forward so they know to come back.
  const wasBlocked = useRef(false);
  const hasAccess = access.data?.hasAccess;
  useEffect(() => {
    if (hasAccess === false) {
      wasBlocked.current = true;
    } else if (hasAccess === true && wasBlocked.current) {
      wasBlocked.current = false;
      ipc.system.focusWindow();
    }
  }, [hasAccess]);

  if (access.isLoading || workers.isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
        <Loader2 className="h-4 w-4 animate-spin" />
        Checking Cloudflare...
      </div>
    );
  }
  if (!access.data || !workers.data) {
    const error = access.error ?? workers.error;
    return error ? (
      <div className={errorClass}>{errorMessage(error)}</div>
    ) : null;
  }
  if (!access.data.hasAccess) {
    return (
      <RepoAccessPrompt
        githubInstallationsUrl={access.data.githubInstallationsUrl}
        onCheck={() => access.refetch()}
      />
    );
  }
  return (
    <WorkerForm
      appId={appId}
      accountId={accountId}
      target={target}
      workers={workers.data}
      inUseWorkerNames={connections
        .filter((connection) => connection.accountId === accountId)
        .map((connection) => connection.workerName)}
    />
  );
}

function RepoAccessPrompt({
  githubInstallationsUrl,
  onCheck,
}: {
  /** Where the repository is added to an install Cloudflare already has. */
  githubInstallationsUrl: string;
  /** Asks Cloudflare again right away. */
  onCheck: () => Promise<{ error: Error | null }>;
}) {
  // Only a check the user asked for shows progress and reports a failure.
  // The background poll keeps the prompt as it is, so a passing network
  // problem does not replace it with an error every few seconds.
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<Error | null>(null);
  const check = async () => {
    setChecking(true);
    setCheckError(null);
    try {
      const result = await onCheck();
      setCheckError(result.error);
    } finally {
      setChecking(false);
    }
  };
  return (
    <div className={warningClass} data-testid="cloudflare-repo-access">
      <p className="font-medium mb-1">
        Cloudflare needs access to this GitHub repository
      </p>
      <p>
        Click the button below to go to the Cloudflare dashboard. Then connect
        GitHub and grant access to this repository or to all repositories.
      </p>
      <div className="mt-3">
        <Button
          size="sm"
          onClick={() =>
            ipc.system.openExternalUrl(CLOUDFLARE_CONNECT_GITHUB_URL)
          }
        >
          Open Cloudflare Dashboard
        </Button>
      </div>
      <p className="mt-3">
        If Cloudflare is already connected to GitHub, give it access to this
        repository.
      </p>
      <div className="mt-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => ipc.system.openExternalUrl(githubInstallationsUrl)}
        >
          Manage Repository Access on GitHub
        </Button>
      </div>
      <div className="mt-3">
        <Button size="sm" variant="ghost" onClick={check} disabled={checking}>
          {checking ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <RefreshCw className="h-3 w-3" />
          )}
          Check Again
        </Button>
        {checkError && (
          <div
            className={`${errorClass} mt-2`}
            data-testid="cloudflare-repo-access-error"
          >
            {errorMessage(checkError)}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Worker
// ---------------------------------------------------------------------------

function WorkerForm({
  appId,
  accountId,
  target,
  workers,
  inUseWorkerNames,
}: {
  appId: number;
  accountId: string;
  target: CloudflareTargetSummary;
  workers: CloudflareWorkerSummary[];
  /** Workers another folder of this app already deploys to. */
  inUseWorkerNames: string[];
}) {
  // A Worker holds one script, so one already deployed from another folder is
  // not a choice here. It still counts as a taken name.
  const availableWorkers = workers.filter(
    (worker) => !inUseWorkerNames.includes(worker.name),
  );
  const suggestedExists = availableWorkers.some(
    (worker) => worker.name === target.suggestedWorkerName,
  );
  const [mode, setMode] = useState<"create" | "existing">(
    suggestedExists ? "existing" : "create",
  );
  const [newName, setNewName] = useState(
    suggestedExists ? "" : target.suggestedWorkerName,
  );
  const [existingName, setExistingName] = useState(
    suggestedExists ? target.suggestedWorkerName : "",
  );
  const [conflictRepo, setConflictRepo] = useState<string | null>(null);
  const connect = useConnectCloudflareWorker();

  const workerName = mode === "create" ? newName.trim() : existingName;
  const nameTaken =
    mode === "create" && workers.some((worker) => worker.name === workerName);
  const nameInvalid =
    mode === "create" && workerName !== "" && !isValidWorkerName(workerName);
  const canSubmit =
    workerName !== "" && !nameTaken && !nameInvalid && !connect.isPending;

  const submit = async (overwrite: boolean) => {
    try {
      const result = await connect.mutateAsync({
        appId,
        accountId,
        rootDirectory: target.rootDirectory,
        workerName,
        mode,
        overwrite,
      });
      setConflictRepo(
        result.status === "conflict" ? result.existingRepo : null,
      );
    } catch {
      // Shown below from the mutation's error.
    }
  };

  if (conflictRepo) {
    return (
      <div className={warningClass} data-testid="cloudflare-overwrite-prompt">
        <p className="font-medium mb-1">
          This Worker already deploys from GitHub
        </p>
        <p>
          "{workerName}" currently deploys from {conflictRepo}. Replacing that
          rule means it stops deploying from there and deploys this app instead.
        </p>
        <div className="flex gap-2 mt-3">
          <Button
            size="sm"
            variant="destructive"
            disabled={connect.isPending}
            onClick={() => submit(true)}
          >
            {connect.isPending && (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            )}
            Replace Rule
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={connect.isPending}
            onClick={() => setConflictRepo(null)}
          >
            Cancel
          </Button>
        </div>
        {connect.error && (
          <div className={`${errorClass} mt-3`}>
            {errorMessage(connect.error)}
          </div>
        )}
      </div>
    );
  }

  return (
    <form
      className="space-y-3"
      data-testid="cloudflare-worker-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSubmit) submit(false);
      }}
    >
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          variant={mode === "create" ? "default" : "outline"}
          onClick={() => setMode("create")}
        >
          Create new Worker
        </Button>
        <Button
          type="button"
          size="sm"
          variant={mode === "existing" ? "default" : "outline"}
          disabled={availableWorkers.length === 0}
          onClick={() => setMode("existing")}
        >
          Use existing Worker
        </Button>
      </div>

      {mode === "create" ? (
        <div>
          <Label
            htmlFor="cloudflare-worker-name"
            className="block text-sm font-medium mb-1"
          >
            Worker name
          </Label>
          <Input
            id="cloudflare-worker-name"
            data-testid="cloudflare-worker-name"
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            disabled={connect.isPending}
          />
          {nameTaken && (
            <p className="text-xs text-red-600 dark:text-red-400 mt-1">
              {inUseWorkerNames.includes(workerName)
                ? "Another folder of this app already deploys to this Worker. Each folder needs its own."
                : "A Worker with this name already exists. Pick another name or use the existing Worker."}
            </p>
          )}
          {nameInvalid && (
            <p className="text-xs text-red-600 dark:text-red-400 mt-1">
              Use lowercase letters, numbers and dashes, 63 characters at most.
            </p>
          )}
        </div>
      ) : (
        <div>
          <Label
            htmlFor="cloudflare-existing-worker"
            className="block text-sm font-medium mb-1"
          >
            Worker
          </Label>
          <Select
            value={existingName}
            onValueChange={(value) => setExistingName(value ?? "")}
            disabled={connect.isPending}
          >
            <SelectTrigger
              id="cloudflare-existing-worker"
              className="w-full"
              data-testid="cloudflare-worker-select"
            >
              <SelectValue placeholder="Select a Worker" />
            </SelectTrigger>
            <SelectContent>
              {availableWorkers.map((worker) => (
                <SelectItem key={worker.name} value={worker.name}>
                  {worker.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <Button type="submit" disabled={!canSubmit} className="w-full">
        {connect.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
        {connect.isPending ? "Setting Up Deployment..." : "Connect and Deploy"}
      </Button>
      <p className="text-xs text-gray-500 dark:text-gray-400">
        {deployTriggerText(target)}
      </p>

      {connect.error && (
        <div className={errorClass}>{errorMessage(connect.error)}</div>
      )}
    </form>
  );
}

// ---------------------------------------------------------------------------
// Deployment
// ---------------------------------------------------------------------------

const STATE_LABELS: Record<CloudflareDeploymentState, string> = {
  none: "No deployment yet",
  queued: "Deployment queued",
  building: "Deploying",
  live: "Live",
  failed: "Deployment failed",
  cancelled: "Deployment cancelled",
};

function DeploymentCard({
  appId,
  connection,
  targetLabel,
  hasConfig,
}: {
  appId: number;
  connection: CloudflareConnection;
  targetLabel: string;
  /** False once the folder's Wrangler config has left the branch. */
  hasConfig: boolean;
}) {
  const status = useCloudflareDeploymentStatus({
    appId,
    rootDirectory: connection.rootDirectory,
  });
  // The stored address until the status says what it is now.
  const workerUrl = status.data ? status.data.workerUrl : connection.workerUrl;
  const disconnect = useDisconnectCloudflareWorker();
  const state = status.data?.state;
  const inProgress = state !== undefined && isDeploymentInProgress(state);

  return (
    <div className="space-y-3" data-testid="cloudflare-deployment">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">
            {connection.workerName}
          </p>
          {workerUrl && (
            <button
              type="button"
              data-testid="cloudflare-worker-url"
              className="text-sm text-blue-600 dark:text-blue-400 hover:underline truncate max-w-full bg-transparent border-none p-0 cursor-pointer"
              onClick={() => ipc.system.openExternalUrl(workerUrl)}
            >
              {workerUrl}
            </button>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => ipc.system.openExternalUrl(connection.dashboardUrl)}
        >
          <ExternalLink className="h-4 w-4 mr-1" />
          Cloudflare
        </Button>
      </div>

      <div
        className="flex items-center gap-2 text-sm"
        data-testid="cloudflare-deployment-state"
      >
        {(status.isLoading || inProgress) && (
          <Loader2 className="h-4 w-4 animate-spin" />
        )}
        <span>
          {status.isLoading
            ? "Checking deployment..."
            : state
              ? STATE_LABELS[state]
              : "Deployment status unavailable"}
        </span>
        {status.data?.commitHash && (
          <span className="text-xs text-gray-500 dark:text-gray-400 font-mono">
            {status.data.commitHash.slice(0, 7)}
          </span>
        )}
      </div>

      {status.error && (
        <div className={errorClass}>{errorMessage(status.error)}</div>
      )}
      {status.data?.ruleMissing && (
        <div className={warningClass} data-testid="cloudflare-rule-missing">
          The rule that deploys {targetLabel} no longer exists on Cloudflare, so
          syncing does not deploy it. Disconnect {targetLabel} and connect it
          again to restore it.
        </div>
      )}
      {status.data?.ruleDeploys && (
        <div className={warningClass} data-testid="cloudflare-rule-elsewhere">
          This rule deploys {status.data.ruleDeploys}, which is not what this
          app syncs to now, so syncing does not deploy {targetLabel}. Disconnect{" "}
          {targetLabel} and connect it again to change that.
        </div>
      )}
      {status.data?.tokenRevoked && (
        <div className={warningClass} data-testid="cloudflare-token-revoked">
          The Cloudflare API token last used for this deployment was deleted or
          rolled. Disconnect Cloudflare under Settings &gt; Integrations, then
          add a new token here. Your Workers stay connected. Once a new token is
          added, this notice clears on the next deploy, when a sync next pushes
          a change to GitHub.
        </div>
      )}
      {state === "failed" && status.data && status.data.logTail.length > 0 && (
        <pre className="text-xs bg-gray-100 dark:bg-gray-800 rounded-md p-2 max-h-48 overflow-auto whitespace-pre-wrap">
          {status.data.logTail.join("\n")}
        </pre>
      )}

      {hasConfig && !status.data?.ruleDeploys && !status.data?.ruleMissing && (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {deployTriggerText({
            rootDirectory: connection.rootDirectory,
            label: targetLabel,
          })}
        </p>
      )}
      <Button
        variant="outline"
        size="sm"
        disabled={disconnect.isPending}
        onClick={() =>
          disconnect.mutate({
            appId,
            rootDirectory: connection.rootDirectory,
          })
        }
      >
        {disconnect.isPending
          ? "Disconnecting..."
          : `Disconnect ${targetLabel}`}
      </Button>
      {disconnect.error && (
        <div className={errorClass}>{errorMessage(disconnect.error)}</div>
      )}
    </div>
  );
}
