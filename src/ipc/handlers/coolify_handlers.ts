import { BrowserWindow } from "electron";
import { eq } from "drizzle-orm";
import log from "electron-log";
import * as dns from "node:dns/promises";
import { db } from "../../db";
import { apps } from "../../db/schema";
import { readSettings, writeSettings } from "../../main/settings";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
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
} from "@/coolify_deploy/domain_check";
import { CoolifyClient } from "../utils/coolify_client";
import { safeSend } from "../utils/safe_sender";
import { coolifyDeployRegistry } from "@/coolify_deploy/controller";
import { selectCoolifyDeployCapabilities } from "@/coolify_deploy/capabilities";

const logger = log.scope("coolify_handlers");

function getClient(): CoolifyClient {
  const settings = readSettings();
  const token = settings.coolifyAccessToken?.value;
  const instanceUrl = settings.coolifyInstanceUrl;
  if (!token || !instanceUrl) {
    throw new DyadError(
      "Coolify is not connected. Add your instance URL and API token first.",
      DyadErrorKind.Validation,
    );
  }
  return new CoolifyClient({ instanceUrl, token });
}

async function getApp(appId: number) {
  const app = await db.query.apps.findFirst({ where: eq(apps.id, appId) });
  if (!app) {
    throw new DyadError(`App ${appId} not found`, DyadErrorKind.NotFound);
  }
  return app;
}

/** A resolver saying "no such record" — anything else is our problem, not DNS's. */
const NO_RECORD_CODES = new Set(["ENOTFOUND", "ENODATA", "NOTFOUND"]);

/**
 * Both families, distinguishing "no record" from "could not ask".
 *
 * A timeout or an unreachable resolver must not be reported as a missing
 * record: telling someone to fix DNS that is already correct is exactly the
 * confident-but-wrong advice the unknown verdict exists to avoid.
 */
async function resolveBoth(
  hostname: string,
): Promise<{ addresses: string[]; failed: boolean }> {
  const attempt = async (fn: (h: string) => Promise<string[]>) => {
    try {
      return { addresses: await fn(hostname), failed: false };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? "";
      return { addresses: [] as string[], failed: !NO_RECORD_CODES.has(code) };
    }
  };
  const [v4, v6] = await Promise.all([
    attempt(dns.resolve4),
    attempt(dns.resolve6),
  ]);
  return {
    addresses: [...v4.addresses, ...v6.addresses],
    // Only a problem if we learned nothing: one family answering is enough.
    failed: v4.failed && v6.failed,
  };
}

function readConnection(app: {
  coolifyServerUuid: string | null;
  coolifyProjectUuid: string | null;
  coolifyEnvironmentName: string | null;
  coolifyDomain: string | null;
}): CoolifyConnection | null {
  const settings = readSettings();
  if (
    !settings.coolifyAccessToken?.value ||
    !settings.coolifyInstanceUrl ||
    !app.coolifyServerUuid ||
    !app.coolifyProjectUuid
  ) {
    return null;
  }
  return {
    instanceUrl: settings.coolifyInstanceUrl,
    serverUuid: app.coolifyServerUuid,
    projectUuid: app.coolifyProjectUuid,
    environmentName: app.coolifyEnvironmentName ?? "production",
    domain: app.coolifyDomain,
  };
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
    const app = await getApp(appId);
    const settings = readSettings();
    return {
      hasToken: Boolean(settings.coolifyAccessToken?.value),
      instanceUrl: settings.coolifyInstanceUrl ?? null,
      connection: readConnection(app),
      appUrl: app.coolifyAppUrl,
      lastDeployedAt: app.coolifyLastDeployedAt?.getTime() ?? null,
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
      const previous = readSettings().coolifyInstanceUrl;
      writeSettings({
        coolifyInstanceUrl: normalized,
        coolifyAccessToken: { value: token },
      });
      // Server and project ids belong to the old instance and mean nothing on
      // a new one, so pointing somewhere else starts every app over. Anything
      // running is still talking to the old instance, and a finished result
      // would otherwise be shown against the new one.
      if (previous && previous !== normalized) {
        coolifyDeployRegistry.cancelAll();
        await db.update(apps).set({
          coolifyServerUuid: null,
          coolifyProjectUuid: null,
          coolifyEnvironmentName: null,
          coolifyApplicationUuid: null,
          coolifyDomain: null,
          coolifyAppUrl: null,
          coolifyLastDeployedAt: null,
        });
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
    // Only the token. Every app reads as disconnected without one, so there is
    // nothing to gain by clearing their rows — and doing so would throw away
    // each app's Coolify application id, which is the one value that cannot be
    // re-entered. The next deploy would then build a second application beside
    // the one already running and lose a fight with it over the domain.
    //
    // The instance URL stays so that saveToken can still tell whether the next
    // token points somewhere else; that is the case where the ids really are
    // meaningless, and it clears them itself.
    coolifyDeployRegistry.cancelAll();
    writeSettings({ coolifyAccessToken: undefined });
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
      // An application belongs to the server and project it was created
      // under, and Coolify cannot move one. Keeping its id after the user
      // picks somewhere else would send the next deploy back to the old
      // server while the panel showed the new one, so let it be recreated.
      const app = await getApp(appId);
      const movedHost =
        app.coolifyServerUuid !== connection.serverUuid ||
        app.coolifyProjectUuid !== connection.projectUuid;

      await db
        .update(apps)
        .set({
          coolifyServerUuid: connection.serverUuid,
          coolifyProjectUuid: connection.projectUuid,
          coolifyEnvironmentName: connection.environmentName,
          coolifyDomain: domain,
          ...(movedHost
            ? { coolifyApplicationUuid: null, coolifyAppUrl: null }
            : {}),
        })
        .where(eq(apps.id, appId));
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
        instanceUrl: readSettings().coolifyInstanceUrl ?? "",
      });

      let expectedIps: string[] = [];
      if (address?.kind === "ip") {
        expectedIps = [address.ip];
      } else if (address?.kind === "resolve") {
        expectedIps = (await resolveBoth(address.hostname)).addresses;
      }
      const expectedIp = expectedIps[0] ?? null;

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
      return {
        // A resolver we could not reach tells us nothing about the domain.
        verdict: resolved.failed
          ? ("unknown" as const)
          : domainCheckVerdict({ expectedIps, actualIps: resolved.addresses }),
        hostname,
        expectedIp,
        actualIps: resolved.addresses,
      };
    },
  );

  createTypedHandler(coolifyContracts.deploy, async (_, { appId }) => {
    const app = await getApp(appId);
    if (!readConnection(app)) {
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
    // Abandon anything running first, so it cannot write its result over the
    // cleared connection afterwards.
    coolifyDeployRegistry.cancelDeploy(appId);
    await db
      .update(apps)
      .set({
        coolifyServerUuid: null,
        coolifyProjectUuid: null,
        coolifyEnvironmentName: null,
        coolifyApplicationUuid: null,
        coolifyDomain: null,
        coolifyAppUrl: null,
        coolifyLastDeployedAt: null,
      })
      .where(eq(apps.id, appId));
  });

  logger.debug("Registered Coolify IPC handlers");
}
