import { useEffect, useState } from "react";
import { Copy, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCoolifyDeploy } from "@/hooks/useCoolifyDeploy";
import { useLoadApp } from "@/hooks/useLoadApp";
import { shouldProvisionDatabase } from "@/shared/coolify_provisioning";
import { getErrorMessage } from "@/lib/errors";

interface CoolifyConnectorProps {
  appId: number | null;
  hasGithubRepo: boolean;
}

const STAGE_LABELS: Record<string, string> = {
  preflight: "Checking access",
  push: "Pushing code",
  "provision-database": "Provisioning database",
  migrate: "Migrating schema",
  "create-application": "Creating application",
  deploy: "Deploying",
  finalize: "Finishing",
};

export function CoolifyConnector({
  appId,
  hasGithubRepo,
}: CoolifyConnectorProps) {
  const {
    status,
    isStatusLoading,
    snapshot,
    discovery,
    isDiscovering,
    discoveryError,
    refetchDiscovery,
    clearToken,
    isClearingToken,
    createProject,
    isCreatingProject,
    installSnapshot,
    install,
    saveToken,
    isSavingToken,
    generateSshKey,
    isGeneratingSshKey,
    regenerateSshKey,
    isRegeneratingSshKey,
    testSsh,
    isTestingSsh,
    sshTestResult,
    saveConnection,
    isSavingConnection,
    deploy,
    disconnect,
  } = useCoolifyDeploy(appId);

  const { app } = useLoadApp(appId);
  const [isReplacingKey, setIsReplacingKey] = useState(false);
  const [adminEmail, setAdminEmail] = useState("");
  const [instanceUrl, setInstanceUrl] = useState("");
  const [token, setToken] = useState("");
  const [serverUuid, setServerUuid] = useState("");
  const [projectUuid, setProjectUuid] = useState("");
  const [sshHost, setSshHost] = useState("");
  const [sshUser, setSshUser] = useState("root");
  const [sshPort, setSshPort] = useState("22");

  // A finished install already knows the address, so there is no reason to
  // make the user copy it across.
  useEffect(() => {
    if (
      installSnapshot.status === "succeeded" &&
      installSnapshot.dashboardUrl
    ) {
      setInstanceUrl((current) => current || installSnapshot.dashboardUrl!);
    }
  }, [installSnapshot.status, installSnapshot.dashboardUrl]);

  useEffect(() => {
    const c = status?.connection;
    if (c) {
      setInstanceUrl(c.instanceUrl);
      setServerUuid(c.serverUuid);
      setProjectUuid(c.projectUuid);
      setSshHost(c.sshHost);
      setSshUser(c.sshUser);
      setSshPort(String(c.sshPort));
    }
  }, [status?.connection]);

  if (appId === null || isStatusLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading...
      </div>
    );
  }
  if (!status) return null;

  if (!status.sshAvailable) {
    return (
      <p className="text-sm text-muted-foreground">
        Deploying with Coolify needs the OpenSSH client, which was not found on
        this machine.
      </p>
    );
  }

  const isDeploying = snapshot.status === "running";
  const willProvisionDatabase = shouldProvisionDatabase(app ?? {});

  // Shown from the very first step: the key has to be on the server before
  // Coolify is installed there, so asking for a URL and token first would put
  // the steps in the opposite order from how a server is actually set up.
  const replaceKeyDialog = (
    <AlertDialog open={isReplacingKey} onOpenChange={setIsReplacingKey}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Replace this SSH key?</AlertDialogTitle>
          <AlertDialogDescription>
            Servers that trust the current key will reject Dyad until the new
            one is added to them. The old key is kept in your SSH directory
            rather than deleted, so it stays available for any server still
            using it.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={async () => {
              try {
                await regenerateSshKey();
                toast.success("New key generated. Add it to your server.");
              } catch (err) {
                toast.error(err instanceof Error ? err.message : String(err));
              }
            }}
          >
            Replace
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  const sshKeySection = (
    <div className="space-y-2">
      {replaceKeyDialog}
      {!status.sshKeyExists ? (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            Start here. Dyad needs SSH access to your server to reach the
            database when applying schema changes, so add this key while you are
            setting the server up, before installing Coolify. It is separate
            from the API token.
          </p>
          <Button
            size="sm"
            onClick={() => generateSshKey()}
            disabled={isGeneratingSshKey}
          >
            {isGeneratingSshKey && (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            )}
            Generate SSH key
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          <Label>Add this key to your server</Label>
          <p className="text-xs text-muted-foreground">
            Append it to <code>~/.ssh/authorized_keys</code> on the server.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate rounded bg-muted px-2 py-1 text-xs">
              {status.sshPublicKey}
            </code>
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                await navigator.clipboard.writeText(status.sshPublicKey ?? "");
                toast.success("Public key copied");
              }}
            >
              <Copy className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={isRegeneratingSshKey}
              onClick={() => setIsReplacingKey(true)}
            >
              {isRegeneratingSshKey ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Replace"
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  );

  // --- Step 1: instance URL + API token ---
  if (!status.hasToken) {
    const isInstalling = installSnapshot.status === "running";
    return (
      <div className="space-y-3">
        {sshKeySection}

        <div className="rounded-md border border-border p-3 space-y-3">
          <div>
            <p className="text-sm font-medium">
              Don't have Coolify installed yet?
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Once the key above is on your server, Dyad can install Coolify for
              you over SSH. You will not need a terminal.
            </p>
          </div>
          <div>
            <Label htmlFor="install-email">Your email</Label>
            <Input
              id="install-email"
              type="email"
              placeholder="you@example.com"
              value={adminEmail}
              onChange={(e) => setAdminEmail(e.target.value)}
            />
            <p className="text-xs text-muted-foreground mt-1">
              Used to sign in to Coolify. Nothing is sent to it.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-2">
              <Label htmlFor="install-host">Server address</Label>
              <Input
                id="install-host"
                placeholder="203.0.113.7"
                value={sshHost}
                onChange={(e) => setSshHost(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="install-user">User</Label>
              <Input
                id="install-user"
                value={sshUser}
                onChange={(e) => setSshUser(e.target.value)}
              />
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={
              isInstalling ||
              !sshHost.trim() ||
              !adminEmail.trim() ||
              !status.sshKeyExists
            }
            onClick={async () => {
              try {
                await install({
                  adminEmail: adminEmail.trim(),
                  sshHost: sshHost.trim(),
                  sshUser: sshUser.trim() || "root",
                  sshPort: Number(sshPort) || 22,
                });
              } catch (err) {
                toast.error(err instanceof Error ? err.message : String(err));
              }
            }}
          >
            {isInstalling && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Install Coolify on this server
          </Button>

          {installSnapshot.status === "succeeded" &&
            installSnapshot.credentials && (
              <div className="rounded-md border border-green-300 bg-green-50 p-3 text-sm dark:border-green-800 dark:bg-green-950/40">
                <p className="font-medium">Coolify is installed.</p>
                <p className="mt-1 text-xs">
                  Sign in at{" "}
                  <a
                    href={installSnapshot.dashboardUrl ?? "#"}
                    target="_blank"
                    rel="noreferrer"
                    className="underline"
                  >
                    {installSnapshot.dashboardUrl}
                  </a>{" "}
                  with <code>{installSnapshot.credentials.email}</code> and the
                  password below, then create an API token under Keys &amp;
                  Tokens and paste it here.
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <code className="flex-1 truncate rounded bg-muted px-2 py-1 text-xs">
                    {installSnapshot.credentials.password}
                  </code>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={async () => {
                      await navigator.clipboard.writeText(
                        installSnapshot.credentials?.password ?? "",
                      );
                      toast.success("Password copied");
                    }}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Save this password somewhere safe. Dyad keeps a copy, but it
                  is the only way into the dashboard.
                </p>
              </div>
            )}

          {installSnapshot.status === "failed" && (
            <p className="text-sm text-red-600 dark:text-red-400">
              {installSnapshot.error}
            </p>
          )}

          {installSnapshot.log && (
            <pre className="max-h-40 overflow-auto rounded bg-muted p-2 text-xs whitespace-pre-wrap">
              {installSnapshot.log}
            </pre>
          )}
        </div>

        <p className="text-sm text-muted-foreground">
          Then install Coolify on that server and create an API token under Keys
          &amp; Tokens. It needs the <code>read</code>,{" "}
          <code>read:sensitive</code>, <code>write</code>, and{" "}
          <code>deploy</code> scopes.
        </p>
        <div>
          <Label htmlFor="coolify-url">Coolify URL</Label>
          <Input
            id="coolify-url"
            placeholder="http://203.0.113.7:8000"
            value={instanceUrl}
            onChange={(e) => setInstanceUrl(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="coolify-token">API token</Label>
          <Input
            id="coolify-token"
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
        </div>
        <Button
          size="sm"
          disabled={isSavingToken || !instanceUrl.trim() || !token.trim()}
          onClick={async () => {
            try {
              await saveToken({ instanceUrl: instanceUrl.trim(), token });
              setToken("");
              toast.success("Connected to Coolify");
            } catch (err) {
              toast.error(err instanceof Error ? err.message : String(err));
            }
          }}
        >
          {isSavingToken && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
          Connect
        </Button>
      </div>
    );
  }

  // --- Step 2: server, project, and SSH access ---
  if (!status.connection) {
    return (
      <div className="space-y-3">
        {sshKeySection}

        {discoveryError && (
          <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
            <p className="font-medium">Could not load servers and projects</p>
            <p className="mt-1">{getErrorMessage(discoveryError)}</p>
            <div className="mt-2 flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => refetchDiscovery()}
              >
                Retry
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={isClearingToken}
                onClick={async () => {
                  await clearToken();
                  toast.success("Coolify token cleared. Enter it again.");
                }}
              >
                {isClearingToken && (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                )}
                Re-enter token
              </Button>
            </div>
          </div>
        )}

        {!discoveryError && discovery && discovery.projects.length === 0 && (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
            <p>
              This Coolify instance has no projects yet. Create one to deploy
              into.
            </p>
            <Button
              size="sm"
              className="mt-2"
              disabled={isCreatingProject}
              onClick={async () => {
                try {
                  const project = await createProject("dyad");
                  setProjectUuid(project.uuid);
                  toast.success("Project created");
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : String(err));
                }
              }}
            >
              {isCreatingProject && (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              )}
              Create a project
            </Button>
          </div>
        )}

        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            Dyad cannot tell when servers or projects change in Coolify, so this
            list is cached. Refresh after adding one.
          </p>
          <Button
            variant="ghost"
            size="sm"
            disabled={isDiscovering}
            onClick={() => refetchDiscovery()}
          >
            {isDiscovering ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label>Server</Label>
            <Select
              value={serverUuid}
              onValueChange={(v) => {
                const uuid = v ?? "";
                setServerUuid(uuid);
                // Coolify already knows how to reach this server; reusing its
                // details keeps the tunnel pointed at the machine the database
                // is actually provisioned on.
                const server = discovery?.servers.find((s) => s.uuid === uuid);
                if (server?.ip) setSshHost(server.ip);
                if (server?.user) setSshUser(server.user);
                if (server?.port) setSshPort(String(server.port));
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select a server" />
              </SelectTrigger>
              <SelectContent>
                {(discovery?.servers ?? []).map((s) => (
                  <SelectItem key={s.uuid} value={s.uuid}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Project</Label>
            <Select
              value={projectUuid}
              onValueChange={(v) => setProjectUuid(v ?? "")}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select a project" />
              </SelectTrigger>
              <SelectContent>
                {(discovery?.projects ?? []).map((p) => (
                  <SelectItem key={p.uuid} value={p.uuid}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2">
            <p className="text-xs text-muted-foreground">
              These are filled in from the server you picked. Dyad connects over
              SSH to reach that server's database when applying schema changes,
              so they must point at the same machine.
            </p>
          </div>
          <div>
            <Label htmlFor="coolify-ssh-host">Server address (SSH)</Label>
            <Input
              id="coolify-ssh-host"
              placeholder="203.0.113.7"
              value={sshHost}
              onChange={(e) => setSshHost(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="coolify-ssh-user">SSH user</Label>
            <Input
              id="coolify-ssh-user"
              value={sshUser}
              onChange={(e) => setSshUser(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="coolify-ssh-port">SSH port</Label>
            <Input
              id="coolify-ssh-port"
              value={sshPort}
              onChange={(e) => setSshPort(e.target.value)}
            />
          </div>
        </div>

        {sshTestResult && !sshTestResult.ok && (
          <p className="text-sm text-red-600 dark:text-red-400">
            {sshTestResult.error}
          </p>
        )}

        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={isTestingSsh || !sshHost.trim()}
            onClick={async () => {
              const result = await testSsh({
                sshHost: sshHost.trim(),
                sshUser: sshUser.trim(),
                sshPort: Number(sshPort) || 22,
              });
              if (result.ok) toast.success("SSH connection OK");
            }}
          >
            {isTestingSsh && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Test SSH
          </Button>
          <Button
            size="sm"
            disabled={
              isSavingConnection ||
              !serverUuid ||
              !projectUuid ||
              !sshHost.trim()
            }
            onClick={async () => {
              try {
                await saveConnection({
                  serverUuid,
                  projectUuid,
                  environmentName: "production",
                  sshHost: sshHost.trim(),
                  sshUser: sshUser.trim(),
                  sshPort: Number(sshPort) || 22,
                });
                toast.success("Server connected");
              } catch (err) {
                toast.error(err instanceof Error ? err.message : String(err));
              }
            }}
          >
            Save
          </Button>
        </div>
      </div>
    );
  }

  // --- Step 3: deploy ---
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm">
          <span className="font-medium">
            {status.connection.sshUser}@{status.connection.sshHost}
          </span>
        </div>
        <Button variant="ghost" size="sm" onClick={() => disconnect()}>
          Disconnect
        </Button>
      </div>

      {!hasGithubRepo && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          Coolify deploys from a git repository. Connect this app to GitHub
          above first.
        </div>
      )}

      {willProvisionDatabase ? (
        <p className="text-sm text-muted-foreground">
          Coolify will host a Postgres database for this app on your server.
        </p>
      ) : app?.neonProjectId || app?.supabaseProjectId ? (
        <p className="text-sm text-muted-foreground">
          Coolify will host this app only. It keeps using the database it is
          already connected to.
        </p>
      ) : (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          This app has no database connected, so no DATABASE_URL will be
          provided. If its code expects one, the build will fail. Connect a
          database on the app details page first.
        </div>
      )}

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          disabled={isDeploying || !hasGithubRepo}
          onClick={async () => {
            try {
              await deploy();
            } catch (err) {
              toast.error(err instanceof Error ? err.message : String(err));
            }
          }}
        >
          {isDeploying ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              {STAGE_LABELS[snapshot.stage ?? ""] ?? "Deploying"}
            </>
          ) : (
            <>
              <RefreshCw className="h-4 w-4 mr-2" />
              Deploy
            </>
          )}
        </Button>
      </div>

      {snapshot.status === "succeeded" && snapshot.url && (
        <p className="text-sm text-green-700 dark:text-green-400">
          Deployed:{" "}
          <a
            href={snapshot.url}
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            {snapshot.url}
          </a>
        </p>
      )}
      {snapshot.status === "failed" && (
        <p className="text-sm text-red-600 dark:text-red-400">
          {snapshot.error}
        </p>
      )}
      {snapshot.log && (
        <pre className="max-h-48 overflow-auto rounded bg-muted p-2 text-xs whitespace-pre-wrap">
          {snapshot.log}
        </pre>
      )}
    </div>
  );
}
