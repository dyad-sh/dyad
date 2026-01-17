/**
 * Sovereign Data Vault Component
 * Central dashboard for managing all local-first encrypted data
 */

import * as React from "react";
import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Shield,
  Lock,
  Key,
  HardDrive,
  Globe,
  Cloud,
  Database,
  Search,
  Filter,
  MoreHorizontal,
  Download,
  Upload,
  Trash2,
  Share2,
  Eye,
  Copy,
  ExternalLink,
  RefreshCw,
  Settings,
  Fingerprint,
  Hash,
  FileText,
  Bot,
  Workflow,
  Code,
  Brain,
  Coins,
  TrendingUp,
  Activity,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  Info,
  Sparkles,
} from "lucide-react";
import {
  useDataVault,
  useSovereignDataList,
  useSovereignData,
  useSyncToNetwork,
  useDeleteData,
  useShareData,
  useUpdateVaultConfig,
  useOutboxJobs,
  useQueueSync,
  useQueueShare,
  useProcessOutbox,
  useUpdateConsent,
} from "@/ipc/sovereign_data_client";
import type {
  SovereignData,
  DataType,
  DataVisibility,
  StorageNetwork,
} from "@/types/sovereign_data";

// ============================================================================
// Types
// ============================================================================

interface DataVaultProps {
  className?: string;
  onSelectData?: (data: SovereignData) => void;
}

// ============================================================================
// Constants
// ============================================================================

const DATA_TYPE_CONFIG: Record<
  DataType,
  { label: string; icon: React.ComponentType<{ className?: string }>; color: string }
> = {
  "model-weights": { label: "Model Weights", icon: Brain, color: "text-purple-500" },
  "model-config": { label: "Model Config", icon: Settings, color: "text-blue-500" },
  "training-data": { label: "Training Data", icon: Database, color: "text-orange-500" },
  embeddings: { label: "Embeddings", icon: Hash, color: "text-pink-500" },
  "inference-result": { label: "Inference Result", icon: Sparkles, color: "text-yellow-500" },
  "agent-config": { label: "Agent Config", icon: Bot, color: "text-green-500" },
  "agent-memory": { label: "Agent Memory", icon: Brain, color: "text-cyan-500" },
  "prompt-template": { label: "Prompt Template", icon: FileText, color: "text-indigo-500" },
  "source-code": { label: "Source Code", icon: Code, color: "text-gray-500" },
  "compiled-app": { label: "Compiled App", icon: Globe, color: "text-blue-400" },
  "web-component": { label: "Web Component", icon: Code, color: "text-teal-500" },
  "api-definition": { label: "API Definition", icon: Globe, color: "text-violet-500" },
  schema: { label: "Schema", icon: FileText, color: "text-amber-500" },
  dataset: { label: "Dataset", icon: Database, color: "text-emerald-500" },
  document: { label: "Document", icon: FileText, color: "text-slate-500" },
  media: { label: "Media", icon: Eye, color: "text-rose-500" },
  "structured-data": { label: "Structured Data", icon: Database, color: "text-lime-500" },
  "personal-data": { label: "Personal Data", icon: Lock, color: "text-red-500" },
  "browsing-history": { label: "Browsing History", icon: Globe, color: "text-gray-400" },
  preferences: { label: "Preferences", icon: Settings, color: "text-blue-300" },
  "health-data": { label: "Health Data", icon: Activity, color: "text-green-400" },
  "financial-data": { label: "Financial Data", icon: Coins, color: "text-yellow-400" },
  "workflow-definition": { label: "Workflow", icon: Workflow, color: "text-purple-400" },
  "automation-script": { label: "Automation", icon: Sparkles, color: "text-orange-400" },
  "integration-config": { label: "Integration", icon: Share2, color: "text-cyan-400" },
};

const NETWORK_CONFIG: Record<
  StorageNetwork,
  { label: string; icon: React.ComponentType<{ className?: string }>; color: string }
> = {
  local: { label: "Local", icon: HardDrive, color: "text-green-500" },
  ipfs: { label: "IPFS", icon: Globe, color: "text-blue-500" },
  arweave: { label: "Arweave", icon: Database, color: "text-yellow-500" },
  filecoin: { label: "Filecoin", icon: Cloud, color: "text-purple-500" },
  ceramic: { label: "Ceramic", icon: Database, color: "text-orange-500" },
  "orbit-db": { label: "OrbitDB", icon: Globe, color: "text-teal-500" },
  gun: { label: "GUN", icon: Globe, color: "text-red-500" },
  polybase: { label: "Polybase", icon: Shield, color: "text-indigo-500" },
};

// ============================================================================
// Component
// ============================================================================

export function DataVault({ className, onSelectData }: DataVaultProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState<DataType | "all">("all");
  const [filterVisibility, setFilterVisibility] = useState<DataVisibility | "all">("all");
  const [filterNetwork, setFilterNetwork] = useState<StorageNetwork | "all">("all");
  const [selectedDataId, setSelectedDataId] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [dataToDelete, setDataToDelete] = useState<SovereignData | null>(null);
  const [shareForm, setShareForm] = useState({
    dataId: "",
    recipientPublicKey: "",
    permissions: "read",
  });
  const [consentDialogOpen, setConsentDialogOpen] = useState(false);
  const [consentTarget, setConsentTarget] = useState<SovereignData | null>(null);
  const [consentForm, setConsentForm] = useState({
    outboundGranted: false,
    paymentTxHash: "",
  });

  // Queries
  const { data: vault, isLoading: vaultLoading } = useDataVault();
  const { data: allData, isLoading: dataLoading, refetch } = useSovereignDataList(
    filterType !== "all" || filterVisibility !== "all" || filterNetwork !== "all"
      ? {
          dataType: filterType !== "all" ? filterType : undefined,
          visibility: filterVisibility !== "all" ? filterVisibility : undefined,
          network: filterNetwork !== "all" ? filterNetwork : undefined,
        }
      : undefined
  );

  // Mutations
  const deleteDataMutation = useDeleteData();
  const syncToNetworkMutation = useSyncToNetwork();
  const updateVaultConfigMutation = useUpdateVaultConfig();
  const queueSyncMutation = useQueueSync();
  const queueShareMutation = useQueueShare();
  const processOutboxMutation = useProcessOutbox();
  const { data: outboxJobs = [] } = useOutboxJobs();
  const updateConsentMutation = useUpdateConsent();

  const updateConsent = async () => {
    if (!consentTarget) return;
    await updateConsentMutation.mutateAsync({
      dataId: consentTarget.id,
      outboundGranted: consentForm.outboundGranted,
      paymentTxHash: consentForm.paymentTxHash || undefined,
    });
    setConsentDialogOpen(false);
    setConsentTarget(null);
  };

  // Computed
  const filteredData = React.useMemo(() => {
    if (!allData) return [];
    if (!searchQuery) return allData;
    
    const query = searchQuery.toLowerCase();
    return allData.filter(
      (d) =>
        d.metadata.name.toLowerCase().includes(query) ||
        d.metadata.tags.some((t) => t.toLowerCase().includes(query)) ||
        d.metadata.description?.toLowerCase().includes(query)
    );
  }, [allData, searchQuery]);

  const stats = React.useMemo(() => {
    if (!allData) return null;
    
    const totalSize = allData.reduce((sum, d) => {
      const localHash = d.hashes.find((h) => h.network === "local");
      return sum + (localHash?.size || 0);
    }, 0);

    const byType: Record<string, number> = {};
    const byVisibility: Record<string, number> = {};
    const byNetwork: Record<string, number> = {};

    for (const d of allData) {
      byType[d.dataType] = (byType[d.dataType] || 0) + 1;
      byVisibility[d.visibility] = (byVisibility[d.visibility] || 0) + 1;
      for (const h of d.hashes) {
        byNetwork[h.network] = (byNetwork[h.network] || 0) + 1;
      }
    }

    return { totalSize, byType, byVisibility, byNetwork };
  }, [allData]);

  // Handlers
  const handleDelete = async () => {
    if (!dataToDelete) return;
    
    try {
      await deleteDataMutation.mutateAsync(dataToDelete.id);
      setDeleteDialogOpen(false);
      setDataToDelete(null);
    } catch (error) {
      console.error("Failed to delete:", error);
    }
  };

  const handleSync = async (dataId: string, network: StorageNetwork) => {
    try {
      await syncToNetworkMutation.mutateAsync({ dataId, network });
    } catch (error) {
      console.error("Failed to sync:", error);
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  };

  const copyHash = (hash: string) => {
    navigator.clipboard.writeText(hash);
  };

  // ============================================================================
  // Render Functions
  // ============================================================================

  const renderVaultHeader = () => (
    <div className="flex items-center justify-between mb-6">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-primary/10">
          <Fingerprint className="h-6 w-6 text-primary" />
        </div>
        <div>
          <h2 className="text-2xl font-bold">Sovereign Data Vault</h2>
          <p className="text-sm text-muted-foreground">
            {vault?.did || "Loading identity..."}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
        <Button variant="outline" size="sm">
          <Settings className="h-4 w-4 mr-2" />
          Settings
        </Button>
      </div>
    </div>
  );

  const renderStats = () => (
    <div className="grid grid-cols-4 gap-4 mb-6">
      <Card>
        <CardContent className="pt-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-green-500/10">
              <Database className="h-5 w-5 text-green-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{allData?.length || 0}</p>
              <p className="text-sm text-muted-foreground">Total Items</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-500/10">
              <HardDrive className="h-5 w-5 text-blue-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{formatBytes(stats?.totalSize || 0)}</p>
              <p className="text-sm text-muted-foreground">Total Size</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-purple-500/10">
              <Lock className="h-5 w-5 text-purple-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">
                {allData?.filter((d) => d.encrypted).length || 0}
              </p>
              <p className="text-sm text-muted-foreground">Encrypted</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-yellow-500/10">
              <Coins className="h-5 w-5 text-yellow-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">
                ${vault?.stats.totalRevenue?.toFixed(2) || "0.00"}
              </p>
              <p className="text-sm text-muted-foreground">Total Revenue</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );

  const renderFilters = () => (
    <div className="flex items-center gap-4 mb-4">
      <div className="flex-1 relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search by name, tags, or description..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-9"
        />
      </div>

      <Select value={filterType} onValueChange={(v) => setFilterType(v as any)}>
        <SelectTrigger className="w-40">
          <SelectValue placeholder="All Types" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Types</SelectItem>
          {Object.entries(DATA_TYPE_CONFIG).map(([type, config]) => (
            <SelectItem key={type} value={type}>
              {config.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={filterVisibility}
        onValueChange={(v) => setFilterVisibility(v as any)}
      >
        <SelectTrigger className="w-32">
          <SelectValue placeholder="Visibility" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All</SelectItem>
          <SelectItem value="private">Private</SelectItem>
          <SelectItem value="shared">Shared</SelectItem>
          <SelectItem value="public">Public</SelectItem>
          <SelectItem value="marketplace">Marketplace</SelectItem>
        </SelectContent>
      </Select>

      <Select value={filterNetwork} onValueChange={(v) => setFilterNetwork(v as any)}>
        <SelectTrigger className="w-32">
          <SelectValue placeholder="Network" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Networks</SelectItem>
          <SelectItem value="local">Local</SelectItem>
          <SelectItem value="ipfs">IPFS</SelectItem>
          <SelectItem value="arweave">Arweave</SelectItem>
          <SelectItem value="filecoin">Filecoin</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );

  const renderDataTable = () => (
    <Card>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Visibility</TableHead>
            <TableHead>Networks</TableHead>
            <TableHead>Size</TableHead>
            <TableHead>Created</TableHead>
            <TableHead className="w-10"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filteredData.map((data) => {
            const typeConfig = DATA_TYPE_CONFIG[data.dataType];
            const TypeIcon = typeConfig?.icon || FileText;
            const localHash = data.hashes.find((h) => h.network === "local");

            return (
              <TableRow
                key={data.id}
                className="cursor-pointer"
                onClick={() => {
                  setSelectedDataId(data.id);
                  onSelectData?.(data);
                }}
              >
                <TableCell>
                  <div className="flex items-center gap-3">
                    <div className={`p-1.5 rounded ${typeConfig?.color || "text-gray-500"}`}>
                      <TypeIcon className="h-4 w-4" />
                    </div>
                    <div>
                      <div className="font-medium">{data.metadata.name}</div>
                      {data.metadata.tags.length > 0 && (
                        <div className="flex gap-1 mt-1">
                          {data.metadata.tags.slice(0, 3).map((tag) => (
                            <Badge key={tag} variant="outline" className="text-xs">
                              {tag}
                            </Badge>
                          ))}
                        </div>
                      )}
                      {data.dataType === "training-data" && (
                        <div className="mt-1">
                          <Badge
                            variant="secondary"
                            className="text-xs"
                          >
                            {data.metadata.consent?.training?.granted ? "Training consent" : "Consent required"}
                          </Badge>
                        </div>
                      )}
                      {!data.metadata.consent?.outbound?.granted && (
                        <div className="mt-1">
                          <Badge variant="secondary" className="text-xs">
                            Outbound blocked
                          </Badge>
                        </div>
                      )}
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant="secondary">{typeConfig?.label || data.dataType}</Badge>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1.5">
                    {data.visibility === "private" && <Lock className="h-3.5 w-3.5" />}
                    {data.visibility === "shared" && <Share2 className="h-3.5 w-3.5" />}
                    {data.visibility === "public" && <Globe className="h-3.5 w-3.5" />}
                    {data.visibility === "marketplace" && <Coins className="h-3.5 w-3.5" />}
                    <span className="capitalize">{data.visibility}</span>
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    {data.hashes.map((hash) => {
                      const netConfig = NETWORK_CONFIG[hash.network];
                      const NetIcon = netConfig?.icon || Globe;
                      return (
                        <Badge
                          key={hash.network}
                          variant="outline"
                          className={netConfig?.color}
                        >
                          <NetIcon className="h-3 w-3 mr-1" />
                          {netConfig?.label || hash.network}
                        </Badge>
                      );
                    })}
                  </div>
                </TableCell>
                <TableCell>{formatBytes(localHash?.size || 0)}</TableCell>
                <TableCell>
                  {new Date(data.createdAt).toLocaleDateString()}
                </TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                      <Button variant="ghost" size="icon">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={(e) => e.stopPropagation()}>
                        <Eye className="h-4 w-4 mr-2" />
                        View Details
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={(e) => {
                          e.stopPropagation();
                          copyHash(localHash?.hash || "");
                        }}
                      >
                        <Copy className="h-4 w-4 mr-2" />
                        Copy Hash
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSync(data.id, "ipfs");
                        }}
                      >
                        <Globe className="h-4 w-4 mr-2" />
                        Sync to IPFS
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={(e) => {
                          e.stopPropagation();
                          queueSyncMutation.mutate({ dataId: data.id, network: "ipfs" });
                        }}
                      >
                        <Clock className="h-4 w-4 mr-2" />
                        Queue Sync to IPFS
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSync(data.id, "arweave");
                        }}
                      >
                        <Database className="h-4 w-4 mr-2" />
                        Store on Arweave
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={(e) => {
                          e.stopPropagation();
                          queueSyncMutation.mutate({ dataId: data.id, network: "arweave" });
                        }}
                      >
                        <Clock className="h-4 w-4 mr-2" />
                        Queue Sync to Arweave
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem>
                        <Download className="h-4 w-4 mr-2" />
                        Export
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={(e) => {
                          e.stopPropagation();
                          setConsentTarget(data);
                          setConsentForm({
                            outboundGranted: data.metadata.consent?.outbound?.granted ?? false,
                            paymentTxHash: data.metadata.consent?.outbound?.paymentTxHash || "",
                          });
                          setConsentDialogOpen(true);
                        }}
                      >
                        <Shield className="h-4 w-4 mr-2" />
                        Outbound Consent
                      </DropdownMenuItem>
                      <DropdownMenuItem>
                        <Share2 className="h-4 w-4 mr-2" />
                        Share
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-destructive"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDataToDelete(data);
                          setDeleteDialogOpen(true);
                        }}
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            );
          })}
          {filteredData.length === 0 && (
            <TableRow>
              <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                {dataLoading ? "Loading..." : "No data found"}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </Card>
  );

  const renderNetworkStatus = () => (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Storage Networks</CardTitle>
        <CardDescription>Configure where your data is replicated</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {vault?.storageConfig.map((config) => {
          const netConfig = NETWORK_CONFIG[config.network];
          const NetIcon = netConfig?.icon || Globe;
          const usage = vault.stats.networkUsage.find((u) => u.network === config.network);

          return (
            <div key={config.network} className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-lg bg-muted ${netConfig?.color}`}>
                  <NetIcon className="h-4 w-4" />
                </div>
                <div>
                  <div className="font-medium">{netConfig?.label || config.network}</div>
                  <div className="text-sm text-muted-foreground">
                    {usage ? `${usage.itemCount} items · ${formatBytes(usage.bytesStored)}` : "Not used"}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {config.enabled ? (
                  <Badge variant="default" className="bg-green-500">
                    <CheckCircle2 className="h-3 w-3 mr-1" />
                    Enabled
                  </Badge>
                ) : (
                  <Badge variant="secondary">
                    <XCircle className="h-3 w-3 mr-1" />
                    Disabled
                  </Badge>
                )}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );

  // ============================================================================
  // Main Render
  // ============================================================================

  return (
    <div className={className}>
      {renderVaultHeader()}
      {renderStats()}
      
      <Tabs defaultValue="data" className="space-y-4">
        <TabsList>
          <TabsTrigger value="data">My Data</TabsTrigger>
          <TabsTrigger value="networks">Networks</TabsTrigger>
          <TabsTrigger value="sharing">Shared</TabsTrigger>
          <TabsTrigger value="marketplace">Marketplace</TabsTrigger>
        </TabsList>

        <TabsContent value="data" className="space-y-4">
          {renderFilters()}
          {renderDataTable()}
        </TabsContent>

        <TabsContent value="networks">
          <div className="space-y-4">
            {renderNetworkStatus()}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Training Consent Policy</CardTitle>
                <CardDescription>
                  Enforce explicit consent before training data can be shared or listed.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex items-center justify-between">
                <div className="space-y-1">
                  <p className="text-sm font-medium">Require consent for training exports</p>
                  <p className="text-xs text-muted-foreground">
                    Blocks sync, sharing, and listings for training data without consent.
                  </p>
                </div>
                <Switch
                  checked={vault?.policies?.training?.requireConsent ?? true}
                  onCheckedChange={(checked) =>
                    updateVaultConfigMutation.mutate({
                      policies: {
                        training: {
                          requireConsent: checked,
                          requirePayment: vault?.policies?.training?.requirePayment ?? false,
                        },
                        outbound: {
                          requireConsent: vault?.policies?.outbound?.requireConsent ?? true,
                          requirePayment: vault?.policies?.outbound?.requirePayment ?? true,
                        },
                      },
                    })
                  }
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Outbound Policy</CardTitle>
                <CardDescription>
                  Require explicit consent and payment proof before data leaves this device.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <p className="text-sm font-medium">Require outbound consent</p>
                    <p className="text-xs text-muted-foreground">
                      Blocks sync, share, and listings without explicit consent.
                    </p>
                  </div>
                  <Switch
                    checked={vault?.policies?.outbound?.requireConsent ?? true}
                    onCheckedChange={(checked) =>
                      updateVaultConfigMutation.mutate({
                        policies: {
                          training: {
                            requireConsent: vault?.policies?.training?.requireConsent ?? true,
                            requirePayment: vault?.policies?.training?.requirePayment ?? false,
                          },
                          outbound: {
                            requireConsent: checked,
                            requirePayment: vault?.policies?.outbound?.requirePayment ?? true,
                          },
                        },
                      })
                    }
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <p className="text-sm font-medium">Require payment proof</p>
                    <p className="text-xs text-muted-foreground">
                      Enforces a payment tx hash in outbound consent.
                    </p>
                  </div>
                  <Switch
                    checked={vault?.policies?.outbound?.requirePayment ?? true}
                    onCheckedChange={(checked) =>
                      updateVaultConfigMutation.mutate({
                        policies: {
                          training: {
                            requireConsent: vault?.policies?.training?.requireConsent ?? true,
                            requirePayment: vault?.policies?.training?.requirePayment ?? false,
                          },
                          outbound: {
                            requireConsent: vault?.policies?.outbound?.requireConsent ?? true,
                            requirePayment: checked,
                          },
                        },
                      })
                    }
                  />
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="sharing">
          <div className="grid grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Queue Encrypted Share</CardTitle>
                <CardDescription>
                  Prepare a share package for offline delivery.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Data ID</Label>
                  <Input
                    value={shareForm.dataId}
                    onChange={(e) =>
                      setShareForm((prev) => ({ ...prev, dataId: e.target.value }))
                    }
                    placeholder="data id"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Recipient Public Key</Label>
                  <Input
                    value={shareForm.recipientPublicKey}
                    onChange={(e) =>
                      setShareForm((prev) => ({
                        ...prev,
                        recipientPublicKey: e.target.value,
                      }))
                    }
                    placeholder="recipient public key"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Permissions (comma separated)</Label>
                  <Input
                    value={shareForm.permissions}
                    onChange={(e) =>
                      setShareForm((prev) => ({ ...prev, permissions: e.target.value }))
                    }
                    placeholder="read, train-ai"
                  />
                </div>
                <Button
                  onClick={() =>
                    queueShareMutation.mutate({
                      dataId: shareForm.dataId,
                      recipientPublicKey: shareForm.recipientPublicKey,
                      permissions: shareForm.permissions
                        .split(",")
                        .map((perm) => perm.trim())
                        .filter(Boolean),
                    })
                  }
                  disabled={queueShareMutation.isPending}
                >
                  {queueShareMutation.isPending ? "Queuing..." : "Queue Share"}
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-lg">Outbox</CardTitle>
                    <CardDescription>Queued sync and share jobs</CardDescription>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => processOutboxMutation.mutate()}
                    disabled={processOutboxMutation.isPending}
                  >
                    {processOutboxMutation.isPending ? "Processing..." : "Process Outbox"}
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                {outboxJobs.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Outbox is empty.</p>
                ) : (
                  <ScrollArea className="h-[260px] pr-2">
                    <div className="space-y-2">
                      {outboxJobs.map((job) => (
                        <div key={job.id} className="border rounded-md p-2 text-xs">
                          <div className="flex items-center justify-between">
                            <span className="font-mono">{job.id}</span>
                            <Badge variant="outline">{job.status}</Badge>
                          </div>
                          <div className="text-muted-foreground">
                            {job.type} • {job.dataId}
                            {job.network ? ` • ${job.network}` : ""}
                          </div>
                          {job.error && (
                            <div className="text-red-500 mt-1">{job.error}</div>
                          )}
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="marketplace">
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              <Coins className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>Your marketplace listings will appear here</p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Data?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete "{dataToDelete?.metadata.name}" from your local
              storage. Data synced to decentralized networks may still exist there.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Outbound Consent Dialog */}
      <AlertDialog open={consentDialogOpen} onOpenChange={setConsentDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Outbound Consent</AlertDialogTitle>
            <AlertDialogDescription>
              Approve outbound sharing and attach payment proof if required.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Label>Allow outbound use</Label>
              <Switch
                checked={consentForm.outboundGranted}
                onCheckedChange={(checked) =>
                  setConsentForm((prev) => ({ ...prev, outboundGranted: checked }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label>Payment Tx Hash (optional)</Label>
              <Input
                value={consentForm.paymentTxHash}
                onChange={(e) =>
                  setConsentForm((prev) => ({ ...prev, paymentTxHash: e.target.value }))
                }
                placeholder="0x..."
              />
            </div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={updateConsent}>
              Save Consent
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default DataVault;
