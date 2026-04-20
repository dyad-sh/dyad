/**
 * Channel & Community Components
 * Discord/Slack-style channels, categories, threads, and community management
 */

import { useState, useCallback, useMemo } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
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
  DropdownMenuLabel,
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
  Hash,
  Volume2,
  Megaphone,
  MessageSquare,
  ImageIcon,
  Bot,
  Rss,
  Plus,
  Settings,
  Lock,
  Globe,
  ChevronDown,
  ChevronRight,
  Users,
  Crown,
  Shield,
  Star,
  MoreVertical,
  Edit,
  Trash2,
  Archive,
  Pin,
  Bell,
  BellOff,
  Eye,
  EyeOff,
  Search,
  UserPlus,
  Copy,
  ExternalLink,
  Sparkles,
  Mic,
  Video,
  Layout,
  Layers,
  Palette,
  Zap,
} from "lucide-react";
import type {
  ChatChannel,
  ChannelType,
  ChannelCategory,
  CommunitySpace,
  CommunityRole,
  CommunityMember,
  CommunityCategory,
  CreateChannelRequest,
} from "@/types/p2p_chat_extensions";

// ============================================================================
// Channel Type Icons
// ============================================================================

const channelTypeIcons: Record<ChannelType, React.ReactNode> = {
  text: <Hash className="h-4 w-4" />,
  voice: <Volume2 className="h-4 w-4" />,
  stage: <Mic className="h-4 w-4" />,
  announcement: <Megaphone className="h-4 w-4" />,
  forum: <MessageSquare className="h-4 w-4" />,
  media: <ImageIcon className="h-4 w-4" />,
  bot: <Bot className="h-4 w-4" />,
  feed: <Rss className="h-4 w-4" />,
};

const channelTypeLabels: Record<ChannelType, string> = {
  text: "Text Channel",
  voice: "Voice Channel",
  stage: "Stage Channel",
  announcement: "Announcement",
  forum: "Forum",
  media: "Media Gallery",
  bot: "Bot Channel",
  feed: "Feed",
};

// ============================================================================
// Create Channel Dialog
// ============================================================================

interface CreateChannelDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  communityId: string;
  categories: ChannelCategory[];
  onCreateChannel: (request: CreateChannelRequest) => void;
}

export function CreateChannelDialog({
  open,
  onOpenChange,
  communityId,
  categories,
  onCreateChannel,
}: CreateChannelDialogProps) {
  const [name, setName] = useState("");
  const [type, setType] = useState<ChannelType>("text");
  const [topic, setTopic] = useState("");
  const [categoryId, setCategoryId] = useState<string>("");
  const [isPrivate, setIsPrivate] = useState(false);

  const handleCreate = () => {
    if (!name.trim()) return;
    onCreateChannel({
      communityId,
      categoryId: categoryId || undefined,
      name: name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, ""),
      type,
      topic: topic || undefined,
      isPrivate,
    });
    setName("");
    setType("text");
    setTopic("");
    setCategoryId("");
    setIsPrivate(false);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="h-5 w-5" />
            Create Channel
          </DialogTitle>
          <DialogDescription>
            Add a new channel to your community
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Channel Type */}
          <div className="space-y-2">
            <Label>Channel Type</Label>
            <div className="grid grid-cols-4 gap-2">
              {(Object.keys(channelTypeIcons) as ChannelType[]).map((ct) => (
                <Button
                  key={ct}
                  variant={type === ct ? "default" : "outline"}
                  size="sm"
                  className="flex flex-col h-auto py-3 gap-1"
                  onClick={() => setType(ct)}
                >
                  {channelTypeIcons[ct]}
                  <span className="text-xs">{ct}</span>
                </Button>
              ))}
            </div>
          </div>

          {/* Name */}
          <div className="space-y-2">
            <Label htmlFor="channel-name">Channel Name</Label>
            <div className="flex items-center gap-2">
              {channelTypeIcons[type]}
              <Input
                id="channel-name"
                placeholder="general"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Will be shown as: #{name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "") || "channel-name"}
            </p>
          </div>

          {/* Topic */}
          <div className="space-y-2">
            <Label htmlFor="channel-topic">Topic (Optional)</Label>
            <Input
              id="channel-topic"
              placeholder="What's this channel about?"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
            />
          </div>

          {/* Category */}
          {categories.length > 0 && (
            <div className="space-y-2">
              <Label>Category</Label>
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger>
                  <SelectValue placeholder="None (top-level)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">None</SelectItem>
                  {categories.map((cat) => (
                    <SelectItem key={cat.id} value={cat.id}>
                      {cat.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Private toggle */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Private Channel</Label>
              <p className="text-xs text-muted-foreground">
                Only selected members and roles can view this channel
              </p>
            </div>
            <Switch checked={isPrivate} onCheckedChange={setIsPrivate} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={!name.trim()}>
            Create Channel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// Channel Sidebar Item
// ============================================================================

interface ChannelItemProps {
  channel: ChatChannel;
  isSelected: boolean;
  onClick: () => void;
}

export function ChannelItem({ channel, isSelected, onClick }: ChannelItemProps) {
  return (
    <button
      className={cn(
        "w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors",
        isSelected
          ? "bg-primary/10 text-primary font-medium"
          : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
      )}
      onClick={onClick}
    >
      <span className="opacity-70">{channelTypeIcons[channel.type]}</span>
      <span className="truncate flex-1 text-left">{channel.name}</span>
      {channel.isPrivate && <Lock className="h-3 w-3 opacity-50" />}
      {channel.unreadCount > 0 && (
        <Badge variant="destructive" className="h-5 min-w-5 px-1 text-xs">
          {channel.unreadCount > 99 ? "99+" : channel.unreadCount}
        </Badge>
      )}
      {channel.mentionCount > 0 && (
        <Badge className="h-5 min-w-5 px-1 text-xs bg-red-500">
          @{channel.mentionCount}
        </Badge>
      )}
    </button>
  );
}

// ============================================================================
// Category Collapse Group
// ============================================================================

interface CategoryGroupProps {
  category: ChannelCategory;
  channels: ChatChannel[];
  selectedChannelId: string | null;
  onSelectChannel: (id: string) => void;
  onCreateChannel: () => void;
}

export function CategoryGroup({
  category,
  channels,
  selectedChannelId,
  onSelectChannel,
  onCreateChannel,
}: CategoryGroupProps) {
  const [isCollapsed, setIsCollapsed] = useState(category.isCollapsed);

  return (
    <div className="mb-2">
      <div
        className="flex items-center gap-1 px-1 py-1 group cursor-pointer hover:text-foreground text-muted-foreground"
        onClick={() => setIsCollapsed(!isCollapsed)}
      >
        {isCollapsed ? (
          <ChevronRight className="h-3 w-3" />
        ) : (
          <ChevronDown className="h-3 w-3" />
        )}
        <span className="text-xs font-semibold uppercase tracking-wider flex-1">
          {category.name}
        </span>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 opacity-0 group-hover:opacity-100"
                onClick={(e) => {
                  e.stopPropagation();
                  onCreateChannel();
                }}
              >
                <Plus className="h-3 w-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Create Channel</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
      {!isCollapsed && (
        <div className="space-y-0.5 ml-1">
          {channels.map((channel) => (
            <ChannelItem
              key={channel.id}
              channel={channel}
              isSelected={selectedChannelId === channel.id}
              onClick={() => onSelectChannel(channel.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Community Sidebar (Channel List + Categories)
// ============================================================================

interface CommunitySidebarProps {
  community: CommunitySpace;
  selectedChannelId: string | null;
  onSelectChannel: (id: string) => void;
  onCreateChannel: () => void;
  onOpenSettings: () => void;
}

export function CommunitySidebar({
  community,
  selectedChannelId,
  onSelectChannel,
  onCreateChannel,
  onOpenSettings,
}: CommunitySidebarProps) {
  const [searchQuery, setSearchQuery] = useState("");

  // Group channels by category
  const categorizedChannels = useMemo(() => {
    const catMap = new Map<string, ChatChannel[]>();
    const uncategorized: ChatChannel[] = [];

    for (const channel of community.channels) {
      if (searchQuery && !channel.name.includes(searchQuery.toLowerCase())) continue;
      if (channel.categoryId) {
        const existing = catMap.get(channel.categoryId) || [];
        existing.push(channel);
        catMap.set(channel.categoryId, existing);
      } else {
        uncategorized.push(channel);
      }
    }

    return { catMap, uncategorized };
  }, [community.channels, searchQuery]);

  return (
    <div className="w-60 border-r flex flex-col bg-muted/20">
      {/* Community Header */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="flex items-center justify-between px-4 py-3 border-b hover:bg-muted/50 transition-colors">
            <div className="flex items-center gap-2 min-w-0">
              <Avatar className="h-8 w-8">
                <AvatarImage src={community.avatar} />
                <AvatarFallback className="bg-primary/20 text-primary text-xs font-bold">
                  {community.name.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <p className="font-semibold text-sm truncate">{community.name}</p>
                <p className="text-xs text-muted-foreground">
                  {community.onlineCount} online • {community.memberCount} members
                </p>
              </div>
            </div>
            <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuLabel>Community</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem>
            <UserPlus className="h-4 w-4 mr-2" />
            Invite People
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onOpenSettings}>
            <Settings className="h-4 w-4 mr-2" />
            Community Settings
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onCreateChannel}>
            <Plus className="h-4 w-4 mr-2" />
            Create Channel
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem>
            <Bell className="h-4 w-4 mr-2" />
            Notification Settings
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Search */}
      <div className="p-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search channels..."
            className="h-8 pl-8 text-xs"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Channel List */}
      <ScrollArea className="flex-1 px-2">
        {/* Uncategorized channels */}
        {categorizedChannels.uncategorized.length > 0 && (
          <div className="mb-2 space-y-0.5">
            {categorizedChannels.uncategorized.map((channel) => (
              <ChannelItem
                key={channel.id}
                channel={channel}
                isSelected={selectedChannelId === channel.id}
                onClick={() => onSelectChannel(channel.id)}
              />
            ))}
          </div>
        )}

        {/* Categorized channels */}
        {community.categories
          .sort((a, b) => a.position - b.position)
          .map((category) => {
            const channels = categorizedChannels.catMap.get(category.id) || [];
            if (channels.length === 0 && searchQuery) return null;
            return (
              <CategoryGroup
                key={category.id}
                category={category}
                channels={channels}
                selectedChannelId={selectedChannelId}
                onSelectChannel={onSelectChannel}
                onCreateChannel={onCreateChannel}
              />
            );
          })}
      </ScrollArea>

      {/* User Card at bottom */}
      <div className="border-t p-2">
        <div className="flex items-center gap-2">
          <Avatar className="h-8 w-8">
            <AvatarFallback className="text-xs">ME</AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium truncate">Your Name</p>
            <p className="text-[10px] text-muted-foreground">Online</p>
          </div>
          <Button variant="ghost" size="icon" className="h-7 w-7">
            <Settings className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Thread List Panel
// ============================================================================

import type { ChatThread } from "@/types/p2p_chat_extensions";

interface ThreadListProps {
  threads: ChatThread[];
  selectedThreadId: string | null;
  onSelectThread: (threadId: string) => void;
  onCreateThread: () => void;
}

export function ThreadListPanel({
  threads,
  selectedThreadId,
  onSelectThread,
  onCreateThread,
}: ThreadListProps) {
  const activeThreads = threads.filter((t) => !t.isArchived);
  const archivedThreads = threads.filter((t) => t.isArchived);

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b flex items-center justify-between">
        <h3 className="font-semibold text-sm">Threads</h3>
        <Button size="sm" variant="ghost" onClick={onCreateThread}>
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          {activeThreads.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              <MessageSquare className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p className="text-xs">No active threads</p>
            </div>
          )}

          {activeThreads.map((thread) => (
            <button
              key={thread.id}
              className={cn(
                "w-full text-left p-2 rounded-md transition-colors",
                selectedThreadId === thread.id
                  ? "bg-primary/10"
                  : "hover:bg-muted/50"
              )}
              onClick={() => onSelectThread(thread.id)}
            >
              <div className="flex items-center gap-2">
                <MessageSquare className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="text-sm font-medium truncate flex-1">
                  {thread.name || `Thread`}
                </span>
                {thread.unreadCount > 0 && (
                  <Badge variant="destructive" className="h-5 min-w-5 px-1 text-xs">
                    {thread.unreadCount}
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-2 mt-1 ml-6">
                <span className="text-xs text-muted-foreground">
                  {thread.messageCount} messages
                </span>
                <span className="text-xs text-muted-foreground">•</span>
                <span className="text-xs text-muted-foreground">
                  {thread.participantWallets.length} participants
                </span>
              </div>
              {thread.lastMessagePreview && (
                <p className="text-xs text-muted-foreground truncate mt-1 ml-6">
                  {thread.lastMessagePreview}
                </p>
              )}
            </button>
          ))}

          {archivedThreads.length > 0 && (
            <>
              <Separator className="my-2" />
              <p className="text-xs text-muted-foreground px-2 py-1 font-medium">
                Archived ({archivedThreads.length})
              </p>
              {archivedThreads.slice(0, 5).map((thread) => (
                <button
                  key={thread.id}
                  className="w-full text-left p-2 rounded-md hover:bg-muted/50 opacity-60"
                  onClick={() => onSelectThread(thread.id)}
                >
                  <div className="flex items-center gap-2">
                    <Archive className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm truncate">{thread.name || "Thread"}</span>
                  </div>
                </button>
              ))}
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

// ============================================================================
// Community Settings Dialog
// ============================================================================

interface CommunitySettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  community: CommunitySpace;
  onSave: (updates: Partial<CommunitySpace>) => void;
}

export function CommunitySettingsDialog({
  open,
  onOpenChange,
  community,
  onSave,
}: CommunitySettingsDialogProps) {
  const [tab, setTab] = useState("overview");
  const [name, setName] = useState(community.name);
  const [description, setDescription] = useState(community.description || "");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle>Community Settings</DialogTitle>
        </DialogHeader>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="grid w-full grid-cols-5">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="roles">Roles</TabsTrigger>
            <TabsTrigger value="moderation">Moderation</TabsTrigger>
            <TabsTrigger value="bots">Bots</TabsTrigger>
            <TabsTrigger value="gating">Access</TabsTrigger>
          </TabsList>

          <ScrollArea className="h-[50vh] mt-4">
            <TabsContent value="overview" className="space-y-4">
              <div className="space-y-2">
                <Label>Community Name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Description</Label>
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={4}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Card>
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Users className="h-4 w-4" />
                      <span className="text-sm font-medium">Members</span>
                    </div>
                    <p className="text-2xl font-bold">{community.memberCount}</p>
                    <p className="text-xs text-muted-foreground">
                      {community.onlineCount} online
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Hash className="h-4 w-4" />
                      <span className="text-sm font-medium">Channels</span>
                    </div>
                    <p className="text-2xl font-bold">{community.channels.length}</p>
                    <p className="text-xs text-muted-foreground">
                      {community.categories.length} categories
                    </p>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            <TabsContent value="roles" className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-medium">Roles</h3>
                <Button size="sm">
                  <Plus className="h-4 w-4 mr-1" />
                  Create Role
                </Button>
              </div>
              {community.roles.map((role) => (
                <Card key={role.id}>
                  <CardContent className="p-3 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div
                        className="h-4 w-4 rounded-full"
                        style={{ backgroundColor: role.color || "#888" }}
                      />
                      <div>
                        <p className="font-medium text-sm flex items-center gap-1">
                          {role.name}
                          {role.isDefault && (
                            <Badge variant="secondary" className="text-[10px]">Default</Badge>
                          )}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {role.memberCount} members
                        </p>
                      </div>
                    </div>
                    <Button variant="ghost" size="icon" className="h-8 w-8">
                      <Edit className="h-4 w-4" />
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </TabsContent>

            <TabsContent value="moderation" className="space-y-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">Auto-Moderation</CardTitle>
                  <CardDescription className="text-xs">
                    AI-powered moderation to keep your community safe
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {[
                    { label: "Spam Detection", desc: "AI detects and removes spam" },
                    { label: "Profanity Filter", desc: "Block offensive language" },
                    { label: "Link Filtering", desc: "Block suspicious links" },
                    { label: "Scam Detection", desc: "AI identifies scam attempts" },
                    { label: "Raid Protection", desc: "Auto-lockdown on mass joins" },
                    { label: "Toxicity Filter", desc: "AI sentiment-based filtering" },
                  ].map((item) => (
                    <div key={item.label} className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium">{item.label}</p>
                        <p className="text-xs text-muted-foreground">{item.desc}</p>
                      </div>
                      <Switch />
                    </div>
                  ))}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="bots" className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-medium">Installed Bots</h3>
                <Button size="sm">
                  <Plus className="h-4 w-4 mr-1" />
                  Add Bot
                </Button>
              </div>
              {community.installedBots.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Bot className="h-12 w-12 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No bots installed</p>
                  <p className="text-xs">Add AI agents and bots to enhance your community</p>
                </div>
              ) : (
                community.installedBots.map((bot) => (
                  <Card key={bot.id}>
                    <CardContent className="p-3 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Avatar className="h-8 w-8">
                          <AvatarFallback><Bot className="h-4 w-4" /></AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="font-medium text-sm">{bot.botId}</p>
                          <p className="text-xs text-muted-foreground">
                            {bot.interactionCount} interactions
                          </p>
                        </div>
                      </div>
                      <Badge variant={bot.status === "active" ? "default" : "secondary"}>
                        {bot.status}
                      </Badge>
                    </CardContent>
                  </Card>
                ))
              )}
            </TabsContent>

            <TabsContent value="gating" className="space-y-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">NFT Gating</CardTitle>
                  <CardDescription className="text-xs">
                    Require specific NFTs to join or access channels
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">Enable NFT Gating</p>
                      <p className="text-xs text-muted-foreground">
                        Restrict access based on NFT ownership
                      </p>
                    </div>
                    <Switch />
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">Token Gating</CardTitle>
                  <CardDescription className="text-xs">
                    Require minimum token balance to join
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">Enable Token Gating</p>
                      <p className="text-xs text-muted-foreground">
                        Restrict access based on token holdings
                      </p>
                    </div>
                    <Switch />
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </ScrollArea>
        </Tabs>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => onSave({ name, description })}>
            Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// Member List Panel (Right Sidebar)
// ============================================================================

interface MemberListPanelProps {
  members: CommunityMember[];
  roles: CommunityRole[];
  bots: { id: string; name: string; avatar?: string; status: string }[];
}

export function MemberListPanel({ members, roles, bots }: MemberListPanelProps) {
  const membersByRole = useMemo(() => {
    const grouped = new Map<string, CommunityMember[]>();
    const online: CommunityMember[] = [];
    const offline: CommunityMember[] = [];

    for (const member of members) {
      // Simple online/offline grouping
      if (member.lastActiveAt && Date.now() - new Date(member.lastActiveAt).getTime() < 5 * 60 * 1000) {
        online.push(member);
      } else {
        offline.push(member);
      }
    }

    return { online, offline };
  }, [members]);

  return (
    <div className="w-60 border-l flex flex-col bg-muted/10">
      <div className="p-3 border-b">
        <h3 className="font-semibold text-sm">Members</h3>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-2">
          {/* Bots Section */}
          {bots.length > 0 && (
            <div className="mb-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-2 py-1">
                Bots — {bots.length}
              </p>
              {bots.map((bot) => (
                <div key={bot.id} className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted/50">
                  <div className="relative">
                    <Avatar className="h-7 w-7">
                      <AvatarFallback className="text-xs bg-purple-500/20">
                        <Bot className="h-3.5 w-3.5" />
                      </AvatarFallback>
                    </Avatar>
                    <div className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-background bg-green-500" />
                  </div>
                  <span className="text-sm truncate">{bot.name}</span>
                  <Badge variant="secondary" className="text-[10px] ml-auto">BOT</Badge>
                </div>
              ))}
            </div>
          )}

          {/* Online Members */}
          <div className="mb-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-2 py-1">
              Online — {membersByRole.online.length}
            </p>
            {membersByRole.online.map((member) => (
              <div key={member.walletAddress} className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted/50 cursor-pointer">
                <div className="relative">
                  <Avatar className="h-7 w-7">
                    <AvatarImage src={member.avatar} />
                    <AvatarFallback className="text-xs">
                      {(member.nickname || member.displayName || member.walletAddress).slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-background bg-green-500" />
                </div>
                <span className="text-sm truncate">
                  {member.nickname || member.displayName || `${member.walletAddress.slice(0, 6)}...`}
                </span>
                {member.roles.length > 0 && (
                  <div className="flex gap-0.5 ml-auto">
                    {member.roles.slice(0, 2).map((roleId) => {
                      const role = roles.find((r) => r.id === roleId);
                      return role ? (
                        <div
                          key={roleId}
                          className="h-3 w-3 rounded-full"
                          style={{ backgroundColor: role.color || "#888" }}
                          title={role.name}
                        />
                      ) : null;
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Offline Members */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-2 py-1">
              Offline — {membersByRole.offline.length}
            </p>
            {membersByRole.offline.slice(0, 50).map((member) => (
              <div key={member.walletAddress} className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted/50 cursor-pointer opacity-50">
                <Avatar className="h-7 w-7">
                  <AvatarFallback className="text-xs">
                    {(member.nickname || member.displayName || member.walletAddress).slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <span className="text-sm truncate">
                  {member.nickname || member.displayName || `${member.walletAddress.slice(0, 6)}...`}
                </span>
              </div>
            ))}
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}

// ============================================================================
// Create Community Dialog
// ============================================================================

interface CreateCommunityDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (data: {
    name: string;
    description: string;
    category: CommunityCategory;
    isPublic: boolean;
  }) => void;
}

export function CreateCommunityDialog({
  open,
  onOpenChange,
  onCreate,
}: CreateCommunityDialogProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<CommunityCategory>("technology");
  const [isPublic, setIsPublic] = useState(true);

  const categories: { value: CommunityCategory; label: string; icon: React.ReactNode }[] = [
    { value: "technology", label: "Technology", icon: <Zap className="h-4 w-4" /> },
    { value: "gaming", label: "Gaming", icon: <Sparkles className="h-4 w-4" /> },
    { value: "education", label: "Education", icon: <Globe className="h-4 w-4" /> },
    { value: "business", label: "Business", icon: <Layout className="h-4 w-4" /> },
    { value: "defi", label: "DeFi", icon: <Layers className="h-4 w-4" /> },
    { value: "nft", label: "NFT", icon: <Palette className="h-4 w-4" /> },
    { value: "dao", label: "DAO", icon: <Crown className="h-4 w-4" /> },
    { value: "social", label: "Social", icon: <Users className="h-4 w-4" /> },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create Community</DialogTitle>
          <DialogDescription>
            Build a sovereign community with channels, roles, and AI bots
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>Community Name</Label>
            <Input
              placeholder="My Awesome Community"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label>Description</Label>
            <Textarea
              placeholder="What's your community about?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>

          <div className="space-y-2">
            <Label>Category</Label>
            <div className="grid grid-cols-4 gap-2">
              {categories.map((cat) => (
                <Button
                  key={cat.value}
                  variant={category === cat.value ? "default" : "outline"}
                  size="sm"
                  className="flex flex-col h-auto py-2 gap-1"
                  onClick={() => setCategory(cat.value)}
                >
                  {cat.icon}
                  <span className="text-[10px]">{cat.label}</span>
                </Button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label>Public Community</Label>
              <p className="text-xs text-muted-foreground">
                Anyone can discover and join
              </p>
            </div>
            <Switch checked={isPublic} onCheckedChange={setIsPublic} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              onCreate({ name, description, category, isPublic });
              onOpenChange(false);
            }}
            disabled={!name.trim()}
          >
            Create Community
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
