import { BrowserWindow } from "electron";
import log from "electron-log";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { createTypedHandler } from "./base";
import {
  SETUP_MACHINE_REPORTED,
  coolifySetupContracts,
  coolifySetupEvents,
} from "../types/coolify_setup";
import type { SetupServer, SetupSnapshot } from "../types/coolify_setup";
import { safeSend } from "../utils/safe_sender";
import { readSettings, writeSettings } from "@/main/settings";
import {
  SshError,
  connectSsh,
  expectFingerprint,
  trustOnFirstUse,
} from "../utils/ssh_client";
import type { SshSession } from "../utils/ssh_client";
import { ensureServerKey } from "@/coolify_setup/server_key";
import { preflight } from "@/coolify_setup/install";
import { runServerSetup } from "@/coolify_setup/setup_flow";
import { CoolifySetupController } from "@/coolify_setup/controller";
import { uuidIdSource } from "@/state_machines/clock";
import { isPlausibleAdminEmail } from "@/shared/coolify_admin_email";
import { isPlausibleInstanceDomain } from "@/shared/coolify_domain";
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

/**
 * What the last look at each server saw its host key to be.
 *
 * The panel shows this fingerprint and asks the user to commit to a
 * minutes-long install on the strength of it, so the install talks to the
 * machine they were shown rather than to whatever answers that address by the
 * time it starts. Held here rather than sent through the renderer, which
 * would make it something the caller could choose.
 */
const inspectedFingerprints = new Map<string, string>();

/**
 * The servers a check got through and liked.
 *
 * Separate from the pin above because the two do not come and go together: a
 * server that was ready and has since had Coolify put on it loses its pass
 * while the key it showed still stands. Both are written once a check has
 * finished, so a pass here always belongs to the key recorded there.
 */
const readyHosts = new Set<string>();

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
      // Trust on first use only when there has been no first use. A server
      // that was looked at is held to what it showed then.
      const pinned = inspectedFingerprints.get(serverKeyFor(target));
      /**
       * What the account write could not store, if it could not store it.
       *
       * A run that then fails takes the only copy of the password with it:
       * the failed screen carries a message and a log, and the call never
       * returns the result that shows it. So it is tried once more where it
       * starts to matter, which turns a keychain that was briefly busy into
       * nothing at all.
       */
      let unsavedAccount: {
        credentials: { email: string; password: string };
        dashboardUrl: string;
      } | null = null;
      return runServerSetup({
        target: targetFrom(target, key.privateKey),
        adminEmail: target.adminEmail,
        verifyHostKey: pinned
          ? expectFingerprint(pinned)
          : trustOnFirstUse((fp) => {
              inspectedFingerprints.set(serverKeyFor(target), fp);
            }),
        customDomain: target.customDomain,
        signal: hooks.signal,
        connect: (t, verify, signal): Promise<SshSession> =>
          connectSsh(t, verify, { signal }),
        onProgress: ({ step, output }) => hooks.onProgress(step, output),
        // Written the moment the account exists rather than at the end. A
        // server whose dashboard never answers still has this account on it,
        // and Dyad is the only thing that knows the password it invented.
        onAccountKnown: ({ credentials, dashboardUrl }) => {
          try {
            writeSettings({
              coolify: {
                ...readSettings().coolify,
                admin: {
                  email: credentials.email,
                  password: { value: credentials.password },
                  instanceUrl: dashboardUrl,
                },
              },
            });
            unsavedAccount = null;
          } catch (error) {
            // The account exists on the server whatever happened here, and a
            // second attempt is refused because Coolify is now installed. The
            // finished screen still shows the password, so ending the run
            // over this would throw away the only copy of it.
            unsavedAccount = { credentials, dashboardUrl };
            logger.error("Could not store the admin account", error);
          }
        },
      })
        .catch((error: unknown) => {
          // The run is ending badly, so this is the last chance to keep a
          // password nothing else holds. Guarded, because a write that fails
          // again must not become the failure the user is told about.
          if (unsavedAccount) {
            try {
              writeSettings({
                coolify: {
                  ...readSettings().coolify,
                  admin: {
                    email: unsavedAccount.credentials.email,
                    password: {
                      value: unsavedAccount.credentials.password,
                    },
                    instanceUrl: unsavedAccount.dashboardUrl,
                  },
                },
              });
            } catch (retryError) {
              logger.error("Could not store the admin account", retryError);
            }
          }
          // A key that does not match is not the user declining, and reporting
          // it as one would file it as a cancellation and say nothing.
          if (
            pinned &&
            error instanceof SshError &&
            error.failure === "host-key-rejected"
          ) {
            throw new DyadError(
              "This server is not the one Dyad looked at: its SSH identity " +
                "has changed since. Nothing was sent to it. Check the address " +
                "and look at the server again before installing.",
              DyadErrorKind.External,
            );
          }
          throw error;
        })
        .then((result) => {
          let stored = true;
          // The account exists either way, so it is stored either way. Keeping
          // it only when a token was also minted discards the password in the
          // one case the user needs it — where they must sign in to Coolify and
          // make a token by hand, which is what the token failing means.
          try {
            writeSettings({
              coolify: {
                ...readSettings().coolify,
                admin: {
                  email: result.credentials.email,
                  password: { value: result.credentials.password },
                  // Stored even when no token was minted, because then it is
                  // the only thing naming the server this account is on.
                  instanceUrl: result.dashboardUrl,
                },
                // The address and token go together: an address stored without a
                // token would read as an instance Dyad can talk to and cannot.
                // Stored without the acknowledgement `coolify:save-token`
                // demands for an unencrypted address. Not an oversight and
                // not a decision this path can make honestly: whether HTTPS
                // was possible is only known once the install has run, so
                // asking here is asking after the fact. The finished screen
                // says the server is not encrypted, and asking beforehand —
                // for the addresses that can never have a certificate — is a
                // change of its own rather than a line here.
                ...(result.token
                  ? {
                      instanceUrl: result.dashboardUrl,
                      accessToken: { value: result.token },
                    }
                  : {}),
              },
            });
          } catch (error) {
            // Same reason as the write above: the server is set up, a retry is
            // refused because Coolify is on it now, and the screen this
            // returns to is where the password is shown.
            stored = false;
            logger.error("Could not store the finished setup", error);
          }
          return {
            dashboardUrl: result.dashboardUrl,
            secure: result.secure,
            insecureReason: result.insecureReason ?? null,
            adminEmail: result.credentials.email,
            adminPassword: result.credentials.password,
            tokenStored: stored && Boolean(result.token),
            tokenUnavailableReason: stored
              ? (result.tokenUnavailableReason ?? null)
              : "Dyad could not save these details on this computer. Copy the " +
                "password below before leaving this screen.",
            version: result.version,
          };
        });
    },
  });
  return controller;
}

/**
 * The key a server's fingerprint and verdict are remembered under.
 *
 * The port is part of it: two services on one address are two servers, and
 * holding the second to the first one's key would refuse a valid one. Built
 * from the address as typed rather than by parsing it as a URL, which a bare
 * address is not — `fe80::1` parses as the scheme `fe80:` and leaves no
 * hostname at all, so every address shaped that way would share one entry.
 */
function serverKeyFor(input: SetupServer): string {
  const host = input.host
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  return `${host}:${sshPort(input) ?? 22}`;
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

/** Test-only: the pin map and the controller both outlive a single case. */
export function resetCoolifySetupStateForTests(): void {
  inspectedFingerprints.clear();
  readyHosts.clear();
  // Cancelled before disposed: disposing stops the controller talking, it does
  // not stop what it started, and a run left going would go on writing
  // settings while the next case is watching them.
  controller?.cancel();
  controller?.dispose();
  controller = null;
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
      // Only remembered here. What is recorded is decided once the check has
      // finished, so the key and the verdict cannot disagree.
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
      // Both together, and only now. Recording the key during the handshake
      // left a check that then failed with the new machine's key beside the
      // old machine's pass, which is an install onto a server nobody looked
      // at. A check that does not finish changes neither, so what stands is
      // whatever the last finished check said.
      if (fingerprint) {
        inspectedFingerprints.set(serverKeyFor(input), fingerprint);
      }
      // Kept only while the answer stands: a server that was ready and has
      // since had Coolify put on it must not keep an old pass.
      if (checks.ready) readyHosts.add(serverKeyFor(input));
      else readyHosts.delete(serverKeyFor(input));
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
    if (input.customDomain && !isPlausibleInstanceDomain(input.customDomain)) {
      throw new DyadError(
        "Enter the domain on its own, with no port or path — for example " +
          "coolify.yourdomain.com.",
        DyadErrorKind.Validation,
      );
    }
    if (!readyHosts.has(serverKeyFor(input))) {
      throw new DyadError(
        "Check the server before installing. Dyad shows you its fingerprint " +
          "first, so the install goes to the machine that answered rather " +
          "than to whatever holds the address by then.",
        DyadErrorKind.Precondition,
      );
    }
    // One at a time is the machine's rule, not a check here; it refuses by
    // throwing, and the panel shows that. Outside the try on purpose: that
    // refusal is the machine declining to start, so it must not be marked as
    // something the machine is already showing.
    const run = setupController().start(input);
    try {
      return await run.result;
    } catch (error) {
      // Awaited only to mark it: the machine recorded this before rethrowing,
      // so the panel is already showing it and a toast would be the same news
      // twice. Everything above never got that far and stays unmarked, which
      // is what makes it speak.
      if (
        typeof error === "object" &&
        error !== null &&
        Object.isExtensible(error) &&
        !("code" in error)
      ) {
        Object.assign(error, { code: SETUP_MACHINE_REPORTED });
      }
      throw error;
    }
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
    // Each with the address it belongs to, rather than one address over both.
    // They are usually the same server and occasionally not, and handing back
    // a single address would mean deciding which one it is — a decision that
    // shows one server's password under another's address when it guesses
    // wrong. Kept apart, there is nothing to guess.
    return {
      instance: coolify?.instanceUrl
        ? {
            url: coolify.instanceUrl,
            apiToken: coolify.accessToken?.value ?? null,
          }
        : null,
      server: coolify?.admin
        ? {
            url: coolify.admin.instanceUrl,
            email: coolify.admin.email,
            password: coolify.admin.password?.value ?? null,
          }
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
