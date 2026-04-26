import {
  Home,
  MessageSquare,
  Settings,
  HelpCircle,
  LayoutDashboard,
  BookOpen,
  Bot,
  Workflow,
  Shield,
  Sparkles,
  PanelLeftClose,
  PanelLeft,
  Plus,
  FileText,
  Rocket,
  Database,
  Package,
  Coins,
  Globe,
  Layers,
  Zap,
  ChevronDown,
  ChevronUp,
  Radio,
  Cpu,
  Plug,
  Network,
  HardDrive,
  Download,
  Kanban,
  Activity,
  Mail,
  Puzzle,
  ShoppingBag,
  Brain,
  GitMerge,
  Calendar,
  GraduationCap,
  Landmark,
  Vote,
  CircleDollarSign,
  KeyRound,
  Hammer,
  Gauge,
  Code2,
  BrainCircuit,
  Palette,
  Lock,
  ShoppingCart,
  Orbit,
  Bug,
  FlaskConical,
  Server,
  FileSearch,
  BellRing,
  UserCircle,
  LayoutDashboard as AdminIcon,
  ScrollText,
  Archive,
  BarChart3,
  Image as ImageIcon,
  Video,
  Stamp,
  UserCheck,
  Fingerprint,
} from "lucide-react";
import { Link, useRouterState, useRouter } from "@tanstack/react-router";
import { useSidebar } from "@/components/ui/sidebar";
import { useEffect, useState, useRef } from "react";
import { useAtom } from "jotai";
import { dropdownOpenAtom } from "@/atoms/uiAtoms";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { useLoadApps } from "@/hooks/useLoadApps";
import { useSettings } from "@/hooks/useSettings";
import { useTemplates } from "@/hooks/useTemplates";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CNSWidget } from "@/components/openclaw/CNSWidget";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import { ChatList } from "./ChatList";
import { AppList } from "./AppList";
import { HelpDialog } from "./HelpDialog";
import { SettingsList } from "./SettingsList";
import { CreateAppDialog } from "./CreateAppDialog";
import { Button } from "./ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// Organized menu categories — grouped by user-journey (workspace → AI →
// build → data → network → publish → sovereign → productivity → admin)
const menuCategories = [
  {
    label: "Workspace",
    items: [
      {
        title: "Hub",
        to: "/hub",
        icon: LayoutDashboard,
        gradient: "from-pink-500 to-rose-500",
        hoverBg: "hover:bg-pink-500/10",
        activeBg: "bg-pink-500/15",
        activeText: "text-pink-600 dark:text-pink-400",
      },
      {
        title: "Apps",
        to: "/",
        icon: Home,
        gradient: "from-blue-500 to-indigo-500",
        hoverBg: "hover:bg-blue-500/10",
        activeBg: "bg-blue-500/15",
        activeText: "text-blue-600 dark:text-blue-400",
      },
      {
        title: "Chat",
        to: "/chat",
        icon: MessageSquare,
        gradient: "from-cyan-500 to-blue-500",
        hoverBg: "hover:bg-cyan-500/10",
        activeBg: "bg-cyan-500/15",
        activeText: "text-cyan-600 dark:text-cyan-400",
      },
    ],
  },
  {
    label: "AI & Agents",
    items: [
      {
        title: "Local AI",
        to: "/local-models",
        icon: Shield,
        gradient: "from-emerald-500 to-teal-500",
        hoverBg: "hover:bg-emerald-500/10",
        activeBg: "bg-emerald-500/15",
        activeText: "text-emerald-600 dark:text-emerald-400",
      },
      {
        title: "Agents",
        to: "/agents",
        icon: Bot,
        gradient: "from-violet-500 to-purple-500",
        hoverBg: "hover:bg-violet-500/10",
        activeBg: "bg-violet-500/15",
        activeText: "text-violet-600 dark:text-violet-400",
      },
      {
        title: "Agent Swarm",
        to: "/agent-swarm",
        icon: Network,
        gradient: "from-fuchsia-500 to-violet-500",
        hoverBg: "hover:bg-fuchsia-500/10",
        activeBg: "bg-fuchsia-500/15",
        activeText: "text-fuchsia-600 dark:text-fuchsia-400",
      },
      {
        title: "Agent Orchestrator",
        to: "/agent-orchestrator",
        icon: Orbit,
        gradient: "from-rose-500 to-pink-500",
        hoverBg: "hover:bg-rose-500/10",
        activeBg: "bg-rose-500/15",
        activeText: "text-rose-600 dark:text-rose-400",
      },
      {
        title: "Autonomous Agent",
        to: "/autonomous-agent",
        icon: BrainCircuit,
        gradient: "from-purple-500 to-indigo-500",
        hoverBg: "hover:bg-purple-500/10",
        activeBg: "bg-purple-500/15",
        activeText: "text-purple-600 dark:text-purple-400",
      },
      {
        title: "Agent Production",
        to: "/autonomous-agent-production",
        icon: Activity,
        gradient: "from-emerald-500 to-green-500",
        hoverBg: "hover:bg-emerald-500/10",
        activeBg: "bg-emerald-500/15",
        activeText: "text-emerald-600 dark:text-emerald-400",
      },
      {
        title: "Coding Agent",
        to: "/coding-agent",
        icon: Code2,
        gradient: "from-green-500 to-emerald-500",
        hoverBg: "hover:bg-green-500/10",
        activeBg: "bg-green-500/15",
        activeText: "text-green-600 dark:text-green-400",
      },
      {
        title: "Skills",
        to: "/skills",
        icon: Sparkles,
        gradient: "from-orange-500 to-amber-500",
        hoverBg: "hover:bg-orange-500/10",
        activeBg: "bg-orange-500/15",
        activeText: "text-orange-600 dark:text-orange-400",
      },
      {
        title: "Training Center",
        to: "/training",
        icon: GraduationCap,
        gradient: "from-emerald-500 to-teal-500",
        hoverBg: "hover:bg-emerald-500/10",
        activeBg: "bg-emerald-500/15",
        activeText: "text-emerald-600 dark:text-emerald-400",
      },
      {
        title: "Memory",
        to: "/memory",
        icon: Brain,
        gradient: "from-violet-500 to-purple-500",
        hoverBg: "hover:bg-violet-500/10",
        activeBg: "bg-violet-500/15",
        activeText: "text-violet-600 dark:text-violet-400",
      },
      {
        title: "AI Learning",
        to: "/ai-learning",
        icon: FlaskConical,
        gradient: "from-cyan-500 to-blue-500",
        hoverBg: "hover:bg-cyan-500/10",
        activeBg: "bg-cyan-500/15",
        activeText: "text-cyan-600 dark:text-cyan-400",
      },
      {
        title: "NLP Studio",
        to: "/nlp-studio",
        icon: Brain,
        gradient: "from-emerald-500 to-cyan-500",
        hoverBg: "hover:bg-emerald-500/10",
        activeBg: "bg-emerald-500/15",
        activeText: "text-emerald-600 dark:text-emerald-400",
      },
    ],
  },
  {
    label: "Build",
    items: [
      {
        title: "App Builder Studio",
        to: "/app-builder",
        icon: Hammer,
        gradient: "from-pink-500 to-violet-600",
        hoverBg: "hover:bg-pink-500/10",
        activeBg: "bg-pink-500/15",
        activeText: "text-pink-600 dark:text-pink-400",
      },
      {
        title: "Code Studio",
        to: "/code-studio",
        icon: Code2,
        gradient: "from-cyan-500 to-blue-500",
        hoverBg: "hover:bg-cyan-500/10",
        activeBg: "bg-cyan-500/15",
        activeText: "text-cyan-600 dark:text-cyan-400",
      },
      {
        title: "Workflows",
        to: "/workflows",
        icon: Workflow,
        gradient: "from-orange-500 to-amber-500",
        hoverBg: "hover:bg-orange-500/10",
        activeBg: "bg-orange-500/15",
        activeText: "text-orange-600 dark:text-orange-400",
      },
      {
        title: "Neural Builder",
        to: "/neural-builder",
        icon: Brain,
        gradient: "from-purple-500 to-pink-500",
        hoverBg: "hover:bg-purple-500/10",
        activeBg: "bg-purple-500/15",
        activeText: "text-purple-600 dark:text-purple-400",
      },
      {
        title: "CI/CD Pipelines",
        to: "/cicd-builder",
        icon: GitMerge,
        gradient: "from-slate-500 to-gray-500",
        hoverBg: "hover:bg-slate-500/10",
        activeBg: "bg-slate-500/15",
        activeText: "text-slate-600 dark:text-slate-400",
      },
      {
        title: "Design System",
        to: "/design-system",
        icon: Palette,
        gradient: "from-pink-500 to-rose-500",
        hoverBg: "hover:bg-pink-500/10",
        activeBg: "bg-pink-500/15",
        activeText: "text-pink-600 dark:text-pink-400",
      },
      {
        title: "Image Studio",
        to: "/image-studio",
        icon: ImageIcon,
        gradient: "from-pink-500 to-violet-500",
        hoverBg: "hover:bg-pink-500/10",
        activeBg: "bg-pink-500/15",
        activeText: "text-pink-600 dark:text-pink-400",
      },
      {
        title: "Video Studio",
        to: "/video-studio",
        icon: Video,
        gradient: "from-blue-500 to-cyan-500",
        hoverBg: "hover:bg-blue-500/10",
        activeBg: "bg-blue-500/15",
        activeText: "text-blue-600 dark:text-blue-400",
      },
      {
        title: "Asset Studio",
        to: "/asset-studio",
        icon: Package,
        gradient: "from-fuchsia-500 to-pink-500",
        hoverBg: "hover:bg-fuchsia-500/10",
        activeBg: "bg-fuchsia-500/15",
        activeText: "text-fuchsia-600 dark:text-fuchsia-400",
      },
      {
        title: "Scraping",
        to: "/scraping",
        icon: Bug,
        gradient: "from-orange-500 to-red-500",
        hoverBg: "hover:bg-orange-500/10",
        activeBg: "bg-orange-500/15",
        activeText: "text-orange-600 dark:text-orange-400",
      },
    ],
  },
  {
    label: "Data",
    items: [
      {
        title: "Library",
        to: "/library",
        icon: BookOpen,
        gradient: "from-amber-500 to-yellow-500",
        hoverBg: "hover:bg-amber-500/10",
        activeBg: "bg-amber-500/15",
        activeText: "text-amber-600 dark:text-amber-400",
      },
      {
        title: "Documents",
        to: "/documents",
        icon: FileText,
        gradient: "from-sky-500 to-cyan-500",
        hoverBg: "hover:bg-sky-500/10",
        activeBg: "bg-sky-500/15",
        activeText: "text-sky-600 dark:text-sky-400",
      },
      {
        title: "Dataset Studio",
        to: "/datasets",
        icon: Database,
        gradient: "from-emerald-500 to-teal-500",
        hoverBg: "hover:bg-emerald-500/10",
        activeBg: "bg-emerald-500/15",
        activeText: "text-emerald-600 dark:text-emerald-400",
      },
      {
        title: "Data Vault",
        to: "/local-vault",
        icon: HardDrive,
        gradient: "from-amber-500 to-orange-500",
        hoverBg: "hover:bg-amber-500/10",
        activeBg: "bg-amber-500/15",
        activeText: "text-amber-600 dark:text-amber-400",
      },
      {
        title: "Secrets Vault",
        to: "/secrets-vault",
        icon: KeyRound,
        gradient: "from-emerald-500 to-cyan-500",
        hoverBg: "hover:bg-emerald-500/10",
        activeBg: "bg-emerald-500/15",
        activeText: "text-emerald-600 dark:text-emerald-400",
      },
      {
        title: "Offline Docs",
        to: "/offline-docs",
        icon: FileSearch,
        gradient: "from-gray-500 to-slate-500",
        hoverBg: "hover:bg-gray-500/10",
        activeBg: "bg-gray-500/15",
        activeText: "text-gray-600 dark:text-gray-400",
      },
      {
        title: "Model Registry",
        to: "/model-registry",
        icon: Server,
        gradient: "from-blue-500 to-indigo-500",
        hoverBg: "hover:bg-blue-500/10",
        activeBg: "bg-blue-500/15",
        activeText: "text-blue-600 dark:text-blue-400",
      },
      {
        title: "Model Manager",
        to: "/model-download",
        icon: Download,
        gradient: "from-teal-500 to-cyan-500",
        hoverBg: "hover:bg-teal-500/10",
        activeBg: "bg-teal-500/15",
        activeText: "text-teal-600 dark:text-teal-400",
      },
      {
        title: "Benchmarks",
        to: "/benchmark",
        icon: Gauge,
        gradient: "from-amber-500 to-yellow-500",
        hoverBg: "hover:bg-amber-500/10",
        activeBg: "bg-amber-500/15",
        activeText: "text-amber-600 dark:text-amber-400",
      },
    ],
  },
  {
    label: "Network",
    items: [
      {
        title: "MCP Hub",
        to: "/mcp-hub",
        icon: Plug,
        gradient: "from-indigo-500 to-violet-500",
        hoverBg: "hover:bg-indigo-500/10",
        activeBg: "bg-indigo-500/15",
        activeText: "text-indigo-600 dark:text-indigo-400",
      },
      {
        title: "OpenClaw Control",
        to: "/openclaw-control",
        icon: Radio,
        gradient: "from-rose-500 to-orange-500",
        hoverBg: "hover:bg-rose-500/10",
        activeBg: "bg-rose-500/15",
        activeText: "text-rose-600 dark:text-rose-400",
      },
      {
        title: "OpenClaw Board",
        to: "/openclaw-kanban",
        icon: Kanban,
        gradient: "from-red-500 to-orange-500",
        hoverBg: "hover:bg-red-500/10",
        activeBg: "bg-red-500/15",
        activeText: "text-red-600 dark:text-red-400",
      },
      {
        title: "AI Operations",
        to: "/system-services",
        icon: Activity,
        gradient: "from-emerald-500 to-green-500",
        hoverBg: "hover:bg-emerald-500/10",
        activeBg: "bg-emerald-500/15",
        activeText: "text-emerald-600 dark:text-emerald-400",
      },
      {
        title: "CNS",
        to: "/cns",
        icon: Globe,
        gradient: "from-teal-500 to-green-500",
        hoverBg: "hover:bg-teal-500/10",
        activeBg: "bg-teal-500/15",
        activeText: "text-teal-600 dark:text-teal-400",
      },
      {
        title: "P2P Chat",
        to: "/decentralized-chat",
        icon: Radio,
        gradient: "from-green-500 to-emerald-500",
        hoverBg: "hover:bg-green-500/10",
        activeBg: "bg-green-500/15",
        activeText: "text-green-600 dark:text-green-400",
      },
      {
        title: "A2A Network",
        to: "/a2a-network",
        icon: Network,
        gradient: "from-blue-500 to-purple-500",
        hoverBg: "hover:bg-blue-500/10",
        activeBg: "bg-blue-500/15",
        activeText: "text-blue-600 dark:text-blue-400",
      },
      {
        title: "Federation",
        to: "/federation",
        icon: Network,
        gradient: "from-blue-500 to-purple-500",
        hoverBg: "hover:bg-blue-500/10",
        activeBg: "bg-blue-500/15",
        activeText: "text-blue-600 dark:text-blue-400",
      },
      {
        title: "AI Compute",
        to: "/compute",
        icon: Cpu,
        gradient: "from-amber-500 to-orange-500",
        hoverBg: "hover:bg-amber-500/10",
        activeBg: "bg-amber-500/15",
        activeText: "text-amber-600 dark:text-amber-400",
      },
      {
        title: "Creator Network",
        to: "/creator-network",
        icon: Globe,
        gradient: "from-cyan-500 to-teal-500",
        hoverBg: "hover:bg-cyan-500/10",
        activeBg: "bg-cyan-500/15",
        activeText: "text-cyan-600 dark:text-cyan-400",
      },
    ],
  },
  {
    label: "Publish",
    items: [
      {
        title: "Publish",
        to: "/deploy",
        icon: Rocket,
        gradient: "from-violet-500 to-fuchsia-500",
        hoverBg: "hover:bg-violet-500/10",
        activeBg: "bg-violet-500/15",
        activeText: "text-violet-600 dark:text-violet-400",
      },
      {
        title: "Web3 Deploy",
        to: "/decentralized-deploy",
        icon: Layers,
        gradient: "from-cyan-500 to-blue-500",
        hoverBg: "hover:bg-cyan-500/10",
        activeBg: "bg-cyan-500/15",
        activeText: "text-cyan-600 dark:text-cyan-400",
      },
      {
        title: "App Publishing",
        to: "/app-publishing",
        icon: Rocket,
        gradient: "from-indigo-500 to-pink-500",
        hoverBg: "hover:bg-indigo-500/10",
        activeBg: "bg-indigo-500/15",
        activeText: "text-indigo-600 dark:text-indigo-400",
      },
      {
        title: "Create Asset",
        to: "/create-asset",
        icon: Zap,
        gradient: "from-amber-500 to-orange-500",
        hoverBg: "hover:bg-amber-500/10",
        activeBg: "bg-amber-500/15",
        activeText: "text-amber-600 dark:text-amber-400",
      },
      {
        title: "My Creations",
        to: "/creator",
        icon: Sparkles,
        gradient: "from-amber-500 to-orange-500",
        hoverBg: "hover:bg-amber-500/10",
        activeBg: "bg-amber-500/15",
        activeText: "text-amber-600 dark:text-amber-400",
      },
      {
        title: "My Assets",
        to: "/my-marketplace-assets",
        icon: Package,
        gradient: "from-violet-500 to-pink-500",
        hoverBg: "hover:bg-violet-500/10",
        activeBg: "bg-violet-500/15",
        activeText: "text-violet-600 dark:text-violet-400",
      },
      {
        title: "Marketplace",
        to: "/nft-marketplace",
        icon: Coins,
        gradient: "from-purple-500 to-indigo-500",
        hoverBg: "hover:bg-purple-500/10",
        activeBg: "bg-purple-500/15",
        activeText: "text-purple-600 dark:text-purple-400",
      },
      {
        title: "Explore Marketplace",
        to: "/marketplace",
        icon: ShoppingCart,
        gradient: "from-blue-500 to-cyan-500",
        hoverBg: "hover:bg-blue-500/10",
        activeBg: "bg-blue-500/15",
        activeText: "text-blue-600 dark:text-blue-400",
      },
      {
        title: "On-Chain Market",
        to: "/on-chain-marketplace",
        icon: Coins,
        gradient: "from-amber-500 to-yellow-500",
        hoverBg: "hover:bg-amber-500/10",
        activeBg: "bg-amber-500/15",
        activeText: "text-amber-600 dark:text-amber-400",
      },
      {
        title: "Plugin Market",
        to: "/plugin-marketplace",
        icon: Puzzle,
        gradient: "from-green-500 to-teal-500",
        hoverBg: "hover:bg-green-500/10",
        activeBg: "bg-green-500/15",
        activeText: "text-green-600 dark:text-green-400",
      },
    ],
  },
  {
    label: "Sovereign",
    items: [
      {
        title: "Token Economics",
        to: "/tokenomics",
        icon: CircleDollarSign,
        gradient: "from-yellow-500 to-orange-500",
        hoverBg: "hover:bg-yellow-500/10",
        activeBg: "bg-yellow-500/15",
        activeText: "text-yellow-600 dark:text-yellow-400",
      },
      {
        title: "Governance",
        to: "/governance",
        icon: Landmark,
        gradient: "from-purple-500 to-pink-500",
        hoverBg: "hover:bg-purple-500/10",
        activeBg: "bg-purple-500/15",
        activeText: "text-purple-600 dark:text-purple-400",
      },
      {
        title: "Data Sovereignty",
        to: "/data-sovereignty",
        icon: Shield,
        gradient: "from-red-500 to-orange-500",
        hoverBg: "hover:bg-red-500/10",
        activeBg: "bg-red-500/15",
        activeText: "text-red-600 dark:text-red-400",
      },
      {
        title: "Universal Identity",
        to: "/identity",
        icon: Fingerprint,
        gradient: "from-violet-500 to-blue-600",
        hoverBg: "hover:bg-violet-500/10",
        activeBg: "bg-violet-500/15",
        activeText: "text-violet-600 dark:text-violet-400",
      },
      {
        title: "SSI Credentials",
        to: "/ssi-credentials",
        icon: Stamp,
        gradient: "from-green-500 to-emerald-500",
        hoverBg: "hover:bg-green-500/10",
        activeBg: "bg-green-500/15",
        activeText: "text-green-600 dark:text-green-400",
      },
      {
        title: "Creator Profile",
        to: "/creator-profile",
        icon: UserCircle,
        gradient: "from-violet-500 to-pink-500",
        hoverBg: "hover:bg-violet-500/10",
        activeBg: "bg-violet-500/15",
        activeText: "text-violet-600 dark:text-violet-400",
      },
    ],
  },
  {
    label: "Productivity",
    items: [
      {
        title: "Email Hub",
        to: "/email-hub",
        icon: Mail,
        gradient: "from-emerald-500 to-teal-500",
        hoverBg: "hover:bg-emerald-500/10",
        activeBg: "bg-emerald-500/15",
        activeText: "text-emerald-600 dark:text-emerald-400",
      },
      {
        title: "Calendar",
        to: "/calendar",
        icon: Calendar,
        gradient: "from-orange-500 to-amber-500",
        hoverBg: "hover:bg-orange-500/10",
        activeBg: "bg-orange-500/15",
        activeText: "text-orange-600 dark:text-orange-400",
      },
      {
        title: "Integrations",
        to: "/integrations",
        icon: Puzzle,
        gradient: "from-teal-500 to-cyan-500",
        hoverBg: "hover:bg-teal-500/10",
        activeBg: "bg-teal-500/15",
        activeText: "text-teal-600 dark:text-teal-400",
      },
      {
        title: "Notifications",
        to: "/notifications",
        icon: BellRing,
        gradient: "from-blue-500 to-indigo-500",
        hoverBg: "hover:bg-blue-500/10",
        activeBg: "bg-blue-500/15",
        activeText: "text-blue-600 dark:text-blue-400",
      },
    ],
  },
  {
    label: "Admin",
    items: [
      {
        title: "Dashboard",
        to: "/admin",
        icon: AdminIcon,
        gradient: "from-emerald-500 to-teal-500",
        hoverBg: "hover:bg-emerald-500/10",
        activeBg: "bg-emerald-500/15",
        activeText: "text-emerald-600 dark:text-emerald-400",
      },
      {
        title: "Profile",
        to: "/profile",
        icon: UserCircle,
        gradient: "from-violet-500 to-purple-500",
        hoverBg: "hover:bg-violet-500/10",
        activeBg: "bg-violet-500/15",
        activeText: "text-violet-600 dark:text-violet-400",
      },
      {
        title: "Team",
        to: "/team",
        icon: UserCheck,
        gradient: "from-pink-500 to-rose-500",
        hoverBg: "hover:bg-pink-500/10",
        activeBg: "bg-pink-500/15",
        activeText: "text-pink-600 dark:text-pink-400",
      },
      {
        title: "Analytics",
        to: "/analytics",
        icon: BarChart3,
        gradient: "from-amber-500 to-orange-500",
        hoverBg: "hover:bg-amber-500/10",
        activeBg: "bg-amber-500/15",
        activeText: "text-amber-600 dark:text-amber-400",
      },
      {
        title: "Backup & Restore",
        to: "/backup",
        icon: Archive,
        gradient: "from-cyan-500 to-blue-500",
        hoverBg: "hover:bg-cyan-500/10",
        activeBg: "bg-cyan-500/15",
        activeText: "text-cyan-600 dark:text-cyan-400",
      },
      {
        title: "Audit Log",
        to: "/audit-log",
        icon: ScrollText,
        gradient: "from-red-500 to-orange-500",
        hoverBg: "hover:bg-red-500/10",
        activeBg: "bg-red-500/15",
        activeText: "text-red-600 dark:text-red-400",
      },
    ],
  },
];

const bottomItems = [
  {
    title: "Settings",
    to: "/settings",
    icon: Settings,
    hoverBg: "hover:bg-gray-500/10",
    activeBg: "bg-gray-500/15",
    activeText: "text-gray-600 dark:text-gray-400",
  },
];

// Hover state types
type HoverState =
  | "start-hover:app"
  | "start-hover:chat"
  | "start-hover:settings"
  | "start-hover:library"
  | "clear-hover"
  | "no-hover";

export function AppSidebar() {
  const { state, toggleSidebar } = useSidebar();
  const [hoverState, setHoverState] = useState<HoverState>("no-hover");
  const expandedByHover = useRef(false);
  const [isHelpDialogOpen, setIsHelpDialogOpen] = useState(false);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isDropdownOpen] = useAtom(dropdownOpenAtom);
  const [selectedAppId] = useAtom(selectedAppIdAtom);
  const { apps } = useLoadApps();
  const { settings } = useSettings();
  const { templates } = useTemplates();
  const { navigate } = useRouter();
  const isCollapsed = state === "collapsed";

  // Get selected app name
  const selectedApp = apps.find((app) => app.id === selectedAppId);
  const displayText = selectedApp
    ? selectedApp.name
    : "(no app selected)";

  const handleAppClick = () => {
    if (selectedApp) {
      navigate({ to: "/app-details", search: { appId: selectedApp.id } });
    }
  };

  useEffect(() => {
    if (hoverState.startsWith("start-hover") && state === "collapsed") {
      expandedByHover.current = true;
      toggleSidebar();
    }
    if (
      hoverState === "clear-hover" &&
      state === "expanded" &&
      expandedByHover.current &&
      !isDropdownOpen
    ) {
      toggleSidebar();
      expandedByHover.current = false;
      setHoverState("no-hover");
    }
  }, [hoverState, toggleSidebar, state, setHoverState, isDropdownOpen]);

  const routerState = useRouterState();
  const pathname = routerState.location.pathname;
  const isAppRoute = pathname === "/" || pathname.startsWith("/app-details");
  const isChatRoute = pathname === "/chat";
  const isSettingsRoute = pathname.startsWith("/settings");

  let selectedItem: string | null = null;
  if (hoverState === "start-hover:app") {
    selectedItem = "Apps";
  } else if (hoverState === "start-hover:chat") {
    selectedItem = "Chat";
  } else if (hoverState === "start-hover:settings") {
    selectedItem = "Settings";
  } else if (hoverState === "start-hover:library") {
    selectedItem = "Library";
  } else if (state === "expanded") {
    if (isAppRoute) selectedItem = "Apps";
    else if (isChatRoute) selectedItem = "Chat";
    else if (isSettingsRoute) selectedItem = "Settings";
  }

  return (
    <Sidebar
      collapsible="icon"
      onMouseLeave={() => {
        if (!isDropdownOpen) {
          setHoverState("clear-hover");
        }
      }}
      className="border-r-0"
    >
      {/* Main sidebar with ghost glass effect */}
      <div className="flex h-full flex-col lovable-sidebar">
        {/* Logo Header - Hidden (using title bar instead) */}
        <div className="h-14 border-b border-border/30" />

        <SidebarContent className="flex-1 overflow-hidden">
          <div className="flex h-full">
            {/* Left Column: Navigation Icons with Scroll */}
            <div className="flex flex-col w-[56px] shrink-0 border-r border-border/20">
              {/* Quick Actions - New Button */}
              <div className="p-1.5 border-b border-border/20">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setIsCreateDialogOpen(true)}
                      className={cn(
                        "w-full h-9 rounded-lg",
                        "bg-gradient-to-br from-violet-500/10 to-purple-500/10",
                        "hover:from-violet-500/20 hover:to-purple-500/20",
                        "border border-violet-500/20 hover:border-violet-500/40",
                        "shadow-sm hover:shadow-md hover:shadow-violet-500/10",
                        "transition-all duration-200 group"
                      )}
                    >
                      <Plus className="h-4 w-4 text-violet-600 dark:text-violet-400 group-hover:scale-110 transition-transform" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="right" sideOffset={8}>Create new project</TooltipContent>
                </Tooltip>
              </div>

              {/* Scrollable Navigation Area */}
              <ScrollArea className="flex-1">
                <div className="py-1.5 px-1.5 space-y-3">
                  {menuCategories.map((category, categoryIndex) => (
                    <div key={category.label}>
                      {/* Category Label - only show when expanded */}
                      {!isCollapsed && (
                        <div className="px-1 mb-1">
                          <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/50">
                            {category.label}
                          </span>
                        </div>
                      )}
                      
                      {/* Category Items */}
                      <div className="space-y-0.5">
                        {category.items.map((item) => {
                          const isActive =
                            (item.to === "/" && pathname === "/") ||
                            (item.to !== "/" && pathname.startsWith(item.to));

                          return (
                            <Tooltip key={item.title} delayDuration={0}>
                              <TooltipTrigger asChild>
                                <Link
                                  to={item.to}
                                  className={cn(
                                    "flex items-center justify-center w-full h-9 rounded-lg transition-all duration-200",
                                    isActive
                                      ? cn(item.activeBg, "shadow-sm ring-1 ring-inset ring-black/5")
                                      : cn("hover:bg-muted/60", item.hoverBg)
                                  )}
                                  onMouseEnter={() => {
                                    if (item.title === "Apps") setHoverState("start-hover:app");
                                    else if (item.title === "Chat") setHoverState("start-hover:chat");
                                    else if (item.title === "Settings") setHoverState("start-hover:settings");
                                    else if (item.title === "Library") setHoverState("start-hover:library");
                                  }}
                                >
                                  <div className={cn(
                                    "flex items-center justify-center w-7 h-7 rounded-md transition-all duration-200",
                                    isActive && `bg-gradient-to-br ${item.gradient} shadow-md`
                                  )}>
                                    <item.icon className={cn(
                                      "h-4 w-4 transition-colors duration-200",
                                      isActive ? "text-white" : "text-muted-foreground"
                                    )} />
                                  </div>
                                </Link>
                              </TooltipTrigger>
                              <TooltipContent side="right" sideOffset={8} className="font-medium">
                                {item.title}
                              </TooltipContent>
                            </Tooltip>
                          );
                        })}
                      </div>
                      
                      {/* Category Divider */}
                      {categoryIndex < menuCategories.length - 1 && (
                        <div className="mt-2 mx-1 border-t border-border/30" />
                      )}
                    </div>
                  ))}
                </div>
              </ScrollArea>

              {/* Bottom Navigation - Fixed at bottom */}
              <div className="p-1.5 border-t border-border/30 space-y-0.5">
                {bottomItems.map((item) => {
                  const isActive = pathname.startsWith(item.to);

                  return (
                    <Tooltip key={item.title} delayDuration={0}>
                      <TooltipTrigger asChild>
                        <Link
                          to={item.to}
                          className={cn(
                            "flex items-center justify-center w-full h-9 rounded-lg transition-all duration-200",
                            isActive
                              ? cn(item.activeBg, "shadow-sm")
                              : cn("hover:bg-muted/60", item.hoverBg)
                          )}
                          onMouseEnter={() => {
                            if (item.title === "Settings") setHoverState("start-hover:settings");
                          }}
                        >
                          <div className={cn(
                            "flex items-center justify-center w-7 h-7 rounded-md transition-all duration-200",
                            isActive && "bg-muted"
                          )}>
                            <item.icon className={cn(
                              "h-4 w-4 transition-colors duration-200",
                              isActive ? item.activeText : "text-muted-foreground"
                            )} />
                          </div>
                        </Link>
                      </TooltipTrigger>
                      <TooltipContent side="right" sideOffset={8} className="font-medium">
                        {item.title}
                      </TooltipContent>
                    </Tooltip>
                  );
                })}

                {/* Help Button */}
                <Tooltip delayDuration={0}>
                  <TooltipTrigger asChild>
                    <button
                      className={cn(
                        "flex items-center justify-center w-full h-9 rounded-lg transition-all duration-200",
                        "hover:bg-muted/60"
                      )}
                      onClick={() => setIsHelpDialogOpen(true)}
                    >
                      <div className="flex items-center justify-center w-7 h-7 rounded-md">
                        <HelpCircle className="h-4 w-4 text-muted-foreground" />
                      </div>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right" sideOffset={8} className="font-medium">
                    Help & Support
                  </TooltipContent>
                </Tooltip>
              </div>
            </div>

            {/* Right Column: Expandable Content Panel */}
            <div className={cn(
              "flex-1 overflow-hidden transition-all duration-300 ease-in-out",
              isCollapsed ? "w-0 opacity-0 -translate-x-4" : "w-[200px] opacity-100 translate-x-0"
            )}>
              <div className="h-full bg-muted/20 overflow-hidden">
                <AppList show={selectedItem === "Apps"} />
                <ChatList show={selectedItem === "Chat"} />
                <SettingsList show={selectedItem === "Settings"} />
              </div>
            </div>
          </div>
        </SidebarContent>

        {/* Footer - Compact */}
        <SidebarFooter className="border-t border-border/40 p-2 space-y-1.5">
          {/* App Name Button */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                data-testid="sidebar-app-name-button"
                variant="outline"
                size="sm"
                className={cn(
                  "w-full h-8 no-app-region-drag text-xs font-medium transition-all duration-200",
                  "bg-muted/30 border-border/50 hover:bg-muted/50",
                  selectedApp ? "cursor-pointer" : "cursor-default",
                  isCollapsed && "px-1"
                )}
                onClick={handleAppClick}
              >
                <Layers className={cn("h-3.5 w-3.5 shrink-0", isCollapsed ? "" : "mr-1.5")} />
                {!isCollapsed && (
                  <span className="truncate">
                    {displayText}
                  </span>
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right" sideOffset={8}>
              {selectedApp ? `Open ${selectedApp.name} details` : "No app selected"}
            </TooltipContent>
          </Tooltip>

          {/* OpenClaw CNS Widget */}
          {!isCollapsed ? (
            <CNSWidget variant="button" showWorkflows={false} />
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex justify-center">
                  <CNSWidget variant="button" showWorkflows={false} />
                </div>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={8}>
                OpenClaw CNS - AI Assistant
              </TooltipContent>
            </Tooltip>
          )}

          {/* System Status */}
          <div className={cn(
            "flex items-center gap-1.5 px-2 py-1 rounded-md bg-emerald-500/10",
            isCollapsed && "justify-center px-1"
          )}>
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            {!isCollapsed && (
              <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">Online</span>
            )}
          </div>
        </SidebarFooter>
      </div>

      <HelpDialog
        isOpen={isHelpDialogOpen}
        onClose={() => setIsHelpDialogOpen(false)}
      />

      <CreateAppDialog
        open={isCreateDialogOpen}
        onOpenChange={setIsCreateDialogOpen}
        template={templates?.find((t) => t.id === settings?.selectedTemplateId)}
      />

      <SidebarRail />
    </Sidebar>
  );
}
