import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * What survives clearing the token, and what does not.
 *
 * The application id is the one value in an app's Coolify row that the user
 * cannot re-enter: losing it makes the next deploy build a second application
 * beside the one already running, which then holds the domain the new one
 * wants. These cover the two paths that decide whether it survives.
 */

const settings: Record<string, unknown> = {};
const rows: Record<string, unknown>[] = [];

vi.mock("../../main/settings", () => ({
  readSettings: () => ({ ...settings }),
  writeSettings: (patch: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) delete settings[key];
      else settings[key] = value;
    }
  },
}));

/**
 * The connection is its own table now, so the double models a row that can be
 * absent. `connection` holds it, or null when the app has none — which is what
 * disconnecting produces and what "not connected" means.
 */
const updateSet = vi.fn();
const deleted = vi.fn();
let connection: Record<string, unknown> | null = null;

vi.mock("../../db", () => ({
  db: {
    query: {
      apps: { findFirst: async () => rows[0], findMany: async () => rows },
      coolifyAppConnections: { findFirst: async () => connection ?? undefined },
    },
    insert: () => ({
      values: (row: Record<string, unknown>) => ({
        onConflictDoUpdate: ({ set }: { set: Record<string, unknown> }) => {
          updateSet(set);
          connection = { ...row, ...set };
          return Promise.resolve();
        },
      }),
    }),
    delete: () => ({
      where: () => {
        deleted();
        connection = null;
        return Promise.resolve();
      },
    }),
  },
}));

vi.mock("@/coolify_deploy/controller", () => ({
  coolifyDeployRegistry: {
    onSnapshot: () => () => {},
    cancelAll: vi.fn(),
    cancelDeploy,
    getSnapshot: () => ({ type: "idle" }),
  },
}));

const cancelDeploy = vi.hoisted(() => vi.fn());
const listServers = vi.fn(async () => [] as Array<{ uuid: string }>);
vi.mock("../utils/coolify_client", () => ({
  CoolifyClient: class {
    listServers = listServers;
    listProjects = async () => [];
  },
}));

vi.mock("electron", () => ({ BrowserWindow: { getAllWindows: () => [] } }));

const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();
vi.mock("./base", () => ({
  createTypedHandler: (
    contract: { channel: string },
    handler: (...args: unknown[]) => Promise<unknown>,
  ) => handlers.set(contract.channel, handler),
}));

const { registerCoolifyHandlers } = await import("./coolify_handlers");

const call = (channel: string, payload?: unknown) =>
  handlers.get(channel)!(null, payload);

const APP_ROW = { id: 1, name: "demo" };

const CONNECTED = {
  appId: 1,
  serverUuid: "srv-1",
  projectUuid: "prj-1",
  environmentName: "production",
  applicationUuid: "app-1",
  domain: "https://demo.example.com",
  appUrl: "https://demo.example.com",
  lastDeployedAt: new Date(5),
};

beforeEach(() => {
  handlers.clear();
  updateSet.mockClear();
  deleted.mockClear();
  cancelDeploy.mockClear();
  rows.length = 0;
  rows.push({ ...APP_ROW });
  connection = { ...CONNECTED };
  for (const key of Object.keys(settings)) delete settings[key];
  settings.coolify = {
    instanceUrl: "https://coolify.example.com",
    accessToken: { value: "tok" },
  };
  registerCoolifyHandlers();
});

describe("naming the stored token", () => {
  /**
   * Servers and projects are cached per instance, and two tokens on one
   * instance can see different teams. The renderer therefore needs to know the
   * token changed — without ever being handed the token.
   */
  it("changes when the token changes, on the same instance", async () => {
    const first: any = await call("coolify:get-status", { appId: 1 });
    settings.coolify = {
      instanceUrl: "https://coolify.example.com",
      accessToken: { value: "a-different-team-token" },
    };
    const second: any = await call("coolify:get-status", { appId: 1 });

    expect(first.tokenId).toBeTruthy();
    expect(second.tokenId).not.toBe(first.tokenId);
  });

  it("is the same for the same token, so the cache is not thrown away", async () => {
    const first: any = await call("coolify:get-status", { appId: 1 });
    const second: any = await call("coolify:get-status", { appId: 1 });
    expect(second.tokenId).toBe(first.tokenId);
  });

  it("does not carry the token to the renderer", async () => {
    settings.coolify = {
      instanceUrl: "https://coolify.example.com",
      accessToken: { value: "1|super-secret-value" },
    };
    const status: any = await call("coolify:get-status", { appId: 1 });

    expect(JSON.stringify(status)).not.toContain("super-secret");
    expect(status.tokenId).not.toContain("super-secret");
  });

  it("is absent when there is no token", async () => {
    settings.coolify = { instanceUrl: "https://coolify.example.com" };
    const status: any = await call("coolify:get-status", { appId: 1 });

    expect(status.hasToken).toBe(false);
    expect(status.tokenId).toBeNull();
  });
});

describe("clearing the token", () => {
  it("keeps every app's application id and settings", async () => {
    await call("coolify:clear-token");

    expect(connection?.applicationUuid).toBe("app-1");
    expect(connection?.serverUuid).toBe("srv-1");
    expect(connection?.domain).toBe("https://demo.example.com");
    // Nothing was written to the apps table at all.
    expect(updateSet).not.toHaveBeenCalled();
  });

  it("still reports the app as disconnected", async () => {
    await call("coolify:clear-token");

    const status = (await call("coolify:get-status", { appId: 1 })) as {
      hasToken: boolean;
      connection: unknown;
      instanceUrl: string | null;
    };
    expect(status.hasToken).toBe(false);
    expect(status.connection).toBeNull();
    // Remembered so the token form does not make the user retype it.
    expect(status.instanceUrl).toBe("https://coolify.example.com");
  });

  it("lets the same instance pick up where it left off", async () => {
    await call("coolify:clear-token");
    await call("coolify:save-token", {
      instanceUrl: "https://coolify.example.com",
      token: "tok-2",
      acknowledgedInsecure: false,
    });

    const status = (await call("coolify:get-status", { appId: 1 })) as {
      connection: { serverUuid: string } | null;
    };
    expect(status.connection?.serverUuid).toBe("srv-1");
    expect(connection?.applicationUuid).toBe("app-1");
  });

  it("keeps every app's record when the next token points somewhere else", async () => {
    // Those ids mean nothing on the new instance, but they describe
    // applications still running on the old one, and the application id
    // cannot be re-entered. Pointing back has to restore them untouched.
    listServers.mockResolvedValueOnce([{ uuid: "srv-elsewhere" }]);
    await call("coolify:clear-token");
    await call("coolify:save-token", {
      instanceUrl: "https://other.example.com",
      token: "tok-2",
      acknowledgedInsecure: false,
    });

    expect(connection?.applicationUuid).toBe("app-1");
    expect(connection?.serverUuid).toBe("srv-1");
    expect(updateSet).not.toHaveBeenCalled();
  });

  it("keeps everything when the same instance answers at a new address", async () => {
    // The connection form tells people to give Coolify a domain and
    // certificate, which changes the address. Treating that as a new instance
    // abandons applications that are still running, with nothing left in Dyad
    // that can reach them.
    // A genuinely different address, so the repoint branch really runs — but
    // the instance still reports the server the app is pinned to.
    listServers.mockResolvedValueOnce([{ uuid: "srv-1" }]);
    await call("coolify:clear-token");
    await call("coolify:save-token", {
      instanceUrl: "https://coolify.moved-here.com",
      token: "tok-2",
      acknowledgedInsecure: false,
    });

    expect(connection?.applicationUuid).toBe("app-1");
    expect(connection?.serverUuid).toBe("srv-1");
  });
});

describe("moving an app to a different server or project", () => {
  it("releases the application, which cannot move with it", async () => {
    // Coolify cannot move an application between servers, so keeping its id
    // would send the next deploy back to the old one while the panel showed
    // the new.
    await call("coolify:save-connection", {
      appId: 1,
      connection: {
        serverUuid: "srv-2",
        projectUuid: "prj-1",
        environmentName: "production",
        domain: null,
      },
    });

    expect(connection?.serverUuid).toBe("srv-2");
    expect(connection?.applicationUuid).toBeNull();
    expect(connection?.appUrl).toBeNull();
    // Nothing has been deployed where it is going, so the old result must not
    // be shown against it.
    expect(connection?.lastDeployedAt).toBeNull();
    expect(cancelDeploy).toHaveBeenCalledWith(1);
  });

  it("keeps the application when only the domain changes", async () => {
    await call("coolify:save-connection", {
      appId: 1,
      connection: {
        serverUuid: "srv-1",
        projectUuid: "prj-1",
        environmentName: "production",
        domain: "https://new.example.com",
      },
    });

    expect(connection?.applicationUuid).toBe("app-1");
    expect(connection?.domain).toBe("https://new.example.com");
    expect(connection?.lastDeployedAt).not.toBeNull();
    expect(cancelDeploy).not.toHaveBeenCalled();
  });

  it("leaves a failed deploy's account alone when nothing was released", async () => {
    // An app that never had an application is configured before and after an
    // ordinary domain edit. Cancelling there would clear the error and log
    // that say why the last attempt failed.
    connection = {
      ...CONNECTED,
      applicationUuid: null,
      appUrl: null,
      lastDeployedAt: null,
    };

    await call("coolify:save-connection", {
      appId: 1,
      connection: {
        serverUuid: "srv-1",
        projectUuid: "prj-1",
        environmentName: "production",
        domain: "https://new.example.com",
      },
    });

    expect(cancelDeploy).not.toHaveBeenCalled();
    expect(connection?.domain).toBe("https://new.example.com");
  });
});

describe("clearing a domain", () => {
  it("is refused for an app that is staying put", () => {
    // Coolify cannot regenerate an address once one is set, so the record
    // would say "none" while the instance kept serving the old one. The form
    // refuses it; a second window working from a stale status reaches here.
    return expect(
      call("coolify:save-connection", {
        appId: 1,
        connection: {
          serverUuid: "srv-1",
          projectUuid: "prj-1",
          environmentName: "production",
          domain: null,
        },
      }),
    ).rejects.toThrow(/cannot be removed/);
  });

  it("is allowed before anything exists in Coolify to contradict", async () => {
    // Configured but never deployed: no application, so nothing is serving
    // the old address and clearing it contradicts nothing.
    connection = {
      ...CONNECTED,
      applicationUuid: null,
      appUrl: null,
      lastDeployedAt: null,
    };

    await call("coolify:save-connection", {
      appId: 1,
      connection: {
        serverUuid: "srv-1",
        projectUuid: "prj-1",
        environmentName: "production",
        domain: null,
      },
    });

    expect(connection?.domain).toBeNull();
  });

  it("is allowed when the app is moving, which releases the application", async () => {
    // Nothing is left whose address this could disagree with.
    await call("coolify:save-connection", {
      appId: 1,
      connection: {
        serverUuid: "srv-2",
        projectUuid: "prj-1",
        environmentName: "production",
        domain: null,
      },
    });

    expect(connection?.domain).toBeNull();
    expect(connection?.applicationUuid).toBeNull();
  });
});

describe("moving an app that never got an application", () => {
  it("still clears the previous server's failed result", async () => {
    // A deploy can fail before the application is created — an unreachable
    // server, a refused deploy key. The record stays configured, but the
    // machine holds that server's error, and it does not describe the one the
    // user just switched to.
    connection = {
      ...CONNECTED,
      applicationUuid: null,
      appUrl: null,
      lastDeployedAt: null,
    };

    await call("coolify:save-connection", {
      appId: 1,
      connection: {
        serverUuid: "srv-2",
        projectUuid: "prj-1",
        environmentName: "production",
        domain: null,
      },
    });

    expect(cancelDeploy).toHaveBeenCalledWith(1);
  });
});
