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

function readConnection(app: {
  coolifyServerUuid: string | null;
  coolifyProjectUuid: string | null;
  coolifyEnvironmentName: string | null;
  coolifyDomain: string | null;
}): CoolifyConnection | null {
  const settings = readSettings();
  if (
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
      connection: readConnection(app),
      appUuid: app.coolifyApplicationUuid,
      appUrl: app.coolifyAppUrl,
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
    // Clearing the token also forgets which instance the apps were pointed at,
    // so saveToken can no longer tell that a later connection is a different
    // one. Start every app over here instead, or they keep server, project and
    // application ids that mean nothing on whatever instance comes next.
    coolifyDeployRegistry.cancelAll();
    writeSettings({
      coolifyInstanceUrl: undefined,
      coolifyAccessToken: undefined,
    });
    await db.update(apps).set({
      coolifyServerUuid: null,
      coolifyProjectUuid: null,
      coolifyEnvironmentName: null,
      coolifyApplicationUuid: null,
      coolifyDomain: null,
      coolifyAppUrl: null,
    });
  });

  createTypedHandler(coolifyContracts.createProject, async (_, { name }) => {
    const client = getClient();
    const created = await client.createProject(name);
    return { uuid: created.uuid, name };
  });

  createTypedHandler(
    coolifyContracts.saveConnection,
    async (_, { appId, connection }) => {
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
      await db
        .update(apps)
        .set({
          coolifyServerUuid: connection.serverUuid,
          coolifyProjectUuid: connection.projectUuid,
          coolifyEnvironmentName: connection.environmentName,
          coolifyDomain: domain,
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

      let expectedIp: string | null = null;
      if (address?.kind === "ip") {
        expectedIp = address.ip;
      } else if (address?.kind === "resolve") {
        expectedIp =
          (await dns.resolve4(address.hostname).catch(() => []))[0] ?? null;
      }

      const hostname = coolifyDomainHostname(domain);
      if (!hostname) {
        return {
          verdict: "unknown" as const,
          hostname: null,
          expectedIp,
          actualIps: [],
        };
      }

      const actualIps = await dns
        .resolve4(hostname)
        .catch(() => [] as string[]);
      return {
        verdict: domainCheckVerdict({ expectedIp, actualIps }),
        hostname,
        expectedIp,
        actualIps,
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
      })
      .where(eq(apps.id, appId));
  });

  logger.debug("Registered Coolify IPC handlers");
}
