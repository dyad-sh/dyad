/**
 * Decentralized Chat UI Components
 * Wallet-to-wallet encrypted messaging interface
 */

import { useState, useEffect, useRef, useCallback } from "react";
import {
  useDecentralizedChat,
  useActiveChat,
  useChatConversations,
  useChatIdentity,
  useChatSync,
} from "@/hooks/useDecentralizedChat";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Card,
  CardContent,
  CardDescription,
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
} from "lucide-react";
import type { ChatConversation, ChatMessage, ChatIdentity } from "@/types/decentralized_chat_types";

// ============================================================================
// Chat Identity Setup Dialog
// ============================================================================

interface IdentitySetupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onIdentityCreated?: (identity: ChatIdentity) => void;
}

// Storage key for remembering wallet address
const WALLET_ADDRESS_KEY = "joycreate:chat:wallet-address";
const DISPLAY_NAME_KEY = "joycreate:chat:display-name";

export function IdentitySetupDialog({ open, onOpenChange, onIdentityCreated }: IdentitySetupDialogProps) {
  const { createIdentity, isCreating } = useChatIdentity();
  const [walletAddress, setWalletAddress] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  
  // Load saved wallet address on mount
  useEffect(() => {
    const savedWallet = localStorage.getItem(WALLET_ADDRESS_KEY);
    const savedName = localStorage.getItem(DISPLAY_NAME_KEY);
    if (savedWallet) setWalletAddress(savedWallet);
    if (savedName) setDisplayName(savedName);
  }, []);

  const handleCreate = async () => {
    if (!walletAddress) {
      setError("Wallet address is required");
      return;
    }

    try {
      // Save wallet address and display name for future sessions
      localStorage.setItem(WALLET_ADDRESS_KEY, walletAddress);
      if (displayName) {
        localStorage.setItem(DISPLAY_NAME_KEY, displayName);
      }
      
      const result = await createIdentity({ walletAddress, displayName: displayName || undefined });
      onIdentityCreated?.(result.identity);
      onOpenChange(false);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wallet className="h-5 w-5" />
            Create Chat Identity
          </DialogTitle>
          <DialogDescription>
            Link your wallet address to enable decentralized, encrypted messaging.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Wallet Address</label>
            <Input
              placeholder="0x..."
              value={walletAddress}
              onChange={(e) => setWalletAddress(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Display Name (optional)</label>
            <Input
              placeholder="Your display name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </div>

          {error && (
            <div className="text-sm text-red-500 flex items-center gap-2">
              <AlertCircle className="h-4 w-4" />
              {error}
            </div>
          )}

          <div className="bg-muted/50 p-3 rounded-lg text-xs text-muted-foreground space-y-1">
            <p className="font-medium text-foreground">End-to-End Encrypted</p>
            <p>Messages are encrypted locally and pinned to IPFS for offline retrieval.</p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={isCreating || !walletAddress}>
            {isCreating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Create Identity
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// New Conversation Dialog
// ============================================================================

interface NewConversationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConversationCreated?: (conversation: ChatConversation) => void;
}

export function NewConversationDialog({ open, onOpenChange, onConversationCreated }: NewConversationDialogProps) {
  const { getOrCreateDirect, isCreating } = useChatConversations();
  const [walletAddress, setWalletAddress] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!walletAddress) {
      setError("Wallet address is required");
      return;
    }

    try {
      const result = await getOrCreateDirect(walletAddress);
      if (result.success && result.conversation) {
        onConversationCreated?.(result.conversation);
        onOpenChange(false);
        setWalletAddress("");
      } else {
        setError(result.error || "Failed to create conversation");
      }
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5" />
            New Conversation
          </DialogTitle>
          <DialogDescription>
            Start an encrypted chat with another wallet address.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Recipient Wallet Address</label>
            <Input
              placeholder="0x..."
              value={walletAddress}
              onChange={(e) => setWalletAddress(e.target.value)}
            />
          </div>

          {error && (
            <div className="text-sm text-red-500 flex items-center gap-2">
              <AlertCircle className="h-4 w-4" />
              {error}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={isCreating || !walletAddress}>
            {isCreating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Start Chat
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// Conversation List Item
// ============================================================================

interface ConversationListItemProps {
  conversation: ChatConversation;
  isActive: boolean;
  onClick: () => void;
  identity?: ChatIdentity | null;
}

export function ConversationListItem({ conversation, isActive, onClick, identity }: ConversationListItemProps) {
  // Get the other participant for direct messages
  const otherParticipant = conversation.participants.find(
    (p) => p.walletAddress !== identity?.walletAddress
  );

  const displayName = conversation.type === "direct"
    ? otherParticipant?.displayName || otherParticipant?.walletAddress.slice(0, 10) + "..."
    : conversation.name || "Group Chat";

  const avatarFallback = displayName.slice(0, 2).toUpperCase();

  return (
    <div
      className={cn(
        "flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors",
        isActive ? "bg-primary/10 border border-primary/20" : "hover:bg-muted/50"
      )}
      onClick={onClick}
    >
      <Avatar className="h-10 w-10">
        <AvatarImage src={conversation.avatar} />
        <AvatarFallback className="text-xs">{avatarFallback}</AvatarFallback>
      </Avatar>

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <span className="font-medium truncate">{displayName}</span>
          {conversation.lastMessage && (
            <span className="text-xs text-muted-foreground">
              {new Date(conversation.lastMessage.timestamp).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          )}
        </div>

        {conversation.lastMessage && (
          <p className="text-sm text-muted-foreground truncate">
            {conversation.lastMessage.preview}
          </p>
        )}
      </div>

      <div className="flex flex-col items-end gap-1">
        {conversation.unreadCount > 0 && (
          <Badge variant="default" className="h-5 min-w-5 text-xs">
            {conversation.unreadCount}
          </Badge>
        )}
        {conversation.headCid && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger>
                <Pin className="h-3 w-3 text-muted-foreground" />
              </TooltipTrigger>
              <TooltipContent>Pinned to IPFS</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Message Bubble
// ============================================================================

interface MessageBubbleProps {
  message: ChatMessage & { decryptedContent?: string };
  isOwn: boolean;
}

export function MessageBubble({ message, isOwn }: MessageBubbleProps) {
  const getStatusIcon = () => {
    switch (message.deliveryStatus) {
      case "sending":
        return <Clock className="h-3 w-3" />;
      case "sent":
        return <Check className="h-3 w-3" />;
      case "pinned":
        return <Pin className="h-3 w-3" />;
      case "delivered":
        return <CheckCheck className="h-3 w-3" />;
      case "read":
        return <CheckCheck className="h-3 w-3 text-blue-500" />;
      case "failed":
        return <AlertCircle className="h-3 w-3 text-red-500" />;
      default:
        return null;
    }
  };

  return (
    <div className={cn("flex", isOwn ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[70%] rounded-2xl px-4 py-2",
          isOwn
            ? "bg-primary text-primary-foreground rounded-br-md"
            : "bg-muted rounded-bl-md"
        )}
      >
        <p className="text-sm whitespace-pre-wrap break-words">
          {message.decryptedContent || "[Encrypted]"}
        </p>

        <div
          className={cn(
            "flex items-center gap-1 mt-1",
            isOwn ? "justify-end" : "justify-start"
          )}
        >
          <span className="text-[10px] opacity-70">
            {new Date(message.createdAt).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
          {isOwn && (
            <span className="opacity-70">{getStatusIcon()}</span>
          )}
          {message.cid && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger>
                  <Lock className="h-2.5 w-2.5 opacity-50" />
                </TooltipTrigger>
                <TooltipContent>
                  <p className="text-xs">CID: {message.cid.slice(0, 12)}...</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Chat Window
// ============================================================================

interface ChatWindowProps {
  conversationId: string | null;
  identity?: ChatIdentity | null;
}

export function ChatWindow({ conversationId, identity }: ChatWindowProps) {
  const {
    conversation,
    messages,
    isLoadingMessages,
    sendText,
    isSending,
    handleInputChange,
    typingUsers,
  } = useActiveChat(conversationId);

  const [inputValue, setInputValue] = useState("");
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollAreaRef.current) {
      scrollAreaRef.current.scrollTop = scrollAreaRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = async () => {
    if (!inputValue.trim() || isSending) return;

    const content = inputValue;
    setInputValue("");

    try {
      await sendText(content);
    } catch (error) {
      console.error("Failed to send message:", error);
      setInputValue(content); // Restore on error
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (!conversationId) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        <div className="text-center">
          <MessageSquare className="h-12 w-12 mx-auto mb-4 opacity-50" />
          <p>Select a conversation to start chatting</p>
        </div>
      </div>
    );
  }

  // Get the other participant for display
  const otherParticipant = conversation?.participants.find(
    (p) => p.walletAddress !== identity?.walletAddress
  );

  return (
    <div className="flex-1 flex flex-col">
      {/* Header */}
      <div className="border-b px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Avatar>
            <AvatarFallback>
              {otherParticipant?.displayName?.slice(0, 2).toUpperCase() || "??"}
            </AvatarFallback>
          </Avatar>
          <div>
            <p className="font-medium">
              {otherParticipant?.displayName ||
                otherParticipant?.walletAddress.slice(0, 10) + "..."}
            </p>
            <p className="text-xs text-muted-foreground">
              {conversation?.encryptionType === "end-to-end" && (
                <span className="flex items-center gap-1">
                  <Lock className="h-3 w-3" />
                  End-to-end encrypted
                </span>
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {conversation?.headCid && (
            <Badge variant="outline" className="text-xs">
              <Pin className="h-3 w-3 mr-1" />
              IPFS Pinned
            </Badge>
          )}
          <Button variant="ghost" size="icon">
            <MoreVertical className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 p-4" ref={scrollAreaRef}>
        <div className="space-y-3">
          {isLoadingMessages ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : messages.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Lock className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>No messages yet</p>
              <p className="text-sm">Send an encrypted message to start the conversation</p>
            </div>
          ) : (
            messages.map((msg) => (
              <MessageBubble
                key={msg.id}
                message={msg}
                isOwn={msg.sender === identity?.walletAddress}
              />
            ))
          )}
        </div>

        {/* Typing indicator */}
        {typingUsers.length > 0 && (
          <div className="text-sm text-muted-foreground italic mt-2">
            {typingUsers.length === 1 ? "Typing..." : `${typingUsers.length} people typing...`}
          </div>
        )}
      </ScrollArea>

      {/* Input */}
      <div className="border-t p-4">
        <div className="flex items-center gap-2">
          <Input
            ref={inputRef}
            placeholder="Type an encrypted message..."
            value={inputValue}
            onChange={(e) => {
              setInputValue(e.target.value);
              handleInputChange();
            }}
            onKeyDown={handleKeyDown}
            disabled={isSending}
          />
          <Button onClick={handleSend} disabled={!inputValue.trim() || isSending}>
            {isSending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Main Chat Component
// ============================================================================

export function DecentralizedChatPanel() {
  const {
    status,
    isConnected,
    isInitialized,
    identity,
    conversations,
    syncOnline,
    isSyncing,
    goOffline,
    goOnline,
    isGoingOffline,
  } = useDecentralizedChat({ autoSync: true });

  const [selectedConversation, setSelectedConversation] = useState<string | null>(null);
  const [showIdentityDialog, setShowIdentityDialog] = useState(false);
  const [showNewConversationDialog, setShowNewConversationDialog] = useState(false);
  const [hasCheckedIdentity, setHasCheckedIdentity] = useState(false);

  // Only show identity setup dialog if no identity exists and we haven't checked yet
  useEffect(() => {
    if (!hasCheckedIdentity && identity === null) {
      // Check if there's a saved wallet - if so, identity will load automatically
      const savedWallet = localStorage.getItem(WALLET_ADDRESS_KEY);
      if (!savedWallet) {
        setShowIdentityDialog(true);
      }
      setHasCheckedIdentity(true);
    } else if (identity) {
      setHasCheckedIdentity(true);
    }
  }, [identity, hasCheckedIdentity]);
  
  // Handle disconnect - go offline so others can't see messages
  const handleDisconnect = async () => {
    await goOffline();
  };
  
  // Handle reconnect - go back online
  const handleReconnect = async () => {
    await goOnline();
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="border-b px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-5 w-5" />
          <span className="font-semibold">Decentralized Chat</span>
          {isConnected ? (
            <Badge variant="outline" className="text-xs">
              <Cloud className="h-3 w-3 mr-1 text-green-500" />
              Connected
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
              <TooltipContent>Sync messages from IPFS</TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowNewConversationDialog(true)}
            disabled={!identity}
          >
            <Plus className="h-4 w-4 mr-1" />
            New Chat
          </Button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex min-h-0">
        {/* Conversation list */}
        <div className="w-80 border-r flex flex-col">
          {/* Search */}
          <div className="p-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search conversations..." className="pl-9" />
            </div>
          </div>

          {/* Identity card */}
          {identity && (
            <div className="px-3 pb-3">
              <Card className="bg-muted/30">
                <CardContent className="p-3">
                  <div className="flex items-center gap-3">
                    <Avatar className="h-10 w-10">
                      <AvatarFallback>
                        {identity.displayName?.slice(0, 2).toUpperCase() || "ME"}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">
                        {identity.displayName || "Anonymous"}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {identity.walletAddress.slice(0, 8)}...{identity.walletAddress.slice(-6)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-xs",
                          identity.status === "online" && "border-green-500 text-green-500",
                          identity.status === "offline" && "border-red-500 text-red-500"
                        )}
                      >
                        {identity.status}
                      </Badge>
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            {identity.status === "offline" ? (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={handleReconnect}
                                disabled={isGoingOffline}
                              >
                                <Power className="h-4 w-4 text-green-500" />
                              </Button>
                            ) : (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={handleDisconnect}
                                disabled={isGoingOffline}
                              >
                                <LogOut className="h-4 w-4 text-red-500" />
                              </Button>
                            )}
                          </TooltipTrigger>
                          <TooltipContent>
                            {identity.status === "offline" 
                              ? "Go online - receive messages" 
                              : "Go offline - others won't see you"}
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          <Separator />

          {/* Conversations */}
          <ScrollArea className="flex-1">
            <div className="p-2 space-y-1">
              {conversations.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Users className="h-8 w-8 mx-auto mb-2 opacity-50" />
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

          {/* Stats footer */}
          {status && (
            <div className="border-t p-3 text-xs text-muted-foreground space-y-1">
              <div className="flex justify-between">
                <span>Conversations</span>
                <span>{status.conversationCount}</span>
              </div>
              <div className="flex justify-between">
                <span>Pinned messages</span>
                <span>{status.pinnedMessageCount}</span>
              </div>
              <div className="flex justify-between">
                <span>Connected peers</span>
                <span>{status.connectedPeers}</span>
              </div>
            </div>
          )}
        </div>

        {/* Chat window */}
        <ChatWindow conversationId={selectedConversation} identity={identity} />
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
    </div>
  );
}

export default DecentralizedChatPanel;
