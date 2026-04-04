/**
 * Private Chat Types
 *
 * Types for the unified privacy-first chat system that merges
 * decentralized chat + WebRTC into a single metadata-private messenger.
 *
 * Privacy guarantees:
 *  - Onion-routed messages (3-hop minimum, no intermediary sees both sender and recipient)
 *  - Decentralized TURN/STUN (community-operated relay nodes discovered via DHT)
 *  - Double Ratchet key agreement (forward secrecy + break-in recovery)
 *  - Traffic padding (constant-rate cover traffic defeats timing analysis)
 *  - Deniable authentication (messages can't be crypto-proven to originate from you)
 */

// ============================================================================
// Onion Routing
// ============================================================================

/**
 * A single layer of onion encryption.
 * Each relay node peels one layer, revealing only the next hop.
 */
export interface OnionLayer {
  /** Ephemeral X25519 public key for this layer's DH */
  ephemeralPublicKey: string;
  /** Encrypted payload (next layer or final plaintext) */
  ciphertext: string;
  /** XSalsa20-Poly1305 nonce */
  nonce: string;
  /** HMAC for tamper detection */
  mac: string;
}

/**
 * A fully-wrapped onion packet ready for transmission.
 * Only the first relay can unwrap the outermost layer.
 */
export interface OnionPacket {
  /** Packet ID for deduplication (random, not linked to sender) */
  id: string;
  /** Wrapped layers from outermost → innermost */
  payload: string;
  /** Timestamp for replay prevention (Unix seconds) */
  timestamp: number;
  /** Time-to-live: decremented at each hop, dropped at 0 */
  ttl: number;
}

/**
 * Circuit: an ordered set of relay nodes forming a path.
 * The sender knows the full circuit; each relay only knows prev/next.
 */
export interface OnionCircuit {
  id: string;
  /** Ordered list of relay peer IDs (first = entry, last = exit) */
  relayPeerIds: string[];
  /** Shared secret per hop (derived from ephemeral DH) */
  hopKeys: string[];
  /** When the circuit was built */
  createdAt: string;
  /** Circuits expire and must be rebuilt */
  expiresAt: string;
  /** How many messages have traversed this circuit */
  messageCount: number;
  /** Max messages before forced rotation */
  maxMessages: number;
}

/** Relay node discovered from DHT */
export interface RelayNode {
  peerId: string;
  /** X25519 public key for onion layer encryption */
  publicKey: string;
  /** Multiaddrs for direct libp2p connection */
  multiaddrs: string[];
  /** Self-reported bandwidth capacity (kbps) */
  bandwidthKbps: number;
  /** Uptime percentage from reputation system */
  uptimePercent: number;
  /** Reputation score 0-100 */
  reputation: number;
  /** Region hint for latency-aware routing */
  region?: string;
  /** When last seen alive */
  lastSeen: string;
  /** Whether this node offers TURN relay for WebRTC */
  offersTurnRelay: boolean;
  /** Whether this node offers STUN service */
  offersStun: boolean;
}

// ============================================================================
// Decentralized ICE (TURN/STUN)
// ============================================================================

/**
 * A community-operated TURN/STUN relay discovered via DHT.
 * Users can opt in to relay traffic and earn reputation.
 */
export interface DecentralizedRelay {
  id: string;
  peerId: string;
  /** STUN/TURN/both */
  type: "stun" | "turn" | "both";
  /** Direct connection addresses */
  urls: string[];
  /** X25519 public key for credential generation */
  publicKey: string;
  /** Relay operator's wallet for accountability */
  operatorWallet?: string;

  // Capacity
  maxBandwidthKbps: number;
  currentLoadPercent: number;
  maxConcurrentRelays: number;
  activeRelays: number;

  // Trust
  reputation: number;
  uptimePercent: number;
  registeredAt: string;
  lastHealthCheck: string;

  // Geo
  region?: string;
  latencyMs?: number;
}

/**
 * Time-limited TURN credential, HMAC-signed.
 * Expires after `expiresAt` — relay nodes verify locally.
 */
export interface TurnCredential {
  username: string;
  credential: string;
  /** Unix timestamp when credential expires */
  expiresAt: number;
  /** Which relay this credential is for */
  relayId: string;
}

/** Result of ICE server discovery from DHT */
export interface IceDiscoveryResult {
  stunServers: DecentralizedRelay[];
  turnServers: DecentralizedRelay[];
  /** Formatted for RTCPeerConnection iceServers config */
  iceServers: Array<{
    urls: string | string[];
    username?: string;
    credential?: string;
  }>;
}

// ============================================================================
// Double Ratchet (Forward Secrecy)
// ============================================================================

/**
 * Ratchet state for a conversation peer.
 * Implements Diffie-Hellman + symmetric key ratchet for forward secrecy.
 */
export interface RatchetState {
  /** Current DH ratchet key pair (ours) */
  dhKeyPair: { publicKey: string; secretKey: string };
  /** Remote party's current DH public key */
  remoteDhPublicKey: string;
  /** Root key — never sent, used to derive chain keys */
  rootKey: string;
  /** Sending chain key (ratcheted per message) */
  sendChainKey: string;
  /** Receiving chain key (ratcheted per message) */
  receiveChainKey: string;
  /** Send message index (for ordering) */
  sendIndex: number;
  /** Receive message index */
  receiveIndex: number;
  /** Skipped message keys for out-of-order delivery */
  skippedKeys: Record<string, string>;
  /** When this ratchet state was last advanced */
  lastRatchetAt: string;
}

/**
 * X3DH key agreement output, used to bootstrap the Double Ratchet.
 */
export interface X3DHResult {
  /** Shared secret from X3DH */
  sharedSecret: string;
  /** Ephemeral public key sent to peer */
  ephemeralPublicKey: string;
  /** Which one-time prekey was consumed */
  usedOnetimeKeyId?: string;
}

/**
 * Prekey bundle published to DHT for receiving X3DH key agreements.
 */
export interface PrekeyBundle {
  /** Identity key (long-term, Ed25519 → X25519) */
  identityKey: string;
  /** Signed prekey (medium-term, rotated weekly) */
  signedPrekey: string;
  /** Signature over signedPrekey by identityKey */
  signedPrekeySignature: string;
  /** One-time prekeys (consumed on use) */
  onetimePrekeys: string[];
  /** When the signed prekey was generated */
  signedPrekeyTimestamp: string;
}

// ============================================================================
// Traffic Padding / Cover Traffic
// ============================================================================

/** Configuration for constant-rate cover traffic */
export interface CoverTrafficConfig {
  /** Whether cover traffic is enabled */
  enabled: boolean;
  /** Average interval between cover packets (ms) */
  intervalMs: number;
  /** Jitter range (ms) to add randomness */
  jitterMs: number;
  /** Size of cover packets (bytes) — matches real message size */
  paddedSizeBytes: number;
  /** Max bandwidth to spend on cover traffic (kbps) */
  maxBandwidthKbps: number;
}

// ============================================================================
// Unified Private Chat Session
// ============================================================================

/** Session state for a private conversation */
export interface PrivateChatSession {
  conversationId: string;
  /** Peer's wallet address */
  peerWallet: string;
  /** Onion circuit used for this session */
  circuit: OnionCircuit;
  /** Double Ratchet state */
  ratchet: RatchetState;
  /** WebRTC connection ID if voice/video active */
  webrtcConnectionId?: string;
  /** Whether a voice/video call is active */
  callActive: boolean;
  /** Session start */
  establishedAt: string;
  /** Last message sent/received */
  lastActivityAt: string;
}

/** Overall privacy service status */
export interface PrivacyServiceStatus {
  /** Onion relay network */
  relayNodesKnown: number;
  relayNodesConnected: number;
  activeCircuits: number;
  /** Decentralized ICE */
  stunRelaysKnown: number;
  turnRelaysKnown: number;
  /** Cover traffic */
  coverTrafficActive: boolean;
  coverTrafficBandwidthKbps: number;
  /** Identity */
  identityReady: boolean;
  prekeyBundlePublished: boolean;
  /** Overall health */
  privacyLevel: "maximum" | "high" | "medium" | "degraded";
}

/** Events emitted by the privacy layer */
export type PrivacyChatEvent =
  | { type: "circuit:built"; circuit: OnionCircuit }
  | { type: "circuit:broken"; circuitId: string; reason: string }
  | { type: "circuit:rotated"; oldCircuitId: string; newCircuit: OnionCircuit }
  | { type: "relay:discovered"; relay: RelayNode }
  | { type: "relay:lost"; peerId: string }
  | { type: "ice:discovered"; relay: DecentralizedRelay }
  | { type: "ice:lost"; relayId: string }
  | { type: "ratchet:advanced"; conversationId: string }
  | { type: "prekey:low"; remaining: number }
  | { type: "cover-traffic:started" }
  | { type: "cover-traffic:stopped" }
  | { type: "privacy-level:changed"; level: PrivacyServiceStatus["privacyLevel"] };
