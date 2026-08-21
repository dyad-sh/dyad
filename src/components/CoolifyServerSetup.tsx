import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Copy, Check, ServerCog } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ipc } from "@/ipc/types";
import { SETUP_MACHINE_REPORTED } from "@/ipc/types/coolify_setup";
import type {
  SetupPreflight,
  SetupResult,
  SetupSnapshot,
  SetupStep,
} from "@/ipc/types";
import { showError } from "@/lib/toast";
import { queryKeys } from "@/lib/queryKeys";
import { isPlausibleAdminEmail } from "@/shared/coolify_admin_email";
import { isPlausibleInstanceDomain } from "@/shared/coolify_domain";
import { selectCoolifySetupCapabilities } from "@/coolify_setup/capabilities";

/**
 * Setting up a server that has nothing on it yet.
 *
 * The order on screen is the order the work has to happen in, and the first
 * step is the only manual one: nothing can reach the server until Dyad's key is
 * on it. Everything after that is Dyad's job, and the panel's remaining work is
 * to make a multi-minute install look like progress rather than a hang.
 */

const STEP_LABELS: Record<SetupStep, string> = {
  connecting: "Connecting to the server",
  "checking-server": "Checking the server",
  installing: "Installing Coolify",
  "waiting-for-dashboard": "Waiting for Coolify to start",
  "verifying-account": "Checking the admin account",
  securing: "Setting up HTTPS",
  "creating-token": "Setting up API access",
  done: "Done",
};

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(resetTimer.current), []);
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => {
        // A refused clipboard is worth saying out loud. This is often the
        // only copy of a password Dyad invented, and a button that quietly
        // does nothing reads as one that worked.
        navigator.clipboard
          .writeText(value)
          .then(() => {
            setCopied(true);
            clearTimeout(resetTimer.current);
            resetTimer.current = setTimeout(() => setCopied(false), 2000);
          })
          .catch(showError);
      }}
      aria-label={label}
    >
      {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
    </Button>
  );
}

export function CoolifyServerSetup({
  onUseExisting,
  children,
}: {
  /**
   * Leaves the installer for the screen that connects a Coolify that exists.
   *
   * Given the address when there is one, because after an install that could
   * not mint a token the next screen asks for the address of the server just
   * built — and leaving it blank means typing from memory.
   */
  onUseExisting: (instanceUrl?: string) => void;
  /** Sits under the form. Not under the run or the result, which have their
      own next step and nothing to add to. */
  children?: ReactNode;
}) {
  const queryClient = useQueryClient();
  const hostId = useId();
  const emailId = useId();
  const domainId = useId();
  const [host, setHost] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [customDomain, setCustomDomain] = useState("");

  // Kept with the address it was asked about. The answer arrives after a
  // round trip, and by then the address in the field may be a different
  // machine — whose Install button this verdict would then disable.
  const [inspection, setInspection] = useState<{
    host: string;
    checks: SetupPreflight;
  } | null>(null);
  const inspectionForHost =
    inspection && inspection.host === host.trim() ? inspection.checks : null;
  const logRef = useRef<HTMLDivElement | null>(null);

  const serverKey = useQuery({
    queryKey: queryKeys.coolify.serverKey,
    queryFn: () => ipc.coolifySetup.getServerKey(),
  });
  const publicKey = serverKey.data?.publicKey ?? null;

  // What is going on is asked for, not remembered. An install outlives this
  // screen — leaving it is invited, and a background refetch can replace it —
  // so anything kept here would be lost exactly when it mattered.
  const snapshot = useQuery({
    queryKey: queryKeys.coolify.setup,
    queryFn: () => ipc.coolifySetup.snapshot(),
  });
  const setup: SetupSnapshot = snapshot.data ?? { type: "idle" };
  // What the machine allows, asked once and answered the same way the
  // transition would. What the form allows — a usable address, a key that
  // could be read — stays below with the fields it is about.
  const can = selectCoolifySetupCapabilities(setup);

  // Pushed rather than polled, so the step and the log keep up with a run
  // this window did not start.
  useEffect(() => {
    return ipc.events.coolifySetup.onChanged((state) => {
      queryClient.setQueryData(queryKeys.coolify.setup, state);
    });
  }, [queryClient]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [setup]);

  const inspect = useMutation<SetupPreflight, Error, void>({
    mutationFn: async () => {
      const asked = host.trim();
      const checks = await ipc.coolifySetup.inspect({
        host: asked,
        username: "root",
      });
      setInspection({ host: asked, checks });
      return checks;
    },
    onError: (error) => showError(error),
  });

  const run = useMutation<SetupResult, Error, void>({
    mutationFn: () =>
      ipc.coolifySetup.run({
        host: host.trim(),
        username: "root",
        adminEmail,
        customDomain: customDomain.trim() || undefined,
      }),
    // What became of the run is read from the snapshot, which every window
    // gets. Nothing is done with the answer here: this window may not be the
    // one still watching by the time it arrives. Only a refusal to start —
    // one setup at a time — belongs to the caller.
    onError: (error) => {
      // Anything the machine took on is on screen already — a failure with
      // the installer's own words under it, or a cancel that correctly says
      // nothing went wrong — and it says so on the error. Everything else is
      // shown, because an error nobody reports is a button that does nothing:
      // a refusal that never started, and whatever the IPC layer turns down
      // before the handler is reached.
      const machineReported =
        (error as { code?: string }).code === SETUP_MACHINE_REPORTED;
      if (machineReported) return;
      showError(error);
    },
  });

  /** Puts the finished screen away and lets the panel behind catch up. */
  const leaveResult = async (instanceUrl?: string) => {
    // Refreshed before the screen is put away. Dismissing first hands the
    // panel back to a connector that still believes there is no token, so the
    // empty install form flashes up before the right screen arrives.
    await queryClient.invalidateQueries({ queryKey: queryKeys.coolify.all });
    // Told where to go before the screen is cleared. Dismissing first puts the
    // machine back to idle while the panel above still believes there is
    // nothing to enter, so the empty install form appears in between.
    onUseExisting(instanceUrl);
    await ipc.coolifySetup.dismiss().catch(showError);
  };

  const emailLooksUsable = !adminEmail || isPlausibleAdminEmail(adminEmail);
  const domainLooksUsable =
    !customDomain.trim() || isPlausibleInstanceDomain(customDomain);
  // --- Finished ---
  if (setup.type === "done") {
    const result = setup.result;
    return (
      <div className="space-y-3" data-testid="coolify-setup-done">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <ServerCog className="h-5 w-5" />
          Coolify is installed
        </div>
        {/* Dyad keeps these, so this is a copy rather than the only sight of
            them. Put here anyway: this is the moment they are needed. */}
        <div className="rounded-md border p-3 space-y-2 text-sm">
          <p className="font-medium">
            Save these now, or find them again under the server list.
          </p>
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">Address</span>
            <div className="flex items-center gap-2">
              <code className="text-xs">{result.dashboardUrl}</code>
              <CopyButton value={result.dashboardUrl} label="Copy address" />
            </div>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">Email</span>
            <div className="flex items-center gap-2">
              <code className="text-xs">{result.adminEmail}</code>
              <CopyButton value={result.adminEmail} label="Copy email" />
            </div>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">Password</span>
            <div className="flex items-center gap-2">
              <code className="text-xs" data-testid="coolify-setup-password">
                {result.adminPassword}
              </code>
              <CopyButton value={result.adminPassword} label="Copy password" />
            </div>
          </div>
        </div>
        {/* Only when it is true. Dyad asks for a certificate and usually gets
            one, so a standing warning would be noise — and a warning nobody
            sees when it matters is worse than one that appears only then. The
            token here carries root abilities and travels on every deploy, not
            once at setup. */}
        {!result.secure && (
          <div
            className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm"
            data-testid="coolify-setup-insecure"
          >
            <p className="font-medium">This server is not encrypted</p>
            <p className="text-muted-foreground">
              {result.insecureReason} Dyad will still work, but its access token
              crosses your network unencrypted every time it deploys. Adding a
              domain that points at this server fixes it.
            </p>
          </div>
        )}
        {result.tokenStored ? (
          <p className="text-sm text-muted-foreground">
            Dyad created its own API token, so you can pick a server and project
            next.
          </p>
        ) : (
          // The install stands; only the last step did not. Saying so plainly
          // beats implying the whole thing failed.
          <div
            className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm"
            data-testid="coolify-setup-manual-token"
          >
            <p className="font-medium">One step left, in Coolify</p>
            <p className="text-muted-foreground">
              {result.tokenUnavailableReason ??
                "Dyad could not create an API token automatically."}{" "}
              Open {result.dashboardUrl}, sign in with the details above, enable
              the API under Settings → Advanced, then create a token under
              Security → API Tokens and paste it in on the next screen.
            </p>
          </div>
        )}
        <Button
          onClick={() => void leaveResult(result.dashboardUrl)}
          data-testid="coolify-setup-continue"
        >
          Continue
        </Button>
      </div>
    );
  }

  // --- Running ---
  if (setup.type === "running") {
    return (
      <div className="space-y-3" data-testid="coolify-setup-running">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Loader2 className="h-4 w-4 animate-spin" />
          {STEP_LABELS[setup.step]}
        </div>
        <p className="text-sm text-muted-foreground">
          Installing takes a couple of minutes. Leaving this screen does not
          stop it.
        </p>
        {setup.log && (
          <div
            ref={logRef}
            className="max-h-48 overflow-y-auto rounded-md bg-muted p-2 font-mono text-xs whitespace-pre-wrap"
            data-testid="coolify-setup-log"
          >
            {setup.log}
          </div>
        )}
        <Button
          variant="outline"
          size="sm"
          disabled={!can.canCancel}
          onClick={() => {
            void ipc.coolifySetup.cancel().catch(showError);
          }}
          data-testid="coolify-setup-cancel"
        >
          {setup.stopping ? "Stopping…" : "Cancel"}
        </Button>
      </div>
    );
  }

  // --- Setting up ---
  return (
    <div className="space-y-3" data-testid="coolify-server-setup">
      <p className="text-sm text-muted-foreground">
        Dyad allows you to self-host an instance of Coolify to deploy your apps.
        To install it you need a Linux server with root access and about 2GB of
        memory. Easiest if you have not created the server yet, since the key
        below can go in at that point.
      </p>

      {/* First because nothing else can happen until it is done. */}
      <div className="space-y-1">
        <Label>1. Give your server this key</Label>
        {/* The provider's web form comes first because it is the path that
            needs no terminal: most hosts take an SSH key when the server is
            created, so this whole step can happen in a browser. Leading with
            authorized_keys made the easy route look like the footnote. */}
        <p className="text-xs text-muted-foreground">
          Easiest when creating the server: most hosts — DigitalOcean, Hetzner
          and others — have an <strong>SSH keys</strong> field on the create
          page. Paste this in there and the server will trust Dyad from the
          moment it starts.
        </p>
        <p className="text-xs text-muted-foreground">
          For a server that already exists, add it as a new line in{" "}
          <code>/root/.ssh/authorized_keys</code> on the server.
        </p>
        <div className="flex items-start gap-2">
          <code
            className="flex-1 break-all rounded-md bg-muted p-2 font-mono text-xs"
            data-testid="coolify-setup-public-key"
          >
            {publicKey ??
              (serverKey.isError ? "Could not read the key" : "Generating…")}
          </code>
          {publicKey ? (
            <CopyButton value={publicKey} label="Copy public key" />
          ) : (
            serverKey.isError && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => serverKey.refetch()}
              >
                Try again
              </Button>
            )
          )}
        </div>
      </div>

      <div>
        <Label htmlFor={hostId}>2. Server address</Label>
        <Input
          id={hostId}
          data-testid="coolify-setup-host"
          placeholder="203.0.113.5"
          value={host}
          onChange={(e) => {
            setHost(e.target.value);
            setInspection(null);
          }}
        />
      </div>

      <div>
        <Label htmlFor={emailId}>3. Email for the Coolify admin account</Label>
        <Input
          id={emailId}
          data-testid="coolify-setup-email"
          placeholder="you@yourdomain.com"
          value={adminEmail}
          onChange={(e) => setAdminEmail(e.target.value)}
        />
        {/* Checked while typing, because Coolify resolves the domain when it
            creates the account — and finding out afterwards costs the whole
            install. */}
        {!emailLooksUsable && (
          <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
            Coolify checks that the domain resolves, so addresses like
            admin@example.test are rejected. Use one you can receive mail at.
          </p>
        )}
        <p className="mt-1 text-xs text-muted-foreground">
          This is the account you would sign in to Coolify with.
        </p>
      </div>

      <div>
        <Label htmlFor={domainId}>4. Domain (optional)</Label>
        {/* Dyad can get a certificate without this, using a free service that
            turns an address into a name. Someone with their own domain is
            better off using it: it is theirs, and that free service shares one
            certificate allowance between everyone who uses it. */}
        <Input
          id={domainId}
          data-testid="coolify-setup-domain"
          placeholder="coolify.yourdomain.com"
          value={customDomain}
          onChange={(e) => setCustomDomain(e.target.value)}
        />
        {!domainLooksUsable && (
          <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
            Use just the domain, with no port or path — for example
            coolify.yourdomain.com.
          </p>
        )}
        <p className="mt-1 text-xs text-muted-foreground">
          Point it at this server first. Leave blank and Dyad will set up HTTPS
          using the server&apos;s address.
        </p>
      </div>

      {/* Kept after a failure, not only during the run. The failure message
          points at the installer's own output, and replacing the log with the
          form the moment it fails leaves nothing to point at. */}
      {/* One block, so Dismiss sits beside the message rather than inside the
          log — a connection or preflight refusal carries no output, and would
          otherwise have nothing to clear it. */}
      {setup.type === "failed" && !setup.cancelled && (
        <div className="space-y-1" data-testid="coolify-setup-failure">
          <div className="flex items-center justify-between gap-2">
            <p
              className="text-sm font-medium text-amber-600 dark:text-amber-400"
              data-testid="coolify-setup-failed-message"
            >
              {setup.message}
            </p>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void ipc.coolifySetup.dismiss().catch(showError)}
              data-testid="coolify-setup-dismiss-failure"
            >
              Dismiss
            </Button>
          </div>
          {setup.log && (
            <div
              className="max-h-48 overflow-y-auto rounded-md bg-muted p-2 font-mono text-xs whitespace-pre-wrap"
              data-testid="coolify-setup-failed-log"
            >
              {setup.log}
            </div>
          )}
        </div>
      )}

      {inspectionForHost && (
        <div
          className="rounded-md border p-3 text-sm space-y-1"
          data-testid="coolify-setup-inspection"
        >
          {inspectionForHost.hostFingerprint && (
            // Shown so someone who cares can compare it against their
            // provider's console before Dyad sends anything to the machine.
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">Server fingerprint</span>
              <code className="text-xs">
                {inspectionForHost.hostFingerprint}
              </code>
            </div>
          )}
          {inspectionForHost.memoryMb !== null && (
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">Memory</span>
              <span className="text-xs">{inspectionForHost.memoryMb} MB</span>
            </div>
          )}
          {!inspectionForHost.ready && (
            <p className="text-amber-600 dark:text-amber-400">
              {inspectionForHost.reason}
            </p>
          )}
        </div>
      )}

      {snapshot.isError && (
        <p
          className="text-sm text-amber-600 dark:text-amber-400"
          data-testid="coolify-setup-snapshot-error"
        >
          Could not read what Dyad is doing with servers right now.{" "}
          <button
            type="button"
            className="underline underline-offset-4"
            onClick={() => void snapshot.refetch()}
          >
            Try again
          </button>
        </p>
      )}

      <div className="flex gap-2">
        <Button
          variant="outline"
          disabled={!host.trim() || inspect.isPending}
          onClick={() => inspect.mutate()}
          data-testid="coolify-setup-inspect"
        >
          {inspect.isPending && (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          )}
          Check server
        </Button>
        <Button
          disabled={
            // Until the broadcast lands this window still shows the form, and
            // a second press is refused as a second setup.
            !can.canStart ||
            // Nothing is known yet about what the main process is doing, and
            // an install already running would refuse this press.
            snapshot.isPending ||
            snapshot.isError ||
            run.isPending ||
            serverKey.isError ||
            !host.trim() ||
            !adminEmail.trim() ||
            !emailLooksUsable ||
            !domainLooksUsable ||
            // Checked first, always. The check is what shows the user the
            // server's fingerprint, and installing without it means trusting
            // whatever answers the address with the admin password and a
            // token. It also catches an existing Coolify, too little memory
            // and a held package lock, which is a failed install either way.
            inspectionForHost?.ready !== true
          }
          onClick={() => run.mutate()}
          data-testid="coolify-setup-install"
        >
          Install Coolify
        </Button>
      </div>
      {!inspectionForHost && host.trim() && (
        <p className="text-sm text-muted-foreground">
          Check the server first. Dyad shows you its fingerprint, and installs
          only onto the machine that answered.
        </p>
      )}

      {children}
    </div>
  );
}
