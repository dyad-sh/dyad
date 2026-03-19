/**
 * Tailscale Service
 * =================
 * Detects Tailscale VPN, resolves tailnet IPs, and provides
 * service URL resolution for accessing local services over tailnet.
 *
 * When Tailscale is active, services (Ollama, n8n, Celestia, OpenClaw)
 * can be accessed from any device on the tailnet using the machine's
 * Tailscale IP instead of localhost.
 */

import { exec } from "child_process";
import { promisify } from "util";
import log from "electron-log";
import { readSettings, writeSettings } from "../main/settings";

const execAsync = promisify(exec);
const logger = log.scope("tailscale");

// Tailscale CGNAT range: 100.64.0.0/10
const TAILSCALE_CIDR_START = 0x64400000; // 100.64.0.0
const TAILSCALE_CIDR_END = 0x647fffff; // 100.127.255.255

export interface TailscaleStatus {
  installed: boolean;
  running: boolean;
  tailnetIp: string | null;
  hostname: string | null;
  tailnetName: string | null;
  version: string | null;
}

export interface TailscaleConfig {
  enabled: boolean;
  /** Use tailnet IP for service URLs instead of localhost */
  exposeServices: boolean;
  /** Override IP (if auto-detect fails) */
  manualIp?: string;
  /** Services to expose over tailnet */
  exposedServices: {
    ollama: boolean;
    n8n: boolean;
    celestia: boolean;
    openclaw: boolean;
  };
}

const DEFAULT_CONFIG: TailscaleConfig = {
  enabled: false,
  exposeServices: false,
  exposedServices: {
    ollama: true,
    n8n: true,
    celestia: true,
    openclaw: true,
  },
};

// Service port registry
const SERVICE_PORTS: Record<string, number> = {
  ollama: 11434,
  n8n: 5678,
  celestia: 26658,
  openclaw: 18789,
  lmstudio: 1234,
};

let cachedStatus: TailscaleStatus | null = null;
let statusCacheTime = 0;
const STATUS_CACHE_MS = 30_000; // 30s cache

/**
 * Check if an IPv4 address is in the Tailscale CGNAT range (100.64.0.0/10).
 */
function isTailscaleIp(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return false;
  const numeric = (parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3];
  return numeric >= TAILSCALE_CIDR_START && numeric <= TAILSCALE_CIDR_END;
}

/**
 * Detect Tailscale status on this machine.
 */
export async function getTailscaleStatus(
  forceRefresh = false,
): Promise<TailscaleStatus> {
  if (!forceRefresh && cachedStatus && Date.now() - statusCacheTime < STATUS_CACHE_MS) {
    return cachedStatus;
  }

  const result: TailscaleStatus = {
    installed: false,
    running: false,
    tailnetIp: null,
    hostname: null,
    tailnetName: null,
    version: null,
  };

  try {
    // Try `tailscale status --json` (works on Windows, macOS, Linux)
    const { stdout } = await execAsync("tailscale status --json", {
      timeout: 5000,
    });

    const status = JSON.parse(stdout);
    result.installed = true;

    // BackendState: "Running", "Stopped", "NeedsLogin", etc.
    if (status.BackendState === "Running") {
      result.running = true;
    }

    // Self node info
    if (status.Self) {
      // TailscaleIPs is an array of IPs (v4 + v6)
      const ips: string[] = status.Self.TailscaleIPs || [];
      result.tailnetIp = ips.find(isTailscaleIp) ?? ips[0] ?? null;
      result.hostname = status.Self.HostName ?? null;
    }

    // MagicDNSSuffix gives the tailnet name
    result.tailnetName = status.MagicDNSSuffix ?? null;

    // Version
    if (status.Version) {
      result.version = status.Version;
    }
  } catch (err) {
    // tailscale CLI not found or not running
    try {
      // Check if just installed but not running
      const { stdout } = await execAsync("tailscale version", {
        timeout: 3000,
      });
      if (stdout.trim()) {
        result.installed = true;
        result.version = stdout.trim().split("\n")[0];
      }
    } catch {
      // Not installed
    }
  }

  cachedStatus = result;
  statusCacheTime = Date.now();
  logger.info("Tailscale status:", {
    installed: result.installed,
    running: result.running,
    ip: result.tailnetIp,
    tailnet: result.tailnetName,
  });

  return result;
}

/**
 * Get the Tailscale config from user settings.
 */
export function getTailscaleConfig(): TailscaleConfig {
  const settings = readSettings();
  return (settings as any).tailscale ?? { ...DEFAULT_CONFIG };
}

/**
 * Save Tailscale config to user settings.
 */
export function saveTailscaleConfig(config: TailscaleConfig): void {
  writeSettings({ tailscale: config } as any);
  // Invalidate cache so next getServiceUrl() picks up changes
  cachedStatus = null;
}

/**
 * Resolve a service URL — returns tailnet URL if Tailscale is enabled and
 * the service is exposed, otherwise returns the localhost URL.
 */
export async function getServiceUrl(
  service: keyof typeof SERVICE_PORTS,
  protocol = "http",
): Promise<string> {
  const config = getTailscaleConfig();

  if (
    config.enabled &&
    config.exposeServices &&
    config.exposedServices[service as keyof typeof config.exposedServices]
  ) {
    const ip = config.manualIp || (await getTailscaleStatus()).tailnetIp;
    if (ip) {
      const port = SERVICE_PORTS[service];
      return `${protocol}://${ip}:${port}`;
    }
  }

  // Fallback to localhost
  const port = SERVICE_PORTS[service];
  return `${protocol}://localhost:${port}`;
}

/**
 * Get all service URLs (for display in UI).
 */
export async function getAllServiceUrls(): Promise<
  Record<string, { local: string; tailnet: string | null }>
> {
  const status = await getTailscaleStatus();
  const config = getTailscaleConfig();
  const urls: Record<string, { local: string; tailnet: string | null }> = {};

  for (const [service, port] of Object.entries(SERVICE_PORTS)) {
    const local = `http://localhost:${port}`;
    let tailnet: string | null = null;

    if (
      status.running &&
      status.tailnetIp &&
      config.enabled &&
      config.exposeServices
    ) {
      tailnet = `http://${status.tailnetIp}:${port}`;
    }

    urls[service] = { local, tailnet };
  }

  return urls;
}

/**
 * Quick check: is Tailscale active and configured for service exposure?
 */
export async function isTailscaleActive(): Promise<boolean> {
  const config = getTailscaleConfig();
  if (!config.enabled || !config.exposeServices) return false;

  const status = await getTailscaleStatus();
  return status.running && !!status.tailnetIp;
}
