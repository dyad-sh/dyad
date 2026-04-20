/**
 * Advanced Feature Components for P2P Chat
 * Voice Messages, Search, Stories, Bookmarks, Payments, Polls UI,
 * Message Forwarding, Rich Embeds, Pinned Messages
 */

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
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
import { Progress } from "@/components/ui/progress";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Mic,
  MicOff,
  Square,
  Play,
  Pause,
  Send,
  Search,
  X,
  Pin,
  Bookmark,
  BookmarkCheck,
  Forward,
  Reply,
  Trash2,
  Copy,
  MoreVertical,
  CircleDollarSign,
  ArrowRight,
  Check,
  ChevronDown,
  Calendar,
  Clock,
  Filter,
  Hash,
  Image as ImageIcon,
  Link,
  Paperclip,
  FileText,
  Eye,
  EyeOff,
  Globe,
  Heart,
  ThumbsUp,
  Smile,
  Star,
  Sparkles,
  Loader2,
  AlertCircle,
  Volume2,
  BarChart3,
  Users,
  Lock,
  Radio,
  Palette,
  Type,
  MapPin,
  Plus,
  Minus,
} from "lucide-react";
import type {
  VoiceMessage,
  MessageSearchQuery,
  MessageSearchResult,
  SearchResultMessage,
  ForwardMessageRequest,
  MessageBookmark,
  BookmarkFolder,
  ChatStory,
  StoryType,
  StoryContent,
  ChatPayment,
  PaymentType,
  RichEmbed,
  LinkPreview,
  SmartNotification,
} from "@/types/p2p_chat_extensions";
import type { Poll, PollOption, ChatMessage, ChatConversation } from "@/types/decentralized_chat_types";

// ============================================================================
// 1. VOICE MESSAGE RECORDER
// ============================================================================

interface VoiceRecorderProps {
  onSend: (audioBlob: Blob, durationMs: number) => void;
  onCancel: () => void;
}

export function VoiceRecorder({ onSend, onCancel }: VoiceRecorderProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [durationMs, setDurationMs] = useState(0);
  const [waveform, setWaveform] = useState<number[]>([]);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number>(0);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const audioCtx = new AudioContext();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;

      const recorder = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.start(100);
      setIsRecording(true);
      setDurationMs(0);

      timerRef.current = setInterval(() => {
        setDurationMs((d) => d + 100);
      }, 100);

      // Waveform animation
      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const animate = () => {
        analyser.getByteFrequencyData(dataArray);
        const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length / 255;
        setWaveform((prev) => [...prev.slice(-50), avg]);
        animFrameRef.current = requestAnimationFrame(animate);
      };
      animate();
    } catch (e) {
      console.error("Failed to start recording:", e);
    }
  }, []);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach((t) => t.stop());
    }
    if (timerRef.current) clearInterval(timerRef.current);
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    setIsRecording(false);
  }, []);

  const handleSend = useCallback(() => {
    stopRecording();
    setTimeout(() => {
      const blob = new Blob(chunksRef.current, { type: "audio/webm;codecs=opus" });
      onSend(blob, durationMs);
    }, 100);
  }, [stopRecording, durationMs, onSend]);

  const handleCancel = useCallback(() => {
    stopRecording();
    chunksRef.current = [];
    setWaveform([]);
    setDurationMs(0);
    onCancel();
  }, [stopRecording, onCancel]);

  useEffect(() => {
    startRecording();
    return () => {
      stopRecording();
    };
  }, []);

  const formatDuration = (ms: number) => {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    return `${m}:${(s % 60).toString().padStart(2, "0")}`;
  };

  return (
    <div className="flex items-center gap-3 px-4 py-3 bg-red-500/5 border-t border-red-500/20 animate-in slide-in-from-bottom-2">
      {/* Cancel */}
      <Button variant="ghost" size="icon" onClick={handleCancel} className="text-muted-foreground">
        <Trash2 className="h-4 w-4" />
      </Button>

      {/* Waveform */}
      <div className="flex-1 flex items-center gap-0.5 h-8">
        {waveform.map((amp, i) => (
          <div
            key={i}
            className="w-1 bg-red-500 rounded-full transition-all"
            style={{ height: `${Math.max(4, amp * 32)}px` }}
          />
        ))}
        {waveform.length < 50 &&
          Array.from({ length: 50 - waveform.length }).map((_, i) => (
            <div key={`empty-${i}`} className="w-1 h-1 bg-muted-foreground/20 rounded-full" />
          ))}
      </div>

      {/* Duration */}
      <div className="flex items-center gap-2">
        <div className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
        <span className="text-sm font-mono font-medium text-red-500">
          {formatDuration(durationMs)}
        </span>
      </div>

      {/* Send */}
      <Button size="icon" onClick={handleSend} className="bg-primary h-10 w-10 rounded-full">
        <Send className="h-4 w-4" />
      </Button>
    </div>
  );
}

// ============================================================================
// 2. VOICE MESSAGE PLAYER
// ============================================================================

interface VoiceMessagePlayerProps {
  voiceMessage: VoiceMessage;
  isMine: boolean;
}

export function VoiceMessagePlayer({ voiceMessage, isMine }: VoiceMessagePlayerProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [showTranscript, setShowTranscript] = useState(false);

  const formatDuration = (ms: number) => {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    return `${m}:${(s % 60).toString().padStart(2, "0")}`;
  };

  return (
    <div className={cn(
      "flex flex-col gap-2 p-3 rounded-2xl min-w-[240px] max-w-[320px]",
      isMine ? "bg-primary text-primary-foreground" : "bg-muted"
    )}>
      <div className="flex items-center gap-3">
        {/* Play/Pause */}
        <Button
          variant="ghost"
          size="icon"
          className={cn("h-10 w-10 rounded-full shrink-0",
            isMine ? "hover:bg-primary-foreground/20" : "hover:bg-background/50"
          )}
          onClick={() => setIsPlaying(!isPlaying)}
        >
          {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
        </Button>

        {/* Waveform */}
        <div className="flex-1 flex items-center gap-px h-8">
          {voiceMessage.waveform.map((amp, i) => {
            const played = i / voiceMessage.waveform.length <= progress;
            return (
              <div
                key={i}
                className={cn(
                  "w-1 rounded-full transition-colors",
                  played
                    ? isMine ? "bg-primary-foreground" : "bg-primary"
                    : isMine ? "bg-primary-foreground/40" : "bg-muted-foreground/30"
                )}
                style={{ height: `${Math.max(4, amp * 28)}px` }}
              />
            );
          })}
        </div>

        {/* Duration */}
        <span className={cn("text-xs font-mono shrink-0",
          isMine ? "text-primary-foreground/70" : "text-muted-foreground"
        )}>
          {formatDuration(voiceMessage.durationMs)}
        </span>
      </div>

      {/* Transcript toggle */}
      {voiceMessage.transcript && (
        <button
          className={cn("text-xs flex items-center gap-1",
            isMine ? "text-primary-foreground/70" : "text-muted-foreground"
          )}
          onClick={() => setShowTranscript(!showTranscript)}
        >
          <FileText className="h-3 w-3" />
          {showTranscript ? "Hide" : "Show"} transcript
        </button>
      )}
      {showTranscript && voiceMessage.transcript && (
        <p className={cn("text-xs italic",
          isMine ? "text-primary-foreground/80" : "text-foreground/80"
        )}>
          "{voiceMessage.transcript}"
        </p>
      )}

      {voiceMessage.isTranscribing && (
        <div className={cn("flex items-center gap-1.5 text-xs",
          isMine ? "text-primary-foreground/60" : "text-muted-foreground"
        )}>
          <Loader2 className="h-3 w-3 animate-spin" />
          Transcribing...
        </div>
      )}
    </div>
  );
}

// ============================================================================
// 3. MESSAGE SEARCH PANEL
// ============================================================================

interface MessageSearchPanelProps {
  onSearch: (query: MessageSearchQuery) => void;
  results: MessageSearchResult | null;
  isSearching: boolean;
  onJumpToMessage: (messageId: string, conversationId: string) => void;
  onClose: () => void;
}

export function MessageSearchPanel({
  onSearch,
  results,
  isSearching,
  onJumpToMessage,
  onClose,
}: MessageSearchPanelProps) {
  const [query, setQuery] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [hasAttachments, setHasAttachments] = useState<boolean | undefined>();
  const [sortBy, setSortBy] = useState<"relevance" | "newest" | "oldest">("relevance");

  const handleSearch = useCallback(() => {
    if (!query.trim()) return;
    onSearch({
      query,
      hasAttachments,
      sortBy,
      offset: 0,
      limit: 50,
    });
  }, [query, hasAttachments, sortBy, onSearch]);

  return (
    <div className="flex flex-col h-full border-l w-80">
      {/* Header */}
      <div className="p-3 border-b">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold text-sm">Search Messages</h3>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex gap-1">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search..."
              className="h-8 pl-8 text-sm"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            />
          </div>
          <Button size="sm" className="h-8" onClick={handleSearch} disabled={isSearching}>
            {isSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          </Button>
        </div>

        {/* Quick filters */}
        <div className="flex gap-1 mt-2 flex-wrap">
          <Button
            variant={hasAttachments === true ? "default" : "outline"}
            size="sm"
            className="h-6 text-xs px-2"
            onClick={() => setHasAttachments(hasAttachments === true ? undefined : true)}
          >
            <Paperclip className="h-3 w-3 mr-1" />
            Files
          </Button>
          <Button
            variant={sortBy === "newest" ? "default" : "outline"}
            size="sm"
            className="h-6 text-xs px-2"
            onClick={() => setSortBy(sortBy === "newest" ? "relevance" : "newest")}
          >
            <Clock className="h-3 w-3 mr-1" />
            Newest
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-6 text-xs px-2"
            onClick={() => setShowFilters(!showFilters)}
          >
            <Filter className="h-3 w-3 mr-1" />
            More
          </Button>
        </div>
      </div>

      {/* Results */}
      <ScrollArea className="flex-1">
        {!results && !isSearching && (
          <div className="text-center py-12 text-muted-foreground">
            <Search className="h-12 w-12 mx-auto mb-2 opacity-30" />
            <p className="text-sm">Search across all messages</p>
            <p className="text-xs mt-1">Finds text in encrypted messages you have access to</p>
          </div>
        )}

        {isSearching && (
          <div className="text-center py-12">
            <Loader2 className="h-8 w-8 mx-auto animate-spin text-primary" />
            <p className="text-sm text-muted-foreground mt-2">Searching...</p>
          </div>
        )}

        {results && (
          <div className="p-2">
            <p className="text-xs text-muted-foreground px-2 py-1">
              {results.total} results ({results.took}ms)
            </p>
            <div className="space-y-1 mt-1">
              {results.messages.map((result) => (
                <button
                  key={result.message.id}
                  className="w-full text-left p-2 rounded-md hover:bg-muted/50 transition-colors"
                  onClick={() => onJumpToMessage(result.message.id, result.message.conversationId)}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <Avatar className="h-5 w-5">
                      <AvatarFallback className="text-[8px]">
                        {result.message.sender.slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <span className="text-xs font-medium truncate flex-1">
                      {result.message.sender.slice(0, 8)}...
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {new Date(result.message.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                  {result.highlight ? (
                    <p
                      className="text-xs text-muted-foreground line-clamp-2"
                      dangerouslySetInnerHTML={{ __html: result.highlight }}
                    />
                  ) : result.decryptedPreview ? (
                    <p className="text-xs text-muted-foreground line-clamp-2">
                      {result.decryptedPreview}
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground italic">
                      🔒 Encrypted message
                    </p>
                  )}
                  {result.conversationName && (
                    <p className="text-[10px] text-muted-foreground mt-1">
                      in #{result.conversationName}
                    </p>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

// ============================================================================
// 4. BOOKMARKS / SAVED MESSAGES PANEL
// ============================================================================

interface BookmarksPanelProps {
  bookmarks: MessageBookmark[];
  folders: BookmarkFolder[];
  onJumpToMessage: (messageId: string, conversationId: string) => void;
  onRemoveBookmark: (bookmarkId: string) => void;
  onCreateFolder: (name: string) => void;
  onClose: () => void;
}

export function BookmarksPanel({
  bookmarks,
  folders,
  onJumpToMessage,
  onRemoveBookmark,
  onCreateFolder,
  onClose,
}: BookmarksPanelProps) {
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const filtered = useMemo(() => {
    return bookmarks.filter((b) => {
      if (selectedFolder && b.folder !== selectedFolder) return false;
      if (searchQuery && !b.contentSnapshot.toLowerCase().includes(searchQuery.toLowerCase()) &&
          !b.note?.toLowerCase().includes(searchQuery.toLowerCase())) return false;
      return true;
    });
  }, [bookmarks, selectedFolder, searchQuery]);

  return (
    <div className="flex flex-col h-full border-l w-80">
      <div className="p-3 border-b">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <Bookmark className="h-4 w-4" />
            Saved Messages
          </h3>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <Input
          placeholder="Search saved..."
          className="h-8 text-sm"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />

        {/* Folder tabs */}
        <div className="flex gap-1 mt-2 overflow-x-auto">
          <Button
            variant={selectedFolder === null ? "default" : "outline"}
            size="sm"
            className="h-6 text-xs px-2 shrink-0"
            onClick={() => setSelectedFolder(null)}
          >
            All ({bookmarks.length})
          </Button>
          {folders.map((folder) => (
            <Button
              key={folder.id}
              variant={selectedFolder === folder.name ? "default" : "outline"}
              size="sm"
              className="h-6 text-xs px-2 shrink-0"
              onClick={() => setSelectedFolder(folder.name)}
            >
              {folder.icon || "📁"} {folder.name} ({folder.bookmarkCount})
            </Button>
          ))}
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          {filtered.map((bookmark) => (
            <Card key={bookmark.id} className="bg-muted/30">
              <CardContent className="p-2">
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs line-clamp-3">{bookmark.contentSnapshot}</p>
                    {bookmark.note && (
                      <p className="text-[10px] text-muted-foreground mt-1 italic">
                        📝 {bookmark.note}
                      </p>
                    )}
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[10px] text-muted-foreground">
                        {bookmark.senderName || "Unknown"}
                      </span>
                      <span className="text-[10px] text-muted-foreground">•</span>
                      <span className="text-[10px] text-muted-foreground">
                        {new Date(bookmark.messageTimestamp).toLocaleDateString()}
                      </span>
                    </div>
                    {bookmark.tags.length > 0 && (
                      <div className="flex gap-0.5 mt-1">
                        {bookmark.tags.map((tag) => (
                          <Badge key={tag} variant="secondary" className="text-[8px] h-4">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0">
                        <MoreVertical className="h-3 w-3" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => onJumpToMessage(bookmark.messageId, bookmark.conversationId)}>
                        <ArrowRight className="h-4 w-4 mr-2" />
                        Jump to message
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => onRemoveBookmark(bookmark.id)}>
                        <Trash2 className="h-4 w-4 mr-2" />
                        Remove
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </CardContent>
            </Card>
          ))}
          {filtered.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              <Bookmark className="h-8 w-8 mx-auto mb-2 opacity-30" />
              <p className="text-xs">No saved messages</p>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

// ============================================================================
// 5. FORWARD MESSAGE DIALOG
// ============================================================================

interface ForwardDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  messagePreview: string;
  conversations: ChatConversation[];
  onForward: (conversationIds: string[], comment?: string) => void;
}

export function ForwardDialog({
  open,
  onOpenChange,
  messagePreview,
  conversations,
  onForward,
}: ForwardDialogProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [comment, setComment] = useState("");
  const [search, setSearch] = useState("");

  const filtered = conversations.filter((c) =>
    (c.name || "").toLowerCase().includes(search.toLowerCase())
  );

  const toggleSelection = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Forward className="h-5 w-5" />
            Forward Message
          </DialogTitle>
        </DialogHeader>

        {/* Message Preview */}
        <Card className="bg-muted/50">
          <CardContent className="p-3">
            <p className="text-sm line-clamp-3">{messagePreview}</p>
          </CardContent>
        </Card>

        {/* Search */}
        <Input
          placeholder="Search conversations..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        {/* Conversation List */}
        <ScrollArea className="h-48">
          <div className="space-y-1">
            {filtered.map((conv) => (
              <button
                key={conv.id}
                className={cn(
                  "w-full flex items-center gap-3 p-2 rounded-md transition-colors",
                  selectedIds.has(conv.id) ? "bg-primary/10" : "hover:bg-muted/50"
                )}
                onClick={() => toggleSelection(conv.id)}
              >
                <Avatar className="h-8 w-8">
                  <AvatarFallback className="text-xs">
                    {(conv.name || "?").slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <span className="text-sm flex-1 truncate text-left">
                  {conv.name || `${conv.participants[0]?.walletAddress.slice(0, 8)}...`}
                </span>
                {selectedIds.has(conv.id) && (
                  <Check className="h-4 w-4 text-primary" />
                )}
              </button>
            ))}
          </div>
        </ScrollArea>

        {/* Comment */}
        <Input
          placeholder="Add a comment (optional)"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        />

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              onForward(Array.from(selectedIds), comment || undefined);
              onOpenChange(false);
            }}
            disabled={selectedIds.size === 0}
          >
            Forward to {selectedIds.size} chat{selectedIds.size !== 1 ? "s" : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// 6. POLL CREATION & DISPLAY
// ============================================================================

interface CreatePollDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (poll: Omit<Poll, "id" | "createdAt" | "totalVotes" | "status">) => void;
  conversationId: string;
  creatorWallet: string;
}

export function CreatePollDialog({
  open,
  onOpenChange,
  onCreate,
  conversationId,
  creatorWallet,
}: CreatePollDialogProps) {
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const [type, setType] = useState<"single" | "multiple">("single");
  const [anonymous, setAnonymous] = useState(false);
  const [allowAdd, setAllowAdd] = useState(false);

  const addOption = () => setOptions([...options, ""]);
  const removeOption = (i: number) => setOptions(options.filter((_, idx) => idx !== i));
  const updateOption = (i: number, val: string) => {
    const next = [...options];
    next[i] = val;
    setOptions(next);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" />
            Create Poll
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Question</Label>
            <Input
              placeholder="What do you want to ask?"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label>Options</Label>
            {options.map((opt, i) => (
              <div key={i} className="flex gap-2">
                <Input
                  placeholder={`Option ${i + 1}`}
                  value={opt}
                  onChange={(e) => updateOption(i, e.target.value)}
                />
                {options.length > 2 && (
                  <Button variant="ghost" size="icon" onClick={() => removeOption(i)}>
                    <Minus className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ))}
            {options.length < 10 && (
              <Button variant="outline" size="sm" onClick={addOption}>
                <Plus className="h-4 w-4 mr-1" />
                Add Option
              </Button>
            )}
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>Allow multiple votes</Label>
              <Switch checked={type === "multiple"} onCheckedChange={(v) => setType(v ? "multiple" : "single")} />
            </div>
            <div className="flex items-center justify-between">
              <Label>Anonymous voting</Label>
              <Switch checked={anonymous} onCheckedChange={setAnonymous} />
            </div>
            <div className="flex items-center justify-between">
              <Label>Allow adding options</Label>
              <Switch checked={allowAdd} onCheckedChange={setAllowAdd} />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              onCreate({
                conversationId,
                creatorWallet,
                question,
                options: options.filter(Boolean).map((text, i) => ({
                  id: crypto.randomUUID(),
                  text,
                  votes: 0,
                })),
                type,
                anonymous,
                showResults: "always",
                allowAddOptions: allowAdd,
                totalVotes: 0,
              });
              onOpenChange(false);
              setQuestion("");
              setOptions(["", ""]);
            }}
            disabled={!question.trim() || options.filter(Boolean).length < 2}
          >
            Create Poll
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Inline poll display in chat */
interface PollDisplayProps {
  poll: Poll;
  userWallet: string;
  onVote: (pollId: string, optionId: string) => void;
  isMine: boolean;
}

export function PollDisplay({ poll, userWallet, onVote, isMine }: PollDisplayProps) {
  const hasVoted = poll.options.some((o) => o.voters?.includes(userWallet));
  const isEnded = poll.status === "ended";
  const showResults = poll.showResults === "always" || hasVoted || isEnded;

  return (
    <div className={cn(
      "rounded-xl p-4 min-w-[280px] max-w-[360px]",
      isMine ? "bg-primary/10" : "bg-muted"
    )}>
      <div className="flex items-center gap-2 mb-3">
        <BarChart3 className="h-4 w-4 text-primary" />
        <span className="font-medium text-sm">{poll.question}</span>
      </div>

      <div className="space-y-2">
        {poll.options.map((option) => {
          const percentage = poll.totalVotes > 0 ? (option.votes / poll.totalVotes) * 100 : 0;
          const isSelected = option.voters?.includes(userWallet);

          return (
            <button
              key={option.id}
              className={cn(
                "w-full relative rounded-lg overflow-hidden border transition-colors",
                !hasVoted && !isEnded ? "hover:border-primary cursor-pointer" : "cursor-default",
                isSelected ? "border-primary" : "border-transparent"
              )}
              onClick={() => !hasVoted && !isEnded && onVote(poll.id, option.id)}
              disabled={hasVoted || isEnded}
            >
              {/* Progress bar */}
              {showResults && (
                <div
                  className={cn(
                    "absolute inset-0 transition-all",
                    isSelected ? "bg-primary/20" : "bg-muted-foreground/10"
                  )}
                  style={{ width: `${percentage}%` }}
                />
              )}
              <div className="relative flex items-center justify-between px-3 py-2">
                <div className="flex items-center gap-2">
                  {isSelected && <Check className="h-4 w-4 text-primary" />}
                  <span className="text-sm">{option.text}</span>
                </div>
                {showResults && (
                  <span className="text-xs font-medium">{Math.round(percentage)}%</span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      <div className="flex items-center justify-between mt-3 text-xs text-muted-foreground">
        <span>{poll.totalVotes} vote{poll.totalVotes !== 1 ? "s" : ""}</span>
        <span>
          {isEnded ? "Poll ended" : poll.type === "multiple" ? "Multiple choice" : "Single choice"}
        </span>
      </div>
    </div>
  );
}

// ============================================================================
// 7. STORY / STATUS BAR
// ============================================================================

interface StoryBarProps {
  stories: ChatStory[];
  myStory: ChatStory | null;
  onViewStory: (story: ChatStory) => void;
  onCreateStory: () => void;
}

export function StoryBar({ stories, myStory, onViewStory, onCreateStory }: StoryBarProps) {
  if (stories.length === 0 && !myStory) return null;

  return (
    <div className="border-b px-4 py-3">
      <ScrollArea>
        <div className="flex gap-3">
          {/* My Story */}
          <button
            className="flex flex-col items-center gap-1 shrink-0"
            onClick={onCreateStory}
          >
            <div className="relative">
              <Avatar className="h-14 w-14 ring-2 ring-dashed ring-primary/30">
                <AvatarFallback className="text-sm">ME</AvatarFallback>
              </Avatar>
              <div className="absolute -bottom-1 -right-1 h-5 w-5 rounded-full bg-primary flex items-center justify-center">
                <Plus className="h-3 w-3 text-primary-foreground" />
              </div>
            </div>
            <span className="text-[10px] text-muted-foreground">Your Story</span>
          </button>

          {/* Other stories */}
          {stories.map((story) => (
            <button
              key={story.id}
              className="flex flex-col items-center gap-1 shrink-0"
              onClick={() => onViewStory(story)}
            >
              <Avatar className={cn(
                "h-14 w-14 ring-2",
                story.viewers.some((v) => v.walletAddress === "TODO") // Check if viewed
                  ? "ring-muted-foreground/30"
                  : "ring-primary"
              )}>
                <AvatarImage src={story.authorAvatar} />
                <AvatarFallback className="text-sm">
                  {(story.authorName || "?").slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <span className="text-[10px] text-muted-foreground truncate max-w-14">
                {story.authorName || "User"}
              </span>
            </button>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

// ============================================================================
// 8. STORY VIEWER
// ============================================================================

interface StoryViewerProps {
  story: ChatStory;
  onClose: () => void;
  onReact: (emoji: string) => void;
  onReply: (text: string) => void;
}

export function StoryViewer({ story, onClose, onReact, onReply }: StoryViewerProps) {
  const [replyText, setReplyText] = useState("");
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setProgress((p) => {
        if (p >= 100) {
          onClose();
          return 100;
        }
        return p + 0.5; // ~20 seconds per story
      });
    }, 100);
    return () => clearInterval(timer);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 bg-black flex items-center justify-center">
      {/* Progress bar */}
      <div className="absolute top-0 left-0 right-0 p-2 z-10">
        <div className="h-0.5 bg-white/20 rounded-full overflow-hidden">
          <div
            className="h-full bg-white rounded-full transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Header */}
      <div className="absolute top-4 left-4 right-4 flex items-center gap-3 z-10">
        <Avatar className="h-10 w-10 ring-2 ring-white/20">
          <AvatarImage src={story.authorAvatar} />
          <AvatarFallback>{(story.authorName || "?").slice(0, 2)}</AvatarFallback>
        </Avatar>
        <div className="flex-1">
          <p className="text-white font-medium text-sm">{story.authorName}</p>
          <p className="text-white/60 text-xs">
            {new Date(story.createdAt).toLocaleTimeString()}
          </p>
        </div>
        <Button variant="ghost" size="icon" className="text-white" onClick={onClose}>
          <X className="h-5 w-5" />
        </Button>
      </div>

      {/* Content */}
      <div className="max-w-lg w-full flex items-center justify-center" onClick={onClose}>
        {story.type === "text" && (
          <div
            className="p-8 rounded-xl text-center w-full"
            style={{ backgroundColor: story.content.backgroundColor || "#1a1a2e" }}
          >
            <p className="text-white text-2xl font-bold">{story.content.text}</p>
          </div>
        )}
        {(story.type === "image" || story.type === "video") && story.content.mediaCid && (
          <div className="max-h-[80vh]">
            <p className="text-white text-center">📷 Media Story</p>
          </div>
        )}
      </div>

      {/* Reactions & Reply */}
      <div className="absolute bottom-4 left-4 right-4 z-10">
        <div className="flex items-center gap-2">
          {/* Quick reactions */}
          <div className="flex gap-1">
            {["❤️", "🔥", "👏", "😂", "😮", "😢"].map((emoji) => (
              <button
                key={emoji}
                className="h-10 w-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors text-lg"
                onClick={() => onReact(emoji)}
              >
                {emoji}
              </button>
            ))}
          </div>

          <div className="flex-1" />

          {/* Reply input */}
          {story.allowReplies && (
            <div className="flex gap-1 flex-1 max-w-xs">
              <Input
                placeholder="Reply..."
                className="h-10 bg-white/10 border-white/20 text-white placeholder:text-white/40"
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && replyText.trim()) {
                    onReply(replyText);
                    setReplyText("");
                  }
                }}
              />
              {replyText && (
                <Button size="icon" className="h-10 w-10" onClick={() => { onReply(replyText); setReplyText(""); }}>
                  <Send className="h-4 w-4" />
                </Button>
              )}
            </div>
          )}
        </div>

        {/* View count */}
        <div className="flex items-center justify-center gap-2 mt-2">
          <Eye className="h-3 w-3 text-white/40" />
          <span className="text-[10px] text-white/40">{story.viewCount} views</span>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// 9. PAYMENT REQUEST / TIP CARD
// ============================================================================

interface PaymentCardProps {
  payment: ChatPayment;
  isMine: boolean;
  onPay: (paymentId: string) => void;
}

export function PaymentCard({ payment, isMine }: PaymentCardProps) {
  const isRequest = payment.type === "request";
  const isPending = payment.status === "pending";

  return (
    <div className={cn(
      "rounded-xl p-4 min-w-[250px] max-w-[320px] border",
      isRequest ? "bg-yellow-500/5 border-yellow-500/20" : "bg-green-500/5 border-green-500/20"
    )}>
      <div className="flex items-center gap-2 mb-2">
        <CircleDollarSign className={cn(
          "h-5 w-5",
          isRequest ? "text-yellow-500" : "text-green-500"
        )} />
        <span className="font-medium text-sm">
          {isRequest ? "Payment Request" : payment.type === "tip" ? "Tip" : "Payment"}
        </span>
      </div>

      <div className="text-center py-3">
        <p className="text-3xl font-bold">
          {payment.amount} {payment.currency}
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          on {payment.chain}
        </p>
        {payment.memo && (
          <p className="text-sm text-muted-foreground mt-2 italic">
            "{payment.memo}"
          </p>
        )}
      </div>

      <div className="flex items-center justify-between mt-2">
        <Badge variant={
          payment.status === "confirmed" ? "default" :
          payment.status === "failed" ? "destructive" : "secondary"
        }>
          {payment.status}
        </Badge>
        {payment.txHash && (
          <a
            href={`https://explorer.com/tx/${payment.txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-primary hover:underline"
          >
            View tx ↗
          </a>
        )}
      </div>

      {isRequest && isPending && !isMine && (
        <Button className="w-full mt-3" size="sm">
          Pay {payment.requestedAmount || payment.amount} {payment.requestedCurrency || payment.currency}
        </Button>
      )}
    </div>
  );
}

// ============================================================================
// 10. PINNED MESSAGES PANEL
// ============================================================================

interface PinnedMessagesPanelProps {
  messages: Array<{ message: ChatMessage; decryptedContent?: string }>;
  onJumpToMessage: (messageId: string) => void;
  onUnpin: (messageId: string) => void;
  onClose: () => void;
}

export function PinnedMessagesPanel({
  messages,
  onJumpToMessage,
  onUnpin,
  onClose,
}: PinnedMessagesPanelProps) {
  return (
    <div className="flex flex-col h-full border-l w-80">
      <div className="p-3 border-b flex items-center justify-between">
        <h3 className="font-semibold text-sm flex items-center gap-2">
          <Pin className="h-4 w-4" />
          Pinned Messages ({messages.length})
        </h3>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-2 space-y-2">
          {messages.map(({ message, decryptedContent }) => (
            <Card key={message.id} className="bg-muted/30">
              <CardContent className="p-3">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Avatar className="h-5 w-5">
                        <AvatarFallback className="text-[8px]">
                          {message.sender.slice(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <span className="text-xs font-medium">
                        {message.sender.slice(0, 8)}...
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        {new Date(message.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                    {decryptedContent ? (
                      <p className="text-sm line-clamp-3">{decryptedContent}</p>
                    ) : (
                      <p className="text-sm text-muted-foreground italic">🔒 Encrypted</p>
                    )}
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0">
                        <MoreVertical className="h-3 w-3" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      <DropdownMenuItem onClick={() => onJumpToMessage(message.id)}>
                        Jump to message
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => onUnpin(message.id)}>
                        Unpin
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </CardContent>
            </Card>
          ))}
          {messages.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              <Pin className="h-8 w-8 mx-auto mb-2 opacity-30" />
              <p className="text-xs">No pinned messages</p>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

// ============================================================================
// 11. RICH LINK PREVIEW
// ============================================================================

interface LinkPreviewCardProps {
  preview: LinkPreview;
}

export function LinkPreviewCard({ preview }: LinkPreviewCardProps) {
  return (
    <a
      href={preview.url}
      target="_blank"
      rel="noopener noreferrer"
      className="block rounded-lg border overflow-hidden hover:bg-muted/50 transition-colors mt-1 max-w-sm"
    >
      {preview.image && (
        <div className="h-32 bg-muted overflow-hidden">
          <img
            src={preview.image}
            alt=""
            className="w-full h-full object-cover"
          />
        </div>
      )}
      <div className="p-3">
        <div className="flex items-center gap-1.5 mb-1">
          {preview.favicon && (
            <img src={preview.favicon} alt="" className="h-4 w-4 rounded" />
          )}
          <span className="text-[10px] text-muted-foreground">
            {preview.siteName || new URL(preview.url).hostname}
          </span>
        </div>
        {preview.title && (
          <p className="text-sm font-medium line-clamp-2 text-primary">{preview.title}</p>
        )}
        {preview.description && (
          <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{preview.description}</p>
        )}
      </div>
    </a>
  );
}

// ============================================================================
// 12. NOTIFICATION CENTER
// ============================================================================

interface NotificationCenterProps {
  notifications: SmartNotification[];
  onMarkRead: (id: string) => void;
  onAction: (notificationId: string, actionId: string) => void;
  onClose: () => void;
}

export function NotificationCenter({
  notifications,
  onMarkRead,
  onAction,
  onClose,
}: NotificationCenterProps) {
  const unread = notifications.filter((n) => !n.isRead);
  const read = notifications.filter((n) => n.isRead);

  return (
    <div className="flex flex-col h-full border-l w-80">
      <div className="p-3 border-b flex items-center justify-between">
        <h3 className="font-semibold text-sm flex items-center gap-2">
          🔔 Notifications
          {unread.length > 0 && (
            <Badge variant="destructive" className="text-xs">{unread.length}</Badge>
          )}
        </h3>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          {unread.map((notif) => (
            <Card key={notif.id} className="bg-primary/5 border-primary/20">
              <CardContent className="p-2">
                <div className="flex items-start gap-2">
                  {notif.icon && <span className="text-lg shrink-0">{notif.icon}</span>}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{notif.title}</p>
                    <p className="text-xs text-muted-foreground line-clamp-2">{notif.body}</p>
                    {notif.aiSummary && (
                      <p className="text-[10px] text-primary mt-0.5">
                        <Sparkles className="h-3 w-3 inline mr-0.5" />
                        {notif.aiSummary}
                      </p>
                    )}
                    <div className="flex gap-1 mt-1.5">
                      {notif.actions?.map((action) => (
                        <Button
                          key={action.id}
                          variant="outline"
                          size="sm"
                          className="h-6 text-[10px] px-2"
                          onClick={() => onAction(notif.id, action.id)}
                        >
                          {action.label}
                        </Button>
                      ))}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5 shrink-0"
                    onClick={() => onMarkRead(notif.id)}
                  >
                    <Check className="h-3 w-3" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}

          {read.length > 0 && (
            <>
              <Separator className="my-2" />
              <p className="text-xs text-muted-foreground px-2">Earlier</p>
              {read.slice(0, 20).map((notif) => (
                <div key={notif.id} className="p-2 rounded-md opacity-60">
                  <p className="text-xs">{notif.title}</p>
                  <p className="text-[10px] text-muted-foreground">{notif.body}</p>
                </div>
              ))}
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

// ============================================================================
// 13. MESSAGE CONTEXT MENU (Right-click actions)
// ============================================================================

interface MessageContextMenuProps {
  children: React.ReactNode;
  onReply: () => void;
  onForward: () => void;
  onPin: () => void;
  onBookmark: () => void;
  onCopy: () => void;
  onDelete: () => void;
  onThread: () => void;
  isPinned: boolean;
  isBookmarked: boolean;
  isMine: boolean;
}

export function MessageActions({
  onReply,
  onForward,
  onPin,
  onBookmark,
  onCopy,
  onDelete,
  onThread,
  isPinned,
  isBookmarked,
  isMine,
}: Omit<MessageContextMenuProps, "children">) {
  return (
    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onReply}>
              <Reply className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Reply</TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onThread}>
              <Hash className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Start Thread</TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onBookmark}>
              {isBookmarked ? (
                <BookmarkCheck className="h-3.5 w-3.5 text-primary" />
              ) : (
                <Bookmark className="h-3.5 w-3.5" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{isBookmarked ? "Unsave" : "Save"}</TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-7 w-7">
            <MoreVertical className="h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={onForward}>
            <Forward className="h-4 w-4 mr-2" />
            Forward
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onPin}>
            <Pin className="h-4 w-4 mr-2" />
            {isPinned ? "Unpin" : "Pin"}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onCopy}>
            <Copy className="h-4 w-4 mr-2" />
            Copy
          </DropdownMenuItem>
          {isMine && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onDelete} className="text-red-500">
                <Trash2 className="h-4 w-4 mr-2" />
                Delete
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
