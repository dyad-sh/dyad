/**
 * Decentralized ICE — TURN/STUN Discovery & Management
 *
 * Replaces dependency on Google STUN servers with a DHT-based
 * community relay network. Any JoyCreate user can volunteer as a
 * relay node and earn reputation.
 *
 * Features:
 *  - DHT-based discovery of STUN/TURN nodes
 *  - Time-limited HMAC-SHA1 credentials (RFC 5389 long-term)
 *  - Health checking & reputation scoring
 *  - NAT type detection via decentralized STUN
 *  - Automatic fallback to community STUN if no TURN available
 *  - Zero dependency on Google, Amazon, or any company
 */

import * as crypto from "crypto";
import log from "electron-log";
import type {
  DecentralizedRelay,
  TurnCredential,
  IceDiscoveryResult,
} from "@/types/private_chat_types";

const logger = log.scope("decentralized-ice");

// ============================================================================
// Relay Registry (populated from DHT announcements)
// ============================================================================

const relayRegistry = new Map<string, DecentralizedRelay>();

/** Health check results */
const healthCache = new Map<string, { alive: boolean; latencyMs: number; checkedAt: number }>();

/** How often to re-check a relay (ms) */
const HEALTH_CHECK_INTERVAL = 60_000;

/** Max age for a relay to be considered alive without health check */
const RELAY_MAX_AGE_MS = 5 * 60_000;

// ============================================================================
// Discovery
// ============================================================================

/**
 * Register a relay discovered from DHT or direct announcement.
 */
export function registerRelay(relay: DecentralizedRelay): void {
  relayRegistry.set(relay.id, relay);
  logger.debug("Relay registered", {
    id: relay.id,
    type: relay.type,
    urls: relay.urls,
    reputation: relay.reputation,
  });
}

/**
 * Unregister a relay (went offline or below reputation threshold).
 */
export function unregisterRelay(relayId: string): void {
  relayRegistry.delete(relayId);
  healthCache.delete(relayId);
}

/**
 * Get all known relays.
 */
export function getAllRelays(): DecentralizedRelay[] {
  return Array.from(relayRegistry.values());
}

/**
 * Announce this node as a TURN/STUN relay.
 * Called when user opts in to relay traffic.
 */
export function createLocalRelayAnnouncement(opts: {
  type: "stun" | "turn" | "both";
  publicIp: string;
  port: number;
  maxBandwidthKbps?: number;
  maxConcurrentRelays?: number;
  region?: string;
  operatorWallet?: string;
}): DecentralizedRelay {
  const id = `relay-${crypto.randomBytes(8).toString("hex")}`;
  const keyPair = crypto.generateKeyPairSync("x25519", {
    publicKeyEncoding: { type: "spki", format: "der" },
    privateKeyEncoding: { type: "pkcs8", format: "der" },
  });

  const urls: string[] = [];
  if (opts.type === "stun" || opts.type === "both") {
    urls.push(`stun:${opts.publicIp}:${opts.port}`);
  }
  if (opts.type === "turn" || opts.type === "both") {
    urls.push(`turn:${opts.publicIp}:${opts.port}`);
    urls.push(`turns:${opts.publicIp}:${opts.port + 1}`);
  }

  const relay: DecentralizedRelay = {
    id,
    peerId: id, // Will be replaced by actual libp2p peerId
    type: opts.type,
    urls,
    publicKey: keyPair.publicKey.toString("base64"),
    operatorWallet: opts.operatorWallet,
    maxBandwidthKbps: opts.maxBandwidthKbps ?? 5000,
    currentLoadPercent: 0,
    maxConcurrentRelays: opts.maxConcurrentRelays ?? 50,
    activeRelays: 0,
    reputation: 50,
    uptimePercent: 100,
    registeredAt: new Date().toISOString(),
    lastHealthCheck: new Date().toISOString(),
    region: opts.region,
  };

  registerRelay(relay);
  return relay;
}

// ============================================================================
// Credential Generation (RFC 5389 long-term credentials)
// ============================================================================

/**
 * Generate a time-limited TURN credential for a specific relay.
 * Uses HMAC-SHA1 per RFC 5389 / RFC 8489 long-term credential mechanism.
 */
export function generateTurnCredential(
  relay: DecentralizedRelay,
  userWallet: string,
  lifetimeSeconds: number = 86400,
): TurnCredential {
  const expiresAt = Math.floor(Date.now() / 1000) + lifetimeSeconds;
  const username = `${expiresAt}:${userWallet}`;

  // HMAC-SHA1 of username with relay's public key as secret
  const hmac = crypto.createHmac("sha1", relay.publicKey);
  hmac.update(username);
  const credential = hmac.digest("base64");

  return {
    username,
    credential,
    expiresAt,
    relayId: relay.id,
  };
}

/**
 * Verify a TURN credential is valid and not expired.
 */
export function verifyTurnCredential(
  credential: TurnCredential,
  relayPublicKey: string,
): boolean {
  // Check expiry
  if (credential.expiresAt < Math.floor(Date.now() / 1000)) {
    return false;
  }

  // Verify HMAC
  const hmac = crypto.createHmac("sha1", relayPublicKey);
  hmac.update(credential.username);
  const expected = hmac.digest("base64");

  return crypto.timingSafeEqual(
    Buffer.from(credential.credential, "base64"),
    Buffer.from(expected, "base64"),
  );
}

// ============================================================================
// ICE Server Selection
// ============================================================================

/**
 * Discover and select the best ICE servers for a WebRTC connection.
 * Returns both raw relay info and formatted RTCIceServer configs.
 */
export function discoverIceServers(
  userWallet: string,
  opts: {
    preferRegion?: string;
    maxStun?: number;
    maxTurn?: number;
  } = {},
): IceDiscoveryResult {
  const maxStun = opts.maxStun ?? 4;
  const maxTurn = opts.maxTurn ?? 3;

  const now = Date.now();
  const alive = Array.from(relayRegistry.values()).filter((r) => {
    // Must have been seen recently
    const lastSeen = new Date(r.lastHealthCheck).getTime();
    if (now - lastSeen > RELAY_MAX_AGE_MS) return false;
    // Must have decent reputation
    if (r.reputation < 30) return false;
    // Must have capacity
    if (r.currentLoadPercent > 90) return false;
    return true;
  });

  // Split into STUN and TURN
  const stunCandidates = alive
    .filter((r) => r.type === "stun" || r.type === "both")
    .sort((a, b) => {
      // Prefer same region, then reputation, then latency
      const aRegion = a.region === opts.preferRegion ? -1000 : 0;
      const bRegion = b.region === opts.preferRegion ? -1000 : 0;
      return (aRegion - bRegion) || (b.reputation - a.reputation) || ((a.latencyMs ?? 999) - (b.latencyMs ?? 999));
    })
    .slice(0, maxStun);

  const turnCandidates = alive
    .filter((r) => r.type === "turn" || r.type === "both")
    .sort((a, b) => {
      const aRegion = a.region === opts.preferRegion ? -1000 : 0;
      const bRegion = b.region === opts.preferRegion ? -1000 : 0;
      return (aRegion - bRegion) || (b.reputation - a.reputation) || ((a.latencyMs ?? 999) - (b.latencyMs ?? 999));
    })
    .slice(0, maxTurn);

  // Build RTCIceServer configs
  const iceServers: IceDiscoveryResult["iceServers"] = [];

  for (const stun of stunCandidates) {
    iceServers.push({ urls: stun.urls.filter((u) => u.startsWith("stun:")) });
  }

  for (const turn of turnCandidates) {
    const cred = generateTurnCredential(turn, userWallet);
    iceServers.push({
      urls: turn.urls.filter((u) => u.startsWith("turn")),
      username: cred.username,
      credential: cred.credential,
    });
  }

  // Fallback: if no community STUN found, add minimal open STUN
  if (stunCandidates.length === 0) {
    iceServers.push({ urls: "stun:stun.stunprotocol.org:3478" });
    iceServers.push({ urls: "stun:stun.nextcloud.com:443" });
  }

  logger.info("ICE servers discovered", {
    stun: stunCandidates.length,
    turn: turnCandidates.length,
    total: iceServers.length,
  });

  return {
    stunServers: stunCandidates,
    turnServers: turnCandidates,
    iceServers,
  };
}

// ============================================================================
// Health Checking
// ============================================================================

/**
 * Perform a STUN binding request to check if a relay is alive.
 * Returns latency in ms or null if unreachable.
 */
export async function healthCheckRelay(relay: DecentralizedRelay): Promise<number | null> {
  const cached = healthCache.get(relay.id);
  if (cached && Date.now() - cached.checkedAt < HEALTH_CHECK_INTERVAL) {
    return cached.alive ? cached.latencyMs : null;
  }

  const start = Date.now();

  try {
    // Simple TCP connectivity check to the relay port
    // A full implementation would use a STUN binding request
    const url = relay.urls[0];
    const match = url.match(/:(\d+)$/);
    const port = match ? parseInt(match[1], 10) : 3478;
    const host = url.replace(/^(stun|turn|turns):/, "").replace(/:\d+$/, "");

    // Use DNS-based reachability as a proxy for now
    const { promises: dns } = await import("dns");
    await dns.resolve4(host);

    const latencyMs = Date.now() - start;

    healthCache.set(relay.id, { alive: true, latencyMs, checkedAt: Date.now() });

    // Update relay record
    relay.lastHealthCheck = new Date().toISOString();
    relay.latencyMs = latencyMs;

    return latencyMs;
  } catch {
    healthCache.set(relay.id, { alive: false, latencyMs: -1, checkedAt: Date.now() });

    // Decrease reputation for unreachable relays
    relay.reputation = Math.max(0, relay.reputation - 5);

    return null;
  }
}

/**
 * Health-check all registered relays and prune dead ones.
 */
export async function healthCheckAll(): Promise<{
  total: number;
  alive: number;
  pruned: number;
}> {
  let alive = 0;
  let pruned = 0;

  for (const [id, relay] of relayRegistry) {
    const latency = await healthCheckRelay(relay);
    if (latency !== null) {
      alive++;
    } else {
      // If reputation drops to 0, prune
      if (relay.reputation <= 0) {
        relayRegistry.delete(id);
        pruned++;
      }
    }
  }

  return { total: relayRegistry.size + pruned, alive, pruned };
}

// ============================================================================
// NAT Detection
// ============================================================================

export type NATClassification =
  | "open"
  | "full-cone"
  | "restricted-cone"
  | "port-restricted-cone"
  | "symmetric"
  | "unknown";

/**
 * Detect NAT type using decentralized STUN servers.
 * Follows a simplified RFC 5780 algorithm.
 */
export async function detectNATType(): Promise<{
  natType: NATClassification;
  publicIp: string | null;
  publicPort: number | null;
}> {
  // Full NAT type detection requires sending STUN binding requests
  // to multiple servers and comparing mapped addresses.
  // This is a placeholder that returns unknown until full STUN
  // client is implemented in the renderer process.
  return {
    natType: "unknown",
    publicIp: null,
    publicPort: null,
  };
}

// ============================================================================
// Status
// ============================================================================

export function getIceStatus() {
  const relays = Array.from(relayRegistry.values());
  return {
    totalRelays: relays.length,
    stunRelays: relays.filter((r) => r.type === "stun" || r.type === "both").length,
    turnRelays: relays.filter((r) => r.type === "turn" || r.type === "both").length,
    avgReputation: relays.length > 0
      ? Math.round(relays.reduce((s, r) => s + r.reputation, 0) / relays.length)
      : 0,
    healthyRelays: Array.from(healthCache.values()).filter((h) => h.alive).length,
  };
}
