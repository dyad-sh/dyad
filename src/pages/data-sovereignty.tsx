/**
 * Data Sovereignty Page
 * Central hub for local-first, user-owned data management
 * All data encrypted and stored with decentralized network support
 */

import * as React from "react";
import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Shield,
  Lock,
  Key,
  HardDrive,
  Globe,
  Cloud,
  Database,
  Fingerprint,
  Hash,
  Coins,
  TrendingUp,
  Settings,
  RefreshCw,
  Plus,
  Upload,
  Download,
  Bot,
  Brain,
  Code,
  FileText,
  Workflow,
  Sparkles,
  Eye,
  Share2,
  DollarSign,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Info,
  Zap,
  Network,
  Users,
  Building2,
} from "lucide-react";
import { DataVault } from "@/components/sovereign/DataVault";
import { SovereignCreator } from "@/components/sovereign/SovereignCreator";
import {
  useDataVault,
  useSovereignDataList,
  useListings,
} from "@/ipc/sovereign_data_client";
import type { StorageNetwork, DataType } from "@/types/sovereign_data";

// ============================================================================
// Constants
// ============================================================================

const QUICK_ACTIONS = [
  {
    id: "store-agent",
    title: "Store Agent",
    description: "Save an AI agent to your vault",
    icon: Bot,
    color: "from-green-500 to-emerald-500",
    dataType: "agent-config" as DataType,
  },
  {
    id: "store-model",
    title: "Store Model",
    description: "Save model weights locally",
    icon: Brain,
    color: "from-purple-500 to-violet-500",
    dataType: "model-weights" as DataType,
  },
  {
    id: "store-workflow",
    title: "Store Workflow",
    description: "Save an automation workflow",
    icon: Workflow,
    color: "from-blue-500 to-indigo-500",
    dataType: "workflow-definition" as DataType,
  },
  {
    id: "store-data",
    title: "Store Dataset",
    description: "Save training or personal data",
    icon: Database,
    color: "from-orange-500 to-amber-500",
    dataType: "dataset" as DataType,
  },
  {
    id: "store-code",
    title: "Store Code",
    description: "Save source code or components",
    icon: Code,
    color: "from-cyan-500 to-teal-500",
    dataType: "source-code" as DataType,
  },
  {
    id: "store-prompt",
    title: "Store Prompt",
    description: "Save prompt templates",
    icon: Sparkles,
    color: "from-pink-500 to-rose-500",
    dataType: "prompt-template" as DataType,
  },
];

const NETWORK_INFO = [
  {
    network: "local" as StorageNetwork,
    name: "Local Encrypted",
    description: "Data stored only on your device with AES-256 encryption",
    icon: HardDrive,
    color: "text-green-500",
    benefits: ["Instant access", "Full privacy", "No costs", "Works offline"],
  },
  {
    network: "ipfs" as StorageNetwork,
    name: "IPFS / Helia",
    description: "Content-addressed distributed storage network",
    icon: Globe,
    color: "text-blue-500",
    benefits: ["Decentralized", "Content-addressed", "Censorship resistant", "Global availability"],
  },
  {
    network: "arweave" as StorageNetwork,
    name: "Arweave",
    description: "Permanent, immutable storage - pay once, store forever",
    icon: Database,
    color: "text-yellow-500",
    benefits: ["Permanent storage", "One-time payment", "Immutable", "Proof of access"],
  },
  {
    network: "filecoin" as StorageNetwork,
    name: "Filecoin",
    description: "Decentralized storage with cryptographic proofs",
    icon: Cloud,
    color: "text-purple-500",
    benefits: ["Verifiable storage", "Economic incentives", "Large scale", "Storage deals"],
  },
];

// ============================================================================
// Component
// ============================================================================

export default function DataSovereigntyPage() {
  const navigate = useNavigate();
  const [selectedDataType, setSelectedDataType] = useState<DataType | null>(null);
  const [creatorOpen, setCreatorOpen] = useState(false);

  // Queries
  const { data: vault, isLoading: vaultLoading } = useDataVault();
  const { data: allData } = useSovereignDataList();
  const { data: listings } = useListings();

  // Computed stats
  const stats = React.useMemo(() => {
    if (!allData || !vault) return null;

    const totalItems = allData.length;
    const encryptedCount = allData.filter((d) => d.encrypted).length;
    const marketplaceCount = allData.filter((d) => d.visibility === "marketplace").length;
    
    const networkCounts: Record<string, number> = {};
    for (const d of allData) {
      for (const h of d.hashes) {
        networkCounts[h.network] = (networkCounts[h.network] || 0) + 1;
      }
    }

    return {
      totalItems,
      encryptedCount,
      marketplaceCount,
      totalRevenue: vault.stats.totalRevenue,
      networkCounts,
    };
  }, [allData, vault]);

  const handleQuickAction = (action: typeof QUICK_ACTIONS[0]) => {
    setSelectedDataType(action.dataType);
    setCreatorOpen(true);
  };

  // ============================================================================
  // Render Functions
  // ============================================================================

  const renderHeader = () => (
    <div className="relative overflow-hidden rounded-xl bg-gradient-to-r from-violet-500/10 via-purple-500/10 to-pink-500/10 border border-violet-500/20 p-8 mb-6">
      <div className="absolute inset-0 bg-grid-white/5" />
      <div className="relative flex items-start justify-between">
        <div className="flex items-center gap-4">
          <div className="p-3 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 shadow-lg shadow-violet-500/25">
            <Shield className="h-8 w-8 text-white" />
          </div>
          <div>
            <h1 className="text-3xl font-bold bg-gradient-to-r from-violet-600 via-purple-600 to-pink-600 bg-clip-text text-transparent">
              Data Sovereignty
            </h1>
            <p className="text-muted-foreground mt-1 max-w-xl">
              Own your data. All information is encrypted locally with your keys.
              Choose to replicate to decentralized networks for permanence and availability.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right mr-4">
            <div className="text-sm text-muted-foreground">Your Identity</div>
            <div className="font-mono text-xs">{vault?.did?.slice(0, 24) || "Loading..."}...</div>
          </div>
          <Button variant="outline">
            <Settings className="h-4 w-4 mr-2" />
            Settings
          </Button>
        </div>
      </div>

      {/* Key Stats Row */}
      <div className="relative grid grid-cols-5 gap-4 mt-6">
        <div className="bg-background/60 rounded-lg p-4 border border-border/50">
          <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
            <Database className="h-4 w-4" />
            Total Items
          </div>
          <div className="text-2xl font-bold">{stats?.totalItems || 0}</div>
        </div>
        <div className="bg-background/60 rounded-lg p-4 border border-border/50">
          <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
            <Lock className="h-4 w-4" />
            Encrypted
          </div>
          <div className="text-2xl font-bold">{stats?.encryptedCount || 0}</div>
        </div>
        <div className="bg-background/60 rounded-lg p-4 border border-border/50">
          <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
            <Globe className="h-4 w-4" />
            On IPFS
          </div>
          <div className="text-2xl font-bold">{stats?.networkCounts?.ipfs || 0}</div>
        </div>
        <div className="bg-background/60 rounded-lg p-4 border border-border/50">
          <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
            <DollarSign className="h-4 w-4" />
            Marketplace
          </div>
          <div className="text-2xl font-bold">{stats?.marketplaceCount || 0}</div>
        </div>
        <div className="bg-background/60 rounded-lg p-4 border border-border/50">
          <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
            <TrendingUp className="h-4 w-4" />
            Revenue
          </div>
          <div className="text-2xl font-bold">${stats?.totalRevenue?.toFixed(2) || "0.00"}</div>
        </div>
      </div>
    </div>
  );

  const renderQuickActions = () => (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Zap className="h-5 w-5 text-yellow-500" />
          Quick Actions
        </h2>
        <Button variant="ghost" size="sm" onClick={() => setCreatorOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Custom Data
        </Button>
      </div>
      <div className="grid grid-cols-6 gap-3">
        {QUICK_ACTIONS.map((action) => (
          <Card
            key={action.id}
            className="cursor-pointer hover:shadow-lg transition-all hover:scale-105 border-border/50 overflow-hidden"
            onClick={() => handleQuickAction(action)}
          >
            <CardContent className="p-4 text-center">
              <div
                className={`inline-flex p-3 rounded-xl bg-gradient-to-br ${action.color} mb-3`}
              >
                <action.icon className="h-6 w-6 text-white" />
              </div>
              <h3 className="font-medium text-sm">{action.title}</h3>
              <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                {action.description}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );

  const renderNetworkSection = () => (
    <div className="mb-6">
      <h2 className="text-lg font-semibold flex items-center gap-2 mb-4">
        <Network className="h-5 w-5 text-blue-500" />
        Storage Networks
      </h2>
      <div className="grid grid-cols-4 gap-4">
        {NETWORK_INFO.map((net) => {
          const config = vault?.storageConfig.find((c) => c.network === net.network);
          const isEnabled = net.network === "local" || config?.enabled;

          return (
            <Card key={net.network} className="border-border/50">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-lg bg-muted ${net.color}`}>
                      <net.icon className="h-5 w-5" />
                    </div>
                    <div>
                      <CardTitle className="text-base">{net.name}</CardTitle>
                      {isEnabled ? (
                        <Badge variant="default" className="mt-1 bg-green-500/80">
                          <CheckCircle2 className="h-3 w-3 mr-1" />
                          Enabled
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="mt-1">
                          <XCircle className="h-3 w-3 mr-1" />
                          Disabled
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground mb-3">{net.description}</p>
                <div className="flex flex-wrap gap-1">
                  {net.benefits.map((b) => (
                    <Badge key={b} variant="outline" className="text-xs">
                      {b}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );

  const renderValueProposition = () => (
    <Card className="mb-6 border-border/50 bg-gradient-to-r from-emerald-500/5 via-teal-500/5 to-cyan-500/5">
      <CardContent className="p-6">
        <div className="flex items-start gap-6">
          <div className="p-3 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600">
            <Coins className="h-8 w-8 text-white" />
          </div>
          <div className="flex-1">
            <h3 className="text-xl font-bold mb-2">Your Data, Your Value</h3>
            <p className="text-muted-foreground mb-4">
              In the old web, big tech harvests your data for free and sells it for billions.
              With sovereign data, YOU own your data and YOU decide who pays for access.
            </p>
            <div className="grid grid-cols-4 gap-4">
              <div className="bg-background/60 rounded-lg p-4">
                <Users className="h-6 w-6 text-emerald-500 mb-2" />
                <h4 className="font-medium text-sm">Personal Data</h4>
                <p className="text-xs text-muted-foreground">
                  Sell access to your anonymized preferences and behaviors
                </p>
              </div>
              <div className="bg-background/60 rounded-lg p-4">
                <Brain className="h-6 w-6 text-purple-500 mb-2" />
                <h4 className="font-medium text-sm">AI Models</h4>
                <p className="text-xs text-muted-foreground">
                  License your fine-tuned models and embeddings
                </p>
              </div>
              <div className="bg-background/60 rounded-lg p-4">
                <Bot className="h-6 w-6 text-blue-500 mb-2" />
                <h4 className="font-medium text-sm">Agents</h4>
                <p className="text-xs text-muted-foreground">
                  Monetize your custom AI agents and workflows
                </p>
              </div>
              <div className="bg-background/60 rounded-lg p-4">
                <Building2 className="h-6 w-6 text-orange-500 mb-2" />
                <h4 className="font-medium text-sm">Enterprise</h4>
                <p className="text-xs text-muted-foreground">
                  Companies pay for access instead of stealing data
                </p>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );

  // ============================================================================
  // Main Render
  // ============================================================================

  return (
    <div className="h-full overflow-auto">
      <div className="container max-w-7xl mx-auto py-6 px-4">
        {renderHeader()}
        {renderValueProposition()}
        {renderQuickActions()}
        {renderNetworkSection()}

        <Separator className="my-6" />

        {/* Main Data Vault */}
        <DataVault />

        {/* Sovereign Creator Dialog */}
        <SovereignCreator
          dataType={selectedDataType || "dataset"}
          open={creatorOpen}
          onOpenChange={setCreatorOpen}
          onCreated={(dataId, hashes) => {
            console.log("Created sovereign data:", dataId, hashes);
          }}
        />
      </div>
    </div>
  );
}
