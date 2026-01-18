/**
 * Decentralized WebRTC Handlers
 * Peer-to-peer communication with decentralized STUN/TURN servers
 * Uses node-datachannel for native WebRTC in Electron main process
 */

import { ipcMain, BrowserWindow } from "electron";
import * as fs from "fs-extra";
import * as path from "path";
import * as crypto from "crypto";
import log from "electron-log";
import { getUserDataPath } from "@/paths/paths";
import type {
  IceServer,
  DecentralizedIceServer,
  IceCandidate,
  WebRTCPeerConnection,
  WebRTCConnectionState,
  SignalingMessage,
  CallInfo,
  CallState,
  CallParticipant,
  ConnectionQuality,
  WebRTCEvent,
  WebRTCServiceStatus,
  NATType,
  InitWebRTCRequest,
  InitWebRTCResult,
  ConnectPeerRequest,
  ConnectPeerResult,
  StartCallRequest,
  StartCallResult,
  AnswerCallRequest,
  SendDataRequest,
  RegisterIceServerRequest,
  RegisterIceServerResult,
} from "@/types/webrtc_types";

const logger = log.scope("webrtc");

// ESM imports
let nodeDataChannel: any;

async function loadWebRTCModules() {
  if (!nodeDataChannel) {
    try {
      nodeDataChannel = await import("node-datachannel");
      logger.info("Loaded node-datachannel module");
    } catch (error) {
      logger.error("Failed to load node-datachannel:", error);
      throw error;
    }
  }
}

// ============================================================================
// Storage Paths
// ============================================================================

function getWebRTCDir(): string {
  return path.join(getUserDataPath(), "webrtc");
}

function getIceServersFile(): string {
  return path.join(getWebRTCDir(), "ice-servers.json");
}

function getConnectionsDir(): string {
  return path.join(getWebRTCDir(), "connections");
}

function getCallsDir(): string {
  return path.join(getWebRTCDir(), "calls");
}

async function initWebRTCDirs(): Promise<void> {
  await fs.ensureDir(getWebRTCDir());
  await fs.ensureDir(getConnectionsDir());
  await fs.ensureDir(getCallsDir());
}

// ============================================================================
// Decentralized STUN/TURN Servers
// These are community-run, privacy-respecting alternatives to Google's servers
// ============================================================================

const DECENTRALIZED_ICE_SERVERS: IceServer[] = [
  // Open STUN servers (free, privacy-respecting)
  { urls: "stun:stun.l.google.com:19302" }, // Fallback only
  { urls: "stun:stun.stunprotocol.org:3478" },
  { urls: "stun:stun.voip.blackberry.com:3478" },
  { urls: "stun:stun.nextcloud.com:443" },
  { urls: "stun:stun.sipgate.net:3478" },
  { urls: "stun:stun.counterpath.com:3478" },
  { urls: "stun:stun.sip.us:3478" },
  { urls: "stun:stun.voiparound.com" },
  { urls: "stun:stun.voipbuster.com" },
  { urls: "stun:stun.voipstunt.com" },
  
  // Metered TURN servers (freemium, privacy-focused)
  // Users can self-host these
];

// JoyCreate community ICE servers (announced via DHT)
const communityIceServers = new Map<string, DecentralizedIceServer>();

// ============================================================================
// State Management
// ============================================================================

let localPeerId: string | null = null;
let localWalletAddress: string | null = null;
let initialized = false;

// Active connections
const peerConnections = new Map<string, {
  pc: any; // node-datachannel PeerConnection
  info: WebRTCPeerConnection;
  dataChannels: Map<string, any>;
}>();

// Active calls
const activeCalls = new Map<string, CallInfo>();

// Signaling queue for offline peers
const signalingQueue = new Map<string, SignalingMessage[]>();

// NAT detection
let detectedNATType: NATType | null = null;
let publicIP: string | null = null;

// ============================================================================
// Initialization
// ============================================================================

async function initializeWebRTC(request: InitWebRTCRequest): Promise<InitWebRTCResult> {
  try {
    await loadWebRTCModules();
    await initWebRTCDirs();
    
    localWalletAddress = request.walletAddress;
    localPeerId = `webrtc-${crypto.randomBytes(16).toString("hex")}`;
    
    // Load known ICE servers from DHT cache
    await loadCommunityIceServers();
    
    // Detect NAT type
    await detectNATType();
    
    initialized = true;
    
    logger.info("WebRTC initialized", {
      peerId: localPeerId,
      walletAddress: localWalletAddress,
      natType: detectedNATType,
      iceServers: communityIceServers.size,
    });
    
    return { success: true, peerId: localPeerId };
  } catch (error) {
    logger.error("Failed to initialize WebRTC:", error);
    return { success: false, error: (error as Error).message };
  }
}

// ============================================================================
// ICE Server Management
// ============================================================================

async function loadCommunityIceServers(): Promise<void> {
  try {
    const filePath = getIceServersFile();
    if (await fs.pathExists(filePath)) {
      const servers = await fs.readJson(filePath) as DecentralizedIceServer[];
      for (const server of servers) {
        communityIceServers.set(server.id, server);
      }
      logger.info("Loaded community ICE servers", { count: servers.length });
    }
  } catch (error) {
    logger.warn("Failed to load community ICE servers:", error);
  }
}

async function saveCommunityIceServers(): Promise<void> {
  try {
    const servers = Array.from(communityIceServers.values());
    await fs.writeJson(getIceServersFile(), servers, { spaces: 2 });
  } catch (error) {
    logger.warn("Failed to save community ICE servers:", error);
  }
}

function getIceServers(): IceServer[] {
  // Prioritize community servers with good reputation
  const community = Array.from(communityIceServers.values())
    .filter(s => s.reputation > 50 && Date.now() - new Date(s.lastSeen).getTime() < 3600000)
    .sort((a, b) => (a.latencyMs || 1000) - (b.latencyMs || 1000))
    .slice(0, 5)
    .map(s => ({
      urls: s.urls,
      username: s.type === "turn" ? `joycreate-${localWalletAddress}` : undefined,
      credential: s.type === "turn" ? generateTurnCredential(s) : undefined,
    }));
  
  // Add fallback decentralized servers
  return [...community, ...DECENTRALIZED_ICE_SERVERS];
}

function generateTurnCredential(server: DecentralizedIceServer): string {
  // Generate time-limited credential using TURN server's public key
  const timestamp = Math.floor(Date.now() / 1000) + 86400; // 24 hours
  const username = `${timestamp}:${localWalletAddress}`;
  const hmac = crypto.createHmac("sha1", server.publicKey);
  hmac.update(username);
  return hmac.digest("base64");
}

async function registerAsIceServer(request: RegisterIceServerRequest): Promise<RegisterIceServerResult> {
  if (!localPeerId || !localWalletAddress) {
    return { success: false, error: "WebRTC not initialized" };
  }
  
  try {
    // Detect public IP if not provided
    const publicIp = request.publicIp || await detectPublicIP();
    if (!publicIp) {
      return { success: false, error: "Could not detect public IP" };
    }
    
    const serverId = `ice-${crypto.randomBytes(8).toString("hex")}`;
    const urls: string[] = [];
    
    if (request.type === "stun" || request.type === "both") {
      urls.push(`stun:${publicIp}:${request.port}`);
    }
    if (request.type === "turn" || request.type === "both") {
      urls.push(`turn:${publicIp}:${request.port}`);
      urls.push(`turns:${publicIp}:${request.port + 1}`);
    }
    
    const server: DecentralizedIceServer = {
      id: serverId,
      peerId: localPeerId,
      type: request.type,
      urls,
      region: request.region,
      maxConnections: request.maxConnections || 100,
      currentConnections: 0,
      publicKey: crypto.randomBytes(32).toString("base64"),
      lastSeen: new Date().toISOString(),
      registeredAt: new Date().toISOString(),
      reputation: 50, // Start with neutral reputation
    };
    
    communityIceServers.set(serverId, server);
    await saveCommunityIceServers();
    
    // Announce to DHT (would integrate with federation DHT)
    emitWebRTCEvent({ type: "ice-server:discovered", server });
    
    logger.info("Registered as ICE server", { serverId, urls });
    
    return { success: true, serverId, urls };
  } catch (error) {
    logger.error("Failed to register as ICE server:", error);
    return { success: false, error: (error as Error).message };
  }
}

async function detectPublicIP(): Promise<string | null> {
  try {
    // Use multiple STUN servers to detect public IP
    // This is a simplified implementation
    return publicIP;
  } catch {
    return null;
  }
}

async function detectNATType(): Promise<void> {
  try {
    // NAT type detection using STUN
    // Simplified - would need full RFC 5780 implementation
    detectedNATType = "unknown";
    logger.debug("NAT type detection:", { type: detectedNATType });
  } catch (error) {
    logger.warn("NAT type detection failed:", error);
    detectedNATType = "unknown";
  }
}

// ============================================================================
// Peer Connection Management
// ============================================================================

async function connectToPeer(request: ConnectPeerRequest): Promise<ConnectPeerResult> {
  if (!initialized || !localPeerId) {
    return { success: false, error: "WebRTC not initialized" };
  }
  
  try {
    await loadWebRTCModules();
    
    const connectionId = `conn-${crypto.randomBytes(8).toString("hex")}`;
    const iceServers = getIceServers();
    
    // Create peer connection with node-datachannel
    const config = {
      iceServers: iceServers.map(s => ({
        urls: Array.isArray(s.urls) ? s.urls : [s.urls],
        username: s.username,
        credential: s.credential,
      })),
    };
    
    const pc = new nodeDataChannel.PeerConnection("JoyCreate", config);
    
    // Set up event handlers
    pc.onLocalDescription((sdp: string, type: string) => {
      logger.debug("Local description generated", { type });
      sendSignalingMessage({
        id: crypto.randomUUID(),
        type: type as "offer" | "answer",
        from: localPeerId!,
        fromWallet: localWalletAddress!,
        to: "", // Will be filled when we know remote peer ID
        toWallet: request.walletAddress,
        sdp,
        sdpType: type as "offer" | "answer",
        conversationId: request.conversationId,
        signature: "",
        timestamp: new Date().toISOString(),
        nonce: crypto.randomBytes(16).toString("hex"),
      });
    });
    
    pc.onLocalCandidate((candidate: string, mid: string) => {
      logger.debug("Local ICE candidate", { mid });
      sendSignalingMessage({
        id: crypto.randomUUID(),
        type: "ice-candidate",
        from: localPeerId!,
        fromWallet: localWalletAddress!,
        to: "",
        toWallet: request.walletAddress,
        candidate: {
          candidate,
          sdpMid: mid,
          sdpMLineIndex: 0,
        },
        signature: "",
        timestamp: new Date().toISOString(),
        nonce: crypto.randomBytes(16).toString("hex"),
      });
    });
    
    pc.onStateChange((state: string) => {
      logger.info("Connection state changed", { connectionId, state });
      updateConnectionState(connectionId, state as WebRTCConnectionState);
    });
    
    pc.onGatheringStateChange((state: string) => {
      logger.debug("ICE gathering state", { connectionId, state });
    });
    
    // Create connection info
    const connectionInfo: WebRTCPeerConnection = {
      id: connectionId,
      localPeerId: localPeerId!,
      remotePeerId: "",
      remoteWalletAddress: request.walletAddress,
      connectionState: "new",
      signalingState: "stable",
      iceConnectionState: "new",
      iceGatheringState: "new",
      dataChannels: [],
      localStreams: [],
      remoteStreams: [],
      bytesReceived: 0,
      bytesSent: 0,
      packetsReceived: 0,
      packetsSent: 0,
      quality: {
        score: 0,
        rating: "poor",
        latencyMs: 0,
        jitterMs: 0,
        packetLossPercent: 0,
        bandwidthKbps: 0,
      },
      createdAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
    };
    
    // Store connection
    const dataChannels = new Map<string, any>();
    peerConnections.set(connectionId, { pc, info: connectionInfo, dataChannels });
    
    // Create data channel if requested
    if (request.createDataChannel) {
      const label = request.channelLabel || "joycreate-data";
      const dc = pc.createDataChannel(label);
      
      dc.onOpen(() => {
        logger.info("Data channel opened", { connectionId, label });
        emitWebRTCEvent({
          type: "datachannel:open",
          peerId: connectionId,
          channel: {
            id: 0,
            label,
            protocol: "",
            state: "open",
            ordered: true,
            bufferedAmount: 0,
          },
        });
      });
      
      dc.onMessage((msg: any) => {
        const data = typeof msg === "string" ? JSON.parse(msg) : msg;
        emitWebRTCEvent({
          type: "datachannel:message",
          peerId: connectionId,
          channelLabel: label,
          data,
        });
      });
      
      dc.onClosed(() => {
        logger.info("Data channel closed", { connectionId, label });
        emitWebRTCEvent({
          type: "datachannel:close",
          peerId: connectionId,
          channelLabel: label,
        });
      });
      
      dataChannels.set(label, dc);
    }
    
    // Create offer
    pc.setLocalDescription();
    
    emitWebRTCEvent({
      type: "peer:connecting",
      peerId: connectionId,
      walletAddress: request.walletAddress,
    });
    
    return { success: true, connectionId };
  } catch (error) {
    logger.error("Failed to connect to peer:", error);
    return { success: false, error: (error as Error).message };
  }
}

function updateConnectionState(connectionId: string, state: WebRTCConnectionState): void {
  const connection = peerConnections.get(connectionId);
  if (!connection) return;
  
  connection.info.connectionState = state;
  connection.info.lastActivityAt = new Date().toISOString();
  
  if (state === "connected") {
    connection.info.connectedAt = new Date().toISOString();
    emitWebRTCEvent({
      type: "peer:connected",
      connection: connection.info,
    });
  } else if (state === "disconnected" || state === "closed") {
    emitWebRTCEvent({
      type: "peer:disconnected",
      peerId: connectionId,
      reason: state,
    });
  } else if (state === "failed") {
    emitWebRTCEvent({
      type: "peer:failed",
      peerId: connectionId,
      error: "Connection failed",
    });
  }
}

async function handleSignalingMessage(message: SignalingMessage): Promise<void> {
  logger.debug("Received signaling message", { type: message.type, from: message.fromWallet });
  
  // Find or create connection
  let connectionId = Array.from(peerConnections.entries())
    .find(([, conn]) => conn.info.remoteWalletAddress === message.fromWallet)?.[0];
  
  if (!connectionId && (message.type === "offer")) {
    // Create new connection for incoming offer
    const result = await connectToPeer({
      walletAddress: message.fromWallet,
      conversationId: message.conversationId,
    });
    connectionId = result.connectionId;
  }
  
  if (!connectionId) {
    logger.warn("No connection found for signaling message", { from: message.fromWallet });
    return;
  }
  
  const connection = peerConnections.get(connectionId);
  if (!connection) return;
  
  const { pc, info } = connection;
  
  switch (message.type) {
    case "offer":
      if (message.sdp) {
        pc.setRemoteDescription(message.sdp, "offer");
        pc.setLocalDescription(); // Generate answer
        info.remotePeerId = message.from;
      }
      break;
      
    case "answer":
      if (message.sdp) {
        pc.setRemoteDescription(message.sdp, "answer");
        info.remotePeerId = message.from;
      }
      break;
      
    case "ice-candidate":
      if (message.candidate) {
        pc.addRemoteCandidate(message.candidate.candidate, message.candidate.sdpMid || "");
      }
      break;
      
    case "ice-candidate-batch":
      if (message.candidates) {
        for (const candidate of message.candidates) {
          pc.addRemoteCandidate(candidate.candidate, candidate.sdpMid || "");
        }
      }
      break;
      
    case "hangup":
      await closeConnection(connectionId);
      break;
  }
  
  emitWebRTCEvent({ type: "signaling:received", message });
}

async function closeConnection(connectionId: string): Promise<void> {
  const connection = peerConnections.get(connectionId);
  if (!connection) return;
  
  try {
    // Close all data channels
    for (const [, dc] of connection.dataChannels) {
      dc.close();
    }
    
    // Close peer connection
    connection.pc.close();
    
    peerConnections.delete(connectionId);
    
    logger.info("Connection closed", { connectionId });
  } catch (error) {
    logger.error("Error closing connection:", error);
  }
}

// ============================================================================
// Data Channel Communication
// ============================================================================

async function sendData(request: SendDataRequest): Promise<boolean> {
  // Find connection by wallet address
  const connectionEntry = Array.from(peerConnections.entries())
    .find(([, conn]) => conn.info.remoteWalletAddress === request.walletAddress);
  
  if (!connectionEntry) {
    logger.warn("No connection found for wallet", { walletAddress: request.walletAddress });
    return false;
  }
  
  const [, connection] = connectionEntry;
  const label = request.channelLabel || "joycreate-data";
  const dc = connection.dataChannels.get(label);
  
  if (!dc) {
    logger.warn("Data channel not found", { label });
    return false;
  }
  
  try {
    const data = typeof request.data === "string" ? request.data : JSON.stringify(request.data);
    dc.sendMessage(data);
    
    connection.info.bytesSent += data.length;
    connection.info.lastActivityAt = new Date().toISOString();
    
    return true;
  } catch (error) {
    logger.error("Failed to send data:", error);
    return false;
  }
}

// ============================================================================
// Signaling via libp2p/Chat
// ============================================================================

async function sendSignalingMessage(message: SignalingMessage): Promise<void> {
  // Sign the message
  // message.signature = await signMessage(JSON.stringify(message));
  
  // Send via decentralized chat's pubsub
  // This integrates with the existing chat infrastructure
  const topic = `/joycreate/webrtc/signaling/${message.toWallet}`;
  
  // Would use libp2p pubsub from chat handlers
  logger.debug("Sending signaling message", { type: message.type, to: message.toWallet });
  
  // Queue if peer is offline
  if (!signalingQueue.has(message.toWallet)) {
    signalingQueue.set(message.toWallet, []);
  }
  signalingQueue.get(message.toWallet)!.push(message);
  
  emitWebRTCEvent({ type: "signaling:sent", message });
}

// ============================================================================
// Call Management (Voice/Video)
// ============================================================================

async function startCall(request: StartCallRequest): Promise<StartCallResult> {
  if (!initialized || !localWalletAddress) {
    return { success: false, error: "WebRTC not initialized" };
  }
  
  try {
    const callId = `call-${crypto.randomBytes(8).toString("hex")}`;
    
    // First establish peer connection
    const connResult = await connectToPeer({
      walletAddress: request.walletAddress,
      conversationId: request.conversationId,
      createDataChannel: true,
      channelLabel: "call-signaling",
    });
    
    if (!connResult.success) {
      return { success: false, error: connResult.error };
    }
    
    const call: CallInfo = {
      id: callId,
      conversationId: request.conversationId,
      type: request.type,
      direction: "outgoing",
      state: "ringing",
      initiator: localWalletAddress,
      participants: [
        {
          walletAddress: localWalletAddress,
          peerId: localPeerId!,
          connectionState: "connecting",
          audioEnabled: request.audioEnabled ?? true,
          videoEnabled: request.videoEnabled ?? (request.type === "video"),
          screenSharing: false,
          isSpeaking: false,
          audioLevel: 0,
          joinedAt: new Date().toISOString(),
        },
      ],
      localAudioEnabled: request.audioEnabled ?? true,
      localVideoEnabled: request.videoEnabled ?? (request.type === "video"),
      screenShareEnabled: false,
      quality: {
        score: 0,
        rating: "poor",
        latencyMs: 0,
        jitterMs: 0,
        packetLossPercent: 0,
        bandwidthKbps: 0,
      },
      startedAt: new Date().toISOString(),
    };
    
    activeCalls.set(callId, call);
    
    // Send call signaling
    await sendSignalingMessage({
      id: crypto.randomUUID(),
      type: "offer",
      from: localPeerId!,
      fromWallet: localWalletAddress,
      to: "",
      toWallet: request.walletAddress,
      conversationId: request.conversationId,
      callType: request.type,
      signature: "",
      timestamp: new Date().toISOString(),
      nonce: crypto.randomBytes(16).toString("hex"),
    });
    
    emitWebRTCEvent({ type: "call:outgoing", call });
    
    logger.info("Started call", { callId, type: request.type, to: request.walletAddress });
    
    return { success: true, callId };
  } catch (error) {
    logger.error("Failed to start call:", error);
    return { success: false, error: (error as Error).message };
  }
}

async function answerCall(request: AnswerCallRequest): Promise<boolean> {
  const call = activeCalls.get(request.callId);
  if (!call) {
    logger.warn("Call not found", { callId: request.callId });
    return false;
  }
  
  try {
    call.state = "connecting";
    call.localAudioEnabled = request.audioEnabled ?? true;
    call.localVideoEnabled = request.videoEnabled ?? (call.type === "video");
    
    // The peer connection should already be set up from the incoming offer
    // Update call state when connection is established
    
    return true;
  } catch (error) {
    logger.error("Failed to answer call:", error);
    return false;
  }
}

async function endCall(callId: string): Promise<void> {
  const call = activeCalls.get(callId);
  if (!call) return;
  
  call.state = "ended";
  call.endedAt = new Date().toISOString();
  call.endReason = "completed";
  call.duration = Math.floor(
    (new Date().getTime() - new Date(call.startedAt).getTime()) / 1000
  );
  
  // Close associated connections
  for (const participant of call.participants) {
    if (participant.walletAddress !== localWalletAddress) {
      const connectionEntry = Array.from(peerConnections.entries())
        .find(([, conn]) => conn.info.remoteWalletAddress === participant.walletAddress);
      
      if (connectionEntry) {
        await closeConnection(connectionEntry[0]);
      }
    }
  }
  
  emitWebRTCEvent({
    type: "call:ended",
    callId,
    reason: call.endReason,
  });
  
  // Archive call
  const callPath = path.join(getCallsDir(), `${callId}.json`);
  await fs.writeJson(callPath, call, { spaces: 2 });
  
  activeCalls.delete(callId);
  
  logger.info("Call ended", { callId, duration: call.duration });
}

// ============================================================================
// Service Status
// ============================================================================

function getServiceStatus(): WebRTCServiceStatus {
  let totalBytesSent = 0;
  let totalBytesReceived = 0;
  
  for (const [, conn] of peerConnections) {
    totalBytesSent += conn.info.bytesSent;
    totalBytesReceived += conn.info.bytesReceived;
  }
  
  // Get first active call or null
  const firstCall = activeCalls.values().next();
  const activeCall: CallInfo | null = firstCall.done ? null : firstCall.value;
  
  return {
    initialized,
    localPeerId,
    iceServers: Array.from(communityIceServers.values()),
    connectedIceServers: communityIceServers.size,
    activeConnections: peerConnections.size,
    pendingConnections: 0,
    activeCall,
    natType: detectedNATType,
    publicIp: publicIP,
    totalBytesSent,
    totalBytesReceived,
    totalCallsCompleted: 0, // Would track from archived calls
  };
}

// ============================================================================
// Event Emission
// ============================================================================

function emitWebRTCEvent(event: WebRTCEvent): void {
  const windows = BrowserWindow.getAllWindows();
  for (const win of windows) {
    win.webContents.send("webrtc:event", event);
  }
}

// ============================================================================
// Register IPC Handlers
// ============================================================================

export function registerWebRTCHandlers(): void {
  initWebRTCDirs().catch(err => logger.warn("Failed to init WebRTC dirs:", err));
  
  // Initialization
  ipcMain.handle("webrtc:init", async (_, request: InitWebRTCRequest) => {
    return initializeWebRTC(request);
  });
  
  ipcMain.handle("webrtc:status", async () => {
    return getServiceStatus();
  });
  
  // ICE servers
  ipcMain.handle("webrtc:ice:list", async () => {
    return Array.from(communityIceServers.values());
  });
  
  ipcMain.handle("webrtc:ice:register", async (_, request: RegisterIceServerRequest) => {
    return registerAsIceServer(request);
  });
  
  // Peer connections
  ipcMain.handle("webrtc:peer:connect", async (_, request: ConnectPeerRequest) => {
    return connectToPeer(request);
  });
  
  ipcMain.handle("webrtc:peer:disconnect", async (_, connectionId: string) => {
    await closeConnection(connectionId);
    return true;
  });
  
  ipcMain.handle("webrtc:peer:list", async () => {
    return Array.from(peerConnections.values()).map(c => c.info);
  });
  
  // Data channels
  ipcMain.handle("webrtc:data:send", async (_, request: SendDataRequest) => {
    return sendData(request);
  });
  
  // Signaling
  ipcMain.handle("webrtc:signaling:receive", async (_, message: SignalingMessage) => {
    await handleSignalingMessage(message);
    return true;
  });
  
  // Calls
  ipcMain.handle("webrtc:call:start", async (_, request: StartCallRequest) => {
    return startCall(request);
  });
  
  ipcMain.handle("webrtc:call:answer", async (_, request: AnswerCallRequest) => {
    return answerCall(request);
  });
  
  ipcMain.handle("webrtc:call:end", async (_, callId: string) => {
    await endCall(callId);
    return true;
  });
  
  ipcMain.handle("webrtc:call:mute", async (_, callId: string, muted: boolean) => {
    const call = activeCalls.get(callId);
    if (call) {
      call.localAudioEnabled = !muted;
      return true;
    }
    return false;
  });
  
  ipcMain.handle("webrtc:call:video", async (_, callId: string, enabled: boolean) => {
    const call = activeCalls.get(callId);
    if (call) {
      call.localVideoEnabled = enabled;
      return true;
    }
    return false;
  });
  
  logger.info("WebRTC handlers registered");
}
