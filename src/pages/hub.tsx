import React, { useState } from "react";
import {
  LayoutDashboard,
  Plus,
  MessageSquare,
  Bot,
  Workflow,
  Globe,
  Cpu,
  Home,
  Network,
  Brain,
  Shield,
  Radio,
  Kanban,
  Activity,
  FileText,
  Database,
  Package,
  HardDrive,
  Download,
  Rocket,
  Layers,
  Coins,
  BookOpen,
  Plug,
  Mail,
  ChevronRight,
  type LucideIcon,
} from "lucide-react";
import { Link, useRouter } from "@tanstack/react-router";
import { useLoadApps } from "@/hooks/useLoadApps";
import { useQuery } from "@tanstack/react-query";
import { IpcClient } from "@/ipc/ipc_client";
import { trustlessInferenceClient } from "@/ipc/trustless_inference_client";
import { CreateAppDialog } from "@/components/CreateAppDialog";
import { NeonConnector } from "@/components/NeonConnector";
import { cn } from "@/lib/utils";
import { useTemplates } from "@/hooks/useTemplates";
import { TemplateCard } from "@/components/TemplateCard";

// ---------------------------------------------------------------------------
// Quick Actions — the 6 most common entry points
// ---------------------------------------------------------------------------
const quickActions: {
  icon: LucideIcon;
  label: string;
  description: string;
  to?: string;
  action?: "createApp";
  gradient: string;
}[] = [
  {
    icon: Plus,
    label: "New App",
    description: "Scaffold a new project from a template",
    action: "createApp",
    gradient: "from-cyan-500/20 to-blue-500/20",
  },
  {
    icon: MessageSquare,
    label: "Chat with AI",
    description: "Open a new AI chat session",
    to: "/chat",
    gradient: "from-pink-500/20 to-rose-500/20",
  },
  {
    icon: Cpu,
    label: "Local AI",
    description: "Run models on your machine",
    to: "/local-models",
    gradient: "from-amber-500/20 to-yellow-500/20",
  },
  {
    icon: Bot,
    label: "Create Agent",
    description: "Build and deploy AI agents",
    to: "/agents",
    gradient: "from-violet-500/20 to-purple-500/20",
  },
  {
    icon: Workflow,
    label: "Build Workflow",
    description: "Automate tasks with workflows",
    to: "/workflows",
    gradient: "from-green-500/20 to-emerald-500/20",
  },
  {
    icon: Globe,
    label: "Web Scraping",
    description: "Extract data from the web",
    to: "/scraping",
    gradient: "from-rose-500/20 to-orange-500/20",
  },
];

// ---------------------------------------------------------------------------
// Full system navigation — mirrors every sidebar category + item
// ---------------------------------------------------------------------------
type NavItem = { title: string; to: string; icon: LucideIcon; gradient: string };

const systemNavCategories: {
  label: string;
  headerGradient: string;
  items: NavItem[];
}[] = [
  {
    label: "Explore",
    headerGradient: "from-pink-600 to-rose-600",
    items: [
      { title: "Hub", to: "/hub", icon: LayoutDashboard, gradient: "from-pink-500 to-rose-500" },
      { title: "Chat", to: "/chat", icon: MessageSquare, gradient: "from-cyan-500 to-blue-500" },
      { title: "Library", to: "/library", icon: BookOpen, gradient: "from-amber-500 to-yellow-500" },
      { title: "MCP Hub", to: "/mcp-hub", icon: Plug, gradient: "from-indigo-500 to-violet-500" },
      { title: "Email Hub", to: "/email-hub", icon: Mail, gradient: "from-emerald-500 to-teal-500" },
    ],
  },
  {
    label: "Create",
    headerGradient: "from-blue-600 to-indigo-600",
    items: [
      { title: "Apps", to: "/", icon: Home, gradient: "from-blue-500 to-indigo-500" },
      { title: "Agents", to: "/agents", icon: Bot, gradient: "from-violet-500 to-purple-500" },
      { title: "Agent Swarm", to: "/agent-swarm", icon: Network, gradient: "from-fuchsia-500 to-violet-500" },
      { title: "Workflows", to: "/workflows", icon: Workflow, gradient: "from-orange-500 to-amber-500" },
    ],
  },
  {
    label: "Build",
    headerGradient: "from-emerald-600 to-teal-600",
    items: [
      { title: "Local AI", to: "/local-models", icon: Shield, gradient: "from-emerald-500 to-teal-500" },
      { title: "Model Manager", to: "/model-download", icon: Download, gradient: "from-teal-500 to-cyan-500" },
      { title: "Documents", to: "/documents", icon: FileText, gradient: "from-sky-500 to-cyan-500" },
      { title: "Data Studio", to: "/datasets", icon: Database, gradient: "from-emerald-500 to-teal-500" },
      { title: "Web Scraping", to: "/scraping", icon: Globe, gradient: "from-rose-500 to-orange-500" },
      { title: "Data Vault", to: "/local-vault", icon: HardDrive, gradient: "from-amber-500 to-orange-500" },
      { title: "Knowledge Base", to: "/knowledge-base", icon: Brain, gradient: "from-violet-500 to-purple-500" },
      { title: "Asset Studio", to: "/asset-studio", icon: Package, gradient: "from-fuchsia-500 to-pink-500" },
      { title: "AI Operations", to: "/system-services", icon: Activity, gradient: "from-emerald-500 to-green-500" },
      { title: "OpenClaw Control", to: "/openclaw-control", icon: Radio, gradient: "from-rose-500 to-orange-500" },
      { title: "OpenClaw Board", to: "/openclaw-kanban", icon: Kanban, gradient: "from-red-500 to-orange-500" },
    ],
  },
  {
    label: "Publish",
    headerGradient: "from-violet-600 to-fuchsia-600",
    items: [
      { title: "Publish", to: "/deploy", icon: Rocket, gradient: "from-violet-500 to-fuchsia-500" },
      { title: "Web3 Deploy", to: "/decentralized-deploy", icon: Layers, gradient: "from-cyan-500 to-blue-500" },
      { title: "Marketplace", to: "/nft-marketplace", icon: Coins, gradient: "from-purple-500 to-indigo-500" },
      { title: "Federation", to: "/federation", icon: Globe, gradient: "from-cyan-500 to-teal-500" },
      { title: "P2P Chat", to: "/decentralized-chat", icon: Radio, gradient: "from-green-500 to-emerald-500" },
      { title: "AI Compute", to: "/compute", icon: Cpu, gradient: "from-amber-500 to-orange-500" },
    ],
  },
];

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
const HubPage: React.FC = () => {
  const router = useRouter();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);

  // Stats data
  const { apps } = useLoadApps();
  const { data: models = [], isLoading: modelsLoading } = useQuery({
    queryKey: ["hub-local-models"],
    queryFn: () => trustlessInferenceClient.listModels(),
  });
  const { data: conversations = [], isLoading: convLoading } = useQuery({
    queryKey: ["hub-conversations"],
    queryFn: () => trustlessInferenceClient.listConversations(),
  });
  const { data: chats = [], isLoading: chatsLoading } = useQuery({
    queryKey: ["hub-chats"],
    queryFn: () => IpcClient.getInstance().getChats(),
  });
  const { templates } = useTemplates();

  const officialTemplates =
    templates?.filter((t) => t.isOfficial) || [];
  const communityTemplates =
    templates?.filter((t) => !t.isOfficial) || [];

  return (
    <div className="min-h-screen px-8 py-6 space-y-10">
      {/* ── Hero Header ─────────────────────────────────────────────── */}
      <header className="relative overflow-hidden rounded-2xl border border-cyan-500/20 bg-gradient-to-r from-cyan-500/10 via-blue-500/10 to-indigo-500/10 p-8">
        <div className="flex items-center gap-5">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-500 to-indigo-500 shadow-lg shadow-cyan-500/25">
            <LayoutDashboard className="h-7 w-7 text-white" />
          </div>
          <div>
            <h1 className="text-3xl font-extrabold bg-gradient-to-r from-cyan-500 via-blue-500 to-indigo-500 bg-clip-text text-transparent">
              Command Center
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Your system at a glance — stats, shortcuts, and every feature in one place.
            </p>
          </div>
        </div>
        {/* Decorative dots */}
        <div className="pointer-events-none absolute -right-4 -top-4 h-32 w-32 rounded-full bg-cyan-500/10 blur-2xl" />
        <div className="pointer-events-none absolute -bottom-6 right-20 h-24 w-24 rounded-full bg-indigo-500/10 blur-2xl" />
      </header>

      {/* ── Quick Stats ─────────────────────────────────────────────── */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Apps" value={apps?.length ?? 0} loading={false} gradient="from-cyan-500 to-blue-500" />
        <StatCard label="Local Models" value={models.length} loading={modelsLoading} gradient="from-amber-500 to-yellow-500" />
        <StatCard label="Conversations" value={conversations.length} loading={convLoading} gradient="from-pink-500 to-rose-500" />
        <StatCard label="Chats" value={chats.length} loading={chatsLoading} gradient="from-green-500 to-emerald-500" />
      </section>

      {/* ── Quick Actions ───────────────────────────────────────────── */}
      <section>
        <SectionHeading>Quick Actions</SectionHeading>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          {quickActions.map((a) => (
            <button
              key={a.label}
              type="button"
              onClick={() => {
                if (a.action === "createApp") setIsCreateDialogOpen(true);
                else if (a.to) router.navigate({ to: a.to });
              }}
              className={cn(
                "group flex items-start gap-4 rounded-xl border border-border/40 p-5 text-left transition-all",
                "hover:border-border hover:shadow-md hover:shadow-black/5 hover:-translate-y-0.5",
                "bg-gradient-to-br",
                a.gradient,
              )}
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-background/60 backdrop-blur">
                <a.icon className="h-5 w-5 text-foreground" />
              </div>
              <div className="min-w-0">
                <div className="font-semibold leading-tight">{a.label}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">{a.description}</div>
              </div>
            </button>
          ))}
        </div>
      </section>

      {/* ── System Navigation ───────────────────────────────────────── */}
      <section>
        <SectionHeading>System Navigation</SectionHeading>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
          {systemNavCategories.map((cat) => (
            <div
              key={cat.label}
              className="rounded-2xl border border-border/40 bg-card overflow-hidden"
            >
              {/* Category header */}
              <div className={cn("px-5 py-3 bg-gradient-to-r text-white font-semibold text-sm tracking-wide", cat.headerGradient)}>
                {cat.label}
              </div>

              {/* Items */}
              <div className="divide-y divide-border/30">
                {cat.items.map((item) => (
                  <Link
                    key={item.to}
                    to={item.to}
                    className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted/60 group"
                  >
                    <div className={cn(
                      "flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-gradient-to-br",
                      item.gradient,
                    )}>
                      <item.icon className="h-3.5 w-3.5 text-white" />
                    </div>
                    <span className="flex-1 text-sm font-medium">{item.title}</span>
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Backend & Templates ─────────────────────────────────────── */}
      <details className="rounded-2xl border border-border/40 bg-card overflow-hidden">
        <summary className="cursor-pointer px-6 py-4 font-semibold text-lg select-none hover:bg-muted/40 transition-colors">
          Backend &amp; Templates
        </summary>
        <div className="px-6 pb-6 space-y-8">
          <NeonConnector />

          {officialTemplates.length > 0 && (
            <div>
              <h3 className="font-semibold mb-3">Official Templates</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {officialTemplates.map((t) => (
                  <TemplateCard
                    key={t.id}
                    template={t}
                    isSelected={false}
                    onSelect={() => {}}
                    onCreateApp={() => setIsCreateDialogOpen(true)}
                  />
                ))}
              </div>
            </div>
          )}

          {communityTemplates.length > 0 && (
            <div>
              <h3 className="font-semibold mb-3">Community Templates</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {communityTemplates.map((t) => (
                  <TemplateCard
                    key={t.id}
                    template={t}
                    isSelected={false}
                    onSelect={() => {}}
                    onCreateApp={() => setIsCreateDialogOpen(true)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </details>

      <CreateAppDialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen} template={undefined} />
    </div>
  );
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------
function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-4 text-xl font-bold tracking-tight">{children}</h2>;
}

function StatCard({
  label,
  value,
  loading,
  gradient,
}: {
  label: string;
  value: number;
  loading: boolean;
  gradient: string;
}) {
  return (
    <div className="rounded-2xl border border-border/40 bg-card p-5 flex items-center gap-4">
      <div className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br shadow-sm", gradient)}>
        <span className="text-base font-bold text-white">
          {loading ? "…" : value}
        </span>
      </div>
      <div>
        <div className="text-2xl font-extrabold leading-none">
          {loading ? <span className="animate-pulse text-muted-foreground">—</span> : value}
        </div>
        <div className="mt-0.5 text-xs text-muted-foreground">{label}</div>
      </div>
    </div>
  );
}

export default HubPage;
