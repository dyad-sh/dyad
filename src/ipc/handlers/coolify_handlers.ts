import { BrowserWindow } from "electron";
import { eq } from "drizzle-orm";
import log from "electron-log";
import { createHash } from "node:crypto";
import { db } from "../../db";
import { apps } from "../../db/schema";
import { resolveBoth } from "../utils/dns_resolve";
import { readSettings, writeSettings } from "../../main/settings";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { FORGOTTEN_COOLIFY } from "@/lib/schemas";
import {
  getClient,
  readConnectionState,
  writeConnectionState,
} from "@/coolify_deploy/store";
import { createTypedHandler } from "./base";
import { coolifyContracts, coolifyEvents } from "../types/coolify";
import type { CoolifyConnection } from "../types/coolify";
import { isSecureInstanceUrl } from "../types/coolify";
import {
  coolifyDomainHostname,
  normalizeCoolifyDomain,
} from "@/coolify_deploy/domain";
import {
  domainCheckVerdict,
  expectedServerAddress,
  isLoopbackAddress,
  isNonRoutableAddress,
  isDeferredIpv6,
} from "@/shared/domain_check";
import {
  applyCoolifyConnectionChange,
  isHostMove,
  type CoolifyConnectionState,
} from "@/coolify_deploy/connection";
import { CoolifyClient } from "../utils/coolify_client";
import { safeSend } from "../utils/safe_sender";
import { coolifyDeployRegistry } from "@/coolify_deploy/controller";
import { selectCoolifyDeployCapabilities } from "@/coolify_deploy/capabilities";

const logger = log.scope("coolify_handlers");

async function getApp(appId: number) {
  const app = await db.query.apps.findFirst({ where: eq(apps.id, appId) });
  if (!app) {
    throw new DyadError(`App ${appId} not found`, DyadErrorKind.NotFound);
  }
  return app;
}

/** The app's stored connection, or nothing when it has none. */
function readConnection(
  state: CoolifyConnectionState,
): CoolifyConnection | null {
  const settings = readSettings();
  if (
    !settings.coolify?.accessToken?.value ||
    !settings.coolify?.instanceUrl ||
    state.kind === "none"
  ) {
    return null;
  }
  return {
    instanceUrl: settings.coolify?.instanceUrl,
    serverUuid: state.serverUuid,
    projectUuid: state.projectUuid,
    environmentName: state.environmentName,
    domain: state.domain,
  };
}

/**
 * Names the stored token without disclosing it.
 *
 * The renderer caches an instance's servers and projects, and two tokens on
 * one instance can see different teams — so the cache key needs to change when
 * the token does. Truncated on purpose: this only ever has to differ between
 * tokens, never to be checked against one.
 */
function tokenFingerprint(token: string): string {
  return createHash("sha256").update(token).digest("hex").slice(0, 12);
}

export function registerCoolifyHandlers() {
  coolifyDeployRegistry.onSnapshot((appId, snapshot) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        safeSend(window.webContents, coolifyEvents.deployStatus.channel, {
          appId,
          snapshot,
        });
      }
    }
  });

  createTypedHandler(coolifyContracts.getStatus, async (_, { appId }) => {
    await getApp(appId);
    const settings = readSettings();
    const state = await readConnectionState(appId);
    const deployed = state.kind === "deployed" ? state : null;
    const token = settings.coolify?.accessToken?.value;
    return {
      hasToken: Boolean(token),
      tokenId: token ? tokenFingerprint(token) : null,
      instanceUrl: settings.coolify?.instanceUrl ?? null,
      connection: readConnection(state),
      appUrl: deployed?.appUrl ?? null,
      lastDeployedAt: deployed?.lastDeployedAt.getTime() ?? null,
    };
  });

  // DO NOT LOG this handler: it carries an API token.
  createTypedHandler(
    coolifyContracts.saveToken,
    async (_, { instanceUrl, token, acknowledgedInsecure }) => {
      if (!isSecureInstanceUrl(instanceUrl) && !acknowledgedInsecure) {
        throw new DyadError(
          "This address is not encrypted, so your API token would be readable " +
            "by anything on the network between you and the server. Confirm you " +
            "want to continue, or give Coolify a domain and certificate first.",
          DyadErrorKind.Validation,
        );
      }
      const probe = new CoolifyClient({ instanceUrl, token });
      // Validates the URL, the token and the instance's API switch in one
      // call. Coolify's own auth runs first, so a disabled API is only
      // reported once the token itself is accepted.
      await probe.listServers();
      const normalized = instanceUrl.replace(/\/+$/, "");
      const previous = readSettings().coolify?.instanceUrl;
      // Spread: the admin account for a server Dyad just installed is set
      // before there is any token for it, and this is the call that supplies
      // the token. Replacing would drop the password on the way in.
      writeSettings({
        coolify: {
          ...readSettings().coolify,
          instanceUrl: normalized,
          accessToken: { value: token },
        },
      });
      // Nothing is cleared here. Server, project and application ids are
      // meaningless on another instance, but they are not meaningless — they
      // describe applications still running on the one being left, and the
      // application id cannot be re-entered. Pointing somewhere else is not a
      // reason to destroy them: an app whose server this instance does not
      // have simply reads as belonging elsewhere, and pointing back restores
      // it untouched. Anything running is still talking to the old instance
      // with a token that may no longer be for it, so that does stop.
      if (previous && previous !== normalized) {
        coolifyDeployRegistry.cancelAll();
      }
    },
  );

  createTypedHandler(coolifyContracts.discover, async () => {
    const client = getClient();
    const [servers, projects] = await Promise.all([
      client.listServers(),
      client.listProjects(),
    ]);
    return { servers, projects };
  });

  createTypedHandler(coolifyContracts.clearToken, async () => {
    // Every field, not just the token. Dyad holds one Coolify at a time, so
    // an address or an admin account left behind belongs to an instance
    // nothing is connected to any more — and the next connection would put a
    // stranger's password under its address. The screen that reaches this
    // shows all of it one last time and asks the user to confirm, because
    // Dyad invented the password and is the only thing that has it.
    //
    // Every field named rather than an empty object: an absent key reads to
    // writeSettings as one a consumer read could not decrypt, and it hands
    // the ciphertext back — so an empty coolify would return the token this
    // is here to forget. FORGOTTEN_COOLIFY names them all and stops
    // compiling when CoolifySchema grows one more.
    //
    // The apps' rows are not touched. They read as disconnected without a
    // token anyway, and they carry each app's Coolify application id — the
    // one value that cannot be typed back in. Losing it would make the next
    // deploy build a second application beside the one already running and
    // lose a fight with it over the domain.
    coolifyDeployRegistry.cancelAll();
    writeSettings({ coolify: FORGOTTEN_COOLIFY });
  });

  createTypedHandler(coolifyContracts.createProject, async (_, { name }) => {
    const client = getClient();
    const created = await client.createProject(name);
    return { uuid: created.uuid };
  });

  createTypedHandler(
    coolifyContracts.saveConnection,
    async (_, { appId, connection }) => {
      // A running pipeline writes its application id and URL when it finishes,
      // and those mean nothing on a server the app was moved to meanwhile.
      if (
        !selectCoolifyDeployCapabilities(
          coolifyDeployRegistry.getSnapshot(appId),
        ).canEditConnection
      ) {
        throw new DyadError(
          "This app is deploying. Wait for it to finish, or disconnect to stop it, before changing its server.",
          DyadErrorKind.Precondition,
        );
      }
      // Coolify validates this as a URL and rejects a bare hostname, which is
      // what people type, so normalise before it is ever sent.
      const domain = connection.domain
        ? normalizeCoolifyDomain(connection.domain)
        : null;
      if (connection.domain && !domain) {
        throw new DyadError(
          `"${connection.domain}" is not a valid domain.`,
          DyadErrorKind.Validation,
        );
      }
      await getApp(appId);
      const current = await readConnectionState(appId);
      // Asked of the host directly rather than of the resulting kind, which
      // was wrong twice: on the kind alone an ordinary domain edit looks like
      // a move and throws away a failed deploy's account of itself, and on
      // whether an application was released a move away from an app that
      // never got one stops looking like a move at all.
      const movedHost = isHostMove(current, connection);
      // Coolify cannot regenerate an address once one is set, so
      // updateApplication never sends an empty domains value and a cleared
      // domain would leave the record saying "none" while the instance kept
      // serving the old one. Refused here rather than in the form, which
      // cannot tell whether an application exists: this is the only place
      // that knows, so the user learns from the error rather than the button.
      //
      // Not while moving, and not before an application exists: in both
      // cases there is nothing in Coolify whose address this could disagree
      // with.
      const hasApplication =
        current.kind === "provisioned" || current.kind === "deployed";
      if (!movedHost && hasApplication && current.domain && !domain) {
        throw new DyadError(
          "A domain cannot be removed from Dyad once it is set. Change it to " +
            "another domain here, or clear it in Coolify.",
          DyadErrorKind.Validation,
        );
      }
      const next = applyCoolifyConnectionChange(current, {
        type: "CONFIGURED",
        serverUuid: connection.serverUuid,
        projectUuid: connection.projectUuid,
        environmentName: connection.environmentName,
        domain,
      });
      // Nothing has been deployed where it is going, so the machine's
      // finished result would be shown against a place it never ran.
      if (movedHost) {
        coolifyDeployRegistry.cancelDeploy(appId);
      }
      await writeConnectionState(appId, next);
    },
  );

  /**
   * Checks a domain points at the chosen server before it is saved.
   *
   * Coolify asks for a certificate as soon as a real domain is set, so a
   * domain configured ahead of DNS leaves TLS in a failed state that reads
   * like a Dyad bug.
   */
  createTypedHandler(
    coolifyContracts.checkDomain,
    async (_, { serverUuid, domain }) => {
      const client = getClient();
      const servers = await client.listServers();
      const address = expectedServerAddress({
        serverIp: servers.find((s) => s.uuid === serverUuid)?.ip,
        instanceUrl: readSettings().coolify?.instanceUrl ?? "",
      });

      let expectedIps: string[] = [];
      if (address?.kind === "ip") {
        expectedIps = [address.ip];
      } else if (address?.kind === "resolve") {
        // Both tests the literal path gets, applied to what the name
        // resolved to: a server known as nas.local is as unreachable from a
        // public record as one reported as 192.168.1.50, and a name answering
        // on loopback is no more pointable than the literal 127.0.0.1 is.
        // Filtered rather than rejected outright, so a name answering on both
        // a public and a private address keeps the one a domain could point at.
        //
        // IPv6 stays in. Declining to reason about it is about which address
        // we are willing to name, not about what counts as evidence — and a
        // name that resolved here told us the server's AAAA in the same
        // breath. Dropping it would leave us calling a mismatch we can plainly
        // see unknowable.
        expectedIps = (await resolveBoth(address.hostname)).addresses.filter(
          (ip) => !isNonRoutableAddress(ip) && !isLoopbackAddress(ip),
        );
      }
      // The address the advice will name, which is the one place the IPv6
      // deferral applies: every verdict below still weighs the full set.
      const expectedIp = expectedIps.find((ip) => !isDeferredIpv6(ip)) ?? null;

      const hostname = coolifyDomainHostname(domain);
      if (!hostname) {
        return {
          verdict: "unknown" as const,
          hostname: null,
          expectedIp,
          actualIps: [],
        };
      }

      const resolved = await resolveBoth(hostname);
      // A resolver we could not reach tells us nothing about the domain.
      const verdict = resolved.failed
        ? ("unknown" as const)
        : domainCheckVerdict({ expectedIps, actualIps: resolved.addresses });
      return {
        // Nor does a mismatch we cannot name an address for. The whole of that
        // advice is "point it at this instead", so with nothing to offer there
        // is no advice left — only an accusation.
        verdict:
          verdict === "points-elsewhere" && !expectedIp
            ? ("unknown" as const)
            : verdict,
        hostname,
        expectedIp,
        actualIps: resolved.addresses,
      };
    },
  );

  createTypedHandler(coolifyContracts.deploy, async (_, { appId }) => {
    await getApp(appId);
    if (!readConnection(await readConnectionState(appId))) {
      throw new DyadError(
        "Connect a Coolify server for this app first.",
        DyadErrorKind.Validation,
      );
    }
    coolifyDeployRegistry.requestDeploy(appId);
  });

  createTypedHandler(coolifyContracts.getDeploySnapshot, async (_, { appId }) =>
    coolifyDeployRegistry.getSnapshot(appId),
  );

  createTypedHandler(coolifyContracts.disconnect, async (_, { appId }) => {
    await getApp(appId);
    // Abandon anything running first, so it cannot write its result over the
    // cleared connection afterwards.
    coolifyDeployRegistry.cancelDeploy(appId);
    const next = applyCoolifyConnectionChange(
      await readConnectionState(appId),
      { type: "DETACHED" },
    );
    await writeConnectionState(appId, next);
  });

  logger.debug("Registered Coolify IPC handlers");
}
