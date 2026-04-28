/**
 * Bot & AI Agent Components
 * First-class bot/agent participation in P2P chat
 * Agents can DM, join groups, respond to commands, process tasks
 */

import { useState, useMemo } from "react";
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
import { Progress } from "@/components/ui/progress";
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
  CardFooter,
} from "@/components/ui/card";
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
  Bot,
  Plus,
  Search,
  Star,
  Download,
  Settings,
  Shield,
  Zap,
  Brain,
  MessageSquare,
  Code,
  Globe,
  Terminal,
  Play,
  Pause,
  RefreshCw,
  Copy,
  ExternalLink,
  Check,
  X,
  Activity,
  Clock,
  Hash,
  Command,
  Sparkles,
  Cpu,
  CircleDollarSign,
  BarChart3,
  Users,
  Eye,
  Loader2,
  AlertCircle,
  ChevronRight,
  Crown,
  Puzzle,
  Gamepad2,
  ShieldCheck,
  Webhook,
  Calendar,
} from "lucide-react";
import type {
  ChatBot,
  BotType,
  BotCategory,
  BotCommand,
  BotTrigger,
  BotInstallation,
  BotInstallConfig,
  BotInteraction,
  BotStatus,
} from "@/types/p2p_chat_extensions";

// ============================================================================
// Bot Type Icons & Labels
// ============================================================================

const botTypeConfig: Record<BotType, { icon: React.ReactNode; label: string; color: string }> = {
  "ai-agent": { icon: <Brain className="h-4 w-4" />, label: "AI Agent", color: "text-purple-500" },
  "task-bot": { icon: <Zap className="h-4 w-4" />, label: "Task Bot", color: "text-blue-500" },
  "notification-bot": { icon: <MessageSquare className="h-4 w-4" />, label: "Notifications", color: "text-green-500" },
  "moderation-bot": { icon: <Shield className="h-4 w-4" />, label: "Moderation", color: "text-red-500" },
  "integration-bot": { icon: <Puzzle className="h-4 w-4" />, label: "Integration", color: "text-orange-500" },
  "game-bot": { icon: <Gamepad2 className="h-4 w-4" />, label: "Game", color: "text-pink-500" },
  "utility-bot": { icon: <Terminal className="h-4 w-4" />, label: "Utility", color: "text-cyan-500" },
  "analytics-bot": { icon: <BarChart3 className="h-4 w-4" />, label: "Analytics", color: "text-yellow-500" },
  "commerce-bot": { icon: <CircleDollarSign className="h-4 w-4" />, label: "Commerce", color: "text-emerald-500" },
  "custom": { icon: <Bot className="h-4 w-4" />, label: "Custom", color: "text-gray-500" },
};

const botStatusConfig: Record<BotStatus, { label: string; color: string; dot: string }> = {
  active: { label: "Active", color: "text-green-500", dot: "bg-green-500" },
  idle: { label: "Idle", color: "text-yellow-500", dot: "bg-yellow-500" },
  processing: { label: "Processing", color: "text-blue-500", dot: "bg-blue-500" },
  error: { label: "Error", color: "text-red-500", dot: "bg-red-500" },
  disabled: { label: "Disabled", color: "text-gray-500", dot: "bg-gray-500" },
  maintenance: { label: "Maintenance", color: "text-orange-500", dot: "bg-orange-500" },
};

// ============================================================================
// Bot Card (for marketplace/browse)
// ============================================================================

interface BotCardProps {
  bot: ChatBot;
  onInstall: (bot: ChatBot) => void;
  onView: (bot: ChatBot) => void;
  isInstalled?: boolean;
}

export function BotCard({ bot, onInstall, onView, isInstalled }: BotCardProps) {
  const typeConfig = botTypeConfig[bot.type];
  const statusCfg = botStatusConfig[bot.status];

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardHeader className="pb-3">
        <div className="flex items-start gap-3">
          <Avatar className="h-12 w-12 ring-2 ring-muted">
            <AvatarImage src={bot.avatar} />
            <AvatarFallback className="bg-purple-500/20">
              <Bot className="h-6 w-6 text-purple-500" />
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <CardTitle className="text-base truncate">{bot.displayName}</CardTitle>
              {bot.isVerified && (
                <ShieldCheck className="h-4 w-4 text-blue-500 shrink-0" />
              )}
              {bot.isOfficial && (
                <Badge variant="secondary" className="text-[10px] shrink-0">Official</Badge>
              )}
            </div>
            <CardDescription className="text-xs mt-0.5 line-clamp-2">
              {bot.description}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pb-3">
        <div className="flex flex-wrap gap-1.5 mb-3">
          <Badge variant="outline" className={cn("text-[10px] gap-1", typeConfig.color)}>
            {typeConfig.icon}
            {typeConfig.label}
          </Badge>
          {bot.tags.slice(0, 3).map((tag) => (
            <Badge key={tag} variant="secondary" className="text-[10px]">
              {tag}
            </Badge>
          ))}
        </div>

        <div className="grid grid-cols-3 gap-2 text-center">
          <div>
            <p className="text-lg font-bold">{bot.commands.length}</p>
            <p className="text-[10px] text-muted-foreground">Commands</p>
          </div>
          <div>
            <p className="text-lg font-bold">
              {bot.installCount > 1000 ? `${(bot.installCount / 1000).toFixed(1)}k` : bot.installCount}
            </p>
            <p className="text-[10px] text-muted-foreground">Installs</p>
          </div>
          <div>
            <div className="flex items-center justify-center gap-0.5">
              <Star className="h-3 w-3 text-yellow-500 fill-yellow-500" />
              <span className="text-lg font-bold">{bot.rating.toFixed(1)}</span>
            </div>
            <p className="text-[10px] text-muted-foreground">{bot.reviewCount} reviews</p>
          </div>
        </div>
      </CardContent>
      <CardFooter className="pt-0 gap-2">
        <Button variant="outline" size="sm" className="flex-1" onClick={() => onView(bot)}>
          <Eye className="h-4 w-4 mr-1" />
          Details
        </Button>
        {isInstalled ? (
          <Button size="sm" className="flex-1" variant="secondary" disabled>
            <Check className="h-4 w-4 mr-1" />
            Installed
          </Button>
        ) : (
          <Button size="sm" className="flex-1" onClick={() => onInstall(bot)}>
            <Download className="h-4 w-4 mr-1" />
            {bot.pricing.model === "free" ? "Install" : `Install (${bot.pricing.price} ${bot.pricing.currency})`}
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}

// ============================================================================
// Bot Detail Dialog
// ============================================================================

interface BotDetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bot: ChatBot | null;
  onInstall: (bot: ChatBot) => void;
  isInstalled?: boolean;
}

export function BotDetailDialog({
  open,
  onOpenChange,
  bot,
  onInstall,
  isInstalled,
}: BotDetailDialogProps) {
  const [tab, setTab] = useState("overview");

  if (!bot) return null;

  const typeConfig = botTypeConfig[bot.type];
  const statusCfg = botStatusConfig[bot.status];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[80vh]">
        <DialogHeader>
          <div className="flex items-start gap-4">
            <Avatar className="h-16 w-16 ring-2 ring-muted">
              <AvatarImage src={bot.avatar} />
              <AvatarFallback className="bg-purple-500/20">
                <Bot className="h-8 w-8 text-purple-500" />
              </AvatarFallback>
            </Avatar>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <DialogTitle className="text-xl">{bot.displayName}</DialogTitle>
                {bot.isVerified && <ShieldCheck className="h-5 w-5 text-blue-500" />}
              </div>
              <p className="text-sm text-muted-foreground mt-1">{bot.description}</p>
              <div className="flex items-center gap-3 mt-2">
                <Badge variant="outline" className={cn("gap-1", typeConfig.color)}>
                  {typeConfig.icon}
                  {typeConfig.label}
                </Badge>
                <div className="flex items-center gap-1">
                  <div className={cn("h-2 w-2 rounded-full", statusCfg.dot)} />
                  <span className={cn("text-xs", statusCfg.color)}>{statusCfg.label}</span>
                </div>
                <span className="text-xs text-muted-foreground">
                  Avg response: {bot.avgResponseMs}ms
                </span>
              </div>
            </div>
          </div>
        </DialogHeader>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="commands">Commands ({bot.commands.length})</TabsTrigger>
            <TabsTrigger value="triggers">Triggers ({bot.triggers.length})</TabsTrigger>
            <TabsTrigger value="permissions">Permissions</TabsTrigger>
          </TabsList>

          <ScrollArea className="h-[40vh] mt-4">
            <TabsContent value="overview" className="space-y-4">
              {/* Stats */}
              <div className="grid grid-cols-4 gap-3">
                {[
                  { label: "Installs", value: bot.installCount, icon: <Download className="h-4 w-4" /> },
                  { label: "Rating", value: `${bot.rating.toFixed(1)} â˜…`, icon: <Star className="h-4 w-4" /> },
                  { label: "Uptime", value: `${bot.uptime}%`, icon: <Activity className="h-4 w-4" /> },
                  { label: "Interactions", value: bot.totalInteractions, icon: <MessageSquare className="h-4 w-4" /> },
                ].map((stat) => (
                  <Card key={stat.label}>
                    <CardContent className="p-3 text-center">
                      <div className="text-muted-foreground mb-1">{stat.icon}</div>
                      <p className="text-lg font-bold">{stat.value}</p>
                      <p className="text-[10px] text-muted-foreground">{stat.label}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>

              {/* Capabilities */}
              <div>
                <h4 className="font-medium text-sm mb-2">Capabilities</h4>
                <div className="flex flex-wrap gap-1.5">
                  {bot.capabilities.map((cap) => (
                    <Badge key={cap.id} variant={cap.enabled ? "default" : "secondary"} className="text-xs">
                      {cap.name}
                    </Badge>
                  ))}
                </div>
              </div>

              {/* AI Config */}
              {bot.aiConfig && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Brain className="h-4 w-4" />
                      AI Configuration
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div>
                        <span className="text-muted-foreground">Model:</span>{" "}
                        <span className="font-mono text-xs">{bot.aiConfig.modelId}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Temperature:</span>{" "}
                        {bot.aiConfig.temperature}
                      </div>
                      <div>
                        <span className="text-muted-foreground">Max Tokens:</span>{" "}
                        {bot.aiConfig.maxTokens}
                      </div>
                      <div>
                        <span className="text-muted-foreground">Context Window:</span>{" "}
                        {bot.aiConfig.contextWindow} messages
                      </div>
                    </div>
                    {bot.aiConfig.ragEnabled && (
                      <Badge variant="outline" className="text-xs">
                        <Sparkles className="h-3 w-3 mr-1" />
                        RAG Enabled
                      </Badge>
                    )}
                    {bot.aiConfig.personalityTraits && (
                      <div className="flex flex-wrap gap-1">
                        {bot.aiConfig.personalityTraits.map((trait) => (
                          <Badge key={trait} variant="secondary" className="text-[10px]">
                            {trait}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Languages */}
              <div>
                <h4 className="font-medium text-sm mb-2">Supported Languages</h4>
                <div className="flex flex-wrap gap-1">
                  {bot.supportedLanguages.map((lang) => (
                    <Badge key={lang} variant="outline" className="text-xs">
                      {lang}
                    </Badge>
                  ))}
                </div>
              </div>
            </TabsContent>

            <TabsContent value="commands" className="space-y-3">
              {bot.commands.map((cmd) => (
                <Card key={cmd.id}>
                  <CardContent className="p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <Command className="h-4 w-4 text-primary" />
                      <code className="text-sm font-bold text-primary">{cmd.command}</code>
                      {cmd.aliases && cmd.aliases.length > 0 && (
                        <span className="text-xs text-muted-foreground">
                          ({cmd.aliases.join(", ")})
                        </span>
                      )}
                      {cmd.cooldownMs && (
                        <Badge variant="outline" className="text-[10px] ml-auto">
                          <Clock className="h-3 w-3 mr-1" />
                          {(cmd.cooldownMs / 1000)}s cooldown
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">{cmd.description}</p>
                    <p className="text-xs font-mono text-muted-foreground mt-1">
                      Usage: {cmd.usage}
                    </p>
                    {cmd.parameters.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {cmd.parameters.map((param) => (
                          <div key={param.name} className="flex items-center gap-2 text-xs">
                            <code className="text-primary">{param.name}</code>
                            <Badge variant="secondary" className="text-[10px]">{param.type}</Badge>
                            {param.required && (
                              <Badge variant="destructive" className="text-[10px]">Required</Badge>
                            )}
                            <span className="text-muted-foreground">{param.description}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {cmd.examples && (
                      <div className="mt-2 space-y-0.5">
                        {cmd.examples.map((ex, i) => (
                          <p key={i} className="text-xs font-mono text-muted-foreground bg-muted/50 px-2 py-0.5 rounded">
                            {ex}
                          </p>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </TabsContent>

            <TabsContent value="triggers" className="space-y-3">
              {bot.triggers.map((trigger) => (
                <Card key={trigger.id}>
                  <CardContent className="p-3">
                    <div className="flex items-center gap-2">
                      <Zap className={cn("h-4 w-4", trigger.enabled ? "text-yellow-500" : "text-muted-foreground")} />
                      <span className="font-medium text-sm">{trigger.description}</span>
                      <Badge variant={trigger.enabled ? "default" : "secondary"} className="text-[10px] ml-auto">
                        {trigger.type}
                      </Badge>
                    </div>
                    {trigger.pattern && (
                      <p className="text-xs font-mono text-muted-foreground mt-1">
                        Pattern: {trigger.pattern}
                      </p>
                    )}
                  </CardContent>
                </Card>
              ))}
            </TabsContent>

            <TabsContent value="permissions" className="space-y-3">
              <Card>
                <CardContent className="p-3 space-y-2">
                  {Object.entries(bot.permissions).map(([key, value]) => (
                    <div key={key} className="flex items-center justify-between">
                      <span className="text-sm">{key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase())}</span>
                      {value ? (
                        <Check className="h-4 w-4 text-green-500" />
                      ) : (
                        <X className="h-4 w-4 text-muted-foreground" />
                      )}
                    </div>
                  ))}
                </CardContent>
              </Card>
            </TabsContent>
          </ScrollArea>
        </Tabs>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          {!isInstalled && (
            <Button onClick={() => { onInstall(bot); onOpenChange(false); }}>
              <Download className="h-4 w-4 mr-2" />
              Install Bot
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// Bot Marketplace Panel
// ============================================================================

interface BotMarketplaceProps {
  bots: ChatBot[];
  installedBotIds: string[];
  onInstall: (bot: ChatBot) => void;
  onView: (bot: ChatBot) => void;
}

export function BotMarketplace({ bots, installedBotIds, onInstall, onView }: BotMarketplaceProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<BotCategory | "all">("all");
  const [typeFilter, setTypeFilter] = useState<BotType | "all">("all");

  const filteredBots = useMemo(() => {
    return bots.filter((bot) => {
      if (searchQuery && !bot.name.toLowerCase().includes(searchQuery.toLowerCase()) &&
          !bot.description.toLowerCase().includes(searchQuery.toLowerCase())) return false;
      if (categoryFilter !== "all" && bot.category !== categoryFilter) return false;
      if (typeFilter !== "all" && bot.type !== typeFilter) return false;
      return true;
    });
  }, [bots, searchQuery, categoryFilter, typeFilter]);

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-lg flex items-center gap-2">
            <Bot className="h-5 w-5" />
            Bot Marketplace
          </h2>
          <Badge variant="secondary">{bots.length} bots</Badge>
        </div>

        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search bots..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={categoryFilter} onValueChange={(v) => setCategoryFilter(v as BotCategory | "all")}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              <SelectItem value="productivity">Productivity</SelectItem>
              <SelectItem value="development">Development</SelectItem>
              <SelectItem value="moderation">Moderation</SelectItem>
              <SelectItem value="analytics">Analytics</SelectItem>
              <SelectItem value="entertainment">Entertainment</SelectItem>
              <SelectItem value="ai-assistant">AI Assistant</SelectItem>
              <SelectItem value="integration">Integration</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredBots.map((bot) => (
            <BotCard
              key={bot.id}
              bot={bot}
              onInstall={onInstall}
              onView={onView}
              isInstalled={installedBotIds.includes(bot.id)}
            />
          ))}
          {filteredBots.length === 0 && (
            <div className="col-span-2 text-center py-12 text-muted-foreground">
              <Bot className="h-16 w-16 mx-auto mb-3 opacity-30" />
              <p className="text-lg font-medium">No bots found</p>
              <p className="text-sm">Try adjusting your search or filters</p>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

// ============================================================================
// Bot Interaction Log
// ============================================================================

interface BotInteractionLogProps {
  interactions: BotInteraction[];
  botName: string;
}

export function BotInteractionLog({ interactions, botName }: BotInteractionLogProps) {
  return (
    <div className="space-y-2">
      <h4 className="text-sm font-medium flex items-center gap-2">
        <Activity className="h-4 w-4" />
        Recent Interactions â€” {botName}
      </h4>
      <ScrollArea className="h-60">
        <div className="space-y-2">
          {interactions.map((interaction) => (
            <Card key={interaction.id} className="bg-muted/30">
              <CardContent className="p-2">
                <div className="flex items-center gap-2 text-xs">
                  <Badge
                    variant={interaction.status === "completed" ? "default" : interaction.status === "failed" ? "destructive" : "secondary"}
                    className="text-[10px]"
                  >
                    {interaction.status}
                  </Badge>
                  <code className="text-primary">{interaction.type}</code>
                  <span className="text-muted-foreground ml-auto">
                    {interaction.durationMs ? `${interaction.durationMs}ms` : "â€”"}
                  </span>
                  <span className="text-muted-foreground">
                    {new Date(interaction.timestamp).toLocaleTimeString()}
                  </span>
                </div>
                <p className="text-xs mt-1 truncate">
                  <span className="text-muted-foreground">Input:</span> {interaction.input}
                </p>
                {interaction.output && (
                  <p className="text-xs mt-0.5 truncate">
                    <span className="text-muted-foreground">Output:</span> {interaction.output}
                  </p>
                )}
                {interaction.error && (
                  <p className="text-xs mt-0.5 text-red-500 truncate">
                    Error: {interaction.error}
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

// ============================================================================
// Command Palette (bot command autocomplete in chat input)
// ============================================================================

interface CommandPaletteProps {
  commands: BotCommand[];
  query: string;
  onSelect: (command: BotCommand) => void;
  visible: boolean;
}

export function CommandPalette({ commands, query, onSelect, visible }: CommandPaletteProps) {
  const filtered = useMemo(() => {
    if (!query.startsWith("/")) return [];
    const search = query.slice(1).toLowerCase();
    return commands.filter(
      (cmd) =>
        cmd.command.slice(1).toLowerCase().includes(search) ||
        cmd.aliases?.some((a) => a.slice(1).toLowerCase().includes(search))
    ).slice(0, 10);
  }, [commands, query]);

  if (!visible || filtered.length === 0) return null;

  return (
    <div className="absolute bottom-full left-0 right-0 mb-1 bg-popover border rounded-lg shadow-lg overflow-hidden z-50">
      <div className="p-2 border-b">
        <p className="text-xs text-muted-foreground">Bot Commands</p>
      </div>
      <ScrollArea className="max-h-60">
        {filtered.map((cmd) => (
          <button
            key={cmd.id}
            className="w-full text-left px-3 py-2 hover:bg-muted/50 flex items-center gap-3 transition-colors"
            onClick={() => onSelect(cmd)}
          >
            <Command className="h-4 w-4 text-primary shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <code className="text-sm font-bold text-primary">{cmd.command}</code>
                {cmd.parameters.filter((p) => p.required).map((p) => (
                  <span key={p.name} className="text-xs text-muted-foreground">
                    &lt;{p.name}&gt;
                  </span>
                ))}
              </div>
              <p className="text-xs text-muted-foreground truncate">{cmd.description}</p>
            </div>
            <Badge variant="secondary" className="text-[10px] shrink-0">
              {cmd.category}
            </Badge>
          </button>
        ))}
      </ScrollArea>
    </div>
  );
}

// ============================================================================
// Create Bot Dialog
// ============================================================================

interface CreateBotDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (bot: Partial<ChatBot>) => void;
}

export function CreateBotDialog({ open, onOpenChange, onCreate }: CreateBotDialogProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<BotType>("ai-agent");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [model, setModel] = useState("anthropic/claude-sonnet-4-5");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5" />
            Create Chat Bot
          </DialogTitle>
          <DialogDescription>
            Build an AI-powered bot for your P2P chats
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>Bot Name</Label>
            <Input
              placeholder="My Awesome Bot"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label>Description</Label>
            <Textarea
              placeholder="What does this bot do?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </div>

          <div className="space-y-2">
            <Label>Bot Type</Label>
            <div className="grid grid-cols-5 gap-1.5">
              {(Object.entries(botTypeConfig) as [BotType, typeof botTypeConfig[BotType]][]).slice(0, 5).map(([t, cfg]) => (
                <Button
                  key={t}
                  variant={type === t ? "default" : "outline"}
                  size="sm"
                  className="flex flex-col h-auto py-2 gap-1 text-[10px]"
                  onClick={() => setType(t)}
                >
                  {cfg.icon}
                  {cfg.label}
                </Button>
              ))}
            </div>
          </div>

          {type === "ai-agent" && (
            <>
              <div className="space-y-2">
                <Label>AI Model</Label>
                <Select value={model} onValueChange={setModel}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="anthropic/claude-sonnet-4-5">Claude Sonnet 4</SelectItem>
                    <SelectItem value="anthropic/claude-opus-4-6">Claude Opus 4</SelectItem>
                    <SelectItem value="google/gemini-2.5-pro">Gemini 2.5 Pro</SelectItem>
                    <SelectItem value="deepseek/deepseek-chat">DeepSeek Chat</SelectItem>
                    <SelectItem value="local/llama-3.2">Llama 3.2 (Local)</SelectItem>
                    <SelectItem value="local/glm-4.7-flash">GLM 4.7 Flash (Local)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>System Prompt</Label>
                <Textarea
                  placeholder="You are a helpful assistant that..."
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  rows={4}
                />
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              onCreate({
                name,
                displayName: name,
                description,
                type,
                aiConfig: type === "ai-agent" ? {
                  modelId: model,
                  systemPrompt,
                  temperature: 0.7,
                  maxTokens: 4096,
                  contextWindow: 20,
                  ragEnabled: false,
                  streamResponses: true,
                } : undefined,
              });
              onOpenChange(false);
            }}
            disabled={!name.trim()}
          >
            Create Bot
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
