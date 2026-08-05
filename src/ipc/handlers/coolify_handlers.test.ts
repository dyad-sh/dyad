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

const updateSet = vi.fn();
vi.mock("../../db", () => ({
  db: {
    query: { apps: { findFirst: async () => rows[0] } },
    update: () => ({
      set: (patch: Record<string, unknown>) => {
        updateSet(patch);
        Object.assign(rows[0], patch);
        return { where: () => Promise.resolve() };
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
const listServers = vi.fn(async () => []);
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

const CONNECTED_ROW = {
  id: 1,
  coolifyServerUuid: "srv-1",
  coolifyProjectUuid: "prj-1",
  coolifyEnvironmentName: "production",
  coolifyApplicationUuid: "app-1",
  coolifyDomain: "https://demo.example.com",
  coolifyAppUrl: "https://demo.example.com",
  coolifyLastDeployedAt: new Date(5),
};

beforeEach(() => {
  handlers.clear();
  updateSet.mockClear();
  cancelDeploy.mockClear();
  rows.length = 0;
  rows.push({ ...CONNECTED_ROW });
  for (const key of Object.keys(settings)) delete settings[key];
  settings.coolifyInstanceUrl = "https://coolify.example.com";
  settings.coolifyAccessToken = { value: "tok" };
  registerCoolifyHandlers();
});

describe("clearing the token", () => {
  it("keeps every app's application id and settings", async () => {
    await call("coolify:clear-token");

    expect(rows[0].coolifyApplicationUuid).toBe("app-1");
    expect(rows[0].coolifyServerUuid).toBe("srv-1");
    expect(rows[0].coolifyDomain).toBe("https://demo.example.com");
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
    expect(rows[0].coolifyApplicationUuid).toBe("app-1");
  });

  it("starts over when the next token points at a different instance", async () => {
    // Those ids exist only on the old instance, so keeping them would deploy
    // against something that is not there.
    await call("coolify:clear-token");
    await call("coolify:save-token", {
      instanceUrl: "https://other.example.com",
      token: "tok-2",
      acknowledgedInsecure: false,
    });

    expect(rows[0].coolifyApplicationUuid).toBeNull();
    expect(rows[0].coolifyServerUuid).toBeNull();
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

    expect(rows[0].coolifyServerUuid).toBe("srv-2");
    expect(rows[0].coolifyApplicationUuid).toBeNull();
    expect(rows[0].coolifyAppUrl).toBeNull();
    // Nothing has been deployed where it is going, so the old result must not
    // be shown against it.
    expect(rows[0].coolifyLastDeployedAt).toBeNull();
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

    expect(rows[0].coolifyApplicationUuid).toBe("app-1");
    expect(rows[0].coolifyDomain).toBe("https://new.example.com");
    expect(rows[0].coolifyLastDeployedAt).not.toBeNull();
    expect(cancelDeploy).not.toHaveBeenCalled();
  });

  it("leaves a failed deploy's account alone when nothing was released", async () => {
    // An app that never had an application is configured before and after an
    // ordinary domain edit. Cancelling there would clear the error and log
    // that say why the last attempt failed.
    rows[0].coolifyApplicationUuid = null;
    rows[0].coolifyAppUrl = null;
    rows[0].coolifyLastDeployedAt = null;

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
    expect(rows[0].coolifyDomain).toBe("https://new.example.com");
  });
});
