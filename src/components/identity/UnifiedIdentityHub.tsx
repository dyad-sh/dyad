/**
 * Unified Identity Hub — Create Once, Use Everywhere
 *
 * This is THE identity management center. From here you:
 * 1. Create your Universal Identity (DID + ENS + wallets)
 * 2. Link wallets across chains
 * 3. Manage ENS/JNS names and text records
 * 4. Verify social accounts
 * 5. View reputation across all subsystems
 * 6. Manage delegation keys for agents
 * 7. View identity events/audit trail
 * 8. See how every subsystem sees your identity
 */

import { useState, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { IpcClient } from "@/ipc/ipc_client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from "@/components/ui/card";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import {
  User,
  Wallet,
  Globe,
  Shield,
  ShieldCheck,
  ShieldAlert,
  Key,
  Link2,
  Unlink,
  Plus,
  Pencil,
  Copy,
  Check,
  CheckCircle2,
  XCircle,
  ExternalLink,
  Fingerprint,
  Star,
  Award,
  Crown,
  Zap,
  Activity,
  Eye,
  EyeOff,
  Search,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  MoreVertical,
  Loader2,
  Hash,
  AtSign,
  Twitter,
  Github,
  MessageSquare,
  Bot,
  Satellite,
  Network,
  Blocks,
  Users,
  Lock,
  Unlock,
  QrCode,
  Smartphone,
  Monitor,
  BarChart3,
  TrendingUp,
  AlertTriangle,
  Clock,
  Calendar,
  Settings,
  Upload,
  Image as ImageIcon,
  Sparkles,
  BadgeCheck,
  CircleDot,
  Database,
  BrainCircuit,
  Flag,
} from "lucide-react";
import type {
  UniversalIdentity,
  WalletBinding,
  ChainType,
  SocialProof,
  SocialPlatform,
  DomainVerification,
  NameServiceRecord,
  JNSRegistration,
  ENSTextRecords,
  PresenceStatus,
  PresenceInfo,
  IdentityCapability,
  IdentityRole,
  VerificationLevel,
  UnifiedReputation,
  ReputationComponent,
  ReputationBadge,
  ReputationEvent,
  TrustLevel,
  IdentityEvent,
  IdentityEventType,
  DelegationKey,
  DelegationScope,
  AgentIdentity,
  CreateIdentityParams,
  IdentityKeySet,
} from "@/types/unified_identity_types";
import type { DIDString, CelestiaAnchor } from "@/types/ssi_types";

// ============================================================================
// HELPERS
// ============================================================================

const CHAIN_ICONS: Record<ChainType, string> = {
  ethereum: "⟠",
  polygon: "⬡",
  arbitrum: "🔵",
  optimism: "🔴",
  base: "🟦",
  solana: "◎",
  cosmos: "⚛️",
  celestia: "☀️",
  near: "Ⓝ",
  bitcoin: "₿",
  sui: "💧",
  aptos: "🅰️",
};

const CHAIN_NAMES: Record<ChainType, string> = {
  ethereum: "Ethereum",
  polygon: "Polygon",
  arbitrum: "Arbitrum",
  optimism: "Optimism",
  base: "Base",
  solana: "Solana",
  cosmos: "Cosmos",
  celestia: "Celestia",
  near: "NEAR",
  bitcoin: "Bitcoin",
  sui: "Sui",
  aptos: "Aptos",
};

const SOCIAL_ICONS: Record<SocialPlatform, { icon: string; color: string }> = {
  twitter: { icon: "𝕏", color: "text-white" },
  github: { icon: "⌘", color: "text-white" },
  discord: { icon: "🎮", color: "text-indigo-400" },
  telegram: { icon: "✈️", color: "text-blue-400" },
  linkedin: { icon: "in", color: "text-blue-400" },
  reddit: { icon: "🅁", color: "text-orange-400" },
  mastodon: { icon: "🐘", color: "text-purple-400" },
  farcaster: { icon: "🟣", color: "text-purple-400" },
  lens: { icon: "🌿", color: "text-green-400" },
  nostr: { icon: "⚡", color: "text-purple-400" },
  youtube: { icon: "▶️", color: "text-red-400" },
  twitch: { icon: "📺", color: "text-purple-400" },
  instagram: { icon: "📸", color: "text-pink-400" },
  keybase: { icon: "🔑", color: "text-orange-400" },
};

const TRUST_COLORS: Record<TrustLevel, string> = {
  newcomer: "text-gray-400",
  contributor: "text-blue-400",
  trusted: "text-green-400",
  established: "text-purple-400",
  expert: "text-amber-400",
  legendary: "text-yellow-400",
};

const TRUST_BADGES: Record<TrustLevel, string> = {
  newcomer: "🌱",
  contributor: "🌿",
  trusted: "✅",
  established: "⭐",
  expert: "💎",
  legendary: "👑",
};

const VERIFICATION_COLORS: Record<VerificationLevel, string> = {
  none: "text-gray-500",
  wallet: "text-blue-400",
  social: "text-green-400",
  domain: "text-purple-400",
  "kyc-basic": "text-amber-400",
  "kyc-full": "text-yellow-400",
  institutional: "text-yellow-400",
};

function formatTimeAgo(ts: string | undefined): string {
  if (!ts) return "";
  const diff = Date.now() - new Date(ts).getTime();
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function truncateAddr(addr: string, len = 6): string {
  if (addr.length <= len * 2 + 2) return addr;
  return `${addr.slice(0, len + 2)}...${addr.slice(-len)}`;
}

// ============================================================================
// 1. IDENTITY OVERVIEW CARD
// ============================================================================

interface IdentityOverviewProps {
  identity: UniversalIdentity | null;
  onEdit: () => void;
  onCreate: () => void;
}

function IdentityOverview({ identity, onEdit, onCreate }: IdentityOverviewProps) {
  if (!identity) {
    return (
      <Card className="bg-gradient-to-br from-violet-500/10 to-blue-500/10 border-violet-500/30">
        <CardContent className="p-8 text-center">
          <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-gradient-to-br from-violet-500 to-blue-500 flex items-center justify-center">
            <Fingerprint className="w-10 h-10 text-white" />
          </div>
          <h2 className="text-xl font-bold mb-2">Create Your Universal Identity</h2>
          <p className="text-sm text-muted-foreground/80 mb-6 max-w-lg mx-auto">
            One identity for everything — P2P chat, Creator Network, marketplace, governance,
            compute network, and AI agents. Powered by DID, ENS, and Celestia.
          </p>
          <Button size="lg" onClick={onCreate} className="gap-2">
            <Sparkles className="w-4 h-4" />
            Create Identity
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-muted/20 border-border/50">
      <CardContent className="p-0">
        {/* Banner */}
        {identity.coverImage && (
          <div className="h-32 rounded-t-lg overflow-hidden">
            <img
              src={identity.coverImage.startsWith("ipfs://")
                ? `https://w3s.link/ipfs/${identity.coverImage.slice(7)}`
                : identity.coverImage}
              alt="Cover"
              className="w-full h-full object-cover"
            />
          </div>
        )}

        <div className="p-4">
          <div className="flex items-start gap-4">
            {/* Avatar */}
            <div className={`w-16 h-16 rounded-xl overflow-hidden flex-shrink-0 bg-gradient-to-br from-violet-500 to-blue-500 flex items-center justify-center ${
              identity.coverImage ? "-mt-10 border-4 border-background" : ""
            }`}>
              {identity.avatar ? (
                <img
                  src={identity.avatar.startsWith("ipfs://")
                    ? `https://w3s.link/ipfs/${identity.avatar.slice(7)}`
                    : identity.avatar}
                  alt={identity.displayName}
                  className="w-full h-full object-cover"
                />
              ) : (
                <User className="w-8 h-8 text-white" />
              )}
            </div>

            {/* Identity info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <h2 className="text-lg font-bold">{identity.displayName}</h2>
                {identity.verified && (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger>
                        <BadgeCheck className="w-5 h-5 text-blue-400" />
                      </TooltipTrigger>
                      <TooltipContent>
                        Verified ({identity.verificationLevel})
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
                <Badge
                  variant="outline"
                  className={`text-[10px] px-1.5 py-0 ${TRUST_COLORS[identity.reputation.trustLevel]}`}
                >
                  {TRUST_BADGES[identity.reputation.trustLevel]} {identity.reputation.trustLevel}
                </Badge>
              </div>

              {/* Names */}
              <div className="flex items-center gap-2 flex-wrap mb-1">
                {identity.ensName && (
                  <Badge variant="outline" className="text-xs px-2 py-0 border-blue-500/30 text-blue-400 font-mono">
                    {identity.ensName}
                  </Badge>
                )}
                {identity.jnsName && (
                  <Badge variant="outline" className="text-xs px-2 py-0 border-violet-500/30 text-violet-400 font-mono">
                    {identity.jnsName}
                  </Badge>
                )}
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-mono text-muted-foreground">
                  {identity.did.slice(0, 20)}...
                </Badge>
              </div>

              {/* Bio */}
              {identity.bio && (
                <p className="text-xs text-muted-foreground/80 line-clamp-2 mt-1">{identity.bio}</p>
              )}

              {/* Quick stats */}
              <div className="flex items-center gap-3 mt-2 text-[11px] text-muted-foreground/60 flex-wrap">
                <span className="flex items-center gap-1">
                  <Wallet className="w-3 h-3" />
                  {identity.wallets.length} wallet{identity.wallets.length !== 1 ? "s" : ""}
                </span>
                <span className="flex items-center gap-1">
                  <Link2 className="w-3 h-3" />
                  {identity.socialProofs.filter((s) => s.verified).length} verified socials
                </span>
                <span className="flex items-center gap-1">
                  <Star className="w-3 h-3" />
                  {identity.reputation.overallScore} reputation
                </span>
                <span className="flex items-center gap-1">
                  <Shield className="w-3 h-3" />
                  {identity.capabilities.length} capabilities
                </span>
                {identity.celestiaAnchors && identity.celestiaAnchors.length > 0 && (
                  <span className="flex items-center gap-1 text-green-400">
                    <Satellite className="w-3 h-3" />
                    Anchored
                  </span>
                )}
              </div>
            </div>

            {/* Presence & Edit */}
            <div className="flex items-center gap-2 shrink-0">
              <PresenceIndicator status={identity.status} />
              <Button variant="outline" size="sm" onClick={onEdit}>
                <Pencil className="w-3.5 h-3.5 mr-1" />
                Edit
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// 2. PRESENCE INDICATOR
// ============================================================================

function PresenceIndicator({ status, size = "sm" }: { status: PresenceStatus; size?: "sm" | "lg" }) {
  const colors: Record<PresenceStatus, string> = {
    online: "bg-green-500",
    away: "bg-yellow-500",
    busy: "bg-red-500",
    dnd: "bg-red-600",
    invisible: "bg-gray-500",
    offline: "bg-gray-600",
  };
  const px = size === "lg" ? "w-3.5 h-3.5" : "w-2.5 h-2.5";
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger>
          <div className={`${px} rounded-full ${colors[status]} ${status === "online" ? "animate-pulse" : ""}`} />
        </TooltipTrigger>
        <TooltipContent className="capitalize">{status}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// ============================================================================
// 3. WALLETS PANEL
// ============================================================================

interface WalletsPanelProps {
  wallets: WalletBinding[];
  onAddWallet: () => void;
  onRemoveWallet: (address: string, chain: ChainType) => void;
  onSetPrimary: (address: string, chain: ChainType) => void;
}

function WalletsPanel({ wallets, onAddWallet, onRemoveWallet, onSetPrimary }: WalletsPanelProps) {
  const chainGroups = useMemo(() => {
    const groups: Record<string, WalletBinding[]> = {};
    wallets.forEach((w) => {
      if (!groups[w.chain]) groups[w.chain] = [];
      groups[w.chain].push(w);
    });
    return groups;
  }, [wallets]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Wallet className="w-4 h-4" />
          Connected Wallets
        </h3>
        <Button size="sm" variant="outline" onClick={onAddWallet}>
          <Plus className="w-3.5 h-3.5 mr-1" />
          Add Wallet
        </Button>
      </div>

      <div className="space-y-3">
        {Object.entries(chainGroups).map(([chain, chainWallets]) => (
          <div key={chain}>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-base">{CHAIN_ICONS[chain as ChainType] || "🔗"}</span>
              <span className="text-xs font-medium">{CHAIN_NAMES[chain as ChainType] || chain}</span>
              <Badge variant="outline" className="text-[9px] px-1 py-0">{chainWallets.length}</Badge>
            </div>
            <div className="space-y-1.5 pl-6">
              {chainWallets.map((wallet) => (
                <div key={wallet.address} className="flex items-center gap-2 p-2 rounded-lg bg-muted/20 hover:bg-muted/30 transition-colors group">
                  {wallet.isPrimary && (
                    <Crown className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  )}
                  <span className="text-xs font-mono flex-1 truncate">
                    {truncateAddr(wallet.address)}
                  </span>
                  {wallet.ensName && (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-blue-500/30 text-blue-400 shrink-0">
                      {wallet.ensName}
                    </Badge>
                  )}
                  {wallet.label && (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0">
                      {wallet.label}
                    </Badge>
                  )}
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            onClick={() => {
                              navigator.clipboard.writeText(wallet.address);
                              toast.success("Address copied");
                            }}
                          >
                            <Copy className="w-3 h-3" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Copy Address</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                    {!wallet.isPrimary && (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6"
                              onClick={() => onSetPrimary(wallet.address, wallet.chain)}
                            >
                              <Crown className="w-3 h-3" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Set as Primary</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    )}
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-red-400"
                            onClick={() => onRemoveWallet(wallet.address, wallet.chain)}
                          >
                            <Unlink className="w-3 h-3" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Remove</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}

        {wallets.length === 0 && (
          <div className="text-center py-8 text-muted-foreground/50">
            <Wallet className="w-8 h-8 mx-auto mb-2 opacity-30" />
            <p className="text-sm">No wallets connected</p>
            <p className="text-xs mt-1">Connect a wallet to get started</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// 4. ENS / JNS NAME SERVICE PANEL
// ============================================================================

interface NameServicePanelProps {
  ensRecords: NameServiceRecord[];
  jnsRecords: JNSRegistration[];
  onLinkENS: () => void;
  onRegisterJNS: () => void;
  onEditTextRecords: (name: string) => void;
}

function NameServicePanel({ ensRecords, jnsRecords, onLinkENS, onRegisterJNS, onEditTextRecords }: NameServicePanelProps) {
  return (
    <div className="space-y-4">
      {/* ENS Section */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Globe className="w-4 h-4 text-blue-400" />
            ENS Names
          </h3>
          <Button size="sm" variant="outline" onClick={onLinkENS}>
            <Plus className="w-3.5 h-3.5 mr-1" />
            Link ENS
          </Button>
        </div>

        <div className="space-y-2">
          {ensRecords.map((record) => (
            <Card key={record.name} className="bg-muted/20 border-border/40">
              <CardContent className="p-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center shrink-0">
                    <Globe className="w-5 h-5 text-blue-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold font-mono">{record.name}</span>
                      {record.valid ? (
                        <Badge variant="outline" className="text-[10px] px-1 py-0 border-green-500/30 text-green-400">Active</Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px] px-1 py-0 border-red-500/30 text-red-400">Expired</Badge>
                      )}
                      {record.hasReverseRecord && (
                        <Badge variant="outline" className="text-[10px] px-1 py-0 border-purple-500/30 text-purple-400">Primary</Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-1 text-[10px] text-muted-foreground/60">
                      <span className="font-mono">{truncateAddr(record.resolvedAddress)}</span>
                      <span>•</span>
                      <span>{CHAIN_NAMES[record.chain]}</span>
                      {record.expiresAt && (
                        <>
                          <span>•</span>
                          <span>Expires {new Date(record.expiresAt).toLocaleDateString()}</span>
                        </>
                      )}
                    </div>
                    {/* JoyCreate text records */}
                    {record.textRecords["ai.joycreate.did"] && (
                      <div className="mt-1">
                        <Badge variant="outline" className="text-[9px] px-1 py-0 border-violet-500/30 text-violet-400">
                          JoyCreate Linked ✓
                        </Badge>
                      </div>
                    )}
                  </div>
                  <Button variant="outline" size="sm" className="shrink-0" onClick={() => onEditTextRecords(record.name)}>
                    <Settings className="w-3.5 h-3.5 mr-1" />
                    Records
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}

          {ensRecords.length === 0 && (
            <Card className="bg-muted/10 border-border/30 border-dashed">
              <CardContent className="p-4 text-center">
                <Globe className="w-6 h-6 mx-auto mb-1.5 text-muted-foreground/40" />
                <p className="text-xs text-muted-foreground/60">No ENS names linked</p>
                <p className="text-[10px] text-muted-foreground/40 mt-0.5">Link your .eth name for universal recognition</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <Separator className="my-4" />

      {/* JNS Section */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-violet-400" />
            JNS Names (.joy)
          </h3>
          <Button size="sm" variant="outline" onClick={onRegisterJNS}>
            <Plus className="w-3.5 h-3.5 mr-1" />
            Register .joy
          </Button>
        </div>

        <div className="space-y-2">
          {jnsRecords.map((record) => (
            <Card key={record.name} className="bg-muted/20 border-border/40">
              <CardContent className="p-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-violet-500/20 to-pink-500/20 flex items-center justify-center shrink-0">
                    <Sparkles className="w-5 h-5 text-violet-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold font-mono">{record.name}</span>
                      {record.premium && (
                        <Badge variant="outline" className="text-[10px] px-1 py-0 border-amber-500/30 text-amber-400">Premium</Badge>
                      )}
                      {record.autoRenew && (
                        <Badge variant="outline" className="text-[10px] px-1 py-0">Auto-Renew</Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-1 text-[10px] text-muted-foreground/60">
                      <span className="font-mono">{record.ownerDid.slice(0, 20)}...</span>
                      <span>•</span>
                      <span>Expires {new Date(record.expiresAt).toLocaleDateString()}</span>
                    </div>
                    {record.subnames && record.subnames.length > 0 && (
                      <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                        {record.subnames.map((sub) => (
                          <Badge key={sub.name} variant="outline" className="text-[9px] px-1 py-0">
                            {sub.name}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}

          {jnsRecords.length === 0 && (
            <Card className="bg-gradient-to-r from-violet-500/5 to-pink-500/5 border-violet-500/20 border-dashed">
              <CardContent className="p-4 text-center">
                <Sparkles className="w-6 h-6 mx-auto mb-1.5 text-violet-400/40" />
                <p className="text-xs text-muted-foreground/60">No .joy names registered</p>
                <p className="text-[10px] text-muted-foreground/40 mt-0.5">
                  Register yourname.joy — works everywhere in the JoyCreate ecosystem
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// 5. SOCIAL PROOFS PANEL
// ============================================================================

interface SocialProofsPanelProps {
  proofs: SocialProof[];
  onLink: (platform: SocialPlatform) => void;
  onVerify: (platform: SocialPlatform) => void;
  onUnlink: (platform: SocialPlatform) => void;
}

function SocialProofsPanel({ proofs, onLink, onVerify, onUnlink }: SocialProofsPanelProps) {
  const allPlatforms: SocialPlatform[] = [
    "twitter", "github", "discord", "telegram", "linkedin",
    "reddit", "mastodon", "farcaster", "lens", "nostr",
    "youtube", "twitch", "instagram", "keybase",
  ];

  const linkedPlatforms = new Set(proofs.map((p) => p.platform));

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold flex items-center gap-2">
        <Link2 className="w-4 h-4" />
        Social Proofs
        <Badge variant="outline" className="text-[10px] px-1 py-0">
          {proofs.filter((p) => p.verified).length}/{allPlatforms.length} verified
        </Badge>
      </h3>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {allPlatforms.map((platform) => {
          const proof = proofs.find((p) => p.platform === platform);
          const social = SOCIAL_ICONS[platform];
          const isLinked = linkedPlatforms.has(platform);
          const isVerified = proof?.verified;

          return (
            <div
              key={platform}
              className={`flex items-center gap-3 p-2.5 rounded-lg border transition-colors ${
                isVerified
                  ? "bg-green-500/5 border-green-500/20"
                  : isLinked
                    ? "bg-muted/20 border-border/40"
                    : "bg-muted/5 border-border/20 opacity-60"
              }`}
            >
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-base ${
                isVerified ? "bg-green-500/10" : "bg-muted/30"
              }`}>
                {social.icon}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-medium capitalize">{platform}</span>
                  {isVerified && <CheckCircle2 className="w-3 h-3 text-green-400" />}
                </div>
                {proof?.handle && (
                  <span className="text-[10px] text-muted-foreground/70 font-mono">@{proof.handle}</span>
                )}
              </div>
              <div>
                {!isLinked ? (
                  <Button size="sm" variant="ghost" className="h-7 text-[10px]" onClick={() => onLink(platform)}>
                    <Plus className="w-3 h-3 mr-0.5" />
                    Link
                  </Button>
                ) : !isVerified ? (
                  <Button size="sm" variant="outline" className="h-7 text-[10px] border-amber-500/30 text-amber-400" onClick={() => onVerify(platform)}>
                    <Shield className="w-3 h-3 mr-0.5" />
                    Verify
                  </Button>
                ) : (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-7 w-7">
                        <MoreVertical className="w-3 h-3" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      {proof?.profileUrl && (
                        <DropdownMenuItem asChild>
                          <a href={proof.profileUrl} target="_blank" rel="noopener noreferrer">
                            <ExternalLink className="w-4 h-4 mr-2" /> View Profile
                          </a>
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem className="text-red-400" onClick={() => onUnlink(platform)}>
                        <Unlink className="w-4 h-4 mr-2" /> Unlink
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================================
// 6. REPUTATION PANEL
// ============================================================================

interface ReputationPanelProps {
  reputation: UnifiedReputation | null;
}

function ReputationPanel({ reputation }: ReputationPanelProps) {
  if (!reputation) {
    return (
      <div className="text-center py-12 text-muted-foreground/50">
        <Star className="w-8 h-8 mx-auto mb-2 opacity-30" />
        <p className="text-sm">No reputation data yet</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Overall Score */}
      <Card className="bg-gradient-to-r from-violet-500/5 to-amber-500/5 border-violet-500/20">
        <CardContent className="p-4">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-violet-500 to-amber-500 flex items-center justify-center">
              <span className="text-xl font-bold text-white">{reputation.overallScore}</span>
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-sm font-semibold">
                  {TRUST_BADGES[reputation.trustLevel]} {reputation.trustLevel.charAt(0).toUpperCase() + reputation.trustLevel.slice(1)}
                </span>
                <span className="text-[10px] text-muted-foreground/60">/ 1000</span>
              </div>
              <Progress value={reputation.overallScore / 10} className="h-2 mb-1" />
              <span className="text-[11px] text-muted-foreground/60">
                {reputation.totalTransactions.toLocaleString()} total transactions across all subsystems
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Component Scores */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {reputation.components.map((comp) => (
          <Card key={comp.subsystem} className="bg-muted/20 border-border/40">
            <CardContent className="p-3 text-center">
              <span className="text-xs text-muted-foreground/70 capitalize block mb-1">{comp.subsystem}</span>
              <div className="text-lg font-bold">{comp.score}</div>
              <Progress value={comp.score / 10} className="h-1 mt-1 mb-1" />
              <div className="text-[10px] text-muted-foreground/50">
                {comp.transactionCount} txns • {(comp.successRate * 100).toFixed(0)}% success
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Badges */}
      {reputation.badges.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold mb-2 flex items-center gap-1.5">
            <Award className="w-3.5 h-3.5" />
            Badges ({reputation.badges.length})
          </h4>
          <div className="flex flex-wrap gap-2">
            {reputation.badges.map((badge) => (
              <TooltipProvider key={badge.id}>
                <Tooltip>
                  <TooltipTrigger>
                    <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-muted/30 border border-border/40">
                      <span className="text-sm">{badge.icon}</span>
                      <span className="text-[10px] font-medium">{badge.name}</span>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="text-xs">{badge.description}</p>
                    <p className="text-[10px] text-muted-foreground mt-1">Earned {formatTimeAgo(badge.earnedAt)}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ))}
          </div>
        </div>
      )}

      {/* Recent History */}
      {reputation.history.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold mb-2 flex items-center gap-1.5">
            <Activity className="w-3.5 h-3.5" />
            Recent Activity
          </h4>
          <div className="space-y-1.5">
            {reputation.history.slice(0, 10).map((event, i) => (
              <div key={i} className="flex items-center gap-2 text-[11px] p-1.5 rounded bg-muted/10">
                <span className={event.amount >= 0 ? "text-green-400" : "text-red-400"}>
                  {event.amount >= 0 ? "+" : ""}{event.amount}
                </span>
                <span className="text-muted-foreground/70 flex-1">{event.reason}</span>
                <Badge variant="outline" className="text-[9px] px-1 py-0 capitalize">{event.subsystem}</Badge>
                <span className="text-muted-foreground/50">{formatTimeAgo(event.timestamp)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// 7. DELEGATION KEYS PANEL
// ============================================================================

interface DelegationPanelProps {
  keys: IdentityKeySet | null;
  delegations: DelegationKey[];
  onGrantDelegation: () => void;
  onRevokeDelegation: (delegateDid: DIDString) => void;
  onRotateKeys: () => void;
}

function DelegationPanel({ keys, delegations, onGrantDelegation, onRevokeDelegation, onRotateKeys }: DelegationPanelProps) {
  return (
    <div className="space-y-4">
      {/* Key Overview */}
      {keys && (
        <Card className="bg-muted/20 border-border/50">
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-sm flex items-center gap-2">
              <Key className="w-4 h-4" />
              Cryptographic Keys
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3 space-y-2">
            <div className="flex items-center justify-between p-2 rounded bg-muted/20">
              <div>
                <span className="text-[11px] text-muted-foreground/70 block">Signing Key</span>
                <span className="text-xs font-mono">{keys.signing.publicKeyMultibase.slice(0, 24)}...</span>
              </div>
              <Badge variant="outline" className="text-[10px]">{keys.signing.type}</Badge>
            </div>
            <div className="flex items-center justify-between p-2 rounded bg-muted/20">
              <div>
                <span className="text-[11px] text-muted-foreground/70 block">Encryption Key</span>
                <span className="text-xs font-mono">{keys.encryption.publicKeyMultibase.slice(0, 24)}...</span>
              </div>
              <Badge variant="outline" className="text-[10px]">{keys.encryption.type}</Badge>
            </div>
            {keys.recovery && (
              <div className="flex items-center justify-between p-2 rounded bg-muted/20">
                <div>
                  <span className="text-[11px] text-muted-foreground/70 block">Recovery Key</span>
                  <span className="text-xs font-mono">{keys.recovery.publicKeyMultibase.slice(0, 24)}...</span>
                </div>
                <Badge variant="outline" className="text-[10px]">{keys.recovery.type}</Badge>
              </div>
            )}
            <Button variant="outline" size="sm" className="w-full mt-2" onClick={onRotateKeys}>
              <RefreshCw className="w-3.5 h-3.5 mr-1" />
              Rotate Keys
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Delegations */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <BrainCircuit className="w-4 h-4" />
            Delegations
            <Badge variant="outline" className="text-[10px] px-1 py-0">{delegations.length}</Badge>
          </h3>
          <Button size="sm" variant="outline" onClick={onGrantDelegation}>
            <Plus className="w-3.5 h-3.5 mr-1" />
            Grant
          </Button>
        </div>

        <div className="space-y-2">
          {delegations.map((del) => (
            <Card key={del.keyId} className="bg-muted/20 border-border/40">
              <CardContent className="p-3">
                <div className="flex items-center gap-3">
                  <Bot className="w-5 h-5 text-purple-400 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono truncate">{del.delegateDid}</span>
                      <Badge variant="outline" className="text-[10px] px-1 py-0 capitalize">{del.scope}</Badge>
                    </div>
                    <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                      {del.delegatedCapabilities.slice(0, 3).map((cap) => (
                        <Badge key={cap} variant="outline" className="text-[9px] px-1 py-0 border-purple-500/30 text-purple-400">
                          {cap}
                        </Badge>
                      ))}
                      {del.delegatedCapabilities.length > 3 && (
                        <span className="text-[9px] text-muted-foreground/50">+{del.delegatedCapabilities.length - 3} more</span>
                      )}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-red-400 shrink-0"
                    onClick={() => onRevokeDelegation(del.delegateDid)}
                  >
                    <XCircle className="w-4 h-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}

          {delegations.length === 0 && (
            <div className="text-center py-6 text-muted-foreground/50">
              <Lock className="w-6 h-6 mx-auto mb-1.5 opacity-30" />
              <p className="text-xs">No active delegations</p>
              <p className="text-[10px] mt-0.5">Grant delegation to let AI agents act on your behalf</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// 8. IDENTITY EVENTS / AUDIT TRAIL
// ============================================================================

interface EventsPanelProps {
  events: IdentityEvent[];
  isLoading: boolean;
}

function EventsPanel({ events, isLoading }: EventsPanelProps) {
  const eventIcons: Record<string, React.ReactNode> = {
    "identity:created": <Plus className="w-3.5 h-3.5 text-green-400" />,
    "identity:updated": <Pencil className="w-3.5 h-3.5 text-blue-400" />,
    "wallet:linked": <Wallet className="w-3.5 h-3.5 text-green-400" />,
    "wallet:unlinked": <Unlink className="w-3.5 h-3.5 text-red-400" />,
    "social:linked": <Link2 className="w-3.5 h-3.5 text-green-400" />,
    "social:verified": <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />,
    "ens:linked": <Globe className="w-3.5 h-3.5 text-blue-400" />,
    "jns:registered": <Sparkles className="w-3.5 h-3.5 text-violet-400" />,
    "key:rotated": <RefreshCw className="w-3.5 h-3.5 text-amber-400" />,
    "key:delegation-granted": <Bot className="w-3.5 h-3.5 text-purple-400" />,
    "key:delegation-revoked": <XCircle className="w-3.5 h-3.5 text-red-400" />,
    "reputation:updated": <Star className="w-3.5 h-3.5 text-amber-400" />,
    "reputation:badge-earned": <Award className="w-3.5 h-3.5 text-yellow-400" />,
    "identity:anchored": <Satellite className="w-3.5 h-3.5 text-green-400" />,
  };

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold flex items-center gap-2">
        <Activity className="w-4 h-4" />
        Identity Events
        <Badge variant="outline" className="text-[10px] px-1 py-0">{events.length}</Badge>
      </h3>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
        </div>
      ) : (
        <ScrollArea className="max-h-[500px]">
          <div className="relative space-y-0">
            {/* Timeline line */}
            <div className="absolute left-[11px] top-2 bottom-2 w-px bg-border/40" />

            {events.map((event, i) => (
              <div key={event.id} className="flex items-start gap-3 py-2 relative">
                {/* Icon */}
                <div className="w-6 h-6 rounded-full bg-muted/50 flex items-center justify-center z-10 shrink-0">
                  {eventIcons[event.type] || <CircleDot className="w-3.5 h-3.5 text-muted-foreground" />}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-medium">{event.description}</span>
                    {event.celestiaAnchor && (
                      <Badge variant="outline" className="text-[9px] px-1 py-0 border-green-500/30 text-green-400">
                        <Satellite className="w-2 h-2 mr-0.5" />
                        Anchored
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5 text-[10px] text-muted-foreground/50">
                    <span>{new Date(event.timestamp).toLocaleString()}</span>
                    <span>•</span>
                    <span className="font-mono">{event.type}</span>
                  </div>
                </div>
              </div>
            ))}

            {events.length === 0 && (
              <div className="text-center py-12 text-muted-foreground/50">
                <Activity className="w-6 h-6 mx-auto mb-1.5 opacity-30" />
                <p className="text-xs">No identity events yet</p>
              </div>
            )}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}

// ============================================================================
// 9. SUBSYSTEM VIEWS PANEL
// ============================================================================

interface SubsystemViewsProps {
  identity: UniversalIdentity;
}

function SubsystemViews({ identity }: SubsystemViewsProps) {
  const subsystems = [
    {
      name: "P2P Chat",
      icon: <MessageSquare className="w-5 h-5 text-blue-400" />,
      color: "from-blue-500/10 to-blue-600/10",
      fields: [
        { label: "Display Name", value: identity.displayName },
        { label: "Public Key", value: identity.keys?.encryption.publicKeyMultibase?.slice(0, 24) + "..." },
        { label: "Signing Key", value: identity.keys?.signing.publicKeyMultibase?.slice(0, 24) + "..." },
        { label: "Status", value: identity.status },
        { label: "Verified", value: identity.verified ? "✓" : "✗" },
      ],
    },
    {
      name: "Creator Network",
      icon: <Sparkles className="w-5 h-5 text-violet-400" />,
      color: "from-violet-500/10 to-pink-500/10",
      fields: [
        { label: "Display Name", value: identity.displayName },
        { label: "ENS", value: identity.ensName || "—" },
        { label: "JNS", value: identity.jnsName || "—" },
        { label: "Social Proofs", value: `${identity.socialProofs.filter((s) => s.verified).length} verified` },
        { label: "Reputation", value: `${identity.reputation?.overallScore || 0} (${identity.reputation?.trustLevel || "newcomer"})` },
      ],
    },
    {
      name: "Marketplace",
      icon: <Database className="w-5 h-5 text-green-400" />,
      color: "from-green-500/10 to-emerald-500/10",
      fields: [
        { label: "Primary Wallet", value: truncateAddr(identity.primaryWallet?.address || "") },
        { label: "Verification", value: identity.verificationLevel },
        { label: "Can Buy", value: identity.capabilities?.includes("marketplace:buy") ? "✓" : "✗" },
        { label: "Can Sell", value: identity.capabilities?.includes("marketplace:sell") ? "✓" : "✗" },
        { label: "Reputation", value: `${identity.reputation?.overallScore || 0}` },
      ],
    },
    {
      name: "Governance",
      icon: <Flag className="w-5 h-5 text-amber-400" />,
      color: "from-amber-500/10 to-orange-500/10",
      fields: [
        { label: "Can Propose", value: identity.capabilities?.includes("governance:propose") ? "✓" : "✗" },
        { label: "Can Vote", value: identity.capabilities?.includes("governance:vote") ? "✓" : "✗" },
        { label: "Council", value: identity.roles?.includes("governance-council") ? "✓" : "✗" },
        { label: "Wallets", value: `${identity.wallets?.length || 0} chains` },
        { label: "Staked", value: identity.reputation?.stakedAmount?.amount || "—" },
      ],
    },
    {
      name: "Compute Network",
      icon: <Network className="w-5 h-5 text-cyan-400" />,
      color: "from-cyan-500/10 to-blue-500/10",
      fields: [
        { label: "Provider", value: identity.capabilities?.includes("compute:provide") ? "✓" : "✗" },
        { label: "Consumer", value: identity.capabilities?.includes("compute:consume") ? "✓" : "✗" },
        { label: "Validator", value: identity.capabilities?.includes("compute:validate") ? "✓" : "✗" },
        { label: "Reputation", value: `${identity.reputation?.overallScore || 0}` },
      ],
    },
    {
      name: "Federation",
      icon: <Globe className="w-5 h-5 text-purple-400" />,
      color: "from-purple-500/10 to-indigo-500/10",
      fields: [
        { label: "Public Key", value: identity.keys?.signing.publicKeyMultibase?.slice(0, 24) + "..." },
        { label: "Relay", value: identity.capabilities?.includes("federation:relay") ? "✓" : "✗" },
        { label: "Gateway", value: identity.capabilities?.includes("federation:gateway") ? "✓" : "✗" },
      ],
    },
  ];

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold flex items-center gap-2">
        <Eye className="w-4 h-4" />
        How Each Subsystem Sees You
      </h3>
      <p className="text-[11px] text-muted-foreground/60">
        One identity, many views. Each system sees only what it needs, but they all share the same source of truth.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {subsystems.map((sys) => (
          <Card key={sys.name} className={`bg-gradient-to-br ${sys.color} border-border/30`}>
            <CardHeader className="p-3 pb-2">
              <CardTitle className="text-xs flex items-center gap-2">
                {sys.icon}
                {sys.name}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3 pt-0 space-y-1.5">
              {sys.fields.map((field) => (
                <div key={field.label} className="flex items-center justify-between text-[11px]">
                  <span className="text-muted-foreground/60">{field.label}</span>
                  <span className="font-mono text-[10px]">{field.value}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// 10. CREATE IDENTITY DIALOG
// ============================================================================

interface CreateIdentityDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (params: CreateIdentityParams) => void;
}

function CreateIdentityDialog({ open, onOpenChange, onCreate }: CreateIdentityDialogProps) {
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [walletAddress, setWalletAddress] = useState("");
  const [chain, setChain] = useState<ChainType>("ethereum");
  const [ensName, setEnsName] = useState("");
  const [registerJns, setRegisterJns] = useState("");
  const [step, setStep] = useState(1);

  const handleCreate = () => {
    if (!displayName || !walletAddress) {
      toast.error("Display name and wallet address are required");
      return;
    }
    onCreate({
      displayName,
      bio,
      walletAddress,
      chain,
      ensName: ensName || undefined,
      registerJns: registerJns || undefined,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Fingerprint className="w-5 h-5 text-violet-400" />
            Create Universal Identity
          </DialogTitle>
          <DialogDescription>
            One identity for everything — chat, marketplace, governance, compute, and more.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {step === 1 && (
            <>
              {/* Step 1: Basic Info */}
              <div className="flex items-center gap-2 mb-2">
                <Badge className="bg-violet-500 text-[10px]">Step 1</Badge>
                <span className="text-xs font-medium">Basic Info</span>
              </div>
              <div className="space-y-3">
                <div>
                  <Label htmlFor="displayName" className="text-xs">Display Name *</Label>
                  <Input
                    id="displayName"
                    placeholder="Your name..."
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label htmlFor="bio" className="text-xs">Bio</Label>
                  <Textarea
                    id="bio"
                    placeholder="Tell the world about yourself..."
                    value={bio}
                    onChange={(e) => setBio(e.target.value)}
                    className="mt-1"
                    rows={3}
                  />
                </div>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              {/* Step 2: Wallet */}
              <div className="flex items-center gap-2 mb-2">
                <Badge className="bg-violet-500 text-[10px]">Step 2</Badge>
                <span className="text-xs font-medium">Connect Wallet</span>
              </div>
              <div className="space-y-3">
                <div>
                  <Label htmlFor="wallet" className="text-xs">Wallet Address *</Label>
                  <Input
                    id="wallet"
                    placeholder="0x..."
                    value={walletAddress}
                    onChange={(e) => setWalletAddress(e.target.value)}
                    className="mt-1 font-mono"
                  />
                </div>
                <div>
                  <Label htmlFor="chain" className="text-xs">Chain</Label>
                  <Select value={chain} onValueChange={(v) => setChain(v as ChainType)}>
                    <SelectTrigger className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(CHAIN_NAMES) as ChainType[]).map((c) => (
                        <SelectItem key={c} value={c}>
                          {CHAIN_ICONS[c]} {CHAIN_NAMES[c]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="p-3 rounded-lg bg-blue-500/5 border border-blue-500/10 text-[11px] text-muted-foreground/70">
                  <Shield className="w-3.5 h-3.5 inline mr-1 text-blue-400" />
                  You'll need to sign a message to prove you own this wallet. No funds are moved.
                </div>
              </div>
            </>
          )}

          {step === 3 && (
            <>
              {/* Step 3: Names */}
              <div className="flex items-center gap-2 mb-2">
                <Badge className="bg-violet-500 text-[10px]">Step 3</Badge>
                <span className="text-xs font-medium">Name Service (Optional)</span>
              </div>
              <div className="space-y-3">
                <div>
                  <Label htmlFor="ens" className="text-xs">ENS Name (if you own one)</Label>
                  <Input
                    id="ens"
                    placeholder="yourname.eth"
                    value={ensName}
                    onChange={(e) => setEnsName(e.target.value)}
                    className="mt-1 font-mono"
                  />
                  <p className="text-[10px] text-muted-foreground/50 mt-0.5">
                    Links your existing .eth name to this identity
                  </p>
                </div>
                <div>
                  <Label htmlFor="jns" className="text-xs">Register a .joy Name</Label>
                  <div className="flex gap-1 mt-1">
                    <Input
                      id="jns"
                      placeholder="yourname"
                      value={registerJns}
                      onChange={(e) => setRegisterJns(e.target.value)}
                      className="font-mono"
                    />
                    <span className="flex items-center text-xs text-muted-foreground/70 px-2 bg-muted/30 rounded-md border">.joy</span>
                  </div>
                  <p className="text-[10px] text-muted-foreground/50 mt-0.5">
                    Your .joy name works everywhere in the JoyCreate ecosystem
                  </p>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Progress dots */}
        <div className="flex items-center justify-center gap-2 mt-2">
          {[1, 2, 3].map((s) => (
            <button
              key={s}
              className={`w-2 h-2 rounded-full transition-colors ${
                s === step ? "bg-violet-500" : s < step ? "bg-violet-500/50" : "bg-muted/50"
              }`}
              onClick={() => setStep(s)}
            />
          ))}
        </div>

        <DialogFooter>
          {step > 1 && (
            <Button variant="outline" onClick={() => setStep(step - 1)}>Back</Button>
          )}
          {step < 3 ? (
            <Button onClick={() => setStep(step + 1)}>Next</Button>
          ) : (
            <Button onClick={handleCreate} className="gap-1.5">
              <Sparkles className="w-4 h-4" />
              Create Identity
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// MAIN: UNIFIED IDENTITY HUB
// ============================================================================

export function UnifiedIdentityHub() {
  const ipc = IpcClient.getInstance();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("overview");
  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  // ── Fetch identity ──
  const { data: identity, isLoading: identityLoading, refetch: refetchIdentity } = useQuery({
    queryKey: ["unified-identity"],
    queryFn: async (): Promise<UniversalIdentity | null> => {
      try {
        const result = await ipc.invoke("identity:get-current");
        return result || null;
      } catch {
        return null;
      }
    },
    staleTime: 30_000,
  });

  // ── Name service records ──
  const { data: ensRecords = [] } = useQuery({
    queryKey: ["identity-ens-records"],
    queryFn: async (): Promise<NameServiceRecord[]> => {
      try {
        return await ipc.invoke("identity:ens:list") || [];
      } catch {
        return [];
      }
    },
    enabled: !!identity,
  });

  const { data: jnsRecords = [] } = useQuery({
    queryKey: ["identity-jns-records"],
    queryFn: async (): Promise<JNSRegistration[]> => {
      try {
        return await ipc.invoke("identity:jns:list") || [];
      } catch {
        return [];
      }
    },
    enabled: !!identity,
  });

  // ── Identity events ──
  const { data: events = [], isLoading: eventsLoading } = useQuery({
    queryKey: ["identity-events"],
    queryFn: async (): Promise<IdentityEvent[]> => {
      try {
        return await ipc.invoke("identity:events:list", { limit: 50 }) || [];
      } catch {
        return [];
      }
    },
    enabled: !!identity,
  });

  // ── Delegations ──
  const delegations = useMemo(() => {
    return identity?.keys?.delegation || [];
  }, [identity]);

  // ── Handlers ──
  const handleCreateIdentity = useCallback(async (params: CreateIdentityParams) => {
    try {
      await ipc.invoke("identity:create", params);
      toast.success("Universal Identity created! 🎉");
      refetchIdentity();
    } catch (e: any) {
      toast.error(`Failed: ${e.message}`);
    }
  }, [ipc, refetchIdentity]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex-shrink-0 flex items-center justify-between gap-4 p-4 border-b border-border/50">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-violet-500 to-blue-600 flex items-center justify-center">
            <Fingerprint className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold">Universal Identity</h1>
            <p className="text-[11px] text-muted-foreground/70">
              Create once, use everywhere — P2P Chat, Creator Network, Marketplace, Governance, Federation
            </p>
          </div>
        </div>
        {identity && (
          <Button variant="outline" size="sm" onClick={() => refetchIdentity()}>
            <RefreshCw className="w-3.5 h-3.5" />
          </Button>
        )}
      </div>

      {identityLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      ) : (
        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0">
          <div className="flex-shrink-0 border-b border-border/50">
            <ScrollArea>
              <TabsList className="bg-transparent px-4 py-2 w-max">
                <TabsTrigger value="overview" className="text-xs">
                  <User className="w-3.5 h-3.5 mr-1.5" />
                  Overview
                </TabsTrigger>
                <TabsTrigger value="wallets" className="text-xs" disabled={!identity}>
                  <Wallet className="w-3.5 h-3.5 mr-1.5" />
                  Wallets
                  {identity?.wallets && (
                    <Badge variant="outline" className="ml-1.5 text-[9px] px-1 py-0">{identity.wallets.length}</Badge>
                  )}
                </TabsTrigger>
                <TabsTrigger value="names" className="text-xs" disabled={!identity}>
                  <Globe className="w-3.5 h-3.5 mr-1.5" />
                  Names
                </TabsTrigger>
                <TabsTrigger value="social" className="text-xs" disabled={!identity}>
                  <Link2 className="w-3.5 h-3.5 mr-1.5" />
                  Social
                  {identity?.socialProofs && (
                    <Badge variant="outline" className="ml-1.5 text-[9px] px-1 py-0">
                      {identity.socialProofs.filter((s) => s.verified).length}
                    </Badge>
                  )}
                </TabsTrigger>
                <TabsTrigger value="reputation" className="text-xs" disabled={!identity}>
                  <Star className="w-3.5 h-3.5 mr-1.5" />
                  Reputation
                </TabsTrigger>
                <TabsTrigger value="keys" className="text-xs" disabled={!identity}>
                  <Key className="w-3.5 h-3.5 mr-1.5" />
                  Keys & Delegation
                </TabsTrigger>
                <TabsTrigger value="views" className="text-xs" disabled={!identity}>
                  <Eye className="w-3.5 h-3.5 mr-1.5" />
                  Subsystem Views
                </TabsTrigger>
                <TabsTrigger value="events" className="text-xs" disabled={!identity}>
                  <Activity className="w-3.5 h-3.5 mr-1.5" />
                  Events
                  {events.length > 0 && (
                    <Badge variant="outline" className="ml-1.5 text-[9px] px-1 py-0">{events.length}</Badge>
                  )}
                </TabsTrigger>
              </TabsList>
            </ScrollArea>
          </div>

          <TabsContent value="overview" className="flex-1 m-0 overflow-auto p-4">
            <IdentityOverview
              identity={identity || null}
              onEdit={() => toast.info("Edit identity coming soon")}
              onCreate={() => setCreateDialogOpen(true)}
            />
            {identity && (
              <div className="mt-4">
                <SubsystemViews identity={identity} />
              </div>
            )}
          </TabsContent>

          <TabsContent value="wallets" className="flex-1 m-0 overflow-auto p-4">
            <WalletsPanel
              wallets={identity?.wallets || []}
              onAddWallet={() => toast.info("Connect your wallet")}
              onRemoveWallet={(addr, chain) => toast.info(`Remove ${addr} from ${chain}`)}
              onSetPrimary={(addr, chain) => toast.info(`Set ${addr} as primary on ${chain}`)}
            />
          </TabsContent>

          <TabsContent value="names" className="flex-1 m-0 overflow-auto p-4">
            <NameServicePanel
              ensRecords={ensRecords}
              jnsRecords={jnsRecords}
              onLinkENS={() => toast.info("Link ENS name")}
              onRegisterJNS={() => toast.info("Register .joy name")}
              onEditTextRecords={(name) => toast.info(`Edit text records for ${name}`)}
            />
          </TabsContent>

          <TabsContent value="social" className="flex-1 m-0 overflow-auto p-4">
            <SocialProofsPanel
              proofs={identity?.socialProofs || []}
              onLink={(platform) => toast.info(`Link ${platform}`)}
              onVerify={(platform) => toast.info(`Verify ${platform}`)}
              onUnlink={(platform) => toast.info(`Unlink ${platform}`)}
            />
          </TabsContent>

          <TabsContent value="reputation" className="flex-1 m-0 overflow-auto p-4">
            <ReputationPanel reputation={identity?.reputation || null} />
          </TabsContent>

          <TabsContent value="keys" className="flex-1 m-0 overflow-auto p-4">
            <DelegationPanel
              keys={identity?.keys || null}
              delegations={delegations}
              onGrantDelegation={() => toast.info("Grant delegation")}
              onRevokeDelegation={(did) => toast.info(`Revoke delegation for ${did}`)}
              onRotateKeys={() => toast.info("Key rotation")}
            />
          </TabsContent>

          <TabsContent value="views" className="flex-1 m-0 overflow-auto p-4">
            {identity && <SubsystemViews identity={identity} />}
          </TabsContent>

          <TabsContent value="events" className="flex-1 m-0 overflow-auto p-4">
            <EventsPanel events={events} isLoading={eventsLoading} />
          </TabsContent>
        </Tabs>
      )}

      {/* Create Dialog */}
      <CreateIdentityDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        onCreate={handleCreateIdentity}
      />
    </div>
  );
}
