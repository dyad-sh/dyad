/**
 * WebRTC Client
 * Renderer-side client for decentralized peer-to-peer communication
 */

import type {
  DecentralizedIceServer,
  WebRTCPeerConnection,
  SignalingMessage,
  CallInfo,
  WebRTCEvent,
  WebRTCServiceStatus,
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

type EventCallback = (event: WebRTCEvent) => void;

class WebRTCClient {
  private static instance: WebRTCClient;
  private ipcRenderer: any;
  private eventListeners: Map<string, Set<EventCallback>> = new Map();
  private initialized = false;

  private constructor() {
    this.ipcRenderer = (window as any).electron.ipcRenderer;
    this.setupEventListener();
  }

  static getInstance(): WebRTCClient {
    if (!WebRTCClient.instance) {
      WebRTCClient.instance = new WebRTCClient();
    }
    return WebRTCClient.instance;
  }

  private setupEventListener(): void {
    this.ipcRenderer.on("webrtc:event", (event: WebRTCEvent) => {
      this.notifyListeners(event);
    });
  }

  private notifyListeners(event: WebRTCEvent): void {
    // Notify all listeners
    const allListeners = this.eventListeners.get("*");
    if (allListeners) {
      allListeners.forEach(cb => cb(event));
    }

    // Notify type-specific listeners
    const typeListeners = this.eventListeners.get(event.type);
    if (typeListeners) {
      typeListeners.forEach(cb => cb(event));
    }
  }

  // ============================================================================
  // Event Subscription
  // ============================================================================

  on(eventType: WebRTCEvent["type"] | "*", callback: EventCallback): () => void {
    if (!this.eventListeners.has(eventType)) {
      this.eventListeners.set(eventType, new Set());
    }
    this.eventListeners.get(eventType)!.add(callback);

    return () => {
      this.eventListeners.get(eventType)?.delete(callback);
    };
  }

  off(eventType: WebRTCEvent["type"] | "*", callback: EventCallback): void {
    this.eventListeners.get(eventType)?.delete(callback);
  }

  // ============================================================================
  // Initialization
  // ============================================================================

  async initialize(request: InitWebRTCRequest): Promise<InitWebRTCResult> {
    const result = await this.ipcRenderer.invoke("webrtc:init", request);
    if (result.success) {
      this.initialized = true;
    }
    return result;
  }

  async getStatus(): Promise<WebRTCServiceStatus> {
    return this.ipcRenderer.invoke("webrtc:status");
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  // ============================================================================
  // ICE Server Management
  // ============================================================================

  async listIceServers(): Promise<DecentralizedIceServer[]> {
    return this.ipcRenderer.invoke("webrtc:ice:list");
  }

  async registerAsIceServer(request: RegisterIceServerRequest): Promise<RegisterIceServerResult> {
    return this.ipcRenderer.invoke("webrtc:ice:register", request);
  }

  // ============================================================================
  // Peer Connections
  // ============================================================================

  async connectToPeer(request: ConnectPeerRequest): Promise<ConnectPeerResult> {
    return this.ipcRenderer.invoke("webrtc:peer:connect", request);
  }

  async disconnectPeer(connectionId: string): Promise<boolean> {
    return this.ipcRenderer.invoke("webrtc:peer:disconnect", connectionId);
  }

  async listConnections(): Promise<WebRTCPeerConnection[]> {
    return this.ipcRenderer.invoke("webrtc:peer:list");
  }

  // ============================================================================
  // Data Channels
  // ============================================================================

  async sendData(request: SendDataRequest): Promise<boolean> {
    return this.ipcRenderer.invoke("webrtc:data:send", request);
  }

  async sendToWallet(walletAddress: string, data: any, channelLabel?: string): Promise<boolean> {
    return this.sendData({ walletAddress, data, channelLabel });
  }

  // ============================================================================
  // Signaling
  // ============================================================================

  async handleSignalingMessage(message: SignalingMessage): Promise<boolean> {
    return this.ipcRenderer.invoke("webrtc:signaling:receive", message);
  }

  // ============================================================================
  // Voice/Video Calls
  // ============================================================================

  async startAudioCall(walletAddress: string, conversationId: string): Promise<StartCallResult> {
    return this.ipcRenderer.invoke("webrtc:call:start", {
      walletAddress,
      conversationId,
      type: "audio",
      audioEnabled: true,
      videoEnabled: false,
    } as StartCallRequest);
  }

  async startVideoCall(walletAddress: string, conversationId: string): Promise<StartCallResult> {
    return this.ipcRenderer.invoke("webrtc:call:start", {
      walletAddress,
      conversationId,
      type: "video",
      audioEnabled: true,
      videoEnabled: true,
    } as StartCallRequest);
  }

  async answerCall(callId: string, options?: { audioEnabled?: boolean; videoEnabled?: boolean }): Promise<boolean> {
    return this.ipcRenderer.invoke("webrtc:call:answer", {
      callId,
      ...options,
    } as AnswerCallRequest);
  }

  async endCall(callId: string): Promise<boolean> {
    return this.ipcRenderer.invoke("webrtc:call:end", callId);
  }

  async muteCall(callId: string, muted: boolean): Promise<boolean> {
    return this.ipcRenderer.invoke("webrtc:call:mute", callId, muted);
  }

  async toggleVideo(callId: string, enabled: boolean): Promise<boolean> {
    return this.ipcRenderer.invoke("webrtc:call:video", callId, enabled);
  }
}

export const webRTCClient = WebRTCClient.getInstance();
export default webRTCClient;
