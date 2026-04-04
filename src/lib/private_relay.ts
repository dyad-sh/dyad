/**
 * Onion-Routed Private Relay
 *
 * Implements Tor-like onion routing over the libp2p network so that
 * no single node (including entry/exit relays) can correlate sender
 * and recipient of a message.
 *
 * Flow:
 *  1. Sender discovers relay nodes from DHT
 *  2. Sender picks 3 relays (entry → middle → exit) at random
 *  3. Message is wrapped in 3 encryption layers (innermost = exit key, outermost = entry key)
 *  4. Entry relay strips outer layer → forwards to middle
 *  5. Middle relay strips its layer → forwards to exit
 *  6. Exit relay strips final layer → delivers to recipient via PubSub/DHT
 *
 * Privacy guarantees:
 *  - Entry relay knows sender but NOT recipient
 *  - Middle relay knows neither sender nor recipient
 *  - Exit relay knows recipient but NOT sender
 *  - Message content is end-to-end encrypted (Double Ratchet) on top of onion encryption
 */

import * as crypto from "crypto";
import log from "electron-log";
import type {
  OnionCircuit,
  OnionPacket,
  RelayNode,
  CoverTrafficConfig,
} from "@/types/private_chat_types";

const logger = log.scope("private-relay");

// ESM module imports — loaded lazily
let nacl: any;
let naclUtil: any;

async function loadNacl() {
  if (!nacl) {
    nacl = await import("tweetnacl");
    naclUtil = await import("tweetnacl-util");
  }
}

// ============================================================================
// Relay Node Pool
// ============================================================================

/** Known relay nodes, indexed by peerId */
const relayPool = new Map<string, RelayNode>();

/** Active onion circuits */
const activeCircuits = new Map<string, OnionCircuit>();

// Default circuit parameters
const MIN_HOPS = 3;
const MAX_MESSAGES_PER_CIRCUIT = 200;
const CIRCUIT_LIFETIME_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Register a relay node discovered from DHT or direct announcement.
 */
export function addRelayNode(relay: RelayNode): void {
  relayPool.set(relay.peerId, relay);
  logger.debug("Relay node added", { peerId: relay.peerId, reputation: relay.reputation });
}

/**
 * Remove relay node (went offline or misbehaved).
 */
export function removeRelayNode(peerId: string): void {
  relayPool.delete(peerId);
  logger.debug("Relay node removed", { peerId });
}

/**
 * Get all known relay nodes, sorted by reputation.
 */
export function getRelayNodes(): RelayNode[] {
  return Array.from(relayPool.values()).sort((a, b) => b.reputation - a.reputation);
}

/**
 * Select N random relay nodes for a circuit path.
 * - Avoids selecting the same node twice
 * - Prefers high-reputation, low-latency nodes
 * - Avoids nodes in the same region (AS/geo diversity)
 */
export function selectRelayPath(
  hops: number = MIN_HOPS,
  excludePeerIds: string[] = [],
): RelayNode[] {
  const candidates = Array.from(relayPool.values())
    .filter((r) => !excludePeerIds.includes(r.peerId))
    .filter((r) => r.reputation >= 30)
    .filter((r) => Date.now() - new Date(r.lastSeen).getTime() < 300_000); // seen in last 5 min

  if (candidates.length < hops) {
    throw new Error(
      `Not enough relay nodes: need ${hops}, have ${candidates.length}`,
    );
  }

  // Weighted random selection favoring reputation
  const selected: RelayNode[] = [];
  const remaining = [...candidates];

  for (let i = 0; i < hops; i++) {
    // Weight by reputation (squared for stronger preference)
    const weights = remaining.map((r) => r.reputation * r.reputation);
    const totalWeight = weights.reduce((s, w) => s + w, 0);
    let roll = Math.random() * totalWeight;

    let idx = 0;
    for (idx = 0; idx < weights.length; idx++) {
      roll -= weights[idx];
      if (roll <= 0) break;
    }

    const chosen = remaining[idx];
    selected.push(chosen);

    // Remove from pool + remove same-region nodes for diversity
    remaining.splice(idx, 1);
    if (chosen.region) {
      // Try to pick from different regions, but don't fail if impossible
      const sameRegion = remaining.filter((r) => r.region === chosen.region);
      if (remaining.length - sameRegion.length >= hops - i - 1) {
        // Safe to remove same-region nodes
        for (const sr of sameRegion) {
          const srIdx = remaining.indexOf(sr);
          if (srIdx >= 0) remaining.splice(srIdx, 1);
        }
      }
    }
  }

  return selected;
}

// ============================================================================
// Circuit Management
// ============================================================================

/**
 * Build a new onion circuit through the relay network.
 * Returns the circuit with pre-computed shared secrets per hop.
 */
export async function buildCircuit(
  hops: number = MIN_HOPS,
  excludePeerIds: string[] = [],
): Promise<OnionCircuit> {
  await loadNacl();

  const relays = selectRelayPath(hops, excludePeerIds);
  const hopKeys: string[] = [];

  // For each relay, compute an ephemeral shared secret via X25519
  for (const relay of relays) {
    const ephemeral = nacl.box.keyPair();
    const relayPubKey = naclUtil.decodeBase64(relay.publicKey);
    // X25519 shared secret
    const shared = nacl.box.before(relayPubKey, ephemeral.secretKey);
    hopKeys.push(naclUtil.encodeBase64(shared));
  }

  const now = new Date();
  const circuit: OnionCircuit = {
    id: `circuit-${crypto.randomBytes(16).toString("hex")}`,
    relayPeerIds: relays.map((r) => r.peerId),
    hopKeys,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + CIRCUIT_LIFETIME_MS).toISOString(),
    messageCount: 0,
    maxMessages: MAX_MESSAGES_PER_CIRCUIT,
  };

  activeCircuits.set(circuit.id, circuit);
  logger.info("Circuit built", {
    id: circuit.id,
    hops: circuit.relayPeerIds.length,
  });

  return circuit;
}

/**
 * Destroy a circuit and clean up shared secrets.
 */
export function destroyCircuit(circuitId: string): void {
  const circuit = activeCircuits.get(circuitId);
  if (circuit) {
    // Zero out hop keys before deletion
    circuit.hopKeys = circuit.hopKeys.map(() => "");
    activeCircuits.delete(circuitId);
    logger.info("Circuit destroyed", { id: circuitId });
  }
}

/**
 * Get a usable circuit, building a new one if all are expired/exhausted.
 */
export async function getOrBuildCircuit(
  excludePeerIds: string[] = [],
): Promise<OnionCircuit> {
  // Find a valid circuit
  for (const [, circuit] of activeCircuits) {
    const expired = new Date(circuit.expiresAt).getTime() < Date.now();
    const exhausted = circuit.messageCount >= circuit.maxMessages;
    if (!expired && !exhausted) {
      return circuit;
    }
    // Clean up invalid
    destroyCircuit(circuit.id);
  }

  // Build new
  return buildCircuit(MIN_HOPS, excludePeerIds);
}

/**
 * Rotate a circuit: destroy old, build new.
 */
export async function rotateCircuit(oldCircuitId: string): Promise<OnionCircuit> {
  const old = activeCircuits.get(oldCircuitId);
  const exclude = old?.relayPeerIds ?? [];
  destroyCircuit(oldCircuitId);
  return buildCircuit(MIN_HOPS, exclude);
}

// ============================================================================
// Onion Wrapping / Unwrapping
// ============================================================================

/**
 * Wrap a plaintext payload in multiple onion encryption layers.
 * The outermost layer is encrypted for the entry relay;
 * the innermost for the exit relay.
 *
 * Each layer contains:
 *  - The next hop's peerId (so the relay knows where to forward)
 *  - The remaining onion (encrypted for the next hop)
 *
 * The innermost layer contains:
 *  - The recipient's wallet address (for exit relay PubSub delivery)
 *  - The encrypted message payload (end-to-end encrypted by Double Ratchet)
 */
export async function wrapOnion(
  circuit: OnionCircuit,
  recipientWallet: string,
  payload: string,
): Promise<OnionPacket> {
  await loadNacl();

  // Build from inside out
  // Innermost: { nextHop: "DELIVER", recipient: walletAddr, payload: e2eEncryptedMsg }
  let current = JSON.stringify({
    nextHop: "DELIVER",
    recipient: recipientWallet,
    payload,
  });

  // Wrap each layer from exit → entry
  for (let i = circuit.hopKeys.length - 1; i >= 0; i--) {
    const sharedKey = naclUtil.decodeBase64(circuit.hopKeys[i]);
    const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
    const encrypted = nacl.secretbox(
      naclUtil.decodeUTF8(current),
      nonce,
      sharedKey,
    );

    const nextHop =
      i < circuit.hopKeys.length - 1
        ? circuit.relayPeerIds[i + 1]
        : "EXIT";

    current = JSON.stringify({
      nextHop,
      nonce: naclUtil.encodeBase64(nonce),
      data: naclUtil.encodeBase64(encrypted),
    });
  }

  circuit.messageCount++;

  return {
    id: crypto.randomBytes(16).toString("hex"),
    payload: current,
    timestamp: Math.floor(Date.now() / 1000),
    ttl: circuit.relayPeerIds.length + 1,
  };
}

/**
 * Unwrap one layer of an onion packet (called by relay nodes).
 * Returns either:
 *  - { forward: true, nextPeerId, packet } — relay should forward
 *  - { deliver: true, recipient, payload } — exit relay should deliver
 */
export async function unwrapOnionLayer(
  packet: OnionPacket,
  mySharedKey: string,
): Promise<
  | { forward: true; nextPeerId: string; packet: OnionPacket }
  | { deliver: true; recipient: string; payload: string }
> {
  await loadNacl();

  if (packet.ttl <= 0) {
    throw new Error("Onion packet TTL expired");
  }

  // Replay prevention: check timestamp is within 5 minutes
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - packet.timestamp) > 300) {
    throw new Error("Onion packet timestamp out of range");
  }

  const layer = JSON.parse(packet.payload);
  const sharedKey = naclUtil.decodeBase64(mySharedKey);
  const nonce = naclUtil.decodeBase64(layer.nonce);
  const encrypted = naclUtil.decodeBase64(layer.data);

  const decrypted = nacl.secretbox.open(encrypted, nonce, sharedKey);
  if (!decrypted) {
    throw new Error("Failed to decrypt onion layer");
  }

  const inner = JSON.parse(naclUtil.encodeUTF8(decrypted));

  if (inner.nextHop === "DELIVER") {
    return { deliver: true, recipient: inner.recipient, payload: inner.payload };
  }

  return {
    forward: true,
    nextPeerId: inner.nextHop,
    packet: {
      id: packet.id,
      payload: JSON.stringify(inner),
      timestamp: packet.timestamp,
      ttl: packet.ttl - 1,
    },
  };
}

// ============================================================================
// Cover Traffic
// ============================================================================

let coverTrafficInterval: ReturnType<typeof setInterval> | null = null;
let coverTrafficConfig: CoverTrafficConfig = {
  enabled: false,
  intervalMs: 5000,
  jitterMs: 2000,
  paddedSizeBytes: 1024,
  maxBandwidthKbps: 10,
};

/**
 * Start emitting cover (dummy) traffic at a constant rate.
 * Cover packets are indistinguishable from real messages to observers.
 */
export function startCoverTraffic(
  config: Partial<CoverTrafficConfig> = {},
  sendFn: (packet: OnionPacket) => Promise<void>,
): void {
  coverTrafficConfig = { ...coverTrafficConfig, ...config, enabled: true };

  if (coverTrafficInterval) {
    clearInterval(coverTrafficInterval);
  }

  const send = async () => {
    try {
      // Build a dummy packet with random padding
      const padding = crypto.randomBytes(coverTrafficConfig.paddedSizeBytes).toString("base64");
      const circuit = activeCircuits.values().next().value;
      if (!circuit) return; // No circuit available

      const packet = await wrapOnion(circuit, "COVER_TRAFFIC", padding);
      await sendFn(packet);
    } catch {
      // Cover traffic failures are silent
    }
  };

  coverTrafficInterval = setInterval(() => {
    // Add jitter
    const jitter = Math.random() * coverTrafficConfig.jitterMs * 2 - coverTrafficConfig.jitterMs;
    setTimeout(send, Math.max(0, jitter));
  }, coverTrafficConfig.intervalMs);

  logger.info("Cover traffic started", {
    intervalMs: coverTrafficConfig.intervalMs,
    paddedSize: coverTrafficConfig.paddedSizeBytes,
  });
}

/**
 * Stop cover traffic.
 */
export function stopCoverTraffic(): void {
  if (coverTrafficInterval) {
    clearInterval(coverTrafficInterval);
    coverTrafficInterval = null;
  }
  coverTrafficConfig.enabled = false;
  logger.info("Cover traffic stopped");
}

/**
 * Get current cover traffic status.
 */
export function getCoverTrafficStatus(): CoverTrafficConfig {
  return { ...coverTrafficConfig };
}

// ============================================================================
// Service Status
// ============================================================================

export function getRelayStatus() {
  return {
    relayNodesKnown: relayPool.size,
    activeCircuits: activeCircuits.size,
    coverTrafficActive: coverTrafficConfig.enabled,
    circuits: Array.from(activeCircuits.values()).map((c) => ({
      id: c.id,
      hops: c.relayPeerIds.length,
      messageCount: c.messageCount,
      maxMessages: c.maxMessages,
      expiresAt: c.expiresAt,
    })),
  };
}
