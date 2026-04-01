import { useState, useMemo, useEffect, useCallback } from "react";
import { Link } from "@tanstack/react-router";
import {
  Brain,
  Workflow,
  MessageSquare,
  Paintbrush,
  Wallet,
  Database,
  Code,
  FileText,
  ExternalLink,
  Search,
  Download,
  Container,
  Send,
  Image,
  HardDrive,
  Terminal,
  GitBranch,
  Monitor,
  CheckCircle2,
  XCircle,
  RefreshCw,
  ArrowRight,
  Cpu,
  Zap,
  Camera,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { IpcClient } from "@/ipc/ipc_client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Category =
  | "AI & Models"
  | "Automation"
  | "Communication"
  | "Creative"
  | "Crypto & Web3"
  | "Data"
  | "Dev Tools"
  | "Office";

type StatusMethod =
  | { kind: "http"; url: string }
  | { kind: "ipc"; fn: () => Promise<boolean> }
  | { kind: "none" };

interface Integration {
  id: string;
  name: string;
  description: string;
  category: Category;
  url: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  linkedRoute?: string;
  linkedLabel?: string;
  status: StatusMethod;
}

// ---------------------------------------------------------------------------
// Integration catalog
// ---------------------------------------------------------------------------

const INTEGRATIONS: Integration[] = [
  // ── AI & Models ─────────────────────────────────────────────────────────
  {
    id: "ollama",
    name: "Ollama",
    description:
      "Runs local LLMs on your machine. JoyCreate uses Ollama as the local model backend for Chat, Document AI, and Agents — no API key needed.",
    category: "AI & Models",
    url: "https://ollama.com/download",
    icon: Brain,
    color: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
    linkedRoute: "/local-models",
    linkedLabel: "Local Models",
    status: { kind: "http" as const, url: "http://localhost:11434" },
  },
  {
    id: "lmstudio",
    name: "LM Studio",
    description:
      "Run open-source LLMs locally with an OpenAI-compatible API. JoyCreate auto-detects LM Studio models for Chat, Documents, and Agents.",
    category: "AI & Models",
    url: "https://lmstudio.ai",
    icon: Cpu,
    color: "bg-violet-500/15 text-violet-600 dark:text-violet-400",
    linkedRoute: "/local-models",
    linkedLabel: "Local Models",
    status: { kind: "http" as const, url: "http://localhost:1234/v1/models" },
  },
  {
    id: "comfyui",
    name: "ComfyUI",
    description:
      "Node-based Stable Diffusion UI. JoyCreate's Asset Studio connects to ComfyUI for local image generation and creative pipelines.",
    category: "AI & Models",
    url: "https://github.com/comfyanonymous/ComfyUI",
    icon: Camera,
    color: "bg-pink-500/15 text-pink-600 dark:text-pink-400",
    linkedRoute: "/asset-studio",
    linkedLabel: "Asset Studio",
    status: { kind: "http" as const, url: "http://localhost:8188" },
  },

  // ── Automation ───────────────────────────────────────────────────────────
  {
    id: "n8n",
    name: "n8n",
    description:
      "Visual workflow automation. JoyCreate generates, deploys, and manages n8n workflows from natural language — powering the Workflows feature.",
    category: "Automation",
    url: "https://n8n.io/get-started",
    icon: Workflow,
    color: "bg-orange-500/15 text-orange-600 dark:text-orange-400",
    linkedRoute: "/workflows",
    linkedLabel: "Workflows",
    status: { kind: "http" as const, url: "http://localhost:5678/healthz" },
  },
  {
    id: "docker",
    name: "Docker Desktop",
    description:
      "Container runtime required to run JoyCreate's companion services (n8n, PostgreSQL, Celestia node) with a single click.",
    category: "Automation",
    url: "https://www.docker.com/products/docker-desktop",
    icon: Container,
    color: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
    linkedRoute: "/system-services",
    linkedLabel: "System Services",
    status: { kind: "none" as const },
  },

  // ── Communication ────────────────────────────────────────────────────────
  {
    id: "telegram",
    name: "Telegram",
    description:
      "Fast, encrypted messaging. Use Telegram alongside JoyCreate's decentralized chat or set up a bot to relay AI agent notifications.",
    category: "Communication",
    url: "https://desktop.telegram.org",
    icon: Send,
    color: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
    status: { kind: "none" as const },
  },
  {
    id: "discord",
    name: "Discord",
    description:
      "Voice, video, and text for communities. Share JoyCreate outputs and join the JoyCreate community server to collaborate.",
    category: "Communication",
    url: "https://discord.com/download",
    icon: MessageSquare,
    color: "bg-indigo-500/15 text-indigo-600 dark:text-indigo-400",
    status: { kind: "none" as const },
  },
  {
    id: "slack",
    name: "Slack",
    description:
      "Team messaging and integrations. Connect JoyCreate's n8n workflows to Slack to send AI-generated reports and alerts to channels.",
    category: "Communication",
    url: "https://slack.com/downloads",
    icon: MessageSquare,
    color: "bg-purple-500/15 text-purple-600 dark:text-purple-400",
    status: { kind: "none" as const },
  },

  // ── Creative ─────────────────────────────────────────────────────────────
  {
    id: "blender",
    name: "Blender",
    description:
      "Open-source 3D creation suite. Create 3D assets in Blender, then import them into JoyCreate's Asset Studio for AI-enhanced rendering.",
    category: "Creative",
    url: "https://www.blender.org/download",
    icon: Paintbrush,
    color: "bg-orange-500/15 text-orange-600 dark:text-orange-400",
    linkedRoute: "/asset-studio",
    linkedLabel: "Asset Studio",
    status: { kind: "none" as const },
  },
  {
    id: "gimp",
    name: "GIMP",
    description:
      "Powerful open-source image editor. Refine AI-generated images from JoyCreate's Asset Studio and reimport them into your projects.",
    category: "Creative",
    url: "https://www.gimp.org/downloads",
    icon: Image,
    color: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
    linkedRoute: "/asset-studio",
    linkedLabel: "Asset Studio",
    status: { kind: "none" as const },
  },

  // ── Crypto & Web3 ────────────────────────────────────────────────────────
  {
    id: "metamask",
    name: "MetaMask",
    description:
      "Ethereum wallet. Connect MetaMask to JoyCreate's NFT Marketplace to mint, buy, and sell AI-generated assets on EVM chains.",
    category: "Crypto & Web3",
    url: "https://metamask.io/download",
    icon: Wallet,
    color: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
    linkedRoute: "/nft-marketplace",
    linkedLabel: "NFT Marketplace",
    status: { kind: "none" as const },
  },
  {
    id: "phantom",
    name: "Phantom",
    description:
      "Multi-chain wallet for Solana and Ethereum. Use Phantom with JoyCreate's Marketplace to trade AI-generated NFTs on Solana.",
    category: "Crypto & Web3",
    url: "https://phantom.app/download",
    icon: Wallet,
    color: "bg-violet-500/15 text-violet-600 dark:text-violet-400",
    linkedRoute: "/nft-marketplace",
    linkedLabel: "NFT Marketplace",
    status: { kind: "none" as const },
  },
  {
    id: "ipfs",
    name: "IPFS Desktop",
    description:
      "Peer-to-peer file storage (Kubo). JoyCreate's Library pins files to your local IPFS node for decentralized, permanent storage.",
    category: "Crypto & Web3",
    url: "https://docs.ipfs.tech/install/ipfs-desktop",
    icon: HardDrive,
    color: "bg-cyan-500/15 text-cyan-600 dark:text-cyan-400",
    linkedRoute: "/library",
    linkedLabel: "Library",
    status: { kind: "http" as const, url: "http://localhost:5001/api/v0/version" },
  },

  // ── Data ─────────────────────────────────────────────────────────────────
  {
    id: "postgres",
    name: "PostgreSQL",
    description:
      "Advanced relational database. JoyCreate uses PostgreSQL (via Docker) for vector embeddings, conversation history, and Knowledge Base storage.",
    category: "Data",
    url: "https://www.postgresql.org/download",
    icon: Database,
    color: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
    linkedRoute: "/knowledge-base",
    linkedLabel: "Knowledge Base",
    status: { kind: "none" as const },
  },

  // ── Dev Tools ────────────────────────────────────────────────────────────
  {
    id: "vscode",
    name: "VS Code",
    description:
      "Lightweight, extensible code editor. JoyCreate's Coding Agent can open generated code directly in VS Code and apply AI diffs.",
    category: "Dev Tools",
    url: "https://code.visualstudio.com/download",
    icon: Code,
    color: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
    linkedRoute: "/coding-agent",
    linkedLabel: "Coding Agent",
    status: { kind: "none" as const },
  },
  {
    id: "cursor",
    name: "Cursor",
    description:
      "AI-first code editor. Pair Cursor with JoyCreate's AI scaffolding to get real-time completions on generated projects.",
    category: "Dev Tools",
    url: "https://www.cursor.com",
    icon: Monitor,
    color: "bg-fuchsia-500/15 text-fuchsia-600 dark:text-fuchsia-400",
    linkedRoute: "/coding-agent",
    linkedLabel: "Coding Agent",
    status: { kind: "none" as const },
  },
  {
    id: "git",
    name: "Git",
    description:
      "Distributed version control. JoyCreate can commit Library files and AI-generated projects to Git repositories.",
    category: "Dev Tools",
    url: "https://git-scm.com/downloads",
    icon: GitBranch,
    color: "bg-red-500/15 text-red-600 dark:text-red-400",
    status: { kind: "none" as const },
  },
  {
    id: "python",
    name: "Python",
    description:
      "The leading AI/ML language. JoyCreate's local Agent runner can execute Python scripts for custom data processing and model tasks.",
    category: "Dev Tools",
    url: "https://www.python.org/downloads",
    icon: Terminal,
    color: "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400",
    status: { kind: "none" as const },
  },
  {
    id: "nodejs",
    name: "Node.js",
    description:
      "JavaScript runtime. Required by JoyCreate's n8n integration and automation scripts. Keep it up to date for best compatibility.",
    category: "Dev Tools",
    url: "https://nodejs.org/en/download",
    icon: Zap,
    color: "bg-green-500/15 text-green-600 dark:text-green-400",
    status: { kind: "none" as const },
  },

  // ── Office ───────────────────────────────────────────────────────────────
  {
    id: "libreoffice",
    name: "LibreOffice",
    description:
      "Full-featured office suite. JoyCreate's Document Studio uses LibreOffice for headless PDF export, DOCX conversion, and presentation rendering.",
    category: "Office",
    url: "https://www.libreoffice.org/download/download-libreoffice",
    icon: FileText,
    color: "bg-green-500/15 text-green-600 dark:text-green-400",
    linkedRoute: "/documents",
    linkedLabel: "Document Studio",
    status: {
      kind: "ipc" as const,
      fn: async () => {
        const result = await IpcClient.getInstance().getLibreOfficeStatus();
        return result?.installed === true;
      },
    },
  },
];

const ALL_CATEGORIES: Category[] = [
  "AI & Models",
  "Automation",
  "Communication",
  "Creative",
  "Crypto & Web3",
  "Data",
  "Dev Tools",
  "Office",
];

const CATEGORY_COLORS: Record<Category, string> = {
  "AI & Models": "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20",
  Automation: "bg-orange-500/10 text-orange-700 dark:text-orange-300 border-orange-500/20",
  Communication: "bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border-indigo-500/20",
  Creative: "bg-pink-500/10 text-pink-700 dark:text-pink-300 border-pink-500/20",
  "Crypto & Web3": "bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-500/20",
  Data: "bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/20",
  "Dev Tools": "bg-gray-500/10 text-gray-700 dark:text-gray-300 border-gray-500/20",
  Office: "bg-green-500/10 text-green-700 dark:text-green-300 border-green-500/20",
};

// ---------------------------------------------------------------------------
// Status detection hook
// ---------------------------------------------------------------------------

type StatusState = "unknown" | "running" | "stopped";

function useIntegrationStatuses(integrations: Integration[]) {
  const [statuses, setStatuses] = useState<Record<string, StatusState>>(() =>
    Object.fromEntries(integrations.map((i) => [i.id, "unknown" as StatusState]))
  );
  const [checking, setChecking] = useState(false);

  const check = useCallback(async () => {
    setChecking(true);
    const results: Record<string, StatusState> = {};

    await Promise.all(
      integrations.map(async (item) => {
        if (item.status.kind === "none") {
          results[item.id] = "unknown";
          return;
        }
        try {
          if (item.status.kind === "http") {
            const res = await fetch(item.status.url, {
              signal: AbortSignal.timeout(2000),
              mode: "no-cors",
            });
            results[item.id] = res.type === "opaque" || res.ok ? "running" : "stopped";
          } else if (item.status.kind === "ipc") {
            const ok = await item.status.fn();
            results[item.id] = ok ? "running" : "stopped";
          }
        } catch {
          results[item.id] = "stopped";
        }
      })
    );

    setStatuses((prev) => ({ ...prev, ...results }));
    setChecking(false);
  }, [integrations]);

  useEffect(() => {
    check();
    const interval = setInterval(check, 30_000);
    return () => clearInterval(interval);
  }, [check]);

  return { statuses, check, checking };
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: StatusState }) {
  if (status === "running") {
    return (
      <span className="flex items-center gap-1 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
        <CheckCircle2 className="h-3 w-3" />
        Running
      </span>
    );
  }
  if (status === "stopped") {
    return (
      <span className="flex items-center gap-1 text-[10px] font-medium text-red-500/70">
        <XCircle className="h-3 w-3" />
        Not detected
      </span>
    );
  }
  return null;
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

function IntegrationCard({
  item,
  status,
}: {
  item: Integration;
  status: StatusState;
}) {
  const Icon = item.icon;
  const hasStatusCheck = item.status.kind !== "none";

  return (
    <Card className="group relative overflow-hidden border border-white/10 bg-white/5 backdrop-blur-sm transition-all hover:border-white/20 hover:bg-white/[0.08] hover:shadow-lg">
      <CardContent className="flex items-start gap-4 p-4">
        {/* Icon */}
        <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${item.color}`}>
          <Icon className="h-5 w-5" />
        </div>

        {/* Info */}
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{item.name}</h3>
            <Badge variant="outline" className={`text-[10px] px-1.5 py-0 leading-4 shrink-0 ${CATEGORY_COLORS[item.category]}`}>
              {item.category}
            </Badge>
            {hasStatusCheck && <StatusBadge status={status} />}
          </div>
          <p className="text-xs text-gray-400 line-clamp-3 leading-relaxed">{item.description}</p>
          {item.linkedRoute && (
            <Link to={item.linkedRoute}>
              <button
                type="button"
                className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-medium text-violet-500 hover:text-violet-400 transition-colors"
              >
                <ArrowRight className="h-3 w-3" />
                Open {item.linkedLabel} in JoyCreate
              </button>
            </Link>
          )}
        </div>

        {/* Download button */}
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0 h-9 w-9 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
          onClick={() => IpcClient.getInstance().openExternalUrl(item.url)}
          title={`Install ${item.name}`}
        >
          <ExternalLink className="h-4 w-4" />
        </Button>
      </CardContent>
    </Card>
  );
}

export default function IntegrationsPage() {
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<Category | "All">("All");

  const filtered = useMemo(
    () =>
      INTEGRATIONS.filter((item) => {
        const matchesCategory = activeCategory === "All" || item.category === activeCategory;
        const matchesSearch =
          !search ||
          item.name.toLowerCase().includes(search.toLowerCase()) ||
          item.description.toLowerCase().includes(search.toLowerCase()) ||
          item.category.toLowerCase().includes(search.toLowerCase());
        return matchesCategory && matchesSearch;
      }),
    [search, activeCategory]
  );

  const { statuses, check, checking } = useIntegrationStatuses(INTEGRATIONS);

  const runningCount = Object.values(statuses).filter((s) => s === "running").length;

  return (
    <ScrollArea className="h-full">
      <div className="min-h-screen px-8 py-6">
        {/* Header */}
        <div className="relative mb-8 overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-teal-500/20 via-cyan-500/10 to-blue-500/20 p-8">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-teal-500/10 via-transparent to-transparent" />
          <div className="relative flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-500/20 text-teal-400">
                  <Download className="h-5 w-5" />
                </div>
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Integrations</h1>
              </div>
              <p className="text-sm text-gray-400 max-w-xl">
                Tools that plug into JoyCreate features. Click{" "}
                <ExternalLink className="inline h-3 w-3" /> to open the download page, or use{" "}
                <ArrowRight className="inline h-3 w-3" /> to navigate to the relevant JoyCreate feature.
              </p>
              {runningCount > 0 && (
                <p className="mt-2 text-xs text-emerald-500 font-medium">
                  {runningCount} service{runningCount !== 1 ? "s" : ""} detected and running
                </p>
              )}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={check}
              disabled={checking}
              className="shrink-0 gap-1.5 border-white/20 bg-white/5 hover:bg-white/10"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${checking ? "animate-spin" : ""}`} />
              {checking ? "Checking…" : "Recheck"}
            </Button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-3 mb-6">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
            <Input
              placeholder="Search integrations…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 bg-white/5 border-white/10"
            />
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Button
              variant={activeCategory === "All" ? "secondary" : "ghost"}
              size="sm"
              className="text-xs h-8"
              onClick={() => setActiveCategory("All")}
            >
              All
            </Button>
            {ALL_CATEGORIES.map((cat) => (
              <Button
                key={cat}
                variant={activeCategory === cat ? "secondary" : "ghost"}
                size="sm"
                className="text-xs h-8"
                onClick={() => setActiveCategory(cat)}
              >
                {cat}
              </Button>
            ))}
          </div>
        </div>

        {/* Count */}
        <p className="text-xs text-gray-500 mb-4">
          {filtered.length} integration{filtered.length !== 1 ? "s" : ""}
          {activeCategory !== "All" && ` in ${activeCategory}`}
        </p>

        {/* Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {filtered.map((item) => (
            <IntegrationCard key={item.id} item={item} status={statuses[item.id]} />
          ))}
        </div>

        {filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-gray-500">
            <Search className="h-10 w-10 mb-3 opacity-40" />
            <p className="text-sm">No integrations match your search.</p>
          </div>
        )}
      </div>
    </ScrollArea>
  );
}
