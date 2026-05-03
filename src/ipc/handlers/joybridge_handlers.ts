/**
 * JoyBridge IPC handlers — single canonical namespace for the
 * JoyCreate ↔ JoyMarketplace integration.
 *
 * Backed by `src/lib/joybridge_client.ts`. These handlers are thin wrappers:
 * all transport logic lives in the client. Settings are persisted to a
 * dedicated JSON file in userData (matches the pattern used by
 * `marketplace_sync_handlers.ts`).
 *
 * The 11 channels exposed:
 *   joybridge:get-config
 *   joybridge:connect
 *   joybridge:create-store
 *   joybridge:get-store
 *   joybridge:list-my-stores
 *   joybridge:publish-asset
 *   joybridge:get-asset
 *   joybridge:list-my-assets
 *   joybridge:browse-marketplace
 *   joybridge:goldsky-query
 *   joybridge:pin-to-ipfs
 *
 * Reminder (per Collab Hub PR #16 post-mortem): every channel below MUST also
 * be added to `validInvokeChannels` in `src/preload.ts`, otherwise the
 * renderer can't reach it.
 */

import { ipcMain, app } from "electron";
import * as fs from "fs-extra";
import * as path from "path";
import log from "electron-log";

import {
  JoyBridgeClient,
  type CreateStoreInput,
  type PublishAssetInput,
  type BrowseQuery,
} from "@/lib/joybridge_client";

const logger = log.scope("joybridge_handlers");

// -- Persisted config --------------------------------------------------------

interface JoyBridgeStoredConfig {
  apiBase?: string;
  webBase?: string;
  apiKey?: string;
  supabaseUrl?: string;
  supabasePublishableKey?: string;
}

let storedConfig: JoyBridgeStoredConfig = {};
let client: JoyBridgeClient | undefined;

function configPath(): string {
  return path.join(app.getPath("userData"), "joybridge-config.json");
}

async function loadConfig(): Promise<JoyBridgeStoredConfig> {
  try {
    const p = configPath();
    if (await fs.pathExists(p)) {
      storedConfig = (await fs.readJson(p)) ?? {};
    }
  } catch (err) {
    logger.warn("Failed to load joybridge config:", err);
  }
  // Env overlay (env wins over disk for CI / dev).
  const envApiBase = process.env.JOYBRIDGE_API_BASE
    ?? process.env.JOYMARKETPLACE_API_URL;
  const envWebBase = process.env.JOYBRIDGE_WEB_BASE
    ?? process.env.JOYMARKETPLACE_WEB_URL;
  const envSupabaseUrl = process.env.SUPABASE_URL
    ?? process.env.JOYMARKETPLACE_SUPABASE_URL;
  const envSupabaseKey = process.env.SUPABASE_PUBLISHABLE_KEY
    ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY
    ?? process.env.JOYMARKETPLACE_SUPABASE_ANON_KEY;
  const envApiKey = process.env.JOY_API_KEY;

  if (envApiBase) storedConfig.apiBase = envApiBase;
  if (envWebBase) storedConfig.webBase = envWebBase;
  if (envSupabaseUrl) storedConfig.supabaseUrl = envSupabaseUrl;
  if (envSupabaseKey) storedConfig.supabasePublishableKey = envSupabaseKey;
  if (envApiKey && !storedConfig.apiKey) storedConfig.apiKey = envApiKey;

  return storedConfig;
}

async function saveConfig(patch: Partial<JoyBridgeStoredConfig>): Promise<void> {
  storedConfig = { ...storedConfig, ...patch };
  // Don't persist env-derived fields if they came purely from env.
  const onDisk = { ...storedConfig };
  await fs.writeJson(configPath(), onDisk, { spaces: 2 });
  // Refresh the client.
  ensureClient(true);
}

function ensureClient(forceReload = false): JoyBridgeClient {
  if (!client || forceReload) {
    client = new JoyBridgeClient({
      apiBase: storedConfig.apiBase,
      webBase: storedConfig.webBase,
      apiKey: storedConfig.apiKey,
      supabaseUrl: storedConfig.supabaseUrl,
      supabasePublishableKey: storedConfig.supabasePublishableKey,
    });
  }
  return client;
}

// -- Pure helpers (exported for tests) --------------------------------------

export const __test__ = {
  /** Names of every IPC channel this module registers. */
  CHANNELS: [
    "joybridge:get-config",
    "joybridge:connect",
    "joybridge:create-store",
    "joybridge:get-store",
    "joybridge:list-my-stores",
    "joybridge:publish-asset",
    "joybridge:get-asset",
    "joybridge:list-my-assets",
    "joybridge:browse-marketplace",
    "joybridge:goldsky-query",
    "joybridge:pin-to-ipfs",
  ] as const,
  loadConfig,
  saveConfig,
  ensureClient,
  /** For tests only — inject a fully-formed client. */
  setClientForTests(c: JoyBridgeClient | undefined): void {
    client = c;
  },
  /** Reset in-memory state for tests. */
  resetForTests(): void {
    storedConfig = {};
    client = undefined;
  },
};

// -- Registration ------------------------------------------------------------

export function registerJoyBridgeHandlers(): void {
  // Lazy load on first call rather than at register time.
  ipcMain.handle("joybridge:get-config", async () => {
    await loadConfig();
    const c = ensureClient();
    return c.getConfig();
  });

  ipcMain.handle(
    "joybridge:connect",
    async (
      _e,
      input: {
        apiKey?: string;
        apiBase?: string;
        webBase?: string;
        supabaseUrl?: string;
        supabasePublishableKey?: string;
      },
    ) => {
      await loadConfig();
      await saveConfig({
        apiKey: input.apiKey ?? storedConfig.apiKey,
        apiBase: input.apiBase ?? storedConfig.apiBase,
        webBase: input.webBase ?? storedConfig.webBase,
        supabaseUrl: input.supabaseUrl ?? storedConfig.supabaseUrl,
        supabasePublishableKey:
          input.supabasePublishableKey ?? storedConfig.supabasePublishableKey,
      });
      const c = ensureClient(true);
      logger.info("JoyBridge connected", { apiBase: c.getConfig().apiBase });
      return c.getConfig();
    },
  );

  ipcMain.handle(
    "joybridge:create-store",
    async (_e, input: CreateStoreInput) => {
      await loadConfig();
      return ensureClient().createStore(input);
    },
  );

  ipcMain.handle("joybridge:get-store", async (_e, slug: string) => {
    await loadConfig();
    return ensureClient().getStore(slug);
  });

  ipcMain.handle("joybridge:list-my-stores", async () => {
    await loadConfig();
    return ensureClient().listMyStores();
  });

  ipcMain.handle(
    "joybridge:publish-asset",
    async (_e, input: PublishAssetInput) => {
      await loadConfig();
      return ensureClient().publishAsset(input);
    },
  );

  ipcMain.handle("joybridge:get-asset", async (_e, idOrToken: string) => {
    await loadConfig();
    return ensureClient().getAsset(idOrToken);
  });

  ipcMain.handle("joybridge:list-my-assets", async () => {
    await loadConfig();
    return ensureClient().listMyAssets();
  });

  ipcMain.handle(
    "joybridge:browse-marketplace",
    async (_e, query: BrowseQuery) => {
      await loadConfig();
      return ensureClient().browseMarketplace(query ?? {});
    },
  );

  ipcMain.handle(
    "joybridge:goldsky-query",
    async (
      _e,
      input: {
        endpoint: string;
        query: string;
        variables?: Record<string, unknown>;
      },
    ) => {
      await loadConfig();
      return ensureClient().goldskyQuery(
        input.endpoint,
        input.query,
        input.variables,
      );
    },
  );

  ipcMain.handle(
    "joybridge:pin-to-ipfs",
    async (
      _e,
      input: {
        data: ArrayBuffer | string;
        filename?: string;
        contentType?: string;
      },
    ) => {
      await loadConfig();
      return ensureClient().pinToIpfs(input);
    },
  );

  logger.info(`JoyBridge handlers registered (${__test__.CHANNELS.length} channels)`);
}

export default registerJoyBridgeHandlers;
