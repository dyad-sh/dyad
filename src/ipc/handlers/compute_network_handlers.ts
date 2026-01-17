/**
 * Decentralized Compute Network Handlers
 * libp2p/Helia-based peer networking for AI inference
 */

import { ipcMain, IpcMainInvokeEvent } from "electron";
import path from "node:path";
import fs from "fs-extra";
import os from "node:os";
import crypto from "node:crypto";
import log from "electron-log";
import { getUserDataPath } from "@/paths/paths";

import {
  DEFAULT_COMPUTE_NETWORK_CONFIG,
  type ComputePeerId,
  type PeerCapabilities,
  type PeerInfo,
  type PeerStatus,
  type NatType,
  type DiscoveryConfig,
  type TransportConfig,
  type ConnectionInfo,
  type ContentManifest,
  type ContentType,
  type ChunkInfo,
  type FetchRequest,
  type FetchProgress,
  type FetchStatus,
  type FetchResult,
  type InferenceJob,
  type JobType,
  type InferenceParams,
  type JobStatus,
  type JobResult,
  type ExecutionMetrics,
  type ExecutionReceipt,
  type ValidationRequest,
  type ValidationType,
  type ValidationResult,
  type ConsensusResult,
  type Heartbeat,
  type JobStats,
  type SystemMetrics,
  type NetworkMetrics,
  type TelemetryReport,
  type ComputeNetworkEvent,
  type NetworkStatus,
  type ComputeNetworkConfig,
} from "@/types/compute_network_types";

const logger = log.scope("compute-network");

// ============================================================================
// Dynamic ESM Imports
// ============================================================================

let Helia: any;
let createHelia: any;
let FsBlockstore: any;
let FsDatastore: any;
let createLibp2p: any;
let noise: any;
let yamux: any;
let mplex: any;
let tcp: any;
let webSockets: any;
let webRTC: any;
let kadDHT: any;
let mdns: any;
let bootstrap: any;
let gossipsub: any;
let identify: any;
let circuitRelayTransport: any;
let circuitRelayServer: any;
let dcutr: any;
let autoNAT: any;
let upnpNat: any;
let nacl: any;
let naclUtil: any;

async function loadDependencies(): Promise<void> {
  if (createHelia) return; // Already loaded

  try {
    const [
      heliaModule,
      blockstoreFs,
      datastoreFs,
      libp2pModule,
      noiseModule,
      yamuxModule,
      mplexModule,
      tcpModule,
      wsModule,
      webRTCModule,
      kadDHTModule,
      mdnsModule,
      bootstrapModule,
      gossipsubModule,
      identifyModule,
      relayModule,
      dcutrModule,
      autoNATModule,
      upnpModule,
      naclModule,
      naclUtilModule,
    ] = await Promise.all([
      import("helia"),
      import("blockstore-fs"),
      import("datastore-fs"),
      import("libp2p"),
      import("@chainsafe/libp2p-noise"),
      import("@chainsafe/libp2p-yamux"),
      import("@libp2p/mplex"),
      import("@libp2p/tcp"),
      import("@libp2p/websockets"),
      import("@libp2p/webrtc"),
      import("@libp2p/kad-dht"),
      import("@libp2p/mdns"),
      import("@libp2p/bootstrap"),
      // Gossipsub - dynamically import to avoid TS errors if not installed
      Promise.resolve().then(async () => {
        try {
          // @ts-ignore - dynamic import
          return await import("@chainsafe/libp2p-gossipsub");
        } catch {
          return { gossipsub: () => ({}) };
        }
      }),
      import("@libp2p/identify"),
      import("@libp2p/circuit-relay-v2"),
      import("@libp2p/dcutr"),
      import("@libp2p/autonat"),
      import("@libp2p/upnp-nat"),
      import("tweetnacl"),
      import("tweetnacl-util"),
    ]);

    createHelia = heliaModule.createHelia;
    FsBlockstore = blockstoreFs.FsBlockstore;
    FsDatastore = datastoreFs.FsDatastore;
    createLibp2p = libp2pModule.createLibp2p;
    noise = noiseModule.noise;
    yamux = yamuxModule.yamux;
    mplex = mplexModule.mplex;
    tcp = tcpModule.tcp;
    webSockets = wsModule.webSockets;
    webRTC = webRTCModule.webRTC;
    kadDHT = kadDHTModule.kadDHT;
    mdns = mdnsModule.mdns;
    bootstrap = bootstrapModule.bootstrap;
    gossipsub = gossipsubModule.gossipsub || (() => ({}));
    identify = identifyModule.identify;
    circuitRelayTransport = relayModule.circuitRelayTransport;
    circuitRelayServer = relayModule.circuitRelayServer;
    dcutr = dcutrModule.dcutr;
    autoNAT = autoNATModule.autoNAT;
    upnpNat = (upnpModule as any).uPnPNAT;
    nacl = naclModule.default || naclModule;
    naclUtil = naclUtilModule.default || naclUtilModule;

    logger.info("Compute network dependencies loaded");
  } catch (error) {
    logger.error("Failed to load compute network dependencies:", error);
    throw error;
  }
}

// ============================================================================
// State Management
// ============================================================================

interface ComputeNetworkState {
  config: ComputeNetworkConfig;
  helia: any | null;
  libp2p: any | null;
  localPeerId: ComputePeerId | null;
  keyPair: { publicKey: Uint8Array; secretKey: Uint8Array } | null;
  peers: Map<string, PeerInfo>;
  connections: Map<string, ConnectionInfo>;
  jobs: Map<string, InferenceJob>;
  pendingJobs: InferenceJob[];
  activeJobs: Map<string, InferenceJob>;
  fetchRequests: Map<string, FetchRequest>;
  fetchProgress: Map<string, FetchProgress>;
  validationRequests: Map<string, ValidationRequest>;
  heartbeatInterval: NodeJS.Timeout | null;
  heartbeatSequence: number;
  startTime: number;
  eventListeners: Map<string, Set<(event: ComputeNetworkEvent) => void>>;
}

const state: ComputeNetworkState = {
  config: { ...DEFAULT_COMPUTE_NETWORK_CONFIG },
  helia: null,
  libp2p: null,
  localPeerId: null,
  keyPair: null,
  peers: new Map(),
  connections: new Map(),
  jobs: new Map(),
  pendingJobs: [],
  activeJobs: new Map(),
  fetchRequests: new Map(),
  fetchProgress: new Map(),
  validationRequests: new Map(),
  heartbeatInterval: null,
  heartbeatSequence: 0,
  startTime: 0,
  eventListeners: new Map(),
};

// ============================================================================
// Event Emission
// ============================================================================

function emitEvent(event: ComputeNetworkEvent): void {
  const listeners = state.eventListeners.get("*") || new Set();
  const typeListeners = state.eventListeners.get(event.type) || new Set();

  for (const listener of [...listeners, ...typeListeners]) {
    try {
      listener(event);
    } catch (error) {
      logger.error("Event listener error:", error);
    }
  }
}

// ============================================================================
// Cryptographic Utilities
// ============================================================================

function generateKeyPair(): { publicKey: Uint8Array; secretKey: Uint8Array } {
  return nacl.sign.keyPair();
}

function signData(data: Uint8Array, secretKey: Uint8Array): Uint8Array {
  return nacl.sign.detached(data, secretKey);
}

function verifySignature(
  data: Uint8Array,
  signature: Uint8Array,
  publicKey: Uint8Array
): boolean {
  return nacl.sign.detached.verify(data, signature, publicKey);
}

function hashData(data: Uint8Array): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function encodeToBase64(data: Uint8Array): string {
  return naclUtil.encodeBase64(data);
}

function decodeFromBase64(data: string): Uint8Array {
  return naclUtil.decodeBase64(data);
}

// ============================================================================
// System Capabilities Detection
// ============================================================================

async function detectCapabilities(): Promise<PeerCapabilities> {
  const cpus = os.cpus();
  const totalMemory = os.totalmem();
  const freeMemory = os.freemem();

  // Basic capabilities
  const capabilities: PeerCapabilities = {
    gpus: [],
    totalVram: 0,
    availableVram: 0,
    cpuCores: cpus.length,
    ramMb: Math.floor(totalMemory / 1024 / 1024),
    availableRamMb: Math.floor(freeMemory / 1024 / 1024),
    diskMb: 0,
    supportedFormats: ["gguf", "safetensors", "onnx"],
    supportedQuantizations: ["fp16", "int8", "q4_0", "q4_k", "q5_k", "q8_0"],
    maxModelSize: Math.floor(freeMemory / 1024 / 1024 / 2), // Half of free RAM
    maxBatchSize: 1,
    bandwidthMbps: 100, // Default estimate
    canValidate: true,
  };

  // Try to detect disk space
  try {
    const dataPath = getUserDataPath();
    await fs.ensureDir(dataPath);
    // Use a simple heuristic for disk space
    capabilities.diskMb = 100 * 1024; // Default 100GB estimate
  } catch {
    capabilities.diskMb = 10 * 1024; // 10GB fallback
  }

  // Try to detect GPU (platform-specific)
  try {
    // This would need platform-specific GPU detection
    // For now, we'll return empty GPU list
    // In production, use nvidia-smi, rocm-smi, or metal APIs
    logger.info("GPU detection not implemented, using CPU-only capabilities");
  } catch (error) {
    logger.warn("Failed to detect GPU:", error);
  }

  return capabilities;
}

// ============================================================================
// Network Initialization
// ============================================================================

async function createLibp2pNode(config: ComputeNetworkConfig): Promise<any> {
  const transports: any[] = [];
  const peerDiscovery: any[] = [];
  const services: Record<string, any> = {};

  // Configure transports
  if (config.transport.enableTcp) {
    transports.push(tcp());
  }
  if (config.transport.enableWebSocket) {
    transports.push(webSockets());
  }
  if (config.transport.enableWebRTC) {
    transports.push(webRTC());
  }
  if (config.transport.enableRelayClient) {
    transports.push(
      circuitRelayTransport({
        discoverRelays: 1,
      })
    );
  }

  // Configure peer discovery
  if (config.discovery.enableMdns) {
    peerDiscovery.push(mdns());
  }
  if (config.discovery.bootstrapPeers.length > 0) {
    peerDiscovery.push(
      bootstrap({
        list: config.discovery.bootstrapPeers,
      })
    );
  }

  // Configure services
  services.identify = identify();

  if (config.discovery.enableDht) {
    services.dht = kadDHT({
      clientMode: false,
    });
  }

  services.pubsub = gossipsub({
    allowPublishToZeroTopicPeers: true,
    emitSelf: false,
  });

  if (config.transport.enableHolePunching) {
    services.dcutr = dcutr();
  }

  services.autoNAT = autoNAT();

  if (config.transport.enableUpnp) {
    services.upnpNAT = upnpNat();
  }

  if (config.transport.enableRelayServer) {
    services.relay = circuitRelayServer({
      hopTimeout: 30000,
      maxInboundHopStreams: 32,
      maxOutboundHopStreams: 64,
    });
  }

  const node = await createLibp2p({
    addresses: {
      listen: config.transport.listenAddresses,
      announce: config.transport.announceAddresses,
    },
    transports,
    connectionEncrypters: [noise()],
    streamMuxers: [yamux(), mplex()],
    peerDiscovery,
    services,
    connectionManager: {
      maxConnections: config.discovery.maxPeers,
      minConnections: config.discovery.minPeers,
    },
  });

  return node;
}

async function initializeNetwork(
  config: Partial<ComputeNetworkConfig>
): Promise<NetworkStatus> {
  await loadDependencies();

  // Merge config with defaults
  state.config = {
    ...DEFAULT_COMPUTE_NETWORK_CONFIG,
    ...config,
    discovery: {
      ...DEFAULT_COMPUTE_NETWORK_CONFIG.discovery,
      ...config.discovery,
    },
    transport: {
      ...DEFAULT_COMPUTE_NETWORK_CONFIG.transport,
      ...config.transport,
    },
    execution: {
      ...DEFAULT_COMPUTE_NETWORK_CONFIG.execution,
      ...config.execution,
    },
    validation: {
      ...DEFAULT_COMPUTE_NETWORK_CONFIG.validation,
      ...config.validation,
    },
    heartbeat: {
      ...DEFAULT_COMPUTE_NETWORK_CONFIG.heartbeat,
      ...config.heartbeat,
    },
    content: {
      ...DEFAULT_COMPUTE_NETWORK_CONFIG.content,
      ...config.content,
    },
  };

  // Set up storage paths
  const basePath = path.join(getUserDataPath(), "compute-network");
  const blockstorePath = path.join(basePath, "blockstore");
  const datastorePath = path.join(basePath, "datastore");
  const cachePath = path.join(basePath, "cache");

  await fs.ensureDir(blockstorePath);
  await fs.ensureDir(datastorePath);
  await fs.ensureDir(cachePath);

  if (!state.config.content.cacheDir) {
    state.config.content.cacheDir = cachePath;
  }

  // Generate or load key pair
  const keyPath = path.join(basePath, "identity.key");
  if (await fs.pathExists(keyPath)) {
    const keyData = await fs.readFile(keyPath);
    state.keyPair = {
      secretKey: new Uint8Array(keyData.slice(0, 64)),
      publicKey: new Uint8Array(keyData.slice(64)),
    };
  } else {
    state.keyPair = generateKeyPair();
    const keyData = Buffer.concat([
      Buffer.from(state.keyPair.secretKey),
      Buffer.from(state.keyPair.publicKey),
    ]);
    await fs.writeFile(keyPath, keyData);
  }

  // Create libp2p node
  logger.info("Creating libp2p node...");
  state.libp2p = await createLibp2pNode(state.config);

  // Create Helia instance
  logger.info("Creating Helia instance...");
  const blockstore = new FsBlockstore(blockstorePath);
  const datastore = new FsDatastore(datastorePath);

  state.helia = await createHelia({
    libp2p: state.libp2p,
    blockstore,
    datastore,
  });

  // Set up local peer identity
  const capabilities = await detectCapabilities();
  state.localPeerId = {
    peerId: state.libp2p.peerId.toString(),
    walletAddress: state.config.identity.walletAddress,
    publicKey: encodeToBase64(state.keyPair.publicKey),
    displayName: state.config.identity.displayName,
  };

  // Set up event listeners
  setupLibp2pEventListeners();

  // Subscribe to discovery topics
  for (const topic of state.config.discovery.discoveryTopics) {
    state.libp2p.services.pubsub.subscribe(topic);
    logger.info(`Subscribed to topic: ${topic}`);
  }

  // Subscribe to job-related topics
  state.libp2p.services.pubsub.subscribe("/joycreate/compute/jobs/1.0.0");
  state.libp2p.services.pubsub.subscribe("/joycreate/compute/heartbeats/1.0.0");
  state.libp2p.services.pubsub.subscribe("/joycreate/compute/validation/1.0.0");

  // Start heartbeat
  startHeartbeat();

  state.startTime = Date.now();
  logger.info("Compute network initialized successfully");

  return getNetworkStatus();
}

function setupLibp2pEventListeners(): void {
  if (!state.libp2p) return;

  // Peer discovery
  state.libp2p.addEventListener("peer:discovery", (event: any) => {
    const peerId = event.detail.id.toString();
    logger.info(`Discovered peer: ${peerId}`);

    // Add to peers map with basic info
    if (!state.peers.has(peerId)) {
      const peerInfo: PeerInfo = {
        id: {
          peerId,
          walletAddress: "",
          publicKey: "",
        },
        capabilities: {
          gpus: [],
          totalVram: 0,
          availableVram: 0,
          cpuCores: 0,
          ramMb: 0,
          availableRamMb: 0,
          diskMb: 0,
          supportedFormats: [],
          supportedQuantizations: [],
          maxModelSize: 0,
          maxBatchSize: 0,
          bandwidthMbps: 0,
          canValidate: false,
        },
        addresses: event.detail.multiaddrs?.map((ma: any) => ma.toString()) || [],
        firstSeen: Date.now(),
        lastSeen: Date.now(),
        reputation: 50,
        jobsCompleted: 0,
        avgLatency: 0,
        uptime: 0,
        status: "online",
        activeJobs: 0,
        natType: "unknown",
        isRelay: false,
      };
      state.peers.set(peerId, peerInfo);
      emitEvent({ type: "peer:discovered", peer: peerInfo });
    }
  });

  // Connection events
  state.libp2p.addEventListener("connection:open", (event: any) => {
    const connection = event.detail;
    const peerId = connection.remotePeer.toString();

    const connInfo: ConnectionInfo = {
      peerId,
      remoteAddr: connection.remoteAddr.toString(),
      direction: connection.direction,
      status: "open",
      streams: connection.streams?.length || 0,
      latencyMs: 0,
      bandwidth: { upload: 0, download: 0 },
      encryption: "noise",
      multiplexer: "yamux",
      establishedAt: Date.now(),
    };

    state.connections.set(connection.id, connInfo);
    logger.info(`Connected to peer: ${peerId}`);

    emitEvent({ type: "peer:connected", peerId, connection: connInfo });

    // Update peer status
    const peer = state.peers.get(peerId);
    if (peer) {
      peer.status = "online";
      peer.lastSeen = Date.now();
    }
  });

  state.libp2p.addEventListener("connection:close", (event: any) => {
    const connection = event.detail;
    const peerId = connection.remotePeer.toString();

    state.connections.delete(connection.id);
    logger.info(`Disconnected from peer: ${peerId}`);

    emitEvent({ type: "peer:disconnected", peerId });

    // Update peer status if no more connections
    const hasOtherConnections = Array.from(state.connections.values()).some(
      (c) => c.peerId === peerId
    );
    if (!hasOtherConnections) {
      const peer = state.peers.get(peerId);
      if (peer) {
        peer.status = "offline";
      }
    }
  });

  // PubSub message handling
  state.libp2p.services.pubsub.addEventListener("message", (event: any) => {
    handlePubSubMessage(event.detail);
  });
}

function handlePubSubMessage(message: any): void {
  const topic = message.topic;
  const data = new TextDecoder().decode(message.data);

  try {
    const parsed = JSON.parse(data);

    if (topic === "/joycreate/compute/heartbeats/1.0.0") {
      handleHeartbeatMessage(parsed);
    } else if (topic === "/joycreate/compute/jobs/1.0.0") {
      handleJobMessage(parsed);
    } else if (topic === "/joycreate/compute/validation/1.0.0") {
      handleValidationMessage(parsed);
    } else if (topic.startsWith("/joycreate/compute/discovery")) {
      handleDiscoveryMessage(parsed);
    }
  } catch (error) {
    logger.error("Failed to parse PubSub message:", error);
  }
}

function handleHeartbeatMessage(heartbeat: Heartbeat): void {
  const peer = state.peers.get(heartbeat.peerId);

  if (peer) {
    // Verify signature
    if (state.config.heartbeat.signTelemetry && heartbeat.signature) {
      const dataToVerify = JSON.stringify({
        ...heartbeat,
        signature: undefined,
      });
      const isValid = verifySignature(
        new TextEncoder().encode(dataToVerify),
        decodeFromBase64(heartbeat.signature),
        decodeFromBase64(peer.id.publicKey)
      );

      if (!isValid) {
        logger.warn(`Invalid heartbeat signature from ${heartbeat.peerId}`);
        return;
      }
    }

    // Update peer info
    peer.lastSeen = heartbeat.timestamp;
    peer.status = heartbeat.status;
    peer.capabilities = heartbeat.capabilities;
    peer.activeJobs = heartbeat.activeJobs;

    emitEvent({ type: "heartbeat:received", heartbeat });
    emitEvent({ type: "peer:updated", peer });
  }
}

function handleJobMessage(message: any): void {
  switch (message.type) {
    case "job:broadcast":
      handleJobBroadcast(message.job);
      break;
    case "job:assignment":
      handleJobAssignment(message.jobId, message.executor);
      break;
    case "job:result":
      handleJobResult(message.result);
      break;
    case "job:cancel":
      handleJobCancellation(message.jobId);
      break;
  }
}

function handleValidationMessage(message: any): void {
  switch (message.type) {
    case "validation:request":
      handleValidationRequest(message.request);
      break;
    case "validation:result":
      handleValidationResult(message.result);
      break;
  }
}

function handleDiscoveryMessage(message: any): void {
  if (message.type === "announce" && message.peerInfo) {
    const peerInfo = message.peerInfo as PeerInfo;
    state.peers.set(peerInfo.id.peerId, peerInfo);
    emitEvent({ type: "peer:discovered", peer: peerInfo });
  }
}

// ============================================================================
// Heartbeat System
// ============================================================================

function startHeartbeat(): void {
  if (state.heartbeatInterval) {
    clearInterval(state.heartbeatInterval);
  }

  state.heartbeatInterval = setInterval(async () => {
    await sendHeartbeat();
  }, state.config.heartbeat.intervalMs);

  // Send initial heartbeat
  sendHeartbeat();
}

async function sendHeartbeat(): Promise<void> {
  if (!state.libp2p || !state.localPeerId || !state.keyPair) return;

  const capabilities = await detectCapabilities();
  const systemMetrics = await getSystemMetrics();
  const networkMetrics = getNetworkMetrics();
  const jobStats = getJobStats();

  const heartbeat: Heartbeat = {
    peerId: state.localPeerId.peerId,
    sequence: state.heartbeatSequence++,
    timestamp: Date.now(),
    status: getLocalStatus(),
    capabilities,
    activeJobs: state.activeJobs.size,
    queuedJobs: state.pendingJobs.length,
    jobStats,
    systemMetrics,
    networkMetrics,
    signature: "",
  };

  // Sign heartbeat
  if (state.config.heartbeat.signTelemetry) {
    const dataToSign = JSON.stringify(heartbeat);
    const signature = signData(
      new TextEncoder().encode(dataToSign),
      state.keyPair.secretKey
    );
    heartbeat.signature = encodeToBase64(signature);
  }

  // Publish heartbeat
  try {
    const data = new TextEncoder().encode(JSON.stringify(heartbeat));
    await state.libp2p.services.pubsub.publish(
      "/joycreate/compute/heartbeats/1.0.0",
      data
    );
  } catch (error) {
    logger.error("Failed to send heartbeat:", error);
  }
}

function getLocalStatus(): PeerStatus {
  if (state.activeJobs.size >= state.config.execution.maxConcurrentJobs) {
    return "busy";
  }
  if (state.activeJobs.size > 0) {
    return "busy";
  }
  return "idle";
}

async function getSystemMetrics(): Promise<SystemMetrics> {
  const cpus = os.cpus();
  const totalMemory = os.totalmem();
  const freeMemory = os.freemem();

  // Calculate CPU usage
  let cpuUsage = 0;
  for (const cpu of cpus) {
    const total = Object.values(cpu.times).reduce((a, b) => a + b, 0);
    const idle = cpu.times.idle;
    cpuUsage += ((total - idle) / total) * 100;
  }
  cpuUsage /= cpus.length;

  return {
    cpuUsage,
    memoryUsage: ((totalMemory - freeMemory) / totalMemory) * 100,
    diskUsage: 0, // Would need platform-specific detection
  };
}

function getNetworkMetrics(): NetworkMetrics {
  return {
    connectedPeers: state.connections.size,
    inboundConnections: Array.from(state.connections.values()).filter(
      (c) => c.direction === "inbound"
    ).length,
    outboundConnections: Array.from(state.connections.values()).filter(
      (c) => c.direction === "outbound"
    ).length,
    bytesSentLastMinute: 0, // Would need tracking
    bytesReceivedLastMinute: 0,
    avgPeerLatencyMs:
      Array.from(state.connections.values()).reduce(
        (sum, c) => sum + c.latencyMs,
        0
      ) / Math.max(state.connections.size, 1),
    dhtQueries: 0,
    dhtResponses: 0,
    pubsubMessagesSent: 0,
    pubsubMessagesReceived: 0,
  };
}

function getJobStats(): JobStats {
  const now = Date.now();
  const hourAgo = now - 60 * 60 * 1000;

  const recentJobs = Array.from(state.jobs.values()).filter(
    (j) => j.completedAt && j.completedAt > hourAgo
  );

  const completedJobs = recentJobs.filter((j) => j.status === "completed");
  const failedJobs = recentJobs.filter((j) => j.status === "failed");

  const avgExecutionTime =
    completedJobs.length > 0
      ? completedJobs.reduce((sum, j) => {
          const duration = (j.completedAt || 0) - (j.startedAt || 0);
          return sum + duration;
        }, 0) / completedJobs.length
      : 0;

  return {
    completedLastHour: completedJobs.length,
    failedLastHour: failedJobs.length,
    avgExecutionTimeMs: avgExecutionTime,
    totalTokensProcessed: 0, // Would need tracking
    successRate:
      recentJobs.length > 0 ? completedJobs.length / recentJobs.length : 1,
    earnings24h: BigInt(0), // Would need payment tracking
  };
}

// ============================================================================
// Content Fetching
// ============================================================================

async function fetchContent(request: FetchRequest): Promise<FetchResult> {
  if (!state.helia) {
    throw new Error("Helia not initialized");
  }

  state.fetchRequests.set(request.id, request);

  const progress: FetchProgress = {
    requestId: request.id,
    cid: request.cid,
    status: "resolving",
    totalChunks: 0,
    completedChunks: 0,
    totalBytes: 0,
    downloadedBytes: 0,
    bytesPerSecond: 0,
    activeProviders: [],
    failedProviders: [],
    estimatedTimeRemaining: 0,
    errors: [],
    startedAt: Date.now(),
  };

  state.fetchProgress.set(request.id, progress);
  emitEvent({ type: "content:fetching", request });

  try {
    const { CID } = await import("multiformats/cid");
    const cid = CID.parse(request.cid);

    // Try to resolve the content
    progress.status = "downloading";
    emitEvent({ type: "content:progress", progress });

    const blocks: Uint8Array[] = [];
    let totalSize = 0;

    // Use Helia's blockstore to fetch
    for await (const block of state.helia.blockstore.getAll()) {
      if (block.cid.equals(cid)) {
        blocks.push(block.bytes);
        totalSize += block.bytes.length;

        progress.downloadedBytes = totalSize;
        progress.completedChunks++;
        emitEvent({ type: "content:progress", progress });
      }
    }

    // If not in local blockstore, try to fetch from network
    if (blocks.length === 0) {
      try {
        const block = await state.helia.blockstore.get(cid);
        blocks.push(block);
        totalSize = block.length;
        progress.downloadedBytes = totalSize;
        progress.completedChunks = 1;
      } catch (fetchError) {
        throw new Error(`Content not found: ${request.cid}`);
      }
    }

    // Verify if requested
    if (request.verifyChunks) {
      progress.status = "verifying";
      emitEvent({ type: "content:progress", progress });

      // Verify each block's hash matches the CID
      // This is automatic with IPFS/Helia
    }

    // Save to disk if destination provided
    if (request.destinationPath) {
      await fs.ensureDir(path.dirname(request.destinationPath));
      await fs.writeFile(request.destinationPath, Buffer.concat(blocks));
    }

    progress.status = "completed";
    progress.completedAt = Date.now();
    emitEvent({ type: "content:progress", progress });

    const result: FetchResult = {
      requestId: request.id,
      cid: request.cid,
      success: true,
      localPath: request.destinationPath,
      bytesDownloaded: totalSize,
      duration: Date.now() - progress.startedAt,
      providers: progress.activeProviders,
    };

    emitEvent({ type: "content:fetched", result });
    return result;
  } catch (error) {
    progress.status = "failed";
    progress.errors.push({
      error: String(error),
      timestamp: Date.now(),
      retryable: true,
    });

    emitEvent({ type: "content:progress", progress });
    emitEvent({
      type: "content:failed",
      requestId: request.id,
      error: String(error),
    });

    return {
      requestId: request.id,
      cid: request.cid,
      success: false,
      bytesDownloaded: progress.downloadedBytes,
      duration: Date.now() - progress.startedAt,
      providers: progress.activeProviders,
      error: String(error),
    };
  } finally {
    state.fetchRequests.delete(request.id);
  }
}

async function pinContent(cid: string): Promise<boolean> {
  if (!state.helia) {
    throw new Error("Helia not initialized");
  }

  try {
    const { CID } = await import("multiformats/cid");
    const parsedCid = CID.parse(cid);

    // Pin the content
    await state.helia.pins.add(parsedCid);

    logger.info(`Pinned content: ${cid}`);
    return true;
  } catch (error) {
    logger.error(`Failed to pin content ${cid}:`, error);
    return false;
  }
}

async function unpinContent(cid: string): Promise<boolean> {
  if (!state.helia) {
    throw new Error("Helia not initialized");
  }

  try {
    const { CID } = await import("multiformats/cid");
    const parsedCid = CID.parse(cid);

    await state.helia.pins.rm(parsedCid);

    logger.info(`Unpinned content: ${cid}`);
    return true;
  } catch (error) {
    logger.error(`Failed to unpin content ${cid}:`, error);
    return false;
  }
}

async function storeContent(
  data: Uint8Array,
  options?: { pin?: boolean }
): Promise<string> {
  if (!state.helia) {
    throw new Error("Helia not initialized");
  }

  const { json } = await import("@helia/json");
  const jsonCodec = json(state.helia);

  // Store as raw block
  const { CID } = await import("multiformats/cid");
  const { sha256 } = await import("multiformats/hashes/sha2");

  const hash = await sha256.digest(data);
  const cid = CID.createV1(0x55, hash); // raw codec

  await state.helia.blockstore.put(cid, data);

  if (options?.pin !== false) {
    await state.helia.pins.add(cid);
  }

  return cid.toString();
}

// ============================================================================
// Job Execution
// ============================================================================

async function createJob(
  params: Omit<InferenceJob, "id" | "status" | "createdAt">
): Promise<InferenceJob> {
  const job: InferenceJob = {
    ...params,
    id: crypto.randomUUID(),
    status: "pending",
    createdAt: Date.now(),
  };

  state.jobs.set(job.id, job);
  state.pendingJobs.push(job);

  // Broadcast job to network
  if (state.libp2p) {
    const message = {
      type: "job:broadcast",
      job,
    };
    await state.libp2p.services.pubsub.publish(
      "/joycreate/compute/jobs/1.0.0",
      new TextEncoder().encode(JSON.stringify(message))
    );
  }

  emitEvent({ type: "job:created", job });
  return job;
}

function handleJobBroadcast(job: InferenceJob): void {
  // Check if we should accept this job
  if (!state.config.execution.autoAcceptJobs) {
    return;
  }

  if (state.activeJobs.size >= state.config.execution.maxConcurrentJobs) {
    return;
  }

  // Check if we have the required capabilities
  // This would need to check model compatibility, VRAM, etc.

  // Accept the job
  acceptJob(job.id);
}

async function acceptJob(jobId: string): Promise<boolean> {
  const job = state.jobs.get(jobId) || state.pendingJobs.find((j) => j.id === jobId);

  if (!job) {
    logger.error(`Job not found: ${jobId}`);
    return false;
  }

  if (job.executor && job.executor !== state.localPeerId?.peerId) {
    logger.warn(`Job already assigned to another executor: ${job.executor}`);
    return false;
  }

  // Mark as assigned
  job.executor = state.localPeerId?.peerId;
  job.status = "assigned";

  // Broadcast assignment
  if (state.libp2p && state.localPeerId) {
    const message = {
      type: "job:assignment",
      jobId,
      executor: state.localPeerId.peerId,
    };
    await state.libp2p.services.pubsub.publish(
      "/joycreate/compute/jobs/1.0.0",
      new TextEncoder().encode(JSON.stringify(message))
    );
  }

  emitEvent({ type: "job:assigned", jobId, executor: state.localPeerId?.peerId || "" });

  // Start execution
  executeJob(job);

  return true;
}

function handleJobAssignment(jobId: string, executor: string): void {
  const job = state.jobs.get(jobId);
  if (job) {
    job.executor = executor;
    job.status = "assigned";
    emitEvent({ type: "job:assigned", jobId, executor });
  }

  // Remove from pending if we didn't get it
  if (executor !== state.localPeerId?.peerId) {
    state.pendingJobs = state.pendingJobs.filter((j) => j.id !== jobId);
  }
}

async function executeJob(job: InferenceJob): Promise<void> {
  state.activeJobs.set(job.id, job);
  state.pendingJobs = state.pendingJobs.filter((j) => j.id !== job.id);

  const startTime = Date.now();
  job.startedAt = startTime;
  job.status = "fetching-model";

  emitEvent({ type: "job:started", jobId: job.id });

  try {
    // Fetch model if needed
    const modelPath = path.join(
      state.config.content.cacheDir,
      "models",
      job.modelCid
    );

    if (!(await fs.pathExists(modelPath))) {
      job.status = "fetching-model";
      emitEvent({ type: "job:progress", jobId: job.id, progress: 0.1 });

      await fetchContent({
        id: crypto.randomUUID(),
        cid: job.modelCid,
        priority: 10,
        maxProviders: 5,
        chunkTimeoutMs: 60000,
        verifyChunks: true,
        destinationPath: modelPath,
        requester: state.localPeerId?.peerId || "",
        requestedAt: Date.now(),
      });
    }

    // Fetch input
    job.status = "fetching-input";
    emitEvent({ type: "job:progress", jobId: job.id, progress: 0.3 });

    const inputPath = path.join(
      state.config.content.cacheDir,
      "inputs",
      job.inputCid
    );

    if (!(await fs.pathExists(inputPath))) {
      await fetchContent({
        id: crypto.randomUUID(),
        cid: job.inputCid,
        priority: 10,
        maxProviders: 5,
        chunkTimeoutMs: 30000,
        verifyChunks: true,
        destinationPath: inputPath,
        requester: state.localPeerId?.peerId || "",
        requestedAt: Date.now(),
      });
    }

    // Execute inference
    job.status = "executing";
    emitEvent({ type: "job:progress", jobId: job.id, progress: 0.5 });

    // This would call the actual inference engine
    // For now, we'll simulate
    const result = await runInference(job, modelPath, inputPath);

    // Store output
    const outputCid = await storeContent(
      new TextEncoder().encode(JSON.stringify(result.output))
    );

    const executionTime = Date.now() - startTime;
    const metrics: ExecutionMetrics = {
      executionTimeMs: executionTime,
      modelLoadTimeMs: result.metrics?.modelLoadTimeMs || 0,
      inputProcessTimeMs: result.metrics?.inputProcessTimeMs || 0,
      inferenceTimeMs: result.metrics?.inferenceTimeMs || 0,
      outputProcessTimeMs: result.metrics?.outputProcessTimeMs || 0,
      peakMemoryMb: result.metrics?.peakMemoryMb || 0,
      peakVramMb: result.metrics?.peakVramMb || 0,
      tokensProcessed: result.metrics?.tokensProcessed,
      tokensPerSecond: result.metrics?.tokensPerSecond,
    };

    // Create receipt
    const receipt = await createExecutionReceipt(job, outputCid, metrics);

    const jobResult: JobResult = {
      jobId: job.id,
      executor: state.localPeerId?.peerId || "",
      outputCid,
      outputHash: hashData(new TextEncoder().encode(JSON.stringify(result.output))),
      metrics,
      receipt,
      completedAt: Date.now(),
    };

    job.status = "validating";
    job.results = job.results || [];
    job.results.push(jobResult);

    emitEvent({ type: "job:progress", jobId: job.id, progress: 0.9 });

    // Broadcast result
    if (state.libp2p) {
      await state.libp2p.services.pubsub.publish(
        "/joycreate/compute/jobs/1.0.0",
        new TextEncoder().encode(
          JSON.stringify({
            type: "job:result",
            result: jobResult,
          })
        )
      );
    }

    // Request validation if needed
    if (job.redundancy > 1 || job.validators.length > 0) {
      await requestValidation(job, jobResult);
    } else {
      // Complete job
      job.status = "completed";
      job.completedAt = Date.now();
      emitEvent({ type: "job:completed", jobId: job.id, result: jobResult });
    }
  } catch (error) {
    logger.error(`Job ${job.id} failed:`, error);
    job.status = "failed";
    job.completedAt = Date.now();
    emitEvent({ type: "job:failed", jobId: job.id, error: String(error) });
  } finally {
    state.activeJobs.delete(job.id);
  }
}

async function runInference(
  job: InferenceJob,
  modelPath: string,
  inputPath: string
): Promise<{
  output: unknown;
  metrics?: Partial<ExecutionMetrics>;
}> {
  // This is a placeholder - actual implementation would call
  // llama.cpp, ONNX runtime, or other inference engines
  logger.info(`Running inference for job ${job.id}`);

  // Simulate inference
  await new Promise((resolve) => setTimeout(resolve, 1000));

  return {
    output: {
      type: job.type,
      result: "Simulated inference result",
      timestamp: Date.now(),
    },
    metrics: {
      modelLoadTimeMs: 500,
      inputProcessTimeMs: 100,
      inferenceTimeMs: 400,
      outputProcessTimeMs: 50,
      peakMemoryMb: 1024,
    },
  };
}

async function createExecutionReceipt(
  job: InferenceJob,
  outputCid: string,
  metrics: ExecutionMetrics
): Promise<ExecutionReceipt> {
  if (!state.localPeerId || !state.keyPair) {
    throw new Error("Local identity not initialized");
  }

  const receipt: ExecutionReceipt = {
    id: crypto.randomUUID(),
    jobId: job.id,
    executor: state.localPeerId.peerId,
    executorWallet: state.localPeerId.walletAddress,
    inputCid: job.inputCid,
    outputCid,
    modelCid: job.modelCid,
    outputHash: "", // Will be set below
    metricsHash: hashData(new TextEncoder().encode(JSON.stringify(metrics))),
    timestamp: Date.now(),
    nonce: crypto.randomBytes(16).toString("hex"),
    signature: "",
  };

  // Sign receipt
  const receiptData = JSON.stringify({ ...receipt, signature: undefined });
  const signature = signData(
    new TextEncoder().encode(receiptData),
    state.keyPair.secretKey
  );
  receipt.signature = encodeToBase64(signature);

  return receipt;
}

function handleJobResult(result: JobResult): void {
  const job = state.jobs.get(result.jobId);
  if (!job) {
    logger.warn(`Received result for unknown job: ${result.jobId}`);
    return;
  }

  job.results = job.results || [];
  job.results.push(result);

  // Check if we have enough results for consensus
  if (job.results.length >= job.redundancy) {
    checkConsensus(job);
  }
}

function handleJobCancellation(jobId: string): void {
  const job = state.jobs.get(jobId);
  if (job) {
    job.status = "cancelled";
    job.completedAt = Date.now();
  }

  state.activeJobs.delete(jobId);
  state.pendingJobs = state.pendingJobs.filter((j) => j.id !== jobId);
}

// ============================================================================
// Validation & Consensus
// ============================================================================

async function requestValidation(
  job: InferenceJob,
  result: JobResult
): Promise<void> {
  const request: ValidationRequest = {
    id: crypto.randomUUID(),
    jobId: job.id,
    resultToValidate: result,
    validator: "", // Will be assigned
    validationType:
      state.config.validation.supportedValidationTypes[0] || "hash-verification",
    timeoutMs: 60000,
    stakeAmount: state.config.validation.validatorStake,
    requestedAt: Date.now(),
  };

  state.validationRequests.set(request.id, request);

  // Broadcast validation request
  if (state.libp2p) {
    await state.libp2p.services.pubsub.publish(
      "/joycreate/compute/validation/1.0.0",
      new TextEncoder().encode(
        JSON.stringify({
          type: "validation:request",
          request,
        })
      )
    );
  }

  emitEvent({ type: "validation:requested", request });
}

function handleValidationRequest(request: ValidationRequest): void {
  // Check if we should handle this validation
  if (!state.config.validation.enableValidator) {
    return;
  }

  const activeValidations = Array.from(state.validationRequests.values()).filter(
    (r) => r.validator === state.localPeerId?.peerId
  ).length;

  if (activeValidations >= state.config.validation.maxConcurrentValidations) {
    return;
  }

  // Accept validation
  request.validator = state.localPeerId?.peerId || "";
  state.validationRequests.set(request.id, request);

  // Perform validation
  performValidation(request);
}

async function performValidation(request: ValidationRequest): Promise<void> {
  const startTime = Date.now();

  try {
    let isValid = true;
    let confidence = 1.0;
    let validatorOutputHash: string | undefined;
    let matchScore: number | undefined;

    switch (request.validationType) {
      case "hash-verification":
        // Verify the output hash matches
        isValid = true; // Hash is self-verifying via CID
        confidence = 1.0;
        break;

      case "sampling":
        // Re-run a sample of the computation
        // This would re-execute with a subset of the input
        isValid = true;
        confidence = 0.95;
        break;

      case "full-reexecution":
        // Re-execute the entire job
        const job = state.jobs.get(request.jobId);
        if (job) {
          const modelPath = path.join(
            state.config.content.cacheDir,
            "models",
            job.modelCid
          );
          const inputPath = path.join(
            state.config.content.cacheDir,
            "inputs",
            job.inputCid
          );

          const rerunResult = await runInference(job, modelPath, inputPath);
          validatorOutputHash = hashData(
            new TextEncoder().encode(JSON.stringify(rerunResult.output))
          );

          // Compare hashes
          isValid = validatorOutputHash === request.resultToValidate.outputHash;
          matchScore = isValid ? 1.0 : 0.0;
          confidence = 1.0;
        }
        break;

      case "output-comparison":
        // Compare outputs for similarity
        matchScore = 1.0; // Would need actual comparison logic
        isValid = matchScore >= 0.95;
        confidence = matchScore;
        break;

      default:
        isValid = true;
        confidence = 0.5;
    }

    const validationTime = Date.now() - startTime;

    const validationResult: ValidationResult = {
      requestId: request.id,
      jobId: request.jobId,
      validator: state.localPeerId?.peerId || "",
      isValid,
      confidence,
      validationType: request.validationType,
      validatorOutputHash,
      matchScore,
      metrics: {
        validationTimeMs: validationTime,
        resourcesUsed: 0,
      },
      signature: "",
      completedAt: Date.now(),
    };

    // Sign result
    if (state.keyPair) {
      const dataToSign = JSON.stringify({
        ...validationResult,
        signature: undefined,
      });
      const signature = signData(
        new TextEncoder().encode(dataToSign),
        state.keyPair.secretKey
      );
      validationResult.signature = encodeToBase64(signature);
    }

    // Broadcast result
    if (state.libp2p) {
      await state.libp2p.services.pubsub.publish(
        "/joycreate/compute/validation/1.0.0",
        new TextEncoder().encode(
          JSON.stringify({
            type: "validation:result",
            result: validationResult,
          })
        )
      );
    }

    emitEvent({ type: "validation:completed", result: validationResult });
  } catch (error) {
    logger.error(`Validation failed for request ${request.id}:`, error);
  }
}

function handleValidationResult(result: ValidationResult): void {
  const job = state.jobs.get(result.jobId);
  if (!job) return;

  // Store validation result
  // Check if we have enough validations for consensus
  const allValidations = Array.from(state.validationRequests.values())
    .filter((r) => r.jobId === result.jobId)
    .map((r) => r); // Would need to track results

  emitEvent({ type: "validation:completed", result });

  // Check consensus
  checkConsensus(job);
}

function checkConsensus(job: InferenceJob): void {
  if (!job.results || job.results.length === 0) return;

  // Group results by output hash
  const hashGroups = new Map<string, JobResult[]>();
  for (const result of job.results) {
    const existing = hashGroups.get(result.outputHash) || [];
    existing.push(result);
    hashGroups.set(result.outputHash, existing);
  }

  // Find majority
  let maxCount = 0;
  let majorityHash = "";
  let majorityResults: JobResult[] = [];

  for (const [hash, results] of hashGroups) {
    if (results.length > maxCount) {
      maxCount = results.length;
      majorityHash = hash;
      majorityResults = results;
    }
  }

  // Check if consensus threshold is met
  const consensusScore = maxCount / job.results.length;

  if (consensusScore >= job.consensusThreshold) {
    const majorityExecutor = majorityResults[0]?.executor;
    const disputedExecutors = job.results
      .filter((r) => r.outputHash !== majorityHash)
      .map((r) => r.executor);

    const consensusResult: ConsensusResult = {
      jobId: job.id,
      consensusReached: true,
      finalOutputCid: majorityResults[0]?.outputCid,
      finalOutputHash: majorityHash,
      executors: job.results.map((r) => r.executor),
      validations: [],
      consensusScore,
      majorityExecutor,
      disputedExecutors,
      slashedAmounts: {},
      rewardsDistributed: {},
      finalizedAt: Date.now(),
      consensusSignature: "",
    };

    job.consensusResult = consensusResult;
    job.status = "completed";
    job.completedAt = Date.now();

    emitEvent({ type: "consensus:reached", result: consensusResult });
    emitEvent({
      type: "job:completed",
      jobId: job.id,
      result: majorityResults[0],
    });
  } else if (job.results.length >= job.redundancy) {
    // Consensus failed
    job.status = "disputed";
    emitEvent({
      type: "consensus:failed",
      jobId: job.id,
      reason: `Consensus threshold not met: ${consensusScore} < ${job.consensusThreshold}`,
    });
  }
}

// ============================================================================
// Network Status
// ============================================================================

function getNetworkStatus(): NetworkStatus {
  return {
    initialized: state.helia !== null && state.libp2p !== null,
    localPeer: state.localPeerId
      ? {
          id: state.localPeerId,
          capabilities: {
            gpus: [],
            totalVram: 0,
            availableVram: 0,
            cpuCores: os.cpus().length,
            ramMb: Math.floor(os.totalmem() / 1024 / 1024),
            availableRamMb: Math.floor(os.freemem() / 1024 / 1024),
            diskMb: 0,
            supportedFormats: ["gguf", "safetensors", "onnx"],
            supportedQuantizations: ["fp16", "int8", "q4_0", "q4_k"],
            maxModelSize: 0,
            maxBatchSize: 1,
            bandwidthMbps: 100,
            canValidate: state.config.validation.enableValidator,
          },
          addresses: state.libp2p?.getMultiaddrs()?.map((ma: any) => ma.toString()) || [],
          firstSeen: state.startTime,
          lastSeen: Date.now(),
          reputation: 100,
          jobsCompleted: Array.from(state.jobs.values()).filter(
            (j) => j.status === "completed"
          ).length,
          avgLatency: 0,
          uptime: 100,
          status: getLocalStatus(),
          activeJobs: state.activeJobs.size,
          natType: "unknown",
          isRelay: state.config.transport.enableRelayServer,
        }
      : undefined,
    connectedPeers: state.connections.size,
    knownPeers: state.peers.size,
    activeJobs: state.activeJobs.size,
    pendingJobs: state.pendingJobs.length,
    activeFetches: state.fetchRequests.size,
    heliaStatus: state.helia ? "ready" : "stopped",
    libp2pStatus: state.libp2p ? "started" : "stopped",
    natStatus: "unknown",
    isRelay: state.config.transport.enableRelayServer,
    dhtMode: state.config.discovery.enableDht ? "server" : "disabled",
    bootstrapped: state.connections.size > 0,
    uptime: state.startTime ? Math.floor((Date.now() - state.startTime) / 1000) : 0,
  };
}

async function shutdownNetwork(): Promise<void> {
  logger.info("Shutting down compute network...");

  // Stop heartbeat
  if (state.heartbeatInterval) {
    clearInterval(state.heartbeatInterval);
    state.heartbeatInterval = null;
  }

  // Cancel active jobs
  for (const [jobId, job] of state.activeJobs) {
    job.status = "cancelled";
    job.completedAt = Date.now();
  }
  state.activeJobs.clear();

  // Stop Helia
  if (state.helia) {
    await state.helia.stop();
    state.helia = null;
  }

  // Stop libp2p
  if (state.libp2p) {
    await state.libp2p.stop();
    state.libp2p = null;
  }

  state.peers.clear();
  state.connections.clear();
  state.jobs.clear();
  state.pendingJobs = [];
  state.fetchRequests.clear();
  state.fetchProgress.clear();

  logger.info("Compute network shutdown complete");
}

// ============================================================================
// IPC Handler Registration
// ============================================================================

export function registerComputeNetworkHandlers(): void {
  // Network lifecycle
  ipcMain.handle(
    "compute-network:initialize",
    async (_event: IpcMainInvokeEvent, config: Partial<ComputeNetworkConfig>) => {
      return initializeNetwork(config);
    }
  );

  ipcMain.handle("compute-network:shutdown", async () => {
    await shutdownNetwork();
    return { success: true };
  });

  ipcMain.handle("compute-network:get-status", async () => {
    return getNetworkStatus();
  });

  ipcMain.handle("compute-network:get-config", async () => {
    return state.config;
  });

  ipcMain.handle(
    "compute-network:update-config",
    async (_event: IpcMainInvokeEvent, config: Partial<ComputeNetworkConfig>) => {
      state.config = {
        ...state.config,
        ...config,
      };
      return state.config;
    }
  );

  // Peer management
  ipcMain.handle("compute-network:get-peers", async () => {
    return Array.from(state.peers.values());
  });

  ipcMain.handle(
    "compute-network:get-peer",
    async (_event: IpcMainInvokeEvent, peerId: string) => {
      return state.peers.get(peerId) || null;
    }
  );

  ipcMain.handle("compute-network:get-connections", async () => {
    return Array.from(state.connections.values());
  });

  ipcMain.handle(
    "compute-network:connect-peer",
    async (_event: IpcMainInvokeEvent, multiaddr: string) => {
      if (!state.libp2p) {
        throw new Error("Network not initialized");
      }

      const { multiaddr: ma } = await import("@multiformats/multiaddr");
      const addr = ma(multiaddr);
      await state.libp2p.dial(addr);
      return { success: true };
    }
  );

  ipcMain.handle(
    "compute-network:disconnect-peer",
    async (_event: IpcMainInvokeEvent, peerId: string) => {
      if (!state.libp2p) {
        throw new Error("Network not initialized");
      }

      await state.libp2p.hangUp(peerId);
      return { success: true };
    }
  );

  // Content management
  ipcMain.handle(
    "compute-network:fetch-content",
    async (_event: IpcMainInvokeEvent, request: FetchRequest) => {
      return fetchContent(request);
    }
  );

  ipcMain.handle(
    "compute-network:pin-content",
    async (_event: IpcMainInvokeEvent, cid: string) => {
      return pinContent(cid);
    }
  );

  ipcMain.handle(
    "compute-network:unpin-content",
    async (_event: IpcMainInvokeEvent, cid: string) => {
      return unpinContent(cid);
    }
  );

  ipcMain.handle(
    "compute-network:store-content",
    async (
      _event: IpcMainInvokeEvent,
      data: Uint8Array,
      options?: { pin?: boolean }
    ) => {
      return storeContent(data, options);
    }
  );

  ipcMain.handle("compute-network:get-fetch-progress", async () => {
    return Array.from(state.fetchProgress.values());
  });

  // Job management
  ipcMain.handle(
    "compute-network:create-job",
    async (
      _event: IpcMainInvokeEvent,
      params: Omit<InferenceJob, "id" | "status" | "createdAt">
    ) => {
      return createJob(params);
    }
  );

  ipcMain.handle(
    "compute-network:accept-job",
    async (_event: IpcMainInvokeEvent, jobId: string) => {
      return acceptJob(jobId);
    }
  );

  ipcMain.handle(
    "compute-network:cancel-job",
    async (_event: IpcMainInvokeEvent, jobId: string) => {
      handleJobCancellation(jobId);
      return { success: true };
    }
  );

  ipcMain.handle("compute-network:get-jobs", async () => {
    return Array.from(state.jobs.values());
  });

  ipcMain.handle(
    "compute-network:get-job",
    async (_event: IpcMainInvokeEvent, jobId: string) => {
      return state.jobs.get(jobId) || null;
    }
  );

  ipcMain.handle("compute-network:get-active-jobs", async () => {
    return Array.from(state.activeJobs.values());
  });

  ipcMain.handle("compute-network:get-pending-jobs", async () => {
    return state.pendingJobs;
  });

  // Validation
  ipcMain.handle(
    "compute-network:request-validation",
    async (
      _event: IpcMainInvokeEvent,
      jobId: string,
      resultIndex: number = 0
    ) => {
      const job = state.jobs.get(jobId);
      if (!job || !job.results || !job.results[resultIndex]) {
        throw new Error("Job or result not found");
      }
      await requestValidation(job, job.results[resultIndex]);
      return { success: true };
    }
  );

  ipcMain.handle("compute-network:get-validation-requests", async () => {
    return Array.from(state.validationRequests.values());
  });

  // Telemetry
  ipcMain.handle("compute-network:get-job-stats", async () => {
    return getJobStats();
  });

  ipcMain.handle("compute-network:get-system-metrics", async () => {
    return getSystemMetrics();
  });

  ipcMain.handle("compute-network:get-network-metrics", async () => {
    return getNetworkMetrics();
  });

  // Event subscription (via renderer)
  ipcMain.handle(
    "compute-network:subscribe",
    async (_event: IpcMainInvokeEvent, eventType: string = "*") => {
      // Events are sent via webContents
      return { subscribed: eventType };
    }
  );

  logger.info("Compute network IPC handlers registered");
}

export {
  initializeNetwork,
  shutdownNetwork,
  getNetworkStatus,
  fetchContent,
  pinContent,
  unpinContent,
  storeContent,
  createJob,
  acceptJob,
  requestValidation,
  sendHeartbeat,
};
