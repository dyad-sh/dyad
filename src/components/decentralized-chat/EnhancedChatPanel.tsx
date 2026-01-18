/**
 * Enhanced Decentralized Chat Panel
 * World-class chat with WebRTC video calls, groups, meetings, and appointments
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  MessageSquare,
  Send,
  Plus,
  Wallet,
  RefreshCw,
  Cloud,
  CloudOff,
  Users,
  Lock,
  Pin,
  Check,
  CheckCheck,
  Clock,
  AlertCircle,
  Loader2,
  Search,
  Settings,
  MoreVertical,
  LogOut,
  Power,
  Video,
  VideoOff,
  Phone,
  PhoneCall,
  PhoneOff,
  Calendar,
  CalendarClock,
  Mic,
  MicOff,
  Monitor,
  UserPlus,
  ChevronDown,
  Bell,
  Hash,
  Star,
  Archive,
  Sparkles,
} from "lucide-react";
import type {
  ChatConversation,
  ChatMessage,
  ChatIdentity,
  Meeting,
  MeetingParticipant,
  ChatGroup,
  Appointment,
} from "@/types/decentralized_chat_types";
import {
  useDecentralizedChat,
  useActiveChat,
  useChatConversations,
  useChatIdentity,
} from "@/hooks/useDecentralizedChat";

// Import new components
import {
  MeetingRoom,
  MeetingControls,
  CreateMeetingDialog,
  JoinMeetingDialog,
} from "./MeetingComponents";
import {
  CreateGroupDialog,
  GroupSettingsDialog,
  GroupCard,
  GroupInviteDialog,
} from "./GroupComponents";
import {
  CreateAppointmentDialog,
  CalendarView,
  AppointmentCard,
  AppointmentDetailsDialog,
  UpcomingAppointments,
} from "./AppointmentComponents";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

// Import existing components
import {
  IdentitySetupDialog,
  NewConversationDialog,
  ConversationListItem,
  MessageBubble,
  ChatWindow,
} from "./DecentralizedChatPanel";
import { IpcClient } from "@/ipc/ipc_client";
import { decentralizedChatClient } from "@/ipc/decentralized_chat_client";

// ============================================================================
// Self-Test Dialog for Encryption & P2P Verification
// ============================================================================

interface SelfTestResult {
  step: string;
  status: "pending" | "running" | "success" | "error";
  message: string;
  details?: string;
}

function SelfTestDialog({
  open,
  onOpenChange,
  identity,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  identity: ChatIdentity | null | undefined;
}) {
  const [testing, setTesting] = useState(false);
  const [results, setResults] = useState<SelfTestResult[]>([]);

  const runSelfTest = useCallback(async () => {
    if (!identity) return;
    
    setTesting(true);
    const testResults: SelfTestResult[] = [];
    
    const updateResult = (result: SelfTestResult) => {
      const idx = testResults.findIndex(r => r.step === result.step);
      if (idx >= 0) {
        testResults[idx] = result;
      } else {
        testResults.push(result);
      }
      setResults([...testResults]);
    };

    // Test 1: Verify identity encryption keys
    updateResult({ step: "encryption_keys", status: "running", message: "Verifying encryption keys..." });
    try {
      if (identity.publicKey && identity.signingKey) {
        updateResult({ 
          step: "encryption_keys", 
          status: "success", 
          message: "Encryption keys verified",
          details: `Public Key: ${identity.publicKey.substring(0, 20)}...`
        });
      } else {
        throw new Error("Missing encryption keys");
      }
    } catch (e) {
      updateResult({ step: "encryption_keys", status: "error", message: "Encryption keys missing", details: (e as Error).message });
    }

    // Test 2: Test self-encryption/decryption
    updateResult({ step: "self_encryption", status: "running", message: "Testing self-encryption..." });
    try {
      const testMessage = `Test message ${Date.now()}`;
      const result = await decentralizedChatClient.testEncryption(testMessage);
      if (result.success) {
        updateResult({ 
          step: "self_encryption", 
          status: "success", 
          message: "Self-encryption working",
          details: `${result.algorithm} - encrypted ${result.encryptedLength} bytes`
        });
      } else {
        throw new Error("Encryption test failed");
      }
    } catch (e) {
      updateResult({ step: "self_encryption", status: "error", message: "Encryption test failed", details: (e as Error).message });
    }

    // Test 3: Verify IPFS/Helia connectivity
    updateResult({ step: "ipfs_status", status: "running", message: "Checking IPFS connectivity..." });
    try {
      const status = await decentralizedChatClient.getStatus();
      if (status.heliaConnected) {
        updateResult({ 
          step: "ipfs_status", 
          status: "success", 
          message: "IPFS node running",
          details: `Peer ID: ${status.heliaPeerId?.substring(0, 20) || "N/A"}...`
        });
      } else {
        updateResult({ 
          step: "ipfs_status", 
          status: "error", 
          message: "IPFS node not connected",
          details: "Initialize identity first"
        });
      }
    } catch (e) {
      updateResult({ step: "ipfs_status", status: "error", message: "Failed to check IPFS status", details: (e as Error).message });
    }

    // Test 4: Test message pinning (minimal footprint)
    updateResult({ step: "pin_test", status: "running", message: "Testing CID pinning..." });
    try {
      const testData = { type: "test", timestamp: Date.now(), wallet: identity.walletAddress };
      const pinResult = await decentralizedChatClient.testPin(testData);
      if (pinResult.success && pinResult.cid) {
        updateResult({ 
          step: "pin_test", 
          status: "success", 
          message: "CID pinning working",
          details: `CID: ${pinResult.cid.substring(0, 20)}... (${pinResult.dataSize} bytes)`
        });
      } else {
        throw new Error("No CID returned");
      }
    } catch (e) {
      updateResult({ step: "pin_test", status: "error", message: "Pin test failed", details: (e as Error).message });
    }

    // Test 5: Test WebRTC/Video capability
    updateResult({ step: "webrtc_test", status: "running", message: "Testing video capability..." });
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      stream.getTracks().forEach(track => track.stop());
      updateResult({ 
        step: "webrtc_test", 
        status: "success", 
        message: "Video/Audio ready",
        details: "Camera and microphone accessible"
      });
    } catch (e) {
      updateResult({ step: "webrtc_test", status: "error", message: "Video test failed", details: (e as Error).message });
    }

    // Test 6: P2P connectivity status
    updateResult({ step: "p2p_status", status: "running", message: "Checking P2P status..." });
    try {
      const connectivity = await decentralizedChatClient.testConnectivity();
      updateResult({ 
        step: "p2p_status", 
        status: connectivity.pubsubReady ? "success" : "error", 
        message: connectivity.pubsubReady ? "P2P ready" : "P2P not ready",
        details: `Peers: ${connectivity.peerCount} | Pubsub: ${connectivity.pubsubReady ? "Ready" : "Not ready"}`
      });
    } catch (e) {
      updateResult({ step: "p2p_status", status: "error", message: "P2P check failed", details: (e as Error).message });
    }

    setTesting(false);
  }, [identity]);

  const getStatusIcon = (status: SelfTestResult["status"]) => {
    switch (status) {
      case "pending": return <Clock className="h-4 w-4 text-muted-foreground" />;
      case "running": return <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />;
      case "success": return <Check className="h-4 w-4 text-green-500" />;
      case "error": return <AlertCircle className="h-4 w-4 text-red-500" />;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            Decentralized Chat Self-Test
          </DialogTitle>
          <DialogDescription>
            Verify end-to-end encryption, IPFS pinning, and video capabilities
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-3 my-4">
          {results.length === 0 && !testing && (
            <div className="text-center py-6 text-muted-foreground">
              <Lock className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p className="text-sm">Click "Run Tests" to verify your setup</p>
              <p className="text-xs mt-1">Tests encryption, IPFS, and video</p>
            </div>
          )}
          
          {results.map((result) => (
            <div key={result.step} className="flex items-start gap-3 p-2 rounded-lg bg-muted/50">
              {getStatusIcon(result.status)}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{result.message}</p>
                {result.details && (
                  <p className="text-xs text-muted-foreground truncate">{result.details}</p>
                )}
              </div>
            </div>
          ))}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button onClick={runSelfTest} disabled={testing || !identity}>
            {testing ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Testing...
              </>
            ) : (
              <>
                <RefreshCw className="h-4 w-4 mr-2" />
                Run Tests
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// Enhanced Chat Header with Call Controls
// ============================================================================

interface EnhancedChatHeaderProps {
  conversation: ChatConversation | null;
  identity: ChatIdentity | null | undefined;
  onStartVideoCall: () => void;
  onStartAudioCall: () => void;
  onOpenCalendar: () => void;
  isInCall: boolean;
}

function EnhancedChatHeader({
  conversation,
  identity,
  onStartVideoCall,
  onStartAudioCall,
  onOpenCalendar,
  isInCall,
}: EnhancedChatHeaderProps) {
  const otherParticipant = conversation?.participants.find(
    (p) => p.walletAddress !== identity?.walletAddress
  );

  if (!conversation) return null;

  return (
    <div className="border-b px-4 py-3 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <Avatar>
          <AvatarImage src={conversation.avatar} />
          <AvatarFallback>
            {otherParticipant?.displayName?.slice(0, 2).toUpperCase() ||
             conversation.name?.slice(0, 2).toUpperCase() || "??"}
          </AvatarFallback>
        </Avatar>
        <div>
          <div className="flex items-center gap-2">
            <p className="font-medium">
              {conversation.type === "direct"
                ? otherParticipant?.displayName ||
                  otherParticipant?.walletAddress.slice(0, 10) + "..."
                : conversation.name || "Group Chat"}
            </p>
            {conversation.type === "group" && (
              <Badge variant="secondary" className="text-xs">
                <Users className="h-3 w-3 mr-1" />
                {conversation.participants.length}
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {conversation.encryptionType === "end-to-end" && (
              <span className="flex items-center gap-1">
                <Lock className="h-3 w-3" />
                End-to-end encrypted
              </span>
            )}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-1">
        {/* Video call */}
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={onStartVideoCall}
                disabled={isInCall}
              >
                <Video className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Start video call</TooltipContent>
          </Tooltip>
        </TooltipProvider>

        {/* Audio call */}
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={onStartAudioCall}
                disabled={isInCall}
              >
                <Phone className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Start audio call</TooltipContent>
          </Tooltip>
        </TooltipProvider>

        {/* Calendar/Schedule */}
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" onClick={onOpenCalendar}>
                <CalendarClock className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Schedule meeting</TooltipContent>
          </Tooltip>
        </TooltipProvider>

        <Separator orientation="vertical" className="h-6 mx-2" />

        {conversation.headCid && (
          <Badge variant="outline" className="text-xs">
            <Pin className="h-3 w-3 mr-1" />
            IPFS
          </Badge>
        )}

        <Button variant="ghost" size="icon">
          <MoreVertical className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

// ============================================================================
// Active Call Banner
// ============================================================================

interface ActiveCallBannerProps {
  meeting: Meeting | null;
  onJoin: () => void;
  onEnd: () => void;
  participantCount: number;
}

function ActiveCallBanner({ meeting, onJoin, onEnd, participantCount }: ActiveCallBannerProps) {
  if (!meeting) return null;

  return (
    <div className="bg-green-500/10 border-b border-green-500/20 px-4 py-2 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div className="h-8 w-8 rounded-full bg-green-500/20 flex items-center justify-center animate-pulse">
          <PhoneCall className="h-4 w-4 text-green-500" />
        </div>
        <div>
          <p className="text-sm font-medium">{meeting.title}</p>
          <p className="text-xs text-muted-foreground">
            {participantCount} participant{participantCount !== 1 ? "s" : ""} • In progress
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="default" size="sm" onClick={onJoin} className="bg-green-600 hover:bg-green-700">
          <Video className="h-4 w-4 mr-2" />
          Join
        </Button>
        <Button variant="destructive" size="sm" onClick={onEnd}>
          <PhoneOff className="h-4 w-4 mr-2" />
          End
        </Button>
      </div>
    </div>
  );
}

// ============================================================================
// Navigation Sidebar
// ============================================================================

interface NavigationSidebarProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  unreadChats: number;
  unreadGroups: number;
  upcomingMeetings: number;
}

function NavigationSidebar({
  activeTab,
  onTabChange,
  unreadChats,
  unreadGroups,
  upcomingMeetings,
}: NavigationSidebarProps) {
  const navItems = [
    { id: "chats", icon: MessageSquare, label: "Chats", badge: unreadChats },
    { id: "groups", icon: Users, label: "Groups", badge: unreadGroups },
    { id: "meetings", icon: Video, label: "Meetings", badge: upcomingMeetings },
    { id: "calendar", icon: Calendar, label: "Calendar", badge: 0 },
  ];

  return (
    <div className="w-16 border-r flex flex-col items-center py-4 gap-2 bg-muted/30">
      {navItems.map((item) => (
        <TooltipProvider key={item.id}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={activeTab === item.id ? "default" : "ghost"}
                size="icon"
                className="relative"
                onClick={() => onTabChange(item.id)}
              >
                <item.icon className="h-5 w-5" />
                {item.badge > 0 && (
                  <Badge className="absolute -top-1 -right-1 h-5 w-5 p-0 flex items-center justify-center text-xs">
                    {item.badge > 99 ? "99+" : item.badge}
                  </Badge>
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">{item.label}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ))}

      <Separator className="w-8 my-2" />

      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon">
              <Star className="h-5 w-5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">Starred</TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon">
              <Archive className="h-5 w-5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">Archived</TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <div className="flex-1" />

      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon">
              <Settings className="h-5 w-5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">Settings</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}

// ============================================================================
// Groups Panel
// ============================================================================

interface GroupsPanelProps {
  groups: ChatGroup[];
  selectedGroup: string | null;
  onSelectGroup: (groupId: string) => void;
  onCreateGroup: () => void;
}

function GroupsPanel({ groups, selectedGroup, onSelectGroup, onCreateGroup }: GroupsPanelProps) {
  const [searchQuery, setSearchQuery] = useState("");

  const filteredGroups = groups.filter((g) =>
    g.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-3 border-b">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold">Groups</h2>
          <Button size="sm" onClick={onCreateGroup}>
            <Plus className="h-4 w-4 mr-1" />
            New Group
          </Button>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search groups..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {/* Groups list */}
      <ScrollArea className="flex-1">
        <div className="p-3 space-y-2">
          {filteredGroups.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Users className="h-12 w-12 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No groups yet</p>
              <Button variant="link" size="sm" onClick={onCreateGroup}>
                Create your first group
              </Button>
            </div>
          ) : (
            filteredGroups.map((group) => (
              <GroupCard
                key={group.id}
                group={group}
                isSelected={selectedGroup === group.id}
                onClick={() => onSelectGroup(group.id)}
              />
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

// ============================================================================
// Meetings Panel
// ============================================================================

interface MeetingsPanelProps {
  meetings: Meeting[];
  onJoinMeeting: (meeting: Meeting) => void;
  onCreateMeeting: () => void;
}

function MeetingsPanel({ meetings, onJoinMeeting, onCreateMeeting }: MeetingsPanelProps) {
  const now = new Date();
  
  const liveMeetings = meetings.filter((m) => m.status === "live");
  const upcomingMeetings = meetings.filter(
    (m) => m.status === "scheduled" && new Date(m.scheduledStart!) > now
  );
  const recentMeetings = meetings.filter(
    (m) => m.status === "ended"
  ).slice(0, 5);

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold">Meetings</h2>
          <Button size="sm" onClick={onCreateMeeting}>
            <Plus className="h-4 w-4 mr-1" />
            New Meeting
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-3 space-y-4">
          {/* Live meetings */}
          {liveMeetings.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
                Live Now
              </h3>
              {liveMeetings.map((meeting) => (
                <Card key={meeting.id} className="bg-green-500/10 border-green-500/20">
                  <CardContent className="p-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium">{meeting.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {meeting.participants.length} participants
                        </p>
                      </div>
                      <Button size="sm" onClick={() => onJoinMeeting(meeting)}>
                        <Video className="h-4 w-4 mr-1" />
                        Join
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {/* Upcoming meetings */}
          {upcomingMeetings.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-medium text-muted-foreground">Upcoming</h3>
              {upcomingMeetings.map((meeting) => (
                <Card key={meeting.id}>
                  <CardContent className="p-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium">{meeting.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {meeting.scheduledStart && new Date(meeting.scheduledStart).toLocaleString()}
                        </p>
                      </div>
                      <Badge variant="outline">Scheduled</Badge>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {/* Recent meetings */}
          {recentMeetings.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-medium text-muted-foreground">Recent</h3>
              {recentMeetings.map((meeting) => (
                <Card key={meeting.id} className="opacity-60">
                  <CardContent className="p-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium">{meeting.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {meeting.actualEnd && new Date(meeting.actualEnd).toLocaleDateString()}
                        </p>
                      </div>
                      <Badge variant="secondary">Ended</Badge>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {meetings.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              <Video className="h-12 w-12 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No meetings yet</p>
              <Button variant="link" size="sm" onClick={onCreateMeeting}>
                Start your first meeting
              </Button>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

// ============================================================================
// Enhanced Identity Card
// ============================================================================

interface EnhancedIdentityCardProps {
  identity: ChatIdentity;
  onGoOffline: () => void;
  onGoOnline: () => void;
  onRunTest: () => void;
  isGoingOffline: boolean;
}

function EnhancedIdentityCard({
  identity,
  onGoOffline,
  onGoOnline,
  onRunTest,
  isGoingOffline,
}: EnhancedIdentityCardProps) {
  return (
    <Card className="bg-gradient-to-r from-primary/10 to-primary/5">
      <CardContent className="p-3">
        <div className="flex items-center gap-3">
          <div className="relative">
            <Avatar className="h-12 w-12 ring-2 ring-primary/20">
              <AvatarFallback className="bg-primary/20 text-primary font-bold">
                {identity.displayName?.slice(0, 2).toUpperCase() || "ME"}
              </AvatarFallback>
            </Avatar>
            <div
              className={cn(
                "absolute -bottom-0.5 -right-0.5 h-4 w-4 rounded-full border-2 border-background",
                identity.status === "online" ? "bg-green-500" : "bg-gray-400"
              )}
            />
          </div>
          
          <div className="flex-1 min-w-0">
            <p className="font-semibold truncate">
              {identity.displayName || "Anonymous"}
            </p>
            <p className="text-xs text-muted-foreground truncate font-mono">
              {identity.walletAddress.slice(0, 6)}...{identity.walletAddress.slice(-4)}
            </p>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <ChevronDown className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Status</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={onGoOnline}
                disabled={identity.status === "online" || isGoingOffline}
              >
                <div className="h-2 w-2 rounded-full bg-green-500 mr-2" />
                Online
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={onGoOffline}
                disabled={identity.status === "offline" || isGoingOffline}
              >
                <div className="h-2 w-2 rounded-full bg-gray-400 mr-2" />
                Offline
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onRunTest}>
                <Sparkles className="h-4 w-4 mr-2" />
                Run Self-Test
              </DropdownMenuItem>
              <DropdownMenuItem>
                <Settings className="h-4 w-4 mr-2" />
                Settings
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Main Enhanced Chat Panel
// ============================================================================

const WALLET_ADDRESS_KEY = "joycreate:chat:wallet-address";

export function EnhancedDecentralizedChatPanel() {
  const {
    status,
    isConnected,
    identity,
    conversations,
    syncOnline,
    isSyncing,
    goOffline,
    goOnline,
    isGoingOffline,
  } = useDecentralizedChat({ autoSync: true });

  // State
  const [activeTab, setActiveTab] = useState("chats");
  const [selectedConversation, setSelectedConversation] = useState<string | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [showIdentityDialog, setShowIdentityDialog] = useState(false);
  const [showNewConversationDialog, setShowNewConversationDialog] = useState(false);
  const [showCreateGroupDialog, setShowCreateGroupDialog] = useState(false);
  const [showCreateMeetingDialog, setShowCreateMeetingDialog] = useState(false);
  const [showCreateAppointmentDialog, setShowCreateAppointmentDialog] = useState(false);
  const [showJoinMeetingDialog, setShowJoinMeetingDialog] = useState(false);
  const [showSelfTestDialog, setShowSelfTestDialog] = useState(false);
  
  // Video call state
  const [activeMeeting, setActiveMeeting] = useState<Meeting | null>(null);
  const [isInMeetingRoom, setIsInMeetingRoom] = useState(false);
  const [meetingParticipants, setMeetingParticipants] = useState<MeetingParticipant[]>([]);
  const localVideoRef = useRef<HTMLVideoElement>(null);

  // Mock data (replace with actual data from hooks)
  const [groups, setGroups] = useState<ChatGroup[]>([]);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [selectedDate, setSelectedDate] = useState(new Date());

  // Auto-show identity dialog if no identity
  useEffect(() => {
    if (!identity) {
      const savedWallet = localStorage.getItem(WALLET_ADDRESS_KEY);
      if (!savedWallet) {
        setShowIdentityDialog(true);
      }
    }
  }, [identity]);

  // Handle starting a video call
  const handleStartVideoCall = useCallback(async () => {
    if (!identity || !selectedConversation) return;

    const conversation = conversations.find(c => c.id === selectedConversation);
    if (!conversation) return;

    // Create a meeting for this call
    const newMeeting: Meeting = {
      id: crypto.randomUUID(),
      conversationId: selectedConversation,
      title: conversation.type === "direct"
        ? `Call with ${conversation.participants.find(p => p.walletAddress !== identity.walletAddress)?.displayName || "User"}`
        : `${conversation.name} call`,
      type: "instant",
      status: "live",
      hostWallet: identity.walletAddress,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      participants: [],
      maxParticipants: 50,
      waitingRoom: [],
      isPublic: false,
      requiresApproval: false,
      isRecording: false,
      allowRecording: true,
      autoRecord: false,
      webrtcRoomId: crypto.randomUUID(),
      signalingTopic: `meeting-${crypto.randomUUID()}`,
      settings: {
        startWithAudioMuted: false,
        startWithVideoOff: false,
        allowParticipantVideo: true,
        allowParticipantAudio: true,
        allowScreenShare: true,
        muteOnEntry: false,
        lockMeeting: false,
        allowChat: true,
        allowReactions: true,
        allowHandRaise: true,
        allowRecording: true,
        notifyOnRecording: true,
        endToEndEncryption: true,
        enableWaitingRoom: false,
        autoAdmit: true,
        defaultLayout: "gallery",
        maxVideoTiles: 25,
        preferredVideoQuality: "auto",
        preferredAudioCodec: "opus",
      },
    };

    setActiveMeeting(newMeeting);
    setMeetingParticipants([{
      walletAddress: identity.walletAddress,
      displayName: identity.displayName,
      role: "host",
      joinedAt: new Date().toISOString(),
      audioEnabled: true,
      videoEnabled: true,
      screenSharing: false,
      handRaised: false,
      status: "connected",
    }]);
    setShowJoinMeetingDialog(true);
  }, [identity, selectedConversation, conversations]);

  // Handle starting an audio call
  const handleStartAudioCall = useCallback(async () => {
    // Similar to video call but with video disabled
    handleStartVideoCall();
  }, [handleStartVideoCall]);

  // Handle joining a meeting
  const handleJoinMeeting = useCallback((audioEnabled: boolean, videoEnabled: boolean) => {
    setShowJoinMeetingDialog(false);
    setIsInMeetingRoom(true);
    
    // Start WebRTC connection here
    // This would call the IPC handlers to initialize the call
  }, []);

  // Handle leaving a meeting
  const handleLeaveMeeting = useCallback(() => {
    setIsInMeetingRoom(false);
    setActiveMeeting(null);
    setMeetingParticipants([]);
  }, []);

  // Render meeting room if in a call
  if (isInMeetingRoom && activeMeeting && identity) {
    return (
      <MeetingRoom
        meeting={activeMeeting}
        identity={identity}
        participants={meetingParticipants}
        localVideoRef={localVideoRef}
        onLeave={handleLeaveMeeting}
        onEnd={handleLeaveMeeting}
      />
    );
  }

  return (
    <div className="h-full flex">
      {/* Navigation sidebar */}
      <NavigationSidebar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        unreadChats={conversations.reduce((acc, c) => acc + (c.unreadCount || 0), 0)}
        unreadGroups={groups.reduce((acc, g) => acc + (g.unreadCount || 0), 0)}
        upcomingMeetings={meetings.filter(m => m.status === "scheduled").length}
      />

      {/* Content panels */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="border-b px-4 py-3 flex items-center justify-between bg-muted/20">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <span className="font-bold text-lg">Decentralized Chat</span>
            {isConnected ? (
              <Badge variant="outline" className="text-xs">
                <Cloud className="h-3 w-3 mr-1 text-green-500" />
                P2P Connected
              </Badge>
            ) : (
              <Badge variant="outline" className="text-xs">
                <CloudOff className="h-3 w-3 mr-1 text-red-500" />
                Offline
              </Badge>
            )}
          </div>

          <div className="flex items-center gap-2">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => syncOnline()}
                    disabled={isSyncing}
                  >
                    <RefreshCw className={cn("h-4 w-4", isSyncing && "animate-spin")} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Sync from IPFS</TooltipContent>
              </Tooltip>
            </TooltipProvider>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <Plus className="h-4 w-4 mr-1" />
                  New
                  <ChevronDown className="h-4 w-4 ml-1" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setShowNewConversationDialog(true)}>
                  <MessageSquare className="h-4 w-4 mr-2" />
                  New Chat
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setShowCreateGroupDialog(true)}>
                  <Users className="h-4 w-4 mr-2" />
                  New Group
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setShowCreateMeetingDialog(true)}>
                  <Video className="h-4 w-4 mr-2" />
                  New Meeting
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setShowCreateAppointmentDialog(true)}>
                  <Calendar className="h-4 w-4 mr-2" />
                  New Appointment
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Active call banner */}
        {activeMeeting && !isInMeetingRoom && (
          <ActiveCallBanner
            meeting={activeMeeting}
            onJoin={() => setIsInMeetingRoom(true)}
            onEnd={handleLeaveMeeting}
            participantCount={meetingParticipants.length}
          />
        )}

        {/* Main content */}
        <div className="flex-1 flex min-h-0">
          {/* Left panel - list */}
          <div className="w-80 border-r flex flex-col">
            {activeTab === "chats" && (
              <>
                {/* Search */}
                <div className="p-3">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input placeholder="Search chats..." className="pl-9" />
                  </div>
                </div>

                {/* Identity card */}
                {identity && (
                  <div className="px-3 pb-3">
                    <EnhancedIdentityCard
                      identity={identity}
                      onGoOffline={goOffline}
                      onGoOnline={goOnline}
                      onRunTest={() => setShowSelfTestDialog(true)}
                      isGoingOffline={isGoingOffline}
                    />
                  </div>
                )}

                <Separator />

                {/* Conversation list */}
                <ScrollArea className="flex-1">
                  <div className="p-2 space-y-1">
                    {conversations.length === 0 ? (
                      <div className="text-center py-8 text-muted-foreground">
                        <MessageSquare className="h-10 w-10 mx-auto mb-2 opacity-50" />
                        <p className="text-sm">No conversations yet</p>
                        <Button
                          variant="link"
                          size="sm"
                          onClick={() => setShowNewConversationDialog(true)}
                        >
                          Start a new chat
                        </Button>
                      </div>
                    ) : (
                      conversations.map((conv) => (
                        <ConversationListItem
                          key={conv.id}
                          conversation={conv}
                          isActive={selectedConversation === conv.id}
                          onClick={() => setSelectedConversation(conv.id)}
                          identity={identity}
                        />
                      ))
                    )}
                  </div>
                </ScrollArea>
              </>
            )}

            {activeTab === "groups" && (
              <GroupsPanel
                groups={groups}
                selectedGroup={selectedGroup}
                onSelectGroup={setSelectedGroup}
                onCreateGroup={() => setShowCreateGroupDialog(true)}
              />
            )}

            {activeTab === "meetings" && (
              <MeetingsPanel
                meetings={meetings}
                onJoinMeeting={(m) => {
                  setActiveMeeting(m);
                  setShowJoinMeetingDialog(true);
                }}
                onCreateMeeting={() => setShowCreateMeetingDialog(true)}
              />
            )}

            {activeTab === "calendar" && (
              <div className="p-3">
                <UpcomingAppointments
                  appointments={appointments}
                  onSelectAppointment={() => {}}
                  onCreateNew={() => setShowCreateAppointmentDialog(true)}
                />
              </div>
            )}

            {/* Stats footer */}
            {status && (
              <div className="border-t p-3 text-xs text-muted-foreground space-y-1 bg-muted/20">
                <div className="flex justify-between">
                  <span>Conversations</span>
                  <span>{status.conversationCount}</span>
                </div>
                <div className="flex justify-between">
                  <span>Pinned</span>
                  <span>{status.pinnedMessageCount}</span>
                </div>
                <div className="flex justify-between">
                  <span>Peers</span>
                  <span className="flex items-center gap-1">
                    <div className={cn(
                      "h-2 w-2 rounded-full",
                      status.connectedPeers > 0 ? "bg-green-500" : "bg-gray-400"
                    )} />
                    {status.connectedPeers}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Right panel - content */}
          {activeTab === "chats" && selectedConversation && (
            <div className="flex-1 flex flex-col">
              <EnhancedChatHeader
                conversation={conversations.find(c => c.id === selectedConversation) || null}
                identity={identity}
                onStartVideoCall={handleStartVideoCall}
                onStartAudioCall={handleStartAudioCall}
                onOpenCalendar={() => setShowCreateAppointmentDialog(true)}
                isInCall={!!activeMeeting}
              />
              <ChatWindow
                conversationId={selectedConversation}
                identity={identity}
              />
            </div>
          )}

          {activeTab === "chats" && !selectedConversation && (
            <div className="flex-1 flex items-center justify-center text-muted-foreground">
              <div className="text-center">
                <MessageSquare className="h-16 w-16 mx-auto mb-4 opacity-30" />
                <h3 className="font-medium mb-1">Select a conversation</h3>
                <p className="text-sm">Choose a chat from the list or start a new one</p>
              </div>
            </div>
          )}

          {activeTab === "groups" && (
            <div className="flex-1 flex items-center justify-center text-muted-foreground">
              <div className="text-center">
                <Users className="h-16 w-16 mx-auto mb-4 opacity-30" />
                <h3 className="font-medium mb-1">Group Chat</h3>
                <p className="text-sm">Select a group or create a new one</p>
              </div>
            </div>
          )}

          {activeTab === "meetings" && (
            <div className="flex-1 flex items-center justify-center text-muted-foreground">
              <div className="text-center">
                <Video className="h-16 w-16 mx-auto mb-4 opacity-30" />
                <h3 className="font-medium mb-1">Video Meetings</h3>
                <p className="text-sm">Join an existing meeting or start a new one</p>
                <Button className="mt-4" onClick={() => setShowCreateMeetingDialog(true)}>
                  <Plus className="h-4 w-4 mr-2" />
                  Start Instant Meeting
                </Button>
              </div>
            </div>
          )}

          {activeTab === "calendar" && (
            <div className="flex-1 p-4">
              <CalendarView
                appointments={appointments}
                selectedDate={selectedDate}
                onSelectDate={setSelectedDate}
                onSelectAppointment={() => {}}
                onCreateAppointment={() => setShowCreateAppointmentDialog(true)}
              />
            </div>
          )}
        </div>
      </div>

      {/* Dialogs */}
      <IdentitySetupDialog
        open={showIdentityDialog}
        onOpenChange={setShowIdentityDialog}
      />

      <NewConversationDialog
        open={showNewConversationDialog}
        onOpenChange={setShowNewConversationDialog}
        onConversationCreated={(conv) => setSelectedConversation(conv.id)}
      />

      <CreateGroupDialog
        open={showCreateGroupDialog}
        onOpenChange={setShowCreateGroupDialog}
        onGroupCreated={(group) => {
          setGroups([...groups, group]);
          setSelectedGroup(group.id);
          setActiveTab("groups");
        }}
      />

      <CreateMeetingDialog
        open={showCreateMeetingDialog}
        onOpenChange={setShowCreateMeetingDialog}
        conversationId={selectedConversation || undefined}
        onMeetingCreated={(meeting) => {
          setMeetings([...meetings, meeting]);
          if (meeting.type === "instant") {
            setActiveMeeting(meeting);
            setShowJoinMeetingDialog(true);
          }
        }}
      />

      <CreateAppointmentDialog
        open={showCreateAppointmentDialog}
        onOpenChange={setShowCreateAppointmentDialog}
        conversationId={selectedConversation || undefined}
        selectedDate={selectedDate}
        onAppointmentCreated={(apt) => {
          setAppointments([...appointments, apt]);
        }}
      />

      <JoinMeetingDialog
        open={showJoinMeetingDialog}
        onOpenChange={setShowJoinMeetingDialog}
        meeting={activeMeeting || undefined}
        onJoin={handleJoinMeeting}
      />

      <SelfTestDialog
        open={showSelfTestDialog}
        onOpenChange={setShowSelfTestDialog}
        identity={identity}
      />
    </div>
  );
}

export default EnhancedDecentralizedChatPanel;
