import React, { useState, useEffect, useMemo, useCallback } from "react";
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
  type LibraryItem,
  type LibraryFilters,
} from "@/hooks/useLibrary";
import { AGENT_TEMPLATES } from "@/constants/agent_templates";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
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
} from "lucide-react";
import { toast } from "sonner";

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
    <div className="min-h-screen px-8 py-6">
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
          <TabsList className="grid w-full max-w-md grid-cols-3">
            <TabsTrigger value="files" className="gap-2">
              <FolderOpen className="h-4 w-4" />
              My Files
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
        reader.onload = () => {
          const base64 = (reader.result as string).split(",")[1];
          importBufferMutation.mutate({
            name: file.name,
            base64,
            mimeType: file.type || undefined,
          });
        };
        reader.readAsDataURL(file);
      }
    },
    [importBufferMutation],
  );

  const handleCopyHash = (hash: string) => {
    navigator.clipboard.writeText(hash);
    toast.success("Hash copied to clipboard");
  };

  return (
    <div className="space-y-4">
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
        <Button
          variant="outline"
          size="sm"
          onClick={() => uploadMutation.mutate()}
          disabled={uploadMutation.isPending}
        >
          {uploadMutation.isPending ? "Uploading…" : "Browse Files"}
        </Button>
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
              onCopyHash={handleCopyHash}
              onDelete={(id) => deleteMutation.mutate(id)}
              onStoreIpfs={(id) => ipfsMutation.mutate(id)}
              onPinRemote={(id) => pinMutation.mutate(id)}
              onStoreArweave={(id) => arweaveMutation.mutate(id)}
              onStoreFilecoin={(id) => filecoinMutation.mutate(id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// File Card
// ============================================================================

function FileCard({
  item,
  onCopyHash,
  onDelete,
  onStoreIpfs,
  onPinRemote,
  onStoreArweave,
  onStoreFilecoin,
}: {
  item: LibraryItem;
  onCopyHash: (hash: string) => void;
  onDelete: (id: number) => void;
  onStoreIpfs: (id: number) => void;
  onPinRemote: (id: number) => void;
  onStoreArweave: (id: number) => void;
  onStoreFilecoin: (id: number) => void;
}) {
  return (
    <div className="group relative overflow-hidden border border-border/50 rounded-xl p-4 bg-gradient-to-br from-amber-500/5 via-orange-500/5 to-rose-500/5 hover:from-amber-500/10 hover:via-orange-500/10 hover:to-rose-500/10 hover:border-amber-500/30 hover:shadow-lg hover:shadow-amber-500/5 transition-all duration-300">
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
                >
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
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
          </div>
        </div>
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
