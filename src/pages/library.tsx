import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { usePrompts } from "@/hooks/usePrompts";
import {
  CreatePromptDialog,
  CreateOrEditPromptDialog,
} from "@/components/CreatePromptDialog";
import { DeleteConfirmationDialog } from "@/components/DeleteConfirmationDialog";
import { useDeepLink } from "@/contexts/DeepLinkContext";
import { AddPromptDeepLinkData } from "@/ipc/deep_link_data";
import { showInfo } from "@/lib/toast";
import {
  useLibraryItems,
  useUploadToLibrary,
  useImportLibraryBuffer,
  useDeleteLibraryItem,
  useUpdateLibraryItem,
  useStoreToIpfs,
  usePinToRemote,
  useStoreToArweave,
  useStoreToFilecoin,
  useStoreToCelestia,
  useCelestiaStatus,
  useCelestiaBlobStats,
  useLibraryItemContent,
  type LibraryItem,
  type LibraryFilters,
} from "@/hooks/useLibrary";
import { AGENT_TEMPLATES } from "@/constants/agent_templates";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  BookOpen,
  Sparkles,
  Upload,
  FileText,
  FileImage,
  FileAudio,
  FileVideo,
  File,
  Hash,
  HardDrive,
  Globe,
  Pin,
  Cloud,
  Database,
  MoreVertical,
  Copy,
  Pencil,
  Trash2,
  Eye,
  Search,
  Bot,
  MessageSquare,
  FolderOpen,
  Layers,
  Wifi,
  WifiOff,
  ShieldCheck,
  Lock,
  Activity,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Send,
  FileUp,
  Clock,
  BarChart3,
  X,
  Download,
} from "lucide-react";
import { toast } from "sonner";
import { useCelestiaBlobs } from "@/hooks/useCelestiaBlobs";

// ============================================================================
// Prompt presets (shared with local-models.tsx inference playground)
// ============================================================================
const PROMPT_PRESETS = [
  {
    label: "Helpful Assistant",
    content:
      "You are a helpful, harmless, and honest AI assistant. Respond clearly and concisely.",
  },
  {
    label: "Software Engineer",
    content:
      "You are an expert software engineer. Write clean, well-documented code. Explain your reasoning. Follow best practices and design patterns.",
  },
  {
    label: "Creative Writer",
    content:
      "You are a creative writing assistant. Help craft engaging stories, poems, and narratives with vivid imagery and compelling characters.",
  },
  {
    label: "Data Analyst",
    content:
      "You are a data analysis expert. Help interpret data, create visualizations recommendations, and provide statistical insights. Be precise with numbers.",
  },
  {
    label: "Research Assistant",
    content:
      "You are a thorough research assistant. Provide detailed, well-sourced information. Distinguish between facts and opinions. Cite sources when possible.",
  },
  {
    label: "Coding Tutor",
    content:
      "You are a patient coding tutor. Explain programming concepts step by step using clear examples. Adapt to the student's skill level.",
  },
  {
    label: "Technical Writer",
    content:
      "You are a technical writing expert. Create clear documentation, API references, and guides. Use consistent formatting and precise language.",
  },
  {
    label: "DevOps Engineer",
    content:
      "You are a DevOps expert. Help with CI/CD pipelines, containerization, infrastructure as code, monitoring, and deployment strategies.",
  },
  {
    label: "Security Expert",
    content:
      "You are a cybersecurity expert. Identify vulnerabilities, suggest security best practices, and help with threat modeling. Follow OWASP guidelines.",
  },
  {
    label: "Product Manager",
    content:
      "You are an experienced product manager. Help with PRDs, user stories, feature prioritization, and product strategy. Focus on user value.",
  },
  {
    label: "Math & Science Tutor",
    content:
      "You are a math and science tutor. Break down complex problems step by step. Use examples and analogies to explain difficult concepts.",
  },
  {
    label: "Concise Mode",
    content:
      "Be extremely concise. Answer in as few words as possible while remaining accurate and helpful. No filler or pleasantries.",
  },
];

// ============================================================================
// Helpers
// ============================================================================

function getFileIcon(mimeType: string) {
  if (mimeType.startsWith("image/"))
    return <FileImage className="h-5 w-5 text-purple-500" />;
  if (mimeType.startsWith("audio/"))
    return <FileAudio className="h-5 w-5 text-pink-500" />;
  if (mimeType.startsWith("video/"))
    return <FileVideo className="h-5 w-5 text-red-500" />;
  if (
    mimeType.includes("pdf") ||
    mimeType.includes("document") ||
    mimeType.includes("text")
  )
    return <FileText className="h-5 w-5 text-blue-500" />;
  return <File className="h-5 w-5 text-muted-foreground" />;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

function tierBadge(tier: string) {
  const configs: Record<string, { label: string; className: string; icon: React.ReactNode }> = {
    local: {
      label: "Local",
      className: "bg-zinc-500/10 text-zinc-600 border-zinc-500/30",
      icon: <HardDrive className="h-3 w-3" />,
    },
    ipfs: {
      label: "IPFS",
      className: "bg-blue-500/10 text-blue-600 border-blue-500/30",
      icon: <Globe className="h-3 w-3" />,
    },
    ipfs_pinned: {
      label: "Pinned",
      className: "bg-cyan-500/10 text-cyan-600 border-cyan-500/30",
      icon: <Pin className="h-3 w-3" />,
    },
    arweave: {
      label: "Arweave",
      className: "bg-orange-500/10 text-orange-600 border-orange-500/30",
      icon: <Cloud className="h-3 w-3" />,
    },
    filecoin: {
      label: "Filecoin",
      className: "bg-green-500/10 text-green-600 border-green-500/30",
      icon: <Database className="h-3 w-3" />,
    },
    celestia: {
      label: "Celestia DA",
      className: "bg-violet-500/10 text-violet-600 border-violet-500/30",
      icon: <Layers className="h-3 w-3" />,
    },
  };
  const cfg = configs[tier] || configs.local;
  return (
    <Badge variant="outline" className={`gap-1 text-xs ${cfg.className}`}>
      {cfg.icon}
      {cfg.label}
    </Badge>
  );
}

// ============================================================================
// Main Page
// ============================================================================

export default function LibraryPage() {
  return (
    <div className="h-full overflow-y-auto px-8 py-6">
      <div className="mx-auto">
        {/* Header */}
        <div className="flex items-center gap-4 mb-6 p-6 rounded-2xl bg-gradient-to-r from-amber-500/10 via-orange-500/10 to-rose-500/10 border border-amber-500/20">
          <div className="p-3 rounded-xl bg-gradient-to-br from-amber-500/20 via-orange-500/20 to-rose-500/20 border border-amber-500/20">
            <BookOpen className="h-7 w-7 text-amber-500" />
          </div>
          <div>
            <h1 className="text-2xl font-bold bg-gradient-to-r from-amber-600 via-orange-600 to-rose-600 bg-clip-text text-transparent">
              Library
            </h1>
            <p className="text-muted-foreground text-sm">
              Store files, manage prompts, and browse templates
            </p>
          </div>
        </div>

        <Tabs defaultValue="files" className="space-y-6">
          <TabsList className="grid w-full max-w-lg grid-cols-4">
            <TabsTrigger value="files" className="gap-2">
              <FolderOpen className="h-4 w-4" />
              My Files
            </TabsTrigger>
            <TabsTrigger value="celestia" className="gap-2">
              <Layers className="h-4 w-4" />
              Celestia DA
            </TabsTrigger>
            <TabsTrigger value="prompts" className="gap-2">
              <MessageSquare className="h-4 w-4" />
              Prompts
            </TabsTrigger>
            <TabsTrigger value="templates" className="gap-2">
              <Bot className="h-4 w-4" />
              Templates
            </TabsTrigger>
          </TabsList>

          <TabsContent value="files">
            <MyFilesTab />
          </TabsContent>
          <TabsContent value="celestia">
            <CelestiaDATab />
          </TabsContent>
          <TabsContent value="prompts">
            <PromptsTab />
          </TabsContent>
          <TabsContent value="templates">
            <TemplatesTab />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

// ============================================================================
// MY FILES TAB
// ============================================================================

function MyFilesTab() {
  const [filters, setFilters] = useState<LibraryFilters>({});
  const [searchText, setSearchText] = useState("");
  const [tierFilter, setTierFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [isDragging, setIsDragging] = useState(false);
  const [autoCelestia, setAutoCelestia] = useState(false);
  const [previewItem, setPreviewItem] = useState<LibraryItem | null>(null);

  const activeFilters = useMemo(() => {
    const f: LibraryFilters = {};
    if (searchText) f.search = searchText;
    if (tierFilter !== "all") f.storageTier = tierFilter;
    if (typeFilter !== "all") f.mimeType = typeFilter;
    return f;
  }, [searchText, tierFilter, typeFilter]);

  const { data: items, isLoading } = useLibraryItems(activeFilters);
  const uploadMutation = useUploadToLibrary();
  const importBufferMutation = useImportLibraryBuffer();
  const deleteMutation = useDeleteLibraryItem();
  const updateMutation = useUpdateLibraryItem();
  const ipfsMutation = useStoreToIpfs();
  const pinMutation = usePinToRemote();
  const arweaveMutation = useStoreToArweave();
  const filecoinMutation = useStoreToFilecoin();
  const celestiaMutation = useStoreToCelestia();
  const { data: celestiaStatus } = useCelestiaStatus();
  const { data: celestiaStats } = useCelestiaBlobStats();

  const totalSize = useMemo(
    () => (items || []).reduce((acc, i) => acc + i.byteSize, 0),
    [items],
  );

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const files = Array.from(e.dataTransfer.files);
      for (const file of files) {
        const reader = new FileReader();
        reader.onload = async () => {
          const base64 = (reader.result as string).split(",")[1];
          try {
            const item = await importBufferMutation.mutateAsync({
              name: file.name,
              base64,
              mimeType: file.type || undefined,
            });
            if (autoCelestia && item?.id && celestiaStatus?.available) {
              celestiaMutation.mutate({ id: item.id });
            }
          } catch {
            // error toast already handled by mutation
          }
        };
        reader.readAsDataURL(file);
      }
    },
    [importBufferMutation, autoCelestia, celestiaStatus, celestiaMutation],
  );

  const handleCopyHash = (hash: string) => {
    navigator.clipboard.writeText(hash);
    toast.success("Hash copied to clipboard");
  };

  return (
    <div className="space-y-4">
      {/* Celestia Node Status Panel */}
      {celestiaStatus && (
        <div className={`flex items-center justify-between p-4 rounded-xl border ${
          celestiaStatus.available
            ? "bg-violet-500/5 border-violet-500/20"
            : "bg-zinc-500/5 border-zinc-500/20"
        }`}>
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg ${
              celestiaStatus.available ? "bg-violet-500/10" : "bg-zinc-500/10"
            }`}>
              {celestiaStatus.available
                ? <Wifi className="h-4 w-4 text-violet-500" />
                : <WifiOff className="h-4 w-4 text-zinc-400" />}
            </div>
            <div>
              <p className="text-sm font-medium">
                Celestia DA Node
                {celestiaStatus.available && celestiaStatus.network && (
                  <span className="ml-2 text-xs text-muted-foreground font-normal">{celestiaStatus.network}</span>
                )}
              </p>
              <p className="text-xs text-muted-foreground">
                {celestiaStatus.available
                  ? `Block ${celestiaStatus.height?.toLocaleString() || "syncing…"}${
                      celestiaStatus.balance ? ` · ${parseFloat(celestiaStatus.balance.amount).toFixed(4)} ${celestiaStatus.balance.denom}` : ""
                    }`
                  : celestiaStatus.error || "Node offline — start with celestia-start.bat"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4 text-right">
            {celestiaStats && (
              <div className="text-xs text-muted-foreground">
                <p className="font-medium text-foreground">{celestiaStats.totalBlobs} blobs</p>
                <p>{(celestiaStats.totalBytes / 1024).toFixed(1)} KB on-chain</p>
              </div>
            )}
            {celestiaStatus.available
              ? <CheckCircle2 className="h-4 w-4 text-violet-500" />
              : <AlertCircle className="h-4 w-4 text-zinc-400" />}
          </div>
        </div>
      )}

      {/* Upload Zone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        className={`border-2 border-dashed rounded-xl p-8 text-center transition-all ${
          isDragging
            ? "border-amber-500 bg-amber-500/10"
            : "border-border/50 hover:border-amber-500/50 hover:bg-amber-500/5"
        }`}
      >
        <Upload className="h-8 w-8 mx-auto mb-3 text-amber-500/60" />
        <p className="text-sm font-medium">Drag & drop files here</p>
        <p className="text-xs text-muted-foreground mt-1 mb-3">
          PDF, EPUB, DOCX, images, audio, video — any file type
        </p>
        <div className="flex items-center justify-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              try {
                const items = await uploadMutation.mutateAsync();
                if (autoCelestia && items?.length && celestiaStatus?.available) {
                  for (const item of items) {
                    if (item?.id) celestiaMutation.mutate({ id: item.id });
                  }
                }
              } catch {
                // error toast already handled by mutation
              }
            }}
            disabled={uploadMutation.isPending}
          >
            {uploadMutation.isPending ? "Uploading…" : "Browse Files"}
          </Button>
          <Button
            variant={autoCelestia ? "default" : "outline"}
            size="sm"
            className={`gap-1.5 ${autoCelestia ? "bg-violet-600 hover:bg-violet-700" : ""}`}
            onClick={() => setAutoCelestia(!autoCelestia)}
            title={celestiaStatus?.available ? "Auto-store uploads to Celestia DA" : "Celestia node offline"}
          >
            <Layers className={`h-3.5 w-3.5 ${autoCelestia ? "text-white" : "text-violet-500"}`} />
            {autoCelestia ? "Celestia DA On" : "Celestia DA"}
            {!celestiaStatus?.available && (
              <WifiOff className="h-3 w-3 text-muted-foreground" />
            )}
          </Button>
        </div>
      </div>

      {/* Stats */}
      {items && items.length > 0 && (
        <div className="flex gap-4 text-sm text-muted-foreground">
          <span>
            {items.length} file{items.length !== 1 ? "s" : ""}
          </span>
          <span>·</span>
          <span>{formatBytes(totalSize)}</span>
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-3 items-center">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search files…"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={tierFilter} onValueChange={setTierFilter}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Storage" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Storage</SelectItem>
            <SelectItem value="local">Local</SelectItem>
            <SelectItem value="ipfs">IPFS</SelectItem>
            <SelectItem value="ipfs_pinned">Pinned</SelectItem>
            <SelectItem value="arweave">Arweave</SelectItem>
            <SelectItem value="filecoin">Filecoin</SelectItem>
            <SelectItem value="celestia">Celestia DA</SelectItem>
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="application/pdf">PDF</SelectItem>
            <SelectItem value="text/">Text</SelectItem>
            <SelectItem value="image/">Images</SelectItem>
            <SelectItem value="audio/">Audio</SelectItem>
            <SelectItem value="video/">Video</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* File Grid */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Sparkles className="h-5 w-5 animate-pulse text-amber-500 mr-2" />
          <span className="text-muted-foreground">Loading files…</span>
        </div>
      ) : !items || items.length === 0 ? (
        <div className="text-center py-16">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-amber-500/10 via-orange-500/10 to-rose-500/10 border border-amber-500/20 mb-4">
            <FolderOpen className="h-8 w-8 text-amber-500/60" />
          </div>
          <p className="text-muted-foreground">
            No files yet. Upload your first file to get started.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
          {items.map((item) => (
            <FileCard
              key={item.id}
              item={item}
              onView={() => setPreviewItem(item)}
              onCopyHash={handleCopyHash}
              onDelete={(id) => deleteMutation.mutate(id)}
              onStoreIpfs={(id) => ipfsMutation.mutate(id)}
              onPinRemote={(id) => pinMutation.mutate(id)}
              onStoreArweave={(id) => arweaveMutation.mutate(id)}
              onStoreFilecoin={(id) => filecoinMutation.mutate(id)}
              onStoreCelestia={(id, encrypt) => celestiaMutation.mutate({ id, encrypt })}
              celestiaAvailable={celestiaStatus?.available ?? false}
            />
          ))}
        </div>
      )}

      {/* File Preview Dialog */}
      <FilePreviewDialog
        item={previewItem}
        onClose={() => setPreviewItem(null)}
      />
    </div>
  );
}

// ============================================================================
// File Card
// ============================================================================

function FileCard({
  item,
  onView,
  onCopyHash,
  onDelete,
  onStoreIpfs,
  onPinRemote,
  onStoreArweave,
  onStoreFilecoin,
  onStoreCelestia,
  celestiaAvailable,
}: {
  item: LibraryItem;
  onView: () => void;
  onCopyHash: (hash: string) => void;
  onDelete: (id: number) => void;
  onStoreIpfs: (id: number) => void;
  onPinRemote: (id: number) => void;
  onStoreArweave: (id: number) => void;
  onStoreFilecoin: (id: number) => void;
  onStoreCelestia: (id: number, encrypt?: boolean) => void;
  celestiaAvailable: boolean;
}) {
  return (
    <div
      className="group relative overflow-hidden border border-border/50 rounded-xl p-4 bg-gradient-to-br from-amber-500/5 via-orange-500/5 to-rose-500/5 hover:from-amber-500/10 hover:via-orange-500/10 hover:to-rose-500/10 hover:border-amber-500/30 hover:shadow-lg hover:shadow-amber-500/5 transition-all duration-300 cursor-pointer"
      onClick={onView}
    >
      <div className="flex items-start gap-3">
        <div className="p-2 rounded-lg bg-background/50 border border-border/50 shrink-0">
          {getFileIcon(item.mimeType)}
        </div>
        <div className="flex-1 min-w-0 space-y-1.5">
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-sm font-semibold truncate group-hover:text-amber-600 transition-colors">
              {item.name}
            </h3>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                  onClick={(e) => e.stopPropagation()}
                >
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                <DropdownMenuItem onClick={() => onView()}>
                  <Eye className="h-4 w-4 mr-2" />
                  View
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onCopyHash(item.contentHash)}>
                  <Copy className="h-4 w-4 mr-2" />
                  Copy Hash
                </DropdownMenuItem>
                {item.cid && (
                  <DropdownMenuItem
                    onClick={() => {
                      navigator.clipboard.writeText(item.cid!);
                      toast.success("CID copied");
                    }}
                  >
                    <Copy className="h-4 w-4 mr-2" />
                    Copy CID
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <Cloud className="h-4 w-4 mr-2" />
                    Storage Tier
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    <DropdownMenuItem onClick={() => onStoreIpfs(item.id)}>
                      <Globe className="h-4 w-4 mr-2" />
                      IPFS (Short-term)
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onPinRemote(item.id)}>
                      <Pin className="h-4 w-4 mr-2" />
                      Pin Remote (Medium-term)
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onStoreArweave(item.id)}>
                      <Cloud className="h-4 w-4 mr-2" />
                      Arweave (Permanent)
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onStoreFilecoin(item.id)}>
                      <Database className="h-4 w-4 mr-2" />
                      Filecoin (Long-term)
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => onStoreCelestia(item.id, false)}
                      disabled={!celestiaAvailable}
                      className="gap-2"
                    >
                      <Layers className="h-4 w-4 text-violet-500" />
                      Celestia DA
                      {!celestiaAvailable && <span className="text-xs text-muted-foreground ml-auto">(offline)</span>}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => onStoreCelestia(item.id, true)}
                      disabled={!celestiaAvailable}
                      className="gap-2"
                    >
                      <Lock className="h-4 w-4 text-violet-400" />
                      Celestia DA (Encrypted)
                      {!celestiaAvailable && <span className="text-xs text-muted-foreground ml-auto">(offline)</span>}
                    </DropdownMenuItem>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => onDelete(item.id)}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Size + Type */}
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>{formatBytes(item.byteSize)}</span>
            <span>·</span>
            <span>{item.mimeType.split("/")[1] || item.mimeType}</span>
          </div>

          {/* Hash + Tier badges */}
          <div className="flex items-center gap-2 flex-wrap">
            <Badge
              variant="outline"
              className="gap-1 text-xs font-mono cursor-pointer hover:bg-muted"
              onClick={() => onCopyHash(item.contentHash)}
              title={`SHA-256: ${item.contentHash}`}
            >
              <Hash className="h-3 w-3" />
              {item.contentHash.slice(0, 8)}…{item.contentHash.slice(-4)}
            </Badge>
            {tierBadge(item.storageTier)}
            {item.cid && (
              <Badge
                variant="outline"
                className="text-xs font-mono bg-blue-500/5 border-blue-500/20 text-blue-600"
                title={`CID: ${item.cid}`}
              >
                {item.cid.slice(0, 10)}…
              </Badge>
            )}
            {item.storageTier === "celestia" && (
              <Badge
                variant="outline"
                className="gap-1 text-xs bg-violet-500/5 border-violet-500/20 text-violet-600"
              >
                <ShieldCheck className="h-3 w-3" />
                DA Verified
              </Badge>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// File Preview Dialog
// ============================================================================

function FilePreviewDialog({
  item,
  onClose,
}: {
  item: LibraryItem | null;
  onClose: () => void;
}) {
  const { data: contentBase64, isLoading } = useLibraryItemContent(item?.id ?? null);

  const isImage = item?.mimeType.startsWith("image/");
  const isAudio = item?.mimeType.startsWith("audio/");
  const isVideo = item?.mimeType.startsWith("video/");
  const isPdf = item?.mimeType === "application/pdf";
  const isText =
    item?.mimeType.startsWith("text/") ||
    item?.mimeType === "application/json" ||
    item?.mimeType === "application/xml" ||
    item?.mimeType === "application/javascript";

  const textContent = useMemo(() => {
    if (!contentBase64 || !isText) return null;
    try {
      return atob(contentBase64);
    } catch {
      return null;
    }
  }, [contentBase64, isText]);

  const dataUrl = useMemo(() => {
    if (!contentBase64 || !item) return null;
    return `data:${item.mimeType};base64,${contentBase64}`;
  }, [contentBase64, item]);

  const handleDownload = () => {
    if (!dataUrl || !item) return;
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = item.name;
    a.click();
  };

  return (
    <Dialog open={!!item} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <div className="flex items-center justify-between gap-4 pr-6">
            <DialogTitle className="truncate flex items-center gap-2">
              {item && getFileIcon(item.mimeType)}
              {item?.name}
            </DialogTitle>
            <div className="flex items-center gap-2 shrink-0">
              {item && (
                <>
                  <Badge variant="outline" className="text-xs">
                    {formatBytes(item.byteSize)}
                  </Badge>
                  <Badge variant="outline" className="text-xs">
                    {item.mimeType.split("/")[1] || item.mimeType}
                  </Badge>
                  {item.storageTier === "celestia" && (
                    <Badge variant="outline" className="text-xs bg-violet-500/5 border-violet-500/20 text-violet-600 gap-1">
                      <ShieldCheck className="h-3 w-3" />
                      DA
                    </Badge>
                  )}
                </>
              )}
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleDownload} title="Download">
                <Download className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-auto rounded-lg border bg-muted/30 p-4">
          {isLoading ? (
            <div className="flex items-center justify-center h-48">
              <Sparkles className="h-5 w-5 animate-pulse text-amber-500 mr-2" />
              <span className="text-muted-foreground">Loading preview…</span>
            </div>
          ) : isImage && dataUrl ? (
            <div className="flex items-center justify-center">
              <img
                src={dataUrl}
                alt={item?.name}
                className="max-w-full max-h-[60vh] object-contain rounded-lg"
              />
            </div>
          ) : isAudio && dataUrl ? (
            <div className="flex items-center justify-center py-8">
              <audio controls src={dataUrl} className="w-full max-w-md" />
            </div>
          ) : isVideo && dataUrl ? (
            <div className="flex items-center justify-center">
              <video controls src={dataUrl} className="max-w-full max-h-[60vh] rounded-lg" />
            </div>
          ) : isPdf && dataUrl ? (
            <iframe
              src={dataUrl}
              className="w-full h-[60vh] rounded-lg border-0"
              title={item?.name}
            />
          ) : isText && textContent !== null ? (
            <pre className="text-sm font-mono whitespace-pre-wrap break-words text-foreground/80 max-h-[60vh] overflow-auto">
              {textContent}
            </pre>
          ) : (
            <div className="flex flex-col items-center justify-center h-48 gap-3">
              <File className="h-12 w-12 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">
                Preview not available for this file type
              </p>
              <Button variant="outline" size="sm" onClick={handleDownload}>
                <Download className="h-4 w-4 mr-2" />
                Download File
              </Button>
            </div>
          )}
        </div>

        {/* File metadata footer */}
        {item && (
          <div className="flex-shrink-0 flex items-center gap-3 text-xs text-muted-foreground pt-2 border-t flex-wrap">
            <span className="font-mono" title={item.contentHash}>
              SHA-256: {item.contentHash.slice(0, 16)}…{item.contentHash.slice(-8)}
            </span>
            <span>·</span>
            <span>Tier: {item.storageTier}</span>
            {item.cid && (
              <>
                <span>·</span>
                <span className="font-mono" title={item.cid}>CID: {item.cid.slice(0, 12)}…</span>
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// CELESTIA DA TAB
// ============================================================================

function CelestiaDATab() {
  const celestia = useCelestiaBlobs();
  const [submitMode, setSubmitMode] = useState<"text" | "json" | "file">("text");
  const [textContent, setTextContent] = useState("");
  const [jsonContent, setJsonContent] = useState("{\n  \n}");
  const [blobLabel, setBlobLabel] = useState("");
  const [blobDataType, setBlobDataType] = useState("");
  const [encryptBlob, setEncryptBlob] = useState(false);
  const [selectedNamespace, setSelectedNamespace] = useState("__default");
  const [selectedFile, setSelectedFile] = useState<{ name: string; base64: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /* Namespace registry for the picker */
  const NAMESPACE_OPTIONS = [
    { key: "", label: "Default (config)" },
    { key: "marketplace", label: "Marketplace" },
    { key: "purchases", label: "Purchases" },
    { key: "timestamps", label: "Timestamps" },
    { key: "assets", label: "Assets" },
    { key: "licenses", label: "Licenses" },
    { key: "receipts", label: "Receipts" },
    { key: "metadata", label: "Metadata" },
    { key: "proofs", label: "Proofs" },
  ] as const;

  const handleSubmitText = () => {
    if (!textContent.trim()) {
      toast.error("Enter some text content to submit");
      return;
    }
    const base64 = btoa(unescape(encodeURIComponent(textContent)));
    celestia.submitBlob({
      data: base64,
      label: blobLabel || undefined,
      dataType: blobDataType || "text",
      encrypt: encryptBlob || undefined,
      namespaceKey: selectedNamespace !== "__default" ? selectedNamespace : undefined,
    });
    setTextContent("");
    setBlobLabel("");
  };

  const handleSubmitJSON = () => {
    try {
      const parsed = JSON.parse(jsonContent);
      celestia.submitJSON({
        json: parsed,
        label: blobLabel || undefined,
        dataType: blobDataType || "json",
        encrypt: encryptBlob || undefined,
        namespaceKey: selectedNamespace !== "__default" ? selectedNamespace : undefined,
      });
      setJsonContent("{\n  \n}");
      setBlobLabel("");
    } catch {
      toast.error("Invalid JSON — please fix syntax errors");
    }
  };

  const handleSubmitFile = () => {
    if (!selectedFile) {
      toast.error("Select a file first");
      return;
    }
    celestia.submitBlob({
      data: selectedFile.base64,
      label: blobLabel || selectedFile.name,
      dataType: blobDataType || "file",
      encrypt: encryptBlob || undefined,
      namespaceKey: selectedNamespace !== "__default" ? selectedNamespace : undefined,
    });
    setSelectedFile(null);
    setBlobLabel("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(",")[1];
      setSelectedFile({ name: file.name, base64 });
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="space-y-6">
      {/* Node Status Card */}
      <div className={`flex items-center justify-between p-5 rounded-xl border ${
        celestia.isAvailable
          ? "bg-violet-500/5 border-violet-500/20"
          : "bg-zinc-500/5 border-zinc-500/20"
      }`}>
        <div className="flex items-center gap-3">
          <div className={`p-2.5 rounded-lg ${
            celestia.isAvailable ? "bg-violet-500/10" : "bg-zinc-500/10"
          }`}>
            {celestia.isAvailable
              ? <Wifi className="h-5 w-5 text-violet-500" />
              : <WifiOff className="h-5 w-5 text-zinc-400" />}
          </div>
          <div>
            <div className="text-sm font-semibold flex items-center">
              Celestia Light Node
              {celestia.network && (
                <Badge variant="outline" className="ml-2 text-xs">{celestia.network}</Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {celestia.isAvailable
                ? <>
                    Block {celestia.nodeHeight?.toLocaleString() || "syncing…"}
                    {celestia.isSyncing && " · Syncing…"}
                    {celestia.balance && ` · ${parseFloat(celestia.balance.amount).toFixed(4)} ${celestia.balance.denom}`}
                  </>
                : "Node offline — start with celestia-start.bat"}
            </p>
            {celestia.walletAddress && (
              <p className="text-xs font-mono text-muted-foreground mt-0.5">
                {celestia.walletAddress.slice(0, 14)}…{celestia.walletAddress.slice(-6)}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={celestia.refresh} title="Refresh">
            <RefreshCw className="h-4 w-4" />
          </Button>
          {celestia.isAvailable
            ? <CheckCircle2 className="h-5 w-5 text-violet-500" />
            : <AlertCircle className="h-5 w-5 text-zinc-400" />}
        </div>
      </div>

      {/* Stats Row */}
      {celestia.stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="p-4 rounded-xl border bg-card">
            <p className="text-xs text-muted-foreground flex items-center gap-1"><Database className="h-3 w-3" /> Total Blobs</p>
            <p className="text-2xl font-bold mt-1">{celestia.stats.totalBlobs}</p>
          </div>
          <div className="p-4 rounded-xl border bg-card">
            <p className="text-xs text-muted-foreground flex items-center gap-1"><BarChart3 className="h-3 w-3" /> On-chain Size</p>
            <p className="text-2xl font-bold mt-1">{formatBytes(celestia.stats.totalBytes)}</p>
          </div>
          <div className="p-4 rounded-xl border bg-card">
            <p className="text-xs text-muted-foreground flex items-center gap-1"><Lock className="h-3 w-3" /> Encrypted</p>
            <p className="text-2xl font-bold mt-1">{celestia.stats.encryptedCount}</p>
          </div>
          <div className="p-4 rounded-xl border bg-card">
            <p className="text-xs text-muted-foreground flex items-center gap-1"><Layers className="h-3 w-3" /> Data Types</p>
            <p className="text-2xl font-bold mt-1">{Object.keys(celestia.stats.dataTypes).length}</p>
          </div>
        </div>
      )}

      {/* Submit New Blob Section */}
      <div className="p-5 rounded-xl border bg-gradient-to-br from-violet-500/5 to-purple-500/5 border-violet-500/20">
        <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
          <Send className="h-4 w-4 text-violet-500" />
          Submit New Blob
        </h3>

        {/* Mode selector */}
        <div className="flex gap-2 mb-4">
          <Button
            variant={submitMode === "text" ? "default" : "outline"}
            size="sm"
            onClick={() => setSubmitMode("text")}
          >
            <FileText className="h-3.5 w-3.5 mr-1" />
            Text
          </Button>
          <Button
            variant={submitMode === "json" ? "default" : "outline"}
            size="sm"
            onClick={() => setSubmitMode("json")}
          >
            <Hash className="h-3.5 w-3.5 mr-1" />
            JSON
          </Button>
          <Button
            variant={submitMode === "file" ? "default" : "outline"}
            size="sm"
            onClick={() => setSubmitMode("file")}
          >
            <FileUp className="h-3.5 w-3.5 mr-1" />
            File
          </Button>
        </div>

        {/* Content area */}
        {submitMode === "text" && (
          <Textarea
            placeholder="Enter text content to store on Celestia DA…"
            value={textContent}
            onChange={(e) => setTextContent(e.target.value)}
            className="min-h-[120px] mb-3 font-mono text-sm"
          />
        )}
        {submitMode === "json" && (
          <Textarea
            placeholder='{ "key": "value" }'
            value={jsonContent}
            onChange={(e) => setJsonContent(e.target.value)}
            className="min-h-[120px] mb-3 font-mono text-sm"
          />
        )}
        {submitMode === "file" && (
          <div className="mb-3">
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={handleFileSelect}
            />
            <div
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed rounded-lg p-6 text-center cursor-pointer hover:border-violet-500/50 hover:bg-violet-500/5 transition-all"
            >
              {selectedFile ? (
                <div className="flex items-center justify-center gap-2">
                  <File className="h-5 w-5 text-violet-500" />
                  <span className="text-sm font-medium">{selectedFile.name}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => { e.stopPropagation(); setSelectedFile(null); }}
                    className="ml-2 h-6 w-6 p-0"
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              ) : (
                <>
                  <FileUp className="h-8 w-8 mx-auto mb-2 text-violet-500/60" />
                  <p className="text-sm text-muted-foreground">Click to select a file</p>
                </>
              )}
            </div>
          </div>
        )}

        {/* Options row */}
        <div className="flex flex-wrap gap-3 mb-4">
          <div className="flex-1 min-w-[140px]">
            <Input
              placeholder="Label (optional)"
              value={blobLabel}
              onChange={(e) => setBlobLabel(e.target.value)}
              className="h-9 text-sm"
            />
          </div>
          <div className="flex-1 min-w-[140px]">
            <Select value={blobDataType} onValueChange={setBlobDataType}>
              <SelectTrigger className="h-9 text-sm">
                <SelectValue placeholder="Data Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="text">Text</SelectItem>
                <SelectItem value="json">JSON</SelectItem>
                <SelectItem value="file">File</SelectItem>
                <SelectItem value="provenance">Provenance</SelectItem>
                <SelectItem value="listing">Listing</SelectItem>
                <SelectItem value="metadata">Metadata</SelectItem>
                <SelectItem value="model">Model</SelectItem>
                <SelectItem value="dataset">Dataset</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex-1 min-w-[140px]">
            <Select value={selectedNamespace} onValueChange={setSelectedNamespace}>
              <SelectTrigger className="h-9 text-sm">
                <SelectValue placeholder="Namespace" />
              </SelectTrigger>
              <SelectContent>
                {NAMESPACE_OPTIONS.map((ns) => (
                  <SelectItem key={ns.key || "__default"} value={ns.key || "__default"}>
                    {ns.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            variant="outline"
            size="sm"
            className={`h-9 gap-1.5 ${encryptBlob ? "border-violet-500/50 bg-violet-500/10 text-violet-600" : ""}`}
            onClick={() => setEncryptBlob(!encryptBlob)}
          >
            <Lock className="h-3.5 w-3.5" />
            {encryptBlob ? "Encrypted" : "Encrypt"}
          </Button>
        </div>

        {/* Submit button */}
        <Button
          onClick={submitMode === "text" ? handleSubmitText : submitMode === "json" ? handleSubmitJSON : handleSubmitFile}
          disabled={celestia.isSubmitting || !celestia.isAvailable}
          className="w-full bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700"
        >
          {celestia.isSubmitting ? (
            <><Sparkles className="h-4 w-4 animate-pulse mr-2" /> Submitting…</>
          ) : !celestia.isAvailable ? (
            <><WifiOff className="h-4 w-4 mr-2" /> Node Offline</>
          ) : (
            <><Send className="h-4 w-4 mr-2" /> Submit to Celestia DA{encryptBlob ? " (Encrypted)" : ""}</>
          )}
        </Button>
      </div>

      {/* Blob List */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Database className="h-4 w-4" />
            Blob Index ({celestia.blobs.length})
          </h3>
          <Button variant="ghost" size="sm" onClick={celestia.refresh}>
            <RefreshCw className="h-3.5 w-3.5 mr-1" />
            Refresh
          </Button>
        </div>

        {celestia.blobsLoading ? (
          <div className="flex items-center justify-center py-12">
            <Sparkles className="h-5 w-5 animate-pulse text-violet-500 mr-2" />
            <span className="text-muted-foreground">Loading blobs…</span>
          </div>
        ) : celestia.blobs.length === 0 ? (
          <div className="text-center py-16">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-500/10 to-purple-500/10 border border-violet-500/20 mb-4">
              <Layers className="h-8 w-8 text-violet-500/60" />
            </div>
            <p className="text-muted-foreground">No blobs submitted yet.</p>
            <p className="text-xs text-muted-foreground mt-1">Submit your first blob above to get started.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {celestia.blobs.map((blob) => (
              <BlobRow key={blob.contentHash} blob={blob} onVerify={celestia.verifyBlob} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function BlobRow({
  blob,
  onVerify,
}: {
  blob: { contentHash: string; height: number; originalSize: number; encrypted: boolean; submittedAt: string; label?: string; dataType?: string };
  onVerify: (hash: string) => void;
}) {
  return (
    <div className="group flex items-center gap-3 p-3 rounded-lg border bg-card hover:border-violet-500/30 hover:bg-violet-500/5 transition-all">
      <div className={`p-1.5 rounded-md ${blob.encrypted ? "bg-violet-500/10" : "bg-zinc-500/10"}`}>
        {blob.encrypted ? <Lock className="h-4 w-4 text-violet-500" /> : <Layers className="h-4 w-4 text-muted-foreground" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">
            {blob.label || blob.contentHash.slice(0, 16) + "…"}
          </span>
          {blob.dataType && (
            <Badge variant="outline" className="text-xs">{blob.dataType}</Badge>
          )}
          {blob.encrypted && (
            <Badge variant="outline" className="text-xs bg-violet-500/5 border-violet-500/20 text-violet-600">
              <Lock className="h-2.5 w-2.5 mr-1" />Encrypted
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
          <span className="font-mono">{blob.contentHash.slice(0, 12)}…</span>
          <span>·</span>
          <span>Block {blob.height.toLocaleString()}</span>
          <span>·</span>
          <span>{formatBytes(blob.originalSize)}</span>
          <span>·</span>
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {new Date(blob.submittedAt).toLocaleDateString()}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => {
            navigator.clipboard.writeText(blob.contentHash);
            toast.success("Hash copied");
          }}
          title="Copy hash"
        >
          <Copy className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => onVerify(blob.contentHash)}
          title="Verify integrity"
        >
          <ShieldCheck className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

// ============================================================================
// PROMPTS TAB
// ============================================================================

function PromptsTab() {
  const { prompts, isLoading, createPrompt, updatePrompt, deletePrompt } =
    usePrompts();
  const { lastDeepLink, clearLastDeepLink } = useDeepLink();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [prefillData, setPrefillData] = useState<
    { title: string; description: string; content: string } | undefined
  >(undefined);

  useEffect(() => {
    if (lastDeepLink?.type === "add-prompt") {
      const deepLink = lastDeepLink as AddPromptDeepLinkData;
      const payload = deepLink.payload;
      showInfo(`Prefilled prompt: ${payload.title}`);
      setPrefillData({
        title: payload.title,
        description: payload.description,
        content: payload.content,
      });
      setDialogOpen(true);
      clearLastDeepLink();
    }
  }, [lastDeepLink?.timestamp, clearLastDeepLink]);

  const handleDialogClose = (open: boolean) => {
    setDialogOpen(open);
    if (!open) setPrefillData(undefined);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Save and manage reusable prompts
        </p>
        <CreatePromptDialog
          onCreatePrompt={createPrompt}
          prefillData={prefillData}
          isOpen={dialogOpen}
          onOpenChange={handleDialogClose}
        />
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Sparkles className="h-5 w-5 animate-pulse text-amber-500 mr-2" />
          <span className="text-muted-foreground">Loading prompts…</span>
        </div>
      ) : prompts.length === 0 ? (
        <div className="text-center py-16">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-amber-500/10 via-orange-500/10 to-rose-500/10 border border-amber-500/20 mb-4">
            <MessageSquare className="h-8 w-8 text-amber-500/60" />
          </div>
          <p className="text-muted-foreground">
            No prompts yet. Create one to get started.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
          {prompts.map((p) => (
            <PromptCard
              key={p.id}
              prompt={p}
              onUpdate={updatePrompt}
              onDelete={deletePrompt}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function PromptCard({
  prompt,
  onUpdate,
  onDelete,
}: {
  prompt: {
    id: number;
    title: string;
    description: string | null;
    content: string;
  };
  onUpdate: (p: {
    id: number;
    title: string;
    description?: string;
    content: string;
  }) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
}) {
  return (
    <div
      data-testid="prompt-card"
      className="group relative overflow-hidden border border-border/50 rounded-xl p-4 
        bg-gradient-to-br from-amber-500/5 via-orange-500/5 to-rose-500/5
        hover:from-amber-500/10 hover:via-orange-500/10 hover:to-rose-500/10
        hover:border-amber-500/30 hover:shadow-lg hover:shadow-amber-500/5
        transition-all duration-300 min-w-80"
    >
      <div className="space-y-3">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-lg font-semibold text-foreground group-hover:text-amber-600 transition-colors">
              {prompt.title}
            </h3>
            {prompt.description && (
              <p className="text-sm text-muted-foreground mt-1">
                {prompt.description}
              </p>
            )}
          </div>
          <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
            <CreateOrEditPromptDialog
              mode="edit"
              prompt={prompt}
              onUpdatePrompt={onUpdate}
            />
            <DeleteConfirmationDialog
              itemName={prompt.title}
              itemType="Prompt"
              onDelete={() => onDelete(prompt.id)}
            />
          </div>
        </div>
        <pre className="text-sm whitespace-pre-wrap bg-background/50 border border-border/50 rounded-lg p-3 max-h-48 overflow-auto backdrop-blur-sm">
          {prompt.content}
        </pre>
      </div>
    </div>
  );
}

// ============================================================================
// TEMPLATES TAB
// ============================================================================

function TemplatesTab() {
  return (
    <div className="space-y-8">
      {/* Prompt Presets Section */}
      <div>
        <div className="mb-4">
          <h2 className="text-lg font-semibold">Prompt Presets</h2>
          <p className="text-sm text-muted-foreground">
            Ready-to-use system prompts — click to copy
          </p>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3">
          {PROMPT_PRESETS.map((preset) => (
            <div
              key={preset.label}
              onClick={() => {
                navigator.clipboard.writeText(preset.content);
                toast.success(`Copied "${preset.label}" prompt`);
              }}
              className="group cursor-pointer border border-border/50 rounded-xl p-4
                bg-gradient-to-br from-blue-500/5 to-indigo-500/5
                hover:from-blue-500/10 hover:to-indigo-500/10
                hover:border-blue-500/30 hover:shadow-lg hover:shadow-blue-500/5
                transition-all duration-300"
            >
              <div className="flex items-center gap-2 mb-2">
                <MessageSquare className="h-4 w-4 text-blue-500" />
                <h3 className="text-sm font-semibold group-hover:text-blue-600 transition-colors">
                  {preset.label}
                </h3>
              </div>
              <p className="text-xs text-muted-foreground line-clamp-3">
                {preset.content}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Agent Templates Section */}
      <div>
        <div className="mb-4">
          <h2 className="text-lg font-semibold">Agent Templates</h2>
          <p className="text-sm text-muted-foreground">
            Pre-built agent configurations for different use cases
          </p>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3">
          {AGENT_TEMPLATES.map((template) => (
            <div
              key={template.id}
              className="group border border-border/50 rounded-xl p-4
                bg-gradient-to-br from-emerald-500/5 to-teal-500/5
                hover:from-emerald-500/10 hover:to-teal-500/10
                hover:border-emerald-500/30 hover:shadow-lg hover:shadow-emerald-500/5
                transition-all duration-300"
            >
              <div className="flex items-center gap-2 mb-2">
                <Bot className="h-4 w-4 text-emerald-500" />
                <h3 className="text-sm font-semibold group-hover:text-emerald-600 transition-colors">
                  {template.name}
                </h3>
              </div>
              <p className="text-xs text-muted-foreground line-clamp-2 mb-3">
                {template.description}
              </p>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-xs capitalize">
                  {template.type}
                </Badge>
                <Badge variant="outline" className="text-xs capitalize">
                  {template.category.replace(/-/g, " ")}
                </Badge>
                {template.tools && template.tools.length > 0 && (
                  <Badge variant="outline" className="text-xs">
                    {template.tools.length} tool
                    {template.tools.length > 1 ? "s" : ""}
                  </Badge>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
