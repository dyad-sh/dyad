/**
 * useWebRTC - React hook for decentralized WebRTC communication
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  DecentralizedIceServer,
  WebRTCPeerConnection,
  CallInfo,
  WebRTCEvent,
  WebRTCServiceStatus,
  InitWebRTCRequest,
  RegisterIceServerRequest,
} from "@/types/webrtc_types";
import webRTCClient from "@/ipc/webrtc_client";

// Query keys
const WEBRTC_QUERY_KEYS = {
  status: ["webrtc", "status"] as const,
  connections: ["webrtc", "connections"] as const,
  iceServers: ["webrtc", "iceServers"] as const,
};

/**
 * Hook for WebRTC service status
 */
export function useWebRTCStatus() {
  return useQuery({
    queryKey: WEBRTC_QUERY_KEYS.status,
    queryFn: () => webRTCClient.getStatus(),
    refetchInterval: 5000,
    staleTime: 2000,
  });
}

/**
 * Hook for WebRTC initialization
 */
export function useInitWebRTC() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (request: InitWebRTCRequest) => webRTCClient.initialize(request),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: WEBRTC_QUERY_KEYS.status });
    },
  });
}

/**
 * Hook for listing ICE servers
 */
export function useIceServers() {
  return useQuery({
    queryKey: WEBRTC_QUERY_KEYS.iceServers,
    queryFn: () => webRTCClient.listIceServers(),
    staleTime: 30000,
  });
}

/**
 * Hook for registering as ICE server
 */
export function useRegisterAsIceServer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: RegisterIceServerRequest) =>
      webRTCClient.registerAsIceServer(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: WEBRTC_QUERY_KEYS.iceServers });
    },
  });
}

/**
 * Hook for listing peer connections
 */
export function usePeerConnections() {
  return useQuery({
    queryKey: WEBRTC_QUERY_KEYS.connections,
    queryFn: () => webRTCClient.listConnections(),
    refetchInterval: 3000,
  });
}

/**
 * Hook for connecting to a peer
 */
export function useConnectToPeer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: { walletAddress: string; offerSdp?: string }) =>
      webRTCClient.connectToPeer(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: WEBRTC_QUERY_KEYS.connections });
    },
  });
}

/**
 * Hook for disconnecting from a peer
 */
export function useDisconnectPeer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (connectionId: string) => webRTCClient.disconnectPeer(connectionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: WEBRTC_QUERY_KEYS.connections });
    },
  });
}

/**
 * Hook for sending data to a wallet
 */
export function useSendData() {
  return useMutation({
    mutationFn: (params: { walletAddress: string; data: any; channelLabel?: string }) =>
      webRTCClient.sendToWallet(params.walletAddress, params.data, params.channelLabel),
  });
}

/**
 * Hook for starting an audio call
 */
export function useStartAudioCall() {
  return useMutation({
    mutationFn: (params: { walletAddress: string; conversationId: string }) =>
      webRTCClient.startAudioCall(params.walletAddress, params.conversationId),
  });
}

/**
 * Hook for starting a video call
 */
export function useStartVideoCall() {
  return useMutation({
    mutationFn: (params: { walletAddress: string; conversationId: string }) =>
      webRTCClient.startVideoCall(params.walletAddress, params.conversationId),
  });
}

/**
 * Hook for answering a call
 */
export function useAnswerCall() {
  return useMutation({
    mutationFn: (params: { callId: string; audioEnabled?: boolean; videoEnabled?: boolean }) =>
      webRTCClient.answerCall(params.callId, params),
  });
}

/**
 * Hook for ending a call
 */
export function useEndCall() {
  return useMutation({
    mutationFn: (callId: string) => webRTCClient.endCall(callId),
  });
}

/**
 * Hook for muting/unmuting a call
 */
export function useMuteCall() {
  return useMutation({
    mutationFn: (params: { callId: string; muted: boolean }) =>
      webRTCClient.muteCall(params.callId, params.muted),
  });
}

/**
 * Hook for toggling video in a call
 */
export function useToggleVideo() {
  return useMutation({
    mutationFn: (params: { callId: string; enabled: boolean }) =>
      webRTCClient.toggleVideo(params.callId, params.enabled),
  });
}

/**
 * Comprehensive WebRTC hook for managing real-time communication
 */
export function useWebRTC(walletAddress?: string) {
  const [isInitialized, setIsInitialized] = useState(false);
  const [incomingCall, setIncomingCall] = useState<CallInfo | null>(null);
  const [activeCall, setActiveCall] = useState<CallInfo | null>(null);
  const [receivedMessages, setReceivedMessages] = useState<{ from: string; data: any; timestamp: number }[]>([]);
  const [connectionState, setConnectionState] = useState<string>("disconnected");
  const eventUnsubRef = useRef<(() => void) | null>(null);

  const initMutation = useInitWebRTC();
  const { data: status } = useWebRTCStatus();
  const { data: connections } = usePeerConnections();
  const connectMutation = useConnectToPeer();
  const disconnectMutation = useDisconnectPeer();
  const sendDataMutation = useSendData();
  const startAudioMutation = useStartAudioCall();
  const startVideoMutation = useStartVideoCall();
  const answerMutation = useAnswerCall();
  const endMutation = useEndCall();
  const muteMutation = useMuteCall();
  const videoMutation = useToggleVideo();

  // Handle WebRTC events
  useEffect(() => {
    const handleEvent = (event: WebRTCEvent) => {
      switch (event.type) {
        case "peer:connected":
          setConnectionState("connected");
          break;
        case "peer:disconnected":
          setConnectionState("disconnected");
          break;
        case "peer:connecting":
          setConnectionState("connecting");
          break;
        case "peer:failed":
          setConnectionState("failed");
          break;
        case "call:incoming":
          setIncomingCall(event.call);
          break;
        case "call:outgoing":
          setActiveCall(event.call);
          break;
        case "call:connected":
          // Keep existing call info, just update that it's connected
          break;
        case "call:ended":
          setActiveCall(null);
          setIncomingCall(null);
          break;
        case "datachannel:message":
          setReceivedMessages(prev => [...prev, {
            from: event.peerId,
            data: event.data,
            timestamp: Date.now(),
          }]);
          break;
      }
    };

    eventUnsubRef.current = webRTCClient.on("*", handleEvent);

    return () => {
      eventUnsubRef.current?.();
    };
  }, []);

  // Initialize WebRTC when wallet is available
  const initialize = useCallback(async () => {
    if (!walletAddress) return;

    try {
      const result = await initMutation.mutateAsync({
        walletAddress,
        useDecentralizedIce: true,
      });
      setIsInitialized(result.success);
    } catch (error) {
      console.error("Failed to initialize WebRTC:", error);
    }
  }, [walletAddress, initMutation]);

  // Connect to a peer
  const connect = useCallback(async (peerWallet: string) => {
    return connectMutation.mutateAsync({ walletAddress: peerWallet });
  }, [connectMutation]);

  // Disconnect from a peer
  const disconnect = useCallback(async (connectionId: string) => {
    return disconnectMutation.mutateAsync(connectionId);
  }, [disconnectMutation]);

  // Send data to a peer
  const sendData = useCallback(async (peerWallet: string, data: any) => {
    return sendDataMutation.mutateAsync({ walletAddress: peerWallet, data });
  }, [sendDataMutation]);

  // Start audio call
  const startAudioCall = useCallback(async (peerWallet: string, conversationId: string) => {
    return startAudioMutation.mutateAsync({ walletAddress: peerWallet, conversationId });
  }, [startAudioMutation]);

  // Start video call
  const startVideoCall = useCallback(async (peerWallet: string, conversationId: string) => {
    return startVideoMutation.mutateAsync({ walletAddress: peerWallet, conversationId });
  }, [startVideoMutation]);

  // Answer incoming call
  const answerCall = useCallback(async (audioEnabled = true, videoEnabled = false) => {
    if (!incomingCall) return;
    return answerMutation.mutateAsync({
      callId: incomingCall.id,
      audioEnabled,
      videoEnabled,
    });
  }, [incomingCall, answerMutation]);

  // End current call
  const endCall = useCallback(async () => {
    const callId = activeCall?.id || incomingCall?.id;
    if (!callId) return;
    return endMutation.mutateAsync(callId);
  }, [activeCall, incomingCall, endMutation]);

  // Toggle mute
  const toggleMute = useCallback(async (muted: boolean) => {
    if (!activeCall) return;
    return muteMutation.mutateAsync({ callId: activeCall.id, muted });
  }, [activeCall, muteMutation]);

  // Toggle video
  const toggleVideo = useCallback(async (enabled: boolean) => {
    if (!activeCall) return;
    return videoMutation.mutateAsync({ callId: activeCall.id, enabled });
  }, [activeCall, videoMutation]);

  // Clear received messages
  const clearMessages = useCallback(() => {
    setReceivedMessages([]);
  }, []);

  return {
    // State
    isInitialized,
    status,
    connections: connections || [],
    connectionState,
    incomingCall,
    activeCall,
    receivedMessages,

    // Actions
    initialize,
    connect,
    disconnect,
    sendData,
    startAudioCall,
    startVideoCall,
    answerCall,
    endCall,
    toggleMute,
    toggleVideo,
    clearMessages,

    // Loading states
    isConnecting: connectMutation.isPending,
    isSending: sendDataMutation.isPending,
    isStartingCall: startAudioMutation.isPending || startVideoMutation.isPending,
  };
}

export default useWebRTC;
