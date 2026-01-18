/**
 * Meeting & Video Call Components
 * World-class decentralized video conferencing with WebRTC
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Video,
  VideoOff,
  Mic,
  MicOff,
  Phone,
  PhoneOff,
  Monitor,
  MonitorOff,
  Users,
  Settings,
  MessageSquare,
  Hand,
  MoreVertical,
  Maximize2,
  Minimize2,
  Grid,
  Layout,
  Volume2,
  VolumeX,
  Circle,
  Square,
  Copy,
  Link,
  Calendar,
  Clock,
  Share2,
  UserPlus,
  Lock,
  Globe,
  Loader2,
  AlertCircle,
  CheckCircle,
  XCircle,
  Sparkles,
  Zap,
  Wifi,
  WifiOff,
  RefreshCw,
  ArrowLeft,
  ChevronDown,
  LayoutGrid,
  Presentation,
  Sidebar,
  PictureInPicture,
} from "lucide-react";
import type {
  Meeting,
  MeetingParticipant,
  MeetingSettings,
  MeetingType,
  MeetingRole,
  CreateMeetingRequest,
  ChatIdentity,
} from "@/types/decentralized_chat_types";

// ============================================================================
// Meeting Controls Bar
// ============================================================================

interface MeetingControlsProps {
  audioEnabled: boolean;
  videoEnabled: boolean;
  screenSharing: boolean;
  handRaised: boolean;
  isRecording: boolean;
  isHost: boolean;
  onToggleAudio: () => void;
  onToggleVideo: () => void;
  onToggleScreenShare: () => void;
  onToggleHand: () => void;
  onToggleRecording: () => void;
  onOpenChat: () => void;
  onOpenParticipants: () => void;
  onOpenSettings: () => void;
  onLeaveMeeting: () => void;
  onEndMeeting: () => void;
  participantCount: number;
  unreadMessages: number;
}

export function MeetingControls({
  audioEnabled,
  videoEnabled,
  screenSharing,
  handRaised,
  isRecording,
  isHost,
  onToggleAudio,
  onToggleVideo,
  onToggleScreenShare,
  onToggleHand,
  onToggleRecording,
  onOpenChat,
  onOpenParticipants,
  onOpenSettings,
  onLeaveMeeting,
  onEndMeeting,
  participantCount,
  unreadMessages,
}: MeetingControlsProps) {
  return (
    <div className="flex items-center justify-center gap-2 p-4 bg-background/95 backdrop-blur border-t">
      {/* Audio toggle */}
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={audioEnabled ? "secondary" : "destructive"}
              size="lg"
              className="rounded-full h-12 w-12"
              onClick={onToggleAudio}
            >
              {audioEnabled ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {audioEnabled ? "Mute microphone" : "Unmute microphone"}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      {/* Video toggle */}
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={videoEnabled ? "secondary" : "destructive"}
              size="lg"
              className="rounded-full h-12 w-12"
              onClick={onToggleVideo}
            >
              {videoEnabled ? <Video className="h-5 w-5" /> : <VideoOff className="h-5 w-5" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {videoEnabled ? "Turn off camera" : "Turn on camera"}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      {/* Screen share */}
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={screenSharing ? "default" : "secondary"}
              size="lg"
              className="rounded-full h-12 w-12"
              onClick={onToggleScreenShare}
            >
              {screenSharing ? <MonitorOff className="h-5 w-5" /> : <Monitor className="h-5 w-5" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {screenSharing ? "Stop sharing" : "Share screen"}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <Separator orientation="vertical" className="h-8 mx-2" />

      {/* Hand raise */}
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={handRaised ? "default" : "ghost"}
              size="icon"
              onClick={onToggleHand}
            >
              <Hand className={cn("h-5 w-5", handRaised && "text-yellow-500")} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {handRaised ? "Lower hand" : "Raise hand"}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      {/* Chat */}
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" onClick={onOpenChat} className="relative">
              <MessageSquare className="h-5 w-5" />
              {unreadMessages > 0 && (
                <Badge className="absolute -top-1 -right-1 h-5 w-5 p-0 flex items-center justify-center text-xs">
                  {unreadMessages > 99 ? "99+" : unreadMessages}
                </Badge>
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>Chat</TooltipContent>
        </Tooltip>
      </TooltipProvider>

      {/* Participants */}
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" onClick={onOpenParticipants}>
              <Users className="h-5 w-5" />
              <span className="ml-1 text-sm">{participantCount}</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>Participants ({participantCount})</TooltipContent>
        </Tooltip>
      </TooltipProvider>

      {/* Recording (host only) */}
      {isHost && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={isRecording ? "destructive" : "ghost"}
                size="icon"
                onClick={onToggleRecording}
              >
                {isRecording ? (
                  <Square className="h-4 w-4 fill-current" />
                ) : (
                  <Circle className="h-5 w-5 text-red-500" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {isRecording ? "Stop recording" : "Start recording"}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}

      {/* Settings */}
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" onClick={onOpenSettings}>
              <Settings className="h-5 w-5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Settings</TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <Separator orientation="vertical" className="h-8 mx-2" />

      {/* Leave/End meeting */}
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="destructive"
              size="lg"
              className="rounded-full px-6"
              onClick={isHost ? onEndMeeting : onLeaveMeeting}
            >
              <PhoneOff className="h-5 w-5 mr-2" />
              {isHost ? "End" : "Leave"}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {isHost ? "End meeting for everyone" : "Leave meeting"}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}

// ============================================================================
// Video Tile Component
// ============================================================================

interface VideoTileProps {
  participant: MeetingParticipant;
  isLocal?: boolean;
  isLarge?: boolean;
  isPinned?: boolean;
  isSpeaking?: boolean;
  videoRef?: React.RefObject<HTMLVideoElement | null>;
  onPin?: () => void;
  onMute?: () => void;
  onKick?: () => void;
  isHost?: boolean;
}

export function VideoTile({
  participant,
  isLocal = false,
  isLarge = false,
  isPinned = false,
  isSpeaking = false,
  videoRef,
  onPin,
  onMute,
  onKick,
  isHost = false,
}: VideoTileProps) {
  const [showControls, setShowControls] = useState(false);

  const getQualityColor = (quality?: string) => {
    switch (quality) {
      case "excellent": return "bg-green-500";
      case "good": return "bg-green-400";
      case "fair": return "bg-yellow-500";
      case "poor": return "bg-red-500";
      default: return "bg-gray-400";
    }
  };

  return (
    <div
      className={cn(
        "relative rounded-xl overflow-hidden bg-muted transition-all",
        isLarge ? "aspect-video" : "aspect-video",
        isPinned && "ring-2 ring-primary",
        isSpeaking && "ring-2 ring-green-500"
      )}
      onMouseEnter={() => setShowControls(true)}
      onMouseLeave={() => setShowControls(false)}
    >
      {/* Video stream or avatar placeholder */}
      {participant.videoEnabled ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={isLocal}
          className="w-full h-full object-cover"
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-muted to-muted/50">
          <Avatar className={cn(isLarge ? "h-24 w-24" : "h-16 w-16")}>
            <AvatarImage src={participant.avatar} />
            <AvatarFallback className="text-2xl">
              {participant.displayName?.slice(0, 2).toUpperCase() || 
               participant.walletAddress.slice(2, 4).toUpperCase()}
            </AvatarFallback>
          </Avatar>
        </div>
      )}

      {/* Overlay controls (visible on hover) */}
      {showControls && !isLocal && (
        <div className="absolute top-2 right-2 flex gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary" size="icon" className="h-7 w-7 bg-black/50 hover:bg-black/70">
                <MoreVertical className="h-4 w-4 text-white" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onPin}>
                {isPinned ? "Unpin" : "Pin"} video
              </DropdownMenuItem>
              {isHost && (
                <>
                  <DropdownMenuItem onClick={onMute}>
                    {participant.audioEnabled ? "Mute" : "Ask to unmute"}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={onKick} className="text-red-500">
                    Remove from meeting
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

      {/* Bottom info bar */}
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-white text-sm font-medium truncate max-w-[150px]">
              {participant.displayName || participant.walletAddress.slice(0, 10) + "..."}
              {isLocal && " (You)"}
            </span>
            {participant.role === "host" && (
              <Badge variant="secondary" className="text-xs">Host</Badge>
            )}
          </div>
          <div className="flex items-center gap-1">
            {/* Connection quality indicator */}
            <div className={cn("h-2 w-2 rounded-full", getQualityColor(participant.connectionQuality))} />
            
            {/* Audio indicator */}
            {!participant.audioEnabled && (
              <MicOff className="h-4 w-4 text-red-400" />
            )}
            
            {/* Hand raised */}
            {participant.handRaised && (
              <Hand className="h-4 w-4 text-yellow-400 animate-pulse" />
            )}
            
            {/* Screen sharing */}
            {participant.screenSharing && (
              <Monitor className="h-4 w-4 text-blue-400" />
            )}
          </div>
        </div>
      </div>

      {/* Speaking indicator glow */}
      {isSpeaking && (
        <div className="absolute inset-0 pointer-events-none rounded-xl ring-2 ring-green-400 animate-pulse" />
      )}
    </div>
  );
}

// ============================================================================
// Meeting Room Component
// ============================================================================

interface MeetingRoomProps {
  meeting: Meeting;
  identity: ChatIdentity;
  participants: MeetingParticipant[];
  localVideoRef: React.RefObject<HTMLVideoElement | null>;
  onLeave: () => void;
  onEnd: () => void;
}

export function MeetingRoom({
  meeting,
  identity,
  participants,
  localVideoRef,
  onLeave,
  onEnd,
}: MeetingRoomProps) {
  const [layout, setLayout] = useState<"gallery" | "speaker" | "sidebar">("gallery");
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [screenSharing, setScreenSharing] = useState(false);
  const [handRaised, setHandRaised] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [showParticipants, setShowParticipants] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [pinnedParticipant, setPinnedParticipant] = useState<string | null>(null);
  const [speakingParticipant, setSpeakingParticipant] = useState<string | null>(null);

  const isHost = meeting.hostWallet === identity.walletAddress;
  const localParticipant = participants.find(p => p.walletAddress === identity.walletAddress);
  const remoteParticipants = participants.filter(p => p.walletAddress !== identity.walletAddress);

  // Grid layout calculation
  const getGridCols = (count: number) => {
    if (count <= 1) return "grid-cols-1";
    if (count <= 2) return "grid-cols-2";
    if (count <= 4) return "grid-cols-2";
    if (count <= 6) return "grid-cols-3";
    if (count <= 9) return "grid-cols-3";
    return "grid-cols-4";
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/30">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={onLeave}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h2 className="font-semibold">{meeting.title}</h2>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {meeting.status === "live" && (
                <Badge variant="destructive" className="animate-pulse">
                  <Circle className="h-2 w-2 fill-current mr-1" />
                  LIVE
                </Badge>
              )}
              <span>{participants.length} participants</span>
              {meeting.isRecording && (
                <span className="text-red-500 flex items-center gap-1">
                  <Circle className="h-2 w-2 fill-current animate-pulse" />
                  Recording
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Layout switcher */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon">
                <LayoutGrid className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Layout</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setLayout("gallery")}>
                <Grid className="h-4 w-4 mr-2" />
                Gallery
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setLayout("speaker")}>
                <Presentation className="h-4 w-4 mr-2" />
                Speaker
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setLayout("sidebar")}>
                <Sidebar className="h-4 w-4 mr-2" />
                Sidebar
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Fullscreen */}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" onClick={toggleFullscreen}>
                  {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>

      {/* Main content area */}
      <div className="flex-1 flex min-h-0">
        {/* Video grid */}
        <div className={cn(
          "flex-1 p-4 overflow-auto",
          showChat && "pr-0",
          showParticipants && "pr-0"
        )}>
          {layout === "gallery" && (
            <div className={cn(
              "grid gap-4 h-full auto-rows-fr",
              getGridCols(participants.length)
            )}>
              {/* Local video */}
              {localParticipant && (
                <VideoTile
                  participant={{
                    ...localParticipant,
                    audioEnabled,
                    videoEnabled,
                    handRaised,
                    screenSharing,
                  }}
                  isLocal
                  videoRef={localVideoRef}
                  isPinned={pinnedParticipant === localParticipant.walletAddress}
                  isSpeaking={speakingParticipant === localParticipant.walletAddress}
                />
              )}
              
              {/* Remote videos */}
              {remoteParticipants.map((participant) => (
                <VideoTile
                  key={participant.walletAddress}
                  participant={participant}
                  isPinned={pinnedParticipant === participant.walletAddress}
                  isSpeaking={speakingParticipant === participant.walletAddress}
                  onPin={() => setPinnedParticipant(
                    pinnedParticipant === participant.walletAddress ? null : participant.walletAddress
                  )}
                  isHost={isHost}
                />
              ))}
            </div>
          )}

          {layout === "speaker" && (
            <div className="h-full flex flex-col gap-4">
              {/* Main speaker (pinned or active speaker) */}
              <div className="flex-1">
                <VideoTile
                  participant={
                    participants.find(p => p.walletAddress === (pinnedParticipant || speakingParticipant)) ||
                    participants[0]
                  }
                  isLarge
                  isPinned
                  isSpeaking={speakingParticipant === (pinnedParticipant || speakingParticipant)}
                  isLocal={
                    (pinnedParticipant || speakingParticipant) === identity.walletAddress
                  }
                  videoRef={
                    (pinnedParticipant || speakingParticipant) === identity.walletAddress
                      ? localVideoRef
                      : undefined
                  }
                />
              </div>
              
              {/* Filmstrip of other participants */}
              <div className="h-32 flex gap-2 overflow-x-auto pb-2">
                {participants
                  .filter(p => p.walletAddress !== (pinnedParticipant || speakingParticipant))
                  .map((participant) => (
                    <div key={participant.walletAddress} className="w-48 flex-shrink-0">
                      <VideoTile
                        participant={participant}
                        isLocal={participant.walletAddress === identity.walletAddress}
                        videoRef={participant.walletAddress === identity.walletAddress ? localVideoRef : undefined}
                        onPin={() => setPinnedParticipant(participant.walletAddress)}
                      />
                    </div>
                  ))}
              </div>
            </div>
          )}

          {layout === "sidebar" && (
            <div className="h-full flex gap-4">
              {/* Main content (screen share or speaker) */}
              <div className="flex-1">
                <VideoTile
                  participant={
                    participants.find(p => p.screenSharing) ||
                    participants.find(p => p.walletAddress === pinnedParticipant) ||
                    participants[0]
                  }
                  isLarge
                  isLocal={
                    (participants.find(p => p.screenSharing)?.walletAddress || pinnedParticipant) === identity.walletAddress
                  }
                  videoRef={
                    (participants.find(p => p.screenSharing)?.walletAddress || pinnedParticipant) === identity.walletAddress
                      ? localVideoRef
                      : undefined
                  }
                />
              </div>
              
              {/* Sidebar with participants */}
              <div className="w-64 flex flex-col gap-2 overflow-y-auto">
                {participants.map((participant) => (
                  <VideoTile
                    key={participant.walletAddress}
                    participant={participant}
                    isLocal={participant.walletAddress === identity.walletAddress}
                    videoRef={participant.walletAddress === identity.walletAddress ? localVideoRef : undefined}
                    isPinned={pinnedParticipant === participant.walletAddress}
                    isSpeaking={speakingParticipant === participant.walletAddress}
                    onPin={() => setPinnedParticipant(
                      pinnedParticipant === participant.walletAddress ? null : participant.walletAddress
                    )}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Chat sidebar */}
        {showChat && (
          <div className="w-80 border-l flex flex-col">
            <div className="p-3 border-b flex items-center justify-between">
              <h3 className="font-medium">Meeting Chat</h3>
              <Button variant="ghost" size="icon" onClick={() => setShowChat(false)}>
                <XCircle className="h-4 w-4" />
              </Button>
            </div>
            <ScrollArea className="flex-1 p-3">
              <p className="text-center text-muted-foreground text-sm">
                Chat messages will appear here
              </p>
            </ScrollArea>
            <div className="p-3 border-t">
              <div className="flex gap-2">
                <Input placeholder="Type a message..." />
                <Button size="icon">
                  <MessageSquare className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Participants sidebar */}
        {showParticipants && (
          <div className="w-80 border-l flex flex-col">
            <div className="p-3 border-b flex items-center justify-between">
              <h3 className="font-medium">Participants ({participants.length})</h3>
              <Button variant="ghost" size="icon" onClick={() => setShowParticipants(false)}>
                <XCircle className="h-4 w-4" />
              </Button>
            </div>
            <ScrollArea className="flex-1">
              <div className="p-3 space-y-2">
                {participants.map((participant) => (
                  <div
                    key={participant.walletAddress}
                    className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50"
                  >
                    <Avatar className="h-10 w-10">
                      <AvatarImage src={participant.avatar} />
                      <AvatarFallback>
                        {participant.displayName?.slice(0, 2).toUpperCase() ||
                         participant.walletAddress.slice(2, 4).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">
                        {participant.displayName || participant.walletAddress.slice(0, 10) + "..."}
                        {participant.walletAddress === identity.walletAddress && " (You)"}
                      </p>
                      <div className="flex items-center gap-1">
                        {participant.role === "host" && (
                          <Badge variant="secondary" className="text-xs">Host</Badge>
                        )}
                        {participant.role === "co-host" && (
                          <Badge variant="outline" className="text-xs">Co-host</Badge>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      {!participant.audioEnabled && <MicOff className="h-4 w-4 text-muted-foreground" />}
                      {!participant.videoEnabled && <VideoOff className="h-4 w-4 text-muted-foreground" />}
                      {participant.handRaised && <Hand className="h-4 w-4 text-yellow-500" />}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
            {isHost && (
              <div className="p-3 border-t">
                <Button variant="outline" className="w-full">
                  <UserPlus className="h-4 w-4 mr-2" />
                  Invite participants
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Controls bar */}
      <MeetingControls
        audioEnabled={audioEnabled}
        videoEnabled={videoEnabled}
        screenSharing={screenSharing}
        handRaised={handRaised}
        isRecording={isRecording}
        isHost={isHost}
        onToggleAudio={() => setAudioEnabled(!audioEnabled)}
        onToggleVideo={() => setVideoEnabled(!videoEnabled)}
        onToggleScreenShare={() => setScreenSharing(!screenSharing)}
        onToggleHand={() => setHandRaised(!handRaised)}
        onToggleRecording={() => setIsRecording(!isRecording)}
        onOpenChat={() => {
          setShowChat(!showChat);
          setShowParticipants(false);
        }}
        onOpenParticipants={() => {
          setShowParticipants(!showParticipants);
          setShowChat(false);
        }}
        onOpenSettings={() => setShowSettings(true)}
        onLeaveMeeting={onLeave}
        onEndMeeting={onEnd}
        participantCount={participants.length}
        unreadMessages={0}
      />

      {/* Settings dialog */}
      <Dialog open={showSettings} onOpenChange={setShowSettings}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Meeting Settings</DialogTitle>
          </DialogHeader>
          <MeetingSettingsPanel
            meeting={meeting}
            isHost={isHost}
            onClose={() => setShowSettings(false)}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ============================================================================
// Create Meeting Dialog
// ============================================================================

interface CreateMeetingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversationId?: string;
  onMeetingCreated?: (meeting: Meeting) => void;
}

export function CreateMeetingDialog({
  open,
  onOpenChange,
  conversationId,
  onMeetingCreated,
}: CreateMeetingDialogProps) {
  const [meetingType, setMeetingType] = useState<MeetingType>("instant");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [scheduledDate, setScheduledDate] = useState("");
  const [scheduledTime, setScheduledTime] = useState("");
  const [duration, setDuration] = useState(30);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Settings
  const [enableWaitingRoom, setEnableWaitingRoom] = useState(false);
  const [requirePassword, setRequirePassword] = useState(false);
  const [password, setPassword] = useState("");
  const [allowRecording, setAllowRecording] = useState(true);
  const [muteOnEntry, setMuteOnEntry] = useState(true);

  const handleCreate = async () => {
    if (!title.trim()) {
      setError("Meeting title is required");
      return;
    }

    setIsCreating(true);
    setError(null);

    try {
      // Create meeting via IPC
      // const result = await createMeeting({ ... });
      // onMeetingCreated?.(result.meeting);
      onOpenChange(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Video className="h-5 w-5" />
            Create Meeting
          </DialogTitle>
          <DialogDescription>
            Start an instant meeting or schedule one for later.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={meetingType} onValueChange={(v) => setMeetingType(v as MeetingType)}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="instant">
              <Zap className="h-4 w-4 mr-2" />
              Start Now
            </TabsTrigger>
            <TabsTrigger value="scheduled">
              <Calendar className="h-4 w-4 mr-2" />
              Schedule
            </TabsTrigger>
          </TabsList>

          <TabsContent value="instant" className="space-y-4">
            <div className="space-y-2">
              <Label>Meeting Title</Label>
              <Input
                placeholder="Quick meeting"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
          </TabsContent>

          <TabsContent value="scheduled" className="space-y-4">
            <div className="space-y-2">
              <Label>Meeting Title</Label>
              <Input
                placeholder="Team standup"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>Description (optional)</Label>
              <Textarea
                placeholder="What's this meeting about?"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Date</Label>
                <Input
                  type="date"
                  value={scheduledDate}
                  onChange={(e) => setScheduledDate(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Time</Label>
                <Input
                  type="time"
                  value={scheduledTime}
                  onChange={(e) => setScheduledTime(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Duration: {duration} minutes</Label>
              <Slider
                value={[duration]}
                onValueChange={([v]) => setDuration(v)}
                min={15}
                max={180}
                step={15}
              />
            </div>
          </TabsContent>
        </Tabs>

        <Separator className="my-4" />

        {/* Meeting settings */}
        <div className="space-y-4">
          <h4 className="font-medium text-sm">Settings</h4>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Waiting room</Label>
              <p className="text-xs text-muted-foreground">
                Approve participants before they join
              </p>
            </div>
            <Switch checked={enableWaitingRoom} onCheckedChange={setEnableWaitingRoom} />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Require password</Label>
              <p className="text-xs text-muted-foreground">
                Participants need a password to join
              </p>
            </div>
            <Switch checked={requirePassword} onCheckedChange={setRequirePassword} />
          </div>

          {requirePassword && (
            <div className="space-y-2">
              <Label>Meeting Password</Label>
              <Input
                type="password"
                placeholder="Enter password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          )}

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Mute participants on entry</Label>
              <p className="text-xs text-muted-foreground">
                Participants join with audio muted
              </p>
            </div>
            <Switch checked={muteOnEntry} onCheckedChange={setMuteOnEntry} />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Allow recording</Label>
              <p className="text-xs text-muted-foreground">
                Host can record the meeting
              </p>
            </div>
            <Switch checked={allowRecording} onCheckedChange={setAllowRecording} />
          </div>
        </div>

        {error && (
          <div className="text-sm text-red-500 flex items-center gap-2">
            <AlertCircle className="h-4 w-4" />
            {error}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={isCreating}>
            {isCreating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {meetingType === "instant" ? "Start Meeting" : "Schedule Meeting"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// Join Meeting Dialog
// ============================================================================

interface JoinMeetingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  meeting?: Meeting;
  onJoin?: (audioEnabled: boolean, videoEnabled: boolean) => void;
}

export function JoinMeetingDialog({
  open,
  onOpenChange,
  meeting,
  onJoin,
}: JoinMeetingDialogProps) {
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [password, setPassword] = useState("");
  const [isJoining, setIsJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const videoPreviewRef = useRef<HTMLVideoElement>(null);

  // Setup video preview
  useEffect(() => {
    if (open && videoEnabled && videoPreviewRef.current) {
      navigator.mediaDevices
        .getUserMedia({ video: true, audio: true })
        .then((stream) => {
          if (videoPreviewRef.current) {
            videoPreviewRef.current.srcObject = stream;
          }
        })
        .catch(console.error);
    }

    return () => {
      if (videoPreviewRef.current?.srcObject) {
        (videoPreviewRef.current.srcObject as MediaStream)
          .getTracks()
          .forEach((track) => track.stop());
      }
    };
  }, [open, videoEnabled]);

  const handleJoin = async () => {
    setIsJoining(true);
    setError(null);

    try {
      onJoin?.(audioEnabled, videoEnabled);
      onOpenChange(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsJoining(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Join Meeting</DialogTitle>
          {meeting && (
            <DialogDescription>
              {meeting.title}
            </DialogDescription>
          )}
        </DialogHeader>

        {/* Video preview */}
        <div className="relative aspect-video rounded-lg overflow-hidden bg-muted">
          {videoEnabled ? (
            <video
              ref={videoPreviewRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Avatar className="h-20 w-20">
                <AvatarFallback className="text-2xl">You</AvatarFallback>
              </Avatar>
            </div>
          )}

          {/* Preview controls */}
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-2">
            <Button
              variant={audioEnabled ? "secondary" : "destructive"}
              size="icon"
              className="rounded-full"
              onClick={() => setAudioEnabled(!audioEnabled)}
            >
              {audioEnabled ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
            </Button>
            <Button
              variant={videoEnabled ? "secondary" : "destructive"}
              size="icon"
              className="rounded-full"
              onClick={() => setVideoEnabled(!videoEnabled)}
            >
              {videoEnabled ? <Video className="h-4 w-4" /> : <VideoOff className="h-4 w-4" />}
            </Button>
          </div>
        </div>

        {/* Password (if required) */}
        {meeting?.password && (
          <div className="space-y-2">
            <Label>Meeting Password</Label>
            <Input
              type="password"
              placeholder="Enter password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
        )}

        {error && (
          <div className="text-sm text-red-500 flex items-center gap-2">
            <AlertCircle className="h-4 w-4" />
            {error}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleJoin} disabled={isJoining}>
            {isJoining && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Join Meeting
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// Meeting Settings Panel
// ============================================================================

interface MeetingSettingsPanelProps {
  meeting: Meeting;
  isHost: boolean;
  onClose: () => void;
}

function MeetingSettingsPanel({ meeting, isHost, onClose }: MeetingSettingsPanelProps) {
  return (
    <Tabs defaultValue="audio">
      <TabsList className="grid w-full grid-cols-3">
        <TabsTrigger value="audio">Audio</TabsTrigger>
        <TabsTrigger value="video">Video</TabsTrigger>
        <TabsTrigger value="general">General</TabsTrigger>
      </TabsList>

      <TabsContent value="audio" className="space-y-4">
        <div className="space-y-2">
          <Label>Microphone</Label>
          <Select>
            <SelectTrigger>
              <SelectValue placeholder="Select microphone" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="default">Default Microphone</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Speaker</Label>
          <Select>
            <SelectTrigger>
              <SelectValue placeholder="Select speaker" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="default">Default Speaker</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Button variant="outline" className="w-full">
          <Volume2 className="h-4 w-4 mr-2" />
          Test Audio
        </Button>
      </TabsContent>

      <TabsContent value="video" className="space-y-4">
        <div className="space-y-2">
          <Label>Camera</Label>
          <Select>
            <SelectTrigger>
              <SelectValue placeholder="Select camera" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="default">Default Camera</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Video Quality</Label>
          <Select defaultValue="auto">
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Auto</SelectItem>
              <SelectItem value="720p">720p</SelectItem>
              <SelectItem value="1080p">1080p</SelectItem>
              <SelectItem value="4k">4K</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center justify-between">
          <Label>Mirror my video</Label>
          <Switch defaultChecked />
        </div>
      </TabsContent>

      <TabsContent value="general" className="space-y-4">
        {isHost && (
          <>
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>Lock meeting</Label>
                <p className="text-xs text-muted-foreground">
                  No new participants can join
                </p>
              </div>
              <Switch />
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>Mute all participants</Label>
                <p className="text-xs text-muted-foreground">
                  Mute everyone except host
                </p>
              </div>
              <Switch />
            </div>
          </>
        )}

        <div className="flex items-center justify-between">
          <Label>Show meeting time</Label>
          <Switch defaultChecked />
        </div>

        <Separator />

        <div className="space-y-2">
          <Label>Meeting Link</Label>
          <div className="flex gap-2">
            <Input value={meeting.inviteLink || "No link available"} readOnly />
            <Button variant="outline" size="icon">
              <Copy className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </TabsContent>
    </Tabs>
  );
}

export default MeetingRoom;
