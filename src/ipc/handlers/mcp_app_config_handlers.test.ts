import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

const mocks = vi.hoisted(() => ({
  settings: { enableAppScopedPlugins: true } as Record<string, unknown>,
}));

vi.mock("electron", () => ({
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  safeStorage: { isEncryptionAvailable: () => false },
  shell: { openExternal: vi.fn() },
}));

vi.mock("@/main/settings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/main/settings")>()),
  readSettings: () => mocks.settings,
  tryWriteSettings: vi.fn(),
}));

vi.mock("@/ipc/shared/remote_mcp_catalog", () => ({
  getRemoteMcpCatalog: async () => [],
  peekRemoteMcpCatalog: () => [],
}));

const { mcpManager } = await import("../utils/mcp_manager");
const { registerMcpHandlers } = await import("./mcp_handlers");
const { setupHandlerTestHarness } =
  await import("@/testing/handler_test_harness");
const schema = await import("@/db/schema");
type Harness = ReturnType<typeof setupHandlerTestHarness>;

registerMcpHandlers();

let harness: Harness;

beforeEach(() => {
  mocks.settings = { enableAppScopedPlugins: true };
  harness = setupHandlerTestHarness();
  vi.spyOn(mcpManager, "dispose").mockResolvedValue();
});

afterEach(() => {
  harness.dispose();
  vi.restoreAllMocks();
});

function insertPlugin() {
  return harness.db
    .insert(schema.mcpServers)
    .values({
      name: "Coolify",
      transport: "stdio",
      command: "coolify-mcp",
      enabled: true,
    })
    .returning()
    .get().id;
}

function insertApp(name: string) {
  return harness.db
    .insert(schema.apps)
    .values({ name, path: name })
    .returning()
    .get().id;
}

describe("app-specific configuration handlers", () => {
  it("edits a configuration through its own channel", async () => {
    const serverId = insertPlugin();
    const created = await harness.invokeHandler<{ id: number }>(
      "mcp:create-app-config",
      { serverId, name: "Lab", appIds: [] },
    );

    await harness.invokeHandler("mcp:update-app-config", {
      serverId,
      appConfigId: created.id,
      name: "Lab server",
      envJson: { API_TOKEN: "lab-token" },
    });

    const [config] = await harness.invokeHandler<
      { id: number; name: string; envJson: Record<string, string> }[]
    >("mcp:list-app-configs");
    expect(config).toMatchObject({
      id: created.id,
      name: "Lab server",
      envJson: { API_TOKEN: "lab-token" },
    });
    // The plugin's own configuration is untouched.
    const plugin = harness.db
      .select()
      .from(schema.mcpServers)
      .where(eq(schema.mcpServers.id, serverId))
      .get()!;
    expect(plugin.envEncrypted).toBeNull();
  });

  it("refuses an edit or delete that names the configuration under another plugin", async () => {
    const serverId = insertPlugin();
    const otherPlugin = insertPlugin();
    const created = await harness.invokeHandler<{ id: number }>(
      "mcp:create-app-config",
      { serverId, name: "Lab", appIds: [] },
    );

    await expect(
      harness.invokeHandler("mcp:update-app-config", {
        serverId: otherPlugin,
        appConfigId: created.id,
        name: "Renamed",
      }),
    ).rejects.toThrow(/not found/);
    await harness.invokeHandler("mcp:delete-app-config", {
      serverId: otherPlugin,
      appConfigId: created.id,
    });

    expect(
      await harness.invokeHandler<{ name: string }[]>("mcp:list-app-configs"),
    ).toMatchObject([{ id: created.id, name: "Lab" }]);
  });

  it("deletes one configuration without touching its plugin", async () => {
    const serverId = insertPlugin();
    const created = await harness.invokeHandler<{ id: number }>(
      "mcp:create-app-config",
      { serverId, name: "Lab", appIds: [] },
    );

    await harness.invokeHandler("mcp:delete-app-config", {
      serverId,
      appConfigId: created.id,
    });

    expect(await harness.invokeHandler("mcp:list-app-configs")).toEqual([]);
    expect(
      await harness.invokeHandler<{ id: number }[]>("mcp:list-servers"),
    ).toMatchObject([{ id: serverId }]);
  });

  it("deletes a plugin's configurations with the plugin", async () => {
    const serverId = insertPlugin();
    await harness.invokeHandler("mcp:create-app-config", {
      serverId,
      name: "Lab",
      appIds: [],
    });

    await harness.invokeHandler("mcp:delete-server", serverId);

    expect(await harness.invokeHandler("mcp:list-app-configs")).toEqual([]);
  });

  it("keeps a limited default's scope when the plugin is switched off and on", async () => {
    const app = insertApp("App");
    const serverId = insertPlugin();
    await harness.invokeHandler("mcp:set-plugin-availability", {
      serverId,
      defaultScope: "selected",
      defaultAppIds: [app],
    });

    await harness.invokeHandler("mcp:update-server", {
      id: serverId,
      enabled: false,
    });
    await harness.invokeHandler("mcp:update-server", {
      id: serverId,
      enabled: true,
    });

    const [server] =
      await harness.invokeHandler<
        { enabled: boolean; defaultScope: string; defaultAppIds: number[] }[]
      >("mcp:list-servers");
    expect(server).toMatchObject({
      enabled: true,
      defaultScope: "selected",
      defaultAppIds: [app],
    });
  });

  it("reports every plugin as serving all apps while the experiment is off", async () => {
    const app = insertApp("App");
    const serverId = insertPlugin();
    await harness.invokeHandler("mcp:set-plugin-availability", {
      serverId,
      defaultScope: "none",
      defaultAppIds: [],
    });
    await harness.invokeHandler("mcp:create-app-config", {
      serverId,
      name: "Lab",
      appIds: [app],
    });

    mocks.settings = {};

    const [server] =
      await harness.invokeHandler<
        { enabled: boolean; defaultScope: string; appConfigCount: number }[]
      >("mcp:list-servers");
    // Matches what an older build shows: the limited plugin reads as off.
    expect(server).toMatchObject({
      enabled: false,
      defaultScope: "all",
      appConfigCount: 0,
    });
    await expect(
      harness.invokeHandler("mcp:create-app-config", {
        serverId,
        name: "Another",
        appIds: [],
      }),
    ).rejects.toThrow(/turned off/);
  });
});
