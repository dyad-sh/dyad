import log from "electron-log";
import { z } from "zod";

const logger = log.scope("remote_desktop_config");

const REMOTE_DESKTOP_CONFIG_TIMEOUT_MS = 5_000;
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;
const FAILURE_CACHE_TTL_MS = 30 * 1000;

const RemoteDesktopConfigSchema = z.object({
  version: z.string().optional(),
  expiresAt: z.string().datetime().optional(),
  defaults: z
    .object({
      blockUnsafeNpmPackages: z.boolean().optional(),
    })
    .optional(),
});

export type RemoteDesktopConfig = z.infer<typeof RemoteDesktopConfigSchema>;

type RemoteDesktopConfigCacheEntry = {
  config: RemoteDesktopConfig | null;
  expiresAt: number;
};

let remoteDesktopConfigCache: RemoteDesktopConfigCacheEntry | null = null;
let remoteDesktopConfigFetchPromise: Promise<RemoteDesktopConfig | null> | null =
  null;

function getRemoteDesktopConfigUrl() {
  if (process.env.DYAD_DESKTOP_CONFIG_URL) {
    return process.env.DYAD_DESKTOP_CONFIG_URL;
  }

  return "https://api.dyad.sh/v1/desktop-config";
}

async function fetchRemoteDesktopConfig(): Promise<RemoteDesktopConfig | null> {
  const response = await fetch(getRemoteDesktopConfigUrl(), {
    signal: AbortSignal.timeout(REMOTE_DESKTOP_CONFIG_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(
      `Desktop config request failed with status ${response.status}`,
    );
  }

  const json = await response.json();
  return RemoteDesktopConfigSchema.parse(json);
}

export async function getRemoteDesktopConfig(): Promise<RemoteDesktopConfig | null> {
  if (
    remoteDesktopConfigCache &&
    remoteDesktopConfigCache.expiresAt > Date.now()
  ) {
    return remoteDesktopConfigCache.config;
  }

  if (!remoteDesktopConfigFetchPromise) {
    remoteDesktopConfigFetchPromise = (async () => {
      try {
        const config = await fetchRemoteDesktopConfig();
        remoteDesktopConfigCache = {
          config,
          expiresAt: config?.expiresAt
            ? Date.parse(config.expiresAt)
            : Date.now() + DEFAULT_CACHE_TTL_MS,
        };
        return config;
      } catch (error) {
        logger.warn("Failed to fetch remote desktop config", error);
        remoteDesktopConfigCache = {
          config: null,
          expiresAt: Date.now() + FAILURE_CACHE_TTL_MS,
        };
        return null;
      } finally {
        remoteDesktopConfigFetchPromise = null;
      }
    })();
  }

  return remoteDesktopConfigFetchPromise;
}
