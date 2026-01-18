/**
 * Decentralized WebRTC Types
 * Peer-to-peer communication without centralized STUN/TURN servers
 */

// ============================================================================
// ICE Server Configuration
// ============================================================================

/**
 * ICE server configuration for STUN/TURN
 */
export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
  credentialType?: "password" | "oauth";
}

/**
 * Decentralized ICE server node
 */
export interface DecentralizedIceServer {
  id: string;
  peerId: string;                     // libp2p peer ID
  type: "stun" | "turn" | "both";
  urls: string[];
  region?: string;
  latencyMs?: number;
  load?: number;                      // 0-100 load percentage
  maxConnections?: number;
  currentConnections?: number;
  publicKey: string;                  // For credential verification
  lastSeen: string;
  registeredAt: string;
  reputation: number;                 // 0-100 trust score
}

/**
 * ICE candidate from peer discovery
 */
export interface IceCandidate {
  candidate: string;
  sdpMid: string | null;
  sdpMLineIndex: number | null;
  usernameFragment?: string;
}

// ============================================================================
// WebRTC Connection Types
// ============================================================================

/**
 * WebRTC peer connection state
 */
export type WebRTCConnectionState = 
  | "new"
  | "connecting"
  | "connected"
  | "disconnected"
  | "failed"
  | "closed";

/**
 * WebRTC signaling state
 */
export type WebRTCSignalingState =
  | "stable"
  | "have-local-offer"
  | "have-remote-offer"
  | "have-local-pranswer"
  | "have-remote-pranswer"
  | "closed";

/**
 * WebRTC peer connection info
 */
export interface WebRTCPeerConnection {
  id: string;
  localPeerId: string;
  remotePeerId: string;
  remoteWalletAddress: string;
  connectionState: WebRTCConnectionState;
  signalingState: WebRTCSignalingState;
  iceConnectionState: string;
  iceGatheringState: string;
  
  // Data channels
  dataChannels: DataChannelInfo[];
  
  // Media streams (for voice/video)
  localStreams: MediaStreamInfo[];
  remoteStreams: MediaStreamInfo[];
  
  // Stats
  bytesReceived: number;
  bytesSent: number;
  packetsReceived: number;
  packetsSent: number;
  roundTripTime?: number;
  
  // Connection quality
  quality: ConnectionQuality;
  
  // Timestamps
  createdAt: string;
  connectedAt?: string;
  lastActivityAt: string;
}

/**
 * Data channel information
 */
export interface DataChannelInfo {
  id: number;
  label: string;
  protocol: string;
  state: "connecting" | "open" | "closing" | "closed";
  ordered: boolean;
  maxRetransmits?: number;
  maxPacketLifeTime?: number;
  bufferedAmount: number;
}

/**
 * Media stream information
 */
export interface MediaStreamInfo {
  id: string;
  active: boolean;
  audioTracks: MediaTrackInfo[];
  videoTracks: MediaTrackInfo[];
}

/**
 * Media track information
 */
export interface MediaTrackInfo {
  id: string;
  kind: "audio" | "video";
  label: string;
  enabled: boolean;
  muted: boolean;
  readyState: "live" | "ended";
}

/**
 * Connection quality metrics
 */
export interface ConnectionQuality {
  score: number;                      // 0-100
  rating: "excellent" | "good" | "fair" | "poor" | "bad";
  latencyMs: number;
  jitterMs: number;
  packetLossPercent: number;
  bandwidthKbps: number;
}

// ============================================================================
// Signaling Types
// ============================================================================

/**
 * WebRTC signaling message types
 */
export type SignalingMessageType =
  | "offer"
  | "answer"
  | "ice-candidate"
  | "ice-candidate-batch"
  | "renegotiate"
  | "hangup"
  | "ping"
  | "pong";

/**
 * Signaling message for WebRTC negotiation
 */
export interface SignalingMessage {
  id: string;
  type: SignalingMessageType;
  from: string;                       // Sender peer ID
  fromWallet: string;                 // Sender wallet address
  to: string;                         // Recipient peer ID
  toWallet: string;                   // Recipient wallet address
  
  // SDP offer/answer
  sdp?: string;
  sdpType?: "offer" | "answer" | "pranswer" | "rollback";
  
  // ICE candidates
  candidate?: IceCandidate;
  candidates?: IceCandidate[];
  
  // Metadata
  conversationId?: string;
  callType?: "audio" | "video" | "data";
  
  // Security
  signature: string;
  timestamp: string;
  nonce: string;
}

// ============================================================================
// Call Types (Voice/Video)
// ============================================================================

/**
 * Call state
 */
export type CallState =
  | "idle"
  | "ringing"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "on-hold"
  | "ended";

/**
 * Call information
 */
export interface CallInfo {
  id: string;
  conversationId: string;
  type: "audio" | "video";
  direction: "incoming" | "outgoing";
  state: CallState;
  
  // Participants
  initiator: string;                  // Wallet address
  participants: CallParticipant[];
  
  // Media state
  localAudioEnabled: boolean;
  localVideoEnabled: boolean;
  screenShareEnabled: boolean;
  
  // Quality
  quality: ConnectionQuality;
  
  // Timestamps
  startedAt: string;
  connectedAt?: string;
  endedAt?: string;
  duration?: number;                  // In seconds
  
  // Reason for ending
  endReason?: CallEndReason;
}

/**
 * Call participant
 */
export interface CallParticipant {
  walletAddress: string;
  peerId: string;
  displayName?: string;
  avatar?: string;
  
  // Connection
  connectionState: WebRTCConnectionState;
  
  // Media state
  audioEnabled: boolean;
  videoEnabled: boolean;
  screenSharing: boolean;
  
  // Speaking indicator
  isSpeaking: boolean;
  audioLevel: number;                 // 0-1
  
  joinedAt: string;
}

export type CallEndReason =
  | "completed"
  | "declined"
  | "busy"
  | "no-answer"
  | "cancelled"
  | "failed"
  | "network-error"
  | "timeout";

// ============================================================================
// WebRTC Events
// ============================================================================

/**
 * WebRTC event types
 */
export type WebRTCEventType =
  | "ice-server:discovered"
  | "ice-server:connected"
  | "ice-server:disconnected"
  | "peer:connecting"
  | "peer:connected"
  | "peer:disconnected"
  | "peer:failed"
  | "signaling:received"
  | "signaling:sent"
  | "datachannel:open"
  | "datachannel:message"
  | "datachannel:close"
  | "call:incoming"
  | "call:outgoing"
  | "call:connected"
  | "call:ended"
  | "call:participant-joined"
  | "call:participant-left"
  | "media:local-stream"
  | "media:remote-stream"
  | "quality:changed";

/**
 * WebRTC event
 */
export type WebRTCEvent =
  | { type: "ice-server:discovered"; server: DecentralizedIceServer }
  | { type: "ice-server:connected"; serverId: string }
  | { type: "ice-server:disconnected"; serverId: string }
  | { type: "peer:connecting"; peerId: string; walletAddress: string }
  | { type: "peer:connected"; connection: WebRTCPeerConnection }
  | { type: "peer:disconnected"; peerId: string; reason?: string }
  | { type: "peer:failed"; peerId: string; error: string }
  | { type: "signaling:received"; message: SignalingMessage }
  | { type: "signaling:sent"; message: SignalingMessage }
  | { type: "datachannel:open"; peerId: string; channel: DataChannelInfo }
  | { type: "datachannel:message"; peerId: string; channelLabel: string; data: any }
  | { type: "datachannel:close"; peerId: string; channelLabel: string }
  | { type: "call:incoming"; call: CallInfo }
  | { type: "call:outgoing"; call: CallInfo }
  | { type: "call:connected"; callId: string }
  | { type: "call:ended"; callId: string; reason: CallEndReason }
  | { type: "call:participant-joined"; callId: string; participant: CallParticipant }
  | { type: "call:participant-left"; callId: string; walletAddress: string }
  | { type: "media:local-stream"; stream: MediaStreamInfo }
  | { type: "media:remote-stream"; peerId: string; stream: MediaStreamInfo }
  | { type: "quality:changed"; peerId: string; quality: ConnectionQuality };

// ============================================================================
// Service Status
// ============================================================================

/**
 * WebRTC service status
 */
export interface WebRTCServiceStatus {
  initialized: boolean;
  localPeerId: string | null;
  
  // ICE servers
  iceServers: DecentralizedIceServer[];
  connectedIceServers: number;
  
  // Connections
  activeConnections: number;
  pendingConnections: number;
  
  // Calls
  activeCall: CallInfo | null;
  
  // Network
  natType: NATType | null;
  publicIp: string | null;
  
  // Stats
  totalBytesSent: number;
  totalBytesReceived: number;
  totalCallsCompleted: number;
}

export type NATType = 
  | "open"
  | "full-cone"
  | "restricted-cone"
  | "port-restricted-cone"
  | "symmetric"
  | "unknown";

// ============================================================================
// Requests & Responses
// ============================================================================

export interface InitWebRTCRequest {
  walletAddress: string;
  useDecentralizedIce?: boolean;
  fallbackServers?: IceServer[];
}

export interface InitWebRTCResult {
  success: boolean;
  peerId?: string;
  error?: string;
}

export interface ConnectPeerRequest {
  walletAddress: string;
  conversationId?: string;
  createDataChannel?: boolean;
  channelLabel?: string;
}

export interface ConnectPeerResult {
  success: boolean;
  connectionId?: string;
  error?: string;
}

export interface StartCallRequest {
  walletAddress: string;
  conversationId: string;
  type: "audio" | "video";
  audioEnabled?: boolean;
  videoEnabled?: boolean;
}

export interface StartCallResult {
  success: boolean;
  callId?: string;
  error?: string;
}

export interface AnswerCallRequest {
  callId: string;
  audioEnabled?: boolean;
  videoEnabled?: boolean;
}

export interface SendDataRequest {
  walletAddress: string;
  channelLabel?: string;
  data: any;
}

export interface RegisterIceServerRequest {
  type: "stun" | "turn" | "both";
  port: number;
  publicIp?: string;
  region?: string;
  maxConnections?: number;
}

export interface RegisterIceServerResult {
  success: boolean;
  serverId?: string;
  urls?: string[];
  error?: string;
}

// ============================================================================
// WebRTC Signal Type (alias for SignalingMessage)
// ============================================================================

/**
 * WebRTC signaling signal (alias)
 */
export type WebRTCSignal = SignalingMessage;

// ============================================================================
// WebRTC Stats
// ============================================================================

/**
 * WebRTC connection statistics
 */
export interface WebRTCStats {
  timestamp: number;
  
  // Connection stats
  connectionState: WebRTCConnectionState;
  roundTripTime: number;
  jitter: number;
  packetLoss: number;
  
  // Audio stats
  audioBytesSent: number;
  audioBytesReceived: number;
  audioPacketsSent: number;
  audioPacketsReceived: number;
  audioLevel: number;
  
  // Video stats
  videoBytesSent: number;
  videoBytesReceived: number;
  videoPacketsSent: number;
  videoPacketsReceived: number;
  frameWidth: number;
  frameHeight: number;
  framesPerSecond: number;
  framesDropped: number;
  
  // Bandwidth
  availableOutgoingBitrate: number;
  availableIncomingBitrate: number;
}

// ============================================================================
// Media Device Info
// ============================================================================

/**
 * Media device information
 */
export interface MediaDeviceInfo {
  deviceId: string;
  kind: "audioinput" | "audiooutput" | "videoinput";
  label: string;
  groupId: string;
}
