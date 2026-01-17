/**
 * Joy Creator Studio - Complete Asset Creation & Monetization Platform
 * Create, manage, and monetize any type of digital asset on JoyMarketplace
 */

import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { NFTClient } from "@/ipc/nft_client";
import { AssetStudioClient } from "@/ipc/asset_studio_client";
import { IpcClient } from "@/ipc/ipc_client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Progress } from "@/components/ui/progress";
import {
  Coins,
  Package2,
  TrendingUp,
  Layers,
  Upload,
  Eye,
  Trash2,
  ExternalLink,
  DollarSign,
  Tag,
  Wallet,
  Blocks,
  RefreshCw,
  Grid3X3,
  List,
  ChevronRight,
  Plus,
  Wand2,
  Sparkles,
  Bot,
  Code,
  Database,
  FileJson,
  Layout,
  FileCode,
  GitBranch,
  MessageSquare,
  Globe,
  Puzzle,
  GraduationCap,
  Boxes,
  Brain,
  Zap,
  Rocket,
  Star,
  Settings2,
  Copy,
  Download,
  Share2,
  Play,
  CheckCircle,
  AlertCircle,
  Clock,
  Users,
  BarChart3,
  Shield,
  Lock,
  Unlock,
  ArrowRight,
  Search,
  Filter,
  SortAsc,
  MoreVertical,
  Edit3,
  Save,
  X,
  ChevronDown,
  Cpu,
  Terminal,
  FileText,
  Image,
  Music,
  Video,
  Workflow,
  Paintbrush,
} from "lucide-react";
import { toast } from "sonner";
import type { Asset, AssetType, ASSET_CATEGORIES } from "@/types/asset_types";
import type {
  NFTListing,
  NFTPricing,
  NFTLicenseType,
  BlockchainNetwork,
  AssetChunk,
} from "@/types/nft_types";
import type { IpldReceiptRecord } from "@/types/ipld_receipt";

const nftClient = NFTClient;
const assetClient = AssetStudioClient;
const ipcClient = IpcClient.getInstance();

// ==================== ASSET TYPE CONFIGURATIONS ====================
const ASSET_TYPE_CONFIG: Record<AssetType, {
  label: string;
  description: string;
  icon: any;
  color: string;
  bgColor: string;
  features: string[];
  aiCapable: boolean;
}> = {
  "agent": {
    label: "AI Agent",
    description: "Autonomous agents with tools, memory, and decision-making",
    icon: Bot,
    color: "text-violet-500",
    bgColor: "bg-violet-500/10",
    features: ["Tool Integration", "Memory Systems", "Multi-step Reasoning", "API Access"],
    aiCapable: true,
  },
  "algorithm": {
    label: "Algorithm",
    description: "Reusable code functions and processing logic",
    icon: Code,
    color: "text-blue-500",
    bgColor: "bg-blue-500/10",
    features: ["Multi-language", "Type-safe", "Benchmarked", "Documented"],
    aiCapable: true,
  },
  "dataset": {
    label: "Dataset",
    description: "Structured data collections for training and analysis",
    icon: Database,
    color: "text-emerald-500",
    bgColor: "bg-emerald-500/10",
    features: ["Schema Validation", "Multiple Formats", "Data Preview", "Statistics"],
    aiCapable: true,
  },
  "model": {
    label: "AI Model",
    description: "ML models, fine-tuned weights, and configurations",
    icon: Brain,
    color: "text-pink-500",
    bgColor: "bg-pink-500/10",
    features: ["Multiple Frameworks", "Quantization", "Inference Ready", "Benchmarks"],
    aiCapable: false,
  },
  "schema": {
    label: "Schema",
    description: "Data schemas, API definitions, and type systems",
    icon: FileJson,
    color: "text-amber-500",
    bgColor: "bg-amber-500/10",
    features: ["JSON Schema", "OpenAPI", "GraphQL", "SQL/ORM"],
    aiCapable: true,
  },
  "ui-component": {
    label: "UI Component",
    description: "Reusable interface components and widgets",
    icon: Layout,
    color: "text-cyan-500",
    bgColor: "bg-cyan-500/10",
    features: ["React/Vue/Svelte", "Responsive", "Dark Mode", "Accessible"],
    aiCapable: true,
  },
  "template": {
    label: "Template",
    description: "Full app templates and starter kits",
    icon: FileCode,
    color: "text-orange-500",
    bgColor: "bg-orange-500/10",
    features: ["Full Stack", "Multiple Stacks", "Documentation", "Deployment Ready"],
    aiCapable: true,
  },
  "workflow": {
    label: "Workflow",
    description: "Automation flows and data pipelines",
    icon: GitBranch,
    color: "text-indigo-500",
    bgColor: "bg-indigo-500/10",
    features: ["n8n Compatible", "Triggers", "Multi-step", "Error Handling"],
    aiCapable: true,
  },
  "prompt": {
    label: "Prompt",
    description: "AI prompt templates and chains",
    icon: MessageSquare,
    color: "text-rose-500",
    bgColor: "bg-rose-500/10",
    features: ["Variables", "Examples", "Chain of Thought", "Test Cases"],
    aiCapable: true,
  },
  "api": {
    label: "API",
    description: "API definitions and client SDKs",
    icon: Globe,
    color: "text-teal-500",
    bgColor: "bg-teal-500/10",
    features: ["REST/GraphQL/gRPC", "Auth Support", "Rate Limits", "SDK Gen"],
    aiCapable: true,
  },
  "plugin": {
    label: "Plugin",
    description: "Extensions and integrations",
    icon: Puzzle,
    color: "text-purple-500",
    bgColor: "bg-purple-500/10",
    features: ["Hook System", "Settings", "Permissions", "Multi-platform"],
    aiCapable: true,
  },
  "training-data": {
    label: "Training Data",
    description: "Curated datasets for model fine-tuning",
    icon: GraduationCap,
    color: "text-lime-500",
    bgColor: "bg-lime-500/10",
    features: ["Instruction Tuning", "QA Pairs", "Classification", "Quality Rated"],
    aiCapable: true,
  },
  "embedding": {
    label: "Embedding",
    description: "Vector embeddings and indices",
    icon: Boxes,
    color: "text-sky-500",
    bgColor: "bg-sky-500/10",
    features: ["Multiple Models", "HNSW Index", "Similarity Search", "Metadata"],
    aiCapable: false,
  },
};

// Creation modes
type CreationMode = "manual" | "ai-assisted" | "import" | "from-template";

const CREATION_MODES = [
  { value: "ai-assisted", label: "AI-Assisted", icon: Wand2, description: "Let AI help you create" },
  { value: "manual", label: "Manual", icon: Edit3, description: "Build from scratch" },
  { value: "import", label: "Import", icon: Upload, description: "Upload existing files" },
  { value: "from-template", label: "From Template", icon: Copy, description: "Start from a template" },
];

const LICENSE_OPTIONS: { value: NFTLicenseType; label: string; description: string; icon: any }[] = [
  { value: "full-ownership", label: "Full Ownership", description: "Complete transfer of all rights", icon: Unlock },
  { value: "commercial-use", label: "Commercial Use", description: "Can use for commercial purposes", icon: DollarSign },
  { value: "personal-use", label: "Personal Use", description: "Non-commercial use only", icon: Users },
  { value: "derivative-allowed", label: "Derivative Allowed", description: "Can create derivatives", icon: GitBranch },
  { value: "view-only", label: "View Only", description: "No modification or redistribution", icon: Eye },
  { value: "limited-uses", label: "Limited Uses", description: "Fixed number of uses", icon: Clock },
  { value: "time-limited", label: "Time Limited", description: "Access expires after period", icon: Clock },
  { value: "subscription", label: "Subscription", description: "Recurring access fee", icon: RefreshCw },
];

const NETWORK_OPTIONS: { value: BlockchainNetwork; label: string; icon?: string }[] = [
  { value: "joy-chain", label: "Joy Chain (Native)" },
  { value: "ethereum", label: "Ethereum" },
  { value: "polygon", label: "Polygon" },
  { value: "base", label: "Base" },
  { value: "arbitrum", label: "Arbitrum" },
  { value: "solana", label: "Solana" },
];

const PRICING_TYPES = [
  { value: "fixed", label: "Fixed Price", description: "One-time purchase" },
  { value: "auction", label: "Auction", description: "Bid-based pricing" },
  { value: "pay-per-use", label: "Pay Per Use", description: "Usage-based billing" },
  { value: "subscription", label: "Subscription", description: "Recurring payments" },
  { value: "free", label: "Free", description: "Open source / free tier" },
];

// AI Generation templates by asset type
const AI_GENERATION_PROMPTS: Partial<Record<AssetType, string[]>> = {
  "agent": [
    "Create a customer support agent that can handle inquiries and escalate issues",
    "Build a code review agent that analyzes PRs and suggests improvements",
    "Design a research agent that can search, summarize, and cite sources",
    "Create a data analysis agent that processes CSV files and generates insights",
  ],
  "algorithm": [
    "Generate a rate limiting algorithm with sliding window",
    "Create a text similarity algorithm using TF-IDF",
    "Build a caching algorithm with LRU eviction",
    "Design a recommendation algorithm using collaborative filtering",
  ],
  "prompt": [
    "Create a prompt for generating technical documentation",
    "Design a few-shot prompt for code generation",
    "Build a chain-of-thought prompt for complex reasoning",
    "Generate a system prompt for a helpful coding assistant",
  ],
  "schema": [
    "Generate a JSON schema for a user profile with validation",
    "Create an OpenAPI spec for a REST API",
    "Design a GraphQL schema for an e-commerce platform",
    "Build a database schema for a social media app",
  ],
  "workflow": [
    "Create a CI/CD workflow for deploying to multiple environments",
    "Build a data ingestion pipeline with error handling",
    "Design an approval workflow with notifications",
    "Generate an ETL workflow for data transformation",
  ],
};

// Wizard steps
type WizardStep = "type" | "mode" | "details" | "monetize" | "review";

export default function JoyCreatorStudioPage() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("create");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [showListDialog, setShowListDialog] = useState(false);
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
  const [isChunking, setIsChunking] = useState(false);
  const [chunkingProgress, setChunkingProgress] = useState(0);
  
  // Creation wizard state
  const [showCreateWizard, setShowCreateWizard] = useState(false);
  const [wizardStep, setWizardStep] = useState<WizardStep>("type");
  const [selectedAssetType, setSelectedAssetType] = useState<AssetType | null>(null);
  const [creationMode, setCreationMode] = useState<CreationMode>("ai-assisted");
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState(0);
  
  // Asset creation form state
  const [assetForm, setAssetForm] = useState({
    name: "",
    description: "",
    tags: [] as string[],
    tagInput: "",
    // AI generation
    aiPrompt: "",
    selectedTemplate: "",
    // Monetization
    enableMonetization: true,
    priceType: "fixed" as NFTPricing["type"] | "free",
    price: 0,
    currency: "USD",
    license: "commercial-use" as NFTLicenseType,
    network: "joy-chain" as BlockchainNetwork,
    // Type-specific fields
    typeSpecificData: {} as Record<string, any>,
  });
  
  // List form state
  const [listForm, setListForm] = useState({
    priceType: "fixed" as NFTPricing["type"],
    price: 0,
    currency: "USD",
    license: "commercial-use" as NFTLicenseType,
    network: "joy-chain" as BlockchainNetwork,
    autoPublish: false,
    maxUses: 100,
    expiresInDays: 30,
  });

  const [receiptForm, setReceiptForm] = useState<{
    issuer: string;
    payer: string;
    modelId: string;
    modelHash: string;
    dataHash: string;
    promptHash: string;
    outputHash: string;
    licenseId: string;
    licenseScope: string;
    paymentTxHash: string;
    paymentAmount: string;
    signatureAlg: "eip191" | "eip712" | "ed25519" | "secp256k1";
    signatureValue: string;
  }>({
    issuer: "",
    payer: "",
    modelId: "",
    modelHash: "",
    dataHash: "",
    promptHash: "",
    outputHash: "",
    licenseId: "",
    licenseScope: "training",
    paymentTxHash: "",
    paymentAmount: "",
    signatureAlg: "eip191",
    signatureValue: "",
  });

  // Search and filter state
  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState<AssetType | "all">("all");
  const [sortBy, setSortBy] = useState<"newest" | "name" | "price">("newest");

  // Queries
  const { data: stats } = useQuery({
    queryKey: ["nft-stats"],
    queryFn: () => nftClient.getStats(),
  });

  const { data: listings = [], isLoading: listingsLoading, refetch: refetchListings } = useQuery({
    queryKey: ["nft-listings"],
    queryFn: () => nftClient.getAllListings(),
  });

  const { data: assets = [], isLoading: assetsLoading, refetch: refetchAssets } = useQuery({
    queryKey: ["all-assets"],
    queryFn: () => assetClient.listAll(),
  });

  const { data: portfolio } = useQuery({
    queryKey: ["nft-portfolio"],
    queryFn: () => nftClient.getPortfolio(),
  });

  const { data: assetStats } = useQuery({
    queryKey: ["asset-stats"],
    queryFn: () => assetClient.getStats(),
  });

  const { data: receiptRecords = [] } = useQuery<IpldReceiptRecord[]>({
    queryKey: ["ipld-receipts"],
    queryFn: () => ipcClient.listIpldReceipts(),
  });

  // Filter and sort assets
  const filteredAssets = (assets as Asset[]).filter((asset) => {
    const matchesSearch = !searchQuery || 
      asset.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      asset.description?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesType = filterType === "all" || asset.type === filterType;
    return matchesSearch && matchesType;
  }).sort((a, b) => {
    switch (sortBy) {
      case "name": return a.name.localeCompare(b.name);
      case "price": return (b.price || 0) - (a.price || 0);
      default: return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    }
  });

  // Reset wizard when closing
  const resetWizard = useCallback(() => {
    setWizardStep("type");
    setSelectedAssetType(null);
    setCreationMode("ai-assisted");
    setAssetForm({
      name: "",
      description: "",
      tags: [],
      tagInput: "",
      aiPrompt: "",
      selectedTemplate: "",
      enableMonetization: true,
      priceType: "fixed",
      price: 0,
      currency: "USD",
      license: "commercial-use",
      network: "joy-chain",
      typeSpecificData: {},
    });
    setIsGenerating(false);
    setGenerationProgress(0);
  }, []);

  // Wizard navigation
  const nextStep = useCallback(() => {
    const steps: WizardStep[] = ["type", "mode", "details", "monetize", "review"];
    const currentIndex = steps.indexOf(wizardStep);
    if (currentIndex < steps.length - 1) {
      setWizardStep(steps[currentIndex + 1]);
    }
  }, [wizardStep]);

  const prevStep = useCallback(() => {
    const steps: WizardStep[] = ["type", "mode", "details", "monetize", "review"];
    const currentIndex = steps.indexOf(wizardStep);
    if (currentIndex > 0) {
      setWizardStep(steps[currentIndex - 1]);
    }
  }, [wizardStep]);

  // Add tag handler
  const addTag = useCallback(() => {
    if (assetForm.tagInput.trim() && !assetForm.tags.includes(assetForm.tagInput.trim())) {
      setAssetForm(prev => ({
        ...prev,
        tags: [...prev.tags, prev.tagInput.trim()],
        tagInput: "",
      }));
    }
  }, [assetForm.tagInput, assetForm.tags]);

  const removeTag = useCallback((tag: string) => {
    setAssetForm(prev => ({
      ...prev,
      tags: prev.tags.filter(t => t !== tag),
    }));
  }, []);

  // Asset creation mutation
  const createAssetMutation = useMutation({
    mutationFn: async () => {
      if (!selectedAssetType) throw new Error("No asset type selected");
      
      setIsGenerating(true);
      setGenerationProgress(10);

      // Simulate AI generation if in AI-assisted mode
      if (creationMode === "ai-assisted" && assetForm.aiPrompt) {
        // In a real implementation, this would call the AI service
        setGenerationProgress(30);
        await new Promise(resolve => setTimeout(resolve, 500));
        setGenerationProgress(50);
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      setGenerationProgress(70);

      // Create the asset based on type
      let asset: Asset;
      const baseParams = {
        name: assetForm.name,
        description: assetForm.description,
      };

      switch (selectedAssetType) {
        case "algorithm":
          asset = await assetClient.createAlgorithm({
            ...baseParams,
            language: assetForm.typeSpecificData.language || "typescript",
            algorithmType: assetForm.typeSpecificData.algorithmType || "utility",
            code: assetForm.typeSpecificData.code || "// Generated code\nexport function main() {\n  // Implementation\n}",
            inputs: assetForm.typeSpecificData.inputs || [],
            outputs: assetForm.typeSpecificData.outputs || [],
            dependencies: assetForm.typeSpecificData.dependencies || [],
          });
          break;
        case "schema":
          asset = await assetClient.createSchema({
            ...baseParams,
            schemaType: assetForm.typeSpecificData.schemaType || "json-schema",
            content: assetForm.typeSpecificData.content || "{}",
          });
          break;
        case "prompt":
          asset = await assetClient.createPrompt({
            ...baseParams,
            promptType: assetForm.typeSpecificData.promptType || "system",
            content: assetForm.typeSpecificData.content || assetForm.aiPrompt || "",
            variables: assetForm.typeSpecificData.variables || [],
            targetModel: assetForm.typeSpecificData.targetModel,
            examples: assetForm.typeSpecificData.examples,
          });
          break;
        case "ui-component":
          asset = await assetClient.createUIComponent({
            ...baseParams,
            componentType: assetForm.typeSpecificData.componentType || "widget",
            framework: assetForm.typeSpecificData.framework || "react",
            styling: assetForm.typeSpecificData.styling || "tailwind",
            code: assetForm.typeSpecificData.code || "",
            props: assetForm.typeSpecificData.props || [],
            responsive: assetForm.typeSpecificData.responsive ?? true,
            darkMode: assetForm.typeSpecificData.darkMode ?? true,
            dependencies: assetForm.typeSpecificData.dependencies || [],
          });
          break;
        case "api":
          asset = await assetClient.createAPI({
            ...baseParams,
            apiType: assetForm.typeSpecificData.apiType || "rest",
            baseUrl: assetForm.typeSpecificData.baseUrl,
            authentication: assetForm.typeSpecificData.authentication || "none",
            endpoints: assetForm.typeSpecificData.endpoints || [],
            spec: assetForm.typeSpecificData.spec,
          });
          break;
        case "training-data":
          asset = await assetClient.createTrainingData({
            ...baseParams,
            dataType: assetForm.typeSpecificData.dataType || "instruction",
            format: assetForm.typeSpecificData.format || "jsonl",
            data: assetForm.typeSpecificData.data || [],
            quality: assetForm.typeSpecificData.quality || "curated",
            splitRatio: assetForm.typeSpecificData.splitRatio,
          });
          break;
        default:
          // For other types, create a generic asset (would need proper handlers)
          throw new Error(`Asset type ${selectedAssetType} creation not yet implemented`);
      }

      setGenerationProgress(90);

      // If monetization enabled, create listing
      if (assetForm.enableMonetization && assetForm.priceType !== "free") {
        const pricing: NFTPricing = {
          type: assetForm.priceType as NFTPricing["type"],
          price: assetForm.price,
          currency: assetForm.currency,
        };

        await nftClient.bulkCreateListings({
          asset,
          pricing,
          license: assetForm.license,
          network: assetForm.network,
        });
      }

      setGenerationProgress(100);
      return asset;
    },
    onSuccess: (asset) => {
      toast.success(`Created ${asset.name} successfully!`);
      queryClient.invalidateQueries({ queryKey: ["all-assets"] });
      queryClient.invalidateQueries({ queryKey: ["asset-stats"] });
      queryClient.invalidateQueries({ queryKey: ["nft-listings"] });
      setShowCreateWizard(false);
      resetWizard();
    },
    onError: (error) => {
      toast.error(`Failed to create asset: ${error.message}`);
      setIsGenerating(false);
      setGenerationProgress(0);
    },
  });

  // Mutations
  const chunkAndListMutation = useMutation({
    mutationFn: async () => {
      if (!selectedAsset) throw new Error("No asset selected");
      
      setIsChunking(true);
      setChunkingProgress(20);
      
      // Chunk the asset
      const chunkResult = await nftClient.chunkAsset(selectedAsset);
      if (!chunkResult.success) {
        throw new Error(chunkResult.errors?.join(", ") || "Failed to chunk asset");
      }
      
      setChunkingProgress(50);
      
      // Create pricing object
      const pricing: NFTPricing = {
        type: listForm.priceType,
        price: listForm.price,
        currency: listForm.currency,
      };
      
      if (listForm.priceType === "pay-per-use") {
        pricing.max_uses = listForm.maxUses;
      }
      if (listForm.priceType === "subscription") {
        pricing.subscription_period = "monthly";
      }
      
      setChunkingProgress(70);
      
      // Create listings
      const listings = await nftClient.bulkCreateListings({
        asset: selectedAsset,
        pricing,
        license: listForm.license,
        network: listForm.network,
      });
      
      setChunkingProgress(100);
      
      return { chunks: chunkResult.chunks, listings };
    },
    onSuccess: (result) => {
      toast.success(`Created ${result.listings.length} NFT listings from ${result.chunks.length} chunks`);
      queryClient.invalidateQueries({ queryKey: ["nft-listings"] });
      queryClient.invalidateQueries({ queryKey: ["nft-stats"] });
      setShowListDialog(false);
      setSelectedAsset(null);
      setIsChunking(false);
      setChunkingProgress(0);
    },
    onError: (error) => {
      toast.error(`Failed to create NFT: ${error.message}`);
      setIsChunking(false);
      setChunkingProgress(0);
    },
  });

  const publishMutation = useMutation({
    mutationFn: async (listingId: string) => {
      // TODO: Get API key from settings
      return nftClient.publish(listingId, "demo-api-key");
    },
    onSuccess: () => {
      toast.success("Listed on JoyMarketplace!");
      queryClient.invalidateQueries({ queryKey: ["nft-listings"] });
    },
    onError: (error) => {
      toast.error(`Failed to publish: ${error.message}`);
    },
  });

  const deleteListingMutation = useMutation({
    mutationFn: (listingId: string) => nftClient.deleteListing(listingId),
    onSuccess: () => {
      toast.success("Listing deleted");
      queryClient.invalidateQueries({ queryKey: ["nft-listings"] });
      queryClient.invalidateQueries({ queryKey: ["nft-stats"] });
    },
  });

  const createReceiptMutation = useMutation({
    mutationFn: async () => {
      if (!receiptForm.issuer || !receiptForm.payer || !receiptForm.modelId) {
        throw new Error("Issuer, payer, and model are required");
      }
      if (!receiptForm.dataHash || !receiptForm.promptHash) {
        throw new Error("Data hash and prompt hash are required");
      }
      return ipcClient.createIpldReceipt({
        issuer: receiptForm.issuer,
        payer: receiptForm.payer,
        modelId: receiptForm.modelId,
        modelHash: receiptForm.modelHash || undefined,
        dataHash: receiptForm.dataHash,
        promptHash: receiptForm.promptHash,
        outputHash: receiptForm.outputHash || undefined,
        licenseId: receiptForm.licenseId || undefined,
        licenseScope: receiptForm.licenseScope || undefined,
        paymentTxHash: receiptForm.paymentTxHash || undefined,
        paymentAmount: receiptForm.paymentAmount || undefined,
        signatureAlg: receiptForm.signatureValue
          ? receiptForm.signatureAlg
          : undefined,
        signatureValue: receiptForm.signatureValue || undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ipld-receipts"] });
      toast.success("Receipt created");
    },
    onError: (error) => {
      console.error("Receipt error:", error);
      toast.error(error instanceof Error ? error.message : "Failed to create receipt");
    },
  });

  const latestReceipt = createReceiptMutation.data ?? null;

  const getStatusColor = (status: NFTListing["status"]) => {
    switch (status) {
      case "draft": return "bg-gray-500";
      case "listed": return "bg-green-500";
      case "sold": return "bg-blue-500";
      case "delisted": return "bg-yellow-500";
      default: return "bg-gray-500";
    }
  };

  const formatPrice = (pricing: NFTPricing) => {
    if (pricing.type === "auction") {
      return `Starting at ${pricing.currency} ${pricing.price || 0}`;
    }
    if (pricing.type === "pay-per-use") {
      return `${pricing.currency} ${pricing.price_per_use || pricing.price || 0}/use`;
    }
    if (pricing.type === "subscription") {
      return `${pricing.currency} ${pricing.price || 0}/mo`;
    }
    return `${pricing.currency} ${pricing.price || 0}`;
  };

  // Render asset type card for wizard
  const renderAssetTypeCard = (type: AssetType) => {
    const config = ASSET_TYPE_CONFIG[type];
    const Icon = config.icon;
    const isSelected = selectedAssetType === type;
    
    return (
      <Card 
        key={type}
        className={`cursor-pointer transition-all hover:shadow-lg ${
          isSelected ? "ring-2 ring-primary border-primary" : "hover:border-primary/50"
        }`}
        onClick={() => setSelectedAssetType(type)}
      >
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between">
            <div className={`p-2 rounded-lg ${config.bgColor}`}>
              <Icon className={`w-6 h-6 ${config.color}`} />
            </div>
            {config.aiCapable && (
              <Badge variant="secondary" className="gap-1">
                <Sparkles className="w-3 h-3" />
                AI
              </Badge>
            )}
          </div>
          <CardTitle className="text-lg">{config.label}</CardTitle>
          <CardDescription className="text-sm">{config.description}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-1">
            {config.features.slice(0, 3).map((feature) => (
              <Badge key={feature} variant="outline" className="text-xs">
                {feature}
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  };

  // Render wizard content based on step
  const renderWizardContent = () => {
    switch (wizardStep) {
      case "type":
        return (
          <div className="space-y-4">
            <div className="text-center mb-6">
              <h3 className="text-lg font-semibold">What would you like to create?</h3>
              <p className="text-muted-foreground">Select the type of asset to get started</p>
            </div>
            <div className="grid grid-cols-3 gap-4 max-h-[50vh] overflow-y-auto pr-2">
              {(Object.keys(ASSET_TYPE_CONFIG) as AssetType[]).map(renderAssetTypeCard)}
            </div>
          </div>
        );
      
      case "mode":
        return (
          <div className="space-y-4">
            <div className="text-center mb-6">
              <h3 className="text-lg font-semibold">How would you like to create?</h3>
              <p className="text-muted-foreground">Choose your preferred creation method</p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              {CREATION_MODES.map((mode) => {
                const Icon = mode.icon;
                const isSelected = creationMode === mode.value;
                const typeConfig = selectedAssetType ? ASSET_TYPE_CONFIG[selectedAssetType] : null;
                const isAIDisabled = mode.value === "ai-assisted" && typeConfig && !typeConfig.aiCapable;
                
                return (
                  <Card
                    key={mode.value}
                    className={`cursor-pointer transition-all ${
                      isAIDisabled ? "opacity-50 cursor-not-allowed" : "hover:shadow-lg"
                    } ${isSelected ? "ring-2 ring-primary border-primary" : "hover:border-primary/50"}`}
                    onClick={() => !isAIDisabled && setCreationMode(mode.value as CreationMode)}
                  >
                    <CardHeader>
                      <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-lg ${isSelected ? "bg-primary/10" : "bg-muted"}`}>
                          <Icon className={`w-5 h-5 ${isSelected ? "text-primary" : ""}`} />
                        </div>
                        <div>
                          <CardTitle className="text-base">{mode.label}</CardTitle>
                          <CardDescription>{mode.description}</CardDescription>
                        </div>
                      </div>
                    </CardHeader>
                  </Card>
                );
              })}
            </div>
            
            {creationMode === "ai-assisted" && selectedAssetType && (
              <Card className="mt-4 bg-gradient-to-r from-violet-500/10 to-fuchsia-500/10 border-violet-500/30">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Wand2 className="w-4 h-4" />
                    AI Generation Suggestions
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {(AI_GENERATION_PROMPTS[selectedAssetType] || []).map((prompt, i) => (
                      <Button
                        key={i}
                        variant="outline"
                        size="sm"
                        className="w-full justify-start text-left h-auto py-2"
                        onClick={() => setAssetForm(prev => ({ ...prev, aiPrompt: prompt }))}
                      >
                        <Sparkles className="w-3 h-3 mr-2 flex-shrink-0" />
                        <span className="truncate">{prompt}</span>
                      </Button>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        );
      
      case "details":
        return (
          <div className="space-y-4">
            <div className="text-center mb-6">
              <h3 className="text-lg font-semibold">Asset Details</h3>
              <p className="text-muted-foreground">Configure your {selectedAssetType ? ASSET_TYPE_CONFIG[selectedAssetType].label : "asset"}</p>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Name *</Label>
                  <Input
                    value={assetForm.name}
                    onChange={(e) => setAssetForm(prev => ({ ...prev, name: e.target.value }))}
                    placeholder="My awesome asset"
                  />
                </div>
                
                <div className="space-y-2">
                  <Label>Description</Label>
                  <Textarea
                    value={assetForm.description}
                    onChange={(e) => setAssetForm(prev => ({ ...prev, description: e.target.value }))}
                    placeholder="Describe what this asset does..."
                    rows={3}
                  />
                </div>
                
                <div className="space-y-2">
                  <Label>Tags</Label>
                  <div className="flex gap-2">
                    <Input
                      value={assetForm.tagInput}
                      onChange={(e) => setAssetForm(prev => ({ ...prev, tagInput: e.target.value }))}
                      placeholder="Add tag..."
                      onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addTag())}
                    />
                    <Button type="button" variant="outline" onClick={addTag}>
                      <Plus className="w-4 h-4" />
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {assetForm.tags.map((tag) => (
                      <Badge key={tag} variant="secondary" className="gap-1">
                        {tag}
                        <X 
                          className="w-3 h-3 cursor-pointer" 
                          onClick={() => removeTag(tag)}
                        />
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>
              
              <div className="space-y-4">
                {creationMode === "ai-assisted" && (
                  <div className="space-y-2">
                    <Label className="flex items-center gap-2">
                      <Wand2 className="w-4 h-4" />
                      AI Prompt
                    </Label>
                    <Textarea
                      value={assetForm.aiPrompt}
                      onChange={(e) => setAssetForm(prev => ({ ...prev, aiPrompt: e.target.value }))}
                      placeholder="Describe what you want the AI to generate..."
                      rows={4}
                    />
                  </div>
                )}
                
                {/* Type-specific fields */}
                {renderTypeSpecificFields()}
              </div>
            </div>
          </div>
        );
      
      case "monetize":
        return (
          <div className="space-y-4">
            <div className="text-center mb-6">
              <h3 className="text-lg font-semibold">Monetization Settings</h3>
              <p className="text-muted-foreground">Configure how you want to sell your asset</p>
            </div>
            
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-base">Enable Monetization</CardTitle>
                    <CardDescription>List this asset on JoyMarketplace</CardDescription>
                  </div>
                  <Switch
                    checked={assetForm.enableMonetization}
                    onCheckedChange={(checked) => setAssetForm(prev => ({ ...prev, enableMonetization: checked }))}
                  />
                </div>
              </CardHeader>
            </Card>
            
            {assetForm.enableMonetization && (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Pricing Model</Label>
                    <Select
                      value={assetForm.priceType}
                      onValueChange={(value) => setAssetForm(prev => ({ ...prev, priceType: value as any }))}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PRICING_TYPES.map((type) => (
                          <SelectItem key={type.value} value={type.value}>
                            <div>
                              <div className="font-medium">{type.label}</div>
                              <div className="text-xs text-muted-foreground">{type.description}</div>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  
                  {assetForm.priceType !== "free" && (
                    <div className="space-y-2">
                      <Label>Price (USD)</Label>
                      <Input
                        type="number"
                        value={assetForm.price}
                        onChange={(e) => setAssetForm(prev => ({ ...prev, price: parseFloat(e.target.value) || 0 }))}
                        placeholder="0.00"
                      />
                    </div>
                  )}
                </div>
                
                <div className="space-y-2">
                  <Label>License Type</Label>
                  <Select
                    value={assetForm.license}
                    onValueChange={(value) => setAssetForm(prev => ({ ...prev, license: value as NFTLicenseType }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {LICENSE_OPTIONS.map((opt) => {
                        const Icon = opt.icon;
                        return (
                          <SelectItem key={opt.value} value={opt.value}>
                            <div className="flex items-center gap-2">
                              <Icon className="w-4 h-4" />
                              <div>
                                <div className="font-medium">{opt.label}</div>
                                <div className="text-xs text-muted-foreground">{opt.description}</div>
                              </div>
                            </div>
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                </div>
                
                <div className="space-y-2">
                  <Label>Blockchain Network</Label>
                  <Select
                    value={assetForm.network}
                    onValueChange={(value) => setAssetForm(prev => ({ ...prev, network: value as BlockchainNetwork }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {NETWORK_OPTIONS.map((net) => (
                        <SelectItem key={net.value} value={net.value}>
                          {net.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}
          </div>
        );
      
      case "review":
        const typeConfig = selectedAssetType ? ASSET_TYPE_CONFIG[selectedAssetType] : null;
        const TypeIcon = typeConfig?.icon || Package2;
        
        return (
          <div className="space-y-4">
            <div className="text-center mb-6">
              <h3 className="text-lg font-semibold">Review & Create</h3>
              <p className="text-muted-foreground">Review your asset before creating</p>
            </div>
            
            <Card>
              <CardHeader>
                <div className="flex items-start gap-4">
                  <div className={`p-3 rounded-lg ${typeConfig?.bgColor || "bg-muted"}`}>
                    <TypeIcon className={`w-8 h-8 ${typeConfig?.color || ""}`} />
                  </div>
                  <div className="flex-1">
                    <CardTitle>{assetForm.name || "Untitled Asset"}</CardTitle>
                    <CardDescription>{assetForm.description || "No description"}</CardDescription>
                    <div className="flex flex-wrap gap-1 mt-2">
                      <Badge variant="secondary">{typeConfig?.label || selectedAssetType}</Badge>
                      {assetForm.tags.map((tag) => (
                        <Badge key={tag} variant="outline">{tag}</Badge>
                      ))}
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">Creation Mode:</span>
                    <span className="ml-2 font-medium capitalize">{creationMode.replace("-", " ")}</span>
                  </div>
                  {assetForm.enableMonetization && (
                    <>
                      <div>
                        <span className="text-muted-foreground">Price:</span>
                        <span className="ml-2 font-medium">
                          {assetForm.priceType === "free" ? "Free" : `$${assetForm.price} ${assetForm.currency}`}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">License:</span>
                        <span className="ml-2 font-medium capitalize">{assetForm.license.replace("-", " ")}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Network:</span>
                        <span className="ml-2 font-medium capitalize">{assetForm.network.replace("-", " ")}</span>
                      </div>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
            
            {isGenerating && (
              <Card className="bg-gradient-to-r from-violet-500/10 to-fuchsia-500/10">
                <CardContent className="pt-6">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">
                        {generationProgress < 30 ? "Preparing..." :
                         generationProgress < 70 ? "Generating asset..." :
                         generationProgress < 90 ? "Creating listing..." : "Finalizing..."}
                      </span>
                      <span className="text-sm text-muted-foreground">{generationProgress}%</span>
                    </div>
                    <Progress value={generationProgress} />
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        );
      
      default:
        return null;
    }
  };

  // Type-specific form fields
  const renderTypeSpecificFields = () => {
    if (!selectedAssetType) return null;
    
    switch (selectedAssetType) {
      case "algorithm":
        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Language</Label>
              <Select
                value={assetForm.typeSpecificData.language || "typescript"}
                onValueChange={(value) => setAssetForm(prev => ({
                  ...prev,
                  typeSpecificData: { ...prev.typeSpecificData, language: value }
                }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="typescript">TypeScript</SelectItem>
                  <SelectItem value="javascript">JavaScript</SelectItem>
                  <SelectItem value="python">Python</SelectItem>
                  <SelectItem value="rust">Rust</SelectItem>
                  <SelectItem value="go">Go</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Algorithm Type</Label>
              <Select
                value={assetForm.typeSpecificData.algorithmType || "utility"}
                onValueChange={(value) => setAssetForm(prev => ({
                  ...prev,
                  typeSpecificData: { ...prev.typeSpecificData, algorithmType: value }
                }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="data-processing">Data Processing</SelectItem>
                  <SelectItem value="ml-training">ML Training</SelectItem>
                  <SelectItem value="inference">Inference</SelectItem>
                  <SelectItem value="optimization">Optimization</SelectItem>
                  <SelectItem value="analytics">Analytics</SelectItem>
                  <SelectItem value="automation">Automation</SelectItem>
                  <SelectItem value="utility">Utility</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        );
      
      case "agent":
        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Agent Type</Label>
              <Select
                value={assetForm.typeSpecificData.agentType || "conversational"}
                onValueChange={(value) => setAssetForm(prev => ({
                  ...prev,
                  typeSpecificData: { ...prev.typeSpecificData, agentType: value }
                }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="conversational">Conversational</SelectItem>
                  <SelectItem value="task">Task-focused</SelectItem>
                  <SelectItem value="autonomous">Autonomous</SelectItem>
                  <SelectItem value="multi-agent">Multi-agent</SelectItem>
                  <SelectItem value="rag">RAG</SelectItem>
                  <SelectItem value="tool-use">Tool Use</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Memory Type</Label>
              <Select
                value={assetForm.typeSpecificData.memory || "short-term"}
                onValueChange={(value) => setAssetForm(prev => ({
                  ...prev,
                  typeSpecificData: { ...prev.typeSpecificData, memory: value }
                }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="short-term">Short-term</SelectItem>
                  <SelectItem value="long-term">Long-term</SelectItem>
                  <SelectItem value="vector">Vector Memory</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        );
      
      case "prompt":
        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Prompt Type</Label>
              <Select
                value={assetForm.typeSpecificData.promptType || "system"}
                onValueChange={(value) => setAssetForm(prev => ({
                  ...prev,
                  typeSpecificData: { ...prev.typeSpecificData, promptType: value }
                }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="system">System Prompt</SelectItem>
                  <SelectItem value="user">User Prompt</SelectItem>
                  <SelectItem value="chain">Prompt Chain</SelectItem>
                  <SelectItem value="few-shot">Few-shot</SelectItem>
                  <SelectItem value="cot">Chain of Thought</SelectItem>
                  <SelectItem value="rag">RAG Prompt</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Target Model</Label>
              <Input
                value={assetForm.typeSpecificData.targetModel || ""}
                onChange={(e) => setAssetForm(prev => ({
                  ...prev,
                  typeSpecificData: { ...prev.typeSpecificData, targetModel: e.target.value }
                }))}
                placeholder="gpt-4, claude-3, etc."
              />
            </div>
          </div>
        );
      
      case "ui-component":
        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Component Type</Label>
              <Select
                value={assetForm.typeSpecificData.componentType || "widget"}
                onValueChange={(value) => setAssetForm(prev => ({
                  ...prev,
                  typeSpecificData: { ...prev.typeSpecificData, componentType: value }
                }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="widget">Widget</SelectItem>
                  <SelectItem value="page">Page</SelectItem>
                  <SelectItem value="layout">Layout</SelectItem>
                  <SelectItem value="form">Form</SelectItem>
                  <SelectItem value="chart">Chart</SelectItem>
                  <SelectItem value="table">Table</SelectItem>
                  <SelectItem value="card">Card</SelectItem>
                  <SelectItem value="modal">Modal</SelectItem>
                  <SelectItem value="navigation">Navigation</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Framework</Label>
              <Select
                value={assetForm.typeSpecificData.framework || "react"}
                onValueChange={(value) => setAssetForm(prev => ({
                  ...prev,
                  typeSpecificData: { ...prev.typeSpecificData, framework: value }
                }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="react">React</SelectItem>
                  <SelectItem value="vue">Vue</SelectItem>
                  <SelectItem value="svelte">Svelte</SelectItem>
                  <SelectItem value="html">HTML</SelectItem>
                  <SelectItem value="web-component">Web Component</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        );
      
      case "schema":
        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Schema Type</Label>
              <Select
                value={assetForm.typeSpecificData.schemaType || "json-schema"}
                onValueChange={(value) => setAssetForm(prev => ({
                  ...prev,
                  typeSpecificData: { ...prev.typeSpecificData, schemaType: value }
                }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="json-schema">JSON Schema</SelectItem>
                  <SelectItem value="openapi">OpenAPI</SelectItem>
                  <SelectItem value="graphql">GraphQL</SelectItem>
                  <SelectItem value="protobuf">Protobuf</SelectItem>
                  <SelectItem value="avro">Avro</SelectItem>
                  <SelectItem value="sql">SQL</SelectItem>
                  <SelectItem value="drizzle">Drizzle ORM</SelectItem>
                  <SelectItem value="prisma">Prisma</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        );
      
      case "workflow":
        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Workflow Type</Label>
              <Select
                value={assetForm.typeSpecificData.workflowType || "automation"}
                onValueChange={(value) => setAssetForm(prev => ({
                  ...prev,
                  typeSpecificData: { ...prev.typeSpecificData, workflowType: value }
                }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="automation">Automation</SelectItem>
                  <SelectItem value="data-pipeline">Data Pipeline</SelectItem>
                  <SelectItem value="ai-chain">AI Chain</SelectItem>
                  <SelectItem value="integration">Integration</SelectItem>
                  <SelectItem value="etl">ETL</SelectItem>
                  <SelectItem value="notification">Notification</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Platform</Label>
              <Select
                value={assetForm.typeSpecificData.platform || "n8n"}
                onValueChange={(value) => setAssetForm(prev => ({
                  ...prev,
                  typeSpecificData: { ...prev.typeSpecificData, platform: value }
                }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="n8n">n8n</SelectItem>
                  <SelectItem value="zapier">Zapier</SelectItem>
                  <SelectItem value="make">Make</SelectItem>
                  <SelectItem value="langchain">LangChain</SelectItem>
                  <SelectItem value="custom">Custom</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        );
      
      default:
        return null;
    }
  };

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="border-b p-4 bg-gradient-to-r from-violet-500/5 via-fuchsia-500/5 to-pink-500/5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <div className="p-2 rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-600">
                <Sparkles className="w-6 h-6 text-white" />
              </div>
              Joy Creator Studio
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Create, manage, and monetize any digital asset • Bring your agentic creations to market
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => { refetchListings(); refetchAssets(); }}>
              <RefreshCw className="w-4 h-4 mr-2" />
              Refresh
            </Button>
            <Button 
              className="bg-gradient-to-r from-violet-500 to-fuchsia-600 hover:from-violet-600 hover:to-fuchsia-700 text-white"
              onClick={() => { setShowCreateWizard(true); resetWizard(); }}
            >
              <Plus className="w-4 h-4 mr-2" />
              Create Asset
            </Button>
          </div>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-5 gap-4 p-4">
        <Card className="bg-gradient-to-br from-violet-500/10 to-violet-500/5 border-violet-500/20">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Assets</p>
                <p className="text-2xl font-bold">{assetStats?.total || (assets as Asset[]).length || 0}</p>
              </div>
              <Package2 className="w-8 h-8 text-violet-500 opacity-50" />
            </div>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-emerald-500/10 to-emerald-500/5 border-emerald-500/20">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Published</p>
                <p className="text-2xl font-bold">{assetStats?.published || stats?.listed_count || 0}</p>
              </div>
              <TrendingUp className="w-8 h-8 text-emerald-500 opacity-50" />
            </div>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-amber-500/10 to-amber-500/5 border-amber-500/20">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Revenue</p>
                <p className="text-2xl font-bold">${stats?.total_value?.toFixed(2) || "0.00"}</p>
              </div>
              <DollarSign className="w-8 h-8 text-amber-500 opacity-50" />
            </div>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-blue-500/10 to-blue-500/5 border-blue-500/20">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Sales</p>
                <p className="text-2xl font-bold">{stats?.sold_count || 0}</p>
              </div>
              <Wallet className="w-8 h-8 text-blue-500 opacity-50" />
            </div>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-pink-500/10 to-pink-500/5 border-pink-500/20">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Listings</p>
                <p className="text-2xl font-bold">{stats?.total_listings || 0}</p>
              </div>
              <Wand2 className="w-8 h-8 text-pink-500 opacity-50" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-auto p-4">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <div className="flex items-center justify-between mb-4">
            <TabsList>
              <TabsTrigger value="create" className="gap-2">
                <Plus className="w-4 h-4" />
                Create
              </TabsTrigger>
              <TabsTrigger value="assets" className="gap-2">
                <Package2 className="w-4 h-4" />
                My Assets
              </TabsTrigger>
              <TabsTrigger value="listings" className="gap-2">
                <Coins className="w-4 h-4" />
                Listings
              </TabsTrigger>
              <TabsTrigger value="marketplace" className="gap-2">
                <Globe className="w-4 h-4" />
                Marketplace
              </TabsTrigger>
              <TabsTrigger value="receipts" className="gap-2">
                <FileText className="w-4 h-4" />
                Receipts
              </TabsTrigger>
            </TabsList>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search assets..."
                  className="pl-9 w-64"
                />
              </div>
              <Select value={filterType} onValueChange={(v) => setFilterType(v as any)}>
                <SelectTrigger className="w-40">
                  <Filter className="w-4 h-4 mr-2" />
                  <SelectValue placeholder="Filter" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  {(Object.keys(ASSET_TYPE_CONFIG) as AssetType[]).map((type) => (
                    <SelectItem key={type} value={type}>
                      {ASSET_TYPE_CONFIG[type].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant={viewMode === "grid" ? "default" : "outline"}
                size="sm"
                onClick={() => setViewMode("grid")}
              >
                <Grid3X3 className="w-4 h-4" />
              </Button>
              <Button
                variant={viewMode === "list" ? "default" : "outline"}
                size="sm"
                onClick={() => setViewMode("list")}
              >
                <List className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {/* Create Tab - Quick Access */}
          <TabsContent value="create">
            <div className="space-y-6">
              {/* Quick Create Cards */}
              <div>
                <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                  <Zap className="w-5 h-5 text-amber-500" />
                  Quick Create
                </h3>
                <div className="grid grid-cols-4 gap-4">
                  {(["agent", "algorithm", "prompt", "workflow"] as AssetType[]).map((type) => {
                    const config = ASSET_TYPE_CONFIG[type];
                    const Icon = config.icon;
                    return (
                      <Card 
                        key={type} 
                        className="cursor-pointer hover:shadow-lg transition-all hover:border-primary/50"
                        onClick={() => {
                          setSelectedAssetType(type);
                          setShowCreateWizard(true);
                          setWizardStep("mode");
                        }}
                      >
                        <CardHeader>
                          <div className={`p-3 rounded-lg ${config.bgColor} w-fit`}>
                            <Icon className={`w-6 h-6 ${config.color}`} />
                          </div>
                          <CardTitle className="text-base">{config.label}</CardTitle>
                          <CardDescription className="text-sm">{config.description}</CardDescription>
                        </CardHeader>
                        <CardFooter className="pt-0">
                          <Button variant="ghost" size="sm" className="w-full gap-2">
                            Create <ArrowRight className="w-4 h-4" />
                          </Button>
                        </CardFooter>
                      </Card>
                    );
                  })}
                </div>
              </div>

              {/* All Asset Types */}
              <div>
                <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                  <Layers className="w-5 h-5 text-violet-500" />
                  All Asset Types
                </h3>
                <div className="grid grid-cols-4 gap-4">
                  {(Object.keys(ASSET_TYPE_CONFIG) as AssetType[]).map((type) => {
                    const config = ASSET_TYPE_CONFIG[type];
                    const Icon = config.icon;
                    return (
                      <Card 
                        key={type} 
                        className="cursor-pointer hover:shadow-md transition-all hover:border-primary/30"
                        onClick={() => {
                          setSelectedAssetType(type);
                          setShowCreateWizard(true);
                          setWizardStep("mode");
                        }}
                      >
                        <CardContent className="pt-4">
                          <div className="flex items-center gap-3">
                            <div className={`p-2 rounded-lg ${config.bgColor}`}>
                              <Icon className={`w-5 h-5 ${config.color}`} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="font-medium text-sm">{config.label}</p>
                              <p className="text-xs text-muted-foreground truncate">{config.description}</p>
                            </div>
                            {config.aiCapable && (
                              <Badge variant="secondary" className="text-xs gap-1">
                                <Sparkles className="w-3 h-3" />
                              </Badge>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </div>

              {/* AI Generation Suggestions */}
              <Card className="bg-gradient-to-r from-violet-500/10 via-fuchsia-500/10 to-pink-500/10 border-violet-500/20">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Wand2 className="w-5 h-5" />
                    AI-Powered Creation Ideas
                  </CardTitle>
                  <CardDescription>
                    Let AI help you create powerful assets. Click any idea to get started.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-3">
                    {Object.entries(AI_GENERATION_PROMPTS).slice(0, 4).flatMap(([type, prompts]) => 
                      prompts.slice(0, 1).map((prompt, i) => {
                        const config = ASSET_TYPE_CONFIG[type as AssetType];
                        const Icon = config?.icon || Code;
                        return (
                          <Button
                            key={`${type}-${i}`}
                            variant="outline"
                            className="h-auto py-3 justify-start text-left"
                            onClick={() => {
                              setSelectedAssetType(type as AssetType);
                              setCreationMode("ai-assisted");
                              setAssetForm(prev => ({ ...prev, aiPrompt: prompt }));
                              setShowCreateWizard(true);
                              setWizardStep("details");
                            }}
                          >
                            <Icon className={`w-4 h-4 mr-2 flex-shrink-0 ${config?.color || ""}`} />
                            <span className="truncate">{prompt}</span>
                          </Button>
                        );
                      })
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* My Assets Tab */}
          <TabsContent value="assets">
            {assetsLoading ? (
              <div className="flex items-center justify-center h-64">
                <RefreshCw className="w-6 h-6 animate-spin" />
              </div>
            ) : filteredAssets.length === 0 ? (
              <Card>
                <CardContent className="flex flex-col items-center justify-center h-64">
                  <Package2 className="w-12 h-12 text-muted-foreground mb-4" />
                  <h3 className="text-lg font-medium">No Assets Yet</h3>
                  <p className="text-muted-foreground text-sm mb-4">
                    Create your first asset to get started
                  </p>
                  <Button onClick={() => { setShowCreateWizard(true); resetWizard(); }}>
                    <Plus className="w-4 h-4 mr-2" />
                    Create Your First Asset
                  </Button>
                </CardContent>
              </Card>
            ) : viewMode === "grid" ? (
              <div className="grid grid-cols-3 gap-4">
                {filteredAssets.map((asset) => {
                  const config = ASSET_TYPE_CONFIG[asset.type];
                  const Icon = config?.icon || Package2;
                  return (
                    <Card key={asset.id} className="hover:shadow-lg transition-all hover:border-primary/30">
                      <CardHeader className="pb-2">
                        <div className="flex items-start justify-between">
                          <div className={`p-2 rounded-lg ${config?.bgColor || "bg-muted"}`}>
                            <Icon className={`w-5 h-5 ${config?.color || ""}`} />
                          </div>
                          <div className="flex items-center gap-2">
                            {asset.marketplaceId && (
                              <Badge className="bg-green-500 text-white">Listed</Badge>
                            )}
                            <Badge variant="outline">{config?.label || asset.type}</Badge>
                          </div>
                        </div>
                        <CardTitle className="text-base mt-2">{asset.name}</CardTitle>
                        <CardDescription className="text-sm line-clamp-2">
                          {asset.description || "No description"}
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="flex flex-wrap gap-1 mb-3">
                          {asset.tags.slice(0, 3).map((tag) => (
                            <Badge key={tag} variant="secondary" className="text-xs">
                              {tag}
                            </Badge>
                          ))}
                        </div>
                        <div className="flex items-center justify-between text-sm text-muted-foreground">
                          <span>v{asset.version}</span>
                          <span>{new Date(asset.createdAt).toLocaleDateString()}</span>
                        </div>
                      </CardContent>
                      <CardFooter className="flex gap-2">
                        <Button variant="outline" size="sm" className="flex-1">
                          <Eye className="w-3 h-3 mr-1" />
                          View
                        </Button>
                        {!asset.marketplaceId && (
                          <Button 
                            size="sm" 
                            className="flex-1"
                            onClick={() => {
                              setSelectedAsset(asset);
                              setShowListDialog(true);
                            }}
                          >
                            <Upload className="w-3 h-3 mr-1" />
                            List
                          </Button>
                        )}
                        <Button variant="outline" size="sm">
                          <MoreVertical className="w-3 h-3" />
                        </Button>
                      </CardFooter>
                    </Card>
                  );
                })}
              </div>
            ) : (
              <Card>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Version</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead className="w-[100px]">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredAssets.map((asset) => {
                      const config = ASSET_TYPE_CONFIG[asset.type];
                      const Icon = config?.icon || Package2;
                      return (
                        <TableRow key={asset.id}>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Icon className={`w-4 h-4 ${config?.color || ""}`} />
                              <span className="font-medium">{asset.name}</span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">{config?.label || asset.type}</Badge>
                          </TableCell>
                          <TableCell>v{asset.version}</TableCell>
                          <TableCell>
                            {asset.marketplaceId ? (
                              <Badge className="bg-green-500 text-white">Listed</Badge>
                            ) : (
                              <Badge variant="secondary">Draft</Badge>
                            )}
                          </TableCell>
                          <TableCell>{new Date(asset.createdAt).toLocaleDateString()}</TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1">
                              <Button variant="ghost" size="sm">
                                <Eye className="w-4 h-4" />
                              </Button>
                              {!asset.marketplaceId && (
                                <Button 
                                  variant="ghost" 
                                  size="sm"
                                  onClick={() => {
                                    setSelectedAsset(asset);
                                    setShowListDialog(true);
                                  }}
                                >
                                  <Upload className="w-4 h-4" />
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="listings">
            {listingsLoading ? (
              <div className="flex items-center justify-center h-64">
                <RefreshCw className="w-6 h-6 animate-spin" />
              </div>
            ) : listings.length === 0 ? (
              <Card>
                <CardContent className="flex flex-col items-center justify-center h-64">
                  <Coins className="w-12 h-12 text-muted-foreground mb-4" />
                  <h3 className="text-lg font-medium">No Listings Yet</h3>
                  <p className="text-muted-foreground text-sm mb-4">
                    Create assets and list them on JoyMarketplace
                  </p>
                  <Button onClick={() => setActiveTab("assets")}>
                    <Package2 className="w-4 h-4 mr-2" />
                    View My Assets
                  </Button>
                </CardContent>
              </Card>
            ) : viewMode === "grid" ? (
              <div className="grid grid-cols-3 gap-4">
                {listings.map((listing) => (
                  <Card key={listing.id} className="hover:border-purple-500 transition-colors">
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                          <CardTitle className="text-sm truncate">
                            {listing.metadata.name}
                          </CardTitle>
                          <CardDescription className="text-xs">
                            {listing.metadata.properties?.category || "Asset"}
                          </CardDescription>
                        </div>
                        <Badge className={`${getStatusColor(listing.status)} text-white`}>
                          {listing.status}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="aspect-video bg-gradient-to-br from-violet-500/20 to-fuchsia-500/20 rounded-lg flex items-center justify-center mb-3">
                        <Blocks className="w-12 h-12 text-muted-foreground" />
                      </div>
                      <div className="space-y-2">
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-muted-foreground">Price</span>
                          <span className="font-medium">{formatPrice(listing.pricing)}</span>
                        </div>
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-muted-foreground">Network</span>
                          <span className="font-medium capitalize">{listing.network}</span>
                        </div>
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-muted-foreground">Views</span>
                          <span className="font-medium">{listing.views}</span>
                        </div>
                      </div>
                      <div className="flex gap-2 mt-4">
                        {listing.status === "draft" && (
                          <Button
                            size="sm"
                            className="flex-1"
                            onClick={() => publishMutation.mutate(listing.id)}
                          >
                            <Upload className="w-3 h-3 mr-1" />
                            Publish
                          </Button>
                        )}
                        <Button variant="outline" size="sm">
                          <Eye className="w-3 h-3" />
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => deleteListingMutation.mutate(listing.id)}
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <Card>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Price</TableHead>
                      <TableHead>Network</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead className="w-[100px]">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {listings.map((listing) => (
                      <TableRow key={listing.id}>
                        <TableCell className="font-medium">
                          {listing.metadata.name}
                        </TableCell>
                        <TableCell>
                          {listing.metadata.properties?.category || "Asset"}
                        </TableCell>
                        <TableCell>{formatPrice(listing.pricing)}</TableCell>
                        <TableCell className="capitalize">{listing.network}</TableCell>
                        <TableCell>
                          <Badge className={`${getStatusColor(listing.status)} text-white`}>
                            {listing.status}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {new Date(listing.created_at).toLocaleDateString()}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            {listing.status === "draft" && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => publishMutation.mutate(listing.id)}
                              >
                                <Upload className="w-4 h-4" />
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => deleteListingMutation.mutate(listing.id)}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="marketplace">
            <div className="grid grid-cols-3 gap-4">
              {/* Featured Section */}
              <Card className="col-span-2 bg-gradient-to-br from-violet-500/10 via-fuchsia-500/10 to-pink-500/10 border-violet-500/20">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Star className="w-5 h-5 text-amber-500" />
                    Featured on JoyMarketplace
                  </CardTitle>
                  <CardDescription>
                    Discover top-rated assets from the community
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col items-center justify-center h-48">
                  <Globe className="w-16 h-16 text-muted-foreground mb-4" />
                  <p className="text-muted-foreground text-sm mb-4">
                    Browse thousands of assets from creators worldwide
                  </p>
                  <Button
                    className="bg-gradient-to-r from-violet-500 to-fuchsia-600 hover:from-violet-600 hover:to-fuchsia-700 text-white"
                    onClick={() => ipcClient.openExternalUrl("https://joymarketplace.io")}
                  >
                    <ExternalLink className="w-4 h-4 mr-2" />
                    Explore Marketplace
                  </Button>
                </CardContent>
              </Card>

              {/* Portfolio Summary */}
              <div className="space-y-4">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Your Portfolio</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">Owned NFTs</span>
                        <span className="font-medium">{portfolio?.owned?.length || 0}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">Created NFTs</span>
                        <span className="font-medium">{portfolio?.created?.length || 0}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">Total Earnings</span>
                        <span className="font-medium text-green-500">
                          ${portfolio?.created?.reduce((sum: number, c: any) => sum + (c.total_earnings || 0), 0).toFixed(2) || "0.00"}
                        </span>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Rocket className="w-4 h-4" />
                      Quick Actions
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <Button variant="outline" size="sm" className="w-full justify-start">
                      <BarChart3 className="w-4 h-4 mr-2" />
                      View Analytics
                    </Button>
                    <Button variant="outline" size="sm" className="w-full justify-start">
                      <Settings2 className="w-4 h-4 mr-2" />
                      Manage Settings
                    </Button>
                    <Button variant="outline" size="sm" className="w-full justify-start">
                      <Users className="w-4 h-4 mr-2" />
                      Publisher Profile
                    </Button>
                  </CardContent>
                </Card>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="receipts">
            <div className="grid gap-6 lg:grid-cols-[1.4fr_0.6fr]">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <FileText className="w-5 h-5 text-violet-500" />
                    Inference Receipt Builder
                  </CardTitle>
                  <CardDescription>
                    Create a DAG-CBOR receipt for later IPLD storage and on-chain payment proofs.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Issuer DID</Label>
                      <Input
                        value={receiptForm.issuer}
                        onChange={(e) => setReceiptForm({ ...receiptForm, issuer: e.target.value })}
                        placeholder="did:pkh:eip155:137:0x..."
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Payer DID</Label>
                      <Input
                        value={receiptForm.payer}
                        onChange={(e) => setReceiptForm({ ...receiptForm, payer: e.target.value })}
                        placeholder="did:pkh:eip155:137:0x..."
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Model ID</Label>
                      <Input
                        value={receiptForm.modelId}
                        onChange={(e) => setReceiptForm({ ...receiptForm, modelId: e.target.value })}
                        placeholder="model-uuid"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Model Hash (optional)</Label>
                      <Input
                        value={receiptForm.modelHash}
                        onChange={(e) => setReceiptForm({ ...receiptForm, modelHash: e.target.value })}
                        placeholder="bafy..."
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Data Hash</Label>
                      <Input
                        value={receiptForm.dataHash}
                        onChange={(e) => setReceiptForm({ ...receiptForm, dataHash: e.target.value })}
                        placeholder="bafy..."
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Prompt Hash</Label>
                      <Input
                        value={receiptForm.promptHash}
                        onChange={(e) => setReceiptForm({ ...receiptForm, promptHash: e.target.value })}
                        placeholder="bafy..."
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Output Hash (optional)</Label>
                      <Input
                        value={receiptForm.outputHash}
                        onChange={(e) => setReceiptForm({ ...receiptForm, outputHash: e.target.value })}
                        placeholder="bafy..."
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>License ID (optional)</Label>
                      <Input
                        value={receiptForm.licenseId}
                        onChange={(e) => setReceiptForm({ ...receiptForm, licenseId: e.target.value })}
                        placeholder="license-uuid"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>License Scope (optional)</Label>
                      <Input
                        value={receiptForm.licenseScope}
                        onChange={(e) => setReceiptForm({ ...receiptForm, licenseScope: e.target.value })}
                        placeholder="training"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Payment Tx Hash (optional)</Label>
                      <Input
                        value={receiptForm.paymentTxHash}
                        onChange={(e) => setReceiptForm({ ...receiptForm, paymentTxHash: e.target.value })}
                        placeholder="0x..."
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Payment Amount (USDC, optional)</Label>
                      <Input
                        value={receiptForm.paymentAmount}
                        onChange={(e) => setReceiptForm({ ...receiptForm, paymentAmount: e.target.value })}
                        placeholder="10.00"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Signature Algorithm (optional)</Label>
                      <Select
                        value={receiptForm.signatureAlg}
                        onValueChange={(value) =>
                          setReceiptForm({
                            ...receiptForm,
                            signatureAlg: value as "eip191" | "eip712" | "ed25519" | "secp256k1",
                          })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="eip191">eip191</SelectItem>
                          <SelectItem value="eip712">eip712</SelectItem>
                          <SelectItem value="ed25519">ed25519</SelectItem>
                          <SelectItem value="secp256k1">secp256k1</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Signature Value (optional)</Label>
                      <Input
                        value={receiptForm.signatureValue}
                        onChange={(e) => setReceiptForm({ ...receiptForm, signatureValue: e.target.value })}
                        placeholder="0x..."
                      />
                    </div>
                  </div>
                </CardContent>
                <CardFooter className="justify-between">
                  <div className="text-xs text-muted-foreground">
                    Chain: Polygon (USDC). Receipt is stored locally as DAG-CBOR + JSON.
                  </div>
                  <Button
                    onClick={() => createReceiptMutation.mutate()}
                    disabled={createReceiptMutation.isPending}
                    className="bg-gradient-to-r from-violet-500 to-fuchsia-600 hover:from-violet-600 hover:to-fuchsia-700 text-white"
                  >
                    {createReceiptMutation.isPending ? "Creating..." : "Create Receipt"}
                  </Button>
                </CardFooter>
              </Card>

              <div className="space-y-4">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Latest Receipt</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {latestReceipt ? (
                      <>
                        <div className="text-xs text-muted-foreground">CID</div>
                        <div className="font-mono text-xs break-all">{latestReceipt.cid}</div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span>{latestReceipt.receipt.payer}</span>
                          <span>•</span>
                          <span>{latestReceipt.receipt.model.id}</span>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => ipcClient.showItemInFolder(latestReceipt.jsonPath)}
                        >
                          Show Receipt File
                        </Button>
                      </>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        Create a receipt to see its CID and local storage path.
                      </p>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Recent Receipts</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {receiptRecords.slice(0, 5).map((record) => (
                      <div key={record.cid} className="space-y-1">
                        <div className="text-xs text-muted-foreground">CID</div>
                        <div className="font-mono text-xs break-all">{record.cid}</div>
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span>{record.receipt.model.id}</span>
                          <span>{new Date(record.createdAt).toLocaleDateString()}</span>
                        </div>
                        <Separator className="mt-2" />
                      </div>
                    ))}
                    {receiptRecords.length === 0 && (
                      <p className="text-sm text-muted-foreground">
                        No receipts created yet.
                      </p>
                    )}
                  </CardContent>
                </Card>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {/* Create Asset Wizard Dialog */}
      <Dialog open={showCreateWizard} onOpenChange={(open) => { 
        setShowCreateWizard(open); 
        if (!open) resetWizard(); 
      }}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div className="p-2 rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-600">
                <Sparkles className="w-5 h-5 text-white" />
              </div>
              Create New Asset
            </DialogTitle>
            <DialogDescription>
              Build and monetize digital assets with AI-powered creation tools
            </DialogDescription>
          </DialogHeader>

          {/* Progress indicator */}
          <div className="flex items-center gap-2 px-1 py-2">
            {(["type", "mode", "details", "monetize", "review"] as WizardStep[]).map((step, i) => {
              const steps: WizardStep[] = ["type", "mode", "details", "monetize", "review"];
              const currentIndex = steps.indexOf(wizardStep);
              const stepIndex = steps.indexOf(step);
              const isComplete = stepIndex < currentIndex;
              const isCurrent = step === wizardStep;
              
              return (
                <div key={step} className="flex items-center flex-1">
                  <div className={`flex items-center justify-center w-8 h-8 rounded-full text-sm font-medium transition-colors ${
                    isComplete ? "bg-green-500 text-white" :
                    isCurrent ? "bg-primary text-primary-foreground" :
                    "bg-muted text-muted-foreground"
                  }`}>
                    {isComplete ? <CheckCircle className="w-4 h-4" /> : i + 1}
                  </div>
                  <span className={`ml-2 text-sm hidden md:inline ${isCurrent ? "font-medium" : "text-muted-foreground"}`}>
                    {step.charAt(0).toUpperCase() + step.slice(1)}
                  </span>
                  {i < 4 && <div className={`flex-1 h-0.5 mx-2 ${isComplete ? "bg-green-500" : "bg-muted"}`} />}
                </div>
              );
            })}
          </div>

          {/* Wizard content */}
          <ScrollArea className="flex-1 pr-4">
            <div className="py-4">
              {renderWizardContent()}
            </div>
          </ScrollArea>

          <DialogFooter className="flex items-center justify-between border-t pt-4">
            <Button
              variant="outline"
              onClick={() => {
                if (wizardStep === "type") {
                  setShowCreateWizard(false);
                  resetWizard();
                } else {
                  prevStep();
                }
              }}
              disabled={isGenerating}
            >
              {wizardStep === "type" ? "Cancel" : "Back"}
            </Button>
            <div className="flex items-center gap-2">
              {wizardStep === "review" ? (
                <Button
                  onClick={() => createAssetMutation.mutate()}
                  disabled={!assetForm.name || isGenerating}
                  className="bg-gradient-to-r from-violet-500 to-fuchsia-600 hover:from-violet-600 hover:to-fuchsia-700 text-white"
                >
                  {isGenerating ? (
                    <>
                      <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4 mr-2" />
                      Create Asset
                    </>
                  )}
                </Button>
              ) : (
                <Button
                  onClick={nextStep}
                  disabled={
                    (wizardStep === "type" && !selectedAssetType) ||
                    (wizardStep === "details" && !assetForm.name)
                  }
                >
                  Continue
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              )}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* List Existing Asset Dialog */}
      <Dialog open={showListDialog} onOpenChange={setShowListDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Coins className="w-5 h-5 text-amber-500" />
              List Asset on Marketplace
            </DialogTitle>
            <DialogDescription>
              Configure pricing and licensing for your asset
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Asset Selection - only show if no asset pre-selected */}
            {!selectedAsset && (
              <div className="space-y-2">
                <Label>Select Asset</Label>
                <Select
                  value=""
                  onValueChange={(value) => {
                    const asset = (assets as Asset[]).find((a) => a.id === value);
                    setSelectedAsset(asset || null);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Choose an asset to list..." />
                  </SelectTrigger>
                  <SelectContent>
                    {(assets as Asset[]).filter(a => !a.marketplaceId).map((asset) => {
                      const config = ASSET_TYPE_CONFIG[asset.type];
                      return (
                        <SelectItem key={asset.id} value={asset.id}>
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className={config?.color}>{config?.label || asset.type}</Badge>
                            {asset.name}
                          </div>
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>
            )}

            {selectedAsset && (
              <>
                {/* Selected Asset Preview */}
                <Card className="bg-muted/50">
                  <CardContent className="pt-4">
                    <div className="flex items-center gap-3">
                      {(() => {
                        const config = ASSET_TYPE_CONFIG[selectedAsset.type];
                        const Icon = config?.icon || Package2;
                        return (
                          <div className={`p-2 rounded-lg ${config?.bgColor || "bg-muted"}`}>
                            <Icon className={`w-5 h-5 ${config?.color || ""}`} />
                          </div>
                        );
                      })()}
                      <div>
                        <p className="font-medium">{selectedAsset.name}</p>
                        <p className="text-sm text-muted-foreground">{ASSET_TYPE_CONFIG[selectedAsset.type]?.label || selectedAsset.type}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Pricing */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Pricing Type</Label>
                    <Select
                      value={listForm.priceType}
                      onValueChange={(value: NFTPricing["type"]) =>
                        setListForm({ ...listForm, priceType: value })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PRICING_TYPES.filter(t => t.value !== "free").map((type) => (
                          <SelectItem key={type.value} value={type.value}>
                            <div>
                              <div className="font-medium">{type.label}</div>
                              <div className="text-xs text-muted-foreground">{type.description}</div>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Price (USD)</Label>
                    <Input
                      type="number"
                      value={listForm.price}
                      onChange={(e) =>
                        setListForm({ ...listForm, price: parseFloat(e.target.value) || 0 })
                      }
                      placeholder="0.00"
                    />
                  </div>
                </div>

                {/* License */}
                <div className="space-y-2">
                  <Label>License Type</Label>
                  <Select
                    value={listForm.license}
                    onValueChange={(value: NFTLicenseType) =>
                      setListForm({ ...listForm, license: value })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {LICENSE_OPTIONS.map((opt) => {
                        const Icon = opt.icon;
                        return (
                          <SelectItem key={opt.value} value={opt.value}>
                            <div className="flex items-center gap-2">
                              <Icon className="w-4 h-4" />
                              <div>
                                <div className="font-medium">{opt.label}</div>
                                <div className="text-xs text-muted-foreground">{opt.description}</div>
                              </div>
                            </div>
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                </div>

                {/* Network */}
                <div className="space-y-2">
                  <Label>Blockchain Network</Label>
                  <Select
                    value={listForm.network}
                    onValueChange={(value: BlockchainNetwork) =>
                      setListForm({ ...listForm, network: value })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {NETWORK_OPTIONS.map((net) => (
                        <SelectItem key={net.value} value={net.value}>
                          {net.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Processing Progress */}
                {isChunking && (
                  <Card className="bg-gradient-to-r from-violet-500/10 to-fuchsia-500/10">
                    <CardContent className="pt-4">
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <Label>Processing...</Label>
                          <span className="text-sm text-muted-foreground">{chunkingProgress}%</span>
                        </div>
                        <Progress value={chunkingProgress} />
                        <p className="text-sm text-muted-foreground">
                          {chunkingProgress < 50
                            ? "Preparing asset..."
                            : chunkingProgress < 100
                            ? "Creating listing..."
                            : "Complete!"}
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowListDialog(false); setSelectedAsset(null); }}>
              Cancel
            </Button>
            <Button
              onClick={() => chunkAndListMutation.mutate()}
              disabled={!selectedAsset || isChunking}
              className="bg-gradient-to-r from-violet-500 to-fuchsia-600 hover:from-violet-600 hover:to-fuchsia-700 text-white"
            >
              {isChunking ? (
                <>
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <Coins className="w-4 h-4 mr-2" />
                  Create Listing
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
