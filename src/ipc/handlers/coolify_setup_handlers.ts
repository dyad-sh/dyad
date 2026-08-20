import { BrowserWindow } from "electron";
import log from "electron-log";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { createTypedHandler } from "./base";
import {
  coolifySetupContracts,
  coolifySetupEvents,
} from "../types/coolify_setup";
import type { SetupServer, SetupSnapshot } from "../types/coolify_setup";
import { safeSend } from "../utils/safe_sender";
import { readSettings, writeSettings } from "@/main/settings";
import { connectSsh, trustOnFirstUse } from "../utils/ssh_client";
import type { SshSession } from "../utils/ssh_client";
import { ensureServerKey } from "@/coolify_setup/server_key";
import { preflight } from "@/coolify_setup/install";
import { runServerSetup } from "@/coolify_setup/setup_flow";
import { CoolifySetupController } from "@/coolify_setup/controller";
import { uuidIdSource } from "@/state_machines/clock";
import { isPlausibleAdminEmail } from "@/shared/coolify_admin_email";
import { IS_TEST_BUILD } from "../utils/test_utils";

const logger = log.scope("coolify_setup_handlers");

/**
 * How long looking at a server may take.
 *
 * Generous, because the probe runs on somebody else's machine and a slow one
 * is not a broken one — but bounded, because a wedged docker daemon never
 * answers at all and the button would spin for as long as the panel was open.
 */
const INSPECT_TIMEOUT_MS = 30_000;

/**
 * The setup, and everything anyone needs to know about it.
 *
 * Held here rather than per window, because the machine being set up is the
 * shared resource — and because an install outlives any one window. What is
 * going on is asked for, not remembered on the other side.
 */
let controller: CoolifySetupController | null = null;

function broadcastState(state: SetupSnapshot) {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      safeSend(window.webContents, coolifySetupEvents.changed.channel, state);
    }
  }
}

function setupController(): CoolifySetupController {
  controller ??= new CoolifySetupController({
    ids: uuidIdSource,
    onChanged: broadcastState,
    execute: (target, hooks) => {
      const key = ensureServerKey();
      return runServerSetup({
        target: targetFrom(target, key.privateKey),
        adminEmail: target.adminEmail,
        verifyHostKey: trustOnFirstUse(() => {}),
        customDomain: target.customDomain,
        signal: hooks.signal,
        connect: (t, verify, signal): Promise<SshSession> =>
          connectSsh(t, verify, { signal }),
        onProgress: ({ step, output }) => hooks.onProgress(step, output),
        // Written the moment the account exists rather than at the end. A
        // server whose dashboard never answers still has this account on it,
        // and Dyad is the only thing that knows the password it invented.
        onAccountKnown: ({ credentials, dashboardUrl }) => {
          writeSettings({
            coolify: {
              ...readSettings().coolify,
              adminEmail: credentials.email,
              adminPassword: { value: credentials.password },
              adminInstanceUrl: dashboardUrl,
            },
          });
        },
      }).then((result) => {
        // The account exists either way, so it is stored either way. Keeping
        // it only when a token was also minted discards the password in the
        // one case the user needs it — where they must sign in to Coolify and
        // make a token by hand, which is what the token failing means.
        writeSettings({
          coolify: {
            ...readSettings().coolify,
            adminEmail: result.credentials.email,
            adminPassword: { value: result.credentials.password },
            // Stored even when no token was minted: it names the server this
            // account is on, which is how connecting elsewhere later knows
            // the account does not come along.
            adminInstanceUrl: result.dashboardUrl,
            // The address and token go together: an address stored without a
            // token would read as an instance Dyad can talk to and cannot.
            ...(result.token
              ? {
                  instanceUrl: result.dashboardUrl,
                  accessToken: { value: result.token },
                }
              : {}),
          },
        });
        return {
          dashboardUrl: result.dashboardUrl,
          secure: result.secure,
          insecureReason: result.insecureReason ?? null,
          adminEmail: result.credentials.email,
          adminPassword: result.credentials.password,
          tokenStored: Boolean(result.token),
          tokenUnavailableReason: result.tokenUnavailableReason ?? null,
          version: result.version,
        };
      });
    },
  });
  return controller;
}

/**
 * The machine an address names, ignoring how it was written.
 *
 * One server has several valid spellings — http://1.2.3.4:8000 and the
 * https://1.2.3.4.sslip.io Dyad asks for a certificate under are the same
 * box — and treating them as different servers hides the credentials for the
 * one the user is looking at. Only ever used to decide what to show, so it
 * can afford to be generous.
 */
function serverIdentity(url: string): string {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^\[|\]$/g, "");
    // sslip.io spells an address as a name; the address is the identity.
    const derived = /^(.+)\.sslip\.io$/.exec(host);
    return derived ? derived[1] : host;
  } catch {
    return url.trim().toLowerCase();
  }
}

function sameServer(a: string | null | undefined, b: string | null): boolean {
  if (!a || b === null) return false;
  return serverIdentity(a) === serverIdentity(b);
}

/**
 * Which port to knock on.
 *
 * The form asks for an address rather than an address and a port, because a
 * server that has moved sshd is not the case this is for. Under an e2e build
 * the port is named by the environment, so a test can stand a server on one
 * it is allowed to bind — the same seam every other e2e-only behaviour here
 * goes through.
 */
function sshPort(input: SetupServer): number | undefined {
  const override = IS_TEST_BUILD ? process.env.DYAD_E2E_SSH_PORT : undefined;
  return override ? Number(override) : input.port;
}

function targetFrom(input: SetupServer, privateKey: string) {
  return {
    host: input.host.trim(),
    port: sshPort(input),
    username: input.username.trim(),
    privateKey,
  };
}

export function registerCoolifySetupHandlers() {
  createTypedHandler(coolifySetupContracts.getServerKey, async () => {
    const key = ensureServerKey();
    // Only the public half crosses to the renderer. The private half never
    // leaves the main process, the same rule the API token follows.
    return { publicKey: key.publicKey };
  });

  createTypedHandler(coolifySetupContracts.inspect, async (_, input) => {
    const key = ensureServerKey();
    let inspectTimer: ReturnType<typeof setTimeout> | undefined;
    let fingerprint: string | null = null;
    const session = await connectSsh(
      targetFrom(input, key.privateKey),
      trustOnFirstUse((fp) => {
        fingerprint = fp;
      }),
    );
    try {
      // Bounded, because nothing else bounds it: the probe asks docker, and a
      // wedged daemon never answers. Left unbounded the button span forever
      // and every retry leaked another connection.
      const checks = await Promise.race([
        preflight(session),
        new Promise<never>((_, reject) => {
          inspectTimer = setTimeout(
            () =>
              reject(
                new DyadError(
                  "The server did not answer. It is reachable over SSH, so " +
                    "something on it is not responding — try again in a moment.",
                  DyadErrorKind.External,
                ),
              ),
            INSPECT_TIMEOUT_MS,
          );
        }),
      ]);
      return {
        ready: checks.ready,
        reason: checks.reason ?? null,
        alreadyInstalled: checks.alreadyInstalled,
        memoryMb: checks.memoryMb,
        hostFingerprint: fingerprint,
      };
    } finally {
      clearTimeout(inspectTimer);
      session.end();
    }
  });

  // DO NOT LOG this handler: its result carries the generated admin password.
  createTypedHandler(coolifySetupContracts.run, async (_, input) => {
    // Checked before anything is done, because Coolify resolves the domain when
    // it seeds its admin and a rejected address leaves an install with no
    // account on it — minutes later, with nothing to show for them.
    if (!isPlausibleAdminEmail(input.adminEmail)) {
      throw new DyadError(
        "Enter an email address whose domain resolves. Coolify checks this " +
          "when it creates the admin account, and rejects addresses like " +
          "admin@example.test.",
        DyadErrorKind.Validation,
      );
    }
    // One at a time is the machine's rule, not a check here; it refuses by
    // throwing, and the panel shows that.
    return setupController().start(input).result;
  });

  createTypedHandler(coolifySetupContracts.snapshot, async () =>
    setupController().getState(),
  );

  createTypedHandler(coolifySetupContracts.dismiss, async () => {
    setupController().dismiss();
  });

  // DO NOT LOG this handler: it exists to return secrets.
  createTypedHandler(coolifySetupContracts.revealCredentials, async () => {
    // The user's own credentials for their own server, on their own machine.
    // Dyad generated the password on their behalf, so refusing to show it
    // would lock them out of something they own.
    const coolify = readSettings().coolify;
    // One server, described consistently. Dyad can hold details for two — an
    // instance connected by pasting a token, and a server it installed whose
    // token could not be minted — and pairing one's address with the other's
    // password reads as a way in that is not one.
    //
    // Connected wins when there is a live token, since that is the instance
    // Dyad is talking to. Otherwise the server Dyad installed does: its
    // password is the thing nothing else in the world knows.
    const liveToken = coolify?.accessToken?.value ?? null;
    const dashboardUrl =
      (liveToken
        ? coolify?.instanceUrl
        : (coolify?.adminInstanceUrl ?? coolify?.instanceUrl)) ?? null;
    const adminIsHere = sameServer(coolify?.adminInstanceUrl, dashboardUrl);
    const tokenIsHere = sameServer(coolify?.instanceUrl, dashboardUrl);
    return {
      dashboardUrl,
      adminEmail: adminIsHere ? (coolify?.adminEmail ?? null) : null,
      adminPassword: adminIsHere
        ? (coolify?.adminPassword?.value ?? null)
        : null,
      // A server described through its own address, with no token, is one
      // Dyad has just set up rather than one it used to talk to.
      isPreviousConnection: dashboardUrl !== null && tokenIsHere,
      // The one from before signing out, when there is no live one. Signing
      // back in is then a paste rather than a trip into Coolify to mint
      // another.
      apiToken: tokenIsHere
        ? (liveToken ?? coolify?.previousAccessToken?.value ?? null)
        : null,
    };
  });

  createTypedHandler(coolifySetupContracts.cancel, async () => {
    // Abandoning mid-install leaves whatever the installer had done on the
    // server. Nothing here tries to undo it: a half-installed Coolify is
    // something the user can see and remove, whereas a Dyad that started
    // deleting directories on their machine is not.
    logger.info("Cancelling Coolify server setup");
    setupController().cancel();
  });
}
