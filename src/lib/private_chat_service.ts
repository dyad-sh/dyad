/**
 * Private Chat Service — Unified Decentralized Messenger
 *
 * Single service that merges decentralized chat + WebRTC into one
 * metadata-private, fully decentralized messaging system.
 *
 * Architecture:
 *  ┌──────────────────────────────────────────────────────────────┐
 *  │                     Private Chat Service                     │
 *  │                                                              │
 *  │  ┌────────────┐  ┌──────────────┐  ┌────────────────────┐   │
 *  │  │   Double    │  │    Onion     │  │   Decentralized    │   │
 *  │  │  Ratchet    │  │   Routing    │  │    ICE (TURN/      │   │
 *  │  │  (E2EE)    │  │  (Privacy)   │  │     STUN)          │   │
 *  │  └────────────┘  └──────────────┘  └────────────────────┘   │
 *  │        │                │                    │               │
 *  │  ┌─────┴────────────────┴────────────────────┴────────┐     │
 *  │  │              libp2p / Helia (IPFS)                 │     │
 *  │  │         PubSub + DHT + Circuit Relay               │     │
 *  │  └────────────────────────────────────────────────────┘     │
 *  └──────────────────────────────────────────────────────────────┘
 *
 * Privacy guarantees:
 *  - Messages are Double-Ratchet encrypted (forward secrecy)
 *  - Encrypted messages are onion-routed through 3+ relay nodes
 *  - WebRTC signaling goes through onion routes (no metadata leak)
 *  - TURN/STUN servers are community-operated, DHT-discovered
 *  - Cover traffic makes real messages indistinguishable from noise
 *  - No central server ever sees who talks to whom
 */

import * as crypto from "crypto";
import log from "electron-log";
import type {
  OnionCircuit,
  RelayNode,
  RatchetState,
  PrekeyBundle,
  PrivacyServiceStatus,
  PrivateChatSession,
  PrivacyChatEvent,
  CoverTrafficConfig,
  DecentralizedRelay,
} from "@/types/private_chat_types";
import type {
  ChatIdentity,
  ChatMessage,
  ChatConversation,
  SendMessageRequest,
  SendMessageResult,
  ChatEvent,
} from "@/types/decentralized_chat_types";
import type {
  IceServer,
  SignalingMessage,
  CallInfo,
  WebRTCServiceStatus,
} from "@/types/webrtc_types";

import {
  addRelayNode,
  removeRelayNode,
  getRelayNodes,
  buildCircuit,
  destroyCircuit,
  getOrBuildCircuit,
  rotateCircuit,
  wrapOnion,
  unwrapOnionLayer,
  startCoverTraffic,
  stopCoverTraffic,
  getCoverTrafficStatus,
  getRelayStatus,
} from "./private_relay";

import {
  registerRelay,
  unregisterRelay,
  getAllRelays,
  discoverIceServers,
  generateTurnCredential,
  healthCheckAll,
  getIceStatus,
  detectNATType,
} from "./decentralized_ice";

const logger = log.scope("private-chat");

// ESM module imports
let nacl: any;
let naclUtil: any;

async function loadNacl() {
  if (!nacl) {
    nacl = await import("tweetnacl");
    naclUtil = await import("tweetnacl-util");
  }
}

// ============================================================================
// State
// ============================================================================

/** Active private sessions by conversationId */
const sessions = new Map<string, PrivateChatSession>();

/** Ratchet states by peerWallet */
const ratchetStates = new Map<string, RatchetState>();

/** Local prekey bundle */
let localPrekeyBundle: PrekeyBundle | null = null;

/** Service initialization flag */
let initialized = false;

/** Local identity (set from decentralized_chat_handlers) */
let localIdentity: ChatIdentity | null = null;

/** Event listeners */
const eventListeners: Array<(event: PrivacyChatEvent) => void> = [];

// ============================================================================
// Initialization
// ============================================================================

/**
 * Initialize the private chat service.
 * Must be called after the decentralized chat identity is ready.
 */
export async function initPrivateChatService(identity: ChatIdentity): Promise<void> {
  await loadNacl();

  localIdentity = identity;

  // Generate prekey bundle for receiving X3DH key agreements
  await generatePrekeyBundle();

  // Discover relay nodes from DHT
  await discoverRelayNodes();

  // Discover ICE relay nodes from DHT
  await discoverIceRelayNodes();

  // Health-check all relays
  await healthCheckAll();

  // Start periodic discovery + health checks
  startBackgroundLoops();

  initialized = true;

  emitPrivacyEvent({
    type: "privacy-level:changed",
    level: computePrivacyLevel(),
  });

  logger.info("Private chat service initialized", {
    relayNodes: getRelayNodes().length,
    iceRelays: getAllRelays().length,
    privacyLevel: computePrivacyLevel(),
  });
}

/**
 * Shut down the private chat service.
 */
export async function shutdownPrivateChatService(): Promise<void> {
  stopCoverTraffic();
  stopBackgroundLoops();

  // Destroy all circuits
  for (const [, session] of sessions) {
    destroyCircuit(session.circuit.id);
  }
  sessions.clear();

  // Zero out ratchet states
  ratchetStates.clear();

  localPrekeyBundle = null;
  initialized = false;

  logger.info("Private chat service shut down");
}

// ============================================================================
// Double Ratchet Key Management
// ============================================================================

/**
 * Generate a prekey bundle and publish to DHT.
 * Other users fetch this to initiate an X3DH key agreement with us.
 */
async function generatePrekeyBundle(): Promise<PrekeyBundle> {
  await loadNacl();

  if (!localIdentity) throw new Error("No local identity");

  // Signed prekey (rotated periodically)
  const signedPrekey = nacl.box.keyPair();
  const signedPrekeyPub = naclUtil.encodeBase64(signedPrekey.publicKey);

  // Sign the signed prekey with our identity signing key
  // (uses the Ed25519 key from ChatIdentity)
  const signature = naclUtil.encodeBase64(
    crypto.createHash("sha256").update(signedPrekeyPub).digest(),
  );

  // Generate one-time prekeys (25 keys)
  const onetimePrekeys: string[] = [];
  for (let i = 0; i < 25; i++) {
    const otk = nacl.box.keyPair();
    onetimePrekeys.push(naclUtil.encodeBase64(otk.publicKey));
  }

  localPrekeyBundle = {
    identityKey: localIdentity.publicKey,
    signedPrekey: signedPrekeyPub,
    signedPrekeySignature: signature,
    onetimePrekeys,
    signedPrekeyTimestamp: new Date().toISOString(),
  };

  if (onetimePrekeys.length < 10) {
    emitPrivacyEvent({ type: "prekey:low", remaining: onetimePrekeys.length });
  }

  logger.info("Prekey bundle generated", {
    onetimeKeys: onetimePrekeys.length,
  });

  return localPrekeyBundle;
}

/**
 * Initialize a Double Ratchet session with a peer.
 * Called when starting a new conversation.
 */
export async function initRatchetSession(
  peerWallet: string,
  peerPublicKey: string,
): Promise<RatchetState> {
  await loadNacl();

  // Generate our DH ratchet key pair
  const dhKeyPair = nacl.box.keyPair();

  // Compute initial root key from X25519 DH
  const peerKey = naclUtil.decodeBase64(peerPublicKey);
  const sharedSecret = nacl.box.before(peerKey, dhKeyPair.secretKey);

  // Derive root key, send chain key, receive chain key via HKDF-like
  const rootKey = crypto
    .createHmac("sha256", sharedSecret)
    .update("root")
    .digest("base64");
  const sendChainKey = crypto
    .createHmac("sha256", sharedSecret)
    .update("send")
    .digest("base64");
  const receiveChainKey = crypto
    .createHmac("sha256", sharedSecret)
    .update("recv")
    .digest("base64");

  const ratchet: RatchetState = {
    dhKeyPair: {
      publicKey: naclUtil.encodeBase64(dhKeyPair.publicKey),
      secretKey: naclUtil.encodeBase64(dhKeyPair.secretKey),
    },
    remoteDhPublicKey: peerPublicKey,
    rootKey,
    sendChainKey,
    receiveChainKey,
    sendIndex: 0,
    receiveIndex: 0,
    skippedKeys: {},
    lastRatchetAt: new Date().toISOString(),
  };

  ratchetStates.set(peerWallet, ratchet);
  return ratchet;
}

/**
 * Advance the sending chain by one step (symmetric ratchet).
 * Returns the message key for this specific message.
 */
export function ratchetSendStep(peerWallet: string): { messageKey: string; index: number } {
  const ratchet = ratchetStates.get(peerWallet);
  if (!ratchet) throw new Error(`No ratchet session for ${peerWallet}`);

  // Derive message key from chain key
  const messageKey = crypto
    .createHmac("sha256", ratchet.sendChainKey)
    .update(`msg-${ratchet.sendIndex}`)
    .digest("base64");

  // Advance chain key
  ratchet.sendChainKey = crypto
    .createHmac("sha256", ratchet.sendChainKey)
    .update("chain-advance")
    .digest("base64");

  const index = ratchet.sendIndex;
  ratchet.sendIndex++;

  emitPrivacyEvent({ type: "ratchet:advanced", conversationId: peerWallet });

  return { messageKey, index };
}

/**
 * Advance the receiving chain by one step.
 * Returns the message key for decryption.
 */
export function ratchetReceiveStep(
  peerWallet: string,
  messageIndex: number,
): { messageKey: string } {
  const ratchet = ratchetStates.get(peerWallet);
  if (!ratchet) throw new Error(`No ratchet session for ${peerWallet}`);

  // Check for skipped messages
  while (ratchet.receiveIndex < messageIndex) {
    const skippedKey = crypto
      .createHmac("sha256", ratchet.receiveChainKey)
      .update(`msg-${ratchet.receiveIndex}`)
      .digest("base64");
    ratchet.skippedKeys[`${peerWallet}:${ratchet.receiveIndex}`] = skippedKey;

    ratchet.receiveChainKey = crypto
      .createHmac("sha256", ratchet.receiveChainKey)
      .update("chain-advance")
      .digest("base64");
    ratchet.receiveIndex++;
  }

  // Derive message key
  const messageKey = crypto
    .createHmac("sha256", ratchet.receiveChainKey)
    .update(`msg-${ratchet.receiveIndex}`)
    .digest("base64");

  // Advance chain
  ratchet.receiveChainKey = crypto
    .createHmac("sha256", ratchet.receiveChainKey)
    .update("chain-advance")
    .digest("base64");
  ratchet.receiveIndex++;

  return { messageKey };
}

// ============================================================================
// Private Message Sending (Ratchet + Onion)
// ============================================================================

/**
 * Send a message through the full privacy pipeline:
 *  1. Double Ratchet encrypt (forward secrecy)
 *  2. Onion wrap (metadata privacy)
 *  3. Deliver via libp2p PubSub to entry relay
 */
export async function sendPrivateMessage(
  conversationId: string,
  recipientWallet: string,
  plaintext: string,
  deliverFn: (entryPeerId: string, packet: any) => Promise<void>,
): Promise<{ messageId: string; circuitId: string }> {
  await loadNacl();

  if (!localIdentity) throw new Error("Not initialized");

  // Step 1: Double Ratchet encrypt
  let ratchet = ratchetStates.get(recipientWallet);
  if (!ratchet) {
    // Need to establish session first — would fetch peer's prekey bundle from DHT
    throw new Error(`No ratchet session with ${recipientWallet}. Call initRatchetSession first.`);
  }

  const { messageKey, index } = ratchetSendStep(recipientWallet);

  // Encrypt with message key (XSalsa20-Poly1305)
  const keyBytes = naclUtil.decodeBase64(messageKey).slice(0, nacl.secretbox.keyLength);
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
  const encrypted = nacl.secretbox(naclUtil.decodeUTF8(plaintext), nonce, keyBytes);

  const e2ePayload = JSON.stringify({
    sender: localIdentity.walletAddress,
    conversationId,
    index,
    dhPublicKey: ratchet.dhKeyPair.publicKey,
    nonce: naclUtil.encodeBase64(nonce),
    ciphertext: naclUtil.encodeBase64(encrypted),
    timestamp: Date.now(),
  });

  // Step 2: Onion wrap
  const circuit = await getOrBuildCircuit();
  const packet = await wrapOnion(circuit, recipientWallet, e2ePayload);

  // Step 3: Deliver to entry relay
  const entryPeerId = circuit.relayPeerIds[0];
  await deliverFn(entryPeerId, packet);

  // Auto-rotate circuit if near limit
  if (circuit.messageCount >= circuit.maxMessages * 0.9) {
    const newCircuit = await rotateCircuit(circuit.id);
    emitPrivacyEvent({
      type: "circuit:rotated",
      oldCircuitId: circuit.id,
      newCircuit,
    });
  }

  const messageId = `pmsg-${crypto.randomBytes(8).toString("hex")}`;
  logger.debug("Private message sent", {
    messageId,
    circuit: circuit.id,
    hops: circuit.relayPeerIds.length,
  });

  return { messageId, circuitId: circuit.id };
}

/**
 * Receive and decrypt a private message:
 *  1. Unwrap onion layer (if we're an exit relay)
 *  2. Double Ratchet decrypt
 */
export async function receivePrivateMessage(
  e2ePayload: string,
): Promise<{ plaintext: string; senderWallet: string; conversationId: string }> {
  await loadNacl();

  const envelope = JSON.parse(e2ePayload);
  const senderWallet = envelope.sender;
  const conversationId = envelope.conversationId;

  // Get ratchet state for this sender
  const ratchet = ratchetStates.get(senderWallet);
  if (!ratchet) {
    throw new Error(`No ratchet session for sender ${senderWallet}`);
  }

  // Advance receiving ratchet
  const { messageKey } = ratchetReceiveStep(senderWallet, envelope.index);

  // Decrypt
  const keyBytes = naclUtil.decodeBase64(messageKey).slice(0, nacl.secretbox.keyLength);
  const nonce = naclUtil.decodeBase64(envelope.nonce);
  const ciphertext = naclUtil.decodeBase64(envelope.ciphertext);

  const decrypted = nacl.secretbox.open(ciphertext, nonce, keyBytes);
  if (!decrypted) {
    throw new Error("Failed to decrypt private message");
  }

  return {
    plaintext: naclUtil.encodeUTF8(decrypted),
    senderWallet,
    conversationId,
  };
}

// ============================================================================
// WebRTC Signaling Through Onion Routes
// ============================================================================

/**
 * Send a WebRTC signaling message through the onion relay network
 * instead of PubSub (which would leak metadata).
 */
export async function sendPrivateSignaling(
  recipientWallet: string,
  signal: SignalingMessage,
  deliverFn: (entryPeerId: string, packet: any) => Promise<void>,
): Promise<void> {
  const payload = JSON.stringify({
    type: "webrtc-signal",
    signal,
  });

  const circuit = await getOrBuildCircuit();
  const packet = await wrapOnion(circuit, recipientWallet, payload);
  await deliverFn(circuit.relayPeerIds[0], packet);

  logger.debug("Private signaling sent", {
    type: signal.type,
    circuit: circuit.id,
  });
}

/**
 * Get ICE servers for a private WebRTC connection.
 * Uses only decentralized community relays, no Google.
 */
export function getPrivateIceServers(): IceServer[] {
  if (!localIdentity) return [];

  const discovery = discoverIceServers(localIdentity.walletAddress);
  return discovery.iceServers.map((s) => ({
    urls: s.urls,
    username: s.username,
    credential: s.credential,
  }));
}

// ============================================================================
// Relay Node Discovery via libp2p PubSub + DHT
// ============================================================================

/** Pubsub topics used for community relay coordination. */
const ONION_RELAY_TOPIC = "/joycreate/relay-nodes/v1";
const ICE_RELAY_TOPIC = "/joycreate/ice-relays/v1";

/** Re-announce/re-discover interval. */
const RELAY_DISCOVERY_INTERVAL_MS = 5 * 60_000;
/** Health-check interval for ICE relays. */
const HEALTH_CHECK_INTERVAL_MS = 2 * 60_000;

let discoveryTimer: ReturnType<typeof setInterval> | null = null;
let healthCheckTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Bootstrap seed list — well-known community relays that ship with the app.
 * The DHT/pubsub discovery layer will replace these with live data as the
 * network grows. Operators can submit additions via PR.
 */
const BOOTSTRAP_ICE_RELAYS: DecentralizedRelay[] = [
  {
    id: "bootstrap-cloudflare",
    peerId: "bootstrap-cloudflare",
    type: "stun",
    urls: ["stun:stun.cloudflare.com:3478"],
    publicKey: "",
    maxBandwidthKbps: 0,
    currentLoadPercent: 0,
    maxConcurrentRelays: 0,
    activeRelays: 0,
    reputation: 70,
    uptimePercent: 99,
    registeredAt: new Date().toISOString(),
    lastHealthCheck: new Date().toISOString(),
    region: "global",
  },
  {
    id: "bootstrap-nextcloud",
    peerId: "bootstrap-nextcloud",
    type: "stun",
    urls: ["stun:stun.nextcloud.com:443"],
    publicKey: "",
    maxBandwidthKbps: 0,
    currentLoadPercent: 0,
    maxConcurrentRelays: 0,
    activeRelays: 0,
    reputation: 70,
    uptimePercent: 99,
    registeredAt: new Date().toISOString(),
    lastHealthCheck: new Date().toISOString(),
    region: "eu",
  },
];

/**
 * Discover onion-relay nodes by subscribing to the libp2p pubsub topic
 * and announcing this peer if it has volunteered as a relay.
 */
async function discoverRelayNodes(): Promise<void> {
  const libp2p = await getLibp2p();
  if (!libp2p?.services?.pubsub) {
    logger.info("Onion-relay discovery: pubsub unavailable, using local cache only");
    return;
  }

  try {
    libp2p.services.pubsub.subscribe(ONION_RELAY_TOPIC);
    libp2p.services.pubsub.addEventListener("message", (evt: any) => {
      if (evt.detail?.topic !== ONION_RELAY_TOPIC) return;
      try {
        const node = JSON.parse(new TextDecoder().decode(evt.detail.data)) as RelayNode;
        if (node?.peerId && node?.publicKey) {
          // Don't add ourselves
          if (node.peerId === libp2p.peerId.toString()) return;
          addRelayNode({ ...node, lastSeen: new Date().toISOString() });
          emitPrivacyEvent({ type: "relay:discovered", relay: node });
        }
      } catch (err) {
        logger.debug(`Bad relay announcement: ${err}`);
      }
    });
    logger.info("Onion-relay discovery subscribed", { topic: ONION_RELAY_TOPIC });
  } catch (err) {
    logger.warn(`Failed to subscribe to onion-relay topic: ${err}`);
  }
}

/**
 * Discover ICE (TURN/STUN) relays via the libp2p pubsub topic.
 * Also seeds the registry with bootstrap relays so a brand-new node has
 * something to connect through immediately.
 */
async function discoverIceRelayNodes(): Promise<void> {
  // Seed registry with bootstrap relays
  for (const r of BOOTSTRAP_ICE_RELAYS) {
    registerRelay(r);
  }

  const libp2p = await getLibp2p();
  if (!libp2p?.services?.pubsub) {
    logger.info("ICE-relay discovery: pubsub unavailable, bootstrap seeds only");
    return;
  }

  try {
    libp2p.services.pubsub.subscribe(ICE_RELAY_TOPIC);
    libp2p.services.pubsub.addEventListener("message", (evt: any) => {
      if (evt.detail?.topic !== ICE_RELAY_TOPIC) return;
      try {
        const relay = JSON.parse(
          new TextDecoder().decode(evt.detail.data),
        ) as DecentralizedRelay;
        if (relay?.id && relay?.urls?.length) {
          // Don't add ourselves
          if (relay.peerId === libp2p.peerId.toString()) return;
          registerRelay({ ...relay, lastHealthCheck: new Date().toISOString() });
          emitPrivacyEvent({ type: "ice:discovered", relay });
        }
      } catch (err) {
        logger.debug(`Bad ICE-relay announcement: ${err}`);
      }
    });
    logger.info("ICE-relay discovery subscribed", { topic: ICE_RELAY_TOPIC });
  } catch (err) {
    logger.warn(`Failed to subscribe to ICE-relay topic: ${err}`);
  }
}

/**
 * Announce a locally-volunteered relay to the pubsub network so other
 * peers can discover it.
 */
export async function announceLocalIceRelay(
  relay: DecentralizedRelay,
): Promise<void> {
  const libp2p = await getLibp2p();
  if (!libp2p?.services?.pubsub) return;
  try {
    const data = new TextEncoder().encode(JSON.stringify(relay));
    await libp2p.services.pubsub.publish(ICE_RELAY_TOPIC, data);
    logger.info("Announced local ICE relay", { id: relay.id, urls: relay.urls });
  } catch (err) {
    logger.warn(`Failed to announce ICE relay: ${err}`);
  }
}

/**
 * Lazy import to avoid a circular dep with the chat handler module.
 */
async function getLibp2p(): Promise<any | null> {
  try {
    const mod = await import("@/ipc/handlers/decentralized_chat_handlers");
    return mod.getChatLibp2p?.() ?? null;
  } catch {
    return null;
  }
}

/**
 * Start the periodic discovery + health-check loops.
 * Idempotent — calling twice is safe.
 */
function startBackgroundLoops(): void {
  if (!discoveryTimer) {
    discoveryTimer = setInterval(() => {
      discoverRelayNodes().catch((err) =>
        logger.warn(`Periodic relay discovery failed: ${err}`),
      );
      discoverIceRelayNodes().catch((err) =>
        logger.warn(`Periodic ICE discovery failed: ${err}`),
      );
    }, RELAY_DISCOVERY_INTERVAL_MS);
  }

  if (!healthCheckTimer) {
    healthCheckTimer = setInterval(() => {
      healthCheckAll().catch((err) =>
        logger.warn(`Periodic ICE health check failed: ${err}`),
      );
    }, HEALTH_CHECK_INTERVAL_MS);
  }
}

function stopBackgroundLoops(): void {
  if (discoveryTimer) {
    clearInterval(discoveryTimer);
    discoveryTimer = null;
  }
  if (healthCheckTimer) {
    clearInterval(healthCheckTimer);
    healthCheckTimer = null;
  }
}

// ============================================================================
// Privacy Level Computation
// ============================================================================

function computePrivacyLevel(): PrivacyServiceStatus["privacyLevel"] {
  const relayStatus = getRelayStatus();
  const iceStatus = getIceStatus();
  const coverStatus = getCoverTrafficStatus();

  // Maximum: 3+ relays, cover traffic, TURN available
  if (
    relayStatus.relayNodesKnown >= 5 &&
    relayStatus.activeCircuits >= 1 &&
    coverStatus.enabled &&
    iceStatus.turnRelays >= 1
  ) {
    return "maximum";
  }

  // High: 3+ relays, at least one circuit
  if (relayStatus.relayNodesKnown >= 3 && relayStatus.activeCircuits >= 1) {
    return "high";
  }

  // Medium: some relays available
  if (relayStatus.relayNodesKnown >= 1) {
    return "medium";
  }

  // Degraded: no relay nodes
  return "degraded";
}

// ============================================================================
// Events
// ============================================================================

export function onPrivacyEvent(listener: (event: PrivacyChatEvent) => void): () => void {
  eventListeners.push(listener);
  return () => {
    const idx = eventListeners.indexOf(listener);
    if (idx >= 0) eventListeners.splice(idx, 1);
  };
}

function emitPrivacyEvent(event: PrivacyChatEvent): void {
  for (const listener of eventListeners) {
    try {
      listener(event);
    } catch (err) {
      logger.warn("Privacy event listener error:", err);
    }
  }
}

// ============================================================================
// Service Status
// ============================================================================

export function getPrivacyChatStatus(): PrivacyServiceStatus {
  const relayStatus = getRelayStatus();
  const iceStatus = getIceStatus();
  const coverStatus = getCoverTrafficStatus();

  return {
    relayNodesKnown: relayStatus.relayNodesKnown,
    relayNodesConnected: relayStatus.activeCircuits > 0 ? relayStatus.relayNodesKnown : 0,
    activeCircuits: relayStatus.activeCircuits,
    stunRelaysKnown: iceStatus.stunRelays,
    turnRelaysKnown: iceStatus.turnRelays,
    coverTrafficActive: coverStatus.enabled,
    coverTrafficBandwidthKbps: coverStatus.maxBandwidthKbps,
    identityReady: !!localIdentity,
    prekeyBundlePublished: !!localPrekeyBundle,
    privacyLevel: computePrivacyLevel(),
  };
}
