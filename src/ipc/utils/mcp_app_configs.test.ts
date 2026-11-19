import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
  appConfigConnection,
  pluginConnection,
  type McpConnectionRef,
} from "@/shared/mcp_connection_ref";

const mocks = vi.hoisted(() => ({
  settings: { enableAppScopedPlugins: true } as Record<string, unknown>,
  catalog: [] as unknown[],
  catalogCached: true,
  catalogFetches: 0,
}));

vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => false,
  },
  shell: { openExternal: vi.fn() },
}));

vi.mock("@/main/settings", () => ({
  readSettings: () => mocks.settings,
}));

vi.mock("@/ipc/shared/remote_mcp_catalog", () => ({
  getRemoteMcpCatalog: async () => {
    mocks.catalogFetches++;
    return mocks.catalog;
  },
  peekRemoteMcpCatalog: () => (mocks.catalogCached ? mocks.catalog : null),
}));

const { setDatabaseForTesting } = await import("@/db");
const { createInMemoryTestDb } = await import("@/testing/test_db");
const schema = await import("@/db/schema");
const {
  copyPluginAssignments,
  createAppConfig,
  listAppConfigs,
  pluginSwitchColumns,
  readPluginScopeFields,
  setAppConfigApps,
  setPluginAvailability,
} = await import("./mcp_app_configs");
const { readPluginStatusesForApp, resolveMcpConnectionsForApp } =
  await import("./mcp_app_scoping");
const { getStoredConsent, listStoredConsents, setStoredConsent } =
  await import("./mcp_consent_store");
const { readMcpConnection } = await import("./mcp_connection_store");
const { encryptSecretMap, readServerSecretMap } =
  await import("./secret_storage");

type TestDb = ReturnType<typeof createInMemoryTestDb>;
let db: TestDb;

function insertApp(name: string): number {
  return db
    .insert(schema.apps)
    .values({ name, path: name.toLowerCase().replace(/\s+/g, "-") })
    .returning()
    .get().id;
}

function insertPlugin(
  values: Partial<typeof schema.mcpServers.$inferInsert> = {},
): number {
  return db
    .insert(schema.mcpServers)
    .values({
      name: "Coolify",
      transport: "http",
      url: "https://prod.example.com/mcp",
      enabled: true,
      ...values,
    })
    .returning()
    .get().id;
}

function pluginRow(serverId: number) {
  return db
    .select()
    .from(schema.mcpServers)
    .where(eq(schema.mcpServers.id, serverId))
    .get()!;
}

function setPluginSwitch(serverId: number, enabled: boolean) {
  db.update(schema.mcpServers)
    .set(pluginSwitchColumns(pluginRow(serverId), enabled))
    .where(eq(schema.mcpServers.id, serverId))
    .run();
}

async function connectionsFor(appId: number): Promise<McpConnectionRef[]> {
  return (await resolveMcpConnectionsForApp(appId)).map(
    (resolved) => resolved.connection,
  );
}

beforeEach(() => {
  db = createInMemoryTestDb();
  setDatabaseForTesting(db);
  mocks.settings = { enableAppScopedPlugins: true };
  mocks.catalog = [];
  mocks.catalogCached = true;
  mocks.catalogFetches = 0;
});

afterEach(() => {
  setDatabaseForTesting(null);
  db.$client.close();
});

describe("app-specific plugin configurations", () => {
  it("serves only the assigned apps, and the default everywhere else", async () => {
    const lab = insertApp("Lab app");
    const other = insertApp("Other app");
    const serverId = insertPlugin();

    const config = await createAppConfig({
      serverId,
      name: "Lab server",
      appIds: [lab],
    });

    expect(config.connection).toEqual({ serverId, appConfigId: config.id });
    expect(await connectionsFor(lab)).toEqual([config.connection]);
    expect(await connectionsFor(other)).toEqual([pluginConnection(serverId)]);
    const [labConnection] = await resolveMcpConnectionsForApp(lab);
    // Tool keys stay on the plugin's name; the user sees the configuration.
    expect(labConnection).toMatchObject({
      pluginName: "Coolify",
      displayName: "Coolify (Lab server)",
    });
  });

  it("moves an app that already used another configuration of the plugin", async () => {
    const app = insertApp("App");
    const serverId = insertPlugin();
    const first = await createAppConfig({
      serverId,
      name: "First",
      appIds: [app],
    });
    const second = await createAppConfig({
      serverId,
      name: "Second",
      appIds: [],
    });

    await setAppConfigApps({ serverId, appConfigId: second.id, appIds: [app] });

    const configs = await listAppConfigs(serverId);
    expect(configs.find((c) => c.id === first.id)?.appIds).toEqual([]);
    expect(configs.find((c) => c.id === second.id)?.appIds).toEqual([app]);
    expect(await connectionsFor(app)).toEqual([second.connection]);
  });

  it("keeps a configuration, unused, when its last app is deleted", async () => {
    const app = insertApp("App");
    const serverId = insertPlugin();
    const config = await createAppConfig({
      serverId,
      name: "Lab",
      appIds: [app],
    });

    db.delete(schema.apps).where(eq(schema.apps.id, app)).run();

    const [remaining] = await listAppConfigs(serverId);
    expect(remaining).toMatchObject({ id: config.id, appIds: [] });
  });

  it("is refused while the experiment is off", async () => {
    const serverId = insertPlugin();
    mocks.settings = {};
    await expect(
      createAppConfig({ serverId, name: "Lab", appIds: [] }),
    ).rejects.toThrow(/turned off/);
  });

  it("starts a catalog plugin's configuration from the catalog, not the default's credentials", async () => {
    mocks.catalog = [
      {
        slug: "coolify",
        name: "Coolify",
        transport: "http",
        url: "https://catalog.example.com/mcp",
        headers: { "X-Fixed": "from-catalog" },
        oauth: { required: true, scope: "read" },
        inputs: [
          {
            kind: "vendoredOAuthClient",
            clientId: "vendored-client",
          },
        ],
      },
    ];
    const serverId = insertPlugin({
      catalogSlug: "coolify",
      headersEncrypted: encryptSecretMap({ Authorization: "default-token" }),
      oauthEnabled: true,
    });

    const config = await createAppConfig({
      serverId,
      name: "Lab",
      appIds: [],
    });

    const stored = await readMcpConnection(config.connection);
    expect(stored).toMatchObject({
      url: "https://catalog.example.com/mcp",
      oauthEnabled: true,
      oauthScope: "read",
      oauthClientId: "vendored-client",
      catalogSlug: "coolify",
      displayName: "Coolify (Lab)",
    });
    expect(readServerSecretMap(stored!.headersEncrypted, null)).toEqual({
      status: "ok",
      value: { "X-Fixed": "from-catalog" },
    });
  });

  it("ignores an assignment whose plugin disagrees with its configuration's", async () => {
    const app = insertApp("App");
    const coolify = insertPlugin();
    const github = insertPlugin({ name: "GitHub" });
    const lab = await createAppConfig({
      serverId: coolify,
      name: "Lab",
      appIds: [],
    });
    // Only a bug could write this row: Coolify's configuration filed
    // under GitHub.
    db.insert(schema.mcpAppConfigApps)
      .values({ appConfigId: lab.id, serverId: github, appId: app })
      .run();

    expect(await connectionsFor(app)).toEqual([
      pluginConnection(coolify),
      pluginConnection(github),
    ]);
  });

  it("leaves an app without the plugin until its configuration is set up", async () => {
    mocks.catalog = [
      {
        slug: "coolify",
        name: "Coolify",
        transport: "stdio",
        command: "npx",
        args: ["-y", "coolify-mcp@1.0.0"],
        inputs: [{ kind: "env", name: "COOLIFY_ACCESS_TOKEN", label: "Token" }],
      },
    ];
    const lab = insertApp("Lab app");
    const serverId = insertPlugin({
      catalogSlug: "coolify",
      transport: "stdio",
      url: null,
      command: "npx",
      args: ["-y", "coolify-mcp@1.0.0"],
      envEncrypted: encryptSecretMap({ COOLIFY_ACCESS_TOKEN: "default" }),
    });
    const config = await createAppConfig({
      serverId,
      name: "Lab",
      appIds: [lab],
    });

    // No fallback to the default, which reaches a different server.
    expect(await connectionsFor(lab)).toEqual([]);
    const [status] = await readPluginStatusesForApp(lab);
    expect(status.appConfigNeedsSetup).toBe(true);

    db.update(schema.mcpAppConfigs)
      .set({
        envEncrypted: encryptSecretMap({ COOLIFY_ACCESS_TOKEN: "lab" }),
      })
      .where(eq(schema.mcpAppConfigs.id, config.id))
      .run();
    expect(await connectionsFor(lab)).toEqual([config.connection]);
  });

  it("refreshes a cold catalog without waiting on it", async () => {
    mocks.catalog = [
      {
        slug: "coolify",
        name: "Coolify",
        transport: "stdio",
        command: "npx",
        args: ["-y", "coolify-mcp@1.0.0"],
        inputs: [{ kind: "env", name: "COOLIFY_ACCESS_TOKEN", label: "Token" }],
      },
    ];
    const lab = insertApp("Lab app");
    const serverId = insertPlugin({
      catalogSlug: "coolify",
      transport: "stdio",
      url: null,
      command: "npx",
      args: ["-y", "coolify-mcp@1.0.0"],
    });
    const config = await createAppConfig({
      serverId,
      name: "Lab",
      appIds: [lab],
    });
    mocks.catalogCached = false;
    mocks.catalogFetches = 0;

    // Unknown setup counts as set up for this turn, and the next turn has
    // the catalog.
    expect(await connectionsFor(lab)).toEqual([config.connection]);
    expect(mocks.catalogFetches).toBe(1);
  });

  it("won't change an app-specific configuration's approvals while the experiment is off", async () => {
    const serverId = insertPlugin();
    const config = await createAppConfig({
      serverId,
      name: "Lab",
      appIds: [],
    });

    mocks.settings = {};

    await expect(
      setStoredConsent(config.connection, "deploy", "always"),
    ).rejects.toThrow(/not found/);
    // The plugin's own approvals still work.
    await expect(
      setStoredConsent(pluginConnection(serverId), "deploy", "always"),
    ).resolves.toMatchObject({ consent: "always" });
  });

  it("reads an app-specific configuration as missing while the experiment is off", async () => {
    const serverId = insertPlugin();
    const config = await createAppConfig({
      serverId,
      name: "Lab",
      appIds: [],
    });

    mocks.settings = {};

    expect(await readMcpConnection(config.connection)).toBeUndefined();
    expect(await readMcpConnection(pluginConnection(serverId))).toMatchObject({
      pluginName: "Coolify",
    });
  });

  it("refuses a configuration when the catalog entry changed transport", async () => {
    mocks.catalog = [
      {
        slug: "coolify",
        name: "Coolify",
        transport: "stdio",
        command: "npx",
        args: ["-y", "coolify-mcp@1.0.0"],
      },
    ];
    const serverId = insertPlugin({ catalogSlug: "coolify" });

    await expect(
      createAppConfig({ serverId, name: "Lab", appIds: [] }),
    ).rejects.toThrow(/changed how it connects/);
    expect(await listAppConfigs()).toEqual([]);
  });

  it("runs the plugin's reviewed stdio command, not one the catalog changed to", async () => {
    // The catalog now lists a different command and env than the user
    // reviewed when adding the plugin.
    mocks.catalog = [
      {
        slug: "coolify",
        name: "Coolify",
        transport: "stdio",
        command: "npx",
        args: ["-y", "coolify-mcp@9.9.9"],
        env: { MODE: "changed", EXTRA: "unreviewed" },
        inputs: [{ kind: "env", name: "COOLIFY_ACCESS_TOKEN", label: "Token" }],
      },
    ];
    const serverId = insertPlugin({
      catalogSlug: "coolify",
      transport: "stdio",
      url: null,
      command: "npx",
      args: ["-y", "coolify-mcp@1.0.0"],
      envEncrypted: encryptSecretMap({
        MODE: "reviewed",
        COOLIFY_ACCESS_TOKEN: "default-token",
      }),
    });

    const config = await createAppConfig({
      serverId,
      name: "Lab",
      appIds: [],
    });

    const stored = await readMcpConnection(config.connection);
    expect(stored).toMatchObject({
      command: "npx",
      args: ["-y", "coolify-mcp@1.0.0"],
    });
    // The reviewed fixed value, no unreviewed var, and no copied credential.
    expect(readServerSecretMap(stored!.envEncrypted, null)).toEqual({
      status: "ok",
      value: { MODE: "reviewed" },
    });
  });
});

describe("the default configuration's scope", () => {
  it("won't make an unfinished default serve apps while the plugin is on", async () => {
    mocks.catalog = [
      {
        slug: "coolify",
        name: "Coolify",
        transport: "stdio",
        command: "npx",
        args: ["-y", "coolify-mcp@1.0.0"],
        inputs: [{ kind: "env", name: "COOLIFY_ACCESS_TOKEN", label: "Token" }],
      },
    ];
    const serverId = insertPlugin({
      catalogSlug: "coolify",
      transport: "stdio",
      url: null,
      enabled: false,
    });
    await setPluginAvailability({
      serverId,
      defaultScope: "none",
      defaultAppIds: [],
    });
    setPluginSwitch(serverId, true);

    await expect(
      setPluginAvailability({
        serverId,
        defaultScope: "all",
        defaultAppIds: [],
      }),
    ).rejects.toThrow(/Finish setting up Coolify/);
    expect(pluginRow(serverId)).toMatchObject({
      enabled: false,
      defaultScope: "none",
    });

    // While off, the scope can change without waiting on the catalog;
    // turning it on is locked in the UI.
    setPluginSwitch(serverId, false);
    mocks.catalogFetches = 0;
    await setPluginAvailability({
      serverId,
      defaultScope: "all",
      defaultAppIds: [],
    });
    expect(pluginRow(serverId)).toMatchObject({
      enabled: false,
      defaultScope: "all",
    });
    expect(mocks.catalogFetches).toBe(0);
  });

  it("lets a set-up default serve apps while the plugin is on", async () => {
    mocks.catalog = [
      {
        slug: "coolify",
        name: "Coolify",
        transport: "stdio",
        command: "npx",
        args: ["-y", "coolify-mcp@1.0.0"],
        inputs: [{ kind: "env", name: "COOLIFY_ACCESS_TOKEN", label: "Token" }],
      },
    ];
    const serverId = insertPlugin({
      catalogSlug: "coolify",
      transport: "stdio",
      url: null,
      envEncrypted: encryptSecretMap({ COOLIFY_ACCESS_TOKEN: "set" }),
    });
    await setPluginAvailability({
      serverId,
      defaultScope: "none",
      defaultAppIds: [],
    });
    setPluginSwitch(serverId, true);

    await setPluginAvailability({
      serverId,
      defaultScope: "all",
      defaultAppIds: [],
    });
    expect(pluginRow(serverId)).toMatchObject({ enabled: true });
  });

  it("limits the default to the selected apps", async () => {
    const chosen = insertApp("Chosen");
    const other = insertApp("Other");
    const serverId = insertPlugin();

    await setPluginAvailability({
      serverId,
      defaultScope: "selected",
      defaultAppIds: [chosen],
    });

    expect(await connectionsFor(chosen)).toEqual([pluginConnection(serverId)]);
    expect(await connectionsFor(other)).toEqual([]);
    const fields = await readPluginScopeFields([pluginRow(serverId)]);
    expect(fields.get(serverId)).toMatchObject({
      enabled: true,
      defaultScope: "selected",
      defaultAppIds: [chosen],
    });
  });

  it("with no default, only apps with their own configuration get the plugin", async () => {
    const lab = insertApp("Lab");
    const other = insertApp("Other");
    const serverId = insertPlugin();
    await setPluginAvailability({
      serverId,
      defaultScope: "none",
      defaultAppIds: [],
    });
    const config = await createAppConfig({
      serverId,
      name: "Lab server",
      appIds: [lab],
    });

    expect(await connectionsFor(lab)).toEqual([config.connection]);
    expect(await connectionsFor(other)).toEqual([]);
    // Older builds read only `enabled`, and must not use it everywhere.
    expect(pluginRow(serverId).enabled).toBe(false);
  });

  it("turning the plugin off stops every configuration, and on restores the scope", async () => {
    const lab = insertApp("Lab");
    const serverId = insertPlugin();
    await setPluginAvailability({
      serverId,
      defaultScope: "none",
      defaultAppIds: [],
    });
    await createAppConfig({ serverId, name: "Lab", appIds: [lab] });

    setPluginSwitch(serverId, false);
    expect(await connectionsFor(lab)).toEqual([]);

    setPluginSwitch(serverId, true);
    expect(await connectionsFor(lab)).toHaveLength(1);
    expect(
      (await readPluginScopeFields([pluginRow(serverId)])).get(serverId),
    ).toMatchObject({ enabled: true, defaultScope: "none" });
  });

  it("makes the default global again once an older build turns the plugin on", async () => {
    const other = insertApp("Other");
    const serverId = insertPlugin();
    await setPluginAvailability({
      serverId,
      defaultScope: "none",
      defaultAppIds: [],
    });

    db.update(schema.mcpServers)
      .set({ enabled: true })
      .where(eq(schema.mcpServers.id, serverId))
      .run();

    expect(await connectionsFor(other)).toEqual([pluginConnection(serverId)]);
  });
});

describe("with the experiment off", () => {
  it("uses every enabled plugin's default in every app, ignoring app configurations", async () => {
    const lab = insertApp("Lab");
    const serverId = insertPlugin();
    const disabled = insertPlugin({ name: "Off", enabled: false });
    await createAppConfig({ serverId, name: "Lab", appIds: [lab] });

    mocks.settings = {};

    expect(await connectionsFor(lab)).toEqual([pluginConnection(serverId)]);
    const statuses = await readPluginStatusesForApp(lab);
    expect(statuses.find((s) => s.serverId === disabled)?.availability).toEqual(
      { pluginEnabled: false, defaultScope: "all" },
    );
  });

  it("turning a limited plugin on with the switch makes it serve every app, as in older builds", async () => {
    const serverId = insertPlugin();
    await setPluginAvailability({
      serverId,
      defaultScope: "none",
      defaultAppIds: [],
    });
    setPluginSwitch(serverId, false);

    mocks.settings = {};
    setPluginSwitch(serverId, true);

    expect(pluginRow(serverId)).toMatchObject({
      enabled: true,
      defaultScope: "all",
    });
  });
});

describe("tool approvals", () => {
  it("are kept per configuration", async () => {
    const serverId = insertPlugin();
    const config = await createAppConfig({
      serverId,
      name: "Lab",
      appIds: [],
    });

    await setStoredConsent(config.connection, "deploy", "always");

    expect(await getStoredConsent(config.connection, "deploy")).toBe("always");
    expect(await getStoredConsent(pluginConnection(serverId), "deploy")).toBe(
      "ask",
    );

    await setStoredConsent(pluginConnection(serverId), "deploy", "denied");
    await setStoredConsent(config.connection, "deploy", "ask");
    expect(
      (await listStoredConsents()).map(
        ({ serverId, appConfigId, consent }) => ({
          serverId,
          appConfigId,
          consent,
        }),
      ),
    ).toEqual([
      { serverId, appConfigId: null, consent: "denied" },
      { serverId, appConfigId: config.id, consent: "ask" },
    ]);
  });
});

describe("a ref whose configuration belongs to another plugin", () => {
  it("reads and writes nothing", async () => {
    const coolify = insertPlugin();
    const github = insertPlugin({ name: "GitHub" });
    const config = await createAppConfig({
      serverId: coolify,
      name: "Lab",
      appIds: [],
    });
    const mismatched = appConfigConnection(github, config.id);

    expect(await readMcpConnection(mismatched)).toBeUndefined();
    await expect(
      setStoredConsent(mismatched, "deploy", "always"),
    ).rejects.toThrow(/not found/);
    await expect(
      setAppConfigApps({
        serverId: github,
        appConfigId: config.id,
        appIds: [],
      }),
    ).rejects.toThrow(/not found/);
    expect(await listStoredConsents()).toEqual([]);
  });
});

describe("copying an app", () => {
  it("gives the copy the same configurations as the original", async () => {
    const original = insertApp("Original");
    const copy = insertApp("Copy");
    const limited = insertPlugin({ name: "Limited" });
    const scoped = insertPlugin({ name: "Scoped" });
    await setPluginAvailability({
      serverId: limited,
      defaultScope: "selected",
      defaultAppIds: [original],
    });
    const config = await createAppConfig({
      serverId: scoped,
      name: "Lab",
      appIds: [original],
    });

    db.transaction((tx) => copyPluginAssignments(tx, original, copy));

    expect(await connectionsFor(copy)).toEqual([
      pluginConnection(limited),
      config.connection,
    ]);
  });
});
