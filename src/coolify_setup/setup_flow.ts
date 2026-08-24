import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import type {
  HostKeyVerifier,
  SshSession,
  SshTarget,
} from "@/ipc/utils/ssh_client";
import { buildAdminCredentials } from "./admin_credentials";
import type { AdminCredentials } from "./admin_credentials";
import {
  installCoolify,
  preflight,
  waitForAdminSeeded,
  waitForDashboard,
} from "./install";
import { SshError } from "@/ipc/utils/ssh_client";
import { tryAutomaticAccess } from "./api_token";
import { plainUrlFor, tryEnableHttps } from "./https_setup";
import type { HttpsOutcome } from "./https_setup";

/**
 * Taking a bare server to a Coolify Dyad can deploy to.
 *
 * The order is not arbitrary: each step is the cheapest way to fail from where
 * it sits. Looking at the server costs a second and rules out the two problems
 * a user can fix immediately; installing costs minutes; and asking for a token
 * only makes sense once there is an instance to ask about.
 */

export type SetupStep =
  | "connecting"
  | "checking-server"
  | "installing"
  | "waiting-for-dashboard"
  | "verifying-account"
  | "securing"
  | "creating-token"
  | "done";

export interface SetupProgress {
  step: SetupStep;
  /** Installer output, forwarded so a long step does not look like a hang. */
  output?: string;
}

export interface SetupResult {
  dashboardUrl: string;
  /** Whether the address above is encrypted. */
  secure: boolean;
  /** Present when HTTPS was attempted and could not be had. */
  insecureReason?: string;
  credentials: AdminCredentials;
  /**
   * Absent when Coolify was installed but its API could not be opened.
   *
   * Not an error: the server is set up and usable either way, and the caller
   * asks for a token by hand rather than throwing away a working install.
   */
  token: string | null;
  version: string | null;
  /** Present when token is null, phrased for the user. */
  tokenUnavailableReason?: string;
}

/**
 * How long the after-a-failure question may take.
 *
 * It goes to a server that has just failed and may be frozen. The connection
 * now notices a peer that stops answering, but only after its own keepalive
 * has run out — minutes, against a question worth seconds. Bounded here so
 * the answer arrives while the failure it is about is still on screen.
 */
const RECOVERY_PROBE_TIMEOUT_MS = 15_000;

export interface SetupOptions {
  target: SshTarget;
  adminEmail: string;
  verifyHostKey: HostKeyVerifier;
  onProgress?: (progress: SetupProgress) => void;
  signal?: AbortSignal;
  /** Injected so the flow can be exercised without a server. */
  connect: (
    target: SshTarget,
    verify: HostKeyVerifier,
    signal?: AbortSignal,
  ) => Promise<SshSession>;
  waitForDashboardImpl?: typeof waitForDashboard;
  waitForAdminSeededImpl?: typeof waitForAdminSeeded;
  tryEnableHttpsImpl?: typeof tryEnableHttps;
  /** Bounded so a frozen server cannot hold the setup open. */
  recoveryProbeTimeoutMs?: number;
  /** A domain the user owns, used instead of one derived from the address. */
  customDomain?: string | null;
  /**
   * The account exists on the user's server from here on.
   *
   * Dyad invented this password and never showed it, so anything that fails
   * after this point and takes the password with it leaves the user locked out
   * of a Coolify that is installed and running. Called again once the address
   * settles, since HTTPS can change it.
   */
  onAccountKnown?: (account: {
    credentials: AdminCredentials;
    dashboardUrl: string;
  }) => void;
}

export async function runServerSetup({
  target,
  adminEmail,
  verifyHostKey,
  onProgress,
  signal,
  connect,
  onAccountKnown,
  recoveryProbeTimeoutMs = RECOVERY_PROBE_TIMEOUT_MS,
  waitForDashboardImpl = waitForDashboard,
  waitForAdminSeededImpl = waitForAdminSeeded,
  tryEnableHttpsImpl = tryEnableHttps,
  customDomain,
}: SetupOptions): Promise<SetupResult> {
  const report = (step: SetupStep, output?: string) =>
    onProgress?.({ step, output });

  report("connecting");
  const session = await connect(target, verifyHostKey, signal);

  try {
    report("checking-server");
    const checks = await preflight(session, { signal });
    if (!checks.ready) {
      throw new DyadError(
        checks.reason ?? "This server cannot be set up automatically.",
        DyadErrorKind.Precondition,
      );
    }

    const credentials = buildAdminCredentials(adminEmail);

    report("installing");
    try {
      await installCoolify(session, credentials, {
        signal,
        onOutput: (chunk) => report("installing", chunk),
      });
    } catch (error) {
      // The installer writes this password into Coolify's own .env and brings
      // the stack up partway through its run, so a failure after that point
      // leaves an account nobody else knows the password for — and preflight
      // refuses to install again once the container exists. Asked without the
      // signal, because a cancel is one of the ways to arrive here.
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const after = await Promise.race([
          preflight(session, {}),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error("The server did not answer.")),
              recoveryProbeTimeoutMs,
            );
          }),
        ]);
        if (after.alreadyInstalled) {
          onAccountKnown?.({
            credentials,
            dashboardUrl: plainUrlFor(target.host),
          });
        }
      } catch {
        // Nothing to add: the installer's own error is the one that matters.
      } finally {
        clearTimeout(timer);
      }
      throw error;
    }

    // Once the installer has finished, because only then is this password
    // certainly on the machine: install.sh writes it into Coolify's own .env
    // and the account is seeded from there. Before the checks below, because
    // every one of them can fail on a server that is running fine — the
    // dashboard poll runs on the user's side of their firewall — and Dyad is
    // the only thing that knows what it invented.
    onAccountKnown?.({
      credentials,
      dashboardUrl: plainUrlFor(target.host),
    });

    report("waiting-for-dashboard");
    const answered = await waitForDashboardImpl(target.host, { signal });
    if (!answered) {
      throw new DyadError(
        "Coolify was installed, but nothing answered on port 8000. That is " +
          "usually a firewall or security group blocking the port rather than " +
          "Coolify itself. Open it, then sign in at " +
          `${plainUrlFor(target.host)} — Coolify is already on the server, so ` +
          "starting over would be refused.",
        DyadErrorKind.External,
      );
    }

    // Waited for rather than checked once: the account is created by a startup
    // service that runs after the dashboard starts answering, so asking
    // immediately says no about a server that is only still starting.
    report("verifying-account");
    const seeded = await waitForAdminSeededImpl(session, credentials.email, {
      signal,
    });
    if (!seeded.seeded) {
      throw new DyadError(
        seeded.reason
          ? `Coolify would not create its admin account: ${seeded.reason}`
          : `Coolify has not created an admin account for ${credentials.email}. ` +
              `The server is installed — sign in at the address below to finish ` +
              `setting it up.`,
        DyadErrorKind.External,
      );
    }

    // Before the token, so what gets stored is the address the token will
    // travel to. It carries root abilities and goes over the wire on every
    // deploy, not once at setup, which is what makes plain HTTP worth this.
    report("securing");
    let https: HttpsOutcome;
    try {
      https = await tryEnableHttpsImpl(session, target.host, {
        customDomain,
        signal,
        onProgress: (message) => report("securing", message),
      });
    } catch (error) {
      // This improves a server that already works, so it must not be able to
      // throw one away. A domain left set with no certificate still leaves
      // port 8000 serving.
      if ((error as { kind?: string }).kind === "user_cancelled") throw error;
      https = {
        instanceUrl: plainUrlFor(target.host),
        secure: false,
        reason:
          error instanceof Error
            ? error.message
            : "HTTPS could not be set up on this server.",
      };
    }
    onAccountKnown?.({ credentials, dashboardUrl: https.instanceUrl });

    report("creating-token");
    const result: SetupResult = {
      dashboardUrl: https.instanceUrl,
      secure: https.secure,
      insecureReason: https.reason,
      credentials,
      token: null,
      version: null,
    };
    try {
      const access = await tryAutomaticAccess(session, credentials.email, {
        signal,
      });
      if (access) {
        result.token = access.token;
        result.version = access.version;
      } else {
        result.tokenUnavailableReason =
          "This version of Coolify could not be set up automatically.";
      }
    } catch (error) {
      // The install stands whatever happened here, so this reports rather than
      // throws: losing a working server because the last step failed would be
      // the worse outcome by far.
      if ((error as { kind?: string }).kind === "user_cancelled") throw error;
      // A lost link is reported as one. Handing back the transport's own
      // words would tell the user about a socket when what they need to know
      // is that the server stopped answering and the rest is theirs to do.
      result.tokenUnavailableReason =
        error instanceof SshError
          ? "Coolify did not answer while Dyad was opening its API."
          : error instanceof Error
            ? error.message
            : "Coolify's API could not be opened automatically.";
    }

    report("done");
    return result;
  } finally {
    session.end();
  }
}
