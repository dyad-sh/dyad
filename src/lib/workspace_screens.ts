import {
  AudioLines,
  Brain,
  CircuitBoard,
  FolderOpen,
  Cog,
  Cpu,
  Factory,
  Activity,
  DraftingCompass,
  Blocks,
  Briefcase,
  Code2,
  BookOpen,
  Boxes,
  Box,
  Database,
  FolderGit2,
  Github,
  HardDrive,
  Image,
  LayoutDashboard,
  Library,
  Orbit,
  Palette,
  Rocket,
  Settings,
  Sparkles,
  Terminal,
  Triangle,
  Wrench,
  type LucideIcon,
} from "lucide-react";

/**
 * Screens that open as workspace tabs.
 *
 * Every screen the user navigates to gets a tab, so moving between Helix, the
 * Knowledge Base and Settings is switching tabs rather than losing one screen
 * to open another.
 *
 * Chat conversations and Hermes agent chats are not here: they already have
 * their own per-conversation tabs, keyed by conversation rather than by route.
 */

export type WorkspaceScreen = {
  /** Route path, and the tab's identity — one tab per screen. */
  path: string;
  title: string;
  icon: LucideIcon;
};

const SCREENS: WorkspaceScreen[] = [
  { path: "/agents", title: "Agents", icon: Boxes },
  { path: "/coder/studio", title: "Build Studio", icon: Code2 },
  { path: "/coder/helix", title: "Helix", icon: Orbit },
  { path: "/coder/openworker", title: "OpenWorker", icon: Briefcase },
  { path: "/coder", title: "Coding Agents", icon: Terminal },
  { path: "/memory", title: "Memory", icon: Brain },
  { path: "/knowledge-core", title: "Knowledge Core", icon: Sparkles },
  { path: "/assembler3d", title: "Assembler", icon: Box },
  { path: "/build", title: "Build", icon: DraftingCompass },
  { path: "/build/electronics", title: "Electronics", icon: CircuitBoard },
  { path: "/build/mechanical", title: "Mechanical", icon: Cog },
  { path: "/build/fabrication", title: "Fabrication", icon: Factory },
  // Renamed, not removed: the old path still opens Build.
  { path: "/engineering", title: "Build", icon: DraftingCompass },
  { path: "/jarvis/settings", title: "Voice Assistant", icon: AudioLines },
  { path: "/jarvis", title: "JARVIS", icon: Sparkles },
  { path: "/knowledge-base", title: "Knowledge Base", icon: BookOpen },
  { path: "/library", title: "Library", icon: Library },
  { path: "/library/media", title: "Media", icon: Image },
  { path: "/apps", title: "Apps", icon: Boxes },
  { path: "/hub", title: "Hub", icon: Blocks },
  { path: "/library/themes", title: "Themes", icon: Palette },
  { path: "/library/prompts", title: "Prompts", icon: Wrench },
  { path: "/vector", title: "Vector", icon: Database },
  { path: "/data-sources", title: "Data Sources", icon: Database },
  { path: "/infrastructure", title: "Infrastructure", icon: Activity },
  { path: "/system", title: "System", icon: Cpu },
  { path: "/storage", title: "Storage", icon: HardDrive },
  { path: "/local-storage", title: "File Vault", icon: FolderOpen },
  { path: "/devops", title: "Dev Ops", icon: Rocket },
  { path: "/devops/github", title: "GitHub", icon: Github },
  { path: "/devops/vercel", title: "Vercel", icon: Triangle },
  // The path this section used before the hierarchy existed.
  { path: "/dev-ops", title: "Dev Ops", icon: Rocket },
  { path: "/meta-hd", title: "Meta HD", icon: Box },
  { path: "/github", title: "GitHub", icon: Github },
  { path: "/vercel", title: "Vercel", icon: Triangle },
  { path: "/planner", title: "Planner", icon: LayoutDashboard },
  { path: "/settings", title: "Settings", icon: Settings },
  { path: "/app-details", title: "App", icon: FolderGit2 },
];

/**
 * Longest path first, so `/coder/helix` is not mistaken for `/coder`.
 */
const SCREENS_BY_SPECIFICITY = [...SCREENS].sort(
  (a, b) => b.path.length - a.path.length,
);

/** The screen a pathname belongs to, or undefined when it has no tab. */
export function screenForPath(pathname: string): WorkspaceScreen | undefined {
  return SCREENS_BY_SPECIFICITY.find(
    (screen) =>
      pathname === screen.path || pathname.startsWith(`${screen.path}/`),
  );
}

/** Chats own their tabs already; those routes must not also open a screen tab. */
const CHAT_OWNED_PREFIXES = ["/chat-agent", "/agent-os", "/chat"];

export function isChatOwnedPath(pathname: string): boolean {
  if (pathname === "/") return true;
  return CHAT_OWNED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export type ScreenTab = {
  path: string;
  title: string;
};

/** Adds a screen tab if it is not already open, keeping insertion order. */
export function openScreenTab(
  tabs: ScreenTab[],
  screen: WorkspaceScreen,
): ScreenTab[] {
  if (tabs.some((tab) => tab.path === screen.path)) return tabs;
  return [...tabs, { path: screen.path, title: screen.title }];
}

/**
 * Removes a tab and says where to go if it was the one being viewed: the tab
 * to its right, else its left, else nothing — how a browser behaves.
 */
export function closeScreenTab(
  tabs: ScreenTab[],
  path: string,
): { tabs: ScreenTab[]; fallback: ScreenTab | null } {
  const index = tabs.findIndex((tab) => tab.path === path);
  if (index < 0) return { tabs, fallback: null };

  const remaining = tabs.filter((tab) => tab.path !== path);
  const fallback = remaining[index] ?? remaining[index - 1] ?? null;
  return { tabs: remaining, fallback };
}
