import { useEffect, useId, useState } from "react";
import { ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
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
import { useLoadApp } from "@/hooks/useLoadApp";
import { useCoolifyDeploy } from "@/hooks/useCoolifyDeploy";
import { selectCoolifyDeployCapabilities } from "@/coolify_deploy/capabilities";
import { isHostMove } from "@/coolify_deploy/connection";
import { getErrorMessage } from "@/lib/errors";
import { COOLIFY_REQUIRED_SCOPES } from "@/shared/coolify_scopes";
import { coolifyInsecureWarning } from "@/coolify_deploy/insecure_warning";
import { normalizeCoolifyDomain } from "@/coolify_deploy/domain";
import {
  isSecureInstanceUrl,
  type CoolifyDeployStage,
} from "@/ipc/types/coolify";

/** Electron does not follow a plain target="_blank", so open it ourselves. */
function ExternalLinkText({ url }: { url: string }) {
  return (
    <a
      href={url}
      onClick={(e) => {
        e.preventDefault();
        ipc.system
          .openExternalUrl(url)
          .catch((error) => toast.error(getErrorMessage(error)));
      }}
      className="cursor-pointer underline inline-flex items-center gap-1"
      target="_blank"
      rel="noopener noreferrer"
    >
      {url}
      <ExternalLink className="h-3 w-3" />
    </a>
  );
}

const STAGE_LABELS: Record<CoolifyDeployStage, string> = {
  preparing: "Preparing",
  configuring: "Configuring",
  building: "Building",
};

/**
 * Connects an app to a Coolify instance the user already runs and deploys it.
 *
 * The database is untouched: whatever the app already uses keeps being used,
 * and its connection string is passed through to the deployed copy.
 */
export function CoolifyConnector({ appId }: { appId: number | null }) {
  const { app } = useLoadApp(appId);
  const {
    status,
    isStatusLoading,
    statusError,
    refetchStatus,
    discovery,
    discoveryError,
    isDiscovering,
    refetchDiscovery,
    snapshot,
    saveToken,
    clearToken,
    saveConnection,
    createProject,
    checkDomain,
    deploy,
    disconnect,
  } = useCoolifyDeploy(appId);

  const serverSelectId = useId();
  const projectSelectId = useId();
  const instanceUrlId = useId();
  const tokenId = useId();
  const newProjectId = useId();
  const domainId = useId();
  const [instanceUrl, setInstanceUrl] = useState("");
  // A saved connection otherwise hides the only form that can change the
  // server, project or domain — and the only way to sign out.
  const [isEditingConnection, setIsEditingConnection] = useState(false);
  const [token, setToken] = useState("");
  const [serverUuid, setServerUuid] = useState("");
  const [projectUuid, setProjectUuid] = useState("");
  const [domain, setDomain] = useState("");
  const [newProjectName, setNewProjectName] = useState("");
  const [acknowledgedInsecure, setAcknowledgedInsecure] = useState(false);

  // Keyed on appId as well as the connection: this component is not remounted
  // when the selected app changes, so an app with no connection has to clear
  // the fields rather than leave the previous app's server and project in a
  // form whose Save button would then attach them to the wrong app.
  useEffect(() => {
    const connection = status?.connection;
    setInstanceUrl(connection?.instanceUrl ?? status?.instanceUrl ?? "");
    setServerUuid(connection?.serverUuid ?? "");
    setProjectUuid(connection?.projectUuid ?? "");
    setDomain(connection?.domain ?? "");
  }, [appId, status?.connection, status?.instanceUrl]);

  // Only on an app change. Keying this to the connection would close the form
  // under the user whenever a background refetch handed back a new object.
  useEffect(() => {
    setIsEditingConnection(false);
  }, [appId, status?.hasToken]);

  // A query react-query has paused — the renderer is offline — is pending
  // with no data and no error, which is not a failure and must not read as
  // one. It is waiting, so it shows as waiting.
  if (appId === null || isStatusLoading || (!status && !statusError)) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading...
      </div>
    );
  }
  if (statusError) {
    // Rendering nothing here left the tab blank with no message and no way
    // back: the query does not retry, and nothing else surfaces its failure,
    // so the panel stayed empty until a remount. The discovery query beside
    // it has said so properly all along.
    return (
      <div
        className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200"
        data-testid="coolify-status-error"
      >
        <p className="font-medium">Could not read this app's Coolify setup</p>
        <p className="mt-1">{getErrorMessage(statusError)}</p>
        <Button
          variant="outline"
          size="sm"
          className="mt-2"
          onClick={() => refetchStatus()}
        >
          Try again
        </Button>
      </div>
    );
  }

  // Unreachable: the two branches above cover every state without data.
  if (!status) return null;

  const can = selectCoolifyDeployCapabilities(snapshot);
  const hasGithubRepo = Boolean(app?.githubOrg && app?.githubRepo);
  const insecureWarning = coolifyInsecureWarning({
    isHttps: Boolean(
      normalizeCoolifyDomain(domain)?.toLowerCase().startsWith("https:"),
    ),
    hasNeon: Boolean(app?.neonProjectId),
    hasSupabase: Boolean(app?.supabaseProjectId),
  });

  // --- Step 1: instance URL + API token ---
  if (!status.hasToken) {
    const trimmedUrl = instanceUrl.trim();
    // A stock Coolify serves plain HTTP until it has a domain and certificate,
    // so this is the common case rather than an unusual one.
    // A missing scheme is not an unencrypted address, and saying "not
    // encrypted" for one diagnoses the wrong problem. Note "host:8000" parses
    // with "host:" as its scheme, so parsing successfully is not enough — the
    // scheme has to be one we can actually talk to.
    let scheme: string | null = null;
    try {
      scheme = trimmedUrl ? new URL(trimmedUrl).protocol : null;
    } catch {
      scheme = null;
    }
    const hasUsableScheme = scheme === "http:" || scheme === "https:";
    const needsScheme = Boolean(trimmedUrl) && !hasUsableScheme;
    const isInsecure = hasUsableScheme && !isSecureInstanceUrl(trimmedUrl);
    return (
      <div className="space-y-3" data-testid="coolify-connector">
        <p className="text-sm text-muted-foreground">
          Deploy this app to a Coolify instance you run. In Coolify, enable the
          API under Settings → Advanced → API Access, then create a token under
          Security → API Tokens with these permissions:{" "}
          {COOLIFY_REQUIRED_SCOPES}. Coolify fixes a token's permissions when it
          is created, so granting all of them now avoids making another later.
        </p>
        <div>
          <Label htmlFor={instanceUrlId}>Coolify address</Label>
          <Input
            id={instanceUrlId}
            data-testid="coolify-instance-url"
            placeholder="https://coolify.example.com"
            value={instanceUrl}
            onChange={(e) => setInstanceUrl(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor={tokenId}>API token</Label>
          <Input
            id={tokenId}
            data-testid="coolify-token"
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
        </div>
        {needsScheme && (
          <p className="text-sm text-muted-foreground">
            Include the scheme, for example https://{trimmedUrl}.
          </p>
        )}
        {isInsecure && (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
            <p>
              This address is not encrypted, so anything on the network between
              you and the server can read what Dyad sends over it. That is not
              only the API token: deploying also uploads the SSH private key
              Coolify uses to clone your repository, and your database
              connection string with its password. Giving Coolify a domain and
              certificate avoids this.
            </p>
            <label className="mt-2 flex items-center gap-2">
              <Checkbox
                checked={acknowledgedInsecure}
                onCheckedChange={(checked) =>
                  setAcknowledgedInsecure(checked === true)
                }
              />
              <span>Connect anyway</span>
            </label>
          </div>
        )}
        <Button
          disabled={
            saveToken.isPending ||
            !trimmedUrl ||
            // The hint below already says this address cannot be used, so
            // offering a button that only reports the same thing again is a
            // round trip for nothing.
            needsScheme ||
            !token.trim() ||
            (isInsecure && !acknowledgedInsecure)
          }
          data-testid="coolify-save-token"
          onClick={async () => {
            try {
              await saveToken.mutateAsync({
                instanceUrl: trimmedUrl,
                token: token.trim(),
                acknowledgedInsecure,
              });
            } catch (error) {
              toast.error(getErrorMessage(error));
            }
          }}
        >
          {saveToken.isPending && (
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
          )}
          Connect
        </Button>
      </div>
    );
  }

  // --- Step 2: server, project, domain ---
  if (!status.connection || isEditingConnection) {
    const projects = discovery?.projects ?? [];
    // The only control that removes the stored instance URL and token. It used
    // to live solely inside the discovery-error card, so rotating a token or
    // moving to another instance meant first breaking discovery on purpose.
    const disconnectEverything = (
      <Button
        variant="ghost"
        size="sm"
        disabled={clearToken.isPending}
        onClick={async () => {
          try {
            await clearToken.mutateAsync();
            // The component is not remounted when the token goes, so without
            // this the form comes back holding the credential just revoked —
            // and pressing Connect would silently store it again, which is
            // the opposite of what signing out to rotate a token is for.
            setToken("");
            setAcknowledgedInsecure(false);
            toast.success(
              "Signed out of Coolify. Your apps keep their settings; enter a token to use them again.",
            );
          } catch (error) {
            toast.error(getErrorMessage(error));
          }
        }}
      >
        Sign out of Coolify
      </Button>
    );
    const duplicateProjectName = projects.some(
      (p) => p.name.toLowerCase() === newProjectName.trim().toLowerCase(),
    );
    return (
      <div className="space-y-3" data-testid="coolify-connector">
        {discoveryError && (
          <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
            <p className="font-medium">Could not load servers and projects</p>
            <p className="mt-1">{getErrorMessage(discoveryError)}</p>
            <div className="mt-2 flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={isDiscovering}
                onClick={() => refetchDiscovery()}
              >
                Try again
              </Button>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            Dyad cannot tell when servers or projects change in Coolify, so this
            list is cached. Refresh after adding one.
          </p>
          {/* Outside the error card: rotating a token or moving to another
              instance must not require breaking discovery first. */}
          <Button
            variant="ghost"
            size="sm"
            disabled={isDiscovering}
            aria-label="Refresh servers and projects"
            onClick={() => refetchDiscovery()}
          >
            {isDiscovering ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
          </Button>
        </div>

        <div className="flex justify-end gap-1">
          {isEditingConnection && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                // The prefill effect will not re-run, so put the saved values
                // back here or an abandoned edit sits in the form and the
                // next Save commits it.
                const saved = status.connection;
                setServerUuid(saved?.serverUuid ?? "");
                setProjectUuid(saved?.projectUuid ?? "");
                setDomain(saved?.domain ?? "");
                setIsEditingConnection(false);
              }}
            >
              Cancel
            </Button>
          )}
          {disconnectEverything}
        </div>

        {/* A project belongs to the Coolify instance, not to this app, so it
            is named and created on its own before anything is picked. */}
        {isEditingConnection &&
          status.connection &&
          isHostMove(
            {
              kind: "configured",
              serverUuid: status.connection.serverUuid,
              projectUuid: status.connection.projectUuid,
              environmentName: status.connection.environmentName,
              domain: status.connection.domain,
            },
            { serverUuid, projectUuid, environmentName: "production" },
          ) && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
              Moving this app leaves the application on its current server
              running, and Dyad stops tracking it. Deploying here builds a new
              one; removing the old one means going into Coolify.
            </div>
          )}

        <div className="flex items-end gap-2 rounded-md border p-3">
          <div className="flex-1">
            <Label htmlFor={newProjectId}>Create a project</Label>
            <Input
              id={newProjectId}
              placeholder="Name for a new project"
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
            />
            {duplicateProjectName && (
              <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                A project called “{newProjectName.trim()}” already exists.
              </p>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={
              createProject.isPending ||
              !newProjectName.trim() ||
              duplicateProjectName
            }
            onClick={async () => {
              try {
                const project = await createProject.mutateAsync(
                  newProjectName.trim(),
                );
                setProjectUuid(project.uuid);
                setNewProjectName("");
                toast.success("Project created");
              } catch (error) {
                toast.error(getErrorMessage(error));
              }
            }}
          >
            {createProject.isPending && (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            )}
            Create
          </Button>
        </div>

        {!isDiscovering &&
          !discoveryError &&
          (discovery?.servers ?? []).length === 0 && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
              This Coolify instance has no servers Dyad can see. Add one in
              Coolify under Servers, then refresh.
            </div>
          )}

        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label htmlFor={serverSelectId}>Server</Label>
            <Select
              value={serverUuid}
              onValueChange={(value) => setServerUuid(value ?? "")}
            >
              <SelectTrigger
                id={serverSelectId}
                data-testid="coolify-server-select"
              >
                {/* Base UI renders the raw value unless given a formatter. */}
                <SelectValue>
                  {(value) =>
                    discovery?.servers.find((s) => s.uuid === value)?.name ??
                    // Discovery may be failing or still loading, and reading
                    // "Select a server" over a saved one looks like the
                    // connection was forgotten.
                    (value ? "Server already selected" : "Select a server")
                  }
                </SelectValue>
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
            <Label htmlFor={projectSelectId}>Project</Label>
            <Select
              value={projectUuid}
              onValueChange={(value) => setProjectUuid(value ?? "")}
            >
              <SelectTrigger
                id={projectSelectId}
                data-testid="coolify-project-select"
              >
                <SelectValue>
                  {(value) =>
                    projects.find((p) => p.uuid === value)?.name ??
                    (value ? "Project already selected" : "Select a project")
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {projects.map((p) => (
                  <SelectItem key={p.uuid} value={p.uuid}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div>
          <Label htmlFor={domainId}>Domain (optional)</Label>
          <Input
            id={domainId}
            placeholder="app.example.com"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Point an A record at your server first. Left empty, Coolify
            generates an address for you over plain HTTP.
          </p>
          {insecureWarning !== "none" && (
            <div
              className={
                insecureWarning === "breaks"
                  ? "mt-2 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200"
                  : "mt-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
              }
              data-testid="coolify-insecure-auth-warning"
            >
              {insecureWarning === "breaks" ? (
                <p>
                  <strong>
                    Without HTTPS, this app will not work once deployed.
                  </strong>{" "}
                  Neon Auth needs an encrypted connection, and the page will
                  fail to load rather than degrade. Give this app an https://
                  domain — the generated address is plain HTTP, and so is a
                  domain entered as http://.
                </p>
              ) : (
                <p>
                  Without HTTPS the app is served in the clear, so anything your
                  users type — including passwords — can be read by anything on
                  the network between them and the server. The generated address
                  is plain HTTP, and so is a domain entered as http://.
                </p>
              )}
            </div>
          )}
        </div>

        <Button
          disabled={
            saveConnection.isPending ||
            checkDomain.isPending ||
            !serverUuid ||
            !projectUuid ||
            !can.canEditConnection
          }
          data-testid="coolify-save-connection"
          onClick={async () => {
            try {
              const trimmed = domain.trim();
              // Whether a domain may be cleared is the handler's to answer:
              // it turns on whether an application exists in Coolify, which
              // the status contract does not carry. A copy here was wrong
              // twice — first missing the moving case, then missing the
              // never-provisioned one — so there is no copy. The catch below
              // surfaces the handler's message.
              // Checked before saving, because a save that succeeds should not
              // then be followed by a lookup the user waits on. Reported only
              // after, because every one of these warnings says the connection
              // was saved anyway — and the save can still be refused, by an
              // invalid domain or by a deploy that started in another window.
              // Announcing "saved anyway" and then "not saved" leaves the user
              // to work out which of the two toasts to believe.
              let warn: (() => void) | null = null;
              if (trimmed) {
                // Advisory only: if the check itself fails, say so and still
                // let the user save rather than trapping them behind it.
                try {
                  const dns = await checkDomain.mutateAsync({
                    serverUuid,
                    domain: trimmed,
                  });
                  // Only speak up about something actually detected: an
                  // "unknown" verdict means the check could not run, and a
                  // warning that appears when nothing is wrong gets ignored.
                  //
                  // The deploy itself succeeds; it is HTTPS that breaks, so
                  // say that rather than implying the build fails.
                  const consequence =
                    "The app will still deploy, but HTTPS will not work.";
                  if (dns.verdict === "points-elsewhere") {
                    warn = () =>
                      toast.warning(
                        `${dns.hostname} points at ${dns.actualIps.join(", ")}, not your server at ${dns.expectedIp}.`,
                        {
                          description: `${consequence} Saved anyway; point it at ${dns.expectedIp} and redeploy.`,
                        },
                      );
                  } else if (dns.verdict === "no-records") {
                    warn = () =>
                      toast.warning(`${dns.hostname} has no DNS record yet.`, {
                        description: `${consequence} Saved anyway; point a DNS record at ${dns.expectedIp} and redeploy.`,
                      });
                  }
                } catch {
                  warn = () =>
                    toast.warning(
                      `Could not check where ${trimmed} points; saved anyway.`,
                    );
                }
              }
              await saveConnection.mutateAsync({
                serverUuid,
                projectUuid,
                environmentName: "production",
                domain: trimmed || null,
              });
              warn?.();
              // Only now: a failed save has to leave the form open with the
              // user's edits still in it.
              setIsEditingConnection(false);
            } catch (error) {
              toast.error(getErrorMessage(error));
            }
          }}
        >
          {(saveConnection.isPending || checkDomain.isPending) && (
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
          )}
          Save
        </Button>
      </div>
    );
  }

  // --- Step 3: deploy ---
  const serverName =
    discovery?.servers.find((s) => s.uuid === status.connection!.serverUuid)
      ?.name ?? "server";
  const projectName =
    discovery?.projects.find((p) => p.uuid === status.connection!.projectUuid)
      ?.name ?? "project";

  // Only once discovery has actually answered. A slow or failing lookup says
  // nothing about where this app belongs, and treating it as an answer would
  // tell people their connection had moved every time the network hiccuped.
  const belongsElsewhere =
    !isDiscovering &&
    !discoveryError &&
    Boolean(discovery) &&
    !discovery!.servers.some((s) => s.uuid === status.connection!.serverUuid);

  return (
    <div className="space-y-3" data-testid="coolify-connector">
      {belongsElsewhere && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          <p>
            <strong>This app belongs to a different Coolify.</strong> The server
            it deploys to is not on the instance you are connected to now, so
            its application is still running wherever it was — this is kept, not
            lost. Connect back to that instance and it works again, or press
            Edit to move this app here.
          </p>
        </div>
      )}
      <div className="flex items-center justify-between">
        <div className="text-sm">
          <div className="font-medium">
            {serverName} / {projectName}
          </div>
          {status.appUrl ? (
            <ExternalLinkText url={status.appUrl} />
          ) : status.connection.domain ? (
            <span className="text-muted-foreground">
              {status.connection.domain} — live once deployed
            </span>
          ) : (
            <span className="text-muted-foreground">
              No domain set, so Coolify generates an address on first deploy
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {/* Without this the server, project and domain are write-once, and
              changing one means disconnecting — which forgets the Coolify
              application and leaves the running one behind. */}
          <Button
            variant="ghost"
            size="sm"
            disabled={!can.canEditConnection}
            onClick={() => setIsEditingConnection(true)}
          >
            Edit
          </Button>
          {/* Confirmed because it throws away something the user cannot type
              back in: the id of the application running on their server.
              Reconnecting builds a second one beside it. NeonConnector guards
              its equivalent the same way. Saving a different server or
              project has the same effect and is warned about in the form
              rather than confirmed, since choosing another server is already
              a deliberate statement about where the app should run. */}
          <AlertDialog>
            <AlertDialogTrigger
              className={buttonVariants({ variant: "ghost", size: "sm" })}
            >
              Disconnect
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  Disconnect this app from Coolify?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {snapshot.type === "running"
                    ? "This also abandons the deployment currently running. "
                    : null}
                  The application keeps running on your server, but Dyad forgets
                  how to reach it. Connecting this app again builds a second one
                  beside it, and the two will compete for the same domain.
                  Removing the first means going into Coolify.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep it connected</AlertDialogCancel>
                <AlertDialogAction
                  disabled={disconnect.isPending}
                  onClick={(event) => {
                    // Held open until the clearing settles: the dialog is the
                    // only thing stopping a second disconnect, an edit, or a
                    // deploy against an app being cleared.
                    event.preventDefault();
                    void disconnect
                      .mutateAsync()
                      .catch((error) => toast.error(getErrorMessage(error)));
                  }}
                >
                  {disconnect.isPending && (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  )}
                  Disconnect
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      {!hasGithubRepo && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          Coolify deploys from a git repository. Connect this app to GitHub
          first.
        </div>
      )}

      <Button
        size="sm"
        disabled={!can.canDeploy || !hasGithubRepo || belongsElsewhere}
        data-testid="coolify-deploy"
        onClick={async () => {
          try {
            await deploy.mutateAsync();
          } catch (error) {
            toast.error(getErrorMessage(error));
          }
        }}
      >
        {snapshot.type === "running" ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
            {STAGE_LABELS[snapshot.stage]}
          </>
        ) : (
          <>
            <RefreshCw className="h-4 w-4 mr-2" />
            Deploy
          </>
        )}
      </Button>

      {status.lastDeployedAt !== null && snapshot.type !== "running" && (
        <p className="text-xs text-muted-foreground">
          Last deployed {new Date(status.lastDeployedAt).toLocaleString()}
        </p>
      )}
      {snapshot.type === "succeeded" && snapshot.url && (
        <p className="text-sm text-green-700 dark:text-green-400">
          Deployed: <ExternalLinkText url={snapshot.url} />
        </p>
      )}
      {snapshot.type === "failed" && (
        <p className="text-sm text-red-600 dark:text-red-400">
          {snapshot.error}
        </p>
      )}
      {snapshot.type !== "idle" && snapshot.log && (
        <pre className="max-h-48 overflow-auto rounded bg-muted p-2 text-xs whitespace-pre-wrap">
          {snapshot.log}
        </pre>
      )}
    </div>
  );
}
